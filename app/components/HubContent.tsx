"use client";

import React from "react";
import type { AutoMinePhase } from "../hooks/useMining.types";
import { useManualBetForm } from "../hooks/useManualBetForm";
import { cn } from "../lib/cn";
import { HubGameBoard } from "./HubGameBoard";
import { HubSidePanel } from "./HubSidePanel";
import { UiButton } from "./ui/UiButton";

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
  walletConnected: boolean;
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
  jackpotFallbackAmount?: number;
  dailyJackpotFallbackAmount?: number;
  weeklyJackpotFallbackAmount?: number;
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
  walletConnected,
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
  jackpotFallbackAmount,
  dailyJackpotFallbackAmount,
  weeklyJackpotFallbackAmount,
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
  const manualBetForm = useManualBetForm({
    formattedBalance,
    walletConnected,
    liveStateReady,
    selectedTilesCount,
    isPending,
    isRevealing,
    isAnalyzing,
    isAutoMining,
  });

  return (
    <>
      <section
        aria-label="Mining game stage"
        className="gameplay-stage relative overflow-hidden rounded-[1.35rem] border border-violet-300/14 bg-[#05040b]/58 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_24px_80px_rgba(0,0,0,0.34)] backdrop-blur-md"
        style={{
          backgroundImage:
            "linear-gradient(180deg, rgba(5,4,11,0.74), rgba(5,4,11,0.86)), url('/jackpot-og-weekly-painted.png')",
          backgroundPosition: "center 42%",
          backgroundSize: "cover",
        }}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_44%_22%,rgba(167,139,250,0.12),transparent_38%),radial-gradient(circle_at_82%_78%,rgba(34,211,238,0.08),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.04),transparent_32%)]" />
        <div className="relative grid grid-cols-1 gap-2 min-[900px]:grid-cols-12">
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
            jackpotFallbackAmount={jackpotFallbackAmount}
            dailyJackpotFallbackAmount={dailyJackpotFallbackAmount}
            weeklyJackpotFallbackAmount={weeklyJackpotFallbackAmount}
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
            walletConnected={walletConnected}
            liveStateReady={liveStateReady}
            selectedTilesCount={selectedTilesCount}
            isPending={isPending}
            isRevealing={isRevealing}
            isAnalyzing={isAnalyzing}
            isAutoMining={isAutoMining}
            manualBetForm={manualBetForm}
            handleManualMineWithGuard={handleManualMineWithGuard}
            onQuickPickTiles={onQuickPickTiles}
            autoMinePhase={autoMinePhase}
            autoMineProgress={autoMineProgress}
            runningParams={runningParams}
            lowEthBalance={lowEthBalance}
            handleAutoMineWithGuard={handleAutoMineWithGuard}
          />
        </div>
      </section>

      <MobileManualActionBar
        chatOpen={chatOpen}
        coldBootDefaults={coldBootDefaults}
        walletConnected={walletConnected}
        isAutoMining={isAutoMining}
        isPending={isPending}
        liveStateReady={liveStateReady}
        manualBetForm={manualBetForm}
        onMine={handleManualMineWithGuard}
        selectedTilesCount={selectedTilesCount}
      />
      {selectedTilesCount > 0 && !isAutoMining && !chatOpen && <div className="h-18 lg:hidden" aria-hidden="true" />}
    </>
  );
});

function MobileManualActionBar({
  chatOpen,
  coldBootDefaults,
  walletConnected,
  isAutoMining,
  isPending,
  liveStateReady,
  manualBetForm,
  onMine,
  selectedTilesCount,
}: {
  chatOpen: boolean;
  coldBootDefaults: boolean;
  walletConnected: boolean;
  isAutoMining: boolean;
  isPending: boolean;
  liveStateReady: boolean;
  manualBetForm: ReturnType<typeof useManualBetForm>;
  onMine: (betAmount: string) => Promise<void>;
  selectedTilesCount: number;
}) {
  if (chatOpen || selectedTilesCount <= 0 || isAutoMining) return null;

  const requiresLogin = !walletConnected;
  const disabled = manualBetForm.isDisabled;
  const buttonLabel = isPending
    ? "Mining..."
    : !liveStateReady && !coldBootDefaults
      ? "Syncing"
      : requiresLogin
        ? "Login"
        : "Mine";

  return (
    <div className="mobile-mine-action fixed left-2.5 right-12 z-[190] lg:hidden">
      <div className="grid grid-cols-[auto_minmax(3.5rem,1fr)_minmax(4rem,0.8fr)_auto] items-center gap-1 rounded-xl border border-emerald-300/14 bg-[#070711]/94 p-1 shadow-[0_10px_24px_rgba(2,6,23,0.38)] backdrop-blur-xl sm:gap-1.5 sm:p-1.5">
        <div className="rounded-lg border border-emerald-300/10 bg-emerald-400/6 px-1.5 py-0.75 sm:px-2">
          <div className="text-[7px] font-black uppercase leading-none tracking-[0.12em] text-slate-500">Tiles</div>
          <div className="lore-hud-number mt-0.5 text-sm font-black leading-none text-emerald-200">{selectedTilesCount}</div>
        </div>

        <label className="min-w-0">
          <span className="sr-only">Amount per tile</span>
          <input
            type="text"
            inputMode="decimal"
            value={manualBetForm.betAmount}
            onChange={(event) => manualBetForm.setBetAmount(event.target.value.slice(0, 20))}
            disabled={isPending}
            maxLength={20}
          className={cn(
            "h-8 w-full rounded-lg border bg-black/34 px-2 text-sm font-black text-white outline-none transition focus:border-emerald-300/45 focus:ring-2 focus:ring-emerald-300/16 sm:h-9",
            manualBetForm.betAmountError ? "border-red-400/35" : "border-white/8",
          )}
          />
        </label>

        <div className="min-w-0 rounded-lg border border-violet-300/10 bg-violet-400/6 px-1.5 py-0.75 text-right sm:px-2">
          <div className="text-[7px] font-black uppercase leading-none tracking-[0.12em] text-slate-500">Total</div>
          <div className={cn(
            "lore-hud-number mt-0.5 truncate text-sm font-black leading-none",
            manualBetForm.manualInsufficient ? "text-red-300" : "text-violet-200",
          )}>
            {manualBetForm.totalBet.toFixed(2)}
          </div>
        </div>

        <UiButton
          onClick={() => onMine(manualBetForm.betAmount)}
          disabled={disabled}
          variant={disabled ? "locked" : "primary"}
          size="sm"
          uppercase
          className={cn(
            "h-8 min-w-14 rounded-lg px-2 text-[9px] sm:h-9 sm:min-w-19 sm:px-3 sm:text-[10px]",
            !disabled && "border-emerald-300/30 bg-linear-to-r from-emerald-500 to-sky-500 text-[#03110d] shadow-lg shadow-emerald-500/16",
          )}
        >
          {buttonLabel}
        </UiButton>
      </div>
    </div>
  );
}
