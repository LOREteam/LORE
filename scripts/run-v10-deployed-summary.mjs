import { spawnSync } from "node:child_process";
import { redactProofText } from "./redact-proof-output.mjs";
import { parseSummaryTimeoutEnv } from "./summary-timeout.mjs";

const npmCommand = process.env.npm_execpath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
const timeoutMs = parseSummaryTimeoutEnv("V10_DEPLOYED_SUMMARY_TIMEOUT_MS", 120_000);
const MAX_ASSERTION_FAILURE_COUNT = 9999;
const commandEnv = {
  ...process.env,
  NO_UPDATE_NOTIFIER: "1",
  npm_config_update_notifier: "false",
  npm_config_fund: "false",
};

function npmArgs(args) {
  return process.env.npm_execpath ? [process.env.npm_execpath, "--silent", ...args] : ["--silent", ...args];
}

function runNpm(args) {
  return spawnSync(npmCommand, npmArgs(args), {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: timeoutMs,
    env: commandEnv,
  });
}

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
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
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
          objects.push(JSON.parse(source.slice(start, index + 1)));
        } catch {
          // Ignore non-JSON braces in tool output.
        }
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

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

const compile = runNpm(["run", "proof:contract-compile:v10:summary"]);
const compileOutput = redactProofText(`${compile.stdout ?? ""}\n${compile.stderr ?? ""}`);
const compileParsed = extractJsonObjects(compileOutput).at(-1);
const verifier = compile.status === 0
  ? runNpm(["exec", "--", "tsx", "scripts/verify-v10-deployed.ts"])
  : null;
const verifierOutput = redactProofText(`${verifier?.stdout ?? ""}\n${verifier?.stderr ?? ""}`);
const verifierParsed = verifier ? extractJsonObjects(verifierOutput).at(-1) : null;
const combinedOutput = `${compileOutput}\n${verifierOutput}`;
const timedOut = compile.error?.code === "ETIMEDOUT" || verifier?.error?.code === "ETIMEDOUT";
const outputTooLarge = compile.error?.code === "ENOBUFS" || verifier?.error?.code === "ENOBUFS";
const assertionFailures = countAssertionFailures(combinedOutput);
const checks = verifierParsed?.checks && typeof verifierParsed.checks === "object" ? verifierParsed.checks : {};
const status = compile.status === 0 && verifierParsed?.status === "pass" && assertionFailures === 0 && !timedOut && !outputTooLarge
  ? "pass"
  : "fail";

console.log(JSON.stringify({
  status,
  v10DeployedReadOnly: true,
  network: typeof verifierParsed?.network === "string" ? verifierParsed.network : "unknown",
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
  ...(!outputTooLarge && (compile.error || verifier?.error) && !timedOut ? { issue: "v10-deployed-summary-spawn-failed" } : {}),
}));

if (status !== "pass") {
  process.exitCode = 1;
}
