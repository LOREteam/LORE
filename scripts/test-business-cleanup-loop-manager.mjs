import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { pathToFileURL } from "node:url";
import {
  WORKSPACE_CLEANUP_LOOP_OUTPUT_LIMIT_BYTES,
  createWorkspaceCleanupLoopRuntime,
  parseWorkspaceCleanupIntervalHours,
  safeWorkspaceCleanupChildSummary,
} from "./cleanup-workspace-loop.mjs";
import {
  AUTONOMOUS_CLEANUP_MAX_BUFFER,
  createAutonomousCleanupNpmRunner,
  parseAutonomousCleanupSummary,
  parseAutonomousCleanupTimeout,
  runAutonomousCleanup,
} from "./run-autonomous-cleanup.mjs";
import {
  WORKSPACE_CLEANUP_LOOP_PID_RECORD_KIND,
  createWorkspaceCleanupLoopManager,
  parseWorkspaceCleanupTrackedPid,
  safeWorkspaceCleanupCount,
  safeWorkspaceCleanupTimestamp,
} from "./manage-workspace-cleanup-loop.mjs";

const REPO_ROOT = process.cwd();

function createMemoryFs(initial = new Map()) {
  const files = new Map(initial);
  const operations = [];
  return {
    files,
    operations,
    api: {
      async readFile(file, encoding) {
        operations.push(["readFile", file, encoding]);
        if (!files.has(file)) throw new Error("ENOENT");
        return files.get(file);
      },
      async mkdir(directory, options) {
        operations.push(["mkdir", directory, options]);
      },
      async rm(file, options) {
        operations.push(["rm", file, options]);
        files.delete(file);
      },
      async writeFile(file, content) {
        operations.push(["writeFile", file, content]);
        files.set(file, content);
      },
    },
  };
}

function createHarness({ initial, alive = new Set(), childPid = 777 } = {}) {
  const memory = createMemoryFs(initial);
  const logs = [];
  const spawnCalls = [];
  let unrefCalls = 0;
  const manager = createWorkspaceCleanupLoopManager({
    root: path.resolve(REPO_ROOT, ".tmp", "virtual-cleanup-manager"),
    fsApi: memory.api,
    isAlive: (pid) => alive.has(pid),
    nodeExecutable: "node.exe",
    nowIso: () => "2026-08-14T00:00:00.000Z",
    spawnFn: (...args) => {
      spawnCalls.push(args);
      return { pid: childPid, unref: () => { unrefCalls += 1; } };
    },
    log: (line) => logs.push(line),
  });
  return { manager, memory, logs, spawnCalls, get unrefCalls() { return unrefCalls; } };
}

function typedPidRecord(pid) {
  return `${JSON.stringify({ kind: WORKSPACE_CLEANUP_LOOP_PID_RECORD_KIND, pid })}\n`;
}

function createFakeCleanupChild({ stdout = [], stderr = [], exitCode = 0 } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => {
    for (const chunk of stdout) child.stdout.emit("data", Buffer.from(chunk));
    for (const chunk of stderr) child.stderr.emit("data", Buffer.from(chunk));
    child.emit("close", exitCode);
  });
  return child;
}

