export const JACKPOT_PUBLIC_HISTORY_LIMIT = 200;

const CANONICAL_EPOCH_RE = /^[1-9]\d{0,15}$/;
const CANONICAL_BLOCK_RE = /^(?:0|[1-9]\d{0,15})$/;
const CANONICAL_AMOUNT_RE = /^(?:0|[1-9]\d{0,77})(?:\.\d{1,18})?$/;
const TX_HASH_RE = /^0x[0-9a-f]{64}$/;
const BLOCK_HASH_RE = /^0x[0-9a-f]{64}$/;

export type JackpotPublicRow = {
  epoch: string;
  kind: "daily" | "weekly";
  amount: string;
  amountNum: number;
  txHash: string;
  blockNumber: string;
  /** Present only for a canonical finalized log; legacy history remains non-shareable. */
  eventId?: string;
  logIndex?: string;
  blockHash?: string;
  finalizedAtBlock?: string;
  timestamp?: number | null;
};

export type JackpotCacheState = "fresh" | "stale" | "missing";

export type JackpotRecoveryContextPolicy = {
  blockNumber: bigint;
  blockHash: `0x${string}`;
  finalityBlocks: bigint;
  durableThroughBlock: bigint | null;
  durableCheckpointHash: `0x${string}` | null;
};

function normalizeRecoveryBlockHash(value: string | null | undefined): `0x${string}` | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return BLOCK_HASH_RE.test(normalized) ? normalized as `0x${string}` : null;
}

function normalizePublicHistoryLimit(value: number | undefined) {
  return Number.isSafeInteger(value) && value! > 0
    ? Math.min(value!, JACKPOT_PUBLIC_HISTORY_LIMIT)
    : JACKPOT_PUBLIC_HISTORY_LIMIT;
}

export function shouldBypassJackpotResponseCache(value: string | null): boolean {
  return value === "1";
}

export function classifyJackpotResponseCache(input: {
  hasPayload: boolean;
  expiresAt: number | null | undefined;
  now?: number;
}): JackpotCacheState {
  if (!input.hasPayload) return "missing";
  const now = input.now ?? Date.now();
  if (
    Number.isSafeInteger(now) &&
    now >= 0 &&
    Number.isSafeInteger(input.expiresAt) &&
    input.expiresAt! > now
  ) {
    return "fresh";
  }
  return "stale";
}

export function shouldStartJackpotRecovery(input: {
  hasInflightRecovery: boolean;
  lastStartedAt: number;
  now?: number;
  cooldownMs: number;
}) {
  const now = input.now ?? Date.now();
  if (input.hasInflightRecovery) return false;
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !Number.isSafeInteger(input.lastStartedAt) ||
    input.lastStartedAt < 0 ||
    !Number.isSafeInteger(input.cooldownMs) ||
    input.cooldownMs <= 0 ||
    now < input.lastStartedAt
  ) {
    return false;
  }
  return now - input.lastStartedAt >= input.cooldownMs;
}

