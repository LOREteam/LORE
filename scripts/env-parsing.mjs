const POSITIVE_SAFE_INTEGER_RE = /^[1-9]\d{0,15}$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function parseFiniteNumberEnv(value, fallback) {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parsePositiveIntegerEnv(value, fallback) {
  const trimmed = value?.trim();
  if (!trimmed || !POSITIVE_SAFE_INTEGER_RE.test(trimmed)) return fallback;
  const parsed = BigInt(trimmed);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) return fallback;
  return Number(parsed);
}

export function parsePositiveIntegerInRangeEnv(value, fallback, min, max) {
  const parsed = parsePositiveIntegerEnv(value, fallback);
  return Math.min(max, Math.max(min, parsed));
}

export function parseNonNegativeNumberEnv(value, fallback) {
  const parsed = parseFiniteNumberEnv(value, fallback);
  return parsed >= 0 ? parsed : fallback;
}

export function parseNonNegativeNumberInRangeEnv(value, fallback, min, max) {
  const parsed = parseNonNegativeNumberEnv(value, fallback);
  return Math.min(max, Math.max(min, parsed));
}
