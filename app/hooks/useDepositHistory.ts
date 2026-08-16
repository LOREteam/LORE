"use client";

import { log } from "../lib/logger";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAddress } from "viem";
import { APP_CHAIN_ID, CONTRACT_ADDRESS, GRID_SIZE } from "../lib/constants";
import {
  computeWinningAmountWei,
  formatLineaAmountFixed,
  formatLineaWeiDisplayNumber,
  normalizeTileAmounts,
  parseLineaAmountWei,
} from "../lib/tokenAmountMath";
import { getFreshCacheDelayMs } from "../lib/cacheTimestamp";
import { fetchWithTimeout } from "../lib/fetchWithTimeout";
import { readJsonResponse } from "../lib/readJsonResponse";
import { loadReadModelCache, type ReadModelCacheStorage } from "../lib/readModelCache";

export interface DepositEntry {
  epoch: string;
  tileIds: number[];
  amounts: number[];
  amount: string;
  amountNum: number;
  txHash: string;
  blockNumber: string;
  blockNumberNum: number;
  winningTile: number | null;
  isDailyJackpot: boolean;
  isWeeklyJackpot: boolean;
  reward: number | null;
}

interface ApiDeposit {
  epoch: string;
  tileIds: number[];
  totalAmount: string;
  totalAmountNum: number;
  txHash: string;
  blockNumber: string;
  amounts?: string[];
}

interface ApiEpoch {
  winningTile: number;
  rewardPool: string;
  isDailyJackpot?: boolean;
  isWeeklyJackpot?: boolean;
}

interface ApiRewardInfo {
  reward: string;
  winningTile: number;
  rewardPool: string;
  winningTilePool: string;
  userWinningAmount: string;
}

interface DepositCacheEnvelope {
  savedAt?: number;
  data?: DepositEntry[];
}

const DEPOSIT_CACHE_TTL_MS = 30_000;
const DEPOSIT_CACHE_WRITE_MIN_MS = 120_000;
const DEPOSIT_CACHE_ENTRY_LIMIT = 500;
const SYNC_EPOCH_PREFETCH_LIMIT = 64;
const EPOCHS_FETCH_CHUNK = 100;
const REWARDS_FETCH_CHUNK = 200;
const DEPOSIT_HISTORY_LOAD_ERROR = "Deposit history is temporarily unavailable. Refresh the Analytics tab to retry.";

type DepositHistoryFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function parseSafeNonNegativeIntegerNumber(value: string | null | undefined): number {
  if (!value || !/^(?:0|[1-9]\d*)$/.test(value)) return 0;
  const parsed = BigInt(value);
  return parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : 0;
}

function parseSafePositiveIntegerNumber(value: string | null | undefined): number {
  const parsed = parseSafeNonNegativeIntegerNumber(value);
  return parsed > 0 ? parsed : 0;
}

function toDisplayNumberWei(value: bigint): number {
  return formatLineaWeiDisplayNumber(value);
}

function getDepositCacheKey(userAddress: string) {
  return `lore:deposits:v2:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}:${getAddress(userAddress).toLowerCase()}`;
}

function normalizeDepositUserAddress(userAddress: string | null | undefined): `0x${string}` | null {
  if (!userAddress) return null;
  try {
    return getAddress(userAddress).toLowerCase() as `0x${string}`;
  } catch {
    return null;
  }
}

function normalizeDepositTxHash(value: unknown): `0x${string}` | "" {
  const normalized = String(value ?? "").toLowerCase().trim();
  return /^0x[0-9a-f]{64}$/.test(normalized) ? (normalized as `0x${string}`) : "";
}

function normalizeCachedNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeCachedDisplayNumber)
    .filter((item): item is number => item !== null);
}

function normalizeCachedTileIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeCachedIntegerNumber)
    .filter((item): item is number => item !== null && item >= 1 && item <= GRID_SIZE);
}

function normalizeCachedIntegerNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^(?:0|[1-9]\d*)$/.test(text)) return null;
  const parsed = BigInt(text);
  return parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : null;
}

function normalizeCachedDisplayNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeCachedDepositEntry(value: unknown): DepositEntry | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<DepositEntry>;
  const epoch = typeof item.epoch === "string" && parseSafePositiveIntegerNumber(item.epoch) > 0 ? item.epoch : null;
  const blockNumber = typeof item.blockNumber === "string" && parseSafePositiveIntegerNumber(item.blockNumber) > 0 ? item.blockNumber : null;
  const txHash = normalizeDepositTxHash(item.txHash);
  const amount = typeof item.amount === "string" && item.amount.length <= 80 ? item.amount : null;
  if (!epoch || !blockNumber || !txHash || !amount) return null;

  const tileIds = normalizeCachedTileIds(item.tileIds);
  const winningTile = normalizeCachedIntegerNumber(item.winningTile);
  return {
    epoch,
    tileIds,
    amounts: normalizeCachedNumberArray(item.amounts).slice(0, tileIds.length),
    amount,
    amountNum: normalizeCachedDisplayNumber(item.amountNum) ?? 0,
    txHash,
    blockNumber,
    blockNumberNum: parseSafeNonNegativeIntegerNumber(blockNumber),
    winningTile: winningTile !== null && winningTile >= 1 && winningTile <= GRID_SIZE
      ? winningTile
      : null,
    isDailyJackpot: item.isDailyJackpot === true,
    isWeeklyJackpot: item.isWeeklyJackpot === true,
    reward: normalizeCachedDisplayNumber(item.reward),
  };
}

export function normalizeCachedDepositEntries(value: unknown): DepositEntry[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .slice(0, DEPOSIT_CACHE_ENTRY_LIMIT)
    .map(normalizeCachedDepositEntry)
    .filter((item): item is DepositEntry => item !== null);
}

export function loadDepositHistoryCache(
  userAddress: string,
  storage: ReadModelCacheStorage | null = typeof localStorage === "undefined" ? null : localStorage,
  now = Date.now(),
): { data: DepositEntry[] | null; savedAt: number | null } {
  const cacheKey = getDepositCacheKey(userAddress);
  const restored = loadReadModelCache<DepositEntry[] | null>({
    storage,
    cacheKey,
    payloadKey: "data",
    emptyValue: null,
    normalizePayload: normalizeCachedDepositEntries,
    acceptPayload: ({ rawPayload, value, legacy }) =>
      value !== null &&
      (!legacy || !Array.isArray(rawPayload) || rawPayload.length === 0 || value.length > 0),
    now,
  });
  return { data: restored.value, savedAt: restored.savedAt };
}

export function getDepositHistoryRefreshDelay(savedAt: unknown, now = Date.now()) {
  return getFreshCacheDelayMs(savedAt, DEPOSIT_CACHE_TTL_MS, now);
}

export function getDepositHistoryLoadError() {
  return DEPOSIT_HISTORY_LOAD_ERROR;
}

function saveCachedDeposits(userAddress: string, entries: DepositEntry[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      getDepositCacheKey(userAddress),
      JSON.stringify({
        savedAt: Date.now(),
        data: entries,
      } satisfies DepositCacheEnvelope),
    );
  } catch {
    // ignore storage failures
  }
}

export async function fetchDepositHistoryPayload(
  userAddress: string,
  fetchImpl: DepositHistoryFetch = fetchWithTimeout,
) {
  const response = await fetchImpl(`/api/deposits?user=${userAddress}`, { cache: "no-store" });
  const payload = await readJsonResponse<{
    deposits?: ApiDeposit[];
    epochs?: Record<string, ApiEpoch>;
    rewards?: Record<string, ApiRewardInfo>;
    error?: string;
  }>(response);
  if (!payload) throw new Error(`Deposit history returned empty JSON (HTTP ${response.status})`);
  if (!response.ok || payload.error) {
    throw new Error(`Deposit history request failed (HTTP ${response.status})`);
  }
  return payload;
}

export async function fetchEpochMap(
  epochIds: string[],
  fetchImpl: DepositHistoryFetch = fetchWithTimeout,
) {
  if (epochIds.length === 0) return {} as Record<string, ApiEpoch>;

  const merged: Record<string, ApiEpoch> = {};
  for (let index = 0; index < epochIds.length; index += EPOCHS_FETCH_CHUNK) {
    const chunk = epochIds.slice(index, index + EPOCHS_FETCH_CHUNK);
    const epochsQuery = encodeURIComponent(chunk.join(","));
    const response = await fetchImpl(`/api/epochs?epochs=${epochsQuery}`, { cache: "no-store" });
    if (!response.ok) continue;
    try {
      const json = await readJsonResponse<{ epochs?: Record<string, ApiEpoch> }>(response) ?? {};
      Object.assign(merged, json.epochs ?? {});
    } catch {
      // ignore chunk parse failures
    }
  }

  return merged;
}

