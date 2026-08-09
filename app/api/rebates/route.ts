import { NextRequest, NextResponse } from "next/server";
import { formatUnits, getAddress } from "viem";
import { applyNoStoreHeaders } from "../_lib/responseHeaders";
import {
  beginRouteMetric,
  failRouteMetric,
  finishRouteMetric,
  markRouteCacheHit,
  markRouteInflightJoin,
  markRouteStaleServed,
} from "../_lib/runtimeMetrics";
import { enforceSharedRateLimit } from "../_lib/sharedRateLimit";
import { CONTRACT_ADDRESS, isSafePositiveInteger, publicClient } from "../_lib/dataBridge";
import { CONTRACT_HAS_REBATE_API, GAME_ABI } from "../../lib/constants";
import { createRouteCache } from "../_lib/routeCache";
import { logRouteError } from "../_lib/routeError";
import { getMetaBigInt, getMetaNumber, getUserParticipatingEpochs } from "../../../server/storage";
import { startVersionedBackgroundRefresh, startVersionedInflightBuild } from "../_lib/versionedRouteCache";

const REBATE_ROUTE_CACHE_MS = 120_000;
const REBATE_SUMMARY_CHUNK_SIZE = 96;
const REBATE_EXACT_CHUNK_SIZE = 48;
const REBATE_DETAILS_LIMIT = 8;
const REBATE_ROUTE_CACHE_MAX_KEYS = 512;
const REBATE_SUMMARY_CONCURRENCY = 6;
const REBATE_EXACT_CONCURRENCY = 6;
const ROUTE_METRIC_KEY = "api/rebates";
const REBATE_INDEXED_EPOCHS_CACHE_MS = 30_000;
const REBATE_UNCHANGED_WATERMARK_REFRESH_MS = 5 * 60_000;
const REBATE_TIMING_MAX_MS = 24 * 60 * 60 * 1000;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

type RebateEpochInfo = {
  epoch: number;
  pendingWei: string;
  pending: string;
  claimed: boolean;
  resolved: boolean;
  userVolumeWei: string;
  rebatePoolWei: string;
};

type RebatePayload = {
  isSupported: boolean;
  pendingRebateWei: string;
  claimableEpochCount: number;
  claimableEpochList: number[];
  totalEpochs: number;
  participatingEpochs: number[];
  recentEpochs: RebateEpochInfo[];
};

type RebateBuildTimings = {
  indexedMs: number;
  summaryMs: number;
  exactMs: number;
  recentMs: number;
  totalMs: number;
  epochCount: number;
  summaryChunks: number;
  exactChunks: number;
};

type RebateInfoResult = [bigint, bigint, bigint, boolean, boolean];

const rebateRouteCache = createRouteCache<RebatePayload>(REBATE_ROUTE_CACHE_MAX_KEYS);
const rebateIndexedEpochsCache = createRouteCache<number[]>(REBATE_ROUTE_CACHE_MAX_KEYS);
const rebateCacheWatermarks = createRouteCache<{ refreshedAt: number; watermark: string }>(
  REBATE_ROUTE_CACHE_MAX_KEYS,
);

function normalizeRebateTimingMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, REBATE_TIMING_MAX_MS);
}

function formatRebateTimingMs(value: number): string {
  return normalizeRebateTimingMs(value).toFixed(1);
}

function formatRebateTimingLogValue(value: number): number {
  return Number(formatRebateTimingMs(value));
}

function formatServerTiming(params: {
  cacheStatus: "fresh" | "stale" | "miss" | "inflight";
  timings?: RebateBuildTimings | null;
}) {
  const { cacheStatus, timings } = params;
  const metrics = [`cache;desc="${cacheStatus}"`];
  if (timings) {
    metrics.push(`indexed;dur=${formatRebateTimingMs(timings.indexedMs)}`);
    metrics.push(`summary;dur=${formatRebateTimingMs(timings.summaryMs)}`);
    metrics.push(`exact;dur=${formatRebateTimingMs(timings.exactMs)}`);
    metrics.push(`recent;dur=${formatRebateTimingMs(timings.recentMs)}`);
    metrics.push(`total;dur=${formatRebateTimingMs(timings.totalMs)}`);
  }
  return metrics.join(", ");
}

