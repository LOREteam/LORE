import { NextResponse } from "next/server";
import { decodeEventLog, encodeEventTopics, formatUnits, parseAbi, parseUnits } from "viem";
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
import { logRouteError } from "../_lib/routeError";
import { enforceSharedRateLimit } from "../_lib/sharedRateLimit";
import {
  getMetaBigInt,
  getMetaJson,
  getAllBetRows,
  getEpochMap,
  getRecentRewardClaims,
  setMetaJson,
  upsertRewardClaims,
} from "../../../server/storage";
import {
  CONTRACT_ADDRESS,
  CONTRACT_DEPLOY_BLOCK,
  publicClient,
} from "../_lib/dataBridge";

const RECENT_WINS_LIMIT = 100;
const RECENT_WINS_ROUTE_CACHE_MS = 15_000;
const RECENT_WINS_STALE_REFRESH_MS = 60_000;
const RECENT_WINS_SNAPSHOT_MAX_AGE_MS = 60 * 60 * 1000;
const ROUTE_METRIC_KEY = "api/recent-wins";
const RECENT_WINS_SNAPSHOT_META_KEY = "snapshot:recent-wins:v1";
const RECENT_WINS_LOG_SCAN_CHUNK = 50_000n;
const RECENT_WINS_LOG_SCAN_MIN_CHUNK = 2_000n;
const RECENT_WINS_BOOTSTRAP_SCAN_CHUNK = 500_000n;
const RECENT_WINS_RECOVERY_BLOCK_LAG = BigInt(process.env.RECENT_WINS_RECOVERY_BLOCK_LAG ?? "256");

const EVENTS_ABI = parseAbi([
  "event RewardClaimed(uint256 indexed epoch, address indexed user, uint256 reward)",
]);
const [rewardClaimedSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "RewardClaimed" });

type RecentWinRow = {
  epoch: string;
  user: string;
  amount: string;
  amountRaw: string;
  txHash?: string;
  blockNumber?: string;
};

type RecentWinsPayload = {
  wins: RecentWinRow[];
  error?: string;
};

type RecentWinsSnapshotEnvelope = {
  payload: RecentWinsPayload;
  savedAt: number;
};

type RecentWinsCacheEntry = {
  payload: RecentWinsPayload;
  expiresAt: number;
};
type RecentWinsBuildResult = { payload: RecentWinsPayload; recoveryNeeded: boolean };

let recentWinsCache: RecentWinsCacheEntry | null = null;
let recentWinsInflight: Promise<RecentWinsPayload> | null = null;
let recentWinsRefreshPromise: Promise<void> | null = null;
let recentWinsBuildSeq = 0;
let recentWinsAppliedSeq = 0;

type StoredClaimRow = ReturnType<typeof getRecentRewardClaims>[number];
type RewardClaimLog = Awaited<ReturnType<typeof publicClient.getLogs>>[number];
type StoredBetRow = ReturnType<typeof getAllBetRows>[number];

function parseAmountWei(value: string | undefined) {
  if (!value) return 0n;
  try {
    return parseUnits(value, 18);
  } catch {
    return 0n;
  }
}

function getWinningAmountWeiForBet(row: StoredBetRow, winningTile: number) {
  if (!Number.isInteger(winningTile) || winningTile <= 0) return 0n;
  const tileIds = Array.isArray(row.tileIds) ? row.tileIds : [];
  if (tileIds.length === 0) return 0n;

  const amounts = Array.isArray(row.amounts) ? row.amounts : [];
  if (amounts.length === tileIds.length) {
    return tileIds.reduce((sum, tileId, index) => {
      if (Number(tileId) !== winningTile) return sum;
      return sum + parseAmountWei(amounts[index]);
    }, 0n);
  }

  const hitCount = tileIds.reduce((count, tileId) => count + (Number(tileId) === winningTile ? 1 : 0), 0);
  if (hitCount <= 0) return 0n;
  const totalWei = parseAmountWei(row.totalAmount);
  if (totalWei <= 0n) return 0n;
  return (totalWei / BigInt(tileIds.length)) * BigInt(hitCount);
}

