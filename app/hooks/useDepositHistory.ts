"use client";

import { log } from "../lib/logger";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { APP_CHAIN_ID, CONTRACT_ADDRESS } from "../lib/constants";

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
const SYNC_EPOCH_PREFETCH_LIMIT = 64;
const EPOCHS_FETCH_CHUNK = 100;
const REWARDS_FETCH_CHUNK = 200;

function getDepositCacheKey(userAddress: string) {
  return `lore:deposits:v2:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}:${userAddress.toLowerCase()}`;
}

function loadCachedDeposits(userAddress: string): { data: DepositEntry[] | null; savedAt: number | null } {
  if (typeof localStorage === "undefined") return { data: null, savedAt: null };
  try {
    const raw = localStorage.getItem(getDepositCacheKey(userAddress));
    if (!raw) return { data: null, savedAt: null };
    const parsed = JSON.parse(raw) as DepositCacheEnvelope | DepositEntry[];
    if (Array.isArray(parsed)) {
      return { data: parsed, savedAt: null };
    }
    return {
      data: Array.isArray(parsed.data) ? parsed.data : null,
      savedAt:
        typeof parsed.savedAt === "number" && Number.isFinite(parsed.savedAt)
          ? parsed.savedAt
          : null,
    };
  } catch {
    return { data: null, savedAt: null };
  }
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

async function fetchEpochMap(epochIds: string[]) {
  if (epochIds.length === 0) return {} as Record<string, ApiEpoch>;

  const merged: Record<string, ApiEpoch> = {};
  for (let index = 0; index < epochIds.length; index += EPOCHS_FETCH_CHUNK) {
    const chunk = epochIds.slice(index, index + EPOCHS_FETCH_CHUNK);
    const epochsQuery = encodeURIComponent(chunk.join(","));
    const response = await fetch(`/api/epochs?epochs=${epochsQuery}`);
    if (!response.ok) continue;
    try {
      const json = (await response.json()) as { epochs?: Record<string, ApiEpoch> };
      Object.assign(merged, json.epochs ?? {});
    } catch {
      // ignore chunk parse failures
    }
  }

  return merged;
}

async function fetchRewardsMap(userAddress: string, epochIds: string[]) {
  if (epochIds.length === 0) return {} as Record<string, ApiRewardInfo>;

  const merged: Record<string, ApiRewardInfo> = {};
  for (let index = 0; index < epochIds.length; index += REWARDS_FETCH_CHUNK) {
    const chunk = epochIds.slice(index, index + REWARDS_FETCH_CHUNK);
    const response = await fetch("/api/rewards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: userAddress,
        epochs: chunk,
      }),
    });
    if (!response.ok) continue;
    try {
      const json = (await response.json()) as { rewards?: Record<string, ApiRewardInfo> };
      Object.assign(merged, json.rewards ?? {});
    } catch {
      // ignore chunk parse failures
    }
  }

  return merged;
}

