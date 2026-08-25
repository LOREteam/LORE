import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as miningSharedModule from "../app/hooks/useMining.shared.ts";
import * as miningBetExecutionModule from "../app/hooks/useMiningBetExecution.ts";
import * as tokenAmountMathModule from "../app/lib/tokenAmountMath.ts";
import * as balanceFormattingModule from "../app/lib/balanceFormatting.ts";
import * as miningTxPathModule from "../app/lib/miningTxPath.ts";
import * as walletTransfersModule from "../app/hooks/useWalletTransfers.ts";
import * as pageWalletOverviewModule from "../app/hooks/usePageWalletOverview.ts";
import * as autoMinerFormModule from "../app/hooks/useAutoMinerForm.ts";
import * as analyticsAchievementsModule from "../app/hooks/useAnalyticsAchievements.ts";
import * as autoResolveStorageModule from "../app/hooks/autoResolveStorage.ts";
import * as appConstantsModule from "../app/lib/constants.ts";

function runWalletTransferExecutableProbe() {
  const probeSource = String.raw`
import { mock } from "node:test";

const root = new URL("./", import.meta.url);
const unwrap = (namespace) => namespace.default ?? namespace;
const ReactModule = await import("react");
const React = ReactModule.default ?? ReactModule;
const { renderToStaticMarkup } = await import("react-dom/server");
const viem = await import("viem");
const constants = unwrap(await import(new URL("./app/lib/constants.ts", root)));
const embedded = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const normalizedEmbedded = embedded.toLowerCase();
const paddedEmbedded = viem.pad(normalizedEmbedded, { size: 32 }).toLowerCase();
const rawValue = 9_007_199_254_740_993_555_000_000_000_000_000n;
const mixedHash = "0x" + "Ab".repeat(32);
const topics = viem.encodeEventTopics({
  abi: constants.TOKEN_ABI,
  eventName: "Transfer",
  args: { from: embedded, to: embedded },
});
const logs = [rawValue, 1n].map((value, logIndex) => ({
  address: constants.LINEA_TOKEN_ADDRESS,
  blockHash: "0x" + "1".repeat(64),
  blockNumber: constants.CONTRACT_DEPLOY_BLOCK,
  data: viem.encodeAbiParameters([{ type: "uint256" }], [value]),
  logIndex,
  removed: false,
  topics,
  transactionHash: mixedHash,
  transactionIndex: 0,
}));
const overCapLogs = Array.from({ length: 501 }, (_, logIndex) => ({
  ...logs[0],
  logIndex,
  transactionHash: "0x" + (logIndex + 10).toString(16).padStart(64, "0"),
}));
const malformedLog = { ...logs[0], data: "0x" };
let blockNumberCalls = 0;
const getLogsRequests = [];
const getLogsResultCounts = [];
let logScenario = "dedupe";
const publicClient = {
  async getBlockNumber() {
    blockNumberCalls += 1;
    return constants.CONTRACT_DEPLOY_BLOCK;
  },
  async getLogs(request) {
    getLogsRequests.push(request);
    let result;
    if (logScenario === "dedupe") {
      result = request.topics.length === 2 ? [logs[0]] : logs;
    } else if (logScenario === "malformed-outgoing") {
      result = request.topics.length === 2 ? [malformedLog] : [];
    } else if (logScenario === "malformed-incoming") {
      result = request.topics.length === 2 ? [] : [malformedLog];
    } else if (logScenario === "over-cap") {
      result = request.topics.length === 2 ? overCapLogs : [];
    } else {
      throw new Error("unexpected wallet-transfer log scenario");
    }
    getLogsResultCounts.push(result.length);
    return result;
  },
};

mock.module("wagmi", {
  namedExports: { usePublicClient: () => publicClient },
});
const walletTransfers = unwrap(await import(
  new URL("./app/hooks/useWalletTransfers.ts?wallet-model-executable-probe", root)
));
const stored = new Map();
let storageWriteCalls = 0;
let fetchCalls = 0;
const priorWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
const priorFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
let probeResult;

Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  writable: true,
  value: async () => {
    fetchCalls += 1;
    throw new Error("unexpected wallet-transfer executable-probe fetch");
  },
});
Object.defineProperty(globalThis, "window", {
  configurable: true,
  writable: true,
  value: {
    localStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => {
        storageWriteCalls += 1;
        stored.set(key, String(value));
      },
      removeItem: (key) => stored.delete(key),
    },
  },
});

try {
  const captureModel = (address, externalAddress) => {
    let model;
    function Probe() {
      model = walletTransfers.useWalletTransfers(address, externalAddress);
      return null;
    }
    renderToStaticMarkup(React.createElement(Probe));
    return model;
  };

  const validModel = captureModel(embedded, null);
  await validModel.fetch();
  const persisted = JSON.parse([...stored.values()][0]);
  const dedupeRequests = getLogsRequests.slice();
  const callsAfterValid = {
    blockNumber: blockNumberCalls,
    logs: getLogsRequests.length,
    writes: storageWriteCalls,
  };
  await captureModel("0xabc", null).fetch();
  await captureModel(embedded, "0xabc").fetch();
  const invalidRpcCalls =
    (blockNumberCalls - callsAfterValid.blockNumber)
    + (getLogsRequests.length - callsAfterValid.logs);
  const invalidStorageWrites = storageWriteCalls - callsAfterValid.writes;

  const runDecodeCoverageScenario = async (scenario, address) => {
    logScenario = scenario;
    stored.clear();
    const resultCountOffset = getLogsResultCounts.length;
    const writesBefore = storageWriteCalls;
    const model = captureModel(address, null);
    await model.fetch();
    const scenarioPersisted = JSON.parse([...stored.values()][0]);
    return {
      returnedLogCounts: getLogsResultCounts.slice(resultCountOffset),
      scanCoverage: scenarioPersisted.scanCoverage,
      transferCount: scenarioPersisted.transfers.length,
      historyRowsTruncated: scenarioPersisted.historyRowsTruncated,
      storageWrites: storageWriteCalls - writesBefore,
    };
  };
  const decodeSkipCoverageResults = [
    await runDecodeCoverageScenario(
      "malformed-outgoing",
      "0x1111111111111111111111111111111111111111",
    ),
    await runDecodeCoverageScenario(
      "malformed-incoming",
      "0x2222222222222222222222222222222222222222",
    ),
  ];
  const liveCapCoverageResult = await runDecodeCoverageScenario(
    "over-cap",
    embedded,
  );

  probeResult = {
    transfers: persisted.transfers,
    totalIn: persisted.totalIn,
    totalOut: persisted.totalOut,
    totalInDisplay: persisted.totalInDisplay,
    totalOutDisplay: persisted.totalOutDisplay,
    scanCoverage: persisted.scanCoverage,
    historyRowsTruncated: persisted.historyRowsTruncated,
    getLogsTopicLengths: dedupeRequests.map((request) => request.topics.length),
    addressTopics: [
      dedupeRequests[0]?.topics[1] ?? null,
      dedupeRequests[1]?.topics[2] ?? null,
    ],
    expectedPaddedAddress: paddedEmbedded,
    invalidRpcCalls,
    invalidStorageWrites,
    decodeSkipCoverageResults,
    liveCapCoverageResult,
    fetchCalls,
  };
} finally {
  if (priorWindowDescriptor === undefined) delete globalThis.window;
  else Object.defineProperty(globalThis, "window", priorWindowDescriptor);
  if (priorFetchDescriptor === undefined) delete globalThis.fetch;
  else Object.defineProperty(globalThis, "fetch", priorFetchDescriptor);
  mock.restoreAll();
}

console.log(JSON.stringify(probeResult));
`;
  const poisonRoot = join(tmpdir(), `lore-wallet-models-${randomUUID()}`);
  const poisonDbPath = join(poisonRoot, "lore.sqlite");
  if (existsSync(poisonRoot) || existsSync(poisonDbPath)) {
    throw new Error("wallet-transfer executable-probe DB poison path must start absent");
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
        LORE_DB_PATH: poisonDbPath,
        TSX_DISABLE_CACHE: "1",
      },
      maxBuffer: 1_000_000,
      timeout: 30_000,
      windowsHide: true,
    },
  );
  if (existsSync(poisonRoot) || existsSync(poisonDbPath)) {
    throw new Error("wallet-transfer executable probe unexpectedly created its DB poison path");
  }
  if (probe.error) {
    throw new Error("wallet-transfer executable probe failed to start", { cause: probe.error });
  }
  if (probe.status !== 0) {
    const detail = `${probe.stderr || ""}\n${probe.stdout || ""}`.trim().slice(-4_000);
    throw new Error(`wallet-transfer executable probe exited ${probe.status}: ${detail}`);
  }
  try {
    return JSON.parse(probe.stdout.trim());
  } catch (error) {
    throw new Error("wallet-transfer executable probe returned invalid JSON", { cause: error });
  }
}

