"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { APP_CHAIN_ID, CONTRACT_ADDRESS, GRID_SIZE } from "../lib/constants";
import type { LeaderboardEntry, LuckyTileEntry } from "../lib/types";
import { readJsonResponse } from "../lib/readJsonResponse";
import { getFreshCacheDelayMs, normalizeCacheTimestamp } from "../lib/cacheTimestamp";
import { fetchWithTimeout } from "../lib/fetchWithTimeout";

const STORAGE_KEY = `lore:leaderboard:v3:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`;
const LEADERBOARD_CACHE_TTL_MS = 60_000;
const LEADERBOARD_CACHE_WRITE_MIN_MS = 5 * 60_000;
const LEADERBOARD_LOAD_ERROR = "Leaderboards are temporarily unavailable. Refresh this tab to retry.";

export interface LeaderboardsData {
  biggestSingleWin: LeaderboardEntry[];
  luckiest: LeaderboardEntry[];
  oneTileWonder: LeaderboardEntry[];
  mostWins: LeaderboardEntry[];
  whales: LeaderboardEntry[];
  underdog: LeaderboardEntry[];
  luckyTile: LuckyTileEntry[];
}

interface LeaderboardsApiPayload extends LeaderboardsData {
  error?: string;
}

interface LeaderboardsCacheEnvelope {
  savedAt?: number;
  data?: LeaderboardsData;
}

export type LeaderboardsCacheStorage = Pick<Storage, "getItem" | "removeItem">;

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeLeaderboardEntries(value: unknown): LeaderboardEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const address = typeof row.address === "string" ? row.address.trim() : "";
      if (!address) return null;
      const extra = row.extra === undefined || row.extra === null ? undefined : String(row.extra);
      return {
        rank: Math.max(0, Math.trunc(finiteNumber(row.rank))),
        address,
        ...(typeof row.name === "string" && row.name.trim() ? { name: row.name.trim() } : {}),
        value: String(row.value ?? "0"),
        valueNum: finiteNumber(row.valueNum),
        ...(extra ? { extra } : {}),
      } satisfies LeaderboardEntry;
    })
    .filter((entry): entry is LeaderboardEntry => entry !== null);
}

function normalizeLuckyTileEntries(value: unknown): LuckyTileEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const tileId = finiteNumber(row.tileId, Number.NaN);
      const wins = finiteNumber(row.wins, Number.NaN);
      const pct = finiteNumber(row.pct, 0);
      if (!Number.isSafeInteger(tileId) || tileId < 1 || tileId > GRID_SIZE) return null;
      if (!Number.isSafeInteger(wins) || wins < 0) return null;
      return {
        tileId,
        wins,
        pct,
      } satisfies LuckyTileEntry;
    })
    .filter((entry): entry is LuckyTileEntry => entry !== null);
}

export function normalizeLeaderboardsData(value: unknown): LeaderboardsData {
  const data = (value ?? {}) as Partial<Record<keyof LeaderboardsData, unknown>>;
  return {
    biggestSingleWin: normalizeLeaderboardEntries(data.biggestSingleWin),
    luckiest: normalizeLeaderboardEntries(data.luckiest),
    oneTileWonder: normalizeLeaderboardEntries(data.oneTileWonder),
    mostWins: normalizeLeaderboardEntries(data.mostWins),
    whales: normalizeLeaderboardEntries(data.whales),
    underdog: normalizeLeaderboardEntries(data.underdog),
    luckyTile: normalizeLuckyTileEntries(data.luckyTile),
  };
}

function leaderboardEntryArrayEqual<
  T extends { address?: string; value?: string; valueNum?: number; extra?: string; rank?: number; tileId?: number; wins?: number; pct?: number }
>(left: T[], right: T[]) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (
      a.address !== b.address ||
      a.value !== b.value ||
      a.valueNum !== b.valueNum ||
      a.extra !== b.extra ||
      a.rank !== b.rank ||
      a.tileId !== b.tileId ||
      a.wins !== b.wins ||
      a.pct !== b.pct
    ) {
      return false;
    }
  }
  return true;
}

function leaderboardsEqual(left: LeaderboardsData | null, right: LeaderboardsData) {
  if (!left) return false;
  return (
    leaderboardEntryArrayEqual(left.biggestSingleWin, right.biggestSingleWin) &&
    leaderboardEntryArrayEqual(left.luckiest, right.luckiest) &&
    leaderboardEntryArrayEqual(left.oneTileWonder, right.oneTileWonder) &&
    leaderboardEntryArrayEqual(left.mostWins, right.mostWins) &&
    leaderboardEntryArrayEqual(left.whales, right.whales) &&
    leaderboardEntryArrayEqual(left.underdog, right.underdog) &&
    leaderboardEntryArrayEqual(left.luckyTile, right.luckyTile)
  );
}

