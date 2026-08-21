"use client";

import React from "react";
import { isBackupConfirmedFor } from "./BackupGate";
import { hasConfirmedFirstBet } from "../hooks/useMiningGuards";
import { formatLineaWeiAmountDisplay } from "../lib/tokenAmountMath";
import { JackpotBanner } from "./JackpotBanner";
import { MiningGrid } from "./MiningGrid";
import { UiButton } from "./ui/UiButton";

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
  walletConnected: boolean;
  formattedBalance: string | null;
  lowEthBalance: boolean;
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
  walletConnected,
  formattedBalance,
  lowEthBalance,
  isDailyJackpot,
  isWeeklyJackpot,
  jackpotAmount,
  jackpotFallbackAmount,
  dailyJackpotFallbackAmount,
  weeklyJackpotFallbackAmount,
  hasMyWinningBet,
  unclaimedWins,
  isScanning,
  isDeepScanning,
  isClaiming,
  onScan,
  onClaim,
  onClaimAll,
}: HubGameBoardProps) {
  const totalUnclaimedWei = unclaimedWins.reduce((total, win) => {
    try {
      return total + BigInt(win.amountWei);
    } catch {
      return total;
    }
  }, 0n);
  const onboarding = getOnboardingState({ walletAddress, walletConnected, formattedBalance, lowEthBalance });
  const onboardingComplete = Object.values(onboarding).every(Boolean);
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

      {!onboardingComplete && (
        <section aria-label="Getting started checklist" className="rounded-xl border border-sky-300/22 bg-sky-400/7 p-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-black uppercase tracking-[0.12em] text-sky-100">Getting started</h2>
            <span className="text-xs font-semibold text-sky-200/80">
              {Object.values(onboarding).filter(Boolean).length}/5 complete
            </span>
          </div>
          <ol className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5">
            <OnboardingStep complete={onboarding.wallet} label="Create wallet" detail={onboarding.wallet ? "Ready" : "Log in to create your LORE wallet"} />
            <OnboardingStep complete={onboarding.backup} label="Back up key" detail={onboarding.backup ? "Saved" : "Export the private key before funding"} />
            <OnboardingStep complete={onboarding.eth} label="Add ETH" detail={onboarding.eth ? "Gas ready" : "Fund ETH for gas"} />
            <OnboardingStep complete={onboarding.linea} label="Add LINEA" detail={onboarding.linea ? "Balance detected" : "Fund LINEA for a stake"} />
            <OnboardingStep complete={onboarding.firstBet} label="First bet" detail={onboarding.firstBet ? "Confirmed on-chain" : "Choose tiles and confirm a bet"} />
          </ol>
        </section>
      )}

      <section
        aria-label="Unclaimed rewards"
        className="min-[900px]:hidden rounded-xl border border-amber-400/24 bg-amber-500/8 p-3"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.12em] text-amber-200">Unclaimed rewards</p>
            <p className="mt-1 text-sm font-bold text-white">
              {isScanning || isDeepScanning
                ? "Checking on-chain rewards…"
                : unclaimedWins.length > 0
                  ? `${formatLineaWeiAmountDisplay(totalUnclaimedWei)} LINEA across ${unclaimedWins.length} epoch${unclaimedWins.length === 1 ? "" : "s"}`
                  : "No claimable rewards found"}
            </p>
          </div>
          {unclaimedWins.length > 1 && (
            <UiButton onClick={onClaimAll} disabled={isClaiming} loading={isClaiming} variant="warning" size="sm" className="min-h-11 shrink-0 px-3">
              Claim all
            </UiButton>
          )}
        </div>
        {unclaimedWins.length === 1 && (
          <UiButton onClick={() => onClaim(unclaimedWins[0]!.epoch)} disabled={isClaiming} loading={isClaiming} variant="warning" size="sm" fullWidth className="mt-3 min-h-11">
            Claim reward
          </UiButton>
        )}
        {!isScanning && !isDeepScanning && unclaimedWins.length === 0 && walletAddress && (
          <UiButton onClick={onScan} variant="ghost" size="sm" fullWidth className="mt-3 min-h-11">
            Check rewards
          </UiButton>
        )}
      </section>
    </div>
  );
});

export function getOnboardingState({
  walletAddress,
  walletConnected,
  formattedBalance,
  lowEthBalance,
}: Pick<HubGameBoardProps, "walletAddress" | "walletConnected" | "formattedBalance" | "lowEthBalance">) {
  return {
    wallet: Boolean(walletAddress && walletConnected),
    backup: Boolean(walletAddress && isBackupConfirmedFor(walletAddress)),
    eth: Boolean(walletAddress && !lowEthBalance),
    linea: hasPositiveFormattedBalance(formattedBalance),
    firstBet: hasConfirmedFirstBet(),
  };
}

function hasPositiveFormattedBalance(value: string | null): boolean {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value.trim())) return false;
  return /[1-9]/.test(value.replace(".", ""));
}

function OnboardingStep({ complete, label, detail }: { complete: boolean; label: string; detail: string }) {
  return (
    <li className={`rounded-lg border px-3 py-2 ${complete ? "border-emerald-300/24 bg-emerald-400/8" : "border-white/8 bg-black/14"}`}>
      <div className={`text-xs font-black uppercase tracking-[0.1em] ${complete ? "text-emerald-200" : "text-slate-100"}`}>
        {complete ? "Done" : "Next"} · {label}
      </div>
      <p className="mt-1 text-xs leading-snug text-slate-300">{detail}</p>
    </li>
  );
}
