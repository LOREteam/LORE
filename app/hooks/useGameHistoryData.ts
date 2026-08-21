"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useReadContracts } from "wagmi";
import { CONTRACT_ADDRESS, GAME_ABI, HISTORY_DEPTH } from "../lib/constants";
import { buildHistoryViewData, EpochTuple } from "./useGameData.helpers";

interface UseGameHistoryDataOptions {
  chainId: number;
  historyDetailed: boolean;
  isPageVisible: boolean;
  resolvedCurrentEpoch?: bigint;
  walletAddress?: `0x${string}`;
}

const HISTORY_PAGE_SIZE = 20;

export function useGameHistoryData(options: UseGameHistoryDataOptions) {
  const { chainId, historyDetailed, isPageVisible, resolvedCurrentEpoch, walletAddress } = options;
  const [historyPage, setHistoryPage] = useState(1);
  const maxHistoryPages = Math.ceil(HISTORY_DEPTH / HISTORY_PAGE_SIZE);

  const historyEpochsList = useMemo(() => {
    if (!resolvedCurrentEpoch) return [];
    const startIdx = (historyPage - 1) * HISTORY_PAGE_SIZE;
    const endIdx = Math.min(startIdx + HISTORY_PAGE_SIZE, HISTORY_DEPTH);
    return Array.from({ length: endIdx - startIdx }, (_, i) => resolvedCurrentEpoch - BigInt(startIdx + i + 1)).filter(
      (id) => id > 0n,
    );
  }, [resolvedCurrentEpoch, historyPage]);

  useEffect(() => {
    if (resolvedCurrentEpoch && historyEpochsList.length === 0 && historyPage > 1) {
      setHistoryPage(1);
    }
  }, [resolvedCurrentEpoch, historyEpochsList.length, historyPage]);

  const {
    data: historyData,
    refetch: refetchHistory,
    isLoading: isHistoryDataLoading,
    isFetching: isHistoryDataFetching,
    isError: isHistoryDataError,
  } = useReadContracts({
    contracts: historyEpochsList.map((id) => ({
      address: CONTRACT_ADDRESS,
      abi: GAME_ABI,
      functionName: "epochs" as const,
      args: [id],
      chainId,
    })),
    query: {
      enabled: historyEpochsList.length > 0 && isPageVisible,
      refetchInterval: historyDetailed ? 15000 : 90000,
    },
  });

  const historyUserBetsCalls = useMemo(() => {
    if (!walletAddress || !historyData || historyData.length !== historyEpochsList.length || historyEpochsList.length === 0) {
      return [];
    }
    return historyEpochsList.map((epoch, index) => {
      const res = historyData[index]?.result;
      const winBlock = res != null ? (res as EpochTuple)[2] : 0n;
      return {
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "userBets" as const,
        args: [epoch, winBlock, walletAddress],
        chainId,
      };
    });
  }, [chainId, historyData, historyEpochsList, walletAddress]);

  const {
    data: historyUserBetsData,
    isLoading: isHistoryUserBetsLoading,
    isFetching: isHistoryUserBetsFetching,
    isError: isHistoryUserBetsError,
  } = useReadContracts({
    contracts: historyUserBetsCalls,
    query: {
      enabled: historyDetailed && historyUserBetsCalls.length > 0 && isPageVisible,
      refetchInterval: 15000,
    },
  });

  const historySnapshotKey = useMemo(
    () => historyEpochsList.map((epoch) => epoch.toString()).join(","),
    [historyEpochsList],
  );

  const builtHistoryViewData = useMemo(
    () =>
      buildHistoryViewData(
        historyData as Array<{ result?: unknown } | undefined> | undefined,
        historyEpochsList,
        historyUserBetsData as Array<{ result?: unknown } | undefined> | undefined,
      ),
    [historyData, historyEpochsList, historyUserBetsData],
  );

  const historyReadFailed = isHistoryDataError || isHistoryUserBetsError;
  const lastReadyHistoryKeyRef = useRef("");
  const lastReadyHistoryDataRef = useRef<ReturnType<typeof buildHistoryViewData>>([]);

  useEffect(() => {
    if (historyReadFailed || builtHistoryViewData.length === 0 || !historySnapshotKey) return;
    lastReadyHistoryKeyRef.current = historySnapshotKey;
    lastReadyHistoryDataRef.current = builtHistoryViewData;
  }, [builtHistoryViewData, historyReadFailed, historySnapshotKey]);

  const historyViewData = useMemo(() => {
    if (!historyReadFailed && builtHistoryViewData.length > 0) return builtHistoryViewData;
    if (historySnapshotKey && lastReadyHistoryKeyRef.current === historySnapshotKey) {
      return lastReadyHistoryDataRef.current;
    }
    return historyReadFailed ? [] : builtHistoryViewData;
  }, [builtHistoryViewData, historyReadFailed, historySnapshotKey]);

  const historyError = historyReadFailed
    ? "Blockchain history is temporarily unavailable. Refresh the Analytics tab to retry."
    : null;
  const historyLoading = !historyError && historyViewData.length === 0 && (
    isHistoryDataLoading
    || isHistoryDataFetching
    || isHistoryUserBetsLoading
    || isHistoryUserBetsFetching
  );

  const historyRefreshing = !historyError && historyViewData.length > 0 && (
    isHistoryDataFetching
    || isHistoryUserBetsFetching
  );

  return useMemo(
    () => ({
      historyViewData,
      historyError,
      historyLoading,
      historyRefreshing,
      refetchHistory,
      historyPage,
      setHistoryPage,
      maxHistoryPages,
    }),
    [
      historyViewData,
      historyError,
      historyLoading,
      historyRefreshing,
      refetchHistory,
      historyPage,
      setHistoryPage,
      maxHistoryPages,
    ],
  );
}
