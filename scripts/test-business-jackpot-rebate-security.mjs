import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as rebatePanelModule from "../app/components/RebatePanel.tsx";
import * as walletSettingsDeepScanPanelModule from "../app/components/wallet/WalletSettingsDeepScanPanel.tsx";
import * as rebateHookModule from "../app/hooks/useRebate.ts";
import * as safetyPoolClaimThresholdModule from "../app/lib/safetyPoolClaimThreshold.ts";
import * as jackpotShareVerificationModule from "../app/lib/jackpotShareVerification.ts";
import * as constantsModule from "../app/lib/constants.ts";

const testRequire = createRequire(import.meta.url);
const { QueryClient, QueryClientProvider } = testRequire("@tanstack/react-query");
const { custom } = testRequire("viem");
const { createConfig, WagmiProvider } = testRequire("wagmi");
const { RebatePanel } = rebatePanelModule.default ?? rebatePanelModule;
const { WalletSettingsDeepScanPanel } = walletSettingsDeepScanPanelModule.default ?? walletSettingsDeepScanPanelModule;
const rebateHook = rebateHookModule.default ?? rebateHookModule;
const safetyPoolClaimThreshold = safetyPoolClaimThresholdModule.default ?? safetyPoolClaimThresholdModule;
const jackpotShareVerification = jackpotShareVerificationModule.default ?? jackpotShareVerificationModule;
const appConstants = constantsModule.default ?? constantsModule;

function testJackpotShareVerification() {
  const txHash = `0x${"a".repeat(64)}`;
  const blockHash = `0x${"b".repeat(64)}`;
  const finalizedEvent = ({ epoch = "42", kind = "daily", amount = "123.45", logIndex = "7" } = {}) => ({
    epoch,
    kind,
    amount,
    txHash,
    eventId: `${txHash}:${logIndex}`,
    logIndex,
    blockHash,
    blockNumber: "100",
    finalizedAtBlock: "110",
  });
  const verified = jackpotShareVerification.selectVerifiedJackpotShare([
    finalizedEvent(),
  ], ` ${txHash.toUpperCase()}:0007 `);
  assert.deepEqual(verified, { eventId: `${txHash}:7`, txHash, logIndex: "7", epoch: "42", kind: "daily", amount: "123.45" });
  assert.equal(jackpotShareVerification.selectVerifiedJackpotShare([], txHash), null);
  assert.equal(jackpotShareVerification.selectVerifiedJackpotShare([finalizedEvent()], "0xdead"), null);
  assert.equal(jackpotShareVerification.selectVerifiedJackpotShare([finalizedEvent()], `${txHash}:8`), null);
  assert.deepEqual(
    jackpotShareVerification.selectVerifiedJackpotShare([finalizedEvent()], txHash),
    verified,
    "legacy transaction URLs must resolve only when exactly one finalized canonical event matches",
  );
  assert.equal(
    jackpotShareVerification.selectVerifiedJackpotShare([
      finalizedEvent({ amount: "1", logIndex: "7" }),
      finalizedEvent({ epoch: "43", kind: "weekly", amount: "2", logIndex: "8" }),
    ], txHash),
    null,
    "one transaction with multiple events must not leave a legacy URL ambiguous",
  );
  assert.deepEqual(
    jackpotShareVerification.selectVerifiedJackpotShare([
      finalizedEvent({ amount: "1", logIndex: "7" }),
      finalizedEvent({ kind: "weekly", amount: "2", logIndex: "8" }),
    ], `${txHash}:8`),
    { eventId: `${txHash}:8`, txHash, logIndex: "8", epoch: "42", kind: "weekly", amount: "2" },
    "canonical event URLs must select exactly one finalized event without inventing an aggregate amount",
  );
}

function createRebateInfo(overrides = {}) {
  return {
    isSupported: true,
    pendingRebate: "12.5",
    pendingRebateWei: 12_500_000_000_000_000_000n,
    claimableEpochs: 2,
    totalEpochs: 3,
    isLoading: false,
    hasLoaded: true,
    dataFreshness: "fresh",
    claimPlanKind: "single",
    isEstimatingClaimPlan: false,
    minClaimAmount: "100",
    isBelowClaimMinimum: false,
    isLoadingOlder: false,
    hasMoreOlder: false,
    recentEpochs: [
      { epoch: 42, pending: "1.23456", pendingWei: 1n, claimed: false, resolved: true },
    ],
    ...overrides,
  };
}

function renderRebatePanel(overrides = {}) {
  return renderToStaticMarkup(createElement(RebatePanel, {
    address: "0x0000000000000000000000000000000000000001",
    rebateInfo: createRebateInfo(overrides.rebateInfo),
    isClaiming: overrides.isClaiming === true,
    onClaimRebates: async () => {},
  }));
}

function renderWalletDeepScanPanel({
  deepScanWins = null,
  deepScanScanning = false,
  deepScanClaiming = false,
  deepScanProgress = "",
} = {}) {
  return renderToStaticMarkup(createElement(WalletSettingsDeepScanPanel, {
    deepScanWins,
    deepScanScanning,
    deepScanClaiming,
    deepScanProgress,
    onDeepScan: () => {},
    onDeepScanStop: () => {},
    onDeepClaimOne: () => {},
    onDeepClaimAll: () => {},
  }));
}

function readRebateHookFreshnessBehavior() {
  let networkCalls = 0;
  const config = createConfig({
    chains: [appConstants.APP_CHAIN],
    transports: {
      [appConstants.APP_CHAIN.id]: custom({
        request: async () => {
          networkCalls += 1;
          throw new Error("fixture network forbidden");
        },
      }),
    },
    ssr: true,
  });
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  function RebateHookSnapshot() {
    const { rebateInfo } = rebateHook.useRebate({ enabled: false, active: false });
    return createElement(
      "output",
      { "data-freshness": rebateInfo.dataFreshness },
      rebateInfo.dataFreshness,
    );
  }

  try {
    return {
      markup: renderToStaticMarkup(
        createElement(
          WagmiProvider,
          { config },
          createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(RebateHookSnapshot),
          ),
        ),
      ),
      networkCalls,
    };
  } finally {
    queryClient.clear();
  }
}

