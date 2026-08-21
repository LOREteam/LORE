import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as liveStateSnapshotModule from "../app/hooks/useGameLiveStateSnapshot.ts";
import * as cacheTimestampModule from "../app/lib/cacheTimestamp.ts";
import * as gameCountdownModule from "../app/hooks/useGameCountdown.ts";
import * as globalStatsModule from "../app/hooks/useGlobalStats.ts";
import * as globalStatsRuntimeModule from "../app/lib/globalStatsRuntime.ts";
import * as depositHistoryModule from "../app/hooks/useDepositHistory.ts";
import * as jackpotHistoryModule from "../app/hooks/useJackpotHistory.ts";
import * as recentWinsModule from "../app/hooks/useRecentWins.ts";
import * as leaderboardsModule from "../app/hooks/useLeaderboards.ts";
import * as pageAncillaryModule from "../app/hooks/usePageAncillaryData.ts";
import * as analyticsAncillaryModule from "../app/hooks/useAnalyticsAncillaryData.ts";
import * as analyticsDepositsPanelModule from "../app/components/analytics/AnalyticsDepositsPanel.tsx";
import * as analyticsJackpotHistoryPanelModule from "../app/components/analytics/AnalyticsJackpotHistoryPanel.tsx";
import * as rebateModule from "../app/hooks/useRebate.ts";
import * as storedNumberParsingModule from "../app/api/_lib/storedNumberParsing.ts";
import * as readModelCacheModule from "../app/lib/readModelCache.ts";

function createMemoryReadStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  const reads = [];
  const removals = [];
  const writes = [];
  return {
    reads,
    removals,
    writes,
    getItem(key) {
      reads.push(key);
      return values.get(key) ?? null;
    },
    removeItem(key) {
      removals.push(key);
      values.delete(key);
    },
    setItem(key, value) {
      writes.push([key, value]);
      values.set(key, value);
    },
    has(key) {
      return values.has(key);
    },
  };
}

function assertReadModelCacheInvalidationPolicy(candidate) {
  const storage = createMemoryReadStorage({ target: "{", unrelated: "keep" });
  const result = candidate({
    storage,
    cacheKey: "target",
    payloadKey: "rows",
    emptyValue: [],
    normalizePayload: (value) => Array.isArray(value) ? value.filter(Number.isSafeInteger) : [],
  });
  assert.deepEqual(result, { value: [], savedAt: null });
  assert.deepEqual(storage.removals, ["target"], "malformed cache must purge exactly its own key");
  assert.equal(storage.has("target"), false);
  assert.equal(storage.has("unrelated"), true, "cache recovery must not purge an unrelated model key");
}

function assertReadModelCacheTimestampPolicy(candidate) {
  const storage = createMemoryReadStorage({
    target: JSON.stringify({ rows: [1], savedAt: 8_001 }),
  });
  assert.deepEqual(
    candidate({
      storage,
      cacheKey: "target",
      payloadKey: "rows",
      emptyValue: [],
      normalizePayload: (value) => Array.isArray(value) ? value.filter(Number.isSafeInteger) : [],
      now: 2_000,
    }),
    { value: [1], savedAt: null },
    "cache data may survive while an excessively future timestamp is rejected",
  );
}

