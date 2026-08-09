"use client";

import React from "react";
import type { UnclaimedWin } from "../lib/types";
import { formatLineaWeiAmountDisplay } from "../lib/tokenAmountMath";
import { searchingQuotes, emptyStates } from "../lib/loreTexts";
import { LoreText } from "./LoreText";

interface RewardScannerProps {
  unclaimedWins: UnclaimedWin[];
  isScanning: boolean;
  isDeepScanning: boolean;
  isClaiming: boolean;
  onScan: () => void;
  onClaim: (epochId: string) => void;
  onClaimAll: () => void;
}

export const RewardScanner = React.memo(function RewardScanner({
  unclaimedWins,
  isScanning,
  isDeepScanning,
  isClaiming,
  onScan,
  onClaim,
  onClaimAll,
}: RewardScannerProps) {
  const claimAllLabel = isClaiming ? "Reward claim is already pending" : `Claim all ${unclaimedWins.length} rewards`;
  const scanLabel = isScanning ? "Reward scan is already running" : "Scan for unclaimed rewards";
  const claimOneLabel = isClaiming ? "Reward claim is already pending" : "Claim this reward";

  return (
    <div className="rounded-xl bg-surface-raised border border-violet-500/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_20px_rgba(139,92,246,0.06)] flex flex-col gap-0 shrink-0 max-h-65 overflow-y-auto [scrollbar-gutter:stable]">
      {/* Header */}
      <div className="sticky top-0 z-10 flex justify-between items-center border-b border-white/6 bg-surface-raised/95 backdrop-blur-sm pl-3 pr-4 py-2">
        <h3 className="text-[11px] font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <div className="w-1.5 h-3.5 bg-cyan-300 rounded-sm shadow-[0_0_8px_rgba(45,212,191,0.4)]" />
          Rewards
          {unclaimedWins.length > 0 && (
            <span className="text-[9px] bg-emerald-400/12 text-emerald-300 px-1.5 py-0.5 rounded-full border border-emerald-300/22 font-black">
              {unclaimedWins.length}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-3">
          {unclaimedWins.length > 1 && (
            <button
              type="button"
              aria-label={claimAllLabel}
              title={claimAllLabel}
              onClick={onClaimAll}
              disabled={isClaiming}
              className="h-6 px-2 bg-linear-to-r from-emerald-400 to-cyan-400 text-[#03110d] font-black text-[8px] uppercase tracking-widest rounded-md hover:from-emerald-300 hover:to-cyan-300 disabled:opacity-40 transition-all shadow-md shadow-cyan-500/16 hover:shadow-cyan-500/24 active:scale-[0.97]"
            >
              {isClaiming ? "WAIT..." : `CLAIM ALL (${unclaimedWins.length})`}
            </button>
          )}
          <button
            type="button"
            aria-label={scanLabel}
            title={scanLabel}
            onClick={onScan}
            disabled={isScanning}
            className="text-[9px] font-bold uppercase tracking-wider text-violet-400 hover:text-violet-300 transition-all duration-200 flex items-center gap-1 hover:drop-shadow-[0_0_6px_rgba(139,92,246,0.4)]"
          >
            <svg
              aria-hidden="true"
              className={`w-3.5 h-3.5 ${isScanning ? "animate-spin" : "hover:rotate-180 transition-transform duration-500"}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {isScanning ? "..." : "Scan"}
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="flex flex-col gap-1 px-3 py-2">
        {isDeepScanning && (
          <div role="status" aria-live="polite" className="mb-1 rounded-md border border-violet-500/20 bg-violet-500/8 px-2 py-1">
            <p className="text-[9px] leading-tight text-violet-300/90 font-semibold tracking-wide">
              Quick results are ready. Full reward history is still loading in background.
            </p>
          </div>
        )}
        {isScanning && unclaimedWins.length === 0 ? (
          <div role="status" aria-live="polite" aria-busy="true" className="flex items-center justify-center gap-2 py-2">
            <svg aria-hidden="true" className="w-3.5 h-3.5 animate-spin text-violet-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold"><LoreText items={searchingQuotes} /></span>
          </div>
        ) : unclaimedWins.length > 0 ? (
          unclaimedWins.map((win) => (
            <div
              key={win.epoch}
              className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 bg-emerald-400/8 border border-cyan-300/24 px-3 py-2 rounded-lg hover:bg-emerald-400/12 transition-colors group"
            >
              <div className="flex min-w-0 flex-col">
                <span className="text-[9px] text-cyan-300/62 uppercase font-bold tracking-wider">
                  #{win.epoch}
                </span>
                <span className="lore-nums text-[10px] font-bold text-emerald-400 whitespace-nowrap">
                  {formatLineaWeiAmountDisplay(win.amountWei, 4)} LINEA
                </span>
              </div>
              <button
                type="button"
                aria-label={claimOneLabel}
                title={claimOneLabel}
                onClick={() => onClaim(win.epoch)}
                disabled={isClaiming}
                className="h-6 px-2 bg-linear-to-r from-emerald-400 to-cyan-400 text-[#03110d] font-black text-[8px] uppercase tracking-wide rounded-md hover:from-emerald-300 hover:to-cyan-300 disabled:opacity-40 transition-all shadow-sm group-hover:shadow-cyan-500/22 active:scale-[0.95]"
              >
                {isClaiming ? "..." : "CLAIM"}
              </button>
            </div>
          ))
        ) : (
          <div className="flex items-center justify-center gap-1.5 py-1.5 text-gray-400">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <span className="text-[9px] font-bold tracking-widest italic normal-case"><LoreText items={emptyStates.rewards} /></span>
          </div>
        )}
      </div>
    </div>
  );
});
