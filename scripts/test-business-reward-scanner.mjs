import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as rewardScannerModule from "../app/hooks/useRewardScanner.ts";
import * as rewardScanPolicyModule from "../app/lib/rewardScanPolicy.ts";
import * as claimTransactionIntentModule from "../app/lib/claimTransactionIntent.ts";
import * as constantsModule from "../app/lib/constants.ts";

const rewardScanPolicy = rewardScanPolicyModule.default ?? rewardScanPolicyModule;
const claimTransactionIntent = claimTransactionIntentModule.default ?? claimTransactionIntentModule;
const constants = constantsModule.default ?? constantsModule;
const { APP_CHAIN_ID, CONTRACT_ADDRESS, TX_RECEIPT_TIMEOUT_MS } = constants;

function assertRewardScannerPresentation() {
  const result = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/test-reward-scanner-presentation.tsx"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env },
  });
  assert.equal(result.error, undefined, `reward scanner presentation fixture failed to launch: ${result.error?.message ?? "unknown error"}`);
  assert.equal(result.signal, null, `reward scanner presentation fixture was terminated by ${result.signal ?? "an unknown signal"}`);
  assert.equal(result.status, 0, `reward scanner presentation fixture failed:\n${result.stderr || result.stdout}`);
}

function createRewardScanMemoryStorage(entries = []) {
  const values = new Map(entries);
  const reads = [];
  return {
    reads,
    getItem(key) {
      reads.push(key);
      return values.get(key) ?? null;
    },
  };
}

function assertRewardScanCacheStorageAndRestore(rewardScanner) {
  const cacheAddress = "0x52908400098527886e0f7030069857d2e4169ee7";
  const checksumAddress = "0x52908400098527886E0F7030069857D2E4169EE7";
  const v1Key = "lore:reward-scan:v1:" + cacheAddress;
  const v2Key = "lore:reward-scan:v2:" + cacheAddress;
  const v3Key = "lore:reward-scan:v3:" + cacheAddress;
  assert.deepEqual(
    [
      rewardScanner.getRewardScanCacheKey(checksumAddress, 1),
      rewardScanner.getRewardScanCacheKey(checksumAddress, 2),
      rewardScanner.getRewardScanCacheKey(checksumAddress, 3),
    ],
    [v1Key, v2Key, v3Key],
    "reward cache keys must normalize every supported storage version",
  );

  const now = 2_000_000;
  const verifiedAt = 1_999_000;
  const wins = [{ epoch: "7", amountWei: "11" }];
  const v3Payload = {
    cacheVersion: 3,
    verifiedAt,
    savedAt: verifiedAt,
    lastScannedEpoch: "100",
    deepestScannedEpoch: "1",
    wins,
  };
  const spoofedLegacyPayload = {
    ...v3Payload,
    wins: [{ epoch: "8", amountWei: "12" }],
  };
  const priorityStorage = createRewardScanMemoryStorage([
    [v3Key, JSON.stringify(v3Payload)],
    [v2Key, JSON.stringify(spoofedLegacyPayload)],
    [v1Key, JSON.stringify(spoofedLegacyPayload)],
  ]);
  const currentCache = rewardScanner.loadRewardScanCacheFromStorage(cacheAddress, priorityStorage);
  assert.deepEqual(priorityStorage.reads, [v3Key], "a present v3 cache must take precedence over legacy entries");
  assert.equal(currentCache.isVerified, true);
  assert.deepEqual(
    rewardScanner.deriveRewardScanCacheRestore(currentCache, cacheAddress, 100n, now),
    {
      wins,
      state: {
        status: "verified",
        walletAddress: cacheAddress,
        lastVerifiedAt: verifiedAt,
        incomplete: false,
        error: null,
      },
      rescanDelayMs: 899_000,
    },
    "current verified v3 coverage may restore rows and defer the next scan",
  );
  assert.deepEqual(
    rewardScanner.deriveRewardScanCacheRestore(currentCache, cacheAddress, 101n, now),
    {
      wins,
      state: {
        status: "stale",
        walletAddress: cacheAddress,
        lastVerifiedAt: verifiedAt,
        incomplete: false,
        error: null,
      },
      rescanDelayMs: 0,
    },
    "an epoch transition may show verified rows only as stale and must rescan immediately",
  );

  const incompleteRestore = {
    wins: [],
    state: {
      status: "idle",
      walletAddress: cacheAddress,
      lastVerifiedAt: null,
      incomplete: false,
      error: null,
    },
    rescanDelayMs: 0,
  };
  for (const incompleteV3 of [
    { label: "wrong cache version", override: { cacheVersion: 2 } },
    { label: "missing verifiedAt", override: { verifiedAt: undefined } },
    { label: "invalid verifiedAt", override: { verifiedAt: "not-a-timestamp" } },
    { label: "missing lastScannedEpoch", override: { lastScannedEpoch: undefined } },
    { label: "invalid lastScannedEpoch", override: { lastScannedEpoch: "not-an-epoch" } },
    { label: "missing deepestScannedEpoch", override: { deepestScannedEpoch: undefined } },
    { label: "invalid deepestScannedEpoch", override: { deepestScannedEpoch: "not-an-epoch" } },
  ]) {
    const storage = createRewardScanMemoryStorage([
      [v3Key, JSON.stringify({ ...v3Payload, ...incompleteV3.override })],
      [v2Key, JSON.stringify(spoofedLegacyPayload)],
    ]);
    const cache = rewardScanner.loadRewardScanCacheFromStorage(cacheAddress, storage);
    assert.equal(cache.isVerified, false, incompleteV3.label + " must not be treated as verified");
    assert.deepEqual(
      rewardScanner.deriveRewardScanCacheRestore(cache, cacheAddress, 100n, now),
      incompleteRestore,
      incompleteV3.label + " must not expose rows or defer a scan",
    );
    assert.deepEqual(storage.reads, [v3Key], incompleteV3.label + " must fail closed without legacy downgrade");
  }

  const invalidatedStorage = createRewardScanMemoryStorage([
    [v3Key, JSON.stringify({ ...v3Payload, invalidatedAt: verifiedAt })],
  ]);
  const invalidatedCache = rewardScanner.loadRewardScanCacheFromStorage(cacheAddress, invalidatedStorage);
  assert.equal(invalidatedCache.isVerified, true);
  assert.equal(invalidatedCache.isInvalidated, true);
  assert.deepEqual(
    rewardScanner.deriveRewardScanCacheRestore(invalidatedCache, cacheAddress, 100n, now),
    {
      wins,
      state: {
        status: "stale",
        walletAddress: cacheAddress,
        lastVerifiedAt: verifiedAt,
        incomplete: false,
        error: null,
      },
      rescanDelayMs: 0,
    },
    "claim-invalidated v3 rows stay visible only as stale while refresh starts immediately",
  );

  for (const legacyCase of [
    {
      label: "v2",
      storage: createRewardScanMemoryStorage([[v2Key, JSON.stringify(spoofedLegacyPayload)]]),
      expectedReads: [v3Key, v2Key],
    },
    {
      label: "v1",
      storage: createRewardScanMemoryStorage([[v1Key, JSON.stringify(spoofedLegacyPayload)]]),
      expectedReads: [v3Key, v2Key, v1Key],
    },
  ]) {
    const legacyCache = rewardScanner.loadRewardScanCacheFromStorage(cacheAddress, legacyCase.storage);
    assert.equal(legacyCache.isVerified, false, legacyCase.label + " cache must not self-upgrade");
    assert.deepEqual(
      rewardScanner.deriveRewardScanCacheRestore(legacyCache, cacheAddress, 100n, now),
      {
        wins: [],
        state: {
          status: "idle",
          walletAddress: cacheAddress,
          lastVerifiedAt: null,
          incomplete: false,
          error: null,
        },
        rescanDelayMs: 0,
      },
      legacyCase.label + " cache must not expose rows or defer a verified scan",
    );
    assert.deepEqual(legacyCase.storage.reads, legacyCase.expectedReads);
  }

  const emptyCache = {
    wins: [],
    savedAt: null,
    lastScannedEpoch: null,
    deepestScannedEpoch: null,
    verifiedAt: null,
    isVerified: false,
    isInvalidated: false,
  };
  for (const malformedV3 of [
    { label: "empty", raw: "" },
    { label: "invalid JSON", raw: "{not-json" },
    { label: "invalid envelope", raw: JSON.stringify({ ...v3Payload, wins: "not-an-array" }) },
  ]) {
    const storage = createRewardScanMemoryStorage([
      [v3Key, malformedV3.raw],
      [v2Key, JSON.stringify(spoofedLegacyPayload)],
    ]);
    assert.deepEqual(
      rewardScanner.loadRewardScanCacheFromStorage(cacheAddress, storage),
      emptyCache,
      malformedV3.label + " v3 cache must fail closed without a legacy downgrade",
    );
    assert.deepEqual(storage.reads, [v3Key]);
  }

  const malformedV2Storage = createRewardScanMemoryStorage([
    [v2Key, ""],
    [v1Key, JSON.stringify(spoofedLegacyPayload)],
  ]);
  assert.deepEqual(
    rewardScanner.loadRewardScanCacheFromStorage(cacheAddress, malformedV2Storage),
    emptyCache,
    "a present malformed v2 cache must fail closed without a v1 downgrade",
  );
  assert.deepEqual(malformedV2Storage.reads, [v3Key, v2Key]);
  assert.deepEqual(
    rewardScanner.loadRewardScanCacheFromStorage(cacheAddress, null),
    emptyCache,
    "storage-unavailable restore must fail closed",
  );
}

