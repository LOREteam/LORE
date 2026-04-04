"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { formatTime } from "../lib/utils";
import { WinsTicker } from "./WinsTicker";
import type { JackpotHistoryEntry } from "../hooks/useJackpotHistory";
import type { RecentWin } from "../hooks/useRecentWins";
import { HeaderJackpots } from "./header/HeaderJackpots";
import { HeaderPoolChart } from "./header/HeaderPoolChart";
import { HeaderWalletCard } from "./header/HeaderWalletCard";
import type { JackpotDisplayInfo } from "./header/types";

const JACKPOT_NOTICE_MS = 30 * 60 * 1000;

interface HeaderProps {
  initialNowMs?: number;
  visualEpoch: string | null;
  isRevealing: boolean;
  coldBootDefaults?: boolean;
  liveStateReady?: boolean;
  timerReady?: boolean;
  timeLeft: number;
  realTotalStaked: number;
  rolloverAmount: number;
  jackpotInfo: JackpotDisplayInfo | null;
  linePath: string;
  chartHasData: boolean;
  embeddedWalletAddress: string | null;
  embeddedWalletSyncing?: boolean;
  privyEthBalance: string;
  privyEthBalanceLoading?: boolean;
  privyTokenBalance: string;
  privyTokenBalanceLoading?: boolean;
  onOpenWalletSettings: () => void;
  muted: boolean;
  onToggleMute: () => void;
  recentWins?: RecentWin[];
  jackpotHistory?: JackpotHistoryEntry[];
  showWinsTicker?: boolean;
  reducedMotion?: boolean;
  isPageVisible?: boolean;
  epochDurationChange?: {
    current: number | null;
    next: number;
    eta: number | null;
    effectiveFromEpoch: string | null;
  } | null;
}

