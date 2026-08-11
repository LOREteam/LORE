const MAX_TILE_ID = 25;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

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

export function toDisplayNumberWei(value) {
  if (value <= 0n) return 0;
  const scale = 1_000_000_000_000n;
  const scaled = (value + (scale / 2n)) / scale;
  if (scaled > MAX_SAFE_INTEGER_BIGINT) return Number.MAX_SAFE_INTEGER;
  return Number(scaled) / 1_000_000;
}
