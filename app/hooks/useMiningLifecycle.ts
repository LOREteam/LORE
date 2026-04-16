"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { log } from "../lib/logger";
import {
  getAutoMineRestoreFingerprint,
  shouldSuppressDuplicateAutoMineRestore,
} from "../lib/mining/autoMineRestoreDeduper";
import type { AutoMinePhase } from "./useMining.types";
import type { createAutoMineRuntimeController } from "../lib/mining/autoMineRuntimeController";

declare global {
  interface Window {
    __loreAutoMineRestoreAt?: number;
    __loreAutoMineRestoreFingerprint?: string;
  }
}

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
  autoMinePhase: AutoMinePhase;
  runtimeController: ReturnType<typeof createAutoMineRuntimeController>;
  getPreferredActorAddress: () => string | null;
  hasPreferredActor: boolean;
  isAutoMining: boolean;
  publicClientReady: boolean;
  restoreAttemptedRef: MutableRefObject<boolean>;
  runAutoMining: (params: RunAutoMiningParams) => Promise<void>;
  sessionExpiredErrorRef: MutableRefObject<boolean>;
  activateAutoMineUi: (options: {
    phase: Extract<AutoMinePhase, "starting" | "restoring" | "running">;
    params: { betStr: string; blocks: number; rounds: number };
    progress?: string | null;
  }) => void;
  deactivateAutoMineUi: (options?: {
    phase?: Extract<AutoMinePhase, "idle" | "retry-wait" | "session-expired">;
    progress?: string | null;
  }) => void;
}

export function useMiningLifecycle({
  autoMineRef,
  autoResumeRequestedRef,
  clearScheduledRefetch,
  autoMinePhase,
  runtimeController,
  getPreferredActorAddress,
  hasPreferredActor,
  isAutoMining,
  publicClientReady,
  restoreAttemptedRef,
  runAutoMining,
  sessionExpiredErrorRef,
  activateAutoMineUi,
  deactivateAutoMineUi,
}: UseMiningLifecycleOptions) {
  const runAutoMiningRef = useRef(runAutoMining);
  const clearRestoreMarker = useCallback(() => {
    if (typeof window === "undefined") return;
    window.__loreAutoMineRestoreFingerprint = undefined;
    window.__loreAutoMineRestoreAt = undefined;
  }, []);

  useEffect(() => {
    runAutoMiningRef.current = runAutoMining;
  }, [runAutoMining]);

  const restoreSavedSession = useCallback(
    async (progressMessage: string) => {
      const restoreResult = runtimeController.readRestorableRun();
      const saved = restoreResult.kind === "resume" ? restoreResult.session : null;
      log.info("AutoMine", "restore check", {
        hasSaved: !!saved,
        nextRound: saved?.nextRoundIndex,
        totalRounds: saved?.rounds,
      });

      if (restoreResult.kind !== "resume") {
        autoResumeRequestedRef.current = false;
        clearRestoreMarker();
        deactivateAutoMineUi();
        return;
      }

      const now = Date.now();
      const fingerprint = getAutoMineRestoreFingerprint(restoreResult.session);
      if (
        typeof window !== "undefined" &&
        shouldSuppressDuplicateAutoMineRestore({
          previousAt: window.__loreAutoMineRestoreAt,
          previousFingerprint: window.__loreAutoMineRestoreFingerprint,
          nextFingerprint: fingerprint,
          now,
        })
      ) {
        log.info("AutoMine", "restore skipped - duplicate remount restore suppressed", {
          nextRound: restoreResult.session.nextRoundIndex,
          totalRounds: restoreResult.session.rounds,
        });
        deactivateAutoMineUi({
          phase: "retry-wait",
          progress: "Auto-miner is still recovering in this tab...",
        });
        return;
      }

      if (typeof window !== "undefined") {
        window.__loreAutoMineRestoreFingerprint = fingerprint;
        window.__loreAutoMineRestoreAt = now;
      }

      activateAutoMineUi({
        phase: "restoring",
        params: {
          betStr: restoreResult.params.betStr,
          blocks: restoreResult.params.blocks,
          rounds: restoreResult.params.rounds,
        },
        progress: progressMessage,
      });
      await runAutoMiningRef.current({
        betStr: restoreResult.params.betStr,
        blocks: restoreResult.params.blocks,
        rounds: restoreResult.params.rounds,
        startRoundIndex: restoreResult.params.startRoundIndex,
        lastPlacedEpoch: restoreResult.params.lastPlacedEpoch,
      });
    },
    [activateAutoMineUi, autoResumeRequestedRef, clearRestoreMarker, deactivateAutoMineUi, runtimeController],
  );

  const handleAutoMineToggle = useCallback(
    async (betStr: string, blocks: number, rounds: number) => {
      if (!publicClientReady) return;

      if (isAutoMining) {
        autoMineRef.current = false;
        autoResumeRequestedRef.current = false;
        clearRestoreMarker();
        deactivateAutoMineUi();
        runtimeController.stopByUser();
        return;
      }

      if (!getPreferredActorAddress()) {
        deactivateAutoMineUi({
          phase: "idle",
          progress: "Create an embedded wallet first, then start the bot.",
        });
        return;
      }

      sessionExpiredErrorRef.current = false;
      autoResumeRequestedRef.current = false;
      clearRestoreMarker();
      activateAutoMineUi({
        phase: "starting",
        params: { betStr, blocks, rounds },
      });
      runtimeController.persistStart({ betStr, blocks, rounds });

      await runAutoMiningRef.current({ betStr, blocks, rounds });
    },
    [
      autoMineRef,
      autoResumeRequestedRef,
      clearRestoreMarker,
      getPreferredActorAddress,
      isAutoMining,
      publicClientReady,
      runtimeController,
      sessionExpiredErrorRef,
      activateAutoMineUi,
      deactivateAutoMineUi,
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
    if (isAutoMining || autoMinePhase === "restoring") return;
    if (!autoResumeRequestedRef.current) return;
    if (!hasPreferredActor || !publicClientReady) return;

    const timeoutId = setTimeout(() => {
      void restoreSavedSession("Retrying saved session...");
    }, 5000);

    return () => clearTimeout(timeoutId);
  }, [autoMinePhase, autoResumeRequestedRef, hasPreferredActor, isAutoMining, publicClientReady, restoreSavedSession]);

  useEffect(() => {
    const onBeforeUnload = () => {
      if (autoMineRef.current) {
        log.warn("AutoMine", "tab closing while mining - releasing lock");
      }
      runtimeController.releaseLock();
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      clearScheduledRefetch();
      if (autoMineRef.current) {
        log.warn("AutoMine", "runtime unmounted while mining - pausing current loop");
        autoMineRef.current = false;
      }
    };
  }, [autoMineRef, clearScheduledRefetch, runtimeController]);

  return useMemo(
    () => ({ handleAutoMineToggle }),
    [handleAutoMineToggle],
  );
}
