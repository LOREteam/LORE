"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  AUTO_MINE_DEBUG_OVERRIDE_EVENT,
  AUTO_MINE_DEBUG_OVERRIDE_STORAGE_KEY,
  canUseAutoMineDebugOverride,
  clearAutoMineDebugOverride,
  sanitizeAutoMineDebugOverride,
  type AutoMineDebugOverride,
} from "../lib/mining/autoMineDebugOverride";

function getAutoMineDebugOverrideSnapshot() {
  if (typeof window === "undefined" || !canUseAutoMineDebugOverride()) return null;
  try {
    return window.localStorage.getItem(AUTO_MINE_DEBUG_OVERRIDE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function subscribeAutoMineDebugOverride(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};

  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key === AUTO_MINE_DEBUG_OVERRIDE_STORAGE_KEY) {
      onStoreChange();
    }
  };

  window.addEventListener("storage", onStorage);
  window.addEventListener(AUTO_MINE_DEBUG_OVERRIDE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(AUTO_MINE_DEBUG_OVERRIDE_EVENT, onStoreChange);
  };
}

export function useAutoMineDebugOverride() {
  const rawOverride = useSyncExternalStore(
    subscribeAutoMineDebugOverride,
    getAutoMineDebugOverrideSnapshot,
    () => null,
  );

  const override = useMemo<AutoMineDebugOverride | null>(() => {
    if (!rawOverride) return null;
    try {
      return sanitizeAutoMineDebugOverride(JSON.parse(rawOverride));
    } catch {
      return null;
    }
  }, [rawOverride]);

  useEffect(() => {
    if (rawOverride && !override) clearAutoMineDebugOverride();
  }, [override, rawOverride]);

  return override;
}
