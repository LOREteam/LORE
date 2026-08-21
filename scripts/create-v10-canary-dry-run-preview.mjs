import { spawnSync } from "node:child_process";
import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { redactProofText } from "./redact-proof-output.mjs";
import { parseSummaryTimeoutEnv } from "./summary-timeout.mjs";
import {
  resolveTrustedNpmCli,
  trustedNpmCommand,
  trustedNpmEnvironment,
} from "./trusted-npm-cli.mjs";

const DEFAULT_RPC_LABEL = "linea-sepolia-public-fallback";
const PREVIEW_PATH = path.join("docs", "v10-canary-dry-run-preview.md");
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;
const MAX_DRY_RUN_LOG_BYTES = 256 * 1024;
const MAX_PREVIEW_FIELD_CHARS = 180;
const CHILD_TIMEOUT_MS = parseSummaryTimeoutEnv("V10_CANARY_DRY_RUN_PREVIEW_TIMEOUT_MS", 240_000);
const CHILD_ENV_INSPECTION_ARG = "--inspect-read-only-child-env";
const PROCESS_RUNTIME_ENV_KEYS = [
  "SystemRoot",
  "SYSTEMROOT",
  "WINDIR",
  "TEMP",
  "TMP",
  "TMPDIR",
  "CI",
  "NO_COLOR",
  "FORCE_COLOR",
];
const PUBLIC_READ_ONLY_ENV_KEYS = [
  "NODE_ENV",
  "LINEA_NETWORK",
  "NEXT_PUBLIC_LINEA_NETWORK",
  "NEXT_PUBLIC_CONTRACT_ADDRESS",
  "NEXT_PUBLIC_LINEA_TOKEN_ADDRESS",
  "NEXT_PUBLIC_CONTRACT_HAS_TOKEN_GETTER",
  "NEXT_PUBLIC_CONTRACT_HAS_REBATE_API",
  "NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS",
  "NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK",
  "INDEXER_START_BLOCK",
  "NEXT_PUBLIC_LORE_READ_ONLY_MODE",
  "V10_POSTDEPLOY_SCAN_EPOCHS",
  "V10_EXPECTED_CURRENT_OWNER",
  "V10_EXPECTED_CURRENT_FEE_RECIPIENT",
  "V10_EXPECTED_CURRENT_EPOCH_DURATION",
  "LIVE_CANARY_RPC_LABEL",
  "LINEA_RPC_LABEL",
  "LIVE_TEST_TARGET_ROUNDS",
  "LIVE_TEST_TILES_PER_ROUND",
  "LIVE_TEST_SAFE_SECONDS_LEFT",
  "LIVE_TEST_SAFE_WINDOW_TIMEOUT_MS",
  "LIVE_TEST_SAFE_WINDOW_HEARTBEAT_MS",
  "LIVE_TEST_RESOLVE_RETRY_COOLDOWN_MS",
  "LIVE_TEST_RESOLVE_GAS_FLOOR",
  "LIVE_TEST_LOOP_PAUSE_MS",
  "LIVE_TEST_MAX_FAILURES",
  "LIVE_TEST_FORCE_ALLOWANCE_APPROVE",
  "LIVE_TEST_REPEAT_SAME_BET",
  "LIVE_TEST_ALLOW_EMPTY_RESOLVE",
  "LIVE_TEST_VERBOSE_TARGETS",
  "LIVE_TEST_VERBOSE_WALLETS",
  "LIVE_TEST_BET_AMOUNT",
  "LIVE_TEST_APPROVE_AMOUNT",
  "LIVE_TEST_MIN_ETH_PER_WALLET",
  "LIVE_TEST_RANDOMIZE_ROUNDS",
  "LIVE_TEST_INJECT_RPC_FAILOVER",
  "LIVE_TEST_HEALTH_SAMPLE_EVERY_ROUNDS",
  "LIVE_TEST_HEALTH_TIMEOUT_MS",
  "LIVE_TEST_MIN_BET_AMOUNT",
  "LIVE_TEST_MAX_BET_AMOUNT",
  "LIVE_TEST_MIN_TILES_PER_ROUND",
  "LIVE_TEST_MAX_TILES_PER_ROUND",
  "LIVE_TEST_STRESS_SEED",
  "LIVE_TEST_ROLES",
  "LORE_LIVE_TEST_MANUAL_ADDRESS",
  "LORE_LIVE_TEST_AUTOMINER_A_ADDRESS",
  "LORE_LIVE_TEST_AUTOMINER_B_ADDRESS",
  "LORE_LIVE_TEST_AUTOMINER_C_ADDRESS",
  "LORE_LIVE_TEST_RESOLVER_ADDRESS",
];
const INSPECTED_PUBLIC_ENV_KEYS = [
  "LINEA_NETWORK",
  "NEXT_PUBLIC_CONTRACT_ADDRESS",
  "NEXT_PUBLIC_LINEA_TOKEN_ADDRESS",
  "NEXT_PUBLIC_CONTRACT_HAS_TOKEN_GETTER",
  "V10_POSTDEPLOY_SCAN_EPOCHS",
  "V10_EXPECTED_CURRENT_OWNER",
  "LIVE_CANARY_RPC_LABEL",
];
const SIGNING_ENV_NAME_RE = /(?:^|_)(?:PRIVATE_KEY|MNEMONIC|SEED(?:_PHRASE)?|SIGNING_KEY)(?:_|$)/i;
const CREDENTIAL_ENV_NAME_RE =
  /(?:^|_)(?:PRIVATE_KEY|MNEMONIC|SEED(?:_PHRASE)?|SIGNING_KEY|PASSWORD|PASSPHRASE|AUTH(?:ORIZATION)?|BEARER|TOKEN|API_KEY|ACCESS_KEY|SECRET|COOKIE|SESSION|DSN|WEBHOOK|RPC_(?:URL|ENDPOINT)|DATABASE_URL)(?:_|$)/i;
