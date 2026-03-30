"use client";

import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { APP_CHAIN_ID } from "../lib/constants";
import { useMiningRuntimeState } from "./useMiningRuntimeState";
import { useMiningOrchestration } from "./useMiningOrchestration";

export type GasOverrides = { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } | { gasPrice?: bigint };

type SilentSendFn = (
  tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint; nonce?: number },
  gasOverrides?: GasOverrides,
) => Promise<`0x${string}`>;

/** Call periodically to refresh Privy auth/session so wallet signing keeps working. */
export type RefreshSessionFn = () => Promise<void>;
export type MiningNotifyFn = (message: string, tone?: "info" | "success" | "warning" | "danger") => void;

interface UseMiningOptions {
  refetchAllowance: () => void;
  refetchTileData: () => void;
  refetchUserBets: () => void;
  refetchEpoch?: () => void;
  refetchGridEpochData?: () => void;
  preferredAddress?: `0x${string}` | string | null;
  ensurePreferredWallet?: () => Promise<void> | void;
  sendTransactionSilent?: SilentSendFn;
  /** Optional: call every ~20 min while bot runs to keep Privy session valid (e.g. () => getAccessToken()) */
  refreshSession?: RefreshSessionFn;
  /** Optional: called when auto-miner has placed a bet (blocks chosen and tx confirmed) */
  onAutoMineBetConfirmed?: () => void;
  onNotify?: MiningNotifyFn;
}

export function useMining({
  refetchAllowance,
  refetchTileData,
  refetchUserBets,
  refetchEpoch,
  refetchGridEpochData,
  preferredAddress,
  ensurePreferredWallet,
  sendTransactionSilent,
  refreshSession,
  onAutoMineBetConfirmed,
  onNotify,
}: UseMiningOptions) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();

  const {
    isPending,
    setIsPending,
    isAutoMining,
    setIsAutoMining,
    autoMineProgress,
    setAutoMineProgress,
    runningParams,
    setRunningParams,
    hasPreferredActor,
    getActorAddress,
    getPreferredActorAddress,
    autoMineRef,
    autoResumeRequestedRef,
    restoreAttemptedRef,
    sessionExpiredErrorRef,
    tokenGetterWarningShownRef,
    pendingApproveRef,
    pendingBetRef,
    publicClientRef,
    silentSendRef,
    refreshSessionRef,
    writeContractAsyncRef,
    ensurePreferredWalletRef,
    refetchAllowanceRef,
    refetchTileDataRef,
    refetchUserBetsRef,
    refetchEpochRef,
    refetchGridEpochDataRef,
    onAutoMineBetConfirmedRef,
    notifyRef,
  } = useMiningRuntimeState({
    address,
    publicClient,
    writeContractAsync: (args: unknown) => writeContractAsync(args as never),
    preferredAddress,
    ensurePreferredWallet,
    sendTransactionSilent,
    refreshSession,
    onAutoMineBetConfirmed,
    onNotify,
    refetchAllowance,
    refetchTileData,
    refetchUserBets,
    refetchEpoch,
    refetchGridEpochData,
  });

  const {
    selectedTiles,
    selectedTilesEpoch,
    handleManualMine,
    handleDirectMine,
    handleAutoMineToggle,
    handleTileClick,
    setTiles,
  } = useMiningOrchestration({
    publicClient,
    getActorAddress,
    getPreferredActorAddress,
    hasPreferredActor,
    autoMineRef,
    autoResumeRequestedRef,
    restoreAttemptedRef,
    sessionExpiredErrorRef,
    tokenGetterWarningShownRef,
    pendingApproveRef,
    pendingBetRef,
    publicClientRef,
    silentSendRef,
    refreshSessionRef,
    writeContractAsyncRef,
    ensurePreferredWalletRef,
    refetchAllowanceRef,
    refetchTileDataRef,
    refetchUserBetsRef,
    refetchEpochRef,
    refetchGridEpochDataRef,
    onAutoMineBetConfirmedRef,
    notifyRef,
    isAutoMining,
    setIsPending,
    setIsAutoMining,
    setAutoMineProgress,
    setRunningParams,
  });

  return {
    isPending,
    selectedTiles,
    selectedTilesEpoch,
    isAutoMining,
    autoMineProgress,
    runningParams,
    handleManualMine,
    handleDirectMine,
    handleAutoMineToggle,
    handleTileClick,
    setTiles,
  };
}
