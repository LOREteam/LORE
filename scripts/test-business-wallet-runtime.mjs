import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import * as utilsModule from "../app/lib/utils.ts";
import * as networkRetryModule from "../app/lib/mining/networkRetry.ts";
import * as manualMineAttemptModule from "../app/lib/mining/manualMineAttempt.ts";
import * as miningBetStatusModule from "../app/hooks/useMiningBetStatus.ts";
import * as autoMineLoopModule from "../app/hooks/useMiningAutoMineLoop.ts";
import * as miningRoundBettingModule from "../app/hooks/useMiningRoundBetting.ts";
import * as autoMineRuntimeControllerModule from "../app/lib/mining/autoMineRuntimeController.ts";
import * as miningSharedModule from "../app/hooks/useMining.shared.ts";
import * as miningTxPathModule from "../app/lib/miningTxPath.ts";

const utils = utilsModule.default ?? utilsModule;
const networkRetry = networkRetryModule.default ?? networkRetryModule;
const manualMineAttempt = manualMineAttemptModule.default ?? manualMineAttemptModule;
const miningBetStatus = miningBetStatusModule.default ?? miningBetStatusModule;
const autoMineLoop = autoMineLoopModule.default ?? autoMineLoopModule;
const miningRoundBetting = miningRoundBettingModule.default ?? miningRoundBettingModule;
const autoMineRuntimeController = autoMineRuntimeControllerModule.default ?? autoMineRuntimeControllerModule;
const miningShared = miningSharedModule.default ?? miningSharedModule;
const miningTxPath = miningTxPathModule.default ?? miningTxPathModule;

