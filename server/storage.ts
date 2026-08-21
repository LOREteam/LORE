import { readdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { formatUnits, getAddress, parseUnits } from "viem";
import {
  computeWinningAmountWei,
  formatLineaAmountFixed,
  formatLineaWeiDisplayNumber,
  parseLineaAmountWei,
} from "../app/lib/tokenAmountMath";
import { LEADERBOARD_TOP_N } from "../app/lib/constants";
import { sanitizeSentryPayload } from "../app/lib/sentrySanitize";
import {
  getConfiguredContractAddress,
  getConfiguredLineaNetwork,
} from "../config/publicConfig";
import { db, dbPath, isDbShuttingDown } from "./db";

const MAX_CHAT_MESSAGES = 100;
const CURRENT_STORAGE_SCOPE = [
  getConfiguredLineaNetwork(),
  getConfiguredContractAddress(
    process.env.KEEPER_CONTRACT_ADDRESS ??
      process.env.NEXT_PUBLIC_CONTRACT_ADDRESS,
    getConfiguredLineaNetwork(),
  ).toLowerCase(),
].join(":");
const SCOPED_EPOCHS_TABLE = "scoped_epochs";
const SCOPED_BETS_TABLE = "scoped_bets";
const SCOPED_JACKPOTS_TABLE = "scoped_jackpots";
const SCOPED_REWARD_CLAIMS_TABLE = "scoped_reward_claims";
const SCOPED_USER_ACTIVITY_TABLE = "scoped_user_activity";
const SCOPED_PROTOCOL_FEE_FLUSHES_TABLE = "scoped_protocol_fee_flushes";
const SCOPED_GLOBAL_STATS_AGGREGATE_TABLE = "scoped_global_stats_aggregate";
const SCOPED_GLOBAL_STATS_DIRTY_TABLE = "scoped_global_stats_dirty";
const SCOPED_LEADERBOARD_READ_MODEL_TABLE = "scoped_leaderboard_read_model";
const SCOPED_LEADERBOARD_DIRTY_TABLE = "scoped_leaderboard_dirty";
const SCOPED_INDEXER_EVENTS_TABLE = "scoped_indexer_events";
const SCOPED_INDEXER_BLOCK_CHECKPOINTS_TABLE = "scoped_indexer_block_checkpoints";
const SCOPED_INDEXER_LEASES_TABLE = "scoped_indexer_leases";
const ACTIVE_CONTRACT_SCOPE_META_KEY = "__storage_active_contract_scope";
const PUBLIC_READ_MODEL_REVISION_META_KEY = "publicReadModelRevision";
const GLOBAL_STATS_MODEL_VERSION = 3;
const LEADERBOARD_READ_MODEL_VERSION = 1;
const LEGACY_CONTRACT_META_KEYS = [
  "currentEpoch",
  "lastIndexedBlock",
  "repairCursorBlock",
  "snapshot:live-state:v1",
  "gamedata:epochLifecycle",
  "gamedata:batchClaims",
  "gamedata:resolverRewards",
  "gamedata:dustSettlements",
] as const;
const CONTRACT_SCOPE_PURGE_ENV = "LORE_ALLOW_CONTRACT_SCOPE_PURGE";
export const MIN_INDEXER_LEASE_TTL_MS = 1_000;
export const MAX_INDEXER_LEASE_TTL_MS = 120_000;
const MIN_INDEXER_LEASE_OWNER_TOKEN_LENGTH = 16;
const MAX_INDEXER_LEASE_OWNER_TOKEN_LENGTH = 200;

export interface EpochStorageRow {
  winningTile: number;
  totalPool: string;
  rewardPool: string;
  fee?: string;
  jackpotBonus?: string;
  isDailyJackpot: boolean;
  isWeeklyJackpot: boolean;
  resolvedBlock?: string;
}

export interface BetStorageRow {
  epoch: string;
  user: string;
  tileIds: number[];
  amounts?: string[];
  totalAmount: string;
  totalAmountNum: number;
  txHash: string;
  blockNumber: string;
  logIndex?: string;
}

export interface JackpotStorageRow {
  epoch: string;
  kind: "daily" | "weekly";
  amount: string;
  amountNum: number;
  txHash: string;
  blockNumber: string;
  /** Required for canonical shareability; omitted rows remain legacy history only. */
  logIndex?: string;
  blockHash?: string;
  finalizedAtBlock?: string;
  eventId?: string;
}

export interface RewardClaimStorageRow {
  id: string;
  epoch: string;
  user: string;
  reward: string;
  rewardNum: number;
  txHash: string;
  blockNumber: string;
  /** Batch event owns the user-activity row; retain this raw claim for read models. */
  recordUserActivity?: boolean;
}

export type UserActivityType =
  | "bet"
  | "reward_claim"
  | "reward_batch_claim"
  | "rebate_claim"
  | "rebate_batch_claim";

export interface UserActivityStorageRow {
  eventId: string;
  user: string;
  activityType: UserActivityType;
  epoch?: string;
  amount: string;
  amountNum: number;
  txHash: string;
  blockNumber: string;
}

export interface UserActivityPage {
  rows: UserActivityStorageRow[];
  hasMore: boolean;
  nextCursor: string | null;
  /** New ledger rows are durable, but historical raw rows are not backfilled. */
  coverage: "partial";
  indexedThroughBlock: string;
}

export interface FeeFlushStorageRow {
  id: string;
  ownerAmount: string;
  burnAmount: string;
  txHash: string;
  blockNumber: string;
}

export interface IndexerBlockCheckpoint {
  blockNumber: string;
  blockHash: string;
}

export interface IndexerChunkCommit {
  leaseOwnerToken: string;
  expectedPreviousBlock: bigint;
  expectedPreviousBlockHash: string | null;
  blockNumber: bigint;
  blockHash: string;
}

export interface ChatMessageRow {
  id: string;
  sender: string;
  senderName: string | null;
  senderAvatar: string | null;
  text: string;
  timestamp: number;
}

export interface ChatProfileRow {
  name: string | null;
  avatar: string | null;
  customAvatar: string | null;
  updatedAt: number;
}

type JsonMap = Record<string, unknown>;
type IndexerEventCategory = "batch_claim" | "resolver_reward" | "dust_settlement";

const INDEXER_EVENT_PATHS: Record<string, IndexerEventCategory> = {
  "gamedata/batchClaims": "batch_claim",
  "gamedata/resolverRewards": "resolver_reward",
  "gamedata/dustSettlements": "dust_settlement",
};
const MAX_INDEXER_EVENT_ID_LENGTH = 160;
const MAX_INDEXER_EVENT_PAYLOAD_BYTES = 16 * 1024;
const USER_ACTIVITY_TYPES = new Set<UserActivityType>(["bet", "reward_claim", "reward_batch_claim", "rebate_claim", "rebate_batch_claim"]);

function stringifyBoundedIndexerEventPayload(payload: JsonMap) {
  try {
    const payloadJson = JSON.stringify(payload);
    return Buffer.byteLength(payloadJson, "utf8") <= MAX_INDEXER_EVENT_PAYLOAD_BYTES
      ? payloadJson
      : null;
  } catch {
    return null;
  }
}

function parseJsonArray<T>(value: unknown): T[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    console.warn("[storage] Invalid JSON array value");
    return [];
  }
}

function boolToInt(value: boolean) {
  return value ? 1 : 0;
}

function intToBool(value: unknown) {
  return Number(value) === 1;
}

function normalizeWallet(value: string) {
  return value.trim().toLowerCase();
}

function isSafePositiveInteger(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}

function parseSafePositiveIntegerString(value: string | null | undefined) {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return isSafePositiveInteger(parsed) ? parsed : null;
}