export async function fetchRewardsMap(
  userAddress: string,
  epochIds: string[],
  fetchImpl: DepositHistoryFetch = fetchWithTimeout,
) {
  if (epochIds.length === 0) return {} as Record<string, ApiRewardInfo>;

  const merged: Record<string, ApiRewardInfo> = {};
  for (let index = 0; index < epochIds.length; index += REWARDS_FETCH_CHUNK) {
    const chunk = epochIds.slice(index, index + REWARDS_FETCH_CHUNK);
    const response = await fetchImpl("/api/rewards", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: userAddress,
        epochs: chunk,
      }),
    });
    if (!response.ok) continue;
    try {
      const json = await readJsonResponse<{ rewards?: Record<string, ApiRewardInfo> }>(response) ?? {};
      Object.assign(merged, json.rewards ?? {});
    } catch {
      // ignore chunk parse failures
    }
  }

  return merged;
}

export function normalizeApiDeposits(value: unknown): ApiDeposit[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ApiDeposit => (
    !!item &&
    typeof item === "object" &&
    Array.isArray((item as Partial<ApiDeposit>).tileIds)
  ));
}

export function mapDepositEntries(
  deposits: ApiDeposit[],
  epochsMap: Record<string, ApiEpoch>,
  rewardsMap: Record<string, ApiRewardInfo>,
): DepositEntry[] {
  return deposits.map((d) => {
    const normalized = normalizeTileAmounts(d.tileIds, d.amounts, d.totalAmount);
    const normalizedTileIds = normalized.tileIds;
    const epochData = epochsMap[d.epoch];
    const rewardData = rewardsMap[d.epoch];
    const winningTile = epochData?.winningTile ?? rewardData?.winningTile ?? null;
    const totalAmountWei = parseLineaAmountWei(d.totalAmount);
    const normalizedAmounts = normalized.amounts.map((value) => {
      return toDisplayNumberWei(parseLineaAmountWei(value));
    });
    let reward: number | null = null;

    if (rewardData && winningTile !== null && normalizedTileIds.includes(winningTile)) {
      const userWinningAmountWei = parseLineaAmountWei(rewardData.userWinningAmount);
      const totalRewardWei = parseLineaAmountWei(rewardData.reward);
      const rowWinningAmountWei = computeWinningAmountWei(d.tileIds, d.amounts, winningTile, d.totalAmount);
      if (userWinningAmountWei > 0n && totalRewardWei > 0n && rowWinningAmountWei > 0n) {
        const rewardWei = (totalRewardWei * rowWinningAmountWei) / userWinningAmountWei;
        reward = toDisplayNumberWei(rewardWei);
      }
    }

    return {
      epoch: d.epoch,
      tileIds: normalizedTileIds,
      amounts: normalizedAmounts,
      amount: formatLineaAmountFixed(totalAmountWei, 2),
      amountNum: toDisplayNumberWei(totalAmountWei),
      txHash: normalizeDepositTxHash(d.txHash),
      blockNumber: d.blockNumber,
      blockNumberNum: parseSafeNonNegativeIntegerNumber(d.blockNumber),
      winningTile,
      isDailyJackpot: Boolean(epochData?.isDailyJackpot),
      isWeeklyJackpot: Boolean(epochData?.isWeeklyJackpot),
      reward,
    };
  }).sort((a, b) => {
    if (a.blockNumberNum === b.blockNumberNum) {
      const epochDelta = parseSafePositiveIntegerNumber(b.epoch) - parseSafePositiveIntegerNumber(a.epoch);
      if (epochDelta !== 0) return epochDelta;
      return (b.txHash ?? "").localeCompare(a.txHash ?? "");
    }
    return b.blockNumberNum - a.blockNumberNum;
  });
}

