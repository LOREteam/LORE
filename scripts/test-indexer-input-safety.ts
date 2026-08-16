import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import {
  advanceIndexerMaintenanceRangeCursor,
  applyIndexerMaintenanceRangeOutcome,
  awaitExactRpcAgreement,
  createBoundedBackwardBlockScanPlan,
  createBoundedIndexerRpcFetch,
  createBoundedIndexerRunPlan,
  createIndexerMaintenanceRangeAttempt,
  createIndexerRpcWorkBudget,
  createReconcileEpochPlan,
  getIndexerRpcResponseLimitError,
  getUniqueRpcUrls,
  INDEXER_OPERATOR_BLOCKED_EXIT_CODE,
  INDEXER_RPC_MAX_LOG_DATA_BYTES,
  parsePlausibleCurrentEpoch,
  parseIndexerCatchupChunkBlocks,
  planIndexerMaintenanceResponseLimitRecovery,
  planIndexerResponseLimitRecovery,
  reduceIndexerCatchupChunkBlocks,
  requireIndependentRpcUrls,
  requireAgreedRpcLogSets,
  requireAgreedRpcValues,
  isIndexerRpcResponseLimitError,
  selectReconcileResumeEpochCursor,
  validateRpcLogSet,
  type IndexerRpcLog,
} from "./indexerSafety";
import { parseOptionalPositiveIntegerInRangeEnv } from "../config/envParsing";
import { hasTwoIndependentPublicRpcOrigins } from "../config/productionRuntime";

const CONTRACT = `0x${"11".repeat(20)}`;
const OTHER_CONTRACT = `0x${"22".repeat(20)}`;
const BLOCK_HASH = `0x${"aa".repeat(32)}`;
const TOPIC = `0x${"bb".repeat(32)}`;
const OTHER_TOPIC = `0x${"cc".repeat(32)}`;

function makeLog(index: number, overrides: Partial<IndexerRpcLog> = {}): IndexerRpcLog {
  return {
    address: CONTRACT,
    blockHash: BLOCK_HASH,
    blockNumber: 105n,
    data: "0x12",
    logIndex: index,
    removed: false,
    topics: [TOPIC],
    transactionHash: `0x${index.toString(16).padStart(64, "0")}`,
    ...overrides,
  };
}

const validationOptions = {
  contractAddress: CONTRACT,
  fromBlock: 100n,
  toBlock: 110n,
  requestedTopics: [TOPIC],
};

const firstProvider = validateRpcLogSet(
  [makeLog(2), makeLog(1)],
  validationOptions,
);
const secondProvider = validateRpcLogSet(
  [
    makeLog(1, {
      address: CONTRACT.toUpperCase(),
      blockHash: BLOCK_HASH.toUpperCase(),
      data: "0x12".toUpperCase(),
      topics: [TOPIC.toUpperCase()],
    }),
    makeLog(2),
  ],
  validationOptions,
);
assert.equal(requireAgreedRpcLogSets([firstProvider, secondProvider], 2).length, 2);
assert.match(firstProvider.agreementFingerprint, /^[0-9a-f]{64}$/);
assert.equal(firstProvider.payloadFingerprints.every((value) => /^[0-9a-f]{64}$/.test(value)), true);
assert.equal(
  firstProvider.agreementFingerprint,
  secondProvider.agreementFingerprint,
  "normalized log-set fingerprints must be fixed-size and order-independent",
);
assert.equal(
  getUniqueRpcUrls([
    "https://rpc.example",
    "https://rpc.example/",
    " https://other.example ",
  ]).length,
  2,
  "canonical duplicate URLs must not count as independent providers",
);
assert.deepEqual(
  requireIndependentRpcUrls([
    "https://rpc-a.example",
    "https://rpc-b.example",
  ]),
  ["https://rpc-a.example", "https://rpc-b.example"],
  "two unique approved endpoints must preserve normal indexer startup",
);
assert.throws(
  () => requireIndependentRpcUrls(["https://rpc.example"]),
  /requires at least 2 independent RPC origins; received 1/,
  "a one-endpoint configuration must fail closed before indexing",
);
assert.throws(
  () => requireIndependentRpcUrls([
    "https://rpc.example",
    "https://rpc.example/",
  ]),
  /requires at least 2 independent RPC origins; received 1/,
  "canonical duplicate endpoints must not satisfy the two-witness boundary",
);
assert.throws(
  () => requireIndependentRpcUrls([
    "https://RPC.example:8443/project-a?key=one",
    "https://rpc.example/project-b?key=two",
  ]),
  /requires at least 2 independent RPC origins; received 1/,
  "ports, paths, queries, case, and default aliases of one hostname must count as one witness",
);
assert.equal(
  hasTwoIndependentPublicRpcOrigins([
    "https://RPC.example:8443/project-a?key=one",
    "https://rpc.example./project-b?key=two",
  ]),
  false,
  "the production runtime must not treat two ports on one canonical hostname as wallet witnesses",
);
assert.equal(
  hasTwoIndependentPublicRpcOrigins([
    "https://rpc-a.example:8443/project-a",
    "https://rpc-b.example/project-b",
  ]),
  true,
  "two distinct canonical hostnames must preserve production wallet quorum",
);
assert.throws(
  () => requireIndependentRpcUrls([
    "https://rpc.example",
    "https://rpc.example./different-key",
  ]),
  /requires at least 2 independent RPC origins; received 1/,
  "a terminal DNS dot must not turn one provider origin into a second witness",
);

for (const [label, log, expected] of [
  ["wrong address", makeLog(1, { address: OTHER_CONTRACT }), /wrong contract address/],
  ["removed log", makeLog(1, { removed: true }), /removed or malformed/],
  ["out of range", makeLog(1, { blockNumber: 111n }), /outside the requested block range/],
  ["malformed identity", makeLog(1, { transactionHash: "0x12" }), /malformed identity fields/],
  ["missing topic", makeLog(1, { topics: [] }), /without a valid topic identity/],
  ["malformed topic", makeLog(1, { topics: ["0x12"] }), /malformed topics/],
  ["wrong topic", makeLog(1, { topics: [OTHER_TOPIC] }), /outside the requested topic filter/],
] as const) {
  assert.throws(
    () => validateRpcLogSet([log], validationOptions),
    expected,
    `${label} must fail closed`,
  );
}

