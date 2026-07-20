"use client";

import { EIP7702_MINING_ENABLED } from "./eip7702";

export type MiningTxPathMode = "7702-delegated" | "standard-silent" | "wallet-write";

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

interface SanitizeMiningTxPathOptions {
  allowDelegated7702?: boolean;
}

const STORAGE_KEY = "lineaore:mining-tx-path:v1";
const PENDING_TX_STORAGE_PREFIX = "lineaore:pending-mining-tx:v2";
export const MINING_TX_PATH_EVENT = "lineaore:mining-tx-path";
const MINING_TX_PATH_MAX_FUTURE_SKEW_MS = 5_000;
const PENDING_TX_NOT_FOUND_GRACE_MS = 15 * 60_000;
const HEX_32_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function pendingTxStorageKey(chainId: number, contract: string, actor: string) {
  return `${PENDING_TX_STORAGE_PREFIX}:${chainId}:${contract.toLowerCase()}:${actor.toLowerCase()}`;
}

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

export function sanitizePendingMiningTxState(value: unknown): PendingMiningTxState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!Number.isSafeInteger(raw.chainId) || Number(raw.chainId) <= 0) return null;
  if (typeof raw.contract !== "string" || !ADDRESS_RE.test(raw.contract)) return null;
  if (typeof raw.actor !== "string" || !ADDRESS_RE.test(raw.actor)) return null;
  const hash = typeof raw.hash === "string" && HEX_32_RE.test(raw.hash) ? raw.hash.toLowerCase() as `0x${string}` : undefined;
  const nonce = Number.isSafeInteger(raw.nonce) && Number(raw.nonce) >= 0 ? Number(raw.nonce) : undefined;
  if (!hash && nonce === undefined) return null;
  if (typeof raw.ts !== "number" || !Number.isFinite(raw.ts) || raw.ts <= 0) return null;
  if (raw.ts - Date.now() > MINING_TX_PATH_MAX_FUTURE_SKEW_MS) return null;
  return {
    chainId: Number(raw.chainId),
    contract: raw.contract.toLowerCase() as `0x${string}`,
    actor: raw.actor.toLowerCase() as `0x${string}`,
    ...(hash ? { hash } : {}),
    ...(nonce !== undefined ? { nonce } : {}),
    ts: raw.ts,
  };
}

export function readPendingMiningTxState(
  chainId: number,
  contract: `0x${string}`,
  actor: string,
): PendingMiningTxState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(pendingTxStorageKey(chainId, contract, actor));
    if (!raw) return null;
    const state = sanitizePendingMiningTxState(JSON.parse(raw));
    if (
      !state ||
      state.chainId !== chainId ||
      state.contract !== contract.toLowerCase() ||
      state.actor !== actor.toLowerCase()
    ) return null;
    return state;
  } catch {
    return null;
  }
}

export function writePendingMiningTxState(state: Omit<PendingMiningTxState, "ts">) {
  if (typeof window === "undefined") return;
  const payload = sanitizePendingMiningTxState({ ...state, ts: Date.now() });
  if (!payload) return;
  try {
    window.localStorage.setItem(
      pendingTxStorageKey(payload.chainId, payload.contract, payload.actor),
      JSON.stringify(payload),
    );
  } catch {
    // A failed persistence write only removes reload recovery; the submitted tx remains valid.
  }
}

export function clearPendingMiningTxState(chainId: number, contract: string, actor: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(pendingTxStorageKey(chainId, contract, actor));
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
      if (latestNonce > state.nonce) return "confirmed";
      if (pendingNonce > state.nonce) return "pending";
      return now - state.ts >= PENDING_TX_NOT_FOUND_GRACE_MS ? "clear" : "pending";
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
  return now - state.ts >= PENDING_TX_NOT_FOUND_GRACE_MS ? "clear" : "pending";
}
