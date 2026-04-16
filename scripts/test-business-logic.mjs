import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import * as utilsModule from "../app/lib/utils.ts";
import * as chatAvatarUploadModule from "../app/lib/chatAvatarUpload.ts";
import * as networkRetryModule from "../app/lib/mining/networkRetry.ts";
import * as manualMineAttemptModule from "../app/lib/mining/manualMineAttempt.ts";
import * as autoMineLoopModule from "../app/hooks/useMiningAutoMineLoop.ts";
import * as autoMineLoopModelModule from "../app/lib/mining/autoMineLoopModel.ts";
import * as autoMineLoopPreludePlannerModule from "../app/lib/mining/autoMineLoopPreludePlanner.ts";
import * as autoMineLoopRoundOutcomeModule from "../app/lib/mining/autoMineLoopRoundOutcome.ts";
import * as autoMineLoopRetryPlannerModule from "../app/lib/mining/autoMineLoopRetryPlanner.ts";
import * as autoMineLoopTransitionPlannerModule from "../app/lib/mining/autoMineLoopTransitionPlanner.ts";
import * as autoMineDiagnosticsModule from "../app/lib/mining/autoMineDiagnostics.ts";
import * as autoMineDebugOverrideModule from "../app/lib/mining/autoMineDebugOverride.ts";
import * as routeCacheModule from "../app/api/_lib/routeCache.ts";
import * as autoMineRuntimeControllerModule from "../app/lib/mining/autoMineRuntimeController.ts";
import * as autoMineErrorModule from "../app/hooks/useMiningAutoMineError.ts";
import * as autoMineRestoreDeduperModule from "../app/lib/mining/autoMineRestoreDeduper.ts";
import * as chunkReloadRecoveryModule from "../app/lib/chunkReloadRecovery.ts";
import * as miningSharedModule from "../app/hooks/useMining.shared.ts";

