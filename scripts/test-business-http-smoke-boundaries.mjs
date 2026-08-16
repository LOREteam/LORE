import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  HTTP_SMOKE_CHECKS,
  assertNonNegativeSafeInteger,
  assertNonNegativeSafeIntegerOrNull,
  assertPositiveSafeInteger,
  assertTileId,
  createHttpSmokeRuntime,
  describeSmokeError,
  parseContentLengthHeader,
  parseOptionalPositiveIntegerText,
  readBoundedResponseText,
  runHttpSmokeCli,
  withResponseTimeout,
} from "./smoke-http.mjs";
import {
  LOAD_HTTP_ENDPOINTS,
  assertReachableLoadWarmup,
  describeLoadError,
  firstLoadThresholdFailure,
  formatLoadStatsLine,
  formatLoadStatuses,
  isNonLocalHttpsOrigin,
  listColdLoadFailures,
  resolveLoadHttpConfig,
  runLoadHttpCli,
} from "./load-http.mjs";
import {
  parseWarmupContentLengthHeader,
  readBoundedWarmupText,
  warmBaseUrl,
} from "./smoke-browser-lib/core.mjs";

const THIS_FILE = fileURLToPath(import.meta.url);
const SMOKE_HTTP_URL = new URL("./smoke-http.mjs", import.meta.url);
const LOAD_HTTP_URL = new URL("./load-http.mjs", import.meta.url);

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function findCheck(name, checks = HTTP_SMOKE_CHECKS) {
  const check = checks.find((candidate) => candidate.name === name);
  assert.ok(check, `missing HTTP smoke check: ${name}`);
  return check;
}

function createLogCapture() {
  const entries = { log: [], warn: [], error: [] };
  return {
    entries,
    logger: {
      log: (value) => entries.log.push(String(value)),
      warn: (value) => entries.warn.push(String(value)),
      error: (value) => entries.error.push(String(value)),
    },
  };
}

function assertStrictNonNegativeIntegerContract(assertion) {
  assertion(0, "value");
  assertion(Number.MAX_SAFE_INTEGER, "value");
  for (const invalid of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => assertion(invalid, "value"), /non-negative safe integer/);
  }
}

function assertStrictTileContract(assertion) {
  assertion(1, "tile");
  assertion(25, "tile");
  for (const invalid of [0, 26, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => assertion(invalid, "tile"), /between 1 and 25/);
  }
}

async function testImportSafety() {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("unexpected network access during module import");
  };
  try {
    await import(`${SMOKE_HTTP_URL.href}?import-safety=${Date.now()}`);
    await import(`${LOAD_HTTP_URL.href}?import-safety=${Date.now()}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchCalls, 0, "HTTP smoke/load modules must be import-safe");
}

function testNumericAndLengthBoundaries() {
  assert.deepEqual(parseOptionalPositiveIntegerText("CHAIN", "59144"), { value: 59144, issue: null });
  assert.deepEqual(parseOptionalPositiveIntegerText("CHAIN", ""), { value: null, issue: null });
  for (const invalid of ["0", "01", "-1", "1.5", "9007199254740992"]) {
    assert.equal(parseOptionalPositiveIntegerText("CHAIN", invalid).value, null);
    assert.match(parseOptionalPositiveIntegerText("CHAIN", invalid).issue, /positive decimal integer|safe positive integer/);
  }

  assertStrictNonNegativeIntegerContract(assertNonNegativeSafeInteger);
  assertNonNegativeSafeIntegerOrNull(null, "nullable");
  assertStrictNonNegativeIntegerContract(assertNonNegativeSafeIntegerOrNull);
  assertPositiveSafeInteger(1, "rank");
  for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => assertPositiveSafeInteger(invalid, "rank"), /positive safe integer/);
  }
  assertStrictTileContract(assertTileId);

  const unsafeIntegerMutant = (value, label) => {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`);
  };
  assert.throws(
    () => assertStrictNonNegativeIntegerContract(unsafeIntegerMutant),
    /Missing expected exception/,
    "unsafe Number.isInteger mutant must be killed",
  );
  const unboundedTileMutant = (value, label) => {
    if (!Number.isInteger(value)) throw new Error(`${label} must be between 1 and 25`);
  };
  assert.throws(
    () => assertStrictTileContract(unboundedTileMutant),
    /Missing expected exception/,
    "unbounded tile mutant must be killed",
  );

  assert.equal(parseContentLengthHeader(null), null);
  assert.equal(parseContentLengthHeader("0"), 0);
  assert.equal(parseContentLengthHeader("1048576"), 1_048_576);
  assert.equal(parseWarmupContentLengthHeader("42"), 42);
  for (const invalid of ["01", "-1", "+1", "1.0", "9007199254740992", "9999999999999999"]) {
    assert.throws(() => parseContentLengthHeader(invalid), /invalid response content-length/);
    assert.throws(() => parseWarmupContentLengthHeader(invalid), /invalid content-length/);
  }
  assert.equal(Number("01"), 1, "broad Number coercion mutant would incorrectly accept non-canonical length");
}

