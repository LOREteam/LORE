import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as liveStateRuntimePolicyModule from "../app/api/live-state/runtimePolicy.ts";

const liveStateRuntimePolicy = liveStateRuntimePolicyModule.default ?? liveStateRuntimePolicyModule;
const {
  LIVE_STATE_LOG_SCAN_CHUNK,
  LIVE_STATE_MAX_TIMER_DELAY_MS,
  LIVE_STATE_SNAPSHOT_CACHE_MS,
  LIVE_STATE_STALE_FAST_PATH_MS,
  buildLiveStateWithSnapshotFallback,
  isFreshLiveStatePayloadFetchedAt,
  isFreshLiveStateSnapshotMemoryEntry,
  isFreshLiveStateSnapshotSavedAt,
  normalizeLiveStateSnapshotMaxAge,
  parseLiveStateChainEpoch,
  parseLiveStateChainTileId,
  parseLiveStateStoredBlock,
  parseRequestedEpochsParam,
  planLiveStateLogScanWindow,
  resolveLiveStateAdmission,
  withLiveStateTimeout,
} = liveStateRuntimePolicy;

function parsePositiveInteger(value) {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function assertFetchedAtPolicy(candidate) {
  const now = 1_000_000;
  assert.equal(candidate(now, now), true, "the current timestamp must be fresh");
  assert.equal(candidate(now - LIVE_STATE_STALE_FAST_PATH_MS, now), true, "the exact stale boundary must remain usable");
  assert.equal(candidate(now - LIVE_STATE_STALE_FAST_PATH_MS - 1, now), false, "older data must be stale");
  assert.equal(candidate(now + 1, now), false, "future data must fail closed");
  for (const value of [Number.NaN, 1.5, -1, Number.MAX_SAFE_INTEGER + 1, "1000", null]) {
    assert.equal(candidate(value, now), false, "malformed fetchedAt evidence must fail closed");
  }
  assert.equal(candidate(now, Number.NaN), false, "an invalid clock must fail closed");
}

function assertSnapshotMaxAgePolicy(candidate) {
  assert.equal(candidate(Number.POSITIVE_INFINITY), null, "only explicit positive infinity may request unbounded fallback");
  for (const value of [Number.NaN, Number.NEGATIVE_INFINITY, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(candidate(value), 0, "malformed max age must fail closed");
  }
  assert.equal(candidate(0), 0);
  assert.equal(candidate(60_000), 60_000);
}

function assertSavedAtPolicy(candidate) {
  assert.equal(candidate(900, 100, 1_000), true);
  assert.equal(candidate(900, 99, 1_000), false, "savedAt age must enforce the exact max-age boundary");
  assert.equal(candidate(0, null, 1_000), true, "explicit unbounded fallback may serve canonical old evidence");
  assert.equal(candidate(1_001, null, 1_000), false, "unbounded fallback must still reject future evidence");
  for (const value of [Number.NaN, 1.5, -1, "900", null]) {
    assert.equal(candidate(value, null, 1_000), false, "malformed savedAt evidence must fail closed");
  }
  assert.equal(candidate(900, 100, Number.NaN), false, "an invalid clock must fail closed");
}

function assertMemoryPolicy(candidate) {
  const now = 10_000;
  const entry = { payload: { currentEpoch: "7" }, savedAt: 9_900, loadedAt: now - LIVE_STATE_SNAPSHOT_CACHE_MS };
  assert.equal(candidate(entry, 200, now), true, "the exact in-memory TTL boundary must remain usable");
  assert.equal(candidate({ ...entry, loadedAt: entry.loadedAt - 1 }, 200, now), false, "expired memory data must be rejected");
  assert.equal(candidate({ ...entry, loadedAt: now + 1 }, 200, now), false, "future cache load evidence must be rejected");
  assert.equal(candidate({ ...entry, loadedAt: 1.5 }, 200, now), false, "fractional cache timestamps must be rejected");
  assert.equal(candidate({ ...entry, savedAt: now + 1 }, 200, now), false, "future persisted evidence must taint memory cache");
  assert.equal(candidate(null, 200, now), false);
}

function assertEpochParserPolicy(candidate) {
  assert.equal(candidate(1n), 1);
  assert.equal(candidate(BigInt(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  assert.equal(candidate(0n), null);
  assert.equal(candidate(-1n), null);
  assert.equal(candidate(BigInt(Number.MAX_SAFE_INTEGER) + 1n), null, "unsafe chain epochs must not narrow through Number");
}

function assertTileParserPolicy(candidate) {
  assert.equal(candidate(1n, 25), 1);
  assert.equal(candidate(25n, 25), 25);
  assert.equal(candidate(0n, 25), null);
  assert.equal(candidate(26n, 25), null);
  assert.equal(candidate(1n, 0), null);
  assert.equal(candidate(1n, 1.5), null);
}

function assertScanWindowPolicy(candidate) {
  assert.deepEqual(
    candidate({ cursor: 1n, toBlock: 50_000n, chunkSize: 40_000n, remainingBlockBudget: 80_000n }),
    { requestedBlocks: LIVE_STATE_LOG_SCAN_CHUNK, chunkTo: 10_000n },
    "every RPC window must stay under the provider's 10k-block cap",
  );
  assert.deepEqual(
    candidate({ cursor: 90n, toBlock: 100n, chunkSize: 10_000n, remainingBlockBudget: 5n }),
    { requestedBlocks: 5n, chunkTo: 94n },
    "the remaining recovery budget must cap the window",
  );
  assert.equal(candidate({ cursor: 5n, toBlock: 4n, chunkSize: 1n, remainingBlockBudget: 1n }), null);
  assert.equal(candidate({ cursor: 0n, toBlock: 4n, chunkSize: 0n, remainingBlockBudget: 1n }), null);
}

function assertRequestedEpochsPolicy(candidate) {
  assert.deepEqual(candidate(null, parsePositiveInteger, 100), { ok: true, epochs: [] });
  assert.deepEqual(candidate("3,1,3,2", parsePositiveInteger, 100), { ok: true, epochs: [3, 1, 2] });
  assert.deepEqual(candidate("1,1000000", parsePositiveInteger, 100), { ok: true, epochs: [1, 1_000_000] });
  assert.deepEqual(candidate("1000001", parsePositiveInteger, 100), { ok: false, error: "Invalid epochs" });
  assert.deepEqual(candidate("1,,2", parsePositiveInteger, 100), { ok: false, error: "Invalid epochs" });
  assert.deepEqual(candidate("1e2", parsePositiveInteger, 100), { ok: false, error: "Invalid epochs" });
  assert.deepEqual(
    candidate(Array.from({ length: 101 }, (_, index) => String(index + 1)).join(","), parsePositiveInteger, 100),
    { ok: false, error: "Too many epochs" },
    "over-limit input must be rejected instead of truncated",
  );
  assert.deepEqual(candidate("1", parsePositiveInteger, 0), { ok: false, error: "Invalid epochs" });
}

function testPureRuntimePolicies() {
  assertFetchedAtPolicy(isFreshLiveStatePayloadFetchedAt);
  assertSnapshotMaxAgePolicy(normalizeLiveStateSnapshotMaxAge);
  assertSavedAtPolicy(isFreshLiveStateSnapshotSavedAt);
  assertMemoryPolicy(isFreshLiveStateSnapshotMemoryEntry);
  assertEpochParserPolicy(parseLiveStateChainEpoch);
  assertTileParserPolicy(parseLiveStateChainTileId);
  assertScanWindowPolicy(planLiveStateLogScanWindow);
  assertRequestedEpochsPolicy(parseRequestedEpochsParam);

  assert.equal(parseLiveStateStoredBlock("0"), 0n);
  assert.equal(parseLiveStateStoredBlock("900719925474099312345"), 900719925474099312345n);
  for (const value of [null, undefined, "", "-1", "1e3", " 1", "1 ", "0x10"]) {
    assert.equal(parseLiveStateStoredBlock(value), 0n, "stored blocks must be digit-only before BigInt parsing");
  }
}

function testPureMutantsAreKilled() {
  assert.throws(
    () => assertFetchedAtPolicy((fetchedAt, now) => typeof fetchedAt === "number" && now - fetchedAt <= LIVE_STATE_STALE_FAST_PATH_MS),
    /future data must fail closed/,
  );
  assert.throws(
    () => assertSnapshotMaxAgePolicy((value) => Number.isFinite(value) ? value : null),
    /malformed max age must fail closed/,
  );
  assert.throws(
    () => assertSavedAtPolicy((savedAt, maxAgeMs, now) => typeof savedAt === "number" && (maxAgeMs === null || now - savedAt <= maxAgeMs)),
    /future evidence/,
  );
  assert.throws(
    () => assertMemoryPolicy((entry, _maxAgeMs, now) => Boolean(entry && now - entry.loadedAt <= LIVE_STATE_SNAPSHOT_CACHE_MS)),
    /future cache load evidence/,
  );
  assert.throws(() => assertEpochParserPolicy((value) => Number(value)), /Expected values|unsafe chain epochs/);
  assert.throws(() => assertTileParserPolicy((value) => Number(value)), /Expected values to be strictly equal/);
  assert.throws(
    () => assertScanWindowPolicy(({ cursor, toBlock, chunkSize, remainingBlockBudget }) => {
      const requestedBlocks = [chunkSize, toBlock - cursor + 1n, remainingBlockBudget]
        .reduce((smallest, value) => value < smallest ? value : smallest);
      return { requestedBlocks, chunkTo: cursor + requestedBlocks - 1n };
    }),
    /10k-block cap/,
  );
  assert.throws(
    () => assertRequestedEpochsPolicy((search, parser, max) => {
      if (!search) return { ok: true, epochs: [] };
      const epochs = search.split(",").slice(0, max).map(parser).filter((value) => value !== null);
      return { ok: true, epochs };
    }),
    /over-limit input must be rejected|Expected values/,
  );
}

async function assertAdmissionPolicy(candidate) {
  const rejectedTrace = [];
  const rateLimitedResponse = new Response("slow down", { status: 429 });
  const rejected = await candidate({
    enforceRateLimit: async () => {
      rejectedTrace.push("rate-limit");
      return rateLimitedResponse;
    },
    readFreshCache: () => {
      rejectedTrace.push("cache");
      return { currentEpoch: "1" };
    },
    now: () => 10,
  });
  assert.equal(rejected.kind, "rate-limited");
  assert.equal(rejected.response, rateLimitedResponse);
  assert.deepEqual(rejectedTrace, ["rate-limit"], "rate limiting must precede every cache read");

  const allowedTrace = [];
  const allowed = await candidate({
    enforceRateLimit: async () => {
      allowedTrace.push("rate-limit");
      return null;
    },
    readFreshCache: (now) => {
      allowedTrace.push(`cache:${now}`);
      return { currentEpoch: "7", fetchedAt: now };
    },
    now: () => 77,
  });
  assert.deepEqual(allowedTrace, ["rate-limit", "cache:77"]);
  assert.deepEqual(allowed, { kind: "allowed", now: 77, cached: { currentEpoch: "7", fetchedAt: 77 } });
}

async function assertTimeoutPolicy(candidate) {
  assert.equal(await candidate(Promise.resolve("ok"), 10, "probe"), "ok");
  for (const timeoutMs of [0, -1, 1.5, Number.NaN, LIVE_STATE_MAX_TIMER_DELAY_MS + 1]) {
    await assert.rejects(candidate(Promise.resolve("late"), timeoutMs, "probe"), RangeError);
  }
  await assert.rejects(candidate(new Promise(() => {}), 5, "probe"), /probe timed out after 5ms/);
}

async function assertFallbackPolicy(candidate) {
  const fresh = { currentEpoch: "8", fetchedAt: 800 };
  let snapshotReads = 0;
  assert.equal(await candidate({
    build: async () => fresh,
    loadSnapshot: () => {
      snapshotReads += 1;
      return { currentEpoch: "old", fetchedAt: 1 };
    },
    buildStoredBootstrap: () => null,
  }), fresh);
  assert.equal(snapshotReads, 0, "successful RPC data must not read fallback state");

  const stale = { currentEpoch: "7", fetchedAt: 123 };
  assert.equal((await candidate({
    build: async () => { throw new Error("rpc unavailable"); },
    loadSnapshot: () => stale,
    buildStoredBootstrap: () => ({ currentEpoch: "6", fetchedAt: 1 }),
  })).fetchedAt, 123, "RPC fallback must preserve the snapshot timestamp");
  assert.deepEqual(await candidate({
    build: async () => { throw new Error("rpc unavailable"); },
    loadSnapshot: () => null,
    buildStoredBootstrap: () => ({ currentEpoch: "6", fetchedAt: 45 }),
  }), { currentEpoch: "6", fetchedAt: 45 });
  const cause = new Error("rpc unavailable");
  await assert.rejects(candidate({
    build: async () => { throw cause; },
    loadSnapshot: () => null,
    buildStoredBootstrap: () => null,
  }), (error) => error === cause);
}

async function runAsyncRuntimeTests() {
  await assertAdmissionPolicy(resolveLiveStateAdmission);
  await assertTimeoutPolicy(withLiveStateTimeout);
  await assertFallbackPolicy(buildLiveStateWithSnapshotFallback);

  await assert.rejects(
    assertAdmissionPolicy(async (input) => {
      const now = input.now();
      const cached = input.readFreshCache(now);
      const response = await input.enforceRateLimit();
      return response === null ? { kind: "allowed", now, cached } : { kind: "rate-limited", response };
    }),
    /rate limiting must precede every cache read/,
  );
  await assert.rejects(
    assertTimeoutPolicy(async (promise, timeoutMs) => {
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError("invalid");
      return promise;
    }),
    /Missing expected rejection|RangeError/,
  );
  await assert.rejects(
    assertFallbackPolicy(async (input) => {
      try {
        return await input.build();
      } catch (error) {
        const snapshot = input.loadSnapshot() ?? input.buildStoredBootstrap();
        if (snapshot) return { ...snapshot, fetchedAt: Date.now() };
        throw error;
      }
    }),
    /preserve the snapshot timestamp/,
  );
}

export function runLiveStateApiTests() {
  testPureRuntimePolicies();
  testPureMutantsAreKilled();
  const runtimeProbe = spawnSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/test-business-live-state-api.mjs", "--runtime-probe"],
    { cwd: process.cwd(), encoding: "utf8", timeout: 15_000 },
  );
  assert.equal(runtimeProbe.status, 0, runtimeProbe.stderr || runtimeProbe.stdout || runtimeProbe.error?.message);
  assert.match(
    runtimeProbe.stdout,
    /^live-state API runtime behavior tests passed \(11 groups, 11 mutants killed\)\s*$/,
  );
}

if (process.argv.includes("--runtime-probe")) {
  runAsyncRuntimeTests()
    .then(() => console.log("live-state API runtime behavior tests passed (11 groups, 11 mutants killed)"))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

if (process.argv.includes("--focused")) {
  runLiveStateApiTests();
  console.log("live-state API focused behavior tests passed");
}
