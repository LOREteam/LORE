"use client";

import { useCallback, useMemo, useRef } from "react";
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
  prepareBetConfirmation: (
    actorAddress: string,
    normalizedTiles: number[],
    expectedEpoch: bigint,
    amountRawPerTile: bigint,
  ) => Promise<() => Promise<boolean>>;
  ensureAllowance: (requiredAmount: bigint) => Promise<void>;
  finalizeMineSuccess: () => void;
  getActorAddress: () => string | null;
  getBumpedFees: (stepBps?: bigint) => Promise<GasOverrides | undefined>;
  notify?: NotifyFn;
  placeBetsPreferSilent: (
    tileIds: number[],
    amountRawPerTile: bigint,
    gasOverrides?: GasOverrides,
    txNonce?: number,
    expectedEpoch?: bigint,
  ) => Promise<"confirmed" | "pending">;
  selectedTiles: number[];
  setIsPending: (value: boolean) => void;
  setSelectedTiles: (tiles: number[]) => void;
  setSelectedTilesEpoch: (epoch: string | null) => void;
}

export function useMiningManualActions({
  autoMineActive,
  prepareBetConfirmation,
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
  const manualMineInFlightRef = useRef(false);

  const submitMineAttempt = useCallback(
    async (
      source: MineAttemptSource,
      normalizedTiles: number[],
      betAmountStr: string,
      actorAddress: string,
      expectedEpoch: bigint,
    ) =>
      runManualMineAttempt({
        actorAddress,
        betAmountStr,
        ensureAllowance,
        expectedEpoch,
        finalizeMineSuccess,
        getBumpedFees,
        normalizedTiles,
        placeBetsPreferSilent,
        prepareBetConfirmation,
        source,
      }),
    [
      ensureAllowance,
      finalizeMineSuccess,
      getBumpedFees,
      placeBetsPreferSilent,
      prepareBetConfirmation,
    ],
  );

  const handleManualMine = useCallback(
    async (betAmountStr: string, expectedEpoch: bigint | null | undefined) => {
      const normalizedTiles = normalizeTiles(selectedTiles);
      if (normalizedTiles.length === 0) return false;
      if (expectedEpoch == null) {
        notify?.("Live epoch is still syncing.", "warning");
        return false;
      }
      const actorAddress = getActorAddress();
      if (!actorAddress) {
        notify?.("Wallet not ready. Reconnect wallet and try again.", "danger");
        return false;
      }
      if (autoMineActive() || manualMineInFlightRef.current) return false;
      manualMineInFlightRef.current = true;
      setIsPending(true);
      try {
        const state = await submitMineAttempt("ManualMine", normalizedTiles, betAmountStr, actorAddress, expectedEpoch);
        if (state === "pending") {
          notify?.("Bet transaction is still pending. Check wallet activity before retrying.", "warning");
        }
        return state;
      } catch (error) {
        if (!isUserRejection(error)) {
          clearMiningTxPathState();
          const reason = getBetErrorMessage(error);
          log.warn("ManualMine", "bet failed", error);
          notify?.(reason, "danger");
        } else {
          notify?.("Bet transaction rejected in wallet.", "info");
        }
        return false;
      } finally {
        manualMineInFlightRef.current = false;
        setIsPending(false);
      }
    },
    [autoMineActive, selectedTiles, getActorAddress, notify, setIsPending, submitMineAttempt],
  );

  const handleDirectMine = useCallback(
    async (tiles: number[], betAmountStr: string, expectedEpoch: bigint | null | undefined) => {
      const normalizedTiles = normalizeTiles(tiles);
      if (normalizedTiles.length === 0) return false;
      if (expectedEpoch == null) {
        notify?.("Live epoch is still syncing.", "warning");
        return false;
      }
      const actorAddress = getActorAddress();
      if (!actorAddress) {
        notify?.("Wallet not ready. Reconnect wallet and try again.", "danger");
        return false;
      }
      if (autoMineActive() || manualMineInFlightRef.current) return false;
      setSelectedTiles(normalizedTiles);
      setSelectedTilesEpoch(null);
      manualMineInFlightRef.current = true;
      setIsPending(true);
      try {
        const state = await submitMineAttempt("DirectMine", normalizedTiles, betAmountStr, actorAddress, expectedEpoch);
        if (state === "pending") {
          notify?.("Repeat bet transaction is still pending. Check wallet activity before retrying.", "warning");
        }
        return state;
      } catch (error) {
        if (!isUserRejection(error)) {
          clearMiningTxPathState();
          const reason = getBetErrorMessage(error);
          log.warn("DirectMine", "bet failed", error);
          notify?.(reason, "danger");
        } else {
          notify?.("Repeat bet transaction rejected in wallet.", "info");
        }
        return false;
      } finally {
        manualMineInFlightRef.current = false;
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