function buildRecentResolvedWins(limit = RECENT_WINS_LIMIT): RecentWinRow[] {
  const epochs = getEpochMap();
  const recentResolvedEpochs = Object.entries(epochs)
    .filter(([, row]) => row.winningTile > 0 && parseAmountWei(row.rewardPool) > 0n)
    .sort((a, b) => {
      const aBlock = BigInt(a[1].resolvedBlock ?? "0");
      const bBlock = BigInt(b[1].resolvedBlock ?? "0");
      if (aBlock === bBlock) {
        return Number(b[0]) - Number(a[0]);
      }
      return aBlock > bBlock ? -1 : 1;
    })
    .slice(0, 36);

  if (recentResolvedEpochs.length === 0) {
    return [];
  }

  const epochRows = new Map<
    string,
    {
      winningTile: number;
      rewardPoolWei: bigint;
      resolvedBlock: string;
    }
  >(
    recentResolvedEpochs.map(([epoch, row]) => [
      epoch,
      {
        winningTile: row.winningTile,
        rewardPoolWei: parseAmountWei(row.rewardPool),
        resolvedBlock: row.resolvedBlock ?? "0",
      },
    ]),
  );

  const byEpochUser = new Map<string, Map<string, bigint>>();
  const totalWinningByEpoch = new Map<string, bigint>();
  for (const bet of getAllBetRows()) {
    const epochInfo = epochRows.get(bet.epoch);
    if (!epochInfo) continue;
    const winningAmountWei = getWinningAmountWeiForBet(bet, epochInfo.winningTile);
    if (winningAmountWei <= 0n) continue;
    const user = bet.user.toLowerCase();
    const perUser = byEpochUser.get(bet.epoch) ?? new Map<string, bigint>();
    perUser.set(user, (perUser.get(user) ?? 0n) + winningAmountWei);
    byEpochUser.set(bet.epoch, perUser);
    totalWinningByEpoch.set(bet.epoch, (totalWinningByEpoch.get(bet.epoch) ?? 0n) + winningAmountWei);
  }

  const rows: RecentWinRow[] = [];
  for (const [epoch] of recentResolvedEpochs) {
    const epochInfo = epochRows.get(epoch);
    const perUser = byEpochUser.get(epoch);
    const totalWinningWei = totalWinningByEpoch.get(epoch) ?? 0n;
    if (!epochInfo || !perUser || totalWinningWei <= 0n || epochInfo.rewardPoolWei <= 0n) continue;

    const winners = [...perUser.entries()]
      .map(([user, winningAmountWei]) => {
        const rewardWei = (epochInfo.rewardPoolWei * winningAmountWei) / totalWinningWei;
        const reward = formatUnits(rewardWei, 18);
        const rewardNum = Number.parseFloat(reward);
        return {
          epoch,
          user,
          amount: Number.isFinite(rewardNum) ? rewardNum.toFixed(2) : "0.00",
          amountRaw: reward,
          blockNumber: epochInfo.resolvedBlock,
        } satisfies RecentWinRow;
      })
      .sort((a, b) => Number.parseFloat(b.amount) - Number.parseFloat(a.amount));

    rows.push(...winners);
    if (rows.length >= limit) {
      break;
    }
  }

  return rows.slice(0, limit);
}

function jsonNoStore(payload: RecentWinsPayload, status = 200) {
  return applyNoStoreHeaders(NextResponse.json(payload, { status }));
}

function isTooManyResultsError(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    message.includes("more than 10000 results") ||
    message.includes("query returned more than 10000 results") ||
    message.includes("request exceeds defined limit")
  );
}