export async function runReadModelTests() {
  const liveStateSnapshot = liveStateSnapshotModule.default ?? liveStateSnapshotModule;
  const cacheTimestamp = cacheTimestampModule.default ?? cacheTimestampModule;
  const globalStats = globalStatsModule.default ?? globalStatsModule;
  const globalStatsRuntime = globalStatsRuntimeModule.default ?? globalStatsRuntimeModule;
  const depositHistory = depositHistoryModule.default ?? depositHistoryModule;
  const jackpotHistory = jackpotHistoryModule.default ?? jackpotHistoryModule;
  const recentWins = recentWinsModule.default ?? recentWinsModule;
  const leaderboards = leaderboardsModule.default ?? leaderboardsModule;
  const pageAncillary = pageAncillaryModule.default ?? pageAncillaryModule;
  const analyticsAncillary = analyticsAncillaryModule.default ?? analyticsAncillaryModule;
  const analyticsDepositsPanel = analyticsDepositsPanelModule.default ?? analyticsDepositsPanelModule;
  const analyticsJackpotHistoryPanel = analyticsJackpotHistoryPanelModule.default ?? analyticsJackpotHistoryPanelModule;
  const rebate = rebateModule.default ?? rebateModule;
  const storedNumberParsing = storedNumberParsingModule.default ?? storedNumberParsingModule;
  const readModelCache = readModelCacheModule.default ?? readModelCacheModule;
  assert.equal(storedNumberParsing.parseStoredBlockNumberOrZero("0"), 0n);
  assert.equal(storedNumberParsing.parseStoredBlockNumberOrZero("9007199254740991"), 9007199254740991n);
  assert.equal(
    storedNumberParsing.parseStoredBlockNumberOrZero("9007199254740992"),
    9007199254740992n,
    "stored block numbers must preserve canonical bigint values beyond Number.MAX_SAFE_INTEGER",
  );
  for (const invalidBlockNumber of [null, undefined, "", "00", "01", "1e3", "1.5", "-1", "10000000000000000"]) {
    assert.equal(
      storedNumberParsing.parseStoredBlockNumberOrZero(invalidBlockNumber),
      0n,
      `stored block number must reject ${String(invalidBlockNumber)}`,
    );
  }
  assert.equal(storedNumberParsing.parseStoredPositiveIntegerOrZero("1"), 1);
  assert.equal(storedNumberParsing.parseStoredPositiveIntegerOrZero("9007199254740991"), Number.MAX_SAFE_INTEGER);
  for (const invalidPositiveInteger of [null, undefined, "", "0", "01", "1e3", "1.5", "-1", "9007199254740992"]) {
    assert.equal(
      storedNumberParsing.parseStoredPositiveIntegerOrZero(invalidPositiveInteger),
      0,
      `stored positive integer must reject ${String(invalidPositiveInteger)}`,
    );
  }
  assert.equal(liveStateSnapshot.isLiveStateSnapshotFresh(1_000, 2_000), true);
  assert.equal(liveStateSnapshot.isLiveStateSnapshotFresh(2_000 + 6_000, 2_000), false);
  assert.equal(liveStateSnapshot.isLiveStateSnapshotFresh(2_000 + 5_000, 2_000), true);
  assert.equal(liveStateSnapshot.isLiveStateSnapshotFresh(2_000 - 13 * 60 * 60 * 1000, 2_000), false);
  assert.equal(liveStateSnapshot.isLiveStateSnapshotFresh(1_000.5, 2_000), false);
  assert.equal(liveStateSnapshot.isLiveStateSnapshotFresh(Number.MAX_SAFE_INTEGER + 1, 2_000), false);
  assert.equal(liveStateSnapshot.isLiveStateSnapshotFresh(1_000, 2_000.5), false);
  assert.equal(liveStateSnapshot.isLiveStateSnapshotFresh(1_000, Number.NaN), false);
  const liveStateSnapshotSource = readFileSync("app/hooks/useGameLiveStateSnapshot.ts", "utf8");
  assert.equal(liveStateSnapshot.getLiveStateFailurePollIntervalCount(0), 1);
  assert.equal(liveStateSnapshot.getLiveStateFailurePollIntervalCount(2), 1);
  assert.equal(liveStateSnapshot.getLiveStateFailurePollIntervalCount(3), 2);
  assert.equal(liveStateSnapshot.getLiveStateFailurePollIntervalCount(5), 4);
  assert.equal(liveStateSnapshot.getLiveStateFailurePollIntervalCount(100), 4);
  assert.equal(liveStateSnapshot.getLiveStateFailurePollIntervalCount(-1), 1);
  assert.equal(liveStateSnapshot.getLiveStateFailurePollIntervalCount(1.5), 1);
  assert.equal(liveStateSnapshot.getLiveStateFailurePollIntervalCount(Number.NaN), 1);
  assert.equal(liveStateSnapshot.getLiveStateFailurePollIntervalCount(Number.MAX_SAFE_INTEGER + 1), 1);
  assert.equal(liveStateSnapshot.shouldDisableLiveContractReadsAfterRecovery(false, 1), false);
  assert.equal(liveStateSnapshot.shouldDisableLiveContractReadsAfterRecovery(false, 2), true);
  assert.equal(liveStateSnapshot.shouldDisableLiveContractReadsAfterRecovery(true, 2), false);
  assert.equal(liveStateSnapshot.shouldDisableLiveContractReadsAfterRecovery(false, 2.5), false);
  assert.equal(liveStateSnapshot.shouldDisableLiveContractReadsAfterRecovery(false, Number.NaN), false);
  assert.equal(
    liveStateSnapshot.shouldDisableLiveContractReadsAfterRecovery(false, Number.MAX_SAFE_INTEGER + 1),
    false,
  );
  const liveStateSignal = new AbortController().signal;
  const liveStateRequests = [];
  const liveStatePayload = {
    currentEpoch: "42",
    tileData: {
      pools: Array(25).fill("0"),
      users: Array(25).fill("0"),
    },
    tileUserCounts: Array(25).fill(0),
    indexedTilePools: Array(25).fill("0"),
    fetchedAt: 1_000,
  };
  assert.deepEqual(
    await liveStateSnapshot.fetchLiveStateSnapshotResponse(liveStateSignal, async (input, init) => {
      liveStateRequests.push({ input, init });
      return new Response(JSON.stringify(liveStatePayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
    liveStatePayload,
  );
  assert.deepEqual(liveStateRequests, [{
    input: "/api/live-state",
    init: { cache: "no-store", signal: liveStateSignal },
  }]);
  await assert.rejects(
    liveStateSnapshot.fetchLiveStateSnapshotResponse(liveStateSignal, async () => new Response("{}", {
      status: 503,
      headers: { "content-type": "application/json" },
    })),
    (error) => error instanceof Error && error.message === "Live state request failed (HTTP 503)",
  );
  await assert.rejects(
    liveStateSnapshot.fetchLiveStateSnapshotResponse(liveStateSignal, async () => new Response(null, {
      status: 200,
      headers: { "content-type": "application/json" },
    })),
    /empty JSON \(HTTP 200\)/,
  );
  await assert.rejects(
    liveStateSnapshot.fetchLiveStateSnapshotResponse(liveStateSignal, async () => new Response("not json", {
      status: 200,
      headers: { "content-type": "text/plain" },
    })),
    /Invalid JSON response/,
  );
  await assert.rejects(
    liveStateSnapshot.fetchLiveStateSnapshotResponse(liveStateSignal, async () => new Response("{}", {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-length": String(2 * 1024 * 1024 + 1),
      },
    })),
    /JSON response too large/,
  );
  assert.equal(liveStateSnapshot.hasLiveStateGridLength(Array(25).fill(0)), true);
  assert.equal(liveStateSnapshot.hasLiveStateGridLength(Array(24).fill(0)), false);
  assert.equal(liveStateSnapshot.hasLiveStateGridLength(Array(26).fill(0)), false);
  assert.equal(liveStateSnapshot.hasLiveStateGridLength(null), false);
  assert.match(
    liveStateSnapshotSource,
    /const payload = await fetchLiveStateSnapshotResponse\(requestController\.signal\)[\s\S]*!hasLiveStateGridLength\(tileData\.pools[\s\S]*!hasLiveStateGridLength\(tileData\.users[\s\S]*!hasLiveStateGridLength\(counts[\s\S]*!hasLiveStateGridLength\(indexedTilePools\)/,
    "live-state hook must bind the behavior-tested bounded fetch and exact-grid fallback policies",
  );
  assert.equal(cacheTimestamp.normalizeCacheTimestamp(1_000, 2_000), 1_000);
  assert.equal(cacheTimestamp.normalizeCacheTimestamp(Number.NaN, 2_000), null);
  assert.equal(cacheTimestamp.normalizeCacheTimestamp(1_000.5, 2_000), null);
  assert.equal(cacheTimestamp.normalizeCacheTimestamp(Number.MAX_SAFE_INTEGER + 1, 2_000), null);
  assert.equal(cacheTimestamp.normalizeCacheTimestamp(2_000 + 6_000, 2_000), null);
  assert.equal(cacheTimestamp.getFreshCacheDelayMs(1_000, 30_000, 2_000), 29_000);
  assert.equal(cacheTimestamp.getFreshCacheDelayMs(2_100, 30_000, 2_000), 30_000);
  assert.equal(cacheTimestamp.getFreshCacheDelayMs(1_000, 30_000, 31_000), null);
  assert.equal(cacheTimestamp.getFreshCacheDelayMs(1_000.5, 30_000, 2_000), null);
  assertReadModelCacheInvalidationPolicy(readModelCache.loadReadModelCache);
  assertReadModelCacheTimestampPolicy(readModelCache.loadReadModelCache);
  assert.throws(
    () => assertReadModelCacheInvalidationPolicy((options) => ({
      value: options.emptyValue,
      savedAt: null,
    })),
    /purge exactly its own key/,
    "a no-purge cache recovery mutant must be killed",
  );
  assert.throws(
    () => assertReadModelCacheInvalidationPolicy((options) => {
      options.storage.removeItem("unrelated");
      return readModelCache.loadReadModelCache(options);
    }),
    /purge exactly its own key/,
    "a cross-key purge mutant must be killed",
  );
  assert.throws(
    () => assertReadModelCacheTimestampPolicy((options) => {
      const result = readModelCache.loadReadModelCache(options);
      return { ...result, savedAt: 8_001 };
    }),
    /excessively future timestamp/,
    "a future-timestamp acceptance mutant must be killed",
  );
  const gameCountdown = gameCountdownModule.default ?? gameCountdownModule;
  assert.equal(gameCountdown.normalizeEpochEndMs(1_000n), 1_000_000);
  assert.equal(gameCountdown.normalizeEpochEndMs(0n), null);
  assert.equal(gameCountdown.normalizeEpochEndMs(-1n), null);
  assert.equal(gameCountdown.normalizeEpochEndMs(BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1000))), 9_007_199_254_740_000);
  assert.equal(gameCountdown.normalizeEpochEndMs(BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1000)) + 1n), null);
  const gameCountdownSource = readFileSync("app/hooks/useGameCountdown.ts", "utf8");
  assert.match(
    gameCountdownSource,
    /const endMs = normalizeEpochEndMs\(effectiveEpochEndTime\)[\s\S]*if \(endMs === null\)[\s\S]*setTimeLeft\(0\)[\s\S]*setPollPhase\("slow"\)[\s\S]*return;/,
    "game countdown must fail closed on unsafe epoch-end timestamps without entering zero-refetch handling",
  );
  const normalizedGlobalStats = globalStats.normalizeGlobalStatsAccumulator({
    volumeRaw: "100",
    burnRaw: "2",
    resolvedEpochs: 3,
    lastScannedEpoch: 4,
    lastScannedBlock: "5",
  });
  assert.deepEqual(normalizedGlobalStats, {
    volumeRaw: 100n,
    burnRaw: 2n,
    resolvedEpochs: 3,
    lastScannedEpoch: 4,
    lastScannedBlock: "5",
  });
  assert.equal(globalStats.normalizeGlobalStatsAccumulator({ volumeRaw: "-1", resolvedEpochs: 0, lastScannedEpoch: 0, lastScannedBlock: "1" }), null);
  assert.equal(
    globalStats.normalizeGlobalStatsAccumulator({
      volumeRaw: "1",
      resolvedEpochs: "1.5",
      lastScannedEpoch: 1,
      lastScannedBlock: "1",
    }),
    null,
  );
  assert.equal(
    globalStats.normalizeGlobalStatsAccumulator({
      volumeRaw: "1",
      resolvedEpochs: "1e3",
      lastScannedEpoch: 1,
      lastScannedBlock: "1",
    }),
    null,
  );
  assert.equal(
    globalStats.normalizeGlobalStatsAccumulator({
      volumeRaw: "1",
      resolvedEpochs: 1,
      lastScannedEpoch: " 1",
      lastScannedBlock: "1",
    }),
    null,
  );
  assert.equal(
    globalStats.normalizeGlobalStatsAccumulator({
      volumeRaw: "1",
      resolvedEpochs: Number.MAX_SAFE_INTEGER + 1,
      lastScannedEpoch: 1,
      lastScannedBlock: "1",
    }),
    null,
  );
  assert.equal(globalStats.getUsableGlobalStatsAccumulator(normalizedGlobalStats, 3), null);
  assert.deepEqual(globalStats.getUsableGlobalStatsAccumulator(normalizedGlobalStats, 4), normalizedGlobalStats);
  assert.equal(globalStatsRuntime.safeGlobalStatsCurrentEpoch(null), null);
  assert.equal(globalStatsRuntime.safeGlobalStatsCurrentEpoch(-1n), null);
  assert.equal(globalStatsRuntime.safeGlobalStatsCurrentEpoch(BigInt(Number.MAX_SAFE_INTEGER) + 1n), null);
  assert.equal(globalStatsRuntime.safeGlobalStatsCurrentEpoch(42n), 42);
  assert.equal(globalStats.getGlobalStatsStatus({ hasStats: false, currentEpochVerified: false, requestFailed: false }), "loading");
  assert.equal(globalStats.getGlobalStatsStatus({ hasStats: false, currentEpochVerified: false, requestFailed: true }), "error");
  assert.equal(globalStats.getGlobalStatsStatus({ hasStats: true, currentEpochVerified: false, requestFailed: false }), "stale");
  assert.equal(globalStats.getGlobalStatsStatus({ hasStats: true, currentEpochVerified: false, requestFailed: true }), "stale");
  assert.equal(globalStats.getGlobalStatsStatus({ hasStats: true, currentEpochVerified: true, requestFailed: false }), "ready");
  assert.equal(globalStats.isCurrentGlobalStatsEpochVerified(null, null), false);
  assert.equal(globalStats.isCurrentGlobalStatsEpochVerified(null, undefined), false);
  assert.equal(globalStats.isCurrentGlobalStatsEpochVerified(null, 1n), false);
  assert.equal(globalStats.isCurrentGlobalStatsEpochVerified(1n, 1n), true);
  assert.equal(globalStats.isCurrentGlobalStatsEpochVerified(1n, -1n), false);

  const globalStatsStorage = createMemoryReadStorage({
    target: JSON.stringify({
      volumeRaw: "100",
      burnRaw: "2",
      resolvedEpochs: 3,
      lastScannedEpoch: 4,
      lastScannedBlock: "5",
    }),
    unrelated: "keep",
  });
  assert.deepEqual(globalStatsRuntime.loadGlobalStatsCache(globalStatsStorage, "target"), normalizedGlobalStats);
  assert.deepEqual(globalStatsStorage.reads, ["target"]);
  const corruptGlobalStatsStorage = createMemoryReadStorage({ target: "{", unrelated: "keep" });
  assert.equal(globalStatsRuntime.loadGlobalStatsCache(corruptGlobalStatsStorage, "target"), null);
  assert.deepEqual(corruptGlobalStatsStorage.removals, ["target"]);
  assert.equal(corruptGlobalStatsStorage.has("unrelated"), true);
  globalStatsRuntime.saveGlobalStatsCache(globalStatsStorage, "saved", normalizedGlobalStats);
  assert.deepEqual(
    globalStatsStorage.writes,
    [["saved", JSON.stringify({
      volumeRaw: "100",
      burnRaw: "2",
      resolvedEpochs: 3,
      lastScannedEpoch: 4,
      lastScannedBlock: "5",
    })]],
  );

  const requestController = new AbortController();
  let globalStatsRequest = null;
  const fetchedGlobalStats = await globalStatsRuntime.fetchGlobalStatsAccumulator({
    currentEpoch: 42,
    signal: requestController.signal,
    fetchImpl: async (input, init) => {
      globalStatsRequest = { input, init };
      return new Response(JSON.stringify({
        totalVolumeWei: "100",
        totalBurnWei: "2",
        resolvedEpochs: 3,
        lastIndexedBlock: "5",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.deepEqual(fetchedGlobalStats, { ...normalizedGlobalStats, lastScannedEpoch: 42 });
  assert.equal(globalStatsRequest.input, "/api/global-stats");
  assert.equal(globalStatsRequest.init.cache, "no-store");
  assert.equal(globalStatsRequest.init.signal, requestController.signal);
  await assert.rejects(
    globalStatsRuntime.fetchGlobalStatsAccumulator({
      currentEpoch: 42,
      signal: requestController.signal,
      fetchImpl: async () => new Response("unavailable", { status: 503 }),
    }),
    /request failed: 503/,
  );
  await assert.rejects(
    globalStatsRuntime.fetchGlobalStatsAccumulator({
      currentEpoch: 42,
      signal: requestController.signal,
      fetchImpl: async () => new Response(JSON.stringify({
        totalVolumeWei: "100",
        totalBurnWei: "2",
        resolvedEpochs: "1e3",
        lastIndexedBlock: "5",
      }), { status: 200, headers: { "content-type": "application/json" } }),
    }),
    /response is invalid/,
  );
  await assert.rejects(
    globalStatsRuntime.fetchGlobalStatsAccumulator({
      currentEpoch: 42,
      signal: requestController.signal,
      fetchImpl: async () => new Response("{}", {
        status: 200,
        headers: {
          "content-length": String(2 * 1024 * 1024 + 1),
          "content-type": "application/json",
        },
      }),
    }),
    /response too large/,
  );
  const globalStatsSource = readFileSync("app/hooks/useGlobalStats.ts", "utf8");
  assert.match(
    globalStatsSource,
    /loadGlobalStatsCache\([\s\S]*safeGlobalStatsCurrentEpoch\(currentEpoch\)[\s\S]*getUsableGlobalStatsAccumulator\([\s\S]*removeGlobalStatsCache\([\s\S]*fetchGlobalStatsAccumulator\([\s\S]*saveGlobalStatsCache\(/,
    "global stats hook must bind the behavior-tested cache, epoch, bounded-fetch, and persistence policies",
  );
  assert.doesNotMatch(
    globalStatsSource,
    /\.getLogs\(/,
    "global stats must not perform historical eth_getLogs scans in the browser",
  );
  const mappedDeposits = depositHistory.mapDepositEntries(
    [
      {
        epoch: "42",
        tileIds: [2, 2, 5],
        amounts: ["1000000000000000.123456789123456789", "0.876543210876543211", "1"],
        totalAmount: "1000000000000002",
        totalAmountNum: 1000000000000002,
        txHash: "0xabc",
        blockNumber: "7",
      },
    ],
    {
      "42": {
        winningTile: 2,
        rewardPool: "500",
        isDailyJackpot: false,
        isWeeklyJackpot: false,
      },
    },
    {
      "42": {
        reward: "100",
        winningTile: 2,
        rewardPool: "500",
        winningTilePool: "1000000000000001",
        userWinningAmount: "1000000000000001",
      },
    },
  );
  assert.deepEqual(mappedDeposits[0].tileIds, [2, 5]);
  assert.equal(mappedDeposits[0].amount, "1000000000000002.00");
  assert.equal(mappedDeposits[0].reward, 100);
  assert.equal(
    depositHistory.mapDepositEntries(
      [
        {
          epoch: "bad",
          tileIds: [1],
          amounts: ["1"],
          totalAmount: "1",
          totalAmountNum: 1,
          txHash: "0xbad",
          blockNumber: "bad",
        },
      ],
      {},
      {},
    )[0].blockNumberNum,
    0,
  );
  assert.equal(
    depositHistory.mapDepositEntries(
      [
        {
          epoch: "bad",
          tileIds: [1],
          amounts: ["1"],
          totalAmount: "1",
          totalAmountNum: 1,
          txHash: "0xbad",
          blockNumber: "bad",
        },
      ],
      {},
      {},
    )[0].txHash,
    "",
    "deposit history API mapping must suppress malformed transaction hashes",
  );
  assert.deepEqual(depositHistory.normalizeApiDeposits("bad-shape"), []);
  assert.deepEqual(
    depositHistory.normalizeApiDeposits([
      {
        epoch: "1",
        tileIds: [1],
        totalAmount: "10",
        totalAmountNum: 10,
        txHash: "0xabc",
        blockNumber: "2",
      },
      null,
    ]),
    [
      {
        epoch: "1",
        tileIds: [1],
        totalAmount: "10",
        totalAmountNum: 10,
        txHash: "0xabc",
        blockNumber: "2",
      },
    ],
  );
  const cachedDepositEntry = {
    epoch: "9",
    tileIds: [1, 999, "2", "02", "1e3", 2.5],
    amounts: [1, -1, "2", "02", "1e3"],
    amount: "3.00",
    amountNum: 3,
    txHash: `0x${"Aa".repeat(32)}`,
    blockNumber: "11",
    blockNumberNum: 11,
    winningTile: 999,
    isDailyJackpot: true,
    isWeeklyJackpot: false,
    reward: -1,
  };
  assert.deepEqual(depositHistory.normalizeCachedDepositEntries("bad-shape"), null);
  assert.deepEqual(
    depositHistory.normalizeCachedDepositEntries([
      cachedDepositEntry,
      { ...cachedDepositEntry, txHash: "bad" },
      { ...cachedDepositEntry, epoch: "09" },
      { ...cachedDepositEntry, blockNumber: "011" },
      null,
    ]),
    [
      {
        epoch: "9",
        tileIds: [1, 2],
        amounts: [1, 2],
        amount: "3.00",
        amountNum: 3,
        txHash: `0x${"aa".repeat(32)}`,
        blockNumber: "11",
        blockNumberNum: 11,
        winningTile: null,
        isDailyJackpot: true,
        isWeeklyJackpot: false,
        reward: null,
      },
    ],
  );
  assert.deepEqual(
    depositHistory.normalizeCachedDepositEntries([
      {
        ...cachedDepositEntry,
        amountNum: "1e3",
        reward: "02",
        winningTile: "2.5",
      },
    ]),
    [
      {
        epoch: "9",
        tileIds: [1, 2],
        amounts: [1, 2],
        amount: "3.00",
        amountNum: 0,
        txHash: `0x${"aa".repeat(32)}`,
        blockNumber: "11",
        blockNumberNum: 11,
        winningTile: null,
        isDailyJackpot: true,
        isWeeklyJackpot: false,
        reward: null,
      },
    ],
    "deposit history cache normalization must reject malformed numeric cache evidence",
  );
  assert.equal(
    depositHistory.normalizeCachedDepositEntries(Array.from({ length: 501 }, () => cachedDepositEntry))?.length,
    500,
  );
  const depositCacheReads = [];
  const depositCacheStorage = {
    getItem(key) {
      depositCacheReads.push(key);
      return JSON.stringify({ savedAt: 1_000, data: [cachedDepositEntry] });
    },
    removeItem() {},
  };
  const firstDepositActor = "0x0000000000000000000000000000000000000001";
  const secondDepositActor = "0x0000000000000000000000000000000000000002";
  const restoredDepositCache = depositHistory.loadDepositHistoryCache(
    firstDepositActor,
    depositCacheStorage,
    2_000,
  );
  assert.equal(restoredDepositCache.data?.length, 1);
  assert.equal(restoredDepositCache.savedAt, 1_000);
  depositHistory.loadDepositHistoryCache(secondDepositActor, depositCacheStorage, 2_000);
  assert.equal(depositCacheReads.length, 2);
  assert.notEqual(depositCacheReads[0], depositCacheReads[1], "deposit caches must stay isolated by normalized actor");
  assert.match(depositCacheReads[0], new RegExp(`${firstDepositActor}$`));
  assert.match(depositCacheReads[1], new RegExp(`${secondDepositActor}$`));
  assert.equal(depositHistory.getDepositHistoryRefreshDelay(1_000, 2_000), 29_000);
  assert.equal(depositHistory.getDepositHistoryRefreshDelay(1_000, 31_000), null);
  assert.equal(depositHistory.getDepositHistoryRefreshDelay(8_001, 2_000), null);
  assert.deepEqual(
    depositHistory.mapDepositEntries([
      {
        epoch: "999999999999999999999999",
        tileIds: [1],
        amounts: ["1"],
        totalAmount: "1",
        totalAmountNum: 1,
        txHash: `0x${"bb".repeat(32)}`,
        blockNumber: "9",
      },
      {
        epoch: "1",
        tileIds: [1],
        amounts: ["1"],
        totalAmount: "1",
        totalAmountNum: 1,
        txHash: `0x${"aa".repeat(32)}`,
        blockNumber: "9",
      },
    ], {}, {}).map((entry) => entry.epoch),
    ["1", "999999999999999999999999"],
    "unsafe deposit epochs must fail closed instead of winning a Number-based descending sort",
  );
  assert.notDeepEqual(
    ["999999999999999999999999", "1"].sort((left, right) => Number(right) - Number(left)),
    ["1", "999999999999999999999999"],
    "the unsafe-epoch fixture must kill a broad Number sorting mutant",
  );
  assert.deepEqual(jackpotHistory.normalizeEntries("bad-shape"), []);
  assert.deepEqual(
    jackpotHistory.normalizeEntries([
      {
        epoch: "42",
        amount: "1234.567899",
        amountNum: 0,
        kind: "daily",
        txHash: "0xabc",
        blockNumber: 7n,
        timestamp: 123,
      },
    ])[0],
    {
      epoch: "42",
      amount: "1234.57",
      amountNum: 1234.567899,
      kind: "daily",
      txHash: "",
      blockNumber: 7n,
      timestamp: 123,
    },
    "jackpot history entries must derive display numbers safely and suppress malformed tx hashes",
  );
  assert.deepEqual(
    jackpotHistory.normalizeEntries([
      {
        epoch: "43",
        amount: "bad",
        amountNum: "1e6",
        kind: "weekly",
        txHash: "0xdef",
        blockNumber: 8n,
        timestamp: 124,
      },
    ])[0],
    {
      epoch: "43",
      amount: "0.00",
      amountNum: 0,
      kind: "weekly",
      txHash: "",
      blockNumber: 8n,
      timestamp: 124,
    },
    "jackpot history malformed legacy numeric text must fail closed instead of passing through parseFloat",
  );
  assert.equal(
    jackpotHistory.normalizeEntries([
      {
        epoch: "44",
        amount: "1",
        kind: "daily",
        txHash: `0x${"Ab".repeat(32)}`,
        blockNumber: 9n,
      },
    ])[0]?.txHash,
    `0x${"ab".repeat(32)}`,
    "jackpot history entries must preserve valid full transaction hashes in lowercase",
  );
  const jackpotCacheStorage = createMemoryReadStorage({
    jackpot: JSON.stringify({
      savedAt: 1_000,
      jackpots: [{
        epoch: "44",
        amount: "1",
        kind: "daily",
        txHash: `0x${"ab".repeat(32)}`,
        blockNumber: "9",
      }],
    }),
  });
  const restoredJackpotCache = jackpotHistory.loadJackpotHistoryCache(
    {
      getItem: () => jackpotCacheStorage.getItem("jackpot"),
      removeItem: () => jackpotCacheStorage.removeItem("jackpot"),
    },
    2_000,
  );
  assert.equal(restoredJackpotCache.entries.length, 1);
  assert.equal(restoredJackpotCache.entries[0].blockNumber, 9n);
  assert.equal(restoredJackpotCache.savedAt, 1_000);
  assert.equal(jackpotHistory.getJackpotHistoryRefreshDelay(1_000, 2_000), 44_000);
  assert.equal(jackpotHistory.getJackpotHistoryRefreshDelay(1_000, 46_000), 0);
  assert.equal(jackpotHistory.getJackpotHistoryRefreshDelay(8_001, 2_000), 0);
  assert.deepEqual(
    jackpotHistory.sortJackpotHistoryEntries(jackpotHistory.normalizeEntries([
      {
        epoch: "999999999999999999999999",
        amount: "1",
        kind: "daily",
        txHash: `0x${"bb".repeat(32)}`,
        blockNumber: "9",
      },
      {
        epoch: "1",
        amount: "1",
        kind: "daily",
        txHash: `0x${"aa".repeat(32)}`,
        blockNumber: "9",
      },
    ])).map((entry) => entry.epoch),
    ["1", "999999999999999999999999"],
    "unsafe jackpot epochs must fail closed instead of winning a Number-based descending sort",
  );
  const depositHistorySource = readFileSync("app/hooks/useDepositHistory.ts", "utf8");
  const depositUser = "0x1111111111111111111111111111111111111111";
  const depositRequests = [];
  const depositPayload = await depositHistory.fetchDepositHistoryPayload(depositUser, async (input, init) => {
    depositRequests.push({ input, init });
    return new Response(JSON.stringify({
      deposits: [{
        epoch: "42",
        tileIds: [1],
        totalAmount: "1000000000000000000",
        totalAmountNum: 1,
        txHash: `0x${"ab".repeat(32)}`,
        blockNumber: "7",
      }],
      epochs: {},
      rewards: {},
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.deepEqual(depositRequests, [{
    input: `/api/deposits?user=${depositUser}`,
    init: { cache: "no-store" },
  }]);
  assert.equal(depositPayload.deposits?.length, 1);
  await assert.rejects(
    depositHistory.fetchDepositHistoryPayload(depositUser, async () => new Response(null, {
      status: 200,
      headers: { "content-type": "application/json" },
    })),
    /empty JSON \(HTTP 200\)/,
  );
  await assert.rejects(
    depositHistory.fetchDepositHistoryPayload(depositUser, async () => new Response(
      JSON.stringify({ error: "private-backend-detail" }),
      { status: 503, headers: { "content-type": "application/json" } },
    )),
    (error) => error instanceof Error && error.message === "Deposit history request failed (HTTP 503)",
  );
  await assert.rejects(
    depositHistory.fetchDepositHistoryPayload(depositUser, async () => new Response("{}", {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-length": String(2 * 1024 * 1024 + 1),
      },
    })),
    /JSON response too large/,
  );
  const safeDepositLoadError = depositHistory.getDepositHistoryLoadError(
    new Error("private-backend-detail https://rpc.invalid/?token=secret"),
  );
  assert.equal(safeDepositLoadError, "Deposit history is temporarily unavailable. Refresh the Analytics tab to retry.");
  assert.doesNotMatch(safeDepositLoadError, /private|rpc|token|secret/i);

  const epochIds = Array.from({ length: 101 }, (_, index) => String(index + 1));
  const epochRequests = [];
  const fetchedEpochMap = await depositHistory.fetchEpochMap(epochIds, async (input, init) => {
    epochRequests.push({ input, init });
    const requestEpochs = new URL(String(input), "https://local.invalid").searchParams.get("epochs")?.split(",") ?? [];
    return new Response(JSON.stringify({
      epochs: Object.fromEntries(requestEpochs.map((epoch) => [epoch, { winningTile: 1, rewardPool: "1" }])),
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.equal(epochRequests.length, 2);
  assert.equal(epochRequests[0].init.cache, "no-store");
  assert.equal(new URL(String(epochRequests[0].input), "https://local.invalid").searchParams.get("epochs").split(",").length, 100);
  assert.equal(Object.keys(fetchedEpochMap).length, 101);

  const rewardIds = Array.from({ length: 201 }, (_, index) => String(index + 1));
  const rewardRequests = [];
  const fetchedRewardsMap = await depositHistory.fetchRewardsMap(depositUser, rewardIds, async (input, init) => {
    rewardRequests.push({ input, init });
    const body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({
      rewards: Object.fromEntries(body.epochs.map((epoch) => [epoch, { reward: "1", winningTile: 1 }])),
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.equal(rewardRequests.length, 2);
  assert.equal(rewardRequests[0].input, "/api/rewards");
  assert.equal(rewardRequests[0].init.method, "POST");
  assert.equal(rewardRequests[0].init.cache, "no-store");
  assert.equal(JSON.parse(String(rewardRequests[0].init.body)).epochs.length, 200);
  assert.equal(Object.keys(fetchedRewardsMap).length, 201);
  assert.match(
    depositHistorySource,
    /const depositsJson = await fetchDepositHistoryPayload\(normalizedUser\)[\s\S]*publishEntries\(mapDepositEntries\(deposits, epochsMap, rewardsMap\)\)[\s\S]*fetchEpochMap\(syncMissingEpochs\)[\s\S]*fetchRewardsMap\(normalizedUser, syncMissingRewards\)[\s\S]*const fullEntries = mapDepositEntries\(deposits, mergedEpochsMap, mergedRewardsMap\)[\s\S]*setError\(getDepositHistoryLoadError\(\)\)/,
    "deposit history hook must bind the behavior-tested bounded fetch, mapping, metadata, and safe-error policies",
  );
  const jackpotHistorySource = readFileSync("app/hooks/useJackpotHistory.ts", "utf8");
  const jackpotApiRows = Array.from({ length: 201 }, (_, index) => ({
    epoch: String(index + 1),
    amount: "1.0",
    kind: index % 2 === 0 ? "daily" : "weekly",
    txHash: `0x${(index % 16).toString(16).repeat(64)}`,
    blockNumber: String(index + 1),
    timestamp: null,
  }));
  const jackpotRequests = [];
  const fetchedJackpots = await jackpotHistory.fetchJackpotHistoryEntries(async (input, init) => {
    jackpotRequests.push({ input, init });
    return new Response(JSON.stringify({ jackpots: jackpotApiRows }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  assert.deepEqual(jackpotRequests, [{ input: "/api/jackpots", init: { cache: "no-store" } }]);
  assert.equal(fetchedJackpots.length, 200);
  assert.equal(fetchedJackpots[0].epoch, "200", "jackpot API limit must apply before exact descending sort");
  assert.equal(fetchedJackpots.some((entry) => entry.epoch === "201"), false);
  await assert.rejects(
    jackpotHistory.fetchJackpotHistoryEntries(async () => new Response(null, {
      status: 200,
      headers: { "content-type": "application/json" },
    })),
    /HTTP 200/,
  );
  await assert.rejects(
    jackpotHistory.fetchJackpotHistoryEntries(async () => new Response(
      JSON.stringify({ error: "private-backend-detail" }),
      { status: 503, headers: { "content-type": "application/json" } },
    )),
    /private-backend-detail/,
  );
  await assert.rejects(
    jackpotHistory.fetchJackpotHistoryEntries(async () => new Response("not json", {
      status: 200,
      headers: { "content-type": "text/plain" },
    })),
    /Invalid JSON response/,
  );
  await assert.rejects(
    jackpotHistory.fetchJackpotHistoryEntries(async () => new Response("{}", {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-length": String(2 * 1024 * 1024 + 1),
      },
    })),
    /JSON response too large/,
  );
  const safeJackpotLoadError = jackpotHistory.getJackpotHistoryLoadError(
    new Error("private-backend-detail https://rpc.invalid/?token=secret"),
  );
  assert.equal(safeJackpotLoadError, "Jackpot history is temporarily unavailable. Refresh the Analytics tab to retry.");
  assert.doesNotMatch(safeJackpotLoadError, /private|rpc|token|secret/i);
  assert.match(
    jackpotHistorySource,
    /const sorted = await fetchJackpotHistoryEntries\(\)[\s\S]*setError\(getJackpotHistoryLoadError\(\)\)/,
    "jackpot history hook must bind the behavior-tested bounded fetch and safe-error policies",
  );
  const depositTxHash = `0x${"ab".repeat(32)}`;
  const depositRow = {
    epoch: "42",
    tileIds: [1, 2],
    amounts: [1, 1],
    amount: "2.0",
    amountNum: 2,
    txHash: depositTxHash,
    blockNumber: "7",
    blockNumberNum: 7,
    winningTile: 2,
    isDailyJackpot: false,
    isWeeklyJackpot: false,
    reward: 3,
  };
  const depositPanelProps = {
    deposits: [depositRow],
    depositsError: null,
    depositsLoading: false,
    depositsRefreshing: false,
    depositsMetadataLoading: false,
    depositsLastLoadedAt: null,
    newDepositIds: new Set(),
    onLoadDeposits: () => {},
    onRefreshDeposits: () => {},
    showMore: () => {},
    totalDeposited: 2,
    visibleCount: 1,
    visibleDeposits: [depositRow],
    hasMore: false,
  };
  const depositLoadingHtml = renderToStaticMarkup(React.createElement(
    analyticsDepositsPanel.AnalyticsDepositsPanel,
    { ...depositPanelProps, deposits: null, visibleDeposits: [], visibleCount: 0, depositsLoading: true },
  ));
  assert.match(depositLoadingHtml, /role="status"[^>]*aria-live="polite"[^>]*aria-busy="true"/);
  const depositRefreshingHtml = renderToStaticMarkup(React.createElement(
    analyticsDepositsPanel.AnalyticsDepositsPanel,
    { ...depositPanelProps, depositsRefreshing: true },
  ));
  assert.match(depositRefreshingHtml, /role="status"[^>]*aria-live="polite"[^>]*aria-busy="true"[^>]*>[\s\S]*Refreshing/);
  const depositMetadataHtml = renderToStaticMarkup(React.createElement(
    analyticsDepositsPanel.AnalyticsDepositsPanel,
    { ...depositPanelProps, depositsMetadataLoading: true },
  ));
  assert.match(depositMetadataHtml, /role="status"[^>]*aria-live="polite"[^>]*aria-busy="true"[^>]*>[\s\S]*Syncing rewards/);
  assert.match(
    depositRefreshingHtml,
    /aria-label="Open deposit transaction 0xabab\.\.\.abab on Lineascan"[^>]*title="Open deposit transaction on Lineascan"/,
  );
  const invalidDepositHashHtml = renderToStaticMarkup(React.createElement(
    analyticsDepositsPanel.AnalyticsDepositsPanel,
    { ...depositPanelProps, visibleDeposits: [{ ...depositRow, txHash: "private-rpc-token" }] },
  ));
  assert.doesNotMatch(invalidDepositHashHtml, /private-rpc-token|Open deposit transaction/);

  const jackpotTxHash = `0x${"cd".repeat(32)}`;
  const jackpotPanelProps = {
    jackpotHistory: [{
      epoch: "43",
      amount: "4.0",
      amountNum: 4,
      kind: "daily",
      txHash: jackpotTxHash,
      blockNumber: 8n,
      timestamp: null,
    }],
    jackpotHistoryError: null,
    jackpotHistoryLoading: false,
    onRefreshJackpotHistory: () => {},
  };
  const jackpotLoadingHtml = renderToStaticMarkup(React.createElement(
    analyticsJackpotHistoryPanel.AnalyticsJackpotHistoryPanel,
    { ...jackpotPanelProps, jackpotHistory: [], jackpotHistoryLoading: true },
  ));
  assert.match(jackpotLoadingHtml, /role="status"[^>]*aria-live="polite"[^>]*aria-busy="true"/);
  const jackpotHistoryHtml = renderToStaticMarkup(React.createElement(
    analyticsJackpotHistoryPanel.AnalyticsJackpotHistoryPanel,
    jackpotPanelProps,
  ));
  assert.match(
    jackpotHistoryHtml,
    /aria-label="Open jackpot transaction 0xcdcd\.\.\.cdcd on Lineascan"[^>]*title="Open jackpot transaction on Lineascan"/,
  );
  const invalidJackpotHashHtml = renderToStaticMarkup(React.createElement(
    analyticsJackpotHistoryPanel.AnalyticsJackpotHistoryPanel,
    { ...jackpotPanelProps, jackpotHistory: [{ ...jackpotPanelProps.jackpotHistory[0], txHash: "private-rpc-token" }] },
  ));
  assert.doesNotMatch(invalidJackpotHashHtml, /private-rpc-token|Open jackpot transaction/);
  const analyticsAncillarySource = readFileSync("app/hooks/useAnalyticsAncillaryData.ts", "utf8");
  assert.deepEqual(
    analyticsAncillary.selectAnalyticsAncillaryActivation("analytics", true, "0x1"),
    { readModelsEnabled: true, depositRefreshEnabled: true },
  );
  assert.deepEqual(
    analyticsAncillary.selectAnalyticsAncillaryActivation("analytics", false, "0x1"),
    { readModelsEnabled: false, depositRefreshEnabled: false },
  );
  assert.deepEqual(
    analyticsAncillary.selectAnalyticsAncillaryActivation("mining", true, "0x1"),
    { readModelsEnabled: false, depositRefreshEnabled: false },
  );
  assert.deepEqual(
    analyticsAncillary.selectAnalyticsAncillaryActivation("analytics", true, null),
    { readModelsEnabled: true, depositRefreshEnabled: false },
  );
  const analyticsTimers = [];
  const clearedAnalyticsTimers = [];
  let analyticsRefreshes = 0;
  const setAnalyticsInterval = (callback, delayMs) => {
    const timer = { callback, delayMs };
    analyticsTimers.push(timer);
    return timer;
  };
  assert.equal(
    analyticsAncillary.scheduleAnalyticsDepositRefresh({
      enabled: false,
      refresh: () => { analyticsRefreshes += 1; },
      setIntervalImpl: setAnalyticsInterval,
      clearIntervalImpl: (timer) => clearedAnalyticsTimers.push(timer),
    }),
    undefined,
  );
  assert.equal(analyticsTimers.length, 0, "hidden analytics must not create a background timer");
  const cleanupAnalyticsRefresh = analyticsAncillary.scheduleAnalyticsDepositRefresh({
    enabled: true,
    refresh: () => { analyticsRefreshes += 1; },
    setIntervalImpl: setAnalyticsInterval,
    clearIntervalImpl: (timer) => clearedAnalyticsTimers.push(timer),
  });
  assert.equal(typeof cleanupAnalyticsRefresh, "function");
  assert.equal(analyticsTimers.length, 1);
  assert.equal(analyticsTimers[0].delayMs, 30_000, "visible analytics must preserve the intentional refresh cadence");
  assert.equal(analyticsRefreshes, 0);
  analyticsTimers[0].callback();
  assert.equal(analyticsRefreshes, 1);
  cleanupAnalyticsRefresh();
  assert.deepEqual(clearedAnalyticsTimers, [analyticsTimers[0]]);
  assert.match(
    analyticsAncillarySource,
    /selectAnalyticsAncillaryActivation\(activeTab, isPageVisible, embeddedWalletAddress\)[\s\S]*useDepositHistory\(embeddedWalletAddress \?\? undefined, activation\.readModelsEnabled\)[\s\S]*scheduleAnalyticsDepositRefresh\(\{[\s\S]*enabled: activation\.depositRefreshEnabled[\s\S]*useJackpotHistory\(activation\.readModelsEnabled\)/,
    "analytics hook must bind the behavior-tested visibility policy and bounded refresh scheduler",
  );
  assert.deepEqual(recentWins.normalizeWins("bad-shape"), []);
  const recentWinsSource = readFileSync("app/hooks/useRecentWins.ts", "utf8");
  let recentWinsAbortCount = 0;
  assert.equal(recentWins.shouldPollRecentWins(false, () => { recentWinsAbortCount += 1; }), false);
  assert.equal(recentWinsAbortCount, 1);
  assert.equal(recentWins.shouldPollRecentWins(true, () => { recentWinsAbortCount += 1; }), true);
  assert.equal(recentWinsAbortCount, 1);
  assert.match(
    recentWinsSource,
    /if \(!shouldPollRecentWins\(isPageVisible, \(\) => abortRef\.current\?\.abort\(\)\)\) return;[\s\S]*schedule\(initialDelay\)/,
    "recent wins hook must bind the behavior-tested hidden-tab abort policy before scheduling polling",
  );
  assert.deepEqual(
    recentWins.normalizeWins([
      { epoch: "11", user: "0x1", amount: "2.00", amountRaw: "2000000000000000000", tileId: 3 },
      { epoch: "12", user: "", amountRaw: "1" },
    ]),
    [{ epoch: "11", user: "0x1", amount: "2.00", amountRaw: "2000000000000000000", tileId: 3 }],
  );
  assert.deepEqual(
    recentWins.normalizeWins([0, 26, 2.5, 25].map((tileId) => ({
      epoch: "11",
      user: "0x1",
      amount: "2.00",
      amountRaw: "2000000000000000000",
      tileId,
    }))).map((row) => row.tileId ?? null),
    [null, null, null, 25],
  );
  const recentWinsCacheStorage = createMemoryReadStorage({
    recent: JSON.stringify({
      savedAt: 1_000,
      wins: [{ epoch: "11", user: "0x1", amount: "2.00", amountRaw: "2000000000000000000", tileId: 3 }],
    }),
  });
  const restoredRecentWinsCache = recentWins.loadRecentWinsCache(
    {
      getItem: () => recentWinsCacheStorage.getItem("recent"),
      removeItem: () => recentWinsCacheStorage.removeItem("recent"),
    },
    2_000,
  );
  assert.deepEqual(restoredRecentWinsCache, {
    wins: [{ epoch: "11", user: "0x1", amount: "2.00", amountRaw: "2000000000000000000", tileId: 3 }],
    savedAt: 1_000,
  });
  assert.equal(recentWins.getRecentWinsRefreshDelay(1_000, 1, 2_000), 44_000);
  assert.equal(recentWins.getRecentWinsRefreshDelay(1_000, 0, 2_000), 0);
  assert.equal(recentWins.getRecentWinsRefreshDelay(1_000, 1, 46_000), 0);
  assert.equal(recentWins.getRecentWinsRefreshDelay(8_001, 1, 2_000), 0);
  assert.deepEqual(
    leaderboards.normalizeLeaderboardsData({
      biggestSingleWin: [{ rank: 1, address: "0x1", value: "10", valueNum: 10 }],
      luckiest: "stale-bad-shape",
      oneTileWonder: [],
      whales: [],
      luckyTile: [{ tileId: 7, wins: 2, pct: 20 }],
    }),
    {
      biggestSingleWin: [{ rank: 1, address: "0x1", value: "10", valueNum: 10 }],
      luckiest: [],
      oneTileWonder: [],
      mostWins: [],
      whales: [],
      underdog: [],
      luckyTile: [{ tileId: 7, wins: 2, pct: 20 }],
    },
  );
  assert.deepEqual(
    leaderboards.normalizeLeaderboardsData({
      biggestSingleWin: [
        { rank: "1", address: "0x1", value: 10, valueNum: "bad", extra: 7 },
        { rank: 2, address: "", value: "skip", valueNum: 1 },
      ],
      luckyTile: [
        { tileId: 3, wins: "bad", pct: "bad" },
        { tileId: 4, wins: 2, pct: 20 },
      ],
    }).biggestSingleWin,
    [{ rank: 1, address: "0x1", value: "10", valueNum: 0, extra: "7" }],
  );
  assert.deepEqual(
    leaderboards.normalizeLeaderboardsData({
      luckyTile: [
        { tileId: 3, wins: "bad", pct: "bad" },
        { tileId: 4, wins: 2, pct: 20 },
        { tileId: Number.MAX_SAFE_INTEGER + 1, wins: 1, pct: 1 },
      ],
    }).luckyTile,
    [{ tileId: 4, wins: 2, pct: 20 }],
  );
  const leaderboardCacheRows = {
    biggestSingleWin: [{ rank: 1, address: "0x1", value: "10", valueNum: 10 }],
    luckyTile: [{ tileId: 7, wins: 2, pct: 20 }],
  };
  const leaderboardCacheEnvelopeStorage = {
    getItem: () => JSON.stringify({ savedAt: 1_000, data: leaderboardCacheRows }),
    removeItem: () => assert.fail("valid leaderboard cache must not be removed"),
  };
  assert.deepEqual(
    leaderboards.loadLeaderboardsCache(leaderboardCacheEnvelopeStorage, 2_000),
    {
      data: leaderboards.normalizeLeaderboardsData(leaderboardCacheRows),
      savedAt: 1_000,
    },
  );
  assert.deepEqual(
    leaderboards.loadLeaderboardsCache({
      getItem: () => JSON.stringify({ savedAt: 8_001, data: leaderboardCacheRows }),
      removeItem: () => assert.fail("future timestamp rejection must preserve normalized cache data"),
    }, 2_000),
    {
      data: leaderboards.normalizeLeaderboardsData(leaderboardCacheRows),
      savedAt: null,
    },
  );
  assert.deepEqual(
    leaderboards.loadLeaderboardsCache({
      getItem: () => JSON.stringify(leaderboardCacheRows),
      removeItem: () => assert.fail("legacy leaderboard cache must remain readable"),
    }, 2_000),
    {
      data: leaderboards.normalizeLeaderboardsData(leaderboardCacheRows),
      savedAt: null,
    },
  );
  const corruptLeaderboardCache = createMemoryReadStorage({ unrelated: "keep" });
  let corruptLeaderboardCacheKey = "";
  assert.deepEqual(
    leaderboards.loadLeaderboardsCache({
      getItem: (key) => {
        corruptLeaderboardCacheKey = key;
        return "{";
      },
      removeItem: (key) => corruptLeaderboardCache.removeItem(key),
    }, 2_000),
    { data: null, savedAt: null },
  );
  assert.deepEqual(corruptLeaderboardCache.removals, [corruptLeaderboardCacheKey]);
  assert.equal(corruptLeaderboardCache.has("unrelated"), true);
  const invalidLeaderboardEnvelopeStorage = createMemoryReadStorage({ unrelated: "keep" });
  let invalidLeaderboardEnvelopeKey = "";
  assert.deepEqual(
    leaderboards.loadLeaderboardsCache({
      getItem: (key) => {
        invalidLeaderboardEnvelopeKey = key;
        return JSON.stringify({ savedAt: 1_000, data: null });
      },
      removeItem: (key) => invalidLeaderboardEnvelopeStorage.removeItem(key),
    }, 2_000),
    { data: null, savedAt: null },
  );
  assert.deepEqual(invalidLeaderboardEnvelopeStorage.removals, [invalidLeaderboardEnvelopeKey]);
  assert.equal(invalidLeaderboardEnvelopeStorage.has("unrelated"), true);
  for (const invalidLeaderboardCache of [[], { savedAt: 1_000, data: [] }]) {
    const invalidArrayStorage = createMemoryReadStorage({ unrelated: "keep" });
    let invalidArrayKey = "";
    assert.deepEqual(
      leaderboards.loadLeaderboardsCache({
        getItem: (key) => {
          invalidArrayKey = key;
          return JSON.stringify(invalidLeaderboardCache);
        },
        removeItem: (key) => invalidArrayStorage.removeItem(key),
      }, 2_000),
      { data: null, savedAt: null },
    );
    assert.deepEqual(invalidArrayStorage.removals, [invalidArrayKey]);
    assert.equal(invalidArrayStorage.has("unrelated"), true);
  }
  assert.equal(leaderboards.getLeaderboardsRefreshDelay(1_000, 2_000), 59_000);
  assert.equal(leaderboards.getLeaderboardsRefreshDelay(1_000, 61_000), 0);
  assert.equal(leaderboards.getLeaderboardsRefreshDelay(8_001, 2_000), 0);
  assert.equal(leaderboards.getLeaderboardsRefreshDelay(1_000.5, 2_000), 0);
  assert.equal(
    leaderboards.getLeaderboardsLoadError(new Error("https://keyed.rpc.invalid/private?token=secret")),
    "Leaderboards are temporarily unavailable. Refresh this tab to retry.",
  );
  assert.equal(pageAncillary.shouldEnableLeaderboards("leaderboards", true), true);
  assert.equal(pageAncillary.shouldEnableLeaderboards("leaderboards", false), false);
  assert.equal(pageAncillary.shouldEnableLeaderboards("analytics", true), false);
  const leaderboardsSource = readFileSync("app/hooks/useLeaderboards.ts", "utf8");
  assert.match(
    leaderboardsSource,
    /initialCacheRef\.current = loadLeaderboardsCache\(\)[\s\S]*setError\(getLeaderboardsLoadError\(\)\)[\s\S]*const initialDelay = getLeaderboardsRefreshDelay\(savedAt\)/,
    "leaderboards hook must bind the executable cache, safe-error, and strict refresh policies",
  );
  const pageAncillarySource = readFileSync("app/hooks/usePageAncillaryData.ts", "utf8");
  assert.match(
    pageAncillarySource,
    /useLeaderboards\(shouldEnableLeaderboards\(activeTab, isPageVisible\)\)/,
    "page ancillary hook must bind the executable visible-leaderboard activation policy",
  );
  assert.deepEqual(
    rebate.normalizeRebatePayload({
      isSupported: true,
      pendingRebateWei: "1000",
      claimableEpochCount: 2,
      claimableEpochList: "bad-shape",
      totalEpochs: 3,
      participatingEpochs: [9, "bad", 10],
      recentEpochs: null,
    }),
    {
      isSupported: true,
      pendingRebateWei: "1000",
      claimableEpochCount: 2,
      claimableEpochList: [],
      totalEpochs: 3,
      participatingEpochs: [9, 10],
      recentEpochs: [],
      scan: {
        mode: "summary",
        complete: true,
        processedEpochs: 0,
        totalEpochs: 0,
        nextOffset: null,
        servingCommitted: false,
      },
    },
  );
  assert.deepEqual(
    rebate.normalizeRebatePayload({
      pendingRebateWei: "1000",
      claimableEpochCount: "02",
      claimableEpochList: [1, "2", "02", "1e3", 1.5, -1, Number.MAX_SAFE_INTEGER + 1],
      totalEpochs: "1e3",
      participatingEpochs: ["3", "003", 4],
      recentEpochs: [
        { epoch: "5", pendingWei: "7" },
        { epoch: "05", pendingWei: "9" },
        { epoch: 6.5, pendingWei: "11" },
      ],
    }),
    {
      isSupported: true,
      pendingRebateWei: "1000",
      claimableEpochCount: 0,
      claimableEpochList: [1, 2],
      totalEpochs: 0,
      participatingEpochs: [3, 4],
      recentEpochs: [{ epoch: 5, pendingWei: "7", pending: "0", claimed: false, resolved: false, userVolumeWei: "0", rebatePoolWei: "0" }],
      scan: {
        mode: "summary",
        complete: true,
        processedEpochs: 0,
        totalEpochs: 0,
        nextOffset: null,
        servingCommitted: false,
      },
    },
    "rebate API normalization must reject non-canonical epoch and count evidence",
  );
  assert.deepEqual(
    rebate.normalizeRebatePayload({
      pendingRebateWei: "bad",
      recentEpochs: [{ epoch: 5, pendingWei: "bad", userVolumeWei: "also-bad", rebatePoolWei: "7" }],
    }).recentEpochs,
    [{ epoch: 5, pendingWei: "0", pending: "0", claimed: false, resolved: false, userVolumeWei: "0", rebatePoolWei: "7" }],
  );
  assert.equal(
    rebate.normalizeRebatePayload({ pendingRebateWei: "bad" }).pendingRebateWei,
    "0",
  );
  assert.equal(
    rebate.normalizeRebatePayload({
      recentEpochs: Array.from({ length: 100 }, (_, index) => ({ epoch: index + 1, pendingWei: "1" })),
    }).recentEpochs.length,
    64,
    "rebate recent display rows must be capped before publishing stale cache payloads to UI",
  );
  assert.deepEqual(
    rebate.normalizeRebateHistoryPayload({
      rows: [
        { epoch: 12, pendingWei: "7", pending: "0.0000", resolved: true },
        { epoch: "bad", pendingWei: "9" },
      ],
      hasMore: true,
      nextCursor: 12,
    }),
    {
      isSupported: true,
      rows: [{ epoch: 12, pendingWei: "7", pending: "0.0000", claimed: false, resolved: true, userVolumeWei: "0", rebatePoolWei: "0" }],
      hasMore: true,
      nextCursor: 12,
      error: undefined,
    },
  );
  assert.equal(rebate.normalizeRebateHistoryPayload({ hasMore: true, nextCursor: "bad" }).nextCursor, null);
  assert.equal(rebate.normalizeRebateHistoryPayload({ hasMore: true, nextCursor: "12" }).nextCursor, 12);
  assert.equal(rebate.normalizeRebateHistoryPayload({ hasMore: true, nextCursor: "0012" }).nextCursor, null);
  assert.equal(rebate.normalizeRebateHistoryPayload({ hasMore: true, nextCursor: "1e3" }).nextCursor, null);
  assert.equal(
    rebate.normalizeRebateHistoryPayload({
      rows: Array.from({ length: 100 }, (_, index) => ({ epoch: index + 1, pendingWei: "1" })),
    }).rows.length,
    32,
    "rebate history pages must stay bounded before rendering older rows",
  );
  assert.deepEqual(
    rebate.mergeRebateEpochDetails(
      [{ epoch: 8, pendingWei: 2n, pending: "2", claimed: false, resolved: true, userVolumeWei: 1n, rebatePoolWei: 2n }],
      [
        { epoch: 8, pendingWei: 1n, pending: "1", claimed: false, resolved: true, userVolumeWei: 1n, rebatePoolWei: 1n },
        { epoch: 7, pendingWei: 3n, pending: "3", claimed: false, resolved: true, userVolumeWei: 1n, rebatePoolWei: 3n },
      ],
    ).map((row) => [row.epoch, row.pendingWei]),
    [[8, 2n], [7, 3n]],
  );
}