function arraysEqualNumbers(left: number[], right: number[]) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function depositsEqual(left: DepositEntry[] | null, right: DepositEntry[]) {
  if (!left) return false;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (
      a.epoch !== b.epoch ||
      a.amount !== b.amount ||
      a.amountNum !== b.amountNum ||
      a.txHash !== b.txHash ||
      a.blockNumber !== b.blockNumber ||
      a.blockNumberNum !== b.blockNumberNum ||
      a.winningTile !== b.winningTile ||
      a.isDailyJackpot !== b.isDailyJackpot ||
      a.isWeeklyJackpot !== b.isWeeklyJackpot ||
      a.reward !== b.reward ||
      !arraysEqualNumbers(a.tileIds, b.tileIds) ||
      !arraysEqualNumbers(a.amounts, b.amounts)
    ) {
      return false;
    }
  }
  return true;
}

export function useDepositHistory(userAddress?: string, enabled = true) {
  const [loading, setLoading] = useState(false);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [data, setData] = useState<DepositEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const runningRef = useRef(false);
  const runningForRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(false);
  const dataRef = useRef<DepositEntry[] | null>(null);
  const cacheSavedAtRef = useRef<Record<string, number | null>>({});

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchFromApi = useCallback(async () => {
    const normalizedUser = normalizeDepositUserAddress(userAddress);
    if (!normalizedUser) return;
    if (runningRef.current && runningForRef.current === normalizedUser) return;
    const requestId = ++requestIdRef.current;
    const shouldShowLoading = dataRef.current === null;
    runningRef.current = true;
    runningForRef.current = normalizedUser;
    if (mountedRef.current) {
      if (shouldShowLoading) {
        setLoading(true);
      }
      setError(null);
    }

    try {
      const depositsJson = await fetchDepositHistoryPayload(normalizedUser);

      const deposits = normalizeApiDeposits(depositsJson.deposits);
      const uniqueEpochs = [...new Set(deposits.map((d) => d.epoch))];
      let epochsMap: Record<string, ApiEpoch> = depositsJson.epochs ?? {};
      let rewardsMap: Record<string, ApiRewardInfo> = depositsJson.rewards ?? {};

      const publishEntries = (entries: DepositEntry[]) => {
        const entriesChanged = !depositsEqual(dataRef.current, entries);
        if (mountedRef.current && requestId === requestIdRef.current && entriesChanged) {
          setData(entries);
        }
        const now = Date.now();
        const savedAt = cacheSavedAtRef.current[normalizedUser] ?? null;
        const shouldWriteCache =
          entriesChanged ||
          !savedAt ||
          now - savedAt >= DEPOSIT_CACHE_WRITE_MIN_MS;
        if (shouldWriteCache) {
          saveCachedDeposits(normalizedUser, entries);
          cacheSavedAtRef.current[normalizedUser] = now;
        }
      };

      publishEntries(mapDepositEntries(deposits, epochsMap, rewardsMap));
      if (mountedRef.current && requestId === requestIdRef.current) {
        setLastLoadedAt(Date.now());
        setLoading(false);
      }

      const priorityEpochs = uniqueEpochs.slice(0, SYNC_EPOCH_PREFETCH_LIMIT);
      const syncMissingEpochs = priorityEpochs.filter((epoch) => !epochsMap[String(epoch)]);
      const syncMissingRewards = priorityEpochs.filter((epoch) => !rewardsMap[String(epoch)]);

      if (syncMissingEpochs.length > 0 || syncMissingRewards.length > 0) {
        if (mountedRef.current && requestId === requestIdRef.current) {
          setMetadataLoading(true);
        }
        const [extraEpochsMap, extraRewardsMap] = await Promise.all([
          fetchEpochMap(syncMissingEpochs),
          fetchRewardsMap(normalizedUser, syncMissingRewards),
        ]);
        if (requestId !== requestIdRef.current) return;
        epochsMap = { ...epochsMap, ...extraEpochsMap };
        rewardsMap = { ...rewardsMap, ...extraRewardsMap };
        publishEntries(mapDepositEntries(deposits, epochsMap, rewardsMap));
        if (mountedRef.current && requestId === requestIdRef.current) {
          setMetadataLoading(false);
        }
      }

      const deferredEpochs = uniqueEpochs.slice(SYNC_EPOCH_PREFETCH_LIMIT);
      const deferredMissingEpochs = deferredEpochs.filter((epoch) => !epochsMap[String(epoch)]);
      const deferredMissingRewards = deferredEpochs.filter((epoch) => !rewardsMap[String(epoch)]);
      if (deferredMissingEpochs.length > 0 || deferredMissingRewards.length > 0) {
        void (async () => {
          const [deferredEpochsMap, deferredRewardsMap] = await Promise.all([
            fetchEpochMap(deferredMissingEpochs),
            fetchRewardsMap(normalizedUser, deferredMissingRewards),
          ]);
          if (requestId !== requestIdRef.current) return;
          const mergedEpochsMap = { ...epochsMap, ...deferredEpochsMap };
          const mergedRewardsMap = { ...rewardsMap, ...deferredRewardsMap };
          const fullEntries = mapDepositEntries(deposits, mergedEpochsMap, mergedRewardsMap);
          const fullEntriesChanged = !depositsEqual(dataRef.current, fullEntries);
          if (mountedRef.current && requestId === requestIdRef.current) {
            if (fullEntriesChanged) {
              setData(fullEntries);
            }
          }
          const deferredNow = Date.now();
          const deferredSavedAt = cacheSavedAtRef.current[normalizedUser] ?? null;
          const shouldWriteDeferredCache =
            fullEntriesChanged ||
            !deferredSavedAt ||
            deferredNow - deferredSavedAt >= DEPOSIT_CACHE_WRITE_MIN_MS;
          if (shouldWriteDeferredCache) {
            saveCachedDeposits(normalizedUser, fullEntries);
            cacheSavedAtRef.current[normalizedUser] = deferredNow;
          }
        })();
      }
    } catch (err) {
      log.warn("DepositHistory", "API fetch failed", { message: err instanceof Error ? err.message : String(err) });
      if (mountedRef.current && requestId === requestIdRef.current) {
        setError(getDepositHistoryLoadError());
        if (dataRef.current === null) {
          setData([]);
        }
      }
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setLoading(false);
        setMetadataLoading(false);
      }
      if (requestId === requestIdRef.current && runningForRef.current === normalizedUser) {
        runningRef.current = false;
        runningForRef.current = null;
      }
    }
  }, [userAddress]);

  useEffect(() => {
    const normalizedUser = normalizeDepositUserAddress(userAddress);
    if (!normalizedUser) {
      requestIdRef.current += 1;
      runningRef.current = false;
      runningForRef.current = null;
      if (mountedRef.current) {
        setData(null);
        setError(null);
        setLoading(false);
        setMetadataLoading(false);
        setLastLoadedAt(null);
      }
      dataRef.current = null;
      return;
    }

    if (!enabled) {
      requestIdRef.current += 1;
      runningRef.current = false;
      runningForRef.current = null;
      if (mountedRef.current) {
        setError(null);
        setLoading(false);
        setMetadataLoading(false);
      }
      return;
    }

    const cached = loadDepositHistoryCache(normalizedUser);
    cacheSavedAtRef.current[normalizedUser] = cached.savedAt;
    if (mountedRef.current) {
      setData(cached.data);
      setLastLoadedAt(cached.data ? cached.savedAt : null);
      setError(null);
    }
    const savedAt = cached.savedAt;
    const refreshDelayMs = getDepositHistoryRefreshDelay(savedAt);
    if (refreshDelayMs !== null) {
      const timeoutId = window.setTimeout(() => {
        void fetchFromApi();
      }, refreshDelayMs);
      return () => window.clearTimeout(timeoutId);
    }

    if (mountedRef.current && !cached.data && dataRef.current === null) {
      setLoading(true);
    }
    void fetchFromApi();
  }, [enabled, userAddress, fetchFromApi]);

  const refresh = useCallback(async () => {
    await fetchFromApi();
  }, [fetchFromApi]);

  const totalDeposited = useMemo(
    () => (data ?? []).reduce((sum, e) => sum + e.amountNum, 0),
    [data],
  );

  return { data, loading, metadataLoading, lastLoadedAt, totalDeposited, error, fetch: fetchFromApi, refresh };
}
