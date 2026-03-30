"use client";

import { useMemo } from "react";
import {
  EpochTuple,
  mergeIndexedTilePools,
} from "./useGameData.helpers";

const positiveBigIntOrUndefined = (value: bigint | null | undefined) =>
  value != null && value > 0n ? value : undefined;

interface UseGameEffectiveStateOptions {
  actualCurrentEpoch?: bigint | null;
  fallbackCurrentEpoch?: bigint | null;
  gridDisplayEpochBigInt: bigint | null;
  gridEpochData?: unknown;
  fallbackCurrentEpochData?: unknown;
  tileData?: unknown;
  fallbackTileData?: unknown;
  fallbackIndexedTilePools?: bigint[] | null;
  gridAndCurrentAreSame: boolean;
  separateCurrentEpochData?: unknown;
  epochEndTime?: bigint | null;
  fallbackEpochEndTime?: bigint | null;
  jackpotInfoRaw?: readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] | null;
  fallbackJackpotInfoRaw?: readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] | null;
  rolloverPoolRaw?: bigint | null;
  fallbackRolloverPoolRaw?: bigint | null;
  epochDurationSec?: bigint | null;
  fallbackEpochDuration?: bigint | null;
  pendingEpochDuration?: bigint | null;
  fallbackPendingEpochDuration?: bigint | null;
  pendingEpochDurationEta?: bigint | null;
  fallbackPendingEpochDurationEta?: bigint | null;
  pendingEpochDurationEffectiveFromEpoch?: bigint | null;
  fallbackPendingEpochDurationEffectiveFromEpoch?: bigint | null;
}

export function useGameEffectiveState({
  actualCurrentEpoch,
  fallbackCurrentEpoch,
  gridDisplayEpochBigInt,
  gridEpochData,
  fallbackCurrentEpochData,
  tileData,
  fallbackTileData,
  fallbackIndexedTilePools,
  gridAndCurrentAreSame,
  separateCurrentEpochData,
  epochEndTime,
  fallbackEpochEndTime,
  jackpotInfoRaw,
  fallbackJackpotInfoRaw,
  rolloverPoolRaw,
  fallbackRolloverPoolRaw,
  epochDurationSec,
  fallbackEpochDuration,
  pendingEpochDuration,
  fallbackPendingEpochDuration,
  pendingEpochDurationEta,
  fallbackPendingEpochDurationEta,
  pendingEpochDurationEffectiveFromEpoch,
  fallbackPendingEpochDurationEffectiveFromEpoch,
}: UseGameEffectiveStateOptions) {
  const resolvedCurrentEpoch =
    positiveBigIntOrUndefined(actualCurrentEpoch) ?? positiveBigIntOrUndefined(fallbackCurrentEpoch);

  const serverStateMatchesGrid =
    fallbackCurrentEpoch != null &&
    (gridDisplayEpochBigInt == null || gridDisplayEpochBigInt === fallbackCurrentEpoch);

  const effectiveGridEpochData =
    gridEpochData ?? (serverStateMatchesGrid ? fallbackCurrentEpochData : undefined);

  const effectiveTileData = useMemo(() => {
    const baseTileData = tileData ?? (serverStateMatchesGrid ? fallbackTileData : undefined);
    if (!serverStateMatchesGrid) return baseTileData;
    return mergeIndexedTilePools(baseTileData, fallbackIndexedTilePools);
  }, [fallbackIndexedTilePools, fallbackTileData, serverStateMatchesGrid, tileData]);

  const currentEpochData = (gridAndCurrentAreSame ? gridEpochData : separateCurrentEpochData)
    ?? (resolvedCurrentEpoch != null && fallbackCurrentEpoch === resolvedCurrentEpoch ? fallbackCurrentEpochData : undefined);

  const effectiveEpochEndTime = useMemo(() => {
    const liveEpochEndTime = positiveBigIntOrUndefined(epochEndTime);
    const snapshotEpochEndTime =
      resolvedCurrentEpoch != null ? positiveBigIntOrUndefined(fallbackEpochEndTime) : undefined;
    if (liveEpochEndTime && snapshotEpochEndTime) {
      return liveEpochEndTime > snapshotEpochEndTime ? liveEpochEndTime : snapshotEpochEndTime;
    }
    return liveEpochEndTime ?? snapshotEpochEndTime;
  }, [epochEndTime, fallbackEpochEndTime, resolvedCurrentEpoch]);

  const effectiveJackpotInfoRaw = jackpotInfoRaw ?? fallbackJackpotInfoRaw ?? undefined;
  const effectiveRolloverPoolRaw = rolloverPoolRaw ?? fallbackRolloverPoolRaw ?? undefined;
  const effectiveEpochDurationSec = epochDurationSec ?? fallbackEpochDuration ?? undefined;
  const effectivePendingEpochDuration = pendingEpochDuration ?? fallbackPendingEpochDuration ?? undefined;
  const effectivePendingEpochDurationEta =
    pendingEpochDurationEta ?? fallbackPendingEpochDurationEta ?? undefined;
  const effectivePendingEpochDurationEffectiveFromEpoch =
    pendingEpochDurationEffectiveFromEpoch ?? fallbackPendingEpochDurationEffectiveFromEpoch ?? undefined;

  const liveStateReady = Boolean(
    resolvedCurrentEpoch != null &&
      resolvedCurrentEpoch > 0n &&
      effectiveEpochEndTime != null &&
      effectiveEpochEndTime > 0n,
  );

  const currentEpochResolved = currentEpochData
    ? Boolean((currentEpochData as EpochTuple)[3])
    : undefined;

  return {
    resolvedCurrentEpoch,
    serverStateMatchesGrid,
    effectiveGridEpochData,
    effectiveTileData,
    currentEpochData,
    currentEpochResolved,
    effectiveEpochEndTime,
    effectiveJackpotInfoRaw,
    effectiveRolloverPoolRaw,
    effectiveEpochDurationSec,
    effectivePendingEpochDuration,
    effectivePendingEpochDurationEta,
    effectivePendingEpochDurationEffectiveFromEpoch,
    liveStateReady,
  };
}
