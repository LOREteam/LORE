import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  awaitExactRpcAgreement,
  createBoundedBackwardBlockScanPlan,
  createBoundedIndexerRpcFetch,
  createBoundedIndexerRunPlan,
  createIndexerRpcWorkBudget,
  createReconcileEpochPlan,
  getUniqueRpcUrls,
  INDEXER_RPC_MAX_LOG_DATA_BYTES,
  parsePlausibleCurrentEpoch,
  parseIndexerCatchupChunkBlocks,
  reduceIndexerCatchupChunkBlocks,
  requireIndependentRpcUrls,
  requireAgreedRpcLogSets,
  requireAgreedRpcValues,
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

const indexerSource = readFileSync("scripts/indexer.ts", "utf8");
assert.match(
  indexerSource,
  /awaitExactRpcAgreement\([\s\S]*independentRpcClients\.map[\s\S]*validateRpcLogSet[\s\S]*agreementFingerprint/,
  "every indexed log fetch must validate and require exact independent-provider agreement",
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
  /commitIndexerChunk\([\s\S]*writeDustSettlements[\s\S]*end === currentBlock[\s\S]*setMetaJson\(INDEXER_CATCHUP_CHUNK_BLOCKS_META_KEY, null\)/,
  "the final event/checkpoint/cursor commit must atomically clear adaptive catch-up state",
);
assert.match(
  indexerSource,
  /getMetaJsonStrict<unknown>\(RECONCILE_BLOCK_CURSOR_META_KEY\)[\s\S]*createBoundedBackwardBlockScanPlan\([\s\S]*fullScanChunksRemaining -= fullScanPlan\.chunkCount[\s\S]*setReconcileBlockCursor/,
  "full-history epoch reconcile must resume from a strict durable cursor within one fixed chunk budget",
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
