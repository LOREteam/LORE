import { NextResponse } from "next/server";
import { formatUnits, parseAbi } from "viem";
import {
  DEFAULT_DATA_SYNC_LAG_WARN_BLOCKS,
  getConfiguredDeployBlock,
  getConfiguredLineaNetwork,
} from "../../../../config/publicConfig";
import {
  fetchFirebaseJson,
  parseCurrentEpoch,
  publicClient,
  CONTRACT_ADDRESS,
} from "../../_lib/dataBridge";
import { dbPath } from "../../../../server/db";

const READ_ABI = parseAbi([
  "function currentEpoch() view returns (uint256)",
  "function getJackpotInfo() view returns (uint256 dailyPool, uint256 weeklyPool, uint256 lastDailyDay, uint256 lastWeeklyWeek, uint256 lastDailyEpoch, uint256 lastWeeklyEpoch, uint256 lastDailyAmount, uint256 lastWeeklyAmount)",
]);

const LAG_WARN_BLOCKS = Number(process.env.DATA_SYNC_LAG_WARN_BLOCKS ?? String(DEFAULT_DATA_SYNC_LAG_WARN_BLOCKS));
const APP_NETWORK = getConfiguredLineaNetwork();
const DEPLOY_BLOCK = getConfiguredDeployBlock(
  process.env.INDEXER_START_BLOCK ?? process.env.NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK,
  APP_NETWORK,
);

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

type SyncTrendSample = {
  ts: number;
  headBlock: bigint;
  lastIndexedBlock: bigint | null;
  storedEpochCount: number;
  lagBlocks: number | null;
};

type GlobalWithDataSyncTrend = typeof globalThis & {
  __loreDataSyncTrend?: SyncTrendSample;
  __loreDataSyncTrendHistory?: SyncTrendSample[];
};

function toNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
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
    const latestStoredEpoch = presentEpochs.size > 0 ? Math.max(...presentEpochs) : null;
    const highestContiguousEpoch =
      missingEpochs.length > 0
        ? Math.max(0, missingEpochs[0] - 1)
        : maxEpochToCheck;

    const jackpotsInfo = jackpotInfoRaw as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
    const lastDailyEpoch = Number(jackpotsInfo[4]);
    const lastWeeklyEpoch = Number(jackpotsInfo[5]);
    const lastDailyAmount = formatUnits(jackpotsInfo[6], 18);
    const lastWeeklyAmount = formatUnits(jackpotsInfo[7], 18);

    const dbJackpots = dbJackpotsRaw.ok && dbJackpotsRaw.data ? Object.values(dbJackpotsRaw.data) : [];
    const dbJackpotKeys = new Set<string>(
      dbJackpots
        .filter((j) => j && (j.kind === "daily" || j.kind === "weekly"))
        .map((j) => `${j.kind}_${j.epoch}`),
    );

    const hasLatestDailyInDb = lastDailyEpoch > 0 ? dbJackpotKeys.has(`daily_${lastDailyEpoch}`) : true;
    const hasLatestWeeklyInDb = lastWeeklyEpoch > 0 ? dbJackpotKeys.has(`weekly_${lastWeeklyEpoch}`) : true;

    const totalBlocksToIndex =
      head >= DEPLOY_BLOCK
        ? Number(head - DEPLOY_BLOCK + 1n)
        : 0;
    const indexedBlocksToCurrentHead =
      dbLastIndexedBlock !== null && dbLastIndexedBlock >= DEPLOY_BLOCK
        ? Number((dbLastIndexedBlock > head ? head : dbLastIndexedBlock) - DEPLOY_BLOCK + 1n)
        : 0;
    const blockProgressPct =
      totalBlocksToIndex > 0
        ? clampPercent((indexedBlocksToCurrentHead / totalBlocksToIndex) * 100)
        : 100;
    const epochCoveragePct =
      maxEpochToCheck > 0
        ? clampPercent((presentEpochs.size / maxEpochToCheck) * 100)
        : 100;
    const contiguousEpochCoveragePct =
      maxEpochToCheck > 0
        ? clampPercent((highestContiguousEpoch / maxEpochToCheck) * 100)
        : 100;

    const trendStore = globalThis as GlobalWithDataSyncTrend;
    const previousSample = trendStore.__loreDataSyncTrend;
    const now = Date.now();
    let blockRatePerMinute: number | null = null;
    let epochRatePerMinute: number | null = null;
    let estimatedMinutesToHead: number | null = null;

    if (previousSample && previousSample.lastIndexedBlock !== null && dbLastIndexedBlock !== null) {
      const elapsedMs = now - previousSample.ts;
      const deltaBlocks = Number(dbLastIndexedBlock - previousSample.lastIndexedBlock);
      const deltaEpochs = presentEpochs.size - previousSample.storedEpochCount;
      if (elapsedMs >= 5_000 && deltaBlocks > 0) {
        blockRatePerMinute = Number(((deltaBlocks * 60_000) / elapsedMs).toFixed(2));
        epochRatePerMinute = Number(((deltaEpochs * 60_000) / elapsedMs).toFixed(2));
        if (lagBlocks !== null && blockRatePerMinute > 0) {
          estimatedMinutesToHead = Number((lagBlocks / blockRatePerMinute).toFixed(1));
        }
      }
    }

    trendStore.__loreDataSyncTrend = {
      ts: now,
      headBlock: head,
      lastIndexedBlock: dbLastIndexedBlock,
      storedEpochCount: presentEpochs.size,
      lagBlocks,
    };
    const trendHistory = trendStore.__loreDataSyncTrendHistory ?? [];
    trendHistory.push({
      ts: now,
      headBlock: head,
      lastIndexedBlock: dbLastIndexedBlock,
      storedEpochCount: presentEpochs.size,
      lagBlocks,
    });
    trendStore.__loreDataSyncTrendHistory = trendHistory.slice(-8);

    const syncState =
      dbLastIndexedBlock === null
        ? "bootstrapping"
        : lagBlocks !== null && lagBlocks <= LAG_WARN_BLOCKS && missingEpochs.length === 0
          ? "synced"
          : lagBlocks !== null && lagBlocks <= Math.max(LAG_WARN_BLOCKS, 512) && missingEpochs.length <= 3
            ? "near_head"
            : "catching_up";

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
      storage: {
        currentEpochMeta: dbCurrentEpoch,
        lastIndexedBlock: dbLastIndexedBlock?.toString() ?? null,
        repairCursorBlock: dbRepairCursorBlock?.toString() ?? null,
        lagBlocks,
      },
      epochs: {
        expectedResolvedRange: maxEpochToCheck > 0 ? `1..${maxEpochToCheck}` : "none",
        storedCount: presentEpochs.size,
        missingCount: missingEpochs.length,
        latestStoredEpoch,
        highestContiguousEpoch,
        coveragePct: Number(epochCoveragePct.toFixed(2)),
        contiguousCoveragePct: Number(contiguousEpochCoveragePct.toFixed(2)),
        missingLatest: missingEpochs.slice(-20),
      },
      catchUp: {
        phase: syncState,
        totalBlocksToIndex,
        indexedBlocksToCurrentHead,
        blockProgressPct: Number(blockProgressPct.toFixed(2)),
        epochCoveragePct: Number(epochCoveragePct.toFixed(2)),
        contiguousEpochCoveragePct: Number(contiguousEpochCoveragePct.toFixed(2)),
        blockRatePerMinute,
        epochRatePerMinute,
        estimatedMinutesToHead,
        recentSamples: trendStore.__loreDataSyncTrendHistory?.map((sample) => ({
          ts: sample.ts,
          lastIndexedBlock: sample.lastIndexedBlock?.toString() ?? null,
          storedEpochCount: sample.storedEpochCount,
          lagBlocks: sample.lagBlocks,
        })) ?? [],
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
        network: APP_NETWORK,
        dbPath,
        deployBlock: DEPLOY_BLOCK.toString(),
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
