"use client";

import React from "react";
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
    deposits,
    totalDeposited,
  });

  return (
    <div className="flex-1 flex flex-col gap-4 overflow-y-auto animate-fade-in">
      <AnalyticsAchievementsPanel
        achievementCards={achievementCards}
        deposits={deposits}
        depositsLoading={depositsLoading}
        unlockedCount={unlockedCount}
      />

      <AnalyticsDepositsPanel
        deposits={deposits}
        depositsError={depositsError}
        depositsLoading={depositsLoading}
        depositsRefreshing={depositsLoading && deposits !== null}
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
