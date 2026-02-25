"use client";

import { memo } from "react";
import type { RecentWin } from "../hooks/useRecentWins";

function shortenAddr(addr: string) {
  return addr.slice(0, 6) + "\u2026" + addr.slice(-4);
}

function WinItem({ w }: { w: RecentWin }) {
  return (
    <span className="inline-flex items-center gap-1 text-[9px] shrink-0 px-2.5">
      <span className="text-amber-400">★</span>
      <span className="font-mono text-gray-400">{shortenAddr(w.user)}</span>
      <span className="text-gray-600">won</span>
      <span className="font-bold text-emerald-400">{w.amount}</span>
      <span className="text-gray-600">LINEA</span>
      <span className="text-gray-700">#{w.epoch}</span>
    </span>
  );
}

export const WinsTicker = memo(function WinsTicker({ wins }: { wins: RecentWin[] }) {
  const duration = Math.max(wins.length * 3, 20);

  return (
    <div className="w-full overflow-hidden bg-[#0d0d1a]/80 border border-violet-500/10 backdrop-blur-sm h-5 flex items-center relative">
      {wins.length > 0 ? (
        <div
          className="flex whitespace-nowrap animate-ticker"
          style={{ animationDuration: `${duration}s` }}
        >
          {wins.map((w, i) => (
            <WinItem key={`a-${w.epoch}-${w.user}-${i}`} w={w} />
          ))}
          {wins.map((w, i) => (
            <WinItem key={`b-${w.epoch}-${w.user}-${i}`} w={w} />
          ))}
        </div>
      ) : (
        <span className="text-[9px] text-gray-500 px-3 whitespace-nowrap">
          Recent wins will appear here after claims on-chain
        </span>
      )}
    </div>
  );
});
