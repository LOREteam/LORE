"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { shortenAddress } from "../lib/utils";
import type { LeaderboardEntry, LuckyTileEntry } from "../lib/types";
import { loadingQuotes, emptyStates, leaderboardLore } from "../lib/loreTexts";
import { LoreText } from "./LoreText";
import { useAddressNames } from "../hooks/useAddressNames";
import { cn } from "../lib/cn";
import { UiBadge } from "./ui/UiBadge";
import { UiButton } from "./ui/UiButton";
import { UiPanel } from "./ui/UiPanel";
import { uiTokens } from "./ui/tokens";

function Section({
  id,
  badge,
  title,
  desc,
  icon: Icon,
  delay,
  loreTitle,
  loreQuote,
  children,
}: {
  id: string;
  badge: string;
  title: string;
  desc: string;
  icon: React.FC<{ className?: string }>;
  delay: number;
  loreTitle?: string;
  loreQuote?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) setVisible(true);
    }, { threshold: 0.08 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <section
      id={id}
      ref={ref}
      className={cn("transition-all duration-700", visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8")}
      style={{ transitionDelay: `${delay}s` }}
    >
      <UiPanel tone="default" padding="md" className="bg-[#0a0a16]/70">
        <div className="flex items-center gap-3 mb-3">
          <div className={cn("w-10 h-10 bg-violet-500/10 border border-violet-500/25 flex items-center justify-center shrink-0", uiTokens.radius.sm)}>
            <Icon className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <UiBadge tone="violet" size="xs" uppercase className="mb-1 text-violet-300/80">
              {badge}
            </UiBadge>
            <h2 className="text-xl font-black text-white">{title}</h2>
            {loreTitle && <div className="text-[10px] font-bold text-amber-400/70 uppercase tracking-wider mt-0.5">{loreTitle}</div>}
          </div>
        </div>
        <p className="text-sm text-gray-400 leading-relaxed mb-1">{desc}</p>
        {loreQuote && <p className="text-xs text-violet-400/50 italic mb-4 lore-quote">&ldquo;{loreQuote}&rdquo;</p>}
        {!loreQuote && <div className="mb-3" />}
        {children}
      </UiPanel>
    </section>
  );
}

function LeaderboardTable({ entries, valueLabel, valueClass = "text-violet-400", resolveName }: {
  entries: LeaderboardEntry[];
  valueLabel: string;
  valueClass?: string;
  resolveName: (addr: string) => { display: string; source: "chat" | "raw" };
}) {
  if (!entries.length) {
    return (
      <UiPanel tone="subtle" padding="md" className="py-8 text-center text-gray-500 text-sm italic">
        <LoreText items={emptyStates.leaderboard} />
      </UiPanel>
    );
  }

  return (
    <UiPanel tone="subtle" padding="sm" className="overflow-hidden p-0">
      <div className="grid grid-cols-[3rem_1fr_auto] gap-2 px-4 py-3 border-b border-violet-500/10 text-[9px] font-bold uppercase tracking-widest text-gray-500">
        <span>#</span>
        <span>Miner</span>
        <span className="text-right">{valueLabel}</span>
      </div>
      <ul className="divide-y divide-white/5">
        {entries.map((e, i) => {
          const resolved = resolveName(e.address);
          return (
            <li
              key={`${e.address}-${e.rank}-${i}`}
              className="grid grid-cols-[3rem_1fr_auto] gap-2 px-4 py-2.5 items-center hover:bg-violet-500/[0.04] transition-colors"
            >
              <span className="text-xs font-black text-gray-500 tabular-nums">
                {e.rank === 1 ? "🥇" : e.rank === 2 ? "🥈" : e.rank === 3 ? "🥉" : e.rank}
              </span>
              <span className="font-mono text-sm text-gray-300 truncate" title={e.address}>
                {resolved.source === "chat" ? (
                  <>
                    <span className="font-sans font-semibold text-violet-300">{resolved.display}</span>
                    <UiBadge tone="default" size="xs" className="ml-1 text-[9px] text-gray-400 border-white/15 bg-white/[0.03]">
                      site
                    </UiBadge>
                    <span className="text-gray-600 ml-1.5">{shortenAddress(e.address)}</span>
                  </>
                ) : (
                  shortenAddress(e.address)
                )}
              </span>
              <span className={`text-sm font-bold text-right tabular-nums ${valueClass}`}>
                {e.value}
              </span>
            </li>
          );
        })}
      </ul>
    </UiPanel>
  );
}

function LuckyTileGrid({ entries }: { entries: LuckyTileEntry[] }) {
  if (!entries.length) {
    return (
      <UiPanel tone="subtle" padding="md" className="py-8 text-center text-gray-500 text-sm italic">
        <LoreText items={emptyStates.luckyTileGrid} />
      </UiPanel>
    );
  }

  const maxWins = Math.max(...entries.map((e) => e.wins), 1);

  return (
    <UiPanel tone="subtle" padding="md" className="p-4">
      <p className="text-[10px] text-gray-500 mb-3 uppercase tracking-wider font-bold">
        Tile # (1–25) vs times it won
      </p>
      <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
        {entries.slice(0, 25).map((e) => (
          <div
            key={e.tileId}
            className="rounded-lg border border-violet-500/20 bg-violet-500/[0.06] p-2 text-center transition-transform hover:scale-105"
          >
            <div className="text-[10px] font-black text-violet-400">#{e.tileId}</div>
            <div className="text-xs font-bold text-white mt-0.5">{e.wins}</div>
            <div className="h-1 mt-1 rounded-full bg-violet-500/20 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-500 to-emerald-500 transition-all duration-500"
                style={{ width: `${(e.wins / maxWins) * 100}%` }}
              />
            </div>
            <div className="text-[9px] text-gray-500 mt-0.5">{e.pct.toFixed(1)}%</div>
          </div>
        ))}
      </div>
    </UiPanel>
  );
}

const TrophyIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0116.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a9.004 9.004 0 01-1.77.896" />
  </svg>
);
const SparklesIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
  </svg>
);
const TargetIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);
const FireIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.601a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" />
  </svg>
);
const WhaleIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
  </svg>
);
const UnderdogIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
  </svg>
);
const GridIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
  </svg>
);
export function Leaderboards({
  data,
  loading,
  error,
  refetch,
}: {
  data: import("../hooks/useLeaderboards").LeaderboardsData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}) {
  const allAddresses = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    for (const list of [data.biggestSingleWin, data.luckiest, data.oneTileWonder, data.mostWins, data.whales, data.underdog]) {
      for (const e of list) set.add(e.address);
    }
    return [...set];
  }, [data]);

  const { resolveName } = useAddressNames(allAddresses);

  return (
    <div className="flex-1 overflow-y-auto pb-24 animate-fade-in">
      <div className="max-w-3xl mx-auto px-4 md:px-8">
        {/* Hero */}
        <div className="relative pt-5 pb-5 text-center overflow-hidden">
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="absolute w-1 h-1 rounded-full bg-amber-400/20"
                style={{
                  left: `${15 + (i * 10) % 70}%`,
                  top: `${20 + (i * 15) % 60}%`,
                  animation: `float ${4 + (i % 3)}s ease-in-out infinite`,
                  animationDelay: `${i * 0.2}s`,
                }}
              />
            ))}
          </div>
          <div className="relative z-10">
            <UiBadge
              tone="amber"
              size="sm"
              pill
              uppercase
              className="mb-6 animate-slide-up text-amber-300/95 border-amber-400/30 bg-amber-500/12"
            >
              <span className="text-base">🏆</span>
              On-chain leaderboards
            </UiBadge>
            <h1 className="text-4xl sm:text-5xl font-black mb-3 animate-slide-up" style={{ animationDelay: "0.05s" }}>
              <span className="text-white">Leader</span>
              <span className="bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 bg-clip-text text-transparent">boards</span>
            </h1>
            <p className="text-gray-400 text-sm max-w-lg mx-auto leading-relaxed animate-slide-up" style={{ animationDelay: "0.1s" }}>
              Who won the most, who got luckiest, and which tile loves to win. All data from the chain.
            </p>
            {loading && (
              <div className="mt-6 flex items-center justify-center gap-2 text-amber-400/80 text-sm">
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <LoreText items={loadingQuotes} />
              </div>
            )}
            {error && (
              <UiPanel tone="danger" padding="md" className="mt-6 text-red-300 text-sm">
                {error}
                <UiButton
                  onClick={() => refetch()}
                  variant="danger"
                  size="xs"
                  uppercase
                  className="ml-3"
                >
                  Retry
                </UiButton>
              </UiPanel>
            )}
            {!loading && !error && data && (
              <UiButton
                onClick={() => refetch()}
                variant="secondary"
                size="xs"
                uppercase
                className="mt-4"
              >
                Refresh data
              </UiButton>
            )}
          </div>
        </div>

        <div className="h-px bg-gradient-to-r from-transparent via-violet-500/20 to-transparent my-8" />

        {data && (
          <>
            <Section
              id="biggest-win"
              badge="01"
              title="Biggest single win"
              desc="One claim, one epoch – the largest reward ever taken in a single round. The ultimate jackpot moment."
              icon={TrophyIcon}
              delay={0}
              loreTitle={leaderboardLore.biggestWin.title}
              loreQuote={leaderboardLore.biggestWin.quote}
            >
              <LeaderboardTable entries={data.biggestSingleWin} valueLabel="LINEA" valueClass="text-amber-400" resolveName={resolveName} />
            </Section>

            <div className="h-px bg-gradient-to-r from-transparent via-violet-500/15 to-transparent my-8" />

            <Section
              id="luckiest"
              badge="02"
              title="Luckiest (ROI)"
              desc="Best return on investment: who turned the smallest total wagered into the biggest winnings. One bet, one win – or many small bets, many wins."
              icon={SparklesIcon}
              delay={0.05}
              loreTitle={leaderboardLore.luckiest.title}
              loreQuote={leaderboardLore.luckiest.quote}
            >
              <LeaderboardTable entries={data.luckiest} valueLabel="ROI" valueClass="text-emerald-400" resolveName={resolveName} />
            </Section>

            <div className="h-px bg-gradient-to-r from-transparent via-violet-500/15 to-transparent my-8" />

            <Section
              id="one-tile"
              badge="03"
              title="One tile wonder"
              desc="The biggest win from a single tile in a single round. One block, one bet, one massive payout."
              icon={TargetIcon}
              delay={0.1}
              loreTitle={leaderboardLore.oneTile.title}
              loreQuote={leaderboardLore.oneTile.quote}
            >
              <LeaderboardTable entries={data.oneTileWonder} valueLabel="LINEA" valueClass="text-sky-400" resolveName={resolveName} />
            </Section>

            <div className="h-px bg-gradient-to-r from-transparent via-violet-500/15 to-transparent my-8" />

            <Section
              id="most-wins"
              badge="04"
              title="Most wins"
              desc="How many times they hit the winning tile and claimed. Consistency (or stubbornness) pays off."
              icon={FireIcon}
              delay={0.15}
              loreTitle={leaderboardLore.mostWins.title}
              loreQuote={leaderboardLore.mostWins.quote}
            >
              <LeaderboardTable entries={data.mostWins} valueLabel="Wins" valueClass="text-violet-400" resolveName={resolveName} />
            </Section>

            <div className="h-px bg-gradient-to-r from-transparent via-violet-500/15 to-transparent my-8" />

            <Section
              id="whales"
              badge="05"
              title="Whales"
              desc="Total LINEA wagered across all rounds. The grinders and the high rollers."
              icon={WhaleIcon}
              delay={0.2}
              loreTitle={leaderboardLore.whales.title}
              loreQuote={leaderboardLore.whales.quote}
            >
              <LeaderboardTable entries={data.whales} valueLabel="LINEA wagered" valueClass="text-violet-400" resolveName={resolveName} />
            </Section>

            <div className="h-px bg-gradient-to-r from-transparent via-violet-500/15 to-transparent my-8" />

            <Section
              id="underdog"
              badge="06"
              title="Underdog"
              desc="Won when almost nobody had bet on that tile – the smallest pool on the winning tile. Maximum risk, maximum bragging rights."
              icon={UnderdogIcon}
              delay={0.25}
              loreTitle={leaderboardLore.underdog.title}
              loreQuote={leaderboardLore.underdog.quote}
            >
              <LeaderboardTable entries={data.underdog} valueLabel="LINEA won" valueClass="text-amber-400" resolveName={resolveName} />
            </Section>

            <div className="h-px bg-gradient-to-r from-transparent via-violet-500/15 to-transparent my-8" />

            <Section
              id="lucky-tile"
              badge="07"
              title="Lucky tile"
              desc="Which tile number (1–25) has won the most rounds in the scanned period. Pure statistics – no players, just the grid."
              icon={GridIcon}
              delay={0.3}
              loreTitle={leaderboardLore.luckyTile.title}
              loreQuote={leaderboardLore.luckyTile.quote}
            >
              <LuckyTileGrid entries={data.luckyTile} />
            </Section>
          </>
        )}

        {!data && !loading && !error && (
          <div className="py-16 text-center text-gray-500 text-sm italic">
            <LoreText items={emptyStates.leaderboardTab} />
          </div>
        )}
      </div>
    </div>
  );
}
