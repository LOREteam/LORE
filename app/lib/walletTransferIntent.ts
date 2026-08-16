"use client";

import { encodeFunctionData, getAddress } from "viem";
import { withEoaNonceLock, type EoaNonceLockFailure } from "./eoaNonceLock";

export type WalletTransferAsset = "native" | `0x${string}`;

export interface WalletTransferIntent {
  actor: `0x${string}`;
  chainId: number;
  asset: WalletTransferAsset;
  destination: `0x${string}`;
  amountWei: bigint;
}

export type WalletTransferIntentDetails = Pick<
  WalletTransferIntent,
  "asset" | "destination" | "amountWei"
>;

export interface WalletTransferIntentLease {
  id: string;
  intent: WalletTransferIntent;
  nonce: number;
}

export type WalletTransferIntentAcquisition =
  | { status: "acquired"; lease: WalletTransferIntentLease }
  | { status: "known-hash"; hash: `0x${string}` };

type WalletTransferIntentState = {
  id: string;
  actor: `0x${string}`;
  chainId: number;
  asset: WalletTransferAsset;
  destination: `0x${string}`;
  amountWei: string;
  nonce: number;
  latestNonce: number;
  pendingNonce: number;
  hash?: `0x${string}`;
  replacementKnownHash?: `0x${string}`;
  transactionType?: WalletTransferTransactionType;
  broadcastObserved: boolean;
  createdAt: number;
  updatedAt: number;
};

type WalletTransferTransactionType = "legacy" | "eip2930" | "eip1559";

type WalletTransferReplacementObservationState = {
  id: string;
  knownHash: `0x${string}`;
  candidateHash: `0x${string}`;
  transactionType: WalletTransferTransactionType;
  nonce: number;
  observedAt: number;
};

export type WalletTransferNonceClient = {
  getTransactionCount: (args: {
    address: `0x${string}`;
    blockTag: "latest" | "pending";
  }) => Promise<number>;
  getTransaction?: (args: { hash: `0x${string}` }) => Promise<unknown>;
};

export type WalletTransferNonceClients = readonly [
  WalletTransferNonceClient,
  WalletTransferNonceClient,
];

type WalletTransferReceipt = {
  status: "success" | "reverted";
  transactionHash: `0x${string}`;
  blockHash: `0x${string}`;
  blockNumber: bigint;
  transactionIndex: number;
};

type WalletTransferReplacement = {
  reason: "cancelled" | "replaced" | "repriced";
  replacedTransaction: unknown;
  transaction: unknown;
  transactionReceipt: WalletTransferReceipt;
};

type WalletTransferTransactionClient = {
  getTransaction: (args: { hash: `0x${string}` }) => Promise<unknown>;
};

type WalletTransferTransactionClients = readonly [
  WalletTransferTransactionClient,
  WalletTransferTransactionClient,
];

export type WalletTransferReceiptClient = WalletTransferTransactionClient & {
  waitForTransactionReceipt: (args: {
    hash: `0x${string}`;
    timeout: number;
    confirmations: number;
    onReplaced?: (replacement: WalletTransferReplacement) => void;
  }) => Promise<WalletTransferReceipt>;
  getTransactionReceipt: (args: {
    hash: `0x${string}`;
  }) => Promise<WalletTransferReceipt>;
  getBlockNumber: () => Promise<bigint>;
};

export type WalletTransferReceiptClients = readonly [
  WalletTransferReceiptClient,
  WalletTransferReceiptClient,
];

const STORAGE_PREFIX = "lineaore:wallet-transfer-intent:v1";
const REPLACEMENT_OBSERVATION_SUFFIX = "replacement-observation";
const MAX_FUTURE_SKEW_MS = 5_000;
export const HASHLESS_TRANSFER_RECONCILIATION_GRACE_MS = 15 * 60_000;
export const WALLET_TRANSFER_FINALITY_CONFIRMATIONS = 2;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const LEASE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export class WalletTransferIntentError extends Error {
  transactionHash?: `0x${string}`;

  constructor(message: string, transactionHash?: `0x${string}`) {
    super(message);
    this.name = "WalletTransferIntentError";
    this.transactionHash = transactionHash;
  }
}

export class WalletTransactionRevertedError extends Error {
  readonly transactionHash: `0x${string}`;

  constructor(hash: `0x${string}`) {
    super(`Transaction reverted: ${hash}`);
    this.name = "WalletTransactionRevertedError";
    this.transactionHash = hash;
  }
}

export function isWalletTransferIntentError(error: unknown): error is WalletTransferIntentError {
  return error instanceof Error && error.name === "WalletTransferIntentError";
}

export function getWalletTransferIntentErrorHash(error: unknown): `0x${string}` | null {
  if (!isWalletTransferIntentError(error)) return null;
  return error.transactionHash && HASH_RE.test(error.transactionHash)
    ? error.transactionHash.toLowerCase() as `0x${string}`
    : null;
}

function intentError(message: string, transactionHash?: `0x${string}`) {
  return new WalletTransferIntentError(message, transactionHash);
}

function normalizeAddress(value: string): `0x${string}` {
  return getAddress(value).toLowerCase() as `0x${string}`;
}

function normalizeAsset(value: WalletTransferAsset): WalletTransferAsset {
  return value === "native" ? value : normalizeAddress(value);
}

function normalizeSafeNonce(value: unknown): number | null {
  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(value);
  }
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function normalizeTimestamp(value: unknown, now: number): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return null;
  if (!Number.isSafeInteger(now) || now <= 0 || value - now > MAX_FUTURE_SKEW_MS) return null;
  return value;
}

function normalizeHash(value: unknown): `0x${string}` | null {
  return typeof value === "string" && HASH_RE.test(value)
    ? value.toLowerCase() as `0x${string}`
    : null;
}

function normalizeTransactionType(value: unknown): WalletTransferTransactionType | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return normalized === "legacy" || normalized === "eip2930" || normalized === "eip1559"
    ? normalized
    : null;
}

export function createWalletTransferIntent(input: {
  actor: string;
  chainId: number;
  asset: WalletTransferAsset;
  destination: string;
  amountWei: bigint;
}): WalletTransferIntent {
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) {
    throw intentError("wallet_transfer_intent_invalid_chain");
  }
  if (input.amountWei <= 0n) {
    throw intentError("wallet_transfer_intent_invalid_amount");
  }
  return {
    actor: normalizeAddress(input.actor),
    chainId: input.chainId,
    asset: normalizeAsset(input.asset),
    destination: normalizeAddress(input.destination),
    amountWei: input.amountWei,
  };
}

export function assertWalletTransferIntentMatchesTransaction(
  intent: WalletTransferIntent,
  tx: {
    to: `0x${string}`;
    data?: `0x${string}`;
    value?: bigint;
  },
) {
  const normalizedTo = normalizeAddress(tx.to);
  if (intent.asset === "native") {
    if (
      normalizedTo !== intent.destination ||
      tx.data !== undefined ||
      tx.value !== intent.amountWei
    ) {
      throw intentError("wallet_transfer_intent_transaction_mismatch");
    }
    return;
  }

  const expectedData = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [intent.destination, intent.amountWei],
  }).toLowerCase();
  if (
    normalizedTo !== intent.asset ||
    (tx.value !== undefined && tx.value !== 0n) ||
    tx.data?.toLowerCase() !== expectedData
  ) {
    throw intentError("wallet_transfer_intent_transaction_mismatch");
  }
}

