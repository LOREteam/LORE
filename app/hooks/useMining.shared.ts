"use client";

import type { PublicClient } from "viem";
import {
  APP_CHAIN_ID,
  CONTRACT_ADDRESS,
  GAME_ABI,
  GRID_SIZE,
} from "../lib/constants";

export interface PersistedAutoMinerSession {
  active: boolean;
  betStr: string;
  blocks: number;
  rounds: number;
  nextRoundIndex: number;
  lastPlacedEpoch: string | null;
}

export const AUTO_MINER_STORAGE_KEY = `lineaore:auto-miner-session:v2:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`;
export const AUTO_MINER_SESSION_EVENT = `lineaore:auto-mine-session-change:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`;
export const TAB_LOCK_KEY = `lore:auto-mine-tab-lock:v2:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`;
export const TAB_LOCK_TTL_MS = 90_000;
export const TAB_LOCK_PING_TIMEOUT_MS = 700;
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
  for (const epoch of dedupeEpochs(candidateEpochs)) {
    try {
      const bets = (await client.readContract({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "getUserBetsAll",
        args: [epoch, actorAddress],
      })) as bigint[];
      const confirmedCount = countConfirmedTiles(bets, tiles);
      if (confirmedCount >= tiles.length) {
        return { epoch, confirmedCount };
      }
    } catch {
      // Keep checking nearby epochs when public RPC is flaky.
    }
  }
  return null;
}

export function isEpochEndedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return msg.includes("epoch ended");
}

export function isRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  const name = err instanceof Error ? err.name : "";
  return (
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
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
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
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes("insufficient funds") ||
    msg.includes("upfront cost exceeds") ||
    msg.includes("exceeds account balance") ||
    msg.includes("sender doesn't have enough funds") ||
    msg.includes("out of gas")
  );
}

export function isNetworkError(err: unknown): boolean {
  if (isInsufficientFundsError(err)) return false;
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  const name = err instanceof Error ? err.name.toLowerCase() : "";
  return (
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
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      const timeoutError = new Error(`${label} timed out after ${timeoutMs}ms`);
      timeoutError.name = "TimeoutError";
      reject(timeoutError);
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  });
}

export function isReceiptTimeoutError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
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
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
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
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
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
  if (lower.includes("epoch ended")) {
    return "Bet failed: epoch already ended. Try again.";
  }
  if (lower.includes("reverted")) {
    return `Bet failed: ${msg}`;
  }

  return `Bet failed: ${msg}`;
}

export function isMissingTokenGetterError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes('function "token" returned no data') ||
    msg.includes("returned no data (\"0x\")") ||
    msg.includes("does not have the function \"token\"")
  );
}

export function readSession(): PersistedAutoMinerSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(AUTO_MINER_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedAutoMinerSession;
  } catch {
    return null;
  }
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
