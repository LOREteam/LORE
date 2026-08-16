import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { redactProofText } from "./redact-proof-output.mjs";
import { parseSummaryTimeoutEnv } from "./summary-timeout.mjs";

const MAX_ASSERTION_FAILURE_COUNT = 9999;

function extractJsonObjects(text) {
  const source = String(text ?? "");
  const objects = [];
  let depth = 0;
  let start = -1;
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
    if (char === "\"") { inString = true; continue; }
    if (char === "{") { if (depth === 0) start = index; depth += 1; }
    else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try { objects.push(JSON.parse(source.slice(start, index + 1))); } catch { /* ignore braces */ }
      }
    }
  }
  return objects;
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

function nonNegativeInteger(value) { return Number.isSafeInteger(value) && value >= 0 ? value : 0; }
function safeNetwork(value) {
  const text = String(value ?? "").trim();
  return /^[A-Za-z0-9 _-]{1,64}$/.test(text) ? text : "unknown";
}

export function summarizeV10DeployedResults({ compile, verifier }) {
  const compileOutput = redactProofText(`${compile?.stdout ?? ""}\n${compile?.stderr ?? ""}`);
  const verifierOutput = redactProofText(`${verifier?.stdout ?? ""}\n${verifier?.stderr ?? ""}`);
  const compileParsed = extractJsonObjects(compileOutput).at(-1);
  const verifierParsed = verifier ? extractJsonObjects(verifierOutput).at(-1) : null;
  const combinedOutput = `${compileOutput}\n${verifierOutput}`;
  const timedOut = compile?.error?.code === "ETIMEDOUT" || verifier?.error?.code === "ETIMEDOUT";
  const outputTooLarge = compile?.error?.code === "ENOBUFS" || verifier?.error?.code === "ENOBUFS";
  const assertionFailures = countAssertionFailures(combinedOutput);
  const checks = verifierParsed?.checks && typeof verifierParsed.checks === "object" ? verifierParsed.checks : {};
  const pass = compile?.status === 0 && verifier?.status === 0 && compileParsed?.manifestMatches === true
    && verifierParsed?.status === "pass" && verifierParsed?.transactionSent === false
    && assertionFailures === 0 && !timedOut && !outputTooLarge;
  return {
    status: pass ? "pass" : "fail",
    v10DeployedReadOnly: true,
    network: safeNetwork(verifierParsed?.network),
    chainId: nonNegativeInteger(verifierParsed?.chainId),
    manifestMatches: compileParsed?.manifestMatches === true,
    runtimeBytes: nonNegativeInteger(verifierParsed?.runtimeBytes),
    expectedRuntimeBytes: nonNegativeInteger(verifierParsed?.expectedRuntimeBytes),
    expectedExecutableRuntimeBytes: nonNegativeInteger(verifierParsed?.expectedExecutableRuntimeBytes),
    immutableReferences: nonNegativeInteger(verifierParsed?.immutableReferences),
    runtimeBytecode: checks.runtimeBytecode === true,
    runtimeExecutable: checks.runtimeExecutable === true,
    metadataOnlyMismatch: verifierParsed?.diagnostics?.metadataOnlyMismatch === true,
    token: checks.token === true,
    ownerNonZero: checks.ownerNonZero === true,
    feeRecipientNonZero: checks.feeRecipientNonZero === true,
    transactionSent: verifierParsed?.transactionSent === true,
    assertionFailures,
    timedOut,
    ...(outputTooLarge ? { issue: "v10-deployed-summary-output-too-large" } : {}),
    ...(!outputTooLarge && (compile?.error || verifier?.error) && !timedOut ? { issue: "v10-deployed-summary-spawn-failed" } : {}),
  };
}

export function runV10DeployedSummary({
  spawn = spawnSync, cwd = process.cwd(), env = process.env, execPath = process.execPath,
  platform = process.platform, writeLine = (line) => console.log(line),
} = {}) {
  const command = env.npm_execpath ? execPath : platform === "win32" ? "npm.cmd" : "npm";
  const prefix = env.npm_execpath ? [env.npm_execpath, "--silent"] : ["--silent"];
  const options = {
    cwd, encoding: "utf8", maxBuffer: 1024 * 1024,
    timeout: parseSummaryTimeoutEnv("V10_DEPLOYED_SUMMARY_TIMEOUT_MS", 120_000),
    env: { ...env, NO_UPDATE_NOTIFIER: "1", npm_config_update_notifier: "false", npm_config_fund: "false" },
  };
  const compile = spawn(command, [...prefix, "run", "proof:contract-compile:v10:summary"], options);
  const verifier = compile.status === 0
    ? spawn(command, [...prefix, "exec", "--", "tsx", "scripts/verify-v10-deployed.ts"], options)
    : null;
  const summary = summarizeV10DeployedResults({ compile, verifier });
  writeLine(JSON.stringify(summary));
  return { summary, exitCode: summary.status === "pass" ? 0 : 1 };
}

function isDirectRun() { return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url); }
if (isDirectRun()) {
  try { const { exitCode } = runV10DeployedSummary(); process.exitCode = exitCode; }
  catch (error) {
    console.log(JSON.stringify({ status: "fail", issue: "v10-deployed-summary-config-invalid",
      error: redactProofText(error instanceof Error ? error.message : String(error)).slice(0, 300) }));
    process.exitCode = 1;
  }
}
