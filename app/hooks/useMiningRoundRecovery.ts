"use client";

import { log } from "../lib/logger";
import { delay } from "../lib/utils";
import type { PublicClient } from "viem";
import { verifyRoundAfterRpcError, verifySuccessfulRoundPlacement } from "./useMiningRoundVerification";

interface FinalizeConfirmedRoundOptions {
  actorAddress: `0x${string}`;
  client: PublicClient;
  effectiveBlocks: number;
  epochNeedsResolve: boolean;
  liveEpoch: bigint;
  rounds: number;
  roundIndex: number;
  tilesToBet: number[];
}

interface RecoverRoundAfterRpcErrorOptions {
  actorAddress: `0x${string}`;
  blocks: number;
  client: PublicClient;
  roundCandidateEpochs: bigint[];
  roundTilesToBet: number[];
}

export async function finalizeConfirmedRound({
  actorAddress,
  client,
  effectiveBlocks,
  epochNeedsResolve,
  liveEpoch,
  rounds,
  roundIndex,
  tilesToBet,
}: FinalizeConfirmedRoundOptions) {
  await delay(1200);
  const verifiedRound = await verifySuccessfulRoundPlacement({
    actorAddress,
    client,
    effectiveBlocks,
    epochNeedsResolve,
    liveEpoch,
    logPrefix: `round ${roundIndex + 1}/${rounds}`,
    tilesToBet,
  });

  if (verifiedRound.logLine) {
    if (verifiedRound.logLevel === "warn") {
      log.warn("AutoMine", verifiedRound.logLine);
    } else {
      log.info("AutoMine", verifiedRound.logLine);
    }
  }

  if (!verifiedRound.confirmed) {
    const verificationError = new Error(
      `Auto-miner bet not yet visible on-chain (${verifiedRound.confirmedCount}/${effectiveBlocks} tiles confirmed).`,
    );
    verificationError.name = "TransactionReceiptTimeoutError";
    throw verificationError;
  }

  return {
    kind: "confirmed" as const,
    source: "finalized" as const,
    placedEpoch: verifiedRound.placedEpoch,
  };
}

export async function recoverRoundAfterRpcError({
  actorAddress,
  blocks,
  client,
  roundCandidateEpochs,
  roundTilesToBet,
}: RecoverRoundAfterRpcErrorOptions) {
  try {
    const recoveredRound = await verifyRoundAfterRpcError({
      actorAddress,
      blocks,
      client,
      roundCandidateEpochs,
      roundTilesToBet,
    });

    if (recoveredRound.confirmed && recoveredRound.placedEpoch !== null) {
      log.info(
        "AutoMine",
        `post-error check: found ${recoveredRound.confirmedCount}/${recoveredRound.effectiveBlocks} target bets in epoch ${recoveredRound.placedEpoch} - skipping re-bet`,
      );
      return {
        kind: "confirmed" as const,
        source: "recovered-after-network-error" as const,
        placedEpoch: recoveredRound.placedEpoch,
      };
    }

    log.info(
      "AutoMine",
      `post-error check: ${recoveredRound.confirmedCount}/${recoveredRound.effectiveBlocks} bets in epoch ${recoveredRound.placedEpoch} - will retry`,
    );
    return { kind: "retry" as const };
  } catch (error) {
    log.warn("AutoMine", "post-error bet check failed, retrying round anyway", error);
    return { kind: "retry" as const };
  }
}
