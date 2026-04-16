"use client";

import { useCallback, useEffect, useMemo } from "react";
import {
  getEmbeddedConnectedWallet,
  usePrivy,
  useCreateWallet,
  useExportWallet,
  useSendTransaction,
  useSign7702Authorization,
  useWallets,
} from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";
import { useAccount, usePublicClient } from "wagmi";
import { toHex, createWalletClient, custom, serializeTransaction, keccak256, parseSignature } from "viem";
import { APP_CHAIN, APP_CHAIN_ID, APP_CHAIN_NAME } from "../lib/constants";
import {
  EIP7702_DELEGATE_ADDRESS,
  type Signed7702AuthorizationLike,
  getEip7702CapabilityState,
} from "../lib/eip7702";
import { getFallbackFeeOverrides, getKeeperFeeOverrides, getLineaFeeOverrides, type FeeOverrides } from "../lib/lineaFees";
import { withTimeout, formatUnknownError } from "../lib/utils";
import { usePrivy7702Diagnostics } from "./usePrivy7702Diagnostics";

const SILENT_SEND_TIMEOUT_MS = 45_000;
const EIP7702_SEND_TIMEOUT_MS = 12_000;
const ACTIVE_WALLET_TIMEOUT_MS = 12_000;

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
};

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

async function ensureProviderChain(provider: Eip1193Provider, chainId: number) {
  const targetChainIdHex = toHex(chainId) as `0x${string}`;
  const currentChainId = (await provider.request({ method: "eth_chainId" }) as string | undefined)?.toLowerCase();
  if (currentChainId === targetChainIdHex.toLowerCase()) return;
  await provider.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: targetChainIdHex }],
  });
}

/** Resolve fee overrides for silent/7702 sends. */
function resolveFeeOverrides(
  publicClient: { estimateFeesPerGas: () => Promise<{ maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasPrice?: bigint }> } | null | undefined,
  feeMode: "normal" | "keeper",
  chainId: number,
): Promise<FeeOverrides | undefined> {
  if (!publicClient) return Promise.resolve(undefined);
  return publicClient
    .estimateFeesPerGas()
    .then((fees) =>
      feeMode === "keeper"
        ? getKeeperFeeOverrides(fees, chainId)
        : getLineaFeeOverrides(fees, chainId),
    )
    .catch(() => getFallbackFeeOverrides(chainId, feeMode));
}

/** Apply fee overrides to a request object, converting bigints to hex for provider requests. */
function applyFeeOverrides(
  target: Record<string, unknown>,
  overrides: FeeOverrides | undefined,
  toHexValues: boolean,
) {
  if (!overrides) return;
  const convert = (v: bigint | undefined) => (v !== undefined ? (toHexValues ? toHex(v) : v) : undefined);
  if (overrides.maxFeePerGas !== undefined) target.maxFeePerGas = convert(overrides.maxFeePerGas);
  if (overrides.maxPriorityFeePerGas !== undefined) target.maxPriorityFeePerGas = convert(overrides.maxPriorityFeePerGas);
  if (overrides.gasPrice !== undefined) target.gasPrice = convert(overrides.gasPrice);
}