function mapDepositEntries(
  deposits: ApiDeposit[],
  epochsMap: Record<string, ApiEpoch>,
  rewardsMap: Record<string, ApiRewardInfo>,
): DepositEntry[] {
  return deposits.map((d) => {
    const normalizedTileIds = [...new Set(d.tileIds.filter((tileId) => Number.isInteger(tileId) && tileId > 0))];
    const epochData = epochsMap[d.epoch];
    const rewardData = rewardsMap[d.epoch];
    const winningTile = epochData?.winningTile ?? rewardData?.winningTile ?? null;
    const normalizedAmounts =
      Array.isArray(d.amounts) && d.amounts.length === normalizedTileIds.length
        ? d.amounts.map((value) => {
            const amount = parseFloat(value);
            return Number.isFinite(amount) && amount >= 0 ? amount : 0;
          })
        : normalizedTileIds.length > 0
          ? normalizedTileIds.map(() => d.totalAmountNum / normalizedTileIds.length)
          : [];
    let reward: number | null = null;

    if (rewardData && winningTile !== null && normalizedTileIds.includes(winningTile)) {
      const userWinningAmount = parseFloat(rewardData.userWinningAmount);
      const totalReward = parseFloat(rewardData.reward);
      if (userWinningAmount > 0 && totalReward > 0) {
        let rowWinningAmount = 0;
        if (normalizedAmounts.length === normalizedTileIds.length) {
          normalizedTileIds.forEach((tileId, index) => {
            if (tileId === winningTile) {
              rowWinningAmount += normalizedAmounts[index] ?? 0;
            }
          });
        } else {
          const hitCount = normalizedTileIds.filter((tileId) => tileId === winningTile).length;
          if (hitCount > 0 && normalizedTileIds.length > 0) {
            rowWinningAmount = (d.totalAmountNum / normalizedTileIds.length) * hitCount;
          }
        }
        if (rowWinningAmount > 0) {
          reward = (totalReward * rowWinningAmount) / userWinningAmount;
        }
      }
    }

    return {
      epoch: d.epoch,
      tileIds: normalizedTileIds,
      amounts: normalizedAmounts,
      amount: parseFloat(d.totalAmount).toFixed(2),
      amountNum: d.totalAmountNum,
      txHash: d.txHash,
      blockNumber: d.blockNumber,
      blockNumberNum: Number(d.blockNumber ?? "0"),
      winningTile,
      isDailyJackpot: Boolean(epochData?.isDailyJackpot),
      isWeeklyJackpot: Boolean(epochData?.isWeeklyJackpot),
      reward,
    };
  }).sort((a, b) => Number(b.epoch) - Number(a.epoch));
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
  const [data, setData] = useState<DepositEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);
  const runningForRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(false);
  const dataRef = useRef<DepositEntry[] | null>(null);

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
    if (!userAddress) return;
    const normalizedUser = userAddress.toLowerCase();
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
      const depositsResult = await fetch(`/api/deposits?user=${normalizedUser}&includeRewards=1`);

      const depositsRes = depositsResult;
      let depositsJson: {
        deposits?: ApiDeposit[];
        epochs?: Record<string, ApiEpoch>;
        rewards?: Record<string, ApiRewardInfo>;
        error?: string;
      } = {};
      try {
        depositsJson = await depositsRes.json();
      } catch {
        depositsJson = {};
      }

      if (!depositsRes.ok || depositsJson.error) {
        if (mountedRef.current) {
          setError(depositsJson.error || `HTTP ${depositsRes.status}`);
          setData([]);
        }
        return;
      }

      const deposits: ApiDeposit[] = depositsJson.deposits ?? [];
      const uniqueEpochs = [...new Set(deposits.map((d) => d.epoch))];
      let epochsMap: Record<string, ApiEpoch> = depositsJson.epochs ?? {};
      let rewardsMap: Record<string, ApiRewardInfo> = depositsJson.rewards ?? {};

      const priorityEpochs = uniqueEpochs.slice(0, SYNC_EPOCH_PREFETCH_LIMIT);
      const syncMissingEpochs = priorityEpochs.filter((epoch) => !epochsMap[String(epoch)]);
      const syncMissingRewards = priorityEpochs.filter((epoch) => !rewardsMap[String(epoch)]);

      const [extraEpochsMap, extraRewardsMap] = await Promise.all([
        fetchEpochMap(syncMissingEpochs),
        fetchRewardsMap(normalizedUser, syncMissingRewards),
      ]);
      epochsMap = { ...epochsMap, ...extraEpochsMap };
      rewardsMap = { ...rewardsMap, ...extraRewardsMap };

      const entries = mapDepositEntries(deposits, epochsMap, rewardsMap);
      const entriesChanged = !depositsEqual(dataRef.current, entries);
      if (mountedRef.current && requestId === requestIdRef.current) {
        if (entriesChanged) {
          setData(entries);
        }
      }
      if (entriesChanged) {
        saveCachedDeposits(normalizedUser, entries);
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
          if (fullEntriesChanged) {
            saveCachedDeposits(normalizedUser, fullEntries);
          }
        })();
      }
    } catch (err) {
      log.warn("DepositHistory", "API fetch failed", { message: err instanceof Error ? err.message : String(err) });
      if (mountedRef.current && requestId === requestIdRef.current) {
        setError((err as Error).message || "Network error");
        setData([]);
      }
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setLoading(false);
      }
      if (requestId === requestIdRef.current && runningForRef.current === normalizedUser) {
        runningRef.current = false;
        runningForRef.current = null;
      }
    }
  }, [userAddress]);

  useEffect(() => {
    if (!userAddress) {
      requestIdRef.current += 1;
      runningRef.current = false;
      runningForRef.current = null;
      if (mountedRef.current) {
        setData(null);
        setError(null);
        setLoading(false);
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
      }
      return;
    }

    const cached = loadCachedDeposits(userAddress);
    if (mountedRef.current) {
      setData(cached.data);
      setError(null);
    }
    const savedAt = cached.savedAt;
    if (savedAt && Date.now() - savedAt < DEPOSIT_CACHE_TTL_MS) {
      const timeoutId = window.setTimeout(() => {
        void fetchFromApi();
      }, DEPOSIT_CACHE_TTL_MS - (Date.now() - savedAt));
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

  return { data, loading, totalDeposited, error, fetch: fetchFromApi, refresh };
}
