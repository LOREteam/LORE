"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { encodeFunctionData, formatUnits, getAddress } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import {
  APP_CHAIN_ID,
  CONTRACT_ADDRESS,
  CONTRACT_HAS_REBATE_API,
  GAME_ABI,
  TX_RECEIPT_TIMEOUT_MS,
} from "../lib/constants";
import { readJsonResponse } from "../lib/readJsonResponse";
import { delay, isUserRejection } from "../lib/utils";
import { log } from "../lib/logger";
import { fetchWithTimeout } from "../lib/fetchWithTimeout";
import {
  isSafetyPoolClaimBelowMinimum,
  MIN_SAFETY_POOL_CLAIM_FORMATTED,
  MIN_SAFETY_POOL_CLAIM_WEI,
} from "../lib/safetyPoolClaimThreshold";
import { getExplorerTxUrl } from "../lib/explorerLinks";
import { getFreshCacheDelayMs, normalizeCacheTimestamp } from "../lib/cacheTimestamp";
import { isAmbiguousPendingTxError } from "./useMining.shared";

type SilentSendFn = (tx: {
  to: `0x${string}`;
  data?: `0x${string}`;
  value?: bigint;
  gas?: bigint;
}) => Promise<`0x${string}`>;

interface UseRebateOptions {
  enabled?: boolean;
  active?: boolean;
  isPageVisible?: boolean;
  preferredAddress?: `0x${string}` | string | null;
  sendTransactionSilent?: SilentSendFn;
  onNotify?: (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
}

interface RebateEpochInfo {
  epoch: number;
  pendingWei: bigint;
  pending: string;
  claimed: boolean;
  resolved: boolean;
  userVolumeWei: bigint;
  rebatePoolWei: bigint;
}

export type ClaimPlanKind = "none" | "single" | "split" | "unknown";
type RebateDataFreshness = "fresh" | "background-refresh" | "stale-cache" | "offline";

interface ApiRebateEpochInfo {
  epoch: number;
  pendingWei: string;
  pending: string;
  claimed: boolean;
  resolved: boolean;
  userVolumeWei: string;
  rebatePoolWei: string;
}

interface ApiRebatePayload {
  isSupported: boolean;
  pendingRebateWei: string;
  claimableEpochCount: number;
  claimableEpochList: number[];
  totalEpochs: number;
  participatingEpochs: number[];
  recentEpochs: ApiRebateEpochInfo[];
  scan: {
    mode: "summary" | "exact";
    complete: boolean;
    processedEpochs: number;
    totalEpochs: number;
    nextOffset: number | null;
    servingCommitted: boolean;
  };
  error?: string;
}

interface ApiRebateHistoryPayload {
  isSupported?: boolean;
  rows: ApiRebateEpochInfo[];
  hasMore: boolean;
  nextCursor: number | null;
  error?: string;
}

type CachedRebateInfo = Omit<ApiRebatePayload, "error"> & { cachedAt: number };

const GAS_CLAIM_REBATES = BigInt(1_200_000);
const REBATE_EXACT_CHUNK_SIZE = 48;
const CLAIM_GAS_HEADROOM_BPS = 1_200n;
const CLAIM_GAS_BUFFER = 80_000n;
const REBATE_CLIENT_CACHE_TTL_MS = 60_000;
const REBATE_CLIENT_CACHE_DISPLAY_TTL_MS = 12 * 60 * 60 * 1000;
const REBATE_CLIENT_CACHE_WRITE_MIN_MS = 120_000;
const REBATE_REFRESH_MS = 30_000;
const REBATE_HIDDEN_REFRESH_MS = 120_000;
const REBATE_WARM_REFRESH_MS = 90_000;
const CLAIM_PLAN_CACHE_TTL_MS = 60_000;
const REBATE_CONFIRM_POLL_INTERVAL_MS = 2_000;
const REBATE_CONFIRM_ATTEMPTS = Math.max(1, Math.floor(TX_RECEIPT_TIMEOUT_MS / REBATE_CONFIRM_POLL_INTERVAL_MS));
const REBATE_HISTORY_PAGE_SIZE = 32;
const REBATE_RECENT_DISPLAY_LIMIT = 64;

type SafetyPoolClaimHash = `0x${string}`;

export interface SafetyPoolClaimProgress {
  claimedEpochCount: number;
  claimTxCount: number;
  usedSplitFallback: boolean;
  lastClaimTxHash: SafetyPoolClaimHash | null;
}

export interface SafetyPoolClaimBatchOptions {
  epochs: bigint[];
  claimPlanKind: ClaimPlanKind;
  progress: SafetyPoolClaimProgress;
  assertActorActive: () => void;
  isActorChangedError: (error: unknown) => boolean;
  simulateBatch: (epochs: bigint[]) => Promise<void>;
  estimateBatchGas: (epochs: bigint[]) => Promise<bigint>;
  sendBatch: (epochs: bigint[], gas: bigint) => Promise<SafetyPoolClaimHash>;
  simulateSingle: (epoch: bigint) => Promise<void>;
  estimateSingleGas: (epoch: bigint) => Promise<bigint>;
  sendSingle: (epoch: bigint, gas: bigint) => Promise<SafetyPoolClaimHash>;
  confirm: (hash: SafetyPoolClaimHash, epochs: bigint[]) => Promise<void>;
  onInitialSplit: () => void;
  onSingleFallback: (epoch: number, error: unknown) => void;
}

export function createSafetyPoolClaimProgress(): SafetyPoolClaimProgress {
  return {
    claimedEpochCount: 0,
    claimTxCount: 0,
    usedSplitFallback: false,
    lastClaimTxHash: null,
  };
}

export function tryAcquireSafetyPoolClaimLock(lock: { current: boolean }) {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function releaseSafetyPoolClaimLock(lock: { current: boolean }) {
  lock.current = false;
}

export function createSafetyPoolClaimActorGuard(
  latestActor: { current: string | null },
  claimActor: string,
) {
  const actorChangedError = new Error("Safety Pool claim actor changed");
  const isActorChangedError = (error: unknown) => (
    error === actorChangedError || latestActor.current !== claimActor
  );
  const assertActorActive = () => {
    if (latestActor.current !== claimActor) throw actorChangedError;
  };
  return { actorChangedError, assertActorActive, isActorChangedError };
}

export function formatSafetyPoolClaimError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const low = msg.toLowerCase();
  if (low.includes("notresolved")) return "Safety Pool is not claimable yet because the epoch is not resolved.";
  if (low.includes("rebatealreadyclaimed")) return "One of the selected Safety Pool epochs was already claimed.";
  if (low.includes("norebateavailable") || low.includes("nothing to claim")) {
    return "No Safety Pool payout is currently claimable for the selected epochs.";
  }
  if (low.includes("emptyarray")) return "No Safety Pool epochs were selected for claim.";
  if (low.includes("timeout") || low.includes("timed out")) {
    return "claim status is unknown after a wallet timeout. Check wallet activity before retrying.";
  }
  if (low.includes("revert") || low.includes("execution reverted")) {
    return "claim reverted on-chain. No Safety Pool payout was moved by this transaction.";
  }
  if (low.includes("rpc") || low.includes("provider") || low.includes("infura") || low.includes("alchemy") || low.includes("json-rpc")) {
    return "claim could not be submitted through the wallet provider. Check wallet activity before retrying.";
  }
  if (low.includes("insufficient funds") || low.includes("not enough eth")) {
    return "claim failed because the wallet does not have enough ETH for gas.";
  }
  return "claim failed. Refresh the Safety Pool tab and try again.";
}

export function classifySafetyPoolClaimError(err: unknown): "ambiguous" | "rejected" | "reverted" | "failed" {
  if (isAmbiguousPendingTxError(err)) return "ambiguous";
  if (isUserRejection(err)) return "rejected";
  return formatSafetyPoolClaimError(err).startsWith("claim reverted on-chain") ? "reverted" : "failed";
}

type SafetyPoolClaimOutcome = {
  kind: "success" | "ambiguous" | "rejected" | "reverted" | "failed";
  message: string;
  tone: "info" | "success" | "warning" | "danger";
};

export function getSafetyPoolClaimSuccessOutcome(progress: SafetyPoolClaimProgress): SafetyPoolClaimOutcome {
  const message = progress.claimedEpochCount === 1
    ? progress.claimTxCount <= 1
      ? "Safety Pool claimed successfully in 1 transaction."
      : `Safety Pool claimed successfully in ${progress.claimTxCount} transactions.`
    : progress.claimTxCount <= 1
      ? `Claimed Safety Pool payouts for ${progress.claimedEpochCount} epochs in 1 transaction.`
      : `Claimed Safety Pool payouts for ${progress.claimedEpochCount} epochs in ${progress.claimTxCount} transactions.`;
  return {
    kind: "success",
    message: formatRebateTxMessage(message, progress.lastClaimTxHash),
    tone: "success",
  };
}

export function getSafetyPoolClaimFailureOutcome(
  progress: SafetyPoolClaimProgress,
  err: unknown,
): SafetyPoolClaimOutcome {
  const kind = classifySafetyPoolClaimError(err);
  if (kind === "ambiguous") {
    const message = progress.claimedEpochCount > 0
      ? `Claimed Safety Pool payouts for ${progress.claimedEpochCount} epochs in ${progress.claimTxCount} transaction${progress.claimTxCount === 1 ? "" : "s"} before the remaining claim became pending. Check wallet activity and refresh Safety Pool before retrying.`
      : "Safety Pool claim may already be pending. Check wallet activity and refresh Safety Pool before retrying.";
    return {
      kind,
      message: formatRebateTxMessage(message, progress.lastClaimTxHash),
      tone: "warning",
    };
  }
  if (kind === "rejected") {
    if (progress.claimedEpochCount > 0) {
      return {
        kind,
        message: formatRebateTxMessage(
          `Claimed Safety Pool payouts for ${progress.claimedEpochCount} epochs in ${progress.claimTxCount} transaction${progress.claimTxCount === 1 ? "" : "s"} before the remaining claim flow was cancelled.`,
          progress.lastClaimTxHash,
        ),
        tone: "warning",
      };
    }
    return { kind, message: "Safety Pool claim rejected in wallet.", tone: "info" };
  }

  const formattedError = formatSafetyPoolClaimError(err);
  if (progress.claimedEpochCount > 0) {
    return {
      kind,
      message: formatRebateTxMessage(
        `Claimed Safety Pool payouts for ${progress.claimedEpochCount} epochs in ${progress.claimTxCount} transaction${progress.claimTxCount === 1 ? "" : "s"}, but some epochs still failed: ${formattedError}`,
        progress.lastClaimTxHash,
      ),
      tone: "warning",
    };
  }
  return { kind, message: `Safety Pool claim failed: ${formattedError}`, tone: "danger" };
}

export async function executeSafetyPoolClaimBatches(options: SafetyPoolClaimBatchOptions): Promise<void> {
  const {
    epochs,
    claimPlanKind,
    progress,
    assertActorActive,
    isActorChangedError,
    simulateBatch,
    estimateBatchGas,
    sendBatch,
    simulateSingle,
    estimateSingleGas,
    sendSingle,
    confirm,
    onInitialSplit,
    onSingleFallback,
  } = options;

  const submitBatch = async (batch: bigint[]) => {
    assertActorActive();
    await simulateBatch(batch);
    assertActorActive();
    const gas = await estimateBatchGas(batch);
    assertActorActive();
    const hash = await sendBatch(batch, gas);
    progress.lastClaimTxHash = hash;
    progress.claimTxCount += 1;
    assertActorActive();
    await confirm(hash, batch);
    assertActorActive();
  };

  const submitSingle = async (epoch: bigint) => {
    assertActorActive();
    await simulateSingle(epoch);
    assertActorActive();
    const gas = await estimateSingleGas(epoch);
    assertActorActive();
    const hash = await sendSingle(epoch, gas);
    progress.lastClaimTxHash = hash;
    progress.claimTxCount += 1;
    assertActorActive();
    await confirm(hash, [epoch]);
    assertActorActive();
  };

  const queue: bigint[][] =
    claimPlanKind === "split" && epochs.length > 1
      ? [
          epochs.slice(0, Math.ceil(epochs.length / 2)),
          epochs.slice(Math.ceil(epochs.length / 2)),
        ]
      : [epochs];

  if (queue.length > 1) {
    progress.usedSplitFallback = true;
    onInitialSplit();
  }

  while (queue.length > 0) {
    assertActorActive();
    const batch = queue.shift();
    if (!batch || batch.length === 0) continue;

    try {
      await submitBatch(batch);
      progress.claimedEpochCount += batch.length;
    } catch (err) {
      if (isActorChangedError(err)) throw err;
      if (isAmbiguousPendingTxError(err) || isUserRejection(err)) throw err;
      if (batch.length === 1) {
        progress.usedSplitFallback = true;
        onSingleFallback(Number(batch[0]), err);
        await submitSingle(batch[0]);
        progress.claimedEpochCount += 1;
        continue;
      }

      progress.usedSplitFallback = true;
      const middle = Math.ceil(batch.length / 2);
      queue.unshift(batch.slice(middle));
      queue.unshift(batch.slice(0, middle));
    }
  }
}

function createClaimConfirmationPendingError(message: string) {
  const error = new Error(message);
  error.name = "TransactionReceiptTimeoutError";
  return error;
}

function getRebateCacheKey(address: string) {
  return `lore:rebate:v1:${getAddress(address).toLowerCase()}`;
}

function getClaimPlanCacheKey(address: string, epochs: number[]) {
  return `lore:rebate-claim-plan:v1:${getAddress(address).toLowerCase()}:${epochs.join(",")}`;
}

function normalizeNonNegativeSafeInteger(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^(?:0|[1-9]\d*)$/.test(text)) return null;
  const parsed = BigInt(text);
  return parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : null;
}

