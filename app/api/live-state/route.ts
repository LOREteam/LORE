import { NextResponse } from "next/server";
import { enforceSharedRateLimit } from "../_lib/sharedRateLimit";
import { applyNoStoreHeaders } from "../_lib/responseHeaders";
import { buildLiveStatePayload, type LiveStatePayload } from "./shared";

type CachedLiveState = {
  payload: LiveStatePayload;
  expiresAt: number;
};

const LIVE_STATE_CACHE_MS = 4_000;
const LIVE_STATE_REQUEST_TIMEOUT_MS = 8_000;
let liveStateCache: CachedLiveState | null = null;
let liveStateInflight: Promise<LiveStatePayload> | null = null;
let liveStateInflightStartedAt = 0;

function jsonNoStore(payload: LiveStatePayload, status = 200) {
  return applyNoStoreHeaders(NextResponse.json(payload, { status }));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function startLiveStateRefresh() {
  const refreshPromise = buildLiveStatePayload()
    .then((result) => {
      liveStateCache = {
        payload: result,
        expiresAt: Date.now() + LIVE_STATE_CACHE_MS,
      };
      return result;
    })
    .finally(() => {
      if (liveStateInflight === refreshPromise) {
        liveStateInflight = null;
        liveStateInflightStartedAt = 0;
      }
    });

  liveStateInflight = refreshPromise;
  liveStateInflightStartedAt = Date.now();
  return refreshPromise;
}

export async function GET(request: Request) {
  const now = Date.now();
  if (liveStateCache && liveStateCache.expiresAt > now) {
    return jsonNoStore(liveStateCache.payload);
  }

  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-live-state",
    limit: 120,
    windowMs: 60_000,
  });
  if (rateLimited) {
    if (liveStateCache?.payload) {
      return jsonNoStore(liveStateCache.payload);
    }
    return rateLimited;
  }

  if (liveStateInflight && now - liveStateInflightStartedAt > LIVE_STATE_REQUEST_TIMEOUT_MS) {
    liveStateInflight = null;
    liveStateInflightStartedAt = 0;
  }

  try {
    const payload = await withTimeout(
      liveStateInflight ?? startLiveStateRefresh(),
      LIVE_STATE_REQUEST_TIMEOUT_MS,
      "live-state refresh",
    );

    return jsonNoStore(payload);
  } catch (error) {
    if (liveStateCache?.payload) {
      return jsonNoStore(liveStateCache.payload);
    }
    return applyNoStoreHeaders(
      NextResponse.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500 },
      ),
    );
  }
}
