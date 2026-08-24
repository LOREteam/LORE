import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as readModelSafetyModule from "../app/api/_lib/readModelSafety.ts";

const readModelSafety = readModelSafetyModule.default ?? readModelSafetyModule;
const {
  computeReadModelExpiresAt,
  isFreshReadModelCache,
  parseReadModelEpochNumber,
  parseReadModelTileId,
} = readModelSafety;

function runDepositsRouteBehaviorProbe() {
  const probeSource = String.raw`
import { mock } from "node:test";

const root = new URL("./", import.meta.url);
const unwrap = (namespace) => namespace.default ?? namespace;
const checksumUser = "0x52908400098527886E0F7030069857D2E4169EE7";
const normalizedUser = checksumUser.toLowerCase();
const originalFetch = globalThis.fetch;
const storageUserCalls = [];
const metaNumberCalls = [];
const filterCalls = [];
const rewardCalls = [];
const publicClientCalls = [];
const loggerCalls = [];
const metricCalls = [];
const rateLimitRequests = [];
let canonicalBlockCalls = 0;
let metaBigIntCalls = 0;
let rateLimitCalls = 0;
let fetchCalls = 0;
let shouldRateLimit = true;
let probeResult;

const txHash = (digit) => "0x" + digit.repeat(64);
const storedRows = {
  unsafeEpochFirst: {
    epoch: "9007199254740992",
    tileIds: [1],
    amounts: ["1"],
    totalAmount: "1",
    totalAmountNum: 1,
    txHash: txHash("a"),
    blockNumber: "100",
  },
  safeEpochSecond: {
    epoch: "7",
    tileIds: [2],
    amounts: ["2"],
    totalAmount: "2",
    totalAmountNum: 2,
    txHash: txHash("b"),
    blockNumber: "100",
  },
  corruptedBlock: {
    epoch: "9",
    tileIds: [3],
    amounts: ["3"],
    totalAmount: "3",
    totalAmountNum: 3,
    txHash: txHash("c"),
    blockNumber: "not-a-block",
  },
};

const snapshotEffects = () => ({
  rateLimitCalls,
  storageUserCalls: storageUserCalls.length,
  metaNumberCalls: metaNumberCalls.length,
  canonicalBlockCalls,
  metaBigIntCalls,
  filterCalls: filterCalls.length,
  rewardCalls: rewardCalls.length,
  publicClientCalls: publicClientCalls.length,
  loggerCalls: loggerCalls.length,
  metricCalls: metricCalls.length,
  fetchCalls,
});

globalThis.fetch = async (...args) => {
  fetchCalls += 1;
  throw new Error("unexpected fetch: " + String(args[0]));
};

try {
  mock.module(new URL("./server/storage.ts", root).href, {
    namedExports: {
      buildIndexerBetIdentity: () => {
        throw new Error("unexpected canonical deposit identity build");
      },
      getCanonicalLastIndexedBlock: () => {
        canonicalBlockCalls += 1;
        return "321";
      },
      getMetaBigInt: (key) => {
        metaBigIntCalls += 1;
        throw new Error("unexpected bigint meta read: " + key);
      },
      getMetaNumber: (key) => {
        metaNumberCalls.push(key);
        return null;
      },
      getUserBetsMap: (user, limit) => {
        storageUserCalls.push({ user, limit });
        return storedRows;
      },
      normalizeIndexerLogIndex: () => null,
    },
  });
  mock.module(new URL("./app/api/_lib/dataBridge.ts", root).href, {
    namedExports: {
      CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      CONTRACT_DEPLOY_BLOCK: 0n,
      filterByCurrentEpoch: (rows, currentEpoch) => {
        filterCalls.push({ rowCount: rows.length, currentEpoch });
        return rows;
      },
      isSafePositiveInteger: (value) => Number.isSafeInteger(value) && value > 0,
      publicClient: {
        getBlockNumber: async () => {
          publicClientCalls.push("getBlockNumber");
          throw new Error("unexpected block-number read");
        },
        getLogs: async () => {
          publicClientCalls.push("getLogs");
          throw new Error("unexpected log read");
        },
        readContract: async () => {
          publicClientCalls.push("readContract");
          throw new Error("unexpected contract read");
        },
      },
    },
  });
  mock.module(new URL("./app/api/_lib/rewardSummary.ts", root).href, {
    namedExports: {
      loadRewardMapsForUserEpochs: async (user, epochs) => {
        rewardCalls.push({ user, epochs });
        return {
          epochs: Object.fromEntries(epochs.map((epoch) => [String(epoch), {
            winningTile: 1,
            rewardPool: "1",
            isDailyJackpot: false,
            isWeeklyJackpot: false,
          }])),
          rewards: {},
        };
      },
    },
  });
  mock.module(new URL("./app/api/_lib/sharedRateLimit.ts", root).href, {
    namedExports: {
      enforceSharedRateLimit: async (request, options) => {
        rateLimitCalls += 1;
        rateLimitRequests.push({
          method: request.method,
          bucket: options.bucket,
          limit: options.limit,
          windowMs: options.windowMs,
        });
        return shouldRateLimit
          ? new Response(JSON.stringify({ error: "rate limited" }), {
              status: 429,
              headers: { "content-type": "application/json" },
            })
          : null;
      },
    },
  });
  mock.module(new URL("./app/api/_lib/runtimeMetrics.ts", root).href, {
    namedExports: {
      beginRouteMetric: () => {
        metricCalls.push("begin");
        return { startedAt: 0, finalized: false };
      },
      failRouteMetric: () => metricCalls.push("fail"),
      finishRouteMetric: () => metricCalls.push("finish"),
      markRouteBackgroundRefresh: () => metricCalls.push("background"),
      markRouteCacheHit: () => metricCalls.push("cache-hit"),
      markRouteInflightJoin: () => metricCalls.push("inflight-join"),
      markRouteStaleServed: () => metricCalls.push("stale"),
    },
  });
  mock.module(new URL("./app/api/_lib/routeError.ts", root).href, {
    namedExports: {
      logRouteError: (...args) => loggerCalls.push(args),
    },
  });

  const { NextRequest } = await import("next/server");
  const depositsRoute = unwrap(await import(
    new URL("./app/api/deposits/route.ts?recovery-storage-behavior-probe", root)
  ));

  const rateLimitedResponse = await depositsRoute.GET(new NextRequest(
    "https://example.test/api/deposits?user=0x1234&includeRewards=1",
  ));
  const rateLimitedBody = await rateLimitedResponse.json();
  const rateLimitedEffects = snapshotEffects();

  shouldRateLimit = false;
  const invalidUserResponse = await depositsRoute.GET(new NextRequest(
    "https://example.test/api/deposits?user=0x1234&includeRewards=1",
  ));
  const invalidUserBody = await invalidUserResponse.json();
  const invalidUserEffects = snapshotEffects();

  const successResponse = await depositsRoute.GET(new NextRequest(
    "https://example.test/api/deposits?user=" + checksumUser + "&includeRewards=1",
  ));
  const successBody = await successResponse.json();

  probeResult = {
    rateLimited: {
      status: rateLimitedResponse.status,
      body: rateLimitedBody,
      cacheControl: rateLimitedResponse.headers.get("cache-control"),
      pragma: rateLimitedResponse.headers.get("pragma"),
      expires: rateLimitedResponse.headers.get("expires"),
      effects: rateLimitedEffects,
    },
    invalidUser: {
      status: invalidUserResponse.status,
      body: invalidUserBody,
      cacheControl: invalidUserResponse.headers.get("cache-control"),
      effects: invalidUserEffects,
    },
    success: {
      status: successResponse.status,
      coverage: successBody.coverage,
      indexedThroughBlock: successBody.indexedThroughBlock,
      rewardsStatus: successBody.rewardsStatus,
      blockOrder: successBody.deposits.map((row) => row.blockNumber),
      epochOrder: successBody.deposits.map((row) => row.epoch),
      storageUserCalls,
      metaNumberCalls,
      canonicalBlockCalls,
      metaBigIntCalls,
      filterCalls,
      rewardCalls,
      publicClientCalls,
      loggerCalls,
      rateLimitCalls,
      rateLimitRequests,
      fetchCalls,
      normalizedUser,
    },
  };
} finally {
  globalThis.fetch = originalFetch;
  mock.restoreAll();
}

console.log(JSON.stringify(probeResult));
`;
  const poisonRoot = join(tmpdir(), `lore-deposits-recovery-${randomUUID()}`);
  const poisonDbPath = join(poisonRoot, "lore.sqlite");
  if (existsSync(poisonRoot) || existsSync(poisonDbPath)) {
    throw new Error("deposits route DB poison path must start absent");
  }
  const probe = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      probeSource,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        API_DEPOSITS_CHAIN_RECOVERY: "0",
        INDEXER_FINALITY_BLOCKS: "0",
        LORE_DB_PATH: poisonDbPath,
        NEXT_PHASE: "",
        TSX_DISABLE_CACHE: "1",
      },
      maxBuffer: 1_000_000,
      timeout: 30_000,
      windowsHide: true,
    },
  );
  if (existsSync(poisonRoot) || existsSync(poisonDbPath)) {
    throw new Error("deposits route probe unexpectedly created its DB poison path");
  }
  if (probe.error) {
    throw new Error("deposits route behavior probe failed to start", { cause: probe.error });
  }
  if (probe.status !== 0) {
    const detail = `${probe.stderr || ""}\n${probe.stdout || ""}`.trim().slice(-4_000);
    throw new Error(`deposits route behavior probe exited ${probe.status}: ${detail}`);
  }
  try {
    return JSON.parse(probe.stdout.trim());
  } catch (error) {
    throw new Error("deposits route behavior probe returned invalid JSON", { cause: error });
  }
}

