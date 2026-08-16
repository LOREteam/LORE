import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  createReadStream,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import { redactProofText } from "./redact-proof-output.mjs";
import {
  parseProcessStartToken,
  readProcessStartIdentity,
  verifyProcessStartIdentity,
} from "./process-start-identity.mjs";

const ROOT = process.cwd();
const OUT_DIR = resolve(process.env.SOAK_OUT_DIR || join(".tmp", "testnet-soak"));
const STATUS_PATH = join(OUT_DIR, "status.json");
const STATUS_TMP_PATH = `${STATUS_PATH}.tmp`;
const LOCK_PATH = join(OUT_DIR, "supervisor.lock");
const STOP_PATH = join(OUT_DIR, "supervisor.stop");
const SERVER_LOG_PATH = join(OUT_DIR, "server.log");
const CANARY_LOG_PATH = join(OUT_DIR, "canary.log");
const DECIMAL_INTEGER_RE = /^(?:0|[1-9]\d{0,15})$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const PORT = parseInteger("SOAK_PORT", 3011, 1024, 65_535);
const LIVE_EXECUTION_CONFIRMED = liveExecutionConfirmed(process.env, process.argv);
const DRY_RUN = !LIVE_EXECUTION_CONFIRMED;
const STATUS_ONLY = process.argv.includes("--status");
const STATUS_SUMMARY_ONLY = process.argv.includes("--summary-only");
const STATUS_COMPACT_ONLY = process.argv.includes("--compact");
const STOP_ONLY = process.argv.includes("--stop");
const BEHAVIOR_SELF_TEST = process.argv.includes("--behavior-self-test");
const BEHAVIOR_SELF_TEST_SECRET_FAULT = process.argv.includes("--self-test-secret-fault");
const STARTED_AT = new Date().toISOString();
const HEALTH_SECRET = randomBytes(32).toString("hex");
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SERVER_READY_TIMEOUT_MS = parseInteger("SOAK_SERVER_READY_TIMEOUT_MS", 60_000, 5_000, 300_000);
const DISK_CAPACITY_CHECK_INTERVAL_MS = parseInteger("SOAK_DISK_CHECK_INTERVAL_MS", 30_000, 1_000, 300_000);
const SLOW_SEND_THRESHOLD_MS = 20_000;
const MIN_DISK_FREE_BYTES = parseInteger("SOAK_MIN_DISK_FREE_BYTES", 1_073_741_824, 1, Number.MAX_SAFE_INTEGER);
const LIVE_LOG_MARKER_SCAN_BYTES = 64 * 1024;
const MAX_SOAK_SUPERVISOR_ERROR_CHARS = 500;
const MAX_SOAK_STATUS_JSON_BYTES = 128 * 1024;
const MAX_SOAK_LOCK_JSON_BYTES = 4 * 1024;
const MAX_SOAK_STOP_JSON_BYTES = 4 * 1024;
const TRACKED_PID_RE = /^[1-9]\d{0,9}$/;
const MAX_TRACKED_PID = 2_147_483_647;
const MAX_TRACKED_PID_BIGINT = BigInt(MAX_TRACKED_PID);
const SAFE_BET_ERROR_KINDS = new Set([
  "already-known",
  "already-resolved",
  "contract-revert",
  "epoch-window",
  "estimate-method-unsupported",
  "estimate-out-of-gas",
  "insufficient-funds",
  "insufficient-allowance",
  "insufficient-balance",
  "late-bet",
  "network",
  "nonce-too-low",
  "pending-nonce-blocked",
  "receipt-timeout",
  "replacement-underpriced",
  "timer-not-ended",
  "revert",
  "tx-reverted",
  "user-rejected",
]);
const SAFE_SOAK_ROLES = new Set(["MANUAL", "AUTOMINER_A", "AUTOMINER_B", "AUTOMINER_C"]);

let server = null;
let canary = null;
let stopping = false;
let managedRunStarted = false;
let supervisorStartToken = null;

function liveExecutionConfirmed(env, argv) {
  return env.SOAK_EXECUTE_LIVE === "1" && argv.includes("--execute-live");
}

function describeSupervisorError(error) {
  const text = redactProofText(error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= MAX_SOAK_SUPERVISOR_ERROR_CHARS) return text;
  return `${text.slice(0, MAX_SOAK_SUPERVISOR_ERROR_CHARS - 15)}...<truncated>`;
}

function parseInteger(name, fallbackValue, min, max) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallbackValue;
  if (!DECIMAL_INTEGER_RE.test(raw)) {
    throw new Error(`${name} must be a canonical decimal integer in [${min}, ${max}]`);
  }
  const parsed = BigInt(raw);
  if (parsed > MAX_SAFE_INTEGER_BIGINT || parsed < BigInt(min) || parsed > BigInt(max)) {
    throw new Error(`${name} must be a canonical decimal integer in [${min}, ${max}]`);
  }
  return Number(parsed);
}

function parseTrackedPid(value) {
  const raw = String(value ?? "").trim();
  if (!TRACKED_PID_RE.test(raw)) return null;
  const pid = BigInt(raw);
  return pid <= MAX_TRACKED_PID_BIGINT ? Number(pid) : null;
}

