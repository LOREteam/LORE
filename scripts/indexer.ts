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
  fallback,
  http,
  parseAbi,
  decodeEventLog,
  formatUnits,
  encodeEventTopics,
  toHex,
  type Log,
} from "viem";
import {
  DEFAULT_INDEXER_RECONCILE_INTERVAL_MS,
  DEFAULT_INDEXER_RECONCILE_MAX_EPOCHS_PER_PASS,
  getConfiguredContractAddress,
  getConfiguredDeployBlock,
  getConfiguredLineaNetwork,
  getDefaultLineaRpcs,
  getLineaChain,
  getPreferredLineaRpcs,
} from "../config/publicConfig";
import { assertProductionRuntimeConfig } from "../config/productionRuntime";
import {
  patchJsonPath,
  putJsonPath,
  readJsonPath,
  setMetaJson,
  upsertProtocolFeeFlushes,
  upsertRewardClaims,
  type FeeFlushStorageRow,
  type RewardClaimStorageRow,
} from "../server/storage";

assertProductionRuntimeConfig("indexer");

const APP_NETWORK = getConfiguredLineaNetwork();
const APP_CHAIN = getLineaChain(APP_NETWORK);
const CONTRACT = getConfiguredContractAddress(
  process.env.KEEPER_CONTRACT_ADDRESS ??
    process.env.NEXT_PUBLIC_CONTRACT_ADDRESS,
  APP_NETWORK,
) as `0x${string}`;
const DEPLOY_BLOCK = getConfiguredDeployBlock(
  process.env.INDEXER_START_BLOCK ??
    process.env.NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK,
  APP_NETWORK,
);
const INDEXER_START_BLOCK = DEPLOY_BLOCK;
const CHUNK_BLOCKS = 2_000n;
const RUN_CHUNK_BLOCKS = 5_000n;
const REPAIR_CHUNK_BLOCKS = 20_000n;
const RECONCILE_SCAN_CHUNK_BLOCKS = 20_000n;
const RECONCILE_RECENT_LOOKBACK_BLOCKS = 150_000n;
const POLL_INTERVAL_MS = 15_000;
const RETRY_COUNT = 5;
const RETRY_DELAY_MS = 5_000;
const INTER_CHUNK_DELAY_MS = 400;
const RPC_CALL_TIMEOUT_MS = Number(process.env.INDEXER_RPC_TIMEOUT_MS ?? "45000");
const MIN_ADAPTIVE_LOG_RANGE_BLOCKS = BigInt(process.env.INDEXER_MIN_ADAPTIVE_LOG_RANGE_BLOCKS ?? "250");
const RECONCILE_INTERVAL_MS = Number(process.env.INDEXER_RECONCILE_INTERVAL_MS ?? String(DEFAULT_INDEXER_RECONCILE_INTERVAL_MS));
const RECONCILE_MAX_EPOCHS_PER_PASS = Number(process.env.INDEXER_RECONCILE_MAX_EPOCHS_PER_PASS ?? String(DEFAULT_INDEXER_RECONCILE_MAX_EPOCHS_PER_PASS));

let lastReconcileAtMs = 0;

type IndexerRunStatus = {
  startedAt: number;
  completedAt?: number;
  lastHeartbeatAt?: number;
  fromBlock: string;
  toBlock: string;
  totalLogs: number;
  currentChunk?: number;
  totalChunks?: number;
  lastProcessedBlock?: string;
};

type IndexerRepairStatus = {
  at: number;
  fromBlock: string;
  toBlock: string;
  repairedLogs: number;
};

type IndexerReconcileStatus = {
  at: number;
  currentEpoch: number;
  missingEpochs: number;
  repairedEpochs: number;
  targetEpochs: number[];
};