export const Header = React.memo(function Header({
  initialNowMs = 0,
  visualEpoch,
  isRevealing,
  coldBootDefaults = false,
  liveStateReady = true,
  timerReady = true,
  timeLeft,
  realTotalStaked,
  rolloverAmount,
  jackpotInfo,
  linePath,
  chartHasData,
  embeddedWalletAddress,
  embeddedWalletSyncing = false,
  privyEthBalance,
  privyEthBalanceLoading = false,
  privyTokenBalance,
  privyTokenBalanceLoading = false,
  onOpenWalletSettings,
  muted,
  onToggleMute,
  recentWins = [],
  jackpotHistory = [],
  showWinsTicker = false,
  reducedMotion = false,
  isPageVisible = true,
  epochDurationChange = null,
}: HeaderProps) {
  const { login, logout, authenticated } = usePrivy();
  const showColdBootDefaults = coldBootDefaults && !liveStateReady && !isRevealing;
  const timerStalled = timerReady && liveStateReady && !showColdBootDefaults && !isRevealing && timeLeft === 0;
  const showNumericTimer = (liveStateReady || showColdBootDefaults) && !timerStalled;
  const [hydrated, setHydrated] = useState(false);
  const [showAnalyzing, setShowAnalyzing] = useState(false);
  const [embeddedAddressCopied, setEmbeddedAddressCopied] = useState(false);
  const [nowMs, setNowMs] = useState(initialNowMs);
  const mountedRef = useRef(false);
  const historyReady = hydrated;

  useEffect(() => {
    mountedRef.current = true;
    setHydrated(true);
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!embeddedAddressCopied) return;
    const timeoutId = window.setTimeout(() => setEmbeddedAddressCopied(false), 1400);
    return () => window.clearTimeout(timeoutId);
  }, [embeddedAddressCopied]);

  useEffect(() => {
    if (!liveStateReady) {
      setShowAnalyzing(false);
      return;
    }
    if (timeLeft === 0 || isRevealing) setShowAnalyzing(true);
    else if (timeLeft > 0 && !isRevealing) setShowAnalyzing(false);
  }, [liveStateReady, timeLeft, isRevealing]);

  useEffect(() => {
    if (!isPageVisible) return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
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
  const lastDailyJackpotEpoch = jackpotInfo?.lastDailyJackpotEpoch ?? null;
  const lastWeeklyJackpotEpoch = jackpotInfo?.lastWeeklyJackpotEpoch ?? null;
  const latestDailyAward = useMemo(
    () =>
      historyReady && lastDailyJackpotEpoch
        ? jackpotHistory.find(
            (entry) =>
              entry.kind === "daily" &&
              entry.epoch === lastDailyJackpotEpoch &&
              typeof entry.timestamp === "number",
          ) ?? null
        : null,
    [historyReady, jackpotHistory, lastDailyJackpotEpoch],
  );
  const latestWeeklyAward = useMemo(
    () =>
      historyReady && lastWeeklyJackpotEpoch
        ? jackpotHistory.find(
            (entry) =>
              entry.kind === "weekly" &&
              entry.epoch === lastWeeklyJackpotEpoch &&
              typeof entry.timestamp === "number",
          ) ?? null
        : null,
    [historyReady, jackpotHistory, lastWeeklyJackpotEpoch],
  );
  const dailyAwardVisibleUntil = latestDailyAward?.timestamp ? latestDailyAward.timestamp + JACKPOT_NOTICE_MS : 0;
  const weeklyAwardVisibleUntil = latestWeeklyAward?.timestamp ? latestWeeklyAward.timestamp + JACKPOT_NOTICE_MS : 0;
  const epochDurationEta = epochDurationChange?.eta ?? null;
  const epochDurationEtaLabel = useMemo(() => {
    if (!epochDurationEta) return null;
    return `${new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: "UTC",
    }).format(new Date(epochDurationEta * 1000))} UTC`;
  }, [epochDurationEta]);
  const handleCopyEmbeddedAddress = useCallback(() => {
    if (!embeddedWalletAddress) return;
    void navigator.clipboard
      .writeText(embeddedWalletAddress)
      .then(() => {
        if (mountedRef.current) {
          setEmbeddedAddressCopied(true);
        }
      })
      .catch(() => {});
  }, [embeddedWalletAddress]);
  return (
    <>
    {jackpotInfo && (
      <HeaderJackpots
        jackpotInfo={jackpotInfo}
        nowMs={nowMs}
        dailyAwardVisibleUntil={dailyAwardVisibleUntil}
        weeklyAwardVisibleUntil={weeklyAwardVisibleUntil}
        dailyAwardedToday={dailyAwardedToday}
        weeklyAwardedThisWeek={weeklyAwardedThisWeek}
        dailyWindow={dailyWindow}
        weeklyWindow={weeklyWindow}
      />
    )}

    <header className="grid grid-cols-1 min-[900px]:grid-cols-12 gap-2 mb-2">
      {/* Epoch + WinsTicker */}
      <div className="min-[900px]:col-span-4 min-[900px]:h-[90px] flex flex-col rounded-xl bg-[#0d0d1a] border border-violet-500/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_20px_rgba(139,92,246,0.06)] animate-slide-up overflow-hidden" style={{ animationDelay: "0.05s" }}>
        <div className="grid grid-cols-[5.25rem_minmax(0,1fr)_4.25rem] sm:grid-cols-[7rem_minmax(0,1fr)_5.5rem] items-stretch shrink-0">
        {/* LEFT - Epoch */}
        <div className="flex flex-col items-center justify-center py-1 px-1">
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
            <span className={`lore-nums text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${isRevealing ? "reveal-text-blink" : ""}`}>
              {isRevealing ? "REVEAL" : visualEpoch ? `#${visualEpoch}` : showColdBootDefaults ? "#0" : "SYNC"}
            </span>
          </div>
          </div>
        </div>

        {/* CENTER - Timer (expands to fill, content fixed) */}
        <div className="flex flex-col items-center justify-center py-1 border-x border-white/[0.06] min-w-0">
          <div className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-1">Timer</div>
          <div
            className={`lore-nums w-[5.8rem] h-[1.6rem] flex items-center justify-center font-black leading-none tracking-tight tabular-nums transition-colors duration-300 ${
              isRevealing
                ? "text-amber-400 drop-shadow-[0_0_12px_rgba(251,191,36,0.5)]"
                : !timerReady && !showColdBootDefaults
                  ? "text-gray-500"
                  : timerStalled
                    ? "text-amber-300/90"
                    : timeLeft <= 10
                    ? "text-red-400 drop-shadow-[0_0_8px_rgba(239,68,68,0.4)]"
                    : "text-white"
            }`}
          >
            {showNumericTimer ? (
              <span className="text-[1.35rem]">{formatTime(timeLeft)}</span>
            ) : timerStalled ? (
              <span className="text-[0.72rem] font-bold uppercase tracking-[0.16em]">Locked</span>
            ) : (
              <span className="text-[1.35rem]">--:--</span>
            )}
          </div>
        </div>

        {/* RIGHT - Status */}
        <div className="flex flex-col items-center justify-center py-1">
          {showAnalyzing ? (
            <>
              <div className="flex items-end gap-[3px] h-[1.25rem] mb-1 [&>span]:origin-bottom">
                <span className="w-[3px] bg-amber-400/90 rounded-full animate-[bar-1_0.6s_ease-in-out_infinite]" style={{ height: "40%" }} />
                <span className="w-[3px] bg-amber-400 rounded-full animate-[bar-2_0.6s_ease-in-out_infinite]" style={{ height: "70%", animationDelay: "0.1s" }} />
                <span className="w-[3px] bg-amber-400/90 rounded-full animate-[bar-3_0.6s_ease-in-out_infinite]" style={{ height: "100%", animationDelay: "0.2s" }} />
                <span className="w-[3px] bg-amber-400/70 rounded-full animate-[bar-2_0.6s_ease-in-out_infinite]" style={{ height: "55%", animationDelay: "0.15s" }} />
                <span className="w-[3px] bg-amber-400/90 rounded-full animate-[bar-1_0.6s_ease-in-out_infinite]" style={{ height: "25%", animationDelay: "0.05s" }} />
              </div>
              <span className="text-[10px] font-bold text-amber-400/80 uppercase tracking-widest text-center">Analyzing</span>
            </>
          ) : (
            <div className="flex flex-col items-center mt-1">
              <div className="animate-float" style={{ animationDuration: "2.5s" }}>
                <PickaxeIcon className="w-8 h-8" />
              </div>
              <span className="text-[10px] font-bold text-violet-400/50 uppercase tracking-widest mt-0.5 text-center">Mining</span>
            </div>
          )}
        </div>
        </div>

        {epochDurationChange && (
          <div className="border-t border-white/[0.06] px-2 py-1 bg-amber-500/[0.04]">
            <div className="px-1 text-center text-[8px] font-bold uppercase leading-tight tracking-wide text-amber-300/90 sm:text-[9px] sm:tracking-wider">
              Duration scheduled: {epochDurationChange.current ?? "?"}s {"->"} {epochDurationChange.next}s
              {epochDurationChange.effectiveFromEpoch ? ` from #${epochDurationChange.effectiveFromEpoch}` : ""}
              {epochDurationEtaLabel ? ` (ETA ${epochDurationEtaLabel})` : ""}
            </div>
          </div>
        )}

        {showWinsTicker && (
          <div className="border-t border-white/[0.06] min-h-[1.9rem] flex-1 flex items-center">
            <WinsTicker wins={recentWins} reducedMotion={reducedMotion} />
          </div>
        )}
      </div>

      <HeaderPoolChart
        chartHasData={chartHasData}
        coldBootDefaults={coldBootDefaults}
        hydrated={hydrated}
        linePath={linePath}
        liveStateReady={liveStateReady}
        muted={muted}
        onToggleMute={onToggleMute}
        realTotalStaked={realTotalStaked}
        rolloverAmount={rolloverAmount}
      />

      <HeaderWalletCard
        authenticated={authenticated}
        embeddedWalletAddress={embeddedWalletAddress}
        embeddedWalletSyncing={embeddedWalletSyncing}
        embeddedAddressCopied={embeddedAddressCopied}
        onCopyEmbeddedAddress={handleCopyEmbeddedAddress}
        onLogin={() => { void login(); }}
        onLogout={() => { void logout(); }}
        onOpenWalletSettings={onOpenWalletSettings}
        privyEthBalance={privyEthBalance}
        privyEthBalanceLoading={privyEthBalanceLoading}
        privyTokenBalance={privyTokenBalance}
        privyTokenBalanceLoading={privyTokenBalanceLoading}
      />
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
