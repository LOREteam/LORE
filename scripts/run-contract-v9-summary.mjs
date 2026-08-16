import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { redactProofText } from "./redact-proof-output.mjs";
import { parseSummaryTimeoutEnv } from "./summary-timeout.mjs";

const MAX_ASSERTION_FAILURE_COUNT = 9999;
const MAX_SUMMARY_OUTPUT_BYTES = 1024 * 1024;

export function countContractV9AssertionFailures(text) {
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

export function assessContractV9SummaryResult(result) {
  const output = redactProofText(`${result?.stdout ?? ""}\n${result?.stderr ?? ""}`);
  const timedOut = result?.error?.code === "ETIMEDOUT";
  const outputTooLarge = result?.error?.code === "ENOBUFS";
  const passed = /Contract V9 invariant checks passed\./.test(output);
  const assertionFailures = countContractV9AssertionFailures(output);
  const pass = result?.status === 0 && passed && assertionFailures === 0 && !timedOut && !outputTooLarge;

  return {
    status: pass ? "pass" : "fail",
    invariantSuite: "v9",
    passed,
    assertionFailures,
    timedOut,
    ...(outputTooLarge ? { issue: "contract-v9-output-too-large" } : {}),
    ...(!outputTooLarge && result?.error && result.error.code !== "ETIMEDOUT"
      ? { issue: "contract-v9-spawn-failed" }
      : {}),
  };
}

export function runContractV9Summary({
  spawn = spawnSync,
  env = process.env,
  cwd = process.cwd(),
  platform = process.platform,
  execPath = process.execPath,
  timeoutMs = parseSummaryTimeoutEnv("CONTRACT_V9_SUMMARY_TIMEOUT_MS", 180_000),
} = {}) {
  const npmCommand = env.npm_execpath ? execPath : platform === "win32" ? "npm.cmd" : "npm";
  const testArgs = env.npm_execpath
    ? [env.npm_execpath, "--silent", "run", "test:contract"]
    : ["--silent", "run", "test:contract"];
  const result = spawn(npmCommand, testArgs, {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_SUMMARY_OUTPUT_BYTES,
    timeout: timeoutMs,
    env: {
      ...env,
      NO_UPDATE_NOTIFIER: "1",
      npm_config_update_notifier: "false",
      npm_config_fund: "false",
    },
  });
  return assessContractV9SummaryResult(result);
}

export function runContractV9SummaryCli() {
  try {
    const summary = runContractV9Summary();
    console.log(JSON.stringify(summary));
    if (summary.status !== "pass") process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "contract V9 summary failed");
    process.exitCode = 1;
  }
}

const directEntry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === directEntry) runContractV9SummaryCli();
