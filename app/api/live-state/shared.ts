import { parseAbi } from "viem";
import { publicClient, CONTRACT_ADDRESS } from "../_lib/dataBridge";
import { getEpochTilePoolsWei, getEpochTileUserCounts } from "../../../server/storage";

const LIVE_STATE_RPC_TIMEOUT_MS = 6_500;

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

type LiveStateEpochTuple = [bigint, bigint, bigint, boolean, boolean, boolean];
type LiveStateTileTuple = [bigint[], bigint[]];
type LiveStateJackpotTuple = [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

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

export async function buildLiveStatePayload(): Promise<LiveStatePayload> {
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
  const currentEpochNumber = Number(currentEpoch);
  const tileUserCounts =
    Number.isInteger(currentEpochNumber) && currentEpochNumber > 0
      ? getEpochTileUserCounts(currentEpochNumber)
      : null;
  const indexedTilePools =
    Number.isInteger(currentEpochNumber) && currentEpochNumber > 0
      ? getEpochTilePoolsWei(currentEpochNumber).map((value) => value.toString())
      : null;

  return {
    currentEpoch: currentEpoch.toString(),
    epochEndTime: epochEndTime.status === "success" ? epochEndTime.result.toString() : null,
    jackpotInfo:
      jackpotInfo.status === "success"
        ? (jackpotInfo.result as LiveStateJackpotTuple).map((value) => value.toString())
        : null,
    rolloverPool: rolloverPool.status === "success" ? rolloverPool.result.toString() : null,
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
        : null,
    tileData:
      tileData.status === "success"
        ? {
            pools: (tileData.result as LiveStateTileTuple)[0].map((value) => value.toString()),
            users: (tileData.result as LiveStateTileTuple)[1].map((value) => value.toString()),
          }
        : null,
    tileUserCounts,
    indexedTilePools,
    epochDuration: epochDuration.status === "success" ? epochDuration.result.toString() : null,
    pendingEpochDuration:
      pendingEpochDuration.status === "success" ? pendingEpochDuration.result.toString() : null,
    pendingEpochDurationEta:
      pendingEpochDurationEta.status === "success" ? pendingEpochDurationEta.result.toString() : null,
    pendingEpochDurationEffectiveFromEpoch:
      pendingEpochDurationEffectiveFromEpoch.status === "success"
        ? pendingEpochDurationEffectiveFromEpoch.result.toString()
        : null,
    fetchedAt: Date.now(),
  };
}
