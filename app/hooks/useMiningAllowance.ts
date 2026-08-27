"use client";

import { useCallback, useMemo } from "react";
import { encodeFunctionData } from "viem";
import type { MutableRefObject } from "react";
import {
  APP_CHAIN_ID,
  CONTRACT_ADDRESS,
  LINEA_TOKEN_ADDRESS,
  TOKEN_ABI,
} from "../lib/constants";
import { delay } from "../lib/utils";
import { log } from "../lib/logger";
import { assertKeeperFeeBudget } from "../lib/lineaFees";
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
} from "../lib/miningTxPath";
import { bindMiningSilentSendActor, type GasOverrides, type SilentSendFn } from "./useMining.types";
import type { PendingApproveState, ReceiptState } from "./useMining.stateTypes";
import { withMiningRpcTimeout } from "./useMining.shared";

type WriteContractFn = (...args: unknown[]) => Promise<unknown>;

const APPROVE_RETRY_MAX = 3;
const APPROVE_ALLOWANCE_POLL_MS = 2_000;
const APPROVE_ALLOWANCE_SYNC_TIMEOUT_MS = 12_000;
const MIN_GAS_APPROVE = 90_000n;

function computeAllowancePollDeadline(now: number, timeoutMs: number): number | null {
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

function normalizeApprovalNonce(value: unknown): number | null {
  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(value);
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return null;
  }
  return value;
}

export function selectApprovalSubmissionNonce(trackedNonce: unknown, freshPendingNonce: unknown): number | null {
  if (trackedNonce !== undefined && trackedNonce !== null) return null;
  return normalizeApprovalNonce(freshPendingNonce);
}

function assertExactApprovalAmount(requiredAmount: bigint): bigint {
  if (typeof requiredAmount !== "bigint" || requiredAmount <= 0n) {
    throw new Error("mining approval amount must be a positive bigint");
  }
  return requiredAmount;
}

export function buildMiningApprovalCalldata(requiredAmount: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: TOKEN_ABI,
    functionName: "approve",
    args: [CONTRACT_ADDRESS, assertExactApprovalAmount(requiredAmount)],
  });
}

export function buildDirectApprovalWriteRequest(
  approvalNonce: number,
  requiredAmount: bigint,
  approveOverrides: GasOverrides | undefined,
  actor: `0x${string}`,
) {
  assertKeeperFeeBudget(approveOverrides, MIN_GAS_APPROVE, APP_CHAIN_ID, "approval");
  return {
    ...approveOverrides,
    address: LINEA_TOKEN_ADDRESS,
    abi: TOKEN_ABI,
    functionName: "approve" as const,
    args: [CONTRACT_ADDRESS, assertExactApprovalAmount(requiredAmount)] as const,
    account: actor,
    chainId: APP_CHAIN_ID,
    nonce: approvalNonce,
    gas: MIN_GAS_APPROVE,
  };
}

interface UseMiningAllowanceOptions {
  assertNativeGasBalance: (gas: bigint, gasOverrides?: GasOverrides) => Promise<void>;
  ensureContractPreflight: () => Promise<void>;
  getActorAddress: () => string | null;
  getApproveFees: (attempt?: number) => Promise<GasOverrides | undefined>;
  getUrgentFees: () => Promise<GasOverrides | undefined>;
  pendingApproveRef: MutableRefObject<PendingApproveState | null>;
  readPublicClient: () => {
    getTransactionCount: (...args: unknown[]) => Promise<number | bigint>;
    readContract: (...args: unknown[]) => Promise<unknown>;
  } | null | undefined;
  readSilentSend: () => SilentSendFn | undefined;
  readWriteContractAsync: () => WriteContractFn;
  refetchAllowance: () => void;
  waitReceipt: (hash: `0x${string}`) => Promise<ReceiptState>;
  ensurePreferredWallet?: () => Promise<void> | void;
}

