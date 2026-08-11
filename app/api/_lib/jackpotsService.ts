import { decodeEventLog, encodeEventTopics, formatUnits, toHex } from "viem";
import {
  GAME_ABI as READ_ABI,
  GAME_EVENTS_ABI as EVENTS_ABI,
} from "../../../config/generated/lineaOreV10Abi";
import { parseOptionalNonNegativeBigIntEnv } from "../../../config/envParsing";
import { formatLineaWeiDisplayNumber } from "../../lib/tokenAmountMath";
import {
  getIndexerBlockCheckpoints,
  getMetaBigInt,
  getRecentJackpots,
  normalizeIndexerLogIndex,
} from "../../../server/storage";
import {
  getIndexerFinalityTargetBlock,
  parseIndexerFinalityBlocks,
} from "../../lib/indexerFinality";
import {
  CONTRACT_ADDRESS,
  CONTRACT_DEPLOY_BLOCK,
  isSafePositiveInteger,
  publicClient,
} from "./dataBridge";
import {
  parseStoredBlockNumberOrZero,
  parseStoredPositiveIntegerOrZero,
} from "./storedNumberParsing";
import { logRouteError } from "./routeError";
import { markRouteBackgroundRefresh } from "./runtimeMetrics";

const [dailySig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "DailyJackpotAwarded" });
const [weeklySig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "WeeklyJackpotAwarded" });
const JACKPOT_LOG_SCAN_CHUNK = 10_000n;
const JACKPOT_LOG_SCAN_MIN_CHUNK = 2_000n;
const JACKPOT_ROUTE_CACHE_MS = 60_000;
const JACKPOT_EVENT_CACHE_MS = 5 * 60 * 1000;
const JACKPOT_BACKGROUND_RECOVERY_COOLDOWN_MS = 2 * 60 * 1000;
const MAX_JACKPOT_EVENT_CACHE_ENTRIES = 256;
const JACKPOT_HISTORY_LIMIT = 200;
const JACKPOT_BOOTSTRAP_SCAN_CHUNK = 10_000n;
const JACKPOT_RECOVERY_BLOCK_LAG = parseOptionalNonNegativeBigIntEnv(process.env.JACKPOT_RECOVERY_BLOCK_LAG, 256n);
const ROUTE_METRIC_KEY = "api/jackpots";

export const JACKPOT_RECOVERY_MAX_LOG_BLOCKS = 120_000n;
export const JACKPOT_RECOVERY_MAX_LOG_RANGE_BLOCKS = 40_000n;
export const JACKPOT_RECOVERY_MAX_RPC_CALLS = 48;
export const JACKPOT_RECOVERY_MAX_LOGS = 4_096;
export const JACKPOT_RECOVERY_MAX_DURATION_MS = 15_000;

export type JackpotRow = {
  epoch: string;
  kind: "daily" | "weekly";
  amount: string;
  amountNum: number;
  txHash: string;
  blockNumber: string;
  timestamp?: number | null;
};

export type JackpotPayload = {
  jackpots: JackpotRow[];
  error?: string;
};

export type JackpotReadResult = {
  payload: JackpotPayload;
  source: "cache" | "stale-cache" | "rebuilt";
};
type JackpotReadOptions = {
  bypassResponseCache?: boolean;
};

type JackpotEventLookup = { txHash: string; blockNumber: string; timestamp: number | null } | null;
type JackpotCacheEntry = { payload: JackpotPayload; expiresAt: number };
type JackpotEventCacheEntry = { value: JackpotEventLookup; expiresAt: number };
type JackpotBlockTimestampCacheEntry = { value: number | null; expiresAt: number };
type JackpotLog = Awaited<ReturnType<typeof publicClient.getLogs>>[number];
type JackpotLogsRequest = {
  address: typeof CONTRACT_ADDRESS;
  topics: readonly unknown[];
  fromBlock: bigint;
  toBlock: bigint;
};
type JackpotBuildResult = { payload: JackpotPayload; recoveryNeeded: boolean };

export type JackpotRecoveryBudget = {
  cacheOnly: boolean;
  deadlineAtMs: number;
  remainingLogBlocks: bigint;
  remainingRpcCalls: number;
  remainingLogs: number;
};

function assertJackpotRecoveryTimeBudget(budget: JackpotRecoveryBudget, nowMs: number) {
  if (!Number.isFinite(nowMs) || nowMs >= budget.deadlineAtMs) {
    throw new Error("Jackpot recovery time budget exhausted");
  }
}

