import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as autoMineRunnerModule from "../app/hooks/useMiningAutoMineRunner.ts";
import * as autoMineRunSetupModule from "../app/lib/mining/autoMineRunSetup.ts";
import * as autoMineRuntimeControllerModule from "../app/lib/mining/autoMineRuntimeController.ts";
import * as miningSharedModule from "../app/hooks/useMining.shared.ts";
import * as miningTabLockModule from "../app/hooks/useMiningTabLock.ts";
import * as safetyPoolClaimThresholdModule from "../app/lib/safetyPoolClaimThreshold.ts";

export async function runMiningRuntimeSafetyTests() {
  const autoMineRunSetup = autoMineRunSetupModule.default ?? autoMineRunSetupModule;
  const autoMineRunner = autoMineRunnerModule.default ?? autoMineRunnerModule;
  const autoMineRuntimeController = autoMineRuntimeControllerModule.default ?? autoMineRuntimeControllerModule;
  const miningShared = miningSharedModule.default ?? miningSharedModule;
  const miningTabLock = miningTabLockModule.default ?? miningTabLockModule;
  const safetyPoolClaimThreshold = safetyPoolClaimThresholdModule.default ?? safetyPoolClaimThresholdModule;

assert.equal(safetyPoolClaimThreshold.parseMinSafetyPoolClaimWei("100"), 100_000_000_000_000_000_000n);
assert.equal(safetyPoolClaimThreshold.parseMinSafetyPoolClaimWei("bad"), 100_000_000_000_000_000_000n);
assert.equal(safetyPoolClaimThreshold.isSafetyPoolClaimBelowMinimum(1n, 2n), true);
assert.deepEqual(
  miningShared.sanitizePersistedAutoMinerSession({
    active: true,
    runId: "run:test-session",
    actor: "0x0000000000000000000000000000000000000001",
    betStr: "1.5",
    blocks: 3,
    rounds: 5,
    nextRoundIndex: 2,
    lastPlacedEpoch: "10",
  }),
  {
    active: false,
    runId: "run:test-session",
    actor: "0x0000000000000000000000000000000000000001",
    betStr: "1.5",
    blocks: 3,
    rounds: 5,
    nextRoundIndex: 2,
    lastPlacedEpoch: "10",
    issuedAt: 0,
    expiresAt: 0,
    maxSpendPerBetRaw: "4500000000000000000",
    totalSpendRaw: "22500000000000000000",
    remainingSpendRaw: "13500000000000000000",
  },
  "legacy Auto-Miner sessions must migrate to a paused, exact-spend envelope",
);
const validAutoMinerSession = {
  active: true,
  runId: "run:test-session",
  actor: "0x0000000000000000000000000000000000000001",
  betStr: "1.5",
  blocks: 3,
  rounds: 5,
  nextRoundIndex: 2,
  lastPlacedEpoch: "10",
};
for (const [field, value] of [
  ["blocks", 3.5],
  ["blocks", Number.MAX_SAFE_INTEGER + 1],
  ["rounds", 5.5],
  ["rounds", Number.MAX_SAFE_INTEGER + 1],
  ["nextRoundIndex", 2.5],
  ["nextRoundIndex", Number.MAX_SAFE_INTEGER + 1],
]) {
  assert.equal(
    miningShared.sanitizePersistedAutoMinerSession({
      ...validAutoMinerSession,
      [field]: value,
    }),
    null,
    `Auto-Miner persisted session must reject unsafe ${field} value ${String(value)}`,
  );
}

assert.equal(
  miningShared.sanitizePersistedAutoMinerSession({
    active: true,
    runId: "https://rpc.example.test/secret",
    actor: "0x0000000000000000000000000000000000000001",
    betStr: "1.5",
    blocks: 3,
    rounds: 5,
    nextRoundIndex: 2,
    lastPlacedEpoch: "10",
  }),
  null,
  "Auto-Miner session run ids must be bounded local tokens, not URLs or secret-bearing strings",
);
for (const lastPlacedEpoch of ["001", "1e3", "-1", "9".repeat(79)]) {
  assert.equal(
    miningShared.sanitizePersistedAutoMinerSession({
      ...validAutoMinerSession,
      lastPlacedEpoch,
    }),
    null,
    `Auto-Miner persisted session must reject corrupted lastPlacedEpoch ${lastPlacedEpoch.slice(0, 12)}`,
  );
}
assert.equal(
  miningShared.sanitizePersistedAutoMinerSession({
    active: true,
    betStr: "1.5",
    blocks: 3,
    rounds: 5,
    nextRoundIndex: 2,
    lastPlacedEpoch: "10",
  }),
  null,
  "legacy actor-free sessions must never resume",
);
assert.equal(
  miningShared.sanitizePersistedAutoMinerSession({
    active: true,
    actor: "0x0000000000000000000000000000000000000001",
    betStr: "1e3",
    blocks: 3,
    rounds: 5,
    nextRoundIndex: 2,
    lastPlacedEpoch: "10",
  }),
  null,
);
assert.equal(
  miningShared.sanitizePersistedAutoMinerSession({
    active: true,
    actor: "0x0000000000000000000000000000000000000001",
    betStr: "1",
    blocks: 26,
    rounds: 5,
    nextRoundIndex: 2,
    lastPlacedEpoch: "10",
  }),
  null,
);
assert.equal(
  miningShared.sanitizePersistedAutoMinerSession({
    active: true,
    actor: "0x0000000000000000000000000000000000000001",
    betStr: "1",
    blocks: 3,
    rounds: 5,
    nextRoundIndex: 6,
    lastPlacedEpoch: "10",
  }),
  null,
);
assert.equal(
  miningShared.sanitizePersistedAutoMinerSession({
    active: true,
    actor: "0x0000000000000000000000000000000000000001",
    betStr: "1",
    blocks: 3,
    rounds: miningShared.MAX_AUTO_MINER_CYCLES + 1,
    nextRoundIndex: 2,
    lastPlacedEpoch: "10",
  }),
  null,
);
const previousAutoMinerWindow = globalThis.window;
try {
  const storage = new Map();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      dispatchEvent: () => true,
      localStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key),
      },
    },
  });
  storage.set(miningShared.AUTO_MINER_STORAGE_KEY, "{bad json");
  assert.equal(miningShared.readSession(), null);
  assert.equal(storage.has(miningShared.AUTO_MINER_STORAGE_KEY), false, "corrupt Auto-Miner session must be cleared");
  storage.set(miningShared.AUTO_MINER_STORAGE_KEY, JSON.stringify({ active: true, betStr: "1", blocks: 3, rounds: 5, nextRoundIndex: 0 }));
  assert.equal(miningShared.readSession(), null);
  assert.equal(storage.has(miningShared.AUTO_MINER_STORAGE_KEY), false, "invalid Auto-Miner session must be cleared");
} finally {
  if (previousAutoMinerWindow === undefined) {
    delete globalThis.window;
  } else {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: previousAutoMinerWindow,
    });
  }
}
assert.deepEqual(
  miningShared.sanitizeTabLock({ id: "tab-1", ts: 123, tx: "nonce-1" }),
  { id: "tab-1", ts: 123, tx: "nonce-1" },
);
assert.deepEqual(
  miningShared.sanitizeTabLock({ id: "tab-1", ts: 123, tx: "  nonce-1  " }),
  { id: "tab-1", ts: 123, tx: "nonce-1" },
);
assert.deepEqual(
  miningShared.sanitizeTabLock({ id: "tab-1", ts: 123, tx: 999 }),
  { id: "tab-1", ts: 123 },
);
assert.deepEqual(
  miningShared.sanitizeTabLock({ id: "tab-1", ts: 123, tx: "https://rpc.example.test/private" }),
  { id: "tab-1", ts: 123 },
);
assert.deepEqual(
  miningShared.sanitizeTabLock({ id: "tab-1", ts: 123, tx: "x".repeat(97) }),
  { id: "tab-1", ts: 123 },
);
assert.deepEqual(
  miningShared.sanitizeTabLock({ id: "tab-1", ts: 123, tx: "nonce\n1" }),
  { id: "tab-1", ts: 123 },
);
assert.equal(miningShared.sanitizeTabLock({ id: "", ts: 123 }), null);
assert.equal(miningShared.sanitizeTabLock({ id: "tab-1", ts: Number.NaN }), null);
assert.equal(miningShared.sanitizeTabLock({ id: "tab-1", ts: 123.5 }, 200), null);
assert.equal(miningShared.sanitizeTabLock({ id: "tab-1", ts: Number.MAX_SAFE_INTEGER + 1 }, 200), null);
assert.equal(miningShared.sanitizeTabLock({ id: "tab-1", ts: 123 }, 200.5), null);
assert.equal(miningShared.sanitizeTabLock({ id: "tab-1", ts: 123 }, -1), null);
assert.equal(miningShared.sanitizeTabLock({ id: "tab-1", ts: Date.now() + 60_000 }), null);
{
  const previousWindow = globalThis.window;
  const sessionStorage = new Map();
  try {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        sessionStorage: {
          getItem: (key) => sessionStorage.get(key) ?? null,
          setItem: (key, value) => sessionStorage.set(key, String(value)),
          removeItem: (key) => sessionStorage.delete(key),
        },
      },
    });
    const validTabId = "11111111-1111-4111-8111-111111111111";
    const initialTabId = miningShared.getStableTabId();
    const tabStorageKey = [...sessionStorage.keys()].find((key) => key.startsWith("lore:auto-mine-tab-id:"));
    assert.ok(tabStorageKey, "stable Auto-Miner tab id must be stored under the scoped sessionStorage key");
    assert.equal(sessionStorage.get(tabStorageKey), initialTabId);
    sessionStorage.set(tabStorageKey, validTabId);
    assert.equal(miningShared.getStableTabId(), validTabId);
    sessionStorage.set(tabStorageKey, "bad-tab-id");
    const repairedTabId = miningShared.getStableTabId();
    assert.notEqual(repairedTabId, "bad-tab-id");
    assert.equal(sessionStorage.get(tabStorageKey), repairedTabId);
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow,
      });
    }
  }
}
assert.equal(miningShared.getSecureRandomNumber(0), 0);
assert.equal(miningShared.getSecureRandomNumber(Number.NaN), 0);
const miningSharedSource = readFileSync("app/hooks/useMining.shared.ts", "utf8");
assert.match(
  miningSharedSource,
  /MAX_TIMER_DELAY_MS = 2_147_483_647[\s\S]*export function withMiningRpcTimeout[\s\S]*Number\.isSafeInteger\(timeoutMs\)[\s\S]*timeoutMs <= 0[\s\S]*timeoutMs > MAX_TIMER_DELAY_MS[\s\S]*timeout must be between 1 and 2147483647 milliseconds/,
  "mining RPC timeout helper must reject fractional, unsafe, or oversized timer delays",
);
assert.match(
  miningSharedSource,
  /function isValidStableTabId[\s\S]*window\.sessionStorage\.getItem\(storageKey\)[\s\S]*isValidStableTabId\(existing\)[\s\S]*window\.sessionStorage\.removeItem\(storageKey\)/,
  "Auto-Miner stable tab id restore must clear invalid sessionStorage entries",
);
assert.match(
  miningSharedSource,
  /function getSecureRandomNumber[\s\S]*const bound = Math\.floor\(max\)[\s\S]*bound > 0x1_0000_0000[\s\S]*const limit = Math\.floor\(0x1_0000_0000 \/ bound\) \* bound[\s\S]*while \(array\[0\] >= limit\)[\s\S]*return array\[0\] % bound/,
  "Auto-Miner tab-lock random markers should bound inputs and avoid modulo bias when native crypto is available",
);
assert.match(
  miningSharedSource,
  /export function sanitizePersistedAutoMinerSession\(value: unknown\)[\s\S]*Number\.isSafeInteger\(blocks\)[\s\S]*Number\.isSafeInteger\(rounds\)[\s\S]*Number\.isSafeInteger\(nextRoundIndex\)/,
  "Auto-Miner persisted session sanitizer must reject unsafe numeric recovery metadata",
);
assert.match(
  miningSharedSource,
  /AUTO_MINER_EPOCH_RE = \/\^\(\?:0\|\[1-9\]\\d\{0,77\}\)\$\/[\s\S]*AUTO_MINER_EPOCH_RE\.test\(lastPlacedEpoch\)/,
  "Auto-Miner persisted session sanitizer must bound lastPlacedEpoch before resume BigInt parsing",
);
assert.doesNotMatch(
  miningSharedSource.match(/export function sanitizePersistedAutoMinerSession\(value: unknown\)[\s\S]*?\n\}/)?.[0] ?? "",
  /Number\.isInteger\((?:blocks|rounds|nextRoundIndex)\)|\/\^\\d\+\$\/\.test\(lastPlacedEpoch\)/,
  "Auto-Miner persisted session sanitizer must not use broad integer checks or unbounded epoch strings for recovery metadata",
);
assert.match(
  miningSharedSource,
  /TAB_LOCK_TX_TOKEN_RE = \/\^\[a-zA-Z0-9:._-\]\{1,96\}\$\/[\s\S]*export function sanitizeTabLock\(value: unknown, now = Date\.now\(\)\)[\s\S]*Number\.isSafeInteger\(ts\)[\s\S]*Number\.isSafeInteger\(now\)[\s\S]*ts - now > TAB_LOCK_MAX_FUTURE_SKEW_MS[\s\S]*const cleanTx = typeof tx === "string" \? tx\.trim\(\) : ""[\s\S]*TAB_LOCK_TX_TOKEN_RE\.test\(cleanTx\)/,
  "Auto-Miner tab-lock sanitizer must reject unsafe timestamps and keep persisted tx markers bounded before orphan recovery",
);
assert.doesNotMatch(
  miningSharedSource,
  /typeof ts !== "number" \|\| !Number\.isFinite\(ts\) \|\| ts <= 0/,
  "Auto-Miner tab-lock sanitizer must not use broad finite timestamp checks",
);
{
  const requests = [];
  let held = false;
  const lockManager = {
    async request(name, options, callback) {
      requests.push({ name, options: { ...options } });
      if (held) return callback(null);
      held = true;
      try {
        return await callback({ name, mode: options.mode });
      } finally {
        held = false;
      }
    },
  };
  const firstTab = miningTabLock.createNativeTabLockController(() => lockManager);
  const secondTab = miningTabLock.createNativeTabLockController(() => lockManager);
  assert.equal(await firstTab.acquire(), true, "first tab must acquire the native browser lock");
  assert.equal(held, true, "the browser lock must remain held while Auto-Miner owns it");
  assert.equal(await firstTab.acquire(), true, "re-entrant acquisition in the owning tab must reuse its lock");
  assert.equal(requests.length, 1, "re-entrant acquisition must not enqueue another browser lock request");
  assert.equal(await secondTab.acquire(), false, "a competing tab must fail closed instead of waiting or falling back");
  assert.deepEqual(
    requests.map(({ name, options }) => ({ name, options })),
    [
      { name: miningShared.TAB_LOCK_KEY, options: { ifAvailable: true, mode: "exclusive" } },
      { name: miningShared.TAB_LOCK_KEY, options: { ifAvailable: true, mode: "exclusive" } },
    ],
    "every native lock request must be exclusive and non-waiting",
  );
  firstTab.release();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(held, false, "release must relinquish the native browser lock");
  assert.equal(await secondTab.acquire(), true, "another tab may acquire only after the previous owner releases");
  secondTab.release();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(await miningTabLock.createNativeTabLockController(() => null).acquire(), false, "missing Web Locks must fail closed");
  assert.equal(
    await miningTabLock
      .createNativeTabLockController(() => ({ request: async () => Promise.reject(new Error("synthetic lock failure")) }))
      .acquire(),
    false,
    "Web Lock request failures must fail closed",
  );
}

