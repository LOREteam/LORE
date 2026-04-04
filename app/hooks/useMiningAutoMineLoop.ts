"use client";

import type { MutableRefObject } from "react";
import type { PublicClient } from "viem";
import { log } from "../lib/logger";
import { delay } from "../lib/utils";
import { isInsufficientFundsError, isNetworkError } from "./useMining.shared";
import { executeAutoMineBetLoop } from "./useMiningRoundBetting";
import { planAutoMineRound } from "./useMiningRoundPlanning";
import { finalizeConfirmedRound, recoverRoundAfterRpcError } from "./useMiningRoundRecovery";
import { awaitEpochReadyToBet } from "./useMiningEpochTiming";
import { getNetworkRetryDelayMs } from "./useMiningNetworkRetry";
import type { GasOverrides } from "./useMining.types";
import type { PendingBetState } from "./useMining.stateTypes";

type SessionRefreshFn = () => Promise<void>;

interface CompleteRoundArgs {
  betStr: string;
  blocks: number;
  rounds: number;
  roundIndex: number;
  placedEpoch: bigint;
  displayTiles?: number[];
  displayEpoch?: bigint;
  progressMessage?: string;
  announceBet?: boolean;
}

interface RunAutoMineLoopOptions {
  actorAddress: `0x${string}`;
  autoMineActive: () => boolean;
  betPendingGraceMs: number;
  betPendingStaleMs: number;
  betStr: string;
  blocks: number;
  completeAutoMineRound: (args: CompleteRoundArgs) => Promise<void>;
  forceReplacePendingNonceGap: number;
  gasBumpBase: bigint;
  gasBumpReplacementStep: bigint;
  getBumpedFees: (stepBps?: bigint) => Promise<GasOverrides | undefined>;
  maxBetAttempts: number;
  networkBackoffInitialMs: number;
  networkBackoffMaxMs: number;
  networkRetryMax: number;
  onAutoMineBetConfirmed?: () => void;
  onClearSelection: () => void;
  onProgress: (message: string) => void;
  onRefetchEpoch?: () => void;
  onSaveSession: (payload: {
    active: boolean;
    betStr: string;
    blocks: number;
    rounds: number;
    nextRoundIndex: number;
    lastPlacedEpoch: string | null;
  }) => void;
  pendingBetRef: MutableRefObject<PendingBetState | null>;
  placeBets: (
    tileIds: number[],
    amountRawPerTile: bigint,
    gasOverrides?: GasOverrides,
  ) => Promise<"confirmed" | "pending">;
  placeBetsSilent: (
    tileIds: number[],
    amountRawPerTile: bigint,
    gasOverrides?: GasOverrides,
  ) => Promise<"confirmed" | "pending">;
  readClient: () => PublicClient | undefined;
  readRefreshSession: () => SessionRefreshFn | undefined;
  readSilentSend: () => unknown;
  renewLock: () => void;
  restoredLastEpoch: bigint | null;
  rounds: number;
  secureRandom: (max: number) => number;
  sessionRefreshIntervalMs: number;
  setSelection: (tiles: number[], epoch: string | null) => void;
  singleAmountRaw: bigint;
  startRoundIndex: number;
}

const PUBLIC_CLIENT_RECONNECT_TIMEOUT_MS = 20_000;
const PUBLIC_CLIENT_RECONNECT_POLL_MS = 300;

async function awaitActivePublicClient(params: {
  autoMineActive: () => boolean;
  onProgress: (message: string) => void;
  readClient: () => PublicClient | undefined;
  renewLock: () => void;
  roundIndex: number;
  rounds: number;
}) {
  const { autoMineActive, onProgress, readClient, renewLock, roundIndex, rounds } = params;
  const startedAt = Date.now();
  let announcedWait = false;

  while (autoMineActive()) {
    const client = readClient();
    if (client) return client;

    if (!announcedWait) {
      onProgress(`${roundIndex + 1} / ${rounds} - reconnecting RPC...`);
      announcedWait = true;
    }

    if (Date.now() - startedAt >= PUBLIC_CLIENT_RECONNECT_TIMEOUT_MS) {
      throw new Error("Public client not ready");
    }

    renewLock();
    await delay(PUBLIC_CLIENT_RECONNECT_POLL_MS);
  }

  return null;
}