const EVENTS_ABI = parseAbi([
  "event BetPlaced(uint256 indexed epoch, address indexed user, uint256 indexed tileId, uint256 amount)",
  "event BatchBetsPlaced(uint256 indexed epoch, address indexed user, uint256[] tileIds, uint256[] amounts, uint256 totalAmount)",
  "event BatchBetsSameAmountPlaced(uint256 indexed epoch, address indexed user, uint256[] tileIds, uint256 amount, uint256 totalAmount)",
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

const READ_ABI = parseAbi([
  "function currentEpoch() view returns (uint256)",
  "function epochs(uint256) view returns (uint256 totalPool, uint256 rewardPool, uint256 winningTile, bool isResolved, bool isDailyJackpot, bool isWeeklyJackpot)",
]);

const client = createPublicClient({
  chain: APP_CHAIN,
  transport: fallback(
    getPreferredLineaRpcs(
      process.env.KEEPER_RPC_URL ?? getDefaultLineaRpcs(APP_NETWORK)[0],
      APP_NETWORK,
    ).map((url) => http(url, {
      timeout: 30_000,
      retryCount: 0,
    })),
    { rank: true },
  ),
});

// ─── Firebase REST helpers ───────────────────────────────────────────
async function fbGet<T = unknown>(path: string): Promise<T | null> {
  return readJsonPath<T>(path);
}

async function fbPatch(path: string, data: Record<string, unknown>) {
  patchJsonPath(path, data);
}

async function fbPut(path: string, data: unknown) {
  putJsonPath(path, data);
}

function setIndexerStatus(key: string, value: unknown) {
  setMetaJson(key, value);
}

// ─── Event topic signatures ─────────────────────────────────────────
const [betSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "BetPlaced" });
const [batchSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "BatchBetsPlaced" });
const [batchSameAmountSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "BatchBetsSameAmountPlaced" });
const [resolvedSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "EpochResolved" });
const [dailySig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "DailyJackpotAwarded" });
const [weeklySig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "WeeklyJackpotAwarded" });
const [rewardClaimedSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "RewardClaimed" });
const [rewardBatchClaimedSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "RewardBatchClaimed" });
const [rebateClaimedSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "RebateClaimed" });
const [rebateBatchClaimedSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "RebateBatchClaimed" });
const [resolverRewardAccruedSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "ResolverRewardAccrued" });
const [resolverRewardClaimedSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "ResolverRewardClaimed" });
const [feesFlushedSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "ProtocolFeesFlushed" });

// ─── Chunked log fetcher ────────────────────────────────────────────
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRpcTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null;
  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`${label} timed out after ${RPC_CALL_TIMEOUT_MS}ms`));
        }, RPC_CALL_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

async function fetchLogsRequestWithRetry(
  topics: Array<`0x${string}`>,
  from: bigint,
  to: bigint,
  kind: "log fetch" | "indexed log fetch",
): Promise<Log[]> {
  for (let attempt = 0; attempt < RETRY_COUNT; attempt++) {
    try {
      const request = {
        address: CONTRACT,
        topics,
        fromBlock: from,
        toBlock: to,
      } as unknown as Parameters<typeof client.getLogs>[0];
      return await withRpcTimeout(client.getLogs(request), `getLogs(${from}-${to})`);
    } catch (err) {
      const msg = (err as Error).message?.slice(0, 80) ?? "unknown";
      if (attempt < RETRY_COUNT - 1) {
        const wait = RETRY_DELAY_MS * (attempt + 1);
        console.warn(`  [retry ${attempt + 1}/${RETRY_COUNT}] ${from}-${to}: ${msg} — wait ${wait}ms`);
        await delay(wait);
      } else {
        throw new Error(`${kind} failed for ${from}-${to} after ${RETRY_COUNT} retries: ${msg}`);
      }
    }
  }
  throw new Error(`${kind} failed for ${from}-${to}: exhausted retries`);
}

async function fetchLogsRequestAdaptive(
  topics: Array<`0x${string}`>,
  label: string,
  from: bigint,
  to: bigint,
): Promise<Log[]> {
  for (let attempt = 0; attempt < RETRY_COUNT; attempt++) {
    try {
      const request = {
        address: CONTRACT,
        topics,
        fromBlock: from,
        toBlock: to,
      } as unknown as Parameters<typeof client.getLogs>[0];
      return await withRpcTimeout(client.getLogs(request), `getLogs(${from}-${to})`);
    } catch (err) {
      const msg = (err as Error).message?.slice(0, 80) ?? "unknown";
      if (attempt < RETRY_COUNT - 1) {
        const wait = RETRY_DELAY_MS * (attempt + 1);
        console.warn(`  [retry ${attempt + 1}/${RETRY_COUNT}] ${from}-${to}: ${msg} — wait ${wait}ms`);
        await delay(wait);
      } else {
        throw new Error(`indexed log fetch failed for ${from}-${to} after ${RETRY_COUNT} retries: ${msg}`);
      }
    }
  }
  throw new Error(`indexed log fetch failed for ${from}-${to}: exhausted retries`);
}
void fetchLogsRequestAdaptive;

