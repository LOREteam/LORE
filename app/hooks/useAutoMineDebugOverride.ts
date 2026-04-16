"use client";

import { useEffect, useState } from "react";
import {
  AUTO_MINE_DEBUG_OVERRIDE_EVENT,
  AUTO_MINE_DEBUG_OVERRIDE_STORAGE_KEY,
  canUseAutoMineDebugOverride,
  readAutoMineDebugOverride,
  type AutoMineDebugOverride,
} from "../lib/mining/autoMineDebugOverride";

export function useAutoMineDebugOverride() {
  const [override, setOverride] = useState<AutoMineDebugOverride | null>(null);
  const enabled = canUseAutoMineDebugOverride();

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const sync = () => setOverride(readAutoMineDebugOverride());
    sync();

    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === AUTO_MINE_DEBUG_OVERRIDE_STORAGE_KEY) {
        sync();
      }
    };
    const onOverrideChange = () => sync();

    window.addEventListener("storage", onStorage);
    window.addEventListener(AUTO_MINE_DEBUG_OVERRIDE_EVENT, onOverrideChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(AUTO_MINE_DEBUG_OVERRIDE_EVENT, onOverrideChange);
    };
  }, [enabled]);

  return enabled ? override : null;
}
