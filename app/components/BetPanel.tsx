"use client";

import React from "react";
import type { AutoMinePhase } from "../hooks/useMining.types";
import { GRID_SIZE } from "../lib/constants";
import { processingQuotes } from "../lib/loreTexts";
import { useAutoMinerForm } from "../hooks/useAutoMinerForm";
import type { ManualBetFormState } from "../hooks/useManualBetForm";
import { LoreText } from "./LoreText";
import { cn } from "../lib/cn";
import { UiButton } from "./ui/UiButton";
import { UiInput } from "./ui/UiInput";
import { UiPanel } from "./ui/UiPanel";
import { uiTokens } from "./ui/tokens";

const PANEL_TITLE_BAR = "bet-panel-titlebar mb-2 flex items-center gap-2 border-b border-white/6 pb-2";
const PANEL_TITLE = "text-[11px] font-black uppercase tracking-[0.08em] text-white";
const FIELD_LABEL = "mb-1 block px-0.5 text-[8px] font-black uppercase tracking-[0.08em] text-slate-500";
const ACTION_BUTTON_CLASS = "h-10 text-[11px] font-black";
const QUICK_BUTTON_CLASS =
  "console-chip h-8 rounded-lg border px-2 text-[9px] font-black uppercase tracking-[0.08em] transition-all duration-200 hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-40";

function getAutoMinePhaseMeta(phase: AutoMinePhase) {
  switch (phase) {
    case "starting":
      return {
        label: "Starting",
        badgeClass: "text-sky-200",
        defaultProgress: "Bootstrapping wallet, allowance, and tab lock...",
        detail: "Preparing the wallet path before the first automated round.",
      };
    case "restoring":
      return {
        label: "Restoring",
        badgeClass: "text-violet-200",
        defaultProgress: "Restoring saved auto-miner session...",
        detail: "Recovering the previous run after reload, reconnect, or temporary RPC trouble.",
      };
    case "running":
      return {
        label: "Running",
        badgeClass: "text-emerald-200",
        defaultProgress: "Waiting for the next ready epoch and placing bets automatically.",
        detail: "The bot will handle the next eligible round without manual input.",
      };
    case "retry-wait":
      return {
        label: "Recovery queued",
        badgeClass: "text-violet-200",
        defaultProgress: "Auto-miner is paused while the previous run settles. It will resume automatically.",
        detail: "Prevents duplicate bot loops after reloads, reconnects, or temporary RPC trouble.",
      };
    case "session-expired":
      return {
        label: "Session Expired",
        badgeClass: "text-red-200",
        defaultProgress: "Log out, log in again, then reload this page to resume.",
        detail: "The embedded wallet session expired and needs a fresh login.",
      };
    case "idle":
    default:
      return {
        label: "Idle",
        badgeClass: "text-slate-300",
        defaultProgress: null,
        detail: null,
      };
  }
}

interface ManualBetProps {
  formattedBalance: string | null;
  walletConnected: boolean;
  coldBootDefaults?: boolean;
  liveStateReady?: boolean;
  readOnlyReason?: string | null;
  selectedTilesCount: number;
  feeEstimate: string | null;
  feeEstimateUnavailable: boolean;
  isPending: boolean;
  isRevealing: boolean;
  isAnalyzing?: boolean;
  isAutoMining: boolean;
  manualBetForm: ManualBetFormState;
  onMine: (betAmount: string) => void;
  onQuickPickTiles: (tileIds: number[]) => void;
}

