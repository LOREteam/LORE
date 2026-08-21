"use client";

import { log } from "../lib/logger";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { usePublicClient, useAccount } from "wagmi";
import { encodeFunctionData, getAddress } from "viem";
import { APP_CHAIN_ID, CONTRACT_ADDRESS, GAME_ABI, REWARD_SCAN_CHUNK_SIZE, TX_RECEIPT_TIMEOUT_MS } from "../lib/constants";
import type { RewardScanVerificationState, UnclaimedWin } from "../lib/types";
import { isUserRejection } from "../lib/utils";
import { getExplorerTxUrl } from "../lib/explorerLinks";
import { normalizeCacheTimestamp } from "../lib/cacheTimestamp";
import {
  chunkRewardScanItems,
  collectOpenRewardScanWins,
  getAutomaticRewardScanBounds,
  isRewardClaimWindowOpen,
  iterateDescendingRewardScanEpochChunks,
} from "../lib/rewardScanPolicy";
import {
  ClaimTransactionIntentError,
  type ClaimTransactionIntent,
  waitForClaimTransactionReceiptAgreement,
} from "../lib/claimTransactionIntent";
import { acquireEoaNonceLockLease } from "../lib/eoaNonceLock";
import { isAmbiguousPendingTxError } from "./useMining.shared";

export { isRewardClaimWindowOpen } from "../lib/rewardScanPolicy";

interface UseRewardScannerOptions {
  enabled?: boolean;
  isPageVisible?: boolean;
  preferredAddress?: `0x${string}` | string | null;
  sendTransactionSilent?: (tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint }) => Promise<`0x${string}`>;
  onNotify?: (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
}

type EpochTuple = readonly [bigint, bigint, bigint, boolean];
type ReceiptState = "confirmed" | "pending";

const MAX_BATCH_CLAIM_EPOCHS = 128;
const CLAIM_GAS_FALLBACK = 200_000n;
const CLAIM_GAS_BUFFER = 20_000n;
const CLAIM_GAS_HEADROOM_BPS = 12_000n;
const BPS_DENOMINATOR = 10_000n;
const REWARD_SCAN_CHUNK_SIZE_NUMBER = Number(REWARD_SCAN_CHUNK_SIZE);
/** How long before a background re-scan is triggered after using cached data. */
const REWARD_SCAN_CACHE_RESCAN_MS = 15 * 60_000; // 15 minutes

type RewardScanCacheEnvelope = {
  cacheVersion?: number;
  /** Timestamp of the last fully verified scan. */
  verifiedAt?: number;
  /** Set after a confirmed claim; preserves provenance but forces a refresh. */
  invalidatedAt?: number;
  /** Timestamp retained only for backwards-compatible rescan scheduling. */
  savedAt?: number;
  /** The highest epoch that was scanned up to (exclusive upper bound of scanned range). */
  lastScannedEpoch?: string;
  /** The deepest (lowest) epoch that was scanned down to. */
  deepestScannedEpoch?: string;
  /** Unclaimed wins found during scan. */
  wins?: UnclaimedWin[];
};

export type CachedRewardScan = {
  wins: UnclaimedWin[];
  savedAt: number | null;
  lastScannedEpoch: string | null;
  deepestScannedEpoch: string | null;
  verifiedAt: number | null;
  isVerified: boolean;
  isInvalidated: boolean;
};

const EMPTY_REWARD_SCAN_CACHE: CachedRewardScan = {
  wins: [],
  savedAt: null,
  lastScannedEpoch: null,
  deepestScannedEpoch: null,
  verifiedAt: null,
  isVerified: false,
  isInvalidated: false,
};

export class RewardScanIncompleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RewardScanIncompleteError";
  }
}

function getRewardScanCacheKey(address: string, version: 2 | 3 = 3) {
  return `lore:reward-scan:v${version}:${getAddress(address).toLowerCase()}`;
}

export function parseRewardScanCacheEnvelope(value: unknown, sourceVersion: 2 | 3): CachedRewardScan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...EMPTY_REWARD_SCAN_CACHE };
  const parsed = value as RewardScanCacheEnvelope;
  if (!Array.isArray(parsed.wins)) return { ...EMPTY_REWARD_SCAN_CACHE };

  const lastScannedEpoch = normalizeRewardScanEpochString(parsed.lastScannedEpoch)
    ?? (sourceVersion === 2 ? normalizeRewardScanEpochString((parsed as Record<string, unknown>).epoch) : null);
  const deepestScannedEpoch = normalizeRewardScanEpochString(parsed.deepestScannedEpoch);
  const savedAt = normalizeCacheTimestamp(parsed.savedAt);
  const verifiedAt = sourceVersion === 3 && parsed.cacheVersion === 3
    ? normalizeCacheTimestamp(parsed.verifiedAt)
    : null;
  const isVerified = verifiedAt !== null && lastScannedEpoch !== null && deepestScannedEpoch !== null;
  const isInvalidated = sourceVersion === 3 && normalizeCacheTimestamp(parsed.invalidatedAt) !== null;

  return {
    wins: normalizeRewardScanWins(parsed.wins),
    savedAt: verifiedAt ?? savedAt,
    lastScannedEpoch,
    deepestScannedEpoch,
    verifiedAt: isVerified ? verifiedAt : null,
    isVerified,
    isInvalidated,
  };
}

export function isRewardScanCacheCoveredForEpoch(cache: CachedRewardScan, currentEpoch: bigint): boolean {
  if (!cache.isVerified || cache.isInvalidated || !cache.lastScannedEpoch || !cache.deepestScannedEpoch) return false;
  const { minEpoch } = getAutomaticRewardScanBounds(currentEpoch);
  try {
    return BigInt(cache.lastScannedEpoch) === currentEpoch && BigInt(cache.deepestScannedEpoch) <= minEpoch;
  } catch {
    return false;
  }
}

