"use client";
import React, { useLayoutEffect, useMemo, useState } from "react";
import { usePublicClient, useWriteContract } from "wagmi";
import { getAddress, parseUnits } from "viem";
import { useGameData } from "./hooks/useGameData";
import { useChartData } from "./hooks/useChartData";
import { usePrivy } from "@privy-io/react-auth";
import { usePrivyWallet } from "./hooks/usePrivyWallet";
import { useRebate } from "./hooks/useRebate";
import { useReducedMotion } from "./hooks/useReducedMotion";
import { useSound } from "./hooks/useSound";
import { Sidebar } from "./components/Sidebar";
import { Header } from "./components/Header";
import { MobileTabNav } from "./components/MobileTabNav";
import { PageTabContent } from "./components/PageTabContent";
import { WalletShell } from "./components/WalletShell";
import { usePageAncillaryData } from "./hooks/usePageAncillaryData";
import { useAppShellState } from "./hooks/useAppShellState";
import { useLineaOreHubRuntime } from "./hooks/useLineaOreHubRuntime";
import { useLineaOreWalletRuntime } from "./hooks/useLineaOreWalletRuntime";
import { OfflineBanner } from "./components/OfflineBanner";
import { NoticeStack } from "./components/NoticeStack";
import { PageBackdrop } from "./components/PageBackdrop";
import { FloatingActions } from "./components/FloatingActions";
import { APP_CHAIN_ID } from "./lib/constants";
import { createLineaOreClientViewProps } from "./lib/lineaOreClientViewProps";
import { useStableChatWalletAddress } from "./hooks/useStableChatWalletAddress";
import type { LiveStateApiResponse } from "./hooks/useGameLiveStateSnapshot";

const MIN_ETH_FOR_GAS = 0.0005; // conservative floor for approve/placeBatchBets on Linea
const MIN_ETH_WITHDRAW_RESERVE_WEI = parseUnits("0.0005", 18);

interface LineaOreClientProps {
  initialLiveState?: LiveStateApiResponse | null;
  initialNowMs?: number;
}

