import { parseUnits } from "viem";
import {
  getConfiguredContractAddress,
  getConfiguredLineaNetwork,
} from "../config/publicConfig";
import { db } from "./db";

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
const SCOPED_PROTOCOL_FEE_FLUSHES_TABLE = "scoped_protocol_fee_flushes";

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
}

export interface JackpotStorageRow {
  epoch: string;
  kind: "daily" | "weekly";
  amount: string;
  amountNum: number;
  txHash: string;
  blockNumber: string;
}

export interface RewardClaimStorageRow {
  id: string;
  epoch: string;
  user: string;
  reward: string;
  rewardNum: number;
  txHash: string;
  blockNumber: string;
}

export interface FeeFlushStorageRow {
  id: string;
  ownerAmount: string;
  burnAmount: string;
  txHash: string;
  blockNumber: string;
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

function parseJsonArray<T>(value: unknown): T[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
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

function parseAmountWei(value: unknown) {
  if (typeof value !== "string" || !value) return 0n;
  try {
    return parseUnits(value, 18);
  } catch {
    return 0n;
  }
}

const SQLITE_BUSY_WAIT_BASE_MS = 40;
const SQLITE_TX_MAX_ATTEMPTS = 6;
const SQLITE_SLEEP_BUFFER = new SharedArrayBuffer(4);
const SQLITE_SLEEP_VIEW = new Int32Array(SQLITE_SLEEP_BUFFER);

function sleepSync(ms: number) {
  Atomics.wait(SQLITE_SLEEP_VIEW, 0, 0, ms);
}

function isSqliteBusyError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("database is locked") || message.includes("database schema is locked");
}

function runInTransaction<T>(action: () => T, label = "tx"): T {
  let waitMs = SQLITE_BUSY_WAIT_BASE_MS;
  for (let attempt = 1; attempt <= SQLITE_TX_MAX_ATTEMPTS; attempt += 1) {
    try {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = action();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch (rollbackErr) {
          console.error("[storage] Rollback failed:", rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr));
        }
        throw error;
      }
    } catch (error) {
      if (!isSqliteBusyError(error) || attempt === SQLITE_TX_MAX_ATTEMPTS) {
        throw error;
      }
      console.warn(`[storage] ${label} hit SQLITE_BUSY, retry ${attempt}/${SQLITE_TX_MAX_ATTEMPTS} in ${waitMs}ms`);
      sleepSync(waitMs);
      waitMs *= 2;
    }
  }
  throw new Error("[storage] transaction failed: exhausted retries");
}

function runWrite<T>(action: () => T, label = "write"): T {
  let waitMs = SQLITE_BUSY_WAIT_BASE_MS;
  for (let attempt = 1; attempt <= SQLITE_TX_MAX_ATTEMPTS; attempt += 1) {
    try {
      return action();
    } catch (error) {
      if (!isSqliteBusyError(error) || attempt === SQLITE_TX_MAX_ATTEMPTS) {
        throw error;
      }
      console.warn(`[storage] ${label} hit SQLITE_BUSY, retry ${attempt}/${SQLITE_TX_MAX_ATTEMPTS} in ${waitMs}ms`);
      sleepSync(waitMs);
      waitMs *= 2;
    }
  }
  throw new Error("[storage] write failed: exhausted retries");
}

function scopeMetaKey(key: string) {
  return `${CURRENT_STORAGE_SCOPE}:${key}`;
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

export function getMetaJson<T>(key: string): T | null {
  const raw = getMetaValue(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`[storage] getMetaJson: failed to parse key "${key}":`, (err as Error).message ?? err);
    return null;
  }
}

export function setMetaJson(key: string, value: unknown) {
  setMetaValue(key, JSON.stringify(value));
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
  setMetaValue(key, String(value));
}

