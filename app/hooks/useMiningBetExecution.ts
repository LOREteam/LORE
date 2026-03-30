"use client";

import { useCallback, useRef } from "react";
import { encodeFunctionData } from "viem";
import type { PublicClient } from "viem";
import { APP_CHAIN_ID, CONTRACT_ADDRESS, GAME_ABI } from "../lib/constants";
import { log } from "../lib/logger";
import { isAmbiguousPendingTxError, isSessionExpiredError, normalizeTiles } from "./useMining.shared";

type GasOverrides = { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } | { gasPrice?: bigint };
type ReceiptState = "confirmed" | "pending";
type SilentSendFn = (
  tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint; nonce?: number },
  gasOverrides?: GasOverrides,
) => Promise<`0x${string}`>;

function isMissingMethodError(error: unknown, methodName: string) {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const normalizedMethod = methodName.toLowerCase();
  const quotedMethod = `function "${normalizedMethod}"`;
  return (
    msg.includes(`${quotedMethod} returned no data`) ||
    msg.includes(`${quotedMethod} is not in the abi`) ||
    msg.includes(`does not have the function "${normalizedMethod}"`) ||
    msg.includes("returned no data (\"0x\")")
  );
}

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
  waitReceipt,
  readPublicClient,
  readSilentSend,
  readWriteContractAsync,
  ensurePreferredWallet,
}: UseMiningBetExecutionOptions) {
  const batchSameAmountSupportedRef = useRef<boolean | null>(null);

  const placeBets = useCallback(
    async (
      tiles: number[],
      singleAmountRaw: bigint,
      gasOverrides?: GasOverrides,
      txNonce?: number,
    ): Promise<ReceiptState> => {
      const normalizedTiles = normalizeTiles(tiles);
      if (normalizedTiles.length === 0) throw new Error("No valid tiles selected");
      await ensurePreferredWallet();
      await ensureContractPreflight();
      const totalAmountRaw = singleAmountRaw * BigInt(normalizedTiles.length);
      await ensureAllowance(totalAmountRaw);
      await assertSufficientAllowance(totalAmountRaw);
      const overrides = gasOverrides ?? (await getBumpedFees());
      const writeContractAsync = readWriteContractAsync();

      if (normalizedTiles.length === 1) {
        const gas = await estimateGas("placeBet", [BigInt(normalizedTiles[0]), singleAmountRaw], BigInt(60000));
        await assertNativeGasBalance(gas, overrides);
        const txHash = await writeContractAsync({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "placeBet",
          args: [BigInt(normalizedTiles[0]), singleAmountRaw],
          chainId: APP_CHAIN_ID,
          gas,
          ...(txNonce !== undefined ? { nonce: txNonce } : {}),
          ...(overrides ?? {}),
        });
        return waitReceipt(txHash);
      }

      const tileArgs = normalizedTiles.map((id) => BigInt(id));

      if (batchSameAmountSupportedRef.current !== false) {
        try {
          const gas = await estimateGas("placeBatchBetsSameAmount", [tileArgs, singleAmountRaw], BigInt(90_000));
          await assertNativeGasBalance(gas, overrides);
          const txHash = await writeContractAsync({
            address: CONTRACT_ADDRESS,
            abi: GAME_ABI,
            functionName: "placeBatchBetsSameAmount",
            args: [tileArgs, singleAmountRaw],
            chainId: APP_CHAIN_ID,
            gas,
            ...(txNonce !== undefined ? { nonce: txNonce } : {}),
            ...(overrides ?? {}),
          });
          batchSameAmountSupportedRef.current = true;
          return waitReceipt(txHash);
        } catch (error) {
          if (!isMissingMethodError(error, "placeBatchBetsSameAmount")) {
            throw error;
          }
          batchSameAmountSupportedRef.current = false;
          log.warn("Mine", "placeBatchBetsSameAmount unavailable on current contract, fallback to placeBatchBets", error);
        }
      }

      const amountArgs = normalizedTiles.map(() => singleAmountRaw);
      const gas = await estimateGas("placeBatchBets", [tileArgs, amountArgs], BigInt(120_000));
      await assertNativeGasBalance(gas, overrides);
      const txHash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "placeBatchBets",
        args: [tileArgs, amountArgs],
        chainId: APP_CHAIN_ID,
        gas,
        ...(txNonce !== undefined ? { nonce: txNonce } : {}),
        ...(overrides ?? {}),
      });
      return waitReceipt(txHash);
    },
    [
      assertNativeGasBalance,
      assertSufficientAllowance,
      ensureAllowance,
      ensureContractPreflight,
      ensurePreferredWallet,
      estimateGas,
      getBumpedFees,
      readWriteContractAsync,
      waitReceipt,
    ],
  );

  const placeBetsSilent = useCallback(
    async (
      tiles: number[],
      singleAmountRaw: bigint,
      gasOverrides?: GasOverrides,
      txNonce?: number,
    ): Promise<ReceiptState> => {
      const normalizedTiles = normalizeTiles(tiles);
      if (normalizedTiles.length === 0) throw new Error("No valid tiles selected");
      await ensurePreferredWallet();
      await ensureContractPreflight();
      const totalAmountRaw = singleAmountRaw * BigInt(normalizedTiles.length);
      await ensureAllowance(totalAmountRaw);
      await assertSufficientAllowance(totalAmountRaw);

      const client = readPublicClient();
      const silentSend = readSilentSend();
      if (!client || !silentSend) throw new Error("Privy wallet not ready");

      let data: `0x${string}` | undefined;
      let gas: bigint | undefined;

      if (normalizedTiles.length === 1) {
        gas = await estimateGas("placeBet", [BigInt(normalizedTiles[0]), singleAmountRaw], BigInt(140000));
        data = encodeFunctionData({
          abi: GAME_ABI,
          functionName: "placeBet",
          args: [BigInt(normalizedTiles[0]), singleAmountRaw],
        });
      } else {
        const tileArgs = normalizedTiles.map((id) => BigInt(id));

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
            log.warn("Mine", "silent placeBatchBetsSameAmount unavailable on current contract, fallback to placeBatchBets", error);
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

      let hash: `0x${string}`;
      try {
        hash = await silentSend(
          {
            to: CONTRACT_ADDRESS,
            data,
            gas,
            ...(txNonce !== undefined ? { nonce: txNonce } : {}),
          },
          gasOverrides,
        );
      } catch (error) {
        if (isAmbiguousPendingTxError(error)) {
          log.warn("Mine", "silent send may already be pending, avoiding duplicate wallet fallback", error);
          return "pending";
        }
        throw error;
      }

      return waitReceipt(hash, client);
    },
    [
      assertNativeGasBalance,
      assertSufficientAllowance,
      ensureAllowance,
      ensureContractPreflight,
      ensurePreferredWallet,
      estimateGas,
      readPublicClient,
      readSilentSend,
      waitReceipt,
    ],
  );

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
          if (isSessionExpiredError(error)) throw error;
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
