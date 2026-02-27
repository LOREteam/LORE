import { NextRequest, NextResponse } from "next/server";
import { CONTRACT_ADDRESS } from "../../../lib/constants";

export async function GET(request: NextRequest) {
  try {
    // Get the wallet address from query params
    const { searchParams } = new URL(request.url);
    const address = searchParams.get("address");

    if (!address || !/^0x[0-9a-f]{40}$/i.test(address)) {
      return NextResponse.json({ isOwner: false, error: "Invalid address" }, { status: 400 });
    }

    // Fetch owner from blockchain
    const rpcUrl = process.env.KEEPER_RPC_URL || "https://rpc.sepolia.linea.build";
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_call",
        params: [{
          to: CONTRACT_ADDRESS,
          data: "0x8da5cb5b", // owner() function selector
        }, "latest"],
        id: 1,
      }),
    });

    const result = await response.json();
    
    if (!result.result) {
      return NextResponse.json({ isOwner: false, error: "Failed to fetch owner" }, { status: 500 });
    }

    // Parse the owner address from the result
    const ownerAddress = "0x" + result.result.slice(-40);
    const isOwner = ownerAddress.toLowerCase() === address.toLowerCase();

    return NextResponse.json({ isOwner, owner: ownerAddress });
  } catch (err) {
    console.error("[api/admin/check-owner] Error:", err);
    return NextResponse.json({ isOwner: false, error: "Internal error" }, { status: 500 });
  }
}
