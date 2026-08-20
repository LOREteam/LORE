import { closeSync, existsSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getPreviewAgeMs } from "./preview-freshness.mjs";

const PREVIEW_PATH = path.join("docs", "v10-canary-dry-run-preview.md");
const MAX_PREVIEW_BYTES = 512 * 1024;
const MAX_DRY_RUN_LOG_BYTES = 256 * 1024;
const MAX_ANALYZER_OUTPUT_BYTES = 512 * 1024;
const DECIMAL_INTEGER_RE = /^(?:0|[1-9]\d{0,15})$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const requireFreshAuthorization = process.argv.includes("--require-fresh-authorization");
const ANALYZER_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "analyze-live-canary-proof.mjs");
const MAX_PREVIEW_AGE_MS = parsePositiveIntegerEnv(
  "V10_DRY_RUN_PREVIEW_MAX_AGE_MS",
  24 * 60 * 60 * 1000,
  60_000,
  7 * 24 * 60 * 60 * 1000,
);
const MAX_AUTHORIZATION_PREVIEW_AGE_MS = parsePositiveIntegerEnv(
  "V10_DRY_RUN_AUTHORIZATION_MAX_AGE_MS",
  15 * 60 * 1000,
  60_000,
  24 * 60 * 60 * 1000,
);
const AUTHORIZATION_EFFECTIVE_MAX_PREVIEW_AGE_MS = Math.min(
  MAX_PREVIEW_AGE_MS,
  MAX_AUTHORIZATION_PREVIEW_AGE_MS,
);
const ANALYZER_TIMEOUT_MS = parsePositiveIntegerEnv(
  "V10_DRY_RUN_ANALYZER_TIMEOUT_MS",
  20_000,
  1_000,
  60_000,
);

function parsePositiveIntegerEnv(name, fallback, min, max) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!DECIMAL_INTEGER_RE.test(raw)) throw new Error(`${name} must be a canonical decimal integer`);
  const parsed = BigInt(raw);
  if (parsed > MAX_SAFE_INTEGER_BIGINT || parsed < BigInt(min) || parsed > BigInt(max)) {
    throw new Error(`${name} must be in [${min}, ${max}]`);
  }
  return Number(parsed);
}

function readBoundedText(filePath, maxBytes, label) {
  const initialPathStats = assertOrdinaryPath(filePath, label, false);
  if (initialPathStats.size > maxBytes) throw new Error(`${label} is too large to validate safely`);
  const fd = openSync(filePath, "r");
  const chunks = [];
  let bytes = 0;
  try {
    const initialHandleStats = fstatSync(fd);
    if (!initialHandleStats.isFile() || !sameFileFingerprint(initialPathStats, initialHandleStats)) {
      throw new Error(`${label} changed before it could be read`);
    }
    const buffer = Buffer.alloc(Math.min(64 * 1024, Math.max(1, initialHandleStats.size)));
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      bytes += bytesRead;
      if (bytes > maxBytes) throw new Error(`${label} exceeded its safe bound`);
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    const finalHandleStats = fstatSync(fd);
    const finalPathStats = assertOrdinaryPath(filePath, label, false);
    if (!sameFileFingerprint(initialHandleStats, finalHandleStats) || !sameFileFingerprint(initialHandleStats, finalPathStats)) {
      throw new Error(`${label} changed while it was read`);
    }
  } finally {
    closeSync(fd);
  }
  return { text: Buffer.concat(chunks).toString("utf8"), bytes };
}

