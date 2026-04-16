import type { MutableRefObject } from "react";
import type { PublicClient } from "viem";
import { delay } from "../utils";
import { awaitEpochReadyToBet } from "../../hooks/useMiningEpochTiming";
import {
  executeAutoMineBetLoop,
} from "../../hooks/useMiningRoundBetting";
import {
  finalizeConfirmedRound,
  recoverRoundAfterRpcError,
} from "../../hooks/useMiningRoundRecovery";
import {
  planAutoMineRound,
} from "../../hooks/useMiningRoundPlanning";
import { getNetworkRetryDelayMs } from "./networkRetry";
import type {
  AutoMineLoopConfirmedRoundOutcome,
  AutoMineLoopRoundAttemptOutcome,
  AutoMineLoopRoundRecoveryOutcome,
} from "./autoMineLoopRoundOutcome";
import type {
  AutoMineLoopPrepareRoundCommandResult,
  AutoMineLoopReadyRoundCommand,
} from "./autoMineLoopRoundCommand";
import type { GasOverrides } from "../../hooks/useMining.types";
import type { PendingBetState } from "../../hooks/useMining.stateTypes";

type SessionRefreshFn = () => Promise<void>;

export interface AutoMineLoopAdapter {
  awaitEpochReady(params: {
    lastPlacedEpoch: bigint;
    roundIndex: number;
    rounds: number;
  }): Promise<{ stopped: boolean }>;
  executeRoundCommand(params: {
    command: AutoMineLoopReadyRoundCommand;
    refreshSession?: SessionRefreshFn;
    roundIndex: number;
  }): Promise<AutoMineLoopRoundAttemptOutcome>;
  finalizeRoundCommand(params: {
    command: AutoMineLoopReadyRoundCommand;
    roundIndex: number;
  }): Promise<AutoMineLoopConfirmedRoundOutcome>;
  prepareRoundCommand(params: {
    lastPlacedEpoch: bigint | null;
    roundIndex: number;
    rounds: number;
  }): Promise<AutoMineLoopPrepareRoundCommandResult>;
  recoverRoundCommand(params: {
    command: AutoMineLoopReadyRoundCommand;
    roundIndex: number;
    rounds: number;
  }): Promise<AutoMineLoopRoundRecoveryOutcome>;
}

interface CreateAutoMineLoopAdapterOptions {
  actorAddress: `0x${string}`;
  autoMineActive: () => boolean;
  betPendingGraceMs: number;
  betPendingStaleMs: number;
  blocks: number;
  forceReplacePendingNonceGap: number;
  gasBumpBase: bigint;
  gasBumpReplacementStep: bigint;
  getBumpedFees: (stepBps?: bigint) => Promise<GasOverrides | undefined>;
  maxBetAttempts: number;
  networkBackoffInitialMs: number;
  networkBackoffMaxMs: number;
  onProgress: (message: string) => void;
  pendingBetRef: MutableRefObject<PendingBetState | null>;
  placeBets: (
    tileIds: number[],
    amountRawPerTile: bigint,
    gasOverrides?: GasOverrides,
  ) => Promise<"confirmed" | "pending">;
  placeBetsSilent: (
    tileIds: number[],
    amountRawPerTile: bigint,
    gasOverrides?: GasOverrides,
  ) => Promise<"confirmed" | "pending">;
  placeBets7702?: (
    tileIds: number[],
    amountRawPerTile: bigint,
    gasOverrides?: GasOverrides,
  ) => Promise<"confirmed" | "pending">;
  readClient: () => PublicClient | undefined;
  readSilentSend: () => unknown;
  renewLock: () => void;
  rounds: number;
  secureRandom: (max: number) => number;
  singleAmountRaw: bigint;
}

const PUBLIC_CLIENT_RECONNECT_TIMEOUT_MS = 20_000;
const PUBLIC_CLIENT_RECONNECT_POLL_MS = 300;

async function awaitActivePublicClient(params: {
  autoMineActive: () => boolean;
  onProgress: (message: string) => void;
  readClient: () => PublicClient | undefined;
  renewLock: () => void;
  roundIndex: number;
  rounds: number;
}) {
  const { autoMineActive, onProgress, readClient, renewLock, roundIndex, rounds } = params;
  const startedAt = Date.now();
  let announcedWait = false;

  while (autoMineActive()) {
    const client = readClient();
    if (client) return client;

    if (!announcedWait) {
      onProgress(`${roundIndex + 1} / ${rounds} - reconnecting RPC...`);
      announcedWait = true;
    }

    if (Date.now() - startedAt >= PUBLIC_CLIENT_RECONNECT_TIMEOUT_MS) {
      throw new Error("Public client not ready");
    }

    renewLock();
    await delay(PUBLIC_CLIENT_RECONNECT_POLL_MS);
  }

  return null;
}

