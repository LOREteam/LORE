import "dotenv/config";
import { isAbsolute, relative, resolve } from "node:path";
import {
  createResendAlertSender,
  createTelegramAlertSender,
  applyRuntimeIssueDeliveryResult,
  evaluateChainIndexerAudit,
  evaluateBackupFreshness,
  evaluateCanaryActivity,
  evaluateCanaryRevertWindow,
  evaluateRuntimeSnapshot,
  loadRuntimeIssueState,
  reconcileRuntimeIssues,
  readBoundedTextTail,
  readBoundedJsonFile,
  readLatestBackupSnapshot,
  saveRuntimeIssueState,
} from "./runtime-monitor-lib.mjs";
import { assertTrustedHealthCredentialOrigin } from "./health-credential-origin.mjs";
import { redactProofText } from "./redact-proof-output.mjs";

const MAX_RUNTIME_MONITOR_RESPONSE_BYTES = 256 * 1024;
const MAX_RUNTIME_MONITOR_ERROR_CHARS = 500;
const CONTENT_LENGTH_RE = /^(?:0|[1-9]\d{0,15})$/;
const DECIMAL_INTEGER_RE = /^(?:0|[1-9]\d{0,15})$/;
const POSITIVE_SAFE_INTEGER_TEXT_RE = /^[1-9]\d{0,15}$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_HEALTH_DIAGNOSTICS_SECRET_LENGTH = 32;
const MAX_HEALTH_DIAGNOSTICS_SECRET_LENGTH = 256;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;
const summaryOnly = process.argv.includes("--summary-only");
const configErrors = [];

function describeRuntimeMonitorError(error) {
  const text = redactProofText(error instanceof Error ? error.message : "configuration error")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= MAX_RUNTIME_MONITOR_ERROR_CHARS) return text;
  return `${text.slice(0, MAX_RUNTIME_MONITOR_ERROR_CHARS - 15)}...<truncated>`;
}

function parseOptionalUint256Env(name) {
  const value = process.env[name]?.trim();
  if (!value) return null;
  if (!/^(0|[1-9]\d{0,77})$/.test(value) || BigInt(value) >= (1n << 256n)) {
    configErrors.push(`${name} must be an unsigned uint256 integer`);
    return null;
  }
  return BigInt(value);
}

function parseRuntimeMonitorIntegerEnv(name, fallback, { min, max }) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!DECIMAL_INTEGER_RE.test(raw)) {
    configErrors.push(`${name} must be a canonical decimal integer`);
    return fallback;
  }
  const parsed = BigInt(raw);
  const minBigInt = BigInt(min);
  const maxBigInt = BigInt(max);
  if (parsed > MAX_SAFE_INTEGER_BIGINT || parsed < minBigInt || parsed > maxBigInt) {
    configErrors.push(`${name} must be between ${min} and ${max}`);
    return fallback;
  }
  return Number(parsed);
}

function parseHealthDiagnosticsSecretEnv(name) {
  const secret = process.env[name]?.trim();
  if (!secret) return "";
  if (
    secret.length < MIN_HEALTH_DIAGNOSTICS_SECRET_LENGTH ||
    secret.length > MAX_HEALTH_DIAGNOSTICS_SECRET_LENGTH ||
    CONTROL_CHAR_RE.test(secret)
  ) {
    configErrors.push(`${name} must be 32..256 non-control characters`);
    return "";
  }
  return secret;
}

function isFinalHttpsOrigin(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    const host = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      (host.includes(".") || host.includes(":")) &&
      !(
        host === "localhost" ||
        host === "0.0.0.0" ||
        host === "::" ||
        host === "::1" ||
        host === "127.0.0.1" ||
        host.endsWith(".localhost") ||
        host.endsWith(".local") ||
        host.endsWith(".example") ||
        host.endsWith(".test") ||
        host.endsWith(".invalid") ||
        /^0\./.test(host) ||
        /^127\./.test(host) ||
        /^10\./.test(host) ||
        /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
        /^169\.254\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
        /^192\.0\.2\./.test(host) ||
        /^198\.(1[89])\./.test(host) ||
        /^198\.51\.100\./.test(host) ||
        /^203\.0\.113\./.test(host) ||
        /^::ffff:/i.test(host) ||
        /^f[cd][0-9a-f]*:/i.test(host) ||
        /^fe[89ab][0-9a-f]*:/i.test(host) ||
        /^2001:db8:/i.test(host)
      );
  } catch {
    return false;
  }
}

