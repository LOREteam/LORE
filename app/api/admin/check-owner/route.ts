import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, getAddress, http, parseAbi } from "viem";
import { CONTRACT_ADDRESS } from "../../../lib/constants";
import { APP_CHAIN, RPC_URL } from "../../_lib/dataBridge";
import { enforceSharedRateLimit } from "../../_lib/sharedRateLimit";

const OWNER_ABI = parseAbi(["function owner() view returns (address)"]);

export async function GET(request: NextRequest) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-admin-check-owner",
    limit: 5,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get("address");

    if (!address || !/^0x[0-9a-f]{40}$/i.test(address)) {
      return NextResponse.json({ isOwner: false, error: "Invalid address" }, { status: 400 });
    }

    const publicClient = createPublicClient({
      chain: APP_CHAIN,
      transport: http(RPC_URL, { timeout: 10_000, retryCount: 1 }),
    });

    const ownerAddress = await publicClient.readContract({
      address: CONTRACT_ADDRESS,
      abi: OWNER_ABI,
      functionName: "owner",
    });

    const normalizedOwner = getAddress(ownerAddress);
    const isOwner = normalizedOwner.toLowerCase() === address.toLowerCase();

    return NextResponse.json({ isOwner, owner: normalizedOwner });
  } catch (err) {
    console.error("[api/admin/check-owner] Error:", err);
    return NextResponse.json({ isOwner: false, error: "Internal error" }, { status: 500 });
  }
}