function sameFileFingerprint(left, right) {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

function assertOrdinaryPath(filePath, label, directory) {
  const stats = lstatSync(filePath);
  if (stats.isSymbolicLink() || (directory ? !stats.isDirectory() : !stats.isFile())) {
    throw new Error(`${label} must be an ordinary ${directory ? "directory" : "file"}`);
  }
  return stats;
}

function samePath(left, right) {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function resolveCanonicalWorkingRoot() {
  const requestedRoot = path.resolve(process.cwd());
  const rootStats = assertOrdinaryPath(requestedRoot, "V10 dry-run Preview working root", true);
  const physicalRoot = realpathSync(requestedRoot);
  if (!samePath(requestedRoot, physicalRoot)) {
    throw new Error("V10 dry-run Preview working root must not resolve through a reparse point");
  }
  return { path: requestedRoot, stats: rootStats };
}

function assertWorkingRootUnchanged(root) {
  const currentStats = assertOrdinaryPath(root.path, "V10 dry-run Preview working root", true);
  if (
    currentStats.dev !== root.stats.dev ||
    currentStats.ino !== root.stats.ino ||
    currentStats.birthtimeMs !== root.stats.birthtimeMs ||
    !samePath(root.path, realpathSync(root.path))
  ) {
    throw new Error("V10 dry-run Preview working root changed during validation");
  }
}

function assertCanonicalDirectory(directoryPath, label) {
  assertOrdinaryPath(directoryPath, label, true);
  if (!samePath(directoryPath, realpathSync(directoryPath))) {
    throw new Error(`${label} must not resolve through a reparse point`);
  }
}

function readBoundedCanaryLogBinding(relativePath) {
  const safePath = safeCanaryLogPath(relativePath);
  if (!safePath) throw new Error("V10 dry-run Preview referenced log path is unsafe");
  const workingRoot = resolveCanonicalWorkingRoot();
  const repositoryRoot = workingRoot.path;
  const dataDirectory = path.join(repositoryRoot, "data");
  const runDirectory = path.join(dataDirectory, "live-test-runs");
  const absolutePath = path.join(repositoryRoot, safePath);
  if (path.dirname(absolutePath) !== runDirectory) throw new Error("V10 dry-run Preview referenced log escaped its run directory");
  assertCanonicalDirectory(dataDirectory, "V10 dry-run Preview log data directory");
  assertCanonicalDirectory(runDirectory, "V10 dry-run Preview log run directory");
  const initialPathStats = assertOrdinaryPath(absolutePath, "V10 dry-run Preview referenced log", false);
  if (!samePath(path.dirname(realpathSync(absolutePath)), realpathSync(runDirectory))) {
    throw new Error("V10 dry-run Preview referenced log must not resolve through a reparse point");
  }

  const fd = openSync(absolutePath, "r");
  const digest = createHash("sha256");
  const chunks = [];
  let bytes = 0;
  try {
    const initialHandleStats = fstatSync(fd);
    if (!initialHandleStats.isFile() || !sameFileFingerprint(initialPathStats, initialHandleStats)) {
      throw new Error("V10 dry-run Preview referenced log changed before it could be read");
    }
    if (initialHandleStats.size > MAX_DRY_RUN_LOG_BYTES) {
      throw new Error("V10 dry-run Preview referenced log is too large to validate safely");
    }
    const buffer = Buffer.alloc(Math.min(64 * 1024, Math.max(1, initialHandleStats.size)));
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      bytes += bytesRead;
      if (bytes > MAX_DRY_RUN_LOG_BYTES) throw new Error("V10 dry-run Preview referenced log exceeded its safe bound");
      const chunk = Buffer.from(buffer.subarray(0, bytesRead));
      digest.update(chunk);
      chunks.push(chunk);
    }
    const finalHandleStats = fstatSync(fd);
    const finalPathStats = assertOrdinaryPath(absolutePath, "V10 dry-run Preview referenced log", false);
    if (!sameFileFingerprint(initialHandleStats, finalHandleStats) || !sameFileFingerprint(initialHandleStats, finalPathStats)) {
      throw new Error("V10 dry-run Preview referenced log changed while it was read");
    }
  } finally {
    closeSync(fd);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  assertWorkingRootUnchanged(workingRoot);
  return {
    path: safePath,
    bytes,
    sha256: digest.digest("hex"),
    lines: text.split(/\r?\n/).filter((line) => line.length > 0).length,
  };
}

function createMinimalAnalyzerEnvironment() {
  const env = { NO_COLOR: "1", FORCE_COLOR: "0" };
  for (const key of ["SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR"]) {
    if (typeof process.env[key] === "string") env[key] = process.env[key];
  }
  return env;
}

function analyzerValue(output, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...output.matchAll(new RegExp(`^${escaped}:\\s*(.+?)\\s*$`, "gmi"))];
  if (matches.length !== 1) throw new Error(`strict dry-run analyzer must report ${label} exactly once`);
  return matches[0][1].trim();
}

function analyzerMetric(output, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...output.matchAll(new RegExp(`^\\|\\s*${escaped}\\s*\\|\\s*([^|]+?)\\s*\\|\\s*$`, "gmi"))];
  if (matches.length !== 1) throw new Error(`strict dry-run analyzer must report ${label} exactly once`);
  return matches[0][1].trim();
}

