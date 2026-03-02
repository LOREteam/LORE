"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePublicClient } from "wagmi";
import { decodeEventLog, formatUnits, encodeEventTopics, type Log, type Hex, type PublicClient } from "viem";
import {
  CONTRACT_ADDRESS,
  GAME_ABI,
  GAME_EVENTS_ABI,
  APP_CHAIN_ID,
  LEADERBOARD_TOP_N,
} from "../lib/constants";
import type { LeaderboardEntry, LuckyTileEntry } from "../lib/types";

const CHUNK_BLOCKS = 50_000;
const MAX_CONCURRENT = 4;
const MULTICALL_BATCH = 200;
const REFERRAL_STALE_MS = 10 * 60 * 1000;
const STORAGE_KEY = "lore:leaderboard:v1";

// ─── Compact storage format (short keys to minimize size) ───

interface UserAgg {
  w: string;   // totalWagered (bigint)
  n: string;   // totalWon (bigint)
  m: string;   // maxSingleWin (bigint)
  c: number;   // winCount
}

interface UnderdogRow {
  u: string;   // user
  e: string;   // epoch
  r: string;   // reward (bigint)
  t: number;   // tile
  p: string;   // tilePool (bigint)
}

interface RefAgg {
  c: number;   // referralCount
  e: string;   // totalEarnings (bigint)
}

interface CachedLeaderboard {
  lb: string;                       // lastBlock scanned
  us: Record<string, UserAgg>;      // per-user stats
  tw: Record<string, number>;       // tileId → win count
  rc: number;                       // total resolved epochs
  ud: UnderdogRow[];                // top underdog candidates
  rf: Record<string, RefAgg>;       // referral data (periodic)
  rt: number;                       // referrals last updated ts
}

function loadCache(): CachedLeaderboard | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CachedLeaderboard;
  } catch { return null; }
}

function saveCache(c: CachedLeaderboard) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); } catch {}
}

// ─── Build display data from cache ───

export interface LeaderboardsData {
  biggestSingleWin: LeaderboardEntry[];
  luckiest: LeaderboardEntry[];
  oneTileWonder: LeaderboardEntry[];
  mostWins: LeaderboardEntry[];
  whales: LeaderboardEntry[];
  underdog: LeaderboardEntry[];
  luckyTile: LuckyTileEntry[];
  topReferrers: LeaderboardEntry[];
  topReferralEarners: LeaderboardEntry[];
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
    .filter(u => u.maxSingleWin > BigInt(0))
    .map((u, i) => ({ rank: i + 1, address: u.addr, value: fmt(u.maxSingleWin), valueNum: Number(formatUnits(u.maxSingleWin, 18)) }));

  const oneTileWonder = biggestSingleWin;

  const mostWins: LeaderboardEntry[] = [...users]
    .sort((a, b) => b.winCount - a.winCount)
    .slice(0, N)
    .filter(u => u.winCount > 0)
    .map((u, i) => ({ rank: i + 1, address: u.addr, value: String(u.winCount), valueNum: u.winCount }));

