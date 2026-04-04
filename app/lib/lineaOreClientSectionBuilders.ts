import type React from "react";
import { FloatingActions } from "../components/FloatingActions";
import { Header } from "../components/Header";
import { PageTabContent } from "../components/PageTabContent";
import { Sidebar } from "../components/Sidebar";
import { WalletShell } from "../components/WalletShell";

type SidebarProps = React.ComponentProps<typeof Sidebar>;
type HeaderProps = React.ComponentProps<typeof Header>;
type WalletShellProps = React.ComponentProps<typeof WalletShell>;
type WalletSettingsProps = WalletShellProps["walletSettingsProps"];
type PageTabContentProps = React.ComponentProps<typeof PageTabContent>;
type FloatingActionsProps = React.ComponentProps<typeof FloatingActions>;

type BuildSidebarPropsOptions = {
  activeTab: SidebarProps["activeTab"];
  actualCurrentEpoch?: bigint;
  isPageVisible: SidebarProps["isPageVisible"];
  handleTabChange: SidebarProps["onTabChange"];
  visibleHotTiles: SidebarProps["hotTiles"];
  unclaimedWins: SidebarProps["unclaimedWins"];
  isScanning: SidebarProps["isScanning"];
  isDeepScanning: SidebarProps["isDeepScanning"];
  isClaiming: SidebarProps["isClaiming"];
  claimReward: SidebarProps["onClaim"];
  claimAll: SidebarProps["onClaimAll"];
};

export function buildSidebarProps({
  activeTab,
  actualCurrentEpoch,
  isPageVisible,
  handleTabChange,
  visibleHotTiles,
  unclaimedWins,
  isScanning,
  isDeepScanning,
  isClaiming,
  claimReward,
  claimAll,
}: BuildSidebarPropsOptions): SidebarProps {
  return {
    activeTab,
    currentEpoch: actualCurrentEpoch,
    isPageVisible,
    onTabChange: handleTabChange,
    hotTiles: visibleHotTiles,
    unclaimedWins,
    isScanning,
    isDeepScanning,
    isClaiming,
    onClaim: claimReward,
    onClaimAll: claimAll,
  };
}

type BuildHeaderPropsOptions = {
  visualEpoch: HeaderProps["visualEpoch"];
  isRevealing: HeaderProps["isRevealing"];
  coldBootDefaults: HeaderProps["coldBootDefaults"];
  liveStateReady: HeaderProps["liveStateReady"];
  timerReady: HeaderProps["timerReady"];
  timeLeft: HeaderProps["timeLeft"];
  rolloverAmount: HeaderProps["rolloverAmount"];
  jackpotInfo: HeaderProps["jackpotInfo"];
  embeddedWalletAddress: HeaderProps["embeddedWalletAddress"];
  embeddedWalletSyncing: HeaderProps["embeddedWalletSyncing"];
  formattedPrivyEthBalance: string | null;
  headerEthLoading: HeaderProps["privyEthBalanceLoading"];
  headerLineaBalance: HeaderProps["privyTokenBalance"];
  headerLineaLoading: HeaderProps["privyTokenBalanceLoading"];
  openWalletSettings: HeaderProps["onOpenWalletSettings"];
  soundMuted: HeaderProps["muted"];
  toggleSoundMute: HeaderProps["onToggleMute"];
  recentWins: HeaderProps["recentWins"];
  jackpotHistory: HeaderProps["jackpotHistory"];
  reducedMotion: HeaderProps["reducedMotion"];
  isPageVisible: HeaderProps["isPageVisible"];
  epochDurationChange: HeaderProps["epochDurationChange"];
};

export function buildHeaderProps({
  visualEpoch,
  isRevealing,
  coldBootDefaults,
  liveStateReady,
  timerReady,
  timeLeft,
  rolloverAmount,
  jackpotInfo,
  embeddedWalletAddress,
  embeddedWalletSyncing,
  formattedPrivyEthBalance,
  headerEthLoading,
  headerLineaBalance,
  headerLineaLoading,
  openWalletSettings,
  soundMuted,
  toggleSoundMute,
  recentWins,
  jackpotHistory,
  reducedMotion,
  isPageVisible,
  epochDurationChange,
}: BuildHeaderPropsOptions): Omit<HeaderProps, "initialNowMs" | "realTotalStaked" | "linePath" | "chartHasData"> {
  return {
    visualEpoch,
    isRevealing,
    coldBootDefaults,
    liveStateReady,
    timerReady,
    timeLeft,
    rolloverAmount,
    jackpotInfo,
    embeddedWalletAddress,
    embeddedWalletSyncing,
    privyEthBalance: formattedPrivyEthBalance ?? "0.0000",
    privyEthBalanceLoading: headerEthLoading,
    privyTokenBalance: headerLineaBalance,
    privyTokenBalanceLoading: headerLineaLoading,
    onOpenWalletSettings: openWalletSettings,
    muted: soundMuted,
    onToggleMute: toggleSoundMute,
    recentWins,
    jackpotHistory,
    showWinsTicker: true,
    reducedMotion,
    isPageVisible,
    epochDurationChange,
  };
}

