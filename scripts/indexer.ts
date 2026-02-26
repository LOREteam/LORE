/**
 * Blockchain → Firebase RTDB indexer.
 * Scans contract events (BetPlaced, BatchBetsPlaced, EpochResolved,
 * DailyJackpotAwarded, WeeklyJackpotAwarded) and writes structured data
 * to Firebase Realtime Database so the frontend can fetch it via REST
 * instead of scanning thousands of blocks.
 *
 * Run: npx tsx scripts/indexer.ts          (one-shot, catches up)
 * Or with --watch flag for continuous mode (polls every 15s).
 */
import "dotenv/config";
import {
  createPublicClient,
  http,
  parseAbi,
  decodeEventLog,
  formatUnits,
  encodeEventTopics,
  type Log,
} from "viem";
import { lineaSepolia } from "viem/chains";

const CONTRACT = (process.env.KEEPER_CONTRACT_ADDRESS ||
  "0x2a98cfb661710d11c47e958856859f7b474e0107") as `0x${string}`;
const DEPLOY_BLOCK = 25663555n;
const CHUNK_BLOCKS = 2_000n;
const POLL_INTERVAL_MS = 15_000;
const CONCURRENCY = 1;
const RETRY_COUNT = 5;
const RETRY_DELAY_MS = 5_000;
const INTER_CHUNK_DELAY_MS = 1_500;

const FIREBASE_DB_URL =
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ||
  "https://lore-78751-default-rtdb.europe-west1.firebasedatabase.app";
const FIREBASE_DB_AUTH = process.env.FIREBASE_DB_AUTH ?? "";
let writeDisabled = false;

