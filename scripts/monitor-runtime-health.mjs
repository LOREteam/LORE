import "dotenv/config";
import {
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
import { parsePositiveIntegerEnv } from "./env-parsing.mjs";

const baseUrl = process.env.RUNTIME_MONITOR_BASE_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim() || "";
const diagnosticsSecret = process.env.HEALTH_DIAGNOSTICS_SECRET?.trim() || "";
const intervalMs = parsePositiveIntegerEnv(process.env.RUNTIME_MONITOR_INTERVAL_MS, 30_000);
const timeoutMs = parsePositiveIntegerEnv(process.env.RUNTIME_MONITOR_TIMEOUT_MS, 15_000);
const stuckGraceMs = parsePositiveIntegerEnv(process.env.RUNTIME_MONITOR_STUCK_GRACE_MS, 120_000);
const maxLiveStateAgeMs = parsePositiveIntegerEnv(process.env.RUNTIME_MONITOR_MAX_LIVE_STATE_AGE_MS, 120_000);
const maxRssBytes = parsePositiveIntegerEnv(process.env.RUNTIME_MONITOR_MAX_RSS_BYTES, 0);
const maxWalBytes = parsePositiveIntegerEnv(process.env.RUNTIME_MONITOR_MAX_WAL_BYTES, 0);
const minDiskFreeBytes = parsePositiveIntegerEnv(process.env.RUNTIME_MONITOR_MIN_DISK_FREE_BYTES, 1_073_741_824);
const canaryLogPath = process.env.RUNTIME_MONITOR_CANARY_LOG_PATH?.trim() || "";
const canaryRevertWindowMs = parsePositiveIntegerEnv(process.env.RUNTIME_MONITOR_CANARY_REVERT_WINDOW_MS, 300_000);
const canaryRevertThreshold = parsePositiveIntegerEnv(process.env.RUNTIME_MONITOR_CANARY_REVERT_THRESHOLD, 3);
const canaryMaxStaleMs = parsePositiveIntegerEnv(process.env.RUNTIME_MONITOR_CANARY_MAX_STALE_MS, 300_000);
const chainAuditPath = process.env.RUNTIME_MONITOR_CHAIN_AUDIT_PATH?.trim() || "";
const chainAuditMaxAgeMs = parsePositiveIntegerEnv(process.env.RUNTIME_MONITOR_CHAIN_AUDIT_MAX_AGE_MS, 3_600_000);
const backupDirectory = process.env.RUNTIME_MONITOR_BACKUP_DIR?.trim() || process.env.LORE_BACKUP_DIR?.trim() || "";
const backupMaxAgeMs = parsePositiveIntegerEnv(process.env.RUNTIME_MONITOR_BACKUP_MAX_AGE_MS, 129_600_000);
const allowLocal = process.env.RUNTIME_MONITOR_ALLOW_LOCAL === "1";
const allowNoAlerts = process.env.RUNTIME_MONITOR_ALLOW_NO_ALERTS === "1";
const statePath = process.env.RUNTIME_MONITOR_STATE_PATH?.trim() || "data/runtime-monitor-state.json";
const alertSender = createTelegramAlertSender();
const activeIssues = loadRuntimeIssueState(statePath);
let stopping = false;

function validateConfig() {
  const url = new URL(baseUrl);
  if (!allowLocal && url.protocol !== "https:") throw new Error("RUNTIME_MONITOR_BASE_URL must use HTTPS");
  if (!diagnosticsSecret) throw new Error("HEALTH_DIAGNOSTICS_SECRET is required");
  if (!alertSender.configured && !allowNoAlerts) throw new Error("Telegram alert configuration is required");
  if (intervalMs < 10_000) throw new Error("RUNTIME_MONITOR_INTERVAL_MS must be at least 10000");
  return url;
}

async function fetchJson(origin, pathname) {
  const response = await fetch(new URL(pathname, origin), {
    headers: {
      "cache-control": "no-cache",
      "x-health-diagnostics-secret": diagnosticsSecret,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
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
    const delivered = await alertSender.send(`ALERT: ${issue.message}`, `runtime-${issue.key}`);
    applyRuntimeIssueDeliveryResult(activeIssues, { ...issue, kind: "alert" }, {
      configured: alertSender.configured,
      delivered,
    });
  }
  for (const recovery of transitions.recoveries) {
    console.log(`[runtime-monitor] RECOVERED ${recovery.key}`);
    const delivered = await alertSender.send(`RECOVERED: ${recovery.message}`, `runtime-recovered-${recovery.key}`, 60_000);
    applyRuntimeIssueDeliveryResult(activeIssues, { ...recovery, kind: "recovery" }, {
      configured: alertSender.configured,
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
  console.log(`[runtime-monitor] started intervalMs=${intervalMs} stuckGraceMs=${stuckGraceMs}`);
  while (!stopping) {
    await poll(origin);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

process.once("SIGINT", () => { stopping = true; });
process.once("SIGTERM", () => { stopping = true; });

main().catch((error) => {
  console.error(`[runtime-monitor] fatal: ${error instanceof Error ? error.message : "configuration error"}`);
  process.exitCode = 1;
});