function matchingSupervisorIdentity(status, lock) {
  const supervisorPid = parseTrackedPid(status?.supervisorPid);
  const lockPid = parseTrackedPid(lock?.pid);
  const statusStartedAt = typeof status?.startedAt === "string" ? status.startedAt : null;
  const lockStartedAt = typeof lock?.startedAt === "string" ? lock.startedAt : null;
  const statusStartToken = parseProcessStartToken(status?.supervisorStartToken);
  const lockStartToken = parseProcessStartToken(lock?.supervisorStartToken);
  if (supervisorPid === null || lockPid === null || supervisorPid !== lockPid) return null;
  if (!statusStartedAt || !lockStartedAt || statusStartedAt !== lockStartedAt) return null;
  if (!statusStartToken || !lockStartToken || statusStartToken !== lockStartToken) return null;
  return { pid: supervisorPid, startToken: statusStartToken };
}

function bigIntToNonNegativeSafeInteger(value) {
  if (typeof value !== "bigint" || value <= 0n) return 0;
  return value > MAX_SAFE_INTEGER_BIGINT ? Number.MAX_SAFE_INTEGER : Number(value);
}

function findDiskCapacityPath() {
  let capacityPath = OUT_DIR;
  while (!existsSync(capacityPath)) {
    const parent = dirname(capacityPath);
    if (parent === capacityPath) throw new Error("testnet soak artifact volume is unavailable");
    capacityPath = parent;
  }
  return capacityPath;
}

function readDiskCapacity() {
  const stats = statfsSync(findDiskCapacityPath(), { bigint: true });
  const freeBytes = stats.bavail * stats.bsize;
  return {
    diskCapacityAvailable: true,
    diskFreeBytesNow: bigIntToNonNegativeSafeInteger(freeBytes),
    diskFreeBelowMinimum: freeBytes < BigInt(MIN_DISK_FREE_BYTES),
    diskFreeMinimumBytes: MIN_DISK_FREE_BYTES,
  };
}

function readDiskCapacitySummary() {
  try {
    return readDiskCapacity();
  } catch {
    return {
      diskCapacityAvailable: false,
      diskFreeBytesNow: null,
      diskFreeBelowMinimum: null,
      diskFreeMinimumBytes: MIN_DISK_FREE_BYTES,
    };
  }
}

function assertDiskCapacity() {
  const capacity = readDiskCapacity();
  if (capacity.diskFreeBelowMinimum) {
    throw new Error(`testnet soak requires at least ${MIN_DISK_FREE_BYTES} free bytes`);
  }
}

