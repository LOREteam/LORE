import { formatUnits } from "viem";
import { applyNoStoreHeaders } from "../_lib/responseHeaders";
import {
  beginRouteMetric,
  failRouteMetric,
  finishRouteMetric,
  markRouteBackgroundRefresh,
  markRouteCacheHit,
  markRouteInflightJoin,
  markRouteStaleServed,
} from "../_lib/runtimeMetrics";
import { enforceSharedRateLimit } from "../_lib/sharedRateLimit";
import { LEADERBOARD_TOP_N } from "../../lib/constants";
import type { LeaderboardEntry, LuckyTileEntry } from "../../lib/types";
import {
  computeWinningAmountWei,
  formatLineaAmountFixed,
  parseLineaAmountWei,
} from "../../lib/tokenAmountMath";
import {
  getAllBetRows,
  getAllRewardClaims,
  getChatProfiles,
  getEpochMap,
  getMetaJson,
  getPublicReadModelRevision,
  setMetaJson,
} from "../../../server/storage";
import { logRouteError } from "../_lib/routeError";
import { createRouteCache } from "../_lib/routeCache";
import {
  comparePublicBigIntDesc,
  buildPublicReadModelFailure,
  collectPublicLeaderboardWinningTiles,
  computePublicLeaderboardRoiBasisPoints,
  createPublicReadModelCacheKey,
  createPublicReadModelJsonResponse,
  formatPublicLeaderboardRoiPercent,
  isFreshPublicReadModelSnapshot,
  normalizePublicReadModelAddress,
  sanitizePublicLeaderboardName,
  selectPublicLeaderboardWinningTile,
  toPublicLeaderboardRoiValueNum,
  toPublicWeiDisplayNumber,
} from "../_lib/publicReadModelPolicy";

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
const LEADERBOARDS_CACHE_NAMESPACE = "leaderboards";
const LEADERBOARDS_ROUTE_CACHE_MAX_KEYS = 2;
const PUBLIC_READ_MODEL_STABILITY_ATTEMPTS = 2;
const leaderboardsRouteCache = createRouteCache<LeaderboardsPayload>(LEADERBOARDS_ROUTE_CACHE_MAX_KEYS);

type UserAgg = {
  totalWagered: bigint;
  totalWon: bigint;
  maxSingleWin: bigint;
  winCount: number;
};

function normalizeStoredUserAddress(user: string): `0x${string}` | null {
  return normalizePublicReadModelAddress(user);
}

function getLeaderboardsDataWatermark() {
  return getPublicReadModelRevision();
}

function getLeaderboardsCacheKey(watermark: string) {
  return createPublicReadModelCacheKey(LEADERBOARDS_CACHE_NAMESPACE, watermark);
}

function jsonNoStore(payload: LeaderboardsPayload, status = 200) {
  return createPublicReadModelJsonResponse(payload, status);
}

function fmt(wei: bigint) {
  return formatLineaAmountFixed(wei, 2);
}

function toDisplayNumberWei(value: bigint): number {
  return toPublicWeiDisplayNumber(value);
}

function computeLeaderboardRoiBasisPoints(totalWon: bigint, totalWagered: bigint): bigint {
  return computePublicLeaderboardRoiBasisPoints(totalWon, totalWagered);
}

function formatLeaderboardRoiPercent(roiBasisPoints: bigint): string {
  return formatPublicLeaderboardRoiPercent(roiBasisPoints);
}

