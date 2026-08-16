"use client";

import { log } from "../lib/logger";
import { formatRetryWaitSeconds } from "../lib/mining/networkRetry";
import { delay } from "../lib/utils";
import type { PublicClient } from "viem";
import { CONTRACT_ADDRESS, GAME_ABI } from "../lib/constants";
import {
  isAmbiguousPendingTxError,
  isDeterministicBetExecutionError,
  isEpochEndedError,
  isInsufficientFundsError,
  isNetworkError,
  isRetryableError,
  isWalletUnavailableError,
  withMiningRpcTimeout,
} from "./useMining.shared";
import type { GasOverrides } from "./useMining.types";
import type { PendingBetState, ReceiptState } from "./useMining.stateTypes";
import { verifyRoundAlreadyPlaced } from "./useMiningRoundVerification";

function normalizeAutoMineNonce(value: unknown): number | null {
  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(value);
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return null;
  }
  return value;
}

function normalizePendingBetState(value: PendingBetState, now: number): PendingBetState | null {
  if (!Number.isSafeInteger(now) || now < 0) return null;
  const nonce = normalizeAutoMineNonce(value.nonce);
  if (nonce === null) return null;
  if (!Number.isSafeInteger(value.submittedAt) || value.submittedAt < 0 || value.submittedAt > now + 5_000) {
    return null;
  }
  return { submittedAt: value.submittedAt, nonce };
}

interface ExecuteAutoMineBetLoopOptions {
  actorAddress: `0x${string}`;
  autoMineActive: () => boolean;
  betPendingGraceMs: number;
  betPendingStaleMs: number;
  currentEpoch: bigint;
  currentRoundIndex: number;
  forceReplacePendingNonceGap: number;
  getBumpedFees: (percent?: bigint) => Promise<GasOverrides | undefined>;
  gasBumpBase: bigint;
  gasBumpReplacementStep: bigint;
  maxBetAttempts: number;
  networkBackoffInitialMs: number;
  networkBackoffMaxMs: number;
  onProgress: (message: string) => void;
  onSessionRefresh?: () => Promise<void>;
  pendingBetRef: { current: PendingBetState | null };
  placeBets: (
    tiles: number[],
    singleAmountRaw: bigint,
    gasOverrides?: GasOverrides,
    txNonce?: number,
    expectedEpoch?: bigint,
  ) => Promise<ReceiptState>;
  placeBetsSilent: (
    tiles: number[],
    singleAmountRaw: bigint,
    gasOverrides?: GasOverrides,
    txNonce?: number,
    expectedEpoch?: bigint,
  ) => Promise<ReceiptState>;
  publicClient: PublicClient;
  readSilentSend: () => unknown;
  rounds: number;
  singleAmountRaw: bigint;
  tilesToBet: number[];
  roundCandidateEpochs: bigint[];
  effectiveBlocks: number;
  getRetryDelayMs: (attemptIndex: number, initialMs: number, maxMs: number) => number;
}

export type AutoMineBetLoopResult =
  | { kind: "submitted" }
  | { kind: "stopped" }
  | { kind: "epoch-ended-skip" }
  | { kind: "detected-on-chain"; placedEpoch: bigint };

