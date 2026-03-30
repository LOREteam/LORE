"use client";

import { log } from "../lib/logger";
import { delay } from "../lib/utils";
import type { PublicClient } from "viem";
import { verifyRoundAfterRpcError, verifySuccessfulRoundPlacement } from "./useMiningRoundVerification";

interface CompleteRoundArgs {
  betStr: string;
  blocks: number;
  rounds: number;
  roundIndex: number;
  placedEpoch: bigint;
  displayTiles?: number[];
  displayEpoch?: bigint;
  progressMessage?: string;
  announceBet: boolean;
}

interface FinalizeConfirmedRoundOptions {
  actorAddress: `0x${string}`;
  betStr: string;
  blocks: number;
  client: PublicClient;
  completeAutoMineRound: (args: CompleteRoundArgs) => Promise<void>;
  effectiveBlocks: number;
  epochNeedsResolve: boolean;
  liveEpoch: bigint;
  onAnnounceConfirmed: () => void;
  onClearSelection: () => void;
  onRefetchEpoch?: () => void;
  onSetProgress: (message: string) => void;
  rounds: number;
  roundIndex: number;
  tilesToBet: number[];
}

interface RecoverRoundAfterRpcErrorOptions {
  actorAddress: `0x${string}`;
  betStr: string;
  blocks: number;
  client: PublicClient;
  completeAutoMineRound: (args: CompleteRoundArgs) => Promise<void>;
  onAnnounceConfirmed: () => void;
  onSetSelection: (tiles: number[], epoch: string) => void;
  onSetProgress: (message: string) => void;
  roundCandidateEpochs: bigint[];
  roundIndex: number;
  rounds: number;
  roundTilesToBet: number[];
}

export async function finalizeConfirmedRound({
  actorAddress,
  betStr,
  blocks,
  client,
  completeAutoMineRound,
  effectiveBlocks,
  epochNeedsResolve,
  liveEpoch,
  onAnnounceConfirmed,
  onClearSelection,
  onRefetchEpoch,
  onSetProgress,
  rounds,
  roundIndex,
  tilesToBet,
}: FinalizeConfirmedRoundOptions) {
  onClearSelection();
  onSetProgress(`${roundIndex + 1} / ${rounds} - confirmed`);
  onAnnounceConfirmed();

  if (epochNeedsResolve) {
    onRefetchEpoch?.();
  }

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

  await completeAutoMineRound({
    betStr,
    blocks,
    rounds,
    roundIndex,
    placedEpoch: verifiedRound.placedEpoch,
    displayTiles: tilesToBet,
    displayEpoch: verifiedRound.placedEpoch,
    progressMessage: `${roundIndex + 1} / ${rounds} - confirmed`,
    announceBet: false,
  });

  return { placedEpoch: verifiedRound.placedEpoch };
}

export async function recoverRoundAfterRpcError({
  actorAddress,
  betStr,
  blocks,
  client,
  completeAutoMineRound,
  onAnnounceConfirmed,
  onSetSelection,
  onSetProgress,
  roundCandidateEpochs,
  roundIndex,
  rounds,
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
      onSetSelection(roundTilesToBet, recoveredRound.selectionEpoch);
      onSetProgress(`${roundIndex + 1} / ${rounds} - confirmed (detected after RPC error)`);
      onAnnounceConfirmed();
      await completeAutoMineRound({
        betStr,
        blocks,
        rounds,
        roundIndex,
        placedEpoch: recoveredRound.placedEpoch,
        displayTiles: roundTilesToBet,
        displayEpoch: recoveredRound.placedEpoch,
        progressMessage: `${roundIndex + 1} / ${rounds} - confirmed (detected after RPC error)`,
        announceBet: false,
      });
      return { kind: "recovered" as const, placedEpoch: recoveredRound.placedEpoch };
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