export function createJackpotRecoveryBudget(nowMs = Date.now()): JackpotRecoveryBudget {
  if (!Number.isFinite(nowMs)) {
    throw new Error("Jackpot recovery budget requires a finite start time");
  }
  return {
    cacheOnly: false,
    deadlineAtMs: nowMs + JACKPOT_RECOVERY_MAX_DURATION_MS,
    remainingLogBlocks: JACKPOT_RECOVERY_MAX_LOG_BLOCKS,
    remainingRpcCalls: JACKPOT_RECOVERY_MAX_RPC_CALLS,
    remainingLogs: JACKPOT_RECOVERY_MAX_LOGS,
  };
}

export function planJackpotRecoveryLogRange(input: {
  budget: JackpotRecoveryBudget;
  fromBlock: bigint;
  toBlock: bigint;
  nowMs?: number;
}) {
  assertJackpotRecoveryTimeBudget(input.budget, input.nowMs ?? Date.now());
  if (input.toBlock < input.fromBlock) return null;
  if (input.budget.remainingRpcCalls <= 0) {
    throw new Error("Jackpot recovery RPC call budget exhausted");
  }
  if (input.budget.remainingLogBlocks <= 0n) {
    throw new Error("Jackpot recovery block budget exhausted");
  }

  const requestedBlocks = input.toBlock - input.fromBlock + 1n;
  const allowedBlocks = [
    requestedBlocks,
    input.budget.remainingLogBlocks,
    JACKPOT_RECOVERY_MAX_LOG_RANGE_BLOCKS,
  ].reduce((smallest, value) => value < smallest ? value : smallest);
  const boundedFromBlock = input.toBlock - allowedBlocks + 1n;
  const complete = allowedBlocks === requestedBlocks;
  if (!complete) input.budget.cacheOnly = true;
  return {
    fromBlock: boundedFromBlock > input.fromBlock ? boundedFromBlock : input.fromBlock,
    toBlock: input.toBlock,
    complete,
  };
}

export function reserveJackpotRecoveryRpcCall(
  budget: JackpotRecoveryBudget,
  input: { fromBlock?: bigint; toBlock?: bigint; nowMs?: number } = {},
) {
  assertJackpotRecoveryTimeBudget(budget, input.nowMs ?? Date.now());
  if (budget.remainingRpcCalls <= 0) {
    throw new Error("Jackpot recovery RPC call budget exhausted");
  }

  const hasFromBlock = input.fromBlock !== undefined;
  const hasToBlock = input.toBlock !== undefined;
  if (hasFromBlock !== hasToBlock) {
    throw new Error("Jackpot recovery log calls require both range bounds");
  }
  const scannedBlocks = hasFromBlock && hasToBlock
    ? input.toBlock! - input.fromBlock! + 1n
    : 0n;
  if ((hasFromBlock && scannedBlocks <= 0n) || scannedBlocks > budget.remainingLogBlocks) {
    throw new Error("Jackpot recovery block budget exhausted");
  }

  budget.remainingRpcCalls -= 1;
  budget.remainingLogBlocks -= scannedBlocks;
}

export function recordJackpotRecoveryLogCount(
  budget: JackpotRecoveryBudget,
  count: number,
) {
  if (!Number.isSafeInteger(count) || count < 0 || count > budget.remainingLogs) {
    throw new Error("Jackpot recovery log result budget exhausted");
  }
  budget.remainingLogs -= count;
}

async function runBudgetedJackpotRecoveryRpc<T>(
  budget: JackpotRecoveryBudget | undefined,
  operation: () => Promise<T>,
  range?: { fromBlock: bigint; toBlock: bigint },
): Promise<T> {
  if (!budget) return operation();

  reserveJackpotRecoveryRpcCall(budget, range);
  const remainingMs = budget.deadlineAtMs - Date.now();
  if (remainingMs <= 0) {
    throw new Error("Jackpot recovery time budget exhausted");
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Jackpot recovery time budget exhausted")),
          remainingMs,
        );
      }),
    ]);
    assertJackpotRecoveryTimeBudget(budget, Date.now());
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function getJackpotLogsWithinBudget(
  budget: JackpotRecoveryBudget,
  request: Parameters<typeof publicClient.getLogs>[0] & { fromBlock: bigint; toBlock: bigint },
) {
  const logs = await runBudgetedJackpotRecoveryRpc(
    budget,
    () => publicClient.getLogs(request),
    { fromBlock: request.fromBlock, toBlock: request.toBlock },
  );
  recordJackpotRecoveryLogCount(budget, logs.length);
  return logs;
}

export type FinalizedRecoveryContext = {
  blockNumber: bigint;
  blockHash: `0x${string}`;
  finalityBlocks: bigint;
  durableThroughBlock: bigint | null;
  durableCheckpointHash: `0x${string}` | null;
};

function normalizeRecoveryBlockHash(value: string | null | undefined): `0x${string}` | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return /^0x[0-9a-f]{64}$/.test(normalized) ? normalized as `0x${string}` : null;
}

