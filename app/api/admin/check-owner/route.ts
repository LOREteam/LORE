import { NextRequest, NextResponse } from "next/server";
import { getAddress, parseAbi } from "viem";
import { CONTRACT_ADDRESS } from "../../../lib/constants";
import { publicClient } from "../../_lib/dataBridge";
import { applyNoStoreHeaders } from "../../_lib/responseHeaders";
import { logRouteError } from "../../_lib/routeError";
import { enforceSharedRateLimit } from "../../_lib/sharedRateLimit";

const OWNER_ABI = parseAbi(["function owner() view returns (address)"]);

export async function GET(request: NextRequest) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-admin-check-owner",
    limit: 5,
    windowMs: 60_000,
  });
  if (rateLimited) return applyNoStoreHeaders(rateLimited);

  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get("address");

    let normalizedAddress: `0x${string}`;
    try {
      normalizedAddress = getAddress(address ?? "").toLowerCase() as `0x${string}`;
    } catch {
      return applyNoStoreHeaders(NextResponse.json({ isOwner: false, error: "Invalid address" }, { status: 400 }));
    }

    const ownerAddress = await publicClient.readContract({
      address: CONTRACT_ADDRESS,
      abi: OWNER_ABI,
      functionName: "owner",
    });

    const normalizedOwner = getAddress(ownerAddress);
    const isOwner = normalizedOwner.toLowerCase() === normalizedAddress;

    return applyNoStoreHeaders(NextResponse.json({ isOwner, owner: normalizedOwner }));
  } catch (err) {
    logRouteError("api/admin/check-owner", err);
    return applyNoStoreHeaders(NextResponse.json({ isOwner: false, error: "Internal error" }, { status: 500 }));
  }
}
