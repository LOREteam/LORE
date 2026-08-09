import { spawnSync } from "node:child_process";
import { redactProofText } from "./redact-proof-output.mjs";

const npmCommand = process.env.npm_execpath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
const DECIMAL_INTEGER_RE = /^(?:0|[1-9]\d{0,15})$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const timeoutMs = parsePositiveIntegerEnv("AUTONOMOUS_DAILY_STATUS_TIMEOUT_MS", 120_000, 1_000, 900_000);
const quietNpmEnv = {
  ...process.env,
  NO_UPDATE_NOTIFIER: "1",
  npm_config_update_notifier: "false",
  npm_config_fund: "false",
};

function parsePositiveIntegerEnv(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!DECIMAL_INTEGER_RE.test(raw)) {
    throw new Error(`${name} must be a canonical decimal integer`);
  }
  const parsed = BigInt(raw);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  const numeric = Number(parsed);
  if (numeric < min || numeric > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return numeric;
}

const checks = [
  { id: "deps-prod", label: "production dependency audit", script: "proof:deps:summary" },
  { id: "deps-all", label: "all dependency audit", script: "proof:deps:all:summary" },
  { id: "wallet-deps", label: "wallet dependency integrity", script: "proof:wallet-deps:summary" },
  { id: "ci-security", label: "CI security", script: "proof:ci-security:summary" },
  { id: "bundle", label: "bundle baseline", script: "baseline:bundle:summary" },
  { id: "cleanup", label: "workspace cleanup dry-run", script: "cleanup:workspace:dry-run:summary" },
];

function clamp(value, max = 260) {
  const text = redactProofText(String(value ?? "")).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function runScript(script) {
  const args = process.env.npm_execpath
    ? [process.env.npm_execpath, "--silent", "run", script]
    : ["--silent", "run", script];
  return spawnSync(npmCommand, args, {
    cwd: process.cwd(),
    env: quietNpmEnv,
    encoding: "utf8",
    maxBuffer: 256 * 1024,
    timeout: timeoutMs,
  });
}

function extractLastJsonObject(output) {
  const source = String(output ?? "");
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
          // Ignore non-JSON braces in child command banners.
        }
      }
    }
  }

  return objects.at(-1) ?? null;
}

function nonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function integerField(value) {
  return nonNegativeSafeInteger(value) ?? 0;
}

function safeVersion(value) {
  const text = String(value ?? "").trim();
  return /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(text) ? text : "unknown";
}

function safeBundleFilePath(value) {
  const text = String(value ?? "").trim();
  if (text.length === 0 || text.length > 160 || text.includes("..") || text.includes("//") || text.includes("\\")) {
    return "unknown";
  }
  return /^static\/[a-zA-Z0-9._/-]+$/.test(text) ? text : "unknown";
}

function summarizeDependencyAudit(parsed) {
  return clamp(
    `status=${parsed?.status === "pass" ? "pass" : "fail"}, scope=${parsed?.scope === "production" ? "production" : "all"}, total=${integerField(parsed?.total)}, high=${integerField(parsed?.high)}, critical=${integerField(parsed?.critical)}, blocking=${integerField(parsed?.blockingHighCritical)}, knownDev=${integerField(parsed?.knownDevToolchainHigh)}`,
  );
}

function summarizeWalletDeps(parsed) {
  const missing = Array.isArray(parsed?.missing)
    ? parsed.missing.map((entry) => String(entry ?? "")).filter((entry) => /^[a-z0-9@/_-]{1,80}$/i.test(entry)).slice(0, 8)
    : [];
  return clamp(
    `status=${parsed?.status === "pass" ? "pass" : "fail"}, privy=${safeVersion(parsed?.privy)}, privyWagmi=${safeVersion(parsed?.privyWagmi)}, wagmi=${safeVersion(parsed?.wagmi)}, viem=${safeVersion(parsed?.viem)}, missing=${missing.length > 0 ? missing.join(",") : "none"}`,
  );
}