  const luckiest: LeaderboardEntry[] = users
    .filter(u => u.totalWagered > BigInt(0) && u.totalWon > BigInt(0))
    .map(u => ({
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
    .filter(u => u.totalWagered > BigInt(0))
    .map((u, i) => ({ rank: i + 1, address: u.addr, value: fmt(u.totalWagered), valueNum: Number(formatUnits(u.totalWagered, 18)) }));

  const totalResolved = cache.rc;
  const luckyTile: LuckyTileEntry[] = Object.entries(cache.tw)
    .map(([id, wins]) => ({ tileId: Number(id), wins, pct: totalResolved > 0 ? (wins / totalResolved) * 100 : 0 }))
    .sort((a, b) => b.wins - a.wins);

  const underdog: LeaderboardEntry[] = cache.ud
    .map((u, i) => ({
      rank: i + 1,
      address: u.u,
      value: fmt(BigInt(u.r)),
      valueNum: Number(formatUnits(BigInt(u.r), 18)),
      extra: `pool on tile ${u.t} was ${fmt(BigInt(u.p))} LINEA`,
    }));

  const refEntries = Object.entries(cache.rf);
  const topReferrers: LeaderboardEntry[] = refEntries
    .filter(([, r]) => r.c > 0)
    .sort((a, b) => b[1].c - a[1].c)
    .slice(0, N)
    .map(([addr, r], i) => ({ rank: i + 1, address: addr, value: String(r.c), valueNum: r.c }));

  const topReferralEarners: LeaderboardEntry[] = refEntries
    .filter(([, r]) => BigInt(r.e) > BigInt(0))
    .sort((a, b) => (BigInt(b[1].e) > BigInt(a[1].e) ? 1 : -1))
    .slice(0, N)
    .map(([addr, r], i) => ({
      rank: i + 1,
      address: addr,
      value: parseFloat(formatUnits(BigInt(r.e), 18)).toFixed(2),
      valueNum: parseFloat(formatUnits(BigInt(r.e), 18)),
    }));

  return { biggestSingleWin, luckiest, oneTileWonder, mostWins, whales, underdog, luckyTile, topReferrers, topReferralEarners };
}

// ─── Hook ───

export function useLeaderboards(enabled: boolean) {
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LeaderboardsData | null>(null);
  const runningRef = useRef(false);
  const restoredRef = useRef(false);

  // Restore from cache instantly on first enable
  useEffect(() => {
    if (!enabled || restoredRef.current) return;
    restoredRef.current = true;
    const cached = loadCache();
    if (cached && Object.keys(cached.us).length > 0) {
      setData(buildFromCache(cached));
    }
  }, [enabled]);

  const fetchAll = useCallback(async (force = false) => {
    if (!publicClient || !enabled) return;
    if (runningRef.current) return;
    runningRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const toBlock = await publicClient.getBlockNumber();
      const cache = force ? null : loadCache();
      const fromBlock = cache
        ? BigInt(cache.lb) + BigInt(1)
        : BigInt(0);

      if (fromBlock > toBlock && cache) {
        // Nothing new – just refresh referrals if stale
        if (Date.now() - cache.rt > REFERRAL_STALE_MS) {
          await refreshReferrals(cache, publicClient);
          saveCache(cache);
          setData(buildFromCache(cache));
        }
        return;
      }

      // ─── 1. Fetch event logs in chunks ───
      const eventSigs: Hex[] = [];
      for (const eventName of ["RewardClaimed", "BetPlaced", "BatchBetsPlaced", "EpochResolved"] as const) {
        try {
          const topics = encodeEventTopics({ abi: GAME_EVENTS_ABI, eventName });
          if (topics[0]) eventSigs.push(topics[0]);
        } catch {}
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
          batch.map((c) => {
            const request = {
              address: CONTRACT_ADDRESS,
              topics: eventSigs.length > 0 ? [eventSigs] : undefined,
              fromBlock: c.from,
              toBlock: c.to,
            } as unknown as Parameters<typeof publicClient.getLogs>[0];
            return publicClient.getLogs(request);
          }),
        );
        for (const r of results) allLogs.push(...r);
      }

      // ─── 2. Decode and aggregate into cache ───
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
            const t = Number(winningTile);
            tw[String(t)] = (tw[String(t)] ?? 0) + 1;
            rc++;
            newResolved.push({ epoch, winningTile });
          }
        } catch {}
      }

      // ─── 3. Underdog: merge with existing candidates ───
      const existingUd = cache?.ud ?? [];
      let udCandidates = [...existingUd];

      if (newClaims.length > 0) {
        const epochToTile = new Map<string, number>();
        for (const r of newResolved) epochToTile.set(r.epoch.toString(), Number(r.winningTile));
        // Also load from existing resolved if missing
        if (cache) {
          for (const ud of cache.ud) {
            epochToTile.set(ud.e, ud.t);
          }
        }

        const pairsToQuery = newClaims
          .map(c => {
            const tile = epochToTile.get(c.epoch.toString());
            return tile != null ? { epoch: c.epoch, tile, user: c.user, reward: c.reward } : null;
          })
          .filter((x): x is NonNullable<typeof x> => x != null);

        const uniquePairs = Array.from(
          new Map(pairsToQuery.map(p => [`${p.epoch}-${p.tile}`, p])).values()
        );

        if (uniquePairs.length > 0) {
          const poolMap = new Map<string, bigint>();
          for (let i = 0; i < uniquePairs.length; i += MULTICALL_BATCH) {
            const batch = uniquePairs.slice(i, i + MULTICALL_BATCH);
            const contracts = batch.map(p => ({
              address: CONTRACT_ADDRESS,
              abi: GAME_ABI,
              functionName: "tilePools" as const,
              args: [p.epoch, BigInt(p.tile)] as const,
            }));
            const results = await publicClient.multicall({ contracts });
            batch.forEach((p, j) => {
              const res = results[j];
              poolMap.set(`${p.epoch}-${p.tile}`, res?.status === "success" && res.result != null ? res.result : BigInt(0));
            });
          }

          for (const p of pairsToQuery) {
            const pool = poolMap.get(`${p.epoch}-${p.tile}`) ?? BigInt(0);
            if (pool > BigInt(0)) {
              udCandidates.push({
                u: p.user,
                e: p.epoch.toString(),
                r: p.reward.toString(),
                t: p.tile,
                p: pool.toString(),
              });
            }
          }
        }
      }

      udCandidates.sort((a, b) => {
        const pa = BigInt(a.p), pb = BigInt(b.p);
        if (pa !== pb) return pa < pb ? -1 : 1;
        return BigInt(b.r) > BigInt(a.r) ? 1 : -1;
      });
      udCandidates = udCandidates.slice(0, LEADERBOARD_TOP_N);

      // ─── 4. Save cache (before referrals) ───
      const newCache: CachedLeaderboard = {
        lb: toBlock.toString(),
        us,
        tw,
        rc,
        ud: udCandidates,
        rf: cache?.rf ?? {},
        rt: cache?.rt ?? 0,
      };

      saveCache(newCache);
      setData(buildFromCache(newCache));

      // ─── 5. Refresh referrals if stale ───
      if (Date.now() - newCache.rt > REFERRAL_STALE_MS) {
        try {
          await refreshReferrals(newCache, publicClient);
          saveCache(newCache);
          setData(buildFromCache(newCache));
        } catch {}
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      runningRef.current = false;
    }
  }, [publicClient, enabled]);

  useEffect(() => {
    if (!enabled) return;
    fetchAll();
  }, [enabled, fetchAll]);

  const refetch = useCallback(() => fetchAll(true), [fetchAll]);
  return { data, loading, error, refetch };
}

