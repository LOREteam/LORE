"use client";

import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { APP_CHAIN_ID, CONTRACT_ADDRESS } from "../lib/constants";
import { EpochTuple } from "./useGameData.helpers";

export interface LiveStateApiResponse {
  currentEpoch?: string | null;
  epochEndTime?: string | null;
  jackpotInfo?: string[] | null;
  rolloverPool?: string | null;
  currentEpochData?: [string, string, string, boolean, boolean, boolean] | null;
  tileData?: { pools?: string[] | null; users?: string[] | null } | null;
  tileUserCounts?: number[] | null;
  indexedTilePools?: string[] | null;
  epochDuration?: string | null;
  pendingEpochDuration?: string | null;
  pendingEpochDurationEta?: string | null;
  pendingEpochDurationEffectiveFromEpoch?: string | null;
  fetchedAt?: number;
}

interface UseGameLiveStateSnapshotOptions {
  initialSnapshot?: LiveStateApiResponse | null;
  isPageVisible: boolean;
}

const LIVE_STATE_FALLBACK_POLL_MS = 5_000;
const LIVE_STATE_SNAPSHOT_MAX_AGE_MS = 45_000;
const LIVE_STATE_BOOT_TIMEOUT_MS = 2_500;
const LIVE_READ_DEFER_MS = 1_200;

function getLiveStateSnapshotKey() {
  return `lore:live-state-snapshot:v1:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`;
}

