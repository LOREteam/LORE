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
  const isRevealingRef = useRef(isRevealing);
  const visualEpochRef = useRef(visualEpoch);
  const lockedGridEpochRef = useRef(lockedGridEpoch);
  const refetchEpochRef = useRef(refetchEpoch);
  const refetchGridEpochDataRef = useRef(refetchGridEpochData);
  const refetchEpochEndTimeRef = useRef(refetchEpochEndTime);

  isRevealingRef.current = isRevealing;
  visualEpochRef.current = visualEpoch;
  lockedGridEpochRef.current = lockedGridEpoch;
  refetchEpochRef.current = refetchEpoch;
  refetchGridEpochDataRef.current = refetchGridEpochData;
  refetchEpochEndTimeRef.current = refetchEpochEndTime;

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
        if (visualEpochRef.current && !lockedGridEpochRef.current && !isRevealingRef.current) {
          setLockedGridEpoch(visualEpochRef.current);
        }
        refetchEpochRef.current();
        refetchGridEpochDataRef.current();
        refetchEpochEndTimeRef.current();
      } else if (
        nextTimeLeft === 0 &&
        !isRevealingRef.current &&
        now - lastZeroRetryAtRef.current >= 5_000
      ) {
        lastZeroRetryAtRef.current = now;
        refetchEpochRef.current();
        refetchGridEpochDataRef.current();
        refetchEpochEndTimeRef.current();
      }
    };

    updateTimeLeft();
    const intervalId = setInterval(updateTimeLeft, 1000);
    return () => clearInterval(intervalId);
  }, [effectiveEpochEndTime, liveStateReady, setLockedGridEpoch, setPollPhase, setTimeLeft]);
}
