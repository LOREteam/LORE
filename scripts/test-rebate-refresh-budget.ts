import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  appendRebateRefreshTotals,
  createEmptyRebateRefreshTotals,
  createRebateRefreshBudget,
  RebateRefreshBudgetExceededError,
  selectRebateRefreshWindow,
} from "../app/api/rebates/rebateRefreshBudget";

function assertBudgetReason(reason: RebateRefreshBudgetExceededError["reason"]) {
  return (error: unknown) =>
    error instanceof RebateRefreshBudgetExceededError && error.reason === reason;
}

async function testFiveThousandEpochContinuation() {
  const epochs = Array.from({ length: 5_000 }, (_value, index) => 5_000 - index);
  const firstSummary = selectRebateRefreshWindow(epochs, 0, 384);
  assert.deepEqual(firstSummary.items, epochs.slice(0, 384));
  assert.equal(firstSummary.complete, false);
  assert.equal(firstSummary.nextOffset, 384);

  const secondSummary = selectRebateRefreshWindow(epochs, firstSummary.nextOffset ?? 0, 384);
  assert.deepEqual(secondSummary.items, epochs.slice(384, 768));
  assert.equal(secondSummary.nextOffset, 768);
  assert.ok(secondSummary.items[0] < firstSummary.items.at(-1)!);

  const exactWindow = selectRebateRefreshWindow(epochs, 0, 48);
  assert.equal(exactWindow.items.length, 48);
  assert.equal(exactWindow.nextOffset, 48);
  assert.deepEqual(
    selectRebateRefreshWindow(epochs, Number.MAX_SAFE_INTEGER, 48).items,
    epochs.slice(0, 48),
    "an invalid continuation must restart from the newest epoch",
  );

  let summaryOffset = 0;
  let summaryTotals = createEmptyRebateRefreshTotals();
  let summaryWindows = 0;
  while (true) {
    const window = selectRebateRefreshWindow(epochs, summaryOffset, 384);
    summaryTotals = appendRebateRefreshTotals(summaryTotals, {
      pendingRebateWei: BigInt(window.items.length),
      summaryClaimableCount: window.items.length,
      claimableEpochs: [],
      processedEpochs: window.items.length,
    });
    summaryWindows += 1;
    if (window.nextOffset === null) break;
    summaryOffset = window.nextOffset;
  }
  assert.equal(summaryWindows, 14);
  assert.equal(summaryTotals.pendingRebateWei, 5_000n);
  assert.equal(summaryTotals.summaryClaimableCount, 5_000);
  assert.equal(summaryTotals.processedEpochs, 5_000);

  let exactOffset = 0;
  let exactTotals = createEmptyRebateRefreshTotals();
  while (true) {
    const window = selectRebateRefreshWindow(epochs, exactOffset, 48);
    exactTotals = appendRebateRefreshTotals(exactTotals, {
      pendingRebateWei: BigInt(window.items.length),
      summaryClaimableCount: window.items.length,
      claimableEpochs: window.items,
      processedEpochs: window.items.length,
    });
    if (window.nextOffset === null) break;
    exactOffset = window.nextOffset;
  }
  assert.equal(exactTotals.pendingRebateWei, 5_000n);
  assert.equal(exactTotals.claimableEpochs.length, 5_000);
  assert.deepEqual(exactTotals.claimableEpochs, epochs);

  const budget = createRebateRefreshBudget({
    maxEpochs: 56,
    maxRpcCalls: 64,
    maxFallbackRpcCalls: 48,
    maxDurationMs: 8_000,
  });
  budget.reserveEpochs(56);
  await budget.runRpc("summary", async () => undefined);
  await budget.runRpc("recent", async () => undefined);
  await budget.runRpc("exact", async () => {
    throw new Error("malicious batch failure");
  }).catch(() => undefined);
  for (let index = 0; index < 48; index += 1) {
    await budget.runRpc("fallback", async () => undefined);
  }
  await assert.rejects(
    budget.runRpc("fallback", async () => undefined),
    assertBudgetReason("fallback"),
    "a failed exact batch must never expand beyond one bounded 48-epoch fallback window",
  );
  const snapshot = budget.snapshot();
  assert.deepEqual(snapshot, {
    epochCount: 56,
    rpcCount: 51,
    fallbackRpcCount: 48,
    elapsedMs: snapshot.elapsedMs,
  });
}

