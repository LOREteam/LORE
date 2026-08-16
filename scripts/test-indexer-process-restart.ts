import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters, encodeEventTopics, toHex } from "viem";

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = dirname(dirname(THIS_FILE));
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");
const INDEXER_ENTRYPOINT = join(REPO_ROOT, "scripts", "indexer.ts");
const CONTRACT_ADDRESS = `0x${"ab".repeat(20)}` as const;
const USER_ADDRESS = `0x${"cd".repeat(20)}` as const;
const STORAGE_SCOPE = `sepolia:${CONTRACT_ADDRESS}`;
const DEPLOY_BLOCK = 100n;
const HEAD_BLOCK = 10_105n;
const FINALITY_BLOCKS = 2n;
const FINALIZED_TARGET = HEAD_BLOCK - FINALITY_BLOCKS;
const FIRST_CHUNK_END = 5_100n;
const FIRST_EVENT_BLOCK = 1_000n;
const FORK_EVENT_BLOCK = 6_000n;
const RESUMED_EVENT_BLOCK = 6_001n;
const UNFINALIZED_EVENT_BLOCK = FINALIZED_TARGET + 1n;
const FIRST_TX_HASH = hashHex("first-finalized-event");
const FORK_TX_HASH = hashHex("fork-event");
const RESUMED_TX_HASH = hashHex("resumed-finalized-event");
const UNFINALIZED_TX_HASH = hashHex("unfinalized-event");
const ZERO_HASH = `0x${"00".repeat(32)}`;
const ZERO_ADDRESS = `0x${"00".repeat(20)}`;
const ZERO_BLOOM = `0x${"00".repeat(256)}`;
const MAX_CHILD_OUTPUT_BYTES = 256 * 1024;

const BET_PLACED_EVENT = {
  anonymous: false,
  inputs: [
    { indexed: true, name: "epoch", type: "uint256" },
    { indexed: true, name: "user", type: "address" },
    { indexed: true, name: "tileId", type: "uint256" },
    { indexed: false, name: "amount", type: "uint256" },
  ],
  name: "BetPlaced",
  type: "event",
} as const;

type RpcPhase = "crash" | "fork" | "resume";

type RpcRange = {
  phase: RpcPhase;
  provider: string;
  fromBlock: bigint;
  toBlock: bigint;
};

type RpcState = {
  phase: RpcPhase;
  ranges: RpcRange[];
  callsByProvider: Map<string, number>;
};

type JsonRpcRequest = {
  id?: string | number | null;
  jsonrpc?: string;
  method?: string;
  params?: unknown[];
};

type ChildRun = {
  code: number | null;
  signal: NodeJS.Signals | null;
  markerSeen: boolean;
  timedOut: boolean;
  output: string;
};

type IndexerDbState = {
  cursor: string | null;
  checkpoints: Array<{ blockNumber: number; blockHash: string }>;
  bets: Array<{ txHash: string; blockNumber: number }>;
  runStatus: Record<string, unknown> | null;
};

function hashHex(label: string) {
  return `0x${createHash("sha256").update(label).digest("hex")}` as `0x${string}`;
}

function canonicalBlockHash(blockNumber: bigint) {
  return hashHex(`canonical-block:${blockNumber}`);
}

function parseBlockTag(value: unknown) {
  if (value === "latest" || value === "safe" || value === "finalized") return HEAD_BLOCK;
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new Error(`invalid block tag: ${String(value)}`);
  }
  return BigInt(value);
}

function makeBetLog(options: {
  blockNumber: bigint;
  txHash: `0x${string}`;
  epoch: bigint;
  tileId: bigint;
  canonical: boolean;
}) {
  const topics = encodeEventTopics({
    abi: [BET_PLACED_EVENT],
    eventName: "BetPlaced",
    args: {
      epoch: options.epoch,
      user: USER_ADDRESS,
      tileId: options.tileId,
    },
  });
  return {
    address: CONTRACT_ADDRESS,
    blockHash: options.canonical
      ? canonicalBlockHash(options.blockNumber)
      : hashHex(`fork-block:${options.blockNumber}`),
    blockNumber: toHex(options.blockNumber),
    data: encodeAbiParameters([{ type: "uint256" }], [10n ** 18n]),
    logIndex: "0x0",
    removed: false,
    topics,
    transactionHash: options.txHash,
    transactionIndex: "0x0",
  };
}

