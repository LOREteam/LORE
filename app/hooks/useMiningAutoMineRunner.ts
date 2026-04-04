"use client";

import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { PublicClient } from "viem";
import { log } from "../lib/logger";
import { delay } from "../lib/utils";
import {
  SESSION_REFRESH_INTERVAL_MS,
  clearSession,
  getSecureRandomNumber,
  isInsufficientFundsError,
  saveSession,
} from "./useMining.shared";
import {
  acquireTabLock,
  recoverOrphanedTabLock,
  releaseTabLock,
  renewTabLock,
} from "./useMiningTabLock";
import { getAutoMineUserMessage } from "./useMiningAutoMineError";
import { runAutoMineLoop } from "./useMiningAutoMineLoop";
import { prepareAutoMineRunSetup } from "./useMiningRunSetup";
import type { GasOverrides, RunningParams } from "./useMining.types";
import type { PendingApproveState, PendingBetState, ReceiptState } from "./useMining.stateTypes";

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
  publicClientRef: MutableRefObject<PublicClient | undefined>;
  refetchAllowanceRef: MutableRefObject<() => void>;
  refetchEpochRef: MutableRefObject<(() => void) | undefined>;
  refreshSessionRef: MutableRefObject<(() => Promise<void>) | undefined>;
  sessionExpiredErrorRef: MutableRefObject<boolean>;
  setAutoMineProgress: StringSetter;
  setIsAutoMining: BooleanSetter;
  setRunningParams: RunningParamsSetter;
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

      let startedRun = false;
      let stopReason = "unknown";
      try {
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

        const loopResult = await runAutoMineLoop({
          actorAddress: actorAddress as `0x${string}`,
          autoMineActive: () => autoMineRef.current,
          betPendingGraceMs,
          betPendingStaleMs,
          betStr,
          blocks,
          completeAutoMineRound,
          forceReplacePendingNonceGap,
          gasBumpBase,
          gasBumpReplacementStep,
          getBumpedFees,
          maxBetAttempts,
          networkBackoffInitialMs: networkInitialMs,
          networkBackoffMaxMs: maxNetworkMs,
          networkRetryMax,
          onAutoMineBetConfirmed: () => onAutoMineBetConfirmedRef.current?.(),
          onClearSelection: () => {
            setSelectedTiles([]);
            setSelectedTilesEpoch(null);
          },
          onProgress: setAutoMineProgress,
          onRefetchEpoch: async () => {
            await ensurePreferredWalletRef.current?.();
            refetchEpochRef.current?.();
          },
          onSaveSession: saveSession,
          pendingBetRef,
          placeBets,
          placeBetsSilent,
          readClient: () => publicClientRef.current,
          readRefreshSession: () => refreshSessionRef.current,
          readSilentSend: () => silentSendRef.current,
          renewLock: renewTabLock,
          restoredLastEpoch,
          rounds,
          secureRandom: getSecureRandomNumber,
          sessionRefreshIntervalMs: SESSION_REFRESH_INTERVAL_MS,
          setSelection: (tiles, epoch) => {
            setSelectedTiles(tiles);
            setSelectedTilesEpoch(epoch);
          },
          singleAmountRaw,
          startRoundIndex,
        });
        stopReason = loopResult.stopReason;
        if (stopReason === "completed" || stopReason === "insufficient-balance") {
          clearSession();
        }
      } catch (err) {
        stopReason = "error";
        const { sessionExpired, networkDown, walletUnavailable, userMessage } = getAutoMineUserMessage(err);
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
        setAutoMineProgress(userMessage);
        if (sessionExpired) {
          sessionExpiredErrorRef.current = true;
        }
        autoMineRef.current = false;
        if (!sessionExpired && !networkDown && !walletUnavailable) clearSession();
        await delay(isInsufficientFundsError(err) ? 2000 : 8000);
      } finally {
        if (!startedRun) return;
        log.info("AutoMine", "stopped", { reason: stopReason });
        setIsAutoMining(false);
        autoMineRef.current = false;
        setRunningParams(null);
        setSelectedTiles([]);
        setSelectedTilesEpoch(null);
        if (!sessionExpiredErrorRef.current && !autoResumeRequestedRef.current) setAutoMineProgress(null);
        sessionExpiredErrorRef.current = false;
        releaseTabLock();
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
      setSelectedTiles,
      setSelectedTilesEpoch,
      silentSendRef,
      waitReceipt,
      readWriteContractAsync,
    ],
  );
}