function parseClaimableEpoch(value: bigint | undefined): number | null {
  if (typeof value !== "bigint" || value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeNonNegativeSafeInteger)
    .filter((item): item is number => item !== null);
}

function normalizeWeiString(value: unknown): string {
  const text = String(value ?? "0").trim();
  return /^\d+$/.test(text) ? text : "0";
}

function normalizeRecentEpoch(row: unknown): ApiRebateEpochInfo | null {
  if (!row || typeof row !== "object") return null;
  const data = row as Record<string, unknown>;
  const epoch = normalizeNonNegativeSafeInteger(data.epoch);
  if (epoch === null) return null;
  return {
    epoch,
    pendingWei: normalizeWeiString(data.pendingWei),
    pending: String(data.pending ?? "0"),
    claimed: Boolean(data.claimed),
    resolved: Boolean(data.resolved),
    userVolumeWei: normalizeWeiString(data.userVolumeWei),
    rebatePoolWei: normalizeWeiString(data.rebatePoolWei),
  };
}

export function normalizeRebatePayload(value: unknown): ApiRebatePayload {
  const data = (value ?? {}) as Record<string, unknown>;
  const rawScan = data.scan && typeof data.scan === "object"
    ? data.scan as Record<string, unknown>
    : null;
  const normalizedNextOffset = normalizeNonNegativeSafeInteger(rawScan?.nextOffset);
  return {
    isSupported: data.isSupported !== false,
    pendingRebateWei: normalizeWeiString(data.pendingRebateWei),
    claimableEpochCount: normalizeNonNegativeSafeInteger(data.claimableEpochCount) ?? 0,
    claimableEpochList: normalizeNumberArray(data.claimableEpochList),
    totalEpochs: normalizeNonNegativeSafeInteger(data.totalEpochs) ?? 0,
    participatingEpochs: normalizeNumberArray(data.participatingEpochs),
    recentEpochs: Array.isArray(data.recentEpochs)
      ? data.recentEpochs
          .slice(0, REBATE_RECENT_DISPLAY_LIMIT)
          .map(normalizeRecentEpoch)
          .filter((row): row is ApiRebateEpochInfo => row !== null)
      : [],
    scan: {
      mode: rawScan?.mode === "exact" ? "exact" : "summary",
      complete: rawScan?.complete !== false,
      processedEpochs: normalizeNonNegativeSafeInteger(rawScan?.processedEpochs) ?? 0,
      totalEpochs: normalizeNonNegativeSafeInteger(rawScan?.totalEpochs) ?? 0,
      nextOffset: rawScan?.nextOffset === null ? null : normalizedNextOffset,
      servingCommitted: rawScan?.servingCommitted === true,
    },
  };
}

