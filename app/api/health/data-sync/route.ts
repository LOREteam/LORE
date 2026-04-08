import { NextRequest, NextResponse } from "next/server";
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
import { isAuthorizedHealthDiagnosticsRequest } from "../_lib/diagnosticsAuth";
import { dbPath } from "../../../../server/db";
import { getMetaJson, getRecentRewardClaims } from "../../../../server/storage";

const READ_ABI = parseAbi([
  "function currentEpoch() view returns (uint256)",
  "function getJackpotInfo() view returns (uint256 dailyPool, uint256 weeklyPool, uint256 lastDailyDay, uint256 lastWeeklyWeek, uint256 lastDailyEpoch, uint256 lastWeeklyEpoch, uint256 lastDailyAmount, uint256 lastWeeklyAmount)",
]);

const LAG_WARN_BLOCKS = Number(process.env.DATA_SYNC_LAG_WARN_BLOCKS ?? String(DEFAULT_DATA_SYNC_LAG_WARN_BLOCKS));
const JACKPOT_RECOVERY_BLOCK_LAG = Number(process.env.JACKPOT_RECOVERY_BLOCK_LAG ?? "256");
const RECENT_WINS_RECOVERY_BLOCK_LAG = Number(process.env.RECENT_WINS_RECOVERY_BLOCK_LAG ?? "256");
const INDEXER_HEARTBEAT_STALE_MS = Number(process.env.INDEXER_HEARTBEAT_STALE_MS ?? "180000");
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
  blockNumber?: string;
};

type SyncTrendSample = {
  ts: number;
  headBlock: bigint;
  lastIndexedBlock: bigint | null;
  storedEpochCount: number;
  lagBlocks: number | null;
};

type IndexerRunStatus = {
  startedAt: number;
  completedAt: number;
  fromBlock: string;
  toBlock: string;
  totalLogs: number;
};

type IndexerRepairStatus = {
  at: number;
  fromBlock: string;
  toBlock: string;
  repairedLogs: number;
};

type IndexerReconcileStatus = {
  at: number;
  currentEpoch: number;
  missingEpochs: number;
  repairedEpochs: number;
  targetEpochs: number[];
};

type GlobalWithDataSyncTrend = typeof globalThis & {
  __loreDataSyncTrend?: SyncTrendSample;
  __loreDataSyncTrendHistory?: SyncTrendSample[];
};

type DataSyncHealthResponse = {
  status: string;
  visibility: "public" | "private";
  redacted: boolean;
  contract: {
    currentEpoch: number;
    headBlock: string;
  };
  storage: {
    currentEpochMeta: number | null;
    lastIndexedBlock: string | null;
    repairCursorBlock: string | null;
    lagBlocks: number | null;
    latestStoredJackpotBlock: string | null;
    latestRewardClaimBlock: string | null;
    rewardClaimsLagToHead: number | null;
    rewardClaimsLagToIndexer: number | null;
  };
  epochs: {
    expectedResolvedRange: string;
    storedCount: number;
    missingCount: number;
    latestStoredEpoch: number | null;
    highestContiguousEpoch: number | null;
    coveragePct: number;
    contiguousCoveragePct: number;
    missingLatest: number[];
  };
  catchUp: {
    phase: string;
    totalBlocksToIndex: number;
    indexedBlocksToCurrentHead: number;
    blockProgressPct: number;
    epochCoveragePct: number;
    contiguousEpochCoveragePct: number;
    blockRatePerMinute: number | null;
    epochRatePerMinute: number | null;
    estimatedMinutesToHead: number | null;
    recentSamples: Array<{
      ts: number;
      lastIndexedBlock: string | null;
      storedEpochCount: number;
      lagBlocks: number | null;
    }>;
  };
  jackpots: {
    lastDailyEpoch: number;
    lastDailyAmount: string;
    hasLatestDailyInDb: boolean;
    lastWeeklyEpoch: number;
    lastWeeklyAmount: string;
    hasLatestWeeklyInDb: boolean;
    totalStored: number;
    servingMode: string;
  };
  recentWins: {
    totalStored: number;
    latestRewardClaimBlock: string | null;
    lagToHeadBlocks: number | null;
    lagToIndexerBlocks: number | null;
    servingMode: string;
  };
  indexer: {
    run: {
      startedAt?: number;
      completedAt?: number;
      fromBlock?: string | null;
      toBlock?: string | null;
      totalLogs?: number;
      runCompletedAgeMs: number | null;
      stale: boolean;
    };
    repair: {
      at?: number;
      fromBlock?: string | null;
      toBlock?: string | null;
      repairedLogs?: number;
      ageMs: number | null;
      stale: boolean;
    };
    reconcile: {
      at?: number;
      currentEpoch?: number;
      missingEpochs?: number;
      repairedEpochs?: number;
      targetEpochs?: number[];
      ageMs: number | null;
      stale: boolean;
    };
  };
  hints: string[];
  ts: number;
  env: {
    network: string;
    dbPath: string | null;
    deployBlock: string;
    lagWarnBlocks: number | null;
    jackpotRecoveryBlockLag: number | null;
    recentWinsRecoveryBlockLag: number | null;
    indexerHeartbeatStaleMs: number | null;
  };
};

function toNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function ageMs(timestamp: number | null, now: number) {
  if (!Number.isFinite(timestamp ?? NaN)) return null;
  return Math.max(0, now - Number(timestamp));
}

function deriveServingMode(options: {
  lagBlocks: number | null;
  recoveryThreshold: number;
  storedCount: number;
}) {
  const { lagBlocks, recoveryThreshold, storedCount } = options;
  if (storedCount === 0) return "bootstrap_recovery_needed";
  if (lagBlocks === null) return "bootstrap_recovery_needed";
  if (lagBlocks > recoveryThreshold) return "hybrid_recovery_needed";
  return "indexer_fast_path";
}

function redactHealthResponse(payload: DataSyncHealthResponse): DataSyncHealthResponse {
  return {
    ...payload,
    visibility: "public",
    redacted: true,
    catchUp: {
      ...payload.catchUp,
      recentSamples: [],
    },
    indexer: {
      run: {
        ...payload.indexer.run,
        fromBlock: null,
        toBlock: null,
      },
      repair: {
        ...payload.indexer.repair,
        fromBlock: null,
        toBlock: null,
      },
      reconcile: {
        ...payload.indexer.reconcile,
        targetEpochs: [],
      },
    },
    hints: [
      ...payload.hints,
      "Sensitive diagnostics are redacted from the public health response.",
    ],
    env: {
      ...payload.env,
      dbPath: null,
    },
  };
}