const SAFE_NON_CREDENTIAL_ENV_NAMES = new Set([
  "NEXT_PUBLIC_LINEA_TOKEN_ADDRESS",
  "NEXT_PUBLIC_CONTRACT_HAS_TOKEN_GETTER",
]);
const TRUSTED_NPM_LAUNCHER = resolveTrustedNpmCli();

loadDotenv({ path: ".env.local", override: false, quiet: true });
loadDotenv({ path: ".env", override: false, quiet: true });

function npmRun(script) {
  const command = trustedNpmCommand(["run", script], TRUSTED_NPM_LAUNCHER);
  return {
    ...command,
    display: `npm.cmd run ${script}`,
  };
}

function nodeCommand(args) {
  return {
    command: process.execPath,
    args,
    display: `node ${args.join(" ")}`,
  };
}

function createReadOnlyChildBoundary(sourceEnv) {
  const env = {};
  for (const key of [...PROCESS_RUNTIME_ENV_KEYS, ...PUBLIC_READ_ONLY_ENV_KEYS]) {
    if (typeof sourceEnv[key] === "string") env[key] = sourceEnv[key];
  }
  Object.assign(env, {
    NO_UPDATE_NOTIFIER: "1",
    npm_config_update_notifier: "false",
    npm_config_fund: "false",
    LIVE_TEST_DRY_RUN: "1",
    LIVE_TEST_EXECUTE: "0",
    SOAK_EXECUTE_LIVE: "0",
    TEST_WALLET_EXECUTE: "0",
    LIVE_CANARY_RPC_LABEL: sourceEnv.LIVE_CANARY_RPC_LABEL || DEFAULT_RPC_LABEL,
  });
  const sensitiveCredentialKeys = Object.entries(env)
    .filter(([name, value]) =>
      String(value).trim() &&
      !SAFE_NON_CREDENTIAL_ENV_NAMES.has(name) &&
      CREDENTIAL_ENV_NAME_RE.test(name),
    )
    .map(([name]) => name);
  const signingMaterialLoaded = Object.entries(env).some(
    ([name, value]) => String(value).trim() && SIGNING_ENV_NAME_RE.test(name),
  );
  if (sensitiveCredentialKeys.length > 0 || signingMaterialLoaded) {
    throw new Error("Refusing to construct a read-only child environment with credential material");
  }
  for (const gate of ["LIVE_TEST_EXECUTE", "SOAK_EXECUTE_LIVE", "TEST_WALLET_EXECUTE"]) {
    if (env[gate] !== "0") throw new Error(`Read-only child execution gate ${gate} must be disabled`);
  }
  return {
    env: Object.freeze(trustedNpmEnvironment(env, TRUSTED_NPM_LAUNCHER)),
    signingMaterialLoaded,
    sensitiveCredentialKeys,
  };
}

