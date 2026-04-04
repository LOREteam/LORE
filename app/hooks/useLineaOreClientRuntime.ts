"use client";

import { useLayoutEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { getAddress, parseUnits } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";
import { APP_CHAIN_ID } from "../lib/constants";
import { createLineaOreClientViewProps } from "../lib/lineaOreClientViewProps";
import { useAppShellState } from "./useAppShellState";
import { useChartData } from "./useChartData";
import { useGameData } from "./useGameData";
import { type LiveStateApiResponse } from "./useGameLiveStateSnapshot";
import { useLineaOreHubRuntime } from "./useLineaOreHubRuntime";
import { useLineaOreWalletRuntime } from "./useLineaOreWalletRuntime";
import { usePageAncillaryData } from "./usePageAncillaryData";
import { usePrivyWallet } from "./usePrivyWallet";
import { useRebate } from "./useRebate";
import { useReducedMotion } from "./useReducedMotion";
import type { RecentWin } from "./useRecentWins";
import { useSound } from "./useSound";
import { useStableChatWalletAddress } from "./useStableChatWalletAddress";

const MIN_ETH_FOR_GAS = 0.0005;
const MIN_ETH_WITHDRAW_RESERVE_WEI = parseUnits("0.0005", 18);

interface UseLineaOreClientRuntimeOptions {
  initialLiveState?: LiveStateApiResponse | null;
  initialRecentWins?: RecentWin[];
}

export function useLineaOreClientRuntime({
  initialLiveState = null,
  initialRecentWins = [],
}: UseLineaOreClientRuntimeOptions) {
  const [uiHydrated, setUiHydrated] = useState(false);
  const { reducedMotion, setReducedMotion, motionReady } = useReducedMotion();
  const {
    play: playSound,
    muted: soundMuted,
    toggleMute: toggleSoundMute,
    soundSettings,
    setSoundEnabled,
  } = useSound();
  const { writeContractAsync } = useWriteContract();
  const { getAccessToken } = usePrivy();
  const {
    embeddedWalletAddress,
    externalWalletAddress,
    embeddedWalletSyncing,
    eip7702,
    ensureEmbeddedWallet,
    exportEmbeddedWallet,
    createEmbeddedWallet,
    eip7702Diagnostic,
    runEip7702Diagnostic,
    runEip7702SendDiagnostic,
    signEip7702Delegation,
    sendTransactionSilent,
    sendTransaction7702,
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

  const gameData = useGameData({
    historyDetailed: activeTab === "analytics",
    initialServerLiveState: initialLiveState,
    liveGrid: activeTab === "hub",
    preferredAddress: normalizedEmbeddedAddress,
  });
  const {
    address,
    visualEpoch,
    gridDisplayEpoch,
    isRevealing,
    timeLeft,
    realTotalStaked,
    rolloverAmount,
    jackpotInfo,
    formattedLineaBalance,
    winningTileId,
    hasMyWinningBet,
    isDailyJackpot,
    isWeeklyJackpot,
    jackpotAmount,
    currentEpochResolved,
    tileViewData,
    epochDurationChange,
    liveStateBootstrapPending,
    liveStateReady,
    timerReady,
    actualCurrentEpoch,
    historyViewData,
    historyLoading,
    historyRefreshing,
    refetchEpoch,
    refetchGridEpochData,
    refetchTileData,
    refetchUserBets,
    refetchAllowance,
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
  const { chartData, linePath } = useChartData(realTotalStaked, isPageVisible);

  const { rebateInfo, isClaiming: isClaimingRebate, claimRebates } = useRebate({
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
    initialRecentWins,
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
    sendTransaction7702,
    signEip7702Delegation,
    eip7702,
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

  const viewProps = createLineaOreClientViewProps({
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
    timerReady,
    lowEthBalance,
    lowTokenBalance,
    chatWalletAddress,
    normalizedEmbeddedAddress,
    onChatOpenChange: setChatOpen,
    openWalletSettings,
    pendingTransactionStatus,
    eip7702Diagnostic,
    onRunEip7702Diagnostic: runEip7702Diagnostic,
    onRunEip7702SendDiagnostic: runEip7702SendDiagnostic,
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

  return {
    uiHydrated,
    motionReady,
    reducedMotion,
    notices,
    dismissNotice,
    activeTab,
    handleTabChange,
    realTotalStaked,
    linePath,
    chartHasData: chartData.length > 0,
    ...viewProps,
  };
}
