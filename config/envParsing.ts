const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export function parseRequiredNonNegativeBigIntEnv(value: string, label: string): bigint {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return BigInt(trimmed);
}

export function parseOptionalNonNegativeBigIntEnv(value: string | null | undefined, fallback: bigint): bigint {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return fallback;
  return BigInt(trimmed);
}

export function parseOptionalNonNegativeNumberEnv(value: string | null | undefined, fallback: number): number {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return fallback;
  const parsed = BigInt(trimmed);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) return fallback;
  return Number(parsed);
}

export function parseOptionalPositiveIntegerEnv(value: string | null | undefined, fallback: number): number {
  const parsed = parseOptionalNonNegativeNumberEnv(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

export function parseOptionalPositiveIntegerInRangeEnv(
  value: string | null | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = parseOptionalPositiveIntegerEnv(value, fallback);
  return Math.min(max, Math.max(min, parsed));
}
