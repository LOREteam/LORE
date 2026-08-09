import { NextResponse } from "next/server";
import { getAddress } from "viem";
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
import { readBoundedJsonBody } from "../_lib/boundedJsonBody";
import { parsePositiveIntegerValue } from "../_lib/queryParams";

type RewardsRequest = {
  user?: unknown;
  epochs?: unknown;
};

const MAX_EPOCHS_PER_REQUEST = 400;
const MAX_REQUEST_BODY_BYTES = 16_384;
const REWARDS_ROUTE_CACHE_MS = 15_000;
const MAX_REWARDS_CACHE_ENTRIES = 200;
const ROUTE_METRIC_KEY = "api/rewards";

type RewardsPayload = {
  rewards: Record<string, RewardRow>;
  error?: string;
};
type EpochsParseResult =
  | { ok: true; epochs: number[] }
  | { ok: false; error: string };

const rewardsRouteCache = createRouteCache<RewardsPayload>(MAX_REWARDS_CACHE_ENTRIES);

function jsonNoStore(payload: RewardsPayload | { error: string }, status = 200) {
  return applyNoStoreHeaders(NextResponse.json(payload, { status }));
}

function normalizeEpochs(epochsRaw: unknown): EpochsParseResult {
  if (!Array.isArray(epochsRaw)) return { ok: true, epochs: [] };
  if (epochsRaw.length > MAX_EPOCHS_PER_REQUEST) {
    return { ok: false, error: "Too many epochs" };
  }
  const epochs = new Set<number>();
  for (const value of epochsRaw) {
    const parsed = parsePositiveIntegerValue(value);
    if (parsed === null || parsed > 1_000_000) {
      return { ok: false, error: "Invalid epochs" };
    }
    epochs.add(parsed);
  }
  return { ok: true, epochs: [...epochs] };
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
  if (rateLimited) return applyNoStoreHeaders(rateLimited);

  let staleCache: RewardsPayload | null = null;
  const metric = beginRouteMetric(ROUTE_METRIC_KEY);

  try {
    const parsedBody = await readBoundedJsonBody<RewardsRequest>(request, MAX_REQUEST_BODY_BYTES);
    if (!parsedBody.ok && parsedBody.reason === "too-large") {
      failRouteMetric(metric, 413);
      return jsonNoStore({ error: "Rewards payload too large" }, 413);
    }
    if (!parsedBody.ok && parsedBody.reason === "unsupported-content-type") {
      failRouteMetric(metric, 415);
      return jsonNoStore({ error: "Rewards payload must be JSON" }, 415);
    }
    const body = parsedBody.ok ? parsedBody.value : null;
    if (!body || typeof body !== "object") {
      failRouteMetric(metric, 400);
      return jsonNoStore({ error: "Invalid rewards payload" }, 400);
    }

    let user: `0x${string}`;
    try {
      user = getAddress(typeof body.user === "string" ? body.user : "").toLowerCase() as `0x${string}`;
    } catch {
      failRouteMetric(metric, 400);
      return jsonNoStore({ error: "Missing or invalid user" }, 400);
    }

    const parsedEpochs = normalizeEpochs(body.epochs);
    if (!parsedEpochs.ok) {
      failRouteMetric(metric, 400);
      return jsonNoStore({ error: parsedEpochs.error }, 400);
    }
    const epochs = parsedEpochs.epochs;
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
          const requestPromise: Promise<RewardsPayload> = buildRewardsPayload(user, epochs)
            .then((result) => {
              return rewardsRouteCache.setIfLatest(cacheKey, result, REWARDS_ROUTE_CACHE_MS, writeVersion);
            })
            .finally(() => {
              rewardsRouteCache.finishWrite(cacheKey, writeVersion);
              rewardsRouteCache.clearInflight(cacheKey, requestPromise);
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
