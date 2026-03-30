"use client";

import { useCallback } from "react";
import type { MutableRefObject } from "react";
import type { PublicClient } from "viem";
import { CONTRACT_ADDRESS, GAME_ABI } from "../lib/constants";
import { countConfirmedTiles } from "./useMining.shared";

interface UseMiningBetStatusOptions {
  publicClientRef: MutableRefObject<PublicClient | undefined>;
}

export function useMiningBetStatus({ publicClientRef }: UseMiningBetStatusOptions) {
  return useCallback(
    async (actorAddress: string, normalizedTiles: number[]) => {
      const client = publicClientRef.current;
      if (!client) return false;
      try {
        const epoch = (await client.readContract({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "currentEpoch",
        })) as bigint;
        const bets = (await client.readContract({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "getUserBetsAll",
          args: [epoch, actorAddress as `0x${string}`],
        })) as bigint[];
        return countConfirmedTiles(bets, normalizedTiles) >= normalizedTiles.length;
      } catch {
        return false;
      }
    },
    [publicClientRef],
  );
}
