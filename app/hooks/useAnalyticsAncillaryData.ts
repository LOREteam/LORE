"use client";

import { useEffect } from "react";
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
  const {
    data: deposits,
    loading: depositsLoading,
    totalDeposited,
    error: depositsError,
    fetch: fetchDeposits,
    refresh: refreshDeposits,
  } = useDepositHistory(embeddedWalletAddress ?? undefined, activeTab === "analytics");

  useEffect(() => {
    if (activeTab !== "analytics" || !embeddedWalletAddress) return;
    const intervalId = setInterval(() => {
      void refreshDeposits();
    }, isPageVisible ? 30_000 : 120_000);
    return () => clearInterval(intervalId);
  }, [activeTab, embeddedWalletAddress, isPageVisible, refreshDeposits]);

  const {
    items: jackpotHistory,
    loading: jackpotHistoryLoading,
    error: jackpotHistoryError,
    refresh: refreshJackpotHistory,
  } = useJackpotHistory(isPageVisible);

  return {
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
  };
}
