import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DB_PATH = "data/lore.sqlite";

function resolveDbPath() {
  const configured = process.env.LORE_DB_PATH?.trim() || DEFAULT_DB_PATH;
  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
}

export const dbPath = resolveDbPath();

mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA temp_store = MEMORY;
  PRAGMA busy_timeout = 5000;
  PRAGMA cache_size = -20000;
  PRAGMA mmap_size = 268435456;
  PRAGMA foreign_keys = ON;

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
`);