function isRuntimeMonitorOrigin(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    return !url.username &&
      !url.password &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "";
  } catch {
    return false;
  }
}

function normalizeMonitorNetwork(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["mainnet", "main", "linea", "prod", "production"].includes(normalized) ? "mainnet" : "sepolia";
}

function isPositiveSafeIntegerText(value) {
  const trimmed = String(value ?? "").trim();
  if (!POSITIVE_SAFE_INTEGER_TEXT_RE.test(trimmed)) return false;
  return BigInt(trimmed) <= MAX_SAFE_INTEGER_BIGINT;
}

const baseUrl = process.env.RUNTIME_MONITOR_BASE_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim() || "";
const diagnosticsSecret = parseHealthDiagnosticsSecretEnv("HEALTH_DIAGNOSTICS_SECRET");
const intervalMs = parseRuntimeMonitorIntegerEnv("RUNTIME_MONITOR_INTERVAL_MS", 30_000, { min: 10_000, max: 86_400_000 });
const timeoutMs = parseRuntimeMonitorIntegerEnv("RUNTIME_MONITOR_TIMEOUT_MS", 15_000, { min: 1_000, max: 300_000 });
const stuckGraceMs = parseRuntimeMonitorIntegerEnv("RUNTIME_MONITOR_STUCK_GRACE_MS", 120_000, { min: 1_000, max: 86_400_000 });
const maxLiveStateAgeMs = parseRuntimeMonitorIntegerEnv("RUNTIME_MONITOR_MAX_LIVE_STATE_AGE_MS", 120_000, { min: 1_000, max: 86_400_000 });
const maxRssBytes = parseRuntimeMonitorIntegerEnv("RUNTIME_MONITOR_MAX_RSS_BYTES", 0, { min: 0, max: Number.MAX_SAFE_INTEGER });
const maxWalBytes = parseRuntimeMonitorIntegerEnv("RUNTIME_MONITOR_MAX_WAL_BYTES", 0, { min: 0, max: Number.MAX_SAFE_INTEGER });
const minDiskFreeBytes = parseRuntimeMonitorIntegerEnv("RUNTIME_MONITOR_MIN_DISK_FREE_BYTES", 1_073_741_824, { min: 0, max: Number.MAX_SAFE_INTEGER });
const canaryLogPath = process.env.RUNTIME_MONITOR_CANARY_LOG_PATH?.trim() || "";
const canaryRevertWindowMs = parseRuntimeMonitorIntegerEnv("RUNTIME_MONITOR_CANARY_REVERT_WINDOW_MS", 300_000, { min: 1_000, max: 86_400_000 });
const canaryRevertThreshold = parseRuntimeMonitorIntegerEnv("RUNTIME_MONITOR_CANARY_REVERT_THRESHOLD", 3, { min: 1, max: 1_000 });
const canaryMaxStaleMs = parseRuntimeMonitorIntegerEnv("RUNTIME_MONITOR_CANARY_MAX_STALE_MS", 300_000, { min: 1_000, max: 86_400_000 });
const chainAuditPath = process.env.RUNTIME_MONITOR_CHAIN_AUDIT_PATH?.trim() || "";
const chainAuditMaxAgeMs = parseRuntimeMonitorIntegerEnv("RUNTIME_MONITOR_CHAIN_AUDIT_MAX_AGE_MS", 3_600_000, { min: 1_000, max: 86_400_000 });
const maxAccruedProtocolFeesWei = parseOptionalUint256Env("RUNTIME_MONITOR_MAX_ACCRUED_PROTOCOL_FEES_WEI");
const backupDirectory = process.env.RUNTIME_MONITOR_BACKUP_DIR?.trim() || process.env.LORE_BACKUP_DIR?.trim() || "";
const backupMaxAgeMsRaw = process.env.RUNTIME_MONITOR_BACKUP_MAX_AGE_MS?.trim() || "";
const backupMaxAgeMs = parseRuntimeMonitorIntegerEnv("RUNTIME_MONITOR_BACKUP_MAX_AGE_MS", 129_600_000, { min: 1, max: 86_400_000_000 });
const allowLocal = process.env.RUNTIME_MONITOR_ALLOW_LOCAL === "1";
const allowNoAlerts = process.env.RUNTIME_MONITOR_ALLOW_NO_ALERTS === "1";
const statePath = process.env.RUNTIME_MONITOR_STATE_PATH?.trim() || "data/runtime-monitor-state.json";
const telegramAlertSender = createTelegramAlertSender();
const resendAlertSender = createResendAlertSender();
const alertSenders = [telegramAlertSender, resendAlertSender];
const alertsConfigured = alertSenders.some((sender) => sender.configured);
const resendConfigured = resendAlertSender.configured;
const configuredNetwork = normalizeMonitorNetwork(process.env.LINEA_NETWORK || process.env.NEXT_PUBLIC_LINEA_NETWORK);
const strictProductionLikeMonitor = process.env.NODE_ENV === "production" ||
  configuredNetwork === "mainnet" ||
  (configuredNetwork === "sepolia" && process.env.LORE_PREMAINNET_RUNTIME_STRICT === "1");
