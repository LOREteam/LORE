import { NextResponse } from "next/server";
import { formatUnits, parseAbi } from "viem";
import { DEFAULT_API_EPOCHS_RECONCILE_MAX } from "../../../config/publicConfig";
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
  patchFirebase,
  publicClient,
} from "../_lib/dataBridge";
import { logRouteError } from "../_lib/routeError";
import { enforceSharedRateLimit } from "../_lib/sharedRateLimit";
import { createRouteCache } from "../_lib/routeCache";
const MAX_CHAIN_RECONCILE_EPOCHS = Number(process.env.API_EPOCHS_RECONCILE_MAX ?? String(DEFAULT_API_EPOCHS_RECONCILE_MAX));
const EPOCHS_ROUTE_CACHE_MS = 15_000;
const EPOCHS_STALE_REFRESH_MS = 60_000;
const EPOCHS_CHAIN_MULTICALL_CHUNK = 96;
const EPOCHS_ROUTE_CACHE_MAX_KEYS = 256;
const CURRENT_EPOCH_CACHE_MS = 5_000;
const ROUTE_METRIC_KEY = "api/epochs";

const READ_ABI = parseAbi([
  "function epochs(uint256) view returns (uint256 totalPool, uint256 rewardPool, uint256 winningTile, bool isResolved, bool isDailyJackpot, bool isWeeklyJackpot)",
  "function currentEpoch() view returns (uint256)",
]);

