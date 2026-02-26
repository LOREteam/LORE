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
import { parseUnits, formatUnits } from "viem";
import { lineaSepoliaChain } from "../providers";

/** 105% - keeps tx inclusion without materially overpaying gas. */
const GAS_BUMP_PERCENT = BigInt(105);
const SILENT_SEND_TIMEOUT_MS = 45_000;
const MAX_FEE_GWEI = 0.12;

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
      const ceilingWei = parseUnits(MAX_FEE_GWEI.toString(), 9);
      if (gasOverrides && ("maxFeePerGas" in gasOverrides || "gasPrice" in gasOverrides)) {
        if (gasOverrides.maxFeePerGas) baseRequest.maxFeePerGas = gasOverrides.maxFeePerGas;
        if (gasOverrides.maxPriorityFeePerGas) baseRequest.maxPriorityFeePerGas = gasOverrides.maxPriorityFeePerGas;
        if (gasOverrides.gasPrice) baseRequest.gasPrice = gasOverrides.gasPrice;
      } else if (publicClient) {
        try {
          const fees = await publicClient.estimateFeesPerGas();
          if (fees?.maxFeePerGas && fees?.maxPriorityFeePerGas) {
            const bumped = (fees.maxFeePerGas * GAS_BUMP_PERCENT) / BigInt(100);
            const bumpedGwei = Number(formatUnits(bumped, 9));
            if (bumpedGwei > MAX_FEE_GWEI) {
              throw new Error(`Gas fee ceiling exceeded: ${bumpedGwei.toFixed(3)} gwei > ${MAX_FEE_GWEI.toFixed(3)} gwei`);
            }
            baseRequest.maxFeePerGas = bumped;
            baseRequest.maxPriorityFeePerGas = (fees.maxPriorityFeePerGas * GAS_BUMP_PERCENT) / BigInt(100);
          } else if (fees?.gasPrice) {
            const bumped = (fees.gasPrice * GAS_BUMP_PERCENT) / BigInt(100);
            const bumpedGwei = Number(formatUnits(bumped, 9));
            if (bumpedGwei > MAX_FEE_GWEI) {
              throw new Error(`Gas fee ceiling exceeded: ${bumpedGwei.toFixed(3)} gwei > ${MAX_FEE_GWEI.toFixed(3)} gwei`);
            }
            baseRequest.gasPrice = bumped;
          }
        } catch (err) {
          if (err instanceof Error && err.message.includes("Gas fee ceiling exceeded")) throw err;
          baseRequest.maxFeePerGas = ceilingWei;
          baseRequest.maxPriorityFeePerGas = ceilingWei;
        }
      } else {
        baseRequest.maxFeePerGas = ceilingWei;
        baseRequest.maxPriorityFeePerGas = ceilingWei;
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
