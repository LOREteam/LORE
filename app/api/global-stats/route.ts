import { NextResponse } from "next/server";
import { getGlobalStatsAggregate } from "../../../server/storage";
import { applyNoStoreHeaders } from "../_lib/responseHeaders";
import { enforceSharedRateLimit } from "../_lib/sharedRateLimit";

export async function GET(request: Request) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-global-stats",
    limit: 60,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  return applyNoStoreHeaders(NextResponse.json(getGlobalStatsAggregate()));
}
