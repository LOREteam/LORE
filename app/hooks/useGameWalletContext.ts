"use client";

import { useMemo } from "react";
import { getAddress } from "viem";
import { useAccount, useBalance } from "wagmi";
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

  const { data: tokenBalance } = useBalance({
    address: walletAddress,
    token: LINEA_TOKEN_ADDRESS,
    chainId,
  });
  const isPageVisible = usePageVisibility();
  const autoMineSessionActive = useAutoMineSessionActive();

  return {
    address,
    chainId,
    walletAddress,
    tokenBalance,
    isPageVisible,
    autoMineSessionActive,
  };
}
