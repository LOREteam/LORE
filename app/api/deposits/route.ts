import { NextRequest, NextResponse } from "next/server";
import { decodeEventLog, encodeEventTopics, formatUnits, getAddress } from "viem";
import {
  GAME_ABI as CURRENT_EPOCH_ABI,
  GAME_EVENTS_ABI as EVENTS_ABI,
} from "../../../config/generated/lineaOreV10Abi";
import { applyNoStoreHeaders } from "../_lib/responseHeaders";
import { getIndexerFinalityTargetBlock, parseIndexerFinalityBlocks } from "../../lib/indexerFinality";
import { tileMaskToTileIds } from "../../lib/tileMask";
import { formatLineaWeiDisplayNumber, normalizeTileAmounts, parseLineaAmountWei } from "../../lib/tokenAmountMath";
import {
  beginRouteMetric,
  failRouteMetric,
  finishRouteMetric,
  markRouteCacheHit,
  markRouteInflightJoin,
  markRouteStaleServed,
} from "../_lib/runtimeMetrics";
import { loadRewardMapsForUserEpochs } from "../_lib/rewardSummary";
import { getMetaBigInt, getMetaNumber, getUserBetsMap } from "../../../server/storage";
import {
  CONTRACT_ADDRESS,
  CONTRACT_DEPLOY_BLOCK,
  filterByCurrentEpoch,
  isSafePositiveInteger,
  patchStorage,
  publicClient,
} from "../_lib/dataBridge";
import {
  parseStoredBlockNumberOrZero,
  parseStoredPositiveIntegerOrZero,
} from "../_lib/storedNumberParsing";
import { logRouteError } from "../_lib/routeError";
import { enforceSharedRateLimit } from "../_lib/sharedRateLimit";
import { createRouteCache } from "../_lib/routeCache";
import { startVersionedBackgroundRefresh, startVersionedInflightBuild } from "../_lib/versionedRouteCache";

const LOG_CHUNK_BLOCKS = 10_000n;
const ENABLE_CHAIN_RECOVERY = process.env.API_DEPOSITS_CHAIN_RECOVERY === "1";
const INDEXER_FINALITY_BLOCKS = parseIndexerFinalityBlocks(process.env.INDEXER_FINALITY_BLOCKS);
const ENABLE_FINALIZED_CHAIN_RECOVERY = ENABLE_CHAIN_RECOVERY && INDEXER_FINALITY_BLOCKS > 0n;
const DEPOSITS_ROUTE_CACHE_MS = 15_000;
const DEPOSITS_ROUTE_CACHE_MAX_KEYS = 512;
const ROUTE_METRIC_KEY = "api/deposits";
const DEPOSIT_RECOVERY_EPOCH_LAG = 8;
const RECENT_RECOVERY_BLOCK_WINDOW = 100_000n;
const DEPOSITS_BACKGROUND_RECOVERY_COOLDOWN_MS = 15_000;
const CURRENT_EPOCH_CACHE_MS = 60_000;
const INLINE_REWARD_EPOCH_LIMIT = 64;
const MAX_TILE_ID = 25;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const depositsBuildInflight = new Map<string, Promise<DepositsBuildResult>>();
const [betSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "BetPlaced" });
const [batchSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "BatchBetsPlaced" });
const [batchSameAmountSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "BatchBetsSameAmountPlaced" });
const [batchBitmapSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "BatchBetsBitmapPlaced" });

type DepositRow = {
  epoch: string;
  tileIds: number[];
  totalAmount: string;
  totalAmountNum: number;
  txHash: string;
  blockNumber: string;
  amounts?: string[];
};

type EpochInfoRow = {
  winningTile: number;
  rewardPool: string;
};

type RewardInfoRow = {
  reward: string;
  winningTile: number;
  rewardPool: string;
  winningTilePool: string;
  userWinningAmount: string;
};

type DepositsPayload = {
  deposits: DepositRow[];
  epochs?: Record<string, EpochInfoRow>;
  rewards?: Record<string, RewardInfoRow>;
  error?: string;
};

type DepositsBuildOptions = {
  allowSlowRecovery?: boolean;
};

