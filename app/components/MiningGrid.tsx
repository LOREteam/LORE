"use client";

import React, { useMemo, useCallback, useState, useEffect } from "react";
import { GRID_SIZE } from "../lib/constants";
import { pickRandom, yourWinQuotes, roundWinQuotes } from "../lib/loreTexts";
import { Confetti } from "./Confetti";

const TILE_INDICES = Array.from({ length: GRID_SIZE }, (_, i) => i);

const STYLE_GLOW_BREATHE = { animation: "winner-glow-breathe 2s ease-in-out infinite" } as const;
const STYLE_GLOW_BREATHE_MINE = { animation: "winner-glow-breathe-mine 2s ease-in-out infinite" } as const;
const STYLE_BADGE_SLIDE = { animation: "winner-badge-slide 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.3s both" } as const;

function compactTileAmount(value: string): string {
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return value;
  return amount.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function buildTileAriaLabel({
  tileId,
  users,
  compactAmount,
  isSelected,
  hasMyBet,
  isWinner,
  isMyWin,
  liveStateReady,
}: {
  tileId: number;
  users: number;
  compactAmount: string;
  isSelected: boolean;
  hasMyBet: boolean;
  isWinner: boolean;
  isMyWin: boolean;
  liveStateReady: boolean;
}) {
  const fragments = [`Tile ${tileId}`];

  if (liveStateReady) {
    fragments.push(`${users} players`, `${compactAmount} LINEA pooled`);
  } else {
    fragments.push("live state syncing");
  }

  if (isMyWin) fragments.push("your winning tile");
  else if (isWinner) fragments.push("winning tile");
  else if (hasMyBet) fragments.push("your bet is here");

  if (isSelected && !isWinner) fragments.push("selected");
  return fragments.join(", ");
}

interface MiningGridProps {
  tileViewData: Array<{
    tileId: number;
    users: number;
    poolDisplay: string;
    hasMyBet: boolean;
  }>;
  coldBootDefaults?: boolean;
  liveStateReady?: boolean;
  selectedTiles: number[];
  winningTileId: number | null;
  isRevealing: boolean;
  isAnalyzing: boolean;
  reducedMotion?: boolean;
  showSelection: boolean;
  onTileClick: (tileId: number) => void;
}

export const MiningGrid = React.memo(function MiningGrid({
  tileViewData,
  coldBootDefaults = false,
  liveStateReady = true,
  selectedTiles,
  winningTileId,
  isRevealing,
  isAnalyzing,
  reducedMotion = false,
  showSelection,
  onTileClick,
}: MiningGridProps) {
  const selectionSet = useMemo(
    () => (showSelection ? new Set(selectedTiles) : new Set<number>()),
    [showSelection, selectedTiles],
  );

  const [loreMsg, setLoreMsg] = useState<string | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [confettiIsMyWin, setConfettiIsMyWin] = useState(false);

  useEffect(() => {
    if (!isRevealing || winningTileId === null) {
      setLoreMsg(null);
      setShowConfetti(false);
      return;
    }
    const myBet = tileViewData.find((t) => t.tileId === winningTileId)?.hasMyBet;
    setLoreMsg(pickRandom(myBet ? yourWinQuotes : roundWinQuotes));
    setShowConfetti(!reducedMotion && !!myBet);
    setConfettiIsMyWin(!!myBet);
    const timer = setTimeout(() => setLoreMsg(null), 4000);
    return () => clearTimeout(timer);
  }, [isRevealing, winningTileId, tileViewData, reducedMotion]);

  return (
    <div className="relative w-full aspect-square min-h-[18rem] overflow-hidden rounded-xl border border-violet-500/20 bg-[#0d0d1a] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_20px_rgba(139,92,246,0.06)] sm:min-h-[20rem] min-[900px]:aspect-auto min-[900px]:h-[calc(100dvh-13rem)] min-[900px]:min-h-[22rem]">
      <div className="grid grid-cols-5 grid-rows-5 gap-1 p-1.5 sm:gap-1.5 sm:p-2 h-full">
        {TILE_INDICES.map((i) => {
          const tile = tileViewData[i] ?? { tileId: i + 1, users: 0, poolDisplay: "0.00", hasMyBet: false };
          const tileId = tile.tileId;

          return (
            <Tile
              key={tileId}
              tileId={tileId}
              index={i}
              coldBootDefaults={coldBootDefaults}
              users={tile.users}
              displayAmount={liveStateReady || coldBootDefaults ? tile.poolDisplay : "..."}
              liveStateReady={liveStateReady}
              isWinner={winningTileId === tileId}
              isSelected={selectionSet.has(tileId)}
              hasMyBet={tile.hasMyBet}
              isRevealing={isRevealing}
              isAnalyzing={isAnalyzing}
              reducedMotion={reducedMotion}
              onTileClick={onTileClick}
            />
          );
        })}
      </div>

      <Confetti active={!reducedMotion && showConfetti} isMyWin={confettiIsMyWin} />

      {loreMsg && (
        <div
          className={`absolute inset-0 flex justify-center pointer-events-none z-40 ${
            winningTileId !== null && [22, 23, 24].includes(winningTileId)
              ? "items-start pt-4"
              : "items-end pb-4"
          }`}
        >
          <div className={`${reducedMotion ? "" : "animate-lore-toast "}px-5 py-2.5 rounded-lg bg-black/50 backdrop-blur-sm border border-violet-500/20 shadow-[0_0_24px_rgba(139,92,246,0.15)] max-w-[90%]`}>
            <p className="text-sm text-violet-200/90 font-medium text-center italic leading-snug">
              {loreMsg}
            </p>
          </div>
        </div>
      )}
    </div>
  );
});

const Tile = React.memo(function Tile({
  tileId,
  index,
  coldBootDefaults,
  users,
  displayAmount,
  liveStateReady,
  isWinner,
  isSelected,
  hasMyBet,
  isRevealing,
  isAnalyzing,
  reducedMotion,
  onTileClick,
}: {
  tileId: number;
  index: number;
  coldBootDefaults: boolean;
  users: number;
  displayAmount: string;
  liveStateReady: boolean;
  isWinner: boolean;
  isSelected: boolean;
  hasMyBet: boolean;
  isRevealing: boolean;
  isAnalyzing: boolean;
  reducedMotion: boolean;
  onTileClick: (id: number) => void;
}) {
  const handleClick = useCallback(() => onTileClick(tileId), [onTileClick, tileId]);
  const isMyWin = isWinner && hasMyBet;
  const isNeutralWinner = isWinner && !hasMyBet;
  const compactAmount = liveStateReady || coldBootDefaults ? compactTileAmount(displayAmount) : "...";
  const ariaLabel = buildTileAriaLabel({
    tileId,
    users,
    compactAmount,
    isSelected,
    hasMyBet,
    isWinner,
    isMyWin,
    liveStateReady,
  });
  // 4 distinct colors: 1 default (slate), 2 my bet (emerald), 3 round win (amber), 4 my win (sky)
  let base: string;
  if (isMyWin) {
    base = reducedMotion
      ? "border-sky-400/50 bg-sky-500/15 z-20 shadow-[0_0_20px_rgba(14,165,233,0.25)]"
      : "border-sky-400/50 bg-sky-500/15 animate-winner-burst winner-tile-pulse-mine z-20 shadow-[0_0_20px_rgba(14,165,233,0.25)]";
  } else if (isNeutralWinner) {
    base = reducedMotion
      ? "border-amber-400/50 bg-amber-500/10 z-20 shadow-[0_0_16px_rgba(251,191,36,0.2)]"
      : "border-amber-400/50 bg-amber-500/10 animate-winner-burst winner-tile-pulse z-20 shadow-[0_0_16px_rgba(251,191,36,0.2)]";
  } else if (isSelected) {
    base = reducedMotion
      ? "border-violet-500/60 bg-violet-500/15 shadow-[0_0_16px_rgba(139,92,246,0.25)]"
      : "border-violet-500/60 bg-violet-500/15 shadow-[0_0_16px_rgba(139,92,246,0.25)] animate-glow-pulse";
  } else if (hasMyBet) {
    base = "border-emerald-500/40 bg-emerald-500/8 hover:bg-emerald-500/15 hover:border-emerald-400/60 hover:shadow-[0_0_16px_rgba(52,211,153,0.2)]";
  } else {
    base = "border-violet-500/10 bg-[#0f0f1e] hover:border-violet-500/30 hover:bg-[#13132a] hover:shadow-[0_0_20px_rgba(139,92,246,0.12)]";
  }

  const faded = isRevealing && !isWinner
    ? "opacity-10 pointer-events-none"
    : isAnalyzing
      ? "opacity-40"
      : "";
  const staggerClass = `stagger-${index + 1}`;
  const entranceAnim = !reducedMotion && !isRevealing && !isAnalyzing ? "animate-tile-enter" : "";

  return (
    <button
      onClick={handleClick}
      disabled={!liveStateReady || isRevealing}
      aria-label={ariaLabel}
      aria-pressed={isSelected && !isWinner}
      className={`relative h-full w-full min-h-0 overflow-hidden rounded-lg border p-1 transition-all duration-200 group flex flex-col items-center justify-between sm:p-1.5 [contain:layout_paint] ${entranceAnim} ${staggerClass} ${base} ${faded}`}
    >
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none bg-gradient-to-br from-white/[0.03] to-transparent z-0" />

      <div className="relative z-10 flex w-full items-start justify-between gap-1">
        <span className={`flex min-w-0 items-center gap-0.5 text-[7px] font-mono font-semibold leading-none sm:gap-1 sm:text-[10px] ${
          isMyWin ? "text-sky-300" : isNeutralWinner ? "text-amber-300" : hasMyBet ? "text-emerald-400" : "text-gray-600"
        }`}>
          #{tileId}
          {hasMyBet && !isWinner && (
            <span className={`w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)] ${reducedMotion ? "" : "animate-synced-pulse"}`} />
          )}
          {isSelected && !isWinner && (
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0 shadow-[0_0_6px_rgba(139,92,246,0.6)]" />
          )}
        </span>

        <span
          className={`flex items-center gap-0.5 text-[7px] font-semibold leading-none sm:gap-1 sm:text-[10px] ${
            isMyWin
              ? "text-sky-200/70"
              : isNeutralWinner
                ? "text-amber-200/70"
                : hasMyBet
                  ? "text-emerald-200/60"
                  : "text-gray-700"
          }`}
        >
          <span>{liveStateReady || coldBootDefaults ? users : "-"}</span>
          <svg
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className="h-2.5 w-2.5 sm:h-3 sm:w-3"
          >
            <path
              d="M8 8.167A2.417 2.417 0 1 0 8 3.333a2.417 2.417 0 0 0 0 4.834ZM3.833 12.667c0-1.61 1.94-2.917 4.167-2.917s4.167 1.306 4.167 2.917"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>

      <div className="relative z-10 flex w-full flex-1 items-center justify-center px-0.5">
        <span className={`block w-full max-w-full px-0.5 text-center font-black text-[clamp(0.68rem,2.4vw,0.98rem)] leading-none tracking-tight transition-all duration-200 sm:text-lg ${
          isMyWin
            ? "text-sky-200 drop-shadow-[0_0_12px_rgba(14,165,233,0.7)]"
            : isNeutralWinner
              ? "text-amber-400 drop-shadow-[0_0_10px_rgba(251,191,36,0.7)]"
              : hasMyBet
                ? "text-emerald-200"
                : "text-white group-hover:text-violet-300 group-hover:drop-shadow-[0_0_8px_rgba(139,92,246,0.4)]"
        }`}>
          {compactAmount}
        </span>
      </div>
      {isNeutralWinner && (
        <>
          {!reducedMotion && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
              <div className="w-full h-full rounded-lg border-2 border-amber-400/60 winner-shockwave" />
            </div>
          )}
          <div className="absolute inset-0 rounded-lg border-2 border-amber-400/50 pointer-events-none z-0 shadow-[inset_0_0_20px_rgba(251,191,36,0.08)]" style={reducedMotion ? undefined : STYLE_GLOW_BREATHE} />
          <div className={`absolute top-1.5 left-1/2 -translate-x-1/2 pointer-events-none z-30 ${reducedMotion ? "" : "winner-crown"}`}>
            <svg className="w-3.5 h-3.5 text-amber-300 drop-shadow-[0_0_8px_rgba(251,191,36,0.8)]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L15 8L22 9L17 14L18 21L12 18L6 21L7 14L2 9L9 8L12 2Z" />
            </svg>
          </div>
          <div className="absolute bottom-0 inset-x-0 z-20" style={reducedMotion ? undefined : STYLE_BADGE_SLIDE}>
            <div className="bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500 px-1 py-0.5 text-center text-[6px] font-black uppercase leading-none tracking-[0.08em] text-black sm:text-[8px] sm:tracking-[0.15em]">
              ROUND WIN
            </div>
          </div>
        </>
      )}

      {isMyWin && (
        <>
          {!reducedMotion && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
              <div className="w-full h-full rounded-lg border-2 border-sky-400/60 winner-shockwave" />
            </div>
          )}
          <div className="absolute inset-0 rounded-lg border-2 border-sky-400/40 pointer-events-none z-0" style={reducedMotion ? undefined : STYLE_GLOW_BREATHE_MINE} />
          {!reducedMotion && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
              <div className="absolute w-1.5 h-1.5 rounded-full bg-sky-300 winner-particle-1" />
              <div className="absolute w-1 h-1 rounded-full bg-sky-200 winner-particle-2" />
              <div className="absolute w-1.5 h-1.5 rounded-full bg-cyan-300 winner-particle-3" />
            </div>
          )}
          <div className={`absolute top-1.5 left-1/2 -translate-x-1/2 pointer-events-none z-30 ${reducedMotion ? "" : "winner-crown"}`}>
            <svg className="w-4 h-4 text-sky-300 drop-shadow-[0_0_10px_rgba(14,165,233,0.8)]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5z" />
              <path d="M5 19h14v2H5z" opacity="0.5" />
            </svg>
          </div>
          <div className="absolute bottom-0 inset-x-0 z-20" style={reducedMotion ? undefined : STYLE_BADGE_SLIDE}>
            <div className="bg-gradient-to-r from-sky-500 via-cyan-400 to-sky-500 px-1 py-0.5 text-center text-[6px] font-black uppercase leading-none tracking-[0.08em] text-white shadow-[0_-4px_12px_rgba(14,165,233,0.4)] sm:text-[8px] sm:tracking-[0.15em]">
              YOUR WIN
            </div>
          </div>
        </>
      )}

    </button>
  );
});
