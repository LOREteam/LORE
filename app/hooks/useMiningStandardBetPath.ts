"use client";

import { useCallback, useMemo, useRef } from "react";
import { encodeFunctionData, maxUint256 } from "viem";
import type { PublicClient } from "viem";
import { APP_CHAIN_ID, CONTRACT_ADDRESS, GAME_ABI } from "../lib/constants";
import { log } from "../lib/logger";
import { writeMiningTxPathState } from "../lib/miningTxPath";
import {
  buildApproveAndBet7702Call,
  buildBet7702Call,
  type Eip7702CapabilityState,
} from "../lib/eip7702";
import { canAttemptEip7702, noteEip7702Failure, noteEip7702Success } from "../lib/eip7702Runtime";
import type { GasOverrides, SilentSendFn, SilentSend7702Fn, Sign7702DelegationFn } from "./useMining.types";
import type { ReceiptState } from "./useMining.stateTypes";
import { isAmbiguousPendingTxError, normalizeTiles } from "./useMining.shared";

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
    functionName: "placeBet" | "placeBatchBets" | "placeBatchBetsSameAmount",
    args: readonly unknown[],
    extraBuffer: bigint,
  ) => Promise<bigint>;
  getBumpedFees: (bumpBps?: bigint) => Promise<GasOverrides | undefined>;
  waitReceipt: (hash: `0x${string}`, client?: PublicClient) => Promise<ReceiptState>;
  readPublicClient: () => PublicClient | undefined;
  readSilentSend: () => SilentSendFn | undefined;
  readSilentSend7702?: () => SilentSend7702Fn | undefined;
  readSignEip7702Delegation?: () => Sign7702DelegationFn | undefined;
  readEip7702Capability?: () => Eip7702CapabilityState | undefined;
  readWriteContractAsync: () => (args: unknown) => Promise<`0x${string}`>;
  ensurePreferredWallet: () => Promise<void> | void;
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
  readSilentSend7702,
  readSignEip7702Delegation,
  readEip7702Capability,
  readWriteContractAsync,
  ensurePreferredWallet,
}: UseMiningStandardBetPathOptions) {
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
        writeMiningTxPathState("wallet-write", "direct-wallet");
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
          writeMiningTxPathState("wallet-write", "direct-wallet");
          return waitReceipt(txHash);
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

      const client = readPublicClient();
      const silentSend = readSilentSend();
      if (!client || !silentSend) throw new Error("Privy wallet not ready");

      const totalAmountRaw = singleAmountRaw * BigInt(normalizedTiles.length);

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

      await ensureAllowance(totalAmountRaw);
      await assertSufficientAllowance(totalAmountRaw);

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
        writeMiningTxPathState("standard-silent", "legacy-silent");
        log.info("Mine", "using standard silent bet path", {
          tileCount: normalizedTiles.length,
          totalAmountRaw,
          hash,
        });
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

  /**
   * EIP-7702 delegated bet path.
   * Signs a 7702 delegation, builds calldata for the delegate contract,
   * estimates gas WITH authorizationList, and sends a type-4 transaction.
   * Falls back gracefully: caller should catch and use placeBetsSilent.
   */
  const placeBets7702 = useCallback(
    async (
      tiles: number[],
      singleAmountRaw: bigint,
      gasOverrides?: GasOverrides,
      txNonce?: number,
    ): Promise<ReceiptState> => {
      const normalizedTiles = normalizeTiles(tiles);
      if (normalizedTiles.length === 0) throw new Error("No valid tiles selected");

      const send7702 = readSilentSend7702?.();
      const signDelegation = readSignEip7702Delegation?.();
      const cap = readEip7702Capability?.();
      if (!send7702 || !signDelegation || !cap || cap.mode !== "ready") {
        throw new Error("EIP-7702 is not available.");
      }
      if (!canAttemptEip7702()) {
        throw new Error("EIP-7702 is in cooldown after recent failures.");
      }

      await ensurePreferredWallet();
      await ensureContractPreflight();

      const client = readPublicClient();
      if (!client) throw new Error("Public client not ready for 7702 gas estimation.");

      const totalAmountRaw = singleAmountRaw * BigInt(normalizedTiles.length);

      // 1. Sign delegation once and reuse it for the selected execution path.
      const authorization = await signDelegation("self");

      const sendDelegatedCall = async (
        data: `0x${string}`,
        txPath: "approve+bet" | "bet-only",
      ): Promise<ReceiptState> => {
        const signerAddress = authorization.address;
        let estimatedGas: bigint;
        try {
          estimatedGas = await (client as unknown as {
            estimateGas: (args: Record<string, unknown>) => Promise<bigint>;
          }).estimateGas({
            account: signerAddress,
            to: signerAddress,
            data,
            authorizationList: [authorization],
          });
        } catch (estimateError) {
          const msg = estimateError instanceof Error ? estimateError.message : String(estimateError);
          log.warn("Mine", `7702 gas estimation reverted for ${txPath}`, { error: msg });
          throw new Error(`7702 gas estimation failed: ${msg.slice(0, 200)}`);
        }

        const gas = estimatedGas + 60_000n;
        await assertNativeGasBalance(gas, gasOverrides);

        try {
          const hash = await send7702(
            {
              data,
              gas,
              authorizationList: [authorization],
              ...(txNonce !== undefined ? { nonce: txNonce } : {}),
            },
            gasOverrides,
          );
          noteEip7702Success();
          writeMiningTxPathState("7702-delegated", txPath);
          log.info("Mine", "7702 delegated bet sent", {
            path: txPath,
            tileCount: normalizedTiles.length,
            totalAmountRaw,
            hash,
          });
          return waitReceipt(hash, client);
        } catch (error) {
          if (isAmbiguousPendingTxError(error)) {
            log.warn("Mine", `7702 ${txPath} send may already be pending`, error);
            return "pending";
          }
          throw error;
        }
      };

      try {
        await assertSufficientAllowance(totalAmountRaw);
        return await sendDelegatedCall(
          buildBet7702Call(normalizedTiles, singleAmountRaw),
          "bet-only",
        );
      } catch (allowanceError) {
        log.info("Mine", "7702 allowance missing, trying atomic approve+bet", {
          error: allowanceError instanceof Error ? allowanceError.message : String(allowanceError),
        });
      }

      try {
        return await sendDelegatedCall(
          buildApproveAndBet7702Call(
            normalizedTiles,
            singleAmountRaw,
            maxUint256,
          ),
          "approve+bet",
        );
      } catch (approveAndBetError) {
        log.warn("Mine", "7702 approve+bet failed, falling back to regular approve then delegated bet", approveAndBetError);
      }

      try {
        await ensureAllowance(totalAmountRaw);
        await assertSufficientAllowance(totalAmountRaw);
        return await sendDelegatedCall(
          buildBet7702Call(normalizedTiles, singleAmountRaw),
          "bet-only",
        );
      } catch (finalError) {
        noteEip7702Failure("send-failed");
        throw finalError;
      }
    },
    [
      assertNativeGasBalance,
      assertSufficientAllowance,
      ensureAllowance,
      ensureContractPreflight,
      ensurePreferredWallet,
      readEip7702Capability,
      readPublicClient,
      readSignEip7702Delegation,
      readSilentSend7702,
      waitReceipt,
    ],
  );

  return useMemo(
    () => ({
      placeBets,
      placeBetsSilent,
      placeBets7702,
    }),
    [placeBets, placeBetsSilent, placeBets7702],
  );
}
