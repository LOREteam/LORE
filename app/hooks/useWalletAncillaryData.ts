"use client";

import { useDeepRewardScan } from "./useDeepRewardScan";
import { useWalletTransfers } from "./useWalletTransfers";

type NotifyTone = "info" | "success" | "warning" | "danger";
type NotifyFn = (message: string, tone?: NotifyTone) => void;
type SilentSendFn = (
  tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint; nonce?: number },
  gasOverrides?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } | { gasPrice?: bigint },
) => Promise<`0x${string}`>;

interface UseWalletAncillaryDataOptions {
  embeddedWalletAddress?: string | null;
  externalWalletAddress?: string | null;
  notify: NotifyFn;
  sendTransactionSilent?: SilentSendFn;
}

export function useWalletAncillaryData({
  embeddedWalletAddress,
  externalWalletAddress,
  notify,
  sendTransactionSilent,
}: UseWalletAncillaryDataOptions) {
  const {
    data: walletTransfers,
    loading: walletTransfersLoading,
    fetch: fetchWalletTransfers,
  } = useWalletTransfers(embeddedWalletAddress ?? undefined, externalWalletAddress);

  const {
    wins: deepScanWins,
    scanning: deepScanScanning,
    claiming: deepScanClaiming,
    progress: deepScanProgress,
    scan: deepScan,
    stop: deepScanStop,
    claimOne: deepClaimOne,
    claimAllDeep,
  } = useDeepRewardScan(sendTransactionSilent, notify);

  return {
    walletTransfers,
    walletTransfersLoading,
    fetchWalletTransfers,
    deepScanWins,
    deepScanScanning,
    deepScanClaiming,
    deepScanProgress,
    deepScan,
    deepScanStop,
    deepClaimOne,
    claimAllDeep,
  };
}
