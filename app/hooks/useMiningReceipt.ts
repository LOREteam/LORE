"use client";

import { useCallback, useMemo } from "react";
import type { MutableRefObject } from "react";
import type { PublicClient } from "viem";
import { TX_RECEIPT_TIMEOUT_MS } from "../lib/constants";
import {
  createPendingMiningAgreementClients,
  recoverPendingMiningTx,
  waitForPendingMiningReceiptAgreement,
  type PendingMiningTxState,
} from "../lib/miningTxPath";
import type { ReceiptState } from "./useMining.stateTypes";

interface UseMiningReceiptOptions {
  publicClientRef: MutableRefObject<PublicClient | undefined>;
}

export function useMiningReceipt({ publicClientRef }: UseMiningReceiptOptions) {
  const agreementClients = useMemo(() => createPendingMiningAgreementClients(), []);
  return useCallback(
    async (
      hash: `0x${string}`,
      clientOverride?: PublicClient,
      pendingState?: PendingMiningTxState,
    ): Promise<ReceiptState> => {
      // A caller-provided fallback transport is intentionally not authoritative:
      // mining completion requires two configured, distinct RPC origins.
      void clientOverride;
      if (!agreementClients || !publicClientRef.current) {
        throw new Error("Two independent public clients are required for mining receipt verification.");
      }
      const receiptState = await waitForPendingMiningReceiptAgreement(
        agreementClients,
        hash,
        TX_RECEIPT_TIMEOUT_MS,
      );
      if (receiptState === "pending" || !pendingState) return receiptState;
      const recovery = await recoverPendingMiningTx(agreementClients, pendingState);
      if (recovery === "confirmed") return "confirmed";
      if (recovery === "clear") {
        throw new Error(`Transaction reverted (hash: ${hash})`);
      }
      return "pending";
    },
    [agreementClients, publicClientRef],
  );
}
