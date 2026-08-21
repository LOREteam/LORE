"use client";

import React from "react";
import { formatUnits, parseUnits } from "viem";
import type { AutoMinePhase } from "../hooks/useMining.types";
import type { ManualBetFormState } from "../hooks/useManualBetForm";
import { useAutoMinerForm } from "../hooks/useAutoMinerForm";
import { GRID_SIZE } from "../lib/constants";
import { getHubFeeEstimateLabel } from "../lib/hubFeeEstimate";
import { normalizeDecimalInput, validateBetAmount } from "../lib/utils";
import { cn } from "../lib/cn";
import { requestWalletLogin } from "../lib/walletLoginRequest";
import {
  AutoMinerPanel,
  ManualBetPanel,
  deriveAutoMinerAction,
  deriveManualMiningAction,
  deriveWalletCta,
  type AutoMinerFormState,
} from "./BetPanel";
import { UiButton } from "./ui/UiButton";

interface RunningParams {
  betStr: string;
  blocks: number;
  rounds: number;
}

export async function runWalletSetupAttempt(onCreateEmbeddedWallet: () => void): Promise<"complete" | "failed"> {
  try {
    await Promise.resolve(onCreateEmbeddedWallet());
    return "complete";
  } catch {
    return "failed";
  }
}

const WALLET_SETUP_ERROR = "Wallet creation could not be completed. Please try again.";

interface HubSidePanelProps {
  chatOpen: boolean;
  coldBootDefaults: boolean;
  formattedBalance: string | null;
  walletAuthenticated: boolean;
  walletConnected: boolean;
  embeddedWalletSyncing: boolean;
  onCreateEmbeddedWallet: () => void;
  liveStateReady: boolean;
  readOnlyReason?: string | null;
  gridSelectedTiles: number[];
  selectedTilesCount: number;
  feeEstimate: string | null;
  feeEstimateUnavailable: boolean;
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
  walletAuthenticated,
  walletConnected,
  embeddedWalletSyncing,
  onCreateEmbeddedWallet,
  liveStateReady,
  readOnlyReason = null,
  gridSelectedTiles,
  selectedTilesCount,
  feeEstimate,
  feeEstimateUnavailable,
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
  const autoMinerForm = useAutoMinerForm({
    isAutoMining,
    isPending,
    isRevealing,
    isAnalyzing,
    liveStateReady,
    readOnlyReason,
    formattedBalance,
    walletConnected,
    runningParams,
    lowEthForGas: lowEthBalance,
  });
  const actionInFlightRef = React.useRef(false);
  const [walletSetupState, setWalletSetupState] = React.useState<"idle" | "creating" | "error">("idle");
  const walletSetupCreating = walletSetupState === "creating";
  const walletSetupError = walletSetupState === "error" ? WALLET_SETUP_ERROR : null;
  React.useEffect(() => {
    if (walletConnected || embeddedWalletSyncing) setWalletSetupState("idle");
  }, [embeddedWalletSyncing, walletConnected]);
  const handleManualAction = React.useCallback(async (betAmount: string) => {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    try {
      await handleManualMineWithGuard(betAmount);
    } finally {
      actionInFlightRef.current = false;
    }
  }, [handleManualMineWithGuard]);
  const handleAutoAction = React.useCallback(async (betSize: string, targets: number, cycles: number) => {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    try {
      await handleAutoMineWithGuard(betSize, targets, cycles);
    } finally {
      actionInFlightRef.current = false;
    }
  }, [handleAutoMineWithGuard]);
  const handleWalletSetup = React.useCallback(() => {
    if (actionInFlightRef.current || walletSetupCreating) return;
    actionInFlightRef.current = true;
    setWalletSetupState("creating");
    void runWalletSetupAttempt(onCreateEmbeddedWallet).then((result) => {
      if (result === "failed") setWalletSetupState("error");
      actionInFlightRef.current = false;
    });
  }, [onCreateEmbeddedWallet, walletSetupCreating]);

