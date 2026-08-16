const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const CANONICAL_POSITIVE_INTEGER_RE = /^[1-9]\d*$/;
const MAX_TILE_ID = 25;

export type ReadModelCacheEntry = {
  expiresAt: number;
};

export function computeReadModelExpiresAt(ttlMs: number, now = Date.now()): number {
  if (!Number.isSafeInteger(now) || now < 0) return 0;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) return 0;
  if (ttlMs > Number.MAX_SAFE_INTEGER - now) return Number.MAX_SAFE_INTEGER;
  return now + ttlMs;
}

export function isFreshReadModelCache(
  entry: ReadModelCacheEntry | null,
  now = Date.now(),
): entry is ReadModelCacheEntry {
  return Boolean(
    entry &&
      Number.isSafeInteger(now) &&
      now >= 0 &&
      Number.isSafeInteger(entry.expiresAt) &&
      entry.expiresAt > now,
  );
}

export function parseReadModelEpochNumber(
  value: bigint | number | string | null | undefined,
): number | null {
  let parsed: bigint;
  if (typeof value === "bigint") {
    parsed = value;
  } else if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  } else {
    if (typeof value !== "string" || !CANONICAL_POSITIVE_INTEGER_RE.test(value)) return null;
    parsed = BigInt(value);
  }
  if (parsed <= 0n || parsed > MAX_SAFE_INTEGER_BIGINT) return null;
  return Number(parsed);
}

export function parseReadModelTileId(value: bigint | number): number | null {
  let parsed: number;
  if (typeof value === "bigint") {
    if (value <= 0n || value > BigInt(MAX_TILE_ID)) return null;
    parsed = Number(value);
  } else {
    parsed = value;
  }
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= MAX_TILE_ID ? parsed : null;
}
