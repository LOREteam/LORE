"use client";

import { log } from "../lib/logger";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import { getAddress } from "viem";
import { APP_CHAIN_ID, CONTRACT_ADDRESS, GRID_SIZE } from "../lib/constants";
import {
  computeWinningAmountWei,
  formatLineaAmountFixed,
  formatLineaWeiDisplayNumber,
  normalizeTileAmounts,
  parseLineaAmountWei,
} from "../lib/tokenAmountMath";
import { getFreshCacheDelayMs, normalizeCacheTimestamp } from "../lib/cacheTimestamp";
import { fetchWithTimeout } from "../lib/fetchWithTimeout";
import { readJsonResponse } from "../lib/readJsonResponse";
import type { ReadModelCacheStorage } from "../lib/readModelCache";

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

type DepositCoverage = "partial";

export type DepositHistoryProvenance = {
  coverage: DepositCoverage;
  indexedThroughBlock: string;
};

export type DepositReadFreshness = "idle" | "loading" | "refreshing" | "partial" | "stale" | "error";

export type DepositReadState = {
  freshness: DepositReadFreshness;
  coverage: DepositCoverage | null;
  indexedThroughBlock: string | null;
  lastUpdatedAt: number | null;
};

const EMPTY_DEPOSIT_READ_STATE: DepositReadState = {
  freshness: "idle",
  coverage: null,
  indexedThroughBlock: null,
  lastUpdatedAt: null,
};

interface DepositCacheEnvelope extends DepositHistoryProvenance {
  cacheVersion?: number;
  savedAt?: number;
  data?: DepositEntry[];
}

interface ApiDepositHistoryPayload extends DepositHistoryProvenance {
  deposits: ApiDeposit[];
  epochs?: Record<string, ApiEpoch>;
  rewards?: Record<string, ApiRewardInfo>;
  error?: string;
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
  return `lore:deposits:v3:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}:${getAddress(userAddress).toLowerCase()}`;
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

function parseCanonicalIndexedThroughBlock(value: unknown): string | null {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) return null;
  try {
    BigInt(value);
    return value;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeDepositHistoryPayload(value: unknown): ApiDepositHistoryPayload | null {
  if (!isRecord(value) || value.coverage !== "partial" || !Array.isArray(value.deposits)) return null;
  const indexedThroughBlock = parseCanonicalIndexedThroughBlock(value.indexedThroughBlock);
  if (indexedThroughBlock === null) return null;
  return {
    deposits: normalizeApiDeposits(value.deposits),
    coverage: "partial",
    indexedThroughBlock,
    epochs: isRecord(value.epochs) ? value.epochs as Record<string, ApiEpoch> : undefined,
    rewards: isRecord(value.rewards) ? value.rewards as Record<string, ApiRewardInfo> : undefined,
    error: typeof value.error === "string" ? value.error : undefined,
  };
}

export function loadDepositHistoryCache(
  userAddress: string,
  storage: ReadModelCacheStorage | null = typeof localStorage === "undefined" ? null : localStorage,
  now = Date.now(),
): { data: DepositEntry[] | null; savedAt: number | null; provenance: DepositHistoryProvenance | null } {
  const empty = { data: null, savedAt: null, provenance: null };
  if (!storage) return empty;
  const cacheKey = getDepositCacheKey(userAddress);
  try {
    const raw = storage.getItem(cacheKey);
    if (!raw) return empty;
    const envelope = JSON.parse(raw) as unknown;
    if (!isRecord(envelope) || envelope.cacheVersion !== 3 || envelope.coverage !== "partial") {
      storage.removeItem(cacheKey);
      return empty;
    }
    const indexedThroughBlock = parseCanonicalIndexedThroughBlock(envelope.indexedThroughBlock);
    const data = normalizeCachedDepositEntries(envelope.data);
    if (indexedThroughBlock === null || data === null) {
      storage.removeItem(cacheKey);
      return empty;
    }
    return {
      data,
      savedAt: normalizeCacheTimestamp(envelope.savedAt, now),
      provenance: { coverage: "partial", indexedThroughBlock },
    };
  } catch {
    try { storage.removeItem(cacheKey); } catch { /* cache cleanup is best effort */ }
    return empty;
  }
}

export function getDepositHistoryRefreshDelay(savedAt: unknown, now = Date.now()) {
  return getFreshCacheDelayMs(savedAt, DEPOSIT_CACHE_TTL_MS, now);
}

export function getDepositHistoryLoadError() {
  return DEPOSIT_HISTORY_LOAD_ERROR;
}

export function shouldWriteDepositHistoryCache({
  cachedEntries,
  cachedProvenance,
  entries,
  provenance,
  savedAt,
  now,
}: {
  cachedEntries: DepositEntry[] | null;
  cachedProvenance: DepositHistoryProvenance | null;
  entries: DepositEntry[];
  provenance: DepositHistoryProvenance;
  savedAt: number | null;
  now: number;
}) {
  return (
    !depositsEqual(cachedEntries, entries) ||
    cachedProvenance?.coverage !== provenance.coverage ||
    cachedProvenance.indexedThroughBlock !== provenance.indexedThroughBlock ||
    !savedAt ||
    now - savedAt >= DEPOSIT_CACHE_WRITE_MIN_MS
  );
}

function saveCachedDeposits(userAddress: string, entries: DepositEntry[], provenance: DepositHistoryProvenance) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      getDepositCacheKey(userAddress),
      JSON.stringify({
        cacheVersion: 3,
        savedAt: Date.now(),
        data: entries,
        ...provenance,
      } satisfies DepositCacheEnvelope),
    );
  } catch {
    // ignore storage failures
  }
}

