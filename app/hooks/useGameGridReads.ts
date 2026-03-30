"use client";

import { useMemo } from "react";
import { useReadContract } from "wagmi";
import { APP_CHAIN_ID, CONTRACT_ADDRESS, GAME_ABI, LINEA_TOKEN_ADDRESS, TOKEN_ABI } from "../lib/constants";

interface UseGameGridReadsOptions {
  liveContractReadsEnabled: boolean;
  liveGrid: boolean;
  isPageVisible: boolean;
  isRevealing: boolean;
  walletAddress?: `0x${string}`;
  resolvedCurrentEpoch?: bigint;
  gridDisplayEpochBigInt: bigint | null;
  epochEndInterval: number;
  liveGridInterval: number;
  gridEpochInterval: number;
}

export function useGameGridReads({
  liveContractReadsEnabled,
  liveGrid,
  isPageVisible,
  isRevealing,
  walletAddress,
  resolvedCurrentEpoch,
  gridDisplayEpochBigInt,
  epochEndInterval,
  liveGridInterval,
  gridEpochInterval,
}: UseGameGridReadsOptions) {
  const chainId = APP_CHAIN_ID;

  const { data: epochEndTime, refetch: refetchEpochEndTime } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "getEpochEndTime",
    args: resolvedCurrentEpoch ? [resolvedCurrentEpoch] : undefined,
    chainId,
    query: { enabled: liveContractReadsEnabled && !!resolvedCurrentEpoch, refetchInterval: epochEndInterval },
  });

  const { data: tileData, refetch: refetchTileData } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "getTileData",
    args: gridDisplayEpochBigInt ? [gridDisplayEpochBigInt] : undefined,
    chainId,
    query: {
      enabled: liveContractReadsEnabled && !!gridDisplayEpochBigInt,
      refetchInterval: isPageVisible ? liveGridInterval : 30_000,
    },
  });

  const prefetchEpoch = useMemo(
    () =>
      liveGrid &&
      isRevealing &&
      resolvedCurrentEpoch &&
      gridDisplayEpochBigInt &&
      resolvedCurrentEpoch !== gridDisplayEpochBigInt
        ? resolvedCurrentEpoch
        : undefined,
    [liveGrid, isRevealing, resolvedCurrentEpoch, gridDisplayEpochBigInt],
  );

  useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "getTileData",
    args: prefetchEpoch ? [prefetchEpoch] : undefined,
    chainId,
    query: { enabled: liveContractReadsEnabled && !!prefetchEpoch && isPageVisible, refetchInterval: 0 },
  });

  useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "getUserBetsAll",
    args: prefetchEpoch && walletAddress ? [prefetchEpoch, walletAddress] : undefined,
    chainId,
    query: {
      enabled: liveContractReadsEnabled && !!prefetchEpoch && !!walletAddress && isPageVisible,
      refetchInterval: 0,
    },
  });

  useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "getEpochEndTime",
    args: prefetchEpoch ? [prefetchEpoch] : undefined,
    chainId,
    query: { enabled: liveContractReadsEnabled && !!prefetchEpoch && isPageVisible, refetchInterval: 0 },
  });

  const gridAndCurrentAreSame =
    gridDisplayEpochBigInt != null &&
    resolvedCurrentEpoch != null &&
    gridDisplayEpochBigInt === resolvedCurrentEpoch;

  const { data: gridEpochData, refetch: refetchGridEpochData } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "epochs",
    args: gridDisplayEpochBigInt ? [gridDisplayEpochBigInt] : undefined,
    chainId,
    query: { enabled: liveContractReadsEnabled && !!gridDisplayEpochBigInt, refetchInterval: gridEpochInterval },
  });

  const { data: separateCurrentEpochData } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "epochs",
    args: resolvedCurrentEpoch ? [resolvedCurrentEpoch] : undefined,
    chainId,
    query: {
      enabled: liveContractReadsEnabled && !!resolvedCurrentEpoch && !gridAndCurrentAreSame,
      refetchInterval: isPageVisible ? liveGridInterval : 20000,
    },
  });

  const { data: currentAllowance, refetch: refetchAllowance } = useReadContract({
    address: LINEA_TOKEN_ADDRESS,
    abi: TOKEN_ABI,
    functionName: "allowance",
    args: walletAddress ? [walletAddress, CONTRACT_ADDRESS] : undefined,
    chainId,
    query: { enabled: !!walletAddress },
  });

  return {
    epochEndTime,
    refetchEpochEndTime,
    tileData,
    refetchTileData,
    gridAndCurrentAreSame,
    gridEpochData,
    refetchGridEpochData,
    separateCurrentEpochData,
    currentAllowance,
    refetchAllowance,
  };
}