function runWalletHookRuntimeExecutableProbe() {
  const probeSource = String.raw`
import { mock } from "node:test";

const root = new URL("./", import.meta.url);
const unwrap = (namespace) => namespace.default ?? namespace;
let activeCapture = null;

function useState(initial) {
  const capture = activeCapture;
  if (!capture) throw new Error("hook called outside capture");
  const index = capture.stateIndex++;
  capture.states[index] = initial;
  capture.setCalls[index] = [];
  return [initial, (next) => {
    const value = typeof next === "function" ? next(capture.states[index]) : next;
    capture.states[index] = value;
    capture.setCalls[index].push(value);
  }];
}

function useRef(initial) {
  return { current: initial };
}

function useEffect(effect) {
  effect();
}

function useCallback(callback) {
  return callback;
}

function useMemo(factory) {
  return factory();
}

mock.module("react", {
  namedExports: { useCallback, useEffect, useMemo, useRef, useState },
});

let scenario = "full";
const requests = [];
let blockNumberCalls = 0;
let loggerWarnings = 0;
mock.module(new URL("./app/lib/logger.ts", root).href, {
  namedExports: {
    log: {
      debug() {},
      error() {},
      info() {},
      warn() { loggerWarnings += 1; },
    },
  },
});

const constants = unwrap(await import(new URL("./app/lib/constants.ts", root)));
const publicClient = {
  async getBlockNumber() {
    blockNumberCalls += 1;
    return scenario === "fallback-window"
      ? constants.CONTRACT_DEPLOY_BLOCK + 250_000n
      : constants.CONTRACT_DEPLOY_BLOCK;
  },
  async getLogs(request) {
    requests.push({
      scenario,
      topicLength: request.topics.length,
      fromBlock: request.fromBlock.toString(),
    });
    const topicLength = request.topics.length;
    if (scenario === "outgoing-failure" && topicLength === 2) {
      throw new Error("intentional outgoing failure");
    }
    if (scenario === "fallback-window" && topicLength === 3) {
      throw new Error("intentional incoming failure");
    }
    if (scenario === "fallback-chunk-failure" && (topicLength === 3 || topicLength === 1)) {
      throw new Error("intentional fallback failure");
    }
    return [];
  },
};
const rawBalance = { value: 9_007_199_254_740_993_555n, decimals: 3 };

mock.module("wagmi", {
  namedExports: {
    useBalance: () => ({
      data: rawBalance,
      dataUpdatedAt: 1_700_000_000_001,
      isError: false,
      isFetching: false,
      isPending: false,
      isStale: false,
      refetch: async () => {},
    }),
    usePublicClient: () => publicClient,
    useReadContract: () => ({ data: 0n }),
  },
});

const walletTransfers = unwrap(await import(
  new URL("./app/hooks/useWalletTransfers.ts?wallet-model-runtime-probe", root)
));
const pageWalletOverview = unwrap(await import(
  new URL("./app/hooks/usePageWalletOverview.ts?wallet-model-runtime-probe", root)
));
const gameDerivedState = unwrap(await import(
  new URL("./app/hooks/useGameDerivedState.ts?wallet-model-runtime-probe", root)
));
const storage = new Map();
let fetchCalls = 0;
const priorWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
const priorFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
let probeResult;

Object.defineProperty(globalThis, "window", {
  configurable: true,
  writable: true,
  value: {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
  },
});
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  writable: true,
  value: async () => {
    fetchCalls += 1;
    throw new Error("unexpected wallet-model runtime-probe fetch");
  },
});

try {
  const address = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
  const captureWalletTransferScenario = async (nextScenario) => {
    scenario = nextScenario;
    storage.clear();
    const requestOffset = requests.length;
    const capture = { stateIndex: 0, states: [], setCalls: [] };
    activeCapture = capture;
    const model = walletTransfers.useWalletTransfers(address, null);
    activeCapture = null;
    await model.fetch();
    const liveSummary = capture.setCalls[1].at(-1);
    if (!liveSummary) throw new Error("wallet transfer scenario did not publish a live summary");
    return {
      dataStatus: liveSummary.dataStatus,
      scanCoverage: liveSummary.scanCoverage,
      requestRows: requests.slice(requestOffset),
    };
  };

  const full = await captureWalletTransferScenario("full");
  const outgoingFailure = await captureWalletTransferScenario("outgoing-failure");
  const fallbackWindow = await captureWalletTransferScenario("fallback-window");
  const fallbackChunkFailure = await captureWalletTransferScenario("fallback-chunk-failure");

  activeCapture = { stateIndex: 0, states: [], setCalls: [] };
  const overview = pageWalletOverview.usePageWalletOverview({
    address: address.toLowerCase(),
    normalizedEmbeddedAddress: address.toLowerCase(),
    formattedLineaBalance: null,
    embeddedTokenBalance: rawBalance,
    embeddedTokenPending: false,
    embeddedTokenStatus: {
      error: false,
      fetching: false,
      stale: false,
      updatedAt: 1_700_000_000_000,
    },
    refetchEmbeddedTokenBalance: async () => {},
    isPageVisible: false,
  });

  const balanceText = "9007199254740993.555";
  activeCapture = { stateIndex: 0, states: [], setCalls: [] };
  const derived = gameDerivedState.useGameDerivedState({
    chainId: constants.APP_CHAIN_ID,
    effectiveJackpotInfoRaw: null,
    effectiveRolloverPoolRaw: 0n,
    effectiveTileData: null,
    tokenBalanceFormatted: balanceText,
    isRevealing: false,
    effectiveGridEpochData: null,
    gridDisplayEpochBigInt: null,
    walletAddress: undefined,
    isPageVisible: false,
    tileUserCounts: [],
    userBetsAll: undefined,
    effectiveEpochDurationSec: null,
    effectivePendingEpochDuration: null,
    effectivePendingEpochDurationEta: null,
    effectivePendingEpochDurationEffectiveFromEpoch: null,
  });
  activeCapture = null;

  const fallbackFromBlock = fallbackWindow.requestRows.find((row) => row.topicLength === 1)?.fromBlock ?? null;
  probeResult = {
    full: {
      dataStatus: full.dataStatus,
      scanCoverage: full.scanCoverage,
    },
    outgoingFailure: {
      dataStatus: outgoingFailure.dataStatus,
      scanCoverage: outgoingFailure.scanCoverage,
      outgoingFailures: outgoingFailure.requestRows.filter((row) => row.topicLength === 2).length,
    },
    fallbackWindow: {
      dataStatus: fallbackWindow.dataStatus,
      scanCoverage: fallbackWindow.scanCoverage,
      startedAfterFullRange: fallbackFromBlock !== null
        && BigInt(fallbackFromBlock) > constants.CONTRACT_DEPLOY_BLOCK,
    },
    fallbackChunkFailure: {
      dataStatus: fallbackChunkFailure.dataStatus,
      scanCoverage: fallbackChunkFailure.scanCoverage,
      fallbackCalls: fallbackChunkFailure.requestRows.filter((row) => row.topicLength === 1).length,
    },
    pageWalletBalances: {
      token: overview.formattedPrivyBalance,
      eth: overview.formattedPrivyEthBalance,
      headerLinea: overview.headerLineaBalance,
    },
    numericCoercionPageBalances: {
      token: Number(balanceText).toFixed(2),
      eth: Number(balanceText).toFixed(4),
    },
    gameLineaBalance: derived.formattedLineaBalance,
    numericCoercionGameLineaBalance: Number(balanceText).toFixed(2),
    fetchCalls,
    blockNumberCalls,
    loggerWarnings,
  };
} finally {
  activeCapture = null;
  if (priorWindowDescriptor === undefined) delete globalThis.window;
  else Object.defineProperty(globalThis, "window", priorWindowDescriptor);
  if (priorFetchDescriptor === undefined) delete globalThis.fetch;
  else Object.defineProperty(globalThis, "fetch", priorFetchDescriptor);
  mock.restoreAll();
}

console.log(JSON.stringify(probeResult));
`;
  const poisonRoot = join(tmpdir(), `lore-wallet-model-runtime-${randomUUID()}`);
  const poisonDbPath = join(poisonRoot, "lore.sqlite");
  if (existsSync(poisonRoot) || existsSync(poisonDbPath)) {
    throw new Error("wallet-model runtime-probe DB poison path must start absent");
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
        LORE_DB_PATH: poisonDbPath,
        TSX_DISABLE_CACHE: "1",
      },
      maxBuffer: 1_000_000,
      timeout: 30_000,
      windowsHide: true,
    },
  );
  if (existsSync(poisonRoot) || existsSync(poisonDbPath)) {
    throw new Error("wallet-model runtime probe unexpectedly created its DB poison path");
  }
  if (probe.error) {
    throw new Error("wallet-model runtime probe failed to start", { cause: probe.error });
  }
  if (probe.status !== 0) {
    const detail = `${probe.stderr || ""}\n${probe.stdout || ""}`.trim().slice(-4_000);
    throw new Error(`wallet-model runtime probe exited ${probe.status}: ${detail}`);
  }
  try {
    return JSON.parse(probe.stdout.trim());
  } catch (error) {
    throw new Error("wallet-model runtime probe returned invalid JSON", { cause: error });
  }
}