export async function fetchDepositHistoryPayload(
  userAddress: string,
  fetchImpl: DepositHistoryFetch = fetchWithTimeout,
  signal?: AbortSignal,
) {
  const response = await fetchImpl(`/api/deposits?user=${userAddress}`, {
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  const rawPayload = await readJsonResponse<unknown>(response);
  if (!rawPayload) throw new Error(`Deposit history returned empty JSON (HTTP ${response.status})`);
  const payload = normalizeDepositHistoryPayload(rawPayload);
  if (!response.ok || !payload || payload.error) {
    throw new Error(`Deposit history request failed (HTTP ${response.status})`);
  }
  return payload;
}

export async function fetchEpochMap(
  epochIds: string[],
  fetchImpl: DepositHistoryFetch = fetchWithTimeout,
  signal?: AbortSignal,
) {
  if (epochIds.length === 0) return {} as Record<string, ApiEpoch>;

  const merged: Record<string, ApiEpoch> = {};
  for (let index = 0; index < epochIds.length; index += EPOCHS_FETCH_CHUNK) {
    const chunk = epochIds.slice(index, index + EPOCHS_FETCH_CHUNK);
    const epochsQuery = encodeURIComponent(chunk.join(","));
    const response = await fetchImpl(`/api/epochs?epochs=${epochsQuery}`, {
      cache: "no-store",
      ...(signal ? { signal } : {}),
    });
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
  signal?: AbortSignal,
) {
  if (epochIds.length === 0) return {} as Record<string, ApiRewardInfo>;

  const merged: Record<string, ApiRewardInfo> = {};
  for (let index = 0; index < epochIds.length; index += REWARDS_FETCH_CHUNK) {
    const chunk = epochIds.slice(index, index + REWARDS_FETCH_CHUNK);
    const response = await fetchImpl("/api/rewards", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      ...(signal ? { signal } : {}),
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

export type DepositHistorySnapshot = {
  owner: string | null;
  requestId: number;
  data: DepositEntry[] | null;
  loading: boolean;
  metadataLoading: boolean;
  lastLoadedAt: number | null;
  readState: DepositReadState;
  error: string | null;
};

export type DepositHistorySnapshotAction =
  | {
      type: "activate";
      owner: string | null;
      requestId: number;
      data: DepositEntry[] | null;
      savedAt: number | null;
      provenance: DepositHistoryProvenance | null;
    }
  | { type: "start"; owner: string; requestId: number }
  | { type: "publish"; owner: string; requestId: number; entries: DepositEntry[] }
  | {
      type: "complete";
      owner: string;
      requestId: number;
      completedAt: number;
      provenance: DepositHistoryProvenance;
    }
  | { type: "metadata"; owner: string; requestId: number; loading: boolean }
  | { type: "error"; owner: string; requestId: number; error: string }
  | { type: "settle"; owner: string; requestId: number };

export function createDepositHistorySnapshot(): DepositHistorySnapshot {
  return {
    owner: null,
    requestId: 0,
    data: null,
    loading: false,
    metadataLoading: false,
    lastLoadedAt: null,
    readState: EMPTY_DEPOSIT_READ_STATE,
    error: null,
  };
}

function isCurrentSnapshotAction(
  snapshot: DepositHistorySnapshot,
  action: Extract<DepositHistorySnapshotAction, { owner: string; requestId: number }>,
) {
  return snapshot.owner === action.owner && snapshot.requestId === action.requestId;
}

export function reduceDepositHistorySnapshot(
  snapshot: DepositHistorySnapshot,
  action: DepositHistorySnapshotAction,
): DepositHistorySnapshot {
  switch (action.type) {
    case "activate": {
      if (action.requestId < snapshot.requestId) return snapshot;
      const provenance = action.provenance;
      if (action.owner === null || action.data === null || provenance === null) {
        return {
          owner: action.owner,
          requestId: action.requestId,
          data: null,
          loading: action.owner !== null,
          metadataLoading: false,
          lastLoadedAt: null,
          readState: action.owner !== null
            ? { ...EMPTY_DEPOSIT_READ_STATE, freshness: "loading" }
            : EMPTY_DEPOSIT_READ_STATE,
          error: null,
        };
      }
      return {
        owner: action.owner,
        requestId: action.requestId,
        data: action.data,
        loading: false,
        metadataLoading: false,
        lastLoadedAt: action.savedAt,
        readState: {
          freshness: "partial",
          coverage: provenance.coverage,
          indexedThroughBlock: provenance.indexedThroughBlock,
          lastUpdatedAt: action.savedAt,
        },
        error: null,
      };
    }
    case "start":
      if (snapshot.owner !== action.owner || action.requestId < snapshot.requestId) return snapshot;
      return {
        ...snapshot,
        requestId: action.requestId,
        loading: snapshot.data === null,
        metadataLoading: false,
        readState: snapshot.readState.coverage === "partial"
          ? { ...snapshot.readState, freshness: "refreshing" }
          : { ...EMPTY_DEPOSIT_READ_STATE, freshness: "loading" },
        error: null,
      };
    case "publish":
      if (!isCurrentSnapshotAction(snapshot, action) || depositsEqual(snapshot.data, action.entries)) return snapshot;
      return { ...snapshot, data: action.entries };
    case "complete":
      if (!isCurrentSnapshotAction(snapshot, action)) return snapshot;
      return {
        ...snapshot,
        loading: false,
        lastLoadedAt: action.completedAt,
        readState: {
          freshness: "partial",
          coverage: action.provenance.coverage,
          indexedThroughBlock: action.provenance.indexedThroughBlock,
          lastUpdatedAt: action.completedAt,
        },
      };
    case "metadata":
      if (!isCurrentSnapshotAction(snapshot, action)) return snapshot;
      return { ...snapshot, metadataLoading: action.loading };
    case "error":
      if (!isCurrentSnapshotAction(snapshot, action)) return snapshot;
      return {
        ...snapshot,
        loading: false,
        metadataLoading: false,
        readState: snapshot.readState.coverage === "partial"
          ? { ...snapshot.readState, freshness: "stale" }
          : { ...EMPTY_DEPOSIT_READ_STATE, freshness: "error" },
        error: action.error,
      };
    case "settle":
      if (!isCurrentSnapshotAction(snapshot, action)) return snapshot;
      return { ...snapshot, loading: false, metadataLoading: false };
    default:
      return snapshot;
  }
}

export function isDepositHistoryRequestCurrent({
  requestId,
  activeRequestId,
  requestUser,
  activeUser,
}: {
  requestId: number;
  activeRequestId: number;
  requestUser: string;
  activeUser: string | null;
}) {
  return requestId === activeRequestId && requestUser === activeUser;
}

export function selectVisibleDepositHistory({
  activeUser,
  enabled,
  snapshot,
}: {
  activeUser: string | null;
  enabled: boolean;
  snapshot: DepositHistorySnapshot;
}) {
  const hasCurrentSnapshot = enabled && activeUser !== null && snapshot.owner === activeUser;
  if (!hasCurrentSnapshot) {
    return {
      data: null,
      loading: Boolean(activeUser && enabled),
      metadataLoading: false,
      lastLoadedAt: null,
      readState: activeUser && enabled
        ? { ...EMPTY_DEPOSIT_READ_STATE, freshness: "loading" as const }
        : EMPTY_DEPOSIT_READ_STATE,
      error: null,
    };
  }

  return {
    data: snapshot.data,
    loading: snapshot.loading,
    metadataLoading: snapshot.metadataLoading,
    lastLoadedAt: snapshot.lastLoadedAt,
    readState: snapshot.readState,
    error: snapshot.error,
  };
}

export function useDepositHistory(userAddress?: string, enabled = true) {
  const [snapshot, dispatchSnapshot] = useReducer(
    reduceDepositHistorySnapshot,
    undefined,
    createDepositHistorySnapshot,
  );
  const runningRef = useRef(false);
  const runningForRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(false);
  const committedUserRef = useRef<string | null>(null);
  const requestAbortRef = useRef<AbortController | null>(null);
  const cacheSavedAtRef = useRef<Record<string, number | null>>({});
  const cachedEntriesRef = useRef<Record<string, DepositEntry[] | null>>({});
  const cachedProvenanceRef = useRef<Record<string, DepositHistoryProvenance | null>>({});
  const normalizedRenderedUser = normalizeDepositUserAddress(userAddress);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      committedUserRef.current = null;
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
    };
  }, []);

  const fetchFromApi = useCallback(async () => {
    const normalizedUser = normalizeDepositUserAddress(userAddress);
    if (!normalizedUser || committedUserRef.current !== normalizedUser) return;
    if (runningRef.current && runningForRef.current === normalizedUser) return;

    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    const requestId = ++requestIdRef.current;
    const isCurrentRequest = () => (
      !controller.signal.aborted &&
      requestAbortRef.current === controller &&
      isDepositHistoryRequestCurrent({
        requestId,
        activeRequestId: requestIdRef.current,
        requestUser: normalizedUser,
        activeUser: committedUserRef.current,
      })
    );
    if (!isCurrentRequest()) return;

    runningRef.current = true;
    runningForRef.current = normalizedUser;
    if (mountedRef.current && isCurrentRequest()) {
      dispatchSnapshot({ type: "start", owner: normalizedUser, requestId });
    }

    try {
      const depositsJson = await fetchDepositHistoryPayload(normalizedUser, fetchWithTimeout, controller.signal);
      if (!mountedRef.current || !isCurrentRequest()) return;

      const deposits = depositsJson.deposits;
      const provenance: DepositHistoryProvenance = {
        coverage: depositsJson.coverage,
        indexedThroughBlock: depositsJson.indexedThroughBlock,
      };
      const uniqueEpochs = [...new Set(deposits.map((d) => d.epoch))];
      let epochsMap: Record<string, ApiEpoch> = depositsJson.epochs ?? {};
      let rewardsMap: Record<string, ApiRewardInfo> = depositsJson.rewards ?? {};

      const publishEntries = (entries: DepositEntry[]) => {
        if (!mountedRef.current || !isCurrentRequest()) return;
        dispatchSnapshot({ type: "publish", owner: normalizedUser, requestId, entries });
      };

      publishEntries(mapDepositEntries(deposits, epochsMap, rewardsMap));
      const completedAt = Date.now();
      if (mountedRef.current && isCurrentRequest()) {
        dispatchSnapshot({ type: "complete", owner: normalizedUser, requestId, completedAt, provenance });
      }

      const priorityEpochs = uniqueEpochs.slice(0, SYNC_EPOCH_PREFETCH_LIMIT);
      const syncMissingEpochs = priorityEpochs.filter((epoch) => !epochsMap[String(epoch)]);
      const syncMissingRewards = priorityEpochs.filter((epoch) => !rewardsMap[String(epoch)]);

      if (syncMissingEpochs.length > 0 || syncMissingRewards.length > 0) {
        if (mountedRef.current && isCurrentRequest()) {
          dispatchSnapshot({ type: "metadata", owner: normalizedUser, requestId, loading: true });
        }
        const [extraEpochsMap, extraRewardsMap] = await Promise.all([
          fetchEpochMap(syncMissingEpochs, fetchWithTimeout, controller.signal),
          fetchRewardsMap(normalizedUser, syncMissingRewards, fetchWithTimeout, controller.signal),
        ]);
        if (!mountedRef.current || !isCurrentRequest()) return;
        epochsMap = { ...epochsMap, ...extraEpochsMap };
        rewardsMap = { ...rewardsMap, ...extraRewardsMap };
        publishEntries(mapDepositEntries(deposits, epochsMap, rewardsMap));
        if (mountedRef.current && isCurrentRequest()) {
          dispatchSnapshot({ type: "metadata", owner: normalizedUser, requestId, loading: false });
        }
      }

      const deferredEpochs = uniqueEpochs.slice(SYNC_EPOCH_PREFETCH_LIMIT);
      const deferredMissingEpochs = deferredEpochs.filter((epoch) => !epochsMap[String(epoch)]);
      const deferredMissingRewards = deferredEpochs.filter((epoch) => !rewardsMap[String(epoch)]);
      if (deferredMissingEpochs.length > 0 || deferredMissingRewards.length > 0) {
        void (async () => {
          try {
            const [deferredEpochsMap, deferredRewardsMap] = await Promise.all([
              fetchEpochMap(deferredMissingEpochs, fetchWithTimeout, controller.signal),
              fetchRewardsMap(normalizedUser, deferredMissingRewards, fetchWithTimeout, controller.signal),
            ]);
            if (!mountedRef.current || !isCurrentRequest()) return;
            const mergedEpochsMap = { ...epochsMap, ...deferredEpochsMap };
            const mergedRewardsMap = { ...rewardsMap, ...deferredRewardsMap };
            publishEntries(mapDepositEntries(deposits, mergedEpochsMap, mergedRewardsMap));
          } catch (error) {
            if (!controller.signal.aborted) {
              log.warn("DepositHistory", "Deferred metadata fetch failed", { message: error instanceof Error ? error.message : String(error) });
            }
          }
        })();
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        log.warn("DepositHistory", "API fetch failed", { message: error instanceof Error ? error.message : String(error) });
      }
      if (mountedRef.current && isCurrentRequest()) {
        dispatchSnapshot({ type: "error", owner: normalizedUser, requestId, error: getDepositHistoryLoadError() });
      }
    } finally {
      if (mountedRef.current && isCurrentRequest()) {
        dispatchSnapshot({ type: "settle", owner: normalizedUser, requestId });
      }
      if (isCurrentRequest() && runningForRef.current === normalizedUser) {
        runningRef.current = false;
        runningForRef.current = null;
      }
    }
  }, [userAddress]);

  useLayoutEffect(() => {
    const normalizedUser = normalizedRenderedUser;
    const activationRequestId = ++requestIdRef.current;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    runningRef.current = false;
    runningForRef.current = null;

    if (!normalizedUser || !enabled) {
      committedUserRef.current = null;
      dispatchSnapshot({
        type: "activate",
        owner: null,
        requestId: activationRequestId,
        data: null,
        savedAt: null,
        provenance: null,
      });
      return;
    }

    committedUserRef.current = normalizedUser;
    const cached = loadDepositHistoryCache(normalizedUser);
    cacheSavedAtRef.current[normalizedUser] = cached.savedAt;
    cachedEntriesRef.current[normalizedUser] = cached.data;
    cachedProvenanceRef.current[normalizedUser] = cached.provenance;
    dispatchSnapshot({
      type: "activate",
      owner: normalizedUser,
      requestId: activationRequestId,
      data: cached.data,
      savedAt: cached.savedAt,
      provenance: cached.provenance,
    });

    const refreshDelayMs = getDepositHistoryRefreshDelay(cached.savedAt);
    if (refreshDelayMs !== null) {
      const timeoutId = window.setTimeout(() => {
        void fetchFromApi();
      }, refreshDelayMs);
      return () => window.clearTimeout(timeoutId);
    }

    void fetchFromApi();
  }, [enabled, fetchFromApi, normalizedRenderedUser]);

  useEffect(() => {
    const owner = snapshot.owner;
    const indexedThroughBlock = snapshot.readState.indexedThroughBlock;
    if (
      owner === null ||
      snapshot.data === null ||
      snapshot.readState.freshness !== "partial" ||
      snapshot.readState.coverage !== "partial" ||
      indexedThroughBlock === null ||
      owner !== committedUserRef.current ||
      snapshot.requestId !== requestIdRef.current ||
      requestAbortRef.current?.signal.aborted
    ) {
      return;
    }

    const now = Date.now();
    const savedAt = cacheSavedAtRef.current[owner] ?? null;
    const provenance = { coverage: "partial" as const, indexedThroughBlock };
    const shouldWriteCache = shouldWriteDepositHistoryCache({
      cachedEntries: cachedEntriesRef.current[owner] ?? null,
      cachedProvenance: cachedProvenanceRef.current[owner] ?? null,
      entries: snapshot.data,
      provenance,
      savedAt,
      now,
    });
    if (!shouldWriteCache) return;

    if (
      owner !== committedUserRef.current ||
      snapshot.requestId !== requestIdRef.current ||
      requestAbortRef.current?.signal.aborted
    ) {
      return;
    }
    saveCachedDeposits(owner, snapshot.data, provenance);
    cacheSavedAtRef.current[owner] = now;
    cachedEntriesRef.current[owner] = snapshot.data;
    cachedProvenanceRef.current[owner] = provenance;
  }, [snapshot]);

  const refresh = useCallback(async () => {
    await fetchFromApi();
  }, [fetchFromApi]);

  const visibleHistory = selectVisibleDepositHistory({
    activeUser: normalizedRenderedUser,
    enabled,
    snapshot,
  });
  const totalDeposited = useMemo(
    () => (visibleHistory.data ?? []).reduce((sum, entry) => sum + entry.amountNum, 0),
    [visibleHistory.data],
  );

  return { ...visibleHistory, totalDeposited, fetch: fetchFromApi, refresh };
}
