"use client";

import { useCallback } from "react";
import type { PublicClient } from "viem";
import { log } from "../lib/logger";
import type { GasOverrides, SilentSendFn } from "./useMining.types";
import type { ReceiptState } from "./useMining.stateTypes";
import { useMiningStandardBetPath } from "./useMiningStandardBetPath";

interface UseMiningBetExecutionOptions {
  assertNativeGasBalance: (gas: bigint, gasOverrides?: GasOverrides) => Promise<void>;
  assertSufficientAllowance: (requiredRaw: bigint) => Promise<void>;
  ensureAllowance: (requiredRaw: bigint) => Promise<void>;
  ensureContractPreflight: () => Promise<void>;
  estimateGas: (
    functionName: "placeBet" | "placeBatchBets" | "placeBatchBetsSameAmount",
    args: readonly unknown[],
    extraBuffer: bigint,
  ) => Promise<bigint>;
  getBumpedFees: (bumpBps?: bigint) => Promise<GasOverrides | undefined>;
  getActorAddress: () => string | null;
  waitReceipt: (hash: `0x${string}`, client?: PublicClient) => Promise<ReceiptState>;
  readPublicClient: () => PublicClient | undefined;
  readSilentSend: () => SilentSendFn | undefined;
  readSilentSend7702: () => unknown;
  readSignEip7702Delegation: () => unknown;
  readEip7702Capability: () => unknown;
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
  });

  const placeBetsPreferSilent = useCallback(
    async (
      tiles: number[],
      singleAmountRaw: bigint,
      gasOverrides?: GasOverrides,
      txNonce?: number,
    ): Promise<ReceiptState> => {
      const silentSend = readSilentSend();
      if (silentSend) {
        try {
          return await placeBetsSilent(tiles, singleAmountRaw, gasOverrides, txNonce);
        } catch (error) {
          log.warn("Mine", "silent send failed, fallback to wallet write", error);
        }
      }
      return placeBets(tiles, singleAmountRaw, gasOverrides, txNonce);
    },
    [placeBets, placeBetsSilent, readSilentSend],
  );

  return {
    placeBets,
    placeBetsSilent,
    placeBetsPreferSilent,
  };
}
