import { NextRequest, NextResponse } from "next/server";
import { statfsSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { formatUnits } from "viem";
import { GAME_ABI as READ_ABI } from "../../../../config/generated/lineaOreV10Abi";
import {
  DEFAULT_DATA_SYNC_LAG_WARN_BLOCKS,
  getConfiguredDeployBlock,
  getConfiguredLineaNetwork,
} from "../../../../config/publicConfig";
import {
  parseOptionalNonNegativeNumberEnv,
  parseOptionalPositiveIntegerEnv,
} from "../../../../config/envParsing";
import {
  fetchStorageJson,
  parseCurrentEpoch,
  publicClient,
  CONTRACT_ADDRESS,
} from "../../_lib/dataBridge";
import { createRouteCache } from "../../_lib/routeCache";
import { describeSafeRouteError, logRouteError } from "../../_lib/routeError";
import { applyNoStoreHeaders } from "../../_lib/responseHeaders";
import { isAuthorizedHealthDiagnosticsRequest } from "../_lib/diagnosticsAuth";
import { enforceSharedRateLimit } from "../../_lib/sharedRateLimit";
import { dbPath } from "../../../../server/db";
import { getMetaJson, getRecentRewardClaims } from "../../../../server/storage";
import {
  getIndexerFinalityTargetBlock,
  getIndexerTargetLagBlocks,
  parseIndexerFinalityBlocks,
} from "../../../lib/indexerFinality";
import { summarizeEpochCoverage } from "./epochCoverage";
import {
  ageMs,
  bigintToNonNegativeSafeNumber,
  parseChainUintNumber,
  parseStatusBlockString,
  parseStatusCounter,
  parseStatusEpochList,
  parseStatusPositiveInteger,
  parseStatusTimestamp,
  parseStoredBlockNumber,
  parseStoredEpochNumber,
  safeNonNegativeBigintDelta,
  toNum,
} from "./dataSyncHealthPolicy";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const LAG_WARN_BLOCKS = parseOptionalNonNegativeNumberEnv(
  process.env.DATA_SYNC_LAG_WARN_BLOCKS,
  DEFAULT_DATA_SYNC_LAG_WARN_BLOCKS,
);
const JACKPOT_RECOVERY_BLOCK_LAG = parseOptionalNonNegativeNumberEnv(process.env.JACKPOT_RECOVERY_BLOCK_LAG, 256);
const RECENT_WINS_RECOVERY_BLOCK_LAG = parseOptionalNonNegativeNumberEnv(process.env.RECENT_WINS_RECOVERY_BLOCK_LAG, 256);
const INDEXER_HEARTBEAT_STALE_MS = parseOptionalPositiveIntegerEnv(process.env.INDEXER_HEARTBEAT_STALE_MS, 180_000);
const INDEXER_FINALITY_BLOCKS = parseIndexerFinalityBlocks(process.env.INDEXER_FINALITY_BLOCKS);
const DATA_SYNC_CACHE_TTL_MS = parseOptionalPositiveIntegerEnv(process.env.DATA_SYNC_HEALTH_CACHE_TTL_MS, 15_000);
const DATA_SYNC_CACHE_KEY = "default";
const APP_NETWORK = getConfiguredLineaNetwork();
const DEPLOY_BLOCK = getConfiguredDeployBlock(
  process.env.INDEXER_START_BLOCK ?? process.env.NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK,
  APP_NETWORK,
);
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const dataSyncHealthCache = createRouteCache<DataSyncHealthResponse>(1);

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
  completedAt?: number;
  lastHeartbeatAt?: number;
  fromBlock: string;
  toBlock: string;
  totalLogs: number;
  currentChunk?: number;
  totalChunks?: number;
  lastProcessedBlock?: string;
  blockedAt?: number;
  blockedReason?: "rpc_response_limit_single_block";
  blockedBlock?: string;
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
    currentEpoch: number | null;
    headBlock: string | null;
    finalityTargetBlock: string | null;
  };
  storage: {
    dbBytes: number | null;
    walBytes: number | null;
    shmBytes: number | null;
    diskFreeBytes: number | null;
    currentEpochMeta: number | null;
    lastIndexedBlock: string | null;
    repairCursorBlock: string | null;
    lagBlocks: number | null;
    lagToFinalityTargetBlocks: number | null;
    latestStoredJackpotBlock: string | null;
    latestRewardClaimBlock: string | null;
    rewardClaimsLagToHead: number | null;
    rewardClaimsLagToIndexer: number | null;
  };
  epochs: {
    expectedResolvedRange: string | null;
    storedCount: number | null;
    missingCount: number | null;
    latestStoredEpoch: number | null;
    highestContiguousEpoch: number | null;
    coveragePct: number | null;
    contiguousCoveragePct: number | null;
    missingLatest: number[];
  };
  catchUp: {
    phase: string;
    totalBlocksToIndex: number | null;
    indexedBlocksToCurrentHead: number | null;
    blockProgressPct: number | null;
    epochCoveragePct: number | null;
    contiguousEpochCoveragePct: number | null;
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
    lastDailyEpoch: number | null;
    lastDailyAmount: string | null;
    hasLatestDailyInDb: boolean | null;
    lastWeeklyEpoch: number | null;
    lastWeeklyAmount: string | null;
    hasLatestWeeklyInDb: boolean | null;
    totalStored: number | null;
    servingMode: string | null;
  };
  recentWins: {
    totalStored: number | null;
    latestRewardClaimBlock: string | null;
    lagToHeadBlocks: number | null;
    lagToIndexerBlocks: number | null;
    servingMode: string | null;
  };
  indexer: {
    run: {
      startedAt?: number;
      completedAt?: number;
      lastHeartbeatAt?: number;
      fromBlock?: string | null;
      toBlock?: string | null;
      totalLogs?: number;
      currentChunk?: number;
      totalChunks?: number;
      lastProcessedBlock?: string | null;
      blocked: boolean;
      blockedAt?: number;
      blockedReason?: "rpc_response_limit_single_block" | null;
      blockedBlock?: string | null;
      runCompletedAgeMs: number | null;
      runHeartbeatAgeMs: number | null;
      active: boolean;
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
    deployBlock: string | null;
    lagWarnBlocks: number | null;
    indexerFinalityBlocks: string | null;
    jackpotRecoveryBlockLag: number | null;
    recentWinsRecoveryBlockLag: number | null;
    indexerHeartbeatStaleMs: number | null;
  };
};

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
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
    contract: {
      currentEpoch: payload.contract.currentEpoch,
      headBlock: null,
      finalityTargetBlock: null,
    },
    storage: {
      dbBytes: null,
      walBytes: null,
      shmBytes: null,
      diskFreeBytes: null,
      currentEpochMeta: payload.storage.currentEpochMeta,
      lastIndexedBlock: null,
      repairCursorBlock: null,
      lagBlocks: payload.storage.lagBlocks,
      lagToFinalityTargetBlocks: payload.storage.lagToFinalityTargetBlocks,
      latestStoredJackpotBlock: null,
      latestRewardClaimBlock: null,
      rewardClaimsLagToHead: null,
      rewardClaimsLagToIndexer: null,
    },
    epochs: {
      expectedResolvedRange: null,
      storedCount: null,
      missingCount: payload.epochs.missingCount,
      latestStoredEpoch: null,
      highestContiguousEpoch: null,
      coveragePct: payload.epochs.coveragePct,
      contiguousCoveragePct: payload.epochs.contiguousCoveragePct,
      missingLatest: [],
    },
    catchUp: {
      ...payload.catchUp,
      totalBlocksToIndex: null,
      indexedBlocksToCurrentHead: null,
      blockRatePerMinute: null,
      epochRatePerMinute: null,
      estimatedMinutesToHead: null,
      recentSamples: [],
    },
    jackpots: {
      lastDailyEpoch: null,
      lastDailyAmount: null,
      hasLatestDailyInDb: null,
      lastWeeklyEpoch: null,
      lastWeeklyAmount: null,
      hasLatestWeeklyInDb: null,
      totalStored: null,
      servingMode: payload.jackpots.servingMode,
    },
    recentWins: {
      totalStored: null,
      latestRewardClaimBlock: null,
      lagToHeadBlocks: null,
      lagToIndexerBlocks: null,
      servingMode: payload.recentWins.servingMode,
    },
    indexer: {
      run: {
        runCompletedAgeMs: payload.indexer.run.runCompletedAgeMs,
        runHeartbeatAgeMs: payload.indexer.run.runHeartbeatAgeMs,
        active: payload.indexer.run.active,
        stale: payload.indexer.run.stale,
        fromBlock: null,
        toBlock: null,
        startedAt: undefined,
        completedAt: undefined,
        lastHeartbeatAt: undefined,
        totalLogs: undefined,
        currentChunk: undefined,
        totalChunks: undefined,
        lastProcessedBlock: null,
        blocked: payload.indexer.run.blocked,
        blockedAt: undefined,
        blockedReason: null,
        blockedBlock: null,
      },
      repair: {
        ageMs: payload.indexer.repair.ageMs,
        stale: payload.indexer.repair.stale,
        fromBlock: null,
        toBlock: null,
        at: undefined,
        repairedLogs: undefined,
      },
      reconcile: {
        ageMs: payload.indexer.reconcile.ageMs,
        stale: payload.indexer.reconcile.stale,
        at: undefined,
        currentEpoch: undefined,
        missingEpochs: payload.indexer.reconcile.missingEpochs,
        repairedEpochs: undefined,
        targetEpochs: [],
      },
    },
    hints: [
      ...payload.hints,
      "Sensitive diagnostics are redacted from the public health response.",
    ],
    env: {
      network: payload.env.network,
      dbPath: null,
      deployBlock: null,
      lagWarnBlocks: null,
      indexerFinalityBlocks: payload.env.indexerFinalityBlocks,
      jackpotRecoveryBlockLag: null,
      recentWinsRecoveryBlockLag: null,
      indexerHeartbeatStaleMs: null,
    },
  };
}

