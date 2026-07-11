import { decodeEventLog, encodeEventTopics, parseAbi, toHex } from "viem";
import {
  publicClient,
  CONTRACT_ADDRESS,
  CONTRACT_DEPLOY_BLOCK,
  isSafePositiveInteger,
} from "../_lib/dataBridge";
import { parseLineaAmountWei } from "../../lib/tokenAmountMath";
import { tileMaskToTileIds } from "../../lib/tileMask";
import {
  getBetJackpotContributionsWeiAfterBlocks,
  getEpochMapByIds,
  getEpochTilePoolsWei,
  getEpochTileUserCounts,
  getEpochTileUserSets,
  getMetaBigInt,
  getMetaJson,
  getMetaNumber,
  getRecentJackpots,
  setMetaJson,
} from "../../../server/storage";

const LIVE_STATE_RPC_TIMEOUT_MS = 15_000;
const LIVE_STATE_TILE_USER_COUNTS_TIMEOUT_MS = 3_000;
const LIVE_STATE_LOG_SCAN_CHUNK = 10_000n;
const LIVE_STATE_LOG_SCAN_MIN_CHUNK = 2_000n;
const LIVE_STATE_SNAPSHOT_META_KEY = "snapshot:live-state:v1";
const LIVE_STATE_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const LIVE_STATE_SNAPSHOT_CACHE_MS = 2_000;

export const LIVE_STATE_ABI = parseAbi([
  "function currentEpoch() view returns (uint256)",
  "function getEpochEndTime(uint256 epoch) view returns (uint256)",
  "function getJackpotInfo() view returns (uint256 dailyPool, uint256 weeklyPool, uint256 lastDailyDay, uint256 lastWeeklyWeek, uint256 lastDailyEpoch, uint256 lastWeeklyEpoch, uint256 lastDailyAmount, uint256 lastWeeklyAmount)",
  "function rolloverPool() view returns (uint256)",
  "function epochs(uint256) view returns (uint256 totalPool, uint256 rewardPool, uint256 winningTile, bool isResolved, bool isDailyJackpot, bool isWeeklyJackpot)",
  "function getTileData(uint256 epoch) view returns (uint256[] pools, uint256[] users)",
  "function epochDuration() view returns (uint256)",
  "function pendingEpochDuration() view returns (uint256)",
  "function pendingEpochDurationEta() view returns (uint256)",
  "function pendingEpochDurationEffectiveFromEpoch() view returns (uint256)",
]);

const LIVE_STATE_EVENTS_ABI = parseAbi([
  "event BetPlaced(uint256 indexed epoch, address indexed user, uint256 indexed tileId, uint256 amount)",
  "event BatchBetsPlaced(uint256 indexed epoch, address indexed user, uint256[] tileIds, uint256[] amounts, uint256 totalAmount)",
  "event BatchBetsSameAmountPlaced(uint256 indexed epoch, address indexed user, uint256[] tileIds, uint256 amount, uint256 totalAmount)",
  "event BatchBetsBitmapPlaced(uint256 indexed epoch, address indexed user, uint32 tileMask, uint256 amount, uint256 totalAmount)",
]);
const [betPlacedSig] = encodeEventTopics({ abi: LIVE_STATE_EVENTS_ABI, eventName: "BetPlaced" });
const [batchPlacedSig] = encodeEventTopics({ abi: LIVE_STATE_EVENTS_ABI, eventName: "BatchBetsPlaced" });
const [batchSameAmountPlacedSig] = encodeEventTopics({
  abi: LIVE_STATE_EVENTS_ABI,
  eventName: "BatchBetsSameAmountPlaced",
});
const [batchBitmapPlacedSig] = encodeEventTopics({
  abi: LIVE_STATE_EVENTS_ABI,
  eventName: "BatchBetsBitmapPlaced",
});

export type LiveStatePayload = {
  currentEpoch: string;
  epochEndTime: string | null;
  jackpotInfo: string[] | null;
  rolloverPool: string | null;
  currentEpochData: [string, string, string, boolean, boolean, boolean] | null;
  tileData: { pools: string[]; users: string[] } | null;
  tileUserCounts: number[] | null;
  indexedTilePools: string[] | null;
  epochDuration: string | null;
  pendingEpochDuration: string | null;
  pendingEpochDurationEta: string | null;
  pendingEpochDurationEffectiveFromEpoch: string | null;
  fetchedAt: number;
};

