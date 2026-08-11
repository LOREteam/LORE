import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";

const PROXY_SECRET = "api-recovery-test-proxy-secret-0123456789abcdef";
const TSX_CLI_PATH = resolve("node_modules/tsx/dist/cli.mjs");
const SCRIPT_PATH = fileURLToPath(import.meta.url);

type RpcRange = {
  fromBlock: string;
  toBlock: string;
};

function configureWorkerEnvironment() {
  Object.assign(process.env, { NODE_ENV: "development" });
  process.env.TRUST_PROXY_HEADERS = "1";
  process.env.TRUST_PROXY_SECRET = PROXY_SECRET;
  process.env.ALLOW_WEAK_RATE_LIMIT_IDENTITY = "0";
  process.env.KEEPER_RPC_URL = "https://rpc.playlore.invalid";
  process.env.INDEXER_START_BLOCK = "1";
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.WEB_REPLICA_COUNT;
}

function requestHeaders() {
  return new Headers({
    "user-agent": "lore-api-recovery-test",
    "accept-language": "en-US",
    "x-lore-proxy-secret": PROXY_SECRET,
    "x-real-ip": "203.0.113.70",
  });
}

function routeRequest(url: string) {
  return new NextRequest(url, { method: "GET", headers: requestHeaders() });
}

async function requestBodyText(input: RequestInfo | URL, init?: RequestInit) {
  if (typeof init?.body === "string") return init.body;
  if (input instanceof Request) return input.clone().text();
  return "";
}

