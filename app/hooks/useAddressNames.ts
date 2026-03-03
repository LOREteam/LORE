"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FIREBASE_DB_URL } from "../lib/firebase";

type NameMap = Map<string, string>;

const CACHE_TTL_MS = 60_000;
let globalCache: { map: NameMap; fetchedAt: number } | null = null;

async function fetchChatNames(): Promise<NameMap> {
  if (globalCache && Date.now() - globalCache.fetchedAt < CACHE_TTL_MS) {
    return globalCache.map;
  }

  const map: NameMap = new Map();
  try {
    // 1) Dedicated per-wallet chat profile storage (survives browser cache clear)
    const profileRes = await fetch(`${FIREBASE_DB_URL}/gamedata/chatProfiles.json`);
    if (profileRes.ok) {
      const profileData = await profileRes.json();
      if (profileData && typeof profileData === "object") {
        for (const [address, val] of Object.entries(profileData as Record<string, unknown>)) {
          const v = val as Record<string, unknown>;
          const name = typeof v.name === "string" ? v.name.trim() : "";
          if (name) map.set(address.toLowerCase(), name);
        }
      }
    }

    // 2) Fallback from recent messages (legacy behavior)
    const url = `${FIREBASE_DB_URL}/messages.json?orderBy="timestamp"&limitToLast=200`;
    const res = await fetch(url);
    if (!res.ok) return map;
    const data = await res.json();
    if (!data || typeof data !== "object") return map;

    for (const val of Object.values(data)) {
      const v = val as Record<string, unknown>;
      const sender = typeof v.sender === "string" ? v.sender.toLowerCase() : "";
      const name = typeof v.senderName === "string" ? v.senderName : undefined;
      if (sender && name && !map.has(sender)) map.set(sender, name);
    }
  } catch {
    // silent
  }

  globalCache = { map, fetchedAt: Date.now() };
  return map;
}

export function useAddressNames(addresses: string[]) {
  const [nameMap, setNameMap] = useState<NameMap>(new Map());
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (addresses.length === 0) return;
    if (fetchedRef.current && globalCache && Date.now() - globalCache.fetchedAt < CACHE_TTL_MS) return;
    fetchedRef.current = true;
    let cancelled = false;

    fetchChatNames().then((map) => {
      if (!cancelled) setNameMap(map);
    });
    return () => { cancelled = true; };
  }, [addresses]);

  const resolveName = useCallback(
    (address: string): { display: string; source: "chat" | "raw" } => {
      const chatName = nameMap.get(address.toLowerCase());
      if (chatName) return { display: chatName, source: "chat" };
      return { display: "", source: "raw" };
    },
    [nameMap],
  );

  return { resolveName };
}
