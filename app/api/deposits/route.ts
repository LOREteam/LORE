import { NextRequest, NextResponse } from "next/server";
import { decodeEventLog, encodeEventTopics, formatUnits, parseAbi } from "viem";
import { applyNoStoreHeaders } from "../_lib/responseHeaders";
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
  patchFirebase,
  publicClient,
} from "../_lib/dataBridge";
import { logRouteError } from "../_lib/routeError";
import { enforceSharedRateLimit } from "../_lib/sharedRateLimit";
import { createRouteCache } from "../_lib/routeCache";
import { startVersionedBackgroundRefresh, startVersionedInflightBuild } from "../_lib/versionedRouteCache";

const LOG_CHUNK_BLOCKS = 50_000n;
const ENABLE_CHAIN_RECOVERY = process.env.API_DEPOSITS_CHAIN_RECOVERY === "1";
const DEPOSITS_ROUTE_CACHE_MS = 15_000;
const DEPOSITS_ROUTE_CACHE_MAX_KEYS = 512;
const ROUTE_METRIC_KEY = "api/deposits";
const DEPOSIT_RECOVERY_EPOCH_LAG = 8;
const RECENT_RECOVERY_BLOCK_WINDOW = 100_000n;
const CURRENT_EPOCH_CACHE_MS = 5_000;
const INLINE_REWARD_EPOCH_LIMIT = 64;
const depositsBuildInflight = new Map<string, Promise<DepositsBuildResult>>();
const CURRENT_EPOCH_ABI = parseAbi([
  "function currentEpoch() view returns (uint256)",
]);

const EVENTS_ABI = parseAbi([
  "event BetPlaced(uint256 indexed epoch, address indexed user, uint256 indexed tileId, uint256 amount)",
  "event BatchBetsPlaced(uint256 indexed epoch, address indexed user, uint256[] tileIds, uint256[] amounts, uint256 totalAmount)",
  "event BatchBetsSameAmountPlaced(uint256 indexed epoch, address indexed user, uint256[] tileIds, uint256 amount, uint256 totalAmount)",
]);
const [betSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "BetPlaced" });
const [batchSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "BatchBetsPlaced" });
const [batchSameAmountSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "BatchBetsSameAmountPlaced" });

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
let currentEpochCache: { value: number | null; expiresAt: number } | null = null;
let currentEpochInflight: Promise<number | null> | null = null;

function buildDepositKey(epoch: string, txHash: string, blockNumber: string): string {
  const normalizedHash = txHash.toLowerCase().trim();
  if (/^0x[0-9a-f]+$/.test(normalizedHash)) {
    return `${epoch}_${normalizedHash}`;
  }
  return `${epoch}_nohash_${blockNumber}`;
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
    const prevBlock = Number(prev.blockNumber ?? "0");
    const nextBlock = Number(row.blockNumber ?? "0");
    if (nextBlock >= prevBlock) {
      byKey.set(key, row);
    }
  }
  return Array.from(byKey.values());
}

function addressToTopic(address: string): `0x${string}` {
  return `0x${address.toLowerCase().slice(2).padStart(64, "0")}` as `0x${string}`;
}

function normalizeDepositRow(row: DepositRow): DepositRow {
  const tileIds = Array.isArray(row.tileIds) ? row.tileIds : [];
  if (tileIds.length === 0) {
    return { ...row, tileIds: [], amounts: [] };
  }

  const normalizedAmounts =
    Array.isArray(row.amounts) && row.amounts.length === tileIds.length
      ? row.amounts.map((value) => {
          const parsed = Number.parseFloat(String(value));
          return Number.isFinite(parsed) ? parsed : 0;
        })
      : tileIds.map(() => row.totalAmountNum / tileIds.length);

  const aggregate = new Map<number, number>();
  for (let index = 0; index < tileIds.length; index += 1) {
    const tileId = Number(tileIds[index]);
    if (!Number.isInteger(tileId) || tileId <= 0 || tileId > 25) continue;
    aggregate.set(tileId, (aggregate.get(tileId) ?? 0) + (normalizedAmounts[index] ?? 0));
  }

  const mergedTileIds = [...aggregate.keys()];
  if (mergedTileIds.length === tileIds.length) {
    return {
      ...row,
      amounts: normalizedAmounts.map((value) => String(value)),
    };
  }

  return {
    ...row,
    tileIds: mergedTileIds,
    amounts: mergedTileIds.map((tileId) => String(aggregate.get(tileId) ?? 0)),
  };
}

function payloadTouchesCurrentEpoch(payload: DepositsPayload, currentEpochNum: number | null) {
  if (!currentEpochNum || !Array.isArray(payload.deposits) || payload.deposits.length === 0) {
    return false;
  }
  return payload.deposits.some((row) => Number(row.epoch) === currentEpochNum);
}

