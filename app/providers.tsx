"use client";

import { useMemo } from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { WagmiProvider as PrivyWagmiProvider, createConfig } from '@privy-io/wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, fallback, defineChain, type Transport } from 'viem';
import { APP_CHAIN } from './lib/constants';
import { getStableLineaReadRpcs, isDeprecatedLineaRpc, isUnstableLineaReadRpc } from '../config/publicConfig';

// Higher staleTime reduces RPC load: data stays "fresh" longer, fewer duplicate refetches.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000, // 10s - fewer refetches, less load on public RPC
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Custom Linea chain definition with app-configured RPC priority.
 * Privy tends to prefer the first RPC for raw transaction broadcast, so
 * production can pin a provider via NEXT_PUBLIC_LINEA_RPCS when needed.
 */
const ENV_RPCS =
  (process.env.NEXT_PUBLIC_LINEA_RPCS ?? process.env.NEXT_PUBLIC_LINEA_SEPOLIA_RPCS)
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean) ?? [];

const APP_NETWORK = APP_CHAIN.id === 59144 ? "mainnet" : "sepolia";

const FILTERED_ENV_RPCS = ENV_RPCS
  .filter((url) => !isDeprecatedLineaRpc(url))
  .filter((url) => !isUnstableLineaReadRpc(url, APP_NETWORK));

// If env list is provided, use only it. This allows hard-excluding flaky providers in production.
const RPC_URLS = [...new Set(
  FILTERED_ENV_RPCS.length > 0
    ? FILTERED_ENV_RPCS
    : getStableLineaReadRpcs(undefined, APP_NETWORK),
)];
export const appChain = defineChain({
  ...APP_CHAIN,
  rpcUrls: {
    default: {
      // Privy mostly uses the first RPC here for raw tx broadcast.
      http: RPC_URLS,
    },
  },
});

export const wagmiConfig = createConfig({
  chains: [appChain],
  transports: {
    [appChain.id]: fallback([
      ...RPC_URLS.map((url) => http(url, { timeout: 12_000, retryCount: 1 })),
    ], { rank: false }),
  } as Record<(typeof appChain)["id"], Transport>,
  batch: {
    multicall: true,
  },
});

export default function Providers({ children }: { children: React.ReactNode }) {
  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "cmlqkgtmg00og0cjueu4mxmn9";

  const privyConfig = useMemo(() => ({
    defaultChain: appChain,
    supportedChains: [appChain],
    appearance: {
      theme: 'dark' as const,
      accentColor: '#6c38ff' as const,
    },
    embeddedWallets: {
      showWalletUIs: false,
      ethereum: {
        createOnLogin: 'users-without-wallets' as const,
      },
    },
  }), []);

  const secureAppTree = (
    <QueryClientProvider client={queryClient}>
      <PrivyWagmiProvider config={wagmiConfig}>
        {children}
      </PrivyWagmiProvider>
    </QueryClientProvider>
  );

  return (
    <PrivyProvider
      appId={privyAppId}
      config={privyConfig}
    >
      {secureAppTree}
    </PrivyProvider>
  );
}
