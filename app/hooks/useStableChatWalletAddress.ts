"use client";

import { useEffect, useMemo, useState } from "react";

const CHAT_WALLET_STORAGE_KEY = "lore:chat-wallet-address";

function normalizeCandidate(address: string | null | undefined): `0x${string}` | null {
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) return null;
  return address.toLowerCase() as `0x${string}`;
}

export function useStableChatWalletAddress(...addresses: Array<string | null | undefined>) {
  const candidates = useMemo(() => {
    const seen = new Set<string>();
    return addresses
      .map((value) => normalizeCandidate(value))
      .filter((value): value is `0x${string}` => Boolean(value))
      .filter((value) => {
        if (seen.has(value)) return false;
        seen.add(value);
        return true;
      });
  }, [addresses]);

  const [stableAddress, setStableAddress] = useState<`0x${string}` | null>(() => {
    if (typeof window === "undefined") return candidates[0] ?? null;
    const stored = normalizeCandidate(window.localStorage.getItem(CHAT_WALLET_STORAGE_KEY));
    if (stored && candidates.includes(stored)) return stored;
    return candidates[0] ?? stored ?? null;
  });

  useEffect(() => {
    const next =
      (stableAddress && candidates.includes(stableAddress) ? stableAddress : null) ??
      (() => {
        if (typeof window === "undefined") return null;
        const stored = normalizeCandidate(window.localStorage.getItem(CHAT_WALLET_STORAGE_KEY));
        return stored && candidates.includes(stored) ? stored : null;
      })() ??
      candidates[0] ??
      null;

    if (next !== stableAddress) {
      setStableAddress(next);
    }

    if (typeof window === "undefined") return;
    try {
      if (next) {
        window.localStorage.setItem(CHAT_WALLET_STORAGE_KEY, next);
      } else {
        window.localStorage.removeItem(CHAT_WALLET_STORAGE_KEY);
      }
    } catch {
      // ignore quota / private mode
    }
  }, [candidates, stableAddress]);

  return stableAddress;
}
