"use client";

import React from "react";
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

/* Manual Bet */

interface ManualBetProps {
  formattedBalance: string | null;
  coldBootDefaults?: boolean;
  liveStateReady?: boolean;
  selectedTilesCount: number;
  isPending: boolean;
  isRevealing: boolean;
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
    isAutoMining,
  });

  if (isAutoMining) {
    return (
      <UiPanel
        tone="default"
        padding="sm"
        className="shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] animate-slide-up"
        style={{ animationDelay: "0.2s" }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-3.5 bg-emerald-400/40 rounded-full" />
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Manual Bet</span>
          </div>
          {formattedBalance && (
            <span className="text-[10px] text-gray-500">{formattedBalance} LINEA</span>
          )}
        </div>
      </UiPanel>
    );
  }

  return (
    <UiPanel
      tone="default"
      padding="sm"
      className="shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_20px_rgba(139,92,246,0.06)] animate-slide-up"
      style={{ animationDelay: "0.2s" }}
    >
      <div className="flex items-center justify-between mb-1.5 border-b border-white/[0.06] pb-1.5">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-3 bg-emerald-400 rounded-full animate-synced-pulse shadow-[0_0_8px_rgba(52,211,153,0.4)]" />
          <span className="text-[10px] font-bold text-white uppercase tracking-wider">Manual Bet</span>
        </div>
        {formattedBalance && (
          <span className="text-[9px] text-gray-500">
            <span className="text-white font-semibold">{formattedBalance}</span> LINEA
          </span>
        )}
      </div>

      <div className="mb-1.5">
        <label htmlFor="bet-amount-per-tile" className="text-[7px] font-bold uppercase text-gray-600 block mb-0.5 px-0.5">Amount per tile</label>
        <UiInput
          id="bet-amount-per-tile"
          type="text"
          inputMode="decimal"
          value={betAmount}
          onChange={(e) => setBetAmount(e.target.value)}
          disabled={isPending || isRevealing}
          className="h-8 px-2 text-sm font-bold bg-[#0a0a16]"
        />
      </div>

      <div className={`flex justify-between items-center rounded-lg border px-2 py-1 mb-1.5 ${manualInsufficient ? "bg-red-500/8 border-red-500/30" : "bg-black/20 border-white/[0.04]"}`}>
        <span className="text-[8px] font-bold uppercase text-gray-500">Total:</span>
        <span className={`font-bold text-[11px] ${manualInsufficient ? "text-red-400" : "text-violet-400"}`}>{totalBet.toFixed(2)} LINEA</span>
      </div>

      {!liveStateReady && !coldBootDefaults && (
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-violet-500/8 border border-violet-500/20 mb-1.5">
          <span className="text-[8px] font-bold text-violet-300/80 uppercase tracking-wide">
            Syncing live epoch...
          </span>
        </div>
      )}

      {manualInsufficient && (
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/25 mb-1.5">
          <span className="text-[8px] font-bold text-red-400">Insufficient balance</span>
        </div>
      )}

      {lastBet && onRepeatBet && !isAutoMining && (
        <UiButton
          onClick={onRepeatBet}
          disabled={isPending || isRevealing}
          variant="secondary"
          size="sm"
          uppercase
          fullWidth
          className="mb-1 min-h-[2.5rem] px-2 text-center text-[9px] leading-tight whitespace-normal sm:text-[10px]"
        >
          Repeat: {lastBet.tiles.length} tiles x {lastBet.amount} LINEA
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
          "min-h-[2.75rem] px-2.5 text-center text-[10px] leading-tight whitespace-normal sm:text-[11px]",
          isDisabled
            ? "bg-[#13132a] text-gray-600 border-white/[0.04]"
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
        ) : !liveStateReady && !coldBootDefaults ? "SYNCING..." : selectedTilesCount > 0 ? `BET ON ${selectedTilesCount} ${selectedTilesCount === 1 ? "TILE" : "TILES"}` : "SELECT TILES"}
      </UiButton>
    </UiPanel>
  );
});

/* Auto-Miner */

interface AutoMinerProps {
  isAutoMining: boolean;
  isPending: boolean;
  isRevealing: boolean;
  coldBootDefaults?: boolean;
  liveStateReady?: boolean;
  autoMineProgress?: string | null;
  formattedBalance?: string | null;
  /** When bot is running, show these params (from session/restore) so UI matches actual behavior */
  runningParams?: { betStr: string; blocks: number; rounds: number } | null;
  /** Not enough ETH for gas - disable starting the bot */
  lowEthForGas?: boolean;
  onToggle: (betStr: string, blocks: number, rounds: number) => void;
}