export function getCanonicalRecoveryLogIdentity(input: {
  removed?: unknown;
  address?: unknown;
  transactionHash?: unknown;
  blockHash?: unknown;
  blockNumber?: unknown;
  logIndex?: unknown;
}) {
  if (input.removed !== false) return null;
  const address = typeof input.address === "string" ? input.address.trim().toLowerCase() : "";
  const txHash = normalizeJackpotTxHash(
    typeof input.transactionHash === "string" ? input.transactionHash : null,
  );
  const blockHash = normalizeRecoveryBlockHash(
    typeof input.blockHash === "string" ? input.blockHash : null,
  );
  const blockNumber = typeof input.blockNumber === "bigint" ? input.blockNumber : null;
  const logIndex = normalizeIndexerLogIndex(input.logIndex);
  if (
    address !== CONTRACT_ADDRESS.toLowerCase() ||
    txHash === "" ||
    blockHash === null ||
    blockNumber === null ||
    blockNumber < CONTRACT_DEPLOY_BLOCK ||
    logIndex === null
  ) {
    return null;
  }
  return { address, txHash, blockHash, blockNumber, logIndex };
}

function parseRecoveryCheckpointBlock(value: string): bigint | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = BigInt(value);
  return parsed >= CONTRACT_DEPLOY_BLOCK ? parsed : null;
}

export function deriveDurableRecoveryCheckpoint(input: {
  finalityBlocks: bigint;
  targetBlock: bigint;
  lastIndexedBlock: bigint | null;
  checkpointBlock: bigint | null;
  checkpointHash: string | null;
  observedCheckpointHash: string | null;
}) {
  const checkpointHash = normalizeRecoveryBlockHash(input.checkpointHash);
  const observedCheckpointHash = normalizeRecoveryBlockHash(input.observedCheckpointHash);
  if (
    input.finalityBlocks <= 0n ||
    input.lastIndexedBlock === null ||
    input.lastIndexedBlock < CONTRACT_DEPLOY_BLOCK ||
    input.lastIndexedBlock > input.targetBlock ||
    input.checkpointBlock !== input.lastIndexedBlock ||
    checkpointHash === null ||
    observedCheckpointHash !== checkpointHash
  ) {
    return null;
  }
  return {
    blockNumber: input.lastIndexedBlock,
    blockHash: checkpointHash,
  };
}

export function canDurablyPersistRecoveredBlock(
  context: FinalizedRecoveryContext,
  blockNumber: bigint,
) {
  return (
    context.durableThroughBlock !== null &&
    blockNumber >= CONTRACT_DEPLOY_BLOCK &&
    blockNumber <= context.durableThroughBlock
  );
}

export function isRecoverySnapshotDurable(context: FinalizedRecoveryContext) {
  return context.durableThroughBlock === context.blockNumber;
}

export async function loadFinalizedRecoveryContext(
  budget?: JackpotRecoveryBudget,
): Promise<FinalizedRecoveryContext | null> {
  const finalityBlocks = parseIndexerFinalityBlocks(process.env.INDEXER_FINALITY_BLOCKS);
  const headBlock = await runBudgetedJackpotRecoveryRpc(
    budget,
    () => publicClient.getBlockNumber(),
  );
  const targetBlock = getIndexerFinalityTargetBlock(headBlock, finalityBlocks);
  if (targetBlock === null || targetBlock < CONTRACT_DEPLOY_BLOCK) return null;

  const target = await runBudgetedJackpotRecoveryRpc(
    budget,
    () => publicClient.getBlock({ blockNumber: targetBlock }),
  );
  const targetHash = normalizeRecoveryBlockHash(target.hash);
  if (targetHash === null) {
    throw new Error("RPC returned an invalid finalized recovery block hash");
  }

  const lastIndexedBlock = getMetaBigInt("lastIndexedBlock");
  const checkpoint = lastIndexedBlock === null
    ? null
    : getIndexerBlockCheckpoints().find(
        (row) => parseRecoveryCheckpointBlock(row.blockNumber) === lastIndexedBlock,
      ) ?? null;
  let observedCheckpointHash: string | null = null;
  if (
    finalityBlocks > 0n &&
    lastIndexedBlock !== null &&
    lastIndexedBlock >= CONTRACT_DEPLOY_BLOCK &&
    lastIndexedBlock <= targetBlock &&
    checkpoint !== null
  ) {
    try {
      observedCheckpointHash = lastIndexedBlock === targetBlock
        ? targetHash
        : normalizeRecoveryBlockHash(
            (await runBudgetedJackpotRecoveryRpc(
              budget,
              () => publicClient.getBlock({ blockNumber: lastIndexedBlock }),
            )).hash,
          );
    } catch {
      observedCheckpointHash = null;
    }
  }
  const durableCheckpoint = deriveDurableRecoveryCheckpoint({
    finalityBlocks,
    targetBlock,
    lastIndexedBlock,
    checkpointBlock: checkpoint ? parseRecoveryCheckpointBlock(checkpoint.blockNumber) : null,
    checkpointHash: checkpoint?.blockHash ?? null,
    observedCheckpointHash,
  });

  return {
    blockNumber: targetBlock,
    blockHash: targetHash,
    finalityBlocks,
    durableThroughBlock: durableCheckpoint?.blockNumber ?? null,
    durableCheckpointHash: durableCheckpoint?.blockHash ?? null,
  };
}

