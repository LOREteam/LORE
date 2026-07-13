"use client";

import Image from "next/image";
import React from "react";
import { UiButton } from "../ui/UiButton";

const EMPTY_POOL_LINE_PATH = "M 1,57 C 14,57 14,57 27,57 C 40,57 40,57 53,57 C 66,57 66,57 79,57 C 90,57 90,57 99,57";

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
  coldBootDefaults = false,
  hydrated = false,
  linePath,
  liveStateReady = true,
  muted,
  onToggleMute,
  realTotalStaked,
  rolloverAmount,
}: HeaderPoolChartProps) {
  const chartId = React.useId().replace(/:/g, "");
  const previousTotalRef = React.useRef(realTotalStaked);
  const lastVisibleLinePathRef = React.useRef("");
  const [depositPulseActive, setDepositPulseActive] = React.useState(false);
  const chartStrokeId = `${chartId}-chart-stroke`;
  const gridId = `${chartId}-grid-dots`;
  const panelShadeId = `${chartId}-panel-shade`;
  const displayRolloverAmount =
    rolloverAmount > 0
      ? rolloverAmount
      : !liveStateReady && coldBootDefaults && realTotalStaked > 0
        ? realTotalStaked
        : 0;
  const fallbackLinePath = realTotalStaked > 0
    ? "M 1,56 C 10,56 10,56 19,56 C 28,56 28,50 37,50 C 46,50 46,50 55,50 C 64,50 64,46 73,46 C 82,46 82,46 91,46 C 95,46 95,43 99,43"
    : EMPTY_POOL_LINE_PATH;
  const visibleLinePath = hydrated ? (linePath || fallbackLinePath) : fallbackLinePath;
  const stableLinePath = visibleLinePath || lastVisibleLinePathRef.current;
  const showChartVisual = true;

  React.useEffect(() => {
    if (visibleLinePath) {
      lastVisibleLinePathRef.current = visibleLinePath;
    }
  }, [visibleLinePath]);

  React.useEffect(() => {
    const previous = previousTotalRef.current;
    previousTotalRef.current = realTotalStaked;
    if (realTotalStaked <= previous) return;

    setDepositPulseActive(true);
    const timeoutId = window.setTimeout(() => setDepositPulseActive(false), 1200);
    return () => window.clearTimeout(timeoutId);
  }, [realTotalStaked]);

  return (
    <div className="pool-vault-panel min-[900px]:col-span-5 min-[900px]:h-22.5 relative rounded-xl bg-[#080812] border border-white/6 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] overflow-hidden min-h-17 sm:min-h-16">
      <div className="absolute inset-y-0 left-2.5 z-20 flex w-[6.95rem] flex-col justify-center gap-0.75 pointer-events-none sm:left-3 sm:w-[8.8rem] sm:gap-1">
        <div>
          <div className="text-[8px] uppercase font-bold text-slate-500 tracking-wider leading-none">
            Total Pool
          </div>
          <div className="lore-hud-number mt-0.5 max-w-full truncate text-[15px] font-black text-white leading-none sm:text-lg">
            {liveStateReady || coldBootDefaults ? (
              <>
                {realTotalStaked.toFixed(2)}
              </>
            ) : (
              <span className="inline-flex items-center">
                <span className="inline-block h-4 w-20 rounded bg-white/10 animate-pulse" />
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[8px] font-black uppercase tracking-[0.16em] text-violet-300 leading-none">
            LINEA
          </div>
        </div>

        {displayRolloverAmount > 0 && (
          <div className="w-full pt-0.5 sm:pt-1">
            <div className="text-[7px] uppercase font-black tracking-[0.18em] text-emerald-300/70 leading-none">
              Rollover
            </div>
            <div className="lore-hud-number mt-0.5 max-w-full truncate text-[13px] font-black leading-none text-emerald-300 sm:text-sm">
              +{displayRolloverAmount.toFixed(2)}
            </div>
          </div>
        )}
      </div>

      <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
        <defs>
          <pattern id={gridId} width="16" height="16" patternUnits="userSpaceOnUse">
            <circle cx="8" cy="8" r="0.35" fill="rgba(139,92,246,0.13)" />
          </pattern>
          <linearGradient id={panelShadeId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(6,182,212,0.04)" />
            <stop offset="56%" stopColor="rgba(139,92,246,0.05)" />
            <stop offset="100%" stopColor="rgba(192,132,252,0.08)" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${gridId})`} />
        <rect width="100%" height="100%" fill={`url(#${panelShadeId})`} />
        <line x1="16%" y1="0" x2="16%" y2="100%" stroke="rgba(148,163,184,0.08)" strokeWidth="1" />
      </svg>

      <div className="absolute inset-y-0 left-[7.55rem] right-0 sm:left-[9.7rem] min-[900px]:left-[16%]">
        {showChartVisual && (
          <>
            <Image
              src="/pool-crystal-reservoir.png"
              alt=""
              aria-hidden="true"
              fill
              priority
              loading="eager"
              sizes="(min-width: 900px) 40vw, 60vw"
              className={`pool-crystal-art ${depositPulseActive ? "pool-crystal-art-flash" : ""}`}
            />
            {stableLinePath && (
              <div className="absolute -left-[4.5rem] right-0 top-[24%] z-10 h-[48%] sm:top-[32%] sm:h-[44%]">
                <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id={chartStrokeId} x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#06b6d4" />
                      <stop offset="50%" stopColor="#8b5cf6" />
                      <stop offset="100%" stopColor="#c084fc" />
                    </linearGradient>
                  </defs>

                  <path data-testid="header-pool-chart-line" d={stableLinePath} fill="none" stroke={`url(#${chartStrokeId})`} strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" className="transition-all duration-700" />
                </svg>
              </div>
            )}
          </>
        )}
      </div>

      <UiButton
        onClick={onToggleMute}
        variant="ghost"
        size="xs"
        className="absolute right-0 top-0 z-20 h-11 w-11 rounded-full border-0 bg-transparent p-0 text-violet-200 hover:bg-white/6 hover:text-violet-100"
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
