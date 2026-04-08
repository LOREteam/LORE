"use client";

import { useCallback } from "react";
import type { PublicClient } from "viem";
import { log } from "../lib/logger";
import { EIP7702_MINING_ENABLED, type Eip7702CapabilityState } from "../lib/eip7702";
import { canAttemptEip7702 } from "../lib/eip7702Runtime";
import type { GasOverrides, SilentSendFn, SilentSend7702Fn, Sign7702DelegationFn } from "./useMining.types";
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
  readSilentSend7702: () => SilentSend7702Fn | undefined;
  readSignEip7702Delegation: () => Sign7702DelegationFn | undefined;
  readEip7702Capability: () => Eip7702CapabilityState | undefined;
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
  readSilentSend7702,
  readSignEip7702Delegation,
  readEip7702Capability,
  readWriteContractAsync,
  ensurePreferredWallet,
}: UseMiningBetExecutionOptions) {
  const { placeBets, placeBetsSilent, placeBets7702 } = useMiningStandardBetPath({
    assertNativeGasBalance,
    assertSufficientAllowance,
    ensureAllowance,
    ensureContractPreflight,
    estimateGas,
    getBumpedFees,
    waitReceipt,
    readPublicClient,
    readSilentSend,
    readSilentSend7702,
    readSignEip7702Delegation,
    readEip7702Capability,
    readWriteContractAsync,
    ensurePreferredWallet,
  });

  /** Try 7702 → silent → wallet-write, in order of preference. */
  const placeBetsPreferSilent = useCallback(
    async (
      tiles: number[],
      singleAmountRaw: bigint,
      gasOverrides?: GasOverrides,
      txNonce?: number,
    ): Promise<ReceiptState> => {
      // --- EIP-7702 path (highest priority when enabled) ---
      if (EIP7702_MINING_ENABLED) {
        const cap = readEip7702Capability?.();
        if (cap?.mode === "ready" && canAttemptEip7702()) {
          try {
            return await placeBets7702(tiles, singleAmountRaw, gasOverrides, txNonce);
          } catch (error) {
            log.warn("Mine", "7702 delegated send failed, falling back to silent", error);
          }
        }
      }

      // --- Standard silent path ---
      const silentSend = readSilentSend();
      if (silentSend) {
        try {
          return await placeBetsSilent(tiles, singleAmountRaw, gasOverrides, txNonce);
        } catch (error) {
          log.warn("Mine", "silent send failed, fallback to wallet write", error);
        }
      }

      // --- Wallet write fallback ---
      return placeBets(tiles, singleAmountRaw, gasOverrides, txNonce);
    },
    [placeBets, placeBetsSilent, placeBets7702, readSilentSend, readEip7702Capability],
  );

  return {
    placeBets,
    placeBetsSilent,
    placeBets7702,
    placeBetsPreferSilent,
  };
}
