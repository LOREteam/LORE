"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { APP_CHAIN_ID, CONTRACT_ADDRESS } from "../lib/constants";
import { readJsonResponse } from "../lib/readJsonResponse";
import { log } from "../lib/logger";
import { normalizeCacheTimestamp } from "../lib/cacheTimestamp";

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

interface RecentWinsCacheEnvelope {
  savedAt?: number;
  wins?: Array<{ epoch?: string; user?: string; amount?: string; amountRaw?: string; tileId?: number; jackpotKind?: string }>;
}

const REFRESH_MS = 45_000;
const HIDDEN_REFRESH_MS = 180_000;
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
        ...(typeof tileId === "number" && Number.isInteger(tileId) && tileId > 0 ? { tileId } : {}),
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

function loadCache(): { wins: RecentWin[]; savedAt: number | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { wins: [], savedAt: null };
    const parsed = JSON.parse(raw) as RecentWinsCacheEnvelope | Array<{
      epoch?: string;
      user?: string;
      amount?: string;
      amountRaw?: string;
      tileId?: number;
      jackpotKind?: string;
    }>;
    if (Array.isArray(parsed)) {
      return { wins: normalizeWins(parsed), savedAt: null };
    }
    return {
      wins: normalizeWins(Array.isArray(parsed.wins) ? parsed.wins : []),
      savedAt: normalizeCacheTimestamp(parsed.savedAt),
    };
  } catch {
    return { wins: [], savedAt: null };
  }
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
    initialCacheRef.current = loadCache();
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
      const response = await fetch("/api/recent-wins", { cache: "no-store", signal: controller.signal });
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
    const intervalMs = isPageVisible ? REFRESH_MS : HIDDEN_REFRESH_MS;
    const savedAt = cacheSavedAtRef.current;
    const initialDelay =
      savedAt &&
      cachedWinsCountRef.current > 0 &&
      Date.now() - savedAt < intervalMs
        ? intervalMs - (Date.now() - savedAt)
        : 0;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const schedule = (delayMs: number) => {
      timeoutId = setTimeout(async () => {
        if (cancelled) return;
        await fetchWins();
        if (cancelled) return;
        schedule(intervalMs);
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
