"use client";

import { useMemo, useState } from "react";
import { type PollPhase, useGameRevealState } from "./useGameEpochPresentation";
import { useGameCountdown } from "./useGameCountdown";
import { useGameCoreReads } from "./useGameCoreReads";
import { useGameDerivedState } from "./useGameDerivedState";
import { useGameEffectiveState } from "./useGameEffectiveState";
import { useGameGridReads } from "./useGameGridReads";
import { useGameHistoryData } from "./useGameHistoryData";
import { useGameLiveStateSnapshot, type LiveStateApiResponse } from "./useGameLiveStateSnapshot";
import { useGamePollingConfig } from "./useGamePollingConfig";
import { useGameTileUserCounts } from "./useGameTileUserCounts";
import { useGameUserBets } from "./useGameUserBets";
import { useGameWalletContext } from "./useGameWalletContext";

interface UseGameDataOptions {
  historyDetailed?: boolean;
  initialServerLiveState?: LiveStateApiResponse | null;
  liveGrid?: boolean;
  preferredAddress?: `0x${string}` | string | null;
}

export function useGameData(options?: UseGameDataOptions) {
  const historyDetailed = options?.historyDetailed ?? false;
  const initialServerLiveState = options?.initialServerLiveState ?? null;
  const liveGrid = options?.liveGrid ?? true;
  const preferredAddress = options?.preferredAddress ?? null;
  const {
    address,
    chainId,
    walletAddress,
    tokenBalance,
    isPageVisible,
    autoMineSessionActive,
  } = useGameWalletContext({ preferredAddress });
  const positiveBigIntOrUndefined = (value: bigint | null | undefined) =>
    value != null && value > 0n ? value : undefined;

  const {
    fallbackCurrentEpoch,
    fallbackEpochEndTime,
    fallbackJackpotInfoRaw,
    fallbackRolloverPoolRaw,
    fallbackCurrentEpochData,
    fallbackTileData,
    fallbackTileUserCounts,
    fallbackIndexedTilePools,
    fallbackEpochDuration,
    fallbackPendingEpochDuration,
    fallbackPendingEpochDurationEta,
    fallbackPendingEpochDurationEffectiveFromEpoch,
    liveStateBootstrapPending,
    liveContractReadsEnabled,
  } = useGameLiveStateSnapshot({ initialSnapshot: initialServerLiveState, isPageVisible });

  const [visualEpoch, setVisualEpoch] = useState<string | null>(null);
  const [isRevealing, setIsRevealing] = useState(false);
  const [lockedGridEpoch, setLockedGridEpoch] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [pollPhase, setPollPhase] = useState<PollPhase>("slow");

  // lockedGridEpoch persists until the new epoch is ready - prevents intermediate flash
  const gridDisplayEpoch = lockedGridEpoch ?? visualEpoch;
  const gridDisplayEpochBigInt = useMemo(
    () => (gridDisplayEpoch ? BigInt(gridDisplayEpoch) : null),
    [gridDisplayEpoch],
  );

  const {
    epochInterval,
    epochEndInterval,
    liveGridInterval,
    liveUserBetsInterval,
    gridEpochInterval,
  } = useGamePollingConfig({
    isPageVisible,
    pollPhase,
    liveGrid,
    autoMineSessionActive,
    isRevealing,
  });

  const {
    actualCurrentEpoch,
    refetchEpoch,
    epochDurationSec,
    pendingEpochDuration,
    pendingEpochDurationEta,
    pendingEpochDurationEffectiveFromEpoch,
    jackpotInfoRaw,
    rolloverPoolRaw,
  } = useGameCoreReads({
    liveContractReadsEnabled,
    isPageVisible,
    epochInterval,
  });
  const currentEpochForReads =
    positiveBigIntOrUndefined(actualCurrentEpoch) ?? positiveBigIntOrUndefined(fallbackCurrentEpoch);
  const {
    epochEndTime,
    refetchEpochEndTime,
    tileData,
    refetchTileData,
    gridAndCurrentAreSame,
    gridEpochData,
    refetchGridEpochData,
    separateCurrentEpochData,
    currentAllowance,
    refetchAllowance,
  } = useGameGridReads({
    liveContractReadsEnabled,
    liveGrid,
    isPageVisible,
    isRevealing,
    walletAddress,
    resolvedCurrentEpoch: currentEpochForReads,
    gridDisplayEpochBigInt,
    epochEndInterval,
    liveGridInterval,
    gridEpochInterval,
  });
  const {
    resolvedCurrentEpoch,
    serverStateMatchesGrid,
    effectiveGridEpochData,
    effectiveTileData,
    currentEpochResolved,
    effectiveEpochEndTime,
    effectiveJackpotInfoRaw,
    effectiveRolloverPoolRaw,
    effectiveEpochDurationSec,
    effectivePendingEpochDuration,
    effectivePendingEpochDurationEta,
    effectivePendingEpochDurationEffectiveFromEpoch,
    liveStateReady,
  } = useGameEffectiveState({
    actualCurrentEpoch,
    fallbackCurrentEpoch,
    gridDisplayEpochBigInt,
    gridEpochData,
    fallbackCurrentEpochData,
    tileData,
    fallbackTileData,
    fallbackIndexedTilePools,
    gridAndCurrentAreSame,
    separateCurrentEpochData,
    epochEndTime,
    fallbackEpochEndTime,
    jackpotInfoRaw,
    fallbackJackpotInfoRaw,
    rolloverPoolRaw,
    fallbackRolloverPoolRaw,
    epochDurationSec,
    fallbackEpochDuration,
    pendingEpochDuration,
    fallbackPendingEpochDuration,
    pendingEpochDurationEta,
    fallbackPendingEpochDurationEta,
    pendingEpochDurationEffectiveFromEpoch,
    fallbackPendingEpochDurationEffectiveFromEpoch,
  });

  const { userBetsAll, refetchUserBets } = useGameUserBets({
    chainId,
    gridDisplayEpochBigInt,
    walletAddress,
    isPageVisible,
    liveUserBetsInterval,
  });

  useGameRevealState({
    actualCurrentEpoch: resolvedCurrentEpoch,
    gridEpochData: effectiveGridEpochData,
    visualEpoch,
    isRevealing,
    lockedGridEpoch,
    setVisualEpoch,
    setIsRevealing,
    setLockedGridEpoch,
    refetchGridEpochData,
    refetchUserBets,
  });

  const { tileUserCounts } = useGameTileUserCounts({
    gridDisplayEpochBigInt,
    liveGrid,
    serverStateMatchesGrid,
    fallbackTileUserCounts,
  });

  useGameCountdown({
    effectiveEpochEndTime,
    liveStateReady,
    isRevealing,
    visualEpoch,
    lockedGridEpoch,
    setLockedGridEpoch,
    refetchEpoch,
    refetchGridEpochData,
    refetchEpochEndTime,
    setTimeLeft,
    setPollPhase,
  });

  const {
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
  } = useGameDerivedState({
    chainId,
    effectiveJackpotInfoRaw,
    effectiveRolloverPoolRaw,
    effectiveTileData,
    tokenBalanceFormatted: tokenBalance?.formatted,
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
  });

  const {
    historyViewData,
    historyLoading,
    historyRefreshing,
    refetchHistory,
    historyPage,
    setHistoryPage,
    maxHistoryPages,
  } = useGameHistoryData({
    chainId,
    historyDetailed,
    isPageVisible,
    resolvedCurrentEpoch,
    walletAddress,
  });

  return {
    address,
    chainId,
    visualEpoch,
    gridDisplayEpoch,
    isRevealing,
    timeLeft,
    realTotalStaked,
    rolloverAmount,
    jackpotInfo,
    formattedLineaBalance,
    winningTileId,
    hasMyWinningBet,
    isDailyJackpot: currentEpochJackpotInfo.isDailyJackpot,
    isWeeklyJackpot: currentEpochJackpotInfo.isWeeklyJackpot,
    jackpotAmount,
    currentEpochResolved,
    tileViewData,
    currentAllowance,
    actualCurrentEpoch: resolvedCurrentEpoch,
    historyViewData,
    historyLoading,
    historyRefreshing,
    epochDurationChange,
    liveStateBootstrapPending,
    liveStateReady,
    refetchEpoch,
    refetchGridEpochData,
    refetchTileData,
    refetchUserBets,
    refetchAllowance,
    refetchHistory,
    setHistoryPage,
    historyPage,
    maxHistoryPages,
  };
}
