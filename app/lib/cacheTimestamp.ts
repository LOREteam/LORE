const CACHE_TIMESTAMP_MAX_FUTURE_SKEW_MS = 5_000;

export function normalizeCacheTimestamp(
  value: unknown,
  now = Date.now(),
  maxFutureSkewMs = CACHE_TIMESTAMP_MAX_FUTURE_SKEW_MS,
): number | null {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !Number.isSafeInteger(maxFutureSkewMs) ||
    maxFutureSkewMs < 0
  ) {
    return null;
  }
  if (value - now > maxFutureSkewMs) return null;
  return value;
}

export function getFreshCacheDelayMs(savedAt: unknown, ttlMs: number, now = Date.now()): number | null {
  const normalizedSavedAt = normalizeCacheTimestamp(savedAt, now);
  if (normalizedSavedAt === null || !Number.isSafeInteger(ttlMs) || ttlMs <= 0) return null;
  const ageMs = Math.max(0, now - normalizedSavedAt);
  if (ageMs >= ttlMs) return null;
  return ttlMs - ageMs;
}