export async function runAutoMineLoop({
  actorAddress,
  autoMineActive,
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
  networkBackoffInitialMs,
  networkBackoffMaxMs,
  networkRetryMax,
  onAutoMineBetConfirmed,
  onClearSelection,
  onProgress,
  onRefetchEpoch,
  onSaveSession,
  pendingBetRef,
  placeBets,
  placeBetsSilent,
  readClient,
  readRefreshSession,
  readSilentSend,
  renewLock,
  restoredLastEpoch,
  rounds,
  secureRandom,
  sessionRefreshIntervalMs,
  setSelection,
  singleAmountRaw,
  startRoundIndex,
}: RunAutoMineLoopOptions) {
  let lastPlacedEpoch: bigint | null = restoredLastEpoch;
  let lastSessionRefresh = Date.now();
  let networkRetries = 0;
  let stopReason = "unknown";

  for (let roundIndex = startRoundIndex; roundIndex < rounds; roundIndex += 1) {
    if (!autoMineActive()) {
      stopReason = "user-stopped";
      break;
    }
    renewLock();

    const refreshSession = readRefreshSession();
    if (refreshSession && Date.now() - lastSessionRefresh > sessionRefreshIntervalMs) {
      try {
        await refreshSession();
        lastSessionRefresh = Date.now();
        log.info("AutoMine", "session refreshed");
      } catch (error) {
        log.warn("AutoMine", "session refresh failed (continuing)", error);
      }
    }

    if (lastPlacedEpoch !== null) {
      const epochWait = await awaitEpochReadyToBet({
        isActive: autoMineActive,
        lastPlacedEpoch,
        onProgress,
        readClient,
        renewLock,
        roundIndex,
        rounds,
        secureRandom,
      });
      if (epochWait.stopped) {
        stopReason = "user-stopped";
        break;
      }

      onRefetchEpoch?.();
      onProgress(`${roundIndex} / ${rounds} - placing bet (${blocks} tiles)...`);
    }

    let roundTilesToBet: number[] = [];
    let roundCandidateEpochs: bigint[] = [];

    try {
      const client = await awaitActivePublicClient({
        autoMineActive,
        onProgress,
        readClient,
        renewLock,
        roundIndex,
        rounds,
      });
      if (!client) {
        stopReason = "no-client";
        break;
      }

      const roundPlan = await planAutoMineRound({
        actorAddress,
        blocks,
        client,
        lastPlacedEpoch,
        secureRandom,
        singleAmountRaw,
      });

      if (roundPlan.kind === "skip-existing") {
        log.info(
          "AutoMine",
          `skipping round ${roundIndex + 1} - already bet on ${roundPlan.alreadyBetTiles.length}/${roundPlan.effectiveBlocks} tiles in epoch ${roundPlan.liveEpoch}`,
          { betTiles: roundPlan.alreadyBetTiles },
        );
        setSelection([], null);
        lastPlacedEpoch = roundPlan.liveEpoch;
        onSaveSession({
          active: true,
          betStr,
          blocks,
          rounds,
          nextRoundIndex: roundIndex + 1,
          lastPlacedEpoch: lastPlacedEpoch.toString(),
        });
        networkRetries = 0;
        continue;
      }

      if (roundPlan.kind === "stop-insufficient-balance") {
        onProgress(`Stopped: need ${roundPlan.neededAmount.toFixed(1)} LINEA, have ${roundPlan.currentAmount.toFixed(1)} LINEA`);
        stopReason = "insufficient-balance";
        await delay(3500);
        break;
      }

      const {
        liveEpoch: liveEpochNow,
        epochNeedsResolve,
        effectiveBlocks,
        tilesToBet,
        alreadyBetTiles,
        roundCandidateEpochs: plannedCandidateEpochs,
        selectionEpoch,
      } = roundPlan;
      roundTilesToBet = tilesToBet;
      roundCandidateEpochs = plannedCandidateEpochs;

      if (epochNeedsResolve) {
        log.info(
          "AutoMine",
          `round ${roundIndex + 1}: epoch ${liveEpochNow} needs resolve - bet will auto-resolve, tiles=[${tilesToBet.join(",")}]`,
        );
      }

      log.info(
        "AutoMine",
        `round ${roundIndex + 1}: blocks=${blocks}, effectiveBlocks=${effectiveBlocks}, tiles=[${tilesToBet.join(",")}], existingBets=[${alreadyBetTiles.join(",")}], epoch=${liveEpochNow}`,
      );

      setSelection(tilesToBet, selectionEpoch);
      onProgress(`${roundIndex + 1} / ${rounds} - placing bet (${tilesToBet.length} tiles)...`);

      onSaveSession({
        active: true,
        betStr,
        blocks,
        rounds,
        nextRoundIndex: roundIndex,
        lastPlacedEpoch: liveEpochNow.toString(),
      });

      const betLoopResult = await executeAutoMineBetLoop({
        actorAddress,
        autoMineActive,
        betPendingGraceMs,
        betPendingStaleMs,
        currentEpoch: liveEpochNow,
        currentRoundIndex: roundIndex,
        forceReplacePendingNonceGap,
        getBumpedFees,
        gasBumpBase,
        gasBumpReplacementStep,
        maxBetAttempts,
        networkBackoffInitialMs,
        networkBackoffMaxMs,
        onProgress,
        onSessionRefresh: refreshSession
          ? async () => {
              await refreshSession();
              lastSessionRefresh = Date.now();
            }
          : undefined,
        pendingBetRef,
        placeBets,
        placeBetsSilent,
        publicClient: client,
        readSilentSend,
        rounds,
        singleAmountRaw,
        tilesToBet,
        roundCandidateEpochs,
        effectiveBlocks,
        getRetryDelayMs: getNetworkRetryDelayMs,
      });

      if (betLoopResult.kind === "stopped") {
        stopReason = "user-stopped";
        break;
      }

      if (betLoopResult.kind === "epoch-ended-skip") {
        pendingBetRef.current = null;
        log.warn(
          "AutoMine",
          `round ${roundIndex + 1} skipped - epoch ended (tx too late), continuing next round`,
          { epoch: liveEpochNow.toString() },
        );
        onProgress(`${roundIndex + 1} / ${rounds} - skipped (epoch ended), next round...`);
        setSelection([], null);
        lastPlacedEpoch = liveEpochNow;
        onSaveSession({
          active: true,
          betStr,
          blocks,
          rounds,
          nextRoundIndex: roundIndex + 1,
          lastPlacedEpoch: lastPlacedEpoch.toString(),
        });
        await delay(250);
        networkRetries = 0;
        continue;
      }

      if (betLoopResult.kind === "detected-on-chain") {
        pendingBetRef.current = null;
        const detectedEpoch = betLoopResult.placedEpoch ?? liveEpochNow;
        lastPlacedEpoch = detectedEpoch;
        setSelection(tilesToBet, detectedEpoch.toString());
        onProgress(`${roundIndex + 1} / ${rounds} - confirmed (detected on-chain)`);
        onAutoMineBetConfirmed?.();
        log.info("AutoMine", `round ${roundIndex + 1}/${rounds} detected on-chain`, { epoch: lastPlacedEpoch.toString() });
        networkRetries = 0;
        await completeAutoMineRound({
          betStr,
          blocks,
          rounds,
          roundIndex,
          placedEpoch: lastPlacedEpoch,
          displayTiles: tilesToBet,
          displayEpoch: lastPlacedEpoch,
          progressMessage: `${roundIndex + 1} / ${rounds} - confirmed (detected on-chain)`,
          announceBet: false,
        });
        continue;
      }

      pendingBetRef.current = null;
      const finalizedRound = await finalizeConfirmedRound({
        actorAddress,
        betStr,
        blocks,
        client,
        completeAutoMineRound,
        effectiveBlocks,
        epochNeedsResolve,
        liveEpoch: liveEpochNow,
        onAnnounceConfirmed: () => onAutoMineBetConfirmed?.(),
        onClearSelection,
        onRefetchEpoch,
        onSetProgress: onProgress,
        rounds,
        roundIndex,
        tilesToBet,
      });
      lastPlacedEpoch = finalizedRound.placedEpoch;
      networkRetries = 0;
    } catch (error) {
      if (isInsufficientFundsError(error)) throw error;
      if (isNetworkError(error) && autoMineActive()) {
        networkRetries += 1;
        if (networkRetries > networkRetryMax) {
          log.error("AutoMine", `network down for ${networkRetryMax} retries, giving up`);
          throw error;
        }
        const wait = getNetworkRetryDelayMs(
          networkRetries - 1,
          networkBackoffInitialMs,
          networkBackoffMaxMs,
          6,
        );
        log.warn(
          "AutoMine",
          `network error on round ${roundIndex + 1} (retry ${networkRetries}/${networkRetryMax}), waiting ${(wait / 1000).toFixed(0)}s...`,
          error,
        );
        onProgress(`RPC offline - retry ${networkRetries} in ${(wait / 1000).toFixed(0)}s...`);
        await delay(wait);

        const currentClient = readClient();
        if (currentClient) {
          const recoveredRound = await recoverRoundAfterRpcError({
            actorAddress,
            betStr,
            blocks,
            client: currentClient,
            completeAutoMineRound,
            onAnnounceConfirmed: () => onAutoMineBetConfirmed?.(),
            onSetSelection: (tiles, epoch) => {
              setSelection(tiles, epoch);
            },
            onSetProgress: onProgress,
            roundCandidateEpochs,
            roundIndex,
            rounds,
            roundTilesToBet,
          });
          if (recoveredRound.kind === "recovered") {
            lastPlacedEpoch = recoveredRound.placedEpoch;
            pendingBetRef.current = null;
            networkRetries = 0;
            continue;
          }
        }

        roundIndex -= 1;
        continue;
      }
      throw error;
    }
  }

  if (autoMineActive()) {
    stopReason = "completed";
    onProgress(`Completed ${rounds}/${rounds} rounds`);
    await delay(1500);
  }

  log.info("AutoMine", `loop finished | reason=${stopReason}`);
  return { stopReason };
}
