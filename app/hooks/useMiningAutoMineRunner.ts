"use client";

import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { PublicClient } from "viem";
import { log } from "../lib/logger";
import { delay } from "../lib/utils";
import {
  SESSION_REFRESH_INTERVAL_MS,
  getSecureRandomNumber,
  isInsufficientFundsError,
} from "./useMining.shared";
import type { AutoMineDiagnosticsStopReason } from "../lib/mining/autoMineDiagnostics";
import {
  acquireTabLock,
  recoverOrphanedTabLock,
  renewTabLock,
} from "./useMiningTabLock";
import { getAutoMineUserMessage } from "./useMiningAutoMineError";
import { runAutoMineLoop } from "./useMiningAutoMineLoop";
import { prepareAutoMineRunSetup } from "../lib/mining/autoMineRunSetup";
import { createAutoMineLoopAdapter } from "../lib/mining/autoMineLoopAdapter";
import { createAutoMineLoopRuntime } from "../lib/mining/autoMineLoopRuntime";
import { writeAutoMineDiagnostics } from "../lib/mining/autoMineDiagnostics";
import type { AutoMinePhase, GasOverrides, RunningParams } from "./useMining.types";
import type { PendingApproveState, PendingBetState, ReceiptState } from "./useMining.stateTypes";
import type { createAutoMineRuntimeController } from "../lib/mining/autoMineRuntimeController";

declare global {
  interface Window {
    __loreAutoMineRuntimeActive?: boolean;
  }
}

function claimInTabAutoMineRuntime(): boolean {
  if (typeof window === "undefined") return true;
  if (window.__loreAutoMineRuntimeActive) return false;
  window.__loreAutoMineRuntimeActive = true;
  return true;
}

function releaseInTabAutoMineRuntime() {
  if (typeof window === "undefined") return;
  window.__loreAutoMineRuntimeActive = false;
}

type RunningParamsSetter = Dispatch<SetStateAction<RunningParams>>;
type BooleanSetter = Dispatch<SetStateAction<boolean>>;
type StringSetter = Dispatch<SetStateAction<string | null>>;
type NumberArraySetter = Dispatch<SetStateAction<number[]>>;
type NullableStringSetter = Dispatch<SetStateAction<string | null>>;

interface UseMiningAutoMineRunnerOptions {
  approveRetryMax: number;
  assertNativeGasBalance: (gas: bigint, gasOverrides?: GasOverrides) => Promise<void>;
  autoMineRef: MutableRefObject<boolean>;
  autoResumeRequestedRef: MutableRefObject<boolean>;
  betPendingGraceMs: number;
  betPendingStaleMs: number;
  completeAutoMineRound: (args: {
    betStr: string;
    blocks: number;
    rounds: number;
    roundIndex: number;
    placedEpoch: bigint;
    displayTiles?: number[];
    displayEpoch?: bigint;
    progressMessage?: string;
    announceBet?: boolean;
  }) => Promise<void>;
  forceReplacePendingNonceGap: number;
  gasBumpBase: bigint;
  gasBumpReplacementStep: bigint;
  getBumpedFees: (stepBps?: bigint) => Promise<GasOverrides | undefined>;
  getPreferredActorAddress: () => string | null;
  getUrgentFees: () => Promise<GasOverrides | undefined>;
  maxBetAttempts: number;
  maxNetworkAttempts: number;
  maxNetworkMs: number;
  minGasApprove: bigint;
  networkInitialMs: number;
  networkRetryMax: number;
  runtimeController: ReturnType<typeof createAutoMineRuntimeController>;
  onAutoMineBetConfirmedRef: MutableRefObject<(() => void) | undefined>;
  pendingApproveRef: MutableRefObject<PendingApproveState | null>;
  pendingBetRef: MutableRefObject<PendingBetState | null>;
  placeBets: (
    tileIds: number[],
    amountRawPerTile: bigint,
    gasOverrides?: GasOverrides,
  ) => Promise<ReceiptState>;
  placeBetsSilent: (
    tileIds: number[],
    amountRawPerTile: bigint,
    gasOverrides?: GasOverrides,
  ) => Promise<ReceiptState>;
  placeBets7702?: (
    tileIds: number[],
    amountRawPerTile: bigint,
    gasOverrides?: GasOverrides,
  ) => Promise<ReceiptState>;
  publicClientRef: MutableRefObject<PublicClient | undefined>;
  refetchAllowanceRef: MutableRefObject<() => void>;
  refetchEpochRef: MutableRefObject<(() => void) | undefined>;
  refreshSessionRef: MutableRefObject<(() => Promise<void>) | undefined>;
  sessionExpiredErrorRef: MutableRefObject<boolean>;
  setAutoMineProgress: StringSetter;
  setIsAutoMining: BooleanSetter;
  setRunningParams: RunningParamsSetter;
  activateAutoMineUi: (options: {
    phase: Extract<AutoMinePhase, "starting" | "restoring" | "running">;
    params: NonNullable<RunningParams>;
    progress?: string | null;
  }) => void;
  deactivateAutoMineUi: (options?: {
    phase?: Extract<AutoMinePhase, "idle" | "retry-wait" | "session-expired">;
    progress?: string | null;
  }) => void;
  setAutoMinePhase: (phase: AutoMinePhase) => void;
  setSelectedTiles: NumberArraySetter;
  setSelectedTilesEpoch: NullableStringSetter;
  silentSendRef: MutableRefObject<unknown>;
  waitReceipt: (hash: `0x${string}`, client?: PublicClient) => Promise<ReceiptState>;
  readWriteContractAsync: () => (args: unknown) => Promise<`0x${string}`>;
  ensurePreferredWalletRef: MutableRefObject<(() => Promise<void> | void) | undefined>;
}

