"use client";

import { log } from "../lib/logger";
import { delay } from "../lib/utils";
import type { PublicClient } from "viem";
import {
  isAmbiguousPendingTxError,
  isEpochEndedError,
  isInsufficientFundsError,
  isNetworkError,
  isRetryableError,
  isSessionExpiredError,
  withMiningRpcTimeout,
} from "./useMining.shared";
import { verifyRoundAlreadyPlaced } from "./useMiningRoundVerification";

type GasOverrides = { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } | { gasPrice?: bigint };
type ReceiptState = "confirmed" | "pending";

interface PendingBetState {
  submittedAt: number;
  nonce: number;
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
  ) => Promise<ReceiptState>;
  placeBetsSilent: (
    tiles: number[],
    singleAmountRaw: bigint,
    gasOverrides?: GasOverrides,
    txNonce?: number,
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

    const latestNonce = Number(latestNonceRaw);
    const pendingNonce = Number(pendingNonceRaw);
    let txNonce: number | undefined;
    const submittedNonce = () => txNonce ?? pendingNonce;
    const pendingBet = pendingBetRef.current;

    if (pendingBet) {
      const nonceGap = pendingNonce - latestNonce;
      const pendingAgeMs = Date.now() - pendingBet.submittedAt;

      if (latestNonce > pendingBet.nonce) {
        pendingBetRef.current = null;
      } else if (
        pendingAgeMs < betPendingStaleMs &&
        (pendingAgeMs < betPendingGraceMs || nonceGap < forceReplacePendingNonceGap)
      ) {
        log.info("AutoMine", `round ${currentRoundIndex + 1}: pending bet nonce ${pendingBet.nonce} still in flight, waiting`, {
          latestNonce,
          pendingNonce,
          pendingAgeMs,
        });
        onProgress(`${currentRoundIndex + 1} / ${rounds} - previous tx still pending...`);
        await delay(3_000);
        return "pending";
      }

      txNonce = pendingBet.nonce;
      log.warn("AutoMine", `round ${currentRoundIndex + 1}: replacing stale pending bet with nonce ${txNonce}`, {
        latestNonce,
        pendingNonce,
        pendingAgeMs,
      });
    } else if (pendingNonce > latestNonce) {
      const blockedNonce = latestNonce;
      const pendingCount = pendingNonce - latestNonce;
      const blockedError = new Error(
        `Wallet has ${pendingCount} pending transaction(s) starting at nonce ${blockedNonce}. Clear or replace the stuck tx in Settings before betting again.`,
      );
      blockedError.name = "PendingNonceBlockedError";
      throw blockedError;
    }

    const silentSend = readSilentSend();
    if (silentSend) {
      try {
        const state = await placeBetsSilent(tilesToBet, singleAmountRaw, overrides, txNonce);
        pendingBetRef.current = state === "pending" ? { submittedAt: Date.now(), nonce: submittedNonce() } : null;
        return state;
      } catch (error) {
        if (isSessionExpiredError(error)) throw error;
        if (isAmbiguousPendingTxError(error)) {
          pendingBetRef.current = { submittedAt: Date.now(), nonce: submittedNonce() };
        }
        log.warn("AutoMine", "silent send failed, falling back to wallet write", error);
        const state = await placeBets(tilesToBet, singleAmountRaw, overrides, txNonce);
        pendingBetRef.current = state === "pending" ? { submittedAt: Date.now(), nonce: submittedNonce() } : null;
        return state;
      }
    }

    const state = await placeBets(tilesToBet, singleAmountRaw, overrides, txNonce);
    pendingBetRef.current = state === "pending" ? { submittedAt: Date.now(), nonce: submittedNonce() } : null;
    return state;
  };

  let betAttempts = 0;
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
        log.warn("AutoMine", `bet network error (attempt ${betAttempts}/${maxBetAttempts}), waiting ${(wait / 1000).toFixed(0)}s...`, error);
        onProgress(`${currentRoundIndex + 1} / ${rounds} - RPC offline, retry in ${(wait / 1000).toFixed(0)}s...`);
        await delay(wait);
        continue;
      }
      if (isSessionExpiredError(error) && betAttempts < 2) {
        betAttempts += 1;
        log.warn("AutoMine", `session signing error (attempt ${betAttempts}), refreshing session...`, error);
        onProgress(`${currentRoundIndex + 1} / ${rounds} - session error, refreshing (${betAttempts}/2)...`);
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