export function createAutoMineLoopAdapter({
  actorAddress,
  autoMineActive,
  betPendingGraceMs,
  betPendingStaleMs,
  blocks,
  forceReplacePendingNonceGap,
  gasBumpBase,
  gasBumpReplacementStep,
  getBumpedFees,
  maxBetAttempts,
  networkBackoffInitialMs,
  networkBackoffMaxMs,
  onProgress,
  pendingBetRef,
  placeBets,
  placeBetsSilent,
  placeBets7702,
  readClient,
  readSilentSend,
  renewLock,
  rounds,
  secureRandom,
  singleAmountRaw,
}: CreateAutoMineLoopAdapterOptions): AutoMineLoopAdapter {
  return {
    async awaitEpochReady({ lastPlacedEpoch, roundIndex, rounds: totalRounds }) {
      return await awaitEpochReadyToBet({
        isActive: autoMineActive,
        lastPlacedEpoch,
        onProgress,
        readClient,
        renewLock,
        roundIndex,
        rounds: totalRounds,
        secureRandom,
      });
    },
    async prepareRoundCommand({ lastPlacedEpoch, roundIndex, rounds: totalRounds }) {
      const client = await awaitActivePublicClient({
        autoMineActive,
        onProgress,
        readClient,
        renewLock,
        roundIndex,
        rounds: totalRounds,
      });
      if (!client) {
        return { kind: "stop-no-client" };
      }

      const roundPlan = await planAutoMineRound({
        actorAddress,
        blocks,
        client,
        lastPlacedEpoch,
        secureRandom,
        singleAmountRaw,
      });
      switch (roundPlan.kind) {
        case "skip-existing":
          return {
            kind: "skip-existing",
            liveEpoch: roundPlan.liveEpoch,
            alreadyBetTiles: roundPlan.alreadyBetTiles,
            effectiveBlocks: roundPlan.effectiveBlocks,
          };

        case "stop-insufficient-balance":
          return {
            kind: "stop-insufficient-balance",
            neededAmount: roundPlan.neededAmount,
            currentAmount: roundPlan.currentAmount,
          };

        case "ready":
          return {
            kind: "ready",
            alreadyBetTiles: roundPlan.alreadyBetTiles,
            command: {
              client,
              effectiveBlocks: roundPlan.effectiveBlocks,
              epochNeedsResolve: roundPlan.epochNeedsResolve,
              liveEpoch: roundPlan.liveEpoch,
              roundCandidateEpochs: roundPlan.roundCandidateEpochs,
              selectionEpoch: roundPlan.selectionEpoch,
              tilesToBet: roundPlan.tilesToBet,
            },
          };
      }
    },
    async executeRoundCommand({
      command,
      refreshSession,
      roundIndex,
    }) {
      const result = await executeAutoMineBetLoop({
        actorAddress,
        autoMineActive,
        betPendingGraceMs,
        betPendingStaleMs,
        currentEpoch: command.liveEpoch,
        currentRoundIndex: roundIndex,
        forceReplacePendingNonceGap,
        getBumpedFees,
        gasBumpBase,
        gasBumpReplacementStep,
        maxBetAttempts,
        networkBackoffInitialMs,
        networkBackoffMaxMs,
        onProgress,
        onSessionRefresh: refreshSession,
        pendingBetRef,
        placeBets,
        placeBetsSilent,
        placeBets7702,
        publicClient: command.client,
        readSilentSend,
        rounds,
        singleAmountRaw,
        tilesToBet: command.tilesToBet,
        roundCandidateEpochs: command.roundCandidateEpochs,
        effectiveBlocks: command.effectiveBlocks,
        getRetryDelayMs: getNetworkRetryDelayMs,
      });
      switch (result.kind) {
        case "submitted":
          return { kind: "submitted" };

        case "stopped":
          return { kind: "stopped" };

        case "epoch-ended-skip":
          return {
            kind: "epoch-ended",
            liveEpoch: command.liveEpoch,
          };

        case "detected-on-chain":
          return {
            kind: "confirmed",
            source: "detected-on-chain",
            placedEpoch: result.placedEpoch,
          };
      }
    },
    async finalizeRoundCommand({
      command,
      roundIndex,
    }) {
      return await finalizeConfirmedRound({
        actorAddress,
        client: command.client,
        effectiveBlocks: command.effectiveBlocks,
        epochNeedsResolve: command.epochNeedsResolve,
        liveEpoch: command.liveEpoch,
        rounds,
        roundIndex,
        tilesToBet: command.tilesToBet,
      });
    },
    async recoverRoundCommand({
      command,
      roundIndex,
      rounds: totalRounds,
    }) {
      const client = await awaitActivePublicClient({
        autoMineActive,
        onProgress,
        readClient,
        renewLock,
        roundIndex,
        rounds: totalRounds,
      });
      if (!client) {
        return { kind: "retry" };
      }

      return await recoverRoundAfterRpcError({
        actorAddress,
        blocks,
        client,
        roundCandidateEpochs: command.roundCandidateEpochs,
        roundTilesToBet: command.tilesToBet,
      });
    },
  };
}
