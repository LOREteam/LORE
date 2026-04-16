"use client";

import React from "react";
import type { AutoMinePhase } from "../hooks/useMining.types";
import { AutoMinerPanel, ManualBetPanel } from "./BetPanel";

interface LastBet {
  tiles: number[];
  amount: string;
}

interface RunningParams {
  betStr: string;
  blocks: number;
  rounds: number;
}

interface HubSidePanelProps {
  chatOpen: boolean;
  coldBootDefaults: boolean;
  formattedBalance: string | null;
  liveStateReady: boolean;
  selectedTilesCount: number;
  isPending: boolean;
  isRevealing: boolean;
  isAnalyzing: boolean;
  isAutoMining: boolean;
  handleManualMineWithGuard: (betAmountStr: string) => Promise<void>;
  lastBet: LastBet | null;
  handleRepeatLastBet: () => Promise<void>;
  autoMinePhase: AutoMinePhase;
  autoMineProgress: string | null;
  runningParams: RunningParams | null;
  lowEthBalance: boolean;
  handleAutoMineWithGuard: (betStr: string, blocks: number, rounds: number) => Promise<void>;
}

export const HubSidePanel = React.memo(function HubSidePanel({
  chatOpen,
  coldBootDefaults,
  formattedBalance,
  liveStateReady,
  selectedTilesCount,
  isPending,
  isRevealing,
  isAnalyzing,
  isAutoMining,
  handleManualMineWithGuard,
  lastBet,
  handleRepeatLastBet,
  autoMinePhase,
  autoMineProgress,
  runningParams,
  lowEthBalance,
  handleAutoMineWithGuard,
}: HubSidePanelProps) {
  return (
    <div className="min-[900px]:col-span-3 min-w-0 flex flex-col gap-1.5">
      {chatOpen ? (
        <div id="chat-panel-slot" className="min-h-[35.25rem] flex-1" />
      ) : (
        <>
          <ManualBetPanel
            coldBootDefaults={coldBootDefaults}
            formattedBalance={formattedBalance}
            liveStateReady={liveStateReady}
            selectedTilesCount={selectedTilesCount}
            isPending={isPending}
            isRevealing={isRevealing}
            isAnalyzing={isAnalyzing}
            isAutoMining={isAutoMining}
            onMine={handleManualMineWithGuard}
            lastBet={lastBet}
            onRepeatBet={handleRepeatLastBet}
          />

          <AutoMinerPanel
            coldBootDefaults={coldBootDefaults}
            isAutoMining={isAutoMining}
            isPending={isPending}
            isRevealing={isRevealing}
            isAnalyzing={isAnalyzing}
            liveStateReady={liveStateReady}
            autoMinePhase={autoMinePhase}
            autoMineProgress={autoMineProgress}
            formattedBalance={formattedBalance}
            runningParams={runningParams}
            lowEthForGas={lowEthBalance}
            onToggle={handleAutoMineWithGuard}
          />
        </>
      )}
    </div>
  );
});
