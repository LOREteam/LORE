"use client";

import { useCallback } from "react";
import { parseUnits } from "viem";
import { log } from "../lib/logger";
import { clearMiningTxPathState } from "../lib/miningTxPath";
import { delay, isUserRejection, normalizeDecimalInput } from "../lib/utils";
import {
  getBetErrorMessage,
  isAllowanceError,
  isReceiptTimeoutError,
  isRetryableError,
  normalizeTiles,
} from "./useMining.shared";
import type { GasOverrides } from "./useMining.types";

type MineAttemptSource = "ManualMine" | "DirectMine";
type NotifyFn = (message: string, tone?: "info" | "success" | "warning" | "danger") => void;

interface UseMiningManualActionsOptions {
  autoMineActive: () => boolean;
  checkBetAlreadyConfirmed: (actorAddress: string, normalizedTiles: number[]) => Promise<boolean>;
  ensureAllowance: (requiredAmount: bigint) => Promise<void>;
  finalizeMineSuccess: () => void;
  getActorAddress: () => string | null;
  getBumpedFees: (stepBps?: bigint) => Promise<GasOverrides | undefined>;
  notify?: NotifyFn;
  placeBetsPreferSilent: (
    tileIds: number[],
    amountRawPerTile: bigint,
    gasOverrides?: GasOverrides,
  ) => Promise<"confirmed" | "pending">;
  selectedTiles: number[];
  setIsPending: (value: boolean) => void;
  setSelectedTiles: (tiles: number[]) => void;
  setSelectedTilesEpoch: (epoch: string | null) => void;
}

export function useMiningManualActions({
  autoMineActive,
  checkBetAlreadyConfirmed,
  ensureAllowance,
  finalizeMineSuccess,
  getActorAddress,
  getBumpedFees,
  notify,
  placeBetsPreferSilent,
  selectedTiles,
  setIsPending,
  setSelectedTiles,
  setSelectedTilesEpoch,
}: UseMiningManualActionsOptions) {
  const submitMineAttempt = useCallback(
    async (
      source: MineAttemptSource,
      normalizedTiles: number[],
      betAmountStr: string,
      actorAddress: string,
    ) => {
      const normalized = normalizeDecimalInput(betAmountStr);
      const parsed = Number(normalized);
      if (!normalized || Number.isNaN(parsed) || parsed <= 0) throw new Error("Invalid bet amount");

      const singleAmountRaw = parseUnits(normalized, 18);
      const totalAmountRaw = singleAmountRaw * BigInt(normalizedTiles.length);

      try {
        const state = await placeBetsPreferSilent(normalizedTiles, singleAmountRaw);
        if (state === "pending") {
          log.warn(source, "bet tx is pending, skip immediate retry");
          finalizeMineSuccess();
          return true;
        }
      } catch (error) {
        if (!isRetryableError(error)) throw error;
        if (isAllowanceError(error)) {
          await ensureAllowance(totalAmountRaw);
        }
        if (isReceiptTimeoutError(error)) {
          log.warn(source, "bet receipt timeout, avoid duplicate resend");
          finalizeMineSuccess();
          return true;
        }
        const alreadyConfirmed = await checkBetAlreadyConfirmed(actorAddress, normalizedTiles);
        if (alreadyConfirmed) {
          log.info(source, "skipping retry - bets already on-chain", {
            confirmedTiles: normalizedTiles.length,
          });
          finalizeMineSuccess();
          return true;
        }
        await delay(1500);
        const bumpedFees = await getBumpedFees(BigInt(130));
        const retryState = await placeBetsPreferSilent(normalizedTiles, singleAmountRaw, bumpedFees);
        if (retryState === "pending") {
          log.warn(source, "retry bet tx still pending, skip additional resend");
        }
      }

      finalizeMineSuccess();
      return true;
    },
    [
      checkBetAlreadyConfirmed,
      ensureAllowance,
      finalizeMineSuccess,
      getBumpedFees,
      placeBetsPreferSilent,
    ],
  );

  const handleManualMine = useCallback(
    async (betAmountStr: string) => {
      const normalizedTiles = normalizeTiles(selectedTiles);
      if (normalizedTiles.length === 0) return false;
      const actorAddress = getActorAddress();
      if (!actorAddress) {
        notify?.("Wallet not ready. Reconnect wallet and try again.", "danger");
        return false;
      }
      setIsPending(true);
      try {
        return await submitMineAttempt("ManualMine", normalizedTiles, betAmountStr, actorAddress);
      } catch (error) {
        if (!isUserRejection(error)) {
          clearMiningTxPathState();
          const reason = getBetErrorMessage(error);
          log.warn("ManualMine", "bet failed", { reason });
          notify?.(reason, "danger");
        }
        return false;
      } finally {
        setIsPending(false);
      }
    },
    [selectedTiles, getActorAddress, notify, setIsPending, submitMineAttempt],
  );

  const handleDirectMine = useCallback(
    async (tiles: number[], betAmountStr: string) => {
      const normalizedTiles = normalizeTiles(tiles);
      if (normalizedTiles.length === 0) return false;
      const actorAddress = getActorAddress();
      if (!actorAddress) {
        notify?.("Wallet not ready. Reconnect wallet and try again.", "danger");
        return false;
      }
      if (autoMineActive()) return false;
      setSelectedTiles(normalizedTiles);
      setSelectedTilesEpoch(null);
      setIsPending(true);
      try {
        return await submitMineAttempt("DirectMine", normalizedTiles, betAmountStr, actorAddress);
      } catch (error) {
        if (!isUserRejection(error)) {
          clearMiningTxPathState();
          const reason = getBetErrorMessage(error);
          log.warn("DirectMine", "bet failed", { reason });
          notify?.(reason, "danger");
        }
        return false;
      } finally {
        setIsPending(false);
      }
    },
    [
      autoMineActive,
      getActorAddress,
      notify,
      setIsPending,
      setSelectedTiles,
      setSelectedTilesEpoch,
      submitMineAttempt,
    ],
  );

  return {
    handleDirectMine,
    handleManualMine,
  };
}
