import { NextRequest, NextResponse } from "next/server";
import { getChatMessages, insertChatMessage } from "../../../../server/storage";
import { clearChatSession, readChatSession } from "../../_lib/chatSession";
import { applyNoStoreHeaders } from "../../_lib/responseHeaders";
import { createRouteCache } from "../../_lib/routeCache";
import { startVersionedInflightBuild } from "../../_lib/versionedRouteCache";
import {
  beginRouteMetric,
  failRouteMetric,
  finishRouteMetric,
  markRouteCacheHit,
  markRouteInflightJoin,
  markRouteStaleServed,
} from "../../_lib/runtimeMetrics";
import { enforceSharedRateLimit } from "../../_lib/sharedRateLimit";
import { sanitizeChatAvatarValue } from "../../../lib/chatAvatar";
import { normalizeChatAuthAddress } from "../../../lib/chatAuth";
import { logRouteError } from "../../_lib/routeError";
import { readBoundedJsonBody } from "../../_lib/boundedJsonBody";

const MAX_TEXT_LENGTH = 280;
const MAX_NAME_LENGTH = 20;
const MAX_AVATAR_LENGTH = 8_000;
const MAX_REQUEST_BODY_BYTES = 16_384;
const CHAT_MESSAGES_CACHE_MS = 1_000;
const MAX_CHAT_CACHE_ENTRIES = 4;
const ROUTE_METRIC_KEY = "api/chat/messages";

type ChatMessagePayload = {
  text?: unknown;
  sender?: unknown;
  senderName?: unknown;
  senderAvatar?: unknown;
};

type ChatMessagesPayload = {
  messages: ReturnType<typeof getChatMessages>;
  error?: string;
};

type ChatMessageWritePayload = {
  ok: true;
  message: ReturnType<typeof insertChatMessage>;
};

const chatMessagesRouteCache = createRouteCache<ChatMessagesPayload>(MAX_CHAT_CACHE_ENTRIES);

function invalidateCachedChatMessages(cacheKey: string) {
  chatMessagesRouteCache.invalidate(cacheKey);
}

function sortChatMessagesAsc<T extends { timestamp: number; id?: string }>(rows: T[]) {
  return [...rows].sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    return (a.id ?? "").localeCompare(b.id ?? "");
  });
}

function jsonNoStore(payload: ChatMessagesPayload, status = 200) {
  return applyNoStoreHeaders(NextResponse.json(payload, { status }));
}

