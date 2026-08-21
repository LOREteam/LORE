"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { parseUnits } from "viem";
import { useWriteContract } from "wagmi";
import { getConfiguredReadOnlyMode } from "../../config/publicConfig";
import { buildLineaOreClientRuntimeViewProps } from "../lib/buildLineaOreClientRuntimeViewProps";
import { type LiveStateApiResponse } from "./useGameLiveStateSnapshot";
import { useLineaOreClientBaseState } from "./useLineaOreClientBaseState";
import { useLineaOreHubRuntime } from "./useLineaOreHubRuntime";
import { useLineaOreWalletRuntime } from "./useLineaOreWalletRuntime";
import { usePageAncillaryData } from "./usePageAncillaryData";
import { useRebate } from "./useRebate";
import { createWalletSetupGuard, WALLET_SETUP_ERROR, type WalletSetupState } from "../lib/walletSetup";
import type { RecentWin } from "./useRecentWins";
import type { TabId } from "../lib/types";

const MIN_ETH_FOR_GAS = 0.0005;
const MIN_ETH_WITHDRAW_RESERVE_WEI = parseUnits("0.0005", 18);
const READ_ONLY_REASON = "Maintenance mode: betting is temporarily paused. Existing data remains visible.";

interface UseLineaOreClientRuntimeOptions {
  initialLiveState?: LiveStateApiResponse | null;
  initialRecentWins?: RecentWin[];
  initialTab?: TabId;
}

export function useLineaOreClientRuntime({
  initialLiveState = null,
  initialRecentWins = [],
  initialTab = "hub",
}: UseLineaOreClientRuntimeOptions) {
  const { writeContractAsync } = useWriteContract();
  const { getAccessToken } = usePrivy();
  const baseState = useLineaOreClientBaseState({
    initialLiveState,
    initialTab,
  });
  const { uiHydrated, motion, sound, wallet, shell, gameData, chart, normalizedEmbeddedAddress, publicClient } =
    baseState;
  const readOnlyReason = getConfiguredReadOnlyMode() ? READ_ONLY_REASON : null;
  const walletSetupIdentity = wallet.authenticated
    ? `${wallet.externalWalletAddress?.toLowerCase() ?? "no-external"}:${normalizedEmbeddedAddress?.toLowerCase() ?? "no-embedded"}`
    : null;
  const createEmbeddedWalletRef = useRef(wallet.createEmbeddedWallet);
  const [walletSetupState, setWalletSetupState] = useState<WalletSetupState>("idle");
  const walletSetupGuardRef = useRef<ReturnType<typeof createWalletSetupGuard> | null>(null);
  const walletSetupIdentityRef = useRef<string | null | undefined>(undefined);
  createEmbeddedWalletRef.current = wallet.createEmbeddedWallet;
  if (!walletSetupGuardRef.current) {
    walletSetupGuardRef.current = createWalletSetupGuard({
      onCreateEmbeddedWallet: () => createEmbeddedWalletRef.current(),
      onStateChange: setWalletSetupState,
    });
  }
  const onCreateEmbeddedWallet = useCallback(() => walletSetupGuardRef.current!.run(), []);
  const walletSetupCreating = walletSetupState === "creating";
  const walletSetupError = walletSetupState === "error"
    ? WALLET_SETUP_ERROR
    : null;

  useEffect(() => {
    const identityChanged = walletSetupIdentityRef.current !== undefined
      && walletSetupIdentityRef.current !== walletSetupIdentity;
    if (!wallet.authenticated || identityChanged || normalizedEmbeddedAddress || wallet.embeddedWalletSyncing) {
      walletSetupGuardRef.current?.reset();
    }
    walletSetupIdentityRef.current = walletSetupIdentity;
  }, [normalizedEmbeddedAddress, wallet.authenticated, wallet.embeddedWalletSyncing, walletSetupIdentity]);

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
    embeddedTokenBalance: gameData.tokenBalance,
    embeddedTokenPending: gameData.tokenBalancePending,
    embeddedTokenStatus: gameData.tokenBalanceStatus,
    refetchEmbeddedTokenBalance: gameData.refetchTokenBalance,
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
    embeddedWalletReady: wallet.embeddedWalletReady,
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
    readOnlyReason,
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
        readOnlyReason,
        onCreateEmbeddedWallet,
        walletSetupCreating,
        walletSetupError,
      }),
    [ancillaryState, baseState, hubRuntime, onCreateEmbeddedWallet, readOnlyReason, rebateState, walletRuntime, walletSetupCreating, walletSetupError],
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
      ...viewProps,
    }),
    [
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