type DepositsBuildResult = {
  payload: DepositsPayload;
  recoveryNeeded: boolean;
};

const depositsRouteCache = createRouteCache<DepositsPayload>(DEPOSITS_ROUTE_CACHE_MAX_KEYS);
const depositsCacheWatermarks = createRouteCache<string>(DEPOSITS_ROUTE_CACHE_MAX_KEYS);
let currentEpochCache: { value: number | null; expiresAt: number; source: "indexed" | "chain" } | null = null;
let currentEpochInflight: Promise<number | null> | null = null;
let currentEpochBackgroundRefresh: Promise<void> | null = null;
let depositsRecoveryInflight: Promise<DepositRow[]> | null = null;
let depositsRecoveryStartedAt = 0;

function getDepositsDataWatermark() {
  const currentEpoch = getMetaNumber("currentEpoch");
  const lastIndexedBlock = getMetaBigInt("lastIndexedBlock")?.toString() ?? "null";
  return `${Number.isInteger(currentEpoch) ? String(currentEpoch) : "null"}|${lastIndexedBlock}`;
}

function buildDepositKey(epoch: string, txHash: string, blockNumber: string): string {
  const normalizedHash = txHash.toLowerCase().trim();
  if (/^0x[0-9a-f]{64}$/.test(normalizedHash)) {
    return `${epoch}_${normalizedHash}`;
  }
  return `${epoch}_nohash_${blockNumber}`;
}

function normalizeDepositTxHash(txHash: string | null | undefined): `0x${string}` | "" {
  const normalized = String(txHash ?? "").toLowerCase().trim();
  return /^0x[0-9a-f]{64}$/.test(normalized) ? (normalized as `0x${string}`) : "";
}

function parseStoredBlockNumber(value: string | null | undefined): bigint {
  return parseStoredBlockNumberOrZero(value);
}

function parseStoredEpochNumber(value: string | null | undefined): number {
  return parseStoredPositiveIntegerOrZero(value);
}

function parseChainEpochNumber(value: bigint): number | null {
  if (value <= 0n || value > MAX_SAFE_INTEGER_BIGINT) return null;
  const parsed = Number(value);
  return isSafePositiveInteger(parsed) ? parsed : null;
}

function parseDepositTileId(value: bigint): number | null {
  if (value <= 0n || value > BigInt(MAX_TILE_ID)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= MAX_TILE_ID ? parsed : null;
}

function parseDepositTileIds(values: readonly bigint[]): number[] | null {
  if (values.length === 0) return null;
  const tileIds: number[] = [];
  for (const value of values) {
    const tileId = parseDepositTileId(value);
    if (tileId === null) return null;
    tileIds.push(tileId);
  }
  return tileIds;
}

function toDisplayNumberWei(value: bigint): number {
  return formatLineaWeiDisplayNumber(value);
}

function dedupeDeposits(rows: DepositRow[]): DepositRow[] {
  const byKey = new Map<string, DepositRow>();
  for (const row of rows) {
    const key = buildDepositKey(row.epoch, row.txHash ?? "", row.blockNumber ?? "0");
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, row);
      continue;
    }
    const prevBlock = parseStoredBlockNumber(prev.blockNumber);
    const nextBlock = parseStoredBlockNumber(row.blockNumber);
    if (nextBlock >= prevBlock) {
      byKey.set(key, row);
    }
  }
  return Array.from(byKey.values());
}

function addressToTopic(address: string): `0x${string}` {
  return `0x${getAddress(address).toLowerCase().slice(2).padStart(64, "0")}` as `0x${string}`;
}

function normalizeDepositRow(row: DepositRow): DepositRow {
  const tileIds = Array.isArray(row.tileIds) ? row.tileIds : [];
  const txHash = normalizeDepositTxHash(row.txHash);
  if (tileIds.length === 0) {
    return { ...row, txHash, tileIds: [], amounts: [] };
  }

  const normalized = normalizeTileAmounts(tileIds, row.amounts, row.totalAmount);
  const mergedTileIds = normalized.tileIds;
  if (mergedTileIds.length === tileIds.length) {
    return {
      ...row,
      txHash,
      amounts: normalized.amounts,
    };
  }

  return {
    ...row,
    txHash,
    tileIds: mergedTileIds,
    amounts: normalized.amounts,
  };
}

