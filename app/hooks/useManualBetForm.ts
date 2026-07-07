"use client";

import { useEffect, useMemo, useState } from "react";
import { APP_CHAIN_ID, CONTRACT_ADDRESS } from "../lib/constants";
import { safeParseFloat, validateBetAmount } from "../lib/utils";

const LEGACY_MANUAL_BET_AMOUNT_KEY = "lineaore:manual-bet-amount:v1";
const MANUAL_BET_AMOUNT_KEY = `lineaore:manual-bet-amount:v2:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`;

interface UseManualBetFormOptions {
  formattedBalance: string | null;
  walletConnected: boolean;
  liveStateReady?: boolean;
  readOnlyReason?: string | null;
  selectedTilesCount: number;
  isPending: boolean;
  isRevealing: boolean;
  isAnalyzing?: boolean;
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
  isAnalyzing = false,
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
        return;
      }
      if (legacyRaw != null) {
        const value = String(legacyRaw).trim();
        if (validateBetAmount(value) === null) setBetAmount(value);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      if (typeof window !== "undefined") window.localStorage.setItem(MANUAL_BET_AMOUNT_KEY, betAmount);
    } catch {}
  }, [betAmount]);

  const totalBet = useMemo(() => safeParseFloat(betAmount) * selectedTilesCount, [betAmount, selectedTilesCount]);
  const betAmountError = useMemo(() => validateBetAmount(betAmount), [betAmount]);
  const balance = formattedBalance ? safeParseFloat(formattedBalance) : null;
  const manualInsufficient = balance !== null && totalBet > 0 && totalBet > balance;
  const disabledReason =
    readOnlyReason
      ? readOnlyReason
      : !walletConnected
      ? null
      : !liveStateReady
      ? "Waiting for live epoch sync"
      : betAmountError
        ? betAmountError
        : isRevealing || isAnalyzing
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
    isAnalyzing ||
    isAutoMining ||
    manualInsufficient;

  return {
    betAmount,
    setBetAmount,
    totalBet,
    betAmountError,
    manualInsufficient,
    disabledReason,
    isDisabled,
  };
}

export type ManualBetFormState = ReturnType<typeof useManualBetForm>;
