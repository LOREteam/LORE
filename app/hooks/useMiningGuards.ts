"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type NotifyFn = (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
type PlayBetFn = () => void;

type LastBet = {
  tiles: number[];
  amount: string;
};

type BalanceData = { formatted: string } | null | undefined;

interface UseMiningGuardsOptions {
  connectedWalletAddress: string | null | undefined;
  embeddedWalletAddress: string | null;
  embeddedEthBalance: BalanceData;
  embeddedTokenBalance: BalanceData;
  isAutoMining: boolean;
  isAnalyzing: boolean;
  isRevealing: boolean;
  liveStateReady: boolean;
  selectedTiles: number[];
  minEthForGas: number;
  onManualMine: (amount: string) => Promise<boolean>;
  onDirectMine: (tiles: number[], amount: string) => Promise<boolean>;
  onAutoMineToggle: (bet: string, blocks: number, rounds: number) => Promise<void>;
  notify: NotifyFn;
  onOpenWalletSettings: () => void;
  onBetConfirmed: PlayBetFn;
}

const LAST_BET_KEY = "lore:last-bet";

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
  // V8 atomic resolve: the previous epoch is finalized in the same tx that
  // advances `currentEpoch`, so the winning tile is already on-chain when
  // the new epoch starts. The grid-reveal animation is non-blocking — never
  // gate betting on it. Only gate on liveState readiness.
  const bettingLocked = !liveStateReady;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAST_BET_KEY);
      if (raw) setLastBet(JSON.parse(raw));
    } catch {
      // ignore bad local storage state
    }
  }, []);

  const lowEthBalance = embeddedEthBalance ? Number(embeddedEthBalance.formatted) < minEthForGas : false;
  const lowTokenBalance = embeddedTokenBalance ? Number(embeddedTokenBalance.formatted) < 1 : false;

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
      if (bettingLocked) {
        notify(
          !liveStateReady ? "Live epoch is still syncing." : "Betting is locked while the epoch is resolving.",
          "warning",
        );
        return;
      }
      const tilesSnapshot = [...selectedTiles];
      const success = await onManualMine(amount);
      if (!success) return;
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
    [bettingLocked, hasPlayableWallet, liveStateReady, notify, onBetConfirmed, onManualMine, onOpenWalletSettings, selectedTiles],
  );

  const handleRepeatLastBet = useCallback(async () => {
    if (!lastBet) return;
    if (!hasPlayableWallet) {
      notify("Connect a wallet first.", "warning");
      onOpenWalletSettings();
      return;
    }
    if (bettingLocked) {
      notify(
        !liveStateReady ? "Live epoch is still syncing." : "Betting is locked while the epoch is resolving.",
        "warning",
      );
      return;
    }
    const success = await onDirectMine(lastBet.tiles, lastBet.amount);
    if (!success) return;
    onBetConfirmed();
    try {
      localStorage.setItem(LAST_BET_KEY, JSON.stringify(lastBet));
    } catch {
      // ignore storage failures
    }
  }, [bettingLocked, hasPlayableWallet, lastBet, liveStateReady, notify, onBetConfirmed, onDirectMine, onOpenWalletSettings]);

  const handleAutoMineWithGuard = useCallback(
    async (bet: string, blocks: number, rounds: number) => {
      if (!embeddedWalletAddress) {
        notify("Create a Privy wallet first in Wallet Settings.", "warning");
        onOpenWalletSettings();
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
    [bettingLocked, embeddedWalletAddress, isAutoMining, liveStateReady, lowEthBalance, notify, onAutoMineToggle, onOpenWalletSettings],
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