{
  const ACTOR_A = "0x0000000000000000000000000000000000000001";
  const ACTOR_B = "0x0000000000000000000000000000000000000002";
  const createHarness = () => {
    let session = null;
    let clearCalls = 0;
    let releaseCalls = 0;
    const controller = autoMineRuntimeController.createAutoMineRuntimeController({
      clearSession: () => {
        clearCalls += 1;
        session = null;
      },
      readSession: () => session,
      releaseTabLock: () => {
        releaseCalls += 1;
      },
      saveSession: (next) => {
        session = next;
      },
      now: () => 1_800_000_000_000,
    });
    return {
      controller,
      read: () => session,
      replace: (next) => {
        session = next;
      },
      stats: () => ({ clearCalls, releaseCalls }),
    };
  };

  const runOwner = createHarness();
  runOwner.controller.persistStart({ actor: ACTOR_A, betStr: "1", blocks: 1, rounds: 3 });
  const ownedSession = runOwner.read();
  assert.ok(ownedSession?.runId, "an acquired Auto-Miner run must persist an ownership id");
  const foreignRun = { ...ownedSession, runId: "run:foreign-owner", nextRoundIndex: 1 };
  runOwner.replace(foreignRun);
  runOwner.controller.persistCheckpoint({
    betStr: "1",
    blocks: 1,
    rounds: 3,
    nextRoundIndex: 2,
    lastPlacedEpoch: 22n,
  });
  runOwner.controller.finalizeRun("completed");
  assert.deepEqual(runOwner.read(), foreignRun, "stale run ids must not checkpoint or clear another run's persisted state");
  assert.deepEqual(runOwner.stats(), { clearCalls: 0, releaseCalls: 1 });

  const actorOwner = createHarness();
  actorOwner.controller.persistStart({ actor: ACTOR_A, betStr: "1", blocks: 1, rounds: 3 });
  const foreignActor = { ...actorOwner.read(), actor: ACTOR_B };
  actorOwner.replace(foreignActor);
  actorOwner.controller.stopByUser();
  assert.deepEqual(actorOwner.read(), foreignActor, "a stale actor must not clear another wallet's persisted run");
  assert.deepEqual(actorOwner.stats(), { clearCalls: 0, releaseCalls: 1 });

  const restoreOwner = createHarness();
  restoreOwner.replace({ ...ownedSession, active: true, actor: ACTOR_B });
  assert.equal(restoreOwner.controller.readRestorableRun(ACTOR_A).kind, "actor-mismatch");
  assert.equal(restoreOwner.read()?.active, false, "actor-mismatched recovery must pause the saved run");
  assert.equal(restoreOwner.read()?.actor, ACTOR_B, "actor-mismatched recovery must retain the saved owner");
  assert.equal(restoreOwner.read()?.runId, ownedSession.runId, "actor-mismatched recovery must retain the saved run id");
  assert.equal(restoreOwner.stats().clearCalls, 0, "actor-mismatched recovery must not delete another owner's run");

  const pendingNonce = createHarness();
  pendingNonce.controller.persistStart({ actor: ACTOR_A, betStr: "1", blocks: 1, rounds: 3 });
  const pendingRunId = pendingNonce.read()?.runId;
  const disposition = autoMineRunner.getAutoMineRunnerFailureDisposition({
    epochWaitTimeout: false,
    networkDown: false,
    pendingNonceBlocked: true,
    sessionExpired: false,
    walletUnavailable: false,
  });
  assert.deepEqual(disposition, {
    phase: "idle",
    shouldAutoResume: false,
    shouldClearPersistedRun: false,
  });
  if (disposition.shouldClearPersistedRun) pendingNonce.controller.clearPersistedRun();
  pendingNonce.controller.finalizeRun("pending-nonce-blocked");
  assert.equal(pendingNonce.read()?.active, false, "pending nonce must pause rather than delete the persisted run");
  assert.equal(pendingNonce.read()?.runId, pendingRunId, "pending nonce pause must retain the owned run id");
  assert.equal(pendingNonce.read()?.actor, ACTOR_A, "pending nonce pause must retain the authorized actor");
  assert.deepEqual(pendingNonce.stats(), { clearCalls: 0, releaseCalls: 1 });
  assert.equal(
    pendingNonce.controller.readRestorableRun(ACTOR_A).kind,
    "paused",
    "the owning actor must be able to discover the paused run before an explicit fresh authorization",
  );
  pendingNonce.controller.persistStart({ actor: ACTOR_A, betStr: "1", blocks: 1, rounds: 3 });
  assert.equal(pendingNonce.read()?.active, true, "explicit same-actor restart must create a newly authorized active run");
  assert.notEqual(
    pendingNonce.read()?.runId,
    pendingRunId,
    "pending nonce recovery must not reuse the paused run's authorization id",
  );

  assert.deepEqual(
    autoMineRunner.getAutoMineRunnerFailureDisposition({
      epochWaitTimeout: false,
      networkDown: true,
      pendingNonceBlocked: false,
      sessionExpired: false,
      walletUnavailable: false,
    }),
    { phase: "retry-wait", shouldAutoResume: true, shouldClearPersistedRun: false },
  );
  assert.deepEqual(
    autoMineRunner.getAutoMineRunnerFailureDisposition({
      epochWaitTimeout: false,
      networkDown: false,
      pendingNonceBlocked: false,
      sessionExpired: false,
      walletUnavailable: false,
    }),
    { phase: "idle", shouldAutoResume: false, shouldClearPersistedRun: true },
    "unclassified failures must still clear a potentially unsafe run",
  );
}
{
  let markRunStartedCalls = 0;
  let ensureWalletCalls = 0;
  let silentSendReads = 0;
  let writeApproveCalls = 0;
  let nativeGasChecks = 0;
  let clearedSessions = 0;
  const progressMessages = [];
  const runningParams = [];
  const miningStates = [];
  const prepared = await autoMineRunSetup.prepareAutoMineRunSetup({
    acquireTabLock: async () => false,
    actorAddress: "0x0000000000000000000000000000000000000001",
    approveRetryMax: 1,
    assertNativeGasBalance: async () => {
      nativeGasChecks += 1;
    },
    autoMineActive: () => true,
    betStr: "1",
    blocks: 1,
    clearPendingApprove: () => {},
    ensurePreferredWallet: async () => {
      ensureWalletCalls += 1;
    },
    getUrgentFees: async () => undefined,
    markRunStarted: () => {
      markRunStartedCalls += 1;
    },
    maxNetworkAttempts: 1,
    maxNetworkMs: 1,
    minGasApprove: 1n,
    networkInitialMs: 1,
    onClearPersistedSession: () => {
      clearedSessions += 1;
    },
    onProgress: (message) => {
      progressMessages.push(message);
    },
    pendingApproveRef: { current: null },
    publicClient: {},
    readSilentSend: () => {
      silentSendReads += 1;
      return undefined;
    },
    recoverOrphanedTabLock: async () => false,
    refetchAllowance: () => {},
    rounds: 1,
    setIsAutoMining: (value) => {
      miningStates.push(value);
    },
    setRunningParams: (value) => {
      runningParams.push(value);
    },
    setSelectedTiles: () => {},
    setSelectedTilesEpoch: () => {},
    startRoundIndex: 0,
    waitReceipt: async () => "confirmed",
    writeApprove: async () => {
      writeApproveCalls += 1;
      return "0x0000000000000000000000000000000000000000000000000000000000000000";
    },
  });
  assert.equal(prepared, null, "Auto-Miner setup must return null when exclusive tab lock cannot be acquired");
  assert.equal(markRunStartedCalls, 0, "Auto-Miner must not mark a run started without an exclusive tab lock");
  assert.equal(ensureWalletCalls, 0, "Auto-Miner must not touch wallet readiness before the exclusive tab lock");
  assert.equal(silentSendReads, 0, "Auto-Miner must not read wallet send functions before the exclusive tab lock");
  assert.equal(writeApproveCalls, 0, "Auto-Miner must not approve before the exclusive tab lock");
  assert.equal(nativeGasChecks, 0, "Auto-Miner must not run gas checks before the exclusive tab lock");
  assert.equal(clearedSessions, 0, "Auto-Miner lock failure must not clear persisted sessions through bootstrap failure handling");
  assert.deepEqual(miningStates, [false]);
  assert.deepEqual(runningParams, [null]);
  assert.deepEqual(progressMessages, [
    "Auto-Miner needs an exclusive tab lock. Close other mining tabs or use a current browser.",
    null,
  ]);
}
{
  const lockAttempts = [];
  let recoverCalls = 0;
  let markRunStartedCalls = 0;
  let ensureWalletCalls = 0;
  let writeApproveCalls = 0;
  let silentSendCalls = 0;
  let nativeGasChecks = 0;
  let clearPendingApproveCalls = 0;
  const progressMessages = [];
  const miningStates = [];
  const runningParams = [];
  const selectedTiles = [];
  const selectedEpochs = [];
  const readContracts = [];
  const enoughLinea = 10n ** 18n;
  const publicClient = {
    readContract: async ({ functionName }) => {
      readContracts.push(functionName);
      return enoughLinea;
    },
  };
  const previousFetch = globalThis.fetch;
  let agreementFetchCalls = 0;
  globalThis.fetch = async (_input, init) => {
    agreementFetchCalls += 1;
    const payload = JSON.parse(String(init?.body ?? "{}"));
    const result = `0x${enoughLinea.toString(16).padStart(64, "0")}`;
    const reply = (request) => ({ jsonrpc: "2.0", id: request.id, result });
    return new Response(JSON.stringify(Array.isArray(payload) ? payload.map(reply) : reply(payload)), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  };
  try {
  const prepared = await autoMineRunSetup.prepareAutoMineRunSetup({
    acquireTabLock: async () => {
      lockAttempts.push(lockAttempts.length + 1);
      return lockAttempts.length === 2;
    },
    actorAddress: "0x0000000000000000000000000000000000000001",
    approveRetryMax: 1,
    assertNativeGasBalance: async () => {
      nativeGasChecks += 1;
    },
    autoMineActive: () => true,
    betStr: "1",
    blocks: 1,
    clearPendingApprove: () => {
      clearPendingApproveCalls += 1;
    },
    ensurePreferredWallet: async () => {
      ensureWalletCalls += 1;
    },
    getUrgentFees: async () => undefined,
    markRunStarted: () => {
      markRunStartedCalls += 1;
    },
    maxNetworkAttempts: 1,
    maxNetworkMs: 1,
    minGasApprove: 1n,
    networkInitialMs: 1,
    onClearPersistedSession: () => {},
    onProgress: (message) => {
      progressMessages.push(message);
    },
    pendingApproveRef: { current: null },
    publicClient,
    readSilentSend: () => async () => {
      silentSendCalls += 1;
      return "0x0000000000000000000000000000000000000000000000000000000000000000";
    },
    recoverOrphanedTabLock: async () => {
      recoverCalls += 1;
      return true;
    },
    refetchAllowance: () => {},
    rounds: 1,
    setIsAutoMining: (value) => {
      miningStates.push(value);
    },
    setRunningParams: (value) => {
      runningParams.push(value);
    },
    setSelectedTiles: (tiles) => {
      selectedTiles.push(tiles);
    },
    setSelectedTilesEpoch: (epoch) => {
      selectedEpochs.push(epoch);
    },
    startRoundIndex: 0,
    waitReceipt: async () => "confirmed",
    writeApprove: async () => {
      writeApproveCalls += 1;
      return "0x0000000000000000000000000000000000000000000000000000000000000000";
    },
  });
  assert.ok(prepared, "Auto-Miner setup must continue after orphan recovery and second lock acquisition");
  assert.deepEqual(lockAttempts, [1, 2], "Auto-Miner orphan recovery must retry the exclusive tab lock exactly once");
  assert.equal(recoverCalls, 1, "Auto-Miner setup must attempt orphaned lock recovery after the first lock miss");
  assert.equal(markRunStartedCalls, 1, "Auto-Miner must mark a run only after recovered exclusive lock acquisition");
  assert.deepEqual(miningStates, [true], "Auto-Miner UI must enter running only after recovered exclusive lock acquisition");
  assert.deepEqual(runningParams, [{ betStr: "1", blocks: 1, rounds: 1 }]);
  assert.deepEqual(selectedTiles, [[]]);
  assert.deepEqual(selectedEpochs, [null]);
  assert.deepEqual(progressMessages, ["1 / 1"]);
  assert.deepEqual(readContracts, ["balanceOf"]);
  assert.equal(agreementFetchCalls, 2, "Auto-Miner allowance admission must require both independent agreement clients");
  assert.equal(clearPendingApproveCalls, 1, "sufficient allowance after lock recovery must clear stale approval state");
  assert.equal(ensureWalletCalls, 0, "sufficient allowance after lock recovery must not request wallet approval");
  assert.equal(writeApproveCalls, 0, "sufficient allowance after lock recovery must not send an approval transaction");
  assert.equal(silentSendCalls, 0, "sufficient allowance after lock recovery must not use silent transaction send");
  assert.equal(nativeGasChecks, 0, "sufficient allowance after lock recovery must not run approval gas checks");
  assert.equal(prepared.singleAmountRaw, enoughLinea);
  } finally {
    globalThis.fetch = previousFetch;
  }
}

}

if (process.argv.includes("--focused-mining-runtime-safety")) {
  await runMiningRuntimeSafetyTests();
  console.log("MINING_RUNTIME_FOCUSED_PASS");
}
