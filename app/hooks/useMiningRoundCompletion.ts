"use client";

import { useCallback, useEffect, useRef } from "react";
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
  const mountedRef = useRef(false);
  const timeoutIdsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const scheduleTimeout = useCallback((callback: () => void, delayMs: number) => {
    const timeoutId = setTimeout(() => {
      timeoutIdsRef.current = timeoutIdsRef.current.filter((id) => id !== timeoutId);
      if (mountedRef.current) {
        callback();
      }
    }, delayMs);
    timeoutIdsRef.current.push(timeoutId);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const timeoutId of timeoutIdsRef.current) {
        clearTimeout(timeoutId);
      }
      timeoutIdsRef.current = [];
    };
  }, []);

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
      scheduleTimeout(() => {
        refetchTileData();
        refetchUserBets();
      }, 1500);
      scheduleTimeout(() => {
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
      scheduleTimeout,
      setAutoMineProgress,
      setSelectedTiles,
      setSelectedTilesEpoch,
    ],
  );
}