export async function isRecoveryContextCurrent(
  context: FinalizedRecoveryContext,
  budget?: JackpotRecoveryBudget,
) {
  try {
    const targetHash = normalizeRecoveryBlockHash(
      (await runBudgetedJackpotRecoveryRpc(
        budget,
        () => publicClient.getBlock({ blockNumber: context.blockNumber }),
      )).hash,
    );
    return targetHash === context.blockHash;
  } catch {
    return false;
  }
}

export async function isRecoveryPersistenceContextCurrent(
  context: FinalizedRecoveryContext,
  budget?: JackpotRecoveryBudget,
) {
  if (
    context.durableThroughBlock === null ||
    context.durableCheckpointHash === null ||
    !(await isRecoveryContextCurrent(context, budget))
  ) {
    return false;
  }
  if (context.durableThroughBlock === context.blockNumber) return true;
  try {
    const checkpointHash = normalizeRecoveryBlockHash(
      (await runBudgetedJackpotRecoveryRpc(
        budget,
        () => publicClient.getBlock({ blockNumber: context.durableThroughBlock! }),
      )).hash,
    );
    return checkpointHash === context.durableCheckpointHash;
  } catch {
    return false;
  }
}

let jackpotResponseCache: JackpotCacheEntry | null = null;
let jackpotBackgroundRecoveryPromise: Promise<void> | null = null;
let jackpotBackgroundRecoveryStartedAt = 0;
let jackpotBuildSeq = 0;
let jackpotAppliedSeq = 0;
const jackpotEventCache = new Map<string, JackpotEventCacheEntry>();
const jackpotBlockTimestampCache = new Map<string, JackpotBlockTimestampCacheEntry>();

function setJackpotEventCache(cacheKey: string, value: JackpotEventLookup) {
  jackpotEventCache.set(cacheKey, { value, expiresAt: Date.now() + JACKPOT_EVENT_CACHE_MS });
  while (jackpotEventCache.size > MAX_JACKPOT_EVENT_CACHE_ENTRIES) {
    const oldestKey = jackpotEventCache.keys().next().value;
    if (!oldestKey) break;
    jackpotEventCache.delete(oldestKey);
  }
}

function commitJackpotResponseCache(payload: JackpotPayload, ttlMs: number, seq: number) {
  if (seq < jackpotAppliedSeq) {
    return jackpotResponseCache?.payload ?? payload;
  }

  jackpotAppliedSeq = seq;
  jackpotResponseCache = {
    payload,
    expiresAt: Date.now() + ttlMs,
  };
  return payload;
}

function isTooManyResultsError(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    message.includes("more than 10000 results") ||
    message.includes("query returned more than 10000 results") ||
    (message.includes("range") && message.includes("exceeds limit")) ||
    message.includes("request exceeds defined limit")
  );
}

function sortJackpotsDesc(rows: JackpotRow[]) {
  return [...rows].sort((a, b) => {
    const aBlock = parseStoredBlockNumber(a.blockNumber);
    const bBlock = parseStoredBlockNumber(b.blockNumber);
    if (aBlock === bBlock) {
      if (a.epoch === b.epoch) {
        if (a.kind === b.kind) return (b.txHash ?? "").localeCompare(a.txHash ?? "");
        return a.kind === "weekly" ? -1 : 1;
      }
      return parseStoredEpochNumber(b.epoch) - parseStoredEpochNumber(a.epoch);
    }
    return aBlock > bBlock ? -1 : 1;
  });
}

function parseStoredBlockNumber(value: string | null | undefined): bigint {
  return parseStoredBlockNumberOrZero(value);
}

function parseStoredEpochNumber(value: string | null | undefined): number {
  return parseStoredPositiveIntegerOrZero(value);
}

function parseChainUintEpochNumber(value: unknown): number | null {
  if (typeof value !== "bigint" || value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const parsed = Number(value);
  return isSafePositiveInteger(parsed) ? parsed : null;
}

function toSafeBlockTimestampMs(value: bigint): number | null {
  if (value < 0n) return null;
  const maxSafeSeconds = BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1000));
  if (value > maxSafeSeconds) return null;
  return Number(value) * 1000;
}

function normalizeJackpotTxHash(txHash: string | null | undefined): `0x${string}` | "" {
  const normalized = String(txHash ?? "").toLowerCase().trim();
  return /^0x[0-9a-f]{64}$/.test(normalized) ? (normalized as `0x${string}`) : "";
}

