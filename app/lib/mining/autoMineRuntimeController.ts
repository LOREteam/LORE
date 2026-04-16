import type { PersistedAutoMinerSession } from "../../hooks/useMining.shared";

export interface AutoMineControllerRunParams {
  betStr: string;
  blocks: number;
  rounds: number;
}

export interface AutoMineControllerResumeParams extends AutoMineControllerRunParams {
  startRoundIndex: number;
  lastPlacedEpoch: bigint | null;
}

export type AutoMineRestoreResult =
  | { kind: "none" }
  | { kind: "cleared-invalid" }
  | { kind: "resume"; session: PersistedAutoMinerSession; params: AutoMineControllerResumeParams };

interface AutoMineRuntimeControllerDeps {
  clearSession: () => void;
  readSession: () => PersistedAutoMinerSession | null;
  releaseTabLock: () => void;
  saveSession: (session: PersistedAutoMinerSession) => void;
}

function buildSession(params: {
  active?: boolean;
  betStr: string;
  blocks: number;
  rounds: number;
  nextRoundIndex: number;
  lastPlacedEpoch: string | null;
}): PersistedAutoMinerSession {
  return {
    active: params.active ?? true,
    betStr: params.betStr,
    blocks: params.blocks,
    rounds: params.rounds,
    nextRoundIndex: params.nextRoundIndex,
    lastPlacedEpoch: params.lastPlacedEpoch,
  };
}

export function createAutoMineRuntimeController(deps: AutoMineRuntimeControllerDeps) {
  return {
    readRestorableRun(): AutoMineRestoreResult {
      const saved = deps.readSession();
      if (!saved) {
        return { kind: "none" };
      }
      if (!saved.active || saved.nextRoundIndex >= saved.rounds) {
        deps.clearSession();
        return { kind: "cleared-invalid" };
      }
      return {
        kind: "resume",
        session: saved,
        params: {
          betStr: saved.betStr,
          blocks: saved.blocks,
          rounds: saved.rounds,
          startRoundIndex: saved.nextRoundIndex,
          lastPlacedEpoch: saved.lastPlacedEpoch ? BigInt(saved.lastPlacedEpoch) : null,
        },
      };
    },

    persistStart(params: AutoMineControllerRunParams) {
      deps.saveSession(
        buildSession({
          ...params,
          nextRoundIndex: 0,
          lastPlacedEpoch: null,
        }),
      );
    },

    persistCheckpoint(params: {
      betStr: string;
      blocks: number;
      rounds: number;
      nextRoundIndex: number;
      lastPlacedEpoch: bigint | string | null;
    }) {
      deps.saveSession(
        buildSession({
          betStr: params.betStr,
          blocks: params.blocks,
          rounds: params.rounds,
          nextRoundIndex: params.nextRoundIndex,
          lastPlacedEpoch:
            typeof params.lastPlacedEpoch === "bigint"
              ? params.lastPlacedEpoch.toString()
              : params.lastPlacedEpoch,
        }),
      );
    },

    clearPersistedRun() {
      deps.clearSession();
    },

    releaseLock() {
      deps.releaseTabLock();
    },

    stopByUser() {
      deps.clearSession();
      deps.releaseTabLock();
    },

    finalizeRun(stopReason: string) {
      if (stopReason === "completed" || stopReason === "insufficient-balance") {
        deps.clearSession();
      }
      deps.releaseTabLock();
    },
  };
}
