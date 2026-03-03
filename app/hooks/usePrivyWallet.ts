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
import { parseGwei, toHex } from "viem";
import { lineaSepoliaChain } from "../providers";

/** 105% - keeps tx inclusion without materially overpaying gas. */
const GAS_BUMP_PERCENT = BigInt(105);
/** Minimum 0.5 gwei so RPC flukes (e.g. 0.038 gwei) don't cause estimateGas to fail with "Out of gas". */
const MIN_FEE_PER_GAS_WEI = parseGwei("0.5");
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
      setActiveWallet(embeddedWallet).catch((err) => {
        console.warn("[PrivyWallet] setActiveWallet failed:", err);
      });
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
        value: tx.value !== undefined && tx.value !== BigInt(0) ? tx.value : undefined,
        chainId: lineaSepoliaChain.id,
        ...(tx.gas ? { gas: tx.gas } : {}),
      };
      if (gasOverrides && ("maxFeePerGas" in gasOverrides || "gasPrice" in gasOverrides)) {
        if (gasOverrides.maxFeePerGas) baseRequest.maxFeePerGas = gasOverrides.maxFeePerGas;
        if (gasOverrides.maxPriorityFeePerGas) baseRequest.maxPriorityFeePerGas = gasOverrides.maxPriorityFeePerGas;
        if (gasOverrides.gasPrice) baseRequest.gasPrice = gasOverrides.gasPrice;
      } else if (publicClient) {
        try {
          const fees = await publicClient.estimateFeesPerGas();
          if (fees?.maxFeePerGas && fees?.maxPriorityFeePerGas) {
            let maxFee = (fees.maxFeePerGas * GAS_BUMP_PERCENT) / BigInt(100);
            let maxPri = (fees.maxPriorityFeePerGas * GAS_BUMP_PERCENT) / BigInt(100);
            if (maxFee < MIN_FEE_PER_GAS_WEI) maxFee = MIN_FEE_PER_GAS_WEI;
            if (maxPri < MIN_FEE_PER_GAS_WEI) maxPri = MIN_FEE_PER_GAS_WEI;
            baseRequest.maxFeePerGas = maxFee;
            baseRequest.maxPriorityFeePerGas = maxPri;
          } else if (fees?.gasPrice) {
            const gasPrice = (fees.gasPrice * GAS_BUMP_PERCENT) / BigInt(100);
            baseRequest.gasPrice = gasPrice < MIN_FEE_PER_GAS_WEI ? MIN_FEE_PER_GAS_WEI : gasPrice;
          }
        } catch {
          /* let wallet decide gas */
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

  const sendTransactionFromExternal = useCallback(
    async (tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint }) => {
      if (!externalWallet) throw new Error("External wallet not connected.");
      // External-wallet flow: trigger the wallet's own send tx prompt directly.
      // This is more reliable than routing through embedded sendTransaction flow.
      const provider = await externalWallet.getEthereumProvider();
      const targetChainIdHex = toHex(lineaSepoliaChain.id) as `0x${string}`;
      try {
        await externalWallet.switchChain(lineaSepoliaChain.id);
      } catch (switchErr) {
        console.warn("[PrivyWallet] switchChain failed, trying EIP-1193 fallback:", switchErr);
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: targetChainIdHex }],
        }).catch((fbErr) => {
          console.warn("[PrivyWallet] EIP-1193 switchChain fallback also failed:", fbErr);
        });
      }
      const currentChainId = (await provider.request({ method: "eth_chainId" }) as string | undefined)?.toLowerCase();
      if (!currentChainId || currentChainId !== targetChainIdHex.toLowerCase()) {
        throw new Error("Switch your external wallet to Linea Sepolia and try again.");
      }
      const requestTx: {
        from: `0x${string}`;
        to: `0x${string}`;
        data?: `0x${string}`;
        value?: `0x${string}`;
        gas?: `0x${string}`;
      } = {
        from: externalWallet.address as `0x${string}`,
        to: tx.to,
      };
      if (tx.data) requestTx.data = tx.data;
      if (tx.value !== undefined && tx.value !== BigInt(0)) requestTx.value = toHex(tx.value) as `0x${string}`;
      if (tx.gas) requestTx.gas = toHex(tx.gas) as `0x${string}`;

      const hash = await withTimeout(
        provider.request({
          method: "eth_sendTransaction",
          params: [requestTx],
        }) as Promise<string>,
        SILENT_SEND_TIMEOUT_MS,
        "External wallet eth_sendTransaction",
      );
      return hash as `0x${string}`;
    },
    [externalWallet],
  );

  return {
    embeddedWalletAddress,
    externalWalletAddress,
    ensureEmbeddedWallet,
    exportEmbeddedWallet,
    createEmbeddedWallet,
    sendTransactionSilent,
    sendTransactionFromExternal,
  };
}