function hasDepositTiles(row: DepositRow): boolean {
  return row.tileIds.length > 0;
}

function sortDepositsDesc<T extends { epoch: string; blockNumber: string; txHash: string }>(rows: T[]) {
  return [...rows].sort((a, b) => {
    const aBlock = parseStoredBlockNumber(a.blockNumber);
    const bBlock = parseStoredBlockNumber(b.blockNumber);
    if (aBlock === bBlock) {
      const epochDelta = parseStoredEpochNumber(b.epoch) - parseStoredEpochNumber(a.epoch);
      if (epochDelta !== 0) return epochDelta;
      return (b.txHash ?? "").localeCompare(a.txHash ?? "");
    }
    return aBlock > bBlock ? -1 : 1;
  });
}

async function getLogsByTopicAndUser(
  topic0: `0x${string}`,
  userTopic: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint,
) {
  const all: Awaited<ReturnType<typeof publicClient.getLogs>> = [];
  const startBlock = fromBlock > CONTRACT_DEPLOY_BLOCK ? fromBlock : CONTRACT_DEPLOY_BLOCK;
  if (startBlock > toBlock) return all;
  for (let from = startBlock; from <= toBlock; from += LOG_CHUNK_BLOCKS) {
    const to = from + LOG_CHUNK_BLOCKS - 1n > toBlock ? toBlock : from + LOG_CHUNK_BLOCKS - 1n;
    const logsRequest = {
      address: CONTRACT_ADDRESS,
      topics: [topic0, null, userTopic],
      fromBlock: from,
      toBlock: to,
    } as unknown as Parameters<typeof publicClient.getLogs>[0];
    const logs = await publicClient.getLogs(logsRequest);
    all.push(...logs);
  }
  return all;
}

