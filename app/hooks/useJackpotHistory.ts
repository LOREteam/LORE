"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDecimalTextFixed } from "../lib/balanceFormatting";
import { APP_CHAIN_ID, CONTRACT_ADDRESS } from "../lib/constants";
import { log } from "../lib/logger";
import { formatLineaAmountFixed, formatLineaWeiDisplayNumber, parseLineaAmountWei } from "../lib/tokenAmountMath";
import { getFreshCacheDelayMs } from "../lib/cacheTimestamp";
import { fetchWithTimeout } from "../lib/fetchWithTimeout";
import { readJsonResponse } from "../lib/readJsonResponse";
import { loadReadModelCache, type ReadModelCacheStorage } from "../lib/readModelCache";

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
const CACHE_WRITE_MIN_MS = 120_000;
const WARN_THROTTLE_MS = 15_000;
const JACKPOT_LIMIT = 200;
const STORAGE_KEY = `lore:jackpots-cache:v2:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`;
const JACKPOT_HISTORY_LOAD_ERROR = "Jackpot history is temporarily unavailable. Refresh the Analytics tab to retry.";

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
  const fixed = formatDecimalTextFixed(String(value ?? "").trim(), 6);
  const parsed = fixed === null ? Number.NaN : Number(fixed);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseSafePositiveIntegerNumber(value: string | null | undefined): number {
  if (!value || !/^\d+$/.test(value)) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeTxHash(value: unknown): `0x${string}` | "" {
  const normalized = String(value ?? "").toLowerCase().trim();
  return /^0x[0-9a-f]{64}$/.test(normalized) ? (normalized as `0x${string}`) : "";
}

function normalizeAmountWei(row: Record<string, unknown>) {
  const fromAmount = parseLineaAmountWei(typeof row.amount === "string" ? row.amount : undefined);
  if (fromAmount > 0n) return fromAmount;
  return parseLineaAmountWei(String(row.amountNum ?? ""));
}

function toDisplayNumberWei(value: bigint): number {
  return formatLineaWeiDisplayNumber(value);
}

function formatLegacyAmountDisplay(row: Record<string, unknown>) {
  const amountText =
    typeof row.amount === "string" && row.amount.trim()
      ? row.amount
      : String(row.amountNum ?? "");
  const amountWei = parseLineaAmountWei(amountText);
  return amountWei > 0n ? formatLineaAmountFixed(amountWei, 2) : "0.00";
}

function toEntry(row: Record<string, unknown>): JackpotHistoryEntry | null {
  const epoch = String(row.epoch ?? "").trim();
  if (!epoch) return null;

  const kind = row.kind === "weekly" ? "weekly" : "daily";
  const amountWei = normalizeAmountWei(row);
  const amountNum =
    amountWei > 0n
      ? toDisplayNumberWei(amountWei)
      : normalizeAmount(row.amountNum, normalizeAmount(row.amount));
  const amount = amountWei > 0n ? formatLineaAmountFixed(amountWei, 2) : formatLegacyAmountDisplay(row);

  return {
    epoch,
    amount,
    amountNum,
    kind,
    txHash: normalizeTxHash(row.txHash),
    blockNumber: parseBigIntSafe(row.blockNumber),
    timestamp:
      typeof row.timestamp === "number" && Number.isFinite(row.timestamp)
        ? row.timestamp
        : null,
  };
}

export function sortJackpotHistoryEntries(entries: JackpotHistoryEntry[]) {
  return [...entries].sort((a, b) => {
    if (a.blockNumber === b.blockNumber) {
      const epochDelta = parseSafePositiveIntegerNumber(b.epoch) - parseSafePositiveIntegerNumber(a.epoch);
      if (epochDelta !== 0) return epochDelta;
      if (a.kind !== b.kind) return a.kind === "weekly" ? -1 : 1;
      return (b.txHash ?? "").localeCompare(a.txHash ?? "");
    }
    return a.blockNumber > b.blockNumber ? -1 : 1;
  });
}

export function normalizeEntries(rows: unknown): JackpotHistoryEntry[] {
  if (!Array.isArray(rows)) return [];
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

export function loadJackpotHistoryCache(
  storage: ReadModelCacheStorage | null = typeof localStorage === "undefined" ? null : localStorage,
  now = Date.now(),
): { entries: JackpotHistoryEntry[]; savedAt: number | null } {
  const restored = loadReadModelCache<JackpotHistoryEntry[]>({
    storage,
    cacheKey: STORAGE_KEY,
    payloadKey: "jackpots",
    emptyValue: [],
    normalizePayload: normalizeEntries,
    now,
  });
  return { entries: restored.value, savedAt: restored.savedAt };
}

export function getJackpotHistoryRefreshDelay(savedAt: unknown, now = Date.now()) {
  return getFreshCacheDelayMs(savedAt, REFRESH_MS, now) ?? 0;
}

export function getJackpotHistoryLoadError() {
  return JACKPOT_HISTORY_LOAD_ERROR;
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

export async function fetchJackpotHistoryEntries(
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetchWithTimeout,
): Promise<JackpotHistoryEntry[]> {
  const res = await fetchImpl("/api/jackpots", { cache: "no-store" });
  const json = await readJsonResponse<JackpotApiResponse>(res);
  if (!json) throw new Error(`HTTP ${res.status}`);
  if (!res.ok || json.error) {
    throw new Error(json.error || `HTTP ${res.status}`);
  }

  return sortJackpotHistoryEntries(normalizeEntries(json.jackpots).slice(0, JACKPOT_LIMIT));
}

export function useJackpotHistory(enabled = true) {
  const initialCacheRef = useRef<{ entries: JackpotHistoryEntry[]; savedAt: number | null } | null>(null);
  if (initialCacheRef.current === null) {
    initialCacheRef.current = loadJackpotHistoryCache();
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
      const sorted = await fetchJackpotHistoryEntries();
      const changed = !jackpotEntriesEqual(itemsRef.current, sorted);
      if (mountedRef.current) {
        if (changed) {
          setItems(sorted);
        }
        setError(null);
      }
      const now = Date.now();
      const shouldWriteCache =
        changed ||
        !cacheSavedAtRef.current ||
        now - cacheSavedAtRef.current >= CACHE_WRITE_MIN_MS;
      if (shouldWriteCache) {
        saveCachedEntries(sorted);
        cacheSavedAtRef.current = now;
      }
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
        setError(getJackpotHistoryLoadError());
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
    const initialDelay = getJackpotHistoryRefreshDelay(savedAt);
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
