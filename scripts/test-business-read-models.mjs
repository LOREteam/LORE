import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as liveStateSnapshotModule from "../app/hooks/useGameLiveStateSnapshot.ts";
import * as cacheTimestampModule from "../app/lib/cacheTimestamp.ts";
import * as gameCountdownModule from "../app/hooks/useGameCountdown.ts";
import * as globalStatsModule from "../app/hooks/useGlobalStats.ts";
import * as depositHistoryModule from "../app/hooks/useDepositHistory.ts";
import * as jackpotHistoryModule from "../app/hooks/useJackpotHistory.ts";
import * as recentWinsModule from "../app/hooks/useRecentWins.ts";
import * as leaderboardsModule from "../app/hooks/useLeaderboards.ts";
import * as rebateModule from "../app/hooks/useRebate.ts";

export function runReadModelTests() {
  const liveStateSnapshot = liveStateSnapshotModule.default ?? liveStateSnapshotModule;
  const cacheTimestamp = cacheTimestampModule.default ?? cacheTimestampModule;
  const globalStats = globalStatsModule.default ?? globalStatsModule;
  const depositHistory = depositHistoryModule.default ?? depositHistoryModule;
  const jackpotHistory = jackpotHistoryModule.default ?? jackpotHistoryModule;
  const recentWins = recentWinsModule.default ?? recentWinsModule;
  const leaderboards = leaderboardsModule.default ?? leaderboardsModule;
  const rebate = rebateModule.default ?? rebateModule;
  assert.equal(liveStateSnapshot.isLiveStateSnapshotFresh(1_000, 2_000), true);
  assert.equal(liveStateSnapshot.isLiveStateSnapshotFresh(2_000 + 6_000, 2_000), false);
  assert.equal(liveStateSnapshot.isLiveStateSnapshotFresh(2_000 + 5_000, 2_000), true);
  assert.equal(liveStateSnapshot.isLiveStateSnapshotFresh(2_000 - 13 * 60 * 60 * 1000, 2_000), false);
  assert.equal(liveStateSnapshot.isLiveStateSnapshotFresh(1_000.5, 2_000), false);
  assert.equal(liveStateSnapshot.isLiveStateSnapshotFresh(Number.MAX_SAFE_INTEGER + 1, 2_000), false);
  assert.equal(liveStateSnapshot.isLiveStateSnapshotFresh(1_000, 2_000.5), false);
  assert.equal(liveStateSnapshot.isLiveStateSnapshotFresh(1_000, Number.NaN), false);
  const liveStateSnapshotSource = readFileSync("app/hooks/useGameLiveStateSnapshot.ts", "utf8");
  assert.match(
    liveStateSnapshotSource,
    /function normalizeLiveStateSnapshotTimestamp[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*Number\.isSafeInteger\(now\)[\s\S]*value - now > LIVE_STATE_SNAPSHOT_MAX_FUTURE_SKEW_MS[\s\S]*const normalizedFetchedAt = normalizeLiveStateSnapshotTimestamp\(fetchedAt, now\)/,
    "live-state snapshot freshness must use safe-integer non-future timestamp normalization",
  );
  assert.doesNotMatch(
    liveStateSnapshotSource,
    /typeof fetchedAt !== "number" \|\| !Number\.isFinite\(fetchedAt\)|now - fetchedAt <= LIVE_STATE_SNAPSHOT_MAX_AGE_MS/,
    "live-state snapshot freshness must not return to broad finite timestamp arithmetic",
  );
  assert.equal(liveStateSnapshot.getLiveStateFailurePollIntervalCount(0), 1);
  assert.equal(liveStateSnapshot.getLiveStateFailurePollIntervalCount(2), 1);
  assert.equal(liveStateSnapshot.getLiveStateFailurePollIntervalCount(3), 2);
  assert.equal(liveStateSnapshot.getLiveStateFailurePollIntervalCount(5), 4);
  assert.equal(liveStateSnapshot.getLiveStateFailurePollIntervalCount(100), 4);
  assert.equal(liveStateSnapshot.getLiveStateFailurePollIntervalCount(-1), 1);
  assert.equal(liveStateSnapshot.getLiveStateFailurePollIntervalCount(1.5), 1);
  assert.equal(liveStateSnapshot.getLiveStateFailurePollIntervalCount(Number.NaN), 1);
  assert.equal(liveStateSnapshot.getLiveStateFailurePollIntervalCount(Number.MAX_SAFE_INTEGER + 1), 1);
  assert.match(
    liveStateSnapshotSource,
    /function getLiveStateFailurePollIntervalCount\(consecutiveFailures: number\)[\s\S]*Number\.isSafeInteger\(consecutiveFailures\)[\s\S]*consecutiveFailures > 0[\s\S]*failures - 2/,
    "live-state failure polling backoff must reject malformed counters instead of returning NaN",
  );
  assert.doesNotMatch(
    liveStateSnapshotSource,
    /Math\.trunc\(consecutiveFailures\)/,
    "live-state failure polling backoff must not coerce malformed counters with Math.trunc",
  );
  assert.equal(liveStateSnapshot.shouldDisableLiveContractReadsAfterRecovery(false, 1), false);
  assert.equal(liveStateSnapshot.shouldDisableLiveContractReadsAfterRecovery(false, 2), true);
  assert.equal(liveStateSnapshot.shouldDisableLiveContractReadsAfterRecovery(true, 2), false);
  assert.equal(liveStateSnapshot.shouldDisableLiveContractReadsAfterRecovery(false, 2.5), false);
  assert.equal(liveStateSnapshot.shouldDisableLiveContractReadsAfterRecovery(false, Number.NaN), false);
  assert.equal(
    liveStateSnapshot.shouldDisableLiveContractReadsAfterRecovery(false, Number.MAX_SAFE_INTEGER + 1),
    false,
  );
  assert.match(
    liveStateSnapshotSource,
    /function shouldDisableLiveContractReadsAfterRecovery[\s\S]*Number\.isSafeInteger\(consecutiveSuccesses\)[\s\S]*consecutiveSuccesses >= 2/,
    "live-state recovery must only disable live contract reads after a safe integer success count",
  );
  assert.match(
    liveStateSnapshotSource,
    /readJsonResponse<LiveStateApiResponse>/,
    "live-state snapshot fetch must use the bounded JSON response helper",
  );
  assert.doesNotMatch(
    liveStateSnapshotSource,
    /response\.json\(\)/,
    "live-state snapshot fetch must not use unbounded response.json",
  );
  assert.match(
    liveStateSnapshotSource,
    /import \{ APP_CHAIN_ID, CONTRACT_ADDRESS, GRID_SIZE \}[\s\S]*function hasGridLength[\s\S]*values\.length === GRID_SIZE[\s\S]*!hasGridLength\(tileData\.pools[\s\S]*!hasGridLength\(tileData\.users[\s\S]*!hasGridLength\(counts[\s\S]*!hasGridLength\(indexedTilePools\)/,
    "live-state snapshot fallbacks must reject malformed non-grid tile arrays before rendering cached data",
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
  const cacheTimestampSource = readFileSync("app/lib/cacheTimestamp.ts", "utf8");
  assert.match(
    cacheTimestampSource,
    /function normalizeCacheTimestamp[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*Number\.isSafeInteger\(now\)[\s\S]*Number\.isSafeInteger\(maxFutureSkewMs\)/,
    "client cache timestamps must reject unsafe, fractional, or malformed times",
  );
  assert.match(
    cacheTimestampSource,
    /function getFreshCacheDelayMs\(savedAt: unknown, ttlMs: number, now = Date\.now\(\)\)[\s\S]*normalizeCacheTimestamp\(savedAt, now\)[\s\S]*Number\.isSafeInteger\(ttlMs\)[\s\S]*Math\.max\(0, now - normalizedSavedAt\)[\s\S]*return ttlMs - ageMs/,
    "client cache refresh delays must use the strict timestamp helper",
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
    /export function normalizeEpochEndMs\(epochEndTime\?: bigint\): number \| null[\s\S]*epochEndTime < 0n[\s\S]*epochEndTime > MAX_SAFE_EPOCH_END_SECONDS[\s\S]*Number\.isSafeInteger\(endMs\)/,
    "game countdown must safely narrow chain epoch-end timestamps before millisecond math",
  );
  assert.match(
    gameCountdownSource,
    /const endMs = normalizeEpochEndMs\(effectiveEpochEndTime\)[\s\S]*if \(endMs === null\)[\s\S]*setTimeLeft\(0\)[\s\S]*setPollPhase\("slow"\)[\s\S]*return;/,
    "game countdown must fail closed on unsafe epoch-end timestamps without entering zero-refetch handling",
  );
  assert.doesNotMatch(
    gameCountdownSource,
    /Number\(effectiveEpochEndTime\) \* 1000/,
    "game countdown must not broadly coerce chain epoch-end timestamps before millisecond math",
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
  const globalStatsSource = readFileSync("app/hooks/useGlobalStats.ts", "utf8");
  assert.match(
    globalStatsSource,
    /fetch\("\/api\/global-stats", \{ cache: "no-store", signal: controller\.signal \}\)/,
    "global stats must use the indexer-backed aggregate API instead of rescanning chain logs in every browser",
  );
  assert.match(
    globalStatsSource,
    /getUsableGlobalStatsAccumulator\(cached,\s*currentEpochNumber\)/,
    "global stats cache restore must reject values from epochs newer than the current chain epoch",
  );
  assert.match(
    globalStatsSource,
    /getUsableGlobalStatsAccumulator\(accRef\.current,\s*currentEpochNumber\)[\s\S]*localStorage\.removeItem\(STORAGE_KEY\)[\s\S]*setStats\(null\)/,
    "global stats hook must clear stale future cache storage after current epoch recovery",
  );
  assert.match(
    globalStatsSource,
    /const raw = localStorage\.getItem\(STORAGE_KEY\)[\s\S]*const acc = normalizeGlobalStatsAccumulator\(JSON\.parse\(raw\)\)[\s\S]*localStorage\.removeItem\(STORAGE_KEY\)/,
    "global stats cache reads must clear corrupt or invalid localStorage entries",
  );
  assert.match(
    globalStatsSource,
    /readJsonResponse<Record<string, unknown>>/,
    "global stats API reads must use the bounded JSON response helper",
  );
  assert.doesNotMatch(
    globalStatsSource,
    /response\.json\(\)/,
    "global stats API reads must not use unbounded response.json",
  );
  assert.match(
    globalStatsSource,
    /function parseNonNegativeSafeInteger[\s\S]*typeof value === "number"[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*\/\^\\d\+\$\/\.test\(value\)[\s\S]*Number\.isSafeInteger\(parsed\)/,
    "global stats cache and API counters must use canonical non-negative safe-integer parsing",
  );
  assert.doesNotMatch(
    globalStatsSource,
    /Number\((?:obj|payload)\.(?:resolvedEpochs|lastScannedEpoch)\)/,
    "global stats must not broadly coerce cache or API epoch counters with Number(...)",
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
  const depositHistorySource = readFileSync("app/hooks/useDepositHistory.ts", "utf8");
  assert.doesNotMatch(
    depositHistorySource,
    /Number\(b\.epoch\)\s*-\s*Number\(a\.epoch\)/,
    "deposit history must not sort with unchecked epoch numbers",
  );
  assert.match(
    depositHistorySource,
    /formatLineaWeiDisplayNumber[\s\S]*function toDisplayNumberWei\(value: bigint\)[\s\S]*return formatLineaWeiDisplayNumber\(value\)/,
    "deposit history numeric compatibility values must derive from bounded raw-wei formatting",
  );
  assert.doesNotMatch(
    depositHistorySource,
    /Number\(formatLineaAmountFixed\(value, 6\)\)/,
    "deposit history numeric compatibility values must not parse formatted decimal strings",
  );
  assert.match(
    depositHistorySource,
    /function normalizeDepositTxHash\(value: unknown\)[\s\S]*\/\^0x\[0-9a-f\]\{64\}\$\/\.test\(normalized\)[\s\S]*const txHash = normalizeDepositTxHash\(item\.txHash\)[\s\S]*txHash: normalizeDepositTxHash\(d\.txHash\)/,
    "deposit history cache/API mapping must only preserve full transaction hashes",
  );
  assert.doesNotMatch(
    depositHistorySource,
    /txHash:\s*d\.txHash|\/\^0x\[0-9a-fA-F\]\{64\}\$\/\.test\(item\.txHash\)/,
    "deposit history cache/API mapping must not publish raw or case-preserving txHash strings",
  );
  assert.doesNotMatch(
    depositHistorySource,
    /Number\(formatUnits\((?:parseLineaAmountWei\(value\)|rewardWei|totalAmountWei), 18\)\)/,
    "deposit history mapping must not coerce raw wei through Number(formatUnits())",
  );
  assert.match(
    depositHistorySource,
    /function parseSafeNonNegativeIntegerNumber[\s\S]*\/\^\(\?:0\|\[1-9\]\\d\*\)\$\/\.test\(value\)[\s\S]*BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function normalizeCachedNumberArray[\s\S]*\.map\(normalizeCachedDisplayNumber\)[\s\S]*function normalizeCachedTileIds[\s\S]*\.map\(normalizeCachedIntegerNumber\)[\s\S]*function normalizeCachedIntegerNumber[\s\S]*function normalizeCachedDisplayNumber[\s\S]*amountNum: normalizeCachedDisplayNumber\(item\.amountNum\) \?\? 0[\s\S]*reward: normalizeCachedDisplayNumber\(item\.reward\)/,
    "deposit history cache normalization must canonical-parse cached numeric evidence before publishing UI data",
  );
  assert.doesNotMatch(
    depositHistorySource,
    /\.map\(\(item\) => Number\(item\)\)|amountNum: Number\.isFinite\(item\.amountNum\)|reward: Number\.isFinite\(item\.reward\)|Number\.isInteger\(item\.winningTile\)/,
    "deposit history cache normalization must not use broad Number coercion for cached amounts, tiles, or rewards",
  );
  assert.match(
    depositHistorySource,
    /DEPOSIT_HISTORY_LOAD_ERROR[\s\S]*setError\(DEPOSIT_HISTORY_LOAD_ERROR\)/,
    "deposit history UI must use stable safe error copy instead of raw provider/API messages",
  );
  assert.match(
    depositHistorySource,
    /readJsonResponse<\{ epochs\?: Record<string, ApiEpoch> \}>[\s\S]*readJsonResponse<\{ rewards\?: Record<string, ApiRewardInfo> \}>[\s\S]*readJsonResponse<typeof depositsJson>/,
    "deposit history API reads must use the bounded JSON response helper",
  );
  assert.doesNotMatch(
    depositHistorySource,
    /response\.json\(\)|depositsRes\.json\(\)/,
    "deposit history API reads must not use unbounded response.json",
  );
  assert.doesNotMatch(
    depositHistorySource,
    /setError\(depositsJson\.error \|\| `HTTP \$\{depositsRes\.status\}`\)/,
    "deposit history HTTP/API failures must not surface raw backend error text",
  );
  assert.match(
    depositHistorySource,
    /function loadCachedDeposits[\s\S]*const data = normalizeCachedDepositEntries\(parsed\)[\s\S]*localStorage\.removeItem\(cacheKey\)[\s\S]*const data = normalizeCachedDepositEntries\(parsed\.data\)[\s\S]*if \(!data\)[\s\S]*localStorage\.removeItem\(cacheKey\)/,
    "deposit history cache restore must normalize and clear invalid legacy/envelope entries before publishing cached UI data",
  );
  assert.match(
    depositHistorySource,
    /const refreshDelayMs = getFreshCacheDelayMs\(savedAt, DEPOSIT_CACHE_TTL_MS\)[\s\S]*if \(refreshDelayMs !== null\)[\s\S]*window\.setTimeout\([\s\S]*refreshDelayMs/,
    "deposit history cache refresh delay must use the shared strict timestamp helper",
  );
  assert.doesNotMatch(
    depositHistorySource,
    /Date\.now\(\) - savedAt < DEPOSIT_CACHE_TTL_MS|DEPOSIT_CACHE_TTL_MS - \(Date\.now\(\) - savedAt\)/,
    "deposit history cache refresh must not use broad savedAt age arithmetic",
  );
  const jackpotHistorySource = readFileSync("app/hooks/useJackpotHistory.ts", "utf8");
  assert.match(
    jackpotHistorySource,
    /formatLineaWeiDisplayNumber[\s\S]*function toDisplayNumberWei\(value: bigint\)[\s\S]*return formatLineaWeiDisplayNumber\(value\)/,
    "jackpot history numeric compatibility fields must derive from bounded raw-wei formatting",
  );
  assert.doesNotMatch(
    jackpotHistorySource,
    /Number\(formatLineaAmountFixed\(value, 6\)\)/,
    "jackpot history numeric compatibility fields must not parse formatted decimal strings",
  );
  assert.match(
    jackpotHistorySource,
    /function normalizeAmount\(value: unknown, fallback = 0\): number[\s\S]*formatDecimalTextFixed\(String\(value \?\? ""\)\.trim\(\), 6\)/,
    "jackpot history legacy numeric fallback must use canonical decimal-text formatting",
  );
  assert.match(
    jackpotHistorySource,
    /function normalizeTxHash\(value: unknown\)[\s\S]*\/\^0x\[0-9a-f\]\{64\}\$\/\.test\(normalized\)[\s\S]*txHash: normalizeTxHash\(row\.txHash\)/,
    "jackpot history cache/API normalization must only preserve full transaction hashes",
  );
  assert.doesNotMatch(
    jackpotHistorySource,
    /txHash:\s*String\(row\.txHash \?\? ""\)/,
    "jackpot history cache/API normalization must not publish raw txHash strings",
  );
  assert.doesNotMatch(
    jackpotHistorySource,
    /formatUnits|amountNum\.toFixed\(2\)|Number\.parseFloat/,
    "jackpot history must not derive amount display or compatibility numbers from formatUnits(), amountNum.toFixed(2), or parseFloat",
  );
  assert.doesNotMatch(
    jackpotHistorySource,
    /Number\(b\.epoch\)\s*-\s*Number\(a\.epoch\)/,
    "jackpot history must not sort with unchecked epoch numbers",
  );
  assert.match(
    jackpotHistorySource,
    /JACKPOT_HISTORY_LOAD_ERROR[\s\S]*setError\(JACKPOT_HISTORY_LOAD_ERROR\)/,
    "jackpot history UI must use stable safe error copy instead of raw provider/API messages",
  );
  assert.match(
    jackpotHistorySource,
    /readJsonResponse<JackpotApiResponse>/,
    "jackpot history API reads must use the bounded JSON response helper",
  );
  assert.match(
    jackpotHistorySource,
    /const raw = localStorage\.getItem\(STORAGE_KEY\)[\s\S]*localStorage\.removeItem\(STORAGE_KEY\)/,
    "jackpot history cache reads must clear corrupt or invalid localStorage entries",
  );
  assert.match(
    jackpotHistorySource,
    /const initialDelay = getFreshCacheDelayMs\(savedAt, REFRESH_MS\) \?\? 0/,
    "jackpot history cache refresh delay must use the shared strict timestamp helper",
  );
  assert.doesNotMatch(
    jackpotHistorySource,
    /Date\.now\(\) - savedAt < REFRESH_MS|REFRESH_MS - \(Date\.now\(\) - savedAt\)/,
    "jackpot history cache refresh must not use broad savedAt age arithmetic",
  );
  assert.doesNotMatch(
    jackpotHistorySource,
    /res\.json\(\)|response\.json\(\)/,
    "jackpot history API reads must not use unbounded response.json",
  );
  const analyticsDepositsPanelSource = readFileSync("app/components/analytics/AnalyticsDepositsPanel.tsx", "utf8");
  assert.match(
    analyticsDepositsPanelSource,
    /role="status"[\s\S]*aria-live="polite"[\s\S]*aria-busy=\{statusActive\}[\s\S]*\{statusLabel\}/,
    "deposit history refresh/sync status chip must be announced without changing refresh behavior",
  );
  assert.match(
    analyticsDepositsPanelSource,
    /role="status"[\s\S]*aria-live="polite"[\s\S]*aria-busy="true"[\s\S]*<LoreText items=\{loadingQuotes\}/,
    "deposit history initial loading state must be announced as a polite busy status",
  );
  assert.match(
    analyticsDepositsPanelSource,
    /aria-label=\{`Open deposit transaction \$\{row\.txHash\.slice\(0, 6\)\}\.\.\.\$\{row\.txHash\.slice\(-4\)\} on Lineascan`\}[\s\S]*title="Open deposit transaction on Lineascan"/,
    "deposit history Lineascan links must expose a transaction-specific accessible label",
  );
  const analyticsJackpotHistoryPanelSource = readFileSync("app/components/analytics/AnalyticsJackpotHistoryPanel.tsx", "utf8");
  assert.match(
    analyticsJackpotHistoryPanelSource,
    /jackpotHistoryLoading \?[\s\S]*role="status"[\s\S]*aria-live="polite"[\s\S]*aria-busy="true"[\s\S]*<LoreText items=\{loadingQuotes\}/,
    "jackpot history loading state must be announced as a polite busy status",
  );
  assert.match(
    analyticsJackpotHistoryPanelSource,
    /aria-label=\{`Open jackpot transaction \$\{entry\.txHash\.slice\(0, 6\)\}\.\.\.\$\{entry\.txHash\.slice\(-4\)\} on Lineascan`\}[\s\S]*title="Open jackpot transaction on Lineascan"/,
    "jackpot history Lineascan links must expose a transaction-specific accessible label",
  );
  const analyticsAncillarySource = readFileSync("app/hooks/useAnalyticsAncillaryData.ts", "utf8");
  assert.match(
    analyticsAncillarySource,
    /useDepositHistory\(embeddedWalletAddress \?\? undefined, analyticsActive && isPageVisible\)/,
    "hidden analytics tabs must pause deposit-history work",
  );
  assert.match(
    analyticsAncillarySource,
    /useJackpotHistory\(analyticsActive && isPageVisible\)/,
    "hidden analytics tabs must pause jackpot-history work",
  );
  assert.doesNotMatch(
    analyticsAncillarySource,
    /120_000/,
    "analytics ancillary polling must stop while hidden instead of keeping a background interval",
  );
  assert.deepEqual(recentWins.normalizeWins("bad-shape"), []);
  const recentWinsSource = readFileSync("app/hooks/useRecentWins.ts", "utf8");
  assert.match(
    recentWinsSource,
    /const raw = localStorage\.getItem\(STORAGE_KEY\)[\s\S]*localStorage\.removeItem\(STORAGE_KEY\)/,
    "recent wins cache reads must clear corrupt or invalid localStorage entries",
  );
  assert.match(
    recentWinsSource,
    /if \(!isPageVisible\) \{[\s\S]*abortRef\.current\?\.abort\(\);[\s\S]*return;/,
    "recent wins must stop its native polling loop and abort an in-flight request while hidden",
  );
  assert.match(
    recentWinsSource,
    /cachedWinsCountRef\.current > 0[\s\S]*getFreshCacheDelayMs\(savedAt, REFRESH_MS\) \?\? 0/,
    "recent wins cache refresh delay must use the shared strict timestamp helper",
  );
  assert.match(
    recentWinsSource,
    /GRID_SIZE[\s\S]*Number\.isSafeInteger\(tileId\)[\s\S]*tileId >= 1[\s\S]*tileId <= GRID_SIZE/,
    "recent wins client normalizer must reject non-canonical tile IDs",
  );
  assert.doesNotMatch(
    recentWinsSource,
    /Number\.isInteger\(tileId\) && tileId > 0/,
    "recent wins client normalizer must not accept positive-only tile IDs",
  );
  assert.doesNotMatch(
    recentWinsSource,
    /Date\.now\(\) - savedAt < REFRESH_MS|REFRESH_MS - \(Date\.now\(\) - savedAt\)/,
    "recent wins cache refresh must not use broad savedAt age arithmetic",
  );
  assert.doesNotMatch(
    recentWinsSource,
    /HIDDEN_REFRESH_MS/,
    "recent wins must resume cache-aware visible polling instead of keeping a hidden timer",
  );
  assert.deepEqual(
    recentWins.normalizeWins([
      { epoch: "11", user: "0x1", amount: "2.00", amountRaw: "2000000000000000000", tileId: 3 },
      { epoch: "12", user: "", amountRaw: "1" },
    ]),
    [{ epoch: "11", user: "0x1", amount: "2.00", amountRaw: "2000000000000000000", tileId: 3 }],
  );
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
  const leaderboardsSource = readFileSync("app/hooks/useLeaderboards.ts", "utf8");
  assert.match(
    leaderboardsSource,
    /GRID_SIZE[\s\S]*Number\.isSafeInteger\(tileId\)[\s\S]*tileId < 1 \|\| tileId > GRID_SIZE/,
    "leaderboards lucky tile normalizer must reject unsafe or out-of-range tile ids",
  );
  assert.match(
    leaderboardsSource,
    /LEADERBOARD_LOAD_ERROR[\s\S]*setError\(LEADERBOARD_LOAD_ERROR\)/,
    "leaderboards UI must use stable safe error copy instead of raw provider/API messages",
  );
  assert.match(
    leaderboardsSource,
    /const raw = localStorage\.getItem\(STORAGE_KEY\)[\s\S]*localStorage\.removeItem\(STORAGE_KEY\)/,
    "leaderboard cache reads must clear corrupt or invalid localStorage entries",
  );
  assert.match(
    leaderboardsSource,
    /const initialDelay = getFreshCacheDelayMs\(savedAt, LEADERBOARD_CACHE_TTL_MS\) \?\? 0/,
    "leaderboard cache refresh delay must use the shared strict timestamp helper",
  );
  assert.doesNotMatch(
    leaderboardsSource,
    /Date\.now\(\) - savedAt < LEADERBOARD_CACHE_TTL_MS|LEADERBOARD_CACHE_TTL_MS - \(Date\.now\(\) - savedAt\)/,
    "leaderboard cache refresh must not use broad savedAt age arithmetic",
  );
  const pageAncillarySource = readFileSync("app/hooks/usePageAncillaryData.ts", "utf8");
  assert.match(
    pageAncillarySource,
    /useLeaderboards\(activeTab === "leaderboards" && isPageVisible\)/,
    "hidden leaderboard tabs must pause their native cache refresh timer",
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
