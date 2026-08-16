import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const WORKSPACE_CLEANUP_LOOP_PID_RECORD_KIND = "lore-workspace-cleanup-loop";
const TRACKED_PID_RE = /^[1-9]\d{0,9}$/;
const MAX_TRACKED_PID = 2_147_483_647;
const MAX_TRACKED_PID_BIGINT = BigInt(MAX_TRACKED_PID);

export function parseWorkspaceCleanupTrackedPid(value) {
  const raw = typeof value === "number" ? String(value) : String(value ?? "").trim();
  if (!TRACKED_PID_RE.test(raw)) return null;
  const pid = BigInt(raw);
  return pid <= MAX_TRACKED_PID_BIGINT ? Number(pid) : null;
}

export function safeWorkspaceCleanupCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function safeWorkspaceCleanupTimestamp(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(normalized)) return null;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized ? null : normalized;
}

function defaultIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function createWorkspaceCleanupLoopManager({
  root = process.cwd(),
  fsApi = { mkdir, readFile, rm, writeFile },
  spawnFn = spawn,
  isAlive = defaultIsAlive,
  nowIso = () => new Date().toISOString(),
  nodeExecutable = process.execPath,
  log = console.log,
} = {}) {
  const pidFile = resolve(root, "logs", "workspace-cleanup-loop.pid");
  const statusFile = resolve(root, "logs", "workspace-cleanup-loop.status.json");
  const stopFile = resolve(root, "logs", "workspace-cleanup-loop.stop");
  const loopScript = resolve(root, "scripts", "cleanup-workspace-loop.mjs");

  async function readPidRecord() {
    const raw = await fsApi.readFile(pidFile, "utf8").catch(() => "");
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
      pid: parseWorkspaceCleanupTrackedPid(parsedPid ?? raw.trim()),
      trusted: kind === WORKSPACE_CLEANUP_LOOP_PID_RECORD_KIND,
    };
  }

  async function readSafeLoopStatus() {
    const raw = await fsApi.readFile(statusFile, "utf8").catch(() => "");
    if (!raw.trim()) return {};
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || parsed.kind !== WORKSPACE_CLEANUP_LOOP_PID_RECORD_KIND) return {};
      const cleanup = parsed.cleanup && typeof parsed.cleanup === "object" && !Array.isArray(parsed.cleanup)
        ? {
            status: parsed.cleanup.status === "ok" ? "ok" : "fail",
            mode: parsed.cleanup.mode === "apply" ? "apply" : "dry-run",
            matchedTargets: safeWorkspaceCleanupCount(parsed.cleanup.matchedTargets),
            deletedTargets: safeWorkspaceCleanupCount(parsed.cleanup.deletedTargets),
            skippedTargets: safeWorkspaceCleanupCount(parsed.cleanup.skippedTargets),
            bytes: safeWorkspaceCleanupCount(parsed.cleanup.bytes),
          }
        : null;
      const lastRunAt = safeWorkspaceCleanupTimestamp(parsed.lastRunAt);
      const nextRunAt = safeWorkspaceCleanupTimestamp(parsed.nextRunAt);
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
    return (await fsApi.readFile(stopFile, "utf8").catch(() => "")) === "stop\n";
  }

  function print(payload) {
    log(JSON.stringify(payload));
    return payload;
  }

  async function status() {
    const { pid, trusted } = await readPidRecord();
    const running = pid !== null && isAlive(pid);
    const loopStatus = await readSafeLoopStatus();
    const requestedStop = await stopRequested();
    return print({
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
      return print({
        status: "running",
        pid,
        ...(requestedStop ? { stopRequested: true } : {}),
        ...(trusted ? {} : { issue: "legacy-pid-record" }),
      });
    }
    await fsApi.mkdir(dirname(pidFile), { recursive: true });
    await fsApi.rm(stopFile, { force: true }).catch(() => {});
    const child = spawnFn(nodeExecutable, [loopScript], {
      cwd: root,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    const childPid = parseWorkspaceCleanupTrackedPid(child.pid);
    if (childPid === null) throw new Error("cleanup loop child PID unavailable");
    child.unref();
    await fsApi.writeFile(pidFile, `${JSON.stringify({
      kind: WORKSPACE_CLEANUP_LOOP_PID_RECORD_KIND,
      pid: childPid,
      startedAt: nowIso(),
    })}\n`);
    return print({ status: "started", pid: childPid });
  }

  async function stop() {
    const { pid, trusted } = await readPidRecord();
    if (pid === null || !isAlive(pid)) {
      await fsApi.rm(pidFile, { force: true }).catch(() => {});
      await fsApi.rm(stopFile, { force: true }).catch(() => {});
      return print({ status: "stopped", pid: null });
    }
    await fsApi.writeFile(stopFile, "stop\n");
    return print({ status: "stopping", pid, ...(trusted ? {} : { issue: "legacy-pid-record" }) });
  }

  async function run(mode = "status") {
    if (mode === "start") return { exitCode: 0, payload: await start() };
    if (mode === "stop") return { exitCode: 0, payload: await stop() };
    if (mode === "status") return { exitCode: 0, payload: await status() };
    return {
      exitCode: 1,
      payload: print({ status: "fail", issue: "unknown-mode", modes: "start,status,stop" }),
    };
  }

  return { paths: { pidFile, statusFile, stopFile, loopScript }, readPidRecord, readSafeLoopStatus, run };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manager = createWorkspaceCleanupLoopManager();
  const result = await manager.run(process.argv[2] ?? "status");
  process.exitCode = result.exitCode;
}
