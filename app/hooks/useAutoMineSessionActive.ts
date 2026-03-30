"use client";

import { useEffect, useState } from "react";
import { AUTO_MINER_SESSION_EVENT, AUTO_MINER_STORAGE_KEY, readSession } from "./useMining.shared";

export function useAutoMineSessionActive() {
  const [autoMineSessionActive, setAutoMineSessionActive] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setAutoMineSessionActive(Boolean(readSession()?.active));
    sync();
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === AUTO_MINER_STORAGE_KEY) sync();
    };
    const onSessionChange = () => sync();
    window.addEventListener("storage", onStorage);
    window.addEventListener(AUTO_MINER_SESSION_EVENT, onSessionChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(AUTO_MINER_SESSION_EVENT, onSessionChange);
    };
  }, []);

  return autoMineSessionActive;
}