async function getLogsByTopicAndUser(
  topic0: `0x${string}`,
  userTopic: `0x${string}`,
  fromBlock: bigint = CONTRACT_DEPLOY_BLOCK,
) {
  const all: Awaited<ReturnType<typeof publicClient.getLogs>> = [];
  const head = await publicClient.getBlockNumber();
  const startBlock = fromBlock > CONTRACT_DEPLOY_BLOCK ? fromBlock : CONTRACT_DEPLOY_BLOCK;
  for (let from = startBlock; from <= head; from += LOG_CHUNK_BLOCKS) {
    const to = from + LOG_CHUNK_BLOCKS - 1n > head ? head : from + LOG_CHUNK_BLOCKS - 1n;
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
  fromBlock: bigint = CONTRACT_DEPLOY_BLOCK,
) {
  const userTopic = addressToTopic(user);
  const betLogs = betSig ? await getLogsByTopicAndUser(betSig, userTopic, fromBlock) : [];
  const batchLogs = batchSig ? await getLogsByTopicAndUser(batchSig, userTopic, fromBlock) : [];
  const batchSameAmountLogs = batchSameAmountSig ? await getLogsByTopicAndUser(batchSameAmountSig, userTopic, fromBlock) : [];
  const byKey = new Map<string, DepositRow>();
  const all = [...betLogs, ...batchLogs, ...batchSameAmountLogs];
  all.sort((a, b) => Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n)));

  for (const log of all) {
    const topic0 = log.topics[0];
    if (!topic0) continue;
    try {
      if (topic0 === betSig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "BetPlaced") continue;
        const args = decoded.args as { epoch: bigint; tileId: bigint; amount: bigint };
        const ep = Number(args.epoch);
        if (currentEpoch && (ep < 1 || ep > currentEpoch)) continue;
        const key = buildDepositKey(
          args.epoch.toString(),
          log.transactionHash ?? "",
          (log.blockNumber ?? 0n).toString(),
        );
        const amount = formatUnits(args.amount, 18);
        const prev = byKey.get(key);
        if (prev) {
          prev.tileIds.push(Number(args.tileId));
          prev.totalAmountNum += parseFloat(amount);
          prev.totalAmount = prev.totalAmountNum.toString();
        } else {
          byKey.set(key, {
            epoch: args.epoch.toString(),
            tileIds: [Number(args.tileId)],
            amounts: [amount],
            totalAmount: amount,
            totalAmountNum: parseFloat(amount),
            txHash: log.transactionHash ?? "",
            blockNumber: (log.blockNumber ?? 0n).toString(),
          });
        }
      } else if (topic0 === batchSig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "BatchBetsPlaced") continue;
        const args = decoded.args as { epoch: bigint; tileIds: readonly bigint[]; amounts: readonly bigint[]; totalAmount: bigint };
        const ep = Number(args.epoch);
        if (currentEpoch && (ep < 1 || ep > currentEpoch)) continue;
        const key = buildDepositKey(
          args.epoch.toString(),
          log.transactionHash ?? "",
          (log.blockNumber ?? 0n).toString(),
        );
        byKey.set(key, {
          epoch: args.epoch.toString(),
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
        const args = decoded.args as { epoch: bigint; tileIds: readonly bigint[]; amount: bigint; totalAmount: bigint };
        const ep = Number(args.epoch);
        if (currentEpoch && (ep < 1 || ep > currentEpoch)) continue;
        const amount = formatUnits(args.amount, 18);
        const key = buildDepositKey(
          args.epoch.toString(),
          log.transactionHash ?? "",
          (log.blockNumber ?? 0n).toString(),
        );
        byKey.set(key, {
          epoch: args.epoch.toString(),
          tileIds: args.tileIds.map(Number),
          amounts: args.tileIds.map(() => amount),
          totalAmount: formatUnits(args.totalAmount, 18),
          totalAmountNum: parseFloat(formatUnits(args.totalAmount, 18)),
          txHash: log.transactionHash ?? "",
          blockNumber: (log.blockNumber ?? 0n).toString(),
        });
      }
    } catch {
      // malformed log
    }
  }

  const rows = Array.from(byKey.values());
  rows.sort((a, b) => Number(b.epoch) - Number(a.epoch));
  return rows.slice(0, 5000);
}

async function resolveFreshCurrentEpochNumber() {
  const now = Date.now();
  if (currentEpochCache && currentEpochCache.expiresAt > now) {
    return currentEpochCache.value;
  }
  if (currentEpochInflight) {
    return currentEpochInflight;
  }

  const storedCurrentEpoch = getMetaNumber("currentEpoch");
  currentEpochInflight = (async () => {
    try {
      const onChainCurrentEpoch = await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: CURRENT_EPOCH_ABI,
        functionName: "currentEpoch",
      });
      const onChainCurrentEpochNum = Number(onChainCurrentEpoch);
      if (Number.isInteger(onChainCurrentEpochNum) && onChainCurrentEpochNum > 0) {
        if (!storedCurrentEpoch || onChainCurrentEpochNum > storedCurrentEpoch) {
          currentEpochCache = {
            value: onChainCurrentEpochNum,
            expiresAt: Date.now() + CURRENT_EPOCH_CACHE_MS,
          };
          return onChainCurrentEpochNum;
        }
      }
    } catch {
      // Fall back to indexed meta when RPC is unavailable.
    }

    currentEpochCache = {
      value: storedCurrentEpoch,
      expiresAt: Date.now() + CURRENT_EPOCH_CACHE_MS,
    };
    return storedCurrentEpoch;
  })().finally(() => {
    currentEpochInflight = null;
  });

  return currentEpochInflight;
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
    const blockNumber = Number(d.blockNumber ?? "0");
    if (blockNumber > 0 && BigInt(blockNumber) < CONTRACT_DEPLOY_BLOCK) return false;
    return true;
  });
  return dedupeDeposits(deposits).map(normalizeDepositRow);
}