export function getCachedRewardScanState(
  cache: CachedRewardScan,
  walletAddress: string,
  currentEpoch: bigint,
): RewardScanVerificationState {
  if (!cache.isVerified || cache.verifiedAt === null) {
    return { status: "idle", walletAddress, lastVerifiedAt: null, incomplete: false, error: null };
  }
  return {
    status: isRewardScanCacheCoveredForEpoch(cache, currentEpoch) ? "verified" : "stale",
    walletAddress,
    lastVerifiedAt: cache.verifiedAt,
    incomplete: false,
    error: null,
  };
}

export function getRewardScanFailureState({
  walletAddress,
  lastVerifiedAt,
  incomplete,
  message,
}: {
  walletAddress: string;
  lastVerifiedAt: number | null;
  incomplete: boolean;
  message: string;
}): RewardScanVerificationState {
  const hasVerifiedState = lastVerifiedAt !== null;
  return {
    status: hasVerifiedState ? "stale" : "error",
    walletAddress,
    lastVerifiedAt: hasVerifiedState ? lastVerifiedAt : null,
    incomplete,
    error: message,
  };
}

export function requireCompleteRewardScanMulticallResults(
  value: unknown,
  expectedLength: number,
  label: string,
): Array<{ result: unknown }> {
  if (!Number.isSafeInteger(expectedLength) || expectedLength < 0) {
    throw new RangeError("reward scan multicall expected length must be a non-negative safe integer");
  }
  if (!Array.isArray(value) || value.length !== expectedLength) {
    throw new RewardScanIncompleteError(`Reward scan incomplete: ${label} returned ${Array.isArray(value) ? value.length : "no"} results for ${expectedLength} calls`);
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new RewardScanIncompleteError(`Reward scan incomplete: ${label}[${index}] has no successful result`);
    }
    const row = item as { status?: unknown; result?: unknown; error?: unknown };
    if (row.status !== "success" || "error" in row || !("result" in row)) {
      throw new RewardScanIncompleteError(`Reward scan incomplete: ${label}[${index}] failed`);
    }
    return { result: row.result };
  });
}

function requireRewardScanValue<T>(value: unknown, predicate: (candidate: unknown) => candidate is T, label: string): T {
  if (!predicate(value)) throw new RewardScanIncompleteError(`Reward scan incomplete: ${label} returned an invalid result`);
  return value;
}

function isEpochTuple(value: unknown): value is EpochTuple {
  return Array.isArray(value)
    && value.length >= 4
    && typeof value[0] === "bigint"
    && typeof value[1] === "bigint"
    && typeof value[2] === "bigint"
    && typeof value[3] === "boolean";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isBigInt(value: unknown): value is bigint {
  return typeof value === "bigint";
}

export function normalizeRewardScanEpochString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

function normalizeRewardScanWeiString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

export function normalizeRewardScanWins(value: unknown): UnclaimedWin[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = (item ?? {}) as Partial<UnclaimedWin>;
      const epoch = normalizeRewardScanEpochString(row.epoch);
      const amountWei = normalizeRewardScanWeiString(row.amountWei);
      if (!epoch || !amountWei) return null;
      return { epoch, amountWei };
    })
    .filter((item): item is UnclaimedWin => item !== null);
}

export function compareRewardScanWinsDesc(left: UnclaimedWin, right: UnclaimedWin): number {
  const leftEpoch = normalizeRewardScanEpochString(left.epoch);
  const rightEpoch = normalizeRewardScanEpochString(right.epoch);
  if (!leftEpoch && !rightEpoch) return left.epoch.localeCompare(right.epoch);
  if (!leftEpoch) return 1;
  if (!rightEpoch) return -1;
  const a = BigInt(leftEpoch);
  const b = BigInt(rightEpoch);
  return a === b ? 0 : b > a ? 1 : -1;
}

function loadCachedRewardScan(address: string): CachedRewardScan {
  if (typeof localStorage === "undefined") return { ...EMPTY_REWARD_SCAN_CACHE };
  const v3Key = getRewardScanCacheKey(address, 3);
  const v2Key = getRewardScanCacheKey(address, 2);
  const v1Key = `lore:reward-scan:v1:${getAddress(address).toLowerCase()}`;
  try {
    const v3Raw = localStorage.getItem(v3Key);
    if (v3Raw) return parseRewardScanCacheEnvelope(JSON.parse(v3Raw), 3);
    const v2Raw = localStorage.getItem(v2Key);
    if (v2Raw) return parseRewardScanCacheEnvelope(JSON.parse(v2Raw), 2);
    const v1Raw = localStorage.getItem(v1Key);
    if (v1Raw) return parseRewardScanCacheEnvelope(JSON.parse(v1Raw), 2);
    return { ...EMPTY_REWARD_SCAN_CACHE };
  } catch {
    return { ...EMPTY_REWARD_SCAN_CACHE };
  }
}

function saveInvalidatedRewardScanCache(
  address: string,
  wins: UnclaimedWin[],
  lastScannedEpoch: string,
  deepestScannedEpoch: string,
  verifiedAt: number,
) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      getRewardScanCacheKey(address, 3),
      JSON.stringify({
        cacheVersion: 3,
        verifiedAt,
        savedAt: verifiedAt,
        invalidatedAt: Date.now(),
        lastScannedEpoch,
        deepestScannedEpoch,
        wins,
      } satisfies RewardScanCacheEnvelope),
    );
  } catch {
    // Leave the in-memory state stale when cache storage is unavailable.
  }
}
function saveCachedRewardScan(
  address: string,
  wins: UnclaimedWin[],
  lastScannedEpoch: string,
  deepestScannedEpoch: string,
): number {
  const verifiedAt = Date.now();
  if (typeof localStorage === "undefined") return verifiedAt;
  try {
    localStorage.setItem(
      getRewardScanCacheKey(address, 3),
      JSON.stringify({
        cacheVersion: 3,
        verifiedAt,
        savedAt: verifiedAt,
        lastScannedEpoch,
        deepestScannedEpoch,
        wins,
      } satisfies RewardScanCacheEnvelope),
    );
  } catch {
    // A completed live scan remains verified in memory even if storage is unavailable.
  }
  return verifiedAt;
}