export function selectWalletTransferAgreementRpcUrls(
  urls: readonly string[],
): readonly [string, string] {
  const selected: string[] = [];
  const hosts = new Set<string>();
  for (const raw of urls) {
    const endpoint = raw.trim();
    let parsed: URL;
    try {
      parsed = new URL(endpoint);
    } catch {
      throw intentError("wallet_transfer_intent_rpc_url_invalid");
    }
    const hasUserInfo = /^[a-z][a-z\d+.-]*:[\\/]*[^/?#\\]*@/i.test(endpoint);
    if (
      !/^https?:$/.test(parsed.protocol) ||
      hasUserInfo ||
      parsed.username ||
      parsed.password
    ) {
      throw intentError("wallet_transfer_intent_rpc_url_invalid");
    }
    parsed.hash = "";
    const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, "");
    if (!hostname) {
      throw intentError("wallet_transfer_intent_rpc_url_invalid");
    }
    if (hosts.has(hostname)) continue;
    hosts.add(hostname);
    selected.push(parsed.toString());
    if (selected.length === 2) return [selected[0], selected[1]];
  }
  throw intentError("wallet_transfer_intent_independent_rpc_required");
}

function intentKeySuffix(intent: WalletTransferIntent) {
  return [
    intent.chainId,
    intent.actor,
    intent.asset,
    intent.destination,
    intent.amountWei.toString(),
  ].join(":");
}

function storageKey(intent: WalletTransferIntent) {
  return `${STORAGE_PREFIX}:${intentKeySuffix(intent)}`;
}

function replacementObservationKey(intent: WalletTransferIntent, rpcIndex: 0 | 1) {
  return `${storageKey(intent)}:${REPLACEMENT_OBSERVATION_SUFFIX}:${rpcIndex}`;
}

function getStorage(): Storage {
  if (typeof window === "undefined") {
    throw intentError("wallet_transfer_intent_storage_unavailable");
  }
  try {
    return window.localStorage;
  } catch {
    throw intentError("wallet_transfer_intent_storage_unavailable");
  }
}

function sanitizeState(value: unknown, now: number): WalletTransferIntentState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !LEASE_ID_RE.test(raw.id)) return null;
  if (!Number.isSafeInteger(raw.chainId) || Number(raw.chainId) <= 0) return null;
  if (raw.asset !== "native" && typeof raw.asset !== "string") return null;
  if (typeof raw.amountWei !== "string" || !/^[1-9]\d*$/.test(raw.amountWei)) return null;

  let actor: `0x${string}`;
  let destination: `0x${string}`;
  let asset: WalletTransferAsset;
  try {
    actor = normalizeAddress(typeof raw.actor === "string" ? raw.actor : "");
    destination = normalizeAddress(typeof raw.destination === "string" ? raw.destination : "");
    asset = normalizeAsset(raw.asset as WalletTransferAsset);
  } catch {
    return null;
  }

  const nonce = normalizeSafeNonce(raw.nonce);
  const latestNonce = normalizeSafeNonce(raw.latestNonce);
  const pendingNonce = normalizeSafeNonce(raw.pendingNonce);
  if (
    nonce === null ||
    latestNonce === null ||
    pendingNonce === null ||
    pendingNonce < latestNonce ||
    nonce !== pendingNonce
  ) {
    return null;
  }
  const createdAt = normalizeTimestamp(raw.createdAt, now);
  const updatedAt = normalizeTimestamp(raw.updatedAt, now);
  if (createdAt === null || updatedAt === null || updatedAt < createdAt) return null;
  const hash = raw.hash === undefined ? null : normalizeHash(raw.hash);
  if (raw.hash !== undefined && !hash) return null;
  const replacementKnownHash = raw.replacementKnownHash === undefined
    ? null
    : normalizeHash(raw.replacementKnownHash);
  if (
    (raw.replacementKnownHash !== undefined && !replacementKnownHash) ||
    (replacementKnownHash && (!hash || replacementKnownHash === hash))
  ) {
    return null;
  }
  const transactionType = raw.transactionType === undefined
    ? null
    : normalizeTransactionType(raw.transactionType);
  if (raw.transactionType !== undefined && !transactionType) return null;
  const broadcastObserved = raw.broadcastObserved === true || hash !== null;

  return {
    id: raw.id,
    actor,
    chainId: Number(raw.chainId),
    asset,
    destination,
    amountWei: raw.amountWei,
    nonce,
    latestNonce,
    pendingNonce,
    ...(hash ? { hash } : {}),
    ...(replacementKnownHash ? { replacementKnownHash } : {}),
    ...(transactionType ? { transactionType } : {}),
    broadcastObserved,
    createdAt,
    updatedAt,
  };
}

function stateMatchesIntent(state: WalletTransferIntentState, intent: WalletTransferIntent) {
  return (
    state.actor === intent.actor &&
    state.chainId === intent.chainId &&
    state.asset === intent.asset &&
    state.destination === intent.destination &&
    state.amountWei === intent.amountWei.toString()
  );
}

function readState(intent: WalletTransferIntent, now: number): WalletTransferIntentState | null {
  const storage = getStorage();
  let raw: string | null;
  try {
    raw = storage.getItem(storageKey(intent));
  } catch {
    throw intentError("wallet_transfer_intent_storage_read_failed");
  }
  if (!raw) return null;
  try {
    const state = sanitizeState(JSON.parse(raw), now);
    if (!state || !stateMatchesIntent(state, intent)) {
      throw intentError("wallet_transfer_intent_state_invalid");
    }
    return state;
  } catch (error) {
    if (isWalletTransferIntentError(error)) throw error;
    throw intentError("wallet_transfer_intent_state_invalid");
  }
}

export function hasTrackedWalletTransferNonce(
  chainId: number,
  actor: string,
  nonce: number,
  now = Date.now(),
): boolean {
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || normalizeSafeNonce(nonce) === null) {
    throw intentError("wallet_transfer_intent_invalid");
  }
  const normalizedActor = normalizeAddress(actor);
  const storage = getStorage();
  const actorKeyPrefix = `${STORAGE_PREFIX}:${chainId}:${normalizedActor}:`;
  let actorKeys: string[];
  try {
    actorKeys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((key): key is string =>
        key !== null &&
        key.startsWith(actorKeyPrefix) &&
        !key.includes(`:${REPLACEMENT_OBSERVATION_SUFFIX}:`)
      );
  } catch {
    throw intentError("wallet_transfer_intent_storage_read_failed");
  }

  for (const key of actorKeys) {
    let raw: string | null;
    try {
      raw = storage.getItem(key);
    } catch {
      throw intentError("wallet_transfer_intent_storage_read_failed");
    }
    if (raw === null) continue;
    try {
      const state = sanitizeState(JSON.parse(raw), now);
      const canonicalKey = state
        ? `${STORAGE_PREFIX}:${state.chainId}:${state.actor}:${state.asset}:${state.destination}:${state.amountWei}`
        : null;
      if (!state || canonicalKey !== key) {
        throw intentError("wallet_transfer_intent_state_invalid");
      }
      if (state.nonce === nonce) return true;
    } catch (error) {
      if (isWalletTransferIntentError(error)) throw error;
      throw intentError("wallet_transfer_intent_state_invalid");
    }
  }
  return false;
}

function assertNoConflictingActorState(intent: WalletTransferIntent, now: number) {
  const storage = getStorage();
  const exactKey = storageKey(intent);
  const actorKeyPrefix = `${STORAGE_PREFIX}:${intent.chainId}:${intent.actor}:`;
  let actorKeys: string[];
  try {
    actorKeys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((key): key is string =>
        key !== null &&
        key.startsWith(actorKeyPrefix) &&
        !key.includes(`:${REPLACEMENT_OBSERVATION_SUFFIX}:`)
      );
  } catch {
    throw intentError("wallet_transfer_intent_storage_read_failed");
  }

  for (const key of actorKeys) {
    if (key === exactKey) continue;
    let raw: string | null;
    try {
      raw = storage.getItem(key);
    } catch {
      throw intentError("wallet_transfer_intent_storage_read_failed");
    }
    if (raw === null) continue;

    try {
      const state = sanitizeState(JSON.parse(raw), now);
      const canonicalKey = state
        ? `${STORAGE_PREFIX}:${state.chainId}:${state.actor}:${state.asset}:${state.destination}:${state.amountWei}`
        : null;
      if (!state || canonicalKey !== key) {
        throw intentError("wallet_transfer_intent_state_invalid");
      }
    } catch (error) {
      if (isWalletTransferIntentError(error)) throw error;
      throw intentError("wallet_transfer_intent_state_invalid");
    }
    throw intentError("wallet_transfer_actor_unresolved");
  }
}