export function normalizeRebateHistoryPayload(value: unknown): ApiRebateHistoryPayload {
  const data = (value ?? {}) as Record<string, unknown>;
  const nextCursor = normalizeNonNegativeSafeInteger(data.nextCursor);
  return {
    isSupported: data.isSupported !== false,
    rows: Array.isArray(data.rows)
      ? data.rows
          .slice(0, REBATE_HISTORY_PAGE_SIZE)
          .map(normalizeRecentEpoch)
          .filter((row): row is ApiRebateEpochInfo => row !== null)
      : [],
    hasMore: data.hasMore === true,
    nextCursor: nextCursor !== null && nextCursor > 0 ? nextCursor : null,
    error: typeof data.error === "string" ? data.error : undefined,
  };
}

export function mergeRebateEpochDetails(base: RebateEpochInfo[], older: RebateEpochInfo[]) {
  const byEpoch = new Map(older.map((row) => [row.epoch, row]));
  base.forEach((row) => byEpoch.set(row.epoch, row));
  return [...byEpoch.values()].sort((a, b) => b.epoch - a.epoch);
}

function loadCachedRebatePayload(address: string): CachedRebateInfo | null {
  if (typeof localStorage === "undefined") return null;
  const cacheKey = getRebateCacheKey(address);
  try {
    const raw = localStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedRebateInfo;
    const cachedAt = normalizeCacheTimestamp(parsed?.cachedAt);
    if (!parsed || cachedAt === null) {
      localStorage.removeItem(cacheKey);
      return null;
    }
    return {
      ...normalizeRebatePayload(parsed),
      cachedAt,
    };
  } catch {
    try {
      localStorage.removeItem(cacheKey);
    } catch {
      // ignore storage failures
    }
    return null;
  }
}

function saveCachedRebatePayload(address: string, payload: ApiRebatePayload) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      getRebateCacheKey(address),
      JSON.stringify({
        ...payload,
        cachedAt: Date.now(),
      } satisfies CachedRebateInfo),
    );
  } catch {
    // ignore storage failures
  }
}

function loadCachedClaimPlan(address: string, epochs: number[]): { kind: ClaimPlanKind; savedAt: number } | null {
  if (typeof localStorage === "undefined" || epochs.length === 0) return null;
  const cacheKey = getClaimPlanCacheKey(address, epochs);
  try {
    const raw = localStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { kind?: ClaimPlanKind; savedAt?: number };
    const savedAt = normalizeCacheTimestamp(parsed.savedAt);
    if (
      (parsed.kind === "single" || parsed.kind === "split" || parsed.kind === "unknown" || parsed.kind === "none")
      && savedAt !== null
    ) {
      return { kind: parsed.kind, savedAt };
    }
    localStorage.removeItem(cacheKey);
    return null;
  } catch {
    try {
      localStorage.removeItem(cacheKey);
    } catch {
      // ignore storage failures
    }
    return null;
  }
}

function saveCachedClaimPlan(address: string, epochs: number[], kind: ClaimPlanKind) {
  if (typeof localStorage === "undefined" || epochs.length === 0) return;
  try {
    localStorage.setItem(
      getClaimPlanCacheKey(address, epochs),
      JSON.stringify({ kind, savedAt: Date.now() }),
    );
  } catch {
    // ignore storage failures
  }
}

function isMissingContractMethodError(err: unknown, methodName: string) {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  const quotedMethod = `function "${methodName.toLowerCase()}"`;
  return (
    msg.includes(`${quotedMethod} returned no data`) ||
    msg.includes(`${quotedMethod} is not in the abi`) ||
    msg.includes(`does not have the function "${methodName.toLowerCase()}"`) ||
    msg.includes("returned no data (\"0x\")")
  );
}

