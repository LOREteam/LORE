"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { formatTime, shortenAddress } from "../lib/utils";
import { WinsTicker } from "./WinsTicker";
import type { RecentWin } from "../hooks/useRecentWins";

const JACKPOT_NOTICE_MS = 30 * 60 * 1000;

export interface JackpotDisplayInfo {
  dailyPool: number;
  weeklyPool: number;
  lastDailyDay: number;
  lastWeeklyWeek: number;
  lastDailyJackpotEpoch: string | null;
  lastWeeklyJackpotEpoch: string | null;
  lastDailyJackpotAmount: number;
  lastWeeklyJackpotAmount: number;
}

interface HeaderProps {
  visualEpoch: string | null;
  isRevealing: boolean;
  timeLeft: number;
  realTotalStaked: number;
  rolloverAmount: number;
  jackpotInfo: JackpotDisplayInfo | null;
  linePath: string;
  chartHasData: boolean;
  embeddedWalletAddress: string | null;
  privyEthBalance: string;
  privyEthBalanceLoading?: boolean;
  privyTokenBalance: string;
  privyTokenBalanceLoading?: boolean;
  onOpenWalletSettings: () => void;
  muted: boolean;
  onToggleMute: () => void;
  recentWins?: RecentWin[];
  showWinsTicker?: boolean;
  epochDurationChange?: {
    current: number | null;
    next: number;
    eta: number | null;
    effectiveFromEpoch: string | null;
  } | null;
}

