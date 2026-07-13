"use client";

import React from "react";
import Image from "next/image";
import { formatEther, parseUnits } from "viem";
import { usePublicClient } from "wagmi";
import type { AutoMinePhase } from "../hooks/useMining.types";
import { useManualBetForm } from "../hooks/useManualBetForm";
import { cn } from "../lib/cn";
import { APP_CHAIN_ID, CONTRACT_ADDRESS, GAME_ABI } from "../lib/constants";
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
  readOnlyReason?: string | null;
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
  readOnlyReason = null,
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
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });
  const manualBetForm = useManualBetForm({
    formattedBalance,
    walletConnected,
    liveStateReady,
    readOnlyReason,
    selectedTilesCount,
    isPending,
    isRevealing,
    isAnalyzing,
    isAutoMining,
  });
  const [feeEstimate, setFeeEstimate] = React.useState<string | null>(null);
  const [feeEstimateUnavailable, setFeeEstimateUnavailable] = React.useState(false);
  const selectedTilesKey = gridSelectedTiles.join(",");

  React.useEffect(() => {
    if (!publicClient || !walletAddress || !walletConnected || !liveStateReady || gridSelectedTiles.length === 0) {
      setFeeEstimate(null);
      setFeeEstimateUnavailable(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const amount = parseUnits(manualBetForm.betAmount || "0", 18);
          if (amount <= 0n) throw new Error("Invalid bet amount");
          const tiles = [...new Set(gridSelectedTiles)].sort((a, b) => a - b);
          const request = tiles.length === 1
            ? { functionName: "placeBet" as const, args: [BigInt(tiles[0]), amount] as const }
            : {
                functionName: "placeBatchBetsBitmap" as const,
                args: [tiles.reduce((mask, tile) => mask | (1n << BigInt(tile - 1)), 0n), amount] as const,
              };
          const [gas, fees] = await Promise.all([
            publicClient.estimateContractGas({
              account: walletAddress as `0x${string}`,
              address: CONTRACT_ADDRESS,
              abi: GAME_ABI,
              ...request,
            }),
            publicClient.estimateFeesPerGas(),
          ]);
          const feePerGas = fees.maxFeePerGas ?? fees.gasPrice;
          if (!feePerGas) throw new Error("No fee quote");
          if (!cancelled) {
            setFeeEstimate(Number(formatEther(gas * feePerGas)).toFixed(6));
            setFeeEstimateUnavailable(false);
          }
        } catch {
          if (!cancelled) {
            setFeeEstimate(null);
            setFeeEstimateUnavailable(true);
          }
        }
      })();
    }, 600);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [liveStateReady, manualBetForm.betAmount, publicClient, selectedTilesKey, walletAddress, walletConnected]);

  return (
    <>
      <section
        aria-label="Mining game stage"
        className="gameplay-stage relative overflow-hidden rounded-[1.35rem] border border-violet-300/14 bg-[#05040b]/58 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_24px_80px_rgba(0,0,0,0.34)] backdrop-blur-md"
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
        {readOnlyReason && (
          <div
            data-testid="hub-read-only-banner"
            className="relative z-10 mb-1.5 rounded-xl border border-amber-300/24 bg-amber-400/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-amber-100"
          >
            {readOnlyReason}
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
            readOnlyReason={readOnlyReason}
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

      <MobileManualActionBar
        chatOpen={chatOpen}
        coldBootDefaults={coldBootDefaults}
        walletConnected={walletConnected}
        isAutoMining={isAutoMining}
        isPending={isPending}
        liveStateReady={liveStateReady}
        readOnlyReason={readOnlyReason}
        manualBetForm={manualBetForm}
        onMine={handleManualMineWithGuard}
        selectedTilesCount={selectedTilesCount}
        feeEstimate={feeEstimate}
        feeEstimateUnavailable={feeEstimateUnavailable}
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
  readOnlyReason,
  manualBetForm,
  onMine,
  selectedTilesCount,
  feeEstimate,
  feeEstimateUnavailable,
}: {
  chatOpen: boolean;
  coldBootDefaults: boolean;
  walletConnected: boolean;
  isAutoMining: boolean;
  isPending: boolean;
  liveStateReady: boolean;
  readOnlyReason?: string | null;
  manualBetForm: ReturnType<typeof useManualBetForm>;
  onMine: (betAmount: string) => Promise<void>;
  selectedTilesCount: number;
  feeEstimate: string | null;
  feeEstimateUnavailable: boolean;
}) {
  if (chatOpen || selectedTilesCount <= 0 || isAutoMining) return null;

  const requiresLogin = !walletConnected;
  const disabled = Boolean(readOnlyReason) || manualBetForm.isDisabled;
  const buttonLabel = isPending
    ? "Mining..."
    : readOnlyReason
      ? "Paused"
    : !liveStateReady && !coldBootDefaults
      ? "Syncing"
      : requiresLogin
        ? "Login"
        : "Mine";

  return (
    <div className="mobile-mine-action fixed left-2.5 right-12 z-[190] sm:right-[5.25rem] lg:hidden">
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
            disabled={Boolean(readOnlyReason) || isPending}
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
        {walletConnected && (
          <div className="col-span-4 px-1 pb-0.5 text-right text-[7px] font-bold uppercase tracking-[0.08em] text-slate-500">
            Bet fee: <span className="lore-nums text-sky-200">{feeEstimate ? `~${feeEstimate} ETH` : feeEstimateUnavailable ? "Unavailable" : "Calculating..."}</span>
          </div>
        )}
      </div>
    </div>
  );
}