async function fetchDepositsFromChain(
  user: string,
  currentEpoch: number | null,
  fromBlock: bigint,
  toBlock: bigint,
) {
  const userTopic = addressToTopic(user);
  const betLogs = betSig ? await getLogsByTopicAndUser(betSig, userTopic, fromBlock, toBlock) : [];
  const batchLogs = batchSig ? await getLogsByTopicAndUser(batchSig, userTopic, fromBlock, toBlock) : [];
  const batchSameAmountLogs = batchSameAmountSig
    ? await getLogsByTopicAndUser(batchSameAmountSig, userTopic, fromBlock, toBlock)
    : [];
  const batchBitmapLogs = batchBitmapSig
    ? await getLogsByTopicAndUser(batchBitmapSig, userTopic, fromBlock, toBlock)
    : [];
  const byKey = new Map<string, DepositRow>();
  const all = [...betLogs, ...batchLogs, ...batchSameAmountLogs, ...batchBitmapLogs];
  all.sort((a, b) => {
    const aBlock = a.blockNumber ?? 0n;
    const bBlock = b.blockNumber ?? 0n;
    return aBlock < bBlock ? -1 : aBlock > bBlock ? 1 : 0;
  });

  for (const log of all) {
    const topic0 = log.topics[0];
    if (!topic0) continue;
    try {
      if (topic0 === betSig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "BetPlaced") continue;
        const args = decoded.args as { epoch: bigint; tileId: bigint; amount: bigint };
        const ep = parseChainEpochNumber(args.epoch);
        if (ep === null || (currentEpoch && ep > currentEpoch)) continue;
        const tileId = parseDepositTileId(args.tileId);
        if (tileId === null) continue;
        const txHash = normalizeDepositTxHash(log.transactionHash);
        const key = buildDepositKey(
          args.epoch.toString(),
          txHash,
          (log.blockNumber ?? 0n).toString(),
        );
        const amount = formatUnits(args.amount, 18);
        const prev = byKey.get(key);
        if (prev) {
          prev.tileIds.push(tileId);
          const totalWei = parseLineaAmountWei(prev.totalAmount) + args.amount;
          prev.totalAmount = formatUnits(totalWei, 18);
          prev.totalAmountNum = toDisplayNumberWei(totalWei);
          prev.amounts = [...(prev.amounts ?? []), amount];
        } else {
          byKey.set(key, {
            epoch: args.epoch.toString(),
            tileIds: [tileId],
            amounts: [amount],
            totalAmount: amount,
            totalAmountNum: toDisplayNumberWei(args.amount),
            txHash,
            blockNumber: (log.blockNumber ?? 0n).toString(),
          });
        }
      } else if (topic0 === batchSig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "BatchBetsPlaced") continue;
        const args = decoded.args as { epoch: bigint; tileIds: readonly bigint[]; amounts: readonly bigint[]; totalAmount: bigint };
        const ep = parseChainEpochNumber(args.epoch);
        if (ep === null || (currentEpoch && ep > currentEpoch)) continue;
        const tileIds = parseDepositTileIds(args.tileIds);
        if (tileIds === null || args.amounts.length !== tileIds.length) continue;
        const txHash = normalizeDepositTxHash(log.transactionHash);
        const key = buildDepositKey(
          args.epoch.toString(),
          txHash,
          (log.blockNumber ?? 0n).toString(),
        );
        byKey.set(key, {
          epoch: args.epoch.toString(),
          tileIds,
          amounts: args.amounts.map((a) => formatUnits(a, 18)),
          totalAmount: formatUnits(args.totalAmount, 18),
          totalAmountNum: toDisplayNumberWei(args.totalAmount),
          txHash,
          blockNumber: (log.blockNumber ?? 0n).toString(),
        });
      } else if (topic0 === batchSameAmountSig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "BatchBetsSameAmountPlaced") continue;
        const args = decoded.args as { epoch: bigint; tileIds: readonly bigint[]; amount: bigint; totalAmount: bigint };
        const ep = parseChainEpochNumber(args.epoch);
        if (ep === null || (currentEpoch && ep > currentEpoch)) continue;
        const tileIds = parseDepositTileIds(args.tileIds);
        if (tileIds === null) continue;
        const amount = formatUnits(args.amount, 18);
        const txHash = normalizeDepositTxHash(log.transactionHash);
        const key = buildDepositKey(
          args.epoch.toString(),
          txHash,
          (log.blockNumber ?? 0n).toString(),
        );
        byKey.set(key, {
          epoch: args.epoch.toString(),
          tileIds,
          amounts: tileIds.map(() => amount),
          totalAmount: formatUnits(args.totalAmount, 18),
          totalAmountNum: toDisplayNumberWei(args.totalAmount),
          txHash,
          blockNumber: (log.blockNumber ?? 0n).toString(),
        });
      } else if (topic0 === batchBitmapSig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "BatchBetsBitmapPlaced") continue;
        const args = decoded.args as { epoch: bigint; tileMask: number; amount: bigint; totalAmount: bigint };
        const ep = parseChainEpochNumber(args.epoch);
        if (ep === null || (currentEpoch && ep > currentEpoch)) continue;
        const tileIds = tileMaskToTileIds(args.tileMask);
        const amount = formatUnits(args.amount, 18);
        const txHash = normalizeDepositTxHash(log.transactionHash);
        const key = buildDepositKey(
          args.epoch.toString(),
          txHash,
          (log.blockNumber ?? 0n).toString(),
        );
        byKey.set(key, {
          epoch: args.epoch.toString(),
          tileIds,
          amounts: tileIds.map(() => amount),
          totalAmount: formatUnits(args.totalAmount, 18),
          totalAmountNum: toDisplayNumberWei(args.totalAmount),
          txHash,
          blockNumber: (log.blockNumber ?? 0n).toString(),
        });
      }
    } catch {
      // malformed log
    }
  }

  return sortDepositsDesc(Array.from(byKey.values())).slice(0, 5000);
}

function isValidEpochNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && isSafePositiveInteger(value);
}