function parseSafeNonNegativeIntegerString(value: string | null | undefined) {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeIndexerBlockHash(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return /^0x[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

function validateIndexerLeaseOwnerToken(value: string) {
  if (
    typeof value !== "string" ||
    value.length < MIN_INDEXER_LEASE_OWNER_TOKEN_LENGTH ||
    value.length > MAX_INDEXER_LEASE_OWNER_TOKEN_LENGTH ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error("invalid opaque indexer lease owner token");
  }
  return value;
}

function validateIndexerLeaseTtlMs(value: number) {
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_INDEXER_LEASE_TTL_MS ||
    value > MAX_INDEXER_LEASE_TTL_MS
  ) {
    throw new Error(
      `indexer lease TTL must be between ${MIN_INDEXER_LEASE_TTL_MS} and ${MAX_INDEXER_LEASE_TTL_MS} milliseconds`,
    );
  }
  return value;
}

function normalizePageLimit(value: number | null | undefined, defaultValue: number, maxValue: number) {
  if (value === null || value === undefined) return defaultValue;
  if (!Number.isSafeInteger(value) || value <= 0) return defaultValue;
  return Math.min(maxValue, value);
}

function parseAmountWei(value: unknown) {
  if (typeof value !== "string" || !value) return 0n;
  try {
    return parseUnits(value, 18);
  } catch {
    console.warn("[storage] Invalid token amount value");
    return 0n;
  }
}

function parseGlobalStatsAmountWei(value: unknown) {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(String(value ?? "").trim());
  if (match === null) return 0n;
  const [, whole, fraction = ""] = match;
  return BigInt(`${whole}${fraction.slice(0, 18).padEnd(18, "0")}`);
}

function describeStorageError(error: unknown) {
  return sanitizeSentryPayload({
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
  });
}

let transactionDepth = 0;
let savepointSequence = 0;

function runInTransaction<T>(action: () => T, label = "tx"): T {
  const isOuterTransaction = transactionDepth === 0;
  const savepoint = `storage_tx_${savepointSequence++}`;
  db.exec(isOuterTransaction ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
  transactionDepth += 1;
  try {
    const result = action();
    db.exec(isOuterTransaction ? "COMMIT" : `RELEASE SAVEPOINT ${savepoint}`);
    transactionDepth -= 1;
    return result;
  } catch (error) {
    transactionDepth -= 1;
    try {
      if (isOuterTransaction) {
        db.exec("ROLLBACK");
      } else {
        db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      }
    } catch (rollbackErr) {
      const details = describeStorageError(rollbackErr);
      console.error(`[storage] Rollback failed: ${details.name}: ${details.message}`);
    }
    const details = describeStorageError(error);
    console.error(`[storage] ${label} failed: ${details.name}: ${details.message}`);
    throw error;
  }
}

function runWrite<T>(action: () => T, label = "write"): T {
  try {
    return action();
  } catch (error) {
    const details = describeStorageError(error);
    console.error(`[storage] ${label} failed: ${details.name}: ${details.message}`);
    throw error;
  }
}

function scopeMetaKey(key: string) {
  return `${CURRENT_STORAGE_SCOPE}:${key}`;
}

function getGlobalMetaValue(key: string) {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return typeof row?.value === "string" ? row.value : null;
}

function setGlobalMetaValue(key: string, value: string) {
  runWrite(() => {
    db.prepare(`
      INSERT INTO meta(key, value)
      VALUES(?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }, "global_meta");
}

function getMetaValue(key: string) {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(scopeMetaKey(key));
  return typeof row?.value === "string" ? row.value : null;
}

function setMetaValue(key: string, value: string) {
  runWrite(() => {
    db.prepare(`
      INSERT INTO meta(key, value)
      VALUES(?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(scopeMetaKey(key), value);
  }, "meta");
}

/**
 * Monotonic, contract-scoped version for cached public aggregates. Call this
 * only from the same transaction as a write that can change a public model.
 */
function bumpPublicReadModelRevision() {
  const current = getMetaBigInt(PUBLIC_READ_MODEL_REVISION_META_KEY);
  const next = current !== null && current >= 0n ? current + 1n : 1n;
  setMetaValue(PUBLIC_READ_MODEL_REVISION_META_KEY, next.toString());
  return next.toString();
}

export function getPublicReadModelRevision() {
  // Public route caches consult this before their payload getters. A dirty
  // source marker must therefore fail before a stale cache entry can win.
  if (isGlobalStatsAggregateDirty() || isLeaderboardReadModelDirty()) {
    throw new Error("Public read model source data is dirty");
  }
  // Cache keys must not validate a stale route payload when a versioned
  // materialization row is missing or malformed. This is bounded by top-K JSON,
  // never by the raw history tables.
  getLeaderboardReadModel();
  const revision = getMetaBigInt(PUBLIC_READ_MODEL_REVISION_META_KEY);
  return revision !== null && revision >= 0n ? revision.toString() : "0";
}

type GlobalStatsAggregate = {
  totalVolumeWei: string;
  totalBurnWei: string;
  resolvedEpochs: number;
  lastIndexedBlock: string;
};

type GlobalStatsAggregateRecord = Record<string, unknown>;

type GlobalStatsAggregateDelta = {
  volumeWei?: bigint;
  burnWei?: bigint;
  epochCount?: number;
  lastIndexedBlock?: string;
};

type GlobalStatsAggregateReadiness = {
  needsRevisionBump: boolean;
};

function parseCanonicalNonNegativeBigInt(value: unknown, label: string) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${label} is not a canonical non-negative integer`);
  }
  const parsed = BigInt(value);
  if (parsed.toString() !== value) {
    throw new Error(`${label} is not a canonical non-negative integer`);
  }
  return parsed;
}

function parseSafeNonNegativeCount(value: unknown, label: string) {
  let parsed: unknown = value;
  if (typeof value === "bigint") {
    parsed = value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : Number.NaN;
  }
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 0) {
    throw new Error(`${label} is not a safe non-negative integer`);
  }
  return Number(parsed);
}

function getGlobalStatsAggregateRecord() {
  return db.prepare(`
    SELECT model_version, total_volume_wei, total_burn_wei, epoch_count, last_indexed_block
    FROM ${SCOPED_GLOBAL_STATS_AGGREGATE_TABLE}
    WHERE scope = ?
  `).get(CURRENT_STORAGE_SCOPE) as GlobalStatsAggregateRecord | undefined;
}

function isGlobalStatsAggregateDirty() {
  return db.prepare(`
    SELECT 1 AS dirty
    FROM ${SCOPED_GLOBAL_STATS_DIRTY_TABLE}
    WHERE scope = ?
  `).get(CURRENT_STORAGE_SCOPE) !== undefined;
}

function clearGlobalStatsAggregateDirtyInTransaction() {
  db.prepare(`DELETE FROM ${SCOPED_GLOBAL_STATS_DIRTY_TABLE} WHERE scope = ?`)
    .run(CURRENT_STORAGE_SCOPE);
}

function decodeGlobalStatsAggregateRecord(record: GlobalStatsAggregateRecord): GlobalStatsAggregate {
  if (record.model_version !== GLOBAL_STATS_MODEL_VERSION) {
    throw new Error("Global stats aggregate model is unavailable");
  }
  const totalVolumeWei = parseCanonicalNonNegativeBigInt(
    record.total_volume_wei,
    "global stats total volume",
  );
  const totalBurnWei = parseCanonicalNonNegativeBigInt(
    record.total_burn_wei,
    "global stats total burn",
  );
  const resolvedEpochs = parseSafeNonNegativeCount(record.epoch_count, "global stats epoch count");
  const lastIndexedBlock = parseCanonicalNonNegativeBigInt(
    record.last_indexed_block,
    "global stats last indexed block",
  );

  return {
    totalVolumeWei: totalVolumeWei.toString(),
    totalBurnWei: totalBurnWei.toString(),
    resolvedEpochs,
    lastIndexedBlock: lastIndexedBlock.toString(),
  };
}

/** Read-only canonical indexer watermark: absent is 0; malformed or negative metadata fails closed. */
export function getCanonicalLastIndexedBlock() {
  const raw = getMetaValue("lastIndexedBlock");
  if (raw === null) return "0";
  try {
    const parsed = BigInt(raw);
    if (parsed < 0n) throw new Error("last indexed block metadata is invalid");
    return parsed.toString();
  } catch {
    throw new Error("last indexed block metadata is invalid");
  }
}

function calculateGlobalStatsAggregateFromRaw(): GlobalStatsAggregate {
  const betRows = db.prepare(`
    SELECT total_amount
    FROM ${SCOPED_BETS_TABLE}
    WHERE scope = ?
  `).all(CURRENT_STORAGE_SCOPE) as Array<Record<string, unknown>>;
  const feeRows = db.prepare(`
    SELECT burn_amount
    FROM ${SCOPED_PROTOCOL_FEE_FLUSHES_TABLE}
    WHERE scope = ?
  `).all(CURRENT_STORAGE_SCOPE) as Array<Record<string, unknown>>;
  const resolved = db.prepare(`
    SELECT COUNT(*) AS count
    FROM ${SCOPED_EPOCHS_TABLE}
    WHERE scope = ?
  `).get(CURRENT_STORAGE_SCOPE) as { count?: unknown } | undefined;

  return {
    totalVolumeWei: betRows.reduce(
      (total, row) => total + parseGlobalStatsAmountWei(row.total_amount),
      0n,
    ).toString(),
    totalBurnWei: feeRows.reduce(
      (total, row) => total + parseGlobalStatsAmountWei(row.burn_amount),
      0n,
    ).toString(),
    resolvedEpochs: parseSafeNonNegativeCount(resolved?.count ?? 0, "raw global stats epoch count"),
    lastIndexedBlock: getCanonicalLastIndexedBlock(),
  };
}

function writeGlobalStatsAggregate(aggregate: GlobalStatsAggregate) {
  db.prepare(`
    INSERT INTO ${SCOPED_GLOBAL_STATS_AGGREGATE_TABLE}(
      scope, model_version, total_volume_wei, total_burn_wei, epoch_count, last_indexed_block
    ) VALUES(?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope) DO UPDATE SET
      model_version = excluded.model_version,
      total_volume_wei = excluded.total_volume_wei,
      total_burn_wei = excluded.total_burn_wei,
      epoch_count = excluded.epoch_count,
      last_indexed_block = excluded.last_indexed_block
  `).run(
    CURRENT_STORAGE_SCOPE,
    GLOBAL_STATS_MODEL_VERSION,
    aggregate.totalVolumeWei,
    aggregate.totalBurnWei,
    aggregate.resolvedEpochs,
    aggregate.lastIndexedBlock,
  );
}

function rebuildGlobalStatsAggregateInTransaction() {
  const aggregate = calculateGlobalStatsAggregateFromRaw();
  writeGlobalStatsAggregate(aggregate);
  clearGlobalStatsAggregateDirtyInTransaction();
  return aggregate;
}

function ensureGlobalStatsAggregateReadyInTransaction(): GlobalStatsAggregateReadiness {
  const record = getGlobalStatsAggregateRecord();
  const wasDirty = isGlobalStatsAggregateDirty();
  if (record === undefined) {
    rebuildGlobalStatsAggregateInTransaction();
    return { needsRevisionBump: wasDirty };
  }

  const modelVersion = parseSafeNonNegativeCount(
    record.model_version,
    "global stats aggregate model version",
  );
  if (modelVersion > GLOBAL_STATS_MODEL_VERSION) {
    throw new Error("Global stats aggregate model version is newer than this runtime");
  }
  if (modelVersion !== GLOBAL_STATS_MODEL_VERSION || wasDirty) {
    rebuildGlobalStatsAggregateInTransaction();
    return { needsRevisionBump: true };
  }

  decodeGlobalStatsAggregateRecord(record);
  return { needsRevisionBump: false };
}

function ensureGlobalStatsAggregate() {
  runInTransaction(() => {
    const readiness = ensureGlobalStatsAggregateReadyInTransaction();
    if (readiness.needsRevisionBump) bumpPublicReadModelRevision();
  }, "global_stats_backfill");
}

function readGlobalStatsAggregate() {
  if (isGlobalStatsAggregateDirty()) {
    throw new Error("Global stats aggregate source data is dirty");
  }
  const record = getGlobalStatsAggregateRecord();
  if (record === undefined) {
    throw new Error("Global stats aggregate model is unavailable");
  }
  return decodeGlobalStatsAggregateRecord(record);
}

function readGlobalStatsAggregateForSynchronizedMutationInTransaction() {
  const record = getGlobalStatsAggregateRecord();
  if (record === undefined) {
    throw new Error("Global stats aggregate model is unavailable");
  }
  return decodeGlobalStatsAggregateRecord(record);
}

function applyGlobalStatsAggregateDeltaInTransaction({
  volumeWei = 0n,
  burnWei = 0n,
  epochCount = 0,
  lastIndexedBlock,
  forceWrite = false,
}: GlobalStatsAggregateDelta & { forceWrite?: boolean }) {
  if (!forceWrite && volumeWei === 0n && burnWei === 0n && epochCount === 0 && lastIndexedBlock === undefined) {
    return;
  }
  if (!Number.isSafeInteger(epochCount)) {
    throw new Error("global stats epoch delta must be a safe integer");
  }

  // Source mutation triggers deliberately set the dirty marker before this point.
  // Callers first establish a clean base in the same transaction, then use the
  // exact delta below and clear that marker after the aggregate write.
  const current = readGlobalStatsAggregateForSynchronizedMutationInTransaction();
  const nextVolumeWei = BigInt(current.totalVolumeWei) + volumeWei;
  const nextBurnWei = BigInt(current.totalBurnWei) + burnWei;
  const nextEpochCount = current.resolvedEpochs + epochCount;
  if (nextVolumeWei < 0n || nextBurnWei < 0n || !Number.isSafeInteger(nextEpochCount) || nextEpochCount < 0) {
    throw new Error("global stats aggregate delta would violate model invariants");
  }

  const nextLastIndexedBlock = lastIndexedBlock === undefined
    ? current.lastIndexedBlock
    : parseCanonicalNonNegativeBigInt(lastIndexedBlock, "global stats last indexed block").toString();
  writeGlobalStatsAggregate({
    totalVolumeWei: nextVolumeWei.toString(),
    totalBurnWei: nextBurnWei.toString(),
    resolvedEpochs: nextEpochCount,
    lastIndexedBlock: nextLastIndexedBlock,
  });
}

function synchronizeGlobalStatsAggregateAfterSourceMutationInTransaction(delta: GlobalStatsAggregateDelta) {
  applyGlobalStatsAggregateDeltaInTransaction({ ...delta, forceWrite: true });
  clearGlobalStatsAggregateDirtyInTransaction();
}

function finalizeGlobalStatsAggregateAfterRawMutationInTransaction(
  delta: GlobalStatsAggregateDelta,
  rawChanged: boolean,
) {
  if (rawChanged) {
    synchronizeGlobalStatsAggregateAfterSourceMutationInTransaction(delta);
    return true;
  }
  // SQLite reports changed rows for the UPSERTs above. If that invariant ever
  // diverges from a trigger firing, rebuild rather than leave a dirty model or
  // apply an unproven delta.
  if (isGlobalStatsAggregateDirty()) {
    rebuildGlobalStatsAggregateInTransaction();
    return true;
  }
  return false;
}

type LeaderboardReadModelEntry = {
  address: string;
  value: string;
  valueNum: number;
  extra?: string;
};

export type LeaderboardReadModel = {
  biggestSingleWin: LeaderboardReadModelEntry[];
  luckiest: LeaderboardReadModelEntry[];
  oneTileWonder: LeaderboardReadModelEntry[];
  mostWins: LeaderboardReadModelEntry[];
  whales: LeaderboardReadModelEntry[];
  underdog: LeaderboardReadModelEntry[];
  luckyTile: Array<{ tileId: number; wins: number; pct: number }>;
};

type LeaderboardReadModelRecord = Record<string, unknown>;

function normalizeLeaderboardAddress(value: string): `0x${string}` | null {
  try {
    return getAddress(value).toLowerCase() as `0x${string}`;
  } catch {
    return null;
  }
}

function compareLeaderboardBigIntDesc(left: bigint, right: bigint) {
  if (left === right) return 0;
  return left > right ? -1 : 1;
}

function getLeaderboardWinningTile(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 25
    ? value
    : null;
}

function formatLeaderboardAmount(wei: bigint) {
  return formatLineaAmountFixed(wei, 2);
}

function toLeaderboardDisplayNumber(wei: bigint) {
  return formatLineaWeiDisplayNumber(wei);
}

function calculateLeaderboardReadModelFromRaw(): LeaderboardReadModel {
  const bets = getAllBetRows();
  const claims = getAllRewardClaims();
  const epochs = getEpochMap();
  const users = new Map<string, {
    totalWagered: bigint;
    totalWon: bigint;
    maxSingleWin: bigint;
    winCount: number;
  }>();
  const userWinningAmounts = new Map<string, bigint>();
  const rewardByEpochUser = new Map<string, bigint>();
  const maxSingleTileWinByUser = new Map<string, bigint>();
  const luckyTileWins = new Map<number, number>();
  let resolvedCount = 0;

  for (const epochRow of Object.values(epochs)) {
    const winningTile = getLeaderboardWinningTile(epochRow.winningTile);
    if (winningTile === null) continue;
    luckyTileWins.set(winningTile, (luckyTileWins.get(winningTile) ?? 0) + 1);
    resolvedCount += 1;
  }

  for (const bet of bets) {
    const address = normalizeLeaderboardAddress(bet.user);
    if (!address) continue;
    const previous = users.get(address) ?? {
      totalWagered: 0n,
      totalWon: 0n,
      maxSingleWin: 0n,
      winCount: 0,
    };
    previous.totalWagered += parseLineaAmountWei(bet.totalAmount);
    users.set(address, previous);

    const winningTile = getLeaderboardWinningTile(epochs[bet.epoch]?.winningTile);
    if (winningTile === null) continue;
    const winningAmountWei = computeWinningAmountWei(bet.tileIds, bet.amounts, winningTile, bet.totalAmount);
    if (winningAmountWei <= 0n) continue;
    const key = `${bet.epoch}:${address}`;
    userWinningAmounts.set(key, (userWinningAmounts.get(key) ?? 0n) + winningAmountWei);
  }

  const underdogCandidates: Array<{ address: string; rewardWei: bigint; tile: number; tilePoolWei: bigint }> = [];
  for (const claim of claims) {
    const address = normalizeLeaderboardAddress(claim.user);
    if (!address) continue;
    const rewardWei = parseLineaAmountWei(claim.reward);
    const rewardKey = `${claim.epoch}:${address}`;
    rewardByEpochUser.set(rewardKey, (rewardByEpochUser.get(rewardKey) ?? 0n) + rewardWei);
    const previous = users.get(address) ?? {
      totalWagered: 0n,
      totalWon: 0n,
      maxSingleWin: 0n,
      winCount: 0,
    };
    previous.totalWon += rewardWei;
    if (rewardWei > previous.maxSingleWin) previous.maxSingleWin = rewardWei;
    previous.winCount += 1;
    users.set(address, previous);

    const epochRow = epochs[claim.epoch];
    const winningTile = getLeaderboardWinningTile(epochRow?.winningTile);
    if (winningTile === null || rewardWei <= 0n) continue;
    const userWinningWei = userWinningAmounts.get(`${claim.epoch}:${address}`) ?? 0n;
    if (userWinningWei <= 0n) continue;
    const rewardPoolWei = parseLineaAmountWei(epochRow.rewardPool);
    if (rewardPoolWei <= 0n) continue;
    const tilePoolWei = (rewardPoolWei * userWinningWei) / rewardWei;
    if (tilePoolWei <= 0n) continue;
    underdogCandidates.push({ address, rewardWei, tile: winningTile, tilePoolWei });
  }

  for (const bet of bets) {
    const winningTile = getLeaderboardWinningTile(epochs[bet.epoch]?.winningTile);
    if (winningTile === null) continue;
    const address = normalizeLeaderboardAddress(bet.user);
    if (!address) continue;
    const key = `${bet.epoch}:${address}`;
    const userWinningWei = userWinningAmounts.get(key) ?? 0n;
    const rewardWei = rewardByEpochUser.get(key) ?? 0n;
    if (userWinningWei <= 0n || rewardWei <= 0n) continue;
    const winningAmountWei = computeWinningAmountWei(bet.tileIds, bet.amounts, winningTile, bet.totalAmount);
    if (winningAmountWei <= 0n) continue;
    const singleTileRewardWei = (rewardWei * winningAmountWei) / userWinningWei;
    if (singleTileRewardWei > (maxSingleTileWinByUser.get(address) ?? 0n)) {
      maxSingleTileWinByUser.set(address, singleTileRewardWei);
    }
  }

  const userRows = [...users.entries()].map(([address, row]) => ({ address, ...row }));
  const biggestSingleWin = userRows
    .filter((row) => row.maxSingleWin > 0n)
    .sort((left, right) => compareLeaderboardBigIntDesc(left.maxSingleWin, right.maxSingleWin) || left.address.localeCompare(right.address))
    .slice(0, LEADERBOARD_TOP_N)
    .map((row) => ({ address: row.address, value: formatLeaderboardAmount(row.maxSingleWin), valueNum: toLeaderboardDisplayNumber(row.maxSingleWin) }));
  const luckiest = userRows
    .filter((row) => row.totalWagered > 0n && row.totalWon > 0n)
    .map((row) => {
      const roiBasisPoints = (row.totalWon * 10_000n) / row.totalWagered;
      const roundedTenths = (roiBasisPoints + 5n) / 10n;
      return {
        address: row.address,
        value: `${roundedTenths / 10n}.${roundedTenths % 10n}%`,
        valueNum: Number(roiBasisPoints > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : roiBasisPoints) / 100,
        roiBasisPoints,
        extra: `won ${formatUnits(row.totalWon, 18)} / wagered ${formatUnits(row.totalWagered, 18)}`,
      };
    })
    .sort((left, right) => compareLeaderboardBigIntDesc(left.roiBasisPoints, right.roiBasisPoints) || left.address.localeCompare(right.address))
    .slice(0, LEADERBOARD_TOP_N)
    .map(({ address, value, valueNum, extra }) => ({ address, value, valueNum, extra }));
  const mostWins = userRows
    .filter((row) => row.winCount > 0)
    .sort((left, right) => right.winCount - left.winCount || left.address.localeCompare(right.address))
    .slice(0, LEADERBOARD_TOP_N)
    .map((row) => ({ address: row.address, value: String(row.winCount), valueNum: row.winCount }));
  const whales = userRows
    .filter((row) => row.totalWagered > 0n)
    .sort((left, right) => compareLeaderboardBigIntDesc(left.totalWagered, right.totalWagered) || left.address.localeCompare(right.address))
    .slice(0, LEADERBOARD_TOP_N)
    .map((row) => ({ address: row.address, value: formatLeaderboardAmount(row.totalWagered), valueNum: toLeaderboardDisplayNumber(row.totalWagered) }));
  const underdog = underdogCandidates
    .sort((left, right) => {
      if (left.tilePoolWei !== right.tilePoolWei) return left.tilePoolWei < right.tilePoolWei ? -1 : 1;
      return compareLeaderboardBigIntDesc(left.rewardWei, right.rewardWei) || left.address.localeCompare(right.address);
    })
    .slice(0, LEADERBOARD_TOP_N)
    .map((row) => ({
      address: row.address,
      value: formatLeaderboardAmount(row.rewardWei),
      valueNum: toLeaderboardDisplayNumber(row.rewardWei),
      extra: `pool on tile ${row.tile} was ${formatLeaderboardAmount(row.tilePoolWei)} LINEA`,
    }));
  const oneTileWonder = [...maxSingleTileWinByUser.entries()]
    .filter(([, rewardWei]) => rewardWei > 0n)
    .sort((left, right) => compareLeaderboardBigIntDesc(left[1], right[1]) || left[0].localeCompare(right[0]))
    .slice(0, LEADERBOARD_TOP_N)
    .map(([address, rewardWei]) => ({ address, value: formatLeaderboardAmount(rewardWei), valueNum: toLeaderboardDisplayNumber(rewardWei) }));
  const luckyTile = [...luckyTileWins.entries()]
    .map(([tileId, wins]) => ({ tileId, wins, pct: resolvedCount > 0 ? (wins / resolvedCount) * 100 : 0 }))
    .sort((left, right) => right.wins - left.wins || left.tileId - right.tileId);

  return { biggestSingleWin, luckiest, oneTileWonder, mostWins, whales, underdog, luckyTile };
}

function isLeaderboardReadModelDirty() {
  return db.prepare(`SELECT 1 AS dirty FROM ${SCOPED_LEADERBOARD_DIRTY_TABLE} WHERE scope = ?`)
    .get(CURRENT_STORAGE_SCOPE) !== undefined;
}

function clearLeaderboardReadModelDirtyInTransaction() {
  db.prepare(`DELETE FROM ${SCOPED_LEADERBOARD_DIRTY_TABLE} WHERE scope = ?`).run(CURRENT_STORAGE_SCOPE);
}

function writeLeaderboardReadModel(readModel: LeaderboardReadModel) {
  db.prepare(`
    INSERT INTO ${SCOPED_LEADERBOARD_READ_MODEL_TABLE}(scope, model_version, payload_json)
    VALUES(?, ?, ?)
    ON CONFLICT(scope) DO UPDATE SET model_version = excluded.model_version, payload_json = excluded.payload_json
  `).run(CURRENT_STORAGE_SCOPE, LEADERBOARD_READ_MODEL_VERSION, JSON.stringify(readModel));
}

function rebuildLeaderboardReadModelInTransaction() {
  const readModel = calculateLeaderboardReadModelFromRaw();
  writeLeaderboardReadModel(readModel);
  clearLeaderboardReadModelDirtyInTransaction();
  return readModel;
}

function ensureLeaderboardReadModelReadyInTransaction() {
  const record = db.prepare(`
    SELECT model_version, payload_json FROM ${SCOPED_LEADERBOARD_READ_MODEL_TABLE} WHERE scope = ?
  `).get(CURRENT_STORAGE_SCOPE) as LeaderboardReadModelRecord | undefined;
  const wasDirty = isLeaderboardReadModelDirty();
  if (record === undefined) {
    rebuildLeaderboardReadModelInTransaction();
    return { needsRevisionBump: wasDirty };
  }
  const modelVersion = parseSafeNonNegativeCount(record.model_version, "leaderboard read model version");
  if (modelVersion > LEADERBOARD_READ_MODEL_VERSION) {
    throw new Error("leaderboard read model version is newer than this runtime");
  }
  if (modelVersion !== LEADERBOARD_READ_MODEL_VERSION || wasDirty) {
    rebuildLeaderboardReadModelInTransaction();
    return { needsRevisionBump: true };
  }
  decodeLeaderboardReadModelRecord(record);
  return { needsRevisionBump: false };
}

function ensureLeaderboardReadModel() {
  runInTransaction(() => {
    const readiness = ensureLeaderboardReadModelReadyInTransaction();
    if (readiness.needsRevisionBump) bumpPublicReadModelRevision();
  }, "leaderboard_read_model_backfill");
}

function finalizeLeaderboardReadModelAfterRawMutationInTransaction(rawChanged: boolean) {
  if (rawChanged || isLeaderboardReadModelDirty()) {
    rebuildLeaderboardReadModelInTransaction();
    return true;
  }
  return false;
}

function decodeLeaderboardReadModelRecord(record: LeaderboardReadModelRecord): LeaderboardReadModel {
  if (record.model_version !== LEADERBOARD_READ_MODEL_VERSION || typeof record.payload_json !== "string") {
    throw new Error("leaderboard read model is unavailable");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.payload_json);
  } catch {
    throw new Error("leaderboard read model payload is invalid");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("leaderboard read model payload is invalid");
  }
  const source = parsed as Record<string, unknown>;
  const decodeEntries = (key: keyof LeaderboardReadModel) => {
    const rows = source[key];
    if (!Array.isArray(rows) || rows.length > LEADERBOARD_TOP_N) throw new Error("leaderboard read model payload is invalid");
    return rows.map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("leaderboard read model payload is invalid");
      const entry = row as Record<string, unknown>;
      if (typeof entry.address !== "string" || normalizeLeaderboardAddress(entry.address) !== entry.address ||
        typeof entry.value !== "string" || typeof entry.valueNum !== "number" || !Number.isFinite(entry.valueNum) ||
        (entry.extra !== undefined && typeof entry.extra !== "string")) {
        throw new Error("leaderboard read model payload is invalid");
      }
      return entry.extra === undefined
        ? { address: entry.address, value: entry.value, valueNum: entry.valueNum }
        : { address: entry.address, value: entry.value, valueNum: entry.valueNum, extra: entry.extra };
    });
  };
  const luckyTile = source.luckyTile;
  if (!Array.isArray(luckyTile) || luckyTile.length > 25) throw new Error("leaderboard read model payload is invalid");
  return {
    biggestSingleWin: decodeEntries("biggestSingleWin"),
    luckiest: decodeEntries("luckiest"),
    oneTileWonder: decodeEntries("oneTileWonder"),
    mostWins: decodeEntries("mostWins"),
    whales: decodeEntries("whales"),
    underdog: decodeEntries("underdog"),
    luckyTile: luckyTile.map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("leaderboard read model payload is invalid");
      const entry = row as Record<string, unknown>;
      if (typeof entry.tileId !== "number" || !Number.isSafeInteger(entry.tileId) || entry.tileId < 1 || entry.tileId > 25 ||
        typeof entry.wins !== "number" || !Number.isSafeInteger(entry.wins) || entry.wins < 0 ||
        typeof entry.pct !== "number" || !Number.isFinite(entry.pct)) {
        throw new Error("leaderboard read model payload is invalid");
      }
      return { tileId: Number(entry.tileId), wins: Number(entry.wins), pct: entry.pct };
    }),
  };
}

export function getLeaderboardReadModel() {
  if (isLeaderboardReadModelDirty()) throw new Error("Leaderboard read model source data is dirty");
  const record = db.prepare(`
    SELECT model_version, payload_json FROM ${SCOPED_LEADERBOARD_READ_MODEL_TABLE} WHERE scope = ?
  `).get(CURRENT_STORAGE_SCOPE) as LeaderboardReadModelRecord | undefined;
  if (record === undefined) throw new Error("leaderboard read model is unavailable");
  return decodeLeaderboardReadModelRecord(record);
}

function setLastIndexedBlockInTransaction(value: bigint) {
  if (value < 0n) {
    throw new Error("last indexed block metadata must be non-negative");
  }
  ensureGlobalStatsAggregateReadyInTransaction();
  const canonical = value.toString();
  setMetaValue("lastIndexedBlock", canonical);
  synchronizeGlobalStatsAggregateAfterSourceMutationInTransaction({ lastIndexedBlock: canonical });
}

function purgeScopedContractData(exceptScope: string) {
  const scopedTables = [
    SCOPED_EPOCHS_TABLE,
    SCOPED_BETS_TABLE,
    SCOPED_JACKPOTS_TABLE,
    SCOPED_REWARD_CLAIMS_TABLE,
    SCOPED_USER_ACTIVITY_TABLE,
    SCOPED_PROTOCOL_FEE_FLUSHES_TABLE,
    SCOPED_GLOBAL_STATS_AGGREGATE_TABLE,
    SCOPED_GLOBAL_STATS_DIRTY_TABLE,
    SCOPED_LEADERBOARD_READ_MODEL_TABLE,
    SCOPED_LEADERBOARD_DIRTY_TABLE,
    SCOPED_INDEXER_EVENTS_TABLE,
    SCOPED_INDEXER_BLOCK_CHECKPOINTS_TABLE,
  ];

  runInTransaction(() => {
    for (const table of scopedTables) {
      db.prepare(`DELETE FROM ${table} WHERE scope <> ?`).run(exceptScope);
    }

    db.prepare(`
      DELETE FROM meta
      WHERE (
        key GLOB 'mainnet:0x*:*'
        OR key GLOB 'sepolia:0x*:*'
      ) AND key NOT GLOB ?
    `).run(`${exceptScope}:*`);

    for (const key of LEGACY_CONTRACT_META_KEYS) {
      db.prepare("DELETE FROM meta WHERE key = ?").run(key);
    }

    db.prepare("DELETE FROM epochs").run();
    db.prepare("DELETE FROM bets").run();
    db.prepare("DELETE FROM jackpots").run();
    db.prepare("DELETE FROM reward_claims").run();
    db.prepare("DELETE FROM protocol_fee_flushes").run();
    bumpPublicReadModelRevision();
  }, "purge_scoped_contract_data");
}

function purgeLegacyScopedDbFiles(currentDbPath: string) {
  const currentBase = basename(currentDbPath);
  const dbDir = dirname(currentDbPath);
  let removedCount = 0;

  let entries: string[] = [];
  try {
    entries = readdirSync(dbDir);
  } catch {
    return removedCount;
  }

  const currentArtifacts = new Set([currentBase, `${currentBase}-shm`, `${currentBase}-wal`]);
  for (const entry of entries) {
    if (currentArtifacts.has(entry)) continue;
    if (!/^lore-v\d+\.sqlite(?:-(?:shm|wal))?$/.test(entry)) continue;
    try {
      rmSync(join(dbDir, entry), { force: true });
      removedCount += 1;
    } catch (error) {
      const details = describeStorageError(error);
      console.warn(`[storage] Failed to remove non-current DB artifact ${entry}: ${details.name}: ${details.message}`);
    }
  }

  return removedCount;
}

function isContractScopePurgeAllowed() {
  const normalized = process.env[CONTRACT_SCOPE_PURGE_ENV]?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function hasForeignScopedContractData(exceptScope: string) {
  const scopedTables = [
    SCOPED_EPOCHS_TABLE,
    SCOPED_BETS_TABLE,
    SCOPED_JACKPOTS_TABLE,
    SCOPED_REWARD_CLAIMS_TABLE,
    SCOPED_USER_ACTIVITY_TABLE,
    SCOPED_PROTOCOL_FEE_FLUSHES_TABLE,
    SCOPED_GLOBAL_STATS_AGGREGATE_TABLE,
    SCOPED_GLOBAL_STATS_DIRTY_TABLE,
    SCOPED_LEADERBOARD_READ_MODEL_TABLE,
    SCOPED_LEADERBOARD_DIRTY_TABLE,
    SCOPED_INDEXER_EVENTS_TABLE,
    SCOPED_INDEXER_BLOCK_CHECKPOINTS_TABLE,
  ];

  for (const table of scopedTables) {
    const row = db.prepare(`SELECT 1 AS present FROM ${table} WHERE scope <> ? LIMIT 1`).get(exceptScope);
    if (row?.present === 1) return true;
  }

  const metaRow = db.prepare(`
    SELECT 1 AS present
    FROM meta
    WHERE (
      key GLOB 'mainnet:0x*:*'
      OR key GLOB 'sepolia:0x*:*'
    ) AND key NOT GLOB ?
    LIMIT 1
  `).get(`${exceptScope}:*`);

  return metaRow?.present === 1;
}

function reconcileContractStorageScope() {
  if (isDbShuttingDown()) return;

  const previousScope = getGlobalMetaValue(ACTIVE_CONTRACT_SCOPE_META_KEY);
  const foundForeignData = hasForeignScopedContractData(CURRENT_STORAGE_SCOPE);
  const scopeChanged = Boolean(previousScope && previousScope !== CURRENT_STORAGE_SCOPE);
  const purgeAllowed = isContractScopePurgeAllowed();
  if (previousScope === CURRENT_STORAGE_SCOPE && !foundForeignData && !purgeAllowed) return;

  if (purgeAllowed && scopeChanged) {
    purgeScopedContractData(CURRENT_STORAGE_SCOPE);
    console.warn(`[storage] Contract scope changed: ${previousScope} -> ${CURRENT_STORAGE_SCOPE}. Purged non-current contract data.`);
  } else if (purgeAllowed && foundForeignData) {
    purgeScopedContractData(CURRENT_STORAGE_SCOPE);
    console.warn(`[storage] Found stale contract-scoped data outside ${CURRENT_STORAGE_SCOPE}. Purged non-current contract data.`);
  } else if (scopeChanged || foundForeignData) {
    console.warn(
      `[storage] Contract scope changed or stale scoped data exists, but automatic purge is disabled. ` +
      `Set ${CONTRACT_SCOPE_PURGE_ENV}=1 only after backing up the DB if you intentionally want non-current contract data removed.`,
    );
  }

  if (purgeAllowed) {
    const removedLegacyDbFiles = purgeLegacyScopedDbFiles(dbPath);
    if (removedLegacyDbFiles > 0) {
      console.warn(`[storage] Removed ${removedLegacyDbFiles} non-current DB artifact(s).`);
    }
  }

  setGlobalMetaValue(ACTIVE_CONTRACT_SCOPE_META_KEY, CURRENT_STORAGE_SCOPE);
}

reconcileContractStorageScope();
ensureGlobalStatsAggregate();
ensureLeaderboardReadModel();

export function getMetaJson<T>(key: string): T | null {
  const raw = getMetaValue(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.warn("[storage] Invalid JSON metadata value");
    return null;
  }
}

export function readMetaJsonStrict<T>(key: string):
  | { found: false }
  | { found: true; value: T } {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(scopeMetaKey(key));
  if (!row) return { found: false };
  if (typeof row.value !== "string") {
    throw new Error("stored metadata value is not text");
  }
  try {
    return { found: true, value: JSON.parse(row.value) as T };
  } catch {
    throw new Error("stored metadata JSON is invalid");
  }
}

export function getMetaJsonStrict<T>(key: string): T | null {
  const result = readMetaJsonStrict<T>(key);
  return result.found ? result.value : null;
}

export function setMetaJson(key: string, value: unknown) {
  setMetaValue(key, JSON.stringify(value));
}

const KEEPER_DAILY_BUDGET_META_PREFIX = "keeper:daily-budget:v1";
const UTC_DAY_MS = 86_400_000;

type KeeperDailyBudgetReservation = {
  epoch: string;
  signingIntentHash: string;
  reservedMaxCostWei: string;
  reservedAt: number;
};

type KeeperDailyBudgetState = {
  version: 1;
  chainId: number;
  contractAddress: string;
  utcDay: number;
  reservedSignatureCount: number;
  reservedMaxCostWei: string;
  reservations: Record<string, KeeperDailyBudgetReservation>;
};

export type KeeperDailyBudgetReservationInput = {
  chainId: number;
  contractAddress: string;
  signerAddress: string;
  nonce: number;
  epoch: bigint;
  signingIntentHash: string;
  reservedMaxCostWei: bigint;
  nowMs?: number;
  policy: {
    maxSignatures: number;
    maxReservedCostWei: bigint;
  };
};

export type KeeperDailyBudgetReservationResult = {
  status: "reserved" | "already_reserved";
  utcDay: number;
  reservedSignatureCount: number;
  reservedMaxCostWei: bigint;
};

function keeperDailyBudgetError(message: string) {
  const error = new Error(`keeper daily budget ${message}`);
  error.name = "KeeperDailyBudgetError";
  return error;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeKeeperBudgetAddress(value: string, label: string) {
  const normalized = value.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
    throw keeperDailyBudgetError(`input invalid field=${label}`);
  }
  return normalized;
}

function parseCanonicalStoredBigInt(
  value: unknown,
  options: { positive: boolean },
) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) return null;
  const parsed = BigInt(value);
  if (options.positive && parsed <= 0n) return null;
  return parsed;
}

function parseKeeperDailyBudgetState(
  raw: string,
  expected: { chainId: number; contractAddress: string; utcDay: number },
): KeeperDailyBudgetState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw keeperDailyBudgetError("state invalid; manual reconciliation required");
  }
  if (!isJsonRecord(parsed) || !isJsonRecord(parsed.reservations)) {
    throw keeperDailyBudgetError("state invalid; manual reconciliation required");
  }
  if (
    parsed.version !== 1 ||
    parsed.chainId !== expected.chainId ||
    parsed.contractAddress !== expected.contractAddress ||
    parsed.utcDay !== expected.utcDay ||
    !Number.isSafeInteger(parsed.reservedSignatureCount) ||
    Number(parsed.reservedSignatureCount) < 0
  ) {
    throw keeperDailyBudgetError("state invalid; manual reconciliation required");
  }

  const storedTotal = parseCanonicalStoredBigInt(parsed.reservedMaxCostWei, {
    positive: false,
  });
  if (storedTotal === null) {
    throw keeperDailyBudgetError("state invalid; manual reconciliation required");
  }

  const reservations: Record<string, KeeperDailyBudgetReservation> = {};
  let computedTotal = 0n;
  for (const [reservationKey, rawReservation] of Object.entries(parsed.reservations)) {
    const keyMatch = /^(0x[0-9a-f]{40}):(0|[1-9]\d*)$/.exec(reservationKey);
    if (!keyMatch || !isJsonRecord(rawReservation)) {
      throw keeperDailyBudgetError("state invalid; manual reconciliation required");
    }
    const nonce = Number(keyMatch[2]);
    const cost = parseCanonicalStoredBigInt(rawReservation.reservedMaxCostWei, {
      positive: true,
    });
    if (
      !Number.isSafeInteger(nonce) ||
      nonce < 0 ||
      typeof rawReservation.epoch !== "string" ||
      !/^(?:0|[1-9]\d*)$/.test(rawReservation.epoch) ||
      typeof rawReservation.signingIntentHash !== "string" ||
      !/^0x[0-9a-f]{64}$/.test(rawReservation.signingIntentHash) ||
      cost === null ||
      !Number.isSafeInteger(rawReservation.reservedAt) ||
      Number(rawReservation.reservedAt) < 0 ||
      Math.floor(Number(rawReservation.reservedAt) / UTC_DAY_MS) !== expected.utcDay
    ) {
      throw keeperDailyBudgetError("state invalid; manual reconciliation required");
    }
    reservations[reservationKey] = {
      epoch: rawReservation.epoch,
      signingIntentHash: rawReservation.signingIntentHash,
      reservedMaxCostWei: cost.toString(),
      reservedAt: Number(rawReservation.reservedAt),
    };
    computedTotal += cost;
  }

  const reservationCount = Object.keys(reservations).length;
  if (
    reservationCount !== Number(parsed.reservedSignatureCount) ||
    computedTotal !== storedTotal
  ) {
    throw keeperDailyBudgetError("state invalid; manual reconciliation required");
  }

  return {
    version: 1,
    chainId: expected.chainId,
    contractAddress: expected.contractAddress,
    utcDay: expected.utcDay,
    reservedSignatureCount: reservationCount,
    reservedMaxCostWei: storedTotal.toString(),
    reservations,
  };
}

/**
 * Atomically reserves one keeper signing intent in the current contract scope.
 * Reservations are never released within their UTC window: a signed,
 * broadcast-unknown, reverted, or confirmed transaction all consumed keeper
 * authority and retain their maximum possible cost conservatively.
 */
export function reserveKeeperDailyBudget(
  input: KeeperDailyBudgetReservationInput,
): KeeperDailyBudgetReservationResult {
  const contractAddress = normalizeKeeperBudgetAddress(
    input.contractAddress,
    "contractAddress",
  );
  const signerAddress = normalizeKeeperBudgetAddress(
    input.signerAddress,
    "signerAddress",
  );
  const nowMs = input.nowMs ?? Date.now();
  if (
    !Number.isSafeInteger(input.chainId) ||
    input.chainId <= 0 ||
    !Number.isSafeInteger(input.nonce) ||
    input.nonce < 0 ||
    input.epoch < 0n ||
    typeof input.signingIntentHash !== "string" ||
    !/^0x[0-9a-f]{64}$/.test(input.signingIntentHash) ||
    input.reservedMaxCostWei <= 0n ||
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0 ||
    !Number.isSafeInteger(input.policy.maxSignatures) ||
    input.policy.maxSignatures <= 0 ||
    input.policy.maxReservedCostWei <= 0n ||
    input.reservedMaxCostWei > input.policy.maxReservedCostWei
  ) {
    throw keeperDailyBudgetError("input invalid");
  }

  const utcDay = Math.floor(nowMs / UTC_DAY_MS);
  const metaKey = [
    KEEPER_DAILY_BUDGET_META_PREFIX,
    input.chainId,
    contractAddress,
    utcDay,
  ].join(":");
  const reservationKey = `${signerAddress}:${input.nonce}`;
  const expectedState = { chainId: input.chainId, contractAddress, utcDay };

  return runInTransaction(() => {
    const rawState = getMetaValue(metaKey);
    const state = rawState === null
      ? {
          version: 1 as const,
          ...expectedState,
          reservedSignatureCount: 0,
          reservedMaxCostWei: "0",
          reservations: {},
        }
      : parseKeeperDailyBudgetState(rawState, expectedState);
    const storedCost = BigInt(state.reservedMaxCostWei);
    if (
      state.reservedSignatureCount > input.policy.maxSignatures ||
      storedCost > input.policy.maxReservedCostWei
    ) {
      throw keeperDailyBudgetError("stored usage exceeds active policy");
    }

    const existing = state.reservations[reservationKey];
    if (existing) {
      if (
        existing.epoch !== input.epoch.toString() ||
        existing.signingIntentHash !== input.signingIntentHash ||
        existing.reservedMaxCostWei !== input.reservedMaxCostWei.toString()
      ) {
        throw keeperDailyBudgetError("reservation conflict");
      }
      return {
        status: "already_reserved",
        utcDay,
        reservedSignatureCount: state.reservedSignatureCount,
        reservedMaxCostWei: storedCost,
      };
    }

    const nextSignatureCount = state.reservedSignatureCount + 1;
    if (nextSignatureCount > input.policy.maxSignatures) {
      throw keeperDailyBudgetError("signature count exhausted");
    }
    const nextReservedCost = storedCost + input.reservedMaxCostWei;
    if (nextReservedCost > input.policy.maxReservedCostWei) {
      throw keeperDailyBudgetError("reserved cost exhausted");
    }

    const nextState: KeeperDailyBudgetState = {
      ...state,
      reservedSignatureCount: nextSignatureCount,
      reservedMaxCostWei: nextReservedCost.toString(),
      reservations: {
        ...state.reservations,
        [reservationKey]: {
          epoch: input.epoch.toString(),
          signingIntentHash: input.signingIntentHash,
          reservedMaxCostWei: input.reservedMaxCostWei.toString(),
          reservedAt: nowMs,
        },
      },
    };
    setMetaValue(metaKey, JSON.stringify(nextState));
    return {
      status: "reserved",
      utcDay,
      reservedSignatureCount: nextSignatureCount,
      reservedMaxCostWei: nextReservedCost,
    };
  }, "keeper_daily_budget_reserve");
}

export function deleteMetaJson(key: string) {
  runWrite(() => {
    db.prepare("DELETE FROM meta WHERE key = ?").run(scopeMetaKey(key));
  }, "delete_meta_json");
}

function getMetaJsonMap<T extends JsonMap>(key: string): T {
  const value = getMetaJson<T>(key);
  return value && typeof value === "object" ? value : ({} as T);
}

function patchMetaJsonMap(key: string, patch: JsonMap) {
  const current = getMetaJsonMap<JsonMap>(key);
  setMetaJson(key, {
    ...current,
    ...patch,
  });
}

export function getMetaNumber(key: string) {
  const raw = getMetaValue(key);
  if (raw == null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function getMetaBigInt(key: string) {
  const raw = getMetaValue(key);
  if (raw == null) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

export function setMetaNumber(key: string, value: number) {
  if (key === "lastIndexedBlock") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("last indexed block metadata must be a non-negative safe integer");
    }
    setMetaBigInt(key, BigInt(value));
    return;
  }
  setMetaValue(key, String(value));
}

export function setMetaBigInt(key: string, value: bigint) {
  if (key === "lastIndexedBlock") {
    runInTransaction(() => {
      setLastIndexedBlockInTransaction(value);
      bumpPublicReadModelRevision();
    }, "set_indexed_block");
    return;
  }
  setMetaValue(key, value.toString());
}

export function getCurrentStorageScope() {
  return CURRENT_STORAGE_SCOPE;
}

function didStatementChangeRow(result: unknown) {
  const changes = (result as { changes?: number | bigint } | null)?.changes;
  return typeof changes === "bigint" ? changes > 0n : Number(changes ?? 0) > 0;
}

export function acquireIndexerLease(ownerToken: string, ttlMs: number) {
  const owner = validateIndexerLeaseOwnerToken(ownerToken);
  const ttl = validateIndexerLeaseTtlMs(ttlMs);
  return runInTransaction(() => {
    const now = Date.now();
    const result = db.prepare(`
      INSERT INTO ${SCOPED_INDEXER_LEASES_TABLE}(
        scope, owner_token, acquired_at, heartbeat_at, expires_at
      ) VALUES(?, ?, ?, ?, ?)
      ON CONFLICT(scope) DO UPDATE SET
        owner_token = excluded.owner_token,
        acquired_at = excluded.acquired_at,
        heartbeat_at = excluded.heartbeat_at,
        expires_at = excluded.expires_at
      WHERE ${SCOPED_INDEXER_LEASES_TABLE}.expires_at <= ?
         OR ${SCOPED_INDEXER_LEASES_TABLE}.owner_token = excluded.owner_token
    `).run(
      CURRENT_STORAGE_SCOPE,
      owner,
      now,
      now,
      now + ttl,
      now,
    );
    return didStatementChangeRow(result);
  }, "indexer_lease_acquire");
}

export function heartbeatIndexerLease(ownerToken: string, ttlMs: number) {
  const owner = validateIndexerLeaseOwnerToken(ownerToken);
  const ttl = validateIndexerLeaseTtlMs(ttlMs);
  return runInTransaction(() => {
    const now = Date.now();
    const result = db.prepare(`
      UPDATE ${SCOPED_INDEXER_LEASES_TABLE}
      SET heartbeat_at = ?, expires_at = ?
      WHERE scope = ?
        AND owner_token = ?
        AND expires_at > ?
    `).run(now, now + ttl, CURRENT_STORAGE_SCOPE, owner, now);
    return didStatementChangeRow(result);
  }, "indexer_lease_heartbeat");
}

export function releaseIndexerLease(ownerToken: string) {
  const owner = validateIndexerLeaseOwnerToken(ownerToken);
  return runInTransaction(() => {
    const result = db.prepare(`
      DELETE FROM ${SCOPED_INDEXER_LEASES_TABLE}
      WHERE scope = ? AND owner_token = ?
    `).run(CURRENT_STORAGE_SCOPE, owner);
    return didStatementChangeRow(result);
  }, "indexer_lease_release");
}

function assertIndexerLeaseOwner(ownerToken: string) {
  const owner = validateIndexerLeaseOwnerToken(ownerToken);
  const row = db.prepare(`
    SELECT 1 AS held
    FROM ${SCOPED_INDEXER_LEASES_TABLE}
    WHERE scope = ?
      AND owner_token = ?
      AND expires_at > ?
  `).get(CURRENT_STORAGE_SCOPE, owner, Date.now());
  if (row?.held !== 1) {
    throw new Error("indexer lease is unavailable or lost");
  }
}

function toSafeIndexerBlockNumber(value: bigint, label: string) {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} is outside the safe SQLite integer range`);
  }
  return Number(value);
}

function getStoredIndexerCheckpointHash(blockNumber: number) {
  const row = db.prepare(`
    SELECT block_hash
    FROM ${SCOPED_INDEXER_BLOCK_CHECKPOINTS_TABLE}
    WHERE scope = ? AND block_number = ?
  `).get(CURRENT_STORAGE_SCOPE, blockNumber);
  return typeof row?.block_hash === "string" ? row.block_hash : null;
}

export function getIndexerBlockCheckpoints(): IndexerBlockCheckpoint[] {
  const rows = db.prepare(`
    SELECT block_number, block_hash
    FROM ${SCOPED_INDEXER_BLOCK_CHECKPOINTS_TABLE}
    WHERE scope = ?
    ORDER BY block_number DESC
  `).all(CURRENT_STORAGE_SCOPE) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    blockNumber: String(row.block_number ?? ""),
    blockHash: String(row.block_hash ?? ""),
  }));
}

