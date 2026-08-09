import { formatUnits, getAddress, parseAbi } from "viem";
import { CONTRACT_ADDRESS, isSafePositiveInteger, publicClient } from "./dataBridge";
import { parseLineaAmountWei } from "../../lib/tokenAmountMath";
import { getEpochMapByIds, upsertEpochMap } from "../../../server/storage";
import { createRouteCache } from "./routeCache";
import { parseStoredPositiveIntegerOrZero } from "./storedNumberParsing";

const READ_ABI = parseAbi([
  "function epochs(uint256) view returns (uint256 totalPool, uint256 rewardPool, uint256 winningTile, bool isResolved, bool isDailyJackpot, bool isWeeklyJackpot)",
  "function userBets(uint256 epoch, uint256 tile, address user) view returns (uint256)",
  "function tilePools(uint256 epoch, uint256 tile) view returns (uint256)",
]);

const MULTICALL_CHUNK = 100;
const MAX_EPOCHS_PER_REQUEST = 400;
const REWARD_SUMMARY_CACHE_TTL_MS = 30_000;
const REWARD_SUMMARY_CACHE_MAX_KEYS = 200;
const MAX_TILE_ID = 25;

export type RewardEpochRow = {
  winningTile: number;
  rewardPool: string;
  isDailyJackpot: boolean;
  isWeeklyJackpot: boolean;
};

export type RewardRow = {
  reward: string;
  winningTile: number;
  rewardPool: string;
  winningTilePool: string;
  userWinningAmount: string;
};

type RewardMapsForUserEpochs = {
  epochs: Record<string, RewardEpochRow>;
  rewards: Record<string, RewardRow>;
};

type OnChainEpochTuple = [bigint, bigint, bigint, boolean, boolean, boolean];
type RewardEpochRuntimeRow = {
  winningTile: number;
  totalPool: string;
  rewardPool: string;
  rewardPoolWei: bigint;
  isDailyJackpot: boolean;
  isWeeklyJackpot: boolean;
};

const rewardSummaryCache = createRouteCache<RewardMapsForUserEpochs>(REWARD_SUMMARY_CACHE_MAX_KEYS);

function getRewardSummaryCacheKey(user: string, epochs: number[]) {
  return `${getAddress(user).toLowerCase()}:${epochs.join(",")}`;
}

function parseRewardTileNumber(value: bigint | number): number | null {
  let parsed: number;
  if (typeof value === "bigint") {
    if (value <= 0n || value > BigInt(MAX_TILE_ID)) return null;
    parsed = Number(value);
  } else {
    parsed = value;
  }
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= MAX_TILE_ID ? parsed : null;
}

function parseRewardEpochKey(value: string): number | null {
  const parsed = parseStoredPositiveIntegerOrZero(value);
  return parsed > 0 ? parsed : null;
}

async function loadEpochRows(epochs: number[]): Promise<Record<string, RewardEpochRuntimeRow>> {
  const normalizedEpochs = [...new Set(
    epochs.filter(isSafePositiveInteger),
  )].slice(0, MAX_EPOCHS_PER_REQUEST);

  const storedRows = getEpochMapByIds(normalizedEpochs);
  const epochRows: Record<string, RewardEpochRuntimeRow> = {};
  const missingEpochs: number[] = [];

  for (const epoch of normalizedEpochs) {
    const stored = storedRows[String(epoch)];
    const storedWinningTile = stored ? parseRewardTileNumber(stored.winningTile) : null;
    if (stored && storedWinningTile !== null) {
      epochRows[String(epoch)] = {
        winningTile: storedWinningTile,
        totalPool: stored.totalPool,
        rewardPool: stored.rewardPool,
        rewardPoolWei: parseLineaAmountWei(stored.rewardPool),
        isDailyJackpot: Boolean(stored.isDailyJackpot),
        isWeeklyJackpot: Boolean(stored.isWeeklyJackpot),
      };
    } else {
      missingEpochs.push(epoch);
    }
  }

  const recoveredRows: Record<string, {
    winningTile: number;
    totalPool: string;
    rewardPool: string;
    isDailyJackpot: boolean;
    isWeeklyJackpot: boolean;
  }> = {};

  for (let offset = 0; offset < missingEpochs.length; offset += MULTICALL_CHUNK) {
    const chunk = missingEpochs.slice(offset, offset + MULTICALL_CHUNK);
    const results = await publicClient.multicall({
      contracts: chunk.map((epoch) => ({
        address: CONTRACT_ADDRESS,
        abi: READ_ABI,
        functionName: "epochs",
        args: [BigInt(epoch)],
      })),
    });

    chunk.forEach((epoch, index) => {
      const row = results[index]?.result as OnChainEpochTuple | undefined;
      if (!row) return;
      const isResolved = Boolean(row[3]);
      const totalPool = row[0];
      const rewardPool = row[1];
      const winningTile = parseRewardTileNumber(row[2]);
      if (!isResolved || rewardPool <= 0n || winningTile === null) return;
      const recovered = {
        winningTile,
        totalPool: formatUnits(totalPool, 18),
        rewardPool: formatUnits(rewardPool, 18),
        rewardPoolWei: rewardPool,
        isDailyJackpot: Boolean(row[4]),
        isWeeklyJackpot: Boolean(row[5]),
      };
      epochRows[String(epoch)] = recovered;
      recoveredRows[String(epoch)] = {
        winningTile: recovered.winningTile,
        totalPool: recovered.totalPool,
        rewardPool: recovered.rewardPool,
        isDailyJackpot: recovered.isDailyJackpot,
        isWeeklyJackpot: recovered.isWeeklyJackpot,
      };
    });
  }

  if (Object.keys(recoveredRows).length > 0) {
    upsertEpochMap(recoveredRows);
  }

  return epochRows;
}