export function usePrivyWallet() {
  const { ready: privyReady, authenticated, user } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { setActiveWallet } = useSetActiveWallet();
  const { exportWallet } = useExportWallet();
  const { createWallet } = useCreateWallet();
  const { sendTransaction } = useSendTransaction();
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
      // Resolve fee overrides once, apply to the request.
      const effectiveFees: FeeOverrides | undefined =
        gasOverrides && ("maxFeePerGas" in gasOverrides || "gasPrice" in gasOverrides)
          ? (gasOverrides as FeeOverrides)
          : await resolveFeeOverrides(publicClient, feeMode, APP_CHAIN_ID);
      applyFeeOverrides(baseRequest, effectiveFees, false);
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

      // Resolve fee overrides once.
      const effectiveFees: FeeOverrides | undefined =
        gasOverrides && ("maxFeePerGas" in gasOverrides || "gasPrice" in gasOverrides)
          ? (gasOverrides as FeeOverrides)
          : await resolveFeeOverrides(publicClient, feeMode, APP_CHAIN_ID);

      // --- Path 1: Manual sign via secp256k1_sign + sendRawTransaction ---
      // Privy's eth_sendTransaction and eth_signTransaction handlers don't support
      // type-4 (EIP-7702) transactions server-side. eth_sign is also blocked (Code 4200).
      // However, Privy's provider whitelists the secp256k1_sign method, which does raw
      // ECDSA signing (no "\x19Ethereum Signed Message" prefix) via their backend.
      // We can: serialize the unsigned type-4 tx → hash it → sign via secp256k1_sign
      // → assemble the signed tx → broadcast via eth_sendRawTransaction.
      try {
        const provider = (await embeddedWallet.getEthereumProvider()) as Eip1193Provider;
        await ensureProviderChain(provider, APP_CHAIN_ID);

        // Resolve nonce if not provided.
        const nonce =
          tx.nonce ??
          Number(
            await provider.request({
              method: "eth_getTransactionCount",
              params: [embeddedWalletAddress, "pending"],
            }),
          );

        // Resolve gas if not provided.
        const gas =
          tx.gas ??
          (publicClient
            ? await (publicClient as unknown as { estimateGas: (a: Record<string, unknown>) => Promise<bigint> })
                .estimateGas({
                  account: embeddedWalletAddress,
                  to: embeddedWalletAddress,
                  data: tx.data,
                  authorizationList: tx.authorizationList,
                })
                .catch(() => 300_000n)
            : 300_000n);

        // Build the unsigned type-4 transaction object.
        const unsignedTx = {
          type: "eip7702" as const,
          chainId: APP_CHAIN_ID,
          nonce,
          to: embeddedWalletAddress as `0x${string}`,
          value: tx.value ?? 0n,
          data: tx.data ?? ("0x" as `0x${string}`),
          gas,
          maxFeePerGas: effectiveFees?.maxFeePerGas ?? 0n,
          maxPriorityFeePerGas: effectiveFees?.maxPriorityFeePerGas ?? 0n,
          accessList: [] as const,
          authorizationList: tx.authorizationList.map((a) => ({
            address: a.address as `0x${string}`,
            chainId: Number(a.chainId),
            nonce: Number(a.nonce),
            r: a.r as `0x${string}`,
            s: a.s as `0x${string}`,
            yParity: Number(a.yParity),
          })),
        };

        // Serialize unsigned tx → hash → sign via secp256k1_sign (raw ECDSA).
        // Privy's provider routes secp256k1_sign to the iframe which calls the backend
        // for raw ECDSA signing (no "\x19Ethereum Signed Message" prefix).
        // eth_sign is blocked (Code 4200), but secp256k1_sign is whitelisted.
        const serializedUnsigned = serializeTransaction(unsignedTx);
        const signingHash = keccak256(serializedUnsigned);

        let rawSignature: `0x${string}`;
        const signResult = await withTimeout(
          provider.request({
            method: "secp256k1_sign",
            params: [signingHash],
          }),
          EIP7702_SEND_TIMEOUT_MS,
          "Privy secp256k1_sign (EIP-7702 tx hash)",
        );
        // Handle both direct string and {data: string} response formats.
        if (typeof signResult === "string") {
          rawSignature = signResult as `0x${string}`;
        } else if (signResult && typeof signResult === "object" && "data" in signResult) {
          const inner = (signResult as { data: unknown }).data;
          rawSignature = (typeof inner === "string" ? inner : String(inner)) as `0x${string}`;
        } else {
          throw new Error(`Unexpected secp256k1_sign result: ${JSON.stringify(signResult)}`);
        }
        if (!rawSignature.startsWith("0x")) {
          rawSignature = `0x${rawSignature}` as `0x${string}`;
        }

        // Parse the 65-byte signature into { r, s, yParity }.
        const { r, s, yParity, v: sigV } = parseSignature(rawSignature);
        const effectiveYParity = yParity ?? (sigV !== undefined ? Number(sigV) % 2 : undefined);

        // Serialize the SIGNED transaction.
        const serializedSigned = sigV !== undefined
          ? serializeTransaction(unsignedTx, { r, s, v: sigV })
          : effectiveYParity !== undefined
            ? serializeTransaction(unsignedTx, { r, s, yParity: effectiveYParity })
            : (() => {
                throw new Error("Parsed secp256k1 signature is missing both v and yParity.");
              })();

        // Broadcast via eth_sendRawTransaction (works on both Privy provider and public RPC).
        const txHash = (await withTimeout(
          (publicClient
            ? (publicClient as unknown as { request: (a: { method: string; params: unknown[] }) => Promise<unknown> }).request({
                method: "eth_sendRawTransaction",
                params: [serializedSigned],
              })
            : provider.request({
                method: "eth_sendRawTransaction",
                params: [serializedSigned],
              })) as Promise<string>,
          EIP7702_SEND_TIMEOUT_MS,
          "eth_sendRawTransaction (EIP-7702)",
        )) as `0x${string}`;
        return txHash;
      } catch (error) {
        sendStepErrors.push(summarizeSendStep("secp256k1_sign + sendRawTransaction", error));
        console.warn(
          "[PrivyWallet] manual sign 7702 path failed, retrying via viem walletClient:",
          formatUnknownError(error),
        );
      }

      // --- Path 2: viem walletClient via Privy provider (fallback for future native support) ---
      try {
        const provider = await embeddedWallet.getEthereumProvider();
        await ensureProviderChain(provider as Eip1193Provider, APP_CHAIN_ID);

        const walletClient = createWalletClient({
          account: embeddedWalletAddress as `0x${string}`,
          chain: APP_CHAIN,
          transport: custom(provider),
        });

        const txRequest: Record<string, unknown> = {
          account: embeddedWalletAddress as `0x${string}`,
          to: embeddedWalletAddress as `0x${string}`,
          chain: APP_CHAIN,
          authorizationList: tx.authorizationList,
          ...(tx.data ? { data: tx.data } : {}),
          ...(tx.value !== undefined && tx.value !== BigInt(0) ? { value: tx.value } : {}),
          ...(tx.gas ? { gas: tx.gas } : {}),
          ...(tx.nonce !== undefined ? { nonce: tx.nonce } : {}),
        };
        applyFeeOverrides(txRequest, effectiveFees, false);

        const hash = await withTimeout(
          walletClient.sendTransaction(txRequest as Parameters<typeof walletClient.sendTransaction>[0]),
          EIP7702_SEND_TIMEOUT_MS,
          "viem walletClient sendTransaction (EIP-7702)",
        );
        return hash;
      } catch (error) {
        sendStepErrors.push(summarizeSendStep("viem walletClient sendTransaction", error));
        console.warn(
          "[PrivyWallet] viem walletClient 7702 path failed, retrying via provider eth_sendTransaction:",
          formatUnknownError(error),
        );
      }

      // --- Path 3: Direct provider eth_sendTransaction (raw JSON-RPC) ---
      try {
        const provider = (await embeddedWallet.getEthereumProvider()) as Eip1193Provider;
        await ensureProviderChain(provider, APP_CHAIN_ID);
        const providerRequest: Record<string, unknown> = {
          from: embeddedWalletAddress,
          to: embeddedWalletAddress,
          chainId: toHex(APP_CHAIN_ID),
          type: toHex(4),
          authorizationList: tx.authorizationList.map(normalizeAuthorizationForRpc),
          ...(tx.data ? { data: tx.data } : {}),
          ...(tx.value !== undefined && tx.value !== BigInt(0) ? { value: toHex(tx.value) } : {}),
          ...(tx.gas ? { gas: toHex(tx.gas) } : {}),
          ...(tx.nonce !== undefined ? { nonce: toHex(tx.nonce) } : {}),
        };
        applyFeeOverrides(providerRequest, effectiveFees, true);

        const directHash = await withTimeout(
          provider.request({
            method: "eth_sendTransaction",
            params: [providerRequest],
          }) as Promise<string>,
          EIP7702_SEND_TIMEOUT_MS,
          "Privy embedded eth_sendTransaction (EIP-7702)",
        );
        return directHash as `0x${string}`;
      } catch (error) {
        sendStepErrors.push(summarizeSendStep("embedded eth_sendTransaction", error));
        console.warn(
          "[PrivyWallet] embedded provider 7702 send failed, retrying via Privy sendTransaction hook:",
          formatUnknownError(error),
        );
      }

      // --- Path 4: Privy sendTransaction hook (last resort) ---
      let receipt: Awaited<ReturnType<typeof sendTransaction>>;
      try {
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
        applyFeeOverrides(baseRequest, effectiveFees, false);

        receipt = await withTimeout(
          sendTransaction(baseRequest as Parameters<typeof sendTransaction>[0], {
            sponsor: tx.sponsor,
            uiOptions: { showWalletUIs: false },
          }),
          EIP7702_SEND_TIMEOUT_MS,
          "Privy sendTransaction (EIP-7702)",
        );
      } catch (error) {
        if (error instanceof Error && error.message.includes("timed out")) {
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
    [embeddedWallet, embeddedWalletAddress, publicClient, sendTransaction, setActiveWallet],
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

  const eip7702 = useMemo(
    () => getEip7702CapabilityState(Boolean(embeddedWalletAddress)),
    [embeddedWalletAddress],
  );

  return useMemo(
    () => ({
      embeddedWalletAddress,
      externalWalletAddress,
      embeddedWalletSyncing,
      eip7702,
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
    }),
    [
      embeddedWalletAddress,
      externalWalletAddress,
      embeddedWalletSyncing,
      eip7702,
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
    ],
  );
}
