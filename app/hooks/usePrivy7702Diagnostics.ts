"use client";

import { useCallback, useState } from "react";
import { getAddress } from "viem";
import { APP_CHAIN_ID } from "../lib/constants";
import {
  EIP7702_DELEGATE_ADDRESS,
  buildEip7702ProbeRequest,
  type Signed7702AuthorizationLike,
} from "../lib/eip7702";

const ACTIVE_WALLET_TIMEOUT_MS = 12_000;

export interface Eip7702DiagnosticState {
  status: "idle" | "running" | "success" | "error";
  stage: "idle" | "preflight" | "sign" | "estimate" | "send" | "done";
  summary?: string;
  detail?: string;
  gasEstimate?: string;
  txHash?: `0x${string}`;
  updatedAt?: number;
}

const IDLE_EIP7702_DIAGNOSTIC: Eip7702DiagnosticState = {
  status: "idle",
  stage: "idle",
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const guarded = promise.catch((err) => {
    throw err;
  });
  return Promise.race([
    guarded,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

interface UsePrivy7702DiagnosticsOptions {
  embeddedWallet: { address: string } | null | undefined;
  embeddedWalletAddress: string | null;
  publicClient: {
    estimateGas: (args: {
      account: `0x${string}`;
      to: `0x${string}`;
      data: `0x${string}`;
      authorizationList: readonly Signed7702AuthorizationLike[];
    }) => Promise<bigint>;
  } | null | undefined;
  activateEmbeddedWallet: () => Promise<unknown>;
  sign7702Authorization: (
    params: { contractAddress: `0x${string}`; chainId: number; executor: "self" | `0x${string}` },
    options: { address: string },
  ) => Promise<Signed7702AuthorizationLike>;
  signEip7702Delegation: (executor?: "self" | `0x${string}`) => Promise<Signed7702AuthorizationLike>;
  sendTransaction7702: (tx: {
    authorizationList: readonly Signed7702AuthorizationLike[];
  }) => Promise<`0x${string}`>;
  formatUnknownError: (error: unknown) => string;
}

export function usePrivy7702Diagnostics({
  embeddedWallet,
  embeddedWalletAddress,
  publicClient,
  activateEmbeddedWallet,
  sign7702Authorization,
  signEip7702Delegation,
  sendTransaction7702,
  formatUnknownError,
}: UsePrivy7702DiagnosticsOptions) {
  const [eip7702Diagnostic, setEip7702Diagnostic] =
    useState<Eip7702DiagnosticState>(IDLE_EIP7702_DIAGNOSTIC);

  const runEip7702Diagnostic = useCallback(async () => {
    let currentStage: Eip7702DiagnosticState["stage"] = "preflight";
    const mark = (next: Partial<Eip7702DiagnosticState>) =>
      setEip7702Diagnostic((current) => ({
        ...current,
        ...next,
        updatedAt: Date.now(),
      }));

    if (!EIP7702_DELEGATE_ADDRESS) {
      setEip7702Diagnostic({
        status: "error",
        stage: "preflight",
        summary: "7702 delegate is not configured",
        detail: "Set NEXT_PUBLIC_EIP7702_DELEGATE_ADDRESS before testing.",
        updatedAt: Date.now(),
      });
      return;
    }
    if (!embeddedWallet || !embeddedWalletAddress) {
      setEip7702Diagnostic({
        status: "error",
        stage: "preflight",
        summary: "Embedded wallet is not ready",
        detail: "Create or reconnect the Privy embedded wallet first.",
        updatedAt: Date.now(),
      });
      return;
    }
    if (!publicClient) {
      setEip7702Diagnostic({
        status: "error",
        stage: "preflight",
        summary: "Public client is unavailable",
        detail: "Reload the page and try the 7702 test again.",
        updatedAt: Date.now(),
      });
      return;
    }

    try {
      mark({
        status: "running",
        stage: "sign",
        summary: "Testing 7702 delegation signature...",
        detail: `Delegate ${EIP7702_DELEGATE_ADDRESS}`,
        gasEstimate: undefined,
        txHash: undefined,
      });
      currentStage = "sign";
      await withTimeout(activateEmbeddedWallet(), ACTIVE_WALLET_TIMEOUT_MS, "Privy setActiveWallet");
      const authorization = await sign7702Authorization(
        {
          contractAddress: EIP7702_DELEGATE_ADDRESS,
          chainId: APP_CHAIN_ID,
          executor: "self",
        },
        { address: embeddedWalletAddress },
      );

      mark({
        stage: "estimate",
        summary: "Delegation signed. Estimating type-4 probe...",
        detail: "Calling currentEpoch() through a 7702 tx preflight.",
      });
      currentStage = "estimate";

      const probe = buildEip7702ProbeRequest();
      const embeddedAccount = getAddress(embeddedWalletAddress);
      const estimatedGas = await publicClient.estimateGas({
        account: embeddedAccount,
        to: probe.to,
        data: probe.data,
        authorizationList: [authorization],
      });

      setEip7702Diagnostic({
        status: "success",
        stage: "done",
        summary: "7702 sign + estimate passed",
        detail: "Privy signed the delegation and Linea accepted a type-4 gas estimate.",
        gasEstimate: estimatedGas.toString(),
        txHash: undefined,
        updatedAt: Date.now(),
      });
    } catch (error) {
      setEip7702Diagnostic({
        status: "error",
        stage: currentStage,
        summary: currentStage === "estimate" ? "7702 estimate failed" : "7702 sign failed",
        detail: formatUnknownError(error),
        txHash: undefined,
        updatedAt: Date.now(),
      });
    }
  }, [
    embeddedWallet,
    embeddedWalletAddress,
    formatUnknownError,
    publicClient,
    activateEmbeddedWallet,
    sign7702Authorization,
  ]);

  const runEip7702SendDiagnostic = useCallback(async () => {
    let currentStage: Eip7702DiagnosticState["stage"] = "preflight";
    const mark = (next: Partial<Eip7702DiagnosticState>) =>
      setEip7702Diagnostic((current) => ({
        ...current,
        ...next,
        updatedAt: Date.now(),
      }));

    if (!EIP7702_DELEGATE_ADDRESS) {
      setEip7702Diagnostic({
        status: "error",
        stage: "preflight",
        summary: "7702 delegate is not configured",
        detail: "Set NEXT_PUBLIC_EIP7702_DELEGATE_ADDRESS before testing.",
        txHash: undefined,
        updatedAt: Date.now(),
      });
      return;
    }
    if (!embeddedWalletAddress) {
      setEip7702Diagnostic({
        status: "error",
        stage: "preflight",
        summary: "Embedded wallet is not ready",
        detail: "Create or reconnect the Privy embedded wallet first.",
        txHash: undefined,
        updatedAt: Date.now(),
      });
      return;
    }

    try {
      mark({
        status: "running",
        stage: "sign",
        summary: "Preparing 7702 send test...",
        detail: `Delegate ${EIP7702_DELEGATE_ADDRESS}`,
        gasEstimate: undefined,
        txHash: undefined,
      });
      currentStage = "sign";
      const authorization = await signEip7702Delegation("self");

      mark({
        stage: "send",
        summary: "Delegation signed. Sending type-4 self tx...",
        detail: "This spends real gas, but does not place a bet.",
      });
      currentStage = "send";

      const hash = await sendTransaction7702({
        authorizationList: [authorization],
      });

      setEip7702Diagnostic({
        status: "success",
        stage: "done",
        summary: "7702 send passed",
        detail: "Privy signed and sent a real type-4 self transaction.",
        txHash: hash,
        updatedAt: Date.now(),
      });
    } catch (error) {
      setEip7702Diagnostic({
        status: "error",
        stage: currentStage,
        summary: currentStage === "send" ? "7702 send failed" : "7702 sign failed",
        detail: formatUnknownError(error),
        txHash: undefined,
        updatedAt: Date.now(),
      });
    }
  }, [embeddedWalletAddress, formatUnknownError, sendTransaction7702, signEip7702Delegation]);

  return {
    eip7702Diagnostic,
    runEip7702Diagnostic,
    runEip7702SendDiagnostic,
  };
}
