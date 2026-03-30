"use client";

import { useMemo, useRef } from "react";
import { useReadContract } from "wagmi";
import { CONTRACT_ADDRESS, GAME_ABI } from "../lib/constants";

interface UseGameUserBetsOptions {
  chainId: number;
  gridDisplayEpochBigInt: bigint | null;
  walletAddress?: `0x${string}`;
  isPageVisible: boolean;
  liveUserBetsInterval: number;
}

export function useGameUserBets({
  chainId,
  gridDisplayEpochBigInt,
  walletAddress,
  isPageVisible,
  liveUserBetsInterval,
}: UseGameUserBetsOptions) {
  const { data: userBetsAllRaw, refetch: refetchUserBets, dataUpdatedAt: userBetsUpdatedAt } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "getUserBetsAll",
    args: gridDisplayEpochBigInt && walletAddress ? [gridDisplayEpochBigInt, walletAddress] : undefined,
    chainId,
    query: {
      enabled: !!gridDisplayEpochBigInt && !!walletAddress,
      refetchInterval: isPageVisible ? liveUserBetsInterval : 30_000,
    },
  });

  const userBetsEpochRef = useRef<string | null>(null);
  const userBetsValidAtRef = useRef(0);

  const userBetsAll = useMemo(() => {
    const currentKey = gridDisplayEpochBigInt?.toString() ?? null;
    if (currentKey !== userBetsEpochRef.current) {
      if (userBetsUpdatedAt > userBetsValidAtRef.current) {
        userBetsEpochRef.current = currentKey;
        userBetsValidAtRef.current = userBetsUpdatedAt;
        return userBetsAllRaw as bigint[] | undefined;
      }
      return undefined;
    }
    if (userBetsUpdatedAt > userBetsValidAtRef.current) {
      userBetsValidAtRef.current = userBetsUpdatedAt;
    }
    return userBetsAllRaw as bigint[] | undefined;
  }, [userBetsAllRaw, userBetsUpdatedAt, gridDisplayEpochBigInt]);

  return {
    userBetsAll,
    refetchUserBets,
  };
}
