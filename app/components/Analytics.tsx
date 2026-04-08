"use client";

import React, { useMemo } from "react";
import type { DepositEntry } from "../hooks/useDepositHistory";
import type { JackpotHistoryEntry } from "../hooks/useJackpotHistory";
import { useAnalyticsRuntime } from "../hooks/useAnalyticsRuntime";
import { AnalyticsAchievementsPanel } from "./analytics/AnalyticsAchievementsPanel";
import { AnalyticsDepositsPanel } from "./analytics/AnalyticsDepositsPanel";
import { AnalyticsJackpotHistoryPanel } from "./analytics/AnalyticsJackpotHistoryPanel";
import { AnalyticsBlockchainHistoryPanel } from "./analytics/AnalyticsBlockchainHistoryPanel";

interface AnalyticsProps {
  walletAddress?: string;
  historyViewData: Array<{
    roundId: string;
    poolDisplay: string;
    winningTile: string;
    isResolved: boolean;
    userWon: boolean;
    isDailyJackpot: boolean;
    isWeeklyJackpot: boolean;
  }>;
  historyLoading: boolean;
  historyRefreshing: boolean;
  deposits: DepositEntry[] | null;
  depositsLoading: boolean;
  depositsError: string | null;
  totalDeposited: number;
  onLoadDeposits: () => void;
  onRefreshDeposits: () => void;
  jackpotHistory: JackpotHistoryEntry[];
  jackpotHistoryLoading: boolean;
  jackpotHistoryError: string | null;
  onRefreshJackpotHistory: () => void;
}

export const Analytics = React.memo(function Analytics({
  walletAddress,
  historyViewData,
  historyLoading,
  historyRefreshing,
  deposits,
  depositsLoading,
  depositsError,
  totalDeposited,
  onLoadDeposits,
  onRefreshDeposits,
  jackpotHistory,
  jackpotHistoryLoading,
  jackpotHistoryError,
  onRefreshJackpotHistory,
}: AnalyticsProps) {
  // Cross-reference jackpot history with deposits so that jackpot badges
  // display correctly even when the /api/epochs cache has stale flags.
  const enrichedDeposits = useMemo<DepositEntry[] | null>(() => {
    if (!deposits) return deposits;
    if (jackpotHistory.length === 0) return deposits;

    const dailyEpochs = new Set<string>();
    const weeklyEpochs = new Set<string>();
    for (const entry of jackpotHistory) {
      if (entry.kind === "daily") dailyEpochs.add(entry.epoch);
      else if (entry.kind === "weekly") weeklyEpochs.add(entry.epoch);
    }

    let changed = false;
    const result = deposits.map((d) => {
      const shouldBeDaily = d.isDailyJackpot || dailyEpochs.has(d.epoch);
      const shouldBeWeekly = d.isWeeklyJackpot || weeklyEpochs.has(d.epoch);
      if (shouldBeDaily !== d.isDailyJackpot || shouldBeWeekly !== d.isWeeklyJackpot) {
        changed = true;
        return { ...d, isDailyJackpot: shouldBeDaily, isWeeklyJackpot: shouldBeWeekly };
      }
      return d;
    });
    return changed ? result : deposits;
  }, [deposits, jackpotHistory]);

  const {
    visibleCount,
    visibleDeposits,
    hasMore,
    showMore,
    newHistoryIds,
    newDepositIds,
    achievementCards,
    unlockedCount,
  } = useAnalyticsRuntime({
    walletAddress,
    historyViewData,
    deposits: enrichedDeposits,
    totalDeposited,
  });

  return (
    <div className="flex-1 flex flex-col gap-4 overflow-y-auto animate-fade-in">
      <AnalyticsAchievementsPanel
        achievementCards={achievementCards}
        deposits={enrichedDeposits}
        depositsLoading={depositsLoading}
        unlockedCount={unlockedCount}
      />

      <AnalyticsDepositsPanel
        deposits={enrichedDeposits}
        depositsError={depositsError}
        depositsLoading={depositsLoading}
        depositsRefreshing={depositsLoading && enrichedDeposits !== null}
        newDepositIds={newDepositIds}
        onLoadDeposits={onLoadDeposits}
        onRefreshDeposits={onRefreshDeposits}
        showMore={showMore}
        totalDeposited={totalDeposited}
        visibleCount={visibleCount}
        visibleDeposits={visibleDeposits ?? []}
        hasMore={hasMore}
      />

      <AnalyticsJackpotHistoryPanel
        jackpotHistory={jackpotHistory}
        jackpotHistoryError={jackpotHistoryError}
        jackpotHistoryLoading={jackpotHistoryLoading}
        onRefreshJackpotHistory={onRefreshJackpotHistory}
      />

      <AnalyticsBlockchainHistoryPanel
        historyViewData={historyViewData}
        historyLoading={historyLoading}
        historyRefreshing={historyRefreshing}
        newHistoryIds={newHistoryIds}
      />
    </div>
  );
});
