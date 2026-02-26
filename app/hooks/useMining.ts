"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { parseUnits, maxUint256, encodeFunctionData } from "viem";
import type { PublicClient } from "viem";
import {
  CONTRACT_ADDRESS, LINEA_TOKEN_ADDRESS,
  GAME_ABI, TOKEN_ABI,
  GRID_SIZE, REFETCH_DELAY_MS, APP_CHAIN_ID,
  TX_RECEIPT_TIMEOUT_MS, MAX_BET_ATTEMPTS,
} from "../lib/constants";
import { normalizeDecimalInput, delay, isUserRejection } from "../lib/utils";
import { log } from "../lib/logger";

export type GasOverrides = { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } | { gasPrice?: bigint };

type SilentSendFn = (tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint }, gasOverrides?: GasOverrides) => Promise<`0x${string}`>;

/** Call periodically to refresh Privy auth/session so wallet signing keeps working. */
export type RefreshSessionFn = () => Promise<void>;

interface UseMiningOptions {
  refetchAllowance: () => void;
  refetchTileData: () => void;
  refetchUserBets: () => void;
  refetchEpoch?: () => void;
  ensurePreferredWallet?: () => Promise<void> | void;
  sendTransactionSilent?: SilentSendFn;
  /** Optional: call every ~20 min while bot runs to keep Privy session valid (e.g. () => getAccessToken()) */
  refreshSession?: RefreshSessionFn;
  /** Optional: called when auto-miner has placed a bet (blocks chosen and tx confirmed) */
  onAutoMineBetConfirmed?: () => void;
}

const AUTO_MINER_STORAGE_KEY = "lineaore:auto-miner-session:v1";

interface PersistedAutoMinerSession {
  active: boolean;
  betStr: string;
  blocks: number;
  rounds: number;
  nextRoundIndex: number;
  lastPlacedEpoch: string | null;
}

// ---- Helpers outside the hook to avoid recreating on each render ----

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

function isNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
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
    msg.includes("timed out after")
  );
}

const NETWORK_RETRY_MAX = 120;
const NETWORK_BACKOFF_INITIAL_MS = 1_500;
const NETWORK_BACKOFF_MAX_MS = 15_000;

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

/** Only one auto-miner loop can run at a time (guards against double-start on remount). */
let autoMineRunInProgress = false;

// Cross-tab lock: prevents multiple browser tabs from mining simultaneously
const TAB_LOCK_KEY = "lore:auto-mine-tab-lock";
const TAB_LOCK_TTL_MS = 10_000;
const TAB_ID = typeof crypto !== "undefined" ? crypto.randomUUID() : String(Date.now());

function acquireTabLock(): boolean {
  try {
    const raw = localStorage.getItem(TAB_LOCK_KEY);
    if (raw) {
      const lock = JSON.parse(raw) as { id: string; ts: number };
      if (lock.id !== TAB_ID && Date.now() - lock.ts < TAB_LOCK_TTL_MS) return false;
    }
    localStorage.setItem(TAB_LOCK_KEY, JSON.stringify({ id: TAB_ID, ts: Date.now() }));
    return true;
  } catch { return false; }
}

function renewTabLock() {
  try { localStorage.setItem(TAB_LOCK_KEY, JSON.stringify({ id: TAB_ID, ts: Date.now() })); } catch {}
}

function releaseTabLock() {
  try {
    const raw = localStorage.getItem(TAB_LOCK_KEY);
    if (raw) {
      const lock = JSON.parse(raw) as { id: string };
      if (lock.id === TAB_ID) localStorage.removeItem(TAB_LOCK_KEY);
    }
  } catch {}
}

const SESSION_REFRESH_INTERVAL_MS = 20 * 60 * 1000; // 20 min – refresh before wallet session typically expires



