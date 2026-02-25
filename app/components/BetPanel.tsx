"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import { GRID_SIZE } from "../lib/constants";
import { safeParseFloat } from "../lib/utils";
import { processingQuotes } from "../lib/loreTexts";
import { LoreText } from "./LoreText";

const AUTOMINER_INPUTS_KEY = "lineaore:auto-miner-inputs:v1";
const MANUAL_BET_AMOUNT_KEY = "lineaore:manual-bet-amount:v1";

/* ═══ Manual Bet ═══ */

interface ManualBetProps {
  formattedBalance: string | null;
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
  selectedTilesCount,
  isPending,
  isRevealing,
  isAutoMining,
  onMine,
  lastBet,
  onRepeatBet,
}: ManualBetProps) {
  const [betAmount, setBetAmount] = useState("10.0");
  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(MANUAL_BET_AMOUNT_KEY) : null;
      if (raw != null) {
        const v = String(raw).trim();
        if (v && !Number.isNaN(Number(v))) setBetAmount(v);
      }
    } catch (_) {}
  }, []);
  useEffect(() => {
    try {
      if (typeof window !== "undefined" && betAmount != null) window.localStorage.setItem(MANUAL_BET_AMOUNT_KEY, betAmount);
    } catch (_) {}
  }, [betAmount]);
  const totalBet = useMemo(() => safeParseFloat(betAmount) * selectedTilesCount, [betAmount, selectedTilesCount]);
  const balance = formattedBalance ? safeParseFloat(formattedBalance) : null;
  const manualInsufficient = balance !== null && totalBet > 0 && totalBet > balance;
  const isDisabled = isPending || selectedTilesCount === 0 || isRevealing || isAutoMining || manualInsufficient;
  if (isAutoMining) {
    return (
      <div className="p-2 rounded-xl bg-[#0d0d1a] border border-violet-500/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] animate-slide-up" style={{ animationDelay: "0.2s" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-3.5 bg-emerald-400/40 rounded-full" />
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Manual Bet</span>
          </div>
          {formattedBalance && (
            <span className="text-[10px] text-gray-500">{formattedBalance} LINEA</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-2 rounded-xl bg-[#0d0d1a] border border-violet-500/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_20px_rgba(139,92,246,0.06)] animate-slide-up" style={{ animationDelay: "0.2s" }}>
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

      <div className="bg-[#0a0a16] p-0.5 rounded-lg border border-violet-500/15 focus-within:border-violet-500/50 transition-all duration-200 mb-1.5">
        <label className="text-[7px] font-bold uppercase text-gray-600 block px-1.5 pt-0.5">Amount per tile</label>
        <input
          type="text"
          inputMode="decimal"
          value={betAmount}
          onChange={(e) => setBetAmount(e.target.value)}
          disabled={isPending || isRevealing}
          className="w-full px-1.5 py-0.5 bg-transparent text-sm font-bold text-white outline-none"
        />
      </div>

      <div className={`flex justify-between items-center rounded-lg border px-2 py-1 mb-1.5 ${manualInsufficient ? "bg-red-500/8 border-red-500/30" : "bg-black/20 border-white/[0.04]"}`}>
        <span className="text-[8px] font-bold uppercase text-gray-500">Total:</span>
        <span className={`font-bold text-[11px] ${manualInsufficient ? "text-red-400" : "text-violet-400"}`}>{totalBet.toFixed(2)} LINEA</span>
      </div>

      {manualInsufficient && (
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/25 mb-1.5">
          <span className="text-[8px] font-bold text-red-400">Insufficient balance</span>
        </div>
      )}

      {lastBet && onRepeatBet && !isAutoMining && (
        <button
          onClick={onRepeatBet}
          disabled={isPending || isRevealing}
          className="w-full py-1.5 mb-1 rounded-lg border border-violet-500/20 bg-violet-500/[0.06] text-violet-400 text-[10px] font-bold uppercase tracking-wider hover:bg-violet-500/10 transition-all disabled:opacity-40"
        >
          ↻ Repeat: {lastBet.tiles.length} tiles × {lastBet.amount} LINEA
        </button>
      )}

      <button
        onClick={() => onMine(betAmount)}
        disabled={isDisabled}
        className={`w-full py-2 rounded-lg font-bold uppercase tracking-wider text-[11px] transition-all duration-200 ${
          isDisabled
            ? "bg-[#13132a] text-gray-600 border border-white/[0.04]"
            : "text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 shadow-lg shadow-violet-600/20 hover:shadow-violet-500/30 active:scale-[0.97] shimmer-btn"
        }`}
      >
        {isPending ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <LoreText items={processingQuotes} />
          </span>
        ) : selectedTilesCount > 0 ? `⛏ BET ON ${selectedTilesCount} TILES` : "SELECT TILES"}
      </button>
    </div>
  );
});

/* ═══ Auto-Miner ═══ */

interface AutoMinerProps {
  isAutoMining: boolean;
  isPending: boolean;
  isRevealing: boolean;
  autoMineProgress?: string | null;
  formattedBalance?: string | null;
  /** When bot is running, show these params (from session/restore) so UI matches actual behavior */
  runningParams?: { betStr: string; blocks: number; rounds: number } | null;
  /** Not enough ETH for gas – disable starting the bot */
  lowEthForGas?: boolean;
  onToggle: (betStr: string, blocks: number, rounds: number) => void;
}

export const AutoMinerPanel = React.memo(function AutoMinerPanel({
  isAutoMining,
  isPending,
  isRevealing,
  autoMineProgress,
  formattedBalance,
  runningParams,
  lowEthForGas,
  onToggle,
}: AutoMinerProps) {
  const [betSize, setBetSize] = useState("1.0");
  const [targets, setTargets] = useState(3);
  const [cycles, setCycles] = useState(5);

  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(AUTOMINER_INPUTS_KEY) : null;
      if (raw != null) {
        const data = JSON.parse(raw);
        if (data && typeof data === "object") {
          if (typeof data.betSize === "string" && data.betSize && !Number.isNaN(Number(data.betSize))) setBetSize(data.betSize);
          if (typeof data.targets === "number" && data.targets >= 1 && data.targets <= GRID_SIZE) setTargets(data.targets);
          if (typeof data.cycles === "number" && data.cycles >= 1) setCycles(data.cycles);
        }
      }
    } catch (_) {}
  }, []);
  useEffect(() => {
    try {
      if (typeof window !== "undefined")
        window.localStorage.setItem(AUTOMINER_INPUTS_KEY, JSON.stringify({ betSize, targets, cycles }));
    } catch (_) {}
  }, [betSize, targets, cycles]);

  // When bot runs with restored/session params, sync form so displayed values match and persist after stop
  useEffect(() => {
    if (isAutoMining && runningParams) {
      setBetSize(runningParams.betStr);
      setTargets(runningParams.blocks);
      setCycles(runningParams.rounds);
    }
  }, [isAutoMining, runningParams]);

  const displayBetSize = isAutoMining && runningParams ? runningParams.betStr : betSize;
  const displayTargets = isAutoMining && runningParams ? runningParams.blocks : targets;
  const displayCycles = isAutoMining && runningParams ? runningParams.rounds : cycles;

  const handleTargetsChange = useCallback((v: string) => {
    const n = Number(v);
    if (Number.isFinite(n)) setTargets(Math.min(GRID_SIZE, Math.max(1, Math.floor(n))));
  }, []);

  const handleCyclesChange = useCallback((v: string) => {
    const n = Number(v);
    if (Number.isFinite(n)) setCycles(Math.max(1, Math.floor(n)));
  }, []);

  const totalCost = useMemo(() => {
    const t = Number.isFinite(displayTargets) ? Math.max(1, displayTargets) : 1;
    const c = Number.isFinite(displayCycles) ? Math.max(1, displayCycles) : 1;
    return safeParseFloat(displayBetSize) * t * c;
  }, [displayBetSize, displayTargets, displayCycles]);
  const balance = formattedBalance ? safeParseFloat(formattedBalance) : null;
  const insufficientBalance = balance !== null && totalCost > balance;
  const isDisabled =
    (isPending && !isAutoMining) ||
    isRevealing ||
    (insufficientBalance && !isAutoMining) ||
    (lowEthForGas && !isAutoMining);

  const compact = isAutoMining;

  return (
    <div className={`rounded-xl bg-[#0d0d1a] border border-violet-500/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_20px_rgba(139,92,246,0.06)] animate-slide-up ${compact ? "p-2" : "p-3"}`} style={{ animationDelay: "0.25s" }}>

      {compact ? (
        /* ── Compact LIVE view ── */
        <>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-synced-pulse shadow-[0_0_6px_rgba(239,68,68,0.4)]" />
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                {displayTargets}×{displayBetSize} <span className="text-gray-600">LINEA</span> · {displayCycles} cyc
              </span>
            </div>
            <span className="text-[10px] font-bold text-sky-400 tabular-nums">{totalCost.toFixed(0)} <span className="text-gray-600">LINEA</span></span>
          </div>
        </>
      ) : (
        /* ── Full edit view ── */
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
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/25 mb-2">
          <span className="text-[9px] font-bold text-amber-400 uppercase tracking-wider">
            Top up ETH for gas to start
          </span>
        </div>
      )}
      <button
        onClick={() => onToggle(betSize, targets, cycles)}
        disabled={isDisabled}
        className={`w-full rounded-lg font-bold uppercase tracking-wider text-[11px] transition-all duration-200 border ${
          compact ? "py-1.5" : "py-2"
        } ${
          isAutoMining
            ? "bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/15 hover:shadow-[0_0_16px_rgba(239,68,68,0.15)]"
            : isDisabled
              ? "bg-[#13132a] text-gray-600 border-white/[0.04] cursor-not-allowed"
              : "bg-sky-500/10 border-sky-500/30 text-sky-400 hover:bg-sky-500/15 shadow-lg shadow-sky-500/10 hover:shadow-sky-500/20 shimmer-btn"
        }`}
      >
        {isAutoMining ? "⏹ STOP BOT" : "▶ START BOT"}
      </button>
    </div>
  );
});

/* ═══ Input ═══ */

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
  const focusColor = accent === "sky" ? "focus-within:border-sky-500/50 focus-within:shadow-[0_0_12px_rgba(56,189,248,0.1)]" : "focus-within:border-violet-500/50 focus-within:shadow-[0_0_12px_rgba(139,92,246,0.1)]";

  return (
    <div className={`bg-[#0a0a16] rounded-lg border border-violet-500/15 transition-all duration-200 ${focusColor} ${compact ? "p-0.5" : "p-1"} ${className}`}>
      <label className={`text-[8px] font-bold uppercase text-gray-600 block px-1.5 ${compact ? "pt-0.5" : "pt-1"}`}>{label}</label>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        min={min}
        max={max}
        className={`w-full bg-transparent font-bold text-white outline-none px-1.5 ${compact ? "py-0.5 text-xs" : "py-1 text-sm"}`}
      />
    </div>
  );
});