function phaseLogs(phase: RpcPhase) {
  const logs = [
    makeBetLog({
      blockNumber: FIRST_EVENT_BLOCK,
      txHash: FIRST_TX_HASH,
      epoch: 1n,
      tileId: 1n,
      canonical: true,
    }),
    makeBetLog({
      blockNumber: UNFINALIZED_EVENT_BLOCK,
      txHash: UNFINALIZED_TX_HASH,
      epoch: 4n,
      tileId: 4n,
      canonical: true,
    }),
  ];
  if (phase === "fork") {
    logs.push(makeBetLog({
      blockNumber: FORK_EVENT_BLOCK,
      txHash: FORK_TX_HASH,
      epoch: 2n,
      tileId: 2n,
      canonical: false,
    }));
  }
  if (phase === "resume") {
    logs.push(makeBetLog({
      blockNumber: RESUMED_EVENT_BLOCK,
      txHash: RESUMED_TX_HASH,
      epoch: 3n,
      tileId: 3n,
      canonical: true,
    }));
  }
  return logs;
}

function makeBlock(blockNumber: bigint) {
  return {
    baseFeePerGas: "0x1",
    difficulty: "0x0",
    extraData: "0x",
    gasLimit: "0x1c9c380",
    gasUsed: "0x0",
    hash: canonicalBlockHash(blockNumber),
    logsBloom: ZERO_BLOOM,
    miner: ZERO_ADDRESS,
    mixHash: ZERO_HASH,
    nonce: "0x0000000000000000",
    number: toHex(blockNumber),
    parentHash: blockNumber === 0n ? ZERO_HASH : canonicalBlockHash(blockNumber - 1n),
    receiptsRoot: ZERO_HASH,
    sha3Uncles: ZERO_HASH,
    size: "0x0",
    stateRoot: ZERO_HASH,
    timestamp: "0x1",
    totalDifficulty: "0x0",
    transactions: [],
    transactionsRoot: ZERO_HASH,
    uncles: [],
  };
}

function respondJson(response: ServerResponse, value: unknown) {
  const payload = JSON.stringify(value);
  response.writeHead(200, {
    "content-length": Buffer.byteLength(payload),
    "content-type": "application/json",
  });
  response.end(payload);
}

function readRequestBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    request.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > 64 * 1024) {
        reject(new Error("RPC fixture request exceeded its bound"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.once("error", reject);
  });
}

function handleRpcCall(
  request: JsonRpcRequest,
  provider: string,
  state: RpcState,
) {
  state.callsByProvider.set(provider, (state.callsByProvider.get(provider) ?? 0) + 1);
  const params = request.params ?? [];
  let result: unknown;
  switch (request.method) {
    case "eth_blockNumber":
      result = toHex(HEAD_BLOCK);
      break;
    case "eth_chainId":
      result = toHex(59_141);
      break;
    case "eth_getBlockByNumber": {
      const blockNumber = parseBlockTag(params[0]);
      result = makeBlock(blockNumber);
      break;
    }
    case "eth_getLogs": {
      const filter = (params[0] ?? {}) as Record<string, unknown>;
      const fromBlock = parseBlockTag(filter.fromBlock ?? "0x0");
      const toBlock = parseBlockTag(filter.toBlock ?? "latest");
      state.ranges.push({ phase: state.phase, provider, fromBlock, toBlock });
      result = phaseLogs(state.phase).filter((log) => {
        const blockNumber = BigInt(log.blockNumber);
        return blockNumber >= fromBlock && blockNumber <= toBlock;
      });
      break;
    }
    case "eth_call":
      result = toHex(1n, { size: 32 });
      break;
    default:
      throw new Error(`unsupported fixture RPC method: ${request.method ?? "missing"}`);
  }
  return {
    id: request.id ?? null,
    jsonrpc: "2.0",
    result,
  };
}

function createRpcServer(provider: string, state: RpcState) {
  return createServer(async (request, response) => {
    try {
      const raw = await readRequestBody(request);
      const payload = JSON.parse(raw) as JsonRpcRequest | JsonRpcRequest[];
      const result = Array.isArray(payload)
        ? payload.map((item) => handleRpcCall(item, provider, state))
        : handleRpcCall(payload, provider, state);
      respondJson(response, result);
    } catch (error) {
      respondJson(response, {
        id: null,
        jsonrpc: "2.0",
        error: {
          code: -32_000,
          message: error instanceof Error ? error.message : "fixture RPC failure",
        },
      });
    }
  });
}

function listen(server: Server, host: string) {
  return new Promise<string>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("RPC fixture did not receive a TCP address"));
        return;
      }
      resolve(`http://${host}:${address.port}`);
    });
  });
}

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function appendBounded(current: string, chunk: Buffer | string) {
  const next = current + String(chunk);
  if (Buffer.byteLength(next, "utf8") <= MAX_CHILD_OUTPUT_BYTES) return next;
  return next.slice(-MAX_CHILD_OUTPUT_BYTES);
}

