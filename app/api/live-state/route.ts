import { NextResponse } from "next/server";
import { enforceSharedRateLimit } from "../_lib/sharedRateLimit";
import { applyNoStoreHeaders } from "../_lib/responseHeaders";
import {
  buildStoredLiveStateBootstrap,
  getLiveStatePayloadWithSnapshotFallback,
  loadLiveStateSnapshot,
  type LiveStatePayload,
} from "./shared";
import { createRouteCache } from "../_lib/routeCache";
import {
  beginRouteMetric,
  failRouteMetric,
  finishRouteMetric,
  markRouteCacheHit,
  markRouteInflightJoin,
  markRouteStaleServed,
} from "../_lib/runtimeMetrics";
import { logRouteError } from "../_lib/routeError";
import { startVersionedBackgroundRefresh, startVersionedInflightBuild } from "../_lib/versionedRouteCache";
import {
  isFreshLiveStatePayloadFetchedAt,
  resolveLiveStateAdmission,
  withLiveStateTimeout,
} from "./runtimePolicy";

const LIVE_STATE_CACHE_MS = 4_000;
const LIVE_STATE_REQUEST_TIMEOUT_MS = 8_000;
const LIVE_STATE_CACHE_MAX_KEYS = 2;
const ROUTE_METRIC_KEY = "api/live-state";
const CACHE_KEY = "latest";
const liveStateRouteCache = createRouteCache<LiveStatePayload>(LIVE_STATE_CACHE_MAX_KEYS);

function jsonNoStore(payload: LiveStatePayload, status = 200) {
  return applyNoStoreHeaders(NextResponse.json(payload, { status }));
}

function startLiveStateRefresh() {
  startVersionedBackgroundRefresh({
    cache: liveStateRouteCache,
    cacheKey: CACHE_KEY,
    ttlMs: LIVE_STATE_CACHE_MS,
    routeMetricKey: ROUTE_METRIC_KEY,
    build: () => getLiveStatePayloadWithSnapshotFallback(),
    toPayload: (result) => result,
    onError: (err) => {
      logRouteError(ROUTE_METRIC_KEY, err, { phase: "background-refresh" });
    },
  });
}

function canServeStaleImmediately(payload: LiveStatePayload, now: number) {
  return isFreshLiveStatePayloadFetchedAt(payload.fetchedAt, now);
}

export async function GET(request: Request) {
  const metric = beginRouteMetric(ROUTE_METRIC_KEY);
  const admission = await resolveLiveStateAdmission({
    enforceRateLimit: () => enforceSharedRateLimit(request, {
      bucket: "api-live-state",
      limit: 120,
      windowMs: 60_000,
    }),
    readFreshCache: (now) => liveStateRouteCache.getFresh(CACHE_KEY, now),
  });
  if (admission.kind === "rate-limited") {
    failRouteMetric(metric, 429);
    return applyNoStoreHeaders(admission.response);
  }

  const { now, cached } = admission;
  if (cached) {
    markRouteCacheHit(ROUTE_METRIC_KEY);
    finishRouteMetric(metric, 200);
    return jsonNoStore(cached);
  }
  const staleCache =
    liveStateRouteCache.getStale(CACHE_KEY) ??
    loadLiveStateSnapshot(Number.POSITIVE_INFINITY);
  const storedBootstrap = buildStoredLiveStateBootstrap();
  const fallbackCache = staleCache ?? storedBootstrap;

  if (staleCache && canServeStaleImmediately(staleCache, now)) {
    markRouteStaleServed(ROUTE_METRIC_KEY);
    startLiveStateRefresh();
    finishRouteMetric(metric, 200);
    return jsonNoStore(staleCache);
  }

  if (storedBootstrap) {
    markRouteStaleServed(ROUTE_METRIC_KEY);
    startLiveStateRefresh();
    finishRouteMetric(metric, 200);
    return jsonNoStore(storedBootstrap);
  }

  try {
    const inflight = liveStateRouteCache.getInflight(CACHE_KEY);
    const payload = inflight
      ? (markRouteInflightJoin(ROUTE_METRIC_KEY), await withLiveStateTimeout(inflight, LIVE_STATE_REQUEST_TIMEOUT_MS, "live-state inflight"))
      : await (() => {
          const { requestPromise } = startVersionedInflightBuild({
            cache: liveStateRouteCache,
            cacheKey: CACHE_KEY,
            ttlMs: LIVE_STATE_CACHE_MS,
            build: () => getLiveStatePayloadWithSnapshotFallback(),
            toPayload: (result) => result,
          });
          return withLiveStateTimeout(requestPromise, LIVE_STATE_REQUEST_TIMEOUT_MS, "live-state refresh");
        })();

    finishRouteMetric(metric, 200);
    return jsonNoStore(payload);
  } catch (error) {
    logRouteError(ROUTE_METRIC_KEY, error, { method: "GET" });
    if (fallbackCache) {
      markRouteStaleServed(ROUTE_METRIC_KEY);
      startLiveStateRefresh();
      finishRouteMetric(metric, 200);
      return jsonNoStore(fallbackCache);
    }
    failRouteMetric(metric, 500);
    return applyNoStoreHeaders(
      NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      ),
    );
  }
}