function writeState(intent: WalletTransferIntent, state: WalletTransferIntentState, now: number) {
  const storage = getStorage();
  try {
    storage.setItem(storageKey(intent), JSON.stringify(state));
  } catch {
    throw intentError("wallet_transfer_intent_storage_write_failed", state.hash);
  }
  const persisted = readState(intent, now);
  if (
    !persisted ||
    persisted.id !== state.id ||
    persisted.hash !== state.hash ||
    persisted.replacementKnownHash !== state.replacementKnownHash ||
    persisted.transactionType !== state.transactionType
  ) {
    throw intentError("wallet_transfer_intent_storage_verification_failed", state.hash);
  }
}

function clearReplacementObservations(intent: WalletTransferIntent) {
  const storage = getStorage();
  try {
    for (const rpcIndex of [0, 1] as const) {
      const key = replacementObservationKey(intent, rpcIndex);
      storage.removeItem(key);
      if (storage.getItem(key) !== null) {
        throw intentError("wallet_transfer_replacement_storage_clear_failed");
      }
    }
  } catch (error) {
    if (isWalletTransferIntentError(error)) throw error;
    throw intentError("wallet_transfer_replacement_storage_clear_failed");
  }
}

function removeState(intent: WalletTransferIntent) {
  const storage = getStorage();
  try {
    clearReplacementObservations(intent);
    storage.removeItem(storageKey(intent));
    if (storage.getItem(storageKey(intent)) !== null) {
      throw intentError("wallet_transfer_intent_storage_clear_failed");
    }
  } catch (error) {
    if (isWalletTransferIntentError(error)) throw error;
    throw intentError("wallet_transfer_intent_storage_clear_failed");
  }
}

async function withIntentLock<T>(
  intent: WalletTransferIntent,
  ifAvailable: boolean,
  callback: () => Promise<T>,
): Promise<T> {
  const errorFactory = (reason: EoaNonceLockFailure) => intentError(
    reason === "unavailable"
      ? "wallet_transfer_intent_web_lock_unavailable"
      : reason === "contended"
        ? "wallet_transfer_intent_locked"
        : "wallet_transfer_intent_invalid",
  );
  return withEoaNonceLock(
    { chainId: intent.chainId, actor: intent.actor },
    { ifAvailable, errorFactory },
    callback,
  );
}

async function readNonceSnapshot(
  clients: WalletTransferNonceClients,
  actor: `0x${string}`,
): Promise<{ latestNonce: number; pendingNonce: number }> {
  const readClient = async (client: WalletTransferNonceClient) => {
    let latestRaw: unknown;
    let pendingRaw: unknown;
    try {
      [latestRaw, pendingRaw] = await Promise.all([
        client.getTransactionCount({ address: actor, blockTag: "latest" }),
        client.getTransactionCount({ address: actor, blockTag: "pending" }),
      ]);
    } catch {
      throw intentError("wallet_transfer_intent_nonce_reconciliation_unavailable");
    }
    const latestNonce = normalizeSafeNonce(latestRaw);
    const pendingNonce = normalizeSafeNonce(pendingRaw);
    if (latestNonce === null || pendingNonce === null || pendingNonce < latestNonce) {
      throw intentError("wallet_transfer_intent_nonce_reconciliation_unsafe");
    }
    return { latestNonce, pendingNonce };
  };

  const [first, second] = await Promise.all([
    readClient(clients[0]),
    readClient(clients[1]),
  ]);
  if (
    first.latestNonce !== second.latestNonce ||
    first.pendingNonce !== second.pendingNonce
  ) {
    throw intentError("wallet_transfer_intent_nonce_rpc_disagreement");
  }
  return first;
}

function canSafelyRetryIntent(
  state: WalletTransferIntentState,
  snapshot: { latestNonce: number; pendingNonce: number },
  now: number,
) {
  const reconciliationStartedAt = state.hash ? state.updatedAt : state.createdAt;
  return (
    now - reconciliationStartedAt >= HASHLESS_TRANSFER_RECONCILIATION_GRACE_MS &&
    snapshot.latestNonce === state.latestNonce &&
    snapshot.pendingNonce === state.pendingNonce
  );
}

function createLeaseId() {
  const id = globalThis.crypto?.randomUUID?.();
  if (!id || !LEASE_ID_RE.test(id)) {
    throw intentError("wallet_transfer_intent_secure_id_unavailable");
  }
  return id;
}

async function acquireWalletTransferIntentLeaseLocked(
  intent: WalletTransferIntent,
  clients: WalletTransferNonceClients,
  now: number,
): Promise<WalletTransferIntentAcquisition> {
  assertNoConflictingActorState(intent, now);
  const existing = readState(intent, now);
  if (
    existing?.hash &&
    now - existing.updatedAt < HASHLESS_TRANSFER_RECONCILIATION_GRACE_MS
  ) {
    return { status: "known-hash", hash: existing.hash };
  }

  let snapshot: { latestNonce: number; pendingNonce: number };
  try {
    snapshot = await readNonceSnapshot(clients, intent.actor);
  } catch (error) {
    if (existing?.hash) return { status: "known-hash", hash: existing.hash };
    throw error;
  }
  if (existing) {
    if (!canSafelyRetryIntent(existing, snapshot, now)) {
      if (existing.hash) return { status: "known-hash", hash: existing.hash };
      throw intentError("wallet_transfer_intent_unresolved");
    }
    const retryableState = { ...existing };
    delete retryableState.hash;
    delete retryableState.replacementKnownHash;
    delete retryableState.transactionType;
    clearReplacementObservations(intent);
    const reconciledState = {
      ...retryableState,
      createdAt: now,
      updatedAt: now,
    };
    writeState(intent, reconciledState, now);
    return {
      status: "acquired",
      lease: {
        id: reconciledState.id,
        intent,
        nonce: reconciledState.nonce,
      },
    };
  }

  const id = createLeaseId();
  const state: WalletTransferIntentState = {
    id,
    actor: intent.actor,
    chainId: intent.chainId,
    asset: intent.asset,
    destination: intent.destination,
    amountWei: intent.amountWei.toString(),
    nonce: snapshot.pendingNonce,
    latestNonce: snapshot.latestNonce,
    pendingNonce: snapshot.pendingNonce,
    broadcastObserved: false,
    createdAt: now,
    updatedAt: now,
  };
  writeState(intent, state, now);
  return {
    status: "acquired",
    lease: { id, intent, nonce: state.nonce },
  };
}

function normalizeAcquisitionInput(input: WalletTransferIntent, now: number) {
  const intent = createWalletTransferIntent(input);
  if (!Number.isSafeInteger(now) || now <= 0) {
    throw intentError("wallet_transfer_intent_invalid_time");
  }
  return intent;
}

export async function acquireWalletTransferIntentLease(
  input: WalletTransferIntent,
  clients: WalletTransferNonceClients,
  now = Date.now(),
): Promise<WalletTransferIntentAcquisition> {
  const intent = normalizeAcquisitionInput(input, now);
  return withIntentLock(
    intent,
    true,
    () => acquireWalletTransferIntentLeaseLocked(intent, clients, now),
  );
}

