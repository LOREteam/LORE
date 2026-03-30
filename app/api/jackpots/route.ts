import { NextResponse } from "next/server";
import { encodeEventTopics, parseAbi, toHex, formatUnits } from "viem";
import { applyNoStoreHeaders } from "../_lib/responseHeaders";
import {
  beginRouteMetric,
  failRouteMetric,
  finishRouteMetric,
  markRouteBackgroundRefresh,
  markRouteCacheHit,
  markRouteInflightJoin,
  markRouteStaleServed,
} from "../_lib/runtimeMetrics";
import { getMetaNumber, getRecentJackpots } from "../../../server/storage";
import {
  CONTRACT_ADDRESS,
  CONTRACT_DEPLOY_BLOCK,
  filterByCurrentEpoch,
  patchFirebase,
  publicClient,
} from "../_lib/dataBridge";
import { logRouteError } from "../_lib/routeError";
import { enforceSharedRateLimit } from "../_lib/sharedRateLimit";

const READ_ABI = parseAbi([
  "function getJackpotInfo() view returns (uint256 dailyPool, uint256 weeklyPool, uint256 lastDailyDay, uint256 lastWeeklyWeek, uint256 lastDailyEpoch, uint256 lastWeeklyEpoch, uint256 lastDailyAmount, uint256 lastWeeklyAmount)",
]);
const EVENTS_ABI = parseAbi([
  "event DailyJackpotAwarded(uint256 indexed epoch, uint256 amount)",
  "event WeeklyJackpotAwarded(uint256 indexed epoch, uint256 amount)",
]);
const [dailySig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "DailyJackpotAwarded" });
const [weeklySig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "WeeklyJackpotAwarded" });
const JACKPOT_LOG_SCAN_CHUNK = 50_000n;
const JACKPOT_LOG_SCAN_MIN_CHUNK = 2_000n;
const JACKPOT_ROUTE_CACHE_MS = 60_000;
const JACKPOT_EVENT_CACHE_MS = 5 * 60 * 1000;
const JACKPOT_BACKGROUND_RECOVERY_COOLDOWN_MS = 2 * 60 * 1000;
const MAX_JACKPOT_EVENT_CACHE_ENTRIES = 256;
const ROUTE_METRIC_KEY = "api/jackpots";

type JackpotRow = {
  epoch: string;
  kind: "daily" | "weekly";
  amount: string;
  amountNum: number;
  txHash: string;
  blockNumber: string;
  timestamp?: number | null;
};

type JackpotEventLookup = { txHash: string; blockNumber: string; timestamp: number | null } | null;
type JackpotPayload = { jackpots: JackpotRow[]; error?: string };
type JackpotCacheEntry = { payload: JackpotPayload; expiresAt: number };
type JackpotEventCacheEntry = { value: JackpotEventLookup; expiresAt: number };
type JackpotBlockTimestampCacheEntry = { value: number | null; expiresAt: number };

let jackpotResponseCache: JackpotCacheEntry | null = null;
let jackpotResponseInflight: Promise<JackpotPayload> | null = null;
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
    message.includes("request exceeds defined limit")
  );
}

async function getBlockTimestampMs(blockNumber: bigint): Promise<number | null> {
  if (blockNumber <= 0n) return null;
  const cacheKey = blockNumber.toString();
  const now = Date.now();
  const cached = jackpotBlockTimestampCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const block = await publicClient.getBlock({ blockNumber });
  const value = Number(block.timestamp) * 1000;
  jackpotBlockTimestampCache.set(cacheKey, {
    value,
    expiresAt: now + JACKPOT_EVENT_CACHE_MS,
  });
  return value;
}

