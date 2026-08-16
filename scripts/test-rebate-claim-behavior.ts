import assert from "node:assert/strict";
import {
  classifySafetyPoolClaimError,
  createSafetyPoolClaimActorGuard,
  createSafetyPoolClaimProgress,
  executeSafetyPoolClaimBatches,
  formatSafetyPoolClaimError,
  getSafetyPoolClaimFailureOutcome,
  getSafetyPoolClaimSuccessOutcome,
  releaseSafetyPoolClaimLock,
  tryAcquireSafetyPoolClaimLock,
  type SafetyPoolClaimBatchOptions,
} from "../app/hooks/useRebate";

const HASH_ONE = `0x${"1".repeat(64)}` as const;
const HASH_TWO = `0x${"2".repeat(64)}` as const;

async function captureFailure(run: () => Promise<void>) {
  try {
    await run();
  } catch (error) {
    return error;
  }
  assert.fail("expected Safety Pool claim probe to fail");
}

function createOptions(
  overrides: Partial<SafetyPoolClaimBatchOptions> = {},
): SafetyPoolClaimBatchOptions {
  const actorChangedError = new Error("synthetic actor changed");
  return {
    epochs: [4n, 3n],
    claimPlanKind: "single",
    progress: createSafetyPoolClaimProgress(),
    assertActorActive: () => undefined,
    isActorChangedError: (error) => error === actorChangedError,
    simulateBatch: async () => undefined,
    estimateBatchGas: async () => 100_000n,
    sendBatch: async () => HASH_ONE,
    simulateSingle: async () => undefined,
    estimateSingleGas: async () => 90_000n,
    sendSingle: async () => HASH_TWO,
    confirm: async () => undefined,
    onInitialSplit: () => undefined,
    onSingleFallback: () => undefined,
    ...overrides,
  };
}

async function testDuplicateLock() {
  const lock = { current: false };
  assert.equal(tryAcquireSafetyPoolClaimLock(lock), true);
  assert.equal(tryAcquireSafetyPoolClaimLock(lock), false, "duplicate claim must be synchronously suppressed");
  releaseSafetyPoolClaimLock(lock);
  assert.equal(tryAcquireSafetyPoolClaimLock(lock), true, "claim lock must reopen after terminal cleanup");
  releaseSafetyPoolClaimLock(lock);
}

async function testSimulationPrecedesEverySend() {
  const batchEvents: string[] = [];
  const batchProgress = createSafetyPoolClaimProgress();
  await executeSafetyPoolClaimBatches(createOptions({
    progress: batchProgress,
    simulateBatch: async () => { batchEvents.push("simulate-batch"); },
    estimateBatchGas: async () => { batchEvents.push("estimate-batch"); return 100_000n; },
    sendBatch: async () => { batchEvents.push("send-batch"); return HASH_ONE; },
    confirm: async () => { batchEvents.push("confirm-batch"); },
  }));
  assert.deepEqual(batchEvents, ["simulate-batch", "estimate-batch", "send-batch", "confirm-batch"]);
  assert.deepEqual(batchProgress, {
    claimedEpochCount: 2,
    claimTxCount: 1,
    usedSplitFallback: false,
    lastClaimTxHash: HASH_ONE,
  });

  const singleEvents: string[] = [];
  const singleProgress = createSafetyPoolClaimProgress();
  await executeSafetyPoolClaimBatches(createOptions({
    epochs: [9n],
    progress: singleProgress,
    simulateBatch: async () => { singleEvents.push("simulate-batch"); throw new Error("batch unsupported"); },
    simulateSingle: async () => { singleEvents.push("simulate-single"); },
    estimateSingleGas: async () => { singleEvents.push("estimate-single"); return 90_000n; },
    sendSingle: async () => { singleEvents.push("send-single"); return HASH_TWO; },
    confirm: async () => { singleEvents.push("confirm-single"); },
  }));
  assert.deepEqual(singleEvents, [
    "simulate-batch",
    "simulate-single",
    "estimate-single",
    "send-single",
    "confirm-single",
  ]);
  assert.equal(singleProgress.claimedEpochCount, 1);
  assert.equal(singleProgress.claimTxCount, 1);
  assert.equal(singleProgress.usedSplitFallback, true);
}

async function testActorSwitchStopsLaterSends() {
  const latestActor = { current: "0xactor-one" as string | null };
  const { actorChangedError, assertActorActive, isActorChangedError } =
    createSafetyPoolClaimActorGuard(latestActor, "0xactor-one");
  let sends = 0;
  let confirmations = 0;
  const progress = createSafetyPoolClaimProgress();
  const error = await captureFailure(() => executeSafetyPoolClaimBatches(createOptions({
    epochs: [4n, 3n, 2n, 1n],
    claimPlanKind: "split",
    progress,
    assertActorActive,
    isActorChangedError,
    sendBatch: async () => {
      sends += 1;
      latestActor.current = "0xactor-two";
      return HASH_ONE;
    },
    confirm: async () => { confirmations += 1; },
  })));
  assert.equal(error, actorChangedError);
  assert.equal(sends, 1, "wallet switch must stop the remaining split send");
  assert.equal(confirmations, 0, "stale actor must not continue into confirmation polling");
  assert.equal(progress.claimTxCount, 1);
  assert.equal(progress.claimedEpochCount, 0);
}