export function sanitizeJackpotPublicRows(
  rows: readonly unknown[],
  input: { contractDeployBlock: bigint; limit?: number },
): JackpotPublicRow[] {
  const limit = normalizePublicHistoryLimit(input.limit);
  const maxInspectedRows = Math.min(rows.length, limit * 4);
  const sanitized: JackpotPublicRow[] = [];

  for (let index = 0; index < maxInspectedRows && sanitized.length < limit; index += 1) {
    const candidate = rows[index];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const row = candidate as Record<string, unknown>;
    if (typeof row.epoch !== "string" || !CANONICAL_EPOCH_RE.test(row.epoch)) continue;
    if (row.kind !== "daily" && row.kind !== "weekly") continue;
    if (typeof row.amount !== "string" || !CANONICAL_AMOUNT_RE.test(row.amount)) continue;
    if (
      typeof row.amountNum !== "number" ||
      !Number.isFinite(row.amountNum) ||
      row.amountNum < 0 ||
      row.amountNum > Number.MAX_SAFE_INTEGER
    ) continue;
    if (typeof row.blockNumber !== "string" || !CANONICAL_BLOCK_RE.test(row.blockNumber)) continue;
    const blockNumber = BigInt(row.blockNumber);
    if (blockNumber !== 0n && blockNumber < input.contractDeployBlock) continue;

    const normalizedTxHash = typeof row.txHash === "string"
      ? row.txHash.trim().toLowerCase()
      : "";
    const normalized: JackpotPublicRow = {
      epoch: row.epoch,
      kind: row.kind,
      amount: row.amount,
      amountNum: row.amountNum,
      txHash: TX_HASH_RE.test(normalizedTxHash) ? normalizedTxHash : "",
      blockNumber: row.blockNumber,
    };
    const logIndex = typeof row.logIndex === "string" && /^(?:0|[1-9]\d*)$/.test(row.logIndex)
      ? row.logIndex
      : null;
    const blockHash = typeof row.blockHash === "string" ? row.blockHash.trim().toLowerCase() : "";
    const finalizedAtBlock = typeof row.finalizedAtBlock === "string" && /^[1-9]\d*$/.test(row.finalizedAtBlock)
      ? row.finalizedAtBlock
      : null;
    const eventId = typeof row.eventId === "string" ? row.eventId.trim().toLowerCase() : "";
    if (
      normalizedTxHash &&
      logIndex !== null &&
      BLOCK_HASH_RE.test(blockHash) &&
      finalizedAtBlock !== null &&
      BigInt(finalizedAtBlock) >= blockNumber &&
      eventId === `${normalizedTxHash}:${BigInt(logIndex)}`
    ) {
      normalized.eventId = eventId;
      normalized.logIndex = BigInt(logIndex).toString();
      normalized.blockHash = blockHash;
      normalized.finalizedAtBlock = finalizedAtBlock;
    }
    if (Object.prototype.hasOwnProperty.call(row, "timestamp")) {
      normalized.timestamp = row.timestamp === null
        ? null
        : typeof row.timestamp === "number" && Number.isSafeInteger(row.timestamp) && row.timestamp >= 0
          ? row.timestamp
          : null;
    }
    sanitized.push(normalized);
  }

  return sanitized;
}

export function deriveDurableJackpotRecoveryCheckpoint(input: {
  contractDeployBlock: bigint;
  finalityBlocks: bigint;
  targetBlock: bigint;
  lastIndexedBlock: bigint | null;
  checkpointBlock: bigint | null;
  checkpointHash: string | null;
  observedCheckpointHash: string | null;
}) {
  const checkpointHash = normalizeRecoveryBlockHash(input.checkpointHash);
  const observedCheckpointHash = normalizeRecoveryBlockHash(input.observedCheckpointHash);
  if (
    input.finalityBlocks <= 0n ||
    input.lastIndexedBlock === null ||
    input.lastIndexedBlock < input.contractDeployBlock ||
    input.lastIndexedBlock > input.targetBlock ||
    input.checkpointBlock !== input.lastIndexedBlock ||
    checkpointHash === null ||
    observedCheckpointHash !== checkpointHash
  ) {
    return null;
  }
  return { blockNumber: input.lastIndexedBlock, blockHash: checkpointHash };
}

export function canPersistJackpotRecoveryBlock(
  context: JackpotRecoveryContextPolicy,
  blockNumber: bigint,
  contractDeployBlock: bigint,
) {
  return (
    context.finalityBlocks > 0n &&
    context.durableThroughBlock !== null &&
    blockNumber >= contractDeployBlock &&
    blockNumber <= context.durableThroughBlock
  );
}

export function isDurableJackpotRecoverySnapshot(context: JackpotRecoveryContextPolicy) {
  return (
    context.finalityBlocks > 0n &&
    context.durableThroughBlock !== null &&
    context.durableCheckpointHash !== null &&
    context.durableThroughBlock === context.blockNumber
  );
}

export function createJackpotPublicErrorPayload() {
  return { jackpots: [] as JackpotPublicRow[], error: "Unable to load jackpots" as const };
}
