import "dotenv/config";
import { mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  createPublicClient,
  decodeEventLog,
  fallback,
  http,
  parseUnits,
} from "viem";
import { compareAccountingSnapshot, replayV9Accounting } from "./lib/chain-accounting-model.mjs";

const require = createRequire(import.meta.url);
const {
  GAME_ABI: ACCOUNTING_ABI,
  GAME_EVENTS_ABI: EVENTS_ABI,
} = require("../config/generated/lineaOreV10Abi.ts");

const network = (process.env.LINEA_NETWORK || process.env.NEXT_PUBLIC_LINEA_NETWORK || "sepolia").toLowerCase() === "mainnet"
  ? "mainnet"
  : "sepolia";
const chain = network === "mainnet"
  ? { id: 59144, name: "Linea", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.linea.build"] } } }
  : { id: 59141, name: "Linea Sepolia", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.sepolia.linea.build"] } }, testnet: true };
const DECIMAL_INTEGER_RE = /^(?:0|[1-9]\d{0,15})$/;
const MAX_TILE_ID = 25;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_SAFE_BLOCK_NUMBER = BigInt(Number.MAX_SAFE_INTEGER);
const contractAddress = (process.env.KEEPER_CONTRACT_ADDRESS || process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "").toLowerCase();
const dbRaw = process.env.LORE_DB_PATH?.trim();
const dbPath = dbRaw ? (isAbsolute(dbRaw) ? dbRaw : resolve(dbRaw)) : "";
const windowEpochs = parseBoundedIntegerEnv("CHAIN_INDEXER_AUDIT_EPOCHS", 50, 1, 500);
const endEpochArg = process.argv.find((value) => value.startsWith("--end-epoch="));
const auditEndEpoch = endEpochArg
  ? parseBoundedInteger("--end-epoch", endEpochArg.slice("--end-epoch=".length), 0, Number.MAX_SAFE_INTEGER)
  : null;
const summaryOnly = process.argv.includes("--summary-only");
const finalityBlocks = BigInt(parseBoundedIntegerEnv("INDEXER_FINALITY_BLOCKS", 0, 0, 1_000_000));
const outPath = resolve(process.env.CHAIN_INDEXER_AUDIT_OUT || ".tmp/pre-mainnet/chain-indexer-audit.json");

function regularFileStat(filePath) {
  try {
    const stats = statSync(filePath);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
}

if (!/^0x[0-9a-f]{40}$/.test(contractAddress)) throw new Error("configured contract address is missing or invalid");
if (!dbPath || !regularFileStat(dbPath)) {
  throw new Error("LORE_DB_PATH must point to an existing indexer SQLite database file");
}

function parseBoundedIntegerEnv(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return parseBoundedInteger(name, raw, min, max);
}

function parseBoundedInteger(name, raw, min, max) {
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

function parseDbInteger(label, value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const raw = String(value ?? "");
  if (!DECIMAL_INTEGER_RE.test(raw)) {
    throw new Error(`${label} must be a canonical decimal integer`);
  }
  const parsed = BigInt(raw);
  if (parsed > MAX_SAFE_INTEGER_BIGINT || parsed < BigInt(min) || parsed > BigInt(max)) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
  return Number(parsed);
}

function parseDbTileId(label, value) {
  return parseDbInteger(label, value, 1, MAX_TILE_ID);
}

function parseChainTileId(label, value) {
  if (typeof value !== "bigint" || value <= 0n || value > BigInt(MAX_TILE_ID)) {
    throw new Error(`${label} must be between 1 and ${MAX_TILE_ID}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_TILE_ID) {
    throw new Error(`${label} must be between 1 and ${MAX_TILE_ID}`);
  }
  return parsed;
}

function parseChainEpoch(value) {
  if (typeof value !== "bigint" || value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function toSqlBlockNumber(label, value) {
  if (typeof value !== "bigint" || value < 0n || value > MAX_SAFE_BLOCK_NUMBER) {
    throw new Error(`${label} must be a safe non-negative block number`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a safe non-negative block number`);
  }
  return parsed;
}

const rpcList = (process.env.KEEPER_RPC_URL || process.env.NEXT_PUBLIC_LINEA_RPCS || process.env.NEXT_PUBLIC_LINEA_SEPOLIA_RPCS || chain.rpcUrls.default.http.join(","))
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const client = createPublicClient({
  chain,
  transport: fallback(rpcList.map((url) => http(url, { timeout: 30_000, retryCount: 1 })), { rank: true }),
});
async function readAccountingSnapshot(blockNumber) {
  const keys = ["rolloverPool", "dailyJackpotPool", "weeklyJackpotPool", "accruedOwnerFees", "accruedBurnFees"];
  const values = await Promise.all(keys.map((functionName) => (
    client.readContract({
      address: contractAddress,
      abi: ACCOUNTING_ABI,
      functionName,
      blockNumber,
    })
  )));
  return Object.fromEntries(keys.map((key, index) => [key, values[index]]));
}
const db = new DatabaseSync(dbPath, { readOnly: true });
const scope = `${network}:${contractAddress}`;
const epochRows = (auditEndEpoch === null
  ? db.prepare(`
      SELECT epoch, winning_tile, total_pool, reward_pool, fee, jackpot_bonus, resolved_block
      FROM scoped_epochs WHERE scope = ? ORDER BY epoch DESC LIMIT ?
    `).all(scope, windowEpochs)
  : db.prepare(`
      SELECT epoch, winning_tile, total_pool, reward_pool, fee, jackpot_bonus, resolved_block
      FROM scoped_epochs WHERE scope = ? AND epoch <= ? ORDER BY epoch DESC LIMIT ?
    `).all(scope, auditEndEpoch, windowEpochs)
).reverse();
if (epochRows.length === 0) throw new Error("indexer database has no resolved epochs for the configured contract scope");

const firstEpochRow = epochRows[0];
const lastEpochRow = epochRows.at(-1);
const startEpoch = parseDbInteger("scoped_epochs first epoch", firstEpochRow.epoch, 1);
const endEpoch = parseDbInteger("scoped_epochs last epoch", lastEpochRow.epoch, 1);
const firstResolvedBlock = parseDbInteger("scoped_epochs first resolved_block", firstEpochRow.resolved_block);
const lastResolvedBlock = parseDbInteger("scoped_epochs last resolved_block", lastEpochRow.resolved_block);
const firstBetBlockRow = db.prepare(`
  SELECT MIN(block_number) AS value FROM scoped_bets WHERE scope = ? AND epoch BETWEEN ? AND ?
`).get(scope, startEpoch, endEpoch);
const firstBetBlock = firstBetBlockRow?.value === null || firstBetBlockRow?.value === undefined
  ? firstResolvedBlock
  : parseDbInteger("scoped_bets first block_number", firstBetBlockRow.value);
const fromBlock = BigInt(Math.min(firstBetBlock, firstResolvedBlock));
const headBlock = await client.getBlockNumber();
const toBlock = headBlock > finalityBlocks ? headBlock - finalityBlocks : 0n;
if (toBlock < fromBlock) throw new Error("chain finality target is before the audit window");
if (toBlock - fromBlock > 250_000n) {
  throw new Error(
    "audit window exceeds 250000 blocks; refresh the indexer DB to the finalized chain head or reduce CHAIN_INDEXER_AUDIT_EPOCHS",
  );
}
const accountingToBlock = BigInt(lastResolvedBlock);
if (accountingToBlock > toBlock) throw new Error("last indexed resolve is beyond the finalized audit head");
const sqlFromBlock = toSqlBlockNumber("audit fromBlock", fromBlock);
const sqlToBlock = toSqlBlockNumber("audit toBlock", toBlock);
const accountingStartSnapshot = await readAccountingSnapshot(fromBlock > 0n ? fromBlock - 1n : 0n);
const accountingEndSnapshot = await readAccountingSnapshot(accountingToBlock);

const logs = [];
for (let cursor = fromBlock; cursor <= toBlock; cursor += 10_000n) {
  const chunkTo = cursor + 9_999n > toBlock ? toBlock : cursor + 9_999n;
  logs.push(...await client.getLogs({ address: contractAddress, fromBlock: cursor, toBlock: chunkTo }));
}

const mismatches = [];
const addMismatch = (kind, detail) => {
  if (mismatches.length < 50) mismatches.push({ kind, detail });
};
function normalizeLogTransactionHash(log) {
  const normalized = String(log.transactionHash ?? "").toLowerCase().trim();
  return /^0x[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}
function eventId(log) {
  const normalizedHash = normalizeLogTransactionHash(log);
  if (!normalizedHash || log.logIndex === null || log.logIndex === undefined) return null;
  return `${normalizedHash}_${log.logIndex.toString()}`;
}
function betEventKey(epoch, log) {
  const normalizedHash = normalizeLogTransactionHash(log);
  return normalizedHash ? `${epoch}_${normalizedHash}` : null;
}
const parseStoredWei = (value) => parseUnits(String(value ?? "0"), 18);
const storedObject = (key) => {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(`${scope}:${key}`);
  try { return JSON.parse(String(row?.value ?? "{}")); } catch { return {}; }
};
const storedIndexerEvents = (category, legacyKey) => {
  const records = storedObject(legacyKey);
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT id, payload_json FROM scoped_indexer_events
      WHERE scope = ? AND category = ? AND block_number BETWEEN ? AND ?
    `).all(scope, category, sqlFromBlock, sqlToBlock);
  } catch {
    return records;
  }
  for (const row of rows) {
    try { records[String(row.id)] = JSON.parse(String(row.payload_json)); } catch { /* reported as missing below */ }
  }
  return records;
};
const storedIndexerEventIds = (category) => {
  try {
    return db.prepare(`
      SELECT id FROM scoped_indexer_events
      WHERE scope = ? AND category = ? AND block_number BETWEEN ? AND ?
    `).all(scope, category, sqlFromBlock, sqlToBlock)
      .map((row) => String(row.id).toLowerCase());
  } catch {
    return [];
  }
};
const dbEpochs = new Map(epochRows.map((row) => [parseDbInteger("scoped_epochs epoch", row.epoch, 1), row]));
const dbBets = new Map(db.prepare(`
  SELECT id, epoch, total_amount FROM scoped_bets WHERE scope = ? AND epoch BETWEEN ? AND ?
`).all(scope, startEpoch, endEpoch).map((row) => [String(row.id).toLowerCase(), row]));
const dbJackpots = new Map(db.prepare(`
  SELECT id, epoch, amount FROM scoped_jackpots WHERE scope = ? AND epoch BETWEEN ? AND ?
`).all(scope, startEpoch, endEpoch).map((row) => [String(row.id), row]));
const dbRewards = new Map(db.prepare(`
  SELECT id, epoch, reward FROM scoped_reward_claims WHERE scope = ? AND epoch BETWEEN ? AND ?
`).all(scope, startEpoch, endEpoch).map((row) => [String(row.id).toLowerCase(), row]));
const dbFees = new Map(db.prepare(`
  SELECT id, owner_amount, burn_amount FROM scoped_protocol_fee_flushes
  WHERE scope = ? AND block_number BETWEEN ? AND ?
`).all(scope, sqlFromBlock, sqlToBlock).map((row) => [String(row.id).toLowerCase(), row]));
const batchClaims = storedIndexerEvents("batch_claim", "gamedata:batchClaims");
const resolverRewards = storedIndexerEvents("resolver_reward", "gamedata:resolverRewards");
const dustSettlements = storedIndexerEvents("dust_settlement", "gamedata:dustSettlements");
const dbBatchClaimIds = storedIndexerEventIds("batch_claim");
const dbResolverRewardIds = storedIndexerEventIds("resolver_reward");
const dbDustSettlementIds = storedIndexerEventIds("dust_settlement");

const seen = {
  bets: new Set(), epochs: new Set(), jackpots: new Set(), rewards: new Set(),
  batchClaims: new Set(), resolverRewards: new Set(), dustSettlements: new Set(), fees: new Set(), rebates: 0,
};
const rebateBatchClaimTxs = new Set();
const accountingEvents = [];
for (const log of logs) {
  try {
    const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics, strict: false });
    if (decoded.eventName === "RebateBatchClaimed") {
      const normalizedHash = normalizeLogTransactionHash(log);
      if (normalizedHash) rebateBatchClaimTxs.add(normalizedHash);
    }
  } catch { /* unrelated contract event */ }
}

for (const log of logs) {
  let decoded;
  try { decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics, strict: false }); } catch { continue; }
  const args = decoded.args ?? {};
  const epoch = "epoch" in args ? parseChainEpoch(args.epoch) : null;
  const inEpochWindow = epoch !== null && epoch >= startEpoch && epoch <= endEpoch;
  const id = eventId(log);

  if (["BetPlaced", "BatchBetsPlaced", "BatchBetsSameAmountPlaced", "BatchBetsBitmapPlaced"].includes(decoded.eventName) && inEpochWindow) {
    const key = betEventKey(epoch, log);
    if (!key) {
      addMismatch("bet", `epoch ${epoch} malformed transaction identity`);
      continue;
    }
    seen.bets.add(key);
    const row = dbBets.get(key);
    const totalAmount = decoded.eventName === "BetPlaced" ? args.amount : args.totalAmount;
    accountingEvents.push({ kind: "bet", epoch, amount: totalAmount });
    if (!row) addMismatch("bet", `epoch ${epoch} missing index row`);
    else if (parseStoredWei(row.total_amount) !== totalAmount) addMismatch("bet", `epoch ${epoch} total amount mismatch`);
  } else if (decoded.eventName === "EpochResolved" && inEpochWindow) {
    seen.epochs.add(epoch);
    accountingEvents.push({
      kind: "resolve",
      epoch,
      totalPool: args.totalPool,
      fee: args.fee,
      rewardPool: args.rewardPool,
      jackpotBonus: args.jackpotBonus,
    });
    const row = dbEpochs.get(epoch);
    if (!row) addMismatch("resolve", `epoch ${epoch} missing index row`);
    else {
      if (
        parseDbTileId(`epoch ${epoch} winning_tile`, row.winning_tile) !==
        parseChainTileId(`epoch ${epoch} winningTile`, args.winningTile)
      ) addMismatch("resolve", `epoch ${epoch} winning tile mismatch`);
      if (parseStoredWei(row.total_pool) !== args.totalPool) addMismatch("resolve", `epoch ${epoch} total pool mismatch`);
      if (parseStoredWei(row.reward_pool) !== args.rewardPool) addMismatch("resolve", `epoch ${epoch} reward pool mismatch`);
      if (parseStoredWei(row.fee) !== args.fee) addMismatch("resolve", `epoch ${epoch} fee mismatch`);
      if (parseStoredWei(row.jackpot_bonus) !== args.jackpotBonus) addMismatch("resolve", `epoch ${epoch} jackpot bonus mismatch`);
    }
  } else if (["DailyJackpotAwarded", "WeeklyJackpotAwarded"].includes(decoded.eventName) && inEpochWindow) {
    const kind = decoded.eventName === "DailyJackpotAwarded" ? "daily" : "weekly";
    accountingEvents.push({ kind: `${kind}-jackpot`, epoch, amount: args.amount });
    const key = `${kind}_${epoch}`;
    seen.jackpots.add(key);
    const row = dbJackpots.get(key);
    if (!row) addMismatch("jackpot", `epoch ${epoch} ${kind} missing index row`);
    else if (parseStoredWei(row.amount) !== args.amount) addMismatch("jackpot", `epoch ${epoch} ${kind} amount mismatch`);
  } else if (decoded.eventName === "RewardClaimed" && inEpochWindow) {
    if (!id) {
      addMismatch("reward", `epoch ${epoch} malformed transaction identity`);
      continue;
    }
    seen.rewards.add(id);
    const row = dbRewards.get(id);
    if (!row) addMismatch("reward", `epoch ${epoch} missing index row`);
    else if (parseStoredWei(row.reward) !== args.reward) addMismatch("reward", `epoch ${epoch} amount mismatch`);
  } else if (["RewardBatchClaimed", "RebateClaimed", "RebateBatchClaimed"].includes(decoded.eventName)) {
    const normalizedHash = normalizeLogTransactionHash(log);
    if (decoded.eventName === "RebateClaimed" && normalizedHash && rebateBatchClaimTxs.has(normalizedHash)) continue;
    if (!id) {
      addMismatch("claim", `${decoded.eventName} malformed transaction identity`);
      continue;
    }
    seen.batchClaims.add(id);
    if (decoded.eventName.startsWith("Rebate")) seen.rebates += 1;
    if (!batchClaims[id]) addMismatch("claim", `${decoded.eventName} missing index metadata`);
  } else if (decoded.eventName === "ResolverRewardAccrued" && inEpochWindow) {
    if (!id) {
      addMismatch("resolver-reward", `${decoded.eventName} malformed transaction identity`);
      continue;
    }
    seen.resolverRewards.add(id);
    accountingEvents.push({ kind: "resolver-reward", epoch, amount: args.amount });
    if (!resolverRewards[id]) addMismatch("resolver-reward", `${decoded.eventName} missing index metadata`);
  } else if (decoded.eventName === "ResolverRewardClaimed") {
    if (!id) {
      addMismatch("resolver-reward", `${decoded.eventName} malformed transaction identity`);
      continue;
    }
    seen.resolverRewards.add(id);
    if (!resolverRewards[id]) addMismatch("resolver-reward", `${decoded.eventName} missing index metadata`);
  } else if (["RewardDustSettled", "RebateDustSettled"].includes(decoded.eventName) && inEpochWindow) {
    if (!id) {
      addMismatch("dust-settlement", `${decoded.eventName} malformed transaction identity`);
      continue;
    }
    seen.dustSettlements.add(id);
    const row = dustSettlements[id];
    const expectedKind = decoded.eventName === "RewardDustSettled" ? "reward" : "rebate";
    if (!row) addMismatch("dust-settlement", `${decoded.eventName} missing index metadata`);
    else if (
      row.kind !== expectedKind ||
      parseDbInteger("dust_settlement epoch", row.epoch, 1) !== epoch ||
      parseStoredWei(row.amount) !== args.amount
    ) {
      addMismatch("dust-settlement", `${decoded.eventName} metadata mismatch`);
    }
  } else if (decoded.eventName === "ProtocolFeesFlushed") {
    if (!id) {
      addMismatch("fee-flush", "malformed transaction identity");
      continue;
    }
    seen.fees.add(id);
    if ((log.blockNumber ?? 0n) <= accountingToBlock) {
      accountingEvents.push({ kind: "fee-flush", ownerAmount: args.ownerAmount, burnAmount: args.burnAmount });
    }
    const row = dbFees.get(id);
    if (!row) addMismatch("fee-flush", "event missing index row");
    else if (parseStoredWei(row.owner_amount) !== args.ownerAmount || parseStoredWei(row.burn_amount) !== args.burnAmount) {
      addMismatch("fee-flush", "amount mismatch");
    }
  }
}

for (const key of dbBets.keys()) if (!seen.bets.has(key)) addMismatch("bet", "index row has no chain event in window");
for (const epoch of dbEpochs.keys()) if (!seen.epochs.has(epoch)) addMismatch("resolve", `epoch ${epoch} index row has no chain event`);
for (const key of dbJackpots.keys()) if (!seen.jackpots.has(key)) addMismatch("jackpot", `${key} index row has no chain event`);
for (const key of dbRewards.keys()) if (!seen.rewards.has(key)) addMismatch("reward", "index row has no chain event in window");
for (const key of dbFees.keys()) if (!seen.fees.has(key)) addMismatch("fee-flush", "index row has no chain event in window");
for (const key of dbBatchClaimIds) if (!seen.batchClaims.has(key)) addMismatch("claim", "index metadata row has no chain event in window");
for (const key of dbResolverRewardIds) {
  if (!seen.resolverRewards.has(key)) addMismatch("resolver-reward", "index metadata row has no chain event in window");
}
for (const key of dbDustSettlementIds) {
  if (!seen.dustSettlements.has(key)) addMismatch("dust-settlement", "index metadata row has no chain event in window");
}

const accountingReplay = replayV9Accounting({ initial: accountingStartSnapshot, events: accountingEvents });
const accountingSnapshotMismatches = compareAccountingSnapshot(accountingEndSnapshot, accountingReplay.state);
for (const mismatch of [...accountingReplay.mismatches, ...accountingSnapshotMismatches]) {
  addMismatch("accounting", `${mismatch.kind}${mismatch.epoch ? ` epoch ${mismatch.epoch}` : ""} expected ${mismatch.expected} actual ${mismatch.actual}`);
}
const serializeSnapshot = (snapshot) => Object.fromEntries(
  Object.entries(snapshot).map(([key, value]) => [key, value.toString()]),
);

db.close();
const summary = {
  generatedAt: new Date().toISOString(),
  status: mismatches.length === 0 ? "pass" : "fail",
  network,
  epochWindow: { from: startEpoch, to: endEpoch, count: epochRows.length },
  blockWindow: { from: fromBlock.toString(), to: toBlock.toString() },
  counts: Object.fromEntries(Object.entries(seen).map(([key, value]) => [key, value instanceof Set ? value.size : value])),
  accounting: {
    fromBlock: (fromBlock > 0n ? fromBlock - 1n : 0n).toString(),
    toBlock: accountingToBlock.toString(),
    events: accountingEvents.length,
    start: serializeSnapshot(accountingStartSnapshot),
    expectedEnd: serializeSnapshot(accountingReplay.state),
    actualEnd: serializeSnapshot(accountingEndSnapshot),
    mismatchCount: accountingReplay.mismatches.length + accountingSnapshotMismatches.length,
  },
  mismatches,
};
mkdirSync(dirname(outPath), { recursive: true });
const temporaryOutPath = `${outPath}.${process.pid}.tmp`;
writeFileSync(temporaryOutPath, `${JSON.stringify(summary, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
renameSync(temporaryOutPath, outPath);
if (summaryOnly) {
  console.log(
    `status=${summary.status}, network=${summary.network}, epochs=${summary.epochWindow.count}, blocks=${summary.blockWindow.from}-${summary.blockWindow.to}, mismatches=${summary.mismatches.length}, accountingMismatches=${summary.accounting.mismatchCount}`,
  );
} else {
  console.log(JSON.stringify(summary));
}
process.exit(mismatches.length === 0 ? 0 : 1);
