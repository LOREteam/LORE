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
type MineAttemptResult = "confirmed" | "pending";

interface MiningManualActionRef {
  current: boolean;
}

interface ExecuteMiningManualActionOptions {
  source: MineAttemptSource;
  tiles: number[];
  betAmountStr: string;
  expectedEpoch: bigint | null | undefined;
  inFlightRef: MiningManualActionRef;
  autoMineActive: () => boolean;
  getActorAddress: () => string | null;
  notify?: NotifyFn;
  setIsPending: (value: boolean) => void;
  setSelectedTiles: (tiles: number[]) => void;
  setSelectedTilesEpoch: (epoch: string | null) => void;
  submitMineAttempt: (
    source: MineAttemptSource,
    normalizedTiles: number[],
    betAmountStr: string,
    actorAddress: string,
    expectedEpoch: bigint,
  ) => Promise<MineAttemptResult>;
  clearPendingState?: () => void;
  getFailureMessage?: (error: unknown) => string;
  logFailure?: (source: MineAttemptSource, error: unknown) => void;
}

export async function executeMiningManualAction({
  source,
  tiles,
  betAmountStr,
  expectedEpoch,
  inFlightRef,
  autoMineActive,
  getActorAddress,
  notify,
  setIsPending,
  setSelectedTiles,
  setSelectedTilesEpoch,
  submitMineAttempt,
  clearPendingState = clearMiningTxPathState,
  getFailureMessage = getBetErrorMessage,
  logFailure = (failedSource, error) => log.warn(failedSource, "bet failed", error),
}: ExecuteMiningManualActionOptions): Promise<MineAttemptResult | false> {
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
  if (autoMineActive() || inFlightRef.current) return false;
  if (source === "DirectMine") {
    setSelectedTiles(normalizedTiles);
    setSelectedTilesEpoch(null);
  }
  inFlightRef.current = true;
  setIsPending(true);
  try {
    const state = await submitMineAttempt(source, normalizedTiles, betAmountStr, actorAddress, expectedEpoch);
    if (state === "pending") {
      notify?.(
        source === "DirectMine"
          ? "Repeat bet transaction is still pending. Check wallet activity before retrying."
          : "Bet transaction is still pending. Check wallet activity before retrying.",
        "warning",
      );
    }
    return state;
  } catch (error) {
    if (!isUserRejection(error)) {
      clearPendingState();
      const reason = getFailureMessage(error);
      logFailure(source, error);
      notify?.(reason, "danger");
    } else {
      notify?.(
        source === "DirectMine"
          ? "Repeat bet transaction rejected in wallet."
          : "Bet transaction rejected in wallet.",
        "info",
      );
    }
    return false;
  } finally {
    inFlightRef.current = false;
    setIsPending(false);
  }
}

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
    (betAmountStr: string, expectedEpoch: bigint | null | undefined) => executeMiningManualAction({
      source: "ManualMine",
      tiles: selectedTiles,
      betAmountStr,
      expectedEpoch,
      inFlightRef: manualMineInFlightRef,
      autoMineActive,
      getActorAddress,
      notify,
      setIsPending,
      setSelectedTiles,
      setSelectedTilesEpoch,
      submitMineAttempt,
    }),
    [
      autoMineActive,
      selectedTiles,
      getActorAddress,
      notify,
      setIsPending,
      setSelectedTiles,
      setSelectedTilesEpoch,
      submitMineAttempt,
    ],
  );

  const handleDirectMine = useCallback(
    (tiles: number[], betAmountStr: string, expectedEpoch: bigint | null | undefined) =>
      executeMiningManualAction({
        source: "DirectMine",
        tiles,
        betAmountStr,
        expectedEpoch,
        inFlightRef: manualMineInFlightRef,
        autoMineActive,
        getActorAddress,
        notify,
        setIsPending,
        setSelectedTiles,
        setSelectedTilesEpoch,
        submitMineAttempt,
      }),
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
