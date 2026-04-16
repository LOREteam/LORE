"use client";

import { log } from "../lib/logger";
import { isInsufficientFundsError, isNetworkError } from "./useMining.shared";
import { createAutoMineLoopState, reduceAutoMineLoopEvent } from "../lib/mining/autoMineLoopModel";
import { planAutoMineLoopPrelude } from "../lib/mining/autoMineLoopPreludePlanner";
import { planAutoMineLoopNetworkRetry } from "../lib/mining/autoMineLoopRetryPlanner";
import {
  toAutoMineLoopConfirmedEvent,
  type AutoMineLoopConfirmedRoundOutcome,
} from "../lib/mining/autoMineLoopRoundOutcome";
import type { AutoMineLoopReadyRoundCommand } from "../lib/mining/autoMineLoopRoundCommand";
import {
  planAutoMineAttemptTransition,
  planAutoMineLoopCompletionTransition,
  planAutoMineNetworkErrorTransition,
  planAutoMinePreparedRoundTransition,
  planAutoMineRecoveryTransition,
  type AutoMineLoopTransitionAction,
} from "../lib/mining/autoMineLoopTransitionPlanner";
import type { AutoMineLoopAdapter } from "../lib/mining/autoMineLoopAdapter";
import type { AutoMineLoopRuntime } from "../lib/mining/autoMineLoopRuntime";

interface RunAutoMineLoopOptions {
  adapter: AutoMineLoopAdapter;
  autoMineActive: () => boolean;
  blocks: number;
  networkBackoffInitialMs: number;
  networkBackoffMaxMs: number;
  networkRetryMax: number;
  restoredLastEpoch: bigint | null;
  rounds: number;
  startRoundIndex: number;
  runtime: AutoMineLoopRuntime;
  sessionRefreshIntervalMs: number;
}

async function handleConfirmedRoundOutcome(params: {
  loopState: ReturnType<typeof createAutoMineLoopState>;
  outcome: AutoMineLoopConfirmedRoundOutcome;
  roundIndex: number;
  runtime: AutoMineLoopRuntime;
  tilesToBet: number[];
}) {
  const { loopState, outcome, roundIndex, runtime, tilesToBet } = params;
  const nextLoopState = reduceAutoMineLoopEvent(
    loopState,
    toAutoMineLoopConfirmedEvent({
      outcome,
      tiles: tilesToBet,
    }),
  );
  runtime.syncState(nextLoopState, { progress: true, selection: true, session: false });
  await runtime.handleConfirmedRound({
    placedEpoch: outcome.placedEpoch,
    progressMessage: nextLoopState.progressMessage,
    roundIndex,
    tilesToBet,
  });
  return nextLoopState;
}

async function applyTransitionAction(params: {
  action: AutoMineLoopTransitionAction;
  loopState: ReturnType<typeof createAutoMineLoopState>;
  runtime: AutoMineLoopRuntime;
}) {
  const { action, loopState, runtime } = params;

  if (action.commandsBefore?.length) {
    await runtime.runCommands(action.commandsBefore);
  }

  const nextLoopState = reduceAutoMineLoopEvent(loopState, action.event);
  runtime.syncState(nextLoopState, action.syncEffects);

  if (action.commandsAfter?.length) {
    await runtime.runCommands(action.commandsAfter);
  }

  return nextLoopState;
}