export async function runCleanupLoopManagerBehaviorTests() {
  for (const [value, expected] of [[1, 1], ["1", 1], ["42", 42], ["2147483647", 2_147_483_647]]) {
    assert.equal(parseWorkspaceCleanupTrackedPid(value), expected);
  }
  for (const value of [null, "", "0", "01", "+1", "1.0", "1e3", " 1x", "2147483648", 2_147_483_648]) {
    assert.equal(parseWorkspaceCleanupTrackedPid(value), null, `invalid PID must fail closed: ${String(value)}`);
  }
  assert.equal(safeWorkspaceCleanupCount(0), 0);
  assert.equal(safeWorkspaceCleanupCount(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1", null]) {
    assert.equal(safeWorkspaceCleanupCount(value), 0);
  }
  assert.equal(safeWorkspaceCleanupTimestamp("2026-08-14T00:00:00.000Z"), "2026-08-14T00:00:00.000Z");
  assert.equal(safeWorkspaceCleanupTimestamp(" 2026-08-14T00:00:00.000Z "), "2026-08-14T00:00:00.000Z");
  for (const value of ["2026-08-14T00:00:00Z", "2026-08-14", "invalid", null]) {
    assert.equal(safeWorkspaceCleanupTimestamp(value), null);
  }

  const empty = createHarness();
  const emptyStatus = await empty.manager.run("status");
  assert.deepEqual(emptyStatus, { exitCode: 0, payload: { status: "stopped", pid: null } });
  assert.deepEqual(JSON.parse(empty.logs[0]), emptyStatus.payload);
  assert.equal(empty.spawnCalls.length, 0);

  const root = path.resolve(REPO_ROOT, ".tmp", "virtual-cleanup-manager");
  const pidFile = path.resolve(root, "logs", "workspace-cleanup-loop.pid");
  const statusFile = path.resolve(root, "logs", "workspace-cleanup-loop.status.json");
  const stopFile = path.resolve(root, "logs", "workspace-cleanup-loop.stop");
  const live = createHarness({
    alive: new Set([321]),
    initial: new Map([
      [pidFile, typedPidRecord(321)],
      [stopFile, "stop\n"],
      [statusFile, JSON.stringify({
        kind: WORKSPACE_CLEANUP_LOOP_PID_RECORD_KIND,
        lastRunAt: "2026-08-14T00:00:00.000Z",
        nextRunAt: "not-an-iso-time",
        cleanup: {
          status: "ok",
          mode: "apply",
          matchedTargets: 3,
          deletedTargets: -1,
          skippedTargets: 1.5,
          bytes: Number.MAX_SAFE_INTEGER + 1,
          targets: ["C:/private/path"],
        },
      })],
    ]),
  });
  const liveStatus = await live.manager.run("status");
  assert.deepEqual(liveStatus.payload, {
    status: "running",
    pid: 321,
    lastRunAt: "2026-08-14T00:00:00.000Z",
    cleanup: {
      status: "ok",
      mode: "apply",
      matchedTargets: 3,
      deletedTargets: 0,
      skippedTargets: 0,
      bytes: 0,
    },
    stopRequested: true,
  });
  assert.doesNotMatch(live.logs[0], /private|targets|stderr|stdout/);

  const legacy = createHarness({ alive: new Set([654]), initial: new Map([[pidFile, "654\n"]]) });
  const legacyStatus = await legacy.manager.run("status");
  assert.deepEqual(legacyStatus.payload, { status: "running", pid: 654, issue: "legacy-pid-record" });
  const legacyStart = await legacy.manager.run("start");
  assert.deepEqual(legacyStart.payload, { status: "running", pid: 654, issue: "legacy-pid-record" });
  assert.equal(legacy.spawnCalls.length, 0);
  const legacyStop = await legacy.manager.run("stop");
  assert.deepEqual(legacyStop.payload, { status: "stopping", pid: 654, issue: "legacy-pid-record" });
  assert.equal(legacy.memory.files.get(stopFile), "stop\n");
  assert.equal(legacy.memory.operations.some(([operation]) => operation === "kill"), false);

  const trustedStop = createHarness({ alive: new Set([321]), initial: new Map([[pidFile, typedPidRecord(321)]]) });
  const trustedStopResult = await trustedStop.manager.run("stop");
  assert.deepEqual(trustedStopResult.payload, { status: "stopping", pid: 321 });
  assert.equal(trustedStop.memory.files.get(stopFile), "stop\n");

  const alreadyRunning = createHarness({ alive: new Set([321]), initial: new Map([
    [pidFile, typedPidRecord(321)],
    [stopFile, "stop\n"],
  ]) });
  const alreadyRunningResult = await alreadyRunning.manager.run("start");
  assert.deepEqual(alreadyRunningResult.payload, { status: "running", pid: 321, stopRequested: true });
  assert.equal(alreadyRunning.spawnCalls.length, 0);

  const started = createHarness({ initial: new Map([[pidFile, typedPidRecord(999)], [stopFile, "stop\n"]]) });
  const startedResult = await started.manager.run("start");
  assert.deepEqual(startedResult.payload, { status: "started", pid: 777 });
  assert.equal(started.spawnCalls.length, 1);
  const [command, args, options] = started.spawnCalls[0];
  assert.equal(command, "node.exe");
  assert.deepEqual(args, [path.resolve(root, "scripts", "cleanup-workspace-loop.mjs")]);
  assert.deepEqual(options, { cwd: root, detached: true, stdio: "ignore", windowsHide: true });
  assert.equal(started.unrefCalls, 1);
  assert.equal(started.memory.files.has(stopFile), false);
  assert.deepEqual(JSON.parse(started.memory.files.get(pidFile)), {
    kind: WORKSPACE_CLEANUP_LOOP_PID_RECORD_KIND,
    pid: 777,
    startedAt: "2026-08-14T00:00:00.000Z",
  });

  const invalidChild = createHarness({ childPid: "777x" });
  await assert.rejects(() => invalidChild.manager.run("start"), /cleanup loop child PID unavailable/);
  assert.equal(invalidChild.unrefCalls, 0);
  assert.equal(invalidChild.memory.files.has(pidFile), false);

  const absentStop = createHarness({ initial: new Map([[pidFile, "invalid"], [stopFile, "stop\n"]]) });
  const absentStopResult = await absentStop.manager.run("stop");
  assert.deepEqual(absentStopResult.payload, { status: "stopped", pid: null });
  assert.equal(absentStop.memory.files.has(pidFile), false);
  assert.equal(absentStop.memory.files.has(stopFile), false);

  const unknown = createHarness();
  const unknownResult = await unknown.manager.run("apply");
  assert.deepEqual(unknownResult, {
    exitCode: 1,
    payload: { status: "fail", issue: "unknown-mode", modes: "start,status,stop" },
  });
  assert.equal(unknown.spawnCalls.length, 0);

  assert.deepEqual(parseWorkspaceCleanupIntervalHours(undefined), { hours: 8, milliseconds: 28_800_000 });
  assert.deepEqual(parseWorkspaceCleanupIntervalHours("0.001"), { hours: 0.001, milliseconds: 3_600 });
  assert.deepEqual(parseWorkspaceCleanupIntervalHours("8760"), { hours: 8_760, milliseconds: 31_536_000_000 });
  for (const value of ["0", "00.001", ".001", "0.0001", "01", "+1", "1e3", "8760.001", "1000000", " 1x "]) {
    assert.throws(() => parseWorkspaceCleanupIntervalHours(value), /CLEANUP_INTERVAL_HOURS/);
  }
  assert.deepEqual(safeWorkspaceCleanupChildSummary(null, 0), {
    status: "ok",
    issue: "cleanup-output-unavailable",
  });
  assert.deepEqual(safeWorkspaceCleanupChildSummary(null, 1), {
    status: "fail",
    issue: "cleanup-output-unavailable",
  });
  assert.deepEqual(safeWorkspaceCleanupChildSummary({
    status: "ok",
    mode: "apply",
    minAgeHours: 2,
    matchedTargets: 3,
    deletedTargets: -1,
    wouldDeleteTargets: 1.5,
    skippedTargets: 2,
    bytes: Number.MAX_SAFE_INTEGER + 1,
    targets: ["C:/private/path"],
  }, 0), {
    status: "ok",
    mode: "apply",
    minAgeHours: 2,
    matchedTargets: 3,
    deletedTargets: 0,
    wouldDeleteTargets: 0,
    skippedTargets: 2,
    bytes: 0,
  });

  const loopRoot = path.resolve(REPO_ROOT, ".tmp", "virtual-cleanup-loop");
  const loopPidFile = path.resolve(loopRoot, "logs", "workspace-cleanup-loop.pid");
  const loopStatusFile = path.resolve(loopRoot, "logs", "workspace-cleanup-loop.status.json");
  const loopStopFile = path.resolve(loopRoot, "logs", "workspace-cleanup-loop.stop");
  const loopMemory = createMemoryFs(new Map([[loopPidFile, typedPidRecord(999)]]));
  let loopSpawnCalls = 0;
  const existingLoop = createWorkspaceCleanupLoopRuntime({
    root: loopRoot,
    env: { CLEANUP_INTERVAL_HOURS: "0.001" },
    fsApi: loopMemory.api,
    isAlive: (pid) => pid === 999,
    processId: 777,
    spawnFn: () => { loopSpawnCalls += 1; return createFakeCleanupChild(); },
    nowMs: () => 0,
    sleep: async () => {},
  });
  assert.deepEqual(await existingLoop.run({ maxRuns: 1 }), { status: "already-running", pid: 999, runs: 0 });
  assert.equal(loopSpawnCalls, 0);
  assert.equal(loopMemory.operations.some(([operation]) => operation === "writeFile"), false);

  const runMemory = createMemoryFs(new Map([[loopStopFile, "stop\n"]]));
  const runSpawnCalls = [];
  const loopRun = createWorkspaceCleanupLoopRuntime({
    root: loopRoot,
    env: { CLEANUP_INTERVAL_HOURS: "0.001" },
    fsApi: runMemory.api,
    isAlive: () => false,
    processId: 777,
    nodeExecutable: "node.exe",
    spawnFn: (...args) => {
      runSpawnCalls.push(args);
      return createFakeCleanupChild({
        stdout: [JSON.stringify({ status: "ok", mode: "apply", matchedTargets: 2, deletedTargets: 1, skippedTargets: 1, bytes: 44 })],
        stderr: ["warning"],
        exitCode: 0,
      });
    },
    nowMs: () => 0,
    sleep: async () => {},
  });
  const loopRunResult = await loopRun.run({ maxRuns: 1 });
  assert.deepEqual(loopRunResult, { status: "stopped", pid: 777, runs: 1 });
  assert.equal(runSpawnCalls.length, 1);
  assert.equal(runSpawnCalls[0][0], "node.exe");
  assert.deepEqual(runSpawnCalls[0][1], [path.resolve(loopRoot, "scripts", "cleanup-workspace.mjs")]);
  assert.deepEqual(runSpawnCalls[0][2], {
    cwd: loopRoot,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  assert.equal(runMemory.files.has(loopPidFile), false);
  assert.equal(runMemory.files.has(loopStopFile), false);
  const loopStatusWrites = runMemory.operations
    .filter(([operation, file]) => operation === "writeFile" && file === loopStatusFile)
    .map(([, , content]) => JSON.parse(content));
  assert.equal(loopStatusWrites.length, 3);
  assert.deepEqual(loopStatusWrites[1].cleanup, {
    status: "ok",
    mode: "apply",
    minAgeHours: 8,
    matchedTargets: 2,
    deletedTargets: 1,
    wouldDeleteTargets: 0,
    skippedTargets: 1,
    bytes: 44,
    exitCode: 0,
    stderrBytes: 7,
  });
  assert.deepEqual(loopStatusWrites[2], {
    kind: WORKSPACE_CLEANUP_LOOP_PID_RECORD_KIND,
    pid: 777,
    intervalHours: 0.001,
    running: false,
    stoppedAt: "1970-01-01T00:00:00.000Z",
  });

  const boundedMemory = createMemoryFs();
  const boundedLoop = createWorkspaceCleanupLoopRuntime({
    root: loopRoot,
    env: { CLEANUP_INTERVAL_HOURS: "0.001" },
    fsApi: boundedMemory.api,
    processId: 777,
    spawnFn: () => createFakeCleanupChild({
      stdout: ["x".repeat(WORKSPACE_CLEANUP_LOOP_OUTPUT_LIMIT_BYTES + 100)],
      stderr: ["e".repeat(12_000)],
      exitCode: 1,
    }),
    nowMs: () => 0,
  });
  assert.deepEqual(await boundedLoop.runCleanupOnce(), {
    status: "fail",
    issue: "cleanup-output-unavailable",
    exitCode: 1,
    stderrBytes: 12_000,
  });
  const boundedStatus = JSON.parse(boundedMemory.files.get(loopStatusFile));
  assert.doesNotMatch(JSON.stringify(boundedStatus), /x{100}|e{100}|private/);

  let waitClock = 0;
  const waitMemory = createMemoryFs();
  const waitLoop = createWorkspaceCleanupLoopRuntime({
    root: loopRoot,
    env: { CLEANUP_INTERVAL_HOURS: "0.001" },
    fsApi: waitMemory.api,
    processId: 777,
    nowMs: () => waitClock,
    stopPollMs: 100,
    sleep: async (milliseconds) => {
      waitClock += milliseconds;
      waitMemory.files.set(loopStopFile, "stop\n");
    },
  });
  assert.equal(await waitLoop.waitForNextRun(), false);
  assert.equal(waitClock, 100);

  assert.equal(parseAutonomousCleanupTimeout(undefined), 120_000);
  assert.equal(parseAutonomousCleanupTimeout("1000"), 1_000);
  assert.equal(parseAutonomousCleanupTimeout("900000"), 900_000);
  for (const value of ["999", "900001", "01", "+1000", "1e3", "1000.0", "9007199254740992", "x"]) {
    assert.throws(() => parseAutonomousCleanupTimeout(value), /CLEANUP_AUTONOMOUS_TIMEOUT_MS/);
  }
  assert.deepEqual(parseAutonomousCleanupSummary({ error: { code: "ETIMEDOUT" } }), { ok: false, issue: "timeout" });
  assert.deepEqual(parseAutonomousCleanupSummary({ error: { code: "EACCES" } }), { ok: false, issue: "spawn-failed" });
  assert.deepEqual(parseAutonomousCleanupSummary({ status: 1, stdout: "{}" }), { ok: false, issue: "command-failed" });
  assert.deepEqual(parseAutonomousCleanupSummary({ status: 0, stdout: "not-json" }), { ok: false, issue: "parse-failed" });
  assert.deepEqual(parseAutonomousCleanupSummary({ status: 0, stdout: "[]" }), { ok: false, issue: "invalid-json" });
  assert.deepEqual(parseAutonomousCleanupSummary({ status: 0, stdout: '{"status":"fail"}' }), { ok: false, issue: "cleanup-not-ok" });
  for (const invalid of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1", null]) {
    const parsed = parseAutonomousCleanupSummary({
      status: 0,
      stdout: JSON.stringify({
        status: "ok",
        mode: "dry-run",
        matchedTargets: invalid,
        deletedTargets: 0,
        wouldDeleteTargets: 0,
        skippedTargets: 0,
        bytes: 0,
      }),
    });
    assert.deepEqual(parsed, { ok: false, issue: "invalid-summary" });
  }

  const cleanupResult = (overrides = {}) => ({
    status: 0,
    stdout: JSON.stringify({
      status: "ok",
      mode: "dry-run",
      matchedTargets: 2,
      deletedTargets: 0,
      wouldDeleteTargets: 1,
      skippedTargets: 1,
      bytes: 44,
      targets: ["C:/private/path"],
      ...overrides,
    }),
  });
  const commandCalls = [];
  const happy = runAutonomousCleanup({
    runNpm: (script) => {
      commandCalls.push(script);
      return script === "cleanup:workspace:dry-run:summary"
        ? cleanupResult()
        : cleanupResult({ mode: "apply", deletedTargets: 1, wouldDeleteTargets: 0 });
    },
  });
  assert.deepEqual(commandCalls, ["cleanup:workspace:dry-run:summary", "cleanup:workspace:summary"]);
  assert.deepEqual(happy, {
    exitCode: 0,
    summary: {
      status: "ok",
      dryRun: { matchedTargets: 2, wouldDeleteTargets: 1, skippedTargets: 1, bytes: 44 },
      apply: { matchedTargets: 2, deletedTargets: 1, skippedTargets: 1, bytes: 44 },
    },
  });
  assert.doesNotMatch(JSON.stringify(happy), /private|targets\":\[/);

  let noApplyCalls = 0;
  const noApply = runAutonomousCleanup({
    runNpm: (script) => {
      noApplyCalls += 1;
      assert.equal(script, "cleanup:workspace:dry-run:summary");
      return cleanupResult({ matchedTargets: 0, wouldDeleteTargets: 0, skippedTargets: 0, bytes: 0 });
    },
  });
  assert.equal(noApplyCalls, 1);
  assert.deepEqual(noApply, {
    exitCode: 0,
    summary: {
      status: "ok",
      dryRun: { matchedTargets: 0, wouldDeleteTargets: 0, skippedTargets: 0, bytes: 0 },
      apply: null,
    },
  });

  for (const [label, dryRunResult, expectedIssue] of [
    ["timeout", { error: { code: "ETIMEDOUT" } }, "timeout"],
    ["failed", { status: 1, stdout: "" }, "command-failed"],
    ["malformed", { status: 0, stdout: "not-json" }, "parse-failed"],
    ["wrong-mode", cleanupResult({ mode: "apply" }), "unsafe-dry-run-summary"],
    ["deleted", cleanupResult({ deletedTargets: 1 }), "unsafe-dry-run-summary"],
  ]) {
    let calls = 0;
    const result = runAutonomousCleanup({ runNpm: () => { calls += 1; return dryRunResult; } });
    assert.equal(calls, 1, `${label} dry-run failure must not invoke apply`);
    assert.equal(result.exitCode, 1);
    assert.equal(result.summary.issue, expectedIssue);
    assert.equal(result.summary.apply, null);
  }

  const unsafeApply = runAutonomousCleanup({
    runNpm: (script) => script === "cleanup:workspace:dry-run:summary"
      ? cleanupResult()
      : cleanupResult({ mode: "dry-run" }),
  });
  assert.deepEqual(unsafeApply, {
    exitCode: 1,
    summary: {
      status: "blocked",
      issue: "unsafe-apply-summary",
      dryRun: { matchedTargets: 2, wouldDeleteTargets: 1, skippedTargets: 1, bytes: 44 },
      apply: null,
    },
  });
  const failedApply = runAutonomousCleanup({
    runNpm: (script) => script === "cleanup:workspace:dry-run:summary" ? cleanupResult() : { status: 1, stdout: "" },
  });
  assert.equal(failedApply.exitCode, 1);
  assert.equal(failedApply.summary.issue, "command-failed");

  const spawnCalls = [];
  const npmRunner = createAutonomousCleanupNpmRunner({
    root: "C:/repo",
    env: { npm_execpath: "C:/npm/npm-cli.js", CLEANUP_AUTONOMOUS_TIMEOUT_MS: "1000" },
    nodeExecutable: "node.exe",
    platform: "win32",
    spawnSyncFn: (...args) => { spawnCalls.push(args); return { status: 0, stdout: "{}" }; },
  });
  npmRunner("cleanup:workspace:summary");
  assert.deepEqual(spawnCalls, [[
    "node.exe",
    ["C:/npm/npm-cli.js", "--silent", "run", "cleanup:workspace:summary"],
    { cwd: "C:/repo", encoding: "utf8", maxBuffer: AUTONOMOUS_CLEANUP_MAX_BUFFER, timeout: 1_000, windowsHide: true },
  ]]);

  const importProbe = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", "await import('./scripts/manage-workspace-cleanup-loop.mjs'); await import('./scripts/cleanup-workspace-loop.mjs'); await import('./scripts/run-autonomous-cleanup.mjs')"],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 10_000 },
  );
  assert.equal(importProbe.status, 0, importProbe.stderr);
  assert.equal(importProbe.stdout, "");
  assert.equal(importProbe.stderr, "");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCleanupLoopManagerBehaviorTests();
  console.log("Workspace cleanup loop manager behavioral tests passed.");
}
