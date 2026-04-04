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

const LIVE_STATE_CACHE_MS = 4_000;
const LIVE_STATE_REQUEST_TIMEOUT_MS = 8_000;
const LIVE_STATE_CACHE_MAX_KEYS = 2;
const ROUTE_METRIC_KEY = "api/live-state";
const CACHE_KEY = "latest";
const liveStateRouteCache = createRouteCache<LiveStatePayload>(LIVE_STATE_CACHE_MAX_KEYS);

function jsonNoStore(payload: LiveStatePayload, status = 200) {
  return applyNoStoreHeaders(NextResponse.json(payload, { status }));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
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

export async function GET(request: Request) {
  const metric = beginRouteMetric(ROUTE_METRIC_KEY);
  const now = Date.now();
  const cached = liveStateRouteCache.getFresh(CACHE_KEY, now);
  if (cached) {
    markRouteCacheHit(ROUTE_METRIC_KEY);
    finishRouteMetric(metric, 200);
    return jsonNoStore(cached);
  }
  const staleCache =
    liveStateRouteCache.getStale(CACHE_KEY) ??
    loadLiveStateSnapshot(Number.POSITIVE_INFINITY) ??
    buildStoredLiveStateBootstrap();

  if (staleCache) {
    markRouteStaleServed(ROUTE_METRIC_KEY);
    startLiveStateRefresh();
    finishRouteMetric(metric, 200);
    return jsonNoStore(staleCache);
  }

  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-live-state",
    limit: 120,
    windowMs: 60_000,
  });
  if (rateLimited) {
    if (staleCache) {
      markRouteStaleServed(ROUTE_METRIC_KEY);
      finishRouteMetric(metric, 200);
      return jsonNoStore(staleCache);
    }
    failRouteMetric(metric, 429);
    return rateLimited;
  }

  try {
    const inflight = liveStateRouteCache.getInflight(CACHE_KEY);
    const payload = inflight
      ? (markRouteInflightJoin(ROUTE_METRIC_KEY), await withTimeout(inflight, LIVE_STATE_REQUEST_TIMEOUT_MS, "live-state inflight"))
      : await (() => {
          const { requestPromise } = startVersionedInflightBuild({
            cache: liveStateRouteCache,
            cacheKey: CACHE_KEY,
            ttlMs: LIVE_STATE_CACHE_MS,
            build: () => getLiveStatePayloadWithSnapshotFallback(),
            toPayload: (result) => result,
          });
          return withTimeout(requestPromise, LIVE_STATE_REQUEST_TIMEOUT_MS, "live-state refresh");
        })();

    finishRouteMetric(metric, 200);
    return jsonNoStore(payload);
  } catch (error) {
    logRouteError(ROUTE_METRIC_KEY, error, { method: "GET" });
    if (staleCache) {
      markRouteStaleServed(ROUTE_METRIC_KEY);
      startLiveStateRefresh();
      finishRouteMetric(metric, 200);
      return jsonNoStore(staleCache);
    }
    failRouteMetric(metric, 500);
    return applyNoStoreHeaders(
      NextResponse.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500 },
      ),
    );
  }
}