export async function withWalletTransferIntentLease<T>(
  input: WalletTransferIntent,
  clients: WalletTransferNonceClients,
  callback: (
    acquisition: WalletTransferIntentAcquisition,
    retainResult: typeof retainWalletTransferSendResult,
  ) => Promise<T>,
  options?: {
    abandonOnError?: (error: unknown) => boolean;
  },
  now = Date.now(),
): Promise<T> {
  const intent = normalizeAcquisitionInput(input, now);
  return withIntentLock(intent, true, async () => {
    const acquisition = await acquireWalletTransferIntentLeaseLocked(intent, clients, now);
    let lockHeld = true;
    const retainWhileLocked: typeof retainWalletTransferSendResult = (promise, lease) =>
      retainWalletTransferSendResult(promise, lease, async (retainedLease, hash) => {
        const transactionClients = getWalletTransferTransactionClients(clients);
        if (lockHeld) {
          recordWalletTransferIntentHashLocked(
            retainedLease.intent,
            retainedLease.id,
            hash,
            Date.now(),
          );
          if (transactionClients) {
            await persistCanonicalWalletTransferTypeLocked(
              transactionClients,
              retainedLease.intent,
              hash,
              Date.now(),
            );
          }
        } else {
          await recordWalletTransferIntentHash(
            retainedLease.intent,
            retainedLease.id,
            hash,
          );
          if (transactionClients) {
            await persistCanonicalWalletTransferType(
              transactionClients,
              retainedLease.intent,
              hash,
              Date.now(),
            );
          }
        }
      });
    try {
      return await callback(acquisition, retainWhileLocked);
    } catch (error) {
      if (
        acquisition.status === "acquired" &&
        options?.abandonOnError?.(error) === true
      ) {
        const current = readState(intent, Math.max(now, Date.now()));
        if (current?.id === acquisition.lease.id && !current.hash) {
          if (current.broadcastObserved) {
            throw intentError("wallet_transfer_intent_rejection_unresolved");
          }
          let rejectionSnapshot: { latestNonce: number; pendingNonce: number };
          try {
            rejectionSnapshot = await readNonceSnapshot(clients, intent.actor);
          } catch {
            throw intentError("wallet_transfer_intent_rejection_unresolved");
          }
          if (
            rejectionSnapshot.latestNonce !== current.latestNonce ||
            rejectionSnapshot.pendingNonce !== current.pendingNonce
          ) {
            throw intentError("wallet_transfer_intent_rejection_unresolved");
          }
          removeState(intent);
        }
      }
      throw error;
    } finally {
      lockHeld = false;
    }
  });
}

function recordWalletTransferIntentHashLocked(
  intent: WalletTransferIntent,
  leaseId: string,
  hash: `0x${string}`,
  now: number,
) {
  const current = readState(intent, now);
  if (!current || current.id !== leaseId) {
    throw intentError("wallet_transfer_intent_lease_changed", hash);
  }
  clearReplacementObservations(intent);
  const next = { ...current, hash, broadcastObserved: true, updatedAt: now };
  delete next.replacementKnownHash;
  delete next.transactionType;
  writeState(intent, next, now);
}

export async function recordWalletTransferIntentHash(
  input: WalletTransferIntent,
  leaseId: string,
  hashValue: unknown,
  now = Date.now(),
): Promise<`0x${string}`> {
  const intent = createWalletTransferIntent(input);
  const hash = normalizeHash(hashValue);
  if (!hash) throw intentError("wallet_transfer_intent_invalid_hash");
  if (!Number.isSafeInteger(now) || now <= 0) {
    throw intentError("wallet_transfer_intent_invalid_time", hash);
  }

  return withIntentLock(intent, false, async () => {
    recordWalletTransferIntentHashLocked(intent, leaseId, hash, now);
    return hash;
  });
}

export function retainWalletTransferSendResult<T extends { hash?: unknown }>(
  promise: Promise<T>,
  lease: WalletTransferIntentLease,
  recordHash: (
    lease: WalletTransferIntentLease,
    hash: `0x${string}`,
  ) => Promise<unknown> | unknown = (retainedLease, hash) =>
    recordWalletTransferIntentHash(retainedLease.intent, retainedLease.id, hash),
): Promise<T> {
  return promise.then(async (result) => {
    const hash = normalizeHash(result.hash);
    if (!hash) throw intentError("wallet_transfer_intent_invalid_hash");
    await recordHash(lease, hash);
    return result;
  });
}

function isReceiptNotFoundLikeError(error: unknown) {
  const name = error instanceof Error ? error.name.toLowerCase() : "";
  const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  return (
    name.includes("transactionreceiptnotfound") ||
    message.includes("transaction receipt not found") ||
    message.includes("receipt not found") ||
    message.includes("transaction not found") ||
    message.includes("not found")
  );
}

function isReceiptTimeoutLikeError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  return (
    name === "TimeoutError" ||
    name === "TransactionReceiptNotFoundError" ||
    name === "TransactionReceiptTimeoutError" ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("receipt could not be found")
  );
}

function isTransactionLookupMissingError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  return (
    name === "TransactionNotFoundError" ||
    message.includes("transaction not found") ||
    message.includes("transaction could not be found")
  );
}

function receiptFingerprint(receipt: WalletTransferReceipt, hash: `0x${string}`) {
  const transactionHash = normalizeHash(receipt.transactionHash);
  const blockHash = normalizeHash(receipt.blockHash);
  const transactionIndex = normalizeSafeNonce(receipt.transactionIndex);
  if (
    transactionHash !== hash ||
    !blockHash ||
    typeof receipt.blockNumber !== "bigint" ||
    receipt.blockNumber < 0n ||
    transactionIndex === null
  ) {
    throw intentError("wallet_transfer_receipt_identity_invalid", hash);
  }
  return [
    receipt.status,
    transactionHash,
    blockHash,
    receipt.blockNumber.toString(),
    transactionIndex.toString(),
  ].join(":");
}

async function readWalletTransferReceipt(
  client: WalletTransferReceiptClient,
  hash: `0x${string}`,
): Promise<WalletTransferReceipt | null> {
  try {
    return await client.getTransactionReceipt({ hash });
  } catch (error) {
    if (isReceiptNotFoundLikeError(error)) return null;
    throw error;
  }
}

async function readWalletTransferReceiptQuorum(
  clients: WalletTransferReceiptClients,
  hash: `0x${string}`,
): Promise<WalletTransferReceipt | null> {
  const reads = await Promise.allSettled([
    readWalletTransferReceipt(clients[0], hash),
    readWalletTransferReceipt(clients[1], hash),
  ]);
  if (reads[0].status === "rejected" || reads[1].status === "rejected") {
    throw intentError("wallet_transfer_receipt_quorum_unavailable", hash);
  }
  const first = reads[0].value;
  const second = reads[1].value;
  if (!first && !second) return null;
  if (!first || !second) {
    throw intentError("wallet_transfer_receipt_diverged", hash);
  }
  if (receiptFingerprint(first, hash) !== receiptFingerprint(second, hash)) {
    throw intentError("wallet_transfer_receipt_diverged", hash);
  }
  return first;
}

async function assertWalletTransferReceiptFinality(
  clients: WalletTransferReceiptClients,
  hash: `0x${string}`,
  expected?: WalletTransferReceipt,
): Promise<WalletTransferReceipt> {
  const first = await readWalletTransferReceiptQuorum(clients, hash);
  if (!first) {
    throw intentError(
      expected
        ? "wallet_transfer_receipt_diverged"
        : "wallet_transfer_receipt_finality_unavailable",
      hash,
    );
  }
  const firstFingerprint = receiptFingerprint(first, hash);
  if (expected && firstFingerprint !== receiptFingerprint(expected, hash)) {
    throw intentError("wallet_transfer_receipt_diverged", hash);
  }

  const headReads = await Promise.allSettled([
    clients[0].getBlockNumber(),
    clients[1].getBlockNumber(),
  ]);
  if (headReads[0].status === "rejected" || headReads[1].status === "rejected") {
    throw intentError("wallet_transfer_receipt_quorum_unavailable", hash);
  }
  const requiredHead = first.blockNumber + BigInt(WALLET_TRANSFER_FINALITY_CONFIRMATIONS - 1);
  if (
    typeof headReads[0].value !== "bigint" ||
    typeof headReads[1].value !== "bigint" ||
    headReads[0].value < requiredHead ||
    headReads[1].value < requiredHead
  ) {
    throw intentError("wallet_transfer_receipt_finality_insufficient", hash);
  }

  // Re-read after the head observations so a receipt reorg cannot race intent cleanup.
  const canonical = await readWalletTransferReceiptQuorum(clients, hash);
  if (!canonical || receiptFingerprint(canonical, hash) !== firstFingerprint) {
    throw intentError("wallet_transfer_receipt_diverged", hash);
  }
  return canonical;
}