function invalidateVerifiedRewardScanCache(address: string, wins: UnclaimedWin[]) {
  const cached = loadCachedRewardScan(address);
  if (!cached.isVerified || cached.verifiedAt === null || !cached.lastScannedEpoch || !cached.deepestScannedEpoch) return;
  saveInvalidatedRewardScanCache(
    address,
    wins,
    cached.lastScannedEpoch,
    cached.deepestScannedEpoch,
    cached.verifiedAt,
  );
}

export function getRewardScanRescanDelayMs(savedAt: number | null, now = Date.now()) {
  if (!savedAt) return 0;
  const age = now - savedAt;
  if (age < 0 || age >= REWARD_SCAN_CACHE_RESCAN_MS) return 0;
  return REWARD_SCAN_CACHE_RESCAN_MS - age;
}

export function formatRewardClaimError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "Reward claim status is unknown after a wallet timeout. Check wallet activity before retrying.";
  }
  if (isAmbiguousPendingTxError(err)) {
    return "Reward claim may already be pending. Check wallet activity before retrying.";
  }
  if (lower.includes("revert") || lower.includes("execution reverted")) {
    return "Reward claim reverted on-chain. No reward was moved by this transaction.";
  }
  if (lower.includes("rewardclaimwindowexpired") || lower.includes("claim window expired")) {
    return "This reward claim window has expired.";
  }
  if (lower.includes("notresolved")) return "Reward is not claimable yet because the epoch is not resolved.";
  if (lower.includes("already claimed") || lower.includes("hasclaimed") || lower.includes("claimed")) {
    return "This reward was already claimed.";
  }
  if (lower.includes("nothingtoclaim") || lower.includes("no reward")) {
    return "No reward is available for this epoch.";
  }
  if (lower.includes("insufficient funds") || lower.includes("not enough eth") || lower.includes("not enough funds")) {
    return "Reward claim failed: not enough balance or ETH for gas.";
  }
  if (lower.includes("rpc") || lower.includes("provider") || lower.includes("sendrawtransaction") || lower.includes("sendtransaction") || lower.includes("json-rpc")) {
    return "Reward claim hit a wallet or RPC issue. Check wallet activity before retrying.";
  }
  return "Claim failed. Please try again.";
}

function formatClaimTxMessage(message: string, hash: `0x${string}`) {
  const txUrl = getExplorerTxUrl(hash);
  return txUrl ? `${message} ${txUrl}` : message;
}

function chunkEpochIds(epochIds: string[], size: number) {
  const chunks: string[][] = [];
  for (let index = 0; index < epochIds.length; index += size) {
    chunks.push(epochIds.slice(index, index + size));
  }
  return chunks;
}

