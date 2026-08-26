"use client";

import { createPublicClient, encodeFunctionData, getAddress, http } from "viem";
import { getStableLineaReadRpcs } from "../../config/publicConfig";
import { APP_CHAIN, APP_NETWORK, GAME_ABI, TOKEN_ABI } from "./constants";
import {
  acquireEoaNonceLockLease,
  withEoaNonceLock,
  type EoaNonceLockFailure,
} from "./eoaNonceLock";
import { isUserRejection } from "./utils";

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
  calldata?: `0x${string}`;
  expectedEpoch?: string;
  tileIds?: number[];
  amountRawPerTile?: string;
  baselineBets?: string[];
  ts: number;
}

export type PendingMiningTxRecovery = "clear" | "confirmed" | "pending" | "manual-reconciliation-required";
export type PendingMiningApprovalRecovery = "confirmed" | "pending" | "reverted" | "manual-reconciliation-required";

type PendingMiningReceipt = {
  status: "reverted" | "success";
  transactionHash: `0x${string}`;
  blockHash: `0x${string}`;
  blockNumber: bigint;
  transactionIndex: number;
};

type PendingMiningTransaction = {
  hash: `0x${string}`;
  from: `0x${string}`;
  to: `0x${string}` | null;
  type?: unknown;
  nonce: number;
  input: `0x${string}`;
  blockHash?: `0x${string}` | null;
  blockNumber?: bigint | null;
  transactionIndex?: number | null;
};

export type PendingMiningTxClient = {
  waitForTransactionReceipt?: (args: { hash: `0x${string}`; timeout: number }) => Promise<PendingMiningReceipt>;
  getTransaction: (args: { hash: `0x${string}` }) => Promise<PendingMiningTransaction>;
  getTransactionReceipt: (args: { hash: `0x${string}` }) => Promise<PendingMiningReceipt>;
  getTransactionCount?: (args: { address: `0x${string}`; blockTag: "latest" | "pending" }) => Promise<number>;
  getChainId?: () => Promise<number>;
  getBlockNumber?: () => Promise<bigint>;
  getBlock?: (args: { blockNumber: bigint }) => Promise<{ hash: `0x${string}` | null }>;
  readContract?: (args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }) => Promise<unknown>;
};

export type PendingMiningTxClients = readonly [PendingMiningTxClient, PendingMiningTxClient];

export interface PendingMiningTxIntentInput {
  chainId: number;
  contract: `0x${string}`;
  actor: `0x${string}`;
  calldata: `0x${string}`;
  expectedEpoch: bigint;
  tileIds: readonly number[];
  amountRawPerTile: bigint;
}

export class PendingMiningTxSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PendingMiningTxSafetyError";
  }
}

function pendingMiningEoaLockError(reason: EoaNonceLockFailure, operation: string) {
  if (reason === "invalid-identity") {
    return new PendingMiningTxSafetyError(`Pending ${operation} identity is invalid.`);
  }
  if (reason === "unavailable") {
    return new PendingMiningTxSafetyError(
      `Web Locks are required for cross-tab-safe ${operation} submission in this browser.`,
    );
  }
  return new PendingMiningTxSafetyError(
    `Another tab is already reserving or submitting a transaction for this wallet; ${operation} is blocked.`,
  );
}

export interface PendingMiningApprovalState {
  chainId: number;
  token: `0x${string}`;
  spender: `0x${string}`;
  actor: `0x${string}`;
  nonce: number;
  amountRaw: string;
  hash?: `0x${string}`;
  ts: number;
}

export async function settleRecoveredMiningApprovalAllowance(input: {
  pendingState: Pick<PendingMiningApprovalState, "amountRaw">;
  requiredAmount: bigint;
  pollAgreedAllowanceUntil: (minimumAmount: bigint) => Promise<boolean>;
  clearApprovalState: () => void;
  readAgreedAllowance: () => Promise<bigint>;
}): Promise<"satisfied" | "approval-required"> {
  if (typeof input.requiredAmount !== "bigint" || input.requiredAmount <= 0n) {
    throw new Error("Mining approval amount must be a positive bigint.");
  }
  let persistedAmount: bigint;
  try {
    persistedAmount = BigInt(input.pendingState.amountRaw);
  } catch {
    throw new Error("Persisted approval amount is invalid; manual reconciliation is required.");
  }
  if (persistedAmount <= 0n) {
    throw new Error("Persisted approval amount is invalid; manual reconciliation is required.");
  }
  if (!await input.pollAgreedAllowanceUntil(persistedAmount)) {
    throw new Error("Finalized approval is not reflected in live allowance; manual reconciliation is required.");
  }
  input.clearApprovalState();
  return await input.readAgreedAllowance() >= input.requiredAmount
    ? "satisfied"
    : "approval-required";
}

const STORAGE_KEY = "lineaore:mining-tx-path:v1";
const PENDING_TX_STORAGE_PREFIX = "lineaore:pending-mining-tx:v2";
const PENDING_APPROVAL_STORAGE_PREFIX = "lineaore:pending-mining-approval:v1";
export const MINING_TX_PATH_EVENT = "lineaore:mining-tx-path";
const MINING_TX_PATH_MAX_FUTURE_SKEW_MS = 5_000;
const PENDING_TX_NOT_FOUND_GRACE_MS = 15 * 60_000;
const HEX_32_RE = /^0x[0-9a-fA-F]{64}$/;
const CALLDATA_RE = /^0x(?:[0-9a-fA-F]{2})+$/;
const UINT_RE = /^(?:0|[1-9][0-9]*)$/;
const SUPPORTED_MINING_TRANSACTION_TYPES = new Set(["legacy", "eip2930", "eip1559"]);
const ACTIVE_PENDING_BY_KEY = new Map<string, PendingMiningTxState>();
const ACTIVE_KEY_BY_ACTOR = new Map<string, string>();
const ACTOR_LOCK_RELEASES = new Map<string, () => void>();

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

function pendingTxActorKey(chainId: number, actor: string) {
  return `${chainId}:${getAddress(actor).toLowerCase()}`;
}

function pendingApprovalStorageKey(chainId: number, token: string, spender: string, actor: string) {
  return [
    PENDING_APPROVAL_STORAGE_PREFIX,
    chainId,
    getAddress(token).toLowerCase(),
    getAddress(spender).toLowerCase(),
    getAddress(actor).toLowerCase(),
  ].join(":");
}

