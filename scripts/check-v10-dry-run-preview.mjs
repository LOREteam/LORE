import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { getPreviewAgeMs } from "./preview-freshness.mjs";

const PREVIEW_PATH = path.join("docs", "v10-canary-dry-run-preview.md");
const MAX_PREVIEW_BYTES = 512 * 1024;
const MAX_DRY_RUN_LOG_BYTES = 256 * 1024;
const DECIMAL_INTEGER_RE = /^(?:0|[1-9]\d{0,15})$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const requireFreshAuthorization = process.argv.includes("--require-fresh-authorization");
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
  const stats = statSync(filePath);
  if (!stats.isFile()) throw new Error(`${label} must be a regular file`);
  if (stats.size > maxBytes) throw new Error(`${label} is too large to validate safely`);
  return readFileSync(filePath, "utf8");
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
  return source.match(new RegExp(`^- ${escaped}:\\s*(.+?)\\s*$`, "m"))?.[1]?.trim() ?? "";
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

function parseDecimalText(value, label) {
  const text = String(value ?? "").trim();
  if (!DECIMAL_INTEGER_RE.test(text)) throw new Error(`${label} must be a canonical decimal integer`);
  const parsed = BigInt(text);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) throw new Error(`${label} is too large to report safely`);
  return Number(parsed);
}

function lineCount(text) {
  if (!text) return 0;
  return text.split(/\r?\n/).filter((line) => line.length > 0).length;
}

function validatePreview() {
  if (!existsSync(PREVIEW_PATH)) throw new Error("V10 dry-run Preview markdown is missing");
  const previewStats = statSync(PREVIEW_PATH);
  const markdown = readBoundedText(PREVIEW_PATH, MAX_PREVIEW_BYTES, "V10 dry-run Preview markdown");
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
  requireBullet(overall, "walletClientCreated", "false");
  requireBullet(overall, "contractWriteSubmitted", "false");
  requireBullet(overall, "dryRunProofBlocksG10G11", "true");

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
  const plannedBetTx = parseDecimalText(bullet(matrix, "plannedBetTx"), "plannedBetTx");
  const logPath = safeCanaryLogPath(bullet(matrix, "log"));
  if (!logPath) throw new Error("V10 dry-run Preview must reference only a safe relative live-test-run log");
  if (!existsSync(logPath)) throw new Error("V10 dry-run Preview referenced log is missing");
  const logStats = statSync(logPath);
  const logText = readBoundedText(logPath, MAX_DRY_RUN_LOG_BYTES, "V10 dry-run Preview referenced log");

  const analyzer = section(markdown, "Dry-Run Proof Analysis");
  requireBullet(analyzer, "exit", "1");
  requireBullet(analyzer, "dryRunProofBlocksG10G11", "true");
  requireBullet(analyzer, "successfulBetTx", "0");
  requireBullet(analyzer, "uniqueBetEpochs", "0");

  return {
    status: "pass",
    previewPath: PREVIEW_PATH,
    ageMinutes: Math.floor(ageMs / 60_000),
    maxPreviewAgeMinutes: Math.floor(maxPreviewAgeMs / 60_000),
    authorizationFreshnessRequired: requireFreshAuthorization,
    previewBytes: previewStats.size,
    canaryLog: logPath,
    logBytes: logStats.size,
    logLines: lineCount(logText),
    transactionLimit,
    estimatedGas,
    plannedBetTx,
    transactionSent: false,
    signingMaterialLoaded: false,
    walletClientCreated: false,
    contractWriteSubmitted: false,
    dryRunProofBlocksG10G11: true,
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
