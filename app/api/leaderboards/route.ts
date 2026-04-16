import { NextResponse } from "next/server";
import { formatUnits, parseUnits } from "viem";
import { applyNoStoreHeaders } from "../_lib/responseHeaders";
import {
  beginRouteMetric,
  failRouteMetric,
  finishRouteMetric,
  markRouteCacheHit,
  markRouteInflightJoin,
  markRouteStaleServed,
} from "../_lib/runtimeMetrics";
import { enforceSharedRateLimit } from "../_lib/sharedRateLimit";
import { LEADERBOARD_TOP_N } from "../../lib/constants";
import type { LeaderboardEntry, LuckyTileEntry } from "../../lib/types";
import {
  getAllBetRows,
  getAllRewardClaims,
  getChatProfiles,
  getEpochMap,
  getMetaBigInt,
  getMetaJson,
  getRecentRewardClaims,
  setMetaJson,
} from "../../../server/storage";
import { logRouteError } from "../_lib/routeError";
import { createRouteCache } from "../_lib/routeCache";
import { startVersionedBackgroundRefresh, startVersionedInflightBuild } from "../_lib/versionedRouteCache";

type LeaderboardsPayload = {
  biggestSingleWin: LeaderboardEntry[];
  luckiest: LeaderboardEntry[];
  oneTileWonder: LeaderboardEntry[];
  mostWins: LeaderboardEntry[];
  whales: LeaderboardEntry[];
  underdog: LeaderboardEntry[];
  luckyTile: LuckyTileEntry[];
  error?: string;
};

type LeaderboardsSnapshotEnvelope = {
  payload: LeaderboardsPayload;
  savedAt: number;
  watermark: string | null;
};

const LEADERBOARDS_ROUTE_CACHE_MS = 15_000;
const LEADERBOARDS_STALE_REFRESH_MS = 60_000;
const LEADERBOARDS_SNAPSHOT_MAX_AGE_MS = 60 * 60 * 1000;
const ROUTE_METRIC_KEY = "api/leaderboards";
const LEADERBOARDS_SNAPSHOT_META_KEY = "snapshot:leaderboards:v1";
const LEADERBOARDS_CACHE_KEY = "latest";
const LEADERBOARDS_ROUTE_CACHE_MAX_KEYS = 2;
const leaderboardsRouteCache = createRouteCache<LeaderboardsPayload>(LEADERBOARDS_ROUTE_CACHE_MAX_KEYS);
let leaderboardsCacheWatermark: string | null = null;

type UserAgg = {
  totalWagered: bigint;
  totalWon: bigint;
  maxSingleWin: bigint;
  winCount: number;
};

function getLatestRewardClaimMarker() {
  const latest = getRecentRewardClaims(1)[0];
  if (!latest) return "none";
  return `${latest.blockNumber}:${latest.txHash ?? ""}:${latest.epoch}`;
}

function getLeaderboardsDataWatermark() {
  const lastIndexedBlock = getMetaBigInt("lastIndexedBlock")?.toString() ?? "null";
  return `${lastIndexedBlock}|${getLatestRewardClaimMarker()}`;
}

function jsonNoStore(payload: LeaderboardsPayload, status = 200) {
  return applyNoStoreHeaders(NextResponse.json(payload, { status }));
}

function fmt(wei: bigint) {
  return parseFloat(formatUnits(wei, 18)).toFixed(2);
}

function buildRankedEntries(
  rows: Array<{ address: string; value: string; valueNum: number; extra?: string }>,
): LeaderboardEntry[] {
  return rows.map((row, index) => ({
    rank: index + 1,
    address: row.address,
    value: row.value,
    valueNum: row.valueNum,
    extra: row.extra,
  }));
}

function attachLeaderboardNames(entries: LeaderboardEntry[], nameByAddress: Record<string, string>): LeaderboardEntry[] {
  return entries.map((entry) => {
    const name = nameByAddress[entry.address];
    if (!name) return entry;
    return { ...entry, name };
  });
}

function computeWinningAmountWei(tileIds: number[], amounts: string[] | undefined, winningTile: number, totalAmountNum: number) {
  if (Array.isArray(amounts) && amounts.length === tileIds.length) {
    return tileIds.reduce((sum, tileId, index) => {
      if (tileId !== winningTile) return sum;
      return sum + parseUnits(amounts[index] ?? "0", 18);
    }, 0n);
  }

  const hitCount = tileIds.filter((tileId) => tileId === winningTile).length;
  if (hitCount <= 0 || tileIds.length === 0) return 0n;
  const share = totalAmountNum / tileIds.length;
  return parseUnits(String(share * hitCount), 18);
}