async function fetchLogsRequestAdaptiveSplit(
  topics: Array<`0x${string}`>,
  label: string,
  from: bigint,
  to: bigint,
): Promise<Log[]> {
  const kind = topics.length === 1 ? "log fetch" : "indexed log fetch";
  try {
    return await fetchLogsRequestWithRetry(topics, from, to, kind);
  } catch (err) {
    const span = to - from + 1n;
    if (span <= MIN_ADAPTIVE_LOG_RANGE_BLOCKS) {
      throw err;
    }
    const leftTo = from + (span / 2n) - 1n;
    const rightFrom = leftTo + 1n;
    console.warn(
      `  [split] ${label} ${from}-${to}: ${(err as Error).message}. splitting into ${from}-${leftTo} and ${rightFrom}-${to}`,
    );
    const left = await fetchLogsRequestAdaptiveSplit(topics, `${label}:L`, from, leftTo);
    if (rightFrom <= to) {
      await delay(INTER_CHUNK_DELAY_MS);
    }
    const right =
      rightFrom <= to
        ? await fetchLogsRequestAdaptiveSplit(topics, `${label}:R`, rightFrom, to)
        : [];
    return [...left, ...right];
  }
}

async function fetchLogsByTopicsAdaptive(
  topics: Array<`0x${string}`>,
  label: string,
  from: bigint,
  to: bigint,
): Promise<Log[]> {
  return fetchLogsRequestAdaptiveSplit(topics, label, from, to);
}

async function fetchLogTopicAdaptive(
  topic: `0x${string}`,
  label: string,
  from: bigint,
  to: bigint,
): Promise<Log[]> {
  return fetchLogsRequestAdaptiveSplit([topic], label, from, to);
}

