import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  createReadStream,
  readFileSync,
  renameSync,
  rmSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const ROOT = process.cwd();
const OUT_DIR = resolve(process.env.SOAK_OUT_DIR || join(".tmp", "testnet-soak"));
const STATUS_PATH = join(OUT_DIR, "status.json");
const STATUS_TMP_PATH = `${STATUS_PATH}.tmp`;
const LOCK_PATH = join(OUT_DIR, "supervisor.lock");
const SERVER_LOG_PATH = join(OUT_DIR, "server.log");
const CANARY_LOG_PATH = join(OUT_DIR, "canary.log");
const PORT = parseInteger("SOAK_PORT", 3011, 1024, 65_535);
const DRY_RUN = process.env.SOAK_DRY_RUN === "1" || process.argv.includes("--dry-run");
const STATUS_ONLY = process.argv.includes("--status");
const STOP_ONLY = process.argv.includes("--stop");
const STARTED_AT = new Date().toISOString();
const HEALTH_SECRET = randomBytes(32).toString("hex");
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SERVER_READY_TIMEOUT_MS = parseInteger("SOAK_SERVER_READY_TIMEOUT_MS", 60_000, 5_000, 300_000);
const SLOW_SEND_THRESHOLD_MS = 20_000;
const MIN_DISK_FREE_BYTES = parseInteger("SOAK_MIN_DISK_FREE_BYTES", 1_073_741_824, 1, Number.MAX_SAFE_INTEGER);

let server = null;
let canary = null;
let stopping = false;
let managedRunStarted = false;

