import { formatRetryWaitSeconds } from "./networkRetry";

export type AutoMineLoopStopReason =
  | "unknown"
  | "user-stopped"
  | "completed"
  | "insufficient-balance"
  | "no-client";

export interface AutoMineLoopSelection {
  tiles: number[];
  epoch: string | null;
}

export interface AutoMineLoopSessionCheckpoint {
  nextRoundIndex: number;
  lastPlacedEpoch: string | null;
}

export interface AutoMineLoopState {
  roundIndex: number;
  rounds: number;
  lastPlacedEpoch: bigint | null;
  networkRetries: number;
  progressMessage: string | null;
  selection: AutoMineLoopSelection;
  stopReason: AutoMineLoopStopReason;
  sessionCheckpoint: AutoMineLoopSessionCheckpoint | null;
}

function formatCyclesLeft(count: number): string {
  return `${count} ${count === 1 ? "cycle" : "cycles"} left`;
}

export type AutoMineLoopEvent =
  | { type: "round-betting-started"; liveEpoch: bigint; tiles: number[]; selectionEpoch: string }
  | { type: "round-skipped-existing"; liveEpoch?: bigint; placedEpoch?: bigint }
  | { type: "round-epoch-ended"; liveEpoch: bigint }
  | { type: "round-confirmed"; placedEpoch: bigint; tiles: number[] }
  | { type: "round-detected-on-chain"; placedEpoch: bigint; tiles: number[] }
  | { type: "round-recovered-after-network-error"; placedEpoch: bigint; tiles: number[] }
  | { type: "network-error"; retryCount: number; waitMs: number }
  | { type: "stop-user" }
  | { type: "stop-no-client" }
  | { type: "stop-insufficient-balance"; neededAmount: string; currentAmount: string }
  | { type: "loop-completed" };

export function createAutoMineLoopState(params: {
  rounds: number;
  startRoundIndex: number;
  restoredLastEpoch: bigint | null;
}): AutoMineLoopState {
  return {
    roundIndex: params.startRoundIndex,
    rounds: params.rounds,
    lastPlacedEpoch: params.restoredLastEpoch,
    networkRetries: 0,
    progressMessage: null,
    selection: { tiles: [], epoch: null },
    stopReason: "unknown",
    sessionCheckpoint: null,
  };
}

export function reduceAutoMineLoopEvent(
  state: AutoMineLoopState,
  event: AutoMineLoopEvent,
): AutoMineLoopState {
  switch (event.type) {
    case "round-betting-started":
      return {
        ...state,
        progressMessage: `${state.roundIndex + 1} / ${state.rounds} - epoch #${event.liveEpoch}: placing bet (${event.tiles.length} tiles)...`,
        selection: { tiles: event.tiles, epoch: event.selectionEpoch },
        sessionCheckpoint: {
          nextRoundIndex: state.roundIndex,
          lastPlacedEpoch: event.liveEpoch.toString(),
        },
      };

    case "round-skipped-existing":
      if (event.placedEpoch == null && event.liveEpoch == null) {
        return state;
      }
      const skippedEpoch = event.placedEpoch ?? event.liveEpoch!;
      return {
        ...state,
        roundIndex: state.roundIndex + 1,
        lastPlacedEpoch: skippedEpoch,
        networkRetries: 0,
        progressMessage: `${state.roundIndex + 1} / ${state.rounds} - epoch #${skippedEpoch} already confirmed; ${formatCyclesLeft(Math.max(0, state.rounds - state.roundIndex - 1))}`,
        selection: { tiles: [], epoch: null },
        sessionCheckpoint: {
          nextRoundIndex: state.roundIndex + 1,
          lastPlacedEpoch: skippedEpoch.toString(),
        },
      };

    case "round-epoch-ended":
      return {
        ...state,
        roundIndex: state.roundIndex + 1,
        lastPlacedEpoch: event.liveEpoch,
        networkRetries: 0,
        progressMessage: `${state.roundIndex + 1} / ${state.rounds} - epoch #${event.liveEpoch} skipped (ended); ${formatCyclesLeft(Math.max(0, state.rounds - state.roundIndex - 1))}`,
        selection: { tiles: [], epoch: null },
        sessionCheckpoint: {
          nextRoundIndex: state.roundIndex + 1,
          lastPlacedEpoch: event.liveEpoch.toString(),
        },
      };

    case "round-confirmed":
      return {
        ...state,
        roundIndex: state.roundIndex + 1,
        lastPlacedEpoch: event.placedEpoch,
        networkRetries: 0,
        progressMessage: `${state.roundIndex + 1} / ${state.rounds} - epoch #${event.placedEpoch} confirmed; ${formatCyclesLeft(Math.max(0, state.rounds - state.roundIndex - 1))}`,
        selection: { tiles: event.tiles, epoch: event.placedEpoch.toString() },
        sessionCheckpoint: null,
      };

    case "round-detected-on-chain":
      return {
        ...state,
        roundIndex: state.roundIndex + 1,
        lastPlacedEpoch: event.placedEpoch,
        networkRetries: 0,
        progressMessage: `${state.roundIndex + 1} / ${state.rounds} - epoch #${event.placedEpoch} confirmed on-chain; ${formatCyclesLeft(Math.max(0, state.rounds - state.roundIndex - 1))}`,
        selection: { tiles: event.tiles, epoch: event.placedEpoch.toString() },
        sessionCheckpoint: null,
      };

    case "round-recovered-after-network-error":
      return {
        ...state,
        roundIndex: state.roundIndex + 1,
        lastPlacedEpoch: event.placedEpoch,
        networkRetries: 0,
        progressMessage: `${state.roundIndex + 1} / ${state.rounds} - epoch #${event.placedEpoch} confirmed after RPC recovery; ${formatCyclesLeft(Math.max(0, state.rounds - state.roundIndex - 1))}`,
        selection: { tiles: event.tiles, epoch: event.placedEpoch.toString() },
        sessionCheckpoint: null,
      };

    case "network-error":
      return {
        ...state,
        networkRetries: event.retryCount,
        progressMessage: `RPC offline - retry ${event.retryCount} in ${formatRetryWaitSeconds(event.waitMs)}s...`,
        sessionCheckpoint: null,
      };

    case "stop-user":
      return {
        ...state,
        stopReason: "user-stopped",
        sessionCheckpoint: null,
      };

    case "stop-no-client":
      return {
        ...state,
        stopReason: "no-client",
        sessionCheckpoint: null,
      };

    case "stop-insufficient-balance":
      return {
        ...state,
        stopReason: "insufficient-balance",
        progressMessage: `Stopped: need ${event.neededAmount} LINEA, have ${event.currentAmount} LINEA`,
        sessionCheckpoint: null,
      };

    case "loop-completed":
      return {
        ...state,
        stopReason: "completed",
        progressMessage: `Completed ${state.rounds}/${state.rounds} rounds`,
        sessionCheckpoint: null,
      };
  }
}
