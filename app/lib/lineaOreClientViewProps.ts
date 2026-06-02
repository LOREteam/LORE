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
  autoMinePhase: PageTabContentProps["hubProps"]["autoMinePhase"];
  autoMineProgress: PageTabContentProps["hubProps"]["autoMineProgress"];
  backupGateVersion: number;
  balanceWarningDismissed: boolean;
  chatOpen: PageTabContentProps["hubProps"]["chatOpen"];
  claimAll: SidebarProps["onClaimAll"];
  claimAllDeep: WalletSettingsProps["onDeepClaimAll"];
  claimConnectedResolverRewards: WalletSettingsProps["onClaimConnectedResolverRewards"];
  claimEmbeddedResolverRewards: WalletSettingsProps["onClaimEmbeddedResolverRewards"];
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
  connectedResolverRewards: WalletSettingsProps["connectedResolverRewards"];
  connectedResolverRewardsWei: WalletSettingsProps["connectedResolverRewardsWei"];
  depositEthAmount: string;
  depositTokenAmount: string;
  deposits: PageTabContentProps["analyticsProps"]["deposits"];
  depositsError: PageTabContentProps["analyticsProps"]["depositsError"];
  depositsLoading: PageTabContentProps["analyticsProps"]["depositsLoading"];
  dismissBalanceWarning: PageTabContentProps["onDismissBalanceWarning"];
  embeddedAddressCopied: WalletSettingsProps["embeddedAddressCopied"];
  embeddedResolverRewards: WalletSettingsProps["embeddedResolverRewards"];
  embeddedResolverRewardsWei: WalletSettingsProps["embeddedResolverRewardsWei"];
  embeddedWalletAddress: string | null;
  embeddedWallet7702DelegateAddress: WalletSettingsProps["embeddedWallet7702DelegateAddress"];
  embeddedWalletCodeChecking: WalletSettingsProps["embeddedWalletCodeChecking"];
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
  handleClearEip7702Delegation: WalletSettingsProps["onClearEip7702Delegation"];
  handleManualMineWithGuard: PageTabContentProps["hubProps"]["handleManualMineWithGuard"];
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
  isClaimingConnectedResolverRewards: WalletSettingsProps["isClaimingConnectedResolverRewards"];
  isClaimingEmbeddedResolverRewards: WalletSettingsProps["isClaimingEmbeddedResolverRewards"];
  isClaimingRebate: PageTabContentProps["rebateProps"]["isClaiming"];
  isDailyJackpot: PageTabContentProps["hubProps"]["isDailyJackpot"];
  isDeepScanning: SidebarProps["isDeepScanning"];
  isDepositingEth: WalletSettingsProps["isDepositingEth"];
  isDepositingToken: WalletSettingsProps["isDepositingToken"];
  isClearingEip7702Delegation: WalletSettingsProps["isClearingEip7702Delegation"];
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
  jackpotInfo: HeaderProps["jackpotInfo"];
  jackpotHistory: PageTabContentProps["analyticsProps"]["jackpotHistory"];
  jackpotHistoryError: PageTabContentProps["analyticsProps"]["jackpotHistoryError"];
  jackpotHistoryLoading: PageTabContentProps["analyticsProps"]["jackpotHistoryLoading"];
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
  setTiles: PageTabContentProps["hubProps"]["onQuickPickTiles"];
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
  walletConnected: PageTabContentProps["hubProps"]["walletConnected"];
  winningTileId: PageTabContentProps["hubProps"]["winningTileId"];
  withdrawAmount: string;
  withdrawEthAmount: string;
  cancelPendingTransaction: WalletSettingsProps["onCancelPendingTx"];
}

function findJackpotHistoryAmount(
  entries: PageTabContentProps["analyticsProps"]["jackpotHistory"],
  kind: "daily" | "weekly",
  epochs: Array<string | null | undefined>,
) {
  const epochSet = new Set(epochs.filter((epoch): epoch is string => Boolean(epoch)));
  const entry = entries.find((item) => item.kind === kind && epochSet.has(item.epoch));
  return entry?.amountNum ?? 0;
}

