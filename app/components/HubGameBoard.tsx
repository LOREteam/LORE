"use client";

import React from "react";
import { JackpotBanner } from "./JackpotBanner";
import { MiningGrid } from "./MiningGrid";

interface TileViewRow {
  tileId: number;
  users: number;
  poolDisplay: string;
  hasMyBet: boolean;
}

interface UnclaimedWin {
  epoch: string;
  amountWei: string;
}

interface HubGameBoardProps {
  gridDisplayEpoch: string | null;
  coldBootDefaults: boolean;
  liveStateReady: boolean;
  tileViewData: TileViewRow[];
  gridSelectedTiles: number[];
  winningTileId: number | null;
  isRevealing: boolean;
  isAnalyzing: boolean;
  reducedMotion: boolean;
  showSelectionOnGrid: boolean;
  onTileClick: (tileId: number) => void;
  walletAddress?: string | null;
  isDailyJackpot: boolean;
  isWeeklyJackpot: boolean;
  jackpotAmount?: number;
  jackpotFallbackAmount?: number;
  dailyJackpotFallbackAmount?: number;
  weeklyJackpotFallbackAmount?: number;
  hasMyWinningBet: boolean;
  unclaimedWins: UnclaimedWin[];
  isScanning: boolean;
  isDeepScanning: boolean;
  isClaiming: boolean;
  onScan: () => void;
  onClaim: (epochId: string) => void;
  onClaimAll: () => void;
}

export const HubGameBoard = React.memo(function HubGameBoard({
  gridDisplayEpoch,
  coldBootDefaults,
  liveStateReady,
  tileViewData,
  gridSelectedTiles,
  winningTileId,
  isRevealing,
  isAnalyzing,
  reducedMotion,
  showSelectionOnGrid,
  onTileClick,
  walletAddress,
  isDailyJackpot,
  isWeeklyJackpot,
  jackpotAmount,
  jackpotFallbackAmount,
  dailyJackpotFallbackAmount,
  weeklyJackpotFallbackAmount,
  hasMyWinningBet,
}: HubGameBoardProps) {
  return (
    <div className="gameplay-board-zone min-[900px]:col-span-9 flex min-w-0 flex-col gap-1.5">
      <MiningGrid
        coldBootDefaults={coldBootDefaults}
        liveStateReady={liveStateReady}
        tileViewData={tileViewData}
        selectedTiles={gridSelectedTiles}
        winningTileId={winningTileId}
        isRevealing={isRevealing}
        isAnalyzing={isAnalyzing}
        reducedMotion={reducedMotion}
        showSelection={showSelectionOnGrid}
        onTileClick={onTileClick}
        isDailyJackpot={isDailyJackpot}
        isWeeklyJackpot={isWeeklyJackpot}
        jackpotAmount={jackpotAmount}
      />

      <JackpotBanner
        winningTileId={winningTileId}
        isRevealing={isRevealing}
        tileViewData={tileViewData}
        epoch={gridDisplayEpoch}
        walletAddress={walletAddress}
        isDailyJackpot={isDailyJackpot}
        isWeeklyJackpot={isWeeklyJackpot}
        jackpotAmount={jackpotAmount}
        jackpotFallbackAmount={jackpotFallbackAmount}
        dailyJackpotFallbackAmount={dailyJackpotFallbackAmount}
        weeklyJackpotFallbackAmount={weeklyJackpotFallbackAmount}
        hasMyWinningBet={hasMyWinningBet}
        reducedMotion={reducedMotion}
      />
    </div>
  );
});
