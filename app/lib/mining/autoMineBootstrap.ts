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

function computeBootstrapAllowancePollDeadline(now: number, timeoutMs: number): number | null {
  if (
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(timeoutMs) ||
    now < 0 ||
    timeoutMs <= 0 ||
    timeoutMs > Number.MAX_SAFE_INTEGER - now
  ) {
    return null;
  }
  return now + timeoutMs;
}

function normalizeBootstrapApprovalNonce(value: unknown): number | null {
  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(value);
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return null;
  }
  return value;
}

export function selectBootstrapApprovalSubmissionNonce(
  trackedNonce: unknown,
  freshPendingNonce: unknown,
): number | null {
  return normalizeBootstrapApprovalNonce(trackedNonce ?? freshPendingNonce);
}

function getPendingApproveAgeMs(pendingApprove: PendingApproveState, now: number): number | null {
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !Number.isSafeInteger(pendingApprove.submittedAt) ||
    pendingApprove.submittedAt < 0 ||
    pendingApprove.submittedAt > now + 5_000
  ) {
    return null;
  }
  return now - pendingApprove.submittedAt;
}

function assertPendingApproveReplacementReady(pendingApprove: PendingApproveState, waitMessage: string): void {
  const pendingAgeMs = getPendingApproveAgeMs(pendingApprove, Date.now());
  if (pendingAgeMs === null) {
    throw new Error("Approval pending state is unavailable or unsafe. Wait for wallet nonce recovery, then retry.");
  }
  if (pendingAgeMs <= APPROVE_PENDING_TIMEOUT_MS) {
    throw new Error(waitMessage);
  }
}

function formatLineaWeiOneDecimal(rawValue: bigint): string {
  const value = rawValue < 0n ? 0n : rawValue;
  const weiPerLinea = 10n ** 18n;
  const whole = value / weiPerLinea;
  const remainder = value % weiPerLinea;
  const roundedTenths = (remainder * 10n + weiPerLinea / 2n) / weiPerLinea;
  if (roundedTenths >= 10n) {
    return `${whole + 1n}.0`;
  }
  return `${whole}.${roundedTenths}`;
}

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
    const have = formatLineaWeiOneDecimal(initBalance);
    const need = formatLineaWeiOneDecimal(roundCost);
    await onCannotStart(`Cannot start: need ${need} LINEA per round, have ${have} LINEA`);
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
    const deadline = computeBootstrapAllowancePollDeadline(Date.now(), timeoutMs);
    if (deadline === null) return false;
    while (autoMineActive() && Date.now() < deadline) {
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
      if (pendingApproveRef.current) {
        assertPendingApproveReplacementReady(
          pendingApproveRef.current,
          "Approval transaction is still pending. Wait for confirmation before auto-mine continues.",
        );
      }
      const trackedApprovalNonce = pendingApproveRef.current?.nonce;
      const approvalNonceRaw = trackedApprovalNonce ?? await withMiningRpcTimeout(
        publicClient.getTransactionCount({
          address: actorAddress,
          blockTag: "pending",
        }),
        "bootstrap.getTransactionCount",
      );
      approvalNonce = selectBootstrapApprovalSubmissionNonce(trackedApprovalNonce, approvalNonceRaw);
      if (approvalNonce === null) {
        throw new Error("Approval nonce is unavailable or unsafe. Wait for wallet nonce recovery, then retry.");
      }
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
      const pendingAgeMs = getPendingApproveAgeMs(pendingApproveRef.current, Date.now());
      if (pendingAgeMs === null) {
        throw new Error("Approval pending state is unavailable or unsafe. Wait for wallet nonce recovery, then retry.");
      }
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
