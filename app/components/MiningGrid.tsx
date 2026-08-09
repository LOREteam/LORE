"use client";

import React, { useMemo, useRef, useState, useEffect } from "react";
import Image from "next/image";
import { formatDecimalTextFixed } from "../lib/balanceFormatting";
import { GRID_SIZE } from "../lib/constants";
import { pickRandom, yourWinQuotes, roundWinQuotes } from "../lib/loreTexts";
import { Confetti } from "./Confetti";

const TILE_INDICES = Array.from({ length: GRID_SIZE }, (_, i) => i);

// Animation classes defined in globals.css — avoids inline style objects for SSR/cacheability
const CLASS_BADGE_SLIDE = "animate-winner-badge-slide";

function trimFixedDecimalText(value: string): string {
  return value.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function formatTileAmountFixed(value: string): string | null {
  return formatDecimalTextFixed(value.trim(), 2);
}

function isPositiveFixedDecimalText(value: string | null): boolean {
  return value !== null && !/^0(?:\.0+)?$/.test(value);
}

function compactTileAmount(value: string): string {
  const fixed = formatTileAmountFixed(value);
  return fixed === null ? value : trimFixedDecimalText(fixed);
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
  isDailyJackpot?: boolean;
  isWeeklyJackpot?: boolean;
  jackpotAmount?: number;
}

function selectedTilesEqual(a: number[], b: number[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function tileRowsEqual(a: MiningGridProps["tileViewData"], b: MiningGridProps["tileViewData"]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left.tileId !== right.tileId ||
      left.users !== right.users ||
      left.poolDisplay !== right.poolDisplay ||
      left.hasMyBet !== right.hasMyBet
    ) {
      return false;
    }
  }
  return true;
}

function miningGridPropsEqual(prev: MiningGridProps, next: MiningGridProps) {
  return (
    prev.coldBootDefaults === next.coldBootDefaults &&
    prev.liveStateReady === next.liveStateReady &&
    prev.winningTileId === next.winningTileId &&
    prev.isRevealing === next.isRevealing &&
    prev.isAnalyzing === next.isAnalyzing &&
    prev.reducedMotion === next.reducedMotion &&
    prev.showSelection === next.showSelection &&
    prev.onTileClick === next.onTileClick &&
    selectedTilesEqual(prev.selectedTiles, next.selectedTiles) &&
    tileRowsEqual(prev.tileViewData, next.tileViewData)
  );
}

function MiningGridView({
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
  const gridRef = useRef<HTMLDivElement | null>(null);
  const roundTransitionActive = isRevealing || isAnalyzing;

  const [loreMsg, setLoreMsg] = useState<string | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [confettiIsMyWin, setConfettiIsMyWin] = useState(false);
  const winningTileHasMyBet = useMemo(
    () => winningTileId !== null && Boolean(tileViewData.find((t) => t.tileId === winningTileId)?.hasMyBet),
    [tileViewData, winningTileId],
  );
  useEffect(() => {
    if (!isRevealing || winningTileId === null) {
      setLoreMsg(null);
      setShowConfetti(false);
      return;
    }
    setLoreMsg(pickRandom(winningTileHasMyBet ? yourWinQuotes : roundWinQuotes));
    setShowConfetti(winningTileHasMyBet);
    setConfettiIsMyWin(winningTileHasMyBet);
    const timer = setTimeout(() => setLoreMsg(null), 4000);
    return () => clearTimeout(timer);
  }, [isRevealing, winningTileId, winningTileHasMyBet]);

  useEffect(() => {
    const gridElement = gridRef.current;
    if (!gridElement) return;

    const handleGridClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const tileButton = target.closest<HTMLButtonElement>("button[data-tile-id]");
      if (!tileButton || !gridElement.contains(tileButton) || tileButton.disabled) return;

      const tileId = Number(tileButton.dataset.tileId);
      if (!Number.isSafeInteger(tileId) || tileId < 1 || tileId > GRID_SIZE) return;
      onTileClick(tileId);
    };

    gridElement.addEventListener("click", handleGridClick);
    return () => {
      gridElement.removeEventListener("click", handleGridClick);
    };
  }, [onTileClick]);

  return (
    <div className="ore-board-shell relative w-full aspect-square min-h-72 overflow-hidden rounded-[1.1rem] border border-violet-200/22 bg-[#070611]/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_0_32px_rgba(124,58,237,0.12),0_18px_54px_rgba(0,0,0,0.36)] sm:min-h-80 min-[900px]:aspect-auto min-[900px]:h-[calc(100dvh-13rem)] min-[900px]:min-h-88">
      <Image
        src="/jackpot-og-weekly-painted.png"
        alt=""
        fill
        loading="eager"
        sizes="(min-width: 900px) 75vw, 100vw"
        quality={85}
        className="pointer-events-none object-cover object-bottom"
        aria-hidden="true"
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(7,6,17,0.76),rgba(7,6,17,0.9))]" />
      <div
        ref={gridRef}
        data-round-transition={roundTransitionActive ? "true" : undefined}
        className="ore-grid relative z-10 grid h-full grid-cols-5 grid-rows-5 gap-1 p-1.5 sm:gap-1.5 sm:p-2"
      >
        {TILE_INDICES.map((i) => {
          const tile = tileViewData[i] ?? { tileId: i + 1, users: 0, poolDisplay: "0.00", hasMyBet: false };
          const tileId = tile.tileId;

          return (
            <Tile
              key={tileId}
              tileId={tileId}
              coldBootDefaults={coldBootDefaults}
              users={tile.users}
              displayAmount={liveStateReady || coldBootDefaults ? tile.poolDisplay : "..."}
              liveStateReady={liveStateReady}
              isWinner={winningTileId === tileId}
              isSelected={selectionSet.has(tileId)}
              hasMyBet={tile.hasMyBet}
              isRevealing={isRevealing}
              reducedMotion={reducedMotion}
            />
          );
        })}
      </div>

      <Confetti active={showConfetti} isMyWin={confettiIsMyWin} reducedMotion={reducedMotion} />

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
}