type BuildWalletShellPropsOptions = {
  backupGateVersion: number;
  embeddedWalletAddress: string | null;
  exportEmbeddedWallet: WalletSettingsProps["onExportEmbeddedWallet"];
  handleBackupConfirm: WalletShellProps["backupProps"]["onConfirm"];
  isWalletSettingsOpen: WalletShellProps["showWalletSettings"];
  closeWalletSettings: WalletSettingsProps["onClose"];
  address?: WalletSettingsProps["connectedWalletAddress"];
  externalWalletAddress: string | null;
  formattedPrivyBalance: WalletSettingsProps["formattedLineaBalance"];
  formattedPrivyEthBalance: WalletSettingsProps["formattedEthBalance"];
  withdrawAmount: string;
  withdrawEthAmount: string;
  depositEthAmount: string;
  depositTokenAmount: string;
  isWithdrawing: WalletSettingsProps["isWithdrawing"];
  isWithdrawingEth: WalletSettingsProps["isWithdrawingEth"];
  isDepositingEth: WalletSettingsProps["isDepositingEth"];
  isDepositingToken: WalletSettingsProps["isDepositingToken"];
  setWithdrawAmount: WalletSettingsProps["onWithdrawAmountChange"];
  setWithdrawEthAmount: WalletSettingsProps["onWithdrawEthAmountChange"];
  setDepositEthAmount: WalletSettingsProps["onDepositEthAmountChange"];
  setDepositTokenAmount: WalletSettingsProps["onDepositTokenAmountChange"];
  createEmbeddedWallet: WalletSettingsProps["onCreateEmbeddedWallet"];
  handleCopyEmbeddedAddress: WalletSettingsProps["onCopyEmbeddedAddress"];
  embeddedAddressCopied: WalletSettingsProps["embeddedAddressCopied"];
  handleWithdrawToExternal: WalletSettingsProps["onWithdrawToExternal"];
  handleWithdrawEthToExternal: WalletSettingsProps["onWithdrawEthToExternal"];
  handleDepositEthToEmbedded: WalletSettingsProps["onDepositEthToEmbedded"];
  handleDepositTokenToEmbedded: WalletSettingsProps["onDepositTokenToEmbedded"];
  walletTransfers: WalletSettingsProps["walletTransfers"];
  walletTransfersLoading: WalletSettingsProps["walletTransfersLoading"];
  fetchWalletTransfers: WalletSettingsProps["onLoadWalletTransfers"];
  deepScanWins: WalletSettingsProps["deepScanWins"];
  deepScanScanning: WalletSettingsProps["deepScanScanning"];
  deepScanClaiming: WalletSettingsProps["deepScanClaiming"];
  deepScanProgress: WalletSettingsProps["deepScanProgress"];
  deepScan: WalletSettingsProps["onDeepScan"];
  deepScanStop: WalletSettingsProps["onDeepScanStop"];
  deepClaimOne: WalletSettingsProps["onDeepClaimOne"];
  claimAllDeep: WalletSettingsProps["onDeepClaimAll"];
  soundSettings: WalletSettingsProps["soundSettings"];
  setSoundEnabled: WalletSettingsProps["onSoundSettingChange"];
  reducedMotion: WalletSettingsProps["reducedMotion"];
  setReducedMotion: WalletSettingsProps["onReducedMotionChange"];
  pendingTransactionStatus: WalletSettingsProps["pendingTransactionStatus"];
  isRefreshingPendingTx: WalletSettingsProps["isRefreshingPendingTx"];
  isCancellingPendingTx: WalletSettingsProps["isCancellingPendingTx"];
  refreshPendingTransactionStatus: WalletSettingsProps["onRefreshPendingTx"];
  cancelPendingTransaction: WalletSettingsProps["onCancelPendingTx"];
  eip7702Diagnostic: WalletSettingsProps["eip7702Diagnostic"];
  runEip7702Diagnostic: WalletSettingsProps["onRunEip7702Diagnostic"];
  runEip7702SendDiagnostic: WalletSettingsProps["onRunEip7702SendDiagnostic"];
};

