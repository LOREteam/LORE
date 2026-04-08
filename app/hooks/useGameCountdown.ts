"use client";

import { useEffect, useRef } from "react";
import { computePollPhase, type PollPhase } from "./useGameEpochPresentation";

interface UseGameCountdownOptions {
  effectiveEpochEndTime?: bigint;
  liveStateReady: boolean;
  isRevealing: boolean;
  visualEpoch: string | null;
  lockedGridEpoch: string | null;
  setLockedGridEpoch: (value: string | null) => void;
  refetchEpoch: () => void;
  refetchGridEpochData: () => void;
  refetchEpochEndTime: () => void;
  setTimeLeft: (value: number) => void;
  setPollPhase: (value: PollPhase) => void;
}

export function useGameCountdown({
  effectiveEpochEndTime,
  liveStateReady,
  isRevealing,
  visualEpoch,
  lockedGridEpoch,
  setLockedGridEpoch,
  refetchEpoch,
  refetchGridEpochData,
  refetchEpochEndTime,
  setTimeLeft,
  setPollPhase,
}: UseGameCountdownOptions) {
  const timeLeftRef = useRef(0);
  const didRefetchAtZeroRef = useRef(false);
  const lastZeroRetryAtRef = useRef(0);

  // Single ref container for props that change frequently, avoids stale closures
  // while keeping the code DRY and reducing individual ref bookkeeping.
  const latestRef = useRef({
    isRevealing,
    visualEpoch,
    lockedGridEpoch,
    refetchEpoch,
    refetchGridEpochData,
    refetchEpochEndTime,
  });
  latestRef.current = {
    isRevealing,
    visualEpoch,
    lockedGridEpoch,
    refetchEpoch,
    refetchGridEpochData,
    refetchEpochEndTime,
  };

  useEffect(() => {
    if (!liveStateReady || !effectiveEpochEndTime) {
      setTimeLeft(0);
      timeLeftRef.current = 0;
      setPollPhase("slow");
      return;
    }

    const updateTimeLeft = () => {
      const endMs = Number(effectiveEpochEndTime) * 1000;
      const now = Date.now();
      const nextTimeLeft = endMs > now ? Math.floor((endMs - now) / 1000) : 0;
      const previousTimeLeft = timeLeftRef.current;
      timeLeftRef.current = nextTimeLeft;
      setTimeLeft(nextTimeLeft);

      const previousPhase = computePollPhase(previousTimeLeft);
      const nextPhase = computePollPhase(nextTimeLeft);
      if (previousPhase !== nextPhase) {
        setPollPhase(nextPhase);
      }

      if (nextTimeLeft === 0 && previousTimeLeft > 0) {
        didRefetchAtZeroRef.current = false;
      }
      if (nextTimeLeft === 0 && !didRefetchAtZeroRef.current) {
        didRefetchAtZeroRef.current = true;
        lastZeroRetryAtRef.current = now;
        const { isRevealing: rev, visualEpoch: ve, lockedGridEpoch: lge } = latestRef.current;
        if (ve && !lge && !rev) {
          setLockedGridEpoch(ve);
        }
        latestRef.current.refetchEpoch();
        latestRef.current.refetchGridEpochData();
        latestRef.current.refetchEpochEndTime();
      } else if (
        nextTimeLeft === 0 &&
        !latestRef.current.isRevealing &&
        now - lastZeroRetryAtRef.current >= 5_000
      ) {
        lastZeroRetryAtRef.current = now;
        latestRef.current.refetchEpoch();
        latestRef.current.refetchGridEpochData();
        latestRef.current.refetchEpochEndTime();
      }
    };

    updateTimeLeft();
    const intervalId = setInterval(updateTimeLeft, 1000);
    return () => clearInterval(intervalId);
  }, [effectiveEpochEndTime, liveStateReady, setLockedGridEpoch, setPollPhase, setTimeLeft]);
}
