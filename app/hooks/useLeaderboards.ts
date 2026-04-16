"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { APP_CHAIN_ID, CONTRACT_ADDRESS } from "../lib/constants";
import type { LeaderboardEntry, LuckyTileEntry } from "../lib/types";
import { readJsonResponse } from "../lib/readJsonResponse";

const STORAGE_KEY = `lore:leaderboard:v3:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`;
const LEADERBOARD_CACHE_TTL_MS = 60_000;

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

function loadCache(): { data: LeaderboardsData | null; savedAt: number | null } {
  if (typeof localStorage === "undefined") return { data: null, savedAt: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { data: null, savedAt: null };
    const parsed = JSON.parse(raw) as LeaderboardsCacheEnvelope | LeaderboardsData;
    if (
      parsed &&
      typeof parsed === "object" &&
      "data" in parsed &&
      parsed.data &&
      typeof parsed.data === "object"
    ) {
      return {
        data: parsed.data,
        savedAt:
          typeof parsed.savedAt === "number" && Number.isFinite(parsed.savedAt)
            ? parsed.savedAt
            : null,
      };
    }
    return { data: parsed as LeaderboardsData, savedAt: null };
  } catch {
    return { data: null, savedAt: null };
  }
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
    initialCacheRef.current = loadCache();
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
        const cached = initialCacheRef.current ?? loadCache();
        cacheSavedAtRef.current = cached.savedAt;
        if (cached.data && !dataRef.current && mountedRef.current) {
          setData(cached.data);
        }
      }

      const response = await fetch("/api/leaderboards", { cache: "no-store" });
      const payload = await readJsonResponse<LeaderboardsApiPayload>(response);

      if (!payload) {
        throw new Error(`Empty response from /api/leaderboards (HTTP ${response.status})`);
      }
      if (!response.ok || payload.error) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }

      const nextData: LeaderboardsData = {
        biggestSingleWin: payload.biggestSingleWin,
        luckiest: payload.luckiest,
        oneTileWonder: payload.oneTileWonder,
        mostWins: payload.mostWins,
        whales: payload.whales,
        underdog: payload.underdog,
        luckyTile: payload.luckyTile,
      };
      const changed = !leaderboardsEqual(dataRef.current, nextData);

      if (mountedRef.current) {
        if (changed) {
          setData(nextData);
          saveCache(nextData);
        }
      }
      cacheSavedAtRef.current = Date.now();
      initialCacheRef.current = { data: nextData, savedAt: cacheSavedAtRef.current };
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : String(err));
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
    if (savedAt && Date.now() - savedAt < LEADERBOARD_CACHE_TTL_MS) {
      const timeoutId = window.setTimeout(() => {
        void fetchAll();
      }, LEADERBOARD_CACHE_TTL_MS - (Date.now() - savedAt));
      return () => window.clearTimeout(timeoutId);
    }
    void fetchAll();
  }, [enabled, fetchAll]);

  const refetch = useCallback(() => {
    void fetchAll(true);
  }, [fetchAll]);

  return useMemo(
    () => ({ data, loading, error, refetch }),
    [data, error, loading, refetch],
  );
}
