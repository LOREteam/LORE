import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as routeCacheModule from "../app/api/_lib/routeCache.ts";
import * as versionedRouteCacheModule from "../app/api/_lib/versionedRouteCache.ts";
import * as autoMineLoopModelModule from "../app/lib/mining/autoMineLoopModel.ts";
import * as autoMineLoopPreludePlannerModule from "../app/lib/mining/autoMineLoopPreludePlanner.ts";
import * as autoMineLoopRoundOutcomeModule from "../app/lib/mining/autoMineLoopRoundOutcome.ts";
import * as autoMineLoopRetryPlannerModule from "../app/lib/mining/autoMineLoopRetryPlanner.ts";
import * as autoMineLoopTransitionPlannerModule from "../app/lib/mining/autoMineLoopTransitionPlanner.ts";

export async function runCacheAndPlannerTests() {
  const routeCache = routeCacheModule.default ?? routeCacheModule;
  const versionedRouteCache = versionedRouteCacheModule.default ?? versionedRouteCacheModule;
  const autoMineLoopModel = autoMineLoopModelModule.default ?? autoMineLoopModelModule;
  const autoMineLoopPreludePlanner = autoMineLoopPreludePlannerModule.default ?? autoMineLoopPreludePlannerModule;
  const autoMineLoopRoundOutcome = autoMineLoopRoundOutcomeModule.default ?? autoMineLoopRoundOutcomeModule;
  const autoMineLoopRetryPlanner = autoMineLoopRetryPlannerModule.default ?? autoMineLoopRetryPlannerModule;
  const autoMineLoopTransitionPlanner = autoMineLoopTransitionPlannerModule.default ?? autoMineLoopTransitionPlannerModule;
  const cache = routeCache.createRouteCache(2);
  const cacheKey = "messages";
  const inflightVersion = cache.beginWrite(cacheKey);
  cache.invalidate(cacheKey);
  cache.setIfLatest(cacheKey, { stale: true }, 1000, inflightVersion);
  assert.equal(cache.getStale(cacheKey), null);

  const freshVersion = cache.beginWrite(cacheKey);
  cache.setIfLatest(cacheKey, { fresh: true }, 1000, freshVersion);
  assert.deepEqual(cache.getStale(cacheKey), { fresh: true });

  const boundedCache = routeCache.createRouteCache(1);
  const evictedVersion = boundedCache.beginWrite("evicted");
  boundedCache.setIfLatest("evicted", { value: 1 }, 1000, evictedVersion);
  boundedCache.set("retained", { value: 2 }, 1000);
  assert.equal(boundedCache.beginWrite("evicted"), 1, "LRU eviction must prune orphaned write metadata");

  const emptyKeyCache = routeCache.createRouteCache(1);
  emptyKeyCache.set("", { empty: true }, 1000);
  emptyKeyCache.set("retained", { retained: true }, 1000);
  assert.equal(emptyKeyCache.getStale(""), null, "LRU eviction must delete an empty string cache key");
  assert.deepEqual(emptyKeyCache.getStale("retained"), { retained: true });

  const oversizeKeyCache = routeCache.createRouteCache(2);
  const oversizeCacheKey = "k".repeat(4097);
  const oversizePayload = { value: "oversize" };
  assert.deepEqual(oversizeKeyCache.set(oversizeCacheKey, oversizePayload, 1000), oversizePayload);
  assert.equal(oversizeKeyCache.getFresh(oversizeCacheKey), null, "oversized route cache keys must not be fresh");
  assert.equal(oversizeKeyCache.getStale(oversizeCacheKey), null, "oversized route cache keys must not be retained");
  assert.equal(oversizeKeyCache.size(), 0, "oversized route cache keys must not occupy cache capacity");
  const oversizeVersion = oversizeKeyCache.beginWrite(oversizeCacheKey);
  assert.equal(Number.isNaN(oversizeVersion), true, "oversized route cache writes must use an invalid version");
  assert.equal(oversizeKeyCache.getWriteVersion(oversizeCacheKey), 0, "oversized route cache writes must not keep metadata");
  const oversizeInflight = Promise.resolve(oversizePayload);
  assert.equal(oversizeKeyCache.setInflight(oversizeCacheKey, oversizeInflight), oversizeInflight);
  assert.equal(oversizeKeyCache.getInflight(oversizeCacheKey), null, "oversized inflight cache keys must not be retained");
  const oversizeRefresh = Promise.resolve();
  assert.equal(oversizeKeyCache.setRefresh(oversizeCacheKey, oversizeRefresh), oversizeRefresh);
  assert.equal(oversizeKeyCache.getRefresh(oversizeCacheKey), null, "oversized refresh cache keys must not be retained");
  assert.deepEqual(
    oversizeKeyCache.setIfLatest(oversizeCacheKey, oversizePayload, 1000, 1),
    oversizePayload,
    "oversized latest cache writes must return payload without caching",
  );
  assert.equal(oversizeKeyCache.size(), 0, "oversized latest cache writes must not occupy cache capacity");

  const controlKeyCache = routeCache.createRouteCache(2);
  const controlCacheKey = "bad\nkey";
  const controlPayload = { value: "control" };
  assert.deepEqual(controlKeyCache.set(controlCacheKey, controlPayload, 1000), controlPayload);
  assert.equal(controlKeyCache.getFresh(controlCacheKey), null, "control-character route cache keys must not be fresh");
  assert.equal(controlKeyCache.getStale(controlCacheKey), null, "control-character route cache keys must not be retained");
  assert.equal(controlKeyCache.size(), 0, "control-character route cache keys must not occupy cache capacity");
  const controlVersion = controlKeyCache.beginWrite(controlCacheKey);
  assert.equal(Number.isNaN(controlVersion), true, "control-character route cache writes must use an invalid version");
  assert.equal(controlKeyCache.getWriteVersion(controlCacheKey), 0, "control-character route cache writes must not keep metadata");
  const controlInflight = Promise.resolve(controlPayload);
  assert.equal(controlKeyCache.setInflight(controlCacheKey, controlInflight), controlInflight);
  assert.equal(controlKeyCache.getInflight(controlCacheKey), null, "control-character inflight cache keys must not be retained");
  const controlRefresh = Promise.resolve();
  assert.equal(controlKeyCache.setRefresh(controlCacheKey, controlRefresh), controlRefresh);
  assert.equal(controlKeyCache.getRefresh(controlCacheKey), null, "control-character refresh cache keys must not be retained");
  assert.deepEqual(
    controlKeyCache.setIfLatest(controlCacheKey, controlPayload, 1000, 1),
    controlPayload,
    "control-character latest cache writes must return payload without caching",
  );
  assert.equal(controlKeyCache.size(), 0, "control-character latest cache writes must not occupy cache capacity");

  for (const maxEntries of [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY]) {
    const invalidCapacityCache = routeCache.createRouteCache(maxEntries);
    invalidCapacityCache.set("entry", { value: String(maxEntries) }, 1000);
    assert.equal(
      invalidCapacityCache.size(),
      0,
      `invalid route cache capacity ${String(maxEntries)} must not keep entries`,
    );
    assert.equal(
      invalidCapacityCache.getStale("entry"),
      null,
      `invalid route cache capacity ${String(maxEntries)} must fail closed`,
    );
  }

  const pendingCache = routeCache.createRouteCache(1);
  const pendingVersion = pendingCache.beginWrite("pending");
  pendingCache.setInflight("pending", Promise.resolve({ value: 1 }));
  pendingCache.setIfLatest("pending", { value: 1 }, 1000, pendingVersion);
  pendingCache.set("other", { value: 2 }, 1000);
  assert.equal(pendingCache.getWriteVersion("pending"), pendingVersion, "active writes must retain their version after eviction");
  pendingCache.clearInflight("pending");
  assert.equal(pendingCache.getWriteVersion("pending"), 0, "completed evicted writes must release version metadata");

  const invalidatedCache = routeCache.createRouteCache(1);
  const staleVersion = invalidatedCache.beginWrite("invalidated");
  invalidatedCache.setInflight("invalidated", Promise.resolve({ stale: true }));
  invalidatedCache.invalidate("invalidated");
  invalidatedCache.setIfLatest("invalidated", { stale: true }, 1000, staleVersion);
  invalidatedCache.clearInflight("invalidated");
  assert.equal(invalidatedCache.getStale("invalidated"), null, "invalidated async writes must not repopulate cache");
  assert.equal(invalidatedCache.getWriteVersion("invalidated"), 0, "settled invalidation tombstones must be pruned");

  const directWriteCache = routeCache.createRouteCache(2);
  const supersededVersion = directWriteCache.beginWrite("shared");
  directWriteCache.set("shared", { fresh: true }, 1000);
  directWriteCache.setIfLatest("shared", { stale: true }, 1000, supersededVersion);
  assert.deepEqual(
    directWriteCache.getStale("shared"),
    { fresh: true },
    "direct writes must supersede older async builds",
  );

  const invalidTtlCache = routeCache.createRouteCache(8);
  for (const ttlMs of [Number.NaN, -1, 0, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER]) {
    const key = `ttl:${String(ttlMs)}`;
    const payload = { ttl: String(ttlMs) };
    invalidTtlCache.set(key, payload, ttlMs);
    assert.equal(
      invalidTtlCache.getFresh(key),
      null,
      `invalid route cache ttl ${String(ttlMs)} must not remain fresh`,
    );
    assert.deepEqual(
      invalidTtlCache.getStale(key),
      payload,
      `invalid route cache ttl ${String(ttlMs)} may only be available as stale fallback`,
    );
  }

  const invalidLatestTtlCache = routeCache.createRouteCache(1);
  const invalidLatestVersion = invalidLatestTtlCache.beginWrite("latest");
  invalidLatestTtlCache.setIfLatest("latest", { value: "latest" }, Number.NaN, invalidLatestVersion);
  assert.equal(
    invalidLatestTtlCache.getFresh("latest"),
    null,
    "setIfLatest must not keep invalid route cache ttl fresh",
  );
  assert.deepEqual(invalidLatestTtlCache.getStale("latest"), { value: "latest" });

  const invalidNowCache = routeCache.createRouteCache(1);
  invalidNowCache.set("clock", { value: "clock" }, 1000);
  assert.deepEqual(invalidNowCache.getFresh("clock", Date.now()), { value: "clock" });
  for (const now of [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY]) {
    assert.equal(
      invalidNowCache.getFresh("clock", now),
      null,
      `invalid route cache now ${String(now)} must not read fresh entries`,
    );
    assert.deepEqual(
      invalidNowCache.getStale("clock"),
      { value: "clock" },
      `invalid route cache now ${String(now)} must leave stale fallback available`,
    );
  }

  const routeCacheTtlSource = readFileSync("app/api/_lib/routeCache.ts", "utf8");
  assert.match(
    routeCacheTtlSource,
    /function computeExpiresAt[\s\S]*Number\.isSafeInteger\(ttlMs\)[\s\S]*Number\.MAX_SAFE_INTEGER - now[\s\S]*expiresAt: computeExpiresAt\(ttlMs\)/,
    "route cache writes must compute TTL expiry through the fail-closed helper",
  );
  assert.match(
    routeCacheTtlSource,
    /function isFreshEntry[\s\S]*Number\.isSafeInteger\(now\)[\s\S]*entry\.expiresAt > now[\s\S]*!isFreshEntry\(entry, now\)/,
    "route cache fresh reads must reject malformed caller-supplied times",
  );
  assert.match(
    routeCacheTtlSource,
    /function normalizeMaxEntries[\s\S]*Number\.isSafeInteger\(maxEntries\)[\s\S]*const capacity = normalizeMaxEntries\(maxEntries\)[\s\S]*pruneOldest\(cache, capacity\)/,
    "route cache capacity must be normalized before pruning",
  );
  assert.match(
    routeCacheTtlSource,
    /MAX_ROUTE_CACHE_KEY_LENGTH[\s\S]*ROUTE_CACHE_KEY_CONTROL_RE[\s\S]*function isUsableCacheKey[\s\S]*key\.length <= MAX_ROUTE_CACHE_KEY_LENGTH && !ROUTE_CACHE_KEY_CONTROL_RE\.test\(key\)[\s\S]*!isUsableCacheKey\(key\)/,
    "route cache operations must fail closed for oversized or control-character keys before map access",
  );
  assert.match(
    routeCacheTtlSource,
    /const oldestKey = cache\.keys\(\)\.next\(\);[\s\S]*if \(oldestKey\.done\) break;[\s\S]*const key = oldestKey\.value/,
    "route cache LRU pruning must not treat an empty string key as missing",
  );
  assert.doesNotMatch(
    routeCacheTtlSource,
    /expiresAt:\s*Date\.now\(\)\s*\+\s*ttlMs/,
    "route cache writes must not use broad Date.now() + ttlMs expiry",
  );
  const versionedRouteCacheSource = readFileSync("app/api/_lib/versionedRouteCache.ts", "utf8");
  assert.match(
    versionedRouteCacheSource,
    /function isUsableWriteVersion\(value: number\)[\s\S]*Number\.isSafeInteger\(value\) && value > 0[\s\S]*const writeVersion = cache\.beginWrite\(cacheKey\)[\s\S]*if \(!isUsableWriteVersion\(writeVersion\)\) return;[\s\S]*markRouteBackgroundRefresh\(routeMetricKey\)/,
    "background route refreshes must reject invalid cache write versions before metric and build work",
  );
  assert.match(
    versionedRouteCacheSource,
    /const writeVersion = cache\.beginWrite\(cacheKey\)[\s\S]*const buildPromise = build\(\);[\s\S]*if \(!isUsableWriteVersion\(writeVersion\)\) \{[\s\S]*requestPromise: buildPromise\.then\(\(result\) => toPayload\(result\)\)/,
    "foreground route builds with invalid cache keys must bypass cache metadata while still returning a payload",
  );

  const invalidBackgroundCache = routeCache.createRouteCache(2);
  let invalidBackgroundBuildCount = 0;
  let invalidBackgroundErrorCount = 0;
  let invalidBackgroundCommitCount = 0;
  versionedRouteCache.startVersionedBackgroundRefresh({
    cache: invalidBackgroundCache,
    cacheKey: "bad\nkey",
    ttlMs: 1000,
    routeMetricKey: "invalid-background",
    build: async () => {
      invalidBackgroundBuildCount += 1;
      return { invalid: true };
    },
    toPayload: (payload) => payload,
    onError: () => { invalidBackgroundErrorCount += 1; },
    onCommit: () => { invalidBackgroundCommitCount += 1; },
  });
  assert.equal(invalidBackgroundBuildCount, 0, "invalid cache-key background refresh must not run build work");
  assert.equal(invalidBackgroundErrorCount, 0, "invalid cache-key background refresh must not report skipped work as an error");
  assert.equal(invalidBackgroundCommitCount, 0, "invalid cache-key background refresh must not commit payloads");
  assert.equal(invalidBackgroundCache.getRefresh("bad\nkey"), null, "invalid cache-key background refresh must not retain refresh metadata");

  const invalidInflightCache = routeCache.createRouteCache(2);
  let invalidInflightCommitCount = 0;
  const invalidInflight = versionedRouteCache.startVersionedInflightBuild({
    cache: invalidInflightCache,
    cacheKey: "bad\nkey",
    ttlMs: 1000,
    build: async () => ({ raw: true }),
    toPayload: (payload) => ({ payload }),
    onCommit: () => { invalidInflightCommitCount += 1; },
  });
  assert.deepEqual(await invalidInflight.requestPromise, { payload: { raw: true } });
  assert.equal(invalidInflightCommitCount, 0, "invalid cache-key foreground builds must not run cache commit hooks");
  assert.equal(invalidInflightCache.getInflight("bad\nkey"), null, "invalid cache-key foreground builds must not retain inflight metadata");
  assert.equal(invalidInflightCache.size(), 0, "invalid cache-key foreground builds must not occupy cache capacity");

  const helperCache = routeCache.createRouteCache(2);
  let resolveStaleBuild;
  let staleCommitCount = 0;
  const { requestPromise: staleRequest } = versionedRouteCache.startVersionedInflightBuild({
    cache: helperCache,
    cacheKey: "shared",
    ttlMs: 1000,
    build: () => new Promise((resolve) => { resolveStaleBuild = resolve; }),
    toPayload: (payload) => payload,
    onCommit: () => { staleCommitCount += 1; },
  });
  helperCache.set("shared", { fresh: true }, 1000);
  resolveStaleBuild({ stale: true });
  assert.deepEqual(await staleRequest, { fresh: true });
  assert.equal(staleCommitCount, 0, "superseded async builds must not commit stale metadata");

  const inflightRaceCache = routeCache.createRouteCache(2);
  let resolveOldInflight;
  let resolveNewInflight;
  const { requestPromise: oldInflight } = versionedRouteCache.startVersionedInflightBuild({
    cache: inflightRaceCache,
    cacheKey: "race",
    ttlMs: 1000,
    build: () => new Promise((resolve) => { resolveOldInflight = resolve; }),
    toPayload: (payload) => payload,
  });
  inflightRaceCache.invalidate("race");
  const { requestPromise: newInflight } = versionedRouteCache.startVersionedInflightBuild({
    cache: inflightRaceCache,
    cacheKey: "race",
    ttlMs: 1000,
    build: () => new Promise((resolve) => { resolveNewInflight = resolve; }),
    toPayload: (payload) => payload,
  });
  resolveOldInflight({ stale: true });
  await oldInflight;
  assert.equal(
    inflightRaceCache.getInflight("race"),
    newInflight,
    "an invalidated stale build must not clear the replacement inflight owner",
  );
  resolveNewInflight({ fresh: true });
  await newInflight;

  const refreshRaceCache = routeCache.createRouteCache(2);
  let resolveOldRefresh;
  let resolveNewRefresh;
  versionedRouteCache.startVersionedBackgroundRefresh({
    cache: refreshRaceCache,
    cacheKey: "race",
    ttlMs: 1000,
    routeMetricKey: "test-refresh-race",
    build: () => new Promise((resolve) => { resolveOldRefresh = resolve; }),
    toPayload: (payload) => payload,
    onError: (error) => { throw error; },
  });
  const oldRefresh = refreshRaceCache.getRefresh("race");
  refreshRaceCache.invalidate("race");
  versionedRouteCache.startVersionedBackgroundRefresh({
    cache: refreshRaceCache,
    cacheKey: "race",
    ttlMs: 1000,
    routeMetricKey: "test-refresh-race",
    build: () => new Promise((resolve) => { resolveNewRefresh = resolve; }),
    toPayload: (payload) => payload,
    onError: (error) => { throw error; },
  });
  const newRefresh = refreshRaceCache.getRefresh("race");
  resolveOldRefresh({ stale: true });
  await oldRefresh;
  assert.equal(
    refreshRaceCache.getRefresh("race"),
    newRefresh,
    "an invalidated stale refresh must not clear the replacement refresh owner",
  );
  resolveNewRefresh({ fresh: true });
  await newRefresh;

  const backgroundCache = routeCache.createRouteCache(2);
  let resolveBackgroundBuild;
  let backgroundCommitCount = 0;
  versionedRouteCache.startVersionedBackgroundRefresh({
    cache: backgroundCache,
    cacheKey: "background",
    ttlMs: 1000,
    routeMetricKey: "test-background-cache",
    build: () => new Promise((resolve) => { resolveBackgroundBuild = resolve; }),
    toPayload: (payload) => payload,
    onCommit: () => { backgroundCommitCount += 1; },
    onError: (error) => { throw error; },
  });
  const backgroundRefresh = backgroundCache.getRefresh("background");
  backgroundCache.set("background", { fresh: true }, 1000);
  resolveBackgroundBuild({ stale: true });
  await backgroundRefresh;
  assert.deepEqual(backgroundCache.getStale("background"), { fresh: true });
  assert.equal(backgroundCommitCount, 0, "superseded background refreshes must not commit stale metadata");

  let loopState = autoMineLoopModel.createAutoMineLoopState({
    rounds: 3,
    startRoundIndex: 0,
    restoredLastEpoch: null,
  });
  loopState = autoMineLoopModel.reduceAutoMineLoopEvent(loopState, {
    type: "round-betting-started",
    liveEpoch: 21n,
    tiles: [4, 8],
    selectionEpoch: "21",
  });
  assert.deepEqual(loopState.selection, { tiles: [4, 8], epoch: "21" });
  assert.equal(loopState.progressMessage, "1 / 3 - epoch #21: placing bet (2 tiles)...");
  assert.deepEqual(loopState.sessionCheckpoint, {
    nextRoundIndex: 0,
    lastPlacedEpoch: "21",
  });

  loopState = autoMineLoopModel.reduceAutoMineLoopEvent(loopState, {
    type: "network-error",
    retryCount: 1,
    waitMs: 500,
  });
  assert.equal(loopState.roundIndex, 0);
  assert.equal(loopState.networkRetries, 1);
  assert.equal(loopState.progressMessage, "RPC offline - retry 1 in 1s...");
  assert.equal(loopState.sessionCheckpoint, null);

  loopState = autoMineLoopModel.reduceAutoMineLoopEvent(loopState, {
    type: "round-recovered-after-network-error",
    placedEpoch: 21n,
    tiles: [4, 8],
  });
  assert.equal(loopState.roundIndex, 1);
  assert.equal(loopState.networkRetries, 0);
  assert.equal(loopState.lastPlacedEpoch, 21n);
  assert.deepEqual(loopState.selection, { tiles: [4, 8], epoch: "21" });
  assert.equal(loopState.progressMessage, "1 / 3 - epoch #21 confirmed after RPC recovery; 2 cycles left");

  loopState = autoMineLoopModel.reduceAutoMineLoopEvent(loopState, {
    type: "round-epoch-ended",
    liveEpoch: 22n,
  });
  assert.equal(loopState.roundIndex, 2);
  assert.equal(loopState.progressMessage, "2 / 3 - epoch #22 skipped (ended); 1 cycle left");
  assert.equal(loopState.lastPlacedEpoch, 22n);
  assert.deepEqual(loopState.sessionCheckpoint, {
    nextRoundIndex: 2,
    lastPlacedEpoch: "22",
  });

  loopState = autoMineLoopModel.reduceAutoMineLoopEvent(loopState, {
    type: "round-confirmed",
    placedEpoch: 23n,
    tiles: [6],
  });
  assert.equal(loopState.roundIndex, 3);
  assert.equal(loopState.lastPlacedEpoch, 23n);
  assert.equal(loopState.progressMessage, "3 / 3 - epoch #23 confirmed; 0 cycles left");
  assert.deepEqual(loopState.selection, { tiles: [6], epoch: "23" });
  assert.equal(loopState.sessionCheckpoint, null);

  loopState = autoMineLoopModel.createAutoMineLoopState({
    rounds: 3,
    startRoundIndex: 2,
    restoredLastEpoch: 22n,
  });
  loopState = autoMineLoopModel.reduceAutoMineLoopEvent(loopState, {
    type: "round-detected-on-chain",
    placedEpoch: 23n,
    tiles: [6],
  });
  assert.equal(loopState.roundIndex, 3);
  assert.equal(loopState.lastPlacedEpoch, 23n);
  assert.equal(loopState.progressMessage, "3 / 3 - epoch #23 confirmed on-chain; 0 cycles left");
  assert.deepEqual(loopState.selection, { tiles: [6], epoch: "23" });
  assert.equal(loopState.sessionCheckpoint, null);

  loopState = autoMineLoopModel.reduceAutoMineLoopEvent(loopState, { type: "loop-completed" });
  assert.equal(loopState.stopReason, "completed");
  assert.equal(loopState.progressMessage, "Completed 3/3 rounds");

  assert.deepEqual(
    autoMineLoopPreludePlanner.planAutoMineLoopPrelude({
      hasRefreshSession: false,
      lastPlacedEpoch: null,
      lastSessionRefresh: 1_000,
      now: 2_000,
      sessionRefreshIntervalMs: 5_000,
    }),
    {
      operations: [],
    },
  );
  assert.deepEqual(
    autoMineLoopPreludePlanner.planAutoMineLoopPrelude({
      hasRefreshSession: true,
      lastPlacedEpoch: 42n,
      lastSessionRefresh: 1_000,
      now: 7_001,
      sessionRefreshIntervalMs: 5_000,
    }),
    {
      operations: ["refresh-session", "await-epoch-ready"],
    },
  );
  assert.deepEqual(
    autoMineLoopRoundOutcome.toAutoMineLoopConfirmedEvent({
      outcome: {
        kind: "confirmed",
        source: "recovered-after-network-error",
        placedEpoch: 42n,
      },
      tiles: [3, 7],
    }),
    {
      type: "round-recovered-after-network-error",
      placedEpoch: 42n,
      tiles: [3, 7],
    },
  );
  assert.deepEqual(
    autoMineLoopTransitionPlanner.planAutoMinePreparedRoundTransition({
      kind: "skip-existing",
      liveEpoch: 77n,
      alreadyBetTiles: [1, 2],
      effectiveBlocks: 2,
    }),
    {
      kind: "continue",
      action: {
        event: { type: "round-skipped-existing", liveEpoch: 77n },
        syncEffects: { session: true, selection: true, progress: false },
      },
    },
  );
  assert.deepEqual(
    autoMineLoopTransitionPlanner.planAutoMineAttemptTransition({
      epochNeedsResolve: true,
      outcome: { kind: "submitted" },
      roundIndex: 1,
      rounds: 3,
    }),
    {
      kind: "finalize",
      commandsBefore: [
        { type: "clear-pending-bet" },
        {
          type: "confirmation-start",
          clearSelection: true,
          progressMessage: "2 / 3 - confirmed",
          refetchEpoch: true,
        },
      ],
    },
  );
  assert.deepEqual(
    autoMineLoopTransitionPlanner.planAutoMineRecoveryTransition({
      kind: "confirmed",
      source: "recovered-after-network-error",
      placedEpoch: 88n,
    }),
    {
      kind: "confirmed",
      commandsBefore: [{ type: "clear-pending-bet" }],
      outcome: {
        kind: "confirmed",
        source: "recovered-after-network-error",
        placedEpoch: 88n,
      },
    },
  );
  assert.deepEqual(
    autoMineLoopTransitionPlanner.planAutoMineNetworkErrorTransition({
      retryCount: 2,
      waitMs: 1200,
    }),
    {
      kind: "continue",
      action: {
        commandsAfter: [{ type: "sleep", ms: 1200 }],
        event: { type: "network-error", retryCount: 2, waitMs: 1200 },
        syncEffects: { progress: true, selection: false, session: false },
      },
    },
  );
  assert.deepEqual(
    autoMineLoopTransitionPlanner.planAutoMineLoopCompletionTransition(),
    {
      action: {
        commandsAfter: [{ type: "sleep", ms: 1500 }],
        event: { type: "loop-completed" },
        syncEffects: { progress: true, selection: false, session: false },
      },
    },
  );

  assert.deepEqual(
    autoMineLoopRetryPlanner.planAutoMineLoopNetworkRetry({
      currentRetryCount: 0,
      initialMs: 500,
      maxMs: 10_000,
      retryMax: 4,
    }),
    {
      kind: "retry",
      retryCount: 1,
      waitMs: 500,
    },
  );
  assert.deepEqual(
    autoMineLoopRetryPlanner.planAutoMineLoopNetworkRetry({
      currentRetryCount: 3,
      initialMs: 500,
      maxExponent: 2,
      maxMs: 10_000,
      retryMax: 4,
    }),
    {
      kind: "retry",
      retryCount: 4,
      waitMs: 2_000,
    },
  );
  assert.deepEqual(
    autoMineLoopRetryPlanner.planAutoMineLoopNetworkRetry({
      currentRetryCount: 4,
      initialMs: 500,
      maxMs: 10_000,
      retryMax: 4,
    }),
    {
      kind: "give-up",
      retryCount: 5,
    },
  );
  for (const currentRetryCount of [Number.NaN, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(
      autoMineLoopRetryPlanner.planAutoMineLoopNetworkRetry({
        currentRetryCount,
        initialMs: 500,
        maxMs: 10_000,
        retryMax: 4,
      }),
      {
        kind: "give-up",
        retryCount: 0,
      },
      `invalid Auto-Miner retry count ${String(currentRetryCount)} must fail closed`,
    );
  }
  for (const retryMax of [Number.NaN, -1, 4.5, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(
      autoMineLoopRetryPlanner.planAutoMineLoopNetworkRetry({
        currentRetryCount: 1,
        initialMs: 500,
        maxMs: 10_000,
        retryMax,
      }),
      {
        kind: "give-up",
        retryCount: 1,
      },
      `invalid Auto-Miner retry max ${String(retryMax)} must fail closed`,
    );
  }
  for (const timing of [
    { initialMs: Number.NaN, maxMs: 10_000, maxExponent: undefined },
    { initialMs: 0, maxMs: 10_000, maxExponent: undefined },
    { initialMs: 500.5, maxMs: 10_000, maxExponent: undefined },
    { initialMs: 500, maxMs: 400, maxExponent: undefined },
    { initialMs: 500, maxMs: Number.POSITIVE_INFINITY, maxExponent: undefined },
    { initialMs: 500, maxMs: 10_000, maxExponent: 1.5 },
  ]) {
    assert.deepEqual(
      autoMineLoopRetryPlanner.planAutoMineLoopNetworkRetry({
        currentRetryCount: 1,
        initialMs: timing.initialMs,
        maxExponent: timing.maxExponent,
        maxMs: timing.maxMs,
        retryMax: 4,
      }),
      {
        kind: "give-up",
        retryCount: 1,
      },
      `invalid Auto-Miner retry timing ${JSON.stringify(timing)} must fail closed`,
    );
  }
  const autoMineLoopRetryPlannerSource = readFileSync("app/lib/mining/autoMineLoopRetryPlanner.ts", "utf8");
  assert.match(
    autoMineLoopRetryPlannerSource,
    /function normalizeNonNegativeSafeInteger[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*function normalizePositiveSafeInteger[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*currentRetryCount === null[\s\S]*maxMs < initialMs[\s\S]*return \{[\s\S]*kind: "give-up"[\s\S]*getNetworkRetryDelayMs\(/,
    "Auto-Miner retry planner must validate retry counts and timing before scheduling retries",
  );
  assert.doesNotMatch(
    autoMineLoopRetryPlannerSource,
    /const nextRetryCount = params\.currentRetryCount \+ 1|nextRetryCount > params\.retryMax|getNetworkRetryDelayMs\([\s\S]*params\.initialMs[\s\S]*params\.maxMs/,
    "Auto-Miner retry planner must not use raw retry parameters after validation",
  );
}