function readPublicRouteFailureBehavior() {
  const forbiddenDbParent = join(
    tmpdir(),
    `lore-route-failure-no-db-${process.pid}-${Date.now()}`,
  );
  const forbiddenDbPath = join(forbiddenDbParent, "lore-v10.sqlite");
  if (existsSync(forbiddenDbParent)) {
    throw new Error("public route failure probe DB poison path already exists");
  }
  const urls = {
    deposits: new URL("../app/api/deposits/route.ts", import.meta.url).href,
    rebates: new URL("../app/api/rebates/route.ts", import.meta.url).href,
    jackpots: new URL("../app/api/jackpots/route.ts", import.meta.url).href,
    rebateHistory: new URL("../app/api/rebate-history/route.ts", import.meta.url).href,
    storage: new URL("../server/storage.ts", import.meta.url).href,
    dataBridge: new URL("../app/api/_lib/dataBridge.ts", import.meta.url).href,
    limiter: new URL("../app/api/_lib/sharedRateLimit.ts", import.meta.url).href,
    logger: new URL("../app/api/_lib/routeError.ts", import.meta.url).href,
    reward: new URL("../app/api/_lib/rewardSummary.ts", import.meta.url).href,
    constants: new URL("../app/lib/constants.ts", import.meta.url).href,
    jackpotService: new URL("../app/api/_lib/jackpotsService.ts", import.meta.url).href,
    versioned: new URL("../app/api/_lib/versionedRouteCache.ts", import.meta.url).href,
  };
  const script = [
    'const { mock } = await import("node:test");',
    `const urls = ${JSON.stringify(urls)};`,
    'const calls = { depositReads: 0, rebateReads: 0, jackpotReads: 0, networkAccesses: 0, limiterBuckets: [], logged: 0 };',
    'const probe = { limiterOptions: [], historyPageOptions: [], historyMulticalls: 0, historyAllowFailure: [], historyLogged: 0 };',
    'const storageMock = mock.module(urls.storage, { namedExports: {',
    '  readJsonPath: () => null, patchJsonPath: () => {},',
    '  getMetaBigInt: () => 1n, getMetaNumber: () => 1,',
    '  getCanonicalLastIndexedBlock: () => 1n,',
    '  getUserBetsMap: () => { calls.depositReads += 1; throw new Error("fixture-private-deposit"); },',
    '  getUserParticipatingEpochs: () => { calls.rebateReads += 1; throw new Error("fixture-private-rebate"); },',
    '  getUserParticipatingEpochPage: (_user, options) => { probe.historyPageOptions.push(options); return { epochs: [64, 63], hasMore: false, nextCursor: null }; },',
    '} });',
    'const publicClient = new Proxy({',
    '  multicall: async (options) => {',
    '    probe.historyMulticalls += 1;',
    '    probe.historyAllowFailure.push(options.allowFailure);',
    '    throw new Error("fixture-private-rebate-history");',
    '  },',
    '}, { get(target, property, receiver) {',
    '  if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);',
    '  calls.networkAccesses += 1;',
    '  throw new Error("fixture network forbidden");',
    '} });',
    'const dataBridgeMock = mock.module(urls.dataBridge, { namedExports: {',
    '  CONTRACT_ADDRESS: "0x1111111111111111111111111111111111111111",',
    '  CONTRACT_DEPLOY_BLOCK: 0n,',
    '  filterByCurrentEpoch: (rows) => rows,',
    '  isSafePositiveInteger: (value) => Number.isSafeInteger(value) && value > 0,',
    '  publicClient,',
    '} });',
    'const rewardMock = mock.module(urls.reward, { namedExports: {',
    '  loadRewardMapsForUserEpochs: async () => ({ epochs: {}, rewards: {} }),',
    '} });',
    'const limiterMock = mock.module(urls.limiter, { namedExports: {',
    '  enforceSharedRateLimit: async (request, options) => {',
    '    const fixture = (request.nextUrl ?? new URL(request.url)).searchParams.get("publicFailureFixture");',
    '    if (fixture) {',
    '      probe.limiterOptions.push({ fixture, bucket: options.bucket, limit: options.limit, windowMs: options.windowMs });',
    '    } else {',
    '      calls.limiterBuckets.push(options.bucket);',
    '    }',
    '    if ((fixture === "rebates-normal" && options.bucket === "api-rebates") ||',
    '        (fixture === "rebates-exact" && options.bucket === "api-rebates-exact")) {',
    '      return new Response(JSON.stringify({ error: "fixture limited" }), {',
    '        status: 429,',
    '        headers: { "content-type": "application/json", "retry-after": "60" },',
    '      });',
    '    }',
    '    return null;',
    '  },',
    '} });',
    'const loggerMock = mock.module(urls.logger, { namedExports: {',
    '  logRouteError: (route) => { if (route === "api/rebate-history") probe.historyLogged += 1; else calls.logged += 1; },',
    '} });',
    'const constantsMock = mock.module(urls.constants, { namedExports: {',
    '  CONTRACT_HAS_REBATE_API: true, GAME_ABI: [],',
    '} });',
    'const jackpotServiceMock = mock.module(urls.jackpotService, { namedExports: {',
    '  readJackpotPayload: async () => { calls.jackpotReads += 1; throw new Error("fixture-private-jackpot"); },',
    '} });',
    'const versionedMock = mock.module(urls.versioned, { namedExports: {',
    '  startVersionedBackgroundRefresh: () => {},',
    '  startVersionedInflightBuild: ({ build }) => ({ buildPromise: Promise.resolve().then(build) }),',
    '} });',
    'const read = async (routeUrl, input, sentinel) => {',
    '  const imported = await import(routeUrl + "?public-failure-probe=1");',
    '  const route = imported.default ?? imported;',
    '  const response = await route.GET(input);',
    '  const body = await response.json();',
    '  return {',
    '    status: response.status,',
    '    cacheControl: response.headers.get("cache-control"),',
    '    rebateCache: response.headers.get("x-rebate-cache"),',
    '    body,',
    '    leaked: JSON.stringify(body).includes(sentinel),',
    '  };',
    '};',
    'let output;',
    'try {',
    '  const { NextRequest } = await import("next/server");',
    '  const user = "0x0000000000000000000000000000000000000001";',
    '  const deposits = await read(urls.deposits, new NextRequest(`https://example.test/api/deposits?user=${user}`), "fixture-private-deposit");',
    '  const rebates = await read(urls.rebates, new NextRequest(`https://example.test/api/rebates?user=${user}`), "fixture-private-rebate");',
    '  const jackpots = await read(urls.jackpots, new Request("https://example.test/api/jackpots"), "fixture-private-jackpot");',
    '  const normalRateLimited = await read(urls.rebates, new NextRequest(`https://example.test/api/rebates?user=${user}&publicFailureFixture=rebates-normal`), "fixture-private");',
    '  const exactRateLimited = await read(urls.rebates, new NextRequest(`https://example.test/api/rebates?user=${user}&exact=1&publicFailureFixture=rebates-exact`), "fixture-private");',
    '  const oversizedHistory = await read(urls.rebateHistory, new NextRequest(`https://example.test/api/rebate-history?user=${user}&limit=65&publicFailureFixture=history-oversized`), "fixture-private-rebate-history");',
    '  const boundedHistoryFailure = await read(urls.rebateHistory, new NextRequest(`https://example.test/api/rebate-history?user=${user}&limit=64&publicFailureFixture=history-bounded`), "fixture-private-rebate-history");',
    '  output = {',
    '    deposits, rebates, jackpots,',
    '    rebateRateLimits: {',
    '      normal: normalRateLimited,',
    '      exact: exactRateLimited,',
    '      options: probe.limiterOptions.filter(({ fixture }) => fixture.startsWith("rebates-")),',
    '    },',
    '    rebateHistory: {',
    '      oversized: oversizedHistory,',
    '      boundedFailure: boundedHistoryFailure,',
    '      pageOptions: probe.historyPageOptions,',
    '      multicalls: probe.historyMulticalls,',
    '      allowFailure: probe.historyAllowFailure,',
    '      logged: probe.historyLogged,',
    '    },',
    '    calls,',
    '  };',
    '} finally {',
    '  versionedMock.restore(); jackpotServiceMock.restore(); constantsMock.restore();',
    '  loggerMock.restore(); limiterMock.restore(); rewardMock.restore();',
    '  dataBridgeMock.restore(); storageMock.restore();',
    '}',
    'console.log(JSON.stringify(output));',
    'process.exit(0);',
  ].join("\n");
  const result = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      script,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        LORE_DB_PATH: forbiddenDbPath,
        TSX_DISABLE_CACHE: "1",
      },
      maxBuffer: 512 * 1024,
      timeout: 30_000,
      windowsHide: true,
    },
  );
  if (existsSync(forbiddenDbParent)) {
    throw new Error("public route failure probe opened its fail-closed DB path");
  }
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() || result.error?.message || "public route failure probe failed",
    );
  }
  return JSON.parse(result.stdout.trim());
}