export function runIndexerStorageTransaction<T>(
  leaseOwnerToken: string,
  action: () => T,
): T {
  return runInTransaction(() => {
    assertIndexerLeaseOwner(leaseOwnerToken);
    return action();
  }, "indexer_mutation");
}

export function commitIndexerChunk(commit: IndexerChunkCommit, action: () => void) {
  const previousBlockNumber = toSafeIndexerBlockNumber(
    commit.expectedPreviousBlock,
    "expected previous indexer block",
  );
  const blockNumber = toSafeIndexerBlockNumber(commit.blockNumber, "indexer checkpoint block");
  if (blockNumber <= previousBlockNumber) {
    throw new Error("indexer checkpoint block must advance the cursor");
  }
  const blockHash = normalizeIndexerBlockHash(commit.blockHash);
  if (blockHash === null) {
    throw new Error("invalid indexer checkpoint block hash");
  }
  const previousBlockHash = commit.expectedPreviousBlockHash === null
    ? null
    : normalizeIndexerBlockHash(commit.expectedPreviousBlockHash);
  if (commit.expectedPreviousBlockHash !== null && previousBlockHash === null) {
    throw new Error("invalid previous indexer checkpoint block hash");
  }

  runInTransaction(() => {
    assertIndexerLeaseOwner(commit.leaseOwnerToken);
    const storedCursor = getMetaBigInt("lastIndexedBlock");
    if (storedCursor !== commit.expectedPreviousBlock) {
      throw new Error("indexer cursor changed before chunk commit");
    }
    const storedPreviousHash = normalizeIndexerBlockHash(
      getStoredIndexerCheckpointHash(previousBlockNumber),
    );
    if (previousBlockHash === null) {
      if (storedPreviousHash !== null) {
        throw new Error("indexer predecessor checkpoint changed before chunk commit");
      }
    } else if (storedPreviousHash !== previousBlockHash) {
      throw new Error("indexer predecessor checkpoint changed before chunk commit");
    }

    action();
    db.prepare(`
      INSERT INTO ${SCOPED_INDEXER_BLOCK_CHECKPOINTS_TABLE}(
        scope, block_number, block_hash
      ) VALUES(?, ?, ?)
      ON CONFLICT(scope, block_number) DO UPDATE SET
        block_hash = excluded.block_hash
    `).run(CURRENT_STORAGE_SCOPE, blockNumber, blockHash);
    setLastIndexedBlockInTransaction(BigInt(blockNumber));
    bumpPublicReadModelRevision();
  }, "indexer_chunk");
}