export function buildWalletShellProps({
  backupGateVersion,
  embeddedWalletAddress,
  exportEmbeddedWallet,
  handleBackupConfirm,
  isWalletSettingsOpen,
  closeWalletSettings,
  address,
  externalWalletAddress,
  formattedPrivyBalance,
  formattedPrivyEthBalance,
  withdrawAmount,
  withdrawEthAmount,
  depositEthAmount,
  depositTokenAmount,
  isWithdrawing,
  isWithdrawingEth,
  isDepositingEth,
  isDepositingToken,
  setWithdrawAmount,
  setWithdrawEthAmount,
  setDepositEthAmount,
  setDepositTokenAmount,
  createEmbeddedWallet,
  handleCopyEmbeddedAddress,
  embeddedAddressCopied,
  handleWithdrawToExternal,
  handleWithdrawEthToExternal,
  handleDepositEthToEmbedded,
  handleDepositTokenToEmbedded,
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
  soundSettings,
  setSoundEnabled,
  reducedMotion,
  setReducedMotion,
  pendingTransactionStatus,
  isRefreshingPendingTx,
  isCancellingPendingTx,
  refreshPendingTransactionStatus,
  cancelPendingTransaction,
  eip7702Diagnostic,
  runEip7702Diagnostic,
  runEip7702SendDiagnostic,
}: BuildWalletShellPropsOptions): WalletShellProps {
  return {
    backupGateVersion,
    backupProps: {
      embeddedWalletAddress,
      onExportPrivateKey: exportEmbeddedWallet,
      onConfirm: handleBackupConfirm,
    },
    showBackupGate: Boolean(embeddedWalletAddress),
    showWalletSettings: isWalletSettingsOpen,
    walletSettingsProps: {
      isOpen: isWalletSettingsOpen,
      onClose: closeWalletSettings,
      connectedWalletAddress: address,
      embeddedWalletAddress,
      externalWalletAddress,
      formattedLineaBalance: formattedPrivyBalance,
      formattedEthBalance: formattedPrivyEthBalance,
      withdrawAmount,
      withdrawEthAmount,
      depositEthAmount,
      depositTokenAmount,
      isWithdrawing,
      isWithdrawingEth,
      isDepositingEth,
      isDepositingToken,
      onWithdrawAmountChange: setWithdrawAmount,
      onWithdrawEthAmountChange: setWithdrawEthAmount,
      onDepositEthAmountChange: setDepositEthAmount,
      onDepositTokenAmountChange: setDepositTokenAmount,
      onCreateEmbeddedWallet: createEmbeddedWallet,
      onCopyEmbeddedAddress: handleCopyEmbeddedAddress,
      embeddedAddressCopied,
      onExportEmbeddedWallet: exportEmbeddedWallet,
      onWithdrawToExternal: handleWithdrawToExternal,
      onWithdrawEthToExternal: handleWithdrawEthToExternal,
      onDepositEthToEmbedded: handleDepositEthToEmbedded,
      onDepositTokenToEmbedded: handleDepositTokenToEmbedded,
      walletTransfers,
      walletTransfersLoading,
      onLoadWalletTransfers: fetchWalletTransfers,
      deepScanWins,
      deepScanScanning,
      deepScanClaiming,
      deepScanProgress,
      onDeepScan: deepScan,
      onDeepScanStop: deepScanStop,
      onDeepClaimOne: deepClaimOne,
      onDeepClaimAll: claimAllDeep,
      soundSettings,
      onSoundSettingChange: setSoundEnabled,
      reducedMotion,
      onReducedMotionChange: setReducedMotion,
      pendingTransactionStatus,
      isRefreshingPendingTx,
      isCancellingPendingTx,
      onRefreshPendingTx: refreshPendingTransactionStatus,
      onCancelPendingTx: cancelPendingTransaction,
      eip7702Diagnostic,
      onRunEip7702Diagnostic: runEip7702Diagnostic,
      onRunEip7702SendDiagnostic: runEip7702SendDiagnostic,
    },
  };
}

