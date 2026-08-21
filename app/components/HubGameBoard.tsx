"use client";

import React from "react";
import { isBackupConfirmedFor } from "./BackupGate";
import { hasConfirmedFirstBet } from "../hooks/useMiningGuards";
import { formatLineaWeiAmountDisplay } from "../lib/tokenAmountMath";
import { JackpotBanner } from "./JackpotBanner";
import { MiningGrid } from "./MiningGrid";
import { deriveWalletCta } from "./BetPanel";
import { requestWalletLogin } from "../lib/walletLoginRequest";
import { UiButton } from "./ui/UiButton";
import type { RewardScanVerificationState } from "../lib/types";

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
  walletAuthenticated: boolean;
  walletConnected: boolean;
  embeddedWalletSyncing: boolean;
  walletSetupCreating: boolean;
  walletSetupError: string | null;
  onCreateEmbeddedWallet: () => Promise<void>;
  onOpenWalletSettings: () => void;
  formattedBalance: string | null;
  formattedEthBalance: string | null;
  lowEthBalance: boolean;
  isDailyJackpot: boolean;
  isWeeklyJackpot: boolean;
  jackpotAmount?: number;
  jackpotFallbackAmount?: number;
  dailyJackpotFallbackAmount?: number;
  weeklyJackpotFallbackAmount?: number;
  hasMyWinningBet: boolean;
  unclaimedWins: UnclaimedWin[];
  rewardScanState: RewardScanVerificationState;
  isScanning: boolean;
  isDeepScanning: boolean;
  isClaiming: boolean;
  onScan: () => void;
  onClaim: (epochId: string) => void;
  onClaimAll: () => void;
}

export function getMobileRewardsWalletPresentation({
  walletAuthenticated,
  walletConnected,
  embeddedWalletSyncing,
  walletSetupCreating = false,
}: Pick<HubGameBoardProps, "walletAuthenticated" | "walletConnected" | "embeddedWalletSyncing"> & { walletSetupCreating?: boolean }) {
  const walletCta = deriveWalletCta({ walletAuthenticated, walletConnected, embeddedWalletSyncing, walletSetupCreating });
  return {
    walletCta,
    message: walletCta === "login"
      ? "Log in to check rewards for your wallet"
      : walletCta === "syncing"
        ? "Your LORE wallet is still loading"
        : walletCta === "creating"
          ? "Creating your LORE wallet"
          : walletCta === "create"
          ? "Create your LORE wallet to check rewards"
          : null,
  };
}

export function getCurrentWalletMobileRewards({
  walletAddress,
  rewardScanState,
  unclaimedWins,
}: {
  walletAddress?: string | null;
  rewardScanState: RewardScanVerificationState;
  unclaimedWins: UnclaimedWin[];
}) {
  const currentWalletAddress = walletAddress?.toLowerCase() ?? null;
  const hasCurrentWalletData = Boolean(
    currentWalletAddress
      && rewardScanState.walletAddress
      && rewardScanState.walletAddress.toLowerCase() === currentWalletAddress,
  );
  return {
    hasCurrentWalletData,
    unclaimedWins: hasCurrentWalletData ? unclaimedWins : [],
    rewardScanState: hasCurrentWalletData
      ? rewardScanState
      : {
          status: "idle" as const,
          walletAddress: currentWalletAddress,
          lastVerifiedAt: null,
          incomplete: false,
          error: null,
        },
  };
}
export function canClaimCurrentMobileRewards(walletCta: ReturnType<typeof getMobileRewardsWalletPresentation>["walletCta"], hasCurrentWalletData: boolean) {
  return walletCta === "ready" && hasCurrentWalletData;
}

