"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GRID_SIZE } from "../lib/constants";
import { safeParseFloat } from "../lib/utils";

const AUTOMINER_INPUTS_KEY = "lineaore:auto-miner-inputs:v1";

interface RunningParams {
  betStr: string;
  blocks: number;
  rounds: number;
}

interface UseAutoMinerFormOptions {
  isAutoMining: boolean;
  isPending: boolean;
  isRevealing: boolean;
  isAnalyzing?: boolean;
  liveStateReady?: boolean;
  formattedBalance?: string | null;
  runningParams?: RunningParams | null;
  lowEthForGas?: boolean;
}

export function useAutoMinerForm({
  isAutoMining,
  isPending,
  isRevealing,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isAnalyzing: _isAnalyzing = false,
  liveStateReady = true,
  formattedBalance,
  runningParams,
  lowEthForGas,
}: UseAutoMinerFormOptions) {
  const [betSize, setBetSize] = useState("1.0");
  const [targets, setTargets] = useState(3);
  const [cycles, setCycles] = useState(5);

  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(AUTOMINER_INPUTS_KEY) : null;
      if (raw != null) {
        const data = JSON.parse(raw);
        if (data && typeof data === "object") {
          if (typeof data.betSize === "string" && data.betSize && !Number.isNaN(Number(data.betSize))) setBetSize(data.betSize);
          if (typeof data.targets === "number" && data.targets >= 1 && data.targets <= GRID_SIZE) setTargets(data.targets);
          if (typeof data.cycles === "number" && data.cycles >= 1) setCycles(data.cycles);
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(AUTOMINER_INPUTS_KEY, JSON.stringify({ betSize, targets, cycles }));
      }
    } catch {}
  }, [betSize, targets, cycles]);

  useEffect(() => {
    if (isAutoMining && runningParams) {
      setBetSize(runningParams.betStr);
      setTargets(runningParams.blocks);
      setCycles(runningParams.rounds);
    }
  }, [isAutoMining, runningParams]);

  const displayBetSize = isAutoMining && runningParams ? runningParams.betStr : betSize;
  const displayTargets = isAutoMining && runningParams ? runningParams.blocks : targets;
  const displayCycles = isAutoMining && runningParams ? runningParams.rounds : cycles;

  const handleTargetsChange = useCallback((value: string) => {
    const next = Number(value);
    if (Number.isFinite(next)) setTargets(Math.min(GRID_SIZE, Math.max(1, Math.floor(next))));
  }, []);

  const handleCyclesChange = useCallback((value: string) => {
    const next = Number(value);
    if (Number.isFinite(next)) setCycles(Math.max(1, Math.floor(next)));
  }, []);

  const totalCost = useMemo(() => {
    const resolvedTargets = Number.isFinite(displayTargets) ? Math.max(1, displayTargets) : 1;
    const resolvedCycles = Number.isFinite(displayCycles) ? Math.max(1, displayCycles) : 1;
    return safeParseFloat(displayBetSize) * resolvedTargets * resolvedCycles;
  }, [displayBetSize, displayTargets, displayCycles]);

  const balance = formattedBalance ? safeParseFloat(formattedBalance) : null;
  const insufficientBalance = balance !== null && totalCost > balance;
  const isDisabled =
    (isPending && !isAutoMining) ||
    !liveStateReady ||
    isRevealing ||
    (insufficientBalance && !isAutoMining) ||
    (lowEthForGas && !isAutoMining);

  return {
    betSize,
    setBetSize,
    targets,
    cycles,
    displayBetSize,
    displayTargets,
    displayCycles,
    totalCost,
    balance,
    insufficientBalance,
    isDisabled,
    handleTargetsChange,
    handleCyclesChange,
  };
}