export function useRewardScanner(
  actualCurrentEpoch: bigint | undefined,
  options?: UseRewardScannerOptions,
) {
  const { address: connectedAddress } = useAccount();
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });
  const address = useMemo(() => {
    const candidate = options?.preferredAddress ?? connectedAddress;
    if (!candidate) return undefined;
    try {
      return getAddress(candidate);
    } catch {
      return undefined;
    }
  }, [connectedAddress, options?.preferredAddress]);
  const enabled = options?.enabled ?? true;
  const isPageVisible = options?.isPageVisible ?? true;
  const notify = options?.onNotify;
  const silentSend = options?.sendTransactionSilent;

  const [unclaimedWins, setUnclaimedWins] = useState<UnclaimedWin[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isDeepScanning, setIsDeepScanning] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [rewardScanState, setRewardScanState] = useState<RewardScanVerificationState>({
    status: "idle",
    walletAddress: address?.toLowerCase() ?? null,
    lastVerifiedAt: null,
    incomplete: false,
    error: null,
  });
  const scanAbortRef = useRef(false);
  const scanRunningRef = useRef(false);
  const activeScanKeyRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const lastScannedEpochRef = useRef<string | null>(null);
  const lastScannedAddressRef = useRef<string | null>(null);
  const lastVerifiedAtRef = useRef<number | null>(null);
  const lastVerifiedAddressRef = useRef<string | null>(null);
  const cacheSavedAtRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const claimInFlightRef = useRef(false);
  const activeClaimAddressRef = useRef<string | undefined>(address?.toLowerCase());
  activeClaimAddressRef.current = address?.toLowerCase();
  const previousAddressRef = useRef<string | undefined>(undefined);
  const unclaimedWinsRef = useRef(unclaimedWins);
  unclaimedWinsRef.current = unclaimedWins;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      scanAbortRef.current = true;
      scanRunningRef.current = false;
      activeScanKeyRef.current = null;
    };
  }, []);

  const waitReceipt = useCallback(
    async (hash: `0x${string}`, intent: ClaimTransactionIntent): Promise<ReceiptState> => {
      return waitForClaimTransactionReceiptAgreement(intent, hash, TX_RECEIPT_TIMEOUT_MS);
    },
    [],
  );

  const estimateClaimGas = useCallback(
    async (epochId: string) => {
      if (!publicClient || !address) return CLAIM_GAS_FALLBACK;
      const data = encodeFunctionData({
        abi: GAME_ABI,
        functionName: "claimReward",
        args: [BigInt(epochId)],
      });
      try {
        const estimatedGas = await publicClient.estimateGas({
          account: address as `0x${string}`,
          to: CONTRACT_ADDRESS,
          data,
        });
        return (estimatedGas * CLAIM_GAS_HEADROOM_BPS) / BPS_DENOMINATOR + CLAIM_GAS_BUFFER;
      } catch {
        return CLAIM_GAS_FALLBACK;
      }
    },
    [address, publicClient],
  );

  const estimateBatchClaimGas = useCallback(
    async (epochIds: string[]) => {
      if (epochIds.length === 0) return CLAIM_GAS_FALLBACK;
      if (!publicClient || !address) {
        return CLAIM_GAS_FALLBACK * BigInt(epochIds.length);
      }
      const data = encodeFunctionData({
        abi: GAME_ABI,
        functionName: "claimRewards",
        args: [epochIds.map((epochId) => BigInt(epochId))],
      });
      try {
        const estimatedGas = await publicClient.estimateGas({
          account: address as `0x${string}`,
          to: CONTRACT_ADDRESS,
          data,
        });
        return (estimatedGas * CLAIM_GAS_HEADROOM_BPS) / BPS_DENOMINATOR + CLAIM_GAS_BUFFER;
      } catch {
        return CLAIM_GAS_FALLBACK * BigInt(epochIds.length);
      }
    },
    [address, publicClient],
  );

  const prepareClaimTx = useCallback(
    async (epochId: string) => {
      const data = encodeFunctionData({
        abi: GAME_ABI,
        functionName: "claimReward",
        args: [BigInt(epochId)],
      });

      if (publicClient && address) {
        await publicClient.simulateContract({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "claimReward",
          args: [BigInt(epochId)],
          account: address as `0x${string}`,
        });
      }

      const gas = await estimateClaimGas(epochId);
      return { data, gas };
    },
    [address, estimateClaimGas, publicClient],
  );

  const prepareBatchClaimTx = useCallback(
    async (epochIds: string[]) => {
      const epochArgs = epochIds.map((epochId) => BigInt(epochId));
      const data = encodeFunctionData({
        abi: GAME_ABI,
        functionName: "claimRewards",
        args: [epochArgs],
      });

      if (publicClient && address) {
        await publicClient.simulateContract({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "claimRewards",
          args: [epochArgs],
          account: address as `0x${string}`,
        });
      }

      const gas = await estimateBatchClaimGas(epochIds);
      return { data, gas };
    },
    [address, estimateBatchClaimGas, publicClient],
  );

  const confirmClaimedEpochs = useCallback(
    async (epochIds: string[]) => {
      if (!publicClient || !address || epochIds.length === 0) {
        return new Set(epochIds);
      }
      const results = await publicClient.multicall({
        contracts: epochIds.map((epochId) => ({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "hasClaimed" as const,
          args: [address, BigInt(epochId)],
        })),
      });
      const claimed = new Set<string>();
      epochIds.forEach((epochId, index) => {
        if (results[index]?.result === true) {
          claimed.add(epochId);
        }
      });
      return claimed;
    },
    [address, publicClient],
  );

  const scanRewards = useCallback(async () => {
    if (!enabled || !isPageVisible || !publicClient || !actualCurrentEpoch || !address) return;
    const normalizedAddress = address.toLowerCase();
    const epochKey = actualCurrentEpoch.toString();
    const scanKey = `${normalizedAddress}:${epochKey}`;
    if (scanRunningRef.current && activeScanKeyRef.current === scanKey) return;

    // Load cache to determine scan boundaries
    const cached = loadCachedRewardScan(normalizedAddress);
    const cachedLastScanned = cached.lastScannedEpoch ? BigInt(cached.lastScannedEpoch) : null;
    const cachedDeepest = cached.deepestScannedEpoch ? BigInt(cached.deepestScannedEpoch) : null;
    const cacheCoversCurrentEpoch = isRewardScanCacheCoveredForEpoch(cached, actualCurrentEpoch);
    const hasInMemoryVerification = lastVerifiedAddressRef.current === normalizedAddress
      && lastVerifiedAtRef.current !== null;
    const lastVerifiedAt = hasInMemoryVerification
      ? lastVerifiedAtRef.current
      : cached.isVerified ? cached.verifiedAt : null;
    const hasVerifiedState = lastVerifiedAt !== null;
    const preservedWins = hasInMemoryVerification ? unclaimedWinsRef.current : cached.wins;

    // Skip if we already scanned up to this epoch and have results in memory
    if (
      lastScannedEpochRef.current === epochKey &&
      lastScannedAddressRef.current === normalizedAddress &&
      unclaimedWinsRef.current.length > 0
    ) {
      return;
    }

    const requestId = ++requestIdRef.current;
    const shouldShowScanning = unclaimedWinsRef.current.length === 0;
    scanRunningRef.current = true;
    activeScanKeyRef.current = scanKey;
    scanAbortRef.current = false;
    if (mountedRef.current) {
      setIsScanning(shouldShowScanning);
      setIsDeepScanning(false);
      setRewardScanState({
        status: hasVerifiedState ? "refreshing" : "loading",
        walletAddress: normalizedAddress,
        lastVerifiedAt,
        incomplete: false,
        error: null,
      });
    }

    try {
      const chainTimestamp = (await publicClient.getBlock({ blockTag: "latest" })).timestamp;
      // Start with any cached wins (they'll be re-validated for claimed status)
      const wins: UnclaimedWin[] = [];
      const { startEpoch, minEpoch, quickMinEpoch } = getAutomaticRewardScanBounds(actualCurrentEpoch);
      const mergeWins = (list: UnclaimedWin[]) => {
        const byEpoch = new Map<string, UnclaimedWin>();
        for (const w of list) byEpoch.set(w.epoch, w);
        return [...byEpoch.values()].sort(compareRewardScanWinsDesc);
      };

      const scanRange = async (rangeStart: bigint, rangeMin: bigint) => {
        if (rangeStart < rangeMin) return;
        for (const epochIds of iterateDescendingRewardScanEpochChunks(
          rangeStart,
          rangeMin,
          REWARD_SCAN_CHUNK_SIZE,
        )) {
          if (scanAbortRef.current) return;
          if (requestId !== requestIdRef.current) return;

          const [epochResults, claimResults, dustSettledResults] = await Promise.all([
            publicClient.multicall({
              contracts: epochIds.map((id) => ({
                address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "epochs" as const, args: [id],
              })),
            }),
            publicClient.multicall({
              contracts: epochIds.map((id) => ({
                address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "hasClaimed" as const, args: [address, id],
              })),
            }),
            publicClient.multicall({
              contracts: epochIds.map((id) => ({
                address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "epochDustSettled" as const, args: [id],
              })),
            }),
          ]);
          if (requestId !== requestIdRef.current) return;

          const completeEpochResults = requireCompleteRewardScanMulticallResults(epochResults, epochIds.length, "epochs");
          const completeClaimResults = requireCompleteRewardScanMulticallResults(claimResults, epochIds.length, "hasClaimed");
          const completeDustSettledResults = requireCompleteRewardScanMulticallResults(dustSettledResults, epochIds.length, "epochDustSettled");
          const potentialWins: { id: bigint; winTile: bigint; rewardPool: bigint }[] = [];
          epochIds.forEach((id, index) => {
            const epRes = requireRewardScanValue(completeEpochResults[index]?.result, isEpochTuple, `epochs[${index}]`);
            const claimed = requireRewardScanValue(completeClaimResults[index]?.result, isBoolean, `hasClaimed[${index}]`);
            const dustSettled = requireRewardScanValue(completeDustSettledResults[index]?.result, isBoolean, `epochDustSettled[${index}]`);
            if (claimed === false && dustSettled !== true && epRes[3]) {
              potentialWins.push({ id, rewardPool: epRes[1], winTile: epRes[2] });
            }
          });

          if (potentialWins.length > 0) {
            const [betResults, tilePoolResults, resolvedAtResults] = await Promise.all([
              publicClient.multicall({
                contracts: potentialWins.map((w) => ({
                  address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "userBets" as const, args: [w.id, w.winTile, address],
                })),
              }),
              publicClient.multicall({
                contracts: potentialWins.map((w) => ({
                  address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "tilePools" as const, args: [w.id, w.winTile],
                })),
              }),
              publicClient.multicall({
                contracts: potentialWins.map((w) => ({
                  address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "epochResolvedAt" as const, args: [w.id],
                })),
              }),
            ]);
            if (requestId !== requestIdRef.current) return;

            const completeBetResults = requireCompleteRewardScanMulticallResults(betResults, potentialWins.length, "userBets");
            const completeTilePoolResults = requireCompleteRewardScanMulticallResults(tilePoolResults, potentialWins.length, "tilePools");
            const completeResolvedAtResults = requireCompleteRewardScanMulticallResults(resolvedAtResults, potentialWins.length, "epochResolvedAt");
            completeBetResults.forEach((item, index) => requireRewardScanValue(item.result, isBigInt, `userBets[${index}]`));
            completeTilePoolResults.forEach((item, index) => requireRewardScanValue(item.result, isBigInt, `tilePools[${index}]`));
            completeResolvedAtResults.forEach((item, index) => requireRewardScanValue(item.result, isBigInt, `epochResolvedAt[${index}]`));
            wins.push(...collectOpenRewardScanWins({
              potentialWins,
              betResults: completeBetResults,
              tilePoolResults: completeTilePoolResults,
              resolvedAtResults: completeResolvedAtResults,
              chainTimestamp,
            }));
          }
        }
      };

      // --- Incremental scanning logic ---
      // If we have a valid cache, only scan the gap: [cachedLastScanned .. currentEpoch-1]
      // Then re-validate cached wins to remove any that were claimed since last scan.
      const hasValidCache = cacheCoversCurrentEpoch && cachedLastScanned != null && cachedLastScanned > BigInt(0);
      if (hasValidCache && cachedLastScanned! < startEpoch) {
        // Incremental: scan only new epochs (from current-1 down to cachedLastScanned)
        await scanRange(startEpoch, cachedLastScanned!);
        if (scanAbortRef.current || requestId !== requestIdRef.current) return;

        // Re-validate cached wins: check if any were claimed or dust-settled since last scan
        if (cached.wins.length > 0) {
          for (const cachedWinChunk of chunkRewardScanItems(cached.wins, REWARD_SCAN_CHUNK_SIZE_NUMBER)) {
            if (scanAbortRef.current || requestId !== requestIdRef.current) return;
            const cachedEpochIds = cachedWinChunk.map((w) => w.epoch);
            const [claimChecks, dustChecks, resolvedAtChecks] = await Promise.all([
              publicClient.multicall({
                contracts: cachedEpochIds.map((epochId) => ({
                  address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "hasClaimed" as const, args: [address, BigInt(epochId)],
                })),
              }),
              publicClient.multicall({
                contracts: cachedEpochIds.map((epochId) => ({
                  address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "epochDustSettled" as const, args: [BigInt(epochId)],
                })),
              }),
              publicClient.multicall({
                contracts: cachedEpochIds.map((epochId) => ({
                  address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "epochResolvedAt" as const, args: [BigInt(epochId)],
                })),
              }),
            ]);
            if (scanAbortRef.current || requestId !== requestIdRef.current) return;

            const completeClaimChecks = requireCompleteRewardScanMulticallResults(claimChecks, cachedWinChunk.length, "cached hasClaimed");
            const completeDustChecks = requireCompleteRewardScanMulticallResults(dustChecks, cachedWinChunk.length, "cached epochDustSettled");
            const completeResolvedAtChecks = requireCompleteRewardScanMulticallResults(resolvedAtChecks, cachedWinChunk.length, "cached epochResolvedAt");
            cachedWinChunk.forEach((w, index) => {
              const claimed = requireRewardScanValue(completeClaimChecks[index]?.result, isBoolean, `cached hasClaimed[${index}]`);
              const dustSettled = requireRewardScanValue(completeDustChecks[index]?.result, isBoolean, `cached epochDustSettled[${index}]`);
              const resolvedAt = requireRewardScanValue(completeResolvedAtChecks[index]?.result, isBigInt, `cached epochResolvedAt[${index}]`);
              if (claimed !== true && dustSettled !== true && isRewardClaimWindowOpen(resolvedAt, chainTimestamp)) {
                wins.push(w);
              }
            });
          }
        }


        // If the previous deep scan didn't reach minEpoch, continue the deep scan
        const needsDeepExtension = cachedDeepest != null && cachedDeepest > minEpoch;
        if (needsDeepExtension) {
          if (mountedRef.current && shouldShowScanning) {
            setIsDeepScanning(true);
          }
          await scanRange(cachedDeepest! - BigInt(1), minEpoch);
          if (scanAbortRef.current || requestId !== requestIdRef.current) return;
        }
      } else {
        // Full scan: no usable cache, scan everything in two phases (fast + deep)
        await scanRange(startEpoch, quickMinEpoch);
        if (scanAbortRef.current || requestId !== requestIdRef.current) return;
        if (quickMinEpoch > minEpoch) {
          if (mountedRef.current && shouldShowScanning) {
            setIsDeepScanning(true);
          }
          await scanRange(quickMinEpoch - BigInt(1), minEpoch);
          if (scanAbortRef.current || requestId !== requestIdRef.current) return;
        }
      }

      const mergedWins = mergeWins(wins);
      const verifiedAt = saveCachedRewardScan(normalizedAddress, mergedWins, epochKey, minEpoch.toString());
      lastScannedEpochRef.current = epochKey;
      lastScannedAddressRef.current = normalizedAddress;
      lastVerifiedAtRef.current = verifiedAt;
      lastVerifiedAddressRef.current = normalizedAddress;
      cacheSavedAtRef.current = verifiedAt;
      if (requestId === requestIdRef.current && mountedRef.current) {
        setUnclaimedWins(mergedWins);
        setRewardScanState({
          status: "verified",
          walletAddress: normalizedAddress,
          lastVerifiedAt: verifiedAt,
          incomplete: false,
          error: null,
        });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const incomplete = e instanceof RewardScanIncompleteError;
      log.warn("RewardScanner", "scan error", { message });
      if (requestId === requestIdRef.current && mountedRef.current) {
        if (hasVerifiedState) setUnclaimedWins(preservedWins);
        setRewardScanState(getRewardScanFailureState({
          walletAddress: normalizedAddress,
          lastVerifiedAt,
          incomplete,
          message,
        }));
      }
    } finally {
      if (requestId === requestIdRef.current) {
        if (mountedRef.current) {
          setIsDeepScanning(false);
          setIsScanning(false);
        }
        scanRunningRef.current = false;
        activeScanKeyRef.current = null;
      }
    }
  }, [address, actualCurrentEpoch, enabled, isPageVisible, publicClient]);

  useEffect(() => {
    if (!enabled || !isPageVisible || !address || !actualCurrentEpoch) return;
    const normalizedAddress = address.toLowerCase();
    const cached = loadCachedRewardScan(normalizedAddress);
    const cacheCoversCurrentEpoch = isRewardScanCacheCoveredForEpoch(cached, actualCurrentEpoch);
    cacheSavedAtRef.current = cached.isVerified ? cached.verifiedAt : null;
    lastVerifiedAtRef.current = cached.isVerified ? cached.verifiedAt : null;
    lastVerifiedAddressRef.current = cached.isVerified ? normalizedAddress : null;

    // A v3 snapshot may be shown as stale, but only current-epoch coverage may defer a refresh.
    if (mountedRef.current) {
      setUnclaimedWins(cached.isVerified ? cached.wins : []);
      setRewardScanState(getCachedRewardScanState(cached, normalizedAddress, actualCurrentEpoch));
    }

    // Missing coverage, including an invalidated post-claim cache, refreshes immediately.
    const remaining = getRewardScanRescanDelayMs(cacheCoversCurrentEpoch ? cached.verifiedAt : null);
    if (remaining > 0) {
      const timeoutId = window.setTimeout(() => {
        void scanRewards();
      }, remaining);
      return () => window.clearTimeout(timeoutId);
    }

    // Cache is stale or missing — scan immediately (incremental if cache exists)
    void scanRewards();
  }, [actualCurrentEpoch, address, enabled, isPageVisible, scanRewards]);

  useEffect(() => {
    if (previousAddressRef.current === undefined) {
      previousAddressRef.current = address;
      return;
    }
    if (previousAddressRef.current === address) {
      return;
    }
    previousAddressRef.current = address;

    requestIdRef.current += 1;
    scanAbortRef.current = true;
    scanRunningRef.current = false;
    activeScanKeyRef.current = null;
    lastScannedEpochRef.current = null;
    lastScannedAddressRef.current = null;
    lastVerifiedAtRef.current = null;
    lastVerifiedAddressRef.current = null;
    if (mountedRef.current) {
      setUnclaimedWins([]);
      setIsScanning(false);
      setIsDeepScanning(false);
      setRewardScanState({
        status: "idle",
        walletAddress: address?.toLowerCase() ?? null,
        lastVerifiedAt: null,
        incomplete: false,
        error: null,
      });
    }
  }, [address]);

  const claimReward = useCallback(
    async (epochId: string) => {
      if (!silentSend || !address) {
        notify?.("Wallet is not ready to claim yet. Please try again in a moment.", "warning");
        return;
      }
      if (claimInFlightRef.current) return;
      claimInFlightRef.current = true;
      const claimActor = address.toLowerCase();

      if (mountedRef.current) {
        setIsClaiming(true);
      }
      let submittedHash: `0x${string}` | null = null;
      let claimLease: { release: () => void } | null = null;
      try {
        claimLease = await acquireEoaNonceLockLease({ chainId: APP_CHAIN_ID, actor: claimActor });
        notify?.("Preparing reward claim.", "info");
        const { data, gas } = await prepareClaimTx(epochId);
        if (activeClaimAddressRef.current !== claimActor) return;
        const hash = await silentSend({ to: CONTRACT_ADDRESS, data, gas });
        submittedHash = hash;
        invalidateVerifiedRewardScanCache(claimActor, unclaimedWinsRef.current);
        if (mountedRef.current) {
          setRewardScanState((previous) => previous.walletAddress === claimActor
            ? { ...previous, status: "stale", incomplete: false, error: null }
            : previous);
        }
        const receiptState = await waitReceipt(hash, {
          actor: claimActor,
          chainId: APP_CHAIN_ID,
          contract: CONTRACT_ADDRESS,
          calldata: data,
        });
        if (activeClaimAddressRef.current !== claimActor) return;
        if (receiptState === "pending") {
          notify?.(
            formatClaimTxMessage("Claim transaction submitted and is still pending. Rewards will refresh after confirmation.", hash),
            "info",
          );
          void scanRewards();
          return;
        }
        if (mountedRef.current) {
          const nextWins = unclaimedWinsRef.current.filter((w) => w.epoch !== epochId);
          unclaimedWinsRef.current = nextWins;
          setUnclaimedWins(nextWins);
          invalidateVerifiedRewardScanCache(claimActor, nextWins);
          setRewardScanState((previous) => previous.walletAddress === claimActor
            ? { ...previous, status: "stale", incomplete: false, error: null }
            : previous);
        }
        notify?.(formatClaimTxMessage("Reward claimed successfully.", hash), "success");
      } catch (err) {
        if (activeClaimAddressRef.current !== claimActor) return;
        if (submittedHash && err instanceof ClaimTransactionIntentError) {
          notify?.(
            formatClaimTxMessage("Claim transaction submitted and is still pending. Rewards will refresh after confirmation.", submittedHash),
            "info",
          );
          void scanRewards();
        } else if (isAmbiguousPendingTxError(err)) {
          notify?.("Reward claim may already be pending. Check wallet activity and refresh rewards before retrying.", "warning");
          void scanRewards();
        } else if (!isUserRejection(err)) {
          log.warn("RewardScanner", "claim error", { message: err instanceof Error ? err.message : String(err) });
          notify?.(formatRewardClaimError(err), "danger");
          void scanRewards();
        } else {
          notify?.("Reward claim rejected in wallet.", "info");
        }
      } finally {
        claimLease?.release();
        claimInFlightRef.current = false;
        if (mountedRef.current) {
          setIsClaiming(false);
        }
      }
    },
    [actualCurrentEpoch, address, notify, prepareClaimTx, scanRewards, silentSend, waitReceipt],
  );

  const claimAll = useCallback(async () => {
    if (unclaimedWins.length === 0 || !silentSend || !address || claimInFlightRef.current) return;
    claimInFlightRef.current = true;
    const claimActor = address.toLowerCase();
    if (mountedRef.current) {
      setIsClaiming(true);
    }
    let claimLease: { release: () => void } | null = null;

    try {
      claimLease = await acquireEoaNonceLockLease({ chainId: APP_CHAIN_ID, actor: claimActor });
      const all = [...unclaimedWins];
      const claimedEpochs = new Set<string>();
      let skippedEpochs = 0;
      let claimTxCount = 0;
      let claimRejected = false;
      let claimActorChanged = false;
      let lastRewardClaimTxHash: `0x${string}` | null = null;
      notify?.("Preparing reward claims.", "info");

      const submitSingleClaim = async (epochId: string) => {
        if (activeClaimAddressRef.current !== claimActor) {
          claimActorChanged = true;
          return null;
        }
        const { data, gas } = await prepareClaimTx(epochId);
        if (activeClaimAddressRef.current !== claimActor) {
          claimActorChanged = true;
          return null;
        }
        const hash = await silentSend({ to: CONTRACT_ADDRESS, data, gas });
        lastRewardClaimTxHash = hash;
        claimTxCount += 1;
        invalidateVerifiedRewardScanCache(claimActor, unclaimedWinsRef.current);
        if (mountedRef.current) {
          setRewardScanState((previous) => previous.walletAddress === claimActor
            ? { ...previous, status: "stale", incomplete: false, error: null }
            : previous);
        }
        const receiptState = await waitReceipt(hash, {
          actor: claimActor,
          chainId: APP_CHAIN_ID,
          contract: CONTRACT_ADDRESS,
          calldata: data,
        });
        if (activeClaimAddressRef.current !== claimActor) {
          claimActorChanged = true;
          return null;
        }
        if (receiptState === "pending") return receiptState;
        claimedEpochs.add(epochId);
        return receiptState;
      };

      const submitBatchClaim = async (epochIds: string[]) => {
        if (activeClaimAddressRef.current !== claimActor) {
          claimActorChanged = true;
          return null;
        }
        const { data, gas } = await prepareBatchClaimTx(epochIds);
        if (activeClaimAddressRef.current !== claimActor) {
          claimActorChanged = true;
          return null;
        }
        const hash = await silentSend({ to: CONTRACT_ADDRESS, data, gas });
        lastRewardClaimTxHash = hash;
        claimTxCount += 1;
        invalidateVerifiedRewardScanCache(claimActor, unclaimedWinsRef.current);
        if (mountedRef.current) {
          setRewardScanState((previous) => previous.walletAddress === claimActor
            ? { ...previous, status: "stale", incomplete: false, error: null }
            : previous);
        }
        const receiptState = await waitReceipt(hash, {
          actor: claimActor,
          chainId: APP_CHAIN_ID,
          contract: CONTRACT_ADDRESS,
          calldata: data,
        });
        if (activeClaimAddressRef.current !== claimActor) {
          claimActorChanged = true;
          return null;
        }
        if (receiptState === "pending") return receiptState;
        const confirmedClaimed = await confirmClaimedEpochs(epochIds);
        confirmedClaimed.forEach((epochId) => claimedEpochs.add(epochId));
        if (confirmedClaimed.size === 0) {
          throw new Error("Batch claim confirmed without claimed epochs");
        }
        return receiptState;
      };

      const queue: string[][] = chunkEpochIds(
        all.map((win) => win.epoch),
        MAX_BATCH_CLAIM_EPOCHS,
      );
      let pendingClaimTx = false;

      while (queue.length > 0) {
        const batch = queue.shift();
        if (!batch || batch.length === 0) continue;

        try {
          let receiptState: ReceiptState | null;
          if (batch.length === 1) {
            receiptState = await submitSingleClaim(batch[0]);
          } else {
            receiptState = await submitBatchClaim(batch);
          }
          if (receiptState === null) break;
          if (receiptState === "pending") {
            pendingClaimTx = true;
            break;
          }
        } catch (err) {
          if (activeClaimAddressRef.current !== claimActor) {
            claimActorChanged = true;
            break;
          }
          if (isAmbiguousPendingTxError(err) || err instanceof ClaimTransactionIntentError) {
            pendingClaimTx = true;
            break;
          }
          if (isUserRejection(err)) {
            claimRejected = true;
            break;
          }
          if (batch.length === 1) {
            skippedEpochs += 1;
            continue;
          }
          const middle = Math.ceil(batch.length / 2);
          queue.unshift(batch.slice(middle));
          queue.unshift(batch.slice(0, middle));
        }
      }

      if (claimActorChanged || activeClaimAddressRef.current !== claimActor) return;
      if (claimedEpochs.size > 0) {
        if (mountedRef.current) {
          const nextWins = unclaimedWinsRef.current.filter((w) => !claimedEpochs.has(w.epoch));
          unclaimedWinsRef.current = nextWins;
          setUnclaimedWins(nextWins);
          invalidateVerifiedRewardScanCache(claimActor, nextWins);
          setRewardScanState((previous) => previous.walletAddress === claimActor
            ? { ...previous, status: "stale", incomplete: false, error: null }
            : previous);
        }
        notify?.(
          lastRewardClaimTxHash
            ? formatClaimTxMessage(
                claimedEpochs.size === 1
                  ? claimTxCount <= 1
                    ? "1 reward claimed successfully."
                    : `1 reward claimed successfully in ${claimTxCount} transactions.`
                  : claimTxCount <= 1
                    ? `${claimedEpochs.size} rewards claimed successfully in 1 transaction.`
                    : `${claimedEpochs.size} rewards claimed successfully in ${claimTxCount} transactions.`,
                lastRewardClaimTxHash,
              )
            : claimedEpochs.size === 1
              ? claimTxCount <= 1
                ? "1 reward claimed successfully."
                : `1 reward claimed successfully in ${claimTxCount} transactions.`
              : claimTxCount <= 1
                ? `${claimedEpochs.size} rewards claimed successfully in 1 transaction.`
                : `${claimedEpochs.size} rewards claimed successfully in ${claimTxCount} transactions.`,
          "success",
        );
      }
      if (skippedEpochs > 0) {
        void scanRewards();
        if (claimedEpochs.size === 0) {
          notify?.("Some rewards are no longer claimable. Reward state has been refreshed.", "info");
        }
      }
      if (pendingClaimTx) {
        notify?.(
          lastRewardClaimTxHash
            ? formatClaimTxMessage("Claim transaction submitted and is still pending. Rewards will refresh after confirmation.", lastRewardClaimTxHash)
            : "Claim transaction submitted and is still pending. Rewards will refresh after confirmation.",
          "info",
        );
        void scanRewards();
      }
      if (claimRejected && claimedEpochs.size === 0 && !pendingClaimTx) {
        notify?.("Reward claim rejected in wallet.", "info");
      }
    } finally {
      claimLease?.release();
      claimInFlightRef.current = false;
      if (mountedRef.current) {
        setIsClaiming(false);
      }
    }
  }, [
    actualCurrentEpoch,
    address,
    confirmClaimedEpochs,
    notify,
    prepareBatchClaimTx,
    prepareClaimTx,
    scanRewards,
    unclaimedWins,
    silentSend,
    waitReceipt,
  ]);

  return useMemo(
    () => ({
      unclaimedWins,
      isScanning,
      isDeepScanning,
      isClaiming,
      rewardScanState,
      scanRewards,
      claimReward,
      claimAll,
    }),
    [claimAll, claimReward, isClaiming, isDeepScanning, isScanning, rewardScanState, scanRewards, unclaimedWins],
  );
}
