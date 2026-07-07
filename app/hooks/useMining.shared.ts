"use client";

import type { PublicClient } from "viem";
import {
  APP_CHAIN_ID,
  CONTRACT_ADDRESS,
  GAME_ABI,
  GRID_SIZE,
} from "../lib/constants";
import { validateBetAmount } from "../lib/utils";

export interface PersistedAutoMinerSession {
  active: boolean;
  betStr: string;
  blocks: number;
  rounds: number;
  nextRoundIndex: number;
  lastPlacedEpoch: string | null;
}

export interface PersistedTabLock {
  id: string;
  ts: number;
  tx?: string;
}

export const AUTO_MINER_STORAGE_KEY = `lineaore:auto-miner-session:v2:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`;
export const AUTO_MINER_SESSION_EVENT = `lineaore:auto-mine-session-change:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`;
export const TAB_LOCK_KEY = `lore:auto-mine-tab-lock:v2:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`;
export const TAB_LOCK_TTL_MS = 90_000;
export const TAB_LOCK_PING_TIMEOUT_MS = 700;
const TAB_LOCK_MAX_FUTURE_SKEW_MS = 5_000;
export const SESSION_REFRESH_INTERVAL_MS = 20 * 60 * 1000;

function dispatchAutoMinerSessionEvent() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AUTO_MINER_SESSION_EVENT));
}

export function normalizeTiles(tiles: number[]): number[] {
  const seen = new Set<number>();
  const normalized: number[] = [];
  for (const tile of tiles) {
    if (!Number.isInteger(tile) || tile < 1 || tile > GRID_SIZE || seen.has(tile)) continue;
    seen.add(tile);
    normalized.push(tile);
  }
  return normalized;
}

export function countConfirmedTiles(bets: bigint[], tiles: number[]): number {
  return tiles.filter((tile) => {
    const bet = bets[tile - 1];
    return bet !== undefined && bet > 0n;
  }).length;
}

export function dedupeEpochs(epochs: bigint[]): bigint[] {
  const seen = new Set<string>();
  const unique: bigint[] = [];
  for (const epoch of epochs) {
    if (epoch <= 0n) continue;
    const key = epoch.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(epoch);
  }
  return unique;
}

export async function findConfirmedEpochForTiles(
  client: PublicClient,
  actorAddress: `0x${string}`,
  candidateEpochs: bigint[],
  tiles: number[],
): Promise<{ epoch: bigint; confirmedCount: number } | null> {
  if (tiles.length === 0) return null;
  let successfulReads = 0;
  let lastReadError: unknown = null;
  for (const epoch of dedupeEpochs(candidateEpochs)) {
    try {
      const bets = (await client.readContract({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "getUserBetsAll",
        args: [epoch, actorAddress],
      })) as bigint[];
      successfulReads += 1;
      const confirmedCount = countConfirmedTiles(bets, tiles);
      if (confirmedCount >= tiles.length) {
        return { epoch, confirmedCount };
      }
    } catch (error) {
      lastReadError = error;
      // Keep checking nearby epochs when public RPC is flaky.
    }
  }
  if (successfulReads === 0 && lastReadError) {
    throw lastReadError;
  }
  return null;
}

export function isEpochEndedError(err: unknown): boolean {
  const msg = flattenErrorMessage(err);
  // V9: also treat the last-2-second EpochClosing() reject as "epoch ended"
  // for UX purposes — the bet missed the window and the next epoch is imminent.
  return msg.includes("epoch ended") || msg.includes("epochended") || msg.includes("epochclosing");
}

