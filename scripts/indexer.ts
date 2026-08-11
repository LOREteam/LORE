/**
 * Blockchain event indexer.
 * Scans contract events and writes structured local storage / SQLite data
 * so the frontend can serve indexed API responses without scanning blocks.
 *
 * Run: npx tsx scripts/indexer.ts          (one-shot, catches up)
 * Or with --watch flag for continuous mode (polls every 15s).
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import {
  createPublicClient,
  http,
  decodeEventLog,
  formatUnits,
  encodeEventTopics,
  toHex,
  type Log,
} from "viem";
import {
  GAME_ABI as READ_ABI,
  GAME_EVENTS_ABI as EVENTS_ABI,
} from "../config/generated/lineaOreV10Abi";
import {
  DEFAULT_INDEXER_RECONCILE_INTERVAL_MS,
  DEFAULT_INDEXER_RECONCILE_MAX_EPOCHS_PER_PASS,
  getConfiguredContractAddress,
  getConfiguredDeployBlock,
  getConfiguredLineaNetwork,
  getDefaultLineaRpcs,
  getLineaChain,
  getStableLineaReadRpcs,
} from "../config/publicConfig";
import { assertProductionRuntimeConfig } from "../config/productionRuntime";
import {
  parseOptionalNonNegativeBigIntEnv,
  parseOptionalPositiveIntegerEnv,
  parseOptionalPositiveIntegerInRangeEnv,
} from "../config/envParsing";
import { tileMaskToTileIds } from "../app/lib/tileMask";
import { normalizeTileAmounts } from "../app/lib/tokenAmountMath";
import { getIndexerFinalityTargetBlock, parseIndexerFinalityBlocks } from "../app/lib/indexerFinality";
import { parseIndexerWatchFailureLimit, recordIndexerWatchFailure } from "../app/lib/indexerWatchPolicy";
import { sanitizeSentryPayload } from "../app/lib/sentrySanitize";
import {
  acquireIndexerLease,
  buildIndexerBetIdentity,
  commitIndexerChunk,
  getIndexerBlockCheckpoints,
  getMetaJsonStrict,
  heartbeatIndexerLease,
  normalizeIndexerLogIndex,
  patchJsonPath,
  putJsonPath,
  readJsonPath,
  releaseIndexerLease,
  rollbackIndexerToBlock,
  runIndexerStorageTransaction,
  setMetaJson,
  upsertProtocolFeeFlushes,
  upsertRewardClaims,
  type FeeFlushStorageRow,
  type IndexerBlockCheckpoint,
  type RewardClaimStorageRow,
} from "../server/storage";
import {
  findLatestCanonicalCheckpoint,
  normalizeBlockHash,
  verifyCanonicalLogBlockHashes,
} from "./indexerForkRecovery";
import {
  awaitExactRpcAgreement,
  createBoundedBackwardBlockScanPlan,
  createBoundedIndexerRpcFetch,
  createBoundedIndexerRunPlan,
  createIndexerRpcWorkBudget,
  createReconcileEpochPlan,
  isIndexerRpcResponseLimitError,
  isIndexerRpcWorkBudgetError,
  parseIndexerCatchupChunkBlocks,
  parsePlausibleCurrentEpoch,
  reduceIndexerCatchupChunkBlocks,
  requireIndependentRpcUrls,
  type IndexerRpcWorkBudget,
  validateRpcLogSet,
} from "./indexerSafety";

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
const MAX_RUN_HEAD_GAP_BLOCKS = 100_000n;
const MAX_RUN_CHUNKS = 20;
// Sepolia public RPC rejects 20k eth_getLogs ranges; 10k avoids retry splitting.
const REPAIR_CHUNK_BLOCKS = 10_000n;
// Reconcile adds indexed topic filters, so keep it within the proven regular fetch limit.
const RECONCILE_SCAN_CHUNK_BLOCKS = CHUNK_BLOCKS;
const RECONCILE_RECENT_LOOKBACK_BLOCKS = 150_000n;
const RECONCILE_RECENT_EPOCH_WINDOW = 32;
const RECONCILE_MAX_EPOCHS_HARD_CAP = 32;
const RECONCILE_FULL_SCAN_MAX_CHUNKS_PER_PASS = 8;
const INDEXER_RUN_MAX_RPC_CALLS = 512;
const INDEXER_RUN_MAX_LOGS = 16_384;
const INDEXER_RPC_MAX_LOGS_PER_RESPONSE = Math.floor(INDEXER_RUN_MAX_LOGS / 3);
const INDEXER_RUN_MAX_SPLIT_NODES = 64;
const INDEXER_RUN_MAX_ELAPSED_MS = 60_000;
const INDEXER_CATCHUP_CHUNK_BLOCKS_META_KEY = "indexerCatchupChunkBlocks";
const RECONCILE_BLOCK_CURSOR_META_KEY = "indexerReconcileBlockCursor";
const POLL_INTERVAL_MS = 15_000;
const INDEXER_LEASE_TTL_MS = 60_000;
const INDEXER_LEASE_HEARTBEAT_INTERVAL_MS = 15_000;
const RETRY_COUNT = 5;
const RETRY_DELAY_MS = 5_000;
const MAX_TILE_ID = 25;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const CANONICAL_INDEXED_EPOCH_RE = /^[1-9]\d{0,15}$/;

function describeIndexerError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "unknown");
  return sanitizeSentryPayload(message).slice(0, 160);
}
const INTER_CHUNK_DELAY_MS = 400;
const RPC_CALL_TIMEOUT_MS = parseOptionalPositiveIntegerEnv(process.env.INDEXER_RPC_TIMEOUT_MS, 45_000);
const MIN_ADAPTIVE_LOG_RANGE_BLOCKS = parseOptionalNonNegativeBigIntEnv(process.env.INDEXER_MIN_ADAPTIVE_LOG_RANGE_BLOCKS, 250n);
const INDEXER_FINALITY_BLOCKS = parseIndexerFinalityBlocks(process.env.INDEXER_FINALITY_BLOCKS);
const WATCH_FAILURE_LIMIT = parseIndexerWatchFailureLimit(process.env.INDEXER_WATCH_FAILURE_LIMIT);
const RECONCILE_INTERVAL_MS = parseOptionalPositiveIntegerEnv(
  process.env.INDEXER_RECONCILE_INTERVAL_MS,
  DEFAULT_INDEXER_RECONCILE_INTERVAL_MS,
);
const RECONCILE_MAX_EPOCHS_PER_PASS = parseOptionalPositiveIntegerInRangeEnv(
  process.env.INDEXER_RECONCILE_MAX_EPOCHS_PER_PASS,
  DEFAULT_INDEXER_RECONCILE_MAX_EPOCHS_PER_PASS,
  1,
  RECONCILE_MAX_EPOCHS_HARD_CAP,
);

let lastReconcileAtMs = 0;
class IndexerLeaseError extends Error {
  override name = "IndexerLeaseError";
}

let activeIndexerLeaseOwnerToken: string | null = null;
let assertActiveIndexerLease: () => void = () => {
  throw new IndexerLeaseError("indexer lease is not initialized");
};

function getActiveIndexerLeaseOwnerToken() {
  if (activeIndexerLeaseOwnerToken === null) {
    throw new IndexerLeaseError("indexer lease is not initialized");
  }
  return activeIndexerLeaseOwnerToken;
}

function parseChainCurrentEpochNumber(value: bigint, observedBlock: bigint): number | null {
  return parsePlausibleCurrentEpoch(value, INDEXER_START_BLOCK, observedBlock);
}

function parseChainPositiveSafeInteger(value: bigint): number | null {
  if (value <= 0n || value > MAX_SAFE_INTEGER_BIGINT) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseIndexedEpochKey(value: string): number | null {
  if (!CANONICAL_INDEXED_EPOCH_RE.test(value)) return null;
  const parsed = BigInt(value);
  return parsed <= MAX_SAFE_INTEGER_BIGINT ? Number(parsed) : null;
}

function parseChainTileId(value: bigint): number | null {
  if (value <= 0n || value > BigInt(MAX_TILE_ID)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= MAX_TILE_ID ? parsed : null;
}

function parseChainTileIds(values: readonly bigint[]): number[] | null {
  const tileIds: number[] = [];
  for (const value of values) {
    const tileId = parseChainTileId(value);
    if (tileId === null) return null;
    tileIds.push(tileId);
  }
  return tileIds;
}

function toDisplayNumberWei(value: bigint): number {
  if (value <= 0n) return 0;
  const scale = 1_000_000_000_000n;
  const scaled = (value + (scale / 2n)) / scale;
  if (scaled > MAX_SAFE_INTEGER_BIGINT) return Number.MAX_SAFE_INTEGER;
  return Number(scaled) / 1_000_000;
}

type IndexerRunStatus = {
  startedAt: number;
  completedAt?: number;
  lastHeartbeatAt?: number;
  fromBlock: string;
  toBlock: string;
  headBlock?: string;
  finalityBlocks?: string;
  targetBlock?: string | null;
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

const INDEXER_RPC_URLS = requireIndependentRpcUrls(getStableLineaReadRpcs(
  process.env.KEEPER_RPC_URL ?? getDefaultLineaRpcs(APP_NETWORK)[0],
  APP_NETWORK,
));
const boundedIndexerRpcFetch = createBoundedIndexerRpcFetch();

const independentRpcClients = INDEXER_RPC_URLS.map((url) => createPublicClient({
  chain: APP_CHAIN,
  transport: http(url, {
    fetchFn: boundedIndexerRpcFetch,
    timeout: 30_000,
    retryCount: 0,
  }),
}));

type IndependentRpcClient = (typeof independentRpcClients)[number];

// Storage helpers
function storagePatch(path: string, data: Record<string, unknown>) {
  patchJsonPath(path, data);
}

function storagePut(path: string, data: unknown) {
  putJsonPath(path, data);
}

function storageGet<T = unknown>(path: string): T | null {
  return readJsonPath<T>(path);
}

function setIndexerStatus(key: string, value: unknown) {
  assertActiveIndexerLease();
  setMetaJson(key, value);
}

// Event topic signatures
const [betSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "BetPlaced" });
const [batchSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "BatchBetsPlaced" });
const [batchSameAmountSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "BatchBetsSameAmountPlaced" });
const [batchBitmapSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "BatchBetsBitmapPlaced" });
const [resolvedSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "EpochResolved" });
const [dailySig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "DailyJackpotAwarded" });
const [weeklySig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "WeeklyJackpotAwarded" });
const [rewardClaimedSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "RewardClaimed" });
const [rewardBatchClaimedSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "RewardBatchClaimed" });
const [rebateClaimedSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "RebateClaimed" });
const [rebateBatchClaimedSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "RebateBatchClaimed" });
const [rewardDustSettledSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "RewardDustSettled" });
const [rebateDustSettledSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "RebateDustSettled" });
const [resolverRewardAccruedSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "ResolverRewardAccrued" });
const [resolverRewardClaimedSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "ResolverRewardClaimed" });
const [feesFlushedSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "ProtocolFeesFlushed" });

// Chunked log fetcher
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRpcTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = RPC_CALL_TIMEOUT_MS,
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null;
  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

async function fetchLogsRequestWithRetry(
  rpcClient: IndependentRpcClient,
  topics: Array<`0x${string}`>,
  from: bigint,
  to: bigint,
  kind: "log fetch" | "indexed log fetch",
  budget: IndexerRpcWorkBudget,
): Promise<Log[]> {
  for (let attempt = 0; attempt < RETRY_COUNT; attempt++) {
    try {
      const request = {
        address: CONTRACT,
        topics,
        fromBlock: from,
        toBlock: to,
      } as unknown as Parameters<typeof rpcClient.getLogs>[0];
      const timeoutMs = Math.min(RPC_CALL_TIMEOUT_MS, budget.consumeRpcCall());
      const logs = await withRpcTimeout(
        rpcClient.getLogs(request),
        `getLogs(${from}-${to})`,
        timeoutMs,
      );
      budget.recordLogs(logs.length);
      return logs;
    } catch (err) {
      if (isIndexerRpcWorkBudgetError(err)) throw err;
      if (isIndexerRpcResponseLimitError(err)) throw err;
      const msg = describeIndexerError(err).slice(0, 80);
      if (attempt < RETRY_COUNT - 1) {
        const wait = RETRY_DELAY_MS * (attempt + 1);
        console.warn(`  [retry ${attempt + 1}/${RETRY_COUNT}] ${from}-${to}: ${msg} - wait ${wait}ms`);
        await delay(Math.min(wait, budget.remainingTimeMs()));
      } else {
        throw new Error(`${kind} failed for ${from}-${to} after ${RETRY_COUNT} retries: ${msg}`);
      }
    }
  }
  throw new Error(`${kind} failed for ${from}-${to}: exhausted retries`);
}

async function fetchLogsRequestAdaptiveSplit(
  rpcClient: IndependentRpcClient,
  topics: Array<`0x${string}`>,
  label: string,
  from: bigint,
  to: bigint,
  budget: IndexerRpcWorkBudget,
): Promise<Log[]> {
  const kind = topics.length === 1 ? "log fetch" : "indexed log fetch";
  try {
    return await fetchLogsRequestWithRetry(rpcClient, topics, from, to, kind, budget);
  } catch (err) {
    if (isIndexerRpcWorkBudgetError(err)) throw err;
    if (isIndexerRpcResponseLimitError(err)) throw err;
    const span = to - from + 1n;
    if (span <= MIN_ADAPTIVE_LOG_RANGE_BLOCKS) {
      throw err;
    }
    budget.consumeSplitNode();
    const leftTo = from + (span / 2n) - 1n;
    const rightFrom = leftTo + 1n;
    console.warn(
      `  [split] ${label} ${from}-${to}: ${describeIndexerError(err)}. splitting into ${from}-${leftTo} and ${rightFrom}-${to}`,
    );
    const left = await fetchLogsRequestAdaptiveSplit(
      rpcClient,
      topics,
      `${label}:L`,
      from,
      leftTo,
      budget,
    );
    if (rightFrom <= to) {
      await delay(Math.min(INTER_CHUNK_DELAY_MS, budget.remainingTimeMs()));
    }
    const right =
      rightFrom <= to
        ? await fetchLogsRequestAdaptiveSplit(
            rpcClient,
            topics,
            `${label}:R`,
            rightFrom,
            to,
            budget,
          )
        : [];
    return [...left, ...right];
  }
}

async function fetchLogsByTopicsAdaptive(
  topics: Array<`0x${string}`>,
  label: string,
  from: bigint,
  to: bigint,
  budget: IndexerRpcWorkBudget,
): Promise<Log[]> {
  const minimumResponses = 2;
  try {
    const agreed = await awaitExactRpcAgreement(
      independentRpcClients.map((rpcClient, index) => async () => {
        const logs = await fetchLogsRequestAdaptiveSplit(
          rpcClient,
          topics,
          `${label}:provider-${index + 1}`,
          from,
          to,
          budget,
        );
        return validateRpcLogSet(logs, {
          contractAddress: CONTRACT,
          fromBlock: from,
          toBlock: to,
          requestedTopics: topics,
        });
      }),
      minimumResponses,
      (value) => value.agreementFingerprint,
      budget,
    );
    return [...agreed.logs];
  } catch (error) {
    if (!isIndexerRpcResponseLimitError(error)) throw error;
    const span = to - from + 1n;
    if (span <= MIN_ADAPTIVE_LOG_RANGE_BLOCKS) throw error;
    budget.consumeSplitNode();
    const leftTo = from + (span / 2n) - 1n;
    const rightFrom = leftTo + 1n;
    console.warn(
      `  [quorum split] ${label} ${from}-${to}: ${describeIndexerError(error)}. ` +
        `splitting all providers into ${from}-${leftTo} and ${rightFrom}-${to}`,
    );
    const left = await fetchLogsByTopicsAdaptive(
      topics,
      `${label}:L`,
      from,
      leftTo,
      budget,
    );
    if (rightFrom <= to) {
      await delay(Math.min(INTER_CHUNK_DELAY_MS, budget.remainingTimeMs()));
    }
    const right = rightFrom <= to
      ? await fetchLogsByTopicsAdaptive(topics, `${label}:R`, rightFrom, to, budget)
      : [];
    return [...left, ...right];
  }
}

async function readWithExactIndexerRpcAgreement<T>(
  label: string,
  reader: (rpcClient: IndependentRpcClient) => Promise<T>,
  fingerprint: (value: T) => string,
  budget: IndexerRpcWorkBudget,
): Promise<T> {
  return awaitExactRpcAgreement(
    independentRpcClients.map((rpcClient, index) => async () => {
      const timeoutMs = Math.min(RPC_CALL_TIMEOUT_MS, budget.consumeRpcCall());
      return withRpcTimeout(reader(rpcClient), `${label}:provider-${index + 1}`, timeoutMs);
    }),
    2,
    fingerprint,
    budget,
  );
}

async function readAgreedHeadBlockNumber(budget: IndexerRpcWorkBudget) {
  return readWithExactIndexerRpcAgreement(
    "getBlockNumber",
    (rpcClient) => rpcClient.getBlockNumber(),
    (blockNumber) => blockNumber.toString(),
    budget,
  );
}

async function fetchLogsByTopicsChunked(
  topics: Array<`0x${string}`>,
  label: string,
  from: bigint,
  to: bigint,
  chunkSize: bigint,
  budget: IndexerRpcWorkBudget,
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
      budget,
    );
    all.push(...logs);
    if (i < ranges.length - 1) {
      await delay(Math.min(INTER_CHUNK_DELAY_MS, budget.remainingTimeMs()));
    }
    if ((i + 1) % 10 === 0 || i === ranges.length - 1) {
      console.log(`  [${label}] ${i + 1}/${ranges.length} chunks, ${all.length} logs`);
    }
  }

  return all;
}

function filterLogsByTopics(logs: Log[], topics: Array<`0x${string}`>) {
  return logs.filter((log) => topics.every((topic, index) => log.topics[index] === topic));
}

async function fetchAllLogs(
  from: bigint,
  to: bigint,
  budget: IndexerRpcWorkBudget,
): Promise<Log[]> {
  // viem ignores raw `topics` in this client form, so fetch once and classify locally.
  return fetchLogsByTopicsAdaptive([], "ContractEvents", from, to, budget);
}

// Process a single log
interface BetRecord {
  epoch: string;
  user: string;
  tileIds: number[];
  amounts: string[];
  totalAmount: string;
  totalAmountNum: number;
  txHash: string;
  blockNumber: string;
  logIndex: string;
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

function buildNormalizedEventId(log: Log): string | null {
  if (!log.transactionHash || log.logIndex === null || log.logIndex === undefined) {
    return null;
  }
  const normalizedHash = log.transactionHash.toLowerCase().trim();
  if (!/^0x[0-9a-f]{64}$/.test(normalizedHash)) return null;
  return `${normalizedHash}_${log.logIndex.toString()}`;
}

function normalizeBetRecord(bet: BetRecord): BetRecord {
  if (bet.tileIds.length === 0) {
    return { ...bet, amounts: [] };
  }

  const normalized = normalizeTileAmounts(bet.tileIds, bet.amounts, bet.totalAmount);

  return {
    ...bet,
    tileIds: normalized.tileIds,
    amounts: normalized.amounts,
  };
}

interface DustSettlementRecord {
  id: string;
  kind: "reward" | "rebate";
  epoch: string;
  amount: string;
  txHash: string;
  blockNumber: string;
}

function processLogs(logs: Log[]) {
  const bets: BetRecord[] = [];
  const epochs: Map<string, EpochRecord> = new Map();
  const jackpots: JackpotRecord[] = [];
  const rewardClaims: RewardClaimRecord[] = [];
  const feeFlushes: FeeFlushRecord[] = [];
  const batchClaims: BatchClaimRecord[] = [];
  const resolverRewards: ResolverRewardRecord[] = [];
  const dustSettlements: DustSettlementRecord[] = [];
  const dailyJackpotEpochs = new Set<string>();
  const weeklyJackpotEpochs = new Set<string>();
  const rebateBatchClaimTxs = new Set(
    logs
      .filter((log) => log.topics[0] === rebateBatchClaimedSig && log.transactionHash)
      .map((log) => log.transactionHash!.toLowerCase()),
  );

  for (const log of logs) {
    const topic0 = log.topics[0];
    if (!topic0) continue;

    try {
      if (topic0 === betSig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "BetPlaced") continue;
        const args = decoded.args as { epoch: bigint; user: string; tileId: bigint; amount: bigint };
        const tileId = parseChainTileId(args.tileId);
        const logIndex = normalizeIndexerLogIndex(log.logIndex);
        if (tileId === null || !log.transactionHash || logIndex === null) continue;
        bets.push({
          epoch: args.epoch.toString(),
          user: args.user.toLowerCase(),
          tileIds: [tileId],
          amounts: [formatUnits(args.amount, 18)],
          totalAmount: formatUnits(args.amount, 18),
          totalAmountNum: toDisplayNumberWei(args.amount),
          txHash: log.transactionHash ?? "",
          blockNumber: (log.blockNumber ?? 0n).toString(),
          logIndex,
        });
      } else if (topic0 === batchSig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "BatchBetsPlaced") continue;
        const args = decoded.args as {
          epoch: bigint; user: string; tileIds: bigint[]; amounts: bigint[]; totalAmount: bigint;
        };
        const tileIds = parseChainTileIds(args.tileIds);
        const logIndex = normalizeIndexerLogIndex(log.logIndex);
        if (
          tileIds === null ||
          tileIds.length !== args.amounts.length ||
          !log.transactionHash ||
          logIndex === null
        ) continue;
        bets.push({
          epoch: args.epoch.toString(),
          user: args.user.toLowerCase(),
          tileIds,
          amounts: args.amounts.map((a) => formatUnits(a, 18)),
          totalAmount: formatUnits(args.totalAmount, 18),
          totalAmountNum: toDisplayNumberWei(args.totalAmount),
          txHash: log.transactionHash ?? "",
          blockNumber: (log.blockNumber ?? 0n).toString(),
          logIndex,
        });
      } else if (topic0 === batchSameAmountSig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "BatchBetsSameAmountPlaced") continue;
        const args = decoded.args as {
          epoch: bigint; user: string; tileIds: bigint[]; amount: bigint; totalAmount: bigint;
        };
        const tileIds = parseChainTileIds(args.tileIds);
        const logIndex = normalizeIndexerLogIndex(log.logIndex);
        if (tileIds === null || !log.transactionHash || logIndex === null) continue;
        const formattedAmount = formatUnits(args.amount, 18);
        bets.push({
          epoch: args.epoch.toString(),
          user: args.user.toLowerCase(),
          tileIds,
          amounts: tileIds.map(() => formattedAmount),
          totalAmount: formatUnits(args.totalAmount, 18),
          totalAmountNum: toDisplayNumberWei(args.totalAmount),
          txHash: log.transactionHash ?? "",
          blockNumber: (log.blockNumber ?? 0n).toString(),
          logIndex,
        });
      } else if (topic0 === batchBitmapSig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "BatchBetsBitmapPlaced") continue;
        const args = decoded.args as {
          epoch: bigint; user: string; tileMask: number; amount: bigint; totalAmount: bigint;
        };
        const tileIds = tileMaskToTileIds(args.tileMask);
        const logIndex = normalizeIndexerLogIndex(log.logIndex);
        if (!log.transactionHash || logIndex === null) continue;
        const formattedAmount = formatUnits(args.amount, 18);
        bets.push({
          epoch: args.epoch.toString(),
          user: args.user.toLowerCase(),
          tileIds,
          amounts: tileIds.map(() => formattedAmount),
          totalAmount: formatUnits(args.totalAmount, 18),
          totalAmountNum: toDisplayNumberWei(args.totalAmount),
          txHash: log.transactionHash ?? "",
          blockNumber: (log.blockNumber ?? 0n).toString(),
          logIndex,
        });
      } else if (topic0 === resolvedSig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "EpochResolved") continue;
        const args = decoded.args as {
          epoch: bigint; winningTile: bigint; totalPool: bigint; fee: bigint; rewardPool: bigint; jackpotBonus: bigint;
        };
        const winningTile = parseChainTileId(args.winningTile);
        if (winningTile === null) continue;
        epochs.set(args.epoch.toString(), {
          winningTile,
          totalPool: formatUnits(args.totalPool, 18),
          rewardPool: formatUnits(args.rewardPool, 18),
          fee: formatUnits(args.fee, 18),
          jackpotBonus: formatUnits(args.jackpotBonus, 18),
          isDailyJackpot: dailyJackpotEpochs.has(args.epoch.toString()),
          isWeeklyJackpot: weeklyJackpotEpochs.has(args.epoch.toString()),
          resolvedBlock: (log.blockNumber ?? 0n).toString(),
        });
      } else if (topic0 === dailySig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "DailyJackpotAwarded") continue;
        const args = decoded.args as { epoch: bigint; amount: bigint };
        const ep = args.epoch.toString();
        dailyJackpotEpochs.add(ep);
        const existing = epochs.get(ep);
        if (existing) existing.isDailyJackpot = true;
        jackpots.push({
          epoch: ep,
          kind: "daily",
          amount: formatUnits(args.amount, 18),
          amountNum: toDisplayNumberWei(args.amount),
          txHash: log.transactionHash ?? "",
          blockNumber: (log.blockNumber ?? 0n).toString(),
        });
      } else if (topic0 === weeklySig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "WeeklyJackpotAwarded") continue;
        const args = decoded.args as { epoch: bigint; amount: bigint };
        const ep = args.epoch.toString();
        weeklyJackpotEpochs.add(ep);
        const existing = epochs.get(ep);
        if (existing) existing.isWeeklyJackpot = true;
        jackpots.push({
          epoch: ep,
          kind: "weekly",
          amount: formatUnits(args.amount, 18),
          amountNum: toDisplayNumberWei(args.amount),
          txHash: log.transactionHash ?? "",
          blockNumber: (log.blockNumber ?? 0n).toString(),
        });
      } else if (topic0 === rewardClaimedSig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "RewardClaimed") continue;
        const id = buildNormalizedEventId(log);
        if (!id) continue;
        const args = decoded.args as { epoch: bigint; user: string; reward: bigint };
        rewardClaims.push({
          id,
          epoch: args.epoch.toString(),
          user: args.user.toLowerCase(),
          reward: formatUnits(args.reward, 18),
          rewardNum: toDisplayNumberWei(args.reward),
          txHash: log.transactionHash ?? "",
          blockNumber: (log.blockNumber ?? 0n).toString(),
        });
      } else if (topic0 === rewardBatchClaimedSig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "RewardBatchClaimed") continue;
        const id = buildNormalizedEventId(log);
        if (!id) continue;
        const args = decoded.args as { user: string; totalAmount: bigint; epochsClaimed: bigint };
        const epochsClaimed = parseChainPositiveSafeInteger(args.epochsClaimed);
        if (epochsClaimed === null) continue;
        batchClaims.push({
          id,
          kind: "reward",
          user: args.user.toLowerCase(),
          totalAmount: formatUnits(args.totalAmount, 18),
          epochsClaimed,
          txHash: log.transactionHash ?? "",
          blockNumber: (log.blockNumber ?? 0n).toString(),
        });
      } else if (topic0 === rebateClaimedSig) {
        if (log.transactionHash && rebateBatchClaimTxs.has(log.transactionHash.toLowerCase())) continue;
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "RebateClaimed") continue;
        const id = buildNormalizedEventId(log);
        if (!id) continue;
        const args = decoded.args as { user: string; epoch: bigint; amount: bigint };
        batchClaims.push({
          id,
          kind: "rebate",
          user: args.user.toLowerCase(),
          totalAmount: formatUnits(args.amount, 18),
          epochsClaimed: 1,
          txHash: log.transactionHash ?? "",
          blockNumber: (log.blockNumber ?? 0n).toString(),
        });
      } else if (topic0 === rebateBatchClaimedSig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "RebateBatchClaimed") continue;
        const id = buildNormalizedEventId(log);
        if (!id) continue;
        const args = decoded.args as { user: string; amount: bigint; epochsClaimed: bigint };
        const epochsClaimed = parseChainPositiveSafeInteger(args.epochsClaimed);
        if (epochsClaimed === null) continue;
        batchClaims.push({
          id,
          kind: "rebate",
          user: args.user.toLowerCase(),
          totalAmount: formatUnits(args.amount, 18),
          epochsClaimed,
          txHash: log.transactionHash ?? "",
          blockNumber: (log.blockNumber ?? 0n).toString(),
        });
      } else if (topic0 === rewardDustSettledSig || topic0 === rebateDustSettledSig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "RewardDustSettled" && decoded.eventName !== "RebateDustSettled") continue;
        const id = buildNormalizedEventId(log);
        if (!id) continue;
        const args = decoded.args as { epoch: bigint; amount: bigint };
        dustSettlements.push({
          id,
          kind: decoded.eventName === "RewardDustSettled" ? "reward" : "rebate",
          epoch: args.epoch.toString(),
          amount: formatUnits(args.amount, 18),
          txHash: log.transactionHash ?? "",
          blockNumber: (log.blockNumber ?? 0n).toString(),
        });
      } else if (topic0 === resolverRewardAccruedSig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "ResolverRewardAccrued") continue;
        const id = buildNormalizedEventId(log);
        if (!id) continue;
        const args = decoded.args as { resolver: string; epoch: bigint; amount: bigint };
        resolverRewards.push({
          id,
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
        const id = buildNormalizedEventId(log);
        if (!id) continue;
        const args = decoded.args as { resolver: string; amount: bigint };
        resolverRewards.push({
          id,
          kind: "claimed",
          resolver: args.resolver.toLowerCase(),
          amount: formatUnits(args.amount, 18),
          txHash: log.transactionHash ?? "",
          blockNumber: (log.blockNumber ?? 0n).toString(),
        });
      } else if (topic0 === feesFlushedSig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "ProtocolFeesFlushed") continue;
        const id = buildNormalizedEventId(log);
        if (!id) continue;
        const args = decoded.args as { ownerAmount: bigint; burnAmount: bigint };
        feeFlushes.push({
          id,
          ownerAmount: formatUnits(args.ownerAmount, 18),
          burnAmount: formatUnits(args.burnAmount, 18),
          txHash: log.transactionHash ?? "",
          blockNumber: (log.blockNumber ?? 0n).toString(),
        });
      }
    } catch (err) {
      console.warn("[indexer] Failed to decode log in processLogs:", describeIndexerError(err));
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
    dustSettlements,
  };
}

// Write to local SQLite
function writeBets(bets: BetRecord[]) {
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
      const identity = buildIndexerBetIdentity(
        normalizedBet.epoch,
        normalizedBet.txHash,
        normalizedBet.blockNumber,
        normalizedBet.logIndex,
      );
      if (identity === null) continue;
      patch[identity.id] = {
        epoch: normalizedBet.epoch,
        tileIds: normalizedBet.tileIds,
        amounts: normalizedBet.amounts,
        totalAmount: normalizedBet.totalAmount,
        totalAmountNum: normalizedBet.totalAmountNum,
        txHash: normalizedBet.txHash,
        blockNumber: normalizedBet.blockNumber,
        logIndex: normalizedBet.logIndex,
      };
    }
    storagePatch(`gamedata/bets/${user}`, patch);
  }
}

function writeEpochs(epochs: Map<string, EpochRecord>) {
  if (epochs.size === 0) return;
  const patch: Record<string, unknown> = {};
  for (const [ep, data] of epochs) {
    patch[ep] = data;
  }
  storagePatch("gamedata/epochs", patch);
}

function writeJackpots(jackpots: JackpotRecord[]) {
  if (jackpots.length === 0) return;
  const patch: Record<string, unknown> = {};
  for (const j of jackpots) {
    const key = `${j.kind}_${j.epoch}`;
    patch[key] = j;
  }
  storagePatch("gamedata/jackpots", patch);
}

function writeRewardClaims(rewardClaims: RewardClaimRecord[]) {
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

function writeBatchClaims(records: BatchClaimRecord[]) {
  if (records.length === 0) return;
  const patch: Record<string, unknown> = {};
  for (const row of records) {
    patch[row.id] = row;
  }
  storagePatch("gamedata/batchClaims", patch);
}

function writeResolverRewards(records: ResolverRewardRecord[]) {
  if (records.length === 0) return;
  const patch: Record<string, unknown> = {};
  for (const row of records) {
    patch[row.id] = row;
  }
  storagePatch("gamedata/resolverRewards", patch);
}

function writeDustSettlements(records: DustSettlementRecord[]) {
  if (records.length === 0) return;
  const patch: Record<string, unknown> = {};
  for (const row of records) patch[row.id] = row;
  storagePatch("gamedata/dustSettlements", patch);
}

function writeFeeFlushes(feeFlushes: FeeFlushRecord[]) {
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

async function readCanonicalBlockHash(
  blockNumber: bigint,
  budget: IndexerRpcWorkBudget,
) {
  return readWithExactIndexerRpcAgreement(
    `getBlock(${blockNumber})`,
    async (rpcClient) => {
      const block = await rpcClient.getBlock({ blockNumber });
      const blockHash = normalizeBlockHash(block.hash);
      if (blockHash === null) {
        throw new Error(`RPC returned an invalid block hash at block ${blockNumber}`);
      }
      return blockHash;
    },
    (blockHash) => blockHash,
    budget,
  );
}

async function readStableCanonicalBlockHash(
  blockNumber: bigint,
  budget: IndexerRpcWorkBudget,
) {
  const firstHash = await readCanonicalBlockHash(blockNumber, budget);
  const secondHash = await readCanonicalBlockHash(blockNumber, budget);
  if (firstHash !== secondHash) {
    throw new Error(`RPC block hash changed during fork recovery at block ${blockNumber}`);
  }
  return secondHash;
}

async function fetchCanonicalChunk(
  fromBlock: bigint,
  toBlock: bigint,
  previousCheckpoint: IndexerBlockCheckpoint | null,
  budget: IndexerRpcWorkBudget,
) {
  if (
    previousCheckpoint !== null &&
    BigInt(previousCheckpoint.blockNumber) !== fromBlock - 1n
  ) {
    throw new Error("indexer chunk predecessor does not match the stored checkpoint");
  }

  if (previousCheckpoint !== null) {
    const previousHashBefore = await readCanonicalBlockHash(fromBlock - 1n, budget);
    if (previousHashBefore !== previousCheckpoint.blockHash) {
      throw new Error(`indexer predecessor checkpoint changed at block ${fromBlock - 1n}`);
    }
  }
  const endHashBefore = await readCanonicalBlockHash(toBlock, budget);
  const logs = await fetchAllLogs(fromBlock, toBlock, budget);
  await verifyCanonicalLogBlockHashes(
    logs,
    (blockNumber) => readCanonicalBlockHash(blockNumber, budget),
  );
  const endHashAfter = await readCanonicalBlockHash(toBlock, budget);
  if (endHashAfter !== endHashBefore) {
    throw new Error(`canonical chain changed while indexing blocks ${fromBlock}-${toBlock}`);
  }
  if (previousCheckpoint !== null) {
    const previousHashAfter = await readCanonicalBlockHash(fromBlock - 1n, budget);
    if (previousHashAfter !== previousCheckpoint.blockHash) {
      throw new Error(`indexer predecessor checkpoint changed at block ${fromBlock - 1n}`);
    }
  }

  return { logs, blockHash: endHashAfter };
}

async function recoverCanonicalIndexerState(
  lastBlock: bigint,
  budget: IndexerRpcWorkBudget,
) {
  const checkpoints = getIndexerBlockCheckpoints().filter(
    (checkpoint) => BigInt(checkpoint.blockNumber) <= lastBlock,
  );
  const commonCheckpoint = checkpoints.length > 0
    ? await findLatestCanonicalCheckpoint(
        checkpoints,
        (blockNumber) => readStableCanonicalBlockHash(blockNumber, budget),
      )
    : null;
  const usableCommonCheckpoint =
    commonCheckpoint !== null && BigInt(commonCheckpoint.blockNumber) >= INDEXER_START_BLOCK
      ? commonCheckpoint
      : null;

  if (
    usableCommonCheckpoint !== null &&
    BigInt(usableCommonCheckpoint.blockNumber) === lastBlock
  ) {
    return { lastBlock, checkpoint: usableCommonCheckpoint };
  }

  const rollbackBlock = usableCommonCheckpoint === null
    ? INDEXER_START_BLOCK
    : BigInt(usableCommonCheckpoint.blockNumber);
  rollbackIndexerToBlock(
    rollbackBlock,
    usableCommonCheckpoint?.blockHash ?? null,
    getActiveIndexerLeaseOwnerToken(),
  );
  console.warn(
    usableCommonCheckpoint === null
      ? `[indexer] No canonical block checkpoint found; replaying from ${rollbackBlock}.`
      : `[indexer] Canonical fork detected; rolled back to checkpoint ${rollbackBlock}.`,
  );
  return { lastBlock: rollbackBlock, checkpoint: usableCommonCheckpoint };
}

async function updateCurrentEpochMeta(
  blockNumber: bigint,
  budget: IndexerRpcWorkBudget,
) {
  try {
    const currentEpoch = await getCurrentEpochFromChain(blockNumber, budget);
    const currentEpochNumber = parseChainCurrentEpochNumber(currentEpoch, blockNumber);
    if (currentEpochNumber === null) {
      console.warn("[indexer] Ignoring implausible currentEpoch value from contract.");
      return;
    }
    assertActiveIndexerLease();
    storagePut("gamedata/_meta/currentEpoch", currentEpochNumber);
  } catch (err) {
    if (err instanceof IndexerLeaseError) throw err;
    if (isIndexerRpcWorkBudgetError(err)) throw err;
    console.warn("[indexer] Could not read currentEpoch from contract:", describeIndexerError(err));
  }
}

async function getCurrentEpochFromChain(
  blockNumber: bigint,
  budget: IndexerRpcWorkBudget,
) {
  return readWithExactIndexerRpcAgreement(
    `read currentEpoch(${blockNumber})`,
    (rpcClient) => rpcClient.readContract({
      address: CONTRACT,
      abi: READ_ABI,
      functionName: "currentEpoch",
      blockNumber,
    }),
    (currentEpoch) => currentEpoch.toString(),
    budget,
  );
}

async function getLastBlock(): Promise<bigint> {
  const val = storageGet<string>("gamedata/_meta/lastIndexedBlock");
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
  const val = storageGet<string>("gamedata/_meta/repairCursorBlock");
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

function setRepairCursorBlock(block: bigint) {
  storagePut("gamedata/_meta/repairCursorBlock", block.toString());
}

function getIndexerCatchupChunkBlocks() {
  return parseIndexerCatchupChunkBlocks(
    getMetaJsonStrict<unknown>(INDEXER_CATCHUP_CHUNK_BLOCKS_META_KEY),
    RUN_CHUNK_BLOCKS,
  );
}

function getReconcileEpochCursor() {
  const value = getMetaJsonStrict<unknown>("reconcileEpochCursor");
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string") return parseIndexedEpochKey(value) ?? 1;
  if (value !== null) throw new Error("stored reconcile epoch cursor is invalid");
  return 1;
}

function setReconcileEpochCursorInsideLease(epoch: number) {
  setMetaJson("reconcileEpochCursor", epoch);
}

function setReconcileEpochCursor(epoch: number) {
  runIndexerStorageTransaction(
    getActiveIndexerLeaseOwnerToken(),
    () => setReconcileEpochCursorInsideLease(epoch),
  );
}

type ReconcileBlockCursor = {
  epoch: number;
  nextToBlock: bigint;
};

function getReconcileBlockCursor(): ReconcileBlockCursor | null {
  const value = getMetaJsonStrict<unknown>(RECONCILE_BLOCK_CURSOR_META_KEY);
  if (value === null) return null;
  if (!value || typeof value !== "object") {
    throw new Error("stored reconcile block cursor is invalid");
  }
  const epoch = (value as { epoch?: unknown }).epoch;
  const nextToBlock = (value as { nextToBlock?: unknown }).nextToBlock;
  if (
    typeof epoch !== "number" ||
    !Number.isSafeInteger(epoch) ||
    epoch <= 0 ||
    typeof nextToBlock !== "string" ||
    !/^\d+$/.test(nextToBlock)
  ) {
    throw new Error("stored reconcile block cursor is invalid");
  }
  const parsedBlock = BigInt(nextToBlock);
  if (parsedBlock < INDEXER_START_BLOCK) {
    throw new Error("stored reconcile block cursor precedes the deploy block");
  }
  return { epoch, nextToBlock: parsedBlock };
}

function setReconcileBlockCursor(cursor: ReconcileBlockCursor | null) {
  runIndexerStorageTransaction(
    getActiveIndexerLeaseOwnerToken(),
    () => setMetaJson(
      RECONCILE_BLOCK_CURSOR_META_KEY,
      cursor === null
        ? null
        : { epoch: cursor.epoch, nextToBlock: cursor.nextToBlock.toString() },
    ),
  );
}

async function runRepairPass(
  currentBlock: bigint,
  budget: IndexerRpcWorkBudget,
) {
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
    await updateCurrentEpochMeta(currentBlock, budget);
    return 0;
  }

  const to = from + REPAIR_CHUNK_BLOCKS - 1n > currentBlock
    ? currentBlock
    : from + REPAIR_CHUNK_BLOCKS - 1n;

  console.log(`[indexer][repair] Scanning ${from} -> ${to} (${to - from + 1n} blocks)`);

  const { logs } = await fetchCanonicalChunk(from, to, null, budget);
  const parsed = processLogs(logs);
  runIndexerStorageTransaction(getActiveIndexerLeaseOwnerToken(), () => {
    writeBets(parsed.bets);
    writeEpochs(parsed.epochs);
    writeJackpots(parsed.jackpots);
    writeRewardClaims(parsed.rewardClaims);
    writeFeeFlushes(parsed.feeFlushes);
    writeBatchClaims(parsed.batchClaims);
    writeResolverRewards(parsed.resolverRewards);
    writeDustSettlements(parsed.dustSettlements);
    setRepairCursorBlock(to + 1n);
  });
  if (logs.length > 0) {
    console.log(`[indexer][repair] Repaired ${logs.length} logs (${parsed.bets.length} bets, ${parsed.epochs.size} epochs, ${parsed.jackpots.length} jackpots, ${parsed.rewardClaims.length} claims)`);
  } else {
    console.log("[indexer][repair] No logs in this range");
  }

  await updateCurrentEpochMeta(currentBlock, budget);
  const status: IndexerRepairStatus = {
    at: Date.now(),
    fromBlock: from.toString(),
    toBlock: to.toString(),
    repairedLogs: logs.length,
  };
  setIndexerStatus("indexerRepairStatus", status);
  return logs.length;
}

async function runEpochReconcile(
  currentBlock: bigint,
  budget: IndexerRpcWorkBudget,
) {
  assertActiveIndexerLease();
  const now = Date.now();
  if (now - lastReconcileAtMs < RECONCILE_INTERVAL_MS) return 0;
  lastReconcileAtMs = now;

  const currentEpoch = await getCurrentEpochFromChain(currentBlock, budget);
  const currentEpochNumber = parseChainCurrentEpochNumber(currentEpoch, currentBlock);
  if (currentEpochNumber === null) {
    console.warn("[indexer][reconcile] Skipping reconcile for implausible currentEpoch value from contract.");
    setIndexerStatus("indexerReconcileStatus", {
      at: now,
      currentEpoch: 0,
      missingEpochs: 0,
      repairedEpochs: 0,
      targetEpochs: [],
    } satisfies IndexerReconcileStatus);
    return 0;
  }
  assertActiveIndexerLease();
  storagePut("gamedata/_meta/currentEpoch", currentEpochNumber);

  if (currentEpoch <= 1n) {
    const status: IndexerReconcileStatus = {
      at: now,
      currentEpoch: currentEpochNumber,
      missingEpochs: 0,
      repairedEpochs: 0,
      targetEpochs: [],
    };
    setIndexerStatus("indexerReconcileStatus", status);
    return 0;
  }

  const rawEpochs = storageGet<Record<string, EpochRecord>>("gamedata/epochs") ?? {};
  const have = new Set<number>();
  for (const key of Object.keys(rawEpochs)) {
    const n = parseIndexedEpochKey(key);
    if (n !== null) have.add(n);
  }

  const reconcilePlan = createReconcileEpochPlan({
    currentEpoch: currentEpochNumber,
    cursor: getReconcileEpochCursor(),
    indexedEpochs: have,
    maxTargets: RECONCILE_MAX_EPOCHS_PER_PASS,
    recentWindow: RECONCILE_RECENT_EPOCH_WINDOW,
  });
  let reconcileBlockCursor = getReconcileBlockCursor();
  if (
    reconcileBlockCursor &&
    (reconcileBlockCursor.epoch >= currentEpochNumber || have.has(reconcileBlockCursor.epoch))
  ) {
    setReconcileBlockCursor(null);
    reconcileBlockCursor = null;
  }
  let targets = [...reconcilePlan.targetEpochs];
  if (reconcileBlockCursor && !targets.includes(reconcileBlockCursor.epoch)) {
    targets = [reconcileBlockCursor.epoch, ...targets]
      .slice(0, RECONCILE_MAX_EPOCHS_PER_PASS);
  }
  if (targets.length === 0) {
    setReconcileEpochCursor(reconcilePlan.nextCursor);
    console.log("[indexer][reconcile] No missing epochs in the bounded candidate window");
    const status: IndexerReconcileStatus = {
      at: now,
      currentEpoch: currentEpochNumber,
      missingEpochs: 0,
      repairedEpochs: 0,
      targetEpochs: [],
    };
    setIndexerStatus("indexerReconcileStatus", status);
    return 0;
  }

  console.log(
    `[indexer][reconcile] Missing bounded candidates: ${targets.length}, repairing now: ${targets.join(", ")}`,
  );
  setIndexerStatus("indexerReconcileStatus", {
    at: Date.now(),
    currentEpoch: currentEpochNumber,
    missingEpochs: targets.length,
    repairedEpochs: 0,
    targetEpochs: targets,
  } satisfies IndexerReconcileStatus);

  const epochsPatch = new Map<string, EpochRecord>();
  let fullScanChunksRemaining = RECONCILE_FULL_SCAN_MAX_CHUNKS_PER_PASS;
  const nextReconcileEpochCursor = reconcilePlan.nextCursor;
  for (const epNum of targets) {
    try {
    const epTopic = toHex(BigInt(epNum), { size: 32 });
    const recentCandidate =
      currentBlock > RECONCILE_RECENT_LOOKBACK_BLOCKS
        ? currentBlock - RECONCILE_RECENT_LOOKBACK_BLOCKS
        : INDEXER_START_BLOCK;
    const recentFrom = recentCandidate > INDEXER_START_BLOCK ? recentCandidate : INDEXER_START_BLOCK;
    const resumingFullScan = reconcileBlockCursor?.epoch === epNum;
    let logs = resumingFullScan
      ? []
      : await fetchLogsByTopicsChunked(
          [resolvedSig, epTopic],
          `EpochResolved:${epNum}:recent`,
          recentFrom,
          currentBlock,
          RECONCILE_SCAN_CHUNK_BLOCKS,
          budget,
        );
    logs = filterLogsByTopics(logs, [resolvedSig, epTopic]);
    if (
      logs.length === 0 &&
      recentFrom > INDEXER_START_BLOCK &&
      fullScanChunksRemaining > 0 &&
      (!reconcileBlockCursor || resumingFullScan)
    ) {
      const fullScanCeiling = recentFrom - 1n;
      const cursorToBlock = reconcileBlockCursor?.epoch === epNum &&
          reconcileBlockCursor.nextToBlock < fullScanCeiling
        ? reconcileBlockCursor.nextToBlock
        : fullScanCeiling;
      const fullScanPlan = createBoundedBackwardBlockScanPlan(
        INDEXER_START_BLOCK,
        cursorToBlock,
        RECONCILE_SCAN_CHUNK_BLOCKS,
        fullScanChunksRemaining,
      );
      fullScanChunksRemaining -= fullScanPlan.chunkCount;
      console.log(
        `[indexer][reconcile] Epoch ${epNum} not found in recent tail; scanning bounded history ` +
          `${fullScanPlan.fromBlock}-${fullScanPlan.toBlock} (${fullScanPlan.chunkCount} chunks)`,
      );
      logs = fullScanPlan.chunkCount > 0
        ? await fetchLogsByTopicsChunked(
            [resolvedSig, epTopic],
            `EpochResolved:${epNum}:history`,
            fullScanPlan.fromBlock,
            fullScanPlan.toBlock,
            RECONCILE_SCAN_CHUNK_BLOCKS,
            budget,
          )
        : [];
      logs = filterLogsByTopics(logs, [resolvedSig, epTopic]);
      if (logs.length > 0 || fullScanPlan.complete) {
        setReconcileBlockCursor(null);
        reconcileBlockCursor = null;
      } else if (fullScanPlan.nextToBlock !== null) {
        reconcileBlockCursor = {
          epoch: epNum,
          nextToBlock: fullScanPlan.nextToBlock,
        };
        setReconcileBlockCursor(reconcileBlockCursor);
      }
    }
    if (logs.length === 0) continue;

    let isDailyJackpot = false;
    let isWeeklyJackpot = false;
    try {
      type EpochState = readonly [bigint, bigint, bigint, boolean, boolean, boolean];
      const epochState = await readWithExactIndexerRpcAgreement<EpochState>(
        `read epochs(${epNum},${currentBlock})`,
        (rpcClient) => rpcClient.readContract({
          address: CONTRACT,
          abi: READ_ABI,
          functionName: "epochs",
          args: [BigInt(epNum)],
          blockNumber: currentBlock,
        }) as Promise<EpochState>,
        (value) => value.map((item) => String(item)).join(":"),
        budget,
      );
      isDailyJackpot = Boolean(epochState[4]);
      isWeeklyJackpot = Boolean(epochState[5]);
    } catch (err) {
      if (isIndexerRpcWorkBudgetError(err)) throw err;
      console.warn(`[indexer][reconcile] Could not read jackpot flags for epoch ${epNum}: ${describeIndexerError(err)}`);
      continue;
    }

    // Keep last resolved log for epoch (safety)
    const log = logs[logs.length - 1];
    try {
      await verifyCanonicalLogBlockHashes(
        [log],
        (blockNumber) => readCanonicalBlockHash(blockNumber, budget),
      );
      const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
      if (decoded.eventName !== "EpochResolved") continue;
      const args = decoded.args as {
        epoch: bigint; winningTile: bigint; totalPool: bigint; fee: bigint; rewardPool: bigint; jackpotBonus: bigint;
      };
      const winningTile = parseChainTileId(args.winningTile);
      if (winningTile === null) continue;
      epochsPatch.set(args.epoch.toString(), {
        winningTile,
        totalPool: formatUnits(args.totalPool, 18),
        rewardPool: formatUnits(args.rewardPool, 18),
        fee: formatUnits(args.fee, 18),
        jackpotBonus: formatUnits(args.jackpotBonus, 18),
        isDailyJackpot,
        isWeeklyJackpot,
        resolvedBlock: (log.blockNumber ?? 0n).toString(),
      });
    } catch (err) {
      if (isIndexerRpcWorkBudgetError(err)) throw err;
      console.warn("[indexer][reconcile] Failed to decode epoch log:", describeIndexerError(err));
    }
    await delay(Math.min(targets.length <= 8 ? 50 : 150, budget.remainingTimeMs()));
    } catch (err) {
      if (!isIndexerRpcWorkBudgetError(err)) throw err;
      console.warn(
        `[indexer][reconcile] RPC budget exhausted at epoch ${epNum}; unwinding the pass.`,
      );
      throw err;
    }
  }

  if (epochsPatch.size > 0) {
    runIndexerStorageTransaction(
      getActiveIndexerLeaseOwnerToken(),
      () => {
        writeEpochs(epochsPatch);
        setReconcileEpochCursorInsideLease(nextReconcileEpochCursor);
      },
    );
    console.log(`[indexer][reconcile] Repaired ${epochsPatch.size} epochs`);
    const status: IndexerReconcileStatus = {
      at: Date.now(),
      currentEpoch: currentEpochNumber,
      missingEpochs: targets.length,
      repairedEpochs: epochsPatch.size,
      targetEpochs: targets,
    };
    setIndexerStatus("indexerReconcileStatus", status);
    return epochsPatch.size;
  }
  setReconcileEpochCursor(nextReconcileEpochCursor);
  console.log("[indexer][reconcile] No resolvable missing epochs in this pass");
  const status: IndexerReconcileStatus = {
    at: Date.now(),
    currentEpoch: currentEpochNumber,
    missingEpochs: targets.length,
    repairedEpochs: 0,
    targetEpochs: targets,
  };
  setIndexerStatus("indexerReconcileStatus", status);
  return 0;
}

async function runIndexedMaintenance(
  chainTargetBlock: bigint,
  budget: IndexerRpcWorkBudget,
) {
  assertActiveIndexerLease();
  const indexedBlock = await getLastBlock();
  const maintenanceTarget = indexedBlock < chainTargetBlock ? indexedBlock : chainTargetBlock;
  await runRepairPass(maintenanceTarget, budget);
  await runEpochReconcile(maintenanceTarget, budget);
}

// Main loop
async function runOnce(budget: IndexerRpcWorkBudget) {
  assertActiveIndexerLease();
  let lastBlock = await getLastBlock();
  const headBlock = await readAgreedHeadBlockNumber(budget);
  const currentBlock = getIndexerFinalityTargetBlock(headBlock, INDEXER_FINALITY_BLOCKS);

  let previousCheckpoint: IndexerBlockCheckpoint | null = null;
  if (currentBlock !== null) {
    const recovered = await recoverCanonicalIndexerState(lastBlock, budget);
    lastBlock = recovered.lastBlock;
    previousCheckpoint = recovered.checkpoint;
  }

  const fromBlock = lastBlock + 1n;
  const startedAt = Date.now();
  if (currentBlock === null) {
    const status: IndexerRunStatus = {
      startedAt,
      lastHeartbeatAt: startedAt,
      completedAt: Date.now(),
      fromBlock: fromBlock.toString(),
      toBlock: headBlock.toString(),
      headBlock: headBlock.toString(),
      finalityBlocks: INDEXER_FINALITY_BLOCKS.toString(),
      targetBlock: null,
      totalLogs: 0,
      currentChunk: 0,
      totalChunks: 0,
      lastProcessedBlock: lastBlock.toString(),
    };
    setIndexerStatus("indexerRunStatus", status);
    await updateCurrentEpochMeta(headBlock, budget);
    return 0;
  }

  const catchupChunkBlocks = getIndexerCatchupChunkBlocks();
  const runPlan = createBoundedIndexerRunPlan(
    lastBlock,
    currentBlock,
    catchupChunkBlocks,
    MAX_RUN_HEAD_GAP_BLOCKS,
    MAX_RUN_CHUNKS,
  );
  const runTargetBlock = runPlan.toBlock;
  if (runPlan.chunkCount === 0) {
    if (catchupChunkBlocks !== RUN_CHUNK_BLOCKS) {
      runIndexerStorageTransaction(getActiveIndexerLeaseOwnerToken(), () => {
        setMetaJson(INDEXER_CATCHUP_CHUNK_BLOCKS_META_KEY, null);
      });
    }
    const status: IndexerRunStatus = {
      startedAt,
      lastHeartbeatAt: startedAt,
      completedAt: Date.now(),
      fromBlock: fromBlock.toString(),
      toBlock: currentBlock.toString(),
      headBlock: headBlock.toString(),
      finalityBlocks: INDEXER_FINALITY_BLOCKS.toString(),
      targetBlock: currentBlock.toString(),
      totalLogs: 0,
      currentChunk: 0,
      totalChunks: 0,
      lastProcessedBlock: lastBlock.toString(),
    };
    setIndexerStatus("indexerRunStatus", status);
    return 0;
  }

  if (runPlan.capped) {
    console.warn(
      `[indexer] Capping this run at ${runTargetBlock}; finalized target ${currentBlock} remains ahead.`,
    );
  }
  console.log(
    `[indexer] Scanning blocks ${fromBlock} -> ${runTargetBlock} (${runTargetBlock - fromBlock + 1n} blocks, head ${headBlock}, finality ${INDEXER_FINALITY_BLOCKS})`,
  );

  let totalLogs = 0;
  const chunkCount = runPlan.chunkCount;
  let committedChunksThisPass = 0;

  let chunkIndex = 0;
  setIndexerStatus("indexerRunStatus", {
    startedAt,
    lastHeartbeatAt: startedAt,
    fromBlock: fromBlock.toString(),
    toBlock: runTargetBlock.toString(),
    headBlock: headBlock.toString(),
    finalityBlocks: INDEXER_FINALITY_BLOCKS.toString(),
    targetBlock: currentBlock.toString(),
    totalLogs: 0,
    currentChunk: 0,
    totalChunks: chunkCount,
    lastProcessedBlock: lastBlock.toString(),
  } satisfies IndexerRunStatus);
  for (let start = fromBlock; start <= runTargetBlock; start += catchupChunkBlocks) {
    const end = start + catchupChunkBlocks - 1n > runTargetBlock
      ? runTargetBlock
      : start + catchupChunkBlocks - 1n;
    chunkIndex += 1;

    console.log(`[indexer] Chunk ${chunkIndex}/${chunkCount}: ${start} -> ${end}`);
    let canonicalChunk: Awaited<ReturnType<typeof fetchCanonicalChunk>>;
    try {
      canonicalChunk = await fetchCanonicalChunk(start, end, previousCheckpoint, budget);
    } catch (error) {
      if (
        isIndexerRpcWorkBudgetError(error) &&
        committedChunksThisPass === 0 &&
        end > start
      ) {
        const reducedChunkBlocks = reduceIndexerCatchupChunkBlocks(end - start + 1n);
        runIndexerStorageTransaction(getActiveIndexerLeaseOwnerToken(), () => {
          setMetaJson(
            INDEXER_CATCHUP_CHUNK_BLOCKS_META_KEY,
            reducedChunkBlocks.toString(),
          );
        });
        console.warn(
          `[indexer] Persisted a reduced catch-up chunk span of ${reducedChunkBlocks} blocks ` +
            "after pre-commit RPC budget exhaustion.",
        );
      }
      throw error;
    }
    const logs = canonicalChunk.logs;
    totalLogs += logs.length;
    console.log(`[indexer] Chunk ${chunkIndex}/${chunkCount} fetched ${logs.length} logs`);

    const parsed = processLogs(logs);
    if (logs.length > 0) {
      console.log(`[indexer] Chunk ${chunkIndex}/${chunkCount} parsed: ${parsed.bets.length} bets, ${parsed.epochs.size} epochs, ${parsed.jackpots.length} jackpots, ${parsed.rewardClaims.length} claims`);
    }

    commitIndexerChunk({
      leaseOwnerToken: getActiveIndexerLeaseOwnerToken(),
      expectedPreviousBlock: start - 1n,
      expectedPreviousBlockHash: previousCheckpoint?.blockHash ?? null,
      blockNumber: end,
      blockHash: canonicalChunk.blockHash,
    }, () => {
      writeBets(parsed.bets);
      writeEpochs(parsed.epochs);
      writeJackpots(parsed.jackpots);
      writeRewardClaims(parsed.rewardClaims);
      writeFeeFlushes(parsed.feeFlushes);
      writeBatchClaims(parsed.batchClaims);
      writeResolverRewards(parsed.resolverRewards);
      writeDustSettlements(parsed.dustSettlements);
      if (end === currentBlock) {
        setMetaJson(INDEXER_CATCHUP_CHUNK_BLOCKS_META_KEY, null);
      }
    });
    committedChunksThisPass += 1;
    previousCheckpoint = {
      blockNumber: end.toString(),
      blockHash: canonicalChunk.blockHash,
    };
    console.log(`[indexer] Chunk ${chunkIndex}/${chunkCount} committed to local SQLite`);
    await updateCurrentEpochMeta(end, budget);
    setIndexerStatus("indexerRunStatus", {
      startedAt,
      lastHeartbeatAt: Date.now(),
      fromBlock: fromBlock.toString(),
      toBlock: runTargetBlock.toString(),
      headBlock: headBlock.toString(),
      finalityBlocks: INDEXER_FINALITY_BLOCKS.toString(),
      targetBlock: currentBlock.toString(),
      totalLogs,
      currentChunk: chunkIndex,
      totalChunks: chunkCount,
      lastProcessedBlock: end.toString(),
    } satisfies IndexerRunStatus);
  }

  console.log(`[indexer] Finished runOnce with ${totalLogs} logs`);
  await updateCurrentEpochMeta(runTargetBlock, budget);
  const status: IndexerRunStatus = {
    startedAt,
    lastHeartbeatAt: Date.now(),
    completedAt: Date.now(),
    fromBlock: fromBlock.toString(),
    toBlock: runTargetBlock.toString(),
    headBlock: headBlock.toString(),
    finalityBlocks: INDEXER_FINALITY_BLOCKS.toString(),
    targetBlock: currentBlock.toString(),
    totalLogs,
    currentChunk: chunkCount,
    totalChunks: chunkCount,
    lastProcessedBlock: runTargetBlock.toString(),
  };
  setIndexerStatus("indexerRunStatus", status);
  return totalLogs;
}

async function runIndexerPass() {
  const budget = createIndexerRpcWorkBudget({
    maxRpcCalls: INDEXER_RUN_MAX_RPC_CALLS,
    maxLogs: INDEXER_RUN_MAX_LOGS,
    maxLogsPerResponse: INDEXER_RPC_MAX_LOGS_PER_RESPONSE,
    maxSplitNodes: INDEXER_RUN_MAX_SPLIT_NODES,
    maxElapsedMs: INDEXER_RUN_MAX_ELAPSED_MS,
  });
  await runOnce(budget);
  const head = await readAgreedHeadBlockNumber(budget);
  const target = getIndexerFinalityTargetBlock(head, INDEXER_FINALITY_BLOCKS);
  if (target === null) {
    await updateCurrentEpochMeta(head, budget);
  } else {
    await runIndexedMaintenance(target, budget);
  }
}

async function main() {
  const isWatch = process.argv.includes("--watch");
  const leaseOwnerToken = randomUUID();
  if (!acquireIndexerLease(leaseOwnerToken, INDEXER_LEASE_TTL_MS)) {
    throw new Error("indexer lease is already held for this storage scope");
  }

  activeIndexerLeaseOwnerToken = leaseOwnerToken;
  let leaseLost = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let watchTimer: ReturnType<typeof setInterval> | null = null;

  const markLeaseLost = () => {
    if (leaseLost) return;
    leaseLost = true;
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
    if (watchTimer !== null) clearInterval(watchTimer);
    console.error("[indexer] SQLite indexer lease lost; stopping without further indexed writes.");
    process.exitCode = 1;
    if (isWatch) {
      setImmediate(() => process.exit(1));
    }
  };

  assertActiveIndexerLease = () => {
    if (leaseLost) {
      throw new IndexerLeaseError("indexer lease is unavailable or lost");
    }
    let held = false;
    try {
      held = heartbeatIndexerLease(leaseOwnerToken, INDEXER_LEASE_TTL_MS);
    } catch {
      markLeaseLost();
      throw new IndexerLeaseError("indexer lease heartbeat failed");
    }
    if (!held) {
      markLeaseLost();
      throw new IndexerLeaseError("indexer lease is unavailable or lost");
    }
  };

  const stopAndReleaseLease = (strict: boolean) => {
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
    if (watchTimer !== null) clearInterval(watchTimer);
    heartbeatTimer = null;
    watchTimer = null;
    let released = false;
    try {
      released = releaseIndexerLease(leaseOwnerToken);
    } catch {
      if (strict) throw new Error("indexer lease release failed");
    } finally {
      activeIndexerLeaseOwnerToken = null;
      assertActiveIndexerLease = () => {
        throw new IndexerLeaseError("indexer lease is not initialized");
      };
    }
    if (strict && !released) {
      throw new Error("indexer lease was lost before release");
    }
  };

  heartbeatTimer = setInterval(() => {
    try {
      assertActiveIndexerLease();
    } catch {
      // The assertion marks the lease lost and stops both timers.
    }
  }, INDEXER_LEASE_HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();

  try {
    assertActiveIndexerLease();
    console.log(`[indexer] SQLite path: ${process.env.LORE_DB_PATH ?? "data/lore.sqlite"}`);
    console.log(`[indexer] Contract: ${CONTRACT}`);
    console.log(`[indexer] Deploy block: ${DEPLOY_BLOCK}`);
    console.log(`[indexer] Start block: ${INDEXER_START_BLOCK}`);
    console.log(`[indexer] Finality blocks: ${INDEXER_FINALITY_BLOCKS}`);
    console.log(`[indexer] Mode: ${isWatch ? "watch (continuous)" : "one-shot"}`);

    await runIndexerPass();

    if (!isWatch) {
      stopAndReleaseLease(true);
      return;
    }

    console.log(`[indexer] Watching for new blocks every ${POLL_INTERVAL_MS / 1000}s...`);
    let running = false;
    let consecutiveFailures = 0;
    watchTimer = setInterval(async () => {
      if (running || leaseLost) return;
      running = true;
      try {
        assertActiveIndexerLease();
        await runIndexerPass();
        consecutiveFailures = 0;
      } catch (err) {
        if (leaseLost) {
          process.exitCode = 1;
          return;
        }
        if (isIndexerRpcWorkBudgetError(err)) {
          console.error(
            "[indexer] RPC work budget exhausted; releasing the lease for supervisor recovery:",
            describeIndexerError(err),
          );
          stopAndReleaseLease(false);
          process.exit(1);
        }
        const failure = recordIndexerWatchFailure(consecutiveFailures, WATCH_FAILURE_LIMIT);
        consecutiveFailures = failure.failures;
        console.error(
          `[indexer] Error in watch loop (${consecutiveFailures}/${WATCH_FAILURE_LIMIT}):`,
          describeIndexerError(err),
        );
        if (failure.shouldRestart) {
          console.error("[indexer] Persistent watch failure threshold reached; exiting for supervisor restart.");
          stopAndReleaseLease(false);
          process.exit(1);
        }
      } finally {
        running = false;
      }
    }, POLL_INTERVAL_MS);
  } catch (error) {
    stopAndReleaseLease(false);
    throw error;
  }
}

main()
  .then(() => {
    if (!process.argv.includes("--watch")) {
      process.exit(0);
    }
  })
  .catch((err) => {
    console.error("[indexer] Fatal:", describeIndexerError(err));
    process.exit(1);
  });
