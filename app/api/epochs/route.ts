import { NextResponse } from "next/server";
import { formatUnits } from "viem";
import { GAME_ABI as READ_ABI } from "../../../config/generated/lineaOreV10Abi";
import { DEFAULT_API_EPOCHS_RECONCILE_MAX } from "../../../config/publicConfig";
import { parseOptionalPositiveIntegerEnv } from "../../../config/envParsing";
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
import { getEpochMap, getEpochMapByIds, getMetaNumber } from "../../../server/storage";
import {
  CONTRACT_ADDRESS,
  CONTRACT_DEPLOY_BLOCK,
  isSafePositiveInteger,
  publicClient,
} from "../_lib/dataBridge";
import { logRouteError } from "../_lib/routeError";
import { enforceSharedRateLimit } from "../_lib/sharedRateLimit";
import { createRouteCache } from "../_lib/routeCache";
import { parsePositiveIntegerParam } from "../_lib/queryParams";
import { parseReadModelEpochNumber, parseReadModelTileId } from "../_lib/readModelSafety";
import { parseRequestedEpochsParam, type RequestedEpochsParseResult } from "../live-state/runtimePolicy";
import {
  isRecoveryContextCurrent,
  loadFinalizedRecoveryContext,
  type FinalizedRecoveryContext,
} from "../_lib/jackpotsService";
const MAX_CHAIN_RECONCILE_EPOCHS = parseOptionalPositiveIntegerEnv(
  process.env.API_EPOCHS_RECONCILE_MAX,
  DEFAULT_API_EPOCHS_RECONCILE_MAX,
);
const EPOCHS_ROUTE_CACHE_MS = 15_000;
const EPOCHS_STALE_REFRESH_MS = 60_000;
const EPOCHS_CHAIN_MULTICALL_CHUNK = 96;
const EPOCHS_ROUTE_CACHE_MAX_KEYS = 256;
const MAX_REQUESTED_EPOCHS = 100;
const CURRENT_EPOCH_CACHE_MS = 5_000;
const ROUTE_METRIC_KEY = "api/epochs";

type EpochRow = {
  winningTile: number;
  totalPool: string;
  rewardPool: string;
  fee?: string;
  jackpotBonus?: string;
  isDailyJackpot: boolean;
  isWeeklyJackpot: boolean;
  resolvedBlock?: string;
  endTime?: string;
};

type EpochPayload = { epochs: Record<string, EpochRow>; error?: string };
type EpochBuildOptions = {
  allowChainReconcile?: boolean;
};
type EpochBuildResult = {
  payload: EpochPayload;
  refreshNeeded: boolean;
};
const epochsRouteCache = createRouteCache<EpochPayload>(EPOCHS_ROUTE_CACHE_MAX_KEYS);
let currentEpochCache: { value: number | null; expiresAt: number } | null = null;
let currentEpochInflight: Promise<number | null> | null = null;
let currentEpochBackgroundRefresh: Promise<void> | null = null;

function jsonNoStore(payload: EpochPayload, status = 200) {
  return applyNoStoreHeaders(NextResponse.json(payload, { status }));
}

function compactEpochRows(rows: Record<string, EpochRow | null>): Record<string, EpochRow> {
  return Object.fromEntries(
    Object.entries(rows).filter(([, value]) => Boolean(value && typeof value === "object")),
  ) as Record<string, EpochRow>;
}

function parseRequestedEpochs(request: Request): RequestedEpochsParseResult {
  const search = new URL(request.url).searchParams.get("epochs");
  return parseRequestedEpochsParam(search, parsePositiveIntegerParam, MAX_REQUESTED_EPOCHS);
}

function getCacheKey(requestedEpochs: number[]) {
  if (requestedEpochs.length === 0) return "*";
  return requestedEpochs.slice().sort((a, b) => a - b).join(",");
}

