"use client";

import { useCallback, useMemo } from "react";
import { log } from "../lib/logger";
import { runManualMineAttempt } from "../lib/mining/manualMineAttempt";
import { clearMiningTxPathState } from "../lib/miningTxPath";
import { isUserRejection } from "../lib/utils";
import {
  getBetErrorMessage,
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
    ) =>
      runManualMineAttempt({
        actorAddress,
        betAmountStr,
        checkBetAlreadyConfirmed,
        ensureAllowance,
        finalizeMineSuccess,
        getBumpedFees,
        normalizedTiles,
        placeBetsPreferSilent,
        source,
      }),
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

  return useMemo(
    () => ({
      handleDirectMine,
      handleManualMine,
    }),
    [handleDirectMine, handleManualMine],
  );
}