export function setMetaBigInt(key: string, value: bigint) {
  setMetaValue(key, value.toString());
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
    epochIds.filter((epoch) => Number.isInteger(epoch) && epoch > 0),
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
  `);

  runInTransaction(() => {
    for (const [epoch, row] of entries) {
      statement.run(
        CURRENT_STORAGE_SCOPE,
        Number(epoch),
        row.winningTile,
        row.totalPool,
        row.rewardPool,
        row.fee ?? null,
        row.jackpotBonus ?? null,
        boolToInt(row.isDailyJackpot),
        boolToInt(row.isWeeklyJackpot),
        row.resolvedBlock != null ? Number(row.resolvedBlock) : null,
      );
    }
  }, "epochs");
}

function buildDepositKey(epoch: string, txHash: string, blockNumber: string) {
  const normalizedHash = txHash.toLowerCase().trim();
  if (/^0x[0-9a-f]+$/.test(normalizedHash)) {
    return `${epoch}_${normalizedHash}`;
  }
  return `${epoch}_nohash_${blockNumber}`;
}

function mapBetRows(rows: Array<Record<string, unknown>>) {
  const map: Record<string, Omit<BetStorageRow, "user">> = {};
  for (const row of rows) {
    const id = String(row.id ?? "");
    if (!id) continue;
    map[id] = {
      epoch: String(row.epoch ?? "0"),
      tileIds: parseJsonArray<number>(row.tile_ids_json),
      amounts: parseJsonArray<string>(row.amounts_json),
      totalAmount: String(row.total_amount ?? "0"),
      totalAmountNum: Number(row.total_amount_num ?? 0),
      txHash: String(row.tx_hash ?? ""),
      blockNumber: String(row.block_number ?? "0"),
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
    .map((row) => Number(row.epoch ?? 0))
    .filter((epoch) => Number.isInteger(epoch) && epoch > 0);
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

export function getEpochTileUserCounts(epoch: number, gridSize = 25) {
  if (!Number.isInteger(epoch) || epoch <= 0) {
    return Array.from({ length: gridSize }, () => 0);
  }

  const rows = db.prepare(`
    SELECT user, tile_ids_json
    FROM ${SCOPED_BETS_TABLE}
    WHERE scope = ? AND epoch = ?
    ORDER BY block_number ASC, id ASC
  `).all(CURRENT_STORAGE_SCOPE, epoch) as Array<Record<string, unknown>>;

  const perTile = Array.from({ length: gridSize }, () => new Set<string>());
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

  return perTile.map((set) => set.size);
}

export function getEpochTilePoolsWei(epoch: number, gridSize = 25) {
  if (!Number.isInteger(epoch) || epoch <= 0) {
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
    const sharedWei = totalWei / BigInt(tileIds.length);
    for (const tileId of tileIds) {
      const tileIdx = Number(tileId) - 1;
      if (tileIdx >= 0 && tileIdx < gridSize) {
        perTile[tileIdx] += sharedWei;
      }
    }
  }

  return perTile;
}

export function upsertBets(rows: BetStorageRow[]) {
  if (rows.length === 0) return;
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
  `);

  runInTransaction(() => {
    for (const row of rows) {
      const id = buildDepositKey(row.epoch, row.txHash, row.blockNumber);
      statement.run(
        CURRENT_STORAGE_SCOPE,
        id,
        normalizeWallet(row.user),
        Number(row.epoch),
        JSON.stringify(row.tileIds),
        JSON.stringify(row.amounts ?? []),
        row.totalAmount,
        row.totalAmountNum,
        row.txHash,
        Number(row.blockNumber),
      );
    }
  }, "bets");
}

export function getJackpotsMap(limit?: number) {
  const rows = (
    limit
      ? db.prepare(`
          SELECT id, epoch, kind, amount, amount_num, tx_hash, block_number
          FROM ${SCOPED_JACKPOTS_TABLE}
          WHERE scope = ?
          ORDER BY block_number DESC, id DESC
          LIMIT ?
        `).all(CURRENT_STORAGE_SCOPE, limit)
      : db.prepare(`
          SELECT id, epoch, kind, amount, amount_num, tx_hash, block_number
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
    };
  }
  return map;
}

export function getRecentJackpots(limit = 200) {
  const rows = db.prepare(`
    SELECT epoch, kind, amount, amount_num, tx_hash, block_number
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
  })) satisfies JackpotStorageRow[];
}

export function upsertJackpots(rows: JackpotStorageRow[]) {
  if (rows.length === 0) return;
  const statement = db.prepare(`
    INSERT INTO ${SCOPED_JACKPOTS_TABLE}(scope, id, epoch, kind, amount, amount_num, tx_hash, block_number)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope, id) DO UPDATE SET
      epoch = excluded.epoch,
      kind = excluded.kind,
      amount = excluded.amount,
      amount_num = excluded.amount_num,
      tx_hash = excluded.tx_hash,
      block_number = excluded.block_number
  `);

  runInTransaction(() => {
    for (const row of rows) {
      const id = `${row.kind}_${row.epoch}`;
      statement.run(
        CURRENT_STORAGE_SCOPE,
        id,
        Number(row.epoch),
        row.kind,
        row.amount,
        row.amountNum,
        row.txHash,
        Number(row.blockNumber),
      );
    }
  }, "jackpots");
}

export function upsertRewardClaims(rows: RewardClaimStorageRow[]) {
  if (rows.length === 0) return;
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
  `);

  runInTransaction(() => {
    for (const row of rows) {
      statement.run(
        CURRENT_STORAGE_SCOPE,
        row.id,
        Number(row.epoch),
        normalizeWallet(row.user),
        row.reward,
        row.rewardNum,
        row.txHash,
        Number(row.blockNumber),
      );
    }
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
  `);

  runInTransaction(() => {
    for (const row of rows) {
      statement.run(
        CURRENT_STORAGE_SCOPE,
        row.id,
        row.ownerAmount,
        row.burnAmount,
        row.txHash,
        Number(row.blockNumber),
      );
    }
  }, "protocol_fee_flushes");
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

export function insertChatMessage(message: Omit<ChatMessageRow, "id">) {
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

  runInTransaction(() => {
    insert.run(
      normalizeWallet(message.sender),
      message.senderName,
      message.senderAvatar,
      message.text,
      message.timestamp,
    );
    trim.run(MAX_CHAT_MESSAGES);
  }, "chat_messages");
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
  runWrite(() => {
    db.prepare(`
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
  }, "chat_profile");
}

export function acquireExpiringLock(name: string, epoch: string, ttlMs: number) {
  const now = Date.now();
  const expiresAt = now + ttlMs;

  return runInTransaction(() => {
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

  throw new Error(`Unsupported patch path: ${path}`);
}

export function putJsonPath(path: string, value: unknown) {
  if (path === "gamedata/_meta/currentEpoch") {
    setMetaNumber("currentEpoch", Number(value));
    return;
  }

  if (path === "gamedata/_meta/lastIndexedBlock") {
    setMetaBigInt("lastIndexedBlock", BigInt(String(value ?? "0")));
    return;
  }

  if (path === "gamedata/_meta/repairCursorBlock") {
    setMetaBigInt("repairCursorBlock", BigInt(String(value ?? "0")));
    return;
  }

  throw new Error(`Unsupported put path: ${path}`);
}
