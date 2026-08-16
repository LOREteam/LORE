import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { consumeRateLimit } from "../../../server/storage";
import { getClientIdentity } from "./clientIdentity";
import {
  consumeExternalRateLimit,
  hasExternalRateLimitStore,
  requiresExternalSharedLock,
} from "./externalRateLimit";
import { applyNoStoreHeaders } from "./responseHeaders";
import { describeSafeRouteError } from "./routeError";

export type RateLimitState = {
  count: number;
  windowStartedAt: number;
  resetAt: number;
};

export type RateLimitOptions = {
  bucket: string;
  limit: number;
  windowMs: number;
};

export type RateLimitStateDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

type BoundedRateLimitStateOptions = {
  stateMap: Map<string, RateLimitState>;
  key: string;
  limit: number;
  windowMs: number;
  now: number;
  maxEntries: number;
};

type WeakIdentityRateLimitStateOptions = {
  weakBucketMap: Map<string, RateLimitState>;
  localMap: Map<string, RateLimitState>;
  bucket: string;
  key: string;
  limit: number;
  windowMs: number;
  now: number;
  maxWeakEntries: number;
  maxLocalEntries: number;
};

type BoundedRateLimitStatePlan =
  | { allowed: true; nextState: RateLimitState }
  | { allowed: false; retryAfterSeconds: number };

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

export function formatRateLimitLogBucket(bucket: string) {
  const normalized = bucket.replace(RATE_LIMIT_LOG_LABEL_ALLOWED, "-").slice(0, MAX_RATE_LIMIT_LOG_LABEL_LENGTH);
  return normalized || "unknown";
}

export function normalizeRetryAfterSeconds(value: number) {
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

function rateLimitServiceUnavailableResponse(): NextResponse {
  return applyNoStoreHeaders(
    NextResponse.json({ error: "Rate limit service unavailable" }, { status: 503 }),
  );
}

export function hasValidRateLimitOptions({ bucket, limit, windowMs }: RateLimitOptions) {
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

function planBoundedRateLimitState({
  stateMap,
  key,
  limit,
  windowMs,
  now,
  maxEntries,
}: BoundedRateLimitStateOptions): BoundedRateLimitStatePlan {
  const windowStartedAt = now - (now % windowMs);
  const resetAt = windowStartedAt + windowMs;
  const current = stateMap.get(key);
  if (!current && stateMap.size >= maxEntries) {
    for (const [storedKey, state] of stateMap.entries()) {
      if (state.resetAt <= now) stateMap.delete(storedKey);
    }
    if (stateMap.size >= maxEntries) {
      return { allowed: false, retryAfterSeconds: (resetAt - now) / 1000 };
    }
  }
  const normalized =
    !current || current.resetAt <= now || current.windowStartedAt !== windowStartedAt
      ? { count: 0, windowStartedAt, resetAt }
      : current;

  if (normalized.count >= limit) {
    return { allowed: false, retryAfterSeconds: (normalized.resetAt - now) / 1000 };
  }

  return {
    allowed: true,
    nextState: {
      count: normalized.count + 1,
      windowStartedAt,
      resetAt,
    },
  };
}

export function consumeBoundedRateLimitState(
  options: BoundedRateLimitStateOptions,
): RateLimitStateDecision {
  const plan = planBoundedRateLimitState(options);
  if (!plan.allowed) return plan;
  options.stateMap.set(options.key, plan.nextState);
  return { allowed: true };
}

export function consumeWeakIdentityRateLimitState({
  weakBucketMap,
  localMap,
  bucket,
  key,
  limit,
  windowMs,
  now,
  maxWeakEntries,
  maxLocalEntries,
}: WeakIdentityRateLimitStateOptions): RateLimitStateDecision {
  const weakBucketLimit = Math.max(limit * 4, limit + 10);
  const weakBucketPlan = planBoundedRateLimitState({
    stateMap: weakBucketMap,
    key: bucket,
    limit: weakBucketLimit,
    windowMs,
    now,
    maxEntries: maxWeakEntries,
  });
  if (!weakBucketPlan.allowed) return weakBucketPlan;

  const identityDecision = consumeBoundedRateLimitState({
    stateMap: localMap,
    key: `${bucket}:${key}`,
    limit,
    windowMs,
    now,
    maxEntries: maxLocalEntries,
  });
  if (!identityDecision.allowed) return identityDecision;

  weakBucketMap.set(bucket, weakBucketPlan.nextState);
  return { allowed: true };
}

function enforceLocalFallback(
  bucket: string,
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): NextResponse | null {
  const decision = consumeBoundedRateLimitState({
    stateMap: localFallbackMap,
    key: `${bucket}:${key}`,
    limit,
    windowMs,
    now,
    maxEntries: MAX_LOCAL_FALLBACK_ENTRIES,
  });
  return decision.allowed ? null : rateLimitExceededResponse(decision.retryAfterSeconds);
}

function enforceWeakIdentityFallback(
  bucket: string,
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): NextResponse | null {
  const decision = consumeWeakIdentityRateLimitState({
    weakBucketMap: weakBucketFallbackMap,
    localMap: localFallbackMap,
    bucket,
    key,
    limit,
    windowMs,
    now,
    maxWeakEntries: MAX_WEAK_BUCKET_FALLBACK_ENTRIES,
    maxLocalEntries: MAX_LOCAL_FALLBACK_ENTRIES,
  });
  return decision.allowed ? null : rateLimitExceededResponse(decision.retryAfterSeconds);
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

  const externalStoreConfigured = hasExternalRateLimitStore();
  const externalStoreConfigurationPresent = Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  );
  const externalStoreRequired =
    externalStoreConfigurationPresent ||
    process.env.RATE_LIMIT_EXTERNAL_FAIL_CLOSED === "1" ||
    requiresExternalSharedLock();
  if (!externalStoreConfigured && externalStoreRequired) {
    return rateLimitServiceUnavailableResponse();
  }

  if (externalStoreConfigured) {
    try {
      const result = await consumeExternalRateLimit(bucket, key, limit, windowMs, now);
      if (result.allowed) return null;
      return rateLimitExceededResponse(result.retryAfter ?? 1);
    } catch (error) {
      const warnKey = bucket;
      if (!externalLimiterWarnedBuckets.has(warnKey)) {
        externalLimiterWarnedBuckets.add(warnKey);
        const details = describeSafeRouteError(error);
        console.warn(`[rate-limit:${formatRateLimitLogBucket(bucket)}] external store fallback: ${details.name}`);
      }
      if (externalStoreRequired) {
        return rateLimitServiceUnavailableResponse();
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
