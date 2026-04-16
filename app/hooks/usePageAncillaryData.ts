"use client";

import { useMemo } from "react";
import { useAnalyticsAncillaryData } from "./useAnalyticsAncillaryData";
import { useLeaderboards } from "./useLeaderboards";
import { useRecentWins } from "./useRecentWins";
import type { RecentWin } from "./useRecentWins";
import { useWalletAncillaryData } from "./useWalletAncillaryData";

type NotifyTone = "info" | "success" | "warning" | "danger";
type NotifyFn = (message: string, tone?: NotifyTone) => void;
type SilentSendFn = (
  tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint; nonce?: number },
  gasOverrides?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } | { gasPrice?: bigint },
) => Promise<`0x${string}`>;

interface UsePageAncillaryDataOptions {
  activeTab: string;
  isPageVisible: boolean;
  embeddedWalletAddress?: string | null;
  externalWalletAddress?: string | null;
  initialRecentWins?: RecentWin[];
  notify: NotifyFn;
  sendTransactionSilent?: SilentSendFn;
}

export function usePageAncillaryData({
  activeTab,
  isPageVisible,
  embeddedWalletAddress,
  externalWalletAddress,
  initialRecentWins = [],
  notify,
  sendTransactionSilent,
}: UsePageAncillaryDataOptions) {
  const analyticsData = useAnalyticsAncillaryData({
    activeTab,
    isPageVisible,
    embeddedWalletAddress,
  });

  const walletData = useWalletAncillaryData({
    embeddedWalletAddress,
    externalWalletAddress,
    notify,
    sendTransactionSilent,
  });

  const {
    data: leaderboardsData,
    loading: leaderboardsLoading,
    error: leaderboardsError,
    refetch: leaderboardsRefetch,
  } = useLeaderboards(activeTab === "leaderboards");

  const recentWins = useRecentWins(initialRecentWins);

  return useMemo(
    () => ({
      ...analyticsData,
      ...walletData,
      leaderboardsData,
      leaderboardsLoading,
      leaderboardsError,
      leaderboardsRefetch,
      recentWins,
    }),
    [
      analyticsData,
      walletData,
      leaderboardsData,
      leaderboardsLoading,
      leaderboardsError,
      leaderboardsRefetch,
      recentWins,
    ],
  );
}
