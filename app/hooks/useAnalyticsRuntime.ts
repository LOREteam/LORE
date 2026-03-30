"use client";

import type { DepositEntry } from "./useDepositHistory";
import { useAnalyticsAchievements } from "./useAnalyticsAchievements";
import { useAnalyticsDepositWindow } from "./useAnalyticsDepositWindow";
import { useAnalyticsRowHighlights } from "./useAnalyticsRowHighlights";
import { achievementDefs, achievementRarity } from "../components/analytics/analyticsAchievements";

interface AnalyticsHistoryRow {
  roundId: string;
  poolDisplay: string;
  winningTile: string;
  isResolved: boolean;
  userWon: boolean;
  isDailyJackpot: boolean;
  isWeeklyJackpot: boolean;
}

interface UseAnalyticsRuntimeOptions {
  walletAddress?: string;
  historyViewData: AnalyticsHistoryRow[];
  deposits: DepositEntry[] | null;
  totalDeposited: number;
}

export function useAnalyticsRuntime({
  walletAddress,
  historyViewData,
  deposits,
  totalDeposited,
}: UseAnalyticsRuntimeOptions) {
  const { visibleCount, visibleDeposits, hasMore, showMore } = useAnalyticsDepositWindow(deposits);
  const { newHistoryIds, newDepositIds } = useAnalyticsRowHighlights(historyViewData, deposits);
  const { achievementCards, unlockedCount } = useAnalyticsAchievements({
    walletAddress,
    deposits,
    totalDeposited,
    definitions: achievementDefs,
    rarityById: achievementRarity,
    defaultRarity: "common",
  });

  return {
    visibleCount,
    visibleDeposits,
    hasMore,
    showMore,
    newHistoryIds,
    newDepositIds,
    achievementCards,
    unlockedCount,
  };
}
