"use client";

import { memo } from "react";
import type { RecentWin } from "../hooks/useRecentWins";
import { formatDecimalTextFixed, formatScaledUnitsFixed } from "../lib/balanceFormatting";

const MAX_VISIBLE_FEED_WINS = 10;

function shortenAddr(addr: string) {
  return addr.slice(0, 6) + "\u2026" + addr.slice(-4);
}

function jackpotLabel(kind: RecentWin["jackpotKind"]) {
  if (kind === "daily-weekly") return "Daily + Weekly";
  if (kind === "daily") return "Daily";
  if (kind === "weekly") return "Weekly";
  return null;
}

function trimFixedDecimalText(value: string): string {
  return value.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function normalizeDecimalText(value: string): string | null {
  const trimmed = value.trim();
  return /^\d+(?:\.\d+)?$/.test(trimmed) ? trimmed : null;
}

function isDecimalAtLeast(value: string, threshold: number): boolean {
  const whole = value.split(".")[0]?.replace(/^0+(?=\d)/, "") || "0";
  const thresholdText = String(threshold);
  if (whole.length !== thresholdText.length) return whole.length > thresholdText.length;
  return whole >= thresholdText;
}

function divideDecimalTextFixed(value: string, divisor: number, fractionDigits: number): string {
  const [wholeRaw, fractionalRaw = ""] = value.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
  const sourceScale = 10n ** BigInt(fractionalRaw.length);
  const scaledValue = BigInt(`${whole}${fractionalRaw}` || "0");
  const outputScale = 10n ** BigInt(fractionDigits);
  const denominator = sourceScale * BigInt(divisor);
  let scaledOutput = (scaledValue * outputScale) / denominator;
  const remainder = (scaledValue * outputScale) % denominator;
  if (remainder * 2n >= denominator) scaledOutput += 1n;
  return formatScaledUnitsFixed(scaledOutput, fractionDigits);
}

function compactAmount(amount: string) {
  const normalized = normalizeDecimalText(amount);
  if (normalized === null) return amount;
  if (isDecimalAtLeast(normalized, 1_000_000)) {
    return `${divideDecimalTextFixed(normalized, 1_000_000, isDecimalAtLeast(normalized, 10_000_000) ? 0 : 1)}M`;
  }
  if (isDecimalAtLeast(normalized, 1_000)) {
    return `${divideDecimalTextFixed(normalized, 1_000, isDecimalAtLeast(normalized, 100_000) ? 0 : 1)}K`;
  }
  return trimFixedDecimalText(formatDecimalTextFixed(normalized, 2) ?? amount);
}

function WinItem({ w }: { w: RecentWin }) {
  const jackpot = jackpotLabel(w.jackpotKind);
  const userLabel = shortenAddr(w.user);
  const chipClass = jackpot
    ? "border-amber-300/24 bg-amber-300/8 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_0_16px_rgba(251,191,36,0.08)]"
    : "";

  return (
    <span
      className={`chain-feed-chip flex h-[1.45rem] w-[14.75rem] shrink-0 items-center gap-1.5 overflow-hidden rounded-full border px-2 font-sans leading-none ${chipClass}`}
      title={`Epoch #${w.epoch}, +${w.amount} LINEA, ${userLabel}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${jackpot ? "bg-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.65)]" : "bg-emerald-400/85 shadow-[0_0_7px_rgba(52,211,153,0.45)]"}`} />
      <span className="lore-hud max-w-[5.25rem] shrink truncate rounded-full border border-violet-300/10 bg-violet-300/6 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.08em] text-violet-200/80">
        #{w.epoch}
      </span>
      {w.tileId && (
        <span className="lore-hud shrink-0 rounded-full border border-cyan-300/10 bg-cyan-300/7 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.08em] text-cyan-200/85">
          T{w.tileId}
        </span>
      )}
      <span className="lore-hud-number min-w-0 flex-1 truncate text-[10.5px] font-black tabular-nums text-emerald-200">
        +{compactAmount(w.amount)}
      </span>
      <span className="shrink-0 text-[8px] font-black uppercase tracking-[0.08em] text-slate-500">LINEA</span>
      <span className="hidden w-[4.2rem] shrink-0 font-mono text-[9px] font-semibold text-slate-400 sm:inline">{userLabel}</span>
      {jackpot && (
        <span className="shrink-0 rounded-full border border-amber-300/24 bg-amber-300/12 px-1 py-0.5 text-[7px] font-black uppercase tracking-[0.09em] text-amber-200">
          {jackpot === "Daily + Weekly" ? "D+W" : jackpot}
        </span>
      )}
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
  const visibleWins = wins.slice(0, MAX_VISIBLE_FEED_WINS);

  return (
    <div
      className={`chain-feed relative h-8 w-full self-center border border-violet-500/10 bg-surface-raised/80 leading-none backdrop-blur-sm ${
        reducedMotion ? "overflow-x-auto overflow-y-hidden" : "overflow-hidden"
      }`}
    >
      {visibleWins.length > 0 ? (
        <>
          <div className="absolute inset-0 flex items-center justify-center px-2 sm:hidden">
            <WinItem w={visibleWins[0]} />
          </div>
          <div
            className={`absolute inset-y-0 left-0 hidden min-w-max items-center gap-1.5 whitespace-nowrap pr-2 sm:flex ${
              reducedMotion ? "" : "animate-ticker"
            }`}
            style={reducedMotion ? undefined : { animationDuration: "96s" }}
          >
            {[...visibleWins, ...visibleWins].map((w, i) => (
              <WinItem key={`ticker-${i < visibleWins.length ? "a" : "b"}-${w.epoch}-${w.user}-${i}`} w={w} />
            ))}
          </div>
        </>
      ) : (
        <span className="absolute inset-y-0 left-0 inline-flex items-center px-2.5 leading-none whitespace-nowrap text-[10px] text-slate-500">
          Waiting for winners&hellip;
        </span>
      )}
    </div>
  );
});