async function assertStableWalletTransferReceipt(
  clients: WalletTransferReceiptClients,
  hash: `0x${string}`,
  first: WalletTransferReceipt,
): Promise<"confirmed"> {
  const second = await assertWalletTransferReceiptFinality(clients, hash, first);
  if (second.status === "reverted") {
    throw new WalletTransactionRevertedError(hash);
  }
  return "confirmed";
}

function assertReceiptObservationsMatch(
  receipts: readonly WalletTransferReceipt[],
  expected: WalletTransferReceipt,
  hash: `0x${string}`,
) {
  const expectedFingerprint = receiptFingerprint(expected, hash);
  for (const receipt of receipts) {
    if (receiptFingerprint(receipt, hash) !== expectedFingerprint) {
      throw intentError("wallet_transfer_receipt_diverged", hash);
    }
  }
}

function getTransactionHash(value: unknown): `0x${string}` | null {
  if (!value || typeof value !== "object" || !("hash" in value)) return null;
  return normalizeHash((value as { hash?: unknown }).hash);
}

type NormalizedWalletTransferTransaction = {
  hash: `0x${string}`;
  chainId: number;
  from: `0x${string}`;
  nonce: number;
  to: `0x${string}`;
  value: bigint;
  input: `0x${string}`;
  type: WalletTransferTransactionType;
};

function normalizeWalletTransferTransaction(
  value: unknown,
  expectedHash: `0x${string}`,
): NormalizedWalletTransferTransaction {
  if (!value || typeof value !== "object") {
    throw intentError("wallet_transfer_transaction_identity_invalid", expectedHash);
  }
  const raw = value as Record<string, unknown>;
  const hash = normalizeHash(raw.hash);
  const chainId = normalizeSafeNonce(raw.chainId);
  const nonce = normalizeSafeNonce(raw.nonce);
  const input = typeof raw.input === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(raw.input)
    ? raw.input.toLowerCase() as `0x${string}`
    : null;
  const type = typeof raw.type === "string" ? raw.type.toLowerCase() : null;
  let from: `0x${string}`;
  let to: `0x${string}`;
  try {
    from = normalizeAddress(typeof raw.from === "string" ? raw.from : "");
    to = normalizeAddress(typeof raw.to === "string" ? raw.to : "");
  } catch {
    throw intentError("wallet_transfer_transaction_identity_invalid", expectedHash);
  }
  if (
    !hash ||
    chainId === null ||
    chainId <= 0 ||
    nonce === null ||
    typeof raw.value !== "bigint" ||
    raw.value < 0n ||
    !input ||
    (type !== "legacy" && type !== "eip2930" && type !== "eip1559")
  ) {
    throw intentError("wallet_transfer_transaction_identity_invalid", expectedHash);
  }
  return { hash, chainId, from, nonce, to, value: raw.value, input, type };
}

function walletTransferTransactionFingerprint(transaction: NormalizedWalletTransferTransaction) {
  return [
    transaction.hash,
    transaction.chainId.toString(),
    transaction.from,
    transaction.nonce.toString(),
    transaction.to,
    transaction.value.toString(),
    transaction.input,
    transaction.type,
  ].join(":");
}

function walletTransferTransactionPayloadFingerprint(
  transaction: NormalizedWalletTransferTransaction,
) {
  return [
    transaction.chainId.toString(),
    transaction.from,
    transaction.nonce.toString(),
    transaction.to,
    transaction.value.toString(),
    transaction.input,
    transaction.type,
  ].join(":");
}

function assertWalletTransferTransactionMatchesIntent(
  transaction: NormalizedWalletTransferTransaction,
  intent: WalletTransferIntent,
  hash: `0x${string}`,
  nonce: number,
) {
  const expectedTo = intent.asset === "native" ? intent.destination : intent.asset;
  const expectedValue = intent.asset === "native" ? intent.amountWei : 0n;
  const expectedInput = intent.asset === "native"
    ? "0x"
    : encodeFunctionData({
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [intent.destination, intent.amountWei],
      }).toLowerCase();
  if (
    transaction.hash !== hash ||
    transaction.chainId !== intent.chainId ||
    transaction.from !== intent.actor ||
    transaction.nonce !== nonce ||
    transaction.to !== expectedTo ||
    transaction.value !== expectedValue ||
    transaction.input !== expectedInput
  ) {
    throw intentError("wallet_transfer_transaction_intent_mismatch", hash);
  }
}

function getWalletTransferTransactionClients(
  clients: WalletTransferNonceClients,
): WalletTransferTransactionClients | null {
  if (
    typeof clients[0].getTransaction !== "function" ||
    typeof clients[1].getTransaction !== "function"
  ) {
    return null;
  }
  return [
    { getTransaction: clients[0].getTransaction.bind(clients[0]) },
    { getTransaction: clients[1].getTransaction.bind(clients[1]) },
  ];
}

async function readWalletTransferTransactionQuorum(
  clients: WalletTransferTransactionClients,
  hash: `0x${string}`,
) {
  const reads = await Promise.allSettled([
    clients[0].getTransaction({ hash }),
    clients[1].getTransaction({ hash }),
  ]);
  const missing = reads.map((read) =>
    read.status === "rejected" && isTransactionLookupMissingError(read.reason)
  );
  if (missing[0] && missing[1]) {
    throw intentError("wallet_transfer_transaction_missing_manual_reconciliation", hash);
  }
  if (missing[0] || missing[1]) {
    throw intentError("wallet_transfer_transaction_diverged", hash);
  }
  if (reads[0].status === "rejected" || reads[1].status === "rejected") {
    throw intentError("wallet_transfer_transaction_quorum_unavailable", hash);
  }
  const first = normalizeWalletTransferTransaction(reads[0].value, hash);
  const second = normalizeWalletTransferTransaction(reads[1].value, hash);
  if (
    walletTransferTransactionFingerprint(first) !==
    walletTransferTransactionFingerprint(second)
  ) {
    throw intentError("wallet_transfer_transaction_diverged", hash);
  }
  return first;
}

async function assertWalletTransferTransactionQuorum(
  clients: WalletTransferTransactionClients,
  intent: WalletTransferIntent,
  hash: `0x${string}`,
  nonce: number,
) {
  const transaction = await readWalletTransferTransactionQuorum(clients, hash);
  assertWalletTransferTransactionMatchesIntent(transaction, intent, hash, nonce);
  return transaction;
}

function assertExactRepricedReplacementObservation(
  value: WalletTransferReplacement,
  intent: WalletTransferIntent,
  knownHash: `0x${string}`,
  nonce: number,
) {
  if (
    !value ||
    typeof value !== "object" ||
    value.reason !== "repriced"
  ) {
    throw intentError("wallet_transfer_replacement_manual_reconciliation", knownHash);
  }
  const replacementHash = getTransactionHash(value.transaction);
  if (!replacementHash || replacementHash === knownHash) {
    throw intentError("wallet_transfer_replacement_manual_reconciliation", knownHash);
  }
  const replacedTransaction = normalizeWalletTransferTransaction(
    value.replacedTransaction,
    knownHash,
  );
  const transaction = normalizeWalletTransferTransaction(value.transaction, replacementHash);
  receiptFingerprint(value.transactionReceipt, replacementHash);
  assertWalletTransferTransactionMatchesIntent(
    replacedTransaction,
    intent,
    knownHash,
    nonce,
  );
  assertWalletTransferTransactionMatchesIntent(
    transaction,
    intent,
    replacementHash,
    nonce,
  );
  if (
    walletTransferTransactionPayloadFingerprint(replacedTransaction) !==
    walletTransferTransactionPayloadFingerprint(transaction)
  ) {
    throw intentError("wallet_transfer_replacement_manual_reconciliation", knownHash);
  }
  return { hash: replacementHash, transactionType: transaction.type };
}

