import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { APP_CHAIN_ID } from "../../../../app/lib/constants";
import {
  ADMIN_AUTH_PROOF_TTL_MS,
  ADMIN_AUTH_WALLET,
  isAdminAuthIssuedAtValid,
  parseAdminAuthMessage,
} from "../../../lib/adminAuth";
import { publicClient } from "../../_lib/dataBridge";
import { applyNoStoreHeaders } from "../../_lib/responseHeaders";
import { logRouteError } from "../../_lib/routeError";
import { enforceSharedRateLimit } from "../../_lib/sharedRateLimit";
import { clearAdminSession, issueAdminSession, readAdminSession } from "../../_lib/adminSession";
import { acquireExpiringLock } from "../../../../server/storage";

type AdminAuthPayload = {
  authAddress?: unknown;
  authMessage?: unknown;
  authSignature?: unknown;
};

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function buildProofKey(address: string, nonce: string, signature: string) {
  return createHash("sha256")
    .update(`${address.toLowerCase()}:${nonce}:${signature}`)
    .digest("hex");
}

export async function POST(request: NextRequest) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-admin-auth",
    limit: 8,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  try {
    const body = (await request.json()) as AdminAuthPayload;
    const authAddress = typeof body.authAddress === "string" ? body.authAddress.toLowerCase() : "";
    const authMessage = typeof body.authMessage === "string" ? body.authMessage : "";
    const authSignature = typeof body.authSignature === "string" ? body.authSignature : "";

    if (!isAddress(authAddress)) {
      return applyNoStoreHeaders(NextResponse.json({ error: "Invalid auth address" }, { status: 400 }), { varyCookie: true });
    }
    if (authAddress !== ADMIN_AUTH_WALLET) {
      return applyNoStoreHeaders(NextResponse.json({ error: "Wallet is not allowed for admin access" }, { status: 403 }), { varyCookie: true });
    }
    if (!/^0x[a-fA-F0-9]{128,130}$/.test(authSignature)) {
      return applyNoStoreHeaders(NextResponse.json({ error: "Invalid signature" }, { status: 400 }), { varyCookie: true });
    }

    const fields = parseAdminAuthMessage(authMessage);
    if (!fields || fields.address !== authAddress) {
      return applyNoStoreHeaders(NextResponse.json({ error: "Invalid auth message" }, { status: 400 }), { varyCookie: true });
    }
    if (fields.chainId !== APP_CHAIN_ID) {
      return applyNoStoreHeaders(NextResponse.json({ error: "Invalid auth chain" }, { status: 400 }), { varyCookie: true });
    }

    const requestOrigin = new URL(request.url).origin;
    let messageOrigin = "";
    try {
      messageOrigin = new URL(fields.uri).origin;
    } catch {
      return applyNoStoreHeaders(NextResponse.json({ error: "Invalid auth origin" }, { status: 400 }), { varyCookie: true });
    }
    if (messageOrigin !== requestOrigin) {
      return applyNoStoreHeaders(NextResponse.json({ error: "Invalid auth origin" }, { status: 400 }), { varyCookie: true });
    }
    if (!isAdminAuthIssuedAtValid(fields.issuedAt, Date.now(), ADMIN_AUTH_PROOF_TTL_MS)) {
      return applyNoStoreHeaders(NextResponse.json({ error: "Expired auth proof" }, { status: 401 }), { varyCookie: true });
    }

    const verified = await publicClient.verifyMessage({
      address: authAddress,
      message: authMessage,
      signature: authSignature as `0x${string}`,
    });
    if (!verified) {
      return applyNoStoreHeaders(NextResponse.json({ error: "Signature verification failed" }, { status: 401 }), { varyCookie: true });
    }

    const proofKey = buildProofKey(authAddress, fields.nonce, authSignature);
    const issuedAtMs = Date.parse(fields.issuedAt);
    const ttlMs = Math.max(1, ADMIN_AUTH_PROOF_TTL_MS - (Date.now() - issuedAtMs));
    const consumed = acquireExpiringLock(`admin-auth:${proofKey}`, fields.nonce, ttlMs);
    if (!consumed) {
      const response = applyNoStoreHeaders(NextResponse.json({ error: "Auth proof already used" }, { status: 409 }), { varyCookie: true });
      clearAdminSession(response);
      return response;
    }

    const response = applyNoStoreHeaders(NextResponse.json({ ok: true }), { varyCookie: true });
    const expiresAt = issueAdminSession(response, authAddress);
    response.headers.set("x-admin-session-expires-at", String(expiresAt));
    return response;
  } catch (error) {
    logRouteError("api/admin/auth", error);
    const response = applyNoStoreHeaders(NextResponse.json({ error: "Internal error" }, { status: 500 }), { varyCookie: true });
    clearAdminSession(response);
    return response;
  }
}

export async function GET(request: NextRequest) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-admin-auth-refresh",
    limit: 60,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const session = readAdminSession(request);
  if (!session) {
    const response = applyNoStoreHeaders(
      NextResponse.json({ error: "Admin auth required" }, { status: 401 }),
      { varyCookie: true },
    );
    clearAdminSession(response);
    return response;
  }

  const response = applyNoStoreHeaders(NextResponse.json({ ok: true, address: session.address }), { varyCookie: true });
  const expiresAt = issueAdminSession(response, session.address);
  response.headers.set("x-admin-session-expires-at", String(expiresAt));
  return response;
}

export async function DELETE() {
  const response = applyNoStoreHeaders(NextResponse.json({ ok: true }), { varyCookie: true });
  clearAdminSession(response);
  return response;
}
