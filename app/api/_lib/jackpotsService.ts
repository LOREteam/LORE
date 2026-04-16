import { decodeEventLog, encodeEventTopics, formatUnits, parseAbi, toHex } from "viem";
import { getMetaBigInt, getRecentJackpots } from "../../../server/storage";
import { CONTRACT_ADDRESS, CONTRACT_DEPLOY_BLOCK, patchStorage, publicClient } from "./dataBridge";
import { logRouteError } from "./routeError";
import { markRouteBackgroundRefresh } from "./runtimeMetrics";

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
const JACKPOT_HISTORY_LIMIT = 200;
const JACKPOT_BOOTSTRAP_SCAN_CHUNK = 500_000n;
const JACKPOT_RECOVERY_BLOCK_LAG = BigInt(process.env.JACKPOT_RECOVERY_BLOCK_LAG ?? "256");
const ROUTE_METRIC_KEY = "api/jackpots";

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
  source: "cache" | "stale-cache" | "inflight" | "rebuilt";
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
type JackpotStoredPatch = Record<string, JackpotRow>;
type JackpotBuildResult = { payload: JackpotPayload; recoveryNeeded: boolean };

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

function sortJackpotsDesc(rows: JackpotRow[]) {
  return [...rows].sort((a, b) => {
    const aBlock = BigInt(a.blockNumber || "0");
    const bBlock = BigInt(b.blockNumber || "0");
    if (aBlock === bBlock) {
      if (a.epoch === b.epoch) {
        if (a.kind === b.kind) return 0;
        return a.kind === "weekly" ? -1 : 1;
      }
      return Number(b.epoch) - Number(a.epoch);
    }
    return aBlock > bBlock ? -1 : 1;
  });
}