  return (
    <>
      <div className="gameplay-action-rail min-[900px]:col-span-3 min-w-0 flex flex-col gap-1.5">
        {chatOpen ? (
          <div id="chat-panel-slot" className="min-h-141 flex-1" />
        ) : (
          <>
            <div className={selectedTilesCount > 0 ? "hidden min-[900px]:block" : undefined}>
              <ManualBetPanel
                coldBootDefaults={coldBootDefaults}
                formattedBalance={formattedBalance}
                walletAuthenticated={walletAuthenticated}
                walletConnected={walletConnected}
                embeddedWalletSyncing={embeddedWalletSyncing}
                walletSetupCreating={walletSetupCreating}
                liveStateReady={liveStateReady}
                readOnlyReason={readOnlyReason}
                selectedTilesCount={selectedTilesCount}
                feeEstimate={feeEstimate}
                feeEstimateUnavailable={feeEstimateUnavailable}
                isPending={isPending}
                isRevealing={isRevealing}
                isAutoMining={isAutoMining}
                mobileActionDocked
                manualBetForm={manualBetForm}
                onMine={handleManualAction}
                onQuickPickTiles={onQuickPickTiles}
                onWalletSetup={handleWalletSetup}
              />
            </div>

            <AutoMinerPanel
              form={autoMinerForm}
              coldBootDefaults={coldBootDefaults}
              isAutoMining={isAutoMining}
              isPending={isPending}
              isRevealing={isRevealing}
              liveStateReady={liveStateReady}
              readOnlyReason={readOnlyReason}
              autoMinePhase={autoMinePhase}
              autoMineProgress={autoMineProgress}
              walletAuthenticated={walletAuthenticated}
              walletConnected={walletConnected}
              embeddedWalletSyncing={embeddedWalletSyncing}
              walletSetupCreating={walletSetupCreating}
              lowEthForGas={lowEthBalance}
              mobileActionDocked
              onToggle={handleAutoAction}
              onWalletSetup={handleWalletSetup}
            />

            {walletSetupError && (
              <p role="alert" className="hidden min-[900px]:block px-1 text-center text-[10px] font-semibold text-red-300">
                {walletSetupError}
              </p>
            )}

            <div className="h-[8.5rem] min-[900px]:hidden" aria-hidden="true" />
          </>
        )}
      </div>

      <MobileMiningActionBar
        autoMinePhase={autoMinePhase}
        autoMinerForm={autoMinerForm}
        chatOpen={chatOpen}
        coldBootDefaults={coldBootDefaults}
        feeEstimate={feeEstimate}
        feeEstimateUnavailable={feeEstimateUnavailable}
        gridSelectedTiles={gridSelectedTiles}
        isAutoMining={isAutoMining}
        isPending={isPending}
        isRevealing={isRevealing}
        liveStateReady={liveStateReady}
        lowEthBalance={lowEthBalance}
        manualBetForm={manualBetForm}
        onAutoAction={handleAutoAction}
        onManualAction={handleManualAction}
        readOnlyReason={readOnlyReason}
        selectedTilesCount={selectedTilesCount}
        walletAuthenticated={walletAuthenticated}
        walletConnected={walletConnected}
        embeddedWalletSyncing={embeddedWalletSyncing}
        walletSetupCreating={walletSetupCreating}
        walletSetupError={walletSetupError}
        onWalletSetup={handleWalletSetup}
      />
    </>
  );
});

export function formatExactMobileBetTotal(rawAmount: string, selectedTilesCount: number): string | null {
  if (!Number.isSafeInteger(selectedTilesCount) || selectedTilesCount < 0 || selectedTilesCount > GRID_SIZE) return null;
  const normalized = normalizeDecimalInput(rawAmount.trim());
  if (validateBetAmount(normalized) !== null) return null;
  try {
    const totalWei = parseUnits(normalized, 18) * BigInt(selectedTilesCount);
    return formatUnits(totalWei, 18);
  } catch {
    return null;
  }
}