function toDisplayNumberWei(value: bigint): number {
  return formatLineaWeiDisplayNumber(value);
}

function mapJackpotLog(log: JackpotLog): JackpotRow | null {
  const topic0 = log.topics[0];
  if (!topic0) return null;
  const identity = getCanonicalRecoveryLogIdentity(log);
  if (!identity) return null;

  try {
    const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
    if (decoded.eventName === "DailyJackpotAwarded") {
      const args = decoded.args as { epoch: bigint; amount: bigint };
      return {
        epoch: args.epoch.toString(),
        kind: "daily",
        amount: formatUnits(args.amount, 18),
        amountNum: toDisplayNumberWei(args.amount),
        txHash: normalizeJackpotTxHash(log.transactionHash),
        blockNumber: identity.blockNumber.toString(),
      };
    }

    if (decoded.eventName === "WeeklyJackpotAwarded") {
      const args = decoded.args as { epoch: bigint; amount: bigint };
      return {
        epoch: args.epoch.toString(),
        kind: "weekly",
        amount: formatUnits(args.amount, 18),
        amountNum: toDisplayNumberWei(args.amount),
        txHash: normalizeJackpotTxHash(log.transactionHash),
        blockNumber: identity.blockNumber.toString(),
      };
    }
  } catch {
    return null;
  }

  return null;
}

function mergeJackpotRows(existing: JackpotRow[], incoming: JackpotRow[]) {
  const byKey = new Map<string, JackpotRow>();
  for (const row of existing) {
    byKey.set(`${row.kind}_${row.epoch}`, row);
  }
  for (const row of incoming) {
    byKey.set(`${row.kind}_${row.epoch}`, row);
  }
  return sortJackpotsDesc(Array.from(byKey.values())).slice(0, JACKPOT_HISTORY_LIMIT);
}

async function getBlockTimestampMs(
  blockNumber: bigint,
  budget?: JackpotRecoveryBudget,
): Promise<number | null> {
  if (blockNumber <= 0n) return null;
  const cacheKey = blockNumber.toString();
  const now = Date.now();
  const cached = jackpotBlockTimestampCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const block = await runBudgetedJackpotRecoveryRpc(
    budget,
    () => publicClient.getBlock({ blockNumber }),
  );
  const value = toSafeBlockTimestampMs(block.timestamp);
  jackpotBlockTimestampCache.set(cacheKey, {
    value,
    expiresAt: now + JACKPOT_EVENT_CACHE_MS,
  });
  while (jackpotBlockTimestampCache.size > MAX_JACKPOT_EVENT_CACHE_ENTRIES) {
    const oldestKey = jackpotBlockTimestampCache.keys().next().value;
    if (!oldestKey) break;
    jackpotBlockTimestampCache.delete(oldestKey);
  }
  return value;
}

async function getLogsChunked(
  request: JackpotLogsRequest,
  budget: JackpotRecoveryBudget,
) {
  const all: Awaited<ReturnType<typeof publicClient.getLogs>> = [];
  const boundedRange = planJackpotRecoveryLogRange({
    budget,
    fromBlock: request.fromBlock,
    toBlock: request.toBlock,
  });
  if (!boundedRange) return all;

  let cursor = boundedRange.fromBlock;
  let chunkSize = JACKPOT_LOG_SCAN_CHUNK;

  while (cursor <= boundedRange.toBlock) {
    const chunkTo =
      cursor + chunkSize - 1n > boundedRange.toBlock
        ? boundedRange.toBlock
        : cursor + chunkSize - 1n;

    try {
      const logs = await getJackpotLogsWithinBudget(budget, {
        ...request,
        fromBlock: cursor,
        toBlock: chunkTo,
      } as Parameters<typeof publicClient.getLogs>[0] & { fromBlock: bigint; toBlock: bigint });
      all.push(...logs);
      cursor = chunkTo + 1n;
      if (chunkSize < JACKPOT_LOG_SCAN_CHUNK) {
        chunkSize = chunkSize * 2n > JACKPOT_LOG_SCAN_CHUNK ? JACKPOT_LOG_SCAN_CHUNK : chunkSize * 2n;
      }
    } catch (err) {
      if (!isTooManyResultsError(err) || chunkSize <= JACKPOT_LOG_SCAN_MIN_CHUNK) {
        throw err;
      }
      chunkSize = chunkSize / 2n;
    }
  }

  return all;
}

async function fetchJackpotLogsInRange(
  fromBlock: bigint,
  toBlock: bigint,
  budget: JackpotRecoveryBudget,
) {
  if (toBlock < fromBlock) return [] as JackpotLog[];
  return getLogsChunked({
    address: CONTRACT_ADDRESS,
    topics: [[dailySig, weeklySig]],
    fromBlock,
    toBlock,
  }, budget);
}

