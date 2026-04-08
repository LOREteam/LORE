"use client";

import { useLayoutEffect, useMemo, useState } from "react";
import { getAddress } from "viem";
import { usePublicClient } from "wagmi";
import { APP_CHAIN_ID } from "../lib/constants";
import { useAppShellState } from "./useAppShellState";
import { useChartData } from "./useChartData";
import { useGameData } from "./useGameData";
import { type LiveStateApiResponse } from "./useGameLiveStateSnapshot";
import { usePrivyWallet } from "./usePrivyWallet";
import { useReducedMotion } from "./useReducedMotion";
import { useSound } from "./useSound";
import { useStableChatWalletAddress } from "./useStableChatWalletAddress";

interface UseLineaOreClientBaseStateOptions {
  initialLiveState?: LiveStateApiResponse | null;
}

export function useLineaOreClientBaseState({
  initialLiveState = null,
}: UseLineaOreClientBaseStateOptions) {
  const [uiHydrated, setUiHydrated] = useState(false);
  const motion = useReducedMotion();
  const sound = useSound();
  const wallet = usePrivyWallet();

  const normalizedEmbeddedAddress = useMemo(() => {
    if (!wallet.embeddedWalletAddress) return undefined;
    try {
      return getAddress(wallet.embeddedWalletAddress);
    } catch {
      return undefined;
    }
  }, [wallet.embeddedWalletAddress]);

  const shell = useAppShellState();
  const gameData = useGameData({
    historyDetailed: shell.activeTab === "analytics",
    initialServerLiveState: initialLiveState,
    liveGrid: shell.activeTab === "hub",
    preferredAddress: normalizedEmbeddedAddress,
  });

  const chatWalletAddress = useStableChatWalletAddress(
    normalizedEmbeddedAddress,
    wallet.externalWalletAddress,
    gameData.address,
  );

  useLayoutEffect(() => {
    setUiHydrated(true);
  }, []);

  const coldBootDefaults =
    uiHydrated && gameData.liveStateBootstrapPending && !gameData.liveStateReady;
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });
  const chart = useChartData(gameData.realTotalStaked, shell.isPageVisible);

  return {
    uiHydrated,
    motion,
    sound,
    wallet,
    shell,
    gameData,
    chart,
    publicClient,
    normalizedEmbeddedAddress,
    chatWalletAddress,
    coldBootDefaults,
  };
}
