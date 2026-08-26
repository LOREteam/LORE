"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { createPublicClient, encodeFunctionData, getAddress, http } from "viem";
import type { PublicClient } from "viem";
import { useReadContract } from "wagmi";
import type { useWriteContract } from "wagmi";
import { getStableLineaReadRpcs } from "../../config/publicConfig";
import { formatBalanceFixed } from "../lib/balanceFormatting";
import {
  APP_CHAIN,
  APP_CHAIN_ID,
  APP_CHAIN_NAME,
  APP_NETWORK,
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
import { withClaimTransactionIntentLease } from "../lib/claimTransactionIntent";
import {
  createWalletContractIntent,
  createWalletRepairIntent,
  createWalletTransferIntent,
  getWalletTransferIntentErrorHash,
  isWalletTransferIntentError,
  reconcileWalletTransferReplacementCandidate,
  resolveWalletTransferIntent,
  selectWalletTransferAgreementRpcUrls,
  waitForWalletTransferIntentReceipt,
  withWalletTransferRepairIntentLease,
  WalletTransferIntentError,
  WalletTransactionRevertedError,
  type WalletContractIntentDetails,
  type WalletTransferIntent,
  type WalletTransferIntentDetails,
  type WalletTransferReceiptClient,
  hasTrackedWalletTransferNonce,
} from "../lib/walletTransferIntent";
import { isSafeExternalWalletProviderContextError } from "../lib/externalWalletProviderContext";
import { hasTrackedMiningNonce } from "../lib/miningTxPath";
import {
  isAmbiguousPendingTxError,
  isSessionExpiredError,
  isWalletUnavailableError,
  isWrongNetworkError,
  withMiningRpcTimeout,
} from "./useMining.shared";

type NotifyFn = (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
type SilentSendFn = (
  tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint; nonce?: number; feeMode?: "normal" | "keeper"; transferIntent?: WalletTransferIntentDetails; contractIntent?: WalletContractIntentDetails },
  gasOverrides?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasPrice?: bigint },
) => Promise<`0x${string}`>;
type ExternalSendFn = (tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint; expectedActor?: `0x${string}`; transferIntent?: WalletTransferIntentDetails; contractIntent?: WalletContractIntentDetails }) => Promise<`0x${string}`>;
type WriteContractAsyncFn = ReturnType<typeof useWriteContract>["writeContractAsync"];
type BalanceData = { value: bigint } | null | undefined;
type PendingTransactionNonceClient = {
  getTransactionCount: (args: {
    address: `0x${string}`;
    blockTag: "latest" | "pending";
  }) => Promise<unknown>;
};
type WalletTransferAgreementClient = WalletTransferReceiptClient &
  PendingTransactionNonceClient & {
    canonicalHost: string;
  };
type WalletTransferAgreementClients = readonly [
  WalletTransferAgreementClient,
  WalletTransferAgreementClient,
];

const RESOLVER_REWARD_LARGE_DISPLAY_WEI = 100n * 10n ** 18n;
const TOKEN_TRANSFER_GAS_LIMIT = 120_000n;

function createWalletTransferReceiptClients(): WalletTransferAgreementClients | null {
  const configuredRpcs = APP_NETWORK === "mainnet"
    ? process.env.NEXT_PUBLIC_LINEA_RPCS
    : process.env.NEXT_PUBLIC_LINEA_SEPOLIA_RPCS;
  try {
    const urls = selectWalletTransferAgreementRpcUrls(
      getStableLineaReadRpcs(configuredRpcs, APP_NETWORK),
    );
    return [
      Object.assign(
        createPublicClient({ chain: APP_CHAIN, transport: http(urls[0]) }),
        { canonicalHost: new URL(urls[0]).host.toLowerCase() },
      ),
      Object.assign(
        createPublicClient({ chain: APP_CHAIN, transport: http(urls[1]) }),
        { canonicalHost: new URL(urls[1]).host.toLowerCase() },
      ),
    ];
  } catch {
    return null;
  }
}

const WALLET_TRANSFER_RECEIPT_CLIENTS = createWalletTransferReceiptClients();

