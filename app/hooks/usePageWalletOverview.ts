"use client";

import { useEffect, useMemo, useState } from "react";
import { useBalance } from "wagmi";
import { getAddress } from "viem";
import { formatBalanceFixed, formatDecimalTextFixed, type WagmiBalanceLike } from "../lib/balanceFormatting";
import { APP_CHAIN_ID, CONTRACT_ADDRESS } from "../lib/constants";
import { toWalletBalanceDataStatus, type WalletBalanceDataStatus } from "../lib/walletBalanceDataStatus";

type CachedPrivyBalances = {
  token: string | null;
  tokenUpdatedAt: number | null;
  eth: string | null;
  ethUpdatedAt: number | null;
};

type CachedPrivyBalanceEntry = {
  cacheKey: string | null;
  balances: CachedPrivyBalances;
};

const EMPTY_CACHED_BALANCES: CachedPrivyBalances = {
  token: null,
  tokenUpdatedAt: null,
  eth: null,
  ethUpdatedAt: null,
};

const EMPTY_CACHED_BALANCE_ENTRY: CachedPrivyBalanceEntry = {
  cacheKey: null,
  balances: EMPTY_CACHED_BALANCES,
};

function normalizeCachedBalance(value: unknown, fractionDigits: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!text || text.length > 40) return null;
  return formatDecimalTextFixed(text, fractionDigits) ?? null;
}

function normalizeCachedUpdatedAt(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function normalizeCachedPrivyBalances(value: unknown): CachedPrivyBalances {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    token: normalizeCachedBalance(raw.token, 2),
    tokenUpdatedAt: normalizeCachedUpdatedAt(raw.tokenUpdatedAt),
    eth: normalizeCachedBalance(raw.eth, 4),
    ethUpdatedAt: normalizeCachedUpdatedAt(raw.ethUpdatedAt),
  };
}

export function getCachedPrivyBalancesForKey(
  entry: CachedPrivyBalanceEntry,
  cacheKey: string | null,
): CachedPrivyBalances {
  return cacheKey && entry.cacheKey === cacheKey ? entry.balances : EMPTY_CACHED_BALANCES;
}
export function isHeaderLineaBalanceLoading(
  embeddedTokenPending: boolean,
) {
  return embeddedTokenPending;
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
  embeddedTokenStatus: WalletBalanceDataStatus;
  refetchEmbeddedTokenBalance: () => Promise<unknown> | unknown;
  isPageVisible: boolean;
}