export function flattenErrorMessage(err: unknown): string {
  const parts: string[] = [];
  const visited = new Set<unknown>();

  const visit = (value: unknown) => {
    if (!value || visited.has(value)) return;
    visited.add(value);

    if (value instanceof Error) {
      if (value.name && value.name !== "Error") parts.push(value.name);
      if (value.message) parts.push(value.message);
      const withMeta = value as Error & {
        details?: unknown;
        shortMessage?: unknown;
        metaMessages?: unknown;
        cause?: unknown;
      };
      if (typeof withMeta.shortMessage === "string") parts.push(withMeta.shortMessage);
      if (typeof withMeta.details === "string") parts.push(withMeta.details);
      if (Array.isArray(withMeta.metaMessages)) {
        for (const item of withMeta.metaMessages) {
          if (typeof item === "string") parts.push(item);
        }
      }
      visit(withMeta.cause);
      return;
    }

    if (typeof value === "string") {
      parts.push(value);
      return;
    }

    if (typeof value === "object" && value !== null) {
      const withCause = value as { cause?: unknown; message?: unknown; details?: unknown };
      if (typeof withCause.message === "string") parts.push(withCause.message);
      if (typeof withCause.details === "string") parts.push(withCause.details);
      visit(withCause.cause);
    }
  };

  visit(err);
  return parts.join(" | ").toLowerCase();
}

export function isEpochWaitTimeoutError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  const name = err instanceof Error ? err.name : "";
  return (
    name === "EpochWaitTimeoutError" ||
    msg.includes("did not reach end-of-round readiness") ||
    msg.includes("did not advance after resolver grace window")
  );
}

export function isRetryableError(err: unknown): boolean {
  const msg = flattenErrorMessage(err);
  const name = err instanceof Error ? err.name : "";
  return (
    isEpochWaitTimeoutError(err) ||
    msg.includes("epoch ended") ||
    msg.includes("gas required exceeds") ||
    msg.includes("reverted") ||
    msg.includes("nonce") ||
    msg.includes("replacement transaction underpriced") ||
    msg.includes("already known") ||
    name === "WalletSwitchTimeoutError" ||
    msg.includes("setactivewallet timed out") ||
    name === "TimeoutError" ||
    name === "TransactionReceiptTimeoutError" ||
    msg.includes("transaction receipt timeout") ||
    msg.includes("transaction receipt timed out") ||
    msg.includes("receipt timeout") ||
    msg.includes(" timeout") ||
    msg.includes("took too long") ||
    msg.includes("timed out")
  );
}

export function isSessionExpiredError(err: unknown): boolean {
  const msg = flattenErrorMessage(err);
  const name = err instanceof Error ? err.name : "";
  return (
    name === "PrivyApiError" ||
    msg.includes("must have valid access token") ||
    msg.includes("valid access token and privy wallet") ||
    msg.includes("authorization signatures") ||
    msg.includes("signing keys") ||
    msg.includes("incorrect or expired")
  );
}

export function isInsufficientFundsError(err: unknown): boolean {
  const msg = flattenErrorMessage(err);
  return (
    msg.includes("insufficient funds") ||
    msg.includes("upfront cost exceeds") ||
    msg.includes("exceeds account balance") ||
    msg.includes("sender doesn't have enough funds") ||
    msg.includes("out of gas")
  );
}

export function isWalletUnavailableError(err: unknown): boolean {
  const msg = flattenErrorMessage(err);
  return (
    msg.includes("public client not ready") ||
    msg.includes("public client unavailable") ||
    msg.includes("wallet not ready") ||
    msg.includes("wallet not found") ||
    msg.includes("embedded wallet not found") ||
    msg.includes("embedded wallet not ready") ||
    msg.includes("no embedded or connected wallet found for address")
  );
}