function formatWalletTransferFailure(error: unknown, asset: "ETH" | "LINEA") {
  const message = error instanceof Error ? error.message : "";
  if (isSafeExternalWalletProviderContextError(error)) {
    if (error.code === "wallet_transfer_intent_external_chain_changed") {
      return `${asset} transfer was not submitted because the external wallet changed networks. Switch to ${APP_CHAIN_NAME} and retry.`;
    }
    if (error.code === "wallet_transfer_intent_external_account_unavailable") {
      return `${asset} transfer was not submitted because no external wallet account is selected. Select an account and retry.`;
    }
  }
  if (message.includes("wallet_transfer_intent_actor_changed")) {
    return `${asset} transfer was not submitted because the selected external account changed. Review the account and retry.`;
  }
  if (message.includes("wallet_transfer_transaction_missing_manual_reconciliation")) {
    return `${asset} transfer hash is missing from both RPCs. Do not retry automatically; manual nonce reconciliation is required.`;
  }
  if (message.includes("wallet_transfer_transaction_")) {
    return `${asset} transfer transaction details do not match the approved request across both RPCs. Do not retry automatically; manual transaction reconciliation is required.`;
  }
  if (message.includes("wallet_transfer_replacement_")) {
    return `${asset} transfer was replaced, but both RPCs did not prove an exact gas-only reprice. Do not retry automatically; manual transaction reconciliation is required.`;
  }
  if (message.includes("wallet_transfer_intent_resolution_mismatch")) {
    return `${asset} transfer receipt was verified, but its local safety intent could not be cleared. Do not retry until storage reconciliation succeeds.`;
  }
  if (isWalletTransferIntentError(error)) {
    return `${asset} transfer is still unresolved. Check wallet activity and the latest/pending nonce status before retrying.`;
  }
  if (/\btimed out\b|\btimeout\b/i.test(message)) {
    return `${asset} transfer status is unknown after a wallet timeout. Check wallet activity before retrying.`;
  }
  if (isAmbiguousPendingTxError(error)) {
    return `${asset} transfer may already be pending. Check wallet activity before retrying.`;
  }
  if (isWrongNetworkError(error)) {
    return `${asset} transfer failed: wallet is on the wrong network. Switch to ${APP_CHAIN_NAME} and retry.`;
  }
  if (isSessionExpiredError(error)) {
    return `${asset} transfer failed: wallet session expired. Log in again and retry.`;
  }
  if (isWalletUnavailableError(error)) {
    return `${asset} transfer failed: wallet is not ready. Reconnect the wallet and retry.`;
  }
  if (/\brevert(?:ed)?\b|execution reverted/i.test(message)) {
    return `${asset} transfer reverted on-chain. Funds were not moved.`;
  }
  if (/transaction gas limit cap exceeded/i.test(message)) {
    return `${asset} transfer was rejected before submission. Check the amount and try again.`;
  }
  if (/insufficient funds|not enough (?:eth|funds)|exceeds balance/i.test(message)) {
    return `${asset} transfer failed: not enough balance or ETH for gas.`;
  }
  if (/rpc|provider|infura|alchemy|sendrawtransaction|sendtransaction|json-rpc/i.test(message)) {
    return `${asset} transfer could not be submitted through the wallet provider. Check wallet activity before retrying.`;
  }
  return `${asset} transfer failed. Check wallet balance and try again.`;
}

function formatWalletActionFailure(error: unknown, action: string, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("pending_tx_repair_tracked_nonce")) {
    return "This nonce belongs to a tracked transfer, bet, or approval. Reconcile that transaction instead of replacing it.";
  }
  if (/\btimed out\b|\btimeout\b/i.test(message)) {
    return `${action} status is unknown after a wallet timeout. Check wallet activity before retrying.`;
  }
  if (isAmbiguousPendingTxError(error)) {
    return `${action} may already be pending. Check wallet activity before retrying.`;
  }
  if (isWrongNetworkError(error)) {
    return `${action} failed: wallet is on the wrong network. Switch to ${APP_CHAIN_NAME} and retry.`;
  }
  if (isSessionExpiredError(error)) {
    return `${action} failed: wallet session expired. Log in again and retry.`;
  }
  if (isWalletUnavailableError(error)) {
    return `${action} failed: wallet is not ready. Reconnect the wallet and retry.`;
  }
  if (/\brevert(?:ed)?\b|execution reverted/i.test(message)) {
    return `${action} reverted on-chain. No funds were moved by this action.`;
  }
  if (/insufficient funds|not enough (?:eth|funds)|exceeds balance/i.test(message)) {
    return `${action} failed: not enough balance or ETH for gas.`;
  }
  if (/rpc|provider|infura|alchemy|sendrawtransaction|sendtransaction|json-rpc/i.test(message)) {
    return `${action} could not be submitted through the wallet provider. Check wallet activity before retrying.`;
  }
  if (isWalletTransferIntentError(error)) {
    return `${action} is still unresolved. Check wallet activity and the latest/pending nonce status before retrying.`;
  }
  return fallback;
}

function normalizePendingTransactionNonce(value: unknown): number | null {
  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(value);
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return null;
  }
  return value;
}

function isNonceAlreadyConsumedError(error: unknown) {
  const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  return message.includes("nonce too low") || message.includes("lower than the current nonce");
}

function getIndependentPendingTransactionNonceClients(
  clients: WalletTransferAgreementClients | undefined,
): WalletTransferAgreementClients | null {
  if (
    !clients ||
    clients[0] === clients[1] ||
    !clients[0].canonicalHost ||
    clients[0].canonicalHost === clients[1].canonicalHost
  ) {
    return null;
  }
  const first = clients[0] as Partial<PendingTransactionNonceClient>;
  const second = clients[1] as Partial<PendingTransactionNonceClient>;
  if (
    typeof first.getTransactionCount !== "function" ||
    typeof second.getTransactionCount !== "function"
  ) {
    return null;
  }
  return clients;
}

