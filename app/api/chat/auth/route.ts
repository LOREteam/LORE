import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { APP_CHAIN_ID } from "../../../lib/constants";
import {
  CHAT_AUTH_PROOF_TTL_MS,
  getChatAuthProofTtlMs,
  isChatAuthIssuedAtValid,
  normalizeChatAuthAddress,
  parseChatAuthMessage,
} from "../../../lib/chatAuth";
import { getStableLineaReadRpcs } from "../../../../config/publicConfig";
import { APP_CHAIN, APP_NETWORK } from "../../_lib/dataBridge";
import {
  CHAT_AUTH_RPC_GLOBAL_LIMIT,
  CHAT_AUTH_RPC_GLOBAL_WINDOW_MS,
  ChatSignatureRpcBusyError,
  createChatSignatureRpcWitnesses,
  verifyChatWalletMessage,
} from "../../_lib/chatSignatureVerification";
import { applyNoStoreHeaders } from "../../_lib/responseHeaders";
import { logRouteError } from "../../_lib/routeError";
import {
  enforceSharedGlobalRateLimit,
  enforceSharedRateLimit,
} from "../../_lib/sharedRateLimit";
import { acquireExternalExpiringLock, requiresExternalSharedLock } from "../../_lib/externalRateLimit";
import { clearChatSession, issueChatSession, readChatSession } from "../../_lib/chatSession";
import { acquireExpiringLock } from "../../../../server/storage";
import { readBoundedJsonBody } from "../../_lib/boundedJsonBody";
import { getTrustedAuthOrigin, isTrustedAuthUri } from "../../_lib/trustedAuthOrigin";

const MAX_REQUEST_BODY_BYTES = 8_192;

class ChatAuthRpcAdmissionError extends Error {
  constructor(readonly response: NextResponse) {
    super("chat_auth_rpc_admission_denied");
    this.name = "ChatAuthRpcAdmissionError";
  }
}

const CHAT_AUTH_RPC_INPUT = [
  process.env.KEEPER_RPC_URL,
  APP_NETWORK === "mainnet"
    ? process.env.NEXT_PUBLIC_LINEA_RPCS
    : process.env.NEXT_PUBLIC_LINEA_SEPOLIA_RPCS,
].filter((value): value is string => Boolean(value)).join(",");
const CHAT_AUTH_RPC_WITNESSES = createChatSignatureRpcWitnesses({
  rpcUrls: getStableLineaReadRpcs(CHAT_AUTH_RPC_INPUT, APP_NETWORK),
  chain: APP_CHAIN,
});

type ChatAuthPayload = {
  authAddress?: unknown;
  authMessage?: unknown;
  authSignature?: unknown;
};

function buildProofKey(address: string, nonce: string, uri: string) {
  return createHash("sha256")
    .update(`${address.toLowerCase()}:${nonce}:${uri}`)
    .digest("hex");
}

function buildLegacyProofKey(address: string, nonce: string, signature: string) {
  return createHash("sha256")
    .update(`${address.toLowerCase()}:${nonce}:${signature}`)
    .digest("hex");
}

async function verifyChatSignature(address: `0x${string}`, message: string, signature: `0x${string}`) {
  return verifyChatWalletMessage({
    address,
    message,
    signature,
    rpcWitnesses: CHAT_AUTH_RPC_WITNESSES,
    beforeRpcVerification: async () => {
      const limited = await enforceSharedGlobalRateLimit({
        bucket: "api-chat-auth-rpc-outbound",
        limit: CHAT_AUTH_RPC_GLOBAL_LIMIT,
        windowMs: CHAT_AUTH_RPC_GLOBAL_WINDOW_MS,
      });
      if (limited) throw new ChatAuthRpcAdmissionError(limited);
    },
  });
}

async function consumeChatProof(
  address: string,
  nonce: string,
  uri: string,
  signature: string,
  ttlMs: number,
) {
  const proofKey = buildProofKey(address, nonce, uri);
  if (requiresExternalSharedLock()) {
    return acquireExternalExpiringLock(`chat-auth:${proofKey}`, ttlMs);
  }
  return [
    buildLegacyProofKey(address, nonce, signature),
    proofKey,
  ].every((key) => acquireExpiringLock(`chat-auth:${key}`, nonce, ttlMs));
}

export async function POST(request: NextRequest) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-chat-auth",
    limit: 12,
    windowMs: 60_000,
  });
  if (rateLimited) return applyNoStoreHeaders(rateLimited, { varyCookie: true });

  try {
    const parsedBody = await readBoundedJsonBody<ChatAuthPayload>(request, MAX_REQUEST_BODY_BYTES);
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

    const authAddress = normalizeChatAuthAddress(body.authAddress);
    const authMessage = typeof body.authMessage === "string" ? body.authMessage : "";
    const authSignature = typeof body.authSignature === "string" ? body.authSignature : "";

    if (!authAddress) {
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

    const trustedOrigin = getTrustedAuthOrigin(request.url);
    if (!trustedOrigin || !isTrustedAuthUri(fields.uri, trustedOrigin, "/chat")) {
      return applyNoStoreHeaders(NextResponse.json({ error: "Invalid auth origin" }, { status: 400 }), { varyCookie: true });
    }
    if (!isChatAuthIssuedAtValid(fields.issuedAt, Date.now(), CHAT_AUTH_PROOF_TTL_MS)) {
      return applyNoStoreHeaders(NextResponse.json({ error: "Expired auth proof" }, { status: 401 }), { varyCookie: true });
    }

    const verified = await verifyChatSignature(authAddress, authMessage, authSignature as `0x${string}`);
    if (!verified) {
      return applyNoStoreHeaders(NextResponse.json({ error: "Signature verification failed" }, { status: 401 }), { varyCookie: true });
    }

    const ttlMs = getChatAuthProofTtlMs(fields.issuedAt);
    if (ttlMs === null) {
      return applyNoStoreHeaders(NextResponse.json({ error: "Expired auth proof" }, { status: 401 }), { varyCookie: true });
    }
    const consumed = await consumeChatProof(authAddress, fields.nonce, fields.uri, authSignature, ttlMs);
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
    if (error instanceof ChatAuthRpcAdmissionError) {
      return applyNoStoreHeaders(error.response, { varyCookie: true });
    }
    if (error instanceof ChatSignatureRpcBusyError) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { error: "Signature verification busy", retryAfter: 1 },
          { status: 429, headers: { "Retry-After": "1" } },
        ),
        { varyCookie: true },
      );
    }
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
  if (rateLimited) return applyNoStoreHeaders(rateLimited, { varyCookie: true });

  const now = Date.now();
  const session = readChatSession(request, now);
  if (!session) {
    const response = applyNoStoreHeaders(
      NextResponse.json({ error: "Chat auth required" }, { status: 401 }),
      { varyCookie: true },
    );
    clearChatSession(response);
    return response;
  }

  const response = applyNoStoreHeaders(NextResponse.json({ ok: true }), { varyCookie: true });
  const expiresAt = issueChatSession(response, session.address, now);
  response.headers.set("x-chat-session-expires-at", String(expiresAt));
  return response;
}