export async function GET(request: NextRequest) {
  try {
    const now = Date.now();
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
    const indexerRunStatus = getMetaJson<IndexerRunStatus>("indexerRunStatus");
    const indexerRepairStatus = getMetaJson<IndexerRepairStatus>("indexerRepairStatus");
    const indexerReconcileStatus = getMetaJson<IndexerReconcileStatus>("indexerReconcileStatus");
    const recentRewardClaims = getRecentRewardClaims(100);

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
    const jackpotBlocks = dbJackpots
      .map((row) => Number(row.blockNumber ?? 0))
      .filter((value) => Number.isFinite(value) && value > 0);
    const latestStoredJackpotBlock = jackpotBlocks.length > 0 ? Math.max(...jackpotBlocks) : null;

    const hasLatestDailyInDb = lastDailyEpoch > 0 ? dbJackpotKeys.has(`daily_${lastDailyEpoch}`) : true;
    const hasLatestWeeklyInDb = lastWeeklyEpoch > 0 ? dbJackpotKeys.has(`weekly_${lastWeeklyEpoch}`) : true;
    const latestRewardClaimBlock =
      recentRewardClaims.length > 0
        ? Math.max(
            ...recentRewardClaims
              .map((row) => Number(row.blockNumber))
              .filter((value) => Number.isFinite(value) && value > 0),
          )
        : null;
    const rewardClaimsLagToHead =
      latestRewardClaimBlock !== null
        ? Number(head - BigInt(latestRewardClaimBlock))
        : null;
    const rewardClaimsLagToIndexer =
      dbLastIndexedBlock !== null && latestRewardClaimBlock !== null
        ? Math.max(0, Number(dbLastIndexedBlock - BigInt(latestRewardClaimBlock)))
        : null;

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

    const jackpotServingMode = deriveServingMode({
      lagBlocks,
      recoveryThreshold: JACKPOT_RECOVERY_BLOCK_LAG,
      storedCount: dbJackpots.length,
    });
    const recentWinsServingMode = deriveServingMode({
      lagBlocks,
      recoveryThreshold: RECENT_WINS_RECOVERY_BLOCK_LAG,
      storedCount: recentRewardClaims.length,
    });
    const runCompletedAgeMs = ageMs(indexerRunStatus?.completedAt ?? null, now);
    const repairAgeMs = ageMs(indexerRepairStatus?.at ?? null, now);
    const reconcileAgeMs = ageMs(indexerReconcileStatus?.at ?? null, now);
    const degraded =
      (lagBlocks !== null && lagBlocks > LAG_WARN_BLOCKS) ||
      missingEpochs.length > 0 ||
      !hasLatestDailyInDb ||
      !hasLatestWeeklyInDb ||
      (runCompletedAgeMs !== null && runCompletedAgeMs > INDEXER_HEARTBEAT_STALE_MS) ||
      (dbCurrentEpoch !== null && Math.abs(dbCurrentEpoch - chainCurrentEpoch) > 1);

    const payload: DataSyncHealthResponse = {
      status: degraded ? "degraded" : "healthy",
      visibility: "private",
      redacted: false,
      contract: {
        currentEpoch: chainCurrentEpoch,
        headBlock: head.toString(),
      },
      storage: {
        currentEpochMeta: dbCurrentEpoch,
        lastIndexedBlock: dbLastIndexedBlock?.toString() ?? null,
        repairCursorBlock: dbRepairCursorBlock?.toString() ?? null,
        lagBlocks,
        latestStoredJackpotBlock: latestStoredJackpotBlock?.toString() ?? null,
        latestRewardClaimBlock: latestRewardClaimBlock?.toString() ?? null,
        rewardClaimsLagToHead,
        rewardClaimsLagToIndexer,
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
        servingMode: jackpotServingMode,
      },
      recentWins: {
        totalStored: recentRewardClaims.length,
        latestRewardClaimBlock: latestRewardClaimBlock?.toString() ?? null,
        lagToHeadBlocks: rewardClaimsLagToHead,
        lagToIndexerBlocks: rewardClaimsLagToIndexer,
        servingMode: recentWinsServingMode,
      },
      indexer: {
        run: {
          ...(indexerRunStatus ?? {}),
          runCompletedAgeMs,
          stale: runCompletedAgeMs !== null && runCompletedAgeMs > INDEXER_HEARTBEAT_STALE_MS,
        },
        repair: {
          ...(indexerRepairStatus ?? {}),
          ageMs: repairAgeMs,
          stale:
            repairAgeMs !== null &&
            lagBlocks !== null &&
            lagBlocks > LAG_WARN_BLOCKS &&
            repairAgeMs > INDEXER_HEARTBEAT_STALE_MS,
        },
        reconcile: {
          ...(indexerReconcileStatus ?? {}),
          ageMs: reconcileAgeMs,
          stale:
            reconcileAgeMs !== null &&
            missingEpochs.length > 0 &&
            reconcileAgeMs > INDEXER_HEARTBEAT_STALE_MS,
        },
      },
      hints: [
        missingEpochs.length > 0 ? "Indexer repair/reconcile is still catching up missing epochs." : null,
        lagBlocks !== null && lagBlocks > LAG_WARN_BLOCKS ? "Indexer is lagging by blocks; check bot/indexer supervisor." : null,
        !hasLatestDailyInDb || !hasLatestWeeklyInDb ? "Latest jackpot event not in DB yet; API fallback should still show it." : null,
        jackpotServingMode !== "indexer_fast_path" ? "Jackpots API is in recovery-capable mode and may pull a fresh tail from chain." : null,
        recentWinsServingMode !== "indexer_fast_path" ? "Recent wins API is in recovery-capable mode and may pull RewardClaimed logs from chain." : null,
        runCompletedAgeMs !== null && runCompletedAgeMs > INDEXER_HEARTBEAT_STALE_MS ? "Indexer heartbeat is stale; watch loop may be stuck or down." : null,
      ].filter((hint): hint is string => Boolean(hint)),
      ts: Date.now(),
      env: {
        network: APP_NETWORK,
        dbPath,
        deployBlock: DEPLOY_BLOCK.toString(),
        lagWarnBlocks: toNum(LAG_WARN_BLOCKS),
        jackpotRecoveryBlockLag: toNum(JACKPOT_RECOVERY_BLOCK_LAG),
        recentWinsRecoveryBlockLag: toNum(RECENT_WINS_RECOVERY_BLOCK_LAG),
        indexerHeartbeatStaleMs: toNum(INDEXER_HEARTBEAT_STALE_MS),
      },
    };

    return NextResponse.json(
      isAuthorizedHealthDiagnosticsRequest(request) ? payload : redactHealthResponse(payload),
    );
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
