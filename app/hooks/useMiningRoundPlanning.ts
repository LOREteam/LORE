"use client";

import type { PublicClient } from "viem";
import { CONTRACT_ADDRESS, GAME_ABI, GRID_SIZE, LINEA_TOKEN_ADDRESS, TOKEN_ABI } from "../lib/constants";
import { normalizeTiles, withMiningRpcTimeout } from "./useMining.shared";

export type AutoMineRoundPlan =
  | {
      kind: "skip-existing";
      liveEpoch?: bigint;
      placedEpoch?: bigint;
      effectiveBlocks: number;
      alreadyBetTiles: number[];
    }
  | {
      kind: "stop-insufficient-balance";
      liveEpoch: bigint;
      neededAmount: string;
      currentAmount: string;
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

function formatLineaWeiOneDecimal(rawValue: bigint): string {
  const value = rawValue < 0n ? 0n : rawValue;
  const weiPerLinea = 10n ** 18n;
  const whole = value / weiPerLinea;
  const remainder = value % weiPerLinea;
  const roundedTenths = (remainder * 10n + weiPerLinea / 2n) / weiPerLinea;
  if (roundedTenths >= 10n) {
    return `${whole + 1n}.0`;
  }
  return `${whole}.${roundedTenths}`;
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
  const targetEpoch = epochNeedsResolve ? liveEpoch + 1n : liveEpoch;
  const effectiveBlocks = Math.min(blocks, GRID_SIZE);
  let tilesToAdd = effectiveBlocks;
  const alreadyBetTiles = new Set<number>();

  const existingBets = (await withMiningRpcTimeout(client.readContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "getUserBetsAll",
    args: [targetEpoch, actorAddress],
  }), "plan.getUserBetsAll")) as bigint[];

  existingBets.forEach((bet, index) => {
    if (bet > 0n) alreadyBetTiles.add(index + 1);
  });

  if (alreadyBetTiles.size >= effectiveBlocks) {
    return {
      kind: "skip-existing",
      liveEpoch,
      placedEpoch: targetEpoch,
      effectiveBlocks,
      alreadyBetTiles: [...alreadyBetTiles],
    };
  }

  tilesToAdd = effectiveBlocks - alreadyBetTiles.size;

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
      neededAmount: formatLineaWeiOneDecimal(roundCostActual),
      currentAmount: formatLineaWeiOneDecimal(tokenBalance),
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