export const ManualBetPanel = React.memo(function ManualBetPanel({
  walletConnected,
  coldBootDefaults = false,
  liveStateReady = true,
  readOnlyReason = null,
  selectedTilesCount,
  feeEstimate,
  feeEstimateUnavailable,
  isPending,
  isRevealing,
  isAnalyzing: _isAnalyzing = false,
  isAutoMining,
  manualBetForm,
  onMine,
  onQuickPickTiles,
}: ManualBetProps) {
  const {
    betAmount,
    setBetAmount,
    totalBet,
    betAmountError,
    manualInsufficient,
    isDisabled,
  } = manualBetForm;
  const requiresLogin = !walletConnected;
  const manualStatusText =
    !liveStateReady && !coldBootDefaults
      ? "Waiting for live epoch sync"
      : null;
  const quickPickDisabled = Boolean(readOnlyReason) || !liveStateReady || isPending || isRevealing || isAutoMining;
  const actionVariant = isPending || (!liveStateReady && !coldBootDefaults)
    ? "pending"
    : readOnlyReason || isDisabled
      ? "locked"
      : "primary";
  const handleQuickPick = React.useCallback(
    (count: number) => {
      const tiles = Array.from({ length: GRID_SIZE }, (_, index) => index + 1);
      for (let index = tiles.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [tiles[index], tiles[swapIndex]] = [tiles[swapIndex], tiles[index]];
      }
      onQuickPickTiles(tiles.slice(0, count).sort((a, b) => a - b));
    },
    [onQuickPickTiles],
  );

  if (isAutoMining) {
    return (
      <UiPanel
        tone="default"
        padding="sm"
        className={`${uiTokens.shadow.insetHighlight} control-panel control-panel-manual`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-3.5 bg-emerald-400/40 rounded-full" />
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Manual Bet</span>
          </div>
        </div>
      </UiPanel>
    );
  }

  return (
    <UiPanel
      tone="default"
      padding="sm"
      className={`${uiTokens.shadow.panelInset} control-panel control-panel-manual p-2.5 sm:p-3`}
    >
      <div className={PANEL_TITLE_BAR}>
        <div className="flex items-center gap-1.5">
          <div className="h-3.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.32)]" />
          <span className={PANEL_TITLE}>Manual Bet</span>
        </div>
      </div>

      <div className="mb-2">
        <label
          htmlFor="bet-amount-per-tile"
          className={FIELD_LABEL}
        >
          Amount per tile
        </label>
        <UiInput
          id="bet-amount-per-tile"
          type="text"
          inputMode="decimal"
          value={betAmount}
          onChange={(e) => setBetAmount(e.target.value.slice(0, 20))}
          disabled={Boolean(readOnlyReason) || isPending || isRevealing}
          maxLength={20}
          tone={betAmountError ? "danger" : "default"}
          errorText={betAmountError ?? undefined}
          className="console-input lore-nums h-9 px-3 text-base font-black"
        />
      </div>

      <div
        className={`console-readout mb-2 flex min-h-9 items-center justify-between rounded-lg border px-2.5 py-1 transition-colors duration-200 ${
          manualInsufficient ? "border-red-500/30 bg-red-500/8" : "border-emerald-300/12"
        }`}
      >
        <span className="text-[8px] font-black uppercase tracking-[0.08em] text-slate-500">{selectedTilesCount} selected</span>
        <span className={`lore-nums text-xs font-black ${manualInsufficient ? "text-red-400" : "text-violet-300"}`}>
          {totalBet.toFixed(2)} LINEA
        </span>
      </div>

      {manualStatusText && (
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-violet-500/8 border border-violet-500/20 mb-1.5">
          <span className="text-[8px] font-bold text-violet-300/80 uppercase tracking-wide">
            {manualStatusText}
          </span>
        </div>
      )}

      {selectedTilesCount > 0 && walletConnected && (
        <div className="mb-1.5 flex min-h-6 items-center justify-between px-1 text-[8px] font-bold uppercase tracking-[0.08em] text-slate-500">
          <span>Bet network fee</span>
          <span className="lore-nums text-sky-200">
            {feeEstimate ? `~${feeEstimate} ETH` : feeEstimateUnavailable ? "Unavailable" : "Calculating..."}
          </span>
        </div>
      )}

      {readOnlyReason && (
        <div className="mb-1.5 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2 py-1.5">
          <span className="text-[8px] font-bold uppercase tracking-wide text-amber-300">
            {readOnlyReason}
          </span>
        </div>
      )}

      {manualInsufficient && (
        <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-lg bg-red-500/10 border border-red-500/25 mb-1.5">
          <svg className="w-3 h-3 text-red-400 shrink-0 mt-px" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          <div>
            <span className="text-[8px] font-bold text-red-400 block">Insufficient balance</span>
            <span className="text-[7px] text-red-400/70 block mt-0.5">Top up your Privy wallet via Settings to continue</span>
          </div>
        </div>
      )}

      <div className="mb-2 grid grid-cols-3 gap-1.5">
        <button
          type="button"
          disabled={quickPickDisabled}
          onClick={() => handleQuickPick(3)}
          className={`${QUICK_BUTTON_CLASS} border-violet-500/25 bg-violet-500/10 text-violet-100 hover:border-violet-400/45 hover:bg-violet-500/18`}
        >
          Lucky 3
        </button>
        <button
          type="button"
          disabled={quickPickDisabled}
          onClick={() => handleQuickPick(5)}
          className={`${QUICK_BUTTON_CLASS} border-sky-500/25 bg-sky-500/10 text-sky-100 hover:border-sky-400/45 hover:bg-sky-500/18`}
        >
          Lucky 5
        </button>
        <button
          type="button"
          disabled={quickPickDisabled || selectedTilesCount === 0}
          onClick={() => onQuickPickTiles([])}
          className={`${QUICK_BUTTON_CLASS} border-white/10 bg-white/5 text-slate-200 hover:border-white/20 hover:bg-white/9`}
        >
          Clear
        </button>
      </div>

      <UiButton
        data-testid="manual-bet-action"
        onClick={() => onMine(betAmount)}
        disabled={Boolean(readOnlyReason) || isDisabled}
        variant={actionVariant}
        size="sm"
        uppercase
        fullWidth
        className={cn(ACTION_BUTTON_CLASS, "shadow-none", actionVariant === "primary" && "shimmer-btn")}
      >
        {isPending ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <LoreText items={processingQuotes} />
          </span>
        ) : !liveStateReady && !coldBootDefaults ? (
          "SYNCING..."
        ) : readOnlyReason ? (
          "BETTING PAUSED"
        ) : requiresLogin ? (
          "LOGIN TO BET"
        ) : selectedTilesCount > 0 ? (
          `BET ON ${selectedTilesCount} TILES`
        ) : (
          "SELECT TILES"
        )}
      </UiButton>

      {!isPending && !isRevealing && (
        <p className="mt-2 text-center text-[8px] leading-relaxed text-slate-500">
          {feeEstimate ? "Estimate covers the bet; a first approval may cost extra" : "Keep ETH for gas and LINEA for the stake in the Privy wallet"}
        </p>
      )}
    </UiPanel>
  );
});

