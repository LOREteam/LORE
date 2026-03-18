"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePublicClient } from "wagmi";
import { decodeEventLog, encodeEventTopics, formatUnits, type Hex, type Log } from "viem";
import {
  APP_CHAIN_ID,
  CONTRACT_ADDRESS,
  CONTRACT_DEPLOY_BLOCK,
  GAME_ABI,
  GAME_EVENTS_ABI,
  LEADERBOARD_TOP_N,
} from "../lib/constants";
import type { LeaderboardEntry, LuckyTileEntry } from "../lib/types";

const CHUNK_BLOCKS = 50_000;
const MAX_CONCURRENT = 4;
const MULTICALL_BATCH = 200;
const STORAGE_KEY = `lore:leaderboard:v2:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`;

interface UserAgg {
  w: string;
  n: string;
  m: string;
  c: number;
}

interface UnderdogRow {
  u: string;
  e: string;
  r: string;
  t: number;
  p: string;
}

interface CachedLeaderboard {
  lb: string;
  us: Record<string, UserAgg>;
  tw: Record<string, number>;
  rc: number;
  ud: UnderdogRow[];
}

function loadCache(): CachedLeaderboard | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CachedLeaderboard;
  } catch {
    return null;
  }
}

function saveCache(cache: CachedLeaderboard) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // ignore quota issues
  }
}

export interface LeaderboardsData {
  biggestSingleWin: LeaderboardEntry[];
  luckiest: LeaderboardEntry[];
  oneTileWonder: LeaderboardEntry[];
  mostWins: LeaderboardEntry[];
  whales: LeaderboardEntry[];
  underdog: LeaderboardEntry[];
  luckyTile: LuckyTileEntry[];
}

function buildFromCache(cache: CachedLeaderboard): LeaderboardsData {
  const fmt = (v: bigint) => parseFloat(formatUnits(v, 18)).toFixed(2);
  const N = LEADERBOARD_TOP_N;

  const users = Object.entries(cache.us).map(([addr, u]) => ({
    addr,
    totalWagered: BigInt(u.w),
    totalWon: BigInt(u.n),
    maxSingleWin: BigInt(u.m),
    winCount: u.c,
  }));

  const biggestSingleWin: LeaderboardEntry[] = [...users]
    .sort((a, b) => (b.maxSingleWin > a.maxSingleWin ? 1 : b.maxSingleWin < a.maxSingleWin ? -1 : 0))
    .slice(0, N)
    .filter((u) => u.maxSingleWin > BigInt(0))
    .map((u, i) => ({
      rank: i + 1,
      address: u.addr,
      value: fmt(u.maxSingleWin),
      valueNum: Number(formatUnits(u.maxSingleWin, 18)),
    }));

  const oneTileWonder = biggestSingleWin;

  const mostWins: LeaderboardEntry[] = [...users]
    .sort((a, b) => b.winCount - a.winCount)
    .slice(0, N)
    .filter((u) => u.winCount > 0)
    .map((u, i) => ({ rank: i + 1, address: u.addr, value: String(u.winCount), valueNum: u.winCount }));

  const luckiest: LeaderboardEntry[] = users
    .filter((u) => u.totalWagered > BigInt(0) && u.totalWon > BigInt(0))
    .map((u) => ({
      addr: u.addr,
      roi: Number((u.totalWon * BigInt(10000)) / u.totalWagered) / 100,
      totalWon: u.totalWon,
      totalWagered: u.totalWagered,
    }))
    .sort((a, b) => b.roi - a.roi)
    .slice(0, N)
    .map((u, i) => ({
      rank: i + 1,
      address: u.addr,
      value: `${u.roi.toFixed(1)}%`,
      valueNum: u.roi,
      extra: `won ${formatUnits(u.totalWon, 18)} / wagered ${formatUnits(u.totalWagered, 18)}`,
    }));

  const whales: LeaderboardEntry[] = [...users]
    .sort((a, b) => (b.totalWagered > a.totalWagered ? 1 : b.totalWagered < a.totalWagered ? -1 : 0))
    .slice(0, N)
    .filter((u) => u.totalWagered > BigInt(0))
    .map((u, i) => ({
      rank: i + 1,
      address: u.addr,
      value: fmt(u.totalWagered),
      valueNum: Number(formatUnits(u.totalWagered, 18)),
    }));

  const luckyTile: LuckyTileEntry[] = Object.entries(cache.tw)
    .map(([id, wins]) => ({
      tileId: Number(id),
      wins,
      pct: cache.rc > 0 ? (wins / cache.rc) * 100 : 0,
    }))
    .sort((a, b) => b.wins - a.wins);

  const underdog: LeaderboardEntry[] = cache.ud.map((u, i) => ({
    rank: i + 1,
    address: u.u,
    value: fmt(BigInt(u.r)),
    valueNum: Number(formatUnits(BigInt(u.r), 18)),
    extra: `pool on tile ${u.t} was ${fmt(BigInt(u.p))} LINEA`,
  }));

  return { biggestSingleWin, luckiest, oneTileWonder, mostWins, whales, underdog, luckyTile };
}