function tryPendingApprovalStorageKey(chainId: number, token: string, spender: string, actor: string) {
  try {
    return pendingApprovalStorageKey(chainId, token, spender, actor);
  } catch {
    return null;
  }
}

export function parsePendingMiningFinalityBlocks(value?: string | null): bigint | null {
  const normalized = value?.trim();
  if (!normalized || !/^[1-9][0-9]*$/.test(normalized)) return null;
  try {
    const parsed = BigInt(normalized);
    return parsed <= 1_000_000n ? parsed : null;
  } catch {
    return null;
  }
}

function configuredPendingMiningFinalityBlocks() {
  const configured = process.env.NEXT_PUBLIC_MINING_TX_FINALITY_BLOCKS;
  if (configured !== undefined) return parsePendingMiningFinalityBlocks(configured);
  // Browser-side receipt finality must never silently collapse to zero. These
  // conservative per-network defaults remain overridable by a positive public
  // deployment value; malformed explicit configuration fails closed.
  return APP_NETWORK === "mainnet" ? 64n : 2n;
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
  const hasAnyIntentField = [
    raw.calldata,
    raw.expectedEpoch,
    raw.tileIds,
    raw.amountRawPerTile,
    raw.baselineBets,
  ].some((field) => field !== undefined && field !== null);
  let calldata: `0x${string}` | undefined;
  let expectedEpoch: string | undefined;
  let tileIds: number[] | undefined;
  let amountRawPerTile: string | undefined;
  let baselineBets: string[] | undefined;
  if (hasAnyIntentField) {
    if (typeof raw.calldata !== "string" || !CALLDATA_RE.test(raw.calldata)) return null;
    if (typeof raw.expectedEpoch !== "string" || !UINT_RE.test(raw.expectedEpoch)) return null;
    if (!Array.isArray(raw.tileIds) || raw.tileIds.length === 0 || raw.tileIds.length > 25) return null;
    const normalizedTiles = raw.tileIds.map((tile) => Number(tile));
    if (
      normalizedTiles.some((tile) => !Number.isSafeInteger(tile) || tile < 1 || tile > 25) ||
      new Set(normalizedTiles).size !== normalizedTiles.length
    ) return null;
    if (typeof raw.amountRawPerTile !== "string" || !UINT_RE.test(raw.amountRawPerTile) || BigInt(raw.amountRawPerTile) <= 0n) {
      return null;
    }
    if (
      !Array.isArray(raw.baselineBets) ||
      raw.baselineBets.length !== 25 ||
      raw.baselineBets.some((amount) => typeof amount !== "string" || !UINT_RE.test(amount))
    ) return null;
    calldata = raw.calldata.toLowerCase() as `0x${string}`;
    expectedEpoch = raw.expectedEpoch;
    tileIds = normalizedTiles;
    amountRawPerTile = raw.amountRawPerTile;
    baselineBets = [...raw.baselineBets] as string[];
  }
  const normalizedTs = normalizeMiningTimestamp(raw.ts, now);
  if (normalizedTs === null) return null;
  return {
    chainId: Number(raw.chainId),
    contract,
    actor,
    ...(hash ? { hash } : {}),
    ...(nonce !== undefined ? { nonce } : {}),
    ...(calldata ? { calldata } : {}),
    ...(expectedEpoch !== undefined ? { expectedEpoch } : {}),
    ...(tileIds ? { tileIds } : {}),
    ...(amountRawPerTile !== undefined ? { amountRawPerTile } : {}),
    ...(baselineBets ? { baselineBets } : {}),
    ts: normalizedTs,
  };
}

export function sanitizePendingMiningApprovalState(
  value: unknown,
  now = Date.now(),
): PendingMiningApprovalState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const chainId = Number(raw.chainId);
  const nonce = normalizePendingTxNonce(raw.nonce);
  const ts = normalizeMiningTimestamp(raw.ts, now);
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || nonce === null || ts === null) return null;
  if (typeof raw.amountRaw !== "string" || !UINT_RE.test(raw.amountRaw)) return null;
  let amountRaw: string;
  try {
    const amount = BigInt(raw.amountRaw);
    if (amount <= 0n) return null;
    amountRaw = amount.toString();
  } catch {
    return null;
  }
  let token: `0x${string}`;
  let spender: `0x${string}`;
  let actor: `0x${string}`;
  try {
    token = getAddress(String(raw.token)).toLowerCase() as `0x${string}`;
    spender = getAddress(String(raw.spender)).toLowerCase() as `0x${string}`;
    actor = getAddress(String(raw.actor)).toLowerCase() as `0x${string}`;
  } catch {
    return null;
  }
  const rawHash = raw.hash;
  if (rawHash !== undefined && (typeof rawHash !== "string" || !HEX_32_RE.test(rawHash))) return null;
  return {
    chainId,
    token,
    spender,
    actor,
    nonce,
    amountRaw,
    ...(typeof rawHash === "string" ? { hash: rawHash.toLowerCase() as `0x${string}` } : {}),
    ts,
  };
}