export async function runWalletModelTests() {
  const miningShared = miningSharedModule.default ?? miningSharedModule;
  const miningBetExecution = miningBetExecutionModule.default ?? miningBetExecutionModule;
  const tokenAmountMath = tokenAmountMathModule.default ?? tokenAmountMathModule;
  const balanceFormatting = balanceFormattingModule.default ?? balanceFormattingModule;
  const miningTxPath = miningTxPathModule.default ?? miningTxPathModule;
  const walletTransfers = walletTransfersModule.default ?? walletTransfersModule;
  const pageWalletOverview = pageWalletOverviewModule.default ?? pageWalletOverviewModule;
  const autoMinerForm = autoMinerFormModule.default ?? autoMinerFormModule;
  const analyticsAchievements = analyticsAchievementsModule.default ?? analyticsAchievementsModule;
  const autoResolveStorage = autoResolveStorageModule.default ?? autoResolveStorageModule;
  const appConstants = appConstantsModule.default ?? appConstantsModule;
  const normalizedDuplicateTiles = tokenAmountMath.normalizeTileAmounts(
    [2, 2, 5],
    ["1000000000000000.123456789123456789", "0.876543210876543211", "1"],
    "1000000000000002",
  );
  assert.deepEqual(normalizedDuplicateTiles, {
    tileIds: [2, 5],
    amounts: ["1000000000000001", "1"],
  });
  assert.equal(
    tokenAmountMath.computeWinningAmountWei(
      [1, 2, 3],
      undefined,
      2,
      "3000000000000000.000000000000000003",
    ),
    1_000_000_000_000_000_000_000_000_000_000_000n + 1n,
  );
  assert.equal(
    tokenAmountMath.computeWinningAmountWei([1, 2, 2], ["1", "2", "3"], 2, "999"),
    5_000_000_000_000_000_000n,
  );
  assert.equal(tokenAmountMath.parseLineaAmountWei("not-a-number"), 0n);
  assert.equal(tokenAmountMath.parsePositiveLineaAmountWei("0"), null);
  assert.equal(tokenAmountMath.parsePositiveLineaAmountWei("0.0000000000000000001"), null);
  assert.equal(tokenAmountMath.parsePositiveLineaAmountWei("1.25"), 1_250_000_000_000_000_000n);
  assert.equal(tokenAmountMath.parsePositiveLineaAmountWeiOrFallback("bad", "1"), 1_000_000_000_000_000_000n);
  assert.equal(tokenAmountMath.parsePositiveLineaAmountWeiOrFallback("0", "1"), 1_000_000_000_000_000_000n);
  assert.equal(tokenAmountMath.parsePositiveLineaAmountWeiOrFallback("2.5", "1"), 2_500_000_000_000_000_000n);
  assert.equal(tokenAmountMath.formatLineaWeiAmountDisplay("bad", 4), "0.0000");
  assert.equal(tokenAmountMath.formatLineaWeiAmountDisplay("1000000000000000000", 2), "1.00");
  assert.equal(tokenAmountMath.formatLineaWeiAmountDisplay("2500000000000000000", 1), "2.5");
  assert.equal(tokenAmountMath.formatLineaWeiAmountDisplay("1234567890000000000000", 2), "1,234.57");
  assert.equal(tokenAmountMath.formatLineaWeiAmountDisplay("1234567890123456789012345678900000000000000000", 0), "1,234,567,890,123,456,789,012,345,679");
  assert.equal(tokenAmountMath.formatLineaWeiDisplayNumber(1_234_567_899_000_000_000n), 1.234568);
  assert.equal(tokenAmountMath.formatLineaWeiDisplayNumber(1_234_567_499_000_000_000n), 1.234567);
  assert.equal(tokenAmountMath.formatLineaWeiDisplayNumber(-1n), 0);
  assert.equal(
    tokenAmountMath.formatLineaWeiDisplayNumber((BigInt(Number.MAX_SAFE_INTEGER) + 1n) * 1_000_000_000_000n),
    Number.MAX_SAFE_INTEGER,
  );
  assert.equal(tokenAmountMath.formatLineaAmountFixed(1_234_567_899_000_000_000n, 2), "1.23");
  assert.equal(tokenAmountMath.formatLineaAmountFixed(1_235_000_000_000_000_000n, 2), "1.24");
  assert.equal(tokenAmountMath.formatLineaAmountFixed(999_999_999_999_999_999n, 0), "1");
  assert.deepEqual(
    miningTxPath.sanitizeMiningTxPathState({ mode: "standard-silent", reason: "ok", ts: 123 }, 1_000),
    { mode: "standard-silent", reason: "ok", ts: 123 },
  );
  assert.deepEqual(
    miningTxPath.sanitizeMiningTxPathState({ mode: "wallet-write", reason: 999, ts: 123 }, 1_000),
    { mode: "wallet-write", ts: 123 },
  );
  assert.equal(miningTxPath.sanitizeMiningTxPathState({ mode: "bad", ts: 123 }, 1_000), null);
  assert.equal(miningTxPath.sanitizeMiningTxPathState({ mode: "standard-silent", ts: Number.NaN }, 1_000), null);
  assert.equal(miningTxPath.sanitizeMiningTxPathState({ mode: "standard-silent", ts: 123.5 }, 1_000), null);
  assert.equal(
    miningTxPath.sanitizeMiningTxPathState({ mode: "standard-silent", ts: Number.MAX_SAFE_INTEGER + 1 }, 1_000),
    null,
  );
  assert.equal(miningTxPath.sanitizeMiningTxPathState({ mode: "standard-silent", ts: 1_000 }, 1_000.5), null);
  assert.equal(miningTxPath.sanitizeMiningTxPathState({ mode: "standard-silent", ts: 7_001 }, 1_000), null);
  assert.deepEqual(
    [
      miningTxPath.sanitizeMiningTxPathState({ mode: "wallet-write", ts: 6_000 }, 1_000),
      miningTxPath.sanitizeMiningTxPathState({ mode: "wallet-write", ts: 6_001 }, 1_000),
    ],
    [{ mode: "wallet-write", ts: 6_000 }, null],
    "mining tx path timestamps must accept only the bounded safe-integer future skew",
  );
  const pendingMiningState = miningTxPath.sanitizePendingMiningTxState({
    chainId: 59141,
    contract: "0x1111111111111111111111111111111111111111",
    actor: "0x2222222222222222222222222222222222222222",
    hash: `0x${"a".repeat(64)}`,
    ts: 1_000,
  }, 2_000);
  assert.ok(pendingMiningState);
  let legacyRecoveryRpcCalls = 0;
  const legacyRecoveryClient = {
    getTransactionReceipt: async () => {
      legacyRecoveryRpcCalls += 1;
      throw new Error("legacy state must not reach receipt recovery");
    },
    getTransaction: async () => {
      legacyRecoveryRpcCalls += 1;
      throw new Error("legacy state must not reach transaction recovery");
    },
  };
  assert.equal(
    await miningTxPath.recoverPendingMiningTx([legacyRecoveryClient, legacyRecoveryClient], pendingMiningState),
    "manual-reconciliation-required",
    "legacy hash-only mining state must never be treated as proof of the submitted intent",
  );
  assert.equal(legacyRecoveryRpcCalls, 0, "legacy mining state must fail closed before any RPC read");
  const ambiguousPendingMiningState = miningTxPath.sanitizePendingMiningTxState({
    chainId: 59141,
    contract: "0x1111111111111111111111111111111111111111",
    actor: "0x2222222222222222222222222222222222222222",
    nonce: 7,
    ts: 1_000,
  }, 2_000);
  assert.ok(ambiguousPendingMiningState);
  assert.equal(
    miningShared.isAmbiguousPendingTxError(new Error("External wallet eth_sendTransaction timed out after 45000ms")),
    true,
  );
  const silentWalletTimeout = new Error("Privy sendTransaction timed out after 45000ms");
  silentWalletTimeout.name = "WalletSendTimeoutError";
  assert.equal(
    miningShared.isAmbiguousPendingTxError(silentWalletTimeout),
    true,
    "a hashless Privy send timeout must stay pending instead of falling back to a duplicate wallet send",
  );
  assert.equal(
    miningShared.isAmbiguousPendingTxError(new Error("RPC read timed out after 45000ms")),
    false,
  );
  let miningBetExecutionProbe = null;
  let ensurePreferredWalletCalls = 0;
  const ambiguousSilentSendError = new Error("Privy sendTransaction timed out after 45000ms");
  ambiguousSilentSendError.name = "WalletSendTimeoutError";
  const unexpectedMiningBetCall = async () => {
    throw new Error("ambiguous silent-send probe reached an unexpected downstream call");
  };
  function MiningBetExecutionProbe() {
    miningBetExecutionProbe = miningBetExecution.useMiningBetExecution({
      assertNativeGasBalance: unexpectedMiningBetCall,
      assertSufficientAllowance: unexpectedMiningBetCall,
      ensureAllowance: unexpectedMiningBetCall,
      ensureContractPreflight: unexpectedMiningBetCall,
      estimateGas: unexpectedMiningBetCall,
      getBumpedFees: unexpectedMiningBetCall,
      getActorAddress: () => null,
      waitReceipt: unexpectedMiningBetCall,
      readPublicClient: () => undefined,
      readSilentSend: () => async () => `0x${"a".repeat(64)}`,
      readWriteContractAsync: () => unexpectedMiningBetCall,
      ensurePreferredWallet: async () => {
        ensurePreferredWalletCalls += 1;
        throw ambiguousSilentSendError;
      },
    });
    return null;
  }
  renderToStaticMarkup(React.createElement(MiningBetExecutionProbe));
  let caughtSilentSendError = null;
  try {
    await miningBetExecutionProbe.placeBetsPreferSilent([1], 1n);
  } catch (error) {
    caughtSilentSendError = error;
  }
  assert.deepEqual(
    {
      rethrewOriginalError: caughtSilentSendError === ambiguousSilentSendError,
      ensurePreferredWalletCalls,
    },
    { rethrewOriginalError: true, ensurePreferredWalletCalls: 1 },
    "manual silent receipt timeouts must not fall back to a duplicate wallet send",
  );
  const hashlessRecoveryClients = (client) => [client, client];
  assert.equal(
    await miningTxPath.recoverPendingMiningTx(hashlessRecoveryClients({
      getTransactionReceipt: async () => { throw new Error("hashless state must not request a receipt"); },
      getTransaction: async () => { throw new Error("hashless state must not request a transaction"); },
      getTransactionCount: async ({ blockTag }) => blockTag === "latest" ? 8 : 8,
    }), ambiguousPendingMiningState),
    "manual-reconciliation-required",
    "a consumed nonce without a transaction hash must retain the duplicate-send block for manual reconciliation",
  );
  assert.equal(
    await miningTxPath.recoverPendingMiningTx(hashlessRecoveryClients({
      getTransactionReceipt: async () => { throw new Error("hashless state must not request a receipt"); },
      getTransaction: async () => { throw new Error("hashless state must not request a transaction"); },
      getTransactionCount: async ({ blockTag }) => blockTag === "latest" ? 7 : 8,
    }), ambiguousPendingMiningState),
    "pending",
  );
  assert.equal(
    await miningTxPath.recoverPendingMiningTx(hashlessRecoveryClients({
      getTransactionReceipt: async () => { throw new Error("hashless state must not request a receipt"); },
      getTransaction: async () => { throw new Error("hashless state must not request a transaction"); },
      getTransactionCount: async () => 7,
    }), ambiguousPendingMiningState, ambiguousPendingMiningState.ts + 15 * 60_000),
    "manual-reconciliation-required",
  );
  assert.equal(
    await miningTxPath.recoverPendingMiningTx(hashlessRecoveryClients({
      getTransactionReceipt: async () => { throw new Error("hashless state must not request a receipt"); },
      getTransaction: async () => { throw new Error("hashless state must not request a transaction"); },
      getTransactionCount: async () => 7,
    }), ambiguousPendingMiningState, ambiguousPendingMiningState.ts + 15 * 60_000 - 1),
    "pending",
    "hashless pending recovery must remain locked until the exact not-found grace boundary",
  );
  assert.equal(
    await miningTxPath.recoverPendingMiningTx(hashlessRecoveryClients({
      getTransactionReceipt: async () => { throw new Error("hashless state must not request a receipt"); },
      getTransaction: async () => { throw new Error("hashless state must not request a transaction"); },
      getTransactionCount: async () => 7,
    }), ambiguousPendingMiningState, ambiguousPendingMiningState.ts - 1),
    "pending",
    "future-dated hashless pending tx state must not clear before caller time catches up",
  );
  assert.equal(
    await miningTxPath.recoverPendingMiningTx(hashlessRecoveryClients({
      getTransactionReceipt: async () => { throw new Error("malformed hashless nonce recovery must not request a receipt"); },
      getTransaction: async () => { throw new Error("malformed hashless nonce recovery must not request a transaction"); },
      getTransactionCount: async ({ blockTag }) => blockTag === "latest" ? "7" : 7,
    }), ambiguousPendingMiningState, ambiguousPendingMiningState.ts + 15 * 60_000),
    "pending",
    "malformed hashless nonce evidence must keep pending tx recovery fail-closed",
  );
  assert.equal(
    await miningTxPath.recoverPendingMiningTx(hashlessRecoveryClients({
      getTransactionReceipt: async () => { throw new Error("inverted hashless nonce recovery must not request a receipt"); },
      getTransaction: async () => { throw new Error("inverted hashless nonce recovery must not request a transaction"); },
      getTransactionCount: async ({ blockTag }) => blockTag === "latest" ? 9 : 8,
    }), ambiguousPendingMiningState, ambiguousPendingMiningState.ts + 15 * 60_000),
    "pending",
    "hashless nonce recovery must fail closed when pending nonce evidence is behind latest",
  );
  const disagreeingNonceRecovery = await miningTxPath.recoverPendingMiningTx([
    {
      getTransactionReceipt: async () => { throw new Error("hashless state must not request a receipt"); },
      getTransaction: async () => { throw new Error("hashless state must not request a transaction"); },
      getTransactionCount: async () => 7,
    },
    {
      getTransactionReceipt: async () => { throw new Error("hashless state must not request a receipt"); },
      getTransaction: async () => { throw new Error("hashless state must not request a transaction"); },
      getTransactionCount: async ({ blockTag }) => blockTag === "latest" ? 7 : 8,
    },
  ], ambiguousPendingMiningState, ambiguousPendingMiningState.ts + 1);
  const bigintNonceApprovalState = {
    chainId: 59141,
    token: "0x1111111111111111111111111111111111111111",
    spender: "0x2222222222222222222222222222222222222222",
    actor: "0x3333333333333333333333333333333333333333",
    nonce: BigInt(Number.MAX_SAFE_INTEGER),
    ts: 1_000,
  };
  assert.deepEqual(
    {
      maxSafeBigintNonce: miningTxPath.sanitizePendingMiningApprovalState(bigintNonceApprovalState, 2_000)?.nonce,
      oversizedBigintNonce: miningTxPath.sanitizePendingMiningApprovalState({
        ...bigintNonceApprovalState,
        nonce: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
      }, 2_000),
      disagreeingNonceRecovery,
    },
    {
      maxSafeBigintNonce: Number.MAX_SAFE_INTEGER,
      oversizedBigintNonce: null,
      disagreeingNonceRecovery: "manual-reconciliation-required",
    },
    "hashless pending recovery must normalize bounded nonces and require two-RPC agreement",
  );
  assert.equal(miningTxPath.sanitizePendingMiningTxState({ ...pendingMiningState, chainId: 0 }), null);
  assert.equal(miningTxPath.sanitizePendingMiningTxState({ ...pendingMiningState, actor: "0x1234" }), null);
  assert.equal(miningTxPath.sanitizePendingMiningTxState({ ...pendingMiningState, hash: "0x1234" }), null);
  assert.equal(
    miningTxPath.sanitizePendingMiningTxState({ ...ambiguousPendingMiningState, hash: "0x1234" }),
    null,
    "pending tx recovery must reject malformed hashes even when a nonce fallback is present",
  );
  assert.equal(
    miningTxPath.sanitizePendingMiningTxState({ ...pendingMiningState, nonce: -1 }),
    null,
    "pending tx recovery must reject malformed nonces even when a hash is present",
  );
  assert.equal(miningTxPath.sanitizePendingMiningTxState({ ...pendingMiningState, ts: 1_000.5 }, 2_000), null);
  assert.equal(
    miningTxPath.sanitizePendingMiningTxState({ ...pendingMiningState, ts: Number.MAX_SAFE_INTEGER + 1 }, 2_000),
    null,
  );
  assert.equal(miningTxPath.sanitizePendingMiningTxState({ ...pendingMiningState, ts: 1_000 }, 2_000.5), null);
  assert.equal(miningTxPath.sanitizePendingMiningTxState({ ...pendingMiningState, ts: 8_001 }, 2_000), null);
  const completePendingMiningState = miningTxPath.sanitizePendingMiningTxState({
    chainId: 59141,
    contract: "0x1111111111111111111111111111111111111111",
    actor: "0x2222222222222222222222222222222222222222",
    hash: `0x${"a".repeat(64)}`,
    nonce: 7,
    calldata: "0x1234",
    expectedEpoch: "42",
    tileIds: [1],
    amountRawPerTile: "5",
    baselineBets: Array(25).fill("0"),
    ts: 1_000,
  }, 2_000);
  assert.ok(completePendingMiningState);
  const receipt = {
    status: "success",
    transactionHash: completePendingMiningState.hash,
    blockHash: `0x${"b".repeat(64)}`,
    blockNumber: 10n,
    transactionIndex: 0,
  };
  const createRecoveryClient = (clientReceipt = receipt, bets = [5n, ...Array(24).fill(0n)]) => ({
    getTransactionReceipt: async () => clientReceipt,
    getTransaction: async () => ({
      hash: completePendingMiningState.hash,
      from: completePendingMiningState.actor,
      to: completePendingMiningState.contract,
      type: "eip1559",
      nonce: completePendingMiningState.nonce,
      input: completePendingMiningState.calldata,
      blockHash: clientReceipt.blockHash,
      blockNumber: clientReceipt.blockNumber,
      transactionIndex: clientReceipt.transactionIndex,
    }),
    getTransactionCount: async () => 8,
    getChainId: async () => 59141,
    getBlockNumber: async () => 12n,
    getBlock: async () => ({ hash: clientReceipt.blockHash }),
    readContract: async () => bets,
  });
  const agreeingRecoveryClient = createRecoveryClient();
  assert.equal(
    await miningTxPath.recoverPendingMiningTx([agreeingRecoveryClient, agreeingRecoveryClient], completePendingMiningState, 2_000, 2n),
    "confirmed",
    "complete intent requires two matching final receipts and its expected bet delta before confirmation",
  );
  const mismatchedReceipt = { ...receipt, blockHash: `0x${"c".repeat(64)}` };
  assert.equal(
    await miningTxPath.recoverPendingMiningTx(
      [createRecoveryClient(), createRecoveryClient(mismatchedReceipt)],
      completePendingMiningState,
      2_000,
      2n,
    ),
    "manual-reconciliation-required",
    "receipt disagreement must keep a pending mining intent fail-closed",
  );
  const revertedReceipt = { ...receipt, status: "reverted" };
  const revertedRecoveryClient = createRecoveryClient(revertedReceipt);
  assert.equal(
    await miningTxPath.recoverPendingMiningTx(
      [revertedRecoveryClient, revertedRecoveryClient],
      completePendingMiningState,
      2_000,
      2n,
    ),
    "clear",
    "a matching finalized reverted receipt clears the pending mining intent",
  );
  const unsafeHashlessRecoveryResults = await Promise.all([
    miningTxPath.recoverPendingMiningTx(hashlessRecoveryClients({
      getTransactionReceipt: async () => { throw new Error("hashless state must not request a receipt"); },
      getTransaction: async () => { throw new Error("hashless state must not request a transaction"); },
      getTransactionCount: async () => Number.MAX_SAFE_INTEGER + 1,
    }), ambiguousPendingMiningState, ambiguousPendingMiningState.ts + 15 * 60_000),
    miningTxPath.recoverPendingMiningTx(hashlessRecoveryClients({
      getTransactionReceipt: async () => { throw new Error("hashless state must not request a receipt"); },
      getTransaction: async () => { throw new Error("hashless state must not request a transaction"); },
      getTransactionCount: async () => 7,
    }), ambiguousPendingMiningState, Number.MAX_SAFE_INTEGER + 1),
  ]);
  assert.deepEqual(
    unsafeHashlessRecoveryResults,
    ["pending", "pending"],
    "hashless pending recovery must fail closed on unsafe nonce or caller-time evidence",
  );
  assert.match(
    readFileSync("app/hooks/usePrivyWallet.ts", "utf8"),
    /function normalizeWalletAddress[\s\S]*getAddress\(value\)[\s\S]*normalizeWalletAddress\(embeddedWallet\.address\)/,
    "Privy wallet selection must normalize embedded and external wallet addresses before comparison",
  );
  const secondaryActor = "0x3333333333333333333333333333333333333333";
  const priorWindow = globalThis.window;
  const pendingStorage = new Map();
  try {
    globalThis.window = {
      dispatchEvent: () => true,
      localStorage: {
        getItem: (key) => pendingStorage.get(key) ?? null,
        removeItem: (key) => pendingStorage.delete(key),
        setItem: (key, value) => pendingStorage.set(key, value),
      },
    };
    miningTxPath.writeMiningTxPathState("wallet-write", "test");
    assert.ok(miningTxPath.readMiningTxPathState());
    pendingStorage.set("lineaore:mining-tx-path:v1", "{bad json");
    assert.equal(miningTxPath.readMiningTxPathState(), null);
    assert.equal(pendingStorage.has("lineaore:mining-tx-path:v1"), false, "corrupt mining tx path state must be cleared");
    assert.equal(
      miningTxPath.readPendingMiningTxState(pendingMiningState.chainId, pendingMiningState.contract, "0x1234"),
      null,
      "pending tx recovery reads with malformed actors must fail closed without throwing",
    );
    assert.equal(
      miningTxPath.readPendingMiningTxState(pendingMiningState.chainId, "0x1234", pendingMiningState.actor),
      null,
      "pending tx recovery reads with malformed contracts must fail closed without throwing",
    );
    const sentinelPendingWrite = miningTxPath.writePendingMiningTxState({
      chainId: pendingMiningState.chainId,
      contract: pendingMiningState.contract,
      actor: pendingMiningState.actor,
      hash: pendingMiningState.hash,
    });
    const sentinelPendingKey = [...pendingStorage.keys()].find((key) => key.startsWith("lineaore:pending-mining-tx:v2:"));
    const sentinelStorageSize = pendingStorage.size;
    const sentinelRawValue = sentinelPendingKey ? pendingStorage.get(sentinelPendingKey) : undefined;
    const malformedActorClear = miningTxPath.clearPendingMiningTxState(
      pendingMiningState.chainId,
      pendingMiningState.contract,
      "0x1234",
    );
    const malformedContractClear = miningTxPath.clearPendingMiningTxState(
      pendingMiningState.chainId,
      "0x1234",
      pendingMiningState.actor,
    );
    const competingScopeWrite = miningTxPath.writePendingMiningTxState({
      chainId: pendingMiningState.chainId,
      contract: "0x4444444444444444444444444444444444444444",
      actor: pendingMiningState.actor,
      hash: pendingMiningState.hash,
    });
    const sentinelReadAfterMalformedClear = miningTxPath.readPendingMiningTxState(
      pendingMiningState.chainId,
      pendingMiningState.contract,
      pendingMiningState.actor,
    );
    const sentinelStorageUntouched = Boolean(
      sentinelPendingKey
      && pendingStorage.size === sentinelStorageSize
      && pendingStorage.get(sentinelPendingKey) === sentinelRawValue,
    );
    const sentinelPendingClear = miningTxPath.clearPendingMiningTxState(
      pendingMiningState.chainId,
      pendingMiningState.contract,
      pendingMiningState.actor,
    );
    assert.deepEqual(
      {
        written: sentinelPendingWrite,
        malformedActorClear,
        malformedContractClear,
        competingScopeWrite,
        storageUntouched: sentinelStorageUntouched,
        readHash: sentinelReadAfterMalformedClear?.hash,
        cleared: sentinelPendingClear,
        clearedRead: miningTxPath.readPendingMiningTxState(
          pendingMiningState.chainId,
          pendingMiningState.contract,
          pendingMiningState.actor,
        ),
      },
      {
        written: true,
        malformedActorClear: false,
        malformedContractClear: false,
        competingScopeWrite: false,
        storageUntouched: true,
        readHash: pendingMiningState.hash,
        cleared: true,
        clearedRead: null,
      },
      "malformed pending tx cleanup must fail closed without mutating another scoped latch",
    );
    const normalizedPendingContract = "0x52908400098527886E0F7030069857D2E4169EE7";
    const normalizedPendingActor = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    const normalizedPendingHash = `0x${"c".repeat(64)}`;
    const normalizedPendingWrite = miningTxPath.writePendingMiningTxState({
      chainId: 59143,
      contract: normalizedPendingContract,
      actor: normalizedPendingActor,
      hash: normalizedPendingHash,
    });
    const normalizedPendingRead = miningTxPath.readPendingMiningTxState(
      59143,
      normalizedPendingContract.toLowerCase(),
      normalizedPendingActor.toLowerCase(),
    );
    const normalizedPendingClear = miningTxPath.clearPendingMiningTxState(
      59143,
      normalizedPendingContract.toLowerCase(),
      normalizedPendingActor.toLowerCase(),
    );
    assert.deepEqual(
      {
        written: normalizedPendingWrite,
        readHash: normalizedPendingRead?.hash,
        cleared: normalizedPendingClear,
        clearedRead: miningTxPath.readPendingMiningTxState(59143, normalizedPendingContract, normalizedPendingActor),
      },
      {
        written: true,
        readHash: normalizedPendingHash,
        cleared: true,
        clearedRead: null,
      },
      "pending mining tx storage must normalize contract and actor addresses across write, read, and clear",
    );
    miningTxPath.writePendingMiningTxState({
      chainId: pendingMiningState.chainId,
      contract: pendingMiningState.contract,
      actor: pendingMiningState.actor,
      hash: pendingMiningState.hash,
    });
    const firstPendingKey = [...pendingStorage.keys()].find((key) => key.startsWith("lineaore:pending-mining-tx:v2:"));
    assert.ok(firstPendingKey);
    const recoveredLegacyState = miningTxPath.readPendingMiningTxState(
      pendingMiningState.chainId,
      pendingMiningState.contract,
      pendingMiningState.actor,
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(recoveredLegacyState)),
      { ...pendingMiningState, ts: [...pendingStorage.values()].map((raw) => JSON.parse(raw).ts)[0] },
    );
    pendingStorage.set(firstPendingKey, "{bad json");
    assert.ok(
      miningTxPath.readPendingMiningTxState(pendingMiningState.chainId, pendingMiningState.contract, pendingMiningState.actor),
      "an in-flight actor latch must remain fail-closed when its backing storage is corrupted",
    );
    assert.equal(pendingStorage.has(firstPendingKey), true, "corrupt backing state must not silently unlock an active submission");
    miningTxPath.writePendingMiningTxState({
      chainId: pendingMiningState.chainId,
      contract: pendingMiningState.contract,
      actor: pendingMiningState.actor,
      hash: pendingMiningState.hash,
    });
    assert.equal(miningTxPath.readPendingMiningTxState(59144, pendingMiningState.contract, pendingMiningState.actor), null);
    assert.equal(
      miningTxPath.readPendingMiningTxState(
        pendingMiningState.chainId,
        pendingMiningState.contract,
        secondaryActor,
      ),
      null,
    );
    miningTxPath.writePendingMiningTxState({
      chainId: pendingMiningState.chainId,
      contract: pendingMiningState.contract,
      actor: secondaryActor,
      hash: `0x${"b".repeat(64)}`,
    });
    assert.equal(pendingStorage.size, 2, "different actors must keep independent pending recovery records");
    miningTxPath.clearPendingMiningTxState(
      pendingMiningState.chainId,
      pendingMiningState.contract,
      pendingMiningState.actor,
    );
    assert.equal(
      miningTxPath.readPendingMiningTxState(pendingMiningState.chainId, pendingMiningState.contract, pendingMiningState.actor),
      null,
    );
    assert.ok(
      miningTxPath.readPendingMiningTxState(
        pendingMiningState.chainId,
        pendingMiningState.contract,
        secondaryActor,
      ),
      "clearing one actor must preserve another actor's pending record",
    );
  } finally {
    miningTxPath.clearPendingMiningTxState(
      pendingMiningState.chainId,
      pendingMiningState.contract,
      pendingMiningState.actor,
    );
    miningTxPath.clearPendingMiningTxState(
      pendingMiningState.chainId,
      pendingMiningState.contract,
      secondaryActor,
    );
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
  assert.equal(walletTransfers.getWalletTransferScanFromBlock(10n, 1n), 1n);
  assert.equal(walletTransfers.getWalletTransferScanFromBlock(10n, 7n), 7n);
  assert.equal(walletTransfers.getWalletTransferScanFromBlock(10n, 11n), null);
  assert.equal(walletTransfers.getWalletTransferFallbackFromBlock(1n, 100n, 250n), 1n);
  assert.equal(walletTransfers.getWalletTransferFallbackFromBlock(1n, 1000n, 250n), 751n);
  assert.equal(
    walletTransfers.getWalletTransferLogKey({
      transactionHash: "0xabc",
      blockNumber: 10n,
      transactionIndex: 1,
      logIndex: 2,
    }),
    walletTransfers.getWalletTransferLogKey({
      transactionHash: "0xabc",
      blockNumber: 10n,
      transactionIndex: 1,
      logIndex: 2,
    }),
    "wallet transfer dedupe keys must be stable for the same event log",
  );
  assert.notEqual(
    walletTransfers.getWalletTransferLogKey({
      transactionHash: "0xabc",
      blockNumber: 10n,
      transactionIndex: 1,
      logIndex: 2,
    }),
    walletTransfers.getWalletTransferLogKey({
      transactionHash: "0xabc",
      blockNumber: 10n,
      transactionIndex: 1,
      logIndex: 3,
    }),
    "wallet transfer history must not collapse distinct logs from the same transaction",
  );
  assert.equal(walletTransfers.normalizeWalletTransferTxHash("0xabc"), "");
  assert.equal(
    walletTransfers.normalizeWalletTransferTxHash(`  0x${"Ab".repeat(32)}  `),
    `0x${"ab".repeat(32)}`,
    "wallet transfer history must only preserve full transaction hashes in lowercase",
  );
  assert.equal(walletTransfers.normalizeWalletTransferAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"), "0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
  assert.equal(walletTransfers.normalizeWalletTransferAddress("0xabc"), null);
  assert.equal(walletTransfers.normalizeWalletTransferAddress(null), null);
  const persistedTransferCache = {
    version: 3,
    savedAt: 1_700_000_000_000,
    transfers: [{
      direction: "in",
      counterparty: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      amount: "12.50",
      amountNum: 12.5,
      txHash: `0x${"a".repeat(64)}`,
      blockNumber: "123456",
      transactionIndex: 1,
      logIndex: 2,
    }],
    totalIn: 12.5,
    totalOut: 0,
    totalInDisplay: "12.50",
    totalOutDisplay: "0.00",
    scanCoverage: "full",
    historyRowsTruncated: false,
  };
  const persistedTransferSummary = walletTransfers.parsePersistedWalletTransfersSummary(persistedTransferCache);
  assert.deepEqual(
    persistedTransferSummary,
    {
      transfers: [{
        direction: "in",
        counterparty: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        amount: "12.50",
        amountNum: 12.5,
        txHash: `0x${"a".repeat(64)}`,
        blockNumber: 123456n,
        transactionIndex: 1,
        logIndex: 2,
      }],
      totalIn: 12.5,
      totalOut: 0,
      totalInDisplay: "12.50",
      totalOutDisplay: "0.00",
      dataStatus: "stale",
      scanCoverage: "full",
      historyRowsTruncated: false,
      updatedAt: 1_700_000_000_000,
      statusMessage: "Showing the last checked full transfer history. Refresh to check for newer activity.",
    },
    "persisted transfer history must restore bigint block numbers with explicit full-range coverage",
  );
  assert.equal(
    walletTransfers.parsePersistedWalletTransfersSummary({ ...persistedTransferCache, version: 2 }),
    null,
    "v2 transfer cache must be ignored because its cache scope omits the configured token and deploy block",
  );
  assert.equal(
    walletTransfers.parsePersistedWalletTransfersSummary({ ...persistedTransferCache, version: 1 }),
    null,
    "legacy v1 transfer cache must be rejected because it has no trustworthy coverage provenance",
  );
  assert.equal(
    walletTransfers.parsePersistedWalletTransfersSummary({ ...persistedTransferCache, scanCoverage: undefined }),
    null,
    "v3 transfer cache without explicit coverage must not be upgraded to a full history",
  );
  assert.equal(
    walletTransfers.parsePersistedWalletTransfersSummary({ ...walletTransfers.serializeWalletTransfersSummary(persistedTransferSummary), transfers: [{ direction: "in" }] }),
    null,
    "malformed cached transfer history must not be rendered as a verified empty history",
  );
  const cappedPersistedTransfer = walletTransfers.serializeWalletTransfersSummary({
    ...persistedTransferSummary,
    dataStatus: "live",
    scanCoverage: "full",
    historyRowsTruncated: false,
    statusMessage: null,
    transfers: Array.from({ length: 501 }, (_, index) => ({
      ...persistedTransferSummary.transfers[0],
      txHash: `0x${index.toString(16).padStart(64, "0")}`,
    })),
  });
  assert.equal(cappedPersistedTransfer.version, 3);
  assert.equal(cappedPersistedTransfer.transfers.length, 500);
  assert.equal(cappedPersistedTransfer.historyRowsTruncated, true);
  const cappedRestoredTransfer = walletTransfers.parsePersistedWalletTransfersSummary(cappedPersistedTransfer);
  assert.equal(cappedRestoredTransfer?.scanCoverage, "full");
  assert.equal(cappedRestoredTransfer?.historyRowsTruncated, true);
  assert.match(cappedRestoredTransfer?.statusMessage ?? "", /capped at 500 rows; totals are from the full last check/i);
  const partialPersistedTransfer = walletTransfers.parsePersistedWalletTransfersSummary(walletTransfers.serializeWalletTransfersSummary({
    ...persistedTransferSummary,
    dataStatus: "partial",
    scanCoverage: "partial",
    historyRowsTruncated: false,
    statusMessage: "Transfer history is partial; observed records may be missing.",
  }));
  assert.equal(partialPersistedTransfer?.dataStatus, "stale");
  assert.equal(partialPersistedTransfer?.scanCoverage, "partial");
  assert.match(partialPersistedTransfer?.statusMessage ?? "", /last checked partial transfer history/i);
  assert.match(partialPersistedTransfer?.statusMessage ?? "", /totals are observed lower bounds; more transfers may exist/i);
  const tokenScopedCacheKey = walletTransfers.getWalletTransferPersistedCacheKey(
    "0x1111111111111111111111111111111111111111:any",
    "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    123456n,
  );
  assert.equal(
    tokenScopedCacheKey,
    walletTransfers.getWalletTransferPersistedCacheKey(
      "0x1111111111111111111111111111111111111111:any",
      "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
      123456n,
    ),
    "wallet transfer cache keys must normalize the token address",
  );
  assert.match(
    tokenScopedCacheKey,
    /wallet-transfer-history:v3:[^:]+:[^:]+:0xd8da6bf26964af9d7eed9e03e53415d37aa96045:123456:0x1111111111111111111111111111111111111111:any$/,
    "wallet transfer cache keys must bind the normalized token address and configured deploy block",
  );
  assert.notEqual(
    tokenScopedCacheKey,
    walletTransfers.getWalletTransferPersistedCacheKey(
      "0x1111111111111111111111111111111111111111:any",
      "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
      123457n,
    ),
    "wallet transfer cache keys must not reuse a history scanned from a different deploy block",
  );
  const walletTransfersSource = readFileSync("app/hooks/useWalletTransfers.ts", "utf8");
  const walletHookRuntimeProbe = runWalletHookRuntimeExecutableProbe();
  const missingTransferProvenanceResults = ["version", "scanCoverage", "historyRowsTruncated"].map((field) => {
    const candidate = { ...persistedTransferCache };
    delete candidate[field];
    return walletTransfers.parsePersistedWalletTransfersSummary(candidate);
  });
  assert.deepEqual(
    missingTransferProvenanceResults,
    [null, null, null],
    "transfer cache v3 must require explicit version, coverage, and row-truncation provenance",
  );
  assert.match(
    walletTransfersSource,
    /export function getWalletTransferPersistedCacheKey\([\s\S]*normalizeWalletTransferAddress\(tokenAddress\)[\s\S]*deployBlock\.toString\(\)[\s\S]*readPersistedWalletTransfers[\s\S]*getWalletTransferPersistedCacheKey\(cacheKey\)[\s\S]*persistWalletTransfers[\s\S]*getWalletTransferPersistedCacheKey\(cacheKey\)/,
    "persisted transfer cache reads and writes must use a token- and deploy-block-scoped key",
  );
  assert.deepEqual(
    walletHookRuntimeProbe.outgoingFailure,
    { dataStatus: "partial", scanCoverage: "partial", outgoingFailures: 1 },
    "a failed outgoing query must make the transfer history partial",
  );
  assert.deepEqual(
    walletHookRuntimeProbe.fallbackWindow,
    { dataStatus: "partial", scanCoverage: "partial", startedAfterFullRange: true },
    "a fallback window that starts after the full range must make the transfer history partial",
  );
  assert.deepEqual(
    walletHookRuntimeProbe.fallbackChunkFailure,
    { dataStatus: "partial", scanCoverage: "partial", fallbackCalls: 1 },
    "a failed fallback log chunk must make the transfer history partial",
  );
  assert.deepEqual(
    {
      statusMatrix: [
        walletHookRuntimeProbe.full,
        {
          dataStatus: walletHookRuntimeProbe.outgoingFailure.dataStatus,
          scanCoverage: walletHookRuntimeProbe.outgoingFailure.scanCoverage,
        },
        {
          dataStatus: walletHookRuntimeProbe.fallbackWindow.dataStatus,
          scanCoverage: walletHookRuntimeProbe.fallbackWindow.scanCoverage,
        },
        {
          dataStatus: walletHookRuntimeProbe.fallbackChunkFailure.dataStatus,
          scanCoverage: walletHookRuntimeProbe.fallbackChunkFailure.scanCoverage,
        },
      ],
      fetchCalls: walletHookRuntimeProbe.fetchCalls,
      blockNumberCalls: walletHookRuntimeProbe.blockNumberCalls,
      loggerWarnings: walletHookRuntimeProbe.loggerWarnings,
    },
    {
      statusMatrix: [
        { dataStatus: "live", scanCoverage: "full" },
        { dataStatus: "partial", scanCoverage: "partial" },
        { dataStatus: "partial", scanCoverage: "partial" },
        { dataStatus: "partial", scanCoverage: "partial" },
      ],
      fetchCalls: 0,
      blockNumberCalls: 4,
      loggerWarnings: 1,
    },
    "every recorded partial condition must reach both summary status and explicit coverage",
  );
  const walletTransferExecutableProbe = runWalletTransferExecutableProbe();
  assert.deepEqual(
    walletTransferExecutableProbe.decodeSkipCoverageResults,
    [
      {
        returnedLogCounts: [1, 0],
        scanCoverage: "partial",
        transferCount: 0,
        historyRowsTruncated: false,
        storageWrites: 1,
      },
      {
        returnedLogCounts: [0, 1],
        scanCoverage: "partial",
        transferCount: 0,
        historyRowsTruncated: false,
        storageWrites: 1,
      },
    ],
    "both inbound and outbound decode skips must make the persisted transfer history partial",
  );
  assert.deepEqual(
    walletTransferExecutableProbe.liveCapCoverageResult,
    {
      returnedLogCounts: [501, 0],
      scanCoverage: "partial",
      transferCount: 500,
      historyRowsTruncated: true,
      storageWrites: 1,
    },
    "a live over-cap response must remain bounded and report lower-bound partial history",
  );
  assert.deepEqual(
    {
      transferCount: walletTransferExecutableProbe.transfers.length,
      directions: walletTransferExecutableProbe.transfers.map(({ direction }) => direction).sort(),
      logIndexes: walletTransferExecutableProbe.transfers
        .map(({ logIndex }) => logIndex)
        .sort((left, right) => left - right),
      scanCoverage: walletTransferExecutableProbe.scanCoverage,
      historyRowsTruncated: walletTransferExecutableProbe.historyRowsTruncated,
    },
    {
      transferCount: 2,
      directions: ["in", "out"],
      logIndexes: [0, 1],
      scanCoverage: "full",
      historyRowsTruncated: false,
    },
    "wallet transfer fallback dedupe must compare event logs, not whole transactions",
  );
  assert.match(
    walletTransfersSource,
    /readPersistedWalletTransfers[\s\S]*dataStatus: unavailableSummary\.dataStatus === "stale"[\s\S]*Transfer history is temporarily unavailable[\s\S]*persistWalletTransfers\(cacheKey, summary\)/,
    "transfer history must preserve a verified cached result and report RPC failures instead of replacing it with an empty summary",
  );
  assert.equal(
    walletTransferExecutableProbe.transfers[0]?.txHash,
    `0x${"ab".repeat(32)}`,
    "wallet transfer history rows must only publish normalized full transaction hashes",
  );
  assert.deepEqual(
    {
      topicLengths: walletTransferExecutableProbe.getLogsTopicLengths,
      addressTopics: walletTransferExecutableProbe.addressTopics,
      invalidRpcCalls: walletTransferExecutableProbe.invalidRpcCalls,
      invalidStorageWrites: walletTransferExecutableProbe.invalidStorageWrites,
      fetchCalls: walletTransferExecutableProbe.fetchCalls,
    },
    {
      topicLengths: [2, 3],
      addressTopics: [
        "0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045",
        "0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045",
      ],
      invalidRpcCalls: 0,
      invalidStorageWrites: 0,
      fetchCalls: 0,
    },
    "wallet transfer history must validate and pad addresses before mocked log queries",
  );
  assert.doesNotMatch(
    walletTransfersSource,
    /const txHash = log\.transactionHash \?\? ""|txHash:\s*log\.transactionHash/,
    "wallet transfer history rows must not publish raw chain txHash values",
  );
  assert.doesNotMatch(
    walletTransfersSource,
    /const addr = embeddedAddress\.toLowerCase\(\)|externalWalletAddress\?\.toLowerCase\(\)|pad\(embeddedAddress as Hex/,
    "wallet transfer history must not lower-case or pad raw wallet addresses",
  );
  assert.deepEqual(
    [walletTransferExecutableProbe.totalInDisplay, walletTransferExecutableProbe.totalOutDisplay],
    ["0.00", "9007199254740993.56"],
    "wallet transfer summary must keep bigint-safe total display strings",
  );
  assert.deepEqual(
    [
      walletTransferExecutableProbe.totalIn,
      walletTransferExecutableProbe.totalOut,
      Math.max(...walletTransferExecutableProbe.transfers.map(({ amountNum }) => amountNum)),
    ],
    [0, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    "wallet transfer numeric compatibility totals must derive from bounded raw-wei formatting",
  );
  assert.notEqual(
    walletTransferExecutableProbe.totalOut,
    Number(walletTransferExecutableProbe.totalOutDisplay),
    "wallet transfer summary must not derive numeric compatibility totals from formatted decimal strings",
  );
  assert.deepEqual(
    pageWalletOverview.normalizeCachedPrivyBalances({ token: "12.3", eth: "0.0925" }),
    { token: "12.30", tokenUpdatedAt: null, eth: "0.0925", ethUpdatedAt: null },
    "legacy cache remains readable but lacks a trusted last-update timestamp",
  );
  assert.deepEqual(
    pageWalletOverview.normalizeCachedPrivyBalances({
      token: "9007199254740993.555",
      tokenUpdatedAt: 1_700_000_000_000,
      eth: "0.00005",
      ethUpdatedAt: 1_700_000_001_000,
    }),
    {
      token: "9007199254740993.56",
      tokenUpdatedAt: 1_700_000_000_000,
      eth: "0.0001",
      ethUpdatedAt: 1_700_000_001_000,
    },
    "current cache entries must preserve valid per-asset timestamps without Number precision loss",
  );
  assert.deepEqual(
    pageWalletOverview.normalizeCachedPrivyBalances({ token: "12.3", tokenUpdatedAt: "1700000000000", eth: "0.0925", ethUpdatedAt: 0 }),
    { token: "12.30", tokenUpdatedAt: null, eth: "0.0925", ethUpdatedAt: null },
    "cache timestamps must be positive safe integers rather than coerced values",
  );
  assert.deepEqual(
    pageWalletOverview.normalizeCachedPrivyBalances({ token: "bad", eth: "-1" }),
    { token: null, tokenUpdatedAt: null, eth: null, ethUpdatedAt: null },
    "unknown cached balances must not be presented as a verified zero",
  );
  assert.equal(pageWalletOverview.normalizePageWalletAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"), "0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
  assert.equal(pageWalletOverview.normalizePageWalletAddress("0xabc"), null);
  assert.equal(pageWalletOverview.normalizePageWalletAddress(null), null);
  assert.equal(
    pageWalletOverview.getPrivyBalanceCacheKey("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"),
    `lore:privy-balances:v1:59141:0x985c71613bb73fac5653c253a8ba37cd0ec8ab9a:0xd8da6bf26964af9d7eed9e03e53415d37aa96045`,
  );
  assert.equal(pageWalletOverview.getPrivyBalanceCacheKey("0xabc"), null);
  {
    const cacheKey = "wallet-overview:test";
    const storage = new Map([[cacheKey, "{bad json"]]);
    assert.deepEqual(
      pageWalletOverview.readCachedPrivyBalanceEntry({
        getItem: (key) => storage.get(key) ?? null,
        removeItem: (key) => storage.delete(key),
      }, cacheKey),
      {
        cacheKey,
        balances: { token: null, tokenUpdatedAt: null, eth: null, ethUpdatedAt: null },
      },
      "wallet overview must fail closed and clear corrupt cached balances",
    );
    assert.equal(storage.has(cacheKey), false, "corrupt wallet overview cache entries must be removed");
  }
  assert.equal(
    pageWalletOverview.isEmbeddedWalletActive(
      "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
    ),
    true,
    "wallet overview must compare normalized EVM addresses",
  );
  assert.equal(
    pageWalletOverview.isEmbeddedWalletActive("0xabc", "0xabc"),
    false,
    "matching malformed wallet strings must never identify the embedded wallet",
  );
  assert.equal(
    balanceFormatting.formatDecimalTextFixed("9007199254740993.555", 2),
    "9007199254740993.56",
    "decimal balance formatting must round above Number.MAX_SAFE_INTEGER without Number precision loss",
  );
  assert.equal(balanceFormatting.formatDecimalTextFixed("0.00005", 4), "0.0001");
  assert.equal(balanceFormatting.formatDecimalTextFixed("12", 2), "12.00");
  for (const invalidDecimalText of ["", "-1", "1e3", "1.", ".1", "1.2.3"]) {
    assert.equal(
      balanceFormatting.formatDecimalTextFixed(invalidDecimalText, 2),
      null,
      `decimal balance formatting must reject ${invalidDecimalText || "empty input"}`,
    );
  }
  assert.equal(
    balanceFormatting.formatBalanceFixed({ value: 9_007_199_254_740_993_555n, decimals: 3 }, 2),
    "9007199254740993.56",
    "live bigint balance formatting must round raw units without Number precision loss",
  );
  assert.equal(balanceFormatting.formatBalanceFixed({ value: 5n, decimals: 6 }, 4), "0.0000");
  assert.equal(balanceFormatting.formatBalanceFixed({ value: -1n, decimals: 18 }, 2), null);
  assert.equal(balanceFormatting.formatBalanceFixed({ value: 1n, decimals: 256 }, 2), null);
  assert.deepEqual(
    walletHookRuntimeProbe.pageWalletBalances,
    {
      token: "9007199254740993.56",
      eth: "9007199254740993.5550",
      headerLinea: "9007199254740993.56",
    },
    "wallet overview live balances must use shared raw bigint balance formatting",
  );
  assert.deepEqual(
    {
      tokenAvoidsNumericCoercion:
        walletHookRuntimeProbe.pageWalletBalances.token !== walletHookRuntimeProbe.numericCoercionPageBalances.token,
      ethAvoidsNumericCoercion:
        walletHookRuntimeProbe.pageWalletBalances.eth !== walletHookRuntimeProbe.numericCoercionPageBalances.eth,
    },
    { tokenAvoidsNumericCoercion: true, ethAvoidsNumericCoercion: true },
    "wallet overview live balances must not coerce formatted balances through Number()",
  );
  assert.equal(
    walletHookRuntimeProbe.gameLineaBalance,
    "9007199254740993.56",
    "active wallet LINEA display must use shared decimal text formatting",
  );
  assert.notEqual(
    walletHookRuntimeProbe.gameLineaBalance,
    walletHookRuntimeProbe.numericCoercionGameLineaBalance,
    "active wallet LINEA display must not coerce formatted balance text through Number()",
  );
  assert.deepEqual(
    autoMinerForm.sanitizeAutoMinerInputs({ betSize: "2.5", targets: 7, cycles: 12 }),
    { betSize: "2.5", targets: 7, cycles: 12 },
  );
  assert.deepEqual(
    autoMinerForm.sanitizeAutoMinerInputs({ betSize: "bad", targets: 99, cycles: 1_000_000 }),
    { betSize: "1.0", targets: 25, cycles: 5000 },
  );
  assert.deepEqual(
    autoMinerForm.sanitizeAutoMinerInputs({ targets: 2.9, cycles: 0 }),
    { betSize: "1.0", targets: 2, cycles: 1 },
  );
  {
    const storage = new Map([["lineaore:auto-miner-inputs:v1", JSON.stringify({ betSize: "2.5", targets: 7, cycles: 12 })]]);
    const removed = [];
    const restored = autoMinerForm.restoreAutoMinerInputs({
      getItem: (key) => storage.get(key) ?? null,
      removeItem: (key) => {
        removed.push(key);
        storage.delete(key);
      },
    });
    assert.deepEqual(restored, { betSize: "2.5", targets: 7, cycles: 12 });
    assert.deepEqual(removed, ["lineaore:auto-miner-inputs:v1"], "legacy auto-miner inputs must migrate by removing the legacy value");
  }
  {
    const currentKey = `lineaore:auto-miner-inputs:v2:${appConstants.APP_CHAIN_ID}:${appConstants.CONTRACT_ADDRESS.toLowerCase()}`;
    const storage = new Map([
      ["lineaore:auto-miner-inputs:v1", "{"],
      [currentKey, "{"],
    ]);
    const removed = [];
    assert.equal(
      autoMinerForm.restoreAutoMinerInputs({
        getItem: (key) => storage.get(key) ?? null,
        removeItem: (key) => {
          removed.push(key);
          storage.delete(key);
        },
      }),
      null,
      "corrupt auto-miner storage must not restore unsafe form values",
    );
    assert.equal(storage.size, 0, "corrupt auto-miner current and legacy entries must both be cleared");
    assert.equal(removed.length, 2);
  }
  assert.match(
    readFileSync("app/hooks/useMiningGuards.ts", "utf8"),
    /const sanitized = sanitizeLastBet\(JSON\.parse\(parsed\)\)[\s\S]*localStorage\.removeItem\(raw \? LAST_BET_KEY : LEGACY_LAST_BET_KEY\)[\s\S]*catch \{[\s\S]*localStorage\.removeItem\(LAST_BET_KEY\)/,
    "last-bet restore must clear corrupt or invalid localStorage entries",
  );
  assert.deepEqual(
    ["10", "2", "bad"].sort(analyticsAchievements.compareAchievementEpochs),
    ["bad", "2", "10"],
  );
  assert.doesNotThrow(() => analyticsAchievements.compareAchievementEpochs("bad", "2"));
  assert.deepEqual(
    [
      { blockNumberNum: 0, epoch: "10", txHash: "0x10" },
      { blockNumberNum: 0, epoch: "9007199254740993", txHash: "0x09" },
      { blockNumberNum: 0, epoch: "bad", txHash: "0x0b" },
      { blockNumberNum: 0, epoch: "2", txHash: "0x02" },
      { blockNumberNum: 1, epoch: "9007199254740993", txHash: "0x01" },
    ].sort(analyticsAchievements.compareAchievementDepositOrder).map((deposit) => deposit.txHash),
    ["0x09", "0x0b", "0x01", "0x02", "0x10"],
    "first-bet ordering must treat unsafe and malformed epoch strings as untrusted before the stable hash tie-breaker",
  );
  assert.ok(
    analyticsAchievements.compareAchievementDepositOrder(
      { blockNumberNum: 7, epoch: "99", txHash: "0xb" },
      { blockNumberNum: 7, epoch: "2", txHash: "0xa" },
    ) > 0,
    "first-bet ordering must use the safe epoch order before its tx-hash tie-breaker",
  );
  const achievementsWalletAddress = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
  const achievementsStorageKey = `lore:achievements:v3:${appConstants.APP_CHAIN_ID}:${appConstants.CONTRACT_ADDRESS.toLowerCase()}:${achievementsWalletAddress.toLowerCase()}`;
  const achievementCleanupOutcomes = [];
  const priorLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  function AchievementCleanupProbe() {
    analyticsAchievements.useAnalyticsAchievements({
      walletAddress: achievementsWalletAddress,
      deposits: [],
      totalDeposited: 0,
      definitions: [],
      rarityById: {},
      defaultRarity: "common",
    });
    return null;
  }
  try {
    for (const invalidPayload of ["{", JSON.stringify({ unlockedAt: null })]) {
      const storage = new Map([[achievementsStorageKey, invalidPayload]]);
      const removedKeys = [];
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
          getItem: (key) => storage.get(key) ?? null,
          removeItem: (key) => {
            removedKeys.push(key);
            storage.delete(key);
          },
        },
      });
      renderToStaticMarkup(React.createElement(AchievementCleanupProbe));
      achievementCleanupOutcomes.push({
        removedKeys,
        remaining: storage.has(achievementsStorageKey),
      });
    }
  } finally {
    if (priorLocalStorageDescriptor) {
      Object.defineProperty(globalThis, "localStorage", priorLocalStorageDescriptor);
    } else {
      delete globalThis.localStorage;
    }
  }
  assert.deepEqual(
    achievementCleanupOutcomes,
    [
      { removedKeys: [achievementsStorageKey], remaining: false },
      { removedKeys: [achievementsStorageKey], remaining: false },
    ],
    "analytics achievements must clear corrupt or invalid localStorage entries",
  );
  assert.deepEqual(
    autoResolveStorage.normalizeResolveGuardEntry({ epoch: "42", ts: 123 }, 1_000),
    { epoch: "42", ts: 123 },
  );
  assert.deepEqual(
    autoResolveStorage.normalizeResolveGuardEntry({ epoch: "9007199254740991", ts: 123 }, 1_000),
    { epoch: "9007199254740991", ts: 123 },
  );
  assert.equal(autoResolveStorage.normalizeResolveGuardEntry({ epoch: "42", ts: Number.NaN }, 1_000), null);
  assert.equal(autoResolveStorage.normalizeResolveGuardEntry({ epoch: "42", ts: 123.5 }, 1_000), null);
  assert.equal(autoResolveStorage.normalizeResolveGuardEntry({ epoch: "42", ts: Number.MAX_SAFE_INTEGER + 1 }, 1_000), null);
  assert.equal(autoResolveStorage.normalizeResolveGuardEntry({ epoch: "42", ts: 1_000 }, 1_000.5), null);
  assert.equal(autoResolveStorage.normalizeResolveGuardEntry({ epoch: "42", ts: 7_001 }, 1_000), null);
  assert.equal(autoResolveStorage.normalizeResolveGuardEntry({ epoch: "bad", ts: 123 }, 1_000), null);
  assert.equal(autoResolveStorage.normalizeResolveGuardEntry({ epoch: "0042", ts: 123 }, 1_000), null);
  assert.equal(autoResolveStorage.normalizeResolveGuardEntry({ epoch: "9007199254740992", ts: 123 }, 1_000), null);
  assert.equal(autoResolveStorage.normalizeResolveGuardEntry({ epoch: "9999999999999999", ts: 123 }, 1_000), null);
  assert.equal(autoResolveStorage.normalizeResolveGuardEntry({ epoch: "1".repeat(21), ts: 123 }, 1_000), null);
  {
    const previousLocalStorage = globalThis.localStorage;
    try {
      const storage = new Map([["lore_resolve_epoch", "42"]]);
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
          getItem: (key) => storage.get(key) ?? null,
          setItem: (key, value) => storage.set(key, String(value)),
          removeItem: (key) => storage.delete(key),
        },
      });
      const beforeMigration = Date.now();
      const migrated = autoResolveStorage.readResolveGuard();
      assert.equal(migrated?.epoch, "42");
      assert.ok((migrated?.ts ?? 0) >= beforeMigration, "legacy auto-resolve guard must gain a fresh timestamp");
      assert.deepEqual(
        autoResolveStorage.normalizeResolveGuardEntry(JSON.parse(storage.get("lore_resolve_epoch"))),
        migrated,
        "legacy auto-resolve guard must migrate to the current JSON envelope",
      );
      autoResolveStorage.writeResolveGuard("0042");
      assert.equal(
        autoResolveStorage.normalizeResolveGuardEntry(JSON.parse(storage.get("lore_resolve_epoch")))?.epoch,
        "42",
        "non-canonical auto-resolve guard writes must not overwrite a valid canonical guard",
      );
      autoResolveStorage.writeResolveGuard("43");
      assert.equal(
        autoResolveStorage.normalizeResolveGuardEntry(JSON.parse(storage.get("lore_resolve_epoch")))?.epoch,
        "43",
        "canonical auto-resolve guard writes must persist the canonical epoch string",
      );
    } finally {
      if (previousLocalStorage === undefined) {
        delete globalThis.localStorage;
      } else {
        Object.defineProperty(globalThis, "localStorage", {
          configurable: true,
          value: previousLocalStorage,
        });
      }
    }
  }
  {
    const previousLocalStorage = globalThis.localStorage;
    try {
      const storage = new Map([["lore_resolve_epoch", JSON.stringify({ epoch: "42", ts: Number.NaN })]]);
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
          getItem: (key) => storage.get(key) ?? null,
          setItem: (key, value) => storage.set(key, String(value)),
          removeItem: (key) => storage.delete(key),
        },
      });
      assert.equal(autoResolveStorage.readResolveGuard(), null);
      assert.equal(storage.has("lore_resolve_epoch"), false, "invalid timestamp auto-resolve guards must be cleared");
    } finally {
      if (previousLocalStorage === undefined) {
        delete globalThis.localStorage;
      } else {
        Object.defineProperty(globalThis, "localStorage", {
          configurable: true,
          value: previousLocalStorage,
        });
      }
    }
  }
  {
    const previousLocalStorage = globalThis.localStorage;
    try {
      const storage = new Map([["lore_resolve_epoch", "0042"]]);
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
          getItem: (key) => storage.get(key) ?? null,
          setItem: (key, value) => storage.set(key, String(value)),
          removeItem: (key) => storage.delete(key),
        },
      });
      assert.equal(autoResolveStorage.readResolveGuard(), null);
      assert.equal(storage.has("lore_resolve_epoch"), false, "legacy non-canonical auto-resolve epochs must be cleared");
      storage.set("lore_resolve_epoch", "{");
      assert.equal(autoResolveStorage.readResolveGuard(), null);
      assert.equal(storage.has("lore_resolve_epoch"), false, "corrupt auto-resolve guard JSON must be cleared");
    } finally {
      if (previousLocalStorage === undefined) {
        delete globalThis.localStorage;
      } else {
        Object.defineProperty(globalThis, "localStorage", {
          configurable: true,
          value: previousLocalStorage,
        });
      }
    }
  }
}
