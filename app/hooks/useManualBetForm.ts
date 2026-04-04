"use client";

import { useEffect, useMemo, useState } from "react";
import { safeParseFloat } from "../lib/utils";

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
  isAnalyzing = false,
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
  const balance = formattedBalance ? safeParseFloat(formattedBalance) : null;
  const manualInsufficient = balance !== null && totalBet > 0 && totalBet > balance;
  const isDisabled =
    !liveStateReady ||
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
    manualInsufficient,
    isDisabled,
  };
}
