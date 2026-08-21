import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
} from "viem";
import {
  GAME_ABI,
  GAME_EVENTS_ABI,
} from "../config/generated/lineaOreV10Abi";

const testDir = mkdtempSync(join(tmpdir(), "lore-api-recovery-provenance-"));
process.env.LORE_DB_PATH = join(testDir, "recovery.sqlite");
process.env.NEXT_PUBLIC_LINEA_NETWORK = "sepolia";
process.env.KEEPER_RPC_URL = "https://single-untrusted-rpc.invalid";
process.env.INDEXER_START_BLOCK = "1";
process.env.INDEXER_FINALITY_BLOCKS = "12";

async function requestBodyText(input: RequestInfo | URL, init?: RequestInit) {
  if (typeof init?.body === "string") return init.body;
  if (input instanceof Request) return input.clone().text();
  return "";
}

function toRpcQuantity(value: bigint) {
  return `0x${value.toString(16)}`;
}

function requestedRangeContains(filter: Record<string, unknown>, blockNumber: bigint) {
  const fromBlock = typeof filter.fromBlock === "string" ? BigInt(filter.fromBlock) : 0n;
  const toBlock = typeof filter.toBlock === "string" ? BigInt(filter.toBlock) : blockNumber;
  return fromBlock <= blockNumber && blockNumber <= toBlock;
}