function sanitizeReplacementObservation(
  value: unknown,
  now: number,
): WalletTransferReplacementObservationState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const knownHash = normalizeHash(raw.knownHash);
  const candidateHash = normalizeHash(raw.candidateHash);
  const transactionType = normalizeTransactionType(raw.transactionType);
  const nonce = normalizeSafeNonce(raw.nonce);
  const observedAt = normalizeTimestamp(raw.observedAt, now);
  if (
    typeof raw.id !== "string" ||
    !LEASE_ID_RE.test(raw.id) ||
    !knownHash ||
    !candidateHash ||
    knownHash === candidateHash ||
    !transactionType ||
    nonce === null ||
    observedAt === null
  ) {
    return null;
  }
  return {
    id: raw.id,
    knownHash,
    candidateHash,
    transactionType,
    nonce,
    observedAt,
  };
}

function replacementObservationFingerprint(
  observation: WalletTransferReplacementObservationState,
) {
  return [
    observation.id,
    observation.knownHash,
    observation.candidateHash,
    observation.transactionType,
    observation.nonce.toString(),
  ].join(":");
}

function readReplacementObservation(
  intent: WalletTransferIntent,
  rpcIndex: 0 | 1,
  now: number,
): WalletTransferReplacementObservationState | null {
  const storage = getStorage();
  let raw: string | null;
  try {
    raw = storage.getItem(replacementObservationKey(intent, rpcIndex));
  } catch {
    throw intentError("wallet_transfer_replacement_storage_read_failed");
  }
  if (!raw) return null;
  try {
    const observation = sanitizeReplacementObservation(JSON.parse(raw), now);
    if (!observation) throw intentError("wallet_transfer_replacement_state_invalid");
    return observation;
  } catch (error) {
    if (isWalletTransferIntentError(error)) throw error;
    throw intentError("wallet_transfer_replacement_state_invalid");
  }
}

function writeReplacementObservation(
  intent: WalletTransferIntent,
  rpcIndex: 0 | 1,
  observation: WalletTransferReplacementObservationState,
  now: number,
) {
  const existing = readReplacementObservation(intent, rpcIndex, now);
  if (existing) {
    if (
      replacementObservationFingerprint(existing) !==
      replacementObservationFingerprint(observation)
    ) {
      throw intentError("wallet_transfer_replacement_rpc_disagreement", observation.knownHash);
    }
    return;
  }
  const storage = getStorage();
  try {
    storage.setItem(replacementObservationKey(intent, rpcIndex), JSON.stringify(observation));
  } catch {
    throw intentError("wallet_transfer_replacement_storage_write_failed", observation.knownHash);
  }
  const persisted = readReplacementObservation(intent, rpcIndex, now);
  if (
    !persisted ||
    replacementObservationFingerprint(persisted) !==
      replacementObservationFingerprint(observation)
  ) {
    throw intentError("wallet_transfer_replacement_storage_verification_failed", observation.knownHash);
  }
}

function recordReplacementObservation(
  intent: WalletTransferIntent,
  knownHash: `0x${string}`,
  rpcIndex: 0 | 1,
  value: WalletTransferReplacement,
  now: number,
) {
  const current = readState(intent, now);
  if (!current || current.hash !== knownHash) {
    throw intentError("wallet_transfer_replacement_manual_reconciliation", knownHash);
  }
  const replacement = assertExactRepricedReplacementObservation(
    value,
    intent,
    knownHash,
    current.nonce,
  );
  writeReplacementObservation(intent, rpcIndex, {
    id: current.id,
    knownHash,
    candidateHash: replacement.hash,
    transactionType: replacement.transactionType,
    nonce: current.nonce,
    observedAt: now,
  }, now);
}

function readReplacementObservations(
  intent: WalletTransferIntent,
  now: number,
): readonly [
  WalletTransferReplacementObservationState | null,
  WalletTransferReplacementObservationState | null,
] {
  return [
    readReplacementObservation(intent, 0, now),
    readReplacementObservation(intent, 1, now),
  ];
}

function assertReplacementObservationsMatchMigration(
  observations: readonly (WalletTransferReplacementObservationState | null)[],
  current: WalletTransferIntentState,
  knownHash: `0x${string}`,
  candidateHash: `0x${string}`,
  transactionType: WalletTransferTransactionType,
) {
  for (const observation of observations) {
    if (!observation) continue;
    if (
      observation.id !== current.id ||
      observation.knownHash !== knownHash ||
      observation.candidateHash !== candidateHash ||
      observation.transactionType !== transactionType ||
      observation.nonce !== current.nonce
    ) {
      throw intentError("wallet_transfer_replacement_rpc_disagreement", knownHash);
    }
  }
}

function recoverCommittedReplacementCleanup(
  intent: WalletTransferIntent,
  current: WalletTransferIntentState,
  observations: readonly (WalletTransferReplacementObservationState | null)[],
) {
  const present = observations.filter(
    (observation): observation is WalletTransferReplacementObservationState =>
      observation !== null,
  );
  if (present.length === 0) return false;
  if (!current.hash || !current.transactionType) return false;
  const committedKnownHash = current.replacementKnownHash ?? present[0].knownHash;
  if (present.every((observation) =>
    observation.id === current.id &&
    observation.knownHash === committedKnownHash &&
    observation.knownHash !== current.hash &&
    observation.candidateHash === current.hash &&
    observation.transactionType === current.transactionType &&
    observation.nonce === current.nonce
  )) {
    try {
      clearReplacementObservations(intent);
    } catch (error) {
      if (
        !isWalletTransferIntentError(error) ||
        error.message !== "wallet_transfer_replacement_storage_clear_failed"
      ) {
        throw error;
      }
      // The exact candidate is already the durable state. A failed best-effort
      // cleanup must not turn its old commit evidence into a reload wedge.
    }
    return true;
  }
  throw intentError("wallet_transfer_replacement_rpc_disagreement", current.hash);
}

type PersistedReplacementRecovery =
  | { status: "none" }
  | { status: "partial" }
  | { status: "recovered"; hash: `0x${string}` };

async function recoverPersistedReplacement(
  clients: WalletTransferReceiptClients,
  intent: WalletTransferIntent,
  knownHash: `0x${string}`,
  now: number,
): Promise<PersistedReplacementRecovery> {
  return withIntentLock(intent, false, async () => {
    const current = readState(intent, now);
    if (!current || !current.hash) {
      throw intentError("wallet_transfer_replacement_manual_reconciliation", knownHash);
    }
    const observations = readReplacementObservations(intent, now);
    if (current.hash !== knownHash) {
      if (current.replacementKnownHash === knownHash) {
        if (observations[0] || observations[1]) {
          recoverCommittedReplacementCleanup(intent, current, observations);
        }
        return { status: "recovered", hash: current.hash };
      }
      if (
        observations.some((observation) => observation !== null) &&
        recoverCommittedReplacementCleanup(intent, current, observations)
      ) {
        return { status: "recovered", hash: current.hash };
      }
      throw intentError("wallet_transfer_replacement_manual_reconciliation", knownHash);
    }
    if (!observations[0] && !observations[1]) return { status: "none" };
    if (
      observations.some(
        (observation) => observation !== null && observation.knownHash !== current.hash,
      ) &&
      recoverCommittedReplacementCleanup(intent, current, observations)
    ) {
      return { status: "none" };
    }
    if (!observations[0] || !observations[1]) return { status: "partial" };
    if (
      observations[0].id !== current.id ||
      observations[1].id !== current.id ||
      observations[0].knownHash !== knownHash ||
      observations[1].knownHash !== knownHash ||
      observations[0].nonce !== current.nonce ||
      observations[1].nonce !== current.nonce ||
      observations[0].candidateHash !== observations[1].candidateHash ||
      observations[0].transactionType !== observations[1].transactionType
    ) {
      throw intentError("wallet_transfer_replacement_rpc_disagreement", knownHash);
    }
    const replacement = await assertWalletTransferTransactionQuorum(
      clients,
      intent,
      observations[0].candidateHash,
      current.nonce,
    );
    if (
      replacement.type !== observations[0].transactionType ||
      (current.transactionType && current.transactionType !== replacement.type)
    ) {
      throw intentError("wallet_transfer_replacement_manual_reconciliation", knownHash);
    }
    writeState(
      intent,
      {
        ...current,
        replacementKnownHash: current.hash,
        hash: replacement.hash,
        transactionType: replacement.type,
        broadcastObserved: true,
        updatedAt: now,
      },
      now,
    );
    clearReplacementObservations(intent);
    return { status: "recovered", hash: replacement.hash };
  });
}

