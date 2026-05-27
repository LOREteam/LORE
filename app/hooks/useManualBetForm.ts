"use client";

import { useEffect, useMemo, useState } from "react";
import { safeParseFloat, validateBetAmount } from "../lib/utils";

const MANUAL_BET_AMOUNT_KEY = "lineaore:manual-bet-amount:v1";

interface UseManualBetFormOptions {
  formattedBalance: string | null;
  liveStateReady?: boolean;
  selectedTilesCount: number;
  isPending: boolean;
  isRevealing: boolean;
  isAnalyzing?: boolean;
  isAutoMining: boolean;
}

export function useManualBetForm({
  formattedBalance,
  liveStateReady = true,
  selectedTilesCount,
  isPending,
  isRevealing,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isAnalyzing: _isAnalyzing = false,
  isAutoMining,
}: UseManualBetFormOptions) {
  const [betAmount, setBetAmount] = useState("10.0");

  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(MANUAL_BET_AMOUNT_KEY) : null;
      if (raw != null) {
        const value = String(raw).trim();
        if (value && !Number.isNaN(Number(value))) setBetAmount(value);
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
    !liveStateReady
      ? "Waiting for live epoch sync"
      : betAmountError
        ? betAmountError
        : selectedTilesCount === 0
          ? "Select at least one tile"
          : isRevealing
            ? "Round is resolving"
            : isAutoMining
              ? "Auto-Miner is running"
              : manualInsufficient
                ? "Insufficient LINEA balance"
                : null;
  const isDisabled =
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
    betAmountError,
    manualInsufficient,
    disabledReason,
    isDisabled,
  };
}