export async function loadRewardMapsForUserEpochs(
  user: string,
  epochs: number[],
): Promise<RewardMapsForUserEpochs> {
  const normalizedUser = getAddress(user).toLowerCase() as `0x${string}`;
  const normalizedEpochs = [...new Set(
    epochs.filter(isSafePositiveInteger),
  )].slice(0, MAX_EPOCHS_PER_REQUEST);
  if (normalizedEpochs.length === 0) {
    return { epochs: {}, rewards: {} };
  }

  const cacheKey = getRewardSummaryCacheKey(normalizedUser, normalizedEpochs);
  const cached = rewardSummaryCache.getFresh(cacheKey);
  if (cached) {
    return cached;
  }

  const inflight = rewardSummaryCache.getInflight(cacheKey);
  if (inflight) {
    return inflight;
  }

  const task: Promise<RewardMapsForUserEpochs> = (async (): Promise<RewardMapsForUserEpochs> => {
    const epochMap = await loadEpochRows(normalizedEpochs);
    const winningEpochs = Object.entries(epochMap)
      .flatMap(([epoch, row]) => {
        const parsedEpoch = parseRewardEpochKey(epoch);
        return parsedEpoch !== null && isSafePositiveInteger(parsedEpoch)
          ? [{
              epoch: parsedEpoch,
              winningTile: BigInt(row.winningTile),
              rewardPool: row.rewardPool,
            }]
          : [];
      });

    const rewards: Record<string, RewardRow> = {};
    const serializedEpochs: Record<string, RewardEpochRow> = Object.fromEntries(
      Object.entries(epochMap).map(([epoch, row]) => [
        epoch,
        {
          winningTile: row.winningTile,
          rewardPool: row.rewardPool,
          isDailyJackpot: row.isDailyJackpot,
          isWeeklyJackpot: row.isWeeklyJackpot,
        },
      ]),
    );

    if (winningEpochs.length === 0) {
      return { epochs: serializedEpochs, rewards };
    }

    for (let offset = 0; offset < winningEpochs.length; offset += MULTICALL_CHUNK) {
      const chunk = winningEpochs.slice(offset, offset + MULTICALL_CHUNK);
      const [userBetResults, tilePoolResults] = await Promise.all([
        publicClient.multicall({
          contracts: chunk.map((entry) => ({
            address: CONTRACT_ADDRESS,
            abi: READ_ABI,
            functionName: "userBets",
            args: [BigInt(entry.epoch), entry.winningTile, normalizedUser],
          })),
        }),
        publicClient.multicall({
          contracts: chunk.map((entry) => ({
            address: CONTRACT_ADDRESS,
            abi: READ_ABI,
            functionName: "tilePools",
            args: [BigInt(entry.epoch), entry.winningTile],
          })),
        }),
      ]);

      chunk.forEach((entry, index) => {
        const userWinningAmount = (userBetResults[index]?.result as bigint | undefined) ?? 0n;
        const winningTilePool = (tilePoolResults[index]?.result as bigint | undefined) ?? 0n;
        if (userWinningAmount <= 0n || winningTilePool <= 0n) return;

        const sourceEpoch = epochMap[String(entry.epoch)];
        if (!sourceEpoch) return;
        const reward = (sourceEpoch.rewardPoolWei * userWinningAmount) / winningTilePool;
        rewards[String(entry.epoch)] = {
          reward: formatUnits(reward, 18),
          winningTile: sourceEpoch.winningTile,
          rewardPool: entry.rewardPool,
          winningTilePool: formatUnits(winningTilePool, 18),
          userWinningAmount: formatUnits(userWinningAmount, 18),
        };
      });
    }

    return { epochs: serializedEpochs, rewards };
  })()
    .then((payload) => {
      return rewardSummaryCache.set(cacheKey, payload, REWARD_SUMMARY_CACHE_TTL_MS);
    })
    .finally(() => {
      rewardSummaryCache.clearInflight(cacheKey, task);
    });

  return rewardSummaryCache.setInflight(cacheKey, task);
}
