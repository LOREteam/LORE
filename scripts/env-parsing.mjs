function parseFiniteNumberEnv(value, fallback) {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parsePositiveIntegerEnv(value, fallback) {
  const parsed = parseFiniteNumberEnv(value, fallback);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
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