async function resolveCachedCurrentEpoch(): Promise<number | null> {
  const now = Date.now();
  if (currentEpochCache && currentEpochCache.expiresAt > now) {
    return currentEpochCache.value;
  }

  const storedCurrentEpoch = getMetaNumber("currentEpoch");
  const storedCurrentEpochNumber = storedCurrentEpoch ?? 0;
  if (isSafePositiveInteger(storedCurrentEpochNumber)) {
    currentEpochCache = {
      value: storedCurrentEpochNumber,
      expiresAt: now + CURRENT_EPOCH_CACHE_MS,
    };

    if (!currentEpochBackgroundRefresh) {
      currentEpochBackgroundRefresh = (async () => {
        try {
          const onChainCurrentEpoch = await publicClient.readContract({
            address: CONTRACT_ADDRESS,
            abi: READ_ABI,
            functionName: "currentEpoch",
          });
          const onChainCurrentEpochNum = parseReadModelEpochNumber(onChainCurrentEpoch);
          if (
            onChainCurrentEpochNum !== null &&
            onChainCurrentEpochNum >= storedCurrentEpochNumber
          ) {
            currentEpochCache = {
              value: onChainCurrentEpochNum,
              expiresAt: Date.now() + CURRENT_EPOCH_CACHE_MS,
            };
          }
        } catch {
          // Keep serving the indexed epoch when RPC is slow or unavailable.
        } finally {
          currentEpochBackgroundRefresh = null;
        }
      })();
    }

    return storedCurrentEpochNumber;
  }

  if (currentEpochInflight) {
    return currentEpochInflight;
  }

  currentEpochInflight = (async () => {
    try {
      const onChainCurrentEpoch = await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: READ_ABI,
        functionName: "currentEpoch",
      });
      const onChainCurrentEpochNum = parseReadModelEpochNumber(onChainCurrentEpoch);
      if (onChainCurrentEpochNum !== null) {
        currentEpochCache = {
          value: onChainCurrentEpochNum,
          expiresAt: Date.now() + CURRENT_EPOCH_CACHE_MS,
        };
        return onChainCurrentEpochNum;
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

function filterEpochRowsByCurrentEpoch(
  rows: Record<string, EpochRow>,
  currentEpoch: number | null,
) {
  if (!isSafePositiveInteger(currentEpoch ?? 0)) {
    return rows;
  }
  const currentEpochNumber = currentEpoch ?? 0;

  return Object.fromEntries(
    Object.entries(rows).filter(([key, value]) => {
      const epoch = parseReadModelEpochNumber(key);
      if (epoch === null || epoch > currentEpochNumber) return false;
      const resolvedBlock = value.resolvedBlock ?? "0";
      if (/^\d+$/.test(resolvedBlock) && BigInt(resolvedBlock) > 0n && BigInt(resolvedBlock) < CONTRACT_DEPLOY_BLOCK) return false;
      return true;
    }),
  );
}

async function readEpochRowsFromChain(
  epochIds: number[],
  context: FinalizedRecoveryContext,
): Promise<Record<string, EpochRow>> {
  const normalizedIds = [...new Set(epochIds.filter(isSafePositiveInteger))];
  const responseRows: Record<string, EpochRow> = {};

  for (let i = 0; i < normalizedIds.length; i += EPOCHS_CHAIN_MULTICALL_CHUNK) {
    const chunk = normalizedIds.slice(i, i + EPOCHS_CHAIN_MULTICALL_CHUNK);
    const epochContracts = chunk.map((epoch) => ({
      address: CONTRACT_ADDRESS,
      abi: READ_ABI,
      functionName: "epochs" as const,
      args: [BigInt(epoch)] as const,
    }));
    try {
      const epochResults = await publicClient.multicall({
        contracts: epochContracts,
        blockNumber: context.blockNumber,
      });
      chunk.forEach((epoch, index) => {
        const result = epochResults[index];
        if (result?.status !== "success") return;
        const row = result.result as [bigint, bigint, bigint, boolean, boolean, boolean];
        const winningTile = parseReadModelTileId(row[2]);
        if (!row[3] || winningTile === null) return;
        const epochRow: EpochRow = {
          winningTile,
          totalPool: formatUnits(row[0], 18),
          rewardPool: formatUnits(row[1], 18),
          isDailyJackpot: row[4],
          isWeeklyJackpot: row[5],
          resolvedBlock: context.blockNumber.toString(),
        };
        responseRows[String(epoch)] = epochRow;
      });
    } catch {
      for (const epoch of chunk) {
        try {
          const row = await publicClient.readContract({
            address: CONTRACT_ADDRESS,
            abi: READ_ABI,
            functionName: "epochs",
            args: [BigInt(epoch)],
            blockNumber: context.blockNumber,
          }) as [bigint, bigint, bigint, boolean, boolean, boolean];
          const winningTile = parseReadModelTileId(row[2]);
          if (!row[3] || winningTile === null) continue;
          const epochRow: EpochRow = {
            winningTile,
            totalPool: formatUnits(row[0], 18),
            rewardPool: formatUnits(row[1], 18),
            isDailyJackpot: row[4],
            isWeeklyJackpot: row[5],
            resolvedBlock: context.blockNumber.toString(),
          };
          responseRows[String(epoch)] = epochRow;
        } catch {
          // ignore one failed epoch
        }
      }
    }
  }

  return responseRows;
}

async function buildEpochsPayload(
  requestedEpochs: number[],
  options: EpochBuildOptions = {},
): Promise<EpochBuildResult> {
  const currentEpoch =
    requestedEpochs.length === 0
      ? await resolveCachedCurrentEpoch()
      : getMetaNumber("currentEpoch");
  const raw =
    requestedEpochs.length === 0
      ? (getEpochMap() as Record<string, EpochRow | null>)
      : (getEpochMapByIds(requestedEpochs) as Record<string, EpochRow | null>);
  let epochs = filterEpochRowsByCurrentEpoch(compactEpochRows(raw), currentEpoch);

  const currentEpochNumber = currentEpoch ?? 0;
  if (!isSafePositiveInteger(currentEpochNumber) || currentEpochNumber <= 1) {
    return {
      payload: { epochs },
      refreshNeeded: false,
    };
  }

  const present = new Set<number>(
    Object.keys(epochs)
      .flatMap((key) => {
        const epoch = parseReadModelEpochNumber(key);
        return epoch === null ? [] : [epoch];
      }),
  );
  const missing: number[] = [];
  if (requestedEpochs.length > 0) {
    for (const epoch of requestedEpochs) {
      if (epoch < currentEpochNumber && !present.has(epoch)) {
        missing.push(epoch);
      }
    }
  } else {
    const reconcileStart = Math.max(1, currentEpochNumber - Math.max(1, MAX_CHAIN_RECONCILE_EPOCHS));
    for (let epoch = reconcileStart; epoch < currentEpochNumber; epoch += 1) {
      if (!present.has(epoch)) {
        missing.push(epoch);
      }
    }
  }

  if (missing.length === 0) {
    return {
      payload: { epochs },
      refreshNeeded: false,
    };
  }

  if (!options.allowChainReconcile) {
    return {
      payload: { epochs },
      refreshNeeded: true,
    };
  }

  const recoveryContext = await loadFinalizedRecoveryContext();
  if (recoveryContext === null) {
    return {
      payload: { epochs },
      refreshNeeded: true,
    };
  }
  const finalizedCurrentEpoch = parseReadModelEpochNumber(await publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi: READ_ABI,
    functionName: "currentEpoch",
    blockNumber: recoveryContext.blockNumber,
  }));
  if (finalizedCurrentEpoch === null) {
    return {
      payload: { epochs },
      refreshNeeded: true,
    };
  }
  const target = missing
    .filter((epoch) => epoch < finalizedCurrentEpoch)
    .slice(-Math.max(1, MAX_CHAIN_RECONCILE_EPOCHS));
  if (target.length === 0) {
    return {
      payload: { epochs },
      refreshNeeded: true,
    };
  }
  const responseRows = await readEpochRowsFromChain(target, recoveryContext);
  if (!(await isRecoveryContextCurrent(recoveryContext))) {
    return {
      payload: { epochs },
      refreshNeeded: true,
    };
  }
  if (Object.keys(responseRows).length > 0) {
    epochs = {
      ...epochs,
      ...filterEpochRowsByCurrentEpoch(responseRows, currentEpoch),
    };
  }

  return {
    payload: { epochs },
    refreshNeeded: missing.length > Object.keys(responseRows).length,
  };
}

function startEpochsRefresh(cacheKey: string, requestedEpochs: number[]) {
  const existing = epochsRouteCache.getRefresh(cacheKey);
  if (existing || epochsRouteCache.getInflight(cacheKey)) return;

  markRouteBackgroundRefresh(ROUTE_METRIC_KEY);
  const writeVersion = epochsRouteCache.beginWrite(cacheKey);
  const refreshPromise: Promise<void> = buildEpochsPayload(requestedEpochs, { allowChainReconcile: true })
    .then(({ payload }) => {
      epochsRouteCache.setIfLatest(cacheKey, payload, EPOCHS_STALE_REFRESH_MS, writeVersion);
    })
    .catch((error) => {
      logRouteError(ROUTE_METRIC_KEY, error, { phase: "background-refresh", requestedEpochs });
    })
    .finally(() => {
      epochsRouteCache.finishWrite(cacheKey, writeVersion);
      epochsRouteCache.clearRefresh(cacheKey, refreshPromise);
    });

  epochsRouteCache.setRefresh(cacheKey, refreshPromise);
}

export async function GET(request: Request) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-epochs",
    limit: 30,
    windowMs: 60_000,
  });
  if (rateLimited) return applyNoStoreHeaders(rateLimited);

  const metric = beginRouteMetric(ROUTE_METRIC_KEY);
  const parsedRequestedEpochs = parseRequestedEpochs(request);
  if (!parsedRequestedEpochs.ok) {
    failRouteMetric(metric, 400);
    return jsonNoStore({ epochs: {}, error: parsedRequestedEpochs.error }, 400);
  }
  const requestedEpochs = parsedRequestedEpochs.epochs;
  const cacheKey = getCacheKey(requestedEpochs);
  const now = Date.now();
  const cached = epochsRouteCache.getFresh(cacheKey, now);
  if (cached) {
    markRouteCacheHit(ROUTE_METRIC_KEY);
    finishRouteMetric(metric, 200);
    return jsonNoStore(cached);
  }

  const staleCache = epochsRouteCache.getStale(cacheKey);
  if (staleCache) {
    markRouteStaleServed(ROUTE_METRIC_KEY);
    startEpochsRefresh(cacheKey, requestedEpochs);
    finishRouteMetric(metric, 200);
    return jsonNoStore(staleCache);
  }

  try {
    const inflight = epochsRouteCache.getInflight(cacheKey);
    const result = inflight
      ? (markRouteInflightJoin(ROUTE_METRIC_KEY), { payload: await inflight, refreshNeeded: false })
      : await (() => {
          const writeVersion = epochsRouteCache.beginWrite(cacheKey);
          const buildPromise = buildEpochsPayload(requestedEpochs, {
            allowChainReconcile: requestedEpochs.length > 0,
          });
          const requestPromise: Promise<EpochPayload> = buildPromise
            .then(({ payload }) => {
              return epochsRouteCache.setIfLatest(cacheKey, payload, EPOCHS_ROUTE_CACHE_MS, writeVersion);
            })
            .finally(() => {
              epochsRouteCache.finishWrite(cacheKey, writeVersion);
              epochsRouteCache.clearInflight(cacheKey, requestPromise);
            });
          epochsRouteCache.setInflight(cacheKey, requestPromise);
          return buildPromise;
        })();

    if (result.refreshNeeded) {
      startEpochsRefresh(cacheKey, requestedEpochs);
    }

    finishRouteMetric(metric, 200);
    return jsonNoStore(result.payload);
  } catch (err) {
    logRouteError(ROUTE_METRIC_KEY, err, { requestedEpochs });
    if (staleCache) {
      markRouteStaleServed(ROUTE_METRIC_KEY);
      finishRouteMetric(metric, 200);
      return jsonNoStore(staleCache);
    }
    failRouteMetric(metric, 500);
    return jsonNoStore({ epochs: {}, error: "fetch failed" }, 500);
  }
}
