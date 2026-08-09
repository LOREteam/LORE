import { NextRequest, NextResponse } from "next/server";
import { getAddress } from "viem";
import { getUserParticipatingEpochPage } from "../../../server/storage";
import { enforceSharedRateLimit } from "../_lib/sharedRateLimit";
import { applyNoStoreHeaders } from "../_lib/responseHeaders";
import { parseBoundedPositiveIntegerParam, parsePositiveIntegerParam } from "../_lib/queryParams";

const DEFAULT_PAGE_SIZE = 200;
const MAX_PAGE_SIZE = 400;

function jsonNoStore(payload: Record<string, unknown>, status = 200) {
  return applyNoStoreHeaders(NextResponse.json(payload, { status }));
}

export async function GET(request: NextRequest) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-claim-candidates",
    limit: 30,
    windowMs: 60_000,
  });
  if (rateLimited) return applyNoStoreHeaders(rateLimited);

  const userParam = request.nextUrl.searchParams.get("user");
  if (!userParam) return jsonNoStore({ error: "Missing ?user=0x..." }, 400);

  let user: `0x${string}`;
  try {
    user = getAddress(userParam);
  } catch {
    return jsonNoStore({ error: "Missing or invalid ?user=0x..." }, 400);
  }

  const cursorParam = request.nextUrl.searchParams.get("cursor");
  const limitParam = request.nextUrl.searchParams.get("limit");
  const beforeEpoch = parsePositiveIntegerParam(cursorParam);
  if (cursorParam !== null && beforeEpoch === null) {
    return jsonNoStore({ error: "Invalid cursor" }, 400);
  }

  const requestedLimit = limitParam === null ? DEFAULT_PAGE_SIZE : parseBoundedPositiveIntegerParam(limitParam, MAX_PAGE_SIZE);
  if (requestedLimit === null) return jsonNoStore({ error: "Invalid limit" }, 400);

  const page = getUserParticipatingEpochPage(user, {
    beforeEpoch,
    limit: requestedLimit,
  });
  return jsonNoStore(page);
}
