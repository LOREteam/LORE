const MAX_TILE_ID = 25;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const CANONICAL_INDEXED_EPOCH_RE = /^[1-9]\d{0,15}$/;
const CANONICAL_TRANSACTION_HASH_RE = /^0x[0-9a-f]{64}$/;

export function parseChainPositiveSafeInteger(value) {
  if (value <= 0n || value > MAX_SAFE_INTEGER_BIGINT) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseChainTileId(value) {
  if (value <= 0n || value > BigInt(MAX_TILE_ID)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= MAX_TILE_ID ? parsed : null;
}

export function parseChainTileIds(values) {
  const tileIds = [];
  for (const value of values) {
    const tileId = parseChainTileId(value);
    if (tileId === null) return null;
    tileIds.push(tileId);
  }
  return tileIds;
}

export function parseIndexedEpochKey(value) {
  if (typeof value !== "string" || !CANONICAL_INDEXED_EPOCH_RE.test(value)) return null;
  const parsed = BigInt(value);
  return parsed <= MAX_SAFE_INTEGER_BIGINT ? Number(parsed) : null;
}

export function buildNormalizedEventId(transactionHash, logIndex) {
  if (typeof transactionHash !== "string" || logIndex === null || logIndex === undefined) return null;
  const normalizedHash = transactionHash.toLowerCase().trim();
  if (!CANONICAL_TRANSACTION_HASH_RE.test(normalizedHash)) return null;
  if (typeof logIndex !== "number" && typeof logIndex !== "bigint") return null;
  if (typeof logIndex === "number" && (!Number.isSafeInteger(logIndex) || logIndex < 0)) return null;
  if (typeof logIndex === "bigint" && (logIndex < 0n || logIndex > MAX_SAFE_INTEGER_BIGINT)) return null;
  return `${normalizedHash}_${logIndex.toString()}`;
}

export function buildNormalizedEventIdForLog(log) {
  return buildNormalizedEventId(log?.transactionHash, log?.logIndex);
}

export function toDisplayNumberWei(value) {
  if (value <= 0n) return 0;
  const scale = 1_000_000_000_000n;
  const scaled = (value + (scale / 2n)) / scale;
  if (scaled > MAX_SAFE_INTEGER_BIGINT) return Number.MAX_SAFE_INTEGER;
  return Number(scaled) / 1_000_000;
}