type LiveStateSnapshotEnvelope = {
  payload: LiveStatePayload;
  savedAt: number;
};

type CachedStoredBootstrap = {
  payload: LiveStatePayload | null;
  watermark: string | null;
};

type CachedLiveStateSnapshot = {
  payload: LiveStatePayload | null;
  savedAt: number | null;
  loadedAt: number;
};

type LiveStateEpochTuple = [bigint, bigint, bigint, boolean, boolean, boolean];
type LiveStateTileTuple = [bigint[], bigint[]];
type LiveStateJackpotTuple = [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

let storedBootstrapCache: CachedStoredBootstrap | null = null;
let lastLiveStateSnapshotSignature: string | null = null;
let liveStateSnapshotCache: CachedLiveStateSnapshot | null = null;

function isTooManyResultsError(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    message.includes("more than 10000 results") ||
    message.includes("query returned more than 10000 results") ||
    (message.includes("range") && message.includes("exceeds limit")) ||
    message.includes("request exceeds defined limit")
  );
}

async function getLogsChunked(
  request: Omit<Parameters<typeof publicClient.getLogs>[0], "fromBlock" | "toBlock"> & {
    fromBlock: bigint;
    toBlock: bigint;
  },
) {
  const all: Awaited<ReturnType<typeof publicClient.getLogs>> = [];
  let cursor = request.fromBlock;
  let chunkSize = LIVE_STATE_LOG_SCAN_CHUNK;

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
      if (chunkSize < LIVE_STATE_LOG_SCAN_CHUNK) {
        chunkSize =
          chunkSize * 2n > LIVE_STATE_LOG_SCAN_CHUNK ? LIVE_STATE_LOG_SCAN_CHUNK : chunkSize * 2n;
      }
    } catch (err) {
      if (!isTooManyResultsError(err) || chunkSize <= LIVE_STATE_LOG_SCAN_MIN_CHUNK) {
        throw err;
      }
      chunkSize = chunkSize / 2n;
    }
  }

  return all;
}

function hasAnyPositivePool(tileData: LiveStateTileTuple | null) {
  return Boolean(tileData?.[0]?.some((value) => value > 0n));
}

function hasAnyPositiveCount(counts: number[] | null) {
  return Boolean(counts?.some((value) => Number.isFinite(value) && value > 0));
}

function parseStoredBlockNumber(value: string | null | undefined): bigint {
  if (!value || !/^\d+$/.test(value)) return 0n;
  return BigInt(value);
}

async function fetchEpochTileUserCountsFromChain(
  epoch: bigint,
  fromBlock: bigint,
  toBlock: bigint,
  seedTileUsers?: Set<string>[],
  gridSize = 25,
) {
  const epochTopic = toHex(epoch, { size: 32 });
  const perTile = Array.from(
    { length: gridSize },
    (_, index) => new Set(seedTileUsers?.[index] ?? []),
  );

  const appendUsers = (
    users: string[],
    tileIds: number[],
  ) => {
    for (const user of users) {
      const normalizedUser = user.trim().toLowerCase();
      if (!normalizedUser) continue;
      for (const tileId of tileIds) {
        const tileIndex = tileId - 1;
        if (tileIndex >= 0 && tileIndex < gridSize) {
          perTile[tileIndex].add(normalizedUser);
        }
      }
    }
  };

  const decodeTileLog = (
    log: Awaited<ReturnType<typeof publicClient.getLogs>>[number],
  ) => {
    const decoded = decodeEventLog({
      abi: LIVE_STATE_EVENTS_ABI,
      data: log.data,
      topics: log.topics,
    });
    if (decoded.eventName === "BetPlaced") {
      const args = decoded.args as { user: string; tileId: bigint };
      appendUsers([args.user], [Number(args.tileId)]);
      return;
    }
    if (decoded.eventName === "BatchBetsPlaced") {
      const args = decoded.args as { user: string; tileIds: readonly bigint[] };
      appendUsers([args.user], args.tileIds.map((tileId) => Number(tileId)));
      return;
    }
    if (decoded.eventName === "BatchBetsSameAmountPlaced") {
      const args = decoded.args as { user: string; tileIds: readonly bigint[] };
      appendUsers([args.user], args.tileIds.map((tileId) => Number(tileId)));
      return;
    }
    if (decoded.eventName === "BatchBetsBitmapPlaced") {
      const args = decoded.args as { user: string; tileMask: number };
      appendUsers([args.user], tileMaskToTileIds(args.tileMask));
    }
  };

  for (const topic0 of [betPlacedSig, batchPlacedSig, batchSameAmountPlacedSig, batchBitmapPlacedSig]) {
    const logs = await getLogsChunked({
      address: CONTRACT_ADDRESS,
      topics: [topic0, epochTopic],
      fromBlock,
      toBlock,
    } as Parameters<typeof publicClient.getLogs>[0] & { fromBlock: bigint; toBlock: bigint });
    for (const log of logs) {
      try {
        decodeTileLog(log);
      } catch {
        // Ignore malformed logs and keep best-effort tile counts.
      }
    }
  }

  return perTile.map((set) => set.size);
}