export async function POST(request: NextRequest) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-chat-messages",
    limit: 12,
    windowMs: 60_000,
  });
  if (rateLimited) return applyNoStoreHeaders(rateLimited, { varyCookie: true });

  const metric = beginRouteMetric(ROUTE_METRIC_KEY);
  const cacheKey = "latest";
  try {
    const parsedBody = await readBoundedJsonBody<ChatMessagePayload>(request, MAX_REQUEST_BODY_BYTES);
    if (!parsedBody.ok && parsedBody.reason === "too-large") {
      failRouteMetric(metric, 413);
      return applyNoStoreHeaders(NextResponse.json({ error: "Message payload too large" }, { status: 413 }), { varyCookie: true });
    }
    if (!parsedBody.ok && parsedBody.reason === "unsupported-content-type") {
      failRouteMetric(metric, 415);
      return applyNoStoreHeaders(NextResponse.json({ error: "Message payload must be JSON" }, { status: 415 }), { varyCookie: true });
    }
    const body = parsedBody.ok ? parsedBody.value : null;
    if (!body || typeof body !== "object") {
      failRouteMetric(metric, 400);
      return applyNoStoreHeaders(NextResponse.json({ error: "Invalid message payload" }, { status: 400 }), { varyCookie: true });
    }

    const text = typeof body.text === "string" ? body.text.trim() : "";
    const sender = normalizeChatAuthAddress(body.sender);

    if (!text) {
      failRouteMetric(metric, 400);
      return applyNoStoreHeaders(NextResponse.json({ error: "Message text is required" }, { status: 400 }), { varyCookie: true });
    }
    if (text.length > MAX_TEXT_LENGTH) {
      failRouteMetric(metric, 400);
      return applyNoStoreHeaders(NextResponse.json({ error: "Message text is too long" }, { status: 400 }), { varyCookie: true });
    }
    if (!sender) {
      failRouteMetric(metric, 400);
      return applyNoStoreHeaders(NextResponse.json({ error: "Invalid sender" }, { status: 400 }), { varyCookie: true });
    }

    const session = readChatSession(request);
    if (!session || session.address !== sender) {
      failRouteMetric(metric, 401);
      const response = applyNoStoreHeaders(NextResponse.json({ error: "Chat auth required" }, { status: 401 }), { varyCookie: true });
      clearChatSession(response);
      return response;
    }

    const senderName = typeof body.senderName === "string" ? body.senderName.trim() : null;
    if (senderName !== null && senderName.length > MAX_NAME_LENGTH) {
      failRouteMetric(metric, 400);
      return applyNoStoreHeaders(NextResponse.json({ error: "Sender name is too long" }, { status: 400 }), { varyCookie: true });
    }
    const senderAvatar = sanitizeChatAvatarValue(body.senderAvatar, MAX_AVATAR_LENGTH);

    const message = insertChatMessage({
      sender,
      senderName,
      senderAvatar,
      text,
      timestamp: Date.now(),
    });

    invalidateCachedChatMessages(cacheKey);

    finishRouteMetric(metric, 200);
    return applyNoStoreHeaders(NextResponse.json({ ok: true, message } satisfies ChatMessageWritePayload), { varyCookie: true });
  } catch (error) {
    logRouteError(ROUTE_METRIC_KEY, error, { method: "POST" });
    invalidateCachedChatMessages(cacheKey);
    failRouteMetric(metric, 500);
    return applyNoStoreHeaders(NextResponse.json({ error: "Internal error" }, { status: 500 }), { varyCookie: true });
  }
}

export async function GET(request: NextRequest) {
  const metric = beginRouteMetric(ROUTE_METRIC_KEY);
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-chat-messages-read",
    limit: 60,
    windowMs: 60_000,
  });
  if (rateLimited) {
    failRouteMetric(metric, 429);
    return applyNoStoreHeaders(rateLimited);
  }

  const cacheKey = "latest";
  const now = Date.now();
  const cached = chatMessagesRouteCache.getFresh(cacheKey, now);
  if (cached) {
    markRouteCacheHit(ROUTE_METRIC_KEY);
    finishRouteMetric(metric, 200);
    return jsonNoStore(cached);
  }
  const staleCache = chatMessagesRouteCache.getStale(cacheKey);

  try {
    const inflight = chatMessagesRouteCache.getInflight(cacheKey);
    const payload = inflight
      ? (markRouteInflightJoin(ROUTE_METRIC_KEY), await inflight)
      : await (() => {
          const { requestPromise } = startVersionedInflightBuild({
            cache: chatMessagesRouteCache,
            cacheKey,
            ttlMs: CHAT_MESSAGES_CACHE_MS,
            build: async () => ({ messages: sortChatMessagesAsc(getChatMessages()) }),
            toPayload: (result) => result,
          });
          return requestPromise;
        })();

    finishRouteMetric(metric, 200);
    return jsonNoStore(payload);
  } catch (error) {
    logRouteError(ROUTE_METRIC_KEY, error, { method: "GET" });
    if (staleCache) {
      markRouteStaleServed(ROUTE_METRIC_KEY);
      finishRouteMetric(metric, 200);
      return jsonNoStore(staleCache);
    }
    failRouteMetric(metric, 500);
    return jsonNoStore({ messages: [], error: "Internal error" }, 500);
  }
}