function loadLiveStateSnapshot(): LiveStateApiResponse | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(getLiveStateSnapshotKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LiveStateApiResponse;
    if (!parsed || typeof parsed.fetchedAt !== "number") return null;
    if (Date.now() - parsed.fetchedAt > LIVE_STATE_SNAPSHOT_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function toBigIntOrNull(value?: string | null) {
  if (!value) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function toBigIntArray(values?: string[] | null) {
  if (!values) return null;
  const parsed: bigint[] = [];
  for (const value of values) {
    try {
      parsed.push(BigInt(value));
    } catch {
      return null;
    }
  }
  return parsed;
}

export function useGameLiveStateSnapshot(options: UseGameLiveStateSnapshotOptions) {
  const { initialSnapshot = null, isPageVisible } = options;
  const [snapshotState, setSnapshotState] = useState(() => {
    const snapshot = initialSnapshot;
    return {
      snapshot,
      bootstrapPending: snapshot == null,
      liveContractReadsEnabled: false,
    };
  });
  const serverLiveState = snapshotState.snapshot;
  const liveContractReadsEnabled = snapshotState.liveContractReadsEnabled;
  const liveStateBootstrapPending = snapshotState.bootstrapPending;

  useLayoutEffect(() => {
    setSnapshotState((current) => {
      if (current.snapshot) {
        return current;
      }
      const snapshot = initialSnapshot ?? loadLiveStateSnapshot();
      if (!snapshot) {
        return current;
      }
      return {
        snapshot,
        bootstrapPending: false,
        liveContractReadsEnabled: false,
      };
    });
  }, [initialSnapshot]);

  useEffect(() => {
    if (liveContractReadsEnabled) return;
    const timeoutMs =
      snapshotState.snapshot == null && snapshotState.bootstrapPending
        ? LIVE_STATE_BOOT_TIMEOUT_MS
        : LIVE_READ_DEFER_MS;
    const timeoutId = window.setTimeout(() => {
      setSnapshotState((current) =>
        current.liveContractReadsEnabled ? current : { ...current, liveContractReadsEnabled: true },
      );
    }, timeoutMs);
    return () => window.clearTimeout(timeoutId);
  }, [liveContractReadsEnabled, snapshotState.bootstrapPending, snapshotState.snapshot]);

  useEffect(() => {
    if (!isPageVisible) return;
    let cancelled = false;

    const fetchLiveState = async () => {
      try {
        const response = await fetch("/api/live-state", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as LiveStateApiResponse;
        if (!cancelled) {
          setSnapshotState((current) => ({
            snapshot: payload,
            bootstrapPending: false,
            liveContractReadsEnabled: current.liveContractReadsEnabled,
          }));
        }
        try {
          window.localStorage.setItem(getLiveStateSnapshotKey(), JSON.stringify(payload));
        } catch {
          // Ignore storage quota/privacy mode failures.
        }
      } catch {
        // Keep the last known server snapshot when browser-side RPC or fetch hiccups.
      }
    };

    void fetchLiveState();
    const intervalId = window.setInterval(fetchLiveState, LIVE_STATE_FALLBACK_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isPageVisible]);

  const fallbackCurrentEpoch = useMemo(
    () => toBigIntOrNull(serverLiveState?.currentEpoch ?? null),
    [serverLiveState?.currentEpoch],
  );
  const fallbackEpochEndTime = useMemo(
    () => toBigIntOrNull(serverLiveState?.epochEndTime ?? null),
    [serverLiveState?.epochEndTime],
  );
  const fallbackJackpotInfoRaw = useMemo(() => {
    const tuple = serverLiveState?.jackpotInfo;
    if (!tuple || tuple.length !== 8) return null;
    const parsed = toBigIntArray(tuple);
    if (!parsed || parsed.length !== 8) return null;
    return parsed as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
  }, [serverLiveState?.jackpotInfo]);
  const fallbackRolloverPoolRaw = useMemo(
    () => toBigIntOrNull(serverLiveState?.rolloverPool ?? null),
    [serverLiveState?.rolloverPool],
  );
  const fallbackCurrentEpochData = useMemo(() => {
    const tuple = serverLiveState?.currentEpochData;
    if (!tuple) return null;
    const totalPool = toBigIntOrNull(tuple[0]);
    const rewardPool = toBigIntOrNull(tuple[1]);
    const winningTile = toBigIntOrNull(tuple[2]);
    if (totalPool == null || rewardPool == null || winningTile == null) return null;
    return [totalPool, rewardPool, winningTile, Boolean(tuple[3]), Boolean(tuple[4]), Boolean(tuple[5])] as EpochTuple;
  }, [serverLiveState?.currentEpochData]);
  const fallbackTileData = useMemo(() => {
    const tileData = serverLiveState?.tileData;
    if (!tileData) return null;
    const pools = toBigIntArray(tileData.pools ?? null);
    const users = toBigIntArray(tileData.users ?? null);
    if (!pools || !users) return null;
    return [pools, users] as [bigint[], bigint[]];
  }, [serverLiveState?.tileData]);
  const fallbackTileUserCounts = useMemo(() => {
    const counts = serverLiveState?.tileUserCounts;
    if (!counts || counts.length === 0) return null;
    return counts.slice(0, 25).map((value) => {
      const count = Number(value);
      return Number.isFinite(count) && count >= 0 ? count : 0;
    });
  }, [serverLiveState?.tileUserCounts]);
  const fallbackIndexedTilePools = useMemo(
    () => toBigIntArray(serverLiveState?.indexedTilePools ?? null),
    [serverLiveState?.indexedTilePools],
  );
  const fallbackEpochDuration = useMemo(
    () => toBigIntOrNull(serverLiveState?.epochDuration ?? null),
    [serverLiveState?.epochDuration],
  );
  const fallbackPendingEpochDuration = useMemo(
    () => toBigIntOrNull(serverLiveState?.pendingEpochDuration ?? null),
    [serverLiveState?.pendingEpochDuration],
  );
  const fallbackPendingEpochDurationEta = useMemo(
    () => toBigIntOrNull(serverLiveState?.pendingEpochDurationEta ?? null),
    [serverLiveState?.pendingEpochDurationEta],
  );
  const fallbackPendingEpochDurationEffectiveFromEpoch = useMemo(
    () => toBigIntOrNull(serverLiveState?.pendingEpochDurationEffectiveFromEpoch ?? null),
    [serverLiveState?.pendingEpochDurationEffectiveFromEpoch],
  );

  return {
    serverLiveState,
    liveContractReadsEnabled,
    liveStateBootstrapPending,
    fallbackCurrentEpoch,
    fallbackEpochEndTime,
    fallbackJackpotInfoRaw,
    fallbackRolloverPoolRaw,
    fallbackCurrentEpochData,
    fallbackTileData,
    fallbackTileUserCounts,
    fallbackIndexedTilePools,
    fallbackEpochDuration,
    fallbackPendingEpochDuration,
    fallbackPendingEpochDurationEta,
    fallbackPendingEpochDurationEffectiveFromEpoch,
  };
}
