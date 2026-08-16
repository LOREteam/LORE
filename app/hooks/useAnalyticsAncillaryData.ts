"use client";

import { useEffect, useMemo } from "react";
import { useDepositHistory } from "./useDepositHistory";
import { useJackpotHistory } from "./useJackpotHistory";

interface UseAnalyticsAncillaryDataOptions {
  activeTab: string;
  isPageVisible: boolean;
  embeddedWalletAddress?: string | null;
}

export function selectAnalyticsAncillaryActivation(
  activeTab: string,
  isPageVisible: boolean,
  embeddedWalletAddress?: string | null,
) {
  const readModelsEnabled = activeTab === "analytics" && isPageVisible;
  return {
    readModelsEnabled,
    depositRefreshEnabled: readModelsEnabled && Boolean(embeddedWalletAddress),
  };
}

type AnalyticsRefreshTimer = ReturnType<typeof setInterval>;

export function scheduleAnalyticsDepositRefresh({
  enabled,
  refresh,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
}: {
  enabled: boolean;
  refresh: () => void | Promise<void>;
  setIntervalImpl?: (callback: () => void, delayMs: number) => AnalyticsRefreshTimer;
  clearIntervalImpl?: (timer: AnalyticsRefreshTimer) => void;
}) {
  if (!enabled) return undefined;
  const intervalId = setIntervalImpl(() => {
    void refresh();
  }, 30_000);
  return () => clearIntervalImpl(intervalId);
}

export function useAnalyticsAncillaryData({
  activeTab,
  isPageVisible,
  embeddedWalletAddress,
}: UseAnalyticsAncillaryDataOptions) {
  const activation = selectAnalyticsAncillaryActivation(activeTab, isPageVisible, embeddedWalletAddress);
  const {
    data: deposits,
    loading: depositsLoading,
    metadataLoading: depositsMetadataLoading,
    lastLoadedAt: depositsLastLoadedAt,
    totalDeposited,
    error: depositsError,
    fetch: fetchDeposits,
    refresh: refreshDeposits,
  } = useDepositHistory(embeddedWalletAddress ?? undefined, activation.readModelsEnabled);

  useEffect(() => scheduleAnalyticsDepositRefresh({
    enabled: activation.depositRefreshEnabled,
    refresh: refreshDeposits,
  }), [activation.depositRefreshEnabled, refreshDeposits]);

  const {
    items: jackpotHistory,
    loading: jackpotHistoryLoading,
    error: jackpotHistoryError,
    refresh: refreshJackpotHistory,
  } = useJackpotHistory(activation.readModelsEnabled);

  return useMemo(
    () => ({
      deposits,
      depositsLoading,
      depositsMetadataLoading,
      depositsLastLoadedAt,
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
      depositsLastLoadedAt,
      depositsLoading,
      depositsMetadataLoading,
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
