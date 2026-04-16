"use client";

import React from "react";
import type { AutoMinePhase } from "../hooks/useMining.types";
import { GRID_SIZE } from "../lib/constants";
import { processingQuotes } from "../lib/loreTexts";
import { useAutoMinerForm } from "../hooks/useAutoMinerForm";
import { useManualBetForm } from "../hooks/useManualBetForm";
import { LoreText } from "./LoreText";
import { cn } from "../lib/cn";
import { UiButton } from "./ui/UiButton";
import { UiInput } from "./ui/UiInput";
import { UiPanel } from "./ui/UiPanel";
import { uiTokens } from "./ui/tokens";

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
        label: "Retry Wait",
        badgeClass: "text-amber-200",
        defaultProgress: "Saved session is paused and will retry automatically.",
        detail: "The previous run is waiting for RPC or wallet recovery before resuming.",
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
  coldBootDefaults?: boolean;
  liveStateReady?: boolean;
  selectedTilesCount: number;
  isPending: boolean;
  isRevealing: boolean;
  isAnalyzing?: boolean;
  isAutoMining: boolean;
  onMine: (betAmount: string) => void;
  lastBet?: { tiles: number[]; amount: string } | null;
  onRepeatBet?: () => void;
}

export const ManualBetPanel = React.memo(function ManualBetPanel({
  formattedBalance,
  coldBootDefaults = false,
  liveStateReady = true,
  selectedTilesCount,
  isPending,
  isRevealing,
  isAnalyzing = false,
  isAutoMining,
  onMine,
  lastBet,
  onRepeatBet,
}: ManualBetProps) {
  const { betAmount, setBetAmount, totalBet, manualInsufficient, isDisabled } = useManualBetForm({
    formattedBalance,
    liveStateReady,
    selectedTilesCount,
    isPending,
    isRevealing,
    isAnalyzing,
    isAutoMining,
  });
  const requiresLogin = formattedBalance == null;
  const manualStatusText =
    !liveStateReady && !coldBootDefaults
      ? "Waiting for live epoch sync"
      : null;

  if (isAutoMining) {
    return (
      <UiPanel
        tone="default"
        padding="sm"
        className={`${uiTokens.shadow.insetHighlight} animate-slide-up`}
        style={{ animationDelay: "0.2s" }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-3.5 bg-emerald-400/40 rounded-full" />
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Manual Bet</span>
          </div>
          {formattedBalance && (
            <span className="lore-nums text-[10px] text-gray-500">{formattedBalance} LINEA</span>
          )}
        </div>
      </UiPanel>
    );
  }

  return (
    <UiPanel
      tone="default"
      padding="sm"
      className={`${uiTokens.shadow.panelInset} animate-slide-up`}
      style={{ animationDelay: "0.2s" }}
    >
      <div className="flex items-center justify-between mb-1.5 border-b border-white/[0.06] pb-1.5">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-3 bg-emerald-400 rounded-full animate-synced-pulse shadow-[0_0_8px_rgba(52,211,153,0.4)]" />
          <span className="text-[10px] font-bold text-white uppercase tracking-wider">Manual Bet</span>
        </div>
        {formattedBalance && (
          <span className="text-[9px] text-gray-500">
            <span className="lore-nums text-white font-semibold">{formattedBalance}</span> LINEA
          </span>
        )}
      </div>

      <div className="mb-1.5">
        <label
          htmlFor="bet-amount-per-tile"
          className="text-[7px] font-bold uppercase text-slate-500 block mb-0.5 px-0.5"
        >
          Amount per tile
        </label>
        <UiInput
          id="bet-amount-per-tile"
          type="text"
          inputMode="decimal"
          value={betAmount}
          onChange={(e) => setBetAmount(e.target.value.slice(0, 20))}
          disabled={isPending || isRevealing}
          maxLength={20}
          className="h-8 px-2 text-sm font-bold bg-[#0a0a16]"
        />
      </div>

      <div
        className={`flex justify-between items-center rounded-lg border px-2 py-1 mb-1.5 transition-colors duration-200 ${
          manualInsufficient ? "bg-red-500/8 border-red-500/30" : "bg-black/20 border-white/[0.04]"
        }`}
      >
        <span className="text-[8px] font-bold uppercase text-gray-500">Total:</span>
        <span className={`lore-nums font-bold text-[11px] ${manualInsufficient ? "text-red-400" : "text-violet-400"}`}>
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

      {lastBet && onRepeatBet && !isAutoMining && (
        <UiButton
          onClick={onRepeatBet}
          disabled={isPending || isRevealing || isAnalyzing}
          variant="secondary"
          size="sm"
          uppercase
          fullWidth
          className="mb-1 text-[10px]"
        >
          <span className="lore-nums">Repeat: {lastBet.tiles.length} tiles x {lastBet.amount} LINEA</span>
        </UiButton>
      )}

      <UiButton
        onClick={() => onMine(betAmount)}
        disabled={isDisabled}
        variant={isDisabled ? "ghost" : "primary"}
        size="md"
        uppercase
        fullWidth
        className={cn(
          "text-[11px]",
          isDisabled
            ? "bg-[#13132a] text-gray-400 border-white/[0.04]"
            : "text-white bg-gradient-to-r from-violet-600 to-indigo-600 border-violet-500/40 hover:from-violet-500 hover:to-indigo-500 shadow-lg shadow-violet-600/20 hover:shadow-violet-500/30 shimmer-btn",
        )}
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
        ) : requiresLogin ? (
          "LOGIN TO BET"
        ) : selectedTilesCount > 0 ? (
          `BET ON ${selectedTilesCount} TILES`
        ) : (
          "SELECT TILES"
        )}
      </UiButton>

      {!lastBet && !isPending && !isRevealing && (
        <div className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-white/[0.05] bg-white/[0.02] px-2 py-1.5">
          <div className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400/80" />
          <p className="text-[9px] leading-relaxed text-slate-400">
            Bets settle on-chain and can&apos;t be undone after confirmation. Keep ETH for gas and LINEA for the stake in the Privy wallet.
          </p>
        </div>
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
  autoMineProgress?: string | null;
  formattedBalance?: string | null;
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
  autoMineProgress,
  formattedBalance,
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
    balance,
    insufficientBalance,
    isDisabled,
    handleTargetsChange,
    handleCyclesChange,
  } = useAutoMinerForm({
    isAutoMining,
    isPending,
    isRevealing,
    isAnalyzing,
    liveStateReady,
    formattedBalance,
    runningParams,
    lowEthForGas,
  });

  const compact = isAutoMining;
  const requiresLogin = formattedBalance == null;
  const phaseMeta = getAutoMinePhaseMeta(autoMinePhase);
  const phaseProgressText = autoMineProgress ?? phaseMeta.defaultProgress;
  const buttonDisabled = isDisabled || autoMinePhase === "retry-wait" || autoMinePhase === "session-expired";
  const buttonLabel = isAutoMining
    ? "STOP BOT"
    : autoMinePhase === "retry-wait"
      ? "AUTO-RETRY PENDING"
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
    autoMinePhase === "retry-wait" || autoMinePhase === "session-expired"
      ? phaseProgressText
      : !liveStateReady && !coldBootDefaults
        ? "Waiting for live epoch sync"
        : lowEthForGas
          ? "Top up ETH in the Privy wallet for gas"
          : null;

  return (
    <UiPanel
      tone="default"
      padding="md"
      className={`${uiTokens.shadow.panelInset} animate-slide-up ${compact ? "p-2" : "p-3"}`}
      style={{ animationDelay: "0.25s" }}
    >
      {compact ? (
        <>
          <div className="mb-1.5 flex min-h-[24px] items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500 animate-synced-pulse shadow-[0_0_6px_rgba(239,68,68,0.4)]" />
              <span className="lore-nums truncate text-[10px] font-bold uppercase tracking-wider leading-none text-gray-400">
                {displayTargets}x{displayBetSize} <span className="text-gray-400">LINEA</span> - {displayCycles} cyc
              </span>
            </div>
            <span className="lore-nums inline-flex h-6 shrink-0 items-center text-[10px] font-bold tabular-nums leading-none text-sky-400">
              {totalCost.toFixed(0)} <span className="text-gray-400">LINEA</span>
            </span>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-1.5 border-b border-white/[0.06] mb-1.5 pb-1.5">
            <div className="w-1.5 h-3 rounded-full bg-sky-400 animate-synced-pulse shadow-[0_0_8px_rgba(56,189,248,0.4)]" />
            <span className="text-[10px] font-bold text-white uppercase tracking-wider">Auto-Miner</span>
            {autoMinePhase !== "idle" && (
              <span className={`ml-auto rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.18em] ${phaseMeta.badgeClass}`}>
                {phaseMeta.label}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-1 mb-1">
            <SmallInput
              label="Bet Size"
              value={displayBetSize}
              onChange={setBetSize}
              disabled={isPending || isRevealing || isAutoMining}
              inputMode="decimal"
              accent="sky"
              compact
            />
            <SmallInput
              label="Targets"
              value={displayTargets}
              onChange={handleTargetsChange}
              disabled={isPending || isRevealing || isAutoMining}
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
            disabled={isPending || isRevealing || isAutoMining}
            type="number"
            min={1}
            className="mb-1.5"
            accent="sky"
            compact
          />

          <div
            className={`flex justify-between items-center rounded-lg border px-2 py-1 mb-1.5 transition-colors duration-200 ${
              insufficientBalance ? "bg-red-500/8 border-red-500/30" : "bg-black/20 border-white/[0.04]"
            }`}
          >
            <span className="text-[8px] font-bold uppercase text-gray-500">Total Req:</span>
            <span className={`lore-nums font-bold text-[11px] ${insufficientBalance ? "text-red-400" : "text-sky-400"}`}>
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

      {isAutoMining && phaseProgressText && (
        compact ? (
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="w-1 h-1 rounded-full bg-sky-400 animate-synced-pulse shrink-0" />
              <span className="truncate text-[9px] font-bold uppercase tracking-wider text-sky-400/70" title={phaseProgressText || ""}>
                {phaseProgressText}
              </span>
            </div>
          </div>
        ) : (
          <div className="relative bg-sky-500/8 rounded-lg border border-sky-500/20 overflow-hidden p-2 mb-2">
            <div
              className="absolute inset-0 bg-gradient-to-r from-transparent via-sky-400/5 to-transparent animate-shimmer pointer-events-none"
              style={{ animation: "shimmer 2s ease-in-out infinite" }}
            />
            <div className="relative space-y-1">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-synced-pulse shrink-0" />
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
          className={`flex items-start gap-1.5 px-2 py-1.5 ${uiTokens.radius.sm} border mb-2 ${
            autoMinePhase === "session-expired"
              ? "bg-red-500/10 border-red-500/25"
              : autoMinePhase === "retry-wait"
                ? "bg-amber-500/10 border-amber-500/25"
                : "bg-amber-500/10 border-amber-500/25"
          }`}
        >
          <div className={`mt-0.5 h-2 w-2 rounded-full shrink-0 ${
            autoMinePhase === "session-expired" ? "bg-red-400" : "bg-amber-400"
          }`} />
          <div className="min-w-0">
            {autoMinePhase === "retry-wait" || autoMinePhase === "session-expired" ? (
              <span className={`text-[9px] font-bold uppercase tracking-wider ${
                autoMinePhase === "session-expired" ? "text-red-300" : "text-amber-400"
              }`}>
                {phaseMeta.label}
              </span>
            ) : (
              <span className="text-[9px] font-bold text-amber-400 uppercase tracking-wider">
                {autoMinerStatusText}
              </span>
            )}
            {(autoMinePhase === "retry-wait" || autoMinePhase === "session-expired") ? (
              <p className={`mt-0.5 text-[10px] leading-relaxed ${
                autoMinePhase === "session-expired" ? "text-red-200/80" : "text-amber-100/70"
              }`}>
                {autoMinerStatusText}
              </p>
            ) : null}
          </div>
        </div>
      )}

      <UiButton
        onClick={() => onToggle(betSize, targets, cycles)}
        disabled={buttonDisabled}
        variant={isAutoMining ? "danger" : "sky"}
        size={compact ? "sm" : "md"}
        fullWidth
        uppercase
        className={cn(
          "text-[11px]",
          isAutoMining && "bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/15 hover:shadow-[0_0_16px_rgba(239,68,68,0.15)]",
          !isAutoMining && !buttonDisabled && "shimmer-btn",
          !isAutoMining && buttonDisabled && "bg-[#13132a] text-gray-400 border-white/[0.04]",
        )}
      >
        {buttonLabel}
      </UiButton>
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
      <label htmlFor={inputId} className={`text-[8px] font-bold uppercase text-slate-500 block mb-0.5 px-0.5 ${compact ? "pt-0" : "pt-0.5"}`}>
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
        className={cn(
          "lore-nums bg-[#0a0a16] font-bold text-white",
          compact ? "h-8 px-1.5 py-0.5 text-xs" : "h-8 px-2 py-1 text-sm",
          inputAccent,
        )}
      />
    </div>
  );
});
