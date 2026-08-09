import { spawnSync } from "node:child_process";
import { redactProofText } from "./redact-proof-output.mjs";
import { parseSummaryTimeoutEnv } from "./summary-timeout.mjs";

const npmCommand = process.env.npm_execpath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
const testArgs = process.env.npm_execpath
  ? [process.env.npm_execpath, "--silent", "run", "test:contract"]
  : ["--silent", "run", "test:contract"];
const timeoutMs = parseSummaryTimeoutEnv("CONTRACT_V9_SUMMARY_TIMEOUT_MS", 180_000);
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
const passed = /Contract V9 invariant checks passed\./.test(output);
const assertionFailures = countAssertionFailures(output);
const pass = result.status === 0 && passed && assertionFailures === 0 && !timedOut && !outputTooLarge;

console.log(JSON.stringify({
  status: pass ? "pass" : "fail",
  invariantSuite: "v9",
  passed,
  assertionFailures,
  timedOut,
  ...(outputTooLarge ? { issue: "contract-v9-output-too-large" } : {}),
  ...(!outputTooLarge && result.error && result.error.code !== "ETIMEDOUT" ? { issue: "contract-v9-spawn-failed" } : {}),
}));

if (!pass) {
  process.exitCode = 1;
}