function pruneLegacyIndexerEventMeta(key: string, rollbackBlock: number) {
  const raw = getMetaValue(key);
  if (raw === null) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    db.prepare("DELETE FROM meta WHERE key = ?").run(scopeMetaKey(key));
    return;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    db.prepare("DELETE FROM meta WHERE key = ?").run(scopeMetaKey(key));
    return;
  }

  const retained: JsonMap = {};
  for (const [id, payload] of Object.entries(parsed as JsonMap)) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue;
    const eventBlock = parseSafeNonNegativeIntegerString(
      String((payload as JsonMap).blockNumber ?? ""),
    );
    if (eventBlock !== null && eventBlock <= rollbackBlock) {
      retained[id] = payload;
    }
  }
  setMetaValue(key, JSON.stringify(retained));
}

export function rollbackIndexerToBlock(
  rollbackBlock: bigint,
  retainedCheckpointHash: string | null,
  leaseOwnerToken: string,
) {
  const blockNumber = toSafeIndexerBlockNumber(rollbackBlock, "indexer rollback block");
  const normalizedRetainedHash = retainedCheckpointHash === null
    ? null
    : normalizeIndexerBlockHash(retainedCheckpointHash);
  if (retainedCheckpointHash !== null && normalizedRetainedHash === null) {
    throw new Error("invalid retained indexer checkpoint block hash");
  }

  runInTransaction(() => {
    assertIndexerLeaseOwner(leaseOwnerToken);
    if (normalizedRetainedHash !== null) {
      const storedHash = normalizeIndexerBlockHash(getStoredIndexerCheckpointHash(blockNumber));
      if (storedHash !== normalizedRetainedHash) {
        throw new Error("retained indexer checkpoint does not match storage");
      }
    }
    ensureGlobalStatsAggregateReadyInTransaction();
    ensureLeaderboardReadModelReadyInTransaction();

    db.prepare(`
      DELETE FROM ${SCOPED_EPOCHS_TABLE}
      WHERE scope = ? AND (resolved_block IS NULL OR resolved_block > ?)
    `)
      .run(CURRENT_STORAGE_SCOPE, blockNumber);
    db.prepare(`DELETE FROM ${SCOPED_BETS_TABLE} WHERE scope = ? AND block_number > ?`)
      .run(CURRENT_STORAGE_SCOPE, blockNumber);
    db.prepare(`DELETE FROM ${SCOPED_JACKPOTS_TABLE} WHERE scope = ? AND block_number > ?`)
      .run(CURRENT_STORAGE_SCOPE, blockNumber);
    db.prepare(`DELETE FROM ${SCOPED_REWARD_CLAIMS_TABLE} WHERE scope = ? AND block_number > ?`)
      .run(CURRENT_STORAGE_SCOPE, blockNumber);
    db.prepare(`DELETE FROM ${SCOPED_USER_ACTIVITY_TABLE} WHERE scope = ? AND block_number > ?`)
      .run(CURRENT_STORAGE_SCOPE, blockNumber);
    db.prepare(`DELETE FROM ${SCOPED_PROTOCOL_FEE_FLUSHES_TABLE} WHERE scope = ? AND block_number > ?`)
      .run(CURRENT_STORAGE_SCOPE, blockNumber);
    db.prepare(`DELETE FROM ${SCOPED_INDEXER_EVENTS_TABLE} WHERE scope = ? AND block_number > ?`)
      .run(CURRENT_STORAGE_SCOPE, blockNumber);
    db.prepare(`
      DELETE FROM ${SCOPED_INDEXER_BLOCK_CHECKPOINTS_TABLE}
      WHERE scope = ? AND block_number > ?
    `).run(CURRENT_STORAGE_SCOPE, blockNumber);
    if (normalizedRetainedHash === null) {
      db.prepare(`
        DELETE FROM ${SCOPED_INDEXER_BLOCK_CHECKPOINTS_TABLE}
        WHERE scope = ? AND block_number = ?
      `).run(CURRENT_STORAGE_SCOPE, blockNumber);
    }

    for (const key of [
      "gamedata:batchClaims",
      "gamedata:resolverRewards",
      "gamedata:dustSettlements",
    ]) {
      pruneLegacyIndexerEventMeta(key, blockNumber);
    }

    rebuildGlobalStatsAggregateInTransaction();
    rebuildLeaderboardReadModelInTransaction();
    setLastIndexedBlockInTransaction(BigInt(blockNumber));
    db.prepare("DELETE FROM meta WHERE key = ?")
      .run(scopeMetaKey("indexerReconcileBlockCursor"));
    const repairCursor = getMetaBigInt("repairCursorBlock");
    const nextRepairBlock = rollbackBlock + 1n;
    if (repairCursor === null || repairCursor > nextRepairBlock) {
      setMetaValue("repairCursorBlock", nextRepairBlock.toString());
    }
    bumpPublicReadModelRevision();
  }, "indexer_rollback");
}

