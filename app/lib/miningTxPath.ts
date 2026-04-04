"use client";

export type MiningTxPathMode = "7702-delegated" | "standard-silent" | "wallet-write";

export interface MiningTxPathState {
  mode: MiningTxPathMode;
  reason?: string;
  ts: number;
}

const STORAGE_KEY = "lineaore:mining-tx-path:v1";
export const MINING_TX_PATH_EVENT = "lineaore:mining-tx-path";

export function readMiningTxPathState(): MiningTxPathState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as MiningTxPathState;
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
