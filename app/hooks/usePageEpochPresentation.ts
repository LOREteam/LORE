"use client";

import { useEffect, useMemo, useRef, useState } from "react";

interface UsePageEpochPresentationOptions {
  actualCurrentEpoch: bigint | null | undefined;
  gridDisplayEpoch: string | null | undefined;
  isRevealing: boolean;
  liveStateReady: boolean;
  selectedTiles: number[];
  selectedTilesEpoch: string | null;
  timeLeft: number;
  visualEpoch: unknown;
}

export function usePageEpochPresentation({
  actualCurrentEpoch,
  gridDisplayEpoch,
  isRevealing,
  liveStateReady,
  selectedTiles,
  selectedTilesEpoch,
  timeLeft,
  visualEpoch,
}: UsePageEpochPresentationOptions) {
  const [revealJustEnded, setRevealJustEnded] = useState(false);
  const prevRevealRef = useRef(false);

  useEffect(() => {
    if (prevRevealRef.current && !isRevealing) {
      setRevealJustEnded(true);
      const timeoutId = setTimeout(() => setRevealJustEnded(false), 2000);
      return () => clearTimeout(timeoutId);
    }
    prevRevealRef.current = isRevealing;
  }, [isRevealing]);

  const isAnalyzing =
    liveStateReady && timeLeft === 0 && !isRevealing && Boolean(visualEpoch) && !revealJustEnded;

  const showSelectionOnGrid =
    !isRevealing &&
    !isAnalyzing &&
    actualCurrentEpoch != null &&
    gridDisplayEpoch != null &&
    gridDisplayEpoch === actualCurrentEpoch.toString();

  const gridSelectedTiles = useMemo(() => {
    if (!showSelectionOnGrid) return [];
    if (selectedTilesEpoch && gridDisplayEpoch !== selectedTilesEpoch) return [];
    return selectedTiles;
  }, [gridDisplayEpoch, selectedTiles, selectedTilesEpoch, showSelectionOnGrid]);

  return useMemo(
    () => ({
      gridSelectedTiles,
      isAnalyzing,
      showSelectionOnGrid,
    }),
    [gridSelectedTiles, isAnalyzing, showSelectionOnGrid],
  );
}
