"use client";

import { useCallback, useMemo } from "react";

type NotifyTone = "info" | "success" | "warning" | "danger";
type NotifyFn = (message: string, tone?: NotifyTone) => void;
type SilentSendFn = (
  tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint; nonce?: number },
  gasOverrides?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } | { gasPrice?: bigint },
) => Promise<`0x${string}`>;
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
    refreshSession,
    playSound,
    notify,
  ]);
}
