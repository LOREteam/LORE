"use client";

import { useEffect, useMemo, useState } from "react";
import type { PollPhase } from "./useGameEpochPresentation";

interface UseGameEpochUiStateOptions {
  seededVisualEpoch: string | null;
}

export function useGameEpochUiState({ seededVisualEpoch }: UseGameEpochUiStateOptions) {
  const [visualEpoch, setVisualEpoch] = useState<string | null>(seededVisualEpoch);

  // Sync with seeded value when it becomes available after initial render
  // (e.g. live-state bootstrap resolves after the component mounted).
  useEffect(() => {
    if (seededVisualEpoch && seededVisualEpoch !== visualEpoch) {
      setVisualEpoch(seededVisualEpoch);
    }
    // Only react to seededVisualEpoch changes — visualEpoch is intentionally excluded
    // to avoid overwriting user-driven updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seededVisualEpoch]);
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
