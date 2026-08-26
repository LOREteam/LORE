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
import { createPublicClient, http, toHex, getAddress } from "viem";
import { getStableLineaReadRpcs } from "../../config/publicConfig";
import { APP_CHAIN, APP_CHAIN_ID, APP_CHAIN_NAME, APP_NETWORK } from "../lib/constants";
import {
  assertKeeperFeeBudget,
  assertNormalFeeBudget,
  getFallbackFeeOverrides,
  getKeeperFeeOverrides,
  getLineaFeeOverrides,
  hasCompleteFeeOverrides,
  mergeFeeOverrides,
  type FeeOverrides,
} from "../lib/lineaFees";
import { log } from "../lib/logger";
import { withTimeout, isUserRejection } from "../lib/utils";
import {
  assertWalletTransferIntentMatchesTransaction,
  createWalletContractIntent,
  createWalletTransferIntent,
  selectWalletTransferAgreementRpcUrls,
  withWalletTransferIntentLease,
  WalletTransferIntentError,
  type WalletContractIntentDetails,
  type WalletTransferIntentDetails,
  type WalletTransferIntentLease,
  type WalletTransferNonceClients,
} from "../lib/walletTransferIntent";
import {
  assertExternalWalletProviderContext,
  isSafeExternalWalletProviderContextError,
  type ExternalWalletEip1193Provider,
} from "../lib/externalWalletProviderContext";

const SILENT_SEND_TIMEOUT_MS = 45_000;
const ACTIVE_WALLET_TIMEOUT_MS = 12_000;
const EXTERNAL_WALLET_NETWORK_TIMEOUT_MS = 15_000;
const NORMAL_VALUE_TRANSFER_GAS_LIMIT = 21_000n;

function createWalletTransferNonceClients(): WalletTransferNonceClients | null {
  const configuredRpcs = APP_NETWORK === "mainnet"
    ? process.env.NEXT_PUBLIC_LINEA_RPCS
    : process.env.NEXT_PUBLIC_LINEA_SEPOLIA_RPCS;
  try {
    const urls = selectWalletTransferAgreementRpcUrls(
      getStableLineaReadRpcs(configuredRpcs, APP_NETWORK),
    );
    return [
      createPublicClient({ chain: APP_CHAIN, transport: http(urls[0]) }),
      createPublicClient({ chain: APP_CHAIN, transport: http(urls[1]) }),
    ];
  } catch {
    return null;
  }
}

const WALLET_TRANSFER_NONCE_CLIENTS = createWalletTransferNonceClients();

type TransferAwareTransaction = {
  to: `0x${string}`;
  data?: `0x${string}`;
  value?: bigint;
  gas?: bigint;
  expectedActor?: `0x${string}`;
  transferIntent?: WalletTransferIntentDetails;
  contractIntent?: WalletContractIntentDetails;
};

