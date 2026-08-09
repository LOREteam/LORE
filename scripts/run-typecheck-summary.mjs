import { spawnSync } from "node:child_process";
import { redactProofText } from "./redact-proof-output.mjs";
import { parseSummaryTimeoutEnv } from "./summary-timeout.mjs";

const npmCommand = process.env.npm_execpath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
const typecheckArgs = process.env.npm_execpath
  ? [process.env.npm_execpath, "--silent", "run", "typecheck"]
  : ["--silent", "run", "typecheck"];
const timeoutMs = parseSummaryTimeoutEnv("TYPECHECK_SUMMARY_TIMEOUT_MS", 300_000);
const MAX_TS_ERROR_COUNT = 9999;
const MAX_TS_CODES = 8;

const result = spawnSync(npmCommand, typecheckArgs, {
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

function clamp(value, max = 180) {
  const safe = redactProofText(String(value ?? "")).replace(/\s+/g, " ").trim();
  return safe.length > max ? `${safe.slice(0, max - 3)}...` : safe;
}

function summarizeTypeScriptErrors(output) {
  const pattern = /\berror TS(\d{3,6})\b/g;
  const codes = new Set();
  let count = 0;
  let match = pattern.exec(output);
  while (match !== null) {
    count += 1;
    if (codes.size < MAX_TS_CODES) codes.add(`ts${match[1]}`);
    if (count >= MAX_TS_ERROR_COUNT) {
      count = MAX_TS_ERROR_COUNT;
      break;
    }
    match = pattern.exec(output);
  }
  return {
    tsCodes: [...codes].sort(),
    tsErrors: count,
  };
}

function summarize() {
  const output = redactProofText(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  const { tsCodes, tsErrors } = summarizeTypeScriptErrors(output);
  const timedOut = result.error?.code === "ETIMEDOUT";
  const outputTooLarge = result.error?.code === "ENOBUFS";
  const pass = result.status === 0 && tsErrors === 0 && !timedOut && !outputTooLarge;
  return {
    status: pass ? "pass" : "fail",
    nextTypegen: /Types generated successfully/.test(output) && !/next typegen/i.test(result.stderr ?? ""),
    tsc: pass,
    tsErrors,
    tsCodes,
    timedOut,
    ...(outputTooLarge ? { issue: "typecheck-output-too-large" } : {}),
    ...(!outputTooLarge && result.error && result.error.code !== "ETIMEDOUT" ? { issue: clamp(result.error.message) } : {}),
  };
}

const summary = summarize();
console.log(JSON.stringify(summary));

if (summary.status !== "pass" || result.status !== 0) {
  process.exitCode = 1;
}
