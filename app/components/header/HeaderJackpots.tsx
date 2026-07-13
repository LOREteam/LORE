"use client";

import React, { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import type { JackpotHistoryEntry } from "../../hooks/useJackpotHistory";
import { getJackpotVisualTheme, type JackpotVisualKind } from "../../lib/jackpotVisualTheme";
import type { JackpotDisplayInfo } from "./types";

const JACKPOT_NOTICE_MS = 30 * 60 * 1000;

interface JackpotWindowInfo {
  pct: number;
  leftLabel: string;
}

interface HeaderJackpotsProps {
  jackpotInfo: JackpotDisplayInfo;
  historyReady: boolean;
  initialNowMs: number;
  isPageVisible: boolean;
  jackpotHistory: JackpotHistoryEntry[];
}

interface JackpotCardProps {
  kind: Extract<JackpotVisualKind, "daily" | "weekly">;
  poolAmount: number;
  awardedEpoch: string | null;
  awardedThisWindow: boolean;
  visibleUntil: number;
  nowMs: number;
  icon: React.ReactNode;
  window: JackpotWindowInfo;
}

function JackpotCard({
  kind,
  poolAmount,
  awardedEpoch,
  awardedThisWindow,
  visibleUntil,
  nowMs,
  icon,
  window,
}: JackpotCardProps) {
  const theme = getJackpotVisualTheme(kind);
  const isAwardLive = Boolean(nowMs < visibleUntil && awardedEpoch);
  const isAwardedWindow = Boolean(awardedThisWindow && awardedEpoch);
  const meterPct = isAwardedWindow ? 0 : window.pct;
  const amountText = poolAmount.toFixed(2);
  const metricLabel = isAwardedWindow ? "Status" : "Pool";
  const metricValue = isAwardedWindow ? "AWARDED" : amountText;
  const metricUnit = isAwardedWindow ? `#${awardedEpoch}` : "LINEA";

  return (
    <div className={`jackpot-vault-card ${theme.card.vaultClass} relative overflow-hidden rounded-xl border group transition-all duration-300`}>
      {isAwardLive && (
        <div className="absolute inset-0 z-20 pointer-events-none">
          <div className={`absolute inset-0 ${theme.card.pulseClass} opacity-70`} />
          <div className={`absolute inset-0 bg-linear-to-r from-transparent ${theme.card.sweepClass} to-transparent opacity-60`} />
        </div>
      )}
      <div className="relative z-30 grid h-14 grid-cols-[2.65rem_minmax(0,1fr)_7.5rem] items-center gap-1.5 px-2 pb-3 pt-1.5 sm:grid-cols-[2.85rem_minmax(0,1fr)_8.2rem] sm:gap-2 sm:px-2.5">
        <div className="flex h-full items-center justify-center">
          <div className="jackpot-vault-core">{icon}</div>
        </div>
        <div className="min-w-0 self-stretch">
          <div className="flex h-full min-w-0 flex-col justify-center">
            <p className={`truncate text-[6.5px] font-black uppercase leading-none tracking-[0.13em] sm:text-[7px] ${theme.card.labelClass}`}>
              {theme.cardCaption}
            </p>
            <h3 className={`mt-0.5 truncate text-[11px] font-black uppercase leading-none tracking-[0.05em] sm:text-xs ${theme.card.titleClass}`}>
              {theme.cardTitle}
            </h3>
            <div className="mt-1 flex min-w-0 items-center gap-1.5">
              <span
                className={`lore-hud truncate font-black uppercase leading-none ${
                  isAwardedWindow ? "text-[9px] tracking-[0.08em] sm:text-[10px]" : "text-[8px]"
                } ${theme.card.bodyClass}`}
              >
                {isAwardedWindow ? `Next in ${window.leftLabel}` : window.leftLabel}
              </span>
            </div>
          </div>
        </div>

        <div className="self-stretch text-right">
          <div className="flex h-full flex-col justify-center">
            <div className={`text-[6.5px] font-black uppercase leading-none tracking-[0.12em] ${theme.card.labelClass}`}>
              {metricLabel}
            </div>
            <div
              data-testid={`jackpot-${kind}-metric`}
              className={`lore-nums mt-0.5 truncate font-black tabular-nums leading-none ${isAwardedWindow ? "text-[10px] tracking-[0.08em] sm:text-[11px]" : "text-sm sm:text-base"} ${theme.card.amountClass}`}
              title={`${metricValue} ${metricUnit}`}
            >
              {metricValue}
            </div>
            <div className={`mt-0.5 text-[7px] font-black uppercase leading-none tracking-[0.08em] ${theme.card.subtleClass}`}>
              {metricUnit}
            </div>
          </div>
        </div>

        {!isAwardedWindow && (
          <div className="absolute bottom-1.5 left-[4rem] right-3 min-w-0 sm:left-[4.35rem]">
            <div className="jackpot-vault-meter h-1 overflow-hidden rounded-full">
              <div
                className={`h-full rounded-full transition-all duration-1000 ${theme.card.fillClass}`}
                style={{ width: `${meterPct}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DailyJackpotIcon() {
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden sm:h-11 sm:w-11">
      <Image
        src="/Daily Jackpot.png"
        alt=""
        aria-hidden="true"
        width={44}
        height={44}
        className="h-full w-full scale-[1.9] object-contain"
      />
    </div>
  );
}

function WeeklyJackpotIcon() {
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden sm:h-11 sm:w-11">
      <Image
        src="/Weekly Jackpot.png"
        alt=""
        aria-hidden="true"
        width={44}
        height={44}
        className="h-full w-full scale-[1.82] object-contain"
      />
    </div>
  );
}

export const HeaderJackpots = React.memo(function HeaderJackpots({
  jackpotInfo,
  historyReady,
  initialNowMs,
  isPageVisible,
  jackpotHistory,
}: HeaderJackpotsProps) {
  const [nowMs, setNowMs] = useState(() => initialNowMs);

  useEffect(() => {
    if (!isPageVisible) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [isPageVisible]);

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
    const mondayOffsetMs = 3 * 86_400_000;
    const shifted = nowMs + mondayOffsetMs;
    const elapsed = shifted % weekMs;
    const leftMs = weekMs - elapsed;
    const d = Math.floor(leftMs / 86_400_000);
    const h = Math.floor((leftMs % 86_400_000) / 3_600_000);
    return { pct: (elapsed / weekMs) * 100, leftLabel: `${d}d ${h}h left` };
  }, [nowMs]);

  const todayDayIdx = Math.floor(nowMs / 86_400_000);
  const dailyAwardedToday = jackpotInfo.lastDailyDay === todayDayIdx;
  const weeklyNowIdx = Math.floor((nowMs + 3 * 86_400_000) / 604_800_000);
  const weeklyAwardedThisWeek = jackpotInfo.lastWeeklyWeek === weeklyNowIdx;
  const latestDailyAward = useMemo(
    () =>
      historyReady && jackpotInfo.lastDailyJackpotEpoch
        ? jackpotHistory.find(
            (entry) =>
              entry.kind === "daily" &&
              entry.epoch === jackpotInfo.lastDailyJackpotEpoch &&
              typeof entry.timestamp === "number",
          ) ?? null
        : null,
    [historyReady, jackpotHistory, jackpotInfo.lastDailyJackpotEpoch],
  );
  const latestWeeklyAward = useMemo(
    () =>
      historyReady && jackpotInfo.lastWeeklyJackpotEpoch
        ? jackpotHistory.find(
            (entry) =>
              entry.kind === "weekly" &&
              entry.epoch === jackpotInfo.lastWeeklyJackpotEpoch &&
              typeof entry.timestamp === "number",
          ) ?? null
        : null,
    [historyReady, jackpotHistory, jackpotInfo.lastWeeklyJackpotEpoch],
  );
  // Only use a real indexed timestamp for the short celebratory pulse. A moving
  // `nowMs + notice` fallback keeps awarded jackpots visually "live" forever.
  const dailyAwardVisibleUntil = latestDailyAward?.timestamp
    ? latestDailyAward.timestamp + JACKPOT_NOTICE_MS
    : 0;
  const weeklyAwardVisibleUntil = latestWeeklyAward?.timestamp
    ? latestWeeklyAward.timestamp + JACKPOT_NOTICE_MS
    : 0;

  if (jackpotInfo.dailyPool <= 0 && jackpotInfo.weeklyPool <= 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mb-1">
      <JackpotCard
        kind="daily"
        poolAmount={jackpotInfo.dailyPool}
        awardedEpoch={jackpotInfo.lastDailyJackpotEpoch}
        awardedThisWindow={dailyAwardedToday}
        visibleUntil={dailyAwardVisibleUntil}
        nowMs={nowMs}
        icon={<DailyJackpotIcon />}
        window={dailyWindow}
      />
      <JackpotCard
        kind="weekly"
        poolAmount={jackpotInfo.weeklyPool}
        awardedEpoch={jackpotInfo.lastWeeklyJackpotEpoch}
        awardedThisWindow={weeklyAwardedThisWeek}
        visibleUntil={weeklyAwardVisibleUntil}
        nowMs={nowMs}
        icon={<WeeklyJackpotIcon />}
        window={weeklyWindow}
      />
    </div>
  );
});