async function testSharedRpcAndDeadlineBudgets() {
  const rpcBudget = createRebateRefreshBudget({
    maxEpochs: 8,
    maxRpcCalls: 2,
    maxFallbackRpcCalls: 1,
    maxDurationMs: 8_000,
  });
  rpcBudget.reserveEpochs(8);
  await rpcBudget.runRpc("summary", async () => "summary");
  await rpcBudget.runRpc("recent", async () => "recent");
  await assert.rejects(
    rpcBudget.runRpc("exact", async () => "exact"),
    assertBudgetReason("rpc"),
    "summary, recent, exact, and fallback work must share one RPC cap",
  );

  let now = 10;
  let operationStarted = false;
  const deadlineBudget = createRebateRefreshBudget({
    maxEpochs: 1,
    maxRpcCalls: 1,
    maxFallbackRpcCalls: 0,
    maxDurationMs: 100,
    now: () => now,
  });
  deadlineBudget.reserveEpochs(1);
  now = 111;
  await assert.rejects(
    deadlineBudget.runRpc("summary", async () => {
      operationStarted = true;
    }),
    assertBudgetReason("deadline"),
  );
  assert.equal(operationStarted, false, "deadline exhaustion must stop new RPC work");

  const epochBudget = createRebateRefreshBudget({
    maxEpochs: 4,
    maxRpcCalls: 1,
    maxFallbackRpcCalls: 0,
    maxDurationMs: 100,
  });
  assert.throws(() => epochBudget.reserveEpochs(5), assertBudgetReason("epoch"));
}

async function testSmallHistoryCompatibility() {
  const epochs = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  const window = selectRebateRefreshWindow(epochs, 0, 48);
  assert.deepEqual(window.items, epochs);
  assert.equal(window.complete, true);
  assert.equal(window.nextOffset, null);

  const budget = createRebateRefreshBudget({
    maxEpochs: 56,
    maxRpcCalls: 64,
    maxFallbackRpcCalls: 48,
    maxDurationMs: 8_000,
  });
  budget.reserveEpochs(epochs.length);
  assert.deepEqual(await budget.runRpc("summary", async () => [120n, 2n] as const), [120n, 2n]);
  assert.equal((await budget.runRpc("recent", async () => epochs.slice(0, 8))).length, 8);
  assert.deepEqual(await budget.runRpc("exact", async () => [12, 7]), [12, 7]);
  assert.equal(budget.snapshot().rpcCount, 3);
}

function testRouteIntegration() {
  const routeSource = readFileSync("app/api/rebates/route.ts", "utf8");
  const hookSource = readFileSync("app/hooks/useRebate.ts", "utf8");
  assert.match(
    routeSource,
    /createRebateRefreshBudget\(\{[\s\S]*maxRpcCalls: REBATE_REFRESH_MAX_RPC_CALLS[\s\S]*maxDurationMs: REBATE_REFRESH_MAX_DURATION_MS/,
    "the public rebate refresh must enforce a shared epoch, RPC, deadline, and fallback budget",
  );
  assert.match(routeSource, /REBATE_SUMMARY_SCAN_EPOCH_LIMIT = 384/);
  assert.match(routeSource, /REBATE_EXACT_SCAN_EPOCH_LIMIT = REBATE_EXACT_CHUNK_SIZE/);
  assert.match(
    routeSource,
    /budget\.runRpc\("exact"[\s\S]*budget\.runRpc\("fallback"/,
    "exact batching and its per-epoch fallback must use the same work budget",
  );
  assert.match(
    routeSource,
    /getInflight\(effectiveCacheKey\)[\s\S]*markRouteInflightJoin/,
    "same-key refreshes must retain in-flight joining",
  );
  assert.match(
    routeSource,
    /rebateScanStateCache\.getStale\(scanStateKey\)[\s\S]*selectRebateRefreshWindow[\s\S]*appendRebateRefreshTotals[\s\S]*rebateScanStateCache\.set/,
    "large histories must accumulate bounded newest-first windows instead of publishing each window as a full total",
  );
  assert.match(
    routeSource,
    /shouldSkip: \(\) => \{[\s\S]*return shouldSkipUnchangedRebateRefresh\(\{[\s\S]*hasWorkingCycle: Boolean\(scanState\?\.working\)[\s\S]*cachedWatermark[\s\S]*currentWatermark: watermark/,
    "the route must delegate incomplete-cycle and unchanged-watermark decisions to the behavior-tested runtime policy",
  );
  assert.match(
    routeSource,
    /const publishedCycle = cycleComplete \? updatedCycle : \(committedCycle \?\? updatedCycle\)[\s\S]*servingCommitted/,
    "a new partial cycle must keep the last complete aggregate visible",
  );
  assert.match(
    hookSource,
    /normalizedPayload\.scan\.complete[\s\S]*"background-refresh"/,
    "the client must explicitly present an incomplete aggregate as a background refresh",
  );
}

async function main() {
  await testFiveThousandEpochContinuation();
  await testSharedRpcAndDeadlineBudgets();
  await testSmallHistoryCompatibility();
  testRouteIntegration();
  console.log("rebate refresh budget tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
