import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type WorkerCommand = {
  id: string;
  op: "acquire" | "heartbeat" | "release";
  ownerToken: string;
  ttlMs?: number;
} | {
  id: string;
  op: "hold-write-lock";
  holdMs: number;
} | {
  id: string;
  op: "close";
};

type WorkerMessage = {
  type: "ready";
  scope: string;
  journalMode: string;
  busyTimeoutMs: number;
} | {
  type: "locked";
  id: string;
} | {
  type: "result";
  id: string;
  ok: boolean;
  value?: boolean;
  elapsedMs?: number;
  error?: string;
};

type WorkerHarness = {
  child: ChildProcess;
  stdout: string[];
  stderr: string[];
};

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = dirname(dirname(THIS_FILE));
const PRIMARY_ADDRESS = `0x${"abcdef".repeat(6)}abcd`;
const PRIMARY_ADDRESS_UPPER = `0x${PRIMARY_ADDRESS.slice(2).toUpperCase()}`;
const SECONDARY_ADDRESS = `0x${"1234567890".repeat(4)}`;
const LEASE_TTL_MS = 4_000;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildWorkerEnv(
  dbPath: string,
  network: string,
  contractAddress: string,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: "test",
    LORE_DB_PATH: dbPath,
    LINEA_NETWORK: network,
    NEXT_PUBLIC_LINEA_NETWORK: network,
    KEEPER_CONTRACT_ADDRESS: contractAddress,
    NEXT_PUBLIC_CONTRACT_ADDRESS: contractAddress,
    LORE_ALLOW_CONTRACT_SCOPE_PURGE: "0",
    KEEPER_RPC_URL: "http://127.0.0.1:1",
    INDEXER_START_BLOCK: "1",
    INDEXER_FINALITY_BLOCKS: "2",
  };
}

function waitForMessage(
  child: ChildProcess,
  predicate: (message: WorkerMessage) => boolean,
  timeoutMs = 8_000,
) {
  return new Promise<WorkerMessage>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timed out waiting for lease worker response"));
    }, timeoutMs);
    const onMessage = (raw: unknown) => {
      const message = raw as WorkerMessage;
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`lease worker exited before responding (${code ?? "signal"})`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("exit", onExit);
    };
    child.on("message", onMessage);
    child.once("exit", onExit);
  });
}

async function sendWorkerCommand(
  harness: WorkerHarness,
  command: WorkerCommand,
  timeoutMs = 8_000,
) {
  const response = waitForMessage(
    harness.child,
    (message) => message.type === "result" && message.id === command.id,
    timeoutMs,
  );
  harness.child.send(command);
  return await response as Extract<WorkerMessage, { type: "result" }>;
}

async function startWorker(dbPath: string, network: string, contractAddress: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const child = fork(THIS_FILE, ["--lease-worker"], {
    cwd: REPO_ROOT,
    env: buildWorkerEnv(dbPath, network, contractAddress),
    execArgv: process.execArgv,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  child.stdout?.on("data", (chunk) => stdout.push(String(chunk)));
  child.stderr?.on("data", (chunk) => stderr.push(String(chunk)));
  const harness = { child, stdout, stderr } satisfies WorkerHarness;
  const ready = await waitForMessage(child, (message) => message.type === "ready");
  return {
    harness,
    ready: ready as Extract<WorkerMessage, { type: "ready" }>,
  };
}

async function waitForExit(child: ChildProcess, timeoutMs = 5_000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    delay(timeoutMs).then(() => { throw new Error("child process did not exit"); }),
  ]);
}

async function stopWorker(harness: WorkerHarness) {
  if (harness.child.exitCode !== null || harness.child.signalCode !== null) return;
  try {
    await sendWorkerCommand(harness, { id: randomUUID(), op: "close" }, 1_500);
  } catch {
    harness.child.kill();
  }
  await waitForExit(harness.child).catch(() => {
    harness.child.kill();
  });
}

