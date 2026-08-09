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
const MAX_WEAK_BUCKET_FALLBACK_ENTRIES = 256;
const sharedLimiterMisconfigBuckets = new Set<string>();
const weakIdentityWarnedBuckets = new Set<string>();
const externalLimiterWarnedBuckets = new Set<string>();
const MAX_RATE_LIMIT_BUCKET_LENGTH = 80;
const MAX_RATE_LIMIT_LIMIT = 10_000;
const MAX_RATE_LIMIT_WINDOW_MS = 86_400_000;
const MAX_RATE_LIMIT_LOG_LABEL_LENGTH = 80;
const MAX_RETRY_AFTER_SECONDS = 86_400;
const RATE_LIMIT_BUCKET_RE = /^[a-z0-9:_-]{1,80}$/i;
const RATE_LIMIT_LOG_LABEL_ALLOWED = /[^a-z0-9:_-]+/gi;

function hashIdentity(identity: string) {
  return createHash("sha256").update(identity).digest("hex").slice(0, 32);
}

function formatRateLimitLogBucket(bucket: string) {
  const normalized = bucket.replace(RATE_LIMIT_LOG_LABEL_ALLOWED, "-").slice(0, MAX_RATE_LIMIT_LOG_LABEL_LENGTH);
  return normalized || "unknown";
}

function normalizeRetryAfterSeconds(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, Math.ceil(value)));
}

function rateLimitExceededResponse(retryAfterSeconds: number): NextResponse {
  const retryAfter = normalizeRetryAfterSeconds(retryAfterSeconds);
  return applyNoStoreHeaders(
    NextResponse.json(
      { error: "Too many requests", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    ),
  );
}

function rateLimitConfigurationUnavailableResponse(): NextResponse {
  return applyNoStoreHeaders(
    NextResponse.json({ error: "Rate limit configuration unavailable" }, { status: 503 }),
  );
}

function hasValidRateLimitOptions({ bucket, limit, windowMs }: RateLimitOptions) {
  return (
    typeof bucket === "string" &&
    bucket.length <= MAX_RATE_LIMIT_BUCKET_LENGTH &&
    RATE_LIMIT_BUCKET_RE.test(bucket) &&
    Number.isSafeInteger(limit) &&
    limit > 0 &&
    limit <= MAX_RATE_LIMIT_LIMIT &&
    Number.isSafeInteger(windowMs) &&
    windowMs > 0 &&
    windowMs <= MAX_RATE_LIMIT_WINDOW_MS
  );
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
      return rateLimitExceededResponse((resetAt - now) / 1000);
    }
  }
  const normalized =
    !current || current.resetAt <= now || current.windowStartedAt !== windowStartedAt
      ? { count: 0, windowStartedAt, resetAt }
      : current;

  if (normalized.count >= limit) {
    return rateLimitExceededResponse((normalized.resetAt - now) / 1000);
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
  if (!current && weakBucketFallbackMap.size >= MAX_WEAK_BUCKET_FALLBACK_ENTRIES) {
    for (const [storedBucket, state] of weakBucketFallbackMap.entries()) {
      if (state.resetAt <= now) weakBucketFallbackMap.delete(storedBucket);
    }
    if (weakBucketFallbackMap.size >= MAX_WEAK_BUCKET_FALLBACK_ENTRIES) {
      return rateLimitExceededResponse((resetAt - now) / 1000);
    }
  }
  const normalized =
    !current || current.resetAt <= now || current.windowStartedAt !== windowStartedAt
      ? { count: 0, windowStartedAt, resetAt }
      : current;

  const weakBucketLimit = Math.max(limit * 4, limit + 10);
  if (normalized.count >= weakBucketLimit) {
    return rateLimitExceededResponse((normalized.resetAt - now) / 1000);
  }

  const identityLimited = enforceLocalFallback(bucket, key, limit, windowMs, now);
  if (identityLimited) return identityLimited;

  weakBucketFallbackMap.set(bucket, {
    count: normalized.count + 1,
    windowStartedAt,
    resetAt,
  });

  if (weakBucketFallbackMap.size > MAX_WEAK_BUCKET_FALLBACK_ENTRIES) {
    for (const [storedBucket, state] of weakBucketFallbackMap.entries()) {
      if (state.resetAt <= now) weakBucketFallbackMap.delete(storedBucket);
    }
  }

  return null;
}

export async function enforceSharedRateLimit(
  request: Request,
  options: RateLimitOptions,
): Promise<NextResponse | null> {
  if (!hasValidRateLimitOptions(options)) {
    return rateLimitConfigurationUnavailableResponse();
  }

  const { bucket, limit, windowMs } = options;
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
      console.warn(`[rate-limit:${formatRateLimitLogBucket(bucket)}] weak identity - using fallback rate limiting`);
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
      return rateLimitExceededResponse(result.retryAfter ?? 1);
    } catch (error) {
      const warnKey = bucket;
      if (!externalLimiterWarnedBuckets.has(warnKey)) {
        externalLimiterWarnedBuckets.add(warnKey);
        const details = describeSafeRouteError(error);
        console.warn(`[rate-limit:${formatRateLimitLogBucket(bucket)}] external store fallback: ${details.name}: ${details.message}`);
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

    return rateLimitExceededResponse(result.retryAfter ?? 1);
  } catch (error) {
    const warnKey = bucket;
    if (!sharedLimiterMisconfigBuckets.has(warnKey)) {
      sharedLimiterMisconfigBuckets.add(warnKey);
      const details = describeSafeRouteError(error);
      console.warn(`[rate-limit:${formatRateLimitLogBucket(bucket)}] sqlite fallback: ${details.name}: ${details.message}`);
    }
    return enforceLocalFallback(bucket, key, limit, windowMs, now);
  }
}
