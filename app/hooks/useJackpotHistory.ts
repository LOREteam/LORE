"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FIREBASE_DB_URL } from "../lib/firebase";

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

const REFRESH_MS = 45_000;
const WARN_THROTTLE_MS = 15_000;
const JACKPOT_LIMIT = 200;

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
    timestamp: null,
  };
}

function sortByBlockDesc(entries: JackpotHistoryEntry[]) {
  return [...entries].sort((a, b) => {
    if (a.blockNumber === b.blockNumber) return 0;
    return a.blockNumber > b.blockNumber ? -1 : 1;
  });
}

function loadCachedEntries(): JackpotHistoryEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem("lore:jackpots-cache:v1");
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => toEntry((item ?? {}) as Record<string, unknown>))
      .filter((item): item is JackpotHistoryEntry => item !== null);
  } catch {
    return [];
  }
}

function saveCachedEntries(entries: JackpotHistoryEntry[]) {
  if (typeof localStorage === "undefined") return;
  const serializable = entries.map((entry) => ({
    ...entry,
    blockNumber: entry.blockNumber.toString(),
  }));
  try {
    localStorage.setItem("lore:jackpots-cache:v1", JSON.stringify(serializable.slice(0, JACKPOT_LIMIT)));
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

async function fetchFromFirebase(): Promise<JackpotHistoryEntry[]> {
  let res = await fetch(
    `${FIREBASE_DB_URL}/gamedata/jackpots.json?orderBy="epoch"&limitToLast=${JACKPOT_LIMIT}`,
    { cache: "no-store" },
  );

  // Fallback if Firebase rejects ordered query (missing index or strict rules)
  if (res.status === 400) {
    res = await fetch(`${FIREBASE_DB_URL}/gamedata/jackpots.json`, { cache: "no-store" });
  }

  if (!res.ok) {
    throw new Error(`Firebase HTTP ${res.status}`);
  }

  const data = (await res.json()) as Record<string, unknown> | null;
  if (!data || typeof data !== "object") return [];

  const entries = Object.values(data)
    .map((row) => toEntry((row ?? {}) as Record<string, unknown>))
    .filter((item): item is JackpotHistoryEntry => item !== null);

  return sortByBlockDesc(entries).slice(0, JACKPOT_LIMIT);
}

export function useJackpotHistory() {
  const [items, setItems] = useState<JackpotHistoryEntry[]>(() => loadCachedEntries());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);
  const warnAtRef = useRef(0);

  const refresh = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setLoading(true);
    setError(null);

    try {
      let entries: JackpotHistoryEntry[];

      try {
        entries = await fetchFromApi();
      } catch (apiErr) {
        const now = Date.now();
        if (now - warnAtRef.current >= WARN_THROTTLE_MS) {
          warnAtRef.current = now;
          const msg = apiErr instanceof Error ? apiErr.message : String(apiErr);
          console.warn(`[useJackpotHistory] /api/jackpots unavailable, switching to Firebase fallback: ${msg}`);
        }
        entries = await fetchFromFirebase();
      }

      const sorted = sortByBlockDesc(entries);
      setItems(sorted);
      saveCachedEntries(sorted);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      if (isNetworkFetchError(err)) {
        const now = Date.now();
        if (now - warnAtRef.current >= WARN_THROTTLE_MS) {
          warnAtRef.current = now;
          console.warn(`[useJackpotHistory] Network unavailable: ${msg}`);
        }
      } else {
        const now = Date.now();
        if (now - warnAtRef.current >= WARN_THROTTLE_MS) {
          warnAtRef.current = now;
          console.warn(`[useJackpotHistory] Failed to refresh jackpots: ${msg}`);
        }
      }

      // Keep stale data on screen if available to avoid blank analytics panel.
      setError(msg);
    } finally {
      setLoading(false);
      runningRef.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      void refresh();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { items, loading, error, refresh };
}