assert.throws(
  () => validateRpcLogSet([makeLog(1, { topics: [TOPIC, TOPIC, TOPIC, TOPIC, TOPIC] })], {
    ...validationOptions,
    requestedTopics: [],
  }),
  /valid topic identity/,
  "an RPC log must not exceed Ethereum's four-topic protocol limit",
);
assert.throws(
  () => validateRpcLogSet([makeLog(1, {
    data: `0x${"00".repeat(INDEXER_RPC_MAX_LOG_DATA_BYTES + 1)}`,
  })], validationOptions),
  /response limit exceeded: bytes/,
  "oversized log data must fail before regex and fingerprint construction",
);

assert.throws(
  () => validateRpcLogSet([makeLog(1), makeLog(1)], validationOptions),
  /duplicate normalized log identities/,
);

const knownUpstreamLimitErrors = [
  {
    error: new Error("query returned more than 10000 results"),
    reason: "upstream_response",
  },
  {
    error: new Error("RPC request failed", {
      cause: { code: -32005, message: "Response size exceeded" },
    }),
    reason: "upstream_response",
  },
  {
    error: new Error("HTTP request failed", {
      cause: new Error("block range too wide"),
    }),
    reason: "upstream_range",
  },
] as const;
for (const { error, reason } of knownUpstreamLimitErrors) {
  const classified = getIndexerRpcResponseLimitError(error);
  assert.ok(classified, "known upstream provider limits must be typed for bounded recovery");
  assert.equal(
    classified.message,
    `indexer RPC response limit exceeded: ${reason}`,
    "provider text must map to a bounded internal reason without being propagated",
  );
  assert.equal(isIndexerRpcResponseLimitError(error), true);
}

for (const genericProviderError of [
  new Error("HTTP 401 unauthorized"),
  new Error("fetch failed", { cause: new Error("ECONNRESET") }),
  { code: -32005, message: "request limit exceeded" },
  new Error("query returned 9999 results"),
]) {
  assert.equal(
    getIndexerRpcResponseLimitError(genericProviderError),
    null,
    "auth, network, code-only, and generic provider failures must not masquerade as density",
  );
}

assert.equal(parseIndexerCatchupChunkBlocks(null, 5_000n), 5_000n);
assert.equal(parseIndexerCatchupChunkBlocks("625", 5_000n), 625n);
for (const invalidChunkState of [
  0,
  "0",
  "01",
  "-1",
  "5001",
  "9".repeat(10_000),
  "not-a-number",
]) {
  assert.throws(
    () => parseIndexerCatchupChunkBlocks(invalidChunkState, 5_000n),
    /stored indexer catch-up chunk span/,
    "corrupt or expanded durable catch-up spans must fail closed",
  );
}
assert.equal(reduceIndexerCatchupChunkBlocks(5_000n), 2_500n);
assert.equal(reduceIndexerCatchupChunkBlocks(100n), 50n);
assert.equal(reduceIndexerCatchupChunkBlocks(1n), 1n);
const catchupBackoffSequence: bigint[] = [];
for (let span = 5_000n; ; span = reduceIndexerCatchupChunkBlocks(span)) {
  catchupBackoffSequence.push(span);
  if (span === 1n) break;
}
assert.deepEqual(
  catchupBackoffSequence,
  [5_000n, 2_500n, 1_250n, 625n, 313n, 157n, 79n, 40n, 20n, 10n, 5n, 3n, 2n, 1n],
  "pre-commit budget failures must converge monotonically to a one-block retry",
);
assert.deepEqual(
  planIndexerResponseLimitRecovery(5_000n),
  { kind: "retry", nextChunkBlocks: 2_500n },
  "a dense catch-up response must reduce the durable retry span",
);
assert.deepEqual(
  planIndexerResponseLimitRecovery(2n),
  { kind: "retry", nextChunkBlocks: 1n },
  "response-limit recovery must converge to a one-block attempt",
);
assert.deepEqual(
  planIndexerResponseLimitRecovery(1n),
  { kind: "blocked" },
  "an impossible one-block response must require operator intervention instead of retrying",
);
const responseRecoverySequence: Array<bigint | "blocked"> = [];
for (let span = 5_000n; ;) {
  responseRecoverySequence.push(span);
  const recovery = planIndexerResponseLimitRecovery(span);
  if (recovery.kind === "blocked") {
    responseRecoverySequence.push("blocked");
    break;
  }
  span = recovery.nextChunkBlocks;
}
assert.deepEqual(
  responseRecoverySequence,
  [5_000n, 2_500n, 1_250n, 625n, 313n, 157n, 79n, 40n, 20n, 10n, 5n, 3n, 2n, 1n, "blocked"],
  "repeated dense responses must reach a terminal one-block block in bounded retries",
);
assert.throws(
  () => planIndexerResponseLimitRecovery(0n),
  /invalid indexer catch-up chunk attempt span/,
  "invalid response-limit recovery spans must fail closed",
);

const repairAttempt = createIndexerMaintenanceRangeAttempt({
  cursorBlock: 100n,
  boundaryBlock: 10_099n,
  chunkBlocks: 10_000n,
  direction: "forward",
});
assert.deepEqual(
  repairAttempt,
  { fromBlock: 100n, toBlock: 10_099n, span: 10_000n },
  "repair must derive its attempted range from the durable forward cursor",
);
const repairRecovery = planIndexerResponseLimitRecovery(repairAttempt!.span);
assert.deepEqual(repairRecovery, { kind: "retry", nextChunkBlocks: 5_000n });
assert.deepEqual(
  planIndexerMaintenanceResponseLimitRecovery(
    repairAttempt!.fromBlock,
    repairAttempt!.span,
  ),
  { kind: "retry", cursorBlock: 100n, nextChunkBlocks: 5_000n },
  "repair backoff must preserve its durable forward cursor",
);
assert.deepEqual(
  createIndexerMaintenanceRangeAttempt({
    cursorBlock: 100n,
    boundaryBlock: 10_099n,
    chunkBlocks: repairRecovery.kind === "retry" ? repairRecovery.nextChunkBlocks : 1n,
    direction: "forward",
  }),
  { fromBlock: 100n, toBlock: 5_099n, span: 5_000n },
  "repair response-limit recovery must keep the cursor fixed and consume the persisted smaller span",
);
assert.equal(
  advanceIndexerMaintenanceRangeCursor(repairAttempt!, 10_099n, "forward"),
  null,
  "repair advances only after the exact attempted range succeeds",
);