async function persistCanonicalWalletTransferTypeLocked(
  clients: WalletTransferTransactionClients,
  intent: WalletTransferIntent,
  hash: `0x${string}`,
  now: number,
) {
  const current = readState(intent, now);
  if (!current || current.hash !== hash) return;
  let transaction: NormalizedWalletTransferTransaction;
  try {
    transaction = await assertWalletTransferTransactionQuorum(
      clients,
      intent,
      hash,
      current.nonce,
    );
  } catch (error) {
    if (
      isWalletTransferIntentError(error) &&
      error.message === "wallet_transfer_transaction_missing_manual_reconciliation"
    ) {
      return;
    }
    throw error;
  }
  const verifiedCurrent = readState(intent, now);
  if (!verifiedCurrent || verifiedCurrent.id !== current.id || verifiedCurrent.hash !== hash) {
    throw intentError("wallet_transfer_replacement_manual_reconciliation", hash);
  }
  if (
    verifiedCurrent.transactionType &&
    verifiedCurrent.transactionType !== transaction.type
  ) {
    throw intentError("wallet_transfer_transaction_diverged", hash);
  }
  if (!verifiedCurrent.transactionType) {
    writeState(
      intent,
      { ...verifiedCurrent, transactionType: transaction.type, updatedAt: now },
      now,
    );
  }
}

async function persistCanonicalWalletTransferType(
  clients: WalletTransferTransactionClients,
  intent: WalletTransferIntent,
  hash: `0x${string}`,
  now: number,
) {
  await withIntentLock(intent, false, () =>
    persistCanonicalWalletTransferTypeLocked(clients, intent, hash, now)
  );
}

async function hasWalletTransferTransactionQuorum(
  clients: WalletTransferReceiptClients,
  hash: `0x${string}`,
) {
  const reads = await Promise.allSettled([
    clients[0].getTransaction({ hash }),
    clients[1].getTransaction({ hash }),
  ]);
  const normalized = reads.map((read) => {
    if (read.status === "fulfilled") return getTransactionHash(read.value);
    if (isTransactionLookupMissingError(read.reason)) return null;
    throw intentError("wallet_transfer_transaction_quorum_unavailable", hash);
  });
  if (normalized[0] === hash && normalized[1] === hash) return true;
  if (normalized[0] === null && normalized[1] === null) return false;
  throw intentError("wallet_transfer_transaction_diverged", hash);
}

export async function waitForStableWalletTransferReceipt(
  clients: WalletTransferReceiptClients,
  hashValue: unknown,
  timeout: number,
): Promise<"confirmed" | "pending"> {
  const hash = normalizeHash(hashValue);
  if (!hash) throw intentError("wallet_transfer_intent_invalid_hash");
  if (!Number.isSafeInteger(timeout) || timeout <= 0) {
    throw intentError("wallet_transfer_receipt_timeout_invalid", hash);
  }

  const waited = await Promise.allSettled([
    clients[0].waitForTransactionReceipt({
      hash,
      timeout,
      confirmations: WALLET_TRANSFER_FINALITY_CONFIRMATIONS,
    }),
    clients[1].waitForTransactionReceipt({
      hash,
      timeout,
      confirmations: WALLET_TRANSFER_FINALITY_CONFIRMATIONS,
    }),
  ]);
  const observedReceipts = waited.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : []
  );
  if (observedReceipts.length === 2) {
    assertReceiptObservationsMatch(observedReceipts, observedReceipts[0], hash);
    return assertStableWalletTransferReceipt(clients, hash, observedReceipts[0]);
  }

  const lateReceipt = await readWalletTransferReceiptQuorum(clients, hash);
  if (lateReceipt) {
    assertReceiptObservationsMatch(observedReceipts, lateReceipt, hash);
    return assertStableWalletTransferReceipt(clients, hash, lateReceipt);
  }

  if (observedReceipts.length > 0) {
    throw intentError("wallet_transfer_receipt_diverged", hash);
  }
  const waitErrors = waited.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : []
  );
  if (waitErrors.length === 2 && waitErrors.every(isReceiptTimeoutLikeError)) {
    if (await hasWalletTransferTransactionQuorum(clients, hash)) return "pending";
    throw intentError("wallet_transfer_transaction_missing_manual_reconciliation", hash);
  }
  throw intentError("wallet_transfer_receipt_quorum_unavailable", hash);
}

export async function waitForWalletTransferIntentReceipt(
  clients: WalletTransferReceiptClients,
  input: WalletTransferIntent,
  hashValue: unknown,
  timeout: number,
  now?: number,
): Promise<{ status: "confirmed" | "pending"; hash: `0x${string}` }> {
  const intent = createWalletTransferIntent(input);
  const initialHash = normalizeHash(hashValue);
  const operationStartedAt = now ?? Date.now();
  if (!initialHash) throw intentError("wallet_transfer_intent_invalid_hash");
  if (!Number.isSafeInteger(timeout) || timeout <= 0) {
    throw intentError("wallet_transfer_receipt_timeout_invalid", initialHash);
  }
  if (!Number.isSafeInteger(operationStartedAt) || operationStartedAt <= 0) {
    throw intentError("wallet_transfer_intent_invalid_time", initialHash);
  }

  let hash = initialHash;
  const persistedBeforeWait = await recoverPersistedReplacement(
    clients,
    intent,
    hash,
    operationStartedAt,
  );
  if (persistedBeforeWait.status === "recovered") {
    hash = persistedBeforeWait.hash;
  }
  await persistCanonicalWalletTransferType(clients, intent, hash, operationStartedAt);

  const replacementErrors: unknown[] = [];
  const recordObservedReplacement = (
    rpcIndex: 0 | 1,
    replacement: WalletTransferReplacement,
  ) => {
    try {
      recordReplacementObservation(
        intent,
        hash,
        rpcIndex,
        replacement,
        now === undefined ? Date.now() : operationStartedAt,
      );
    } catch (error) {
      replacementErrors.push(error);
    }
  };
  const waited = await Promise.allSettled([
    clients[0].waitForTransactionReceipt({
      hash,
      timeout,
      confirmations: WALLET_TRANSFER_FINALITY_CONFIRMATIONS,
      onReplaced: (replacement) => recordObservedReplacement(0, replacement),
    }),
    clients[1].waitForTransactionReceipt({
      hash,
      timeout,
      confirmations: WALLET_TRANSFER_FINALITY_CONFIRMATIONS,
      onReplaced: (replacement) => recordObservedReplacement(1, replacement),
    }),
  ]);

  if (replacementErrors.length > 0) throw replacementErrors[0];
  const persistedAfterWait = await recoverPersistedReplacement(
    clients,
    intent,
    hash,
    now === undefined ? Date.now() : operationStartedAt,
  );
  if (persistedAfterWait.status === "recovered") {
    const replacementHash = persistedAfterWait.hash;
    const observedReceipts = waited.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    );
    const canonical = await assertWalletTransferReceiptFinality(
      clients,
      replacementHash,
    );
    assertReceiptObservationsMatch(observedReceipts, canonical, replacementHash);
    if (canonical.status === "reverted") {
      throw new WalletTransactionRevertedError(replacementHash);
    }
    return { status: "confirmed", hash: replacementHash };
  }
  if (persistedAfterWait.status === "partial") {
    throw intentError("wallet_transfer_replacement_manual_reconciliation", hash);
  }

  const observedReceipts = waited.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : []
  );
  if (observedReceipts.length === 2) {
    assertReceiptObservationsMatch(observedReceipts, observedReceipts[0], hash);
    await assertStableWalletTransferReceipt(clients, hash, observedReceipts[0]);
    return { status: "confirmed", hash };
  }

  const lateReceipt = await readWalletTransferReceiptQuorum(clients, hash);
  if (lateReceipt) {
    assertReceiptObservationsMatch(observedReceipts, lateReceipt, hash);
    await assertStableWalletTransferReceipt(clients, hash, lateReceipt);
    return { status: "confirmed", hash };
  }
  if (observedReceipts.length > 0) {
    throw intentError("wallet_transfer_receipt_diverged", hash);
  }
  const waitErrors = waited.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : []
  );
  if (waitErrors.length === 2 && waitErrors.every(isReceiptTimeoutLikeError)) {
    if (await hasWalletTransferTransactionQuorum(clients, hash)) {
      return { status: "pending", hash };
    }
    throw intentError("wallet_transfer_transaction_missing_manual_reconciliation", hash);
  }
  throw intentError("wallet_transfer_receipt_quorum_unavailable", hash);
}

