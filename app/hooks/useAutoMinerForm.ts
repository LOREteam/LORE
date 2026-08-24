"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { APP_CHAIN_ID, CONTRACT_ADDRESS, GRID_SIZE } from "../lib/constants";
import { safeParseFloat, validateBetAmount } from "../lib/utils";
import { MAX_AUTO_MINER_CYCLES } from "./useMining.shared";

const LEGACY_AUTOMINER_INPUTS_KEY = "lineaore:auto-miner-inputs:v1";
const AUTOMINER_INPUTS_KEY = `lineaore:auto-miner-inputs:v2:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`;
const DEFAULT_AUTO_MINER_INPUTS = {
  betSize: "1.0",
  targets: 3,
  cycles: 5,
};

type AutoMinerInputsStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

interface AutoMinerInputs {
  betSize: string;
  targets: number;
  cycles: number;
}

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
  readOnlyReason?: string | null;
  formattedBalance?: string | null;
  walletConnected?: boolean;
  runningParams?: RunningParams | null;
  lowEthForGas?: boolean;
}

function sanitizePositiveInteger(value: unknown, fallback: number, min: number, max: number): number {
  const next = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(next)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(next)));
}

export function sanitizeAutoMinerInputs(value: unknown) {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const betSize = typeof raw.betSize === "string" && validateBetAmount(raw.betSize) === null
    ? raw.betSize
    : DEFAULT_AUTO_MINER_INPUTS.betSize;
  return {
    betSize,
    targets: sanitizePositiveInteger(raw.targets, DEFAULT_AUTO_MINER_INPUTS.targets, 1, GRID_SIZE),
    cycles: sanitizePositiveInteger(raw.cycles, DEFAULT_AUTO_MINER_INPUTS.cycles, 1, MAX_AUTO_MINER_CYCLES),
  };
}

export function restoreAutoMinerInputs(storage: Pick<AutoMinerInputsStorage, "getItem" | "removeItem">) {
  try {
    const raw = storage.getItem(AUTOMINER_INPUTS_KEY);
    const legacyRaw = raw == null ? storage.getItem(LEGACY_AUTOMINER_INPUTS_KEY) : null;
    const selectedRaw = raw ?? legacyRaw;
    if (selectedRaw == null) return null;
    const inputs = sanitizeAutoMinerInputs(JSON.parse(selectedRaw));
    if (raw == null && legacyRaw != null) storage.removeItem(LEGACY_AUTOMINER_INPUTS_KEY);
    return inputs;
  } catch {
    try {
      storage.removeItem(AUTOMINER_INPUTS_KEY);
      storage.removeItem(LEGACY_AUTOMINER_INPUTS_KEY);
    } catch {
      // ignore storage failures
    }
    return null;
  }
}

export function persistAutoMinerInputs(
  storage: Pick<AutoMinerInputsStorage, "setItem" | "removeItem">,
  inputs: AutoMinerInputs,
) {
  try {
    if (validateBetAmount(inputs.betSize) !== null) {
      storage.removeItem(AUTOMINER_INPUTS_KEY);
      return;
    }
    storage.setItem(AUTOMINER_INPUTS_KEY, JSON.stringify(inputs));
  } catch {
    // ignore storage failures
  }
}

export function persistAutoMinerInputsFromWindow(
  browserWindow: Pick<Window, "localStorage">,
  inputs: AutoMinerInputs,
) {
  try {
    persistAutoMinerInputs(browserWindow.localStorage, inputs);
  } catch {
    // ignore unavailable browser storage
  }
}

export function useAutoMinerForm({
  isAutoMining,
  isPending,
  isRevealing,
  liveStateReady = true,
  readOnlyReason = null,
  formattedBalance,
  walletConnected = true,
  runningParams,
  lowEthForGas,
}: UseAutoMinerFormOptions) {
  const [betSize, setBetSize] = useState(DEFAULT_AUTO_MINER_INPUTS.betSize);
  const [targets, setTargets] = useState(DEFAULT_AUTO_MINER_INPUTS.targets);
  const [cycles, setCycles] = useState(DEFAULT_AUTO_MINER_INPUTS.cycles);

  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      const data = restoreAutoMinerInputs(window.localStorage);
      if (!data) return;
      setBetSize(data.betSize);
      setTargets(data.targets);
      setCycles(data.cycles);
    } catch {
      // ignore unavailable browser storage
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    persistAutoMinerInputsFromWindow(window, { betSize, targets, cycles });
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
    setTargets((current) => sanitizePositiveInteger(value, current, 1, GRID_SIZE));
  }, []);

  const handleCyclesChange = useCallback((value: string) => {
    setCycles((current) => sanitizePositiveInteger(value, current, 1, MAX_AUTO_MINER_CYCLES));
  }, []);

  const totalCost = useMemo(() => {
    const resolvedTargets = Number.isFinite(displayTargets) ? Math.max(1, displayTargets) : 1;
    const resolvedCycles = Number.isFinite(displayCycles) ? Math.max(1, displayCycles) : 1;
    return safeParseFloat(displayBetSize) * resolvedTargets * resolvedCycles;
  }, [displayBetSize, displayTargets, displayCycles]);

  const betSizeError = useMemo(() => validateBetAmount(displayBetSize), [displayBetSize]);
  const balance = formattedBalance ? safeParseFloat(formattedBalance) : null;
  const insufficientBalance = balance !== null && totalCost > balance;
  const disabledReason =
    readOnlyReason && !isAutoMining
      ? readOnlyReason
      : !walletConnected
      ? null
      : !liveStateReady
      ? "Waiting for live epoch sync"
      : betSizeError
        ? betSizeError
        : isRevealing
          ? "Round is resolving"
          : insufficientBalance && !isAutoMining
            ? "Insufficient LINEA balance"
            : lowEthForGas && !isAutoMining
              ? "Top up ETH for gas"
              : null;
  const isDisabled =
    (!walletConnected && !isAutoMining) ||
    (Boolean(readOnlyReason) && !isAutoMining) ||
    (isPending && !isAutoMining) ||
    !liveStateReady ||
    (Boolean(betSizeError) && !isAutoMining) ||
    isRevealing ||
    (insufficientBalance && !isAutoMining) ||
    (Boolean(lowEthForGas) && !isAutoMining);

  return {
    betSize,
    setBetSize,
    targets,
    cycles,
    displayBetSize,
    displayTargets,
    displayCycles,
    totalCost,
    betSizeError,
    balance,
    insufficientBalance,
    disabledReason,
    isDisabled,
    handleTargetsChange,
    handleCyclesChange,
  };
}
