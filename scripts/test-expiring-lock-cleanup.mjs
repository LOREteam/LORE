import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = dirname(dirname(THIS_FILE));
const TEST_CONTRACT = `0x${"12".repeat(20)}`;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildWorkerEnv(dbPath) {
  return {
    ...process.env,
    NODE_ENV: "test",
    LORE_DB_PATH: dbPath,
    LINEA_NETWORK: "sepolia",
    NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
    KEEPER_CONTRACT_ADDRESS: TEST_CONTRACT,
    NEXT_PUBLIC_CONTRACT_ADDRESS: TEST_CONTRACT,
  };
}

function waitForMessage(child, predicate, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timed out waiting for expiring-lock worker"));
    }, timeoutMs);
    const onMessage = (message) => {
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`expiring-lock worker exited early (${code ?? "signal"})`));
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

async function startWorker(dbPath) {
  const child = fork(THIS_FILE, ["--worker"], {
    cwd: REPO_ROOT,
    env: buildWorkerEnv(dbPath),
    execArgv: process.execArgv,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const stderr = [];
  child.stderr?.on("data", (chunk) => stderr.push(String(chunk)));
  try {
    await waitForMessage(child, (message) => message?.type === "ready");
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : error}\n${stderr.join("")}`);
  }
  return child;
}

async function command(child, payload) {
  const id = randomUUID();
  const response = waitForMessage(
    child,
    (message) => message?.type === "result" && message.id === id,
  );
  child.send({ ...payload, id });
  return await response;
}

async function stopWorker(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await command(child, { op: "close" });
  await new Promise((resolve) => child.once("exit", resolve));
}

async function runWorker() {
  const storageModule = await import("../server/storage.ts");
  const { acquireExpiringLock } = storageModule.default ?? storageModule;
  const dbModule = await import("../server/db.ts");
  const { db } = dbModule.default ?? dbModule;

  process.send?.({ type: "ready" });
  process.on("message", (message) => {
    const respond = (value) => process.send?.({ type: "result", id: message.id, ...value });
    if (message.op === "close") {
      respond({ ok: true });
      setImmediate(() => {
        try { db.close(); } catch { /* best effort */ }
        process.exit(0);
      });
      return;
    }
    if (message.op === "count") {
      const now = Date.now();
      const expired = db.prepare("SELECT COUNT(*) AS count FROM ephemeral_locks WHERE expires_at <= ?").get(now);
      const active = db.prepare("SELECT COUNT(*) AS count FROM ephemeral_locks WHERE expires_at > ?").get(now);
      const indexes = db.prepare("PRAGMA index_list('ephemeral_locks')").all();
      respond({
        ok: true,
        expired: Number(expired?.count ?? -1),
        active: Number(active?.count ?? -1),
        hasExpiryIndex: indexes.some((row) => row?.name === "idx_ephemeral_locks_expires"),
      });
      return;
    }
    const runAcquire = () => {
      try {
        const value = acquireExpiringLock(message.name, message.epoch, message.ttlMs);
        respond({ ok: true, value });
      } catch (error) {
        respond({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    };
    const waitMs = Math.max(0, Number(message.startAt ?? 0) - Date.now());
    if (waitMs > 0) setTimeout(runAcquire, waitMs);
    else runAcquire();
  });
}

async function runTest() {
  const testDir = mkdtempSync(join(tmpdir(), "lore-expiring-locks-"));
  const dbPath = join(testDir, "locks.sqlite");
  const workers = [];
  try {
    const first = await startWorker(dbPath);
    workers.push(first);
    const second = await startWorker(dbPath);
    workers.push(second);

    for (let index = 0; index < 12; index += 1) {
      const acquired = await command(first, {
        op: "acquire",
        name: `chat-auth:expired-${index}`,
        epoch: `nonce-${index}`,
        ttlMs: 1,
      });
      assert.deepEqual({ ok: acquired.ok, value: acquired.value }, { ok: true, value: true });
    }
    await delay(30);

    const fresh = await command(first, {
      op: "acquire",
      name: "chat-auth:fresh",
      epoch: "fresh-nonce",
      ttlMs: 5_000,
    });
    assert.equal(fresh.value, true, "a legitimate fresh proof must still acquire its lock");

    const afterCleanup = await command(second, { op: "count" });
    assert.equal(afterCleanup.expired, 0, "a later acquisition must remove every expired durable lock");
    assert.equal(afterCleanup.active, 1, "cleanup must preserve the newly acquired active lock");
    assert.equal(afterCleanup.hasExpiryIndex, true, "expiry cleanup must use the durable expiry index");

    const replay = await command(second, {
      op: "acquire",
      name: "chat-auth:fresh",
      epoch: "fresh-nonce",
      ttlMs: 5_000,
    });
    assert.equal(replay.value, false, "an active chat proof must remain single-use across processes");

    const startAt = Date.now() + 100;
    const contenders = await Promise.all([
      command(first, {
        op: "acquire",
        name: "chat-auth:race",
        epoch: "shared-nonce",
        ttlMs: 5_000,
        startAt,
      }),
      command(second, {
        op: "acquire",
        name: "chat-auth:race",
        epoch: "shared-nonce",
        ttlMs: 5_000,
        startAt,
      }),
    ]);
    assert.deepEqual(
      contenders.map((result) => result.value).sort(),
      [false, true],
      "BEGIN IMMEDIATE must serialize two replicas so exactly one consumes the proof",
    );

    const shortLived = await command(first, {
      op: "acquire",
      name: "chat-auth:recoverable",
      epoch: "old-nonce",
      ttlMs: 20,
    });
    assert.equal(shortLived.value, true);
    await delay(40);
    const recovered = await command(second, {
      op: "acquire",
      name: "chat-auth:recoverable",
      epoch: "old-nonce",
      ttlMs: 5_000,
    });
    assert.equal(recovered.value, true, "an expired proof lock must be safely recoverable");

    console.log("expiring lock cleanup tests passed");
  } finally {
    for (const worker of workers.reverse()) {
      await stopWorker(worker).catch(() => worker.kill());
    }
    rmSync(testDir, { recursive: true, force: true });
  }
}

if (process.argv.includes("--worker")) {
  void runWorker().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
  });
} else {
  void runTest().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
  });
}
