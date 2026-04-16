"use client";

import { useMemo } from "react";
import type { PublicClient } from "viem";
import type { useWriteContract } from "wagmi";
import { useEmbeddedWalletUi } from "./useEmbeddedWalletUi";
import { usePageWalletOverview } from "./usePageWalletOverview";
import { useWalletActions } from "./useWalletActions";

type NotifyFn = (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
type WriteContractAsyncFn = ReturnType<typeof useWriteContract>["writeContractAsync"];
type SilentSendFn = (
  tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint; nonce?: number; feeMode?: "normal" | "keeper" },
  gasOverrides?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasPrice?: bigint },
) => Promise<`0x${string}`>;
type ExternalSendFn = (tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint }) => Promise<`0x${string}`>;

interface UseLineaOreWalletRuntimeOptions {
  address?: `0x${string}`;
  normalizedEmbeddedAddress?: `0x${string}`;
  formattedLineaBalance: string | null;
  isPageVisible: boolean;
  embeddedWalletAddress: string | null;
  externalWalletAddress: string | null;
  writeContractAsync: WriteContractAsyncFn;
  sendTransactionSilent?: SilentSendFn;
  sendTransactionFromExternal: ExternalSendFn;
  publicClient?: PublicClient;
  walletTransfers: unknown;
  fetchWalletTransfers?: () => Promise<void> | void;
  notify: NotifyFn;
  openWalletSettings: () => void;
  minEthForGas: number;
  minEthWithdrawReserveWei: bigint;
}

export function useLineaOreWalletRuntime({
  address,
  normalizedEmbeddedAddress,
  formattedLineaBalance,
  isPageVisible,
  embeddedWalletAddress,
  externalWalletAddress,
  writeContractAsync,
  sendTransactionSilent,
  sendTransactionFromExternal,
  publicClient,
  walletTransfers,
  fetchWalletTransfers,
  notify,
  openWalletSettings,
  minEthForGas,
  minEthWithdrawReserveWei,
}: UseLineaOreWalletRuntimeOptions) {
  const walletOverview = usePageWalletOverview({
    address,
    normalizedEmbeddedAddress,
    formattedLineaBalance,
    isPageVisible,
  });

  const walletUi = useEmbeddedWalletUi(embeddedWalletAddress);

  const walletActions = useWalletActions({
    connectedWalletAddress: address,
    embeddedWalletAddress,
    externalWalletAddress,
    embeddedTokenBalance: walletOverview.embeddedTokenBalance,
    embeddedEthBalance: walletOverview.embeddedEthBalance,
    writeContractAsync,
    sendTransactionSilent,
    sendTransactionFromExternal,
    publicClient,
    refetchEmbeddedEthBalance: walletOverview.refetchEmbeddedEthBalance,
    refetchEmbeddedTokenBalance: walletOverview.refetchEmbeddedTokenBalance,
    walletTransfersEnabled: Boolean(walletTransfers),
    fetchWalletTransfers,
    notify,
    onOpenWalletSettings: openWalletSettings,
    minEthForGas,
    minEthWithdrawReserveWei,
  });

  return useMemo(
    () => ({
      ...walletOverview,
      ...walletUi,
      ...walletActions,
    }),
    [walletOverview, walletUi, walletActions],
  );
}
