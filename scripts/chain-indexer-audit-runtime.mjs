import { mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const CHAIN_AUDIT_ACCOUNTING_KEYS = Object.freeze([
  "rolloverPool",
  "dailyJackpotPool",
  "weeklyJackpotPool",
  "accruedOwnerFees",
  "accruedBurnFees",
]);

export const CHAIN_AUDIT_METADATA_CATEGORIES = Object.freeze([
  Object.freeze({
    category: "batch_claim",
    seenKey: "batchClaims",
    mismatchKind: "claim",
    detail: "index metadata row has no chain event in window",
  }),
  Object.freeze({
    category: "resolver_reward",
    seenKey: "resolverRewards",
    mismatchKind: "resolver-reward",
    detail: "index metadata row has no chain event in window",
  }),
  Object.freeze({
    category: "dust_settlement",
    seenKey: "dustSettlements",
    mismatchKind: "dust-settlement",
    detail: "index metadata row has no chain event in window",
  }),
]);

export const CHAIN_AUDIT_DUST_EVENT_NAMES = Object.freeze([
  "RewardDustSettled",
  "RebateDustSettled",
]);

export function assertChainAuditDbFile(dbPath, { statSyncFn = statSync } = {}) {
  if (!dbPath) throw new Error("LORE_DB_PATH must point to an existing indexer SQLite database file");
  let stats;
  try {
    stats = statSyncFn(dbPath);
  } catch {
    stats = null;
  }
  if (!stats?.isFile()) {
    throw new Error("LORE_DB_PATH must point to an existing indexer SQLite database file");
  }
  return dbPath;
}

export function selectChainAuditResolvedEpochRows({
  db,
  scope,
  auditEndEpoch,
  windowEpochs,
}) {
  const rows = auditEndEpoch === null
    ? db.prepare(`
        SELECT epoch, winning_tile, total_pool, reward_pool, fee, jackpot_bonus, resolved_block
        FROM scoped_epochs WHERE scope = ? ORDER BY epoch DESC LIMIT ?
      `).all(scope, windowEpochs)
    : db.prepare(`
        SELECT epoch, winning_tile, total_pool, reward_pool, fee, jackpot_bonus, resolved_block
        FROM scoped_epochs WHERE scope = ? AND epoch <= ? ORDER BY epoch DESC LIMIT ?
      `).all(scope, auditEndEpoch, windowEpochs);
  return [...rows].reverse();
}

export async function readChainAuditAccountingSnapshot({
  client,
  contractAddress,
  abi,
  blockNumber,
  keys = CHAIN_AUDIT_ACCOUNTING_KEYS,
}) {
  const values = await Promise.all(keys.map((functionName) => client.readContract({
    address: contractAddress,
    abi,
    functionName,
    blockNumber,
  })));
  return Object.fromEntries(keys.map((key, index) => [key, values[index]]));
}

export function readChainAuditStoredEventIds({
  db,
  scope,
  category,
  fromBlock,
  toBlock,
}) {
  try {
    return db.prepare(`
      SELECT id FROM scoped_indexer_events
      WHERE scope = ? AND category = ? AND block_number BETWEEN ? AND ?
    `).all(scope, category, fromBlock, toBlock)
      .map((row) => String(row.id).toLowerCase());
  } catch {
    return [];
  }
}

export function appendMissingChainAuditMetadataRows({ idsByCategory, seen, addMismatch }) {
  for (const policy of CHAIN_AUDIT_METADATA_CATEGORIES) {
    const ids = idsByCategory[policy.category] ?? [];
    const seenIds = seen[policy.seenKey];
    if (!(seenIds instanceof Set)) throw new Error(`missing chain audit seen set: ${policy.seenKey}`);
    for (const id of ids) {
      if (!seenIds.has(id)) addMismatch(policy.mismatchKind, policy.detail);
    }
  }
}

export function isChainAuditDustSettlementEvent(eventName) {
  return CHAIN_AUDIT_DUST_EVENT_NAMES.includes(eventName);
}

export function formatChainAuditSummary(summary, { summaryOnly }) {
  if (!summaryOnly) return JSON.stringify(summary);
  return `status=${summary.status}, network=${summary.network}, epochs=${summary.epochWindow.count}, blocks=${summary.blockWindow.from}-${summary.blockWindow.to}, mismatches=${summary.mismatches.length}, accountingMismatches=${summary.accounting.mismatchCount}`;
}

export function publishChainAuditSummary({
  summary,
  outPath,
  summaryOnly,
  processId = process.pid,
  fsApi = { mkdirSync, writeFileSync, renameSync },
  log = console.log,
}) {
  fsApi.mkdirSync(dirname(outPath), { recursive: true });
  const temporaryOutPath = `${outPath}.${processId}.tmp`;
  fsApi.writeFileSync(temporaryOutPath, `${JSON.stringify(summary, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fsApi.renameSync(temporaryOutPath, outPath);
  const output = formatChainAuditSummary(summary, { summaryOnly });
  log(output);
  return { output, temporaryOutPath, exitCode: summary.mismatches.length === 0 ? 0 : 1 };
}
