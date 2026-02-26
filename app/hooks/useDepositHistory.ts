"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface DepositEntry {
  epoch: string;
  tileIds: number[];
  amount: string;
  amountNum: number;
  txHash: string;
  winningTile: number | null;
  reward: number | null;
}

interface ApiDeposit {
  epoch: string;
  tileIds: number[];
  totalAmount: string;
  totalAmountNum: number;
  txHash: string;
  blockNumber: string;
  amounts?: string[];
}

interface ApiEpoch {
  winningTile: number;
  rewardPool: string;
}

export function useDepositHistory(userAddress?: string) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DepositEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);

  const fetchFromApi = useCallback(async () => {
    if (!userAddress) return;
    if (runningRef.current) return;
    runningRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const [depositsResult, epochsResult] = await Promise.allSettled([
        fetch(`/api/deposits?user=${userAddress.toLowerCase()}`),
        fetch(`/api/epochs`),
      ]);

      if (depositsResult.status === "rejected") {
        setError("Network error while loading deposits");
        setData([]);
        return;
      }

      const depositsRes = depositsResult.value;
      let depositsJson: { deposits?: ApiDeposit[]; error?: string } = {};
      try {
        depositsJson = await depositsRes.json();
      } catch {
        depositsJson = {};
      }

      if (!depositsRes.ok || depositsJson.error) {
        setError(depositsJson.error || `HTTP ${depositsRes.status}`);
        setData([]);
        return;
      }

      let epochsMap: Record<string, ApiEpoch> = {};
      if (epochsResult.status === "fulfilled" && epochsResult.value.ok) {
        try {
          const epochsJson = (await epochsResult.value.json()) as { epochs?: Record<string, ApiEpoch> };
          epochsMap = epochsJson.epochs ?? {};
        } catch {
          epochsMap = {};
        }
      }

      const deposits: ApiDeposit[] = depositsJson.deposits ?? [];
      const entries: DepositEntry[] = deposits.map((d) => {
        const epochData = epochsMap[d.epoch];
        return {
          epoch: d.epoch,
          tileIds: d.tileIds,
          amount: parseFloat(d.totalAmount).toFixed(2),
          amountNum: d.totalAmountNum,
          txHash: d.txHash,
          winningTile: epochData?.winningTile ?? null,
          reward: null,
        };
      });

      entries.sort((a, b) => Number(b.epoch) - Number(a.epoch));
      setData(entries);
    } catch (err) {
      console.error("[useDepositHistory] API fetch failed:", err);
      setError((err as Error).message || "Network error");
      setData([]);
    } finally {
      setLoading(false);
      runningRef.current = false;
    }
  }, [userAddress]);

  useEffect(() => {
    if (!userAddress) {
      setData(null);
      setError(null);
      return;
    }
    void fetchFromApi();
  }, [userAddress, fetchFromApi]);

  const refresh = useCallback(async () => {
    await fetchFromApi();
  }, [fetchFromApi]);

  const totalDeposited = useMemo(
    () => (data ?? []).reduce((sum, e) => sum + e.amountNum, 0),
    [data],
  );

  return { data, loading, totalDeposited, error, fetch: fetchFromApi, refresh };
}