async function runIndexer(options: {
  dbPath: string;
  rpcUrls: readonly [string, string];
  killAfterMarker?: string;
  timeoutMs?: number;
}) {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "test",
    LINEA_NETWORK: "sepolia",
    NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
    KEEPER_CONTRACT_ADDRESS: CONTRACT_ADDRESS,
    NEXT_PUBLIC_CONTRACT_ADDRESS: CONTRACT_ADDRESS,
    KEEPER_RPC_URL: options.rpcUrls.join(","),
    INDEXER_START_BLOCK: DEPLOY_BLOCK.toString(),
    INDEXER_FINALITY_BLOCKS: FINALITY_BLOCKS.toString(),
    INDEXER_RPC_TIMEOUT_MS: "3000",
    LORE_ALLOW_CONTRACT_SCOPE_PURGE: "0",
    LORE_DB_PATH: options.dbPath,
  };
  const child = spawn(process.execPath, [TSX_CLI, INDEXER_ENTRYPOINT], {
    cwd: REPO_ROOT,
    env: environment,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  return await waitForChild(child, options.killAfterMarker, options.timeoutMs ?? 30_000);
}

function waitForChild(
  child: ChildProcess,
  killAfterMarker: string | undefined,
  timeoutMs: number,
) {
  return new Promise<ChildRun>((resolve) => {
    let output = "";
    let markerSeen = false;
    let timedOut = false;
    let settled = false;
    const capture = (chunk: Buffer | string) => {
      output = appendBounded(output, chunk);
      if (!markerSeen && killAfterMarker && output.includes(killAfterMarker)) {
        markerSeen = true;
        child.kill();
      }
    };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal, markerSeen, timedOut, output });
    });
    child.once("error", (error) => {
      output = appendBounded(output, error.message);
    });
  });
}

function parseJsonObject(value: string | null) {
  if (value === null) return null;
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
}

function inspectDb(dbPath: string): IndexerDbState {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const cursorRow = db.prepare("SELECT value FROM meta WHERE key = ?")
      .get(`${STORAGE_SCOPE}:lastIndexedBlock`) as { value?: unknown } | undefined;
    const runStatusRow = db.prepare("SELECT value FROM meta WHERE key = ?")
      .get(`${STORAGE_SCOPE}:indexerRunStatus`) as { value?: unknown } | undefined;
    const checkpoints = db.prepare(`
      SELECT block_number AS blockNumber, block_hash AS blockHash
      FROM scoped_indexer_block_checkpoints
      WHERE scope = ?
      ORDER BY block_number
    `).all(STORAGE_SCOPE) as Array<{ blockNumber: number; blockHash: string }>;
    const bets = db.prepare(`
      SELECT tx_hash AS txHash, block_number AS blockNumber
      FROM scoped_bets
      WHERE scope = ?
      ORDER BY block_number, tx_hash
    `).all(STORAGE_SCOPE) as Array<{ txHash: string; blockNumber: number }>;
    return {
      cursor: typeof cursorRow?.value === "string" ? cursorRow.value : null,
      checkpoints: checkpoints.map((row) => ({ ...row })),
      bets: bets.map((row) => ({ ...row })),
      runStatus: parseJsonObject(
        typeof runStatusRow?.value === "string" ? runStatusRow.value : null,
      ),
    };
  } finally {
    (db as unknown as { close(): void }).close();
  }
}

function expireCrashedLease(dbPath: string) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const result = db.prepare(`
      UPDATE scoped_indexer_leases
      SET expires_at = 0
      WHERE scope = ?
    `).run(STORAGE_SCOPE) as { changes?: number | bigint };
    assert.equal(Number(result.changes ?? 0), 1, "crashed indexer lease must exist before TTL expiry");
  } finally {
    (db as unknown as { close(): void }).close();
  }
}

function uniqueRanges(ranges: RpcRange[], phase: RpcPhase) {
  return [...new Set(
    ranges
      .filter((range) => range.phase === phase)
      .map((range) => `${range.fromBlock}-${range.toBlock}`),
  )];
}

