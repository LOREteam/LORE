import { NextRequest, NextResponse } from "next/server";
import { formatUnits, getAddress } from "viem";
import { applyNoStoreHeaders } from "../_lib/responseHeaders";
import { enforceSharedRateLimit } from "../_lib/sharedRateLimit";
import { CONTRACT_ADDRESS, publicClient } from "../_lib/dataBridge";
import { logRouteError } from "../_lib/routeError";
import { CONTRACT_HAS_REBATE_API, GAME_ABI } from "../../lib/constants";
import { getUserParticipatingEpochPage } from "../../../server/storage";

const DEFAULT_PAGE_SIZE = 32;
const MAX_PAGE_SIZE = 64;

type RebateInfoResult = [bigint, bigint, bigint, boolean, boolean];

function jsonNoStore(payload: Record<string, unknown>, status = 200) {
  return applyNoStoreHeaders(NextResponse.json(payload, { status }));
}

function parsePositiveInteger(value: string | null) {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(request: NextRequest) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-rebate-history",
    limit: 20,
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
  const beforeEpoch = parsePositiveInteger(cursorParam);
  if (cursorParam !== null && beforeEpoch === null) {
    return jsonNoStore({ error: "Invalid cursor" }, 400);
  }
  const requestedLimit = limitParam === null ? DEFAULT_PAGE_SIZE : parsePositiveInteger(limitParam);
  if (requestedLimit === null) return jsonNoStore({ error: "Invalid limit" }, 400);

  if (!CONTRACT_HAS_REBATE_API) {
    return jsonNoStore({ isSupported: false, rows: [], hasMore: false, nextCursor: null });
  }

  const page = getUserParticipatingEpochPage(user, {
    beforeEpoch,
    limit: Math.min(requestedLimit, MAX_PAGE_SIZE),
  });
  if (page.epochs.length === 0) {
    return jsonNoStore({ isSupported: true, rows: [], hasMore: false, nextCursor: null });
  }

  try {
    const contracts = page.epochs.map((epoch) => ({
      address: CONTRACT_ADDRESS,
      abi: GAME_ABI,
      functionName: "getRebateInfo" as const,
      args: [BigInt(epoch), user] as const,
    }));
    const results = await publicClient.multicall({
      contracts,
      allowFailure: false,
    }) as RebateInfoResult[];
    const rows = results.map(([rebatePoolWei, userVolumeWei, pendingWei, claimed, resolved], index) => ({
      epoch: page.epochs[index],
      pendingWei: pendingWei.toString(),
      pending: formatUnits(pendingWei, 18),
      claimed,
      resolved,
      userVolumeWei: userVolumeWei.toString(),
      rebatePoolWei: rebatePoolWei.toString(),
    }));

    return jsonNoStore({
      isSupported: true,
      rows,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    });
  } catch (error) {
    logRouteError("api/rebate-history", error, { phase: "page-read" });
    return jsonNoStore({ error: "Unable to load older Safety Pool history" }, 503);
  }
}
