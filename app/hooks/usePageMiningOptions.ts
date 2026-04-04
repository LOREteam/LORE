"use client";

import { useCallback, useMemo } from "react";
import type { Eip7702CapabilityState, Signed7702AuthorizationLike } from "../lib/eip7702";

type NotifyTone = "info" | "success" | "warning" | "danger";
type NotifyFn = (message: string, tone?: NotifyTone) => void;
type SilentSendFn = (
  tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint; nonce?: number },
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
type RefreshSessionFn = () => Promise<void>;
type PlaySoundFn = (name: "autoBet") => void;

interface UsePageMiningOptions {
  embeddedWalletAddress?: string | null;
  ensureEmbeddedWallet?: () => Promise<void> | void;
  getAccessToken: () => Promise<string | null>;
  notify: NotifyFn;
  playSound: PlaySoundFn;
  refetchAllowance: () => void;
  refetchEpoch?: () => void;
  refetchGridEpochData?: () => void;
  refetchTileData: () => void;
  refetchUserBets: () => void;
  sendTransactionSilent?: SilentSendFn;
  sendTransaction7702?: SilentSend7702Fn;
  signEip7702Delegation?: Sign7702DelegationFn;
  eip7702?: Eip7702CapabilityState;
}

export function usePageMiningOptions({
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
}: UsePageMiningOptions) {
  const refreshSession = useCallback<RefreshSessionFn>(async () => {
    await getAccessToken();
  }, [getAccessToken]);

  return useMemo(() => ({
    refetchAllowance,
    refetchTileData,
    refetchUserBets,
    refetchEpoch,
    refetchGridEpochData,
    preferredAddress: embeddedWalletAddress || undefined,
    ensurePreferredWallet: embeddedWalletAddress ? ensureEmbeddedWallet : undefined,
    sendTransactionSilent,
    sendTransaction7702,
    signEip7702Delegation,
    eip7702,
    refreshSession,
    onAutoMineBetConfirmed: () => playSound("autoBet"),
    onNotify: notify,
  }), [
    refetchAllowance,
    refetchTileData,
    refetchUserBets,
    refetchEpoch,
    refetchGridEpochData,
    embeddedWalletAddress,
    ensureEmbeddedWallet,
    sendTransactionSilent,
    sendTransaction7702,
    signEip7702Delegation,
    eip7702,
    refreshSession,
    playSound,
    notify,
  ]);
}