export function formatRebateTxMessage(message: string, hash: `0x${string}` | null) {
  if (!hash) return message;
  const txUrl = getExplorerTxUrl(hash);
  return txUrl ? `${message} ${txUrl}` : message;
}

async function loadClaimableEpochsExact(
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>,
  address: `0x${string}`,
  epochs: bigint[],
): Promise<number[]> {
  const claimable = new Set<number>();

  for (let i = 0; i < epochs.length; i += REBATE_EXACT_CHUNK_SIZE) {
    const chunk = epochs.slice(i, i + REBATE_EXACT_CHUNK_SIZE);
    const contracts = chunk.map((epoch) => ({
      address: CONTRACT_ADDRESS,
      abi: GAME_ABI,
      functionName: "getRebateInfo" as const,
      args: [epoch, address] as const,
    }));

    try {
      const results = await publicClient.multicall({ contracts });
      results.forEach((result, index) => {
        if (result.status !== "success") return;
        const [, , pendingWei, claimed, resolved] = result.result as [
          bigint,
          bigint,
          bigint,
          boolean,
          boolean,
        ];
        if (pendingWei > 0n && !claimed && resolved) {
          const epochNumber = parseClaimableEpoch(chunk[index]);
          if (epochNumber !== null) {
            claimable.add(epochNumber);
          }
        }
      });
    } catch (err) {
      log.warn("Rebate", "exact claimable multicall failed, falling back to per-epoch reads", err);
      for (const epoch of chunk) {
        try {
          const result = (await publicClient.readContract({
            address: CONTRACT_ADDRESS,
            abi: GAME_ABI,
            functionName: "getRebateInfo",
            args: [epoch, address],
          })) as [bigint, bigint, bigint, boolean, boolean];
          const [, , pendingWei, claimed, resolved] = result;
          if (pendingWei > 0n && !claimed && resolved) {
            const epochNumber = parseClaimableEpoch(epoch);
            if (epochNumber !== null) {
              claimable.add(epochNumber);
            }
          }
        } catch (readErr) {
          log.warn("Rebate", "exact claimable epoch read failed", {
            epoch: parseClaimableEpoch(epoch) ?? "invalid",
            err: readErr,
          });
        }
      }
    }
  }

  return [...claimable].sort((a, b) => b - a);
}

function parseApiEpochInfo(row: ApiRebateEpochInfo): RebateEpochInfo {
  return {
    epoch: row.epoch,
    pendingWei: BigInt(row.pendingWei),
    pending: row.pending,
    claimed: row.claimed,
    resolved: row.resolved,
    userVolumeWei: BigInt(row.userVolumeWei),
    rebatePoolWei: BigInt(row.rebatePoolWei),
  };
}

function recentRebateEpochsEqual(left: ApiRebateEpochInfo[], right: ApiRebateEpochInfo[]) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (
      a.epoch !== b.epoch ||
      a.pendingWei !== b.pendingWei ||
      a.pending !== b.pending ||
      a.claimed !== b.claimed ||
      a.resolved !== b.resolved ||
      a.userVolumeWei !== b.userVolumeWei ||
      a.rebatePoolWei !== b.rebatePoolWei
    ) {
      return false;
    }
  }
  return true;
}

function rebatePayloadEqual(left: ApiRebatePayload | null, right: ApiRebatePayload) {
  if (!left) return false;
  if (
    left.isSupported !== right.isSupported ||
    left.pendingRebateWei !== right.pendingRebateWei ||
    left.claimableEpochCount !== right.claimableEpochCount ||
    left.totalEpochs !== right.totalEpochs ||
    left.scan.mode !== right.scan.mode ||
    left.scan.complete !== right.scan.complete ||
    left.scan.processedEpochs !== right.scan.processedEpochs ||
    left.scan.totalEpochs !== right.scan.totalEpochs ||
    left.scan.nextOffset !== right.scan.nextOffset ||
    left.scan.servingCommitted !== right.scan.servingCommitted ||
    left.claimableEpochList.length !== right.claimableEpochList.length ||
    left.participatingEpochs.length !== right.participatingEpochs.length
  ) {
    return false;
  }
  for (let index = 0; index < left.claimableEpochList.length; index += 1) {
    if (left.claimableEpochList[index] !== right.claimableEpochList[index]) return false;
  }
  for (let index = 0; index < left.participatingEpochs.length; index += 1) {
    if (left.participatingEpochs[index] !== right.participatingEpochs[index]) return false;
  }
  return recentRebateEpochsEqual(left.recentEpochs, right.recentEpochs);
}

function getRebateDataFreshness(cacheStatus: string | null): RebateDataFreshness {
  if (cacheStatus === "stale") return "stale-cache";
  if (cacheStatus === "inflight") return "background-refresh";
  return "fresh";
}