const reconcileAttempt = createIndexerMaintenanceRangeAttempt({
  cursorBlock: 10_099n,
  boundaryBlock: 100n,
  chunkBlocks: 10_000n,
  direction: "backward",
});
assert.deepEqual(
  reconcileAttempt,
  { fromBlock: 100n, toBlock: 10_099n, span: 10_000n },
  "reconcile must derive its attempted range from the durable backward cursor",
);
const reconcileRecovery = planIndexerResponseLimitRecovery(reconcileAttempt!.span);
assert.deepEqual(reconcileRecovery, { kind: "retry", nextChunkBlocks: 5_000n });
assert.deepEqual(
  planIndexerMaintenanceResponseLimitRecovery(
    reconcileAttempt!.toBlock,
    reconcileAttempt!.span,
  ),
  { kind: "retry", cursorBlock: 10_099n, nextChunkBlocks: 5_000n },
  "reconcile backoff must preserve its durable backward cursor",
);
assert.deepEqual(
  createIndexerMaintenanceRangeAttempt({
    cursorBlock: 10_099n,
    boundaryBlock: 100n,
    chunkBlocks: reconcileRecovery.kind === "retry" ? reconcileRecovery.nextChunkBlocks : 1n,
    direction: "backward",
  }),
  { fromBlock: 5_100n, toBlock: 10_099n, span: 5_000n },
  "reconcile response-limit recovery must keep the cursor fixed and consume the persisted smaller span",
);
assert.equal(
  advanceIndexerMaintenanceRangeCursor(reconcileAttempt!, 100n, "backward"),
  null,
  "reconcile advances only after the exact attempted range succeeds",
);
assert.deepEqual(
  planIndexerMaintenanceResponseLimitRecovery(321n, 1n),
  { kind: "blocked", cursorBlock: 321n, exitCode: INDEXER_OPERATOR_BLOCKED_EXIT_CODE },
  "a one-block maintenance response limit must stop with the dedicated operator exit",
);

const repairCursor = 100n;
let repairChunkBlocks = 8n;
for (const expectedChunk of [4n, 2n, 1n]) {
  const outcome = applyIndexerMaintenanceRangeOutcome({
    cursorBlock: repairCursor,
    boundaryBlock: 107n,
    chunkBlocks: repairChunkBlocks,
    direction: "forward",
    outcome: "response_limit",
  });
  assert.equal(outcome.kind, "retry");
  assert.equal(outcome.cursorBlock, repairCursor, "repair failure must not advance its cursor");
  assert.equal(outcome.nextChunkBlocks, expectedChunk);
  repairChunkBlocks = expectedChunk;
}
assert.deepEqual(
  applyIndexerMaintenanceRangeOutcome({
    cursorBlock: repairCursor,
    boundaryBlock: 107n,
    chunkBlocks: repairChunkBlocks,
    direction: "forward",
    outcome: "response_limit",
  }),
  { kind: "blocked", cursorBlock: repairCursor, exitCode: INDEXER_OPERATOR_BLOCKED_EXIT_CODE },
  "repair must terminate at one block instead of repeating the same maintenance pass",
);
assert.deepEqual(
  applyIndexerMaintenanceRangeOutcome({
    cursorBlock: 100n,
    boundaryBlock: 107n,
    chunkBlocks: 4n,
    direction: "forward",
    outcome: "success",
  }),
  { kind: "advanced", cursorBlock: 104n, nextChunkBlocks: 4n },
  "repair must advance only after a successful exact subrange",
);

const reconcileCursor = 107n;
let reconcileChunkBlocks = 8n;
for (const expectedChunk of [4n, 2n, 1n]) {
  const outcome = applyIndexerMaintenanceRangeOutcome({
    cursorBlock: reconcileCursor,
    boundaryBlock: 100n,
    chunkBlocks: reconcileChunkBlocks,
    direction: "backward",
    outcome: "response_limit",
  });
  assert.equal(outcome.kind, "retry");
  assert.equal(
    outcome.cursorBlock,
    reconcileCursor,
    "reconcile failure must not advance its exact phase/block cursor",
  );
  assert.equal(outcome.nextChunkBlocks, expectedChunk);
  reconcileChunkBlocks = expectedChunk;
}
assert.deepEqual(
  applyIndexerMaintenanceRangeOutcome({
    cursorBlock: reconcileCursor,
    boundaryBlock: 100n,
    chunkBlocks: reconcileChunkBlocks,
    direction: "backward",
    outcome: "response_limit",
  }),
  { kind: "blocked", cursorBlock: reconcileCursor, exitCode: INDEXER_OPERATOR_BLOCKED_EXIT_CODE },
  "reconcile must terminate at one block instead of repeating the same maintenance pass",
);
assert.deepEqual(
  applyIndexerMaintenanceRangeOutcome({
    cursorBlock: 107n,
    boundaryBlock: 100n,
    chunkBlocks: 4n,
    direction: "backward",
    outcome: "success",
  }),
  { kind: "advanced", cursorBlock: 103n, nextChunkBlocks: 4n },
  "reconcile must advance only after a successful exact subrange",
);
assert.throws(
  () => requireAgreedRpcLogSets([firstProvider], 2),
  /insufficient independent RPC responses/,
);
assert.throws(
  () => requireAgreedRpcLogSets([firstProvider], 1),
  /requires at least two independent responses/,
  "callers must not weaken the log quorum to one response",
);
assert.equal(
  requireAgreedRpcValues([100n, 100n], 2, (value) => value.toString()),
  100n,
);
assert.throws(
  () => requireAgreedRpcValues([100n], 2, (value) => value.toString()),
  /insufficient independent RPC responses/,
);
assert.throws(
  () => requireAgreedRpcValues([100n, 101n], 2, (value) => value.toString()),
  /disagreed on normalized value/,
);
assert.throws(
  () => requireAgreedRpcValues([100n, 100n], 1, (value) => value.toString()),
  /requires at least two independent responses/,
);
assert.throws(
  () => requireAgreedRpcLogSets([
    firstProvider,
    validateRpcLogSet([makeLog(1), makeLog(3)], validationOptions),
  ], 2),
  /disagreed on normalized log identities/,
);
assert.throws(
  () => requireAgreedRpcLogSets([
    firstProvider,
    validateRpcLogSet([makeLog(1, { data: "0x34" }), makeLog(2)], validationOptions),
  ], 2),
  /disagreed on normalized log payloads/,
);

