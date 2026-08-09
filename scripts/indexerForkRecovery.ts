export interface IndexerBlockCheckpoint {
  blockNumber: string;
  blockHash: string;
}

export interface CanonicalLogReference {
  blockNumber?: bigint | null;
  blockHash?: string | null;
}

const BLOCK_HASH_RE = /^0x[0-9a-f]{64}$/;

export function normalizeBlockHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return BLOCK_HASH_RE.test(normalized) ? normalized : null;
}

function parseCheckpointBlockNumber(value: string) {
  if (!/^\d+$/.test(value)) {
    throw new Error("invalid indexer checkpoint block number");
  }
  return BigInt(value);
}

export async function findLatestCanonicalCheckpoint(
  checkpoints: IndexerBlockCheckpoint[],
  readCanonicalBlockHash: (blockNumber: bigint) => Promise<string>,
): Promise<IndexerBlockCheckpoint | null> {
  const ordered = [...checkpoints].sort((left, right) => {
    const leftBlock = parseCheckpointBlockNumber(left.blockNumber);
    const rightBlock = parseCheckpointBlockNumber(right.blockNumber);
    return leftBlock === rightBlock ? 0 : leftBlock > rightBlock ? -1 : 1;
  });

  for (const checkpoint of ordered) {
    const blockNumber = parseCheckpointBlockNumber(checkpoint.blockNumber);
    const storedHash = normalizeBlockHash(checkpoint.blockHash);
    if (storedHash === null) {
      throw new Error(`invalid stored indexer checkpoint hash at block ${blockNumber}`);
    }
    const canonicalHash = normalizeBlockHash(await readCanonicalBlockHash(blockNumber));
    if (canonicalHash === null) {
      throw new Error(`invalid canonical block hash response at block ${blockNumber}`);
    }
    if (canonicalHash === storedHash) {
      return {
        blockNumber: blockNumber.toString(),
        blockHash: storedHash,
      };
    }
  }

  return null;
}

export async function verifyCanonicalLogBlockHashes(
  logs: CanonicalLogReference[],
  readCanonicalBlockHash: (blockNumber: bigint) => Promise<string>,
) {
  const hashesByBlock = new Map<bigint, string>();
  for (const log of logs) {
    if (typeof log.blockNumber !== "bigint" || log.blockNumber < 0n) {
      throw new Error("indexed log is missing a canonical block number");
    }
    const blockHash = normalizeBlockHash(log.blockHash);
    if (blockHash === null) {
      throw new Error(`indexed log at block ${log.blockNumber} is missing a canonical block hash`);
    }
    const previousHash = hashesByBlock.get(log.blockNumber);
    if (previousHash && previousHash !== blockHash) {
      throw new Error(`conflicting indexed log block hashes at block ${log.blockNumber}`);
    }
    hashesByBlock.set(log.blockNumber, blockHash);
  }

  for (const [blockNumber, logBlockHash] of hashesByBlock) {
    const canonicalHash = normalizeBlockHash(await readCanonicalBlockHash(blockNumber));
    if (canonicalHash === null) {
      throw new Error(`invalid canonical block hash response at block ${blockNumber}`);
    }
    if (canonicalHash !== logBlockHash) {
      throw new Error(`non-canonical log block detected at block ${blockNumber}`);
    }
  }
}
