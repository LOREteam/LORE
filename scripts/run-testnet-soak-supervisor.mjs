import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { redactProofText } from "./redact-proof-output.mjs";
import { appendBoundedLiveCanaryLine } from "./live-canary-log-path.mjs";
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
const LIVE_LOG_PATH = join(OUT_DIR, "live-canary.jsonl");
const CANARY_PROOF_VALIDATION_LOG_PATH = join(OUT_DIR, "canary-proof-validation.log");
const CANARY_PROOF_VALIDATION_TMP_PATH = `${CANARY_PROOF_VALIDATION_LOG_PATH}.tmp`;
const PROOF_INPUT_SNAPSHOT_PATH = join(OUT_DIR, "live-canary.proof-input.jsonl");
const PROOF_INPUT_SNAPSHOT_TMP_PATH = `${PROOF_INPUT_SNAPSHOT_PATH}.tmp`;
const PROGRESS_CHECKPOINT_PATH = join(OUT_DIR, "status-progress.checkpoint.json");
const PROGRESS_CHECKPOINT_TMP_PATH = `${PROGRESS_CHECKPOINT_PATH}.tmp`;
const BEHAVIOR_ROTATION_LOG_PATH = join(OUT_DIR, "diagnostic-rotation-self-test.log");
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
const MAX_CANARY_PROOF_VALIDATION_LOG_BYTES = 64 * 1024;
const MAX_CANARY_PROOF_VALIDATION_FILE_BYTES = MAX_CANARY_PROOF_VALIDATION_LOG_BYTES + 2 * 1024;
const MAX_CANARY_PROOF_VALIDATION_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_LIVE_LOG_BYTES = parseInteger(
  "SOAK_MAX_LIVE_LOG_BYTES",
  48 * 1024 * 1024,
  1024 * 1024,
  MAX_CANARY_PROOF_VALIDATION_INPUT_BYTES,
);
const MAX_DIAGNOSTIC_LOG_BYTES = parseInteger(
  "SOAK_MAX_DIAGNOSTIC_LOG_BYTES",
  8 * 1024 * 1024,
  64 * 1024,
  64 * 1024 * 1024,
);
const MAX_DIAGNOSTIC_LOG_GENERATIONS = 8;
const DIAGNOSTIC_LOG_RETAINED_GENERATIONS = parseInteger(
  "SOAK_DIAGNOSTIC_LOG_RETAINED_GENERATIONS",
  2,
  0,
  MAX_DIAGNOSTIC_LOG_GENERATIONS,
);
const MAX_PROGRESS_CHECKPOINT_BYTES = 4 * 1024 * 1024;
const MAX_STATUS_SCAN_BYTES = 4 * 1024 * 1024;
const STATUS_SCAN_TIME_BUDGET_MS = 250;
const STATUS_SCAN_CHUNK_BYTES = 64 * 1024;
const MAX_STATUS_JSONL_LINE_BYTES = 256 * 1024;
const MAX_TRACKED_STATUS_IDENTIFIERS = 20_000;
const STATUS_HISTOGRAM_BUCKETS = 128;
const STATUS_HISTOGRAM_BUCKETS_PER_OCTAVE = 4;
const STATUS_CHECKPOINT_SCHEMA = 1;
const STATUS_IDENTITY_DIGEST_BYTES = 4 * 1024;
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
const PROOF_VALIDATION_RUNTIME_ENV_KEYS = [
  "ComSpec",
  "SystemRoot",
  "TEMP",
  "TMP",
  "WINDIR",
];
const PROOF_VALIDATION_PUBLIC_ENV_KEYS = [
  "CANARY_PROOF_PATH",
  "KEEPER_CONTRACT_ADDRESS",
  "LINEA_NETWORK",
  "LINEA_CHAIN_ID",
  "LIVE_CANARY_MIN_AUTOMINER_EPOCHS",
  "LIVE_CANARY_MIN_ELAPSED_MS_PER_EPOCH",
  "LIVE_CANARY_MIN_EPOCHS",
  "NEXT_PUBLIC_CONTRACT_ADDRESS",
  "NEXT_PUBLIC_LINEA_CHAIN_ID",
  "NEXT_PUBLIC_LINEA_NETWORK",
];

let server = null;
let canary = null;
let stopping = false;
let managedRunStarted = false;
let supervisorStartToken = null;
let proofValidator = null;
let initialProofValidation = null;
const RUN_ID = randomBytes(16).toString("hex");
const PROOF_VALIDATION_TIMEOUT_MS = parseInteger("SOAK_PROOF_VALIDATION_TIMEOUT_MS", 120_000, 1_000, 600_000);
const PROOF_VALIDATION_TERMINATION_GRACE_MS = 5_000;

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
  let handle = null;
  try {
    const initialPathStats = lstatPathEntry(path);
    if (
      initialPathStats === null ||
      !initialPathStats.isFile() ||
      initialPathStats.isSymbolicLink() ||
      initialPathStats.size > maxBytes
    ) return null;
    handle = openSync(path, "r");
    const pathStats = lstatPathEntry(path);
    const openedStats = fstatSync(handle);
    if (
      pathStats === null ||
      !pathStats.isFile() ||
      pathStats.isSymbolicLink() ||
      !openedStats.isFile() ||
      initialPathStats.dev !== openedStats.dev ||
      initialPathStats.ino !== openedStats.ino ||
      initialPathStats.size !== openedStats.size ||
      pathStats.dev !== openedStats.dev ||
      pathStats.ino !== openedStats.ino ||
      pathStats.size !== openedStats.size ||
      openedStats.size > maxBytes
    ) return null;
    const buffer = Buffer.alloc(openedStats.size + 1);
    const bytesRead = readSync(handle, buffer, 0, buffer.length, 0);
    if (bytesRead !== openedStats.size) return null;
    return JSON.parse(buffer.toString("utf8", 0, bytesRead));
  } catch {
    return null;
  } finally {
    if (handle !== null) closeSync(handle);
  }
}

