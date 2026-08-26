"use client";

import { useCallback, useMemo, useRef } from "react";
import { encodeFunctionData, toFunctionSelector } from "viem";
import type { PublicClient } from "viem";
import {
  APP_CHAIN_ID,
  CONTRACT_ADDRESS,
  CONTRACT_REQUIRES_EPOCH_BOUND_BETS,
  GAME_ABI,
} from "../lib/constants";
import {
  assertNormalFeeBudget,
  hasCompleteFeeOverrides,
  mergeFeeOverrides,
} from "../lib/lineaFees";
import { log } from "../lib/logger";
import {
  attachPendingMiningTxHash,
  clearVerifiedPendingMiningTxState,
  createPendingMiningAgreementClients,
  PendingMiningTxSafetyError,
  readPendingMiningTxState,
  recoverAndClearPendingMiningTx,
  reservePendingMiningTxIntent,
  writeMiningTxPathState,
  type PendingMiningTxRecovery,
  type PendingMiningTxState,
} from "../lib/miningTxPath";
import { tileIdsToMask } from "../lib/tileMask";
import { isUserRejection } from "../lib/utils";
import type { GasOverrides, SilentSendFn } from "./useMining.types";
import type { ReceiptState } from "./useMining.stateTypes";
import {
  isAmbiguousPendingTxError,
  isDeterministicBetExecutionError,
  isNetworkError,
  normalizeTiles,
  withMiningRpcTimeout,
} from "./useMining.shared";

const EPOCH_BOUND_BITMAP_SELECTOR = toFunctionSelector(
  "placeBatchBetsBitmapForEpoch(uint256,uint32,uint256)",
);

function isMissingMethodError(error: unknown, methodName: string) {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const normalizedMethod = methodName.toLowerCase();
  const quotedMethod = `function "${normalizedMethod}"`;
  return (
    msg.includes(`${quotedMethod} returned no data`) ||
    msg.includes(`${quotedMethod} is not in the abi`) ||
    msg.includes(`does not have the function "${normalizedMethod}"`) ||
    msg.includes('returned no data ("0x")')
  );
}

export function shouldRecoverSilentSendAsPending(error: unknown): boolean {
  return isAmbiguousPendingTxError(error) || isNetworkError(error);
}

export function shouldClearDefinitelyUnsentMiningReservation(error: unknown): boolean {
  if (shouldRecoverSilentSendAsPending(error)) return false;
  return isUserRejection(error) || isDeterministicBetExecutionError(error);
}

type ReservedMiningWalletSinkResult =
  | `0x${string}`
  | { hash: `0x${string}` | null };

function getReservedMiningWalletSinkHash(result: ReservedMiningWalletSinkResult) {
  return typeof result === "string" ? result : result.hash;
}

export async function executeReservedMiningWalletSink<T extends ReservedMiningWalletSinkResult>(
  pendingState: PendingMiningTxState,
  assertBeforeWalletSink: () => Promise<void> | void,
  invokeWalletSink: () => Promise<T>,
): Promise<T> {
  let walletSinkInvoked = false;
  let walletSinkReturned = false;
  try {
    await assertBeforeWalletSink();
    walletSinkInvoked = true;
    const result = await invokeWalletSink();
    walletSinkReturned = true;
    const hash = getReservedMiningWalletSinkHash(result);
    if (hash) {
      const attached = attachPendingMiningTxHash(pendingState, hash);
      const submittedState = attached
        ? readPendingMiningTxState(pendingState.chainId, pendingState.contract, pendingState.actor)
        : null;
      if (!submittedState?.hash || submittedState.hash !== hash.toLowerCase()) {
        throw new PendingMiningTxSafetyError(
          "Submitted mining transaction hash could not be persisted and verified; manual reconciliation is required.",
        );
      }
    }
    return result;
  } catch (error) {
    const definitelyUnsent = !walletSinkInvoked || (
      !walletSinkReturned && shouldClearDefinitelyUnsentMiningReservation(error)
    );
    if (definitelyUnsent && !clearVerifiedPendingMiningTxState(pendingState)) {
      throw new PendingMiningTxSafetyError(
        "Unsubmitted mining reservation could not be cleared; manual reconciliation is required.",
      );
    }
    throw error;
  }
}

