const CACHE_TIMESTAMP_MAX_FUTURE_SKEW_MS = 5_000;

export function normalizeCacheTimestamp(
  value: unknown,
  now = Date.now(),
  maxFutureSkewMs = CACHE_TIMESTAMP_MAX_FUTURE_SKEW_MS,
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  if (value - now > maxFutureSkewMs) return null;
  return value;
}
