"use client";

import type { PublicClient } from "viem";
import { CONTRACT_ADDRESS, GAME_ABI, GRID_SIZE } from "../lib/constants";
import { countConfirmedTiles, findConfirmedEpochForTiles } from "./useMining.shared";

export interface VerifiedRoundResult {
  placedEpoch: bigint;
  selectionEpoch: string;
}

export async function verifySuccessfulRoundPlacement(params: {
  actorAddress: `0x${string}`;
  client: PublicClient;
  effectiveBlocks: number;
  epochNeedsResolve: boolean;
  liveEpoch: bigint;
  logPrefix: string;
  tilesToBet: number[];
}) {
  const {
    actorAddress,
    client,
    effectiveBlocks,
    epochNeedsResolve,
    liveEpoch,
    logPrefix,
    tilesToBet,
  } = params;

  let placedEpoch = epochNeedsResolve ? liveEpoch + 1n : liveEpoch;

  try {
    const verifyBets = (await client.readContract({
      address: CONTRACT_ADDRESS,
      abi: GAME_ABI,
      functionName: "getUserBetsAll",
      args: [liveEpoch, actorAddress],
    })) as bigint[];
    const countInExpected = countConfirmedTiles(verifyBets, tilesToBet);

    if (countInExpected >= tilesToBet.length) {
      return {
        confirmed: true,
        confirmedCount: countInExpected,
        placedEpoch,
        logLine: `${logPrefix} confirmed | epoch=${liveEpoch}, bets=${countInExpected}/${effectiveBlocks}`,
        logLevel: "info",
      } as const;
    }

    const nextEpoch = liveEpoch + 1n;
    try {
      const nextBets = (await client.readContract({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "getUserBetsAll",
        args: [nextEpoch, actorAddress],
      })) as bigint[];
      const countInNext = countConfirmedTiles(nextBets, tilesToBet);

      if (countInNext >= tilesToBet.length) {
        placedEpoch = nextEpoch;
        return {
          confirmed: true,
          confirmedCount: countInNext,
          placedEpoch,
          logLine: `${logPrefix} confirmed | bets landed in next epoch=${nextEpoch} (expected ${liveEpoch}), bets=${countInNext}/${effectiveBlocks}`,
          logLevel: "info",
        } as const;
      }

      if (countInExpected === 0 && countInNext === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const recheckNext = (await client.readContract({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "getUserBetsAll",
          args: [nextEpoch, actorAddress],
        })) as bigint[];
        const recheckNextCount = countConfirmedTiles(recheckNext, tilesToBet);
        if (recheckNextCount >= tilesToBet.length) {
          placedEpoch = nextEpoch;
          return {
            confirmed: true,
            confirmedCount: recheckNextCount,
            placedEpoch,
            logLine: `${logPrefix} confirmed | bets in epoch ${nextEpoch} (RPC lag), bets=${recheckNextCount}/${effectiveBlocks}`,
            logLevel: "info",
          } as const;
        }

        try {
          const epochPlus2 = liveEpoch + 2n;
          const betsE2 = (await client.readContract({
            address: CONTRACT_ADDRESS,
            abi: GAME_ABI,
            functionName: "getUserBetsAll",
            args: [epochPlus2, actorAddress],
          })) as bigint[];
          const countE2 = countConfirmedTiles(betsE2, tilesToBet);
          if (countE2 >= tilesToBet.length) {
            placedEpoch = epochPlus2;
            return {
              confirmed: true,
              confirmedCount: countE2,
              placedEpoch,
              logLine: `${logPrefix} confirmed | bets in epoch+2=${epochPlus2}, bets=${countE2}/${effectiveBlocks}`,
              logLevel: "info",
            } as const;
          }

          return {
            confirmed: false,
            confirmedCount: Math.max(countInExpected, countInNext, countE2),
            placedEpoch,
            logLine: `post-bet verify: ${countInExpected}/${effectiveBlocks} in ${liveEpoch}, ${countInNext} in ${nextEpoch}, ${countE2} in ${epochPlus2}`,
            logLevel: "warn",
          } as const;
        } catch {
          return {
            confirmed: false,
            confirmedCount: Math.max(countInExpected, countInNext),
            placedEpoch,
            logLine: `post-bet verify: ${countInExpected} in epoch ${liveEpoch}, ${countInNext} in epoch ${nextEpoch} - expected ${effectiveBlocks}`,
            logLevel: "warn",
          } as const;
        }
      }

      return {
        confirmed: false,
        confirmedCount: Math.max(countInExpected, countInNext),
        placedEpoch,
        logLine: `post-bet verify: ${countInExpected} in epoch ${liveEpoch}, ${countInNext} in epoch ${nextEpoch} - expected ${effectiveBlocks}`,
        logLevel: "warn",
      } as const;
    } catch {
      const fullyConfirmedInExpected = countInExpected >= tilesToBet.length;
      return {
        confirmed: fullyConfirmedInExpected,
        confirmedCount: countInExpected,
        placedEpoch,
        logLine: fullyConfirmedInExpected
          ? `${logPrefix} confirmed | ${countInExpected}/${effectiveBlocks} bets in epoch ${liveEpoch}`
          : `${logPrefix} partial verify only | ${countInExpected}/${effectiveBlocks} bets in epoch ${liveEpoch}`,
        logLevel: fullyConfirmedInExpected ? "info" : "warn",
      } as const;
    }
  } catch {
    return {
      confirmed: false,
      confirmedCount: 0,
      placedEpoch,
      logLine: null,
      logLevel: "info",
    } as const;
  }
}

