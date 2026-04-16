"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAutoResolve } from "./useAutoResolve";
import type { PublicClient } from "viem";
import type { SoundName } from "./useSound";

type HotTile = { tileId: number; wins: number };

interface HistoryRow {
  isResolved: boolean;
  winningTile: string;
}

interface UsePageRuntimeEffectsOptions {
  actualCurrentEpoch: bigint | null | undefined;
  currentEpochResolved: boolean | undefined;
  embeddedEthBalanceFormatted: string | null | undefined;
  embeddedWalletAddress?: string | null;
  handleTileClick: (id: number, isRevealing: boolean) => void;
  historyViewData: HistoryRow[];
  isRevealing: boolean;
  liveStateReady: boolean;
  playSound: (name: SoundName) => void;
  publicClient: PublicClient | undefined;
  refetchEpoch?: () => void;
  refetchGridEpochData?: () => void;
  refetchTileData: () => void;
  refetchUserBets: () => void;
  sendTransactionSilent?: (
    tx: {
      to: `0x${string}`;
      data?: `0x${string}`;
      value?: bigint;
      gas?: bigint;
      nonce?: number;
      feeMode?: "normal" | "keeper";
    },
    gasOverrides?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } | { gasPrice?: bigint },
  ) => Promise<`0x${string}`>;
  syncHotTiles: (tiles: HotTile[]) => void;
  timeLeft: number;
  winningTileId: number | null;
  hasMyWinningBet: boolean;
}

export function usePageRuntimeEffects({
  actualCurrentEpoch,
  currentEpochResolved,
  embeddedEthBalanceFormatted,
  embeddedWalletAddress,
  handleTileClick,
  historyViewData,
  isRevealing,
  liveStateReady,
  playSound,
  publicClient,
  refetchEpoch,
  refetchGridEpochData,
  refetchTileData,
  refetchUserBets,
  sendTransactionSilent,
  syncHotTiles,
  timeLeft,
  winningTileId,
  hasMyWinningBet,
}: UsePageRuntimeEffectsOptions) {
  const hotTiles = useMemo<HotTile[]>(() => {
    const counts: Record<number, number> = {};
    for (const round of historyViewData) {
      if (!round.isResolved) continue;
      const tile = Number(round.winningTile);
      if (tile > 0) counts[tile] = (counts[tile] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([tileId, wins]) => ({ tileId: Number(tileId), wins }))
      .sort((left, right) => right.wins - left.wins)
      .slice(0, 5);
  }, [historyViewData]);

  useEffect(() => {
    syncHotTiles(hotTiles);
  }, [hotTiles, syncHotTiles]);

  useAutoResolve({
    publicClient,
    sendTransactionSilent,
    embeddedWalletAddress: embeddedWalletAddress ?? null,
    actualCurrentEpoch: liveStateReady ? actualCurrentEpoch : undefined,
    currentEpochResolved: liveStateReady ? currentEpochResolved : undefined,
    timeLeft: liveStateReady ? timeLeft : 1,
    embeddedEthBalanceFormatted: embeddedEthBalanceFormatted ?? null,
    refetchEpoch: refetchEpoch ?? (() => {}),
    refetchGridEpochData: refetchGridEpochData ?? (() => {}),
    refetchTileData,
    refetchUserBets,
  });

  useEffect(() => {
    if (!isRevealing || winningTileId === null) return;
    if (hasMyWinningBet) playSound("myWin");
  }, [hasMyWinningBet, isRevealing, winningTileId, playSound]);

  const timeLeftPrevRef = useRef<number | null>(null);
  useEffect(() => {
    if (!liveStateReady) {
      timeLeftPrevRef.current = null;
      return;
    }
    if (timeLeft <= 0 || timeLeft > 10) {
      timeLeftPrevRef.current = timeLeft;
      return;
    }
    if (timeLeftPrevRef.current !== null && timeLeft < timeLeftPrevRef.current) {
      playSound("tick");
    }
    timeLeftPrevRef.current = timeLeft;
  }, [liveStateReady, timeLeft, playSound]);

  const isRevealingRef = useRef(isRevealing);
  isRevealingRef.current = isRevealing;

  const stableTileClick = useCallback(
    (id: number) => handleTileClick(id, isRevealingRef.current),
    [handleTileClick],
  );

  return useMemo(
    () => ({
      stableTileClick,
    }),
    [stableTileClick],
  );
}
