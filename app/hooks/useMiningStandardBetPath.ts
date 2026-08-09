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
import { log } from "../lib/logger";
import {
  clearPendingMiningTxState,
  readPendingMiningTxState,
  recoverPendingMiningTx,
  writeMiningTxPathState,
  writePendingMiningTxState,
} from "../lib/miningTxPath";
import { tileIdsToMask } from "../lib/tileMask";
import type { GasOverrides, SilentSendFn } from "./useMining.types";
import type { ReceiptState } from "./useMining.stateTypes";
import { isAmbiguousPendingTxError, normalizeTiles, withMiningRpcTimeout } from "./useMining.shared";

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

interface UseMiningStandardBetPathOptions {
  assertNativeGasBalance: (gas: bigint, gasOverrides?: GasOverrides) => Promise<void>;
  assertSufficientAllowance: (requiredRaw: bigint) => Promise<void>;
  ensureAllowance: (requiredRaw: bigint) => Promise<void>;
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
  waitReceipt: (hash: `0x${string}`, client?: PublicClient) => Promise<ReceiptState>;
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

  const resolveExpectedEpoch = useCallback(
    async (expectedEpoch?: bigint) => {
      if (expectedEpoch !== undefined) return expectedEpoch;
      const client = readPublicClient();
      if (!client) throw new Error("Public client not ready for epoch-bound bet.");
      return (await withMiningRpcTimeout(
        client.readContract({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "currentEpoch",
        }),
        "bet.currentEpochBeforeSend",
        8_000,
      )) as bigint;
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
      const client = readPublicClient();
      if (!client) return "pending";
      const recovery = await recoverPendingMiningTx(client, state);
      if (recovery === "pending") return "pending";
      clearPendingMiningTxState(APP_CHAIN_ID, CONTRACT_ADDRESS, actor);
      return null;
    },
    [getActorAddress, readPublicClient],
  );

  const waitTrackedReceipt = useCallback(
    async (
      hash: `0x${string}`,
      client?: PublicClient,
      nonce?: number,
    ): Promise<ReceiptState> => {
      log.info("Mine", "bet transaction submitted", {
        hash,
        nonce: nonce ?? null,
      });
      const actor = getActorAddress();
      if (actor) {
        writePendingMiningTxState({
          chainId: APP_CHAIN_ID,
          contract: CONTRACT_ADDRESS,
          actor: actor as `0x${string}`,
          hash,
          ...(nonce !== undefined ? { nonce } : {}),
        });
      }
      const state = await waitReceipt(hash, client);
      if (state === "confirmed" && actor) {
        clearPendingMiningTxState(APP_CHAIN_ID, CONTRACT_ADDRESS, actor);
      }
      return state;
    },
    [getActorAddress, waitReceipt],
  );