const activeIssues = loadRuntimeIssueState(statePath);
let stopping = false;
const REPO_ROOT = process.cwd();

function backupDirectoryIsExternalSafe() {
  if (!backupDirectory || allowLocal) return true;
  if (!isAbsolute(backupDirectory)) return false;
  const rel = relative(REPO_ROOT, resolve(backupDirectory));
  return rel !== "" && (rel.startsWith("..") || rel.includes(":"));
}

function getRuntimeMonitorMissingConfig() {
  const missing = [];
  const baseIsOriginOnly = Boolean(baseUrl) && isRuntimeMonitorOrigin(baseUrl);
  const baseHasAllowedNetworkLocation = baseIsOriginOnly && (allowLocal || isFinalHttpsOrigin(baseUrl));
  if (configErrors.length > 0) missing.push("invalid-config");
  if (!baseUrl) {
    missing.push("base-url");
  } else if (!baseIsOriginOnly) {
    missing.push("origin-only-base-url");
  } else if (!baseHasAllowedNetworkLocation) {
    missing.push("public-https-base-url");
  }
  if (!diagnosticsSecret) missing.push("health-diagnostics-secret");
  if (baseHasAllowedNetworkLocation && diagnosticsSecret) {
    try {
      assertTrustedHealthCredentialOrigin({
        target: baseUrl,
        canonicalOrigin: process.env.NEXT_PUBLIC_SITE_URL,
        targetName: "RUNTIME_MONITOR_BASE_URL",
      });
    } catch {
      missing.push("trusted-health-origin");
    }
  }
  if (!alertsConfigured && !allowNoAlerts) missing.push("alert-channel");
  if (strictProductionLikeMonitor && !allowLocal && !resendConfigured) missing.push("resend-email");
  if (strictProductionLikeMonitor && !allowLocal && !backupDirectory) missing.push("backup-directory");
  if (strictProductionLikeMonitor && !allowLocal && !isPositiveSafeIntegerText(backupMaxAgeMsRaw)) {
    missing.push("backup-max-age");
  }
  if (!backupDirectoryIsExternalSafe()) missing.push("external-backup-directory");
  return missing;
}

function getRuntimeMonitorConfigSummary(status, error) {
  const output = {
    status,
    mode: "runtime-monitor-config",
    groups: "monitoring=1",
    network: configuredNetwork,
    strictProductionLike: strictProductionLikeMonitor,
    allowLocal,
    missingConfig: getRuntimeMonitorMissingConfig(),
    alertsConfigured,
    telegramConfigured: telegramAlertSender.configured,
    resendConfigured,
    backupConfigured: Boolean(backupDirectory),
    backupMaxAgeConfigured: isPositiveSafeIntegerText(backupMaxAgeMsRaw),
    canaryLogConfigured: Boolean(canaryLogPath),
    chainAuditConfigured: Boolean(chainAuditPath),
    intervalMs,
    timeoutMs,
    wouldPoll: false,
    wouldSendAlerts: false,
  };
  if (error) output.error = describeRuntimeMonitorError(error);
  return output;
}

