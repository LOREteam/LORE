import { NextRequest, NextResponse } from "next/server";
import { getChatProfile, getChatProfiles, upsertChatProfile } from "../../../../server/storage";
import { clearChatSession, readChatSession } from "../../_lib/chatSession";
import { applyNoStoreHeaders } from "../../_lib/responseHeaders";
import { createRouteCache } from "../../_lib/routeCache";
import { logRouteError } from "../../_lib/routeError";
import { enforceSharedRateLimit } from "../../_lib/sharedRateLimit";
import { sanitizeCustomChatAvatar, sanitizePresetChatAvatar } from "../../../lib/chatAvatar";
import { readBoundedJsonBody } from "../../_lib/boundedJsonBody";

const MAX_NAME_LENGTH = 20;
const MAX_AVATAR_LENGTH = 8_000;
const MAX_REQUEST_BODY_BYTES = 16_384;
const CHAT_PROFILE_CACHE_MS = 5_000;
const CHAT_PROFILE_CACHE_MAX_ENTRIES = 48;
const chatProfileRouteCache = createRouteCache<{ profile?: ReturnType<typeof getChatProfile>; profiles?: ReturnType<typeof getChatProfiles> }>(CHAT_PROFILE_CACHE_MAX_ENTRIES);
const chatProfileCacheKeysByWallet = new Map<string, Set<string>>();
const chatProfileWalletsByCacheKey = new Map<string, Set<string>>();

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

function rememberProfileCacheKey(wallets: string[], cacheKey: string) {
  for (const wallet of wallets) {
    const keys = chatProfileCacheKeysByWallet.get(wallet) ?? new Set<string>();
    keys.add(cacheKey);
    chatProfileCacheKeysByWallet.set(wallet, keys);
  }
  chatProfileWalletsByCacheKey.set(cacheKey, new Set(wallets));
  pruneProfileCacheIndex();
}

function forgetProfileCacheKey(cacheKey: string) {
  const wallets = chatProfileWalletsByCacheKey.get(cacheKey);
  if (!wallets) return;
  for (const wallet of wallets) {
    const keys = chatProfileCacheKeysByWallet.get(wallet);
    if (!keys) continue;
    keys.delete(cacheKey);
    if (keys.size === 0) chatProfileCacheKeysByWallet.delete(wallet);
  }
  chatProfileWalletsByCacheKey.delete(cacheKey);
}

function pruneProfileCacheIndex() {
  while (chatProfileWalletsByCacheKey.size > CHAT_PROFILE_CACHE_MAX_ENTRIES) {
    const oldestKey = chatProfileWalletsByCacheKey.keys().next().value;
    if (!oldestKey) break;
    forgetProfileCacheKey(oldestKey);
  }
}

function clearProfileCacheForWallet(wallet: string) {
  chatProfileRouteCache.delete("all");
  chatProfileRouteCache.delete(`wallet:${wallet}`);
  for (const cacheKey of Array.from(chatProfileCacheKeysByWallet.get(wallet) ?? [])) {
    chatProfileRouteCache.delete(cacheKey);
    forgetProfileCacheKey(cacheKey);
  }
  chatProfileCacheKeysByWallet.delete(wallet);
}

export async function PUT(request: NextRequest) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-chat-profile",
    limit: 20,
    windowMs: 60_000,
  });
  if (rateLimited) return applyNoStoreHeaders(rateLimited, { varyCookie: true });

  try {
    const parsedBody = await readBoundedJsonBody<ProfilePayload>(request, MAX_REQUEST_BODY_BYTES);
    if (!parsedBody.ok && parsedBody.reason === "too-large") {
      return applyNoStoreHeaders(NextResponse.json({ error: "Profile payload too large" }, { status: 413 }), { varyCookie: true });
    }
    const body = parsedBody.ok ? parsedBody.value : null;
    if (!body || typeof body !== "object") {
      return applyNoStoreHeaders(NextResponse.json({ error: "Invalid profile payload" }, { status: 400 }), { varyCookie: true });
    }

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
    clearProfileCacheForWallet(walletAddress);

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
  if (rateLimited) return applyNoStoreHeaders(rateLimited);

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
    if (walletAddress) {
      if (!isAddress(walletAddress)) {
        return applyNoStoreHeaders(NextResponse.json({ error: "Invalid walletAddress" }, { status: 400 }));
      }
      const cacheKey = `wallet:${walletAddress.toLowerCase()}`;
      const cached = chatProfileRouteCache.getFresh(cacheKey);
      if (cached) {
        return applyNoStoreHeaders(NextResponse.json(cached));
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
      rememberProfileCacheKey(requestedAddresses, normalizedKey);
      return applyNoStoreHeaders(NextResponse.json(payload));
    }

    const cacheKey = "all";
    const cached = chatProfileRouteCache.getFresh(cacheKey);
    if (cached) {
      return applyNoStoreHeaders(NextResponse.json(cached));
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
