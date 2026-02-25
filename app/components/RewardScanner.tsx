"use client";

import React from "react";
import { formatUnits } from "viem";
import type { UnclaimedWin } from "../lib/types";
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
  return (
    <div className="p-3 rounded-xl bg-[#0d0d1a] border border-violet-500/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_20px_rgba(139,92,246,0.06)] flex flex-col gap-1 shrink-0 animate-slide-up" style={{ animationDelay: "0.15s" }}>
      {/* Header */}
      <div className="flex justify-between items-center border-b border-white/[0.06] pb-1.5">
        <h3 className="text-[11px] font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <div className="w-1.5 h-3.5 bg-amber-400 rounded-sm shadow-[0_0_8px_rgba(251,191,36,0.4)]" />
          Rewards
          {unclaimedWins.length > 0 && (
            <span className="text-[9px] bg-amber-400/15 text-amber-400 px-1.5 py-0.5 rounded-full border border-amber-400/25 animate-pulse font-black">
              {unclaimedWins.length}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-3">
          {unclaimedWins.length > 1 && (
            <button
              onClick={onClaimAll}
              disabled={isClaiming}
              className="px-2.5 py-0.5 bg-gradient-to-r from-amber-500 to-orange-500 text-black font-black text-[9px] uppercase tracking-widest rounded-md hover:from-amber-400 hover:to-orange-400 disabled:opacity-40 transition-all shadow-md shadow-amber-500/20 hover:shadow-amber-500/30 shimmer-btn active:scale-[0.97]"
            >
              {isClaiming ? "WAIT..." : `CLAIM ALL (${unclaimedWins.length})`}
            </button>
          )}
          <button
            onClick={onScan}
            disabled={isScanning}
            className="text-[9px] font-bold uppercase tracking-wider text-violet-400 hover:text-violet-300 transition-all duration-200 flex items-center gap-1 hover:drop-shadow-[0_0_6px_rgba(139,92,246,0.4)]"
          >
            <svg
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
      <div className="flex flex-col gap-1 max-h-[70px] overflow-y-auto pr-1">
        {isDeepScanning && (
          <div className="mb-1 rounded-md border border-violet-500/20 bg-violet-500/8 px-2 py-1">
            <p className="text-[9px] leading-tight text-violet-300/90 font-semibold tracking-wide">
              Quick results are ready. Full reward history is still loading in background.
            </p>
          </div>
        )}
        {isScanning && unclaimedWins.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-2">
            <svg className="w-3.5 h-3.5 animate-spin text-violet-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold"><LoreText items={searchingQuotes} /></span>
          </div>
        ) : unclaimedWins.length > 0 ? (
          unclaimedWins.map((win, idx) => (
            <div
              key={win.epoch}
              className="flex justify-between items-center bg-amber-500/8 border border-amber-500/20 p-1.5 rounded-lg animate-slide-up hover:bg-amber-500/12 transition-colors group"
              style={{ animationDelay: `${idx * 0.05}s` }}
            >
              <div className="flex items-center gap-2">
                <div className="w-0.5 h-6 rounded-full bg-gradient-to-b from-amber-400 to-orange-500" />
                <div className="flex flex-col">
                  <span className="text-[9px] text-amber-500/60 uppercase font-bold tracking-wider">
                    Round #{win.epoch}
                  </span>
                  <span className="text-xs font-bold text-emerald-400">
                    Won {formatUnits(BigInt(win.amountWei), 18)} LINEA
                  </span>
                </div>
              </div>
              <button
                onClick={() => onClaim(win.epoch)}
                disabled={isClaiming}
                className="px-3 py-1 bg-gradient-to-r from-amber-500 to-orange-500 text-black font-black text-[9px] uppercase tracking-widest rounded-md hover:from-amber-400 hover:to-orange-400 disabled:opacity-40 transition-all shadow-sm group-hover:shadow-amber-500/25 active:scale-[0.95]"
              >
                {isClaiming ? "..." : "CLAIM"}
              </button>
            </div>
          ))
        ) : (
          <div className="flex items-center justify-center gap-1.5 py-1.5 text-gray-600">
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