function loadStats({ count = 10, failed = 0, latencies = [10], statuses = [[200, 10]] } = {}) {
  return {
    count,
    ok: count - failed,
    failed,
    latencies,
    statuses: new Map(statuses),
    errors: new Map(),
  };
}

function testLoadHttpBehaviorPolicies() {
  assert.deepEqual(resolveLoadHttpConfig({}), {
    baseUrl: "http://localhost:3001",
    allowLocal: false,
    durationMs: 60_000,
    concurrency: 50,
    timeoutMs: 10_000,
    maxErrorRate: 0.01,
    maxP95Ms: 1_500,
    clientIps: 50,
  });
  assert.deepEqual(resolveLoadHttpConfig({
    LOAD_BASE_URL: "https://playlore.xyz",
    LOAD_ALLOW_LOCAL: "1",
    LOAD_DURATION_MS: "2000",
    LOAD_CONCURRENCY: "4",
    LOAD_TIMEOUT_MS: "300",
    LOAD_MAX_ERROR_RATE: "0.25",
    LOAD_MAX_P95_MS: "900",
    LOAD_CLIENT_IPS: "2",
  }), {
    baseUrl: "https://playlore.xyz",
    allowLocal: true,
    durationMs: 2_000,
    concurrency: 4,
    timeoutMs: 300,
    maxErrorRate: 0.25,
    maxP95Ms: 900,
    clientIps: 2,
  });
  assert.equal(resolveLoadHttpConfig({ LOAD_CONCURRENCY: "01" }).concurrency, 50);
  assert.equal(resolveLoadHttpConfig({ LOAD_DURATION_MS: "1e3" }).durationMs, 60_000);
  assert.equal(resolveLoadHttpConfig({ LOAD_TIMEOUT_MS: "1.5" }).timeoutMs, 10_000);
  assert.equal(resolveLoadHttpConfig({ LOAD_MAX_ERROR_RATE: "1.1" }).maxErrorRate, 1);
  assert.equal(resolveLoadHttpConfig({ LOAD_MAX_P95_MS: "9007199254740992" }).maxP95Ms, 1_500);
  assert.equal(resolveLoadHttpConfig({ LOAD_CLIENT_IPS: "51" }).clientIps, 50);

  assert.equal(isNonLocalHttpsOrigin("https://playlore.xyz"), true);
  assert.equal(isNonLocalHttpsOrigin("https://sub.playlore.xyz"), true);
  for (const value of [
    "http://playlore.xyz",
    "https://playlore",
    "https://playlore.xyz/path",
    "https://playlore.xyz/?query=1",
    "https://localhost",
    "https://service.local",
    "https://service.example",
    "https://10.0.0.1",
    "https://100.64.0.1",
    "https://169.254.1.1",
    "https://192.168.1.1",
    "https://198.51.100.1",
    "https://[2001:db8::1]",
    "not-a-url",
  ]) {
    assert.equal(isNonLocalHttpsOrigin(value), false, value);
  }

  assert.equal(LOAD_HTTP_ENDPOINTS.length, 11);
  assert.deepEqual(
    LOAD_HTTP_ENDPOINTS.find(({ name }) => name === "global-stats"),
    { name: "global-stats", path: "/api/global-stats", weight: 6 },
  );
  assert.equal(LOAD_HTTP_ENDPOINTS.reduce((total, endpoint) => total + endpoint.weight, 0), 106);

  assert.equal(
    formatLoadStatuses(new Map([["500", 1], ["200", 2], ["01", 3], [200, 4], ["9007199254740992", 5]])),
    "200:2 200:4 500:1 invalid-status:3 invalid-status:5",
  );
  assert.match(
    formatLoadStatsLine("COLD global-stats", loadStats({ latencies: [10, 20, 30] })),
    /^COLD global-stats[ ]+count=[ ]+10[\s\S]*p95=[ ]+30ms[\s\S]*statuses=\[200:10\]$/,
  );

  assert.doesNotThrow(() => assertReachableLoadWarmup(["one"], LOAD_HTTP_ENDPOINTS.length, "https://playlore.xyz"));
  assert.throws(
    () => assertReachableLoadWarmup(
      LOAD_HTTP_ENDPOINTS.map(({ name }) => name),
      LOAD_HTTP_ENDPOINTS.length,
      "https://playlore.xyz",
    ),
    /load warm-up could not reach https:\/\/playlore\.xyz; all endpoints failed/,
  );

  const coldStats = new Map(LOAD_HTTP_ENDPOINTS.map(({ name }) => [name, loadStats()]));
  coldStats.set("global-stats", loadStats({ failed: 1 }));
  assert.deepEqual(listColdLoadFailures(coldStats).map(({ name }) => name), ["global-stats"]);

  const healthyByEndpoint = new Map(LOAD_HTTP_ENDPOINTS.map(({ name }) => [name, loadStats()]));
  const thresholdInput = {
    globalStats: loadStats(),
    byEndpoint: healthyByEndpoint,
    maxErrorRate: 0.1,
    maxP95Ms: 100,
  };
  assert.equal(firstLoadThresholdFailure(thresholdInput), null);
  assert.match(
    firstLoadThresholdFailure({ ...thresholdInput, globalStats: loadStats({ failed: 2 }) }),
    /^load test failed: error rate 20\.00%/,
  );
  assert.match(
    firstLoadThresholdFailure({ ...thresholdInput, globalStats: loadStats({ latencies: [101] }) }),
    /^load test failed: p95 101ms/,
  );
  const endpointErrors = new Map(healthyByEndpoint);
  endpointErrors.set("global-stats", loadStats({ failed: 2 }));
  assert.match(
    firstLoadThresholdFailure({ ...thresholdInput, byEndpoint: endpointErrors }),
    /^global-stats load failed: error rate 20\.00%/,
  );
  const endpointLatency = new Map(healthyByEndpoint);
  endpointLatency.set("global-stats", loadStats({ latencies: [101] }));
  assert.match(
    firstLoadThresholdFailure({ ...thresholdInput, byEndpoint: endpointLatency }),
    /^global-stats load failed: p95 101ms/,
  );

  const broadOriginMutant = (value) => new URL(value).protocol === "https:";
  assert.equal(broadOriginMutant("https://10.0.0.1"), true);
  assert.equal(isNonLocalHttpsOrigin("https://10.0.0.1"), false);
  const aggregateOnlyMutant = ({ globalStats, maxErrorRate }) => (
    globalStats.failed / globalStats.count > maxErrorRate ? "failed" : null
  );
  assert.equal(aggregateOnlyMutant({ ...thresholdInput, byEndpoint: endpointErrors }), null);
  assert.match(firstLoadThresholdFailure({ ...thresholdInput, byEndpoint: endpointErrors }), /global-stats/);
}

