import { decodeEventLog, encodeEventTopics, parseAbi, parseUnits, toHex } from "viem";
import { publicClient, CONTRACT_ADDRESS, CONTRACT_DEPLOY_BLOCK } from "../_lib/dataBridge";
import {
  getAllBetRows,
  getEpochMapByIds,
  getEpochTilePoolsWei,
  getEpochTileUserCounts,
  getMetaBigInt,
  getMetaJson,
  getMetaNumber,
  getRecentJackpots,
  setMetaJson,
} from "../../../server/storage";

const LIVE_STATE_RPC_TIMEOUT_MS = 15_000;
const LIVE_STATE_LOG_SCAN_CHUNK = 50_000n;
const LIVE_STATE_LOG_SCAN_MIN_CHUNK = 2_000n;
const LIVE_STATE_SNAPSHOT_META_KEY = "snapshot:live-state:v1";
const LIVE_STATE_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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
]);
const [betPlacedSig] = encodeEventTopics({ abi: LIVE_STATE_EVENTS_ABI, eventName: "BetPlaced" });
const [batchPlacedSig] = encodeEventTopics({ abi: LIVE_STATE_EVENTS_ABI, eventName: "BatchBetsPlaced" });
const [batchSameAmountPlacedSig] = encodeEventTopics({
  abi: LIVE_STATE_EVENTS_ABI,
  eventName: "BatchBetsSameAmountPlaced",
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

type LiveStateEpochTuple = [bigint, bigint, bigint, boolean, boolean, boolean];
type LiveStateTileTuple = [bigint[], bigint[]];
type LiveStateJackpotTuple = [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

function isTooManyResultsError(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    message.includes("more than 10000 results") ||
    message.includes("query returned more than 10000 results") ||
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

async function fetchEpochTileUserCountsFromChain(
  epoch: bigint,
  fromBlock: bigint,
  toBlock: bigint,
  gridSize = 25,
) {
  const epochTopic = toHex(epoch, { size: 32 });
  const perTile = Array.from({ length: gridSize }, () => new Set<string>());

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
    }
  };

  for (const topic0 of [betPlacedSig, batchPlacedSig, batchSameAmountPlacedSig]) {
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

function createTimeoutError(label: string) {
  return new Error(`live-state ${label} timed out after ${LIVE_STATE_RPC_TIMEOUT_MS}ms`);
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(createTimeoutError(label)), LIVE_STATE_RPC_TIMEOUT_MS);
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
  const snapshot = getMetaJson<LiveStateSnapshotEnvelope | LiveStatePayload>(LIVE_STATE_SNAPSHOT_META_KEY);
  if (!snapshot) return null;
  if ("payload" in snapshot) {
    if (
      Number.isFinite(maxAgeMs) &&
      (typeof snapshot.savedAt !== "number" || Date.now() - snapshot.savedAt > maxAgeMs)
    ) {
      return null;
    }
    return snapshot.payload;
  }
  return snapshot;
}

export function saveLiveStateSnapshot(payload: LiveStatePayload) {
  setMetaJson(LIVE_STATE_SNAPSHOT_META_KEY, {
    payload,
    savedAt: Date.now(),
  });
}

function buildStoredJackpotInfoFallback(snapshot: LiveStatePayload | null) {
  if (snapshot?.jackpotInfo && snapshot.jackpotInfo.length === 8) {
    return snapshot.jackpotInfo;
  }

  const recentJackpots = getRecentJackpots(64);
  const latestDaily = recentJackpots.find((row) => row.kind === "daily") ?? null;
  const latestWeekly = recentJackpots.find((row) => row.kind === "weekly") ?? null;

  let dailyPoolWei = 0n;
  let weeklyPoolWei = 0n;
  const lastDailyBlock = latestDaily ? BigInt(latestDaily.blockNumber || "0") : 0n;
  const lastWeeklyBlock = latestWeekly ? BigInt(latestWeekly.blockNumber || "0") : 0n;

  for (const row of getAllBetRows()) {
    let totalAmountWei = 0n;
    let blockNumber = 0n;
    try {
      totalAmountWei = parseUnits(row.totalAmount || "0", 18);
      blockNumber = BigInt(row.blockNumber || "0");
    } catch {
      continue;
    }
    if (totalAmountWei <= 0n || blockNumber <= 0n) continue;
    if (blockNumber > lastDailyBlock) {
      dailyPoolWei += totalAmountWei / 50n;
    }
    if (blockNumber > lastWeeklyBlock) {
      weeklyPoolWei += (totalAmountWei * 3n) / 100n;
    }
  }

  if (dailyPoolWei <= 0n && weeklyPoolWei <= 0n && !latestDaily && !latestWeekly) {
    return null;
  }

  const lastDailyAmountWei = latestDaily ? parseUnits(latestDaily.amount || "0", 18) : 0n;
  const lastWeeklyAmountWei = latestWeekly ? parseUnits(latestWeekly.amount || "0", 18) : 0n;

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
  const storedCurrentEpoch = getMetaNumber("currentEpoch");
  if (!Number.isInteger(storedCurrentEpoch) || !storedCurrentEpoch || storedCurrentEpoch <= 0) {
    return null;
  }

  const currentEpoch = String(storedCurrentEpoch);
  const indexedTilePoolsWei = getEpochTilePoolsWei(storedCurrentEpoch);
  const indexedTilePools = indexedTilePoolsWei.map((value) => value.toString());
  const tileUserCounts = getEpochTileUserCounts(storedCurrentEpoch);
  const epochRow = getEpochMapByIds([storedCurrentEpoch])[currentEpoch];
  const totalPoolWei = indexedTilePoolsWei.reduce((acc, value) => acc + value, 0n);
  const snapshot = loadLiveStateSnapshot(Number.POSITIVE_INFINITY);
  const sameEpochSnapshot = snapshot?.currentEpoch === currentEpoch ? snapshot : null;
  const storedJackpotInfo = buildStoredJackpotInfoFallback(snapshot);

  return {
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
    Number.isInteger(currentEpochNumber) && currentEpochNumber > 0
      ? getEpochTileUserCounts(currentEpochNumber)
      : null;
  const indexedTilePools =
    Number.isInteger(currentEpochNumber) && currentEpochNumber > 0
      ? getEpochTilePoolsWei(currentEpochNumber).map((value) => value.toString())
      : sameEpochSnapshot?.indexedTilePools ?? null;
  const liveTileTuple =
    tileData.status === "success" ? (tileData.result as LiveStateTileTuple) : null;
  const tileUserCounts =
    Number.isInteger(currentEpochNumber) &&
    currentEpochNumber > 0 &&
    !hasAnyPositiveCount(indexedTileUserCounts) &&
    hasAnyPositivePool(liveTileTuple)
      ? await fetchEpochTileUserCountsFromChain(
          currentEpoch,
          (() => {
            const lastIndexedBlock = getMetaBigInt("lastIndexedBlock");
            if (!lastIndexedBlock || lastIndexedBlock < CONTRACT_DEPLOY_BLOCK) {
              return CONTRACT_DEPLOY_BLOCK;
            }
            return lastIndexedBlock + 1n;
          })(),
          await publicClient.getBlockNumber(),
        )
      : indexedTileUserCounts ?? sameEpochSnapshot?.tileUserCounts ?? null;

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