function installRpcMock(headBlock = 2_000_000n) {
  const ranges: RpcRange[] = [];
  let active = 0;
  let maxActive = 0;
  let currentHeadBlock = headBlock;
  let blockNumberCalls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = JSON.parse(await requestBodyText(input, init)) as Record<string, unknown> | Array<Record<string, unknown>>;
    const requests = Array.isArray(raw) ? raw : [raw];
    const includesLogRequest = requests.some((request) => String(request.method ?? "") === "eth_getLogs");
    if (includesLogRequest) {
      active += 1;
      maxActive = Math.max(maxActive, active);
    }
    try {
      await new Promise<void>((resolveDone) => setImmediate(resolveDone));
      const responses = requests.map((request) => {
        const method = String(request.method ?? "");
        const params = Array.isArray(request.params) ? request.params : [];
        if (method === "eth_chainId") {
          return { jsonrpc: "2.0", id: request.id ?? null, result: "0xe705" };
        }
        if (method === "eth_blockNumber") {
          blockNumberCalls += 1;
          return { jsonrpc: "2.0", id: request.id ?? null, result: `0x${currentHeadBlock.toString(16)}` };
        }
        if (method === "eth_getBlockByNumber") {
          const requested = String(params[0] ?? "latest");
          const blockNumber = requested === "latest" ? currentHeadBlock : BigInt(requested);
          return {
            jsonrpc: "2.0",
            id: request.id ?? null,
            result: {
              number: `0x${blockNumber.toString(16)}`,
              hash: `0x${blockNumber.toString(16).padStart(64, "0")}`,
              timestamp: "0x1",
              transactions: [],
            },
          };
        }
        if (method === "eth_getLogs") {
          const filter = params[0] && typeof params[0] === "object"
            ? params[0] as Record<string, unknown>
            : {};
          ranges.push({
            fromBlock: String(filter.fromBlock ?? "0x0"),
            toBlock: String(filter.toBlock ?? "0x0"),
          });
          return { jsonrpc: "2.0", id: request.id ?? null, result: [] };
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
    } finally {
      if (includesLogRequest) active -= 1;
    }
  }) as typeof fetch;

  return {
    ranges,
    get active() {
      return active;
    },
    get maxActive() {
      return maxActive;
    },
    get blockNumberCalls() {
      return blockNumberCalls;
    },
    setHeadBlock(value: bigint) {
      currentHeadBlock = value;
    },
  };
}

async function runChatWorker() {
  const route = await import("../app/api/chat/messages/route");
  const statuses: number[] = [];
  for (let index = 0; index < 61; index += 1) {
    const response = await route.GET(routeRequest("https://playlore.xyz/api/chat/messages"));
    statuses.push(response.status);
    await response.arrayBuffer();
  }
  return {
    scenario: "chat",
    statuses,
  };
}

async function runRecentWinsWorker() {
  const rpc = installRpcMock();
  const route = await import("../app/api/recent-wins/route");
  const requests = Array.from(
    { length: 5 },
    () => route.GET(routeRequest("https://playlore.xyz/api/recent-wins")),
  );
  const firstResponses = await Promise.all(requests);
  const firstPayloads = await Promise.all(firstResponses.map((response) => response.json()));
  const firstRecoveryRanges = rpc.ranges.slice();
  const storage = await import("../server/storage");
  const partialSnapshotPersisted = storage.getMetaJson("snapshot:recent-wins:v2") !== null;
  const blockNumberCallsBeforeContinuation = rpc.blockNumberCalls;
  rpc.setHeadBlock(2_010_000n);

  const data = await import("../app/api/recent-wins/data");
  const continued = await data.buildRecentWinsPayload({ allowSlowRecovery: true });
  const continuationRanges = rpc.ranges.slice(firstRecoveryRanges.length);

  const remainingStatuses: number[] = [];
  for (let index = 0; index < 26; index += 1) {
    const response = await route.GET(routeRequest("https://playlore.xyz/api/recent-wins"));
    remainingStatuses.push(response.status);
    await response.arrayBuffer();
  }

  return {
    scenario: "recent-wins",
    firstStatuses: firstResponses.map((response) => response.status),
    firstPayloads,
    firstRecoveryRanges,
    partialSnapshotPersisted,
    blockNumberCallsBeforeContinuation,
    blockNumberCallsAfterContinuation: rpc.blockNumberCalls,
    continuedPayload: continued.payload,
    continuedSnapshotEligible: continued.durableSnapshotEligible,
    continuationRanges,
    remainingStatuses,
  };
}

async function runRecentWinsIndexedWorker() {
  const headBlock = 2_000_000n;
  installRpcMock(headBlock);
  const storage = await import("../server/storage");
  const txHash = `0x${"ab".repeat(32)}`;
  const user = "0x1111111111111111111111111111111111111111";
  storage.upsertRewardClaims([{
    id: `${txHash}_${user}_7`,
    epoch: "7",
    user,
    reward: "1",
    rewardNum: 1,
    txHash,
    blockNumber: headBlock.toString(),
  }]);
  storage.setMetaBigInt("lastIndexedBlock", headBlock);

  const route = await import("../app/api/recent-wins/route");
  const response = await route.GET(routeRequest("https://playlore.xyz/api/recent-wins"));
  const payload = await response.json();
  return {
    scenario: "recent-wins-indexed",
    status: response.status,
    payload,
    snapshotPersisted: storage.getMetaJson("snapshot:recent-wins:v2") !== null,
  };
}

async function runLiveStateWorker() {
  const rpc = installRpcMock();
  const { fetchEpochTileUserCountsFromChain } = await import("../app/api/live-state/shared");
  const originalNow = Date.now;
  try {
    let fakeNow = 0;
    Date.now = () => {
      fakeNow += 1_000;
      return fakeNow;
    };
    const first = fetchEpochTileUserCountsFromChain(1n, 1n, 1_000_000n);
    const second = fetchEpochTileUserCountsFromChain(1n, 1n, 1_000_000n);
    const samePromise = first === second;
    const deadlineResults = await Promise.all([first, second]);
    const deadlineCallCount = rpc.ranges.length;

    Date.now = () => 0;
    const boundedResult = await fetchEpochTileUserCountsFromChain(2n, 1n, 1_000_000n);
    const boundedRanges = rpc.ranges.slice(deadlineCallCount);
    await new Promise<void>((resolveDone) => setImmediate(resolveDone));

    return {
      scenario: "live-state",
      samePromise,
      deadlineResults,
      deadlineCallCount,
      boundedResult,
      boundedRanges,
      activeAfterSettlement: rpc.active,
      maxActive: rpc.maxActive,
    };
  } finally {
    Date.now = originalNow;
  }
}

function parseWorkerOutput(stdout: string) {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  assert.ok(lines.length > 0, "worker produced no output");
  return JSON.parse(lines.at(-1) as string) as Record<string, unknown>;
}

function runWorker(tempRoot: string, mode: string) {
  const result = spawnSync(process.execPath, [TSX_CLI_PATH, SCRIPT_PATH, "--worker", mode], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LORE_DB_PATH: join(tempRoot, `${mode}.sqlite`),
    },
    encoding: "utf8",
    timeout: 45_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    `${mode} worker failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return parseWorkerOutput(result.stdout);
}

function parseBlock(value: unknown) {
  return BigInt(String(value));
}

function assertNoStoreRateLimitResult(result: Record<string, unknown>, label: string) {
  const statuses = result.statuses as number[];
  assert.equal(statuses.length, 61, `${label} request count`);
  assert.ok(statuses.slice(0, 60).every((status) => status === 200), `${label} admitted responses`);
  assert.equal(statuses[60], 429, `${label} cache hits must still consume admission`);
}

function validateRecentWins(result: Record<string, unknown>) {
  assert.deepEqual(result.firstStatuses, [200, 200, 200, 200, 200]);
  const firstRanges = result.firstRecoveryRanges as RpcRange[];
  assert.equal(firstRanges.length, 10, "concurrent cold requests must share one bounded recovery");
  const scannedBlocks = firstRanges.reduce(
    (total, range) => total + parseBlock(range.toBlock) - parseBlock(range.fromBlock) + 1n,
    0n,
  );
  assert.equal(scannedBlocks, 100_000n, "cold recovery block budget");

  const payloads = result.firstPayloads as Array<Record<string, unknown>>;
  const recovery = payloads[0]?.recovery as Record<string, unknown>;
  assert.equal(recovery.status, "partial");
  assert.equal(recovery.direction, "backward");
  assert.equal(recovery.continuationBlock, "1900000");
  assert.ok(payloads.every((payload) => JSON.stringify(payload) === JSON.stringify(payloads[0])));
  assert.equal(
    result.partialSnapshotPersisted,
    false,
    "partial chain recovery must remain process-cache-only instead of entering the durable snapshot",
  );

  const continuationRanges = result.continuationRanges as RpcRange[];
  assert.equal(continuationRanges.length, 10, "continuation must retain the same bounded budget");
  assert.equal(
    parseBlock(continuationRanges[0].toBlock),
    1_900_000n,
    "continuation must resume below the first scan even after the finalized head advances",
  );
  assert.equal(
    result.blockNumberCallsAfterContinuation,
    result.blockNumberCallsBeforeContinuation,
    "an active continuation must retain its pinned snapshot instead of rebasing to a moving head",
  );
  assert.equal(result.continuedSnapshotEligible, false);
  const continuedPayload = result.continuedPayload as Record<string, unknown>;
  const continuedRecovery = continuedPayload.recovery as Record<string, unknown>;
  assert.equal(continuedRecovery.continuationBlock, "1800000");

  const remainingStatuses = result.remainingStatuses as number[];
  assert.equal(remainingStatuses.length, 26);
  assert.ok(remainingStatuses.slice(0, 25).every((status) => status === 200));
  assert.equal(remainingStatuses[25], 429, "recent-wins cache hits must still consume admission");
}

function validateRecentWinsIndexed(result: Record<string, unknown>) {
  assert.equal(result.status, 200);
  const payload = result.payload as Record<string, unknown>;
  assert.equal((payload.wins as unknown[]).length, 1);
  assert.equal(
    result.snapshotPersisted,
    true,
    "normalized indexed data must retain the durable render-snapshot fast path",
  );
}

function validateLiveState(result: Record<string, unknown>) {
  assert.equal(result.samePromise, true, "identical tile-user recovery must share the underlying promise");
  assert.deepEqual(result.deadlineResults, [null, null]);
  assert.ok(Number(result.deadlineCallCount) <= 2, "cooperative deadline must stop new RPC chunks");
  assert.equal(result.boundedResult, null);
  const ranges = result.boundedRanges as RpcRange[];
  assert.equal(ranges.length, 8, "tile-user recovery RPC call budget");
  const queriedBlockWindows = ranges.reduce(
    (total, range) => total + parseBlock(range.toBlock) - parseBlock(range.fromBlock) + 1n,
    0n,
  );
  assert.equal(queriedBlockWindows, 80_000n, "tile-user recovery block-query budget");
  assert.equal(result.activeAfterSettlement, 0, "settled recovery must leave no orphan RPC request");
  assert.equal(result.maxActive, 1, "single-flight recovery must not overlap RPC requests");
}

function assertSafeTemporaryRoot(tempRoot: string) {
  const resolvedRoot = resolve(tempRoot);
  const resolvedSystemTemp = resolve(tmpdir());
  assert.equal(dirname(resolvedRoot), resolvedSystemTemp);
  assert.ok(resolvedRoot.startsWith(`${resolvedSystemTemp}${sep}`));
  assert.ok(basename(resolvedRoot).startsWith("lore-api-recovery-"));
}

async function main() {
  if (process.argv[2] === "--worker") {
    configureWorkerEnvironment();
    const mode = process.argv[3];
    const result = mode === "chat"
      ? await runChatWorker()
      : mode === "recent-wins"
        ? await runRecentWinsWorker()
        : mode === "recent-wins-indexed"
          ? await runRecentWinsIndexedWorker()
        : mode === "live-state"
          ? await runLiveStateWorker()
          : null;
    if (!result) throw new Error(`unknown worker mode: ${mode ?? "<missing>"}`);
    await new Promise<void>((resolveWrite, rejectWrite) => {
      process.stdout.write(`${JSON.stringify(result)}\n`, (error) => {
        if (error) rejectWrite(error);
        else resolveWrite();
      });
    });
    process.exit(0);
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "lore-api-recovery-"));
  try {
    assertNoStoreRateLimitResult(runWorker(tempRoot, "chat"), "chat");
    validateRecentWins(runWorker(tempRoot, "recent-wins"));
    validateRecentWinsIndexed(runWorker(tempRoot, "recent-wins-indexed"));
    validateLiveState(runWorker(tempRoot, "live-state"));
    console.log("API recovery/admission tests passed: cache admission, bounded continuation, and non-orphaned live-state scans");
  } finally {
    assertSafeTemporaryRoot(tempRoot);
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
