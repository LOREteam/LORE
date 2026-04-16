"use client";

import { useMemo } from "react";
import { useReadContract } from "wagmi";
import { APP_CHAIN_ID, CONTRACT_ADDRESS, GAME_ABI } from "../lib/constants";

interface UseGameCoreReadsOptions {
  liveContractReadsEnabled: boolean;
  isPageVisible: boolean;
  epochInterval: number;
}

export function useGameCoreReads({
  liveContractReadsEnabled,
  isPageVisible,
  epochInterval,
}: UseGameCoreReadsOptions) {
  const chainId = APP_CHAIN_ID;

  const { data: actualCurrentEpoch, refetch: refetchEpoch } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "currentEpoch",
    chainId,
    query: { enabled: liveContractReadsEnabled, refetchInterval: epochInterval },
  });

  const { data: epochDurationSec } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "epochDuration",
    chainId,
    query: { enabled: liveContractReadsEnabled, refetchInterval: isPageVisible ? 15000 : 30000 },
  });

  const { data: pendingEpochDuration } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "pendingEpochDuration",
    chainId,
    query: { enabled: liveContractReadsEnabled, refetchInterval: isPageVisible ? 30000 : 60000 },
  });

  const { data: pendingEpochDurationEta } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "pendingEpochDurationEta",
    chainId,
    query: { enabled: liveContractReadsEnabled, refetchInterval: isPageVisible ? 30000 : 60000 },
  });

  const { data: pendingEpochDurationEffectiveFromEpoch } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "pendingEpochDurationEffectiveFromEpoch",
    chainId,
    query: { enabled: liveContractReadsEnabled, refetchInterval: isPageVisible ? 30000 : 60000 },
  });

  const { data: jackpotInfoRaw } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "getJackpotInfo",
    chainId,
    query: { enabled: liveContractReadsEnabled, refetchInterval: isPageVisible ? 15000 : 30000 },
  });

  const { data: rolloverPoolRaw } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "rolloverPool",
    chainId,
    query: { enabled: liveContractReadsEnabled, refetchInterval: isPageVisible ? 15000 : 30000 },
  });

  return useMemo(
    () => ({
      actualCurrentEpoch,
      refetchEpoch,
      epochDurationSec,
      pendingEpochDuration,
      pendingEpochDurationEta,
      pendingEpochDurationEffectiveFromEpoch,
      jackpotInfoRaw,
      rolloverPoolRaw,
    }),
    [
      actualCurrentEpoch,
      refetchEpoch,
      epochDurationSec,
      pendingEpochDuration,
      pendingEpochDurationEta,
      pendingEpochDurationEffectiveFromEpoch,
      jackpotInfoRaw,
      rolloverPoolRaw,
    ],
  );
}
