"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { parseUnits, maxUint256, encodeFunctionData } from "viem";
import type { PublicClient } from "viem";
import {
  CONTRACT_ADDRESS, LINEA_TOKEN_ADDRESS,
  GAME_ABI, TOKEN_ABI,
  GRID_SIZE, REFETCH_DELAY_MS, APP_CHAIN_ID,
  TX_RECEIPT_TIMEOUT_MS, MAX_BET_ATTEMPTS, CONTRACT_HAS_TOKEN_GETTER,
} from "../lib/constants";
import { getFallbackFeeOverrides, getKeeperFeeOverrides, getLineaFeeOverrides } from "../lib/lineaFees";
import { normalizeDecimalInput, delay, isUserRejection } from "../lib/utils";
import { log } from "../lib/logger";

export type GasOverrides = { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } | { gasPrice?: bigint };
type ReceiptState = "confirmed" | "pending";

type SilentSendFn = (
  tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint; nonce?: number },
  gasOverrides?: GasOverrides,
) => Promise<`0x${string}`>;

/** Call periodically to refresh Privy auth/session so wallet signing keeps working. */
export type RefreshSessionFn = () => Promise<void>;

interface UseMiningOptions {
  refetchAllowance: () => void;
  refetchTileData: () => void;
  refetchUserBets: () => void;
  refetchEpoch?: () => void;
  refetchGridEpochData?: () => void;
  preferredAddress?: `0x${string}` | string | null;
  ensurePreferredWallet?: () => Promise<void> | void;
  sendTransactionSilent?: SilentSendFn;
  /** Optional: call every ~20 min while bot runs to keep Privy session valid (e.g. () => getAccessToken()) */
  refreshSession?: RefreshSessionFn;
  /** Optional: called when auto-miner has placed a bet (blocks chosen and tx confirmed) */
  onAutoMineBetConfirmed?: () => void;
}

const AUTO_MINER_STORAGE_KEY = `lineaore:auto-miner-session:v2:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`;

interface PersistedAutoMinerSession {
  active: boolean;
  betStr: string;
  blocks: number;
  rounds: number;
  nextRoundIndex: number;
  lastPlacedEpoch: string | null;
}

// ---- Helpers outside the hook to avoid recreating on each render ----

function normalizeTiles(tiles: number[]): number[] {
  const seen = new Set<number>();
  const normalized: number[] = [];
  for (const tile of tiles) {
    if (!Number.isInteger(tile) || tile < 1 || tile > GRID_SIZE || seen.has(tile)) continue;
    seen.add(tile);
    normalized.push(tile);
  }
  return normalized;
}

function countConfirmedTiles(bets: bigint[], tiles: number[]): number {
  return tiles.filter((tile) => {
    const bet = bets[tile - 1];
    return bet !== undefined && bet > 0n;
  }).length;
}

function dedupeEpochs(epochs: bigint[]): bigint[] {
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

async function findConfirmedEpochForTiles(
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

function isEpochEndedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return msg.includes("epoch ended");
}

function isRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  const name = err instanceof Error ? err.name : "";
  return (
    msg.includes("epoch ended") ||
    msg.includes("gas required exceeds") ||
    msg.includes("reverted") ||
    msg.includes("nonce") ||
    msg.includes("replacement transaction underpriced") ||
    msg.includes("already known") ||
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

function isSessionExpiredError(err: unknown): boolean {
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

function isInsufficientFundsError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes("insufficient funds") ||
    msg.includes("upfront cost exceeds") ||
    msg.includes("exceeds account balance") ||
    msg.includes("sender doesn't have enough funds") ||
    msg.includes("out of gas")
  );
}

function isNetworkError(err: unknown): boolean {
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

function firstErrorLine(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.split("\n")[0].trim();
}

function isReceiptTimeoutError(err: unknown): boolean {
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

function isAmbiguousPendingTxError(err: unknown): boolean {
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
    msg.includes("lower than the current nonce") ||
    msg.includes("timed out after") ||
    msg.includes("privy sendtransaction timed out")
  );
}

function isAllowanceError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes("erc20insufficientallowance") ||
    msg.includes("insufficient allowance") ||
    msg.includes("0xfb8f41b2")
  );
}

function getBetErrorMessage(err: unknown): string {
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

function isMissingTokenGetterError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes('function "token" returned no data') ||
    msg.includes("returned no data (\"0x\")") ||
    msg.includes("does not have the function \"token\"")
  );
}

const NETWORK_RETRY_MAX = 120;
const NETWORK_BACKOFF_INITIAL_MS = 1_500;
const NETWORK_BACKOFF_MAX_MS = 15_000;
const APPROVE_RETRY_MAX = 3;
const APPROVE_ALLOWANCE_POLL_MS = 2_000;
const APPROVE_ALLOWANCE_SYNC_TIMEOUT_MS = 12_000;
const APPROVE_PENDING_TIMEOUT_MS = 30_000;
const EXTERNAL_RESOLVE_GRACE_MAX_MS = 8_000;
const EXTERNAL_RESOLVE_POLL_MS = 500;
const GAS_BUMP_BASE = BigInt(110);
const GAS_BUMP_REPLACEMENT_STEP = BigInt(12);
const MIN_GAS_PLACE_BET = BigInt(320_000);
const MIN_GAS_PLACE_BATCH = BigInt(700_000);
const MIN_GAS_APPROVE = BigInt(90_000);
const GAS_COST_BUFFER_BPS = BigInt(12500); // 1.25x fee headroom
const BPS_DENOMINATOR = BigInt(10000);

function readSession(): PersistedAutoMinerSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(AUTO_MINER_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedAutoMinerSession;
  } catch {
    return null;
  }
}

function saveSession(session: PersistedAutoMinerSession) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(AUTO_MINER_STORAGE_KEY, JSON.stringify(session));
  }
}

function clearSession() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(AUTO_MINER_STORAGE_KEY);
  }
}

function createTabId(): string {
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

function getStableTabId(): string {
  if (typeof window === "undefined") {
    return createTabId();
  }

  try {
    const existing = window.sessionStorage.getItem(
      `lore:auto-mine-tab-id:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`,
    );
    if (existing) return existing;

    const created = createTabId();
    window.sessionStorage.setItem(
      `lore:auto-mine-tab-id:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`,
      created,
    );
    return created;
  } catch {
    return createTabId();
  }
}

/** Only one auto-miner loop can run at a time (guards against double-start on remount). */
let autoMineRunInProgress = false;

// Cross-tab lock: prevents multiple browser tabs from mining simultaneously
const TAB_LOCK_KEY = `lore:auto-mine-tab-lock:v2:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`;
const TAB_LOCK_TTL_MS = 90_000;
const TAB_ID = getStableTabId();
const TAB_LOCK_PING_TIMEOUT_MS = 700;

// Use BroadcastChannel for reliable cross-tab communication
const lockChannel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel(`lore-tab-lock:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`)
    : null;
const pendingLockPingResolvers = new Map<string, (ownerAlive: boolean) => void>();

// Use crypto.getRandomValues for secure random number generation
function getSecureRandomNumber(max: number): number {
  if (max <= 0) return 0;
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    return Math.floor(Math.random() * max);
  }
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return array[0] % max;
}

function acquireTabLock(): boolean {
  try {
    const raw = localStorage.getItem(TAB_LOCK_KEY);
    if (raw) {
      const lock = JSON.parse(raw) as { id: string; ts: number };
      // If another tab holds the lock and it's still valid, we can't acquire
      if (lock.id !== TAB_ID && Date.now() - lock.ts < TAB_LOCK_TTL_MS) {
        return false;
      }
    }
    // Atomic update: check-then-set with timestamp to prevent race condition
    // Use a unique transaction ID to avoid conflicts
    const newLock = { id: TAB_ID, ts: Date.now(), tx: getSecureRandomNumber(1000000).toString() };
    localStorage.setItem(TAB_LOCK_KEY, JSON.stringify(newLock));
    
    // Verify we actually got the lock (another tab might have stolen it)
    const verifyRaw = localStorage.getItem(TAB_LOCK_KEY);
    if (!verifyRaw) return false;
    const verifyLock = JSON.parse(verifyRaw) as { id: string; ts: number; tx?: string };
    if (verifyLock.id !== TAB_ID) return false;
    
    return true;
  } catch { return false; }
}

function readTabLock(): { id: string; ts: number; tx?: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TAB_LOCK_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as { id: string; ts: number; tx?: string };
  } catch {
    return null;
  }
}

function clearTabLock(lockId?: string | null): boolean {
  if (typeof window === "undefined") return false;
  try {
    const current = readTabLock();
    if (!current) return true;
    if (lockId && current.id !== lockId) return false;
    window.localStorage.removeItem(TAB_LOCK_KEY);
    lockChannel?.postMessage({ type: "lock-released", from: TAB_ID });
    return true;
  } catch {
    return false;
  }
}

async function recoverOrphanedTabLock(): Promise<boolean> {
  const lock = readTabLock();
  if (!lock || lock.id === TAB_ID) return false;

  if (Date.now() - lock.ts >= TAB_LOCK_TTL_MS) {
    return clearTabLock(lock.id);
  }

  if (!lockChannel) return false;

  const requestId = createTabId();
  const ownerAlive = await new Promise<boolean>((resolve) => {
    pendingLockPingResolvers.set(requestId, resolve);
    lockChannel.postMessage({ type: "lock-ping", from: TAB_ID, target: lock.id, requestId });
    window.setTimeout(() => {
      const pending = pendingLockPingResolvers.get(requestId);
      if (!pending) return;
      pendingLockPingResolvers.delete(requestId);
      resolve(false);
    }, TAB_LOCK_PING_TIMEOUT_MS);
  });

  if (ownerAlive) return false;

  const latest = readTabLock();
  if (!latest || latest.id !== lock.id) return false;
  return clearTabLock(lock.id);
}

function renewTabLock() {
  try {
    const raw = localStorage.getItem(TAB_LOCK_KEY);
    if (raw) {
      const lock = JSON.parse(raw) as { id: string; ts: number; tx?: string };
      // Only renew if we own the lock
      if (lock.id === TAB_ID) {
        localStorage.setItem(TAB_LOCK_KEY, JSON.stringify({ id: TAB_ID, ts: Date.now(), tx: lock.tx }));
      }
    }
  } catch {}
}

