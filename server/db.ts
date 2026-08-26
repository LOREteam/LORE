import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { threadId } from "node:worker_threads";
import { assertProductionRuntimeConfig } from "../config/productionRuntime";
import { assertProductionDatabasePathSafe } from "./dbPathSafety";

const DEFAULT_DB_PATH = "data/lore.sqlite";
const HERMETIC_BUILD_MARKER = "1";
const HERMETIC_BUILD_DB_ROOT_ENV = "LORE_HERMETIC_BUILD_DB_ROOT";

assertProductionRuntimeConfig("server");

function isPathInsideOrSame(rootPath: string, candidatePath: string) {
  const relativePath = relative(rootPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function samePath(left: string, right: string) {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

export function resolveHermeticBuildDbPath(
  rootInput = process.env[HERMETIC_BUILD_DB_ROOT_ENV],
  processId = process.pid,
  workerThreadId = threadId,
) {
  const rawRoot = rootInput?.trim() ?? "";
  if (!rawRoot || !isAbsolute(rawRoot)) {
    throw new Error(`${HERMETIC_BUILD_DB_ROOT_ENV} must be an absolute directory during a hermetic build.`);
  }
  if (!Number.isSafeInteger(processId) || processId <= 0) {
    throw new Error("Hermetic build database process identity must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(workerThreadId) || workerThreadId < 0) {
    throw new Error("Hermetic build database worker identity must be a non-negative safe integer.");
  }
  const lexicalRoot = resolve(rawRoot);
  const rootStats = lstatSync(lexicalRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error(`${HERMETIC_BUILD_DB_ROOT_ENV} must be an ordinary non-reparse directory during a hermetic build.`);
  }
  const canonicalRoot = realpathSync(lexicalRoot);
  if (!samePath(canonicalRoot, lexicalRoot)) {
    throw new Error(`${HERMETIC_BUILD_DB_ROOT_ENV} must not resolve through a symlink, junction, or reparse point.`);
  }
  const dbPath = resolve(canonicalRoot, `worker-${processId}-${workerThreadId}.sqlite`);
  if (!isPathInsideOrSame(canonicalRoot, dbPath) || dirname(dbPath) !== canonicalRoot) {
    throw new Error("Hermetic build database path escaped its owned directory.");
  }
  return dbPath;
}

export function resolveDbPath() {
  if (process.env.LORE_HERMETIC_BUILD === HERMETIC_BUILD_MARKER) {
    return resolveHermeticBuildDbPath();
  }
  const configured = process.env.LORE_DB_PATH?.trim() || DEFAULT_DB_PATH;
  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
}

export const dbPath = resolveDbPath();

const requireProductionDatabasePathSafety = process.env.NODE_ENV === "production";
if (requireProductionDatabasePathSafety) {
  assertProductionDatabasePathSafe(dbPath);
} else {
  mkdirSync(dirname(dbPath), { recursive: true });
}

export const db = new DatabaseSync(dbPath);
if (requireProductionDatabasePathSafety) {
  assertProductionDatabasePathSafe(dbPath);
}
let dbShuttingDown = false;
const shutdownGlobal = globalThis as typeof globalThis & {
  __loreDbShutdownHandlersInstalled?: boolean;
};

export function isDbShuttingDown() {
  return dbShuttingDown;
}

function configureConnection() {
  db.exec(`
    PRAGMA busy_timeout = 15000;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;
    PRAGMA cache_size = -20000;
    PRAGMA mmap_size = 268435456;
    PRAGMA foreign_keys = ON;
  `);
}

function bootstrapSchema() {
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS epochs (
      epoch INTEGER PRIMARY KEY,
      winning_tile INTEGER NOT NULL,
      total_pool TEXT NOT NULL,
      reward_pool TEXT NOT NULL,
      fee TEXT,
      jackpot_bonus TEXT,
      is_daily_jackpot INTEGER NOT NULL DEFAULT 0,
      is_weekly_jackpot INTEGER NOT NULL DEFAULT 0,
      resolved_block INTEGER
    );

    CREATE TABLE IF NOT EXISTS bets (
      id TEXT PRIMARY KEY,
      user TEXT NOT NULL,
      epoch INTEGER NOT NULL,
      tile_ids_json TEXT NOT NULL,
      amounts_json TEXT,
      total_amount TEXT NOT NULL,
      total_amount_num REAL NOT NULL,
      tx_hash TEXT NOT NULL,
      block_number INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bets_user_epoch ON bets(user, epoch DESC, block_number DESC);
    CREATE INDEX IF NOT EXISTS idx_bets_epoch ON bets(epoch DESC);

    CREATE TABLE IF NOT EXISTS scoped_epochs (
      scope TEXT NOT NULL,
      epoch INTEGER NOT NULL,
      winning_tile INTEGER NOT NULL,
      total_pool TEXT NOT NULL,
      reward_pool TEXT NOT NULL,
      fee TEXT,
      jackpot_bonus TEXT,
      is_daily_jackpot INTEGER NOT NULL DEFAULT 0,
      is_weekly_jackpot INTEGER NOT NULL DEFAULT 0,
      resolved_block INTEGER,
      PRIMARY KEY(scope, epoch)
    );
    CREATE INDEX IF NOT EXISTS idx_scoped_epochs_scope_epoch ON scoped_epochs(scope, epoch DESC);

    CREATE TABLE IF NOT EXISTS scoped_bets (
      scope TEXT NOT NULL,
      id TEXT NOT NULL,
      user TEXT NOT NULL,
      epoch INTEGER NOT NULL,
      tile_ids_json TEXT NOT NULL,
      amounts_json TEXT,
      total_amount TEXT NOT NULL,
      total_amount_num REAL NOT NULL,
      tx_hash TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      PRIMARY KEY(scope, id)
    );
    CREATE INDEX IF NOT EXISTS idx_scoped_bets_scope_user_epoch ON scoped_bets(scope, user, epoch DESC, block_number DESC);
    CREATE INDEX IF NOT EXISTS idx_scoped_bets_scope_epoch ON scoped_bets(scope, epoch DESC);
    CREATE INDEX IF NOT EXISTS idx_scoped_bets_scope_block ON scoped_bets(scope, block_number DESC, id DESC);

    CREATE TABLE IF NOT EXISTS jackpots (
      id TEXT PRIMARY KEY,
      epoch INTEGER NOT NULL,
      kind TEXT NOT NULL,
      amount TEXT NOT NULL,
      amount_num REAL NOT NULL,
      tx_hash TEXT NOT NULL,
      block_number INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jackpots_epoch ON jackpots(epoch DESC, block_number DESC);
    CREATE INDEX IF NOT EXISTS idx_jackpots_block ON jackpots(block_number DESC, id DESC);

    CREATE TABLE IF NOT EXISTS scoped_jackpots (
      scope TEXT NOT NULL,
      id TEXT NOT NULL,
      epoch INTEGER NOT NULL,
      kind TEXT NOT NULL,
      amount TEXT NOT NULL,
      amount_num REAL NOT NULL,
      tx_hash TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      log_index INTEGER,
      block_hash TEXT,
      finalized_at_block INTEGER,
      PRIMARY KEY(scope, id)
    );
    CREATE INDEX IF NOT EXISTS idx_scoped_jackpots_scope_epoch ON scoped_jackpots(scope, epoch DESC, block_number DESC);
    CREATE INDEX IF NOT EXISTS idx_scoped_jackpots_scope_block ON scoped_jackpots(scope, block_number DESC, id DESC);

    CREATE TABLE IF NOT EXISTS reward_claims (
      id TEXT PRIMARY KEY,
      epoch INTEGER NOT NULL,
      user TEXT NOT NULL,
      reward TEXT NOT NULL,
      reward_num REAL NOT NULL,
      tx_hash TEXT NOT NULL,
      block_number INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reward_claims_user_epoch ON reward_claims(user, epoch DESC, block_number DESC);
    CREATE INDEX IF NOT EXISTS idx_reward_claims_epoch ON reward_claims(epoch DESC, block_number DESC);
    CREATE INDEX IF NOT EXISTS idx_reward_claims_block ON reward_claims(block_number DESC, id DESC);

    CREATE TABLE IF NOT EXISTS scoped_reward_claims (
      scope TEXT NOT NULL,
      id TEXT NOT NULL,
      epoch INTEGER NOT NULL,
      user TEXT NOT NULL,
      reward TEXT NOT NULL,
      reward_num REAL NOT NULL,
      tx_hash TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      PRIMARY KEY(scope, id)
    );
    CREATE INDEX IF NOT EXISTS idx_scoped_reward_claims_scope_user_epoch ON scoped_reward_claims(scope, user, epoch DESC, block_number DESC);
    CREATE INDEX IF NOT EXISTS idx_scoped_reward_claims_scope_epoch ON scoped_reward_claims(scope, epoch DESC, block_number DESC);
    CREATE INDEX IF NOT EXISTS idx_scoped_reward_claims_scope_block ON scoped_reward_claims(scope, block_number DESC, id DESC);

    -- The user-facing ledger is deliberately append-only from the first
    -- indexer version that writes it. Existing raw tables are not silently
    -- backfilled: callers must surface the resulting partial coverage.
    CREATE TABLE IF NOT EXISTS scoped_user_activity (
      scope TEXT NOT NULL,
      event_id TEXT NOT NULL,
      user TEXT NOT NULL,
      activity_type TEXT NOT NULL CHECK(activity_type IN (
        'bet', 'reward_claim', 'reward_batch_claim', 'rebate_claim', 'rebate_batch_claim'
      )),
      epoch INTEGER,
      amount TEXT NOT NULL,
      amount_num REAL NOT NULL,
      tx_hash TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      PRIMARY KEY(scope, event_id)
    );
    CREATE INDEX IF NOT EXISTS idx_scoped_user_activity_scope_user_block
      ON scoped_user_activity(scope, user, block_number DESC, event_id DESC);
    CREATE INDEX IF NOT EXISTS idx_scoped_user_activity_scope_block
      ON scoped_user_activity(scope, block_number DESC, event_id DESC);

    CREATE TABLE IF NOT EXISTS protocol_fee_flushes (
      id TEXT PRIMARY KEY,
      owner_amount TEXT NOT NULL,
      burn_amount TEXT NOT NULL,
      tx_hash TEXT NOT NULL,
      block_number INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scoped_protocol_fee_flushes (
      scope TEXT NOT NULL,
      id TEXT NOT NULL,
      owner_amount TEXT NOT NULL,
      burn_amount TEXT NOT NULL,
      tx_hash TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      PRIMARY KEY(scope, id)
    );
    CREATE INDEX IF NOT EXISTS idx_scoped_protocol_fee_flushes_scope_block ON scoped_protocol_fee_flushes(scope, block_number DESC, id DESC);

    CREATE TABLE IF NOT EXISTS scoped_global_stats_aggregate (
      scope TEXT PRIMARY KEY,
      model_version INTEGER NOT NULL,
      total_volume_wei TEXT NOT NULL,
      total_burn_wei TEXT NOT NULL,
      epoch_count INTEGER NOT NULL,
      last_indexed_block TEXT NOT NULL
    );

    -- A row means the aggregate for this scope cannot be trusted until a
    -- transactional rebuild has consumed the raw source tables.  Keep this
    -- separate from the aggregate so existing databases migrate without ALTER
    -- TABLE and independent/older writers are observable in O(1).
    BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS scoped_global_stats_dirty (
      scope TEXT PRIMARY KEY
    );

    -- The leaderboard payload is a separate versioned read model. A dirty row
    -- makes public reads fail closed until the source tables have been consumed
    -- by one transactional rebuild.
    CREATE TABLE IF NOT EXISTS scoped_leaderboard_read_model (
      scope TEXT PRIMARY KEY,
      model_version INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scoped_leaderboard_dirty (
      scope TEXT PRIMARY KEY
    );

    DROP TRIGGER IF EXISTS scoped_global_stats_dirty_bets_after_insert;
    DROP TRIGGER IF EXISTS scoped_global_stats_dirty_bets_after_update;
    DROP TRIGGER IF EXISTS scoped_global_stats_dirty_bets_after_delete;
    DROP TRIGGER IF EXISTS scoped_global_stats_dirty_epochs_after_insert;
    DROP TRIGGER IF EXISTS scoped_global_stats_dirty_epochs_after_update;
    DROP TRIGGER IF EXISTS scoped_global_stats_dirty_epochs_after_delete;
    DROP TRIGGER IF EXISTS scoped_global_stats_dirty_fee_flushes_after_insert;
    DROP TRIGGER IF EXISTS scoped_global_stats_dirty_fee_flushes_after_update;
    DROP TRIGGER IF EXISTS scoped_global_stats_dirty_fee_flushes_after_delete;
    DROP TRIGGER IF EXISTS scoped_global_stats_dirty_meta_last_indexed_block_after_insert;
    DROP TRIGGER IF EXISTS scoped_global_stats_dirty_meta_last_indexed_block_after_update;
    DROP TRIGGER IF EXISTS scoped_global_stats_dirty_meta_last_indexed_block_after_delete;

    CREATE TRIGGER IF NOT EXISTS scoped_global_stats_dirty_bets_after_insert_v2
    AFTER INSERT ON scoped_bets
    BEGIN
      INSERT INTO scoped_global_stats_dirty(scope)
      SELECT NEW.scope
      WHERE NOT EXISTS (SELECT 1 FROM scoped_global_stats_dirty WHERE scope = NEW.scope);
    END;
    CREATE TRIGGER IF NOT EXISTS scoped_global_stats_dirty_bets_after_update_v2
    AFTER UPDATE ON scoped_bets
    BEGIN
      INSERT INTO scoped_global_stats_dirty(scope)
      SELECT OLD.scope
      WHERE NOT EXISTS (SELECT 1 FROM scoped_global_stats_dirty WHERE scope = OLD.scope);
      INSERT INTO scoped_global_stats_dirty(scope)
      SELECT NEW.scope
      WHERE NOT EXISTS (SELECT 1 FROM scoped_global_stats_dirty WHERE scope = NEW.scope);
    END;
    CREATE TRIGGER IF NOT EXISTS scoped_global_stats_dirty_bets_after_delete_v2
    AFTER DELETE ON scoped_bets
    BEGIN
      INSERT INTO scoped_global_stats_dirty(scope)
      SELECT OLD.scope
      WHERE NOT EXISTS (SELECT 1 FROM scoped_global_stats_dirty WHERE scope = OLD.scope);
    END;

    CREATE TRIGGER IF NOT EXISTS scoped_global_stats_dirty_epochs_after_insert_v2
    AFTER INSERT ON scoped_epochs
    BEGIN
      INSERT INTO scoped_global_stats_dirty(scope)
      SELECT NEW.scope
      WHERE NOT EXISTS (SELECT 1 FROM scoped_global_stats_dirty WHERE scope = NEW.scope);
    END;
    CREATE TRIGGER IF NOT EXISTS scoped_global_stats_dirty_epochs_after_update_v2
    AFTER UPDATE ON scoped_epochs
    BEGIN
      INSERT INTO scoped_global_stats_dirty(scope)
      SELECT OLD.scope
      WHERE NOT EXISTS (SELECT 1 FROM scoped_global_stats_dirty WHERE scope = OLD.scope);
      INSERT INTO scoped_global_stats_dirty(scope)
      SELECT NEW.scope
      WHERE NOT EXISTS (SELECT 1 FROM scoped_global_stats_dirty WHERE scope = NEW.scope);
    END;
    CREATE TRIGGER IF NOT EXISTS scoped_global_stats_dirty_epochs_after_delete_v2
    AFTER DELETE ON scoped_epochs
    BEGIN
      INSERT INTO scoped_global_stats_dirty(scope)
      SELECT OLD.scope
      WHERE NOT EXISTS (SELECT 1 FROM scoped_global_stats_dirty WHERE scope = OLD.scope);
    END;

    CREATE TRIGGER IF NOT EXISTS scoped_global_stats_dirty_fee_flushes_after_insert_v2
    AFTER INSERT ON scoped_protocol_fee_flushes
    BEGIN
      INSERT INTO scoped_global_stats_dirty(scope)
      SELECT NEW.scope
      WHERE NOT EXISTS (SELECT 1 FROM scoped_global_stats_dirty WHERE scope = NEW.scope);
    END;
    CREATE TRIGGER IF NOT EXISTS scoped_global_stats_dirty_fee_flushes_after_update_v2
    AFTER UPDATE ON scoped_protocol_fee_flushes
    BEGIN
      INSERT INTO scoped_global_stats_dirty(scope)
      SELECT OLD.scope
      WHERE NOT EXISTS (SELECT 1 FROM scoped_global_stats_dirty WHERE scope = OLD.scope);
      INSERT INTO scoped_global_stats_dirty(scope)
      SELECT NEW.scope
      WHERE NOT EXISTS (SELECT 1 FROM scoped_global_stats_dirty WHERE scope = NEW.scope);
    END;
    CREATE TRIGGER IF NOT EXISTS scoped_global_stats_dirty_fee_flushes_after_delete_v2
    AFTER DELETE ON scoped_protocol_fee_flushes
    BEGIN
      INSERT INTO scoped_global_stats_dirty(scope)
      SELECT OLD.scope
      WHERE NOT EXISTS (SELECT 1 FROM scoped_global_stats_dirty WHERE scope = OLD.scope);
    END;

    CREATE TRIGGER IF NOT EXISTS scoped_global_stats_dirty_meta_last_indexed_block_after_insert_v2
    AFTER INSERT ON meta
    WHEN NEW.key GLOB '?*:lastIndexedBlock'
    BEGIN
      INSERT INTO scoped_global_stats_dirty(scope)
      SELECT substr(NEW.key, 1, length(NEW.key) - length(':lastIndexedBlock'))
      WHERE NOT EXISTS (
        SELECT 1
        FROM scoped_global_stats_dirty
        WHERE scope = substr(NEW.key, 1, length(NEW.key) - length(':lastIndexedBlock'))
      );
    END;
    CREATE TRIGGER IF NOT EXISTS scoped_global_stats_dirty_meta_last_indexed_block_after_update_v2
    AFTER UPDATE ON meta
    BEGIN
      INSERT INTO scoped_global_stats_dirty(scope)
      SELECT substr(OLD.key, 1, length(OLD.key) - length(':lastIndexedBlock'))
      WHERE OLD.key GLOB '?*:lastIndexedBlock'
        AND NOT EXISTS (
          SELECT 1
          FROM scoped_global_stats_dirty
          WHERE scope = substr(OLD.key, 1, length(OLD.key) - length(':lastIndexedBlock'))
        );
      INSERT INTO scoped_global_stats_dirty(scope)
      SELECT substr(NEW.key, 1, length(NEW.key) - length(':lastIndexedBlock'))
      WHERE NEW.key GLOB '?*:lastIndexedBlock'
        AND NOT EXISTS (
          SELECT 1
          FROM scoped_global_stats_dirty
          WHERE scope = substr(NEW.key, 1, length(NEW.key) - length(':lastIndexedBlock'))
        );
    END;
    CREATE TRIGGER IF NOT EXISTS scoped_global_stats_dirty_meta_last_indexed_block_after_delete_v2
    AFTER DELETE ON meta
    WHEN OLD.key GLOB '?*:lastIndexedBlock'
    BEGIN
      INSERT INTO scoped_global_stats_dirty(scope)
      SELECT substr(OLD.key, 1, length(OLD.key) - length(':lastIndexedBlock'))
      WHERE NOT EXISTS (
        SELECT 1
        FROM scoped_global_stats_dirty
        WHERE scope = substr(OLD.key, 1, length(OLD.key) - length(':lastIndexedBlock'))
      );
    END;

    -- INSERT OR IGNORE inside a trigger inherits the outer statement's
    -- conflict policy.  An UPSERT into a dirty scope can therefore turn the
    -- intended no-op into a UNIQUE failure.  Use a predicate instead and
    -- replace the original trigger names on startup for existing databases.
    DROP TRIGGER IF EXISTS scoped_leaderboard_dirty_bets_after_insert_v1;
    DROP TRIGGER IF EXISTS scoped_leaderboard_dirty_bets_after_update_v1;
    DROP TRIGGER IF EXISTS scoped_leaderboard_dirty_bets_after_delete_v1;
    DROP TRIGGER IF EXISTS scoped_leaderboard_dirty_reward_claims_after_insert_v1;
    DROP TRIGGER IF EXISTS scoped_leaderboard_dirty_reward_claims_after_update_v1;
    DROP TRIGGER IF EXISTS scoped_leaderboard_dirty_reward_claims_after_delete_v1;
    DROP TRIGGER IF EXISTS scoped_leaderboard_dirty_epochs_after_insert_v1;
    DROP TRIGGER IF EXISTS scoped_leaderboard_dirty_epochs_after_update_v1;
    DROP TRIGGER IF EXISTS scoped_leaderboard_dirty_epochs_after_delete_v1;

    CREATE TRIGGER IF NOT EXISTS scoped_leaderboard_dirty_bets_after_insert_v2
    AFTER INSERT ON scoped_bets
    BEGIN
      INSERT INTO scoped_leaderboard_dirty(scope)
      SELECT NEW.scope
      WHERE NOT EXISTS (SELECT 1 FROM scoped_leaderboard_dirty WHERE scope = NEW.scope);
    END;
    CREATE TRIGGER IF NOT EXISTS scoped_leaderboard_dirty_bets_after_update_v2
    AFTER UPDATE ON scoped_bets
    BEGIN
      INSERT INTO scoped_leaderboard_dirty(scope)
      SELECT OLD.scope
      WHERE NOT EXISTS (SELECT 1 FROM scoped_leaderboard_dirty WHERE scope = OLD.scope);
      INSERT INTO scoped_leaderboard_dirty(scope)
      SELECT NEW.scope
      WHERE NOT EXISTS (SELECT 1 FROM scoped_leaderboard_dirty WHERE scope = NEW.scope);
    END;
    CREATE TRIGGER IF NOT EXISTS scoped_leaderboard_dirty_bets_after_delete_v2
    AFTER DELETE ON scoped_bets
    BEGIN
      INSERT INTO scoped_leaderboard_dirty(scope)
      SELECT OLD.scope
      WHERE NOT EXISTS (SELECT 1 FROM scoped_leaderboard_dirty WHERE scope = OLD.scope);
    END;
    CREATE TRIGGER IF NOT EXISTS scoped_leaderboard_dirty_reward_claims_after_insert_v2
    AFTER INSERT ON scoped_reward_claims
    BEGIN
      INSERT INTO scoped_leaderboard_dirty(scope)
      SELECT NEW.scope
      WHERE NOT EXISTS (SELECT 1 FROM scoped_leaderboard_dirty WHERE scope = NEW.scope);
    END;
    CREATE TRIGGER IF NOT EXISTS scoped_leaderboard_dirty_reward_claims_after_update_v2
    AFTER UPDATE ON scoped_reward_claims
    BEGIN
      INSERT INTO scoped_leaderboard_dirty(scope)
      SELECT OLD.scope
      WHERE NOT EXISTS (SELECT 1 FROM scoped_leaderboard_dirty WHERE scope = OLD.scope);
      INSERT INTO scoped_leaderboard_dirty(scope)
      SELECT NEW.scope
      WHERE NOT EXISTS (SELECT 1 FROM scoped_leaderboard_dirty WHERE scope = NEW.scope);
    END;
    CREATE TRIGGER IF NOT EXISTS scoped_leaderboard_dirty_reward_claims_after_delete_v2
    AFTER DELETE ON scoped_reward_claims
    BEGIN
      INSERT INTO scoped_leaderboard_dirty(scope)
      SELECT OLD.scope
      WHERE NOT EXISTS (SELECT 1 FROM scoped_leaderboard_dirty WHERE scope = OLD.scope);
    END;
    CREATE TRIGGER IF NOT EXISTS scoped_leaderboard_dirty_epochs_after_insert_v2
    AFTER INSERT ON scoped_epochs
    BEGIN
      INSERT INTO scoped_leaderboard_dirty(scope)
      SELECT NEW.scope
      WHERE NOT EXISTS (SELECT 1 FROM scoped_leaderboard_dirty WHERE scope = NEW.scope);
    END;
    CREATE TRIGGER IF NOT EXISTS scoped_leaderboard_dirty_epochs_after_update_v2
    AFTER UPDATE ON scoped_epochs
    BEGIN
      INSERT INTO scoped_leaderboard_dirty(scope)
      SELECT OLD.scope
      WHERE NOT EXISTS (SELECT 1 FROM scoped_leaderboard_dirty WHERE scope = OLD.scope);
      INSERT INTO scoped_leaderboard_dirty(scope)
      SELECT NEW.scope
      WHERE NOT EXISTS (SELECT 1 FROM scoped_leaderboard_dirty WHERE scope = NEW.scope);
    END;
    CREATE TRIGGER IF NOT EXISTS scoped_leaderboard_dirty_epochs_after_delete_v2
    AFTER DELETE ON scoped_epochs
    BEGIN
      INSERT INTO scoped_leaderboard_dirty(scope)
      SELECT OLD.scope
      WHERE NOT EXISTS (SELECT 1 FROM scoped_leaderboard_dirty WHERE scope = OLD.scope);
    END;
    COMMIT;

    CREATE TABLE IF NOT EXISTS scoped_indexer_events (
      scope TEXT NOT NULL,
      category TEXT NOT NULL,
      id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      PRIMARY KEY(scope, category, id)
    );
    CREATE INDEX IF NOT EXISTS idx_scoped_indexer_events_scope_category_block
      ON scoped_indexer_events(scope, category, block_number DESC, id DESC);

    CREATE TABLE IF NOT EXISTS scoped_indexer_block_checkpoints (
      scope TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      block_hash TEXT NOT NULL,
      PRIMARY KEY(scope, block_number)
    );
    CREATE INDEX IF NOT EXISTS idx_scoped_indexer_block_checkpoints_scope_block
      ON scoped_indexer_block_checkpoints(scope, block_number DESC);

    CREATE TABLE IF NOT EXISTS scoped_indexer_leases (
      scope TEXT PRIMARY KEY,
      owner_token TEXT NOT NULL CHECK(length(owner_token) BETWEEN 16 AND 200),
      acquired_at INTEGER NOT NULL,
      heartbeat_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_profiles (
      wallet TEXT PRIMARY KEY,
      name TEXT,
      avatar TEXT,
      custom_avatar TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender TEXT NOT NULL,
      sender_name TEXT,
      sender_avatar TEXT,
      text TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp ON chat_messages(timestamp DESC, id DESC);

    CREATE TABLE IF NOT EXISTS rate_limits (
      bucket TEXT NOT NULL,
      limiter_key TEXT NOT NULL,
      count INTEGER NOT NULL,
      window_started_at INTEGER NOT NULL,
      reset_at INTEGER NOT NULL,
      PRIMARY KEY(bucket, limiter_key)
    );

    CREATE TABLE IF NOT EXISTS ephemeral_locks (
      name TEXT PRIMARY KEY,
      epoch TEXT,
      acquired_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ephemeral_locks_expires
      ON ephemeral_locks(expires_at);

    CREATE TABLE IF NOT EXISTS admin_sessions (
      scope TEXT NOT NULL,
      session_key TEXT NOT NULL,
      record_value TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY(scope, session_key)
    );
    CREATE INDEX IF NOT EXISTS idx_admin_sessions_scope_expires
      ON admin_sessions(scope, expires_at);
  `);
}

configureConnection();
bootstrapSchema();

function ensureScopedJackpotColumn(column: "log_index" | "block_hash" | "finalized_at_block", definition: string) {
  const columns = db.prepare("PRAGMA table_info(scoped_jackpots)").all() as Array<{ name?: unknown }>;
  if (columns.some((entry) => entry.name === column)) return;
  db.exec(`ALTER TABLE scoped_jackpots ADD COLUMN ${column} ${definition}`);
}

// Existing databases predate immutable jackpot-log identities. Keep their rows
// readable as legacy history, but add the proof fields for all new events.
ensureScopedJackpotColumn("log_index", "INTEGER");
ensureScopedJackpotColumn("block_hash", "TEXT");
ensureScopedJackpotColumn("finalized_at_block", "INTEGER");

if (!shutdownGlobal.__loreDbShutdownHandlersInstalled) {
  shutdownGlobal.__loreDbShutdownHandlersInstalled = true;
  // Graceful shutdown: close DB connection on process termination.
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.once(sig, () => {
      dbShuttingDown = true;
      try { db.exec("PRAGMA optimize;"); } catch { /* best effort */ }
      try { (db as unknown as { close?: () => void }).close?.(); } catch { /* best effort */ }
      process.exit(sig === "SIGINT" ? 130 : 143);
    });
  }
}
