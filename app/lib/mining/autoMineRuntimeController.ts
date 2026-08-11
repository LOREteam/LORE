import {
  AUTO_MINER_AUTHORIZATION_TTL_MS,
  getAutoMinerSpendEnvelope,
  type PersistedAutoMinerSession,
} from "../../hooks/useMining.shared";

export interface AutoMineControllerRunParams {
  actor: `0x${string}`;
  betStr: string;
  blocks: number;
  rounds: number;
}

export type AutoMineRestoreResult =
  | { kind: "none" }
  | { kind: "cleared-invalid" }
  | { kind: "actor-mismatch" }
  | { kind: "paused"; session: PersistedAutoMinerSession };

interface AutoMineRuntimeControllerDeps {
  clearSession: () => void;
  readSession: () => PersistedAutoMinerSession | null;
  releaseTabLock: () => void;
  saveSession: (session: PersistedAutoMinerSession) => void;
  now?: () => number;
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

function buildSession(params: {
  active?: boolean;
  runId: string | null;
  actor: `0x${string}`;
  betStr: string;
  blocks: number;
  rounds: number;
  nextRoundIndex: number;
  lastPlacedEpoch: string | null;
  issuedAt: number;
  expiresAt: number;
  maxSpendPerBetRaw: bigint;
  totalSpendRaw: bigint;
  remainingSpendRaw: bigint;
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
    issuedAt: params.issuedAt,
    expiresAt: params.expiresAt,
    maxSpendPerBetRaw: params.maxSpendPerBetRaw.toString(),
    totalSpendRaw: params.totalSpendRaw.toString(),
    remainingSpendRaw: params.remainingSpendRaw.toString(),
  };
}

export function createAutoMineRuntimeController(deps: AutoMineRuntimeControllerDeps) {
  let activeActor: `0x${string}` | null = null;
  let activeRunId: string | null = null;
  let activeAuthorization: {
    issuedAt: number;
    expiresAt: number;
    maxSpendPerBetRaw: bigint;
    totalSpendRaw: bigint;
    remainingSpendRaw: bigint;
    reservedByEpoch: Map<string, bigint>;
  } | null = null;
  const now = () => deps.now?.() ?? Date.now();

  function resetActiveAuthorization() {
    activeActor = null;
    activeRunId = null;
    activeAuthorization = null;
  }

  function currentSessionMatchesActiveRun() {
    const current = deps.readSession();
    if (!current) return true;
    if (activeRunId && current.runId !== activeRunId) return false;
    if (activeActor && current.actor.toLowerCase() !== activeActor.toLowerCase()) return false;
    return true;
  }

  function clearActiveSession() {
    if (currentSessionMatchesActiveRun()) deps.clearSession();
    resetActiveAuthorization();
  }

  function requireCurrentAuthorization() {
    const current = deps.readSession();
    if (!activeActor || !activeRunId || !activeAuthorization || !currentSessionMatchesActiveRun() || !current?.active) {
      throw new Error("Auto-Miner authorization is missing. Start Auto-Miner again.");
    }
    if (now() >= activeAuthorization.expiresAt) {
      clearActiveSession();
      throw new Error("Auto-Miner authorization expired. Start Auto-Miner again.");
    }
    return activeAuthorization;
  }

  function pauseActiveSession() {
    const current = deps.readSession();
    if (activeActor && activeRunId && currentSessionMatchesActiveRun() && current?.active) {
      deps.saveSession({ ...current, active: false });
    }
    resetActiveAuthorization();
  }

  return {
    readRestorableRun(actorAddress: string | null): AutoMineRestoreResult {
      const saved = deps.readSession();
      if (!saved) {
        resetActiveAuthorization();
        return { kind: "none" };
      }
      if (saved.nextRoundIndex >= saved.rounds) {
        resetActiveAuthorization();
        deps.clearSession();
        return { kind: "cleared-invalid" };
      }
      const paused = { ...saved, active: false };
      deps.saveSession(paused);
      if (!actorAddress || saved.actor.toLowerCase() !== actorAddress.toLowerCase()) {
        resetActiveAuthorization();
        return { kind: "actor-mismatch" };
      }
      resetActiveAuthorization();
      return { kind: "paused", session: paused };
    },

    persistStart(params: AutoMineControllerRunParams) {
      const envelope = getAutoMinerSpendEnvelope(params);
      if (!envelope) throw new Error("Auto-Miner spend authorization is invalid.");
      const issuedAt = now();
      activeActor = params.actor;
      activeRunId = createAutoMineRunId();
      activeAuthorization = {
        issuedAt,
        expiresAt: issuedAt + AUTO_MINER_AUTHORIZATION_TTL_MS,
        ...envelope,
        reservedByEpoch: new Map(),
      };
      deps.saveSession(
        buildSession({
          ...params,
          runId: activeRunId,
          nextRoundIndex: 0,
          lastPlacedEpoch: null,
          ...activeAuthorization,
        }),
      );
    },

    assertCurrentAuthorization() {
      requireCurrentAuthorization();
    },

    assertCurrentAuthorizationForActor(actor: string | null) {
      requireCurrentAuthorization();
      if (!activeActor || !actor || activeActor.toLowerCase() !== actor.toLowerCase()) {
        throw new Error("Auto-Miner wallet changed. Start Auto-Miner again.");
      }
    },

    reserveSpend(params: { expectedEpoch: bigint | undefined; amountRaw: bigint }) {
      const authorization = requireCurrentAuthorization();
      const authorizedRunId = activeRunId;
      if (params.expectedEpoch === undefined || params.expectedEpoch < 0n || params.amountRaw <= 0n) {
        throw new Error("Auto-Miner spend authorization is invalid.");
      }
      if (params.amountRaw > authorization.maxSpendPerBetRaw) {
        throw new Error("Auto-Miner per-bet spend limit exceeded.");
      }
      const reservationKey = params.expectedEpoch.toString();
      const previousReservation = authorization.reservedByEpoch.get(reservationKey);
      if (previousReservation !== undefined) {
        if (previousReservation !== params.amountRaw) {
          throw new Error("Auto-Miner retry spend does not match the authorized bet.");
        }
        return {
          assertCurrent: () => {
            if (activeRunId !== authorizedRunId || requireCurrentAuthorization() !== authorization) {
              throw new Error("Auto-Miner authorization is stale. Start Auto-Miner again.");
            }
          },
        };
      }
      if (authorization.maxSpendPerBetRaw > authorization.remainingSpendRaw) {
        throw new Error("Auto-Miner total remaining spend limit exceeded.");
      }
      authorization.remainingSpendRaw -= authorization.maxSpendPerBetRaw;
      authorization.reservedByEpoch.set(reservationKey, params.amountRaw);
      const current = deps.readSession();
      if (!current || !currentSessionMatchesActiveRun()) {
        throw new Error("Auto-Miner authorization is missing. Start Auto-Miner again.");
      }
      deps.saveSession({ ...current, remainingSpendRaw: authorization.remainingSpendRaw.toString() });
      return {
        assertCurrent: () => {
          if (activeRunId !== authorizedRunId || requireCurrentAuthorization() !== authorization) {
            throw new Error("Auto-Miner authorization is stale. Start Auto-Miner again.");
          }
        },
      };
    },

    persistCheckpoint(params: {
      betStr: string;
      blocks: number;
      rounds: number;
      nextRoundIndex: number;
      lastPlacedEpoch: bigint | string | null;
    }) {
      if (!activeActor || !activeRunId || !activeAuthorization) {
        resetActiveAuthorization();
        return;
      }
      if (!currentSessionMatchesActiveRun()) return;
      const current = deps.readSession();
      if (
        !current ||
        current.betStr !== params.betStr ||
        current.blocks !== params.blocks ||
        current.rounds !== params.rounds
      ) {
        return;
      }
      const lastPlacedEpoch = normalizeCheckpointEpoch(params.lastPlacedEpoch);
      if (lastPlacedEpoch === undefined) return;
      const checkpointEnvelope = getAutoMinerSpendEnvelope({ ...params });
      if (!checkpointEnvelope) return;
      if (activeAuthorization.remainingSpendRaw > checkpointEnvelope.remainingSpendRaw) {
        activeAuthorization.remainingSpendRaw = checkpointEnvelope.remainingSpendRaw;
      }
      deps.saveSession(
        buildSession({
          runId: activeRunId,
          actor: activeActor,
          betStr: params.betStr,
          blocks: params.blocks,
          rounds: params.rounds,
          nextRoundIndex: params.nextRoundIndex,
          lastPlacedEpoch,
          issuedAt: activeAuthorization.issuedAt,
          expiresAt: activeAuthorization.expiresAt,
          maxSpendPerBetRaw: activeAuthorization.maxSpendPerBetRaw,
          totalSpendRaw: activeAuthorization.totalSpendRaw,
          remainingSpendRaw: activeAuthorization.remainingSpendRaw,
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

    pauseAndRelease() {
      pauseActiveSession();
      deps.releaseTabLock();
    },

    finalizeRun(stopReason: string) {
      if (stopReason === "completed" || stopReason === "insufficient-balance") {
        clearActiveSession();
      } else {
        pauseActiveSession();
      }
      deps.releaseTabLock();
    },
  };
}
