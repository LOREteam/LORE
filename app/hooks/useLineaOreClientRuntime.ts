"use client";

import { useMemo } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { parseUnits } from "viem";
import { useWriteContract } from "wagmi";
import { buildLineaOreClientRuntimeViewProps } from "../lib/buildLineaOreClientRuntimeViewProps";
import { type LiveStateApiResponse } from "./useGameLiveStateSnapshot";
import { useLineaOreClientBaseState } from "./useLineaOreClientBaseState";
import { useLineaOreHubRuntime } from "./useLineaOreHubRuntime";
import { useLineaOreWalletRuntime } from "./useLineaOreWalletRuntime";
import { usePageAncillaryData } from "./usePageAncillaryData";
import { useRebate } from "./useRebate";
import type { RecentWin } from "./useRecentWins";

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
  const { writeContractAsync } = useWriteContract();
  const { getAccessToken } = usePrivy();
  const baseState = useLineaOreClientBaseState({
    initialLiveState,
  });
  const { uiHydrated, motion, sound, wallet, shell, gameData, chart, normalizedEmbeddedAddress, publicClient } =
    baseState;

  const { rebateInfo, isClaiming: isClaimingRebate, claimRebates } = useRebate({
    enabled: Boolean(normalizedEmbeddedAddress),
    active: shell.activeTab === "rebate",
    isPageVisible: shell.isPageVisible,
    preferredAddress: normalizedEmbeddedAddress,
    sendTransactionSilent: wallet.sendTransactionSilent,
    onNotify: shell.notify,
  });

  const ancillaryState = usePageAncillaryData({
    activeTab: shell.activeTab,
    isPageVisible: shell.isPageVisible,
    embeddedWalletAddress: wallet.embeddedWalletAddress,
    externalWalletAddress: wallet.externalWalletAddress,
    initialRecentWins,
    notify: shell.notify,
    sendTransactionSilent: wallet.sendTransactionSilent,
  });

  const walletRuntime = useLineaOreWalletRuntime({
    address: gameData.address,
    normalizedEmbeddedAddress,
    formattedLineaBalance: gameData.formattedLineaBalance,
    isPageVisible: shell.isPageVisible,
    embeddedWalletAddress: wallet.embeddedWalletAddress,
    externalWalletAddress: wallet.externalWalletAddress,
    writeContractAsync,
    sendTransactionSilent: wallet.sendTransactionSilent,
    sendTransactionFromExternal: wallet.sendTransactionFromExternal,
    publicClient,
    walletTransfers: ancillaryState.walletTransfers,
    fetchWalletTransfers: ancillaryState.fetchWalletTransfers,
    notify: shell.notify,
    openWalletSettings: shell.openWalletSettings,
    minEthForGas: MIN_ETH_FOR_GAS,
    minEthWithdrawReserveWei: MIN_ETH_WITHDRAW_RESERVE_WEI,
  });

  const hubRuntime = useLineaOreHubRuntime({
    activeTab: shell.activeTab,
    isPageVisible: shell.isPageVisible,
    embeddedWalletAddress: wallet.embeddedWalletAddress,
    ensureEmbeddedWallet: wallet.ensureEmbeddedWallet,
    getAccessToken,
    notify: shell.notify,
    playSound: sound.play,
    refetchAllowance: gameData.refetchAllowance,
    refetchEpoch: gameData.refetchEpoch,
    refetchGridEpochData: gameData.refetchGridEpochData,
    refetchTileData: gameData.refetchTileData,
    refetchUserBets: gameData.refetchUserBets,
    sendTransactionSilent: wallet.sendTransactionSilent,
    sendTransaction7702: wallet.sendTransaction7702,
    signEip7702Delegation: wallet.signEip7702Delegation,
    eip7702: wallet.eip7702,
    actualCurrentEpoch: gameData.actualCurrentEpoch,
    gridDisplayEpoch: gameData.gridDisplayEpoch,
    isRevealing: gameData.isRevealing,
    liveStateReady: gameData.liveStateReady,
    timeLeft: gameData.timeLeft,
    visualEpoch: gameData.visualEpoch,
    currentEpochResolved: gameData.currentEpochResolved,
    embeddedEthBalance: walletRuntime.embeddedEthBalance,
    historyViewData: gameData.historyViewData,
    publicClient,
    syncHotTiles: shell.syncHotTiles,
    winningTileId: gameData.winningTileId,
    hasMyWinningBet: gameData.hasMyWinningBet,
    address: gameData.address,
    embeddedTokenBalance: walletRuntime.embeddedTokenBalance,
    openWalletSettings: shell.openWalletSettings,
    minEthForGas: MIN_ETH_FOR_GAS,
  });

  const rebateState = useMemo(
    () => ({
      rebateInfo,
      isClaiming: isClaimingRebate,
      claimRebates,
    }),
    [claimRebates, isClaimingRebate, rebateInfo],
  );

  const viewProps = useMemo(
    () =>
      buildLineaOreClientRuntimeViewProps({
        baseState,
        ancillaryState,
        walletRuntime,
        hubRuntime,
        rebateState,
      }),
    [ancillaryState, baseState, hubRuntime, rebateState, walletRuntime],
  );

  return useMemo(
    () => ({
      uiHydrated,
      motionReady: motion.motionReady,
      reducedMotion: motion.reducedMotion,
      notices: shell.notices,
      dismissNotice: shell.dismissNotice,
      activeTab: shell.activeTab,
      handleTabChange: shell.handleTabChange,
      realTotalStaked: gameData.realTotalStaked,
      linePath: chart.linePath,
      chartHasData: chart.chartData.length > 0,
      ...viewProps,
    }),
    [
      chart.chartData.length,
      chart.linePath,
      gameData.realTotalStaked,
      motion.motionReady,
      motion.reducedMotion,
      shell.activeTab,
      shell.dismissNotice,
      shell.handleTabChange,
      shell.notices,
      uiHydrated,
      viewProps,
    ],
  );
}