  const placeBets = useCallback(
    async (
      tiles: number[],
      singleAmountRaw: bigint,
      gasOverrides?: GasOverrides,
      txNonce?: number,
      expectedEpoch?: bigint,
    ): Promise<ReceiptState> => {
      const normalizedTiles = normalizeTiles(tiles);
      if (normalizedTiles.length === 0) throw new Error("No valid tiles selected");
      await ensurePreferredWallet();
      await ensureContractPreflight();
      const recoveredPending = await recoverTrackedPending();
      if (recoveredPending) return recoveredPending;
      const totalAmountRaw = singleAmountRaw * BigInt(normalizedTiles.length);
      await ensureAllowance(totalAmountRaw);
      await assertSufficientAllowance(totalAmountRaw);
      const overrides = gasOverrides ?? (await getBumpedFees());
      const writeContractAsync = readWriteContractAsync();
      const tileMask = tileIdsToMask(normalizedTiles);

      if (await supportsEpochBoundBitmap()) {
        const targetEpoch = await resolveExpectedEpoch(expectedEpoch);
        const gas = await estimateGas(
          "placeBatchBetsBitmapForEpoch",
          [targetEpoch, tileMask, singleAmountRaw],
          BigInt(80_000),
        );
        await assertNativeGasBalance(gas, overrides);
        const txHash = await writeContractAsync({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "placeBatchBetsBitmapForEpoch",
          args: [targetEpoch, tileMask, singleAmountRaw],
          chainId: APP_CHAIN_ID,
          gas,
          ...(txNonce !== undefined ? { nonce: txNonce } : {}),
          ...(overrides ?? {}),
        });
        writeMiningTxPathState("wallet-write", "direct-wallet");
        return waitTrackedReceipt(txHash, undefined, txNonce);
      }

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
        writeMiningTxPathState("wallet-write", "direct-wallet");
        return waitTrackedReceipt(txHash, undefined, txNonce);
      }

      const tileArgs = normalizedTiles.map((id) => BigInt(id));

      if (batchBitmapSupportedRef.current !== false) {
        try {
          const gas = await estimateGas("placeBatchBetsBitmap", [tileMask, singleAmountRaw], BigInt(80_000));
          await assertNativeGasBalance(gas, overrides);
          const txHash = await writeContractAsync({
            address: CONTRACT_ADDRESS,
            abi: GAME_ABI,
            functionName: "placeBatchBetsBitmap",
            args: [tileMask, singleAmountRaw],
            chainId: APP_CHAIN_ID,
            gas,
            ...(txNonce !== undefined ? { nonce: txNonce } : {}),
            ...(overrides ?? {}),
          });
          batchBitmapSupportedRef.current = true;
          writeMiningTxPathState("wallet-write", "direct-wallet");
          return waitTrackedReceipt(txHash, undefined, txNonce);
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
          writeMiningTxPathState("wallet-write", "direct-wallet");
          return waitTrackedReceipt(txHash, undefined, txNonce);
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
      writeMiningTxPathState("wallet-write", "direct-wallet");
      return waitTrackedReceipt(txHash, undefined, txNonce);
    },
    [
      assertNativeGasBalance,
      assertSufficientAllowance,
      ensureAllowance,
      ensureContractPreflight,
      ensurePreferredWallet,
      estimateGas,
      getBumpedFees,
      recoverTrackedPending,
      readWriteContractAsync,
      resolveExpectedEpoch,
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

      const totalAmountRaw = singleAmountRaw * BigInt(normalizedTiles.length);
      await ensureAllowance(totalAmountRaw);
      await assertSufficientAllowance(totalAmountRaw);

      let data: `0x${string}` | undefined;
      let gas: bigint | undefined;
      const tileMask = tileIdsToMask(normalizedTiles);

      if (await supportsEpochBoundBitmap()) {
        const targetEpoch = await resolveExpectedEpoch(expectedEpoch);
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

      let hash: `0x${string}`;
      const actor = getActorAddress();
      const effectiveNonce = txNonce ?? (actor
        ? Number(await client.getTransactionCount({ address: actor as `0x${string}`, blockTag: "pending" }))
        : undefined);
      try {
        hash = await silentSend(
          {
            to: CONTRACT_ADDRESS,
            data,
            gas,
            ...(effectiveNonce !== undefined ? { nonce: effectiveNonce } : {}),
          },
          gasOverrides,
        );
        writeMiningTxPathState("standard-silent", "legacy-silent");
        log.info("Mine", "using standard silent bet path", {
          tileCount: normalizedTiles.length,
          totalAmountRaw,
          hash,
        });
      } catch (error) {
        if (isAmbiguousPendingTxError(error)) {
          if (actor && effectiveNonce !== undefined) {
            writePendingMiningTxState({
              chainId: APP_CHAIN_ID,
              contract: CONTRACT_ADDRESS,
              actor: actor as `0x${string}`,
              nonce: effectiveNonce,
            });
          }
          log.warn("Mine", "silent send may already be pending, avoiding duplicate wallet fallback", error);
          return "pending";
        }
        throw error;
      }

      return waitTrackedReceipt(hash, client, effectiveNonce);
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
      readSilentSend,
      recoverTrackedPending,
      resolveExpectedEpoch,
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
