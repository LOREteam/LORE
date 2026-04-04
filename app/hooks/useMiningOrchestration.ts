"use client";

import { REFETCH_DELAY_MS, MAX_BET_ATTEMPTS } from "../lib/constants";
import type { Eip7702CapabilityState, Signed7702AuthorizationLike } from "../lib/eip7702";
import { saveSession } from "./useMining.shared";
import { useMiningAllowance } from "./useMiningAllowance";
import { useMiningRuntimeHelpers } from "./useMiningRuntimeHelpers";
import { useMiningBetExecution } from "./useMiningBetExecution";
import { useMiningRoundCompletion } from "./useMiningRoundCompletion";
import { useMiningManualActions } from "./useMiningManualActions";
import { useMiningSelectionState } from "./useMiningSelectionState";
import { useMiningReceipt } from "./useMiningReceipt";
import { useMiningBetStatus } from "./useMiningBetStatus";
import { useMiningAutoMineRunner } from "./useMiningAutoMineRunner";
import { useMiningLifecycle } from "./useMiningLifecycle";
import type { GasOverrides, MiningNotifyFn, RefreshSessionFn, RunningParams } from "./useMining.types";
import type { PendingApproveState, PendingBetState } from "./useMining.stateTypes";
import type { PublicClient } from "viem";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

interface UseMiningOrchestrationOptions {
  publicClient: PublicClient | undefined;
  getActorAddress: () => string | null;
  getPreferredActorAddress: () => string | null;
  hasPreferredActor: boolean;
  autoMineRef: MutableRefObject<boolean>;
  autoResumeRequestedRef: MutableRefObject<boolean>;
  restoreAttemptedRef: MutableRefObject<boolean>;
  sessionExpiredErrorRef: MutableRefObject<boolean>;
  tokenGetterWarningShownRef: MutableRefObject<boolean>;
  pendingApproveRef: MutableRefObject<PendingApproveState | null>;
  pendingBetRef: MutableRefObject<PendingBetState | null>;
  publicClientRef: MutableRefObject<PublicClient | undefined>;
  silentSendRef: MutableRefObject<
    | ((
        tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint; nonce?: number },
        gasOverrides?: GasOverrides,
      ) => Promise<`0x${string}`>)
    | undefined
  >;
  silentSend7702Ref: MutableRefObject<
    | ((
        tx: {
          data?: `0x${string}`;
          value?: bigint;
          gas?: bigint;
          nonce?: number;
          authorizationList: readonly Signed7702AuthorizationLike[];
          sponsor?: boolean;
          feeMode?: "normal" | "keeper";
        },
        gasOverrides?: GasOverrides,
      ) => Promise<`0x${string}`>)
    | undefined
  >;
  signEip7702DelegationRef: MutableRefObject<
    | ((executor?: "self" | `0x${string}`) => Promise<Signed7702AuthorizationLike>)
    | undefined
  >;
  eip7702Ref: MutableRefObject<Eip7702CapabilityState | undefined>;
  refreshSessionRef: MutableRefObject<RefreshSessionFn | undefined>;
  writeContractAsyncRef: MutableRefObject<(args: unknown) => Promise<`0x${string}`>>;
  ensurePreferredWalletRef: MutableRefObject<(() => Promise<void> | void) | undefined>;
  refetchAllowanceRef: MutableRefObject<() => void>;
  refetchTileDataRef: MutableRefObject<() => void>;
  refetchUserBetsRef: MutableRefObject<() => void>;
  refetchEpochRef: MutableRefObject<(() => void) | undefined>;
  refetchGridEpochDataRef: MutableRefObject<(() => void) | undefined>;
  onAutoMineBetConfirmedRef: MutableRefObject<(() => void) | undefined>;
  notifyRef: MutableRefObject<MiningNotifyFn | undefined>;
  isAutoMining: boolean;
  setIsPending: Dispatch<SetStateAction<boolean>>;
  setIsAutoMining: Dispatch<SetStateAction<boolean>>;
  setAutoMineProgress: Dispatch<SetStateAction<string | null>>;
  setRunningParams: Dispatch<SetStateAction<RunningParams>>;
}

