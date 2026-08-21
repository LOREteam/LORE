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
import type { CurrentRoundEvidence } from "./currentRoundEvidence";

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
  readOnlyReason?: PageTabContentProps["hubProps"]["readOnlyReason"];
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
  currentRoundEvidence: CurrentRoundEvidence;
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
  depositsLastLoadedAt: PageTabContentProps["analyticsProps"]["depositsLastLoadedAt"];
  depositsLoading: PageTabContentProps["analyticsProps"]["depositsLoading"];
  depositsMetadataLoading: PageTabContentProps["analyticsProps"]["depositsMetadataLoading"];
  dismissBalanceWarning: PageTabContentProps["onDismissBalanceWarning"];
  embeddedAddressCopied: WalletSettingsProps["embeddedAddressCopied"];
  embeddedResolverRewards: WalletSettingsProps["embeddedResolverRewards"];
  embeddedResolverRewardsWei: WalletSettingsProps["embeddedResolverRewardsWei"];
  embeddedWalletAddress: string | null;
  embeddedWalletSyncing: PageTabContentProps["hubProps"]["embeddedWalletSyncing"];
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
  handleTabChange: SidebarProps["onTabChange"];
  handleWithdrawEthToExternal: WalletSettingsProps["onWithdrawEthToExternal"];
  handleWithdrawToExternal: WalletSettingsProps["onWithdrawToExternal"];
  hasMyWinningBet: PageTabContentProps["hubProps"]["hasMyWinningBet"];
  headerEthLoading: HeaderProps["privyEthBalanceLoading"];
  headerLineaBalance: HeaderProps["privyTokenBalance"];
  headerLineaLoading: HeaderProps["privyTokenBalanceLoading"];
  historyError: PageTabContentProps["analyticsProps"]["historyError"];
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
  walletAuthenticated: PageTabContentProps["hubProps"]["walletAuthenticated"];
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

export function derivePreviousGridEpoch(gridDisplayEpoch: string | null | undefined): string | null {
  if (!gridDisplayEpoch || !/^(?:0|[1-9]\d*)$/.test(gridDisplayEpoch)) return null;
  const epoch = BigInt(gridDisplayEpoch);
  return epoch > 0n ? (epoch - 1n).toString() : null;
}

export function createLineaOreClientViewProps({
  activeTab,
  actualCurrentEpoch,
  address,
  autoMinePhase,
  autoMineProgress,
  readOnlyReason = null,
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
  currentRoundEvidence,
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
  depositsLastLoadedAt,
  depositsLoading,
  depositsMetadataLoading,
  dismissBalanceWarning,
  embeddedAddressCopied,
  embeddedResolverRewards,
  embeddedResolverRewardsWei,
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
  handleTabChange,
  handleWithdrawEthToExternal,
  handleWithdrawToExternal,
  hasMyWinningBet,
  headerEthLoading,
  headerLineaBalance,
  headerLineaLoading,
  historyError,
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
  walletAuthenticated,
  walletConnected,
  winningTileId,
  withdrawAmount,
  withdrawEthAmount,
  cancelPendingTransaction,
}: CreateLineaOreClientViewPropsOptions) {
  const previousGridEpoch = derivePreviousGridEpoch(gridDisplayEpoch);
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
  const candidateJackpotEpochs = new Set(
    [gridDisplayEpoch, previousGridEpoch].filter((item): item is string => Boolean(item)),
  );
  const dailyInfoAmount =
    jackpotInfo?.lastDailyJackpotEpoch && candidateJackpotEpochs.has(jackpotInfo.lastDailyJackpotEpoch)
      ? jackpotInfo.lastDailyJackpotAmount
      : 0;
  const weeklyInfoAmount =
    jackpotInfo?.lastWeeklyJackpotEpoch && candidateJackpotEpochs.has(jackpotInfo.lastWeeklyJackpotEpoch)
      ? jackpotInfo.lastWeeklyJackpotAmount
      : 0;
  const dailyJackpotFallbackAmount = isDailyJackpot
    ? (dailyInfoAmount || dailyHistoryAmount)
    : 0;
  const weeklyJackpotFallbackAmount = isWeeklyJackpot
    ? (weeklyInfoAmount || weeklyHistoryAmount)
    : 0;
  const jackpotFallbackAmount = dailyJackpotFallbackAmount + weeklyJackpotFallbackAmount;

  return {
    currentRoundEvidence,
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
      actualCurrentEpoch,
      gridDisplayEpoch,
      currentRoundEvidence,
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
    }),
    pageTabContentProps: buildPageTabContentProps({
      activeTab,
      normalizedEmbeddedAddress,
      historyViewData,
      historyError,
      historyLoading,
      historyRefreshing,
      deposits,
      depositsLoading,
      depositsMetadataLoading,
      depositsLastLoadedAt,
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
      readOnlyReason,
      chatOpen,
      formattedLineaBalance,
      walletAuthenticated,
      walletConnected,
      embeddedWalletSyncing,
      onCreateEmbeddedWallet: createEmbeddedWallet,
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
      dailyJackpotFallbackAmount,
      weeklyJackpotFallbackAmount,
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