async function readCurrentEpochFromChain(fallback: number | null) {
  if (currentEpochInflight) {
    return currentEpochInflight;
  }

  currentEpochInflight = (async () => {
    try {
      const onChainCurrentEpoch = await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: CURRENT_EPOCH_ABI,
        functionName: "currentEpoch",
      });
      const onChainCurrentEpochNum = parseChainEpochNumber(onChainCurrentEpoch);
      if (onChainCurrentEpochNum !== null) {
        currentEpochCache = {
          value: onChainCurrentEpochNum,
          expiresAt: Date.now() + CURRENT_EPOCH_CACHE_MS,
          source: "chain",
        };
        return onChainCurrentEpochNum;
      }
    } catch {
      // Fall back to indexed meta when RPC is unavailable.
    }

    currentEpochCache = {
      value: fallback,
      expiresAt: Date.now() + CURRENT_EPOCH_CACHE_MS,
      source: "indexed",
    };
    return fallback;
  })().finally(() => {
    currentEpochInflight = null;
  });

  return currentEpochInflight;
}

function refreshCurrentEpochFromChainInBackground(storedCurrentEpoch: number) {
  if (currentEpochBackgroundRefresh) return;

  currentEpochBackgroundRefresh = (async () => {
    try {
      const onChainCurrentEpoch = await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: CURRENT_EPOCH_ABI,
        functionName: "currentEpoch",
      });
      const onChainCurrentEpochNum = parseChainEpochNumber(onChainCurrentEpoch);
      if (onChainCurrentEpochNum !== null && onChainCurrentEpochNum >= storedCurrentEpoch) {
        currentEpochCache = {
          value: onChainCurrentEpochNum,
          expiresAt: Date.now() + CURRENT_EPOCH_CACHE_MS,
          source: "chain",
        };
      }
    } catch {
      // Keep serving indexed meta when RPC is slow or unavailable.
    } finally {
      currentEpochBackgroundRefresh = null;
    }
  })();
}

async function resolveFreshCurrentEpochNumber(options: { preferOnChain?: boolean } = {}) {
  const now = Date.now();
  if (
    currentEpochCache &&
    currentEpochCache.expiresAt > now &&
    (!options.preferOnChain || currentEpochCache.source === "chain")
  ) {
    return currentEpochCache.value;
  }

  const storedCurrentEpoch = getMetaNumber("currentEpoch");
  if (options.preferOnChain) {
    return readCurrentEpochFromChain(isValidEpochNumber(storedCurrentEpoch) ? storedCurrentEpoch : null);
  }

  if (isValidEpochNumber(storedCurrentEpoch)) {
    currentEpochCache = {
      value: storedCurrentEpoch,
      expiresAt: now + CURRENT_EPOCH_CACHE_MS,
      source: "indexed",
    };

    refreshCurrentEpochFromChainInBackground(storedCurrentEpoch);

    return storedCurrentEpoch;
  }

  return readCurrentEpochFromChain(null);
}

function jsonNoStore(payload: DepositsPayload, status = 200) {
  return applyNoStoreHeaders(NextResponse.json(payload, { status }));
}

function readIndexedDeposits(user: string, currentEpochNum: number | null) {
  const raw = getUserBetsMap(user, 5000) as Record<string, DepositRow>;
  if (!raw || typeof raw !== "object") {
    return [] as DepositRow[];
  }

  let deposits = Object.values(raw) as DepositRow[];
  deposits = filterByCurrentEpoch(deposits, currentEpochNum);
  deposits = deposits.filter((d) => {
    const blockNumber = parseStoredBlockNumber(d.blockNumber);
    if (blockNumber > 0n && blockNumber < CONTRACT_DEPLOY_BLOCK) return false;
    return true;
  });
  return dedupeDeposits(deposits).map(normalizeDepositRow).filter(hasDepositTiles);
}