function runStrictDryRunAnalyzer(logBinding) {
  const result = spawnSync(process.execPath, [
    ANALYZER_SCRIPT,
    logBinding.path,
    "--profile=v10-matrix",
    "--strict",
    "--summary-only",
    "--require-epoch-bound",
    "--require-v10-gas-matrix",
  ], {
    cwd: process.cwd(),
    env: createMinimalAnalyzerEnvironment(),
    encoding: "utf8",
    timeout: ANALYZER_TIMEOUT_MS,
    maxBuffer: MAX_ANALYZER_OUTPUT_BYTES,
    windowsHide: true,
  });
  if (result.error?.code === "ETIMEDOUT") throw new Error("strict dry-run analyzer timed out");
  if (result.error?.code === "ENOBUFS") throw new Error("strict dry-run analyzer exceeded its output bound");
  if (result.error || result.signal || result.status === 0) {
    throw new Error("strict dry-run analyzer did not fail closed as expected");
  }
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const blockedGates = /blocked gates:\s*G10,\s*G11/i.test(output);
  const successfulBetTx = analyzerMetric(output, "successful bet tx");
  const uniqueBetEpochs = analyzerMetric(output, "unique bet epochs");
  const analyzerLogName = analyzerValue(output, "Log");
  const analyzerLogSha256 = analyzerValue(output, "Log SHA-256");
  const analyzerLogBytes = analyzerValue(output, "Log bytes");
  if (!blockedGates || successfulBetTx !== "0" || uniqueBetEpochs !== "0") {
    throw new Error("strict dry-run analyzer verdict is not the expected zero-transaction G10/G11 block");
  }
  if (
    analyzerLogName !== path.basename(logBinding.path) ||
    analyzerLogSha256 !== logBinding.sha256 ||
    analyzerLogBytes !== String(logBinding.bytes)
  ) {
    throw new Error("strict dry-run analyzer log identity does not match the bound current-run log");
  }
  return { dryRunProofBlocksG10G11: true, successfulBetTx: 0, uniqueBetEpochs: 0 };
}

function section(source, title) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(`^## ${escaped}\\s*$`, "m").exec(source);
  if (!heading) return "";
  const bodyStart = heading.index + heading[0].length;
  const body = source.slice(bodyStart);
  const nextHeading = /^## /m.exec(body);
  return nextHeading ? body.slice(0, nextHeading.index) : body;
}

function bullet(source, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...source.matchAll(new RegExp(`^- ${escaped}:\\s*(.+?)\\s*$`, "gm"))];
  if (matches.length > 1) throw new Error(`${label} must appear exactly once`);
  return matches[0]?.[1]?.trim() ?? "";
}

function safeCanaryLogPath(value) {
  const normalized = path.normalize(String(value ?? "").trim());
  if (!normalized || path.isAbsolute(normalized) || normalized.split(/[\\/]+/).includes("..")) return null;
  const parts = normalized.split(/[\\/]+/);
  if (
    parts.length !== 3 ||
    parts[0] !== "data" ||
    parts[1] !== "live-test-runs" ||
    !/^live-canary-[0-9TZ-]+\.jsonl$/.test(parts[2])
  ) {
    return null;
  }
  return path.join(...parts);
}

function requireBullet(source, label, expected) {
  const value = bullet(source, label);
  if (value !== expected) throw new Error(`${label} must be ${expected || "present"}`);
  return value;
}