export function readPendingMiningApprovalState(
  chainId: number,
  token: string,
  spender: string,
  actor: string,
): PendingMiningApprovalState | null {
  if (typeof window === "undefined") return null;
  const key = tryPendingApprovalStorageKey(chainId, token, spender, actor);
  if (!key) throw new PendingMiningTxSafetyError("Pending approval identity is invalid.");
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const state = sanitizePendingMiningApprovalState(JSON.parse(raw));
    if (!state || pendingApprovalStorageKey(state.chainId, state.token, state.spender, state.actor) !== key) {
      throw new PendingMiningTxSafetyError("Pending approval state is invalid; manual reconciliation is required.");
    }
    return state;
  } catch (error) {
    if (error instanceof PendingMiningTxSafetyError) throw error;
    throw new PendingMiningTxSafetyError(
      `Pending approval storage is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function writePendingMiningApprovalState(
  state: Omit<PendingMiningApprovalState, "ts">,
): PendingMiningApprovalState | null {
  if (typeof window === "undefined") return null;
  const payload = sanitizePendingMiningApprovalState({ ...state, ts: Date.now() });
  if (!payload) return null;
  const key = tryPendingApprovalStorageKey(
    payload.chainId,
    payload.token,
    payload.spender,
    payload.actor,
  );
  if (!key) return null;
  try {
    const serialized = JSON.stringify(payload);
    window.localStorage.setItem(key, serialized);
    if (window.localStorage.getItem(key) !== serialized) return null;
    const verified = sanitizePendingMiningApprovalState(JSON.parse(serialized));
    return verified && JSON.stringify(verified) === serialized ? verified : null;
  } catch {
    return null;
  }
}

export function clearPendingMiningApprovalState(
  chainId: number,
  token: string,
  spender: string,
  actor: string,
) {
  if (typeof window === "undefined") return false;
  const key = tryPendingApprovalStorageKey(chainId, token, spender, actor);
  if (!key) return false;
  try {
    window.localStorage.removeItem(key);
    return window.localStorage.getItem(key) === null;
  } catch {
    return false;
  }
}

function pendingApprovalStateEquals(first: PendingMiningApprovalState, second: PendingMiningApprovalState) {
  return JSON.stringify(first) === JSON.stringify(second);
}

export function clearVerifiedPendingMiningApprovalState(state: PendingMiningApprovalState): boolean {
  if (typeof window === "undefined") return false;
  const normalized = sanitizePendingMiningApprovalState(state);
  if (!normalized || !pendingApprovalStateEquals(normalized, state)) return false;
  const key = tryPendingApprovalStorageKey(state.chainId, state.token, state.spender, state.actor);
  if (!key) return false;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return false;
    const persisted = sanitizePendingMiningApprovalState(JSON.parse(raw));
    if (!persisted || !pendingApprovalStateEquals(persisted, state)) return false;
  } catch {
    return false;
  }
  return clearPendingMiningApprovalState(state.chainId, state.token, state.spender, state.actor);
}

export async function executeReservedMiningApprovalWalletSink<T>(
  state: PendingMiningApprovalState,
  assertBeforeWalletSink: () => Promise<void> | void,
  invokeWalletSink: () => Promise<T>,
): Promise<T> {
  let walletSinkInvoked = false;
  try {
    await assertBeforeWalletSink();
    walletSinkInvoked = true;
    return await invokeWalletSink();
  } catch (error) {
    const definitelyUnsent = !walletSinkInvoked || isUserRejection(error);
    if (definitelyUnsent && !clearVerifiedPendingMiningApprovalState(state)) {
      throw new PendingMiningTxSafetyError(
        "Unsubmitted approval reservation could not be cleared; manual reconciliation is required.",
      );
    }
    throw error;
  }
}

export async function withPendingMiningApprovalLock<T>(
  input: { chainId: number; token: string; spender: string; actor: string },
  operation: () => Promise<T>,
): Promise<T> {
  const key = tryPendingApprovalStorageKey(input.chainId, input.token, input.spender, input.actor);
  if (!key || !Number.isSafeInteger(input.chainId) || input.chainId <= 0) {
    throw new PendingMiningTxSafetyError("Pending approval identity is invalid.");
  }
  return withEoaNonceLock(
    { chainId: input.chainId, actor: input.actor },
    {
      ifAvailable: true,
      errorFactory: (reason) => pendingMiningEoaLockError(reason, "token approval"),
    },
    operation,
  );
}

function pendingStateEquals(first: PendingMiningTxState, second: PendingMiningTxState) {
  return JSON.stringify(first) === JSON.stringify(second);
}

export function readPendingMiningTxState(
  chainId: number,
  contract: `0x${string}`,
  actor: string,
): PendingMiningTxState | null {
  if (typeof window === "undefined") return null;
  const key = tryPendingTxStorageKey(chainId, contract, actor);
  if (!key) return null;
  const active = ACTIVE_PENDING_BY_KEY.get(key);
  if (active) return { ...active, tileIds: active.tileIds ? [...active.tileIds] : undefined, baselineBets: active.baselineBets ? [...active.baselineBets] : undefined };
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
      throw new PendingMiningTxSafetyError(
        "Pending mining transaction state is invalid; manual reconciliation is required.",
      );
    }
    return state;
  } catch (error) {
    throw new PendingMiningTxSafetyError(
      `Pending mining transaction storage is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function writePendingMiningTxState(state: Omit<PendingMiningTxState, "ts">): boolean {
  if (typeof window === "undefined") return false;
  const payload = sanitizePendingMiningTxState({ ...state, ts: Date.now() });
  if (!payload) return false;
  const key = tryPendingTxStorageKey(payload.chainId, payload.contract, payload.actor);
  if (!key) return false;
  const actorKey = pendingTxActorKey(payload.chainId, payload.actor);
  const activeKey = ACTIVE_KEY_BY_ACTOR.get(actorKey);
  if (activeKey && activeKey !== key) return false;
  ACTIVE_KEY_BY_ACTOR.set(actorKey, key);
  ACTIVE_PENDING_BY_KEY.set(key, payload);
  try {
    const serialized = JSON.stringify(payload);
    window.localStorage.setItem(key, serialized);
    const verifiedRaw = window.localStorage.getItem(key);
    if (verifiedRaw !== serialized) return false;
    const verified = sanitizePendingMiningTxState(JSON.parse(verifiedRaw));
    return Boolean(verified && pendingStateEquals(verified, payload));
  } catch {
    // Keep the actor-scoped in-memory latch. A caller must not submit or resend
    // while durable intent persistence cannot be verified.
    return false;
  }
}

export function clearPendingMiningTxState(chainId: number, contract: string, actor: string): boolean {
  if (typeof window === "undefined") return false;
  const key = tryPendingTxStorageKey(chainId, contract, actor);
  if (!key) return false;
  try {
    window.localStorage.removeItem(key);
    if (window.localStorage.getItem(key) !== null) return false;
  } catch {
    return false;
  }
  ACTIVE_PENDING_BY_KEY.delete(key);
  const actorKey = pendingTxActorKey(chainId, actor);
  if (ACTIVE_KEY_BY_ACTOR.get(actorKey) === key) ACTIVE_KEY_BY_ACTOR.delete(actorKey);
  ACTOR_LOCK_RELEASES.get(actorKey)?.();
  ACTOR_LOCK_RELEASES.delete(actorKey);
  return true;
}

export function clearVerifiedPendingMiningTxState(state: PendingMiningTxState): boolean {
  if (typeof window === "undefined") return false;
  const normalized = sanitizePendingMiningTxState(state);
  if (!normalized || !pendingStateEquals(normalized, state)) return false;
  const key = tryPendingTxStorageKey(state.chainId, state.contract, state.actor);
  if (!key) return false;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return false;
    const persisted = sanitizePendingMiningTxState(JSON.parse(raw));
    const active = ACTIVE_PENDING_BY_KEY.get(key);
    if (!persisted || !pendingStateEquals(persisted, state)) return false;
    if (active && !pendingStateEquals(active, state)) return false;
  } catch {
    return false;
  }
  return clearPendingMiningTxState(state.chainId, state.contract, state.actor);
}

export function hasTrackedMiningNonce(chainId: number, actor: string, nonce: number): boolean {
  if (
    typeof window === "undefined" ||
    !Number.isSafeInteger(chainId) ||
    chainId <= 0 ||
    normalizePendingTxNonce(nonce) === null
  ) {
    return false;
  }
  let normalizedActor: `0x${string}`;
  try {
    normalizedActor = getAddress(actor).toLowerCase() as `0x${string}`;
  } catch {
    throw new PendingMiningTxSafetyError("Pending mining actor identity is invalid.");
  }
  const actorKey = pendingTxActorKey(chainId, normalizedActor);
  const activeKey = ACTIVE_KEY_BY_ACTOR.get(actorKey);
  if (activeKey) {
    const active = ACTIVE_PENDING_BY_KEY.get(activeKey);
    if (!active) {
      throw new PendingMiningTxSafetyError("Pending mining in-memory state is inconsistent.");
    }
    if (active.nonce === undefined || active.nonce === nonce) return true;
  }

  let keys: string[];
  try {
    keys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
      .filter((key): key is string => key !== null);
  } catch (error) {
    throw new PendingMiningTxSafetyError(
      `Pending mining storage is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const txActorSuffix = `:${normalizedActor}`;
  const txPrefix = `${PENDING_TX_STORAGE_PREFIX}:${chainId}:`;
  const approvalPrefix = `${PENDING_APPROVAL_STORAGE_PREFIX}:${chainId}:`;
  for (const key of keys) {
    if (!key.endsWith(txActorSuffix) || (!key.startsWith(txPrefix) && !key.startsWith(approvalPrefix))) {
      continue;
    }
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(key);
    } catch (error) {
      throw new PendingMiningTxSafetyError(
        `Pending mining storage is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (raw === null) continue;
    try {
      if (key.startsWith(txPrefix)) {
        const state = sanitizePendingMiningTxState(JSON.parse(raw));
        const canonicalKey = state ? pendingTxStorageKey(state.chainId, state.contract, state.actor) : null;
        if (!state || canonicalKey !== key) {
          throw new PendingMiningTxSafetyError(
            "Pending mining transaction state is invalid; manual reconciliation is required.",
          );
        }
        if (state.nonce === undefined || state.nonce === nonce) return true;
      } else {
        const state = sanitizePendingMiningApprovalState(JSON.parse(raw));
        const canonicalKey = state
          ? pendingApprovalStorageKey(state.chainId, state.token, state.spender, state.actor)
          : null;
        if (!state || canonicalKey !== key) {
          throw new PendingMiningTxSafetyError(
            "Pending approval state is invalid; manual reconciliation is required.",
          );
        }
        if (state.nonce === nonce) return true;
      }
    } catch (error) {
      if (error instanceof PendingMiningTxSafetyError) throw error;
      throw new PendingMiningTxSafetyError(
        "Pending mining state is invalid; manual reconciliation is required.",
      );
    }
  }
  return false;
}

function isNotFoundError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  return /(?:transaction|receipt).*not found/i.test(`${name} ${message}`);
}

export function selectPendingMiningAgreementRpcUrls(urls: readonly string[]): readonly [string, string] {
  const selected: string[] = [];
  const hosts = new Set<string>();
  for (const raw of urls) {
    let endpoint: URL;
    try {
      endpoint = new URL(raw.trim());
    } catch {
      throw new PendingMiningTxSafetyError("Pending mining RPC URL is invalid.");
    }
    if (!/^https?:$/.test(endpoint.protocol) || endpoint.username || endpoint.password || !endpoint.hostname) {
      throw new PendingMiningTxSafetyError("Pending mining RPC URL is invalid.");
    }
    endpoint.hash = "";
    const hostname = endpoint.hostname.toLowerCase().replace(/\.+$/, "");
    if (hosts.has(hostname)) continue;
    hosts.add(hostname);
    selected.push(endpoint.toString());
    if (selected.length === 2) return [selected[0], selected[1]];
  }
  throw new PendingMiningTxSafetyError("Two independent pending mining RPC origins are required.");
}

export function createPendingMiningAgreementClients(): PendingMiningTxClients | null {
  const configuredRpcs = APP_NETWORK === "mainnet"
    ? process.env.NEXT_PUBLIC_LINEA_RPCS
    : process.env.NEXT_PUBLIC_LINEA_SEPOLIA_RPCS;
  try {
    const urls = selectPendingMiningAgreementRpcUrls(getStableLineaReadRpcs(configuredRpcs, APP_NETWORK));
    return [
      createPublicClient({ chain: APP_CHAIN, transport: http(urls[0]) }) as unknown as PendingMiningTxClient,
      createPublicClient({ chain: APP_CHAIN, transport: http(urls[1]) }) as unknown as PendingMiningTxClient,
    ];
  } catch {
    return null;
  }
}

async function acquirePendingActorLock(chainId: number, actor: `0x${string}`) {
  const actorKey = pendingTxActorKey(chainId, actor);
  if (ACTIVE_KEY_BY_ACTOR.has(actorKey) || ACTOR_LOCK_RELEASES.has(actorKey)) {
    throw new PendingMiningTxSafetyError("A mining transaction is already reserved for this actor.");
  }
  const lease = await acquireEoaNonceLockLease(
    { chainId, actor },
    { errorFactory: (reason) => pendingMiningEoaLockError(reason, "mining transaction") },
  );
  ACTOR_LOCK_RELEASES.set(actorKey, lease.release);
  return actorKey;
}

function releasePendingActorLock(actorKey: string) {
  ACTOR_LOCK_RELEASES.get(actorKey)?.();
  ACTOR_LOCK_RELEASES.delete(actorKey);
}

async function withPendingMiningActorMutationLock<T>(
  chainId: number,
  actor: `0x${string}`,
  operation: () => Promise<T>,
): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) {
    throw new PendingMiningTxSafetyError(
      "Web Locks are required for cross-tab-safe mining state changes in this browser.",
    );
  }
  const actorKey = pendingTxActorKey(chainId, actor);
  return locks.request(
    `lineaore:pending-mining-mutation:${actorKey}`,
    { ifAvailable: true, mode: "exclusive" },
    async (lock) => {
      if (!lock) {
        throw new PendingMiningTxSafetyError("Another tab is reconciling mining state for this actor.");
      }
      return operation();
    },
  );
}