export async function executeAutoMineBetLoop({
  actorAddress,
  autoMineActive,
  betPendingGraceMs,
  betPendingStaleMs,
  currentEpoch,
  currentRoundIndex,
  forceReplacePendingNonceGap,
  getBumpedFees,
  gasBumpBase,
  gasBumpReplacementStep,
  maxBetAttempts,
  networkBackoffInitialMs,
  networkBackoffMaxMs,
  onProgress,
  onSessionRefresh,
  pendingBetRef,
  placeBets,
  placeBetsSilent,
  publicClient,
  readSilentSend,
  rounds,
  singleAmountRaw,
  tilesToBet,
  roundCandidateEpochs,
  effectiveBlocks,
  getRetryDelayMs,
}: ExecuteAutoMineBetLoopOptions): Promise<AutoMineBetLoopResult> {
  const MAX_SESSION_REFRESH_ATTEMPTS = 2;
  const waitForTrackedPendingBet = async (pendingBet: PendingBetState, latestNonce: number, pendingNonce: number, pendingAgeMs: number) => {
    log.info(
      "AutoMine",
      `round ${currentRoundIndex + 1}: pending bet nonce ${pendingBet.nonce} already tracked by node, waiting`,
      {
        latestNonce,
        pendingNonce,
        pendingAgeMs,
      },
    );
    onProgress(`${currentRoundIndex + 1} / ${rounds} - previous tx still pending...`);
    await delay(3_000);
    return "pending" as const;
  };

  const placeBetOnce = async (overrides?: GasOverrides): Promise<ReceiptState> => {
    const [latestNonceRaw, pendingNonceRaw] = await Promise.all([
      withMiningRpcTimeout(publicClient.getTransactionCount({
        address: actorAddress,
        blockTag: "latest",
      }), "bet.getTransactionCount.latest"),
      withMiningRpcTimeout(publicClient.getTransactionCount({
        address: actorAddress,
        blockTag: "pending",
      }), "bet.getTransactionCount.pending"),
    ]);

    const latestNonce = normalizeAutoMineNonce(latestNonceRaw);
    const pendingNonce = normalizeAutoMineNonce(pendingNonceRaw);
    if (latestNonce === null || pendingNonce === null || pendingNonce < latestNonce) {
      throw new Error("Pending nonce status is unavailable or unsafe. Wait for wallet nonce recovery, then retry.");
    }
    let txNonce: number | undefined;
    const submittedNonce = () => txNonce ?? pendingNonce;
    const pendingBet = pendingBetRef.current;
    let clearedTrackedPendingBet = false;

    if (pendingBet) {
      const now = Date.now();
      const trackedPendingBet = normalizePendingBetState(pendingBet, now);
      if (trackedPendingBet === null) {
        throw new Error("Tracked pending bet state is unavailable or unsafe. Wait for wallet nonce recovery, then retry.");
      }
      const nonceGap = pendingNonce - latestNonce;
      const pendingAgeMs = now - trackedPendingBet.submittedAt;
      const nodeStillTracksPendingNonce = pendingNonce > trackedPendingBet.nonce;

      if (latestNonce > trackedPendingBet.nonce) {
        pendingBetRef.current = null;
        clearedTrackedPendingBet = true;
      } else if (nodeStillTracksPendingNonce) {
        return waitForTrackedPendingBet(trackedPendingBet, latestNonce, pendingNonce, pendingAgeMs);
      } else if (
        pendingAgeMs < betPendingStaleMs &&
        (pendingAgeMs < betPendingGraceMs || nonceGap < forceReplacePendingNonceGap)
      ) {
        log.info("AutoMine", `round ${currentRoundIndex + 1}: pending bet nonce ${trackedPendingBet.nonce} still in flight, waiting`, {
          latestNonce,
          pendingNonce,
          pendingAgeMs,
        });
        onProgress(`${currentRoundIndex + 1} / ${rounds} - previous tx still pending...`);
        await delay(3_000);
        return "pending";
      }
      throw new Error(
        "Tracked pending bet cannot be replaced from local age and single-RPC nonce evidence; manual reconciliation is required.",
      );
    }

    if ((!pendingBetRef.current || clearedTrackedPendingBet) && pendingNonce > latestNonce) {
      const blockedNonce = latestNonce;
      const pendingCount = pendingNonce - latestNonce;
      const blockedError = new Error(
        `Wallet has ${pendingCount} pending transaction(s) starting at nonce ${blockedNonce}. Clear or replace the stuck tx in Settings before betting again.`,
      );
      blockedError.name = "PendingNonceBlockedError";
      throw blockedError;
    }

    // --- Standard silent path ---
    const silentSend = readSilentSend();
    if (silentSend) {
      try {
        const state = await placeBetsSilent(tilesToBet, singleAmountRaw, overrides, txNonce, currentEpoch);
        pendingBetRef.current = state === "pending" ? { submittedAt: Date.now(), nonce: submittedNonce() } : null;
        return state;
      } catch (error) {
        if (isAmbiguousPendingTxError(error)) {
          pendingBetRef.current = { submittedAt: Date.now(), nonce: submittedNonce() };
          log.warn("AutoMine", "silent send may already be pending, avoiding duplicate wallet fallback", error);
          return "pending";
        }
        if (isDeterministicBetExecutionError(error)) {
          throw error;
        }
        if (isWalletUnavailableError(error)) {
          throw error;
        }
        log.warn("AutoMine", "silent send failed, falling back to wallet write", error);
        const state = await placeBets(tilesToBet, singleAmountRaw, overrides, txNonce, currentEpoch);
        pendingBetRef.current = state === "pending" ? { submittedAt: Date.now(), nonce: submittedNonce() } : null;
        return state;
      }
    }

    // --- Wallet write fallback ---
    const state = await placeBets(tilesToBet, singleAmountRaw, overrides, txNonce, currentEpoch);
    pendingBetRef.current = state === "pending" ? { submittedAt: Date.now(), nonce: submittedNonce() } : null;
    return state;
  };

  const isGenericReceiptRevert = (error: unknown) =>
    error instanceof Error && error.message.toLowerCase().startsWith("transaction reverted (hash:");

  const didEpochWindowPass = async () => {
    const latestEpoch = await withMiningRpcTimeout(publicClient.readContract({
      address: CONTRACT_ADDRESS,
      abi: GAME_ABI,
      functionName: "currentEpoch",
    }), "bet.currentEpochAfterRevert", 8_000).catch(() => null);
    if (typeof latestEpoch !== "bigint") return false;
    const maxCandidateEpoch = roundCandidateEpochs.reduce(
      (maxEpoch, epoch) => (epoch > maxEpoch ? epoch : maxEpoch),
      currentEpoch,
    );
    if (latestEpoch <= maxCandidateEpoch) return false;
    log.warn("AutoMine", `round ${currentRoundIndex + 1}: reverted tx arrived after epoch window, skipping round`, {
      latestEpoch: latestEpoch.toString(),
      maxCandidateEpoch: maxCandidateEpoch.toString(),
    });
    return true;
  };

  let betAttempts = 0;
  let sessionRefreshAttempts = 0;
  while (betAttempts < maxBetAttempts) {
    if (!autoMineActive()) {
      return { kind: "stopped" };
    }

    try {
      if (betAttempts > 0) {
        const existingRound = await verifyRoundAlreadyPlaced({
          actorAddress,
          client: publicClient,
          effectiveBlocks,
          liveEpoch: currentEpoch,
          roundCandidateEpochs,
          tilesToBet,
        });
        if (existingRound.confirmed && existingRound.placedEpoch !== null) {
          log.info(
            "AutoMine",
            `pre-retry check: found ${tilesToBet.length}/${tilesToBet.length} target bets in epoch ${existingRound.placedEpoch} - skipping retry`,
          );
          pendingBetRef.current = null;
          return { kind: "detected-on-chain", placedEpoch: existingRound.placedEpoch };
        }
      }

      const gasBumpPercent = gasBumpBase + BigInt(betAttempts) * gasBumpReplacementStep;
      const feeOverrides = await getBumpedFees(gasBumpPercent);
      const state = await placeBetOnce(feeOverrides);
      sessionRefreshAttempts = 0;
      if (state === "pending") {
        log.warn("AutoMine", `round ${currentRoundIndex + 1}: bet tx pending, waiting before next action`);
        onProgress(`${currentRoundIndex + 1} / ${rounds} - tx pending, waiting confirmation...`);
        await delay(4_000);
        const existingRound = await verifyRoundAlreadyPlaced({
          actorAddress,
          client: publicClient,
          effectiveBlocks,
          liveEpoch: currentEpoch,
          roundCandidateEpochs,
          tilesToBet,
        });
        if (existingRound.confirmed && existingRound.placedEpoch !== null) {
          pendingBetRef.current = null;
          return { kind: "detected-on-chain", placedEpoch: existingRound.placedEpoch };
        }
        const pendingError = new Error("Auto-miner bet is still pending on-chain confirmation.");
        pendingError.name = "TransactionReceiptTimeoutError";
        throw pendingError;
      }
      return { kind: "submitted" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

      if (isEpochEndedError(error)) {
        pendingBetRef.current = null;
        return { kind: "epoch-ended-skip" };
      }
      if (isGenericReceiptRevert(error) && await didEpochWindowPass()) {
        pendingBetRef.current = null;
        return { kind: "epoch-ended-skip" };
      }
      if (isInsufficientFundsError(error)) {
        throw error;
      }
      if (isNetworkError(error)) {
        betAttempts += 1;
        if (betAttempts >= maxBetAttempts) throw error;
        const wait = getRetryDelayMs(
          betAttempts - 1,
          networkBackoffInitialMs,
          networkBackoffMaxMs,
        );
        const waitSeconds = formatRetryWaitSeconds(wait);
        log.warn("AutoMine", `bet network error (attempt ${betAttempts}/${maxBetAttempts}), waiting ${waitSeconds}s...`, error);
        onProgress(`${currentRoundIndex + 1} / ${rounds} - RPC offline, retry in ${waitSeconds}s...`);
        await delay(wait);
        onProgress(`${currentRoundIndex + 1} / ${rounds} - reconnecting RPC...`);
        continue;
      }
      if (isDeterministicBetExecutionError(error)) {
        throw error;
      }
      const sessionExpired =
        error instanceof Error &&
        (error.name === "PrivyApiError" ||
          error.message.toLowerCase().includes("valid access token") ||
          error.message.toLowerCase().includes("signing keys") ||
          error.message.toLowerCase().includes("authorization signatures") ||
          error.message.toLowerCase().includes("unexpected error occurred"));
      if (sessionExpired) {
        sessionRefreshAttempts += 1;
        if (sessionRefreshAttempts > MAX_SESSION_REFRESH_ATTEMPTS) throw error;
        log.warn("AutoMine", `session signing error (attempt ${sessionRefreshAttempts}), refreshing session...`, error);
        onProgress(
          `${currentRoundIndex + 1} / ${rounds} - session error, refreshing (${sessionRefreshAttempts}/${MAX_SESSION_REFRESH_ATTEMPTS})...`,
        );
        if (onSessionRefresh) {
          try {
            await onSessionRefresh();
          } catch {
            // ignore refresh failures and let the loop decide on next retry
          }
        }
        await delay(1500);
        continue;
      }

      const isReplacementUnderpriced = errorMessage.includes("replacement transaction underpriced");
      betAttempts += 1;
      if (!isRetryableError(error) || betAttempts >= maxBetAttempts) throw error;
      if (isReplacementUnderpriced) {
        log.warn("AutoMine", `replacement underpriced (attempt ${betAttempts}/${maxBetAttempts}), bumping gas aggressively`);
        onProgress(`${currentRoundIndex + 1} / ${rounds} - gas bump retry (${betAttempts}/${maxBetAttempts})...`);
        await delay(1000);
      } else {
        log.warn("AutoMine", `bet retry ${betAttempts}/${maxBetAttempts}`, error);
        onProgress(`${currentRoundIndex + 1} / ${rounds} - retrying (${betAttempts}/${maxBetAttempts})...`);
        await delay(750 * betAttempts);
      }
    }
  }

  return { kind: "stopped" };
}