async function fetchLogsByTopicsChunked(
  topics: Array<`0x${string}`>,
  label: string,
  from: bigint,
  to: bigint,
  chunkSize = RECONCILE_SCAN_CHUNK_BLOCKS,
): Promise<Log[]> {
  const all: Log[] = [];
  const ranges: Array<{ from: bigint; to: bigint }> = [];
  for (let f = from; f <= to; f += chunkSize) {
    const t = f + chunkSize - 1n > to ? to : f + chunkSize - 1n;
    ranges.push({ from: f, to: t });
  }

  for (let i = 0; i < ranges.length; i += 1) {
    const range = ranges[i];
    const logs = await fetchLogsByTopicsAdaptive(
      topics,
      `${label}:${i + 1}/${ranges.length}`,
      range.from,
      range.to,
    );
    all.push(...logs);
    if (i < ranges.length - 1) await delay(INTER_CHUNK_DELAY_MS);
    if ((i + 1) % 10 === 0 || i === ranges.length - 1) {
      console.log(`  [${label}] ${i + 1}/${ranges.length} chunks, ${all.length} logs`);
    }
  }

  return all;
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
    const logs = await fetchLogTopicAdaptive(
      topic,
      `${label}:${i + 1}/${ranges.length}`,
      r.from,
      r.to,
    );
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
    { sig: batchSameAmountSig, label: "BatchBetsSameAmount" },
    { sig: resolvedSig, label: "EpochResolved" },
    { sig: dailySig, label: "DailyJackpot" },
    { sig: weeklySig, label: "WeeklyJackpot" },
    { sig: rewardClaimedSig, label: "RewardClaimed" },
    { sig: rewardBatchClaimedSig, label: "RewardBatchClaimed" },
    { sig: rebateClaimedSig, label: "RebateClaimed" },
    { sig: rebateBatchClaimedSig, label: "RebateBatchClaimed" },
    { sig: resolverRewardAccruedSig, label: "ResolverRewardAccrued" },
    { sig: resolverRewardClaimedSig, label: "ResolverRewardClaimed" },
    { sig: feesFlushedSig, label: "ProtocolFeesFlushed" },
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

interface RewardClaimRecord {
  id: string;
  epoch: string;
  user: string;
  reward: string;
  rewardNum: number;
  txHash: string;
  blockNumber: string;
}

interface FeeFlushRecord {
  id: string;
  ownerAmount: string;
  burnAmount: string;
  txHash: string;
  blockNumber: string;
}

interface BatchClaimRecord {
  id: string;
  kind: "reward" | "rebate";
  user: string;
  totalAmount: string;
  epochsClaimed: number;
  txHash: string;
  blockNumber: string;
}

interface ResolverRewardRecord {
  id: string;
  kind: "accrued" | "claimed";
  resolver: string;
  epoch?: string;
  amount: string;
  txHash: string;
  blockNumber: string;
}

function buildBetKey(epoch: string, txHash: string, blockNumber: string): string {
  const normalizedHash = txHash.toLowerCase().trim();
  if (/^0x[0-9a-f]+$/.test(normalizedHash)) {
    return `${epoch}_${normalizedHash}`;
  }
  return `${epoch}_nohash_${blockNumber}`;
}

function normalizeBetRecord(bet: BetRecord): BetRecord {
  if (bet.tileIds.length === 0) {
    return { ...bet, amounts: [] };
  }

  const normalizedAmounts =
    Array.isArray(bet.amounts) && bet.amounts.length === bet.tileIds.length
      ? bet.amounts.map((value) => {
          const parsed = Number.parseFloat(String(value));
          return Number.isFinite(parsed) ? parsed : 0;
        })
      : bet.tileIds.map(() => bet.totalAmountNum / bet.tileIds.length);

  const aggregate = new Map<number, number>();
  for (let index = 0; index < bet.tileIds.length; index += 1) {
    const tileId = Number(bet.tileIds[index]);
    if (!Number.isInteger(tileId) || tileId <= 0 || tileId > 25) continue;
    aggregate.set(tileId, (aggregate.get(tileId) ?? 0) + (normalizedAmounts[index] ?? 0));
  }

  return {
    ...bet,
    tileIds: [...aggregate.keys()],
    amounts: [...aggregate.values()].map((value) => String(value)),
  };
}

function processLogs(logs: Log[]) {
  const bets: BetRecord[] = [];
  const epochs: Map<string, EpochRecord> = new Map();
  const jackpots: JackpotRecord[] = [];
  const rewardClaims: RewardClaimRecord[] = [];
  const feeFlushes: FeeFlushRecord[] = [];
  const batchClaims: BatchClaimRecord[] = [];
  const resolverRewards: ResolverRewardRecord[] = [];

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
      } else if (topic0 === batchSameAmountSig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "BatchBetsSameAmountPlaced") continue;
        const args = decoded.args as {
          epoch: bigint; user: string; tileIds: bigint[]; amount: bigint; totalAmount: bigint;
        };
        const formattedAmount = formatUnits(args.amount, 18);
        bets.push({
          epoch: args.epoch.toString(),
          user: args.user.toLowerCase(),
          tileIds: args.tileIds.map(Number),
          amounts: args.tileIds.map(() => formattedAmount),
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
      } else if (topic0 === rewardClaimedSig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "RewardClaimed") continue;
        const args = decoded.args as { epoch: bigint; user: string; reward: bigint };
        rewardClaims.push({
          id: `${log.transactionHash ?? "nohash"}_${log.logIndex?.toString() ?? "0"}`,
          epoch: args.epoch.toString(),
          user: args.user.toLowerCase(),
          reward: formatUnits(args.reward, 18),
          rewardNum: parseFloat(formatUnits(args.reward, 18)),
          txHash: log.transactionHash ?? "",
          blockNumber: (log.blockNumber ?? 0n).toString(),
        });
      } else if (topic0 === rewardBatchClaimedSig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "RewardBatchClaimed") continue;
        const args = decoded.args as { user: string; totalAmount: bigint; epochsClaimed: bigint };
        batchClaims.push({
          id: `${log.transactionHash ?? "nohash"}_${log.logIndex?.toString() ?? "0"}`,
          kind: "reward",
          user: args.user.toLowerCase(),
          totalAmount: formatUnits(args.totalAmount, 18),
          epochsClaimed: Number(args.epochsClaimed),
          txHash: log.transactionHash ?? "",
          blockNumber: (log.blockNumber ?? 0n).toString(),
        });
      } else if (topic0 === rebateClaimedSig) {
        continue;
      } else if (topic0 === rebateBatchClaimedSig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "RebateBatchClaimed") continue;
        const args = decoded.args as { user: string; amount: bigint; epochsClaimed: bigint };
        batchClaims.push({
          id: `${log.transactionHash ?? "nohash"}_${log.logIndex?.toString() ?? "0"}`,
          kind: "rebate",
          user: args.user.toLowerCase(),
          totalAmount: formatUnits(args.amount, 18),
          epochsClaimed: Number(args.epochsClaimed),
          txHash: log.transactionHash ?? "",
          blockNumber: (log.blockNumber ?? 0n).toString(),
        });
      } else if (topic0 === resolverRewardAccruedSig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "ResolverRewardAccrued") continue;
        const args = decoded.args as { resolver: string; epoch: bigint; amount: bigint };
        resolverRewards.push({
          id: `${log.transactionHash ?? "nohash"}_${log.logIndex?.toString() ?? "0"}`,
          kind: "accrued",
          resolver: args.resolver.toLowerCase(),
          epoch: args.epoch.toString(),
          amount: formatUnits(args.amount, 18),
          txHash: log.transactionHash ?? "",
          blockNumber: (log.blockNumber ?? 0n).toString(),
        });
      } else if (topic0 === resolverRewardClaimedSig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "ResolverRewardClaimed") continue;
        const args = decoded.args as { resolver: string; amount: bigint };
        resolverRewards.push({
          id: `${log.transactionHash ?? "nohash"}_${log.logIndex?.toString() ?? "0"}`,
          kind: "claimed",
          resolver: args.resolver.toLowerCase(),
          amount: formatUnits(args.amount, 18),
          txHash: log.transactionHash ?? "",
          blockNumber: (log.blockNumber ?? 0n).toString(),
        });
      } else if (topic0 === feesFlushedSig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "ProtocolFeesFlushed") continue;
        const args = decoded.args as { ownerAmount: bigint; burnAmount: bigint };
        feeFlushes.push({
          id: `${log.transactionHash ?? "nohash"}_${log.logIndex?.toString() ?? "0"}`,
          ownerAmount: formatUnits(args.ownerAmount, 18),
          burnAmount: formatUnits(args.burnAmount, 18),
          txHash: log.transactionHash ?? "",
          blockNumber: (log.blockNumber ?? 0n).toString(),
        });
      }
    } catch (err) {
      console.warn("[indexer] Failed to decode log in processLogs:", (err as Error).message ?? err);
    }
  }

  return {
    bets,
    epochs,
    jackpots,
    rewardClaims,
    feeFlushes,
    batchClaims,
    resolverRewards,
  };
}

