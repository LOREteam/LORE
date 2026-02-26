"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface JackpotHistoryEntry {
  epoch: string;
  amount: string;
  amountNum: number;
  kind: "daily" | "weekly";
  txHash: string;
  blockNumber: bigint;
  timestamp: number | null;
}

const REFRESH_MS = 45_000;

export function useJackpotHistory() {
  const [items, setItems] = useState<JackpotHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const runningRef = useRef(false);

  const refresh = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setLoading(true);

    try {
      const res = await fetch("/api/jackpots");
      const json = await res.json();
      const jackpots = (json.jackpots ?? []) as Array<{
        epoch: string;
        kind: "daily" | "weekly";
        amount: string;
        amountNum: number;
        txHash: string;
        blockNumber: string;
      }>;

      const entries: JackpotHistoryEntry[] = jackpots.map((j) => ({
        epoch: j.epoch,
        amount: parseFloat(j.amount).toFixed(2),
        amountNum: j.amountNum,
        kind: j.kind,
        txHash: j.txHash,
        blockNumber: BigInt(j.blockNumber),
        timestamp: null,
      }));

      setItems(entries);
    } catch (err) {
      console.error("[useJackpotHistory] API fetch failed:", err);
    } finally {
      setLoading(false);
      runningRef.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => { void refresh(); }, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { items, loading, refresh };
}