async function readNonceObservation(client: PendingMiningTxClient, actor: `0x${string}`) {
  if (!client.getTransactionCount) throw new PendingMiningTxSafetyError("Pending mining nonce RPC is unavailable.");
  const [latest, pending] = await Promise.all([
    client.getTransactionCount({ address: actor, blockTag: "latest" }),
    client.getTransactionCount({ address: actor, blockTag: "pending" }),
  ]);
  const normalizedLatest = normalizePendingTxNonce(latest);
  const normalizedPending = normalizePendingTxNonce(pending);
  if (normalizedLatest === null || normalizedPending === null || normalizedPending < normalizedLatest) {
    throw new PendingMiningTxSafetyError("Pending mining nonce evidence is invalid.");
  }
  return [normalizedLatest, normalizedPending] as const;
}

export async function readAgreedPendingMiningApprovalNonce(
  clients: PendingMiningTxClients,
  actor: `0x${string}`,
): Promise<number> {
  const observations = await Promise.all(clients.map((client) => readNonceObservation(client, actor)));
  if (!observationsAgree(observations[0], observations[1])) {
    throw new PendingMiningTxSafetyError("Approval nonce evidence does not agree across RPC origins.");
  }
  return observations[0][1];
}

export async function readAgreedPendingMiningAllowance(
  clients: PendingMiningTxClients,
  token: `0x${string}`,
  spender: `0x${string}`,
  actor: `0x${string}`,
): Promise<bigint> {
  const allowances = await Promise.all(clients.map(async (client) => {
    if (!client.readContract) {
      throw new PendingMiningTxSafetyError("Approval allowance RPC is unavailable.");
    }
    const allowance = await client.readContract({
      address: token,
      abi: TOKEN_ABI,
      functionName: "allowance",
      args: [actor, spender],
    });
    if (typeof allowance !== "bigint" || allowance < 0n) {
      throw new PendingMiningTxSafetyError("Approval allowance evidence is invalid.");
    }
    return allowance;
  }));
  if (allowances[0] !== allowances[1]) {
    throw new PendingMiningTxSafetyError("Approval allowance evidence does not agree across RPC origins.");
  }
  return allowances[0];
}