function safeFileSize(filePath: string) {
  try {
    return statSync(filePath).size;
  } catch {
    return null;
  }
}

function safeDiskFreeBytes(filePath: string) {
  try {
    const stats = statfsSync(dirname(filePath), { bigint: true });
    const bytes = stats.bavail * stats.bsize;
    return Number(bytes > MAX_SAFE_INTEGER_BIGINT ? MAX_SAFE_INTEGER_BIGINT : bytes);
  } catch {
    return null;
  }
}

async function buildDataSyncHealthPayload() {
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
      fetchStorageJson<number>("gamedata/_meta/currentEpoch"),
      fetchStorageJson<string>("gamedata/_meta/lastIndexedBlock"),
      fetchStorageJson<string>("gamedata/_meta/repairCursorBlock"),
      fetchStorageJson<Record<string, EpochRow>>("gamedata/epochs"),
      fetchStorageJson<Record<string, JackpotRow>>("gamedata/jackpots"),
    ]);
  const indexerRunStatus = getMetaJson<IndexerRunStatus>("indexerRunStatus");
  const indexerRepairStatus = getMetaJson<IndexerRepairStatus>("indexerRepairStatus");
  const indexerReconcileStatus = getMetaJson<IndexerReconcileStatus>("indexerReconcileStatus");
  const recentRewardClaims = getRecentRewardClaims(100);

  const chainCurrentEpoch = parseChainUintNumber(chainEpochRaw);
  const dbCurrentEpoch = parseCurrentEpoch(dbEpochMeta.data);
  const dbLastIndexedBlock = dbLastIndexed.ok ? parseStoredBlockNumber(dbLastIndexed.data) : null;
  const dbRepairCursorBlock = dbRepairCursor.ok ? parseStoredBlockNumber(dbRepairCursor.data) : null;
  const finalityTargetBlock = getIndexerFinalityTargetBlock(head, INDEXER_FINALITY_BLOCKS);
  const dbLastIndexedAheadOfHead = dbLastIndexedBlock !== null && dbLastIndexedBlock > head;
  const lagBlocks = dbLastIndexedBlock !== null ? safeNonNegativeBigintDelta(head, dbLastIndexedBlock) : null;
  const lagToFinalityTargetBlocks = getIndexerTargetLagBlocks(dbLastIndexedBlock, finalityTargetBlock);

  const dbEpochs = dbEpochsRaw.ok && dbEpochsRaw.data ? dbEpochsRaw.data : {};
  const maxEpochToCheck = chainCurrentEpoch !== null ? Math.max(0, chainCurrentEpoch - 1) : 0;
  const presentEpochs = new Set<number>(
    Object.keys(dbEpochs)
      .map((key) => parseStoredEpochNumber(key))
      .filter((epoch): epoch is number => epoch !== null && epoch <= maxEpochToCheck),
  );

  const {
    missingCount: missingEpochCount,
    latestStoredEpoch,
    highestContiguousEpoch,
    missingLatest: missingLatestEpochs,
  } = summarizeEpochCoverage(presentEpochs, maxEpochToCheck);

  const jackpotsInfo = jackpotInfoRaw as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
  const lastDailyEpoch = parseChainUintNumber(jackpotsInfo[4]);
  const lastWeeklyEpoch = parseChainUintNumber(jackpotsInfo[5]);
  const lastDailyAmount = formatUnits(jackpotsInfo[6], 18);
  const lastWeeklyAmount = formatUnits(jackpotsInfo[7], 18);

  const dbJackpots = dbJackpotsRaw.ok && dbJackpotsRaw.data ? Object.values(dbJackpotsRaw.data) : [];
  const dbJackpotKeys = new Set<string>(
    dbJackpots
      .filter((j) => j && (j.kind === "daily" || j.kind === "weekly"))
      .map((j) => `${j.kind}_${j.epoch}`),
  );
  const jackpotBlocks = dbJackpots
    .map((row) => parseStoredBlockNumber(row.blockNumber))
    .filter((value): value is bigint => value !== null && value > 0n);
  const latestStoredJackpotBlock = jackpotBlocks.length > 0
    ? jackpotBlocks.reduce((max, value) => (value > max ? value : max), 0n)
    : null;

  const hasLatestDailyInDb = lastDailyEpoch === null ? false : lastDailyEpoch > 0 ? dbJackpotKeys.has(`daily_${lastDailyEpoch}`) : true;
  const hasLatestWeeklyInDb = lastWeeklyEpoch === null ? false : lastWeeklyEpoch > 0 ? dbJackpotKeys.has(`weekly_${lastWeeklyEpoch}`) : true;
  const rewardClaimBlocks = recentRewardClaims
    .map((row) => parseStoredBlockNumber(row.blockNumber))
    .filter((value): value is bigint => value !== null && value > 0n);
  const latestRewardClaimBlock = rewardClaimBlocks.length > 0
    ? rewardClaimBlocks.reduce((max, value) => (value > max ? value : max), 0n)
    : null;
  const rewardClaimsLagToHead =
    latestRewardClaimBlock !== null
      ? safeNonNegativeBigintDelta(head, latestRewardClaimBlock)
      : null;
  const rewardClaimsLagToIndexer =
    dbLastIndexedBlock !== null && latestRewardClaimBlock !== null
      ? safeNonNegativeBigintDelta(dbLastIndexedBlock, latestRewardClaimBlock)
      : null;

  const totalBlocksToIndex =
    head >= DEPLOY_BLOCK
      ? bigintToNonNegativeSafeNumber(head - DEPLOY_BLOCK + 1n)
      : 0;
  const indexedBlocksToCurrentHead =
    dbLastIndexedBlock !== null && dbLastIndexedBlock >= DEPLOY_BLOCK
      ? bigintToNonNegativeSafeNumber((dbLastIndexedBlock > head ? head : dbLastIndexedBlock) - DEPLOY_BLOCK + 1n)
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
    const deltaBlocks = safeNonNegativeBigintDelta(dbLastIndexedBlock, previousSample.lastIndexedBlock);
    const deltaEpochs = presentEpochs.size - previousSample.storedEpochCount;
    if (elapsedMs >= 5_000 && deltaBlocks !== null && deltaBlocks > 0) {
      blockRatePerMinute = Number(((deltaBlocks * 60_000) / elapsedMs).toFixed(2));
      epochRatePerMinute = Number(((deltaEpochs * 60_000) / elapsedMs).toFixed(2));
      const effectiveLag = lagToFinalityTargetBlocks ?? lagBlocks;
      if (effectiveLag !== null && blockRatePerMinute > 0) {
        estimatedMinutesToHead = Number((effectiveLag / blockRatePerMinute).toFixed(1));
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
      : lagToFinalityTargetBlocks !== null && lagToFinalityTargetBlocks <= LAG_WARN_BLOCKS && missingEpochCount === 0
        ? "synced"
        : lagToFinalityTargetBlocks !== null && lagToFinalityTargetBlocks <= Math.max(LAG_WARN_BLOCKS, 512) && missingEpochCount <= 3
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
  const runCompletedAt = parseStatusTimestamp(indexerRunStatus?.completedAt);
  const runHeartbeatAt = parseStatusTimestamp(indexerRunStatus?.lastHeartbeatAt);
  const runStartedAt = parseStatusTimestamp(indexerRunStatus?.startedAt);
  const runBlockedAt = parseStatusTimestamp(indexerRunStatus?.blockedAt);
  const runBlockedReason = indexerRunStatus?.blockedReason === "rpc_response_limit_single_block"
    ? indexerRunStatus.blockedReason
    : null;
  const runBlockedBlock = parseStatusBlockString(indexerRunStatus?.blockedBlock);
  const runIsBlocked =
    runBlockedAt !== null &&
    runBlockedReason !== null &&
    runBlockedBlock !== null;
  const repairAt = parseStatusTimestamp(indexerRepairStatus?.at);
  const reconcileAt = parseStatusTimestamp(indexerReconcileStatus?.at);
  const runCompletedAgeMs = ageMs(runCompletedAt, now);
  const runHeartbeatAgeMs = ageMs(runHeartbeatAt, now);
  const repairAgeMs = ageMs(repairAt, now);
  const reconcileAgeMs = ageMs(reconcileAt, now);
  const effectiveIndexerLagForStaleness = lagToFinalityTargetBlocks ?? lagBlocks;
  const runIsActive =
    runHeartbeatAgeMs !== null &&
    runHeartbeatAgeMs <= INDEXER_HEARTBEAT_STALE_MS &&
    runHeartbeatAt !== null &&
    runCompletedAt !== null &&
    runHeartbeatAt > runCompletedAt;
  const runIsStale =
    !runIsActive &&
    (
      (runCompletedAgeMs !== null && runCompletedAgeMs > INDEXER_HEARTBEAT_STALE_MS) ||
      (
        indexerRunStatus?.completedAt === undefined &&
        runHeartbeatAgeMs !== null &&
        runHeartbeatAgeMs > INDEXER_HEARTBEAT_STALE_MS
      )
    );
  const nearHeadGapIsTolerable =
    syncState === "near_head" &&
    missingEpochCount > 0 &&
    missingEpochCount <= 3;
  const missingEpochsAreStale =
    !nearHeadGapIsTolerable &&
    missingEpochCount > 0 &&
    reconcileAgeMs !== null &&
    reconcileAgeMs > INDEXER_HEARTBEAT_STALE_MS;
  const degraded =
    runIsBlocked ||
    (lagToFinalityTargetBlocks !== null && lagToFinalityTargetBlocks > LAG_WARN_BLOCKS) ||
    (syncState === "catching_up" && missingEpochCount > 0) ||
    missingEpochsAreStale ||
    !hasLatestDailyInDb ||
    !hasLatestWeeklyInDb ||
    runIsStale ||
    chainCurrentEpoch === null ||
    dbLastIndexedAheadOfHead ||
    (dbCurrentEpoch !== null && Math.abs(dbCurrentEpoch - chainCurrentEpoch) > 1);

  return {
      status: degraded ? "degraded" : "healthy",
      visibility: "private",
      redacted: false,
      contract: {
        currentEpoch: chainCurrentEpoch,
        headBlock: head.toString(),
        finalityTargetBlock: finalityTargetBlock?.toString() ?? null,
      },
      storage: {
        dbBytes: safeFileSize(dbPath),
        walBytes: safeFileSize(`${dbPath}-wal`),
        shmBytes: safeFileSize(`${dbPath}-shm`),
        diskFreeBytes: safeDiskFreeBytes(dbPath),
        currentEpochMeta: dbCurrentEpoch,
        lastIndexedBlock: dbLastIndexedBlock?.toString() ?? null,
        repairCursorBlock: dbRepairCursorBlock?.toString() ?? null,
        lagBlocks,
        lagToFinalityTargetBlocks,
        latestStoredJackpotBlock: latestStoredJackpotBlock?.toString() ?? null,
        latestRewardClaimBlock: latestRewardClaimBlock?.toString() ?? null,
        rewardClaimsLagToHead,
        rewardClaimsLagToIndexer,
      },
      epochs: {
        expectedResolvedRange: maxEpochToCheck > 0 ? `1..${maxEpochToCheck}` : "none",
        storedCount: presentEpochs.size,
        missingCount: missingEpochCount,
        latestStoredEpoch,
        highestContiguousEpoch,
        coveragePct: Number(epochCoveragePct.toFixed(2)),
        contiguousCoveragePct: Number(contiguousEpochCoveragePct.toFixed(2)),
        missingLatest: missingLatestEpochs,
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
          startedAt: runStartedAt ?? undefined,
          completedAt: runCompletedAt ?? undefined,
          lastHeartbeatAt: runHeartbeatAt ?? undefined,
          fromBlock: parseStatusBlockString(indexerRunStatus?.fromBlock) ?? undefined,
          toBlock: parseStatusBlockString(indexerRunStatus?.toBlock) ?? undefined,
          totalLogs: parseStatusCounter(indexerRunStatus?.totalLogs) ?? 0,
          currentChunk: parseStatusPositiveInteger(indexerRunStatus?.currentChunk),
          totalChunks: parseStatusPositiveInteger(indexerRunStatus?.totalChunks),
          lastProcessedBlock: parseStatusBlockString(indexerRunStatus?.lastProcessedBlock) ?? undefined,
          blocked: runIsBlocked,
          blockedAt: runBlockedAt ?? undefined,
          blockedReason: runBlockedReason,
          blockedBlock: runBlockedBlock,
          runCompletedAgeMs,
          runHeartbeatAgeMs,
          active: runIsActive,
          stale: runIsStale,
        },
        repair: {
          at: repairAt ?? undefined,
          fromBlock: parseStatusBlockString(indexerRepairStatus?.fromBlock) ?? undefined,
          toBlock: parseStatusBlockString(indexerRepairStatus?.toBlock) ?? undefined,
          repairedLogs: parseStatusCounter(indexerRepairStatus?.repairedLogs),
          ageMs: repairAgeMs,
          stale:
            repairAgeMs !== null &&
            effectiveIndexerLagForStaleness !== null &&
            effectiveIndexerLagForStaleness > LAG_WARN_BLOCKS &&
            repairAgeMs > INDEXER_HEARTBEAT_STALE_MS,
        },
        reconcile: {
          at: reconcileAt ?? undefined,
          currentEpoch: parseStatusPositiveInteger(indexerReconcileStatus?.currentEpoch),
          missingEpochs: parseStatusCounter(indexerReconcileStatus?.missingEpochs),
          repairedEpochs: parseStatusCounter(indexerReconcileStatus?.repairedEpochs),
          targetEpochs: parseStatusEpochList(indexerReconcileStatus?.targetEpochs),
          ageMs: reconcileAgeMs,
          stale:
            !nearHeadGapIsTolerable &&
            reconcileAgeMs !== null &&
            missingEpochCount > 0 &&
            reconcileAgeMs > INDEXER_HEARTBEAT_STALE_MS,
        },
      },
      hints: [
        missingEpochCount > 0 && !nearHeadGapIsTolerable ? "Indexer repair/reconcile is still catching up missing epochs." : null,
        lagToFinalityTargetBlocks !== null && lagToFinalityTargetBlocks > LAG_WARN_BLOCKS ? "Indexer is lagging behind the finality target; check bot/indexer supervisor." : null,
        dbLastIndexedAheadOfHead ? "Indexer DB cursor is ahead of the current chain head; verify chain and DB scope." : null,
        !hasLatestDailyInDb || !hasLatestWeeklyInDb ? "Latest jackpot event not in DB yet; API fallback should still show it." : null,
        jackpotServingMode !== "indexer_fast_path" ? "Jackpots API is in recovery-capable mode and may pull a fresh tail from chain." : null,
        recentWinsServingMode !== "indexer_fast_path" ? "Recent wins API is in recovery-capable mode and may pull RewardClaimed logs from chain." : null,
        runIsActive ? "Indexer watch loop is actively catching up." : null,
        runIsStale ? "Indexer heartbeat is stale; watch loop may be stuck or down." : null,
        runIsBlocked ? "Indexer stopped on a one-block RPC response limit; operator intervention is required before a manual restart." : null,
      ].filter((hint): hint is string => Boolean(hint)),
      ts: Date.now(),
      env: {
        network: APP_NETWORK,
        dbPath,
        deployBlock: DEPLOY_BLOCK.toString(),
        lagWarnBlocks: toNum(LAG_WARN_BLOCKS),
        indexerFinalityBlocks: INDEXER_FINALITY_BLOCKS.toString(),
        jackpotRecoveryBlockLag: toNum(JACKPOT_RECOVERY_BLOCK_LAG),
        recentWinsRecoveryBlockLag: toNum(RECENT_WINS_RECOVERY_BLOCK_LAG),
        indexerHeartbeatStaleMs: toNum(INDEXER_HEARTBEAT_STALE_MS),
      },
    } satisfies DataSyncHealthResponse;
}