interface AutoMinerProps {
  autoMinePhase: AutoMinePhase;
  isAutoMining: boolean;
  isPending: boolean;
  isRevealing: boolean;
  isAnalyzing?: boolean;
  coldBootDefaults?: boolean;
  liveStateReady?: boolean;
  readOnlyReason?: string | null;
  autoMineProgress?: string | null;
  formattedBalance?: string | null;
  walletConnected: boolean;
  runningParams?: { betStr: string; blocks: number; rounds: number } | null;
  lowEthForGas?: boolean;
  onToggle: (betStr: string, blocks: number, rounds: number) => void;
}

export const AutoMinerPanel = React.memo(function AutoMinerPanel({
  autoMinePhase,
  isAutoMining,
  isPending,
  isRevealing,
  isAnalyzing = false,
  coldBootDefaults = false,
  liveStateReady = true,
  readOnlyReason = null,
  autoMineProgress,
  formattedBalance,
  walletConnected,
  runningParams,
  lowEthForGas,
  onToggle,
}: AutoMinerProps) {
  const {
    betSize,
    setBetSize,
    targets,
    cycles,
    displayBetSize,
    displayTargets,
    displayCycles,
    totalCost,
    betSizeError,
    balance,
    insufficientBalance,
    disabledReason,
    isDisabled,
    handleTargetsChange,
    handleCyclesChange,
  } = useAutoMinerForm({
    isAutoMining,
    isPending,
    isRevealing,
    isAnalyzing,
    liveStateReady,
    readOnlyReason,
    formattedBalance,
    walletConnected,
    runningParams,
    lowEthForGas,
  });

  const compact = isAutoMining;
  const requiresLogin = !walletConnected;
  const phaseMeta = getAutoMinePhaseMeta(autoMinePhase);
  const phaseProgressText = autoMineProgress ?? phaseMeta.defaultProgress;
  const showAutoMineProgress = Boolean(phaseProgressText) && (
    isAutoMining ||
    autoMinePhase === "retry-wait" ||
    autoMinePhase === "session-expired"
  );
  const compactProgressMatch = phaseProgressText?.match(/^(\d+)\s*\/\s*(\d+)\s*-\s*(.+)$/i);
  const compactProgressCurrent = compactProgressMatch ? Number(compactProgressMatch[1]) : null;
  const compactProgressTotal = compactProgressMatch ? Number(compactProgressMatch[2]) : null;
  const compactProgressDetail = compactProgressMatch ? compactProgressMatch[3] : phaseProgressText;
  const buttonDisabled = requiresLogin || isDisabled || autoMinePhase === "retry-wait" || autoMinePhase === "session-expired";
  const buttonLabel = isAutoMining
    ? "STOP BOT"
    : readOnlyReason
      ? "BETTING PAUSED"
    : autoMinePhase === "retry-wait"
      ? "RESUME PENDING"
      : autoMinePhase === "session-expired"
        ? "SESSION EXPIRED"
        : !liveStateReady && !coldBootDefaults
          ? "SYNCING..."
          : requiresLogin
            ? "LOGIN TO START"
            : lowEthForGas
              ? "LOW ETH FOR GAS"
            : "START BOT";
  const autoMinerStatusText =
    !liveStateReady && !coldBootDefaults
        ? "Waiting for live epoch sync"
        : lowEthForGas
          ? "Top up ETH in the Privy wallet for gas"
        : null;
  const autoButtonVariant = isAutoMining
    ? "danger"
    : autoMinePhase === "session-expired"
      ? "danger"
      : autoMinePhase === "retry-wait" || (!liveStateReady && !coldBootDefaults)
        ? "pending"
        : buttonDisabled
          ? "locked"
          : "primary";

  return (
    <UiPanel
      tone="default"
      padding="md"
      className={`${uiTokens.shadow.panelInset} control-panel control-panel-auto ${compact ? "p-2" : "p-2.5 sm:p-3"}`}
    >
      {compact ? (
        <>
          <div className="mb-1.5 px-1">
            <div className="flex min-h-6 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="lore-nums truncate text-xs font-black uppercase tracking-[0.12em] leading-none text-slate-300">
                  {displayTargets}x{displayBetSize} <span className="text-slate-500">LINEA</span>
                </span>
                <span className="text-[10px] font-black uppercase leading-none tracking-[0.1em] text-sky-200/70">
                  {displayCycles} cyc
                </span>
              </div>
              <span className="lore-nums inline-flex h-6 shrink-0 items-center text-xs font-black tabular-nums leading-none text-sky-300">
                {totalCost.toFixed(0)} <span className="ml-1 text-slate-500">LINEA</span>
              </span>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className={PANEL_TITLE_BAR}>
            <div className="h-3.5 w-1.5 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.32)]" />
            <span className={PANEL_TITLE}>Auto-Miner</span>
            {autoMinePhase !== "idle" && (
              <span className={`ml-auto rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.18em] ${phaseMeta.badgeClass}`}>
                {phaseMeta.label}
              </span>
            )}
          </div>

          <div className="mb-1.5 grid grid-cols-2 gap-1.5">
            <SmallInput
              label="Bet Size"
              value={displayBetSize}
              onChange={setBetSize}
              disabled={Boolean(readOnlyReason) || isPending || isRevealing || isAutoMining}
              inputMode="decimal"
              errorText={betSizeError}
              accent="sky"
              compact
            />
            <SmallInput
              label="Targets"
              value={displayTargets}
              onChange={handleTargetsChange}
              disabled={Boolean(readOnlyReason) || isPending || isRevealing || isAutoMining}
              type="number"
              min={1}
              max={GRID_SIZE}
              accent="sky"
              compact
            />
          </div>

          <SmallInput
            label="Cycles"
            value={displayCycles}
            onChange={handleCyclesChange}
            disabled={Boolean(readOnlyReason) || isPending || isRevealing || isAutoMining}
            type="number"
            min={1}
            className="mb-2"
            accent="sky"
            compact
          />

          <div
            className={`console-readout mb-2 flex min-h-10 items-center justify-between rounded-lg border px-2.5 py-1 transition-colors duration-200 ${
              insufficientBalance ? "border-red-500/30 bg-red-500/8" : "border-sky-300/12"
            }`}
          >
            <div>
              <div className="text-[8px] font-black uppercase tracking-[0.08em] text-slate-500">Total reserved</div>
              <div className="lore-nums text-[8px] text-slate-500">
                {(totalCost / Math.max(1, Number(displayCycles) || 1)).toFixed(2)} LINEA / round
              </div>
            </div>
            <span className={`lore-nums text-xs font-black ${insufficientBalance ? "text-red-400" : "text-sky-300"}`}>
              {totalCost.toFixed(2)} LINEA
            </span>
          </div>

          {insufficientBalance && (
            <div className="flex items-start gap-1 px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/25 mb-1.5">
              <svg className="w-3 h-3 text-red-400 shrink-0 mt-px" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="lore-nums text-[8px] font-bold text-red-400 leading-tight">
                Need {totalCost.toFixed(2)}, have {balance?.toFixed(2)} LINEA
              </span>
            </div>
          )}
        </>
      )}

      {showAutoMineProgress && phaseProgressText && (
        compact ? (
          <div className="mb-2 flex min-h-5 items-center justify-between gap-3 px-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[9px] font-black uppercase tracking-[0.12em] text-sky-300/85" title={compactProgressDetail || ""}>
                {compactProgressDetail}
              </span>
            </div>
            {compactProgressCurrent !== null && compactProgressTotal !== null && (
              <span className="lore-nums shrink-0 text-[9px] font-black leading-none text-sky-200">
                {compactProgressCurrent}/{compactProgressTotal}
              </span>
            )}
          </div>
        ) : (
          <div className="relative bg-sky-500/8 rounded-lg border border-sky-500/20 overflow-hidden p-2 mb-2">
            <div
              className="absolute inset-0 bg-linear-to-r from-transparent via-sky-400/5 to-transparent pointer-events-none"
            />
            <div className="relative space-y-1">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />
                <span className="text-[10px] font-bold text-sky-400 uppercase tracking-wider truncate" title={phaseProgressText || ""}>
                  {phaseProgressText}
                </span>
              </div>
              {phaseMeta.detail && (
                <p className="text-[10px] leading-relaxed text-sky-100/70">
                  {phaseMeta.detail}
                </p>
              )}
            </div>
          </div>
        )
      )}

      {autoMinerStatusText && !isAutoMining && (
        <div
          className={`mb-2 border border-amber-500/25 bg-amber-500/10 px-2.5 py-2 ${uiTokens.radius.sm}`}
        >
          <div className="min-w-0">
            <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400">
              {autoMinerStatusText}
            </span>
          </div>
        </div>
      )}

      <UiButton
        data-testid="auto-miner-action"
        onClick={() => onToggle(betSize, targets, cycles)}
        disabled={buttonDisabled}
        variant={autoButtonVariant}
        size="sm"
        fullWidth
        uppercase
        className={cn(ACTION_BUTTON_CLASS, "shadow-none", autoButtonVariant === "primary" && "shimmer-btn")}
      >
        {buttonLabel}
      </UiButton>

      {buttonDisabled && disabledReason && !isAutoMining && (
        <p className="mt-1.5 text-center text-[9px] font-semibold uppercase tracking-wider text-slate-500">
          {disabledReason}
        </p>
      )}
    </UiPanel>
  );
});

