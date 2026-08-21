"use client";

import React from "react";
import Image from "next/image";
import { parseUnits } from "viem";
import { usePublicClient } from "wagmi";
import type { AutoMinePhase } from "../hooks/useMining.types";
import type { RewardScanVerificationState } from "../lib/types";
import { useManualBetForm } from "../hooks/useManualBetForm";
import {
  APP_CHAIN_ID,
  CONTRACT_ADDRESS,
  CONTRACT_REQUIRES_EPOCH_BOUND_BETS,
  GRID_SIZE,
  GAME_ABI,
} from "../lib/constants";
import {
  buildHubFeeEstimatePlan,
  collectHubFeeEstimate,
  getHubReadOnlyPresentation,
  HUB_FEE_ESTIMATE_DEBOUNCE_MS,
  normalizeHubFeeEstimateTiles,
} from "../lib/hubFeeEstimate";
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
  readOnlyReason?: string | null;
  chatOpen: boolean;
  formattedBalance: string | null;
  walletAuthenticated: boolean;
  walletConnected: boolean;
  embeddedWalletSyncing: boolean;
  onCreateEmbeddedWallet: () => Promise<void>;
  onOpenWalletSettings: () => void;
  formattedEthBalance: string | null;
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
  rewardScanState: RewardScanVerificationState;
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
  readOnlyReason = null,
  chatOpen,
  formattedBalance,
  walletAuthenticated,
  walletConnected,
  embeddedWalletSyncing,
  onCreateEmbeddedWallet,
  onOpenWalletSettings,
  formattedEthBalance,
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
  rewardScanState,
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
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });
  const readOnlyPresentation = getHubReadOnlyPresentation(readOnlyReason);
  const manualBetForm = useManualBetForm({
    formattedBalance,
    walletConnected,
    liveStateReady,
    readOnlyReason: readOnlyPresentation?.text ?? null,
    selectedTilesCount,
    isPending,
    isRevealing,
    isAutoMining,
  });
  const [feeEstimate, setFeeEstimate] = React.useState<string | null>(null);
  const [feeEstimateUnavailable, setFeeEstimateUnavailable] = React.useState(false);
  const selectedTilesKey = gridSelectedTiles.join(",");
  const selectedTilesForEstimate = React.useMemo(
    () => normalizeHubFeeEstimateTiles(selectedTilesKey, GRID_SIZE),
    [selectedTilesKey],
  );

  React.useEffect(() => {
    if (!publicClient || !walletAddress || !walletConnected || !liveStateReady || selectedTilesForEstimate.length === 0) {
      setFeeEstimate(null);
      setFeeEstimateUnavailable(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const amount = parseUnits(manualBetForm.betAmount || "0", 18);
          const estimatePlan = buildHubFeeEstimatePlan({
            requiresEpochBoundBets: CONTRACT_REQUIRES_EPOCH_BOUND_BETS,
            gridDisplayEpoch,
            selectedTiles: selectedTilesForEstimate,
            amount,
          });
          const nextFeeEstimate = await collectHubFeeEstimate({
            estimateGas: () => publicClient.estimateContractGas({
              account: walletAddress as `0x${string}`,
              address: CONTRACT_ADDRESS,
              abi: GAME_ABI,
              functionName: estimatePlan.functionName,
              args: estimatePlan.args,
            } as never),
            estimateFeesPerGas: () => publicClient.estimateFeesPerGas(),
          });
          if (!cancelled) {
            setFeeEstimate(nextFeeEstimate);
            setFeeEstimateUnavailable(false);
          }
        } catch {
          if (!cancelled) {
            setFeeEstimate(null);
            setFeeEstimateUnavailable(true);
          }
        }
      })();
    }, HUB_FEE_ESTIMATE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    gridDisplayEpoch,
    liveStateReady,
    manualBetForm.betAmount,
    publicClient,
    selectedTilesForEstimate,
    walletAddress,
    walletConnected,
  ]);

  return (
    <>
      <section
        aria-label="Mining game stage"
        className="gameplay-stage relative overflow-hidden rounded-[1.35rem] border border-violet-300/14 bg-[#05040b]/58 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_24px_80px_rgba(0,0,0,0.34)] min-[900px]:backdrop-blur-md"
      >
        <Image
          src="/jackpot-og-weekly-painted.png"
          alt=""
          fill
          priority
          sizes="100vw"
          quality={85}
          className="pointer-events-none object-cover"
          style={{ objectPosition: "center 42%" }}
          aria-hidden="true"
        />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(5,4,11,0.74),rgba(5,4,11,0.86))]" />
        {readOnlyPresentation && (
          <div
            data-testid={readOnlyPresentation.testId}
            className="relative z-10 mb-1.5 rounded-xl border border-amber-300/24 bg-amber-400/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-amber-100"
          >
            {readOnlyPresentation.text}
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_44%_22%,rgba(167,139,250,0.12),transparent_38%),radial-gradient(circle_at_82%_78%,rgba(34,211,238,0.08),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.04),transparent_32%)]" />
        <div className="relative z-10 grid grid-cols-1 gap-2 min-[900px]:grid-cols-12">
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
            walletAuthenticated={walletAuthenticated}
            walletConnected={walletConnected}
            embeddedWalletSyncing={embeddedWalletSyncing}
            onCreateEmbeddedWallet={onCreateEmbeddedWallet}
            onOpenWalletSettings={onOpenWalletSettings}
            formattedBalance={formattedBalance}
            formattedEthBalance={formattedEthBalance}
            lowEthBalance={lowEthBalance}
            isDailyJackpot={isDailyJackpot}
            isWeeklyJackpot={isWeeklyJackpot}
            jackpotAmount={jackpotAmount}
            jackpotFallbackAmount={jackpotFallbackAmount}
            dailyJackpotFallbackAmount={dailyJackpotFallbackAmount}
            weeklyJackpotFallbackAmount={weeklyJackpotFallbackAmount}
            hasMyWinningBet={hasMyWinningBet}
            unclaimedWins={unclaimedWins}
            rewardScanState={rewardScanState}
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
            walletAuthenticated={walletAuthenticated}
            walletConnected={walletConnected}
            embeddedWalletSyncing={embeddedWalletSyncing}
            onCreateEmbeddedWallet={onCreateEmbeddedWallet}
            liveStateReady={liveStateReady}
            readOnlyReason={readOnlyPresentation?.text ?? null}
            gridSelectedTiles={gridSelectedTiles}
            selectedTilesCount={selectedTilesCount}
            feeEstimate={feeEstimate}
            feeEstimateUnavailable={feeEstimateUnavailable}
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
    </>
  );
});
