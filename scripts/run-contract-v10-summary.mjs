import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { redactProofText } from "./redact-proof-output.mjs";
import { parseSummaryTimeoutEnv } from "./summary-timeout.mjs";

const MAX_ASSERTION_FAILURE_COUNT = 9999;
const MAX_COMPILER_VERSION_LENGTH = 120;
export const EXPECTED_V10_DUPLICATE_BATCH_MODEL_DIGEST = "cedc97331f6a76bf03ff03369f9ba411ce1a3e8f57664facbfb22cf7e873f31f";
const EXPECTED_V10_DUPLICATE_BATCH_MODEL_CASES = 10;

function extractLastJsonObject(text) {
  const source = String(text ?? "");
  let depth = 0;
  let start = -1;
  let last = null;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          last = JSON.parse(source.slice(start, index + 1));
        } catch {
          // Ignore non-JSON braces in child diagnostics.
        }
      }
    }
  }
  return last;
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

function safeCompilerVersion(value) {
  if (typeof value !== "string" || value.length > MAX_COMPILER_VERSION_LENGTH) return "unknown";
  return /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\+commit\.[0-9a-fA-F]{8}\.Emscripten\.clang$/.test(value)
    ? value
    : "unknown";
}

export function summarizeContractV10Result(result) {
  const rawOutput = `${result?.stdout ?? ""}\n${result?.stderr ?? ""}`;
  const output = redactProofText(rawOutput);
  const timedOut = result?.error?.code === "ETIMEDOUT";
  const outputTooLarge = result?.error?.code === "ENOBUFS";
  const parsed = extractLastJsonObject(result?.stdout ?? "");
  const assertionFailures = countAssertionFailures(output);
  const duplicateBatchModelManifest =
    parsed?.duplicateBatchModelCases === EXPECTED_V10_DUPLICATE_BATCH_MODEL_CASES &&
    parsed?.duplicateBatchModelDigest === EXPECTED_V10_DUPLICATE_BATCH_MODEL_DIGEST;
  const pass = result?.status === 0 && parsed?.status === "passed" && duplicateBatchModelManifest
    && assertionFailures === 0 && !timedOut && !outputTooLarge;
  return {
    status: pass ? "pass" : "fail",
    invariantSuite: "v10",
    compilerVersion: safeCompilerVersion(parsed?.compilerVersion),
    runtimeBytes: nonNegativeInteger(parsed?.runtimeBytes),
    functionSelectors: nonNegativeInteger(parsed?.functionSelectors),
    stateChangingEntrypoints: nonNegativeInteger(parsed?.stateChangingEntrypoints),
    guardedLocalMutationEntrypoints: nonNegativeInteger(parsed?.guardedLocalMutationEntrypoints),
    protocolFeeFlushModelCases: nonNegativeInteger(parsed?.protocolFeeFlushModelCases),
    protocolFeeFlushEntrypointCases: nonNegativeInteger(parsed?.protocolFeeFlushEntrypointCases),
    duplicateBatchModelCases: nonNegativeInteger(parsed?.duplicateBatchModelCases),
    duplicateBatchModelManifest,
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
    ...(!outputTooLarge && result?.error && result.error.code !== "ETIMEDOUT" ? { issue: "contract-v10-spawn-failed" } : {}),
  };
}

export function runContractV10Summary({
  spawn = spawnSync,
  cwd = process.cwd(),
  env = process.env,
  platform = process.platform,
  execPath = process.execPath,
  writeLine = (line) => console.log(line),
} = {}) {
  const timeoutMs = parseSummaryTimeoutEnv("CONTRACT_V10_SUMMARY_TIMEOUT_MS", 180_000);
  const npmExecPath = env.npm_execpath;
  const npmCommand = npmExecPath ? execPath : platform === "win32" ? "npm.cmd" : "npm";
  const testArgs = npmExecPath
    ? [npmExecPath, "--silent", "run", "test:contract:v10"]
    : ["--silent", "run", "test:contract:v10"];
  const result = spawn(npmCommand, testArgs, {
    cwd,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    timeout: timeoutMs,
    env: {
      ...env,
      NO_UPDATE_NOTIFIER: "1",
      npm_config_update_notifier: "false",
      npm_config_fund: "false",
    },
  });
  const summary = summarizeContractV10Result(result);
  writeLine(JSON.stringify(summary));
  return { summary, exitCode: summary.status === "pass" ? 0 : 1 };
}

function isDirectRun() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  try {
    const { exitCode } = runContractV10Summary();
    process.exitCode = exitCode;
  } catch (error) {
    console.log(JSON.stringify({
      status: "fail",
      invariantSuite: "v10",
      issue: "contract-v10-summary-config-invalid",
      error: redactProofText(error instanceof Error ? error.message : String(error)).slice(0, 300),
    }));
    process.exitCode = 1;
  }
}