const READ_ONLY_CHILD_BOUNDARY = createReadOnlyChildBoundary(process.env);

if (process.argv.includes(CHILD_ENV_INSPECTION_ARG)) {
  console.log(JSON.stringify({
    signingMaterialLoaded: READ_ONLY_CHILD_BOUNDARY.signingMaterialLoaded,
    sensitiveCredentialKeysPresent: READ_ONLY_CHILD_BOUNDARY.sensitiveCredentialKeys.length > 0,
    childEnvKeys: Object.keys(READ_ONLY_CHILD_BOUNDARY.env).sort(),
    publicConfig: Object.fromEntries(
      INSPECTED_PUBLIC_ENV_KEYS
        .filter((key) => READ_ONLY_CHILD_BOUNDARY.env[key] !== undefined)
        .map((key) => [key, READ_ONLY_CHILD_BOUNDARY.env[key]]),
    ),
    executionGates: {
      LIVE_TEST_EXECUTE: READ_ONLY_CHILD_BOUNDARY.env.LIVE_TEST_EXECUTE,
      SOAK_EXECUTE_LIVE: READ_ONLY_CHILD_BOUNDARY.env.SOAK_EXECUTE_LIVE,
      TEST_WALLET_EXECUTE: READ_ONLY_CHILD_BOUNDARY.env.TEST_WALLET_EXECUTE,
    },
  }));
  process.exit(0);
}

function runStep(name, spec) {
  const result = spawnSync(spec.command, spec.args, {
    cwd: TRUSTED_NPM_LAUNCHER.repoRoot,
    encoding: "utf8",
    maxBuffer: MAX_CAPTURE_BYTES,
    timeout: CHILD_TIMEOUT_MS,
    env: READ_ONLY_CHILD_BOUNDARY.env,
  });
  const rawOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const output = redactProofText(rawOutput).trim();
  const timedOut = result.error?.code === "ETIMEDOUT";
  const outputTooLarge = result.error?.code === "ENOBUFS";
  return {
    name,
    command: spec.display,
    status: result.status ?? null,
    signal: result.signal ?? null,
    timedOut,
    outputTooLarge,
    output,
    rawOutput,
    errorCode: result.error?.code ?? null,
    spawnError: result.error != null,
    ok: result.status === 0 && !timedOut && !outputTooLarge,
  };
}

function extractValue(output, pattern) {
  return output.match(pattern)?.[1] ?? null;
}

function extractScalar(output, name) {
  return (
    extractValue(output, new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`)) ??
    extractValue(output, new RegExp(`"${name}"\\s*:\\s*([^,}\\r\\n]+)`))?.trim() ??
    extractValue(output, new RegExp(`${name}=([^,\\s]+)`))
  );
}

function extractBooleanFlag(output, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const reports = [...output.matchAll(new RegExp(
    `(?:"${escaped}"\\s*:\\s*|\\b${escaped}=)(?:"([^"\\r\\n]*)"|([^,}\\s\\r\\n]+))`,
    "g",
  ))].map((match) => (match[1] ?? match[2] ?? "").trim());
  if (reports.some((value) => value === "true")) return true;
  return reports.length > 0 && reports.every((value) => value === "false") ? false : null;
}

function extractSha256Flag(output, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...output.matchAll(new RegExp(`\\b${escaped}=([a-f0-9]{64})(?=\\s|$)`, "gi"))];
  if (matches.length !== 1) return null;
  return matches[0][1].toLowerCase();
}

function extractCanaryLog(output) {
  const raw = extractValue(output, /\[live-canary\]\s+log=([^\r\n]+)/) ?? extractValue(output, /\blog=([^\s]+\.jsonl)\b/);
  if (!raw) return null;
  return normalizeCanaryLogPath(raw);
}