export function createLineaOreClientViewProps({
  activeTab,
  actualCurrentEpoch,
  address,
  autoMinePhase,
  autoMineProgress,
  backupGateVersion,
  balanceWarningDismissed,
  chatOpen,
  claimAll,
  claimAllDeep,
  claimConnectedResolverRewards,
  claimEmbeddedResolverRewards,
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
  connectedResolverRewards,
  connectedResolverRewardsWei,
  depositEthAmount,
  depositTokenAmount,
  deposits,
  depositsError,
  depositsLoading,
  dismissBalanceWarning,
  embeddedAddressCopied,
  embeddedResolverRewards,
  embeddedResolverRewardsWei,
  embeddedWalletAddress,
  embeddedWallet7702DelegateAddress,
  embeddedWalletCodeChecking,
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
  handleClearEip7702Delegation,
  handleManualMineWithGuard,
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
  isClaimingConnectedResolverRewards,
  isClaimingEmbeddedResolverRewards,
  isClaimingRebate,
  isDailyJackpot,
  isDeepScanning,
  isDepositingEth,
  isDepositingToken,
  isClearingEip7702Delegation,
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
  setTiles,
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
  walletConnected,
  winningTileId,
  withdrawAmount,
  withdrawEthAmount,
  cancelPendingTransaction,
}: CreateLineaOreClientViewPropsOptions) {
  const gridEpochNumber = gridDisplayEpoch ? Number(gridDisplayEpoch) : NaN;
  const previousGridEpoch =
    Number.isFinite(gridEpochNumber) && gridEpochNumber > 0 ? String(gridEpochNumber - 1) : null;
  const dailyHistoryAmount = isDailyJackpot
    ? findJackpotHistoryAmount(jackpotHistory, "daily", [
        jackpotInfo?.lastDailyJackpotEpoch,
        gridDisplayEpoch,
        previousGridEpoch,
      ])
    : 0;
  const weeklyHistoryAmount = isWeeklyJackpot
    ? findJackpotHistoryAmount(jackpotHistory, "weekly", [
        jackpotInfo?.lastWeeklyJackpotEpoch,
        gridDisplayEpoch,
        previousGridEpoch,
      ])
    : 0;
  const jackpotFallbackAmount =
    (isDailyJackpot ? (jackpotInfo?.lastDailyJackpotAmount || dailyHistoryAmount) : 0) +
    (isWeeklyJackpot ? (jackpotInfo?.lastWeeklyJackpotAmount || weeklyHistoryAmount) : 0);

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
      // V9 resolve is atomic: the winning tile is known the moment the
      // resolve tx lands, so the header always reflects the live epoch
      // (number + countdown) without any "REVEAL"/ANALYZING placeholder.
      // The winner announcement is handled by the wins ticker.
      isRevealing: false,
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
      isClearingEip7702Delegation,
      embeddedWallet7702DelegateAddress,
      embeddedWalletCodeChecking,
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
      handleClearEip7702Delegation,
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
      connectedResolverRewards,
      connectedResolverRewardsWei,
      embeddedResolverRewards,
      embeddedResolverRewardsWei,
      isClaimingConnectedResolverRewards,
      isClaimingEmbeddedResolverRewards,
      claimConnectedResolverRewards,
      claimEmbeddedResolverRewards,
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
      autoMinePhase,
      autoMineProgress,
      chatOpen,
      formattedLineaBalance,
      walletConnected,
      gridDisplayEpoch,
      gridSelectedTiles,
      handleAutoMineWithGuard,
      handleManualMineWithGuard,
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
      jackpotFallbackAmount,
      lowEthBalance,
      claimReward,
      claimAll,
      setTiles,
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
