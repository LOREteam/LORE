import type {
  AutoMineLoopPrepareRoundCommandResult,
  AutoMineLoopReadyRoundCommand,
} from "./autoMineLoopRoundCommand";
import type { AutoMineLoopEvent } from "./autoMineLoopModel";
import type {
  AutoMineLoopConfirmedRoundOutcome,
  AutoMineLoopRoundAttemptOutcome,
  AutoMineLoopRoundRecoveryOutcome,
} from "./autoMineLoopRoundOutcome";
import {
  clearPendingBetCommand,
  confirmationStartCommand,
  sleepCommand,
  type AutoMineLoopRuntimeCommand,
} from "./autoMineLoopRuntimeCommand";

export interface AutoMineLoopTransitionSyncEffects {
  progress?: boolean;
  selection?: boolean;
  session?: boolean;
}

export interface AutoMineLoopTransitionAction {
  commandsAfter?: AutoMineLoopRuntimeCommand[];
  commandsBefore?: AutoMineLoopRuntimeCommand[];
  event: AutoMineLoopEvent;
  syncEffects?: AutoMineLoopTransitionSyncEffects;
}

export type AutoMinePreparedRoundTransitionDecision =
  | { kind: "ready"; alreadyBetTiles: number[]; command: AutoMineLoopReadyRoundCommand }
  | { kind: "stop"; action: AutoMineLoopTransitionAction }
  | { kind: "continue"; action: AutoMineLoopTransitionAction };

export type AutoMineAttemptTransitionDecision =
  | { kind: "stop"; action: AutoMineLoopTransitionAction }
  | { kind: "continue"; action: AutoMineLoopTransitionAction }
  | { kind: "confirmed"; commandsBefore?: AutoMineLoopRuntimeCommand[]; outcome: AutoMineLoopConfirmedRoundOutcome }
  | { kind: "finalize"; commandsBefore: AutoMineLoopRuntimeCommand[] };

export type AutoMineRecoveryTransitionDecision =
  | { kind: "retry" }
  | { kind: "confirmed"; commandsBefore?: AutoMineLoopRuntimeCommand[]; outcome: AutoMineLoopConfirmedRoundOutcome };

export interface AutoMineNetworkErrorTransitionDecision {
  action: AutoMineLoopTransitionAction;
  kind: "continue";
}

export interface AutoMineLoopCompletionTransitionDecision {
  action: AutoMineLoopTransitionAction;
}

export function planAutoMinePreparedRoundTransition(
  preparedRound: AutoMineLoopPrepareRoundCommandResult,
): AutoMinePreparedRoundTransitionDecision {
  switch (preparedRound.kind) {
    case "stop-no-client":
      return {
        kind: "stop",
        action: {
          event: { type: "stop-no-client" },
        },
      };

    case "skip-existing":
      return {
        kind: "continue",
        action: {
          event: { type: "round-skipped-existing", liveEpoch: preparedRound.liveEpoch },
          syncEffects: { session: true, selection: true, progress: false },
        },
      };

    case "stop-insufficient-balance":
      return {
        kind: "stop",
        action: {
          commandsAfter: [sleepCommand(3500)],
          event: {
            type: "stop-insufficient-balance",
            neededAmount: preparedRound.neededAmount,
            currentAmount: preparedRound.currentAmount,
          },
          syncEffects: { progress: true, selection: false, session: false },
        },
      };

    case "ready":
      return {
        kind: "ready",
        alreadyBetTiles: preparedRound.alreadyBetTiles,
        command: preparedRound.command,
      };
  }
}

export function planAutoMineAttemptTransition(params: {
  epochNeedsResolve: boolean;
  outcome: AutoMineLoopRoundAttemptOutcome;
  roundIndex: number;
  rounds: number;
}): AutoMineAttemptTransitionDecision {
  const { epochNeedsResolve, outcome, roundIndex, rounds } = params;

  switch (outcome.kind) {
    case "stopped":
      return {
        kind: "stop",
        action: {
          event: { type: "stop-user" },
        },
      };

    case "epoch-ended":
      return {
        kind: "continue",
        action: {
          commandsAfter: [sleepCommand(250)],
          commandsBefore: [clearPendingBetCommand()],
          event: { type: "round-epoch-ended", liveEpoch: outcome.liveEpoch },
        },
      };

    case "confirmed":
      return {
        kind: "confirmed",
        commandsBefore: [clearPendingBetCommand()],
        outcome,
      };

    case "submitted":
      return {
        kind: "finalize",
        commandsBefore: [
          clearPendingBetCommand(),
          confirmationStartCommand({
            clearSelection: true,
            progressMessage: `${roundIndex + 1} / ${rounds} - confirmed`,
            refetchEpoch: epochNeedsResolve,
          }),
        ],
      };
  }
}

export function planAutoMineRecoveryTransition(
  outcome: AutoMineLoopRoundRecoveryOutcome,
): AutoMineRecoveryTransitionDecision {
  if (outcome.kind === "confirmed") {
    return {
      kind: "confirmed",
      commandsBefore: [clearPendingBetCommand()],
      outcome,
    };
  }

  return { kind: "retry" };
}

export function planAutoMineNetworkErrorTransition(params: {
  retryCount: number;
  waitMs: number;
}): AutoMineNetworkErrorTransitionDecision {
  return {
    kind: "continue",
    action: {
      commandsAfter: [sleepCommand(params.waitMs)],
      event: {
        type: "network-error",
        retryCount: params.retryCount,
        waitMs: params.waitMs,
      },
      syncEffects: { progress: true, selection: false, session: false },
    },
  };
}

export function planAutoMineLoopCompletionTransition(): AutoMineLoopCompletionTransitionDecision {
  return {
    action: {
      commandsAfter: [sleepCommand(1500)],
      event: { type: "loop-completed" },
      syncEffects: { progress: true, selection: false, session: false },
    },
  };
}