async function main() {
  const utils = utilsModule.default ?? utilsModule;
  const chatAvatarUpload = chatAvatarUploadModule.default ?? chatAvatarUploadModule;
  const networkRetry = networkRetryModule.default ?? networkRetryModule;
  const manualMineAttempt = manualMineAttemptModule.default ?? manualMineAttemptModule;
  const autoMineLoop = autoMineLoopModule.default ?? autoMineLoopModule;
  const autoMineLoopModel = autoMineLoopModelModule.default ?? autoMineLoopModelModule;
  const autoMineLoopPreludePlanner = autoMineLoopPreludePlannerModule.default ?? autoMineLoopPreludePlannerModule;
  const autoMineLoopRoundOutcome = autoMineLoopRoundOutcomeModule.default ?? autoMineLoopRoundOutcomeModule;
  const autoMineLoopRetryPlanner = autoMineLoopRetryPlannerModule.default ?? autoMineLoopRetryPlannerModule;
  const autoMineLoopTransitionPlanner = autoMineLoopTransitionPlannerModule.default ?? autoMineLoopTransitionPlannerModule;
  const autoMineDiagnostics = autoMineDiagnosticsModule.default ?? autoMineDiagnosticsModule;
  const autoMineDebugOverride = autoMineDebugOverrideModule.default ?? autoMineDebugOverrideModule;
  const routeCache = routeCacheModule.default ?? routeCacheModule;
  const autoMineRuntimeController = autoMineRuntimeControllerModule.default ?? autoMineRuntimeControllerModule;
  const autoMineError = autoMineErrorModule.default ?? autoMineErrorModule;
  const autoMineRestoreDeduper = autoMineRestoreDeduperModule.default ?? autoMineRestoreDeduperModule;
  const chunkReloadRecovery = chunkReloadRecoveryModule.default ?? chunkReloadRecoveryModule;
  const miningShared = miningSharedModule.default ?? miningSharedModule;

  assert.equal(utils.normalizeDecimalInput("1,25"), "1.25");
  assert.equal(utils.validateBetAmount(""), "Enter an amount");
  assert.equal(utils.validateBetAmount("   "), "Enter an amount");
  assert.equal(utils.validateBetAmount("0"), "Amount must be greater than 0");
  assert.equal(utils.validateBetAmount("-1"), "Amount must be greater than 0");
  assert.equal(utils.validateBetAmount("1e3"), "Invalid amount");
  assert.equal(utils.validateBetAmount("1,25"), null);
  assert.equal(utils.validateBetAmount("0.0001"), null);

  assert.equal(utils.safeParseFloat("1.5"), 1.5);
  assert.equal(utils.safeParseFloat("1e309"), 0);
  assert.equal(utils.safeParseFloat("NaN"), 0);
  assert.equal(utils.safeToFixed(12.345, 2), "12.35");
  assert.equal(utils.safeToFixed(Number.NaN, 2), "0.00");
  assert.equal(utils.safeToFixed(Number.POSITIVE_INFINITY, 2, "fallback"), "fallback");

  assert.equal(
    chatAvatarUpload.validateCustomAvatarFile({ type: "text/plain", size: 42 }),
    "Use a JPG, PNG, GIF, or WEBP image.",
  );
  assert.equal(
    chatAvatarUpload.validateCustomAvatarFile({ type: "image/png", size: 5 * 1024 * 1024 + 1 }),
    "Image must be 5 MB or smaller.",
  );
  assert.equal(chatAvatarUpload.validateCustomAvatarFile({ type: "image/webp", size: 2048 }), null);

  assert.equal(networkRetry.getNetworkRetryDelayMs(0, 500, 10_000), 500);
  assert.equal(networkRetry.getNetworkRetryDelayMs(3, 500, 10_000), 4_000);
  assert.equal(networkRetry.getNetworkRetryDelayMs(4, 500, 10_000, 2), 2_000);

  const diagnosticsStorage = (() => {
    const map = new Map();
    return {
      getItem: (key) => map.get(key) ?? null,
      removeItem: (key) => {
        map.delete(key);
      },
      setItem: (key, value) => {
        map.set(key, value);
      },
    };
  })();
  assert.deepEqual(autoMineDiagnostics.createDefaultAutoMineDiagnosticsSnapshot(), {
    phase: "idle",
    progress: null,
    runningParams: null,
    isAutoMining: false,
    autoResumeRequested: false,
    sessionExpired: false,
    lastErrorKind: null,
    lastErrorMessage: null,
    lastErrorRawMessage: null,
    lastStopReason: null,
    updatedAt: 0,
  });
  autoMineDiagnostics.writeAutoMineDiagnostics({
    phase: "retry-wait",
    progress: "Saved session is paused and will retry automatically.",
    autoResumeRequested: true,
    lastErrorKind: "network",
    lastStopReason: "retry-wait",
  }, { storage: diagnosticsStorage, now: 1234 });
  assert.deepEqual(autoMineDiagnostics.readAutoMineDiagnostics(diagnosticsStorage), {
    phase: "retry-wait",
    progress: "Saved session is paused and will retry automatically.",
    runningParams: null,
    isAutoMining: false,
    autoResumeRequested: true,
    sessionExpired: false,
    lastErrorKind: "network",
    lastErrorMessage: null,
    lastErrorRawMessage: null,
    lastStopReason: "retry-wait",
    updatedAt: 1234,
  });
  assert.equal(
    autoMineDiagnostics.sanitizeAutoMineDiagnosticsSnapshot({
      phase: "bogus",
      lastErrorKind: "broken",
      lastStopReason: "wrong",
      updatedAt: "bad",
    }).phase,
    "idle",
  );
  autoMineDiagnostics.clearAutoMineDiagnostics(diagnosticsStorage);
  assert.equal(autoMineDiagnostics.readAutoMineDiagnostics(diagnosticsStorage), null);

  autoMineDebugOverride.writeAutoMineDebugOverride({
    phase: "retry-wait",
    progress: "Auto-miner paused: RPC offline for too long. Retrying automatically...",
    runningParams: { betStr: "1.25", blocks: 4, rounds: 12 },
  }, { storage: diagnosticsStorage, now: 2222 });
  assert.deepEqual(autoMineDebugOverride.readAutoMineDebugOverride(diagnosticsStorage), {
    phase: "retry-wait",
    progress: "Auto-miner paused: RPC offline for too long. Retrying automatically...",
    runningParams: { betStr: "1.25", blocks: 4, rounds: 12 },
    updatedAt: 2222,
  });
  assert.equal(
    autoMineDebugOverride.sanitizeAutoMineDebugOverride({
      phase: "wrong",
      runningParams: { betStr: "1", blocks: 2, rounds: 3 },
    }),
    null,
  );
  autoMineDebugOverride.clearAutoMineDebugOverride(diagnosticsStorage);
  assert.equal(autoMineDebugOverride.readAutoMineDebugOverride(diagnosticsStorage), null);

  const restoreFingerprint = autoMineRestoreDeduper.getAutoMineRestoreFingerprint({
    active: true,
    betStr: "1.0",
    blocks: 3,
    rounds: 500,
    nextRoundIndex: 81,
    lastPlacedEpoch: "2413",
  });
  assert.equal(restoreFingerprint, "1.0|3|500|81|2413");
  assert.equal(
    autoMineRestoreDeduper.shouldSuppressDuplicateAutoMineRestore({
      previousAt: 10_000,
      previousFingerprint: restoreFingerprint,
      nextFingerprint: restoreFingerprint,
      now: 12_500,
      cooldownMs: 4_000,
    }),
    true,
  );
  assert.equal(
    autoMineRestoreDeduper.shouldSuppressDuplicateAutoMineRestore({
      previousAt: 10_000,
      previousFingerprint: restoreFingerprint,
      nextFingerprint: "1.0|3|500|82|2414",
      now: 12_500,
      cooldownMs: 4_000,
    }),
    false,
  );

  const chunkStorage = (() => {
    const map = new Map();
    return {
      getItem: (key) => map.get(key) ?? null,
      removeItem: (key) => {
        map.delete(key);
      },
      setItem: (key, value) => {
        map.set(key, value);
      },
    };
  })();
  assert.equal(
    chunkReloadRecovery.isChunkLoadLikeErrorMessage(
      "Loading chunk _app-pages-browser_app_components_WhitePaper_tsx failed. (timeout: /_next/static/chunks/foo.js)",
    ),
    true,
  );
  assert.equal(chunkReloadRecovery.shouldAttemptChunkReloadOnce(chunkStorage, 1_000), true);
  assert.equal(chunkReloadRecovery.shouldAttemptChunkReloadOnce(chunkStorage, 2_000), false);
  chunkReloadRecovery.clearExpiredChunkReloadAttempt(
    chunkStorage,
    1_000 + chunkReloadRecovery.CHUNK_RELOAD_WINDOW_MS + 1,
  );
  assert.equal(chunkReloadRecovery.shouldAttemptChunkReloadOnce(chunkStorage, 20_000), true);

  await assert.rejects(
    () =>
      miningShared.findConfirmedEpochForTiles(
        {
          readContract: async () => {
            throw new Error("rpc timeout");
          },
        },
        "0x0000000000000000000000000000000000000001",
        [11n, 12n],
        [1, 2],
      ),
    /rpc timeout/,
  );

  assert.deepEqual(
    autoMineError.getAutoMineUserMessage(new Error("must have valid access token")),
    {
      diagnosticsErrorKind: "session-expired",
      rawMessage: "must have valid access token",
      sessionExpired: true,
      networkDown: false,
      walletUnavailable: false,
      pendingNonceBlocked: false,
      userMessage: "Session expired. Log out, log in again, then reload this page - the bot will auto-resume.",
    },
  );
  assert.equal(
    autoMineError.getAutoMineUserMessage(new Error("public client unavailable")).diagnosticsErrorKind,
    "wallet-unavailable",
  );
  assert.equal(
    autoMineError.getAutoMineUserMessage(new Error("pending transaction blocked by nonce")).diagnosticsErrorKind,
    "pending-nonce-blocked",
  );

  const cache = routeCache.createRouteCache(2);
  const cacheKey = "messages";
  const inflightVersion = cache.getWriteVersion(cacheKey);
  cache.invalidate(cacheKey);
  cache.setIfLatest(cacheKey, { stale: true }, 1000, inflightVersion);
  assert.equal(cache.getStale(cacheKey), null);

  const freshVersion = cache.getWriteVersion(cacheKey);
  cache.setIfLatest(cacheKey, { fresh: true }, 1000, freshVersion);
  assert.deepEqual(cache.getStale(cacheKey), { fresh: true });

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

  loopState = autoMineLoopModel.reduceAutoMineLoopEvent(loopState, {
    type: "round-epoch-ended",
    liveEpoch: 22n,
  });
  assert.equal(loopState.roundIndex, 2);
  assert.equal(loopState.lastPlacedEpoch, 22n);
  assert.equal(loopState.progressMessage, "2 / 3 - skipped (epoch ended), next round...");
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
  assert.equal(loopState.progressMessage, "3 / 3 - confirmed");
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
  assert.equal(loopState.progressMessage, "3 / 3 - confirmed (detected on-chain)");
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

  const loopProgress = [];
  const loopSelections = [];
  const loopSavedSessions = [];
  const loopCompletedRounds = [];
  let loopConfirmedCount = 0;
  const createLoopRuntime = (overrides = {}) => ({
    getNow: () => 0,
    handleConfirmedRound: async ({ placedEpoch, progressMessage, roundIndex, tilesToBet }) => {
      loopConfirmedCount += 1;
      loopCompletedRounds.push({
        betStr: "1.0",
        blocks: 2,
        rounds: 1,
        roundIndex,
        placedEpoch,
        displayTiles: tilesToBet,
        displayEpoch: placedEpoch,
        progressMessage,
        announceBet: false,
      });
    },
    handleEpochReady: ({ blocks, roundIndex, rounds }) => {
      loopProgress.push(`${roundIndex} / ${rounds} - placing bet (${blocks} tiles)...`);
    },
    handleSessionRefresh: async () => 0,
    readRefreshSession: () => undefined,
    renewLock: () => {},
    runCommands: async () => {},
    syncState: (state, effects = {}) => {
      const { progress = true, selection = true, session = true } = effects;
      if (selection) {
        loopSelections.push(state.selection);
      }
      if (progress && state.progressMessage) {
        loopProgress.push(state.progressMessage);
      }
      if (session && state.sessionCheckpoint) {
        loopSavedSessions.push({
          active: true,
          betStr: "1.0",
          blocks: 2,
          rounds: 1,
          nextRoundIndex: state.sessionCheckpoint.nextRoundIndex,
          lastPlacedEpoch: state.sessionCheckpoint.lastPlacedEpoch,
        });
      }
    },
    ...overrides,
  });
  const baseLoopOptions = {
    autoMineActive: () => true,
    blocks: 2,
    networkBackoffInitialMs: 10,
    networkBackoffMaxMs: 20,
    networkRetryMax: 2,
    restoredLastEpoch: null,
    rounds: 1,
    runtime: createLoopRuntime(),
    sessionRefreshIntervalMs: 60_000,
    startRoundIndex: 0,
  };

  const detectedResult = await autoMineLoop.runAutoMineLoop({
    ...baseLoopOptions,
    adapter: {
      awaitEpochReady: async () => ({ stopped: false }),
      prepareRoundCommand: async () => ({
        kind: "ready",
        alreadyBetTiles: [],
        command: {
          client: {},
          liveEpoch: 55n,
          epochNeedsResolve: false,
          effectiveBlocks: 2,
          tilesToBet: [2, 5],
          roundCandidateEpochs: [55n, 56n],
          selectionEpoch: "55",
        },
      }),
      executeRoundCommand: async () => ({ kind: "confirmed", source: "detected-on-chain", placedEpoch: 55n }),
      finalizeRoundCommand: async () => ({ kind: "confirmed", source: "finalized", placedEpoch: 0n }),
      recoverRoundCommand: async () => ({ kind: "retry" }),
    },
  });
  assert.equal(detectedResult.stopReason, "completed");
  assert.equal(loopConfirmedCount, 1);
  assert.equal(loopCompletedRounds.length, 1);
  assert.equal(loopCompletedRounds[0].placedEpoch, 55n);
  assert.deepEqual(loopSavedSessions, [{
    active: true,
    betStr: "1.0",
    blocks: 2,
    rounds: 1,
    nextRoundIndex: 0,
    lastPlacedEpoch: "55",
  }]);
  assert.deepEqual(loopSelections.at(-1), { tiles: [2, 5], epoch: "55" });
  assert.equal(loopProgress.at(-1), "Completed 1/1 rounds");

  let recoverCalls = 0;
  const recoveredResult = await autoMineLoop.runAutoMineLoop({
    ...baseLoopOptions,
    runtime: createLoopRuntime({
      handleConfirmedRound: async () => {},
      handleEpochReady: () => {},
      runCommands: async () => {},
      syncState: () => {},
    }),
    adapter: {
      awaitEpochReady: async () => ({ stopped: false }),
      prepareRoundCommand: async () => ({
        kind: "ready",
        alreadyBetTiles: [],
        command: {
          client: {},
          liveEpoch: 71n,
          epochNeedsResolve: false,
          effectiveBlocks: 1,
          tilesToBet: [6],
          roundCandidateEpochs: [71n, 72n],
          selectionEpoch: "71",
        },
      }),
      executeRoundCommand: async () => {
        throw new Error("network request failed");
      },
      finalizeRoundCommand: async () => ({ kind: "confirmed", source: "finalized", placedEpoch: 0n }),
      recoverRoundCommand: async () => {
        recoverCalls += 1;
        return {
          kind: "confirmed",
          source: "recovered-after-network-error",
          placedEpoch: 71n,
        };
      },
    },
  });
  assert.equal(recoveredResult.stopReason, "completed");
  assert.equal(recoverCalls, 1);

  const noClientResult = await autoMineLoop.runAutoMineLoop({
    ...baseLoopOptions,
    runtime: createLoopRuntime({
      handleConfirmedRound: async () => {},
      handleEpochReady: () => {},
      runCommands: async () => {},
      syncState: () => {},
    }),
    adapter: {
      awaitEpochReady: async () => ({ stopped: false }),
      prepareRoundCommand: async () => ({ kind: "stop-no-client" }),
      executeRoundCommand: async () => ({ kind: "submitted" }),
      finalizeRoundCommand: async () => ({ kind: "confirmed", source: "finalized", placedEpoch: 0n }),
      recoverRoundCommand: async () => ({ kind: "retry" }),
    },
  });
  assert.equal(noClientResult.stopReason, "no-client");

  let session = null;
  let lockReleased = 0;
  const controller = autoMineRuntimeController.createAutoMineRuntimeController({
    clearSession: () => {
      session = null;
    },
    readSession: () => session,
    releaseTabLock: () => {
      lockReleased += 1;
    },
    saveSession: (nextSession) => {
      session = nextSession;
    },
  });

  controller.persistStart({ betStr: "1.5", blocks: 3, rounds: 7 });
  assert.deepEqual(session, {
    active: true,
    betStr: "1.5",
    blocks: 3,
    rounds: 7,
    nextRoundIndex: 0,
    lastPlacedEpoch: null,
  });

  session = { ...session, nextRoundIndex: 7 };
  assert.deepEqual(controller.readRestorableRun(), { kind: "cleared-invalid" });
  assert.equal(session, null);

  controller.persistCheckpoint({
    betStr: "2.0",
    blocks: 4,
    rounds: 9,
    nextRoundIndex: 2,
    lastPlacedEpoch: 15n,
  });
  assert.deepEqual(controller.readRestorableRun(), {
    kind: "resume",
    session: {
      active: true,
      betStr: "2.0",
      blocks: 4,
      rounds: 9,
      nextRoundIndex: 2,
      lastPlacedEpoch: "15",
    },
    params: {
      betStr: "2.0",
      blocks: 4,
      rounds: 9,
      startRoundIndex: 2,
      lastPlacedEpoch: 15n,
    },
  });

  controller.finalizeRun("completed");
  assert.equal(session, null);
  assert.equal(lockReleased, 1);

  let retryAttempt = 0;
  const retryResult = await networkRetry.readWithNetworkRetry({
    actionLabel: "probe read",
    initialMs: 1,
    isActive: () => true,
    maxAttempts: 4,
    maxMs: 2,
    onProgress: () => {},
    read: async () => {
      retryAttempt += 1;
      if (retryAttempt < 3) throw new Error("rpc timeout");
      return "ready";
    },
    shouldRetry: (error) => String(error).includes("rpc timeout"),
  });
  assert.equal(retryResult, "ready");
  assert.equal(retryAttempt, 3);

  let finalizedAttempts = 0;
  const pendingAttempt = await manualMineAttempt.runManualMineAttempt({
    actorAddress: "0xabc",
    betAmountStr: "1.25",
    checkBetAlreadyConfirmed: async () => false,
    ensureAllowance: async () => {
      throw new Error("should not request allowance on pending path");
    },
    finalizeMineSuccess: () => {
      finalizedAttempts += 1;
    },
    getBumpedFees: async () => undefined,
    normalizedTiles: [1, 2],
    placeBetsPreferSilent: async () => "pending",
    source: "ManualMine",
  });
  assert.equal(pendingAttempt, true);
  assert.equal(finalizedAttempts, 1);

  let timedOutFinalized = 0;
  const timeoutAttempt = await manualMineAttempt.runManualMineAttempt({
    actorAddress: "0xabc",
    betAmountStr: "0.5",
    checkBetAlreadyConfirmed: async () => false,
    ensureAllowance: async () => {
      throw new Error("should not request allowance on timeout path");
    },
    finalizeMineSuccess: () => {
      timedOutFinalized += 1;
    },
    getBumpedFees: async () => undefined,
    normalizedTiles: [3],
    placeBetsPreferSilent: async () => {
      const error = new Error("transaction receipt timed out");
      error.name = "TransactionReceiptTimeoutError";
      throw error;
    },
    source: "DirectMine",
  });
  assert.equal(timeoutAttempt, true);
  assert.equal(timedOutFinalized, 1);

  await assert.rejects(
    () => utils.withTimeout(delay(50), 1, "probe"),
    /probe timed out after 1ms/,
  );
  assert.equal(await utils.withTimeout(Promise.resolve("ok"), 10, "probe"), "ok");

  console.log("Business logic tests passed.");
}

await main();