type Eip1193Provider = ExternalWalletEip1193Provider & {
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
      tx: TransferAwareTransaction & {
        nonce?: number;
        feeMode?: "normal" | "keeper";
      },
      gasOverrides?: FeeOverrides,
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
      const effectiveGas = tx.gas ?? (
        feeMode === "normal" && tx.data === undefined ? NORMAL_VALUE_TRANSFER_GAS_LIMIT : undefined
      );
      const baseRequest: Parameters<typeof sendTransaction>[0] = {
        to: tx.to,
        data: tx.data,
        value: tx.value !== undefined && tx.value !== BigInt(0) ? tx.value : undefined,
        chainId: APP_CHAIN_ID,
        ...(effectiveGas !== undefined ? { gas: effectiveGas } : {}),
        ...(tx.nonce !== undefined ? { nonce: BigInt(tx.nonce) } : {}),
      };
      // Resolve fee overrides once, apply to the request.
      const resolvedFees = hasCompleteFeeOverrides(gasOverrides)
        ? undefined
        : ((await resolveFeeOverrides(publicClient, feeMode, APP_CHAIN_ID)) ?? getFallbackFeeOverrides(APP_CHAIN_ID, feeMode));
      const effectiveFees = mergeFeeOverrides(resolvedFees, gasOverrides);
      if (feeMode === "normal") {
        assertNormalFeeBudget(effectiveFees, effectiveGas, APP_CHAIN_ID);
      } else {
        assertKeeperFeeBudget(effectiveFees, effectiveGas ?? 0n, APP_CHAIN_ID, "keeper");
      }
      applyFeeOverrides(baseRequest, effectiveFees, false);
      const transferDetails = tx.transferIntent ?? (
        feeMode === "normal" &&
        tx.data === undefined &&
        tx.value !== undefined &&
        tx.value > 0n &&
        tx.nonce === undefined
          ? { asset: "native" as const, destination: tx.to, amountWei: tx.value }
          : null
      );
      const transferIntent = transferDetails
        ? createWalletTransferIntent({
            actor: embeddedWalletAddress,
            chainId: APP_CHAIN_ID,
            ...transferDetails,
          })
        : null;
      const contractIntent = tx.contractIntent
        ? createWalletContractIntent({
            actor: embeddedWalletAddress,
            chainId: APP_CHAIN_ID,
            ...tx.contractIntent,
          })
        : null;
      if (transferIntent && contractIntent) {
        throw new WalletTransferIntentError("wallet_transaction_intent_ambiguous");
      }
      const transactionIntent = transferIntent ?? contractIntent;
      if (transactionIntent) {
        if (feeMode !== "normal" || tx.nonce !== undefined) {
          throw new WalletTransferIntentError("wallet_transfer_intent_unsafe_mode");
        }
        assertWalletTransferIntentMatchesTransaction(transactionIntent, tx);
      }
      if (transactionIntent && !WALLET_TRANSFER_NONCE_CLIENTS) {
        throw new WalletTransferIntentError("wallet_transfer_intent_nonce_reconciliation_unavailable");
      }
      type SendReceipt = Awaited<ReturnType<typeof sendTransaction>>;
      const submitSilentTransaction = async (
        lease?: WalletTransferIntentLease,
        retainResult?: (promise: Promise<SendReceipt>, lease: WalletTransferIntentLease) => Promise<SendReceipt>,
      ) => {
        if (lease) baseRequest.nonce = BigInt(lease.nonce);
        const sendPromise = sendTransaction(baseRequest, {
          address: embeddedWalletAddress,
          uiOptions: { showWalletUIs: false },
        });
        const retainedSendPromise = lease && retainResult
          ? retainResult(sendPromise, lease)
          : sendPromise;
        let receipt: SendReceipt;
        try {
          receipt = await withTimeout(
            retainedSendPromise,
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
      };

      if (transactionIntent && WALLET_TRANSFER_NONCE_CLIENTS) {
        return withWalletTransferIntentLease(
          transactionIntent,
          WALLET_TRANSFER_NONCE_CLIENTS,
          async (acquisition, retainResult) => {
            if (acquisition.status === "known-hash") return acquisition.hash;
            return submitSilentTransaction(acquisition.lease, retainResult);
          },
          { abandonOnError: isUserRejection },
        );
      }
      return submitSilentTransaction();
    },
    [sendTransaction, embeddedWallet, embeddedWalletAddress, publicClient, setActiveWallet],
  );

  const sendTransactionFromExternal = useCallback(
    async (tx: TransferAwareTransaction) => {
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
      const providerAccount = await assertExternalWalletProviderContext({
        provider,
        expectedChainId: APP_CHAIN_ID,
        timeoutMs: EXTERNAL_WALLET_NETWORK_TIMEOUT_MS,
      });
      setProviderExternalWalletAddress(providerAccount);
      if (
        tx.expectedActor &&
        getAddress(tx.expectedActor).toLowerCase() !== providerAccount.toLowerCase()
      ) {
        throw new WalletTransferIntentError("wallet_transfer_intent_actor_changed");
      }
      const requestTx: {
        from: `0x${string}`;
        to: `0x${string}`;
        data?: `0x${string}`;
        value?: `0x${string}`;
        gas?: `0x${string}`;
        nonce?: `0x${string}`;
      } = {
        from: providerAccount,
        to: tx.to,
      };
      if (tx.data) requestTx.data = tx.data;
      if (tx.value !== undefined && tx.value !== BigInt(0)) requestTx.value = toHex(tx.value) as `0x${string}`;
      if (tx.gas) requestTx.gas = toHex(tx.gas) as `0x${string}`;

      const transferDetails = tx.transferIntent ?? (
        tx.data === undefined && tx.value !== undefined && tx.value > 0n
          ? { asset: "native" as const, destination: tx.to, amountWei: tx.value }
          : null
      );
      const transferIntent = transferDetails
        ? createWalletTransferIntent({
            actor: providerAccount,
            chainId: APP_CHAIN_ID,
            ...transferDetails,
          })
        : null;
      const contractIntent = tx.contractIntent
        ? createWalletContractIntent({
            actor: providerAccount,
            chainId: APP_CHAIN_ID,
            ...tx.contractIntent,
          })
        : null;
      if (transferIntent && contractIntent) {
        throw new WalletTransferIntentError("wallet_transaction_intent_ambiguous");
      }
      const transactionIntent = transferIntent ?? contractIntent;
      if (transactionIntent) {
        assertWalletTransferIntentMatchesTransaction(transactionIntent, tx);
        if (!WALLET_TRANSFER_NONCE_CLIENTS) {
          throw new WalletTransferIntentError("wallet_transfer_intent_nonce_reconciliation_unavailable");
        }
      }

      const submitExternalTransaction = async (
        lease?: WalletTransferIntentLease,
        retainResult?: (
          promise: Promise<{ hash: unknown }>,
          lease: WalletTransferIntentLease,
        ) => Promise<{ hash: unknown }>,
      ) => {
        if (lease) requestTx.nonce = toHex(lease.nonce) as `0x${string}`;
        await assertExternalWalletProviderContext({
          provider,
          expectedActor: providerAccount,
          expectedChainId: APP_CHAIN_ID,
          timeoutMs: EXTERNAL_WALLET_NETWORK_TIMEOUT_MS,
        });
        const sendPromise = (provider.request({
          method: "eth_sendTransaction",
          params: [requestTx],
        }) as Promise<unknown>).then((hash) => ({ hash }));
        const retainedSendPromise = lease && retainResult
          ? retainResult(sendPromise, lease)
          : sendPromise;
        const result = await withTimeout(
          retainedSendPromise,
          SILENT_SEND_TIMEOUT_MS,
          "External wallet eth_sendTransaction",
        );
        if (typeof result.hash !== "string") {
          throw new WalletTransferIntentError("wallet_transfer_intent_invalid_hash");
        }
        return result.hash as `0x${string}`;
      };

      if (transactionIntent && WALLET_TRANSFER_NONCE_CLIENTS) {
        return withWalletTransferIntentLease(
          transactionIntent,
          WALLET_TRANSFER_NONCE_CLIENTS,
          async (acquisition, retainResult) => {
            if (acquisition.status === "known-hash") return acquisition.hash;
            return submitExternalTransaction(acquisition.lease, retainResult);
          },
          { abandonOnError: (error) => isUserRejection(error) || isSafeExternalWalletProviderContextError(error) },
        );
      }
      return submitExternalTransaction();
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