function jsonNoStore(
  payload: RebatePayload | { error: string },
  status = 200,
  options?: {
    cacheStatus?: "fresh" | "stale" | "miss" | "inflight";
    timings?: RebateBuildTimings | null;
  },
) {
  const response = applyNoStoreHeaders(NextResponse.json(payload, { status }));
  if (options?.cacheStatus) {
    response.headers.set("Server-Timing", formatServerTiming({
      cacheStatus: options.cacheStatus,
      timings: options.timings ?? null,
    }));
    response.headers.set("X-Rebate-Cache", options.cacheStatus);
  }
  return response;
}

function startRebateBackgroundRefresh(
  cacheKey: string,
  user: `0x${string}`,
  includeExact: boolean,
) {
  const watermark = getRebateDataWatermark();
  startVersionedBackgroundRefresh({
    cache: rebateRouteCache,
    cacheKey,
    ttlMs: REBATE_ROUTE_CACHE_MS,
    routeMetricKey: ROUTE_METRIC_KEY,
    shouldSkip: () => {
      const cachedWatermark = rebateCacheWatermarks.getStale(cacheKey);
      return Boolean(
        cachedWatermark &&
          cachedWatermark.watermark === watermark &&
          Date.now() - cachedWatermark.refreshedAt < REBATE_UNCHANGED_WATERMARK_REFRESH_MS,
      );
    },
    build: () => buildRebatePayload(user, { includeExact }),
    toPayload: ({ payload }) => payload,
    onCommit: () => {
      rebateCacheWatermarks.set(
        cacheKey,
        { watermark, refreshedAt: Date.now() },
        REBATE_UNCHANGED_WATERMARK_REFRESH_MS,
      );
    },
    onError: (error) => {
      logRouteError(ROUTE_METRIC_KEY, error, { user, phase: "background-refresh" });
    },
  });
}

function isMissingContractMethodError(err: unknown, methodName: string) {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  const quotedMethod = `function "${methodName.toLowerCase()}"`;
  return (
    msg.includes(`${quotedMethod} returned no data`) ||
    msg.includes(`${quotedMethod} is not in the abi`) ||
    msg.includes(`does not have the function "${methodName.toLowerCase()}"`) ||
    msg.includes('returned no data ("0x")')
  );
}

function bigintToNonNegativeSafeNumber(value: bigint): number {
  if (value <= 0n) return 0;
  if (value > MAX_SAFE_INTEGER_BIGINT) return Number.MAX_SAFE_INTEGER;
  return Number(value);
}

function parseRebateEpochNumber(value: bigint): number | null {
  if (value <= 0n || value > MAX_SAFE_INTEGER_BIGINT) return null;
  const parsed = Number(value);
  return isSafePositiveInteger(parsed) ? parsed : null;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) return;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  };

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}

async function getIndexedEpochs(user: `0x${string}`): Promise<number[]> {
  const cacheKey = `${user.toLowerCase()}:${getRebateDataWatermark()}`;
  const cached = rebateIndexedEpochsCache.getFresh(cacheKey);
  if (cached) {
    return cached;
  }

  const inflight = rebateIndexedEpochsCache.getInflight(cacheKey);
  if (inflight) {
    return inflight;
  }

  const task: Promise<number[]> = Promise.resolve(getUserParticipatingEpochs(user, 5000))
    .then((epochs) => rebateIndexedEpochsCache.set(cacheKey, epochs, REBATE_INDEXED_EPOCHS_CACHE_MS))
    .finally(() => {
      rebateIndexedEpochsCache.clearInflight(cacheKey, task);
    });

  rebateIndexedEpochsCache.setInflight(cacheKey, task);
  return task;
}

