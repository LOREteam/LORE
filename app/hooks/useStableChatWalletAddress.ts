"use client";

import { useEffect, useMemo, useState } from "react";
import {
  normalizeChatWalletCandidates,
  persistStableChatWalletAddress,
  selectStableChatWalletAddress,
} from "../lib/chatWalletRuntime";

export function useStableChatWalletAddress(...addresses: Array<string | null | undefined>) {
  const candidates = useMemo(() => {
    return normalizeChatWalletCandidates(addresses);
  }, [addresses]);

  const [stableAddress, setStableAddress] = useState<`0x${string}` | null>(() => {
    return selectStableChatWalletAddress(
      typeof window === "undefined" ? null : window.localStorage,
      candidates,
    );
  });

  useEffect(() => {
    const next = selectStableChatWalletAddress(
      typeof window === "undefined" ? null : window.localStorage,
      candidates,
      stableAddress,
    );

    if (next !== stableAddress) {
      setStableAddress(next);
    }

    if (typeof window !== "undefined") persistStableChatWalletAddress(window.localStorage, next);
  }, [candidates, stableAddress]);

  return stableAddress;
}
