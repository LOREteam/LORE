"use client";

import { useCallback, useMemo, useState } from "react";
import { encodeFunctionData, formatUnits, getAddress, parseUnits } from "viem";
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
import { withMiningRpcTimeout } from "./useMining.shared";

type NotifyFn = (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
type SilentSendFn = (
  tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint; nonce?: number; feeMode?: "normal" | "keeper" },
  gasOverrides?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasPrice?: bigint },
) => Promise<`0x${string}`>;
type ExternalSendFn = (tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint }) => Promise<`0x${string}`>;
type WriteContractAsyncFn = ReturnType<typeof useWriteContract>["writeContractAsync"];
type BalanceData = { value: bigint } | null | undefined;
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
  publicClient?: PublicClient;
  refetchEmbeddedEthBalance: () => Promise<unknown> | unknown;
  refetchEmbeddedTokenBalance: () => Promise<unknown> | unknown;
  walletTransfersEnabled: boolean;
  fetchWalletTransfers?: () => Promise<void> | void;
  notify: NotifyFn;
  onOpenWalletSettings: () => void;
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
  publicClient,
  refetchEmbeddedEthBalance,
  refetchEmbeddedTokenBalance,
  walletTransfersEnabled,
  fetchWalletTransfers,
  notify,
  onOpenWalletSettings,
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
  const [pendingTransactionStatus, setPendingTransactionStatus] = useState<PendingTransactionStatus | null>(null);
  const [isRefreshingPendingTx, setIsRefreshingPendingTx] = useState(false);
  const [isCancellingPendingTx, setIsCancellingPendingTx] = useState(false);
  const [isClaimingConnectedResolverRewards, setIsClaimingConnectedResolverRewards] = useState(false);
  const [isClaimingEmbeddedResolverRewards, setIsClaimingEmbeddedResolverRewards] = useState(false);

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
      refetchInterval: 30_000,
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
      refetchInterval: 30_000,
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

  const waitForReceipt = useCallback(
    async (hash: `0x${string}`) => {
      if (!publicClient) return;
      try {
        await publicClient.waitForTransactionReceipt({ hash, timeout: TX_RECEIPT_TIMEOUT_MS });
      } catch {
        // The balance/read refresh below is enough when a public RPC lags.
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
      const gas = await estimateResolverRewardClaimGas(normalizedConnectedWalletAddress);
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "claimResolverRewards",
        chainId: APP_CHAIN_ID,
        gas,
      });
      await waitForReceipt(hash);
      refreshResolverRewardReads();
      notify("Resolver rewards claimed to the connected wallet.", "success");
    } catch (err) {
      if (!isUserRejection(err)) {
        log.error("ResolverRewards", "connected claim failed", err);
        const message = err instanceof Error ? err.message : "";
        notify(
          message ? `Resolver reward claim failed: ${message}` : "Resolver reward claim failed.",
          "danger",
        );
      }
    } finally {
      setIsClaimingConnectedResolverRewards(false);
    }
  }, [
    connectedResolverRewardsWei,
    estimateResolverRewardClaimGas,
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
      await waitForReceipt(hash);
      refreshResolverRewardReads();
      notify("Resolver rewards claimed to the Privy wallet.", "success");
    } catch (err) {
      if (!isUserRejection(err)) {
        log.error("ResolverRewards", "embedded claim failed", err);
        const message = err instanceof Error ? err.message : "";
        notify(
          message ? `Resolver reward claim failed: ${message}` : "Resolver reward claim failed.",
          "danger",
        );
      }
    } finally {
      setIsClaimingEmbeddedResolverRewards(false);
    }
  }, [
    embeddedResolverRewardsWei,
    estimateResolverRewardClaimGas,
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
    if (!normalized || isNaN(Number(normalized)) || Number(normalized) <= 0) {
      notify("Invalid withdraw amount.", "warning");
      return;
    }
    const amountWei = parseUnits(normalized, 18);
    if (embeddedTokenBalance?.value != null && amountWei > embeddedTokenBalance.value) {
      notify("Insufficient LINEA balance.", "warning");
      return;
    }

    setIsWithdrawing(true);
    try {
      await writeContractAsync({
        address: LINEA_TOKEN_ADDRESS,
        abi: TOKEN_ABI,
        functionName: "transfer",
        args: [getAddress(externalWalletAddress), amountWei],
        chainId: APP_CHAIN_ID,
      });
      setWithdrawAmount("0.0");
      notify("LINEA sent to your external wallet.", "success");
    } catch (err) {
      if (!isUserRejection(err)) {
        log.error("Withdraw", "failed", err);
        notify("Withdraw failed. Check your balance and try again.", "danger");
      }
    } finally {
      setIsWithdrawing(false);
    }
  }, [embeddedTokenBalance, externalWalletAddress, notify, withdrawAmount, writeContractAsync]);

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
    if (!normalized || isNaN(Number(normalized)) || Number(normalized) <= 0) {
      notify("Invalid ETH withdraw amount.", "warning");
      return;
    }
    const amountWei = parseUnits(normalized, 18);
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

    setIsWithdrawingEth(true);
    try {
      const hash = await sendTransactionSilent({
        to: getAddress(externalWalletAddress),
        value: amountWei,
      });
      try {
        if (publicClient) {
          await publicClient.waitForTransactionReceipt({ hash, timeout: TX_RECEIPT_TIMEOUT_MS });
        }
      } catch {
        // Balance refresh below is enough if receipt polling times out on a public RPC.
      }
      setWithdrawEthAmount("0.0");
      void refetchEmbeddedEthBalance();
      notify("ETH sent to your external wallet.", "success");
    } catch (err) {
      if (!isUserRejection(err)) {
        log.error("Withdraw", "ETH withdraw failed", err);
        const message = err instanceof Error ? err.message : "";
        notify(message ? `ETH withdraw failed: ${message}` : "ETH withdraw failed. Check your balance and try again.", "danger");
      }
    } finally {
      setIsWithdrawingEth(false);
    }
  }, [
    embeddedEthBalance,
    embeddedWalletAddress,
    externalWalletAddress,
    minEthForGas,
    minEthWithdrawReserveWei,
    notify,
    onOpenWalletSettings,
    publicClient,
    refetchEmbeddedEthBalance,
    sendTransactionSilent,
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
    if (!normalized || isNaN(Number(normalized)) || Number(normalized) <= 0) {
      notify("Invalid ETH amount.", "warning");
      return;
    }

    try {
      const value = parseUnits(normalized, 18);
      setIsDepositingEth(true);
      await sendTransactionFromExternal({
        to: getAddress(embeddedWalletAddress),
        value,
      });
      void refetchEmbeddedEthBalance();
      notify("ETH transfer to the Privy wallet was sent.", "success");
    } catch (err) {
      if (!isUserRejection(err)) {
        log.error("Deposit", "ETH transfer to Privy failed", err);
        const message = err instanceof Error ? err.message : "";
        notify(message ? `ETH transfer failed: ${message}` : "ETH transfer failed. Check wallet balance and try again.", "danger");
      }
    } finally {
      setIsDepositingEth(false);
    }
  }, [
    depositEthAmount,
    embeddedWalletAddress,
    externalWalletAddress,
    notify,
    onOpenWalletSettings,
    refetchEmbeddedEthBalance,
    sendTransactionFromExternal,
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
    if (!normalized || isNaN(Number(normalized)) || Number(normalized) <= 0) {
      notify("Invalid LINEA amount.", "warning");
      return;
    }

    try {
      const amountWei = parseUnits(normalized, 18);
      const data = encodeFunctionData({
        abi: TOKEN_ABI,
        functionName: "transfer",
        args: [getAddress(embeddedWalletAddress), amountWei],
      });
      setIsDepositingToken(true);
      await sendTransactionFromExternal({
        to: LINEA_TOKEN_ADDRESS,
        data,
      });
      void refetchEmbeddedTokenBalance();
      if (walletTransfersEnabled && fetchWalletTransfers) {
        void fetchWalletTransfers();
      }
      notify("LINEA transfer to the Privy wallet was sent.", "success");
    } catch (err) {
      if (!isUserRejection(err)) {
        log.error("Deposit", "LINEA transfer to Privy failed", err);
        const message = err instanceof Error ? err.message : "";
        notify(message ? `LINEA transfer failed: ${message}` : "LINEA transfer failed. Check wallet balance and try again.", "danger");
      }
    } finally {
      setIsDepositingToken(false);
    }
  }, [
    depositTokenAmount,
    embeddedWalletAddress,
    externalWalletAddress,
    fetchWalletTransfers,
    notify,
    onOpenWalletSettings,
    refetchEmbeddedTokenBalance,
    sendTransactionFromExternal,
    walletTransfersEnabled,
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
      refreshPendingTransactionStatus,
      cancelPendingTransaction,
      handleClaimConnectedResolverRewards,
      handleClaimEmbeddedResolverRewards,
    ],
  );
}