export function getEpochMap() {
  const rows = db.prepare(`
    SELECT epoch, winning_tile, total_pool, reward_pool, fee, jackpot_bonus,
           is_daily_jackpot, is_weekly_jackpot, resolved_block
    FROM ${SCOPED_EPOCHS_TABLE}
    WHERE scope = ?
    ORDER BY epoch ASC
  `).all(CURRENT_STORAGE_SCOPE);

  const map: Record<string, EpochStorageRow> = {};
  for (const row of rows) {
    const epoch = String(row.epoch);
    map[epoch] = {
      winningTile: Number(row.winning_tile ?? 0),
      totalPool: String(row.total_pool ?? "0"),
      rewardPool: String(row.reward_pool ?? "0"),
      fee: row.fee == null ? undefined : String(row.fee),
      jackpotBonus: row.jackpot_bonus == null ? undefined : String(row.jackpot_bonus),
      isDailyJackpot: intToBool(row.is_daily_jackpot),
      isWeeklyJackpot: intToBool(row.is_weekly_jackpot),
      resolvedBlock: row.resolved_block == null ? undefined : String(row.resolved_block),
    };
  }
  return map;
}

export function getEpochMapByIds(epochIds: number[]) {
  const normalizedIds = [...new Set(
    epochIds.filter(isSafePositiveInteger),
  )];
  if (normalizedIds.length === 0) {
    return {} as Record<string, EpochStorageRow>;
  }

  const placeholders = normalizedIds.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT epoch, winning_tile, total_pool, reward_pool, fee, jackpot_bonus,
           is_daily_jackpot, is_weekly_jackpot, resolved_block
    FROM ${SCOPED_EPOCHS_TABLE}
    WHERE scope = ? AND epoch IN (${placeholders})
    ORDER BY epoch ASC
  `).all(CURRENT_STORAGE_SCOPE, ...normalizedIds) as Array<Record<string, unknown>>;

  const map: Record<string, EpochStorageRow> = {};
  for (const row of rows) {
    const epoch = String(row.epoch);
    map[epoch] = {
      winningTile: Number(row.winning_tile ?? 0),
      totalPool: String(row.total_pool ?? "0"),
      rewardPool: String(row.reward_pool ?? "0"),
      fee: row.fee == null ? undefined : String(row.fee),
      jackpotBonus: row.jackpot_bonus == null ? undefined : String(row.jackpot_bonus),
      isDailyJackpot: intToBool(row.is_daily_jackpot),
      isWeeklyJackpot: intToBool(row.is_weekly_jackpot),
      resolvedBlock: row.resolved_block == null ? undefined : String(row.resolved_block),
    };
  }
  return map;
}

export function upsertEpochMap(rows: Record<string, EpochStorageRow>) {
  const entries = Object.entries(rows);
  if (entries.length === 0) return;

  const existingStatement = db.prepare(`
    SELECT 1 AS present
    FROM ${SCOPED_EPOCHS_TABLE}
    WHERE scope = ? AND epoch = ?
  `);
  const statement = db.prepare(`
    INSERT INTO ${SCOPED_EPOCHS_TABLE}(
      scope, epoch, winning_tile, total_pool, reward_pool, fee, jackpot_bonus,
      is_daily_jackpot, is_weekly_jackpot, resolved_block
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope, epoch) DO UPDATE SET
      winning_tile = excluded.winning_tile,
      total_pool = excluded.total_pool,
      reward_pool = excluded.reward_pool,
      fee = excluded.fee,
      jackpot_bonus = excluded.jackpot_bonus,
      is_daily_jackpot = excluded.is_daily_jackpot,
      is_weekly_jackpot = excluded.is_weekly_jackpot,
      resolved_block = COALESCE(excluded.resolved_block, ${SCOPED_EPOCHS_TABLE}.resolved_block)
    WHERE ${SCOPED_EPOCHS_TABLE}.resolved_block IS NULL
       OR (excluded.resolved_block IS NOT NULL AND excluded.resolved_block >= ${SCOPED_EPOCHS_TABLE}.resolved_block)
  `);

  runInTransaction(() => {
    const readiness = ensureGlobalStatsAggregateReadyInTransaction();
    const leaderboardReadiness = ensureLeaderboardReadModelReadyInTransaction();
    let changed = false;
    let epochCountDelta = 0;
    for (const [epoch, row] of entries) {
      const epochNumber = parseSafePositiveIntegerString(epoch);
      const resolvedBlockNumber = row.resolvedBlock == null
        ? null
        : parseSafePositiveIntegerString(row.resolvedBlock);
      if (epochNumber === null) continue;
      const existed = existingStatement.get(CURRENT_STORAGE_SCOPE, epochNumber) !== undefined;
      const accepted = didStatementChangeRow(statement.run(
        CURRENT_STORAGE_SCOPE,
        epochNumber,
        row.winningTile,
        row.totalPool,
        row.rewardPool,
        row.fee ?? null,
        row.jackpotBonus ?? null,
        boolToInt(row.isDailyJackpot),
        boolToInt(row.isWeeklyJackpot),
        resolvedBlockNumber,
      ));
      if (accepted && !existed) epochCountDelta += 1;
      changed = accepted || changed;
    }
    const aggregateChanged = finalizeGlobalStatsAggregateAfterRawMutationInTransaction(
      { epochCount: epochCountDelta },
      changed,
    );
    const leaderboardChanged = finalizeLeaderboardReadModelAfterRawMutationInTransaction(changed);
    if (aggregateChanged || leaderboardChanged || readiness.needsRevisionBump || leaderboardReadiness.needsRevisionBump) {
      bumpPublicReadModelRevision();
    }
  }, "epochs");
}

export function normalizeIndexerLogIndex(value: unknown) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value === "bigint") {
    return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? value.toString() : null;
  }
  if (typeof value === "string") {
    const parsed = parseSafeNonNegativeIntegerString(value);
    return parsed === null ? null : String(parsed);
  }
  return null;
}

export function buildIndexerBetIdentity(
  epoch: string,
  txHash: string,
  blockNumber: string,
  logIndex?: unknown,
) {
  const normalizedHash = txHash.toLowerCase().trim();
  const legacyId = /^0x[0-9a-f]{64}$/.test(normalizedHash)
    ? `${epoch}_${normalizedHash}`
    : `${epoch}_nohash_${blockNumber}`;
  if (logIndex === undefined) {
    return { id: legacyId, legacyId };
  }
  const normalizedLogIndex = normalizeIndexerLogIndex(logIndex);
  if (normalizedLogIndex === null) return null;
  return {
    id: `${legacyId}_${normalizedLogIndex}`,
    legacyId,
  };
}

function readCanonicalBetLogIndex(row: Record<string, unknown>) {
  const id = String(row.id ?? "");
  const identity = buildIndexerBetIdentity(
    String(row.epoch ?? "0"),
    String(row.tx_hash ?? ""),
    String(row.block_number ?? "0"),
  );
  if (identity === null) return null;
  const prefix = `${identity.legacyId}_`;
  if (!id.startsWith(prefix)) return null;
  const normalizedLogIndex = normalizeIndexerLogIndex(id.slice(prefix.length));
  if (normalizedLogIndex === null || id !== `${identity.legacyId}_${normalizedLogIndex}`) {
    return null;
  }
  return normalizedLogIndex;
}

function mapBetRows(rows: Array<Record<string, unknown>>) {
  const map: Record<string, Omit<BetStorageRow, "user">> = {};
  for (const row of rows) {
    const id = String(row.id ?? "");
    if (!id) continue;
    const logIndex = readCanonicalBetLogIndex(row);
    map[id] = {
      epoch: String(row.epoch ?? "0"),
      tileIds: parseJsonArray<number>(row.tile_ids_json),
      amounts: parseJsonArray<string>(row.amounts_json),
      totalAmount: String(row.total_amount ?? "0"),
      totalAmountNum: Number(row.total_amount_num ?? 0),
      txHash: String(row.tx_hash ?? ""),
      blockNumber: String(row.block_number ?? "0"),
      ...(logIndex === null ? {} : { logIndex }),
    };
  }
  return map;
}

export function getUserBetsMap(user: string, limit?: number) {
  const normalized = normalizeWallet(user);
  const rows = (
    limit
      ? db.prepare(`
          SELECT id, epoch, tile_ids_json, amounts_json, total_amount, total_amount_num, tx_hash, block_number
          FROM ${SCOPED_BETS_TABLE}
          WHERE scope = ? AND user = ?
          ORDER BY epoch DESC, block_number DESC, id DESC
          LIMIT ?
        `).all(CURRENT_STORAGE_SCOPE, normalized, limit)
      : db.prepare(`
          SELECT id, epoch, tile_ids_json, amounts_json, total_amount, total_amount_num, tx_hash, block_number
          FROM ${SCOPED_BETS_TABLE}
          WHERE scope = ? AND user = ?
          ORDER BY epoch DESC, block_number DESC, id DESC
        `).all(CURRENT_STORAGE_SCOPE, normalized)
  ) as Array<Record<string, unknown>>;

  return mapBetRows(rows);
}

export function getUserParticipatingEpochs(user: string, limit?: number) {
  const normalized = normalizeWallet(user);
  const rows = (
    limit
      ? db.prepare(`
          SELECT DISTINCT epoch
          FROM ${SCOPED_BETS_TABLE}
          WHERE scope = ? AND user = ?
          ORDER BY epoch DESC
          LIMIT ?
        `).all(CURRENT_STORAGE_SCOPE, normalized, limit)
      : db.prepare(`
          SELECT DISTINCT epoch
          FROM ${SCOPED_BETS_TABLE}
          WHERE scope = ? AND user = ?
          ORDER BY epoch DESC
        `).all(CURRENT_STORAGE_SCOPE, normalized)
  ) as Array<Record<string, unknown>>;

  return rows
    .map((row) => parseSafePositiveIntegerString(String(row.epoch ?? "")))
    .filter((epoch): epoch is number => epoch !== null);
}

export function getUserParticipatingEpochPage(
  user: string,
  options?: { beforeEpoch?: number | null; limit?: number },
) {
  const normalized = normalizeWallet(user);
  const beforeEpoch = options?.beforeEpoch;
  const limit = normalizePageLimit(options?.limit, 200, 400);
  const rows = (
    isSafePositiveInteger(beforeEpoch ?? 0)
      ? db.prepare(`
          SELECT DISTINCT epoch
          FROM ${SCOPED_BETS_TABLE}
          WHERE scope = ? AND user = ? AND epoch < ?
          ORDER BY epoch DESC
          LIMIT ?
        `).all(CURRENT_STORAGE_SCOPE, normalized, beforeEpoch, limit + 1)
      : db.prepare(`
          SELECT DISTINCT epoch
          FROM ${SCOPED_BETS_TABLE}
          WHERE scope = ? AND user = ?
          ORDER BY epoch DESC
          LIMIT ?
        `).all(CURRENT_STORAGE_SCOPE, normalized, limit + 1)
  ) as Array<Record<string, unknown>>;

  const epochs = rows
    .slice(0, limit)
    .map((row) => parseSafePositiveIntegerString(String(row.epoch ?? "")))
    .filter((epoch): epoch is number => epoch !== null);
  const hasMore = rows.length > limit;

  return {
    epochs,
    hasMore,
    nextCursor: hasMore && epochs.length > 0 ? epochs[epochs.length - 1] : null,
  };
}

export function getAllBetRows() {
  const rows = db.prepare(`
    SELECT user, epoch, tile_ids_json, amounts_json, total_amount, total_amount_num, tx_hash, block_number
    FROM ${SCOPED_BETS_TABLE}
    WHERE scope = ?
    ORDER BY epoch DESC, block_number DESC, id DESC
  `).all(CURRENT_STORAGE_SCOPE) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    user: String(row.user ?? ""),
    epoch: String(row.epoch ?? "0"),
    tileIds: parseJsonArray<number>(row.tile_ids_json),
    amounts: parseJsonArray<string>(row.amounts_json),
    totalAmount: String(row.total_amount ?? "0"),
    totalAmountNum: Number(row.total_amount_num ?? 0),
    txHash: String(row.tx_hash ?? ""),
    blockNumber: String(row.block_number ?? "0"),
  })) satisfies BetStorageRow[];
}

export function getGlobalStatsAggregate() {
  return readGlobalStatsAggregate();
}

export function getBetRowsByEpochs(epochIds: number[]) {
  const normalizedIds = [...new Set(
    epochIds.filter(isSafePositiveInteger),
  )];
  if (normalizedIds.length === 0) return [] satisfies BetStorageRow[];

  const placeholders = normalizedIds.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT user, epoch, tile_ids_json, amounts_json, total_amount, total_amount_num, tx_hash, block_number
    FROM ${SCOPED_BETS_TABLE}
    WHERE scope = ? AND epoch IN (${placeholders})
    ORDER BY epoch DESC, block_number DESC, id DESC
  `).all(CURRENT_STORAGE_SCOPE, ...normalizedIds) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    user: String(row.user ?? ""),
    epoch: String(row.epoch ?? "0"),
    tileIds: parseJsonArray<number>(row.tile_ids_json),
    amounts: parseJsonArray<string>(row.amounts_json),
    totalAmount: String(row.total_amount ?? "0"),
    totalAmountNum: Number(row.total_amount_num ?? 0),
    txHash: String(row.tx_hash ?? ""),
    blockNumber: String(row.block_number ?? "0"),
  })) satisfies BetStorageRow[];
}

