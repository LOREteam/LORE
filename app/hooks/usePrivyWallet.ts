"use client";

import { useCallback, useEffect, useMemo } from "react";
import {
  getEmbeddedConnectedWallet,
  usePrivy,
  useCreateWallet,
  useExportWallet,
  useSendTransaction,
  useSignTransaction,
  useSign7702Authorization,
  useWallets,
} from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";
import { useAccount, usePublicClient } from "wagmi";
import { toHex } from "viem";
import { APP_CHAIN_ID, APP_CHAIN_NAME } from "../lib/constants";
import {
  EIP7702_DELEGATE_ADDRESS,
  type Signed7702AuthorizationLike,
  getEip7702CapabilityState,
} from "../lib/eip7702";
import { getFallbackFeeOverrides, getKeeperFeeOverrides, getLineaFeeOverrides } from "../lib/lineaFees";
import { usePrivy7702Diagnostics } from "./usePrivy7702Diagnostics";

const SILENT_SEND_TIMEOUT_MS = 45_000;
const EIP7702_SEND_TIMEOUT_MS = 12_000;
const ACTIVE_WALLET_TIMEOUT_MS = 12_000;

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
};

function formatUnknownError(error: unknown) {
  if (error instanceof Error) {
    const parts = [error.message];
    const named = error.name && error.name !== "Error" ? error.name : null;
    if (named && !parts.some((part) => part.includes(named))) {
      parts.unshift(named);
    }
    const maybeStatus = (error as Error & { status?: unknown }).status;
    if (
      (typeof maybeStatus === "number" || typeof maybeStatus === "string") &&
      !parts.some((part) => part.includes(`Status:`))
    ) {
      parts.push(`Status: ${String(maybeStatus)}`);
    }
    const maybeCode = (error as Error & { code?: unknown }).code;
    if ((typeof maybeCode === "number" || typeof maybeCode === "string") && !parts.some((part) => part.includes(`Code:`))) {
      parts.push(`Code: ${String(maybeCode)}`);
    }
    const maybeDetails = (error as Error & { details?: unknown }).details;
    if (typeof maybeDetails === "string" && maybeDetails && !parts.includes(maybeDetails)) {
      parts.push(`Details: ${maybeDetails}`);
    }
    const maybeData = (error as Error & { data?: unknown }).data;
    if (maybeData !== undefined) {
      try {
        const serializedData = JSON.stringify(maybeData);
        if (serializedData && serializedData !== "{}" && !parts.includes(serializedData)) {
          parts.push(`Data: ${serializedData}`);
        }
      } catch {}
    }
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message && !parts.includes(cause.message)) {
      parts.push(`Cause: ${cause.message}`);
    } else if (typeof cause === "string" && cause && !parts.includes(cause)) {
      parts.push(`Cause: ${cause}`);
    }
    return parts.join(" | ");
  }
  return String(error);
}

function summarizeSendStep(step: string, error: unknown) {
  return `${step}: ${formatUnknownError(error)}`;
}

function normalizeAuthorizationForRpc(authorization: Signed7702AuthorizationLike) {
  return {
    address: authorization.address,
    chainId: toHex(BigInt(authorization.chainId)),
    nonce: toHex(BigInt(authorization.nonce)),
    yParity: toHex(BigInt(authorization.yParity)),
    r: authorization.r,
    s: authorization.s,
  };
}

function normalizeRpcTransactionRequest(request: Record<string, unknown>) {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(request)) {
    if (value === undefined) continue;
    if (typeof value === "bigint") {
      normalized[key] = toHex(value);
      continue;
    }
    normalized[key] = value;
  }
  return normalized;
}

