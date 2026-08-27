import { encodeFunctionData, maxUint256 } from "viem";
import type { PublicClient } from "viem";
import { APP_CHAIN_ID, CONTRACT_ADDRESS, LINEA_TOKEN_ADDRESS, TOKEN_ABI } from "../constants";
import { log } from "../logger";
import {
  clearVerifiedPendingMiningApprovalState,
  createPendingMiningAgreementClients,
  executeReservedMiningApprovalWalletSink,
  readAgreedPendingMiningAllowance,
  readAgreedPendingMiningApprovalNonce,
  readPendingMiningApprovalState,
  recoverPendingMiningApproval,
  settleRecoveredMiningApprovalAllowance,
  withPendingMiningApprovalLock,
  writePendingMiningApprovalState,
} from "../miningTxPath";
import { delay, isUserRejection } from "../utils";
import { bindMiningSilentSendActor, type GasOverrides, type SilentSendFn } from "../../hooks/useMining.types";
import type { PendingApproveState, ReceiptState } from "../../hooks/useMining.stateTypes";
import { isNetworkError, isRetryableError, withMiningRpcTimeout } from "../../hooks/useMining.shared";
import { readWithNetworkRetry } from "./networkRetry";

const APPROVE_ALLOWANCE_POLL_MS = 1_000;
const APPROVE_ALLOWANCE_SYNC_TIMEOUT_MS = 8_000;

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
  if (trackedNonce !== undefined && trackedNonce !== null) return null;
  return normalizeBootstrapApprovalNonce(freshPendingNonce);
}