export function getMobileRewardScanPresentation({
  rewardScanState,
  isScanning,
  isDeepScanning,
  hasVisibleWins,
}: {
  rewardScanState: RewardScanVerificationState;
  isScanning: boolean;
  isDeepScanning: boolean;
  hasVisibleWins: boolean;
}) {
  const scanInProgress = isScanning || isDeepScanning || rewardScanState.status === "loading" || rewardScanState.status === "refreshing";
  if (rewardScanState.incomplete) {
    return {
      message: rewardScanState.status === "stale" && rewardScanState.error
        ? "Refresh failed. Results may be partial."
        : "Reward scan was incomplete. Results may be partial.",
      canRetry: true,
      scanInProgress,
    };
  }
  if (scanInProgress) {
    return { message: "Checking on-chain rewards…", canRetry: true, scanInProgress };
  }
  if (rewardScanState.status === "idle") {
    return { message: "Rewards have not been checked yet.", canRetry: true, scanInProgress };
  }
  if (rewardScanState.status === "stale") {
    return {
      message: rewardScanState.error
        ? hasVisibleWins ? "Refresh failed. Showing last verified rewards." : "Refresh failed. Rewards need verification."
        : hasVisibleWins ? "Showing last verified rewards." : "Rewards need verification.",
      canRetry: true,
      scanInProgress,
    };
  }
  if (rewardScanState.status === "error") {
    return { message: "Reward scan failed.", canRetry: true, scanInProgress };
  }
  if (rewardScanState.status === "verified" && !hasVisibleWins) {
    return { message: "No claimable rewards found", canRetry: false, scanInProgress };
  }
  return { message: hasVisibleWins ? "Rewards verified." : "Rewards need verification.", canRetry: !hasVisibleWins, scanInProgress };
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
  walletAuthenticated,
  walletConnected,
  embeddedWalletSyncing,
  walletSetupCreating,
  walletSetupError,
  onCreateEmbeddedWallet,
  onOpenWalletSettings,
  formattedBalance,
  formattedEthBalance,
  lowEthBalance,
  isDailyJackpot,
  isWeeklyJackpot,
  jackpotAmount,
  jackpotFallbackAmount,
  dailyJackpotFallbackAmount,
  weeklyJackpotFallbackAmount,
  hasMyWinningBet,
  unclaimedWins,
  rewardScanState,
  isScanning,
  isDeepScanning,
  isClaiming,
  onScan,
  onClaim,
  onClaimAll,
}: HubGameBoardProps) {
  const currentWalletRewards = getCurrentWalletMobileRewards({ walletAddress, rewardScanState, unclaimedWins });
  const currentWalletUnclaimedWins = currentWalletRewards.unclaimedWins;
  const totalUnclaimedWei = currentWalletUnclaimedWins.reduce((total, win) => {
    try {
      return total + BigInt(win.amountWei);
    } catch {
      return total;
    }
  }, 0n);
  const rewardsWalletPresentation = getMobileRewardsWalletPresentation({
    walletAuthenticated,
    walletConnected,
    embeddedWalletSyncing,
    walletSetupCreating,
  });
  const { walletCta: rewardsWalletCta } = rewardsWalletPresentation;
  const canClaimCurrentRewards = canClaimCurrentMobileRewards(rewardsWalletCta, currentWalletRewards.hasCurrentWalletData);
  const rewardSummary = currentWalletUnclaimedWins.length > 0
    ? `${formatLineaWeiAmountDisplay(totalUnclaimedWei)} LINEA across ${currentWalletUnclaimedWins.length} epoch${currentWalletUnclaimedWins.length === 1 ? "" : "s"}`
    : null;
  const rewardScanPresentation = getMobileRewardScanPresentation({
    rewardScanState: currentWalletRewards.rewardScanState,
    isScanning,
    isDeepScanning,
    hasVisibleWins: currentWalletUnclaimedWins.length > 0,
  });
  const mobileRewardsMessage = walletSetupError
    ?? rewardsWalletPresentation.message
    ?? (rewardSummary
      ? `${rewardScanPresentation.message} ${rewardSummary}`
      : rewardScanPresentation.message);
  const shouldShowRewardScanAction = rewardsWalletCta === "ready"
    && Boolean(walletAddress)
    && (currentWalletUnclaimedWins.length === 0 || rewardScanPresentation.canRetry);
  const onboarding = getOnboardingState({ walletAddress, walletConnected, formattedBalance, formattedEthBalance, lowEthBalance });
  const onboardingComplete = Object.values(onboarding).every(Boolean);
  const onboardingAction = getOnboardingNextAction({ onboarding, walletCta: rewardsWalletCta });
  const nextOnboardingIndex = Object.values(onboarding).findIndex((complete) => !complete);
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
            <OnboardingStep complete={onboarding.wallet} current={nextOnboardingIndex === 0} label="Create wallet" detail={onboarding.wallet ? "Ready" : "Log in to create your LORE wallet"} />
            <OnboardingStep complete={onboarding.backup} current={nextOnboardingIndex === 1} label="Back up key" detail={onboarding.backup ? "Saved" : "Export the private key before funding"} />
            <OnboardingStep complete={onboarding.eth} current={nextOnboardingIndex === 2} label="Add ETH" detail={onboarding.eth ? "Gas ready" : !hasKnownFormattedBalance(formattedEthBalance) ? "ETH balance unavailable — check Wallet Settings" : "Fund ETH for gas"} />
            <OnboardingStep complete={onboarding.linea} current={nextOnboardingIndex === 3} label="Add LINEA" detail={onboarding.linea ? "Balance detected" : "Fund LINEA for a stake"} />
            <OnboardingStep complete={onboarding.firstBet} current={nextOnboardingIndex === 4} label="First bet" detail={onboarding.firstBet ? "Confirmed on-chain" : "Choose tiles and confirm a bet"} />
          </ol>
          {onboardingAction && (
            <UiButton
              onClick={() => {
                if (onboardingAction.kind === "login") {
                  requestWalletLogin();
                } else if (onboardingAction.kind === "create") {
                  void onCreateEmbeddedWallet();
                } else if (onboardingAction.kind === "settings") {
                  onOpenWalletSettings();
                } else {
                  document.getElementById("bet-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
                }
              }}
              variant="primary"
              size="sm"
              className="mt-3 min-h-11 px-3"
            >
              {onboardingAction.label}
            </UiButton>
          )}
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
              {mobileRewardsMessage}
            </p>
          </div>
          {rewardsWalletCta === "login" ? (
            <UiButton onClick={requestWalletLogin} variant="primary" size="sm" className="min-h-11 shrink-0 px-3">
              Log in
            </UiButton>
          ) : rewardsWalletCta === "create" ? (
            <UiButton onClick={onCreateEmbeddedWallet} variant="primary" size="sm" className="min-h-11 shrink-0 px-3">
              Create wallet
            </UiButton>
          ) : canClaimCurrentRewards && currentWalletUnclaimedWins.length > 1 && (
            <UiButton onClick={onClaimAll} disabled={isClaiming} loading={isClaiming} variant="warning" size="sm" className="min-h-11 shrink-0 px-3">
              Claim all
            </UiButton>
          )}
        </div>
        {canClaimCurrentRewards && currentWalletUnclaimedWins.length === 1 && (
          <UiButton onClick={() => onClaim(currentWalletUnclaimedWins[0]!.epoch)} disabled={isClaiming} loading={isClaiming} variant="warning" size="sm" fullWidth className="mt-3 min-h-11">
            Claim reward
          </UiButton>
        )}
        {shouldShowRewardScanAction && (
          <UiButton
            onClick={onScan}
            disabled={rewardScanPresentation.scanInProgress}
            variant="ghost"
            size="sm"
            fullWidth
            className="mt-3 min-h-11"
          >
            {rewardScanPresentation.scanInProgress ? "Checking rewards" : rewardScanPresentation.canRetry ? "Retry rewards" : "Check rewards"}
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
  formattedEthBalance,
  lowEthBalance,
}: Pick<HubGameBoardProps, "walletAddress" | "walletConnected" | "formattedBalance" | "formattedEthBalance" | "lowEthBalance">) {
  return {
    wallet: Boolean(walletAddress && walletConnected),
    backup: Boolean(walletAddress && isBackupConfirmedFor(walletAddress)),
    eth: Boolean(walletAddress && hasKnownFormattedBalance(formattedEthBalance) && !lowEthBalance),
    linea: Boolean(walletAddress && hasPositiveFormattedBalance(formattedBalance)),
    firstBet: hasConfirmedFirstBet(walletAddress),
  };
}

function hasKnownFormattedBalance(value: string | null): boolean {
  return Boolean(value && /^\d+(?:\.\d+)?$/.test(value.trim()));
}

function hasPositiveFormattedBalance(value: string | null): boolean {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value.trim())) return false;
  return /[1-9]/.test(value.replace(".", ""));
}

