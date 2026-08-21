import { NextRequest, NextResponse } from "next/server";
import { getAddress } from "viem";
import { applyNoStoreHeaders } from "../_lib/responseHeaders";
import { enforceSharedRateLimit } from "../_lib/sharedRateLimit";
import { parseBoundedPositiveIntegerParam } from "../_lib/queryParams";
import { decodeUserActivityCursor, getUserActivityPage } from "../../../server/storage";
import { logRouteError } from "../_lib/routeError";

const DEFAULT_LIMIT = 32;
const MAX_LIMIT = 64;

function jsonNoStore(payload: Record<string, unknown>, status = 200) {
  return applyNoStoreHeaders(NextResponse.json(payload, { status }));
}

/**
 * Read-only indexed user activity. The ledger has no implicit chain scan or
 * raw-table backfill, so every successful response explicitly declares
 * partial coverage.
 */
export async function GET(request: NextRequest) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-activity",
    limit: 30,
    windowMs: 60_000,
  });
  if (rateLimited) return applyNoStoreHeaders(rateLimited);

  const userParam = request.nextUrl.searchParams.get("user");
  let user: `0x${string}`;
  try {
    user = getAddress(userParam ?? "").toLowerCase() as `0x${string}`;
  } catch {
    return jsonNoStore({ error: "Missing or invalid ?user=0x..." }, 400);
  }

  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam === null
    ? DEFAULT_LIMIT
    : parseBoundedPositiveIntegerParam(limitParam, MAX_LIMIT);
  if (limit === null) return jsonNoStore({ error: "Invalid limit" }, 400);

  const cursor = request.nextUrl.searchParams.get("cursor");
  if (cursor !== null && decodeUserActivityCursor(cursor) === null) {
    return jsonNoStore({ error: "Invalid cursor" }, 400);
  }

  try {
    const page = getUserActivityPage(user, { cursor, limit });
    return jsonNoStore({
      rows: page.rows,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
      coverage: page.coverage,
      indexedThroughBlock: page.indexedThroughBlock,
    });
  } catch (error) {
    logRouteError("api/activity", error, { phase: "storage-read" });
    return jsonNoStore({ error: "Indexed activity is temporarily unavailable" }, 503);
  }
}