function assertClaimTransactionIntentPolicy(candidate) {
  const hash = `0x${"1".repeat(64)}`;
  const actor = "0x1111111111111111111111111111111111111111";
  const contract = "0x2222222222222222222222222222222222222222";
  const calldata = "0x12345678";
  const transaction = {
    hash,
    chainId: 59141,
    from: actor,
    to: contract,
    value: 0n,
    input: calldata,
    type: "eip1559",
  };
  const intent = { actor, chainId: 59141, contract, calldata };
  assert.doesNotThrow(() => candidate(intent, hash, transaction));
  for (const mutated of [
    { ...transaction, to: actor },
    { ...transaction, from: contract },
    { ...transaction, chainId: 1 },
    { ...transaction, value: 1n },
    { ...transaction, input: "0x87654321" },
    { ...transaction, type: "eip" + "7702" },
  ]) {
    assert.throws(() => candidate(intent, hash, mutated), /Claim transaction does not match/);
  }
}

async function assertClaimReceiptQuorumAndFinalityPolicy(candidate) {
  const hash = `0x${"1".repeat(64)}`;
  const actor = "0x1111111111111111111111111111111111111111";
  const contract = "0x2222222222222222222222222222222222222222";
  const calldata = "0x12345678";
  const blockHash = `0x${"2".repeat(64)}`;
  const receipt = { status: "success", transactionHash: hash, blockHash, blockNumber: 10n, transactionIndex: 1 };
  const transaction = { hash, chainId: 59141, from: actor, to: contract, value: 0n, input: calldata, type: "eip1559", blockHash, blockNumber: 10n, transactionIndex: 1, nonce: 7 };
  const client = {
    waitForTransactionReceipt: async () => receipt,
    getTransactionReceipt: async () => receipt,
    getTransaction: async () => transaction,
    getChainId: async () => 59141,
    getBlockNumber: async () => 12n,
    getBlock: async () => ({ hash: blockHash }),
  };
  const intent = { actor, chainId: 59141, contract, calldata };
  assert.equal(await candidate(intent, hash, 1_000, [client, client]), "confirmed");
  assert.equal(
    await candidate(intent, hash, 1_000, [
      client,
      { ...client, getBlock: async () => ({ hash: `0x${"3".repeat(64)}` }) },
    ]),
    "pending",
    "a claim must stay pending when independent origins disagree about the finalized block",
  );
  const revertedReceipt = { ...receipt, status: "reverted" };
  const revertedClient = {
    ...client,
    waitForTransactionReceipt: async () => revertedReceipt,
    getTransactionReceipt: async () => revertedReceipt,
  };
  await assert.rejects(
    () => candidate(intent, hash, 1_000, [revertedClient, revertedClient]),
    /Transaction reverted/,
    "a finalized reverted receipt must not be downgraded to a successful or pending claim",
  );
  await assert.rejects(
    () => candidate(intent, hash, 1_000, [client, { ...client, getTransaction: async () => ({ ...transaction, type: "eip" + "7702" }) }]),
    /Claim transaction does not match/,
    "a receipt quorum must not override an unsupported claim transaction envelope",
  );
}

function assertAutomaticRewardScanBounds(candidate) {
  assert.deepEqual(candidate(0n), { startEpoch: 0n, minEpoch: 1n, quickMinEpoch: 1n });
  assert.deepEqual(candidate(1n), { startEpoch: 0n, minEpoch: 1n, quickMinEpoch: 1n });
  assert.deepEqual(candidate(2n), { startEpoch: 1n, minEpoch: 1n, quickMinEpoch: 1n });
  assert.deepEqual(candidate(1_501n), { startEpoch: 1_500n, minEpoch: 1n, quickMinEpoch: 1n });
  assert.deepEqual(candidate(1_502n), { startEpoch: 1_501n, minEpoch: 1n, quickMinEpoch: 2n });
  assert.deepEqual(candidate(5_001n), { startEpoch: 5_000n, minEpoch: 1n, quickMinEpoch: 3_501n });
  assert.deepEqual(candidate(5_002n), { startEpoch: 5_001n, minEpoch: 2n, quickMinEpoch: 3_502n });
}