function sortClaimsDesc<T extends { blockNumber: string; txHash?: string; user: string; epoch: string }>(rows: T[]) {
  return [...rows].sort((a, b) => {
    const aBlock = BigInt(a.blockNumber || "0");
    const bBlock = BigInt(b.blockNumber || "0");
    if (aBlock === bBlock) {
      if ((a.txHash ?? "") === (b.txHash ?? "")) {
        if (a.epoch === b.epoch) {
          return a.user.localeCompare(b.user);
        }
        return Number(b.epoch) - Number(a.epoch);
      }
      return (b.txHash ?? "").localeCompare(a.txHash ?? "");
    }
    return aBlock > bBlock ? -1 : 1;
  });
}

async function getLogsChunked(
  request: Omit<Parameters<typeof publicClient.getLogs>[0], "fromBlock" | "toBlock"> & {
    fromBlock: bigint;
    toBlock: bigint;
  },
) {
  const all: Awaited<ReturnType<typeof publicClient.getLogs>> = [];
  let cursor = request.fromBlock;
  let chunkSize = RECENT_WINS_LOG_SCAN_CHUNK;

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
      if (chunkSize < RECENT_WINS_LOG_SCAN_CHUNK) {
        chunkSize =
          chunkSize * 2n > RECENT_WINS_LOG_SCAN_CHUNK ? RECENT_WINS_LOG_SCAN_CHUNK : chunkSize * 2n;
      }
    } catch (err) {
      if (!isTooManyResultsError(err) || chunkSize <= RECENT_WINS_LOG_SCAN_MIN_CHUNK) {
        throw err;
      }
      chunkSize = chunkSize / 2n;
    }
  }

  return all;
}

function mapClaimLog(log: RewardClaimLog): StoredClaimRow | null {
  try {
    const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
    if (decoded.eventName !== "RewardClaimed") return null;
    const args = decoded.args as { epoch: bigint; user: string; reward: bigint };
    return {
      epoch: args.epoch.toString(),
      user: args.user.toLowerCase(),
      reward: formatUnits(args.reward, 18),
      rewardNum: parseFloat(formatUnits(args.reward, 18)),
      txHash: log.transactionHash ?? "",
      blockNumber: (log.blockNumber ?? 0n).toString(),
    };
  } catch {
    return null;
  }
}

async function fetchRewardClaimLogsInRange(fromBlock: bigint, toBlock: bigint) {
  if (toBlock < fromBlock) return [] as RewardClaimLog[];
  return getLogsChunked({
    address: CONTRACT_ADDRESS,
    topics: [rewardClaimedSig],
    fromBlock,
    toBlock,
  } as Parameters<typeof publicClient.getLogs>[0] & { fromBlock: bigint; toBlock: bigint });
}

async function fetchRecentRewardClaimLogsFromChain(limit = RECENT_WINS_LIMIT) {
  const currentBlock = await publicClient.getBlockNumber();
  const collected: RewardClaimLog[] = [];
  let toBlock = currentBlock;
  let chunkSize = RECENT_WINS_BOOTSTRAP_SCAN_CHUNK;

  while (toBlock >= CONTRACT_DEPLOY_BLOCK && collected.length < limit) {
    const fromBlock =
      toBlock - chunkSize + 1n > CONTRACT_DEPLOY_BLOCK
        ? toBlock - chunkSize + 1n
        : CONTRACT_DEPLOY_BLOCK;

    try {
      const logs = await publicClient.getLogs({
        address: CONTRACT_ADDRESS,
        topics: [rewardClaimedSig],
        fromBlock,
        toBlock,
      } as Parameters<typeof publicClient.getLogs>[0]);
      collected.push(...logs);
      if (fromBlock === CONTRACT_DEPLOY_BLOCK) break;
      toBlock = fromBlock - 1n;
    } catch (err) {
      if (!isTooManyResultsError(err) || chunkSize <= RECENT_WINS_LOG_SCAN_MIN_CHUNK) {
        throw err;
      }
      chunkSize = chunkSize / 2n;
    }
  }

  return collected;
}

