"use client";

import { encodeFunctionData, maxUint256 } from "viem";
import type { PublicClient } from "viem";
import { APP_CHAIN_ID } from "../lib/constants";
import { CONTRACT_ADDRESS, LINEA_TOKEN_ADDRESS, TOKEN_ABI } from "../lib/constants";
import { log } from "../lib/logger";
import { delay } from "../lib/utils";
import type { GasOverrides, SilentSendFn } from "./useMining.types";
import type { PendingApproveState, ReceiptState } from "./useMining.stateTypes";
import { isNetworkError, isRetryableError, withMiningRpcTimeout } from "./useMining.shared";

type ReadWithNetworkRetryFn = <T>(options: {
  actionLabel: string;
  initialMs: number;
  isActive: () => boolean;
  maxAttempts: number;
  maxMs: number;
  onProgress: (message: string) => void;
  read: () => Promise<T>;
  shouldRetry: (error: unknown) => boolean;
}) => Promise<T>;

interface PrepareAutoMineBootstrapOptions {
  absoluteTotal: bigint;
  actorAddress: `0x${string}`;
  approveRetryMax: number;
  assertNativeGasBalance: (gas: bigint, gasOverrides?: GasOverrides) => Promise<void>;
  autoMineActive: () => boolean;
  clearPendingApprove: () => void;
  ensurePreferredWallet: () => Promise<void> | void;
  getUrgentFees: () => Promise<GasOverrides | undefined>;
  maxNetworkAttempts: number;
  maxNetworkMs: number;
  minGasApprove: bigint;
  networkInitialMs: number;
  onCannotStart: (message: string) => Promise<void> | void;
  onProgress: (message: string) => void;
  pendingApproveRef: { current: PendingApproveState | null };
  publicClient: PublicClient;
  readSilentSend: () => SilentSendFn | undefined;
  readWithNetworkRetry: ReadWithNetworkRetryFn;
  refetchAllowance: () => void;
  roundCost: bigint;
  waitReceipt: (hash: `0x${string}`, client?: PublicClient) => Promise<ReceiptState>;
  writeApprove: (args: unknown) => Promise<`0x${string}`>;
}

