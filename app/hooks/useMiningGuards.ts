"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getFormattedBalance, type WagmiBalanceLike } from "../lib/balanceFormatting";
import { APP_CHAIN_ID, CONTRACT_ADDRESS } from "../lib/constants";
import { validateBetAmount } from "../lib/utils";
import { normalizeTiles } from "./useMining.shared";
import type { ReceiptState } from "./useMining.stateTypes";

type NotifyFn = (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
type PlayBetFn = () => void;

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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isAnalyzing: _isAnalyzing,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isRevealing: _isRevealing,
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
      setLastBet(sanitized);
      if (!raw && sanitized) {
        localStorage.setItem(LAST_BET_KEY, JSON.stringify(sanitized));
      }
    } catch {
      // ignore bad local storage state
    }
  }, []);

  const lowEthBalance = embeddedEthBalance ? Number(getFormattedBalance(embeddedEthBalance)) < minEthForGas : false;
  const lowTokenBalance = embeddedTokenBalance ? Number(getFormattedBalance(embeddedTokenBalance)) < 1 : false;

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
      if (readOnlyReason) {
        notify(readOnlyReason, "warning");
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
      notify("Preparing bet transaction. Confirm the wallet prompt if it appears.", "info");
      const result = await onManualMine(amount);
      if (result === "pending") {
        notify("Bet transaction submitted and is still pending. Waiting for on-chain confirmation.", "info");
        return;
      }
      if (result !== "confirmed") return;
      notify("Bet confirmed on-chain.", "success");
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
    [bettingLocked, hasPlayableWallet, liveStateReady, notify, onBetConfirmed, onManualMine, onOpenWalletSettings, readOnlyReason, selectedTiles],
  );

  const handleRepeatLastBet = useCallback(async () => {
    if (!lastBet) return;
    if (!hasPlayableWallet) {
      notify("Connect a wallet first.", "warning");
      onOpenWalletSettings();
      return;
    }
    if (readOnlyReason) {
      notify(readOnlyReason, "warning");
      return;
    }
    if (bettingLocked) {
      notify(
        !liveStateReady ? "Live epoch is still syncing." : "Betting is locked while the epoch is resolving.",
        "warning",
      );
      return;
    }
    notify("Preparing repeat bet transaction. Confirm the wallet prompt if it appears.", "info");
    const result = await onDirectMine(lastBet.tiles, lastBet.amount);
    if (result === "pending") {
      notify("Repeat bet transaction submitted and is still pending. Waiting for on-chain confirmation.", "info");
      return;
    }
    if (result !== "confirmed") return;
    notify("Repeat bet confirmed on-chain.", "success");
    onBetConfirmed();
    try {
      localStorage.setItem(LAST_BET_KEY, JSON.stringify(lastBet));
    } catch {
      // ignore storage failures
    }
  }, [bettingLocked, hasPlayableWallet, lastBet, liveStateReady, notify, onBetConfirmed, onDirectMine, onOpenWalletSettings, readOnlyReason]);

  const handleAutoMineWithGuard = useCallback(
    async (bet: string, blocks: number, rounds: number) => {
      if (!embeddedWalletAddress) {
        notify("Create a Privy wallet first in Wallet Settings.", "warning");
        onOpenWalletSettings();
        return;
      }
      if (!isAutoMining && readOnlyReason) {
        notify(readOnlyReason, "warning");
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