function safeCanaryLogPath(value) {
  const normalized = path.normalize(String(value ?? "").trim());
  if (
    !normalized ||
    path.isAbsolute(normalized) ||
    normalized.split(/[\\/]+/).includes("..")
  ) {
    return null;
  }
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

function samePath(left, right) {
  return process.platform === "win32"
    ? String(left).toLowerCase() === String(right).toLowerCase()
    : String(left) === String(right);
}

function normalizeCanaryLogPath(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!path.isAbsolute(text)) return safeCanaryLogPath(text);
  try {
    const repositoryRoot = realpathSync(process.cwd());
    const dataDirectory = path.join(repositoryRoot, "data");
    const runDirectory = path.join(dataDirectory, "live-test-runs");
    const canonicalRunDirectory = realpathSync(runDirectory);
    if (!samePath(canonicalRunDirectory, runDirectory)) return null;
    assertOrdinaryPath(dataDirectory, "dry-run canary data directory", true);
    assertOrdinaryPath(runDirectory, "dry-run canary run directory", true);

    const absolutePath = path.resolve(text);
    if (!samePath(path.dirname(absolutePath), runDirectory)) return null;
    assertOrdinaryPath(absolutePath, "dry-run canary log", false);
    const canonicalLogPath = realpathSync(absolutePath);
    if (!samePath(path.dirname(canonicalLogPath), canonicalRunDirectory)) return null;
    return safeCanaryLogPath(path.relative(repositoryRoot, canonicalLogPath));
  } catch {
    return null;
  }
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

function readBoundedCanaryLogBinding(relativePath) {
  const safePath = safeCanaryLogPath(relativePath);
  if (!safePath) throw new Error("dry-run canary log path is unsafe");
  const repositoryRoot = realpathSync(process.cwd());
  const dataDirectory = path.join(repositoryRoot, "data");
  const runDirectory = path.join(dataDirectory, "live-test-runs");
  const absolutePath = path.join(repositoryRoot, safePath);
  if (path.dirname(absolutePath) !== runDirectory) throw new Error("dry-run canary log escaped its run directory");
  assertOrdinaryPath(dataDirectory, "dry-run canary data directory", true);
  assertOrdinaryPath(runDirectory, "dry-run canary run directory", true);
  const initialPathStats = assertOrdinaryPath(absolutePath, "dry-run canary log", false);
  if (path.dirname(realpathSync(absolutePath)) !== realpathSync(runDirectory)) {
    throw new Error("dry-run canary log must not resolve through a reparse point");
  }

  const fd = openSync(absolutePath, "r");
  const digest = createHash("sha256");
  let bytes = 0;
  try {
    const initialHandleStats = fstatSync(fd);
    if (!initialHandleStats.isFile() || !sameFileFingerprint(initialPathStats, initialHandleStats)) {
      throw new Error("dry-run canary log changed before it could be read");
    }
    if (initialHandleStats.size > MAX_DRY_RUN_LOG_BYTES) {
      throw new Error("dry-run canary log is too large to bind safely");
    }
    const buffer = Buffer.alloc(Math.min(64 * 1024, Math.max(1, initialHandleStats.size)));
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      bytes += bytesRead;
      if (bytes > MAX_DRY_RUN_LOG_BYTES) throw new Error("dry-run canary log exceeded its safe bound");
      digest.update(buffer.subarray(0, bytesRead));
    }
    const finalHandleStats = fstatSync(fd);
    const finalPathStats = assertOrdinaryPath(absolutePath, "dry-run canary log", false);
    if (!sameFileFingerprint(initialHandleStats, finalHandleStats) || !sameFileFingerprint(initialHandleStats, finalPathStats)) {
      throw new Error("dry-run canary log changed while it was read");
    }
  } finally {
    closeSync(fd);
  }
  return { path: safePath, bytes, sha256: digest.digest("hex") };
}

function compactLines(output, limit = 24) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function formatCodeBlock(value) {
  const lines = compactLines(value);
  if (lines.length === 0) return "_No output captured._";
  return ["```text", ...lines, "```"].join("\n");
}

function summarizePlanner(step) {
  return {
    mode: extractScalar(step.output, "mode"),
    network: extractScalar(step.output, "network"),
    chainId: extractScalar(step.output, "chainId"),
    transactionSent: extractBooleanFlag(step.output, "transactionSent"),
    signingMaterialLoaded: extractBooleanFlag(step.output, "signingMaterialLoaded"),
    walletClientCreated: extractBooleanFlag(step.output, "walletClientCreated"),
    contractWriteSubmitted: extractBooleanFlag(step.output, "contractWriteSubmitted"),
    transactionLimit: extractScalar(step.output, "transactionLimit"),
    estimatedGas: extractScalar(step.output, "estimatedGas"),
    plannedTransfersLinea: extractScalar(step.output, "plannedTransfersLinea"),
  };
}

