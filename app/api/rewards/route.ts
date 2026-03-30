import { NextResponse } from "next/server";
import { applyNoStoreHeaders } from "../_lib/responseHeaders";
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
import { enforceSharedRateLimit } from "../_lib/sharedRateLimit";
import { RewardRow, loadRewardMapsForUserEpochs } from "../_lib/rewardSummary";

type RewardsRequest = {
  user?: unknown;
  epochs?: unknown;
};

const MAX_EPOCHS_PER_REQUEST = 400;
const REWARDS_ROUTE_CACHE_MS = 15_000;
const MAX_REWARDS_CACHE_ENTRIES = 200;
const ROUTE_METRIC_KEY = "api/rewards";

type RewardsPayload = {
  rewards: Record<string, RewardRow>;
  error?: string;
};

const rewardsRouteCache = createRouteCache<RewardsPayload>(MAX_REWARDS_CACHE_ENTRIES);

function jsonNoStore(payload: RewardsPayload | { error: string }, status = 200) {
  return applyNoStoreHeaders(NextResponse.json(payload, { status }));
}

function normalizeEpochs(epochsRaw: unknown) {
  return [...new Set(
    (Array.isArray(epochsRaw) ? epochsRaw : [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0),
  )].slice(0, MAX_EPOCHS_PER_REQUEST);
}

async function buildRewardsPayload(user: string, epochs: number[]): Promise<RewardsPayload> {
  if (epochs.length === 0) {
    return { rewards: {} };
  }

  const { rewards } = await loadRewardMapsForUserEpochs(user, epochs);
  return { rewards };
}

export async function POST(request: Request) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-rewards",
    limit: 20,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  let staleCache: RewardsPayload | null = null;
  const metric = beginRouteMetric(ROUTE_METRIC_KEY);

  try {
    const body = (await request.json()) as RewardsRequest;
    const user = typeof body.user === "string" ? body.user.toLowerCase() : "";
    if (!/^0x[0-9a-f]{40}$/.test(user)) {
      failRouteMetric(metric, 400);
      return jsonNoStore({ error: "Missing or invalid user" }, 400);
    }

    const epochs = normalizeEpochs(body.epochs);
    const cacheKey = `${user}:${epochs.join(",")}`;
    const now = Date.now();
    const cached = rewardsRouteCache.getFresh(cacheKey, now);
    if (cached) {
      markRouteCacheHit(ROUTE_METRIC_KEY);
      finishRouteMetric(metric, 200);
      return jsonNoStore(cached);
    }
    staleCache = rewardsRouteCache.getStale(cacheKey);

    const inflight = rewardsRouteCache.getInflight(cacheKey);
    const payload = inflight
      ? (markRouteInflightJoin(ROUTE_METRIC_KEY), await inflight)
      : await (() => {
          const writeVersion = rewardsRouteCache.beginWrite(cacheKey);
          const requestPromise = buildRewardsPayload(user, epochs)
            .then((result) => {
              return rewardsRouteCache.setIfLatest(cacheKey, result, REWARDS_ROUTE_CACHE_MS, writeVersion);
            })
            .finally(() => {
              rewardsRouteCache.clearInflight(cacheKey);
            });
          return rewardsRouteCache.setInflight(cacheKey, requestPromise);
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
    return jsonNoStore({ rewards: {}, error: "fetch failed" }, 500);
  }
}