type BuildPageTabContentPropsOptions = {
  activeTab: PageTabContentProps["activeTab"];
  normalizedEmbeddedAddress?: `0x${string}`;
  historyViewData: PageTabContentProps["analyticsProps"]["historyViewData"];
  historyLoading: PageTabContentProps["analyticsProps"]["historyLoading"];
  historyRefreshing: PageTabContentProps["analyticsProps"]["historyRefreshing"];
  deposits: PageTabContentProps["analyticsProps"]["deposits"];
  depositsLoading: PageTabContentProps["analyticsProps"]["depositsLoading"];
  depositsError: PageTabContentProps["analyticsProps"]["depositsError"];
  totalDeposited: PageTabContentProps["analyticsProps"]["totalDeposited"];
  fetchDeposits: PageTabContentProps["analyticsProps"]["onLoadDeposits"];
  refreshDeposits: PageTabContentProps["analyticsProps"]["onRefreshDeposits"];
  jackpotHistory: PageTabContentProps["analyticsProps"]["jackpotHistory"];
  jackpotHistoryLoading: PageTabContentProps["analyticsProps"]["jackpotHistoryLoading"];
  jackpotHistoryError: PageTabContentProps["analyticsProps"]["jackpotHistoryError"];
  refreshJackpotHistory: PageTabContentProps["analyticsProps"]["onRefreshJackpotHistory"];
  autoMineProgress: PageTabContentProps["hubProps"]["autoMineProgress"];
  chatOpen: PageTabContentProps["hubProps"]["chatOpen"];
  formattedLineaBalance: PageTabContentProps["hubProps"]["formattedBalance"];
  gridDisplayEpoch: PageTabContentProps["hubProps"]["gridDisplayEpoch"];
  gridSelectedTiles: PageTabContentProps["hubProps"]["gridSelectedTiles"];
  handleAutoMineWithGuard: PageTabContentProps["hubProps"]["handleAutoMineWithGuard"];
  handleManualMineWithGuard: PageTabContentProps["hubProps"]["handleManualMineWithGuard"];
  handleRepeatLastBet: PageTabContentProps["hubProps"]["handleRepeatLastBet"];
  isAnalyzing: PageTabContentProps["hubProps"]["isAnalyzing"];
  isAutoMining: PageTabContentProps["hubProps"]["isAutoMining"];
  isClaiming: PageTabContentProps["hubProps"]["isClaiming"];
  isDailyJackpot: PageTabContentProps["hubProps"]["isDailyJackpot"];
  isDeepScanning: PageTabContentProps["hubProps"]["isDeepScanning"];
  isPending: PageTabContentProps["hubProps"]["isPending"];
  isRevealing: PageTabContentProps["hubProps"]["isRevealing"];
  isScanning: PageTabContentProps["hubProps"]["isScanning"];
  coldBootDefaults: PageTabContentProps["hubProps"]["coldBootDefaults"];
  liveStateReady: PageTabContentProps["hubProps"]["liveStateReady"];
  isWeeklyJackpot: PageTabContentProps["hubProps"]["isWeeklyJackpot"];
  jackpotAmount: PageTabContentProps["hubProps"]["jackpotAmount"];
  lastBet: PageTabContentProps["hubProps"]["lastBet"];
  lowEthBalance: boolean;
  claimReward: PageTabContentProps["hubProps"]["onClaim"];
  claimAll: PageTabContentProps["hubProps"]["onClaimAll"];
  scanRewards: PageTabContentProps["hubProps"]["onScan"];
  stableTileClick: PageTabContentProps["hubProps"]["onTileClick"];
  reducedMotion: PageTabContentProps["hubProps"]["reducedMotion"];
  runningParams: PageTabContentProps["hubProps"]["runningParams"];
  selectedTilesCount: PageTabContentProps["hubProps"]["selectedTilesCount"];
  showSelectionOnGrid: PageTabContentProps["hubProps"]["showSelectionOnGrid"];
  tileViewData: PageTabContentProps["hubProps"]["tileViewData"];
  unclaimedWins: PageTabContentProps["hubProps"]["unclaimedWins"];
  winningTileId: PageTabContentProps["hubProps"]["winningTileId"];
  hasMyWinningBet: PageTabContentProps["hubProps"]["hasMyWinningBet"];
  leaderboardsData: PageTabContentProps["leaderboardsProps"]["data"];
  leaderboardsLoading: PageTabContentProps["leaderboardsProps"]["loading"];
  leaderboardsError: PageTabContentProps["leaderboardsProps"]["error"];
  leaderboardsRefetch: PageTabContentProps["leaderboardsProps"]["refetch"];
  address?: PageTabContentProps["rebateProps"]["address"];
  rebateInfo: PageTabContentProps["rebateProps"]["rebateInfo"];
  isClaimingRebate: PageTabContentProps["rebateProps"]["isClaiming"];
  claimRebates: PageTabContentProps["rebateProps"]["onClaimRebates"];
  lowTokenBalance: boolean;
  balanceWarningDismissed: boolean;
  dismissBalanceWarning: PageTabContentProps["onDismissBalanceWarning"];
};

