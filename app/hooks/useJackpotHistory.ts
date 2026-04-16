"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { APP_CHAIN_ID, CONTRACT_ADDRESS } from "../lib/constants";
import { log } from "../lib/logger";

export interface JackpotHistoryEntry {
  epoch: string;
  amount: string;
  amountNum: number;
  kind: "daily" | "weekly";
  txHash: string;
  blockNumber: bigint;
  timestamp: number | null;
}

interface JackpotApiResponse {
  jackpots?: unknown[];
  error?: string;
}

interface JackpotHistoryCacheEnvelope {
  savedAt?: number;
  jackpots?: unknown[];
}

const REFRESH_MS = 45_000;
const WARN_THROTTLE_MS = 15_000;
const JACKPOT_LIMIT = 200;
const STORAGE_KEY = `lore:jackpots-cache:v2:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`;

function isNetworkFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("network request failed");
}

function parseBigIntSafe(value: unknown): bigint {
  try {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
    return BigInt(String(value ?? "0"));
  } catch {
    return 0n;
  }
}

function normalizeAmount(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toEntry(row: Record<string, unknown>): JackpotHistoryEntry | null {
  const epoch = String(row.epoch ?? "").trim();
  if (!epoch) return null;

  const kind = row.kind === "weekly" ? "weekly" : "daily";
  const amountNum = normalizeAmount(row.amountNum, normalizeAmount(row.amount));
  const amount = amountNum.toFixed(2);

  return {
    epoch,
    amount,
    amountNum,
    kind,
    txHash: String(row.txHash ?? ""),
    blockNumber: parseBigIntSafe(row.blockNumber),
    timestamp:
      typeof row.timestamp === "number" && Number.isFinite(row.timestamp)
        ? row.timestamp
        : null,
  };
}

function sortByBlockDesc(entries: JackpotHistoryEntry[]) {
  return [...entries].sort((a, b) => {
    if (a.blockNumber === b.blockNumber) return 0;
    return a.blockNumber > b.blockNumber ? -1 : 1;
  });
}

function normalizeEntries(rows: unknown[]): JackpotHistoryEntry[] {
  return rows
    .map((item) => toEntry((item ?? {}) as Record<string, unknown>))
    .filter((item): item is JackpotHistoryEntry => item !== null);
}

function jackpotEntriesEqual(left: JackpotHistoryEntry[], right: JackpotHistoryEntry[]) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (
      a.epoch !== b.epoch ||
      a.amount !== b.amount ||
      a.amountNum !== b.amountNum ||
      a.kind !== b.kind ||
      a.txHash !== b.txHash ||
      a.blockNumber !== b.blockNumber ||
      a.timestamp !== b.timestamp
    ) {
      return false;
    }
  }
  return true;
}

function loadCachedEntries(): { entries: JackpotHistoryEntry[]; savedAt: number | null } {
  if (typeof localStorage === "undefined") return { entries: [], savedAt: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { entries: [], savedAt: null };
    const parsed = JSON.parse(raw) as JackpotHistoryCacheEnvelope | unknown[];
    if (Array.isArray(parsed)) {
      return { entries: normalizeEntries(parsed), savedAt: null };
    }
    return {
      entries: normalizeEntries(Array.isArray(parsed.jackpots) ? parsed.jackpots : []),
      savedAt:
        typeof parsed.savedAt === "number" && Number.isFinite(parsed.savedAt)
          ? parsed.savedAt
          : null,
    };
  } catch {
    return { entries: [], savedAt: null };
  }
}

function saveCachedEntries(entries: JackpotHistoryEntry[]) {
  if (typeof localStorage === "undefined") return;
  const serializable = entries.map((entry) => ({
    ...entry,
    blockNumber: entry.blockNumber.toString(),
  }));
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        jackpots: serializable.slice(0, JACKPOT_LIMIT),
      }),
    );
  } catch {
    // ignore cache write failures
  }
}

async function fetchFromApi(): Promise<JackpotHistoryEntry[]> {
  const res = await fetch("/api/jackpots", { cache: "no-store" });
  const json = (await res.json()) as JackpotApiResponse;
  const jackpots = (json.jackpots ?? []) as Array<Record<string, unknown>>;

  if (!res.ok || json.error) {
    throw new Error(json.error || `HTTP ${res.status}`);
  }

  return jackpots
    .map((row) => toEntry(row))
    .filter((item): item is JackpotHistoryEntry => item !== null)
    .slice(0, JACKPOT_LIMIT);
}

export function useJackpotHistory(enabled = true) {
  const initialCacheRef = useRef<{ entries: JackpotHistoryEntry[]; savedAt: number | null } | null>(null);
  if (initialCacheRef.current === null) {
    initialCacheRef.current = loadCachedEntries();
  }

  const [items, setItems] = useState<JackpotHistoryEntry[]>(() => initialCacheRef.current?.entries ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);
  const warnAtRef = useRef(0);
  const mountedRef = useRef(false);
  const cacheSavedAtRef = useRef<number | null>(initialCacheRef.current?.savedAt ?? null);
  const itemsRef = useRef<JackpotHistoryEntry[]>(items);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    const shouldShowLoading = itemsRef.current.length === 0;
    if (mountedRef.current) {
      if (shouldShowLoading) {
        setLoading(true);
      }
      setError(null);
    }

    try {
      const entries = await fetchFromApi();
      const sorted = sortByBlockDesc(entries);
      const changed = !jackpotEntriesEqual(itemsRef.current, sorted);
      if (mountedRef.current) {
        if (changed) {
          setItems(sorted);
        }
        setError(null);
      }
      if (changed) {
        saveCachedEntries(sorted);
      }
      cacheSavedAtRef.current = Date.now();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      if (isNetworkFetchError(err)) {
        const now = Date.now();
        if (now - warnAtRef.current >= WARN_THROTTLE_MS) {
          warnAtRef.current = now;
          log.info("JackpotHistory", `refresh skipped: ${msg}`);
        }
      } else {
        const now = Date.now();
        if (now - warnAtRef.current >= WARN_THROTTLE_MS) {
          warnAtRef.current = now;
          log.warn("JackpotHistory", `refresh failed: ${msg}`);
        }
      }

      // Keep stale data on screen if available to avoid blank analytics panel.
      if (mountedRef.current) {
        setError(msg);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
      runningRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const savedAt = cacheSavedAtRef.current;
    const initialDelay =
      savedAt && Date.now() - savedAt < REFRESH_MS
        ? REFRESH_MS - (Date.now() - savedAt)
        : 0;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const schedule = (delayMs: number) => {
      timeoutId = setTimeout(async () => {
        if (cancelled) return;
        await refresh();
        if (cancelled) return;
        schedule(REFRESH_MS);
      }, delayMs);
    };

    schedule(initialDelay);
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [enabled, refresh]);

  return { items, loading, error, refresh };
}
