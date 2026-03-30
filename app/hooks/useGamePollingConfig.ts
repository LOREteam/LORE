"use client";

import { useMemo } from "react";
import type { PollPhase } from "./useGameEpochPresentation";

interface UseGamePollingConfigOptions {
  isPageVisible: boolean;
  pollPhase: PollPhase;
  liveGrid: boolean;
  autoMineSessionActive: boolean;
  isRevealing: boolean;
}

export function useGamePollingConfig({
  isPageVisible,
  pollPhase,
  liveGrid,
  autoMineSessionActive,
  isRevealing,
}: UseGamePollingConfigOptions) {
  return useMemo(() => {
    const epochInterval = isPageVisible
      ? pollPhase === "fast"
        ? 1200
        : pollPhase === "medium"
          ? 2500
          : 5000
      : 20_000;
    const epochEndInterval = isPageVisible ? (pollPhase === "fast" ? 1800 : 6000) : 20_000;
    const liveGridInterval = liveGrid
      ? autoMineSessionActive
        ? 1000
        : 3000
      : 30_000;
    const liveUserBetsInterval = liveGrid
      ? autoMineSessionActive
        ? 1000
        : 3000
      : 30_000;
    const gridEpochInterval = isPageVisible
      ? (isRevealing ? 500 : autoMineSessionActive ? 1000 : pollPhase === "fast" ? 1500 : 5000)
      : 20_000;

    return {
      epochInterval,
      epochEndInterval,
      liveGridInterval,
      liveUserBetsInterval,
      gridEpochInterval,
    };
  }, [autoMineSessionActive, isPageVisible, isRevealing, liveGrid, pollPhase]);
}
