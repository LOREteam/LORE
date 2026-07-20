import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { consumeRateLimit } from "../../../server/storage";
import { getClientIdentity } from "./clientIdentity";
import { consumeExternalRateLimit, hasExternalRateLimitStore } from "./externalRateLimit";
import { applyNoStoreHeaders } from "./responseHeaders";
import { describeSafeRouteError } from "./routeError";

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
const MAX_LOCAL_FALLBACK_ENTRIES = 2_000;
const weakBucketFallbackMap = new Map<string, RateLimitState>();
const sharedLimiterMisconfigBuckets = new Set<string>();
const weakIdentityWarnedBuckets = new Set<string>();
const externalLimiterWarnedBuckets = new Set<string>();

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
  if (!current && localFallbackMap.size >= MAX_LOCAL_FALLBACK_ENTRIES) {
    for (const [storedKey, state] of localFallbackMap.entries()) {
      if (state.resetAt <= now) localFallbackMap.delete(storedKey);
    }
    if (localFallbackMap.size >= MAX_LOCAL_FALLBACK_ENTRIES) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { error: "Too many requests", retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)) },
          { status: 429 },
        ),
      );
    }
  }
  const normalized =
    !current || current.resetAt <= now || current.windowStartedAt !== windowStartedAt
      ? { count: 0, windowStartedAt, resetAt }
      : current;

  if (normalized.count >= limit) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          error: "Too many requests",
          retryAfter: Math.max(1, Math.ceil((normalized.resetAt - now) / 1000)),
        },
        { status: 429 },
      ),
    );
  }

  localFallbackMap.set(fallbackKey, {
    count: normalized.count + 1,
    windowStartedAt,
    resetAt,
  });

  return null;
}

function enforceWeakIdentityFallback(
  bucket: string,
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): NextResponse | null {
  const windowStartedAt = now - (now % windowMs);
  const resetAt = windowStartedAt + windowMs;
  const current = weakBucketFallbackMap.get(bucket);
  const normalized =
    !current || current.resetAt <= now || current.windowStartedAt !== windowStartedAt
      ? { count: 0, windowStartedAt, resetAt }
      : current;

  const weakBucketLimit = Math.max(limit * 4, limit + 10);
  if (normalized.count >= weakBucketLimit) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          error: "Too many requests",
          retryAfter: Math.max(1, Math.ceil((normalized.resetAt - now) / 1000)),
        },
        { status: 429 },
      ),
    );
  }

  const identityLimited = enforceLocalFallback(bucket, key, limit, windowMs, now);
  if (identityLimited) return identityLimited;

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
    if (
      process.env.NODE_ENV === "production"
      && process.env.ALLOW_WEAK_RATE_LIMIT_IDENTITY !== "1"
    ) {
      return applyNoStoreHeaders(
        NextResponse.json({ error: "Trusted proxy identity unavailable" }, { status: 503 }),
      );
    }
    const warnKey = `${bucket}:weak-identity`;
    if (!weakIdentityWarnedBuckets.has(warnKey)) {
      weakIdentityWarnedBuckets.add(warnKey);
      console.warn(`[rate-limit:${bucket}] weak identity - using fallback rate limiting`);
    }
    return enforceWeakIdentityFallback(bucket, key, limit, windowMs, now);
  }

  if (process.env.NODE_ENV !== "production") {
    return enforceLocalFallback(bucket, key, limit, windowMs, now);
  }

  if (hasExternalRateLimitStore()) {
    try {
      const result = await consumeExternalRateLimit(bucket, key, limit, windowMs, now);
      if (result.allowed) return null;
      return applyNoStoreHeaders(
        NextResponse.json(
          { error: "Too many requests", retryAfter: result.retryAfter ?? 1 },
          { status: 429 },
        ),
      );
    } catch (error) {
      const warnKey = bucket;
      if (!externalLimiterWarnedBuckets.has(warnKey)) {
        externalLimiterWarnedBuckets.add(warnKey);
        const details = describeSafeRouteError(error);
        console.warn(`[rate-limit:${bucket}] external store fallback: ${details.name}: ${details.message}`);
      }
      if (process.env.RATE_LIMIT_EXTERNAL_FAIL_CLOSED === "1") {
        return applyNoStoreHeaders(
          NextResponse.json({ error: "Rate limit service unavailable" }, { status: 503 }),
        );
      }
    }
  }

  try {
    const result = consumeRateLimit(bucket, key, limit, windowMs);
    if (result.allowed) return null;

    return applyNoStoreHeaders(
      NextResponse.json(
        {
          error: "Too many requests",
          retryAfter: result.retryAfter ?? 1,
        },
        { status: 429 },
      ),
    );
  } catch (error) {
    const warnKey = bucket;
    if (!sharedLimiterMisconfigBuckets.has(warnKey)) {
      sharedLimiterMisconfigBuckets.add(warnKey);
      const details = describeSafeRouteError(error);
      console.warn(`[rate-limit:${bucket}] sqlite fallback: ${details.name}: ${details.message}`);
    }
    return enforceLocalFallback(bucket, key, limit, windowMs, now);
  }
}
