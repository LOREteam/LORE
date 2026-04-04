"use client";

import { formatUnits } from "viem";
import { GRID_SIZE } from "../lib/constants";

export type EpochTuple = readonly [bigint, bigint, bigint, boolean, boolean, boolean];
type JackpotInfoTuple = readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

const ZERO_TILE_USER_COUNTS: number[] = Object.freeze(
  Array.from({ length: GRID_SIZE }, () => 0),
) as number[];

/** Returns a frozen zero-filled array. Safe to use as default — do NOT mutate. */
export function createZeroTileUserCounts(): number[] {
  return ZERO_TILE_USER_COUNTS;
}

export function buildJackpotInfo(jackpotInfoRaw: unknown) {
  if (!jackpotInfoRaw) return null;
  const t = jackpotInfoRaw as JackpotInfoTuple;
  return {
    dailyPool: parseFloat(formatUnits(t[0], 18)),
    dailyPoolWei: t[0],
    weeklyPool: parseFloat(formatUnits(t[1], 18)),
    weeklyPoolWei: t[1],
    lastDailyDay: Number(t[2]),
    lastWeeklyWeek: Number(t[3]),
    lastDailyJackpotEpoch: t[4] > 0n ? t[4].toString() : null,
    lastWeeklyJackpotEpoch: t[5] > 0n ? t[5].toString() : null,
    lastDailyJackpotAmount: parseFloat(formatUnits(t[6], 18)),
    lastWeeklyJackpotAmount: parseFloat(formatUnits(t[7], 18)),
  };
}

export function buildRolloverAmount(rolloverPoolRaw: unknown) {
  if (rolloverPoolRaw === undefined) return 0;
  return parseFloat(formatUnits(rolloverPoolRaw as bigint, 18));
}

export function buildRealTotalStaked(tileData: unknown, rolloverPoolRaw: unknown) {
  if (!tileData) return 0;
  const pools = (tileData as [unknown])[0];
  if (!Array.isArray(pools)) return 0;
  const currentPool = (pools as bigint[]).reduce((acc, val) => acc + val, 0n);
  const roll = rolloverPoolRaw !== undefined ? (rolloverPoolRaw as bigint) : 0n;
  return parseFloat(formatUnits(currentPool + roll, 18));
}

export function buildWinningTileId(isRevealing: boolean, gridEpochData: unknown) {
  if (!isRevealing || !gridEpochData) return null;
  const tuple = gridEpochData as EpochTuple;
  if (tuple[3] && Number(tuple[2]) > 0) {
    return Number(tuple[2]);
  }
  return null;
}

export function buildCurrentEpochJackpotInfo(gridEpochData: unknown) {
  if (!gridEpochData) return { isDailyJackpot: false, isWeeklyJackpot: false };
  const tuple = gridEpochData as EpochTuple;
  return {
    isDailyJackpot: Boolean(tuple[4]),
    isWeeklyJackpot: Boolean(tuple[5]),
  };
}

export function buildCurrentJackpotAmount(
  jackpotInfo: ReturnType<typeof buildJackpotInfo>,
  currentEpochJackpotInfo: ReturnType<typeof buildCurrentEpochJackpotInfo>,
) {
  if (!jackpotInfo) return 0;
  let total = 0;
  if (currentEpochJackpotInfo.isDailyJackpot) {
    total += jackpotInfo.lastDailyJackpotAmount;
  }
  if (currentEpochJackpotInfo.isWeeklyJackpot) {
    total += jackpotInfo.lastWeeklyJackpotAmount;
  }
  return total;
}

export function buildTileViewData(tileData: unknown, tileUserCounts: number[], userBetsAll?: bigint[]) {
  const tileTuple = Array.isArray(tileData) ? (tileData as unknown[]) : null;
  const poolsArr = tileTuple && Array.isArray(tileTuple[0]) ? (tileTuple[0] as bigint[]) : null;
  const liveUsersArr = tileTuple && Array.isArray(tileTuple[1]) ? (tileTuple[1] as bigint[]) : null;
  return Array.from({ length: GRID_SIZE }, (_, i) => {
    const myBetRaw = userBetsAll?.[i];
    const hasMyBet = myBetRaw !== undefined && myBetRaw > 0n;
    const poolWei = poolsArr?.[i] ?? 0n;
    const poolDisplay = parseFloat(formatUnits(poolWei, 18)).toFixed(2);
    const indexedUsers = tileUserCounts[i] ?? 0;
    const liveUsers = Number(liveUsersArr?.[i] ?? 0n);
    const users =
      Math.max(
        indexedUsers,
        Number.isFinite(liveUsers) ? liveUsers : 0,
        poolWei > 0n ? 1 : 0,
        hasMyBet ? 1 : 0,
      );
    return { tileId: i + 1, users, poolDisplay, hasMyBet };
  });
}

export function mergeIndexedTilePools(tileData: unknown, indexedTilePools?: bigint[] | null) {
  if (!indexedTilePools || indexedTilePools.length === 0) {
    return tileData;
  }

  const tileTuple = Array.isArray(tileData) ? (tileData as unknown[]) : null;
  const basePools =
    tileTuple && Array.isArray(tileTuple[0])
      ? (tileTuple[0] as bigint[])
      : Array.from({ length: GRID_SIZE }, () => 0n);
  const baseUsers =
    tileTuple && Array.isArray(tileTuple[1])
      ? (tileTuple[1] as bigint[])
      : Array.from({ length: GRID_SIZE }, () => 0n);

  return [
    Array.from({ length: GRID_SIZE }, (_, index) => {
      const chainPool = basePools[index] ?? 0n;
      const indexedPool = indexedTilePools[index] ?? 0n;
      return chainPool > indexedPool ? chainPool : indexedPool;
    }),
    baseUsers,
  ] as [bigint[], bigint[]];
}

export function buildHistoryViewData(
  historyData: Array<{ result?: unknown } | undefined> | undefined,
  historyEpochsList: bigint[],
  historyUserBetsData?: Array<{ result?: unknown } | undefined>,
) {
  if (!historyData || historyData.length !== historyEpochsList.length) return [];
  return (
    historyData
      .map((dataObj, index) => {
        if (!dataObj?.result) return null;
        const roundId = historyEpochsList[index];
        if (!roundId) return null;
        const [pool, , winBlock, isRes, isDailyJackpot, isWeeklyJackpot] = dataObj.result as EpochTuple;
        const userBetOnWinner =
          historyUserBetsData?.[index]?.result != null
            ? BigInt(historyUserBetsData[index]?.result as bigint) > 0n
            : false;
        return {
          roundId: roundId.toString(),
          poolDisplay: formatUnits(pool, 18),
          winningTile: winBlock.toString(),
          isResolved: isRes,
          userWon: isRes && userBetOnWinner,
          isDailyJackpot: Boolean(isDailyJackpot),
          isWeeklyJackpot: Boolean(isWeeklyJackpot),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
  );
}

export function buildEpochDurationChange(
  epochDurationSec: unknown,
  pendingEpochDuration: unknown,
  pendingEpochDurationEta: unknown,
  pendingEpochDurationEffectiveFromEpoch: unknown,
) {
  const next = pendingEpochDuration ? Number(pendingEpochDuration) : 0;
  if (!next) return null;
  return {
    current: epochDurationSec ? Number(epochDurationSec) : null,
    next,
    eta: pendingEpochDurationEta ? Number(pendingEpochDurationEta) : null,
    effectiveFromEpoch: pendingEpochDurationEffectiveFromEpoch
      ? (pendingEpochDurationEffectiveFromEpoch as bigint).toString()
      : null,
  };
}