export function useMiningAllowance({
  assertNativeGasBalance,
  ensureContractPreflight,
  getActorAddress,
  getApproveFees,
  getUrgentFees,
  pendingApproveRef,
  readPublicClient,
  readSilentSend,
  readWriteContractAsync,
  refetchAllowance,
  waitReceipt,
  ensurePreferredWallet,
}: UseMiningAllowanceOptions) {
  const approvalAgreementClients = useMemo(() => createPendingMiningAgreementClients(), []);
  const readAllowance = useCallback(
    async (actorAddress: `0x${string}`) => {
      const pc = readPublicClient();
      if (!pc) return 0n;
      return (await withMiningRpcTimeout(pc.readContract({
        address: LINEA_TOKEN_ADDRESS,
        abi: TOKEN_ABI,
        functionName: "allowance",
        args: [actorAddress, CONTRACT_ADDRESS],
      }), "token.allowance")) as bigint;
    },
    [readPublicClient],
  );

  const pollAllowanceUntil = useCallback(
    async (actorAddress: `0x${string}`, requiredAmount: bigint, timeoutMs: number) => {
      const deadline = computeAllowancePollDeadline(Date.now(), timeoutMs);
      if (deadline === null) return false;
      while (Date.now() < deadline) {
        try {
          const allowance = await readAllowance(actorAddress);
          if (allowance >= requiredAmount) return true;
        } catch {
          // ignore transient RPC issues during allowance polling
        }
        await delay(APPROVE_ALLOWANCE_POLL_MS);
      }
      return false;
    },
    [readAllowance],
  );

  const assertSufficientAllowance = useCallback(
    async (requiredAmount: bigint) => {
      const actorAddress = getActorAddress();
      if (!readPublicClient() || !actorAddress) return;
      const liveAllowance = await readAllowance(actorAddress as `0x${string}`);
      if (liveAllowance >= requiredAmount) return;
      const synced = await pollAllowanceUntil(
        actorAddress as `0x${string}`,
        requiredAmount,
        APPROVE_ALLOWANCE_SYNC_TIMEOUT_MS,
      );
      if (synced) return;
      if (liveAllowance < requiredAmount) {
        throw new Error("Insufficient allowance: approve transaction is missing, pending, or not yet indexed by RPC.");
      }
    },
    [getActorAddress, pollAllowanceUntil, readAllowance, readPublicClient],
  );

  const ensureAllowance = useCallback(
    async (requiredAmount: bigint, assertBeforeSend?: () => Promise<void> | void) => {
      const actorAddress = getActorAddress();
      const pc = readPublicClient();
      if (!actorAddress || !pc) return;
      const actor = actorAddress as `0x${string}`;

      return withPendingMiningApprovalLock({
        chainId: APP_CHAIN_ID,
        token: LINEA_TOKEN_ADDRESS,
        spender: CONTRACT_ADDRESS,
        actor,
      }, async () => {
        const clearApprovalState = () => {
          const current = readPendingMiningApprovalState(
            APP_CHAIN_ID,
            LINEA_TOKEN_ADDRESS,
            CONTRACT_ADDRESS,
            actor,
          );
          if (current && !clearVerifiedPendingMiningApprovalState(current)) {
            throw new Error("Approval safety state could not be cleared. Restore browser storage before retrying.");
          }
          pendingApproveRef.current = null;
        };
        const readAgreedAllowance = async () => {
          if (!approvalAgreementClients) {
            throw new Error("Two independent RPC origins are required for approval allowance verification.");
          }
          return readAgreedPendingMiningAllowance(
            approvalAgreementClients,
            LINEA_TOKEN_ADDRESS,
            CONTRACT_ADDRESS,
            actor,
          );
        };
        const pollAgreedAllowanceUntil = async (minimumAmount: bigint, timeoutMs: number) => {
          const deadline = computeAllowancePollDeadline(Date.now(), timeoutMs);
          if (deadline === null) return false;
          while (Date.now() < deadline) {
            try {
              if (await readAgreedAllowance() >= minimumAmount) return true;
            } catch {
              // Disagreement and transient failures both fail closed until the next bounded poll.
            }
            await delay(APPROVE_ALLOWANCE_POLL_MS);
          }
          return false;
        };
        await ensurePreferredWallet?.();
        await ensureContractPreflight();
        let pendingApprovalState = readPendingMiningApprovalState(
          APP_CHAIN_ID,
          LINEA_TOKEN_ADDRESS,
          CONTRACT_ADDRESS,
          actor,
        );
        if (pendingApprovalState) {
          pendingApproveRef.current = {
            ...(pendingApprovalState.hash ? { hash: pendingApprovalState.hash } : {}),
            submittedAt: pendingApprovalState.ts,
            nonce: pendingApprovalState.nonce,
          };
        } else if (pendingApproveRef.current) {
          throw new Error(
            "Legacy approval pending state is not bound to an exact amount; manual reconciliation is required.",
          );
        }

        let liveAllowance = await readAgreedAllowance();
        if (liveAllowance >= requiredAmount) {
          clearApprovalState();
          refetchAllowance();
          return;
        }

        if (pendingApprovalState) {
          if (!approvalAgreementClients) {
            throw new Error("Two independent RPC origins are required to reconcile the pending approval.");
          }
          const recovery = await recoverPendingMiningApproval(approvalAgreementClients, pendingApprovalState);
          if (recovery === "confirmed") {
            const outcome = await settleRecoveredMiningApprovalAllowance({
              pendingState: pendingApprovalState,
              requiredAmount,
              pollAgreedAllowanceUntil: (minimumAmount) =>
                pollAgreedAllowanceUntil(minimumAmount, APPROVE_ALLOWANCE_SYNC_TIMEOUT_MS),
              clearApprovalState,
              readAgreedAllowance,
            });
            refetchAllowance();
            if (outcome === "satisfied") return;
            pendingApprovalState = null;
          } else if (recovery === "reverted") {
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

        for (let attempt = 0; attempt < APPROVE_RETRY_MAX; attempt++) {
          liveAllowance = await readAgreedAllowance();
          if (liveAllowance >= requiredAmount) {
            clearApprovalState();
            refetchAllowance();
            return;
          }

          const approveOverrides = await getApproveFees(attempt) ?? await getUrgentFees();
          await assertNativeGasBalance(MIN_GAS_APPROVE, approveOverrides);
          const approvalNonceRaw = await readAgreedPendingMiningApprovalNonce(approvalAgreementClients, actor);
          const approvalNonce = selectApprovalSubmissionNonce(undefined, approvalNonceRaw);
          if (approvalNonce === null) {
            throw new Error("Approval nonce is unavailable or unsafe. Wait for wallet nonce recovery, then retry.");
          }
          const reservation = writePendingMiningApprovalState({
            chainId: APP_CHAIN_ID,
            token: LINEA_TOKEN_ADDRESS,
            spender: CONTRACT_ADDRESS,
            actor,
            nonce: approvalNonce,
            amountRaw: requiredAmount.toString(),
          });
          if (!reservation) {
            throw new Error("Approval intent could not be persisted and verified; wallet approval is blocked.");
          }
          pendingApproveRef.current = { submittedAt: reservation.ts, nonce: approvalNonce };
          const silentSend = readSilentSend();
          let approveHash: `0x${string}` | undefined;
          try {
            if (silentSend) {
              const data = buildMiningApprovalCalldata(requiredAmount);
              approveHash = await executeReservedMiningApprovalWalletSink(
                reservation,
                async () => assertBeforeSend?.(),
                () => silentSend(
                  bindMiningSilentSendActor(
                    { to: LINEA_TOKEN_ADDRESS, data, gas: MIN_GAS_APPROVE, nonce: approvalNonce },
                    reservation.actor,
                  ),
                  approveOverrides,
                ),
              );
            } else {
              approveHash = await executeReservedMiningApprovalWalletSink(
                reservation,
                async () => assertBeforeSend?.(),
                async () => readWriteContractAsync()(
                  buildDirectApprovalWriteRequest(approvalNonce, requiredAmount, approveOverrides, actor),
                ) as Promise<`0x${string}`>,
              );
            }
          } catch (error) {
            const pendingAfterError = readPendingMiningApprovalState(
              APP_CHAIN_ID,
              LINEA_TOKEN_ADDRESS,
              CONTRACT_ADDRESS,
              actor,
            );
            if (!pendingAfterError) pendingApproveRef.current = null;
            throw error;
          }
          const submitted = writePendingMiningApprovalState({
            ...reservation,
            hash: approveHash,
          });
          if (!submitted) {
            throw new Error("Submitted approval could not be persisted; manual reconciliation is required.");
          }
          pendingApproveRef.current = { hash: approveHash, submittedAt: submitted.ts, nonce: approvalNonce };
          await waitReceipt(approveHash);
          const submittedState = readPendingMiningApprovalState(
            APP_CHAIN_ID,
            LINEA_TOKEN_ADDRESS,
            CONTRACT_ADDRESS,
            actor,
          );
          if (!submittedState?.hash || submittedState.hash !== approveHash) {
            throw new Error("Submitted approval state is unavailable; manual reconciliation is required.");
          }
          const recovery = await recoverPendingMiningApproval(approvalAgreementClients, submittedState);
          if (recovery === "confirmed") {
            const allowanceUpdated = await pollAgreedAllowanceUntil(
              BigInt(submittedState.amountRaw),
              APPROVE_ALLOWANCE_SYNC_TIMEOUT_MS,
            );
            if (!allowanceUpdated) {
              throw new Error("Finalized approval is not reflected in live allowance; manual reconciliation is required.");
            }
            clearApprovalState();
            refetchAllowance();
            return;
          }
          if (recovery === "reverted") {
            clearApprovalState();
            if (attempt < APPROVE_RETRY_MAX - 1) continue;
            throw new Error("Approval transaction reverted after finality.");
          }
          if (recovery === "pending") {
            log.warn("Approve", "approve transaction awaits finalized two-RPC confirmation", { hash: approveHash });
            throw new Error("Approval transaction is still pending. Wait for finalized two-RPC confirmation.");
          }
          throw new Error("Submitted approval identity cannot be proven; manual reconciliation is required.");
        }
      });
    },
    [
      assertNativeGasBalance,
      approvalAgreementClients,
      ensureContractPreflight,
      ensurePreferredWallet,
      getActorAddress,
      getApproveFees,
      getUrgentFees,
      pendingApproveRef,
      readPublicClient,
      readSilentSend,
      readWriteContractAsync,
      refetchAllowance,
      waitReceipt,
    ],
  );

  return useMemo(
    () => ({
      assertSufficientAllowance,
      ensureAllowance,
    }),
    [assertSufficientAllowance, ensureAllowance],
  );
}
