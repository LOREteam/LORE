"use client";

import { useEffect, useRef, useState } from "react";
import {
  CONTRACT_ADDRESS,
  APP_CHAIN_ID,
} from "../lib/constants";
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

export function normalizeGlobalStatsAccumulator(value: unknown): Accumulator | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const volumeRaw = parseNonNegativeBigInt(obj.volumeRaw);
  const burnRaw = parseNonNegativeBigInt(obj.burnRaw ?? 0);
  const resolvedEpochs = Number(obj.resolvedEpochs);
  const lastScannedEpoch = Number(obj.lastScannedEpoch);
  const lastScannedBlock = String(obj.lastScannedBlock ?? "");
  if (volumeRaw === null || burnRaw === null) return null;
  if (!Number.isSafeInteger(resolvedEpochs) || resolvedEpochs < 0) return null;
  if (!Number.isSafeInteger(lastScannedEpoch) || lastScannedEpoch < 0) return null;
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

function loadCache(): Accumulator | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeGlobalStatsAccumulator(JSON.parse(raw));
  } catch { return null; }
}

function saveCache(acc: Accumulator) {
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
    if (cached) {
      accRef.current = cached;
      if (mountedRef.current) {
        setStats(toStats(cached));
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (currentEpoch == null) return;
    if (lastFetchedEpochRef.current === currentEpoch) return;
    if (currentEpoch > BigInt(Number.MAX_SAFE_INTEGER)) return;

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
        const payload = await response.json() as Record<string, unknown>;
        const volumeRaw = parseNonNegativeBigInt(payload.totalVolumeWei);
        const burnRaw = parseNonNegativeBigInt(payload.totalBurnWei);
        const resolvedEpochs = Number(payload.resolvedEpochs);
        const lastScannedBlock = String(payload.lastIndexedBlock ?? "");
        if (
          volumeRaw === null ||
          burnRaw === null ||
          !Number.isSafeInteger(resolvedEpochs) ||
          resolvedEpochs < 0 ||
          !/^\d+$/.test(lastScannedBlock)
        ) {
          throw new Error("global stats response is invalid");
        }
        if (controller.signal.aborted) return;
        const next = {
          volumeRaw,
          burnRaw,
          resolvedEpochs,
          lastScannedEpoch: Number(currentEpoch),
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
