import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { redactProofText } from "./redact-proof-output.mjs";
import { parseSummaryTimeoutEnv } from "./summary-timeout.mjs";

const MAX_ASSERTION_FAILURE_COUNT = 9999;

function extractJsonObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function countAssertionFailures(text) {
  const pattern = /\bAssertionError\b/g;
  let count = 0;
  let match = pattern.exec(text);
  while (match !== null) {
    count += 1;
    if (count >= MAX_ASSERTION_FAILURE_COUNT) return MAX_ASSERTION_FAILURE_COUNT;
    match = pattern.exec(text);
  }
  return count;
}

export function summarizeMonitoringDrillResult(result) {
  const output = redactProofText(`${result?.stdout ?? ""}\n${result?.stderr ?? ""}`);
  const parsed = extractJsonObject(output);
  const timedOut = result?.error?.code === "ETIMEDOUT";
  const outputTooLarge = result?.error?.code === "ENOBUFS";
  const assertionFailures = countAssertionFailures(output);
  const pass = result?.status === 0 && parsed?.status === "pass" && assertionFailures === 0 && !timedOut && !outputTooLarge;
  return {
    status: pass ? "pass" : "fail",
    runtimeMonitoring: true,
    alerts: nonNegativeInteger(parsed?.alerts),
    duplicateAlertsAfterRestart: nonNegativeInteger(parsed?.duplicateAlertsAfterRestart),
    recoveries: nonNegativeInteger(parsed?.recoveries),
    deliveries: nonNegativeInteger(parsed?.deliveries),
    repoLocalBackupDirRejected: parsed?.repoLocalBackupDirRejected === true,
    localPathBaseUrlRejected: parsed?.localPathBaseUrlRejected === true,
    malformedDiagnosticsSecretRejected: parsed?.malformedDiagnosticsSecretRejected === true,
    malformedNumericEnvRejected: parsed?.malformedNumericEnvRejected === true,
    stateCleared: parsed?.stateCleared === true,
    assertionFailures,
    timedOut,
    ...(outputTooLarge ? { issue: "monitoring-drill-output-too-large" } : {}),
    ...(!outputTooLarge && result?.error && result.error.code !== "ETIMEDOUT" ? { issue: "monitoring-drill-spawn-failed" } : {}),
  };
}

export function runMonitoringDrillSummary({
  spawn = spawnSync, cwd = process.cwd(), env = process.env, execPath = process.execPath,
  platform = process.platform, writeLine = (line) => console.log(line),
} = {}) {
  const command = env.npm_execpath ? execPath : platform === "win32" ? "npm.cmd" : "npm";
  const args = env.npm_execpath
    ? [env.npm_execpath, "--silent", "run", "test:monitoring"]
    : ["--silent", "run", "test:monitoring"];
  const result = spawn(command, args, {
    cwd, encoding: "utf8", maxBuffer: 1024 * 1024,
    timeout: parseSummaryTimeoutEnv("MONITORING_DRILL_SUMMARY_TIMEOUT_MS", 120_000),
    env: { ...env, NO_UPDATE_NOTIFIER: "1", npm_config_update_notifier: "false", npm_config_fund: "false" },
  });
  const summary = summarizeMonitoringDrillResult(result);
  writeLine(JSON.stringify(summary));
  return { summary, exitCode: summary.status === "pass" ? 0 : 1 };
}

function isDirectRun() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  try {
    const { exitCode } = runMonitoringDrillSummary();
    process.exitCode = exitCode;
  } catch (error) {
    console.log(JSON.stringify({
      status: "fail", issue: "monitoring-drill-summary-config-invalid",
      error: redactProofText(error instanceof Error ? error.message : String(error)).slice(0, 300),
    }));
    process.exitCode = 1;
  }
}
