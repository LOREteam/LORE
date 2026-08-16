import { buildNormalizedEventIdForLog } from "./indexerNormalization.mjs";

const DECIMAL_INTEGER_RE = /^(?:0|[1-9]\d{0,15})$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
export const MAX_AUDIT_TILE_ID = 25;

export function parseChainAuditBoundedInteger(name, raw, min, max) {
  const value = String(raw ?? "");
  if (!DECIMAL_INTEGER_RE.test(value)) {
    throw new Error(`${name} must be a canonical decimal integer`);
  }
  const parsed = BigInt(value);
  if (parsed > MAX_SAFE_INTEGER_BIGINT || parsed < BigInt(min) || parsed > BigInt(max)) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return Number(parsed);
}

export function parseChainAuditDbInteger(label, value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return parseChainAuditBoundedInteger(label, value, min, max);
}

export function parseChainAuditDbTileId(label, value) {
  return parseChainAuditDbInteger(label, value, 1, MAX_AUDIT_TILE_ID);
}

export function parseChainAuditTileId(label, value) {
  if (typeof value !== "bigint" || value <= 0n || value > BigInt(MAX_AUDIT_TILE_ID)) {
    throw new Error(`${label} must be between 1 and ${MAX_AUDIT_TILE_ID}`);
  }
  return Number(value);
}

export function parseChainAuditEpoch(value) {
  if (typeof value !== "bigint" || value <= 0n || value > MAX_SAFE_INTEGER_BIGINT) return null;
  return Number(value);
}

export function toChainAuditSqlBlockNumber(label, value) {
  if (typeof value !== "bigint" || value < 0n || value > MAX_SAFE_INTEGER_BIGINT) {
    throw new Error(`${label} must be a safe non-negative block number`);
  }
  return Number(value);
}

export function normalizeChainAuditTransactionHash(log) {
  const normalized = String(log?.transactionHash ?? "").toLowerCase().trim();
  return /^0x[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

export function buildChainAuditEventId(log) {
  return buildNormalizedEventIdForLog(log);
}

export function buildChainAuditBetEventKey(epoch, log) {
  if (!Number.isSafeInteger(epoch) || epoch <= 0) return null;
  const normalizedHash = normalizeChainAuditTransactionHash(log);
  return normalizedHash ? `${epoch}_${normalizedHash}` : null;
}

export function planChainAuditBlockChunks(fromBlock, toBlock, {
  maxWindowBlocks = 250_000n,
  chunkSize = 10_000n,
} = {}) {
  if (typeof fromBlock !== "bigint" || typeof toBlock !== "bigint" || fromBlock < 0n || toBlock < fromBlock) {
    throw new Error("chain audit block window is invalid");
  }
  if (toBlock - fromBlock > maxWindowBlocks) {
    throw new Error("audit window exceeds 250000 blocks; refresh the indexer DB to the finalized chain head or reduce CHAIN_INDEXER_AUDIT_EPOCHS");
  }
  if (typeof chunkSize !== "bigint" || chunkSize <= 0n || chunkSize > maxWindowBlocks) {
    throw new Error("chain audit chunk size is invalid");
  }
  const chunks = [];
  for (let cursor = fromBlock; cursor <= toBlock; cursor += chunkSize) {
    const chunkTo = cursor + chunkSize - 1n > toBlock ? toBlock : cursor + chunkSize - 1n;
    chunks.push({ fromBlock: cursor, toBlock: chunkTo });
  }
  return chunks;
}
