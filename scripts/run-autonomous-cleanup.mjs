import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const AUTONOMOUS_CLEANUP_MAX_BUFFER = 64 * 1024;
const DECIMAL_INTEGER_RE = /^(?:0|[1-9]\d{0,15})$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export function parseAutonomousCleanupTimeout(value, {
  name = "CLEANUP_AUTONOMOUS_TIMEOUT_MS",
  fallback = 120_000,
  min = 1_000,
  max = 900_000,
} = {}) {
  const text = typeof value === "string" && value.trim().length > 0 ? value.trim() : String(fallback);
  if (!DECIMAL_INTEGER_RE.test(text)) {
    throw new Error(`${name} must be a decimal integer between ${min} and ${max}`);
  }
  const parsed = BigInt(text);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) {
    throw new Error(`${name} must be a decimal integer between ${min} and ${max}`);
  }
  const numeric = Number(parsed);
  if (numeric < min || numeric > max) {
    throw new Error(`${name} must be a decimal integer between ${min} and ${max}`);
  }
  return numeric;
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function parseAutonomousCleanupSummary(result) {
  if (result?.error) return { ok: false, issue: result.error.code === "ETIMEDOUT" ? "timeout" : "spawn-failed" };
  if (result?.status !== 0) return { ok: false, issue: "command-failed" };
  try {
    const parsed = JSON.parse(String(result.stdout ?? "").trim());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, issue: "invalid-json" };
    if (parsed.status !== "ok") return { ok: false, issue: "cleanup-not-ok" };
    for (const field of ["matchedTargets", "deletedTargets", "wouldDeleteTargets", "skippedTargets", "bytes"]) {
      if (!isNonNegativeSafeInteger(parsed[field])) return { ok: false, issue: "invalid-summary" };
    }
    return { ok: true, parsed };
  } catch {
    return { ok: false, issue: "parse-failed" };
  }
}

function compact(summary, issue) {
  return {
    status: issue ? "blocked" : "ok",
    ...(issue ? { issue } : {}),
    dryRun: summary?.dryRun ?? null,
    apply: summary?.apply ?? null,
  };
}

function compactDryRun(parsed) {
  return {
    matchedTargets: parsed.matchedTargets,
    wouldDeleteTargets: parsed.wouldDeleteTargets,
    skippedTargets: parsed.skippedTargets,
    bytes: parsed.bytes,
  };
}

function compactApply(parsed) {
  return {
    matchedTargets: parsed.matchedTargets,
    deletedTargets: parsed.deletedTargets,
    skippedTargets: parsed.skippedTargets,
    bytes: parsed.bytes,
  };
}

export function createAutonomousCleanupNpmRunner({
  root = process.cwd(),
  env = process.env,
  spawnSyncFn = spawnSync,
  nodeExecutable = process.execPath,
  platform = process.platform,
  timeout = parseAutonomousCleanupTimeout(env.CLEANUP_AUTONOMOUS_TIMEOUT_MS),
} = {}) {
  return (script) => {
    const npmCommand = env.npm_execpath ? nodeExecutable : platform === "win32" ? "npm.cmd" : "npm";
    const args = env.npm_execpath
      ? [env.npm_execpath, "--silent", "run", script]
      : ["--silent", "run", script];
    return spawnSyncFn(npmCommand, args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: AUTONOMOUS_CLEANUP_MAX_BUFFER,
      timeout,
      windowsHide: true,
    });
  };
}

export function runAutonomousCleanup({
  runNpm = createAutonomousCleanupNpmRunner(),
} = {}) {
  const dryRun = parseAutonomousCleanupSummary(runNpm("cleanup:workspace:dry-run:summary"));
  if (!dryRun.ok) return { exitCode: 1, summary: compact(null, dryRun.issue) };
  if (dryRun.parsed.mode !== "dry-run" || dryRun.parsed.deletedTargets !== 0) {
    return { exitCode: 1, summary: compact(null, "unsafe-dry-run-summary") };
  }

  const dryRunSummary = compactDryRun(dryRun.parsed);
  if (dryRun.parsed.wouldDeleteTargets === 0) {
    return { exitCode: 0, summary: compact({ dryRun: dryRunSummary }) };
  }

  const apply = parseAutonomousCleanupSummary(runNpm("cleanup:workspace:summary"));
  if (!apply.ok || apply.parsed.mode !== "apply") {
    return {
      exitCode: 1,
      summary: compact({ dryRun: dryRunSummary }, apply.issue ?? "unsafe-apply-summary"),
    };
  }
  return {
    exitCode: 0,
    summary: compact({ dryRun: dryRunSummary, apply: compactApply(apply.parsed) }),
  };
}

export function runAutonomousCleanupCli({
  env = process.env,
  root = process.cwd(),
  log = console.log,
} = {}) {
  const result = runAutonomousCleanup({ runNpm: createAutonomousCleanupNpmRunner({ env, root }) });
  log(JSON.stringify(result.summary));
  return result.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runAutonomousCleanupCli();
}