async function main() {
  const testDir = mkdtempSync(join(tmpdir(), "lore-indexer-process-restart-"));
  const dbPath = join(testDir, "indexer.sqlite");
  const state: RpcState = {
    phase: "crash",
    ranges: [],
    callsByProvider: new Map(),
  };
  const firstServer = createRpcServer("rpc-a", state);
  const secondServer = createRpcServer("rpc-b", state);

  try {
    const [firstRpcUrl, secondRpcUrl] = await Promise.all([
      listen(firstServer, "127.0.0.1"),
      listen(secondServer, "127.0.0.2"),
    ]);
    const rpcUrls = [firstRpcUrl, secondRpcUrl] as const;

    const crashed = await runIndexer({
      dbPath,
      rpcUrls,
      killAfterMarker: "Chunk 1/3 committed to local SQLite",
    });
    assert.equal(crashed.timedOut, false, `crash fixture timed out:\n${crashed.output}`);
    assert.equal(crashed.markerSeen, true, `first chunk was not committed before crash:\n${crashed.output}`);
    assert.notEqual(crashed.code, 0, "crash fixture must not exit successfully");

    const afterCrash = inspectDb(dbPath);
    assert.equal(afterCrash.cursor, FIRST_CHUNK_END.toString());
    assert.deepEqual(afterCrash.checkpoints.map((row) => row.blockNumber), [Number(FIRST_CHUNK_END)]);
    assert.deepEqual(afterCrash.bets, [{
      txHash: FIRST_TX_HASH,
      blockNumber: Number(FIRST_EVENT_BLOCK),
    }]);
    expireCrashedLease(dbPath);

    state.phase = "fork";
    const forked = await runIndexer({ dbPath, rpcUrls });
    assert.equal(forked.timedOut, false, `fork fixture timed out:\n${forked.output}`);
    assert.notEqual(forked.code, 0, `non-canonical log run must fail closed:\n${forked.output}`);
    assert.match(forked.output, /non-canonical log block detected at block 6000/i);

    const afterFork = inspectDb(dbPath);
    assert.equal(afterFork.cursor, FIRST_CHUNK_END.toString(), "failed fork chunk must not advance cursor");
    assert.deepEqual(afterFork.checkpoints, afterCrash.checkpoints);
    assert.deepEqual(afterFork.bets, afterCrash.bets, "failed fork chunk must not persist any event row");

    state.phase = "resume";
    const resumed = await runIndexer({ dbPath, rpcUrls });
    assert.equal(resumed.timedOut, false, `resume fixture timed out:\n${resumed.output}`);
    assert.equal(resumed.code, 0, `indexer did not recover from its exact cursor:\n${resumed.output}`);
    assert.match(resumed.output, /Scanning blocks 5101 -> 10103/);

    const finalState = inspectDb(dbPath);
    assert.equal(finalState.cursor, FINALIZED_TARGET.toString());
    assert.deepEqual(finalState.checkpoints.map((row) => row.blockNumber), [
      Number(FIRST_CHUNK_END),
      10_100,
      Number(FINALIZED_TARGET),
    ]);
    assert.deepEqual(finalState.bets, [
      { txHash: FIRST_TX_HASH, blockNumber: Number(FIRST_EVENT_BLOCK) },
      { txHash: RESUMED_TX_HASH, blockNumber: Number(RESUMED_EVENT_BLOCK) },
    ]);
    assert.equal(finalState.bets.some((row) => row.txHash === FORK_TX_HASH), false);
    assert.equal(finalState.bets.some((row) => row.txHash === UNFINALIZED_TX_HASH), false);
    assert.ok(
      finalState.bets.every((row) => BigInt(row.blockNumber) <= FINALIZED_TARGET),
      "SQLite must not contain rows beyond the finalized head",
    );
    assert.equal(finalState.runStatus?.headBlock, HEAD_BLOCK.toString());
    assert.equal(finalState.runStatus?.finalityBlocks, FINALITY_BLOCKS.toString());
    assert.equal(finalState.runStatus?.targetBlock, FINALIZED_TARGET.toString());
    assert.equal(finalState.runStatus?.lastProcessedBlock, FINALIZED_TARGET.toString());

    assert.ok((state.callsByProvider.get("rpc-a") ?? 0) > 0);
    assert.ok((state.callsByProvider.get("rpc-b") ?? 0) > 0);
    assert.deepEqual(uniqueRanges(state.ranges, "crash"), ["101-5100"]);
    assert.equal(uniqueRanges(state.ranges, "fork")[0], "5101-10100");
    assert.equal(uniqueRanges(state.ranges, "resume")[0], "5101-10100");
    assert.ok(
      state.ranges.every((range) => range.toBlock <= FINALIZED_TARGET),
      "actual indexer entrypoint must never request logs above its finalized target",
    );

    console.log(JSON.stringify({
      status: "pass",
      entrypoint: "scripts/indexer.ts",
      rpcProviders: 2,
      crashCursor: afterCrash.cursor,
      forkRejectedAt: FORK_EVENT_BLOCK.toString(),
      resumedFrom: (FIRST_CHUNK_END + 1n).toString(),
      finalizedTarget: finalState.cursor,
      indexedRows: finalState.bets.length,
      unfinalizedRows: 0,
      forkRows: 0,
    }));
  } finally {
    await Promise.allSettled([closeServer(firstServer), closeServer(secondServer)]);
    rmSync(testDir, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