function readRebateRouteEpochSafetyBehavior() {
  const forbiddenDbParent = join(
    tmpdir(),
    `lore-rebate-route-safety-no-db-${randomUUID()}`,
  );
  const forbiddenDbPath = join(forbiddenDbParent, "lore-v10.sqlite");
  if (existsSync(forbiddenDbParent) || existsSync(forbiddenDbPath)) {
    throw new Error("rebate route safety probe DB poison path already exists");
  }
  const urls = {
    route: new URL("../app/api/rebates/route.ts", import.meta.url).href,
    storage: new URL("../server/storage.ts", import.meta.url).href,
    dataBridge: new URL("../app/api/_lib/dataBridge.ts", import.meta.url).href,
    limiter: new URL("../app/api/_lib/sharedRateLimit.ts", import.meta.url).href,
    logger: new URL("../app/api/_lib/routeError.ts", import.meta.url).href,
    constants: new URL("../app/lib/constants.ts", import.meta.url).href,
    routeCache: new URL("../app/api/_lib/routeCache.ts", import.meta.url).href,
    versioned: new URL("../app/api/_lib/versionedRouteCache.ts", import.meta.url).href,
    metrics: new URL("../app/api/_lib/runtimeMetrics.ts", import.meta.url).href,
  };
  const script = String.raw`
const { mock } = await import("node:test");
const urls = ${JSON.stringify(urls)};
const safeEpoch = 17;
const unsafeEpoch = Number.MAX_SAFE_INTEGER + 1;
const maxSafeBigint = BigInt(Number.MAX_SAFE_INTEGER);
const calls = {
  fetch: 0,
  limiter: 0,
  storageEpochs: 0,
  metaNumber: 0,
  metaBigint: 0,
  logger: 0,
  rpcPoison: 0,
  rpc: [],
};
const cacheRecords = [];
const cacheRoles = ["payload", "indexed", "watermark", "scan"];
const caches = new Map();
const multicalls = new Map();
let scenario = "summary";
const priorFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  writable: true,
  value: async () => {
    calls.fetch += 1;
    throw new Error("unexpected rebate route safety fetch");
  },
});

function freshWorkingCycle() {
  return {
    watermark: "poisoned-working-cycle",
    epochs: [safeEpoch, unsafeEpoch],
    nextOffset: 0,
    totals: {
      pendingRebateWei: 0n,
      summaryClaimableCount: 0,
      claimableEpochs: [],
      processedEpochs: 0,
    },
    recentEpochs: [],
  };
}

function createProbeCache(role) {
  const values = new Map();
  const inflight = new Map();
  return {
    getFresh(key) {
      return values.get(key);
    },
    getStale(key) {
      if (values.has(key)) return values.get(key);
      if (role === "scan" && key.endsWith(":exact")) {
        return { working: freshWorkingCycle(), committed: null };
      }
      return undefined;
    },
    getInflight(key) {
      return inflight.get(key);
    },
    setInflight(key, value) {
      inflight.set(key, value);
    },
    clearInflight(key, value) {
      if (inflight.get(key) === value) inflight.delete(key);
    },
    set(key, value) {
      values.set(key, value);
      cacheRecords.push({
        role,
        key,
        watermark: role === "watermark" ? value?.watermark ?? null : null,
      });
      return value;
    },
  };
}

const publicClient = new Proxy({
  async readContract(options) {
    calls.rpc.push({
      scenario,
      kind: "read",
      functionName: options.functionName,
      epoch: options.functionName === "getRebateInfo"
        ? options.args?.[0]?.toString?.() ?? null
        : null,
    });
    if (options.functionName === "getRebateSummary") {
      return [5n, maxSafeBigint + 100n];
    }
    if (options.functionName === "getRebateInfo") {
      return [3n, 2n, 1n, false, true];
    }
    throw new Error("unexpected rebate route readContract function");
  },
  async multicall(options) {
    const count = (multicalls.get(scenario) ?? 0) + 1;
    multicalls.set(scenario, count);
    calls.rpc.push({
      scenario,
      kind: "multicall",
      count,
      epochs: options.contracts.map(
        (contract) => contract.args?.[0]?.toString?.() ?? null,
      ),
    });
    if (scenario === "exact-fallback" && count === 2) {
      throw new Error("intentional exact multicall failure");
    }
    return options.contracts.map(() => ({
      status: "success",
      result: [3n, 2n, 1n, false, true],
    }));
  },
}, {
  get(target, property, receiver) {
    if (Reflect.has(target, property)) {
      return Reflect.get(target, property, receiver);
    }
    calls.rpcPoison += 1;
    throw new Error(
      "unexpected rebate route RPC member " + String(property),
    );
  },
});

const handles = [];
let output;
try {
  handles.push(mock.module(urls.storage, { namedExports: {
    getMetaNumber: () => {
      calls.metaNumber += 1;
      return unsafeEpoch;
    },
    getMetaBigInt: () => {
      calls.metaBigint += 1;
      return 777n;
    },
    getUserParticipatingEpochs: () => {
      calls.storageEpochs += 1;
      return [safeEpoch, unsafeEpoch, 0, 1.5, -1];
    },
  } }));
  handles.push(mock.module(urls.dataBridge, { namedExports: {
    CONTRACT_ADDRESS: "0x1111111111111111111111111111111111111111",
    isSafePositiveInteger: (value) => Number.isSafeInteger(value) && value > 0,
    publicClient,
  } }));
  handles.push(mock.module(urls.limiter, { namedExports: {
    enforceSharedRateLimit: async () => {
      calls.limiter += 1;
      return null;
    },
  } }));
  handles.push(mock.module(urls.logger, { namedExports: {
    logRouteError: () => {
      calls.logger += 1;
    },
  } }));
  handles.push(mock.module(urls.constants, { namedExports: {
    CONTRACT_HAS_REBATE_API: true,
    GAME_ABI: [],
  } }));
  handles.push(mock.module(urls.routeCache, { namedExports: {
    createRouteCache: () => {
      const role = cacheRoles.shift();
      if (!role) throw new Error("unexpected extra rebate route cache");
      const cache = createProbeCache(role);
      caches.set(role, cache);
      return cache;
    },
  } }));
  handles.push(mock.module(urls.versioned, { namedExports: {
    startVersionedBackgroundRefresh: () => {},
    startVersionedInflightBuild: ({ build, onCommit }) => ({
      buildPromise: Promise.resolve()
        .then(build)
        .then((result) => {
          onCommit?.();
          return result;
        }),
    }),
  } }));
  handles.push(mock.module(urls.metrics, { namedExports: {
    beginRouteMetric: () => ({}),
    failRouteMetric: () => {},
    finishRouteMetric: () => {},
    markRouteCacheHit: () => {},
    markRouteInflightJoin: () => {},
    markRouteStaleServed: () => {},
  } }));

  const imported = await import(urls.route + "?rebate-route-safety=" + Date.now());
  if (cacheRoles.length !== 0 || caches.size !== 4) {
    throw new Error("rebate route cache factory roles did not bind exactly once");
  }
  const route = imported.default ?? imported;
  const { NextRequest } = await import("next/server");
  const request = async (nextScenario, user, exact) => {
    scenario = nextScenario;
    const response = await route.GET(new NextRequest(
      "https://example.test/api/rebates?user=" + user + (exact ? "&exact=1" : ""),
    ));
    return {
      status: response.status,
      cache: response.headers.get("x-rebate-cache"),
      body: await response.json(),
    };
  };

  const summary = await request(
    "summary",
    "0x0000000000000000000000000000000000000001",
    false,
  );
  const exactSuccess = await request(
    "exact-success",
    "0x0000000000000000000000000000000000000002",
    true,
  );
  const exactFallback = await request(
    "exact-fallback",
    "0x0000000000000000000000000000000000000003",
    true,
  );
  output = {
    safeEpoch,
    unsafeEpoch,
    summary,
    exactSuccess,
    exactFallback,
    indexedKeys: cacheRecords
      .filter(({ role }) => role === "indexed")
      .map(({ key }) => key),
    watermarkValues: cacheRecords
      .filter(({ role }) => role === "watermark")
      .map(({ watermark }) => watermark),
    exactSuccessMulticallEpochs: calls.rpc
      .filter(({ scenario: callScenario, kind }) => (
        callScenario === "exact-success" && kind === "multicall"
      ))
      .map(({ epochs }) => epochs),
    exactFallbackReadEpochs: calls.rpc
      .filter(({ scenario: callScenario, functionName }) => (
        callScenario === "exact-fallback" && functionName === "getRebateInfo"
      ))
      .map(({ epoch }) => epoch),
    calls: {
      fetch: calls.fetch,
      limiter: calls.limiter,
      storageEpochs: calls.storageEpochs,
      metaNumber: calls.metaNumber,
      metaBigint: calls.metaBigint,
      logger: calls.logger,
      rpcPoison: calls.rpcPoison,
      rpcTotal: calls.rpc.length,
      multicalls: Object.fromEntries(multicalls),
    },
  };
} finally {
  for (const handle of handles.reverse()) handle.restore();
  if (priorFetchDescriptor === undefined) delete globalThis.fetch;
  else Object.defineProperty(globalThis, "fetch", priorFetchDescriptor);
}

console.log(JSON.stringify(output));
`;
  const result = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      script,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        LORE_DB_PATH: forbiddenDbPath,
        TSX_DISABLE_CACHE: "1",
      },
      maxBuffer: 512 * 1024,
      timeout: 30_000,
      windowsHide: true,
    },
  );
  if (existsSync(forbiddenDbParent) || existsSync(forbiddenDbPath)) {
    throw new Error("rebate route safety probe opened its fail-closed DB path");
  }
  if (result.error) {
    throw new Error("rebate route safety probe failed to start", {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    const detail = `${result.stderr || ""}\n${result.stdout || ""}`
      .trim()
      .slice(-4_000);
    throw new Error(`rebate route safety probe exited ${result.status}: ${detail}`);
  }
  try {
    return JSON.parse(result.stdout.trim());
  } catch (error) {
    throw new Error("rebate route safety probe returned invalid JSON", {
      cause: error,
    });
  }
}

export function runWalletDeepScanPanelBehaviorTests() {
  const initialHtml = renderWalletDeepScanPanel();
  assert.match(
    initialHtml,
    /Recovery scan for older rewards\. It walks historical epochs in bounded batches and can be stopped any time\./,
  );
  assert.match(initialHtml, />Start Recovery Scan<\/button>/);

  const scanningHtml = renderWalletDeepScanPanel({
    deepScanScanning: true,
    deepScanProgress: "Scanned 24 of 40 epochs",
  });
  assert.match(
    scanningHtml,
    /<div role="status" aria-live="polite" aria-busy="true"[\s\S]*?<svg aria-hidden="true"/,
  );
  assert.match(scanningHtml, />Scanned 24 of 40 epochs<\/span>/);
  assert.match(scanningHtml, />Stop Scan<\/button>/);

  const completedHtml = renderWalletDeepScanPanel({
    deepScanWins: [],
    deepScanProgress: "Recovery scan complete",
  });
  assert.match(
    completedHtml,
    /<div role="status" aria-live="polite"[\s\S]*?<svg aria-hidden="true"/,
  );
  assert.match(completedHtml, />All rewards claimed<\/span>/);
  assert.match(completedHtml, />Scan Again<\/button>/);

  const largeAmountHtml = renderWalletDeepScanPanel({
    deepScanWins: [{
      epoch: "42",
      amountWei: "9007199254740993123456789000000000",
    }],
    deepScanProgress: "Found 1 reward",
  });
  assert.match(largeAmountHtml, />9,007,199,254,740,993\.12 LINEA<\/span>/);
  assert.doesNotMatch(largeAmountHtml, /9,007,199,254,740,994/);

  for (const html of [initialHtml, scanningHtml, completedHtml, largeAmountHtml]) {
    assert.doesNotMatch(html, /Scans ALL epochs|Start Full Scan/);
  }
}

function assertDisabledClaimAccessibility(html) {
  assert.match(html, /<button[^>]*disabled=""[^>]*aria-label="No claimable Safety Pool epochs are available yet\."/);
  assert.match(html, /aria-describedby="rebate-claim-disabled-reason"/);
  assert.match(html, /title="No claimable Safety Pool epochs are available yet\."/);
  assert.match(
    html,
    /id="rebate-claim-disabled-reason"[^>]*>No claimable Safety Pool epochs are available yet\.<\/p>/,
  );
}

function assertInitialLoadingAccessibility(html) {
  assert.match(
    html,
    /role="status" aria-live="polite" aria-busy="true"[^>]*>Loading Safety Pool ledger\.\.\.<\/div>/,
  );
}

function assertStalePresentation(html) {
  assert.match(html, /data-testid="rebate-freshness-hint"/);
  assert.match(html, /Showing cached Safety Pool data while the ledger refreshes\./);
}

function testRebatePanelRuntimeBehavior() {
  const exactDecimalHtml = renderRebatePanel({
    rebateInfo: {
      pendingRebate: "9007199254740993.123456789",
      recentEpochs: [
        { epoch: 42, pending: "1.23456", pendingWei: 1n, claimed: false, resolved: true },
        { epoch: 41, pending: "1e9", pendingWei: 1n, claimed: false, resolved: true },
      ],
      hasMoreOlder: true,
      loadOlder: async () => true,
    },
  });
  assert.match(exactDecimalHtml, /9007199254740993\.1235 LINEA/);
  assert.match(exactDecimalHtml, /1\.2346 LINEA/);
  assert.match(exactDecimalHtml, /0\.0000 LINEA/);
  assert.match(exactDecimalHtml, /<button[^>]*type="button"[^>]*>Load older epochs<\/button>/);

  const disabledHtml = renderRebatePanel({ rebateInfo: { claimableEpochs: 0 } });
  assertDisabledClaimAccessibility(disabledHtml);

  const claimingHtml = renderRebatePanel({ isClaiming: true });
  assert.match(claimingHtml, /aria-label="Safety Pool claim is already pending"/);
  assert.match(claimingHtml, /title="Safety Pool claim is already pending"/);
  assert.match(claimingHtml, /aria-busy="true"/);

  const initialLoadingHtml = renderRebatePanel({
    rebateInfo: { isLoading: true, hasLoaded: false },
  });
  assertInitialLoadingAccessibility(initialLoadingHtml);

  const backgroundRefreshHtml = renderRebatePanel({
    rebateInfo: { isLoading: true, hasLoaded: true, dataFreshness: "background-refresh" },
  });
  assert.match(backgroundRefreshHtml, /role="status" aria-live="polite"[^>]*>Refreshing Safety Pool ledger in background\.\.\.<\/p>/);
  assert.match(backgroundRefreshHtml, /Safety Pool refresh is already in progress; current data remains visible\./);

  const staleHtml = renderRebatePanel({ rebateInfo: { dataFreshness: "stale-cache" } });
  assertStalePresentation(staleHtml);
  const offlineHtml = renderRebatePanel({ rebateInfo: { dataFreshness: "offline" } });
  assert.match(offlineHtml, /Showing last loaded Safety Pool data\. Refresh failed and will retry automatically\./);

  assert.throws(
    () => assertDisabledClaimAccessibility(disabledHtml.replace(' aria-describedby="rebate-claim-disabled-reason"', "")),
    /aria-describedby/,
    "disabled-reason linkage mutant must be rejected",
  );
  assert.throws(
    () => assertInitialLoadingAccessibility(initialLoadingHtml.replace(' aria-busy="true"', "")),
    /aria-busy/,
    "loading announcement mutant must be rejected",
  );
  assert.throws(
    () => assertStalePresentation(staleHtml.replace('data-testid="rebate-freshness-hint"', 'data-testid="mutant"')),
    /rebate-freshness-hint/,
    "stale-hint selector mutant must be rejected",
  );
  assert.doesNotMatch(
    exactDecimalHtml,
    /9007199254740994\.0000 LINEA/,
    "Safety Pool display must not round large decimal text through Number precision",
  );
}

function testRebatePayloadBoundaryBehavior() {
  const maxSafeIntegerText = String(Number.MAX_SAFE_INTEGER);
  const normalized = rebateHook.normalizeRebatePayload({
    isSupported: false,
    pendingRebateWei: " 42 ",
    claimableEpochCount: maxSafeIntegerText,
    claimableEpochList: ["0", 7, " 8 ", "01", -1, Number.MAX_SAFE_INTEGER + 1, "9007199254740992", 1.5, null],
    totalEpochs: "001",
    participatingEpochs: [Number.MAX_SAFE_INTEGER, maxSafeIntegerText, "-1", "1e3"],
    recentEpochs: [
      {
        epoch: "42",
        pendingWei: "99",
        pending: "0.000000000000000099",
        claimed: false,
        resolved: true,
        userVolumeWei: "100",
        rebatePoolWei: "200",
      },
      { epoch: "042" },
      { epoch: "9007199254740992" },
    ],
    scan: {
      mode: "exact",
      complete: false,
      processedEpochs: "12",
      totalEpochs: "9007199254740992",
      nextOffset: "9",
      servingCommitted: true,
    },
  });
  assert.equal(normalized.isSupported, false);
  assert.equal(normalized.pendingRebateWei, "42");
  assert.equal(normalized.claimableEpochCount, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(normalized.claimableEpochList, [0, 7, 8]);
  assert.equal(normalized.totalEpochs, 0);
  assert.deepEqual(normalized.participatingEpochs, [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]);
  assert.deepEqual(normalized.recentEpochs.map((row) => row.epoch), [42]);
  assert.deepEqual(normalized.scan, {
    mode: "exact",
    complete: false,
    processedEpochs: 12,
    totalEpochs: 0,
    nextOffset: 9,
    servingCommitted: true,
  });

  const history = rebateHook.normalizeRebateHistoryPayload({
    rows: [
      { epoch: "9", pendingWei: "1", pending: "0.1", claimed: false, resolved: true },
      { epoch: "09" },
      { epoch: "9007199254740992" },
    ],
    hasMore: "true",
    nextCursor: maxSafeIntegerText,
    error: "bounded diagnostic",
  });
  assert.deepEqual(history.rows.map((row) => row.epoch), [9]);
  assert.equal(history.hasMore, false);
  assert.equal(history.nextCursor, Number.MAX_SAFE_INTEGER);
  assert.equal(history.error, "bounded diagnostic");
  for (const invalidCursor of [0, "0", "01", -1, 1.5, "9007199254740992"]) {
    assert.equal(
      rebateHook.normalizeRebateHistoryPayload({ nextCursor: invalidCursor }).nextCursor,
      null,
      `unsafe or non-canonical cursor must be rejected: ${String(invalidCursor)}`,
    );
  }

  const txHash = `0x${"c".repeat(64)}`;
  const txMessage = rebateHook.formatRebateTxMessage("Safety Pool claim submitted.", txHash);
  assert.match(txMessage, /^Safety Pool claim submitted\. https:\/\//);
  assert.match(txMessage, new RegExp(`/tx/${txHash}$`));
  assert.equal(
    rebateHook.formatRebateTxMessage("Safety Pool claim submitted.", "0xdead"),
    "Safety Pool claim submitted.",
    "invalid transaction evidence must not produce an explorer link",
  );
}

function testRebateCacheFreshnessPolicyBehavior() {
  const now = 1_700_000_000_000;
  assert.equal(rebateHook.getRebateClientCacheRefreshDelay(now - 1, now), 59_999);
  assert.equal(rebateHook.getRebateClientCacheRefreshDelay(now - 59_999, now), 1);
  assert.equal(rebateHook.getRebateClientCacheRefreshDelay(now - 60_000, now), 0);
  assert.equal(rebateHook.getRebateClientCacheRefreshDelay(String(now - 1), now), 0);
  assert.equal(rebateHook.getRebateClientCacheRefreshDelay(now + 5_000, now), 60_000);
  assert.equal(rebateHook.getRebateClientCacheRefreshDelay(now + 5_001, now), 0);

  assert.equal(rebateHook.isRebateClaimPlanCacheFresh(now - 59_999, now), true);
  assert.equal(rebateHook.isRebateClaimPlanCacheFresh(now - 60_000, now), false);
  assert.equal(rebateHook.isRebateClaimPlanCacheFresh(String(now - 1), now), false);
  assert.equal(rebateHook.isRebateClaimPlanCacheFresh(now + 5_000, now), true);
  assert.equal(rebateHook.isRebateClaimPlanCacheFresh(now + 5_001, now), false);
}

export function runJackpotAndRebateSecurityTests() {
  testJackpotShareVerification();
  testRebatePanelRuntimeBehavior();
  testRebatePayloadBoundaryBehavior();
  testRebateCacheFreshnessPolicyBehavior();
  runWalletDeepScanPanelBehaviorTests();

  const smokeHttpSource = readFileSync("scripts/smoke-http.mjs", "utf8");
  const jackpotsServiceSource = readFileSync("app/api/_lib/jackpotsService.ts", "utf8");
  assert.match(
    jackpotsServiceSource,
    /JACKPOT_LOG_SCAN_CHUNK = 10_000n[\s\S]*JACKPOT_BOOTSTRAP_SCAN_CHUNK = 10_000n/,
    "jackpot RPC scans must stay within the Linea public RPC 10k-block range limit",
  );
  assert.match(
    jackpotsServiceSource,
    /message\.includes\("range"\) && message\.includes\("exceeds limit"\)/,
    "jackpot RPC scans must recognize provider block-range limit errors",
  );
  assert.match(
    jackpotsServiceSource,
    /formatLineaWeiDisplayNumber[\s\S]*function toDisplayNumberWei\(value: bigint\)[\s\S]*return formatLineaWeiDisplayNumber\(value\)/,
    "jackpot service amountNum compatibility fields must derive from bounded raw-wei formatting",
  );
  assert.match(
    jackpotsServiceSource,
    /if \(seedJackpots\.length === 0\)[\s\S]*commitJackpotResponseCache\(\{ jackpots: \[\] \}[\s\S]*maybeStartJackpotRecovery\(\[\]\)[\s\S]*return \{ payload, source: "rebuilt" \}/,
    "empty jackpot storage must return immediately and recover in the background",
  );
  assert.doesNotMatch(
    jackpotsServiceSource,
    /await buildJackpotsPayload\(\{[\s\S]{0,180}seedJackpots: \[\]/,
    "empty jackpot storage must not block the HTTP request on historical RPC recovery",
  );
  const jackpotRuntimeProbe = spawnSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/test-jackpot-api-admission.ts"],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(
    jackpotRuntimeProbe.status,
    0,
    jackpotRuntimeProbe.stderr || jackpotRuntimeProbe.stdout || jackpotRuntimeProbe.error?.message,
  );
  assert.match(
    jackpotRuntimeProbe.stdout,
    /^jackpot API admission tests passed \(runtime 5 groups, 4 mutants killed\)\s*$/,
    "jackpot admission, finality, cache, public-output, and fault behavior probe must complete",
  );
  assert.equal(
    safetyPoolClaimThreshold.parseMinSafetyPoolClaimWei("-1").toString(),
    safetyPoolClaimThreshold.parseMinSafetyPoolClaimWei(null).toString(),
    "Safety Pool claim minimum must reject negative env values and keep the dust warning active",
  );
  assert.equal(
    safetyPoolClaimThreshold.parseMinSafetyPoolClaimWei("0").toString(),
    safetyPoolClaimThreshold.parseMinSafetyPoolClaimWei(null).toString(),
    "Safety Pool claim minimum must reject zero env values and keep the dust warning active",
  );
  assert.equal(
    safetyPoolClaimThreshold.formatSafetyPoolClaimMinimum(safetyPoolClaimThreshold.parseMinSafetyPoolClaimWei("12.5")),
    "12.5",
    "Safety Pool claim minimum must keep valid positive configured amounts",
  );
  const rebateSource = readFileSync("app/hooks/useRebate.ts", "utf8");
  assert.match(
    rebateSource,
    /function parseClaimableEpoch\(value: bigint \| undefined\)[\s\S]*value <= 0n \|\| value > BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*const epochNumber = parseClaimableEpoch\(chunk\[index\]\)[\s\S]*const epochNumber = parseClaimableEpoch\(epoch\)[\s\S]*epoch: parseClaimableEpoch\(epoch\) \?\? "invalid"/,
    "Safety Pool client must safely narrow exact claimable epoch bigint evidence",
  );
  assert.match(
    rebateSource,
    /X-Rebate-Cache/,
    "Safety Pool client must surface stale/inflight API cache status to the UI",
  );
  assert.deepEqual(
    readRebateHookFreshnessBehavior(),
    {
      markup: '<output data-freshness="fresh">fresh</output>',
      networkCalls: 0,
    },
    "Safety Pool hook must expose a concrete freshness state without performing SSR network work",
  );
  assert.match(
    rebateSource,
    /getRebateClientCacheRefreshDelay\(savedAt\)[\s\S]*isRebateClaimPlanCacheFresh\(cachedPlan\.savedAt\)/,
    "Safety Pool runtime must remain wired to the behavior-tested strict cache freshness policies",
  );
  assert.match(
    rebateSource,
    /activeRebateAddressRef\.current === rebateAddress[\s\S]*cacheSavedAtRef\.current = null;[\s\S]*resetState\(\)/,
    "Safety Pool must clear prior-wallet state and cache timing when the active wallet changes",
  );
  assert.match(
    rebateSource,
    /const resetState = useCallback[\s\S]*requestIdRef\.current \+= 1/,
    "Safety Pool reset must invalidate in-flight responses from the previous wallet",
  );
  const claimBehaviorProbe = spawnSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/test-rebate-claim-behavior.ts"],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(
    claimBehaviorProbe.status,
    0,
    claimBehaviorProbe.stderr || claimBehaviorProbe.stdout || claimBehaviorProbe.error?.message,
  );
  assert.match(
    claimBehaviorProbe.stdout,
    /^Safety Pool claim behavior tests passed \(5 groups\)\.\s*$/,
    "Safety Pool claim transaction behavior probe must complete",
  );
  assert.match(
    rebateSource,
    /createClaimConfirmationPendingError[\s\S]*error\.name = "TransactionReceiptTimeoutError"/,
    "Safety Pool confirmation timeout must use the shared ambiguous-pending classification",
  );
  assert.match(
    rebateSource,
    /const confirmClaimBatch = useCallback[\s\S]*waitForClaimTransactionReceiptAgreement\([\s\S]*if \(confirmation === "confirmed"\) return;/,
    "Safety Pool confirmation must require shared quorum and finality before reporting success",
  );
  assert.match(
    rebateSource,
    /if \(message\.startsWith\("transaction reverted"\)\) throw err;/,
    "Safety Pool reverted receipts must be rethrown instead of converted to ambiguous pending",
  );
  assert.doesNotMatch(
    rebateSource,
    /const confirmClaimBatch = useCallback[\s\S]*loadClaimableEpochsExact\(publicClient, sender, intent\.epochs\)/,
    "Safety Pool claim-state reads must not replace receipt quorum/finality confirmation",
  );
  const rebateRouteEpochSafety = readRebateRouteEpochSafetyBehavior();
  assert.deepEqual(
    {
      status: rebateRouteEpochSafety.summary.status,
      cache: rebateRouteEpochSafety.summary.cache,
      participatingEpochs: rebateRouteEpochSafety.summary.body.participatingEpochs,
      totalEpochs: rebateRouteEpochSafety.summary.body.totalEpochs,
    },
    {
      status: 200,
      cache: "miss",
      participatingEpochs: [17],
      totalEpochs: 1,
    },
    "rebates API must publish only safe positive indexed epochs",
  );
  assert.deepEqual(
    {
      status: rebateRouteEpochSafety.summary.status,
      cache: rebateRouteEpochSafety.summary.cache,
      pendingRebateWei: rebateRouteEpochSafety.summary.body.pendingRebateWei,
      claimableEpochCount: rebateRouteEpochSafety.summary.body.claimableEpochCount,
    },
    {
      status: 200,
      cache: "miss",
      pendingRebateWei: "5",
      claimableEpochCount: Number.MAX_SAFE_INTEGER,
    },
    "rebates API must clamp oversized chain claimable-count evidence before publishing a summary",
  );
  assert.deepEqual(
    {
      status: rebateRouteEpochSafety.exactSuccess.status,
      cache: rebateRouteEpochSafety.exactSuccess.cache,
      multicallEpochs: rebateRouteEpochSafety.exactSuccessMulticallEpochs,
      participatingEpochs: rebateRouteEpochSafety.exactSuccess.body.participatingEpochs,
      claimableEpochList: rebateRouteEpochSafety.exactSuccess.body.claimableEpochList,
      recentEpochs: rebateRouteEpochSafety.exactSuccess.body.recentEpochs.map(({ epoch }) => epoch),
    },
    {
      status: 200,
      cache: "miss",
      multicallEpochs: [
        ["17", "9007199254740992"],
        ["17", "9007199254740992"],
      ],
      participatingEpochs: [17, Number.MAX_SAFE_INTEGER + 1],
      claimableEpochList: [17],
      recentEpochs: [17],
    },
    "unsafe poisoned working epochs may remain participating, but exact claimable and recent outputs must defensively exclude them",
  );
  assert.deepEqual(
    {
      status: rebateRouteEpochSafety.exactFallback.status,
      cache: rebateRouteEpochSafety.exactFallback.cache,
      fallbackReadEpochs: rebateRouteEpochSafety.exactFallbackReadEpochs,
      participatingEpochs: rebateRouteEpochSafety.exactFallback.body.participatingEpochs,
      claimableEpochList: rebateRouteEpochSafety.exactFallback.body.claimableEpochList,
      recentEpochs: rebateRouteEpochSafety.exactFallback.body.recentEpochs.map(({ epoch }) => epoch),
    },
    {
      status: 200,
      cache: "miss",
      fallbackReadEpochs: ["17", "9007199254740992"],
      participatingEpochs: [17, Number.MAX_SAFE_INTEGER + 1],
      claimableEpochList: [17],
      recentEpochs: [17],
    },
    "forced exact fallback must read both chain epochs while publishing only safely narrowed claimable and recent epochs",
  );
  assert.deepEqual(
    {
      safeEpoch: rebateRouteEpochSafety.safeEpoch,
      unsafeEpoch: rebateRouteEpochSafety.unsafeEpoch,
      indexedKeys: rebateRouteEpochSafety.indexedKeys,
      watermarkValues: rebateRouteEpochSafety.watermarkValues,
      calls: rebateRouteEpochSafety.calls,
    },
    {
      safeEpoch: 17,
      unsafeEpoch: Number.MAX_SAFE_INTEGER + 1,
      indexedKeys: [
        "0x0000000000000000000000000000000000000001:null:777",
      ],
      watermarkValues: ["null:777", "null:777", "null:777"],
      calls: {
        fetch: 0,
        limiter: 5,
        storageEpochs: 1,
        metaNumber: 6,
        metaBigint: 6,
        logger: 0,
        rpcPoison: 0,
        rpcTotal: 10,
        multicalls: {
          summary: 1,
          "exact-success": 2,
          "exact-fallback": 2,
        },
      },
    },
    "unsafe current epochs must become null cache watermarks and the isolated route probe must stay within bounded storage, RPC, and side-effect seams",
  );
  const rebateRouteRuntimeProbe = spawnSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/test-rebate-route-runtime.ts"],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(
    rebateRouteRuntimeProbe.status,
    0,
    rebateRouteRuntimeProbe.stderr || rebateRouteRuntimeProbe.stdout || rebateRouteRuntimeProbe.error?.message,
  );
  assert.match(
    rebateRouteRuntimeProbe.stdout,
    /^Rebate route runtime behavior tests passed \(4 groups, 3 mutants killed\)\.\s*$/,
    "rebates API watermark and timing behavior probe must complete",
  );
  const publicRouteFailureBehavior = readPublicRouteFailureBehavior();
  assert.deepEqual(
    publicRouteFailureBehavior.rebateRateLimits.options,
    [
      { fixture: "rebates-normal", bucket: "api-rebates", limit: 20, windowMs: 60_000 },
      { fixture: "rebates-exact", bucket: "api-rebates", limit: 20, windowMs: 60_000 },
      { fixture: "rebates-exact", bucket: "api-rebates-exact", limit: 6, windowMs: 60_000 },
    ],
    "expensive exact rebate scans must have a stricter rate limit",
  );
  assert.deepEqual(
    {
      normal: publicRouteFailureBehavior.rebateRateLimits.normal,
      exact: publicRouteFailureBehavior.rebateRateLimits.exact,
    },
    {
      normal: {
        status: 429,
        cacheControl: "no-store, no-cache, must-revalidate",
        rebateCache: null,
        body: { error: "fixture limited" },
        leaked: false,
      },
      exact: {
        status: 429,
        cacheControl: "no-store, no-cache, must-revalidate",
        rebateCache: null,
        body: { error: "fixture limited" },
        leaked: false,
      },
    },
    "Safety Pool rebate rate-limit responses must remain no-store on both normal and exact-scan paths",
  );
  assert.deepEqual(
    publicRouteFailureBehavior.deposits,
    {
      status: 500,
      cacheControl: "no-store, no-cache, must-revalidate",
      rebateCache: null,
      body: { deposits: [], error: "Unable to load deposits" },
      leaked: false,
    },
    "deposits API failures must stay no-store and must not expose raw storage errors",
  );
  assert.deepEqual(
    publicRouteFailureBehavior.rebates,
    {
      status: 500,
      cacheControl: "no-store, no-cache, must-revalidate",
      rebateCache: "miss",
      body: { error: "Unable to load Safety Pool" },
      leaked: false,
    },
    "rebates API failures must stay no-store and must not expose raw storage errors",
  );
  assert.deepEqual(
    publicRouteFailureBehavior.rebateHistory,
    {
      oversized: {
        status: 400,
        cacheControl: "no-store, no-cache, must-revalidate",
        rebateCache: null,
        body: { error: "Invalid limit" },
        leaked: false,
      },
      boundedFailure: {
        status: 503,
        cacheControl: "no-store, no-cache, must-revalidate",
        rebateCache: null,
        body: { error: "Unable to load older Safety Pool history" },
        leaked: false,
      },
      pageOptions: [{ beforeEpoch: null, limit: 64 }],
      multicalls: 1,
      allowFailure: [false],
      logged: 1,
    },
    "older Safety Pool history must stay bounded and fail the whole page instead of skipping unread epochs",
  );
  assert.match(
    smokeHttpSource,
    /name: "rebate-history"[\s\S]*\/api\/rebate-history\?user=/,
    "HTTP smoke must cover the paginated Safety Pool history route",
  );
  assert.deepEqual(
    {
      route: publicRouteFailureBehavior.jackpots,
      calls: publicRouteFailureBehavior.calls,
    },
    {
      route: {
        status: 500,
        cacheControl: "no-store, no-cache, must-revalidate",
        rebateCache: null,
        body: { jackpots: [], error: "Unable to load jackpots" },
        leaked: false,
      },
      calls: {
        depositReads: 1,
        rebateReads: 1,
        jackpotReads: 1,
        networkAccesses: 0,
        limiterBuckets: ["api-deposits", "api-rebates", "api-jackpots"],
        logged: 3,
      },
    },
    "jackpots API failures must stay no-store, hide raw service errors, and exercise every mocked route branch",
  );
}
