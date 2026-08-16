"use client";

import { useCallback, useMemo } from "react";
import type { PublicClient } from "viem";
import { log } from "../lib/logger";
import type { GasOverrides, SilentSendFn } from "./useMining.types";
import type { ReceiptState } from "./useMining.stateTypes";
import { isAmbiguousPendingTxError, isDeterministicBetExecutionError } from "./useMining.shared";
import { useMiningStandardBetPath } from "./useMiningStandardBetPath";

interface UseMiningBetExecutionOptions {
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
  getActorAddress: () => string | null;
  waitReceipt: (hash: `0x${string}`, client?: PublicClient) => Promise<ReceiptState>;
  readPublicClient: () => PublicClient | undefined;
  readSilentSend: () => SilentSendFn | undefined;
  readWriteContractAsync: () => (args: unknown) => Promise<`0x${string}`>;
  ensurePreferredWallet: () => Promise<void> | void;
}

export function useMiningBetExecution({
  assertNativeGasBalance,
  assertSufficientAllowance,
  ensureAllowance,
  ensureContractPreflight,
  estimateGas,
  getBumpedFees,
  getActorAddress,
  waitReceipt,
  readPublicClient,
  readSilentSend,
  readWriteContractAsync,
  ensurePreferredWallet,
}: UseMiningBetExecutionOptions) {
  const { placeBets, placeBetsSilent } = useMiningStandardBetPath({
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
  });

  /** Try silent, then wallet-write, in order of preference. */
  const placeBetsPreferSilent = useCallback(
    async (
      tiles: number[],
      singleAmountRaw: bigint,
      gasOverrides?: GasOverrides,
      txNonce?: number,
      expectedEpoch?: bigint,
    ): Promise<ReceiptState> => {
      // --- Standard silent path ---
      const silentSend = readSilentSend();
      if (silentSend) {
        try {
          return await placeBetsSilent(tiles, singleAmountRaw, gasOverrides, txNonce, expectedEpoch);
        } catch (error) {
          if (isAmbiguousPendingTxError(error)) {
            throw error;
          }
          if (isDeterministicBetExecutionError(error)) {
            throw error;
          }
          log.warn("Mine", "silent send failed, fallback to wallet write", error);
        }
      }

      // --- Wallet write fallback ---
      return placeBets(tiles, singleAmountRaw, gasOverrides, txNonce, expectedEpoch);
    },
    [placeBets, placeBetsSilent, readSilentSend],
  );

  return useMemo(
    () => ({
      placeBets,
      placeBetsSilent,
      placeBetsPreferSilent,
    }),
    [placeBets, placeBetsPreferSilent, placeBetsSilent],
  );
}
