"use client";

import { useEffect, useMemo } from "react";
import { useDepositHistory } from "./useDepositHistory";
import { useJackpotHistory } from "./useJackpotHistory";

interface UseAnalyticsAncillaryDataOptions {
  activeTab: string;
  isPageVisible: boolean;
  embeddedWalletAddress?: string | null;
}

export function useAnalyticsAncillaryData({
  activeTab,
  isPageVisible,
  embeddedWalletAddress,
}: UseAnalyticsAncillaryDataOptions) {
  const analyticsActive = activeTab === "analytics";
  const {
    data: deposits,
    loading: depositsLoading,
    totalDeposited,
    error: depositsError,
    fetch: fetchDeposits,
    refresh: refreshDeposits,
  } = useDepositHistory(embeddedWalletAddress ?? undefined, analyticsActive);

  useEffect(() => {
    if (!analyticsActive || !embeddedWalletAddress) return;
    const intervalId = setInterval(() => {
      void refreshDeposits();
    }, isPageVisible ? 30_000 : 120_000);
    return () => clearInterval(intervalId);
  }, [analyticsActive, embeddedWalletAddress, isPageVisible, refreshDeposits]);

  const {
    items: jackpotHistory,
    loading: jackpotHistoryLoading,
    error: jackpotHistoryError,
    refresh: refreshJackpotHistory,
  } = useJackpotHistory(analyticsActive);

  return useMemo(
    () => ({
      deposits,
      depositsLoading,
      totalDeposited,
      depositsError,
      fetchDeposits,
      refreshDeposits,
      jackpotHistory,
      jackpotHistoryLoading,
      jackpotHistoryError,
      refreshJackpotHistory,
    }),
    [
      deposits,
      depositsError,
      depositsLoading,
      fetchDeposits,
      jackpotHistory,
      jackpotHistoryError,
      jackpotHistoryLoading,
      refreshDeposits,
      refreshJackpotHistory,
      totalDeposited,
    ],
  );
}