function getRebateDataWatermark() {
  const currentEpoch = getMetaNumber("currentEpoch");
  const lastIndexedBlock = getMetaBigInt("lastIndexedBlock")?.toString() ?? "null";
  return `${isSafePositiveInteger(currentEpoch ?? 0) ? String(currentEpoch) : "null"}:${lastIndexedBlock}`;
}

async function loadClaimableEpochsExact(
  address: `0x${string}`,
  epochs: bigint[],
): Promise<number[]> {
  const claimable = new Set<number>();
  const chunks: bigint[][] = [];

  for (let i = 0; i < epochs.length; i += REBATE_EXACT_CHUNK_SIZE) {
    chunks.push(epochs.slice(i, i + REBATE_EXACT_CHUNK_SIZE));
  }

  await mapWithConcurrency(chunks, REBATE_EXACT_CONCURRENCY, async (chunk) => {
    const contracts = chunk.map((epoch) => ({
      address: CONTRACT_ADDRESS,
      abi: GAME_ABI,
      functionName: "getRebateInfo" as const,
      args: [epoch, address] as const,
    }));

    try {
      const results = await publicClient.multicall({ contracts });
      results.forEach((result, index) => {
        if (result.status !== "success") return;
        const [, , pendingWei, claimed, resolved] = result.result as [bigint, bigint, bigint, boolean, boolean];
        if (pendingWei > 0n && !claimed && resolved) {
          const epochNumber = parseRebateEpochNumber(chunk[index]);
          if (epochNumber !== null) {
            claimable.add(epochNumber);
          }
        }
      });
    } catch {
      for (const epoch of chunk) {
        try {
          const result = await publicClient.readContract({
            address: CONTRACT_ADDRESS,
            abi: GAME_ABI,
            functionName: "getRebateInfo",
            args: [epoch, address],
          }) as [bigint, bigint, bigint, boolean, boolean];
          const [, , pendingWei, claimed, resolved] = result;
          if (pendingWei > 0n && !claimed && resolved) {
            const epochNumber = parseRebateEpochNumber(epoch);
            if (epochNumber !== null) {
              claimable.add(epochNumber);
            }
          }
        } catch {
          // ignore per-epoch read failures here
        }
      }
    }
  });

  return [...claimable].sort((a, b) => b - a);
}

