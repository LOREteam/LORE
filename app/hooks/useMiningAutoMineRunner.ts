"use client";

import { useCallback, useEffect } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { PublicClient } from "viem";
import { log } from "../lib/logger";
import { delay, formatUnknownError } from "../lib/utils";
import {
  SESSION_REFRESH_INTERVAL_MS,
  isEpochWaitTimeoutError,
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
import { getAutoMineRunnerCatchStopReason } from "../lib/mining/autoMineRunnerStopReason";
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
    txNonce?: number,
    expectedEpoch?: bigint,
    assertBeforeSend?: () => void,
  ) => Promise<ReceiptState>;
  placeBetsSilent: (
    tileIds: number[],
    amountRawPerTile: bigint,
    gasOverrides?: GasOverrides,
    txNonce?: number,
    expectedEpoch?: bigint,
    assertBeforeSend?: () => void,
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
  useEffect(
    () => () => {
      autoMineRef.current = false;
      runtimeController.pauseAndRelease();
    },
    [autoMineRef, runtimeController],
  );

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
          progress: "Waiting for the previous auto-miner run to settle before resuming.",
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

        const preferredActorAddress = getPreferredActorAddress();
        const preparedRun = await prepareAutoMineRunSetup({
          acquireTabLock,
          actorAddress: preferredActorAddress,
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
            if (startRoundIndex === 0 && preferredActorAddress) {
              runtimeController.persistStart({
                actor: preferredActorAddress as `0x${string}`,
                betStr,
                blocks,
                rounds,
              });
            }
          },
          maxNetworkAttempts,
          maxNetworkMs,
          minGasApprove,
          networkInitialMs,
          onClearPersistedSession: () => runtimeController.clearPersistedRun(),
          onProgress: setAutoMineProgress,
          pendingApproveRef,
          publicClient: publicClientRef.current,
          readSilentSend: () => {
            const silentSend = silentSendRef.current as
              | ((
                tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint; nonce?: number },
                gasOverrides?: GasOverrides,
              ) => Promise<`0x${string}`>)
              | undefined;
            if (!silentSend) return undefined;
            return async (tx, gasOverrides) => {
              runtimeController.assertCurrentAuthorizationForActor(getPreferredActorAddress());
              return silentSend(tx, gasOverrides);
            };
          },
          recoverOrphanedTabLock,
          refetchAllowance: () => refetchAllowanceRef.current(),
          rounds,
          setIsAutoMining,
          setRunningParams,
          setSelectedTiles,
          setSelectedTilesEpoch,
          startRoundIndex,
          waitReceipt,
          writeApprove: (args: unknown) => {
            runtimeController.assertCurrentAuthorizationForActor(getPreferredActorAddress());
            return readWriteContractAsync()(args as never);
          },
        });

        if (!preparedRun) {
          if (startedRun) runtimeController.clearPersistedRun();
          deactivateAutoMineUi();
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
          placeBets: (tileIds, amountRawPerTile, gasOverrides, txNonce, expectedEpoch) => {
            const authorizationLease = runtimeController.reserveSpend({
              expectedEpoch,
              amountRaw: amountRawPerTile * BigInt(tileIds.length),
            });
            return placeBets(
              tileIds,
              amountRawPerTile,
              gasOverrides,
              txNonce,
              expectedEpoch,
              () => {
                runtimeController.assertCurrentAuthorizationForActor(getPreferredActorAddress());
                authorizationLease.assertCurrent();
              },
            );
          },
          placeBetsSilent: (tileIds, amountRawPerTile, gasOverrides, txNonce, expectedEpoch) => {
            const authorizationLease = runtimeController.reserveSpend({
              expectedEpoch,
              amountRaw: amountRawPerTile * BigInt(tileIds.length),
            });
            return placeBetsSilent(
              tileIds,
              amountRawPerTile,
              gasOverrides,
              txNonce,
              expectedEpoch,
              () => {
                runtimeController.assertCurrentAuthorizationForActor(getPreferredActorAddress());
                authorizationLease.assertCurrent();
              },
            );
          },
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
        const { diagnosticsErrorKind, rawMessage, sessionExpired, networkDown, walletUnavailable, pendingNonceBlocked, userMessage } =
          getAutoMineUserMessage(err);
        const epochWaitTimeout = isEpochWaitTimeoutError(err);
        const shouldAutoResume = !sessionExpired && (networkDown || walletUnavailable || epochWaitTimeout);
        const insufficientFunds = isInsufficientFundsError(err);
        stopReason = getAutoMineRunnerCatchStopReason({
          insufficientFunds,
          pendingNonceBlocked,
          sessionExpired,
          shouldAutoResume,
        });
        autoResumeRequestedRef.current = shouldAutoResume;
        if (insufficientFunds) {
          log.warn("AutoMine", "loop stopped: insufficient gas funds", err);
        } else if (epochWaitTimeout) {
          log.warn("AutoMine", "loop paused while waiting for epoch resolution", err);
        } else if (networkDown) {
          log.warn("AutoMine", "loop paused by network/receipt timeout", err);
        } else if (walletUnavailable) {
          log.warn("AutoMine", "loop paused: embedded wallet not ready", err);
        } else if (pendingNonceBlocked) {
          log.warn("AutoMine", "loop paused: pending nonce blocked", err);
        } else if (rawMessage === "unknown object error") {
          log.warn("AutoMine", "loop stopped: unclassified wallet/runtime error", {
            error: rawMessage,
            raw: err,
          });
        } else {
          log.error("AutoMine", "loop error", {
            error: rawMessage || formatUnknownError(err),
            raw: err,
          });
        }
        if (sessionExpired) {
          sessionExpiredErrorRef.current = true;
        }
        writeAutoMineDiagnostics({
          lastErrorKind: diagnosticsErrorKind,
          lastErrorMessage: userMessage,
          lastErrorRawMessage: rawMessage,
          lastStopReason: stopReason as AutoMineDiagnosticsStopReason,
        });
        autoMineRef.current = false;
        if (!sessionExpired && !networkDown && !walletUnavailable && !pendingNonceBlocked) {
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