async function buildLeaderboardsPayload(): Promise<LeaderboardsPayload> {
  const bets = getAllBetRows();
  const claims = getAllRewardClaims();
  const epochs = getEpochMap();
  const users = new Map<string, UserAgg>();
  const userWinningAmounts = new Map<string, bigint>();
  const rewardByEpochUser = new Map<string, bigint>();
  const maxSingleTileWinByUser = new Map<string, bigint>();
  const luckyTileWins = new Map<number, number>();
  let resolvedCount = 0;

  for (const bet of bets) {
    const address = bet.user.toLowerCase();
    const prev = users.get(address) ?? {
      totalWagered: 0n,
      totalWon: 0n,
      maxSingleWin: 0n,
      winCount: 0,
    };
    prev.totalWagered += parseUnits(bet.totalAmount, 18);
    users.set(address, prev);

    const epochRow = epochs[bet.epoch];
    if (!epochRow || !epochRow.winningTile || epochRow.winningTile <= 0) continue;
    const winningAmountWei = computeWinningAmountWei(bet.tileIds, bet.amounts, epochRow.winningTile, bet.totalAmountNum);
    if (winningAmountWei <= 0n) continue;
    const key = `${bet.epoch}:${address}`;
    userWinningAmounts.set(key, (userWinningAmounts.get(key) ?? 0n) + winningAmountWei);
  }

  for (const row of Object.values(epochs)) {
    if (!row.winningTile || row.winningTile <= 0) continue;
    luckyTileWins.set(row.winningTile, (luckyTileWins.get(row.winningTile) ?? 0) + 1);
    resolvedCount += 1;
  }

  const underdogCandidates: Array<{ address: string; rewardWei: bigint; tile: number; tilePoolWei: bigint }> = [];

  for (const claim of claims) {
    const address = claim.user.toLowerCase();
    const rewardWei = parseUnits(claim.reward, 18);
    const rewardKey = `${claim.epoch}:${address}`;
    rewardByEpochUser.set(rewardKey, (rewardByEpochUser.get(rewardKey) ?? 0n) + rewardWei);
    const prev = users.get(address) ?? {
      totalWagered: 0n,
      totalWon: 0n,
      maxSingleWin: 0n,
      winCount: 0,
    };
    prev.totalWon += rewardWei;
    if (rewardWei > prev.maxSingleWin) prev.maxSingleWin = rewardWei;
    prev.winCount += 1;
    users.set(address, prev);

    const epochRow = epochs[claim.epoch];
    if (!epochRow || !epochRow.winningTile || rewardWei <= 0n) continue;
    const userWinningWei = userWinningAmounts.get(`${claim.epoch}:${address}`) ?? 0n;
    if (userWinningWei <= 0n) continue;

    const rewardPoolWei = parseUnits(epochRow.rewardPool, 18);
    if (rewardPoolWei <= 0n) continue;
    const tilePoolWei = (rewardPoolWei * userWinningWei) / rewardWei;
    if (tilePoolWei <= 0n) continue;

    underdogCandidates.push({
      address,
      rewardWei,
      tile: epochRow.winningTile,
      tilePoolWei,
    });
  }

  for (const bet of bets) {
    const epochRow = epochs[bet.epoch];
    if (!epochRow || !epochRow.winningTile || epochRow.winningTile <= 0) continue;

    const address = bet.user.toLowerCase();
    const key = `${bet.epoch}:${address}`;
    const userWinningWei = userWinningAmounts.get(key) ?? 0n;
    const rewardWei = rewardByEpochUser.get(key) ?? 0n;
    if (userWinningWei <= 0n || rewardWei <= 0n) continue;

    const winningAmountWei = computeWinningAmountWei(
      bet.tileIds,
      bet.amounts,
      epochRow.winningTile,
      bet.totalAmountNum,
    );
    if (winningAmountWei <= 0n) continue;

    const singleTileRewardWei = (rewardWei * winningAmountWei) / userWinningWei;
    const previousMax = maxSingleTileWinByUser.get(address) ?? 0n;
    if (singleTileRewardWei > previousMax) {
      maxSingleTileWinByUser.set(address, singleTileRewardWei);
    }
  }

  const userRows = [...users.entries()].map(([address, row]) => ({ address, ...row }));
  const biggestSingleWin = buildRankedEntries(
    [...userRows]
      .filter((row) => row.maxSingleWin > 0n)
      .sort((a, b) => (b.maxSingleWin > a.maxSingleWin ? 1 : b.maxSingleWin < a.maxSingleWin ? -1 : 0))
      .slice(0, LEADERBOARD_TOP_N)
      .map((row) => ({
        address: row.address,
        value: fmt(row.maxSingleWin),
        valueNum: Number(formatUnits(row.maxSingleWin, 18)),
      })),
  );

  const luckiest = buildRankedEntries(
    [...userRows]
      .filter((row) => row.totalWagered > 0n && row.totalWon > 0n)
      .map((row) => {
        const roi = Number((row.totalWon * 10_000n) / row.totalWagered) / 100;
        return {
          address: row.address,
          value: `${roi.toFixed(1)}%`,
          valueNum: roi,
          extra: `won ${formatUnits(row.totalWon, 18)} / wagered ${formatUnits(row.totalWagered, 18)}`,
        };
      })
      .sort((a, b) => b.valueNum - a.valueNum)
      .slice(0, LEADERBOARD_TOP_N),
  );

  const mostWins = buildRankedEntries(
    [...userRows]
      .filter((row) => row.winCount > 0)
      .sort((a, b) => b.winCount - a.winCount)
      .slice(0, LEADERBOARD_TOP_N)
      .map((row) => ({
        address: row.address,
        value: String(row.winCount),
        valueNum: row.winCount,
      })),
  );

  const whales = buildRankedEntries(
    [...userRows]
      .filter((row) => row.totalWagered > 0n)
      .sort((a, b) => (b.totalWagered > a.totalWagered ? 1 : b.totalWagered < a.totalWagered ? -1 : 0))
      .slice(0, LEADERBOARD_TOP_N)
      .map((row) => ({
        address: row.address,
        value: fmt(row.totalWagered),
        valueNum: Number(formatUnits(row.totalWagered, 18)),
      })),
  );

  const underdog = buildRankedEntries(
    underdogCandidates
      .sort((a, b) => {
        if (a.tilePoolWei !== b.tilePoolWei) return a.tilePoolWei < b.tilePoolWei ? -1 : 1;
        return b.rewardWei > a.rewardWei ? 1 : -1;
      })
      .slice(0, LEADERBOARD_TOP_N)
      .map((row) => ({
        address: row.address,
        value: fmt(row.rewardWei),
        valueNum: Number(formatUnits(row.rewardWei, 18)),
        extra: `pool on tile ${row.tile} was ${fmt(row.tilePoolWei)} LINEA`,
      })),
  );
  const oneTileWonder = buildRankedEntries(
    [...maxSingleTileWinByUser.entries()]
      .filter(([, rewardWei]) => rewardWei > 0n)
      .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
      .slice(0, LEADERBOARD_TOP_N)
      .map(([address, rewardWei]) => ({
        address,
        value: fmt(rewardWei),
        valueNum: Number(formatUnits(rewardWei, 18)),
      })),
  );

  const luckyTile: LuckyTileEntry[] = [...luckyTileWins.entries()]
    .map(([tileId, wins]) => ({
      tileId,
      wins,
      pct: resolvedCount > 0 ? (wins / resolvedCount) * 100 : 0,
    }))
    .sort((a, b) => b.wins - a.wins);

  const leaderboardAddresses = [...new Set(
    [
      ...biggestSingleWin,
      ...luckiest,
      ...oneTileWonder,
      ...mostWins,
      ...whales,
      ...underdog,
    ].map((entry) => entry.address.toLowerCase()),
  )];
  const profiles = getChatProfiles(leaderboardAddresses);
  const nameByAddress = Object.fromEntries(
    Object.entries(profiles).flatMap(([address, profile]) => {
      const trimmed = typeof profile.name === "string" ? profile.name.trim() : "";
      return trimmed ? [[address.toLowerCase(), trimmed]] : [];
    }),
  ) as Record<string, string>;

  return {
    biggestSingleWin: attachLeaderboardNames(biggestSingleWin, nameByAddress),
    luckiest: attachLeaderboardNames(luckiest, nameByAddress),
    oneTileWonder: attachLeaderboardNames(oneTileWonder, nameByAddress),
    mostWins: attachLeaderboardNames(mostWins, nameByAddress),
    whales: attachLeaderboardNames(whales, nameByAddress),
    underdog: attachLeaderboardNames(underdog, nameByAddress),
    luckyTile,
  };
}

