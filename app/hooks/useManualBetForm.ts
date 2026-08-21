"use client";

import { useEffect, useMemo, useState } from "react";
import { APP_CHAIN_ID, CONTRACT_ADDRESS } from "../lib/constants";
import { formatDecimalTextFixed } from "../lib/balanceFormatting";
import { safeParseFloat, validateBetAmount } from "../lib/utils";

const LEGACY_MANUAL_BET_AMOUNT_KEY = "lineaore:manual-bet-amount:v1";
const MANUAL_BET_AMOUNT_KEY = `lineaore:manual-bet-amount:v2:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`;

type ManualBetAmountStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function clearManualBetAmountStorage(storage: Pick<ManualBetAmountStorage, "removeItem">) {
  try {
    storage.removeItem(MANUAL_BET_AMOUNT_KEY);
    storage.removeItem(LEGACY_MANUAL_BET_AMOUNT_KEY);
  } catch {
    // ignore storage failures
  }
}

export function restoreManualBetAmount(storage: Pick<ManualBetAmountStorage, "getItem" | "removeItem">) {
  try {
    const raw = storage.getItem(MANUAL_BET_AMOUNT_KEY);
    if (raw != null) {
      const value = raw.trim();
      if (validateBetAmount(value) === null) return value;
      storage.removeItem(MANUAL_BET_AMOUNT_KEY);
      return null;
    }

    const legacyRaw = storage.getItem(LEGACY_MANUAL_BET_AMOUNT_KEY);
    if (legacyRaw == null) return null;

    const value = legacyRaw.trim();
    const restored = validateBetAmount(value) === null ? value : null;
    try {
      storage.removeItem(LEGACY_MANUAL_BET_AMOUNT_KEY);
    } catch {
      clearManualBetAmountStorage(storage);
    }
    return restored;
  } catch {
    clearManualBetAmountStorage(storage);
    return null;
  }
}

export function persistManualBetAmount(storage: Pick<ManualBetAmountStorage, "setItem" | "removeItem">, value: string) {
  try {
    if (validateBetAmount(value) !== null) {
      storage.removeItem(MANUAL_BET_AMOUNT_KEY);
      return;
    }
    storage.setItem(MANUAL_BET_AMOUNT_KEY, value);
  } catch {
    // ignore storage failures
  }
}
function formatManualNumberDisplay(value: number | null | undefined, fractionDigits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fractionDigits > 0 ? `0.${"0".repeat(fractionDigits)}` : "0";
  return formatDecimalTextFixed(String(value), fractionDigits) ?? (fractionDigits > 0 ? `0.${"0".repeat(fractionDigits)}` : "0");
}

interface UseManualBetFormOptions {
  formattedBalance: string | null;
  walletConnected: boolean;
  liveStateReady?: boolean;
  readOnlyReason?: string | null;
  selectedTilesCount: number;
  isPending: boolean;
  isRevealing: boolean;
  isAutoMining: boolean;
}

export function useManualBetForm({
  formattedBalance,
  walletConnected,
  liveStateReady = true,
  readOnlyReason = null,
  selectedTilesCount,
  isPending,
  isRevealing,
  isAutoMining,
}: UseManualBetFormOptions) {
  const [betAmount, setBetAmount] = useState("10.0");
  const [manualBetStorageReady, setManualBetStorageReady] = useState(false);

  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        const restored = restoreManualBetAmount(window.localStorage);
        if (restored !== null) setBetAmount(restored);
      }
    } catch {
      // ignore unavailable browser storage
    } finally {
      setManualBetStorageReady(true);
    }
  }, []);

  useEffect(() => {
    try {
      if (!manualBetStorageReady) return;
      if (typeof window !== "undefined") persistManualBetAmount(window.localStorage, betAmount);
    } catch {
      // ignore unavailable browser storage
    }
  }, [betAmount, manualBetStorageReady]);
  const totalBet = useMemo(() => safeParseFloat(betAmount) * selectedTilesCount, [betAmount, selectedTilesCount]);
  const betAmountError = useMemo(() => validateBetAmount(betAmount), [betAmount]);
  const balance = formattedBalance ? safeParseFloat(formattedBalance) : null;
  const manualInsufficient = balance !== null && totalBet > 0 && totalBet > balance;
  const lineaDeficit = manualInsufficient && balance !== null ? totalBet - balance : 0;
  const totalBetDisplay = formatManualNumberDisplay(totalBet, 2);
  const balanceDisplay = formatManualNumberDisplay(balance, 2);
  const lineaDeficitDisplay = formatManualNumberDisplay(lineaDeficit, 2);
  const disabledReason =
    readOnlyReason
      ? readOnlyReason
      : !walletConnected
      ? null
      : !liveStateReady
      ? "Waiting for live epoch sync"
      : betAmountError
        ? betAmountError
        : isRevealing
            ? "Round is resolving"
            : isAutoMining
              ? "Auto-Miner is running"
              : manualInsufficient
                ? "Insufficient LINEA balance"
                : null;
  const isDisabled =
    !walletConnected ||
    Boolean(readOnlyReason) ||
    !liveStateReady ||
    Boolean(betAmountError) ||
    isPending ||
    selectedTilesCount === 0 ||
    isRevealing ||
    isAutoMining ||
    manualInsufficient;

  return {
    betAmount,
    setBetAmount,
    totalBet,
    totalBetDisplay,
    betAmountError,
    balance,
    balanceDisplay,
    lineaDeficit,
    lineaDeficitDisplay,
    manualInsufficient,
    disabledReason,
    isDisabled,
  };
}

export type ManualBetFormState = ReturnType<typeof useManualBetForm>;
