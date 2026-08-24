import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as publicReadModelPolicyModule from "../app/api/_lib/publicReadModelPolicy.ts";
import { runIsolatedBusinessLogicChild } from "./business-logic-isolated-runner.mjs";

const policy = publicReadModelPolicyModule.default ?? publicReadModelPolicyModule;
const {
  RECENT_WINS_RECOVERY_POLICY,
  buildPublicReadModelFailure,
  buildPublicRewardClaimStorageIdentity,
  collectPublicLeaderboardWinningTiles,
  comparePublicBigIntDesc,
  computePublicLeaderboardRoiBasisPoints,
  createPublicReadModelCacheKey,
  createPublicReadModelJsonResponse,
  formatPublicLeaderboardRoiPercent,
  formatPublicRecentClaimAmount,
  isFreshPublicReadModelSnapshot,
  mergePublicRewardClaims,
  normalizePublicReadModelAddress,
  normalizePublicTransactionHash,
  parsePublicReadModelTileId,
  parsePublicRewardsEpochs,
  sanitizePublicLeaderboardName,
  selectPublicLeaderboardWinningTile,
  sortPublicRewardClaimsDesc,
  toPublicLeaderboardRoiValueNum,
  toPublicWeiDisplayNumber,
} = policy;

const CHECKSUM_ADDRESS = "0x00000000000000000000000000000000000000aA";
const NORMALIZED_ADDRESS = CHECKSUM_ADDRESS.toLowerCase();
const HASH_A = `0x${"a".repeat(64)}`;
const HASH_B = `0x${"b".repeat(64)}`;
const STORAGE_BEHAVIOR_CHILD_ARG = "--public-read-model-storage-child";
const ROUTE_BEHAVIOR_CHILD_ARG = "--public-read-model-route-child";