function toHealthResponse(authorized: boolean, payload: DataSyncHealthResponse) {
  return applyNoStoreHeaders(NextResponse.json(
    authorized ? payload : redactHealthResponse(payload),
  ));
}

function toHealthErrorResponse(authorized: boolean, err: unknown) {
  const privateError = describeSafeRouteError(err).message;
  return applyNoStoreHeaders(NextResponse.json(
    {
      status: "error",
      error: authorized ? privateError : "Internal error",
    },
    {
      status: 500,
    },
  ));
}

function scheduleDataSyncRefresh() {
  if (dataSyncHealthCache.getRefresh(DATA_SYNC_CACHE_KEY)) {
    return;
  }

  const version = dataSyncHealthCache.beginWrite(DATA_SYNC_CACHE_KEY);
  const refreshPromise: Promise<void> = buildDataSyncHealthPayload()
    .then((payload) => {
      dataSyncHealthCache.setIfLatest(DATA_SYNC_CACHE_KEY, payload, DATA_SYNC_CACHE_TTL_MS, version);
    })
    .catch((error) => {
      logRouteError("api/health/data-sync", error, { phase: "background-refresh" });
    })
    .finally(() => {
      dataSyncHealthCache.finishWrite(DATA_SYNC_CACHE_KEY, version);
      dataSyncHealthCache.clearRefresh(DATA_SYNC_CACHE_KEY, refreshPromise);
    });

  dataSyncHealthCache.setRefresh(DATA_SYNC_CACHE_KEY, refreshPromise);
}

