"use client";

import { useMemo } from "react";
import type { PublicClient } from "viem";
import type { WagmiBalanceLike } from "../lib/balanceFormatting";
import type { SoundName } from "./useSound";
import { useMining } from "./useMining";
import { useAutoMineDebugOverride } from "./useAutoMineDebugOverride";
import { useMiningGuards } from "./useMiningGuards";
import { usePageEpochPresentation } from "./usePageEpochPresentation";
import { usePageMiningOptions } from "./usePageMiningOptions";
import { usePageRuntimeEffects } from "./usePageRuntimeEffects";
import { useRewardScanner } from "./useRewardScanner";

type NotifyFn = (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
type PlaySoundFn = (name: SoundName) => void;
type SilentSendFn = (
  tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint; nonce?: number; feeMode?: "normal" | "keeper" },
  gasOverrides?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } | { gasPrice?: bigint },
) => Promise<`0x${string}`>;

interface UseLineaOreHubRuntimeOptions {
  activeTab: string;
  isPageVisible: boolean;
  embeddedWalletAddress: string | null;
  embeddedWalletReady: boolean;
  ensureEmbeddedWallet: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
  notify: NotifyFn;
  playSound: PlaySoundFn;
  refetchAllowance: () => void;
  refetchEpoch: () => void;
  refetchGridEpochData: () => void;
  refetchTileData: () => void;
  refetchUserBets: () => void;
  sendTransactionSilent?: SilentSendFn;
  actualCurrentEpoch: bigint | null | undefined;
  gridDisplayEpoch: string | null;
  isRevealing: boolean;
  liveStateReady: boolean;
  timeLeft: number;
  visualEpoch: string | null;
  currentEpochResolved: boolean | undefined;
  embeddedEthBalance?: WagmiBalanceLike;
  historyViewData: Array<{ isResolved: boolean; winningTile: string }>;
  publicClient?: PublicClient;
  syncHotTiles: (tiles: { tileId: number; wins: number }[]) => void;
  winningTileId: number | null;
  hasMyWinningBet: boolean;
  address?: `0x${string}`;
  embeddedTokenBalance?: WagmiBalanceLike;
  openWalletSettings: () => void;
  minEthForGas: number;
  readOnlyReason?: string | null;
}

export function useLineaOreHubRuntime({
  activeTab,
  isPageVisible,
  embeddedWalletAddress,
  embeddedWalletReady,
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
  minEthForGas,
  readOnlyReason = null,
}: UseLineaOreHubRuntimeOptions) {
  const miningEmbeddedWalletAddress = embeddedWalletReady ? embeddedWalletAddress : null;
  const miningSendTransactionSilent = embeddedWalletReady ? sendTransactionSilent : undefined;
  const miningOptions = usePageMiningOptions({
    embeddedWalletAddress: miningEmbeddedWalletAddress,
    ensureEmbeddedWallet: embeddedWalletReady ? ensureEmbeddedWallet : undefined,
    getAccessToken,
    notify,
    playSound,
    refetchAllowance,
    refetchEpoch,
    refetchGridEpochData,
    refetchTileData,
    refetchUserBets,
    sendTransactionSilent: miningSendTransactionSilent,
  });

  const mining = useMining(miningOptions);
  const autoMineDebugOverride = useAutoMineDebugOverride();
  const effectiveAutoMinePhase = autoMineDebugOverride?.phase ?? mining.autoMinePhase;
  const effectiveAutoMineProgress = autoMineDebugOverride?.progress ?? mining.autoMineProgress;
  const effectiveRunningParams = autoMineDebugOverride?.runningParams ?? mining.runningParams;
  const effectiveIsAutoMining =
    effectiveAutoMinePhase === "starting" ||
    effectiveAutoMinePhase === "restoring" ||
    effectiveAutoMinePhase === "running";
  const epochPresentation = usePageEpochPresentation({
    actualCurrentEpoch,
    gridDisplayEpoch,
    isRevealing,
    liveStateReady,
    selectedTiles: mining.selectedTiles,
    selectedTilesEpoch: mining.selectedTilesEpoch,
    timeLeft,
    visualEpoch,
  });

  const rewardScanner = useRewardScanner(actualCurrentEpoch ?? undefined, {
    enabled: activeTab === "hub" && Boolean(embeddedWalletAddress),
    isPageVisible,
    preferredAddress: embeddedWalletAddress,
    sendTransactionSilent: miningSendTransactionSilent,
    onNotify: notify,
  });

  const miningGuards = useMiningGuards({
    connectedWalletAddress: address,
    embeddedWalletAddress: miningEmbeddedWalletAddress,
    embeddedEthBalance,
    embeddedTokenBalance,
    isAutoMining: mining.isAutoMining,
    isAnalyzing: epochPresentation.isAnalyzing,
    isRevealing,
    liveStateReady,
    readOnlyReason,
    selectedTiles: mining.selectedTiles,
    minEthForGas,
    onManualMine: (amount) => mining.handleManualMine(amount, actualCurrentEpoch),
    onDirectMine: (tiles, amount) => mining.handleDirectMine(tiles, amount, actualCurrentEpoch),
    onAutoMineToggle: mining.handleAutoMineToggle,
    notify,
    onOpenWalletSettings: openWalletSettings,
    onBetConfirmed: () => playSound("bet"),
  });

  const runtimeEffects = usePageRuntimeEffects({
    actualCurrentEpoch,
    currentEpochResolved,
    handleTileClick: mining.handleTileClick,
    historyViewData,
    isAnalyzing: epochPresentation.isAnalyzing,
    isRevealing,
    liveStateReady,
    playSound,
    publicClient,
    refetchEpoch,
    refetchGridEpochData,
    refetchTileData,
    refetchUserBets,
    syncHotTiles,
    timeLeft,
    winningTileId,
    hasMyWinningBet,
  });

  return useMemo(
    () => ({
      ...mining,
      ...epochPresentation,
      ...rewardScanner,
      ...miningGuards,
      ...runtimeEffects,
      autoMinePhase: effectiveAutoMinePhase,
      autoMineProgress: effectiveAutoMineProgress,
      runningParams: effectiveRunningParams,
      isAutoMining: effectiveIsAutoMining,
      readOnlyReason,
    }),
    [
      effectiveAutoMinePhase,
      effectiveAutoMineProgress,
      effectiveIsAutoMining,
      effectiveRunningParams,
      epochPresentation,
      mining,
      miningGuards,
      readOnlyReason,
      rewardScanner,
      runtimeEffects,
    ],
  );
}
