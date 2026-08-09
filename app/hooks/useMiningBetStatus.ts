"use client";

import { useCallback } from "react";
import type { MutableRefObject } from "react";
import type { PublicClient } from "viem";
import { CONTRACT_ADDRESS, GAME_ABI } from "../lib/constants";
import { withMiningRpcTimeout } from "./useMining.shared";

interface UseMiningBetStatusOptions {
  publicClientRef: MutableRefObject<PublicClient | undefined>;
}

export function hasExpectedBetDelta(
  before: bigint[],
  after: bigint[],
  normalizedTiles: number[],
  amountRawPerTile: bigint,
): boolean {
  return normalizedTiles.every((tile) => {
    const index = tile - 1;
    const previousAmount = before[index] ?? 0n;
    const currentAmount = after[index] ?? 0n;
    return currentAmount >= previousAmount + amountRawPerTile;
  });
}

export function useMiningBetStatus({ publicClientRef }: UseMiningBetStatusOptions) {
  return useCallback(
    async (
      actorAddress: string,
      normalizedTiles: number[],
      expectedEpoch: bigint,
      amountRawPerTile: bigint,
    ) => {
      const client = publicClientRef.current;
      if (!client) throw new Error("Public client unavailable for bet confirmation.");
      const readBets = () =>
        withMiningRpcTimeout(
          client.readContract({
            address: CONTRACT_ADDRESS,
            abi: GAME_ABI,
            functionName: "getUserBetsAll",
            args: [expectedEpoch, actorAddress as `0x${string}`],
          }) as Promise<unknown>,
          "bet.confirmationSnapshot",
          8_000,
        ) as Promise<bigint[]>;
      const before = await readBets();
      return async () => hasExpectedBetDelta(
        before,
        await readBets(),
        normalizedTiles,
        amountRawPerTile,
      );
    },
    [publicClientRef],
  );
}