async function sendAlert(message, key, cooldownMs) {
  const deliveries = await Promise.allSettled(
    alertSenders.map((sender) => sender.send(message, key, cooldownMs)),
  );
  return deliveries.some((delivery) => delivery.status === "fulfilled" && delivery.value);
}

function validateConfig() {
  if (configErrors.length > 0) throw new Error(configErrors[0]);
  if (!baseUrl) throw new Error("RUNTIME_MONITOR_BASE_URL or NEXT_PUBLIC_SITE_URL is required");
  const url = new URL(baseUrl);
  if (!isRuntimeMonitorOrigin(baseUrl)) {
    throw new Error("RUNTIME_MONITOR_BASE_URL must be an origin without credentials, path, query, or hash");
  }
  if (!allowLocal && !isFinalHttpsOrigin(baseUrl)) {
    throw new Error("RUNTIME_MONITOR_BASE_URL must be a public HTTPS origin without path, query, or hash");
  }
  if (!diagnosticsSecret) throw new Error("HEALTH_DIAGNOSTICS_SECRET is required");
  if (!alertsConfigured && !allowNoAlerts) throw new Error("Telegram or Resend email alert configuration is required");
  if (strictProductionLikeMonitor && !allowLocal && !resendConfigured) {
    throw new Error("Resend email alert configuration is required for production-like runtime monitoring");
  }
  if (strictProductionLikeMonitor && !allowLocal && !backupDirectory) {
    throw new Error("RUNTIME_MONITOR_BACKUP_DIR or LORE_BACKUP_DIR is required for production-like runtime monitoring");
  }
  if (strictProductionLikeMonitor && !allowLocal && !isPositiveSafeIntegerText(backupMaxAgeMsRaw)) {
    throw new Error("RUNTIME_MONITOR_BACKUP_MAX_AGE_MS is required as a positive safe integer for production-like runtime monitoring");
  }
  if (backupDirectory && !allowLocal) {
    if (!isAbsolute(backupDirectory)) {
      throw new Error("RUNTIME_MONITOR_BACKUP_DIR or LORE_BACKUP_DIR must be absolute outside local monitor mode");
    }
    if (!backupDirectoryIsExternalSafe()) {
      throw new Error("RUNTIME_MONITOR_BACKUP_DIR or LORE_BACKUP_DIR must be outside the repo checkout");
    }
  }
  return assertTrustedHealthCredentialOrigin({
    target: url,
    canonicalOrigin: process.env.NEXT_PUBLIC_SITE_URL,
    targetName: "RUNTIME_MONITOR_BASE_URL",
  });
}

