import "dotenv/config";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  createPublicClient,
  decodeEventLog,
  fallback,
  http,
  parseAbi,
  parseUnits,
} from "viem";

const EVENTS_ABI = parseAbi([
  "event BetPlaced(uint256 indexed epoch, address indexed user, uint256 indexed tileId, uint256 amount)",
  "event BatchBetsPlaced(uint256 indexed epoch, address indexed user, uint256[] tileIds, uint256[] amounts, uint256 totalAmount)",
  "event BatchBetsSameAmountPlaced(uint256 indexed epoch, address indexed user, uint256[] tileIds, uint256 amount, uint256 totalAmount)",
  "event BatchBetsBitmapPlaced(uint256 indexed epoch, address indexed user, uint32 tileMask, uint256 amount, uint256 totalAmount)",
  "event EpochResolved(uint256 indexed epoch, uint256 winningTile, uint256 totalPool, uint256 fee, uint256 rewardPool, uint256 jackpotBonus)",
  "event DailyJackpotAwarded(uint256 indexed epoch, uint256 amount)",
  "event WeeklyJackpotAwarded(uint256 indexed epoch, uint256 amount)",
  "event RewardClaimed(uint256 indexed epoch, address indexed user, uint256 reward)",
  "event RewardBatchClaimed(address indexed user, uint256 totalAmount, uint256 epochsClaimed)",
  "event RebateClaimed(address indexed user, uint256 indexed epoch, uint256 amount)",
  "event RebateBatchClaimed(address indexed user, uint256 amount, uint256 epochsClaimed)",
  "event ResolverRewardAccrued(address indexed resolver, uint256 indexed epoch, uint256 amount)",
  "event ResolverRewardClaimed(address indexed resolver, uint256 amount)",
  "event ProtocolFeesFlushed(uint256 ownerAmount, uint256 burnAmount)",
]);

const network = (process.env.LINEA_NETWORK || process.env.NEXT_PUBLIC_LINEA_NETWORK || "sepolia").toLowerCase() === "mainnet"
  ? "mainnet"
  : "sepolia";
