"use client";

import { useMemo } from "react";
import { useReadContract } from "wagmi";
import { CONTRACT_ADDRESS, GAME_ABI } from "../lib/constants";
import {
  buildCurrentEpochJackpotInfo,
  buildCurrentJackpotAmount,
  buildEpochDurationChange,
  buildJackpotInfo,
  buildRealTotalStaked,
  buildRolloverAmount,
  buildTileViewData,
  buildWinningTileId,
} from "./useGameData.helpers";

interface UseGameDerivedStateOptions {
  chainId: number;
  effectiveJackpotInfoRaw: unknown;
  effectiveRolloverPoolRaw: unknown;
  effectiveTileData: unknown;
  tokenBalanceFormatted?: string;
  isRevealing: boolean;
  effectiveGridEpochData: unknown;
  gridDisplayEpochBigInt: bigint | null;
  walletAddress?: `0x${string}`;
  isPageVisible: boolean;
  tileUserCounts: number[];
  userBetsAll?: bigint[];
  effectiveEpochDurationSec: unknown;
  effectivePendingEpochDuration: unknown;
  effectivePendingEpochDurationEta: unknown;
  effectivePendingEpochDurationEffectiveFromEpoch: unknown;
}

export function useGameDerivedState({
  chainId,
  effectiveJackpotInfoRaw,
  effectiveRolloverPoolRaw,
  effectiveTileData,
  tokenBalanceFormatted,
  isRevealing,
  effectiveGridEpochData,
  gridDisplayEpochBigInt,
  walletAddress,
  isPageVisible,
  tileUserCounts,
  userBetsAll,
  effectiveEpochDurationSec,
  effectivePendingEpochDuration,
  effectivePendingEpochDurationEta,
  effectivePendingEpochDurationEffectiveFromEpoch,
}: UseGameDerivedStateOptions) {
  const jackpotInfo = useMemo(() => buildJackpotInfo(effectiveJackpotInfoRaw), [effectiveJackpotInfoRaw]);
  const rolloverAmount = useMemo(() => buildRolloverAmount(effectiveRolloverPoolRaw), [effectiveRolloverPoolRaw]);
  const realTotalStaked = useMemo(
    () => buildRealTotalStaked(effectiveTileData, effectiveRolloverPoolRaw),
    [effectiveTileData, effectiveRolloverPoolRaw],
  );
  const formattedLineaBalance = useMemo(
    () => (tokenBalanceFormatted ? Number(tokenBalanceFormatted).toFixed(2) : null),
    [tokenBalanceFormatted],
  );
  const winningTileId = useMemo(
    () => buildWinningTileId(isRevealing, effectiveGridEpochData),
    [isRevealing, effectiveGridEpochData],
  );

  const { data: myWinningBetRaw } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "userBets",
    args:
      gridDisplayEpochBigInt && walletAddress && winningTileId !== null
        ? [gridDisplayEpochBigInt, BigInt(winningTileId), walletAddress]
        : undefined,
    chainId,
    query: {
      enabled: !!gridDisplayEpochBigInt && !!walletAddress && winningTileId !== null,
      refetchInterval: isPageVisible ? (isRevealing ? 750 : 5000) : 15000,
    },
  });

  const currentEpochJackpotInfo = useMemo(
    () => buildCurrentEpochJackpotInfo(effectiveGridEpochData),
    [effectiveGridEpochData],
  );
  const jackpotAmount = useMemo(
    () => buildCurrentJackpotAmount(jackpotInfo, currentEpochJackpotInfo),
    [jackpotInfo, currentEpochJackpotInfo],
  );
  const tileViewData = useMemo(
    () => buildTileViewData(effectiveTileData, tileUserCounts, userBetsAll),
    [effectiveTileData, tileUserCounts, userBetsAll],
  );
  const hasMyWinningBet = useMemo(() => {
    if (typeof myWinningBetRaw === "bigint") {
      return myWinningBetRaw > 0n;
    }
    if (winningTileId === null) {
      return false;
    }
    return tileViewData.some((tile) => tile.tileId === winningTileId && tile.hasMyBet);
  }, [myWinningBetRaw, tileViewData, winningTileId]);
  const epochDurationChange = useMemo(() => {
    return buildEpochDurationChange(
      effectiveEpochDurationSec,
      effectivePendingEpochDuration,
      effectivePendingEpochDurationEta,
      effectivePendingEpochDurationEffectiveFromEpoch,
    );
  }, [
    effectiveEpochDurationSec,
    effectivePendingEpochDuration,
    effectivePendingEpochDurationEta,
    effectivePendingEpochDurationEffectiveFromEpoch,
  ]);

  return {
    jackpotInfo,
    rolloverAmount,
    realTotalStaked,
    formattedLineaBalance,
    winningTileId,
    hasMyWinningBet,
    currentEpochJackpotInfo,
    jackpotAmount,
    tileViewData,
    epochDurationChange,
  };
}
