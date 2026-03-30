"use client";

import React from "react";
import dynamic from "next/dynamic";

const LazyChatWidget = dynamic(() => import("./chat/ChatWidget").then((mod) => mod.ChatWidget), {
  loading: () => (
    <button
      className="w-9 h-9 rounded-full bg-violet-600/80 border border-violet-400/20 shadow-lg shadow-violet-500/20 flex items-center justify-center shrink-0"
      aria-label="Open chat"
      title="Open chat"
      disabled
    >
      <svg width="16" height="16" viewBox="0 0 20 20" fill="white">
        <path d="M3 3h14a1 1 0 011 1v9a1 1 0 01-1 1h-4l-3 3-3-3H3a1 1 0 01-1-1V4a1 1 0 011-1zm2 3h10v1.5H5V6zm0 3h7v1.5H5V9z" />
      </svg>
    </button>
  ),
});

interface FloatingActionsProps {
  walletAddress: string | null;
  onChatOpenChange: (open: boolean) => void;
}

export function FloatingActions({ walletAddress, onChatOpenChange }: FloatingActionsProps) {
  return (
    <div
      className="fixed right-3 z-[200]"
      style={{ bottom: "max(0.75rem, calc(env(safe-area-inset-bottom, 0px) + 0.35rem))" }}
    >
      <div className="hud-dock flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-[#070712]/84 p-1.5 shadow-[0_12px_34px_rgba(2,6,23,0.4)] backdrop-blur-xl">
        <a
          href="https://x.com/Linea_Ore"
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-slate-900/90 text-slate-200 transition-all duration-200 hover:-translate-y-0.5 hover:border-sky-400/30 hover:bg-slate-800 active:translate-y-0"
          title="X (Twitter) @Linea_Ore"
          aria-label="Linea Ore on X"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-slate-200">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </a>
        <a
          href="https://github.com/LOREteam/LORE"
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-slate-900/90 text-slate-200 transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-400/30 hover:bg-slate-800 active:translate-y-0"
          title="LORE on GitHub"
          aria-label="LORE on GitHub"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-slate-200">
            <path d="M12 .5C5.65.5.5 5.8.5 12.33c0 5.23 3.3 9.67 7.88 11.23.58.11.79-.26.79-.58 0-.29-.01-1.23-.02-2.23-3.2.71-3.88-1.39-3.88-1.39-.52-1.37-1.28-1.73-1.28-1.73-1.05-.74.08-.73.08-.73 1.16.08 1.78 1.22 1.78 1.22 1.03 1.82 2.69 1.29 3.35.99.1-.77.4-1.29.72-1.59-2.55-.3-5.23-1.31-5.23-5.81 0-1.28.44-2.33 1.17-3.15-.12-.3-.51-1.52.11-3.17 0 0 .95-.31 3.12 1.2a10.48 10.48 0 0 1 5.68 0c2.16-1.51 3.11-1.2 3.11-1.2.62 1.65.23 2.87.12 3.17.73.82 1.17 1.87 1.17 3.15 0 4.51-2.69 5.51-5.25 5.81.42.37.78 1.08.78 2.19 0 1.58-.01 2.86-.01 3.25 0 .32.2.7.8.58a11.87 11.87 0 0 0 7.87-11.23C23.5 5.8 18.35.5 12 .5Z" />
          </svg>
        </a>
        <LazyChatWidget walletAddress={walletAddress} onOpenChange={onChatOpenChange} />
      </div>
    </div>
  );
}
