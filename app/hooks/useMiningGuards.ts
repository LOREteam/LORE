"use client";

import { useCallback, useEffect, useState } from "react";

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
    [hasPlayableWallet, notify, onBetConfirmed, onManualMine, onOpenWalletSettings, selectedTiles],
  );

  const handleRepeatLastBet = useCallback(async () => {
    if (!lastBet) return;
    if (!hasPlayableWallet) {
      notify("Connect a wallet first.", "warning");
      onOpenWalletSettings();
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
  }, [hasPlayableWallet, lastBet, notify, onBetConfirmed, onDirectMine, onOpenWalletSettings]);

  const handleAutoMineWithGuard = useCallback(
    async (bet: string, blocks: number, rounds: number) => {
      if (!embeddedWalletAddress) {
        notify("Create a Privy wallet first in Wallet Settings.", "warning");
        onOpenWalletSettings();
        return;
      }
      if (lowEthBalance && !isAutoMining) {
        notify("Not enough ETH for gas. Top up your Privy wallet in Settings.", "warning");
        onOpenWalletSettings();
        return;
      }
      await onAutoMineToggle(bet, blocks, rounds);
    },
    [embeddedWalletAddress, isAutoMining, lowEthBalance, notify, onAutoMineToggle, onOpenWalletSettings],
  );

  const dismissBalanceWarning = useCallback(() => {
    setBalanceWarningDismissed(true);
  }, []);

  return {
    lastBet,
    lowEthBalance,
    lowTokenBalance,
    balanceWarningDismissed,
    dismissBalanceWarning,
    handleManualMineWithGuard,
    handleRepeatLastBet,
    handleAutoMineWithGuard,
  };
}
