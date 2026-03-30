"use client";

import type { PublicClient } from "viem";
import { CONTRACT_ADDRESS, GAME_ABI, GRID_SIZE, LINEA_TOKEN_ADDRESS, TOKEN_ABI } from "../lib/constants";
import { normalizeTiles, withMiningRpcTimeout } from "./useMining.shared";

export type AutoMineRoundPlan =
  | {
      kind: "skip-existing";
      liveEpoch: bigint;
      effectiveBlocks: number;
      alreadyBetTiles: number[];
    }
  | {
      kind: "stop-insufficient-balance";
      liveEpoch: bigint;
      neededAmount: number;
      currentAmount: number;
    }
  | {
      kind: "ready";
      liveEpoch: bigint;
      epochNeedsResolve: boolean;
      effectiveBlocks: number;
      tilesToBet: number[];
      alreadyBetTiles: number[];
      roundCandidateEpochs: bigint[];
      selectionEpoch: string;
    };

interface PlanAutoMineRoundOptions {
  actorAddress: `0x${string}`;
  blocks: number;
  client: PublicClient;
  lastPlacedEpoch: bigint | null;
  secureRandom: (max: number) => number;
  singleAmountRaw: bigint;
}

export async function planAutoMineRound({
  actorAddress,
  blocks,
  client,
  lastPlacedEpoch,
  secureRandom,
  singleAmountRaw,
}: PlanAutoMineRoundOptions): Promise<AutoMineRoundPlan> {
  const liveEpoch = (await withMiningRpcTimeout(client.readContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "currentEpoch",
  }), "plan.currentEpoch")) as bigint;

  const epochNeedsResolve = lastPlacedEpoch !== null && liveEpoch <= lastPlacedEpoch;
  const effectiveBlocks = Math.min(blocks, GRID_SIZE);
  let tilesToAdd = effectiveBlocks;
  const alreadyBetTiles = new Set<number>();

  if (!epochNeedsResolve) {
    const existingBets = (await withMiningRpcTimeout(client.readContract({
      address: CONTRACT_ADDRESS,
      abi: GAME_ABI,
      functionName: "getUserBetsAll",
      args: [liveEpoch, actorAddress],
    }), "plan.getUserBetsAll")) as bigint[];

    existingBets.forEach((bet, index) => {
      if (bet > 0n) alreadyBetTiles.add(index + 1);
    });

    if (alreadyBetTiles.size >= effectiveBlocks) {
      return {
        kind: "skip-existing",
        liveEpoch,
        effectiveBlocks,
        alreadyBetTiles: [...alreadyBetTiles],
      };
    }

    tilesToAdd = effectiveBlocks - alreadyBetTiles.size;
  }

  const roundCostActual = singleAmountRaw * BigInt(tilesToAdd);
  const tokenBalance = (await withMiningRpcTimeout(client.readContract({
    address: LINEA_TOKEN_ADDRESS,
    abi: TOKEN_ABI,
    functionName: "balanceOf",
    args: [actorAddress],
  }), "plan.balanceOf")) as bigint;

  if (tokenBalance < roundCostActual) {
    return {
      kind: "stop-insufficient-balance",
      liveEpoch,
      neededAmount: Number(roundCostActual) / 1e18,
      currentAmount: Number(tokenBalance) / 1e18,
    };
  }

  const tileSet = new Set<number>();
  let safetyCounter = 0;
  while (tileSet.size < tilesToAdd && safetyCounter < 500) {
    const candidate = secureRandom(GRID_SIZE) + 1;
    if (!alreadyBetTiles.has(candidate)) tileSet.add(candidate);
    safetyCounter += 1;
  }

  const tilesToBet = normalizeTiles([...tileSet]);
  const roundCandidateEpochs = epochNeedsResolve
    ? [liveEpoch + 1n, liveEpoch + 2n, liveEpoch]
    : [liveEpoch, liveEpoch + 1n, liveEpoch + 2n];

  return {
    kind: "ready",
    liveEpoch,
    epochNeedsResolve,
    effectiveBlocks,
    tilesToBet,
    alreadyBetTiles: [...alreadyBetTiles],
    roundCandidateEpochs,
    selectionEpoch: (epochNeedsResolve ? liveEpoch + 1n : liveEpoch).toString(),
  };
}