const SmallInput = React.memo(function SmallInput({
  label,
  value,
  onChange,
  disabled,
  type = "text",
  inputMode,
  errorText,
  min,
  max,
  className = "",
  accent = "violet",
  compact = false,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  disabled: boolean;
  type?: string;
  inputMode?: "decimal" | "numeric";
  errorText?: string | null;
  min?: number;
  max?: number;
  className?: string;
  accent?: "violet" | "sky";
  compact?: boolean;
}) {
  const inputId = `small-input-${label.toLowerCase().replace(/\s+/g, "-")}`;
  const inputAccent =
    accent === "sky"
      ? "border-sky-500/20 focus:border-sky-500/45 focus:shadow-[0_0_12px_rgba(56,189,248,0.12)]"
      : "border-violet-500/20 focus:border-violet-500/45 focus:shadow-[0_0_12px_rgba(139,92,246,0.12)]";

  return (
    <div className={className}>
      <label htmlFor={inputId} className={`${FIELD_LABEL} ${compact ? "pt-0" : "pt-0.5"}`}>
        {label}
      </label>
      <UiInput
        id={inputId}
        type={type}
        inputMode={inputMode}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        min={min}
        max={max}
        tone={errorText ? "danger" : "default"}
        errorText={errorText ?? undefined}
        className={cn(
          "console-input lore-nums font-bold text-white",
          compact ? "h-9 px-2.5 py-1 text-sm" : "h-9 px-3 py-1 text-sm",
          inputAccent,
        )}
      />
    </div>
  );
});