function assertReadModelExpiryPolicy(candidate) {
  assert.equal(candidate(10, 20), 30, "a valid TTL must produce an exact expiry");
  assert.equal(
    candidate(1, Number.MAX_SAFE_INTEGER - 1),
    Number.MAX_SAFE_INTEGER,
    "an expiry at the safe-integer boundary must remain valid",
  );
  assert.equal(
    candidate(2, Number.MAX_SAFE_INTEGER - 1),
    Number.MAX_SAFE_INTEGER,
    "an overflowing TTL must clamp without wrapping or losing freshness",
  );
  for (const [ttlMs, now] of [
    [0, 20],
    [-1, 20],
    [1.5, 20],
    [Number.NaN, 20],
    [1, -1],
    [1, Number.NaN],
    [1, Number.MAX_SAFE_INTEGER + 1],
  ]) {
    assert.equal(candidate(ttlMs, now), 0, "malformed cache timing must fail closed");
  }
}

function assertReadModelFreshnessPolicy(candidate) {
  assert.equal(candidate({ expiresAt: 101 }, 100), true, "unexpired cache evidence must be fresh");
  assert.equal(candidate({ expiresAt: 100 }, 100), false, "expiry must be exclusive at the boundary");
  assert.equal(candidate({ expiresAt: 99 }, 100), false, "expired cache evidence must be stale");
  assert.equal(candidate({ expiresAt: Number.NaN }, 100), false, "malformed expiry must be stale");
  assert.equal(candidate({ expiresAt: 101 }, Number.NaN), false, "malformed caller time must be stale");
  assert.equal(candidate(null, 100), false, "a missing cache entry must be stale");
}

