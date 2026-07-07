"use client";

import { EIP7702_MINING_ENABLED } from "./eip7702";

export type MiningTxPathMode = "7702-delegated" | "standard-silent" | "wallet-write";

export interface MiningTxPathState {
  mode: MiningTxPathMode;
  reason?: string;
  ts: number;
}

interface SanitizeMiningTxPathOptions {
  allowDelegated7702?: boolean;
}

const STORAGE_KEY = "lineaore:mining-tx-path:v1";
export const MINING_TX_PATH_EVENT = "lineaore:mining-tx-path";
const MINING_TX_PATH_MAX_FUTURE_SKEW_MS = 5_000;

export function sanitizeMiningTxPathState(
  value: unknown,
  options: SanitizeMiningTxPathOptions = {},
): MiningTxPathState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const mode = raw.mode;
  const ts = raw.ts;
  const reason = raw.reason;
  if (mode !== "standard-silent" && mode !== "wallet-write" && mode !== "7702-delegated") return null;
  if (mode === "7702-delegated" && !options.allowDelegated7702) return null;
  if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) return null;
  if (ts - Date.now() > MINING_TX_PATH_MAX_FUTURE_SKEW_MS) return null;
  return {
    mode,
    ...(typeof reason === "string" && reason ? { reason } : {}),
    ts,
  };
}

export function readMiningTxPathState(): MiningTxPathState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return sanitizeMiningTxPathState(JSON.parse(raw), { allowDelegated7702: EIP7702_MINING_ENABLED });
  } catch {
    return null;
  }
}

export function writeMiningTxPathState(mode: MiningTxPathMode, reason?: string) {
  if (typeof window === "undefined") return;
  const payload: MiningTxPathState = {
    mode,
    ...(reason ? { reason } : {}),
    ts: Date.now(),
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage failures
  }
  window.dispatchEvent(new CustomEvent<MiningTxPathState>(MINING_TX_PATH_EVENT, { detail: payload }));
}

export function clearMiningTxPathState() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
  window.dispatchEvent(new CustomEvent(MINING_TX_PATH_EVENT));
}
