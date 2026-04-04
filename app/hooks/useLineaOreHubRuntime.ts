"use client";

import type { PublicClient } from "viem";
import type { Eip7702CapabilityState, Signed7702AuthorizationLike } from "../lib/eip7702";
import type { SoundName } from "./useSound";
import { useMining } from "./useMining";
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
type SilentSend7702Fn = (
  tx: {
    data?: `0x${string}`;
    value?: bigint;
    gas?: bigint;
    nonce?: number;
    authorizationList: readonly Signed7702AuthorizationLike[];
    sponsor?: boolean;
    feeMode?: "normal" | "keeper";
  },
  gasOverrides?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } | { gasPrice?: bigint },
) => Promise<`0x${string}`>;
type Sign7702DelegationFn = (executor?: "self" | `0x${string}`) => Promise<Signed7702AuthorizationLike>;

interface UseLineaOreHubRuntimeOptions {
  activeTab: string;
  isPageVisible: boolean;
  embeddedWalletAddress: string | null;
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
  sendTransaction7702?: SilentSend7702Fn;
  signEip7702Delegation?: Sign7702DelegationFn;
  eip7702?: Eip7702CapabilityState;
  actualCurrentEpoch: bigint | null | undefined;
  gridDisplayEpoch: string | null;
  isRevealing: boolean;
  liveStateReady: boolean;
  timeLeft: number;
  visualEpoch: string | null;
  currentEpochResolved: boolean | undefined;
  embeddedEthBalance?: { formatted: string; value: bigint } | null;
  historyViewData: Array<{ isResolved: boolean; winningTile: string }>;
  publicClient?: PublicClient;
  syncHotTiles: (tiles: { tileId: number; wins: number }[]) => void;
  winningTileId: number | null;
  hasMyWinningBet: boolean;
  address?: `0x${string}`;
  embeddedTokenBalance?: { formatted: string; value: bigint } | null;
  openWalletSettings: () => void;
  minEthForGas: number;
}

export function useLineaOreHubRuntime({
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
  minEthForGas,
}: UseLineaOreHubRuntimeOptions) {
  const miningOptions = usePageMiningOptions({
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
  });

  const mining = useMining(miningOptions);
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
    enabled: activeTab === "hub",
    isPageVisible,
    sendTransactionSilent,
    onNotify: notify,
  });

  const miningGuards = useMiningGuards({
    connectedWalletAddress: address,
    embeddedWalletAddress,
    embeddedEthBalance,
    embeddedTokenBalance,
    isAutoMining: mining.isAutoMining,
    isAnalyzing: epochPresentation.isAnalyzing,
    isRevealing,
    liveStateReady,
    selectedTiles: mining.selectedTiles,
    minEthForGas,
    onManualMine: mining.handleManualMine,
    onDirectMine: mining.handleDirectMine,
    onAutoMineToggle: mining.handleAutoMineToggle,
    notify,
    onOpenWalletSettings: openWalletSettings,
    onBetConfirmed: () => playSound("bet"),
  });

  const runtimeEffects = usePageRuntimeEffects({
    actualCurrentEpoch,
    currentEpochResolved,
    embeddedEthBalanceFormatted: embeddedEthBalance?.formatted ?? null,
    embeddedWalletAddress,
    handleTileClick: mining.handleTileClick,
    historyViewData,
    isRevealing,
    liveStateReady,
    playSound,
    publicClient,
    refetchEpoch,
    refetchGridEpochData,
    refetchTileData,
    refetchUserBets,
    sendTransactionSilent,
    syncHotTiles,
    timeLeft,
    winningTileId,
    hasMyWinningBet,
  });

  return {
    ...mining,
    ...epochPresentation,
    ...rewardScanner,
    ...miningGuards,
    ...runtimeEffects,
  };
}
