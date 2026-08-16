"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { APP_CHAIN_ID, CONTRACT_ADDRESS, GRID_SIZE } from "../lib/constants";
import { readJsonResponse } from "../lib/readJsonResponse";
import { log } from "../lib/logger";
import { getFreshCacheDelayMs } from "../lib/cacheTimestamp";
import { fetchWithTimeout } from "../lib/fetchWithTimeout";
import { loadReadModelCache, type ReadModelCacheStorage } from "../lib/readModelCache";

export interface RecentWin {
  epoch: string;
  user: string;
  amount: string;
  amountRaw: string;
  tileId?: number;
  jackpotKind?: "daily" | "weekly" | "daily-weekly";
}

interface RecentWinsApiResponse {
  wins?: Array<{ epoch?: string; user?: string; amount?: string; amountRaw?: string; tileId?: number; jackpotKind?: string }>;
  error?: string;
}

const REFRESH_MS = 45_000;
const CACHE_WRITE_MIN_MS = 120_000;
const MAX_WINS = 100;
const WARN_THROTTLE_MS = 15_000;
const STORAGE_KEY = `lore:recent-wins-cache:v3:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`;

export function normalizeWins(rows: unknown): RecentWin[] {
  if (!Array.isArray(rows)) return [];
  const items = rows as Array<{
  epoch?: string;
  user?: string;
  amount?: string;
  amountRaw?: string;
  tileId?: number;
  jackpotKind?: string;
  }>;
  return items
    .map((row) => {
      if (!row?.epoch || !row?.user || !row?.amountRaw) return null;
      const tileId = row.tileId;
      const jackpotKind =
        row.jackpotKind === "daily" || row.jackpotKind === "weekly" || row.jackpotKind === "daily-weekly"
          ? row.jackpotKind
          : undefined;
      return {
        epoch: String(row.epoch),
        user: String(row.user),
        amount: String(row.amount ?? "0.00"),
        amountRaw: String(row.amountRaw),
        ...(
          typeof tileId === "number" &&
          Number.isSafeInteger(tileId) &&
          tileId >= 1 &&
          tileId <= GRID_SIZE
            ? { tileId }
            : {}
        ),
        ...(jackpotKind ? { jackpotKind } : {}),
      };
    })
    .filter((row): row is RecentWin => row !== null)
    .slice(0, MAX_WINS);
}

function recentWinsEqual(left: RecentWin[], right: RecentWin[]) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (
      a.epoch !== b.epoch ||
      a.user !== b.user ||
      a.amount !== b.amount ||
      a.amountRaw !== b.amountRaw ||
      a.tileId !== b.tileId ||
      a.jackpotKind !== b.jackpotKind
    ) {
      return false;
    }
  }
  return true;
}

export function loadRecentWinsCache(
  storage: ReadModelCacheStorage | null = typeof localStorage === "undefined" ? null : localStorage,
  now = Date.now(),
): { wins: RecentWin[]; savedAt: number | null } {
  const restored = loadReadModelCache<RecentWin[]>({
    storage,
    cacheKey: STORAGE_KEY,
    payloadKey: "wins",
    emptyValue: [],
    normalizePayload: normalizeWins,
    now,
  });
  return { wins: restored.value, savedAt: restored.savedAt };
}

export function getRecentWinsRefreshDelay(
  savedAt: unknown,
  cachedWinsCount: number,
  now = Date.now(),
) {
  if (!Number.isSafeInteger(cachedWinsCount) || cachedWinsCount <= 0) return 0;
  return getFreshCacheDelayMs(savedAt, REFRESH_MS, now) ?? 0;
}

export function shouldPollRecentWins(
  isPageVisible: boolean,
  abortCurrent: () => void,
) {
  if (isPageVisible) return true;
  abortCurrent();
  return false;
}

function saveCache(wins: RecentWin[]) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        {
          savedAt: Date.now(),
          wins: wins.slice(0, MAX_WINS).map((row) => ({
            ...row,
            amountRaw: row.amountRaw,
          })),
        },
      ),
    );
  } catch {
    // ignore localStorage failures
  }
}

export function useRecentWins(initialWins: RecentWin[] = []) {
  const initialCacheRef = useRef<{ wins: RecentWin[]; savedAt: number | null } | null>(null);
  if (initialCacheRef.current === null) {
    initialCacheRef.current = loadRecentWinsCache();
  }

  const [wins, setWins] = useState<RecentWin[]>(() => initialWins);
  const [isPageVisible, setIsPageVisible] = useState(() =>
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  );
  const runningRef = useRef(false);
  const initializedRef = useRef(false);
  const warnAtRef = useRef(0);
  const mountedRef = useRef(false);
  const cacheSavedAtRef = useRef<number | null>(initialCacheRef.current?.savedAt ?? null);
  const cachedWinsCountRef = useRef(initialCacheRef.current?.wins.length ?? 0);
  const winsRef = useRef<RecentWin[]>(initialWins);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const syncVisibility = () => {
      setIsPageVisible(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, []);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const cached = initialCacheRef.current ?? { wins: [], savedAt: null };
    cacheSavedAtRef.current = cached.savedAt;
    cachedWinsCountRef.current = cached.wins.length;
    if (mountedRef.current) {
      setWins(cached.wins.length > 0 ? cached.wins : initialWins);
    }
  }, [initialWins]);

  useEffect(() => {
    winsRef.current = wins;
  }, [wins]);

  const abortRef = useRef<AbortController | null>(null);

  const fetchWins = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    // Abort any stale in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetchWithTimeout("/api/recent-wins", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const payload = await readJsonResponse<RecentWinsApiResponse>(response);

      if (!payload) {
        throw new Error(`Empty response from /api/recent-wins (HTTP ${response.status})`);
      }
      if (!response.ok || payload.error) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }

      const nextWins = normalizeWins(payload.wins ?? []);
      const changed = !recentWinsEqual(winsRef.current, nextWins);

      if (mountedRef.current && !controller.signal.aborted) {
        if (changed) {
          setWins(nextWins);
        }
        const now = Date.now();
        const shouldWriteCache =
          changed ||
          !cacheSavedAtRef.current ||
          now - cacheSavedAtRef.current >= CACHE_WRITE_MIN_MS;
        if (shouldWriteCache) {
          saveCache(nextWins);
          cacheSavedAtRef.current = now;
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      const now = Date.now();
      if (now - warnAtRef.current >= WARN_THROTTLE_MS) {
        warnAtRef.current = now;
        log.info("RecentWins", `fetch failed: ${message}`);
      }
    } finally {
      runningRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!shouldPollRecentWins(isPageVisible, () => abortRef.current?.abort())) return;
    const savedAt = cacheSavedAtRef.current;
    const initialDelay = getRecentWinsRefreshDelay(savedAt, cachedWinsCountRef.current);
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const schedule = (delayMs: number) => {
      timeoutId = setTimeout(async () => {
        if (cancelled) return;
        await fetchWins();
        if (cancelled) return;
        schedule(REFRESH_MS);
      }, delayMs);
    };

    schedule(initialDelay);
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [fetchWins, isPageVisible]);

  return wins;
}