async function testSplitPartialSuccessAndTerminalStates() {
  const rejected = Object.assign(new Error("User rejected request"), { code: 4001 });
  const rejectionProgress = createSafetyPoolClaimProgress();
  let rejectionSends = 0;
  const rejectionError = await captureFailure(() => executeSafetyPoolClaimBatches(createOptions({
    epochs: [4n, 3n, 2n, 1n],
    claimPlanKind: "split",
    progress: rejectionProgress,
    sendBatch: async () => {
      rejectionSends += 1;
      if (rejectionSends === 2) throw rejected;
      return HASH_ONE;
    },
  })));
  assert.equal(rejectionError, rejected);
  assert.equal(classifySafetyPoolClaimError(rejectionError), "rejected");
  assert.equal(rejectionProgress.claimedEpochCount, 2);
  assert.equal(rejectionProgress.claimTxCount, 1);
  assert.equal(rejectionSends, 2, "wallet rejection must not trigger another fallback prompt");
  const rejectionOutcome = getSafetyPoolClaimFailureOutcome(rejectionProgress, rejected);
  assert.equal(rejectionOutcome.kind, "rejected");
  assert.equal(rejectionOutcome.tone, "warning");
  assert.match(
    rejectionOutcome.message,
    /^Claimed Safety Pool payouts for 2 epochs in 1 transaction before the remaining claim flow was cancelled\. https:\/\/[^\s]+\/tx\/0x1{64}$/,
  );

  const ambiguous = new Error("synthetic confirmation timeout");
  ambiguous.name = "TransactionReceiptTimeoutError";
  const ambiguousProgress = createSafetyPoolClaimProgress();
  let ambiguousSingleSends = 0;
  const ambiguousError = await captureFailure(() => executeSafetyPoolClaimBatches(createOptions({
    epochs: [7n],
    progress: ambiguousProgress,
    sendBatch: async () => HASH_ONE,
    sendSingle: async () => { ambiguousSingleSends += 1; return HASH_TWO; },
    confirm: async () => { throw ambiguous; },
  })));
  assert.equal(ambiguousError, ambiguous);
  assert.equal(classifySafetyPoolClaimError(ambiguousError), "ambiguous");
  assert.equal(ambiguousProgress.claimTxCount, 1);
  assert.equal(ambiguousProgress.lastClaimTxHash, HASH_ONE);
  assert.equal(ambiguousSingleSends, 0, "ambiguous submission must suppress duplicate fallback sends");
  const ambiguousOutcome = getSafetyPoolClaimFailureOutcome(ambiguousProgress, ambiguous);
  assert.equal(ambiguousOutcome.kind, "ambiguous");
  assert.equal(ambiguousOutcome.tone, "warning");
  assert.match(
    ambiguousOutcome.message,
    /^Safety Pool claim may already be pending\. Check wallet activity and refresh Safety Pool before retrying\. https:\/\/[^\s]+\/tx\/0x1{64}$/,
  );

  const reverted = new Error(`Transaction reverted: ${HASH_TWO}`);
  const revertProgress = createSafetyPoolClaimProgress();
  const revertError = await captureFailure(() => executeSafetyPoolClaimBatches(createOptions({
    epochs: [8n],
    progress: revertProgress,
    confirm: async (hash) => {
      if (hash === HASH_ONE) throw new Error(`Transaction reverted: ${HASH_ONE}`);
      throw reverted;
    },
  })));
  assert.equal(revertError, reverted);
  assert.equal(classifySafetyPoolClaimError(revertError), "reverted");
  assert.equal(revertProgress.claimTxCount, 2);
  assert.equal(revertProgress.claimedEpochCount, 0);
  assert.deepEqual(getSafetyPoolClaimFailureOutcome(revertProgress, revertError), {
    kind: "reverted",
    message: "Safety Pool claim failed: claim reverted on-chain. No Safety Pool payout was moved by this transaction.",
    tone: "danger",
  });

  const successProgress = {
    claimedEpochCount: 2,
    claimTxCount: 2,
    usedSplitFallback: true,
    lastClaimTxHash: HASH_TWO,
  };
  const successOutcome = getSafetyPoolClaimSuccessOutcome(successProgress);
  assert.equal(successOutcome.kind, "success");
  assert.equal(successOutcome.tone, "success");
  assert.match(
    successOutcome.message,
    /^Claimed Safety Pool payouts for 2 epochs in 2 transactions\. https:\/\/[^\s]+\/tx\/0x2{64}$/,
  );

  assert.equal(classifySafetyPoolClaimError(new Error("opaque failure")), "failed");
}

async function testRawErrorsAreRedacted() {
  const raw = "RPC provider https://secret.example/v3/private-token returned JSON-RPC 500";
  const formatted = formatSafetyPoolClaimError(new Error(raw));
  assert.equal(
    formatted,
    "claim could not be submitted through the wallet provider. Check wallet activity before retrying.",
  );
  assert.doesNotMatch(formatted, /secret\.example|private-token|json-rpc 500/i);
  assert.equal(
    formatSafetyPoolClaimError(new Error("execution reverted: Norebateavailable")),
    "No Safety Pool payout is currently claimable for the selected epochs.",
  );
}

async function main() {
  await testDuplicateLock();
  await testSimulationPrecedesEverySend();
  await testActorSwitchStopsLaterSends();
  await testSplitPartialSuccessAndTerminalStates();
  await testRawErrorsAreRedacted();
  console.log("Safety Pool claim behavior tests passed (5 groups).");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