async function testBoundedBodies() {
  assert.equal(await readBoundedResponseText(new Response("ok", { headers: { "content-length": "2" } })), "ok");
  await assert.rejects(
    readBoundedResponseText(new Response("", { headers: { "content-length": "1048577" } })),
    /response body too large/,
  );
  await assert.rejects(
    readBoundedResponseText(new Response(new Uint8Array([0xff]))),
    /encoded data was not valid|encoding/i,
  );
  const oversizedStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(1_048_577));
      controller.close();
    },
  });
  await assert.rejects(readBoundedResponseText(new Response(oversizedStream)), /response body too large/);
  await assert.rejects(
    readBoundedWarmupText(new Response("", { headers: { "content-length": "1048577" } })),
    /warmup response body too large/,
  );
}

async function testRequestMethodStatusCacheAndRetry() {
  const requestLog = [];
  const { entries, logger } = createLogCapture();
  const runtime = createHttpSmokeRuntime({
    baseUrl: "https://smoke.invalid",
    retryableAttempts: 2,
    retryDelayMs: 17,
    logger,
    now: (() => {
      let value = 100;
      return () => value += 5;
    })(),
    sleep: async (ms) => requestLog.push({ sleep: ms }),
    setTimeoutImpl: () => 91,
    clearTimeoutImpl: () => undefined,
    fetchImpl: async (url, options) => {
      requestLog.push({ url, options });
      return jsonResponse(
        { error: "Invalid auth payload" },
        400,
        { "cache-control": "private, no-store" },
      );
    },
  });
  const authCheck = findCheck("admin-auth-bad");
  assert.equal(await runtime.runCheck(authCheck), null);
  assert.equal(requestLog.length, 1);
  assert.equal(requestLog[0].url, "https://smoke.invalid/api/admin/auth");
  assert.equal(requestLog[0].options.method, "POST");
  assert.equal(requestLog[0].options.body, "{");
  assert.equal(requestLog[0].options.headers["content-type"], "application/json");
  assert.equal(requestLog[0].options.headers["cache-control"], "no-cache");
  assert.match(entries.log[0], /^PASS admin-auth-bad\s+400/);

  const wrongStatusRuntime = createHttpSmokeRuntime({
    baseUrl: "https://smoke.invalid",
    retryableAttempts: 3,
    logger: createLogCapture().logger,
    fetchImpl: async () => jsonResponse({ error: "Invalid auth payload" }, 200, { "cache-control": "no-store" }),
  });
  assert.match((await wrongStatusRuntime.runCheck(authCheck)).message, /status 200, expected 400 or 503/);

  const missingCacheRuntime = createHttpSmokeRuntime({
    baseUrl: "https://smoke.invalid",
    retryableAttempts: 1,
    logger: createLogCapture().logger,
    fetchImpl: async () => jsonResponse({ error: "Invalid auth payload" }, 400),
  });
  assert.match((await missingCacheRuntime.runCheck(authCheck)).message, /no-store/);

  const wrongBodyRuntime = createHttpSmokeRuntime({
    baseUrl: "https://smoke.invalid",
    retryableAttempts: 1,
    logger: createLogCapture().logger,
    fetchImpl: async () => jsonResponse({ error: "mutated" }, 400, { "cache-control": "no-store" }),
  });
  assert.match((await wrongBodyRuntime.runCheck(authCheck)).message, /reject invalid payload/);

  let attempts = 0;
  const retryCapture = createLogCapture();
  const retryDelays = [];
  const retryRuntime = createHttpSmokeRuntime({
    baseUrl: "https://smoke.invalid",
    retryableAttempts: 2,
    retryDelayMs: 23,
    logger: retryCapture.logger,
    sleep: async (ms) => retryDelays.push(ms),
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("fetch failed PRIVATE_KEY=do-not-print");
      return jsonResponse({ error: "Invalid auth payload" }, 400, { "cache-control": "no-store" });
    },
  });
  assert.equal(await retryRuntime.runCheck(authCheck), null);
  assert.equal(attempts, 2);
  assert.deepEqual(retryDelays, [23]);
  assert.match(retryCapture.entries.warn[0], /PRIVATE_KEY=<redacted>/);
  assert.doesNotMatch(retryCapture.entries.warn[0], /do-not-print/);
}

