"use client";

import { useCallback, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { PublicClient } from "viem";
import type { Eip7702CapabilityState } from "../lib/eip7702";
import type {
  MiningNotifyFn,
  RefreshSessionFn,
  RunningParams,
  Sign7702DelegationFn,
  SilentSendFn,
  SilentSend7702Fn,
} from "./useMining.types";
import type { PendingApproveState, PendingBetState } from "./useMining.stateTypes";

interface UseMiningRuntimeStateOptions {
  address?: `0x${string}`;
  publicClient: PublicClient | undefined;
  writeContractAsync: (args: unknown) => Promise<`0x${string}`>;
  preferredAddress?: `0x${string}` | string | null;
  ensurePreferredWallet?: () => Promise<void> | void;
  sendTransactionSilent?: SilentSendFn;
  sendTransaction7702?: SilentSend7702Fn;
  signEip7702Delegation?: Sign7702DelegationFn;
  eip7702?: Eip7702CapabilityState;
  refreshSession?: RefreshSessionFn;
  onAutoMineBetConfirmed?: () => void;
  onNotify?: MiningNotifyFn;
  refetchAllowance: () => void;
  refetchTileData: () => void;
  refetchUserBets: () => void;
  refetchEpoch?: () => void;
  refetchGridEpochData?: () => void;
}

interface UseMiningRuntimeStateResult {
  isPending: boolean;
  setIsPending: Dispatch<SetStateAction<boolean>>;
  isAutoMining: boolean;
  setIsAutoMining: Dispatch<SetStateAction<boolean>>;
  autoMineProgress: string | null;
  setAutoMineProgress: Dispatch<SetStateAction<string | null>>;
  runningParams: RunningParams;
  setRunningParams: Dispatch<SetStateAction<RunningParams>>;
  hasPreferredActor: boolean;
  getActorAddress: () => string | null;
  getPreferredActorAddress: () => string | null;
  autoMineRef: MutableRefObject<boolean>;
  autoResumeRequestedRef: MutableRefObject<boolean>;
  restoreAttemptedRef: MutableRefObject<boolean>;
  sessionExpiredErrorRef: MutableRefObject<boolean>;
  tokenGetterWarningShownRef: MutableRefObject<boolean>;
  pendingApproveRef: MutableRefObject<PendingApproveState | null>;
  pendingBetRef: MutableRefObject<PendingBetState | null>;
  publicClientRef: MutableRefObject<PublicClient | undefined>;
  silentSendRef: MutableRefObject<SilentSendFn | undefined>;
  silentSend7702Ref: MutableRefObject<SilentSend7702Fn | undefined>;
  signEip7702DelegationRef: MutableRefObject<Sign7702DelegationFn | undefined>;
  eip7702Ref: MutableRefObject<Eip7702CapabilityState | undefined>;
  refreshSessionRef: MutableRefObject<RefreshSessionFn | undefined>;
  writeContractAsyncRef: MutableRefObject<(args: unknown) => Promise<`0x${string}`>>;
  preferredAddressRef: MutableRefObject<string | null>;
  ensurePreferredWalletRef: MutableRefObject<(() => Promise<void> | void) | undefined>;
  refetchAllowanceRef: MutableRefObject<() => void>;
  refetchTileDataRef: MutableRefObject<() => void>;
  refetchUserBetsRef: MutableRefObject<() => void>;
  refetchEpochRef: MutableRefObject<(() => void) | undefined>;
  refetchGridEpochDataRef: MutableRefObject<(() => void) | undefined>;
  onAutoMineBetConfirmedRef: MutableRefObject<(() => void) | undefined>;
  notifyRef: MutableRefObject<MiningNotifyFn | undefined>;
}

export function useMiningRuntimeState({
  address,
  publicClient,
  writeContractAsync,
  preferredAddress,
  ensurePreferredWallet,
  sendTransactionSilent,
  sendTransaction7702,
  signEip7702Delegation,
  eip7702,
  refreshSession,
  onAutoMineBetConfirmed,
  onNotify,
  refetchAllowance,
  refetchTileData,
  refetchUserBets,
  refetchEpoch,
  refetchGridEpochData,
}: UseMiningRuntimeStateOptions): UseMiningRuntimeStateResult {
  const [isPending, setIsPending] = useState(false);
  const [isAutoMining, setIsAutoMining] = useState(false);
  const [autoMineProgress, setAutoMineProgress] = useState<string | null>(null);
  const [runningParams, setRunningParamsState] = useState<RunningParams>(null);
  const autoMineRef = useRef(false);
  const autoResumeRequestedRef = useRef(false);
  const restoreAttemptedRef = useRef(false);
  const sessionExpiredErrorRef = useRef(false);
  const tokenGetterWarningShownRef = useRef(false);
  const pendingApproveRef = useRef<{ hash: `0x${string}`; submittedAt: number; nonce: number } | null>(null);
  const pendingBetRef = useRef<{ submittedAt: number; nonce: number } | null>(null);

  const publicClientRef = useRef(publicClient);
  const silentSendRef = useRef(sendTransactionSilent);
  const silentSend7702Ref = useRef(sendTransaction7702);
  const signEip7702DelegationRef = useRef(signEip7702Delegation);
  const eip7702Ref = useRef(eip7702);
  const refreshSessionRef = useRef(refreshSession);
  const writeContractAsyncRef = useRef(writeContractAsync);
  const preferredAddressRef = useRef<string | null>(preferredAddress ?? null);
  const ensurePreferredWalletRef = useRef(ensurePreferredWallet);
  const refetchAllowanceRef = useRef(refetchAllowance);
  const refetchTileDataRef = useRef(refetchTileData);
  const refetchUserBetsRef = useRef(refetchUserBets);
  const refetchEpochRef = useRef(refetchEpoch);
  const refetchGridEpochDataRef = useRef(refetchGridEpochData);
  const onAutoMineBetConfirmedRef = useRef(onAutoMineBetConfirmed);
  const notifyRef = useRef(onNotify);
  const preserveTransientRuntime = isAutoMining || autoResumeRequestedRef.current;

  publicClientRef.current = publicClient ?? (preserveTransientRuntime ? publicClientRef.current : undefined);
  silentSendRef.current = sendTransactionSilent ?? (preserveTransientRuntime ? silentSendRef.current : undefined);
  silentSend7702Ref.current = sendTransaction7702 ?? (preserveTransientRuntime ? silentSend7702Ref.current : undefined);
  signEip7702DelegationRef.current =
    signEip7702Delegation ?? (preserveTransientRuntime ? signEip7702DelegationRef.current : undefined);
  eip7702Ref.current = eip7702 ?? (preserveTransientRuntime ? eip7702Ref.current : undefined);
  refreshSessionRef.current = refreshSession ?? (preserveTransientRuntime ? refreshSessionRef.current : undefined);
  writeContractAsyncRef.current = writeContractAsync;
  preferredAddressRef.current = preferredAddress ?? (preserveTransientRuntime ? preferredAddressRef.current : null);
  ensurePreferredWalletRef.current = ensurePreferredWallet ?? (preserveTransientRuntime ? ensurePreferredWalletRef.current : undefined);
  refetchAllowanceRef.current = refetchAllowance;
  refetchTileDataRef.current = refetchTileData;
  refetchUserBetsRef.current = refetchUserBets;
  refetchEpochRef.current = refetchEpoch;
  refetchGridEpochDataRef.current = refetchGridEpochData;
  onAutoMineBetConfirmedRef.current = onAutoMineBetConfirmed;
  notifyRef.current = onNotify;

  const hasPreferredActor = Boolean(preferredAddress ?? (preserveTransientRuntime ? preferredAddressRef.current : null));
  const getActorAddress = useCallback(() => preferredAddressRef.current ?? address ?? null, [address]);
  const getPreferredActorAddress = useCallback(() => preferredAddressRef.current ?? null, []);

  return {
    isPending,
    setIsPending,
    isAutoMining,
    setIsAutoMining,
    autoMineProgress,
    setAutoMineProgress,
    runningParams,
    setRunningParams: setRunningParamsState,
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
    silentSend7702Ref,
    signEip7702DelegationRef,
    eip7702Ref,
    refreshSessionRef,
    writeContractAsyncRef,
    preferredAddressRef,
    ensurePreferredWalletRef,
    refetchAllowanceRef,
    refetchTileDataRef,
    refetchUserBetsRef,
    refetchEpochRef,
    refetchGridEpochDataRef,
    onAutoMineBetConfirmedRef,
    notifyRef,
  };
}