async function recoverDepositsAndPersist(user: string, currentEpochNum: number | null) {
  if (!ENABLE_FINALIZED_CHAIN_RECOVERY) return [];

  const latestIndexedBlock = getMetaBigInt("lastIndexedBlock");
  const headBlock = await publicClient.getBlockNumber();
  const finalityTargetBlock = getIndexerFinalityTargetBlock(headBlock, INDEXER_FINALITY_BLOCKS);
  if (finalityTargetBlock === null || finalityTargetBlock < CONTRACT_DEPLOY_BLOCK) return [];

  const recoveryWindowStart =
    finalityTargetBlock >= RECENT_RECOVERY_BLOCK_WINDOW
      ? finalityTargetBlock - RECENT_RECOVERY_BLOCK_WINDOW + 1n
      : 0n;
  const boundedWindowStart =
    recoveryWindowStart > CONTRACT_DEPLOY_BLOCK ? recoveryWindowStart : CONTRACT_DEPLOY_BLOCK;
  const indexedStart =
    latestIndexedBlock !== null && latestIndexedBlock >= CONTRACT_DEPLOY_BLOCK
      ? latestIndexedBlock + 1n
      : CONTRACT_DEPLOY_BLOCK;
  const recoveryFromBlock = indexedStart > boundedWindowStart ? indexedStart : boundedWindowStart;
  if (recoveryFromBlock > finalityTargetBlock) return [];

  const recovered = await fetchDepositsFromChain(
    user,
    currentEpochNum,
    recoveryFromBlock,
    finalityTargetBlock,
  );
  if (recovered.length > 0) {
    const patch: Record<string, unknown> = {};
    for (const d of recovered) {
      const key = buildDepositKey(d.epoch, d.txHash, d.blockNumber);
      patch[key] = d;
    }
    await patchStorage(`gamedata/bets/${user}`, patch);
  }
  return recovered;
}

async function recoverDepositsWithGlobalBound(user: string, currentEpochNum: number | null) {
  const now = Date.now();
  if (
    depositsRecoveryInflight ||
    now - depositsRecoveryStartedAt < DEPOSITS_BACKGROUND_RECOVERY_COOLDOWN_MS
  ) {
    return null;
  }

  depositsRecoveryStartedAt = now;
  const task = recoverDepositsAndPersist(user, currentEpochNum);
  depositsRecoveryInflight = task;
  try {
    return await task;
  } finally {
    if (depositsRecoveryInflight === task) {
      depositsRecoveryInflight = null;
    }
  }
}

async function buildDepositsPayload(
  user: string,
  includeRewards = false,
  options: DepositsBuildOptions = {},
): Promise<DepositsBuildResult> {
  const indexedCurrentEpochNum = getMetaNumber("currentEpoch");
  const currentEpochNum = ENABLE_FINALIZED_CHAIN_RECOVERY
    ? await resolveFreshCurrentEpochNumber({
        preferOnChain: Boolean(options.allowSlowRecovery),
      })
    : isValidEpochNumber(indexedCurrentEpochNum)
      ? indexedCurrentEpochNum
      : null;
  let deposits = readIndexedDeposits(user, currentEpochNum);

  const indexedEpochLag =
    currentEpochNum && indexedCurrentEpochNum ? currentEpochNum - indexedCurrentEpochNum : 0;
  const shouldAttemptRecovery =
    ENABLE_FINALIZED_CHAIN_RECOVERY &&
    (deposits.length === 0 || indexedEpochLag >= DEPOSIT_RECOVERY_EPOCH_LAG);

  if (shouldAttemptRecovery && options.allowSlowRecovery) {
    const recovered = await recoverDepositsWithGlobalBound(user, currentEpochNum);
    if (recovered && recovered.length > 0) {
      deposits = dedupeDeposits([...deposits, ...recovered]).map(normalizeDepositRow).filter(hasDepositTiles);
    }
  }

  deposits = sortDepositsDesc(deposits).slice(0, 5000);

  if (!includeRewards || deposits.length === 0) {
    return {
      payload: { deposits },
      recoveryNeeded: shouldAttemptRecovery,
    };
  }

  const epochs = [...new Set(
    deposits
      .map((row) => parseStoredEpochNumber(row.epoch))
      .filter(isSafePositiveInteger),
  )].slice(0, INLINE_REWARD_EPOCH_LIMIT);
  const rewardSummary = await loadRewardMapsForUserEpochs(user, epochs);
  return {
    payload: {
      deposits,
      epochs: rewardSummary.epochs,
      rewards: rewardSummary.rewards,
    },
    recoveryNeeded: shouldAttemptRecovery,
  };
}