// Write to local SQLite
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
      const normalizedBet = normalizeBetRecord(bet);
      const key = buildBetKey(normalizedBet.epoch, normalizedBet.txHash, normalizedBet.blockNumber);
      patch[key] = {
        epoch: normalizedBet.epoch,
        tileIds: normalizedBet.tileIds,
        amounts: normalizedBet.amounts,
        totalAmount: normalizedBet.totalAmount,
        totalAmountNum: normalizedBet.totalAmountNum,
        txHash: normalizedBet.txHash,
        blockNumber: normalizedBet.blockNumber,
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

async function writeRewardClaims(rewardClaims: RewardClaimRecord[]) {
  if (rewardClaims.length === 0) return;
  const rows: RewardClaimStorageRow[] = rewardClaims.map((row) => ({
    id: row.id,
    epoch: row.epoch,
    user: row.user,
    reward: row.reward,
    rewardNum: row.rewardNum,
    txHash: row.txHash,
    blockNumber: row.blockNumber,
  }));
  upsertRewardClaims(rows);
}

async function writeBatchClaims(records: BatchClaimRecord[]) {
  if (records.length === 0) return;
  const patch: Record<string, unknown> = {};
  for (const row of records) {
    patch[row.id] = row;
  }
  await fbPatch("gamedata/batchClaims", patch);
}

async function writeResolverRewards(records: ResolverRewardRecord[]) {
  if (records.length === 0) return;
  const patch: Record<string, unknown> = {};
  for (const row of records) {
    patch[row.id] = row;
  }
  await fbPatch("gamedata/resolverRewards", patch);
}

async function writeFeeFlushes(feeFlushes: FeeFlushRecord[]) {
  if (feeFlushes.length === 0) return;
  const rows: FeeFlushStorageRow[] = feeFlushes.map((row) => ({
    id: row.id,
    ownerAmount: row.ownerAmount,
    burnAmount: row.burnAmount,
    txHash: row.txHash,
    blockNumber: row.blockNumber,
  }));
  upsertProtocolFeeFlushes(rows);
}

async function setLastBlock(block: bigint) {
  await fbPut("gamedata/_meta/lastIndexedBlock", block.toString());
}

async function updateCurrentEpochMeta() {
  try {
    const currentEpoch = await withRpcTimeout(client.readContract({
      address: CONTRACT,
      abi: READ_ABI,
      functionName: "currentEpoch",
    }), "read currentEpoch");
    await fbPut("gamedata/_meta/currentEpoch", Number(currentEpoch));
  } catch (err) {
    console.warn("[indexer] Could not read currentEpoch from contract:", (err as Error).message);
  }
}

async function getCurrentEpochFromChain() {
  return await withRpcTimeout(client.readContract({
    address: CONTRACT,
    abi: READ_ABI,
    functionName: "currentEpoch",
  }), "read currentEpoch");
}

async function getLastBlock(): Promise<bigint> {
  const val = await fbGet<string>("gamedata/_meta/lastIndexedBlock");
  if (!val) {
    console.warn("[indexer] Missing gamedata/_meta/lastIndexedBlock, falling back to INDEXER_START_BLOCK.");
    return INDEXER_START_BLOCK;
  }
  try {
    return BigInt(val);
  } catch {
    console.warn(`[indexer] Invalid gamedata/_meta/lastIndexedBlock value: ${val}. Falling back to INDEXER_START_BLOCK.`);
    return INDEXER_START_BLOCK;
  }
}

async function getRepairCursorBlock(): Promise<bigint> {
  const val = await fbGet<string>("gamedata/_meta/repairCursorBlock");
  if (!val) {
    console.warn("[indexer] Missing gamedata/_meta/repairCursorBlock, falling back to INDEXER_START_BLOCK.");
    return INDEXER_START_BLOCK;
  }
  try {
    return BigInt(val);
  } catch {
    console.warn(`[indexer] Invalid gamedata/_meta/repairCursorBlock value: ${val}. Falling back to INDEXER_START_BLOCK.`);
    return INDEXER_START_BLOCK;
  }
}

async function setRepairCursorBlock(block: bigint) {
  await fbPut("gamedata/_meta/repairCursorBlock", block.toString());
}

async function runRepairPass(currentBlock: bigint) {
  let from = await getRepairCursorBlock();
  if (from < INDEXER_START_BLOCK) from = INDEXER_START_BLOCK;

  if (from > currentBlock) {
    const status: IndexerRepairStatus = {
      at: Date.now(),
      fromBlock: from.toString(),
      toBlock: currentBlock.toString(),
      repairedLogs: 0,
    };
    setIndexerStatus("indexerRepairStatus", status);
    await updateCurrentEpochMeta();
    return 0;
  }

  const to = from + REPAIR_CHUNK_BLOCKS - 1n > currentBlock
    ? currentBlock
    : from + REPAIR_CHUNK_BLOCKS - 1n;

  console.log(`[indexer][repair] Scanning ${from} → ${to} (${to - from + 1n} blocks)`);

  const logs = await fetchAllLogs(from, to);
  if (logs.length > 0) {
    const { bets, epochs, jackpots, rewardClaims, feeFlushes, batchClaims, resolverRewards } = processLogs(logs);
    await writeBets(bets);
    await writeEpochs(epochs);
    await writeJackpots(jackpots);
    await writeRewardClaims(rewardClaims);
    await writeFeeFlushes(feeFlushes);
    await writeBatchClaims(batchClaims);
    await writeResolverRewards(resolverRewards);
    console.log(`[indexer][repair] Repaired ${logs.length} logs (${bets.length} bets, ${epochs.size} epochs, ${jackpots.length} jackpots, ${rewardClaims.length} claims)`);
  } else {
    console.log("[indexer][repair] No logs in this range");
  }

  await setRepairCursorBlock(to + 1n);
  await updateCurrentEpochMeta();
  const status: IndexerRepairStatus = {
    at: Date.now(),
    fromBlock: from.toString(),
    toBlock: to.toString(),
    repairedLogs: logs.length,
  };
  setIndexerStatus("indexerRepairStatus", status);
  return logs.length;
}

async function runEpochReconcile(currentBlock: bigint) {
  const now = Date.now();
  if (now - lastReconcileAtMs < RECONCILE_INTERVAL_MS) return 0;
  lastReconcileAtMs = now;

  const currentEpoch = await getCurrentEpochFromChain();
  await fbPut("gamedata/_meta/currentEpoch", Number(currentEpoch));

  if (currentEpoch <= 1n) {
    const status: IndexerReconcileStatus = {
      at: now,
      currentEpoch: Number(currentEpoch),
      missingEpochs: 0,
      repairedEpochs: 0,
      targetEpochs: [],
    };
    setIndexerStatus("indexerReconcileStatus", status);
    return 0;
  }

  const rawEpochs = (await fbGet<Record<string, EpochRecord>>("gamedata/epochs")) ?? {};
  const have = new Set<number>();
  for (const key of Object.keys(rawEpochs)) {
    const n = Number(key);
    if (Number.isInteger(n) && n > 0) have.add(n);
  }

  const missing: number[] = [];
  for (let ep = 1; ep < Number(currentEpoch); ep++) {
    if (!have.has(ep)) missing.push(ep);
  }
  if (missing.length === 0) {
    console.log("[indexer][reconcile] No missing epochs");
    const status: IndexerReconcileStatus = {
      at: now,
      currentEpoch: Number(currentEpoch),
      missingEpochs: 0,
      repairedEpochs: 0,
      targetEpochs: [],
    };
    setIndexerStatus("indexerReconcileStatus", status);
    return 0;
  }

  const reconcileBatchSize =
    missing.length <= 32
      ? missing.length
      : missing.length <= 128
        ? Math.max(RECONCILE_MAX_EPOCHS_PER_PASS, 16)
        : Math.max(1, RECONCILE_MAX_EPOCHS_PER_PASS);
  const targets = missing.slice(-reconcileBatchSize);
  console.log(`[indexer][reconcile] Missing epochs: ${missing.length}, repairing now: ${targets.join(", ")}`);
  setIndexerStatus("indexerReconcileStatus", {
    at: Date.now(),
    currentEpoch: Number(currentEpoch),
    missingEpochs: missing.length,
    repairedEpochs: 0,
    targetEpochs: targets,
  } satisfies IndexerReconcileStatus);

  const epochsPatch = new Map<string, EpochRecord>();
  for (const epNum of targets) {
    const epTopic = toHex(BigInt(epNum), { size: 32 });
    const recentFrom =
      currentBlock > RECONCILE_RECENT_LOOKBACK_BLOCKS
        ? currentBlock - RECONCILE_RECENT_LOOKBACK_BLOCKS
        : INDEXER_START_BLOCK;
    let logs = await fetchLogsByTopicsChunked(
      [resolvedSig, epTopic],
      `EpochResolved:${epNum}:recent`,
      recentFrom,
      currentBlock,
    );
    if (logs.length === 0 && recentFrom > INDEXER_START_BLOCK) {
      console.log(`[indexer][reconcile] Epoch ${epNum} not found in recent tail, falling back to full scan`);
      logs = await fetchLogsByTopicsChunked(
        [resolvedSig, epTopic],
        `EpochResolved:${epNum}:full`,
        INDEXER_START_BLOCK,
        recentFrom - 1n,
      );
    }
    if (logs.length === 0) continue;

    let isDailyJackpot = false;
    let isWeeklyJackpot = false;
    try {
      const epochState = await withRpcTimeout(client.readContract({
        address: CONTRACT,
        abi: READ_ABI,
        functionName: "epochs",
        args: [BigInt(epNum)],
      }), `read epochs(${epNum})`) as [bigint, bigint, bigint, boolean, boolean, boolean];
      isDailyJackpot = Boolean(epochState[4]);
      isWeeklyJackpot = Boolean(epochState[5]);
    } catch (err) {
      console.warn(`[indexer][reconcile] Could not read jackpot flags for epoch ${epNum}: ${(err as Error).message}`);
    }

    // Keep last resolved log for epoch (safety)
    const log = logs[logs.length - 1];
    try {
      const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
      if (decoded.eventName !== "EpochResolved") continue;
      const args = decoded.args as {
        epoch: bigint; winningTile: bigint; totalPool: bigint; fee: bigint; rewardPool: bigint; jackpotBonus: bigint;
      };
      epochsPatch.set(args.epoch.toString(), {
        winningTile: Number(args.winningTile),
        totalPool: formatUnits(args.totalPool, 18),
        rewardPool: formatUnits(args.rewardPool, 18),
        fee: formatUnits(args.fee, 18),
        jackpotBonus: formatUnits(args.jackpotBonus, 18),
        isDailyJackpot,
        isWeeklyJackpot,
        resolvedBlock: (log.blockNumber ?? 0n).toString(),
      });
    } catch (err) {
      console.warn("[indexer][reconcile] Failed to decode epoch log:", (err as Error).message ?? err);
    }
    await delay(targets.length <= 8 ? 50 : 150);
  }

  if (epochsPatch.size > 0) {
    await writeEpochs(epochsPatch);
    console.log(`[indexer][reconcile] Repaired ${epochsPatch.size} epochs`);
    const status: IndexerReconcileStatus = {
      at: Date.now(),
      currentEpoch: Number(currentEpoch),
      missingEpochs: missing.length,
      repairedEpochs: epochsPatch.size,
      targetEpochs: targets,
    };
    setIndexerStatus("indexerReconcileStatus", status);
    return epochsPatch.size;
  }
  console.log("[indexer][reconcile] No resolvable missing epochs in this pass");
  const status: IndexerReconcileStatus = {
    at: Date.now(),
    currentEpoch: Number(currentEpoch),
    missingEpochs: missing.length,
    repairedEpochs: 0,
    targetEpochs: targets,
  };
  setIndexerStatus("indexerReconcileStatus", status);
  return 0;
}

// ─── Main loop ──────────────────────────────────────────────────────
async function runOnce() {
  const lastBlock = await getLastBlock();
  const currentBlock = await withRpcTimeout(client.getBlockNumber(), "getBlockNumber");

  const fromBlock = lastBlock + 1n;
  const startedAt = Date.now();
  if (fromBlock > currentBlock) {
    const status: IndexerRunStatus = {
      startedAt,
      lastHeartbeatAt: startedAt,
      completedAt: Date.now(),
      fromBlock: fromBlock.toString(),
      toBlock: currentBlock.toString(),
      totalLogs: 0,
      currentChunk: 0,
      totalChunks: 0,
      lastProcessedBlock: lastBlock.toString(),
    };
    setIndexerStatus("indexerRunStatus", status);
    return 0;
  }

  console.log(`[indexer] Scanning blocks ${fromBlock} → ${currentBlock} (${currentBlock - fromBlock + 1n} blocks)`);

  let totalLogs = 0;
  let chunkCount = 0;
  for (let start = fromBlock; start <= currentBlock; start += RUN_CHUNK_BLOCKS) {
    chunkCount += 1;
  }

  let chunkIndex = 0;
  setIndexerStatus("indexerRunStatus", {
    startedAt,
    lastHeartbeatAt: startedAt,
    fromBlock: fromBlock.toString(),
    toBlock: currentBlock.toString(),
    totalLogs: 0,
    currentChunk: 0,
    totalChunks: chunkCount,
    lastProcessedBlock: lastBlock.toString(),
  } satisfies IndexerRunStatus);
  for (let start = fromBlock; start <= currentBlock; start += RUN_CHUNK_BLOCKS) {
    const end = start + RUN_CHUNK_BLOCKS - 1n > currentBlock
      ? currentBlock
      : start + RUN_CHUNK_BLOCKS - 1n;
    chunkIndex += 1;

    console.log(`[indexer] Chunk ${chunkIndex}/${chunkCount}: ${start} -> ${end}`);
    const logs = await fetchAllLogs(start, end);
    totalLogs += logs.length;
    console.log(`[indexer] Chunk ${chunkIndex}/${chunkCount} fetched ${logs.length} logs`);

    if (logs.length > 0) {
      const { bets, epochs, jackpots, rewardClaims, feeFlushes, batchClaims, resolverRewards } = processLogs(logs);
      console.log(`[indexer] Chunk ${chunkIndex}/${chunkCount} parsed: ${bets.length} bets, ${epochs.size} epochs, ${jackpots.length} jackpots, ${rewardClaims.length} claims`);

      await writeBets(bets);
      await writeEpochs(epochs);
      await writeJackpots(jackpots);
      await writeRewardClaims(rewardClaims);
      await writeFeeFlushes(feeFlushes);
      await writeBatchClaims(batchClaims);
      await writeResolverRewards(resolverRewards);
      console.log(`[indexer] Chunk ${chunkIndex}/${chunkCount} written to local SQLite`);
    }

    await setLastBlock(end);
    await updateCurrentEpochMeta();
    setIndexerStatus("indexerRunStatus", {
      startedAt,
      lastHeartbeatAt: Date.now(),
      fromBlock: fromBlock.toString(),
      toBlock: currentBlock.toString(),
      totalLogs,
      currentChunk: chunkIndex,
      totalChunks: chunkCount,
      lastProcessedBlock: end.toString(),
    } satisfies IndexerRunStatus);
  }

  console.log(`[indexer] Finished runOnce with ${totalLogs} logs`);
  await updateCurrentEpochMeta();
  const status: IndexerRunStatus = {
    startedAt,
    lastHeartbeatAt: Date.now(),
    completedAt: Date.now(),
    fromBlock: fromBlock.toString(),
    toBlock: currentBlock.toString(),
    totalLogs,
    currentChunk: chunkCount,
    totalChunks: chunkCount,
    lastProcessedBlock: currentBlock.toString(),
  };
  setIndexerStatus("indexerRunStatus", status);
  return totalLogs;
}

async function main() {
  const isWatch = process.argv.includes("--watch");
  console.log(`[indexer] SQLite path: ${process.env.LORE_DB_PATH ?? "data/lore.sqlite"}`);
  console.log(`[indexer] Contract: ${CONTRACT}`);
  console.log(`[indexer] Deploy block: ${DEPLOY_BLOCK}`);
  console.log(`[indexer] Start block: ${INDEXER_START_BLOCK}`);
  console.log(`[indexer] Mode: ${isWatch ? "watch (continuous)" : "one-shot"}`);

  await runOnce();
  {
    const head = await withRpcTimeout(client.getBlockNumber(), "getBlockNumber");
    await runRepairPass(head);
    await runEpochReconcile(head);
  }

  if (isWatch) {
    console.log(`[indexer] Watching for new blocks every ${POLL_INTERVAL_MS / 1000}s...`);
    let running = false;
    setInterval(async () => {
      if (running) return;
      running = true;
      try {
        await runOnce();
        const head = await withRpcTimeout(client.getBlockNumber(), "getBlockNumber");
        await runRepairPass(head);
        await runEpochReconcile(head);
      } catch (err) {
        console.error(`[indexer] Error in watch loop:`, (err as Error).message);
      } finally {
        running = false;
      }
    }, POLL_INTERVAL_MS);
  }
}

main().catch((err) => {
  console.error("[indexer] Fatal:", err);
  process.exit(1);
});