export async function prepareAutoMineBootstrap({
  absoluteTotal,
  actorAddress,
  approveRetryMax,
  assertNativeGasBalance,
  autoMineActive,
  clearPendingApprove,
  ensurePreferredWallet,
  getUrgentFees,
  maxNetworkAttempts,
  maxNetworkMs,
  minGasApprove,
  networkInitialMs,
  onCannotStart,
  onProgress,
  pendingApproveRef,
  publicClient,
  readSilentSend,
  readWithNetworkRetry,
  refetchAllowance,
  roundCost,
  waitReceipt,
  writeApprove,
}: PrepareAutoMineBootstrapOptions) {
  const initBalance = await readWithNetworkRetry({
    actionLabel: "reading initial balance",
    initialMs: networkInitialMs,
    isActive: autoMineActive,
    maxAttempts: maxNetworkAttempts,
    maxMs: maxNetworkMs,
    onProgress,
    read: async () =>
      (await withMiningRpcTimeout(publicClient.readContract({
        address: LINEA_TOKEN_ADDRESS,
        abi: TOKEN_ABI,
        functionName: "balanceOf",
        args: [actorAddress],
      }), "bootstrap.balanceOf")) as bigint,
    shouldRetry: isNetworkError,
  });

  if (initBalance < roundCost) {
    const have = Number(initBalance) / 1e18;
    const need = Number(roundCost) / 1e18;
    await onCannotStart(`Cannot start: need ${need.toFixed(1)} LINEA per round, have ${have.toFixed(1)} LINEA`);
    return false;
  }

  const liveAllowance = await readWithNetworkRetry({
    actionLabel: "reading allowance",
    initialMs: networkInitialMs,
    isActive: autoMineActive,
    maxAttempts: maxNetworkAttempts,
    maxMs: maxNetworkMs,
    onProgress,
    read: async () =>
      (await withMiningRpcTimeout(publicClient.readContract({
        address: LINEA_TOKEN_ADDRESS,
        abi: TOKEN_ABI,
        functionName: "allowance",
        args: [actorAddress, CONTRACT_ADDRESS],
      }), "bootstrap.allowance")) as bigint,
    shouldRetry: isNetworkError,
  });

  if (liveAllowance >= absoluteTotal) {
    clearPendingApprove();
    return true;
  }

  let approvalConfirmed = false;
  for (let attempt = 0; attempt < approveRetryMax; attempt += 1) {
    try {
      const approvalNonce = pendingApproveRef.current?.nonce ?? Number(
        await withMiningRpcTimeout(publicClient.getTransactionCount({
          address: actorAddress,
          blockTag: "latest",
        }), "bootstrap.getTransactionCount"),
      );
      const silentSend = readSilentSend();
      let approvalState: ReceiptState = "confirmed";
      const approveOverrides = await getUrgentFees();
      const writeApproveOverrides =
        approveOverrides && "maxFeePerGas" in approveOverrides
          ? {
              maxFeePerGas: approveOverrides.maxFeePerGas,
              maxPriorityFeePerGas: approveOverrides.maxPriorityFeePerGas,
            }
          : {};

      if (silentSend) {
        const data = encodeFunctionData({
          abi: TOKEN_ABI,
          functionName: "approve",
          args: [CONTRACT_ADDRESS, maxUint256],
        });
        await assertNativeGasBalance(minGasApprove, approveOverrides);
        const approveHash = await silentSend(
          { to: LINEA_TOKEN_ADDRESS, data, gas: minGasApprove, nonce: approvalNonce },
          approveOverrides,
        );
        pendingApproveRef.current = { hash: approveHash, submittedAt: Date.now(), nonce: approvalNonce };
        approvalState = await waitReceipt(approveHash, publicClient);
      } else {
        await ensurePreferredWallet();
        await assertNativeGasBalance(minGasApprove, approveOverrides);
        const approveHash = await writeApprove({
          address: LINEA_TOKEN_ADDRESS,
          abi: TOKEN_ABI,
          functionName: "approve",
          args: [CONTRACT_ADDRESS, maxUint256],
          chainId: APP_CHAIN_ID,
          nonce: approvalNonce,
          ...writeApproveOverrides,
        });
        pendingApproveRef.current = { hash: approveHash, submittedAt: Date.now(), nonce: approvalNonce };
        approvalState = await waitReceipt(approveHash, publicClient);
      }

      if (approvalState === "pending") {
        log.warn("AutoMine", "approve tx pending; waiting before another approve");
        await delay(4_000);
      }
    } catch (error) {
      if (!isRetryableError(error) && !isNetworkError(error)) throw error;
      log.warn("AutoMine", `approve confirmation retry ${attempt + 1}/${approveRetryMax}`, error);
    }

    refetchAllowance();
    await delay(1_500);
    try {
      const refreshedAllowance = (await withMiningRpcTimeout(publicClient.readContract({
        address: LINEA_TOKEN_ADDRESS,
        abi: TOKEN_ABI,
        functionName: "allowance",
        args: [actorAddress, CONTRACT_ADDRESS],
      }), "bootstrap.allowance.refresh")) as bigint;
      if (refreshedAllowance >= absoluteTotal) {
        clearPendingApprove();
        approvalConfirmed = true;
        break;
      }
    } catch (error) {
      if (!isNetworkError(error)) throw error;
    }

    if (attempt < approveRetryMax - 1) {
      await delay(Math.min(2_000 * (attempt + 1), 5_000));
    }
  }

  if (!approvalConfirmed) {
    throw new Error("Approval not confirmed after retries");
  }

  return true;
}
