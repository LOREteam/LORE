"use client";

import { useEffect, useMemo, useState } from "react";
import { useBalance, useReadContract } from "wagmi";
import { getFormattedBalance, type WagmiBalanceLike } from "../lib/balanceFormatting";
import { APP_CHAIN_ID, CONTRACT_ADDRESS, LINEA_TOKEN_ADDRESS, TOKEN_ABI } from "../lib/constants";

type CachedPrivyBalances = {
  token: string;
  eth: string;
};

const EMPTY_CACHED_BALANCES: CachedPrivyBalances = {
  token: "0.00",
  eth: "0.0000",
};

function getPrivyBalanceCacheKey(address?: `0x${string}`) {
  return address
    ? `lore:privy-balances:v1:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}:${address.toLowerCase()}`
    : null;
}

interface UsePageWalletOverviewOptions {
  address?: string | null;
  normalizedEmbeddedAddress?: `0x${string}` | undefined;
  formattedLineaBalance?: string | null;
  isPageVisible: boolean;
}

export function usePageWalletOverview({
  address,
  normalizedEmbeddedAddress,
  formattedLineaBalance,
  isPageVisible,
}: UsePageWalletOverviewOptions) {
  const [cachedBalances, setCachedBalances] = useState<CachedPrivyBalances>(EMPTY_CACHED_BALANCES);
  const balanceCacheKey = useMemo(
    () => getPrivyBalanceCacheKey(normalizedEmbeddedAddress),
    [normalizedEmbeddedAddress],
  );

  useEffect(() => {
    if (!balanceCacheKey) {
      setCachedBalances(EMPTY_CACHED_BALANCES);
      return;
    }

    try {
      const raw = window.localStorage.getItem(balanceCacheKey);
      if (!raw) {
        setCachedBalances(EMPTY_CACHED_BALANCES);
        return;
      }
      const parsed = JSON.parse(raw) as Partial<CachedPrivyBalances>;
      setCachedBalances({
        token: typeof parsed.token === "string" ? parsed.token : "0.00",
        eth: typeof parsed.eth === "string" ? parsed.eth : "0.0000",
      });
    } catch {
      setCachedBalances(EMPTY_CACHED_BALANCES);
    }
  }, [balanceCacheKey]);

  const {
    data: directEmbeddedTokenBalanceRaw,
    isPending: embeddedTokenPending,
    refetch: refetchEmbeddedTokenBalance,
  } = useReadContract({
    address: LINEA_TOKEN_ADDRESS,
    abi: TOKEN_ABI,
    functionName: "balanceOf",
    args: normalizedEmbeddedAddress ? [normalizedEmbeddedAddress] : undefined,
    chainId: APP_CHAIN_ID,
    query: {
      enabled: Boolean(normalizedEmbeddedAddress),
      refetchInterval: isPageVisible ? 12_000 : 45_000,
    },
  });

  const embeddedTokenBalance = useMemo<WagmiBalanceLike>(
    () => directEmbeddedTokenBalanceRaw != null
      ? { value: directEmbeddedTokenBalanceRaw as bigint, decimals: 18 }
      : undefined,
    [directEmbeddedTokenBalanceRaw],
  );

  const { data: embeddedEthBalanceRaw, isPending: embeddedEthPending, refetch: refetchEmbeddedEthBalance } = useBalance({
    address: normalizedEmbeddedAddress,
    chainId: APP_CHAIN_ID,
    query: {
      enabled: Boolean(normalizedEmbeddedAddress),
      refetchInterval: isPageVisible ? 12_000 : 45_000,
    },
  });
  const embeddedEthBalance = embeddedEthBalanceRaw as WagmiBalanceLike;

  useEffect(() => {
    if (!isPageVisible || !normalizedEmbeddedAddress) return;
    void refetchEmbeddedTokenBalance();
    void refetchEmbeddedEthBalance();
  }, [isPageVisible, normalizedEmbeddedAddress, refetchEmbeddedEthBalance, refetchEmbeddedTokenBalance]);

  useEffect(() => {
    if (!balanceCacheKey) return;

    const nextToken = embeddedTokenBalance
      ? Number(getFormattedBalance(embeddedTokenBalance)).toFixed(2)
      : cachedBalances.token;
    const nextEth = embeddedEthBalance
      ? Number(getFormattedBalance(embeddedEthBalance)).toFixed(4)
      : cachedBalances.eth;

    if (nextToken === cachedBalances.token && nextEth === cachedBalances.eth) return;

    const nextCached = {
      token: nextToken,
      eth: nextEth,
    };
    setCachedBalances(nextCached);
    try {
      window.localStorage.setItem(balanceCacheKey, JSON.stringify(nextCached));
    } catch {
      // Ignore storage quota/privacy mode failures.
    }
  }, [balanceCacheKey, cachedBalances.eth, cachedBalances.token, embeddedEthBalance, embeddedTokenBalance]);

  const formattedPrivyBalance = useMemo(
    () => (embeddedTokenBalance ? Number(getFormattedBalance(embeddedTokenBalance)).toFixed(2) : cachedBalances.token),
    [cachedBalances.token, embeddedTokenBalance],
  );

  const formattedPrivyEthBalance = useMemo(
    () => (embeddedEthBalance ? Number(getFormattedBalance(embeddedEthBalance)).toFixed(4) : cachedBalances.eth),
    [cachedBalances.eth, embeddedEthBalance],
  );

  const isEmbeddedActive = Boolean(
    address && normalizedEmbeddedAddress && address.toLowerCase() === normalizedEmbeddedAddress.toLowerCase(),
  );

  const headerLineaBalance =
    isEmbeddedActive && formattedLineaBalance != null ? formattedLineaBalance : formattedPrivyBalance;

  const headerLineaLoading =
    (isEmbeddedActive && formattedLineaBalance == null) ||
    (!isEmbeddedActive && embeddedTokenPending && formattedPrivyBalance === "0.00");

  return useMemo(
    () => ({
      embeddedTokenBalance,
      embeddedEthBalance,
      embeddedTokenPending,
      embeddedEthPending,
      refetchEmbeddedTokenBalance,
      refetchEmbeddedEthBalance,
      formattedPrivyBalance,
      formattedPrivyEthBalance,
      isEmbeddedActive,
      headerLineaBalance,
      headerLineaLoading,
      headerEthLoading: embeddedEthPending && formattedPrivyEthBalance === "0.0000",
    }),
    [
      embeddedTokenBalance,
      embeddedEthBalance,
      embeddedTokenPending,
      embeddedEthPending,
      refetchEmbeddedTokenBalance,
      refetchEmbeddedEthBalance,
      formattedPrivyBalance,
      formattedPrivyEthBalance,
      isEmbeddedActive,
      headerLineaBalance,
      headerLineaLoading,
    ],
  );
}
