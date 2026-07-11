"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { encodeFunctionData, formatUnits, getAddress } from "viem";
import type { PublicClient } from "viem";
import { useReadContract } from "wagmi";
import type { useWriteContract } from "wagmi";
import {
  APP_CHAIN_ID,
  CONTRACT_ADDRESS,
  GAME_ABI,
  LINEA_TOKEN_ADDRESS,
  TOKEN_ABI,
  TX_RECEIPT_TIMEOUT_MS,
} from "../lib/constants";
import { getFallbackFeeOverrides, getKeeperFeeOverrides } from "../lib/lineaFees";
import { log } from "../lib/logger";
import { isUserRejection, normalizeDecimalInput } from "../lib/utils";
import { parsePositiveLineaAmountWei } from "../lib/tokenAmountMath";
import { getExplorerTxUrl } from "../lib/explorerLinks";
import { withMiningRpcTimeout } from "./useMining.shared";

type NotifyFn = (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
type SilentSendFn = (
  tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint; nonce?: number; feeMode?: "normal" | "keeper" },
  gasOverrides?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasPrice?: bigint },
) => Promise<`0x${string}`>;
type ExternalSendFn = (tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint }) => Promise<`0x${string}`>;
type ClearEip7702DelegationFn = () => Promise<`0x${string}`>;
type WriteContractAsyncFn = ReturnType<typeof useWriteContract>["writeContractAsync"];
type BalanceData = { value: bigint } | null | undefined;
type ReceiptState = "confirmed" | "pending";

function formatWalletTransferFailure(error: unknown, asset: "ETH" | "LINEA") {
  const message = error instanceof Error ? error.message : "";
  if (/transaction gas limit cap exceeded/i.test(message)) {
    return `${asset} transfer was rejected before submission. Check the amount and try again.`;
  }
  return message
    ? `${asset} transfer failed: ${message}`
    : `${asset} transfer failed. Check wallet balance and try again.`;
}
export interface PendingTransactionStatus {
  latestNonce: number;
  pendingNonce: number;
  nonceGap: number;
  blockedNonce: number | null;
  updatedAt: number;
}

interface UseWalletActionsOptions {
  connectedWalletAddress?: string | null;
  embeddedWalletAddress: string | null;
  externalWalletAddress: string | null;
  embeddedTokenBalance: BalanceData;
  embeddedEthBalance: BalanceData;
  writeContractAsync: WriteContractAsyncFn;
  sendTransactionSilent?: SilentSendFn;
  sendTransactionFromExternal: ExternalSendFn;
  clearEip7702DelegationFromExternal?: ClearEip7702DelegationFn;
  refreshEmbeddedWalletCode?: () => Promise<string | null> | string | null;
  publicClient?: PublicClient;
  refetchEmbeddedEthBalance: () => Promise<unknown> | unknown;
  refetchEmbeddedTokenBalance: () => Promise<unknown> | unknown;
  walletTransfersEnabled: boolean;
  fetchWalletTransfers?: () => Promise<void> | void;
  notify: NotifyFn;
  onOpenWalletSettings: () => void;
  isPageVisible?: boolean;
  minEthForGas: number;
  minEthWithdrawReserveWei: bigint;
}