export function buildPageTabContentProps({
  activeTab,
  normalizedEmbeddedAddress,
  historyViewData,
  historyLoading,
  historyRefreshing,
  deposits,
  depositsLoading,
  depositsError,
  totalDeposited,
  fetchDeposits,
  refreshDeposits,
  jackpotHistory,
  jackpotHistoryLoading,
  jackpotHistoryError,
  refreshJackpotHistory,
  autoMineProgress,
  chatOpen,
  formattedLineaBalance,
  gridDisplayEpoch,
  gridSelectedTiles,
  handleAutoMineWithGuard,
  handleManualMineWithGuard,
  handleRepeatLastBet,
  isAnalyzing,
  isAutoMining,
  isClaiming,
  isDailyJackpot,
  isDeepScanning,
  isPending,
  isRevealing,
  isScanning,
  coldBootDefaults,
  liveStateReady,
  isWeeklyJackpot,
  jackpotAmount,
  lastBet,
  lowEthBalance,
  claimReward,
  claimAll,
  scanRewards,
  stableTileClick,
  reducedMotion,
  runningParams,
  selectedTilesCount,
  showSelectionOnGrid,
  tileViewData,
  unclaimedWins,
  winningTileId,
  hasMyWinningBet,
  leaderboardsData,
  leaderboardsLoading,
  leaderboardsError,
  leaderboardsRefetch,
  address,
  rebateInfo,
  isClaimingRebate,
  claimRebates,
  lowTokenBalance,
  balanceWarningDismissed,
  dismissBalanceWarning,
}: BuildPageTabContentPropsOptions): PageTabContentProps {
  return {
    activeTab,
    analyticsProps: {
      walletAddress: normalizedEmbeddedAddress,
      historyViewData,
      historyLoading,
      historyRefreshing,
      deposits,
      depositsLoading,
      depositsError,
      totalDeposited,
      onLoadDeposits: fetchDeposits,
      onRefreshDeposits: refreshDeposits,
      jackpotHistory,
      jackpotHistoryLoading,
      jackpotHistoryError,
      onRefreshJackpotHistory: refreshJackpotHistory,
    },
    hubProps: {
      autoMineProgress,
      chatOpen,
      formattedBalance: formattedLineaBalance,
      gridDisplayEpoch,
      gridSelectedTiles,
      handleAutoMineWithGuard,
      handleManualMineWithGuard,
      handleRepeatLastBet,
      isAnalyzing,
      isAutoMining,
      isClaiming,
      isDailyJackpot,
      isDeepScanning,
      isPending,
      isRevealing,
      isScanning,
      coldBootDefaults,
      liveStateReady,
      isWeeklyJackpot,
      jackpotAmount,
      lastBet,
      lowEthBalance,
      onClaim: claimReward,
      onClaimAll: claimAll,
      onScan: scanRewards,
      onTileClick: stableTileClick,
      reducedMotion,
      runningParams,
      selectedTilesCount,
      showSelectionOnGrid,
      tileViewData,
      unclaimedWins,
      walletAddress: normalizedEmbeddedAddress ?? null,
      winningTileId,
      hasMyWinningBet,
    },
    leaderboardsProps: {
      data: leaderboardsData,
      loading: leaderboardsLoading,
      error: leaderboardsError,
      refetch: leaderboardsRefetch,
    },
    rebateProps: {
      address,
      rebateInfo,
      isClaiming: isClaimingRebate,
      onClaimRebates: claimRebates,
    },
    lowEthBalance,
    lowTokenBalance,
    balanceWarningDismissed,
    onDismissBalanceWarning: dismissBalanceWarning,
  };
}

type BuildFloatingActionsPropsOptions = {
  chatWalletAddress?: `0x${string}` | null;
  onChatOpenChange: FloatingActionsProps["onChatOpenChange"];
  chatOpen: boolean;
};

export function buildFloatingActionsProps({
  chatWalletAddress,
  onChatOpenChange,
  chatOpen,
}: BuildFloatingActionsPropsOptions): FloatingActionsProps {
  return {
    walletAddress: chatWalletAddress ?? null,
    onChatOpenChange,
    chatOpen,
  };
}