function startDepositsRefresh(cacheKey: string, user: string, includeRewards: boolean) {
  const watermark = getDepositsDataWatermark();
  startVersionedBackgroundRefresh({
    cache: depositsRouteCache,
    cacheKey,
    ttlMs: DEPOSITS_ROUTE_CACHE_MS,
    routeMetricKey: ROUTE_METRIC_KEY,
    shouldSkip: () =>
      depositsBuildInflight.has(cacheKey) || depositsCacheWatermarks.getStale(cacheKey) === watermark,
    build: () => buildDepositsPayload(user, includeRewards, { allowSlowRecovery: true }),
    toPayload: (result) => result.payload,
    onCommit: (result) => {
      if (result.recoveryNeeded) {
        depositsCacheWatermarks.delete(cacheKey);
        return;
      }
      depositsCacheWatermarks.set(cacheKey, watermark, DEPOSITS_ROUTE_CACHE_MS);
    },
    onError: (error) => {
      logRouteError(ROUTE_METRIC_KEY, error, { user, includeRewards, phase: "background-refresh" });
    },
  });
}

export async function GET(request: NextRequest) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-deposits",
    limit: 20,
    windowMs: 60_000,
  });
  if (rateLimited) return applyNoStoreHeaders(rateLimited);

  const userParam = request.nextUrl.searchParams.get("user");
  const includeRewards = request.nextUrl.searchParams.get("includeRewards") === "1";
  let user: `0x${string}`;
  try {
    user = getAddress(userParam ?? "").toLowerCase() as `0x${string}`;
  } catch {
    return jsonNoStore({ deposits: [], error: "Missing or invalid ?user=0x..." }, 400);
  }

  const metric = beginRouteMetric(ROUTE_METRIC_KEY);
  const cacheKey = includeRewards ? `${user}:rewards` : user;
  const currentWatermark = getDepositsDataWatermark();
  const now = Date.now();
  const cached = depositsRouteCache.getFresh(cacheKey, now);
  if (cached) {
    markRouteCacheHit(ROUTE_METRIC_KEY);
    finishRouteMetric(metric, 200);
    return jsonNoStore(cached);
  }
  const staleCache = depositsRouteCache.getStale(cacheKey);
  if (staleCache) {
    markRouteStaleServed(ROUTE_METRIC_KEY);
    startDepositsRefresh(cacheKey, user, includeRewards);
    finishRouteMetric(metric, 200);
    return jsonNoStore(staleCache);
  }

  try {
    const inflightBuild = depositsBuildInflight.get(cacheKey);
    const result = inflightBuild
      ? (markRouteInflightJoin(ROUTE_METRIC_KEY), await inflightBuild)
      : await (() => {
          const { buildPromise } = startVersionedInflightBuild({
            cache: depositsRouteCache,
            cacheKey,
            ttlMs: DEPOSITS_ROUTE_CACHE_MS,
            build: () =>
              buildDepositsPayload(user, includeRewards, { allowSlowRecovery: false }).finally(() => {
                depositsBuildInflight.delete(cacheKey);
              }),
            toPayload: (result) => result.payload,
            onCommit: (result) => {
              if (result.recoveryNeeded) {
                depositsCacheWatermarks.delete(cacheKey);
                return;
              }
              depositsCacheWatermarks.set(cacheKey, currentWatermark, DEPOSITS_ROUTE_CACHE_MS);
            },
          });
          depositsBuildInflight.set(cacheKey, buildPromise);
          return buildPromise;
        })();

    if (result.recoveryNeeded) {
      startDepositsRefresh(cacheKey, user, includeRewards);
    }

    finishRouteMetric(metric, 200);
    return jsonNoStore(result.payload);
  } catch (err) {
    logRouteError(ROUTE_METRIC_KEY, err, { user, includeRewards });
    const message = err instanceof Error ? err.message : "fetch failed";
    const status = message.startsWith("Firebase ") ? 502 : 500;
    failRouteMetric(metric, status);
    return jsonNoStore(
      { deposits: [], error: status === 502 ? "Deposit data service unavailable" : "Unable to load deposits" },
      status,
    );
  }
}
