import { spawnSync } from "node:child_process";
import { redactProofText } from "./redact-proof-output.mjs";
import { parseSummaryTimeoutEnv } from "./summary-timeout.mjs";

const npmCommand = process.env.npm_execpath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
const testArgs = process.env.npm_execpath
  ? [process.env.npm_execpath, "--silent", "run", "test:contract:v10"]
  : ["--silent", "run", "test:contract:v10"];
const timeoutMs = parseSummaryTimeoutEnv("CONTRACT_V10_SUMMARY_TIMEOUT_MS", 180_000);
const MAX_ASSERTION_FAILURE_COUNT = 9999;

const result = spawnSync(npmCommand, testArgs, {
  cwd: process.cwd(),
  encoding: "utf8",
  maxBuffer: 2 * 1024 * 1024,
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
const timedOut = result.error?.code === "ETIMEDOUT";
const outputTooLarge = result.error?.code === "ENOBUFS";
const parsed = extractJsonObject(output);
const assertionFailures = countAssertionFailures(output);
const pass = result.status === 0 && parsed?.status === "passed" && assertionFailures === 0 && !timedOut && !outputTooLarge;

console.log(JSON.stringify({
  status: pass ? "pass" : "fail",
  invariantSuite: "v10",
  compilerVersion: parsed?.compilerVersion ?? "unknown",
  runtimeBytes: nonNegativeInteger(parsed?.runtimeBytes),
  functionSelectors: nonNegativeInteger(parsed?.functionSelectors),
  stateChangingEntrypoints: nonNegativeInteger(parsed?.stateChangingEntrypoints),
  guardedLocalMutationEntrypoints: nonNegativeInteger(parsed?.guardedLocalMutationEntrypoints),
  protocolFeeFlushModelCases: nonNegativeInteger(parsed?.protocolFeeFlushModelCases),
  protocolFeeFlushEntrypointCases: nonNegativeInteger(parsed?.protocolFeeFlushEntrypointCases),
  duplicateBatchModelCases: nonNegativeInteger(parsed?.duplicateBatchModelCases),
  tokenTransferRollbackCases: nonNegativeInteger(parsed?.tokenTransferRollbackCases),
  batchTransferRollbackCases: nonNegativeInteger(parsed?.batchTransferRollbackCases),
  dustTransferRollbackCases: nonNegativeInteger(parsed?.dustTransferRollbackCases),
  timelockBoundaryCases: nonNegativeInteger(parsed?.timelockBoundaryCases),
  dustBoundaryCases: nonNegativeInteger(parsed?.dustBoundaryCases),
  packedBoundaryCases: nonNegativeInteger(parsed?.packedBoundaryCases),
  fullRangeAccountingCases: nonNegativeInteger(parsed?.fullRangeAccountingCases),
  fullRangeProportionalCases: nonNegativeInteger(parsed?.fullRangeProportionalCases),
  assertionFailures,
  timedOut,
  ...(outputTooLarge ? { issue: "contract-v10-output-too-large" } : {}),
  ...(!outputTooLarge && result.error && result.error.code !== "ETIMEDOUT" ? { issue: "contract-v10-spawn-failed" } : {}),
}));

if (!pass) {
  process.exitCode = 1;
}