export function loadLeaderboardsCache(
  storage: LeaderboardsCacheStorage | null = typeof localStorage === "undefined" ? null : localStorage,
  now = Date.now(),
): { data: LeaderboardsData | null; savedAt: number | null } {
  if (!storage) return { data: null, savedAt: null };
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { data: null, savedAt: null };
    const parsed = JSON.parse(raw) as LeaderboardsCacheEnvelope | LeaderboardsData;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      storage.removeItem(STORAGE_KEY);
      return { data: null, savedAt: null };
    }
    if ("data" in parsed) {
      if (!parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) {
        storage.removeItem(STORAGE_KEY);
        return { data: null, savedAt: null };
      }
      return {
        data: normalizeLeaderboardsData(parsed.data),
        savedAt: normalizeCacheTimestamp(parsed.savedAt, now),
      };
    }
    return { data: normalizeLeaderboardsData(parsed), savedAt: null };
  } catch {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // ignore storage failures
    }
    return { data: null, savedAt: null };
  }
}

export function getLeaderboardsRefreshDelay(savedAt: unknown, now = Date.now()) {
  return getFreshCacheDelayMs(savedAt, LEADERBOARD_CACHE_TTL_MS, now) ?? 0;
}

export function getLeaderboardsLoadError() {
  return LEADERBOARD_LOAD_ERROR;
}

function saveCache(data: LeaderboardsData) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        data,
      } satisfies LeaderboardsCacheEnvelope),
    );
  } catch {
    // ignore quota issues
  }
}

export function useLeaderboards(enabled: boolean) {
  const initialCacheRef = useRef<{ data: LeaderboardsData | null; savedAt: number | null } | null>(null);
  if (initialCacheRef.current === null) {
    initialCacheRef.current = loadLeaderboardsCache();
  }
  const initialCache = initialCacheRef.current;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LeaderboardsData | null>(initialCache.data);
  const runningRef = useRef(false);
  const mountedRef = useRef(false);
  const cacheSavedAtRef = useRef<number | null>(initialCache.savedAt);
  const dataRef = useRef<LeaderboardsData | null>(initialCache.data);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchAll = useCallback(async (force = false) => {
    if (!enabled || runningRef.current) return;
    runningRef.current = true;
    const shouldShowLoading = dataRef.current === null;
    if (mountedRef.current) {
      if (shouldShowLoading) {
        setLoading(true);
      }
      setError(null);
    }

    try {
      if (!force && !dataRef.current) {
        const cached = initialCacheRef.current ?? loadLeaderboardsCache();
        cacheSavedAtRef.current = cached.savedAt;
        if (cached.data && !dataRef.current && mountedRef.current) {
          setData(cached.data);
        }
      }

      const response = await fetchWithTimeout("/api/leaderboards", { cache: "no-store" });
      const payload = await readJsonResponse<LeaderboardsApiPayload>(response);

      if (!payload) {
        throw new Error(`Empty response from /api/leaderboards (HTTP ${response.status})`);
      }
      if (!response.ok || payload.error) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }

      const nextData = normalizeLeaderboardsData(payload);
      const changed = !leaderboardsEqual(dataRef.current, nextData);

      if (mountedRef.current) {
        if (changed) {
          setData(nextData);
        }
      }
      const now = Date.now();
      const shouldWriteCache =
        changed ||
        !cacheSavedAtRef.current ||
        now - cacheSavedAtRef.current >= LEADERBOARD_CACHE_WRITE_MIN_MS;
      if (shouldWriteCache) {
        saveCache(nextData);
        cacheSavedAtRef.current = now;
        initialCacheRef.current = { data: nextData, savedAt: now };
      } else {
        initialCacheRef.current = { data: nextData, savedAt: cacheSavedAtRef.current };
      }
    } catch {
      if (mountedRef.current) {
        setError(getLeaderboardsLoadError());
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
      runningRef.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const savedAt = cacheSavedAtRef.current;
    const initialDelay = getLeaderboardsRefreshDelay(savedAt);
    let cancelled = false;
    let timeoutId: number | null = null;

    const schedule = (delayMs: number) => {
      timeoutId = window.setTimeout(async () => {
        if (cancelled) return;
        await fetchAll();
        if (cancelled) return;
        schedule(LEADERBOARD_CACHE_TTL_MS);
      }, delayMs);
    };

    schedule(initialDelay);
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [enabled, fetchAll]);

  const refetch = useCallback(() => {
    void fetchAll(true);
  }, [fetchAll]);

  return useMemo(
    () => ({ data, loading, error, refetch }),
    [data, error, loading, refetch],
  );
}
