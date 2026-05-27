import { encodeFunctionData, maxUint256 } from "viem";
import type { PublicClient } from "viem";
import { APP_CHAIN_ID, CONTRACT_ADDRESS, LINEA_TOKEN_ADDRESS, TOKEN_ABI } from "../constants";
import { log } from "../logger";
import { delay } from "../utils";
import type { GasOverrides, SilentSendFn } from "../../hooks/useMining.types";
import type { PendingApproveState, ReceiptState } from "../../hooks/useMining.stateTypes";
import { isNetworkError, isRetryableError, withMiningRpcTimeout } from "../../hooks/useMining.shared";
import { readWithNetworkRetry } from "./networkRetry";

const APPROVE_ALLOWANCE_POLL_MS = 1_000;
const APPROVE_ALLOWANCE_SYNC_TIMEOUT_MS = 8_000;
const APPROVE_PENDING_TIMEOUT_MS = 30_000;

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

  const readAllowance = async () =>
    (await withMiningRpcTimeout(publicClient.readContract({
      address: LINEA_TOKEN_ADDRESS,
      abi: TOKEN_ABI,
      functionName: "allowance",
      args: [actorAddress, CONTRACT_ADDRESS],
    }), "bootstrap.allowance.refresh")) as bigint;

  const pollAllowanceUntil = async (timeoutMs: number) => {
    const startedAt = Date.now();
    while (autoMineActive() && Date.now() - startedAt < timeoutMs) {
      try {
        if ((await readAllowance()) >= absoluteTotal) {
          clearPendingApprove();
          refetchAllowance();
          return true;
        }
      } catch (error) {
        if (!isNetworkError(error)) throw error;
      }
      await delay(APPROVE_ALLOWANCE_POLL_MS);
    }
    return false;
  };

  if (pendingApproveRef.current) {
    const allowanceUpdated = await pollAllowanceUntil(APPROVE_ALLOWANCE_SYNC_TIMEOUT_MS);
    if (allowanceUpdated) return true;
  }

  let approvalConfirmed = false;
  for (let attempt = 0; attempt < approveRetryMax; attempt += 1) {
    let approvalState: ReceiptState = "confirmed";
    let approvalNonce: number | null = null;
    let enteredApprovalSendPhase = false;
    try {
      approvalNonce = pendingApproveRef.current?.nonce ?? Number(
        await withMiningRpcTimeout(publicClient.getTransactionCount({
          address: actorAddress,
          blockTag: "latest",
        }), "bootstrap.getTransactionCount"),
      );
      const silentSend = readSilentSend();
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
        enteredApprovalSendPhase = true;
        const approveHash = await silentSend(
          { to: LINEA_TOKEN_ADDRESS, data, gas: minGasApprove, nonce: approvalNonce },
          approveOverrides,
        );
        pendingApproveRef.current = { hash: approveHash, submittedAt: Date.now(), nonce: approvalNonce };
        approvalState = await waitReceipt(approveHash, publicClient);
      } else {
        await ensurePreferredWallet();
        await assertNativeGasBalance(minGasApprove, approveOverrides);
        enteredApprovalSendPhase = true;
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
      if (enteredApprovalSendPhase && approvalNonce !== null && !pendingApproveRef.current) {
        pendingApproveRef.current = {
          submittedAt: Date.now(),
          nonce: approvalNonce,
        };
      }
      if (!isRetryableError(error) && !isNetworkError(error)) throw error;
      log.warn("AutoMine", `approve confirmation retry ${attempt + 1}/${approveRetryMax}`, error);
    }

    refetchAllowance();
    await delay(1_500);
    const allowanceUpdated = await pollAllowanceUntil(
      approvalState === "pending"
        ? APPROVE_PENDING_TIMEOUT_MS
        : APPROVE_ALLOWANCE_SYNC_TIMEOUT_MS,
    );
    if (allowanceUpdated) {
      approvalConfirmed = true;
      break;
    }

    if (attempt < approveRetryMax - 1) {
      await delay(Math.min(2_000 * (attempt + 1), 5_000));
    }
  }

  if (!approvalConfirmed) {
    if (pendingApproveRef.current) {
      const allowanceUpdated = await pollAllowanceUntil(APPROVE_PENDING_TIMEOUT_MS);
      if (allowanceUpdated) return true;
      const pendingAgeMs = Date.now() - pendingApproveRef.current.submittedAt;
      throw new Error(
        pendingAgeMs > APPROVE_PENDING_TIMEOUT_MS
          ? "Approval transaction is still pending or underpriced. Retry once more to replace it."
          : "Approval transaction is still pending. Wait for confirmation before auto-mine continues.",
      );
    }
    throw new Error("Approval not confirmed after retries");
  }

  return true;
}