async function runBlockedIndexer(
  dbPath: string,
  args: string[],
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const startedAt = Date.now();
  const child = fork(join(REPO_ROOT, "scripts", "indexer.ts"), args, {
    cwd: REPO_ROOT,
    env: buildWorkerEnv(dbPath, "sepolia", PRIMARY_ADDRESS_UPPER),
    execArgv: process.execArgv,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  child.stdout?.on("data", (chunk) => stdout.push(String(chunk)));
  child.stderr?.on("data", (chunk) => stderr.push(String(chunk)));
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  return {
    ...exit,
    elapsedMs: Date.now() - startedAt,
    output: `${stdout.join("")}\n${stderr.join("")}`,
  };
}

async function runLeaseWorker() {
  const {
    acquireIndexerLease,
    getCurrentStorageScope,
    heartbeatIndexerLease,
    releaseIndexerLease,
  } = await import("../server/storage");
  const { db } = await import("../server/db");
  const journalRow = db.prepare("PRAGMA journal_mode").get();
  const busyRow = db.prepare("PRAGMA busy_timeout").get();
  process.send?.({
    type: "ready",
    scope: getCurrentStorageScope(),
    journalMode: String(journalRow?.journal_mode ?? ""),
    busyTimeoutMs: Number(busyRow?.timeout ?? 0),
  } satisfies WorkerMessage);

  process.on("message", (raw: unknown) => {
    const command = raw as WorkerCommand;
    const startedAt = Date.now();
    try {
      if (command.op === "hold-write-lock") {
        db.exec("BEGIN IMMEDIATE");
        process.send?.({ type: "locked", id: command.id } satisfies WorkerMessage);
        setTimeout(() => {
          try {
            db.exec("COMMIT");
            process.send?.({
              type: "result",
              id: command.id,
              ok: true,
              elapsedMs: Date.now() - startedAt,
            } satisfies WorkerMessage);
          } catch (error) {
            process.send?.({
              type: "result",
              id: command.id,
              ok: false,
              error: error instanceof Error ? error.message : "lock release failed",
            } satisfies WorkerMessage);
          }
        }, command.holdMs);
        return;
      }
      if (command.op === "close") {
        process.send?.({ type: "result", id: command.id, ok: true } satisfies WorkerMessage);
        setImmediate(() => {
          try { (db as unknown as { close(): void }).close(); } catch { /* best effort */ }
          process.exit(0);
        });
        return;
      }

      let value = false;
      if (command.op === "acquire") {
        value = acquireIndexerLease(command.ownerToken, command.ttlMs ?? 0);
      } else if (command.op === "heartbeat") {
        value = heartbeatIndexerLease(command.ownerToken, command.ttlMs ?? 0);
      } else {
        value = releaseIndexerLease(command.ownerToken);
      }
      process.send?.({
        type: "result",
        id: command.id,
        ok: true,
        value,
        elapsedMs: Date.now() - startedAt,
      } satisfies WorkerMessage);
    } catch (error) {
      process.send?.({
        type: "result",
        id: command.id,
        ok: false,
        elapsedMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "lease operation failed",
      } satisfies WorkerMessage);
    }
  });
}

async function runTest() {
  const testDir = mkdtempSync(join(tmpdir(), "lore-indexer-lease-"));
  const dbPath = join(testDir, "lease.sqlite");
  const workers: WorkerHarness[] = [];
  const holderOwnerToken = randomUUID();
  const contenderOwnerToken = randomUUID();
  const wrongOwnerToken = randomUUID();

  try {
    const holder = await startWorker(dbPath, "TESTNET", PRIMARY_ADDRESS);
    workers.push(holder.harness);
    const contender = await startWorker(dbPath, "sepolia", PRIMARY_ADDRESS_UPPER);
    workers.push(contender.harness);

    const expectedScope = `sepolia:${PRIMARY_ADDRESS.toLowerCase()}`;
    assert.equal(holder.ready.scope, expectedScope);
    assert.equal(contender.ready.scope, expectedScope);
    assert.equal(holder.ready.journalMode.toLowerCase(), "wal");
    assert.equal(contender.ready.journalMode.toLowerCase(), "wal");
    assert.equal(holder.ready.busyTimeoutMs, 15_000);
    assert.equal(contender.ready.busyTimeoutMs, 15_000);

    const invalidTtl = await sendWorkerCommand(contender.harness, {
      id: randomUUID(),
      op: "acquire",
      ownerToken: contenderOwnerToken,
      ttlMs: 999,
    });
    assert.equal(invalidTtl.ok, false, "lease TTL below the lower bound must fail closed");
    assert.match(invalidTtl.error ?? "", /TTL/i);
    const oversizedTtl = await sendWorkerCommand(contender.harness, {
      id: randomUUID(),
      op: "acquire",
      ownerToken: contenderOwnerToken,
      ttlMs: 120_001,
    });
    assert.equal(oversizedTtl.ok, false, "lease TTL above the upper bound must fail closed");
    assert.match(oversizedTtl.error ?? "", /TTL/i);
    const invalidOwner = await sendWorkerCommand(contender.harness, {
      id: randomUUID(),
      op: "acquire",
      ownerToken: "short",
      ttlMs: LEASE_TTL_MS,
    });
    assert.equal(invalidOwner.ok, false, "short owner identifiers must not weaken opaque-token ownership");
    assert.match(invalidOwner.error ?? "", /opaque indexer lease owner token/i);

    const acquired = await sendWorkerCommand(holder.harness, {
      id: randomUUID(),
      op: "acquire",
      ownerToken: holderOwnerToken,
      ttlMs: LEASE_TTL_MS,
    });
    assert.equal(acquired.ok, true);
    assert.equal(acquired.value, true);

    const wrongHeartbeat = await sendWorkerCommand(contender.harness, {
      id: randomUUID(),
      op: "heartbeat",
      ownerToken: wrongOwnerToken,
      ttlMs: LEASE_TTL_MS,
    });
    assert.equal(wrongHeartbeat.value, false, "a different opaque token must not renew the lease");

    const lockId = randomUUID();
    const locked = waitForMessage(
      holder.harness.child,
      (message) => message.type === "locked" && message.id === lockId,
    );
    const lockReleased = sendWorkerCommand(holder.harness, {
      id: lockId,
      op: "hold-write-lock",
      holdMs: 700,
    });
    await locked;
    const contendedAcquire = await sendWorkerCommand(contender.harness, {
      id: randomUUID(),
      op: "acquire",
      ownerToken: contenderOwnerToken,
      ttlMs: LEASE_TTL_MS,
    });
    await lockReleased;
    assert.equal(contendedAcquire.ok, true);
    assert.equal(contendedAcquire.value, false, "an active lease must survive WAL writer contention");
    assert.ok(
      (contendedAcquire.elapsedMs ?? 0) >= 300,
      `second connection did not encounter the held SQLite writer lock (${contendedAcquire.elapsedMs ?? 0}ms)`,
    );
    assert.ok(existsSync(`${dbPath}-wal`), "the contention proof must use the real WAL database");
    assert.ok(existsSync(`${dbPath}-shm`), "the contention proof must use the real WAL shared-memory file");

    const refreshed = await sendWorkerCommand(holder.harness, {
      id: randomUUID(),
      op: "heartbeat",
      ownerToken: holderOwnerToken,
      ttlMs: LEASE_TTL_MS,
    });
    assert.equal(refreshed.value, true);

    for (const args of [[], ["--watch"]]) {
      const blockedIndexer = await runBlockedIndexer(dbPath, args);
      assert.equal(blockedIndexer.code, 1, `indexer ${args.length ? "watch" : "run"} must fail closed on lease contention`);
      assert.match(blockedIndexer.output, /indexer lease.*(?:unavailable|held)/i);
      assert.doesNotMatch(blockedIndexer.output, /getBlockNumber|indexed log fetch|ECONNREFUSED/i);
      assert.ok(blockedIndexer.elapsedMs < 5_000, "blocked indexer must stop before RPC work");
      const retainedHeartbeat = await sendWorkerCommand(holder.harness, {
        id: randomUUID(),
        op: "heartbeat",
        ownerToken: holderOwnerToken,
        ttlMs: LEASE_TTL_MS,
      });
      assert.equal(retainedHeartbeat.value, true, "the established owner must retain its lease across each blocked start probe");
    }

    const otherScope = await startWorker(dbPath, "testnet", SECONDARY_ADDRESS);
    workers.push(otherScope.harness);
    assert.equal(otherScope.ready.scope, `sepolia:${SECONDARY_ADDRESS}`);
    assert.notEqual(otherScope.ready.scope, holder.ready.scope);
    const otherScopeOwner = randomUUID();
    const otherScopeAcquire = await sendWorkerCommand(otherScope.harness, {
      id: randomUUID(),
      op: "acquire",
      ownerToken: otherScopeOwner,
      ttlMs: LEASE_TTL_MS,
    });
    assert.equal(otherScopeAcquire.value, true, "a different normalized contract scope needs an independent lease");
    const otherScopeRelease = await sendWorkerCommand(otherScope.harness, {
      id: randomUUID(),
      op: "release",
      ownerToken: otherScopeOwner,
    });
    assert.equal(otherScopeRelease.value, true);
    await stopWorker(otherScope.harness);

    const wrongRelease = await sendWorkerCommand(contender.harness, {
      id: randomUUID(),
      op: "release",
      ownerToken: wrongOwnerToken,
    });
    assert.equal(wrongRelease.value, false, "a stale owner token must not release another process lease");

    const finalHeartbeat = await sendWorkerCommand(holder.harness, {
      id: randomUUID(),
      op: "heartbeat",
      ownerToken: holderOwnerToken,
      ttlMs: LEASE_TTL_MS,
    });
    assert.equal(finalHeartbeat.value, true);
    holder.harness.child.kill();
    await waitForExit(holder.harness.child);

    const beforeExpiry = await sendWorkerCommand(contender.harness, {
      id: randomUUID(),
      op: "acquire",
      ownerToken: contenderOwnerToken,
      ttlMs: LEASE_TTL_MS,
    });
    assert.equal(beforeExpiry.value, false, "a crashed owner lease must remain exclusive until its bounded TTL expires");

    await delay(LEASE_TTL_MS + 300);
    const afterExpiry = await sendWorkerCommand(contender.harness, {
      id: randomUUID(),
      op: "acquire",
      ownerToken: contenderOwnerToken,
      ttlMs: LEASE_TTL_MS,
    });
    assert.equal(afterExpiry.value, true, "a crashed owner lease must be recoverable after expiry");
    const contenderHeartbeat = await sendWorkerCommand(contender.harness, {
      id: randomUUID(),
      op: "heartbeat",
      ownerToken: contenderOwnerToken,
      ttlMs: LEASE_TTL_MS,
    });
    assert.equal(contenderHeartbeat.value, true);
    const expiredOwnerHeartbeat = await sendWorkerCommand(contender.harness, {
      id: randomUUID(),
      op: "heartbeat",
      ownerToken: holderOwnerToken,
      ttlMs: LEASE_TTL_MS,
    });
    assert.equal(expiredOwnerHeartbeat.value, false, "an expired prior owner must not revive or extend the replacement lease");
    const staleRelease = await sendWorkerCommand(contender.harness, {
      id: randomUUID(),
      op: "release",
      ownerToken: holderOwnerToken,
    });
    assert.equal(staleRelease.value, false);
    const released = await sendWorkerCommand(contender.harness, {
      id: randomUUID(),
      op: "release",
      ownerToken: contenderOwnerToken,
    });
    assert.equal(released.value, true);

    console.log(JSON.stringify({
      status: "pass",
      independentConnections: 2,
      journalMode: "wal",
      busyContentionObserved: true,
      scopeNormalizationParity: true,
      opaqueOwnerIsolation: true,
      runFailClosed: true,
      watchFailClosed: true,
      crashExpiryRecovery: true,
    }));
  } finally {
    for (const worker of workers.reverse()) {
      await stopWorker(worker).catch(() => {
        worker.child.kill();
      });
    }
    rmSync(testDir, { recursive: true, force: true });
  }
}

if (process.argv.includes("--lease-worker")) {
  void runLeaseWorker().catch((error) => {
    console.error(error instanceof Error ? error.message : "lease worker failed");
    process.exit(1);
  });
} else {
  void runTest().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
  });
}