async function testTimeoutAndCliRedaction() {
  let timeoutDelay = null;
  let clearedTimer = null;
  let requestOptions = null;
  await assert.rejects(
    withResponseTimeout(
      "https://smoke.invalid/api/live-state",
      37,
      { headers: { accept: "application/json" } },
      async () => new Promise(() => undefined),
      {
        setTimeoutImpl(callback, ms) {
          timeoutDelay = ms;
          queueMicrotask(callback);
          return 44;
        },
        clearTimeoutImpl(timer) {
          clearedTimer = timer;
        },
        fetchImpl: async (_url, options) => {
          requestOptions = options;
          await new Promise((resolve, reject) => {
            options.signal.addEventListener("abort", () => reject(new Error("timeout aborted")), { once: true });
          });
        },
      },
    ),
    /request timeout after 37 ms/,
  );
  assert.equal(timeoutDelay, 37);
  assert.equal(clearedTimer, 44);
  assert.equal(requestOptions.headers["cache-control"], "no-cache");
  assert.equal(requestOptions.headers.accept, "application/json");

  let stalledBodyCancelled = false;
  const stalledStream = new ReadableStream({
    start() {},
    cancel() {
      stalledBodyCancelled = true;
    },
  });
  const stalledStartedAt = performance.now();
  await assert.rejects(
    withResponseTimeout(
      "https://smoke.invalid/api/stalled-body",
      5,
      {},
      async (response, signal) => readBoundedResponseText(response, { signal }),
      { fetchImpl: async () => new Response(stalledStream) },
    ),
    /request timeout after 5 ms/,
  );
  await Promise.resolve();
  assert.equal(stalledBodyCancelled, true, "stalled response body reader must be cancelled on timeout");
  assert.ok(performance.now() - stalledStartedAt < 500, "stalled response body must settle at the request deadline");

  const sensitive = `PRIVATE_KEY=do-not-print ${"0x"}${"a".repeat(64)} ${"x".repeat(600)}`;
  for (const described of [describeSmokeError(new Error(sensitive)), describeLoadError(new Error(sensitive))]) {
    assert.doesNotMatch(described, /do-not-print|0xaaaa/);
    assert.match(described, /<redacted>/);
    assert.match(described, /<truncated>$/);
    assert.ok(described.length <= 500);
  }

  const smokeCapture = createLogCapture();
  const smokeProcess = { exitCode: 0 };
  const smokeResult = await runHttpSmokeCli({
    runtime: { run: async () => { throw new Error("RPC_URL=https://rpc.example/?token=secret-value"); } },
    processLike: smokeProcess,
    logger: smokeCapture.logger,
  });
  assert.equal(smokeResult.ok, false);
  assert.equal(smokeProcess.exitCode, 1);
  assert.doesNotMatch(smokeCapture.entries.error[0], /secret-value/);

  const loadCapture = createLogCapture();
  const loadProcess = { exitCode: 0 };
  const loadResult = await runLoadHttpCli({
    mainFn: async () => { throw new Error("DATABASE_URL=postgres://alice:secret@db.example/prod"); },
    processLike: loadProcess,
    logger: loadCapture.logger,
  });
  assert.equal(loadResult.ok, false);
  assert.equal(loadProcess.exitCode, 1);
  assert.doesNotMatch(loadCapture.entries.error[0], /alice:secret/);
  assert.match(loadCapture.entries.error[0], /DATABASE_URL=<redacted>/);
}

