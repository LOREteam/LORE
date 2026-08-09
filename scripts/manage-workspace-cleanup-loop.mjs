import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const pidFile = resolve(root, "logs", "workspace-cleanup-loop.pid");
const statusFile = resolve(root, "logs", "workspace-cleanup-loop.status.json");
const stopFile = resolve(root, "logs", "workspace-cleanup-loop.stop");
const pidRecordKind = "lore-workspace-cleanup-loop";
const TRACKED_PID_RE = /^[1-9]\d{0,9}$/;
const MAX_TRACKED_PID = 2_147_483_647;
const MAX_TRACKED_PID_BIGINT = BigInt(MAX_TRACKED_PID);
const mode = process.argv[2] ?? "status";

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

function safeNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function safeIsoTimestamp(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(normalized)) return null;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized ? null : normalized;
}

async function readPidRecord() {
  const raw = await readFile(pidFile, "utf8").catch(() => "");
  let kind = null;
  let parsedPid = null;
  try {
    const parsed = JSON.parse(raw || "{}");
    kind = typeof parsed.kind === "string" ? parsed.kind : null;
    parsedPid = parsed.pid;
  } catch {
    parsedPid = raw.trim();
  }
  return {
    pid: parseTrackedPid(parsedPid ?? raw.trim()),
    trusted: kind === pidRecordKind,
  };
}

async function readSafeLoopStatus() {
  const raw = await readFile(statusFile, "utf8").catch(() => "");
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || parsed.kind !== pidRecordKind) return {};
    const cleanup = parsed.cleanup && typeof parsed.cleanup === "object" && !Array.isArray(parsed.cleanup)
      ? {
          status: parsed.cleanup.status === "ok" ? "ok" : "fail",
          mode: parsed.cleanup.mode === "apply" ? "apply" : "dry-run",
          matchedTargets: safeNonNegativeInteger(parsed.cleanup.matchedTargets),
          deletedTargets: safeNonNegativeInteger(parsed.cleanup.deletedTargets),
          skippedTargets: safeNonNegativeInteger(parsed.cleanup.skippedTargets),
          bytes: safeNonNegativeInteger(parsed.cleanup.bytes),
        }
      : null;
    const lastRunAt = safeIsoTimestamp(parsed.lastRunAt);
    const nextRunAt = safeIsoTimestamp(parsed.nextRunAt);
    return {
      ...(lastRunAt ? { lastRunAt } : {}),
      ...(nextRunAt ? { nextRunAt } : {}),
      ...(cleanup ? { cleanup } : {}),
    };
  } catch {
    return { issue: "status-read-failed" };
  }
}

async function stopRequested() {
  return (await readFile(stopFile, "utf8").catch(() => "")) === "stop\n";
}

function print(payload) {
  console.log(JSON.stringify(payload));
}

async function status() {
  const { pid, trusted } = await readPidRecord();
  const running = pid !== null && isAlive(pid);
  const loopStatus = await readSafeLoopStatus();
  const requestedStop = await stopRequested();
  print({
    status: running ? "running" : "stopped",
    pid: running ? pid : null,
    ...loopStatus,
    ...(requestedStop ? { stopRequested: true } : {}),
    ...(running && !trusted ? { issue: "legacy-pid-record" } : {}),
  });
}

async function start() {
  const { pid, trusted } = await readPidRecord();
  if (pid !== null && isAlive(pid)) {
    const requestedStop = await stopRequested();
    print({
      status: "running",
      pid,
      ...(requestedStop ? { stopRequested: true } : {}),
      ...(trusted ? {} : { issue: "legacy-pid-record" }),
    });
    return;
  }
  await mkdir(dirname(pidFile), { recursive: true });
  await rm(stopFile, { force: true }).catch(() => {});
  const child = spawn(process.execPath, [resolve(root, "scripts", "cleanup-workspace-loop.mjs")], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  await writeFile(pidFile, `${JSON.stringify({ kind: pidRecordKind, pid: child.pid, startedAt: new Date().toISOString() })}\n`);
  print({ status: "started", pid: child.pid });
}

async function stop() {
  const { pid, trusted } = await readPidRecord();
  if (pid === null || !isAlive(pid)) {
    await rm(pidFile, { force: true }).catch(() => {});
    await rm(stopFile, { force: true }).catch(() => {});
    print({ status: "stopped", pid: null });
    return;
  }
  if (!trusted) {
    await writeFile(stopFile, "stop\n");
    print({ status: "stopping", pid, issue: "legacy-pid-record" });
    return;
  }
  await writeFile(stopFile, "stop\n");
  print({ status: "stopping", pid });
}

if (mode === "start") await start();
else if (mode === "stop") await stop();
else if (mode === "status") await status();
else {
  print({ status: "fail", issue: "unknown-mode", modes: "start,status,stop" });
  process.exitCode = 1;
}