function summarizePendingNonce(step) {
  return {
    role: extractScalar(step.output, "role"),
    mode: extractScalar(step.output, "mode"),
    pendingGap: extractScalar(step.output, "pendingNonceGap") ?? extractScalar(step.output, "pendingGap"),
    wouldSend: extractScalar(step.output, "wouldSendReplacement") ?? extractScalar(step.output, "wouldSend"),
    transactionSent: extractBooleanFlag(step.output, "txSent") ?? extractBooleanFlag(step.output, "transactionSent"),
    signingMaterialLoaded: extractBooleanFlag(step.output, "signing") ?? extractBooleanFlag(step.output, "signingMaterialLoaded"),
    walletClientCreated: extractBooleanFlag(step.output, "walletClient") ?? extractBooleanFlag(step.output, "walletClientCreated"),
    contractWriteSubmitted: extractBooleanFlag(step.output, "contractWrite") ?? extractBooleanFlag(step.output, "contractWriteSubmitted"),
  };
}

function summarizeMatrix(step) {
  const rawOutput = step.rawOutput ?? step.output;
  return {
    network: extractValue(step.output, /\bnetwork=([a-z0-9_-]+)/i),
    chainId: extractValue(step.output, /\bchainId=([0-9]+)/),
    execution: extractValue(step.output, /\bexecution=([a-z-]+)/i),
    rounds: extractValue(step.output, /\brounds=([0-9]+)/),
    plannedBetTx: extractValue(step.output, /\bplannedBetTx=([0-9]+)/),
    plannedStake: extractValue(step.output, /\bplannedStake=([0-9.]+)/),
    walletReady: extractValue(step.output, /\bready=([0-9]+\/[0-9]+)/),
    walletSetSha256: extractSha256Flag(rawOutput, "walletSetSha256"),
    canaryPlanSha256: extractSha256Flag(rawOutput, "canaryPlanSha256"),
    transactionSent: extractBooleanFlag(step.output, "transactionSent"),
    signingMaterialLoaded: extractBooleanFlag(step.output, "signingMaterialLoaded"),
    walletClientCreated: extractBooleanFlag(step.output, "walletClientCreated"),
    contractWriteSubmitted: extractBooleanFlag(step.output, "contractWriteSubmitted"),
    log: extractCanaryLog(step.output),
  };
}

function summarizeAnalyzer(step) {
  const output = step.rawOutput ?? step.output;
  return {
    status: step.status,
    logName: extractValue(output, /^Log:\s*([^\r\n]+)$/m),
    logSha256: extractValue(output, /^Log SHA-256:\s*([a-f0-9]{64})\s*$/mi),
    logBytes: extractValue(output, /^Log bytes:\s*([0-9]+)\s*$/mi),
    dryRunProofBlocksG10G11: /blocked gates:\s*G10,\s*G11/i.test(output) || /\bG10\b[\s\S]*\bG11\b/.test(output),
    successfulBetTx:
      extractValue(output, /\bsuccessful bet tx:\s*([0-9]+)/i) ??
      extractValue(output, /\|\s*successful bet tx\s*\|\s*([0-9]+)\s*\|/i),
    uniqueBetEpochs:
      extractValue(output, /\bunique bet epochs:\s*([0-9]+)/i) ??
      extractValue(output, /\|\s*unique bet epochs\s*\|\s*([0-9]+)\s*\|/i),
    missingGasCases:
      extractValue(output, /missing V10 gas cases:\s*([^\r\n]+)/i) ??
      extractValue(output, /missing gas cases:\s*([^\r\n]+)/i),
  };
}

function bullet(label, value) {
  if (value === null || value === undefined || value === "") return null;
  return `- ${label}: ${formatPreviewField(value)}`;
}

function sha256Bullet(label, value) {
  const digest = String(value ?? "").trim();
  if (!/^[a-f0-9]{64}$/.test(digest)) return null;
  return `- ${label}: ${digest}`;
}

function formatPreviewField(value) {
  const text = redactProofText(String(value))
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= MAX_PREVIEW_FIELD_CHARS) return text;
  return `${text.slice(0, MAX_PREVIEW_FIELD_CHARS - 15)}...<truncated>`;
}

