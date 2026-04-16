import { NextRequest, NextResponse } from "next/server";
import { getChatMessages, insertChatMessage } from "../../../../server/storage";
import { clearChatSession, readChatSession } from "../../_lib/chatSession";
import { applyNoStoreHeaders } from "../../_lib/responseHeaders";
import { createRouteCache } from "../../_lib/routeCache";
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
import { logRouteError } from "../../_lib/routeError";

const MAX_TEXT_LENGTH = 280;
const MAX_NAME_LENGTH = 20;
const MAX_AVATAR_LENGTH = 8_000;
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

const chatMessagesRouteCache = createRouteCache<ChatMessagesPayload>(MAX_CHAT_CACHE_ENTRIES);

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function invalidateCachedChatMessages(cacheKey: string) {
  chatMessagesRouteCache.invalidate(cacheKey);
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
  if (rateLimited) return rateLimited;

  const metric = beginRouteMetric(ROUTE_METRIC_KEY);
  const cacheKey = "latest";
  try {
    const body = (await request.json()) as ChatMessagePayload;
    const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT_LENGTH) : "";
    const sender = typeof body.sender === "string" ? body.sender.toLowerCase() : "";

    if (!text) {
      failRouteMetric(metric, 400);
      return applyNoStoreHeaders(NextResponse.json({ error: "Message text is required" }, { status: 400 }), { varyCookie: true });
    }
    if (!isAddress(sender)) {
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

    const senderName =
      typeof body.senderName === "string" ? body.senderName.trim().slice(0, MAX_NAME_LENGTH) : null;
    const senderAvatar = sanitizeChatAvatarValue(body.senderAvatar, MAX_AVATAR_LENGTH);

    insertChatMessage({
      sender,
      senderName,
      senderAvatar,
      text,
      timestamp: Date.now(),
    });

    invalidateCachedChatMessages(cacheKey);

    finishRouteMetric(metric, 200);
    return applyNoStoreHeaders(NextResponse.json({ ok: true }), { varyCookie: true });
  } catch (error) {
    logRouteError(ROUTE_METRIC_KEY, error, { method: "POST" });
    invalidateCachedChatMessages(cacheKey);
    failRouteMetric(metric, 500);
    return applyNoStoreHeaders(NextResponse.json({ error: "Internal error" }, { status: 500 }), { varyCookie: true });
  }
}

export async function GET(request: NextRequest) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-chat-messages-read",
    limit: 60,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const metric = beginRouteMetric(ROUTE_METRIC_KEY);
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
          const version = chatMessagesRouteCache.getWriteVersion(cacheKey);
          const requestPromise = Promise.resolve({ messages: getChatMessages() })
            .then((result) => {
              return chatMessagesRouteCache.setIfLatest(cacheKey, result, CHAT_MESSAGES_CACHE_MS, version);
            })
            .finally(() => {
              chatMessagesRouteCache.clearInflight(cacheKey);
            });
          return chatMessagesRouteCache.setInflight(cacheKey, requestPromise);
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