assert.deepEqual(
  createBoundedIndexerRunPlan(100n, 8_000n, 5_000n, 100_000n, 20),
  { fromBlock: 101n, toBlock: 8_000n, chunkCount: 2, capped: false },
);
assert.deepEqual(
  createBoundedIndexerRunPlan(100n, 9_000_000_000n, 5_000n, 100_000n, 20),
  { fromBlock: 101n, toBlock: 100_100n, chunkCount: 20, capped: true },
  "an adversarial head must not create more than the fixed per-run chunk budget",
);
assert.deepEqual(
  createBoundedBackwardBlockScanPlan(100n, 1_000n, 100n, 3),
  {
    fromBlock: 701n,
    toBlock: 1_000n,
    chunkCount: 3,
    nextToBlock: 700n,
    complete: false,
  },
  "full-history reconcile must consume only its fixed per-pass chunk budget",
);
assert.deepEqual(
  createBoundedBackwardBlockScanPlan(100n, 250n, 100n, 3),
  {
    fromBlock: 100n,
    toBlock: 250n,
    chunkCount: 2,
    nextToBlock: null,
    complete: true,
  },
  "the durable backward cursor must terminate exactly at the deploy block",
);
assert.equal(parsePlausibleCurrentEpoch(10n, 100n, 109n), 10);
assert.equal(parsePlausibleCurrentEpoch(11n, 100n, 109n), null);
assert.equal(parsePlausibleCurrentEpoch(1n, 100n, 99n), null);
assert.equal(
  parseOptionalPositiveIntegerInRangeEnv("999999999", 8, 1, 32),
  32,
  "operator input must not expand the per-pass epoch target cap",
);

let budgetClock = 1_000;
const workBudget = createIndexerRpcWorkBudget({
  maxRpcCalls: 2,
  maxLogs: 3,
  maxSplitNodes: 1,
  maxElapsedMs: 100,
  nowMs: () => budgetClock,
});
assert.equal(workBudget.consumeRpcCall(), 100);
workBudget.recordLogs(2);
workBudget.consumeRpcCall();
workBudget.consumeSplitNode();
assert.deepEqual(workBudget.snapshot(), { rpcCalls: 2, logs: 2, splitNodes: 1 });
assert.throws(
  () => workBudget.consumeRpcCall(),
  /budget exhausted: rpc_calls/,
  "adaptive retries and splits must share one hard RPC-call cap",
);
assert.throws(
  () => workBudget.recordLogs(2),
  /budget exhausted: logs/,
  "provider responses must share one hard observed-log cap",
);
assert.throws(
  () => workBudget.consumeSplitNode(),
  /budget exhausted: split_nodes/,
  "generic RPC failures must not create an unbounded adaptive split tree",
);
budgetClock = 1_100;
assert.throws(
  () => workBudget.remainingTimeMs(),
  /budget exhausted: time/,
  "full-history reconciliation must stop at its elapsed-time deadline",
);

