"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getEmbeddedConnectedWallet,
  usePrivy,
  useCreateWallet,
  useExportWallet,
  useSendTransaction,
  useWallets,
} from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";
import { useAccount, usePublicClient } from "wagmi";
import { toHex, getAddress } from "viem";
import { APP_CHAIN_ID, APP_CHAIN_NAME } from "../lib/constants";
import { getFallbackFeeOverrides, getKeeperFeeOverrides, getLineaFeeOverrides, type FeeOverrides } from "../lib/lineaFees";
import { log } from "../lib/logger";
import { withTimeout, isUserRejection } from "../lib/utils";

const SILENT_SEND_TIMEOUT_MS = 45_000;
const ACTIVE_WALLET_TIMEOUT_MS = 12_000;
const EXTERNAL_WALLET_NETWORK_TIMEOUT_MS = 15_000;

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?: (event: "accountsChanged", listener: (accounts: unknown) => void) => void;
  removeListener?: (event: "accountsChanged", listener: (accounts: unknown) => void) => void;
};

function getProviderSelectedAddress(accounts: unknown): `0x${string}` | null {
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string") return null;
  return normalizeWalletAddress(accounts[0]);
}

function normalizeWalletAddress(value: string | null | undefined): `0x${string}` | null {
  if (!value) return null;
  try {
    return getAddress(value);
  } catch {
    return null;
  }
}

/** Resolve fee overrides for embedded-wallet sends. */
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
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });
  const [providerExternalWalletAddress, setProviderExternalWalletAddress] = useState<`0x${string}` | null>(null);

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
    const embeddedAddress = normalizeWalletAddress(embeddedWallet.address);
    return wallets.find((wallet) => normalizeWalletAddress(wallet.address) !== embeddedAddress);
  }, [wallets, embeddedWallet]);

  useEffect(() => {
    let cancelled = false;
    let provider: Eip1193Provider | undefined;
    const updateAccount = (accounts: unknown) => {
      if (!cancelled) setProviderExternalWalletAddress(getProviderSelectedAddress(accounts));
    };

    if (!externalWallet) {
      setProviderExternalWalletAddress(null);
      return;
    }

    void externalWallet.getEthereumProvider().then((nextProvider) => {
      provider = nextProvider as Eip1193Provider;
      provider.on?.("accountsChanged", updateAccount);
      return provider.request({ method: "eth_accounts" });
    }).then(updateAccount).catch(() => {
      if (!cancelled) setProviderExternalWalletAddress(null);
    });

    return () => {
      cancelled = true;
      provider?.removeListener?.("accountsChanged", updateAccount);
    };
  }, [externalWallet]);

  const embeddedWalletAddress = normalizeWalletAddress(embeddedWallet?.address) ?? normalizeWalletAddress(linkedEmbeddedWalletAddress);
  const embeddedWalletReady = Boolean(embeddedWallet);
  const externalWalletAddress = providerExternalWalletAddress ?? normalizeWalletAddress(externalWallet?.address);
  const embeddedWalletSyncing =
    authenticated &&
    !embeddedWalletAddress &&
    (!privyReady || !walletsReady);

  // Always keep embedded wallet as active signer
  useEffect(() => {
    if (!embeddedWallet || !address) return;
    const activeAddress = normalizeWalletAddress(address);
    const embeddedAddress = normalizeWalletAddress(embeddedWallet.address);
    if (activeAddress && embeddedAddress && activeAddress !== embeddedAddress) {
      setActiveWallet(embeddedWallet).catch((err) => {
        log.warn("PrivyWallet", "setActiveWallet failed", err);
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
          : ((await resolveFeeOverrides(publicClient, feeMode, APP_CHAIN_ID)) ?? getFallbackFeeOverrides(APP_CHAIN_ID, feeMode));
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

  const sendTransactionFromExternal = useCallback(
    async (tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint }) => {
      if (!externalWallet) throw new Error("External wallet not connected.");
      // External-wallet flow: trigger the wallet's own send tx prompt directly.
      // This is more reliable than routing through embedded sendTransaction flow.
      const provider = await externalWallet.getEthereumProvider();
      const targetChainIdHex = toHex(APP_CHAIN_ID) as `0x${string}`;
      try {
        await withTimeout(
          externalWallet.switchChain(APP_CHAIN_ID),
          EXTERNAL_WALLET_NETWORK_TIMEOUT_MS,
          "External wallet switchChain",
        );
      } catch (switchErr) {
        if (isUserRejection(switchErr)) throw switchErr;
        if (switchErr instanceof Error && switchErr.name === "TimeoutError") {
          throw new Error(`Network switch timed out. Switch your external wallet to ${APP_CHAIN_NAME} and try again.`);
        }
        log.warn("PrivyWallet", "switchChain failed, trying EIP-1193 fallback", switchErr);
        await withTimeout(
          provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: targetChainIdHex }],
          }),
          EXTERNAL_WALLET_NETWORK_TIMEOUT_MS,
          "External wallet wallet_switchEthereumChain",
        );
      }
      const currentChainId = (await withTimeout(
        provider.request({ method: "eth_chainId" }),
        EXTERNAL_WALLET_NETWORK_TIMEOUT_MS,
        "External wallet eth_chainId",
      ) as string | undefined)?.toLowerCase();
      if (!currentChainId || currentChainId !== targetChainIdHex.toLowerCase()) {
        throw new Error(`Switch your external wallet to ${APP_CHAIN_NAME} and try again.`);
      }
      const providerAccount = getProviderSelectedAddress(await provider.request({ method: "eth_accounts" }));
      if (!providerAccount) throw new Error("Select an account in your external wallet and try again.");
      setProviderExternalWalletAddress(providerAccount);
      const requestTx: {
        from: `0x${string}`;
        to: `0x${string}`;
        data?: `0x${string}`;
        value?: `0x${string}`;
        gas?: `0x${string}`;
      } = {
        from: providerAccount,
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

  return useMemo(
    () => ({
      authenticated,
      embeddedWalletAddress,
      embeddedWalletReady,
      externalWalletAddress,
      embeddedWalletSyncing,
      ensureEmbeddedWallet,
      exportEmbeddedWallet,
      createEmbeddedWallet,
      sendTransactionSilent,
      sendTransactionFromExternal,
    }),
    [
      authenticated,
      embeddedWalletAddress,
      embeddedWalletReady,
      externalWalletAddress,
      embeddedWalletSyncing,
      ensureEmbeddedWallet,
      exportEmbeddedWallet,
      createEmbeddedWallet,
      sendTransactionSilent,
      sendTransactionFromExternal,
    ],
  );
}
