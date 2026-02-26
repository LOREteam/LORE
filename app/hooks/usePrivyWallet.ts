"use client";

import { useCallback, useEffect, useMemo } from "react";
import {
  getEmbeddedConnectedWallet,
  useCreateWallet,
  useExportWallet,
  useSendTransaction,
  useWallets,
} from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";
import { useAccount, usePublicClient } from "wagmi";
import { lineaSepoliaChain } from "../providers";

/** 105% - keeps tx inclusion without materially overpaying gas. */
const GAS_BUMP_PERCENT = BigInt(105);
const SILENT_SEND_TIMEOUT_MS = 45_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const guarded = promise.catch((err) => {
    // Prevent unhandled rejection noise when timeout wins the race.
    throw err;
  });
  return Promise.race([
    guarded,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

export function usePrivyWallet() {
  const { wallets } = useWallets();
  const { setActiveWallet } = useSetActiveWallet();
  const { exportWallet } = useExportWallet();
  const { createWallet } = useCreateWallet();
  const { sendTransaction } = useSendTransaction();
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: lineaSepoliaChain.id });

  const embeddedWallet = useMemo(() => getEmbeddedConnectedWallet(wallets), [wallets]);
  const externalWallet = useMemo(() => {
    if (!embeddedWallet) return wallets[0];
    return wallets.find((wallet) => wallet.address.toLowerCase() !== embeddedWallet.address.toLowerCase());
  }, [wallets, embeddedWallet]);

  const embeddedWalletAddress = embeddedWallet?.address ?? null;
  const externalWalletAddress = externalWallet?.address ?? null;

  // Always keep embedded wallet as active signer
  useEffect(() => {
    if (!embeddedWallet || !address) return;
    if (address.toLowerCase() !== embeddedWallet.address.toLowerCase()) {
      setActiveWallet(embeddedWallet).catch(() => {});
    }
  }, [embeddedWallet, address, setActiveWallet]);

  const ensureEmbeddedWallet = useCallback(async () => {
    if (!embeddedWallet) throw new Error("Privy embedded wallet not found.");
    await setActiveWallet(embeddedWallet);
  }, [embeddedWallet, setActiveWallet]);

  const exportEmbeddedWallet = useCallback(async () => {
    if (!embeddedWalletAddress) return;
    await exportWallet({ address: embeddedWalletAddress });
  }, [embeddedWalletAddress, exportWallet]);

  const createEmbeddedWallet = useCallback(async () => {
    await createWallet();
  }, [createWallet]);

  const sendTransactionSilent = useCallback(
    async (
      tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint },
      gasOverrides?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasPrice?: bigint },
    ) => {
      if (!embeddedWallet || !embeddedWalletAddress) throw new Error("Privy embedded wallet not found.");
      // Some flows can switch active signer to external wallet; force embedded signer for silent tx.
      await setActiveWallet(embeddedWallet);
      const baseRequest: Parameters<typeof sendTransaction>[0] = {
        to: tx.to,
        data: tx.data,
        value: tx.value !== undefined && tx.value !== BigInt(0) ? Number(tx.value) : undefined,
        chainId: lineaSepoliaChain.id,
        ...(tx.gas ? { gas: Number(tx.gas) } : {}),
      };
      if (gasOverrides && ("maxFeePerGas" in gasOverrides || "gasPrice" in gasOverrides)) {
        if (gasOverrides.maxFeePerGas) baseRequest.maxFeePerGas = gasOverrides.maxFeePerGas;
        if (gasOverrides.maxPriorityFeePerGas) baseRequest.maxPriorityFeePerGas = gasOverrides.maxPriorityFeePerGas;
        if (gasOverrides.gasPrice) baseRequest.gasPrice = gasOverrides.gasPrice;
      } else if (publicClient) {
        try {
          const fees = await publicClient.estimateFeesPerGas();
          if (fees?.maxFeePerGas && fees?.maxPriorityFeePerGas) {
            baseRequest.maxFeePerGas = (fees.maxFeePerGas * GAS_BUMP_PERCENT) / BigInt(100);
            baseRequest.maxPriorityFeePerGas = (fees.maxPriorityFeePerGas * GAS_BUMP_PERCENT) / BigInt(100);
          } else if (fees?.gasPrice) {
            baseRequest.gasPrice = (fees.gasPrice * GAS_BUMP_PERCENT) / BigInt(100);
          }
        } catch {
          /* keep request without gas overrides */
        }
      }
      const receipt = await withTimeout(
        sendTransaction(baseRequest, {
          uiOptions: { showWalletUIs: false },
        }),
        SILENT_SEND_TIMEOUT_MS,
        "Privy sendTransaction",
      );
      return receipt.hash as `0x${string}`;
    },
    [sendTransaction, embeddedWallet, embeddedWalletAddress, publicClient, setActiveWallet],
  );

  return {
    embeddedWalletAddress,
    externalWalletAddress,
    ensureEmbeddedWallet,
    exportEmbeddedWallet,
    createEmbeddedWallet,
    sendTransactionSilent,
  };
}