export const Header = React.memo(function Header({
  visualEpoch,
  isRevealing,
  timeLeft,
  realTotalStaked,
  rolloverAmount,
  jackpotInfo,
  linePath,
  chartHasData,
  embeddedWalletAddress,
  privyEthBalance,
  privyEthBalanceLoading = false,
  privyTokenBalance,
  privyTokenBalanceLoading = false,
  onOpenWalletSettings,
  muted,
  onToggleMute,
  recentWins = [],
  showWinsTicker = false,
  epochDurationChange = null,
}: HeaderProps) {
  const { login, logout, authenticated } = usePrivy();
  // Sticky "Analyzing": avoid switching to Mining during brief 00:00 refreshes
  const [showAnalyzing, setShowAnalyzing] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [dailyAwardVisibleUntil, setDailyAwardVisibleUntil] = useState(0);
  const [weeklyAwardVisibleUntil, setWeeklyAwardVisibleUntil] = useState(0);
  const prevDailyEpochRef = useRef<string | null>(null);
  const prevWeeklyEpochRef = useRef<string | null>(null);

  useEffect(() => {
    if (!jackpotInfo) return;
    const now = Date.now();

    const saveNotice = (key: string, epoch: string, until: number) => {
      try {
        localStorage.setItem(key, JSON.stringify({ epoch, until }));
      } catch {
        // ignore storage errors
      }
    };
    const loadNotice = (key: string): { epoch: string; until: number } | null => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { epoch?: string; until?: number };
        if (!parsed?.epoch || typeof parsed.until !== "number") return null;
        return { epoch: parsed.epoch, until: parsed.until };
      } catch {
        return null;
      }
    };

    const dailyEpoch = jackpotInfo.lastDailyJackpotEpoch ?? null;
    const weeklyEpoch = jackpotInfo.lastWeeklyJackpotEpoch ?? null;

    if (dailyEpoch && prevDailyEpochRef.current === null) {
      const cached = loadNotice("lore:daily-jackpot-notice");
      if (cached?.epoch === dailyEpoch && cached.until > now) {
        setDailyAwardVisibleUntil(cached.until);
      } else {
        setDailyAwardVisibleUntil(0);
        try {
          localStorage.removeItem("lore:daily-jackpot-notice");
        } catch {
          /* ignore */
        }
      }
      prevDailyEpochRef.current = dailyEpoch;
    } else if (dailyEpoch && prevDailyEpochRef.current !== null && dailyEpoch !== prevDailyEpochRef.current) {
      const until = now + JACKPOT_NOTICE_MS;
      setDailyAwardVisibleUntil(until);
      saveNotice("lore:daily-jackpot-notice", dailyEpoch, until);
      prevDailyEpochRef.current = dailyEpoch;
    } else if (!dailyEpoch) {
      setDailyAwardVisibleUntil(0);
      prevDailyEpochRef.current = null;
    }

    if (weeklyEpoch && prevWeeklyEpochRef.current === null) {
      const cached = loadNotice("lore:weekly-jackpot-notice");
      if (cached?.epoch === weeklyEpoch && cached.until > now) {
        setWeeklyAwardVisibleUntil(cached.until);
      } else {
        setWeeklyAwardVisibleUntil(0);
        try {
          localStorage.removeItem("lore:weekly-jackpot-notice");
        } catch {
          /* ignore */
        }
      }
      prevWeeklyEpochRef.current = weeklyEpoch;
    } else if (weeklyEpoch && prevWeeklyEpochRef.current !== null && weeklyEpoch !== prevWeeklyEpochRef.current) {
      const until = now + JACKPOT_NOTICE_MS;
      setWeeklyAwardVisibleUntil(until);
      saveNotice("lore:weekly-jackpot-notice", weeklyEpoch, until);
      prevWeeklyEpochRef.current = weeklyEpoch;
    } else if (!weeklyEpoch) {
      setWeeklyAwardVisibleUntil(0);
      prevWeeklyEpochRef.current = null;
    }
  }, [jackpotInfo]);

  useEffect(() => {
    if (timeLeft === 0 || isRevealing) setShowAnalyzing(true);
    else if (timeLeft > 10 && !isRevealing) setShowAnalyzing(false);
  }, [timeLeft, isRevealing]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const dailyWindow = useMemo(() => {
    const dayMs = 86_400_000;
    const elapsed = nowMs % dayMs;
    const leftMs = dayMs - elapsed;
    const h = Math.floor(leftMs / 3_600_000);
    const m = Math.floor((leftMs % 3_600_000) / 60_000);
    return { pct: (elapsed / dayMs) * 100, leftLabel: `${h}h ${m}m left` };
  }, [nowMs]);

  const weeklyWindow = useMemo(() => {
    const weekMs = 604_800_000;
    const mondayOffsetMs = 3 * 86_400_000; // Monday-based week, same as contract
    const shifted = nowMs + mondayOffsetMs;
    const elapsed = shifted % weekMs;
    const leftMs = weekMs - elapsed;
    const d = Math.floor(leftMs / 86_400_000);
    const h = Math.floor((leftMs % 86_400_000) / 3_600_000);
    return { pct: (elapsed / weekMs) * 100, leftLabel: `${d}d ${h}h left` };
  }, [nowMs]);

  const todayDayIdx = Math.floor(nowMs / 86_400_000);
  const dailyAwardedToday = Boolean(jackpotInfo && jackpotInfo.lastDailyDay === todayDayIdx);
  const weeklyNowIdx = Math.floor((nowMs + 3 * 86_400_000) / 604_800_000);
  const weeklyAwardedThisWeek = Boolean(jackpotInfo && jackpotInfo.lastWeeklyWeek === weeklyNowIdx);

  return (
    <>
    {jackpotInfo && (jackpotInfo.dailyPool > 0 || jackpotInfo.weeklyPool > 0) && (
      <div className="grid grid-cols-2 gap-1.5 mb-1.5 animate-slide-up" style={{ animationDelay: "0s" }}>
        {/* Daily Jackpot */}
        <div className="relative overflow-hidden rounded-lg border border-amber-500/25 bg-[#0d0d1a] group hover:border-amber-500/40 transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-r from-amber-500/[0.04] to-transparent pointer-events-none" />
          {nowMs < dailyAwardVisibleUntil && jackpotInfo.lastDailyJackpotEpoch && (
            <div className="absolute inset-0 z-20 pointer-events-none">
              <div className="absolute inset-0 bg-amber-400/[0.08] animate-pulse" />
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-300/[0.25] to-transparent animate-gradient-x" />
            </div>
          )}
          <div className="relative z-10 px-2.5 py-1.5">
            {nowMs < dailyAwardVisibleUntil && jackpotInfo.lastDailyJackpotEpoch ? (
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm">🎉</span>
                  <span className="text-[12px] font-black text-amber-300 uppercase tracking-[0.16em] animate-pulse">
                    Daily Jackpot Awarded
                  </span>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[12px] font-black text-amber-300 tabular-nums">
                    +{jackpotInfo.lastDailyJackpotAmount.toFixed(2)} LINEA
                  </div>
                  <div className="text-[8px] text-amber-200/75 font-bold uppercase tracking-wider">
                    Epoch #{jackpotInfo.lastDailyJackpotEpoch}
                  </div>
                </div>
              </div>
            ) : (
              dailyAwardedToday && jackpotInfo.lastDailyJackpotEpoch ? (
                <div className="flex items-center justify-between gap-2 min-h-[38px]">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs drop-shadow-[0_0_4px_rgba(245,158,11,0.5)]">🎰</span>
                    <span className="text-[12px] font-black text-amber-300 uppercase tracking-[0.16em]">
                      Next Daily Jackpot
                    </span>
                    <span className="text-[15px] font-black text-amber-400 tabular-nums leading-none">{jackpotInfo.dailyPool.toFixed(2)}</span>
                    <span className="text-[10px] text-amber-400/75 font-black tracking-wide">LINEA</span>
                  </div>
                  <div className="w-[8.5rem] shrink-0 flex flex-col items-end justify-center">
                    <p className="text-[7px] text-emerald-300/80 font-semibold leading-tight text-right">
                      Today JACKPOT was awarded
                    </p>
                    <p className="text-[7px] text-emerald-300/65 mt-0.5 font-semibold leading-tight text-right">
                      (epoch #{jackpotInfo.lastDailyJackpotEpoch})
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs drop-shadow-[0_0_4px_rgba(245,158,11,0.5)]">🎰</span>
                    <span className="text-[12px] font-black text-amber-300 uppercase tracking-[0.16em] animate-pulse">
                      Daily Jackpot
                    </span>
                    <span className="text-[15px] font-black text-amber-400 tabular-nums leading-none">{jackpotInfo.dailyPool.toFixed(2)}</span>
                    <span className="text-[10px] text-amber-400/75 font-black tracking-wide">LINEA</span>
                  </div>
                  <div className="w-[8.5rem] shrink-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[7px] text-amber-500/45 font-semibold uppercase tracking-wide">Window</span>
                      <span className="text-[7px] text-amber-300/70 font-bold tabular-nums">{dailyWindow.leftLabel}</span>
                    </div>
                    <div className="h-1 rounded-full overflow-hidden bg-amber-900/35">
                      <div
                        className="h-full rounded-full transition-all duration-1000 bg-gradient-to-r from-amber-500 via-yellow-400 to-orange-400"
                        style={{ width: `${dailyWindow.pct}%` }}
                      />
                    </div>
                    <p className="text-[7px] mt-0.5 font-semibold text-amber-300/65">
                      Day window progress - random trigger any time
                    </p>
                  </div>
                </div>
              )
            )}
          </div>
        </div>

        {/* Weekly Jackpot */}
        <div className="relative overflow-hidden rounded-lg border border-violet-500/25 bg-[#0d0d1a] group hover:border-violet-500/40 transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-r from-violet-500/[0.04] to-transparent pointer-events-none" />
          {nowMs < weeklyAwardVisibleUntil && jackpotInfo.lastWeeklyJackpotEpoch && (
            <div className="absolute inset-0 z-20 pointer-events-none">
              <div className="absolute inset-0 bg-violet-400/[0.08] animate-pulse" />
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-violet-300/[0.25] to-transparent animate-gradient-x" />
            </div>
          )}
          <div className="relative z-10 px-2.5 py-1.5">
            {nowMs < weeklyAwardVisibleUntil && jackpotInfo.lastWeeklyJackpotEpoch ? (
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm">🎉</span>
                  <span className="text-[12px] font-black text-violet-300 uppercase tracking-[0.16em] animate-pulse">
                    Weekly Jackpot Awarded
                  </span>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[12px] font-black text-violet-300 tabular-nums">
                    +{jackpotInfo.lastWeeklyJackpotAmount.toFixed(2)} LINEA
                  </div>
                  <div className="text-[8px] text-violet-200/75 font-bold uppercase tracking-wider">
                    Epoch #{jackpotInfo.lastWeeklyJackpotEpoch}
                  </div>
                </div>
              </div>
            ) : (
              weeklyAwardedThisWeek && jackpotInfo.lastWeeklyJackpotEpoch ? (
                <div className="flex items-center justify-between gap-2 min-h-[38px]">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs drop-shadow-[0_0_4px_rgba(139,92,246,0.5)]">💎</span>
                    <span className="text-[12px] font-black text-violet-300 uppercase tracking-[0.16em]">
                      Next Weekly Jackpot
                    </span>
                    <span className="text-[15px] font-black text-violet-400 tabular-nums leading-none">{jackpotInfo.weeklyPool.toFixed(2)}</span>
                    <span className="text-[10px] text-violet-400/75 font-black tracking-wide">LINEA</span>
                  </div>
                  <div className="w-[8.5rem] shrink-0 flex flex-col items-end justify-center">
                    <p className="text-[7px] text-emerald-300/80 font-semibold leading-tight text-right">
                      This week JACKPOT was awarded
                    </p>
                    <p className="text-[7px] text-emerald-300/65 mt-0.5 font-semibold leading-tight text-right">
                      (epoch #{jackpotInfo.lastWeeklyJackpotEpoch})
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs drop-shadow-[0_0_4px_rgba(139,92,246,0.5)]">💎</span>
                    <span className="text-[12px] font-black text-violet-300 uppercase tracking-[0.16em] animate-pulse">
                      Weekly Jackpot
                    </span>
                    <span className="text-[15px] font-black text-violet-400 tabular-nums leading-none">{jackpotInfo.weeklyPool.toFixed(2)}</span>
                    <span className="text-[10px] text-violet-400/75 font-black tracking-wide">LINEA</span>
                  </div>
                  <div className="w-[8.5rem] shrink-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[7px] text-violet-500/45 font-semibold uppercase tracking-wide">Window</span>
                      <span className="text-[7px] text-violet-300/70 font-bold tabular-nums">{weeklyWindow.leftLabel}</span>
                    </div>
                    <div className="h-1 rounded-full overflow-hidden bg-violet-900/35">
                      <div
                        className="h-full rounded-full transition-all duration-1000 bg-gradient-to-r from-violet-500 via-purple-400 to-fuchsia-400"
                        style={{ width: `${weeklyWindow.pct}%` }}
                      />
                    </div>
                    <p className="text-[7px] mt-0.5 font-semibold text-violet-300/65">
                      Week window progress - random trigger any time
                    </p>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      </div>
    )}

    <header className="grid grid-cols-1 min-[900px]:grid-cols-12 gap-2 mb-2">
      {/* ═══ Epoch + WinsTicker ═══ */}
      <div className="min-[900px]:col-span-4 flex flex-col rounded-xl bg-[#0d0d1a] border border-violet-500/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_20px_rgba(139,92,246,0.06)] animate-slide-up overflow-hidden" style={{ animationDelay: "0.05s" }}>
        <div className="grid grid-cols-[7rem_1fr_5.5rem] items-stretch shrink-0">
        {/* LEFT – Epoch */}
        <div className="flex flex-col items-center justify-center py-1.5 px-1">
          <div className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-1">Epoch</div>
          <div className="rounded-md overflow-visible w-full max-w-[6.25rem] mx-auto">
            <div
              className={`px-2.5 h-[1.75rem] rounded-md border flex items-center justify-center gap-1.5 transition-colors duration-200 ${
                isRevealing
                  ? "bg-amber-500/15 border-amber-500/40 text-amber-400 reveal-glow"
                  : "bg-violet-500/10 border-violet-500/30 text-violet-400"
              }`}
            >
            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isRevealing ? "bg-amber-400 reveal-dot" : "bg-emerald-400 animate-synced-pulse"}`} />
            <span className={`text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${isRevealing ? "reveal-text-blink" : ""}`}>
              {isRevealing ? "REVEALING" : visualEpoch ? `#${visualEpoch}` : "SYNC"}
            </span>
          </div>
          </div>
        </div>

        {/* CENTER – Timer (expands to fill, content fixed) */}
        <div className="flex flex-col items-center justify-center py-1.5 border-x border-white/[0.06]">
          <div className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-1">Timer</div>
          <div
            className={`w-[7rem] h-[2rem] flex items-center justify-center font-mono text-[1.75rem] font-black tracking-tight leading-none tabular-nums transition-colors duration-300 ${
              isRevealing
                ? "text-amber-400 drop-shadow-[0_0_12px_rgba(251,191,36,0.5)]"
                : timeLeft <= 10
                  ? "text-red-400 drop-shadow-[0_0_8px_rgba(239,68,68,0.4)]"
                  : "text-white"
            }`}
          >
            {formatTime(timeLeft)}
          </div>
        </div>

        {/* RIGHT – Status */}
        <div className="flex flex-col items-center justify-center py-1.5">
          {showAnalyzing ? (
            <>
              <div className="flex items-end gap-[3px] h-[1.25rem] mb-1 [&>span]:origin-bottom">
                <span className="w-[3px] bg-amber-400/90 rounded-full animate-[bar-1_0.6s_ease-in-out_infinite]" style={{ height: "40%" }} />
                <span className="w-[3px] bg-amber-400 rounded-full animate-[bar-2_0.6s_ease-in-out_infinite]" style={{ height: "70%", animationDelay: "0.1s" }} />
                <span className="w-[3px] bg-amber-400/90 rounded-full animate-[bar-3_0.6s_ease-in-out_infinite]" style={{ height: "100%", animationDelay: "0.2s" }} />
                <span className="w-[3px] bg-amber-400/70 rounded-full animate-[bar-2_0.6s_ease-in-out_infinite]" style={{ height: "55%", animationDelay: "0.15s" }} />
                <span className="w-[3px] bg-amber-400/90 rounded-full animate-[bar-1_0.6s_ease-in-out_infinite]" style={{ height: "25%", animationDelay: "0.05s" }} />
              </div>
              <span className="text-[10px] font-bold text-amber-400/80 uppercase tracking-widest">Analyzing</span>
            </>
          ) : (
            <div className="flex flex-col items-center mt-1">
              <div className="animate-float" style={{ animationDuration: "2.5s" }}>
                <PickaxeIcon />
              </div>
              <span className="text-[10px] font-bold text-violet-400/50 uppercase tracking-widest mt-0.5">Mining</span>
            </div>
          )}
        </div>
        </div>

        {epochDurationChange && (
          <div className="border-t border-white/[0.06] px-2 py-1 bg-amber-500/[0.04]">
            <div className="text-[9px] text-amber-300/90 font-bold uppercase tracking-wider text-center">
              Duration scheduled: {epochDurationChange.current ?? "?"}s {"->"} {epochDurationChange.next}s
              {epochDurationChange.effectiveFromEpoch ? ` from #${epochDurationChange.effectiveFromEpoch}` : ""}
              {epochDurationChange.eta ? ` (ETA ${new Date(epochDurationChange.eta * 1000).toLocaleTimeString()})` : ""}
            </div>
          </div>
        )}

        {showWinsTicker && (
          <div className="border-t border-white/[0.06] flex-1 min-h-0 flex items-center">
            <WinsTicker wins={recentWins} />
          </div>
        )}
      </div>

      {/* ═══ Pool chart ═══ */}
      <div className="min-[900px]:col-span-5 relative rounded-xl bg-[#080812] border border-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] overflow-hidden min-h-[72px] animate-slide-up" style={{ animationDelay: "0.1s" }}>
        <div className="absolute top-2.5 left-3 z-20 pointer-events-none">
          <div className="text-[9px] uppercase font-bold text-gray-500 tracking-wider flex items-center gap-1.5 mb-0.5">
            Total Pool
            {rolloverAmount > 0 && (
              <span className="bg-emerald-500/15 text-emerald-400 px-1 py-px rounded text-[7px] border border-emerald-500/25">
                +{rolloverAmount.toFixed(2)} rollover
              </span>
            )}
          </div>
          <div className="text-lg font-black text-white leading-tight">
            {realTotalStaked.toFixed(2)} <span className="text-violet-400 text-xs font-bold">LINEA</span>
          </div>
        </div>

        {/* Background grid */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
          <defs>
            <pattern id="gridDots" width="16" height="16" patternUnits="userSpaceOnUse">
              <circle cx="8" cy="8" r="0.4" fill="rgba(139,92,246,0.15)" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#gridDots)" />
          {/* Horizontal guide lines */}
          <line x1="0" y1="33%" x2="100%" y2="33%" stroke="rgba(139,92,246,0.06)" strokeWidth="1" strokeDasharray="4 8" />
          <line x1="0" y1="66%" x2="100%" y2="66%" stroke="rgba(139,92,246,0.06)" strokeWidth="1" strokeDasharray="4 8" />
        </svg>

        {/* Main chart */}
        <div className="absolute bottom-0 left-0 w-full h-[60%]">
          {chartHasData && (
            <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              <defs>
                <linearGradient id="chartStroke" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#06b6d4" />
                  <stop offset="50%" stopColor="#8b5cf6" />
                  <stop offset="100%" stopColor="#c084fc" />
                </linearGradient>
                <linearGradient id="chartFill" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.25" />
                  <stop offset="50%" stopColor="#6d28d9" stopOpacity="0.08" />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
                </linearGradient>
                <filter id="lineGlow">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                <radialGradient id="endpointGlow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.6" />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
                </radialGradient>
              </defs>

              {/* Area fill */}
              <path d={`${linePath} L 100,100 L 0,100 Z`} fill="url(#chartFill)" className="transition-all duration-700" />

              {/* Blurred glow */}
              <path d={linePath} fill="none" stroke="url(#chartStroke)" strokeWidth="5" strokeLinecap="round" vectorEffect="non-scaling-stroke" className="transition-all duration-700" opacity="0.12" />

              {/* Main line */}
              <path d={linePath} fill="none" stroke="url(#chartStroke)" strokeWidth="1.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" className="transition-all duration-700" filter="url(#lineGlow)" />

            </svg>
          )}
        </div>

        {/* Bottom gradient border */}
        <div className="absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-violet-500/40 to-transparent" />

        <button
          onClick={onToggleMute}
          className="absolute top-2 right-2 z-20 w-6 h-6 rounded-full bg-black/40 border border-white/10 flex items-center justify-center text-gray-500 hover:text-violet-400 hover:border-violet-500/30 transition-all"
          title={muted ? "Unmute sounds" : "Mute sounds"}
        >
          {muted ? (
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
            </svg>
          ) : (
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            </svg>
          )}
        </button>
      </div>

      {/* ═══ Wallet - no inner spacing, content flush to border ═══ */}
      <div className="min-[900px]:col-span-3 min-w-0 flex flex-col rounded-xl border border-violet-500/10 bg-[#0d0d1a] shadow-[0_0_16px_rgba(139,92,246,0.05)] overflow-hidden animate-slide-up" style={{ animationDelay: "0.15s" }}>
        {!authenticated ? (
          <button
            onClick={login}
            className="w-full h-full min-h-[72px] px-4 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold transition-all text-[10px] uppercase tracking-widest shadow-lg shadow-violet-500/20 shimmer-btn active:scale-[0.98]"
          >
            Login / Connect
          </button>
        ) : embeddedWalletAddress ? (
          /* Embedded Privy wallet is created - show its address and balances */
          <>
            <div className="flex gap-1 p-1.5 border-b border-violet-500/15 bg-[#0d0d1a]">
              <button
                onClick={onOpenWalletSettings}
                className="flex-[2] min-w-0 px-2 py-1.5 rounded-md border border-violet-500/30 bg-violet-500/[0.08] text-violet-300 hover:bg-violet-500/15 text-[10px] font-bold uppercase tracking-widest transition-all duration-200"
              >
                Settings
              </button>
              <button
                onClick={logout}
                className="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-white/10 bg-transparent text-gray-500 hover:bg-red-500/10 hover:border-red-500/20 hover:text-red-400 text-[9px] font-bold uppercase tracking-widest transition-all duration-200"
                title="Log out (use carefully)"
              >
                Out
              </button>
            </div>

            <div className="flex-1 min-h-0 px-3 py-1.5 bg-violet-500/[0.06] flex flex-col gap-0.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Privy</span>
                <span className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1 text-emerald-400">
                  <span className="w-1 h-1 rounded-full bg-emerald-400 animate-synced-pulse" />
                  Active
                </span>
              </div>
              <button
                onClick={() => { if (embeddedWalletAddress) navigator.clipboard.writeText(embeddedWalletAddress); }}
                className="text-[11px] font-mono font-bold text-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.2)] leading-tight hover:text-emerald-300 transition-colors flex items-center gap-1 group"
                title="Copy address"
              >
                {shortenAddress(embeddedWalletAddress)}
                <svg className="w-2.5 h-2.5 text-emerald-400/40 group-hover:text-emerald-300 transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
              </button>
              <div className="flex items-center justify-between text-[11px] leading-tight">
                <span className="text-gray-400">
                  {privyEthBalanceLoading ? "..." : privyEthBalance}<span className="text-gray-500 font-medium"> ETH</span>
                </span>
                <span className="text-white font-bold">
                  {privyTokenBalanceLoading ? "..." : privyTokenBalance}<span className="text-gray-500 font-medium"> LINEA</span>
                </span>
              </div>
            </div>
          </>
        ) : (
          /* Embedded wallet is not created yet - do not show main wallet under Privy */
          <>
            <div className="flex gap-1 p-1.5 border-b border-violet-500/15 bg-[#0d0d1a]">
              <button
                onClick={onOpenWalletSettings}
                className="flex-[2] min-w-0 px-2 py-1.5 rounded-md border border-violet-500/30 bg-violet-500/[0.08] text-violet-300 hover:bg-violet-500/15 text-[10px] font-bold uppercase tracking-widest transition-all duration-200"
              >
                Settings
              </button>
              <button
                onClick={logout}
                className="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-white/10 bg-transparent text-gray-500 hover:bg-red-500/10 hover:border-red-500/20 hover:text-red-400 text-[9px] font-bold uppercase tracking-widest transition-all duration-200"
                title="Log out (use carefully)"
              >
                Out
              </button>
            </div>

            <div className="flex-1 min-h-0 px-3 py-1.5 bg-violet-500/[0.06] flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Privy</span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400/90">Not created</span>
              </div>
              <p className="text-[10px] text-gray-500 leading-tight">
                Create embedded wallet in Settings to play and receive rewards.
              </p>
            </div>
          </>
        )}
      </div>
    </header>
    </>
  );
});

function PickaxeIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="-56.32 -56.32 624.64 624.64"
      className={`w-8 h-8 ${className}`}
      transform="scale(-1,1)"
    >
      <path fill="#7E68A8" d="M355.621,157.335c66.788,66.788,112.393,144.29,134.835,220.392 c23.099-96.551-3.012-202.476-78.357-277.82C336.423,24.23,229.894-1.79,133,21.846C209.817,44.05,288.182,89.894,355.621,157.335z" />
      <path fill="#7E68A8" d="M412.099,99.907c9.605,9.605,18.406,19.709,26.41,30.227l39.877-39.877L421.75,33.62l-39.874,39.876 C392.39,81.5,402.494,90.301,412.099,99.907z" />
      <path fill="#7E68A8" d="M355.621,157.335c-9.718-9.718-19.667-18.971-29.801-27.785l-36.96,36.96l56.637,56.637 l37.024-37.024C373.973,176.339,365.013,166.727,355.621,157.335z" />
      <polygon fill="#7E68A8" points="298.194,175.844 13.429,460.608 51.399,498.576 184.762,365.212 241.241,308.734 336.163,213.812" />
      <path fill="#000000" d="M501.147,227.339c-9.342-34.313-24.652-66.75-45.043-95.814l31.774-31.774c5.242-5.242,5.242-13.742,0-18.985 l-56.635-56.635c-5.243-5.241-13.741-5.241-18.985,0l-31.774,31.774c-29.252-20.524-61.916-35.9-96.479-45.226 C233.736-2.892,180.421-3.541,129.818,8.806c-5.909,1.44-10.111,6.677-10.238,12.758c-0.129,6.082,3.85,11.491,9.693,13.178 c62.217,17.983,122.508,50.694,176.773,95.597l-26.677,26.679c-5.188,5.188-5.234,13.564-0.15,18.819L3.937,451.116 c-2.517,2.518-3.932,5.932-3.932,9.492s1.415,6.974,3.932,9.492l37.97,37.968c2.622,2.62,6.057,3.932,9.492,3.932 s6.872-1.312,9.492-3.932l133.365-133.365c5.242-5.242,5.242-13.742,0-18.985c-5.242-5.241-13.742-5.241-18.985,0L51.399,479.59 l-18.985-18.985l265.78-265.779l18.984,18.984l-85.428,85.43c-5.242,5.242-5.242,13.742,0,18.985c5.242,5.241,13.743,5.241,18.984,0 l85.438-85.438c2.6,2.514,5.96,3.78,9.326,3.78c3.437,0,6.87-1.312,9.492-3.932l26.765-26.765 c44.798,53.886,77.59,113.805,95.827,175.651c1.687,5.721,6.938,9.628,12.872,9.628c0.118,0,0.235-0.001,0.353-0.004 c6.078-0.158,11.292-4.383,12.707-10.296C515.576,330.423,514.758,277.339,501.147,227.339z M401.96,72.394l19.79-19.788 l37.651,37.651l-19.79,19.79c-0.259-0.307-0.526-0.607-0.785-0.913c-0.709-0.836-1.428-1.665-2.146-2.494 c-0.811-0.934-1.623-1.865-2.445-2.791c-0.949-1.069-1.904-2.134-2.867-3.191c-0.47-0.514-0.944-1.026-1.416-1.537 c-0.958-1.036-1.924-2.066-2.897-3.089c-0.424-0.446-0.846-0.893-1.273-1.336c-1.384-1.439-2.777-2.869-4.191-4.282 c-1.42-1.42-2.858-2.822-4.304-4.212c-0.43-0.413-0.863-0.822-1.295-1.232c-1.039-0.987-2.083-1.968-3.136-2.94 c-0.506-0.468-1.011-0.936-1.52-1.4c-1.039-0.948-2.086-1.886-3.137-2.819c-0.953-0.847-1.913-1.686-2.877-2.521 c-0.823-0.713-1.644-1.427-2.475-2.13C402.552,72.906,402.259,72.645,401.96,72.394z M364.058,185.6l-18.561,18.561l-37.651-37.651 l18.518-18.518c3.198,2.905,6.358,5.847,9.479,8.813c0.64,0.609,1.278,1.223,1.917,1.836c1.027,0.984,2.053,1.969,3.069,2.959 c1.775,1.73,3.544,3.469,5.302,5.227c1.724,1.724,3.43,3.461,5.127,5.2c0.871,0.894,1.738,1.795,2.606,2.698 c0.673,0.698,1.342,1.397,2.01,2.098C358.622,179.712,361.355,182.639,364.058,185.6z M484.921,322.688 c-25.42-59.845-63.615-116.792-112.384-167.279c-0.283-0.293-0.565-0.585-0.848-0.877c-2.173-2.242-4.36-4.474-6.575-6.689 c-2.326-2.326-4.672-4.621-7.026-6.901c-0.232-0.224-0.463-0.448-0.697-0.673C306.308,90.956,248.686,52.502,188.135,27.127 c66.634-3.757,131.942,16.168,185.306,56.794c0.103,0.085,0.197,0.177,0.303,0.258c4.866,3.704,9.63,7.598,14.278,11.639 c0.405,0.353,0.811,0.709,1.215,1.065c1.836,1.615,3.647,3.258,5.442,4.92c0.507,0.47,1.019,0.933,1.522,1.407 c2.167,2.035,4.309,4.096,6.406,6.194c2.091,2.091,4.147,4.227,6.178,6.39c0.478,0.509,0.946,1.024,1.42,1.536 c1.655,1.788,3.292,3.592,4.901,5.423c0.36,0.408,0.72,0.818,1.077,1.227c4.042,4.65,7.939,9.418,11.647,14.29 c0.064,0.085,0.14,0.158,0.205,0.242C468.411,191.536,488.37,256.43,484.921,322.688z" />
      <path fill="#000000" d="M225.395,331.839c-0.336-0.819-0.752-1.596-1.235-2.321c-0.483-0.74-1.047-1.424-1.665-2.042s-1.302-1.181-2.04-1.665 c-0.725-0.482-1.503-0.899-2.322-1.235c-0.805-0.336-1.651-0.589-2.51-0.764c-1.732-0.35-3.517-0.35-5.249,0 c-0.846,0.175-1.691,0.428-2.51,0.764c-0.805,0.336-1.584,0.753-2.309,1.235c-0.738,0.483-1.423,1.047-2.04,1.665 c-0.631,0.618-1.181,1.302-1.678,2.042c-0.483,0.725-0.899,1.502-1.235,2.321c-0.336,0.805-0.591,1.651-0.765,2.51 c-0.175,0.859-0.255,1.745-0.255,2.618c0,0.871,0.081,1.759,0.255,2.631c0.175,0.859,0.43,1.705,0.765,2.51 c0.336,0.805,0.752,1.584,1.235,2.321c0.497,0.725,1.047,1.41,1.678,2.042c0.618,0.617,1.302,1.181,2.04,1.663 c0.725,0.483,1.503,0.901,2.309,1.236c0.819,0.336,1.665,0.589,2.51,0.764c0.873,0.175,1.759,0.268,2.631,0.268 c0.873,0,1.759-0.094,2.618-0.268s1.705-0.428,2.51-0.764c0.819-0.336,1.597-0.753,2.322-1.236c0.738-0.482,1.423-1.046,2.04-1.663 c0.618-0.632,1.181-1.316,1.665-2.042c0.483-0.738,0.899-1.517,1.235-2.321c0.336-0.807,0.591-1.651,0.765-2.51 c0.175-0.873,0.268-1.745,0.268-2.631c0-0.873-0.094-1.76-0.268-2.618C225.986,333.491,225.731,332.644,225.395,331.839z" />
    </svg>
  );
}
