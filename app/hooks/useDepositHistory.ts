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

interface ApiRewardInfo {
  reward: string;
  winningTile: number;
  rewardPool: string;
  winningTilePool: string;
  userWinningAmount: string;
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
      const uniqueEpochs = [...new Set(deposits.map((d) => d.epoch))];
      let rewardsMap: Record<string, ApiRewardInfo> = {};
      if (uniqueEpochs.length > 0) {
        try {
          const rewardsRes = await fetch("/api/rewards", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              user: userAddress.toLowerCase(),
              epochs: uniqueEpochs,
            }),
          });
          if (rewardsRes.ok) {
            const rewardsJson = (await rewardsRes.json()) as { rewards?: Record<string, ApiRewardInfo> };
            rewardsMap = rewardsJson.rewards ?? {};
          }
        } catch {
          rewardsMap = {};
        }
      }

      const entries: DepositEntry[] = deposits.map((d) => {
        const epochData = epochsMap[d.epoch];
        const rewardData = rewardsMap[d.epoch];
        const winningTile = epochData?.winningTile ?? rewardData?.winningTile ?? null;
        let reward: number | null = null;

        if (rewardData && winningTile !== null && d.tileIds.includes(winningTile)) {
          const userWinningAmount = parseFloat(rewardData.userWinningAmount);
          const totalReward = parseFloat(rewardData.reward);
          if (userWinningAmount > 0 && totalReward > 0) {
            let rowWinningAmount = 0;
            if (Array.isArray(d.amounts) && d.amounts.length === d.tileIds.length) {
              d.tileIds.forEach((tileId, index) => {
                if (tileId === winningTile) {
                  rowWinningAmount += parseFloat(d.amounts?.[index] ?? "0");
                }
              });
            } else {
              const hitCount = d.tileIds.filter((tileId) => tileId === winningTile).length;
              if (hitCount > 0 && d.tileIds.length > 0) {
                rowWinningAmount = (d.totalAmountNum / d.tileIds.length) * hitCount;
              }
            }
            if (rowWinningAmount > 0) {
              reward = (totalReward * rowWinningAmount) / userWinningAmount;
            }
          }
        }

        return {
          epoch: d.epoch,
          tileIds: d.tileIds,
          amount: parseFloat(d.totalAmount).toFixed(2),
          amountNum: d.totalAmountNum,
          txHash: d.txHash,
          winningTile,
          reward,
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