async function fetchRecentJackpotLogsFromChain(
  toBlock: bigint,
  budget: JackpotRecoveryBudget,
  limit = JACKPOT_HISTORY_LIMIT,
) {
  const collected: JackpotLog[] = [];
  const boundedRange = planJackpotRecoveryLogRange({
    budget,
    fromBlock: CONTRACT_DEPLOY_BLOCK,
    toBlock,
  });
  if (!boundedRange) return collected;

  let scanToBlock = boundedRange.toBlock;
  let chunkSize = JACKPOT_BOOTSTRAP_SCAN_CHUNK;

  while (scanToBlock >= boundedRange.fromBlock && collected.length < limit) {
    const fromBlock =
      scanToBlock - chunkSize + 1n > boundedRange.fromBlock
        ? scanToBlock - chunkSize + 1n
        : boundedRange.fromBlock;

    try {
      const logs = await getJackpotLogsWithinBudget(budget, {
        address: CONTRACT_ADDRESS,
        topics: [[dailySig, weeklySig]],
        fromBlock,
        toBlock: scanToBlock,
      } as Parameters<typeof publicClient.getLogs>[0] & { fromBlock: bigint; toBlock: bigint });
      collected.push(...logs);
      if (fromBlock === boundedRange.fromBlock) break;
      scanToBlock = fromBlock - 1n;
    } catch (err) {
      if (!isTooManyResultsError(err) || chunkSize <= JACKPOT_LOG_SCAN_MIN_CHUNK) {
        throw err;
      }
      chunkSize = chunkSize / 2n;
    }
  }

  return collected;
}

async function fetchJackpotEventByEpoch(
  kind: "daily" | "weekly",
  epoch: number,
  context: FinalizedRecoveryContext,
  budget: JackpotRecoveryBudget,
): Promise<JackpotEventLookup> {
  if (!isSafePositiveInteger(epoch)) return null;
  const cacheKey = `${kind}:${epoch}:${context.blockNumber}:${context.blockHash}`;
  const now = Date.now();
  const cached = jackpotEventCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const topic0 = kind === "daily" ? dailySig : weeklySig;
  if (!topic0) return null;
  const epochTopic = toHex(BigInt(epoch), { size: 32 });
  const logs = await getLogsChunked({
    address: CONTRACT_ADDRESS,
    topics: [topic0, epochTopic],
    fromBlock: CONTRACT_DEPLOY_BLOCK,
    toBlock: context.blockNumber,
  } as const, budget);
  let recoveredEvent: JackpotRow | null = null;
  for (const log of logs) {
    const row = mapJackpotLog(log);
    if (row?.kind === kind && row.epoch === String(epoch)) {
      recoveredEvent = row;
    }
  }
  const value = !recoveredEvent
    ? null
    : {
        txHash: recoveredEvent.txHash,
        blockNumber: recoveredEvent.blockNumber,
        timestamp:
          parseStoredBlockNumber(recoveredEvent.blockNumber) > 0n
            ? await getBlockTimestampMs(parseStoredBlockNumber(recoveredEvent.blockNumber), budget)
            : null,
      };
  setJackpotEventCache(cacheKey, value);
  return value;
}

async function attachRecentBlockTimestamps(
  rows: JackpotRow[],
  budget?: JackpotRecoveryBudget,
): Promise<JackpotRow[]> {
  const recentRows = rows.slice(0, 20);
  const blockNumbers = [
    ...new Set(
      recentRows
        .map((row) => row.blockNumber)
        .filter((blockNumber) => parseStoredBlockNumber(blockNumber) > 0n),
    ),
  ];

  const timestampByBlock = new Map<string, number | null>();
  await Promise.all(
    blockNumbers.map(async (blockNumber) => {
      try {
        const timestamp = await getBlockTimestampMs(parseStoredBlockNumber(blockNumber), budget);
        timestampByBlock.set(blockNumber, timestamp);
      } catch {
        timestampByBlock.set(blockNumber, null);
      }
    }),
  );

  return rows.map((row, index) => {
    if (index >= 20) return row;
    return {
      ...row,
      timestamp: timestampByBlock.get(row.blockNumber) ?? null,
    };
  });
}

function normalizeStoredJackpots(): JackpotRow[] {
  const jackpots = (getRecentJackpots(JACKPOT_HISTORY_LIMIT) as JackpotRow[])
    .filter((row) => parseStoredBlockNumber(row.blockNumber) >= CONTRACT_DEPLOY_BLOCK)
    .map((row) => ({ ...row, txHash: normalizeJackpotTxHash(row.txHash) }));
  return sortJackpotsDesc(jackpots).slice(0, JACKPOT_HISTORY_LIMIT);
}