async function buildRebatePayload(
  user: `0x${string}`,
  options?: { includeExact?: boolean },
): Promise<{ payload: RebatePayload; timings: RebateBuildTimings }> {
  const totalStartedAt = performance.now();
  const includeExact = options?.includeExact ?? false;
  if (!CONTRACT_HAS_REBATE_API) {
    return {
      payload: {
        isSupported: false,
        pendingRebateWei: "0",
        claimableEpochCount: 0,
        claimableEpochList: [],
        totalEpochs: 0,
        participatingEpochs: [],
        recentEpochs: [],
      },
      timings: {
        indexedMs: 0,
        summaryMs: 0,
        exactMs: 0,
        recentMs: 0,
        totalMs: performance.now() - totalStartedAt,
        epochCount: 0,
        summaryChunks: 0,
        exactChunks: 0,
      },
    };
  }

  const indexedStartedAt = performance.now();
  const epochs = (await getIndexedEpochs(user)).filter(isSafePositiveInteger);
  const indexedMs = performance.now() - indexedStartedAt;
  if (epochs.length === 0) {
    return {
      payload: {
        isSupported: true,
        pendingRebateWei: "0",
        claimableEpochCount: 0,
        claimableEpochList: [],
        totalEpochs: 0,
        participatingEpochs: [],
        recentEpochs: [],
      },
      timings: {
        indexedMs,
        summaryMs: 0,
        exactMs: 0,
        recentMs: 0,
        totalMs: performance.now() - totalStartedAt,
        epochCount: 0,
        summaryChunks: 0,
        exactChunks: 0,
      },
    };
  }

  const epochBigInts = epochs.map((epoch) => BigInt(epoch));
  const summaryChunks: bigint[][] = [];
  for (let i = 0; i < epochBigInts.length; i += REBATE_SUMMARY_CHUNK_SIZE) {
    summaryChunks.push(epochBigInts.slice(i, i + REBATE_SUMMARY_CHUNK_SIZE));
  }
  const recentEpochBigInts = epochBigInts.slice(0, REBATE_DETAILS_LIMIT);
  const recentContracts = recentEpochBigInts.map((epoch) => ({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "getRebateInfo" as const,
    args: [epoch, user] as const,
  }));

  const summaryStartedAt = performance.now();
  const recentStartedAt = performance.now();
  const [summaryResults, recentResults] = await Promise.all([
    mapWithConcurrency(summaryChunks, REBATE_SUMMARY_CONCURRENCY, async (chunk) => {
      return await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "getRebateSummary",
        args: [user, chunk],
      }) as [bigint, bigint];
    }),
    recentContracts.length > 0
      ? publicClient.multicall({ contracts: recentContracts }) as Promise<
          Array<{ status: "success"; result: RebateInfoResult } | { status: "failure"; error: unknown; result?: undefined }>
        >
      : Promise.resolve([] as Array<{ status: "success"; result: RebateInfoResult } | { status: "failure"; error: unknown; result?: undefined }>),
  ]);
  const summaryMs = performance.now() - summaryStartedAt;

  let totalPendingWei = 0n;
  let summaryClaimableCount = 0;
  summaryResults.forEach(([pendingWei, claimableCount]) => {
    totalPendingWei += pendingWei;
    summaryClaimableCount += bigintToNonNegativeSafeNumber(claimableCount);
  });

  const claimableEpochList =
    includeExact && summaryClaimableCount > 0
      ? await (() => {
          const exactStartedAt = performance.now();
          return loadClaimableEpochsExact(user, epochBigInts).then((result) => {
            const exactMs = performance.now() - exactStartedAt;
            return { result, exactMs };
          });
        })()
      : { result: [], exactMs: 0 };

  const recentEpochs: RebateEpochInfo[] = [];

  recentResults.forEach((result, index) => {
    if (result.status !== "success") return;
    const epoch = parseRebateEpochNumber(recentEpochBigInts[index]);
    if (epoch === null) return;
    const [rebatePoolWei, userVolumeWei, pendingWei, claimed, resolved] = result.result;
    recentEpochs.push({
      epoch,
      pendingWei: pendingWei.toString(),
      pending: formatUnits(pendingWei, 18),
      claimed,
      resolved,
      userVolumeWei: userVolumeWei.toString(),
      rebatePoolWei: rebatePoolWei.toString(),
    });
  });
  const recentMs = performance.now() - recentStartedAt;

  const timings: RebateBuildTimings = {
    indexedMs,
    summaryMs,
    exactMs: claimableEpochList.exactMs,
    recentMs,
    totalMs: performance.now() - totalStartedAt,
    epochCount: epochs.length,
    summaryChunks: summaryChunks.length,
    exactChunks: Math.ceil(epochBigInts.length / REBATE_EXACT_CHUNK_SIZE),
  };

  if (timings.totalMs >= 800) {
    console.warn("[api/rebates] slow build", {
      epochCount: timings.epochCount,
      summaryChunks: timings.summaryChunks,
      exactChunks: timings.exactChunks,
      indexedMs: formatRebateTimingLogValue(timings.indexedMs),
      summaryMs: formatRebateTimingLogValue(timings.summaryMs),
      exactMs: formatRebateTimingLogValue(timings.exactMs),
      recentMs: formatRebateTimingLogValue(timings.recentMs),
      totalMs: formatRebateTimingLogValue(timings.totalMs),
    });
  }

  return {
    payload: {
      isSupported: true,
      pendingRebateWei: totalPendingWei.toString(),
      claimableEpochCount: includeExact ? claimableEpochList.result.length : summaryClaimableCount,
      claimableEpochList: claimableEpochList.result,
      totalEpochs: epochs.length,
      participatingEpochs: epochs,
      recentEpochs,
    },
    timings,
  };
}

