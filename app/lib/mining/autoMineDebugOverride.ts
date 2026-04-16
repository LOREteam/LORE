import type { AutoMinePhase, RunningParams } from "../../hooks/useMining.types";

export interface AutoMineDebugOverride {
  phase: AutoMinePhase;
  progress: string | null;
  runningParams: RunningParams;
  updatedAt: number;
}

type OverrideStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const AUTO_MINE_DEBUG_OVERRIDE_STORAGE_KEY = "lineaore:auto-mine-debug-override:v1";
export const AUTO_MINE_DEBUG_OVERRIDE_EVENT = "lineaore:auto-mine-debug-override-change:v1";

const AUTO_MINE_PHASES: AutoMinePhase[] = [
  "idle",
  "starting",
  "restoring",
  "running",
  "retry-wait",
  "session-expired",
];

function getStorage(storage?: OverrideStorage | null) {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function canUseAutoMineDebugOverride() {
  if (typeof window === "undefined") return process.env.NODE_ENV !== "production";
  return (
    process.env.NODE_ENV !== "production" ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  );
}

function dispatchDebugOverrideEvent() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AUTO_MINE_DEBUG_OVERRIDE_EVENT));
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

export function sanitizeAutoMineDebugOverride(value: unknown): AutoMineDebugOverride | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (!isAutoMinePhase(candidate.phase)) return null;
  return {
    phase: candidate.phase,
    progress: typeof candidate.progress === "string" ? candidate.progress : null,
    runningParams: isRunningParams(candidate.runningParams) ? candidate.runningParams : null,
    updatedAt: Number.isFinite(candidate.updatedAt) ? Number(candidate.updatedAt) : 0,
  };
}

export function readAutoMineDebugOverride(storage?: OverrideStorage | null): AutoMineDebugOverride | null {
  const targetStorage = getStorage(storage);
  if (!targetStorage) return null;
  try {
    const raw = targetStorage.getItem(AUTO_MINE_DEBUG_OVERRIDE_STORAGE_KEY);
    if (!raw) return null;
    return sanitizeAutoMineDebugOverride(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeAutoMineDebugOverride(
  override: Omit<AutoMineDebugOverride, "updatedAt">,
  options?: { storage?: OverrideStorage | null; now?: number },
) {
  const targetStorage = getStorage(options?.storage);
  if (!targetStorage) return null;
  const nextValue: AutoMineDebugOverride = {
    ...override,
    updatedAt: options?.now ?? Date.now(),
  };
  try {
    targetStorage.setItem(AUTO_MINE_DEBUG_OVERRIDE_STORAGE_KEY, JSON.stringify(nextValue));
  } catch {
    return nextValue;
  }
  dispatchDebugOverrideEvent();
  return nextValue;
}

export function clearAutoMineDebugOverride(storage?: OverrideStorage | null) {
  const targetStorage = getStorage(storage);
  if (!targetStorage) return;
  try {
    targetStorage.removeItem(AUTO_MINE_DEBUG_OVERRIDE_STORAGE_KEY);
  } catch {
    return;
  }
  dispatchDebugOverrideEvent();
}
