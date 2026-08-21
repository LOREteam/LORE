"use client";

import { useMemo } from "react";
import { getAddress } from "viem";
import { useAccount, useReadContract } from "wagmi";
import type { WagmiBalanceLike } from "../lib/balanceFormatting";
import { APP_CHAIN_ID, LINEA_TOKEN_ADDRESS, TOKEN_ABI } from "../lib/constants";
import { toWalletBalanceDataStatus } from "../lib/walletBalanceDataStatus";
import { useAutoMineSessionActive } from "./useAutoMineSessionActive";
import { usePageVisibility } from "./usePageVisibility";

interface UseGameWalletContextOptions {
  preferredAddress?: `0x${string}` | string | null;
}

export function useGameWalletContext({ preferredAddress }: UseGameWalletContextOptions) {
  const { address } = useAccount();
  const chainId = APP_CHAIN_ID;
  const walletAddress = useMemo(() => {
    const candidate = preferredAddress ?? address;
    if (!candidate) return undefined;
    try {
      return getAddress(candidate);
    } catch {
      return undefined;
    }
  }, [preferredAddress, address]);
  const isPageVisible = usePageVisibility();

  const {
    data: directTokenBalanceRaw,
    dataUpdatedAt: tokenBalanceUpdatedAt,
    isError: tokenBalanceError,
    isFetching: tokenBalanceFetching,
    isPending: tokenBalancePending,
    isStale: tokenBalanceStale,
    refetch: refetchTokenBalance,
  } = useReadContract({
    address: LINEA_TOKEN_ADDRESS,
    abi: TOKEN_ABI,
    functionName: "balanceOf",
    args: walletAddress ? [walletAddress] : undefined,
    chainId,
    query: {
      enabled: Boolean(walletAddress),
      refetchInterval: isPageVisible ? 12_000 : 45_000,
      staleTime: isPageVisible ? 30_000 : 90_000,
    },
  });
  const tokenBalance = useMemo<WagmiBalanceLike>(
    () => directTokenBalanceRaw != null
      ? { value: directTokenBalanceRaw as bigint, decimals: 18 }
      : undefined,
    [directTokenBalanceRaw],
  );
  const autoMineSessionActive = useAutoMineSessionActive();
  const tokenBalanceStatus = useMemo(
    () => toWalletBalanceDataStatus({
      dataUpdatedAt: tokenBalanceUpdatedAt,
      isError: tokenBalanceError,
      isFetching: tokenBalanceFetching,
      isStale: tokenBalanceStale,
    }),
    [tokenBalanceError, tokenBalanceFetching, tokenBalanceStale, tokenBalanceUpdatedAt],
  );

  return useMemo(
    () => ({
      address,
      chainId,
      walletAddress,
      tokenBalance,
      tokenBalancePending,
      tokenBalanceStatus,
      refetchTokenBalance,
      isPageVisible,
      autoMineSessionActive,
    }),
    [
      address,
      chainId,
      walletAddress,
      tokenBalance,
      tokenBalancePending,
      tokenBalanceStatus,
      refetchTokenBalance,
      isPageVisible,
      autoMineSessionActive,
    ],
  );
}