async function testBoundedRpcAgreement() {
  let thirdProviderStarted = false;
  const fastAgreementBudget = createIndexerRpcWorkBudget({
  maxRpcCalls: 3,
  maxLogs: 3,
  maxSplitNodes: 1,
  maxElapsedMs: 100,
});
  assert.equal(
    await awaitExactRpcAgreement(
    [
      async () => 100n,
      async () => 100n,
      async () => {
        thirdProviderStarted = true;
        return 100n;
      },
    ],
    2,
    (value) => value.toString(),
    fastAgreementBudget,
  ),
    100n,
    "two exact responses must complete agreement without awaiting a useless third provider",
  );
  assert.equal(thirdProviderStarted, false, "the third provider must remain idle after exact quorum");

  const unilateralLimitBudget = createIndexerRpcWorkBudget({
    maxRpcCalls: 2,
    maxLogs: 2,
    maxSplitNodes: 1,
    maxElapsedMs: 100,
  });
  await assert.rejects(
    awaitExactRpcAgreement(
      [
        async () => 100n,
        async () => {
          throw new Error("RPC request failed", {
            cause: { code: -32005, message: "Response size exceeded" },
          });
        },
      ],
      2,
      (value) => value.toString(),
      unilateralLimitBudget,
    ),
    (error: unknown) => {
      assert.equal(
        isIndexerRpcResponseLimitError(error),
        false,
        "one provider must not unilaterally trigger durable response-limit recovery",
      );
      assert.match(
        error instanceof Error ? error.message : String(error),
        /insufficient independent RPC responses for exact agreement/,
      );
      return true;
    },
    "one canonical response plus one limit rejection must remain a restartable quorum failure",
  );

  let replacementWitnessStarted = false;
  const replacementWitnessBudget = createIndexerRpcWorkBudget({
    maxRpcCalls: 3,
    maxLogs: 3,
    maxSplitNodes: 1,
    maxElapsedMs: 100,
  });
  assert.equal(
    await awaitExactRpcAgreement(
      [
        async () => 100n,
        async () => {
          throw new Error("Response size exceeded");
        },
        async () => {
          replacementWitnessStarted = true;
          return 100n;
        },
      ],
      2,
      (value) => value.toString(),
      replacementWitnessBudget,
    ),
    100n,
    "a third honest origin must still form quorum after one unilateral limit rejection",
  );
  assert.equal(
    replacementWitnessStarted,
    true,
    "a limit rejection must start the bounded replacement witness",
  );

  const corroboratedLimitBudget = createIndexerRpcWorkBudget({
    maxRpcCalls: 2,
    maxLogs: 2,
    maxSplitNodes: 1,
    maxElapsedMs: 100,
  });
  await assert.rejects(
    awaitExactRpcAgreement(
      [
        async () => {
          throw new Error("Response size exceeded");
        },
        async () => {
          throw new Error("block range too wide");
        },
      ],
      2,
      (value) => String(value),
      corroboratedLimitBudget,
    ),
    (error: unknown) => {
      assert.equal(
        isIndexerRpcResponseLimitError(error),
        true,
        "two independent limit rejections must retain typed bounded recovery",
      );
      return true;
    },
    "corroborated provider limits must still trigger quorum-level range reduction",
  );

  const stalledPeerLimitBudget = createIndexerRpcWorkBudget({
    maxRpcCalls: 3,
    maxLogs: 3,
    maxSplitNodes: 1,
    maxElapsedMs: 100,
  });
  const stalledPeerLimitResult = await Promise.race([
    awaitExactRpcAgreement(
      [
        () => new Promise<bigint>(() => {}),
        async () => {
          throw new Error("Response size exceeded");
        },
        async () => {
          throw new Error("block range too wide");
        },
      ],
      2,
      (value) => value.toString(),
      stalledPeerLimitBudget,
    ).then(
      () => "unexpected_fulfillment" as const,
      (error) => isIndexerRpcResponseLimitError(error)
        ? "response_limit" as const
        : "unexpected_error" as const,
    ),
    new Promise<"still_waiting">((resolve) => {
      setTimeout(resolve, 20, "still_waiting");
    }),
  ]);
  assert.equal(
    stalledPeerLimitResult,
    "response_limit",
    "two corroborating limit rejections must win before an already-started stalled peer deadline",
  );

  const lateMutationBudget = createIndexerRpcWorkBudget({
    maxRpcCalls: 3,
    maxLogs: 3,
    maxSplitNodes: 1,
    maxElapsedMs: 100,
  });
  let releaseLateProvider = () => {};
  const lateProviderGate = new Promise<void>((resolve) => {
    releaseLateProvider = resolve;
  });
  let markLateProviderStarted = () => {};
  const lateProviderStarted = new Promise<void>((resolve) => {
    markLateProviderStarted = resolve;
  });
  let markLateProviderFinished = () => {};
  const lateProviderFinished = new Promise<void>((resolve) => {
    markLateProviderFinished = resolve;
  });
  let lateProviderAttemptedBudgetMutation = false;
  const unhandledRejections: unknown[] = [];
  const recordUnhandledRejection = (reason: unknown) => {
    unhandledRejections.push(reason);
  };
  process.on("unhandledRejection", recordUnhandledRejection);
  try {
    await assert.rejects(
      awaitExactRpcAgreement(
        [
          async () => {
            throw new Error("Response size exceeded");
          },
          async () => {
            await lateProviderStarted;
            throw new Error("block range too wide");
          },
          async (signal?: AbortSignal) => {
            markLateProviderStarted();
            await lateProviderGate;
            lateProviderAttemptedBudgetMutation = true;
            try {
              signal?.throwIfAborted();
              lateMutationBudget.recordLogs(1);
              throw new Error("late provider rejection");
            } finally {
              markLateProviderFinished();
            }
          },
        ],
        2,
        (value) => String(value),
        lateMutationBudget,
      ),
      (error: unknown) => {
        assert.equal(isIndexerRpcResponseLimitError(error), true);
        return true;
      },
      "two fast independent limits must complete while the delayed third provider is pending",
    );
    releaseLateProvider();
    await lateProviderFinished;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(
      lateProviderAttemptedBudgetMutation,
      true,
      "the delayed provider must reach its guarded post-terminal budget mutation",
    );
    assert.deepEqual(
      lateMutationBudget.snapshot(),
      { rpcCalls: 0, logs: 0, splitNodes: 0 },
      "an aborted late provider must not mutate the shared agreement budget",
    );
    assert.deepEqual(
      unhandledRejections,
      [],
      "a rejected late provider settlement must remain absorbed after agreement termination",
    );
  } finally {
    releaseLateProvider();
    process.off("unhandledRejection", recordUnhandledRejection);
  }

  const unilateralLimitTimeoutBudget = createIndexerRpcWorkBudget({
    maxRpcCalls: 3,
    maxLogs: 3,
    maxSplitNodes: 1,
    maxElapsedMs: 10,
  });
  await assert.rejects(
    awaitExactRpcAgreement(
      [
        async () => {
          throw new Error("Response size exceeded");
        },
        async () => 100n,
        () => new Promise<bigint>(() => {}),
      ],
      2,
      (value) => value.toString(),
      unilateralLimitTimeoutBudget,
    ),
    /budget exhausted: time/,
    "one limit plus one honest response and one stalled witness must remain time-bounded",
  );

  const disagreementBudget = createIndexerRpcWorkBudget({
    maxRpcCalls: 2,
    maxLogs: 2,
    maxSplitNodes: 1,
    maxElapsedMs: 100,
  });
  await assert.rejects(
    awaitExactRpcAgreement(
      [async () => 100n, async () => 101n],
      2,
      (value) => value.toString(),
      disagreementBudget,
    ),
    /independent RPC providers disagreed on normalized value/,
    "two fulfilled but different values must retain exact-disagreement semantics",
  );

  let tieBreakerStarted = false;
  const tieBreakerBudget = createIndexerRpcWorkBudget({
  maxRpcCalls: 3,
  maxLogs: 3,
  maxSplitNodes: 1,
  maxElapsedMs: 100,
});
  assert.equal(
    await awaitExactRpcAgreement(
    [
      async () => 100n,
      async () => 101n,
      async () => {
        tieBreakerStarted = true;
        return 100n;
      },
    ],
    2,
    (value) => value.toString(),
    tieBreakerBudget,
  ),
    100n,
    "a third independent provider may break a disagreement only by matching one exact value",
  );
  assert.equal(tieBreakerStarted, true, "disagreement must start the bounded tie-breaker provider");

  const logReservationBudget = createIndexerRpcWorkBudget({
    maxRpcCalls: 3,
    maxLogs: 12,
    maxLogsPerResponse: 4,
    maxSplitNodes: 1,
    maxElapsedMs: 100,
  });
  assert.equal(
    await awaitExactRpcAgreement(
      [
        async () => {
          try {
            logReservationBudget.recordLogs(5);
          } catch (cause) {
            throw new Error("HTTP request failed.", { cause });
          }
          return "malicious-large-response";
        },
        async () => {
          logReservationBudget.recordLogs(4);
          return "honest";
        },
        async () => {
          logReservationBudget.recordLogs(4);
          return "honest";
        },
      ],
      2,
      (value) => value,
      logReservationBudget,
    ),
    "honest",
    "one over-cap response must leave log budget for two agreeing witnesses",
  );
  assert.deepEqual(
    logReservationBudget.snapshot(),
    { rpcCalls: 0, logs: 8, splitNodes: 0 },
    "a rejected provider response must not charge the shared accepted-log budget",
  );

  const allOversizedBudget = createIndexerRpcWorkBudget({
    maxRpcCalls: 3,
    maxLogs: 12,
    maxLogsPerResponse: 4,
    maxSplitNodes: 1,
    maxElapsedMs: 100,
  });
  await assert.rejects(
    awaitExactRpcAgreement(
      [
        async () => {
          allOversizedBudget.recordLogs(5);
          return "first";
        },
        async () => {
          allOversizedBudget.recordLogs(5);
          return "second";
        },
        async () => {
          allOversizedBudget.recordLogs(5);
          return "third";
        },
      ],
      2,
      (value) => value,
      allOversizedBudget,
    ),
    /response limit exceeded: logs/,
    "an all-provider oversized range must propagate to bounded quorum-level splitting",
  );

  const deadlineBudget = createIndexerRpcWorkBudget({
  maxRpcCalls: 2,
  maxLogs: 2,
  maxSplitNodes: 1,
  maxElapsedMs: 10,
});
  await assert.rejects(
    awaitExactRpcAgreement(
    [async () => 100n, () => new Promise<bigint>(() => {})],
    2,
    (value) => value.toString(),
    deadlineBudget,
  ),
    /budget exhausted: time/,
    "a stalled quorum must unwind at the one-pass hard deadline",
  );
}