export function useMining({
  refetchAllowance,
  refetchTileData,
  refetchUserBets,
  refetchEpoch,
  ensurePreferredWallet,
  sendTransactionSilent,
  refreshSession,
  onAutoMineBetConfirmed,
}: UseMiningOptions) {
  const { isConnected, address } = useAccount();
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();

  const [isPending, setIsPending] = useState(false);
  const [selectedTiles, setSelectedTiles] = useState<number[]>([]);
  const [selectedTilesEpoch, setSelectedTilesEpoch] = useState<string | null>(null);
  const [isAutoMining, setIsAutoMining] = useState(false);
  const [autoMineProgress, setAutoMineProgress] = useState<string | null>(null);
  const [runningParams, setRunningParams] = useState<{ betStr: string; blocks: number; rounds: number } | null>(null);
  const autoMineRef = useRef(false);
  const mountedRef = useRef(true);
  const restoreAttemptedRef = useRef(false);
  const sessionExpiredErrorRef = useRef(false);
  const scheduleRefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- Stable refs: always point to latest versions of volatile functions ----
  const publicClientRef = useRef(publicClient);
  const silentSendRef = useRef(sendTransactionSilent);
  const refreshSessionRef = useRef(refreshSession);
  const writeContractAsyncRef = useRef(writeContractAsync);
  const ensurePreferredWalletRef = useRef(ensurePreferredWallet);
  const refetchAllowanceRef = useRef(refetchAllowance);
  const refetchTileDataRef = useRef(refetchTileData);
  const refetchUserBetsRef = useRef(refetchUserBets);
  const refetchEpochRef = useRef(refetchEpoch);
  const onAutoMineBetConfirmedRef = useRef(onAutoMineBetConfirmed);

  // Sync refs on every render (assignment is synchronous, no useEffect needed)
  publicClientRef.current = publicClient;
  silentSendRef.current = sendTransactionSilent;
  refreshSessionRef.current = refreshSession;
  writeContractAsyncRef.current = writeContractAsync;
  ensurePreferredWalletRef.current = ensurePreferredWallet;
  refetchAllowanceRef.current = refetchAllowance;
  refetchTileDataRef.current = refetchTileData;
  refetchUserBetsRef.current = refetchUserBets;
  refetchEpochRef.current = refetchEpoch;
  onAutoMineBetConfirmedRef.current = onAutoMineBetConfirmed;

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
    async (hash: `0x${string}`, pc?: PublicClient) => {
      const client = pc ?? publicClientRef.current;
      if (!client) throw new Error("Public client not ready");
      await Promise.race([
        client.waitForTransactionReceipt({ hash }),
        delay(TX_RECEIPT_TIMEOUT_MS).then(() => {
          throw new Error("Transaction receipt timeout – check network status");
        }),
      ]);
    },
    [],
  );

  const ensureAllowance = useCallback(
    async (requiredAmount: bigint) => {
      if (!address || !publicClientRef.current) return;
      await ensurePreferredWalletRef.current?.();
      const liveAllowance = (await publicClientRef.current.readContract({
        address: LINEA_TOKEN_ADDRESS, abi: TOKEN_ABI, functionName: "allowance",
        args: [address, CONTRACT_ADDRESS],
      })) as bigint;

      if (liveAllowance < requiredAmount) {
        await writeContractAsyncRef.current({
          address: LINEA_TOKEN_ADDRESS, abi: TOKEN_ABI, functionName: "approve",
          args: [CONTRACT_ADDRESS, maxUint256],
          chainId: APP_CHAIN_ID,
        });
        refetchAllowanceRef.current();
      }
    },
    [address],
  );

  const GAS_BUMP_BASE = BigInt(120);
  const GAS_BUMP_REPLACEMENT_STEP = BigInt(60);

  const getBumpedFees = useCallback(async (percent: bigint = GAS_BUMP_BASE) => {
    const pc = publicClientRef.current;
    if (!pc) return undefined;
    try {
      const fees = await pc.estimateFeesPerGas();
      if (fees?.maxFeePerGas && fees?.maxPriorityFeePerGas) {
        return {
          maxFeePerGas: (fees.maxFeePerGas * percent) / BigInt(100),
          maxPriorityFeePerGas: (fees.maxPriorityFeePerGas * percent) / BigInt(100),
        };
      }
      if (fees?.gasPrice) {
        return { gasPrice: (fees.gasPrice * percent) / BigInt(100) };
      }
    } catch {
      /* ignore */
    }
    return undefined;
  }, []);

  const estimateGas = useCallback(
    async (functionName: string, args: readonly unknown[], bufferExtra: bigint) => {
      const pc = publicClientRef.current;
      if (!pc || !address) return BigInt(500000) + bufferExtra;
      try {
        const est = await pc.estimateContractGas({
          account: address,
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: functionName as "placeBet",
          args: args as [bigint, bigint],
        });
        return (est * BigInt(115)) / BigInt(100) + bufferExtra;
      } catch {
        return BigInt(500000) + bufferExtra;
      }
    },
    [address],
  );

  const placeBets = useCallback(
    async (tiles: number[], singleAmountRaw: bigint, gasOverrides?: GasOverrides) => {
      await ensurePreferredWalletRef.current?.();
      const overrides = gasOverrides ?? (await getBumpedFees());
      if (tiles.length === 1) {
        const gas = await estimateGas("placeBet", [BigInt(tiles[0]), singleAmountRaw], BigInt(20000));
        await writeContractAsyncRef.current({
          address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "placeBet",
          args: [BigInt(tiles[0]), singleAmountRaw],
          chainId: APP_CHAIN_ID, gas, ...overrides,
        });
      } else {
        const tileArgs = tiles.map((id) => BigInt(id));
        const amountArgs = tiles.map(() => singleAmountRaw);
        const gas = await estimateGas("placeBatchBets", [tileArgs, amountArgs], BigInt(35000));
        await writeContractAsyncRef.current({
          address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "placeBatchBets",
          args: [tileArgs, amountArgs],
          chainId: APP_CHAIN_ID, gas, ...overrides,
        });
      }
    },
    [estimateGas, getBumpedFees],
  );

  const placeBetsSilent = useCallback(
    async (tiles: number[], singleAmountRaw: bigint, gasOverrides?: GasOverrides) => {
      await ensurePreferredWalletRef.current?.();
      const pc = publicClientRef.current;
      const silentSend = silentSendRef.current;
      if (!pc || !silentSend) throw new Error("Privy wallet not ready");

      let data: `0x${string}`;
      let gas: bigint | undefined;

      // Extra gas buffer: placeBet may also auto-resolve the previous epoch
      if (tiles.length === 1) {
        gas = await estimateGas("placeBet", [BigInt(tiles[0]), singleAmountRaw], BigInt(80000));
        data = encodeFunctionData({
          abi: GAME_ABI, functionName: "placeBet",
          args: [BigInt(tiles[0]), singleAmountRaw],
        });
      } else {
        const tileArgs = tiles.map((id) => BigInt(id));
        const amountArgs = tiles.map(() => singleAmountRaw);
        gas = await estimateGas("placeBatchBets", [tileArgs, amountArgs], BigInt(100000));
        data = encodeFunctionData({
          abi: GAME_ABI, functionName: "placeBatchBets",
          args: [tileArgs, amountArgs],
        });
      }

      const hash = await silentSend({ to: CONTRACT_ADDRESS, data, gas }, gasOverrides);
      await waitReceipt(hash, pc);
    },
    [estimateGas, waitReceipt],
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
  const handleManualMine = useCallback(
    async (betAmountStr: string) => {
      if (selectedTiles.length === 0 || !isConnected || !address) return;
      setIsPending(true);
      try {
        const normalized = normalizeDecimalInput(betAmountStr);
        const parsed = Number(normalized);
        if (!normalized || isNaN(parsed) || parsed <= 0) throw new Error("Invalid bet amount");

        const singleAmountRaw = parseUnits(normalized, 18);
        const totalAmountRaw = singleAmountRaw * BigInt(selectedTiles.length);

        await ensureAllowance(totalAmountRaw);
        try {
          await placeBets(selectedTiles, singleAmountRaw);
        } catch (err) {
          if (!isRetryableError(err)) throw err;
          await delay(1500);
          const bumpedFees = await getBumpedFees(BigInt(180));
          await placeBets(selectedTiles, singleAmountRaw, bumpedFees);
        }

        setSelectedTiles([]);
        setSelectedTilesEpoch(null);
        scheduleRefetch();
      } catch (err) {
        if (!isUserRejection(err)) {
          log.error("ManualMine", "bet failed", err);
          alert("Bet failed. Check your token balance and try again.");
        }
      } finally {
        setIsPending(false);
      }
    },
    [selectedTiles, isConnected, address, ensureAllowance, placeBets, scheduleRefetch],
  );

  const handleDirectMine = useCallback(
    async (tiles: number[], betAmountStr: string) => {
      if (tiles.length === 0 || !isConnected || !address) return;
      if (autoMineRef.current) return;
      setSelectedTiles(tiles);
      setSelectedTilesEpoch(null);
      setIsPending(true);
      try {
        const normalized = normalizeDecimalInput(betAmountStr);
        const parsed = Number(normalized);
        if (!normalized || isNaN(parsed) || parsed <= 0) throw new Error("Invalid bet amount");

        const singleAmountRaw = parseUnits(normalized, 18);
        const totalAmountRaw = singleAmountRaw * BigInt(tiles.length);

        await ensureAllowance(totalAmountRaw);
        try {
          await placeBets(tiles, singleAmountRaw);
        } catch (err) {
          if (!isRetryableError(err)) throw err;
          await delay(1500);
          const bumpedFees = await getBumpedFees(BigInt(180));
          await placeBets(tiles, singleAmountRaw, bumpedFees);
        }

        setSelectedTiles([]);
        setSelectedTilesEpoch(null);
        scheduleRefetch();
      } catch (err) {
        if (!isUserRejection(err)) {
          log.error("DirectMine", "bet failed", err);
          alert("Bet failed. Check your token balance and try again.");
        }
      } finally {
        setIsPending(false);
      }
    },
    [isConnected, address, ensureAllowance, placeBets, scheduleRefetch],
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
      if (!isConnected || !address || !pc) return;
      if (autoMineRef.current) return;
      if (autoMineRunInProgress) return;

      if (!acquireTabLock()) {
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
              address: LINEA_TOKEN_ADDRESS, abi: TOKEN_ABI, functionName: "balanceOf", args: [address],
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
              args: [address, CONTRACT_ADDRESS],
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
          const silentSend = silentSendRef.current;
          if (silentSend) {
            const data = encodeFunctionData({
              abi: TOKEN_ABI, functionName: "approve", args: [CONTRACT_ADDRESS, maxUint256],
            });
            const approveHash = await silentSend({ to: LINEA_TOKEN_ADDRESS, data });
            await waitReceipt(approveHash, pc);
          } else {
            await ensurePreferredWalletRef.current?.();
            await writeContractAsyncRef.current({
              address: LINEA_TOKEN_ADDRESS, abi: TOKEN_ABI, functionName: "approve",
              args: [CONTRACT_ADDRESS, maxUint256], chainId: APP_CHAIN_ID,
            });
          }
          refetchAllowanceRef.current();
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
            // Wait until the epoch timer has expired; then placeBet immediately (it auto-resolves).
            while (autoMineRef.current) {
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
                await delay(waitMs);
              } catch {
                await delay(500);
              }
            }
            if (!autoMineRef.current) { stopReason = "user-stopped"; break; }

            refetchEpochRef.current?.();
            setAutoMineProgress(`${r} / ${rounds} – placing bet (auto-resolves)...`);
          }

          // --- Inner round body wrapped with network retry ---
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
                args: [liveEpochNow, address],
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
              address: LINEA_TOKEN_ADDRESS, abi: TOKEN_ABI, functionName: "balanceOf", args: [address],
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
              const candidate = Math.floor(Math.random() * GRID_SIZE) + 1;
              if (!alreadyBetTiles.has(candidate)) tileSet.add(candidate);
              safetyCounter++;
            }
            const tilesToBet = [...tileSet];

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
              nextRoundIndex: r + 1,
              lastPlacedEpoch: liveEpochNow.toString(),
            });

            const placeBetOnce = async (overrides?: GasOverrides) => {
              const silentSend = silentSendRef.current;
              if (silentSend) {
                await placeBetsSilent(tilesToBet, singleAmountRaw, overrides);
              } else {
                await placeBets(tilesToBet, singleAmountRaw, overrides);
              }
            };

            let betAttempts = 0;
            let skippedEpochEnded = false;
            let betAlreadyConfirmedOnChain = false;
            while (betAttempts < MAX_BET_ATTEMPTS) {
              try {
                // Before retrying, check if a previous attempt already went through on-chain
                if (betAttempts > 0) {
                  try {
                    const recheckBets = (await currentPc.readContract({
                      address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "getUserBetsAll",
                      args: [liveEpochNow, address],
                    })) as bigint[];
                    const recheckCount = recheckBets.filter(b => b > BigInt(0)).length;
                    if (recheckCount >= effectiveBlocks) {
                      log.info("AutoMine", `pre-retry check: ${recheckCount}/${effectiveBlocks} bets already on-chain in epoch ${liveEpochNow} – skipping retry`);
                      betAlreadyConfirmedOnChain = true;
                      break;
                    }
                  } catch {
                    // non-critical check
                  }
                }

                const gasBumpPercent = GAS_BUMP_BASE + BigInt(betAttempts) * GAS_BUMP_REPLACEMENT_STEP;
                const retryOverrides = betAttempts > 0 ? await getBumpedFees(gasBumpPercent) : undefined;
                await placeBetOnce(retryOverrides);
                break;
              } catch (err) {
                if (isEpochEndedError(err)) {
                  log.warn("AutoMine", `round ${r + 1} skipped – epoch ended (tx too late), continuing next round`, { epoch: liveEpochNow.toString() });
                  setAutoMineProgress(`${r + 1} / ${rounds} – skipped (epoch ended), next round...`);
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
                const errMsg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
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
              lastPlacedEpoch = liveEpochNow;
              setSelectedTiles([]);
              setSelectedTilesEpoch(null);
              setAutoMineProgress(`${r + 1} / ${rounds} – confirmed (detected on-chain)`);
              onAutoMineBetConfirmedRef.current?.();
              log.info("AutoMine", `round ${r + 1}/${rounds} detected on-chain`, { epoch: liveEpochNow.toString() });
              saveSession({
                active: true, betStr, blocks, rounds,
                nextRoundIndex: r + 1,
                lastPlacedEpoch: lastPlacedEpoch.toString(),
              });
              networkRetries = 0;
              await delay(REFETCH_DELAY_MS);
              refetchTileDataRef.current();
              refetchUserBetsRef.current();
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
                args: [liveEpochNow, address],
              })) as bigint[];
              const countInExpected = verifyBets.filter(b => b > BigInt(0)).length;

              if (countInExpected >= tilesToBet.length) {
                log.info("AutoMine", `round ${r + 1}/${rounds} confirmed | epoch=${liveEpochNow}, bets=${countInExpected}/${effectiveBlocks}`);
              } else {
                // Bets likely landed in the next epoch
                const nextEpoch = liveEpochNow + BigInt(1);
                try {
                  const nextBets = (await currentPc.readContract({
                    address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "getUserBetsAll",
                    args: [nextEpoch, address],
                  })) as bigint[];
                  const countInNext = nextBets.filter(b => b > BigInt(0)).length;
                  if (countInNext >= tilesToBet.length) {
                    actualBetEpoch = nextEpoch;
                    log.info("AutoMine", `round ${r + 1}/${rounds} confirmed | bets landed in next epoch=${nextEpoch} (expected ${liveEpochNow}), bets=${countInNext}/${effectiveBlocks}`);
                  } else if (countInExpected === 0 && countInNext === 0) {
                    // RPC lag or bets in epoch+2 – retry once after delay, then check epoch+2
                    await delay(1200);
                    const recheckNext = (await currentPc.readContract({
                      address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "getUserBetsAll",
                      args: [nextEpoch, address],
                    })) as bigint[];
                    const recheckNextCount = recheckNext.filter(b => b > BigInt(0)).length;
                    if (recheckNextCount >= tilesToBet.length) {
                      actualBetEpoch = nextEpoch;
                      log.info("AutoMine", `round ${r + 1}/${rounds} confirmed | bets in epoch ${nextEpoch} (RPC lag), bets=${recheckNextCount}/${effectiveBlocks}`);
                    } else {
                      try {
                        const epochPlus2 = liveEpochNow + BigInt(2);
                        const betsE2 = (await currentPc.readContract({
                          address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "getUserBetsAll",
                          args: [epochPlus2, address],
                        })) as bigint[];
                        const countE2 = betsE2.filter(b => b > BigInt(0)).length;
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
            await delay(REFETCH_DELAY_MS);
            refetchTileDataRef.current();
            refetchUserBetsRef.current();

          } catch (roundErr) {
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
                  const checkBets = (await currentPcCheck.readContract({
                    address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "getUserBetsAll",
                    args: [checkEpoch, address],
                  })) as bigint[];
                  const alreadyCount = checkBets.filter(b => b > BigInt(0)).length;
                  const effBlocks = Math.min(blocks, GRID_SIZE);
                  if (alreadyCount >= effBlocks) {
                    log.info("AutoMine", `post-error check: found ${alreadyCount}/${effBlocks} bets already in epoch ${checkEpoch} – skipping re-bet`);
                    lastPlacedEpoch = checkEpoch;
                    saveSession({
                      active: true, betStr, blocks, rounds,
                      nextRoundIndex: r + 1,
                      lastPlacedEpoch: lastPlacedEpoch.toString(),
                    });
                    networkRetries = 0;
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
        log.error("AutoMine", "loop error", err);
        const sessionExpired = isSessionExpiredError(err);
        const networkDown = isNetworkError(err);
        if (!isUserRejection(err)) {
          const rawMsg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
          let userMsg: string;
          if (sessionExpired) {
            sessionExpiredErrorRef.current = true;
            userMsg = "Session expired. Log out, log in again, then reload this page – the bot will auto-resume.";
          } else if (networkDown) {
            userMsg = "Auto-miner paused: RPC offline for too long. Will auto-resume on page reload.";
          } else if (rawMsg.includes("replacement transaction underpriced")) {
            userMsg = "Stopped: replacement tx underpriced. Press START BOT again to continue.";
          } else if (rawMsg.includes("upfront cost exceeds") || rawMsg.includes("insufficient funds") || rawMsg.includes("exceeds account balance")) {
            userMsg = "Auto-miner stopped: not enough ETH for gas. Top up ETH on Privy wallet.";
          } else if (rawMsg.includes("epoch ended")) {
            userMsg = "Round skipped (epoch ended). Press START BOT to continue.";
          } else if (rawMsg.includes("gas required exceeds") || rawMsg.includes("reverted")) {
            userMsg = "Auto-miner stopped: tx reverted. Check token balance.";
          } else if (rawMsg.includes("timeout")) {
            userMsg = "Auto-miner stopped: network timeout.";
          } else if (rawMsg.includes("wallet not ready") || rawMsg.includes("wallet not found")) {
            userMsg = "Auto-miner stopped: Privy wallet not ready. Retry in a moment.";
          } else {
            userMsg = "Auto-miner error: " + (err instanceof Error ? err.message : String(err));
          }
          setAutoMineProgress(userMsg);
          await delay(8000);
        }
        autoMineRef.current = false;
        // Keep session alive for network errors so reload can resume
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
    [isConnected, address, placeBets, placeBetsSilent, waitReceipt],
  );

  // Ref to always hold the latest runAutoMining – decouples it from the restore effect
  const runAutoMiningRef = useRef(runAutoMining);
  useEffect(() => {
    runAutoMiningRef.current = runAutoMining;
  }, [runAutoMining]);

  // --- Auto mining toggle ---
  const handleAutoMineToggle = useCallback(
    async (betStr: string, blocks: number, rounds: number) => {
      if (!isConnected || !address || !publicClientRef.current) return;

      if (isAutoMining) {
        autoMineRef.current = false;
        setIsAutoMining(false);
        setRunningParams(null);
        setAutoMineProgress(null);
        clearSession();
        releaseTabLock();
        return;
      }

      sessionExpiredErrorRef.current = false;
      saveSession({
        active: true, betStr, blocks, rounds,
        nextRoundIndex: 0, lastPlacedEpoch: null,
      });

      await runAutoMiningRef.current({ betStr, blocks, rounds });
    },
    [isConnected, address, isAutoMining],
  );

  // --- Restore auto-miner after page reload ---
  useEffect(() => {
    if (restoreAttemptedRef.current) return;
    if (!isConnected || !address || !publicClient) return;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address, publicClient]);

  useEffect(() => {
    mountedRef.current = true;

    const onBeforeUnload = () => {
      if (autoMineRef.current) {
        log.warn("AutoMine", "tab closing while mining – releasing lock");
      }
      releaseTabLock();
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      mountedRef.current = false;
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
    setSelectedTiles(tiles);
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
