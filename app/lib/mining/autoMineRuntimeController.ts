import type { PersistedAutoMinerSession } from "../../hooks/useMining.shared";

export interface AutoMineControllerRunParams {
  actor: `0x${string}`;
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
  | { kind: "actor-mismatch" }
  | { kind: "resume"; session: PersistedAutoMinerSession; params: AutoMineControllerResumeParams };

interface AutoMineRuntimeControllerDeps {
  clearSession: () => void;
  readSession: () => PersistedAutoMinerSession | null;
  releaseTabLock: () => void;
  saveSession: (session: PersistedAutoMinerSession) => void;
}

const AUTO_MINE_EPOCH_RE = /^(?:0|[1-9]\d{0,77})$/;

function createAutoMineRunId() {
  return `run:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeCheckpointEpoch(value: bigint | string | null): string | null | undefined {
  if (value === null) return null;
  const normalized = typeof value === "bigint" ? value.toString() : value;
  if (!AUTO_MINE_EPOCH_RE.test(normalized)) return undefined;
  return normalized;
}

function parseRestoredEpoch(value: string | null): bigint | null | undefined {
  if (value === null) return null;
  if (!AUTO_MINE_EPOCH_RE.test(value)) return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function buildSession(params: {
  active?: boolean;
  runId: string | null;
  actor: `0x${string}`;
  betStr: string;
  blocks: number;
  rounds: number;
  nextRoundIndex: number;
  lastPlacedEpoch: string | null;
}): PersistedAutoMinerSession {
  return {
    active: params.active ?? true,
    runId: params.runId,
    actor: params.actor,
    betStr: params.betStr,
    blocks: params.blocks,
    rounds: params.rounds,
    nextRoundIndex: params.nextRoundIndex,
    lastPlacedEpoch: params.lastPlacedEpoch,
  };
}

export function createAutoMineRuntimeController(deps: AutoMineRuntimeControllerDeps) {
  let activeActor: `0x${string}` | null = null;
  let activeRunId: string | null = null;

  function currentSessionMatchesActiveRun() {
    const current = deps.readSession();
    if (!current) return true;
    if (activeRunId && current.runId && current.runId !== activeRunId) return false;
    if (activeActor && current.actor.toLowerCase() !== activeActor.toLowerCase()) return false;
    return true;
  }

  function clearActiveSession() {
    if (currentSessionMatchesActiveRun()) deps.clearSession();
    activeActor = null;
    activeRunId = null;
  }

  return {
    readRestorableRun(actorAddress: string | null): AutoMineRestoreResult {
      const saved = deps.readSession();
      if (!saved) {
        activeActor = null;
        activeRunId = null;
        return { kind: "none" };
      }
      if (!saved.active || saved.nextRoundIndex >= saved.rounds) {
        activeActor = null;
        activeRunId = null;
        deps.clearSession();
        return { kind: "cleared-invalid" };
      }
      if (!actorAddress || saved.actor.toLowerCase() !== actorAddress.toLowerCase()) {
        activeActor = null;
        activeRunId = null;
        return { kind: "actor-mismatch" };
      }
      activeActor = saved.actor;
      activeRunId = saved.runId ?? createAutoMineRunId();
      const lastPlacedEpoch = parseRestoredEpoch(saved.lastPlacedEpoch);
      if (lastPlacedEpoch === undefined) {
        activeActor = null;
        activeRunId = null;
        deps.clearSession();
        return { kind: "cleared-invalid" };
      }
      return {
        kind: "resume",
        session: saved,
        params: {
          actor: saved.actor,
          betStr: saved.betStr,
          blocks: saved.blocks,
          rounds: saved.rounds,
          startRoundIndex: saved.nextRoundIndex,
          lastPlacedEpoch,
        },
      };
    },

    persistStart(params: AutoMineControllerRunParams) {
      activeActor = params.actor;
      activeRunId = createAutoMineRunId();
      deps.saveSession(
        buildSession({
          ...params,
          runId: activeRunId,
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
      if (!activeActor || !activeRunId) {
        activeActor = null;
        activeRunId = null;
        return;
      }
      if (!currentSessionMatchesActiveRun()) return;
      const lastPlacedEpoch = normalizeCheckpointEpoch(params.lastPlacedEpoch);
      if (lastPlacedEpoch === undefined) return;
      deps.saveSession(
        buildSession({
          runId: activeRunId,
          actor: activeActor,
          betStr: params.betStr,
          blocks: params.blocks,
          rounds: params.rounds,
          nextRoundIndex: params.nextRoundIndex,
          lastPlacedEpoch,
        }),
      );
    },

    clearPersistedRun() {
      clearActiveSession();
    },

    releaseLock() {
      deps.releaseTabLock();
    },

    stopByUser() {
      clearActiveSession();
      deps.releaseTabLock();
    },

    finalizeRun(stopReason: string) {
      if (stopReason === "completed" || stopReason === "insufficient-balance") {
        clearActiveSession();
      }
      deps.releaseTabLock();
    },
  };
}
