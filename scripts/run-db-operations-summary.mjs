import { spawnSync } from "node:child_process";
import { redactProofText } from "./redact-proof-output.mjs";
import { parseSummaryTimeoutEnv } from "./summary-timeout.mjs";

const npmCommand = process.env.npm_execpath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
const testArgs = process.env.npm_execpath
  ? [process.env.npm_execpath, "--silent", "run", "test:db-operations"]
  : ["--silent", "run", "test:db-operations"];
const timeoutMs = parseSummaryTimeoutEnv("DB_OPERATIONS_SUMMARY_TIMEOUT_MS", 120_000);
const MAX_ASSERTION_FAILURE_COUNT = 9999;

const result = spawnSync(npmCommand, testArgs, {
  cwd: process.cwd(),
  encoding: "utf8",
  maxBuffer: 1024 * 1024,
  timeout: timeoutMs,
  env: {
    ...process.env,
    NO_UPDATE_NOTIFIER: "1",
    npm_config_update_notifier: "false",
    npm_config_fund: "false",
  },
});

function extractJsonObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
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

const output = redactProofText(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
const parsed = extractJsonObject(output);
const timedOut = result.error?.code === "ETIMEDOUT";
const outputTooLarge = result.error?.code === "ENOBUFS";
const assertionFailures = countAssertionFailures(output);
const pass = result.status === 0 && parsed?.status === "pass" && assertionFailures === 0 && !timedOut && !outputTooLarge;

console.log(JSON.stringify({
  status: pass ? "pass" : "fail",
  sqliteOperations: true,
  backupIntegrity: parsed?.backup?.integrity === "ok",
  backupRows: nonNegativeInteger(parsed?.backup?.rows),
  retentionExpiredRemoved: nonNegativeInteger(parsed?.retention?.expiredRemoved),
  retentionRecentPreserved: parsed?.retention?.recentPreserved === true,
  scopeReadOnly: parsed?.scopeAudit?.readOnly === true,
  foreignRows: nonNegativeInteger(parsed?.scopeAudit?.foreignRows),
  repoLocalProductionBackupRejected: parsed?.faults?.repoLocalProductionBackupRejected === true,
  futureSourceBackupSummaryRejected: parsed?.faults?.futureSourceBackupSummaryRejected === true,
  missingSourceBackupSummaryRejected: parsed?.faults?.missingSourceBackupSummaryRejected === true,
  malformedRetentionBackupSummaryRejected: parsed?.faults?.malformedRetentionBackupSummaryRejected === true,
  unsafeRetentionBackupSummaryRejected: parsed?.faults?.unsafeRetentionBackupSummaryRejected === true,
  corruptSourceBackupCleanup: parsed?.faults?.corruptSourceBackupCleanup === true,
  restoreUsesSuppliedBackupArtifact: parsed?.faults?.restoreUsesSuppliedBackupArtifact === true,
  corruptBackupRestoreRejected: parsed?.faults?.corruptBackupRestoreRejected === true,
  diskFullRejected: parsed?.faults?.diskFullRejected === true,
  corruptStartupRejected: parsed?.faults?.corruptStartupRejected === true,
  assertionFailures,
  timedOut,
  ...(outputTooLarge ? { issue: "db-operations-output-too-large" } : {}),
  ...(!outputTooLarge && result.error && result.error.code !== "ETIMEDOUT" ? { issue: "db-operations-spawn-failed" } : {}),
}));

if (!pass) {
  process.exitCode = 1;
}