export default function LineaOreClient({
  initialLiveState = null,
  initialNowMs = 0,
}: LineaOreClientProps) {
  const [uiHydrated, setUiHydrated] = useState(false);
  const { reducedMotion, setReducedMotion, motionReady } = useReducedMotion();
  const { play: playSound, muted: soundMuted, toggleMute: toggleSoundMute, soundSettings, setSoundEnabled } = useSound();
  const { writeContractAsync } = useWriteContract();
  const { getAccessToken } = usePrivy();
  const {
    embeddedWalletAddress,
    externalWalletAddress,
    embeddedWalletSyncing,
    ensureEmbeddedWallet,
    exportEmbeddedWallet,
    createEmbeddedWallet,
    sendTransactionSilent,
    sendTransactionFromExternal,
  } = usePrivyWallet();

  const normalizedEmbeddedAddress = useMemo(() => {
    if (!embeddedWalletAddress) return undefined;
    try {
      return getAddress(embeddedWalletAddress);
    } catch {
      return undefined;
    }
  }, [embeddedWalletAddress]);

  const {
    activeTab,
    chatOpen,
    isPageVisible,
    isWalletSettingsOpen,
    backupGateVersion,
    visibleHotTiles,
    notices,
    setChatOpen,
    handleTabChange,
    dismissNotice,
    notify,
    syncHotTiles,
    openWalletSettings,
    closeWalletSettings,
    handleBackupConfirm,
  } = useAppShellState();

  // --- On-chain data ---
  const gameData = useGameData({
    historyDetailed: activeTab === "analytics",
    initialServerLiveState: initialLiveState,
    liveGrid: activeTab === "hub",
    preferredAddress: normalizedEmbeddedAddress,
  });
  const {
    address, visualEpoch, gridDisplayEpoch, isRevealing, timeLeft,
    realTotalStaked, rolloverAmount, jackpotInfo, formattedLineaBalance, winningTileId, hasMyWinningBet,
    isDailyJackpot, isWeeklyJackpot, jackpotAmount,
    currentEpochResolved,
    tileViewData,
    epochDurationChange,
    liveStateBootstrapPending,
    liveStateReady,
    actualCurrentEpoch, historyViewData, historyLoading, historyRefreshing,
    refetchEpoch, refetchGridEpochData, refetchTileData, refetchUserBets, refetchAllowance,
  } = gameData;
  const chatWalletAddress = useStableChatWalletAddress(
    normalizedEmbeddedAddress,
    externalWalletAddress,
    address,
  );
  useLayoutEffect(() => {
    setUiHydrated(true);
  }, []);

  const coldBootDefaults = uiHydrated && liveStateBootstrapPending && !liveStateReady;
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });
 

  // --- Chart ---
  const { chartData, linePath } = useChartData(realTotalStaked, isPageVisible);

  // --- Participation rebate ---
  const {
    rebateInfo,
    isClaiming: isClaimingRebate,
    claimRebates,
  } = useRebate({
    enabled: Boolean(normalizedEmbeddedAddress),
    active: activeTab === "rebate",
    isPageVisible,
    preferredAddress: normalizedEmbeddedAddress,
    sendTransactionSilent,
    onNotify: notify,
  });

  const {
    deposits,
    depositsLoading,
    totalDeposited,
    depositsError,
    fetchDeposits,
    refreshDeposits,
    walletTransfers,
    walletTransfersLoading,
    fetchWalletTransfers,
    deepScanWins,
    deepScanScanning,
    deepScanClaiming,
    deepScanProgress,
    deepScan,
    deepScanStop,
    deepClaimOne,
    claimAllDeep,
    leaderboardsData,
    leaderboardsLoading,
    leaderboardsError,
    leaderboardsRefetch,
    recentWins,
    jackpotHistory,
    jackpotHistoryLoading,
    jackpotHistoryError,
    refreshJackpotHistory,
  } = usePageAncillaryData({
    activeTab,
    isPageVisible,
    embeddedWalletAddress,
    externalWalletAddress,
    notify,
    sendTransactionSilent,
  });
  const {
    embeddedTokenBalance,
    embeddedEthBalance,
    formattedPrivyBalance,
    formattedPrivyEthBalance,
    headerLineaBalance,
    headerLineaLoading,
    headerEthLoading,
    embeddedAddressCopied,
    handleCopyEmbeddedAddress,
    withdrawAmount,
    setWithdrawAmount,
    withdrawEthAmount,
    setWithdrawEthAmount,
    depositEthAmount,
    setDepositEthAmount,
    depositTokenAmount,
    setDepositTokenAmount,
    isWithdrawing,
    isWithdrawingEth,
    isDepositingEth,
    isDepositingToken,
    pendingTransactionStatus,
    isRefreshingPendingTx,
    isCancellingPendingTx,
    handleWithdrawToExternal,
    handleWithdrawEthToExternal,
    handleDepositEthToEmbedded,
    handleDepositTokenToEmbedded,
    refreshPendingTransactionStatus,
    cancelPendingTransaction,
  } = useLineaOreWalletRuntime({
    address,
    normalizedEmbeddedAddress,
    formattedLineaBalance,
    isPageVisible,
    embeddedWalletAddress,
    externalWalletAddress,
    writeContractAsync,
    sendTransactionSilent,
    sendTransactionFromExternal,
    publicClient,
    walletTransfers,
    fetchWalletTransfers,
    notify,
    openWalletSettings,
    minEthForGas: MIN_ETH_FOR_GAS,
    minEthWithdrawReserveWei: MIN_ETH_WITHDRAW_RESERVE_WEI,
  });
  const {
    isPending,
    selectedTiles,
    isAutoMining,
    autoMineProgress,
    runningParams,
    gridSelectedTiles,
    isAnalyzing,
    showSelectionOnGrid,
    unclaimedWins,
    isScanning,
    isDeepScanning,
    isClaiming,
    scanRewards,
    claimReward,
    claimAll,
    lastBet,
    lowEthBalance,
    lowTokenBalance,
    balanceWarningDismissed,
    dismissBalanceWarning,
    handleManualMineWithGuard,
    handleRepeatLastBet,
    handleAutoMineWithGuard,
    stableTileClick,
  } = useLineaOreHubRuntime({
    activeTab,
    isPageVisible,
    embeddedWalletAddress,
    ensureEmbeddedWallet,
    getAccessToken,
    notify,
    playSound,
    refetchAllowance,
    refetchEpoch,
    refetchGridEpochData,
    refetchTileData,
    refetchUserBets,
    sendTransactionSilent,
    actualCurrentEpoch,
    gridDisplayEpoch,
    isRevealing,
    liveStateReady,
    timeLeft,
    visualEpoch,
    currentEpochResolved,
    embeddedEthBalance,
    historyViewData,
    publicClient,
    syncHotTiles,
    winningTileId,
    hasMyWinningBet,
    address,
    embeddedTokenBalance,
    openWalletSettings,
    minEthForGas: MIN_ETH_FOR_GAS,
  });

  const { sidebarProps, headerProps, walletShellProps, pageTabContentProps, floatingActionsProps } =
    createLineaOreClientViewProps({
      activeTab,
      actualCurrentEpoch,
      address,
      autoMineProgress,
      backupGateVersion,
      balanceWarningDismissed,
      chatOpen,
      claimAll,
      claimAllDeep,
      claimRebates,
      claimReward,
      closeWalletSettings,
      coldBootDefaults,
      createEmbeddedWallet,
      deepClaimOne,
      deepScan,
      deepScanClaiming,
      deepScanProgress,
      deepScanScanning,
      deepScanStop,
      deepScanWins,
      depositEthAmount,
      depositTokenAmount,
      deposits,
      depositsError,
      depositsLoading,
      dismissBalanceWarning,
      embeddedAddressCopied,
      embeddedWalletAddress,
      embeddedWalletSyncing,
      epochDurationChange,
      exportEmbeddedWallet,
      externalWalletAddress,
      fetchDeposits,
      fetchWalletTransfers,
      formattedLineaBalance,
      formattedPrivyBalance,
      formattedPrivyEthBalance,
      gridDisplayEpoch,
      gridSelectedTiles,
      handleAutoMineWithGuard,
      handleBackupConfirm,
      handleCopyEmbeddedAddress,
      handleDepositEthToEmbedded,
      handleDepositTokenToEmbedded,
      handleManualMineWithGuard,
      handleRepeatLastBet,
      handleTabChange,
      handleWithdrawEthToExternal,
      handleWithdrawToExternal,
      hasMyWinningBet,
      headerEthLoading,
      headerLineaBalance,
      headerLineaLoading,
      historyLoading,
      historyRefreshing,
      historyViewData,
      isAnalyzing,
      isAutoMining,
      isCancellingPendingTx,
      isClaiming,
      isClaimingRebate,
      isDailyJackpot,
      isDeepScanning,
      isDepositingEth,
      isDepositingToken,
      isPageVisible,
      isPending,
      isRefreshingPendingTx,
      isRevealing,
      isScanning,
      isWalletSettingsOpen,
      isWeeklyJackpot,
      isWithdrawing,
      isWithdrawingEth,
      jackpotAmount,
      jackpotHistory,
      jackpotHistoryError,
      jackpotHistoryLoading,
      jackpotInfo,
      lastBet,
      leaderboardsData,
      leaderboardsError,
      leaderboardsLoading,
      leaderboardsRefetch,
      liveStateReady,
      lowEthBalance,
      lowTokenBalance,
      chatWalletAddress,
      normalizedEmbeddedAddress,
      onChatOpenChange: setChatOpen,
      openWalletSettings,
      pendingTransactionStatus,
      rebateInfo,
      recentWins,
      reducedMotion,
      refreshDeposits,
      refreshJackpotHistory,
      refreshPendingTransactionStatus,
      rolloverAmount,
      runningParams,
      scanRewards,
      selectedTilesCount: selectedTiles.length,
      setDepositEthAmount,
      setDepositTokenAmount,
      setReducedMotion,
      setSoundEnabled,
      setWithdrawAmount,
      setWithdrawEthAmount,
      showSelectionOnGrid,
      soundMuted,
      soundSettings,
      stableTileClick,
      tileViewData,
      timeLeft,
      toggleSoundMute,
      totalDeposited,
      unclaimedWins,
      visibleHotTiles,
      visualEpoch,
      walletTransfers,
      walletTransfersLoading,
      winningTileId,
      withdrawAmount,
      withdrawEthAmount,
      cancelPendingTransaction,
    });

  return (
    <div
      className="min-h-dvh w-full flex flex-col overflow-x-hidden bg-[#060612] text-slate-200 lg:h-screen lg:flex-row lg:overflow-hidden"
      data-ui-hydrated={uiHydrated ? "true" : "false"}
    >
      <NoticeStack notices={notices} onDismiss={dismissNotice} />
      <PageBackdrop motionReady={motionReady} reducedMotion={reducedMotion} />

      <Sidebar {...sidebarProps} />

      <main className="relative z-10 flex min-w-0 flex-1 flex-col overflow-visible p-3 pb-20 animate-fade-in md:p-4 md:pb-24 lg:pb-4 lg:overflow-x-hidden lg:overflow-y-auto">
        <OfflineBanner />
        <MobileTabNav activeTab={activeTab} onTabChange={handleTabChange} />
        <Header
          initialNowMs={initialNowMs}
          realTotalStaked={realTotalStaked}
          linePath={linePath}
          chartHasData={chartData.length > 0}
          {...headerProps}
        />

        <WalletShell
          {...walletShellProps}
        />

        <PageTabContent {...pageTabContentProps} />

      </main>
      <FloatingActions {...floatingActionsProps} />
    </div>
  );
}