export function summarizeMobileTileSelection(rawTileIds: readonly number[]): {
  compactLabel: string;
  count: number;
  fullLabel: string;
} {
  const tileIds = [...new Set(rawTileIds)]
    .filter((tileId) => Number.isSafeInteger(tileId) && tileId >= 1 && tileId <= GRID_SIZE)
    .sort((left, right) => left - right);
  if (tileIds.length === 0) {
    return {
      compactLabel: "Tap tiles to select",
      count: 0,
      fullLabel: "No tiles selected",
    };
  }
  const visibleTileIds = tileIds.slice(0, 4);
  const hiddenCount = tileIds.length - visibleTileIds.length;
  return {
    compactLabel: `${visibleTileIds.map((tileId) => `#${tileId}`).join(", ")}${hiddenCount > 0 ? ` +${hiddenCount}` : ""}`,
    count: tileIds.length,
    fullLabel: `Selected tiles ${tileIds.join(", ")}`,
  };
}

function useVisualViewportKeyboardInset(): number {
  const [keyboardInset, setKeyboardInset] = React.useState(0);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const visualViewport = window.visualViewport;
    if (!visualViewport) return;

    let frameId = 0;
    const measure = () => {
      const activeElement = document.activeElement;
      const textEntryFocused = activeElement instanceof HTMLInputElement
        || activeElement instanceof HTMLTextAreaElement
        || (activeElement instanceof HTMLElement && activeElement.isContentEditable);
      const occludedBottom = Math.max(0, window.innerHeight - visualViewport.height - visualViewport.offsetTop);
      const keyboardOpen = window.innerWidth < 900 && textEntryFocused && occludedBottom >= 80;
      setKeyboardInset(keyboardOpen ? Math.round(occludedBottom) : 0);
    };
    const scheduleMeasure = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(measure);
    };

    measure();
    visualViewport.addEventListener("resize", scheduleMeasure);
    visualViewport.addEventListener("scroll", scheduleMeasure);
    window.addEventListener("focusin", scheduleMeasure);
    window.addEventListener("focusout", scheduleMeasure);
    return () => {
      window.cancelAnimationFrame(frameId);
      visualViewport.removeEventListener("resize", scheduleMeasure);
      visualViewport.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("focusin", scheduleMeasure);
      window.removeEventListener("focusout", scheduleMeasure);
    };
  }, []);

  return keyboardInset;
}

function compactManualActionLabel(label: string): string {
  if (label.startsWith("BET ON ")) return "MANUAL BET";
  if (label === "LOGIN TO BET") return "LOGIN";
  if (label === "BET PENDING") return "PENDING";
  if (label === "BETTING PAUSED") return "PAUSED";
  if (label === "CREATING WALLET...") return "CREATING...";
  return label;
}

function compactAutoActionLabel(label: string): string {
  if (label === "START BOT") return "AUTO-MINER";
  if (label === "LOGIN TO START") return "LOGIN";
  if (label === "TX PENDING") return "PENDING";
  if (label === "BETTING PAUSED") return "PAUSED";
  if (label === "CREATING WALLET...") return "CREATING...";
  return label;
}

