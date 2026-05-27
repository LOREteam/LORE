"use client";

import { useMemo } from "react";
import { getAddress } from "viem";
import { useAccount, useBalance } from "wagmi";
import type { WagmiBalanceLike } from "../lib/balanceFormatting";
import { APP_CHAIN_ID, LINEA_TOKEN_ADDRESS } from "../lib/constants";
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

  const { data: tokenBalanceRaw } = useBalance({
    address: walletAddress,
    token: LINEA_TOKEN_ADDRESS,
    chainId,
  } as unknown as Parameters<typeof useBalance>[0]);
  const tokenBalance = tokenBalanceRaw as WagmiBalanceLike;
  const isPageVisible = usePageVisibility();
  const autoMineSessionActive = useAutoMineSessionActive();

  return useMemo(
    () => ({
      address,
      chainId,
      walletAddress,
      tokenBalance,
      isPageVisible,
      autoMineSessionActive,
    }),
    [address, chainId, walletAddress, tokenBalance, isPageVisible, autoMineSessionActive],
  );
}