function summarizeBundle(parsed) {
  const largest = Array.isArray(parsed?.largestFiles) ? parsed.largestFiles.slice(0, 5) : [];
  const largestSummary = largest
    .map((file) => `${integerField(file?.bytes)}`)
    .filter((entry) => entry !== "0")
    .join(",");
  const maxSingleJsBytes = integerField(parsed?.budget?.maxSingleJsBytes);
  const largestJsFile = safeBundleFilePath(parsed?.largestJsFile?.path);
  return clamp(
    `status=${parsed?.status === "pass" ? "pass" : "fail"}, files=${integerField(parsed?.fileCount)}, totalBytes=${integerField(parsed?.totalBytes)}, jsBytes=${integerField(parsed?.jsBytes)}, largestJsBytes=${integerField(parsed?.largestJsBytes)}, largestJsFile=${largestJsFile}, maxSingleJsBytes=${maxSingleJsBytes}, cssBytes=${integerField(parsed?.cssBytes)}, wasmBytes=${integerField(parsed?.wasmBytes)}, largestBytes=${largestSummary || "none"}, issues=${Array.isArray(parsed?.budgetIssues) ? parsed.budgetIssues.length : 0}`,
  );
}

function summarizeCiSecurity(parsed) {
  return clamp(
    `status=${parsed?.status === "pass" ? "pass" : "fail"}, permissionsReadOnly=${parsed?.permissionsReadOnly === true}, pullRequestTarget=${parsed?.pullRequestTarget === true}, usesPinned=${parsed?.usesPinned === true}, checkoutPersistCredentialsFalse=${parsed?.checkoutPersistCredentialsFalse === true}, issues=${integerField(parsed?.issues)}`,
  );
}

function summarizeCleanup(parsed) {
  return clamp(
    `status=${parsed?.status === "ok" ? "ok" : "fail"}, mode=${parsed?.mode === "dry-run" ? "dry-run" : "other"}, matched=${integerField(parsed?.matchedTargets)}, wouldDelete=${integerField(parsed?.wouldDeleteTargets)}, skipped=${integerField(parsed?.skippedTargets)}, bytes=${integerField(parsed?.bytes)}`,
  );
}

function summarize(check, parsed, output) {
  if (check.id === "deps-prod" || check.id === "deps-all") return summarizeDependencyAudit(parsed);
  if (check.id === "wallet-deps") return summarizeWalletDeps(parsed);
  if (check.id === "ci-security") return summarizeCiSecurity(parsed);
  if (check.id === "bundle") return summarizeBundle(parsed);
  if (check.id === "cleanup") return summarizeCleanup(parsed);
  return clamp(output);
}

const rows = [];
const failures = [];

for (const check of checks) {
  const result = runScript(check.script);
  const exitCode = typeof result.status === "number" ? result.status : 1;
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const parsed = extractLastJsonObject(output);
  const ok = exitCode === 0 && parsed !== null;
  if (!ok) failures.push(check.script);
  rows.push([check.label, check.script, String(exitCode), ok ? "ok" : "fail", summarize(check, parsed, output).replace(/\|/g, "\\|")]);
}

console.log("# Autonomous Daily Status Summary");
console.log("");
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("Mode: read-only, no transactions, no deploys, no cleanup apply");
console.log("");
console.log("| Check | Command | Exit | Expected | Summary |");
console.log("| --- | --- | --- | --- | --- |");
for (const row of rows) console.log(`| ${row.join(" | ")} |`);
console.log("");
console.log(
  failures.length > 0
    ? `Summary: ${failures.length} daily autonomous command(s) failed unexpectedly: ${failures.join(", ")}.`
    : "Summary: daily autonomous dependency, wallet, CI security, bundle, and cleanup checks completed.",
);

if (failures.length > 0) process.exitCode = 1;
