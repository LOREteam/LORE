const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export function toNum(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function ageMs(timestamp: number | null, now: number): number | null {
  if (timestamp === null || !Number.isFinite(timestamp)) return null;
  return Math.max(0, now - timestamp);
}

export function parseStatusTimestamp(value: unknown): number | null {
  if (typeof value !== "number") return null;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function parseChainUintNumber(value: unknown): number | null {
  if (typeof value !== "bigint" || value < 0n || value > MAX_SAFE_INTEGER_BIGINT) return null;
  return Number(value);
}

export function bigintToNonNegativeSafeNumber(value: bigint): number {
  if (value <= 0n) return 0;
  return value > MAX_SAFE_INTEGER_BIGINT ? Number.MAX_SAFE_INTEGER : Number(value);
}

export function safeNonNegativeBigintDelta(upper: bigint, lower: bigint): number | null {
  if (upper < lower) return null;
  return bigintToNonNegativeSafeNumber(upper - lower);
}

export function parseStatusCounter(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function parseStatusPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function parseStoredBlockNumber(value: string | null | undefined): bigint | null {
  if (!value || !/^\d+$/.test(value)) return null;
  return BigInt(value);
}

export function parseStoredEpochNumber(value: string | null | undefined): number | null {
  if (!value || !/^[1-9]\d{0,15}$/.test(value)) return null;
  const parsed = BigInt(value);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) return null;
  return Number(parsed);
}

export function parseStatusBlockString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return parseStoredBlockNumber(value)?.toString() ?? null;
}

export function parseStatusEpochList(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const epochs = value
    .map((entry) => (typeof entry === "number" ? String(entry) : typeof entry === "string" ? entry : null))
    .map((entry) => parseStoredEpochNumber(entry))
    .filter((entry): entry is number => entry !== null);
  return epochs.length > 0 ? [...new Set(epochs)] : [];
}
