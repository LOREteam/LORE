"use client";

import { useEffect, useRef, useState } from "react";
import {
  CONTRACT_ADDRESS,
  APP_CHAIN_ID,
} from "../lib/constants";
import {
  fetchGlobalStatsAccumulator,
  getUsableGlobalStatsAccumulator,
  loadGlobalStatsCache,
  normalizeGlobalStatsAccumulator,
  removeGlobalStatsCache,
  safeGlobalStatsCurrentEpoch,
  saveGlobalStatsCache,
  type GlobalStatsAccumulator,
} from "../lib/globalStatsRuntime";
import { formatLineaAmountFixed } from "../lib/tokenAmountMath";

export { getUsableGlobalStatsAccumulator, normalizeGlobalStatsAccumulator };

const STORAGE_KEY = `lore:global-stats-cache:v4:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`;
const GLOBAL_STATS_REQUEST_TIMEOUT_MS = 12_000;

export interface GlobalStats {
  totalVolume: string;
  totalBurn: string;
  totalVolumeRaw: bigint;
  totalBurnRaw: bigint;
  resolvedEpochs: number;
}

function fmt(v: bigint): string {
  const oneTokenWei = 10n ** 18n;
  if (v >= 1_000_000n * oneTokenWei) return `${formatLineaAmountFixed(v / 1_000_000n, 2)}M`;
  if (v >= 1_000n * oneTokenWei) return `${formatLineaAmountFixed(v / 1_000n, 2)}K`;
  return formatLineaAmountFixed(v, 2);
}

function toStats(acc: GlobalStatsAccumulator): GlobalStats {
  return {
    totalVolume: fmt(acc.volumeRaw),
    totalBurn: fmt(acc.burnRaw),
    totalVolumeRaw: acc.volumeRaw,
    totalBurnRaw: acc.burnRaw,
    resolvedEpochs: acc.resolvedEpochs,
  };
}

export function useGlobalStats(currentEpoch?: bigint | null, enabled = true) {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [loading, setLoading] = useState(false);
  const accRef = useRef<GlobalStatsAccumulator | null>(null);
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
    const storage = typeof localStorage === "undefined" ? null : localStorage;
    const cached = loadGlobalStatsCache(storage, STORAGE_KEY);
    const currentEpochNumber = safeGlobalStatsCurrentEpoch(currentEpoch);
    const usable = currentEpochNumber === null ? cached : getUsableGlobalStatsAccumulator(cached, currentEpochNumber);
    if (usable) {
      accRef.current = usable;
      if (mountedRef.current) {
        setStats(toStats(usable));
      }
    }
  }, [currentEpoch]);

  useEffect(() => {
    const currentEpochNumber = safeGlobalStatsCurrentEpoch(currentEpoch);
    if (currentEpochNumber === null) return;
    if (!accRef.current) return;
    if (getUsableGlobalStatsAccumulator(accRef.current, currentEpochNumber)) return;
    accRef.current = null;
    removeGlobalStatsCache(typeof localStorage === "undefined" ? null : localStorage, STORAGE_KEY);
    if (mountedRef.current) setStats(null);
  }, [currentEpoch]);

  useEffect(() => {
    if (!enabled) return;
    if (currentEpoch == null) return;
    if (lastFetchedEpochRef.current === currentEpoch) return;
    const currentEpochNumber = safeGlobalStatsCurrentEpoch(currentEpoch);
    if (currentEpochNumber === null) return;

    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("Global stats request timed out", "TimeoutError"));
    }, GLOBAL_STATS_REQUEST_TIMEOUT_MS);
    if (accRef.current === null && mountedRef.current) setLoading(true);
    void fetchGlobalStatsAccumulator({
      currentEpoch: currentEpochNumber,
      signal: controller.signal,
    })
      .then((next) => {
        if (controller.signal.aborted) return;
        accRef.current = next;
        saveGlobalStatsCache(
          typeof localStorage === "undefined" ? null : localStorage,
          STORAGE_KEY,
          next,
        );
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
