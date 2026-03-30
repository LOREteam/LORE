"use client";

import { useCallback, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { PublicClient } from "viem";
import type { RefreshSessionFn, MiningNotifyFn } from "./useMining";
import type { GasOverrides } from "./useMining";

type SilentSendFn = (
  tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint; nonce?: number },
  gasOverrides?: GasOverrides,
) => Promise<`0x${string}`>;

type RunningParams = { betStr: string; blocks: number; rounds: number } | null;

interface UseMiningRuntimeStateOptions {
  address?: `0x${string}`;
  publicClient: PublicClient | undefined;
  writeContractAsync: (args: unknown) => Promise<`0x${string}`>;
  preferredAddress?: `0x${string}` | string | null;
  ensurePreferredWallet?: () => Promise<void> | void;
  sendTransactionSilent?: SilentSendFn;
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
  pendingApproveRef: MutableRefObject<{ hash: `0x${string}`; submittedAt: number; nonce: number } | null>;
  pendingBetRef: MutableRefObject<{ submittedAt: number; nonce: number } | null>;
  publicClientRef: MutableRefObject<PublicClient | undefined>;
  silentSendRef: MutableRefObject<SilentSendFn | undefined>;
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

  publicClientRef.current = publicClient;
  silentSendRef.current = sendTransactionSilent;
  refreshSessionRef.current = refreshSession;
  writeContractAsyncRef.current = writeContractAsync;
  preferredAddressRef.current = preferredAddress ?? null;
  ensurePreferredWalletRef.current = ensurePreferredWallet;
  refetchAllowanceRef.current = refetchAllowance;
  refetchTileDataRef.current = refetchTileData;
  refetchUserBetsRef.current = refetchUserBets;
  refetchEpochRef.current = refetchEpoch;
  refetchGridEpochDataRef.current = refetchGridEpochData;
  onAutoMineBetConfirmedRef.current = onAutoMineBetConfirmed;
  notifyRef.current = onNotify;

  const hasPreferredActor = Boolean(preferredAddress);
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