export async function GET(request: NextRequest) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-rebates",
    limit: 20,
    windowMs: 60_000,
  });
  if (rateLimited) return applyNoStoreHeaders(rateLimited);

  const includeExact = request.nextUrl.searchParams.get("exact") === "1";
  if (includeExact) {
    const exactRateLimited = await enforceSharedRateLimit(request, {
      bucket: "api-rebates-exact",
      limit: 6,
      windowMs: 60_000,
    });
    if (exactRateLimited) return applyNoStoreHeaders(exactRateLimited);
  }

  const userParam = request.nextUrl.searchParams.get("user");
  if (!userParam) {
    return jsonNoStore({ error: "Missing ?user=0x..." }, 400);
  }

  let user: `0x${string}`;
  try {
    user = getAddress(userParam);
  } catch {
    return jsonNoStore({ error: "Missing or invalid ?user=0x..." }, 400);
  }

  const metric = beginRouteMetric(ROUTE_METRIC_KEY);
  const cacheKey = user.toLowerCase();
  const now = Date.now();
  const forceFresh = request.nextUrl.searchParams.has("refresh");
  const effectiveCacheKey = includeExact ? `${cacheKey}:exact` : cacheKey;
  const currentWatermark = getRebateDataWatermark();
  const cached = forceFresh ? null : rebateRouteCache.getFresh(effectiveCacheKey, now);
  if (cached) {
    markRouteCacheHit(ROUTE_METRIC_KEY);
    finishRouteMetric(metric, 200);
    return jsonNoStore(cached, 200, { cacheStatus: "fresh" });
  }
  const staleCache = rebateRouteCache.getStale(effectiveCacheKey);
  if (staleCache && !forceFresh) {
    markRouteStaleServed(ROUTE_METRIC_KEY);
    startRebateBackgroundRefresh(effectiveCacheKey, user, includeExact);
    finishRouteMetric(metric, 200);
    return jsonNoStore(staleCache, 200, { cacheStatus: "stale" });
  }

  try {
    const inflight = rebateRouteCache.getInflight(effectiveCacheKey);
    const result = inflight
      ? (markRouteInflightJoin(ROUTE_METRIC_KEY), { payload: await inflight, timings: null, cacheStatus: "inflight" as const })
      : await (() => {
          const { buildPromise } = startVersionedInflightBuild({
            cache: rebateRouteCache,
            cacheKey: effectiveCacheKey,
            ttlMs: REBATE_ROUTE_CACHE_MS,
            build: () => buildRebatePayload(user, { includeExact }),
            toPayload: ({ payload }) => payload,
            onCommit: () => {
              rebateCacheWatermarks.set(
                effectiveCacheKey,
                {
                  watermark: currentWatermark,
                  refreshedAt: Date.now(),
                },
                REBATE_UNCHANGED_WATERMARK_REFRESH_MS,
              );
            },
          });
          return buildPromise.then(({ payload, timings }) => ({
            payload,
            timings,
            cacheStatus: "miss" as const,
          }));
        })();

    finishRouteMetric(metric, 200);
    return jsonNoStore(result.payload, 200, {
      cacheStatus: result.cacheStatus,
      timings: result.timings,
    });
  } catch (err) {
    if (
      isMissingContractMethodError(err, "getRebateSummary") ||
      isMissingContractMethodError(err, "getRebateInfo") ||
      isMissingContractMethodError(err, "claimEpochsRebate")
    ) {
      finishRouteMetric(metric, 200);
      return jsonNoStore({
        isSupported: false,
        pendingRebateWei: "0",
        claimableEpochCount: 0,
        claimableEpochList: [],
        totalEpochs: 0,
        participatingEpochs: [],
        recentEpochs: [],
      }, 200, { cacheStatus: "miss" });
    }

    logRouteError(ROUTE_METRIC_KEY, err, { user });
    if (staleCache) {
      markRouteStaleServed(ROUTE_METRIC_KEY);
      finishRouteMetric(metric, 200);
      return jsonNoStore(staleCache, 200, { cacheStatus: "stale" });
    }
    failRouteMetric(metric, 500);
    return jsonNoStore({ error: "Unable to load Safety Pool" }, 500, { cacheStatus: "miss" });
  }
}
