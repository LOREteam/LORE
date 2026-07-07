"use client";

import React from "react";
import type { AutoMinePhase } from "../hooks/useMining.types";
import type { ManualBetFormState } from "../hooks/useManualBetForm";
import { AutoMinerPanel, ManualBetPanel } from "./BetPanel";

interface RunningParams {
  betStr: string;
  blocks: number;
  rounds: number;
}

interface HubSidePanelProps {
  chatOpen: boolean;
  coldBootDefaults: boolean;
  formattedBalance: string | null;
  walletConnected: boolean;
  liveStateReady: boolean;
  readOnlyReason?: string | null;
  selectedTilesCount: number;
  isPending: boolean;
  isRevealing: boolean;
  isAnalyzing: boolean;
  isAutoMining: boolean;
  manualBetForm: ManualBetFormState;
  handleManualMineWithGuard: (betAmountStr: string) => Promise<void>;
  onQuickPickTiles: (tileIds: number[]) => void;
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
  walletConnected,
  liveStateReady,
  readOnlyReason = null,
  selectedTilesCount,
  isPending,
  isRevealing,
  isAnalyzing,
  isAutoMining,
  manualBetForm,
  handleManualMineWithGuard,
  onQuickPickTiles,
  autoMinePhase,
  autoMineProgress,
  runningParams,
  lowEthBalance,
  handleAutoMineWithGuard,
}: HubSidePanelProps) {
  return (
    <div className="gameplay-action-rail min-[900px]:col-span-3 min-w-0 flex flex-col gap-1.5">
      {chatOpen ? (
        <div id="chat-panel-slot" className="min-h-141 flex-1" />
      ) : (
        <>
          <div className={selectedTilesCount > 0 ? "hidden min-[900px]:block" : undefined}>
            <ManualBetPanel
              coldBootDefaults={coldBootDefaults}
              formattedBalance={formattedBalance}
              walletConnected={walletConnected}
              liveStateReady={liveStateReady}
              readOnlyReason={readOnlyReason}
              selectedTilesCount={selectedTilesCount}
              isPending={isPending}
              isRevealing={isRevealing}
              isAnalyzing={isAnalyzing}
              isAutoMining={isAutoMining}
              manualBetForm={manualBetForm}
              onMine={handleManualMineWithGuard}
              onQuickPickTiles={onQuickPickTiles}
            />
          </div>

          <AutoMinerPanel
            coldBootDefaults={coldBootDefaults}
            isAutoMining={isAutoMining}
            isPending={isPending}
            isRevealing={isRevealing}
            isAnalyzing={isAnalyzing}
            liveStateReady={liveStateReady}
            readOnlyReason={readOnlyReason}
            autoMinePhase={autoMinePhase}
            autoMineProgress={autoMineProgress}
            formattedBalance={formattedBalance}
            walletConnected={walletConnected}
            runningParams={runningParams}
            lowEthForGas={lowEthBalance}
            onToggle={handleAutoMineWithGuard}
          />
        </>
      )}
    </div>
  );
});
