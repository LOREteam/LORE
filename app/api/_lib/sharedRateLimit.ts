import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { consumeRateLimit } from "../../../server/storage";

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
const weakBucketFallbackMap = new Map<string, RateLimitState>();
const sharedLimiterMisconfigBuckets = new Set<string>();
const weakIdentityWarnedBuckets = new Set<string>();

type ClientIdentity = {
  key: string;
  weak: boolean;
};

function getClientIdentity(request: Request): ClientIdentity {
  const cfConnectingIp = request.headers.get("cf-connecting-ip");
  if (cfConnectingIp) return { key: `cf:${cfConnectingIp}`, weak: false };

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return { key: `real:${realIp}`, weak: false };

  const xForwardedFor = request.headers.get("x-forwarded-for");
  if (xForwardedFor) {
    const ip = xForwardedFor.split(",")[0]?.trim();
    if (ip) return { key: `xff:${ip}`, weak: false };
  }

  const userAgent = request.headers.get("user-agent")?.slice(0, 120) ?? "unknown";
  const lang = request.headers.get("accept-language")?.slice(0, 64) ?? "";
  return { key: `anon:${userAgent}:${lang}`, weak: true };
}

function hashIdentity(identity: string) {
  return createHash("sha256").update(identity).digest("hex").slice(0, 32);
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

function enforceWeakIdentityFallback(
  bucket: string,
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): NextResponse | null {
  const identityLimited = enforceLocalFallback(bucket, key, limit, windowMs, now);
  if (identityLimited) return identityLimited;

  const windowStartedAt = now - (now % windowMs);
  const resetAt = windowStartedAt + windowMs;
  const current = weakBucketFallbackMap.get(bucket);
  const normalized =
    !current || current.resetAt <= now || current.windowStartedAt !== windowStartedAt
      ? { count: 0, windowStartedAt, resetAt }
      : current;

  const weakBucketLimit = Math.max(limit * 4, limit + 10);
  if (normalized.count >= weakBucketLimit) {
    return NextResponse.json(
      {
        error: "Too many requests",
        retryAfter: Math.max(1, Math.ceil((normalized.resetAt - now) / 1000)),
      },
      { status: 429 },
    );
  }

  weakBucketFallbackMap.set(bucket, {
    count: normalized.count + 1,
    windowStartedAt,
    resetAt,
  });

  if (weakBucketFallbackMap.size > 256) {
    for (const [storedBucket, state] of weakBucketFallbackMap.entries()) {
      if (state.resetAt <= now) weakBucketFallbackMap.delete(storedBucket);
    }
  }

  return null;
}

export async function enforceSharedRateLimit(
  request: Request,
  { bucket, limit, windowMs }: RateLimitOptions,
): Promise<NextResponse | null> {
  const identity = getClientIdentity(request);
  const key = hashIdentity(identity.key);
  const now = Date.now();

  if (identity.weak) {
    const warnKey = `${bucket}:weak-identity`;
    if (!weakIdentityWarnedBuckets.has(warnKey)) {
      weakIdentityWarnedBuckets.add(warnKey);
      console.warn(`[rate-limit:${bucket}] weak identity — using fallback rate limiting`);
    }
    return enforceWeakIdentityFallback(bucket, key, limit, windowMs, now);
  }

  if (process.env.NODE_ENV !== "production") {
    return enforceLocalFallback(bucket, key, limit, windowMs, now);
  }

  try {
    const result = consumeRateLimit(bucket, key, limit, windowMs);
    if (result.allowed) return null;

    return NextResponse.json(
      {
        error: "Too many requests",
        retryAfter: result.retryAfter ?? 1,
      },
      { status: 429 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const warnKey = `${bucket}:${message}`;
    if (!sharedLimiterMisconfigBuckets.has(warnKey)) {
      sharedLimiterMisconfigBuckets.add(warnKey);
      console.warn(`[rate-limit:${bucket}] sqlite fallback: ${message}`);
    }
    return enforceLocalFallback(bucket, key, limit, windowMs, now);
  }
}
