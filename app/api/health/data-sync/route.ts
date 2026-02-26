import { NextResponse } from "next/server";
import { parseAbi } from "viem";
import { DEFAULT_DATA_SYNC_LAG_WARN_BLOCKS } from "../../../../config/publicConfig";
import {
  fetchFirebaseJson,
  parseCurrentEpoch,
  publicClient,
  CONTRACT_ADDRESS,
} from "../../_lib/dataBridge";

const READ_ABI = parseAbi([
  "function currentEpoch() view returns (uint256)",
  "function getJackpotInfo() view returns (uint256 dailyPool, uint256 weeklyPool, uint256 lastDailyDay, uint256 lastWeeklyWeek, uint256 lastDailyEpoch, uint256 lastWeeklyEpoch, uint256 lastDailyAmount, uint256 lastWeeklyAmount)",
]);

const LAG_WARN_BLOCKS = Number(process.env.DATA_SYNC_LAG_WARN_BLOCKS ?? String(DEFAULT_DATA_SYNC_LAG_WARN_BLOCKS));

type EpochRow = {
  winningTile: number;
  rewardPool: string;
  isDailyJackpot?: boolean;
  isWeeklyJackpot?: boolean;
};

type JackpotRow = {
  epoch: string;
  kind: "daily" | "weekly";
};

function toNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET() {
  try {
    const [head, chainEpochRaw, jackpotInfoRaw, dbEpochMeta, dbLastIndexed, dbRepairCursor, dbEpochsRaw, dbJackpotsRaw] =
      await Promise.all([
        publicClient.getBlockNumber(),
        publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi: READ_ABI,
          functionName: "currentEpoch",
        }),
        publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi: READ_ABI,
          functionName: "getJackpotInfo",
        }),
        fetchFirebaseJson<number>("gamedata/_meta/currentEpoch"),
        fetchFirebaseJson<string>("gamedata/_meta/lastIndexedBlock"),
        fetchFirebaseJson<string>("gamedata/_meta/repairCursorBlock"),
        fetchFirebaseJson<Record<string, EpochRow>>("gamedata/epochs"),
        fetchFirebaseJson<Record<string, JackpotRow>>("gamedata/jackpots"),
      ]);

    const chainCurrentEpoch = Number(chainEpochRaw);
    const dbCurrentEpoch = parseCurrentEpoch(dbEpochMeta.data);
    const dbLastIndexedBlock = dbLastIndexed.ok && dbLastIndexed.data ? BigInt(dbLastIndexed.data) : null;
    const dbRepairCursorBlock = dbRepairCursor.ok && dbRepairCursor.data ? BigInt(dbRepairCursor.data) : null;
    const lagBlocks = dbLastIndexedBlock !== null ? Number(head - dbLastIndexedBlock) : null;

    const dbEpochs = dbEpochsRaw.ok && dbEpochsRaw.data ? dbEpochsRaw.data : {};
    const maxEpochToCheck = Math.max(0, chainCurrentEpoch - 1);
    const presentEpochs = new Set<number>(
      Object.keys(dbEpochs)
        .map((k) => Number(k))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= maxEpochToCheck),
    );

    const missingEpochs: number[] = [];
    for (let ep = 1; ep <= maxEpochToCheck; ep++) {
      if (!presentEpochs.has(ep)) missingEpochs.push(ep);
    }

    const jackpotsInfo = jackpotInfoRaw as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
    const lastDailyEpoch = Number(jackpotsInfo[4]);
    const lastWeeklyEpoch = Number(jackpotsInfo[5]);
    const lastDailyAmount = Number(jackpotsInfo[6]) / 1e18;
    const lastWeeklyAmount = Number(jackpotsInfo[7]) / 1e18;

    const dbJackpots = dbJackpotsRaw.ok && dbJackpotsRaw.data ? Object.values(dbJackpotsRaw.data) : [];
    const dbJackpotKeys = new Set<string>(
      dbJackpots
        .filter((j) => j && (j.kind === "daily" || j.kind === "weekly"))
        .map((j) => `${j.kind}_${j.epoch}`),
    );

    const hasLatestDailyInDb = lastDailyEpoch > 0 ? dbJackpotKeys.has(`daily_${lastDailyEpoch}`) : true;
    const hasLatestWeeklyInDb = lastWeeklyEpoch > 0 ? dbJackpotKeys.has(`weekly_${lastWeeklyEpoch}`) : true;

    const degraded =
      (lagBlocks !== null && lagBlocks > LAG_WARN_BLOCKS) ||
      missingEpochs.length > 0 ||
      !hasLatestDailyInDb ||
      !hasLatestWeeklyInDb ||
      (dbCurrentEpoch !== null && Math.abs(dbCurrentEpoch - chainCurrentEpoch) > 1);

    return NextResponse.json({
      status: degraded ? "degraded" : "healthy",
      contract: {
        currentEpoch: chainCurrentEpoch,
        headBlock: head.toString(),
      },
      firebase: {
        currentEpochMeta: dbCurrentEpoch,
        lastIndexedBlock: dbLastIndexedBlock?.toString() ?? null,
        repairCursorBlock: dbRepairCursorBlock?.toString() ?? null,
        lagBlocks,
      },
      epochs: {
        expectedResolvedRange: maxEpochToCheck > 0 ? `1..${maxEpochToCheck}` : "none",
        storedCount: presentEpochs.size,
        missingCount: missingEpochs.length,
        missingLatest: missingEpochs.slice(-20),
      },
      jackpots: {
        lastDailyEpoch,
        lastDailyAmount,
        hasLatestDailyInDb,
        lastWeeklyEpoch,
        lastWeeklyAmount,
        hasLatestWeeklyInDb,
        totalStored: dbJackpots.length,
      },
      hints: [
        missingEpochs.length > 0 ? "Indexer repair/reconcile is still catching up missing epochs." : null,
        lagBlocks !== null && lagBlocks > LAG_WARN_BLOCKS ? "Indexer is lagging by blocks; check bot/indexer supervisor." : null,
        !hasLatestDailyInDb || !hasLatestWeeklyInDb ? "Latest jackpot event not in DB yet; API fallback should still show it." : null,
      ].filter(Boolean),
      ts: Date.now(),
      env: {
        lagWarnBlocks: toNum(LAG_WARN_BLOCKS),
      },
    });
  } catch (err) {
    console.error("[api/health/data-sync] Error:", err);
    return NextResponse.json(
      {
        status: "error",
        error: (err as Error).message || "unknown",
      },
      { status: 500 },
    );
  }
}