function assertRewardSelectionPolicy(candidate) {
  const result = candidate({
    potentialWins: [
      { id: 9n, rewardPool: 100n },
      { id: 8n, rewardPool: 100n },
      { id: 7n, rewardPool: 1n },
      { id: 6n, rewardPool: 100n },
      { id: 5n, rewardPool: 100n },
    ],
    betResults: [{ result: 5n }, { result: 5n }, { result: 1n }, { result: 0n }, {}],
    tilePoolResults: [{ result: 10n }, { result: 10n }, { result: 10n }, { result: 10n }, { result: 10n }],
    resolvedAtResults: [
      { result: 10n },
      { result: 9n },
      { result: 0n },
      { result: 10n },
      { result: 10n },
    ],
    chainTimestamp: 10n + rewardScanPolicy.REWARD_CLAIM_WINDOW_SECONDS - 1n,
  });
  assert.deepEqual(result, [{ epoch: "9", amountWei: "50" }]);

  assert.deepEqual(candidate({
    potentialWins: [{ id: 9n, rewardPool: 100n }],
    betResults: [{ result: 5n }],
    tilePoolResults: [{ result: 10n }],
    resolvedAtResults: [{ result: 10n }],
    chainTimestamp: 10n + rewardScanPolicy.REWARD_CLAIM_WINDOW_SECONDS,
  }), []);
}

function assertRewardScannerExecutableSeams(rewardScanner) {
  const preferredAddress = "0x52908400098527886E0F7030069857D2E4169EE7";
  const connectedAddress = "0xde709f2102306220921060314715629080e2fb77";
  assert.deepEqual(
    [
      rewardScanner.resolveRewardScannerAddress(preferredAddress.toLowerCase(), connectedAddress),
      rewardScanner.resolveRewardScannerAddress(null, connectedAddress),
      rewardScanner.resolveRewardScannerAddress("not-an-address", connectedAddress),
      rewardScanner.resolveRewardScannerAddress(undefined, undefined),
    ],
    [preferredAddress, connectedAddress, undefined, undefined],
    "reward scanning must prefer and checksum the embedded wallet, while invalid preferred actors fail closed",
  );

  const wins = [{ epoch: "7", amountWei: "11" }];
  assert.deepEqual(
    rewardScanner.createInvalidatedRewardScanCacheEnvelope({
      wins,
      lastScannedEpoch: "100",
      deepestScannedEpoch: "1",
      verifiedAt: 1_999_000,
    }, 2_000_000),
    {
      cacheVersion: 3,
      verifiedAt: 1_999_000,
      savedAt: 1_999_000,
      invalidatedAt: 2_000_000,
      lastScannedEpoch: "100",
      deepestScannedEpoch: "1",
      wins,
    },
    "claim invalidation must retain verification provenance while recording a distinct invalidation time",
  );

  const completeScanInput = {
    potentialWins: [{ id: 9n, rewardPool: 100n }],
    betResults: [{ status: "success", result: 5n }],
    tilePoolResults: [{ status: "success", result: 10n }],
    resolvedAtResults: [{ status: "success", result: 10n }],
    chainTimestamp: 20n,
  };
  assert.deepEqual(
    rewardScanner.collectCompleteOpenRewardScanWins(completeScanInput),
    [{ epoch: "9", amountWei: "50" }],
    "complete aligned multicalls must flow through the claim-window reward policy",
  );
  for (const invalidInput of [
    { betResults: [] },
    { tilePoolResults: [{ status: "failure", error: new Error("RPC") }] },
    { resolvedAtResults: [{ status: "success", result: "not-a-timestamp" }] },
  ]) {
    assert.throws(
      () => rewardScanner.collectCompleteOpenRewardScanWins({ ...completeScanInput, ...invalidInput }),
      rewardScanner.RewardScanIncompleteError,
      "incomplete, failed, or mistyped aligned multicalls must fail before reward selection",
    );
  }
}

