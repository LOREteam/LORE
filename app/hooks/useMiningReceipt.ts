"use client";

import { useCallback } from "react";
import type { MutableRefObject } from "react";
import type { PublicClient } from "viem";
import { TX_RECEIPT_TIMEOUT_MS } from "../lib/constants";
import type { ReceiptState } from "./useMining.stateTypes";

interface UseMiningReceiptOptions {
  publicClientRef: MutableRefObject<PublicClient | undefined>;
}

export function useMiningReceipt({ publicClientRef }: UseMiningReceiptOptions) {
  return useCallback(
    async (hash: `0x${string}`, clientOverride?: PublicClient): Promise<ReceiptState> => {
      const client = clientOverride ?? publicClientRef.current;
      if (!client) throw new Error("Public client unavailable");

      try {
        const receipt = await client.waitForTransactionReceipt({ hash, timeout: TX_RECEIPT_TIMEOUT_MS });
        if (receipt && typeof receipt === "object" && "status" in receipt && receipt.status === "reverted") {
          const outOfGas = "gasUsed" in receipt && "gas" in receipt && receipt.gasUsed === receipt.gas;
          throw new Error(
            outOfGas
              ? `Transaction ran out of gas (hash: ${hash})`
              : `Transaction reverted (hash: ${hash})`,
          );
        }
        return "confirmed";
      } catch (error) {
        try {
          const lateReceipt = await client.getTransactionReceipt({ hash });
          if (lateReceipt.status === "reverted") {
            const transaction = await client.getTransaction({ hash }).catch(() => null);
            const outOfGas = transaction && lateReceipt.gasUsed === transaction.gas;
            throw new Error(
              outOfGas
                ? `Transaction ran out of gas (hash: ${hash})`
                : `Transaction reverted (hash: ${hash})`,
            );
          }
          return "confirmed";
        } catch {
          const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
          const name = error instanceof Error ? error.name : "";
          if (
            name === "TimeoutError" ||
            name === "TransactionReceiptNotFoundError" ||
            message.includes("timed out") ||
            message.includes("timeout") ||
            message.includes("receipt could not be found")
          ) {
            try {
              await client.getTransaction({ hash });
              return "pending";
            } catch {
              const timeoutError = new Error(`Transaction receipt timed out (hash: ${hash})`);
              timeoutError.name = "TransactionReceiptTimeoutError";
              throw timeoutError;
            }
          }
          throw error;
        }
      }
    },
    [publicClientRef],
  );
}
