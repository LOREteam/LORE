const POSITIVE_DECIMAL_INTEGER_RE = /^[1-9]\d{0,15}$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export function parsePositiveIntegerParam(value: string | null): number | null {
  if (value === null || value === "" || !POSITIVE_DECIMAL_INTEGER_RE.test(value)) return null;
  const parsed = BigInt(value);
  if (parsed <= 0n || parsed > MAX_SAFE_INTEGER_BIGINT) return null;
  return Number(parsed);
}

export function parseBoundedPositiveIntegerParam(value: string | null, max: number): number | null {
  if (!Number.isSafeInteger(max) || max <= 0) return null;
  const parsed = parsePositiveIntegerParam(value);
  return parsed !== null && parsed <= max ? parsed : null;
}

export function parsePositiveIntegerValue(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === "string") {
    return parsePositiveIntegerParam(value);
  }
  return null;
}