export async function verifyRoundAlreadyPlaced(params: {
  actorAddress: `0x${string}`;
  client: PublicClient;
  effectiveBlocks: number;
  liveEpoch: bigint;
  roundCandidateEpochs: bigint[];
  tilesToBet: number[];
}) {
  const {
    actorAddress,
    client,
    liveEpoch,
    roundCandidateEpochs,
    tilesToBet,
  } = params;

  const confirmedRound = await findConfirmedEpochForTiles(
    client,
    actorAddress,
    roundCandidateEpochs,
    tilesToBet,
  );
  if (confirmedRound) {
    return {
      confirmed: true,
      placedEpoch: confirmedRound.epoch,
      selectionEpoch: confirmedRound.epoch.toString(),
    } as const;
  }

  try {
    const recheckBets = (await client.readContract({
      address: CONTRACT_ADDRESS,
      abi: GAME_ABI,
      functionName: "getUserBetsAll",
      args: [liveEpoch, actorAddress],
    })) as bigint[];
    const recheckCount = countConfirmedTiles(recheckBets, tilesToBet);
    if (recheckCount >= tilesToBet.length) {
      return {
        confirmed: true,
        placedEpoch: liveEpoch,
        selectionEpoch: liveEpoch.toString(),
      } as const;
    }
  } catch {
    // non-critical secondary verification
  }

  return {
    confirmed: false,
    placedEpoch: null,
    selectionEpoch: null,
  } as const;
}

export async function verifyRoundAfterRpcError(params: {
  actorAddress: `0x${string}`;
  blocks: number;
  client: PublicClient;
  roundCandidateEpochs: bigint[];
  roundTilesToBet: number[];
}) {
  const {
    actorAddress,
    blocks,
    client,
    roundCandidateEpochs,
    roundTilesToBet,
  } = params;

  const checkEpoch = (await client.readContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "currentEpoch",
  })) as bigint;

  const confirmedRound = await findConfirmedEpochForTiles(
    client,
    actorAddress,
    [checkEpoch, checkEpoch + 1n, ...roundCandidateEpochs],
    roundTilesToBet,
  );
  if (confirmedRound) {
    return {
      confirmed: true,
      placedEpoch: confirmedRound.epoch,
      selectionEpoch: confirmedRound.epoch.toString(),
      confirmedCount: confirmedRound.confirmedCount,
      effectiveBlocks: roundTilesToBet.length || Math.min(blocks, GRID_SIZE),
    } as const;
  }

  const checkBets = (await client.readContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "getUserBetsAll",
    args: [checkEpoch, actorAddress],
  })) as bigint[];
  const alreadyCount = countConfirmedTiles(checkBets, roundTilesToBet);
  const effBlocks = roundTilesToBet.length || Math.min(blocks, GRID_SIZE);

  if (alreadyCount >= effBlocks) {
    return {
      confirmed: true,
      placedEpoch: checkEpoch,
      selectionEpoch: checkEpoch.toString(),
      confirmedCount: alreadyCount,
      effectiveBlocks: effBlocks,
    } as const;
  }

  return {
    confirmed: false,
    placedEpoch: checkEpoch,
    selectionEpoch: checkEpoch.toString(),
    confirmedCount: alreadyCount,
    effectiveBlocks: effBlocks,
  } as const;
}