function mergeClaims(existing: StoredClaimRow[], incoming: StoredClaimRow[]) {
  const byKey = new Map<string, StoredClaimRow>();
  for (const row of existing) {
    byKey.set(`${row.txHash}_${row.user}_${row.epoch}`, row);
  }
  for (const row of incoming) {
    byKey.set(`${row.txHash}_${row.user}_${row.epoch}`, row);
  }
  return sortClaimsDesc(Array.from(byKey.values())).slice(0, RECENT_WINS_LIMIT);
}

async function shouldRecoverRecentWins(storedClaims: StoredClaimRow[]) {
  if (storedClaims.length === 0) return true;
  const lastIndexedBlock = getMetaBigInt("lastIndexedBlock");
  if (!lastIndexedBlock || lastIndexedBlock < CONTRACT_DEPLOY_BLOCK) return true;
  const headBlock = await publicClient.getBlockNumber();
  return headBlock > lastIndexedBlock && headBlock - lastIndexedBlock >= RECENT_WINS_RECOVERY_BLOCK_LAG;
}

async function fetchOnchainClaims(existingClaims: StoredClaimRow[]) {
  const highestStoredBlock = existingClaims.reduce<bigint>((max, row) => {
    try {
      const value = BigInt(row.blockNumber ?? "0");
      return value > max ? value : max;
    } catch {
      return max;
    }
  }, 0n);

  const claimRows =
    existingClaims.length > 0
      ? (await fetchRewardClaimLogsInRange(
          highestStoredBlock > 0n && highestStoredBlock + 1n > CONTRACT_DEPLOY_BLOCK
            ? highestStoredBlock + 1n
            : CONTRACT_DEPLOY_BLOCK,
          await publicClient.getBlockNumber(),
        ))
          .map((log) => mapClaimLog(log))
          .filter((row): row is StoredClaimRow => row !== null)
      : (await fetchRecentRewardClaimLogsFromChain(RECENT_WINS_LIMIT))
          .map((log) => mapClaimLog(log))
          .filter((row): row is StoredClaimRow => row !== null);

  if (claimRows.length > 0) {
    upsertRewardClaims(
      claimRows.map((row) => ({
        id: `${row.txHash || "nohash"}_${row.user}_${row.epoch}`,
        epoch: row.epoch,
        user: row.user,
        reward: row.reward,
        rewardNum: row.rewardNum,
        txHash: row.txHash,
        blockNumber: row.blockNumber,
      })),
    );
  }

  return mergeClaims(existingClaims, claimRows);
}

function buildPayloadFromClaims(claims: StoredClaimRow[]): RecentWinsPayload {
  return {
    wins: claims.map((row) => ({
      epoch: row.epoch,
      user: row.user,
      amount: row.rewardNum.toFixed(2),
      amountRaw: row.reward,
      txHash: row.txHash,
      blockNumber: row.blockNumber,
    })),
  };
}

async function buildRecentWinsPayload(
  options: { allowSlowRecovery?: boolean } = {},
): Promise<RecentWinsBuildResult> {
  const recentResolvedWins = buildRecentResolvedWins(RECENT_WINS_LIMIT);
  if (recentResolvedWins.length > 0) {
    return {
      payload: { wins: recentResolvedWins },
      recoveryNeeded: false,
    };
  }

  const storedClaims = sortClaimsDesc(getRecentRewardClaims(RECENT_WINS_LIMIT));
  const recoveryNeeded = await shouldRecoverRecentWins(storedClaims);
  const claims =
    recoveryNeeded && options.allowSlowRecovery
      ? await fetchOnchainClaims(storedClaims)
      : storedClaims;
  return {
    payload: buildPayloadFromClaims(claims),
    recoveryNeeded,
  };
}

