import { spawnSync } from "node:child_process";

const root = process.cwd();
const maxBuffer = 64 * 1024;
const DECIMAL_INTEGER_RE = /^(?:0|[1-9]\d{0,15})$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const timeout = parsePositiveIntegerEnv("CLEANUP_AUTONOMOUS_TIMEOUT_MS", 120_000, 1_000, 900_000);

function parsePositiveIntegerEnv(name, fallback, min, max) {
  const raw = process.env[name]?.trim();
  const value = raw && raw.length > 0 ? raw : String(fallback);
  if (!DECIMAL_INTEGER_RE.test(value)) {
    throw new Error(`${name} must be a decimal integer between ${min} and ${max}`);
  }
  const parsed = BigInt(value);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) {
    throw new Error(`${name} must be a decimal integer between ${min} and ${max}`);
  }
  const numeric = Number(parsed);
  if (numeric < min || numeric > max) {
    throw new Error(`${name} must be a decimal integer between ${min} and ${max}`);
  }
  return numeric;
}

function npmRun(script) {
  const npmCommand = process.env.npm_execpath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const args = process.env.npm_execpath
    ? [process.env.npm_execpath, "--silent", "run", script]
    : ["--silent", "run", script];
  return spawnSync(npmCommand, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer,
    timeout,
    windowsHide: true,
  });
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function parseSummary(result) {
  if (result.error) return { ok: false, issue: result.error.code === "ETIMEDOUT" ? "timeout" : "spawn-failed" };
  if (result.status !== 0) return { ok: false, issue: "command-failed" };
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
    issue,
    dryRun: summary?.dryRun ?? null,
    apply: summary?.apply ?? null,
  };
}

const dryRun = parseSummary(npmRun("cleanup:workspace:dry-run:summary"));
if (!dryRun.ok) {
  console.log(JSON.stringify(compact(null, dryRun.issue)));
  process.exitCode = 1;
} else if (dryRun.parsed.mode !== "dry-run" || dryRun.parsed.deletedTargets !== 0) {
  console.log(JSON.stringify(compact(null, "unsafe-dry-run-summary")));
  process.exitCode = 1;
} else if (dryRun.parsed.wouldDeleteTargets === 0) {
  console.log(JSON.stringify(compact({
    dryRun: {
      matchedTargets: dryRun.parsed.matchedTargets,
      wouldDeleteTargets: dryRun.parsed.wouldDeleteTargets,
      skippedTargets: dryRun.parsed.skippedTargets,
      bytes: dryRun.parsed.bytes,
    },
  })));
} else {
  const apply = parseSummary(npmRun("cleanup:workspace:summary"));
  if (!apply.ok || apply.parsed.mode !== "apply") {
    console.log(JSON.stringify(compact({
      dryRun: {
        matchedTargets: dryRun.parsed.matchedTargets,
        wouldDeleteTargets: dryRun.parsed.wouldDeleteTargets,
        skippedTargets: dryRun.parsed.skippedTargets,
        bytes: dryRun.parsed.bytes,
      },
    }, apply.issue ?? "unsafe-apply-summary")));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(compact({
      dryRun: {
        matchedTargets: dryRun.parsed.matchedTargets,
        wouldDeleteTargets: dryRun.parsed.wouldDeleteTargets,
        skippedTargets: dryRun.parsed.skippedTargets,
        bytes: dryRun.parsed.bytes,
      },
      apply: {
        matchedTargets: apply.parsed.matchedTargets,
        deletedTargets: apply.parsed.deletedTargets,
        skippedTargets: apply.parsed.skippedTargets,
        bytes: apply.parsed.bytes,
      },
    })));
  }
}