function shouldRecoverJackpots(
  storedJackpots: JackpotRow[],
  finalizedTargetBlock: bigint,
) {
  if (storedJackpots.length === 0) return true;
  const lastIndexedBlock = getMetaBigInt("lastIndexedBlock");
  if (!lastIndexedBlock || lastIndexedBlock < CONTRACT_DEPLOY_BLOCK) return true;
  return (
    finalizedTargetBlock > lastIndexedBlock &&
    finalizedTargetBlock - lastIndexedBlock >= JACKPOT_RECOVERY_BLOCK_LAG
  );
}

async function reconcileLatestJackpots(
  existingJackpots: JackpotRow[],
  context: FinalizedRecoveryContext,
  budget: JackpotRecoveryBudget,
): Promise<JackpotRow[]> {
  const jackpots = [...existingJackpots];
  const info = await runBudgetedJackpotRecoveryRpc(
    budget,
    () => publicClient.readContract({
      address: CONTRACT_ADDRESS,
      abi: READ_ABI,
      functionName: "getJackpotInfo",
      blockNumber: context.blockNumber,
    }),
  ) as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

  const lastDailyEpoch = parseChainUintEpochNumber(info[4]);
  const lastWeeklyEpoch = parseChainUintEpochNumber(info[5]);
  const formatAmount = (wei: bigint) => ({
    amount: formatUnits(wei, 18),
    amountNum: toDisplayNumberWei(wei),
  });

  const byKey = new Map<string, JackpotRow>();
  for (const row of jackpots) {
    byKey.set(`${row.kind}_${row.epoch}`, row);
  }

  if (lastDailyEpoch !== null) {
    const key = `daily_${lastDailyEpoch}`;
    if (!byKey.has(key)) {
      const dailyFormatted = formatAmount(info[6]);
      const onchain = await fetchJackpotEventByEpoch("daily", lastDailyEpoch, context, budget);
      const recovered: JackpotRow = {
        epoch: String(lastDailyEpoch),
        kind: "daily",
        amount: dailyFormatted.amount,
        amountNum: dailyFormatted.amountNum,
        txHash: normalizeJackpotTxHash(onchain?.txHash),
        blockNumber: onchain?.blockNumber ?? "0",
        timestamp: onchain?.timestamp ?? null,
      };
      byKey.set(key, recovered);
    }
  }

  if (lastWeeklyEpoch !== null) {
    const key = `weekly_${lastWeeklyEpoch}`;
    if (!byKey.has(key)) {
      const weeklyFormatted = formatAmount(info[7]);
      const onchain = await fetchJackpotEventByEpoch("weekly", lastWeeklyEpoch, context, budget);
      const recovered: JackpotRow = {
        epoch: String(lastWeeklyEpoch),
        kind: "weekly",
        amount: weeklyFormatted.amount,
        amountNum: weeklyFormatted.amountNum,
        txHash: normalizeJackpotTxHash(onchain?.txHash),
        blockNumber: onchain?.blockNumber ?? "0",
        timestamp: onchain?.timestamp ?? null,
      };
      byKey.set(key, recovered);
    }
  }

  if (!(await isRecoveryContextCurrent(context, budget))) {
    return existingJackpots;
  }

  const nextJackpots = await attachRecentBlockTimestamps(
    sortJackpotsDesc(Array.from(byKey.values())),
    budget,
  );
  return nextJackpots.slice(0, JACKPOT_HISTORY_LIMIT);
}

async function fetchOnchainJackpotDelta(
  existingJackpots: JackpotRow[],
  finalizedTargetBlock: bigint,
  budget: JackpotRecoveryBudget,
) {
  const highestStoredBlock = existingJackpots.reduce<bigint>((max, row) => {
    const value = parseStoredBlockNumber(row.blockNumber);
    return value > max ? value : max;
  }, 0n);

  if (highestStoredBlock >= finalizedTargetBlock) return [] as JackpotRow[];

  const fromBlock =
    highestStoredBlock > 0n && highestStoredBlock + 1n > CONTRACT_DEPLOY_BLOCK
      ? highestStoredBlock + 1n
      : CONTRACT_DEPLOY_BLOCK;
  const logs = await fetchJackpotLogsInRange(fromBlock, finalizedTargetBlock, budget);
  return logs
    .map((log) => mapJackpotLog(log))
    .filter((row): row is JackpotRow => row !== null);
}

async function buildOnchainJackpots(
  existingJackpots: JackpotRow[],
  context: FinalizedRecoveryContext,
  budget: JackpotRecoveryBudget,
) {
  const onchainRows =
    existingJackpots.length > 0
      ? await fetchOnchainJackpotDelta(existingJackpots, context.blockNumber, budget)
      : (await fetchRecentJackpotLogsFromChain(context.blockNumber, budget, JACKPOT_HISTORY_LIMIT))
          .map((log) => mapJackpotLog(log))
          .filter((row): row is JackpotRow => row !== null);

  if (!(await isRecoveryContextCurrent(context, budget))) {
    return existingJackpots;
  }
  const merged = mergeJackpotRows(existingJackpots, onchainRows);

  return merged;
}