async function recoverDepositsAndPersist(user: string, currentEpochNum: number | null) {
  const latestIndexedBlock = getMetaBigInt("lastIndexedBlock");
  const headBlock = await publicClient.getBlockNumber();
  const recoveryFromBlock =
    latestIndexedBlock && latestIndexedBlock >= CONTRACT_DEPLOY_BLOCK
      ? latestIndexedBlock + 1n
      : headBlock > RECENT_RECOVERY_BLOCK_WINDOW
        ? headBlock - RECENT_RECOVERY_BLOCK_WINDOW
        : CONTRACT_DEPLOY_BLOCK;
  const recovered = await fetchDepositsFromChain(user, currentEpochNum, recoveryFromBlock);
  if (recovered.length > 0) {
    const patch: Record<string, unknown> = {};
    for (const d of recovered) {
      const key = buildDepositKey(d.epoch, d.txHash, d.blockNumber);
      patch[key] = d;
    }
    await patchFirebase(`gamedata/bets/${user}`, patch);
  }
  return recovered;
}

async function buildDepositsPayload(
  user: string,
  includeRewards = false,
  options: DepositsBuildOptions = {},
): Promise<DepositsBuildResult> {
  const indexedCurrentEpochNum = getMetaNumber("currentEpoch");
  const currentEpochNum = await resolveFreshCurrentEpochNumber();
  let deposits = readIndexedDeposits(user, currentEpochNum);

  const indexedEpochLag =
    currentEpochNum && indexedCurrentEpochNum ? currentEpochNum - indexedCurrentEpochNum : 0;
  const shouldAttemptRecovery =
    ENABLE_CHAIN_RECOVERY ||
    deposits.length === 0 ||
    indexedEpochLag >= DEPOSIT_RECOVERY_EPOCH_LAG;

  if (shouldAttemptRecovery && options.allowSlowRecovery) {
    const recovered = await recoverDepositsAndPersist(user, currentEpochNum);
    if (recovered.length > 0) {
      deposits = dedupeDeposits([...deposits, ...recovered]).map(normalizeDepositRow);
    }
  }

  deposits.sort((a, b) => Number(b.epoch) - Number(a.epoch));
  deposits = deposits.slice(0, 5000);

  if (!includeRewards || deposits.length === 0) {
    return {
      payload: { deposits },
      recoveryNeeded: shouldAttemptRecovery,
    };
  }

  const epochs = [...new Set(
    deposits
      .map((row) => Number(row.epoch))
      .filter((epoch) => Number.isInteger(epoch) && epoch > 0),
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
  startVersionedBackgroundRefresh({
    cache: depositsRouteCache,
    cacheKey,
    ttlMs: DEPOSITS_ROUTE_CACHE_MS,
    routeMetricKey: ROUTE_METRIC_KEY,
    build: () => buildDepositsPayload(user, includeRewards, { allowSlowRecovery: true }),
    toPayload: (result) => result.payload,
    shouldSkip: () => depositsBuildInflight.has(cacheKey),
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
  if (rateLimited) return rateLimited;

  const user = request.nextUrl.searchParams.get("user")?.toLowerCase();
  const includeRewards = request.nextUrl.searchParams.get("includeRewards") === "1";
  if (!user || !/^0x[0-9a-f]{40}$/.test(user)) {
    return jsonNoStore({ deposits: [], error: "Missing or invalid ?user=0x..." }, 400);
  }

  const metric = beginRouteMetric(ROUTE_METRIC_KEY);
  const cacheKey = includeRewards ? `${user}:rewards` : user;
  const now = Date.now();
  const cached = depositsRouteCache.getFresh(cacheKey, now);
  if (cached) {
    markRouteCacheHit(ROUTE_METRIC_KEY);
    finishRouteMetric(metric, 200);
    return jsonNoStore(cached);
  }
  const staleCache = depositsRouteCache.getStale(cacheKey);
  if (staleCache) {
    const indexedCurrentEpochNum = getMetaNumber("currentEpoch");
    if (!payloadTouchesCurrentEpoch(staleCache, indexedCurrentEpochNum)) {
      markRouteStaleServed(ROUTE_METRIC_KEY);
      startDepositsRefresh(cacheKey, user, includeRewards);
      finishRouteMetric(metric, 200);
      return jsonNoStore(staleCache);
    }
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
    return jsonNoStore({ deposits: [], error: message }, status);
  }
}
