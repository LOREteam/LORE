export function parseIndexerFinalityBlocks(value?: string | null) {
  if (!value) return 0n;
  try {
    const parsed = BigInt(value.trim());
    return parsed > 0n ? parsed : 0n;
  } catch {
    return 0n;
  }
}

export function getIndexerFinalityTargetBlock(headBlock: bigint, finalityBlocks: bigint) {
  if (finalityBlocks <= 0n) return headBlock;
  if (headBlock <= finalityBlocks) return null;
  return headBlock - finalityBlocks;
}

function bigintToNonNegativeSafeNumber(value: bigint) {
  if (value <= 0n) return 0;
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value);
}

export function getIndexerTargetLagBlocks(lastIndexedBlock: bigint | null, targetBlock: bigint | null) {
  if (lastIndexedBlock === null || targetBlock === null) return null;
  if (lastIndexedBlock >= targetBlock) return 0;
  return bigintToNonNegativeSafeNumber(targetBlock - lastIndexedBlock);
}

export function hasMainnetIndexerFinality(value?: string | null) {
  return parseIndexerFinalityBlocks(value) > 0n;
}
