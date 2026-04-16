import { APP_CHAIN_ID, CONTRACT_ADDRESS } from "../constants";
import type { AutoMineLoopStopReason } from "./autoMineLoopModel";
import type { AutoMinePhase, RunningParams } from "../../hooks/useMining.types";

export type AutoMineDiagnosticsErrorKind =
  | "session-expired"
  | "network"
  | "wallet-unavailable"
  | "pending-nonce-blocked"
  | "insufficient-funds"
  | "timeout"
  | "unknown";

export type AutoMineDiagnosticsStopReason =
  | AutoMineLoopStopReason
  | "error"
  | "retry-wait"
  | "session-expired";

export interface AutoMineDiagnosticsSnapshot {
  phase: AutoMinePhase;
  progress: string | null;
  runningParams: RunningParams;
  isAutoMining: boolean;
  autoResumeRequested: boolean;
  sessionExpired: boolean;
  lastErrorKind: AutoMineDiagnosticsErrorKind | null;
  lastErrorMessage: string | null;
  lastErrorRawMessage: string | null;
  lastStopReason: AutoMineDiagnosticsStopReason | null;
  updatedAt: number;
}

type AutoMineDiagnosticsStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const AUTO_MINE_DIAGNOSTICS_STORAGE_KEY =
  `lineaore:auto-mine-diagnostics:v1:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`;
export const AUTO_MINE_DIAGNOSTICS_EVENT =
  `lineaore:auto-mine-diagnostics-change:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`;

const AUTO_MINE_PHASES: AutoMinePhase[] = [
  "idle",
  "starting",
  "restoring",
  "running",
  "retry-wait",
  "session-expired",
];

const DIAGNOSTIC_ERROR_KINDS: AutoMineDiagnosticsErrorKind[] = [
  "session-expired",
  "network",
  "wallet-unavailable",
  "pending-nonce-blocked",
  "insufficient-funds",
  "timeout",
  "unknown",
];

const DIAGNOSTIC_STOP_REASONS: AutoMineDiagnosticsStopReason[] = [
  "unknown",
  "user-stopped",
  "completed",
  "insufficient-balance",
  "no-client",
  "error",
  "retry-wait",
  "session-expired",
];

function getStorage(storage?: AutoMineDiagnosticsStorage | null) {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function dispatchAutoMineDiagnosticsEvent() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AUTO_MINE_DIAGNOSTICS_EVENT));
}

function isRunningParams(value: unknown): value is NonNullable<RunningParams> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { betStr?: unknown; blocks?: unknown; rounds?: unknown };
  return (
    typeof candidate.betStr === "string" &&
    Number.isFinite(candidate.blocks) &&
    Number.isFinite(candidate.rounds)
  );
}

function isAutoMinePhase(value: unknown): value is AutoMinePhase {
  return AUTO_MINE_PHASES.includes(value as AutoMinePhase);
}

function isErrorKind(value: unknown): value is AutoMineDiagnosticsErrorKind {
  return DIAGNOSTIC_ERROR_KINDS.includes(value as AutoMineDiagnosticsErrorKind);
}

function isStopReason(value: unknown): value is AutoMineDiagnosticsStopReason {
  return DIAGNOSTIC_STOP_REASONS.includes(value as AutoMineDiagnosticsStopReason);
}

export function createDefaultAutoMineDiagnosticsSnapshot(): AutoMineDiagnosticsSnapshot {
  return {
    phase: "idle",
    progress: null,
    runningParams: null,
    isAutoMining: false,
    autoResumeRequested: false,
    sessionExpired: false,
    lastErrorKind: null,
    lastErrorMessage: null,
    lastErrorRawMessage: null,
    lastStopReason: null,
    updatedAt: 0,
  };
}

export function sanitizeAutoMineDiagnosticsSnapshot(value: unknown): AutoMineDiagnosticsSnapshot {
  const fallback = createDefaultAutoMineDiagnosticsSnapshot();
  if (!value || typeof value !== "object") return fallback;

  const candidate = value as Record<string, unknown>;
  return {
    phase: isAutoMinePhase(candidate.phase) ? candidate.phase : fallback.phase,
    progress: typeof candidate.progress === "string" ? candidate.progress : null,
    runningParams: isRunningParams(candidate.runningParams) ? candidate.runningParams : null,
    isAutoMining: candidate.isAutoMining === true,
    autoResumeRequested: candidate.autoResumeRequested === true,
    sessionExpired: candidate.sessionExpired === true,
    lastErrorKind: isErrorKind(candidate.lastErrorKind) ? candidate.lastErrorKind : null,
    lastErrorMessage: typeof candidate.lastErrorMessage === "string" ? candidate.lastErrorMessage : null,
    lastErrorRawMessage: typeof candidate.lastErrorRawMessage === "string" ? candidate.lastErrorRawMessage : null,
    lastStopReason: isStopReason(candidate.lastStopReason) ? candidate.lastStopReason : null,
    updatedAt: Number.isFinite(candidate.updatedAt) ? Number(candidate.updatedAt) : 0,
  };
}

export function mergeAutoMineDiagnosticsSnapshot(
  current: AutoMineDiagnosticsSnapshot | null,
  patch: Partial<AutoMineDiagnosticsSnapshot>,
  now: number = Date.now(),
): AutoMineDiagnosticsSnapshot {
  return {
    ...(current ?? createDefaultAutoMineDiagnosticsSnapshot()),
    ...patch,
    updatedAt: now,
  };
}

export function readAutoMineDiagnostics(storage?: AutoMineDiagnosticsStorage | null): AutoMineDiagnosticsSnapshot | null {
  const targetStorage = getStorage(storage);
  if (!targetStorage) return null;
  try {
    const raw = targetStorage.getItem(AUTO_MINE_DIAGNOSTICS_STORAGE_KEY);
    if (!raw) return null;
    return sanitizeAutoMineDiagnosticsSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeAutoMineDiagnostics(
  patch: Partial<AutoMineDiagnosticsSnapshot>,
  options?: {
    storage?: AutoMineDiagnosticsStorage | null;
    now?: number;
  },
) {
  const targetStorage = getStorage(options?.storage);
  if (!targetStorage) return null;
  const nextSnapshot = mergeAutoMineDiagnosticsSnapshot(
    readAutoMineDiagnostics(targetStorage),
    patch,
    options?.now,
  );
  try {
    targetStorage.setItem(AUTO_MINE_DIAGNOSTICS_STORAGE_KEY, JSON.stringify(nextSnapshot));
  } catch {
    return nextSnapshot;
  }
  dispatchAutoMineDiagnosticsEvent();
  return nextSnapshot;
}

export function clearAutoMineDiagnostics(storage?: AutoMineDiagnosticsStorage | null) {
  const targetStorage = getStorage(storage);
  if (!targetStorage) return;
  try {
    targetStorage.removeItem(AUTO_MINE_DIAGNOSTICS_STORAGE_KEY);
  } catch {
    return;
  }
  dispatchAutoMineDiagnosticsEvent();
}