function firebaseUrl(path: string) {
  const base = `${FIREBASE_DB_URL}/${path}.json`;
  if (!FIREBASE_DB_AUTH) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}auth=${encodeURIComponent(FIREBASE_DB_AUTH)}`;
}

const EVENTS_ABI = parseAbi([
  "event BetPlaced(uint256 indexed epoch, address indexed user, uint256 indexed tileId, uint256 amount)",
  "event BatchBetsPlaced(uint256 indexed epoch, address indexed user, uint256[] tileIds, uint256[] amounts, uint256 totalAmount)",
  "event EpochResolved(uint256 indexed epoch, uint256 winningTile, uint256 totalPool, uint256 fee, uint256 rewardPool, uint256 jackpotBonus)",
  "event DailyJackpotAwarded(uint256 indexed epoch, uint256 amount)",
  "event WeeklyJackpotAwarded(uint256 indexed epoch, uint256 amount)",
]);

const client = createPublicClient({
  chain: lineaSepolia,
  transport: http(process.env.KEEPER_RPC_URL || "https://rpc.sepolia.linea.build", {
    timeout: 30_000,
    retryCount: 0,
  }),
});

// ─── Firebase REST helpers ───────────────────────────────────────────
async function fbGet<T = unknown>(path: string): Promise<T | null> {
  const res = await fetch(firebaseUrl(path));
  if (!res.ok) return null;
  const data = await res.json();
  return data as T;
}

async function fbPatch(path: string, data: Record<string, unknown>) {
  if (writeDisabled) return;
  const res = await fetch(firebaseUrl(path), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (res.status === 401 || res.status === 403) {
    writeDisabled = true;
    console.error(`[indexer] Firebase write denied (${res.status}) for ${path}. Disabling writes.`);
    return;
  }
  if (!res.ok) throw new Error(`Firebase PATCH ${path} failed: ${res.status}`);
}

async function fbPut(path: string, data: unknown) {
  if (writeDisabled) return;
  const res = await fetch(firebaseUrl(path), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (res.status === 401 || res.status === 403) {
    writeDisabled = true;
    console.error(`[indexer] Firebase write denied (${res.status}) for ${path}. Disabling writes.`);
    return;
  }
  if (!res.ok) throw new Error(`Firebase PUT ${path} failed: ${res.status}`);
}

// ─── Event topic signatures ─────────────────────────────────────────
const [betSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "BetPlaced" });
const [batchSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "BatchBetsPlaced" });
const [resolvedSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "EpochResolved" });
const [dailySig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "DailyJackpotAwarded" });
const [weeklySig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "WeeklyJackpotAwarded" });

// ─── Chunked log fetcher ────────────────────────────────────────────
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchLogsWithRetry(
  topic: `0x${string}`,
  from: bigint,
  to: bigint,
): Promise<Log[]> {
  for (let attempt = 0; attempt < RETRY_COUNT; attempt++) {
    try {
      return await client.getLogs({
        address: CONTRACT,
        topics: [topic],
        fromBlock: from,
        toBlock: to,
      } as any);
    } catch (err) {
      const msg = (err as Error).message?.slice(0, 80) ?? "unknown";
      if (attempt < RETRY_COUNT - 1) {
        const wait = RETRY_DELAY_MS * (attempt + 1);
        console.warn(`  [retry ${attempt + 1}/${RETRY_COUNT}] ${from}-${to}: ${msg} — wait ${wait}ms`);
        await delay(wait);
      } else {
        console.warn(`  [warn] ${from}-${to} failed after ${RETRY_COUNT} retries: ${msg}`);
        return [];
      }
    }
  }
  return [];
}

async function fetchLogsByTopic(
  topic: `0x${string}`,
  label: string,
  from: bigint,
  to: bigint,
): Promise<Log[]> {
  const all: Log[] = [];
  const ranges: Array<{ from: bigint; to: bigint }> = [];
  for (let f = from; f <= to; f += CHUNK_BLOCKS) {
    const t = f + CHUNK_BLOCKS - 1n > to ? to : f + CHUNK_BLOCKS - 1n;
    ranges.push({ from: f, to: t });
  }

  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    const logs = await fetchLogsWithRetry(topic, r.from, r.to);
    all.push(...logs);
    if (i < ranges.length - 1) await delay(INTER_CHUNK_DELAY_MS);
    if ((i + 1) % 10 === 0 || i === ranges.length - 1) {
      console.log(`  [${label}] ${i + 1}/${ranges.length} chunks, ${all.length} logs`);
    }
  }
  return all;
}

async function fetchAllLogs(from: bigint, to: bigint): Promise<Log[]> {
  const topics: Array<{ sig: `0x${string}`; label: string }> = [
    { sig: betSig, label: "BetPlaced" },
    { sig: batchSig, label: "BatchBets" },
    { sig: resolvedSig, label: "EpochResolved" },
    { sig: dailySig, label: "DailyJackpot" },
    { sig: weeklySig, label: "WeeklyJackpot" },
  ];

  const all: Log[] = [];
  for (const { sig, label } of topics) {
    const logs = await fetchLogsByTopic(sig, label, from, to);
    all.push(...logs);
  }
  all.sort((a, b) => Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n)));
  return all;
}

// ─── Process a single log ───────────────────────────────────────────
interface BetRecord {
  epoch: string;
  user: string;
  tileIds: number[];
  amounts: string[];
  totalAmount: string;
  totalAmountNum: number;
  txHash: string;
  blockNumber: string;
}

interface EpochRecord {
  winningTile: number;
  totalPool: string;
  rewardPool: string;
  fee: string;
  jackpotBonus: string;
  isDailyJackpot: boolean;
  isWeeklyJackpot: boolean;
  resolvedBlock: string;
}

interface JackpotRecord {
  epoch: string;
  kind: "daily" | "weekly";
  amount: string;
  amountNum: number;
  txHash: string;
  blockNumber: string;
}

function processLogs(logs: Log[]) {
  const bets: BetRecord[] = [];
  const epochs: Map<string, EpochRecord> = new Map();
  const jackpots: JackpotRecord[] = [];

  for (const log of logs) {
    const topic0 = log.topics[0];
    if (!topic0) continue;

    try {
      if (topic0 === betSig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "BetPlaced") continue;
        const args = decoded.args as { epoch: bigint; user: string; tileId: bigint; amount: bigint };
        bets.push({
          epoch: args.epoch.toString(),
          user: args.user.toLowerCase(),
          tileIds: [Number(args.tileId)],
          amounts: [formatUnits(args.amount, 18)],
          totalAmount: formatUnits(args.amount, 18),
          totalAmountNum: parseFloat(formatUnits(args.amount, 18)),
          txHash: log.transactionHash ?? "",
          blockNumber: (log.blockNumber ?? 0n).toString(),
        });
      } else if (topic0 === batchSig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "BatchBetsPlaced") continue;
        const args = decoded.args as {
          epoch: bigint; user: string; tileIds: bigint[]; amounts: bigint[]; totalAmount: bigint;
        };
        bets.push({
          epoch: args.epoch.toString(),
          user: args.user.toLowerCase(),
          tileIds: args.tileIds.map(Number),
          amounts: args.amounts.map((a) => formatUnits(a, 18)),
          totalAmount: formatUnits(args.totalAmount, 18),
          totalAmountNum: parseFloat(formatUnits(args.totalAmount, 18)),
          txHash: log.transactionHash ?? "",
          blockNumber: (log.blockNumber ?? 0n).toString(),
        });
      } else if (topic0 === resolvedSig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "EpochResolved") continue;
        const args = decoded.args as {
          epoch: bigint; winningTile: bigint; totalPool: bigint; fee: bigint; rewardPool: bigint; jackpotBonus: bigint;
        };
        epochs.set(args.epoch.toString(), {
          winningTile: Number(args.winningTile),
          totalPool: formatUnits(args.totalPool, 18),
          rewardPool: formatUnits(args.rewardPool, 18),
          fee: formatUnits(args.fee, 18),
          jackpotBonus: formatUnits(args.jackpotBonus, 18),
          isDailyJackpot: false,
          isWeeklyJackpot: false,
          resolvedBlock: (log.blockNumber ?? 0n).toString(),
        });
      } else if (topic0 === dailySig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "DailyJackpotAwarded") continue;
        const args = decoded.args as { epoch: bigint; amount: bigint };
        const ep = args.epoch.toString();
        const existing = epochs.get(ep);
        if (existing) existing.isDailyJackpot = true;
        jackpots.push({
          epoch: ep,
          kind: "daily",
          amount: formatUnits(args.amount, 18),
          amountNum: parseFloat(formatUnits(args.amount, 18)),
          txHash: log.transactionHash ?? "",
          blockNumber: (log.blockNumber ?? 0n).toString(),
        });
      } else if (topic0 === weeklySig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "WeeklyJackpotAwarded") continue;
        const args = decoded.args as { epoch: bigint; amount: bigint };
        const ep = args.epoch.toString();
        const existing = epochs.get(ep);
        if (existing) existing.isWeeklyJackpot = true;
        jackpots.push({
          epoch: ep,
          kind: "weekly",
          amount: formatUnits(args.amount, 18),
          amountNum: parseFloat(formatUnits(args.amount, 18)),
          txHash: log.transactionHash ?? "",
          blockNumber: (log.blockNumber ?? 0n).toString(),
        });
      }
    } catch {
      // malformed log
    }
  }

  return { bets, epochs, jackpots };
}

// ─── Write to Firebase ──────────────────────────────────────────────
async function writeBets(bets: BetRecord[]) {
  if (bets.length === 0) return;
  const byUser = new Map<string, BetRecord[]>();
  for (const bet of bets) {
    const arr = byUser.get(bet.user) ?? [];
    arr.push(bet);
    byUser.set(bet.user, arr);
  }

  for (const [user, userBets] of byUser) {
    const patch: Record<string, unknown> = {};
    for (const bet of userBets) {
      const key = `${bet.epoch}_${bet.txHash.slice(0, 10)}`;
      patch[key] = {
        epoch: bet.epoch,
        tileIds: bet.tileIds,
        amounts: bet.amounts,
        totalAmount: bet.totalAmount,
        totalAmountNum: bet.totalAmountNum,
        txHash: bet.txHash,
        blockNumber: bet.blockNumber,
      };
    }
    await fbPatch(`gamedata/bets/${user}`, patch);
  }
}

async function writeEpochs(epochs: Map<string, EpochRecord>) {
  if (epochs.size === 0) return;
  const patch: Record<string, unknown> = {};
  for (const [ep, data] of epochs) {
    patch[ep] = data;
  }
  await fbPatch("gamedata/epochs", patch);
}

async function writeJackpots(jackpots: JackpotRecord[]) {
  if (jackpots.length === 0) return;
  const patch: Record<string, unknown> = {};
  for (const j of jackpots) {
    const key = `${j.kind}_${j.epoch}`;
    patch[key] = j;
  }
  await fbPatch("gamedata/jackpots", patch);
}

async function setLastBlock(block: bigint) {
  await fbPut("gamedata/_meta/lastIndexedBlock", block.toString());
}

async function getLastBlock(): Promise<bigint> {
  const val = await fbGet<string>("gamedata/_meta/lastIndexedBlock");
  return val ? BigInt(val) : DEPLOY_BLOCK;
}

// ─── Main loop ──────────────────────────────────────────────────────
async function runOnce() {
  const lastBlock = await getLastBlock();
  const currentBlock = await client.getBlockNumber();

  const fromBlock = lastBlock + 1n;
  if (fromBlock > currentBlock) {
    return 0;
  }

  console.log(`[indexer] Scanning blocks ${fromBlock} → ${currentBlock} (${currentBlock - fromBlock + 1n} blocks)`);

  const logs = await fetchAllLogs(fromBlock, currentBlock);
  console.log(`[indexer] Fetched ${logs.length} logs`);

  if (logs.length > 0) {
    const { bets, epochs, jackpots } = processLogs(logs);
    console.log(`[indexer] Parsed: ${bets.length} bets, ${epochs.size} epochs, ${jackpots.length} jackpots`);

    await writeBets(bets);
    await writeEpochs(epochs);
    await writeJackpots(jackpots);
    console.log(`[indexer] Written to Firebase`);
  }

  await setLastBlock(currentBlock);
  return logs.length;
}

async function main() {
  const isWatch = process.argv.includes("--watch");
  console.log(`[indexer] Firebase: ${FIREBASE_DB_URL}`);
  if (!FIREBASE_DB_AUTH) {
    console.warn("[indexer] FIREBASE_DB_AUTH is empty. Writes require permissive RTDB rules for /gamedata.");
  }
  console.log(`[indexer] Contract: ${CONTRACT}`);
  console.log(`[indexer] Deploy block: ${DEPLOY_BLOCK}`);
  console.log(`[indexer] Mode: ${isWatch ? "watch (continuous)" : "one-shot"}`);

  await runOnce();

  if (isWatch) {
    console.log(`[indexer] Watching for new blocks every ${POLL_INTERVAL_MS / 1000}s...`);
    setInterval(async () => {
      try {
        await runOnce();
      } catch (err) {
        console.error(`[indexer] Error in watch loop:`, (err as Error).message);
      }
    }, POLL_INTERVAL_MS);
  }
}

main().catch((err) => {
  console.error("[indexer] Fatal:", err);
  process.exit(1);
});
