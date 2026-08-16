import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { redactProofText } from "./redact-proof-output.mjs";
import { parseSummaryTimeoutEnv } from "./summary-timeout.mjs";

const MAX_ASSERTION_FAILURE_COUNT = 9999;

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

export function summarizeFetchTimeoutResult(result) {
  const output = redactProofText(`${result?.stdout ?? ""}\n${result?.stderr ?? ""}`);
  const timedOut = result?.error?.code === "ETIMEDOUT";
  const outputTooLarge = result?.error?.code === "ENOBUFS";
  const assertionFailures = countAssertionFailures(output);
  const passed = output.includes("fetchWithTimeout tests passed");
  const pass = result?.status === 0 && passed && assertionFailures === 0 && !timedOut && !outputTooLarge;
  return {
    status: pass ? "pass" : "fail", fetchTimeout: true, passed, assertionFailures, timedOut,
    ...(outputTooLarge ? { issue: "fetch-timeout-output-too-large" } : {}),
    ...(!outputTooLarge && result?.error && result.error.code !== "ETIMEDOUT" ? { issue: "fetch-timeout-spawn-failed" } : {}),
  };
}

export function runFetchTimeoutSummary({
  spawn = spawnSync, cwd = process.cwd(), env = process.env, execPath = process.execPath,
  platform = process.platform, writeLine = (line) => console.log(line),
} = {}) {
  const command = env.npm_execpath ? execPath : platform === "win32" ? "npm.cmd" : "npm";
  const args = env.npm_execpath
    ? [env.npm_execpath, "--silent", "run", "test:fetch-timeout"]
    : ["--silent", "run", "test:fetch-timeout"];
  const result = spawn(command, args, {
    cwd, encoding: "utf8", maxBuffer: 512 * 1024,
    timeout: parseSummaryTimeoutEnv("FETCH_TIMEOUT_SUMMARY_TIMEOUT_MS", 60_000),
    env: { ...env, NO_UPDATE_NOTIFIER: "1", npm_config_update_notifier: "false", npm_config_fund: "false" },
  });
  const summary = summarizeFetchTimeoutResult(result);
  writeLine(JSON.stringify(summary));
  return { summary, exitCode: summary.status === "pass" ? 0 : 1 };
}

function isDirectRun() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  try {
    const { exitCode } = runFetchTimeoutSummary();
    process.exitCode = exitCode;
  } catch (error) {
    console.log(JSON.stringify({
      status: "fail", issue: "fetch-timeout-summary-config-invalid",
      error: redactProofText(error instanceof Error ? error.message : String(error)).slice(0, 300),
    }));
    process.exitCode = 1;
  }
}
