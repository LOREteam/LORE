"use client";

import React, { useMemo } from "react";
import type { AchievementCard } from "../../hooks/useAnalyticsAchievements";
import type { AchievementRarity } from "./analyticsAchievements";
import { rarityLabel, rarityTextColor } from "./analyticsAchievements";
import { UiPanel } from "../ui/UiPanel";

interface AnalyticsAchievementsPanelProps {
  achievementCards: AchievementCard<AchievementRarity>[];
  deposits: unknown[] | null;
  depositsLoading: boolean;
  unlockedCount: number;
}

const rarityBadgeClass: Record<AchievementRarity, string> = {
  common: "border-white/10 bg-white/[0.04]",
  uncommon: "border-emerald-400/20 bg-emerald-500/[0.08]",
  rare: "border-sky-400/20 bg-sky-500/[0.08]",
  epic: "border-fuchsia-400/20 bg-fuchsia-500/[0.08]",
  legendary: "border-amber-400/20 bg-amber-500/[0.08]",
  exotic: "border-orange-400/20 bg-orange-500/[0.08]",
  divine: "border-cyan-300/25 bg-cyan-400/[0.09]",
};

const rarityGlowClass: Record<AchievementRarity, string> = {
  common: "shadow-[0_0_0_rgba(255,255,255,0)]",
  uncommon: "shadow-[0_0_18px_rgba(16,185,129,0.08)]",
  rare: "shadow-[0_0_18px_rgba(56,189,248,0.1)]",
  epic: "shadow-[0_0_22px_rgba(217,70,239,0.12)]",
  legendary: "shadow-[0_0_24px_rgba(251,191,36,0.14)]",
  exotic: "shadow-[0_0_24px_rgba(249,115,22,0.16)]",
  divine: "shadow-[0_0_28px_rgba(34,211,238,0.18)]",
};

const rarityIconFrameClass: Record<AchievementRarity, string> = {
  common: "from-slate-300/20 via-slate-200/10 to-white/15",
  uncommon: "from-emerald-400/35 via-emerald-300/15 to-lime-300/20",
  rare: "from-sky-400/35 via-cyan-300/15 to-blue-300/20",
  epic: "from-violet-400/40 via-fuchsia-400/25 to-pink-300/20",
  legendary: "from-amber-300/40 via-yellow-300/25 to-orange-300/20",
  exotic: "from-orange-400/45 via-rose-400/25 to-yellow-300/20",
  divine: "from-cyan-300/45 via-sky-300/30 to-white/20",
};

export const AnalyticsAchievementsPanel = React.memo(function AnalyticsAchievementsPanel({
  achievementCards,
  deposits,
  depositsLoading,
  unlockedCount,
}: AnalyticsAchievementsPanelProps) {
  const cards = useMemo(
    () =>
      achievementCards.map((achievement) => ({
        ...achievement,
        unlockedDateLabel: achievement.unlocked && achievement.unlockedAt
          ? new Date(achievement.unlockedAt).toLocaleDateString()
          : null,
      })),
    [achievementCards],
  );

  return (
    <UiPanel
      tone="default"
      padding="md"
      className="shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_20px_rgba(139,92,246,0.06)] px-4 py-2.5"
    >
      <div className="mb-2 flex flex-col gap-1.5 sm:relative sm:min-h-[20px] sm:flex-row sm:items-center sm:justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white">
          <div className="h-4 w-1 rounded-sm bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.45)]" />
          Achievements
        </h2>
        {(deposits === null || depositsLoading) && (
          <p className="text-[10px] leading-tight text-slate-500 sm:absolute sm:left-1/2 sm:-translate-x-1/2 sm:whitespace-nowrap">
            Progress fills after My Deposits loads below
          </p>
        )}
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 sm:ml-auto">
          Unlocked: <span className="text-amber-400">{unlockedCount}/{achievementCards.length}</span>
        </span>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-1 pr-1 [scrollbar-width:thin]">
        {cards.map((achievement) => (
          <div
            key={achievement.id}
            className={`flex h-[114px] w-[202px] shrink-0 flex-col rounded-xl border px-2.5 py-2 transition-all duration-300 ${
              achievement.unlocked
                ? `bg-gradient-to-br from-[#1a1a2f] via-[#161629] to-[#10101b] ${rarityGlowClass[achievement.rarity]} ${rarityBadgeClass[achievement.rarity]}`
                : "border-white/[0.07] bg-gradient-to-br from-[#141424] to-[#10101b] shadow-none"
            }`}
            title={achievement.description}
          >
            <div className="flex items-start gap-2 min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <div className={`relative h-7.5 w-7.5 shrink-0 [clip-path:polygon(30%_4%,70%_4%,96%_30%,96%_70%,70%_96%,30%_96%,4%_70%,4%_30%)] border border-white/15 bg-gradient-to-br shadow-[0_0_10px_rgba(255,255,255,0.06)] ${rarityIconFrameClass[achievement.rarity]}`}>
                  <div className="absolute inset-[1.5px] flex items-center justify-center border border-white/10 bg-[#171727] text-[12px] [clip-path:polygon(30%_4%,70%_4%,96%_30%,96%_70%,70%_96%,30%_96%,4%_70%,4%_30%)]">
                    {achievement.icon}
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className={`line-clamp-2 text-[13px] font-black leading-[1.02] ${achievement.unlocked ? "text-white" : "text-slate-200/90"}`}>
                    {achievement.title}
                  </div>
                  <div className={`mt-0.5 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.16em] ${rarityTextColor[achievement.rarity]} ${rarityBadgeClass[achievement.rarity]}`}>
                    {rarityLabel[achievement.rarity]}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-1.5 flex min-h-0 flex-col gap-0.5 overflow-hidden">
              <div className="line-clamp-2 min-h-[24px] text-[10px] leading-[1.2] text-slate-400">
                {achievement.description}
              </div>
              <div className="flex items-center justify-between gap-2 text-[8px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                <span>{achievement.unlocked ? "Unlocked" : "In Progress"}</span>
                <span>{Math.round(achievement.progressPct)}%</span>
              </div>
            </div>

            <div className="mt-1 w-full shrink-0">
              <div className="h-1.5 w-full overflow-hidden rounded-full border border-white/10 bg-black/40">
                <div
                  className={`h-full shrink-0 rounded-full transition-all duration-500 ${
                    achievement.unlocked
                      ? "bg-gradient-to-r from-emerald-400 via-lime-300 to-emerald-200"
                      : "bg-gradient-to-r from-violet-500 via-fuchsia-500 to-sky-400"
                  }`}
                  style={{
                    width: `${Math.min(100, Math.max(0, Number(achievement.progressPct) || 0))}%`,
                    minWidth: achievement.progressPct > 0 && achievement.progressPct < 100 ? "6px" : undefined,
                  }}
                />
              </div>
            </div>

            {achievement.unlocked && achievement.unlockedAt ? (
              <div className="mt-1 shrink-0 text-[8px] leading-none text-slate-500">
                unlocked {achievement.unlockedDateLabel}
              </div>
            ) : (
              <div className="mt-1 h-0 shrink-0" aria-hidden />
            )}
          </div>
        ))}
      </div>
    </UiPanel>
  );
});
