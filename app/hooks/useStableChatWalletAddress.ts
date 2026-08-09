"use client";

import { useEffect, useMemo, useState } from "react";
import { getAddress } from "viem";

const CHAT_WALLET_STORAGE_KEY = "lore:chat-wallet-address";

function clearStoredChatWalletAddress() {
  try {
    window.localStorage.removeItem(CHAT_WALLET_STORAGE_KEY);
  } catch {
    // ignore quota / private mode
  }
}

function normalizeCandidate(address: string | null | undefined): `0x${string}` | null {
  if (!address) return null;
  try {
    return getAddress(address).toLowerCase() as `0x${string}`;
  } catch {
    return null;
  }
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
    const rawStored = window.localStorage.getItem(CHAT_WALLET_STORAGE_KEY);
    const stored = normalizeCandidate(rawStored);
    if (stored && candidates.includes(stored)) return stored;
    if (rawStored !== null) clearStoredChatWalletAddress();
    return candidates[0] ?? null;
  });

  useEffect(() => {
    const next =
      (stableAddress && candidates.includes(stableAddress) ? stableAddress : null) ??
      (() => {
        if (typeof window === "undefined") return null;
        const rawStored = window.localStorage.getItem(CHAT_WALLET_STORAGE_KEY);
        const stored = normalizeCandidate(rawStored);
        if (stored && candidates.includes(stored)) return stored;
        if (rawStored !== null) clearStoredChatWalletAddress();
        return null;
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
        clearStoredChatWalletAddress();
      }
    } catch {
      // ignore quota / private mode
    }
  }, [candidates, stableAddress]);

  return stableAddress;
}
