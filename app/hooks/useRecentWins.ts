"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { APP_CHAIN_ID, CONTRACT_ADDRESS } from "../lib/constants";
import { readJsonResponse } from "../lib/readJsonResponse";
import { log } from "../lib/logger";

export interface RecentWin {
  epoch: string;
  user: string;
  amount: string;
  amountRaw: string;
}

interface RecentWinsApiResponse {
  wins?: Array<{ epoch?: string; user?: string; amount?: string; amountRaw?: string }>;
  error?: string;
}

interface RecentWinsCacheEnvelope {
  savedAt?: number;
  wins?: Array<{ epoch?: string; user?: string; amount?: string; amountRaw?: string }>;
}

const REFRESH_MS = 45_000;
const HIDDEN_REFRESH_MS = 180_000;
const MAX_WINS = 100;
const WARN_THROTTLE_MS = 15_000;
const STORAGE_KEY = `lore:recent-wins-cache:v3:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`;

function normalizeWins(rows: Array<{
  epoch?: string;
  user?: string;
  amount?: string;
  amountRaw?: string;
}>): RecentWin[] {
  return rows
    .map((row) => {
      if (!row?.epoch || !row?.user || !row?.amountRaw) return null;
      return {
        epoch: String(row.epoch),
        user: String(row.user),
        amount: String(row.amount ?? "0.00"),
        amountRaw: String(row.amountRaw),
      };
    })
    .filter((row): row is RecentWin => row !== null)
    .slice(0, MAX_WINS);
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
    }>;
    if (Array.isArray(parsed)) {
      return { wins: normalizeWins(parsed), savedAt: null };
    }
    return {
      wins: normalizeWins(Array.isArray(parsed.wins) ? parsed.wins : []),
      savedAt:
        typeof parsed.savedAt === "number" && Number.isFinite(parsed.savedAt)
          ? parsed.savedAt
          : null,
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

export function useRecentWins() {
  const [wins, setWins] = useState<RecentWin[]>([]);
  const [isPageVisible, setIsPageVisible] = useState(() =>
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  );
  const runningRef = useRef(false);
  const initializedRef = useRef(false);
  const warnAtRef = useRef(0);
  const mountedRef = useRef(false);
  const cacheSavedAtRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
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
    const cached = loadCache();
    cacheSavedAtRef.current = cached.savedAt;
    if (mountedRef.current) {
      setWins(cached.wins);
    }
  }, []);

  const fetchWins = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    try {
      const response = await fetch("/api/recent-wins", { cache: "no-store" });
      const payload = await readJsonResponse<RecentWinsApiResponse>(response);

      if (!payload) {
        throw new Error(`Empty response from /api/recent-wins (HTTP ${response.status})`);
      }
      if (!response.ok || payload.error) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }

      const nextWins = normalizeWins(payload.wins ?? []);

      if (mountedRef.current) {
        setWins(nextWins);
        saveCache(nextWins);
        cacheSavedAtRef.current = Date.now();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const now = Date.now();
      if (now - warnAtRef.current >= WARN_THROTTLE_MS) {
        warnAtRef.current = now;
        log.info("RecentWins", `fetch skipped: ${message}`);
      }
    } finally {
      runningRef.current = false;
    }
  }, []);

  useEffect(() => {
    const intervalMs = isPageVisible ? REFRESH_MS : HIDDEN_REFRESH_MS;
    const savedAt = cacheSavedAtRef.current;
    const initialDelay =
      savedAt && Date.now() - savedAt < intervalMs
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
