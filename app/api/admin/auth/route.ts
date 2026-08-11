import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { recoverMessageAddress } from "viem";
import { APP_CHAIN_ID } from "../../../../app/lib/constants";
import {
  ADMIN_AUTH_PROOF_TTL_MS,
  ADMIN_AUTH_WALLET,
  ADMIN_AUTH_WALLET_CONFIGURED,
  getAdminAuthProofTtlMs,
  isAdminAuthIssuedAtValid,
  normalizeAdminAuthAddress,
  parseAdminAuthMessage,
} from "../../../lib/adminAuth";
import { applyNoStoreHeaders } from "../../_lib/responseHeaders";
import { logRouteError } from "../../_lib/routeError";
import { enforceSharedRateLimit } from "../../_lib/sharedRateLimit";
import { acquireExternalExpiringLock, requiresExternalSharedLock } from "../../_lib/externalRateLimit";
import {
  clearAdminSession,
  issueAdminSession,
  readAdminSessionForRefresh,
  revokeAdminSession,
  rotateAdminSession,
} from "../../_lib/adminSession";
import { acquireExpiringLock } from "../../../../server/storage";
import { readBoundedJsonBody } from "../../_lib/boundedJsonBody";
import { getTrustedAuthOrigin, isTrustedAuthUri } from "../../_lib/trustedAuthOrigin";

const MAX_REQUEST_BODY_BYTES = 8_192;

type AdminAuthPayload = {
  authAddress?: unknown;
  authMessage?: unknown;
  authSignature?: unknown;
};

function buildProofKey(address: string, nonce: string, uri: string) {
  return createHash("sha256")
    .update(`${address.toLowerCase()}:${nonce}:${uri}`)
    .digest("hex");
}

async function consumeAdminProof(address: string, nonce: string, uri: string, ttlMs: number) {
  const proofKey = buildProofKey(address, nonce, uri);
  if (requiresExternalSharedLock()) {
    return acquireExternalExpiringLock(`admin-auth:${proofKey}`, ttlMs);
  }
  return acquireExpiringLock(`admin-auth:${proofKey}`, nonce, ttlMs);
}

async function verifyAdminEoaMessage(message: string, signature: `0x${string}`) {
  try {
    // Admin authentication is intentionally EOA-only. Never delegate this
    // authorization decision to an RPC or enable contract-wallet fallbacks.
    const recoveredAddress = await recoverMessageAddress({ message, signature });
    return normalizeAdminAuthAddress(recoveredAddress) === ADMIN_AUTH_WALLET;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!ADMIN_AUTH_WALLET_CONFIGURED) {
    return applyNoStoreHeaders(
      NextResponse.json({ error: "Admin wallet is not configured on this environment" }, { status: 503 }),
      { varyCookie: true },
    );
  }

  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-admin-auth",
    limit: 8,
    windowMs: 60_000,
  });
  if (rateLimited) return applyNoStoreHeaders(rateLimited, { varyCookie: true });

  try {
    const parsedBody = await readBoundedJsonBody<AdminAuthPayload>(request, MAX_REQUEST_BODY_BYTES);
    if (!parsedBody.ok && parsedBody.reason === "too-large") {
      return applyNoStoreHeaders(NextResponse.json({ error: "Auth payload too large" }, { status: 413 }), { varyCookie: true });
    }
    if (!parsedBody.ok && parsedBody.reason === "unsupported-content-type") {
      return applyNoStoreHeaders(NextResponse.json({ error: "Auth payload must be JSON" }, { status: 415 }), { varyCookie: true });
    }
    const body = parsedBody.ok ? parsedBody.value : null;
    if (!body || typeof body !== "object") {
      return applyNoStoreHeaders(NextResponse.json({ error: "Invalid auth payload" }, { status: 400 }), { varyCookie: true });
    }

    const authAddress = normalizeAdminAuthAddress(body.authAddress);
    const authMessage = typeof body.authMessage === "string" ? body.authMessage : "";
    const authSignature = typeof body.authSignature === "string" ? body.authSignature : "";

    if (!authAddress) {
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

    const trustedOrigin = getTrustedAuthOrigin(request.url);
    if (!trustedOrigin || !isTrustedAuthUri(fields.uri, trustedOrigin, "/admin")) {
      return applyNoStoreHeaders(NextResponse.json({ error: "Invalid auth origin" }, { status: 400 }), { varyCookie: true });
    }
    if (!isAdminAuthIssuedAtValid(fields.issuedAt, Date.now(), ADMIN_AUTH_PROOF_TTL_MS)) {
      return applyNoStoreHeaders(NextResponse.json({ error: "Expired auth proof" }, { status: 401 }), { varyCookie: true });
    }

    const verified = await verifyAdminEoaMessage(authMessage, authSignature as `0x${string}`);
    if (!verified) {
      return applyNoStoreHeaders(NextResponse.json({ error: "Signature verification failed" }, { status: 401 }), { varyCookie: true });
    }

    const ttlMs = getAdminAuthProofTtlMs(fields.issuedAt);
    if (ttlMs === null) {
      return applyNoStoreHeaders(NextResponse.json({ error: "Expired auth proof" }, { status: 401 }), { varyCookie: true });
    }
    const consumed = await consumeAdminProof(authAddress, fields.nonce, fields.uri, ttlMs);
    if (!consumed) {
      const response = applyNoStoreHeaders(NextResponse.json({ error: "Auth proof already used" }, { status: 409 }), { varyCookie: true });
      clearAdminSession(response);
      return response;
    }

    const response = applyNoStoreHeaders(NextResponse.json({ ok: true }), { varyCookie: true });
    const expiresAt = await issueAdminSession(response, authAddress);
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
  if (rateLimited) return applyNoStoreHeaders(rateLimited, { varyCookie: true });

  let session;
  try {
    session = await readAdminSessionForRefresh(request);
  } catch (error) {
    logRouteError("api/admin/auth", error, { action: "refresh-read" });
    return applyNoStoreHeaders(
      NextResponse.json({ error: "Admin session refresh unavailable" }, { status: 503 }),
      { varyCookie: true },
    );
  }
  if (!session) {
    const response = applyNoStoreHeaders(
      NextResponse.json({ error: "Admin auth required" }, { status: 401 }),
      { varyCookie: true },
    );
    clearAdminSession(response);
    return response;
  }

  try {
    const response = applyNoStoreHeaders(NextResponse.json({ ok: true, address: session.address }), { varyCookie: true });
    const expiresAt = await rotateAdminSession(response, session);
    if (expiresAt === null) {
      const unauthorized = applyNoStoreHeaders(
        NextResponse.json({ error: "Admin session is no longer active" }, { status: 401 }),
        { varyCookie: true },
      );
      clearAdminSession(unauthorized);
      return unauthorized;
    }
    response.headers.set("x-admin-session-expires-at", String(expiresAt));
    return response;
  } catch (error) {
    logRouteError("api/admin/auth", error, { action: "refresh" });
    const response = applyNoStoreHeaders(
      NextResponse.json({ error: "Admin session refresh unavailable" }, { status: 503 }),
      { varyCookie: true },
    );
    return response;
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await revokeAdminSession(request);
    const response = applyNoStoreHeaders(NextResponse.json({ ok: true }), { varyCookie: true });
    clearAdminSession(response);
    return response;
  } catch (error) {
    logRouteError("api/admin/auth", error, { action: "logout" });
    const response = applyNoStoreHeaders(
      NextResponse.json({ error: "Admin session logout unavailable" }, { status: 503 }),
      { varyCookie: true },
    );
    return response;
  }
}