export function useMiningAutoMineRunner({
  approveRetryMax,
  assertNativeGasBalance,
  autoMineRef,
  autoResumeRequestedRef,
  betPendingGraceMs,
  betPendingStaleMs,
  completeAutoMineRound,
  forceReplacePendingNonceGap,
  gasBumpBase,
  gasBumpReplacementStep,
  getBumpedFees,
  getPreferredActorAddress,
  getUrgentFees,
  maxBetAttempts,
  maxNetworkAttempts,
  maxNetworkMs,
  minGasApprove,
  networkInitialMs,
  networkRetryMax,
  runtimeController,
  onAutoMineBetConfirmedRef,
  pendingApproveRef,
  pendingBetRef,
  placeBets,
  placeBetsSilent,
  placeBets7702,
  publicClientRef,
  refetchAllowanceRef,
  refetchEpochRef,
  refreshSessionRef,
  sessionExpiredErrorRef,
  setAutoMineProgress,
  setIsAutoMining,
  setRunningParams,
  activateAutoMineUi,
  deactivateAutoMineUi,
  setAutoMinePhase,
  setSelectedTiles,
  setSelectedTilesEpoch,
  silentSendRef,
  waitReceipt,
  readWriteContractAsync,
  ensurePreferredWalletRef,
}: UseMiningAutoMineRunnerOptions) {
  return useCallback(
    async (params: {
      betStr: string;
      blocks: number;
      rounds: number;
      startRoundIndex?: number;
      lastPlacedEpoch?: bigint | null;
    }) => {
      const { betStr, blocks, rounds, startRoundIndex = 0, lastPlacedEpoch: restoredLastEpoch = null } = params;
      if (autoMineRef.current) return;
      if (!claimInTabAutoMineRuntime()) {
        log.warn("AutoMine", "existing in-tab runtime still active - deferring start");
        autoResumeRequestedRef.current = true;
        deactivateAutoMineUi({
          phase: "retry-wait",
          progress: "Auto-miner is still recovering in this tab...",
        });
        return;
      }

      let startedRun = false;
      let stopReason = "unknown";
      try {
        activateAutoMineUi({
          phase: startRoundIndex > 0 ? "restoring" : "starting",
          params: { betStr, blocks, rounds },
        });

        const preparedRun = await prepareAutoMineRunSetup({
          acquireTabLock,
          actorAddress: getPreferredActorAddress(),
          approveRetryMax,
          assertNativeGasBalance,
          autoMineActive: () => autoMineRef.current,
          betStr,
          blocks,
          clearPendingApprove: () => {
            pendingApproveRef.current = null;
          },
          ensurePreferredWallet: () => ensurePreferredWalletRef.current?.(),
          getUrgentFees,
          markRunStarted: () => {
            startedRun = true;
            autoMineRef.current = true;
          },
          maxNetworkAttempts,
          maxNetworkMs,
          minGasApprove,
          networkInitialMs,
          onClearPersistedSession: () => runtimeController.clearPersistedRun(),
          onProgress: setAutoMineProgress,
          pendingApproveRef,
          publicClient: publicClientRef.current,
          readSilentSend: () => silentSendRef.current as
            | ((
                tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint; nonce?: number },
                gasOverrides?: GasOverrides,
              ) => Promise<`0x${string}`>)
            | undefined,
          recoverOrphanedTabLock,
          refetchAllowance: () => refetchAllowanceRef.current(),
          rounds,
          setIsAutoMining,
          setRunningParams,
          setSelectedTiles,
          setSelectedTilesEpoch,
          startRoundIndex,
          waitReceipt,
          writeApprove: (args: unknown) => readWriteContractAsync()(args as never),
        });

        if (!preparedRun) {
          return;
        }
        const { actorAddress, singleAmountRaw } = preparedRun;
        setAutoMinePhase("running");
        const loopRuntime = createAutoMineLoopRuntime({
          betStr,
          blocks,
          completeAutoMineRound,
          onAutoMineBetConfirmed: () => onAutoMineBetConfirmedRef.current?.(),
          onProgress: setAutoMineProgress,
          onRefetchEpoch: async () => {
            await ensurePreferredWalletRef.current?.();
            refetchEpochRef.current?.();
          },
          onSaveSession: (payload) => runtimeController.persistCheckpoint(payload),
          pendingBetRef,
          readRefreshSession: () => refreshSessionRef.current,
          renewLock: renewTabLock,
          rounds,
          setSelection: (tiles, epoch) => {
            setSelectedTiles(tiles);
            setSelectedTilesEpoch(epoch);
          },
        });
        const loopAdapter = createAutoMineLoopAdapter({
          actorAddress: actorAddress as `0x${string}`,
          autoMineActive: () => autoMineRef.current,
          betPendingGraceMs,
          betPendingStaleMs,
          blocks,
          forceReplacePendingNonceGap,
          gasBumpBase,
          gasBumpReplacementStep,
          getBumpedFees,
          maxBetAttempts,
          networkBackoffInitialMs: networkInitialMs,
          networkBackoffMaxMs: maxNetworkMs,
          onProgress: setAutoMineProgress,
          pendingBetRef,
          placeBets,
          placeBetsSilent,
          placeBets7702,
          readClient: () => publicClientRef.current,
          readSilentSend: () => silentSendRef.current,
          renewLock: renewTabLock,
          rounds,
          secureRandom: getSecureRandomNumber,
          singleAmountRaw,
        });

        const loopResult = await runAutoMineLoop({
          adapter: loopAdapter,
          autoMineActive: () => autoMineRef.current,
          blocks,
          networkBackoffInitialMs: networkInitialMs,
          networkBackoffMaxMs: maxNetworkMs,
          networkRetryMax,
          restoredLastEpoch,
          rounds,
          runtime: loopRuntime,
          sessionRefreshIntervalMs: SESSION_REFRESH_INTERVAL_MS,
          startRoundIndex,
        });
        stopReason = loopResult.stopReason;
      } catch (err) {
        stopReason = "error";
        const { diagnosticsErrorKind, rawMessage, sessionExpired, networkDown, walletUnavailable, userMessage } =
          getAutoMineUserMessage(err);
        const shouldAutoResume = !sessionExpired && (networkDown || walletUnavailable);
        autoResumeRequestedRef.current = shouldAutoResume;
        if (isInsufficientFundsError(err)) {
          log.warn("AutoMine", "loop stopped: insufficient gas funds", err);
        } else if (networkDown) {
          log.warn("AutoMine", "loop paused by network/receipt timeout", err);
        } else if (walletUnavailable) {
          log.warn("AutoMine", "loop paused: embedded wallet not ready", err);
        } else {
          log.error("AutoMine", "loop error", err);
        }
        if (sessionExpired) {
          sessionExpiredErrorRef.current = true;
        }
        writeAutoMineDiagnostics({
          lastErrorKind: diagnosticsErrorKind,
          lastErrorMessage: userMessage,
          lastErrorRawMessage: rawMessage,
          lastStopReason: sessionExpired ? "session-expired" : shouldAutoResume ? "retry-wait" : "error",
        });
        autoMineRef.current = false;
        if (!sessionExpired && !networkDown && !walletUnavailable) {
          runtimeController.clearPersistedRun();
        }
        if (sessionExpired) {
          deactivateAutoMineUi({ phase: "session-expired", progress: userMessage });
        } else if (shouldAutoResume) {
          deactivateAutoMineUi({ phase: "retry-wait", progress: userMessage });
        } else {
          deactivateAutoMineUi({ phase: "idle", progress: userMessage });
        }
        await delay(isInsufficientFundsError(err) ? 2000 : 8000);
      } finally {
        releaseInTabAutoMineRuntime();
        if (!startedRun) return;
        log.info("AutoMine", "stopped", { reason: stopReason });
        writeAutoMineDiagnostics({
          lastStopReason:
            stopReason === "unknown"
              ? null
              : (stopReason as AutoMineDiagnosticsStopReason),
        });
        autoMineRef.current = false;
        setSelectedTiles([]);
        setSelectedTilesEpoch(null);
        if (!sessionExpiredErrorRef.current && !autoResumeRequestedRef.current) {
          deactivateAutoMineUi();
        }
        sessionExpiredErrorRef.current = false;
        runtimeController.finalizeRun(stopReason);
      }
    },
    [
      approveRetryMax,
      assertNativeGasBalance,
      autoMineRef,
      autoResumeRequestedRef,
      betPendingGraceMs,
      betPendingStaleMs,
      completeAutoMineRound,
      ensurePreferredWalletRef,
      forceReplacePendingNonceGap,
      gasBumpBase,
      gasBumpReplacementStep,
      getBumpedFees,
      getPreferredActorAddress,
      getUrgentFees,
      maxBetAttempts,
      maxNetworkAttempts,
      maxNetworkMs,
      minGasApprove,
      networkInitialMs,
      networkRetryMax,
      runtimeController,
      onAutoMineBetConfirmedRef,
      pendingApproveRef,
      pendingBetRef,
      placeBets,
      placeBetsSilent,
      placeBets7702,
      publicClientRef,
      refetchAllowanceRef,
      refetchEpochRef,
      refreshSessionRef,
      sessionExpiredErrorRef,
      setAutoMineProgress,
      setIsAutoMining,
      setRunningParams,
      activateAutoMineUi,
      deactivateAutoMineUi,
      setAutoMinePhase,
      setSelectedTiles,
      setSelectedTilesEpoch,
      silentSendRef,
      waitReceipt,
      readWriteContractAsync,
    ],
  );
}