async function testPageAndApiContracts() {
  const hardenedHtmlHeaders = {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "x-permitted-cross-domain-policies": "none",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=()",
  };
  const homeBody = `${"x".repeat(1_001)}<title>LORE - Linea Mining Game</title> LORE Hot Tiles Analytics FAQ Leaderboards`;
  await findCheck("home").assert(new Response(homeBody, { headers: hardenedHtmlHeaders }), homeBody);
  await assert.rejects(
    findCheck("home").assert(new Response(homeBody.replace("LORE - Linea Mining Game", "Wrong app"), { headers: hardenedHtmlHeaders }), homeBody.replace("LORE - Linea Mining Game", "Wrong app")),
    /missing title/,
  );

  const privacyBody = "Privacy Policy Wallet-first sign-in Third-party services";
  await findCheck("privacy-page").assert(new Response(privacyBody, { headers: { "content-type": "text/html" } }), privacyBody);
  await assert.rejects(
    findCheck("privacy-page").assert(new Response(`${privacyBody} We do not ask for your email`, { headers: { "content-type": "text/html" } }), `${privacyBody} We do not ask for your email`),
    /stale email-login disclosure/,
  );
  const robotsBody = "User-agent: *\nSitemap: https://lore.example/sitemap.xml";
  await findCheck("robots").assert(new Response(robotsBody, { headers: { "content-type": "text/plain" } }), robotsBody);
  const sitemapBody = "<urlset>/jackpot-win /privacy /terms</urlset>";
  await findCheck("sitemap").assert(new Response(sitemapBody, { headers: { "content-type": "application/xml" } }), sitemapBody);

  const syncPayload = {
    status: "ok",
    visibility: "public",
    redacted: true,
    contract: { currentEpoch: 10, headBlock: null, finalityTargetBlock: null },
    storage: {
      lastIndexedBlock: null,
      repairCursorBlock: null,
      latestStoredJackpotBlock: null,
      latestRewardClaimBlock: null,
      lagBlocks: 0,
      lagToFinalityTargetBlocks: null,
    },
    env: { indexerFinalityBlocks: "64", dbPath: null, deployBlock: null, lagWarnBlocks: null },
    indexer: { run: { fromBlock: null, toBlock: null, lastProcessedBlock: null } },
    hints: [],
  };
  const syncResponse = jsonResponse(syncPayload);
  await findCheck("health-sync").assert(syncResponse, JSON.stringify(syncPayload));
  const fractionalLag = structuredClone(syncPayload);
  fractionalLag.storage.lagBlocks = 0.5;
  await assert.rejects(
    findCheck("health-sync").assert(jsonResponse(fractionalLag), JSON.stringify(fractionalLag)),
    /non-negative safe integer or null/,
  );

  const envKeys = ["LINEA_CHAIN_ID", "NEXT_PUBLIC_LINEA_CHAIN_ID"];
  const previous = new Map(envKeys.map((key) => [key, process.env[key]]));
  process.env.LINEA_CHAIN_ID = "59144";
  process.env.NEXT_PUBLIC_LINEA_CHAIN_ID = "59144";
  let configuredModule;
  try {
    configuredModule = await import(`${SMOKE_HTTP_URL.href}?configured-chain=${Date.now()}`);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  const runtimeCheck = findCheck("health-runtime", configuredModule.HTTP_SMOKE_CHECKS);
  const runtimePayload = {
    status: "ok",
    visibility: "public",
    redacted: true,
    metrics: {},
    ts: 0,
    publicConfig: {
      chainId: 59144,
      chainName: "Linea",
      privyAppIdConfigured: true,
      privyFallbackActive: false,
      readOnlyMode: false,
      contractRequiresEpochBoundBets: true,
      productionLikeMonitoring: true,
      backupMonitorConfigured: true,
      backupMonitorMaxAgeConfigured: true,
      emailAlertConfigured: true,
      multiReplicaWeb: false,
      externalRateLimitConfigured: true,
      trustedProxyConfigured: true,
      weakRateLimitIdentityAllowed: false,
    },
  };
  const runtimeHeaders = { "cache-control": "no-store" };
  await runtimeCheck.assert(jsonResponse(runtimePayload, 200, runtimeHeaders), JSON.stringify(runtimePayload));
  const wrongChain = structuredClone(runtimePayload);
  wrongChain.publicConfig.chainId = 1;
  await assert.rejects(
    runtimeCheck.assert(jsonResponse(wrongChain, 200, runtimeHeaders), JSON.stringify(wrongChain)),
    /must match configured Linea chain id/,
  );
}

async function testSelectedRouteOrchestration() {
  const boardNames = ["biggestSingleWin", "luckiest", "oneTileWonder", "mostWins", "whales", "underdog"];
  const address = `0x${"1".repeat(40)}`;
  const validPayloads = {
    "/api/live-state": {
      currentEpoch: "10",
      fetchedAt: 1,
      epochEndTime: null,
      rolloverPool: null,
      epochDuration: null,
      pendingEpochDuration: null,
      pendingEpochDurationEta: null,
      pendingEpochDurationEffectiveFromEpoch: null,
      jackpotInfo: Array(8).fill("0"),
      currentEpochData: ["0", "0", "0", false, false, false],
      tileData: { pools: Array(25).fill("0"), users: Array(25).fill("0") },
      tileUserCounts: Array(25).fill(0),
      indexedTilePools: Array(25).fill("0"),
    },
    "/api/leaderboards": {
      ...Object.fromEntries(boardNames.map((name) => [name, [{ rank: 1, address, value: "1", valueNum: 1 }]])),
      luckyTile: [{ tileId: 1, wins: 0, pct: 0 }],
    },
    "/api/recent-wins": {
      wins: [{
        epoch: "10",
        user: address,
        amount: "1.0",
        amountRaw: "1000000000000000000",
        tileId: 1,
        jackpotKind: "daily",
        txHash: `0x${"2".repeat(64)}`,
        blockNumber: "20",
      }],
    },
    "/api/deposits": {
      deposits: [{ epoch: "10", totalAmount: "2.0", totalAmountNum: 2, tileIds: [1, 2], amounts: ["1.0", "1.0"] }],
    },
    "/api/deposits?includeRewards=1": {
      epochs: { 10: { isDailyJackpot: false, isWeeklyJackpot: true } },
      rewards: {
        10: { reward: "1.0", rewardPool: "2.0", winningTilePool: "3.0", userWinningAmount: "1.0", winningTile: 1 },
      },
    },
  };
  const validText = {
    "/robots.txt": "User-agent: *\nSitemap: https://lore.example/sitemap.xml",
    "/sitemap.xml": "<urlset>/jackpot-win /privacy /terms</urlset>",
  };
  const selectedChecks = [
    "live-state",
    "leaderboards",
    "recent-wins",
    "deposits",
    "deposits-rewards",
    "robots",
    "sitemap",
  ].map((name) => findCheck(name));

  async function runWithMutation(mutate) {
    const payloads = structuredClone(validPayloads);
    const text = { ...validText };
    mutate?.(payloads, text);
    const runtime = createHttpSmokeRuntime({
      baseUrl: "https://smoke.invalid",
      skipWarmup: true,
      retryableAttempts: 1,
      checks: selectedChecks,
      logger: createLogCapture().logger,
      fetchImpl: async (requestUrl) => {
        const url = new URL(requestUrl);
        if (url.pathname === "/robots.txt" || url.pathname === "/sitemap.xml") {
          return new Response(text[url.pathname], {
            status: 200,
            headers: { "content-type": url.pathname === "/robots.txt" ? "text/plain" : "application/xml" },
          });
        }
        const key = url.pathname === "/api/deposits" && url.searchParams.get("includeRewards") === "1"
          ? "/api/deposits?includeRewards=1"
          : url.pathname;
        return jsonResponse(payloads[key]);
      },
    });
    return runtime.run();
  }

  assert.equal((await runWithMutation()).ok, true, "selected checks must pass through the real smoke orchestrator");
  const adversarialMutations = [
    ["live-state", (payloads) => { payloads["/api/live-state"].tileUserCounts[0] = 0.5; }],
    ["leaderboards", (payloads) => { delete payloads["/api/leaderboards"].whales; }],
    ["recent-wins", (payloads) => { payloads["/api/recent-wins"].wins[0].jackpotKind = "invalid"; }],
    ["deposits", (payloads) => { payloads["/api/deposits"].deposits[0].tileIds = [1, 1]; }],
    ["deposits-rewards", (payloads) => { payloads["/api/deposits?includeRewards=1"].rewards[10].winningTile = 26; }],
    ["robots", (_payloads, text) => { text["/robots.txt"] = "User-agent: *"; }],
    ["sitemap", (_payloads, text) => { text["/sitemap.xml"] = "<urlset>/jackpot-win /privacy</urlset>"; }],
  ];
  for (const [name, mutate] of adversarialMutations) {
    const result = await runWithMutation(mutate);
    assert.equal(result.ok, false, `${name} adversarial payload must fail through the real smoke orchestrator`);
    assert.ok(result.failures.some((failure) => failure.check === name), `${name} validation must identify its route`);
  }
}

async function testBrowserWarmupBoundaries() {
  const requests = [];
  const timerDelays = [];
  const cleared = [];
  const capture = createLogCapture();
  await warmBaseUrl("https://smoke.invalid", 2_000, {
    now: () => 100,
    logger: capture.logger,
    setTimeoutImpl(callback, ms) {
      void callback;
      timerDelays.push(ms);
      return 72;
    },
    clearTimeoutImpl(timer) {
      cleared.push(timer);
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response("ready", { status: 200, headers: { "content-length": "5" } });
    },
  });
  assert.equal(requests[0].url, "https://smoke.invalid");
  assert.equal(requests[0].options.method, "GET");
  assert.equal(requests[0].options.headers.accept, "text/html");
  assert.deepEqual(timerDelays, [2_000]);
  assert.deepEqual(cleared, [72]);
  assert.match(capture.entries.log[0], /^PASS warmup/);

  let currentTime = 0;
  const retryTimers = [];
  const retrySleeps = [];
  await assert.rejects(
    warmBaseUrl("https://smoke.invalid", 2_000, {
      now: () => currentTime,
      sleep: async (ms) => {
        retrySleeps.push(ms);
        currentTime += ms;
      },
      logger: createLogCapture().logger,
      setTimeoutImpl(callback, ms) {
        void callback;
        retryTimers.push(ms);
        return retryTimers.length;
      },
      clearTimeoutImpl: () => undefined,
      fetchImpl: async () => new Response("unavailable", { status: 503 }),
    }),
    /failed to warm .* within 2000ms: warmup returned 503/,
  );
  assert.deepEqual(retryTimers, [2_000, 500]);
  assert.deepEqual(retrySleeps, [1_500, 500]);
  assert.equal(currentTime, 2_000, "warm-up retries must not sleep past the overall deadline");
  const overlongRequestMutant = (remainingMs) => Math.max(15_000, remainingMs);
  assert.equal(overlongRequestMutant(500), 15_000, "old timeout mutant overruns the remaining deadline");
}

async function runHttpSmokeBehaviorTests() {
  await testImportSafety();
  testNumericAndLengthBoundaries();
  testLoadHttpBehaviorPolicies();
  await testBoundedBodies();
  await testRequestMethodStatusCacheAndRetry();
  await testTimeoutAndCliRedaction();
  await testPageAndApiContracts();
  await testSelectedRouteOrchestration();
  await testBrowserWarmupBoundaries();
}

export function runHttpSmokeBoundaryTests() {
  const result = spawnSync(process.execPath, [THIS_FILE, "--behavior-worker"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    `HTTP smoke behavioral worker failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runHttpSmokeBehaviorTests();
    console.log("HTTP smoke behavioral boundary tests passed.");
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
}