function renderBullets(items) {
  return items.filter(Boolean).join("\n") || "- no compact fields parsed; see redacted excerpt";
}

const planner = runStep("read-only planner", npmRun("plan:canary:v10:postdeploy:summary"));
const pendingNonce = runStep("pending nonce dry-run", npmRun("soak:testnet:clear-pending:summary"));
const matrix = runStep("V10 matrix dry-run", npmRun("live:canary:v10:matrix"));
const matrixSummary = summarizeMatrix(matrix);

let logBindingBefore = null;
let logBindingIssue = null;
if (matrixSummary.log) {
  try {
    logBindingBefore = readBoundedCanaryLogBinding(matrixSummary.log);
  } catch (error) {
    logBindingIssue = error instanceof Error ? error.message : "dry-run canary log binding failed";
  }
}

let analyzer = null;
if (matrixSummary.log) {
  analyzer = runStep(
    "dry-run proof analyzer",
    nodeCommand([
      "scripts/analyze-live-canary-proof.mjs",
      matrixSummary.log,
      "--profile=v10-matrix",
      "--strict",
      "--summary-only",
      "--require-epoch-bound",
      "--require-v10-gas-matrix",
    ]),
  );
}

const plannerSummary = summarizePlanner(planner);
const pendingSummary = summarizePendingNonce(pendingNonce);
const analyzerSummary = analyzer ? summarizeAnalyzer(analyzer) : null;
let logBindingAfter = null;
if (logBindingBefore) {
  try {
    logBindingAfter = readBoundedCanaryLogBinding(matrixSummary.log);
  } catch (error) {
    logBindingIssue = error instanceof Error ? error.message : "dry-run canary log binding failed";
  }
}
const analyzerBoundToCurrentLog = Boolean(
  analyzer &&
  logBindingBefore &&
  logBindingAfter &&
  logBindingBefore.bytes === logBindingAfter.bytes &&
  logBindingBefore.sha256 === logBindingAfter.sha256 &&
  analyzerSummary?.logName === path.basename(logBindingBefore.path) &&
  analyzerSummary?.logSha256 === logBindingAfter.sha256 &&
  analyzerSummary?.logBytes === String(logBindingAfter.bytes),
);

const hardFailures = [planner, pendingNonce, matrix].filter((step) => !step.ok);
const dryRunAnalyzerBlockedAsExpected =
  analyzer &&
  analyzer.spawnError === false &&
  Number.isInteger(analyzer.status) &&
  analyzer.status !== 0 &&
  analyzer.signal === null &&
  !analyzer.timedOut &&
  !analyzer.outputTooLarge &&
  analyzerSummary?.dryRunProofBlocksG10G11 === true &&
  analyzerSummary.successfulBetTx === "0" &&
  analyzerSummary.uniqueBetEpochs === "0" &&
  analyzerBoundToCurrentLog;
const signingMaterialReports = [
  plannerSummary.signingMaterialLoaded,
  pendingSummary.signingMaterialLoaded,
  matrixSummary.signingMaterialLoaded,
];
const signingMaterialLoaded =
  READ_ONLY_CHILD_BOUNDARY.signingMaterialLoaded || signingMaterialReports.some((reported) => reported === true);
const transactionSent = [
  plannerSummary.transactionSent,
  pendingSummary.transactionSent,
  matrixSummary.transactionSent,
].some((reported) => reported === true);
const walletClientCreated = [
  plannerSummary.walletClientCreated,
  pendingSummary.walletClientCreated,
  matrixSummary.walletClientCreated,
].some((reported) => reported === true);
const contractWriteSubmitted = [
  plannerSummary.contractWriteSubmitted,
  pendingSummary.contractWriteSubmitted,
  matrixSummary.contractWriteSubmitted,
].some((reported) => reported === true);
const operationBoundaryVerified =
  plannerSummary.mode === "read-only" &&
  plannerSummary.transactionSent === false &&
  plannerSummary.signingMaterialLoaded === false &&
  plannerSummary.walletClientCreated === false &&
  plannerSummary.contractWriteSubmitted === false &&
  pendingSummary.mode === "dry-run" &&
  pendingSummary.wouldSend === "false" &&
  pendingSummary.transactionSent === false &&
  pendingSummary.signingMaterialLoaded === false &&
  pendingSummary.walletClientCreated === false &&
  pendingSummary.contractWriteSubmitted === false &&
  matrixSummary.execution === "dry-run" &&
  matrixSummary.signingMaterialLoaded === false &&
  matrixSummary.transactionSent === false &&
  matrixSummary.walletClientCreated === false &&
  matrixSummary.contractWriteSubmitted === false &&
  !transactionSent &&
  !walletClientCreated &&
  !contractWriteSubmitted;
