import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEther } from "viem";
import {
  DEFAULT_KEEPER_DAILY_MAX_SIGNATURES,
  getKeeperDailyBudgetPolicy,
} from "../app/lib/lineaFees";
import { reserveExternalKeeperDailyBudget } from "../app/api/_lib/externalRateLimit";

type ReserveCommand = {
  id: string;
  op: "reserve";
  chainId: number;
  contractAddress: `0x${string}`;
  signerAddress: `0x${string}`;
  nonce: number;
  epoch: string;
  signingIntentHash: `0x${string}`;
  reservedMaxCostWei: string;
  nowMs: number;
  maxSignatures: number;
  maxReservedCostWei: string;
};

type WorkerCommand = ReserveCommand | {
  id: string;
  op: "corrupt";
  chainId: number;
  contractAddress: `0x${string}`;
  nowMs: number;
} | {
  id: string;
  op: "close";
};

type WorkerMessage = {
  type: "ready";
  scope: string;
} | {
  type: "result";
  id: string;
  ok: boolean;
  status?: "reserved" | "already_reserved";
  reservedSignatureCount?: number;
  reservedMaxCostWei?: string;
  error?: string;
};

type WorkerHarness = {
  child: ChildProcess;
  stdout: string[];
  stderr: string[];
};

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = dirname(dirname(THIS_FILE));
const CHAIN_ID = 59_141;
const CONTRACT = `0x${"11".repeat(20)}` as const;
const OTHER_CONTRACT = `0x${"22".repeat(20)}` as const;
const SIGNER = `0x${"aa".repeat(20)}` as const;
const DAY_MS = 86_400_000;
const TEST_NOW_MS = Date.UTC(2026, 7, 10, 12, 0, 0);

function intentHash(sequence: number) {
  return `0x${sequence.toString(16).padStart(64, "0")}` as const;
}

function buildWorkerEnv(dbPath: string, contractAddress: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: "test",
    LORE_DB_PATH: dbPath,
    LINEA_NETWORK: "sepolia",
    NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
    LINEA_CHAIN_ID: String(CHAIN_ID),
    NEXT_PUBLIC_LINEA_CHAIN_ID: String(CHAIN_ID),
    KEEPER_CONTRACT_ADDRESS: contractAddress,
    NEXT_PUBLIC_CONTRACT_ADDRESS: contractAddress,
    LORE_ALLOW_CONTRACT_SCOPE_PURGE: "0",
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
      reject(new Error("timed out waiting for keeper budget worker"));
    }, timeoutMs);
    const onMessage = (raw: unknown) => {
      const message = raw as WorkerMessage;
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`keeper budget worker exited before responding (${code ?? "signal"})`));
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

async function sendWorkerCommand(harness: WorkerHarness, command: WorkerCommand) {
  const response = waitForMessage(
    harness.child,
    (message) => message.type === "result" && message.id === command.id,
  );
  harness.child.send(command);
  return await response as Extract<WorkerMessage, { type: "result" }>;
}

