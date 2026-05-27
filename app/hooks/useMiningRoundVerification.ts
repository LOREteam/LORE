"use client";

import type { PublicClient } from "viem";
import { CONTRACT_ADDRESS, GAME_ABI, GRID_SIZE } from "../lib/constants";
import { countConfirmedTiles, dedupeEpochs, findConfirmedEpochForTiles } from "./useMining.shared";

export interface VerifiedRoundResult {
  placedEpoch: bigint;
  selectionEpoch: string;
}

async function findConfirmedEpochBestEffort(params: {
  actorAddress: `0x${string}`;
  candidateEpochs: bigint[];
  client: PublicClient;
  tilesToBet: number[];
}) {
  const { actorAddress, candidateEpochs, client, tilesToBet } = params;
  let bestEpoch: bigint | null = null;
  let bestConfirmedCount = 0;

  for (const epoch of dedupeEpochs(candidateEpochs)) {
    try {
      const bets = (await client.readContract({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "getUserBetsAll",
        args: [epoch, actorAddress],
      })) as bigint[];
      const confirmedCount = countConfirmedTiles(bets, tilesToBet);
      if (confirmedCount >= tilesToBet.length) {
        return { epoch, confirmedCount };
      }
      if (confirmedCount > bestConfirmedCount) {
        bestConfirmedCount = confirmedCount;
        bestEpoch = epoch;
      }
    } catch {
      // Keep scanning nearby epochs when the public RPC flakes.
    }
  }

  if (bestEpoch === null) return null;
  return { epoch: bestEpoch, confirmedCount: bestConfirmedCount };
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

  const targetEpoch = epochNeedsResolve ? liveEpoch + 1n : liveEpoch;
  let placedEpoch = targetEpoch;

  try {
    const verifyBets = (await client.readContract({
      address: CONTRACT_ADDRESS,
      abi: GAME_ABI,
      functionName: "getUserBetsAll",
      args: [targetEpoch, actorAddress],
    })) as bigint[];
    const countInExpected = countConfirmedTiles(verifyBets, tilesToBet);

    if (countInExpected >= tilesToBet.length) {
      return {
        confirmed: true,
        confirmedCount: countInExpected,
        placedEpoch,
        logLine: `${logPrefix} confirmed | epoch=${targetEpoch}, bets=${countInExpected}/${effectiveBlocks}`,
        logLevel: "info",
      } as const;
    }

    const nextEpoch = targetEpoch + 1n;
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
          const epochPlus2 = targetEpoch + 2n;
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
            logLine: `post-bet verify: ${countInExpected}/${effectiveBlocks} in ${targetEpoch}, ${countInNext} in ${nextEpoch}, ${countE2} in ${epochPlus2}`,
            logLevel: "warn",
          } as const;
        } catch {
          return {
            confirmed: false,
            confirmedCount: Math.max(countInExpected, countInNext),
            placedEpoch,
            logLine: `post-bet verify: ${countInExpected} in epoch ${targetEpoch}, ${countInNext} in epoch ${nextEpoch} - expected ${effectiveBlocks}`,
            logLevel: "warn",
          } as const;
        }
      }

      return {
        confirmed: false,
        confirmedCount: Math.max(countInExpected, countInNext),
        placedEpoch,
        logLine: `post-bet verify: ${countInExpected} in epoch ${targetEpoch}, ${countInNext} in epoch ${nextEpoch} - expected ${effectiveBlocks}`,
        logLevel: "warn",
      } as const;
    } catch {
      const bestEffortRound = await findConfirmedEpochBestEffort({
        actorAddress,
        candidateEpochs: [targetEpoch, nextEpoch, targetEpoch + 2n],
        client,
        tilesToBet,
      });
      if (bestEffortRound && bestEffortRound.confirmedCount >= tilesToBet.length) {
        placedEpoch = bestEffortRound.epoch;
        return {
          confirmed: true,
          confirmedCount: bestEffortRound.confirmedCount,
          placedEpoch,
          logLine: `${logPrefix} confirmed | bets found after RPC fallback in epoch ${bestEffortRound.epoch}, bets=${bestEffortRound.confirmedCount}/${effectiveBlocks}`,
          logLevel: "info",
        } as const;
      }

      const fullyConfirmedInExpected = countInExpected >= tilesToBet.length;
      return {
        confirmed: fullyConfirmedInExpected,
        confirmedCount: countInExpected,
        placedEpoch,
        logLine: fullyConfirmedInExpected
          ? `${logPrefix} confirmed | ${countInExpected}/${effectiveBlocks} bets in epoch ${targetEpoch}`
          : `${logPrefix} partial verify only | ${countInExpected}/${effectiveBlocks} bets in epoch ${targetEpoch}`,
        logLevel: fullyConfirmedInExpected ? "info" : "warn",
      } as const;
    }
  } catch {
    const bestEffortRound = await findConfirmedEpochBestEffort({
      actorAddress,
      candidateEpochs: [targetEpoch, targetEpoch + 1n, targetEpoch + 2n],
      client,
      tilesToBet,
    });
    if (bestEffortRound && bestEffortRound.confirmedCount >= tilesToBet.length) {
      return {
        confirmed: true,
        confirmedCount: bestEffortRound.confirmedCount,
        placedEpoch: bestEffortRound.epoch,
        logLine: `${logPrefix} confirmed | bets found after RPC fallback in epoch ${bestEffortRound.epoch}, bets=${bestEffortRound.confirmedCount}/${effectiveBlocks}`,
        logLevel: "info",
      } as const;
    }

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

  const bestEffortRound = await findConfirmedEpochBestEffort({
    actorAddress,
    candidateEpochs: [liveEpoch, ...roundCandidateEpochs],
    client,
    tilesToBet,
  });
  if (bestEffortRound && bestEffortRound.confirmedCount >= tilesToBet.length) {
    return {
      confirmed: true,
      placedEpoch: bestEffortRound.epoch,
      selectionEpoch: bestEffortRound.epoch.toString(),
    } as const;
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
  const effBlocks = roundTilesToBet.length || Math.min(blocks, GRID_SIZE);
  let checkEpoch: bigint;
  try {
    checkEpoch = (await client.readContract({
      address: CONTRACT_ADDRESS,
      abi: GAME_ABI,
      functionName: "currentEpoch",
    })) as bigint;
  } catch {
    const bestEffortRound = await findConfirmedEpochBestEffort({
      actorAddress,
      candidateEpochs: roundCandidateEpochs,
      client,
      tilesToBet: roundTilesToBet,
    });
    if (bestEffortRound && bestEffortRound.confirmedCount >= effBlocks) {
      return {
        confirmed: true,
        placedEpoch: bestEffortRound.epoch,
        selectionEpoch: bestEffortRound.epoch.toString(),
        confirmedCount: bestEffortRound.confirmedCount,
        effectiveBlocks: effBlocks,
      } as const;
    }

    const fallbackEpoch = dedupeEpochs(roundCandidateEpochs)[0] ?? 1n;
    return {
      confirmed: false,
      placedEpoch: fallbackEpoch,
      selectionEpoch: fallbackEpoch.toString(),
      confirmedCount: bestEffortRound?.confirmedCount ?? 0,
      effectiveBlocks: effBlocks,
    } as const;
  }

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
      effectiveBlocks: effBlocks,
    } as const;
  }

  const bestEffortRound = await findConfirmedEpochBestEffort({
    actorAddress,
    candidateEpochs: [checkEpoch, checkEpoch + 1n, ...roundCandidateEpochs],
    client,
    tilesToBet: roundTilesToBet,
  });

  if (bestEffortRound && bestEffortRound.confirmedCount >= effBlocks) {
    return {
      confirmed: true,
      placedEpoch: bestEffortRound.epoch,
      selectionEpoch: bestEffortRound.epoch.toString(),
      confirmedCount: bestEffortRound.confirmedCount,
      effectiveBlocks: effBlocks,
    } as const;
  }

  const checkBets = (await client.readContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "getUserBetsAll",
    args: [checkEpoch, actorAddress],
  })) as bigint[];
  const alreadyCount = countConfirmedTiles(checkBets, roundTilesToBet);

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