async function getLogsChunked(
  request: Omit<Parameters<typeof publicClient.getLogs>[0], "fromBlock" | "toBlock"> & {
    fromBlock: bigint;
    toBlock: bigint;
  },
) {
  const all: Awaited<ReturnType<typeof publicClient.getLogs>> = [];
  let cursor = request.fromBlock;
  let chunkSize = JACKPOT_LOG_SCAN_CHUNK;

  while (cursor <= request.toBlock) {
    const chunkTo =
      cursor + chunkSize - 1n > request.toBlock
        ? request.toBlock
        : cursor + chunkSize - 1n;

    try {
      const logs = await publicClient.getLogs({
        ...request,
        fromBlock: cursor,
        toBlock: chunkTo,
      } as Parameters<typeof publicClient.getLogs>[0]);
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

async function fetchJackpotEventByEpoch(
  kind: "daily" | "weekly",
  epoch: number,
): Promise<{ txHash: string; blockNumber: string; timestamp: number | null } | null> {
  if (!Number.isInteger(epoch) || epoch <= 0) return null;
  const cacheKey = `${kind}:${epoch}`;
  const now = Date.now();
  const cached = jackpotEventCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  const topic0 = kind === "daily" ? dailySig : weeklySig;
  if (!topic0) return null;
  const epochTopic = toHex(BigInt(epoch), { size: 32 });
  const currentBlock = await publicClient.getBlockNumber();
  const logsRequest = {
    address: CONTRACT_ADDRESS,
    topics: [topic0, epochTopic],
    fromBlock: CONTRACT_DEPLOY_BLOCK,
    toBlock: currentBlock,
  } as const;
  const logs = await getLogsChunked(logsRequest);
  const log = logs[logs.length - 1];
  const value = !log
    ? null
    : {
    txHash: log.transactionHash ?? "",
    blockNumber: (log.blockNumber ?? 0n).toString(),
    timestamp:
      log.blockNumber && log.blockNumber > 0n
        ? await getBlockTimestampMs(log.blockNumber)
        : null,
    };
  setJackpotEventCache(cacheKey, value);
  return value;
}

async function attachRecentBlockTimestamps(rows: JackpotRow[]): Promise<JackpotRow[]> {
  const recentRows = rows.slice(0, 20);
  const blockNumbers = [...new Set(
    recentRows
      .map((row) => row.blockNumber)
      .filter((blockNumber) => {
        try {
          return BigInt(blockNumber) > 0n;
        } catch {
          return false;
        }
      }),
  )];

  const timestampByBlock = new Map<string, number | null>();
  await Promise.all(
    blockNumbers.map(async (blockNumber) => {
      try {
        const timestamp = await getBlockTimestampMs(BigInt(blockNumber));
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
  let jackpots = getRecentJackpots(200) as JackpotRow[];
  const currentEpoch = getMetaNumber("currentEpoch");
  jackpots = filterByCurrentEpoch(jackpots, currentEpoch);
  jackpots = jackpots.filter((j) => {
    const blockNumber = Number(j.blockNumber ?? "0");
    if (blockNumber > 0 && BigInt(blockNumber) < CONTRACT_DEPLOY_BLOCK) return false;
      return true;
  });
  return jackpots.slice(0, 200);
}

async function reconcileLatestJackpots(existingJackpots: JackpotRow[]): Promise<JackpotRow[]> {
  const jackpots = [...existingJackpots];
  const info = await publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi: READ_ABI,
    functionName: "getJackpotInfo",
  }) as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

  const lastDailyEpoch = Number(info[4]);
  const lastWeeklyEpoch = Number(info[5]);
  const formatAmount = (wei: bigint): { amount: string; amountNum: number } => ({
    amount: formatUnits(wei, 18),
    amountNum: parseFloat(formatUnits(wei, 18)),
  });

  const byKey = new Map<string, JackpotRow>();
  const recoveredRows: Record<string, JackpotRow> = {};
  for (const j of jackpots) byKey.set(`${j.kind}_${j.epoch}`, j);

  if (Number.isInteger(lastDailyEpoch) && lastDailyEpoch > 0) {
    const key = `daily_${lastDailyEpoch}`;
    if (!byKey.has(key)) {
      const dailyFormatted = formatAmount(info[6]);
      const onchain = await fetchJackpotEventByEpoch("daily", lastDailyEpoch);
      const recovered: JackpotRow = {
        epoch: String(lastDailyEpoch),
        kind: "daily",
        amount: dailyFormatted.amount,
        amountNum: dailyFormatted.amountNum,
        txHash: onchain?.txHash ?? "",
        blockNumber: onchain?.blockNumber ?? "0",
        timestamp: onchain?.timestamp ?? null,
      };
      byKey.set(key, recovered);
      recoveredRows[key] = recovered;
    }
  }

  if (Number.isInteger(lastWeeklyEpoch) && lastWeeklyEpoch > 0) {
    const key = `weekly_${lastWeeklyEpoch}`;
    if (!byKey.has(key)) {
      const weeklyFormatted = formatAmount(info[7]);
      const onchain = await fetchJackpotEventByEpoch("weekly", lastWeeklyEpoch);
      const recovered: JackpotRow = {
        epoch: String(lastWeeklyEpoch),
        kind: "weekly",
        amount: weeklyFormatted.amount,
        amountNum: weeklyFormatted.amountNum,
        txHash: onchain?.txHash ?? "",
        blockNumber: onchain?.blockNumber ?? "0",
        timestamp: onchain?.timestamp ?? null,
      };
      byKey.set(key, recovered);
      recoveredRows[key] = recovered;
    }
  }

  if (Object.keys(recoveredRows).length > 0) {
    await patchFirebase("gamedata/jackpots", recoveredRows);
  }

  const nextJackpots = await attachRecentBlockTimestamps(Array.from(byKey.values()));
  nextJackpots.sort((a, b) => Number(b.blockNumber) - Number(a.blockNumber));
  return nextJackpots.slice(0, 200);
}

function maybeStartJackpotRecovery(existingJackpots: JackpotRow[]) {
  const now = Date.now();
  if (jackpotBackgroundRecoveryPromise) return;
  if (now - jackpotBackgroundRecoveryStartedAt < JACKPOT_BACKGROUND_RECOVERY_COOLDOWN_MS) return;

  jackpotBackgroundRecoveryStartedAt = now;
  markRouteBackgroundRefresh(ROUTE_METRIC_KEY);
  const seq = ++jackpotBuildSeq;
  jackpotBackgroundRecoveryPromise = reconcileLatestJackpots(existingJackpots)
    .then((jackpots) => {
      commitJackpotResponseCache({ jackpots }, JACKPOT_ROUTE_CACHE_MS, seq);
    })
    .catch((err) => {
      logRouteError(ROUTE_METRIC_KEY, err, { phase: "background-recovery" });
    })
    .finally(() => {
      jackpotBackgroundRecoveryPromise = null;
    });
}

async function buildJackpotsPayload(): Promise<JackpotPayload> {
  const jackpots = normalizeStoredJackpots();
  maybeStartJackpotRecovery(jackpots);
  jackpots.sort((a, b) => Number(b.blockNumber) - Number(a.blockNumber));
  return { jackpots: await attachRecentBlockTimestamps(jackpots.slice(0, 200)) };
}

function jsonNoStore(payload: JackpotPayload, status = 200) {
  return applyNoStoreHeaders(NextResponse.json(payload, { status }));
}

export async function GET(request: Request) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-jackpots",
    limit: 30,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const metric = beginRouteMetric(ROUTE_METRIC_KEY);
  const now = Date.now();
  if (jackpotResponseCache && jackpotResponseCache.expiresAt > now) {
    markRouteCacheHit(ROUTE_METRIC_KEY);
    finishRouteMetric(metric, 200);
    return jsonNoStore(jackpotResponseCache.payload);
  }

  const staleCache = jackpotResponseCache?.payload ?? null;
  if (staleCache) {
    markRouteStaleServed(ROUTE_METRIC_KEY);
    maybeStartJackpotRecovery(staleCache.jackpots);
    finishRouteMetric(metric, 200);
    return jsonNoStore(staleCache);
  }

  try {
    const payload = jackpotResponseInflight
      ? (markRouteInflightJoin(ROUTE_METRIC_KEY), await jackpotResponseInflight)
      : await (() => {
          const seq = ++jackpotBuildSeq;
          jackpotResponseInflight = buildJackpotsPayload()
            .then((result) => {
              return commitJackpotResponseCache(result, JACKPOT_ROUTE_CACHE_MS, seq);
            })
            .finally(() => {
              jackpotResponseInflight = null;
            });
          return jackpotResponseInflight;
        })();

    finishRouteMetric(metric, 200);
    return jsonNoStore(payload);
  } catch (err) {
    logRouteError(ROUTE_METRIC_KEY, err);
    if (staleCache) {
      markRouteStaleServed(ROUTE_METRIC_KEY);
      finishRouteMetric(metric, 200);
      return jsonNoStore(staleCache);
    }
    const message = err instanceof Error ? err.message : "fetch failed";
    const status = message.startsWith("Firebase ") ? 502 : 500;
    failRouteMetric(metric, status);
    return jsonNoStore({ jackpots: [], error: message }, status);
  }
}
