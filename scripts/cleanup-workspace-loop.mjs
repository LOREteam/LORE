import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const pidFile = resolve(root, "logs", "workspace-cleanup-loop.pid");
const statusFile = resolve(root, "logs", "workspace-cleanup-loop.status.json");
const stopFile = resolve(root, "logs", "workspace-cleanup-loop.stop");
const pidRecordKind = "lore-workspace-cleanup-loop";
const DECIMAL_HOURS_RE = /^(0|[1-9]\d{0,5})(?:\.(\d{1,3}))?$/;
const DECIMAL_HOUR_SCALE = 1000n;
const DECIMAL_HOUR_SCALE_NUMBER = 1000;
const MILLISECONDS_PER_HOUR = 60n * 60n * 1000n;
const TRACKED_PID_RE = /^[1-9]\d{0,9}$/;
const MAX_TRACKED_PID = 2_147_483_647;
const MAX_TRACKED_PID_BIGINT = BigInt(MAX_TRACKED_PID);
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const interval = parseDecimalHoursEnv("CLEANUP_INTERVAL_HOURS", 8, { min: 0.001, max: 8_760 });
const intervalHours = interval.hours;
const intervalMs = interval.milliseconds;
const stopPollMs = 60_000;
const outputLimitBytes = 8192;

function parseDecimalHoursEnv(name, fallback, { min, max }) {
  const raw = process.env[name]?.trim();
  const value = raw && raw.length > 0 ? raw : String(fallback);
  const minScaled = parseDecimalHoursToThousandths(String(min), name);
  const maxScaled = parseDecimalHoursToThousandths(String(max), name);
  const thousandths = parseDecimalHoursToThousandths(value, name);
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

function parseDecimalHoursToThousandths(value, name) {
  const match = value.match(DECIMAL_HOURS_RE);
  if (!match) {
    throw new Error(`${name} must be a decimal hour value`);
  }
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(3, "0") || "0");
  return whole * DECIMAL_HOUR_SCALE + fraction;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parseTrackedPid(value) {
  const raw = typeof value === "number" ? String(value) : String(value ?? "").trim();
  if (!TRACKED_PID_RE.test(raw)) return null;
  const pid = BigInt(raw);
  return pid <= MAX_TRACKED_PID_BIGINT ? Number(pid) : null;
}

async function existingLoopPid() {
  const raw = await readFile(pidFile, "utf8").catch(() => "");
  let parsedPid = raw.trim();
  try {
    const parsed = JSON.parse(raw || "{}");
    parsedPid = parsed?.pid ?? parsedPid;
  } catch {
    // Legacy PID files may contain a raw PID string.
  }
  const pid = parseTrackedPid(parsedPid);
  return pid !== null && isAlive(pid) ? pid : null;
}

function safeDecimalHours(value, fallback = 8) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100_000
    ? value
    : fallback;
}

function safeNonNegativeInteger(value, fallback = 0) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function safeCleanupSummary(parsed, exitCode) {
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

async function writeLoopStatus(payload) {
  await writeFile(statusFile, `${JSON.stringify({
    kind: pidRecordKind,
    pid: process.pid,
    intervalHours,
    ...payload,
  })}\n`);
}

async function runCleanupOnce() {
  const child = spawn(process.execPath, [resolve(root, "scripts", "cleanup-workspace.mjs")], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderrBytes = 0;
  child.stdout.on("data", (chunk) => {
    if (stdout.length < outputLimitBytes) stdout += chunk.toString("utf8").slice(0, outputLimitBytes - stdout.length);
  });
  child.stderr.on("data", (chunk) => {
    stderrBytes += chunk.length;
  });
  const exitCode = await new Promise((resolveChild) => child.once("close", resolveChild));
  let parsed = null;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {}
  await writeLoopStatus({
    running: true,
    lastRunAt: new Date().toISOString(),
    nextRunAt: new Date(Date.now() + intervalMs).toISOString(),
    cleanup: {
      ...safeCleanupSummary(parsed, exitCode),
      exitCode: Number.isInteger(exitCode) ? exitCode : null,
      stderrBytes,
    },
  });
}

const existingPid = await existingLoopPid();
if (existingPid !== null && existingPid !== process.pid) process.exit(0);

await mkdir(dirname(pidFile), { recursive: true });
await rm(stopFile, { force: true }).catch(() => {});
await writeFile(pidFile, `${JSON.stringify({ kind: pidRecordKind, pid: process.pid, startedAt: new Date().toISOString() })}\n`);
await writeLoopStatus({ running: true, startedAt: new Date().toISOString(), nextRunAt: new Date().toISOString() });

async function shouldStop() {
  return (await readFile(stopFile, "utf8").catch(() => "")) === "stop\n";
}

async function waitForNextRun() {
  const started = Date.now();
  while (Date.now() - started < intervalMs) {
    if (await shouldStop()) return false;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(stopPollMs, intervalMs - (Date.now() - started))));
  }
  return true;
}

for (;;) {
  if (await shouldStop()) break;
  await runCleanupOnce();
  if (!(await waitForNextRun())) break;
}

await writeLoopStatus({ running: false, stoppedAt: new Date().toISOString() });
await rm(pidFile, { force: true }).catch(() => {});
await rm(stopFile, { force: true }).catch(() => {});
