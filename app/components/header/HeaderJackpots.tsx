"use client";

import React from "react";
import Image from "next/image";
import type { JackpotDisplayInfo } from "./types";

interface JackpotWindowInfo {
  pct: number;
  leftLabel: string;
}

interface HeaderJackpotsProps {
  jackpotInfo: JackpotDisplayInfo;
  nowMs: number;
  dailyAwardVisibleUntil: number;
  weeklyAwardVisibleUntil: number;
  dailyAwardedToday: boolean;
  weeklyAwardedThisWeek: boolean;
  dailyWindow: JackpotWindowInfo;
  weeklyWindow: JackpotWindowInfo;
}

interface JackpotCardProps {
  accent: "amber" | "violet";
  awardedCopy: string;
  nextCopy: string;
  poolAmount: number;
  awardedAmount: number;
  awardedEpoch: string | null;
  awardedThisWindow: boolean;
  visibleUntil: number;
  nowMs: number;
  icon: React.ReactNode;
  awardedMessage: string;
  window: JackpotWindowInfo;
  progressCopy: string;
}

function JackpotCard({
  accent,
  awardedCopy,
  nextCopy,
  poolAmount,
  awardedAmount,
  awardedEpoch,
  awardedThisWindow,
  visibleUntil,
  nowMs,
  icon,
  awardedMessage,
  window,
  progressCopy,
}: JackpotCardProps) {
  const isAmber = accent === "amber";
  const borderClass = isAmber ? "border-amber-500/25 hover:border-amber-500/40" : "border-violet-500/25 hover:border-violet-500/40";
  const glowClass = isAmber ? "from-amber-500/[0.04]" : "from-violet-500/[0.04]";
  const overlayPulseClass = isAmber ? "bg-amber-400/[0.08]" : "bg-violet-400/[0.08]";
  const overlaySweepClass = isAmber ? "via-amber-300/[0.25]" : "via-violet-300/[0.25]";
  const titleClass = isAmber ? "text-amber-300" : "text-violet-300";
  const amountClass = isAmber ? "text-amber-400" : "text-violet-400";
  const amountSubtleClass = isAmber ? "text-amber-400/75" : "text-violet-400/75";
  const windowLabelClass = isAmber ? "text-amber-500/45" : "text-violet-500/45";
  const windowValueClass = isAmber ? "text-amber-300/70" : "text-violet-300/70";
  const windowTrackClass = isAmber ? "bg-amber-900/35" : "bg-violet-900/35";
  const windowFillClass = isAmber
    ? "bg-gradient-to-r from-amber-500 via-yellow-400 to-orange-400"
    : "bg-gradient-to-r from-violet-500 via-purple-400 to-fuchsia-400";
  const bodyClass = isAmber ? "text-amber-300/65" : "text-violet-300/65";

  return (
    <div className={`relative overflow-hidden rounded-lg border bg-[#0d0d1a] group transition-all duration-300 ${borderClass}`}>
      <div className={`absolute inset-0 bg-gradient-to-r ${glowClass} to-transparent pointer-events-none`} />
      {nowMs < visibleUntil && awardedEpoch && (
        <div className="absolute inset-0 z-20 pointer-events-none">
          <div className={`absolute inset-0 ${overlayPulseClass} animate-pulse`} />
          <div className={`absolute inset-0 bg-gradient-to-r from-transparent ${overlaySweepClass} to-transparent animate-gradient-x`} />
        </div>
      )}
      <div className="relative z-10 flex min-h-[56px] items-center px-2 py-1 sm:px-2.5">
        {nowMs < visibleUntil && awardedEpoch ? (
          <div className="flex w-full items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
              <div className="shrink-0">{icon}</div>
              <span className={`break-words text-[10px] font-black uppercase leading-tight tracking-[0.05em] animate-pulse sm:text-[12px] sm:tracking-[0.1em] ${titleClass}`}>
                {awardedCopy}
              </span>
            </div>
            <div className="shrink-0 text-right">
              <div className={`lore-nums text-[11px] sm:text-[12px] font-black tabular-nums leading-none ${titleClass}`}>
                +{awardedAmount.toFixed(2)} LINEA
              </div>
              <div className={`lore-nums mt-1 text-[8px] font-bold uppercase leading-none tracking-[0.08em] ${bodyClass}`}>
                Epoch #{awardedEpoch}
              </div>
            </div>
          </div>
        ) : awardedThisWindow && awardedEpoch ? (
          <div className="flex w-full items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
              <div className="shrink-0">{icon}</div>
              <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span className={`break-words text-[10px] font-black uppercase leading-tight tracking-[0.05em] sm:text-[12px] sm:tracking-[0.1em] ${titleClass}`}>
                {nextCopy}
              </span>
              <span className={`lore-nums text-[13px] sm:text-[15px] font-black tabular-nums leading-none ${amountClass}`}>{poolAmount.toFixed(2)}</span>
              <span className={`text-[9px] sm:text-[10px] font-black tracking-wide ${amountSubtleClass}`}>LINEA</span>
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end justify-center text-right">
              <p className="text-[7px] text-emerald-300/80 font-semibold leading-tight text-right">{awardedMessage}</p>
              <p className="text-[7px] text-emerald-300/65 mt-0.5 font-semibold leading-tight tracking-[0.04em]">(epoch #{awardedEpoch})</p>
            </div>
          </div>
        ) : (
          <div className="flex w-full items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
              <div className="shrink-0">{icon}</div>
              <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span className={`break-words text-[10px] font-black uppercase leading-tight tracking-[0.05em] animate-pulse sm:text-[12px] sm:tracking-[0.1em] ${titleClass}`}>
                {nextCopy.replace(/^Next /, "")}
              </span>
              <span className={`lore-nums text-[13px] sm:text-[15px] font-black tabular-nums leading-none ${amountClass}`}>{poolAmount.toFixed(2)}</span>
              <span className={`text-[9px] sm:text-[10px] font-black tracking-wide ${amountSubtleClass}`}>LINEA</span>
              </div>
            </div>
            <div className="w-[8.5rem] shrink-0">
              <div className="flex items-center justify-between mb-0.5">
                <span className={`text-[7px] font-semibold uppercase tracking-[0.08em] ${windowLabelClass}`}>Window</span>
                <span className={`lore-nums text-[7px] font-bold tabular-nums ${windowValueClass}`}>{window.leftLabel}</span>
              </div>
              <div className={`h-2 rounded-full overflow-hidden ${windowTrackClass}`}>
                <div
                  className={`h-full rounded-full transition-all duration-1000 shadow-[0_0_8px_rgba(139,92,246,0.3)] ${windowFillClass}`}
                  style={{ width: `${window.pct}%` }}
                />
              </div>
              <p className={`text-[7px] mt-0.5 font-semibold leading-tight ${bodyClass}`}>{progressCopy}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DailyJackpotIcon() {
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden sm:h-[3.5rem] sm:w-[3.5rem]">
      <Image
        src="/Daily%20Jackpot.png"
        alt=""
        aria-hidden="true"
        width={56}
        height={56}
        className="h-full w-full scale-[1.9] object-contain"
      />
    </div>
  );
}

function WeeklyJackpotIcon() {
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden sm:h-[3.5rem] sm:w-[3.5rem]">
      <Image
        src="/Weekly%20Jackpot.png"
        alt=""
        aria-hidden="true"
        width={56}
        height={56}
        className="h-full w-full scale-[1.82] object-contain"
      />
    </div>
  );
}

export function HeaderJackpots({
  jackpotInfo,
  nowMs,
  dailyAwardVisibleUntil,
  weeklyAwardVisibleUntil,
  dailyAwardedToday,
  weeklyAwardedThisWeek,
  dailyWindow,
  weeklyWindow,
}: HeaderJackpotsProps) {
  if (jackpotInfo.dailyPool <= 0 && jackpotInfo.weeklyPool <= 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-1.5 mb-1.5 animate-slide-up" style={{ animationDelay: "0s" }}>
      <JackpotCard
        accent="amber"
        awardedCopy="Daily Jackpot Awarded"
        nextCopy="Next Daily Jackpot"
        poolAmount={jackpotInfo.dailyPool}
        awardedAmount={jackpotInfo.lastDailyJackpotAmount}
        awardedEpoch={jackpotInfo.lastDailyJackpotEpoch}
        awardedThisWindow={dailyAwardedToday}
        visibleUntil={dailyAwardVisibleUntil}
        nowMs={nowMs}
        icon={<DailyJackpotIcon />}
        awardedMessage="Today JACKPOT was awarded"
        window={dailyWindow}
        progressCopy="Day window progress - random trigger any time"
      />
      <JackpotCard
        accent="violet"
        awardedCopy="Weekly Jackpot Awarded"
        nextCopy="Next Weekly Jackpot"
        poolAmount={jackpotInfo.weeklyPool}
        awardedAmount={jackpotInfo.lastWeeklyJackpotAmount}
        awardedEpoch={jackpotInfo.lastWeeklyJackpotEpoch}
        awardedThisWindow={weeklyAwardedThisWeek}
        visibleUntil={weeklyAwardVisibleUntil}
        nowMs={nowMs}
        icon={<WeeklyJackpotIcon />}
        awardedMessage="This week JACKPOT was awarded"
        window={weeklyWindow}
        progressCopy="Week window progress - random trigger any time"
      />
    </div>
  );
}
