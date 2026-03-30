"use client";

import { useCallback, useRef, useState } from "react";
import { normalizeTiles } from "./useMining.shared";

interface UseMiningSelectionStateOptions {
  autoMineActive: () => boolean;
  refetchDelayMs: number;
  refetchTileData: () => void;
  refetchUserBets: () => void;
}

export function useMiningSelectionState({
  autoMineActive,
  refetchDelayMs,
  refetchTileData,
  refetchUserBets,
}: UseMiningSelectionStateOptions) {
  const [selectedTiles, setSelectedTiles] = useState<number[]>([]);
  const [selectedTilesEpoch, setSelectedTilesEpoch] = useState<string | null>(null);
  const scheduleRefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRefetch = useCallback(() => {
    if (scheduleRefetchTimerRef.current) clearTimeout(scheduleRefetchTimerRef.current);
    scheduleRefetchTimerRef.current = setTimeout(() => {
      scheduleRefetchTimerRef.current = null;
      refetchTileData();
      refetchUserBets();
    }, refetchDelayMs);
  }, [refetchDelayMs, refetchTileData, refetchUserBets]);

  const clearScheduledRefetch = useCallback(() => {
    if (!scheduleRefetchTimerRef.current) return;
    clearTimeout(scheduleRefetchTimerRef.current);
    scheduleRefetchTimerRef.current = null;
  }, []);

  const finalizeMineSuccess = useCallback(() => {
    setSelectedTiles([]);
    setSelectedTilesEpoch(null);
    scheduleRefetch();
  }, [scheduleRefetch]);

  const handleTileClick = useCallback(
    (tileId: number, isRevealing: boolean) => {
      if (isRevealing || autoMineActive()) return;
      setSelectedTilesEpoch(null);
      setSelectedTiles((prev) =>
        prev.includes(tileId) ? prev.filter((id) => id !== tileId) : [...prev, tileId],
      );
    },
    [autoMineActive],
  );

  const setTiles = useCallback((tiles: number[]) => {
    if (autoMineActive()) return;
    setSelectedTilesEpoch(null);
    setSelectedTiles(normalizeTiles(tiles));
  }, [autoMineActive]);

  return {
    clearScheduledRefetch,
    finalizeMineSuccess,
    handleTileClick,
    selectedTiles,
    selectedTilesEpoch,
    setSelectedTiles,
    setSelectedTilesEpoch,
    setTiles,
  };
}
