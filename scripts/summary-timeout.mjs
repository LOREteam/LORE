const DECIMAL_INTEGER_RE = /^(?:0|[1-9]\d{0,15})$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export function parseSummaryTimeoutEnv(name, fallback, { min = 1_000, max = 900_000 } = {}) {
  if (!Number.isSafeInteger(fallback) || fallback < min || fallback > max) {
    throw new Error(`${name} fallback must be between ${min} and ${max}`);
  }
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!DECIMAL_INTEGER_RE.test(raw)) {
    throw new Error(`${name} must be a canonical decimal integer`);
  }
  const parsed = BigInt(raw);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  const numeric = Number(parsed);
  if (numeric < min || numeric > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return numeric;
}