export function useRebate(options?: UseRebateOptions) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();
  const [isClaiming, setIsClaiming] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [rebateEpochs, setRebateEpochs] = useState<number[]>([]);
  const [claimableEpochs, setClaimableEpochs] = useState<number[]>([]);
  const [claimableEpochCount, setClaimableEpochCount] = useState(0);
  const [pendingRebateWei, setPendingRebateWei] = useState(0n);
  const [details, setDetails] = useState<RebateEpochInfo[]>([]);
  const [olderDetails, setOlderDetails] = useState<RebateEpochInfo[]>([]);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [isSupported, setIsSupported] = useState(CONTRACT_HAS_REBATE_API);
  const [claimPlanKind, setClaimPlanKind] = useState<ClaimPlanKind>("none");
  const [isEstimatingClaimPlan, setIsEstimatingClaimPlan] = useState(false);
  const [dataFreshness, setDataFreshness] = useState<RebateDataFreshness>("fresh");
  const [payloadVersion, setPayloadVersion] = useState(0);
  const enabled = options?.enabled ?? true;
  const active = options?.active ?? enabled;
  const isPageVisible = options?.isPageVisible ?? true;
  const notify = options?.onNotify;
  const silentSend = options?.sendTransactionSilent;
  const hasLoadedRef = useRef(false);
  const requestIdRef = useRef(0);
  const timeoutRef = useRef<number | null>(null);
  const cacheSavedAtRef = useRef<number | null>(null);
  const rebateUnavailableWarningRef = useRef(false);
  const mountedRef = useRef(false);
  const claimInFlightRef = useRef(false);
  const lastPayloadRef = useRef<ApiRebatePayload | null>(null);
  const cachedPayloadRef = useRef<Record<string, CachedRebateInfo | null>>({});
  const claimPlanCacheRef = useRef<Record<string, { kind: ClaimPlanKind; savedAt: number } | null>>({});
  const exactAttemptVersionRef = useRef<number | null>(null);
  const activeRebateAddressRef = useRef<string | null>(null);
  const olderCursorRef = useRef<number | null>(null);
  const olderInitializedRef = useRef(false);
  const olderLoadingRef = useRef(false);
  const olderRequestIdRef = useRef(0);
  const olderLoadedCountRef = useRef(0);
  const rebateAddress = useMemo(() => {
    const candidate = options?.preferredAddress ?? address;
    if (!candidate) return null;
    try {
      return getAddress(candidate);
    } catch {
      return null;
    }
  }, [address, options?.preferredAddress]);
  const latestRebateAddressRef = useRef<string | null>(rebateAddress?.toLowerCase() ?? null);
  latestRebateAddressRef.current = rebateAddress?.toLowerCase() ?? null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      olderRequestIdRef.current += 1;
      olderLoadingRef.current = false;
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  const resetState = useCallback(() => {
    if (!mountedRef.current) return;
    requestIdRef.current += 1;
    setRebateEpochs([]);
    setClaimableEpochs([]);
    setClaimableEpochCount(0);
    setPendingRebateWei(0n);
    setDetails([]);
    setOlderDetails([]);
    setIsLoadingOlder(false);
    setHasMoreOlder(false);
    setIsSupported(CONTRACT_HAS_REBATE_API);
    setClaimPlanKind("none");
    setIsEstimatingClaimPlan(false);
    setDataFreshness("fresh");
    setIsLoading(false);
    setHasLoaded(false);
    setPayloadVersion(0);
    hasLoadedRef.current = false;
    lastPayloadRef.current = null;
    exactAttemptVersionRef.current = null;
    olderCursorRef.current = null;
    olderInitializedRef.current = false;
    olderLoadingRef.current = false;
    olderRequestIdRef.current += 1;
    olderLoadedCountRef.current = 0;
  }, []);

  useEffect(() => {
    if (activeRebateAddressRef.current === rebateAddress) return;
    activeRebateAddressRef.current = rebateAddress;
    cacheSavedAtRef.current = null;
    resetState();
  }, [rebateAddress, resetState]);

  const applyPayload = useCallback((payload: ApiRebatePayload) => {
    if (!mountedRef.current) return false;
    const changed = !rebatePayloadEqual(lastPayloadRef.current, payload);
    lastPayloadRef.current = payload;
    if (!changed) {
      setHasLoaded(true);
      return false;
    }
    setIsSupported(payload.isSupported);
    setRebateEpochs(payload.participatingEpochs);
    setClaimableEpochs(payload.claimableEpochList);
    setClaimableEpochCount(payload.claimableEpochCount);
    setPendingRebateWei(BigInt(payload.pendingRebateWei || "0"));
    const recentDetails = payload.recentEpochs.map(parseApiEpochInfo).sort((a, b) => b.epoch - a.epoch);
    setDetails(recentDetails);
    if (!olderInitializedRef.current) {
      olderInitializedRef.current = true;
      olderCursorRef.current = recentDetails.at(-1)?.epoch ?? null;
    }
    setHasMoreOlder((current) => current || payload.totalEpochs > recentDetails.length + olderLoadedCountRef.current);
    setHasLoaded(true);
    setPayloadVersion((current) => current + 1);
    return true;
  }, []);

  const primeFromDisplayCache = useCallback((targetAddress: string) => {
    if (hasLoadedRef.current) return false;
    const cached =
      cachedPayloadRef.current[targetAddress] ??
      (cachedPayloadRef.current[targetAddress] = loadCachedRebatePayload(targetAddress));
    if (!cached || Date.now() - cached.cachedAt >= REBATE_CLIENT_CACHE_DISPLAY_TTL_MS) {
      return false;
    }
    applyPayload(cached);
    setDataFreshness("stale-cache");
    hasLoadedRef.current = true;
    cacheSavedAtRef.current = cached.cachedAt;
    return true;
  }, [applyPayload]);

  const readClaimPlanCache = useCallback((targetAddress: string, epochs: number[]) => {
    const cacheKey = getClaimPlanCacheKey(targetAddress, epochs);
    if (Object.prototype.hasOwnProperty.call(claimPlanCacheRef.current, cacheKey)) {
      return claimPlanCacheRef.current[cacheKey];
    }
    const cached = loadCachedClaimPlan(targetAddress, epochs);
    claimPlanCacheRef.current[cacheKey] = cached;
    return cached;
  }, []);

  const writeClaimPlanCache = useCallback((targetAddress: string, epochs: number[], kind: ClaimPlanKind) => {
    const cached = { kind, savedAt: Date.now() };
    claimPlanCacheRef.current[getClaimPlanCacheKey(targetAddress, epochs)] = cached;
    saveCachedClaimPlan(targetAddress, epochs, kind);
  }, []);

  const confirmClaimBatch = useCallback(
    async (hash: `0x${string}`, sender: `0x${string}`, epochArgs: bigint[]) => {
      if (!publicClient) return;

      for (let attempt = 0; attempt < REBATE_CONFIRM_ATTEMPTS; attempt += 1) {
        try {
          const receipt = await publicClient.getTransactionReceipt({ hash });
          if (receipt.status !== "success") {
            throw new Error(`Transaction reverted: ${hash}`);
          }
          return;
        } catch (err) {
          const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
          if (message.startsWith("transaction reverted:")) throw err;
          const missingReceipt =
            message.includes("could not be found") ||
            message.includes("not found");
          if (!missingReceipt) {
            throw createClaimConfirmationPendingError(
              "Safety Pool claim was submitted, but confirmation is temporarily unavailable. Refresh the Safety Pool tab before retrying.",
            );
          }
        }

        let remainingEpochs: number[];
        try {
          remainingEpochs = await loadClaimableEpochsExact(publicClient, sender, epochArgs);
        } catch {
          throw createClaimConfirmationPendingError(
            "Safety Pool claim was submitted, but claim state is temporarily unavailable. Refresh the Safety Pool tab before retrying.",
          );
        }
        if (remainingEpochs.length === 0) {
          return;
        }

        await delay(REBATE_CONFIRM_POLL_INTERVAL_MS);
      }

      throw createClaimConfirmationPendingError(
        `Safety Pool claim confirmation timed out after ${TX_RECEIPT_TIMEOUT_MS}ms. Refresh the Safety Pool tab in a few seconds.`,
      );
    },
    [publicClient],
  );

  const refetchRebateInfo = useCallback(async (options?: { forceFresh?: boolean; includeExact?: boolean }) => {
    if (!enabled || !rebateAddress) {
      resetState();
      return false;
    }

    if (!CONTRACT_HAS_REBATE_API) {
      if (!rebateUnavailableWarningRef.current) {
        rebateUnavailableWarningRef.current = true;
        log.info("Rebate", "disabled for configured contract profile");
      }
      if (mountedRef.current) {
        setIsSupported(false);
        setIsLoading(false);
        setRebateEpochs([]);
        setClaimableEpochs([]);
        setClaimableEpochCount(0);
        setPendingRebateWei(0n);
        setDetails([]);
        setOlderDetails([]);
        setHasMoreOlder(false);
        setIsLoadingOlder(false);
      }
      olderCursorRef.current = null;
      olderInitializedRef.current = false;
      olderLoadingRef.current = false;
      olderRequestIdRef.current += 1;
      olderLoadedCountRef.current = 0;
      hasLoadedRef.current = true;
      if (mountedRef.current) {
        setHasLoaded(true);
      }
      return true;
    }

    const requestId = ++requestIdRef.current;
    primeFromDisplayCache(rebateAddress);

    if (!hasLoadedRef.current) {
      if (mountedRef.current) {
        setIsLoading(true);
      }
    }

    try {
      const query = new URLSearchParams({ user: rebateAddress.toLowerCase() });
      if (options?.forceFresh) query.set("refresh", String(Date.now()));
      if (options?.includeExact) query.set("exact", "1");
      const response = await fetchWithTimeout(`/api/rebates?${query.toString()}`, {
        cache: "no-store",
      });
      const cacheStatus = response.headers.get("X-Rebate-Cache");
      const payload = await readJsonResponse<ApiRebatePayload>(response);

      if (!payload) {
        throw new Error(`Empty response from /api/rebates (HTTP ${response.status})`);
      }
      if (!response.ok || payload.error) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }

      if (requestId !== requestIdRef.current) return;

      const normalizedPayload = normalizeRebatePayload(payload);
      const changed = applyPayload(normalizedPayload);
      const fetchedAt = Date.now();
      hasLoadedRef.current = true;
      if (mountedRef.current) {
        setHasLoaded(true);
        setDataFreshness(
          normalizedPayload.scan.complete
            ? getRebateDataFreshness(cacheStatus)
            : "background-refresh",
        );
      }
      const cachedPayload = {
        ...normalizedPayload,
        cachedAt: fetchedAt,
      } satisfies CachedRebateInfo;
      cachedPayloadRef.current[rebateAddress] = cachedPayload;
      const shouldWriteCache =
        changed ||
        !cacheSavedAtRef.current ||
        fetchedAt - cacheSavedAtRef.current >= REBATE_CLIENT_CACHE_WRITE_MIN_MS;
      if (shouldWriteCache) {
        cacheSavedAtRef.current = fetchedAt;
        saveCachedRebatePayload(rebateAddress, normalizedPayload);
      }
      return true;
    } catch (err) {
      if (
        isMissingContractMethodError(err, "getRebateSummary") ||
        isMissingContractMethodError(err, "getRebateInfo") ||
        isMissingContractMethodError(err, "claimEpochsRebate")
      ) {
        if (!rebateUnavailableWarningRef.current) {
          rebateUnavailableWarningRef.current = true;
          log.info("Rebate", "rebate methods unavailable for current contract profile");
        }
        if (mountedRef.current) {
          setIsSupported(false);
        }
      } else {
        log.warn("Rebate", "refetch failed", err);
      }

      if (hasLoadedRef.current && mountedRef.current) {
        setDataFreshness("offline");
      }

      if (!hasLoadedRef.current) {
        if (mountedRef.current) {
          setRebateEpochs([]);
          setClaimableEpochs([]);
          setClaimableEpochCount(0);
          setPendingRebateWei(0n);
          setDetails([]);
          setHasLoaded(false);
        }
      }
      return false;
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [applyPayload, enabled, primeFromDisplayCache, rebateAddress, resetState]);

  const loadOlderRebateHistory = useCallback(async () => {
    if (!enabled || !rebateAddress || olderLoadingRef.current || !hasMoreOlder) return false;
    olderLoadingRef.current = true;
    const requestId = ++olderRequestIdRef.current;
    if (mountedRef.current) setIsLoadingOlder(true);

    try {
      const query = new URLSearchParams({
        user: rebateAddress.toLowerCase(),
        limit: String(REBATE_HISTORY_PAGE_SIZE),
      });
      if (olderCursorRef.current !== null) query.set("cursor", String(olderCursorRef.current));
      const response = await fetchWithTimeout(`/api/rebate-history?${query.toString()}`, { cache: "no-store" });
      const payload = await readJsonResponse<ApiRebateHistoryPayload>(response);
      if (!payload) throw new Error(`Empty response from /api/rebate-history (HTTP ${response.status})`);
      const normalized = normalizeRebateHistoryPayload(payload);
      if (!response.ok || normalized.error) {
        throw new Error(normalized.error || `HTTP ${response.status}`);
      }
      if (normalized.hasMore && normalized.nextCursor === null) {
        throw new Error("Safety Pool history returned an invalid continuation cursor");
      }
      if (requestId !== olderRequestIdRef.current || activeRebateAddressRef.current !== rebateAddress) return false;

      const pageDetails = normalized.rows.map(parseApiEpochInfo);
      setOlderDetails((current) => {
        const merged = mergeRebateEpochDetails(current, pageDetails);
        olderLoadedCountRef.current = merged.length;
        return merged;
      });
      olderCursorRef.current = normalized.nextCursor;
      setHasMoreOlder(normalized.hasMore);
      return true;
    } catch (error) {
      log.warn("Rebate", "older history load failed", error);
      notify?.("Older Safety Pool history could not be loaded. Try again in a moment.", "warning");
      return false;
    } finally {
      if (requestId === olderRequestIdRef.current) {
        olderLoadingRef.current = false;
        if (mountedRef.current) setIsLoadingOlder(false);
      }
    }
  }, [enabled, hasMoreOlder, notify, rebateAddress]);

  useEffect(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (!enabled) {
      resetState();
      return;
    }

    if (!rebateAddress) return;

    primeFromDisplayCache(rebateAddress);

    const pollMs = active
      ? (isPageVisible ? REBATE_REFRESH_MS : REBATE_HIDDEN_REFRESH_MS)
      : REBATE_WARM_REFRESH_MS;
    const savedAt = cacheSavedAtRef.current;
    const cachedDelay = getFreshCacheDelayMs(savedAt, REBATE_CLIENT_CACHE_TTL_MS) ?? 0;
    const initialDelay = active ? cachedDelay : Math.max(cachedDelay, REBATE_WARM_REFRESH_MS);
    let cancelled = false;

    const schedule = (delayMs: number) => {
      timeoutRef.current = window.setTimeout(async () => {
        if (cancelled) return;
        await refetchRebateInfo();
        if (cancelled) return;
        schedule(pollMs);
      }, delayMs);
    };

    schedule(initialDelay);
    return () => {
      cancelled = true;
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [active, enabled, isPageVisible, primeFromDisplayCache, rebateAddress, refetchRebateInfo, resetState]);

  useEffect(() => {
    if (!enabled || !active || !isPageVisible || !rebateAddress) return;
    if (!hasLoaded || isLoading || !isSupported) return;
    if (claimableEpochCount <= 0 || claimableEpochs.length > 0) return;
    if (payloadVersion === 0 || exactAttemptVersionRef.current === payloadVersion) return;
    exactAttemptVersionRef.current = payloadVersion;
    void refetchRebateInfo({ includeExact: true }).then((ok) => {
      if (!ok && exactAttemptVersionRef.current === payloadVersion) {
        exactAttemptVersionRef.current = null;
      }
    });
  }, [
    active,
    claimableEpochCount,
    claimableEpochs.length,
    enabled,
    hasLoaded,
    isLoading,
    isPageVisible,
    isSupported,
    payloadVersion,
    rebateAddress,
    refetchRebateInfo,
  ]);

  const mergedDetails = useMemo(
    () => mergeRebateEpochDetails(details, olderDetails),
    [details, olderDetails],
  );
  const baseEpochSet = useMemo(() => new Set(rebateEpochs), [rebateEpochs]);
  const overflowOlderDetails = useMemo(
    () => olderDetails.filter((row) => !baseEpochSet.has(row.epoch)),
    [baseEpochSet, olderDetails],
  );
  const allRebateEpochs = useMemo(
    () => [...new Set([...rebateEpochs, ...olderDetails.map((row) => row.epoch)])].sort((a, b) => b - a),
    [olderDetails, rebateEpochs],
  );
  const allClaimableEpochs = useMemo(
    () => [
      ...new Set([
        ...claimableEpochs,
        ...olderDetails
          .filter((row) => row.resolved && !row.claimed && row.pendingWei > 0n)
          .map((row) => row.epoch),
      ]),
    ].sort((a, b) => b - a),
    [claimableEpochs, olderDetails],
  );
  const effectivePendingRebateWei = useMemo(
    () => pendingRebateWei + overflowOlderDetails.reduce((total, row) => total + row.pendingWei, 0n),
    [overflowOlderDetails, pendingRebateWei],
  );
  const effectiveClaimableEpochCount = useMemo(
    () => Math.max(claimableEpochCount, claimableEpochs.length) + overflowOlderDetails.filter(
      (row) => row.resolved && !row.claimed && row.pendingWei > 0n,
    ).length,
    [claimableEpochCount, claimableEpochs.length, overflowOlderDetails],
  );

  useEffect(() => {
    if (!enabled || !CONTRACT_HAS_REBATE_API) {
      if (mountedRef.current) {
        setClaimPlanKind("none");
        setIsEstimatingClaimPlan(false);
      }
      return;
    }

    if (!rebateAddress || !publicClient) {
      if (mountedRef.current) {
        setClaimPlanKind("unknown");
        setIsEstimatingClaimPlan(false);
      }
      return;
    }

    if (allClaimableEpochs.length === 0) {
      if (mountedRef.current) {
        setClaimPlanKind("none");
        setIsEstimatingClaimPlan(false);
      }
      return;
    }

    if (!active || !isPageVisible) {
      if (mountedRef.current) {
        setIsEstimatingClaimPlan(false);
      }
      return;
    }

    let cancelled = false;
    const epochArgs = allClaimableEpochs.map((epoch) => BigInt(epoch));
    const cachedPlan = readClaimPlanCache(rebateAddress, allClaimableEpochs);
    if (cachedPlan && getFreshCacheDelayMs(cachedPlan.savedAt, CLAIM_PLAN_CACHE_TTL_MS) !== null) {
      if (mountedRef.current) {
        setClaimPlanKind(cachedPlan.kind);
        setIsEstimatingClaimPlan(false);
      }
      return;
    }

    if (mountedRef.current) {
      setIsEstimatingClaimPlan(true);
    }
    void publicClient.estimateContractGas({
      address: CONTRACT_ADDRESS,
      abi: GAME_ABI,
      functionName: "claimEpochsRebate",
      args: [epochArgs],
      account: rebateAddress,
    }).then(() => {
      if (cancelled) return;
      setClaimPlanKind("single");
      writeClaimPlanCache(rebateAddress, allClaimableEpochs, "single");
    }).catch(() => {
      if (cancelled) return;
      const fallbackKind = allClaimableEpochs.length > 1 ? "split" : "unknown";
      setClaimPlanKind(fallbackKind);
      writeClaimPlanCache(rebateAddress, allClaimableEpochs, fallbackKind);
    }).finally(() => {
      if (cancelled) return;
      setIsEstimatingClaimPlan(false);
    });

    return () => {
      cancelled = true;
    };
  }, [active, allClaimableEpochs, enabled, isPageVisible, publicClient, readClaimPlanCache, rebateAddress, writeClaimPlanCache]);

  const clearOlderRebateHistory = useCallback(() => {
    olderRequestIdRef.current += 1;
    olderLoadingRef.current = false;
    olderCursorRef.current = details.at(-1)?.epoch ?? null;
    olderLoadedCountRef.current = 0;
    setOlderDetails([]);
    setIsLoadingOlder(false);
    setHasMoreOlder(rebateEpochs.length > details.length);
  }, [details, rebateEpochs.length]);

  const claimRebates = useCallback(async () => {
    if (!CONTRACT_HAS_REBATE_API || !rebateAddress || !publicClient || allRebateEpochs.length === 0) return;
    if (!tryAcquireSafetyPoolClaimLock(claimInFlightRef)) return;
    const claimActor = rebateAddress.toLowerCase();
    const { assertActorActive: assertClaimActorActive, isActorChangedError } =
      createSafetyPoolClaimActorGuard(latestRebateAddressRef, claimActor);
    if (mountedRef.current) {
      setIsClaiming(true);
    }

    const claimProgress = createSafetyPoolClaimProgress();

    try {
      const connected = address ? getAddress(address) : null;
      const sender = silentSend ? rebateAddress : connected;
      if (!sender) {
        notify?.("Connect a wallet to claim Safety Pool payouts.", "warning");
        return;
      }

      if (!silentSend && sender.toLowerCase() !== rebateAddress.toLowerCase()) {
        throw new Error(
          `Safety Pool sender mismatch. Safety Pool is loaded for ${rebateAddress}, but your connected wallet is ${sender}. Switch wallets or use the embedded wallet and try again.`,
        );
      }
      assertClaimActorActive();

      const candidateEpochs = allClaimableEpochs.length > 0 ? allClaimableEpochs : allRebateEpochs;
      const verifiedClaimableEpochs = await loadClaimableEpochsExact(
        publicClient,
        sender,
        candidateEpochs.map((epoch) => BigInt(epoch)),
      );
      assertClaimActorActive();

      if (verifiedClaimableEpochs.length === 0) {
        clearOlderRebateHistory();
        await refetchRebateInfo({ forceFresh: true });
        notify?.("No claimable Safety Pool epochs were found. Safety Pool state has been refreshed.", "info");
        return;
      }

      notify?.("Preparing Safety Pool claim. Confirm the wallet prompt if it appears.", "info");
      const estimateClaimGas = async (epochArgs: bigint[]) => {
        try {
          const estimated = await publicClient.estimateContractGas({
            address: CONTRACT_ADDRESS,
            abi: GAME_ABI,
            functionName: "claimEpochsRebate",
            args: [epochArgs],
            account: sender,
          });
          return ((estimated * CLAIM_GAS_HEADROOM_BPS) / 1_000n) + CLAIM_GAS_BUFFER;
        } catch {
          return GAS_CLAIM_REBATES;
        }
      };

      const estimateSingleClaimGas = async (epoch: bigint) => {
        try {
          const estimated = await publicClient.estimateContractGas({
            address: CONTRACT_ADDRESS,
            abi: GAME_ABI,
            functionName: "claimEpochRebate",
            args: [epoch],
            account: sender,
          });
          return ((estimated * CLAIM_GAS_HEADROOM_BPS) / 1_000n) + CLAIM_GAS_BUFFER;
        } catch {
          return GAS_CLAIM_REBATES;
        }
      };

      await executeSafetyPoolClaimBatches({
        epochs: verifiedClaimableEpochs.map((epoch) => BigInt(epoch)),
        claimPlanKind,
        progress: claimProgress,
        assertActorActive: assertClaimActorActive,
        isActorChangedError,
        simulateBatch: async (epochArgs) => {
          await publicClient.simulateContract({
            address: CONTRACT_ADDRESS,
            abi: GAME_ABI,
            functionName: "claimEpochsRebate",
            args: [epochArgs],
            account: sender,
          });
        },
        estimateBatchGas: estimateClaimGas,
        sendBatch: async (epochArgs, gas) => {
          if (silentSend) {
            const data = encodeFunctionData({
              abi: GAME_ABI,
              functionName: "claimEpochsRebate",
              args: [epochArgs],
            });
            return silentSend({ to: CONTRACT_ADDRESS, data, gas });
          }
          return writeContractAsync({
            address: CONTRACT_ADDRESS,
            abi: GAME_ABI,
            functionName: "claimEpochsRebate",
            args: [epochArgs],
            chainId: APP_CHAIN_ID,
            gas,
          });
        },
        simulateSingle: async (epoch) => {
          await publicClient.simulateContract({
            address: CONTRACT_ADDRESS,
            abi: GAME_ABI,
            functionName: "claimEpochRebate",
            args: [epoch],
            account: sender,
          });
        },
        estimateSingleGas: estimateSingleClaimGas,
        sendSingle: async (epoch, gas) => {
          if (silentSend) {
            const data = encodeFunctionData({
              abi: GAME_ABI,
              functionName: "claimEpochRebate",
              args: [epoch],
            });
            return silentSend({ to: CONTRACT_ADDRESS, data, gas });
          }
          return writeContractAsync({
            address: CONTRACT_ADDRESS,
            abi: GAME_ABI,
            functionName: "claimEpochRebate",
            args: [epoch],
            chainId: APP_CHAIN_ID,
            gas,
          });
        },
        confirm: (hash, epochArgs) => confirmClaimBatch(hash, sender, epochArgs),
        onInitialSplit: () => {
          notify?.("Safety Pool claim is being sent in multiple transactions. Please wait until all parts finish.", "info");
        },
        onSingleFallback: (epoch, err) => {
          log.warn("Rebate", "batch claim failed for single epoch, trying claimEpochRebate fallback", {
            epoch,
            err,
          });
        },
      });
      assertClaimActorActive();

      log.info("Rebate", "claimed", {
        epochs: claimProgress.claimedEpochCount,
        txCount: claimProgress.claimTxCount,
        split: claimProgress.usedSplitFallback,
      });
      const outcome = getSafetyPoolClaimSuccessOutcome(claimProgress);
      notify?.(outcome.message, outcome.tone);
      clearOlderRebateHistory();
      await refetchRebateInfo({ forceFresh: true });
    } catch (err) {
      if (isActorChangedError(err)) return;
      clearOlderRebateHistory();
      await refetchRebateInfo({ forceFresh: true });
      const outcome = getSafetyPoolClaimFailureOutcome(claimProgress, err);

      if (outcome.kind === "ambiguous") {
        log.warn("Rebate", "claim submission status is ambiguous; fallback suppressed", err);
      } else if (outcome.kind === "rejected") {
        log.warn("Rebate", "claim cancelled", err);
      } else {
        log.error("Rebate", "claim failed", err);
      }
      notify?.(outcome.message, outcome.tone);
    } finally {
      releaseSafetyPoolClaimLock(claimInFlightRef);
      if (mountedRef.current) {
        setIsClaiming(false);
      }
    }
  }, [
    address,
    allClaimableEpochs,
    allRebateEpochs,
    claimPlanKind,
    clearOlderRebateHistory,
    notify,
    publicClient,
    rebateAddress,
    refetchRebateInfo,
    silentSend,
    confirmClaimBatch,
    writeContractAsync,
  ]);

  const rebateInfo = useMemo(
    () => ({
      isSupported,
      pendingRebateWei: effectivePendingRebateWei,
      pendingRebate: formatUnits(effectivePendingRebateWei, 18),
      claimableEpochs: effectiveClaimableEpochCount,
      totalEpochs: allRebateEpochs.length,
      recentEpochs: mergedDetails,
      isLoading,
      isLoadingOlder,
      hasMoreOlder,
      loadOlder: loadOlderRebateHistory,
      hasLoaded,
      claimPlanKind,
      dataFreshness,
      isEstimatingClaimPlan,
      minClaimWei: MIN_SAFETY_POOL_CLAIM_WEI,
      minClaimAmount: MIN_SAFETY_POOL_CLAIM_FORMATTED,
      isBelowClaimMinimum: isSafetyPoolClaimBelowMinimum(effectivePendingRebateWei, MIN_SAFETY_POOL_CLAIM_WEI),
    }),
    [
      allRebateEpochs.length,
      claimPlanKind,
      dataFreshness,
      effectiveClaimableEpochCount,
      effectivePendingRebateWei,
      hasMoreOlder,
      hasLoaded,
      isEstimatingClaimPlan,
      isLoading,
      isLoadingOlder,
      isSupported,
      loadOlderRebateHistory,
      mergedDetails,
    ],
  );

  return {
    rebateInfo,
    isClaiming,
    claimRebates,
    refetchRebateInfo,
  };
}