function releaseTabLock() {
  try {
    const raw = localStorage.getItem(TAB_LOCK_KEY);
    if (raw) {
      const lock = JSON.parse(raw) as { id: string; tx?: string };
      // Only release if we own the lock
      if (lock.id === TAB_ID) {
        localStorage.removeItem(TAB_LOCK_KEY);
        lockChannel?.postMessage({ type: "lock-released", from: TAB_ID });
      }
    }
  } catch {}
}

// Listen for tab-lock ping/pong events from other tabs
if (lockChannel) {
  lockChannel.onmessage = (event) => {
    const data = event.data as
      | { type?: "lock-ping"; from?: string; target?: string; requestId?: string }
      | { type?: "lock-pong"; from?: string; requestId?: string }
      | { type?: "lock-released"; from?: string }
      | null;
    if (!data?.type) return;

    if (data.type === "lock-ping") {
      if (!data.requestId || data.from === TAB_ID || data.target !== TAB_ID) return;
      const lock = readTabLock();
      if (!lock || lock.id !== TAB_ID || Date.now() - lock.ts >= TAB_LOCK_TTL_MS) return;
      lockChannel.postMessage({ type: "lock-pong", from: TAB_ID, requestId: data.requestId });
      return;
    }

    if (data.type === "lock-pong") {
      if (!data.requestId) return;
      const resolve = pendingLockPingResolvers.get(data.requestId);
      if (!resolve) return;
      pendingLockPingResolvers.delete(data.requestId);
      resolve(true);
    }
  };
}

const SESSION_REFRESH_INTERVAL_MS = 20 * 60 * 1000; // 20 min – refresh before wallet session typically expires



