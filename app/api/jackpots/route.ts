import { NextResponse } from "next/server";
import { readJackpotPayload, type JackpotPayload } from "../_lib/jackpotsService";
import { applyNoStoreHeaders } from "../_lib/responseHeaders";
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

const ROUTE_METRIC_KEY = "api/jackpots";

function jsonNoStore(payload: JackpotPayload, status = 200) {
  return applyNoStoreHeaders(NextResponse.json(payload, { status }));
}

export async function GET(request: Request) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-jackpots",
    limit: 30,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const metric = beginRouteMetric(ROUTE_METRIC_KEY);

  try {
    const result = await readJackpotPayload();
    if (result.source === "cache") markRouteCacheHit(ROUTE_METRIC_KEY);
    if (result.source === "stale-cache") markRouteStaleServed(ROUTE_METRIC_KEY);
    if (result.source === "inflight") markRouteInflightJoin(ROUTE_METRIC_KEY);

    finishRouteMetric(metric, 200);
    return jsonNoStore(result.payload);
  } catch (err) {
    logRouteError(ROUTE_METRIC_KEY, err);
    const message = err instanceof Error ? err.message : "fetch failed";
    const status = message.startsWith("Firebase ") ? 502 : 500;
    failRouteMetric(metric, status);
    return jsonNoStore({ jackpots: [], error: message }, status);
  }
}