export function getBetJackpotContributionsWeiAfterBlocks(dailyBlockNumber: bigint, weeklyBlockNumber: bigint) {
  const minBlockNumber = dailyBlockNumber < weeklyBlockNumber ? dailyBlockNumber : weeklyBlockNumber;
  const rows = db.prepare(`
    SELECT total_amount, block_number
    FROM ${SCOPED_BETS_TABLE}
    WHERE scope = ? AND block_number > ?
  `).all(CURRENT_STORAGE_SCOPE, Number(minBlockNumber)) as Array<Record<string, unknown>>;

  let dailyWei = 0n;
  let weeklyWei = 0n;
  for (const row of rows) {
    const rowBlockNumber = BigInt(String(row.block_number ?? "0"));
    const totalWei = parseAmountWei(row.total_amount);
    if (totalWei <= 0n) continue;
    if (rowBlockNumber > dailyBlockNumber) {
      dailyWei += totalWei / 50n;
    }
    if (rowBlockNumber > weeklyBlockNumber) {
      weeklyWei += (totalWei * 3n) / 100n;
    }
  }

  return { dailyWei, weeklyWei };
}

export function getEpochTileUserSets(epoch: number, gridSize = 25) {
  const perTile = Array.from({ length: gridSize }, () => new Set<string>());
  if (!isSafePositiveInteger(epoch)) {
    return perTile;
  }

  const rows = db.prepare(`
    SELECT user, tile_ids_json
    FROM ${SCOPED_BETS_TABLE}
    WHERE scope = ? AND epoch = ?
    ORDER BY block_number ASC, id ASC
  `).all(CURRENT_STORAGE_SCOPE, epoch) as Array<Record<string, unknown>>;

  for (const row of rows) {
    const user = normalizeWallet(String(row.user ?? ""));
    if (!user) continue;
    const tileIds = parseJsonArray<number>(row.tile_ids_json);
    for (const tileId of tileIds) {
      const tileIdx = Number(tileId) - 1;
      if (tileIdx >= 0 && tileIdx < gridSize) {
        perTile[tileIdx].add(user);
      }
    }
  }

  return perTile;
}

export function getEpochTileUserCounts(epoch: number, gridSize = 25) {
  const perTile = getEpochTileUserSets(epoch, gridSize);
  return perTile.map((set) => set.size);
}

export function getEpochTilePoolsWei(epoch: number, gridSize = 25) {
  if (!isSafePositiveInteger(epoch)) {
    return Array.from({ length: gridSize }, () => 0n);
  }

  const rows = db.prepare(`
    SELECT tile_ids_json, amounts_json, total_amount
    FROM ${SCOPED_BETS_TABLE}
    WHERE scope = ? AND epoch = ?
    ORDER BY block_number ASC, id ASC
  `).all(CURRENT_STORAGE_SCOPE, epoch) as Array<Record<string, unknown>>;

  const perTile = Array.from({ length: gridSize }, () => 0n);
  for (const row of rows) {
    const tileIds = parseJsonArray<number>(row.tile_ids_json);
    if (tileIds.length === 0) continue;

    const amounts = parseJsonArray<string>(row.amounts_json);
    if (amounts.length === tileIds.length) {
      for (let index = 0; index < tileIds.length; index += 1) {
        const tileIdx = Number(tileIds[index]) - 1;
        if (tileIdx < 0 || tileIdx >= gridSize) continue;
        perTile[tileIdx] += parseAmountWei(amounts[index]);
      }
      continue;
    }

    const totalWei = parseAmountWei(String(row.total_amount ?? "0"));
    if (totalWei <= 0n) continue;
    const validTileIdxs = tileIds
      .map((tileId) => Number(tileId) - 1)
      .filter((tileIdx) => tileIdx >= 0 && tileIdx < gridSize);
    if (validTileIdxs.length === 0) continue;
    const sharedWei = totalWei / BigInt(validTileIdxs.length);
    const remainder = totalWei % BigInt(validTileIdxs.length);
    for (let i = 0; i < validTileIdxs.length; i += 1) {
      perTile[validTileIdxs[i]] += sharedWei + (i === 0 ? remainder : 0n);
    }
  }

  return perTile;
}

function normalizeCanonicalActivityEventId(value: string) {
  const normalized = value.trim().toLowerCase();
  const canonicalBet = /^[1-9]\d*_0x[0-9a-f]{64}_\d+$/.test(normalized);
  const canonicalLog = /^0x[0-9a-f]{64}:\d+$/.test(normalized);
  return canonicalBet || canonicalLog ? normalized : null;
}