export function buildReservedMiningWriteRequest(
  args: Record<string, unknown>,
  actor: `0x${string}`,
  nonce: number,
) {
  return {
    ...args,
    account: actor,
    nonce,
  };
}

export function settleRecoveredMiningAttempt(
  recovery: PendingMiningTxRecovery,
  clear: () => void,
): ReceiptState | null {
  if (recovery === "pending" || recovery === "manual-reconciliation-required") return "pending";
  clear();
  return recovery === "confirmed" ? "confirmed" : null;
}

interface CreateMiningEpochWriteGuardOptions {
  expectedEpoch?: bigint;
  readCurrentEpoch: () => Promise<unknown>;
  assertBeforeSend?: () => Promise<void> | void;
}

export function createMiningEpochWriteGuard({
  expectedEpoch,
  readCurrentEpoch,
  assertBeforeSend,
}: CreateMiningEpochWriteGuardOptions) {
  let targetEpoch: bigint | null = null;

  const readAndAssertCurrent = async (expected: bigint | undefined) => {
    if (typeof expected !== "bigint" || expected < 1n) {
      throw new Error("Expected epoch is unavailable or unsafe. Refresh chain state before retrying.");
    }
    const currentEpoch = await readCurrentEpoch();
    if (typeof currentEpoch !== "bigint" || currentEpoch < 1n) {
      throw new Error("Live epoch is unavailable or unsafe. Refresh chain state before retrying.");
    }
    if (currentEpoch !== expected) {
      throw new Error(
        `Epoch changed before wallet write: expected ${expected.toString()}, current ${currentEpoch.toString()}. Refresh and retry.`,
      );
    }
    return expected;
  };

  return {
    establish: async () => {
      targetEpoch = await readAndAssertCurrent(expectedEpoch);
      return targetEpoch;
    },
    assertBeforeWalletWrite: async () => {
      if (targetEpoch === null) {
        throw new Error("Epoch write guard was not established before wallet submission.");
      }
      await readAndAssertCurrent(targetEpoch);
      await assertBeforeSend?.();
    },
  };
}

interface UseMiningStandardBetPathOptions {
  assertNativeGasBalance: (gas: bigint, gasOverrides?: GasOverrides) => Promise<void>;
  assertSufficientAllowance: (requiredRaw: bigint) => Promise<void>;
  ensureAllowance: (
    requiredRaw: bigint,
    assertBeforeSend?: () => Promise<void> | void,
  ) => Promise<void>;
  ensureContractPreflight: () => Promise<void>;
  estimateGas: (
    functionName:
      | "placeBet"
      | "placeBatchBets"
      | "placeBatchBetsSameAmount"
      | "placeBatchBetsBitmap"
      | "placeBatchBetsBitmapForEpoch",
    args: readonly unknown[],
    extraBuffer: bigint,
  ) => Promise<bigint>;
  getBumpedFees: (bumpBps?: bigint) => Promise<GasOverrides | undefined>;
  waitReceipt: (
    hash: `0x${string}`,
    client?: PublicClient,
    pendingState?: PendingMiningTxState,
  ) => Promise<ReceiptState>;
  readPublicClient: () => PublicClient | undefined;
  readSilentSend: () => SilentSendFn | undefined;
  readWriteContractAsync: () => (args: unknown) => Promise<`0x${string}`>;
  ensurePreferredWallet: () => Promise<void> | void;
  getActorAddress: () => string | null;
}

