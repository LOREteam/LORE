const DEFAULT_GRID_SIZE = 25;

export function tileIdsToMask(tileIds: number[], gridSize = DEFAULT_GRID_SIZE): number {
  let mask = 0;
  for (const tileId of tileIds) {
    if (!Number.isInteger(tileId) || tileId < 1 || tileId > gridSize) continue;
    mask |= 1 << (tileId - 1);
  }
  return mask >>> 0;
}

export function tileMaskToTileIds(tileMask: number, gridSize = DEFAULT_GRID_SIZE): number[] {
  if (!Number.isInteger(tileMask) || tileMask < 0) return [];
  const tileIds: number[] = [];
  const normalizedMask = tileMask >>> 0;
  for (let bit = 0; bit < gridSize; bit += 1) {
    if (((normalizedMask >>> bit) & 1) === 1) {
      tileIds.push(bit + 1);
    }
  }
  return tileIds;
}
