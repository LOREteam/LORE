const STORED_BLOCK_NUMBER_RE = /^(?:0|[1-9]\d{0,15})$/;
const STORED_POSITIVE_INTEGER_RE = /^[1-9]\d{0,15}$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export function parseStoredBlockNumberOrZero(value: string | null | undefined): bigint {
  if (!value || !STORED_BLOCK_NUMBER_RE.test(value)) return 0n;
  return BigInt(value);
}

export function parseStoredPositiveIntegerOrZero(value: string | null | undefined): number {
  if (!value || !STORED_POSITIVE_INTEGER_RE.test(value)) return 0;
  const parsed = BigInt(value);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) return 0;
  return Number(parsed);
}