function pathIsInsideOrSame(rootPath, candidatePath) {
  const relativePath = relative(rootPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function buildStorageBehaviorChildEnvironment() {
  const childEnv = { ...process.env };
  const overriddenKeys = new Set([
    "lore_premainnet_runtime_strict",
    "next_public_linea_network",
    "node_env",
  ]);
  for (const name of Object.keys(childEnv)) {
    if (overriddenKeys.has(name.toLowerCase())) delete childEnv[name];
  }
  childEnv.LORE_PREMAINNET_RUNTIME_STRICT = "0";
  childEnv.NEXT_PUBLIC_LINEA_NETWORK = "sepolia";
  childEnv.NODE_ENV = "test";
  return childEnv;
}

function assertRevision(storage, expected, message) {
  assert.equal(storage.getPublicReadModelRevision(), String(expected), message);
}

function assertRevisionAdvance(storage, previous, action, message) {
  action();
  assertRevision(storage, BigInt(previous) + 1n, message);
  return BigInt(previous) + 1n;
}

async function runPublicReadModelStorageBehaviorChild() {
  const configuredDbPath = process.env.LORE_DB_PATH?.trim() ?? "";
  const projectRoot = resolve(process.cwd());
  assert.ok(isAbsolute(configuredDbPath), "storage behavior child requires an absolute LORE_DB_PATH");
  assert.equal(
    pathIsInsideOrSame(projectRoot, resolve(configuredDbPath)),
    false,
    "storage behavior child database must stay outside the repository",
  );
  assert.equal(process.env.LORE_ALLOW_CONTRACT_SCOPE_PURGE, "0");

  const storageModule = await import("../server/storage.ts");
  const storage = storageModule.default ?? storageModule;
  const user = "0x0000000000000000000000000000000000000001";
  const leaseOwnerToken = "public-read-model-test-lease";
  let revision = 0n;

  assertRevision(storage, revision, "a fresh scoped database must start at revision zero");
  revision = assertRevisionAdvance(storage, revision, () => storage.upsertEpochMap({
    "101": {
      winningTile: 7,
      totalPool: "1000",
      rewardPool: "900",
      fee: "100",
      jackpotBonus: "25",
      isDailyJackpot: true,
      isWeeklyJackpot: false,
      resolvedBlock: "100",
    },
  }), "accepted epoch write must advance the revision exactly once");
  assert.equal(storage.getEpochMap()["101"]?.resolvedBlock, "100");

  revision = assertRevisionAdvance(storage, revision, () => storage.upsertBets([{
    epoch: "101",
    user,
    tileIds: [7],
    amounts: ["10"],
    totalAmount: "10",
    totalAmountNum: 10,
    txHash: HASH_A,
    blockNumber: "100",
    logIndex: "0",
  }]), "accepted bet write must advance the revision exactly once");
  assert.equal(storage.getAllBetRows().length, 1);

  revision = assertRevisionAdvance(storage, revision, () => storage.upsertJackpots([{
    epoch: "101",
    kind: "daily",
    amount: "25",
    amountNum: 25,
    txHash: HASH_A,
    blockNumber: "100",
  }]), "accepted jackpot write must advance the revision exactly once");
  assert.equal(storage.getRecentJackpots(5).length, 1);

  revision = assertRevisionAdvance(storage, revision, () => storage.upsertRewardClaims([{
    id: "claim-101",
    epoch: "101",
    user,
    reward: "900",
    rewardNum: 900,
    txHash: HASH_B,
    blockNumber: "100",
  }]), "accepted reward write must advance the revision exactly once");
  assert.equal(storage.getAllRewardClaims().length, 1);

  revision = assertRevisionAdvance(storage, revision, () => storage.upsertProtocolFeeFlushes([{
    id: "fee-101",
    ownerAmount: "75",
    burnAmount: "25",
    txHash: HASH_B,
    blockNumber: "100",
  }]), "accepted fee write must advance the revision exactly once");
  assert.equal(storage.getGlobalStatsAggregate().totalBurnWei, "25000000000000000000");

  revision = assertRevisionAdvance(storage, revision, () => storage.upsertChatProfile(user, {
    name: "Revision Test",
    avatar: "miner",
    customAvatar: null,
    updatedAt: 1,
  }), "accepted profile write must advance the revision exactly once");
  assert.equal(storage.getChatProfile(user)?.name, "Revision Test");

  storage.upsertEpochMap({});
  storage.upsertBets([]);
  storage.upsertJackpots([]);
  storage.upsertRewardClaims([]);
  storage.upsertProtocolFeeFlushes([]);
  storage.upsertEpochMap({
    "0": {
      winningTile: 1,
      totalPool: "1",
      rewardPool: "1",
      isDailyJackpot: false,
      isWeeklyJackpot: false,
    },
  });
  storage.upsertBets([{
    epoch: "0",
    user,
    tileIds: [1],
    totalAmount: "1",
    totalAmountNum: 1,
    txHash: HASH_A,
    blockNumber: "100",
  }]);
  assertRevision(storage, revision, "empty and rejected writes must not advance the revision");

  storage.upsertEpochMap({
    "101": {
      winningTile: 9,
      totalPool: "2000",
      rewardPool: "1800",
      isDailyJackpot: false,
      isWeeklyJackpot: false,
      resolvedBlock: "99",
    },
  });
  storage.upsertBets([{
    epoch: "101",
    user,
    tileIds: [9],
    totalAmount: "20",
    totalAmountNum: 20,
    txHash: HASH_A,
    blockNumber: "99",
    logIndex: "0",
  }]);
  storage.upsertJackpots([{
    epoch: "101",
    kind: "daily",
    amount: "99",
    amountNum: 99,
    txHash: HASH_A,
    blockNumber: "99",
  }]);
  storage.upsertRewardClaims([{
    id: "claim-101",
    epoch: "101",
    user,
    reward: "999",
    rewardNum: 999,
    txHash: HASH_B,
    blockNumber: "99",
  }]);
  storage.upsertProtocolFeeFlushes([{
    id: "fee-101",
    ownerAmount: "999",
    burnAmount: "999",
    txHash: HASH_B,
    blockNumber: "99",
  }]);
  assertRevision(storage, revision, "stale upserts rejected by storage must not advance the revision");
  assert.equal(storage.getEpochMap()["101"]?.winningTile, 7);
  assert.equal(storage.getAllBetRows()[0]?.totalAmount, "10");
  assert.equal(storage.getRecentJackpots(1)[0]?.amount, "25");
  assert.equal(storage.getAllRewardClaims()[0]?.reward, "900");
  assert.equal(storage.getGlobalStatsAggregate().totalBurnWei, "25000000000000000000");

  assert.equal(storage.acquireIndexerLease(leaseOwnerToken, 60_000), true);
  revision = assertRevisionAdvance(
    storage,
    revision,
    () => storage.rollbackIndexerToBlock(0n, null, leaseOwnerToken),
    "indexer rollback cursor commit must advance the revision exactly once",
  );

  const beforeFailedChunkRevision = revision;
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    assert.throws(
      () => storage.commitIndexerChunk({
        leaseOwnerToken,
        expectedPreviousBlock: 0n,
        expectedPreviousBlockHash: null,
        blockNumber: 1n,
        blockHash: HASH_A,
      }, () => {
        storage.upsertEpochMap({
          "999": {
            winningTile: 1,
            totalPool: "1",
            rewardPool: "1",
            isDailyJackpot: false,
            isWeeklyJackpot: false,
            resolvedBlock: "1",
          },
        });
        throw new Error("intentional public read-model transaction rollback");
      }),
      /intentional public read-model transaction rollback/,
    );
  } finally {
    console.error = originalConsoleError;
  }
  assertRevision(
    storage,
    beforeFailedChunkRevision,
    "revision increments inside a failed indexer chunk must roll back atomically",
  );
  assert.equal(storage.getEpochMap()["999"], undefined);
  assert.deepEqual(storage.getIndexerBlockCheckpoints(), []);

  revision = assertRevisionAdvance(storage, revision, () => storage.commitIndexerChunk({
    leaseOwnerToken,
    expectedPreviousBlock: 0n,
    expectedPreviousBlockHash: null,
    blockNumber: 1n,
    blockHash: HASH_A,
  }, () => {}), "successful indexer chunk cursor commit must advance the revision exactly once");
  assert.deepEqual(storage.getIndexerBlockCheckpoints(), [{ blockNumber: "1", blockHash: HASH_A }]);

  revision = assertRevisionAdvance(
    storage,
    revision,
    () => storage.rollbackIndexerToBlock(0n, null, leaseOwnerToken),
    "subsequent indexer rollback must advance the revision exactly once",
  );
  assert.deepEqual(storage.getIndexerBlockCheckpoints(), []);
  assert.equal(storage.releaseIndexerLease(leaseOwnerToken), true);
  assertRevision(storage, revision, "lease housekeeping must not affect the public revision");
  assert.equal(
    storage.getMetaBigInt("publicReadModelRevision"),
    revision,
    "public read-model revision must persist under the contract-scoped meta key",
  );
  assert.equal(
    storage.getPublicReadModelRevision(),
    revision.toString(),
    "the exported public revision getter must expose the persisted revision",
  );
  assert.equal(
    revision,
    9n,
    "accepted public mutations must each advance the revision exactly once",
  );
}

function assertPublicReadModelRevisionStorageBehavior() {
  const result = runIsolatedBusinessLogicChild({
    args: [
      resolve("node_modules/tsx/dist/cli.mjs"),
      resolve("scripts/test-business-public-api-read-models.mjs"),
      STORAGE_BEHAVIOR_CHILD_ARG,
    ],
    env: buildStorageBehaviorChildEnvironment(),
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
  });
  const output = `${String(result.stdout ?? "")}\n${String(result.stderr ?? "")}`.trim();
  assert.equal(
    result.status,
    0,
    `isolated public read-model storage behavior child failed${output ? `:\n${output.slice(-4_000)}` : ""}`,
  );
  assert.match(String(result.stdout ?? ""), /Public read-model storage revision behavior passed\./);
}

function buildRouteBehaviorChildEnvironment() {
  const childEnv = {
    FORCE_COLOR: "0",
    LORE_PREMAINNET_RUNTIME_STRICT: "0",
    NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
    NODE_ENV: "test",
    NO_COLOR: "1",
  };
  for (const name of ["SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR"]) {
    const value = process.env[name];
    if (typeof value === "string") childEnv[name] = value;
  }
  return childEnv;
}

async function runPublicReadModelRouteBehaviorChild() {
  const { mock } = await import("node:test");
  const forbiddenDbParent = join(
    tmpdir(),
    `lore-public-read-model-route-no-db-${process.pid}-${Date.now()}`,
  );
  if (existsSync(forbiddenDbParent)) {
    throw new Error("public read-model route probe DB poison path already exists");
  }
  process.env.LORE_DB_PATH = join(forbiddenDbParent, "lore.sqlite");
  const state = {
    revision: "100",
    revisionReads: [],
    queuedRevisionReads: [],
    cacheKeyInputs: [],
    globalBuilds: 0,
    globalNextRevision: null,
    leaderboardBuilds: 0,
    snapshot: null,
    snapshotWrites: [],
    networkCalls: 0,
  };
  const readRevision = () => {
    const queued = state.queuedRevisionReads.shift();
    const value = queued?.value ?? state.revision;
    if (queued?.commit) state.revision = value;
    state.revisionReads.push(value);
    return value;
  };
  const leaderboardValue = (payload) => payload?.biggestSingleWin?.[0]?.value ?? null;
  const requestJson = async (route, url) => {
    const response = await route.GET(new Request(url));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store, no-cache, must-revalidate");
    return response.json();
  };

  globalThis.fetch = async () => {
    state.networkCalls += 1;
    throw new Error("public read-model route behavior child forbids network access");
  };
  mock.module(new URL("../server/storage.ts", import.meta.url).href, {
    namedExports: {
      getChatProfiles: () => ({}),
      getGlobalStatsAggregate: () => {
        state.globalBuilds += 1;
        const payloadRevision = state.revision;
        if (state.globalNextRevision !== null) {
          state.revision = state.globalNextRevision;
          state.globalNextRevision = null;
        }
        return { revision: payloadRevision, build: state.globalBuilds };
      },
      getLeaderboardReadModel: () => {
        state.leaderboardBuilds += 1;
        const row = {
          address: NORMALIZED_ADDRESS,
          value: `leaderboard-${state.revision}`,
          valueNum: state.leaderboardBuilds,
        };
        return {
          biggestSingleWin: [row],
          luckiest: [],
          oneTileWonder: [],
          mostWins: [],
          whales: [],
          underdog: [],
          luckyTile: [],
        };
      },
      getMetaJson: () => state.snapshot,
      getPublicReadModelRevision: readRevision,
      setMetaJson: (_key, value) => {
        state.snapshot = value;
        state.snapshotWrites.push(value);
      },
    },
  });
  mock.module(new URL("../app/api/_lib/sharedRateLimit.ts", import.meta.url).href, {
    namedExports: {
      enforceSharedRateLimit: async () => null,
    },
  });
  mock.module(new URL("../app/api/_lib/publicReadModelPolicy.ts", import.meta.url).href, {
    namedExports: {
      buildPublicReadModelFailure,
      createPublicReadModelCacheKey: (namespace, revision) => {
        state.cacheKeyInputs.push({ namespace, revision });
        return createPublicReadModelCacheKey(namespace, revision);
      },
      createPublicReadModelJsonResponse,
      isFreshPublicReadModelSnapshot,
      sanitizePublicLeaderboardName,
    },
  });

  const [leaderboardsRouteModule, globalStatsRouteModule] = await Promise.all([
    import("../app/api/leaderboards/route.ts"),
    import("../app/api/global-stats/route.ts"),
  ]);
  const leaderboardsRoute = leaderboardsRouteModule.default ?? leaderboardsRouteModule;
  const globalStatsRoute = globalStatsRouteModule.default ?? globalStatsRouteModule;

  const globalUrl = "https://read-model.invalid/api/global-stats";
  const globalBaseline = await requestJson(globalStatsRoute, globalUrl);
  assert.deepEqual(globalBaseline, { revision: "100", build: 1 });
  await requestJson(globalStatsRoute, globalUrl);
  assert.equal(state.globalBuilds, 1, "a stable revision must reuse its cached aggregate");

  state.queuedRevisionReads = [
    { value: "100", commit: false },
    { value: "101", commit: true },
  ];
  const globalAfterCachedRevisionChange = await requestJson(globalStatsRoute, globalUrl);
  assert.equal(globalAfterCachedRevisionChange.revision, "101");
  assert.equal(state.globalBuilds, 2, "a cached payload must be rechecked against the current revision");
  await requestJson(globalStatsRoute, globalUrl);
  assert.equal(state.globalBuilds, 2, "the second stability attempt must cache the current revision");

  state.revision = "200";
  state.globalNextRevision = "201";
  const buildsBeforeGlobalChurn = state.globalBuilds;
  const globalAfterBuildRevisionChange = await requestJson(globalStatsRoute, globalUrl);
  assert.equal(globalAfterBuildRevisionChange.revision, "201");
  assert.equal(
    state.globalBuilds,
    buildsBeforeGlobalChurn + 2,
    "an aggregate built across a revision change must be retried instead of cached",
  );
  await requestJson(globalStatsRoute, globalUrl);
  assert.equal(
    state.globalBuilds,
    buildsBeforeGlobalChurn + 2,
    "only the stable retry may populate the revision cache",
  );

  const leaderboardsUrl = "https://read-model.invalid/api/leaderboards";
  state.revisionReads = [];
  state.cacheKeyInputs = [];
  state.revision = "300";
  state.snapshot = null;
  state.snapshotWrites = [];
  const leaderboardBaseline = await requestJson(leaderboardsRoute, leaderboardsUrl);
  assert.equal(leaderboardValue(leaderboardBaseline), "leaderboard-300");
  await requestJson(leaderboardsRoute, leaderboardsUrl);
  assert.equal(state.leaderboardBuilds, 1, "a stable leaderboard revision must reuse its cache");

  state.revision = "400";
  state.queuedRevisionReads = [
    { value: "400", commit: false },
    { value: "400", commit: false },
    { value: "401", commit: true },
  ];
  const leaderboardBuildsBeforeCommitChurn = state.leaderboardBuilds;
  const snapshotWritesBeforeCommitChurn = state.snapshotWrites.length;
  const leaderboardAfterCommitRevisionChange = await requestJson(leaderboardsRoute, leaderboardsUrl);
  assert.equal(leaderboardValue(leaderboardAfterCommitRevisionChange), "leaderboard-401");
  assert.equal(
    state.leaderboardBuilds,
    leaderboardBuildsBeforeCommitChurn + 2,
    "a leaderboard build must retry when its revision changes during cache commit",
  );
  assert.deepEqual(
    state.snapshotWrites.slice(snapshotWritesBeforeCommitChurn).map((entry) => entry.watermark),
    ["401"],
    "a cache-set revision change must prevent the stale snapshot write",
  );
  await requestJson(leaderboardsRoute, leaderboardsUrl);
  assert.equal(
    state.leaderboardBuilds,
    leaderboardBuildsBeforeCommitChurn + 2,
    "the stable second attempt must populate the leaderboard cache",
  );

  state.queuedRevisionReads = [
    { value: "401", commit: false },
    { value: "402", commit: true },
  ];
  const leaderboardAfterCachedRevisionChange = await requestJson(leaderboardsRoute, leaderboardsUrl);
  assert.equal(leaderboardValue(leaderboardAfterCachedRevisionChange), "leaderboard-402");
  assert.equal(
    state.leaderboardBuilds,
    leaderboardBuildsBeforeCommitChurn + 3,
    "a cached leaderboard payload must be discarded when its revision changes before return",
  );
  await requestJson(leaderboardsRoute, leaderboardsUrl);
  assert.equal(
    state.leaderboardBuilds,
    leaderboardBuildsBeforeCommitChurn + 3,
    "the revision-specific leaderboard cache key must reuse only the current payload",
  );
  assert.deepEqual(
    [...new Set(state.revisionReads)],
    ["300", "400", "401", "402"],
    "leaderboards must consult the public read-model revision across every cache generation",
  );
  assert.deepEqual(
    [...new Set(state.cacheKeyInputs.map(({ namespace, revision }) => `${namespace}:${revision}`))],
    ["leaderboards:300", "leaderboards:400", "leaderboards:401", "leaderboards:402"],
    "leaderboards must derive each cache key from the current public read-model revision",
  );
  assert.equal(state.networkCalls, 0, "the hermetic route harness must not use the network");
  if (existsSync(forbiddenDbParent)) {
    throw new Error("public read-model route probe opened its fail-closed DB path");
  }
}

function assertPublicReadModelRevisionRouteBehavior() {
  const result = runIsolatedBusinessLogicChild({
    args: [
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      fileURLToPath(import.meta.url),
      ROUTE_BEHAVIOR_CHILD_ARG,
    ],
    env: buildRouteBehaviorChildEnvironment(),
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
  });
  const output = `${String(result.stdout ?? "")}\n${String(result.stderr ?? "")}`.trim();
  assert.equal(
    result.status,
    0,
    `isolated public read-model route behavior child failed${output ? `:\n${output.slice(-4_000)}` : ""}`,
  );
  assert.match(String(result.stdout ?? ""), /Public read-model revision route behavior passed\./);
}

function assertEpochPolicy(candidate) {
  assert.deepEqual(candidate(undefined), { ok: true, epochs: [] });
  assert.deepEqual(candidate([3, "2", 3, 1]), { ok: true, epochs: [3, 2, 1] });
  assert.deepEqual(candidate(Array.from({ length: 400 }, (_, index) => index + 1)), {
    ok: true,
    epochs: Array.from({ length: 400 }, (_, index) => index + 1),
  });
  assert.deepEqual(candidate(Array.from({ length: 401 }, (_, index) => index + 1)), {
    ok: false,
    error: "Too many epochs",
  });
  for (const value of [0, -1, 1.5, "01", "1e3", "1000001", Number.MAX_SAFE_INTEGER]) {
    assert.deepEqual(candidate([value]), { ok: false, error: "Invalid epochs" });
  }
}

function assertSnapshotFreshnessPolicy(candidate) {
  assert.equal(candidate(1_000, 100, 1_100), true);
  assert.equal(candidate(1_000, 100, 1_101), false);
  assert.equal(candidate(1_101, 100, 1_100), false);
  for (const [savedAt, maxAgeMs, now] of [
    [-1, 100, 1_100],
    [1_000.5, 100, 1_100],
    [1_000, 0, 1_100],
    [1_000, Number.NaN, 1_100],
    [1_000, 100, Number.NaN],
  ]) {
    assert.equal(candidate(savedAt, maxAgeMs, now), false);
  }
}

function assertPublicReadModelRevisionCacheKeyPolicy(candidate) {
  assert.equal(candidate("leaderboards", "0"), "leaderboards:revision:0");
  assert.equal(candidate("global-stats", "42"), "global-stats:revision:42");
  for (const value of ["", "01", "-1", "1.5", "1e3", 1, null]) {
    assert.equal(candidate("leaderboards", value), "leaderboards:revision:0");
  }
}

function assertAddressPolicy(candidate) {
  assert.equal(candidate(CHECKSUM_ADDRESS), NORMALIZED_ADDRESS);
  assert.equal(candidate(` ${CHECKSUM_ADDRESS} `), null);
  for (const value of ["", "0x1234", `${CHECKSUM_ADDRESS}00`, "secret@example.com"]) {
    assert.equal(candidate(value), null);
  }
}

function assertHashPolicy(candidate) {
  assert.equal(candidate(` ${HASH_A.toUpperCase().replace("0X", "0x")} `), HASH_A);
  for (const value of [null, undefined, "", "0x1234", `0x${"g".repeat(64)}`, `${HASH_A}00`]) {
    assert.equal(candidate(value), null);
  }
}

function assertTilePolicy(candidate) {
  for (const value of [1, 25, 1n, 25n]) assert.equal(candidate(value), Number(value));
  for (const value of [null, undefined, 0, 26, 1.5, Number.NaN, 0n, 26n]) {
    assert.equal(candidate(value), null);
  }
}

function assertLeaderboardTileBinding(selectTile, collectTiles) {
  const epochs = [
    { winningTile: 1 },
    { winningTile: 25 },
    { winningTile: 25 },
    { winningTile: 0 },
    { winningTile: 26 },
    { winningTile: 1.5 },
    { winningTile: "2" },
    {},
  ];
  assert.equal(selectTile({ winningTile: 1 }), 1);
  assert.equal(selectTile({ winningTile: 25 }), 25);
  assert.equal(selectTile({ winningTile: 26 }), null);
  assert.equal(selectTile({ winningTile: "2" }), null);
  const result = collectTiles(epochs);
  assert.equal(result.resolvedCount, 3);
  assert.deepEqual([...result.counts.entries()], [[1, 1], [25, 2]]);
  for (const row of epochs) {
    const selected = selectTile(row);
    if (selected !== null) assert.ok(result.counts.has(selected));
  }
}

function assertRoiPolicy(compute, format, toValueNum) {
  assert.equal(compute(5n, 2n), 25_000n);
  assert.equal(compute(0n, 2n), 0n);
  assert.equal(compute(1n, 0n), 0n);
  assert.equal(format(25_000n), "250.0%");
  assert.equal(format(10_005n), "100.1%");
  assert.equal(format(-1n), "0.0%");
  assert.equal(toValueNum(25_000n), 250);
  assert.equal(toValueNum(-1n), 0);
  assert.equal(
    toValueNum(BigInt(Number.MAX_SAFE_INTEGER) + 1n),
    Number.MAX_SAFE_INTEGER / 100,
  );
}

function assertClaimPolicy({ identity, sort, merge }) {
  const existing = [
    { blockNumber: "9", epoch: "2", txHash: HASH_A, user: NORMALIZED_ADDRESS, reward: "1" },
    { blockNumber: "10", epoch: "1", txHash: null, user: NORMALIZED_ADDRESS, reward: "2" },
  ];
  const replacement = { ...existing[0], reward: "3" };
  const incoming = [replacement, {
    blockNumber: "10",
    epoch: "2",
    txHash: HASH_B,
    user: NORMALIZED_ADDRESS,
    reward: "4",
  }];
  assert.equal(identity(existing[0]), `${HASH_A}_${NORMALIZED_ADDRESS}_2`);
  assert.equal(identity(existing[1]), `nohash_10_${NORMALIZED_ADDRESS}_1`);
  assert.equal(
    identity({ ...existing[1], blockNumber: "not-a-block" }),
    `nohash_0_${NORMALIZED_ADDRESS}_1`,
  );
  assert.deepEqual(sort([...existing, incoming[1]]).map((row) => row.reward), ["4", "2", "1"]);
  assert.deepEqual(merge(existing, incoming, 2).map((row) => row.reward), ["4", "2"]);
  assert.deepEqual(merge(existing, incoming, 0), []);
}

function assertResponsePolicy(createResponse, buildFailure, sanitizeName) {
  const response = createResponse({ wins: [] }, 503);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store, no-cache, must-revalidate");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("expires"), "0");
  assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
  assert.deepEqual(buildFailure({ wins: [] }, new Error("rpc key=https://secret.invalid")), {
    wins: [],
    error: "fetch failed",
  });
  assert.equal(sanitizeName("  Alice\r\nBob  "), "Alice Bob");
  assert.equal(sanitizeName("x".repeat(30)), "x".repeat(20));
  assert.equal(sanitizeName("\u0000\r\n\t"), null);
  assert.equal(sanitizeName({ toString: () => "raw secret" }), null);
}

export function runPublicApiReadModelTests() {
  assert.deepEqual(RECENT_WINS_RECOVERY_POLICY, {
    logScanChunk: 10_000n,
    logScanMinChunk: 2_000n,
    maxBlocks: 100_000n,
    maxRpcCalls: 12,
    maxLogs: 250,
    maxTimeMs: 5_000,
  });
  assert.equal(Object.isFrozen(RECENT_WINS_RECOVERY_POLICY), true);

  assertEpochPolicy(parsePublicRewardsEpochs);
  assertSnapshotFreshnessPolicy(isFreshPublicReadModelSnapshot);
  assertPublicReadModelRevisionCacheKeyPolicy(createPublicReadModelCacheKey);
  assertPublicReadModelRevisionRouteBehavior();
  assertPublicReadModelRevisionStorageBehavior();
  assertAddressPolicy(normalizePublicReadModelAddress);
  assertHashPolicy(normalizePublicTransactionHash);
  assertTilePolicy(parsePublicReadModelTileId);
  assertLeaderboardTileBinding(
    selectPublicLeaderboardWinningTile,
    collectPublicLeaderboardWinningTiles,
  );
  assert.equal(comparePublicBigIntDesc(2n, 1n), -1);
  assert.equal(comparePublicBigIntDesc(1n, 2n), 1);
  assert.equal(comparePublicBigIntDesc(2n, 2n), 0);
  assert.equal(toPublicWeiDisplayNumber(1_234_567_890_123_456_789n), 1.234568);
  assert.equal(toPublicWeiDisplayNumber(10n ** 40n), Number.MAX_SAFE_INTEGER);
  assert.equal(formatPublicRecentClaimAmount("1.235"), "1.24");
  assert.equal(formatPublicRecentClaimAmount("not-an-amount"), "0.00");
  assertRoiPolicy(
    computePublicLeaderboardRoiBasisPoints,
    formatPublicLeaderboardRoiPercent,
    toPublicLeaderboardRoiValueNum,
  );
  assertClaimPolicy({
    identity: buildPublicRewardClaimStorageIdentity,
    sort: sortPublicRewardClaimsDesc,
    merge: mergePublicRewardClaims,
  });
  assertResponsePolicy(
    createPublicReadModelJsonResponse,
    buildPublicReadModelFailure,
    sanitizePublicLeaderboardName,
  );

  assert.throws(
    () => assertEpochPolicy((raw) => {
      const values = Array.isArray(raw) ? raw.slice(0, 400) : [];
      return { ok: true, epochs: values.map(Number) };
    }),
    /Too many epochs|Invalid epochs|Expected values to be strictly deep-equal/,
    "silent truncation and broad Number coercion epoch mutants must be killed",
  );
  assert.throws(
    () => assertSnapshotFreshnessPolicy((savedAt, maxAgeMs, now) => now - savedAt <= maxAgeMs),
    /false/,
    "future and malformed snapshot timestamp mutant must be killed",
  );
  assert.throws(
    () => assertPublicReadModelRevisionCacheKeyPolicy((namespace) => `${namespace}:revision:0`),
    /Expected values to be strictly equal/,
    "public cache keys must change with each valid revision",
  );
  assert.throws(
    () => assertAddressPolicy((value) => value.toLowerCase()),
    /Expected values to be strictly equal/,
    "unchecked public address mutant must be killed",
  );
  assert.throws(
    () => assertHashPolicy((value) => typeof value === "string" ? value.trim().toLowerCase() : null),
    /Expected values to be strictly equal/,
    "unchecked transaction hash mutant must be killed",
  );
  assert.throws(
    () => assertTilePolicy((value) => {
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
    }),
    /Expected values to be strictly equal/,
    "missing tile upper-bound mutant must be killed",
  );
  assert.throws(
    () => assertLeaderboardTileBinding(
      (row) => typeof row?.winningTile === "number" && row.winningTile > 0
        ? row.winningTile
        : null,
      (rows) => {
        const counts = new Map();
        let resolvedCount = 0;
        for (const row of rows) {
          const tile = typeof row?.winningTile === "number" && row.winningTile > 0
            ? row.winningTile
            : null;
          if (tile === null) continue;
          counts.set(tile, (counts.get(tile) ?? 0) + 1);
          resolvedCount += 1;
        }
        return { counts, resolvedCount };
      },
    ),
    /Expected values to be strictly equal|Expected values to be strictly deep-equal/,
    "leaderboard route binding mutant without the canonical tile selector must be killed",
  );
  assert.throws(
    () => assertRoiPolicy(
      (won, wagered) => BigInt(Math.round((Number(won) / Number(wagered)) * 10_000)),
      formatPublicLeaderboardRoiPercent,
      toPublicLeaderboardRoiValueNum,
    ),
    /Expected values to be strictly equal|cannot be converted to a BigInt/,
    "floating-point ROI mutant must be killed",
  );
  assert.throws(
    () => assertClaimPolicy({
      identity: (row) => `${row.txHash ?? "nohash"}_${row.user}_${row.epoch}`,
      sort: sortPublicRewardClaimsDesc,
      merge: (existing, incoming, limit) => [...existing, ...incoming].slice(0, limit),
    }),
    /Expected values to be strictly equal/,
    "raw-hash and non-deduplicating claim merge mutants must be killed",
  );
  assert.throws(
    () => assertResponsePolicy(
      (payload, status) => new Response(JSON.stringify(payload), { status }),
      (emptyPayload, error) => ({ ...emptyPayload, error: String(error) }),
      (value) => typeof value === "string" ? value.trim() : null,
    ),
    /cache-control|Expected values to be strictly equal|Expected values to be strictly deep-equal/,
    "cacheable, raw-error, and unsanitized-name response mutant must be killed",
  );
}

if (process.argv[1]?.endsWith("test-business-public-api-read-models.mjs")) {
  if (process.argv.includes(STORAGE_BEHAVIOR_CHILD_ARG)) {
    await runPublicReadModelStorageBehaviorChild();
    console.log("Public read-model storage revision behavior passed.");
  } else if (process.argv.includes(ROUTE_BEHAVIOR_CHILD_ARG)) {
    await runPublicReadModelRouteBehaviorChild();
    console.log("Public read-model revision route behavior passed.");
  } else {
    runPublicApiReadModelTests();
    console.log("Public API read-model behavior tests passed.");
  }
}
