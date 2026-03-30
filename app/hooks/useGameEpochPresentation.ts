"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { MAX_REVEAL_DURATION_MS, MIN_WINNER_DISPLAY_MS } from "../lib/constants";
import type { EpochTuple } from "./useGameData.helpers";

export type PollPhase = "fast" | "medium" | "slow";

interface UseGameRevealStateOptions {
  actualCurrentEpoch?: bigint;
  gridEpochData?: unknown;
  visualEpoch: string | null;
  isRevealing: boolean;
  lockedGridEpoch: string | null;
  setVisualEpoch: (value: string | null) => void;
  setIsRevealing: (value: boolean) => void;
  setLockedGridEpoch: (value: string | null) => void;
  refetchGridEpochData: () => void;
  refetchUserBets: () => void;
}

export function computePollPhase(timeLeft: number): PollPhase {
  return timeLeft === 0 ? "fast" : timeLeft <= 10 ? "medium" : "slow";
}

export function useGameRevealState({
  actualCurrentEpoch,
  gridEpochData,
  visualEpoch,
  isRevealing,
  lockedGridEpoch,
  setVisualEpoch,
  setIsRevealing,
  setLockedGridEpoch,
  refetchGridEpochData,
  refetchUserBets,
}: UseGameRevealStateOptions) {
  const visualEpochBigInt = useMemo(() => (visualEpoch ? BigInt(visualEpoch) : null), [visualEpoch]);
  const gridDisplayEpoch = lockedGridEpoch ?? visualEpoch;

  const revealIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const revealStartTimeRef = useRef(0);
  const winnerFoundTimeRef = useRef(0);
  const revealTargetEpochRef = useRef<string | null>(null);
  const revealSafetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refetchGridEpochDataRef = useRef(refetchGridEpochData);
  const refetchUserBetsRef = useRef(refetchUserBets);
  refetchGridEpochDataRef.current = refetchGridEpochData;
  refetchUserBetsRef.current = refetchUserBets;

  const forceExitReveal = useCallback(() => {
    if (revealIntervalRef.current) {
      clearInterval(revealIntervalRef.current);
      revealIntervalRef.current = null;
    }
    if (revealSafetyRef.current) {
      clearTimeout(revealSafetyRef.current);
      revealSafetyRef.current = null;
    }
    const targetEpoch = revealTargetEpochRef.current;
    revealTargetEpochRef.current = null;
    setIsRevealing(false);
    setLockedGridEpoch(null);
    if (targetEpoch != null) setVisualEpoch(targetEpoch);
  }, [setIsRevealing, setLockedGridEpoch, setVisualEpoch]);

  useEffect(() => {
    if (!isRevealing) return;
    if (winnerFoundTimeRef.current > 0) return;
    if (gridEpochData) {
      const resolved = (gridEpochData as EpochTuple)[3];
      if (resolved) {
        winnerFoundTimeRef.current = Date.now();
      }
    }
  }, [gridEpochData, isRevealing]);

  useEffect(() => {
    if (!actualCurrentEpoch) return;

    if (!visualEpoch) {
      setVisualEpoch(actualCurrentEpoch.toString());
      return;
    }

    if (
      visualEpochBigInt &&
      actualCurrentEpoch > visualEpochBigInt &&
      !isRevealing &&
      !revealIntervalRef.current
    ) {
      const epochGap = actualCurrentEpoch - visualEpochBigInt;
      if (epochGap > 1n) {
        setVisualEpoch(actualCurrentEpoch.toString());
        setLockedGridEpoch(null);
        return;
      }

      revealTargetEpochRef.current = actualCurrentEpoch.toString();
      revealStartTimeRef.current = Date.now();
      winnerFoundTimeRef.current = 0;
      setLockedGridEpoch(visualEpoch);
      setIsRevealing(true);
      refetchGridEpochDataRef.current();
      setTimeout(() => {
        refetchUserBetsRef.current();
      }, 100);

      if (revealSafetyRef.current) clearTimeout(revealSafetyRef.current);
      revealSafetyRef.current = setTimeout(forceExitReveal, MAX_REVEAL_DURATION_MS + 3000);

      revealIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - revealStartTimeRef.current;

        if (winnerFoundTimeRef.current > 0) {
          const shownFor = Date.now() - winnerFoundTimeRef.current;
          if (shownFor >= MIN_WINNER_DISPLAY_MS) {
            forceExitReveal();
          }
          return;
        }

        if (elapsed >= MAX_REVEAL_DURATION_MS) {
          forceExitReveal();
        }
      }, 200);
    }
  }, [
    actualCurrentEpoch,
    forceExitReveal,
    isRevealing,
    setIsRevealing,
    setLockedGridEpoch,
    setVisualEpoch,
    visualEpoch,
    visualEpochBigInt,
  ]);

  useEffect(() => {
    return () => {
      if (revealIntervalRef.current) {
        clearInterval(revealIntervalRef.current);
        revealIntervalRef.current = null;
      }
      if (revealSafetyRef.current) {
        clearTimeout(revealSafetyRef.current);
        revealSafetyRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isRevealing) return;
    const check = setTimeout(() => {
      if (!revealIntervalRef.current) {
        forceExitReveal();
      }
    }, 1500);
    return () => clearTimeout(check);
  }, [forceExitReveal, isRevealing]);

  return {
    visualEpochBigInt,
    gridDisplayEpoch,
  };
}
