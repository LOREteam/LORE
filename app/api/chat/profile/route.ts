import { NextRequest, NextResponse } from "next/server";
import { getChatProfile, getChatProfiles, upsertChatProfile } from "../../../../server/storage";
import { clearChatSession, readChatSession } from "../../_lib/chatSession";
import { applyNoStoreHeaders } from "../../_lib/responseHeaders";
import { createRouteCache } from "../../_lib/routeCache";
import { logRouteError } from "../../_lib/routeError";
import { enforceSharedRateLimit } from "../../_lib/sharedRateLimit";
import { sanitizeCustomChatAvatar, sanitizePresetChatAvatar } from "../../../lib/chatAvatar";

const MAX_NAME_LENGTH = 20;
const MAX_AVATAR_LENGTH = 8_000;
const CHAT_PROFILE_CACHE_MS = 5_000;
const CHAT_PROFILE_CACHE_MAX_ENTRIES = 48;
const chatProfileRouteCache = createRouteCache<{ profile?: ReturnType<typeof getChatProfile>; profiles?: ReturnType<typeof getChatProfiles> }>(CHAT_PROFILE_CACHE_MAX_ENTRIES);

type ProfilePayload = {
  walletAddress?: unknown;
  name?: unknown;
  avatar?: unknown;
  customAvatar?: unknown;
  updatedAt?: unknown;
};

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

export async function PUT(request: NextRequest) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-chat-profile",
    limit: 20,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  try {
    const body = (await request.json()) as ProfilePayload;
    const walletAddress = typeof body.walletAddress === "string" ? body.walletAddress.toLowerCase() : "";

    if (!isAddress(walletAddress)) {
      return applyNoStoreHeaders(NextResponse.json({ error: "Invalid wallet address" }, { status: 400 }), { varyCookie: true });
    }

    const session = readChatSession(request);
    if (!session || session.address !== walletAddress) {
      const response = applyNoStoreHeaders(NextResponse.json({ error: "Chat auth required" }, { status: 401 }), { varyCookie: true });
      clearChatSession(response);
      return response;
    }

    const payload = {
      name: typeof body.name === "string" ? body.name.trim().slice(0, MAX_NAME_LENGTH) : null,
      avatar: sanitizePresetChatAvatar(body.avatar),
      customAvatar: sanitizeCustomChatAvatar(body.customAvatar, MAX_AVATAR_LENGTH),
      updatedAt: Date.now(),
    };

    upsertChatProfile(walletAddress, {
      name: payload.name,
      avatar: payload.avatar,
      customAvatar: payload.customAvatar,
      updatedAt: payload.updatedAt,
    });
    chatProfileRouteCache.invalidate(`wallet:${walletAddress}`);

    return applyNoStoreHeaders(NextResponse.json({ ok: true }), { varyCookie: true });
  } catch (error) {
    logRouteError("api/chat/profile", error, { method: "PUT" });
    return applyNoStoreHeaders(NextResponse.json({ error: "Internal error" }, { status: 500 }), { varyCookie: true });
  }
}

export async function GET(request: NextRequest) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-chat-profile-read",
    limit: 90,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  try {
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get("walletAddress");
    const walletAddressesParam = searchParams.get("walletAddresses");
    const requestedAddresses = walletAddressesParam
      ? [...new Set(
          walletAddressesParam
            .split(",")
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean),
        )].slice(0, 100)
      : [];
    const cacheKey = walletAddress ? `wallet:${walletAddress.toLowerCase()}` : "all";
    const cached = chatProfileRouteCache.getFresh(cacheKey);
    if (cached) {
      return applyNoStoreHeaders(NextResponse.json(cached));
    }

    if (walletAddress) {
      if (!isAddress(walletAddress)) {
        return applyNoStoreHeaders(NextResponse.json({ error: "Invalid walletAddress" }, { status: 400 }));
      }
      const payload = {
        profile: getChatProfile(walletAddress.toLowerCase()),
      };
      chatProfileRouteCache.set(cacheKey, payload, CHAT_PROFILE_CACHE_MS);
      return applyNoStoreHeaders(NextResponse.json(payload));
    }

    if (requestedAddresses.length > 0) {
      if (!requestedAddresses.every((value) => isAddress(value))) {
        return applyNoStoreHeaders(NextResponse.json({ error: "Invalid walletAddresses" }, { status: 400 }));
      }
      const normalizedKey = `many:${requestedAddresses.slice().sort().join(",")}`;
      const manyCached = chatProfileRouteCache.getFresh(normalizedKey);
      if (manyCached) {
        return applyNoStoreHeaders(NextResponse.json(manyCached));
      }
      const payload = {
        profiles: getChatProfiles(requestedAddresses),
      };
      chatProfileRouteCache.set(normalizedKey, payload, CHAT_PROFILE_CACHE_MS);
      return applyNoStoreHeaders(NextResponse.json(payload));
    }

    const payload = {
      profiles: getChatProfiles(),
    };
    chatProfileRouteCache.set(cacheKey, payload, CHAT_PROFILE_CACHE_MS);
    return applyNoStoreHeaders(NextResponse.json(payload));
  } catch (error) {
    logRouteError("api/chat/profile", error, { method: "GET" });
    return applyNoStoreHeaders(NextResponse.json({ error: "Internal error" }, { status: 500 }));
  }
}
