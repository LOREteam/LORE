"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readJsonResponse } from "../lib/readJsonResponse";

type NameMap = Map<string, string>;

const CACHE_TTL_MS = 60_000;
const STORAGE_KEY = "lore:address-names-cache:v1";
let globalCache: { map: NameMap; fetchedAt: number } | null = null;

function serializeNameMap(map: NameMap) {
  return Object.fromEntries(map.entries());
}

function loadCachedNames(): { map: NameMap; fetchedAt: number } | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { names?: Record<string, string>; fetchedAt?: number };
    if (!parsed?.names || typeof parsed.fetchedAt !== "number") return null;
    const map = new Map<string, string>();
    for (const [address, name] of Object.entries(parsed.names)) {
      const trimmed = typeof name === "string" ? name.trim() : "";
      if (trimmed) map.set(address.toLowerCase(), trimmed);
    }
    return { map, fetchedAt: parsed.fetchedAt };
  } catch {
    return null;
  }
}

function saveCachedNames(map: NameMap, fetchedAt: number) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      names: serializeNameMap(map),
      fetchedAt,
    }));
  } catch {
    // ignore storage failures
  }
}

async function fetchChatNames(): Promise<NameMap> {
  if (globalCache && Date.now() - globalCache.fetchedAt < CACHE_TTL_MS) {
    return globalCache.map;
  }

  const map: NameMap = new Map();
  try {
    const profileRes = await fetch("/api/chat/profile", { cache: "no-store" });
    if (profileRes.ok) {
      const profileData = await readJsonResponse<{ profiles?: Record<string, unknown> }>(profileRes);
      if (profileData?.profiles && typeof profileData.profiles === "object") {
        for (const [address, val] of Object.entries(profileData.profiles)) {
          const v = val as Record<string, unknown>;
          const name = typeof v.name === "string" ? v.name.trim() : "";
          if (name) map.set(address.toLowerCase(), name);
        }
      }
    }
  } catch {
    // silent
  }

  const fetchedAt = Date.now();
  globalCache = { map, fetchedAt };
  saveCachedNames(map, fetchedAt);
  return map;
}

export function useAddressNames(addresses: string[]) {
  const [nameMap, setNameMap] = useState<NameMap>(() => {
    const cached = globalCache ?? loadCachedNames();
    if (cached) {
      globalCache = cached;
      return cached.map;
    }
    return new Map();
  });
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (addresses.length === 0) return;
    if (globalCache) {
      setNameMap(globalCache.map);
    }
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