export function useMiningStandardBetPath({
  assertNativeGasBalance,
  assertSufficientAllowance,
  ensureAllowance,
  ensureContractPreflight,
  estimateGas,
  getBumpedFees,
  waitReceipt,
  readPublicClient,
  readSilentSend,
  readWriteContractAsync,
  ensurePreferredWallet,
  getActorAddress,
}: UseMiningStandardBetPathOptions) {
  const epochBoundBitmapSupportedRef = useRef<boolean | null>(null);
  const batchBitmapSupportedRef = useRef<boolean | null>(null);
  const batchSameAmountSupportedRef = useRef<boolean | null>(null);
  const agreementClients = useMemo(() => createPendingMiningAgreementClients(), []);

  const readCurrentEpoch = useCallback(
    async () => {
      const client = readPublicClient();
      if (!client) throw new Error("Public client not ready for epoch-bound bet.");
      return withMiningRpcTimeout(
        client.readContract({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "currentEpoch",
        }),
        "bet.currentEpochBeforeSend",
        8_000,
      );
    },
    [readPublicClient],
  );

  const supportsEpochBoundBitmap = useCallback(async () => {
    if (epochBoundBitmapSupportedRef.current !== null) {
      return epochBoundBitmapSupportedRef.current;
    }
    const client = readPublicClient();
    if (!client) throw new Error("Public client not ready for contract capability check.");
    const bytecode = await withMiningRpcTimeout(
      client.getBytecode({ address: CONTRACT_ADDRESS }),
      "bet.contractBytecode",
      8_000,
    );
    if (!bytecode) throw new Error("Configured game contract has no bytecode.");
    const supported = bytecode.toLowerCase().includes(EPOCH_BOUND_BITMAP_SELECTOR.slice(2).toLowerCase());
    epochBoundBitmapSupportedRef.current = supported;
    if (!supported) {
      if (CONTRACT_REQUIRES_EPOCH_BOUND_BETS) {
        throw new Error("Configured contract is missing required epoch-bound betting support.");
      }
      log.info("Mine", "epoch-bound bitmap unavailable, using compatible legacy bet path");
    }
    return supported;
  }, [readPublicClient]);

  const recoverTrackedPending = useCallback(
    async (): Promise<ReceiptState | null> => {
      const actor = getActorAddress();
      if (!actor) return null;
      const state = readPendingMiningTxState(APP_CHAIN_ID, CONTRACT_ADDRESS, actor);
      if (!state) return null;
      if (!agreementClients) return "pending";
      const recovery = await recoverAndClearPendingMiningTx(agreementClients, state);
      return settleRecoveredMiningAttempt(recovery, () => undefined);
    },
    [agreementClients, getActorAddress],
  );

  const waitTrackedReceipt = useCallback(
    async (
      hash: `0x${string}`,
      client?: PublicClient,
      pendingState?: PendingMiningTxState,
    ): Promise<ReceiptState> => {
      log.info("Mine", "bet transaction submitted", {
        hash,
        nonce: pendingState?.nonce ?? null,
      });
      if (!pendingState) {
        log.warn("Mine", "submitted mining transaction requires manual reconciliation", { hash });
        return "pending";
      }
      const submittedState = readPendingMiningTxState(
        pendingState.chainId,
        pendingState.contract,
        pendingState.actor,
      );
      if (!submittedState?.hash || submittedState.hash !== hash.toLowerCase()) {
        log.warn("Mine", "submitted mining transaction state changed before receipt verification", { hash });
        return "pending";
      }
      const state = await waitReceipt(hash, client, submittedState);
      if (state === "confirmed") {
        if (!agreementClients) return "pending";
        const recovery = await recoverAndClearPendingMiningTx(agreementClients, submittedState);
        if (recovery !== "confirmed") return "pending";
      }
      return state;
    },
    [agreementClients, waitReceipt],
  );

  const reserveSubmission = useCallback(
    async (
      actor: `0x${string}`,
      calldata: `0x${string}`,
      targetEpoch: bigint,
      normalizedTiles: number[],
      singleAmountRaw: bigint,
      requestedNonce?: number,
    ) => {
      if (!agreementClients) {
        throw new Error("Two independent public clients are required before mining submission.");
      }
      const pendingState = await reservePendingMiningTxIntent(agreementClients, {
        chainId: APP_CHAIN_ID,
        contract: CONTRACT_ADDRESS,
        actor,
        calldata,
        expectedEpoch: targetEpoch,
        tileIds: normalizedTiles,
        amountRawPerTile: singleAmountRaw,
      });
      if (pendingState.nonce === undefined || (requestedNonce !== undefined && requestedNonce !== pendingState.nonce)) {
        if (!clearVerifiedPendingMiningTxState(pendingState)) {
          throw new Error("Mismatched mining nonce reservation requires manual reconciliation.");
        }
        throw new Error("Requested mining nonce does not match verified pending nonce evidence.");
      }
      return { ...pendingState, nonce: pendingState.nonce };
    },
    [agreementClients],
  );

  const placeBets = useCallback(
    async (
      tiles: number[],
      singleAmountRaw: bigint,
      gasOverrides?: GasOverrides,
      txNonce?: number,
      expectedEpoch?: bigint,
      assertBeforeSend?: () => Promise<void> | void,
    ): Promise<ReceiptState> => {
      const normalizedTiles = normalizeTiles(tiles);
      if (normalizedTiles.length === 0) throw new Error("No valid tiles selected");
      await ensurePreferredWallet();
      await ensureContractPreflight();
      const recoveredPending = await recoverTrackedPending();
      if (recoveredPending) return recoveredPending;
      const epochWriteGuard = createMiningEpochWriteGuard({
        expectedEpoch,
        readCurrentEpoch,
        assertBeforeSend,
      });
      const epochBoundBitmapSupported = await supportsEpochBoundBitmap();
      const targetEpoch = await epochWriteGuard.establish();
      const totalAmountRaw = singleAmountRaw * BigInt(normalizedTiles.length);
      await ensureAllowance(totalAmountRaw, epochWriteGuard.assertBeforeWalletWrite);
      await assertSufficientAllowance(totalAmountRaw);
      const resolvedFees = hasCompleteFeeOverrides(gasOverrides)
        ? undefined
        : await getBumpedFees();
      const overrides = mergeFeeOverrides(resolvedFees, gasOverrides);
      const writeContractAsync = readWriteContractAsync();
      const writeAuthorizedContract = async (
        args: Record<string, unknown>,
        calldata: `0x${string}`,
        gas: bigint,
      ) => {
        assertNormalFeeBudget(overrides, gas, APP_CHAIN_ID);
        await epochWriteGuard.assertBeforeWalletWrite();
        const actor = getActorAddress();
        if (!actor) throw new Error("Wallet actor is unavailable before mining submission.");
        const reservedActor = actor as `0x${string}`;
        const pendingState = await reserveSubmission(
          reservedActor,
          calldata,
          targetEpoch,
          normalizedTiles,
          singleAmountRaw,
          txNonce,
        );
        const hash = await executeReservedMiningWalletSink(
          pendingState,
          epochWriteGuard.assertBeforeWalletWrite,
          () => writeContractAsync(
            buildReservedMiningWriteRequest(args, reservedActor, pendingState.nonce),
          ),
        );
        return { hash, pendingState };
      };
      const tileMask = tileIdsToMask(normalizedTiles);

      if (epochBoundBitmapSupported) {
        const gas = await estimateGas(
          "placeBatchBetsBitmapForEpoch",
          [targetEpoch, tileMask, singleAmountRaw],
          BigInt(80_000),
        );
        await assertNativeGasBalance(gas, overrides);
        const calldata = encodeFunctionData({
          abi: GAME_ABI,
          functionName: "placeBatchBetsBitmapForEpoch",
          args: [targetEpoch, tileMask, singleAmountRaw],
        });
        const submission = await writeAuthorizedContract({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "placeBatchBetsBitmapForEpoch",
          args: [targetEpoch, tileMask, singleAmountRaw],
          chainId: APP_CHAIN_ID,
          gas,
          ...(overrides ?? {}),
        }, calldata, gas);
        writeMiningTxPathState("wallet-write", "direct-wallet");
        return waitTrackedReceipt(submission.hash, undefined, submission.pendingState);
      }

      if (normalizedTiles.length === 1) {
        const gas = await estimateGas("placeBet", [BigInt(normalizedTiles[0]), singleAmountRaw], BigInt(60000));
        await assertNativeGasBalance(gas, overrides);
        const calldata = encodeFunctionData({
          abi: GAME_ABI,
          functionName: "placeBet",
          args: [BigInt(normalizedTiles[0]), singleAmountRaw],
        });
        const submission = await writeAuthorizedContract({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "placeBet",
          args: [BigInt(normalizedTiles[0]), singleAmountRaw],
          chainId: APP_CHAIN_ID,
          gas,
          ...(overrides ?? {}),
        }, calldata, gas);
        writeMiningTxPathState("wallet-write", "direct-wallet");
        return waitTrackedReceipt(submission.hash, undefined, submission.pendingState);
      }

      const tileArgs = normalizedTiles.map((id) => BigInt(id));

      if (batchBitmapSupportedRef.current !== false) {
        try {
          const gas = await estimateGas("placeBatchBetsBitmap", [tileMask, singleAmountRaw], BigInt(80_000));
          await assertNativeGasBalance(gas, overrides);
          const calldata = encodeFunctionData({
            abi: GAME_ABI,
            functionName: "placeBatchBetsBitmap",
            args: [tileMask, singleAmountRaw],
          });
          const submission = await writeAuthorizedContract({
            address: CONTRACT_ADDRESS,
            abi: GAME_ABI,
            functionName: "placeBatchBetsBitmap",
            args: [tileMask, singleAmountRaw],
            chainId: APP_CHAIN_ID,
            gas,
            ...(overrides ?? {}),
          }, calldata, gas);
          batchBitmapSupportedRef.current = true;
          writeMiningTxPathState("wallet-write", "direct-wallet");
          return waitTrackedReceipt(submission.hash, undefined, submission.pendingState);
        } catch (error) {
          if (!isMissingMethodError(error, "placeBatchBetsBitmap")) {
            throw error;
          }
          batchBitmapSupportedRef.current = false;
          log.warn(
            "Mine",
            "placeBatchBetsBitmap unavailable on current contract, fallback to placeBatchBetsSameAmount",
            error,
          );
        }
      }

      if (batchSameAmountSupportedRef.current !== false) {
        try {
          const gas = await estimateGas("placeBatchBetsSameAmount", [tileArgs, singleAmountRaw], BigInt(90_000));
          await assertNativeGasBalance(gas, overrides);
          const calldata = encodeFunctionData({
            abi: GAME_ABI,
            functionName: "placeBatchBetsSameAmount",
            args: [tileArgs, singleAmountRaw],
          });
          const submission = await writeAuthorizedContract({
            address: CONTRACT_ADDRESS,
            abi: GAME_ABI,
            functionName: "placeBatchBetsSameAmount",
            args: [tileArgs, singleAmountRaw],
            chainId: APP_CHAIN_ID,
            gas,
            ...(overrides ?? {}),
          }, calldata, gas);
          batchSameAmountSupportedRef.current = true;
          writeMiningTxPathState("wallet-write", "direct-wallet");
          return waitTrackedReceipt(submission.hash, undefined, submission.pendingState);
        } catch (error) {
          if (!isMissingMethodError(error, "placeBatchBetsSameAmount")) {
            throw error;
          }
          batchSameAmountSupportedRef.current = false;
          log.warn(
            "Mine",
            "placeBatchBetsSameAmount unavailable on current contract, fallback to placeBatchBets",
            error,
          );
        }
      }

      const amountArgs = normalizedTiles.map(() => singleAmountRaw);
      const gas = await estimateGas("placeBatchBets", [tileArgs, amountArgs], BigInt(120_000));
      await assertNativeGasBalance(gas, overrides);
      const calldata = encodeFunctionData({
        abi: GAME_ABI,
        functionName: "placeBatchBets",
        args: [tileArgs, amountArgs],
      });
      const submission = await writeAuthorizedContract({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "placeBatchBets",
        args: [tileArgs, amountArgs],
        chainId: APP_CHAIN_ID,
        gas,
        ...(overrides ?? {}),
      }, calldata, gas);
      writeMiningTxPathState("wallet-write", "direct-wallet");
      return waitTrackedReceipt(submission.hash, undefined, submission.pendingState);
    },
    [
      assertNativeGasBalance,
      assertSufficientAllowance,
      ensureAllowance,
      ensureContractPreflight,
      ensurePreferredWallet,
      estimateGas,
      getActorAddress,
      getBumpedFees,
      recoverTrackedPending,
      readWriteContractAsync,
      readCurrentEpoch,
      reserveSubmission,
      supportsEpochBoundBitmap,
      waitTrackedReceipt,
    ],
  );

  const placeBetsSilent = useCallback(
    async (
      tiles: number[],
      singleAmountRaw: bigint,
      gasOverrides?: GasOverrides,
      txNonce?: number,
      expectedEpoch?: bigint,
      assertBeforeSend?: () => Promise<void> | void,
    ): Promise<ReceiptState> => {
      const normalizedTiles = normalizeTiles(tiles);
      if (normalizedTiles.length === 0) throw new Error("No valid tiles selected");
      await ensurePreferredWallet();
      await ensureContractPreflight();

      const client = readPublicClient();
      const silentSend = readSilentSend();
      if (!client || !silentSend) throw new Error("Privy wallet not ready");
      const recoveredPending = await recoverTrackedPending();
      if (recoveredPending) return recoveredPending;

      const epochWriteGuard = createMiningEpochWriteGuard({
        expectedEpoch,
        readCurrentEpoch,
        assertBeforeSend,
      });
      const epochBoundBitmapSupported = await supportsEpochBoundBitmap();
      const targetEpoch = await epochWriteGuard.establish();
      const totalAmountRaw = singleAmountRaw * BigInt(normalizedTiles.length);
      await ensureAllowance(totalAmountRaw, epochWriteGuard.assertBeforeWalletWrite);
      await assertSufficientAllowance(totalAmountRaw);

      let data: `0x${string}` | undefined;
      let gas: bigint | undefined;
      const tileMask = tileIdsToMask(normalizedTiles);

      if (epochBoundBitmapSupported) {
        gas = await estimateGas(
          "placeBatchBetsBitmapForEpoch",
          [targetEpoch, tileMask, singleAmountRaw],
          BigInt(160_000),
        );
        data = encodeFunctionData({
          abi: GAME_ABI,
          functionName: "placeBatchBetsBitmapForEpoch",
          args: [targetEpoch, tileMask, singleAmountRaw],
        });
      }

      if (!data && normalizedTiles.length === 1) {
        gas = await estimateGas("placeBet", [BigInt(normalizedTiles[0]), singleAmountRaw], BigInt(140000));
        data = encodeFunctionData({
          abi: GAME_ABI,
          functionName: "placeBet",
          args: [BigInt(normalizedTiles[0]), singleAmountRaw],
        });
      } else if (!data) {
        const tileArgs = normalizedTiles.map((id) => BigInt(id));

        if (!data && batchBitmapSupportedRef.current !== false) {
          try {
            gas = await estimateGas("placeBatchBetsBitmap", [tileMask, singleAmountRaw], BigInt(160_000));
            data = encodeFunctionData({
              abi: GAME_ABI,
              functionName: "placeBatchBetsBitmap",
              args: [tileMask, singleAmountRaw],
            });
            batchBitmapSupportedRef.current = true;
          } catch (error) {
            if (!isMissingMethodError(error, "placeBatchBetsBitmap")) {
              throw error;
            }
            batchBitmapSupportedRef.current = false;
            log.warn(
              "Mine",
              "silent placeBatchBetsBitmap unavailable on current contract, fallback to placeBatchBetsSameAmount",
              error,
            );
          }
        }

        if (!data && batchSameAmountSupportedRef.current !== false) {
          try {
            gas = await estimateGas("placeBatchBetsSameAmount", [tileArgs, singleAmountRaw], BigInt(180_000));
            data = encodeFunctionData({
              abi: GAME_ABI,
              functionName: "placeBatchBetsSameAmount",
              args: [tileArgs, singleAmountRaw],
            });
            batchSameAmountSupportedRef.current = true;
          } catch (error) {
            if (!isMissingMethodError(error, "placeBatchBetsSameAmount")) {
              throw error;
            }
            batchSameAmountSupportedRef.current = false;
            log.warn(
              "Mine",
              "silent placeBatchBetsSameAmount unavailable on current contract, fallback to placeBatchBets",
              error,
            );
          }
        }

        if (!data) {
          const amountArgs = normalizedTiles.map(() => singleAmountRaw);
          gas = await estimateGas("placeBatchBets", [tileArgs, amountArgs], BigInt(240_000));
          data = encodeFunctionData({
            abi: GAME_ABI,
            functionName: "placeBatchBets",
            args: [tileArgs, amountArgs],
          });
        }
      }

      if (gas) {
        await assertNativeGasBalance(gas, gasOverrides);
      }

      const actor = getActorAddress();
      if (!actor) throw new Error("Wallet actor is unavailable before mining submission.");
      if (!data) throw new Error("Mining calldata is unavailable before submission.");
      const pendingState = await reserveSubmission(
        actor as `0x${string}`,
        data,
        targetEpoch,
        normalizedTiles,
        singleAmountRaw,
        txNonce,
      );
      const submission = await executeReservedMiningWalletSink(
        pendingState,
        epochWriteGuard.assertBeforeWalletWrite,
        async () => {
          try {
            return {
              hash: await silentSend(
                {
                  to: CONTRACT_ADDRESS,
                  data,
                  gas,
                  nonce: pendingState.nonce,
                },
                gasOverrides,
              ),
            };
          } catch (error) {
            if (shouldRecoverSilentSendAsPending(error)) {
              log.warn("Mine", "silent send may already be pending, avoiding duplicate wallet fallback", error);
              return { hash: null };
            }
            throw error;
          }
        },
      );
      if (!submission.hash) return "pending";
      const hash = submission.hash;
      try {
        writeMiningTxPathState("standard-silent", "legacy-silent");
        log.info("Mine", "using standard silent bet path", {
          tileCount: normalizedTiles.length,
          totalAmountRaw,
          hash,
        });
      } catch (error) {
        log.warn("Mine", "submitted silent mining transaction could not update local path diagnostics", error);
      }

      return waitTrackedReceipt(hash, client, pendingState);
    },
    [
      assertNativeGasBalance,
      assertSufficientAllowance,
      ensureAllowance,
      ensureContractPreflight,
      ensurePreferredWallet,
      estimateGas,
      getActorAddress,
      readPublicClient,
      readCurrentEpoch,
      readSilentSend,
      recoverTrackedPending,
      reserveSubmission,
      supportsEpochBoundBitmap,
      waitTrackedReceipt,
    ],
  );

  return useMemo(
    () => ({
      placeBets,
      placeBetsSilent,
    }),
    [placeBets, placeBetsSilent],
  );
}