function requireSha256Bullet(source, label) {
  const value = bullet(source, label);
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a canonical SHA-256 digest`);
  }
  return value;
}

function parseDecimalText(value, label) {
  const text = String(value ?? "").trim();
  if (!DECIMAL_INTEGER_RE.test(text)) throw new Error(`${label} must be a canonical decimal integer`);
  const parsed = BigInt(text);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) throw new Error(`${label} is too large to report safely`);
  return Number(parsed);
}

function validatePreview() {
  const workingRoot = resolveCanonicalWorkingRoot();
  const repositoryRoot = workingRoot.path;
  const docsDirectory = path.join(repositoryRoot, "docs");
  assertCanonicalDirectory(docsDirectory, "V10 dry-run Preview docs directory");
  const previewPath = path.join(docsDirectory, path.basename(PREVIEW_PATH));
  if (!samePath(path.dirname(previewPath), docsDirectory)) {
    throw new Error("V10 dry-run Preview markdown escaped its docs directory");
  }
  if (!existsSync(previewPath)) throw new Error("V10 dry-run Preview markdown is missing");
  const previewBinding = readBoundedText(previewPath, MAX_PREVIEW_BYTES, "V10 dry-run Preview markdown");
  const markdown = previewBinding.text;
  const previewSha256 = createHash("sha256").update(markdown, "utf8").digest("hex");
  const updatedAt = markdown.match(/^Last updated:\s*([0-9TZ:.-]+)\.$/m)?.[1] ?? "";
  const updatedMs = Date.parse(updatedAt);
  const ageMs = getPreviewAgeMs(updatedMs);
  const maxPreviewAgeMs = requireFreshAuthorization
    ? AUTHORIZATION_EFFECTIVE_MAX_PREVIEW_AGE_MS
    : MAX_PREVIEW_AGE_MS;
  if (ageMs > maxPreviewAgeMs) {
    const staleError = new Error(requireFreshAuthorization
      ? "V10 dry-run Preview is not fresh enough for authorization"
      : "V10 dry-run Preview is stale");
    staleError.previewAgeMinutes = Math.floor(ageMs / 60_000);
    throw staleError;
  }
  if (!/not an authorization to send transactions, start a soak, deploy, or change[\s\S]*contract behavior/i.test(markdown)) {
    throw new Error("V10 dry-run Preview must preserve its non-authorization boundary");
  }
  if (!/Do not execute any of the following without a fresh exact authorization/i.test(markdown)) {
    throw new Error("V10 dry-run Preview must preserve its fresh consent boundary");
  }

  const overall = section(markdown, "Overall Status");
  requireBullet(overall, "status", "pass");
  requireBullet(overall, "transactionSent", "false");
  requireBullet(overall, "signingMaterialLoaded", "false");
  requireBullet(overall, "operationalBoundaryVerified", "true");
  requireBullet(overall, "walletClientCreated", "false");
  requireBullet(overall, "contractWriteSubmitted", "false");
  requireBullet(overall, "dryRunProofBlocksG10G11", "true");
  const walletSetSha256 = requireSha256Bullet(overall, "walletSetSha256");
  const canaryPlanSha256 = requireSha256Bullet(overall, "canaryPlanSha256");

  const planner = section(markdown, "Read-Only Planner");
  requireBullet(planner, "exit", "0");
  requireBullet(planner, "mode", "read-only");
  requireBullet(planner, "network", "sepolia");
  requireBullet(planner, "chainId", "59141");
  requireBullet(planner, "transactionSent", "false");
  requireBullet(planner, "signingMaterialLoaded", "false");
  requireBullet(planner, "walletClientCreated", "false");
  requireBullet(planner, "contractWriteSubmitted", "false");
  const transactionLimit = parseDecimalText(bullet(planner, "transactionLimit"), "transactionLimit");
  const estimatedGas = parseDecimalText(bullet(planner, "estimatedGas"), "estimatedGas");

  const pending = section(markdown, "Pending Nonce Dry-Run");
  requireBullet(pending, "exit", "0");
  requireBullet(pending, "mode", "dry-run");
  requireBullet(pending, "wouldSend", "false");
  requireBullet(pending, "transactionSent", "false");
  requireBullet(pending, "signingMaterialLoaded", "false");
  requireBullet(pending, "walletClientCreated", "false");
  requireBullet(pending, "contractWriteSubmitted", "false");

  const matrix = section(markdown, "V10 Matrix Dry-Run");
  requireBullet(matrix, "exit", "0");
  requireBullet(matrix, "network", "sepolia");
  requireBullet(matrix, "chainId", "59141");
  requireBullet(matrix, "execution", "dry-run");
  requireBullet(matrix, "transactionSent", "false");
  requireBullet(matrix, "signingMaterialLoaded", "false");
  requireBullet(matrix, "walletClientCreated", "false");
  requireBullet(matrix, "contractWriteSubmitted", "false");
  requireBullet(matrix, "walletSetSha256", walletSetSha256);
  requireBullet(matrix, "canaryPlanSha256", canaryPlanSha256);
  const plannedBetTx = parseDecimalText(bullet(matrix, "plannedBetTx"), "plannedBetTx");
  const logPath = safeCanaryLogPath(bullet(matrix, "log"));
  if (!logPath) throw new Error("V10 dry-run Preview must reference only a safe relative live-test-run log");
  const expectedLogBytes = parseDecimalText(bullet(matrix, "logBytes"), "logBytes");
  const expectedLogSha256 = bullet(matrix, "logSha256");
  if (!/^[a-f0-9]{64}$/.test(expectedLogSha256)) {
    throw new Error("V10 dry-run Preview logSha256 must be a canonical SHA-256 digest");
  }
  const logBindingBefore = readBoundedCanaryLogBinding(logPath);
  if (logBindingBefore.bytes !== expectedLogBytes || logBindingBefore.sha256 !== expectedLogSha256) {
    throw new Error("V10 dry-run Preview referenced log does not match its current-run binding");
  }

  const analyzer = section(markdown, "Dry-Run Proof Analysis");
  requireBullet(analyzer, "exit", "1");
  requireBullet(analyzer, "dryRunProofBlocksG10G11", "true");
  requireBullet(analyzer, "successfulBetTx", "0");
  requireBullet(analyzer, "uniqueBetEpochs", "0");
  requireBullet(analyzer, "logSha256", expectedLogSha256);
  requireBullet(analyzer, "logBytes", String(expectedLogBytes));
  const analyzerVerdict = runStrictDryRunAnalyzer(logBindingBefore);
  const logBindingAfter = readBoundedCanaryLogBinding(logPath);
  if (
    logBindingAfter.bytes !== logBindingBefore.bytes ||
    logBindingAfter.sha256 !== logBindingBefore.sha256 ||
    logBindingAfter.sha256 !== expectedLogSha256
  ) {
    throw new Error("V10 dry-run Preview referenced log changed during strict analysis");
  }
  assertWorkingRootUnchanged(workingRoot);

  return {
    status: "pass",
    previewPath: PREVIEW_PATH,
    ageMinutes: Math.floor(ageMs / 60_000),
    maxPreviewAgeMinutes: Math.floor(maxPreviewAgeMs / 60_000),
    authorizationFreshnessRequired: requireFreshAuthorization,
    previewBytes: previewBinding.bytes,
    previewSha256,
    walletSetSha256,
    canaryPlanSha256,
    canaryLog: logPath,
    logBytes: logBindingAfter.bytes,
    logLines: logBindingAfter.lines,
    transactionLimit,
    estimatedGas,
    plannedBetTx,
    transactionSent: false,
    signingMaterialLoaded: false,
    walletClientCreated: false,
    contractWriteSubmitted: false,
    dryRunProofBlocksG10G11: analyzerVerdict.dryRunProofBlocksG10G11,
  };
}

try {
  console.log(JSON.stringify(validatePreview()));
} catch (error) {
  const previewAgeMinutes = error instanceof Error && Number.isSafeInteger(error.previewAgeMinutes)
    ? error.previewAgeMinutes
    : undefined;
  console.log(JSON.stringify({
    status: "fail",
    authorizationFreshnessRequired: requireFreshAuthorization,
    ...(previewAgeMinutes === undefined ? {} : { ageMinutes: previewAgeMinutes }),
    maxPreviewAgeMinutes: Math.floor((requireFreshAuthorization
      ? AUTHORIZATION_EFFECTIVE_MAX_PREVIEW_AGE_MS
      : MAX_PREVIEW_AGE_MS) / 60_000),
    issue: error instanceof Error ? error.message.replace(/\s+/g, "-").toLowerCase().slice(0, 96) : "unknown",
  }));
  process.exitCode = 1;
}