function maybeStartJackpotRecovery(existingJackpots: JackpotRow[]) {
  const now = Date.now();
  if (jackpotBackgroundRecoveryPromise) return;
  if (now - jackpotBackgroundRecoveryStartedAt < JACKPOT_BACKGROUND_RECOVERY_COOLDOWN_MS) return;

  jackpotBackgroundRecoveryStartedAt = now;
  markRouteBackgroundRefresh(ROUTE_METRIC_KEY);
  const seq = ++jackpotBuildSeq;
  jackpotBackgroundRecoveryPromise = buildJackpotsPayload({
    allowSlowRecovery: true,
    scheduleBackgroundRecovery: false,
    seedJackpots: existingJackpots,
  })
    .then(({ payload }) => {
      commitJackpotResponseCache(payload, JACKPOT_ROUTE_CACHE_MS, seq);
    })
    .catch((err) => {
      logRouteError(ROUTE_METRIC_KEY, err, { phase: "background-recovery" });
    })
    .finally(() => {
      jackpotBackgroundRecoveryPromise = null;
    });
}

async function buildJackpotsPayload(
  options: {
    allowSlowRecovery?: boolean;
    scheduleBackgroundRecovery?: boolean;
    seedJackpots?: JackpotRow[];
  } = {},
): Promise<JackpotBuildResult> {
  const recoveryBudget = createJackpotRecoveryBudget();
  const storedJackpots = options.seedJackpots ?? normalizeStoredJackpots();
  const recoveryContext = await loadFinalizedRecoveryContext(recoveryBudget);
  const recoveryNeeded = recoveryContext !== null
    ? shouldRecoverJackpots(storedJackpots, recoveryContext.blockNumber)
    : false;
  const effectiveJackpots =
    recoveryNeeded && options.allowSlowRecovery && recoveryContext !== null
      ? await buildOnchainJackpots(storedJackpots, recoveryContext, recoveryBudget)
      : storedJackpots;

  if (recoveryNeeded && options.scheduleBackgroundRecovery !== false) {
    maybeStartJackpotRecovery(effectiveJackpots);
  }

  const reconciledJackpots =
    options.allowSlowRecovery && recoveryNeeded && recoveryContext !== null
      ? await reconcileLatestJackpots(effectiveJackpots, recoveryContext, recoveryBudget)
      : effectiveJackpots;

  return {
    payload: {
      jackpots: await attachRecentBlockTimestamps(
        reconciledJackpots.slice(0, JACKPOT_HISTORY_LIMIT),
        recoveryBudget,
      ),
    },
    recoveryNeeded,
  };
}

export async function readJackpotPayload(options: JackpotReadOptions = {}): Promise<JackpotReadResult> {
  const now = Date.now();
  if (!options.bypassResponseCache && jackpotResponseCache && jackpotResponseCache.expiresAt > now) {
    return { payload: jackpotResponseCache.payload, source: "cache" };
  }

  const seedJackpots = normalizeStoredJackpots();
  if (seedJackpots.length === 0) {
    const staleCache = jackpotResponseCache?.payload ?? null;
    if (staleCache) {
      maybeStartJackpotRecovery(staleCache.jackpots);
      return { payload: staleCache, source: "stale-cache" };
    }

    const seq = ++jackpotBuildSeq;
    const payload = commitJackpotResponseCache({ jackpots: [] }, JACKPOT_ROUTE_CACHE_MS, seq);
    maybeStartJackpotRecovery([]);
    return { payload, source: "rebuilt" };
  }

  if (options.bypassResponseCache) {
    const seq = ++jackpotBuildSeq;
    const payload = commitJackpotResponseCache(
      { jackpots: seedJackpots.slice(0, JACKPOT_HISTORY_LIMIT) },
      JACKPOT_ROUTE_CACHE_MS,
      seq,
    );
    maybeStartJackpotRecovery(seedJackpots);
    return { payload, source: "rebuilt" };
  }

  const staleCache = jackpotResponseCache?.payload ?? null;
  if (staleCache) {
    maybeStartJackpotRecovery(staleCache.jackpots);
    return { payload: staleCache, source: "stale-cache" };
  }

  const seq = ++jackpotBuildSeq;
  const payload = commitJackpotResponseCache(
    { jackpots: seedJackpots.slice(0, JACKPOT_HISTORY_LIMIT) },
    JACKPOT_ROUTE_CACHE_MS,
    seq,
  );
  maybeStartJackpotRecovery(seedJackpots);
  return { payload, source: "rebuilt" };
}