function mapJackpotLog(log: JackpotLog): JackpotRow | null {
  const topic0 = log.topics[0];
  if (!topic0) return null;

  try {
    const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
    if (decoded.eventName === "DailyJackpotAwarded") {
      const args = decoded.args as { epoch: bigint; amount: bigint };
      return {
        epoch: args.epoch.toString(),
        kind: "daily",
        amount: formatUnits(args.amount, 18),
        amountNum: parseFloat(formatUnits(args.amount, 18)),
        txHash: log.transactionHash ?? "",
        blockNumber: (log.blockNumber ?? 0n).toString(),
      };
    }

    if (decoded.eventName === "WeeklyJackpotAwarded") {
      const args = decoded.args as { epoch: bigint; amount: bigint };
      return {
        epoch: args.epoch.toString(),
        kind: "weekly",
        amount: formatUnits(args.amount, 18),
        amountNum: parseFloat(formatUnits(args.amount, 18)),
        txHash: log.transactionHash ?? "",
        blockNumber: (log.blockNumber ?? 0n).toString(),
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

async function getLogsChunked(request: JackpotLogsRequest) {
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

async function fetchJackpotLogsInRange(fromBlock: bigint, toBlock: bigint) {
  if (toBlock < fromBlock) return [] as JackpotLog[];
  return getLogsChunked({
    address: CONTRACT_ADDRESS,
    topics: [[dailySig, weeklySig]],
    fromBlock,
    toBlock,
  });
}

async function fetchRecentJackpotLogsFromChain(limit = JACKPOT_HISTORY_LIMIT) {
  const currentBlock = await publicClient.getBlockNumber();
  const collected: JackpotLog[] = [];
  let toBlock = currentBlock;
  let chunkSize = JACKPOT_BOOTSTRAP_SCAN_CHUNK;

  while (toBlock >= CONTRACT_DEPLOY_BLOCK && collected.length < limit) {
    const fromBlock =
      toBlock - chunkSize + 1n > CONTRACT_DEPLOY_BLOCK
        ? toBlock - chunkSize + 1n
        : CONTRACT_DEPLOY_BLOCK;

    try {
      const logs = await publicClient.getLogs({
        address: CONTRACT_ADDRESS,
        topics: [[dailySig, weeklySig]],
        fromBlock,
        toBlock,
      } as Parameters<typeof publicClient.getLogs>[0]);
      collected.push(...logs);
      if (fromBlock === CONTRACT_DEPLOY_BLOCK) break;
      toBlock = fromBlock - 1n;
    } catch (err) {
      if (!isTooManyResultsError(err) || chunkSize <= JACKPOT_LOG_SCAN_MIN_CHUNK) {
        throw err;
      }
      chunkSize = chunkSize / 2n;
    }
  }

  return collected;
}

async function fetchJackpotEventByEpoch(kind: "daily" | "weekly", epoch: number): Promise<JackpotEventLookup> {
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
  const logs = await getLogsChunked({
    address: CONTRACT_ADDRESS,
    topics: [topic0, epochTopic],
    fromBlock: CONTRACT_DEPLOY_BLOCK,
    toBlock: currentBlock,
  } as const);
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
  const blockNumbers = [
    ...new Set(
      recentRows
        .map((row) => row.blockNumber)
        .filter((blockNumber) => {
          try {
            return BigInt(blockNumber) > 0n;
          } catch {
            return false;
          }
        }),
    ),
  ];

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
  const jackpots = (getRecentJackpots(JACKPOT_HISTORY_LIMIT) as JackpotRow[]).filter((row) => {
    try {
      return BigInt(row.blockNumber ?? "0") >= CONTRACT_DEPLOY_BLOCK;
    } catch {
      return false;
    }
  });
  return sortJackpotsDesc(jackpots).slice(0, JACKPOT_HISTORY_LIMIT);
}

async function shouldRecoverJackpots(storedJackpots: JackpotRow[]) {
  if (storedJackpots.length === 0) return true;
  const lastIndexedBlock = getMetaBigInt("lastIndexedBlock");
  if (!lastIndexedBlock || lastIndexedBlock < CONTRACT_DEPLOY_BLOCK) return true;
  const headBlock = await publicClient.getBlockNumber();
  return headBlock > lastIndexedBlock && headBlock - lastIndexedBlock >= JACKPOT_RECOVERY_BLOCK_LAG;
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
  const formatAmount = (wei: bigint) => ({
    amount: formatUnits(wei, 18),
    amountNum: parseFloat(formatUnits(wei, 18)),
  });

  const byKey = new Map<string, JackpotRow>();
  const recoveredRows: JackpotStoredPatch = {};
  for (const row of jackpots) {
    byKey.set(`${row.kind}_${row.epoch}`, row);
  }

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
    await patchStorage("gamedata/jackpots", recoveredRows);
  }

  const nextJackpots = await attachRecentBlockTimestamps(sortJackpotsDesc(Array.from(byKey.values())));
  return nextJackpots.slice(0, JACKPOT_HISTORY_LIMIT);
}

async function fetchOnchainJackpotDelta(existingJackpots: JackpotRow[]) {
  const highestStoredBlock = existingJackpots.reduce<bigint>((max, row) => {
    try {
      const value = BigInt(row.blockNumber ?? "0");
      return value > max ? value : max;
    } catch {
      return max;
    }
  }, 0n);

  const currentBlock = await publicClient.getBlockNumber();
  if (highestStoredBlock >= currentBlock) return [] as JackpotRow[];

  const fromBlock =
    highestStoredBlock > 0n && highestStoredBlock + 1n > CONTRACT_DEPLOY_BLOCK
      ? highestStoredBlock + 1n
      : CONTRACT_DEPLOY_BLOCK;
  const logs = await fetchJackpotLogsInRange(fromBlock, currentBlock);
  return logs
    .map((log) => mapJackpotLog(log))
    .filter((row): row is JackpotRow => row !== null);
}

async function buildOnchainJackpots(existingJackpots: JackpotRow[]) {
  const onchainRows =
    existingJackpots.length > 0
      ? await fetchOnchainJackpotDelta(existingJackpots)
      : (await fetchRecentJackpotLogsFromChain(JACKPOT_HISTORY_LIMIT))
          .map((log) => mapJackpotLog(log))
          .filter((row): row is JackpotRow => row !== null);

  const merged = mergeJackpotRows(existingJackpots, onchainRows);

  if (onchainRows.length > 0) {
    const patch = onchainRows.reduce<JackpotStoredPatch>((acc, row) => {
      acc[`${row.kind}_${row.epoch}`] = row;
      return acc;
    }, {});
    await patchStorage("gamedata/jackpots", patch);
  }

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
  const storedJackpots = options.seedJackpots ?? normalizeStoredJackpots();
  const recoveryNeeded = await shouldRecoverJackpots(storedJackpots);
  const effectiveJackpots =
    recoveryNeeded && options.allowSlowRecovery
      ? await buildOnchainJackpots(storedJackpots)
      : storedJackpots;

  if (recoveryNeeded && options.scheduleBackgroundRecovery !== false) {
    maybeStartJackpotRecovery(effectiveJackpots);
  }

  const reconciledJackpots =
    options.allowSlowRecovery && recoveryNeeded
      ? await reconcileLatestJackpots(effectiveJackpots)
      : effectiveJackpots;

  return {
    payload: {
      jackpots: await attachRecentBlockTimestamps(reconciledJackpots.slice(0, JACKPOT_HISTORY_LIMIT)),
    },
    recoveryNeeded,
  };
}

export async function readJackpotPayload(): Promise<JackpotReadResult> {
  const now = Date.now();
  if (jackpotResponseCache && jackpotResponseCache.expiresAt > now) {
    return { payload: jackpotResponseCache.payload, source: "cache" };
  }

  const staleCache = jackpotResponseCache?.payload ?? null;
  if (staleCache) {
    maybeStartJackpotRecovery(staleCache.jackpots);
    return { payload: staleCache, source: "stale-cache" };
  }

  if (jackpotResponseInflight) {
    return { payload: await jackpotResponseInflight, source: "inflight" };
  }

  const seq = ++jackpotBuildSeq;
  const seedJackpots = normalizeStoredJackpots();
  if (seedJackpots.length > 0) {
    const payload = commitJackpotResponseCache(
      { jackpots: seedJackpots.slice(0, JACKPOT_HISTORY_LIMIT) },
      JACKPOT_ROUTE_CACHE_MS,
      seq,
    );
    maybeStartJackpotRecovery(seedJackpots);
    return { payload, source: "rebuilt" };
  }

  jackpotResponseInflight = buildJackpotsPayload({
    allowSlowRecovery: true,
    seedJackpots,
  })
    .then(({ payload }) => {
      return commitJackpotResponseCache(payload, JACKPOT_ROUTE_CACHE_MS, seq);
    })
    .finally(() => {
      jackpotResponseInflight = null;
    });

  return { payload: await jackpotResponseInflight, source: "rebuilt" };
}
