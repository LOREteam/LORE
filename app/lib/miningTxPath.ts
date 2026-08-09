"use client";

import { getAddress } from "viem";

export type MiningTxPathMode = "standard-silent" | "wallet-write";

export interface MiningTxPathState {
  mode: MiningTxPathMode;
  reason?: string;
  ts: number;
}

export interface PendingMiningTxState {
  chainId: number;
  contract: `0x${string}`;
  actor: `0x${string}`;
  hash?: `0x${string}`;
  nonce?: number;
  ts: number;
}

export type PendingMiningTxRecovery = "clear" | "confirmed" | "pending";

type PendingMiningTxClient = {
  getTransaction: (args: { hash: `0x${string}` }) => Promise<{ blockNumber?: bigint | null }>;
  getTransactionReceipt: (args: { hash: `0x${string}` }) => Promise<{ status: "reverted" | "success" }>;
  getTransactionCount?: (args: { address: `0x${string}`; blockTag: "latest" | "pending" }) => Promise<number>;
};

const STORAGE_KEY = "lineaore:mining-tx-path:v1";
const PENDING_TX_STORAGE_PREFIX = "lineaore:pending-mining-tx:v2";
export const MINING_TX_PATH_EVENT = "lineaore:mining-tx-path";
const MINING_TX_PATH_MAX_FUTURE_SKEW_MS = 5_000;
const PENDING_TX_NOT_FOUND_GRACE_MS = 15 * 60_000;
const HEX_32_RE = /^0x[0-9a-fA-F]{64}$/;

function isSafeCurrentTime(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function normalizeMiningTimestamp(value: unknown, now = Date.now()) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return null;
  if (!isSafeCurrentTime(now)) return null;
  if (value - now > MINING_TX_PATH_MAX_FUTURE_SKEW_MS) return null;
  return value;
}

function hasPendingTxNotFoundGraceElapsed(ts: number, now = Date.now()) {
  if (!isSafeCurrentTime(now) || !Number.isSafeInteger(ts) || ts <= 0 || ts > now) return false;
  return now - ts >= PENDING_TX_NOT_FOUND_GRACE_MS;
}

function normalizePendingTxNonce(value: unknown): number | null {
  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(value);
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

function pendingTxStorageKey(chainId: number, contract: string, actor: string) {
  return `${PENDING_TX_STORAGE_PREFIX}:${chainId}:${getAddress(contract).toLowerCase()}:${getAddress(actor).toLowerCase()}`;
}

function tryPendingTxStorageKey(chainId: number, contract: string, actor: string) {
  try {
    return pendingTxStorageKey(chainId, contract, actor);
  } catch {
    return null;
  }
}

export function sanitizeMiningTxPathState(
  value: unknown,
  now = Date.now(),
): MiningTxPathState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const mode = raw.mode;
  const ts = raw.ts;
  const reason = raw.reason;
  if (mode !== "standard-silent" && mode !== "wallet-write") return null;
  const normalizedTs = normalizeMiningTimestamp(ts, now);
  if (normalizedTs === null) return null;
  return {
    mode,
    ...(typeof reason === "string" && reason ? { reason } : {}),
    ts: normalizedTs,
  };
}

export function readMiningTxPathState(): MiningTxPathState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const state = sanitizeMiningTxPathState(JSON.parse(raw));
    if (!state) window.localStorage.removeItem(STORAGE_KEY);
    return state;
  } catch {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore storage failures
    }
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