export function buildAutoMineApprovalWriteRequest(
  actor: `0x${string}`,
  nonce: number,
  gasOverrides?: GasOverrides,
) {
  return {
    ...(gasOverrides ?? {}),
    address: LINEA_TOKEN_ADDRESS,
    abi: TOKEN_ABI,
    functionName: "approve" as const,
    args: [CONTRACT_ADDRESS, maxUint256] as const,
    chainId: APP_CHAIN_ID,
    nonce,
    account: actor,
  };
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

  const approvalAgreementClients = createPendingMiningAgreementClients();

  return withPendingMiningApprovalLock({
    chainId: APP_CHAIN_ID,
    token: LINEA_TOKEN_ADDRESS,
    spender: CONTRACT_ADDRESS,
    actor: actorAddress,
  }, async () => {
  const readAllowance = async () => {
    if (!approvalAgreementClients) {
      throw new Error("Two independent RPC origins are required for approval allowance verification.");
    }
    return readAgreedPendingMiningAllowance(
      approvalAgreementClients,
      LINEA_TOKEN_ADDRESS,
      CONTRACT_ADDRESS,
      actorAddress,
    );
  };

  const pollAllowanceUntil = async (minimumAmount: bigint, timeoutMs: number) => {
    const deadline = computeBootstrapAllowancePollDeadline(Date.now(), timeoutMs);
    if (deadline === null) return false;
    while (autoMineActive() && Date.now() < deadline) {
      try {
        if ((await readAllowance()) >= minimumAmount) {
          clearApprovalState();
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

  const clearApprovalState = () => {
    const current = readPendingMiningApprovalState(
      APP_CHAIN_ID,
      LINEA_TOKEN_ADDRESS,
      CONTRACT_ADDRESS,
      actorAddress,
    );
    if (current && !clearVerifiedPendingMiningApprovalState(current)) {
      throw new Error("Approval safety state could not be cleared. Restore browser storage before retrying.");
    }
    clearPendingApprove();
  };

  let pendingApprovalState = readPendingMiningApprovalState(
    APP_CHAIN_ID,
    LINEA_TOKEN_ADDRESS,
    CONTRACT_ADDRESS,
    actorAddress,
  );
  if (pendingApprovalState) {
    pendingApproveRef.current = {
      ...(pendingApprovalState.hash ? { hash: pendingApprovalState.hash } : {}),
      submittedAt: pendingApprovalState.ts,
      nonce: pendingApprovalState.nonce,
    };
  } else if (pendingApproveRef.current) {
    throw new Error(
      "Legacy Auto-Miner approval state is not bound to an exact amount; manual reconciliation is required.",
    );
  }

  if (await readAllowance() >= absoluteTotal) {
    clearApprovalState();
    refetchAllowance();
    return true;
  }

  if (pendingApprovalState) {
    if (!approvalAgreementClients) {
      throw new Error("Two independent RPC origins are required to reconcile the pending approval.");
    }
    const recovery = await recoverPendingMiningApproval(approvalAgreementClients, pendingApprovalState);
    if (recovery === "confirmed") {
      const outcome = await settleRecoveredMiningApprovalAllowance({
        pendingState: pendingApprovalState,
        requiredAmount: absoluteTotal,
        pollAgreedAllowanceUntil: (minimumAmount) =>
          pollAllowanceUntil(minimumAmount, APPROVE_ALLOWANCE_SYNC_TIMEOUT_MS),
        clearApprovalState,
        readAgreedAllowance: readAllowance,
      });
      refetchAllowance();
      if (outcome === "satisfied") return true;
      pendingApprovalState = null;
    }
    if (recovery === "reverted") {
      clearApprovalState();
      pendingApprovalState = null;
    } else if (recovery === "pending") {
      throw new Error("Approval transaction is still pending. Wait for finalized two-RPC confirmation.");
    } else {
      throw new Error("Pending approval identity cannot be proven; manual reconciliation is required.");
    }
  }

  if (!approvalAgreementClients) {
    throw new Error("Two independent RPC origins are required before approval submission.");
  }

  for (let attempt = 0; attempt < approveRetryMax; attempt += 1) {
    let approvalNonce: number | null = null;
    let approveHash: `0x${string}` | null = null;
    try {
      const approvalNonceRaw = await readAgreedPendingMiningApprovalNonce(
        approvalAgreementClients,
        actorAddress,
      );
      approvalNonce = selectBootstrapApprovalSubmissionNonce(undefined, approvalNonceRaw);
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
        const approvalReservation = writePendingMiningApprovalState({
          chainId: APP_CHAIN_ID,
          token: LINEA_TOKEN_ADDRESS,
          spender: CONTRACT_ADDRESS,
          actor: actorAddress,
          nonce: approvalNonce,
          amountRaw: maxUint256.toString(),
        });
        if (!approvalReservation) {
          throw new Error("Approval intent could not be persisted and verified; Auto-Miner approval is blocked.");
        }
        pendingApproveRef.current = { submittedAt: approvalReservation.ts, nonce: approvalNonce };
        approveHash = await executeReservedMiningApprovalWalletSink(
          approvalReservation,
          () => undefined,
          () => silentSend(
            bindMiningSilentSendActor(
              { to: LINEA_TOKEN_ADDRESS, data, gas: minGasApprove, nonce: approvalNonce! },
              approvalReservation.actor,
            ),
            approveOverrides,
          ),
        );
        const submitted = writePendingMiningApprovalState({ ...approvalReservation, hash: approveHash });
        if (!submitted) {
          throw new Error("Submitted approval could not be persisted; manual reconciliation is required.");
        }
        pendingApproveRef.current = { hash: approveHash, submittedAt: submitted.ts, nonce: approvalNonce };
        await waitReceipt(approveHash, publicClient);
      } else {
        await ensurePreferredWallet();
        await assertNativeGasBalance(minGasApprove, approveOverrides);
        const approvalReservation = writePendingMiningApprovalState({
          chainId: APP_CHAIN_ID,
          token: LINEA_TOKEN_ADDRESS,
          spender: CONTRACT_ADDRESS,
          actor: actorAddress,
          nonce: approvalNonce,
          amountRaw: maxUint256.toString(),
        });
        if (!approvalReservation) {
          throw new Error("Approval intent could not be persisted and verified; Auto-Miner approval is blocked.");
        }
        pendingApproveRef.current = { submittedAt: approvalReservation.ts, nonce: approvalNonce };
        approveHash = await executeReservedMiningApprovalWalletSink(
          approvalReservation,
          () => undefined,
          () => writeApprove(buildAutoMineApprovalWriteRequest(
            approvalReservation.actor,
            approvalNonce!,
            writeApproveOverrides,
          )),
        );
        const submitted = writePendingMiningApprovalState({ ...approvalReservation, hash: approveHash });
        if (!submitted) {
          throw new Error("Submitted approval could not be persisted; manual reconciliation is required.");
        }
        pendingApproveRef.current = { hash: approveHash, submittedAt: submitted.ts, nonce: approvalNonce };
        await waitReceipt(approveHash, publicClient);
      }

      if (!approveHash) {
        throw new Error("Submitted approval hash is unavailable; manual reconciliation is required.");
      }
      const submittedState = readPendingMiningApprovalState(
        APP_CHAIN_ID,
        LINEA_TOKEN_ADDRESS,
        CONTRACT_ADDRESS,
        actorAddress,
      );
      if (!submittedState?.hash || submittedState.hash !== approveHash) {
        throw new Error("Submitted approval state is unavailable; manual reconciliation is required.");
      }
      const recovery = await recoverPendingMiningApproval(approvalAgreementClients, submittedState);
      if (recovery === "confirmed") {
        const allowanceUpdated = await pollAllowanceUntil(absoluteTotal, APPROVE_ALLOWANCE_SYNC_TIMEOUT_MS);
        if (!allowanceUpdated) {
          throw new Error("Finalized approval is not reflected in live allowance; manual reconciliation is required.");
        }
        return true;
      }
      if (recovery === "reverted") {
        clearApprovalState();
        if (attempt < approveRetryMax - 1) continue;
        throw new Error("Approval transaction reverted after finality.");
      }
      if (recovery === "pending") {
        throw new Error("Approval transaction is still pending. Wait for finalized two-RPC confirmation.");
      }
      throw new Error("Submitted approval identity cannot be proven; manual reconciliation is required.");
    } catch (error) {
      const pendingAfterError = readPendingMiningApprovalState(
        APP_CHAIN_ID,
        LINEA_TOKEN_ADDRESS,
        CONTRACT_ADDRESS,
        actorAddress,
      );
      if (pendingAfterError) {
        throw error;
      }
      clearApprovalState();
      if (isUserRejection(error)) {
        throw error;
      }
      if (!isRetryableError(error) && !isNetworkError(error)) {
        throw error;
      }
      log.warn("AutoMine", `pre-submit approval retry ${attempt + 1}/${approveRetryMax}`, error);
      if (attempt < approveRetryMax - 1) {
        await delay(Math.min(2_000 * (attempt + 1), 5_000));
      } else {
        throw error;
      }
    }
  }

  throw new Error("Approval not confirmed after safe pre-submit retries");
  });
}
