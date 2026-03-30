"use client";

import { useCallback } from "react";
import { delay } from "../lib/utils";

interface UseMiningRoundCompletionOptions {
  onAnnounceBet?: () => void;
  refetchEpoch?: () => void;
  refetchGridEpochData?: () => void;
  refetchTileData: () => void;
  refetchUserBets: () => void;
  saveSession: (payload: {
    active: boolean;
    betStr: string;
    blocks: number;
    rounds: number;
    nextRoundIndex: number;
    lastPlacedEpoch: string;
  }) => void;
  setAutoMineProgress: (value: string | null) => void;
  setSelectedTiles: (tiles: number[]) => void;
  setSelectedTilesEpoch: (epoch: string | null) => void;
  refetchDelayMs: number;
}

export function useMiningRoundCompletion({
  onAnnounceBet,
  refetchEpoch,
  refetchGridEpochData,
  refetchTileData,
  refetchUserBets,
  saveSession,
  setAutoMineProgress,
  setSelectedTiles,
  setSelectedTilesEpoch,
  refetchDelayMs,
}: UseMiningRoundCompletionOptions) {
  return useCallback(
    async (params: {
      betStr: string;
      blocks: number;
      rounds: number;
      roundIndex: number;
      placedEpoch: bigint;
      displayTiles?: number[];
      displayEpoch?: bigint;
      progressMessage?: string;
      announceBet?: boolean;
    }) => {
      const {
        betStr,
        blocks,
        rounds,
        roundIndex,
        placedEpoch,
        displayTiles,
        displayEpoch,
        progressMessage,
        announceBet = true,
      } = params;

      if (displayTiles) {
        setSelectedTiles(displayTiles);
        setSelectedTilesEpoch((displayEpoch ?? placedEpoch).toString());
      }
      if (progressMessage) {
        setAutoMineProgress(progressMessage);
      }
      if (announceBet) {
        onAnnounceBet?.();
      }

      saveSession({
        active: true,
        betStr,
        blocks,
        rounds,
        nextRoundIndex: roundIndex + 1,
        lastPlacedEpoch: placedEpoch.toString(),
      });
      refetchEpoch?.();
      refetchGridEpochData?.();
      refetchTileData();
      refetchUserBets();
      setTimeout(() => {
        refetchTileData();
        refetchUserBets();
      }, 1500);
      setTimeout(() => {
        setSelectedTiles([]);
        setSelectedTilesEpoch(null);
      }, 3500);
      await delay(refetchDelayMs);
    },
    [
      onAnnounceBet,
      refetchDelayMs,
      refetchEpoch,
      refetchGridEpochData,
      refetchTileData,
      refetchUserBets,
      saveSession,
      setAutoMineProgress,
      setSelectedTiles,
      setSelectedTilesEpoch,
    ],
  );
}