function assertReadModelEpochPolicy(candidate) {
  for (const [value, expected] of [
    [1, 1],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    [1n, 1],
    [BigInt(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
    ["1", 1],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
  ]) {
    assert.equal(candidate(value), expected, "canonical epoch evidence must narrow exactly");
  }
  for (const value of [
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    0n,
    -1n,
    BigInt(Number.MAX_SAFE_INTEGER) + 1n,
    "",
    "0",
    "01",
    "+1",
    "1e3",
    " 1",
    "1 ",
    "1.0",
    null,
    undefined,
  ]) {
    assert.equal(candidate(value), null, "non-canonical or unsafe epoch evidence must be rejected");
  }
}

function assertReadModelTilePolicy(candidate) {
  for (const [value, expected] of [[1, 1], [25, 25], [1n, 1], [25n, 25]]) {
    assert.equal(candidate(value), expected, "a protocol tile must narrow exactly");
  }
  for (const value of [0, -1, 1.5, 26, Number.NaN, Number.POSITIVE_INFINITY, 0n, -1n, 26n]) {
    assert.equal(candidate(value), null, "out-of-domain tile evidence must be rejected");
  }
}

export function runApiRecoveryStorageTests() {
  assertReadModelExpiryPolicy(computeReadModelExpiresAt);
  assertReadModelFreshnessPolicy(isFreshReadModelCache);
  assertReadModelEpochPolicy(parseReadModelEpochNumber);
  assertReadModelTilePolicy(parseReadModelTileId);

  assert.throws(
    () => assertReadModelExpiryPolicy((ttlMs, now) => now + ttlMs),
    /overflowing TTL/,
    "a raw-addition expiry mutant must be killed",
  );
  assert.throws(
    () => assertReadModelFreshnessPolicy((entry, now) => Boolean(entry && entry.expiresAt >= now)),
    /exclusive at the boundary/,
    "an inclusive-expiry freshness mutant must be killed",
  );
  assert.throws(
    () => assertReadModelEpochPolicy((value) => {
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    }),
    /unsafe epoch evidence/,
    "a broad Number coercion epoch mutant must be killed",
  );
  assert.throws(
    () => assertReadModelTilePolicy((value) => {
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
    }),
    /out-of-domain tile evidence/,
    "a missing tile upper-bound mutant must be killed",
  );

  const persistenceProbe = spawnSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/test-api-storage-persistence-behavior.ts"],
    { cwd: process.cwd(), encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(
    persistenceProbe.status,
    0,
    persistenceProbe.stderr || persistenceProbe.stdout || persistenceProbe.error?.message,
  );
  const persistenceSummary = JSON.parse(persistenceProbe.stdout.trim());
  assert.deepEqual(persistenceSummary, {
    status: "pass",
    activeSqliteArtifactsPreserved: true,
    strictPersistence: true,
    scopedPagination: true,
    boundedBridgeRead: true,
    storageLogsRedacted: true,
    mutantsKilled: 5,
    fakeRpcCallsHandled: true,
    networkCalls: 0,
  });

  const depositsRouteProbe = runDepositsRouteBehaviorProbe();
  assert.deepEqual(
    {
      status: depositsRouteProbe.success.status,
      coverage: depositsRouteProbe.success.coverage,
      indexedThroughBlock: depositsRouteProbe.success.indexedThroughBlock,
      rewardsStatus: depositsRouteProbe.success.rewardsStatus,
      publicClientCalls: depositsRouteProbe.success.publicClientCalls,
      loggerCalls: depositsRouteProbe.success.loggerCalls,
      fetchCalls: depositsRouteProbe.success.fetchCalls,
    },
    {
      status: 200,
      coverage: "partial",
      indexedThroughBlock: "321",
      rewardsStatus: "available",
      publicClientCalls: [],
      loggerCalls: [],
      fetchCalls: 0,
    },
    "deposits API must tolerate corrupted stored block numbers without recovery, logging, or network fallback",
  );
  assert.deepEqual(
    depositsRouteProbe.success.blockOrder,
    ["100", "100", "not-a-block"],
    "corrupted stored block numbers must narrow to zero and sort last instead of reaching BigInt directly",
  );
  assert.deepEqual(
    depositsRouteProbe.success.epochOrder,
    ["7", "9007199254740992", "9"],
    "unsafe stored epochs must narrow to zero for deterministic same-block ordering",
  );
  assert.deepEqual(
    depositsRouteProbe.success.rewardCalls,
    [{
      user: "0x52908400098527886e0f7030069857d2e4169ee7",
      epochs: [7, 9],
    }],
    "inline rewards must receive only canonical safe stored epochs and the normalized user",
  );
  assert.deepEqual(
    {
      storageUserCalls: depositsRouteProbe.success.storageUserCalls,
      metaNumberCalls: depositsRouteProbe.success.metaNumberCalls,
      canonicalBlockCalls: depositsRouteProbe.success.canonicalBlockCalls,
      metaBigIntCalls: depositsRouteProbe.success.metaBigIntCalls,
      filterCalls: depositsRouteProbe.success.filterCalls,
      rateLimitCalls: depositsRouteProbe.success.rateLimitCalls,
      rateLimitRequests: depositsRouteProbe.success.rateLimitRequests,
      invalidUser: depositsRouteProbe.invalidUser,
    },
    {
      storageUserCalls: [{
        user: "0x52908400098527886e0f7030069857d2e4169ee7",
        limit: 5000,
      }],
      metaNumberCalls: ["currentEpoch", "currentEpoch"],
      canonicalBlockCalls: 2,
      metaBigIntCalls: 0,
      filterCalls: [{ rowCount: 3, currentEpoch: null }],
      rateLimitCalls: 3,
      rateLimitRequests: [
        { method: "GET", bucket: "api-deposits", limit: 20, windowMs: 60_000 },
        { method: "GET", bucket: "api-deposits", limit: 20, windowMs: 60_000 },
        { method: "GET", bucket: "api-deposits", limit: 20, windowMs: 60_000 },
      ],
      invalidUser: {
        status: 400,
        body: { deposits: [], error: "Missing or invalid ?user=0x..." },
        cacheControl: "no-store, no-cache, must-revalidate",
        effects: {
          rateLimitCalls: 2,
          storageUserCalls: 0,
          metaNumberCalls: 0,
          canonicalBlockCalls: 0,
          metaBigIntCalls: 0,
          filterCalls: 0,
          rewardCalls: 0,
          publicClientCalls: 0,
          loggerCalls: 0,
          metricCalls: 0,
          fetchCalls: 0,
        },
      },
    },
    "deposits API must reject malformed users and canonicalize checksum users before bounded storage reads",
  );
  assert.deepEqual(
    depositsRouteProbe.rateLimited,
    {
      status: 429,
      body: { error: "rate limited" },
      cacheControl: "no-store, no-cache, must-revalidate",
      pragma: "no-cache",
      expires: "0",
      effects: {
        rateLimitCalls: 1,
        storageUserCalls: 0,
        metaNumberCalls: 0,
        canonicalBlockCalls: 0,
        metaBigIntCalls: 0,
        filterCalls: 0,
        rewardCalls: 0,
        publicClientCalls: 0,
        loggerCalls: 0,
        metricCalls: 0,
        fetchCalls: 0,
      },
    },
    "deposits API must return rate limits with no-store headers before validation, cache, storage, rewards, or recovery",
  );

  const depositsRouteSource = readFileSync("app/api/deposits/route.ts", "utf8");
  assert.match(
    depositsRouteSource,
    /formatLineaWeiDisplayNumber[\s\S]*function toDisplayNumberWei\(value: bigint\)[\s\S]*return formatLineaWeiDisplayNumber\(value\)/,
    "deposits API totalAmountNum compatibility fields must derive from bounded raw-wei formatting",
  );
  assert.doesNotMatch(
    depositsRouteSource,
    /totalAmountNum:\s*(?:Number\.)?parseFloat\(formatUnits\(|prev\.totalAmountNum = Number\.parseFloat\(prev\.totalAmount\)/,
    "deposits API must not derive totalAmountNum through parseFloat(formatUnits()) or parsed decimal strings",
  );
  assert.doesNotMatch(
    depositsRouteSource,
    /Number\(formatLineaAmountFixed\(value, 6\)\)/,
    "deposits API totalAmountNum compatibility fields must not parse formatted decimal strings",
  );
  assert.match(
    depositsRouteSource,
    /addressToTopic[\s\S]*getAddress\(address\)/,
    "deposits chain recovery must normalize user addresses before building indexed log topics",
  );
  assert.match(
    depositsRouteSource,
    /const LOG_CHUNK_BLOCKS = 10_000n/,
    "deposits API log scans must stay within the Linea public RPC 10k block limit",
  );
  const epochsRouteSource = readFileSync("app/api/epochs/route.ts", "utf8");
  assert.doesNotMatch(
    epochsRouteSource,
    /getEpochEndTime/,
    "resolved-epoch chain fallback must not issue guaranteed-zero end-time RPC reads",
  );
}