function parseInteger(name, fallbackValue, min, max) {
  const raw = process.env[name];
  if (!raw) return fallbackValue;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer in [${min}, ${max}]`);
  }
  return parsed;
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function assertDiskCapacity() {
  let capacityPath = OUT_DIR;
  while (!existsSync(capacityPath)) {
    const parent = dirname(capacityPath);
    if (parent === capacityPath) throw new Error("testnet soak artifact volume is unavailable");
    capacityPath = parent;
  }
  const stats = statfsSync(capacityPath, { bigint: true });
  if (stats.bavail * stats.bsize < BigInt(MIN_DISK_FREE_BYTES)) {
    throw new Error(`testnet soak requires at least ${MIN_DISK_FREE_BYTES} free bytes`);
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function numericSummary(values) {
  if (values.length === 0) return { samples: 0, p50: null, p95: null, p99: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (value) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)];
  return {
    samples: sorted.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: sorted[sorted.length - 1],
  };
}

function growthSummary(values) {
  if (values.length === 0) return { samples: 0, first: null, min: null, max: null, delta: null };
  return {
    samples: values.length,
    first: values[0],
    min: Math.min(...values),
    max: Math.max(...values),
    delta: values[values.length - 1] - values[0],
  };
}

async function summarizeLiveLog(path) {
  const summary = {
    successfulBets: 0,
    failedBets: 0,
    uniqueEpochs: 0,
    uniqueTxHashes: 0,
    duplicateTxHashes: 0,
    uniqueNonces: 0,
    duplicateNonces: 0,
    revertedTransactions: 0,
    healthSamples: 0,
    healthFailures: 0,
    healthRetries: 0,
    rpcFailoverInjectionEvents: 0,
    resolverFallbacks: 0,
    slowSendCount: 0,
    malformedLines: 0,
    lastEventAt: null,
    latencyMs: null,
    phaseLatencyMs: null,
    healthGrowth: null,
  };
  if (!path || !existsSync(path)) return summary;
  const epochs = new Set();
  const txHashes = new Set();
  const nonces = new Set();
  const latencies = [];
  const phaseLatencies = { prepareMs: [], estimateGasMs: [], nonceReadMs: [], sendMs: [], receiptMs: [] };
  const healthMetrics = { rssBytes: [], heapUsedBytes: [], dbBytes: [], walBytes: [], diskFreeBytes: [] };
  const betModes = new Set(["single", "bitmap", "sameAmount", "arrays"]);
  const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      summary.malformedLines += 1;
      continue;
    }
    if (typeof event.timestamp === "string" && Number.isFinite(Date.parse(event.timestamp))) {
      summary.lastEventAt = event.timestamp;
    }
    if (event.mode === "diagnostic" && event.sampleKind === "health") {
      if (Number.isSafeInteger(event.healthRetryCount) && event.healthRetryCount > 0) {
        summary.healthRetries += event.healthRetryCount;
      }
      if (event.ok === true) {
        summary.healthSamples += 1;
        for (const key of Object.keys(healthMetrics)) {
          if (Number.isFinite(event[key]) && event[key] >= 0) healthMetrics[key].push(event[key]);
        }
      }
      else summary.healthFailures += 1;
    }
    if (event.rpcFailoverInjected === true) summary.rpcFailoverInjectionEvents += 1;
    if (event.mode === "resolve" && event.ok === true && event.resolverFallbackUsed === true) {
      summary.resolverFallbacks += 1;
    }
    if (event.txStatus === "reverted") summary.revertedTransactions += 1;
    if (!betModes.has(event.mode) || !Number.isInteger(event.round)) continue;
    if (event.ok !== true || event.txStatus !== "success") {
      summary.failedBets += 1;
      continue;
    }
    summary.successfulBets += 1;
    if (Number.isFinite(event.durationMs) && event.durationMs >= 0) latencies.push(event.durationMs);
    for (const key of Object.keys(phaseLatencies)) {
      if (Number.isFinite(event[key]) && event[key] >= 0) phaseLatencies[key].push(event[key]);
    }
    if (Number.isFinite(event.sendMs) && event.sendMs >= SLOW_SEND_THRESHOLD_MS) {
      summary.slowSendCount += 1;
    }
    if (event.epoch != null) epochs.add(String(event.epoch));
    if (typeof event.hash === "string") {
      if (txHashes.has(event.hash)) summary.duplicateTxHashes += 1;
      txHashes.add(event.hash);
    }
    if (Number.isSafeInteger(event.noncePending) && event.role) {
      const nonceKey = `${event.role}:${event.noncePending}`;
      if (nonces.has(nonceKey)) summary.duplicateNonces += 1;
      nonces.add(nonceKey);
    }
  }
  summary.uniqueEpochs = epochs.size;
  summary.uniqueTxHashes = txHashes.size;
  summary.uniqueNonces = nonces.size;
  summary.latencyMs = numericSummary(latencies);
  summary.phaseLatencyMs = Object.fromEntries(
    Object.entries(phaseLatencies).map(([key, values]) => [key, numericSummary(values)]),
  );
  summary.healthGrowth = Object.fromEntries(
    Object.entries(healthMetrics).map(([key, values]) => [key, growthSummary(values)]),
  );
  return summary;
}

async function printSafeStatus() {
  const status = readJson(STATUS_PATH);
  const lock = readJson(LOCK_PATH);
  const supervisorPid = Number(status?.supervisorPid);
  const lockMatches = Number(lock?.pid) === supervisorPid && lock?.startedAt === status?.startedAt;
  const liveLogPath = status?.artifacts?.liveLog || readLiveLogPath();
  const progress = await summarizeLiveLog(liveLogPath);
  const lastEventMs = progress.lastEventAt ? Date.parse(progress.lastEventAt) : NaN;
  console.log(JSON.stringify({
    status: status?.status || "not-started",
    dryRun: status?.dryRun ?? null,
    startedAt: status?.startedAt || null,
    finishedAt: status?.finishedAt || null,
    exitCode: status?.exitCode ?? null,
    stopReason: status?.stopReason || null,
    supervisorAlive: lockMatches && processIsAlive(supervisorPid),
    hasLiveLog: Boolean(liveLogPath),
    secondsSinceLastEvent: Number.isFinite(lastEventMs)
      ? Math.max(0, Math.floor((Date.now() - lastEventMs) / 1000))
      : null,
    progress,
  }, null, 2));
}

function finalizeStoppedStatus(status) {
  const latest = readJson(STATUS_PATH) || status;
  if (["starting", "server-starting", "running"].includes(latest?.status)) {
    const payload = {
      ...latest,
      status: "stopped",
      finishedAt: new Date().toISOString(),
      exitCode: 1,
      stopReason: "operator-stop",
    };
    writeFileSync(STATUS_TMP_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    renameSync(STATUS_TMP_PATH, STATUS_PATH);
  }
  rmSync(LOCK_PATH, { force: true });
}

async function stopManagedSupervisor() {
  const status = readJson(STATUS_PATH);
  const lock = readJson(LOCK_PATH);
  const supervisorPid = Number(status?.supervisorPid);
  const lockMatches = Number(lock?.pid) === supervisorPid && lock?.startedAt === status?.startedAt;
  if (!lockMatches) {
    console.log("[testnet-soak] no managed supervisor is running");
    return;
  }
  if (!processIsAlive(supervisorPid)) {
    finalizeStoppedStatus(status);
    console.log("[testnet-soak] stale stopped status repaired");
    return;
  }
  process.kill(supervisorPid, "SIGTERM");
  const deadline = Date.now() + 5_000;
  while (processIsAlive(supervisorPid) && Date.now() < deadline) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  if (processIsAlive(supervisorPid)) throw new Error("managed supervisor did not stop within 5000ms");
  finalizeStoppedStatus(status);
  console.log("[testnet-soak] stop requested");
}

function acquireLock() {
  mkdirSync(OUT_DIR, { recursive: true });
  if (existsSync(LOCK_PATH)) {
    let previousPid = 0;
    try {
      previousPid = Number(JSON.parse(readFileSync(LOCK_PATH, "utf8")).pid);
    } catch {
      previousPid = 0;
    }
    if (processIsAlive(previousPid)) throw new Error(`testnet soak supervisor is already running (pid ${previousPid})`);
    rmSync(LOCK_PATH, { force: true });
  }
  const handle = openSync(LOCK_PATH, "wx");
  writeFileSync(handle, JSON.stringify({ pid: process.pid, startedAt: STARTED_AT }));
  closeSync(handle);
  writeFileSync(SERVER_LOG_PATH, "", "utf8");
  writeFileSync(CANARY_LOG_PATH, "", "utf8");
}

function readLiveLogPath() {
  try {
    return readFileSync(CANARY_LOG_PATH, "utf8").match(/^\[live-canary\] log=(.+)$/m)?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

function writeStatus(status, extra = {}) {
  const payload = {
    status,
    dryRun: DRY_RUN,
    startedAt: STARTED_AT,
    supervisorPid: process.pid,
    serverPid: server?.pid ?? null,
    canaryPid: canary?.pid ?? null,
    artifacts: {
      canaryLog: CANARY_LOG_PATH,
      liveLog: readLiveLogPath(),
      serverLog: SERVER_LOG_PATH,
    },
    ...extra,
  };
  writeFileSync(STATUS_TMP_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  renameSync(STATUS_TMP_PATH, STATUS_PATH);
}

function spawnLogged(command, args, env, logPath) {
  const logHandle = openSync(logPath, "a");
  const child = spawn(command, args, {
    cwd: ROOT,
    env,
    stdio: ["ignore", logHandle, logHandle],
    windowsHide: true,
  });
  closeSync(logHandle);
  return child;
}

async function waitForExit(child) {
  return new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
}

async function waitForServer() {
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server?.exitCode != null) throw new Error(`production server exited before health readiness (${server.exitCode})`);
    try {
      const response = await fetch(`${BASE_URL}/api/health/runtime`, {
        headers: { "x-health-diagnostics-secret": HEALTH_SECRET },
        signal: AbortSignal.timeout(3_000),
      });
      if (response.ok) return;
    } catch {
      // Startup connection failures are expected until Next binds the port.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error(`production server did not become healthy within ${SERVER_READY_TIMEOUT_MS}ms`);
}

function stopChild(child) {
  if (!child || child.exitCode != null || child.killed) return;
  child.kill("SIGTERM");
}

async function shutdown(stopReason, exitCode) {
  if (stopping) return;
  stopping = true;
  stopChild(canary);
  stopChild(server);
  writeStatus(exitCode === 0 ? "completed" : "failed", {
    finishedAt: new Date().toISOString(),
    exitCode,
    stopReason,
  });
  rmSync(LOCK_PATH, { force: true });
}

async function main() {
  assertDiskCapacity();
  acquireLock();
  managedRunStarted = true;
  writeStatus("starting");

  const sharedEnv = {
    ...process.env,
    ALLOW_WEAK_RATE_LIMIT_IDENTITY: "1",
    HEALTH_DIAGNOSTICS_SECRET: HEALTH_SECRET,
  };
  server = spawnLogged(
    process.execPath,
    [join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "--port", String(PORT)],
    sharedEnv,
    SERVER_LOG_PATH,
  );
  writeStatus("server-starting");
  await waitForServer();

  const canaryEnv = {
    ...sharedEnv,
    LIVE_CANARY_RPC_LABEL: process.env.LIVE_CANARY_RPC_LABEL || "local-production-like-sepolia",
    LIVE_TEST_DRY_RUN: DRY_RUN ? "1" : "0",
    LIVE_TEST_HEALTH_BASE_URL: BASE_URL,
    LIVE_TEST_HEALTH_SAMPLE_EVERY_ROUNDS: process.env.LIVE_TEST_HEALTH_SAMPLE_EVERY_ROUNDS || "5",
    LIVE_TEST_INJECT_RPC_FAILOVER: "1",
    LIVE_TEST_MAX_TILES_PER_ROUND: process.env.LIVE_TEST_MAX_TILES_PER_ROUND || "25",
    LIVE_TEST_MAX_TOTAL_BET_AMOUNT: process.env.LIVE_TEST_MAX_TOTAL_BET_AMOUNT || "0.05",
    LIVE_TEST_MIN_TILES_PER_ROUND: process.env.LIVE_TEST_MIN_TILES_PER_ROUND || "1",
    LIVE_TEST_MIN_TOTAL_BET_AMOUNT: process.env.LIVE_TEST_MIN_TOTAL_BET_AMOUNT || "0.01",
    LIVE_TEST_RANDOMIZE_ROUNDS: "1",
    LIVE_TEST_TARGET_ROUNDS: DRY_RUN ? "1" : (process.env.LIVE_TEST_TARGET_ROUNDS || "1440"),
  };
  canary = spawnLogged(
    process.execPath,
    [join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), "scripts/live-round-canary.ts"],
    canaryEnv,
    CANARY_LOG_PATH,
  );
  writeStatus("running");
  const result = await waitForExit(canary);
  const success = result.code === 0;
  await shutdown(success ? (DRY_RUN ? "dry-run-complete" : "canary-complete") : `canary-${result.signal || result.code}`, success ? 0 : 1);
  process.exitCode = success ? 0 : 1;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void shutdown(`supervisor-${signal.toLowerCase()}`, 1).finally(() => {
      process.exitCode = 1;
    });
  });
}

if (STATUS_ONLY) {
  printSafeStatus().catch((error) => {
    console.error(`[testnet-soak] status failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
} else if (STOP_ONLY) {
  stopManagedSupervisor().catch((error) => {
    console.error(`[testnet-soak] stop failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
} else main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (managedRunStarted) await shutdown(message, 1);
  console.error(`[testnet-soak] ${message}`);
  process.exitCode = 1;
});