function loadLeaderboardsSnapshot(expectedWatermark: string | null): LeaderboardsPayload | null {
  const snapshot = getMetaJson<LeaderboardsSnapshotEnvelope | LeaderboardsPayload>(LEADERBOARDS_SNAPSHOT_META_KEY);
  if (!snapshot || !("savedAt" in snapshot)) {
    return null;
  }

  if (typeof snapshot.savedAt !== "number" || Date.now() - snapshot.savedAt > LEADERBOARDS_SNAPSHOT_MAX_AGE_MS) {
    return null;
  }

  if (!("watermark" in snapshot) || snapshot.watermark !== expectedWatermark) {
    return null;
  }

  return snapshot.payload;
}

function saveLeaderboardsSnapshot(payload: LeaderboardsPayload, watermark: string | null) {
  setMetaJson(LEADERBOARDS_SNAPSHOT_META_KEY, {
    payload,
    savedAt: Date.now(),
    watermark,
  });
}

function hydrateLeaderboardsSnapshot(watermark: string | null) {
  const snapshot = loadLeaderboardsSnapshot(watermark);
  if (!snapshot) return null;
  leaderboardsCacheWatermark = watermark;
  leaderboardsRouteCache.set(LEADERBOARDS_CACHE_KEY, snapshot, LEADERBOARDS_ROUTE_CACHE_MS);
  return snapshot;
}