// ─── Referral refresh (separate from event scan) ───

type MulticallResultLike = { status: "success"; result: unknown } | { status: "failure"; error: unknown };

async function refreshReferrals(cache: CachedLeaderboard, publicClient: PublicClient) {
  const addresses = Object.keys(cache.us);
  if (addresses.length === 0) return;

  const contracts = addresses.flatMap(addr => [
    {
      address: CONTRACT_ADDRESS as `0x${string}`,
      abi: GAME_ABI,
      functionName: "referralCount" as const,
      args: [addr as `0x${string}`] as const,
    },
    {
      address: CONTRACT_ADDRESS as `0x${string}`,
      abi: GAME_ABI,
      functionName: "totalReferralEarnings" as const,
      args: [addr as `0x${string}`] as const,
    },
  ]);

  const results: MulticallResultLike[] = [];
  for (let i = 0; i < contracts.length; i += MULTICALL_BATCH) {
    const batch = contracts.slice(i, i + MULTICALL_BATCH);
    const res = await publicClient.multicall({ contracts: batch });
    results.push(...(res as MulticallResultLike[]));
  }

  const rf: Record<string, RefAgg> = {};
  for (let i = 0; i < addresses.length; i++) {
    const countRes = results[i * 2];
    const earnRes = results[i * 2 + 1];
    const count = countRes?.status === "success" ? Number(countRes.result as bigint) : 0;
    const earnings = earnRes?.status === "success" ? (earnRes.result as bigint).toString() : "0";
    if (count > 0 || BigInt(earnings) > BigInt(0)) {
      rf[addresses[i]] = { c: count, e: earnings };
    }
  }

  cache.rf = rf;
  cache.rt = Date.now();
}