const NETWORK_RETRY_MAX = 120;
const NETWORK_BACKOFF_INITIAL_MS = 1_500;
const NETWORK_BACKOFF_MAX_MS = 15_000;
const APPROVE_RETRY_MAX = 3;
const BET_PENDING_STALE_MS = 45_000;
const BET_PENDING_GRACE_MS = 12_000;
const FORCE_REPLACE_PENDING_NONCE_GAP = 6;
const GAS_BUMP_BASE = BigInt(125);
const GAS_BUMP_REPLACEMENT_STEP = BigInt(15);
const MIN_GAS_PLACE_BET = BigInt(320_000);
const MIN_GAS_PLACE_BATCH = BigInt(700_000);
const MIN_GAS_APPROVE = BigInt(90_000);
const GAS_COST_BUFFER_BPS = BigInt(12500);
const BPS_DENOMINATOR = BigInt(10000);

export function useMiningOrchestration({
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
  silentSend7702Ref,
  signEip7702DelegationRef,
  eip7702Ref,
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
}: UseMiningOrchestrationOptions) {
  const waitReceipt = useMiningReceipt({ publicClientRef });

  const {
    getBumpedFees,
    getUrgentFees,
    getApproveFees,
    assertNativeGasBalance,
    estimateGas,
    ensureContractPreflight,
  } = useMiningRuntimeHelpers({
    getActorAddress,
    publicClientRef,
    tokenGetterWarningShownRef,
    gasBumpBase: GAS_BUMP_BASE,
    minGasPlaceBet: MIN_GAS_PLACE_BET,
    minGasPlaceBatch: MIN_GAS_PLACE_BATCH,
    gasCostBufferBps: GAS_COST_BUFFER_BPS,
    bpsDenominator: BPS_DENOMINATOR,
  });

  const { assertSufficientAllowance, ensureAllowance } = useMiningAllowance({
    assertNativeGasBalance,
    ensureContractPreflight,
    getActorAddress,
    getApproveFees,
    getUrgentFees,
    pendingApproveRef,
    readPublicClient: () => {
      const pc = publicClientRef.current;
      if (!pc) return null;
      return {
        getTransactionCount: (args: unknown) => pc.getTransactionCount(args as never),
        readContract: (args: unknown) => pc.readContract(args as never),
      };
    },
    readSilentSend: () => silentSendRef.current,
    readWriteContractAsync: () => (args: unknown) => writeContractAsyncRef.current(args as never),
    refetchAllowance: () => refetchAllowanceRef.current(),
    waitReceipt,
    ensurePreferredWallet: () => ensurePreferredWalletRef.current?.(),
  });

  const { placeBets, placeBetsSilent, placeBetsPreferSilent } = useMiningBetExecution({
    assertNativeGasBalance,
    assertSufficientAllowance,
    ensureAllowance,
    ensureContractPreflight,
    estimateGas,
    getBumpedFees,
    waitReceipt,
    getActorAddress,
    readPublicClient: () => publicClientRef.current,
    readSilentSend: () => silentSendRef.current,
    readSilentSend7702: () => silentSend7702Ref.current,
    readSignEip7702Delegation: () => signEip7702DelegationRef.current,
    readEip7702Capability: () => eip7702Ref.current,
    readWriteContractAsync: () => (args: unknown) => writeContractAsyncRef.current(args as never),
    ensurePreferredWallet: () => ensurePreferredWalletRef.current?.(),
  });

  const {
    clearScheduledRefetch,
    finalizeMineSuccess,
    handleTileClick,
    selectedTiles,
    selectedTilesEpoch,
    setSelectedTiles,
    setSelectedTilesEpoch,
    setTiles,
  } = useMiningSelectionState({
    autoMineActive: () => autoMineRef.current,
    refetchDelayMs: REFETCH_DELAY_MS,
    refetchTileData: () => refetchTileDataRef.current(),
    refetchUserBets: () => refetchUserBetsRef.current(),
  });

  const checkBetAlreadyConfirmed = useMiningBetStatus({ publicClientRef });

  const { handleDirectMine, handleManualMine } = useMiningManualActions({
    autoMineActive: () => autoMineRef.current,
    checkBetAlreadyConfirmed,
    ensureAllowance,
    finalizeMineSuccess,
    getActorAddress,
    getBumpedFees,
    placeBetsPreferSilent,
    selectedTiles,
    setIsPending,
    setSelectedTiles,
    setSelectedTilesEpoch,
    notify: notifyRef.current,
  });

  const completeAutoMineRound = useMiningRoundCompletion({
    onAnnounceBet: () => onAutoMineBetConfirmedRef.current?.(),
    refetchEpoch: () => refetchEpochRef.current?.(),
    refetchGridEpochData: () => refetchGridEpochDataRef.current?.(),
    refetchTileData: () => refetchTileDataRef.current(),
    refetchUserBets: () => refetchUserBetsRef.current(),
    saveSession,
    setAutoMineProgress,
    setSelectedTiles,
    setSelectedTilesEpoch,
    refetchDelayMs: REFETCH_DELAY_MS,
  });

  const runAutoMining = useMiningAutoMineRunner({
    approveRetryMax: APPROVE_RETRY_MAX,
    assertNativeGasBalance,
    autoMineRef,
    autoResumeRequestedRef,
    betPendingGraceMs: BET_PENDING_GRACE_MS,
    betPendingStaleMs: BET_PENDING_STALE_MS,
    completeAutoMineRound,
    forceReplacePendingNonceGap: FORCE_REPLACE_PENDING_NONCE_GAP,
    gasBumpBase: GAS_BUMP_BASE,
    gasBumpReplacementStep: GAS_BUMP_REPLACEMENT_STEP,
    getBumpedFees,
    getPreferredActorAddress,
    getUrgentFees,
    maxBetAttempts: MAX_BET_ATTEMPTS,
    maxNetworkAttempts: NETWORK_RETRY_MAX,
    maxNetworkMs: NETWORK_BACKOFF_MAX_MS,
    minGasApprove: MIN_GAS_APPROVE,
    networkInitialMs: NETWORK_BACKOFF_INITIAL_MS,
    networkRetryMax: NETWORK_RETRY_MAX,
    onAutoMineBetConfirmedRef,
    pendingApproveRef,
    pendingBetRef,
    placeBets,
    placeBetsSilent,
    publicClientRef,
    refetchAllowanceRef,
    refetchEpochRef,
    refreshSessionRef,
    sessionExpiredErrorRef,
    setAutoMineProgress,
    setIsAutoMining,
    setRunningParams,
    setSelectedTiles,
    setSelectedTilesEpoch,
    silentSendRef,
    waitReceipt,
    readWriteContractAsync: () => (args: unknown) => writeContractAsyncRef.current(args as never),
    ensurePreferredWalletRef,
  });

  const { handleAutoMineToggle } = useMiningLifecycle({
    autoMineRef,
    autoResumeRequestedRef,
    clearScheduledRefetch,
    getPreferredActorAddress,
    hasPreferredActor,
    isAutoMining,
    publicClientReady: Boolean(publicClient),
    restoreAttemptedRef,
    runAutoMining,
    sessionExpiredErrorRef,
    setAutoMineProgress,
    setIsAutoMining,
    setRunningParams,
  });

  return {
    selectedTiles,
    selectedTilesEpoch,
    handleManualMine,
    handleDirectMine,
    handleAutoMineToggle,
    handleTileClick,
    setTiles,
  };
}