async function ensureProviderChain(provider: Eip1193Provider, chainId: number) {
  const targetChainIdHex = toHex(chainId) as `0x${string}`;
  const currentChainId = (await provider.request({ method: "eth_chainId" }) as string | undefined)?.toLowerCase();
  if (currentChainId === targetChainIdHex.toLowerCase()) return;
  await provider.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: targetChainIdHex }],
  });
}

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
  const { ready: privyReady, authenticated, user } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { setActiveWallet } = useSetActiveWallet();
  const { exportWallet } = useExportWallet();
  const { createWallet } = useCreateWallet();
  const { sendTransaction } = useSendTransaction();
  const { signTransaction } = useSignTransaction();
  const { signAuthorization: sign7702Authorization } = useSign7702Authorization();
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });

  const embeddedWallet = useMemo(() => getEmbeddedConnectedWallet(wallets), [wallets]);
  const linkedEmbeddedWalletAddress = useMemo(() => {
    for (const account of user?.linkedAccounts ?? []) {
      if (account.type !== "wallet") continue;
      if (account.walletClientType !== "privy") continue;
      if ("chainType" in account && account.chainType && account.chainType !== "ethereum") continue;
      if ("address" in account && typeof account.address === "string") {
        return account.address;
      }
    }
    return null;
  }, [user]);
  const externalWallet = useMemo(() => {
    if (!embeddedWallet) return wallets[0];
    return wallets.find((wallet) => wallet.address.toLowerCase() !== embeddedWallet.address.toLowerCase());
  }, [wallets, embeddedWallet]);

  const embeddedWalletAddress = embeddedWallet?.address ?? linkedEmbeddedWalletAddress ?? null;
  const externalWalletAddress = externalWallet?.address ?? null;
  const embeddedWalletSyncing =
    authenticated &&
    !embeddedWalletAddress &&
    (!privyReady || !walletsReady);

  // Always keep embedded wallet as active signer
  useEffect(() => {
    if (!embeddedWallet || !address) return;
    if (address.toLowerCase() !== embeddedWallet.address.toLowerCase()) {
      setActiveWallet(embeddedWallet).catch((err) => {
        console.warn("[PrivyWallet] setActiveWallet failed:", err instanceof Error ? err.message : String(err));
      });
    }
  }, [embeddedWallet, address, setActiveWallet]);

  const ensureEmbeddedWallet = useCallback(async () => {
    if (!embeddedWallet) throw new Error("Privy embedded wallet not found.");
    try {
      await withTimeout(setActiveWallet(embeddedWallet), ACTIVE_WALLET_TIMEOUT_MS, "Privy setActiveWallet");
    } catch (error) {
      if (error instanceof Error && error.message.includes("Privy setActiveWallet timed out")) {
        error.name = "WalletSwitchTimeoutError";
      }
      throw error;
    }
  }, [embeddedWallet, setActiveWallet]);

  const exportEmbeddedWallet = useCallback(async () => {
    if (!embeddedWalletAddress) return;
    await exportWallet({ address: embeddedWalletAddress });
  }, [embeddedWalletAddress, exportWallet]);

  const createEmbeddedWallet = useCallback(async () => {
    await createWallet();
  }, [createWallet]);

  const signEip7702Delegation = useCallback(
    async (executor: "self" | `0x${string}` = "self"): Promise<Signed7702AuthorizationLike> => {
      if (!EIP7702_DELEGATE_ADDRESS) {
        throw new Error("EIP-7702 delegate address is not configured.");
      }
      if (!embeddedWalletAddress) {
        throw new Error("Privy embedded wallet not found.");
      }
      return sign7702Authorization(
        {
          contractAddress: EIP7702_DELEGATE_ADDRESS,
          chainId: APP_CHAIN_ID,
          executor,
        },
        { address: embeddedWalletAddress },
      );
    },
    [embeddedWalletAddress, sign7702Authorization],
  );

  const sendTransactionSilent = useCallback(
    async (
      tx: {
        to: `0x${string}`;
        data?: `0x${string}`;
        value?: bigint;
        gas?: bigint;
        nonce?: number;
        feeMode?: "normal" | "keeper";
      },
      gasOverrides?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasPrice?: bigint },
    ) => {
      if (!embeddedWallet || !embeddedWalletAddress) throw new Error("Privy embedded wallet not found.");
      // Some flows can switch active signer to external wallet; force embedded signer for silent tx.
      try {
        await withTimeout(setActiveWallet(embeddedWallet), ACTIVE_WALLET_TIMEOUT_MS, "Privy setActiveWallet");
      } catch (error) {
        if (error instanceof Error && error.message.includes("Privy setActiveWallet timed out")) {
          error.name = "WalletSwitchTimeoutError";
        }
        throw error;
      }
      const feeMode = tx.feeMode ?? "normal";
      const baseRequest: Parameters<typeof sendTransaction>[0] = {
        to: tx.to,
        data: tx.data,
        value: tx.value !== undefined && tx.value !== BigInt(0) ? tx.value : undefined,
        chainId: APP_CHAIN_ID,
        ...(tx.gas ? { gas: tx.gas } : {}),
        ...(tx.nonce !== undefined ? { nonce: BigInt(tx.nonce) } : {}),
      };
      if (gasOverrides && ("maxFeePerGas" in gasOverrides || "gasPrice" in gasOverrides)) {
        if (gasOverrides.maxFeePerGas) baseRequest.maxFeePerGas = gasOverrides.maxFeePerGas;
        if (gasOverrides.maxPriorityFeePerGas) baseRequest.maxPriorityFeePerGas = gasOverrides.maxPriorityFeePerGas;
        if (gasOverrides.gasPrice) baseRequest.gasPrice = gasOverrides.gasPrice;
      } else if (publicClient) {
        try {
          const fees = await publicClient.estimateFeesPerGas();
          const overrides =
            feeMode === "keeper"
              ? getKeeperFeeOverrides(fees, APP_CHAIN_ID)
              : getLineaFeeOverrides(fees, APP_CHAIN_ID);
          if (overrides?.maxFeePerGas) baseRequest.maxFeePerGas = overrides.maxFeePerGas;
          if (overrides?.maxPriorityFeePerGas) baseRequest.maxPriorityFeePerGas = overrides.maxPriorityFeePerGas;
          if (overrides?.gasPrice) baseRequest.gasPrice = overrides.gasPrice;
        } catch {
          const overrides = getFallbackFeeOverrides(APP_CHAIN_ID, feeMode);
          if (overrides.maxFeePerGas) baseRequest.maxFeePerGas = overrides.maxFeePerGas;
          if (overrides.maxPriorityFeePerGas) baseRequest.maxPriorityFeePerGas = overrides.maxPriorityFeePerGas;
          if (overrides.gasPrice) baseRequest.gasPrice = overrides.gasPrice;
        }
      }
      let receipt: Awaited<ReturnType<typeof sendTransaction>>;
      try {
        receipt = await withTimeout(
          sendTransaction(baseRequest, {
            uiOptions: { showWalletUIs: false },
          }),
          SILENT_SEND_TIMEOUT_MS,
          "Privy sendTransaction",
        );
      } catch (error) {
        if (error instanceof Error && error.message.includes("Privy sendTransaction timed out")) {
          error.name = "WalletSendTimeoutError";
        }
        throw error;
      }
      return receipt.hash as `0x${string}`;
    },
    [sendTransaction, embeddedWallet, embeddedWalletAddress, publicClient, setActiveWallet],
  );

  const sendTransaction7702 = useCallback(
    async (
      tx: {
        data?: `0x${string}`;
        value?: bigint;
        gas?: bigint;
        nonce?: number;
        authorizationList: readonly Signed7702AuthorizationLike[];
        sponsor?: boolean;
        feeMode?: "normal" | "keeper";
      },
      gasOverrides?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasPrice?: bigint },
    ) => {
      if (!embeddedWallet || !embeddedWalletAddress) throw new Error("Privy embedded wallet not found.");
      if (!EIP7702_DELEGATE_ADDRESS) throw new Error("EIP-7702 delegate address is not configured.");

      try {
        await withTimeout(setActiveWallet(embeddedWallet), ACTIVE_WALLET_TIMEOUT_MS, "Privy setActiveWallet");
      } catch (error) {
        if (error instanceof Error && error.message.includes("Privy setActiveWallet timed out")) {
          error.name = "WalletSwitchTimeoutError";
        }
        throw error;
      }

      const feeMode = tx.feeMode ?? "normal";
      const sendStepErrors: string[] = [];
      const providerRequest: Record<string, unknown> = {
        from: embeddedWalletAddress,
        to: embeddedWalletAddress,
        chainId: APP_CHAIN_ID,
        type: 4,
        authorizationList: tx.authorizationList.map(normalizeAuthorizationForRpc),
        ...(tx.data ? { data: tx.data } : {}),
        ...(tx.value !== undefined && tx.value !== BigInt(0) ? { value: toHex(tx.value) } : {}),
        ...(tx.gas ? { gas: toHex(tx.gas), gasLimit: toHex(tx.gas) } : {}),
        ...(tx.nonce !== undefined ? { nonce: toHex(tx.nonce) } : {}),
      };
      const baseRequest: Record<string, unknown> = {
        to: embeddedWalletAddress,
        data: tx.data,
        value: tx.value !== undefined && tx.value !== BigInt(0) ? tx.value : undefined,
        chainId: APP_CHAIN_ID,
        type: "eip7702",
        authorizationList: tx.authorizationList,
        ...(tx.gas ? { gas: tx.gas } : {}),
        ...(tx.nonce !== undefined ? { nonce: BigInt(tx.nonce) } : {}),
      };
      const signTransactionRequest: Record<string, unknown> = {
        ...baseRequest,
        type: 4,
      };

      if (gasOverrides && ("maxFeePerGas" in gasOverrides || "gasPrice" in gasOverrides)) {
        if (gasOverrides.maxFeePerGas) baseRequest.maxFeePerGas = gasOverrides.maxFeePerGas;
        if (gasOverrides.maxPriorityFeePerGas) baseRequest.maxPriorityFeePerGas = gasOverrides.maxPriorityFeePerGas;
        if (gasOverrides.gasPrice) baseRequest.gasPrice = gasOverrides.gasPrice;
        if (gasOverrides.maxFeePerGas) providerRequest.maxFeePerGas = toHex(gasOverrides.maxFeePerGas);
        if (gasOverrides.maxPriorityFeePerGas) providerRequest.maxPriorityFeePerGas = toHex(gasOverrides.maxPriorityFeePerGas);
        if (gasOverrides.gasPrice) providerRequest.gasPrice = toHex(gasOverrides.gasPrice);
      } else if (publicClient) {
        try {
          const fees = await publicClient.estimateFeesPerGas();
          const overrides =
            feeMode === "keeper"
              ? getKeeperFeeOverrides(fees, APP_CHAIN_ID)
              : getLineaFeeOverrides(fees, APP_CHAIN_ID);
          if (overrides?.maxFeePerGas) baseRequest.maxFeePerGas = overrides.maxFeePerGas;
          if (overrides?.maxPriorityFeePerGas) baseRequest.maxPriorityFeePerGas = overrides.maxPriorityFeePerGas;
          if (overrides?.gasPrice) baseRequest.gasPrice = overrides.gasPrice;
          if (overrides?.maxFeePerGas) providerRequest.maxFeePerGas = toHex(overrides.maxFeePerGas);
          if (overrides?.maxPriorityFeePerGas) providerRequest.maxPriorityFeePerGas = toHex(overrides.maxPriorityFeePerGas);
          if (overrides?.gasPrice) providerRequest.gasPrice = toHex(overrides.gasPrice);
        } catch {
          const overrides = getFallbackFeeOverrides(APP_CHAIN_ID, feeMode);
          if (overrides.maxFeePerGas) baseRequest.maxFeePerGas = overrides.maxFeePerGas;
          if (overrides.maxPriorityFeePerGas) baseRequest.maxPriorityFeePerGas = overrides.maxPriorityFeePerGas;
          if (overrides.gasPrice) baseRequest.gasPrice = overrides.gasPrice;
          if (overrides.maxFeePerGas) providerRequest.maxFeePerGas = toHex(overrides.maxFeePerGas);
          if (overrides.maxPriorityFeePerGas) providerRequest.maxPriorityFeePerGas = toHex(overrides.maxPriorityFeePerGas);
          if (overrides.gasPrice) providerRequest.gasPrice = toHex(overrides.gasPrice);
        }
      }

      try {
        const provider = (await embeddedWallet.getEthereumProvider()) as Eip1193Provider;
        await ensureProviderChain(provider, APP_CHAIN_ID);
        const signedType4 = await withTimeout(
          provider.request({
            method: "eth_signTransaction",
            params: [normalizeRpcTransactionRequest(providerRequest)],
          }) as Promise<string>,
          EIP7702_SEND_TIMEOUT_MS,
          "Privy embedded eth_signTransaction (EIP-7702)",
        );
        if (!signedType4 || typeof signedType4 !== "string" || !signedType4.startsWith("0x")) {
          throw new Error("Privy embedded eth_signTransaction returned an invalid payload.");
        }
        if (!publicClient) {
          throw new Error("Public client is unavailable for 7702 raw broadcast.");
        }
        const directHash = await withTimeout(
          publicClient.sendRawTransaction({
            serializedTransaction: signedType4 as `0x${string}`,
          }),
          EIP7702_SEND_TIMEOUT_MS,
          "Linea sendRawTransaction (EIP-7702)",
        );
        return directHash as `0x${string}`;
      } catch (error) {
        sendStepErrors.push(summarizeSendStep("embedded eth_signTransaction + sendRawTransaction", error));
        console.warn(
          "[PrivyWallet] embedded sign+broadcast 7702 path failed, retrying via provider sendTransaction:",
          formatUnknownError(error),
        );
      }

      try {
        const signed = await withTimeout(
          signTransaction(signTransactionRequest as Parameters<typeof signTransaction>[0], {
            uiOptions: { showWalletUIs: false },
            address: embeddedWalletAddress,
          }),
          EIP7702_SEND_TIMEOUT_MS,
          "Privy signTransaction (EIP-7702)",
        );
        const signedType4 = signed?.signature;
        if (!signedType4 || typeof signedType4 !== "string" || !signedType4.startsWith("0x")) {
          throw new Error("Privy signTransaction returned an invalid payload.");
        }
        if (!publicClient) {
          throw new Error("Public client is unavailable for 7702 raw broadcast.");
        }
        const hookHash = await withTimeout(
          publicClient.sendRawTransaction({
            serializedTransaction: signedType4 as `0x${string}`,
          }),
          EIP7702_SEND_TIMEOUT_MS,
          "Linea sendRawTransaction (EIP-7702 signed hook tx)",
        );
        return hookHash as `0x${string}`;
      } catch (error) {
        sendStepErrors.push(summarizeSendStep("Privy useSignTransaction + sendRawTransaction", error));
        console.warn(
          "[PrivyWallet] useSignTransaction 7702 path failed, retrying via provider sendTransaction:",
          formatUnknownError(error),
        );
      }

      try {
        const provider = (await embeddedWallet.getEthereumProvider()) as Eip1193Provider;
        await ensureProviderChain(provider, APP_CHAIN_ID);
        const directHash = await withTimeout(
          provider.request({
            method: "eth_sendTransaction",
            params: [normalizeRpcTransactionRequest(providerRequest)],
          }) as Promise<string>,
          EIP7702_SEND_TIMEOUT_MS,
          "Privy embedded eth_sendTransaction (EIP-7702)",
        );
        return directHash as `0x${string}`;
      } catch (error) {
        sendStepErrors.push(summarizeSendStep("embedded eth_sendTransaction", error));
        console.warn(
          "[PrivyWallet] embedded provider 7702 send failed, retrying via Privy sendTransaction:",
          formatUnknownError(error),
        );
      }

      let receipt: Awaited<ReturnType<typeof sendTransaction>>;
      try {
        receipt = await withTimeout(
          sendTransaction(baseRequest as Parameters<typeof sendTransaction>[0], {
            sponsor: tx.sponsor,
            uiOptions: { showWalletUIs: false },
          }),
          EIP7702_SEND_TIMEOUT_MS,
          "Privy sendTransaction (EIP-7702)",
        );
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes("Privy sendTransaction (EIP-7702) timed out") ||
            error.message.includes("Privy embedded eth_sendTransaction (EIP-7702) timed out") ||
            error.message.includes("Privy embedded eth_signTransaction (EIP-7702) timed out") ||
            error.message.includes("Linea sendRawTransaction (EIP-7702) timed out"))
        ) {
          error.name = "WalletSendTimeoutError";
          error.message = "Privy 7702 send timed out.";
        }
        sendStepErrors.push(summarizeSendStep("Privy sendTransaction", error));
        const finalError =
          error instanceof Error ? error : new Error(typeof error === "string" ? error : "7702 send failed");
        finalError.message = sendStepErrors.join(" || ");
        throw finalError;
      }

      return receipt.hash as `0x${string}`;
    },
    [embeddedWallet, embeddedWalletAddress, publicClient, sendTransaction, setActiveWallet, signTransaction],
  );

  const sendTransactionFromExternal = useCallback(
    async (tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint }) => {
      if (!externalWallet) throw new Error("External wallet not connected.");
      // External-wallet flow: trigger the wallet's own send tx prompt directly.
      // This is more reliable than routing through embedded sendTransaction flow.
      const provider = await externalWallet.getEthereumProvider();
      const targetChainIdHex = toHex(APP_CHAIN_ID) as `0x${string}`;
      try {
        await externalWallet.switchChain(APP_CHAIN_ID);
      } catch (switchErr) {
        console.warn("[PrivyWallet] switchChain failed, trying EIP-1193 fallback:", switchErr instanceof Error ? switchErr.message : String(switchErr));
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: targetChainIdHex }],
        }).catch((fbErr) => {
          console.warn("[PrivyWallet] EIP-1193 switchChain fallback also failed:", fbErr instanceof Error ? fbErr.message : String(fbErr));
        });
      }
      const currentChainId = (await provider.request({ method: "eth_chainId" }) as string | undefined)?.toLowerCase();
      if (!currentChainId || currentChainId !== targetChainIdHex.toLowerCase()) {
        throw new Error(`Switch your external wallet to ${APP_CHAIN_NAME} and try again.`);
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
  const { eip7702Diagnostic, runEip7702Diagnostic, runEip7702SendDiagnostic } =
    usePrivy7702Diagnostics({
      embeddedWallet,
      embeddedWalletAddress,
      publicClient,
      activateEmbeddedWallet: async () => {
        if (!embeddedWallet) {
          throw new Error("Embedded wallet is not ready");
        }
        return setActiveWallet(embeddedWallet);
      },
      sign7702Authorization,
      signEip7702Delegation,
      sendTransaction7702,
      formatUnknownError,
    });

  return {
    embeddedWalletAddress,
    externalWalletAddress,
    embeddedWalletSyncing,
    eip7702: getEip7702CapabilityState(Boolean(embeddedWalletAddress)),
    ensureEmbeddedWallet,
    exportEmbeddedWallet,
    createEmbeddedWallet,
    signEip7702Delegation,
    eip7702Diagnostic,
    runEip7702Diagnostic,
    runEip7702SendDiagnostic,
    sendTransactionSilent,
    sendTransaction7702,
    sendTransactionFromExternal,
  };
}