const walletSetBound = /^[a-f0-9]{64}$/.test(matrixSummary.walletSetSha256 ?? "");
const canaryPlanBound = /^[a-f0-9]{64}$/.test(matrixSummary.canaryPlanSha256 ?? "");
const status =
  hardFailures.length === 0 &&
  operationBoundaryVerified &&
  walletSetBound &&
  canaryPlanBound &&
  !signingMaterialLoaded &&
  (analyzer?.ok || dryRunAnalyzerBlockedAsExpected)
    ? "pass"
    : "fail";

const markdown = `# V10 Canary Dry-Run Preview

Last updated: ${new Date().toISOString()}.

Scope: Linea Sepolia V10 read-only and dry-run readiness only. This document is
not an authorization to send transactions, start a soak, deploy, or change
contract behavior.

Generated by:

\`\`\`powershell
npm.cmd run preview:canary:v10:dry-run
\`\`\`

## Overall Status

${renderBullets([
  bullet("status", status),
  bullet("rpcLabel", process.env.LIVE_CANARY_RPC_LABEL || DEFAULT_RPC_LABEL),
  bullet("transactionSent", transactionSent),
  bullet("signingMaterialLoaded", signingMaterialLoaded),
  bullet("operationalBoundaryVerified", operationBoundaryVerified),
  bullet("walletClientCreated", walletClientCreated),
  bullet("contractWriteSubmitted", contractWriteSubmitted),
  bullet("dryRunProofBlocksG10G11", Boolean(dryRunAnalyzerBlockedAsExpected)),
  sha256Bullet("walletSetSha256", matrixSummary.walletSetSha256),
  sha256Bullet("canaryPlanSha256", matrixSummary.canaryPlanSha256),
  bullet("canaryLogBound", analyzerBoundToCurrentLog),
])}

## Read-Only Planner

Command:

\`\`\`powershell
npm.cmd run plan:canary:v10:postdeploy:summary
\`\`\`

${renderBullets([
  bullet("exit", planner.status),
  bullet("errorCode", planner.errorCode),
  bullet("mode", plannerSummary.mode),
  bullet("network", plannerSummary.network),
  bullet("chainId", plannerSummary.chainId),
  bullet("transactionSent", plannerSummary.transactionSent),
  bullet("signingMaterialLoaded", plannerSummary.signingMaterialLoaded),
  bullet("walletClientCreated", plannerSummary.walletClientCreated),
  bullet("contractWriteSubmitted", plannerSummary.contractWriteSubmitted),
  bullet("transactionLimit", plannerSummary.transactionLimit),
  bullet("estimatedGas", plannerSummary.estimatedGas),
  bullet("plannedTransfersLinea", plannerSummary.plannedTransfersLinea),
])}

Redacted excerpt:

${formatCodeBlock(planner.output)}

## Pending Nonce Dry-Run

Command:

\`\`\`powershell
npm.cmd run soak:testnet:clear-pending:summary
\`\`\`

${renderBullets([
  bullet("exit", pendingNonce.status),
  bullet("errorCode", pendingNonce.errorCode),
  bullet("role", pendingSummary.role),
  bullet("mode", pendingSummary.mode),
  bullet("pendingGap", pendingSummary.pendingGap),
  bullet("wouldSend", pendingSummary.wouldSend),
  bullet("transactionSent", pendingSummary.transactionSent),
  bullet("signingMaterialLoaded", pendingSummary.signingMaterialLoaded),
  bullet("walletClientCreated", pendingSummary.walletClientCreated),
  bullet("contractWriteSubmitted", pendingSummary.contractWriteSubmitted),
])}

Redacted excerpt:

${formatCodeBlock(pendingNonce.output)}

## V10 Matrix Dry-Run

Command:

\`\`\`powershell
$env:LIVE_CANARY_RPC_LABEL = "${process.env.LIVE_CANARY_RPC_LABEL || DEFAULT_RPC_LABEL}"
npm.cmd run live:canary:v10:matrix
\`\`\`

${renderBullets([
  bullet("exit", matrix.status),
  bullet("errorCode", matrix.errorCode),
  bullet("network", matrixSummary.network),
  bullet("chainId", matrixSummary.chainId),
  bullet("execution", matrixSummary.execution),
  bullet("rounds", matrixSummary.rounds),
  bullet("plannedBetTx", matrixSummary.plannedBetTx),
  bullet("plannedStake", matrixSummary.plannedStake),
  bullet("walletPreflightReady", matrixSummary.walletReady),
  sha256Bullet("walletSetSha256", matrixSummary.walletSetSha256),
  sha256Bullet("canaryPlanSha256", matrixSummary.canaryPlanSha256),
  bullet("transactionSent", matrixSummary.transactionSent),
  bullet("signingMaterialLoaded", matrixSummary.signingMaterialLoaded),
  bullet("walletClientCreated", matrixSummary.walletClientCreated),
  bullet("contractWriteSubmitted", matrixSummary.contractWriteSubmitted),
  bullet("log", matrixSummary.log),
  bullet("logBytes", logBindingAfter?.bytes),
  sha256Bullet("logSha256", logBindingAfter?.sha256),
])}

Redacted excerpt:

${formatCodeBlock(matrix.output)}

## Dry-Run Proof Analysis

Command:

\`\`\`powershell
node scripts/analyze-live-canary-proof.mjs ${matrixSummary.log ?? "<missing-log>"} --profile=v10-matrix --strict --summary-only --require-epoch-bound --require-v10-gas-matrix
\`\`\`

${analyzer ? renderBullets([
  bullet("exit", analyzer.status),
  bullet("dryRunProofBlocksG10G11", analyzerSummary.dryRunProofBlocksG10G11),
  bullet("successfulBetTx", analyzerSummary.successfulBetTx),
  bullet("uniqueBetEpochs", analyzerSummary.uniqueBetEpochs),
  sha256Bullet("logSha256", analyzerSummary.logSha256),
  bullet("logBytes", analyzerSummary.logBytes),
  bullet("missingGasCases", analyzerSummary.missingGasCases),
]) : "- analyzer skipped because the matrix dry-run did not expose a log path"}

Redacted excerpt:

${formatCodeBlock(analyzer?.output ?? "")}

## Fresh Consent Boundary

Do not execute any of the following without a fresh exact authorization after a
fresh Preview rerun:

- claim, rebate, resolver-reward, or protocol-fee transactions from the planner;
- V10 matrix bet transactions;
- approval transactions required by wallet preflight;
- resolver transactions;
- pending-nonce replacements;
- managed soak or live supervisor execution.

Minimum fresh authorization fields:

- chain and contract target: Linea Sepolia V10
- exact tranche: claim/flush, V10 matrix bets, approvals, resolver, or soak
- maximum transaction count
- maximum stake or transfer amount
- maximum native gas budget
- permitted roles
- stop criteria
- confirmation that no already-completed transaction should be repeated
- exact Preview SHA-256, walletSetSha256, and canaryPlanSha256 copied from this fresh output
`;

writeFileSync(PREVIEW_PATH, markdown, "utf8");
const previewSha256 = createHash("sha256").update(markdown, "utf8").digest("hex");

console.log(JSON.stringify({
  status,
  previewPath: PREVIEW_PATH,
  plannerExit: planner.status,
  pendingNonceExit: pendingNonce.status,
  matrixExit: matrix.status,
  analyzerExit: analyzer?.status ?? null,
  canaryLog: matrixSummary.log ?? null,
  canaryLogSha256: logBindingAfter?.sha256 ?? null,
  canaryLogBound: analyzerBoundToCurrentLog,
  previewSha256,
  walletSetSha256: matrixSummary.walletSetSha256 ?? null,
  canaryPlanSha256: matrixSummary.canaryPlanSha256 ?? null,
  logBindingIssue,
  dryRunProofBlocksG10G11: Boolean(dryRunAnalyzerBlockedAsExpected),
  transactionSent,
  signingMaterialLoaded,
  operationalBoundaryVerified: operationBoundaryVerified,
  walletClientCreated,
  contractWriteSubmitted,
}));

if (status !== "pass") {
  process.exitCode = 1;
}