async function readBetObservation(
  client: PendingMiningTxClient,
  state: Pick<PendingMiningTxIntentInput, "contract" | "actor" | "expectedEpoch">,
) {
  if (!client.readContract) throw new PendingMiningTxSafetyError("Pending mining bet-state RPC is unavailable.");
  const bets = await client.readContract({
    address: state.contract,
    abi: GAME_ABI,
    functionName: "getUserBetsAll",
    args: [state.expectedEpoch, state.actor],
  });
  if (!Array.isArray(bets) || bets.length !== 25 || bets.some((amount) => typeof amount !== "bigint" || amount < 0n)) {
    throw new PendingMiningTxSafetyError("Pending mining bet-state evidence is invalid.");
  }
  return bets.map((amount) => (amount as bigint).toString());
}

export async function reservePendingMiningTxIntent(
  clients: PendingMiningTxClients,
  input: PendingMiningTxIntentInput,
): Promise<PendingMiningTxState> {
  const actor = getAddress(input.actor).toLowerCase() as `0x${string}`;
  const contract = getAddress(input.contract).toLowerCase() as `0x${string}`;
  if (input.expectedEpoch < 0n || input.amountRawPerTile <= 0n || !CALLDATA_RE.test(input.calldata)) {
    throw new PendingMiningTxSafetyError("Pending mining intent is invalid.");
  }
  const actorKey = await acquirePendingActorLock(input.chainId, actor);
  try {
    return await withPendingMiningActorMutationLock(input.chainId, actor, async () => {
      if (readPendingMiningTxState(input.chainId, contract, actor)) {
        throw new PendingMiningTxSafetyError("A pending mining transaction already requires reconciliation.");
      }
      const [nonces, bets] = await Promise.all([
        Promise.all(clients.map((client) => readNonceObservation(client, actor))),
        Promise.all(clients.map((client) => readBetObservation(client, { contract, actor, expectedEpoch: input.expectedEpoch }))),
      ]);
      if (
        nonces[0][0] !== nonces[1][0] ||
        nonces[0][1] !== nonces[1][1] ||
        nonces[0][0] !== nonces[0][1] ||
        JSON.stringify(bets[0]) !== JSON.stringify(bets[1])
      ) {
        throw new PendingMiningTxSafetyError("Pending mining RPC origins do not agree on a stable pre-submit state.");
      }
      const persisted = writePendingMiningTxState({
        chainId: input.chainId,
        contract,
        actor,
        nonce: nonces[0][1],
        calldata: input.calldata.toLowerCase() as `0x${string}`,
        expectedEpoch: input.expectedEpoch.toString(),
        tileIds: [...input.tileIds],
        amountRawPerTile: input.amountRawPerTile.toString(),
        baselineBets: bets[0],
      });
      const state = readPendingMiningTxState(input.chainId, contract, actor);
      if (!persisted || !state) {
        throw new PendingMiningTxSafetyError("Pending mining intent could not be persisted and verified; submission is blocked.");
      }
      return state;
    });
  } catch (error) {
    const key = tryPendingTxStorageKey(input.chainId, contract, actor);
    if (!key || !ACTIVE_PENDING_BY_KEY.has(key)) releasePendingActorLock(actorKey);
    throw error;
  }
}