function startLeaderboardsRefresh(watermark: string | null) {
  startVersionedBackgroundRefresh({
    cache: leaderboardsRouteCache,
    cacheKey: LEADERBOARDS_CACHE_KEY,
    ttlMs: LEADERBOARDS_STALE_REFRESH_MS,
    routeMetricKey: ROUTE_METRIC_KEY,
    shouldSkip: () => leaderboardsCacheWatermark === watermark,
    build: () => buildLeaderboardsPayload(),
    toPayload: (result) => result,
    onCommit: (result) => {
      leaderboardsCacheWatermark = watermark;
      saveLeaderboardsSnapshot(result, watermark);
    },
    onError: (error) => {
      logRouteError(ROUTE_METRIC_KEY, error, { phase: "background-refresh" });
    },
  });
}

export async function GET(request: Request) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-leaderboards",
    limit: 20,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const metric = beginRouteMetric(ROUTE_METRIC_KEY);
  const now = Date.now();
  const cached = leaderboardsRouteCache.getFresh(LEADERBOARDS_CACHE_KEY, now);
  if (cached) {
    markRouteCacheHit(ROUTE_METRIC_KEY);
    finishRouteMetric(metric, 200);
    return jsonNoStore(cached);
  }

  const currentWatermark = getLeaderboardsDataWatermark();
  const staleCache = leaderboardsRouteCache.getStale(LEADERBOARDS_CACHE_KEY);
  if (staleCache) {
    markRouteStaleServed(ROUTE_METRIC_KEY);
    if (leaderboardsCacheWatermark !== currentWatermark) {
      startLeaderboardsRefresh(currentWatermark);
    }
    finishRouteMetric(metric, 200);
    return jsonNoStore(staleCache);
  }

  const snapshot = hydrateLeaderboardsSnapshot(currentWatermark);
  if (snapshot) {
    markRouteCacheHit(ROUTE_METRIC_KEY);
    finishRouteMetric(metric, 200);
    return jsonNoStore(snapshot);
  }

  try {
    const inflight = leaderboardsRouteCache.getInflight(LEADERBOARDS_CACHE_KEY);
    const payload = inflight
      ? (markRouteInflightJoin(ROUTE_METRIC_KEY), await inflight)
      : await (() => {
          const { requestPromise } = startVersionedInflightBuild({
            cache: leaderboardsRouteCache,
            cacheKey: LEADERBOARDS_CACHE_KEY,
            ttlMs: LEADERBOARDS_ROUTE_CACHE_MS,
            build: () => buildLeaderboardsPayload(),
            toPayload: (result) => result,
            onCommit: (result) => {
              leaderboardsCacheWatermark = currentWatermark;
              saveLeaderboardsSnapshot(result, currentWatermark);
            },
          });
          return requestPromise;
        })();

    finishRouteMetric(metric, 200);
    return jsonNoStore(payload);
  } catch (error) {
    logRouteError(ROUTE_METRIC_KEY, error);
    if (staleCache) {
      markRouteStaleServed(ROUTE_METRIC_KEY);
      finishRouteMetric(metric, 200);
      return jsonNoStore(staleCache);
    }
    failRouteMetric(metric, 500);
    return jsonNoStore({
      biggestSingleWin: [],
      luckiest: [],
      oneTileWonder: [],
      mostWins: [],
      whales: [],
      underdog: [],
      luckyTile: [],
      error: "fetch failed",
    }, 500);
  }
}
