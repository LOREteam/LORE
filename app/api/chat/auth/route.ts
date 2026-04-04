import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { APP_CHAIN_ID } from "../../../lib/constants";
import {
  CHAT_AUTH_PROOF_TTL_MS,
  isChatAuthIssuedAtValid,
  parseChatAuthMessage,
} from "../../../lib/chatAuth";
import { applyNoStoreHeaders } from "../../_lib/responseHeaders";
import { logRouteError } from "../../_lib/routeError";
import { enforceSharedRateLimit } from "../../_lib/sharedRateLimit";
import { clearChatSession, issueChatSession, readChatSession } from "../../_lib/chatSession";
import { acquireExpiringLock } from "../../../../server/storage";

type ChatAuthPayload = {
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
    bucket: "api-chat-auth",
    limit: 12,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  try {
    const body = (await request.json()) as ChatAuthPayload;
    const authAddress = typeof body.authAddress === "string" ? body.authAddress.toLowerCase() : "";
    const authMessage = typeof body.authMessage === "string" ? body.authMessage : "";
    const authSignature = typeof body.authSignature === "string" ? body.authSignature : "";

    if (!isAddress(authAddress)) {
      return applyNoStoreHeaders(NextResponse.json({ error: "Invalid auth address" }, { status: 400 }), { varyCookie: true });
    }
    if (!/^0x[a-fA-F0-9]{128,130}$/.test(authSignature)) {
      return applyNoStoreHeaders(NextResponse.json({ error: "Invalid signature" }, { status: 400 }), { varyCookie: true });
    }

    const fields = parseChatAuthMessage(authMessage);
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
    if (!isChatAuthIssuedAtValid(fields.issuedAt, Date.now(), CHAT_AUTH_PROOF_TTL_MS)) {
      return applyNoStoreHeaders(NextResponse.json({ error: "Expired auth proof" }, { status: 401 }), { varyCookie: true });
    }

    const verified = await verifyMessage({
      address: authAddress,
      message: authMessage,
      signature: authSignature as `0x${string}`,
    });
    if (!verified) {
      return applyNoStoreHeaders(NextResponse.json({ error: "Signature verification failed" }, { status: 401 }), { varyCookie: true });
    }

    const proofKey = buildProofKey(authAddress, fields.nonce, authSignature);
    const issuedAtMs = Date.parse(fields.issuedAt);
    const ttlMs = Math.max(1, CHAT_AUTH_PROOF_TTL_MS - (Date.now() - issuedAtMs));
    const consumed = acquireExpiringLock(`chat-auth:${proofKey}`, fields.nonce, ttlMs);
    if (!consumed) {
      const response = applyNoStoreHeaders(NextResponse.json({ error: "Auth proof already used" }, { status: 409 }), { varyCookie: true });
      clearChatSession(response);
      return response;
    }

    const response = applyNoStoreHeaders(NextResponse.json({ ok: true }), { varyCookie: true });
    const expiresAt = issueChatSession(response, authAddress);
    response.headers.set("x-chat-session-expires-at", String(expiresAt));
    return response;
  } catch (error) {
    logRouteError("api/chat/auth", error);
    const response = applyNoStoreHeaders(NextResponse.json({ error: "Internal error" }, { status: 500 }), { varyCookie: true });
    clearChatSession(response);
    return response;
  }
}

export async function GET(request: NextRequest) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-chat-auth-refresh",
    limit: 60,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const session = readChatSession(request);
  if (!session) {
    const response = applyNoStoreHeaders(
      NextResponse.json({ error: "Chat auth required" }, { status: 401 }),
      { varyCookie: true },
    );
    clearChatSession(response);
    return response;
  }

  const response = applyNoStoreHeaders(NextResponse.json({ ok: true }), { varyCookie: true });
  const expiresAt = issueChatSession(response, session.address);
  response.headers.set("x-chat-session-expires-at", String(expiresAt));
  return response;
}
