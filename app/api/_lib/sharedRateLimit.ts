import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { firebaseWriteUrl } from "./dataBridge";

type RateLimitState = {
  count: number;
  windowStartedAt: number;
  resetAt: number;
};

type RateLimitOptions = {
  bucket: string;
  limit: number;
  windowMs: number;
};

const localFallbackMap = new Map<string, RateLimitState>();

function getClientIdentity(request: Request): string {
  const cfConnectingIp = request.headers.get("cf-connecting-ip");
  if (cfConnectingIp) return `cf:${cfConnectingIp}`;

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return `real:${realIp}`;

  const xForwardedFor = request.headers.get("x-forwarded-for");
  if (xForwardedFor) {
    const ip = xForwardedFor.split(",")[0]?.trim();
    if (ip) return `xff:${ip}`;
  }

  const userAgent = request.headers.get("user-agent")?.slice(0, 120) ?? "unknown";
  const lang = request.headers.get("accept-language")?.slice(0, 64) ?? "";
  return `anon:${userAgent}:${lang}`;
}

function hashIdentity(identity: string) {
  return createHash("sha256").update(identity).digest("hex").slice(0, 32);
}

function normalizeState(value: unknown): RateLimitState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<RateLimitState>;
  if (
    typeof raw.count !== "number" ||
    typeof raw.windowStartedAt !== "number" ||
    typeof raw.resetAt !== "number"
  ) {
    return null;
  }
  return {
    count: raw.count,
    windowStartedAt: raw.windowStartedAt,
    resetAt: raw.resetAt,
  };
}

async function readState(path: string) {
  const res = await fetch(firebaseWriteUrl(path), {
    headers: { "X-Firebase-ETag": "true" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`rate-limit read failed: ${res.status}`);
  }
  const etag = res.headers.get("etag") ?? "null_etag";
  const json = await res.json();
  return { state: normalizeState(json), etag };
}

async function writeState(path: string, state: RateLimitState, etag: string) {
  return fetch(firebaseWriteUrl(path), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "If-Match": etag,
    },
    body: JSON.stringify(state),
    cache: "no-store",
  });
}

function enforceLocalFallback(
  bucket: string,
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): NextResponse | null {
  const fallbackKey = `${bucket}:${key}`;
  const windowStartedAt = now - (now % windowMs);
  const resetAt = windowStartedAt + windowMs;
  const current = localFallbackMap.get(fallbackKey);
  const normalized =
    !current || current.resetAt <= now || current.windowStartedAt !== windowStartedAt
      ? { count: 0, windowStartedAt, resetAt }
      : current;

  if (normalized.count >= limit) {
    return NextResponse.json(
      {
        error: "Too many requests",
        retryAfter: Math.max(1, Math.ceil((normalized.resetAt - now) / 1000)),
      },
      { status: 429 },
    );
  }

  localFallbackMap.set(fallbackKey, {
    count: normalized.count + 1,
    windowStartedAt,
    resetAt,
  });

  if (localFallbackMap.size > 5000) {
    for (const [storedKey, state] of localFallbackMap.entries()) {
      if (state.resetAt <= now) localFallbackMap.delete(storedKey);
    }
  }

  return null;
}

export async function enforceSharedRateLimit(
  request: Request,
  { bucket, limit, windowMs }: RateLimitOptions,
): Promise<NextResponse | null> {
  const identity = getClientIdentity(request);
  const key = hashIdentity(identity);
  const path = `_internal/rateLimits/${bucket}/${key}`;
  const now = Date.now();
  const windowStartedAt = now - (now % windowMs);
  const resetAt = windowStartedAt + windowMs;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const { state, etag } = await readState(path);
      const current =
        !state || state.resetAt <= now || state.windowStartedAt !== windowStartedAt
          ? { count: 0, windowStartedAt, resetAt }
          : state;

      if (current.count >= limit) {
        return NextResponse.json(
          {
            error: "Too many requests",
            retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
          },
          { status: 429 },
        );
      }

      const nextState: RateLimitState = {
        count: current.count + 1,
        windowStartedAt,
        resetAt,
      };
      const writeRes = await writeState(path, nextState, etag);
      if (writeRes.ok) return null;
      if (writeRes.status === 412) continue;
      throw new Error(`rate-limit write failed: ${writeRes.status}`);
    } catch (error) {
      console.warn(`[rate-limit:${bucket}] shared limiter fallback:`, error);
      return enforceLocalFallback(bucket, key, limit, windowMs, now);
    }
  }

  return enforceLocalFallback(bucket, key, limit, windowMs, now);
}