function readPendingWalletTransferStateForCandidate(
  transaction: NormalizedWalletTransferTransaction,
  allowedActors: readonly string[],
  now: number,
) {
  const normalizedActors = new Set<`0x${string}`>();
  try {
    for (const actor of allowedActors) normalizedActors.add(normalizeAddress(actor));
  } catch {
    throw intentError("wallet_transfer_intent_actor_changed", transaction.hash);
  }
  if (!normalizedActors.has(transaction.from)) {
    throw intentError("wallet_transfer_intent_actor_changed", transaction.hash);
  }

  const storage = getStorage();
  const actorPrefix = `${STORAGE_PREFIX}:${transaction.chainId}:${transaction.from}:`;
  let keys: string[];
  try {
    keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((key): key is string =>
        key !== null &&
        key.startsWith(actorPrefix) &&
        !key.includes(`:${REPLACEMENT_OBSERVATION_SUFFIX}:`)
      );
  } catch {
    throw intentError("wallet_transfer_intent_storage_read_failed", transaction.hash);
  }
  if (keys.length !== 1) {
    throw intentError("wallet_transfer_replacement_manual_reconciliation", transaction.hash);
  }

  let state: WalletTransferIntentState | null = null;
  try {
    const raw = storage.getItem(keys[0]);
    state = raw ? sanitizeState(JSON.parse(raw), now) : null;
  } catch {
    throw intentError("wallet_transfer_intent_state_invalid", transaction.hash);
  }
  if (!state) throw intentError("wallet_transfer_intent_state_invalid", transaction.hash);
  const intent = createWalletTransferIntent({
    actor: state.actor,
    chainId: state.chainId,
    asset: state.asset,
    destination: state.destination,
    amountWei: BigInt(state.amountWei),
  });
  if (
    keys[0] !== storageKey(intent) ||
    !state.hash ||
    !state.transactionType ||
    state.transactionType !== transaction.type
  ) {
    throw intentError("wallet_transfer_replacement_manual_reconciliation", transaction.hash);
  }
  assertWalletTransferTransactionMatchesIntent(
    transaction,
    intent,
    transaction.hash,
    state.nonce,
  );
  return { intent, state };
}

export async function reconcileWalletTransferReplacementCandidate(
  clients: WalletTransferReceiptClients,
  allowedActors: readonly string[],
  candidateHashValue: unknown,
  timeout: number,
  now = Date.now(),
): Promise<{ status: "confirmed" | "pending" | "reverted"; hash: `0x${string}` }> {
  const candidateHash = normalizeHash(candidateHashValue);
  if (!candidateHash) throw intentError("wallet_transfer_intent_invalid_hash");
  if (!Number.isSafeInteger(timeout) || timeout <= 0) {
    throw intentError("wallet_transfer_receipt_timeout_invalid", candidateHash);
  }
  if (!Number.isSafeInteger(now) || now <= 0) {
    throw intentError("wallet_transfer_intent_invalid_time", candidateHash);
  }

  const candidate = await readWalletTransferTransactionQuorum(clients, candidateHash);
  const { intent, state } = readPendingWalletTransferStateForCandidate(
    candidate,
    allowedActors,
    now,
  );
  await withIntentLock(intent, false, async () => {
    const current = readState(intent, now);
    if (
      !current ||
      !current.hash ||
      !state.hash ||
      current.id !== state.id ||
      current.hash !== state.hash ||
      current.nonce !== state.nonce ||
      current.transactionType !== state.transactionType
    ) {
      throw intentError("wallet_transfer_replacement_manual_reconciliation", candidateHash);
    }
    assertWalletTransferTransactionMatchesIntent(
      candidate,
      intent,
      candidateHash,
      current.nonce,
    );
    if (candidate.type !== current.transactionType) {
      throw intentError("wallet_transfer_replacement_manual_reconciliation", candidateHash);
    }
    if (current.hash === candidateHash) {
      const observations = readReplacementObservations(intent, now);
      if (observations[0] || observations[1]) {
        recoverCommittedReplacementCleanup(intent, current, observations);
      }
      return;
    }
    assertReplacementObservationsMatchMigration(
      readReplacementObservations(intent, now),
      current,
      current.hash,
      candidateHash,
      candidate.type,
    );
    writeState(intent, {
      ...current,
      replacementKnownHash: current.hash,
      hash: candidateHash,
      broadcastObserved: true,
      updatedAt: now,
    }, now);
    clearReplacementObservations(intent);
  });

  try {
    const receiptState = await waitForWalletTransferIntentReceipt(
      clients,
      intent,
      candidateHash,
      timeout,
      now,
    );
    if (receiptState.status === "pending") return receiptState;
    if (!await resolveWalletTransferIntent(
      intent,
      receiptState.hash,
      "confirmed",
      clients,
      now,
    )) {
      throw intentError("wallet_transfer_intent_resolution_mismatch", receiptState.hash);
    }
    return receiptState;
  } catch (error) {
    if (!(error instanceof WalletTransactionRevertedError)) throw error;
    if (!await resolveWalletTransferIntent(
      intent,
      error.transactionHash,
      "reverted",
      clients,
      now,
    )) {
      throw intentError("wallet_transfer_intent_resolution_mismatch", error.transactionHash);
    }
    return { status: "reverted", hash: error.transactionHash };
  }
}

export async function resolveWalletTransferIntent(
  input: WalletTransferIntent,
  hashValue: unknown,
  resolution: "confirmed" | "reverted",
  clients: WalletTransferReceiptClients,
  now = Date.now(),
): Promise<boolean> {
  const intent = createWalletTransferIntent(input);
  const hash = normalizeHash(hashValue);
  if (!hash) throw intentError("wallet_transfer_intent_invalid_hash");
  if (resolution !== "confirmed" && resolution !== "reverted") {
    throw intentError("wallet_transfer_intent_invalid_resolution", hash);
  }

  return withIntentLock(intent, false, async () => {
    const current = readState(intent, now);
    if (!current || current.hash !== hash) return false;
    const transaction = await assertWalletTransferTransactionQuorum(
      clients,
      intent,
      hash,
      current.nonce,
    );
    if (current.transactionType && transaction.type !== current.transactionType) {
      throw intentError("wallet_transfer_transaction_intent_mismatch", hash);
    }
    const receipt = await assertWalletTransferReceiptFinality(clients, hash);
    if (
      (resolution === "confirmed" && receipt.status !== "success") ||
      (resolution === "reverted" && receipt.status !== "reverted")
    ) {
      throw intentError("wallet_transfer_receipt_resolution_mismatch", hash);
    }
    removeState(intent);
    return true;
  });
}
