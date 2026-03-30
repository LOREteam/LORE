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
import { getMetaJson, getRecentRewardClaims, setMetaJson } from "../../../server/storage";

const RECENT_WINS_LIMIT = 100;
const RECENT_WINS_ROUTE_CACHE_MS = 15_000;
const RECENT_WINS_STALE_REFRESH_MS = 60_000;
const RECENT_WINS_SNAPSHOT_MAX_AGE_MS = 60 * 60 * 1000;
const ROUTE_METRIC_KEY = "api/recent-wins";
const RECENT_WINS_SNAPSHOT_META_KEY = "snapshot:recent-wins:v1";

type RecentWinRow = {
  epoch: string;
  user: string;
  amount: string;
  amountRaw: string;
};

type RecentWinsPayload = {
  wins: RecentWinRow[];
  error?: string;
};

type RecentWinsSnapshotEnvelope = {
  payload: RecentWinsPayload;
  savedAt: number;
};

type RecentWinsCacheEntry = {
  payload: RecentWinsPayload;
  expiresAt: number;
};

let recentWinsCache: RecentWinsCacheEntry | null = null;
let recentWinsInflight: Promise<RecentWinsPayload> | null = null;
let recentWinsRefreshPromise: Promise<void> | null = null;
let recentWinsBuildSeq = 0;
let recentWinsAppliedSeq = 0;

function jsonNoStore(payload: RecentWinsPayload, status = 200) {
  return applyNoStoreHeaders(NextResponse.json(payload, { status }));
}

async function buildRecentWinsPayload(): Promise<RecentWinsPayload> {
  const claims = getRecentRewardClaims(RECENT_WINS_LIMIT);
  return {
    wins: claims.map((row) => ({
      epoch: row.epoch,
      user: row.user,
      amount: row.rewardNum.toFixed(2),
      amountRaw: row.reward,
    })),
  };
}

function loadRecentWinsSnapshot(): RecentWinsPayload | null {
  const snapshot = getMetaJson<RecentWinsSnapshotEnvelope | RecentWinsPayload>(RECENT_WINS_SNAPSHOT_META_KEY);
  if (!snapshot || !("savedAt" in snapshot)) {
    return null;
  }

  if (typeof snapshot.savedAt !== "number" || Date.now() - snapshot.savedAt > RECENT_WINS_SNAPSHOT_MAX_AGE_MS) {
    return null;
  }

  return snapshot.payload;
}

function saveRecentWinsSnapshot(payload: RecentWinsPayload) {
  setMetaJson(RECENT_WINS_SNAPSHOT_META_KEY, {
    payload,
    savedAt: Date.now(),
  });
}

function commitRecentWinsCache(payload: RecentWinsPayload, ttlMs: number, seq: number) {
  if (seq < recentWinsAppliedSeq) {
    return recentWinsCache?.payload ?? payload;
  }
  recentWinsAppliedSeq = seq;
  recentWinsCache = {
    payload,
    expiresAt: Date.now() + ttlMs,
  };
  saveRecentWinsSnapshot(payload);
  return payload;
}

function startRecentWinsRefresh() {
  if (recentWinsRefreshPromise || recentWinsInflight) return;

  markRouteBackgroundRefresh(ROUTE_METRIC_KEY);
  const seq = ++recentWinsBuildSeq;
  recentWinsRefreshPromise = buildRecentWinsPayload()
    .then((result) => {
      commitRecentWinsCache(result, RECENT_WINS_STALE_REFRESH_MS, seq);
    })
    .catch((error) => {
      logRouteError(ROUTE_METRIC_KEY, error, { phase: "background-refresh" });
    })
    .finally(() => {
      recentWinsRefreshPromise = null;
    });
}

export async function GET(request: Request) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-recent-wins",
    limit: 30,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const metric = beginRouteMetric(ROUTE_METRIC_KEY);
  const now = Date.now();
  if (recentWinsCache && recentWinsCache.expiresAt > now) {
    markRouteCacheHit(ROUTE_METRIC_KEY);
    finishRouteMetric(metric, 200);
    return jsonNoStore(recentWinsCache.payload);
  }

  if (!recentWinsCache) {
    const snapshot = loadRecentWinsSnapshot();
    if (snapshot) {
      recentWinsCache = {
        payload: snapshot,
        expiresAt: now - 1,
      };
    }
  }

  const staleCache = recentWinsCache?.payload ?? null;
  if (staleCache) {
    markRouteStaleServed(ROUTE_METRIC_KEY);
    startRecentWinsRefresh();
    finishRouteMetric(metric, 200);
    return jsonNoStore(staleCache);
  }

  try {
    const payload = recentWinsInflight
      ? (markRouteInflightJoin(ROUTE_METRIC_KEY), await recentWinsInflight)
      : await (() => {
          const seq = ++recentWinsBuildSeq;
          recentWinsInflight = buildRecentWinsPayload()
            .then((result) => {
              return commitRecentWinsCache(result, RECENT_WINS_ROUTE_CACHE_MS, seq);
            })
            .finally(() => {
              recentWinsInflight = null;
            });
          return recentWinsInflight;
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
    return jsonNoStore({ wins: [], error: "fetch failed" }, 500);
  }
}