function installSingleRpcFabricationMock(input: {
  contractAddress: `0x${string}`;
  targetBlock: bigint;
  headBlock: bigint;
  blockHash: `0x${string}`;
  rewardLog: Record<string, unknown>;
  jackpotLog: Record<string, unknown>;
  rewardTopic: `0x${string}`;
  jackpotTopic: `0x${string}`;
}) {
  let jackpotInfoCalls = 0;
  const successfulOrigins = new Set<string>();
  let logRequestCount = 0;
  let rewardLogsServed = 0;
  let jackpotLogsServed = 0;

  globalThis.fetch = (async (requestInput: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = requestInput instanceof Request ? requestInput.url : String(requestInput);
    const requestOrigin = new URL(requestUrl).origin;
    if (requestOrigin !== "https://single-untrusted-rpc.invalid") {
      return new Response("mocked secondary origin unavailable", { status: 503 });
    }
    successfulOrigins.add(requestOrigin);
    const raw = JSON.parse(await requestBodyText(requestInput, init)) as
      | Record<string, unknown>
      | Array<Record<string, unknown>>;
    const requests = Array.isArray(raw) ? raw : [raw];
    const responses = requests.map((request) => {
      const method = String(request.method ?? "");
      const params = Array.isArray(request.params) ? request.params : [];
      if (method === "eth_chainId") {
        return { jsonrpc: "2.0", id: request.id ?? null, result: "0xe705" };
      }
      if (method === "eth_blockNumber") {
        return { jsonrpc: "2.0", id: request.id ?? null, result: toRpcQuantity(input.headBlock) };
      }
      if (method === "eth_getBlockByNumber") {
        const requested = String(params[0] ?? "latest");
        const blockNumber = requested === "latest" ? input.headBlock : BigInt(requested);
        return {
          jsonrpc: "2.0",
          id: request.id ?? null,
          result: {
            number: toRpcQuantity(blockNumber),
            hash: blockNumber === input.targetBlock
              ? input.blockHash
              : `0x${blockNumber.toString(16).padStart(64, "0")}`,
            timestamp: "0x1",
            transactions: [],
          },
        };
      }
      if (method === "eth_getLogs") {
        const filter = params[0] && typeof params[0] === "object"
          ? params[0] as Record<string, unknown>
          : {};
        logRequestCount += 1;
        const topics = JSON.stringify(filter.topics ?? []).toLowerCase();
        const addressMatches = String(filter.address ?? "").toLowerCase() === input.contractAddress.toLowerCase();
        const topiclessRawRequest = topics === "[]";
        const isRewardRequest = topics.includes(input.rewardTopic.toLowerCase()) ||
          (topiclessRawRequest && logRequestCount === 1);
        const isJackpotRequest = topics.includes(input.jackpotTopic.toLowerCase()) ||
          (topiclessRawRequest && logRequestCount > 1);
        const result = addressMatches && requestedRangeContains(filter, input.targetBlock)
          ? isRewardRequest
            ? [input.rewardLog]
            : isJackpotRequest
              ? [input.jackpotLog]
              : []
          : [];
        if (result[0] === input.rewardLog) rewardLogsServed += 1;
        if (result[0] === input.jackpotLog) jackpotLogsServed += 1;
        return { jsonrpc: "2.0", id: request.id ?? null, result };
      }
      if (method === "eth_call") {
        jackpotInfoCalls += 1;
        return {
          jsonrpc: "2.0",
          id: request.id ?? null,
          result: encodeFunctionResult({
            abi: GAME_ABI,
            functionName: "getJackpotInfo",
            result: [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n],
          }),
        };
      }
      return {
        jsonrpc: "2.0",
        id: request.id ?? null,
        error: { code: -32601, message: `unimplemented test RPC method ${method}` },
      };
    });
    return new Response(JSON.stringify(Array.isArray(raw) ? responses : responses[0]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  return {
    get jackpotInfoCalls() {
      return jackpotInfoCalls;
    },
    get successfulOrigins() {
      return [...successfulOrigins];
    },
    get rewardLogsServed() {
      return rewardLogsServed;
    },
    get jackpotLogsServed() {
      return jackpotLogsServed;
    },
  };
}

async function main() {
  const originalFetch = globalThis.fetch;
  const {
    JACKPOT_RECOVERY_MAX_LOG_BLOCKS,
    JACKPOT_RECOVERY_MAX_LOG_RANGE_BLOCKS,
    JACKPOT_RECOVERY_MAX_LOGS,
    JACKPOT_RECOVERY_MAX_RPC_CALLS,
    canDurablyPersistRecoveredBlock,
    createJackpotRecoveryBudget,
    deriveDurableRecoveryCheckpoint,
    getCanonicalRecoveryLogIdentity,
    isRecoverySnapshotDurable,
    planJackpotRecoveryLogRange,
    readJackpotPayload,
    recordJackpotRecoveryLogCount,
    reserveJackpotRecoveryRpcCall,
  } = await import("../app/api/_lib/jackpotsService");
  const { CONTRACT_ADDRESS, CONTRACT_DEPLOY_BLOCK } = await import("../app/api/_lib/dataBridge");
  const { db } = await import("../server/db");
  const storage = await import("../server/storage");

  const targetBlock = CONTRACT_DEPLOY_BLOCK + 100n;
  const cursorBlock = targetBlock - 10n;
  const checkpointHash = `0x${"11".repeat(32)}`;
  const jackpotTxHash = `0x${"aa".repeat(32)}`;
  const jackpotBlockHash = `0x${"bb".repeat(32)}`;

  try {
    const canonicalJackpotIdentity = {
      removed: false,
      address: CONTRACT_ADDRESS,
      transactionHash: jackpotTxHash,
      blockHash: jackpotBlockHash,
      blockNumber: targetBlock,
      logIndex: 3,
    };
    assert.deepEqual(
      getCanonicalRecoveryLogIdentity(canonicalJackpotIdentity),
      {
        address: CONTRACT_ADDRESS.toLowerCase(),
        txHash: jackpotTxHash,
        blockHash: jackpotBlockHash,
        blockNumber: targetBlock,
        logIndex: "3",
      },
      "a canonical mined jackpot log must retain its complete recovery identity",
    );
    for (const malformed of [
      { ...canonicalJackpotIdentity, removed: true },
      { ...canonicalJackpotIdentity, removed: undefined },
      { ...canonicalJackpotIdentity, address: "0x2222222222222222222222222222222222222222" },
      { ...canonicalJackpotIdentity, transactionHash: "" },
      { ...canonicalJackpotIdentity, blockHash: "" },
      { ...canonicalJackpotIdentity, blockNumber: CONTRACT_DEPLOY_BLOCK - 1n },
      { ...canonicalJackpotIdentity, blockNumber: null },
      { ...canonicalJackpotIdentity, logIndex: null },
      { ...canonicalJackpotIdentity, logIndex: -1 },
    ]) {
      assert.equal(
        getCanonicalRecoveryLogIdentity(malformed),
        null,
        "removed or malformed recovery log identity must fail closed before decoding",
      );
    }

    const budgetStartedAt = 1_000;
    const hugeTargetBlock = CONTRACT_DEPLOY_BLOCK + JACKPOT_RECOVERY_MAX_LOG_BLOCKS * 1_000n;
    const boundedRange = planJackpotRecoveryLogRange({
      budget: createJackpotRecoveryBudget(budgetStartedAt),
      fromBlock: CONTRACT_DEPLOY_BLOCK,
      toBlock: hugeTargetBlock,
      nowMs: budgetStartedAt,
    });
    assert.ok(boundedRange);
    assert.equal(
      boundedRange.toBlock - boundedRange.fromBlock + 1n,
      JACKPOT_RECOVERY_MAX_LOG_RANGE_BLOCKS,
      "an adversarial chain-age span must be reduced to one newest bounded window",
    );
    assert.equal(boundedRange.toBlock, hugeTargetBlock);
    assert.equal(boundedRange.complete, false);
    assert.equal(
      boundedRange.fromBlock === CONTRACT_DEPLOY_BLOCK,
      false,
      "a truncated bootstrap window must not masquerade as complete history",
    );
    const cacheOnlyBudget = createJackpotRecoveryBudget(budgetStartedAt);
    planJackpotRecoveryLogRange({
      budget: cacheOnlyBudget,
      fromBlock: CONTRACT_DEPLOY_BLOCK,
      toBlock: hugeTargetBlock,
      nowMs: budgetStartedAt,
    });
    assert.equal(
      cacheOnlyBudget.cacheOnly,
      true,
      "a truncated range must downgrade recovered rows to response-cache-only state",
    );

    const aggregateBudget = createJackpotRecoveryBudget(budgetStartedAt);
    for (
      let consumed = 0n;
      consumed < JACKPOT_RECOVERY_MAX_LOG_BLOCKS;
      consumed += JACKPOT_RECOVERY_MAX_LOG_RANGE_BLOCKS
    ) {
      reserveJackpotRecoveryRpcCall(aggregateBudget, {
        fromBlock: CONTRACT_DEPLOY_BLOCK + consumed,
        toBlock: CONTRACT_DEPLOY_BLOCK + consumed + JACKPOT_RECOVERY_MAX_LOG_RANGE_BLOCKS - 1n,
        nowMs: budgetStartedAt,
      });
    }
    assert.equal(aggregateBudget.remainingLogBlocks, 0n);
    assert.throws(
      () => planJackpotRecoveryLogRange({
        budget: aggregateBudget,
        fromBlock: CONTRACT_DEPLOY_BLOCK,
        toBlock: hugeTargetBlock,
        nowMs: budgetStartedAt,
      }),
      /block budget exhausted/i,
      "one run must not restart an unbounded scan after consuming its aggregate block budget",
    );

    const callBudget = createJackpotRecoveryBudget(budgetStartedAt);
    for (let call = 0; call < JACKPOT_RECOVERY_MAX_RPC_CALLS; call += 1) {
      reserveJackpotRecoveryRpcCall(callBudget, { nowMs: budgetStartedAt });
    }
    assert.throws(
      () => reserveJackpotRecoveryRpcCall(callBudget, { nowMs: budgetStartedAt }),
      /RPC call budget exhausted/i,
    );

    const logBudget = createJackpotRecoveryBudget(budgetStartedAt);
    assert.throws(
      () => recordJackpotRecoveryLogCount(logBudget, JACKPOT_RECOVERY_MAX_LOGS + 1),
      /log result budget exhausted/i,
    );
    const expiredBudget = createJackpotRecoveryBudget(budgetStartedAt);
    assert.throws(
      () => planJackpotRecoveryLogRange({
        budget: expiredBudget,
        fromBlock: CONTRACT_DEPLOY_BLOCK,
        toBlock: CONTRACT_DEPLOY_BLOCK,
        nowMs: expiredBudget.deadlineAtMs,
      }),
      /time budget exhausted/i,
    );

    assert.equal(
      deriveDurableRecoveryCheckpoint({
        finalityBlocks: 0n,
        targetBlock,
        lastIndexedBlock: targetBlock,
        checkpointBlock: targetBlock,
        checkpointHash,
        observedCheckpointHash: checkpointHash,
      }),
      null,
      "latest-head recovery must remain cache-only even when it happens to match the cursor",
    );
    assert.deepEqual(
      deriveDurableRecoveryCheckpoint({
        finalityBlocks: 12n,
        targetBlock,
        lastIndexedBlock: cursorBlock,
        checkpointBlock: cursorBlock,
        checkpointHash,
        observedCheckpointHash: checkpointHash.toUpperCase(),
      }),
      { blockNumber: cursorBlock, blockHash: checkpointHash },
      "a finalized recovery may persist only through the matching canonical cursor checkpoint",
    );
    assert.equal(
      deriveDurableRecoveryCheckpoint({
        finalityBlocks: 12n,
        targetBlock,
        lastIndexedBlock: cursorBlock,
        checkpointBlock: cursorBlock,
        checkpointHash,
        observedCheckpointHash: `0x${"22".repeat(32)}`,
      }),
      null,
      "a head-only reorg or RPC hash disagreement must remove durable authority",
    );

    const laggingContext = {
      blockNumber: targetBlock,
      blockHash: `0x${"33".repeat(32)}` as `0x${string}`,
      finalityBlocks: 12n,
      durableThroughBlock: cursorBlock,
      durableCheckpointHash: checkpointHash as `0x${string}`,
    };
    assert.equal(canDurablyPersistRecoveredBlock(laggingContext, cursorBlock), true);
    assert.equal(canDurablyPersistRecoveredBlock(laggingContext, cursorBlock + 1n), false);
    assert.equal(isRecoverySnapshotDurable(laggingContext), false);
    assert.equal(
      isRecoverySnapshotDurable({ ...laggingContext, durableThroughBlock: targetBlock }),
      true,
      "epoch state is durable only when its explicit finalized snapshot is the verified checkpoint",
    );

    const leaseOwnerToken = randomUUID();
    assert.equal(storage.acquireIndexerLease(leaseOwnerToken, 60_000), true);
    try {
      storage.rollbackIndexerToBlock(CONTRACT_DEPLOY_BLOCK, null, leaseOwnerToken);
      storage.commitIndexerChunk({
        leaseOwnerToken,
        expectedPreviousBlock: CONTRACT_DEPLOY_BLOCK,
        expectedPreviousBlockHash: null,
        blockNumber: targetBlock,
        blockHash: checkpointHash,
      }, () => {});
    } finally {
      storage.releaseIndexerLease(leaseOwnerToken);
    }

    const forgedUser = "0x1111111111111111111111111111111111111111" as const;
    const forgedEpoch = 7n;
    const forgedRewardTxHash = `0x${"44".repeat(32)}` as const;
    const forgedJackpotTxHash = `0x${"55".repeat(32)}` as const;
    const rewardTopics = encodeEventTopics({
      abi: GAME_EVENTS_ABI,
      eventName: "RewardClaimed",
      args: { epoch: forgedEpoch, user: forgedUser },
    });
    const jackpotTopics = encodeEventTopics({
      abi: GAME_EVENTS_ABI,
      eventName: "DailyJackpotAwarded",
      args: { epoch: forgedEpoch },
    });
    const rewardTopic = rewardTopics[0];
    const jackpotTopic = jackpotTopics[0];
    assert.ok(rewardTopic && jackpotTopic);
    const rpcMock = installSingleRpcFabricationMock({
      contractAddress: CONTRACT_ADDRESS,
      targetBlock,
      headBlock: targetBlock + 12n,
      blockHash: checkpointHash as `0x${string}`,
      rewardTopic,
      jackpotTopic,
      rewardLog: {
        address: CONTRACT_ADDRESS,
        blockHash: checkpointHash,
        blockNumber: toRpcQuantity(targetBlock),
        data: encodeAbiParameters([{ type: "uint256" }], [1n]),
        logIndex: "0x0",
        removed: false,
        topics: rewardTopics,
        transactionHash: forgedRewardTxHash,
        transactionIndex: "0x0",
      },
      jackpotLog: {
        address: CONTRACT_ADDRESS,
        blockHash: checkpointHash,
        blockNumber: toRpcQuantity(targetBlock),
        data: encodeAbiParameters([{ type: "uint256" }], [1n]),
        logIndex: "0x1",
        removed: false,
        topics: jackpotTopics,
        transactionHash: forgedJackpotTxHash,
        transactionIndex: "0x0",
      },
    });

    const recentWins = await import("../app/api/recent-wins/data");
    const recoveredRecentWins = await recentWins.buildRecentWinsPayload({ allowSlowRecovery: true });
    assert.equal(rpcMock.rewardLogsServed > 0, true, "the single RPC must serve the forged claim");
    assert.equal(
      recoveredRecentWins.payload.wins.some((row) => row.txHash === forgedRewardTxHash),
      true,
      "a syntactically valid single-RPC recovery may be served only from process cache",
    );
    assert.equal(
      storage.getRecentRewardClaims(10).length,
      0,
      "an internally consistent forged claim from one RPC must never become a durable row",
    );

    await readJackpotPayload();
    let recoveredJackpotVisible = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      await new Promise<void>((resolveDone) => setImmediate(resolveDone));
      const cached = await readJackpotPayload();
      if (cached.payload.jackpots.some((row) => row.txHash === forgedJackpotTxHash)) {
        recoveredJackpotVisible = true;
        break;
      }
    }
    assert.equal(rpcMock.jackpotInfoCalls > 0, true, "jackpot background recovery must settle");
    assert.equal(rpcMock.jackpotLogsServed > 0, true, "the single RPC must serve the forged jackpot");
    assert.equal(
      recoveredJackpotVisible,
      true,
      "the forged jackpot fixture must reach only the bounded response cache",
    );
    assert.equal(
      storage.getRecentJackpots(10).length,
      0,
      "an internally consistent forged jackpot from one RPC must never become a durable row",
    );
    assert.deepEqual(
      rpcMock.successfulOrigins,
      ["https://single-untrusted-rpc.invalid"],
      "only one unquorated RPC origin may supply the forged recovery data",
    );

    const jackpotSource = readFileSync("app/api/_lib/jackpotsService.ts", "utf8");
    const epochsSource = readFileSync("app/api/epochs/route.ts", "utf8");
    const recentWinsSource = readFileSync("app/api/recent-wins/data.ts", "utf8");
    const rewardSource = readFileSync("app/api/_lib/rewardSummary.ts", "utf8");

    assert.match(
      jackpotSource,
      /getIndexerFinalityTargetBlock[\s\S]*blockNumber: context\.blockNumber/,
      "jackpot recovery must stop at one explicit finalized snapshot",
    );
    assert.match(
      jackpotSource,
      /fetchJackpotEventByEpoch[\s\S]*toBlock: context\.blockNumber[\s\S]*blockNumber: context\.blockNumber/,
      "jackpot event and state recovery must use the same explicit snapshot",
    );
    assert.match(
      jackpotSource,
      /createJackpotRecoveryBudget\(\)[\s\S]*loadFinalizedRecoveryContext\(recoveryBudget\)[\s\S]*buildOnchainJackpots\([\s\S]*recoveryBudget[\s\S]*reconcileLatestJackpots\([\s\S]*recoveryBudget/,
      "the finalized context, range recovery, and reconciliation must share one aggregate run budget",
    );
    assert.doesNotMatch(
      jackpotSource,
      /patchStorage\(|upsertJackpot/,
      "public jackpot recovery must leave all durable writes to the indexer",
    );
    assert.match(
      jackpotSource,
      /getCanonicalRecoveryLogIdentity\(log\)[\s\S]*if \(!identity\) return null[\s\S]*txHash: identity\.txHash,[\s\S]*blockNumber: identity\.blockNumber\.toString\(\),[\s\S]*eventId: `\$\{identity\.txHash\}:\$\{identity\.logIndex\}`,[\s\S]*logIndex: identity\.logIndex,/,
      "jackpot decoding must reject logs without canonical mined identity before cache admission",
    );
    assert.match(
      epochsSource,
      /multicall\([\s\S]*blockNumber: context\.blockNumber[\s\S]*readContract\([\s\S]*blockNumber: context\.blockNumber[\s\S]*resolvedBlock: context\.blockNumber\.toString\(\)/,
      "epoch recovery and fallback reads must be block-pinned and carry resolvedBlock provenance",
    );
    assert.doesNotMatch(
      epochsSource,
      /patchStorage\("gamedata\/epochs"/,
      "public epoch recovery must remain cache-only and leave durable writes to the indexer",
    );
    assert.match(
      rewardSource,
      /multicall\([\s\S]*blockNumber: recoveryContext\.blockNumber[\s\S]*isRecoveryContextCurrent\(recoveryContext\)/,
      "reward recovery must pin state and recheck its finalized context",
    );
    assert.doesNotMatch(
      rewardSource,
      /upsertEpochMap/,
      "public reward recovery must leave durable epoch writes to the indexer",
    );
    assert.match(
      recentWinsSource,
      /function mapClaimLog\([\s\S]*getCanonicalRecoveryLogIdentity\(log\)[\s\S]*if \(!identity\) return null[\s\S]*decodeEventLog[\s\S]*txHash: identity\.txHash[\s\S]*blockNumber: identity\.blockNumber\.toString\(\)/,
      "recent-wins decoding must reject malformed or wrong-address log identities before cache admission",
    );
    assert.match(
      recentWinsSource,
      /async function fetchOnchainClaims\([\s\S]*const currentBlock = context\.blockNumber[\s\S]*isRecoveryContextCurrent\(context\)/,
      "recent-wins recovery must pin its scan and recheck the finalized snapshot",
    );
    assert.doesNotMatch(
      recentWinsSource,
      /upsertRewardClaims/,
      "public recent-wins recovery must leave durable claim writes to the indexer",
    );
    assert.match(
      recentWinsSource,
      /loadRecentWinsRecoveryContext\(\)[\s\S]*shouldRecoverRecentWins\(storedClaims, recoveryContext\)[\s\S]*fetchOnchainClaims\(storedClaims, recoveryContext\)/,
      "recent-wins recovery admission and scan must share one stable finalized context",
    );
    assert.doesNotMatch(
      recentWinsSource,
      /RECENT_WINS_RECOVERY_CURSOR_META_KEY|setMetaJson\([^\n]*recovery:recent-wins/,
      "partial recent-wins scan cursors must remain snapshot-bound process cache, not unproven durable state",
    );
  } finally {
    globalThis.fetch = originalFetch;
    (db as unknown as { close(): void }).close();
    rmSync(testDir, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    console.log("API finalized recovery provenance tests passed.");
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