export const AutoMinerPanel = React.memo(function AutoMinerPanel({
  isAutoMining,
  isPending,
  isRevealing,
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
    liveStateReady,
    formattedBalance,
    runningParams,
    lowEthForGas,
  });

  const compact = isAutoMining;

  return (
    <UiPanel
      tone="default"
      padding="md"
      className={`shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_20px_rgba(139,92,246,0.06)] animate-slide-up ${compact ? "p-2" : "p-3"}`}
      style={{ animationDelay: "0.25s" }}
    >

      {compact ? (
        /* Compact LIVE view */
        <>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-synced-pulse shadow-[0_0_6px_rgba(239,68,68,0.4)]" />
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                {displayTargets}x{displayBetSize} <span className="text-gray-600">LINEA</span> - {displayCycles} cyc
              </span>
            </div>
            <span className="text-[10px] font-bold text-sky-400 tabular-nums">{totalCost.toFixed(0)} <span className="text-gray-600">LINEA</span></span>
          </div>
        </>
      ) : (
        /* Full edit view */
        <>
          <div className="flex items-center gap-1.5 border-b border-white/[0.06] mb-1.5 pb-1.5">
            <div className="w-1.5 h-3 rounded-full bg-sky-400 animate-synced-pulse shadow-[0_0_8px_rgba(56,189,248,0.4)]" />
            <span className="text-[10px] font-bold text-white uppercase tracking-wider">Auto-Miner</span>
          </div>
          <div className="grid grid-cols-2 gap-1 mb-1">
            <SmallInput label="Bet Size" value={displayBetSize} onChange={setBetSize} disabled={isPending || isRevealing} inputMode="decimal" accent="sky" compact />
            <SmallInput
              label="Targets"
              value={displayTargets}
              onChange={handleTargetsChange}
              disabled={isPending || isRevealing}
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
            disabled={isPending || isRevealing}
            type="number"
            min={1}
            className="mb-1.5"
            accent="sky"
            compact
          />

          <div className={`flex justify-between items-center rounded-lg border px-2 py-1 mb-1.5 ${insufficientBalance ? "bg-red-500/8 border-red-500/30" : "bg-black/20 border-white/[0.04]"}`}>
            <span className="text-[8px] font-bold uppercase text-gray-500">Total Req:</span>
            <span className={`font-bold text-[11px] ${insufficientBalance ? "text-red-400" : "text-sky-400"}`}>{totalCost.toFixed(2)} LINEA</span>
          </div>

          {insufficientBalance && (
            <div className="flex items-start gap-1 px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/25 mb-1.5">
              <svg className="w-3 h-3 text-red-400 shrink-0 mt-px" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
              <span className="text-[8px] font-bold text-red-400 leading-tight">
                Need {totalCost.toFixed(2)}, have {balance?.toFixed(2)} LINEA
              </span>
            </div>
          )}
        </>
      )}

      {isAutoMining && autoMineProgress && (
        compact ? (
          <div className="flex items-center gap-1.5 mb-1.5">
            <div className="w-1 h-1 rounded-full bg-sky-400 animate-synced-pulse shrink-0" />
            <span className="text-[9px] font-bold text-sky-400/70 uppercase tracking-wider truncate">{autoMineProgress}</span>
          </div>
        ) : (
          <div className="relative bg-sky-500/8 rounded-lg border border-sky-500/20 overflow-hidden p-2 mb-2">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-sky-400/5 to-transparent animate-shimmer pointer-events-none" style={{ animation: "shimmer 2s ease-in-out infinite" }} />
            <div className="flex items-center gap-1.5 relative">
              <div className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-synced-pulse shrink-0" />
              <span className="text-[10px] font-bold text-sky-400 uppercase tracking-wider truncate">{autoMineProgress}</span>
            </div>
          </div>
        )
      )}

      {lowEthForGas && !isAutoMining && (
        <div className={`flex items-center gap-1.5 px-2 py-1 ${uiTokens.radius.sm} bg-amber-500/10 border border-amber-500/25 mb-2`}>
          <span className="text-[9px] font-bold text-amber-400 uppercase tracking-wider">
            Top up ETH for gas to start
          </span>
        </div>
      )}
      {!liveStateReady && !coldBootDefaults && (
        <div className={`flex items-center gap-1.5 px-2 py-1 ${uiTokens.radius.sm} bg-sky-500/10 border border-sky-500/20 mb-2`}>
          <span className="text-[9px] font-bold text-sky-300 uppercase tracking-wider">
            Waiting for live epoch sync
          </span>
        </div>
      )}
      <UiButton
        onClick={() => onToggle(betSize, targets, cycles)}
        disabled={isDisabled}
        variant={isAutoMining ? "danger" : "sky"}
        size={compact ? "sm" : "md"}
        fullWidth
        uppercase
        className={cn(
          "min-h-[2.75rem] px-2.5 text-center text-[10px] leading-tight whitespace-normal sm:text-[11px]",
          isAutoMining && "bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/15 hover:shadow-[0_0_16px_rgba(239,68,68,0.15)]",
          !isAutoMining && !isDisabled && "shimmer-btn",
          !isAutoMining && isDisabled && "bg-[#13132a] text-gray-600 border-white/[0.04]",
        )}
      >
        {isAutoMining ? "STOP BOT" : "START BOT"}
      </UiButton>
    </UiPanel>
  );
});

/* Input */

const SmallInput = React.memo(function SmallInput({
  label, value, onChange, disabled, type = "text", inputMode, min, max, className = "", accent = "violet", compact = false,
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
  const inputAccent = accent === "sky"
    ? "border-sky-500/20 focus:border-sky-500/45 focus:shadow-[0_0_12px_rgba(56,189,248,0.12)]"
    : "border-violet-500/20 focus:border-violet-500/45 focus:shadow-[0_0_12px_rgba(139,92,246,0.12)]";

  return (
    <div className={className}>
      <label htmlFor={inputId} className={`text-[8px] font-bold uppercase text-gray-600 block mb-0.5 px-0.5 ${compact ? "pt-0" : "pt-0.5"}`}>{label}</label>
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
          "bg-[#0a0a16] font-bold text-white",
          compact ? "h-7 px-1.5 py-0.5 text-xs" : "h-9 px-2 py-1 text-sm",
          inputAccent,
        )}
      />
    </div>
  );
});