type EpochRow = {
  winningTile: number;
  totalPool: string;
  rewardPool: string;
  fee?: string;
  jackpotBonus?: string;
  isDailyJackpot: boolean;
  isWeeklyJackpot: boolean;
  resolvedBlock?: string;
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

function jsonNoStore(payload: EpochPayload, status = 200) {
  return applyNoStoreHeaders(NextResponse.json(payload, { status }));
}

function compactEpochRows(rows: Record<string, EpochRow | null>): Record<string, EpochRow> {
  return Object.fromEntries(
    Object.entries(rows).filter(([, value]) => Boolean(value && typeof value === "object")),
  ) as Record<string, EpochRow>;
}

function parseRequestedEpochs(request: Request): number[] {
  const search = new URL(request.url).searchParams.get("epochs");
  if (!search) return [];
  return [...new Set(
    search
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0),
  )];
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
  if (currentEpochInflight) {
    return currentEpochInflight;
  }

  const storedCurrentEpoch = getMetaNumber("currentEpoch");
  currentEpochInflight = (async () => {
    try {
      const onChainCurrentEpoch = await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: READ_ABI,
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

function filterEpochRowsByCurrentEpoch(
  rows: Record<string, EpochRow>,
  currentEpoch: number | null,
) {
  if (!Number.isInteger(currentEpoch) || !currentEpoch || currentEpoch <= 0) {
    return rows;
  }

  return Object.fromEntries(
    Object.entries(rows).filter(([key, value]) => {
      const epoch = Number(key);
      if (!Number.isInteger(epoch) || epoch < 1 || epoch > currentEpoch) return false;
      const resolvedBlock = Number(value.resolvedBlock ?? "0");
      if (resolvedBlock > 0 && BigInt(resolvedBlock) < CONTRACT_DEPLOY_BLOCK) return false;
      return true;
    }),
  );
}

async function readResolvedEpochRowsFromChain(epochIds: number[]): Promise<Record<string, EpochRow>> {
  const normalizedIds = [...new Set(epochIds.filter((epoch) => Number.isInteger(epoch) && epoch > 0))];
  const patch: Record<string, EpochRow> = {};

  for (let i = 0; i < normalizedIds.length; i += EPOCHS_CHAIN_MULTICALL_CHUNK) {
    const chunk = normalizedIds.slice(i, i + EPOCHS_CHAIN_MULTICALL_CHUNK);
    const contracts = chunk.map((epoch) => ({
      address: CONTRACT_ADDRESS,
      abi: READ_ABI,
      functionName: "epochs" as const,
      args: [BigInt(epoch)] as const,
    }));

    try {
      const results = await publicClient.multicall({ contracts });
      results.forEach((result, index) => {
        if (result.status !== "success") return;
        const epoch = chunk[index];
        const row = result.result as [bigint, bigint, bigint, boolean, boolean, boolean];
        if (!row[3]) return;
        patch[String(epoch)] = {
          winningTile: Number(row[2]),
          totalPool: formatUnits(row[0], 18),
          rewardPool: formatUnits(row[1], 18),
          isDailyJackpot: row[4],
          isWeeklyJackpot: row[5],
        };
      });
    } catch {
      for (const epoch of chunk) {
        try {
          const row = (await publicClient.readContract({
            address: CONTRACT_ADDRESS,
            abi: READ_ABI,
            functionName: "epochs",
            args: [BigInt(epoch)],
          })) as [bigint, bigint, bigint, boolean, boolean, boolean];
          if (!row[3]) continue;
          patch[String(epoch)] = {
            winningTile: Number(row[2]),
            totalPool: formatUnits(row[0], 18),
            rewardPool: formatUnits(row[1], 18),
            isDailyJackpot: row[4],
            isWeeklyJackpot: row[5],
          };
        } catch {
          // ignore one failed epoch
        }
      }
    }
  }

  return patch;
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

  if (!Number.isInteger(currentEpoch) || !currentEpoch || currentEpoch <= 1) {
    return {
      payload: { epochs },
      refreshNeeded: false,
    };
  }

  const present = new Set<number>(
    Object.keys(epochs)
      .map((key) => Number(key))
      .filter((epoch) => Number.isInteger(epoch) && epoch > 0),
  );
  const missing: number[] = [];
  if (requestedEpochs.length > 0) {
    for (const epoch of requestedEpochs) {
      if (epoch < currentEpoch && !present.has(epoch)) {
        missing.push(epoch);
      }
    }
  } else {
    const reconcileStart = Math.max(1, currentEpoch - Math.max(1, MAX_CHAIN_RECONCILE_EPOCHS));
    for (let epoch = reconcileStart; epoch < currentEpoch; epoch += 1) {
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

  const target = missing.slice(-Math.max(1, MAX_CHAIN_RECONCILE_EPOCHS));
  const patch = await readResolvedEpochRowsFromChain(target);
  if (Object.keys(patch).length > 0) {
    await patchFirebase("gamedata/epochs", patch);
    epochs = {
      ...epochs,
      ...filterEpochRowsByCurrentEpoch(patch, currentEpoch),
    };
  }

  return {
    payload: { epochs },
    refreshNeeded: missing.length > Object.keys(patch).length,
  };
}

function startEpochsRefresh(cacheKey: string, requestedEpochs: number[]) {
  const existing = epochsRouteCache.getRefresh(cacheKey);
  if (existing || epochsRouteCache.getInflight(cacheKey)) return;

  markRouteBackgroundRefresh(ROUTE_METRIC_KEY);
  const writeVersion = epochsRouteCache.beginWrite(cacheKey);
  const refreshPromise = buildEpochsPayload(requestedEpochs, { allowChainReconcile: true })
    .then(({ payload }) => {
      epochsRouteCache.setIfLatest(cacheKey, payload, EPOCHS_STALE_REFRESH_MS, writeVersion);
    })
    .catch((error) => {
      logRouteError(ROUTE_METRIC_KEY, error, { phase: "background-refresh", requestedEpochs });
    })
    .finally(() => {
      epochsRouteCache.clearRefresh(cacheKey);
    });

  epochsRouteCache.setRefresh(cacheKey, refreshPromise);
}

export async function GET(request: Request) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-epochs",
    limit: 30,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const metric = beginRouteMetric(ROUTE_METRIC_KEY);
  const requestedEpochs = parseRequestedEpochs(request);
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
          const buildPromise = buildEpochsPayload(requestedEpochs, { allowChainReconcile: false });
          const requestPromise = buildPromise
            .then(({ payload }) => {
              return epochsRouteCache.setIfLatest(cacheKey, payload, EPOCHS_ROUTE_CACHE_MS, writeVersion);
            })
            .finally(() => {
              epochsRouteCache.clearInflight(cacheKey);
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
