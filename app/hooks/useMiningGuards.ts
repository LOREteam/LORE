"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getAddress } from "viem";
import type { WagmiBalanceLike } from "../lib/balanceFormatting";
import { APP_CHAIN_ID, CONTRACT_ADDRESS } from "../lib/constants";
import { validateBetAmount } from "../lib/utils";
import { normalizeTiles } from "./useMining.shared";
import type { ReceiptState } from "./useMining.stateTypes";

type NotifyFn = (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
type PlayBetFn = () => void;
type ManualBetNotificationPhase = "signing" | ReceiptState;

type LastBet = {
  tiles: number[];
  amount: string;
};

type BalanceData = WagmiBalanceLike;

interface UseMiningGuardsOptions {
  connectedWalletAddress: string | null | undefined;
  embeddedWalletAddress: string | null;
  embeddedEthBalance: BalanceData;
  embeddedTokenBalance: BalanceData;
  isAutoMining: boolean;
  isAnalyzing: boolean;
  isRevealing: boolean;
  liveStateReady: boolean;
  readOnlyReason?: string | null;
  selectedTiles: number[];
  minEthForGas: number;
  onManualMine: (amount: string) => Promise<ReceiptState | false>;
  onDirectMine: (tiles: number[], amount: string) => Promise<ReceiptState | false>;
  onAutoMineToggle: (bet: string, blocks: number, rounds: number) => Promise<void>;
  notify: NotifyFn;
  onOpenWalletSettings: () => void;
  onBetConfirmed: PlayBetFn;
}

const LEGACY_LAST_BET_KEY = "lore:last-bet";
const LAST_BET_KEY = `lore:last-bet:v2:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`;
const CONFIRMED_FIRST_BET_KEY_PREFIX = `lore:onboarding:first-confirmed-bet:v2:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`;

export function getManualBetNotification(
  phase: ManualBetNotificationPhase,
): readonly [message: string, tone: "info" | "success"] {
  if (phase === "signing") return ["Signing bet transaction.", "info"];
  if (phase === "pending") {
    return ["Bet transaction submitted and is still pending. Waiting for on-chain confirmation.", "info"];
  }
  return ["Bet confirmed on-chain.", "success"];
}

export function confirmedFirstBetStorageKey(walletAddress: string | null | undefined): string | null {
  if (!walletAddress) return null;
  try {
    return `${CONFIRMED_FIRST_BET_KEY_PREFIX}:${getAddress(walletAddress).toLowerCase()}`;
  } catch {
    return null;
  }
}

function markConfirmedFirstBet(walletAddress: string | null | undefined) {
  const key = confirmedFirstBetStorageKey(walletAddress);
  if (!key) return;
  try {
    localStorage.setItem(key, "1");
  } catch {
    // The checklist remains conservative when persistent browser storage is unavailable.
  }
}

export function hasConfirmedFirstBet(walletAddress: string | null | undefined): boolean {
  if (typeof window === "undefined") return false;
  const key = confirmedFirstBetStorageKey(walletAddress);
  if (!key) return false;
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function normalizeBalanceDecimals(balance: BalanceData, fallbackDecimals = 18): number | null {
  if (!balance) return null;
  const decimals = balance.decimals ?? fallbackDecimals;
  return Number.isInteger(decimals) && decimals >= 0 && decimals <= 255 ? decimals : null;
}

export function parseDecimalNumberToUnits(value: number, decimals: number): bigint | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const text = String(value);
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const [wholeRaw, fractionalRaw = ""] = text.split(".");
  if (fractionalRaw.length > decimals) return null;
  const whole = BigInt(wholeRaw);
  const fractional = fractionalRaw.length > 0 ? BigInt(fractionalRaw.padEnd(decimals, "0")) : 0n;
  return whole * 10n ** BigInt(decimals) + fractional;
}

export function isBalanceBelowDecimalThreshold(balance: BalanceData, threshold: number, fallbackDecimals = 18): boolean {
  if (!balance) return false;
  if (typeof balance.value !== "bigint") return true;
  const decimals = normalizeBalanceDecimals(balance, fallbackDecimals);
  if (decimals === null) return true;
  const thresholdUnits = parseDecimalNumberToUnits(threshold, decimals);
  if (thresholdUnits === null) return true;
  return balance.value < thresholdUnits;
}

export function isBalanceBelowWholeToken(balance: BalanceData, wholeTokens = 1n, fallbackDecimals = 18): boolean {
  if (!balance) return false;
  if (typeof balance.value !== "bigint") return true;
  const decimals = normalizeBalanceDecimals(balance, fallbackDecimals);
  if (decimals === null) return true;
  return balance.value < wholeTokens * 10n ** BigInt(decimals);
}

export function getMiningReadOnlyBlockReason(readOnlyReason: string | null | undefined, isAutoMining = false) {
  return !isAutoMining && readOnlyReason ? readOnlyReason : null;
}

function sanitizeLastBet(value: unknown): LastBet | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<LastBet>;
  if (!Array.isArray(raw.tiles) || typeof raw.amount !== "string") return null;
  if (validateBetAmount(raw.amount) !== null) return null;
  const tiles = normalizeTiles(raw.tiles);
  if (tiles.length === 0) return null;
  return { tiles, amount: raw.amount };
}