export function isNetworkError(err: unknown): boolean {
  if (isEpochWaitTimeoutError(err)) return false;
  if (isInsufficientFundsError(err)) return false;
  const msg = flattenErrorMessage(err);
  const name = err instanceof Error ? err.name.toLowerCase() : "";
  return (
    name.includes("networkretryexhaustederror") ||
    msg.includes("network retry exhausted") ||
    name.includes("methodnotsupportedrpcerror") ||
    msg.includes("failed to fetch") ||
    msg.includes("network request failed") ||
    msg.includes("networkerror") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("enotfound") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang up") ||
    msg.includes("http request failed") ||
    msg.includes("fetch failed") ||
    msg.includes("aborted") ||
    msg.includes("err_network") ||
    msg.includes("load failed") ||
    msg.includes("method \"eth_sendrawtransaction\" is not supported") ||
    msg.includes("does not exist/is not available") ||
    name.includes("transactionreceipttimeouterror") ||
    msg.includes("transaction receipt timeout") ||
    msg.includes("transaction receipt timed out") ||
    msg.includes("receipt timeout") ||
    msg.includes(" timeout") ||
    msg.includes("timed out after")
  );
}

export function firstErrorLine(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.split("\n")[0].trim();
}

const MINING_RPC_TIMEOUT_MS = 25_000;

export function withMiningRpcTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs: number = MINING_RPC_TIMEOUT_MS,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let raceSettled = false;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      const timeoutError = new Error(`${label} timed out after ${timeoutMs}ms`);
      timeoutError.name = "TimeoutError";
      reject(timeoutError);
    }, timeoutMs);
  });
  const guarded = promise.catch((error) => {
    if (raceSettled) return new Promise<T>(() => {});
    throw error;
  });
  return Promise.race([guarded, timeoutPromise]).finally(() => {
    raceSettled = true;
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  });
}

export function isReceiptTimeoutError(err: unknown): boolean {
  const msg = flattenErrorMessage(err);
  const name = err instanceof Error ? err.name : "";
  return (
    name === "TransactionReceiptTimeoutError" ||
    name === "TransactionReceiptNotFoundError" ||
    msg.includes("transaction receipt timed out") ||
    msg.includes("receipt timeout") ||
    msg.includes("receipt could not be found")
  );
}

export function isAmbiguousPendingTxError(err: unknown): boolean {
  const msg = flattenErrorMessage(err);
  const name = err instanceof Error ? err.name : "";
  return (
    name === "TransactionReceiptTimeoutError" ||
    name === "TransactionReceiptNotFoundError" ||
    msg.includes("transaction receipt could not be found") ||
    msg.includes("receipt could not be found") ||
    msg.includes("replacement transaction underpriced") ||
    msg.includes("already known") ||
    msg.includes("known transaction") ||
    msg.includes("nonce too low") ||
    msg.includes("lower than the current nonce")
  );
}

export function isAllowanceError(err: unknown): boolean {
  const msg = flattenErrorMessage(err);
  return (
    msg.includes("erc20insufficientallowance") ||
    msg.includes("insufficient allowance") ||
    msg.includes("0xfb8f41b2")
  );
}

export function getBetErrorMessage(err: unknown): string {
  if (isInsufficientFundsError(err)) {
    return "Bet failed: not enough ETH for gas on Privy wallet.";
  }

  const msg = firstErrorLine(err);
  const lower = msg.toLowerCase();

  if (lower.includes("contract token mismatch")) {
    return `Bet failed: ${msg}`;
  }
  if (lower.includes("token() getter is required")) {
    return `Bet failed: ${msg}`;
  }
  if (lower.includes("erc20insufficientallowance") || lower.includes("0xfb8f41b2")) {
    return "Bet failed: token approve is still pending or too low. Wait for approve confirmation, then retry.";
  }
  if (lower.includes("insufficient allowance")) {
    return "Bet failed: token approval is missing or outdated. Retry the approve transaction.";
  }
  if (lower.includes("transfer amount exceeds balance") || lower.includes("amount exceeds balance")) {
    return "Bet failed: not enough LINEA token balance.";
  }
  if (lower.includes("epoch ended") || lower.includes("epochclosing")) {
    return "Bet failed: epoch already ended. Try again.";
  }
  if (lower.includes("reverted")) {
    return `Bet failed: ${msg}`;
  }

  return `Bet failed: ${msg}`;
}