function createTimeoutError(label: string, timeoutMs: number) {
  return new Error(`live-state ${label} timed out after ${timeoutMs}ms`);
}

async function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = LIVE_STATE_RPC_TIMEOUT_MS,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(createTimeoutError(label, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function readLiveStateContract<T>(label: string, promise: Promise<T>) {
  return withTimeout(promise, label);
}

export function loadLiveStateSnapshot(maxAgeMs = LIVE_STATE_SNAPSHOT_MAX_AGE_MS): LiveStatePayload | null {
  const now = Date.now();
  if (liveStateSnapshotCache && now - liveStateSnapshotCache.loadedAt <= LIVE_STATE_SNAPSHOT_CACHE_MS) {
    if (
      Number.isFinite(maxAgeMs) &&
      liveStateSnapshotCache.savedAt != null &&
      now - liveStateSnapshotCache.savedAt > maxAgeMs
    ) {
      return null;
    }
    return liveStateSnapshotCache.payload;
  }

  const snapshot = getMetaJson<LiveStateSnapshotEnvelope | LiveStatePayload>(LIVE_STATE_SNAPSHOT_META_KEY);
  if (!snapshot) {
    liveStateSnapshotCache = {
      payload: null,
      savedAt: null,
      loadedAt: now,
    };
    return null;
  }
  if ("payload" in snapshot) {
    if (
      Number.isFinite(maxAgeMs) &&
      (typeof snapshot.savedAt !== "number" || now - snapshot.savedAt > maxAgeMs)
    ) {
      liveStateSnapshotCache = {
        payload: null,
        savedAt: typeof snapshot.savedAt === "number" ? snapshot.savedAt : null,
        loadedAt: now,
      };
      return null;
    }
    lastLiveStateSnapshotSignature = getLiveStateSnapshotSignature(snapshot.payload);
    liveStateSnapshotCache = {
      payload: snapshot.payload,
      savedAt: typeof snapshot.savedAt === "number" ? snapshot.savedAt : null,
      loadedAt: now,
    };
    return snapshot.payload;
  }
  lastLiveStateSnapshotSignature = getLiveStateSnapshotSignature(snapshot);
  liveStateSnapshotCache = {
    payload: snapshot,
    savedAt: null,
    loadedAt: now,
  };
  return snapshot;
}

function getLiveStateSnapshotSignature(payload: LiveStatePayload | null) {
  if (!payload) return "";
  const { fetchedAt, ...stablePayload } = payload;
  void fetchedAt;
  return JSON.stringify(stablePayload);
}

export function saveLiveStateSnapshot(payload: LiveStatePayload) {
  const signature = getLiveStateSnapshotSignature(payload);
  const savedAt = Date.now();
  if (lastLiveStateSnapshotSignature === signature) {
    liveStateSnapshotCache = {
      payload,
      savedAt,
      loadedAt: savedAt,
    };
    setMetaJson(LIVE_STATE_SNAPSHOT_META_KEY, {
      payload,
      savedAt,
    });
    return;
  }
  lastLiveStateSnapshotSignature = signature;
  liveStateSnapshotCache = {
    payload,
    savedAt,
    loadedAt: savedAt,
  };
  setMetaJson(LIVE_STATE_SNAPSHOT_META_KEY, {
    payload,
    savedAt,
  });
}

function getStoredLiveStateBootstrapWatermark(recentJackpots = getRecentJackpots(8)) {
  const currentEpoch = getMetaNumber("currentEpoch");
  const lastIndexedBlock = getMetaBigInt("lastIndexedBlock")?.toString() ?? "null";
  const latestDaily = recentJackpots.find((row) => row.kind === "daily") ?? null;
  const latestWeekly = recentJackpots.find((row) => row.kind === "weekly") ?? null;
  return [
    isSafePositiveInteger(currentEpoch ?? 0) ? String(currentEpoch) : "null",
    lastIndexedBlock,
    latestDaily ? `d:${latestDaily.epoch}:${latestDaily.blockNumber}` : "d:none",
    latestWeekly ? `w:${latestWeekly.epoch}:${latestWeekly.blockNumber}` : "w:none",
  ].join("|");
}

function buildStoredJackpotInfoFallback(snapshot: LiveStatePayload | null, recentJackpots = getRecentJackpots(64)) {
  if (snapshot?.jackpotInfo && snapshot.jackpotInfo.length === 8) {
    return snapshot.jackpotInfo;
  }

  const latestDaily = recentJackpots.find((row) => row.kind === "daily") ?? null;
  const latestWeekly = recentJackpots.find((row) => row.kind === "weekly") ?? null;

  let dailyPoolWei = 0n;
  let weeklyPoolWei = 0n;
  const lastDailyBlock = latestDaily ? parseStoredBlockNumber(latestDaily.blockNumber) : 0n;
  const lastWeeklyBlock = latestWeekly ? parseStoredBlockNumber(latestWeekly.blockNumber) : 0n;

  const jackpotContributions = getBetJackpotContributionsWeiAfterBlocks(lastDailyBlock, lastWeeklyBlock);
  dailyPoolWei = jackpotContributions.dailyWei;
  weeklyPoolWei = jackpotContributions.weeklyWei;

  if (dailyPoolWei <= 0n && weeklyPoolWei <= 0n && !latestDaily && !latestWeekly) {
    return null;
  }

  const lastDailyAmountWei = latestDaily ? parseLineaAmountWei(latestDaily.amount) : 0n;
  const lastWeeklyAmountWei = latestWeekly ? parseLineaAmountWei(latestWeekly.amount) : 0n;

  return [
    dailyPoolWei.toString(),
    weeklyPoolWei.toString(),
    "0",
    "0",
    latestDaily?.epoch ?? "0",
    latestWeekly?.epoch ?? "0",
    lastDailyAmountWei.toString(),
    lastWeeklyAmountWei.toString(),
  ];
}

export function buildStoredLiveStateBootstrap(): LiveStatePayload | null {
  const recentJackpots = getRecentJackpots(64);
  const watermark = getStoredLiveStateBootstrapWatermark(recentJackpots);
  if (storedBootstrapCache?.watermark === watermark) {
    return storedBootstrapCache.payload;
  }

  const storedCurrentEpoch = getMetaNumber("currentEpoch");
  const storedCurrentEpochNumber = storedCurrentEpoch ?? 0;
  if (!isSafePositiveInteger(storedCurrentEpochNumber)) {
    storedBootstrapCache = { payload: null, watermark };
    return null;
  }

  const currentEpoch = String(storedCurrentEpochNumber);
  const indexedTilePoolsWei = getEpochTilePoolsWei(storedCurrentEpochNumber);
  const indexedTilePools = indexedTilePoolsWei.map((value) => value.toString());
  const tileUserCounts = getEpochTileUserCounts(storedCurrentEpochNumber);
  const epochRow = getEpochMapByIds([storedCurrentEpochNumber])[currentEpoch];
  const totalPoolWei = indexedTilePoolsWei.reduce((acc, value) => acc + value, 0n);
  const snapshot = loadLiveStateSnapshot(Number.POSITIVE_INFINITY);
  const sameEpochSnapshot = snapshot?.currentEpoch === currentEpoch ? snapshot : null;
  const storedJackpotInfo = buildStoredJackpotInfoFallback(snapshot, recentJackpots);

  const payload: LiveStatePayload = {
    currentEpoch,
    epochEndTime: sameEpochSnapshot?.epochEndTime ?? snapshot?.epochEndTime ?? null,
    jackpotInfo: storedJackpotInfo,
    rolloverPool: snapshot?.rolloverPool ?? "0",
    currentEpochData:
      epochRow != null
        ? [
            epochRow.totalPool,
            epochRow.rewardPool,
            String(epochRow.winningTile ?? 0),
            false,
            Boolean(epochRow.isDailyJackpot),
            Boolean(epochRow.isWeeklyJackpot),
          ]
        : sameEpochSnapshot?.currentEpochData ?? [
            totalPoolWei.toString(),
            "0",
            "0",
            false,
            false,
            false,
          ],
    tileData: {
      pools: indexedTilePools,
      users: tileUserCounts.map((value) => String(value)),
    },
    tileUserCounts,
    indexedTilePools,
    epochDuration: snapshot?.epochDuration ?? null,
    pendingEpochDuration: snapshot?.pendingEpochDuration ?? null,
    pendingEpochDurationEta: snapshot?.pendingEpochDurationEta ?? null,
    pendingEpochDurationEffectiveFromEpoch: snapshot?.pendingEpochDurationEffectiveFromEpoch ?? null,
    fetchedAt: Date.now(),
  };
  storedBootstrapCache = {
    payload,
    watermark,
  };
  return payload;
}

export async function buildLiveStatePayload(): Promise<LiveStatePayload> {
  const snapshot = loadLiveStateSnapshot();
  const currentEpoch = await readLiveStateContract(
    "currentEpoch",
    publicClient.readContract({
      address: CONTRACT_ADDRESS,
      abi: LIVE_STATE_ABI,
      functionName: "currentEpoch",
    }),
  );

  const snapshotResults = await readLiveStateContract(
    "snapshot",
    publicClient.multicall({
      allowFailure: true,
      contracts: [
        {
          address: CONTRACT_ADDRESS,
          abi: LIVE_STATE_ABI,
          functionName: "getEpochEndTime",
          args: [currentEpoch],
        },
        {
          address: CONTRACT_ADDRESS,
          abi: LIVE_STATE_ABI,
          functionName: "getJackpotInfo",
        },
        {
          address: CONTRACT_ADDRESS,
          abi: LIVE_STATE_ABI,
          functionName: "rolloverPool",
        },
        {
          address: CONTRACT_ADDRESS,
          abi: LIVE_STATE_ABI,
          functionName: "epochs",
          args: [currentEpoch],
        },
        {
          address: CONTRACT_ADDRESS,
          abi: LIVE_STATE_ABI,
          functionName: "getTileData",
          args: [currentEpoch],
        },
        {
          address: CONTRACT_ADDRESS,
          abi: LIVE_STATE_ABI,
          functionName: "epochDuration",
        },
        {
          address: CONTRACT_ADDRESS,
          abi: LIVE_STATE_ABI,
          functionName: "pendingEpochDuration",
        },
        {
          address: CONTRACT_ADDRESS,
          abi: LIVE_STATE_ABI,
          functionName: "pendingEpochDurationEta",
        },
        {
          address: CONTRACT_ADDRESS,
          abi: LIVE_STATE_ABI,
          functionName: "pendingEpochDurationEffectiveFromEpoch",
        },
      ],
    }),
  );

  const epochEndTime = snapshotResults[0];
  const jackpotInfo = snapshotResults[1];
  const rolloverPool = snapshotResults[2];
  const currentEpochData = snapshotResults[3];
  const tileData = snapshotResults[4];
  const epochDuration = snapshotResults[5];
  const pendingEpochDuration = snapshotResults[6];
  const pendingEpochDurationEta = snapshotResults[7];
  const pendingEpochDurationEffectiveFromEpoch = snapshotResults[8];
  const currentEpochString = currentEpoch.toString();
  const sameEpochSnapshot = snapshot?.currentEpoch === currentEpochString ? snapshot : null;
  const currentEpochNumber = Number(currentEpoch);
  const indexedTileUserCounts =
    isSafePositiveInteger(currentEpochNumber)
      ? getEpochTileUserCounts(currentEpochNumber)
      : null;
  const indexedTilePools =
    isSafePositiveInteger(currentEpochNumber)
      ? getEpochTilePoolsWei(currentEpochNumber).map((value) => value.toString())
      : sameEpochSnapshot?.indexedTilePools ?? null;
  const liveTileTuple =
    tileData.status === "success" ? (tileData.result as LiveStateTileTuple) : null;
  const shouldRefreshCurrentEpochTileUserCounts =
    isSafePositiveInteger(currentEpochNumber) &&
    hasAnyPositivePool(liveTileTuple);
  let tileUserCounts = indexedTileUserCounts ?? sameEpochSnapshot?.tileUserCounts ?? null;
  if (shouldRefreshCurrentEpochTileUserCounts) {
    try {
      tileUserCounts = await withTimeout(
        fetchEpochTileUserCountsFromChain(
          currentEpoch,
          (() => {
            const lastIndexedBlock = getMetaBigInt("lastIndexedBlock");
            if (!lastIndexedBlock || lastIndexedBlock < CONTRACT_DEPLOY_BLOCK) {
              return CONTRACT_DEPLOY_BLOCK;
            }
            return lastIndexedBlock + 1n;
          })(),
          await publicClient.getBlockNumber(),
          hasAnyPositiveCount(indexedTileUserCounts)
            ? getEpochTileUserSets(currentEpochNumber)
            : undefined,
        ),
        "tile user counts",
        LIVE_STATE_TILE_USER_COUNTS_TIMEOUT_MS,
      );
    } catch {
      tileUserCounts = indexedTileUserCounts ?? sameEpochSnapshot?.tileUserCounts ?? null;
    }
  }

  const payload: LiveStatePayload = {
    currentEpoch: currentEpochString,
    epochEndTime:
      epochEndTime.status === "success"
        ? epochEndTime.result.toString()
        : sameEpochSnapshot?.epochEndTime ?? null,
    jackpotInfo:
      jackpotInfo.status === "success"
        ? (jackpotInfo.result as LiveStateJackpotTuple).map((value) => value.toString())
        : snapshot?.jackpotInfo ?? null,
    rolloverPool:
      rolloverPool.status === "success" ? rolloverPool.result.toString() : snapshot?.rolloverPool ?? null,
    currentEpochData:
      currentEpochData.status === "success"
        ? [
            (currentEpochData.result as LiveStateEpochTuple)[0].toString(),
            (currentEpochData.result as LiveStateEpochTuple)[1].toString(),
            (currentEpochData.result as LiveStateEpochTuple)[2].toString(),
            (currentEpochData.result as LiveStateEpochTuple)[3],
            (currentEpochData.result as LiveStateEpochTuple)[4],
            (currentEpochData.result as LiveStateEpochTuple)[5],
          ]
        : sameEpochSnapshot?.currentEpochData ?? null,
    tileData:
      tileData.status === "success"
        ? {
            pools: (tileData.result as LiveStateTileTuple)[0].map((value) => value.toString()),
            users: (tileData.result as LiveStateTileTuple)[1].map((value) => value.toString()),
          }
        : sameEpochSnapshot?.tileData ?? null,
    tileUserCounts,
    indexedTilePools,
    epochDuration:
      epochDuration.status === "success" ? epochDuration.result.toString() : snapshot?.epochDuration ?? null,
    pendingEpochDuration:
      pendingEpochDuration.status === "success"
        ? pendingEpochDuration.result.toString()
        : snapshot?.pendingEpochDuration ?? null,
    pendingEpochDurationEta:
      pendingEpochDurationEta.status === "success"
        ? pendingEpochDurationEta.result.toString()
        : snapshot?.pendingEpochDurationEta ?? null,
    pendingEpochDurationEffectiveFromEpoch:
      pendingEpochDurationEffectiveFromEpoch.status === "success"
        ? pendingEpochDurationEffectiveFromEpoch.result.toString()
        : snapshot?.pendingEpochDurationEffectiveFromEpoch ?? null,
    fetchedAt: Date.now(),
  };

  saveLiveStateSnapshot(payload);
  return payload;
}

export async function getLiveStatePayloadWithSnapshotFallback(): Promise<LiveStatePayload> {
  try {
    return await buildLiveStatePayload();
  } catch (error) {
    const snapshot = loadLiveStateSnapshot(Number.POSITIVE_INFINITY) ?? buildStoredLiveStateBootstrap();
    if (snapshot) {
      return {
        ...snapshot,
        fetchedAt: Date.now(),
      };
    }
    throw error;
  }
}
