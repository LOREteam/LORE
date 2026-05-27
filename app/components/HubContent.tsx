"use client";

import React from "react";
import type { AutoMinePhase } from "../hooks/useMining.types";
import { HubGameBoard } from "./HubGameBoard";
import { HubSidePanel } from "./HubSidePanel";

interface TileViewRow {
  tileId: number;
  users: number;
  poolDisplay: string;
  hasMyBet: boolean;
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
  autoMinePhase: AutoMinePhase;
  autoMineProgress: string | null;
  chatOpen: boolean;
  formattedBalance: string | null;
  gridDisplayEpoch: string | null;
  gridSelectedTiles: number[];
  handleAutoMineWithGuard: (betStr: string, blocks: number, rounds: number) => Promise<void>;
  handleManualMineWithGuard: (betAmountStr: string) => Promise<void>;
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
  lowEthBalance: boolean;
  onClaim: (epochId: string) => void;
  onClaimAll: () => void;
  onQuickPickTiles: (tileIds: number[]) => void;
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
  autoMinePhase,
  autoMineProgress,
  chatOpen,
  formattedBalance,
  gridDisplayEpoch,
  gridSelectedTiles,
  handleAutoMineWithGuard,
  handleManualMineWithGuard,
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
  lowEthBalance,
  onClaim,
  onClaimAll,
  onQuickPickTiles,
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
        onQuickPickTiles={onQuickPickTiles}
        autoMinePhase={autoMinePhase}
        autoMineProgress={autoMineProgress}
        runningParams={runningParams}
        lowEthBalance={lowEthBalance}
        handleAutoMineWithGuard={handleAutoMineWithGuard}
      />
    </div>
  );
});
