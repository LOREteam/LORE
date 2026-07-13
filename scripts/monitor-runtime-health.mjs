import "dotenv/config";
import { createTelegramAlertSender, evaluateRuntimeSnapshot } from "./runtime-monitor-lib.mjs";
import { parsePositiveIntegerEnv } from "./env-parsing.mjs";

const baseUrl = process.env.RUNTIME_MONITOR_BASE_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim() || "";
const diagnosticsSecret = process.env.HEALTH_DIAGNOSTICS_SECRET?.trim() || "";
const intervalMs = parsePositiveIntegerEnv(process.env.RUNTIME_MONITOR_INTERVAL_MS, 30_000);
const timeoutMs = parsePositiveIntegerEnv(process.env.RUNTIME_MONITOR_TIMEOUT_MS, 15_000);
const stuckGraceMs = parsePositiveIntegerEnv(process.env.RUNTIME_MONITOR_STUCK_GRACE_MS, 120_000);
const maxLiveStateAgeMs = parsePositiveIntegerEnv(process.env.RUNTIME_MONITOR_MAX_LIVE_STATE_AGE_MS, 120_000);
const allowLocal = process.env.RUNTIME_MONITOR_ALLOW_LOCAL === "1";
const allowNoAlerts = process.env.RUNTIME_MONITOR_ALLOW_NO_ALERTS === "1";
const alertSender = createTelegramAlertSender();
const activeIssues = new Map();
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
    issues = evaluateRuntimeSnapshot({ runtime, dataSync, liveState, stuckGraceMs, maxLiveStateAgeMs });
  } catch {
    issues = [{ key: "health-request", message: "Runtime health endpoints are unavailable." }];
  }

  const nextKeys = new Set(issues.map((issue) => issue.key));
  for (const issue of issues) {
    if (!activeIssues.has(issue.key)) {
      console.error(`[runtime-monitor] ALERT ${issue.key}: ${issue.message}`);
      await alertSender.send(`ALERT: ${issue.message}`, `runtime-${issue.key}`);
    }
    activeIssues.set(issue.key, issue.message);
  }
  for (const [key, message] of activeIssues) {
    if (nextKeys.has(key)) continue;
    activeIssues.delete(key);
    console.log(`[runtime-monitor] RECOVERED ${key}`);
    await alertSender.send(`RECOVERED: ${message}`, `runtime-recovered-${key}`, 60_000);
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
