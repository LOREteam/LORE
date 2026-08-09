"use client";

import { useEffect, useMemo, useState } from "react";
import { APP_CHAIN_ID, CONTRACT_ADDRESS } from "../lib/constants";
import { formatDecimalTextFixed } from "../lib/balanceFormatting";
import { safeParseFloat, validateBetAmount } from "../lib/utils";

const LEGACY_MANUAL_BET_AMOUNT_KEY = "lineaore:manual-bet-amount:v1";
const MANUAL_BET_AMOUNT_KEY = `lineaore:manual-bet-amount:v2:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`;

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

  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(MANUAL_BET_AMOUNT_KEY) : null;
      const legacyRaw = raw == null && typeof window !== "undefined"
        ? window.localStorage.getItem(LEGACY_MANUAL_BET_AMOUNT_KEY)
        : null;
      if (raw != null) {
        const value = String(raw).trim();
        if (validateBetAmount(value) === null) setBetAmount(value);
        else window.localStorage.removeItem(MANUAL_BET_AMOUNT_KEY);
        return;
      }
      if (legacyRaw != null) {
        const value = String(legacyRaw).trim();
        if (validateBetAmount(value) === null) setBetAmount(value);
        window.localStorage.removeItem(LEGACY_MANUAL_BET_AMOUNT_KEY);
      }
    } catch {
      try {
        window.localStorage.removeItem(MANUAL_BET_AMOUNT_KEY);
        window.localStorage.removeItem(LEGACY_MANUAL_BET_AMOUNT_KEY);
      } catch {
        // ignore storage failures
      }
    }
  }, []);

  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        if (validateBetAmount(betAmount) !== null) {
          window.localStorage.removeItem(MANUAL_BET_AMOUNT_KEY);
          return;
        }
        window.localStorage.setItem(MANUAL_BET_AMOUNT_KEY, betAmount);
      }
    } catch {}
  }, [betAmount]);

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
