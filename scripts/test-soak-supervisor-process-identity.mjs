import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  parseProcessStartToken,
  readProcessStartIdentity,
  verifyProcessStartIdentity,
} from "./process-start-identity.mjs";

function differentValidStartToken(token) {
  const separator = token.lastIndexOf(":");
  assert.ok(separator > 0);
  return `${token.slice(0, separator + 1)}${BigInt(token.slice(separator + 1)) + 1n}`;
}

function writeSupervisorArtifacts(directory, pid, startedAt, startToken) {
  const identity = startToken ? { supervisorStartToken: startToken } : {};
  writeFileSync(join(directory, "status.json"), `${JSON.stringify({
    status: "running",
    supervisorPid: pid,
    startedAt,
    artifacts: {},
    ...identity,
  })}\n`, "utf8");
  writeFileSync(join(directory, "supervisor.lock"), `${JSON.stringify({
    pid,
    startedAt,
    ...identity,
  })}\n`, "utf8");
}

const testRunDir = mkdtempSync(join(tmpdir(), "lore-soak-process-identity-"));
const supervisorPath = resolve("scripts", "run-testnet-soak-supervisor.mjs");
let protectedChild = null;

try {
  const selfIdentity = readProcessStartIdentity(process.pid);
  assert.equal(selfIdentity.state, "ok", "the current platform must expose a process start token");
  assert.equal(parseProcessStartToken(selfIdentity.startToken), selfIdentity.startToken);
  assert.equal(verifyProcessStartIdentity(process.pid, selfIdentity.startToken), "match");
  assert.equal(
    verifyProcessStartIdentity(process.pid, differentValidStartToken(selfIdentity.startToken)),
    "mismatch",
    "a reused PID with a different process start token must not match",
  );
  assert.equal(verifyProcessStartIdentity(process.pid, "not-a-start-token"), "unavailable");

  protectedChild = spawn(
    process.execPath,
    ["-e", "setTimeout(() => {}, 30000)"],
    { stdio: "ignore", windowsHide: true },
  );
  await once(protectedChild, "spawn");
  assert.ok(protectedChild.pid);
  const childIdentity = readProcessStartIdentity(protectedChild.pid);
  assert.equal(childIdentity.state, "ok");
  const forgedStartToken = differentValidStartToken(childIdentity.startToken);
  const startedAt = new Date().toISOString();
  writeSupervisorArtifacts(testRunDir, protectedChild.pid, startedAt, forgedStartToken);

  const staleStop = spawnSync(
    process.execPath,
    [supervisorPath, "--stop"],
    {
      cwd: process.cwd(),
      env: { ...process.env, SOAK_OUT_DIR: testRunDir },
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 16 * 1024,
    },
  );
  assert.equal(staleStop.status, 0, staleStop.stderr);
  assert.match(staleStop.stdout, /stale stopped status repaired/);
  assert.equal(
    verifyProcessStartIdentity(protectedChild.pid, childIdentity.startToken),
    "match",
    "the stop command must not signal a live process whose PID was reused",
  );
  assert.equal(existsSync(join(testRunDir, "supervisor.lock")), false);
  assert.equal(existsSync(join(testRunDir, "supervisor.stop")), false);

  writeSupervisorArtifacts(testRunDir, protectedChild.pid, startedAt, null);
  const ambiguousStop = spawnSync(
    process.execPath,
    [supervisorPath, "--stop"],
    {
      cwd: process.cwd(),
      env: { ...process.env, SOAK_OUT_DIR: testRunDir },
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 16 * 1024,
    },
  );
  assert.equal(ambiguousStop.status, 1);
  assert.match(ambiguousStop.stderr, /identity artifacts are incomplete or ambiguous/);
  assert.equal(
    verifyProcessStartIdentity(protectedChild.pid, childIdentity.startToken),
    "match",
    "ambiguous legacy artifacts must fail closed without signaling their PID",
  );
  assert.equal(existsSync(join(testRunDir, "supervisor.lock")), true);

  const supervisorSource = readFileSync(supervisorPath, "utf8");
  assert.doesNotMatch(supervisorSource, /process\.kill\(supervisor/);
  assert.match(supervisorSource, /writeStopRequest\(supervisorIdentity\)/);
  assert.match(supervisorSource, /verifyProcessStartIdentity/);
} finally {
  if (protectedChild && protectedChild.exitCode === null) {
    protectedChild.kill("SIGTERM");
    await Promise.race([
      once(protectedChild, "exit"),
      new Promise((resolveDelay) => setTimeout(resolveDelay, 3_000)),
    ]);
  }
  rmSync(testRunDir, { recursive: true, force: true });
}

console.log("soak-supervisor-process-identity: ok");