export function isMissingTokenGetterError(err: unknown): boolean {
  const msg = flattenErrorMessage(err);
  return (
    msg.includes('function "token" returned no data') ||
    msg.includes("returned no data (\"0x\")") ||
    msg.includes("does not have the function \"token\"")
  );
}

export function isDeterministicBetExecutionError(err: unknown): boolean {
  const msg = flattenErrorMessage(err);
  return (
    msg.includes("contractfunctionexecutionerror") ||
    msg.includes("execution reverted") ||
    msg.includes("the contract function") ||
    msg.includes("epochclosing") ||
    msg.includes("epochended") ||
    msg.includes("erc20insufficientallowance") ||
    msg.includes("insufficient allowance") ||
    msg.includes("emptyarray") ||
    msg.includes("zeroamount") ||
    msg.includes("invalidtilemask") ||
    msg.includes("invalid tile mask") ||
    msg.includes("invalidtile")
  );
}

export function sanitizePersistedAutoMinerSession(value: unknown): PersistedAutoMinerSession | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const active = raw.active;
  const betStr = raw.betStr;
  const blocks = raw.blocks;
  const rounds = raw.rounds;
  const nextRoundIndex = raw.nextRoundIndex;
  const lastPlacedEpoch = raw.lastPlacedEpoch;

  if (typeof active !== "boolean") return null;
  if (typeof betStr !== "string" || validateBetAmount(betStr) !== null) return null;
  if (typeof blocks !== "number" || !Number.isInteger(blocks) || blocks < 1 || blocks > GRID_SIZE) return null;
  if (typeof rounds !== "number" || !Number.isInteger(rounds) || rounds < 1) return null;
  if (
    typeof nextRoundIndex !== "number" ||
    !Number.isInteger(nextRoundIndex) ||
    nextRoundIndex < 0 ||
    nextRoundIndex > rounds
  ) {
    return null;
  }
  if (lastPlacedEpoch !== null && lastPlacedEpoch !== undefined) {
    if (typeof lastPlacedEpoch !== "string" || !/^\d+$/.test(lastPlacedEpoch)) return null;
  }

  return {
    active,
    betStr,
    blocks,
    rounds,
    nextRoundIndex,
    lastPlacedEpoch: lastPlacedEpoch ?? null,
  };
}

export function readSession(): PersistedAutoMinerSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(AUTO_MINER_STORAGE_KEY);
    if (!raw) return null;
    return sanitizePersistedAutoMinerSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function sanitizeTabLock(value: unknown, now = Date.now()): PersistedTabLock | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const ts = raw.ts;
  const tx = raw.tx;
  if (!id) return null;
  if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) return null;
  if (ts - now > TAB_LOCK_MAX_FUTURE_SKEW_MS) return null;
  return {
    id,
    ts,
    ...(typeof tx === "string" && tx ? { tx } : {}),
  };
}

export function saveSession(session: PersistedAutoMinerSession) {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(AUTO_MINER_STORAGE_KEY, JSON.stringify(session));
    } catch {
      // ignore quota / private mode
    }
    dispatchAutoMinerSessionEvent();
  }
}

export function clearSession() {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(AUTO_MINER_STORAGE_KEY);
    } catch {
      // ignore
    }
    dispatchAutoMinerSessionEvent();
  }
}

export function createTabId(): string {
  if (typeof crypto !== "undefined") {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    if (typeof crypto.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
      return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
    }
  }
  return `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getStableTabId(): string {
  if (typeof window === "undefined") {
    return createTabId();
  }

  try {
    const storageKey = `lore:auto-mine-tab-id:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`;
    const existing = window.sessionStorage.getItem(storageKey);
    if (existing) return existing;

    const created = createTabId();
    window.sessionStorage.setItem(storageKey, created);
    return created;
  } catch {
    return createTabId();
  }
}

export function getSecureRandomNumber(max: number): number {
  if (max <= 0) return 0;
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    return Math.floor(Math.random() * max);
  }
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return array[0] % max;
}
