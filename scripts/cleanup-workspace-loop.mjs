import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  WORKSPACE_CLEANUP_LOOP_PID_RECORD_KIND,
  parseWorkspaceCleanupTrackedPid,
} from "./manage-workspace-cleanup-loop.mjs";

const DECIMAL_HOURS_RE = /^(0|[1-9]\d{0,5})(?:\.(\d{1,3}))?$/;
const DECIMAL_HOUR_SCALE = 1000n;
const DECIMAL_HOUR_SCALE_NUMBER = 1000;
const MILLISECONDS_PER_HOUR = 60n * 60n * 1000n;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
export const WORKSPACE_CLEANUP_LOOP_OUTPUT_LIMIT_BYTES = 8192;

function parseDecimalHoursToThousandths(value, name) {
  const match = value.match(DECIMAL_HOURS_RE);
  if (!match) throw new Error(`${name} must be a decimal hour value`);
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(3, "0") || "0");
  return whole * DECIMAL_HOUR_SCALE + fraction;
}

export function parseWorkspaceCleanupIntervalHours(value, {
  name = "CLEANUP_INTERVAL_HOURS",
  fallback = 8,
  min = 0.001,
  max = 8_760,
} = {}) {
  const text = typeof value === "string" && value.trim().length > 0 ? value.trim() : String(fallback);
  const minScaled = parseDecimalHoursToThousandths(String(min), name);
  const maxScaled = parseDecimalHoursToThousandths(String(max), name);
  const thousandths = parseDecimalHoursToThousandths(text, name);
  if (thousandths < minScaled || thousandths > maxScaled) {
    throw new Error(`${name} must be a decimal hour value between ${min} and ${max}`);
  }
  const milliseconds = (thousandths * MILLISECONDS_PER_HOUR) / DECIMAL_HOUR_SCALE;
  if (milliseconds > MAX_SAFE_INTEGER_BIGINT) {
    throw new Error(`${name} must be a decimal hour value between ${min} and ${max}`);
  }
  return {
    hours: Number(thousandths) / DECIMAL_HOUR_SCALE_NUMBER,
    milliseconds: Number(milliseconds),
  };
}

function safeDecimalHours(value, fallback = 8) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100_000
    ? value
    : fallback;
}

function safeNonNegativeInteger(value, fallback = 0) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

export function safeWorkspaceCleanupChildSummary(parsed, exitCode) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: exitCode === 0 ? "ok" : "fail", issue: "cleanup-output-unavailable" };
  }
  return {
    status: parsed.status === "ok" ? "ok" : "fail",
    mode: parsed.mode === "apply" ? "apply" : "dry-run",
    minAgeHours: safeDecimalHours(parsed.minAgeHours, 8),
    matchedTargets: safeNonNegativeInteger(parsed.matchedTargets),
    deletedTargets: safeNonNegativeInteger(parsed.deletedTargets),
    wouldDeleteTargets: safeNonNegativeInteger(parsed.wouldDeleteTargets),
    skippedTargets: safeNonNegativeInteger(parsed.skippedTargets),
    bytes: safeNonNegativeInteger(parsed.bytes),
  };
}

function defaultIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function createWorkspaceCleanupLoopRuntime({
  root = resolve(import.meta.dirname, ".."),
  env = process.env,
  fsApi = { mkdir, readFile, rm, writeFile },
  spawnFn = spawn,
  isAlive = defaultIsAlive,
  processId = process.pid,
  nodeExecutable = process.execPath,
  nowMs = Date.now,
  sleep = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)),
  stopPollMs = 60_000,
} = {}) {
  const interval = parseWorkspaceCleanupIntervalHours(env.CLEANUP_INTERVAL_HOURS);
  const intervalHours = interval.hours;
  const intervalMs = interval.milliseconds;
  const pidFile = resolve(root, "logs", "workspace-cleanup-loop.pid");
  const statusFile = resolve(root, "logs", "workspace-cleanup-loop.status.json");
  const stopFile = resolve(root, "logs", "workspace-cleanup-loop.stop");
  const cleanupScript = resolve(root, "scripts", "cleanup-workspace.mjs");

  async function existingLoopPid() {
    const raw = await fsApi.readFile(pidFile, "utf8").catch(() => "");
    let parsedPid = raw.trim();
    try {
      const parsed = JSON.parse(raw || "{}");
      parsedPid = parsed?.pid ?? parsedPid;
    } catch {
      // Legacy PID files may contain a raw PID string.
    }
    const pid = parseWorkspaceCleanupTrackedPid(parsedPid);
    return pid !== null && isAlive(pid) ? pid : null;
  }

  async function writeLoopStatus(payload) {
    await fsApi.writeFile(statusFile, `${JSON.stringify({
      kind: WORKSPACE_CLEANUP_LOOP_PID_RECORD_KIND,
      pid: processId,
      intervalHours,
      ...payload,
    })}\n`);
  }

  async function runCleanupOnce() {
    const child = spawnFn(nodeExecutable, [cleanupScript], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdoutChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    child.stdout.on("data", (chunk) => {
      if (stdoutBytes >= WORKSPACE_CLEANUP_LOOP_OUTPUT_LIMIT_BYTES) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const bounded = bytes.subarray(0, WORKSPACE_CLEANUP_LOOP_OUTPUT_LIMIT_BYTES - stdoutBytes);
      stdoutChunks.push(bounded);
      stdoutBytes += bounded.length;
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
    });
    const exitCode = await new Promise((resolveChild, rejectChild) => {
      child.once("error", rejectChild);
      child.once("close", resolveChild);
    });
    const stdout = Buffer.concat(stdoutChunks, stdoutBytes).toString("utf8");
    let parsed = null;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      // Invalid or oversized child output is represented by a bounded unavailable summary.
    }
    const completedAt = nowMs();
    const cleanup = {
      ...safeWorkspaceCleanupChildSummary(parsed, exitCode),
      exitCode: Number.isInteger(exitCode) ? exitCode : null,
      stderrBytes: safeNonNegativeInteger(stderrBytes),
    };
    await writeLoopStatus({
      running: true,
      lastRunAt: new Date(completedAt).toISOString(),
      nextRunAt: new Date(completedAt + intervalMs).toISOString(),
      cleanup,
    });
    return cleanup;
  }

  async function shouldStop() {
    return (await fsApi.readFile(stopFile, "utf8").catch(() => "")) === "stop\n";
  }

  async function waitForNextRun() {
    const started = nowMs();
    while (nowMs() - started < intervalMs) {
      if (await shouldStop()) return false;
      const remaining = intervalMs - (nowMs() - started);
      await sleep(Math.min(stopPollMs, remaining));
    }
    return true;
  }

  async function run({ maxRuns = Number.POSITIVE_INFINITY } = {}) {
    const existingPid = await existingLoopPid();
    if (existingPid !== null && existingPid !== processId) {
      return { status: "already-running", pid: existingPid, runs: 0 };
    }

    await fsApi.mkdir(dirname(pidFile), { recursive: true });
    await fsApi.rm(stopFile, { force: true }).catch(() => {});
    const startedAt = new Date(nowMs()).toISOString();
    await fsApi.writeFile(pidFile, `${JSON.stringify({
      kind: WORKSPACE_CLEANUP_LOOP_PID_RECORD_KIND,
      pid: processId,
      startedAt,
    })}\n`);
    await writeLoopStatus({ running: true, startedAt, nextRunAt: startedAt });

    let runs = 0;
    try {
      while (runs < maxRuns) {
        if (await shouldStop()) break;
        await runCleanupOnce();
        runs += 1;
        if (runs >= maxRuns || !(await waitForNextRun())) break;
      }
      await writeLoopStatus({ running: false, stoppedAt: new Date(nowMs()).toISOString() });
      return { status: "stopped", pid: processId, runs };
    } finally {
      await fsApi.rm(pidFile, { force: true }).catch(() => {});
      await fsApi.rm(stopFile, { force: true }).catch(() => {});
    }
  }

  return {
    interval,
    paths: { pidFile, statusFile, stopFile, cleanupScript },
    existingLoopPid,
    runCleanupOnce,
    shouldStop,
    waitForNextRun,
    run,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await createWorkspaceCleanupLoopRuntime().run();
}