export function getOnboardingNextAction({
  onboarding,
  walletCta,
}: {
  onboarding: ReturnType<typeof getOnboardingState>;
  walletCta: ReturnType<typeof deriveWalletCta>;
}): { kind: "login" | "create" | "settings" | "bet"; label: string } | null {
  if (!onboarding.wallet) {
    if (walletCta === "login") return { kind: "login", label: "Log in to continue" };
    if (walletCta === "create") return { kind: "create", label: "Create wallet" };
    return null;
  }
  if (!onboarding.backup || !onboarding.eth || !onboarding.linea) {
    return { kind: "settings", label: "Open Wallet Settings" };
  }
  if (!onboarding.firstBet) return { kind: "bet", label: "Choose tiles and bet" };
  return null;
}

function OnboardingStep({ complete, current, label, detail }: { complete: boolean; current: boolean; label: string; detail: string }) {
  return (
    <li className={`rounded-lg border px-3 py-2 ${complete ? "border-emerald-300/24 bg-emerald-400/8" : "border-white/8 bg-black/14"}`}>
      <div className={`text-xs font-black uppercase tracking-[0.1em] ${complete ? "text-emerald-200" : "text-slate-100"}`}>
        {complete ? "Done" : current ? "Next" : "To do"} · {label}
      </div>
      <p className="mt-1 text-xs leading-snug text-slate-300">{detail}</p>
    </li>
  );
}
