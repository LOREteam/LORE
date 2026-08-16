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
  computeReadModelExpiresAt,
  isFreshReadModelCache,
} from "../_lib/readModelSafety";
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

function commitRecentWinsCache(
  payload: RecentWinsPayload,
  ttlMs: number,
  seq: number,
  watermark: string | null,
  durableSnapshotEligible: boolean,
) {
  if (seq < recentWinsAppliedSeq) {
    return recentWinsCache?.payload ?? payload;
  }
  recentWinsAppliedSeq = seq;
  recentWinsCacheWatermark = watermark;
  recentWinsCache = {
    payload,
    expiresAt: computeReadModelExpiresAt(ttlMs),
  };
  if (durableSnapshotEligible && !hasPendingRecentWinsRecovery(payload)) {
    saveRecentWinsSnapshot(payload, watermark);
  }
  return payload;
}

function hydrateRecentWinsSnapshot(watermark: string | null) {
  const snapshot = loadRecentWinsSnapshot(watermark);
  if (!snapshot) return null;
  recentWinsCacheWatermark = watermark;
  recentWinsCache = {
    payload: snapshot,
    expiresAt: computeReadModelExpiresAt(RECENT_WINS_ROUTE_CACHE_MS),
  };
  return snapshot;
}

function hasPendingRecentWinsRecovery(payload: RecentWinsPayload | null) {
  return payload?.recovery?.status === "partial";
}

function startRecentWinsRefresh(watermark: string | null) {
  if (
    recentWinsRefreshPromise ||
    recentWinsInflight ||
    (recentWinsCacheWatermark === watermark && !hasPendingRecentWinsRecovery(recentWinsCache?.payload ?? null))
  ) {
    return;
  }

  markRouteBackgroundRefresh(ROUTE_METRIC_KEY);
  const seq = ++recentWinsBuildSeq;
  recentWinsRefreshPromise = buildRecentWinsPayload({ allowSlowRecovery: true })
    .then(({ payload, durableSnapshotEligible }) => {
      commitRecentWinsCache(
        payload,
        RECENT_WINS_STALE_REFRESH_MS,
        seq,
        watermark,
        durableSnapshotEligible,
      );
    })
    .catch((error) => {
      logRouteError(ROUTE_METRIC_KEY, error, { phase: "background-refresh" });
    })
    .finally(() => {
      recentWinsRefreshPromise = null;
    });
}

function startRecentWinsRequestBuild(watermark: string | null) {
  const seq = ++recentWinsBuildSeq;
  const task: Promise<RecentWinsPayload> = (async () => {
    const fastResult = await buildRecentWinsPayload({ allowSlowRecovery: false });
    const result =
      fastResult.recoveryNeeded && fastResult.payload.wins.length === 0
        ? await buildRecentWinsPayload({ allowSlowRecovery: true })
        : fastResult;
    return commitRecentWinsCache(
      result.payload,
      RECENT_WINS_ROUTE_CACHE_MS,
      seq,
      watermark,
      result.durableSnapshotEligible,
    );
  })().finally(() => {
    if (recentWinsInflight === task) {
      recentWinsInflight = null;
    }
  });
  recentWinsInflight = task;
  return task;
}

export async function GET(request: Request) {
  const metric = beginRouteMetric(ROUTE_METRIC_KEY);
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-recent-wins",
    limit: 30,
    windowMs: 60_000,
  });
  if (rateLimited) {
    failRouteMetric(metric, 429);
    return applyNoStoreHeaders(rateLimited);
  }

  const now = Date.now();
  const freshCache = recentWinsCache;
  if (isFreshReadModelCache(freshCache, now)) {
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
    if (recentWinsCacheWatermark !== currentWatermark || hasPendingRecentWinsRecovery(staleCache)) {
      startRecentWinsRefresh(currentWatermark);
    }
    finishRouteMetric(metric, 200);
    return jsonNoStore(staleCache);
  }

  try {
    if (recentWinsInflight) {
      markRouteInflightJoin(ROUTE_METRIC_KEY);
      const payload = await recentWinsInflight;
      finishRouteMetric(metric, 200);
      return jsonNoStore(payload);
    }

    const payload = await startRecentWinsRequestBuild(currentWatermark);

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