function toLeaderboardRoiValueNum(roiBasisPoints: bigint): number {
  return toPublicLeaderboardRoiValueNum(roiBasisPoints);
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

function compareBigIntDesc(left: bigint, right: bigint) {
  return comparePublicBigIntDesc(left, right);
}

function attachLeaderboardNames(entries: LeaderboardEntry[], nameByAddress: Record<string, string>): LeaderboardEntry[] {
  return entries.map((entry) => {
    const name = nameByAddress[entry.address];
    if (!name) return entry;
    return { ...entry, name };
  });
}

async function buildLeaderboardsPayload(): Promise<LeaderboardsPayload> {
  const bets = getAllBetRows();
  const claims = getAllRewardClaims();
  const epochs = getEpochMap();
  const users = new Map<string, UserAgg>();
  const userWinningAmounts = new Map<string, bigint>();
  const rewardByEpochUser = new Map<string, bigint>();
  const maxSingleTileWinByUser = new Map<string, bigint>();
  const {
    counts: luckyTileWins,
    resolvedCount,
  } = collectPublicLeaderboardWinningTiles(Object.values(epochs));

  for (const bet of bets) {
    const address = normalizeStoredUserAddress(bet.user);
    if (!address) continue;
    const prev = users.get(address) ?? {
      totalWagered: 0n,
      totalWon: 0n,
      maxSingleWin: 0n,
      winCount: 0,
    };
    prev.totalWagered += parseLineaAmountWei(bet.totalAmount);
    users.set(address, prev);

    const epochRow = epochs[bet.epoch];
    const winningTile = selectPublicLeaderboardWinningTile(epochRow);
    if (winningTile === null) continue;
    const winningAmountWei = computeWinningAmountWei(bet.tileIds, bet.amounts, winningTile, bet.totalAmount);
    if (winningAmountWei <= 0n) continue;
    const key = `${bet.epoch}:${address}`;
    userWinningAmounts.set(key, (userWinningAmounts.get(key) ?? 0n) + winningAmountWei);
  }

  const underdogCandidates: Array<{ address: string; rewardWei: bigint; tile: number; tilePoolWei: bigint }> = [];

  for (const claim of claims) {
    const address = normalizeStoredUserAddress(claim.user);
    if (!address) continue;
    const rewardWei = parseLineaAmountWei(claim.reward);
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
    const winningTile = selectPublicLeaderboardWinningTile(epochRow);
    if (winningTile === null || rewardWei <= 0n) continue;
    const userWinningWei = userWinningAmounts.get(`${claim.epoch}:${address}`) ?? 0n;
    if (userWinningWei <= 0n) continue;

    const rewardPoolWei = parseLineaAmountWei(epochRow.rewardPool);
    if (rewardPoolWei <= 0n) continue;
    const tilePoolWei = (rewardPoolWei * userWinningWei) / rewardWei;
    if (tilePoolWei <= 0n) continue;

    underdogCandidates.push({
      address,
      rewardWei,
      tile: winningTile,
      tilePoolWei,
    });
  }

  for (const bet of bets) {
    const epochRow = epochs[bet.epoch];
    const winningTile = selectPublicLeaderboardWinningTile(epochRow);
    if (winningTile === null) continue;

    const address = normalizeStoredUserAddress(bet.user);
    if (!address) continue;
    const key = `${bet.epoch}:${address}`;
    const userWinningWei = userWinningAmounts.get(key) ?? 0n;
    const rewardWei = rewardByEpochUser.get(key) ?? 0n;
    if (userWinningWei <= 0n || rewardWei <= 0n) continue;

    const winningAmountWei = computeWinningAmountWei(
      bet.tileIds,
      bet.amounts,
      winningTile,
      bet.totalAmount,
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
      .sort((a, b) => {
        const delta = compareBigIntDesc(a.maxSingleWin, b.maxSingleWin);
        if (delta !== 0) return delta;
        return a.address.localeCompare(b.address);
      })
      .slice(0, LEADERBOARD_TOP_N)
      .map((row) => ({
        address: row.address,
        value: fmt(row.maxSingleWin),
        valueNum: toDisplayNumberWei(row.maxSingleWin),
      })),
  );

  const luckiest = buildRankedEntries(
    [...userRows]
      .filter((row) => row.totalWagered > 0n && row.totalWon > 0n)
      .map((row) => {
        const roiBasisPoints = computeLeaderboardRoiBasisPoints(row.totalWon, row.totalWagered);
        return {
          address: row.address,
          value: formatLeaderboardRoiPercent(roiBasisPoints),
          valueNum: toLeaderboardRoiValueNum(roiBasisPoints),
          roiBasisPoints,
          extra: `won ${formatUnits(row.totalWon, 18)} / wagered ${formatUnits(row.totalWagered, 18)}`,
        };
      })
      .sort((a, b) => {
        const delta = compareBigIntDesc(a.roiBasisPoints, b.roiBasisPoints);
        if (delta !== 0) return delta;
        return a.address.localeCompare(b.address);
      })
      .slice(0, LEADERBOARD_TOP_N),
  );

  const mostWins = buildRankedEntries(
    [...userRows]
      .filter((row) => row.winCount > 0)
      .sort((a, b) => {
        const delta = b.winCount - a.winCount;
        if (delta !== 0) return delta;
        return a.address.localeCompare(b.address);
      })
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
      .sort((a, b) => {
        const delta = compareBigIntDesc(a.totalWagered, b.totalWagered);
        if (delta !== 0) return delta;
        return a.address.localeCompare(b.address);
      })
      .slice(0, LEADERBOARD_TOP_N)
      .map((row) => ({
        address: row.address,
        value: fmt(row.totalWagered),
        valueNum: toDisplayNumberWei(row.totalWagered),
      })),
  );

  const underdog = buildRankedEntries(
    underdogCandidates
      .sort((a, b) => {
        if (a.tilePoolWei !== b.tilePoolWei) return a.tilePoolWei < b.tilePoolWei ? -1 : 1;
        if (a.rewardWei !== b.rewardWei) return compareBigIntDesc(a.rewardWei, b.rewardWei);
        return a.address.localeCompare(b.address);
      })
      .slice(0, LEADERBOARD_TOP_N)
      .map((row) => ({
        address: row.address,
        value: fmt(row.rewardWei),
        valueNum: toDisplayNumberWei(row.rewardWei),
        extra: `pool on tile ${row.tile} was ${fmt(row.tilePoolWei)} LINEA`,
      })),
  );
  const oneTileWonder = buildRankedEntries(
    [...maxSingleTileWinByUser.entries()]
      .filter(([, rewardWei]) => rewardWei > 0n)
      .sort((a, b) => {
        const delta = compareBigIntDesc(a[1], b[1]);
        if (delta !== 0) return delta;
        return a[0].localeCompare(b[0]);
      })
      .slice(0, LEADERBOARD_TOP_N)
      .map(([address, rewardWei]) => ({
        address,
        value: fmt(rewardWei),
        valueNum: toDisplayNumberWei(rewardWei),
      })),
  );

  const luckyTile: LuckyTileEntry[] = [...luckyTileWins.entries()]
    .map(([tileId, wins]) => ({
      tileId,
      wins,
      pct: resolvedCount > 0 ? (wins / resolvedCount) * 100 : 0,
    }))
    .sort((a, b) => {
      if (a.wins !== b.wins) return b.wins - a.wins;
      return a.tileId - b.tileId;
    });

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
      const safeName = sanitizePublicLeaderboardName(profile.name);
      return safeName ? [[address.toLowerCase(), safeName]] : [];
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

  if (!isFreshLeaderboardsSnapshotSavedAt(snapshot.savedAt)) {
    return null;
  }

  if (!("watermark" in snapshot) || snapshot.watermark !== expectedWatermark) {
    return null;
  }

  return snapshot.payload;
}

function isFreshLeaderboardsSnapshotSavedAt(savedAt: unknown, now = Date.now()) {
  return isFreshPublicReadModelSnapshot(savedAt, LEADERBOARDS_SNAPSHOT_MAX_AGE_MS, now);
}

function saveLeaderboardsSnapshot(payload: LeaderboardsPayload, watermark: string | null) {
  setMetaJson(LEADERBOARDS_SNAPSHOT_META_KEY, {
    payload,
    savedAt: Date.now(),
    watermark,
  });
}

function isLeaderboardsRevisionCurrent(watermark: string | null) {
  return watermark !== null && getLeaderboardsDataWatermark() === watermark;
}

function commitLeaderboardsPayload(
  cacheKey: string,
  payload: LeaderboardsPayload,
  watermark: string | null,
  ttlMs: number,
  persistSnapshot = true,
) {
  if (!isLeaderboardsRevisionCurrent(watermark)) return false;
  leaderboardsRouteCache.set(cacheKey, payload, ttlMs);
  if (!isLeaderboardsRevisionCurrent(watermark)) return false;
  if (persistSnapshot) saveLeaderboardsSnapshot(payload, watermark);
  return true;
}

function hydrateLeaderboardsSnapshot(cacheKey: string, watermark: string | null) {
  const snapshot = loadLeaderboardsSnapshot(watermark);
  if (!snapshot) return null;
  return commitLeaderboardsPayload(cacheKey, snapshot, watermark, LEADERBOARDS_ROUTE_CACHE_MS, false)
    ? snapshot
    : null;
}

function startLeaderboardsRefresh(cacheKey: string, watermark: string | null) {
  if (
    leaderboardsRouteCache.getRefresh(cacheKey) ||
    leaderboardsRouteCache.getInflight(cacheKey)
  ) {
    return;
  }

  markRouteBackgroundRefresh(ROUTE_METRIC_KEY);
  let refreshPromise: Promise<void>;
  refreshPromise = buildLeaderboardsPayload()
    .then((payload) => {
      commitLeaderboardsPayload(cacheKey, payload, watermark, LEADERBOARDS_STALE_REFRESH_MS);
    })
    .catch((error) => {
      logRouteError(ROUTE_METRIC_KEY, error, { phase: "background-refresh" });
    })
    .finally(() => {
      leaderboardsRouteCache.clearRefresh(cacheKey, refreshPromise);
    });
  leaderboardsRouteCache.setRefresh(cacheKey, refreshPromise);
}

function startLeaderboardsBuild(cacheKey: string, watermark: string | null) {
  const existing = leaderboardsRouteCache.getInflight(cacheKey);
  if (existing) return { joined: true, promise: existing };

  let requestPromise: Promise<LeaderboardsPayload>;
  requestPromise = buildLeaderboardsPayload()
    .then((payload) => {
      commitLeaderboardsPayload(cacheKey, payload, watermark, LEADERBOARDS_ROUTE_CACHE_MS);
      return payload;
    })
    .finally(() => {
      leaderboardsRouteCache.clearInflight(cacheKey, requestPromise);
    });
  leaderboardsRouteCache.setInflight(cacheKey, requestPromise);
  return { joined: false, promise: requestPromise };
}

export async function GET(request: Request) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-leaderboards",
    limit: 20,
    windowMs: 60_000,
  });
  if (rateLimited) return applyNoStoreHeaders(rateLimited);

  const metric = beginRouteMetric(ROUTE_METRIC_KEY);
  let staleFallback: { payload: LeaderboardsPayload; watermark: string } | null = null;
  try {
    for (let attempt = 0; attempt < PUBLIC_READ_MODEL_STABILITY_ATTEMPTS; attempt += 1) {
      const currentWatermark = getLeaderboardsDataWatermark();
      const cacheKey = getLeaderboardsCacheKey(currentWatermark);
      const cached = leaderboardsRouteCache.getFresh(cacheKey, Date.now());
      if (cached) {
        if (isLeaderboardsRevisionCurrent(currentWatermark)) {
          markRouteCacheHit(ROUTE_METRIC_KEY);
          finishRouteMetric(metric, 200);
          return jsonNoStore(cached);
        }
        continue;
      }

      const staleCache = leaderboardsRouteCache.getStale(cacheKey);
      if (staleCache) {
        if (!isLeaderboardsRevisionCurrent(currentWatermark)) continue;
        staleFallback = { payload: staleCache, watermark: currentWatermark };
        startLeaderboardsRefresh(cacheKey, currentWatermark);
        if (!isLeaderboardsRevisionCurrent(currentWatermark)) continue;
        markRouteStaleServed(ROUTE_METRIC_KEY);
        finishRouteMetric(metric, 200);
        return jsonNoStore(staleCache);
      }

      const snapshot = hydrateLeaderboardsSnapshot(cacheKey, currentWatermark);
      if (snapshot) {
        if (!isLeaderboardsRevisionCurrent(currentWatermark)) continue;
        markRouteCacheHit(ROUTE_METRIC_KEY);
        finishRouteMetric(metric, 200);
        return jsonNoStore(snapshot);
      }

      const build = startLeaderboardsBuild(cacheKey, currentWatermark);
      if (build.joined) markRouteInflightJoin(ROUTE_METRIC_KEY);
      const payload = await build.promise;
      if (!isLeaderboardsRevisionCurrent(currentWatermark)) continue;

      finishRouteMetric(metric, 200);
      return jsonNoStore(payload);
    }

    // A continuously changing multi-process revision must not populate a cache or snapshot.
    const payload = await buildLeaderboardsPayload();
    finishRouteMetric(metric, 200);
    return jsonNoStore(payload);
  } catch (error) {
    logRouteError(ROUTE_METRIC_KEY, error);
    if (staleFallback && isLeaderboardsRevisionCurrent(staleFallback.watermark)) {
      markRouteStaleServed(ROUTE_METRIC_KEY);
      finishRouteMetric(metric, 200);
      return jsonNoStore(staleFallback.payload);
    }
    failRouteMetric(metric, 500);
    return jsonNoStore(buildPublicReadModelFailure({
      biggestSingleWin: [],
      luckiest: [],
      oneTileWonder: [],
      mostWins: [],
      whales: [],
      underdog: [],
      luckyTile: [],
    }), 500);
  }
}