export function usePageWalletOverview({
  address,
  normalizedEmbeddedAddress,
  formattedLineaBalance,
  embeddedTokenBalance,
  embeddedTokenPending,
  embeddedTokenStatus,
  refetchEmbeddedTokenBalance,
  isPageVisible,
}: UsePageWalletOverviewOptions) {
  const [cachedBalanceEntry, setCachedBalanceEntry] = useState<CachedPrivyBalanceEntry>(EMPTY_CACHED_BALANCE_ENTRY);
  const balanceCacheKey = useMemo(
    () => getPrivyBalanceCacheKey(normalizedEmbeddedAddress),
    [normalizedEmbeddedAddress],
  );

  const cachedBalances = getCachedPrivyBalancesForKey(cachedBalanceEntry, balanceCacheKey);

  useEffect(() => {
    if (!balanceCacheKey) {
      setCachedBalanceEntry(EMPTY_CACHED_BALANCE_ENTRY);
      return;
    }

    try {
      const raw = window.localStorage.getItem(balanceCacheKey);
      if (!raw) {
        setCachedBalanceEntry({ cacheKey: balanceCacheKey, balances: EMPTY_CACHED_BALANCES });
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") {
        window.localStorage.removeItem(balanceCacheKey);
        setCachedBalanceEntry({ cacheKey: balanceCacheKey, balances: EMPTY_CACHED_BALANCES });
        return;
      }
      setCachedBalanceEntry({ cacheKey: balanceCacheKey, balances: normalizeCachedPrivyBalances(parsed) });
    } catch {
      try {
        window.localStorage.removeItem(balanceCacheKey);
      } catch {
        // Ignore storage cleanup failures.
      }
      setCachedBalanceEntry({ cacheKey: balanceCacheKey, balances: EMPTY_CACHED_BALANCES });
    }
  }, [balanceCacheKey]);

  const {
    data: embeddedEthBalanceRaw,
    dataUpdatedAt: embeddedEthUpdatedAt,
    isError: embeddedEthError,
    isFetching: embeddedEthFetching,
    isPending: embeddedEthPending,
    isStale: embeddedEthStale,
    refetch: refetchEmbeddedEthBalance,
  } = useBalance({
    address: normalizedEmbeddedAddress,
    chainId: APP_CHAIN_ID,
    query: {
      enabled: Boolean(normalizedEmbeddedAddress),
      refetchInterval: isPageVisible ? 12_000 : 45_000,
      staleTime: isPageVisible ? 30_000 : 90_000,
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

    const liveToken = formatBalanceFixed(embeddedTokenBalance, 2);
    const liveEth = formatBalanceFixed(embeddedEthBalance, 4);
    const nextCached: CachedPrivyBalances = {
      token: liveToken ?? cachedBalances.token,
      tokenUpdatedAt: liveToken ? embeddedTokenStatus.updatedAt ?? cachedBalances.tokenUpdatedAt : cachedBalances.tokenUpdatedAt,
      eth: liveEth ?? cachedBalances.eth,
      ethUpdatedAt: liveEth ? embeddedEthUpdatedAt || cachedBalances.ethUpdatedAt : cachedBalances.ethUpdatedAt,
    };

    if (
      nextCached.token === cachedBalances.token &&
      nextCached.tokenUpdatedAt === cachedBalances.tokenUpdatedAt &&
      nextCached.eth === cachedBalances.eth &&
      nextCached.ethUpdatedAt === cachedBalances.ethUpdatedAt
    ) return;

    setCachedBalanceEntry({ cacheKey: balanceCacheKey, balances: nextCached });
    try {
      window.localStorage.setItem(balanceCacheKey, JSON.stringify(nextCached));
    } catch {
      // Ignore storage quota/privacy mode failures.
    }
  }, [
    balanceCacheKey,
    cachedBalances,
    embeddedEthBalance,
    embeddedEthUpdatedAt,
    embeddedTokenBalance,
    embeddedTokenStatus.updatedAt,
  ]);
  const livePrivyBalance = formatBalanceFixed(embeddedTokenBalance, 2);
  const formattedPrivyBalance = livePrivyBalance ?? cachedBalances.token;
  const livePrivyEthBalance = formatBalanceFixed(embeddedEthBalance, 4);
  const formattedPrivyEthBalance = livePrivyEthBalance ?? cachedBalances.eth;

  const headerEthBalanceStatus = useMemo(
    () => ({
      ...toWalletBalanceDataStatus({
        dataUpdatedAt: embeddedEthUpdatedAt,
        isError: embeddedEthError,
        isFetching: embeddedEthFetching,
        isStale: embeddedEthStale,
      }),
      stale: embeddedEthStale || (!livePrivyEthBalance && Boolean(cachedBalances.eth)),
      updatedAt: embeddedEthUpdatedAt || cachedBalances.ethUpdatedAt,
    }),
    [cachedBalances.eth, cachedBalances.ethUpdatedAt, embeddedEthError, embeddedEthFetching, embeddedEthStale, embeddedEthUpdatedAt, livePrivyEthBalance],
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

  const headerLineaLoading = isHeaderLineaBalanceLoading(embeddedTokenPending);
  const headerLineaBalanceStatus = useMemo(
    () => ({
      ...embeddedTokenStatus,
      stale: embeddedTokenStatus.stale || (!livePrivyBalance && Boolean(cachedBalances.token)),
      updatedAt: embeddedTokenStatus.updatedAt ?? cachedBalances.tokenUpdatedAt,
    }),
    [cachedBalances.token, cachedBalances.tokenUpdatedAt, embeddedTokenStatus, livePrivyBalance],
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
      headerEthBalanceStatus,
      headerLineaBalanceStatus,
      headerEthLoading: embeddedEthPending,
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
      headerEthBalanceStatus,
      headerLineaBalanceStatus,
    ],
  );
}