function loadRecentWinsSnapshot(): RecentWinsPayload | null {
  const snapshot = getMetaJson<RecentWinsSnapshotEnvelope | RecentWinsPayload>(RECENT_WINS_SNAPSHOT_META_KEY);
  if (!snapshot || !("savedAt" in snapshot)) {
    return null;
  }

  if (typeof snapshot.savedAt !== "number" || Date.now() - snapshot.savedAt > RECENT_WINS_SNAPSHOT_MAX_AGE_MS) {
    return null;
  }

  return snapshot.payload;
}

function saveRecentWinsSnapshot(payload: RecentWinsPayload) {
  setMetaJson(RECENT_WINS_SNAPSHOT_META_KEY, {
    payload,
    savedAt: Date.now(),
  });
}

function commitRecentWinsCache(payload: RecentWinsPayload, ttlMs: number, seq: number) {
  if (seq < recentWinsAppliedSeq) {
    return recentWinsCache?.payload ?? payload;
  }
  recentWinsAppliedSeq = seq;
  recentWinsCache = {
    payload,
    expiresAt: Date.now() + ttlMs,
  };
  saveRecentWinsSnapshot(payload);
  return payload;
}

function startRecentWinsRefresh() {
  if (recentWinsRefreshPromise || recentWinsInflight) return;

  markRouteBackgroundRefresh(ROUTE_METRIC_KEY);
  const seq = ++recentWinsBuildSeq;
  recentWinsRefreshPromise = buildRecentWinsPayload({ allowSlowRecovery: true })
    .then(({ payload: result }) => {
      commitRecentWinsCache(result, RECENT_WINS_STALE_REFRESH_MS, seq);
    })
    .catch((error) => {
      logRouteError(ROUTE_METRIC_KEY, error, { phase: "background-refresh" });
    })
    .finally(() => {
      recentWinsRefreshPromise = null;
    });
}

export async function GET(request: Request) {
  const metric = beginRouteMetric(ROUTE_METRIC_KEY);
  const now = Date.now();
  if (recentWinsCache && recentWinsCache.expiresAt > now) {
    markRouteCacheHit(ROUTE_METRIC_KEY);
    finishRouteMetric(metric, 200);
    return jsonNoStore(recentWinsCache.payload);
  }

  if (!recentWinsCache) {
    const snapshot = loadRecentWinsSnapshot();
    if (snapshot) {
      recentWinsCache = {
        payload: snapshot,
        expiresAt: now - 1,
      };
    }
  }

  const staleCache = recentWinsCache?.payload ?? null;
  if (staleCache) {
    markRouteStaleServed(ROUTE_METRIC_KEY);
    startRecentWinsRefresh();
    finishRouteMetric(metric, 200);
    return jsonNoStore(staleCache);
  }

  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-recent-wins",
    limit: 30,
    windowMs: 60_000,
  });
  if (rateLimited) {
    failRouteMetric(metric, 429);
    return rateLimited;
  }

  try {
    const payload = recentWinsInflight
      ? (markRouteInflightJoin(ROUTE_METRIC_KEY), await recentWinsInflight)
      : await (() => {
          const seq = ++recentWinsBuildSeq;
          recentWinsInflight = buildRecentWinsPayload({ allowSlowRecovery: true })
            .then(({ payload: result }) => {
              return commitRecentWinsCache(result, RECENT_WINS_ROUTE_CACHE_MS, seq);
            })
            .finally(() => {
              recentWinsInflight = null;
            });
          return recentWinsInflight;
        })();

    finishRouteMetric(metric, 200);
    return jsonNoStore(payload);
  } catch (error) {
    logRouteError(ROUTE_METRIC_KEY, error);
    if (staleCache) {
      markRouteStaleServed(ROUTE_METRIC_KEY);
      finishRouteMetric(metric, 200);
      return jsonNoStore(staleCache);
    }
    failRouteMetric(metric, 500);
    return jsonNoStore({ wins: [], error: "fetch failed" }, 500);
  }
}
