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
import type { LeaderboardEntry, LuckyTileEntry } from "../../lib/types";
import {
  getChatProfiles,
  getLeaderboardReadModel,
  getMetaJson,
  getPublicReadModelRevision,
  setMetaJson,
} from "../../../server/storage";
import { logRouteError } from "../_lib/routeError";
import { createRouteCache } from "../_lib/routeCache";
import {
  buildPublicReadModelFailure,
  createPublicReadModelCacheKey,
  createPublicReadModelJsonResponse,
  isFreshPublicReadModelSnapshot,
  sanitizePublicLeaderboardName,
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

function getLeaderboardsDataWatermark() {
  return getPublicReadModelRevision();
}

function getLeaderboardsCacheKey(watermark: string) {
  return createPublicReadModelCacheKey(LEADERBOARDS_CACHE_NAMESPACE, watermark);
}

function jsonNoStore(payload: LeaderboardsPayload, status = 200) {
  return createPublicReadModelJsonResponse(payload, status);
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

async function buildLeaderboardsPayload(): Promise<LeaderboardsPayload> {
  const readModel = getLeaderboardReadModel();
  const biggestSingleWin = buildRankedEntries(readModel.biggestSingleWin);
  const luckiest = buildRankedEntries(readModel.luckiest);
  const mostWins = buildRankedEntries(readModel.mostWins);
  const whales = buildRankedEntries(readModel.whales);
  const underdog = buildRankedEntries(readModel.underdog);
  const oneTileWonder = buildRankedEntries(readModel.oneTileWonder);
  const luckyTile: LuckyTileEntry[] = readModel.luckyTile;

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
  const refreshPromise = buildLeaderboardsPayload()
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

  const requestPromise = buildLeaderboardsPayload()
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
