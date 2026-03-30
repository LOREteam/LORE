"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { log } from "../lib/logger";
import { clearSession, readSession, saveSession } from "./useMining.shared";
import { releaseTabLock } from "./useMiningTabLock";

type RunningParams = { betStr: string; blocks: number; rounds: number } | null;
type AutoMineProgressSetter = Dispatch<SetStateAction<string | null>>;
type RunningParamsSetter = Dispatch<SetStateAction<RunningParams>>;
type BooleanSetter = Dispatch<SetStateAction<boolean>>;

export interface RunAutoMiningParams {
  betStr: string;
  blocks: number;
  rounds: number;
  startRoundIndex?: number;
  lastPlacedEpoch?: bigint | null;
}

interface UseMiningLifecycleOptions {
  autoMineRef: MutableRefObject<boolean>;
  autoResumeRequestedRef: MutableRefObject<boolean>;
  clearScheduledRefetch: () => void;
  getPreferredActorAddress: () => string | null;
  hasPreferredActor: boolean;
  isAutoMining: boolean;
  publicClientReady: boolean;
  restoreAttemptedRef: MutableRefObject<boolean>;
  runAutoMining: (params: RunAutoMiningParams) => Promise<void>;
  sessionExpiredErrorRef: MutableRefObject<boolean>;
  setAutoMineProgress: AutoMineProgressSetter;
  setIsAutoMining: BooleanSetter;
  setRunningParams: RunningParamsSetter;
}

export function useMiningLifecycle({
  autoMineRef,
  autoResumeRequestedRef,
  clearScheduledRefetch,
  getPreferredActorAddress,
  hasPreferredActor,
  isAutoMining,
  publicClientReady,
  restoreAttemptedRef,
  runAutoMining,
  sessionExpiredErrorRef,
  setAutoMineProgress,
  setIsAutoMining,
  setRunningParams,
}: UseMiningLifecycleOptions) {
  const runAutoMiningRef = useRef(runAutoMining);

  useEffect(() => {
    runAutoMiningRef.current = runAutoMining;
  }, [runAutoMining]);

  const restoreSavedSession = useCallback(
    async (progressMessage: string) => {
      const saved = readSession();
      log.info("AutoMine", "restore check", {
        hasSaved: !!saved,
        nextRound: saved?.nextRoundIndex,
        totalRounds: saved?.rounds,
      });

      if (!saved || !saved.active || saved.nextRoundIndex >= saved.rounds) {
        autoResumeRequestedRef.current = false;
        if (saved) clearSession();
        setIsAutoMining(false);
        setRunningParams(null);
        setAutoMineProgress(null);
        return;
      }

      autoResumeRequestedRef.current = false;
      setIsAutoMining(true);
      setRunningParams({ betStr: saved.betStr, blocks: saved.blocks, rounds: saved.rounds });
      setAutoMineProgress(progressMessage);
      const lastEpoch = saved.lastPlacedEpoch ? BigInt(saved.lastPlacedEpoch) : null;
      await runAutoMiningRef.current({
        betStr: saved.betStr,
        blocks: saved.blocks,
        rounds: saved.rounds,
        startRoundIndex: saved.nextRoundIndex,
        lastPlacedEpoch: lastEpoch,
      });
    },
    [autoResumeRequestedRef, setAutoMineProgress, setIsAutoMining, setRunningParams],
  );

  const handleAutoMineToggle = useCallback(
    async (betStr: string, blocks: number, rounds: number) => {
      if (!publicClientReady) return;

      if (isAutoMining) {
        autoMineRef.current = false;
        autoResumeRequestedRef.current = false;
        setIsAutoMining(false);
        setRunningParams(null);
        setAutoMineProgress(null);
        clearSession();
        releaseTabLock();
        return;
      }

      if (!getPreferredActorAddress()) {
        setAutoMineProgress("Create an embedded wallet first, then start the bot.");
        return;
      }

      sessionExpiredErrorRef.current = false;
      autoResumeRequestedRef.current = false;
      saveSession({
        active: true,
        betStr,
        blocks,
        rounds,
        nextRoundIndex: 0,
        lastPlacedEpoch: null,
      });

      await runAutoMiningRef.current({ betStr, blocks, rounds });
    },
    [
      autoMineRef,
      autoResumeRequestedRef,
      getPreferredActorAddress,
      isAutoMining,
      publicClientReady,
      sessionExpiredErrorRef,
      setAutoMineProgress,
      setIsAutoMining,
      setRunningParams,
    ],
  );

  useEffect(() => {
    if (restoreAttemptedRef.current) return;
    if (!hasPreferredActor || !publicClientReady) return;

    restoreAttemptedRef.current = true;

    const timeoutId = setTimeout(() => {
      void restoreSavedSession("Restoring...");
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [
    hasPreferredActor,
    publicClientReady,
    restoreAttemptedRef,
    restoreSavedSession,
  ]);

  useEffect(() => {
    if (isAutoMining) return;
    if (!autoResumeRequestedRef.current) return;
    if (!hasPreferredActor || !publicClientReady) return;

    const timeoutId = setTimeout(() => {
      void restoreSavedSession("Retrying saved session...");
    }, 5000);

    return () => clearTimeout(timeoutId);
  }, [autoResumeRequestedRef, hasPreferredActor, isAutoMining, publicClientReady, restoreSavedSession]);

  useEffect(() => {
    const onBeforeUnload = () => {
      if (autoMineRef.current) {
        log.warn("AutoMine", "tab closing while mining - releasing lock");
      }
      releaseTabLock();
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      clearScheduledRefetch();
    };
  }, [autoMineRef, clearScheduledRefetch]);

  return { handleAutoMineToggle };
}
