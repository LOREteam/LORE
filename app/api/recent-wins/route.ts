import { NextResponse } from "next/server";
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
import { logRouteError } from "../_lib/routeError";
import { enforceSharedRateLimit } from "../_lib/sharedRateLimit";
import {
  buildRecentWinsPayload,
  getRecentWinsDataWatermark,
  loadRecentWinsSnapshot,
  saveRecentWinsSnapshot,
  type RecentWinsPayload,
} from "./data";

const RECENT_WINS_ROUTE_CACHE_MS = 15_000;
const RECENT_WINS_STALE_REFRESH_MS = 60_000;
const ROUTE_METRIC_KEY = "api/recent-wins";

type RecentWinsCacheEntry = {
  payload: RecentWinsPayload;
  expiresAt: number;
};

let recentWinsCache: RecentWinsCacheEntry | null = null;
let recentWinsCacheWatermark: string | null = null;
let recentWinsInflight: Promise<RecentWinsPayload> | null = null;
let recentWinsRefreshPromise: Promise<void> | null = null;
let recentWinsBuildSeq = 0;
let recentWinsAppliedSeq = 0;

function jsonNoStore(payload: RecentWinsPayload, status = 200) {
  return applyNoStoreHeaders(NextResponse.json(payload, { status }));
}

function computeRecentWinsExpiresAt(ttlMs: number, now = Date.now()) {
  if (!Number.isSafeInteger(now) || now < 0) return 0;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) return 0;
  if (ttlMs > Number.MAX_SAFE_INTEGER - now) return Number.MAX_SAFE_INTEGER;
  return now + ttlMs;
}

function isFreshRecentWinsCache(entry: RecentWinsCacheEntry | null, now = Date.now()): entry is RecentWinsCacheEntry {
  return Boolean(
    entry &&
      Number.isSafeInteger(now) &&
      now >= 0 &&
      Number.isSafeInteger(entry.expiresAt) &&
      entry.expiresAt > now,
  );
}

function commitRecentWinsCache(payload: RecentWinsPayload, ttlMs: number, seq: number, watermark: string | null) {
  if (seq < recentWinsAppliedSeq) {
    return recentWinsCache?.payload ?? payload;
  }
  recentWinsAppliedSeq = seq;
  recentWinsCacheWatermark = watermark;
  recentWinsCache = {
    payload,
    expiresAt: computeRecentWinsExpiresAt(ttlMs),
  };
  saveRecentWinsSnapshot(payload, watermark);
  return payload;
}

function hydrateRecentWinsSnapshot(watermark: string | null) {
  const snapshot = loadRecentWinsSnapshot(watermark);
  if (!snapshot) return null;
  recentWinsCacheWatermark = watermark;
  recentWinsCache = {
    payload: snapshot,
    expiresAt: computeRecentWinsExpiresAt(RECENT_WINS_ROUTE_CACHE_MS),
  };
  return snapshot;
}

function startRecentWinsRefresh(watermark: string | null) {
  if (recentWinsRefreshPromise || recentWinsInflight || recentWinsCacheWatermark === watermark) {
    return;
  }

  markRouteBackgroundRefresh(ROUTE_METRIC_KEY);
  const seq = ++recentWinsBuildSeq;
  recentWinsRefreshPromise = buildRecentWinsPayload({ allowSlowRecovery: true })
    .then(({ payload }) => {
      commitRecentWinsCache(payload, RECENT_WINS_STALE_REFRESH_MS, seq, watermark);
    })
    .catch((error) => {
      logRouteError(ROUTE_METRIC_KEY, error, { phase: "background-refresh" });
    })
    .finally(() => {
      recentWinsRefreshPromise = null;
    });
}

export async function GET(request: Request) {
  const metric = beginRouteMetric(ROUTE_METRIC_KEY);
  const now = Date.now();
  const freshCache = recentWinsCache;
  if (isFreshRecentWinsCache(freshCache, now)) {
    markRouteCacheHit(ROUTE_METRIC_KEY);
    finishRouteMetric(metric, 200);
    return jsonNoStore(freshCache.payload);
  }

  const currentWatermark = getRecentWinsDataWatermark();
  const snapshot = !recentWinsCache ? hydrateRecentWinsSnapshot(currentWatermark) : null;
  if (snapshot) {
    markRouteCacheHit(ROUTE_METRIC_KEY);
    finishRouteMetric(metric, 200);
    return jsonNoStore(snapshot);
  }

  const staleCache = recentWinsCache?.payload ?? null;
  if (staleCache) {
    markRouteStaleServed(ROUTE_METRIC_KEY);
    if (recentWinsCacheWatermark !== currentWatermark) {
      startRecentWinsRefresh(currentWatermark);
    }
    finishRouteMetric(metric, 200);
    return jsonNoStore(staleCache);
  }

  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-recent-wins",
    limit: 30,
    windowMs: 60_000,
  });
  if (rateLimited) {
    failRouteMetric(metric, 429);
    return applyNoStoreHeaders(rateLimited);
  }

  try {
    if (recentWinsInflight) {
      markRouteInflightJoin(ROUTE_METRIC_KEY);
      const payload = await recentWinsInflight;
      finishRouteMetric(metric, 200);
      return jsonNoStore(payload);
    }

    const fastResult = await buildRecentWinsPayload({ allowSlowRecovery: false });
    const seq = ++recentWinsBuildSeq;
    const buildPromise =
      fastResult.recoveryNeeded && fastResult.payload.wins.length === 0
        ? buildRecentWinsPayload({ allowSlowRecovery: true })
        : Promise.resolve(fastResult);
    recentWinsInflight = buildPromise
      .then(({ payload: result }) => commitRecentWinsCache(result, RECENT_WINS_ROUTE_CACHE_MS, seq, currentWatermark))
      .finally(() => {
        recentWinsInflight = null;
      });

    const payload = await recentWinsInflight;

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
    return jsonNoStore({ wins: [], error: "fetch failed" }, 500);
  }
}