export function useMiningGuards({
  connectedWalletAddress,
  embeddedWalletAddress,
  embeddedEthBalance,
  embeddedTokenBalance,
  isAutoMining,
  liveStateReady,
  readOnlyReason = null,
  selectedTiles,
  minEthForGas,
  onManualMine,
  onDirectMine,
  onAutoMineToggle,
  notify,
  onOpenWalletSettings,
  onBetConfirmed,
}: UseMiningGuardsOptions) {
  const [lastBet, setLastBet] = useState<LastBet | null>(null);
  const [balanceWarningDismissed, setBalanceWarningDismissed] = useState(false);
  const hasPlayableWallet = Boolean(connectedWalletAddress || embeddedWalletAddress);
  const firstBetWalletAddress = embeddedWalletAddress ?? connectedWalletAddress ?? null;
  // V9 atomic resolve: the previous epoch is finalized in the same tx that
  // advances `currentEpoch`, so the winning tile is already on-chain when
  // the new epoch starts. The grid-reveal animation is non-blocking — never
  // gate betting on it. Only gate on liveState readiness.
  const bettingLocked = !liveStateReady;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAST_BET_KEY);
      const legacyRaw = raw ? null : localStorage.getItem(LEGACY_LAST_BET_KEY);
      const parsed = raw ?? legacyRaw;
      if (!parsed) return;
      const sanitized = sanitizeLastBet(JSON.parse(parsed));
      if (!sanitized) {
        localStorage.removeItem(raw ? LAST_BET_KEY : LEGACY_LAST_BET_KEY);
        return;
      }
      setLastBet(sanitized);
      if (!raw && sanitized) {
        localStorage.setItem(LAST_BET_KEY, JSON.stringify(sanitized));
      }
    } catch {
      try {
        localStorage.removeItem(LAST_BET_KEY);
      } catch {
        // ignore storage failures
      }
    }
  }, []);

  const lowEthBalance = isBalanceBelowDecimalThreshold(embeddedEthBalance, minEthForGas);
  const lowTokenBalance = isBalanceBelowWholeToken(embeddedTokenBalance);

  useEffect(() => {
    if (!lowEthBalance && !lowTokenBalance) {
      setBalanceWarningDismissed(false);
    }
  }, [lowEthBalance, lowTokenBalance]);

  const handleManualMineWithGuard = useCallback(
    async (amount: string) => {
      if (!hasPlayableWallet) {
        notify("Connect a wallet first.", "warning");
        onOpenWalletSettings();
        return;
      }
      const readOnlyBlockReason = getMiningReadOnlyBlockReason(readOnlyReason);
      if (readOnlyBlockReason) {
        notify(readOnlyBlockReason, "warning");
        return;
      }
      if (bettingLocked) {
        notify(
          !liveStateReady ? "Live epoch is still syncing." : "Betting is locked while the epoch is resolving.",
          "warning",
        );
        return;
      }
      const tilesSnapshot = [...selectedTiles];
      notify(...getManualBetNotification("signing"));
      const result = await onManualMine(amount);
      if (result === "pending") {
        notify(...getManualBetNotification("pending"));
        return;
      }
      if (result !== "confirmed") return;
      notify(...getManualBetNotification("confirmed"));
      markConfirmedFirstBet(firstBetWalletAddress);
      onBetConfirmed();
      if (tilesSnapshot.length > 0) {
        const entry = { tiles: tilesSnapshot, amount };
        try {
          localStorage.setItem(LAST_BET_KEY, JSON.stringify(entry));
        } catch {
          // ignore storage failures
        }
        setLastBet(entry);
      }
    },
    [bettingLocked, firstBetWalletAddress, hasPlayableWallet, liveStateReady, notify, onBetConfirmed, onManualMine, onOpenWalletSettings, readOnlyReason, selectedTiles],
  );

  const handleRepeatLastBet = useCallback(async () => {
    if (!lastBet) return;
    if (!hasPlayableWallet) {
      notify("Connect a wallet first.", "warning");
      onOpenWalletSettings();
      return;
    }
    const readOnlyBlockReason = getMiningReadOnlyBlockReason(readOnlyReason);
    if (readOnlyBlockReason) {
      notify(readOnlyBlockReason, "warning");
      return;
    }
    if (bettingLocked) {
      notify(
        !liveStateReady ? "Live epoch is still syncing." : "Betting is locked while the epoch is resolving.",
        "warning",
      );
      return;
    }
    notify("Signing repeat bet transaction.", "info");
    const result = await onDirectMine(lastBet.tiles, lastBet.amount);
    if (result === "pending") {
      notify("Repeat bet transaction submitted and is still pending. Waiting for on-chain confirmation.", "info");
      return;
    }
    if (result !== "confirmed") return;
    notify("Repeat bet confirmed on-chain.", "success");
    markConfirmedFirstBet(firstBetWalletAddress);
    onBetConfirmed();
    try {
      localStorage.setItem(LAST_BET_KEY, JSON.stringify(lastBet));
    } catch {
      // ignore storage failures
    }
  }, [bettingLocked, firstBetWalletAddress, hasPlayableWallet, lastBet, liveStateReady, notify, onBetConfirmed, onDirectMine, onOpenWalletSettings, readOnlyReason]);

  const handleAutoMineWithGuard = useCallback(
    async (bet: string, blocks: number, rounds: number) => {
      if (!embeddedWalletAddress) {
        notify("Create a Privy wallet first in Wallet Settings.", "warning");
        onOpenWalletSettings();
        return;
      }
      const readOnlyBlockReason = getMiningReadOnlyBlockReason(readOnlyReason, isAutoMining);
      if (readOnlyBlockReason) {
        notify(readOnlyBlockReason, "warning");
        return;
      }
      if (!isAutoMining && bettingLocked) {
        notify(
          !liveStateReady ? "Live epoch is still syncing." : "Betting is locked while the epoch is resolving.",
          "warning",
        );
        return;
      }
      if (lowEthBalance && !isAutoMining) {
        notify("Not enough ETH for gas. Top up your Privy wallet in Settings.", "warning");
        onOpenWalletSettings();
        return;
      }
      await onAutoMineToggle(bet, blocks, rounds);
    },
    [bettingLocked, embeddedWalletAddress, isAutoMining, liveStateReady, lowEthBalance, notify, onAutoMineToggle, onOpenWalletSettings, readOnlyReason],
  );

  const dismissBalanceWarning = useCallback(() => {
    setBalanceWarningDismissed(true);
  }, []);

  return useMemo(
    () => ({
      lastBet,
      lowEthBalance,
      lowTokenBalance,
      balanceWarningDismissed,
      dismissBalanceWarning,
      handleManualMineWithGuard,
      handleRepeatLastBet,
      handleAutoMineWithGuard,
    }),
    [
      balanceWarningDismissed,
      dismissBalanceWarning,
      handleAutoMineWithGuard,
      handleManualMineWithGuard,
      handleRepeatLastBet,
      lastBet,
      lowEthBalance,
      lowTokenBalance,
    ],
  );
}
