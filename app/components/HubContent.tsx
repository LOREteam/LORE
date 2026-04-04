"use client";

import React from "react";
import { HubGameBoard } from "./HubGameBoard";
import { HubSidePanel } from "./HubSidePanel";

interface TileViewRow {
  tileId: number;
  users: number;
  poolDisplay: string;
  hasMyBet: boolean;
}

interface LastBet {
  tiles: number[];
  amount: string;
}

interface RunningParams {
  betStr: string;
  blocks: number;
  rounds: number;
}

interface UnclaimedWin {
  epoch: string;
  amountWei: string;
}

interface HubContentProps {
  autoMineProgress: string | null;
  chatOpen: boolean;
  formattedBalance: string | null;
  gridDisplayEpoch: string | null;
  gridSelectedTiles: number[];
  handleAutoMineWithGuard: (betStr: string, blocks: number, rounds: number) => Promise<void>;
  handleManualMineWithGuard: (betAmountStr: string) => Promise<void>;
  handleRepeatLastBet: () => Promise<void>;
  isAnalyzing: boolean;
  isAutoMining: boolean;
  isClaiming: boolean;
  isDeepScanning: boolean;
  isPending: boolean;
  isRevealing: boolean;
  isScanning: boolean;
  coldBootDefaults: boolean;
  liveStateReady: boolean;
  isDailyJackpot: boolean;
  isWeeklyJackpot: boolean;
  jackpotAmount?: number;
  lastBet: LastBet | null;
  lowEthBalance: boolean;
  onClaim: (epochId: string) => void;
  onClaimAll: () => void;
  onScan: () => void;
  onTileClick: (tileId: number) => void;
  reducedMotion: boolean;
  runningParams: RunningParams | null;
  selectedTilesCount: number;
  showSelectionOnGrid: boolean;
  tileViewData: TileViewRow[];
  unclaimedWins: UnclaimedWin[];
  walletAddress?: string | null;
  winningTileId: number | null;
  hasMyWinningBet: boolean;
}

export const HubContent = React.memo(function HubContent({
  autoMineProgress,
  chatOpen,
  formattedBalance,
  gridDisplayEpoch,
  gridSelectedTiles,
  handleAutoMineWithGuard,
  handleManualMineWithGuard,
  handleRepeatLastBet,
  isAnalyzing,
  isAutoMining,
  isClaiming,
  isDeepScanning,
  isPending,
  isRevealing,
  isScanning,
  coldBootDefaults,
  liveStateReady,
  isDailyJackpot,
  isWeeklyJackpot,
  jackpotAmount,
  lastBet,
  lowEthBalance,
  onClaim,
  onClaimAll,
  onScan,
  onTileClick,
  reducedMotion,
  runningParams,
  selectedTilesCount,
  showSelectionOnGrid,
  tileViewData,
  unclaimedWins,
  walletAddress,
  winningTileId,
  hasMyWinningBet,
}: HubContentProps) {
  return (
    <div className="grid grid-cols-1 min-[900px]:grid-cols-12 gap-1.5">
      <HubGameBoard
        gridDisplayEpoch={gridDisplayEpoch}
        coldBootDefaults={coldBootDefaults}
        liveStateReady={liveStateReady}
        tileViewData={tileViewData}
        gridSelectedTiles={gridSelectedTiles}
        winningTileId={winningTileId}
        isRevealing={isRevealing}
        isAnalyzing={isAnalyzing}
        reducedMotion={reducedMotion}
        showSelectionOnGrid={showSelectionOnGrid}
        onTileClick={onTileClick}
        walletAddress={walletAddress}
        isDailyJackpot={isDailyJackpot}
        isWeeklyJackpot={isWeeklyJackpot}
        jackpotAmount={jackpotAmount}
        hasMyWinningBet={hasMyWinningBet}
        unclaimedWins={unclaimedWins}
        isScanning={isScanning}
        isDeepScanning={isDeepScanning}
        isClaiming={isClaiming}
        onScan={onScan}
        onClaim={onClaim}
        onClaimAll={onClaimAll}
      />

      <HubSidePanel
        chatOpen={chatOpen}
        coldBootDefaults={coldBootDefaults}
        formattedBalance={formattedBalance}
        liveStateReady={liveStateReady}
        selectedTilesCount={selectedTilesCount}
        isPending={isPending}
        isRevealing={isRevealing}
        isAnalyzing={isAnalyzing}
        isAutoMining={isAutoMining}
        handleManualMineWithGuard={handleManualMineWithGuard}
        lastBet={lastBet}
        handleRepeatLastBet={handleRepeatLastBet}
        autoMineProgress={autoMineProgress}
        runningParams={runningParams}
        lowEthBalance={lowEthBalance}
        handleAutoMineWithGuard={handleAutoMineWithGuard}
      />
    </div>
  );
});
