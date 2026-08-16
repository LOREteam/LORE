import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { redactProofText } from "./redact-proof-output.mjs";
import { parseSummaryTimeoutEnv } from "./summary-timeout.mjs";

const MAX_TS_ERROR_COUNT = 9999;
const MAX_TS_CODES = 8;

function summarizeTypeScriptErrors(output) {
  const pattern = /\berror TS(\d{3,6})\b/g;
  const codes = new Set();
  let count = 0;
  let match = pattern.exec(output);
  while (match !== null) {
    count += 1;
    if (codes.size < MAX_TS_CODES) codes.add(`ts${match[1]}`);
    if (count >= MAX_TS_ERROR_COUNT) { count = MAX_TS_ERROR_COUNT; break; }
    match = pattern.exec(output);
  }
  return { tsCodes: [...codes].sort(), tsErrors: count };
}

export function summarizeTypecheckResult(result) {
  const output = redactProofText(`${result?.stdout ?? ""}\n${result?.stderr ?? ""}`);
  const { tsCodes, tsErrors } = summarizeTypeScriptErrors(output);
  const timedOut = result?.error?.code === "ETIMEDOUT";
  const outputTooLarge = result?.error?.code === "ENOBUFS";
  const pass = result?.status === 0 && tsErrors === 0 && !timedOut && !outputTooLarge;
  return {
    status: pass ? "pass" : "fail",
    nextTypegen: /Types generated successfully/.test(output) && !/next typegen/i.test(result?.stderr ?? ""),
    tsc: pass,
    tsErrors,
    tsCodes,
    timedOut,
    ...(outputTooLarge ? { issue: "typecheck-output-too-large" } : {}),
    ...(!outputTooLarge && result?.error && result.error.code !== "ETIMEDOUT" ? { issue: "typecheck-spawn-failed" } : {}),
  };
}

export function runTypecheckSummary({
  spawn = spawnSync, cwd = process.cwd(), env = process.env, execPath = process.execPath,
  platform = process.platform, writeLine = (line) => console.log(line),
} = {}) {
  const command = env.npm_execpath ? execPath : platform === "win32" ? "npm.cmd" : "npm";
  const args = env.npm_execpath
    ? [env.npm_execpath, "--silent", "run", "typecheck"]
    : ["--silent", "run", "typecheck"];
  const result = spawn(command, args, {
    cwd, encoding: "utf8", maxBuffer: 2 * 1024 * 1024,
    timeout: parseSummaryTimeoutEnv("TYPECHECK_SUMMARY_TIMEOUT_MS", 300_000),
    env: { ...env, NO_UPDATE_NOTIFIER: "1", npm_config_update_notifier: "false", npm_config_fund: "false" },
  });
  const summary = summarizeTypecheckResult(result);
  writeLine(JSON.stringify(summary));
  return { summary, exitCode: summary.status === "pass" ? 0 : 1 };
}

function isDirectRun() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  try {
    const { exitCode } = runTypecheckSummary();
    process.exitCode = exitCode;
  } catch (error) {
    console.log(JSON.stringify({
      status: "fail", issue: "typecheck-summary-config-invalid",
      error: redactProofText(error instanceof Error ? error.message : String(error)).slice(0, 300),
    }));
    process.exitCode = 1;
  }
}