export function attachPendingMiningTxHash(state: PendingMiningTxState, hash: `0x${string}`) {
  const normalizedHash = typeof hash === "string" && HEX_32_RE.test(hash)
    ? hash.toLowerCase() as `0x${string}`
    : null;
  if (!normalizedHash) return false;
  return writePendingMiningTxState({ ...state, hash: normalizedHash });
}

function hasCompletePendingIntent(state: PendingMiningTxState): state is PendingMiningTxState & {
  nonce: number;
  calldata: `0x${string}`;
  expectedEpoch: string;
  tileIds: number[];
  amountRawPerTile: string;
  baselineBets: string[];
} {
  return state.nonce !== undefined && Boolean(
    state.calldata && state.expectedEpoch !== undefined && state.tileIds && state.amountRawPerTile && state.baselineBets,
  );
}

function receiptFingerprint(receipt: PendingMiningReceipt, hash: `0x${string}`) {
  if (
    receipt.transactionHash?.toLowerCase() !== hash ||
    !HEX_32_RE.test(receipt.blockHash ?? "") ||
    typeof receipt.blockNumber !== "bigint" || receipt.blockNumber < 0n ||
    !Number.isSafeInteger(receipt.transactionIndex) || receipt.transactionIndex < 0
  ) return null;
  return `${receipt.status}:${hash}:${receipt.blockHash.toLowerCase()}:${receipt.blockNumber}:${receipt.transactionIndex}`;
}

function isSupportedMiningTransactionType(value: unknown) {
  return typeof value === "string" && SUPPORTED_MINING_TRANSACTION_TYPES.has(value);
}

