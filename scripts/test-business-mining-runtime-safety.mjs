import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as autoMineRunSetupModule from "../app/lib/mining/autoMineRunSetup.ts";
import * as miningSharedModule from "../app/hooks/useMining.shared.ts";
import * as safetyPoolClaimThresholdModule from "../app/lib/safetyPoolClaimThreshold.ts";

export async function runMiningRuntimeSafetyTests() {
  const autoMineRunSetup = autoMineRunSetupModule.default ?? autoMineRunSetupModule;
  const miningShared = miningSharedModule.default ?? miningSharedModule;
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
const miningTabLockSource = readFileSync("app/hooks/useMiningTabLock.ts", "utf8");
assert.match(
  miningTabLockSource,
  /const resolvePing = \(alive: boolean\)[\s\S]*window\.clearTimeout\(timeoutId\)[\s\S]*pendingLockPingResolvers\.delete\(requestId\)[\s\S]*resolve\(alive\)[\s\S]*pending\(false\)/,
  "orphaned tab-lock ping recovery must clear its timeout when the owner responds",
);
assert.match(
  miningTabLockSource,
  /function clearInvalidStoredTabLock\(\)[\s\S]*localStorage\.removeItem\(TAB_LOCK_KEY\)[\s\S]*catch \{[\s\S]*ignore storage failures[\s\S]*export async function acquireTabLock\(\): Promise<boolean> \{[\s\S]*return acquireNativeTabLock\(\);/,
  "Auto-Miner start must require the browser's atomic tab lock instead of a localStorage fallback",
);
assert.match(
  miningTabLockSource,
  /async function acquireNativeTabLock\(\): Promise<boolean> \{[\s\S]*typeof navigator === "undefined" \|\| !navigator\.locks\) return false;[\s\S]*navigator\.locks[\s\S]*ifAvailable: true[\s\S]*mode: "exclusive"/,
  "Auto-Miner native tab lock must fail closed without Web Locks and request an exclusive non-waiting lock",
);
assert.doesNotMatch(
  miningTabLockSource.match(/export async function acquireTabLock\(\): Promise<boolean> \{[\s\S]*?\n\}/)?.[0] ?? "",
  /\.localStorage|\.setItem\(|readTabLock\(|clearTabLock\(|recoverOrphanedTabLock\(/,
  "Auto-Miner lock acquisition must not recreate a localStorage ownership fallback",
);
assert.match(
  miningTabLockSource,
  /function renewTabLock\(\)[\s\S]*if \(!lock\) \{[\s\S]*clearInvalidStoredTabLock\(\)[\s\S]*catch \{[\s\S]*clearInvalidStoredTabLock\(\)[\s\S]*function releaseTabLock\(\)[\s\S]*if \(!lock\) \{[\s\S]*clearInvalidStoredTabLock\(\)[\s\S]*catch \{[\s\S]*clearInvalidStoredTabLock\(\)/,
  "Auto-Miner tab-lock renew and release must clear corrupted localStorage instead of leaving stale locks",
);
const autoMineRunnerSource = readFileSync("app/hooks/useMiningAutoMineRunner.ts", "utf8");
assert.match(
  autoMineRunnerSource,
  /const preferredActorAddress = getPreferredActorAddress\(\);[\s\S]*actorAddress: preferredActorAddress,[\s\S]*markRunStarted: \(\) => \{[\s\S]*startedRun = true;[\s\S]*autoMineRef\.current = true;[\s\S]*if \(startRoundIndex === 0 && preferredActorAddress\) \{[\s\S]*runtimeController\.persistStart\(\{[\s\S]*actor: preferredActorAddress as `0x\$\{string\}`,[\s\S]*betStr,[\s\S]*blocks,[\s\S]*rounds,[\s\S]*if \(!preparedRun\) \{\s*if \(startedRun\) runtimeController\.clearPersistedRun\(\);[\s\S]*deactivateAutoMineUi\(\);[\s\S]*return;/,
  "Auto-Miner setup failures must not clear or overwrite persisted sessions before an exclusive tab lock starts a real run",
);
const miningLifecycleSource = readFileSync("app/hooks/useMiningLifecycle.ts", "utf8");
assert.doesNotMatch(
  miningLifecycleSource.match(/const handleAutoMineToggle = useCallback\([\s\S]*?await runAutoMiningRef\.current\(\{ betStr, blocks, rounds \}\);/)?.[0] ?? "",
  /runtimeController\.persistStart/,
  "Auto-Miner toggle must not persist a restorable run before the runner acquires the exclusive tab lock",
);
assert.match(
  autoMineRunnerSource,
  /finally \{\s*releaseInTabAutoMineRuntime\(\);\s*if \(!startedRun\) return;[\s\S]*autoMineRef\.current = false;[\s\S]*runtimeController\.finalizeRun\(stopReason\);/,
  "Auto-Miner runner must always release its in-tab runtime guard, but only finalize persisted runs after a real start",
);
assert.match(
  autoMineRunnerSource,
  /pendingNonceBlocked[\s\S]*getAutoMineRunnerCatchStopReason\(\{[\s\S]*pendingNonceBlocked,[\s\S]*if \(!sessionExpired && !networkDown && !walletUnavailable && !pendingNonceBlocked\) \{\s*runtimeController\.clearPersistedRun\(\);/,
  "Auto-Miner pending nonce pauses must preserve the persisted session for manual recovery instead of clearing it as a generic error",
);
const autoMineRuntimeControllerSource = readFileSync("app/lib/mining/autoMineRuntimeController.ts", "utf8");
assert.match(
  autoMineRuntimeControllerSource,
  /let activeRunId: string \| null = null;[\s\S]*function currentSessionMatchesActiveRun\(\)[\s\S]*current\.runId !== activeRunId[\s\S]*current\.actor\.toLowerCase\(\) !== activeActor\.toLowerCase\(\)/,
  "Auto-Miner persisted recovery must bind stale checkpoint and finalize decisions to active run id and actor",
);
assert.match(
  autoMineRuntimeControllerSource,
  /if \(!activeActor \|\| !activeRunId \|\| !activeAuthorization\) \{\s*resetActiveAuthorization\(\);\s*return;\s*\}\s*if \(!currentSessionMatchesActiveRun\(\)\) return;/,
  "inactive Auto-Miner controllers must not clear a persisted session they cannot prove they own",
);
assert.match(
  autoMineRuntimeControllerSource,
  /if \(!actorAddress \|\| saved\.actor\.toLowerCase\(\) !== actorAddress\.toLowerCase\(\)\) \{\s*resetActiveAuthorization\(\);\s*return \{ kind: "actor-mismatch" \};\s*\}/,
  "Auto-Miner restore checks for a different actor must not clear another actor's saved run",
);
const autoMineRunSetupSource = readFileSync("app/lib/mining/autoMineRunSetup.ts", "utf8");
const tabLockGateIndex = autoMineRunSetupSource.indexOf("if (!(await acquireTabLock())");
const tabLockRecoveryIndex = autoMineRunSetupSource.indexOf("recoverOrphanedTabLock()");
const tabLockAbortIndex = autoMineRunSetupSource.indexOf("exclusive tab lock unavailable - aborting start");
const runStartedIndex = autoMineRunSetupSource.indexOf("markRunStarted()");
const activeUiIndex = autoMineRunSetupSource.indexOf("setIsAutoMining(true)");
const walletWaitIndex = autoMineRunSetupSource.indexOf('onProgress("Waiting for wallet...")');
const bootstrapIndex = autoMineRunSetupSource.indexOf("const bootstrapReady = await prepareAutoMineBootstrap");
assert.notEqual(tabLockGateIndex, -1, "Auto-Miner setup must require an exclusive tab lock before starting");
assert.notEqual(tabLockRecoveryIndex, -1, "Auto-Miner setup must attempt orphaned tab-lock recovery before failing");
assert.notEqual(tabLockAbortIndex, -1, "Auto-Miner setup must fail closed when tab-lock acquisition is unavailable");
assert.notEqual(runStartedIndex, -1, "Auto-Miner setup must mark a run only after lock acquisition");
assert.notEqual(activeUiIndex, -1, "Auto-Miner setup must activate UI only after lock acquisition");
assert.notEqual(walletWaitIndex, -1, "Auto-Miner setup must keep wallet wait visible only after lock acquisition");
assert.notEqual(bootstrapIndex, -1, "Auto-Miner setup must keep approval/bootstrap behind lock acquisition");
assert.ok(
  tabLockGateIndex < tabLockAbortIndex &&
    tabLockAbortIndex < runStartedIndex &&
    tabLockAbortIndex < activeUiIndex &&
    tabLockAbortIndex < walletWaitIndex &&
    tabLockAbortIndex < bootstrapIndex,
  "Auto-Miner must not enter running, wallet-wait, or approval/bootstrap state before the exclusive tab lock is acquired",
);
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
  assert.deepEqual(readContracts, ["balanceOf", "allowance"]);
  assert.equal(clearPendingApproveCalls, 1, "sufficient allowance after lock recovery must clear stale approval state");
  assert.equal(ensureWalletCalls, 0, "sufficient allowance after lock recovery must not request wallet approval");
  assert.equal(writeApproveCalls, 0, "sufficient allowance after lock recovery must not send an approval transaction");
  assert.equal(silentSendCalls, 0, "sufficient allowance after lock recovery must not use silent transaction send");
  assert.equal(nativeGasChecks, 0, "sufficient allowance after lock recovery must not run approval gas checks");
  assert.equal(prepared.singleAmountRaw, enoughLinea);
}

}