export function useLeaderboards(enabled: boolean) {
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LeaderboardsData | null>(null);
  const runningRef = useRef(false);
  const restoredRef = useRef(false);

  useEffect(() => {
    if (!enabled || restoredRef.current) return;
    restoredRef.current = true;
    const cached = loadCache();
    if (cached && Object.keys(cached.us).length > 0) {
      setData(buildFromCache(cached));
    }
  }, [enabled]);

  const fetchAll = useCallback(async (force = false) => {
    if (!publicClient || !enabled || runningRef.current) return;
    runningRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const toBlock = await publicClient.getBlockNumber();
      const cache = force ? null : loadCache();
      const fromBlock = cache
        ? (BigInt(cache.lb) + 1n > CONTRACT_DEPLOY_BLOCK ? BigInt(cache.lb) + 1n : CONTRACT_DEPLOY_BLOCK)
        : CONTRACT_DEPLOY_BLOCK;

      if (fromBlock > toBlock && cache) {
        setData(buildFromCache(cache));
        return;
      }

      const eventSigs: Hex[] = [];
      for (const eventName of ["RewardClaimed", "BetPlaced", "BatchBetsPlaced", "EpochResolved"] as const) {
        try {
          const topics = encodeEventTopics({ abi: GAME_EVENTS_ABI, eventName });
          if (topics[0]) eventSigs.push(topics[0]);
        } catch {
          // ignore abi issues
        }
      }

      const chunks: { from: bigint; to: bigint }[] = [];
      for (let f = fromBlock; f <= toBlock; f += BigInt(CHUNK_BLOCKS)) {
        const t = f + BigInt(CHUNK_BLOCKS) > toBlock ? toBlock : f + BigInt(CHUNK_BLOCKS - 1);
        chunks.push({ from: f, to: t });
      }

      const allLogs: Log[] = [];
      for (let i = 0; i < chunks.length; i += MAX_CONCURRENT) {
        const batch = chunks.slice(i, i + MAX_CONCURRENT);
        const results = await Promise.all(
          batch.map((chunk) =>
            publicClient.getLogs({
              address: CONTRACT_ADDRESS,
              topics: eventSigs.length > 0 ? [eventSigs] : undefined,
              fromBlock: chunk.from,
              toBlock: chunk.to,
            } as Parameters<typeof publicClient.getLogs>[0]),
          ),
        );
        for (const result of results) allLogs.push(...result);
      }

      const us: Record<string, UserAgg> = cache?.us ? { ...cache.us } : {};
      const tw: Record<string, number> = cache?.tw ? { ...cache.tw } : {};
      let rc = cache?.rc ?? 0;

      const newClaims: { epoch: bigint; user: string; reward: bigint }[] = [];
      const newResolved: { epoch: bigint; winningTile: bigint }[] = [];

      for (const log of allLogs) {
        try {
          const decoded = decodeEventLog({ abi: GAME_EVENTS_ABI, data: log.data, topics: log.topics });
          if (decoded.eventName === "BetPlaced") {
            const { user, amount } = decoded.args as { user: string; amount: bigint };
            const addr = user.toLowerCase();
            const prev = us[addr] ?? { w: "0", n: "0", m: "0", c: 0 };
            prev.w = (BigInt(prev.w) + amount).toString();
            us[addr] = prev;
          } else if (decoded.eventName === "BatchBetsPlaced") {
            const { user, totalAmount } = decoded.args as { user: string; totalAmount: bigint };
            const addr = user.toLowerCase();
            const prev = us[addr] ?? { w: "0", n: "0", m: "0", c: 0 };
            prev.w = (BigInt(prev.w) + totalAmount).toString();
            us[addr] = prev;
          } else if (decoded.eventName === "RewardClaimed") {
            const { epoch, user, reward } = decoded.args as { epoch: bigint; user: string; reward: bigint };
            const addr = user.toLowerCase();
            const prev = us[addr] ?? { w: "0", n: "0", m: "0", c: 0 };
            prev.n = (BigInt(prev.n) + reward).toString();
            if (reward > BigInt(prev.m)) prev.m = reward.toString();
            prev.c += 1;
            us[addr] = prev;
            newClaims.push({ epoch, user: addr, reward });
          } else if (decoded.eventName === "EpochResolved") {
            const { epoch, winningTile } = decoded.args as { epoch: bigint; winningTile: bigint };
            tw[String(Number(winningTile))] = (tw[String(Number(winningTile))] ?? 0) + 1;
            rc += 1;
            newResolved.push({ epoch, winningTile });
          }
        } catch {
          // ignore malformed log
        }
      }

      const existingUnderdog = cache?.ud ?? [];
      let underdogCandidates = [...existingUnderdog];

      if (newClaims.length > 0) {
        const epochToTile = new Map<string, number>();
        for (const resolved of newResolved) epochToTile.set(resolved.epoch.toString(), Number(resolved.winningTile));
        for (const row of existingUnderdog) epochToTile.set(row.e, row.t);

        const pairs = newClaims
          .map((claim) => {
            const tile = epochToTile.get(claim.epoch.toString());
            return tile != null ? { epoch: claim.epoch, tile, user: claim.user, reward: claim.reward } : null;
          })
          .filter((value): value is NonNullable<typeof value> => value != null);

        const uniquePairs = Array.from(new Map(pairs.map((pair) => [`${pair.epoch}-${pair.tile}`, pair])).values());

        if (uniquePairs.length > 0) {
          const poolMap = new Map<string, bigint>();
          for (let i = 0; i < uniquePairs.length; i += MULTICALL_BATCH) {
            const batch = uniquePairs.slice(i, i + MULTICALL_BATCH);
            const contracts = batch.map((pair) => ({
              address: CONTRACT_ADDRESS,
              abi: GAME_ABI,
              functionName: "tilePools" as const,
              args: [pair.epoch, BigInt(pair.tile)] as const,
            }));
            const results = await publicClient.multicall({ contracts });
            batch.forEach((pair, index) => {
              const result = results[index];
              poolMap.set(
                `${pair.epoch}-${pair.tile}`,
                result?.status === "success" && result.result != null ? (result.result as bigint) : BigInt(0),
              );
            });
          }

          for (const pair of pairs) {
            const pool = poolMap.get(`${pair.epoch}-${pair.tile}`) ?? BigInt(0);
            if (pool > BigInt(0)) {
              underdogCandidates.push({
                u: pair.user,
                e: pair.epoch.toString(),
                r: pair.reward.toString(),
                t: pair.tile,
                p: pool.toString(),
              });
            }
          }
        }
      }

      underdogCandidates.sort((a, b) => {
        const poolA = BigInt(a.p);
        const poolB = BigInt(b.p);
        if (poolA !== poolB) return poolA < poolB ? -1 : 1;
        return BigInt(b.r) > BigInt(a.r) ? 1 : -1;
      });
      underdogCandidates = underdogCandidates.slice(0, LEADERBOARD_TOP_N);

      const nextCache: CachedLeaderboard = {
        lb: toBlock.toString(),
        us,
        tw,
        rc,
        ud: underdogCandidates,
      };

      saveCache(nextCache);
      setData(buildFromCache(nextCache));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      runningRef.current = false;
    }
  }, [enabled, publicClient]);

  useEffect(() => {
    if (!enabled) return;
    void fetchAll();
  }, [enabled, fetchAll]);

  const refetch = useCallback(() => {
    void fetchAll(true);
  }, [fetchAll]);

  return { data, loading, error, refetch };
}
