"use client";

import React, { useCallback } from "react";
import { formatUnits } from "viem";
import type { TabId, UnclaimedWin } from "../lib/types";
import { useGlobalStats } from "../hooks/useGlobalStats";
import { searchingQuotes, emptyStates } from "../lib/loreTexts";
import { LoreText } from "./LoreText";

interface HotTile { tileId: number; wins: number; }

interface SidebarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  hotTiles?: HotTile[];
  unclaimedWins: UnclaimedWin[];
  isScanning: boolean;
  isDeepScanning: boolean;
  isClaiming: boolean;
  onScan: () => void;
  onClaim: (epochId: string) => void;
  onClaimAll: () => void;
}

const TILE_STYLES = [
  "border-amber-500/30 bg-amber-500/10 text-amber-400",
  "border-violet-500/20 bg-violet-500/[0.06] text-violet-400",
  "border-white/10 bg-white/[0.02] text-gray-400",
] as const;

export const Sidebar = React.memo(function Sidebar({ activeTab, onTabChange, hotTiles, unclaimedWins, isScanning, isDeepScanning, isClaiming, onScan, onClaim, onClaimAll }: SidebarProps) {
  const { stats, loading: statsLoading } = useGlobalStats();

  const goHub = useCallback(() => onTabChange("hub"), [onTabChange]);
  const goAnalytics = useCallback(() => onTabChange("analytics"), [onTabChange]);
  const goReferral = useCallback(() => onTabChange("referral"), [onTabChange]);
  const goLeaderboards = useCallback(() => onTabChange("leaderboards"), [onTabChange]);
  const goWhitepaper = useCallback(() => onTabChange("whitepaper"), [onTabChange]);
  const goFaq = useCallback(() => onTabChange("faq"), [onTabChange]);

  return (
    <aside className="w-[calc(14rem+1cm)] bg-[#0a0a18]/90 backdrop-blur-md border-r border-violet-500/15 hidden lg:flex flex-col justify-between animate-slide-in-left">
      <div>
        {/* ═══ Logo ═══ */}
        <div className="p-5 flex items-center gap-4">
          <div className="relative group">
            <div className="w-14 h-14 animate-crystal" style={{ transformStyle: "preserve-3d" }}>
              <img src="/icon.png" alt="LORE" className="w-full h-full object-contain drop-shadow-[0_0_16px_rgba(139,92,246,0.5)]" />
            </div>
            <div className="absolute inset-0 rounded-full bg-violet-500/30 blur-xl animate-breathe -z-10" />
          </div>

          {/* Brand – centered; two lines so decorative lines stay aligned */}
          <div className="flex flex-col items-center justify-center">
            <span className="text-2xl font-black tracking-[0.15em] animate-text-glow leading-tight">
              <span className="text-white">L</span>
              <span className="text-violet-400">ORE</span>
            </span>
            <div className="flex flex-col items-center mt-1">
              <div className="flex items-center gap-1.5 w-full justify-center">
                <span className="w-4 shrink-0 h-px bg-gradient-to-r from-violet-500/50 to-transparent" aria-hidden />
                <span className="text-gray-500 font-bold uppercase tracking-[0.25em] whitespace-nowrap" style={{ fontSize: 9 }}>
                  MINE THE
                </span>
                <span className="w-4 shrink-0 h-px bg-gradient-to-l from-violet-500/50 to-transparent" aria-hidden />
              </div>
              <span className="text-gray-500 font-bold uppercase tracking-[0.25em]" style={{ fontSize: 9 }}>
                CHAIN
              </span>
            </div>
          </div>
        </div>

        <div className="mx-4 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />

        {/* ═══ Nav ═══ */}
        <nav className="p-3 mt-2 space-y-1">
          <NavItem active={activeTab === "hub"} onClick={goHub} icon="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012-2v2M7 7h10" label="Mining Hub" delay="0.1s" />
          <NavItem active={activeTab === "analytics"} onClick={goAnalytics} icon="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" label="Analytics" delay="0.15s" />
          <NavItem active={activeTab === "referral"} onClick={goReferral} icon="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" label="Referral" delay="0.2s" />
          <NavItem active={activeTab === "leaderboards"} onClick={goLeaderboards} icon="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 002.748 1.35m8.272-6.842V4.5c0 2.108-.966 3.99-2.48 5.228m2.48-5.492a46.32 46.32 0 012.916.52 6.003 6.003 0 01-5.395 4.972m0 0a6.726 6.726 0 01-2.749 1.35m0 0a6.772 6.772 0 01-3.044 0" label="Leaderboards" delay="0.25s" />
          <NavItem active={activeTab === "whitepaper"} onClick={goWhitepaper} icon="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" label="White Paper" delay="0.3s" />
          <NavItem active={activeTab === "faq"} onClick={goFaq} icon="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" label="FAQ" delay="0.35s" />
        </nav>

        {/* ═══ Global Stats ═══ */}
        <div className="mx-4 mt-1 space-y-2 animate-fade-in" style={{ animationDelay: "0.6s" }}>
          <div className="h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
          <p className="text-gray-600 font-bold uppercase tracking-[0.2em] px-1 pt-1" style={{ fontSize: "11px" }}>Protocol Stats</p>

          <div className="rounded-lg bg-gradient-to-br from-violet-500/[0.06] to-cyan-500/[0.04] border border-violet-500/10 p-[10px] space-y-2.5">
            <StatRow
              icon="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              label="Total Volume"
              value={stats ? `${stats.totalVolume} LINEA` : undefined}
              loading={statsLoading && !stats}
            />
            <div className="h-px bg-white/[0.04]" />
            <StatRow
              icon="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z"
              label="Total Burn"
              value={stats ? `${stats.totalBurn} LINEA` : undefined}
              loading={statsLoading && !stats}
              accent="orange"
            />
          </div>

          {hotTiles && hotTiles.length > 0 && (
            <>
              <p className="text-gray-600 font-bold uppercase tracking-[0.2em] px-1 pt-1" style={{ fontSize: "11px" }}>Hot Tiles</p>
              <div className="rounded-lg bg-gradient-to-br from-violet-500/[0.06] to-cyan-500/[0.04] border border-violet-500/10 p-[10px]">
                <div className="flex gap-1 min-w-0">
                  {hotTiles.map((t, i) => (
                    <div
                      key={t.tileId}
                      className={`flex flex-col items-center justify-center flex-1 min-w-0 aspect-square rounded border font-bold leading-tight text-center transition-all duration-500 ease-out ${
                        TILE_STYLES[Math.min(i, TILE_STYLES.length - 1)]
                      }`}
                      style={{ fontSize: 11 }}
                    >
                      <span>#{t.tileId}</span>
                      <span className="text-gray-600">&times;{t.wins}</span>
                    </div>
                  ))}
                </div>
                <p className="text-gray-500 font-medium text-center mt-2" style={{ fontSize: "10px" }}>Top tiles · last 40 rounds</p>
              </div>
            </>
          )}

          {/* ═══ Rewards ═══ */}
          <div className="h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent mt-1" />
          <div className="flex justify-between items-center gap-2 px-1 pt-1">
            <p className="text-gray-600 font-bold uppercase tracking-[0.2em] flex items-center gap-1.5 shrink-0" style={{ fontSize: "11px" }}>
              <span className="w-1 h-3 bg-amber-400 rounded-sm shadow-[0_0_6px_rgba(251,191,36,0.3)]" />
              Rewards
            </p>
            <div className="flex items-center gap-2 min-w-0">
              {unclaimedWins.length > 1 && (
                <button
                  onClick={onClaimAll}
                  disabled={isClaiming}
                  className="py-0.5 px-2 bg-gradient-to-r from-amber-500 to-orange-500 text-black font-black text-[8px] uppercase tracking-widest rounded-md hover:from-amber-400 hover:to-orange-400 disabled:opacity-40 transition-all shadow-md shadow-amber-500/15 shrink-0"
                >
                  {isClaiming ? "WAIT..." : `CLAIM ALL (${unclaimedWins.length})`}
                </button>
              )}
              <button
                onClick={onScan}
                disabled={isScanning}
                title="Scan rewards"
                className="text-violet-400 hover:text-violet-300 transition-all duration-200 flex items-center justify-center hover:drop-shadow-[0_0_6px_rgba(139,92,246,0.4)] shrink-0 p-0.5"
              >
                <svg
                  className={`w-3.5 h-3.5 ${isScanning ? "animate-spin" : "hover:rotate-180 transition-transform duration-500"}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>

          <div className="rounded-lg bg-gradient-to-br from-amber-500/[0.04] to-violet-500/[0.04] border border-amber-500/10 p-[10px]">
            {isDeepScanning && (
              <div className="mb-2 rounded-md border border-violet-500/20 bg-violet-500/8 px-2 py-1">
                <p className="text-[8px] leading-tight text-violet-300/90 font-semibold tracking-wide">
                  Quick results are ready. Full reward history is still loading in background.
                </p>
              </div>
            )}
            {isScanning && unclaimedWins.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-1.5">
                <svg className="w-3 h-3 animate-spin text-violet-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-[9px] text-gray-500 uppercase tracking-widest font-bold"><LoreText items={searchingQuotes} /></span>
              </div>
            ) : unclaimedWins.length > 0 ? (
              <div className="flex flex-col gap-1">
                <div className="flex flex-col gap-1 max-h-[100px] overflow-y-auto">
                  {unclaimedWins.map((win, idx) => (
                    <div
                      key={win.epoch}
                      className="flex justify-between items-center bg-amber-500/8 border border-amber-500/15 px-2 py-1 rounded-md animate-slide-up hover:bg-amber-500/12 transition-colors group"
                      style={{ animationDelay: `${idx * 0.05}s` }}
                    >
                      <div className="flex flex-col min-w-0">
                        <span className="text-[8px] text-amber-500/50 uppercase font-bold tracking-wider">
                          #{win.epoch}
                        </span>
                      <span className="text-[10px] font-bold text-emerald-400 truncate">
                        {Number(formatUnits(BigInt(win.amountWei), 18)).toFixed(4)} LINEA
                      </span>
                      </div>
                      <button
                        onClick={() => onClaim(win.epoch)}
                        disabled={isClaiming}
                        className="px-2 py-0.5 bg-gradient-to-r from-amber-500 to-orange-500 text-black font-black text-[8px] uppercase tracking-widest rounded hover:from-amber-400 hover:to-orange-400 disabled:opacity-40 transition-all shadow-sm active:scale-[0.95] shrink-0 ml-1"
                      >
                        {isClaiming ? "..." : "CLAIM"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-1.5 py-1">
                <svg className="w-3 h-3 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                <span className="text-[9px] font-bold tracking-widest italic text-gray-600"><LoreText items={emptyStates.rewards} /></span>
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
});

const StatRow = React.memo(function StatRow({ icon, label, value, loading, accent = "violet" }: {
  icon: string;
  label: string;
  value?: string;
  loading?: boolean;
  accent?: "violet" | "orange";
}) {
  const accentColor = accent === "orange" ? "text-orange-400" : "text-violet-400";
  const glowColor = accent === "orange" ? "text-orange-400/60" : "text-violet-400/60";

  return (
    <div className="flex items-center gap-2">
      <div className={`shrink-0 ${glowColor}`}>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-gray-500 uppercase tracking-wider font-semibold leading-none" style={{ fontSize: 9 }}>{label}</p>
        {loading ? (
          <div className="mt-1 h-3 w-16 rounded bg-white/[0.04] animate-pulse" />
        ) : (
          <p className={`font-bold ${accentColor} leading-tight mt-0.5 truncate`} style={{ fontSize: 12 }}>
            {value ?? "–"}
          </p>
        )}
      </div>
    </div>
  );
});

const NavItem = React.memo(function NavItem({ active, onClick, icon, label, delay }: {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
  delay: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg font-semibold transition-all duration-200 animate-slide-up group ${
        active
          ? "bg-violet-500/15 text-violet-400 shadow-sm shadow-violet-500/10 animate-glow-pulse"
          : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.04]"
      }`}
      style={{ animationDelay: delay, fontSize: 15 }}
    >
      <svg className={`w-[20px] h-[20px] shrink-0 transition-transform duration-200 ${active ? "" : "group-hover:scale-110"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
      </svg>
      {label}
      {active && (
        <div className="ml-auto w-1.5 h-1.5 rounded-full bg-violet-400 animate-synced-pulse" />
      )}
    </button>
  );
});