async function startWorker(dbPath: string, contractAddress = CONTRACT) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const child = fork(THIS_FILE, ["--keeper-budget-worker"], {
    cwd: REPO_ROOT,
    env: buildWorkerEnv(dbPath, contractAddress),
    execArgv: process.execArgv,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  child.stdout?.on("data", (chunk) => stdout.push(String(chunk)));
  child.stderr?.on("data", (chunk) => stderr.push(String(chunk)));
  const harness = { child, stdout, stderr } satisfies WorkerHarness;
  const ready = await waitForMessage(child, (message) => message.type === "ready");
  return { harness, ready: ready as Extract<WorkerMessage, { type: "ready" }> };
}

async function stopWorker(harness: WorkerHarness) {
  if (harness.child.exitCode !== null || harness.child.signalCode !== null) return;
  try {
    await sendWorkerCommand(harness, { id: randomUUID(), op: "close" });
  } catch {
    harness.child.kill();
  }
  await new Promise<void>((resolve) => {
    if (harness.child.exitCode !== null || harness.child.signalCode !== null) {
      resolve();
      return;
    }
    harness.child.once("exit", () => resolve());
    setTimeout(() => {
      harness.child.kill();
      resolve();
    }, 2_000).unref();
  });
}

function reserveCommand(options: {
  nonce: number;
  costWei: bigint;
  hashSequence: number;
  nowMs?: number;
  maxSignatures?: number;
  maxCostWei?: bigint;
  epoch?: bigint;
}): ReserveCommand {
  return {
    id: randomUUID(),
    op: "reserve",
    chainId: CHAIN_ID,
    contractAddress: CONTRACT,
    signerAddress: SIGNER,
    nonce: options.nonce,
    epoch: (options.epoch ?? BigInt(options.nonce + 1_000)).toString(),
    signingIntentHash: intentHash(options.hashSequence),
    reservedMaxCostWei: options.costWei.toString(),
    nowMs: options.nowMs ?? TEST_NOW_MS,
    maxSignatures: options.maxSignatures ?? 10,
    maxReservedCostWei: (options.maxCostWei ?? 100n).toString(),
  };
}

async function runWorker() {
  const { db } = await import("../server/db");
  const {
    getCurrentStorageScope,
    reserveKeeperDailyBudget,
  } = await import("../server/storage");

  process.send?.({
    type: "ready",
    scope: getCurrentStorageScope(),
  } satisfies WorkerMessage);

  process.on("message", (raw: unknown) => {
    const command = raw as WorkerCommand;
    try {
      if (command.op === "close") {
        process.send?.({ type: "result", id: command.id, ok: true } satisfies WorkerMessage);
        setImmediate(() => {
          try { (db as unknown as { close(): void }).close(); } catch { /* best effort */ }
          process.exit(0);
        });
        return;
      }
      if (command.op === "corrupt") {
        const utcDay = Math.floor(command.nowMs / DAY_MS);
        const key = [
          getCurrentStorageScope(),
          "keeper:daily-budget:v1",
          command.chainId,
          command.contractAddress.toLowerCase(),
          utcDay,
        ].join(":");
        db.prepare(`
          INSERT INTO meta(key, value) VALUES(?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(key, "{not-json");
        process.send?.({ type: "result", id: command.id, ok: true } satisfies WorkerMessage);
        return;
      }

      const result = reserveKeeperDailyBudget({
        chainId: command.chainId,
        contractAddress: command.contractAddress,
        signerAddress: command.signerAddress,
        nonce: command.nonce,
        epoch: BigInt(command.epoch),
        signingIntentHash: command.signingIntentHash,
        reservedMaxCostWei: BigInt(command.reservedMaxCostWei),
        nowMs: command.nowMs,
        policy: {
          maxSignatures: command.maxSignatures,
          maxReservedCostWei: BigInt(command.maxReservedCostWei),
        },
      });
      process.send?.({
        type: "result",
        id: command.id,
        ok: true,
        status: result.status,
        reservedSignatureCount: result.reservedSignatureCount,
        reservedMaxCostWei: result.reservedMaxCostWei.toString(),
      } satisfies WorkerMessage);
    } catch (error) {
      process.send?.({
        type: "result",
        id: command.id,
        ok: false,
        error: error instanceof Error ? error.message : "keeper budget operation failed",
      } satisfies WorkerMessage);
    }
  });
}

function assertPolicyClamp() {
  const mainnet = getKeeperDailyBudgetPolicy(59_144, {});
  assert.equal(mainnet.maxSignatures, DEFAULT_KEEPER_DAILY_MAX_SIGNATURES);
  assert.equal(mainnet.maxReservedCostWei, parseEther("0.001"));
  const sepolia = getKeeperDailyBudgetPolicy(CHAIN_ID, {});
  assert.equal(sepolia.maxSignatures, DEFAULT_KEEPER_DAILY_MAX_SIGNATURES);
  assert.equal(sepolia.maxReservedCostWei, parseEther("0.002"));

  const tightened = getKeeperDailyBudgetPolicy(CHAIN_ID, {
    KEEPER_DAILY_MAX_SIGNATURES: "3",
    KEEPER_DAILY_MAX_RESERVED_COST_WEI: "1000",
  });
  assert.deepEqual(tightened, { maxSignatures: 3, maxReservedCostWei: 1_000n });
  assert.throws(
    () => getKeeperDailyBudgetPolicy(CHAIN_ID, { KEEPER_DAILY_MAX_SIGNATURES: "0" }),
    /positive canonical integer/i,
  );
  assert.throws(
    () => getKeeperDailyBudgetPolicy(CHAIN_ID, {
      KEEPER_DAILY_MAX_SIGNATURES: String(DEFAULT_KEEPER_DAILY_MAX_SIGNATURES + 1),
    }),
    /cannot exceed/i,
  );
  assert.throws(
    () => getKeeperDailyBudgetPolicy(CHAIN_ID, {
      KEEPER_DAILY_MAX_RESERVED_COST_WEI: (parseEther("0.002") + 1n).toString(),
    }),
    /cannot exceed/i,
  );
  assert.throws(
    () => getKeeperDailyBudgetPolicy(CHAIN_ID, { KEEPER_DAILY_MAX_SIGNATURES: "01" }),
    /positive canonical integer/i,
  );
}

function assertBotReservationOrdering() {
  const source = readFileSync(join(REPO_ROOT, "bot.ts"), "utf8");
  const actionStart = source.indexOf("async function tryResolveEpochAction");
  const actionEnd = source.indexOf("async function startKeeperBot", actionStart);
  assert.ok(actionStart >= 0 && actionEnd > actionStart, "keeper signing action must remain inspectable");
  const action = source.slice(actionStart, actionEnd);
  const feeBudget = action.indexOf("assertKeeperFeeBudget(");
  const reservation = action.indexOf("reserveKeeperDailyBudget(");
  const signing = action.indexOf("account.signTransaction(");
  const pendingPersistence = action.indexOf("savePendingResolve({");
  assert.ok(feeBudget >= 0 && reservation > feeBudget, "daily reservation must use the validated per-tx maximum cost");
  assert.ok(signing > reservation, "daily reservation must be durable before local signing");
  assert.ok(pendingPersistence > signing, "signed resolves must retain the existing durable pending record");
  assert.doesNotMatch(action, /releaseKeeperDailyBudget/, "pending maximum cost must remain conservatively charged");
}

function assertBootstrapReservationOrdering() {
  const source = readFileSync(
    join(REPO_ROOT, "app/api/bootstrap-resolve/route.ts"),
    "utf8",
  );
  const actionStart = source.indexOf("const publicClient = clients[0]");
  const actionEnd = source.indexOf('throw new Error("resolve_failed")', actionStart);
  assert.ok(
    actionStart >= 0 && actionEnd > actionStart,
    "bootstrap keeper signing action must remain inspectable",
  );
  const action = source.slice(actionStart, actionEnd);
  const feeBudget = action.indexOf("assertKeeperFeeBudget(");
  const reservation = action.indexOf("reserveBootstrapKeeperDailyBudget(");
  const signing = action.indexOf("account.signTransaction(");
  const pendingPersistence = action.indexOf("savePendingResolveRecord(signedRecord)");
  assert.ok(
    feeBudget >= 0 && reservation > feeBudget,
    "bootstrap daily reservation must use the validated per-transaction maximum cost",
  );
  assert.ok(signing > reservation, "bootstrap daily reservation must be durable before local signing");
  assert.ok(
    pendingPersistence > signing,
    "bootstrap signed resolves must retain the existing durable pending record",
  );
  assert.match(
    action,
    /await reserveBootstrapKeeperDailyBudget\(\{[\s\S]*signerAddress: account\.address,[\s\S]*nonce: latestNonce,[\s\S]*epoch: currentEpoch,[\s\S]*signingIntentHash,[\s\S]*reservedMaxCostWei: requiredMaxCost,[\s\S]*policy: BOOTSTRAP_KEEPER_DAILY_BUDGET_POLICY/,
    "bootstrap reservation must bind the signer, nonce, epoch, intent, and maximum cost to the clamped policy",
  );
  assert.doesNotMatch(
    action,
    /releaseKeeperDailyBudget/,
    "bootstrap pending maximum cost must remain conservatively charged",
  );

  const routePrefix = source.slice(0, source.indexOf("getBootstrapAgreementClients()"));
  assert.match(
    routePrefix,
    /assertBootstrapKeeperBudgetReady\(\)/,
    "multi-replica shared budget configuration must fail closed before chain RPC",
  );
  const sharedSource = readFileSync(
    join(REPO_ROOT, "app/api/bootstrap-resolve/shared.ts"),
    "utf8",
  );
  assert.match(
    sharedSource,
    /requiresExternalSharedLock\(\)[\s\S]*reserveExternalKeeperDailyBudget\(input\)[\s\S]*reserveKeeperDailyBudget\(input\)/,
    "multi-replica bootstrap signing must use the shared external budget without changing the single-replica SQLite path",
  );
  const externalSource = readFileSync(
    join(REPO_ROOT, "app/api/_lib/externalRateLimit.ts"),
    "utf8",
  );
  assert.match(
    externalSource,
    /KEEPER_DAILY_BUDGET_SCRIPT[\s\S]*redis\.call\("TIME"\)[\s\S]*signature_exhausted[\s\S]*cost_exhausted[\s\S]*redis\.call\("HSET"[\s\S]*redis\.call\("PEXPIRE"/,
    "the shared count, cost, idempotency, and UTC-day mutation must remain one Redis EVAL",
  );
}

type FakeSharedBudgetState = {
  count: number;
  cost: bigint;
  reservations: Map<string, string>;
};

function createAtomicKeeperBudgetStore() {
  const states = new Map<string, FakeSharedBudgetState>();
  const seenKeys = new Set<string>();
  const fixedUtcDay = 20_675;
  const request = async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const command = JSON.parse(String(init?.body)) as string[];
    assert.equal(command[0], "EVAL");
    assert.equal(command[2], "1");
    assert.match(command[1], /redis\.call\("TIME"\)/);
    assert.match(command[1], /redis\.call\("HSET"/);
    const [, , , redisKey, reservationField, fingerprint, maxCountRaw, costRaw, maxCostRaw] = command;
    seenKeys.add(redisKey);
    const state = states.get(redisKey) ?? {
      count: 0,
      cost: 0n,
      reservations: new Map<string, string>(),
    };
    const maxCount = Number(maxCountRaw);
    const cost = BigInt(costRaw);
    const maxCost = BigInt(maxCostRaw);
    let result: string[];
    const existing = state.reservations.get(reservationField);
    if (state.count > maxCount || state.cost > maxCost) {
      result = ["stored_usage_exceeds"];
    } else if (existing !== undefined) {
      result = existing === fingerprint
        ? ["already_reserved", String(fixedUtcDay), String(state.count), state.cost.toString()]
        : ["reservation_conflict"];
    } else if (state.count >= maxCount) {
      result = ["signature_exhausted"];
    } else if (state.cost + cost > maxCost) {
      result = ["cost_exhausted"];
    } else {
      state.count += 1;
      state.cost += cost;
      state.reservations.set(reservationField, fingerprint);
      states.set(redisKey, state);
      result = ["reserved", String(fixedUtcDay), String(state.count), state.cost.toString()];
    }
    return new Response(JSON.stringify({ result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return {
    replicaA: request as typeof fetch,
    replicaB: request as typeof fetch,
    seenKeys,
  };
}

async function assertExternalReplicaAtomicity() {
  const previousUrl = process.env.UPSTASH_REDIS_REST_URL;
  const previousToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.UPSTASH_REDIS_REST_URL = "https://upstash.playlore.xyz";
  process.env.UPSTASH_REDIS_REST_TOKEN = "synthetic-test-token";
  try {
    const store = createAtomicKeeperBudgetStore();
    const reserve = (nonce: number, hashSequence: number, fetchImpl: typeof fetch) =>
      reserveExternalKeeperDailyBudget({
        chainId: CHAIN_ID,
        contractAddress: CONTRACT,
        signerAddress: SIGNER,
        nonce,
        epoch: BigInt(1_000 + nonce),
        signingIntentHash: intentHash(hashSequence),
        reservedMaxCostWei: 30n,
        policy: { maxSignatures: 10, maxReservedCostWei: 100n },
      }, fetchImpl);

    const seeded = await reserve(1, 1, store.replicaA);
    assert.equal(seeded.status, "reserved");
    const seededTwice = await reserveExternalKeeperDailyBudget({
      chainId: CHAIN_ID,
      contractAddress: CONTRACT,
      signerAddress: SIGNER,
      nonce: 2,
      epoch: 1_002n,
      signingIntentHash: intentHash(2),
      reservedMaxCostWei: 40n,
      policy: { maxSignatures: 10, maxReservedCostWei: 100n },
    }, store.replicaB);
    assert.equal(seededTwice.reservedMaxCostWei, 70n);

    const race = await Promise.allSettled([
      reserve(3, 3, store.replicaA),
      reserve(4, 4, store.replicaB),
    ]);
    assert.equal(
      race.filter((result) => result.status === "fulfilled").length,
      1,
      "only one web replica may consume the final shared daily cost slot",
    );
    assert.equal(race.filter((result) => result.status === "rejected").length, 1);
    assert.match(
      String((race.find((result) => result.status === "rejected") as PromiseRejectedResult).reason),
      /reserved cost exhausted/i,
    );
    assert.equal(store.seenKeys.size, 1, "all replicas must derive one shared chain/contract budget key");

    const winnerNonce = race[0].status === "fulfilled" ? 3 : 4;
    const winnerHash = race[0].status === "fulfilled" ? 3 : 4;
    const idempotent = await reserve(winnerNonce, winnerHash, store.replicaB);
    assert.equal(idempotent.status, "already_reserved");
    await assert.rejects(
      reserve(winnerNonce, 99, store.replicaA),
      /reservation conflict/i,
      "a nonce reused for a different intent must fail closed across replicas",
    );

    const reserveSignature = (nonce: number, fetchImpl: typeof fetch) =>
      reserveExternalKeeperDailyBudget({
        chainId: CHAIN_ID,
        contractAddress: OTHER_CONTRACT,
        signerAddress: SIGNER,
        nonce,
        epoch: BigInt(2_000 + nonce),
        signingIntentHash: intentHash(nonce),
        reservedMaxCostWei: 1n,
        policy: { maxSignatures: 1, maxReservedCostWei: 100n },
      }, fetchImpl);
    const signatureRace = await Promise.allSettled([
      reserveSignature(20, store.replicaA),
      reserveSignature(21, store.replicaB),
    ]);
    assert.equal(signatureRace.filter((result) => result.status === "fulfilled").length, 1);
    assert.match(
      String((signatureRace.find((result) => result.status === "rejected") as PromiseRejectedResult).reason),
      /signature count exhausted/i,
      "replica routing must not multiply the shared signature ceiling",
    );

    const forgedSuccessFetch = (async () => new Response(JSON.stringify({
      result: ["reserved", "20675", "11", "101"],
    }), { status: 200 })) as typeof fetch;
    await assert.rejects(
      reserve(30, 30, forgedSuccessFetch),
      /invalid reservation counters/i,
      "out-of-policy external counters must fail closed even when labeled reserved",
    );

    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    await assert.rejects(
      reserve(9, 9, store.replicaA),
      /store is not configured/i,
      "multi-replica budget must not fall back when the shared store is unavailable",
    );
  } finally {
    if (previousUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = previousUrl;
    if (previousToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = previousToken;
  }
}

async function runTest() {
  assertPolicyClamp();
  assertBotReservationOrdering();
  assertBootstrapReservationOrdering();
  await assertExternalReplicaAtomicity();

  const testDir = mkdtempSync(join(tmpdir(), "lore-keeper-daily-budget-"));
  const dbPath = join(testDir, "budget.sqlite");
  const workers: WorkerHarness[] = [];
  try {
    const first = await startWorker(dbPath);
    workers.push(first.harness);
    assert.equal(first.ready.scope, `sepolia:${CONTRACT}`);
    const firstReservation = await sendWorkerCommand(first.harness, reserveCommand({
      nonce: 1,
      costWei: 30n,
      hashSequence: 1,
    }));
    assert.equal(firstReservation.ok, true);
    assert.equal(firstReservation.status, "reserved");
    assert.equal(firstReservation.reservedSignatureCount, 1);
    assert.equal(firstReservation.reservedMaxCostWei, "30");

    await stopWorker(first.harness);
    const restarted = await startWorker(dbPath);
    workers.push(restarted.harness);
    const afterRestart = await sendWorkerCommand(restarted.harness, reserveCommand({
      nonce: 2,
      costWei: 30n,
      hashSequence: 2,
    }));
    assert.equal(afterRestart.ok, true);
    assert.equal(afterRestart.reservedSignatureCount, 2, "restart must retain the first reservation");
    assert.equal(afterRestart.reservedMaxCostWei, "60");

    const replica = await startWorker(dbPath);
    workers.push(replica.harness);
    const [raceA, raceB] = await Promise.all([
      sendWorkerCommand(restarted.harness, reserveCommand({ nonce: 3, costWei: 30n, hashSequence: 3 })),
      sendWorkerCommand(replica.harness, reserveCommand({ nonce: 4, costWei: 30n, hashSequence: 4 })),
    ]);
    assert.equal([raceA, raceB].filter((result) => result.ok).length, 1, "only one replica may consume the final cost slot");
    assert.equal([raceA, raceB].filter((result) => !result.ok).length, 1);
    assert.match([raceA, raceB].find((result) => !result.ok)?.error ?? "", /reserved cost.*exhausted/i);

    const idempotent = await sendWorkerCommand(restarted.harness, reserveCommand({
      nonce: 2,
      costWei: 30n,
      hashSequence: 2,
    }));
    assert.equal(idempotent.ok, true);
    assert.equal(idempotent.status, "already_reserved");
    assert.equal(idempotent.reservedSignatureCount, 3);
    assert.equal(idempotent.reservedMaxCostWei, "90");

    const conflictingIntent = await sendWorkerCommand(restarted.harness, reserveCommand({
      nonce: 2,
      costWei: 30n,
      hashSequence: 99,
    }));
    assert.equal(conflictingIntent.ok, false);
    assert.match(conflictingIntent.error ?? "", /reservation conflict/i);

    const tightenedBelowUsage = await sendWorkerCommand(restarted.harness, reserveCommand({
      nonce: 2,
      costWei: 30n,
      hashSequence: 2,
      maxCostWei: 80n,
    }));
    assert.equal(tightenedBelowUsage.ok, false, "a newly tightened operator limit must fail closed");
    assert.match(tightenedBelowUsage.error ?? "", /stored usage exceeds/i);

    const nextDay = await sendWorkerCommand(restarted.harness, reserveCommand({
      nonce: 5,
      costWei: 30n,
      hashSequence: 5,
      nowMs: TEST_NOW_MS + DAY_MS,
    }));
    assert.equal(nextDay.ok, true);
    assert.equal(nextDay.reservedSignatureCount, 1, "a new UTC day must receive an independent bounded window");

    const otherScope = await startWorker(dbPath, OTHER_CONTRACT);
    workers.push(otherScope.harness);
    assert.equal(otherScope.ready.scope, `sepolia:${OTHER_CONTRACT}`);
    const otherScopeReservation = await sendWorkerCommand(otherScope.harness, {
      ...reserveCommand({ nonce: 1, costWei: 100n, hashSequence: 6 }),
      contractAddress: OTHER_CONTRACT,
    });
    assert.equal(otherScopeReservation.ok, true, "contract scope must isolate circuit-breaker windows");

    const signatureDay = TEST_NOW_MS + 2 * DAY_MS;
    for (const nonce of [10, 11]) {
      const allowed = await sendWorkerCommand(restarted.harness, reserveCommand({
        nonce,
        costWei: 1n,
        hashSequence: nonce,
        nowMs: signatureDay,
        maxSignatures: 2,
        maxCostWei: 1_000n,
      }));
      assert.equal(allowed.ok, true);
    }
    const dustFlood = await sendWorkerCommand(restarted.harness, reserveCommand({
      nonce: 12,
      costWei: 1n,
      hashSequence: 12,
      nowMs: signatureDay,
      maxSignatures: 2,
      maxCostWei: 1_000n,
    }));
    assert.equal(dustFlood.ok, false, "dust-funded epochs must stop at the signature circuit breaker");
    assert.match(dustFlood.error ?? "", /signature count.*exhausted/i);

    const corruptDay = TEST_NOW_MS + 3 * DAY_MS;
    const corrupted = await sendWorkerCommand(restarted.harness, {
      id: randomUUID(),
      op: "corrupt",
      chainId: CHAIN_ID,
      contractAddress: CONTRACT,
      nowMs: corruptDay,
    });
    assert.equal(corrupted.ok, true);
    const corruptAttempt = await sendWorkerCommand(restarted.harness, reserveCommand({
      nonce: 20,
      costWei: 1n,
      hashSequence: 20,
      nowMs: corruptDay,
    }));
    assert.equal(corruptAttempt.ok, false);
    assert.match(corruptAttempt.error ?? "", /state invalid.*manual reconciliation/i);

    console.log(JSON.stringify({
      status: "pass",
      safeDefaultsClamped: true,
      reservationBeforeSigning: true,
      bootstrapReservationBeforeSigning: true,
      externalReplicaAtomicity: true,
      restartPersistence: true,
      replicaAtomicity: true,
      costBudgetBounded: true,
      signatureBudgetBounded: true,
      pendingChargedConservatively: true,
      malformedStateFailsClosed: true,
    }));
  } finally {
    for (const worker of workers.reverse()) {
      await stopWorker(worker).catch(() => worker.child.kill());
    }
    rmSync(testDir, { recursive: true, force: true });
  }
}

if (process.argv.includes("--keeper-budget-worker")) {
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