function streamingResponse(
  chunks: readonly string[],
  headers: HeadersInit = { "content-type": "application/json" },
) {
  const encoder = new TextEncoder();
  let index = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    },
  }), { headers });
}

async function testBoundedRpcFetch() {
  let oversizedHeaderCancelled = false;
  const oversizedHeaderResponse = new Response(new ReadableStream<Uint8Array>({
    cancel() {
      oversizedHeaderCancelled = true;
    },
  }), {
    headers: {
      "content-length": "33",
      "content-type": "application/json",
    },
  });
  const oversizedHeaderFetch = createBoundedIndexerRpcFetch({
    maxResponseBytes: 32,
    maxJsonDepth: 4,
    fetchFn: async () => oversizedHeaderResponse,
  });
  await assert.rejects(
    oversizedHeaderFetch("https://rpc.example"),
    /response limit exceeded: bytes/,
    "declared oversized bodies must be rejected before viem can parse them",
  );
  assert.equal(oversizedHeaderCancelled, true, "oversized declared bodies must be cancelled");

  let malformedHeaderCancelled = false;
  const malformedHeaderFetch = createBoundedIndexerRpcFetch({
    maxResponseBytes: 32,
    maxJsonDepth: 4,
    fetchFn: async () => new Response(new ReadableStream<Uint8Array>({
      cancel() {
        malformedHeaderCancelled = true;
      },
    }), { headers: { "content-length": "not-a-number" } }),
  });
  await assert.rejects(
    malformedHeaderFetch("https://rpc.example"),
    /response limit exceeded: content_length/,
    "malformed response lengths must fail closed",
  );
  assert.equal(malformedHeaderCancelled, true);

  const chunkOverflowFetch = createBoundedIndexerRpcFetch({
    maxResponseBytes: 32,
    maxJsonDepth: 4,
    fetchFn: async () => streamingResponse(["x".repeat(16), "y".repeat(17)]),
  });
  const chunkOverflowResponse = await chunkOverflowFetch("https://rpc.example");
  await assert.rejects(
    chunkOverflowResponse.text(),
    /response limit exceeded: bytes/,
    "chunked bodies without Content-Length must stop at the actual byte cap",
  );

  const excessiveDepthFetch = createBoundedIndexerRpcFetch({
    maxResponseBytes: 1_024,
    maxJsonDepth: 4,
    fetchFn: async () => streamingResponse(["{\"result\":[[[[]]]]}"]),
  });
  const excessiveDepthResponse = await excessiveDepthFetch("https://rpc.example");
  await assert.rejects(
    excessiveDepthResponse.json(),
    /response limit exceeded: json_depth/,
    "raw JSON nesting must be bounded before JSON.parse completes",
  );

  const safePayload = JSON.stringify({
    jsonrpc: "2.0",
    result: [{ data: "braces { [ and escaped quote \\\" remain text" }],
  });
  const safeFetch = createBoundedIndexerRpcFetch({
    maxResponseBytes: 1_024,
    maxJsonDepth: 4,
    fetchFn: async () => streamingResponse(
      [safePayload.slice(0, 17), safePayload.slice(17)],
      {
        "content-length": String(Buffer.byteLength(safePayload)),
        "content-type": "application/json",
      },
    ),
  });
  const safeResponse = await safeFetch("https://rpc.example");
  assert.deepEqual(await safeResponse.json(), JSON.parse(safePayload));
}

const reconcilePlan = createReconcileEpochPlan({
  currentEpoch: 1_000_000,
  cursor: 10,
  indexedEpochs: new Set([11, 999_999]),
  maxTargets: 4,
  recentWindow: 3,
});
assert.deepEqual(reconcilePlan.targetEpochs, [10, 12, 13, 999_997]);
assert.equal(reconcilePlan.candidateEpochs.length, 7);
assert.equal(reconcilePlan.nextCursor, 14);
assert.equal(
  createReconcileEpochPlan({
    currentEpoch: 10,
    cursor: 8,
    indexedEpochs: new Set([8, 9]),
    maxTargets: 4,
    recentWindow: 2,
  }).nextCursor,
  1,
  "the durable cursor must wrap without enumerating the full epoch history",
);
const budgetLimitedReconcilePlan = createReconcileEpochPlan({
  currentEpoch: 100,
  cursor: 1,
  indexedEpochs: new Set(),
  maxTargets: 32,
  recentWindow: 32,
});
assert.equal(budgetLimitedReconcilePlan.sequentialTargetEpochs.length, 32);
assert.equal(
  selectReconcileResumeEpochCursor({
    plannedNextCursor: budgetLimitedReconcilePlan.nextCursor,
    sequentialTargetEpochs: budgetLimitedReconcilePlan.sequentialTargetEpochs,
    completedTargetEpochs: new Set(budgetLimitedReconcilePlan.targetEpochs.slice(0, 8)),
  }),
  9,
  "an eight-range maintenance budget must resume at target nine instead of skipping to epoch 33",
);
assert.equal(
  selectReconcileResumeEpochCursor({
    plannedNextCursor: budgetLimitedReconcilePlan.nextCursor,
    sequentialTargetEpochs: budgetLimitedReconcilePlan.sequentialTargetEpochs,
    completedTargetEpochs: new Set(budgetLimitedReconcilePlan.targetEpochs),
  }),
  33,
  "the planned epoch cursor may advance only after every sequential target was processed",
);

