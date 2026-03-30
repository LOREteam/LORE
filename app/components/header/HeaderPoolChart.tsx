"use client";

import React from "react";
import { UiButton } from "../ui/UiButton";
import { uiTokens } from "../ui/tokens";

interface HeaderPoolChartProps {
  chartHasData: boolean;
  coldBootDefaults?: boolean;
  hydrated?: boolean;
  linePath: string;
  liveStateReady?: boolean;
  muted: boolean;
  onToggleMute: () => void;
  realTotalStaked: number;
  rolloverAmount: number;
}

export function HeaderPoolChart({
  chartHasData,
  coldBootDefaults = false,
  hydrated = false,
  linePath,
  liveStateReady = true,
  muted,
  onToggleMute,
  realTotalStaked,
  rolloverAmount,
}: HeaderPoolChartProps) {
  return (
    <div className="min-[900px]:col-span-5 relative rounded-xl bg-[#080812] border border-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] overflow-hidden min-h-[76px] sm:min-h-[72px] animate-slide-up" style={{ animationDelay: "0.1s" }}>
      <div className="absolute top-2.5 left-3 z-20 pointer-events-none">
        <div className="text-[8px] sm:text-[9px] uppercase font-bold text-gray-500 tracking-wider flex flex-wrap items-center gap-1 mb-0.5 pr-10 sm:pr-12">
          Total Pool
          {hydrated && liveStateReady && rolloverAmount > 0 && (
            <span className="bg-emerald-500/15 text-emerald-400 px-1 py-px rounded text-[7px] border border-emerald-500/25">
              +{rolloverAmount.toFixed(2)} rollover
            </span>
          )}
        </div>
        <div className="text-base sm:text-lg font-black text-white leading-tight pr-10 sm:pr-12">
          {liveStateReady || coldBootDefaults ? (
            <>
              {realTotalStaked.toFixed(2)} <span className="text-violet-400 text-xs font-bold">LINEA</span>
            </>
          ) : (
            <span className="inline-flex items-center">
              <span className="inline-block h-4 w-20 rounded bg-white/10 animate-pulse" />
            </span>
          )}
        </div>
      </div>

      <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
        <defs>
          <pattern id="gridDots" width="16" height="16" patternUnits="userSpaceOnUse">
            <circle cx="8" cy="8" r="0.4" fill="rgba(139,92,246,0.15)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#gridDots)" />
        <line x1="0" y1="33%" x2="100%" y2="33%" stroke="rgba(139,92,246,0.06)" strokeWidth="1" strokeDasharray="4 8" />
        <line x1="0" y1="66%" x2="100%" y2="66%" stroke="rgba(139,92,246,0.06)" strokeWidth="1" strokeDasharray="4 8" />
      </svg>

      <div className="absolute bottom-0 left-0 w-full h-[60%]">
        {liveStateReady && chartHasData && (
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
            </defs>

            <path d={`${linePath} L 100,100 L 0,100 Z`} fill="url(#chartFill)" className="transition-all duration-700" />
            <path d={linePath} fill="none" stroke="url(#chartStroke)" strokeWidth="5" strokeLinecap="round" vectorEffect="non-scaling-stroke" className="transition-all duration-700" opacity="0.12" />
            <path d={linePath} fill="none" stroke="url(#chartStroke)" strokeWidth="1.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" className="transition-all duration-700" filter="url(#lineGlow)" />
          </svg>
        )}
      </div>

      <div className="absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-violet-500/40 to-transparent" />

      <UiButton
        onClick={onToggleMute}
        variant="ghost"
        size="xs"
        className={`absolute top-2 right-2 z-20 h-8 w-8 p-0 ${uiTokens.radius.sm} bg-black/60 border-white/20 text-violet-200 hover:text-violet-100 hover:border-violet-400/50`}
        title={muted ? "Unmute sounds" : "Mute sounds"}
        aria-label={muted ? "Unmute sounds" : "Mute sounds"}
      >
        {muted ? (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
          </svg>
        ) : (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          </svg>
        )}
      </UiButton>
    </div>
  );
}
