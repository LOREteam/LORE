"use client";

export type Eip7702FailureReason =
  | "timeout"
  | "privy-session"
  | "estimate-failed"
  | "send-failed"
  | "unknown";

export interface Eip7702RuntimeState {
  failureCount: number;
  lastFailureAt: number | null;
  lastFailureReason?: Eip7702FailureReason;
  cooldownUntil: number | null;
  lastSuccessAt: number | null;
}

const STORAGE_KEY = "lineaore:eip7702-runtime:v1";
export const EIP7702_RUNTIME_EVENT = "lineaore:eip7702-runtime";
const FAILURE_WINDOW_MS = 10 * 60_000;
const FAILURE_THRESHOLD = 2;
const COOLDOWN_MS = 5 * 60_000;

const DEFAULT_STATE: Eip7702RuntimeState = {
  failureCount: 0,
  lastFailureAt: null,
  cooldownUntil: null,
  lastSuccessAt: null,
};

function emit(state: Eip7702RuntimeState | null) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<Eip7702RuntimeState | null>(EIP7702_RUNTIME_EVENT, { detail: state }));
}

export function readEip7702RuntimeState(): Eip7702RuntimeState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<Eip7702RuntimeState>;
    return {
      failureCount: typeof parsed.failureCount === "number" ? parsed.failureCount : 0,
      lastFailureAt: typeof parsed.lastFailureAt === "number" ? parsed.lastFailureAt : null,
      lastFailureReason: parsed.lastFailureReason,
      cooldownUntil: typeof parsed.cooldownUntil === "number" ? parsed.cooldownUntil : null,
      lastSuccessAt: typeof parsed.lastSuccessAt === "number" ? parsed.lastSuccessAt : null,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function writeState(state: Eip7702RuntimeState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage failures
  }
  emit(state);
}

export function canAttemptEip7702() {
  const state = readEip7702RuntimeState();
  return !state.cooldownUntil || state.cooldownUntil <= Date.now();
}

export function getEip7702CooldownRemainingMs() {
  const state = readEip7702RuntimeState();
  if (!state.cooldownUntil) return 0;
  return Math.max(0, state.cooldownUntil - Date.now());
}

export function hasRecentEip7702Failure(maxAgeMs: number = FAILURE_WINDOW_MS) {
  const state = readEip7702RuntimeState();
  return state.lastFailureAt !== null && Date.now() - state.lastFailureAt <= maxAgeMs;
}

export function noteEip7702Failure(reason: Eip7702FailureReason) {
  const now = Date.now();
  const current = readEip7702RuntimeState();
  const withinWindow = current.lastFailureAt !== null && now - current.lastFailureAt <= FAILURE_WINDOW_MS;
  const failureCount = withinWindow ? current.failureCount + 1 : 1;
  const cooldownUntil = failureCount >= FAILURE_THRESHOLD ? now + COOLDOWN_MS : current.cooldownUntil && current.cooldownUntil > now ? current.cooldownUntil : null;

  writeState({
    failureCount,
    lastFailureAt: now,
    lastFailureReason: reason,
    cooldownUntil,
    lastSuccessAt: current.lastSuccessAt,
  });
}

export function noteEip7702Success() {
  const now = Date.now();
  writeState({
    failureCount: 0,
    lastFailureAt: null,
    cooldownUntil: null,
    lastSuccessAt: now,
  });
}

export function clearEip7702RuntimeState() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
  emit(null);
}