const indexerSource = readFileSync("scripts/indexer.ts", "utf8");
const ecosystemSource = readFileSync("ecosystem.config.cjs", "utf8");
const dataSyncHealthSource = readFileSync("app/api/health/data-sync/route.ts", "utf8");
const ecosystemModule: { exports: unknown } = { exports: {} };
runInNewContext(ecosystemSource, {
  module: ecosystemModule,
  exports: ecosystemModule.exports,
  process: { env: {} },
});
const ecosystemConfig = ecosystemModule.exports as {
  apps?: Array<{ name?: unknown; stop_exit_codes?: unknown }>;
};
const indexerProcess = ecosystemConfig.apps?.find((app) => app.name === "lore-indexer");
assert.ok(indexerProcess, "PM2 config must define the lore-indexer process");
assert.ok(
  Array.isArray(indexerProcess.stop_exit_codes) &&
    indexerProcess.stop_exit_codes.length === 1 &&
    indexerProcess.stop_exit_codes[0] === INDEXER_OPERATOR_BLOCKED_EXIT_CODE,
  "PM2 must semantically stop autorestarting the dedicated operator-blocked exit",
);
assert.match(
  indexerSource,
  /awaitExactRpcAgreement\([\s\S]*independentRpcClients\.map[\s\S]*validateRpcLogSet[\s\S]*agreementFingerprint/,
  "every indexed log fetch must validate and require exact independent-provider agreement",
);
assert.equal(
  (
    indexerSource.match(
      /independentRpcClients\.map\(\(rpcClient, index\) => async \(signal\) => \{/g,
    ) ?? []
  ).length,
  2,
  "both production agreement factories must receive the terminal cancellation signal",
);
assert.match(
  indexerSource,
  /async function withRpcTimeout<T>\([\s\S]*signal: AbortSignal[\s\S]*Promise\.race<T>\(\[[\s\S]*signal\.addEventListener\("abort"[\s\S]*signal\.removeEventListener\("abort"/,
  "RPC timeout races must absorb late provider results and unwind on agreement cancellation",
);
assert.match(
  indexerSource,
  /async function fetchLogsRequestWithRetry\([\s\S]*signal: AbortSignal[\s\S]*budget\.consumeRpcCall\(\)[\s\S]*withRpcTimeout\([\s\S]*signal,[\s\S]*signal\.throwIfAborted\(\);[\s\S]*budget\.recordLogs/,
  "log factories must check cancellation around RPC and before shared call/log budget mutations",
);
assert.match(
  indexerSource,
  /async function fetchLogsRequestAdaptiveSplit\([\s\S]*signal: AbortSignal[\s\S]*signal\.throwIfAborted\(\);[\s\S]*budget\.consumeSplitNode\(\)[\s\S]*await delay\([\s\S]*signal\)/,
  "adaptive provider retries and splits must remain cancellation-aware",
);
assert.match(
  indexerSource,
  /async function readWithExactIndexerRpcAgreement<T>\([\s\S]*async \(signal\)[\s\S]*signal\.throwIfAborted\(\);[\s\S]*budget\.consumeRpcCall\(\)[\s\S]*withRpcTimeout\([\s\S]*signal,[\s\S]*signal\.throwIfAborted\(\);[\s\S]*return value/,
  "non-log RPC agreement factories must guard their shared call budget and late results",
);
assert.match(
  indexerSource,
  /const boundedIndexerRpcFetch = createBoundedIndexerRpcFetch\(\);[\s\S]*independentRpcClients[\s\S]*http\(url,[\s\S]*fetchFn: boundedIndexerRpcFetch/,
  "every configured indexer HTTP provider must be bounded before viem parses its response",
);
assert.match(
  indexerSource,
  /readWithExactIndexerRpcAgreement[\s\S]*readAgreedHeadBlockNumber[\s\S]*readCanonicalBlockHash[\s\S]*getCurrentEpochFromChain[\s\S]*blockNumber: currentBlock/,
  "head, block hashes, current epoch, and jackpot flags must use exact independent-RPC agreement",
);
assert.doesNotMatch(
  indexerSource,
  /\bclient\.(?:getBlockNumber|getBlock|readContract|getLogs)\b/,
  "persistence-driving indexer reads must not fall back to one ranked RPC response",
);
assert.match(
  indexerSource,
  /parseOptionalPositiveIntegerInRangeEnv\([\s\S]*INDEXER_RECONCILE_MAX_EPOCHS_PER_PASS[\s\S]*RECONCILE_MAX_EPOCHS_HARD_CAP/,
  "the reconcile epoch env override must have a fixed hard cap",
);
assert.match(
  indexerSource,
  /createBoundedIndexerRunPlan\([\s\S]*const chunkCount = runPlan\.chunkCount/,
  "main indexer chunk counts must come from the arithmetic bounded run plan",
);
assert.match(
  indexerSource,
  /getIndexerCatchupChunkBlocks\(\)[\s\S]*createBoundedIndexerRunPlan\([\s\S]*catchupChunkBlocks[\s\S]*start \+= catchupChunkBlocks/,
  "restarts must consume the strict durable catch-up chunk span",
);
assert.match(
  indexerSource,
  /catch \(error\)[\s\S]*isIndexerRpcWorkBudgetError\(error\)[\s\S]*committedChunksThisPass === 0[\s\S]*reduceIndexerCatchupChunkBlocks[\s\S]*runIndexerStorageTransaction[\s\S]*INDEXER_CATCHUP_CHUNK_BLOCKS_META_KEY[\s\S]*throw error/,
  "a pre-commit budget failure must durably reduce the next range under the active lease",
);
assert.match(
  indexerSource,
  /isIndexerRpcResponseLimitError\(error\)[\s\S]*planIndexerResponseLimitRecovery\(end - start \+ 1n\)[\s\S]*runIndexerStorageTransaction\(getActiveIndexerLeaseOwnerToken\(\)[\s\S]*INDEXER_CATCHUP_CHUNK_BLOCKS_META_KEY[\s\S]*indexerRunStatus[\s\S]*throw new IndexerOperatorBlockedError/,
  "response limits must durably back off under lease and block explicitly at one block",
);
assert.match(
  ecosystemSource,
  /name: "lore-indexer"[\s\S]*stop_exit_codes: \[78\]/,
  "PM2 must not restart-loop the explicit operator-blocked exit",
);
assert.match(
  dataSyncHealthSource,
  /rpc_response_limit_single_block[\s\S]*runIsBlocked[\s\S]*degraded =[\s\S]*runIsBlocked[\s\S]*operator intervention is required/,
  "private data-sync health must surface the durable one-block operator block",
);
assert.match(
  indexerSource,
  /commitIndexerChunk\([\s\S]*writeDustSettlements[\s\S]*end === currentBlock[\s\S]*setMetaJson\(INDEXER_CATCHUP_CHUNK_BLOCKS_META_KEY, null\)/,
  "the final event/checkpoint/cursor commit must atomically clear adaptive catch-up state",
);
assert.match(
  indexerSource,
  /type ReconcileBlockCursor = \{[\s\S]*phase: "recent" \| "history"[\s\S]*getMetaJsonStrict<unknown>\(RECONCILE_BLOCK_CURSOR_META_KEY\)[\s\S]*scanReconcileEpochRanges[\s\S]*createIndexerMaintenanceRangeAttempt\([\s\S]*setReconcileBlockCursor/,
  "recent and full-history epoch reconcile must resume from a strict durable range cursor",
);
assert.match(
  indexerSource,
  /persistIndexerMaintenanceResponseLimit\([\s\S]*INDEXER_REPAIR_CHUNK_BLOCKS_META_KEY[\s\S]*INDEXER_RECONCILE_CHUNK_BLOCKS_META_KEY[\s\S]*planIndexerMaintenanceResponseLimitRecovery\([\s\S]*attempt\.span[\s\S]*setMetaJson\(key, recovery\.nextChunkBlocks\.toString\(\)\)[\s\S]*throw new IndexerOperatorBlockedError/,
  "repair and reconcile must share durable response-limit recovery under the active lease",
);
assert.match(
  indexerSource,
  /runRepairPass[\s\S]*getIndexerMaintenanceChunkBlocks\([\s\S]*"repair"[\s\S]*createIndexerMaintenanceRangeAttempt\([\s\S]*persistIndexerMaintenanceResponseLimit\("repair", attempt\)[\s\S]*setRepairCursorBlock/,
  "repair must consume the persisted span without advancing its cursor on a failed range",
);
assert.match(
  indexerSource,
  /scanReconcileEpochRanges[\s\S]*getIndexerMaintenanceChunkBlocks\([\s\S]*"reconcile"[\s\S]*createIndexerMaintenanceRangeAttempt\([\s\S]*persistIndexerMaintenanceResponseLimit\("reconcile", attempt\)[\s\S]*advanceIndexerMaintenanceRangeCursor/,
  "reconcile must consume the persisted span without advancing its cursor on a failed range",
);
assert.match(
  indexerSource,
  /completedTargetEpochs[\s\S]*reconcileRangesRemaining <= 0[\s\S]*selectReconcileResumeEpochCursor\([\s\S]*sequentialTargetEpochs: reconcilePlan\.sequentialTargetEpochs[\s\S]*setReconcileEpochCursor/,
  "epoch reconciliation must persist the first unprocessed sequential target when its range budget is exhausted",
);
assert.match(
  indexerSource,
  /async function runIndexerPass\(\)[\s\S]*createIndexerRpcWorkBudget\([\s\S]*maxRpcCalls: INDEXER_RUN_MAX_RPC_CALLS[\s\S]*maxLogs: INDEXER_RUN_MAX_LOGS[\s\S]*maxLogsPerResponse: INDEXER_RPC_MAX_LOGS_PER_RESPONSE[\s\S]*maxSplitNodes: INDEXER_RUN_MAX_SPLIT_NODES[\s\S]*maxElapsedMs: INDEXER_RUN_MAX_ELAPSED_MS[\s\S]*await runOnce\(budget\)[\s\S]*readAgreedHeadBlockNumber\(budget\)[\s\S]*runIndexedMaintenance\(target, budget\)/,
  "normal catch-up, repair, and reconcile must share one run-wide RPC/log/split/time budget",
);
assert.match(
  indexerSource,
  /fetchLogsRequestWithRetry[\s\S]*budget\.consumeRpcCall\(\)[\s\S]*fetchLogsRequestAdaptiveSplit[\s\S]*budget\.consumeSplitNode\(\)/,
  "every adaptive request and generic-error split must consume the shared run budget",
);
assert.match(
  indexerSource,
  /fetchLogsRequestWithRetry[\s\S]*isIndexerRpcResponseLimitError\(err\)\) throw err[\s\S]*fetchLogsByTopicsAdaptive[\s\S]*\[quorum split\]/,
  "response-limit failures must reject one provider before any bounded whole-quorum split",
);
assert.match(
  indexerSource,
  /readWithExactIndexerRpcAgreement<EpochState>\([\s\S]*budget[\s\S]*readCanonicalBlockHash\(blockNumber, budget\)/,
  "jackpot flags and canonical-log checks must consume the same run-wide budget",
);
assert.match(
  indexerSource,
  /if \(isIndexerRpcWorkBudgetError\(err\)\)[\s\S]*RPC work budget exhausted; releasing the lease[\s\S]*stopAndReleaseLease\(false\)[\s\S]*process\.exit\(1\)/,
  "budget exhaustion must unwind the watch pass and release the lease immediately",
);
assert.match(
  indexerSource,
  /Could not read jackpot flags for epoch \$\{epNum\}[\s\S]*continue;[\s\S]*epochsPatch\.set/,
  "jackpot RPC disagreement must defer the epoch instead of persisting default false flags",
);
assert.doesNotMatch(
  indexerSource,
  /EpochResolved:\$\{epNum\}:full[\s\S]*INDEXER_START_BLOCK,[\s\S]*recentFrom - 1n/,
  "epoch reconcile must not fall back to one chain-age-proportional full scan",
);
assert.doesNotMatch(
  indexerSource,
  /for \(let ep = 1; ep < currentEpochNumber; ep\+\+\)/,
  "epoch reconcile must not enumerate the full attacker-controlled currentEpoch range",
);

Promise.resolve()
  .then(testBoundedRpcAgreement)
  .then(testBoundedRpcFetch)
  .then(() => console.log("Indexer RPC authenticity and bounded-work tests passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