function normalizeActivityTxHash(value: string) {
  const normalized = value.trim().toLowerCase();
  return /^0x[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

function encodeUserActivityCursor(blockNumber: string, eventId: string) {
  return Buffer.from(JSON.stringify({ b: blockNumber, i: eventId }), "utf8").toString("base64url");
}

export function decodeUserActivityCursor(value: string | null | undefined) {
  if (!value || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    const blockNumber = typeof parsed.b === "string" ? parseSafePositiveIntegerString(parsed.b) : null;
    const eventId = typeof parsed.i === "string" ? normalizeCanonicalActivityEventId(parsed.i) : null;
    return blockNumber === null || eventId === null ? null : { blockNumber, eventId };
  } catch {
    return null;
  }
}

export function upsertUserActivity(rows: UserActivityStorageRow[]) {
  if (rows.length === 0) return;
  const statement = db.prepare(`
    INSERT INTO ${SCOPED_USER_ACTIVITY_TABLE}(
      scope, event_id, user, activity_type, epoch, amount, amount_num, tx_hash, block_number
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope, event_id) DO UPDATE SET
      user = excluded.user,
      activity_type = excluded.activity_type,
      epoch = excluded.epoch,
      amount = excluded.amount,
      amount_num = excluded.amount_num,
      tx_hash = excluded.tx_hash,
      block_number = excluded.block_number
    WHERE excluded.block_number >= ${SCOPED_USER_ACTIVITY_TABLE}.block_number
  `);
  runInTransaction(() => {
    for (const row of rows) {
      const eventId = normalizeCanonicalActivityEventId(row.eventId);
      const txHash = normalizeActivityTxHash(row.txHash);
      const epoch = row.epoch === undefined ? null : parseSafePositiveIntegerString(row.epoch);
      const blockNumber = parseSafePositiveIntegerString(row.blockNumber);
      let user: string;
      try {
        user = getAddress(row.user.trim().replace(/^0X/, "0x")).toLowerCase();
      } catch {
        continue;
      }
      if (eventId === null || txHash === null || blockNumber === null || !USER_ACTIVITY_TYPES.has(row.activityType) ||
        typeof row.amount !== "string" || row.amount.length === 0 || row.amount.length > 128 ||
        !Number.isFinite(row.amountNum) || (row.epoch !== undefined && epoch === null)) continue;
      statement.run(
        CURRENT_STORAGE_SCOPE,
        eventId,
        user,
        row.activityType,
        epoch,
        row.amount,
        row.amountNum,
        txHash,
        blockNumber,
      );
    }
  }, "user_activity");
}

export function getUserActivityPage(
  user: string,
  options?: { cursor?: string | null; limit?: number },
): UserActivityPage {
  let normalizedUser: string;
  try {
    normalizedUser = getAddress(user.trim().replace(/^0X/, "0x")).toLowerCase();
  } catch {
    return { rows: [], hasMore: false, nextCursor: null, coverage: "partial", indexedThroughBlock: "0" };
  }
  const limit = normalizePageLimit(options?.limit, 32, 64);
  const cursor = decodeUserActivityCursor(options?.cursor);
  const rows = (cursor
    ? db.prepare(`
        SELECT event_id, user, activity_type, epoch, amount, amount_num, tx_hash, block_number
        FROM ${SCOPED_USER_ACTIVITY_TABLE}
        WHERE scope = ? AND user = ?
          AND (block_number < ? OR (block_number = ? AND event_id < ?))
        ORDER BY block_number DESC, event_id DESC
        LIMIT ?
      `).all(CURRENT_STORAGE_SCOPE, normalizedUser, cursor.blockNumber, cursor.blockNumber, cursor.eventId, limit + 1)
    : db.prepare(`
        SELECT event_id, user, activity_type, epoch, amount, amount_num, tx_hash, block_number
        FROM ${SCOPED_USER_ACTIVITY_TABLE}
        WHERE scope = ? AND user = ?
        ORDER BY block_number DESC, event_id DESC
        LIMIT ?
      `).all(CURRENT_STORAGE_SCOPE, normalizedUser, limit + 1)
  ) as Array<Record<string, unknown>>;
  const pageRows = rows.slice(0, limit).flatMap((row) => {
    const eventId = normalizeCanonicalActivityEventId(String(row.event_id ?? ""));
    const txHash = normalizeActivityTxHash(String(row.tx_hash ?? ""));
    const blockNumber = parseSafePositiveIntegerString(String(row.block_number ?? ""));
    const epochValue = row.epoch == null ? undefined : parseSafePositiveIntegerString(String(row.epoch));
    const activityType = row.activity_type as UserActivityType;
    if (eventId === null || txHash === null || blockNumber === null ||
      !USER_ACTIVITY_TYPES.has(activityType) ||
      (row.epoch != null && epochValue === null)) return [];
    return [{
      eventId,
      user: normalizedUser,
      activityType,
      ...(epochValue === undefined ? {} : { epoch: String(epochValue) }),
      amount: String(row.amount ?? "0"),
      amountNum: Number(row.amount_num ?? 0),
      txHash,
      blockNumber: String(blockNumber),
    } satisfies UserActivityStorageRow];
  });
  const tail = pageRows.at(-1);
  return {
    rows: pageRows,
    hasMore: rows.length > limit,
    nextCursor: rows.length > limit && tail ? encodeUserActivityCursor(tail.blockNumber, tail.eventId) : null,
    coverage: "partial",
    indexedThroughBlock: getCanonicalLastIndexedBlock(),
  };
}

export function upsertBets(rows: BetStorageRow[]) {
  if (rows.length === 0) return;
  const activityRows = rows.flatMap((row) => {
    const identity = buildIndexerBetIdentity(row.epoch, row.txHash, row.blockNumber, row.logIndex);
    if (identity === null || identity.id === identity.legacyId) return [];
    return [{
      eventId: identity.id,
      user: row.user,
      activityType: "bet" as const,
      epoch: row.epoch,
      amount: row.totalAmount,
      amountNum: row.totalAmountNum,
      txHash: row.txHash,
      blockNumber: row.blockNumber,
    } satisfies UserActivityStorageRow];
  });
  const migrateLegacyStatement = db.prepare(`
    UPDATE ${SCOPED_BETS_TABLE}
    SET id = ?
    WHERE scope = ?
      AND id = ?
      AND epoch = ?
      AND NOT EXISTS (
        SELECT 1
        FROM ${SCOPED_BETS_TABLE} AS canonical
        WHERE canonical.scope = ? AND canonical.id = ?
      )
  `);
  const statement = db.prepare(`
    INSERT INTO ${SCOPED_BETS_TABLE}(
      scope, id, user, epoch, tile_ids_json, amounts_json,
      total_amount, total_amount_num, tx_hash, block_number
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope, id) DO UPDATE SET
      user = excluded.user,
      epoch = excluded.epoch,
      tile_ids_json = excluded.tile_ids_json,
      amounts_json = excluded.amounts_json,
      total_amount = excluded.total_amount,
      total_amount_num = excluded.total_amount_num,
      tx_hash = excluded.tx_hash,
      block_number = excluded.block_number
    WHERE excluded.block_number >= ${SCOPED_BETS_TABLE}.block_number
  `);
  const previousAmountStatement = db.prepare(`
    SELECT total_amount
    FROM ${SCOPED_BETS_TABLE}
    WHERE scope = ? AND id = ?
  `);

  runInTransaction(() => {
    const readiness = ensureGlobalStatsAggregateReadyInTransaction();
    const leaderboardReadiness = ensureLeaderboardReadModelReadyInTransaction();
    let changed = false;
    let volumeWeiDelta = 0n;
    for (const row of rows) {
      const epochNumber = parseSafePositiveIntegerString(row.epoch);
      const blockNumber = parseSafePositiveIntegerString(row.blockNumber);
      if (epochNumber === null || blockNumber === null) continue;
      const identity = buildIndexerBetIdentity(
        row.epoch,
        row.txHash,
        row.blockNumber,
        row.logIndex,
      );
      if (identity === null) continue;
      if (identity.id !== identity.legacyId) {
        changed = didStatementChangeRow(migrateLegacyStatement.run(
          identity.id,
          CURRENT_STORAGE_SCOPE,
          identity.legacyId,
          epochNumber,
          CURRENT_STORAGE_SCOPE,
          identity.id,
        )) || changed;
      }
      const previous = previousAmountStatement.get(
        CURRENT_STORAGE_SCOPE,
        identity.id,
      ) as Record<string, unknown> | undefined;
      const accepted = didStatementChangeRow(statement.run(
        CURRENT_STORAGE_SCOPE,
        identity.id,
        normalizeWallet(row.user),
        epochNumber,
        JSON.stringify(row.tileIds),
        JSON.stringify(row.amounts ?? []),
        row.totalAmount,
        row.totalAmountNum,
        row.txHash,
        blockNumber,
      ));
      if (accepted) {
        volumeWeiDelta += parseGlobalStatsAmountWei(row.totalAmount) -
          parseGlobalStatsAmountWei(previous?.total_amount);
      }
      changed = accepted || changed;
    }
    const aggregateChanged = finalizeGlobalStatsAggregateAfterRawMutationInTransaction(
      { volumeWei: volumeWeiDelta },
      changed,
    );
    const leaderboardChanged = finalizeLeaderboardReadModelAfterRawMutationInTransaction(changed);
    if (aggregateChanged || leaderboardChanged || readiness.needsRevisionBump || leaderboardReadiness.needsRevisionBump) {
      bumpPublicReadModelRevision();
    }
    upsertUserActivity(activityRows);
  }, "bets");
}

export function buildIndexerJackpotIdentity(
  kind: JackpotStorageRow["kind"],
  epoch: string,
  txHash: string,
  logIndex?: unknown,
) {
  const legacyId = `${kind}_${epoch}`;
  if (logIndex === undefined) return { id: legacyId, legacyId };
  const normalizedTxHash = normalizeJackpotTxHash(txHash);
  const normalizedLogIndex = normalizeIndexerLogIndex(logIndex);
  if (normalizedTxHash === null || normalizedLogIndex === null) return null;
  return { id: `${normalizedTxHash}:${normalizedLogIndex}`, legacyId };
}

function normalizeJackpotTxHash(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return /^0x[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

function readCanonicalJackpotIdentity(row: Record<string, unknown>) {
  const identity = buildIndexerJackpotIdentity(
    row.kind === "weekly" ? "weekly" : "daily",
    String(row.epoch ?? "0"),
    String(row.tx_hash ?? ""),
    row.log_index,
  );
  const blockHash = normalizeIndexerBlockHash(String(row.block_hash ?? ""));
  const blockNumber = parseSafePositiveIntegerString(String(row.block_number ?? ""));
  const finalizedAtBlock = parseSafePositiveIntegerString(String(row.finalized_at_block ?? ""));
  if (
    identity === null ||
    identity.id === identity.legacyId ||
    String(row.id ?? "") !== identity.id ||
    blockHash === null ||
    blockNumber === null ||
    finalizedAtBlock === null ||
    finalizedAtBlock < blockNumber
  ) return null;
  return {
    eventId: identity.id,
    logIndex: normalizeIndexerLogIndex(row.log_index)!,
    blockHash,
    finalizedAtBlock: String(finalizedAtBlock),
  };
}
export function getJackpotsMap(limit?: number) {
  const rows = (
    limit
      ? db.prepare(`
          SELECT id, epoch, kind, amount, amount_num, tx_hash, block_number, log_index, block_hash, finalized_at_block
          FROM ${SCOPED_JACKPOTS_TABLE}
          WHERE scope = ?
          ORDER BY block_number DESC, id DESC
          LIMIT ?
        `).all(CURRENT_STORAGE_SCOPE, limit)
      : db.prepare(`
          SELECT id, epoch, kind, amount, amount_num, tx_hash, block_number, log_index, block_hash, finalized_at_block
          FROM ${SCOPED_JACKPOTS_TABLE}
          WHERE scope = ?
          ORDER BY block_number DESC, id DESC
        `).all(CURRENT_STORAGE_SCOPE)
  ) as Array<Record<string, unknown>>;

  const map: Record<string, JackpotStorageRow> = {};
  for (const row of rows.reverse()) {
    const id = String(row.id ?? "");
    if (!id) continue;
    map[id] = {
      epoch: String(row.epoch ?? "0"),
      kind: row.kind === "weekly" ? "weekly" : "daily",
      amount: String(row.amount ?? "0"),
      amountNum: Number(row.amount_num ?? 0),
      txHash: String(row.tx_hash ?? ""),
      blockNumber: String(row.block_number ?? "0"),
      ...(readCanonicalJackpotIdentity(row) ?? {}),
    };
  }
  return map;
}

export function getRecentJackpots(limit = 200) {
  const rows = db.prepare(`
    SELECT id, epoch, kind, amount, amount_num, tx_hash, block_number, log_index, block_hash, finalized_at_block
    FROM ${SCOPED_JACKPOTS_TABLE}
    WHERE scope = ?
    ORDER BY block_number DESC, id DESC
    LIMIT ?
  `).all(CURRENT_STORAGE_SCOPE, limit) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    epoch: String(row.epoch ?? "0"),
    kind: row.kind === "weekly" ? "weekly" : "daily",
    amount: String(row.amount ?? "0"),
    amountNum: Number(row.amount_num ?? 0),
    txHash: String(row.tx_hash ?? ""),
    blockNumber: String(row.block_number ?? "0"),
    ...(readCanonicalJackpotIdentity(row) ?? {}),
  })) satisfies JackpotStorageRow[];
}

export function upsertJackpots(rows: JackpotStorageRow[]) {
  if (rows.length === 0) return;
  const migrateLegacyStatement = db.prepare(`
    UPDATE ${SCOPED_JACKPOTS_TABLE}
    SET id = ?
    WHERE scope = ? AND id = ? AND epoch = ? AND kind = ?
      AND NOT EXISTS (
        SELECT 1 FROM ${SCOPED_JACKPOTS_TABLE} AS canonical
        WHERE canonical.scope = ? AND canonical.id = ?
      )
  `);
  const statement = db.prepare(`
    INSERT INTO ${SCOPED_JACKPOTS_TABLE}(
      scope, id, epoch, kind, amount, amount_num, tx_hash, block_number,
      log_index, block_hash, finalized_at_block
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope, id) DO UPDATE SET
      epoch = excluded.epoch,
      kind = excluded.kind,
      amount = excluded.amount,
      amount_num = excluded.amount_num,
      tx_hash = excluded.tx_hash,
      block_number = excluded.block_number,
      log_index = excluded.log_index,
      block_hash = excluded.block_hash,
      finalized_at_block = excluded.finalized_at_block
    WHERE excluded.block_number >= ${SCOPED_JACKPOTS_TABLE}.block_number
  `);

  runInTransaction(() => {
    let changed = false;
    for (const row of rows) {
      const epochNumber = parseSafePositiveIntegerString(row.epoch);
      const blockNumber = parseSafePositiveIntegerString(row.blockNumber);
      if (epochNumber === null || blockNumber === null) continue;
      const identity = buildIndexerJackpotIdentity(row.kind, row.epoch, row.txHash, row.logIndex);
      if (identity === null) continue;
      const blockHash = row.blockHash === undefined ? null : normalizeIndexerBlockHash(row.blockHash);
      const finalizedAtBlock = row.finalizedAtBlock === undefined
        ? null
        : parseSafePositiveIntegerString(row.finalizedAtBlock);
      const canonicalProof =
        identity.id !== identity.legacyId &&
        blockHash !== null &&
        finalizedAtBlock !== null &&
        finalizedAtBlock >= blockNumber;
      // A caller that supplied a log identity but not its canonical block and
      // finality proof must not create a shareable event.
      if (identity.id !== identity.legacyId && !canonicalProof) continue;
      if (canonicalProof) {
        changed = didStatementChangeRow(migrateLegacyStatement.run(
          identity.id,
          CURRENT_STORAGE_SCOPE,
          identity.legacyId,
          epochNumber,
          row.kind,
          CURRENT_STORAGE_SCOPE,
          identity.id,
        )) || changed;
      }
      changed = didStatementChangeRow(statement.run(
        CURRENT_STORAGE_SCOPE,
        identity.id,
        epochNumber,
        row.kind,
        row.amount,
        row.amountNum,
        row.txHash,
        blockNumber,
        canonicalProof ? Number(identity.id.slice(identity.id.lastIndexOf(":") + 1)) : null,
        canonicalProof ? blockHash : null,
        canonicalProof ? finalizedAtBlock : null,
      )) || changed;
    }
    if (changed) bumpPublicReadModelRevision();
  }, "jackpots");
}
export function upsertRewardClaims(rows: RewardClaimStorageRow[]) {
  if (rows.length === 0) return;
  const activityRows = rows.filter((row) => row.recordUserActivity !== false).map((row) => ({
    eventId: row.id,
    user: row.user,
    activityType: "reward_claim" as const,
    epoch: row.epoch,
    amount: row.reward,
    amountNum: row.rewardNum,
    txHash: row.txHash,
    blockNumber: row.blockNumber,
  } satisfies UserActivityStorageRow));
  const statement = db.prepare(`
    INSERT INTO ${SCOPED_REWARD_CLAIMS_TABLE}(scope, id, epoch, user, reward, reward_num, tx_hash, block_number)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope, id) DO UPDATE SET
      epoch = excluded.epoch,
      user = excluded.user,
      reward = excluded.reward,
      reward_num = excluded.reward_num,
      tx_hash = excluded.tx_hash,
      block_number = excluded.block_number
    WHERE excluded.block_number >= ${SCOPED_REWARD_CLAIMS_TABLE}.block_number
  `);

  runInTransaction(() => {
    const leaderboardReadiness = ensureLeaderboardReadModelReadyInTransaction();
    let changed = false;
    for (const row of rows) {
      const epochNumber = parseSafePositiveIntegerString(row.epoch);
      const blockNumber = parseSafePositiveIntegerString(row.blockNumber);
      if (epochNumber === null || blockNumber === null) continue;
      changed = didStatementChangeRow(statement.run(
        CURRENT_STORAGE_SCOPE,
        row.id,
        epochNumber,
        normalizeWallet(row.user),
        row.reward,
        row.rewardNum,
        row.txHash,
        blockNumber,
      )) || changed;
    }
    const leaderboardChanged = finalizeLeaderboardReadModelAfterRawMutationInTransaction(changed);
    if (leaderboardChanged || leaderboardReadiness.needsRevisionBump) bumpPublicReadModelRevision();
    upsertUserActivity(activityRows);
  }, "reward_claims");
}

export function getRecentRewardClaims(limit = 100) {
  const rows = db.prepare(`
    SELECT epoch, user, reward, reward_num, tx_hash, block_number
    FROM ${SCOPED_REWARD_CLAIMS_TABLE}
    WHERE scope = ?
    ORDER BY block_number DESC, id DESC
    LIMIT ?
  `).all(CURRENT_STORAGE_SCOPE, limit) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    epoch: String(row.epoch ?? "0"),
    user: String(row.user ?? ""),
    reward: String(row.reward ?? "0"),
    rewardNum: Number(row.reward_num ?? 0),
    txHash: String(row.tx_hash ?? ""),
    blockNumber: String(row.block_number ?? "0"),
  }));
}

export function getAllRewardClaims() {
  const rows = db.prepare(`
    SELECT id, epoch, user, reward, reward_num, tx_hash, block_number
    FROM ${SCOPED_REWARD_CLAIMS_TABLE}
    WHERE scope = ?
    ORDER BY epoch DESC, block_number DESC, id DESC
  `).all(CURRENT_STORAGE_SCOPE) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: String(row.id ?? ""),
    epoch: String(row.epoch ?? "0"),
    user: String(row.user ?? ""),
    reward: String(row.reward ?? "0"),
    rewardNum: Number(row.reward_num ?? 0),
    txHash: String(row.tx_hash ?? ""),
    blockNumber: String(row.block_number ?? "0"),
  })) satisfies RewardClaimStorageRow[];
}

export function upsertProtocolFeeFlushes(rows: FeeFlushStorageRow[]) {
  if (rows.length === 0) return;
  const statement = db.prepare(`
    INSERT INTO ${SCOPED_PROTOCOL_FEE_FLUSHES_TABLE}(scope, id, owner_amount, burn_amount, tx_hash, block_number)
    VALUES(?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope, id) DO UPDATE SET
      owner_amount = excluded.owner_amount,
      burn_amount = excluded.burn_amount,
      tx_hash = excluded.tx_hash,
      block_number = excluded.block_number
    WHERE excluded.block_number >= ${SCOPED_PROTOCOL_FEE_FLUSHES_TABLE}.block_number
  `);
  const previousBurnStatement = db.prepare(`
    SELECT burn_amount
    FROM ${SCOPED_PROTOCOL_FEE_FLUSHES_TABLE}
    WHERE scope = ? AND id = ?
  `);

  runInTransaction(() => {
    const readiness = ensureGlobalStatsAggregateReadyInTransaction();
    let changed = false;
    let burnWeiDelta = 0n;
    for (const row of rows) {
      const blockNumber = parseSafePositiveIntegerString(row.blockNumber);
      if (blockNumber === null) continue;
      const previous = previousBurnStatement.get(
        CURRENT_STORAGE_SCOPE,
        row.id,
      ) as Record<string, unknown> | undefined;
      const accepted = didStatementChangeRow(statement.run(
        CURRENT_STORAGE_SCOPE,
        row.id,
        row.ownerAmount,
        row.burnAmount,
        row.txHash,
        blockNumber,
      ));
      if (accepted) {
        burnWeiDelta += parseGlobalStatsAmountWei(row.burnAmount) -
          parseGlobalStatsAmountWei(previous?.burn_amount);
      }
      changed = accepted || changed;
    }
    const aggregateChanged = finalizeGlobalStatsAggregateAfterRawMutationInTransaction(
      { burnWei: burnWeiDelta },
      changed,
    );
    if (aggregateChanged || readiness.needsRevisionBump) bumpPublicReadModelRevision();
  }, "protocol_fee_flushes");
}

function normalizeOptionalIndexerEventLimit(value: number | null | undefined) {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return Math.min(value, 5_000);
}

