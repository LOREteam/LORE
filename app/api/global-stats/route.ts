import { NextResponse } from "next/server";
import { getGlobalStatsAggregate, getPublicReadModelRevision } from "../../../server/storage";
import { createPublicReadModelCacheKey } from "../_lib/publicReadModelPolicy";
import { applyNoStoreHeaders } from "../_lib/responseHeaders";
import { createRouteCache } from "../_lib/routeCache";
import { enforceSharedRateLimit } from "../_lib/sharedRateLimit";

const GLOBAL_STATS_ROUTE_CACHE_MS = 15_000;
const GLOBAL_STATS_CACHE_NAMESPACE = "global-stats";
const PUBLIC_READ_MODEL_STABILITY_ATTEMPTS = 2;
const globalStatsRouteCache = createRouteCache<ReturnType<typeof getGlobalStatsAggregate>>(2);

export async function GET(request: Request) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-global-stats",
    limit: 60,
    windowMs: 60_000,
  });
  if (rateLimited) return applyNoStoreHeaders(rateLimited);

  for (let attempt = 0; attempt < PUBLIC_READ_MODEL_STABILITY_ATTEMPTS; attempt += 1) {
    const revision = getPublicReadModelRevision();
    const cacheKey = createPublicReadModelCacheKey(GLOBAL_STATS_CACHE_NAMESPACE, revision);
    const cached = globalStatsRouteCache.getFresh(cacheKey);
    if (cached) {
      if (getPublicReadModelRevision() === revision) {
        return applyNoStoreHeaders(NextResponse.json(cached));
      }
      continue;
    }

    const payload = getGlobalStatsAggregate();
    if (getPublicReadModelRevision() !== revision) continue;

    globalStatsRouteCache.set(cacheKey, payload, GLOBAL_STATS_ROUTE_CACHE_MS);
    return applyNoStoreHeaders(NextResponse.json(payload));
  }

  // A continuously changing multi-process revision must not populate a cache.
  return applyNoStoreHeaders(NextResponse.json(getGlobalStatsAggregate()));
}