function readJson(path, maxBytes = MAX_SOAK_STATUS_JSON_BYTES) {
  try {
    const stats = statSync(path);
    if (!stats.isFile() || stats.size > maxBytes) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function fileExists(path) {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function removeLockFile() {
  if (fileExists(LOCK_PATH)) rmSync(LOCK_PATH, { force: true });
}

function removeStopFile() {
  if (fileExists(STOP_PATH)) rmSync(STOP_PATH, { force: true });
}

function writeStopRequest(identity) {
  if (existsSync(STOP_PATH)) {
    if (!fileExists(STOP_PATH)) {
      throw new Error("testnet soak stop request path exists but is not a file");
    }
    const existing = readJson(STOP_PATH, MAX_SOAK_STOP_JSON_BYTES);
    if (
      parseTrackedPid(existing?.pid) === identity.pid &&
      parseProcessStartToken(existing?.supervisorStartToken) === identity.startToken
    ) return;
    throw new Error("testnet soak stop request is ambiguous; refusing to replace it");
  }
  writeFileSync(STOP_PATH, `${JSON.stringify({
    pid: identity.pid,
    supervisorStartToken: identity.startToken,
    requestedAt: new Date().toISOString(),
  })}\n`, { encoding: "utf8", flag: "wx" });
}

function managedStopRequested() {
  if (!supervisorStartToken) return false;
  const request = readJson(STOP_PATH, MAX_SOAK_STOP_JSON_BYTES);
  return (
    parseTrackedPid(request?.pid) === process.pid &&
    parseProcessStartToken(request?.supervisorStartToken) === supervisorStartToken
  );
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

function hasMetricSamples(metric) {
  return Number.isSafeInteger(metric?.samples) && metric.samples > 0;
}

function compactStatusProgress(current) {
  const progress = {
    successfulBets: current.successfulBets,
    epochBoundBets: current.epochBoundBets,
    epochUnboundBets: current.epochUnboundBets,
    successfulBetRoles: current.successfulBetRoles,
    failedBets: current.failedBets,
    failedBetRoles: current.failedBetRoles,
    failedBetErrorKinds: current.failedBetErrorKinds,
    failedBetFamilies: current.failedBetFamilies,
    failedBetModes: current.failedBetModes,
    failedBetStages: current.failedBetStages,
    maxConsecutiveFailedBetsByRole: current.maxConsecutiveFailedBetsByRole,
    uniqueEpochs: current.uniqueEpochs,
    uniqueTxHashes: current.uniqueTxHashes,
    duplicateTxHashes: current.duplicateTxHashes,
    uniqueNonces: current.uniqueNonces,
    duplicateNonces: current.duplicateNonces,
    revertedTransactions: current.revertedTransactions,
    healthFailures: current.healthFailures,
    healthRetries: current.healthRetries,
    estimateGasRetries: current.estimateGasRetries,
    rpcFailoverInjectionEvents: current.rpcFailoverInjectionEvents,
    resolverFallbacks: current.resolverFallbacks,
    slowSendCount: current.slowSendCount,
    preflightFailures: current.preflightFailures,
  };
  if (hasMetricSamples(current.latencyMs)) progress.latencyMs = current.latencyMs;
  const activeGrowth = Object.fromEntries(
    Object.entries(current.healthGrowth ?? {}).filter(([, metric]) => hasMetricSamples(metric)),
  );
  if (Object.keys(activeGrowth).length > 0) progress.healthGrowth = activeGrowth;
  return progress;
}

function formatStatusCounts(counts) {
  const entries = Object.entries(counts ?? {})
    .map(([key, count]) => [key, safePositiveStatusCount(count)])
    .filter(([, count]) => count !== null);
  if (entries.length === 0) return "none";
  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${String(key).replace(/[^A-Za-z0-9_-]+/g, "-")}=${count}`)
    .join(",");
}

function safePositiveStatusCount(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value === "bigint") return value > 0n && value <= MAX_SAFE_INTEGER_BIGINT ? Number(value) : null;
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!DECIMAL_INTEGER_RE.test(raw)) return null;
  const parsed = BigInt(raw);
  return parsed > 0n && parsed <= MAX_SAFE_INTEGER_BIGINT ? Number(parsed) : null;
}

function formatStatusMetric(value) {
  return Number.isFinite(value) ? String(value) : "n/a";
}

function formatCompactPreflightFailures(failures) {
  if (!Array.isArray(failures) || failures.length === 0) return "none";
  return failures
    .slice(0, 8)
    .map((failure) => {
      const role = SAFE_SOAK_ROLES.has(failure?.role) ? failure.role : "unknown";
      const reason = String(failure?.reason ?? "unknown").replace(/[^A-Za-z0-9_-]+/g, "-");
      return `${role}:${reason}`;
    })
    .join(",");
}

function compactSafeStatusLine(safeStatus) {
  const progress = compactStatusProgress(safeStatus.progress ?? {});
  return [
    `status=${safeStatus.status}`,
    `dry=${safeStatus.dryRun === true}`,
    `alive=${safeStatus.supervisorAlive === true}`,
    `stop=${String(safeStatus.stopReason ?? "none").replace(/[^A-Za-z0-9_-]+/g, "-")}`,
    `ok=${progress.successfulBets ?? 0}`,
    `bound=${progress.epochBoundBets ?? 0}`,
    `unbound=${progress.epochUnboundBets ?? 0}`,
    `fail=${progress.failedBets ?? 0}`,
    `roles=${formatStatusCounts(progress.successfulBetRoles)}/${formatStatusCounts(progress.failedBetRoles)}`,
    `epochs=${progress.uniqueEpochs ?? 0}`,
    `tx=${progress.uniqueTxHashes ?? 0}`,
    `nonces=${progress.uniqueNonces ?? 0}`,
    `dupTx=${progress.duplicateTxHashes ?? 0}`,
    `dupNonce=${progress.duplicateNonces ?? 0}`,
    `rev=${progress.revertedTransactions ?? 0}`,
    `health=${progress.healthFailures ?? 0}/${progress.healthRetries ?? 0}`,
    `rpc=${progress.rpcFailoverInjectionEvents ?? 0}`,
    `gas=${progress.estimateGasRetries ?? 0}`,
    `resolver=${progress.resolverFallbacks ?? 0}`,
    `slow=${progress.slowSendCount ?? 0}`,
    `p95=${formatStatusMetric(progress.latencyMs?.p95)}`,
    `diskLow=${safeStatus.diskCapacity?.diskFreeBelowMinimum === true}`,
    `diskFree=${formatStatusMetric(safeStatus.diskCapacity?.diskFreeBytesNow)}`,
    `preflight=${formatCompactPreflightFailures(progress.preflightFailures)}`,
    `fk=${formatStatusCounts(progress.failedBetErrorKinds)}`,
    `ff=${formatStatusCounts(progress.failedBetFamilies)}`,
  ].join(" ");
}

function classifyFailedBetFamily(event) {
  if (event.ok === true && event.txStatus !== "success") return "inconsistent-success-event";
  if (event.errorKind === "insufficient-allowance" || event.errorKind === "insufficient-balance" || event.errorKind === "insufficient-funds") return "funding";
  if (event.errorKind === "late-bet" || event.errorKind === "epoch-window" || event.errorKind === "already-resolved" || event.errorKind === "timer-not-ended") return "epoch-state";
  if (event.errorKind === "contract-revert") return "contract-call";
  if (event.errorKind === "network" || event.errorKind === "receipt-timeout") return "network";
  if (event.errorKind === "nonce-too-low" || event.errorKind === "already-known" || event.errorKind === "replacement-underpriced" || event.errorKind === "pending-nonce-blocked") return "nonce-state";
  if (typeof event.error !== "string") return "missing-error";
  const message = event.error.toLowerCase();
  if (message.includes("cannot read") || message.includes("is not a function")) return "runtime-type-error";
  if (message.includes("returned no data")) return "rpc-no-data";
  if (message.includes("contract function")) return "contract-call";
  if (message.includes("transaction execution")) return "transaction-execution";
  if (message.includes("rate limit") || message.includes("too many requests")) return "rate-limit";
  if (message.includes("http") || message.includes("rpc") || message.includes("connection") || message.includes("socket")) return "network";
  if (message.includes("epoch")) return "epoch-state";
  if (message.includes("gas")) return "gas";
  return "unknown";
}

async function summarizeLiveLog(path) {
  const summary = {
    successfulBets: 0,
    epochBoundBets: 0,
    epochUnboundBets: 0,
    successfulBetRoles: {},
    failedBets: 0,
    failedBetErrorKinds: {},
    failedBetFamilies: {},
    failedBetModes: {},
    failedBetRoles: {},
    consecutiveFailedBetsByRole: {},
    maxConsecutiveFailedBetsByRole: {},
    failedBetStages: {},
    uniqueEpochs: 0,
    uniqueTxHashes: 0,
    duplicateTxHashes: 0,
    uniqueNonces: 0,
    duplicateNonces: 0,
    revertedTransactions: 0,
    healthSamples: 0,
    healthFailures: 0,
    healthRetries: 0,
    estimateGasRetries: 0,
    rpcFailoverInjectionEvents: 0,
    resolverFallbacks: 0,
    slowSendCount: 0,
    preflightFailures: [],
    malformedLines: 0,
    lastEventAt: null,
    latencyMs: null,
    phaseLatencyMs: null,
    healthGrowth: null,
  };
  if (!path || !fileExists(path)) return summary;
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
    if (event.mode === "preflight" && event.ok === false) {
      const role = typeof event.role === "string" && /^[A-Z0-9_]{1,32}$/.test(event.role)
        ? event.role
        : "UNKNOWN";
      const reason = event.errorKind === "pending-nonce-blocked"
        ? "pending-nonce-blocked"
        : event.enoughEth === false && event.enoughToken === false
          ? "insufficient-native-and-token"
          : event.enoughEth === false
            ? "insufficient-native-gas"
            : event.enoughToken === false
              ? "insufficient-token"
              : "preflight-failed";
      if (!summary.preflightFailures.some((failure) => failure.role === role && failure.reason === reason)) {
        summary.preflightFailures.push({ role, reason });
      }
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
    if (Number.isSafeInteger(event.gasEstimateRetryCount) && event.gasEstimateRetryCount > 0) {
      summary.estimateGasRetries += event.gasEstimateRetryCount;
    }
    if (event.mode === "resolve" && event.ok === true && event.resolverFallbackUsed === true) {
      summary.resolverFallbacks += 1;
    }
    if (event.txStatus === "reverted") summary.revertedTransactions += 1;
    if (!betModes.has(event.mode) || !Number.isInteger(event.round)) continue;
    if (event.ok !== true || event.txStatus !== "success") {
      summary.failedBets += 1;
      const errorKind = SAFE_BET_ERROR_KINDS.has(event.errorKind) ? event.errorKind : "unknown";
      summary.failedBetErrorKinds[errorKind] = (summary.failedBetErrorKinds[errorKind] ?? 0) + 1;
      const errorFamily = classifyFailedBetFamily(event);
      summary.failedBetFamilies[errorFamily] = (summary.failedBetFamilies[errorFamily] ?? 0) + 1;
      summary.failedBetModes[event.mode] = (summary.failedBetModes[event.mode] ?? 0) + 1;
      const role = SAFE_SOAK_ROLES.has(event.role) ? event.role : "UNKNOWN";
      summary.failedBetRoles[role] = (summary.failedBetRoles[role] ?? 0) + 1;
      summary.consecutiveFailedBetsByRole[role] = (summary.consecutiveFailedBetsByRole[role] ?? 0) + 1;
      summary.maxConsecutiveFailedBetsByRole[role] = Math.max(
        summary.maxConsecutiveFailedBetsByRole[role] ?? 0,
        summary.consecutiveFailedBetsByRole[role],
      );
      const stage = event.txStatus === "reverted"
        ? "receipt-reverted"
        : typeof event.hash === "string" && /^0x[a-fA-F0-9]{64}$/.test(event.hash)
          ? "post-send-unconfirmed"
          : "pre-send";
      summary.failedBetStages[stage] = (summary.failedBetStages[stage] ?? 0) + 1;
      continue;
    }
    summary.successfulBets += 1;
    if (event.epochBound === true) summary.epochBoundBets += 1;
    else summary.epochUnboundBets += 1;
    const successRole = SAFE_SOAK_ROLES.has(event.role) ? event.role : "UNKNOWN";
    summary.successfulBetRoles[successRole] = (summary.successfulBetRoles[successRole] ?? 0) + 1;
    summary.consecutiveFailedBetsByRole[successRole] = 0;
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
  const lock = readJson(LOCK_PATH, MAX_SOAK_LOCK_JSON_BYTES);
  const supervisorIdentity = matchingSupervisorIdentity(status, lock);
  const identityState = supervisorIdentity
    ? verifyProcessStartIdentity(supervisorIdentity.pid, supervisorIdentity.startToken)
    : "unavailable";
  const liveLogPath = status?.artifacts?.liveLog || readLiveLogPath();
  const liveLogReady = Boolean(liveLogPath && fileExists(liveLogPath));
  const progress = await summarizeLiveLog(liveLogPath);
  const lastEventMs = progress.lastEventAt ? Date.parse(progress.lastEventAt) : NaN;
  const diskCapacity = readDiskCapacitySummary();
  const safeStatus = {
    status: status?.status || "not-started",
    dryRun: status?.dryRun ?? null,
    startedAt: status?.startedAt || null,
    finishedAt: status?.finishedAt || null,
    exitCode: status?.exitCode ?? null,
    stopReason: status?.stopReason || null,
    supervisorAlive: identityState === "match",
    hasLiveLog: liveLogReady,
    secondsSinceLastEvent: Number.isFinite(lastEventMs)
      ? Math.max(0, Math.floor((Date.now() - lastEventMs) / 1000))
      : null,
    diskCapacity,
    progress,
  };
  if (diskCapacity.diskCapacityAvailable !== true || diskCapacity.diskFreeBelowMinimum === true) {
    process.exitCode = 1;
  }
  if (STATUS_COMPACT_ONLY) {
    console.log(compactSafeStatusLine(safeStatus));
    return;
  }
  if (STATUS_SUMMARY_ONLY) {
    const { progress: current, ...run } = safeStatus;
    console.log(JSON.stringify({
      ...run,
      progress: compactStatusProgress(current),
    }));
    return;
  }
  console.log(JSON.stringify(safeStatus, null, 2));
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
  removeLockFile();
}

async function stopManagedSupervisor({
  verifyProcessStartIdentityFn = verifyProcessStartIdentity,
  logFn = console.log,
  nowFn = Date.now,
  delayFn = (delayMs) => new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs)),
} = {}) {
  const status = readJson(STATUS_PATH);
  const lock = readJson(LOCK_PATH, MAX_SOAK_LOCK_JSON_BYTES);
  if (!status && !lock) {
    logFn("[testnet-soak] no managed supervisor is running");
    return;
  }
  const supervisorIdentity = matchingSupervisorIdentity(status, lock);
  if (!supervisorIdentity) {
    throw new Error("managed supervisor identity artifacts are incomplete or ambiguous; refusing to stop a PID");
  }
  let identityState = verifyProcessStartIdentityFn(
    supervisorIdentity.pid,
    supervisorIdentity.startToken,
  );
  if (identityState === "not-running" || identityState === "mismatch") {
    finalizeStoppedStatus(status);
    logFn("[testnet-soak] stale stopped status repaired");
    return;
  }
  if (identityState !== "match") {
    throw new Error("managed supervisor process identity is unavailable; refusing to stop a PID");
  }
  writeStopRequest(supervisorIdentity);
  const deadline = nowFn() + 5_000;
  while (nowFn() < deadline) {
    await delayFn(100);
    identityState = verifyProcessStartIdentityFn(
      supervisorIdentity.pid,
      supervisorIdentity.startToken,
    );
    if (identityState === "not-running" || identityState === "mismatch") break;
    if (identityState !== "match") {
      throw new Error("managed supervisor process identity became unavailable while awaiting cooperative stop");
    }
  }
  if (identityState === "match") throw new Error("managed supervisor did not stop cooperatively within 5000ms");
  finalizeStoppedStatus(status);
  logFn("[testnet-soak] stop requested");
}

function acquireLock() {
  mkdirSync(OUT_DIR, { recursive: true });
  if (existsSync(STOP_PATH) && !fileExists(STOP_PATH)) {
    throw new Error("testnet soak stop request path exists but is not a file");
  }
  if (existsSync(LOCK_PATH)) {
    if (!fileExists(LOCK_PATH)) throw new Error("testnet soak supervisor lock path exists but is not a file");
    if (statSync(LOCK_PATH).size > MAX_SOAK_LOCK_JSON_BYTES) {
      throw new Error("testnet soak supervisor lock file is too large to validate safely");
    }
    const previousLock = readJson(LOCK_PATH, MAX_SOAK_LOCK_JSON_BYTES);
    const previousPid = parseTrackedPid(previousLock?.pid);
    const previousStartToken = parseProcessStartToken(previousLock?.supervisorStartToken);
    if (previousPid === null || !previousStartToken) {
      throw new Error("testnet soak supervisor lock identity is incomplete or ambiguous");
    }
    const previousIdentityState = verifyProcessStartIdentity(previousPid, previousStartToken);
    if (previousIdentityState === "match") {
      throw new Error(`testnet soak supervisor is already running (pid ${previousPid})`);
    }
    if (previousIdentityState === "unavailable") {
      throw new Error("testnet soak supervisor lock identity cannot be verified safely");
    }
    removeLockFile();
  }
  removeStopFile();
  const currentIdentity = readProcessStartIdentity(process.pid);
  if (currentIdentity.state !== "ok") {
    throw new Error("testnet soak supervisor cannot establish its process start identity");
  }
  supervisorStartToken = currentIdentity.startToken;
  const handle = openSync(LOCK_PATH, "wx");
  writeFileSync(handle, JSON.stringify({
    pid: process.pid,
    startedAt: STARTED_AT,
    supervisorStartToken,
  }));
  closeSync(handle);
  writeFileSync(SERVER_LOG_PATH, "", "utf8");
  writeFileSync(CANARY_LOG_PATH, "", "utf8");
}

function readLiveLogPath() {
  let handle = null;
  try {
    handle = openSync(CANARY_LOG_PATH, "r");
    const buffer = Buffer.alloc(LIVE_LOG_MARKER_SCAN_BYTES);
    const bytesRead = readSync(handle, buffer, 0, buffer.length, 0);
    return buffer.toString("utf8", 0, bytesRead).match(/^\[live-canary\] log=(.+)$/m)?.[1]?.trim() || null;
  } catch {
    return null;
  } finally {
    if (handle !== null) closeSync(handle);
  }
}

function writeStatus(status, extra = {}) {
  const payload = {
    status,
    dryRun: DRY_RUN,
    startedAt: STARTED_AT,
    supervisorPid: process.pid,
    supervisorStartToken,
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

async function waitForExit(child, {
  readDiskCapacitySummaryFn = readDiskCapacitySummary,
  managedStopRequestedFn = managedStopRequested,
  stopChildFn = stopChild,
  diskCheckIntervalMs = DISK_CAPACITY_CHECK_INTERVAL_MS,
  stopCheckIntervalMs = 100,
} = {}) {
  return new Promise((resolveExit, rejectExit) => {
    let settled = false;
    const diskMonitor = setInterval(() => {
      const capacity = readDiskCapacitySummaryFn();
      if (capacity.diskCapacityAvailable && !capacity.diskFreeBelowMinimum) return;
      settle(resolveExit, {
        code: null,
        signal: capacity.diskCapacityAvailable ? "disk-capacity-below-minimum" : "disk-capacity-unavailable",
      });
      stopChildFn(child);
    }, diskCheckIntervalMs);
    const stopMonitor = setInterval(() => {
      if (!managedStopRequestedFn()) return;
      settle(resolveExit, { code: null, signal: "operator-stop" });
      stopChildFn(child);
    }, stopCheckIntervalMs);

    function cleanup() {
      clearInterval(diskMonitor);
      clearInterval(stopMonitor);
      child.off("error", onError);
      child.off("exit", onExit);
    }

    function settle(resolve, value) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    }

    function onError(error) {
      if (settled) return;
      settled = true;
      cleanup();
      rejectExit(error);
    }

    function onExit(code, signal) {
      settle(resolveExit, { code, signal });
    }

    child.once("error", onError);
    child.once("exit", onExit);
  });
}

async function waitForServer() {
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (managedStopRequested()) throw new Error("operator stop requested");
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
  removeLockFile();
  removeStopFile();
}

function buildSharedEnvironment(env = process.env, healthSecret = HEALTH_SECRET) {
  return {
    ...env,
    ALLOW_WEAK_RATE_LIMIT_IDENTITY: "1",
    HEALTH_DIAGNOSTICS_SECRET: healthSecret,
  };
}

function buildCanaryEnvironment(
  sharedEnv,
  env = process.env,
  { dryRun = DRY_RUN, executionConfirmed = LIVE_EXECUTION_CONFIRMED } = {},
) {
  return {
    ...sharedEnv,
    LIVE_CANARY_RPC_LABEL: env.LIVE_CANARY_RPC_LABEL || "local-production-like-sepolia",
    LIVE_TEST_DRY_RUN: dryRun ? "1" : "0",
    LIVE_TEST_EXECUTE: executionConfirmed ? "1" : "0",
    LIVE_TEST_HEALTH_BASE_URL: BASE_URL,
    LIVE_TEST_HEALTH_SAMPLE_EVERY_ROUNDS: env.LIVE_TEST_HEALTH_SAMPLE_EVERY_ROUNDS || "5",
    LIVE_TEST_INJECT_RPC_FAILOVER: "1",
    LIVE_TEST_MAX_TILES_PER_ROUND: env.LIVE_TEST_MAX_TILES_PER_ROUND || "25",
    LIVE_TEST_MAX_TOTAL_BET_AMOUNT: env.LIVE_TEST_MAX_TOTAL_BET_AMOUNT || "0.05",
    LIVE_TEST_MIN_TILES_PER_ROUND: env.LIVE_TEST_MIN_TILES_PER_ROUND || "1",
    LIVE_TEST_MIN_TOTAL_BET_AMOUNT: env.LIVE_TEST_MIN_TOTAL_BET_AMOUNT || "0.01",
    LIVE_TEST_RANDOMIZE_ROUNDS: "1",
    LIVE_TEST_ROLES: env.LIVE_TEST_ROLES || "MANUAL,AUTOMINER_A,AUTOMINER_B",
    LIVE_TEST_TARGET_ROUNDS: dryRun ? "1" : (env.LIVE_TEST_TARGET_ROUNDS || "1440"),
  };
}

function selfTestCondition(condition, label) {
  if (!condition) throw new Error(`behavior self-test failed: ${label}`);
}

function withTemporaryEnvironmentValue(name, value, fn) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

function createSelfTestChild() {
  const child = new EventEmitter();
  child.exitCode = null;
  child.killed = false;
  child.signals = [];
  child.kill = (signal) => {
    child.signals.push(signal);
    child.killed = true;
    return true;
  };
  return child;
}

async function runBehaviorSelfTest() {
  const explicitSelfTestDir = process.env.SOAK_BEHAVIOR_SELF_TEST_DIR?.trim();
  selfTestCondition(
    explicitSelfTestDir && resolve(explicitSelfTestDir) === OUT_DIR,
    "SOAK_BEHAVIOR_SELF_TEST_DIR must explicitly match SOAK_OUT_DIR",
  );
  selfTestCondition(
    ![STATUS_PATH, STATUS_TMP_PATH, LOCK_PATH, STOP_PATH, SERVER_LOG_PATH, CANARY_LOG_PATH].some(existsSync),
    "self-test directory must not contain managed soak artifacts",
  );
  if (BEHAVIOR_SELF_TEST_SECRET_FAULT) {
    throw new Error("rpc=https://operator:wallet-secret@rpc.invalid/private?token=private-token");
  }

  let faultMutantsRejected = 0;
  const invalidIntegers = ["00", "+1", "1e3", "1.0", "-1", "9007199254740992", "1_0", "0x10"];
  for (const raw of invalidIntegers) {
    const rejected = withTemporaryEnvironmentValue("SOAK_BEHAVIOR_INTEGER", raw, () => {
      try {
        parseInteger("SOAK_BEHAVIOR_INTEGER", 7, 0, Number.MAX_SAFE_INTEGER);
        return false;
      } catch {
        return true;
      }
    });
    selfTestCondition(rejected, "non-canonical integer mutant was accepted");
    faultMutantsRejected += 1;
  }
  for (const [raw, expected] of [["0", 0], ["42", 42], [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER]]) {
    const parsed = withTemporaryEnvironmentValue(
      "SOAK_BEHAVIOR_INTEGER",
      raw,
      () => parseInteger("SOAK_BEHAVIOR_INTEGER", 7, 0, Number.MAX_SAFE_INTEGER),
    );
    selfTestCondition(parsed === expected, "canonical integer was not preserved");
  }

  for (const invalidPid of [0, -1, "1e3", "1.0", 2_147_483_648, {}, null]) {
    selfTestCondition(parseTrackedPid(invalidPid) === null, "malformed PID mutant was accepted");
    faultMutantsRejected += 1;
  }
  selfTestCondition(parseTrackedPid("2147483647") === 2_147_483_647, "maximum tracked PID was rejected");

  for (const invalidCount of [0, -1, "00", "1e3", MAX_SAFE_INTEGER_BIGINT + 1n, {}, null]) {
    selfTestCondition(safePositiveStatusCount(invalidCount) === null, "malformed status count mutant was accepted");
    faultMutantsRejected += 1;
  }
  selfTestCondition(safePositiveStatusCount("42") === 42, "canonical status count was rejected");
  selfTestCondition(bigIntToNonNegativeSafeInteger(-1n) === 0, "negative disk capacity was published");
  selfTestCondition(
    bigIntToNonNegativeSafeInteger(MAX_SAFE_INTEGER_BIGINT + 1n) === Number.MAX_SAFE_INTEGER,
    "oversized disk capacity was not capped",
  );
  faultMutantsRejected += 1;

  selfTestCondition(!liveExecutionConfirmed({ SOAK_EXECUTE_LIVE: "1" }, ["node", "script"]), "env-only live admission was accepted");
  faultMutantsRejected += 1;
  selfTestCondition(!liveExecutionConfirmed({}, ["node", "script", "--execute-live"]), "flag-only live admission was accepted");
  faultMutantsRejected += 1;
  selfTestCondition(
    liveExecutionConfirmed({ SOAK_EXECUTE_LIVE: "1" }, ["node", "script", "--execute-live"]),
    "explicit two-factor live admission was rejected",
  );

  const sharedEnv = buildSharedEnvironment({}, HEALTH_SECRET);
  const canaryEnv = buildCanaryEnvironment(sharedEnv, {}, {
    dryRun: DRY_RUN,
    executionConfirmed: LIVE_EXECUTION_CONFIRMED,
  });
  selfTestCondition(/^[a-f0-9]{64}$/.test(HEALTH_SECRET), "ephemeral diagnostics secret shape is invalid");
  selfTestCondition(sharedEnv.HEALTH_DIAGNOSTICS_SECRET === HEALTH_SECRET, "diagnostics secret was not passed to the server environment");
  selfTestCondition(canaryEnv.HEALTH_DIAGNOSTICS_SECRET === HEALTH_SECRET, "diagnostics secret was not passed to the canary environment");
  selfTestCondition(canaryEnv.LIVE_TEST_DRY_RUN === (DRY_RUN ? "1" : "0"), "canary dry-run flag diverged from admission mode");
  selfTestCondition(canaryEnv.LIVE_TEST_EXECUTE === (LIVE_EXECUTION_CONFIRMED ? "1" : "0"), "canary execute flag diverged from admission mode");
  selfTestCondition(canaryEnv.LIVE_TEST_ROLES === "MANUAL,AUTOMINER_A,AUTOMINER_B", "default canary roles changed");

  const redactedError = describeSupervisorError(
    new Error("rpc=https://operator:wallet-secret@rpc.invalid/private?token=private-token"),
  );
  selfTestCondition(!/wallet-secret|private-token|https?:\/\//i.test(redactedError), "terminal error redaction leaked sensitive input");
  faultMutantsRejected += 1;

  mkdirSync(OUT_DIR, { recursive: true });
  supervisorStartToken = "win32:1";
  writeStatus("behavior-self-test", { marker: "atomic-status" });
  selfTestCondition(readJson(STATUS_PATH)?.marker === "atomic-status", "atomic status replacement lost its payload");
  selfTestCondition(!existsSync(STATUS_TMP_PATH), "atomic status replacement left a temporary file");

  const staleStartedAt = "2026-01-01T00:00:00.000Z";
  writeFileSync(STATUS_PATH, `${JSON.stringify({
    status: "running",
    supervisorPid: 123,
    supervisorStartToken: "win32:1",
    startedAt: staleStartedAt,
  })}\n`, "utf8");
  writeFileSync(LOCK_PATH, `${JSON.stringify({
    pid: 123,
    supervisorStartToken: "win32:1",
    startedAt: staleStartedAt,
  })}\n`, "utf8");
  await stopManagedSupervisor({ verifyProcessStartIdentityFn: () => "not-running", logFn: () => {} });
  selfTestCondition(readJson(STATUS_PATH)?.stopReason === "operator-stop", "stale stop did not repair status");
  selfTestCondition(!existsSync(LOCK_PATH), "stale stop did not remove its matching lock");
  faultMutantsRejected += 1;

  mkdirSync(LOCK_PATH);
  removeLockFile();
  selfTestCondition(existsSync(LOCK_PATH), "lock cleanup removed a non-file path");
  let directoryLockRejected = false;
  try {
    acquireLock();
  } catch (error) {
    directoryLockRejected = /lock path exists but is not a file/.test(String(error?.message));
  }
  selfTestCondition(directoryLockRejected, "directory lock mutant was accepted");
  faultMutantsRejected += 1;
  rmSync(LOCK_PATH, { recursive: true, force: true });

  writeFileSync(LOCK_PATH, "x".repeat(MAX_SOAK_LOCK_JSON_BYTES + 1), "utf8");
  let oversizedLockRejected = false;
  try {
    acquireLock();
  } catch (error) {
    oversizedLockRejected = /lock file is too large/.test(String(error?.message));
  }
  selfTestCondition(oversizedLockRejected, "oversized lock mutant was accepted");
  faultMutantsRejected += 1;
  rmSync(LOCK_PATH, { force: true });

  for (const [capacity, expectedSignal] of [
    [{ diskCapacityAvailable: true, diskFreeBelowMinimum: true }, "disk-capacity-below-minimum"],
    [{ diskCapacityAvailable: false, diskFreeBelowMinimum: null }, "disk-capacity-unavailable"],
  ]) {
    const child = createSelfTestChild();
    const result = await waitForExit(child, {
      readDiskCapacitySummaryFn: () => capacity,
      managedStopRequestedFn: () => false,
      diskCheckIntervalMs: 1,
      stopCheckIntervalMs: 10,
    });
    selfTestCondition(result.signal === expectedSignal, "disk monitor returned the wrong stop reason");
    selfTestCondition(child.killed && child.signals[0] === "SIGTERM", "disk monitor did not stop its child");
    faultMutantsRejected += 1;
  }
  const operatorStopChild = createSelfTestChild();
  const operatorStopResult = await waitForExit(operatorStopChild, {
    readDiskCapacitySummaryFn: () => ({ diskCapacityAvailable: true, diskFreeBelowMinimum: false }),
    managedStopRequestedFn: () => true,
    diskCheckIntervalMs: 10,
    stopCheckIntervalMs: 1,
  });
  selfTestCondition(operatorStopResult.signal === "operator-stop", "operator stop request was ignored");
  selfTestCondition(operatorStopChild.killed, "operator stop did not stop its child");
  faultMutantsRejected += 1;

  server = createSelfTestChild();
  canary = createSelfTestChild();
  stopping = false;
  writeFileSync(LOCK_PATH, "self-test-lock", "utf8");
  writeFileSync(STOP_PATH, "self-test-stop", "utf8");
  await shutdown("behavior-self-test", 1);
  selfTestCondition(server.killed && canary.killed, "shutdown did not stop both managed children");
  selfTestCondition(readJson(STATUS_PATH)?.stopReason === "behavior-self-test", "shutdown did not publish its stop reason");
  selfTestCondition(!existsSync(LOCK_PATH) && !existsSync(STOP_PATH), "shutdown left managed control artifacts behind");

  console.log(JSON.stringify({
    status: "pass",
    dryRun: DRY_RUN,
    liveExecutionConfirmed: LIVE_EXECUTION_CONFIRMED,
    canaryDryRun: canaryEnv.LIVE_TEST_DRY_RUN === "1",
    canaryExecute: canaryEnv.LIVE_TEST_EXECUTE === "1",
    defaultRoles: canaryEnv.LIVE_TEST_ROLES,
    ephemeralDiagnosticsSecret: true,
    atomicStatus: true,
    managedChildrenStarted: 0,
    networkRequests: 0,
    faultMutantsRejected,
  }));
}

async function main() {
  assertDiskCapacity();
  acquireLock();
  managedRunStarted = true;
  writeStatus("starting");

  const sharedEnv = buildSharedEnvironment();
  server = spawnLogged(
    process.execPath,
    [join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "--port", String(PORT)],
    sharedEnv,
    SERVER_LOG_PATH,
  );
  writeStatus("server-starting");
  await waitForServer();

  const canaryEnv = buildCanaryEnvironment(sharedEnv);
  canary = spawnLogged(
    process.execPath,
    [
      join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
      "scripts/live-round-canary.ts",
      ...(LIVE_EXECUTION_CONFIRMED ? ["--execute-live"] : []),
    ],
    canaryEnv,
    CANARY_LOG_PATH,
  );
  writeStatus("running");
  const result = await waitForExit(canary);
  const success = result.code === 0;
  await shutdown(success ? (DRY_RUN ? "dry-run-complete" : "canary-complete") : `canary-${result.signal || result.code}`, success ? 0 : 1);
  process.exitCode = success ? 0 : 1;
}

function installManagedSignalHandlers() {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      void shutdown(`supervisor-${signal.toLowerCase()}`, 1).finally(() => {
        process.exitCode = 1;
      });
    });
  }
}

async function runCli() {
  if (BEHAVIOR_SELF_TEST) return runBehaviorSelfTest();
  if (STATUS_ONLY) return printSafeStatus();
  if (STOP_ONLY) return stopManagedSupervisor();
  installManagedSignalHandlers();
  return main();
}

runCli().catch(async (error) => {
  const message = describeSupervisorError(error);
  if (!BEHAVIOR_SELF_TEST && !STATUS_ONLY && !STOP_ONLY && managedRunStarted) {
    await shutdown(message, 1);
  }
  const prefix = BEHAVIOR_SELF_TEST
    ? "behavior self-test failed: "
    : STATUS_ONLY
      ? "status failed: "
      : STOP_ONLY
        ? "stop failed: "
        : "";
  console.error(`[testnet-soak] ${prefix}${message}`);
  process.exitCode = 1;
});