export function useMining({
  refetchAllowance,
  refetchTileData,
  refetchUserBets,
  refetchEpoch,
  refetchGridEpochData,
  preferredAddress,
  ensurePreferredWallet,
  sendTransactionSilent,
  refreshSession,
  onAutoMineBetConfirmed,
}: UseMiningOptions) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();

  const [isPending, setIsPending] = useState(false);
  const [selectedTiles, setSelectedTiles] = useState<number[]>([]);
  const [selectedTilesEpoch, setSelectedTilesEpoch] = useState<string | null>(null);
  const [isAutoMining, setIsAutoMining] = useState(false);
  const [autoMineProgress, setAutoMineProgress] = useState<string | null>(null);
  const [runningParams, setRunningParams] = useState<{ betStr: string; blocks: number; rounds: number } | null>(null);
  const autoMineRef = useRef(false);
  const restoreAttemptedRef = useRef(false);
  const sessionExpiredErrorRef = useRef(false);
  const tokenGetterWarningShownRef = useRef(false);
  const pendingApproveRef = useRef<{ hash: `0x${string}`; submittedAt: number; nonce: number } | null>(null);
  const scheduleRefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- Stable refs: always point to latest versions of volatile functions ----
  const publicClientRef = useRef(publicClient);
  const silentSendRef = useRef(sendTransactionSilent);
  const refreshSessionRef = useRef(refreshSession);
  const writeContractAsyncRef = useRef(writeContractAsync);
  const preferredAddressRef = useRef<string | null>(preferredAddress ?? null);
  const ensurePreferredWalletRef = useRef(ensurePreferredWallet);
  const refetchAllowanceRef = useRef(refetchAllowance);
  const refetchTileDataRef = useRef(refetchTileData);
  const refetchUserBetsRef = useRef(refetchUserBets);
  const refetchEpochRef = useRef(refetchEpoch);
  const refetchGridEpochDataRef = useRef(refetchGridEpochData);
  const onAutoMineBetConfirmedRef = useRef(onAutoMineBetConfirmed);

  // Sync refs on every render (assignment is synchronous, no useEffect needed)
  publicClientRef.current = publicClient;
  silentSendRef.current = sendTransactionSilent;
  refreshSessionRef.current = refreshSession;
  writeContractAsyncRef.current = writeContractAsync;
  preferredAddressRef.current = preferredAddress ?? null;
  ensurePreferredWalletRef.current = ensurePreferredWallet;
  refetchAllowanceRef.current = refetchAllowance;
  refetchTileDataRef.current = refetchTileData;
  refetchUserBetsRef.current = refetchUserBets;
  refetchEpochRef.current = refetchEpoch;
  refetchGridEpochDataRef.current = refetchGridEpochData;
  onAutoMineBetConfirmedRef.current = onAutoMineBetConfirmed;

  const hasPreferredActor = Boolean(preferredAddress);
  const getActorAddress = useCallback(() => preferredAddressRef.current ?? address ?? null, [address]);
  const getPreferredActorAddress = useCallback(() => preferredAddressRef.current ?? null, []);

  // Sync UI with localStorage after hydration
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(AUTO_MINER_STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as PersistedAutoMinerSession;
      if (s?.active && s.nextRoundIndex < s.rounds) {
        setIsAutoMining(true);
        setAutoMineProgress("Restoring...");
      }
    } catch {
      // ignore
    }
  }, []);

  const waitReceipt = useCallback(
    async (hash: `0x${string}`, pc?: PublicClient): Promise<ReceiptState> => {
      const client = pc ?? publicClientRef.current;
      if (!client) throw new Error("Public client not ready");
      const activeClient = client;
      try {
        const receipt = await activeClient.waitForTransactionReceipt({ hash, timeout: TX_RECEIPT_TIMEOUT_MS });
        if (receipt && typeof receipt === "object" && "status" in receipt && receipt.status === "reverted") {
          const outOfGas = "gasUsed" in receipt && "gas" in receipt && receipt.gasUsed === receipt.gas;
          throw new Error(
            outOfGas
              ? `Transaction ran out of gas (hash: ${hash})`
              : `Transaction reverted (hash: ${hash})`,
          );
        }
        return "confirmed";
      } catch (err) {
        try {
          const lateReceipt = await activeClient.getTransactionReceipt({ hash });
          if (lateReceipt.status === "reverted") {
            const tx = await activeClient.getTransaction({ hash }).catch(() => null);
            const outOfGas = tx && lateReceipt.gasUsed === tx.gas;
            throw new Error(
              outOfGas
                ? `Transaction ran out of gas (hash: ${hash})`
                : `Transaction reverted (hash: ${hash})`,
            );
          }
          return "confirmed";
        } catch {
          const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
          const name = err instanceof Error ? err.name : "";
          if (
            name === "TimeoutError" ||
            name === "TransactionReceiptNotFoundError" ||
            msg.includes("timed out") ||
            msg.includes("timeout") ||
            msg.includes("receipt could not be found")
          ) {
            try {
              await activeClient.getTransaction({ hash });
              // Transaction is known by RPC but not yet mined.
              return "pending";
            } catch {
              const timeoutErr = new Error(`Transaction receipt timed out (hash: ${hash})`);
              timeoutErr.name = "TransactionReceiptTimeoutError";
              throw timeoutErr;
            }
          }
          throw err;
        }
      }
    },
    [],
  );

  const getBumpedFees = useCallback(async (percent: bigint = GAS_BUMP_BASE) => {
    const pc = publicClientRef.current;
    if (!pc) return getFallbackFeeOverrides(APP_CHAIN_ID, "normal");
    try {
      const fees = await pc.estimateFeesPerGas();
      return getLineaFeeOverrides(fees, APP_CHAIN_ID, percent, percent);
    } catch (err) {
      log.warn("AutoMine", "fee estimation failed, letting wallet decide", err);
    }
    return getFallbackFeeOverrides(APP_CHAIN_ID, "normal");
  }, []);

  const getUrgentFees = useCallback(async () => {
    const pc = publicClientRef.current;
    if (!pc) return getFallbackFeeOverrides(APP_CHAIN_ID, "keeper");
    try {
      const fees = await pc.estimateFeesPerGas();
      return getKeeperFeeOverrides(fees, APP_CHAIN_ID);
    } catch (err) {
      log.warn("AutoMine", "urgent fee estimation failed, falling back", err);
    }
    return getFallbackFeeOverrides(APP_CHAIN_ID, "keeper");
  }, []);

  const getApproveFees = useCallback(async (attempt = 0) => {
    const pc = publicClientRef.current;
    if (!pc) return getFallbackFeeOverrides(APP_CHAIN_ID, "keeper");
    try {
      const fees = await pc.estimateFeesPerGas();
      const maxFeeBump = 130n + BigInt(attempt) * 25n;
      const priorityBump = 125n + BigInt(attempt) * 20n;
      return getKeeperFeeOverrides(fees, APP_CHAIN_ID, maxFeeBump, priorityBump);
    } catch (err) {
      log.warn("Approve", "approve fee estimation failed, falling back", err);
    }
    return getFallbackFeeOverrides(APP_CHAIN_ID, "keeper");
  }, []);

  const assertContractTokenMatches = useCallback(async () => {
    const pc = publicClientRef.current;
    if (!pc) return;

    if (!CONTRACT_HAS_TOKEN_GETTER) {
      if (!tokenGetterWarningShownRef.current) {
        tokenGetterWarningShownRef.current = true;
        log.warn("AutoMine", "token preflight disabled for legacy contract profile");
      }
      return;
    }

    let deployedToken: `0x${string}`;
    try {
      deployedToken = (await pc.readContract({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "token",
      })) as `0x${string}`;
    } catch (err) {
      if (isMissingTokenGetterError(err)) {
        throw new Error(
          "Contract token() getter is required by this deployment profile but returned no data. Check NEXT_PUBLIC_CONTRACT_ADDRESS and NEXT_PUBLIC_CONTRACT_HAS_TOKEN_GETTER.",
        );
      }
      throw err;
    }

    if (deployedToken.toLowerCase() !== LINEA_TOKEN_ADDRESS.toLowerCase()) {
      throw new Error(`Contract token mismatch: expected ${LINEA_TOKEN_ADDRESS}, got ${deployedToken}`);
    }
  }, []);

  const getRequiredNativeCost = useCallback(
    async (gas: bigint, gasOverrides?: GasOverrides) => {
      const pc = publicClientRef.current;
      if (!pc) return BigInt(0);

      let feePerGas: bigint | undefined;
      if (gasOverrides) {
        if ("gasPrice" in gasOverrides) {
          feePerGas = gasOverrides.gasPrice;
        } else if ("maxFeePerGas" in gasOverrides) {
          feePerGas = gasOverrides.maxFeePerGas;
        }
      }

      if (!feePerGas) {
        const fees = await pc.estimateFeesPerGas();
        feePerGas = fees.maxFeePerGas ?? fees.gasPrice ?? BigInt(0);
      }

      return ((gas * feePerGas) * GAS_COST_BUFFER_BPS) / BPS_DENOMINATOR;
    },
    [],
  );

  const assertNativeGasBalance = useCallback(
    async (gas: bigint, gasOverrides?: GasOverrides) => {
      const pc = publicClientRef.current;
      const actorAddress = getActorAddress();
      if (!pc || !actorAddress) return;

      const [balance, requiredCost] = await Promise.all([
        pc.getBalance({ address: actorAddress as `0x${string}` }),
        getRequiredNativeCost(gas, gasOverrides),
      ]);

      if (balance < requiredCost) {
        const have = Number(balance) / 1e18;
        const need = Number(requiredCost) / 1e18;
        throw new Error(`Not enough ETH for gas: need ~${need.toFixed(6)} ETH, have ${have.toFixed(6)} ETH.`);
      }
    },
    [getActorAddress, getRequiredNativeCost],
  );

  const estimateGas = useCallback(
    async (functionName: string, args: readonly unknown[], bufferExtra: bigint) => {
      const minGas = functionName === "placeBatchBets" ? MIN_GAS_PLACE_BATCH : MIN_GAS_PLACE_BET;
      const pc = publicClientRef.current;
      const actorAddress = getActorAddress();
      if (!pc || !actorAddress) return minGas;
      try {
        const est = await pc.estimateContractGas({
          account: actorAddress as `0x${string}`,
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: functionName as "placeBet",
          args: args as [bigint, bigint],
        });
        const withBuffer = (est * BigInt(180)) / BigInt(100) + bufferExtra;
        return withBuffer > minGas ? withBuffer : minGas;
      } catch (err) {
        if (isNetworkError(err)) return minGas;
        throw err;
      }
    },
    [getActorAddress],
  );

  const ensureContractPreflight = useCallback(async () => {
    const pc = publicClientRef.current;
    if (!pc) return;
    await assertContractTokenMatches();
    await pc.readContract({
      address: CONTRACT_ADDRESS,
      abi: GAME_ABI,
      functionName: "currentEpoch",
    });
  }, [assertContractTokenMatches]);

  const readAllowance = useCallback(
    async (actorAddress: `0x${string}`) => {
      const pc = publicClientRef.current;
      if (!pc) return BigInt(0);
      return (await pc.readContract({
        address: LINEA_TOKEN_ADDRESS,
        abi: TOKEN_ABI,
        functionName: "allowance",
        args: [actorAddress, CONTRACT_ADDRESS],
      })) as bigint;
    },
    [],
  );

  const pollAllowanceUntil = useCallback(
    async (actorAddress: `0x${string}`, requiredAmount: bigint, timeoutMs: number) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try {
          const allowance = await readAllowance(actorAddress);
          if (allowance >= requiredAmount) return true;
        } catch {
          // ignore transient RPC issues during allowance polling
        }
        await delay(APPROVE_ALLOWANCE_POLL_MS);
      }
      return false;
    },
    [readAllowance],
  );

  const assertSufficientAllowance = useCallback(
    async (requiredAmount: bigint) => {
      const pc = publicClientRef.current;
      const actorAddress = getActorAddress();
      if (!pc || !actorAddress) return;
      const liveAllowance = await readAllowance(actorAddress as `0x${string}`);
      if (liveAllowance >= requiredAmount) return;
      const synced = await pollAllowanceUntil(
        actorAddress as `0x${string}`,
        requiredAmount,
        APPROVE_ALLOWANCE_SYNC_TIMEOUT_MS,
      );
      if (synced) return;
      if (liveAllowance < requiredAmount) {
        throw new Error("Insufficient allowance: approve transaction is missing, pending, or not yet indexed by RPC.");
      }
    },
    [getActorAddress, pollAllowanceUntil, readAllowance],
  );

  const ensureAllowance = useCallback(
    async (requiredAmount: bigint) => {
      const actorAddress = getActorAddress();
      if (!actorAddress || !publicClientRef.current) return;
      await ensurePreferredWalletRef.current?.();
      await ensureContractPreflight();
      const actor = actorAddress as `0x${string}`;
      let liveAllowance = await readAllowance(actor);
      if (liveAllowance >= requiredAmount) return;

      const pendingApprove = pendingApproveRef.current;
      if (pendingApprove) {
        const allowanceUpdated = await pollAllowanceUntil(actor, requiredAmount, 8_000);
        if (allowanceUpdated) {
          pendingApproveRef.current = null;
          refetchAllowanceRef.current();
          return;
        }
      }

      for (let attempt = 0; attempt < APPROVE_RETRY_MAX; attempt++) {
        liveAllowance = await readAllowance(actor);
        if (liveAllowance >= requiredAmount) {
          pendingApproveRef.current = null;
          refetchAllowanceRef.current();
          return;
        }

        const approveOverrides = await getApproveFees(attempt) ?? await getUrgentFees();
        const writeApproveOverrides =
          approveOverrides && "maxFeePerGas" in approveOverrides
            ? {
                maxFeePerGas: approveOverrides.maxFeePerGas,
                maxPriorityFeePerGas: approveOverrides.maxPriorityFeePerGas,
              }
            : {};
        await assertNativeGasBalance(MIN_GAS_APPROVE, approveOverrides);
        const approvalNonce = pendingApproveRef.current?.nonce ?? Number(
          await publicClientRef.current.getTransactionCount({
            address: actor,
            blockTag: "latest",
          }),
        );
        const silentSend = silentSendRef.current;
        let approveHash: `0x${string}`;
        if (silentSend) {
          const data = encodeFunctionData({
            abi: TOKEN_ABI,
            functionName: "approve",
            args: [CONTRACT_ADDRESS, maxUint256],
          });
          approveHash = await silentSend(
            { to: LINEA_TOKEN_ADDRESS, data, gas: MIN_GAS_APPROVE, nonce: approvalNonce },
            approveOverrides,
          );
        } else {
          approveHash = await writeContractAsyncRef.current({
            address: LINEA_TOKEN_ADDRESS, abi: TOKEN_ABI, functionName: "approve",
            args: [CONTRACT_ADDRESS, maxUint256],
            chainId: APP_CHAIN_ID,
            nonce: approvalNonce,
            ...writeApproveOverrides,
          }) as `0x${string}`;
        }
        pendingApproveRef.current = { hash: approveHash, submittedAt: Date.now(), nonce: approvalNonce };
        const approveState = await waitReceipt(approveHash as `0x${string}`);
        let allowanceUpdated = false;
        if (approveState === "pending") {
          log.warn("Approve", "approve tx still pending after timeout window", { hash: approveHash });
          allowanceUpdated = await pollAllowanceUntil(actor, requiredAmount, APPROVE_PENDING_TIMEOUT_MS);
        } else {
          allowanceUpdated = await pollAllowanceUntil(actor, requiredAmount, APPROVE_ALLOWANCE_SYNC_TIMEOUT_MS);
        }

        if (allowanceUpdated) {
          pendingApproveRef.current = null;
          refetchAllowanceRef.current();
          return;
        }

        if (attempt < APPROVE_RETRY_MAX - 1) {
          log.warn("Approve", `approval not visible on-chain yet, retrying ${attempt + 2}/${APPROVE_RETRY_MAX}`, {
            hash: approveHash,
          });
          await delay(APPROVE_ALLOWANCE_POLL_MS);
          continue;
        }

        const pendingAgeMs = pendingApproveRef.current ? Date.now() - pendingApproveRef.current.submittedAt : 0;
        throw new Error(
          pendingAgeMs > APPROVE_PENDING_TIMEOUT_MS
            ? "Approval transaction is still pending or underpriced. Retry once more to replace it."
            : "Approval transaction is still pending. Wait for confirmation before placing a bet.",
        );
      }
    },
    [
      assertNativeGasBalance,
      ensureContractPreflight,
      getActorAddress,
      getApproveFees,
      getUrgentFees,
      pollAllowanceUntil,
      readAllowance,
      waitReceipt,
    ],
  );

  const placeBets = useCallback(
    async (tiles: number[], singleAmountRaw: bigint, gasOverrides?: GasOverrides): Promise<ReceiptState> => {
      const normalizedTiles = normalizeTiles(tiles);
      if (normalizedTiles.length === 0) throw new Error("No valid tiles selected");
      await ensurePreferredWalletRef.current?.();
      await ensureContractPreflight();
      const totalAmountRaw = singleAmountRaw * BigInt(normalizedTiles.length);
      await ensureAllowance(totalAmountRaw);
      await assertSufficientAllowance(totalAmountRaw);
      const overrides = gasOverrides ?? (await getBumpedFees());
      if (normalizedTiles.length === 1) {
        const gas = await estimateGas("placeBet", [BigInt(normalizedTiles[0]), singleAmountRaw], BigInt(60000));
        await assertNativeGasBalance(gas, overrides);
        const txHash = await writeContractAsyncRef.current({
          address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "placeBet",
          args: [BigInt(normalizedTiles[0]), singleAmountRaw],
          chainId: APP_CHAIN_ID, gas, ...overrides,
        });
        return await waitReceipt(txHash as `0x${string}`);
      } else {
        const tileArgs = normalizedTiles.map((id) => BigInt(id));
        const amountArgs = normalizedTiles.map(() => singleAmountRaw);
        const gas = await estimateGas("placeBatchBets", [tileArgs, amountArgs], BigInt(120000));
        await assertNativeGasBalance(gas, overrides);
        const txHash = await writeContractAsyncRef.current({
          address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "placeBatchBets",
          args: [tileArgs, amountArgs],
          chainId: APP_CHAIN_ID, gas, ...overrides,
        });
        return await waitReceipt(txHash as `0x${string}`);
      }
    },
    [assertNativeGasBalance, assertSufficientAllowance, ensureAllowance, ensureContractPreflight, estimateGas, getBumpedFees, waitReceipt],
  );

  const placeBetsSilent = useCallback(
    async (tiles: number[], singleAmountRaw: bigint, gasOverrides?: GasOverrides): Promise<ReceiptState> => {
      const normalizedTiles = normalizeTiles(tiles);
      if (normalizedTiles.length === 0) throw new Error("No valid tiles selected");
      await ensurePreferredWalletRef.current?.();
      await ensureContractPreflight();
      const totalAmountRaw = singleAmountRaw * BigInt(normalizedTiles.length);
      await ensureAllowance(totalAmountRaw);
      await assertSufficientAllowance(totalAmountRaw);
      const pc = publicClientRef.current;
      const silentSend = silentSendRef.current;
      if (!pc || !silentSend) throw new Error("Privy wallet not ready");

      let data: `0x${string}`;
      let gas: bigint | undefined;

      // Extra gas buffer: placeBet may also auto-resolve the previous epoch
      if (normalizedTiles.length === 1) {
        gas = await estimateGas("placeBet", [BigInt(normalizedTiles[0]), singleAmountRaw], BigInt(140000));
        data = encodeFunctionData({
          abi: GAME_ABI, functionName: "placeBet",
          args: [BigInt(normalizedTiles[0]), singleAmountRaw],
        });
      } else {
        const tileArgs = normalizedTiles.map((id) => BigInt(id));
        const amountArgs = normalizedTiles.map(() => singleAmountRaw);
        gas = await estimateGas("placeBatchBets", [tileArgs, amountArgs], BigInt(240000));
        data = encodeFunctionData({
          abi: GAME_ABI, functionName: "placeBatchBets",
          args: [tileArgs, amountArgs],
        });
      }

      if (gas) {
        await assertNativeGasBalance(gas, gasOverrides);
      }
      let hash: `0x${string}`;
      try {
        hash = await silentSend({ to: CONTRACT_ADDRESS, data, gas }, gasOverrides);
      } catch (err) {
        if (isAmbiguousPendingTxError(err)) {
          log.warn("Mine", "silent send may already be pending, avoiding duplicate wallet fallback", err);
          return "pending";
        }
        throw err;
      }
      return await waitReceipt(hash, pc);
    },
    [assertNativeGasBalance, assertSufficientAllowance, ensureAllowance, ensureContractPreflight, estimateGas, waitReceipt],
  );

  const scheduleRefetch = useCallback(() => {
    if (scheduleRefetchTimerRef.current) clearTimeout(scheduleRefetchTimerRef.current);
    scheduleRefetchTimerRef.current = setTimeout(() => {
      scheduleRefetchTimerRef.current = null;
      refetchTileDataRef.current();
      refetchUserBetsRef.current();
    }, REFETCH_DELAY_MS);
  }, []);

  // --- Manual mining ---
  const placeBetsPreferSilent = useCallback(
    async (tiles: number[], singleAmountRaw: bigint, gasOverrides?: GasOverrides): Promise<ReceiptState> => {
      const silentSend = silentSendRef.current;
      if (silentSend) {
        try {
          return await placeBetsSilent(tiles, singleAmountRaw, gasOverrides);
        } catch (silentErr) {
          if (isSessionExpiredError(silentErr)) throw silentErr;
          log.warn("Mine", "silent send failed, fallback to wallet write", silentErr);
        }
      }
      return await placeBets(tiles, singleAmountRaw, gasOverrides);
    },
    [placeBets, placeBetsSilent],
  );

  const handleManualMine = useCallback(
    async (betAmountStr: string) => {
      const normalizedTiles = normalizeTiles(selectedTiles);
      if (normalizedTiles.length === 0) return false;
      const actorAddress = getActorAddress();
      if (!actorAddress) {
        alert("Wallet not ready. Reconnect wallet and try again.");
        return false;
      }
      setIsPending(true);
      try {
        const normalized = normalizeDecimalInput(betAmountStr);
        const parsed = Number(normalized);
        if (!normalized || isNaN(parsed) || parsed <= 0) throw new Error("Invalid bet amount");

        const singleAmountRaw = parseUnits(normalized, 18);
        const totalAmountRaw = singleAmountRaw * BigInt(normalizedTiles.length);

        try {
          const state = await placeBetsPreferSilent(normalizedTiles, singleAmountRaw);
          if (state === "pending") {
            log.warn("ManualMine", "bet tx is pending, skip immediate retry");
            setSelectedTiles([]);
            setSelectedTilesEpoch(null);
            scheduleRefetch();
            return true;
          }
        } catch (err) {
          if (!isRetryableError(err)) throw err;
          if (isAllowanceError(err)) {
            await ensureAllowance(totalAmountRaw);
          }
          if (isReceiptTimeoutError(err)) {
            log.warn("ManualMine", "bet receipt timeout, avoid duplicate resend");
            setSelectedTiles([]);
            setSelectedTilesEpoch(null);
            scheduleRefetch();
            return true;
          }
          // Before retry, check if the first tx actually landed on-chain
          const pc = publicClientRef.current;
          if (pc) {
            try {
              const epoch = (await pc.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "currentEpoch" })) as bigint;
              const bets = (await pc.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "getUserBetsAll", args: [epoch, actorAddress as `0x${string}`] })) as bigint[];
              const onChain = countConfirmedTiles(bets, normalizedTiles);
              if (onChain >= normalizedTiles.length) {
                log.info("ManualMine", `skipping retry – ${onChain} bets already on-chain`);
                setSelectedTiles([]);
                setSelectedTilesEpoch(null);
                scheduleRefetch();
                return true;
              }
            } catch { /* non-critical */ }
          }
          await delay(1500);
          const bumpedFees = await getBumpedFees(BigInt(130));
          const retryState = await placeBetsPreferSilent(normalizedTiles, singleAmountRaw, bumpedFees);
          if (retryState === "pending") {
            log.warn("ManualMine", "retry bet tx still pending, skip additional resend");
          }
        }

        setSelectedTiles([]);
        setSelectedTilesEpoch(null);
        scheduleRefetch();
        return true;
      } catch (err) {
        if (!isUserRejection(err)) {
          const reason = getBetErrorMessage(err);
          log.warn("ManualMine", "bet failed", { reason });
          alert(reason);
        }
        return false;
      } finally {
        setIsPending(false);
      }
    },
    [selectedTiles, ensureAllowance, placeBetsPreferSilent, scheduleRefetch, getBumpedFees, getActorAddress],
  );

  const handleDirectMine = useCallback(
    async (tiles: number[], betAmountStr: string) => {
      const normalizedTiles = normalizeTiles(tiles);
      if (normalizedTiles.length === 0) return false;
      const actorAddress = getActorAddress();
      if (!actorAddress) {
        alert("Wallet not ready. Reconnect wallet and try again.");
        return false;
      }
      if (autoMineRef.current) return false;
      setSelectedTiles(normalizedTiles);
      setSelectedTilesEpoch(null);
      setIsPending(true);
      try {
        const normalized = normalizeDecimalInput(betAmountStr);
        const parsed = Number(normalized);
        if (!normalized || isNaN(parsed) || parsed <= 0) throw new Error("Invalid bet amount");

        const singleAmountRaw = parseUnits(normalized, 18);
        const totalAmountRaw = singleAmountRaw * BigInt(normalizedTiles.length);

        try {
          const state = await placeBetsPreferSilent(normalizedTiles, singleAmountRaw);
          if (state === "pending") {
            log.warn("DirectMine", "bet tx is pending, skip immediate retry");
            setSelectedTiles([]);
            setSelectedTilesEpoch(null);
            scheduleRefetch();
            return true;
          }
        } catch (err) {
          if (!isRetryableError(err)) throw err;
          if (isAllowanceError(err)) {
            await ensureAllowance(totalAmountRaw);
          }
          if (isReceiptTimeoutError(err)) {
            log.warn("DirectMine", "bet receipt timeout, avoid duplicate resend");
            setSelectedTiles([]);
            setSelectedTilesEpoch(null);
            scheduleRefetch();
            return true;
          }
          const pc = publicClientRef.current;
          if (pc) {
            try {
              const epoch = (await pc.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "currentEpoch" })) as bigint;
              const bets = (await pc.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "getUserBetsAll", args: [epoch, actorAddress as `0x${string}`] })) as bigint[];
              const onChain = countConfirmedTiles(bets, normalizedTiles);
              if (onChain >= normalizedTiles.length) {
                log.info("DirectMine", `skipping retry – ${onChain} bets already on-chain`);
                setSelectedTiles([]);
                setSelectedTilesEpoch(null);
                scheduleRefetch();
                return true;
              }
            } catch { /* non-critical */ }
          }
          await delay(1500);
          const bumpedFees = await getBumpedFees(BigInt(130));
          const retryState = await placeBetsPreferSilent(normalizedTiles, singleAmountRaw, bumpedFees);
          if (retryState === "pending") {
            log.warn("DirectMine", "retry bet tx still pending, skip additional resend");
          }
        }

        setSelectedTiles([]);
        setSelectedTilesEpoch(null);
        scheduleRefetch();
        return true;
      } catch (err) {
        if (!isUserRejection(err)) {
          const reason = getBetErrorMessage(err);
          log.warn("DirectMine", "bet failed", { reason });
          alert(reason);
        }
        return false;
      } finally {
        setIsPending(false);
      }
    },
    [ensureAllowance, placeBetsPreferSilent, scheduleRefetch, getBumpedFees, getActorAddress],
  );

  // --- Auto-mining core: reads all volatile deps from refs ---
  const runAutoMining = useCallback(
    async (params: {
      betStr: string;
      blocks: number;
      rounds: number;
      startRoundIndex?: number;
      lastPlacedEpoch?: bigint | null;
    }) => {
      const { betStr, blocks, rounds, startRoundIndex = 0, lastPlacedEpoch: restoredLastEpoch = null } = params;
      const pc = publicClientRef.current;
      const actorAddress = getPreferredActorAddress();
      if (!actorAddress || !pc) {
        setAutoMineProgress("Embedded wallet not ready. Create it in Settings and retry.");
        setIsAutoMining(false);
        setRunningParams(null);
        return;
      }
      if (autoMineRef.current) return;
      if (autoMineRunInProgress) return;

      if (!(acquireTabLock() || ((await recoverOrphanedTabLock()) && acquireTabLock()))) {
        log.warn("AutoMine", "another tab is already mining – aborting start");
        setAutoMineProgress("Another tab is mining. Close it first.");
        await delay(5000);
        setIsAutoMining(false);
        setRunningParams(null);
        setAutoMineProgress(null);
        return;
      }
      autoMineRunInProgress = true;
      setIsAutoMining(true);
      autoMineRef.current = true;
      setSelectedTiles([]);
      setSelectedTilesEpoch(null);
      setRunningParams({ betStr, blocks, rounds });
      setAutoMineProgress(`${startRoundIndex} / ${rounds}`);
      log.info("AutoMine", "started", { betStr, blocks, rounds, startRoundIndex });

      // Wait for Privy wallet to become ready (up to 10s)
      if (!silentSendRef.current) {
        setAutoMineProgress("Waiting for wallet...");
        for (let w = 0; w < 20; w++) {
          await delay(500);
          if (silentSendRef.current) break;
        }
        if (!silentSendRef.current) {
          log.warn("AutoMine", "wallet not ready after 10s, falling back to writeContract");
        }
      }

      let stopReason = "unknown";
      try {
        const normalized = normalizeDecimalInput(betStr);
        const parsed = Number(normalized);
        if (!normalized || isNaN(parsed) || parsed <= 0) {
          throw new Error("Invalid bet size");
        }

        const singleAmountRaw = parseUnits(normalized, 18);
        const roundCost = singleAmountRaw * BigInt(blocks);
        const absoluteTotal = roundCost * BigInt(Math.max(0, rounds - startRoundIndex));

        // --- Check initial token balance (with network retry) ---
        let initBalance: bigint | null = null;
        for (let attempt = 0; attempt < NETWORK_RETRY_MAX; attempt++) {
          try {
            initBalance = (await pc.readContract({
              address: LINEA_TOKEN_ADDRESS, abi: TOKEN_ABI, functionName: "balanceOf", args: [actorAddress as `0x${string}`],
            })) as bigint;
            break;
          } catch (netErr) {
            if (!isNetworkError(netErr) || !autoMineRef.current) throw netErr;
            const wait = Math.min(NETWORK_BACKOFF_INITIAL_MS * 2 ** attempt, NETWORK_BACKOFF_MAX_MS);
            log.warn("AutoMine", `network error reading balance (retry ${attempt + 1}), waiting ${(wait / 1000).toFixed(0)}s...`, netErr);
            setAutoMineProgress(`RPC offline – retrying in ${(wait / 1000).toFixed(0)}s...`);
            await delay(wait);
          }
        }
        if (initBalance === null) throw new Error("Failed to read balance after retries");

        if (initBalance < roundCost) {
          const have = Number(initBalance) / 1e18;
          const need = Number(roundCost) / 1e18;
          setAutoMineProgress(`Cannot start: need ${need.toFixed(1)} LINEA per round, have ${have.toFixed(1)} LINEA`);
          autoMineRef.current = false;
          clearSession();
          await delay(5000);
          setIsAutoMining(false);
          setRunningParams(null);
          setAutoMineProgress(null);
          return;
        }

        // --- One-time unlimited approve (with network retry) ---
        let liveAllowance: bigint | null = null;
        for (let attempt = 0; attempt < NETWORK_RETRY_MAX; attempt++) {
          try {
            liveAllowance = (await pc.readContract({
              address: LINEA_TOKEN_ADDRESS, abi: TOKEN_ABI, functionName: "allowance",
                  args: [actorAddress as `0x${string}`, CONTRACT_ADDRESS],
            })) as bigint;
            break;
          } catch (netErr) {
            if (!isNetworkError(netErr) || !autoMineRef.current) throw netErr;
            const wait = Math.min(NETWORK_BACKOFF_INITIAL_MS * 2 ** attempt, NETWORK_BACKOFF_MAX_MS);
            log.warn("AutoMine", `network error reading allowance (retry ${attempt + 1}), waiting ${(wait / 1000).toFixed(0)}s...`, netErr);
            setAutoMineProgress(`RPC offline – retrying in ${(wait / 1000).toFixed(0)}s...`);
            await delay(wait);
          }
        }
        if (liveAllowance === null) throw new Error("Failed to read allowance after retries");

        if (liveAllowance < absoluteTotal) {
          let approvalConfirmed = false;
          for (let attempt = 0; attempt < APPROVE_RETRY_MAX; attempt++) {
            try {
              const approvalNonce = pendingApproveRef.current?.nonce ?? Number(
                await pc.getTransactionCount({
                  address: actorAddress as `0x${string}`,
                  blockTag: "latest",
                }),
              );
              const silentSend = silentSendRef.current;
              let approvalState: ReceiptState = "confirmed";
              const approveOverrides = await getUrgentFees();
              const writeApproveOverrides =
                approveOverrides && "maxFeePerGas" in approveOverrides
                  ? {
                      maxFeePerGas: approveOverrides.maxFeePerGas,
                      maxPriorityFeePerGas: approveOverrides.maxPriorityFeePerGas,
                    }
                  : {};
              if (silentSend) {
                const data = encodeFunctionData({
                  abi: TOKEN_ABI, functionName: "approve", args: [CONTRACT_ADDRESS, maxUint256],
                });
                await assertNativeGasBalance(MIN_GAS_APPROVE, approveOverrides);
                const approveHash = await silentSend(
                  { to: LINEA_TOKEN_ADDRESS, data, gas: MIN_GAS_APPROVE, nonce: approvalNonce },
                  approveOverrides,
                );
                pendingApproveRef.current = { hash: approveHash, submittedAt: Date.now(), nonce: approvalNonce };
                approvalState = await waitReceipt(approveHash, pc);
              } else {
                await ensurePreferredWalletRef.current?.();
                await assertNativeGasBalance(MIN_GAS_APPROVE, approveOverrides);
                const approveHash = await writeContractAsyncRef.current({
                  address: LINEA_TOKEN_ADDRESS, abi: TOKEN_ABI, functionName: "approve",
                  args: [CONTRACT_ADDRESS, maxUint256], chainId: APP_CHAIN_ID,
                  nonce: approvalNonce,
                  ...writeApproveOverrides,
                });
                pendingApproveRef.current = { hash: approveHash as `0x${string}`, submittedAt: Date.now(), nonce: approvalNonce };
                approvalState = await waitReceipt(approveHash as `0x${string}`, pc);
              }
              if (approvalState === "pending") {
                log.warn("AutoMine", "approve tx pending; waiting before another approve");
                await delay(4_000);
              }
            } catch (approveErr) {
              if (!isRetryableError(approveErr) && !isNetworkError(approveErr)) throw approveErr;
              log.warn("AutoMine", `approve confirmation retry ${attempt + 1}/${APPROVE_RETRY_MAX}`, approveErr);
            }

            refetchAllowanceRef.current();
            await delay(1_500);
            try {
              const refreshedAllowance = (await pc.readContract({
                address: LINEA_TOKEN_ADDRESS,
                abi: TOKEN_ABI,
                functionName: "allowance",
                args: [actorAddress as `0x${string}`, CONTRACT_ADDRESS],
              })) as bigint;
              if (refreshedAllowance >= absoluteTotal) {
                pendingApproveRef.current = null;
                approvalConfirmed = true;
                break;
              }
            } catch (allowanceErr) {
              if (!isNetworkError(allowanceErr)) throw allowanceErr;
            }

            if (attempt < APPROVE_RETRY_MAX - 1) {
              await delay(Math.min(2_000 * (attempt + 1), 5_000));
            }
          }

          if (!approvalConfirmed) {
            throw new Error("Approval not confirmed after retries");
          }
        }

        // --- Auto-mining loop ---
        let lastPlacedEpoch: bigint | null = restoredLastEpoch;
        let lastSessionRefresh = Date.now();
        let networkRetries = 0;

        for (let r = startRoundIndex; r < rounds; r++) {
          if (!autoMineRef.current) { stopReason = "user-stopped"; break; }
          renewTabLock();

          // Proactively refresh Privy session so signing keeps working for long runs
          const refreshFn = refreshSessionRef.current;
          if (refreshFn && Date.now() - lastSessionRefresh > SESSION_REFRESH_INTERVAL_MS) {
            try {
              await refreshFn();
              lastSessionRefresh = Date.now();
              log.info("AutoMine", "session refreshed");
            } catch (e) {
              log.warn("AutoMine", "session refresh failed (continuing)", e);
            }
          }

          if (lastPlacedEpoch !== null) {
            setAutoMineProgress(`${r} / ${rounds} – waiting for epoch to end...`);
            const waitPhaseStart = Date.now();
            const WAIT_FOR_EPOCH_MAX_MS = 75_000; // 75s max – avoid infinite wait if RPC/time is wrong
            // Wait until the epoch timer has expired; then placeBet immediately (it auto-resolves).
            while (autoMineRef.current) {
              if (Date.now() - waitPhaseStart > WAIT_FOR_EPOCH_MAX_MS) {
                log.warn("AutoMine", "wait for epoch timeout – proceeding to place bet", { lastPlacedEpoch: lastPlacedEpoch.toString() });
                setAutoMineProgress(`${r} / ${rounds} – epoch wait timeout, placing bet...`);
                break;
              }
              try {
                const currentPc = publicClientRef.current;
                if (!currentPc) { await delay(200); continue; }
                const endTime = (await currentPc.readContract({
                  address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "getEpochEndTime",
                  args: [lastPlacedEpoch],
                })) as bigint;
                const nowSec = BigInt(Math.floor(Date.now() / 1000));
                if (nowSec >= endTime) break;
                const secLeft = Number(endTime - nowSec);
                const waitMs = secLeft <= 10
                  ? Math.min(secLeft * 1000 + 100, 300)
                  : secLeft <= 60
                    ? Math.min(secLeft * 1000 + 200, 500)
                    : Math.min(secLeft * 1000 + 300, 2000);
                renewTabLock();
                await delay(waitMs);
              } catch (err) {
                log.warn("AutoMine", "getEpochEndTime failed in wait loop, retrying", err);
                await delay(500);
              }
            }
            if (!autoMineRef.current) { stopReason = "user-stopped"; break; }

            // Gas saver: prefer letting another player resolve first.
            // If epoch is still not advanced, wait a short grace window before placing.
            try {
              const currentPc = publicClientRef.current;
              if (currentPc) {
                let latestEpoch = (await currentPc.readContract({
                  address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "currentEpoch",
                })) as bigint;
                if (latestEpoch <= lastPlacedEpoch) {
                  const graceStart = Date.now();
                  const initialJitterMs = 400 + getSecureRandomNumber(1000);
                  setAutoMineProgress(`${r} / ${rounds} – waiting first resolver...`);
                  await delay(initialJitterMs);
                  while (autoMineRef.current && Date.now() - graceStart < EXTERNAL_RESOLVE_GRACE_MAX_MS) {
                    latestEpoch = (await currentPc.readContract({
                      address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "currentEpoch",
                    })) as bigint;
                    if (latestEpoch > lastPlacedEpoch) {
                      log.info("AutoMine", "epoch advanced by other player – placing without resolve race", {
                        previousEpoch: lastPlacedEpoch.toString(),
                        latestEpoch: latestEpoch.toString(),
                      });
                      break;
                    }
                    await delay(EXTERNAL_RESOLVE_POLL_MS);
                  }
                }
              }
            } catch (resolveWaitErr) {
              log.warn("AutoMine", "external resolver grace check failed, placing anyway", resolveWaitErr);
            }

            await ensurePreferredWalletRef.current?.();
            refetchEpochRef.current?.();
            setAutoMineProgress(`${r} / ${rounds} – placing bet (${blocks} tiles)...`);
          }

          // --- Inner round body wrapped with network retry ---
          let roundTilesToBet: number[] = [];
          let roundCandidateEpochs: bigint[] = [];
          try {
            const currentPc = publicClientRef.current;
            if (!currentPc) { stopReason = "no-client"; break; }

            const liveEpochNow = (await currentPc.readContract({
              address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "currentEpoch",
            })) as bigint;

            // If the epoch hasn't been resolved yet (same as last bet), our placeBet
            // will call _autoResolveIfNeeded() and the bet lands in the NEXT epoch.
            // Don't check existing bets in the old epoch — just pick fresh tiles.
            const epochNeedsResolve = lastPlacedEpoch !== null && liveEpochNow <= lastPlacedEpoch;

            const effectiveBlocks = Math.min(blocks, GRID_SIZE);
            let tilesToAdd = effectiveBlocks;
            const alreadyBetTiles = new Set<number>();

            if (!epochNeedsResolve) {
              const existingBets = (await currentPc.readContract({
                address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "getUserBetsAll",
                args: [liveEpochNow, actorAddress as `0x${string}`],
              })) as bigint[];

              existingBets.forEach((b, i) => { if (b > BigInt(0)) alreadyBetTiles.add(i + 1); });

              if (alreadyBetTiles.size >= effectiveBlocks) {
                log.info("AutoMine", `skipping round ${r + 1} – already bet on ${alreadyBetTiles.size}/${effectiveBlocks} tiles in epoch ${liveEpochNow}`, {
                  betTiles: [...alreadyBetTiles],
                });
                setSelectedTiles([]);
                setSelectedTilesEpoch(null);
                lastPlacedEpoch = liveEpochNow;
                saveSession({
                  active: true, betStr, blocks, rounds,
                  nextRoundIndex: r + 1,
                  lastPlacedEpoch: lastPlacedEpoch.toString(),
                });
                networkRetries = 0;
                continue;
              }

              tilesToAdd = effectiveBlocks - alreadyBetTiles.size;
            }

            const roundCostActual = singleAmountRaw * BigInt(tilesToAdd);

            const tokenBal = (await currentPc.readContract({
              address: LINEA_TOKEN_ADDRESS, abi: TOKEN_ABI, functionName: "balanceOf", args: [actorAddress as `0x${string}`],
            })) as bigint;

            if (tokenBal < roundCostActual) {
              const have = Number(tokenBal) / 1e18;
              const need = Number(roundCostActual) / 1e18;
              setAutoMineProgress(`Stopped: need ${need.toFixed(1)} LINEA, have ${have.toFixed(1)} LINEA`);
              autoMineRef.current = false;
              stopReason = "insufficient-balance";
              clearSession();
              await delay(3500);
              break;
            }

            const tileSet = new Set<number>();
            let safetyCounter = 0;
            while (tileSet.size < tilesToAdd && safetyCounter < 500) {
              const candidate = getSecureRandomNumber(GRID_SIZE) + 1;
              if (!alreadyBetTiles.has(candidate)) tileSet.add(candidate);
              safetyCounter++;
            }
            const tilesToBet = normalizeTiles([...tileSet]);
            roundTilesToBet = tilesToBet;
            roundCandidateEpochs = epochNeedsResolve
              ? [liveEpochNow + 1n, liveEpochNow + 2n, liveEpochNow]
              : [liveEpochNow, liveEpochNow + 1n, liveEpochNow + 2n];

            if (epochNeedsResolve) {
              log.info("AutoMine", `round ${r + 1}: epoch ${liveEpochNow} needs resolve – bet will auto-resolve, tiles=[${tilesToBet.join(",")}]`);
            }

            log.info("AutoMine", `round ${r + 1}: blocks=${blocks}, effectiveBlocks=${effectiveBlocks}, tiles=[${tilesToBet.join(",")}], existingBets=[${[...alreadyBetTiles].join(",")}], epoch=${liveEpochNow}`);

            const selectionEpoch = (epochNeedsResolve ? (liveEpochNow + BigInt(1)) : liveEpochNow).toString();
            setSelectedTiles(tilesToBet);
            setSelectedTilesEpoch(selectionEpoch);
            setAutoMineProgress(`${r + 1} / ${rounds} – placing bet (${tilesToBet.length} tiles)...`);

            saveSession({
              active: true, betStr, blocks, rounds,
              nextRoundIndex: r,
              lastPlacedEpoch: liveEpochNow.toString(),
            });

            const placeBetOnce = async (overrides?: GasOverrides): Promise<ReceiptState> => {
              const silentSend = silentSendRef.current;
              if (silentSend) {
                try {
                  return await placeBetsSilent(tilesToBet, singleAmountRaw, overrides);
                } catch (silentErr) {
                  // Fallback path: if silent signer fails unexpectedly, use regular wagmi write flow.
                  if (isSessionExpiredError(silentErr)) throw silentErr;
                  log.warn("AutoMine", "silent send failed, falling back to wallet write", silentErr);
                  return await placeBets(tilesToBet, singleAmountRaw, overrides);
                }
              }
              return await placeBets(tilesToBet, singleAmountRaw, overrides);
            };

            let betAttempts = 0;
            let skippedEpochEnded = false;
            let betAlreadyConfirmedOnChain = false;
            let confirmedOnChainEpoch: bigint | null = null;
            while (betAttempts < MAX_BET_ATTEMPTS) {
              if (!autoMineRef.current) { break; }
              try {
                // Before retrying, check if a previous attempt already went through on-chain
                if (betAttempts > 0) {
                  const confirmedRound = await findConfirmedEpochForTiles(
                    currentPc,
                    actorAddress as `0x${string}`,
                    roundCandidateEpochs,
                    tilesToBet,
                  );
                  if (confirmedRound) {
                    log.info(
                      "AutoMine",
                      `pre-retry check: found ${confirmedRound.confirmedCount}/${tilesToBet.length} target bets in epoch ${confirmedRound.epoch} - skipping retry`,
                    );
                    betAlreadyConfirmedOnChain = true;
                    confirmedOnChainEpoch = confirmedRound.epoch;
                    break;
                  }
                  try {
                    const recheckBets = (await currentPc.readContract({
                      address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "getUserBetsAll",
                      args: [liveEpochNow, actorAddress as `0x${string}`],
                    })) as bigint[];
                    const recheckCount = countConfirmedTiles(recheckBets, tilesToBet);
                    if (recheckCount >= tilesToBet.length) {
                      log.info("AutoMine", `pre-retry check: ${recheckCount}/${effectiveBlocks} bets already on-chain in epoch ${liveEpochNow} – skipping retry`);
                      betAlreadyConfirmedOnChain = true;
                      break;
                    }
                  } catch {
                    // non-critical check
                  }
                }

                const gasBumpPercent = GAS_BUMP_BASE + BigInt(betAttempts) * GAS_BUMP_REPLACEMENT_STEP;
                const feeOverrides = await getBumpedFees(gasBumpPercent);
                const state = await placeBetOnce(feeOverrides);
                if (state === "pending") {
                  log.warn("AutoMine", `round ${r + 1}: bet tx pending, waiting before next action`);
                  setAutoMineProgress(`${r + 1} / ${rounds} – tx pending, waiting confirmation...`);
                  await delay(4_000);
                }
                break;
              } catch (err) {
                const errMsg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
                if (isEpochEndedError(err)) {
                  log.warn("AutoMine", `round ${r + 1} skipped – epoch ended (tx too late), continuing next round`, { epoch: liveEpochNow.toString() });
                  setAutoMineProgress(`${r + 1} / ${rounds} – skipped (epoch ended), next round...`);
                  setSelectedTiles([]);
                  setSelectedTilesEpoch(null);
                  lastPlacedEpoch = liveEpochNow;
                  saveSession({
                    active: true, betStr, blocks, rounds,
                    nextRoundIndex: r + 1,
                    lastPlacedEpoch: lastPlacedEpoch.toString(),
                  });
                  await delay(250);
                  skippedEpochEnded = true;
                  break;
                }
                if (isInsufficientFundsError(err)) {
                  throw err;
                }
                if (isNetworkError(err)) {
                  betAttempts++;
                  if (betAttempts >= MAX_BET_ATTEMPTS) throw err;
                  const wait = Math.min(NETWORK_BACKOFF_INITIAL_MS * 2 ** (betAttempts - 1), NETWORK_BACKOFF_MAX_MS);
                  log.warn("AutoMine", `bet network error (attempt ${betAttempts}/${MAX_BET_ATTEMPTS}), waiting ${(wait / 1000).toFixed(0)}s...`, err);
                  setAutoMineProgress(`${r + 1} / ${rounds} – RPC offline, retry in ${(wait / 1000).toFixed(0)}s...`);
                  await delay(wait);
                  continue;
                }
                if (isSessionExpiredError(err) && betAttempts < 2) {
                  betAttempts++;
                  log.warn("AutoMine", `session signing error (attempt ${betAttempts}), refreshing session...`, err);
                  setAutoMineProgress(`${r + 1} / ${rounds} – session error, refreshing (${betAttempts}/2)...`);
                  const refreshFn2 = refreshSessionRef.current;
                  if (refreshFn2) {
                    try { await refreshFn2(); lastSessionRefresh = Date.now(); } catch { /* ignore */ }
                  }
                  await delay(1500);
                  continue;
                }
                const isReplacementUnderpriced = errMsg.includes("replacement transaction underpriced");
                betAttempts++;
                if (!isRetryableError(err) || betAttempts >= MAX_BET_ATTEMPTS) throw err;
                if (isReplacementUnderpriced) {
                  log.warn("AutoMine", `replacement underpriced (attempt ${betAttempts}/${MAX_BET_ATTEMPTS}), bumping gas aggressively`);
                  setAutoMineProgress(`${r + 1} / ${rounds} – gas bump retry (${betAttempts}/${MAX_BET_ATTEMPTS})...`);
                  await delay(1000);
                } else {
                  log.warn("AutoMine", `bet retry ${betAttempts}/${MAX_BET_ATTEMPTS}`, err);
                  setAutoMineProgress(`${r + 1} / ${rounds} – retrying (${betAttempts}/${MAX_BET_ATTEMPTS})...`);
                  await delay(750 * betAttempts);
                }
              }
            }

            if (skippedEpochEnded) { networkRetries = 0; continue; }
            if (betAlreadyConfirmedOnChain) {
              const detectedEpoch = confirmedOnChainEpoch ?? liveEpochNow;
              lastPlacedEpoch = detectedEpoch;
              setSelectedTiles(tilesToBet);
              setSelectedTilesEpoch(detectedEpoch.toString());
              setAutoMineProgress(`${r + 1} / ${rounds} – confirmed (detected on-chain)`);
              onAutoMineBetConfirmedRef.current?.();
              log.info("AutoMine", `round ${r + 1}/${rounds} detected on-chain`, { epoch: lastPlacedEpoch.toString() });
              saveSession({
                active: true, betStr, blocks, rounds,
                nextRoundIndex: r + 1,
                lastPlacedEpoch: lastPlacedEpoch.toString(),
              });
              networkRetries = 0;
              refetchEpochRef.current?.();
              refetchGridEpochDataRef.current?.();
              refetchTileDataRef.current();
              refetchUserBetsRef.current();
              setTimeout(() => {
                refetchTileDataRef.current();
                refetchUserBetsRef.current();
              }, 1500);
              setTimeout(() => {
                setSelectedTiles([]);
                setSelectedTilesEpoch(null);
              }, 3500);
              await delay(REFETCH_DELAY_MS);
              continue;
            }

            setSelectedTiles([]);
            setSelectedTilesEpoch(null);
            setAutoMineProgress(`${r + 1} / ${rounds} – confirmed`);
            onAutoMineBetConfirmedRef.current?.();

            // If our bet auto-resolved the previous epoch, immediately tell UI so
            // the reveal animation starts while we verify bets in parallel.
            if (epochNeedsResolve) {
              refetchEpochRef.current?.();
            }

            // Determine the actual epoch where bets landed (may differ from liveEpochNow if epoch changed during tx)
            let actualBetEpoch = epochNeedsResolve ? liveEpochNow + BigInt(1) : liveEpochNow;
            await delay(1200);
            try {
              const verifyBets = (await currentPc.readContract({
                address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "getUserBetsAll",
                args: [liveEpochNow, actorAddress as `0x${string}`],
              })) as bigint[];
              const countInExpected = countConfirmedTiles(verifyBets, tilesToBet);

              if (countInExpected >= tilesToBet.length) {
                log.info("AutoMine", `round ${r + 1}/${rounds} confirmed | epoch=${liveEpochNow}, bets=${countInExpected}/${effectiveBlocks}`);
              } else {
                // Bets likely landed in the next epoch
                const nextEpoch = liveEpochNow + BigInt(1);
                try {
                  const nextBets = (await currentPc.readContract({
                    address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "getUserBetsAll",
                    args: [nextEpoch, actorAddress as `0x${string}`],
                  })) as bigint[];
                  const countInNext = countConfirmedTiles(nextBets, tilesToBet);
                  if (countInNext >= tilesToBet.length) {
                    actualBetEpoch = nextEpoch;
                    log.info("AutoMine", `round ${r + 1}/${rounds} confirmed | bets landed in next epoch=${nextEpoch} (expected ${liveEpochNow}), bets=${countInNext}/${effectiveBlocks}`);
                  } else if (countInExpected === 0 && countInNext === 0) {
                    // RPC lag or bets in epoch+2 – retry once after delay, then check epoch+2
                    await delay(1200);
                    const recheckNext = (await currentPc.readContract({
                      address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "getUserBetsAll",
                      args: [nextEpoch, actorAddress as `0x${string}`],
                    })) as bigint[];
                    const recheckNextCount = countConfirmedTiles(recheckNext, tilesToBet);
                    if (recheckNextCount >= tilesToBet.length) {
                      actualBetEpoch = nextEpoch;
                      log.info("AutoMine", `round ${r + 1}/${rounds} confirmed | bets in epoch ${nextEpoch} (RPC lag), bets=${recheckNextCount}/${effectiveBlocks}`);
                    } else {
                      try {
                        const epochPlus2 = liveEpochNow + BigInt(2);
                        const betsE2 = (await currentPc.readContract({
                          address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "getUserBetsAll",
                          args: [epochPlus2, actorAddress as `0x${string}`],
                        })) as bigint[];
                        const countE2 = countConfirmedTiles(betsE2, tilesToBet);
                        if (countE2 >= tilesToBet.length) {
                          actualBetEpoch = epochPlus2;
                          log.info("AutoMine", `round ${r + 1}/${rounds} confirmed | bets in epoch+2=${epochPlus2}, bets=${countE2}/${effectiveBlocks}`);
                        } else {
                          log.warn("AutoMine", `post-bet verify: ${countInExpected}/${effectiveBlocks} in ${liveEpochNow}, ${countInNext} in ${nextEpoch}, ${countE2} in ${epochPlus2}`);
                        }
                      } catch {
                        log.warn("AutoMine", `post-bet verify: ${countInExpected} in epoch ${liveEpochNow}, ${countInNext} in epoch ${nextEpoch} – expected ${effectiveBlocks}`);
                      }
                    }
                  } else {
                    log.warn("AutoMine", `post-bet verify: ${countInExpected} in epoch ${liveEpochNow}, ${countInNext} in epoch ${nextEpoch} – expected ${effectiveBlocks}`);
                  }
                } catch {
                  log.info("AutoMine", `round ${r + 1}/${rounds} confirmed | ${countInExpected}/${effectiveBlocks} bets in epoch ${liveEpochNow}`);
                }
              }
            } catch {
              // non-critical
            }

            lastPlacedEpoch = actualBetEpoch;

            saveSession({
              active: true, betStr, blocks, rounds,
              nextRoundIndex: r + 1,
              lastPlacedEpoch: lastPlacedEpoch.toString(),
            });
            networkRetries = 0;
            refetchEpochRef.current?.();
            refetchGridEpochDataRef.current?.();
            refetchTileDataRef.current();
            refetchUserBetsRef.current();
            setTimeout(() => {
              refetchTileDataRef.current();
              refetchUserBetsRef.current();
            }, 1500);
            setTimeout(() => {
              setSelectedTiles([]);
              setSelectedTilesEpoch(null);
            }, 3500);
            await delay(REFETCH_DELAY_MS);

          } catch (roundErr) {
            if (isInsufficientFundsError(roundErr)) throw roundErr;
            // Network errors: backoff and retry the same round instead of dying
            if (isNetworkError(roundErr) && autoMineRef.current) {
              networkRetries++;
              if (networkRetries > NETWORK_RETRY_MAX) {
                log.error("AutoMine", `network down for ${NETWORK_RETRY_MAX} retries, giving up`);
                throw roundErr;
              }
              const wait = Math.min(NETWORK_BACKOFF_INITIAL_MS * 2 ** Math.min(networkRetries - 1, 6), NETWORK_BACKOFF_MAX_MS);
              log.warn("AutoMine", `network error on round ${r + 1} (retry ${networkRetries}/${NETWORK_RETRY_MAX}), waiting ${(wait / 1000).toFixed(0)}s...`, roundErr);
              setAutoMineProgress(`RPC offline – retry ${networkRetries} in ${(wait / 1000).toFixed(0)}s...`);
              await delay(wait);

              // Before re-entering the round body, wait for RPC to settle and
              // check if the failed tx actually placed bets on-chain.
              // This prevents duplicate bets when the receipt timed out but the tx confirmed.
              const currentPcCheck = publicClientRef.current;
              if (currentPcCheck) {
                try {
                  const checkEpoch = (await currentPcCheck.readContract({
                    address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "currentEpoch",
                  })) as bigint;
                  const confirmedRound = await findConfirmedEpochForTiles(
                    currentPcCheck,
                    actorAddress as `0x${string}`,
                    [checkEpoch, checkEpoch + 1n, ...roundCandidateEpochs],
                    roundTilesToBet,
                  );
                  if (confirmedRound) {
                    log.info(
                      "AutoMine",
                      `post-error check: found ${confirmedRound.confirmedCount}/${roundTilesToBet.length} target bets in epoch ${confirmedRound.epoch} - skipping re-bet`,
                    );
                    lastPlacedEpoch = confirmedRound.epoch;
                    setSelectedTiles(roundTilesToBet);
                    setSelectedTilesEpoch(confirmedRound.epoch.toString());
                    setAutoMineProgress(`${r + 1} / ${rounds} вЂ“ confirmed (detected after RPC error)`);
                    onAutoMineBetConfirmedRef.current?.();
                    saveSession({
                      active: true, betStr, blocks, rounds,
                      nextRoundIndex: r + 1,
                      lastPlacedEpoch: lastPlacedEpoch.toString(),
                    });
                    networkRetries = 0;
                    refetchEpochRef.current?.();
                    refetchGridEpochDataRef.current?.();
                    refetchTileDataRef.current();
                    refetchUserBetsRef.current();
                    setTimeout(() => {
                      refetchTileDataRef.current();
                      refetchUserBetsRef.current();
                    }, 1500);
                    setTimeout(() => {
                      setSelectedTiles([]);
                      setSelectedTilesEpoch(null);
                    }, 3500);
                    await delay(REFETCH_DELAY_MS);
                    continue; // skip to next round (no r--)
                  }
                  const checkBets = (await currentPcCheck.readContract({
                    address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "getUserBetsAll",
                    args: [checkEpoch, actorAddress as `0x${string}`],
                  })) as bigint[];
                  const alreadyCount = countConfirmedTiles(checkBets, roundTilesToBet);
                  const effBlocks = roundTilesToBet.length || Math.min(blocks, GRID_SIZE);
                  if (alreadyCount >= effBlocks) {
                    log.info("AutoMine", `post-error check: found ${alreadyCount}/${effBlocks} bets already in epoch ${checkEpoch} – skipping re-bet`);
                    lastPlacedEpoch = checkEpoch;
                    setSelectedTiles(roundTilesToBet);
                    setSelectedTilesEpoch(checkEpoch.toString());
                    setAutoMineProgress(`${r + 1} / ${rounds} вЂ“ confirmed (detected after RPC error)`);
                    onAutoMineBetConfirmedRef.current?.();
                    saveSession({
                      active: true, betStr, blocks, rounds,
                      nextRoundIndex: r + 1,
                      lastPlacedEpoch: lastPlacedEpoch.toString(),
                    });
                    networkRetries = 0;
                    refetchEpochRef.current?.();
                    refetchGridEpochDataRef.current?.();
                    refetchTileDataRef.current();
                    refetchUserBetsRef.current();
                    setTimeout(() => {
                      refetchTileDataRef.current();
                      refetchUserBetsRef.current();
                    }, 1500);
                    setTimeout(() => {
                      setSelectedTiles([]);
                      setSelectedTilesEpoch(null);
                    }, 3500);
                    await delay(REFETCH_DELAY_MS);
                    continue; // skip to next round (no r--)
                  }
                  log.info("AutoMine", `post-error check: ${alreadyCount}/${effBlocks} bets in epoch ${checkEpoch} – will retry`);
                } catch (checkErr) {
                  log.warn("AutoMine", "post-error bet check failed, retrying round anyway", checkErr);
                }
              }

              r--; // retry the same round
              continue;
            }
            throw roundErr;
          }
        }
        if (autoMineRef.current) {
          stopReason = "completed";
          setAutoMineProgress(`Completed ${rounds}/${rounds} rounds`);
          clearSession();
          await delay(1500);
        }
        log.info("AutoMine", `loop finished | reason=${stopReason}`);
      } catch (err) {
        stopReason = "error";
        const rawMsg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
        const sessionExpired = isSessionExpiredError(err);
        const networkDown = isNetworkError(err);
        const walletUnavailable =
          rawMsg.includes("wallet not ready") ||
          rawMsg.includes("wallet not found") ||
          rawMsg.includes("embedded wallet not found");
        if (isInsufficientFundsError(err)) {
          log.warn("AutoMine", "loop stopped: insufficient gas funds", err);
        } else if (networkDown) {
          log.warn("AutoMine", "loop paused by network/receipt timeout", err);
        } else if (walletUnavailable) {
          log.warn("AutoMine", "loop paused: embedded wallet not ready", err);
        } else {
          log.error("AutoMine", "loop error", err);
        }
        if (!isUserRejection(err)) {
          let userMsg: string;
          if (sessionExpired) {
            sessionExpiredErrorRef.current = true;
            userMsg = "Session expired. Log out, log in again, then reload this page – the bot will auto-resume.";
          } else if (networkDown) {
            userMsg = "Auto-miner paused: RPC offline for too long. Will auto-resume on page reload.";
          } else if (rawMsg.includes("replacement transaction underpriced")) {
            userMsg = "Stopped: replacement tx underpriced. Press START BOT again to continue.";
          } else if (isInsufficientFundsError(err) || rawMsg.includes("not enough eth for gas")) {
            userMsg = `Auto-miner stopped: ${firstErrorLine(err)}`;
          } else if (rawMsg.includes("contract token mismatch")) {
            userMsg = `Auto-miner stopped: ${firstErrorLine(err)}`;
          } else if (rawMsg.includes("epoch ended")) {
            userMsg = "Round skipped (epoch ended). Press START BOT to continue.";
          } else if (rawMsg.includes("gas required exceeds") || rawMsg.includes("reverted")) {
            userMsg = `Auto-miner stopped: ${firstErrorLine(err)}`;
          } else if (rawMsg.includes("timeout")) {
            userMsg = "Auto-miner stopped: network timeout.";
          } else if (rawMsg.includes("wallet not ready") || rawMsg.includes("wallet not found")) {
            userMsg = "Auto-miner stopped: Privy wallet not ready. Retry in a moment.";
          } else {
            userMsg = "Auto-miner error: " + (err instanceof Error ? err.message : String(err));
          }
          setAutoMineProgress(userMsg);
          const noFunds = isInsufficientFundsError(err);
          await delay(noFunds ? 2000 : 8000);
        }
        autoMineRef.current = false;
        // Keep session alive for network errors so reload can resume
        // Insufficient funds → clear session so bot doesn't auto-resume into the same error
        if (!sessionExpired && !networkDown) clearSession();
      } finally {
        log.info("AutoMine", "stopped", { reason: stopReason });
        setIsAutoMining(false);
        autoMineRef.current = false;
        setRunningParams(null);
        setSelectedTiles([]);
        setSelectedTilesEpoch(null);
        if (!sessionExpiredErrorRef.current) setAutoMineProgress(null);
        sessionExpiredErrorRef.current = false;
        autoMineRunInProgress = false;
        releaseTabLock();
      }
    },
    // Minimal deps – all volatile functions read from refs
    [assertNativeGasBalance, getUrgentFees, placeBets, placeBetsSilent, waitReceipt, getBumpedFees, getPreferredActorAddress],
  );

  // Ref to always hold the latest runAutoMining – decouples it from the restore effect
  const runAutoMiningRef = useRef(runAutoMining);
  useEffect(() => {
    runAutoMiningRef.current = runAutoMining;
  }, [runAutoMining]);

  // --- Auto mining toggle ---
  const handleAutoMineToggle = useCallback(
    async (betStr: string, blocks: number, rounds: number) => {
      if (!publicClientRef.current) return;

      if (isAutoMining) {
        autoMineRef.current = false;
        setIsAutoMining(false);
        setRunningParams(null);
        setAutoMineProgress(null);
        clearSession();
        releaseTabLock();
        return;
      }

      if (!getPreferredActorAddress()) {
        setAutoMineProgress("Create an embedded wallet first, then start the bot.");
        return;
      }

      sessionExpiredErrorRef.current = false;
      saveSession({
        active: true, betStr, blocks, rounds,
        nextRoundIndex: 0, lastPlacedEpoch: null,
      });

      await runAutoMiningRef.current({ betStr, blocks, rounds });
    },
    [getPreferredActorAddress, isAutoMining],
  );

  // --- Restore auto-miner after page reload ---
  useEffect(() => {
    if (restoreAttemptedRef.current) return;
    if (!hasPreferredActor || !publicClient) return;

    restoreAttemptedRef.current = true;

    const timeoutId = setTimeout(() => {
      const saved = readSession();
      log.info("AutoMine", "restore check", { hasSaved: !!saved, nextRound: saved?.nextRoundIndex, totalRounds: saved?.rounds });

      if (!saved || !saved.active || saved.nextRoundIndex >= saved.rounds) {
        if (saved) clearSession();
        // Clean up the optimistic UI from the hydration sync effect
        setIsAutoMining(false);
        setRunningParams(null);
        setAutoMineProgress(null);
        return;
      }

      setIsAutoMining(true);
      setRunningParams({ betStr: saved.betStr, blocks: saved.blocks, rounds: saved.rounds });
      setAutoMineProgress("Restoring...");
      const lastEpoch = saved.lastPlacedEpoch ? BigInt(saved.lastPlacedEpoch) : null;
      void runAutoMiningRef.current({
        betStr: saved.betStr,
        blocks: saved.blocks,
        rounds: saved.rounds,
        startRoundIndex: saved.nextRoundIndex,
        lastPlacedEpoch: lastEpoch,
      });
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [hasPreferredActor, publicClient]);

  useEffect(() => {
    const onBeforeUnload = () => {
      if (autoMineRef.current) {
        log.warn("AutoMine", "tab closing while mining – releasing lock");
      }
      releaseTabLock();
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (scheduleRefetchTimerRef.current) clearTimeout(scheduleRefetchTimerRef.current);
    };
  }, []);

  const handleTileClick = useCallback(
    (tileId: number, isRevealing: boolean) => {
      if (isRevealing || autoMineRef.current) return;
      setSelectedTilesEpoch(null);
      setSelectedTiles((prev) =>
        prev.includes(tileId) ? prev.filter((id) => id !== tileId) : [...prev, tileId],
      );
    },
    [],
  );

  const setTiles = useCallback((tiles: number[]) => {
    if (autoMineRef.current) return;
    setSelectedTilesEpoch(null);
    setSelectedTiles(normalizeTiles(tiles));
  }, []);

  return {
    isPending,
    selectedTiles,
    selectedTilesEpoch,
    isAutoMining,
    autoMineProgress,
    runningParams,
    handleManualMine,
    handleDirectMine,
    handleAutoMineToggle,
    handleTileClick,
    setTiles,
  };
}