export function sanitizePendingMiningTxState(value: unknown, now = Date.now()): PendingMiningTxState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!Number.isSafeInteger(raw.chainId) || Number(raw.chainId) <= 0) return null;
  let contract: `0x${string}`;
  let actor: `0x${string}`;
  try {
    contract = getAddress(typeof raw.contract === "string" ? raw.contract : "").toLowerCase() as `0x${string}`;
    actor = getAddress(typeof raw.actor === "string" ? raw.actor : "").toLowerCase() as `0x${string}`;
  } catch {
    return null;
  }
  const rawHash = raw.hash;
  if (rawHash !== undefined && rawHash !== null && (typeof rawHash !== "string" || !HEX_32_RE.test(rawHash))) {
    return null;
  }
  const rawNonce = raw.nonce;
  if (rawNonce !== undefined && rawNonce !== null && (!Number.isSafeInteger(rawNonce) || Number(rawNonce) < 0)) {
    return null;
  }
  const hash = typeof rawHash === "string" ? rawHash.toLowerCase() as `0x${string}` : undefined;
  const nonce = rawNonce !== undefined && rawNonce !== null ? Number(rawNonce) : undefined;
  if (!hash && nonce === undefined) return null;
  const normalizedTs = normalizeMiningTimestamp(raw.ts, now);
  if (normalizedTs === null) return null;
  return {
    chainId: Number(raw.chainId),
    contract,
    actor,
    ...(hash ? { hash } : {}),
    ...(nonce !== undefined ? { nonce } : {}),
    ts: normalizedTs,
  };
}

export function readPendingMiningTxState(
  chainId: number,
  contract: `0x${string}`,
  actor: string,
): PendingMiningTxState | null {
  if (typeof window === "undefined") return null;
  const key = tryPendingTxStorageKey(chainId, contract, actor);
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const state = sanitizePendingMiningTxState(JSON.parse(raw));
    if (
      !state ||
      state.chainId !== chainId ||
      state.contract !== getAddress(contract).toLowerCase() ||
      state.actor !== getAddress(actor).toLowerCase()
    ) {
      clearPendingMiningTxState(chainId, contract, actor);
      return null;
    }
    return state;
  } catch {
    clearPendingMiningTxState(chainId, contract, actor);
    return null;
  }
}

export function writePendingMiningTxState(state: Omit<PendingMiningTxState, "ts">) {
  if (typeof window === "undefined") return;
  const payload = sanitizePendingMiningTxState({ ...state, ts: Date.now() });
  if (!payload) return;
  const key = tryPendingTxStorageKey(payload.chainId, payload.contract, payload.actor);
  if (!key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // A failed persistence write only removes reload recovery; the submitted tx remains valid.
  }
}

export function clearPendingMiningTxState(chainId: number, contract: string, actor: string) {
  if (typeof window === "undefined") return;
  const key = tryPendingTxStorageKey(chainId, contract, actor);
  if (!key) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore storage failures
  }
}

function isNotFoundError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  return /(?:transaction|receipt).*not found/i.test(`${name} ${message}`);
}

export async function recoverPendingMiningTx(
  client: PendingMiningTxClient,
  state: PendingMiningTxState,
  now = Date.now(),
): Promise<PendingMiningTxRecovery> {
  if (!state.hash) {
    if (state.nonce === undefined || !client.getTransactionCount) return "pending";
    try {
      const [latestNonce, pendingNonce] = await Promise.all([
        client.getTransactionCount({ address: state.actor, blockTag: "latest" }),
        client.getTransactionCount({ address: state.actor, blockTag: "pending" }),
      ]);
      const normalizedLatestNonce = normalizePendingTxNonce(latestNonce);
      const normalizedPendingNonce = normalizePendingTxNonce(pendingNonce);
      if (normalizedLatestNonce === null || normalizedPendingNonce === null || normalizedPendingNonce < normalizedLatestNonce) {
        return "pending";
      }
      if (normalizedLatestNonce > state.nonce) return "confirmed";
      if (normalizedPendingNonce > state.nonce) return "pending";
      return hasPendingTxNotFoundGraceElapsed(state.ts, now) ? "clear" : "pending";
    } catch {
      return "pending";
    }
  }

  try {
    const receipt = await client.getTransactionReceipt({ hash: state.hash });
    if (receipt.status === "reverted") return "clear";
    return "confirmed";
  } catch (error) {
    if (!isNotFoundError(error)) return "pending";
  }

  try {
    await client.getTransaction({ hash: state.hash });
    return "pending";
  } catch (error) {
    if (!isNotFoundError(error)) return "pending";
  }

  // A dropped tx has no portable provider signal. Clear only after a long not-found grace window.
  return hasPendingTxNotFoundGraceElapsed(state.ts, now) ? "clear" : "pending";
}