function MobileMiningActionBar({
  autoMinePhase,
  autoMinerForm,
  chatOpen,
  coldBootDefaults,
  feeEstimate,
  feeEstimateUnavailable,
  gridSelectedTiles,
  isAutoMining,
  isPending,
  isRevealing,
  liveStateReady,
  lowEthBalance,
  manualBetForm,
  onAutoAction,
  onManualAction,
  readOnlyReason,
  selectedTilesCount,
  walletAuthenticated,
  walletConnected,
  embeddedWalletSyncing,
  walletSetupCreating,
  walletSetupError,
  onWalletSetup,
}: {
  autoMinePhase: AutoMinePhase;
  autoMinerForm: AutoMinerFormState;
  chatOpen: boolean;
  coldBootDefaults: boolean;
  feeEstimate: string | null;
  feeEstimateUnavailable: boolean;
  gridSelectedTiles: number[];
  isAutoMining: boolean;
  isPending: boolean;
  isRevealing: boolean;
  liveStateReady: boolean;
  lowEthBalance: boolean;
  manualBetForm: ManualBetFormState;
  onAutoAction: (betSize: string, targets: number, cycles: number) => Promise<void>;
  onManualAction: (betAmount: string) => Promise<void>;
  readOnlyReason?: string | null;
  selectedTilesCount: number;
  walletAuthenticated: boolean;
  walletConnected: boolean;
  embeddedWalletSyncing: boolean;
  walletSetupCreating: boolean;
  walletSetupError: string | null;
  onWalletSetup: () => void;
}) {
  const keyboardInset = useVisualViewportKeyboardInset();
  const selection = summarizeMobileTileSelection(gridSelectedTiles);
  const exactTotal = formatExactMobileBetTotal(manualBetForm.betAmount, selectedTilesCount);
  const manualAction = deriveManualMiningAction({
    coldBootDefaults,
    isDisabled: manualBetForm.isDisabled,
    isPending,
    liveStateReady,
    readOnlyReason,
    selectedTilesCount,
    walletAuthenticated,
    walletConnected,
    embeddedWalletSyncing,
    walletSetupCreating,
  });
  const manualWalletCta = deriveWalletCta({ walletAuthenticated, walletConnected, embeddedWalletSyncing, walletSetupCreating });
  const autoAction = deriveAutoMinerAction({
    autoMinePhase,
    coldBootDefaults,
    isAutoMining,
    isDisabled: autoMinerForm.isDisabled,
    isPending,
    liveStateReady,
    lowEthForGas: lowEthBalance,
    readOnlyReason,
    walletAuthenticated,
    walletConnected,
    embeddedWalletSyncing,
    walletSetupCreating,
  });
  const autoWalletCta = deriveWalletCta({ walletAuthenticated, walletConnected, embeddedWalletSyncing, walletSetupCreating });
  const visibleStatus = walletSetupError
    ?? manualBetForm.betAmountError
    ?? (manualAction.disabled ? manualBetForm.disabledReason : null)
    ?? (autoAction.disabled && !isAutoMining ? autoMinerForm.disabledReason : null)
    ?? "Amount per tile";

  if (chatOpen) return null;

  return (
    <div
      data-testid="mobile-mining-action-bar"
      className="mobile-mine-action fixed left-2 right-16 z-[190] min-[900px]:hidden sm:left-4 sm:right-[5.25rem]"
      style={keyboardInset > 0
        ? { bottom: `calc(${keyboardInset}px + max(0.55rem, env(safe-area-inset-bottom)))` }
        : undefined}
    >
      <div className="rounded-2xl border border-violet-300/16 bg-[#070711]/96 p-2 shadow-[0_14px_34px_rgba(2,6,23,0.48)] backdrop-blur-xl">
        <div className="mb-1.5 flex min-w-0 items-center justify-between gap-2 px-0.5">
          <div className="min-w-0" aria-label={selection.fullLabel}>
            <div className="text-[8px] font-black uppercase leading-none tracking-[0.12em] text-slate-500">
              {selection.count} selected
            </div>
            <div className="mt-1 truncate text-[10px] font-bold leading-none text-emerald-200" title={selection.fullLabel}>
              {selection.compactLabel}
            </div>
          </div>
          <div className="min-w-0 text-right">
            <div className="text-[8px] font-black uppercase leading-none tracking-[0.12em] text-slate-500">Exact total</div>
            <output
              aria-label="Exact total stake"
              className={cn(
                "lore-nums no-scrollbar mt-1 block max-w-[8rem] overflow-x-auto whitespace-nowrap text-xs font-black leading-none tabular-nums",
                exactTotal === null || manualBetForm.manualInsufficient ? "text-red-300" : "text-violet-200",
              )}
            >
              {exactTotal ?? "Unavailable"} LINEA
            </output>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <label className="min-w-0">
            <span className="sr-only">Manual bet amount per tile</span>
            <input
              id="mobile-bet-amount-per-tile"
              aria-invalid={manualBetForm.betAmountError ? true : undefined}
              aria-describedby={manualBetForm.betAmountError ? "mobile-bet-amount-error" : undefined}
              type="text"
              inputMode="decimal"
              value={manualBetForm.betAmount}
              onChange={(event) => manualBetForm.setBetAmount(event.target.value.slice(0, 20))}
              disabled={Boolean(readOnlyReason) || isPending || isRevealing || isAutoMining}
              maxLength={20}
              className={cn(
                "lore-nums h-11 w-full rounded-xl border bg-black/34 px-2 text-sm font-black tabular-nums text-white outline-none transition focus:border-emerald-300/45 focus:ring-2 focus:ring-emerald-300/16",
                manualBetForm.betAmountError ? "border-red-400/35" : "border-white/8",
              )}
            />
          </label>

          <UiButton
            data-testid="mobile-manual-bet-action"
            aria-label={manualAction.label}
            aria-describedby={manualAction.disabled && manualBetForm.disabledReason ? "mobile-manual-bet-disabled-reason" : undefined}
            onClick={() => {
              if (manualWalletCta === "login") {
                requestWalletLogin();
                return;
              }
              if (manualWalletCta === "create") {
                onWalletSetup();
                return;
              }
              if (manualWalletCta === "ready") void onManualAction(manualBetForm.betAmount);
            }}
            disabled={manualAction.disabled}
            variant={manualAction.variant}
            size="sm"
            uppercase
            className="h-11 min-w-0 rounded-xl px-1 text-[9px] leading-tight"
          >
            {compactManualActionLabel(manualAction.label)}
          </UiButton>

          <UiButton
            data-testid="mobile-auto-miner-action"
            aria-label={autoAction.label}
            aria-describedby={autoAction.disabled && autoMinerForm.disabledReason && !isAutoMining ? "mobile-auto-miner-disabled-reason" : undefined}
            onClick={() => {
              if (autoWalletCta === "login") {
                requestWalletLogin();
                return;
              }
              if (autoWalletCta === "create") {
                onWalletSetup();
                return;
              }
              if (autoWalletCta === "ready") void onAutoAction(autoMinerForm.betSize, autoMinerForm.targets, autoMinerForm.cycles);
            }}
            disabled={autoAction.disabled}
            variant={autoAction.variant}
            size="sm"
            uppercase
            className="h-11 min-w-0 rounded-xl px-1 text-[9px] leading-tight"
          >
            {compactAutoActionLabel(autoAction.label)}
          </UiButton>
        </div>

        <div className="mt-1 flex min-h-3 items-center justify-between gap-2 px-0.5 text-[8px] font-bold uppercase tracking-[0.06em] text-slate-500">
          <span id="mobile-bet-amount-error" role={walletSetupError ? "alert" : undefined} className={walletSetupError || manualBetForm.betAmountError ? "truncate text-red-300" : "truncate"}>
            {visibleStatus}
          </span>
          {walletConnected && selectedTilesCount > 0 && (
            <span className="lore-nums shrink-0 text-sky-200">
              Fee {getHubFeeEstimateLabel(feeEstimate, feeEstimateUnavailable)}
            </span>
          )}
        </div>
        {manualAction.disabled && manualBetForm.disabledReason && (
          <span id="mobile-manual-bet-disabled-reason" className="sr-only">{manualBetForm.disabledReason}</span>
        )}
        {autoAction.disabled && autoMinerForm.disabledReason && !isAutoMining && (
          <span id="mobile-auto-miner-disabled-reason" className="sr-only">{autoMinerForm.disabledReason}</span>
        )}
      </div>
    </div>
  );
}
