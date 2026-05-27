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
      const isReceiptTimeoutLike = (value: unknown) => {
        const message = value instanceof Error ? value.message.toLowerCase() : String(value).toLowerCase();
        const name = value instanceof Error ? value.name : "";
        return (
          name === "TimeoutError" ||
          name === "TransactionReceiptNotFoundError" ||
          message.includes("timed out") ||
          message.includes("timeout") ||
          message.includes("receipt could not be found")
        );
      };
      const isTxLookupMissing = (value: unknown) => {
        const message = value instanceof Error ? value.message.toLowerCase() : String(value).toLowerCase();
        const name = value instanceof Error ? value.name : "";
        return (
          name === "TransactionNotFoundError" ||
          message.includes("transaction not found") ||
          message.includes("transaction could not be found")
        );
      };

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
        } catch (lateReceiptError) {
          if (isReceiptTimeoutLike(error)) {
            try {
              await client.getTransaction({ hash });
              return "pending";
            } catch (txLookupError) {
              if (!isTxLookupMissing(txLookupError)) {
                throw txLookupError;
              }
              const timeoutError = new Error(`Transaction receipt timed out (hash: ${hash})`);
              timeoutError.name = "TransactionReceiptTimeoutError";
              throw timeoutError;
            }
          }
          if (!isTxLookupMissing(lateReceiptError)) {
            throw lateReceiptError;
          }
          throw error;
        }
      }
    },
    [publicClientRef],
  );
}
