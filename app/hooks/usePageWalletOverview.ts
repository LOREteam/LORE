"use client";

import { useEffect, useMemo, useState } from "react";
import { useBalance } from "wagmi";
import { getAddress } from "viem";
import { formatBalanceFixed, formatDecimalTextFixed, type WagmiBalanceLike } from "../lib/balanceFormatting";
import { APP_CHAIN_ID, CONTRACT_ADDRESS } from "../lib/constants";

type CachedPrivyBalances = {
  token: string | null;
  eth: string | null;
};

const EMPTY_CACHED_BALANCES: CachedPrivyBalances = {
  token: null,
  eth: null,
};

function normalizeCachedBalance(value: unknown, fractionDigits: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!text || text.length > 40) return null;
  return formatDecimalTextFixed(text, fractionDigits) ?? null;
}

export function normalizeCachedPrivyBalances(value: unknown): CachedPrivyBalances {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    token: normalizeCachedBalance(raw.token, 2),
    eth: normalizeCachedBalance(raw.eth, 4),
  };
}

export function isHeaderLineaBalanceLoading(
  embeddedTokenPending: boolean,
  formattedLineaBalance: string | null | undefined,
  formattedPrivyBalance: string | null,
) {
  return embeddedTokenPending && formattedLineaBalance == null && formattedPrivyBalance == null;
}

export function normalizePageWalletAddress(value: string | null | undefined): `0x${string}` | null {
  if (!value) return null;
  try {
    return getAddress(value).toLowerCase() as `0x${string}`;
  } catch {
    return null;
  }
}

export function getPrivyBalanceCacheKey(address?: `0x${string}`) {
  const normalizedAddress = normalizePageWalletAddress(address);
  return normalizedAddress
    ? `lore:privy-balances:v1:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}:${normalizedAddress}`
    : null;
}

interface UsePageWalletOverviewOptions {
  address?: string | null;
  normalizedEmbeddedAddress?: `0x${string}` | undefined;
  formattedLineaBalance?: string | null;
  embeddedTokenBalance: WagmiBalanceLike;
  embeddedTokenPending: boolean;
  refetchEmbeddedTokenBalance: () => Promise<unknown> | unknown;
  isPageVisible: boolean;
}

export function usePageWalletOverview({
  address,
  normalizedEmbeddedAddress,
  formattedLineaBalance,
  embeddedTokenBalance,
  embeddedTokenPending,
  refetchEmbeddedTokenBalance,
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
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") {
        window.localStorage.removeItem(balanceCacheKey);
        setCachedBalances(EMPTY_CACHED_BALANCES);
        return;
      }
      setCachedBalances(normalizeCachedPrivyBalances(parsed));
    } catch {
      try {
        window.localStorage.removeItem(balanceCacheKey);
      } catch {
        // Ignore storage cleanup failures.
      }
      setCachedBalances(EMPTY_CACHED_BALANCES);
    }
  }, [balanceCacheKey]);

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

    const nextToken = formatBalanceFixed(embeddedTokenBalance, 2) ?? cachedBalances.token;
    const nextEth = formatBalanceFixed(embeddedEthBalance, 4) ?? cachedBalances.eth;

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
    () => formatBalanceFixed(embeddedTokenBalance, 2) ?? cachedBalances.token,
    [cachedBalances.token, embeddedTokenBalance],
  );

  const formattedPrivyEthBalance = useMemo(
    () => formatBalanceFixed(embeddedEthBalance, 4) ?? cachedBalances.eth,
    [cachedBalances.eth, embeddedEthBalance],
  );

  const normalizedActiveAddress = normalizePageWalletAddress(address);
  const normalizedEmbeddedWalletAddress = normalizePageWalletAddress(normalizedEmbeddedAddress);
  const isEmbeddedActive = Boolean(
    normalizedActiveAddress &&
    normalizedEmbeddedWalletAddress &&
    normalizedActiveAddress === normalizedEmbeddedWalletAddress,
  );

  const headerLineaBalance =
    (isEmbeddedActive && formattedLineaBalance != null ? formattedLineaBalance : formattedPrivyBalance) ?? "—";

  const headerLineaLoading = isHeaderLineaBalanceLoading(
    embeddedTokenPending,
    formattedLineaBalance,
    formattedPrivyBalance,
  );

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
      headerEthLoading: embeddedEthPending && formattedPrivyEthBalance == null,
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
