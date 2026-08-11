import {
  buildIndexerBetIdentity,
  normalizeIndexerLogIndex,
} from "../../../server/storage";

export type RecoveredDepositIdentity = {
  id: string;
  logIndex: string;
};

export type DepositIdentityRow = {
  epoch: string;
  txHash: string;
  blockNumber: string;
  logIndex?: unknown;
};

type DepositDedupeOptions = {
  buildLegacyKey: (epoch: string, txHash: string, blockNumber: string) => string;
  parseBlockNumber: (value: string | null | undefined) => bigint;
};

export function buildRecoveredDepositIdentity(
  epoch: string,
  txHash: string,
  blockNumber: string,
  logIndex: unknown,
): RecoveredDepositIdentity | null {
  const normalizedHash = txHash.toLowerCase().trim();
  if (!/^0x[0-9a-f]{64}$/.test(normalizedHash)) return null;

  const normalizedLogIndex = normalizeIndexerLogIndex(logIndex);
  if (normalizedLogIndex === null) return null;

  const identity = buildIndexerBetIdentity(
    epoch,
    normalizedHash,
    blockNumber,
    normalizedLogIndex,
  );
  if (identity === null || identity.id === identity.legacyId) return null;

  return {
    id: identity.id,
    logIndex: normalizedLogIndex,
  };
}

export function dedupeDepositRowsByIdentity<T extends DepositIdentityRow>(
  rows: T[],
  options: DepositDedupeOptions,
): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    const canonicalIdentity = buildRecoveredDepositIdentity(
      row.epoch,
      row.txHash,
      row.blockNumber,
      row.logIndex,
    );
    const key = canonicalIdentity?.id ?? options.buildLegacyKey(
      row.epoch,
      row.txHash,
      row.blockNumber,
    );
    const previous = byKey.get(key);
    if (!previous) {
      byKey.set(key, row);
      continue;
    }
    const previousBlock = options.parseBlockNumber(previous.blockNumber);
    const nextBlock = options.parseBlockNumber(row.blockNumber);
    if (nextBlock >= previousBlock) {
      byKey.set(key, row);
    }
  }
  return Array.from(byKey.values());
}
