import type React from "react";
import { FloatingActions } from "../components/FloatingActions";
import { Header } from "../components/Header";
import { PageTabContent } from "../components/PageTabContent";
import { Sidebar } from "../components/Sidebar";
import { WalletShell } from "../components/WalletShell";
import {
  buildFloatingActionsProps,
  buildHeaderProps,
  buildPageTabContentProps,
  buildSidebarProps,
  buildWalletShellProps,
} from "./lineaOreClientSectionBuilders";

type SidebarProps = React.ComponentProps<typeof Sidebar>;
type HeaderProps = React.ComponentProps<typeof Header>;
type WalletShellProps = React.ComponentProps<typeof WalletShell>;
type WalletSettingsProps = WalletShellProps["walletSettingsProps"];
type PageTabContentProps = React.ComponentProps<typeof PageTabContent>;

interface CreateLineaOreClientViewPropsOptions {
  activeTab: SidebarProps["activeTab"];
  actualCurrentEpoch?: bigint;
  address?: PageTabContentProps["rebateProps"]["address"];
  autoMineProgress: PageTabContentProps["hubProps"]["autoMineProgress"];
  backupGateVersion: number;
  balanceWarningDismissed: boolean;
  chatOpen: PageTabContentProps["hubProps"]["chatOpen"];
  claimAll: SidebarProps["onClaimAll"];
  claimAllDeep: WalletSettingsProps["onDeepClaimAll"];
  claimRebates: PageTabContentProps["rebateProps"]["onClaimRebates"];
  claimReward: SidebarProps["onClaim"];
  closeWalletSettings: WalletSettingsProps["onClose"];
  coldBootDefaults: boolean;
  createEmbeddedWallet: WalletSettingsProps["onCreateEmbeddedWallet"];
  deepClaimOne: WalletSettingsProps["onDeepClaimOne"];
  deepScan: WalletSettingsProps["onDeepScan"];
  deepScanClaiming: WalletSettingsProps["deepScanClaiming"];
  deepScanProgress: WalletSettingsProps["deepScanProgress"];
  deepScanScanning: WalletSettingsProps["deepScanScanning"];
  deepScanStop: WalletSettingsProps["onDeepScanStop"];
  deepScanWins: WalletSettingsProps["deepScanWins"];
  depositEthAmount: string;
  depositTokenAmount: string;
  deposits: PageTabContentProps["analyticsProps"]["deposits"];
  depositsError: PageTabContentProps["analyticsProps"]["depositsError"];
  depositsLoading: PageTabContentProps["analyticsProps"]["depositsLoading"];
  dismissBalanceWarning: PageTabContentProps["onDismissBalanceWarning"];
  embeddedAddressCopied: WalletSettingsProps["embeddedAddressCopied"];
  embeddedWalletAddress: string | null;
  embeddedWalletSyncing: HeaderProps["embeddedWalletSyncing"];
  epochDurationChange: HeaderProps["epochDurationChange"];
  exportEmbeddedWallet: WalletSettingsProps["onExportEmbeddedWallet"];
  externalWalletAddress: string | null;
  fetchDeposits: PageTabContentProps["analyticsProps"]["onLoadDeposits"];
  fetchWalletTransfers: WalletSettingsProps["onLoadWalletTransfers"];
  formattedLineaBalance: PageTabContentProps["hubProps"]["formattedBalance"];
  formattedPrivyBalance: WalletSettingsProps["formattedLineaBalance"];
  formattedPrivyEthBalance: WalletSettingsProps["formattedEthBalance"];
  gridDisplayEpoch: PageTabContentProps["hubProps"]["gridDisplayEpoch"];
  gridSelectedTiles: PageTabContentProps["hubProps"]["gridSelectedTiles"];
  handleAutoMineWithGuard: PageTabContentProps["hubProps"]["handleAutoMineWithGuard"];
  handleBackupConfirm: WalletShellProps["backupProps"]["onConfirm"];
  handleCopyEmbeddedAddress: WalletSettingsProps["onCopyEmbeddedAddress"];
  handleDepositEthToEmbedded: WalletSettingsProps["onDepositEthToEmbedded"];
  handleDepositTokenToEmbedded: WalletSettingsProps["onDepositTokenToEmbedded"];
  handleManualMineWithGuard: PageTabContentProps["hubProps"]["handleManualMineWithGuard"];
  handleRepeatLastBet: PageTabContentProps["hubProps"]["handleRepeatLastBet"];
  handleTabChange: SidebarProps["onTabChange"];
  handleWithdrawEthToExternal: WalletSettingsProps["onWithdrawEthToExternal"];
  handleWithdrawToExternal: WalletSettingsProps["onWithdrawToExternal"];
  hasMyWinningBet: PageTabContentProps["hubProps"]["hasMyWinningBet"];
  headerEthLoading: HeaderProps["privyEthBalanceLoading"];
  headerLineaBalance: HeaderProps["privyTokenBalance"];
  headerLineaLoading: HeaderProps["privyTokenBalanceLoading"];
  historyLoading: PageTabContentProps["analyticsProps"]["historyLoading"];
  historyRefreshing: PageTabContentProps["analyticsProps"]["historyRefreshing"];
  historyViewData: PageTabContentProps["analyticsProps"]["historyViewData"];
  isAnalyzing: PageTabContentProps["hubProps"]["isAnalyzing"];
  isAutoMining: PageTabContentProps["hubProps"]["isAutoMining"];
  isCancellingPendingTx: WalletSettingsProps["isCancellingPendingTx"];
  isClaiming: SidebarProps["isClaiming"];
  isClaimingRebate: PageTabContentProps["rebateProps"]["isClaiming"];
  isDailyJackpot: PageTabContentProps["hubProps"]["isDailyJackpot"];
  isDeepScanning: SidebarProps["isDeepScanning"];
  isDepositingEth: WalletSettingsProps["isDepositingEth"];
  isDepositingToken: WalletSettingsProps["isDepositingToken"];
  isPageVisible: SidebarProps["isPageVisible"];
  isPending: PageTabContentProps["hubProps"]["isPending"];
  isRefreshingPendingTx: WalletSettingsProps["isRefreshingPendingTx"];
  isRevealing: HeaderProps["isRevealing"];
  isScanning: SidebarProps["isScanning"];
  isWalletSettingsOpen: WalletShellProps["showWalletSettings"];
  isWeeklyJackpot: PageTabContentProps["hubProps"]["isWeeklyJackpot"];
  isWithdrawing: WalletSettingsProps["isWithdrawing"];
  isWithdrawingEth: WalletSettingsProps["isWithdrawingEth"];
  jackpotAmount: PageTabContentProps["hubProps"]["jackpotAmount"];
  jackpotHistory: PageTabContentProps["analyticsProps"]["jackpotHistory"];
  jackpotHistoryError: PageTabContentProps["analyticsProps"]["jackpotHistoryError"];
  jackpotHistoryLoading: PageTabContentProps["analyticsProps"]["jackpotHistoryLoading"];
  jackpotInfo: HeaderProps["jackpotInfo"];
  lastBet: PageTabContentProps["hubProps"]["lastBet"];
  leaderboardsData: PageTabContentProps["leaderboardsProps"]["data"];
  leaderboardsError: PageTabContentProps["leaderboardsProps"]["error"];
  leaderboardsLoading: PageTabContentProps["leaderboardsProps"]["loading"];
  leaderboardsRefetch: PageTabContentProps["leaderboardsProps"]["refetch"];
  liveStateReady: PageTabContentProps["hubProps"]["liveStateReady"];
  timerReady: HeaderProps["timerReady"];
  lowEthBalance: boolean;
  lowTokenBalance: boolean;
  chatWalletAddress?: `0x${string}` | null;
  normalizedEmbeddedAddress?: `0x${string}`;
  onChatOpenChange: React.ComponentProps<typeof FloatingActions>["onChatOpenChange"];
  openWalletSettings: HeaderProps["onOpenWalletSettings"];
  pendingTransactionStatus: WalletSettingsProps["pendingTransactionStatus"];
  eip7702Diagnostic: WalletSettingsProps["eip7702Diagnostic"];
  onRunEip7702Diagnostic: WalletSettingsProps["onRunEip7702Diagnostic"];
  onRunEip7702SendDiagnostic: WalletSettingsProps["onRunEip7702SendDiagnostic"];
  rebateInfo: PageTabContentProps["rebateProps"]["rebateInfo"];
  recentWins: HeaderProps["recentWins"];
  reducedMotion: boolean;
  refreshDeposits: PageTabContentProps["analyticsProps"]["onRefreshDeposits"];
  refreshJackpotHistory: PageTabContentProps["analyticsProps"]["onRefreshJackpotHistory"];
  refreshPendingTransactionStatus: WalletSettingsProps["onRefreshPendingTx"];
  rolloverAmount: HeaderProps["rolloverAmount"];
  runningParams: PageTabContentProps["hubProps"]["runningParams"];
  scanRewards: PageTabContentProps["hubProps"]["onScan"];
  selectedTilesCount: PageTabContentProps["hubProps"]["selectedTilesCount"];
  setDepositEthAmount: WalletSettingsProps["onDepositEthAmountChange"];
  setDepositTokenAmount: WalletSettingsProps["onDepositTokenAmountChange"];
  setReducedMotion: WalletSettingsProps["onReducedMotionChange"];
  setSoundEnabled: WalletSettingsProps["onSoundSettingChange"];
  setWithdrawAmount: WalletSettingsProps["onWithdrawAmountChange"];
  setWithdrawEthAmount: WalletSettingsProps["onWithdrawEthAmountChange"];
  showSelectionOnGrid: PageTabContentProps["hubProps"]["showSelectionOnGrid"];
  soundMuted: HeaderProps["muted"];
  soundSettings: WalletSettingsProps["soundSettings"];
  stableTileClick: PageTabContentProps["hubProps"]["onTileClick"];
  tileViewData: PageTabContentProps["hubProps"]["tileViewData"];
  timeLeft: HeaderProps["timeLeft"];
  toggleSoundMute: HeaderProps["onToggleMute"];
  totalDeposited: PageTabContentProps["analyticsProps"]["totalDeposited"];
  unclaimedWins: SidebarProps["unclaimedWins"];
  visibleHotTiles: SidebarProps["hotTiles"];
  visualEpoch: HeaderProps["visualEpoch"];
  walletTransfers: WalletSettingsProps["walletTransfers"];
  walletTransfersLoading: WalletSettingsProps["walletTransfersLoading"];
  winningTileId: PageTabContentProps["hubProps"]["winningTileId"];
  withdrawAmount: string;
  withdrawEthAmount: string;
  cancelPendingTransaction: WalletSettingsProps["onCancelPendingTx"];
}

export function createLineaOreClientViewProps({
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
  onChatOpenChange,
  openWalletSettings,
  pendingTransactionStatus,
  eip7702Diagnostic,
  onRunEip7702Diagnostic,
  onRunEip7702SendDiagnostic,
  rebateInfo,
  recentWins,
  reducedMotion,
  refreshDeposits,
  refreshJackpotHistory,
  refreshPendingTransactionStatus,
  rolloverAmount,
  runningParams,
  scanRewards,
  selectedTilesCount,
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
}: CreateLineaOreClientViewPropsOptions) {
  return {
    sidebarProps: buildSidebarProps({
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
    }),
    headerProps: buildHeaderProps({
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
    }),
    walletShellProps: buildWalletShellProps({
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
      runEip7702Diagnostic: onRunEip7702Diagnostic,
      runEip7702SendDiagnostic: onRunEip7702SendDiagnostic,
    }),
    pageTabContentProps: buildPageTabContentProps({
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
    }),
    floatingActionsProps: buildFloatingActionsProps({
      chatWalletAddress,
      onChatOpenChange,
      chatOpen,
    }),
  };
}