async function fetchJson(origin, pathname) {
  const response = await fetch(new URL(pathname, origin), {
    headers: {
      "cache-control": "no-cache",
      "x-health-diagnostics-secret": diagnosticsSecret,
    },
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return readBoundedJsonResponse(response);
}

function parseContentLengthHeader(value) {
  if (value == null || value === "") return null;
  if (!CONTENT_LENGTH_RE.test(value)) throw new Error("invalid runtime monitor response content-length");
  const parsed = BigInt(value);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) throw new Error("invalid runtime monitor response content-length");
  return Number(parsed);
}

async function readBoundedJsonResponse(response) {
  const contentLength = parseContentLengthHeader(response.headers.get("content-length"));
  if (contentLength !== null && contentLength > MAX_RUNTIME_MONITOR_RESPONSE_BYTES) {
    throw new Error("runtime monitor response body too large");
  }
  if (!response.body) throw new Error("runtime monitor response body is empty");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_RUNTIME_MONITOR_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("runtime monitor response body too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return JSON.parse(text);
}

async function poll(origin) {
  let issues;
  try {
    const [runtime, dataSync, liveState] = await Promise.all([
      fetchJson(origin, "/api/health/runtime"),
      fetchJson(origin, "/api/health/data-sync"),
      fetchJson(origin, "/api/live-state"),
    ]);
    issues = evaluateRuntimeSnapshot({
      runtime,
      dataSync,
      liveState,
      stuckGraceMs,
      maxLiveStateAgeMs,
      maxRssBytes,
      maxWalBytes,
      minDiskFreeBytes,
    });
  } catch {
    issues = [{ key: "health-request", message: "Runtime health endpoints are unavailable." }];
  }
  if (canaryLogPath) {
    try {
      const canaryTail = readBoundedTextTail(canaryLogPath);
      issues.push(...evaluateCanaryRevertWindow(canaryTail, {
        nowMs: Date.now(),
        windowMs: canaryRevertWindowMs,
        threshold: canaryRevertThreshold,
      }));
      issues.push(...evaluateCanaryActivity(canaryTail, {
        nowMs: Date.now(),
        maxAgeMs: canaryMaxStaleMs,
      }));
    } catch {
      issues.push({ key: "canary-log-unavailable", message: "Configured canary log is unavailable." });
    }
  }
  if (chainAuditPath) {
    try {
      issues.push(...evaluateChainIndexerAudit(readBoundedJsonFile(chainAuditPath), {
        nowMs: Date.now(),
        maxAgeMs: chainAuditMaxAgeMs,
        maxAccruedProtocolFeesWei,
      }));
    } catch {
      issues.push({ key: "chain-indexer-audit-unavailable", message: "Configured chain/indexer audit artifact is unavailable." });
    }
  }
  if (backupDirectory) {
    try {
      issues.push(...evaluateBackupFreshness(readLatestBackupSnapshot(backupDirectory), {
        nowMs: Date.now(),
        maxAgeMs: backupMaxAgeMs,
      }));
    } catch {
      issues.push({ key: "sqlite-backup-unavailable", message: "Configured SQLite backup directory is unavailable." });
    }
  }

  const transitions = reconcileRuntimeIssues(activeIssues, issues);
  for (const issue of transitions.alerts) {
    console.error(`[runtime-monitor] ALERT ${issue.key}: ${issue.message}`);
    const delivered = await sendAlert(`ALERT: ${issue.message}`, `runtime-${issue.key}`);
    applyRuntimeIssueDeliveryResult(activeIssues, { ...issue, kind: "alert" }, {
      configured: alertsConfigured,
      delivered,
    });
  }
  for (const recovery of transitions.recoveries) {
    console.log(`[runtime-monitor] RECOVERED ${recovery.key}`);
    const delivered = await sendAlert(`RECOVERED: ${recovery.message}`, `runtime-recovered-${recovery.key}`, 60_000);
    applyRuntimeIssueDeliveryResult(activeIssues, { ...recovery, kind: "recovery" }, {
      configured: alertsConfigured,
      delivered,
    });
  }
  try {
    saveRuntimeIssueState(statePath, activeIssues);
  } catch {
    console.error("[runtime-monitor] state persistence failed");
  }
  if (issues.length === 0) console.log(`[runtime-monitor] OK ${new Date().toISOString()}`);
}

async function main() {
  const origin = validateConfig();
  if (summaryOnly) {
    console.log(JSON.stringify(getRuntimeMonitorConfigSummary("pass")));
    return;
  }
  console.log(`[runtime-monitor] started intervalMs=${intervalMs} stuckGraceMs=${stuckGraceMs}`);
  while (!stopping) {
    await poll(origin);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

process.once("SIGINT", () => { stopping = true; });
process.once("SIGTERM", () => { stopping = true; });

main().catch((error) => {
  if (summaryOnly) {
    console.log(JSON.stringify(getRuntimeMonitorConfigSummary("fail", error)));
    process.exitCode = 1;
    return;
  }
  console.error(`[runtime-monitor] fatal: ${describeRuntimeMonitorError(error)}`);
  process.exitCode = 1;
});
