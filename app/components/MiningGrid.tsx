"use client";

import React, { useMemo, useCallback, useState, useEffect } from "react";
import { GRID_SIZE } from "../lib/constants";
import { pickRandom, yourWinQuotes, roundWinQuotes } from "../lib/loreTexts";
import { Confetti } from "./Confetti";

const TILE_INDICES = Array.from({ length: GRID_SIZE }, (_, i) => i);

const STYLE_GLOW_BREATHE = { animation: "winner-glow-breathe 2s ease-in-out infinite" } as const;
const STYLE_GLOW_BREATHE_MINE = { animation: "winner-glow-breathe-mine 2s ease-in-out infinite" } as const;
const STYLE_BADGE_SLIDE = { animation: "winner-badge-slide 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.3s both" } as const;

interface MiningGridProps {
  tileViewData: Array<{
    tileId: number;
    users: number;
    poolDisplay: string;
    hasMyBet: boolean;
  }>;
  selectedTiles: number[];
  winningTileId: number | null;
  isRevealing: boolean;
  isAnalyzing: boolean;
  showSelection: boolean;
  onTileClick: (tileId: number) => void;
}

export const MiningGrid = React.memo(function MiningGrid({
  tileViewData,
  selectedTiles,
  winningTileId,
  isRevealing,
  isAnalyzing,
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
    setShowConfetti(!!myBet);
    setConfettiIsMyWin(!!myBet);
    const timer = setTimeout(() => setLoreMsg(null), 4000);
    return () => clearTimeout(timer);
  }, [isRevealing, winningTileId, tileViewData]);

  return (
    <div className="relative rounded-xl bg-[#0d0d1a] border border-violet-500/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_20px_rgba(139,92,246,0.06)] h-[calc(100vh-13rem)]">
      <div className="grid grid-cols-5 grid-rows-5 gap-1.5 p-2 h-full">
        {TILE_INDICES.map((i) => {
          const tile = tileViewData[i] ?? { tileId: i + 1, users: 0, poolDisplay: "0.00", hasMyBet: false };
          const tileId = tile.tileId;

          return (
            <Tile
              key={tileId}
              tileId={tileId}
              index={i}
              displayAmount={tile.poolDisplay}
              tileUsers={tile.users}
              isWinner={winningTileId === tileId}
              isSelected={selectionSet.has(tileId)}
              hasMyBet={tile.hasMyBet}
              isRevealing={isRevealing}
              isAnalyzing={isAnalyzing}
              onTileClick={onTileClick}
            />
          );
        })}
      </div>

      <Confetti active={showConfetti} isMyWin={confettiIsMyWin} />

      {loreMsg && (
        <div
          className={`absolute inset-0 flex justify-center pointer-events-none z-40 ${
            winningTileId !== null && [22, 23, 24].includes(winningTileId)
              ? "items-start pt-4"
              : "items-end pb-4"
          }`}
        >
          <div className="animate-lore-toast px-5 py-2.5 rounded-lg bg-black/50 backdrop-blur-sm border border-violet-500/20 shadow-[0_0_24px_rgba(139,92,246,0.15)] max-w-[90%]">
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
  displayAmount,
  tileUsers,
  isWinner,
  isSelected,
  hasMyBet,
  isRevealing,
  isAnalyzing,
  onTileClick,
}: {
  tileId: number;
  index: number;
  displayAmount: string;
  tileUsers: number;
  isWinner: boolean;
  isSelected: boolean;
  hasMyBet: boolean;
  isRevealing: boolean;
  isAnalyzing: boolean;
  onTileClick: (id: number) => void;
}) {
  const handleClick = useCallback(() => onTileClick(tileId), [onTileClick, tileId]);
  const isMyWin = isWinner && hasMyBet;
  const isNeutralWinner = isWinner && !hasMyBet;
  // 4 distinct colors: 1 default (slate), 2 my bet (emerald), 3 round win (amber), 4 my win (sky)
  let base: string;
  if (isMyWin) {
    base = "border-sky-400/50 bg-sky-500/15 animate-winner-burst winner-tile-pulse-mine z-20 shadow-[0_0_20px_rgba(14,165,233,0.25)]";
  } else if (isNeutralWinner) {
    base = "border-amber-400/50 bg-amber-500/10 animate-winner-burst winner-tile-pulse z-20 shadow-[0_0_16px_rgba(251,191,36,0.2)]";
  } else if (isSelected) {
    base = "border-violet-500/60 bg-violet-500/15 shadow-[0_0_16px_rgba(139,92,246,0.25)] animate-glow-pulse";
  } else if (hasMyBet) {
    base = "border-emerald-500/40 bg-emerald-500/8 hover:bg-emerald-500/15 hover:border-emerald-400/60 hover:shadow-[0_0_16px_rgba(52,211,153,0.2)]";
  } else {
    base = "border-violet-500/10 bg-[#0f0f1e] hover:border-violet-500/30 hover:bg-[#13132a] hover:shadow-[0_0_20px_rgba(139,92,246,0.12)]";
  }

  const faded = isRevealing && !isWinner
    ? "opacity-10 pointer-events-none"
    : isAnalyzing
      ? "opacity-40 pointer-events-none"
      : "";
  const staggerClass = `stagger-${index + 1}`;
  const entranceAnim = !isRevealing && !isAnalyzing ? "animate-tile-enter" : "";

  return (
    <button
      onClick={handleClick}
      disabled={isRevealing || isAnalyzing}
      className={`relative rounded-lg border flex flex-col items-center justify-between overflow-hidden transition-all duration-200 group h-full w-full p-1.5 [contain:layout_paint] ${entranceAnim} ${staggerClass} ${base} ${faded}`}
    >
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none bg-gradient-to-br from-white/[0.03] to-transparent z-0" />

      <div className="flex justify-between items-start w-full relative z-10">
        <span className={`text-[10px] font-mono font-semibold flex items-center gap-1 ${
          isMyWin ? "text-sky-300" : isNeutralWinner ? "text-amber-300" : hasMyBet ? "text-emerald-400" : "text-gray-600"
        }`}>
          #{tileId}
          {hasMyBet && !isWinner && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-synced-pulse shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
          )}
          {isSelected && !isWinner && (
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0 shadow-[0_0_6px_rgba(139,92,246,0.6)]" />
          )}
        </span>
        <div className={`flex items-center gap-0.5 text-[10px] font-semibold ${isMyWin ? "text-sky-200" : isNeutralWinner ? "text-amber-200" : hasMyBet ? "text-emerald-300/90" : "text-gray-600"}`}>
          <span>{tileUsers}</span>
          <svg className="w-2.5 h-2.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" />
          </svg>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center w-full relative z-10">
        <span className={`font-black text-lg tracking-tight transition-all duration-200 ${
          isMyWin
            ? "text-sky-200 drop-shadow-[0_0_12px_rgba(14,165,233,0.7)]"
            : isNeutralWinner
              ? "text-amber-400 drop-shadow-[0_0_10px_rgba(251,191,36,0.7)]"
              : hasMyBet
                ? "text-emerald-200"
                : "text-white group-hover:text-violet-300 group-hover:drop-shadow-[0_0_8px_rgba(139,92,246,0.4)]"
        }`}>
          {displayAmount}
        </span>
      </div>

      {isNeutralWinner && (
        <>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
            <div className="w-full h-full rounded-lg border-2 border-amber-400/60 winner-shockwave" />
          </div>
          <div className="absolute inset-0 rounded-lg border-2 border-amber-400/50 pointer-events-none z-0 shadow-[inset_0_0_20px_rgba(251,191,36,0.08)]" style={STYLE_GLOW_BREATHE} />
          <div className="absolute top-1.5 left-1/2 -translate-x-1/2 pointer-events-none z-30 winner-crown">
            <svg className="w-3.5 h-3.5 text-amber-300 drop-shadow-[0_0_8px_rgba(251,191,36,0.8)]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L15 8L22 9L17 14L18 21L12 18L6 21L7 14L2 9L9 8L12 2Z" />
            </svg>
          </div>
          <div className="absolute bottom-0 inset-x-0 z-20" style={STYLE_BADGE_SLIDE}>
            <div className="bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500 text-black text-[8px] font-black uppercase tracking-[0.15em] py-0.5 text-center leading-tight">
              ROUND WIN
            </div>
          </div>
        </>
      )}

      {isMyWin && (
        <>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
            <div className="w-full h-full rounded-lg border-2 border-sky-400/60 winner-shockwave" />
          </div>
          <div className="absolute inset-0 rounded-lg border-2 border-sky-400/40 pointer-events-none z-0" style={STYLE_GLOW_BREATHE_MINE} />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
            <div className="absolute w-1.5 h-1.5 rounded-full bg-sky-300 winner-particle-1" />
            <div className="absolute w-1 h-1 rounded-full bg-sky-200 winner-particle-2" />
            <div className="absolute w-1.5 h-1.5 rounded-full bg-cyan-300 winner-particle-3" />
          </div>
          <div className="absolute top-1.5 left-1/2 -translate-x-1/2 pointer-events-none z-30 winner-crown">
            <svg className="w-4 h-4 text-sky-300 drop-shadow-[0_0_10px_rgba(14,165,233,0.8)]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5z" />
              <path d="M5 19h14v2H5z" opacity="0.5" />
            </svg>
          </div>
          <div className="absolute bottom-0 inset-x-0 z-20" style={STYLE_BADGE_SLIDE}>
            <div className="bg-gradient-to-r from-sky-500 via-cyan-400 to-sky-500 text-white text-[8px] font-black uppercase tracking-[0.15em] py-0.5 text-center shadow-[0_-4px_12px_rgba(14,165,233,0.4)] leading-tight">
              YOUR WIN
            </div>
          </div>
        </>
      )}

    </button>
  );
});