const chain = network === "mainnet"
  ? { id: 59144, name: "Linea", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.linea.build"] } } }
  : { id: 59141, name: "Linea Sepolia", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.sepolia.linea.build"] } }, testnet: true };
const contractAddress = (process.env.KEEPER_CONTRACT_ADDRESS || process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "").toLowerCase();
const dbRaw = process.env.LORE_DB_PATH?.trim();
const dbPath = dbRaw ? (isAbsolute(dbRaw) ? dbRaw : resolve(dbRaw)) : "";
const windowEpochs = Math.min(500, Math.max(1, Number(process.env.CHAIN_INDEXER_AUDIT_EPOCHS || 50)));
const endEpochArg = process.argv.find((value) => value.startsWith("--end-epoch="));
const auditEndEpoch = endEpochArg ? Number(endEpochArg.slice("--end-epoch=".length)) : null;
const finalityBlocks = BigInt(process.env.INDEXER_FINALITY_BLOCKS || "0");
const outPath = resolve(process.env.CHAIN_INDEXER_AUDIT_OUT || ".tmp/pre-mainnet/chain-indexer-audit.json");

if (!/^0x[0-9a-f]{40}$/.test(contractAddress)) throw new Error("configured contract address is missing or invalid");
if (!dbPath || !existsSync(dbPath)) throw new Error("LORE_DB_PATH must point to an existing indexer SQLite database");
if (!Number.isSafeInteger(windowEpochs)) throw new Error("CHAIN_INDEXER_AUDIT_EPOCHS must be an integer");
if (auditEndEpoch !== null && (!Number.isSafeInteger(auditEndEpoch) || auditEndEpoch < 0)) {
  throw new Error("--end-epoch must be a non-negative safe integer");
}

const rpcList = (process.env.KEEPER_RPC_URL || process.env.NEXT_PUBLIC_LINEA_RPCS || process.env.NEXT_PUBLIC_LINEA_SEPOLIA_RPCS || chain.rpcUrls.default.http.join(","))
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const client = createPublicClient({
  chain,
  transport: fallback(rpcList.map((url) => http(url, { timeout: 30_000, retryCount: 1 })), { rank: true }),
});
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

const startEpoch = Number(epochRows[0].epoch);
const endEpoch = Number(epochRows.at(-1).epoch);
const firstBetBlock = Number(db.prepare(`
  SELECT MIN(block_number) AS value FROM scoped_bets WHERE scope = ? AND epoch BETWEEN ? AND ?
`).get(scope, startEpoch, endEpoch)?.value ?? epochRows[0].resolved_block);
const fromBlock = BigInt(Math.min(firstBetBlock, Number(epochRows[0].resolved_block)));
const headBlock = await client.getBlockNumber();
const toBlock = headBlock > finalityBlocks ? headBlock - finalityBlocks : 0n;
if (toBlock < fromBlock) throw new Error("chain finality target is before the audit window");
if (toBlock - fromBlock > 250_000n) throw new Error("audit window exceeds 250000 blocks; reduce CHAIN_INDEXER_AUDIT_EPOCHS");

const logs = [];
for (let cursor = fromBlock; cursor <= toBlock; cursor += 10_000n) {
  const chunkTo = cursor + 9_999n > toBlock ? toBlock : cursor + 9_999n;
  logs.push(...await client.getLogs({ address: contractAddress, fromBlock: cursor, toBlock: chunkTo }));
}

const mismatches = [];
const addMismatch = (kind, detail) => {
  if (mismatches.length < 50) mismatches.push({ kind, detail });
};
const eventId = (log) => `${log.transactionHash ?? "nohash"}_${log.logIndex?.toString() ?? "0"}`.toLowerCase();
const parseStoredWei = (value) => parseUnits(String(value ?? "0"), 18);
const storedObject = (key) => {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(`${scope}:${key}`);
  try { return JSON.parse(String(row?.value ?? "{}")); } catch { return {}; }
};
const dbEpochs = new Map(epochRows.map((row) => [Number(row.epoch), row]));
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
`).all(scope, Number(fromBlock), Number(toBlock)).map((row) => [String(row.id).toLowerCase(), row]));
const batchClaims = storedObject("gamedata:batchClaims");
const resolverRewards = storedObject("gamedata:resolverRewards");

const seen = {
  bets: new Set(), epochs: new Set(), jackpots: new Set(), rewards: new Set(),
  batchClaims: new Set(), resolverRewards: new Set(), fees: new Set(), rebates: 0,
};
const rebateBatchClaimTxs = new Set();
for (const log of logs) {
  try {
    const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics, strict: false });
    if (decoded.eventName === "RebateBatchClaimed" && log.transactionHash) {
      rebateBatchClaimTxs.add(log.transactionHash.toLowerCase());
    }
  } catch { /* unrelated contract event */ }
}

for (const log of logs) {
  let decoded;
  try { decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics, strict: false }); } catch { continue; }
  const args = decoded.args ?? {};
  const epoch = "epoch" in args ? Number(args.epoch) : null;
  const inEpochWindow = epoch !== null && epoch >= startEpoch && epoch <= endEpoch;
  const id = eventId(log);

  if (["BetPlaced", "BatchBetsPlaced", "BatchBetsSameAmountPlaced", "BatchBetsBitmapPlaced"].includes(decoded.eventName) && inEpochWindow) {
    const key = `${epoch}_${String(log.transactionHash ?? "").toLowerCase()}`;
    seen.bets.add(key);
    const row = dbBets.get(key);
    const totalAmount = decoded.eventName === "BetPlaced" ? args.amount : args.totalAmount;
    if (!row) addMismatch("bet", `epoch ${epoch} missing index row`);
    else if (parseStoredWei(row.total_amount) !== totalAmount) addMismatch("bet", `epoch ${epoch} total amount mismatch`);
  } else if (decoded.eventName === "EpochResolved" && inEpochWindow) {
    seen.epochs.add(epoch);
    const row = dbEpochs.get(epoch);
    if (!row) addMismatch("resolve", `epoch ${epoch} missing index row`);
    else {
      if (Number(row.winning_tile) !== Number(args.winningTile)) addMismatch("resolve", `epoch ${epoch} winning tile mismatch`);
      if (parseStoredWei(row.total_pool) !== args.totalPool) addMismatch("resolve", `epoch ${epoch} total pool mismatch`);
      if (parseStoredWei(row.reward_pool) !== args.rewardPool) addMismatch("resolve", `epoch ${epoch} reward pool mismatch`);
      if (parseStoredWei(row.fee) !== args.fee) addMismatch("resolve", `epoch ${epoch} fee mismatch`);
      if (parseStoredWei(row.jackpot_bonus) !== args.jackpotBonus) addMismatch("resolve", `epoch ${epoch} jackpot bonus mismatch`);
    }
  } else if (["DailyJackpotAwarded", "WeeklyJackpotAwarded"].includes(decoded.eventName) && inEpochWindow) {
    const kind = decoded.eventName === "DailyJackpotAwarded" ? "daily" : "weekly";
    const key = `${kind}_${epoch}`;
    seen.jackpots.add(key);
    const row = dbJackpots.get(key);
    if (!row) addMismatch("jackpot", `epoch ${epoch} ${kind} missing index row`);
    else if (parseStoredWei(row.amount) !== args.amount) addMismatch("jackpot", `epoch ${epoch} ${kind} amount mismatch`);
  } else if (decoded.eventName === "RewardClaimed" && inEpochWindow) {
    seen.rewards.add(id);
    const row = dbRewards.get(id);
    if (!row) addMismatch("reward", `epoch ${epoch} missing index row`);
    else if (parseStoredWei(row.reward) !== args.reward) addMismatch("reward", `epoch ${epoch} amount mismatch`);
  } else if (["RewardBatchClaimed", "RebateClaimed", "RebateBatchClaimed"].includes(decoded.eventName)) {
    if (decoded.eventName === "RebateClaimed" && log.transactionHash && rebateBatchClaimTxs.has(log.transactionHash.toLowerCase())) continue;
    seen.batchClaims.add(id);
    if (decoded.eventName.startsWith("Rebate")) seen.rebates += 1;
    if (!batchClaims[id]) addMismatch("claim", `${decoded.eventName} missing index metadata`);
  } else if (decoded.eventName === "ResolverRewardAccrued" && inEpochWindow) {
    seen.resolverRewards.add(id);
    if (!resolverRewards[id]) addMismatch("resolver-reward", `${decoded.eventName} missing index metadata`);
  } else if (decoded.eventName === "ResolverRewardClaimed") {
    seen.resolverRewards.add(id);
    if (!resolverRewards[id]) addMismatch("resolver-reward", `${decoded.eventName} missing index metadata`);
  } else if (decoded.eventName === "ProtocolFeesFlushed") {
    seen.fees.add(id);
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

db.close();
const summary = {
  generatedAt: new Date().toISOString(),
  status: mismatches.length === 0 ? "pass" : "fail",
  network,
  epochWindow: { from: startEpoch, to: endEpoch, count: epochRows.length },
  blockWindow: { from: fromBlock.toString(), to: toBlock.toString() },
  counts: Object.fromEntries(Object.entries(seen).map(([key, value]) => [key, value instanceof Set ? value.size : value])),
  mismatches,
};
mkdirSync(dirname(outPath), { recursive: true });
const temporaryOutPath = `${outPath}.${process.pid}.tmp`;
writeFileSync(temporaryOutPath, `${JSON.stringify(summary, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
renameSync(temporaryOutPath, outPath);
console.log(JSON.stringify(summary));
process.exit(mismatches.length === 0 ? 0 : 1);