function runRewardScannerBehaviorProbe(scenario) {
  const childSource = String.raw`
import assert from "node:assert/strict";
import { mock } from "node:test";
import { pathToFileURL } from "node:url";

class HookMachine {
  constructor(stateOverrides = {}) { this.cursor = 0; this.slots = []; this.stateOverrides = stateOverrides; }
  render(factory) { this.cursor = 0; activeMachine = this; try { return factory(); } finally { activeMachine = null; } }
  state(initial) {
    const index = this.cursor++;
    if (!(index in this.slots)) this.slots[index] = index in this.stateOverrides ? this.stateOverrides[index] : (typeof initial === "function" ? initial() : initial);
    return [this.slots[index], (next) => { this.slots[index] = typeof next === "function" ? next(this.slots[index]) : next; }];
  }
  ref(initial) { const index = this.cursor++; if (!(index in this.slots)) this.slots[index] = { current: initial }; return this.slots[index]; }
  memo(factory) { this.cursor += 1; return factory(); }
  callback(value) { this.cursor += 1; return value; }
  effect(effect) { this.cursor += 1; effect(); }
}
let activeMachine = null;
const machine = () => { assert.ok(activeMachine, "hook primitive outside HookMachine"); return activeMachine; };
const useState = (value) => machine().state(value);
const useRef = (value) => machine().ref(value);
const useMemo = (factory) => machine().memo(factory);
const useCallback = (value) => machine().callback(value);
const useEffect = (effect) => machine().effect(effect);

let currentAccount = "0x1111111111111111111111111111111111111111";
let receiptMode = ${JSON.stringify(scenario === "cache-before-receipt" || scenario === "receipt-intent-pending" ? "pending" : "confirmed")};
let sendCount = 0;
let sentTransactions = [];
let fetchCalls = 0;
let receiptCalls = [];
let notifications = [];
let simulateStarted;
let releaseSimulation;
const simulationGate = new Promise((resolve) => { simulateStarted = resolve; });
const simulationRelease = new Promise((resolve) => { releaseSimulation = resolve; });
let releaseSend;
const sendGate = new Promise((resolve) => { releaseSend = resolve; });
const HASH = "0x" + "a".repeat(64);
const OTHER_HASH = "0x" + "b".repeat(64);
const actor = currentAccount.toLowerCase();
const storageValues = new Map();
globalThis.fetch = () => { fetchCalls += 1; throw new Error("fetch poison"); };
globalThis.localStorage = {
  getItem: (key) => storageValues.get(key) ?? null,
  setItem: (key, value) => storageValues.set(key, String(value)),
  removeItem: (key) => storageValues.delete(key),
};
globalThis.window = { setTimeout: () => 1, clearTimeout: () => undefined };

const publicClient = {
  estimateGas: async () => 100_000n,
  simulateContract: async () => {
    if (${JSON.stringify(scenario)} === "wallet-change") {
      simulateStarted();
      await simulationRelease;
    }
  },
  multicall: async ({ contracts }) => contracts.map(() => ({ status: "success", result: true })),
};

class ClaimTransactionIntentError extends Error {}
const moduleUrl = (relativePath) => pathToFileURL(process.cwd() + "/" + relativePath).href;
mock.module("react", { namedExports: { useState, useRef, useMemo, useCallback, useEffect } });
mock.module("wagmi", { namedExports: {
  useAccount: () => ({ address: currentAccount }),
  usePublicClient: () => publicClient,
} });
mock.module(moduleUrl("app/lib/logger.ts"), { namedExports: { log: { warn() {}, debug() {}, info() {}, error() {} } } });
mock.module(moduleUrl("app/lib/eoaNonceLock.ts"), { namedExports: {
  acquireEoaNonceLockLease: async () => ({ release() {} }),
} });
mock.module(moduleUrl("app/hooks/useMining.shared.ts"), { namedExports: { isAmbiguousPendingTxError: () => false } });
mock.module(moduleUrl("app/lib/claimTransactionIntent.ts"), { namedExports: {
  ClaimTransactionIntentError,
  waitForTrackedClaimTransactionReceiptAgreement: async (intent, hash, timeout) => {
    receiptCalls.push({ intent, hash, timeout, storage: storageValues.get("lore:reward-scan:v3:" + actor) ?? null });
    if (receiptMode === "pending") return "pending";
    return "confirmed";
  },
} });

const imported = await import(moduleUrl("app/hooks/useRewardScanner.ts") + "?reward-scanner-behavior-" + ${JSON.stringify(scenario)});
const useRewardScanner = imported.useRewardScanner ?? imported.default?.useRewardScanner ?? imported.default;
const wins = ${JSON.stringify(scenario === "batch-explorer")}
  ? Array.from({ length: 129 }, (_, index) => ({ epoch: String(index + 1), amountWei: "11" }))
  : [{ epoch: "7", amountWei: "11" }, { epoch: "8", amountWei: "12" }];
const initialState = ${JSON.stringify(
    scenario === "batch-explorer"
      || scenario === "single-lock"
      || scenario === "cache-before-receipt"
      || scenario === "cache-after-confirmation"
      ? "wins"
      : "empty",
  )};
const hookMachine = new HookMachine({ 1: initialState === "wins" ? wins : [] });
const render = () => hookMachine.render(() => useRewardScanner(100n, {
  enabled: false,
  isPageVisible: false,
  preferredAddress: currentAccount,
  sendTransactionSilent: async (transaction) => {
    sendCount += 1;
    sentTransactions.push({
      to: transaction.to,
      data: transaction.data ?? null,
      value: transaction.value?.toString() ?? null,
      gas: transaction.gas?.toString() ?? null,
      contractIntent: transaction.contractIntent ?? null,
    });
    if (${JSON.stringify(scenario)} === "single-lock") await sendGate;
    return sendCount === 1 ? HASH : OTHER_HASH;
  },
  onNotify: (message, tone) => notifications.push({ message, tone }),
}));
let hook = render();

if (${JSON.stringify(scenario)} === "single-explorer" || ${JSON.stringify(scenario)} === "receipt-intent-pending" || ${JSON.stringify(scenario)} === "preparing-copy" || ${JSON.stringify(scenario)} === "cache-before-receipt" || ${JSON.stringify(scenario)} === "cache-after-confirmation") {
  if (${JSON.stringify(scenario)} === "cache-before-receipt" || ${JSON.stringify(scenario)} === "cache-after-confirmation") {
    storageValues.set("lore:reward-scan:v3:" + actor, JSON.stringify({ cacheVersion: 3, verifiedAt: 1_000, savedAt: 1_000, lastScannedEpoch: "100", deepestScannedEpoch: "1", wins }));
  }
  if (${JSON.stringify(scenario)} === "cache-after-confirmation") {
    await hook.claimReward("7");
    const saved = JSON.parse(storageValues.get("lore:reward-scan:v3:" + actor));
    process.stdout.write(JSON.stringify({ sendCount, sentTransactions, fetchCalls, receiptCalls, notifications, cache: saved }));
  } else {
    const claim = hook.claimReward("7");
    if (${JSON.stringify(scenario)} === "wallet-change") await simulationGate;
    await claim;
    process.stdout.write(JSON.stringify({ sendCount, sentTransactions, fetchCalls, receiptCalls, notifications, cacheAtReceipt: receiptCalls[0]?.storage ?? null }));
  }
} else if (${JSON.stringify(scenario)} === "batch-explorer") {
  await hook.claimAll();
  process.stdout.write(JSON.stringify({ sendCount, sentTransactions, fetchCalls, receiptCalls, notifications, unclaimedWins: hook.unclaimedWins }));
} else if (${JSON.stringify(scenario)} === "single-lock") {
  const originalSend = hook.claimReward;
  const first = originalSend("7");
  await Promise.resolve();
  const second = originalSend("7");
  releaseSend?.();
  await Promise.all([first, second]);
  process.stdout.write(JSON.stringify({ sendCount, sentTransactions, fetchCalls, receiptCalls, notifications }));
} else if (${JSON.stringify(scenario)} === "wallet-change") {
  const claim = hook.claimReward("7");
  await simulationGate;
  currentAccount = "0x2222222222222222222222222222222222222222";
  hook = render();
  releaseSimulation();
  await claim;
  hook = render();
  process.stdout.write(JSON.stringify({ sendCount, sentTransactions, fetchCalls, receiptCalls, notifications, postSwitchState: hook.rewardScanState }));
}
`;
  const originalFetch = globalThis.fetch;
  const originalMarker = process.env.LORE_REWARD_SCANNER_PROBE_MARKER;
  process.env.LORE_REWARD_SCANNER_PROBE_MARKER = "parent-preserved";
  const parentFetch = () => { throw new Error("parent fetch poison"); };
  globalThis.fetch = parentFetch;
  try {
    const result = spawnSync(process.execPath, [
      "--experimental-test-module-mocks",
      "--import", "tsx",
      "--input-type=module",
      "--eval", childSource,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env },
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 1_048_576,
    });
    if (result.error !== undefined) {
      throw new Error(`${scenario} behavior probe failed to launch: ${result.error?.message ?? "unknown error"}`);
    }
    if (result.signal !== null) {
      throw new Error(`${scenario} behavior probe terminated by ${result.signal ?? "unknown signal"}`);
    }
    if (result.status !== 0) {
      throw new Error(`${scenario} behavior probe failed:\n${result.stderr || result.stdout}`);
    }
    const lines = String(result.stdout).trim().split(/\r?\n/);
    return JSON.parse(lines.at(-1));
  } finally {
    if (globalThis.fetch !== parentFetch) {
      throw new Error("parent fetch identity changed during child probe");
    }
    if (process.env.LORE_REWARD_SCANNER_PROBE_MARKER !== "parent-preserved") {
      throw new Error("parent environment changed during child probe");
    }
    globalThis.fetch = originalFetch;
    if (originalMarker === undefined) delete process.env.LORE_REWARD_SCANNER_PROBE_MARKER;
    else process.env.LORE_REWARD_SCANNER_PROBE_MARKER = originalMarker;
  }
}