function fileExists(path) {
  try {
    const stats = lstatSync(path);
    return stats.isFile() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

function lstatPathEntry(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function pathEntryExists(path) {
  return lstatPathEntry(path) !== null;
}

function removeLockFile() {
  if (fileExists(LOCK_PATH)) rmSync(LOCK_PATH, { force: true });
}

function removeStopFile() {
  if (fileExists(STOP_PATH)) rmSync(STOP_PATH, { force: true });
}

function diagnosticLogArchivePath(logPath, generation) {
  return `${logPath}.${generation}`;
}

function removeOrdinaryGeneratedFile(path) {
  const stats = lstatPathEntry(path);
  if (stats === null) return;
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error("managed diagnostic log path must be an ordinary file");
  }
  rmSync(path, { force: true });
}

function assertOrdinaryGeneratedFileOrAbsent(path, label) {
  const stats = lstatPathEntry(path);
  if (stats === null) return;
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be an ordinary file`);
  }
}

function createEmptyManagedFile(path, label) {
  assertOrdinaryGeneratedFileOrAbsent(path, label);
  if (pathEntryExists(path)) {
    throw new Error(`${label} must be absent before exclusive creation`);
  }
  const handle = openSync(path, "wx");
  closeSync(handle);
}

function writeAtomicManagedTextFile(path, temporaryPath, payload, maxBytes, label) {
  const bytes = Buffer.from(payload, "utf8");
  if (bytes.length > maxBytes) throw new Error(`${label} exceeds its managed byte cap`);
  assertOrdinaryGeneratedFileOrAbsent(path, label);
  removeOrdinaryGeneratedFile(temporaryPath);
  try {
    const handle = openSync(temporaryPath, "wx");
    try {
      let offset = 0;
      while (offset < bytes.length) {
        const bytesWritten = writeSync(handle, bytes, offset, bytes.length - offset);
        if (bytesWritten <= 0) throw new Error(`${label} atomic write made no progress`);
        offset += bytesWritten;
      }
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    renameSync(temporaryPath, path);
  } catch (error) {
    try {
      removeOrdinaryGeneratedFile(temporaryPath);
    } catch {
      // Preserve the original atomic-write error.
    }
    throw error;
  }
}

function resetDiagnosticLogFamily(logPath) {
  removeOrdinaryGeneratedFile(logPath);
  for (let generation = 1; generation <= MAX_DIAGNOSTIC_LOG_GENERATIONS; generation += 1) {
    removeOrdinaryGeneratedFile(diagnosticLogArchivePath(logPath, generation));
  }
  createEmptyManagedFile(logPath, "managed diagnostic log");
}

function rotateDiagnosticLog(logPath, retainedGenerations = DIAGNOSTIC_LOG_RETAINED_GENERATIONS) {
  if (retainedGenerations === 0) {
    removeOrdinaryGeneratedFile(logPath);
    createEmptyManagedFile(logPath, "managed diagnostic log");
    return;
  }
  removeOrdinaryGeneratedFile(diagnosticLogArchivePath(logPath, retainedGenerations));
  for (let generation = retainedGenerations; generation >= 2; generation -= 1) {
    const source = diagnosticLogArchivePath(logPath, generation - 1);
    const sourceStats = lstatPathEntry(source);
    if (sourceStats !== null) {
      if (!sourceStats.isFile() || sourceStats.isSymbolicLink()) {
        throw new Error("managed diagnostic log archive must be an ordinary file");
      }
      renameSync(source, diagnosticLogArchivePath(logPath, generation));
    }
  }
  const currentStats = lstatPathEntry(logPath);
  if (currentStats !== null) {
    if (!currentStats.isFile() || currentStats.isSymbolicLink()) {
      throw new Error("managed diagnostic log path must be an ordinary file");
    }
    renameSync(logPath, diagnosticLogArchivePath(logPath, 1));
  }
  createEmptyManagedFile(logPath, "managed diagnostic log");
}

function createBoundedDiagnosticLogWriter(logPath, {
  maxBytes = MAX_DIAGNOSTIC_LOG_BYTES,
  retainedGenerations = DIAGNOSTIC_LOG_RETAINED_GENERATIONS,
  pinPrefixBytes = 0,
} = {}) {
  let initialStats = lstatPathEntry(logPath);
  if (initialStats === null) {
    createEmptyManagedFile(logPath, "managed diagnostic log");
    initialStats = lstatPathEntry(logPath);
  }
  if (initialStats === null || !initialStats.isFile() || initialStats.isSymbolicLink()) {
    throw new Error("managed diagnostic log path must be an ordinary file");
  }
  let currentBytes = initialStats.size;
  const pinnedPrefixLimit = Math.min(pinPrefixBytes, Math.floor(maxBytes / 4));
  let pinnedPrefix = Buffer.alloc(0);
  return (chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
    if (pinnedPrefix.length < pinnedPrefixLimit) {
      const remaining = pinnedPrefixLimit - pinnedPrefix.length;
      pinnedPrefix = Buffer.concat([pinnedPrefix, bytes.subarray(0, remaining)]);
    }
    let offset = 0;
    while (offset < bytes.length) {
      if (currentBytes >= maxBytes) {
        rotateDiagnosticLog(logPath, retainedGenerations);
        if (pinnedPrefix.length > 0) appendFileSync(logPath, pinnedPrefix);
        currentBytes = pinnedPrefix.length;
      }
      const available = maxBytes - currentBytes;
      const length = Math.min(available, bytes.length - offset);
      appendFileSync(logPath, bytes.subarray(offset, offset + length));
      currentBytes += length;
      offset += length;
    }
  };
}

function writeStopRequest(identity) {
  if (pathEntryExists(STOP_PATH)) {
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

function createHistogramAccumulator() {
  return {
    count: 0,
    exactSamples: [],
    max: null,
    buckets: Array(STATUS_HISTOGRAM_BUCKETS).fill(0),
  };
}

function histogramBucket(value) {
  if (value <= 0) return 0;
  return Math.min(
    STATUS_HISTOGRAM_BUCKETS - 1,
    Math.max(1, Math.ceil(Math.log2(value + 1) * STATUS_HISTOGRAM_BUCKETS_PER_OCTAVE)),
  );
}

function histogramBucketUpperBound(bucket) {
  if (bucket <= 0) return 0;
  return Math.ceil((2 ** (bucket / STATUS_HISTOGRAM_BUCKETS_PER_OCTAVE)) - 1);
}

function recordHistogramValue(accumulator, value) {
  if (!Number.isFinite(value) || value < 0) return;
  accumulator.count = Math.min(Number.MAX_SAFE_INTEGER, accumulator.count + 1);
  accumulator.max = accumulator.max === null ? value : Math.max(accumulator.max, value);
  const bucket = histogramBucket(value);
  accumulator.buckets[bucket] = Math.min(Number.MAX_SAFE_INTEGER, accumulator.buckets[bucket] + 1);
  if (accumulator.exactSamples.length < 512) accumulator.exactSamples.push(value);
}

function histogramPercentile(accumulator, percentile) {
  const target = Math.max(1, Math.ceil(accumulator.count * percentile));
  let seen = 0;
  for (let index = 0; index < accumulator.buckets.length; index += 1) {
    seen += accumulator.buckets[index];
    if (seen >= target) return histogramBucketUpperBound(index);
  }
  return accumulator.max;
}

function histogramSummary(accumulator) {
  if (accumulator.count === 0) return numericSummary([]);
  if (accumulator.count === accumulator.exactSamples.length) {
    return numericSummary(accumulator.exactSamples);
  }
  return {
    samples: accumulator.count,
    p50: histogramPercentile(accumulator, 0.5),
    p95: histogramPercentile(accumulator, 0.95),
    p99: histogramPercentile(accumulator, 0.99),
    max: accumulator.max,
    approximate: true,
    histogramBuckets: STATUS_HISTOGRAM_BUCKETS,
  };
}

function createGrowthAccumulator() {
  return { count: 0, first: null, min: null, max: null, last: null };
}

function recordGrowthValue(accumulator, value) {
  if (!Number.isFinite(value) || value < 0) return;
  if (accumulator.count === 0) {
    accumulator.first = value;
    accumulator.min = value;
    accumulator.max = value;
  } else {
    accumulator.min = Math.min(accumulator.min, value);
    accumulator.max = Math.max(accumulator.max, value);
  }
  accumulator.last = value;
  accumulator.count = Math.min(Number.MAX_SAFE_INTEGER, accumulator.count + 1);
}

function accumulatedGrowthSummary(accumulator) {
  if (accumulator.count === 0) return growthSummary([]);
  return {
    samples: accumulator.count,
    first: accumulator.first,
    min: accumulator.min,
    max: accumulator.max,
    delta: accumulator.last - accumulator.first,
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
    identityCountSemantics: current.identityCountSemantics,
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

function formatUniqueStatusMetric(value, semantics, key) {
  const formatted = formatStatusMetric(value);
  return semantics?.[key] === "lower-bound" && formatted !== "n/a" ? `>=${formatted}` : formatted;
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
    `epochs=${formatUniqueStatusMetric(progress.uniqueEpochs ?? 0, progress.identityCountSemantics, "uniqueEpochs")}`,
    `tx=${formatUniqueStatusMetric(progress.uniqueTxHashes ?? 0, progress.identityCountSemantics, "uniqueTxHashes")}`,
    `nonces=${formatUniqueStatusMetric(progress.uniqueNonces ?? 0, progress.identityCountSemantics, "uniqueNonces")}`,
    `dupTx=${formatUniqueStatusMetric(progress.duplicateTxHashes ?? 0, progress.identityCountSemantics, "duplicateTxHashes")}`,
    `dupNonce=${formatUniqueStatusMetric(progress.duplicateNonces ?? 0, progress.identityCountSemantics, "duplicateNonces")}`,
    `rev=${progress.revertedTransactions ?? 0}`,
    `health=${progress.healthFailures ?? 0}/${progress.healthRetries ?? 0}`,
    `rpc=${progress.rpcFailoverInjectionEvents ?? 0}`,
    `gas=${progress.estimateGasRetries ?? 0}`,
    `resolver=${progress.resolverFallbacks ?? 0}`,
    `slow=${progress.slowSendCount ?? 0}`,
    `p95=${formatStatusMetric(progress.latencyMs?.p95)}`,
    `proof=${safeStatus.proofValidation?.status ?? "not-run"}`,
    `diskLow=${safeStatus.diskCapacity?.diskFreeBelowMinimum === true}`,
    `diskFree=${formatStatusMetric(safeStatus.diskCapacity?.diskFreeBytesNow)}`,
    `preflight=${formatCompactPreflightFailures(progress.preflightFailures)}`,
    `fk=${formatStatusCounts(progress.failedBetErrorKinds)}`,
    `ff=${formatStatusCounts(progress.failedBetFamilies)}`,
    `lag=${formatStatusMetric(safeStatus.progressCheckpoint?.bytesPending)}`,
    `ckpt=${safeStatus.progressCheckpoint?.persisted === true}`,
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

const STATUS_PHASE_METRICS = ["prepareMs", "estimateGasMs", "nonceReadMs", "sendMs", "receiptMs"];
const STATUS_HEALTH_METRICS = ["rssBytes", "heapUsedBytes", "dbBytes", "walBytes", "diskFreeBytes"];
const STATUS_COUNTER_FIELDS = [
  "successfulBets",
  "epochBoundBets",
  "epochUnboundBets",
  "failedBets",
  "duplicateTxHashes",
  "duplicateNonces",
  "revertedTransactions",
  "healthSamples",
  "healthFailures",
  "healthRetries",
  "estimateGasRetries",
  "rpcFailoverInjectionEvents",
  "resolverFallbacks",
  "slowSendCount",
  "malformedLines",
];
const STATUS_ROLE_KEYS = [...SAFE_SOAK_ROLES, "UNKNOWN"];
const STATUS_ERROR_KIND_KEYS = [...SAFE_BET_ERROR_KINDS, "unknown"];
const STATUS_ERROR_FAMILY_KEYS = [
  "inconsistent-success-event",
  "funding",
  "epoch-state",
  "contract-call",
  "network",
  "nonce-state",
  "missing-error",
  "runtime-type-error",
  "rpc-no-data",
  "transaction-execution",
  "rate-limit",
  "gas",
  "unknown",
];
const STATUS_BET_MODE_KEYS = ["single", "bitmap", "sameAmount", "arrays"];
const STATUS_FAILURE_STAGE_KEYS = ["receipt-reverted", "post-send-unconfirmed", "pre-send"];
const STATUS_PREFLIGHT_REASON_KEYS = new Set([
  "pending-nonce-blocked",
  "insufficient-native-and-token",
  "insufficient-native-gas",
  "insufficient-token",
  "preflight-failed",
]);

function createEmptyLiveLogSummary() {
  return {
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
    identityCountSemantics: {
      uniqueEpochs: "exact",
      uniqueTxHashes: "exact",
      duplicateTxHashes: "exact",
      uniqueNonces: "exact",
      duplicateNonces: "exact",
    },
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
}

function createProgressState() {
  return {
    summary: createEmptyLiveLogSummary(),
    identifiers: { epochs: [], txHashes: [], nonces: [] },
    trackingSaturated: { epochs: false, txHashes: false, nonces: false },
    latency: createHistogramAccumulator(),
    phaseLatencies: Object.fromEntries(STATUS_PHASE_METRICS.map((key) => [key, createHistogramAccumulator()])),
    healthGrowth: Object.fromEntries(STATUS_HEALTH_METRICS.map((key) => [key, createGrowthAccumulator()])),
  };
}

function safeNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function restoreCountMap(value, allowedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(allowedKeys.flatMap((key) => {
    const count = safeNonNegativeInteger(value[key]);
    return count > 0 ? [[key, count]] : [];
  }));
}

function restoreHistogramAccumulator(value) {
  const fallback = createHistogramAccumulator();
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const buckets = Array.isArray(value.buckets) && value.buckets.length === STATUS_HISTOGRAM_BUCKETS
    ? value.buckets.map(safeNonNegativeInteger)
    : fallback.buckets;
  const exactSamples = Array.isArray(value.exactSamples)
    ? value.exactSamples.slice(0, 512).filter((sample) => Number.isFinite(sample) && sample >= 0)
    : [];
  const count = safeNonNegativeInteger(value.count);
  const bucketCount = buckets.reduce((sum, item) => Math.min(Number.MAX_SAFE_INTEGER, sum + item), 0);
  if (count !== bucketCount || exactSamples.length > count) return fallback;
  return {
    count,
    exactSamples,
    max: count > 0 && Number.isFinite(value.max) && value.max >= 0 ? value.max : null,
    buckets,
  };
}

function restoreGrowthAccumulator(value) {
  const fallback = createGrowthAccumulator();
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const count = safeNonNegativeInteger(value.count);
  const metrics = [value.first, value.min, value.max, value.last];
  if (count === 0 || metrics.some((metric) => !Number.isFinite(metric) || metric < 0)) return fallback;
  if (value.min > value.max || value.first < value.min || value.first > value.max || value.last < value.min || value.last > value.max) {
    return fallback;
  }
  return { count, first: value.first, min: value.min, max: value.max, last: value.last };
}

function restoreIdentifierList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .slice(0, MAX_TRACKED_STATUS_IDENTIFIERS)
    .filter((item) => typeof item === "string" && /^[a-f0-9]{32}$/.test(item)))];
}

function restoreProgressState(value) {
  const state = createProgressState();
  if (!value || typeof value !== "object" || Array.isArray(value)) return state;
  const rawSummary = value.summary;
  if (rawSummary && typeof rawSummary === "object" && !Array.isArray(rawSummary)) {
    for (const key of STATUS_COUNTER_FIELDS) state.summary[key] = safeNonNegativeInteger(rawSummary[key]);
    state.summary.successfulBetRoles = restoreCountMap(rawSummary.successfulBetRoles, STATUS_ROLE_KEYS);
    state.summary.failedBetErrorKinds = restoreCountMap(rawSummary.failedBetErrorKinds, STATUS_ERROR_KIND_KEYS);
    state.summary.failedBetFamilies = restoreCountMap(rawSummary.failedBetFamilies, STATUS_ERROR_FAMILY_KEYS);
    state.summary.failedBetModes = restoreCountMap(rawSummary.failedBetModes, STATUS_BET_MODE_KEYS);
    state.summary.failedBetRoles = restoreCountMap(rawSummary.failedBetRoles, STATUS_ROLE_KEYS);
    state.summary.consecutiveFailedBetsByRole = restoreCountMap(rawSummary.consecutiveFailedBetsByRole, STATUS_ROLE_KEYS);
    state.summary.maxConsecutiveFailedBetsByRole = restoreCountMap(rawSummary.maxConsecutiveFailedBetsByRole, STATUS_ROLE_KEYS);
    state.summary.failedBetStages = restoreCountMap(rawSummary.failedBetStages, STATUS_FAILURE_STAGE_KEYS);
    state.summary.lastEventAt = typeof rawSummary.lastEventAt === "string" && Number.isFinite(Date.parse(rawSummary.lastEventAt))
      ? rawSummary.lastEventAt
      : null;
    if (Array.isArray(rawSummary.preflightFailures)) {
      state.summary.preflightFailures = rawSummary.preflightFailures.slice(0, 8).flatMap((failure) => {
        const role = STATUS_ROLE_KEYS.includes(failure?.role) ? failure.role : null;
        const reason = STATUS_PREFLIGHT_REASON_KEYS.has(failure?.reason) ? failure.reason : null;
        return role && reason ? [{ role, reason }] : [];
      });
    }
  }
  state.identifiers = {
    epochs: restoreIdentifierList(value.identifiers?.epochs),
    txHashes: restoreIdentifierList(value.identifiers?.txHashes),
    nonces: restoreIdentifierList(value.identifiers?.nonces),
  };
  state.trackingSaturated = {
    epochs: value.trackingSaturated?.epochs === true,
    txHashes: value.trackingSaturated?.txHashes === true,
    nonces: value.trackingSaturated?.nonces === true,
  };
  state.latency = restoreHistogramAccumulator(value.latency);
  state.phaseLatencies = Object.fromEntries(
    STATUS_PHASE_METRICS.map((key) => [key, restoreHistogramAccumulator(value.phaseLatencies?.[key])]),
  );
  state.healthGrowth = Object.fromEntries(
    STATUS_HEALTH_METRICS.map((key) => [key, restoreGrowthAccumulator(value.healthGrowth?.[key])]),
  );
  return state;
}

function incrementSummaryCount(summary, key, amount = 1) {
  summary[key] = Math.min(Number.MAX_SAFE_INTEGER, safeNonNegativeInteger(summary[key]) + amount);
}

function incrementCountMap(map, key) {
  map[key] = Math.min(Number.MAX_SAFE_INTEGER, safeNonNegativeInteger(map[key]) + 1);
}

function statusIdentifier(value) {
  return sha256(String(value)).slice(0, 32);
}

function trackStatusIdentifier(runtime, kind, value, limit = MAX_TRACKED_STATUS_IDENTIFIERS) {
  const identifier = statusIdentifier(value);
  const seen = runtime.identifiers[kind].has(identifier);
  if (!seen) {
    if (runtime.identifiers[kind].size < limit) {
      runtime.identifiers[kind].add(identifier);
    } else {
      runtime.state.trackingSaturated[kind] = true;
      return null;
    }
  }
  return seen;
}

function processLiveLogEvent(state, runtime, event) {
  const summary = state.summary;
  if (typeof event.timestamp === "string" && Number.isFinite(Date.parse(event.timestamp))) {
    summary.lastEventAt = event.timestamp;
  }
  if (event.mode === "preflight" && event.ok === false) {
    const role = typeof event.role === "string" && STATUS_ROLE_KEYS.includes(event.role) ? event.role : "UNKNOWN";
    const reason = event.errorKind === "pending-nonce-blocked"
      ? "pending-nonce-blocked"
      : event.enoughEth === false && event.enoughToken === false
        ? "insufficient-native-and-token"
        : event.enoughEth === false
          ? "insufficient-native-gas"
          : event.enoughToken === false
            ? "insufficient-token"
            : "preflight-failed";
    if (
      summary.preflightFailures.length < 8 &&
      !summary.preflightFailures.some((failure) => failure.role === role && failure.reason === reason)
    ) summary.preflightFailures.push({ role, reason });
  }
  if (event.mode === "diagnostic" && event.sampleKind === "health") {
    if (Number.isSafeInteger(event.healthRetryCount) && event.healthRetryCount > 0) {
      incrementSummaryCount(summary, "healthRetries", event.healthRetryCount);
    }
    if (event.ok === true) {
      incrementSummaryCount(summary, "healthSamples");
      for (const key of STATUS_HEALTH_METRICS) recordGrowthValue(state.healthGrowth[key], event[key]);
    } else incrementSummaryCount(summary, "healthFailures");
  }
  if (event.rpcFailoverInjected === true) incrementSummaryCount(summary, "rpcFailoverInjectionEvents");
  if (Number.isSafeInteger(event.gasEstimateRetryCount) && event.gasEstimateRetryCount > 0) {
    incrementSummaryCount(summary, "estimateGasRetries", event.gasEstimateRetryCount);
  }
  if (event.mode === "resolve" && event.ok === true && event.resolverFallbackUsed === true) {
    incrementSummaryCount(summary, "resolverFallbacks");
  }
  if (event.txStatus === "reverted") incrementSummaryCount(summary, "revertedTransactions");
  if (!STATUS_BET_MODE_KEYS.includes(event.mode) || !Number.isInteger(event.round)) return;
  if (event.ok !== true || event.txStatus !== "success") {
    incrementSummaryCount(summary, "failedBets");
    const errorKind = SAFE_BET_ERROR_KINDS.has(event.errorKind) ? event.errorKind : "unknown";
    incrementCountMap(summary.failedBetErrorKinds, errorKind);
    incrementCountMap(summary.failedBetFamilies, classifyFailedBetFamily(event));
    incrementCountMap(summary.failedBetModes, event.mode);
    const role = SAFE_SOAK_ROLES.has(event.role) ? event.role : "UNKNOWN";
    incrementCountMap(summary.failedBetRoles, role);
    incrementCountMap(summary.consecutiveFailedBetsByRole, role);
    summary.maxConsecutiveFailedBetsByRole[role] = Math.max(
      summary.maxConsecutiveFailedBetsByRole[role] ?? 0,
      summary.consecutiveFailedBetsByRole[role],
    );
    const stage = event.txStatus === "reverted"
      ? "receipt-reverted"
      : typeof event.hash === "string" && /^0x[a-fA-F0-9]{64}$/.test(event.hash)
        ? "post-send-unconfirmed"
        : "pre-send";
    incrementCountMap(summary.failedBetStages, stage);
    return;
  }
  incrementSummaryCount(summary, "successfulBets");
  incrementSummaryCount(summary, event.epochBound === true ? "epochBoundBets" : "epochUnboundBets");
  const successRole = SAFE_SOAK_ROLES.has(event.role) ? event.role : "UNKNOWN";
  incrementCountMap(summary.successfulBetRoles, successRole);
  summary.consecutiveFailedBetsByRole[successRole] = 0;
  recordHistogramValue(state.latency, event.durationMs);
  for (const key of STATUS_PHASE_METRICS) recordHistogramValue(state.phaseLatencies[key], event[key]);
  if (Number.isFinite(event.sendMs) && event.sendMs >= SLOW_SEND_THRESHOLD_MS) {
    incrementSummaryCount(summary, "slowSendCount");
  }
  if (event.epoch != null) trackStatusIdentifier(runtime, "epochs", event.epoch);
  if (typeof event.hash === "string") {
    if (trackStatusIdentifier(runtime, "txHashes", event.hash) === true) incrementSummaryCount(summary, "duplicateTxHashes");
  }
  if (Number.isSafeInteger(event.noncePending) && event.role) {
    if (trackStatusIdentifier(runtime, "nonces", `${event.role}:${event.noncePending}`) === true) {
      incrementSummaryCount(summary, "duplicateNonces");
    }
  }
}

function finalizeProgressState(state, runtime) {
  state.identifiers = Object.fromEntries(
    Object.entries(runtime.identifiers).map(([key, values]) => [key, [...values]]),
  );
  const summary = {
    ...state.summary,
    uniqueEpochs: state.identifiers.epochs.length,
    uniqueTxHashes: state.identifiers.txHashes.length,
    uniqueNonces: state.identifiers.nonces.length,
    identityCountSemantics: {
      uniqueEpochs: state.trackingSaturated.epochs ? "lower-bound" : "exact",
      uniqueTxHashes: state.trackingSaturated.txHashes ? "lower-bound" : "exact",
      duplicateTxHashes: state.trackingSaturated.txHashes ? "lower-bound" : "exact",
      uniqueNonces: state.trackingSaturated.nonces ? "lower-bound" : "exact",
      duplicateNonces: state.trackingSaturated.nonces ? "lower-bound" : "exact",
    },
    latencyMs: histogramSummary(state.latency),
    phaseLatencyMs: Object.fromEntries(
      STATUS_PHASE_METRICS.map((key) => [key, histogramSummary(state.phaseLatencies[key])]),
    ),
    healthGrowth: Object.fromEntries(
      STATUS_HEALTH_METRICS.map((key) => [key, accumulatedGrowthSummary(state.healthGrowth[key])]),
    ),
  };
  return summary;
}

function currentLiveLogIdentity(stats) {
  return {
    dev: String(stats.dev),
    ino: String(stats.ino),
    birthtimeMs: Number.isFinite(stats.birthtimeMs) ? Math.trunc(stats.birthtimeMs) : null,
  };
}

function sameLiveLogIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino && left?.birthtimeMs === right?.birthtimeMs;
}

function readBoundedFileRange(path, start, length) {
  if (length <= 0) return Buffer.alloc(0);
  const handle = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = readSync(handle, buffer, 0, buffer.length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    closeSync(handle);
  }
}

function checkpointAnchors(path, offset) {
  const prefixLength = Math.min(offset, STATUS_IDENTITY_DIGEST_BYTES);
  const boundaryLength = Math.min(offset, STATUS_IDENTITY_DIGEST_BYTES);
  return {
    prefixDigest: sha256(readBoundedFileRange(path, 0, prefixLength)),
    boundaryDigest: sha256(readBoundedFileRange(path, Math.max(0, offset - boundaryLength), boundaryLength)),
  };
}

function checkpointRunKey(status, path) {
  const runIdentity = typeof status?.runId === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(status.runId)
    ? status.runId
    : `${typeof status?.startedAt === "string" ? status.startedAt : "unknown"}|${path}`;
  return sha256(runIdentity);
}

function readProgressCheckpoint(path, runKey, identity, size) {
  const checkpoint = readJson(PROGRESS_CHECKPOINT_PATH, MAX_PROGRESS_CHECKPOINT_BYTES);
  if (
    checkpoint?.schema !== STATUS_CHECKPOINT_SCHEMA ||
    checkpoint.runKey !== runKey ||
    checkpoint.logPathDigest !== sha256(path) ||
    !sameLiveLogIdentity(checkpoint.logIdentity, identity) ||
    !Number.isSafeInteger(checkpoint.offset) ||
    checkpoint.offset < 0 ||
    checkpoint.offset > size ||
    typeof checkpoint.prefixDigest !== "string" ||
    typeof checkpoint.boundaryDigest !== "string" ||
    !checkpoint.state ||
    typeof checkpoint.state !== "object" ||
    Array.isArray(checkpoint.state) ||
    typeof checkpoint.stateDigest !== "string" ||
    checkpoint.stateDigest !== sha256(JSON.stringify(checkpoint.state))
  ) return { checkpoint: null, resetReason: "missing-or-identity-changed" };
  const anchors = checkpointAnchors(path, checkpoint.offset);
  if (checkpoint.prefixDigest !== anchors.prefixDigest || checkpoint.boundaryDigest !== anchors.boundaryDigest) {
    return { checkpoint: null, resetReason: "append-only-anchor-changed" };
  }
  return { checkpoint, resetReason: null };
}

function writeProgressCheckpoint(checkpoint) {
  const payload = `${JSON.stringify(checkpoint)}\n`;
  if (Buffer.byteLength(payload, "utf8") > MAX_PROGRESS_CHECKPOINT_BYTES) return false;
  try {
    const checkpointStats = lstatPathEntry(PROGRESS_CHECKPOINT_PATH);
    if (checkpointStats !== null) {
      if (!checkpointStats.isFile() || checkpointStats.isSymbolicLink()) return false;
    }
    removeOrdinaryGeneratedFile(PROGRESS_CHECKPOINT_TMP_PATH);
    writeFileSync(PROGRESS_CHECKPOINT_TMP_PATH, payload, { encoding: "utf8", flag: "wx" });
    renameSync(PROGRESS_CHECKPOINT_TMP_PATH, PROGRESS_CHECKPOINT_PATH);
    return true;
  } catch {
    try {
      if (fileExists(PROGRESS_CHECKPOINT_TMP_PATH)) rmSync(PROGRESS_CHECKPOINT_TMP_PATH, { force: true });
    } catch {
      // The status command remains read-only with respect to runtime state when checkpoint persistence fails.
    }
    return false;
  }
}

function scanLiveLogIncrementally(path, status) {
  const startedAtMs = Date.now();
  const stats = statSync(path);
  const identity = currentLiveLogIdentity(stats);
  const runKey = checkpointRunKey(status, path);
  const restored = readProgressCheckpoint(path, runKey, identity, stats.size);
  const checkpoint = restored.checkpoint;
  const state = restoreProgressState(checkpoint?.state);
  let offset = checkpoint?.offset ?? 0;
  let skippingOversizedLine = checkpoint?.skippingOversizedLine === true;
  const runtime = {
    state,
    identifiers: Object.fromEntries(
      Object.entries(state.identifiers).map(([key, values]) => [key, new Set(values)]),
    ),
  };
  const handle = openSync(path, "r");
  const buffer = Buffer.alloc(STATUS_SCAN_CHUNK_BYTES);
  let pending = Buffer.alloc(0);
  let position = offset;
  let bytesScanned = 0;
  const scanEnd = Math.min(stats.size, offset + MAX_STATUS_SCAN_BYTES);
  try {
    while (position < scanEnd && Date.now() - startedAtMs < STATUS_SCAN_TIME_BUDGET_MS) {
      const chunkStart = position;
      const bytesRead = readSync(handle, buffer, 0, Math.min(buffer.length, scanEnd - position), position);
      if (bytesRead === 0) break;
      position += bytesRead;
      bytesScanned += bytesRead;
      let cursor = 0;
      if (skippingOversizedLine) {
        const newlineIndex = buffer.indexOf(0x0a, cursor);
        if (newlineIndex < 0 || newlineIndex >= bytesRead) {
          offset = position;
          continue;
        }
        cursor = newlineIndex + 1;
        offset = chunkStart + cursor;
        skippingOversizedLine = false;
      }
      while (cursor < bytesRead) {
        const newlineIndex = buffer.indexOf(0x0a, cursor);
        if (newlineIndex < 0 || newlineIndex >= bytesRead) {
          const tail = buffer.subarray(cursor, bytesRead);
          if (pending.length + tail.length > MAX_STATUS_JSONL_LINE_BYTES) {
            incrementSummaryCount(state.summary, "malformedLines");
            pending = Buffer.alloc(0);
            skippingOversizedLine = true;
            offset = position;
          } else {
            pending = pending.length === 0 ? Buffer.from(tail) : Buffer.concat([pending, tail]);
          }
          break;
        }
        const fragment = buffer.subarray(cursor, newlineIndex);
        const line = pending.length === 0 ? fragment : Buffer.concat([pending, fragment]);
        pending = Buffer.alloc(0);
        offset = chunkStart + newlineIndex + 1;
        cursor = newlineIndex + 1;
        if (line.length > MAX_STATUS_JSONL_LINE_BYTES) {
          incrementSummaryCount(state.summary, "malformedLines");
          continue;
        }
        if (line.length === 0 || line.toString("utf8").trim() === "") continue;
        try {
          const event = JSON.parse(line.toString("utf8"));
          if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("record must be an object");
          processLiveLogEvent(state, runtime, event);
        } catch {
          incrementSummaryCount(state.summary, "malformedLines");
        }
      }
    }
  } finally {
    closeSync(handle);
  }
  const summary = finalizeProgressState(state, runtime);
  const anchors = checkpointAnchors(path, offset);
  const nextCheckpoint = {
    schema: STATUS_CHECKPOINT_SCHEMA,
    runKey,
    logPathDigest: sha256(path),
    logIdentity: identity,
    offset,
    skippingOversizedLine,
    ...anchors,
    state,
    stateDigest: sha256(JSON.stringify(state)),
  };
  const persisted = writeProgressCheckpoint(nextCheckpoint);
  const durationMs = Date.now() - startedAtMs;
  return {
    summary,
    checkpoint: {
      source: "incremental-checkpoint",
      exactThroughOffset: offset,
      logBytes: stats.size,
      bytesPending: Math.max(0, stats.size - offset),
      bytesScanned,
      caughtUp: offset === stats.size && !skippingOversizedLine,
      resetReason: restored.resetReason,
      persisted,
      scanDurationMs: durationMs,
      scanByteBudget: MAX_STATUS_SCAN_BYTES,
      scanTimeBudgetMs: STATUS_SCAN_TIME_BUDGET_MS,
      trackingSaturated: { ...state.trackingSaturated },
      identifierHashBits: 128,
      metricMode: Object.values(state.phaseLatencies).some((metric) => metric.count > metric.exactSamples.length) ||
        state.latency.count > state.latency.exactSamples.length
        ? "bounded-histogram"
        : "exact-bounded-samples",
    },
  };
}

function summarizeLiveLog(path, status) {
  const empty = createEmptyLiveLogSummary();
  if (!path || !fileExists(path)) {
    return {
      summary: empty,
      checkpoint: {
        source: "incremental-checkpoint",
        exactThroughOffset: 0,
        logBytes: 0,
        bytesPending: 0,
        bytesScanned: 0,
        caughtUp: true,
        resetReason: "live-log-unavailable",
        persisted: false,
        scanDurationMs: 0,
        scanByteBudget: MAX_STATUS_SCAN_BYTES,
        scanTimeBudgetMs: STATUS_SCAN_TIME_BUDGET_MS,
        trackingSaturated: { epochs: false, txHashes: false, nonces: false },
        identifierHashBits: 128,
        metricMode: "exact-bounded-samples",
      },
    };
  }
  return scanLiveLogIncrementally(path, status);
}

async function printSafeStatus() {
  const status = readJson(STATUS_PATH);
  const lock = readJson(LOCK_PATH, MAX_SOAK_LOCK_JSON_BYTES);
  const supervisorIdentity = matchingSupervisorIdentity(status, lock);
  const identityState = supervisorIdentity
    ? verifyProcessStartIdentity(supervisorIdentity.pid, supervisorIdentity.startToken)
    : "unavailable";
  const liveLogPath = canonicalCurrentRunLiveLogPath(status?.artifacts?.liveLog) || readLiveLogPath();
  const liveLogReady = Boolean(liveLogPath && fileExists(liveLogPath));
  const progressResult = summarizeLiveLog(liveLogPath, status);
  const progress = progressResult.summary;
  const lastEventMs = progress.lastEventAt ? Date.parse(progress.lastEventAt) : NaN;
  const diskCapacity = readDiskCapacitySummary();
  const liveLogBytes = liveLogReady ? statSync(liveLogPath).size : 0;
  const safeStatus = {
    status: status?.status || "not-started",
    dryRun: status?.dryRun ?? null,
    runId: typeof status?.runId === "string" ? status.runId : null,
    startedAt: status?.startedAt || null,
    finishedAt: status?.finishedAt || null,
    exitCode: status?.exitCode ?? null,
    stopReason: status?.stopReason || null,
    supervisorAlive: identityState === "match",
    hasLiveLog: liveLogReady,
    proofValidation: status?.proofValidation ?? null,
    secondsSinceLastEvent: Number.isFinite(lastEventMs)
      ? Math.max(0, Math.floor((Date.now() - lastEventMs) / 1000))
      : null,
    diskCapacity,
    artifactPolicy: {
      managedArtifactBudgetBytes:
        (2 * (DIAGNOSTIC_LOG_RETAINED_GENERATIONS + 1) * MAX_DIAGNOSTIC_LOG_BYTES) +
        (2 * MAX_LIVE_LOG_BYTES) +
        MAX_PROGRESS_CHECKPOINT_BYTES +
        MAX_CANARY_PROOF_VALIDATION_FILE_BYTES +
        MAX_SOAK_STATUS_JSON_BYTES,
      minimumDiskReserveBytes: MIN_DISK_FREE_BYTES,
      diagnosticLogs: {
        maxBytesPerFile: MAX_DIAGNOSTIC_LOG_BYTES,
        retainedGenerations: DIAGNOSTIC_LOG_RETAINED_GENERATIONS,
        overflow: "rotate-oldest",
      },
      liveLog: {
        bytesNow: liveLogBytes,
        maxBytes: MAX_LIVE_LOG_BYTES,
        completeCampaignArtifact: true,
        rotation: "disabled",
        overflow: "fail-before-write",
        capacityExceeded: liveLogBytes > MAX_LIVE_LOG_BYTES,
      },
      strictProofSnapshot: {
        maxBytes: MAX_LIVE_LOG_BYTES,
        source: "stopped-canary-log",
        digestAndAnalyzerInputAreIdentical: true,
        retainedUntilNextRun: true,
      },
      progressCheckpoint: {
        maxBytes: MAX_PROGRESS_CHECKPOINT_BYTES,
        maxTrackedIdentifiersPerKind: MAX_TRACKED_STATUS_IDENTIFIERS,
      },
      proofValidationLog: {
        maxCapturedOutputBytes: MAX_CANARY_PROOF_VALIDATION_LOG_BYTES,
        maxFileBytes: MAX_CANARY_PROOF_VALIDATION_FILE_BYTES,
        overflow: "truncate-redacted-output",
      },
    },
    progressCheckpoint: progressResult.checkpoint,
    progress,
  };
  if (
    diskCapacity.diskCapacityAvailable !== true ||
    diskCapacity.diskFreeBelowMinimum === true ||
    safeStatus.artifactPolicy.liveLog.capacityExceeded ||
    (liveLogReady && progressResult.checkpoint.persisted !== true)
  ) {
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
    writeAtomicManagedTextFile(
      STATUS_PATH,
      STATUS_TMP_PATH,
      `${JSON.stringify(payload, null, 2)}\n`,
      MAX_SOAK_STATUS_JSON_BYTES,
      "soak status",
    );
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
  assertOrdinaryGeneratedFileOrAbsent(STATUS_PATH, "soak status");
  assertOrdinaryGeneratedFileOrAbsent(STATUS_TMP_PATH, "soak status temporary file");
  if (pathEntryExists(STOP_PATH) && !fileExists(STOP_PATH)) {
    throw new Error("testnet soak stop request path exists but is not a file");
  }
  if (pathEntryExists(LOCK_PATH)) {
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
  let handle = null;
  try {
    handle = openSync(LOCK_PATH, "wx");
    writeFileSync(handle, JSON.stringify({
      pid: process.pid,
      startedAt: STARTED_AT,
      supervisorStartToken,
    }));
    closeSync(handle);
    handle = null;
    removeOrdinaryGeneratedFile(PROGRESS_CHECKPOINT_PATH);
    removeOrdinaryGeneratedFile(PROGRESS_CHECKPOINT_TMP_PATH);
    removeOrdinaryGeneratedFile(PROOF_INPUT_SNAPSHOT_PATH);
    removeOrdinaryGeneratedFile(PROOF_INPUT_SNAPSHOT_TMP_PATH);
    removeOrdinaryGeneratedFile(CANARY_PROOF_VALIDATION_TMP_PATH);
    removeOrdinaryGeneratedFile(LIVE_LOG_PATH);
    resetDiagnosticLogFamily(SERVER_LOG_PATH);
    resetDiagnosticLogFamily(CANARY_LOG_PATH);
    const artifact = writeProofValidationLog({ runId: RUN_ID, status: "not-run" });
    initialProofValidation = {
      status: "not-run",
      runId: RUN_ID,
      inputDigest: null,
      inputBytes: null,
      exitCode: null,
      signal: null,
      ...artifact,
    };
  } catch (error) {
    if (handle !== null) closeSync(handle);
    removeLockFile();
    throw error;
  }
}

function canonicalCurrentRunLiveLogPath(candidate) {
  if (typeof candidate !== "string" || !candidate.trim()) return null;
  const absolutePath = resolve(ROOT, candidate.trim());
  const relativePath = relative(OUT_DIR, absolutePath);
  if (!relativePath || isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith("..")) {
    return null;
  }
  try {
    const linkStats = lstatSync(absolutePath);
    const fileStats = statSync(absolutePath);
    if (linkStats.isSymbolicLink() || !fileStats.isFile()) return null;
    return absolutePath;
  } catch {
    return null;
  }
}

function readLiveLogPath() {
  const candidates = [CANARY_LOG_PATH];
  for (let generation = 1; generation <= DIAGNOSTIC_LOG_RETAINED_GENERATIONS; generation += 1) {
    candidates.push(diagnosticLogArchivePath(CANARY_LOG_PATH, generation));
  }
  for (const wrapperLogPath of candidates) {
    let handle = null;
    try {
      const wrapperStats = lstatSync(wrapperLogPath);
      if (!wrapperStats.isFile() || wrapperStats.isSymbolicLink()) continue;
      handle = openSync(wrapperLogPath, "r");
      const buffer = Buffer.alloc(LIVE_LOG_MARKER_SCAN_BYTES);
      const bytesRead = readSync(handle, buffer, 0, buffer.length, 0);
      const candidate = buffer.toString("utf8", 0, bytesRead).match(/^\[live-canary\] log=(.+)$/m)?.[1]?.trim();
      const canonicalPath = canonicalCurrentRunLiveLogPath(candidate);
      if (canonicalPath) return canonicalPath;
    } catch {
      // Missing or invalid bounded wrapper logs are ignored.
    } finally {
      if (handle !== null) closeSync(handle);
    }
  }
  return null;
}

function writeStatus(status, extra = {}) {
  const payload = {
    status,
    dryRun: DRY_RUN,
    runId: RUN_ID,
    startedAt: STARTED_AT,
    supervisorPid: process.pid,
    supervisorStartToken,
    serverPid: server?.pid ?? null,
    canaryPid: canary?.pid ?? null,
    artifacts: {
      canaryLog: CANARY_LOG_PATH,
      liveLog: readLiveLogPath(),
      proofInputSnapshot: canonicalCurrentRunLiveLogPath(PROOF_INPUT_SNAPSHOT_PATH),
      proofValidationLog: CANARY_PROOF_VALIDATION_LOG_PATH,
      serverLog: SERVER_LOG_PATH,
    },
    ...extra,
  };
  writeAtomicManagedTextFile(
    STATUS_PATH,
    STATUS_TMP_PATH,
    `${JSON.stringify(payload, null, 2)}\n`,
    MAX_SOAK_STATUS_JSON_BYTES,
    "soak status",
  );
}

function spawnLogged(command, args, env, logPath, writerOptions) {
  const writeLog = createBoundedDiagnosticLogWriter(logPath, writerOptions);
  const child = spawn(command, args, {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const appendChunk = (chunk) => {
    try {
      writeLog(chunk);
    } catch {
      child.managedLogFailure = true;
      stopChild(child);
    }
  };
  child.stdout.on("data", appendChunk);
  child.stderr.on("data", appendChunk);
  return child;
}

function buildProofValidationEnvironment(env = process.env) {
  const safeEnv = {};
  for (const key of PROOF_VALIDATION_RUNTIME_ENV_KEYS) {
    if (typeof env[key] === "string" && env[key].trim()) safeEnv[key] = env[key];
  }
  for (const key of PROOF_VALIDATION_PUBLIC_ENV_KEYS) {
    const value = env[key];
    if (typeof value !== "string" || !value.trim() || /(?:https?|wss?):\/\/|(?:private|secret|token|password|mnemonic|key)=/i.test(value)) continue;
    safeEnv[key] = value;
  }
  return safeEnv;
}

function boundedRedactedProofOutput(value) {
  const redacted = redactProofText(value);
  const bytes = Buffer.from(redacted, "utf8");
  const truncated = bytes.length > MAX_CANARY_PROOF_VALIDATION_LOG_BYTES;
  return {
    text: bytes.subarray(0, MAX_CANARY_PROOF_VALIDATION_LOG_BYTES).toString("utf8"),
    truncated,
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function createCurrentRunProofSnapshot(liveLogPath) {
  const canonicalPath = canonicalCurrentRunLiveLogPath(liveLogPath);
  if (!canonicalPath) return null;
  const sourceLinkStats = lstatSync(canonicalPath);
  const sourceStatsBefore = statSync(canonicalPath);
  if (sourceLinkStats.isSymbolicLink() || !sourceStatsBefore.isFile()) return null;
  if (sourceStatsBefore.size > MAX_LIVE_LOG_BYTES || sourceStatsBefore.size > MAX_CANARY_PROOF_VALIDATION_INPUT_BYTES) {
    return null;
  }
  assertOrdinaryGeneratedFileOrAbsent(PROOF_INPUT_SNAPSHOT_PATH, "proof input snapshot");
  removeOrdinaryGeneratedFile(PROOF_INPUT_SNAPSHOT_TMP_PATH);
  let sourceHandle = null;
  let snapshotHandle = null;
  let snapshotPublished = false;
  try {
    sourceHandle = openSync(canonicalPath, "r");
    snapshotHandle = openSync(PROOF_INPUT_SNAPSHOT_TMP_PATH, "wx");
    const digest = createHash("sha256");
    const buffer = Buffer.alloc(STATUS_SCAN_CHUNK_BYTES);
    let position = 0;
    while (position < sourceStatsBefore.size) {
      const bytesRead = readSync(
        sourceHandle,
        buffer,
        0,
        Math.min(buffer.length, sourceStatsBefore.size - position),
        position,
      );
      if (bytesRead <= 0) throw new Error("live canary log changed while creating proof input snapshot");
      digest.update(buffer.subarray(0, bytesRead));
      let written = 0;
      while (written < bytesRead) {
        const bytesWritten = writeSync(snapshotHandle, buffer, written, bytesRead - written);
        if (bytesWritten <= 0) throw new Error("proof input snapshot write made no progress");
        written += bytesWritten;
      }
      position += bytesRead;
    }
    fsyncSync(snapshotHandle);
    closeSync(snapshotHandle);
    snapshotHandle = null;
    closeSync(sourceHandle);
    sourceHandle = null;

    const sourceStatsAfter = statSync(canonicalPath);
    if (
      !sameLiveLogIdentity(currentLiveLogIdentity(sourceStatsBefore), currentLiveLogIdentity(sourceStatsAfter)) ||
      sourceStatsAfter.size !== sourceStatsBefore.size ||
      sourceStatsAfter.mtimeMs !== sourceStatsBefore.mtimeMs
    ) throw new Error("live canary log changed while creating proof input snapshot");
    renameSync(PROOF_INPUT_SNAPSHOT_TMP_PATH, PROOF_INPUT_SNAPSHOT_PATH);
    snapshotPublished = true;
    const snapshotLinkStats = lstatSync(PROOF_INPUT_SNAPSHOT_PATH);
    const snapshotStats = statSync(PROOF_INPUT_SNAPSHOT_PATH);
    if (snapshotLinkStats.isSymbolicLink() || !snapshotStats.isFile() || snapshotStats.size !== sourceStatsBefore.size) {
      throw new Error("proof input snapshot size does not match the stopped canary log");
    }
    return {
      path: PROOF_INPUT_SNAPSHOT_PATH,
      inputDigest: digest.digest("hex"),
      inputBytes: snapshotStats.size,
    };
  } catch (error) {
    if (snapshotHandle !== null) closeSync(snapshotHandle);
    if (sourceHandle !== null) closeSync(sourceHandle);
    try {
      removeOrdinaryGeneratedFile(PROOF_INPUT_SNAPSHOT_TMP_PATH);
      if (snapshotPublished) removeOrdinaryGeneratedFile(PROOF_INPUT_SNAPSHOT_PATH);
    } catch {
      // Preserve the snapshot failure.
    }
    throw error;
  }
}

function proofInputSnapshotMatches(path, expectedBytes, expectedDigest) {
  let handle = null;
  try {
    const linkStats = lstatSync(path);
    const stats = statSync(path);
    if (
      linkStats.isSymbolicLink() ||
      !stats.isFile() ||
      stats.size !== expectedBytes ||
      stats.size > MAX_LIVE_LOG_BYTES
    ) return false;
    handle = openSync(path, "r");
    const digest = createHash("sha256");
    const buffer = Buffer.alloc(STATUS_SCAN_CHUNK_BYTES);
    let position = 0;
    while (position < expectedBytes) {
      const bytesRead = readSync(handle, buffer, 0, Math.min(buffer.length, expectedBytes - position), position);
      if (bytesRead <= 0) return false;
      digest.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const statsAfter = statSync(path);
    return (
      sameLiveLogIdentity(currentLiveLogIdentity(stats), currentLiveLogIdentity(statsAfter)) &&
      statsAfter.size === expectedBytes &&
      statsAfter.mtimeMs === stats.mtimeMs &&
      digest.digest("hex") === expectedDigest
    );
  } catch {
    return false;
  } finally {
    if (handle !== null) closeSync(handle);
  }
}

function writeProofValidationLog({
  output = "",
  exitCode = null,
  signal = null,
  captureTruncated = false,
  runId = RUN_ID,
  status = "not-run",
  inputDigest = null,
  inputBytes = null,
} = {}) {
  const bounded = boundedRedactedProofOutput(output);
  const payload = [
    "# Testnet soak proof validation",
    `runId=${runId}`,
    `status=${status}`,
    "profile=testnet",
    "strict=true",
    "requireEpochBound=true",
    `inputDigest=${typeof inputDigest === "string" ? inputDigest : "none"}`,
    `inputBytes=${Number.isSafeInteger(inputBytes) && inputBytes >= 0 ? inputBytes : "null"}`,
    `exitCode=${Number.isInteger(exitCode) ? exitCode : "null"}`,
    `signal=${typeof signal === "string" ? signal : "none"}`,
    `outputTruncated=${captureTruncated || bounded.truncated}`,
    "",
    bounded.text,
  ].join("\n");
  writeAtomicManagedTextFile(
    CANARY_PROOF_VALIDATION_LOG_PATH,
    CANARY_PROOF_VALIDATION_TMP_PATH,
    `${payload}\n`,
    MAX_CANARY_PROOF_VALIDATION_FILE_BYTES,
    "proof validation log",
  );
  return {
    artifactDigest: sha256(`${payload}\n`),
    artifactTruncated: captureTruncated || bounded.truncated,
  };
}

async function validateLiveCanaryCompletion(liveLogPath) {
  const canonicalLiveLogPath = canonicalCurrentRunLiveLogPath(liveLogPath);
  if (!canonicalLiveLogPath) {
    const artifact = writeProofValidationLog({
      output: "current-run live canary log is missing or unsafe; proof validation was not run",
      status: "failed",
    });
    return {
      status: "failed",
      runId: RUN_ID,
      profile: "testnet",
      strict: true,
      requireEpochBound: true,
      exitCode: null,
      signal: null,
      inputDigest: null,
      inputBytes: null,
      ...artifact,
    };
  }

  let proofInput = null;
  try {
    proofInput = createCurrentRunProofSnapshot(canonicalLiveLogPath);
  } catch {
    proofInput = null;
  }
  if (!proofInput) {
    const artifact = writeProofValidationLog({
      output: "current-run live canary log could not be frozen within the proof-validation bound",
      status: "failed",
    });
    return {
      status: "failed",
      runId: RUN_ID,
      profile: "testnet",
      strict: true,
      requireEpochBound: true,
      exitCode: null,
      signal: null,
      inputDigest: null,
      inputBytes: null,
      ...artifact,
    };
  }
  const { inputDigest, inputBytes, path: proofInputPath } = proofInput;

  return new Promise((resolveValidation) => {
    let output = "";
    let captureTruncated = false;
    const appendOutput = (chunk) => {
      const remaining = MAX_CANARY_PROOF_VALIDATION_LOG_BYTES - Buffer.byteLength(output, "utf8");
      if (remaining <= 0) {
        captureTruncated = true;
        return;
      }
      const bytes = Buffer.from(String(chunk), "utf8");
      if (bytes.length > remaining) captureTruncated = true;
      output += bytes.subarray(0, Math.max(0, remaining)).toString("utf8");
    };
    let settled = false;
    let timeout = null;
    let forceKillTimeout = null;
    let timeoutSignal = null;
    const settle = (exitCode, signal) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
      proofValidator = null;
      const snapshotMatches = proofInputSnapshotMatches(proofInputPath, inputBytes, inputDigest);
      if (!snapshotMatches) appendOutput("\nproof input snapshot changed while the strict analyzer was running\n");
      const effectiveSignal = snapshotMatches ? signal : "proof-input-changed";
      const status = exitCode === 0 && effectiveSignal === null ? "passed" : "failed";
      let artifact;
      try {
        artifact = writeProofValidationLog({
          output,
          exitCode,
          signal: effectiveSignal,
          captureTruncated,
          status,
          inputDigest,
          inputBytes,
        });
      } catch {
        resolveValidation({
          status: "failed",
          runId: RUN_ID,
          profile: "testnet",
          strict: true,
          requireEpochBound: true,
          exitCode: Number.isInteger(exitCode) ? exitCode : null,
          signal: "proof-artifact-write-failed",
          inputDigest,
          inputBytes,
          artifactDigest: null,
          artifactTruncated: null,
        });
        return;
      }
      resolveValidation({
        status,
        runId: RUN_ID,
        profile: "testnet",
        strict: true,
        requireEpochBound: true,
        exitCode: Number.isInteger(exitCode) ? exitCode : null,
        signal: typeof effectiveSignal === "string" ? effectiveSignal : null,
        inputDigest,
        inputBytes,
        ...artifact,
      });
    };
    const child = spawn(
      process.execPath,
      [
        join(ROOT, "scripts", "analyze-live-canary-proof.mjs"),
        proofInputPath,
        "--profile=testnet",
        "--strict",
        "--require-epoch-bound",
        "--require-canary-admission",
        "--require-v10-deployment-manifest",
        `--expected-run-id=${RUN_ID}`,
        "--summary-only",
      ],
      {
        cwd: ROOT,
        env: buildProofValidationEnvironment(),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    proofValidator = child;
    child.stdout.on("data", appendOutput);
    child.stderr.on("data", appendOutput);
    child.once("error", () => settle(null, "spawn-error"));
    child.once("close", (exitCode, signal) => settle(
      timeoutSignal ? null : exitCode,
      timeoutSignal ?? signal,
    ));
    timeout = setTimeout(() => {
      timeoutSignal = "timeout";
      stopChild(child);
      forceKillTimeout = setTimeout(() => {
        if (child.exitCode == null) child.kill("SIGKILL");
      }, PROOF_VALIDATION_TERMINATION_GRACE_MS);
    }, PROOF_VALIDATION_TIMEOUT_MS);
  });
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
      child.off("close", onClose);
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

    function onClose(code, signal) {
      settle(resolveExit, { code, signal: child.managedLogFailure === true ? "diagnostic-log-write-failed" : signal });
    }

    child.once("error", onError);
    child.once("close", onClose);
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
  if (!child || child.exitCode != null) return;
  child.kill("SIGTERM");
}

async function shutdown(stopReason, exitCode, extra = {}) {
  if (stopping) return;
  stopping = true;
  stopChild(canary);
  stopChild(proofValidator);
  stopChild(server);
  writeStatus(exitCode === 0 ? "completed" : "failed", {
    finishedAt: new Date().toISOString(),
    exitCode,
    stopReason,
    ...extra,
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
    LIVE_TEST_LOG_PATH: LIVE_LOG_PATH,
    LIVE_TEST_LOG_MAX_BYTES: String(MAX_LIVE_LOG_BYTES),
    LIVE_TEST_RUN_ID: RUN_ID,
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
    ![
      STATUS_PATH,
      STATUS_TMP_PATH,
      LOCK_PATH,
      STOP_PATH,
      SERVER_LOG_PATH,
      CANARY_LOG_PATH,
      LIVE_LOG_PATH,
      CANARY_PROOF_VALIDATION_LOG_PATH,
      CANARY_PROOF_VALIDATION_TMP_PATH,
      PROOF_INPUT_SNAPSHOT_PATH,
      PROOF_INPUT_SNAPSHOT_TMP_PATH,
      PROGRESS_CHECKPOINT_PATH,
      PROGRESS_CHECKPOINT_TMP_PATH,
      BEHAVIOR_ROTATION_LOG_PATH,
      diagnosticLogArchivePath(BEHAVIOR_ROTATION_LOG_PATH, 1),
      ...Array.from(
        { length: MAX_DIAGNOSTIC_LOG_GENERATIONS },
        (_, index) => diagnosticLogArchivePath(CANARY_LOG_PATH, index + 1),
      ),
      ...Array.from(
        { length: MAX_DIAGNOSTIC_LOG_GENERATIONS },
        (_, index) => diagnosticLogArchivePath(SERVER_LOG_PATH, index + 1),
      ),
    ].some(pathEntryExists),
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
  selfTestCondition(canaryEnv.LIVE_TEST_RUN_ID === RUN_ID, "canary admission run ID diverged from supervisor run ID");
  selfTestCondition(canaryEnv.LIVE_TEST_ROLES === "MANUAL,AUTOMINER_A,AUTOMINER_B", "default canary roles changed");

  const proofValidationEnv = buildProofValidationEnvironment({
    ComSpec: "C:\\Windows\\System32\\cmd.exe",
    SystemRoot: "C:\\Windows",
    NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
    NEXT_PUBLIC_LINEA_CHAIN_ID: "59141",
    NEXT_PUBLIC_CONTRACT_ADDRESS: "0x1111111111111111111111111111111111111111",
    LIVE_CANARY_MIN_EPOCHS: "50",
    CANARY_PROOF_PATH: "docs/testnet-canary-proof.json",
    PRIVATE_KEY: "must-not-reach-proof-validator",
    RPC_URL: "https://operator:wallet-secret@rpc.invalid/private",
  });
  selfTestCondition(proofValidationEnv.ComSpec === "C:\\Windows\\System32\\cmd.exe", "proof validator runtime environment lost allowlisted values");
  selfTestCondition(proofValidationEnv.NEXT_PUBLIC_LINEA_NETWORK === "sepolia", "proof validator lost public network configuration");
  selfTestCondition(proofValidationEnv.NEXT_PUBLIC_LINEA_CHAIN_ID === "59141", "proof validator lost public chain configuration");
  selfTestCondition(proofValidationEnv.NEXT_PUBLIC_CONTRACT_ADDRESS === "0x1111111111111111111111111111111111111111", "proof validator lost public contract configuration");
  selfTestCondition(proofValidationEnv.LIVE_CANARY_MIN_EPOCHS === "50", "proof validator lost public epoch threshold");
  selfTestCondition(proofValidationEnv.CANARY_PROOF_PATH === "docs/testnet-canary-proof.json", "proof validator lost proof path configuration");
  selfTestCondition(!Object.hasOwn(proofValidationEnv, "PRIVATE_KEY"), "proof validator inherited a private key");
  selfTestCondition(!Object.hasOwn(proofValidationEnv, "RPC_URL"), "proof validator inherited an RPC URL");
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(LIVE_LOG_PATH, "{\"mode\":\"diagnostic\"}\n", "utf8");
  const initialLiveLogBytes = statSync(LIVE_LOG_PATH).size;
  const exactCapBytes = initialLiveLogBytes + Buffer.byteLength("{}\n");
  selfTestCondition(
    appendBoundedLiveCanaryLine({ logPath: LIVE_LOG_PATH, line: "{}\n", maxBytes: exactCapBytes }) === exactCapBytes,
    "live evidence writer did not preserve an exact-cap append",
  );
  let liveLogOverflowRejected = false;
  try {
    appendBoundedLiveCanaryLine({ logPath: LIVE_LOG_PATH, line: "{}\n", maxBytes: exactCapBytes });
  } catch (error) {
    liveLogOverflowRejected = /complete-artifact cap/.test(String(error?.message));
  }
  selfTestCondition(liveLogOverflowRejected, "live evidence writer did not fail before exceeding its complete-artifact cap");

  const incrementalEvent = `${JSON.stringify({
    mode: "single",
    ok: true,
    round: 1,
    epoch: "self-test-epoch",
    hash: `0x${"1".repeat(64)}`,
    noncePending: 1,
    role: "MANUAL",
    txStatus: "success",
    durationMs: 10,
    timestamp: "2026-01-01T00:00:00.000Z",
  })}\n`;
  const firstProgress = summarizeLiveLog(LIVE_LOG_PATH, { runId: "self-test-progress", startedAt: STARTED_AT });
  appendBoundedLiveCanaryLine({ logPath: LIVE_LOG_PATH, line: incrementalEvent, maxBytes: MAX_LIVE_LOG_BYTES });
  const secondProgress = summarizeLiveLog(LIVE_LOG_PATH, { runId: "self-test-progress", startedAt: STARTED_AT });
  const thirdProgress = summarizeLiveLog(LIVE_LOG_PATH, { runId: "self-test-progress", startedAt: STARTED_AT });
  selfTestCondition(firstProgress.checkpoint.persisted && firstProgress.checkpoint.caughtUp, "initial status checkpoint was not persisted");
  selfTestCondition(
    secondProgress.checkpoint.bytesScanned === Buffer.byteLength(incrementalEvent) && secondProgress.summary.successfulBets === 1,
    "incremental status did not scan only the appended JSONL suffix",
  );
  selfTestCondition(
    thirdProgress.checkpoint.bytesScanned === 0 && thirdProgress.summary.successfulBets === 1,
    "unchanged status reread or lost previously checkpointed progress",
  );
  writeFileSync(LIVE_LOG_PATH, "{\"mode\":\"diagnostic\",\"ok\":true}\n", "utf8");
  const truncatedProgress = summarizeLiveLog(LIVE_LOG_PATH, { runId: "self-test-progress", startedAt: STARTED_AT });
  selfTestCondition(
    truncatedProgress.summary.successfulBets === 0 && truncatedProgress.checkpoint.resetReason !== null,
    "status checkpoint did not reset after live evidence truncation",
  );
  const frozenProofInput = createCurrentRunProofSnapshot(LIVE_LOG_PATH);
  selfTestCondition(
    frozenProofInput?.inputBytes === statSync(LIVE_LOG_PATH).size &&
      frozenProofInput.inputDigest === sha256(readFileSync(PROOF_INPUT_SNAPSHOT_PATH)) &&
      readFileSync(PROOF_INPUT_SNAPSHOT_PATH, "utf8") === readFileSync(LIVE_LOG_PATH, "utf8"),
    "proof digest and strict analyzer input were not bound to the same immutable snapshot",
  );

  const boundedState = createProgressState();
  const boundedRuntime = {
    state: boundedState,
    identifiers: { epochs: new Set(), txHashes: new Set(), nonces: new Set() },
  };
  trackStatusIdentifier(boundedRuntime, "txHashes", "one", 2);
  trackStatusIdentifier(boundedRuntime, "txHashes", "two", 2);
  trackStatusIdentifier(boundedRuntime, "txHashes", "three", 2);
  selfTestCondition(
    boundedRuntime.identifiers.txHashes.size === 2 && boundedState.trackingSaturated.txHashes,
    "status identifier tracking exceeded its bound without publishing saturation",
  );
  const boundedSummary = finalizeProgressState(boundedState, boundedRuntime);
  selfTestCondition(
    boundedSummary.identityCountSemantics.uniqueTxHashes === "lower-bound" &&
      boundedSummary.identityCountSemantics.duplicateTxHashes === "lower-bound",
    "saturated identity-derived status counts were not labeled as lower bounds",
  );
  const boundedHistogram = createHistogramAccumulator();
  for (let index = 0; index < 513; index += 1) recordHistogramValue(boundedHistogram, index);
  selfTestCondition(
    boundedHistogram.exactSamples.length === 512 && histogramSummary(boundedHistogram).approximate === true,
    "long-run metric aggregation did not switch to its bounded histogram",
  );

  const rotationTestPath = BEHAVIOR_ROTATION_LOG_PATH;
  writeFileSync(rotationTestPath, "", "utf8");
  const writeRotatingLog = createBoundedDiagnosticLogWriter(rotationTestPath, { maxBytes: 8, retainedGenerations: 1 });
  writeRotatingLog("12345678");
  writeRotatingLog("90");
  selfTestCondition(
    readFileSync(rotationTestPath, "utf8") === "90" &&
      readFileSync(diagnosticLogArchivePath(rotationTestPath, 1), "utf8") === "12345678",
    "diagnostic log rotation did not enforce its size and retention policy",
  );
  rmSync(rotationTestPath, { force: true });
  rmSync(diagnosticLogArchivePath(rotationTestPath, 1), { force: true });
  writeFileSync(CANARY_LOG_PATH, "", "utf8");
  const writePinnedCanaryLog = createBoundedDiagnosticLogWriter(CANARY_LOG_PATH, {
    maxBytes: 512,
    retainedGenerations: 1,
    pinPrefixBytes: 256,
  });
  writePinnedCanaryLog(`[live-canary] log=${LIVE_LOG_PATH}\n`);
  writePinnedCanaryLog("x".repeat(512));
  selfTestCondition(readLiveLogPath() === LIVE_LOG_PATH, "proof validator did not bind the current run live log");
  rmSync(diagnosticLogArchivePath(CANARY_LOG_PATH, 1), { force: true });
  const proofArtifact = writeProofValidationLog({
    output: "PRIVATE_KEY=must-not-reach-proof-validator rpc=https://operator:wallet-secret@rpc.invalid/private",
    exitCode: 1,
    inputDigest: sha256("self-test-input"),
    runId: "self-test-run",
    status: "failed",
  });
  const proofArtifactText = readFileSync(CANARY_PROOF_VALIDATION_LOG_PATH, "utf8");
  selfTestCondition(!/must-not-reach-proof-validator|wallet-secret|https?:\/\//i.test(proofArtifactText), "proof validation artifact leaked sensitive input");
  selfTestCondition(/runId=self-test-run\nstatus=failed\n/.test(proofArtifactText), "proof validation artifact did not identify its current run");
  selfTestCondition(/inputDigest=[a-f0-9]{64}/.test(proofArtifactText), "proof validation artifact did not bind its input digest");
  selfTestCondition(/^[a-f0-9]{64}$/.test(proofArtifact.artifactDigest), "proof validation artifact digest is invalid");
  selfTestCondition(proofArtifact.artifactTruncated === false, "short proof validation artifact was unexpectedly truncated");
  rmSync(CANARY_PROOF_VALIDATION_LOG_PATH, { force: true });
  mkdirSync(CANARY_PROOF_VALIDATION_LOG_PATH);
  let nonFileProofLogRejected = false;
  try {
    writeProofValidationLog({ runId: "self-test-run", status: "failed" });
  } catch (error) {
    nonFileProofLogRejected = /proof validation log must be an ordinary file/.test(String(error?.message));
  }
  selfTestCondition(nonFileProofLogRejected, "proof validation writer accepted a non-file target");
  rmSync(CANARY_PROOF_VALIDATION_LOG_PATH, { recursive: true, force: true });
  writeProofValidationLog({ runId: "self-test-run", status: "failed" });
  faultMutantsRejected += 3;

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
  writeStatus("starting", { proofValidation: initialProofValidation });

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
    { pinPrefixBytes: LIVE_LOG_MARKER_SCAN_BYTES },
  );
  writeStatus("running");
  const result = await waitForExit(canary);
  let success = result.code === 0;
  let proofValidation = DRY_RUN
    ? { ...initialProofValidation, status: "not-required", reason: "dry-run" }
    : { ...initialProofValidation, status: "not-run", reason: success ? "pending" : "canary-exit-nonzero" };
  if (success && !DRY_RUN) {
    writeStatus("validating-proof", {
      proofValidation: { ...initialProofValidation, status: "running" },
    });
    proofValidation = await validateLiveCanaryCompletion(readLiveLogPath());
    success = proofValidation.status === "passed";
  }
  const stopReason = success
    ? (DRY_RUN ? "dry-run-complete" : "canary-proof-validated")
    : (proofValidation.status === "failed" ? "canary-proof-validation-failed" : `canary-${result.signal || result.code}`);
  await shutdown(stopReason, success ? 0 : 1, { proofValidation });
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