export async function runAutoMineLoop({
  adapter,
  autoMineActive,
  blocks,
  networkBackoffInitialMs,
  networkBackoffMaxMs,
  networkRetryMax,
  restoredLastEpoch,
  rounds,
  runtime,
  sessionRefreshIntervalMs,
  startRoundIndex,
}: RunAutoMineLoopOptions) {
  let loopState = createAutoMineLoopState({
    rounds,
    startRoundIndex,
    restoredLastEpoch,
  });
  let lastSessionRefresh = runtime.getNow();

  while (loopState.roundIndex < rounds) {
    const roundIndex = loopState.roundIndex;
    if (!autoMineActive()) {
      loopState = reduceAutoMineLoopEvent(loopState, { type: "stop-user" });
      break;
    }
    runtime.renewLock();

    const refreshSession = runtime.readRefreshSession();
    const preludeDecision = planAutoMineLoopPrelude({
      hasRefreshSession: Boolean(refreshSession),
      lastPlacedEpoch: loopState.lastPlacedEpoch,
      lastSessionRefresh,
      now: runtime.getNow(),
      sessionRefreshIntervalMs,
    });

    let preludeStopped = false;
    for (const operation of preludeDecision.operations) {
      if (operation === "refresh-session" && refreshSession) {
        const refreshedAt = await runtime.handleSessionRefresh(refreshSession);
        if (refreshedAt !== null) {
          lastSessionRefresh = refreshedAt;
        }
        continue;
      }

      if (operation === "await-epoch-ready" && loopState.lastPlacedEpoch !== null) {
        const epochWait = await adapter.awaitEpochReady({
          lastPlacedEpoch: loopState.lastPlacedEpoch,
          roundIndex,
          rounds,
        });
        if (epochWait.stopped) {
          loopState = reduceAutoMineLoopEvent(loopState, { type: "stop-user" });
          preludeStopped = true;
          break;
        }

        await runtime.handleEpochReady({ blocks, roundIndex, rounds });
      }
    }

    if (preludeStopped) {
      break;
    }

    let activeRoundCommand: AutoMineLoopReadyRoundCommand | null = null;

    try {
      const preparedRound = await adapter.prepareRoundCommand({
        lastPlacedEpoch: loopState.lastPlacedEpoch,
        roundIndex,
        rounds,
      });
      const preparedDecision = planAutoMinePreparedRoundTransition(preparedRound);

      if (preparedRound.kind === "skip-existing") {
        log.info(
          "AutoMine",
          `skipping round ${roundIndex + 1} - already bet on ${preparedRound.alreadyBetTiles.length}/${preparedRound.effectiveBlocks} tiles in epoch ${preparedRound.liveEpoch}`,
          { betTiles: preparedRound.alreadyBetTiles },
        );
      }

      if (preparedDecision.kind === "continue") {
        loopState = await applyTransitionAction({
          action: preparedDecision.action,
          loopState,
          runtime,
        });
        continue;
      }

      if (preparedDecision.kind === "stop") {
        loopState = await applyTransitionAction({
          action: preparedDecision.action,
          loopState,
          runtime,
        });
        break;
      }

      const { command, alreadyBetTiles } = preparedDecision;
      activeRoundCommand = command;
      const { liveEpoch: liveEpochNow, epochNeedsResolve, effectiveBlocks, tilesToBet, selectionEpoch } = command;

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

      loopState = reduceAutoMineLoopEvent(loopState, {
        type: "round-betting-started",
        liveEpoch: liveEpochNow,
        tiles: tilesToBet,
        selectionEpoch,
      });
      runtime.syncState(loopState);

      const betLoopResult = await adapter.executeRoundCommand({
        command,
        refreshSession: refreshSession
          ? async () => {
              await refreshSession();
              lastSessionRefresh = runtime.getNow();
            }
          : undefined,
        roundIndex,
      });
      const attemptDecision = planAutoMineAttemptTransition({
        epochNeedsResolve,
        outcome: betLoopResult,
        roundIndex,
        rounds,
      });

      if (betLoopResult.kind === "epoch-ended") {
        log.warn(
          "AutoMine",
          `round ${roundIndex + 1} skipped - epoch ended (tx too late), continuing next round`,
          { epoch: betLoopResult.liveEpoch.toString() },
        );
      }

      if (attemptDecision.kind === "stop" || attemptDecision.kind === "continue") {
        loopState = await applyTransitionAction({
          action: attemptDecision.action,
          loopState,
          runtime,
        });
        if (attemptDecision.kind === "stop") {
          break;
        }
        continue;
      }

      if (attemptDecision.kind === "confirmed") {
        if (attemptDecision.commandsBefore?.length) {
          await runtime.runCommands(attemptDecision.commandsBefore);
        }
        log.info("AutoMine", `round ${roundIndex + 1}/${rounds} confirmed`, {
          epoch: attemptDecision.outcome.placedEpoch.toString(),
          source: attemptDecision.outcome.source,
        });
        loopState = await handleConfirmedRoundOutcome({
          loopState,
          outcome: attemptDecision.outcome,
          roundIndex,
          runtime,
          tilesToBet,
        });
        continue;
      }

      await runtime.runCommands(attemptDecision.commandsBefore);
      const finalizedRound = await adapter.finalizeRoundCommand({
        command,
        roundIndex,
      });
      loopState = await handleConfirmedRoundOutcome({
        loopState,
        outcome: finalizedRound,
        roundIndex,
        runtime,
        tilesToBet,
      });
      continue;
    } catch (error) {
      if (isInsufficientFundsError(error)) throw error;
      if (isNetworkError(error) && autoMineActive()) {
        const retryDecision = planAutoMineLoopNetworkRetry({
          currentRetryCount: loopState.networkRetries,
          initialMs: networkBackoffInitialMs,
          maxExponent: 6,
          maxMs: networkBackoffMaxMs,
          retryMax: networkRetryMax,
        });
        if (retryDecision.kind === "give-up") {
          log.error("AutoMine", `network down for ${networkRetryMax} retries, giving up`);
          throw error;
        }
        const networkErrorDecision = planAutoMineNetworkErrorTransition({
          retryCount: retryDecision.retryCount,
          waitMs: retryDecision.waitMs,
        });
        log.warn(
          "AutoMine",
          `network error on round ${roundIndex + 1} (retry ${retryDecision.retryCount}/${networkRetryMax}), waiting ${(retryDecision.waitMs / 1000).toFixed(0)}s...`,
          error,
        );
        loopState = await applyTransitionAction({
          action: networkErrorDecision.action,
          loopState,
          runtime,
        });

        if (activeRoundCommand) {
          const recoveredRound = await adapter.recoverRoundCommand({
            command: activeRoundCommand,
            roundIndex,
            rounds,
          });
          const recoveryDecision = planAutoMineRecoveryTransition(recoveredRound);
          if (recoveryDecision.kind === "confirmed") {
            if (recoveryDecision.commandsBefore?.length) {
              await runtime.runCommands(recoveryDecision.commandsBefore);
            }
            loopState = await handleConfirmedRoundOutcome({
              loopState,
              outcome: recoveryDecision.outcome,
              roundIndex,
              runtime,
              tilesToBet: activeRoundCommand.tilesToBet,
            });
            continue;
          }
        }

        continue;
      }
      throw error;
    }
  }

  if (loopState.stopReason === "unknown" && loopState.roundIndex >= rounds) {
    loopState = await applyTransitionAction({
      action: planAutoMineLoopCompletionTransition().action,
      loopState,
      runtime,
    });
  }

  log.info("AutoMine", `loop finished | reason=${loopState.stopReason}`);
  return { stopReason: loopState.stopReason };
}
