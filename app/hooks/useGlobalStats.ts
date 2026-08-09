"use client";

import { useEffect, useRef, useState } from "react";
import {
  CONTRACT_ADDRESS,
  APP_CHAIN_ID,
} from "../lib/constants";
import { readJsonResponse } from "../lib/readJsonResponse";
import { formatLineaAmountFixed } from "../lib/tokenAmountMath";

const STORAGE_KEY = `lore:global-stats-cache:v4:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`;
const GLOBAL_STATS_REQUEST_TIMEOUT_MS = 12_000;

export interface GlobalStats {
  totalVolume: string;
  totalBurn: string;
  totalVolumeRaw: bigint;
  totalBurnRaw: bigint;
  resolvedEpochs: number;
}

interface Accumulator {
  volumeRaw: bigint;
  burnRaw: bigint;
  resolvedEpochs: number;
  lastScannedEpoch: number;
  lastScannedBlock: string; // stored as string for JSON serialization
}

function fmt(v: bigint): string {
  const oneTokenWei = 10n ** 18n;
  if (v >= 1_000_000n * oneTokenWei) return `${formatLineaAmountFixed(v / 1_000_000n, 2)}M`;
  if (v >= 1_000n * oneTokenWei) return `${formatLineaAmountFixed(v / 1_000n, 2)}K`;
  return formatLineaAmountFixed(v, 2);
}

function toStats(acc: Accumulator): GlobalStats {
  return {
    totalVolume: fmt(acc.volumeRaw),
    totalBurn: fmt(acc.burnRaw),
    totalVolumeRaw: acc.volumeRaw,
    totalBurnRaw: acc.burnRaw,
    resolvedEpochs: acc.resolvedEpochs,
  };
}

function parseNonNegativeBigInt(value: unknown): bigint | null {
  try {
    const parsed = BigInt(String(value ?? ""));
    return parsed >= 0n ? parsed : null;
  } catch {
    return null;
  }
}

function parseNonNegativeSafeInteger(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function normalizeGlobalStatsAccumulator(value: unknown): Accumulator | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const volumeRaw = parseNonNegativeBigInt(obj.volumeRaw);
  const burnRaw = parseNonNegativeBigInt(obj.burnRaw ?? 0);
  const resolvedEpochs = parseNonNegativeSafeInteger(obj.resolvedEpochs);
  const lastScannedEpoch = parseNonNegativeSafeInteger(obj.lastScannedEpoch);
  const lastScannedBlock = String(obj.lastScannedBlock ?? "");
  if (volumeRaw === null || burnRaw === null) return null;
  if (resolvedEpochs === null || lastScannedEpoch === null) return null;
  if (!/^\d+$/.test(lastScannedBlock)) return null;
  return {
    volumeRaw,
    burnRaw,
    resolvedEpochs,
    lastScannedEpoch,
    lastScannedBlock,
  };
}

export function getUsableGlobalStatsAccumulator(acc: Accumulator | null, currentEpoch: number): Accumulator | null {
  if (!acc) return null;
  return acc.lastScannedEpoch <= currentEpoch ? acc : null;
}

function safeCurrentEpochNumber(currentEpoch?: bigint | null): number | null {
  if (currentEpoch == null) return null;
  if (currentEpoch < 0n) return null;
  if (currentEpoch > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(currentEpoch);
}

function loadCache(): Accumulator | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const acc = normalizeGlobalStatsAccumulator(JSON.parse(raw));
    if (!acc) localStorage.removeItem(STORAGE_KEY);
    return acc;
  } catch {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore storage failures
    }
    return null;
  }
}

function saveCache(acc: Accumulator) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      volumeRaw: acc.volumeRaw.toString(),
      burnRaw: acc.burnRaw.toString(),
      resolvedEpochs: acc.resolvedEpochs,
      lastScannedEpoch: acc.lastScannedEpoch,
      lastScannedBlock: acc.lastScannedBlock,
    }));
  } catch {}
}

export function useGlobalStats(currentEpoch?: bigint | null, enabled = true) {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [loading, setLoading] = useState(false);
  const accRef = useRef<Accumulator | null>(null);
  const initializedRef = useRef(false);
  const lastFetchedEpochRef = useRef<bigint | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Restore from localStorage on mount – show cached values instantly
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const cached = loadCache();
    const currentEpochNumber = safeCurrentEpochNumber(currentEpoch);
    const usable = currentEpochNumber === null ? cached : getUsableGlobalStatsAccumulator(cached, currentEpochNumber);
    if (usable) {
      accRef.current = usable;
      if (mountedRef.current) {
        setStats(toStats(usable));
      }
    }
  }, [currentEpoch]);

  useEffect(() => {
    const currentEpochNumber = safeCurrentEpochNumber(currentEpoch);
    if (currentEpochNumber === null) return;
    if (!accRef.current) return;
    if (getUsableGlobalStatsAccumulator(accRef.current, currentEpochNumber)) return;
    accRef.current = null;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore storage failures
    }
    if (mountedRef.current) setStats(null);
  }, [currentEpoch]);

  useEffect(() => {
    if (!enabled) return;
    if (currentEpoch == null) return;
    if (lastFetchedEpochRef.current === currentEpoch) return;
    const currentEpochNumber = safeCurrentEpochNumber(currentEpoch);
    if (currentEpochNumber === null) return;

    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("Global stats request timed out", "TimeoutError"));
    }, GLOBAL_STATS_REQUEST_TIMEOUT_MS);
    if (accRef.current === null && mountedRef.current) setLoading(true);
    void fetch("/api/global-stats", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`global stats request failed: ${response.status}`);
        const payload = await readJsonResponse<Record<string, unknown>>(response);
        if (!payload) throw new Error("global stats response is empty");
        const volumeRaw = parseNonNegativeBigInt(payload.totalVolumeWei);
        const burnRaw = parseNonNegativeBigInt(payload.totalBurnWei);
        const resolvedEpochs = parseNonNegativeSafeInteger(payload.resolvedEpochs);
        const lastScannedBlock = String(payload.lastIndexedBlock ?? "");
        if (
          volumeRaw === null ||
          burnRaw === null ||
          resolvedEpochs === null ||
          !/^\d+$/.test(lastScannedBlock)
        ) {
          throw new Error("global stats response is invalid");
        }
        if (controller.signal.aborted) return;
        const next = {
          volumeRaw,
          burnRaw,
          resolvedEpochs,
          lastScannedEpoch: currentEpochNumber,
          lastScannedBlock,
        } satisfies Accumulator;
        accRef.current = next;
        saveCache(next);
        lastFetchedEpochRef.current = currentEpoch;
        if (mountedRef.current) setStats(toStats(next));
      })
      .catch(() => {
        // Non-critical: keep the last indexer-backed value when the API is unavailable.
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        if (mountedRef.current && (!controller.signal.aborted || timedOut)) setLoading(false);
      });

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [currentEpoch, enabled]);

  return { stats, loading };
}
