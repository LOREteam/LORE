"use client";

import { memo } from "react";
import type { RecentWin } from "../hooks/useRecentWins";

function shortenAddr(addr: string) {
  return addr.slice(0, 6) + "\u2026" + addr.slice(-4);
}

function WinItem({ w }: { w: RecentWin }) {
  return (
    <span className="flex h-[1.05rem] shrink-0 items-center gap-1 px-2.5 leading-none text-[10px] sm:text-[11px]">
      <span className="text-amber-400/80">*</span>
      <span className="font-mono text-gray-400">{shortenAddr(w.user)}</span>
      <span className="text-gray-500">won</span>
      <span className="lore-nums text-[10px] font-semibold text-emerald-300/72 sm:text-[11px]">
        {w.amount}
      </span>
      <span className="text-gray-500">LINEA</span>
      <span className="lore-nums text-gray-400">#{w.epoch}</span>
    </span>
  );
}

export const WinsTicker = memo(function WinsTicker({
  wins,
  reducedMotion = false,
}: {
  wins: RecentWin[];
  reducedMotion?: boolean;
}) {
  const duration = Math.max(wins.length * 3, 20);

  return (
    <div
      className={`relative h-[1.05rem] w-full self-center overflow-hidden border border-violet-500/10 bg-[#0d0d1a]/80 leading-none backdrop-blur-sm ${
        reducedMotion ? "overflow-x-auto overflow-y-hidden" : "overflow-hidden"
      }`}
    >
      {wins.length > 0 ? (
        reducedMotion ? (
          <div className="absolute inset-y-0 left-0 flex min-w-max items-center whitespace-nowrap pr-2">
            {wins.map((w, i) => (
              <WinItem key={`static-${w.epoch}-${w.user}-${i}`} w={w} />
            ))}
          </div>
        ) : (
          <div
            className="absolute inset-y-0 left-0 flex items-center whitespace-nowrap animate-ticker"
            style={{ animationDuration: `${duration}s` }}
          >
            {wins.map((w, i) => (
              <WinItem key={`a-${w.epoch}-${w.user}-${i}`} w={w} />
            ))}
            {wins.map((w, i) => (
              <WinItem key={`b-${w.epoch}-${w.user}-${i}`} w={w} />
            ))}
          </div>
        )
      ) : (
        <span className="absolute inset-y-0 left-0 inline-flex items-center px-2.5 leading-none whitespace-nowrap text-[10px] text-slate-500 animate-pulse">
          Waiting for winners&hellip;
        </span>
      )}
    </div>
  );
});
