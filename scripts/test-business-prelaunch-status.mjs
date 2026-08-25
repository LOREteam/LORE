import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function runProbe(flag) {
  return spawnSync(process.execPath, ["scripts/report-prelaunch-status.mjs", flag], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NO_UPDATE_NOTIFIER: "1",
      NPM_CONFIG_UPDATE_NOTIFIER: "false",
      PRELAUNCH_CHECK_TIMEOUT_MS: "1000",
    },
    encoding: "utf8",
    timeout: 15_000,
  });
}

export function runPrelaunchStatusBehaviorTests() {
  const behavior = runProbe("--behavior-self-test");
  assert.equal(
    behavior.status,
    0,
    `prelaunch behavior self-test must pass: ${behavior.error?.message ?? behavior.stderr}`,
  );
  assert.equal(String(behavior.stderr), "", "behavior self-test must not emit stderr");
  assert.deepEqual(JSON.parse(String(behavior.stdout).trim()), {
    status: "pass",
    summaryVectors: 25,
    streamedRows: 3,
    faultMutantsRejected: 7,
    networkRequests: 0,
    childProcesses: 0,
  });

  const manifest = runProbe("--manifest-self-test");
  assert.equal(
    manifest.status,
    0,
    `prelaunch manifest self-test must pass: ${manifest.error?.message ?? manifest.stderr}`,
  );
  assert.equal(String(manifest.stderr), "", "manifest self-test must not emit stderr");
  const manifestSummary = JSON.parse(String(manifest.stdout).trim());
  assert.equal(manifestSummary.status, "pass");
  assert.equal(manifestSummary.faultMutantsRejected, 4);
  assert.ok(manifestSummary.checks >= 60);
  assert.deepEqual(manifestSummary.externalSequence, [
    "proof:testnet:canary:strict:summary",
    "proof:testnet:canary:v10:summary",
    "db:backup:summary",
  ]);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  runPrelaunchStatusBehaviorTests();
  console.log("prelaunch status behavior tests passed");
}