export async function GET(request: NextRequest) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-health-data-sync",
    limit: 10,
    windowMs: 60_000,
  });
  if (rateLimited) return applyNoStoreHeaders(rateLimited);
  const authorized = await isAuthorizedHealthDiagnosticsRequest(request);

  const fresh = dataSyncHealthCache.getFresh(DATA_SYNC_CACHE_KEY);
  if (fresh) {
    return toHealthResponse(authorized, fresh);
  }

  const inflight = dataSyncHealthCache.getInflight(DATA_SYNC_CACHE_KEY);
  if (inflight) {
    try {
      return toHealthResponse(authorized, await inflight);
    } catch (err) {
      logRouteError("api/health/data-sync", err);
      return toHealthErrorResponse(authorized, err);
    }
  }

  const stale = dataSyncHealthCache.getStale(DATA_SYNC_CACHE_KEY);

  const version = dataSyncHealthCache.beginWrite(DATA_SYNC_CACHE_KEY);
  const requestPromise: Promise<DataSyncHealthResponse> = buildDataSyncHealthPayload()
    .then((payload) => {
      return dataSyncHealthCache.setIfLatest(DATA_SYNC_CACHE_KEY, payload, DATA_SYNC_CACHE_TTL_MS, version);
    })
    .finally(() => {
      dataSyncHealthCache.finishWrite(DATA_SYNC_CACHE_KEY, version);
      dataSyncHealthCache.clearInflight(DATA_SYNC_CACHE_KEY, requestPromise);
    });
  dataSyncHealthCache.setInflight(DATA_SYNC_CACHE_KEY, requestPromise);

  try {
    return toHealthResponse(authorized, await requestPromise);
  } catch (err) {
    logRouteError("api/health/data-sync", err);
    if (stale) {
      scheduleDataSyncRefresh();
      return toHealthResponse(authorized, stale);
    }
    return toHealthErrorResponse(authorized, err);
  }
}
