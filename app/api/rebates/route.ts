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
import { CONTRACT_ADDRESS, publicClient } from "../_lib/dataBridge";
import { CONTRACT_HAS_REBATE_API, GAME_ABI } from "../../lib/constants";
import { createRouteCache } from "../_lib/routeCache";
import { logRouteError } from "../_lib/routeError";
import { getUserParticipatingEpochs } from "../../../server/storage";

const REBATE_ROUTE_CACHE_MS = 15_000;
const REBATE_SUMMARY_CHUNK_SIZE = 96;
const REBATE_EXACT_CHUNK_SIZE = 48;
const REBATE_DETAILS_LIMIT = 8;
const REBATE_ROUTE_CACHE_MAX_KEYS = 512;
const REBATE_SUMMARY_CONCURRENCY = 6;
const REBATE_EXACT_CONCURRENCY = 6;
const ROUTE_METRIC_KEY = "api/rebates";

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

const rebateRouteCache = createRouteCache<RebatePayload>(REBATE_ROUTE_CACHE_MAX_KEYS);

function formatServerTiming(params: {
  cacheStatus: "fresh" | "stale" | "miss" | "inflight";
  timings?: RebateBuildTimings | null;
}) {
  const { cacheStatus, timings } = params;
  const metrics = [`cache;desc="${cacheStatus}"`];
  if (timings) {
    metrics.push(`indexed;dur=${timings.indexedMs.toFixed(1)}`);
    metrics.push(`summary;dur=${timings.summaryMs.toFixed(1)}`);
    metrics.push(`exact;dur=${timings.exactMs.toFixed(1)}`);
    metrics.push(`recent;dur=${timings.recentMs.toFixed(1)}`);
    metrics.push(`total;dur=${timings.totalMs.toFixed(1)}`);
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
  return getUserParticipatingEpochs(user, 5000);
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
          claimable.add(Number(chunk[index]));
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
            claimable.add(Number(epoch));
          }
        } catch {
          // ignore per-epoch read failures here
        }
      }
    }
  });

  return [...claimable].sort((a, b) => b - a);
}

async function buildRebatePayload(user: `0x${string}`): Promise<{ payload: RebatePayload; timings: RebateBuildTimings }> {
  const totalStartedAt = performance.now();
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
  const epochs = await getIndexedEpochs(user);
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

  const summaryStartedAt = performance.now();
  const summaryResults = await mapWithConcurrency(summaryChunks, REBATE_SUMMARY_CONCURRENCY, async (chunk) => {
    return await publicClient.readContract({
      address: CONTRACT_ADDRESS,
      abi: GAME_ABI,
      functionName: "getRebateSummary",
      args: [user, chunk],
    }) as [bigint, bigint];
  });
  const summaryMs = performance.now() - summaryStartedAt;

  let totalPendingWei = 0n;
  let summaryClaimableCount = 0;
  summaryResults.forEach(([pendingWei, claimableCount]) => {
    totalPendingWei += pendingWei;
    summaryClaimableCount += Number(claimableCount);
  });

  const claimableEpochList =
    summaryClaimableCount > 0
      ? await (() => {
          const exactStartedAt = performance.now();
          return loadClaimableEpochsExact(user, epochBigInts).then((result) => {
            const exactMs = performance.now() - exactStartedAt;
            return { result, exactMs };
          });
        })()
      : { result: [], exactMs: 0 };

  const recentStartedAt = performance.now();
  const recentEpochBigInts = epochBigInts.slice(0, REBATE_DETAILS_LIMIT);
  const recentContracts = recentEpochBigInts.map((epoch) => ({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "getRebateInfo" as const,
    args: [epoch, user] as const,
  }));
  const recentResults = await publicClient.multicall({ contracts: recentContracts });
  const recentEpochs: RebateEpochInfo[] = [];

  recentResults.forEach((result, index) => {
    if (result.status !== "success") return;
    const epoch = Number(recentEpochBigInts[index]);
    const [rebatePoolWei, userVolumeWei, pendingWei, claimed, resolved] = result.result as [
      bigint,
      bigint,
      bigint,
      boolean,
      boolean,
    ];
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
      user,
      epochCount: timings.epochCount,
      summaryChunks: timings.summaryChunks,
      exactChunks: timings.exactChunks,
      indexedMs: Number(timings.indexedMs.toFixed(1)),
      summaryMs: Number(timings.summaryMs.toFixed(1)),
      exactMs: Number(timings.exactMs.toFixed(1)),
      recentMs: Number(timings.recentMs.toFixed(1)),
      totalMs: Number(timings.totalMs.toFixed(1)),
    });
  }

  return {
    payload: {
      isSupported: true,
      pendingRebateWei: totalPendingWei.toString(),
      claimableEpochCount: claimableEpochList.result.length,
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
  if (rateLimited) return rateLimited;

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
  const cached = forceFresh ? null : rebateRouteCache.getFresh(cacheKey, now);
  if (cached) {
    markRouteCacheHit(ROUTE_METRIC_KEY);
    finishRouteMetric(metric, 200);
    return jsonNoStore(cached, 200, { cacheStatus: "fresh" });
  }
  const staleCache = rebateRouteCache.getStale(cacheKey);

  try {
    const inflight = forceFresh ? null : rebateRouteCache.getInflight(cacheKey);
    const result = inflight
      ? (markRouteInflightJoin(ROUTE_METRIC_KEY), { payload: await inflight, timings: null, cacheStatus: "inflight" as const })
      : await (() => {
          const writeVersion = rebateRouteCache.beginWrite(cacheKey);
          const buildPromise = buildRebatePayload(user);
          const requestPromise = buildPromise
            .then(({ payload }) => {
              return rebateRouteCache.setIfLatest(cacheKey, payload, REBATE_ROUTE_CACHE_MS, writeVersion);
            })
            .finally(() => {
              rebateRouteCache.clearInflight(cacheKey);
            });
          rebateRouteCache.setInflight(cacheKey, requestPromise);
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
    const message = err instanceof Error ? err.message : "fetch failed";
    failRouteMetric(metric, 500);
    return jsonNoStore({ error: message }, 500, { cacheStatus: "miss" });
  }
}