export async function runRewardScannerTests() {
  const rewardScanner = rewardScannerModule.default ?? rewardScannerModule;
  assertRewardScannerExecutableSeams(rewardScanner);
  assertClaimTransactionIntentPolicy(claimTransactionIntent.assertClaimTransactionMatchesIntent);
  await assertClaimReceiptQuorumAndFinalityPolicy(claimTransactionIntent.waitForClaimTransactionReceiptAgreement);
  const rewardScanNow = 1_000_000;
  assert.equal(rewardScanner.normalizeRewardScanEpochString("42"), "42");
  assert.equal(rewardScanner.normalizeRewardScanEpochString("bad"), null);
  assert.deepEqual(
    rewardScanner.normalizeRewardScanWins([
      { epoch: "12", amountWei: "1000" },
      { epoch: "bad", amountWei: "1000" },
      { epoch: "13", amountWei: "bad" },
    ]),
    [{ epoch: "12", amountWei: "1000" }],
  );
  assert.deepEqual(
    [
      { epoch: "10", amountWei: "1" },
      { epoch: "bad", amountWei: "1" },
      { epoch: "2", amountWei: "1" },
    ].sort(rewardScanner.compareRewardScanWinsDesc),
    [
      { epoch: "10", amountWei: "1" },
      { epoch: "2", amountWei: "1" },
      { epoch: "bad", amountWei: "1" },
    ],
  );
  const verifiedAt = Date.now() - 1;
  const verifiedEmptyCache = rewardScanner.parseRewardScanCacheEnvelope({
    cacheVersion: 3,
    verifiedAt,
    savedAt: verifiedAt,
    lastScannedEpoch: "100",
    deepestScannedEpoch: "1",
    wins: [],
  }, 3);
  assert.deepEqual(
    verifiedEmptyCache,
    {
      wins: [],
      savedAt: verifiedAt,
      lastScannedEpoch: "100",
      deepestScannedEpoch: "1",
      verifiedAt,
      isVerified: true,
      isInvalidated: false,
    },
    "a v3 empty cache is a verified no-reward result",
  );
  assert.equal(rewardScanner.isRewardScanCacheCoveredForEpoch(verifiedEmptyCache, 100n), true);
  assert.equal(
    rewardScanner.getCachedRewardScanState(verifiedEmptyCache, "0xabc", 100n).status,
    "verified",
    "a complete v3 empty cache is the only verified no-reward result",
  );
  assert.equal(rewardScanner.isRewardScanCacheCoveredForEpoch(verifiedEmptyCache, 101n), false, "a cache verified for an older epoch must refresh immediately");
  assert.equal(
    rewardScanner.getCachedRewardScanState(verifiedEmptyCache, "0xabc", 101n).status,
    "stale",
    "an epoch transition must restore prior reward data only as stale",
  );
  const claimReloadCache = rewardScanner.parseRewardScanCacheEnvelope({
    cacheVersion: 3,
    verifiedAt,
    savedAt: verifiedAt,
    invalidatedAt: verifiedAt,
    lastScannedEpoch: "100",
    deepestScannedEpoch: "1",
    wins: [],
  }, 3);
  assert.equal(claimReloadCache.isVerified, true, "a post-claim cache retains its last verification provenance");
  assert.equal(claimReloadCache.isInvalidated, true, "a post-claim cache is explicitly invalidated");
  assert.deepEqual(claimReloadCache.wins, [], "a claim followed by reload cannot restore the claimed reward row");
  assert.equal(rewardScanner.isRewardScanCacheCoveredForEpoch(claimReloadCache, 100n), false, "a post-claim cache cannot defer a refresh");
  assert.deepEqual(
    rewardScanner.getCachedRewardScanState(claimReloadCache, "0xabc", 100n),
    {
      status: "stale",
      walletAddress: "0xabc",
      lastVerifiedAt: verifiedAt,
      incomplete: false,
      error: null,
    },
    "a claim followed by reload must keep the claimed reward absent and only restore stale provenance",
  );
  const pendingReloadCache = rewardScanner.parseRewardScanCacheEnvelope({
    cacheVersion: 3,
    verifiedAt,
    savedAt: verifiedAt,
    invalidatedAt: verifiedAt,
    lastScannedEpoch: "100",
    deepestScannedEpoch: "1",
    wins: [{ epoch: "7", amountWei: "11" }],
  }, 3);
  assert.equal(
    rewardScanner.getCachedRewardScanState(pendingReloadCache, "0xabc", 100n).status,
    "stale",
    "a pending claim must not reload as a verified reward result",
  );
  assert.deepEqual(pendingReloadCache.wins, [{ epoch: "7", amountWei: "11" }], "pending claims retain the candidate until on-chain outcome is known");
  const legacyEmptyCache = rewardScanner.parseRewardScanCacheEnvelope({
    savedAt: verifiedAt,
    lastScannedEpoch: "100",
    deepestScannedEpoch: "1",
    wins: [],
  }, 2);
  assert.equal(legacyEmptyCache.isVerified, false, "a v2 empty cache cannot prove that no rewards exist");
  assert.equal(legacyEmptyCache.verifiedAt, null);
  for (const legacyLabel of ["v2", "v1"]) {
    const spoofedLegacyCache = rewardScanner.parseRewardScanCacheEnvelope({
      cacheVersion: 3,
      verifiedAt,
      savedAt: verifiedAt,
      lastScannedEpoch: "100",
      deepestScannedEpoch: "1",
      wins: [],
    }, 2);
    assert.equal(spoofedLegacyCache.isVerified, false, legacyLabel + " cache must not self-upgrade by claiming cacheVersion 3");
    assert.equal(
      rewardScanner.getCachedRewardScanState(spoofedLegacyCache, "0xabc", 100n).status,
      "idle",
      legacyLabel + " cache must not restore a verified reward state",
    );
  }
  const malformedV3Cache = rewardScanner.parseRewardScanCacheEnvelope({
    cacheVersion: 3,
    verifiedAt,
    savedAt: verifiedAt,
    lastScannedEpoch: "100",
    deepestScannedEpoch: "1",
    wins: "not-an-array",
  }, 3);
  assert.equal(malformedV3Cache.isVerified, false, "malformed v3 cache must fail closed");
  assert.equal(rewardScanner.getCachedRewardScanState(malformedV3Cache, "0xabc", 100n).status, "idle");
  assertRewardScanCacheStorageAndRestore(rewardScanner);
  assert.deepEqual(
    rewardScanner.getRewardScanFailureState({
      walletAddress: "0xabc",
      lastVerifiedAt: verifiedAt,
      incomplete: true,
      message: "Reward scan incomplete: hasClaimed[1] failed",
    }),
    {
      status: "stale",
      walletAddress: "0xabc",
      lastVerifiedAt: verifiedAt,
      incomplete: true,
      error: "Reward scan incomplete: hasClaimed[1] failed",
    },
    "a failed refresh must preserve the verified v3 watermark as stale",
  );
  assert.deepEqual(
    rewardScanner.getRewardScanFailureState({
      walletAddress: "0xabc",
      lastVerifiedAt: null,
      incomplete: false,
      message: "RPC unavailable",
    }),
    {
      status: "error",
      walletAddress: "0xabc",
      lastVerifiedAt: null,
      incomplete: false,
      error: "RPC unavailable",
    },
    "an initial failed scan must be an error rather than an empty result",
  );
  assert.deepEqual(
    rewardScanner.requireCompleteRewardScanMulticallResults([
      { status: "success", result: false },
      { status: "success", result: 0n },
    ], 2, "fixture"),
    [{ result: false }, { result: 0n }],
  );
  assert.throws(
    () => rewardScanner.requireCompleteRewardScanMulticallResults([{ result: false }], 1, "fixture"),
    rewardScanner.RewardScanIncompleteError,
    "a multicall row without explicit success status must be rejected",
  );
  assert.throws(
    () => rewardScanner.requireCompleteRewardScanMulticallResults([{ status: "unknown", result: false }], 1, "fixture"),
    rewardScanner.RewardScanIncompleteError,
    "an unknown multicall row status must be rejected",
  );
  assert.throws(
    () => rewardScanner.requireCompleteRewardScanMulticallResults([{ result: false }], 2, "fixture"),
    rewardScanner.RewardScanIncompleteError,
    "a shortened multicall must never be interpreted as no reward",
  );
  assert.throws(
    () => rewardScanner.requireCompleteRewardScanMulticallResults([
      { status: "success", result: false },
      { status: "failure", error: new Error("RPC") },
    ], 2, "fixture"),
    rewardScanner.RewardScanIncompleteError,
    "a failed multicall entry must never be interpreted as no reward",
  );
  assert.equal(rewardScanner.getRewardScanRescanDelayMs(null, rewardScanNow), 0);
  assert.equal(rewardScanner.getRewardScanRescanDelayMs(rewardScanNow - 14 * 60_000, rewardScanNow), 60_000);
  assert.equal(rewardScanner.getRewardScanRescanDelayMs(rewardScanNow - 15 * 60_000, rewardScanNow), 0);
  assert.equal(rewardScanner.getRewardScanRescanDelayMs(rewardScanNow + 1, rewardScanNow), 0);
  const claimWindow = 365n * 24n * 60n * 60n;
  assert.equal(rewardScanner.isRewardClaimWindowOpen(0n, claimWindow * 2n), true);
  assert.equal(rewardScanner.isRewardClaimWindowOpen(10n, 10n + claimWindow - 1n), true);
  assert.equal(rewardScanner.isRewardClaimWindowOpen(10n, 10n + claimWindow), false);
  assert.equal(rewardScanner.formatRewardClaimError(new Error("RewardClaimWindowExpired()")), "This reward claim window has expired.");
  assert.equal(
    rewardScanner.formatRewardClaimError(new Error("Transaction receipt timeout")),
    "Reward claim status is unknown after a wallet timeout. Check wallet activity before retrying.",
  );
  assert.equal(
    rewardScanner.formatRewardClaimError(new Error("execution reverted")),
    "Reward claim reverted on-chain. No reward was moved by this transaction.",
  );
  assert.equal(
    rewardScanner.formatRewardClaimError(new Error("insufficient funds for gas")),
    "Reward claim failed: not enough balance or ETH for gas.",
  );
  assert.equal(
    rewardScanner.formatRewardClaimError(new Error("JSON-RPC provider unavailable")),
    "Reward claim hit a wallet or RPC issue. Check wallet activity before retrying.",
  );

  assert.equal(rewardScanPolicy.AUTOMATIC_REWARD_SCAN_DEPTH, 5_000n);
  assertAutomaticRewardScanBounds(rewardScanPolicy.getAutomaticRewardScanBounds);
  const chunks = [...rewardScanPolicy.iterateDescendingRewardScanEpochChunks(10n, 3n, 3n)];
  assert.deepEqual(chunks, [[10n, 9n, 8n], [7n, 6n, 5n], [4n, 3n]]);
  assert.deepEqual(chunks.flat(), [10n, 9n, 8n, 7n, 6n, 5n, 4n, 3n]);
  assert.deepEqual([...rewardScanPolicy.iterateDescendingRewardScanEpochChunks(2n, 3n, 3n)], []);
  assert.throws(
    () => [...rewardScanPolicy.iterateDescendingRewardScanEpochChunks(10n, 3n, 0n)],
    /positive/,
  );
  assert.deepEqual(rewardScanPolicy.chunkRewardScanItems([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.throws(() => rewardScanPolicy.chunkRewardScanItems([1], 0), /positive safe integer/);
  assertRewardSelectionPolicy(rewardScanPolicy.collectOpenRewardScanWins);

  assert.throws(
    () => assertAutomaticRewardScanBounds((epoch) => ({
      startEpoch: epoch > 1n ? epoch - 1n : 0n,
      minEpoch: epoch > 4_999n ? epoch - 4_999n : 1n,
      quickMinEpoch: epoch > 1_500n ? epoch - 1_500n : 1n,
    })),
    /Expected values to be strictly deep-equal/,
    "off-by-one scan-depth mutant must be killed",
  );
  assert.throws(
    () => assert.deepEqual(
      [...rewardScanPolicy.iterateDescendingRewardScanEpochChunks(10n, 3n, 3n)].slice(0, 1).flat(),
      [10n, 9n, 8n, 7n, 6n, 5n, 4n, 3n],
    ),
    /Expected values to be strictly deep-equal/,
    "empty-first-chunk early-stop mutant must be killed",
  );
  assert.throws(
    () => assertRewardSelectionPolicy((input) => rewardScanPolicy.collectOpenRewardScanWins({
      ...input,
      resolvedAtResults: input.resolvedAtResults.map(() => ({ result: 0n })),
    })),
    /Expected values to be strictly deep-equal/,
    "missing claim-finality timestamp binding mutant must be killed",
  );

  const rewardScannerSource = readFileSync("app/hooks/useRewardScanner.ts", "utf8");
  const primaryHash = "0x" + "a".repeat(64);
  const secondaryHash = "0x" + "b".repeat(64);
  const expectedActor = "0x1111111111111111111111111111111111111111";
  const singleExplorerProbe = runRewardScannerBehaviorProbe("single-explorer");
  assert.ok(
    singleExplorerProbe.sendCount === 1
      && singleExplorerProbe.fetchCalls === 0
      && singleExplorerProbe.receiptCalls.length === 1
      && singleExplorerProbe.sentTransactions[0]?.to === CONTRACT_ADDRESS
      && singleExplorerProbe.notifications.some(({ message, tone }) => tone === "success" && message.includes("https://") && message.includes(primaryHash)),
    "single reward claims must execute the real hook path and preserve explorer-linked confirmation",
  );
  const receiptIntentProbe = runRewardScannerBehaviorProbe("receipt-intent-pending");
  const receiptIntentCall = receiptIntentProbe.receiptCalls[0];
  assert.deepEqual(
    {
      sendCount: receiptIntentProbe.sendCount,
      fetchCalls: receiptIntentProbe.fetchCalls,
      receiptCallCount: receiptIntentProbe.receiptCalls.length,
      hash: receiptIntentCall?.hash,
      timeout: receiptIntentCall?.timeout,
      actor: receiptIntentCall?.intent?.actor,
      chainId: receiptIntentCall?.intent?.chainId,
      contract: receiptIntentCall?.intent?.contract,
      contractMatchesSent: receiptIntentCall?.intent?.contract === receiptIntentProbe.sentTransactions[0]?.to,
      calldataMatchesSent: receiptIntentCall?.intent?.calldata === receiptIntentProbe.sentTransactions[0]?.data,
      durableContractMatchesSent: receiptIntentProbe.sentTransactions[0]?.contractIntent?.contract === receiptIntentProbe.sentTransactions[0]?.to,
      durableCalldataMatchesSent: receiptIntentProbe.sentTransactions[0]?.contractIntent?.calldata === receiptIntentProbe.sentTransactions[0]?.data,
      pendingNotification: receiptIntentProbe.notifications.some(
        ({ message, tone }) => tone === "info" && message.includes("still pending") && message.includes(primaryHash),
      ),
    },
    {
      sendCount: 1,
      fetchCalls: 0,
      receiptCallCount: 1,
      hash: primaryHash,
      timeout: TX_RECEIPT_TIMEOUT_MS,
      actor: expectedActor,
      chainId: APP_CHAIN_ID,
      contract: CONTRACT_ADDRESS,
      contractMatchesSent: true,
      calldataMatchesSent: true,
      durableContractMatchesSent: true,
      durableCalldataMatchesSent: true,
      pendingNotification: true,
    },
    "reward claims must pass the exact sent intent to shared receipt agreement and preserve uncertain confirmation as pending",
  );
  assert.deepEqual(
    runRewardScannerBehaviorProbe("preparing-copy").notifications[0],
    { message: "Preparing reward claim.", tone: "info" },
    "reward claim preparation toasts must stay short and avoid redundant Privy-wallet wording",
  );
  const lineaOreHubRuntimeSource = readFileSync("app/hooks/useLineaOreHubRuntime.ts", "utf8");
  assert.match(
    lineaOreHubRuntimeSource,
    /useRewardScanner[\s\S]*enabled: activeTab === "hub" && Boolean\(embeddedWalletAddress\)[\s\S]*preferredAddress: embeddedWalletAddress[\s\S]*sendTransactionSilent: miningSendTransactionSilent/,
    "hub rewards must scan the same embedded wallet that submits claims",
  );
  const batchExplorerProbe = runRewardScannerBehaviorProbe("batch-explorer");
  const batchSuccessNotification = batchExplorerProbe.notifications.find(({ tone }) => tone === "success")?.message ?? "";
  assert.deepEqual(
    {
      sendCount: batchExplorerProbe.sendCount,
      fetchCalls: batchExplorerProbe.fetchCalls,
      receiptHashes: batchExplorerProbe.receiptCalls.map(({ hash }) => hash),
      linksLatestHash: batchSuccessNotification.includes(secondaryHash),
      linksFirstHash: batchSuccessNotification.includes(primaryHash),
    },
    {
      sendCount: 2,
      fetchCalls: 0,
      receiptHashes: [primaryHash, secondaryHash],
      linksLatestHash: true,
      linksFirstHash: false,
    },
    "batch reward claim notifications must keep the latest tx hash for explorer links",
  );
  assert.match(
    rewardScannerSource,
    /const claimReward[\s\S]*let submittedHash: `0x\$\{string\}` \| null = null;[\s\S]*const hash = await silentSend\(\{[\s\S]*to: CONTRACT_ADDRESS,[\s\S]*contractIntent: \{ contract: CONTRACT_ADDRESS, calldata: data \}[\s\S]*\}\);[\s\S]*submittedHash = hash;[\s\S]*submittedHash && err instanceof ClaimTransactionIntentError[\s\S]*Claim transaction submitted and is still pending\. Rewards will refresh after confirmation\.[\s\S]*submittedHash/,
    "single reward claims must preserve the submitted hash as pending when post-send intent verification cannot be confirmed",
  );
  assertRewardScannerPresentation();
  const singleLockProbe = runRewardScannerBehaviorProbe("single-lock");
  assert.deepEqual(
    {
      sendCount: singleLockProbe.sendCount,
      receiptCallCount: singleLockProbe.receiptCalls.length,
      fetchCalls: singleLockProbe.fetchCalls,
    },
    { sendCount: 1, receiptCallCount: 1, fetchCalls: 0 },
    "reward claims must synchronously prevent overlapping submissions",
  );
  const walletChangeProbe = runRewardScannerBehaviorProbe("wallet-change");
  assert.deepEqual(
    {
      sendCount: walletChangeProbe.sendCount,
      receiptCallCount: walletChangeProbe.receiptCalls.length,
      fetchCalls: walletChangeProbe.fetchCalls,
      postSwitchState: walletChangeProbe.postSwitchState,
    },
    {
      sendCount: 0,
      receiptCallCount: 0,
      fetchCalls: 0,
      postSwitchState: {
        status: "idle",
        walletAddress: "0x2222222222222222222222222222222222222222",
        lastVerifiedAt: null,
        incomplete: false,
        error: null,
      },
    },
    "reward claims must stop sends and stale state updates when the active wallet changes",
  );

  const rewardClaimSource = rewardScannerSource.slice(rewardScannerSource.indexOf("const claimReward"), rewardScannerSource.indexOf("return useMemo"));
  const cacheBeforeReceiptProbe = runRewardScannerBehaviorProbe("cache-before-receipt");
  const cacheAtReceipt = JSON.parse(cacheBeforeReceiptProbe.cacheAtReceipt);
  assert.deepEqual(
    {
      sendCount: cacheBeforeReceiptProbe.sendCount,
      fetchCalls: cacheBeforeReceiptProbe.fetchCalls,
      receiptCallCount: cacheBeforeReceiptProbe.receiptCalls.length,
      verifiedAt: cacheAtReceipt.verifiedAt,
      savedAt: cacheAtReceipt.savedAt,
      wins: cacheAtReceipt.wins,
      invalidatedAtIsSafe: Number.isSafeInteger(cacheAtReceipt.invalidatedAt) && cacheAtReceipt.invalidatedAt >= 1_000,
    },
    {
      sendCount: 1,
      fetchCalls: 0,
      receiptCallCount: 1,
      verifiedAt: 1_000,
      savedAt: 1_000,
      wins: [{ epoch: "7", amountWei: "11" }, { epoch: "8", amountWei: "12" }],
      invalidatedAtIsSafe: true,
    },
    "single claim submission must invalidate cache before receipt certainty",
  );
  assert.equal(
    (rewardClaimSource.match(/lastRewardClaimTxHash = hash;[\s\S]*?claimTxCount \+= 1;[\s\S]*?invalidateVerifiedRewardScanCache\(claimActor, unclaimedWinsRef\.current\);[\s\S]*?const receiptState = await waitReceipt\(hash/g) ?? []).length,
    2,
    "single and batch claim-all submissions must both invalidate cache before receipt certainty",
  );
  const cacheAfterConfirmationProbe = runRewardScannerBehaviorProbe("cache-after-confirmation");
  assert.deepEqual(
    {
      sendCount: cacheAfterConfirmationProbe.sendCount,
      fetchCalls: cacheAfterConfirmationProbe.fetchCalls,
      verifiedAt: cacheAfterConfirmationProbe.cache.verifiedAt,
      savedAt: cacheAfterConfirmationProbe.cache.savedAt,
      wins: cacheAfterConfirmationProbe.cache.wins,
      invalidatedAtIsSafe: Number.isSafeInteger(cacheAfterConfirmationProbe.cache.invalidatedAt)
        && cacheAfterConfirmationProbe.cache.invalidatedAt >= 1_000,
    },
    {
      sendCount: 1,
      fetchCalls: 0,
      verifiedAt: 1_000,
      savedAt: 1_000,
      wins: [{ epoch: "8", amountWei: "12" }],
      invalidatedAtIsSafe: true,
    },
    "confirmed claims must persist an invalidated stale cache for reload",
  );
  assert.doesNotMatch(rewardClaimSource, /saveCachedRewardScan\(/, "claim confirmation must not advance or persist the full reward-scan verification watermark");

  const deepRewardScanSource = readFileSync("app/hooks/useDeepRewardScan.ts", "utf8");
  assert.match(
    deepRewardScanSource,
    /found\.push\(\.\.\.collectOpenRewardScanWins\(\{[\s\S]*potentialWins,[\s\S]*betResults,[\s\S]*tilePoolResults,[\s\S]*resolvedAtResults,[\s\S]*chainTimestamp,[\s\S]*\}\)\)/,
    "deep reward scan must bind aligned multicall results to the tested claim-window policy",
  );
  assert.match(deepRewardScanSource, /getExplorerTxUrl/, "deep reward claim notifications must include explorer links when a tx hash is available");
  assert.match(
    deepRewardScanSource,
    /const waitReceipt = useCallback[\s\S]*waitForTrackedClaimTransactionReceiptAgreement\(intent, hash, TX_RECEIPT_TIMEOUT_MS\)/,
    "deep reward claims must remain pending until shared quorum and finality confirmation succeeds",
  );
  assert.match(deepRewardScanSource, /readJsonResponse<ClaimCandidatePage>/, "deep reward candidate scans must use the bounded JSON response helper");
  assert.match(deepRewardScanSource, /import \{ fetchWithTimeout \} from "\.\.\/lib\/fetchWithTimeout";[\s\S]*fetchWithTimeout\(`\/api\/claim-candidates\?\$\{query\.toString\(\)\}`,\s*\{ cache: "no-store" \}\)/, "deep reward candidate scans must use the shared fetch timeout helper");
  assert.doesNotMatch(deepRewardScanSource, /response\.json\(\)/, "deep reward candidate scans must not use unbounded response.json");
  assert.match(deepRewardScanSource, /const claimInFlightRef = useRef\(false\)[\s\S]*claimOne[\s\S]*claimInFlightRef\.current\) return;[\s\S]*claimInFlightRef\.current = true;[\s\S]*claimAllDeep[\s\S]*claimInFlightRef\.current\) return;[\s\S]*claimInFlightRef\.current = true;/, "deep reward claims must share a synchronous submission lock");
  assert.match(deepRewardScanSource, /claimOne[\s\S]*isAmbiguousPendingTxError\(err\)[\s\S]*!isUserRejection\(err\)[\s\S]*Reward claim rejected in wallet\./, "deep single reward claim must surface wallet rejection instead of silently clearing the claim state");
  assert.match(deepRewardScanSource, /claimOne[\s\S]*const hash = await sendTransactionSilent\(\{[\s\S]*to: CONTRACT_ADDRESS,[\s\S]*contractIntent: \{ contract: CONTRACT_ADDRESS, calldata: data \}[\s\S]*\}\);[\s\S]*try \{[\s\S]*receiptState = await waitReceipt\(hash, \{[\s\S]*actor: claimActor,[\s\S]*chainId: APP_CHAIN_ID,[\s\S]*contract: CONTRACT_ADDRESS,[\s\S]*calldata: data,[\s\S]*\}\);[\s\S]*isDefinitiveClaimRevertError\(err\)[\s\S]*markPostSendClaimVerificationError\(err, hash\)[\s\S]*const postSendHash = getPostSendClaimVerificationHash\(err\);[\s\S]*Claim transaction submitted and is still pending\. Rewards will refresh after confirmation\.[\s\S]*formatRewardClaimError\(err\)/, "deep single reward claim must bind receipt confirmation to its exact durable transaction intent and treat unknown post-send verification as pending before generic errors");
  assert.match(deepRewardScanSource, /let claimRejected = false[\s\S]*if \(isUserRejection\(err\)\) \{[\s\S]*claimRejected = true[\s\S]*if \(claimRejected && claimedEpochs\.size === 0 && !pendingClaimTx\)[\s\S]*Reward claim rejected in wallet\./, "deep batch reward claim must surface wallet rejection when no prior claim transaction succeeded or remains pending");
  assert.match(deepRewardScanSource, /function isDefinitiveClaimRevertError\(error: unknown\)[\s\S]*startsWith\("transaction reverted"\)[\s\S]*function markPostSendClaimVerificationError\(error: unknown, hash: `0x\$\{string\}`\)[\s\S]*claimTxSubmitted = true[\s\S]*function getPostSendClaimVerificationHash\(error: unknown\)[\s\S]*claimTxSubmitted === true/, "deep reward post-send receipt verification errors must carry tx hashes unless the receipt is a definitive revert");
  assert.match(deepRewardScanSource, /const hash = await sendTransactionSilent\(\{[\s\S]*to: CONTRACT_ADDRESS,[\s\S]*contractIntent: \{ contract: CONTRACT_ADDRESS, calldata: data \}[\s\S]*\}\);[\s\S]*try \{[\s\S]*receiptState = await waitReceipt\(hash, \{[\s\S]*actor: claimActor,[\s\S]*chainId: APP_CHAIN_ID,[\s\S]*contract: CONTRACT_ADDRESS,[\s\S]*calldata: data,[\s\S]*\}\);[\s\S]*isDefinitiveClaimRevertError\(err\)[\s\S]*markPostSendClaimVerificationError\(err, hash\)[\s\S]*const postSendHash = getPostSendClaimVerificationHash\(err\);[\s\S]*pendingClaimTx = true;[\s\S]*break;/, "deep reward claim-all must bind receipt confirmation to its exact durable transaction intent and stop further sends after an unknown post-send verification state");
  assert.match(deepRewardScanSource, /activeClaimAddressRef\.current = address\?\.toLowerCase\(\) \?\? null[\s\S]*const claimActor = address\.toLowerCase\(\)[\s\S]*activeClaimAddressRef\.current !== claimActor[\s\S]*claimActorChanged/, "deep reward claims must stop batches and stale state updates when the active wallet changes");
}