function transactionFingerprint(
  transaction: PendingMiningTransaction,
  state: PendingMiningTxState,
  receipt?: PendingMiningReceipt,
) {
  if (!state.hash || !hasCompletePendingIntent(state)) return null;
  try {
    if (
      transaction.hash?.toLowerCase() !== state.hash ||
      getAddress(transaction.from).toLowerCase() !== state.actor ||
      !transaction.to || getAddress(transaction.to).toLowerCase() !== state.contract ||
      !isSupportedMiningTransactionType(transaction.type) ||
      normalizePendingTxNonce(transaction.nonce) !== state.nonce ||
      transaction.input?.toLowerCase() !== state.calldata
    ) return null;
    if (receipt) {
      if (
        transaction.blockHash?.toLowerCase() !== receipt.blockHash.toLowerCase() ||
        transaction.blockNumber !== receipt.blockNumber ||
        transaction.transactionIndex !== receipt.transactionIndex
      ) return null;
    } else if (
      transaction.blockHash != null ||
      transaction.blockNumber != null ||
      transaction.transactionIndex != null
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return [
    state.hash,
    state.actor,
    state.contract,
    state.nonce,
    state.calldata,
    transaction.blockHash?.toLowerCase() ?? "",
    transaction.blockNumber?.toString() ?? "",
    transaction.transactionIndex ?? "",
  ].join(":");
}

function canonicalTransactionFingerprint(transaction: PendingMiningTransaction, hash: `0x${string}`) {
  try {
    if (
      transaction.hash?.toLowerCase() !== hash ||
      !transaction.to ||
      !isSupportedMiningTransactionType(transaction.type) ||
      normalizePendingTxNonce(transaction.nonce) === null ||
      !CALLDATA_RE.test(transaction.input)
    ) return null;
    return [
      hash,
      getAddress(transaction.from).toLowerCase(),
      getAddress(transaction.to).toLowerCase(),
      transaction.nonce,
      transaction.input.toLowerCase(),
      transaction.blockHash?.toLowerCase() ?? "",
      transaction.blockNumber?.toString() ?? "",
      transaction.transactionIndex ?? "",
    ].join(":");
  } catch {
    return null;
  }
}

async function readOptionalReceipt(client: PendingMiningTxClient, hash: `0x${string}`) {
  try {
    return await client.getTransactionReceipt({ hash });
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

async function readOptionalTransaction(client: PendingMiningTxClient, hash: `0x${string}`) {
  try {
    return await client.getTransaction({ hash });
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

function observationsAgree<T>(first: T, second: T) {
  return JSON.stringify(first) === JSON.stringify(second);
}

async function hasAgreedPendingMiningReceiptFinality(
  clients: PendingMiningTxClients,
  receipt: PendingMiningReceipt,
  finalityBlocks: bigint | null,
  expectedChainId: number = APP_CHAIN.id,
) {
  if (!finalityBlocks || finalityBlocks <= 0n) return false;
  const observations = await Promise.all(clients.map(async (client) => {
    if (!client.getChainId || !client.getBlockNumber || !client.getBlock) {
      throw new PendingMiningTxSafetyError("Pending mining canonical-chain RPC is unavailable.");
    }
    const [chainId, headBlock] = await Promise.all([
      client.getChainId(),
      client.getBlockNumber(),
    ]);
    if (chainId !== expectedChainId || headBlock < receipt.blockNumber + finalityBlocks) {
      return null;
    }
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    return block.hash?.toLowerCase() ?? null;
  }));
  return Boolean(
    observations[0] &&
    observations[0] === observations[1] &&
    observations[0] === receipt.blockHash.toLowerCase()
  );
}

function approvalTransactionFingerprint(
  transaction: PendingMiningTransaction,
  state: PendingMiningApprovalState,
  receipt?: PendingMiningReceipt,
) {
  if (!state.hash) return null;
  const expectedCalldata = encodeFunctionData({
    abi: TOKEN_ABI,
    functionName: "approve",
    args: [state.spender, BigInt(state.amountRaw)],
  }).toLowerCase();
  try {
    if (
      transaction.hash?.toLowerCase() !== state.hash ||
      getAddress(transaction.from).toLowerCase() !== state.actor ||
      !transaction.to || getAddress(transaction.to).toLowerCase() !== state.token ||
      !isSupportedMiningTransactionType(transaction.type) ||
      normalizePendingTxNonce(transaction.nonce) !== state.nonce ||
      transaction.input?.toLowerCase() !== expectedCalldata
    ) return null;
    if (receipt) {
      if (
        transaction.blockHash?.toLowerCase() !== receipt.blockHash.toLowerCase() ||
        transaction.blockNumber !== receipt.blockNumber ||
        transaction.transactionIndex !== receipt.transactionIndex
      ) return null;
    } else if (
      transaction.blockHash != null ||
      transaction.blockNumber != null ||
      transaction.transactionIndex != null
    ) {
      return null;
    }
    return [
      state.hash,
      state.chainId,
      state.actor,
      state.token,
      state.spender,
      state.nonce,
      state.amountRaw,
      expectedCalldata,
      transaction.blockHash?.toLowerCase() ?? "",
      transaction.blockNumber?.toString() ?? "",
      transaction.transactionIndex ?? "",
    ].join(":");
  } catch {
    return null;
  }
}

export async function recoverPendingMiningApproval(
  clients: PendingMiningTxClients,
  state: PendingMiningApprovalState,
  finalityBlocks = configuredPendingMiningFinalityBlocks(),
): Promise<PendingMiningApprovalRecovery> {
  const normalized = sanitizePendingMiningApprovalState(state);
  if (!normalized || !normalized.hash || !finalityBlocks || finalityBlocks <= 0n) {
    return "manual-reconciliation-required";
  }
  try {
    if (!clients[0].getChainId || !clients[1].getChainId) {
      return "manual-reconciliation-required";
    }
    const chainIds = await Promise.all(clients.map((client) => client.getChainId!()));
    if (chainIds[0] !== normalized.chainId || chainIds[1] !== normalized.chainId) {
      return "manual-reconciliation-required";
    }

    const [transactions, receipts] = await Promise.all([
      Promise.all(clients.map((client) => readOptionalTransaction(client, normalized.hash!))),
      Promise.all(clients.map((client) => readOptionalReceipt(client, normalized.hash!))),
    ]);
    if (!transactions[0] || !transactions[1]) return "manual-reconciliation-required";
    if (!receipts[0] && !receipts[1]) {
      const transactionFingerprints = transactions.map((transaction) =>
        approvalTransactionFingerprint(transaction!, normalized),
      );
      return transactionFingerprints[0] && transactionFingerprints[0] === transactionFingerprints[1]
        ? "pending"
        : "manual-reconciliation-required";
    }
    if (!receipts[0] || !receipts[1]) return "manual-reconciliation-required";
    const receiptFingerprints = receipts.map((receipt) => receiptFingerprint(receipt!, normalized.hash!));
    const transactionFingerprints = transactions.map((transaction, index) =>
      approvalTransactionFingerprint(transaction!, normalized, receipts[index]!),
    );
    if (
      !receiptFingerprints[0] || receiptFingerprints[0] !== receiptFingerprints[1] ||
      !transactionFingerprints[0] || transactionFingerprints[0] !== transactionFingerprints[1]
    ) return "manual-reconciliation-required";
    if (!await hasAgreedPendingMiningReceiptFinality(
      clients,
      receipts[0],
      finalityBlocks,
      normalized.chainId,
    )) return "pending";

    const [stableTransactions, stableReceipts] = await Promise.all([
      Promise.all(clients.map((client) => readOptionalTransaction(client, normalized.hash!))),
      Promise.all(clients.map((client) => readOptionalReceipt(client, normalized.hash!))),
    ]);
    if (!stableTransactions[0] || !stableTransactions[1] || !stableReceipts[0] || !stableReceipts[1]) {
      return "manual-reconciliation-required";
    }
    const stableReceiptFingerprints = stableReceipts.map((receipt) =>
      receiptFingerprint(receipt!, normalized.hash!),
    );
    const stableTransactionFingerprints = stableTransactions.map((transaction, index) =>
      approvalTransactionFingerprint(transaction!, normalized, stableReceipts[index]!),
    );
    if (
      stableReceiptFingerprints[0] !== receiptFingerprints[0] ||
      stableReceiptFingerprints[1] !== receiptFingerprints[0] ||
      stableTransactionFingerprints[0] !== transactionFingerprints[0] ||
      stableTransactionFingerprints[1] !== transactionFingerprints[0]
    ) return "manual-reconciliation-required";
    return stableReceipts[0].status === "success" ? "confirmed" : "reverted";
  } catch {
    return "manual-reconciliation-required";
  }
}

export async function waitForPendingMiningReceiptAgreement(
  clients: PendingMiningTxClients,
  hash: `0x${string}`,
  timeout: number,
  finalityBlocks = configuredPendingMiningFinalityBlocks(),
): Promise<"confirmed" | "pending"> {
  if (!HEX_32_RE.test(hash) || !Number.isSafeInteger(timeout) || timeout <= 0) {
    throw new PendingMiningTxSafetyError("Pending mining receipt request is invalid.");
  }
  if (!clients[0].waitForTransactionReceipt || !clients[1].waitForTransactionReceipt) {
    throw new PendingMiningTxSafetyError("Pending mining receipt quorum is unavailable.");
  }
  const waited = await Promise.allSettled([
    clients[0].waitForTransactionReceipt({ hash, timeout }),
    clients[1].waitForTransactionReceipt({ hash, timeout }),
  ]);
  const observed = waited.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const lateReceipts = await Promise.all(clients.map((client) => readOptionalReceipt(client, hash)));
  if (!lateReceipts[0] && !lateReceipts[1]) {
    if (observed.length > 0) {
      throw new PendingMiningTxSafetyError("Pending mining receipt RPC origins disagree.");
    }
    const transactions = await Promise.all(clients.map((client) => readOptionalTransaction(client, hash)));
    if (!transactions[0] && !transactions[1]) {
      throw new PendingMiningTxSafetyError("Pending mining transaction is missing from both RPC origins; manual reconciliation is required.");
    }
    if (!transactions[0] || !transactions[1]) {
      throw new PendingMiningTxSafetyError("Pending mining transaction RPC origins disagree.");
    }
    const fingerprints = transactions.map((transaction) => canonicalTransactionFingerprint(transaction!, hash));
    if (!fingerprints[0] || fingerprints[0] !== fingerprints[1]) {
      throw new PendingMiningTxSafetyError("Pending mining transaction identity does not agree across RPC origins.");
    }
    return "pending";
  }
  if (!lateReceipts[0] || !lateReceipts[1]) {
    throw new PendingMiningTxSafetyError("Pending mining receipt RPC origins disagree.");
  }
  const fingerprints = lateReceipts.map((receipt) => receiptFingerprint(receipt!, hash));
  if (!fingerprints[0] || fingerprints[0] !== fingerprints[1]) {
    throw new PendingMiningTxSafetyError("Pending mining receipt identity does not agree across RPC origins.");
  }
  for (const receipt of observed) {
    if (receiptFingerprint(receipt, hash) !== fingerprints[0]) {
      throw new PendingMiningTxSafetyError("Pending mining receipt changed during confirmation.");
    }
  }
  if (lateReceipts[0].status === "reverted") {
    if (!await hasAgreedPendingMiningReceiptFinality(clients, lateReceipts[0], finalityBlocks)) return "pending";
    throw new Error(`Transaction reverted (hash: ${hash})`);
  }
  return await hasAgreedPendingMiningReceiptFinality(clients, lateReceipts[0], finalityBlocks) ? "confirmed" : "pending";
}

export async function recoverPendingMiningTx(
  clients: PendingMiningTxClients,
  state: PendingMiningTxState,
  now = Date.now(),
  finalityBlocks = configuredPendingMiningFinalityBlocks(),
): Promise<PendingMiningTxRecovery> {
  if (!state.hash) {
    if (state.nonce === undefined) return "pending";
    try {
      const nonceObservations = await Promise.all(clients.map((client) => readNonceObservation(client, state.actor)));
      if (!observationsAgree(nonceObservations[0], nonceObservations[1])) return "manual-reconciliation-required";
      const [normalizedLatestNonce, normalizedPendingNonce] = nonceObservations[0];
      // A consumed nonce proves only that this slot is no longer pending. Without the
      // submitted hash, it cannot identify the mined transaction or prove its receipt,
      // so do not unlock a potentially successful bet for a duplicate submission.
      if (normalizedLatestNonce > state.nonce) return "manual-reconciliation-required";
      if (normalizedPendingNonce > state.nonce) return "pending";
      return hasPendingTxNotFoundGraceElapsed(state.ts, now) ? "manual-reconciliation-required" : "pending";
    } catch {
      return "pending";
    }
  }

  if (!hasCompletePendingIntent(state)) return "manual-reconciliation-required";
  try {
    const receipts = await Promise.all(clients.map((client) => readOptionalReceipt(client, state.hash!)));
    if (!receipts[0] && !receipts[1]) {
      const transactions = await Promise.all(clients.map((client) => readOptionalTransaction(client, state.hash!)));
      if (!transactions[0] && !transactions[1]) {
        return hasPendingTxNotFoundGraceElapsed(state.ts, now) ? "manual-reconciliation-required" : "pending";
      }
      if (!transactions[0] || !transactions[1]) return "manual-reconciliation-required";
      const fingerprints = transactions.map((transaction) => transactionFingerprint(transaction!, state));
      return fingerprints[0] && fingerprints[0] === fingerprints[1] ? "pending" : "manual-reconciliation-required";
    }
    if (!receipts[0] || !receipts[1]) return "manual-reconciliation-required";
    const receiptFingerprints = receipts.map((receipt) => receiptFingerprint(receipt!, state.hash!));
    if (!receiptFingerprints[0] || receiptFingerprints[0] !== receiptFingerprints[1]) return "manual-reconciliation-required";

    const [transactions, nonces, bets, stableReceipts] = await Promise.all([
      Promise.all(clients.map((client) => client.getTransaction({ hash: state.hash! }))),
      Promise.all(clients.map((client) => readNonceObservation(client, state.actor))),
      Promise.all(clients.map((client) => readBetObservation(client, {
        contract: state.contract,
        actor: state.actor,
        expectedEpoch: BigInt(state.expectedEpoch),
      }))),
      Promise.all(clients.map((client) => readOptionalReceipt(client, state.hash!))),
    ]);
    const transactionFingerprints = transactions.map((transaction, index) =>
      transactionFingerprint(transaction, state, receipts[index]!),
    );
    const stableReceiptFingerprints = stableReceipts.map((receipt) => receipt ? receiptFingerprint(receipt, state.hash!) : null);
    if (
      !transactionFingerprints[0] || transactionFingerprints[0] !== transactionFingerprints[1] ||
      !observationsAgree(nonces[0], nonces[1]) ||
      !observationsAgree(bets[0], bets[1]) ||
      stableReceiptFingerprints[0] !== receiptFingerprints[0] ||
      stableReceiptFingerprints[1] !== receiptFingerprints[0]
    ) return "manual-reconciliation-required";
    if (nonces[0][0] <= state.nonce || nonces[0][1] < nonces[0][0]) return "pending";
    if (!await hasAgreedPendingMiningReceiptFinality(clients, receipts[0], finalityBlocks)) return "pending";
    if (receipts[0].status === "reverted") return "clear";
    const deltaMatches = state.tileIds.every((tile) => {
      const index = tile - 1;
      return BigInt(bets[0][index]) >= BigInt(state.baselineBets[index]) + BigInt(state.amountRawPerTile);
    });
    return deltaMatches ? "confirmed" : "manual-reconciliation-required";
  } catch {
    return "pending";
  }
}

export async function recoverAndClearPendingMiningTx(
  clients: PendingMiningTxClients,
  state: PendingMiningTxState,
  now = Date.now(),
  finalityBlocks = configuredPendingMiningFinalityBlocks(),
): Promise<PendingMiningTxRecovery> {
  const normalized = sanitizePendingMiningTxState(state, now);
  if (!normalized || !pendingStateEquals(normalized, state)) {
    return "manual-reconciliation-required";
  }
  try {
    return await withPendingMiningActorMutationLock(
      normalized.chainId,
      normalized.actor,
      async () => {
        const current = readPendingMiningTxState(
          normalized.chainId,
          normalized.contract,
          normalized.actor,
        );
        if (!current || !pendingStateEquals(current, normalized)) {
          return "manual-reconciliation-required";
        }
        const recovery = await recoverPendingMiningTx(clients, current, now, finalityBlocks);
        if (recovery !== "clear" && recovery !== "confirmed") return recovery;
        if (!clearVerifiedPendingMiningTxState(current)) {
          return "manual-reconciliation-required";
        }
        return recovery;
      },
    );
  } catch {
    return "manual-reconciliation-required";
  }
}