export function assertPendingTxRepairNonceIsUntracked(
  chainId: number,
  actor: string,
  nonce: number,
) {
  if (
    hasTrackedWalletTransferNonce(chainId, actor, nonce) ||
    hasTrackedMiningNonce(chainId, actor, nonce)
  ) {
    throw new Error("pending_tx_repair_tracked_nonce");
  }
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
  walletTransferReceiptClients?: WalletTransferAgreementClients;
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
  isPageVisible = true,
  minEthForGas,
  minEthWithdrawReserveWei,
  walletTransferReceiptClients = WALLET_TRANSFER_RECEIPT_CLIENTS ?? undefined,
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
  const pendingTxRepairInFlightRef = useRef(false);
  const resolverClaimInFlightRef = useRef(false);
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
  const activeConnectedResolverAddressRef = useRef<string | null>(
    normalizedConnectedWalletAddress?.toLowerCase() ?? null,
  );
  activeConnectedResolverAddressRef.current = normalizedConnectedWalletAddress?.toLowerCase() ?? null;
  const activeEmbeddedResolverAddressRef = useRef<string | null>(
    normalizedEmbeddedWalletAddress?.toLowerCase() ?? null,
  );
  activeEmbeddedResolverAddressRef.current = normalizedEmbeddedWalletAddress?.toLowerCase() ?? null;
  const activePendingRepairAddressRef = useRef<string | null>(
    normalizedEmbeddedWalletAddress?.toLowerCase() ?? null,
  );
  activePendingRepairAddressRef.current = normalizedEmbeddedWalletAddress?.toLowerCase() ?? null;

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
    if (value < 0n) return "0.0000";
    return formatBalanceFixed({ value, decimals: 18 }, value >= RESOLVER_REWARD_LARGE_DISPLAY_WEI ? 2 : 4) ?? "0.0000";
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

  const waitForTransferReceipt = useCallback(
    async (intent: WalletTransferIntent, hash: `0x${string}`) => {
      if (!walletTransferReceiptClients) {
        throw new WalletTransferIntentError(
          "wallet_transfer_receipt_independent_rpc_required",
          hash,
        );
      }
      return waitForWalletTransferIntentReceipt(
        walletTransferReceiptClients,
        intent,
        hash,
        TX_RECEIPT_TIMEOUT_MS,
      );
    },
    [walletTransferReceiptClients],
  );

  const resolveTransferIntent = useCallback(
    async (
      intent: WalletTransferIntent,
      hash: `0x${string}`,
      resolution: "confirmed" | "reverted",
    ) => {
      if (!walletTransferReceiptClients) {
        throw new WalletTransferIntentError(
          "wallet_transfer_receipt_independent_rpc_required",
          hash,
        );
      }
      return resolveWalletTransferIntent(
        intent,
        hash,
        resolution,
        walletTransferReceiptClients,
      );
    },
    [walletTransferReceiptClients],
  );

  const refreshPendingTransactionStatus = useCallback(async (replacementHash?: string) => {
    const candidateHash = replacementHash?.trim();
    if (candidateHash) {
      const allowedActors = [embeddedWalletAddress, externalWalletAddress]
        .filter((value): value is string => Boolean(value));
      if (!walletTransferReceiptClients || allowedActors.length === 0) {
        notify("Replacement verification requires the current wallet and two independent RPCs.", "warning");
        return null;
      }
      setIsRefreshingPendingTx(true);
      try {
        const recovery = await reconcileWalletTransferReplacementCandidate(
          walletTransferReceiptClients,
          allowedActors,
          candidateHash,
          TX_RECEIPT_TIMEOUT_MS,
        );
        if (recovery.status === "pending") {
          notify(
            formatTxStatusMessage(
              "The exact gas-only replacement was verified across both RPCs and remains pending finality.",
              recovery.hash,
            ),
            "warning",
          );
        } else {
          notify(
            formatTxStatusMessage(
              recovery.status === "confirmed"
                ? "The exact gas-only replacement was finalized and the blocked transfer was reconciled."
                : "The exact gas-only replacement reverted with finality; the blocked transfer was released for retry.",
              recovery.hash,
            ),
            recovery.status === "confirmed" ? "success" : "warning",
          );
        }
        return null;
      } catch (err) {
        log.warn("PendingTx", "replacement candidate reconciliation failed closed", err);
        notify(
          "Replacement hash was not accepted by both RPCs as the exact saved transfer. The original transfer remains blocked for manual review.",
          "warning",
        );
        return null;
      } finally {
        setIsRefreshingPendingTx(false);
      }
    }
    const nonceClients = getIndependentPendingTransactionNonceClients(
      walletTransferReceiptClients,
    );
    if (!embeddedWalletAddress || !nonceClients) {
      setPendingTransactionStatus(null);
      notify(
        "Pending transaction repair requires the Privy wallet and two independent RPCs.",
        "warning",
      );
      return null;
    }

    setIsRefreshingPendingTx(true);
    try {
      const walletAddress = getAddress(embeddedWalletAddress);
      const nonceEvidence = await Promise.all(
        nonceClients.map(async (client, index) => Promise.all([
          withMiningRpcTimeout(
            client.getTransactionCount({ address: walletAddress, blockTag: "latest" }),
            `settings.getTransactionCount.rpc${index + 1}.latest`,
          ),
          withMiningRpcTimeout(
            client.getTransactionCount({ address: walletAddress, blockTag: "pending" }),
            `settings.getTransactionCount.rpc${index + 1}.pending`,
          ),
        ])),
      );
      const normalizedEvidence = nonceEvidence.map(([latest, pending]) => ({
        latest: normalizePendingTransactionNonce(latest),
        pending: normalizePendingTransactionNonce(pending),
      }));
      const [firstEvidence, secondEvidence] = normalizedEvidence;
      if (
        firstEvidence.latest === null ||
        firstEvidence.pending === null ||
        secondEvidence.latest === null ||
        secondEvidence.pending === null ||
        firstEvidence.pending < firstEvidence.latest ||
        secondEvidence.pending < secondEvidence.latest
      ) {
        setPendingTransactionStatus(null);
        notify("Pending transaction nonce evidence is unavailable or unsafe. Wait for wallet/RPC recovery, then retry.", "warning");
        return null;
      }
      if (
        firstEvidence.latest !== secondEvidence.latest ||
        firstEvidence.pending !== secondEvidence.pending
      ) {
        setPendingTransactionStatus(null);
        notify(
          "The independent RPCs disagree about the pending nonce. Repair is disabled until they agree.",
          "warning",
        );
        return null;
      }
      const latestNonce = firstEvidence.latest;
      const pendingNonce = firstEvidence.pending;
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
      if (isWrongNetworkError(err)) {
        notify(`Could not inspect pending transactions: wallet is on the wrong network. Switch to ${APP_CHAIN_NAME} and retry.`, "warning");
      } else {
        notify("Could not inspect pending transactions right now.", "danger");
      }
      return null;
    } finally {
      setIsRefreshingPendingTx(false);
    }
  }, [embeddedWalletAddress, externalWalletAddress, formatTxStatusMessage, notify, walletTransferReceiptClients]);

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
    if (pendingTxRepairInFlightRef.current) {
      notify("Pending transaction repair is already in progress.", "info");
      return;
    }
    const repairActor = getAddress(embeddedWalletAddress).toLowerCase();
    const repairActorChangedError = new Error("pending_tx_repair_actor_changed");
    const assertPendingRepairActorActive = () => {
      if (activePendingRepairAddressRef.current !== repairActor) {
        notify("Pending transaction repair stopped because the Privy wallet changed.", "warning");
        return false;
      }
      return true;
    };

    pendingTxRepairInFlightRef.current = true;
    setIsCancellingPendingTx(true);
    let repairTxHash: `0x${string}` | null = null;
    try {
      const status = await refreshPendingTransactionStatus();
      if (!assertPendingRepairActorActive()) return;
      if (!status || status.nonceGap <= 0 || status.blockedNonce === null) {
        notify("No stuck pending transaction was found to cancel.", "info");
        return;
      }

      try {
        assertPendingTxRepairNonceIsUntracked(APP_CHAIN_ID, repairActor, status.blockedNonce);
      } catch {
        notify(
          "This nonce belongs to a tracked transfer, bet, or approval. Reconcile that transaction instead of replacing it.",
          "warning",
        );
        return;
      }
      const repairNonceClients = getIndependentPendingTransactionNonceClients(
        walletTransferReceiptClients,
      );
      if (!repairNonceClients) {
        notify("Pending transaction repair requires two independent RPCs.", "warning");
        return;
      }
      const repairIntent = createWalletRepairIntent({
        actor: repairActor,
        chainId: APP_CHAIN_ID,
      });

      const sendCancel = async (nonce: number) => {
        assertPendingTxRepairNonceIsUntracked(APP_CHAIN_ID, repairActor, nonce);
        let feeOverrides:
          | { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasPrice?: bigint }
          | undefined;
        try {
          const fees = await withMiningRpcTimeout(publicClient.estimateFeesPerGas(), "settings.estimateFeesPerGas");
          feeOverrides = getKeeperFeeOverrides(fees, APP_CHAIN_ID, 145n, 145n);
        } catch {
          feeOverrides = getFallbackFeeOverrides(APP_CHAIN_ID, "keeper");
        }

        return withWalletTransferRepairIntentLease(
          repairIntent,
          repairNonceClients,
          nonce,
          async (acquisition, retainResult) => {
            if (acquisition.status === "known-hash") return acquisition.hash;
            if (!assertPendingRepairActorActive()) throw repairActorChangedError;
            const retained = await retainResult(
              sendTransactionSilent(
                {
                  to: getAddress(embeddedWalletAddress),
                  data: "0x",
                  value: 0n,
                  gas: 21_000n,
                  nonce: acquisition.lease.nonce,
                  feeMode: "keeper",
                },
                feeOverrides,
              ).then((hash) => ({ hash })),
              acquisition.lease,
            );
            return retained.hash;
          },
          {
            // Only this sentinel is thrown before sendTransactionSilent is
            // invoked. Provider-classified rejection/network/session errors
            // can surface after the wallet sink was reached, so they must
            // retain the hashless intent until exact nonce evidence resolves it.
            abandonOnError: (error) => error === repairActorChangedError,
            abandonOnNonceAdvanceError: isNonceAlreadyConsumedError,
          },
        );
      };

      const targetNonce = status.blockedNonce;
      const hash = await sendCancel(targetNonce);
      repairTxHash = hash;

      let receiptState: Awaited<ReturnType<typeof waitForTransferReceipt>>;
      try {
        receiptState = await waitForTransferReceipt(repairIntent, hash);
      } catch (error) {
        if (error instanceof WalletTransactionRevertedError) {
          if (!await resolveTransferIntent(repairIntent, error.transactionHash, "reverted")) {
            throw new WalletTransferIntentError(
              "wallet_transfer_intent_resolution_mismatch",
              error.transactionHash,
            );
          }
          if (!assertPendingRepairActorActive()) return;
        }
        throw error;
      }
      if (receiptState.status === "pending") {
        if (!assertPendingRepairActorActive()) return;
        void refreshPendingTransactionStatus();
        notify(
          formatTxStatusMessage(
            `Pending transaction repair submitted for nonce ${targetNonce} and is still pending confirmation.`,
            hash,
          ),
          "warning",
        );
        return;
      }
      if (!await resolveTransferIntent(repairIntent, receiptState.hash, "confirmed")) {
        throw new WalletTransferIntentError(
          "wallet_transfer_intent_resolution_mismatch",
          receiptState.hash,
        );
      }
      if (!assertPendingRepairActorActive()) return;

      const refreshed = await refreshPendingTransactionStatus();
      if (!assertPendingRepairActorActive()) return;
      if (refreshed && refreshed.nonceGap > 0) {
        notify(formatTxStatusMessage(`Replaced blocked nonce ${targetNonce}. If more are queued, run clear again.`, hash), "warning");
      } else {
        notify(formatTxStatusMessage(`Stuck pending transaction cleared at nonce ${targetNonce}.`, hash), "success");
      }
    } catch (err) {
      if (err === repairActorChangedError) return;
      if (isNonceAlreadyConsumedError(err)) {
        const refreshed = await refreshPendingTransactionStatus();
        if (!assertPendingRepairActorActive()) return;
        if (!refreshed || refreshed.nonceGap <= 0 || refreshed.blockedNonce === null) {
          notify("The blocked nonce already advanced. No stuck pending transaction remains to clear.", "success");
        } else {
          notify(
            `The blocked nonce advanced to ${refreshed.blockedNonce}. Run clear again for the remaining queue.`,
            "warning",
          );
        }
        return;
      }
      if (!isUserRejection(err)) {
        log.error("PendingTx", "cancel failed", err);
        if (isAmbiguousPendingTxError(err) && repairTxHash) {
          notify(
            formatTxStatusMessage(
              "Pending transaction repair submitted and is still pending confirmation.",
              repairTxHash,
            ),
            "warning",
          );
        } else {
          notify(formatWalletActionFailure(err, "Pending transaction repair", "Could not clear pending transaction."), "danger");
        }
      } else {
        notify(
          "Pending transaction repair returned a rejection without a transaction hash. Its nonce remains blocked until exact reconciliation.",
          "warning",
        );
      }
    } finally {
      pendingTxRepairInFlightRef.current = false;
      setIsCancellingPendingTx(false);
    }
  }, [
    embeddedWalletAddress,
    notify,
    onOpenWalletSettings,
    publicClient,
    formatTxStatusMessage,
    refreshPendingTransactionStatus,
    sendTransactionSilent,
    waitForTransferReceipt,
    resolveTransferIntent,
    walletTransferReceiptClients,
  ]);

  const refreshResolverRewardReads = useCallback(() => {
    void refetchConnectedResolverRewards();
    void refetchEmbeddedResolverRewards();
  }, [refetchConnectedResolverRewards, refetchEmbeddedResolverRewards]);

  const estimateResolverRewardClaimGas = useCallback(
    async (account: `0x${string}`) => {
      if (!publicClient) throw new Error("Resolver reward claim simulation is unavailable.");
      await publicClient.simulateContract({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "claimResolverRewards",
        account,
      });
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
    if (resolverClaimInFlightRef.current) return;
    resolverClaimInFlightRef.current = true;
    const claimActor = normalizedConnectedWalletAddress.toLowerCase();
    let claimTxHash: `0x${string}` | null = null;
    let claimIntent: WalletTransferIntent | null = null;

    setIsClaimingConnectedResolverRewards(true);
    try {
      notify("Preparing resolver reward claim. Confirm the wallet prompt if it appears.", "info");
      const data = encodeFunctionData({
        abi: GAME_ABI,
        functionName: "claimResolverRewards",
      });
      const claimDescriptor = {
        actor: normalizedConnectedWalletAddress,
        chainId: APP_CHAIN_ID,
        contract: CONTRACT_ADDRESS,
        calldata: data,
      };
      claimIntent = createWalletContractIntent(claimDescriptor);
      const gas = await estimateResolverRewardClaimGas(normalizedConnectedWalletAddress);
      if (activeConnectedResolverAddressRef.current !== claimActor) return;
      const nonceClients = getIndependentPendingTransactionNonceClients(
        walletTransferReceiptClients,
      );
      if (!nonceClients) {
        throw new WalletTransferIntentError(
          "wallet_transfer_receipt_independent_rpc_required",
        );
      }
      const hash = await withClaimTransactionIntentLease(
        claimDescriptor,
        nonceClients,
        async (acquisition, retainResult) => {
          if (acquisition.status === "known-hash") return acquisition.hash;
          if (activeConnectedResolverAddressRef.current !== claimActor) {
            throw new WalletTransferIntentError("wallet_transfer_intent_actor_changed");
          }
          const retained = await retainResult(
            writeContractAsync({
              address: CONTRACT_ADDRESS,
              abi: GAME_ABI,
              functionName: "claimResolverRewards",
              chainId: APP_CHAIN_ID,
              account: normalizedConnectedWalletAddress,
              nonce: acquisition.lease.nonce,
              gas,
            }).then((walletHash) => ({ hash: walletHash })),
            acquisition.lease,
          );
          return retained.hash;
        },
        {
          abandonOnError: (error) =>
            isUserRejection(error) ||
            (error instanceof WalletTransferIntentError &&
              error.message === "wallet_transfer_intent_actor_changed"),
        },
      );
      claimTxHash = hash;
      const receiptState = await waitForTransferReceipt(claimIntent, hash);
      if (receiptState.status === "pending") {
        if (activeConnectedResolverAddressRef.current !== claimActor) return;
        notify(formatTxStatusMessage("Resolver reward claim submitted and is still pending confirmation.", hash), "info");
        refreshResolverRewardReads();
        return;
      }
      if (!await resolveTransferIntent(claimIntent, receiptState.hash, "confirmed")) {
        throw new WalletTransferIntentError(
          "wallet_transfer_intent_resolution_mismatch",
          receiptState.hash,
        );
      }
      if (activeConnectedResolverAddressRef.current !== claimActor) return;
      refreshResolverRewardReads();
      notify(formatTxStatusMessage("Resolver rewards claimed to the connected wallet.", hash), "success");
    } catch (err) {
      if (
        claimIntent &&
        claimTxHash &&
        err instanceof WalletTransactionRevertedError &&
        err.transactionHash === claimTxHash
      ) {
        try {
          if (!await resolveTransferIntent(claimIntent, claimTxHash, "reverted")) {
            throw new WalletTransferIntentError(
              "wallet_transfer_intent_resolution_mismatch",
              claimTxHash,
            );
          }
        } catch (resolutionError) {
          log.warn("ResolverRewards", "reverted connected claim intent remains conservatively blocked", resolutionError);
        }
      }
      if (activeConnectedResolverAddressRef.current !== claimActor) return;
      if (isAmbiguousPendingTxError(err)) {
        notify(
          claimTxHash
            ? formatTxStatusMessage("Resolver reward claim submitted and is still pending confirmation.", claimTxHash)
            : "Resolver reward claim may already be pending. Check wallet activity before retrying.",
          "warning",
        );
      } else if (!isUserRejection(err)) {
        log.error("ResolverRewards", "connected claim failed", err);
        notify(
          formatWalletActionFailure(err, "Resolver reward claim", "Resolver reward claim failed."),
          "danger",
        );
      } else {
        notify("Resolver reward claim rejected in wallet.", "info");
      }
    } finally {
      resolverClaimInFlightRef.current = false;
      setIsClaimingConnectedResolverRewards(false);
    }
  }, [
    connectedResolverRewardsWei,
    estimateResolverRewardClaimGas,
    formatTxStatusMessage,
    normalizedConnectedWalletAddress,
    notify,
    refreshResolverRewardReads,
    resolveTransferIntent,
    waitForTransferReceipt,
    walletTransferReceiptClients,
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
    if (resolverClaimInFlightRef.current) return;
    resolverClaimInFlightRef.current = true;
    const claimActor = normalizedEmbeddedWalletAddress.toLowerCase();
    let claimTxHash: `0x${string}` | null = null;
    let claimIntent: WalletTransferIntent | null = null;

    setIsClaimingEmbeddedResolverRewards(true);
    try {
      notify("Preparing resolver reward claim.", "info");
      const data = encodeFunctionData({
        abi: GAME_ABI,
        functionName: "claimResolverRewards",
      });
      claimIntent = createWalletContractIntent({
        actor: normalizedEmbeddedWalletAddress,
        chainId: APP_CHAIN_ID,
        contract: CONTRACT_ADDRESS,
        calldata: data,
      });
      const gas = await estimateResolverRewardClaimGas(normalizedEmbeddedWalletAddress);
      if (activeEmbeddedResolverAddressRef.current !== claimActor) return;
      const hash = await sendTransactionSilent({
        to: CONTRACT_ADDRESS,
        data,
        gas,
        contractIntent: { contract: CONTRACT_ADDRESS, calldata: data },
      });
      claimTxHash = hash;
      const receiptState = await waitForTransferReceipt(claimIntent, hash);
      if (receiptState.status === "pending") {
        if (activeEmbeddedResolverAddressRef.current !== claimActor) return;
        notify(formatTxStatusMessage("Resolver reward claim submitted and is still pending confirmation.", hash), "info");
        refreshResolverRewardReads();
        return;
      }
      if (!await resolveTransferIntent(claimIntent, receiptState.hash, "confirmed")) {
        throw new WalletTransferIntentError(
          "wallet_transfer_intent_resolution_mismatch",
          receiptState.hash,
        );
      }
      if (activeEmbeddedResolverAddressRef.current !== claimActor) return;
      refreshResolverRewardReads();
      notify(formatTxStatusMessage("Resolver rewards claimed to the Privy wallet.", hash), "success");
    } catch (err) {
      if (
        claimIntent &&
        claimTxHash &&
        err instanceof WalletTransactionRevertedError &&
        err.transactionHash === claimTxHash
      ) {
        try {
          if (!await resolveTransferIntent(claimIntent, claimTxHash, "reverted")) {
            throw new WalletTransferIntentError(
              "wallet_transfer_intent_resolution_mismatch",
              claimTxHash,
            );
          }
        } catch (resolutionError) {
          log.warn("ResolverRewards", "reverted embedded claim intent remains conservatively blocked", resolutionError);
        }
      }
      if (activeEmbeddedResolverAddressRef.current !== claimActor) return;
      if (isAmbiguousPendingTxError(err)) {
        notify(
          claimTxHash
            ? formatTxStatusMessage("Resolver reward claim submitted and is still pending confirmation.", claimTxHash)
            : "Resolver reward claim may already be pending. Check wallet activity before retrying.",
          "warning",
        );
      } else if (!isUserRejection(err)) {
        log.error("ResolverRewards", "embedded claim failed", err);
        notify(
          formatWalletActionFailure(err, "Resolver reward claim", "Resolver reward claim failed."),
          "danger",
        );
      } else {
        notify("Resolver reward claim rejected in wallet.", "info");
      }
    } finally {
      resolverClaimInFlightRef.current = false;
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
    resolveTransferIntent,
    waitForTransferReceipt,
  ]);

  const handleWithdrawToExternal = useCallback(async () => {
    if (!embeddedWalletAddress) {
      notify("Create the Privy wallet first.", "warning");
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
    let transferTxHash: `0x${string}` | null = null;
    let transferIntent: WalletTransferIntent | null = null;

    setIsWithdrawing(true);
    try {
      transferIntent = createWalletTransferIntent({
        actor: embeddedWalletAddress,
        chainId: APP_CHAIN_ID,
        asset: LINEA_TOKEN_ADDRESS,
        destination: externalWalletAddress,
        amountWei,
      });
      const data = encodeFunctionData({
        abi: TOKEN_ABI,
        functionName: "transfer",
        args: [getAddress(externalWalletAddress), amountWei],
      });
      notify("Preparing LINEA withdraw.", "info");
      const hash = await sendTransactionSilent({
        to: LINEA_TOKEN_ADDRESS,
        data,
        gas: TOKEN_TRANSFER_GAS_LIMIT,
        transferIntent: {
          asset: LINEA_TOKEN_ADDRESS,
          destination: getAddress(externalWalletAddress),
          amountWei,
        },
      });
      transferTxHash = hash;
      const receiptState = await waitForTransferReceipt(transferIntent, hash);
      transferTxHash = receiptState.hash;
      if (receiptState.status === "pending") {
        notify(formatTxStatusMessage("LINEA withdraw submitted and is still pending confirmation.", receiptState.hash), "info");
        return;
      }
      if (!await resolveTransferIntent(transferIntent, receiptState.hash, "confirmed")) {
        throw new WalletTransferIntentError(
          "wallet_transfer_intent_resolution_mismatch",
          receiptState.hash,
        );
      }
      setWithdrawAmount("0.0");
      void refetchEmbeddedTokenBalance();
      notify(formatTxStatusMessage("LINEA sent to your external wallet.", receiptState.hash), "success");
    } catch (err) {
      const knownHash = err instanceof WalletTransactionRevertedError
        ? err.transactionHash
        : transferTxHash ?? getWalletTransferIntentErrorHash(err);
      if (
        transferIntent &&
        knownHash &&
        err instanceof WalletTransactionRevertedError &&
        err.transactionHash === knownHash
      ) {
        try {
          if (!await resolveTransferIntent(transferIntent, knownHash, "reverted")) {
            throw new WalletTransferIntentError(
              "wallet_transfer_intent_resolution_mismatch",
              knownHash,
            );
          }
        } catch (resolutionError) {
          log.warn("Withdraw", "reverted LINEA transfer intent remains conservatively blocked", resolutionError);
          notify(formatWalletTransferFailure(resolutionError, "LINEA"), "warning");
          return;
        }
      }
      if (!isUserRejection(err)) {
        log.error("Withdraw", "failed", err);
        if (knownHash && isWalletTransferIntentError(err)) {
          notify(formatTxStatusMessage(formatWalletTransferFailure(err, "LINEA"), knownHash), "warning");
        } else if (knownHash && isAmbiguousPendingTxError(err)) {
          notify(formatTxStatusMessage("LINEA withdraw submitted and is still pending confirmation.", knownHash), "warning");
        } else {
          notify(formatWalletTransferFailure(err, "LINEA"), isWalletTransferIntentError(err) ? "warning" : "danger");
        }
      } else {
        notify("LINEA withdraw rejected in wallet.", "info");
      }
    } finally {
      walletTransferInFlightRef.current = false;
      setIsWithdrawing(false);
    }
  }, [embeddedTokenBalance, embeddedWalletAddress, externalWalletAddress, formatTxStatusMessage, notify, onOpenWalletSettings, refetchEmbeddedTokenBalance, resolveTransferIntent, sendTransactionSilent, waitForTransferReceipt, withdrawAmount]);

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
    let transferTxHash: `0x${string}` | null = null;
    let transferIntent: WalletTransferIntent | null = null;

    setIsWithdrawingEth(true);
    try {
      transferIntent = createWalletTransferIntent({
        actor: embeddedWalletAddress,
        chainId: APP_CHAIN_ID,
        asset: "native",
        destination: externalWalletAddress,
        amountWei,
      });
      notify("Preparing ETH withdraw.", "info");
      const hash = await sendTransactionSilent({
        to: getAddress(externalWalletAddress),
        value: amountWei,
      });
      transferTxHash = hash;
      const receiptState = await waitForTransferReceipt(transferIntent, hash);
      transferTxHash = receiptState.hash;
      if (receiptState.status === "pending") {
        notify(formatTxStatusMessage("ETH withdraw submitted and is still pending confirmation.", receiptState.hash), "info");
        return;
      }
      if (!await resolveTransferIntent(transferIntent, receiptState.hash, "confirmed")) {
        throw new WalletTransferIntentError(
          "wallet_transfer_intent_resolution_mismatch",
          receiptState.hash,
        );
      }
      setWithdrawEthAmount("0.0");
      void refetchEmbeddedEthBalance();
      notify(formatTxStatusMessage("ETH sent to your external wallet.", receiptState.hash), "success");
    } catch (err) {
      const knownHash = err instanceof WalletTransactionRevertedError
        ? err.transactionHash
        : transferTxHash ?? getWalletTransferIntentErrorHash(err);
      if (
        transferIntent &&
        knownHash &&
        err instanceof WalletTransactionRevertedError &&
        err.transactionHash === knownHash
      ) {
        try {
          if (!await resolveTransferIntent(transferIntent, knownHash, "reverted")) {
            throw new WalletTransferIntentError(
              "wallet_transfer_intent_resolution_mismatch",
              knownHash,
            );
          }
        } catch (resolutionError) {
          log.warn("Withdraw", "reverted ETH transfer intent remains conservatively blocked", resolutionError);
          notify(formatWalletTransferFailure(resolutionError, "ETH"), "warning");
          return;
        }
      }
      if (!isUserRejection(err)) {
        log.error("Withdraw", "ETH withdraw failed", err);
        if (knownHash && isWalletTransferIntentError(err)) {
          notify(formatTxStatusMessage(formatWalletTransferFailure(err, "ETH"), knownHash), "warning");
        } else if (knownHash && isAmbiguousPendingTxError(err)) {
          notify(formatTxStatusMessage("ETH withdraw submitted and is still pending confirmation.", knownHash), "warning");
        } else {
          notify(formatWalletTransferFailure(err, "ETH"), isWalletTransferIntentError(err) ? "warning" : "danger");
        }
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
    resolveTransferIntent,
    sendTransactionSilent,
    waitForTransferReceipt,
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
    let transferTxHash: `0x${string}` | null = null;
    let transferIntent: WalletTransferIntent | null = null;

    try {
      transferIntent = createWalletTransferIntent({
        actor: externalWalletAddress,
        chainId: APP_CHAIN_ID,
        asset: "native",
        destination: embeddedWalletAddress,
        amountWei: value,
      });
      setIsDepositingEth(true);
      notify("Preparing ETH top-up. Confirm the wallet prompt if it appears.", "info");
      const hash = await sendTransactionFromExternal({
        to: getAddress(embeddedWalletAddress),
        value,
        expectedActor: getAddress(externalWalletAddress),
      });
      transferTxHash = hash;
      const receiptState = await waitForTransferReceipt(transferIntent, hash);
      transferTxHash = receiptState.hash;
      if (receiptState.status === "pending") {
        notify(formatTxStatusMessage("ETH transfer submitted and is still pending confirmation.", receiptState.hash), "info");
        return;
      }
      if (!await resolveTransferIntent(transferIntent, receiptState.hash, "confirmed")) {
        throw new WalletTransferIntentError(
          "wallet_transfer_intent_resolution_mismatch",
          receiptState.hash,
        );
      }
      void refetchEmbeddedEthBalance();
      notify(formatTxStatusMessage("ETH transfer to the Privy wallet was sent.", receiptState.hash), "success");
    } catch (err) {
      const knownHash = err instanceof WalletTransactionRevertedError
        ? err.transactionHash
        : transferTxHash ?? getWalletTransferIntentErrorHash(err);
      if (
        transferIntent &&
        knownHash &&
        err instanceof WalletTransactionRevertedError &&
        err.transactionHash === knownHash
      ) {
        try {
          if (!await resolveTransferIntent(transferIntent, knownHash, "reverted")) {
            throw new WalletTransferIntentError(
              "wallet_transfer_intent_resolution_mismatch",
              knownHash,
            );
          }
        } catch (resolutionError) {
          log.warn("Deposit", "reverted ETH transfer intent remains conservatively blocked", resolutionError);
          notify(formatWalletTransferFailure(resolutionError, "ETH"), "warning");
          return;
        }
      }
      if (!isUserRejection(err)) {
        log.error("Deposit", "ETH transfer to Privy failed", err);
        if (knownHash && isWalletTransferIntentError(err)) {
          notify(formatTxStatusMessage(formatWalletTransferFailure(err, "ETH"), knownHash), "warning");
        } else if (knownHash && isAmbiguousPendingTxError(err)) {
          notify(formatTxStatusMessage("ETH transfer submitted and is still pending confirmation.", knownHash), "warning");
        } else {
          notify(formatWalletTransferFailure(err, "ETH"), isWalletTransferIntentError(err) ? "warning" : "danger");
        }
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
    resolveTransferIntent,
    sendTransactionFromExternal,
    waitForTransferReceipt,
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
    let transferTxHash: `0x${string}` | null = null;
    let transferIntent: WalletTransferIntent | null = null;

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
      transferIntent = createWalletTransferIntent({
        actor: externalWalletAddress,
        chainId: APP_CHAIN_ID,
        asset: LINEA_TOKEN_ADDRESS,
        destination: embeddedWalletAddress,
        amountWei,
      });
      setIsDepositingToken(true);
      notify("Preparing LINEA deposit. Confirm the wallet prompt if it appears.", "info");
      const hash = await sendTransactionFromExternal({
        to: LINEA_TOKEN_ADDRESS,
        data,
        expectedActor: getAddress(externalWalletAddress),
        transferIntent: {
          asset: LINEA_TOKEN_ADDRESS,
          destination: getAddress(embeddedWalletAddress),
          amountWei,
        },
      });
      transferTxHash = hash;
      const receiptState = await waitForTransferReceipt(transferIntent, hash);
      transferTxHash = receiptState.hash;
      if (receiptState.status === "pending") {
        notify(formatTxStatusMessage("LINEA transfer submitted and is still pending confirmation.", receiptState.hash), "info");
        return;
      }
      if (!await resolveTransferIntent(transferIntent, receiptState.hash, "confirmed")) {
        throw new WalletTransferIntentError(
          "wallet_transfer_intent_resolution_mismatch",
          receiptState.hash,
        );
      }
      void refetchEmbeddedTokenBalance();
      if (walletTransfersEnabled && fetchWalletTransfers) {
        void fetchWalletTransfers();
      }
      notify(formatTxStatusMessage("LINEA transfer to the Privy wallet was sent.", receiptState.hash), "success");
    } catch (err) {
      const knownHash = err instanceof WalletTransactionRevertedError
        ? err.transactionHash
        : transferTxHash ?? getWalletTransferIntentErrorHash(err);
      if (
        transferIntent &&
        knownHash &&
        err instanceof WalletTransactionRevertedError &&
        err.transactionHash === knownHash
      ) {
        try {
          if (!await resolveTransferIntent(transferIntent, knownHash, "reverted")) {
            throw new WalletTransferIntentError(
              "wallet_transfer_intent_resolution_mismatch",
              knownHash,
            );
          }
        } catch (resolutionError) {
          log.warn("Deposit", "reverted LINEA transfer intent remains conservatively blocked", resolutionError);
          notify(formatWalletTransferFailure(resolutionError, "LINEA"), "warning");
          return;
        }
      }
      if (!isUserRejection(err)) {
        log.error("Deposit", "LINEA transfer to Privy failed", err);
        if (knownHash && isWalletTransferIntentError(err)) {
          notify(formatTxStatusMessage(formatWalletTransferFailure(err, "LINEA"), knownHash), "warning");
        } else if (knownHash && isAmbiguousPendingTxError(err)) {
          notify(formatTxStatusMessage("LINEA transfer submitted and is still pending confirmation.", knownHash), "warning");
        } else {
          notify(formatWalletTransferFailure(err, "LINEA"), isWalletTransferIntentError(err) ? "warning" : "danger");
        }
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
    resolveTransferIntent,
    sendTransactionFromExternal,
    waitForTransferReceipt,
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