function getIndexerEventMap(category: IndexerEventCategory, limitToLast?: number) {
  const limit = normalizeOptionalIndexerEventLimit(limitToLast);
  const rows = (limit === null
    ? db.prepare(`
        SELECT id, payload_json
        FROM ${SCOPED_INDEXER_EVENTS_TABLE}
        WHERE scope = ? AND category = ?
        ORDER BY block_number ASC, id ASC
      `).all(CURRENT_STORAGE_SCOPE, category)
    : db.prepare(`
        SELECT id, payload_json
        FROM ${SCOPED_INDEXER_EVENTS_TABLE}
        WHERE scope = ? AND category = ?
        ORDER BY block_number DESC, id DESC
        LIMIT ?
      `).all(CURRENT_STORAGE_SCOPE, category, limit).reverse()) as Array<Record<string, unknown>>;
  const result: JsonMap = {};
  for (const row of rows) {
    const id = String(row.id ?? "");
    if (!id) continue;
    try {
      result[id] = JSON.parse(String(row.payload_json ?? "{}"));
    } catch {
      console.warn("[storage] Invalid indexed event payload");
    }
  }
  return result;
}

function upsertIndexerEvents(category: IndexerEventCategory, records: JsonMap) {
  const statement = db.prepare(`
    INSERT INTO ${SCOPED_INDEXER_EVENTS_TABLE}(scope, category, id, payload_json, block_number)
    VALUES(?, ?, ?, ?, ?)
    ON CONFLICT(scope, category, id) DO UPDATE SET
      payload_json = excluded.payload_json,
      block_number = excluded.block_number
    WHERE excluded.block_number >= ${SCOPED_INDEXER_EVENTS_TABLE}.block_number
  `);
  runInTransaction(() => {
    for (const [id, payload] of Object.entries(records)) {
      if (!id || id.length > MAX_INDEXER_EVENT_ID_LENGTH) continue;
      if (!payload || typeof payload !== "object") continue;
      const blockNumber = parseSafePositiveIntegerString(String((payload as JsonMap).blockNumber ?? ""));
      if (blockNumber === null) continue;
      const payloadJson = stringifyBoundedIndexerEventPayload(payload as JsonMap);
      if (payloadJson === null) continue;
      statement.run(CURRENT_STORAGE_SCOPE, category, id, payloadJson, blockNumber);
    }
  }, "indexer_events");
}

export function getChatMessages(limit = MAX_CHAT_MESSAGES): ChatMessageRow[] {
  const rows = db.prepare(`
    SELECT id, sender, sender_name, sender_avatar, text, timestamp
    FROM chat_messages
    ORDER BY timestamp DESC, id DESC
    LIMIT ?
  `).all(limit) as Array<Record<string, unknown>>;

  return rows
    .reverse()
    .map((row) => ({
      id: String(row.id ?? ""),
      sender: String(row.sender ?? ""),
      senderName: row.sender_name == null ? null : String(row.sender_name),
      senderAvatar: row.sender_avatar == null ? null : String(row.sender_avatar),
      text: String(row.text ?? ""),
      timestamp: Number(row.timestamp ?? 0),
    }));
}

export function insertChatMessage(message: Omit<ChatMessageRow, "id">): ChatMessageRow {
  const insert = db.prepare(`
    INSERT INTO chat_messages(sender, sender_name, sender_avatar, text, timestamp)
    VALUES(?, ?, ?, ?, ?)
  `);
  const trim = db.prepare(`
    DELETE FROM chat_messages
    WHERE id NOT IN (
      SELECT id
      FROM chat_messages
      ORDER BY timestamp DESC, id DESC
      LIMIT ?
    )
  `);

  const sender = normalizeWallet(message.sender);
  let id = "";

  runInTransaction(() => {
    const result = insert.run(
      sender,
      message.senderName,
      message.senderAvatar,
      message.text,
      message.timestamp,
    ) as { lastInsertRowid: number | bigint };
    id = String(result.lastInsertRowid);
    trim.run(MAX_CHAT_MESSAGES);
  }, "chat_messages");

  return {
    id,
    sender,
    senderName: message.senderName,
    senderAvatar: message.senderAvatar,
    text: message.text,
    timestamp: message.timestamp,
  };
}

export function getChatProfile(wallet: string) {
  const row = db.prepare(`
    SELECT name, avatar, custom_avatar, updated_at
    FROM chat_profiles
    WHERE wallet = ?
  `).get(normalizeWallet(wallet));
  if (!row) return null;
  return {
    name: row.name == null ? null : String(row.name),
    avatar: row.avatar == null ? null : String(row.avatar),
    customAvatar: row.custom_avatar == null ? null : String(row.custom_avatar),
    updatedAt: Number(row.updated_at ?? 0),
  } satisfies ChatProfileRow;
}

export function getChatProfiles(wallets?: string[]) {
  const map: Record<string, ChatProfileRow> = {};

  if (wallets && wallets.length > 0) {
    const normalized = [...new Set(wallets.map(normalizeWallet).filter(Boolean))];
    if (normalized.length === 0) return map;
    const placeholders = normalized.map(() => "?").join(", ");
    const rows = db.prepare(`
      SELECT wallet, name, avatar, custom_avatar, updated_at
      FROM chat_profiles
      WHERE wallet IN (${placeholders})
    `).all(...normalized) as Array<Record<string, unknown>>;

    for (const row of rows) {
      const wallet = String(row.wallet ?? "");
      if (!wallet) continue;
      map[wallet] = {
        name: row.name == null ? null : String(row.name),
        avatar: row.avatar == null ? null : String(row.avatar),
        customAvatar: row.custom_avatar == null ? null : String(row.custom_avatar),
        updatedAt: Number(row.updated_at ?? 0),
      };
    }
    return map;
  }

  const rows = db.prepare(`
    SELECT wallet, name, avatar, custom_avatar, updated_at
    FROM chat_profiles
  `).all() as Array<Record<string, unknown>>;

  for (const row of rows) {
    const wallet = String(row.wallet ?? "");
    if (!wallet) continue;
    map[wallet] = {
      name: row.name == null ? null : String(row.name),
      avatar: row.avatar == null ? null : String(row.avatar),
      customAvatar: row.custom_avatar == null ? null : String(row.custom_avatar),
      updatedAt: Number(row.updated_at ?? 0),
    };
  }
  return map;
}

export function upsertChatProfile(wallet: string, profile: ChatProfileRow) {
  runInTransaction(() => {
    const result = db.prepare(`
      INSERT INTO chat_profiles(wallet, name, avatar, custom_avatar, updated_at)
      VALUES(?, ?, ?, ?, ?)
      ON CONFLICT(wallet) DO UPDATE SET
        name = excluded.name,
        avatar = excluded.avatar,
        custom_avatar = excluded.custom_avatar,
        updated_at = excluded.updated_at
    `).run(
      normalizeWallet(wallet),
      profile.name,
      profile.avatar,
      profile.customAvatar,
      profile.updatedAt,
    );
    if (didStatementChangeRow(result)) bumpPublicReadModelRevision();
  }, "chat_profile");
}

export function acquireExpiringLock(name: string, epoch: string, ttlMs: number) {
  const now = Date.now();
  const expiresAt = now + ttlMs;

  return runInTransaction(() => {
    db.prepare("DELETE FROM ephemeral_locks WHERE expires_at <= ?").run(now);

    const current = db.prepare(`
      SELECT epoch, expires_at
      FROM ephemeral_locks
      WHERE name = ?
    `).get(name);

    if (
      current &&
      String(current.epoch ?? "") === epoch &&
      Number(current.expires_at ?? 0) > now
    ) {
      return false;
    }

    db.prepare(`
      INSERT INTO ephemeral_locks(name, epoch, acquired_at, expires_at)
      VALUES(?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        epoch = excluded.epoch,
        acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at
    `).run(name, epoch, now, expiresAt);

    return true;
  }, "ephemeral_lock");
}

function assertAdminSessionStorageTimestamp(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

function adminSessionStorageChangedOneRow(result: unknown) {
  if (!result || typeof result !== "object" || !("changes" in result)) {
    throw new Error("admin session storage returned an invalid mutation result");
  }
  const changes = result.changes;
  if (changes !== 0 && changes !== 0n && changes !== 1 && changes !== 1n) {
    throw new Error("admin session storage changed an unexpected number of rows");
  }
  return changes === 1 || changes === 1n;
}

export function createLocalAdminSessionRecord(
  sessionKey: string,
  recordValue: string,
  expiresAt: number,
  now: number,
) {
  assertAdminSessionStorageTimestamp(expiresAt, "admin session expiry");
  assertAdminSessionStorageTimestamp(now, "admin session clock");
  if (expiresAt <= now) throw new Error("admin session expiry must be in the future");

  return runInTransaction(() => {
    db.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").run(now);
    const result = db.prepare(`
      INSERT INTO admin_sessions(scope, session_key, record_value, expires_at)
      VALUES(?, ?, ?, ?)
      ON CONFLICT(scope, session_key) DO NOTHING
    `).run(CURRENT_STORAGE_SCOPE, sessionKey, recordValue, expiresAt);
    return adminSessionStorageChangedOneRow(result);
  }, "admin_session_create");
}

export function readLocalAdminSessionRecord(sessionKey: string, now: number) {
  assertAdminSessionStorageTimestamp(now, "admin session clock");
  const row = db.prepare(`
    SELECT record_value
    FROM admin_sessions
    WHERE scope = ? AND session_key = ? AND expires_at > ?
  `).get(CURRENT_STORAGE_SCOPE, sessionKey, now);
  return typeof row?.record_value === "string" ? row.record_value : null;
}

export function rotateLocalAdminSessionRecord(
  sessionKey: string,
  previousValue: string,
  nextValue: string,
  expiresAt: number,
  now: number,
) {
  assertAdminSessionStorageTimestamp(expiresAt, "admin session expiry");
  assertAdminSessionStorageTimestamp(now, "admin session clock");
  if (expiresAt <= now) return false;

  const result = db.prepare(`
    UPDATE admin_sessions
    SET record_value = ?, expires_at = ?
    WHERE scope = ?
      AND session_key = ?
      AND record_value = ?
      AND expires_at > ?
  `).run(
    nextValue,
    expiresAt,
    CURRENT_STORAGE_SCOPE,
    sessionKey,
    previousValue,
    now,
  );
  return adminSessionStorageChangedOneRow(result);
}

export function deleteLocalAdminSessionRecord(sessionKey: string) {
  db.prepare(`
    DELETE FROM admin_sessions
    WHERE scope = ? AND session_key = ?
  `).run(CURRENT_STORAGE_SCOPE, sessionKey);
}

export function consumeRateLimit(bucket: string, key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const windowStartedAt = now - (now % windowMs);
  const resetAt = windowStartedAt + windowMs;

  return runInTransaction(() => {
    db.prepare(`
      DELETE FROM rate_limits
      WHERE reset_at <= ?
    `).run(now);

    const current = db.prepare(`
      SELECT count, window_started_at, reset_at
      FROM rate_limits
      WHERE bucket = ? AND limiter_key = ?
    `).get(bucket, key);

    const count =
      !current ||
      Number(current.reset_at ?? 0) <= now ||
      Number(current.window_started_at ?? 0) !== windowStartedAt
        ? 0
        : Number(current.count ?? 0);
    const activeResetAt =
      !current ||
      Number(current.reset_at ?? 0) <= now ||
      Number(current.window_started_at ?? 0) !== windowStartedAt
        ? resetAt
        : Number(current.reset_at ?? resetAt);

    if (count >= limit) {
      return {
        allowed: false as const,
        retryAfter: Math.max(1, Math.ceil((activeResetAt - now) / 1000)),
      };
    }

    db.prepare(`
      INSERT INTO rate_limits(bucket, limiter_key, count, window_started_at, reset_at)
      VALUES(?, ?, ?, ?, ?)
      ON CONFLICT(bucket, limiter_key) DO UPDATE SET
        count = excluded.count,
        window_started_at = excluded.window_started_at,
        reset_at = excluded.reset_at
    `).run(bucket, key, count + 1, windowStartedAt, resetAt);

    return { allowed: true as const };
  }, "rate_limit");
}

export function readJsonPath<T>(path: string, limitToLast?: number): T | null {
  if (path === "gamedata/epochs") {
    return getEpochMap() as T;
  }

  if (path === "gamedata/jackpots") {
    return getJackpotsMap(limitToLast) as T;
  }

  if (path === "gamedata/_meta/currentEpoch") {
    return getMetaNumber("currentEpoch") as T | null;
  }

  if (path === "gamedata/_meta/lastIndexedBlock") {
    const value = getMetaBigInt("lastIndexedBlock");
    return (value == null ? null : value.toString()) as T | null;
  }

  if (path === "gamedata/_meta/repairCursorBlock") {
    const value = getMetaBigInt("repairCursorBlock");
    return (value == null ? null : value.toString()) as T | null;
  }

  if (path === "gamedata/chatProfiles") {
    return getChatProfiles() as T;
  }

  if (path.startsWith("gamedata/chatProfiles/")) {
    const wallet = path.slice("gamedata/chatProfiles/".length);
    return getChatProfile(wallet) as T | null;
  }

  if (path.startsWith("gamedata/bets/")) {
    const user = path.slice("gamedata/bets/".length);
    return getUserBetsMap(user, limitToLast) as T;
  }

  if (path === "gamedata/epochLifecycle") {
    return getMetaJsonMap<T & JsonMap>("gamedata:epochLifecycle") as T;
  }

  const indexerEventCategory = INDEXER_EVENT_PATHS[path];
  if (indexerEventCategory) {
    const legacy = getMetaJsonMap<JsonMap>(path.replace("/", ":"));
    return { ...legacy, ...getIndexerEventMap(indexerEventCategory, limitToLast) } as T;
  }

  return null;
}

export function patchJsonPath(path: string, data: JsonMap) {
  if (path === "gamedata/epochs") {
    upsertEpochMap(data as Record<string, EpochStorageRow>);
    return;
  }

  if (path === "gamedata/jackpots") {
    upsertJackpots(Object.values(data) as JackpotStorageRow[]);
    return;
  }

  if (path.startsWith("gamedata/bets/")) {
    const user = path.slice("gamedata/bets/".length);
    const rows = Object.values(data).map((row) => ({
      ...(row as Omit<BetStorageRow, "user">),
      user,
    })) as BetStorageRow[];
    upsertBets(rows);
    return;
  }

  if (path === "gamedata/epochLifecycle") {
    patchMetaJsonMap("gamedata:epochLifecycle", data);
    return;
  }

  const indexerEventCategory = INDEXER_EVENT_PATHS[path];
  if (indexerEventCategory) {
    upsertIndexerEvents(indexerEventCategory, data);
    return;
  }

  throw new Error(`Unsupported patch path: ${path}`);
}

export function putJsonPath(path: string, value: unknown) {
  if (path === "gamedata/_meta/currentEpoch") {
    setMetaNumber("currentEpoch", Number(value));
    return;
  }

  if (path === "gamedata/_meta/lastIndexedBlock") {
    runInTransaction(() => {
      setLastIndexedBlockInTransaction(BigInt(String(value ?? "0")));
      bumpPublicReadModelRevision();
    }, "put_indexed_block");
    return;
  }

  if (path === "gamedata/_meta/repairCursorBlock") {
    setMetaBigInt("repairCursorBlock", BigInt(String(value ?? "0")));
    return;
  }

  throw new Error(`Unsupported put path: ${path}`);
}