export async function runWalletRuntimeTests() {
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

  let executeAfterRecoveryErrorCalls = 0;
  let recoveryNetworkErrorCalls = 0;
  const recoveryNetworkErrorProgress = [];
  const recoveredAfterRecoveryNetworkErrorResult = await autoMineLoop.runAutoMineLoop({
    ...baseLoopOptions,
    runtime: createLoopRuntime({
      handleConfirmedRound: async () => {},
      handleEpochReady: () => {},
      runCommands: async () => {},
      syncState: (state, effects = {}) => {
        if ((effects.progress ?? true) && state.progressMessage) {
          recoveryNetworkErrorProgress.push(state.progressMessage);
        }
      },
    }),
    adapter: {
      awaitEpochReady: async () => ({ stopped: false }),
      prepareRoundCommand: async () => ({
        kind: "ready",
        alreadyBetTiles: [],
        command: {
          client: {},
          liveEpoch: 72n,
          epochNeedsResolve: false,
          effectiveBlocks: 1,
          tilesToBet: [7],
          roundCandidateEpochs: [72n, 73n],
          selectionEpoch: "72",
        },
      }),
      executeRoundCommand: async () => {
        executeAfterRecoveryErrorCalls += 1;
        if (executeAfterRecoveryErrorCalls === 1) {
          throw new Error("network request failed");
        }
        return { kind: "confirmed", source: "detected-on-chain", placedEpoch: 72n };
      },
      finalizeRoundCommand: async () => ({ kind: "confirmed", source: "finalized", placedEpoch: 0n }),
      recoverRoundCommand: async () => {
        recoveryNetworkErrorCalls += 1;
        throw new Error("network request failed during recovery");
      },
    },
  });
  assert.equal(recoveredAfterRecoveryNetworkErrorResult.stopReason, "completed");
  assert.equal(executeAfterRecoveryErrorCalls, 2);
  assert.equal(recoveryNetworkErrorCalls, 1);
  assert.deepEqual(
    recoveryNetworkErrorProgress.filter((message) => message.startsWith("RPC offline - retry")),
    ["RPC offline - retry 1 in 0s..."],
  );

  let epochWaitCalls = 0;
  let epochWaitRetryProgressCount = 0;
  const epochWaitError = new Error("epoch 1326 did not reach end-of-round readiness within 75000ms");
  epochWaitError.name = "EpochWaitTimeoutError";
  const epochWaitRecoveryResult = await autoMineLoop.runAutoMineLoop({
    ...baseLoopOptions,
    autoMineActive: () => epochWaitRetryProgressCount < 10,
    restoredLastEpoch: 1326n,
    runtime: createLoopRuntime({
      handleConfirmedRound: async () => {},
      handleEpochReady: () => {
        throw new Error("should not place while epoch wait is failing");
      },
      runCommands: async () => {},
      syncState: (state, effects = {}) => {
        if ((effects.progress ?? true) && state.progressMessage?.startsWith("RPC offline - retry")) {
          epochWaitRetryProgressCount += 1;
        }
      },
    }),
    adapter: {
      awaitEpochReady: async () => {
        epochWaitCalls += 1;
        throw epochWaitError;
      },
      prepareRoundCommand: async () => {
        throw new Error("should not prepare while epoch wait is failing");
      },
      executeRoundCommand: async () => ({ kind: "submitted" }),
      finalizeRoundCommand: async () => ({ kind: "confirmed", source: "finalized", placedEpoch: 0n }),
      recoverRoundCommand: async () => ({ kind: "retry" }),
    },
  });
  assert.equal(epochWaitRecoveryResult.stopReason, "user-stopped");
  assert.equal(epochWaitCalls > 8, true);
  assert.equal(epochWaitRetryProgressCount, 10);

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
  const autoMineControllerNow = 1_780_000_000_000;
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
    now: () => autoMineControllerNow,
  });

  controller.persistStart({ actor: "0x0000000000000000000000000000000000000001", betStr: "1.5", blocks: 3, rounds: 7 });
  assert.ok(session?.runId, "Auto-Miner persisted runs must carry a run id");
  const firstRunId = session.runId;
  assert.deepEqual(session, {
    active: true,
    runId: firstRunId,
    actor: "0x0000000000000000000000000000000000000001",
    betStr: "1.5",
    blocks: 3,
    rounds: 7,
    nextRoundIndex: 0,
    lastPlacedEpoch: null,
    issuedAt: autoMineControllerNow,
    expiresAt: autoMineControllerNow + miningShared.AUTO_MINER_AUTHORIZATION_TTL_MS,
    maxSpendPerBetRaw: "4500000000000000000",
    totalSpendRaw: "31500000000000000000",
    remainingSpendRaw: "31500000000000000000",
  });

  session = { ...session, nextRoundIndex: 7 };
  assert.deepEqual(controller.readRestorableRun("0x0000000000000000000000000000000000000001"), { kind: "cleared-invalid" });
  assert.equal(session, null);

  controller.persistStart({ actor: "0x0000000000000000000000000000000000000001", betStr: "2.0", blocks: 4, rounds: 9 });
  const secondRunId = session.runId;

  controller.persistCheckpoint({
    betStr: "2.0",
    blocks: 4,
    rounds: 9,
    nextRoundIndex: 2,
    lastPlacedEpoch: 15n,
  });
  assert.equal(session.actor, "0x0000000000000000000000000000000000000001", "checkpoints must retain the run owner");
  assert.equal(session.runId, secondRunId, "checkpoints must retain the active Auto-Miner run id");
  const validCheckpointSession = session;
  controller.persistCheckpoint({
    betStr: "2.0",
    blocks: 4,
    rounds: 9,
    nextRoundIndex: 3,
    lastPlacedEpoch: "0015",
  });
  assert.equal(session, validCheckpointSession, "Auto-Miner checkpoints must not persist non-canonical epoch strings");
  controller.persistCheckpoint({
    betStr: "2.0",
    blocks: 4,
    rounds: 9,
    nextRoundIndex: 3,
    lastPlacedEpoch: -1n,
  });
  assert.equal(session, validCheckpointSession, "Auto-Miner checkpoints must not persist negative epoch values");

  session = { ...session, actor: "0x0000000000000000000000000000000000000002" };
  controller.persistCheckpoint({
    betStr: "2.0",
    blocks: 4,
    rounds: 9,
    nextRoundIndex: 3,
    lastPlacedEpoch: 16n,
  });
  assert.equal(session.actor, "0x0000000000000000000000000000000000000002", "checkpoints must not overwrite a different actor's persisted session");
  assert.equal(session.nextRoundIndex, 2, "stale actor checkpoints must not advance a different actor's persisted session");
  const actorMismatchSession = session;
  assert.deepEqual(controller.readRestorableRun("0x0000000000000000000000000000000000000001"), { kind: "actor-mismatch" });
  assert.deepEqual(
    session,
    { ...actorMismatchSession, active: false },
    "actor-mismatched restore checks must pause, but not clear or reassign, another actor's saved run",
  );

  session = validCheckpointSession;
  const pausedCheckpointSession = { ...validCheckpointSession, active: false };
  assert.deepEqual(controller.readRestorableRun("0x0000000000000000000000000000000000000001"), {
    kind: "paused",
    session: pausedCheckpointSession,
  });
  assert.deepEqual(session, pausedCheckpointSession, "same-actor restore must remain paused until a fresh explicit start");

  controller.persistStart({ actor: "0x0000000000000000000000000000000000000001", betStr: "3.0", blocks: 2, rounds: 8 });
  const staleRunId = session.runId;
  session = {
    active: true,
    runId: "run:newer-session",
    actor: "0x0000000000000000000000000000000000000001",
    betStr: "4.0",
    blocks: 2,
    rounds: 8,
    nextRoundIndex: 1,
    lastPlacedEpoch: "20",
  };
  controller.persistCheckpoint({
    betStr: "3.0",
    blocks: 2,
    rounds: 8,
    nextRoundIndex: 2,
    lastPlacedEpoch: 21n,
  });
  assert.equal(staleRunId !== session.runId, true);
  assert.equal(session.runId, "run:newer-session", "stale Auto-Miner checkpoints must not overwrite a different persisted run id");
  controller.finalizeRun("completed");
  assert.equal(session.runId, "run:newer-session", "stale Auto-Miner finalization must not clear a different persisted run id");
  assert.equal(lockReleased, 1);

  controller.persistCheckpoint({
    betStr: "4.0",
    blocks: 2,
    rounds: 8,
    nextRoundIndex: 2,
    lastPlacedEpoch: 22n,
  });
  assert.equal(session.runId, "run:newer-session", "inactive Auto-Miner controllers must not clear a persisted run they cannot prove they own");

  controller.persistStart({ actor: "0x0000000000000000000000000000000000000001", betStr: "5.0", blocks: 2, rounds: 8 });
  const completionRunId = session.runId;
  assert.notEqual(completionRunId, "run:newer-session");
  controller.finalizeRun("completed");
  assert.equal(session, null);
  assert.equal(lockReleased, 2);

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
  let invalidRetryReads = 0;
  await assert.rejects(
    () => networkRetry.readWithNetworkRetry({
      actionLabel: "invalid retry config probe",
      initialMs: 1,
      isActive: () => true,
      maxAttempts: Number.NaN,
      maxMs: 2,
      onProgress: () => {
        throw new Error("invalid maxAttempts must not report retry progress");
      },
      read: async () => {
        invalidRetryReads += 1;
        return "unexpected";
      },
      shouldRetry: () => true,
    }),
    /Network retry exhausted while invalid retry config probe/,
    "invalid network retry attempt limits must fail closed before reads",
  );
  assert.equal(invalidRetryReads, 0);

  assert.equal(
    miningBetStatus.hasExpectedBetDelta(
      [0n, 10n, 0n],
      [0n, 10n, 0n],
      [2],
      4n,
    ),
    false,
    "an unchanged pre-existing bet must not confirm a failed second attempt",
  );
  assert.equal(
    miningBetStatus.hasExpectedBetDelta(
      [0n, 10n, 0n, 2n],
      [0n, 14n, 0n, 6n],
      [2, 4],
      4n,
    ),
    true,
    "each selected tile must increase by the exact attempted amount",
  );
  assert.equal(
    miningBetStatus.hasExpectedBetDelta(
      [0n, 10n, 0n, 2n],
      [0n, 14n, 0n, 5n],
      [2, 4],
      4n,
    ),
    false,
    "a partial multi-tile delta must not confirm the whole attempt",
  );

  const pendingNonceState = {
    chainId: 59141,
    contract: `0x${"11".repeat(20)}`,
    actor: `0x${"22".repeat(20)}`,
    nonce: 7,
    ts: 100_000,
  };
  const nonceRecoveryCalls = [];
  const pairedRecoveryClients = (client) => [client, { ...client }];
  const hashlessStillPending = await miningTxPath.recoverPendingMiningTx(
    pairedRecoveryClients({
      getTransaction: async () => {
        throw new Error("hashless nonce recovery must not fetch a transaction");
      },
      getTransactionReceipt: async () => {
        throw new Error("hashless nonce recovery must not fetch a receipt");
      },
      getTransactionCount: async ({ blockTag }) => {
        nonceRecoveryCalls.push(blockTag);
        return blockTag === "pending" ? 8 : 7;
      },
    }),
    pendingNonceState,
    200_000,
  );
  assert.equal(hashlessStillPending, "pending", "hashless nonce recovery must block duplicate sends while pending nonce is ahead");
  assert.deepEqual(nonceRecoveryCalls, ["latest", "pending", "latest", "pending"], "hashless nonce recovery must compare latest and pending nonce scopes across both agreement clients");
  const hashlessConsumedNonce = await miningTxPath.recoverPendingMiningTx(
    pairedRecoveryClients({
      getTransaction: async () => {
        throw new Error("consumed hashless recovery must not fetch a transaction");
      },
      getTransactionReceipt: async () => {
        throw new Error("consumed hashless recovery must not fetch a receipt");
      },
      getTransactionCount: async ({ blockTag }) => blockTag === "pending" ? 9 : 8,
    }),
    pendingNonceState,
    200_000,
  );
  assert.equal(
    hashlessConsumedNonce,
    "manual-reconciliation-required",
    "a consumed nonce without a transaction hash must retain the duplicate-send block for manual reconciliation",
  );
  const hashlessWithinGrace = await miningTxPath.recoverPendingMiningTx(
    pairedRecoveryClients({
      getTransaction: async () => {
        throw new Error("within-grace hashless recovery must not fetch a transaction");
      },
      getTransactionReceipt: async () => {
        throw new Error("within-grace hashless recovery must not fetch a receipt");
      },
      getTransactionCount: async () => 7,
    }),
    pendingNonceState,
    999_999,
  );
  assert.equal(hashlessWithinGrace, "pending", "hashless nonce recovery must not clear before the not-found grace window");
  const hashlessAfterGrace = await miningTxPath.recoverPendingMiningTx(
    pairedRecoveryClients({
      getTransaction: async () => {
        throw new Error("after-grace hashless recovery must not fetch a transaction");
      },
      getTransactionReceipt: async () => {
        throw new Error("after-grace hashless recovery must not fetch a receipt");
      },
      getTransactionCount: async () => 7,
    }),
    pendingNonceState,
    1_000_001,
  );
  assert.equal(hashlessAfterGrace, "manual-reconciliation-required", "hashless nonce recovery must retain the duplicate-send block after the grace window");

  let finalizedAttempts = 0;
  const pendingAttempt = await manualMineAttempt.runManualMineAttempt({
    actorAddress: "0xabc",
    betAmountStr: "1.25",
    ensureAllowance: async () => {
      throw new Error("should not request allowance on pending path");
    },
    expectedEpoch: 70n,
    finalizeMineSuccess: () => {
      finalizedAttempts += 1;
    },
    getBumpedFees: async () => undefined,
    normalizedTiles: [1, 2],
    placeBetsPreferSilent: async () => "pending",
    prepareBetConfirmation: async () => async () => {
      throw new Error("should not confirm a pending transaction by balance delta");
    },
    source: "ManualMine",
  });
  assert.equal(pendingAttempt, "pending");
  assert.equal(finalizedAttempts, 0);

  let timedOutFinalized = 0;
  const timeoutAttempt = await manualMineAttempt.runManualMineAttempt({
    actorAddress: "0xabc",
    betAmountStr: "0.5",
    ensureAllowance: async () => {
      throw new Error("should not request allowance on timeout path");
    },
    expectedEpoch: 71n,
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
    prepareBetConfirmation: async () => async () => {
      throw new Error("should not confirm a receipt timeout by balance delta");
    },
    source: "DirectMine",
  });
  assert.equal(timeoutAttempt, "pending");
  assert.equal(timedOutFinalized, 0);

  let ambiguousSendChecks = 0;
  const ambiguousSendAttempt = await manualMineAttempt.runManualMineAttempt({
    actorAddress: "0xabc",
    betAmountStr: "0.75",
    ensureAllowance: async () => {
      throw new Error("should not request allowance after an ambiguous wallet send");
    },
    expectedEpoch: 71n,
    finalizeMineSuccess: () => {
      throw new Error("ambiguous wallet send must not finalize");
    },
    getBumpedFees: async () => {
      throw new Error("ambiguous wallet send must not be retried");
    },
    normalizedTiles: [7],
    placeBetsPreferSilent: async () => {
      const error = new Error("Privy sendTransaction timed out after 45000ms");
      error.name = "WalletSendTimeoutError";
      throw error;
    },
    prepareBetConfirmation: async () => async () => {
      ambiguousSendChecks += 1;
      return false;
    },
    source: "ManualMine",
  });
  assert.equal(ambiguousSendAttempt, "pending");
  assert.equal(ambiguousSendChecks, 0);

  const unverifiableRetryableSendCalls = [];
  await assert.rejects(
    () => manualMineAttempt.runManualMineAttempt({
      actorAddress: "0xabc",
      betAmountStr: "0.9",
      ensureAllowance: async () => {
        throw new Error("should not request allowance after an unverifiable gas error");
      },
      expectedEpoch: 72n,
      finalizeMineSuccess: () => {
        throw new Error("unverifiable retryable send must not finalize");
      },
      getBumpedFees: async () => {
        throw new Error("unverifiable retryable send must not compute replacement fees");
      },
      normalizedTiles: [8],
      placeBetsPreferSilent: async (...args) => {
        unverifiableRetryableSendCalls.push(args);
        throw new Error("gas required exceeds allowance (0)");
      },
      prepareBetConfirmation: async () => {
        throw new Error("public confirmation baseline unavailable");
      },
      source: "ManualMine",
    }),
    /Bet status could not be verified after an RPC error\. Wait a moment before retrying\./,
    "manual retryable send errors must fail closed when confirmation baseline is unavailable",
  );
  assert.equal(
    unverifiableRetryableSendCalls.length,
    1,
    "manual retryable send errors must not duplicate-send when status cannot be verified",
  );

  let hiddenRevertStatusChecks = 0;
  let hiddenRevertFinalized = 0;
  const hiddenRevertAttempt = await manualMineAttempt.runManualMineAttempt({
    actorAddress: "0xabc",
    betAmountStr: "10",
    prepareBetConfirmation: async (_actorAddress, normalizedTiles, expectedEpoch, amountRawPerTile) => {
      assert.deepEqual(normalizedTiles, [2, 20, 13]);
      assert.equal(expectedEpoch, 72n);
      assert.equal(amountRawPerTile, 10n * 10n ** 18n);
      return async () => {
        hiddenRevertStatusChecks += 1;
        return true;
      };
    },
    ensureAllowance: async () => {
      throw new Error("should not request allowance after confirmed hidden revert");
    },
    expectedEpoch: 72n,
    finalizeMineSuccess: () => {
      hiddenRevertFinalized += 1;
    },
    getBumpedFees: async () => {
      throw new Error("should not retry after confirmed hidden revert");
    },
    normalizedTiles: [2, 20, 13],
    placeBetsPreferSilent: async () => {
      throw new Error('An unknown error occurred while executing the contract function "placeBatchBetsBitmap".');
    },
    source: "ManualMine",
  });
  assert.equal(hiddenRevertAttempt, "confirmed");
  assert.equal(hiddenRevertStatusChecks, 1);
  assert.equal(hiddenRevertFinalized, 1);

  const manualEpochCalls = [];
  let manualEpochFinalized = 0;
  const manualEpochRetry = await manualMineAttempt.runManualMineAttempt({
    actorAddress: "0xabc",
    betAmountStr: "2",
    prepareBetConfirmation: async (_actorAddress, _normalizedTiles, expectedEpoch, amountRawPerTile) => {
      assert.equal(expectedEpoch, 73n);
      assert.equal(amountRawPerTile, 2n * 10n ** 18n);
      return async () => false;
    },
    ensureAllowance: async (requiredAmount) => {
      assert.equal(requiredAmount, 4n * 10n ** 18n);
    },
    expectedEpoch: 73n,
    finalizeMineSuccess: () => {
      manualEpochFinalized += 1;
    },
    getBumpedFees: async () => ({ gasPrice: 2n }),
    normalizedTiles: [4, 9],
    placeBetsPreferSilent: async (...args) => {
      manualEpochCalls.push(args);
      if (manualEpochCalls.length === 1) {
        throw new Error("execution reverted: ERC20InsufficientAllowance");
      }
      return "confirmed";
    },
    source: "ManualMine",
  });
  assert.equal(manualEpochRetry, "confirmed");
  assert.equal(manualEpochFinalized, 1);
  assert.equal(manualEpochCalls.length, 2);
  assert.equal(manualEpochCalls[0][4], 73n);
  assert.equal(manualEpochCalls[1][4], 73n);
  assert.deepEqual(manualEpochCalls[1][2], { gasPrice: 2n });

  let reconnectNonceReads = 0;
  let reconnectBetCalls = 0;
  const reconnectProgress = [];
  const reconnectResult = await miningRoundBetting.executeAutoMineBetLoop({
    actorAddress: "0x0000000000000000000000000000000000000001",
    autoMineActive: () => true,
    betPendingGraceMs: 60_000,
    betPendingStaleMs: 120_000,
    currentEpoch: 92n,
    currentRoundIndex: 0,
    effectiveBlocks: 1,
    forceReplacePendingNonceGap: 2,
    gasBumpBase: 0n,
    gasBumpReplacementStep: 0n,
    getBumpedFees: async () => undefined,
    getRetryDelayMs: () => 1,
    maxBetAttempts: 2,
    networkBackoffInitialMs: 1,
    networkBackoffMaxMs: 1,
    onProgress: (message) => reconnectProgress.push(message),
    pendingBetRef: { current: null },
    placeBets: async () => {
      reconnectBetCalls += 1;
      return "confirmed";
    },
    placeBetsSilent: async () => {
      throw new Error("should not use silent path without silent sender");
    },
    publicClient: {
      getTransactionCount: async () => {
        reconnectNonceReads += 1;
        if (reconnectNonceReads <= 2) {
          throw new Error("network request failed");
        }
        return 10;
      },
      readContract: async () => Array.from({ length: 25 }, () => 0n),
    },
    readSilentSend: () => null,
    roundCandidateEpochs: [92n],
    rounds: 1,
    singleAmountRaw: 1n,
    tilesToBet: [1],
  });
  assert.deepEqual(reconnectResult, { kind: "submitted" });
  assert.equal(reconnectBetCalls, 1);
  assert.deepEqual(reconnectProgress, [
    "1 / 1 - RPC offline, retry in 0s...",
    "1 / 1 - reconnecting RPC...",
  ]);

  let walletFallbackCalls = 0;
  const pendingBetRef = { current: null };
  const fakeBetClient = {
    getTransactionCount: async () => 10,
    readContract: async () => [1n, ...Array.from({ length: 24 }, () => 0n)],
  };
  const pendingFallbackResult = await miningRoundBetting.executeAutoMineBetLoop({
    actorAddress: "0x0000000000000000000000000000000000000001",
    autoMineActive: () => true,
    betPendingGraceMs: 60_000,
    betPendingStaleMs: 120_000,
    currentEpoch: 91n,
    currentRoundIndex: 0,
    effectiveBlocks: 1,
    forceReplacePendingNonceGap: 2,
    gasBumpBase: 0n,
    gasBumpReplacementStep: 0n,
    getBumpedFees: async () => undefined,
    getRetryDelayMs: () => 1,
    maxBetAttempts: 1,
    networkBackoffInitialMs: 1,
    networkBackoffMaxMs: 1,
    onProgress: () => {},
    pendingBetRef,
    placeBets: async () => {
      walletFallbackCalls += 1;
      return "confirmed";
    },
    placeBetsSilent: async () => {
      throw new Error("already known");
    },
    publicClient: fakeBetClient,
    readSilentSend: () => ({}),
    roundCandidateEpochs: [91n],
    rounds: 1,
    singleAmountRaw: 1n,
    tilesToBet: [1],
  });
  assert.deepEqual(pendingFallbackResult, { kind: "detected-on-chain", placedEpoch: 91n });
  assert.equal(walletFallbackCalls, 0);
  assert.deepEqual(pendingBetRef.current, null);

  await assert.rejects(
    () => utils.withTimeout(delay(50), 1, "probe"),
    /probe timed out after 1ms/,
  );
  assert.equal(await utils.withTimeout(Promise.resolve("ok"), 10, "probe"), "ok");
  for (const invalidTimeoutMs of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      () => utils.withTimeout(Promise.resolve("unused"), invalidTimeoutMs, "probe"),
      /probe timeout must be between 1 and 2147483647 milliseconds/,
      `shared withTimeout must reject invalid timeout ${String(invalidTimeoutMs)}`,
    );
    await assert.rejects(
      () => miningShared.withMiningRpcTimeout(Promise.resolve("unused"), "rpc probe", invalidTimeoutMs),
      /rpc probe timeout must be between 1 and 2147483647 milliseconds/,
      `mining withMiningRpcTimeout must reject invalid timeout ${String(invalidTimeoutMs)}`,
    );
  }
  const lateUnhandledRejections = [];
  const onLateUnhandledRejection = (reason) => lateUnhandledRejections.push(reason);
  process.on("unhandledRejection", onLateUnhandledRejection);
  try {
    await assert.rejects(
      () => utils.withTimeout(new Promise((_, reject) => setTimeout(() => reject(new Error("late privy reject")), 20)), 1, "late probe"),
      /late probe timed out after 1ms/,
    );
    await assert.rejects(
      () => miningShared.withMiningRpcTimeout(
        new Promise((_, reject) => setTimeout(() => reject(new Error("late rpc reject")), 20)),
        "late rpc probe",
        1,
      ),
      /late rpc probe timed out after 1ms/,
    );
    await delay(40);
    assert.deepEqual(lateUnhandledRejections, []);
  } finally {
    process.off("unhandledRejection", onLateUnhandledRejection);
  }

}
