"use client";

import { useMemo, useState } from "react";
import type { PollPhase } from "./useGameEpochPresentation";

interface UseGameEpochUiStateOptions {
  seededVisualEpoch: string | null;
}

export function useGameEpochUiState({ seededVisualEpoch }: UseGameEpochUiStateOptions) {
  const [visualEpoch, setVisualEpoch] = useState<string | null>(seededVisualEpoch);
  const [isRevealing, setIsRevealing] = useState(false);
  const [lockedGridEpoch, setLockedGridEpoch] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [pollPhase, setPollPhase] = useState<PollPhase>("slow");
  const gridDisplayEpoch = lockedGridEpoch ?? visualEpoch;

  const gridDisplayEpochBigInt = useMemo(
    () => (gridDisplayEpoch ? BigInt(gridDisplayEpoch) : null),
    [gridDisplayEpoch],
  );

  return {
    visualEpoch,
    setVisualEpoch,
    isRevealing,
    setIsRevealing,
    lockedGridEpoch,
    setLockedGridEpoch,
    gridDisplayEpoch,
    gridDisplayEpochBigInt,
    timeLeft,
    setTimeLeft,
    pollPhase,
    setPollPhase,
  };
}
