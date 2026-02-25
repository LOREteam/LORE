"use client";

import { PrivyProvider } from '@privy-io/react-auth';
import { WagmiProvider, createConfig } from '@privy-io/wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, fallback, defineChain } from 'viem';
import { lineaSepolia as baseLineaSepolia } from 'viem/chains';

if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  const _origError = console.error;
  console.error = (...args: unknown[]) => {
    if (
      typeof args[0] === "string" &&
      args[0].includes("React does not recognize the `isActive` prop")
    ) {
      return;
    }
    _origError.apply(console, args);
  };
}

// Higher staleTime reduces RPC load: data stays "fresh" longer, fewer duplicate refetches.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000, // 10s – fewer refetches, less load on public RPC
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Custom Linea Sepolia chain with an RPC that supports eth_sendRawTransaction.
 * The default rpc.sepolia.linea.build does NOT support it, which breaks
 * Privy's useSendTransaction (it signs client-side and broadcasts raw).
 */
export const lineaSepoliaChain = defineChain({
  ...baseLineaSepolia,
  rpcUrls: {
    default: {
      http: ['https://linea-sepolia-rpc.publicnode.com'],
    },
  },
});

export const wagmiConfig = createConfig({
  chains: [lineaSepoliaChain],
  transports: {
    [lineaSepoliaChain.id]: fallback([
      http('https://linea-sepolia-rpc.publicnode.com'),
      http('https://rpc.sepolia.linea.build'),
      http('https://linea-sepolia.public.blastapi.io'),
      http('https://linea-sepolia.drpc.org'),
    ]),
  },
  batch: {
    multicall: true,
  },
});

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId="cmlqkgtmg00og0cjueu4mxmn9"
      config={{
        defaultChain: lineaSepoliaChain,
        supportedChains: [lineaSepoliaChain],
        appearance: {
          theme: 'dark',
          accentColor: '#6c38ff',
        },
        embeddedWallets: {
          showWalletUIs: false,
          ethereum: {
            createOnLogin: 'users-without-wallets',
          },
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          {children}
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