export function useWalletActions({
  connectedWalletAddress,
  embeddedWalletAddress,
  externalWalletAddress,
  embeddedTokenBalance,
  embeddedEthBalance,
  writeContractAsync,
  sendTransactionSilent,
  sendTransactionFromExternal,
  clearEip7702DelegationFromExternal,
  refreshEmbeddedWalletCode,
  publicClient,
  refetchEmbeddedEthBalance,
  refetchEmbeddedTokenBalance,
  walletTransfersEnabled,
  fetchWalletTransfers,
  notify,
  onOpenWalletSettings,
  isPageVisible = true,
  minEthForGas,
  minEthWithdrawReserveWei,
}: UseWalletActionsOptions) {
  const [withdrawAmount, setWithdrawAmount] = useState("0.0");
  const [withdrawEthAmount, setWithdrawEthAmount] = useState("0.0");
  const [depositEthAmount, setDepositEthAmount] = useState("0.001");
  const [depositTokenAmount, setDepositTokenAmount] = useState("10");
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [isWithdrawingEth, setIsWithdrawingEth] = useState(false);
  const [isDepositingEth, setIsDepositingEth] = useState(false);
  const [isDepositingToken, setIsDepositingToken] = useState(false);
  const walletTransferInFlightRef = useRef(false);
  const [pendingTransactionStatus, setPendingTransactionStatus] = useState<PendingTransactionStatus | null>(null);
  const [isRefreshingPendingTx, setIsRefreshingPendingTx] = useState(false);
  const [isCancellingPendingTx, setIsCancellingPendingTx] = useState(false);
  const [isClaimingConnectedResolverRewards, setIsClaimingConnectedResolverRewards] = useState(false);
  const [isClaimingEmbeddedResolverRewards, setIsClaimingEmbeddedResolverRewards] = useState(false);
  const [isClearingEip7702Delegation, setIsClearingEip7702Delegation] = useState(false);

  const normalizedConnectedWalletAddress = useMemo(() => {
    if (!connectedWalletAddress) return null;
    try {
      return getAddress(connectedWalletAddress);
    } catch {
      return null;
    }
  }, [connectedWalletAddress]);

  const normalizedEmbeddedWalletAddress = useMemo(() => {
    if (!embeddedWalletAddress) return null;
    try {
      return getAddress(embeddedWalletAddress);
    } catch {
      return null;
    }
  }, [embeddedWalletAddress]);

  const {
    data: connectedResolverRewardsRaw,
    refetch: refetchConnectedResolverRewards,
  } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "pendingResolverRewards",
    args: normalizedConnectedWalletAddress ? [normalizedConnectedWalletAddress] : undefined,
    chainId: APP_CHAIN_ID,
    query: {
      enabled: Boolean(normalizedConnectedWalletAddress),
      refetchInterval: isPageVisible ? 30_000 : 120_000,
    },
  });

  const {
    data: embeddedResolverRewardsRaw,
    refetch: refetchEmbeddedResolverRewards,
  } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "pendingResolverRewards",
    args: normalizedEmbeddedWalletAddress ? [normalizedEmbeddedWalletAddress] : undefined,
    chainId: APP_CHAIN_ID,
    query: {
      enabled: Boolean(normalizedEmbeddedWalletAddress),
      refetchInterval: isPageVisible ? 30_000 : 120_000,
    },
  });

  const connectedResolverRewardsWei = connectedResolverRewardsRaw ?? 0n;
  const embeddedResolverRewardsWei = embeddedResolverRewardsRaw ?? 0n;

  const formatResolverRewards = useCallback((value: bigint) => {
    const amount = Number(formatUnits(value, 18));
    if (!Number.isFinite(amount)) return "0.0000";
    if (amount >= 100) return amount.toFixed(2);
    return amount.toFixed(4);
  }, []);

  const connectedResolverRewards = useMemo(
    () => formatResolverRewards(connectedResolverRewardsWei),
    [connectedResolverRewardsWei, formatResolverRewards],
  );

  const embeddedResolverRewards = useMemo(
    () => formatResolverRewards(embeddedResolverRewardsWei),
    [embeddedResolverRewardsWei, formatResolverRewards],
  );

  const formatTxStatusMessage = useCallback((message: string, hash: `0x${string}`) => {
    const txUrl = getExplorerTxUrl(hash);
    return txUrl ? `${message} ${txUrl}` : message;
  }, []);

  const waitForReceipt = useCallback(
    async (hash: `0x${string}`): Promise<ReceiptState> => {
      if (!publicClient) throw new Error("Transaction receipt verification is unavailable.");
      try {
        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: TX_RECEIPT_TIMEOUT_MS });
        if (receipt.status !== "success") {
          throw new Error(`Transaction reverted: ${hash}`);
        }
        return "confirmed";
      } catch (error) {
        const isReceiptTimeoutLike = () => {
          const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
          const name = error instanceof Error ? error.name : "";
          return (
            name === "TimeoutError" ||
            name === "TransactionReceiptNotFoundError" ||
            name === "TransactionReceiptTimeoutError" ||
            message.includes("timed out") ||
            message.includes("timeout") ||
            message.includes("receipt could not be found")
          );
        };
        const isTxLookupMissing = (value: unknown) => {
          const message = value instanceof Error ? value.message.toLowerCase() : String(value).toLowerCase();
          const name = value instanceof Error ? value.name : "";
          return (
            name === "TransactionNotFoundError" ||
            message.includes("transaction not found") ||
            message.includes("transaction could not be found")
          );
        };

        try {
          const lateReceipt = await publicClient.getTransactionReceipt({ hash });
          if (lateReceipt.status !== "success") {
            throw new Error(`Transaction reverted: ${hash}`);
          }
          return "confirmed";
        } catch (lateReceiptError) {
          if (isReceiptTimeoutLike()) {
            try {
              await publicClient.getTransaction({ hash });
              return "pending";
            } catch (txLookupError) {
              if (!isTxLookupMissing(txLookupError)) {
                throw txLookupError;
              }
              throw error;
            }
          }
          if (!isTxLookupMissing(lateReceiptError)) {
            throw lateReceiptError;
          }
          throw error;
        }
      }
    },
    [publicClient],
  );

  const refreshPendingTransactionStatus = useCallback(async () => {
    if (!embeddedWalletAddress || !publicClient) {
      setPendingTransactionStatus(null);
      notify("Pending transaction status is unavailable until the Privy wallet is ready.", "warning");
      return null;
    }

    setIsRefreshingPendingTx(true);
    try {
      const walletAddress = getAddress(embeddedWalletAddress);
      const [latestNonceRaw, pendingNonceRaw] = await Promise.all([
        withMiningRpcTimeout(
          publicClient.getTransactionCount({ address: walletAddress, blockTag: "latest" }),
          "settings.getTransactionCount.latest",
        ),
        withMiningRpcTimeout(
          publicClient.getTransactionCount({ address: walletAddress, blockTag: "pending" }),
          "settings.getTransactionCount.pending",
        ),
      ]);
      const latestNonce = Number(latestNonceRaw);
      const pendingNonce = Number(pendingNonceRaw);
      const nonceGap = Math.max(0, pendingNonce - latestNonce);
      const nextStatus: PendingTransactionStatus = {
        latestNonce,
        pendingNonce,
        nonceGap,
        blockedNonce: nonceGap > 0 ? latestNonce : null,
        updatedAt: Date.now(),
      };
      setPendingTransactionStatus(nextStatus);
      if (nonceGap > 0) {
        notify(`Detected ${nonceGap} pending transaction(s) blocking nonce ${latestNonce}.`, "warning");
      } else {
        notify("No stuck pending transactions detected for the Privy wallet.", "success");
      }
      return nextStatus;
    } catch (err) {
      log.error("PendingTx", "status refresh failed", err);
      notify("Could not inspect pending transactions right now.", "danger");
      return null;
    } finally {
      setIsRefreshingPendingTx(false);
    }
  }, [embeddedWalletAddress, notify, publicClient]);

  const cancelPendingTransaction = useCallback(async () => {
    if (!embeddedWalletAddress) {
      notify("Create a Privy wallet first.", "warning");
      onOpenWalletSettings();
      return;
    }
    if (!sendTransactionSilent || !publicClient) {
      notify("Privy wallet is not ready yet.", "warning");
      return;
    }

    const status = await refreshPendingTransactionStatus();
    if (!status || status.nonceGap <= 0 || status.blockedNonce === null) {
      notify("No stuck pending transaction was found to cancel.", "info");
      return;
    }

    setIsCancellingPendingTx(true);
    try {
      const sendCancel = async (nonce: number) => {
        let feeOverrides:
          | { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasPrice?: bigint }
          | undefined;
        try {
          const fees = await withMiningRpcTimeout(publicClient.estimateFeesPerGas(), "settings.estimateFeesPerGas");
          feeOverrides = getKeeperFeeOverrides(fees, APP_CHAIN_ID, 145n, 145n);
        } catch {
          feeOverrides = getFallbackFeeOverrides(APP_CHAIN_ID, "keeper");
        }

        return sendTransactionSilent(
          {
            to: getAddress(embeddedWalletAddress),
            value: 0n,
            gas: 21_000n,
            nonce,
            feeMode: "keeper",
          },
          feeOverrides,
        );
      };

      let targetNonce = status.blockedNonce;
      let hash: `0x${string}`;
      try {
        hash = await sendCancel(targetNonce);
      } catch (err) {
        const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
        if (message.includes("nonce too low")) {
          const refreshed = await refreshPendingTransactionStatus();
          if (!refreshed || refreshed.nonceGap <= 0 || refreshed.blockedNonce === null) {
            notify("The blocked nonce already advanced. No stuck pending transaction remains to clear.", "success");
            return;
          }
          if (refreshed.blockedNonce === targetNonce) {
            throw err;
          }
          targetNonce = refreshed.blockedNonce;
          hash = await sendCancel(targetNonce);
        } else {
          throw err;
        }
      }

      try {
        await publicClient.waitForTransactionReceipt({ hash, timeout: TX_RECEIPT_TIMEOUT_MS });
      } catch {
        // Follow-up nonce refresh below is enough if receipt polling lags.
      }

      const refreshed = await refreshPendingTransactionStatus();
      if (refreshed && refreshed.nonceGap > 0) {
        notify(`Replaced blocked nonce ${targetNonce}. If more are queued, run clear again.`, "warning");
      } else {
        notify(`Stuck pending transaction cleared at nonce ${targetNonce}.`, "success");
      }
    } catch (err) {
      if (!isUserRejection(err)) {
        log.error("PendingTx", "cancel failed", err);
        const message = err instanceof Error ? err.message : "";
        notify(message ? `Could not clear pending tx: ${message}` : "Could not clear pending transaction.", "danger");
      }
    } finally {
      setIsCancellingPendingTx(false);
    }
  }, [
    embeddedWalletAddress,
    notify,
    onOpenWalletSettings,
    publicClient,
    refreshPendingTransactionStatus,
    sendTransactionSilent,
  ]);

  const refreshResolverRewardReads = useCallback(() => {
    void refetchConnectedResolverRewards();
    void refetchEmbeddedResolverRewards();
  }, [refetchConnectedResolverRewards, refetchEmbeddedResolverRewards]);

  const estimateResolverRewardClaimGas = useCallback(
    async (account: `0x${string}`) => {
      if (!publicClient) return 160_000n;
      const data = encodeFunctionData({
        abi: GAME_ABI,
        functionName: "claimResolverRewards",
      });
      try {
        const estimatedGas = await publicClient.estimateGas({
          account,
          to: CONTRACT_ADDRESS,
          data,
        });
        return estimatedGas + 20_000n;
      } catch {
        return 160_000n;
      }
    },
    [publicClient],
  );

  const handleClaimConnectedResolverRewards = useCallback(async () => {
    if (!normalizedConnectedWalletAddress) {
      notify("Connect the resolver wallet first.", "warning");
      return;
    }
    if (connectedResolverRewardsWei <= 0n) {
      notify("No resolver rewards are pending for the connected wallet.", "info");
      return;
    }

    setIsClaimingConnectedResolverRewards(true);
    try {
      notify("Preparing resolver reward claim. Confirm the wallet prompt if it appears.", "info");
      const gas = await estimateResolverRewardClaimGas(normalizedConnectedWalletAddress);
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "claimResolverRewards",
        chainId: APP_CHAIN_ID,
        gas,
      });
      const receiptState = await waitForReceipt(hash);
      if (receiptState === "pending") {
        notify(formatTxStatusMessage("Resolver reward claim submitted and is still pending confirmation.", hash), "info");
        refreshResolverRewardReads();
        return;
      }
      refreshResolverRewardReads();
      notify(formatTxStatusMessage("Resolver rewards claimed to the connected wallet.", hash), "success");
    } catch (err) {
      if (!isUserRejection(err)) {
        log.error("ResolverRewards", "connected claim failed", err);
        const message = err instanceof Error ? err.message : "";
        notify(
          message ? `Resolver reward claim failed: ${message}` : "Resolver reward claim failed.",
          "danger",
        );
      } else {
        notify("Resolver reward claim rejected in wallet.", "info");
      }
    } finally {
      setIsClaimingConnectedResolverRewards(false);
    }
  }, [
    connectedResolverRewardsWei,
    estimateResolverRewardClaimGas,
    formatTxStatusMessage,
    normalizedConnectedWalletAddress,
    notify,
    refreshResolverRewardReads,
    waitForReceipt,
    writeContractAsync,
  ]);

  const handleClaimEmbeddedResolverRewards = useCallback(async () => {
    if (!normalizedEmbeddedWalletAddress) {
      notify("Create the Privy wallet first.", "warning");
      onOpenWalletSettings();
      return;
    }
    if (!sendTransactionSilent) {
      notify("Privy wallet is not ready yet.", "warning");
      return;
    }
    if (embeddedResolverRewardsWei <= 0n) {
      notify("No resolver rewards are pending for the Privy wallet.", "info");
      return;
    }

    setIsClaimingEmbeddedResolverRewards(true);
    try {
      notify("Preparing resolver reward claim from the Privy wallet.", "info");
      const data = encodeFunctionData({
        abi: GAME_ABI,
        functionName: "claimResolverRewards",
      });
      const gas = await estimateResolverRewardClaimGas(normalizedEmbeddedWalletAddress);
      const hash = await sendTransactionSilent({
        to: CONTRACT_ADDRESS,
        data,
        gas,
      });
      const receiptState = await waitForReceipt(hash);
      if (receiptState === "pending") {
        notify(formatTxStatusMessage("Resolver reward claim submitted and is still pending confirmation.", hash), "info");
        refreshResolverRewardReads();
        return;
      }
      refreshResolverRewardReads();
      notify(formatTxStatusMessage("Resolver rewards claimed to the Privy wallet.", hash), "success");
    } catch (err) {
      if (!isUserRejection(err)) {
        log.error("ResolverRewards", "embedded claim failed", err);
        const message = err instanceof Error ? err.message : "";
        notify(
          message ? `Resolver reward claim failed: ${message}` : "Resolver reward claim failed.",
          "danger",
        );
      } else {
        notify("Resolver reward claim rejected in wallet.", "info");
      }
    } finally {
      setIsClaimingEmbeddedResolverRewards(false);
    }
  }, [
    embeddedResolverRewardsWei,
    estimateResolverRewardClaimGas,
    formatTxStatusMessage,
    normalizedEmbeddedWalletAddress,
    notify,
    onOpenWalletSettings,
    refreshResolverRewardReads,
    sendTransactionSilent,
    waitForReceipt,
  ]);

  const handleWithdrawToExternal = useCallback(async () => {
    if (!externalWalletAddress) {
      notify("External wallet is not connected.", "warning");
      return;
    }
    const normalized = normalizeDecimalInput(withdrawAmount);
    const amountWei = parsePositiveLineaAmountWei(normalized);
    if (!amountWei) {
      notify("Invalid withdraw amount.", "warning");
      return;
    }
    if (embeddedTokenBalance?.value != null && amountWei > embeddedTokenBalance.value) {
      notify("Insufficient LINEA balance.", "warning");
      return;
    }
    if (walletTransferInFlightRef.current) return;
    walletTransferInFlightRef.current = true;

    setIsWithdrawing(true);
    try {
      notify("Preparing LINEA withdraw. Confirm the wallet prompt if it appears.", "info");
      const hash = await writeContractAsync({
        address: LINEA_TOKEN_ADDRESS,
        abi: TOKEN_ABI,
        functionName: "transfer",
        args: [getAddress(externalWalletAddress), amountWei],
        chainId: APP_CHAIN_ID,
      });
      const receiptState = await waitForReceipt(hash);
      if (receiptState === "pending") {
        notify(formatTxStatusMessage("LINEA withdraw submitted and is still pending confirmation.", hash), "info");
        return;
      }
      setWithdrawAmount("0.0");
      void refetchEmbeddedTokenBalance();
      notify(formatTxStatusMessage("LINEA sent to your external wallet.", hash), "success");
    } catch (err) {
      if (!isUserRejection(err)) {
        log.error("Withdraw", "failed", err);
        notify("Withdraw failed. Check your balance and try again.", "danger");
      } else {
        notify("LINEA withdraw rejected in wallet.", "info");
      }
    } finally {
      walletTransferInFlightRef.current = false;
      setIsWithdrawing(false);
    }
  }, [embeddedTokenBalance, externalWalletAddress, formatTxStatusMessage, notify, refetchEmbeddedTokenBalance, waitForReceipt, withdrawAmount, writeContractAsync]);

  const handleWithdrawEthToExternal = useCallback(async () => {
    if (!embeddedWalletAddress) {
      notify("Create a Privy wallet first.", "warning");
      onOpenWalletSettings();
      return;
    }
    if (!externalWalletAddress) {
      notify("External wallet is not connected.", "warning");
      return;
    }
    if (!sendTransactionSilent) {
      notify("Privy wallet is not ready yet.", "warning");
      return;
    }
    const normalized = normalizeDecimalInput(withdrawEthAmount);
    const amountWei = parsePositiveLineaAmountWei(normalized);
    if (!amountWei) {
      notify("Invalid ETH withdraw amount.", "warning");
      return;
    }
    if (embeddedEthBalance?.value != null) {
      if (amountWei > embeddedEthBalance.value) {
        notify("Insufficient ETH balance.", "warning");
        return;
      }
      const spendableWei =
        embeddedEthBalance.value > minEthWithdrawReserveWei
          ? embeddedEthBalance.value - minEthWithdrawReserveWei
          : 0n;
      if (amountWei > spendableWei) {
        notify(`Keep at least ${minEthForGas} ETH in the Privy wallet for gas.`, "warning");
        return;
      }
    }
    if (walletTransferInFlightRef.current) return;
    walletTransferInFlightRef.current = true;

    setIsWithdrawingEth(true);
    try {
      notify("Preparing ETH withdraw from the Privy wallet.", "info");
      const hash = await sendTransactionSilent({
        to: getAddress(externalWalletAddress),
        value: amountWei,
      });
      const receiptState = await waitForReceipt(hash);
      if (receiptState === "pending") {
        notify(formatTxStatusMessage("ETH withdraw submitted and is still pending confirmation.", hash), "info");
        return;
      }
      setWithdrawEthAmount("0.0");
      void refetchEmbeddedEthBalance();
      notify(formatTxStatusMessage("ETH sent to your external wallet.", hash), "success");
    } catch (err) {
      if (!isUserRejection(err)) {
        log.error("Withdraw", "ETH withdraw failed", err);
        const message = err instanceof Error ? err.message : "";
        notify(message ? `ETH withdraw failed: ${message}` : "ETH withdraw failed. Check your balance and try again.", "danger");
      } else {
        notify("ETH withdraw rejected in wallet.", "info");
      }
    } finally {
      walletTransferInFlightRef.current = false;
      setIsWithdrawingEth(false);
    }
  }, [
    embeddedEthBalance,
    embeddedWalletAddress,
    externalWalletAddress,
    formatTxStatusMessage,
    minEthForGas,
    minEthWithdrawReserveWei,
    notify,
    onOpenWalletSettings,
    refetchEmbeddedEthBalance,
    sendTransactionSilent,
    waitForReceipt,
    withdrawEthAmount,
  ]);

  const handleDepositEthToEmbedded = useCallback(async () => {
    if (!embeddedWalletAddress) {
      notify("Create a Privy wallet first.", "warning");
      onOpenWalletSettings();
      return;
    }
    if (!externalWalletAddress) {
      notify("Connect an external wallet first.", "warning");
      return;
    }
    const normalized = normalizeDecimalInput(depositEthAmount);
    const value = parsePositiveLineaAmountWei(normalized);
    if (!value) {
      notify("Invalid ETH amount.", "warning");
      return;
    }
    if (walletTransferInFlightRef.current) return;
    walletTransferInFlightRef.current = true;

    try {
      setIsDepositingEth(true);
      notify("Preparing ETH top-up. Confirm the wallet prompt if it appears.", "info");
      const hash = await sendTransactionFromExternal({
        to: getAddress(embeddedWalletAddress),
        value,
      });
      const receiptState = await waitForReceipt(hash);
      if (receiptState === "pending") {
        notify(formatTxStatusMessage("ETH transfer submitted and is still pending confirmation.", hash), "info");
        return;
      }
      void refetchEmbeddedEthBalance();
      notify(formatTxStatusMessage("ETH transfer to the Privy wallet was sent.", hash), "success");
    } catch (err) {
      if (!isUserRejection(err)) {
        log.error("Deposit", "ETH transfer to Privy failed", err);
        const message = err instanceof Error ? err.message : "";
        notify(message ? `ETH transfer failed: ${message}` : "ETH transfer failed. Check wallet balance and try again.", "danger");
      } else {
        notify("ETH top-up rejected in wallet.", "info");
      }
    } finally {
      walletTransferInFlightRef.current = false;
      setIsDepositingEth(false);
    }
  }, [
    depositEthAmount,
    embeddedWalletAddress,
    externalWalletAddress,
    formatTxStatusMessage,
    notify,
    onOpenWalletSettings,
    refetchEmbeddedEthBalance,
    sendTransactionFromExternal,
    waitForReceipt,
  ]);

  const handleDepositTokenToEmbedded = useCallback(async () => {
    if (!embeddedWalletAddress) {
      notify("Create a Privy wallet first.", "warning");
      onOpenWalletSettings();
      return;
    }
    if (!externalWalletAddress) {
      notify("Connect an external wallet first.", "warning");
      return;
    }
    const normalized = normalizeDecimalInput(depositTokenAmount);
    const amountWei = parsePositiveLineaAmountWei(normalized);
    if (!amountWei) {
      notify("Invalid LINEA amount.", "warning");
      return;
    }
    if (walletTransferInFlightRef.current) return;
    walletTransferInFlightRef.current = true;

    try {
      if (publicClient) {
        const externalTokenBalance = await publicClient.readContract({
          address: LINEA_TOKEN_ADDRESS,
          abi: TOKEN_ABI,
          functionName: "balanceOf",
          args: [getAddress(externalWalletAddress)],
        });
        if (amountWei > externalTokenBalance) {
          notify("Insufficient LINEA balance in external wallet.", "warning");
          return;
        }
      }
      const data = encodeFunctionData({
        abi: TOKEN_ABI,
        functionName: "transfer",
        args: [getAddress(embeddedWalletAddress), amountWei],
      });
      setIsDepositingToken(true);
      notify("Preparing LINEA deposit. Confirm the wallet prompt if it appears.", "info");
      const hash = await sendTransactionFromExternal({
        to: LINEA_TOKEN_ADDRESS,
        data,
      });
      const receiptState = await waitForReceipt(hash);
      if (receiptState === "pending") {
        notify(formatTxStatusMessage("LINEA transfer submitted and is still pending confirmation.", hash), "info");
        return;
      }
      void refetchEmbeddedTokenBalance();
      if (walletTransfersEnabled && fetchWalletTransfers) {
        void fetchWalletTransfers();
      }
      notify(formatTxStatusMessage("LINEA transfer to the Privy wallet was sent.", hash), "success");
    } catch (err) {
      if (!isUserRejection(err)) {
        log.error("Deposit", "LINEA transfer to Privy failed", err);
        notify(formatWalletTransferFailure(err, "LINEA"), "danger");
      } else {
        notify("LINEA deposit rejected in wallet.", "info");
      }
    } finally {
      walletTransferInFlightRef.current = false;
      setIsDepositingToken(false);
    }
  }, [
    depositTokenAmount,
    embeddedWalletAddress,
    externalWalletAddress,
    fetchWalletTransfers,
    formatTxStatusMessage,
    notify,
    onOpenWalletSettings,
    publicClient,
    refetchEmbeddedTokenBalance,
    sendTransactionFromExternal,
    waitForReceipt,
    walletTransfersEnabled,
  ]);

  const handleClearEip7702Delegation = useCallback(async () => {
    if (!embeddedWalletAddress) {
      notify("Create a Privy wallet first.", "warning");
      onOpenWalletSettings();
      return;
    }
    if (!clearEip7702DelegationFromExternal) {
      notify("Wallet repair is not ready yet. Reload the page and try again.", "warning");
      return;
    }

    setIsClearingEip7702Delegation(true);
    try {
      const hash = await clearEip7702DelegationFromExternal();
      const receiptState = await waitForReceipt(hash);
      if (receiptState === "pending") {
        notify(formatTxStatusMessage("Privy wallet repair submitted and is still pending confirmation.", hash), "info");
        return;
      }
      const remainingDelegateAddress = await refreshEmbeddedWalletCode?.();
      if (remainingDelegateAddress) {
        notify("Repair transaction confirmed, but old EIP-7702 delegation is still active. Send the repair tx hash from logs.", "danger");
        return;
      }
      void refetchEmbeddedEthBalance();
      notify(formatTxStatusMessage("Privy wallet repaired. ETH top-up should now use normal transfers.", hash), "success");
    } catch (err) {
      if (!isUserRejection(err)) {
        log.error("Wallet", "clear 7702 delegation failed", err);
        const message = err instanceof Error ? err.message : "";
        notify(message ? `Privy wallet repair failed: ${message}` : "Privy wallet repair failed. Try again from the external wallet.", "danger");
      }
    } finally {
      setIsClearingEip7702Delegation(false);
    }
  }, [
    clearEip7702DelegationFromExternal,
    embeddedWalletAddress,
    formatTxStatusMessage,
    notify,
    onOpenWalletSettings,
    refetchEmbeddedEthBalance,
    refreshEmbeddedWalletCode,
    waitForReceipt,
  ]);

  return useMemo(
    () => ({
      withdrawAmount,
      setWithdrawAmount,
      withdrawEthAmount,
      setWithdrawEthAmount,
      depositEthAmount,
      setDepositEthAmount,
      depositTokenAmount,
      setDepositTokenAmount,
      isWithdrawing,
      isWithdrawingEth,
      isDepositingEth,
      isDepositingToken,
      isClearingEip7702Delegation,
      pendingTransactionStatus,
      isRefreshingPendingTx,
      isCancellingPendingTx,
      connectedResolverRewards,
      connectedResolverRewardsWei,
      embeddedResolverRewards,
      embeddedResolverRewardsWei,
      isClaimingConnectedResolverRewards,
      isClaimingEmbeddedResolverRewards,
      handleWithdrawToExternal,
      handleWithdrawEthToExternal,
      handleDepositEthToEmbedded,
      handleDepositTokenToEmbedded,
      handleClearEip7702Delegation,
      refreshPendingTransactionStatus,
      cancelPendingTransaction,
      handleClaimConnectedResolverRewards,
      handleClaimEmbeddedResolverRewards,
    }),
    [
      withdrawAmount,
      withdrawEthAmount,
      depositEthAmount,
      depositTokenAmount,
      isWithdrawing,
      isWithdrawingEth,
      isDepositingEth,
      isDepositingToken,
      isClearingEip7702Delegation,
      pendingTransactionStatus,
      isRefreshingPendingTx,
      isCancellingPendingTx,
      connectedResolverRewards,
      connectedResolverRewardsWei,
      embeddedResolverRewards,
      embeddedResolverRewardsWei,
      isClaimingConnectedResolverRewards,
      isClaimingEmbeddedResolverRewards,
      handleWithdrawToExternal,
      handleWithdrawEthToExternal,
      handleDepositEthToEmbedded,
      handleDepositTokenToEmbedded,
      handleClearEip7702Delegation,
      refreshPendingTransactionStatus,
      cancelPendingTransaction,
      handleClaimConnectedResolverRewards,
      handleClaimEmbeddedResolverRewards,
    ],
  );
}
