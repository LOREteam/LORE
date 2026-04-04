"use client";

import { useCallback } from "react";
import { encodeFunctionData, maxUint256 } from "viem";
import type { MutableRefObject } from "react";
import {
  APP_CHAIN_ID,
  CONTRACT_ADDRESS,
  LINEA_TOKEN_ADDRESS,
  TOKEN_ABI,
} from "../lib/constants";
import { delay } from "../lib/utils";
import { log } from "../lib/logger";
import type { GasOverrides, SilentSendFn } from "./useMining.types";
import type { PendingApproveState, ReceiptState } from "./useMining.stateTypes";
import { withMiningRpcTimeout } from "./useMining.shared";

type WriteContractFn = (...args: unknown[]) => Promise<unknown>;

const APPROVE_RETRY_MAX = 3;
const APPROVE_ALLOWANCE_POLL_MS = 2_000;
const APPROVE_ALLOWANCE_SYNC_TIMEOUT_MS = 12_000;
const APPROVE_PENDING_TIMEOUT_MS = 30_000;
const MIN_GAS_APPROVE = 90_000n;

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
      const deadline = Date.now() + timeoutMs;
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
    async (requiredAmount: bigint) => {
      const actorAddress = getActorAddress();
      const pc = readPublicClient();
      if (!actorAddress || !pc) return;
      await ensurePreferredWallet?.();
      await ensureContractPreflight();
      const actor = actorAddress as `0x${string}`;
      let liveAllowance = await readAllowance(actor);
      if (liveAllowance >= requiredAmount) return;

      if (pendingApproveRef.current) {
        const allowanceUpdated = await pollAllowanceUntil(actor, requiredAmount, 8_000);
        if (allowanceUpdated) {
          pendingApproveRef.current = null;
          refetchAllowance();
          return;
        }
      }

      for (let attempt = 0; attempt < APPROVE_RETRY_MAX; attempt++) {
        liveAllowance = await readAllowance(actor);
        if (liveAllowance >= requiredAmount) {
          pendingApproveRef.current = null;
          refetchAllowance();
          return;
        }

        const approveOverrides = await getApproveFees(attempt) ?? await getUrgentFees();
        const writeApproveOverrides =
          approveOverrides && "maxFeePerGas" in approveOverrides
            ? {
                maxFeePerGas: approveOverrides.maxFeePerGas,
                maxPriorityFeePerGas: approveOverrides.maxPriorityFeePerGas,
              }
            : {};
        await assertNativeGasBalance(MIN_GAS_APPROVE, approveOverrides);
        const approvalNonce = pendingApproveRef.current?.nonce ?? Number(
          await withMiningRpcTimeout(pc.getTransactionCount({
            address: actor,
            blockTag: "latest",
          }), "approve.getTransactionCount"),
        );
        const silentSend = readSilentSend();
        let approveHash: `0x${string}`;
        if (silentSend) {
          const data = encodeFunctionData({
            abi: TOKEN_ABI,
            functionName: "approve",
            args: [CONTRACT_ADDRESS, maxUint256],
          });
          approveHash = await silentSend(
            { to: LINEA_TOKEN_ADDRESS, data, gas: MIN_GAS_APPROVE, nonce: approvalNonce },
            approveOverrides,
          );
        } else {
          approveHash = await readWriteContractAsync()({
            address: LINEA_TOKEN_ADDRESS,
            abi: TOKEN_ABI,
            functionName: "approve",
            args: [CONTRACT_ADDRESS, maxUint256],
            chainId: APP_CHAIN_ID,
            nonce: approvalNonce,
            ...writeApproveOverrides,
          }) as `0x${string}`;
        }
        pendingApproveRef.current = { hash: approveHash, submittedAt: Date.now(), nonce: approvalNonce };
        const approveState = await waitReceipt(approveHash);
        const allowanceUpdated = approveState === "pending"
          ? await pollAllowanceUntil(actor, requiredAmount, APPROVE_PENDING_TIMEOUT_MS)
          : await pollAllowanceUntil(actor, requiredAmount, APPROVE_ALLOWANCE_SYNC_TIMEOUT_MS);

        if (approveState === "pending") {
          log.warn("Approve", "approve tx still pending after timeout window", { hash: approveHash });
        }

        if (allowanceUpdated) {
          pendingApproveRef.current = null;
          refetchAllowance();
          return;
        }

        if (attempt < APPROVE_RETRY_MAX - 1) {
          log.warn("Approve", `approval not visible on-chain yet, retrying ${attempt + 2}/${APPROVE_RETRY_MAX}`, {
            hash: approveHash,
          });
          await delay(APPROVE_ALLOWANCE_POLL_MS);
          continue;
        }

        const pendingAgeMs = pendingApproveRef.current ? Date.now() - pendingApproveRef.current.submittedAt : 0;
        throw new Error(
          pendingAgeMs > APPROVE_PENDING_TIMEOUT_MS
            ? "Approval transaction is still pending or underpriced. Retry once more to replace it."
            : "Approval transaction is still pending. Wait for confirmation before placing a bet.",
        );
      }
    },
    [
      assertNativeGasBalance,
      ensureContractPreflight,
      ensurePreferredWallet,
      getActorAddress,
      getApproveFees,
      getUrgentFees,
      pendingApproveRef,
      pollAllowanceUntil,
      readAllowance,
      readPublicClient,
      readSilentSend,
      readWriteContractAsync,
      refetchAllowance,
      waitReceipt,
    ],
  );

  return {
    assertSufficientAllowance,
    ensureAllowance,
  };
}