export const MiningGrid = React.memo(MiningGridView, miningGridPropsEqual);

const Tile = React.memo(function Tile({
  tileId,
  coldBootDefaults,
  users,
  displayAmount,
  liveStateReady,
  isWinner,
  isSelected,
  hasMyBet,
  isRevealing,
  reducedMotion,
}: {
  tileId: number;
  coldBootDefaults: boolean;
  users: number;
  displayAmount: string;
  liveStateReady: boolean;
  isWinner: boolean;
  isSelected: boolean;
  hasMyBet: boolean;
  isRevealing: boolean;
  reducedMotion: boolean;
}) {
  const isMyWin = isWinner && hasMyBet;
  const isNeutralWinner = isWinner && !hasMyBet;
  const compactAmount = liveStateReady || coldBootDefaults ? compactTileAmount(displayAmount) : "...";
  const hasDisplayedStake = isPositiveFixedDecimalText(formatTileAmountFixed(displayAmount));
  const isLiveDisplayReady = liveStateReady || coldBootDefaults;
  const showUserBadge = !isLiveDisplayReady || hasDisplayedStake;
  const displayedUsers =
    isLiveDisplayReady
      ? hasDisplayedStake
        ? Math.max(users, hasMyBet ? 1 : 0)
        : 0
      : users;
  const ariaLabel = buildTileAriaLabel({
    tileId,
    users: displayedUsers,
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
      ? "border-cyan-300/55 bg-emerald-400/12 z-20"
      : "border-cyan-300/55 bg-emerald-400/12 animate-winner-burst z-20";
  } else if (isNeutralWinner) {
    base = reducedMotion
      ? "border-amber-400/50 bg-amber-500/10 z-20"
      : "border-amber-400/50 bg-amber-500/10 animate-winner-burst z-20";
  } else if (isSelected) {
    base = "border-violet-200/70 bg-[#090716] shadow-[inset_0_0_0_1px_rgba(216,180,254,0.12),0_0_14px_rgba(139,92,246,0.22)]";
  } else if (hasMyBet) {
    base = "border-emerald-400/45 bg-transparent hover:border-emerald-300/65 hover:shadow-[0_0_18px_rgba(52,211,153,0.24)]";
  } else {
    base = "border-violet-300/16 bg-[#060514] hover:border-violet-300/35 hover:bg-[#100d22] hover:shadow-[0_0_20px_rgba(139,92,246,0.16)]";
  }

  const faded = isRevealing && !isWinner
    ? "ore-tile-resolving-dim pointer-events-none"
    : "";
  const isBackgroundWindow = hasMyBet && !isWinner;
  const stateClass = isMyWin
    ? "ore-tile-my-win"
    : isNeutralWinner
      ? "ore-tile-round-win"
      : hasMyBet
        ? "ore-tile-bet"
        : isSelected
          ? "ore-tile-selected"
          : "";
  const disabledClass = !liveStateReady || isRevealing ? "cursor-not-allowed" : "";

  return (
    <button
      type="button"
      data-tile-id={tileId}
      disabled={!liveStateReady || isRevealing}
      aria-label={ariaLabel}
      aria-pressed={isSelected && !isWinner}
      className={`ore-tile ${isBackgroundWindow ? "ore-tile-window" : "ore-tile-stone"} ${stateClass} relative h-full w-full min-h-0 overflow-hidden rounded-lg border p-1 transition-[border-color,background-color,box-shadow,opacity,transform,color] duration-200 group flex flex-col items-center justify-between sm:p-1.5 contain-[layout_paint] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-1 focus-visible:ring-offset-[#070712] ${base} ${faded} ${disabledClass}`}
    >
      <div className="relative z-10 flex w-full items-start justify-between gap-1">
        <span className={`lore-hud flex min-w-0 items-center gap-0.5 text-[7px] font-bold leading-none sm:gap-1 sm:text-[10px] ${
          isMyWin ? "text-cyan-200" : isNeutralWinner ? "text-amber-300" : hasMyBet ? "text-emerald-400" : isSelected ? "text-violet-200" : "text-gray-400"
        }`}>
          #{tileId}
        </span>

        {showUserBadge && (
          <span
            className={`lore-hud flex items-center gap-0.5 text-[7px] font-bold leading-none sm:gap-1 sm:text-[10px] ${
              isMyWin
                ? "text-cyan-100/75"
                : isNeutralWinner
                  ? "text-amber-200/70"
                  : hasMyBet
                    ? "text-emerald-200/80"
                    : isSelected
                      ? "text-violet-100/70"
                    : "text-gray-400"
            }`}
          >
            <span>{isLiveDisplayReady ? displayedUsers : "-"}</span>
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
        )}
      </div>

      <div className="relative z-10 flex w-full flex-1 items-center justify-center px-0.5">
        <span className={`lore-hud-number block w-full max-w-full px-0.5 text-center text-[clamp(0.82rem,2.65vw,1.14rem)] font-black leading-none tracking-normal transition-colors duration-200 sm:text-[1.35rem] ${
          isMyWin
            ? "text-cyan-100 drop-shadow-[0_0_7px_rgba(45,212,191,0.42)]"
            : isNeutralWinner
              ? "text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.46)]"
            : hasMyBet
                ? "text-emerald-100 drop-shadow-[0_0_7px_rgba(52,211,153,0.2)]"
                : "text-slate-50 drop-shadow-[0_1px_7px_rgba(255,255,255,0.07)] group-hover:text-violet-100 group-hover:drop-shadow-[0_0_8px_rgba(139,92,246,0.36)]"
        }`}>
          {compactAmount}
        </span>
      </div>
      {isNeutralWinner && (
        <>
          <div className="absolute inset-0 rounded-lg border-2 border-amber-400/45 pointer-events-none z-0 shadow-[inset_0_0_12px_rgba(251,191,36,0.07)]" />
          <div className={`absolute bottom-0 inset-x-0 z-20 ${reducedMotion ? "" : CLASS_BADGE_SLIDE}`}>
            <div className="bg-linear-to-r from-amber-500 via-yellow-400 to-amber-500 px-1 py-0.5 text-center text-[6px] font-black uppercase leading-none tracking-[0.08em] text-black sm:text-[8px] sm:tracking-[0.15em]">
              ROUND WIN
            </div>
          </div>
        </>
      )}

      {isMyWin && (
        <>
          <div className="absolute inset-0 rounded-lg border-2 border-cyan-300/38 pointer-events-none z-0 shadow-[inset_0_0_12px_rgba(45,212,191,0.08)]" />
          <div className={`absolute bottom-0 inset-x-0 z-20 ${reducedMotion ? "" : CLASS_BADGE_SLIDE}`}>
            <div className="bg-linear-to-r from-emerald-500 via-cyan-300 to-sky-400 px-1 py-0.5 text-center text-[6px] font-black uppercase leading-none tracking-[0.08em] text-[#02110f] shadow-[0_-3px_8px_rgba(45,212,191,0.22)] sm:text-[8px] sm:tracking-[0.15em]">
              YOUR WIN
            </div>
          </div>
        </>
      )}

    </button>
  );
});
