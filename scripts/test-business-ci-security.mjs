import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  assessCiSecuritySource,
  MAX_CI_WORKFLOW_BYTES,
  readCiWorkflow,
  runCiSecurityCli,
} from "./check-ci-security.mjs";

const workflowPath = ".github/workflows/ci.yml";

function assertRejectedMutation(source, name, mutate, issuePattern) {
  const mutated = mutate(source);
  assert.notEqual(mutated, source, `${name} mutant must alter the fixture`);
  const result = assessCiSecuritySource(mutated);
  assert.equal(result.status, "fail", `${name} mutant must fail closed`);
  assert.match(result.issues.join("\n"), issuePattern, `${name} mutant must report its policy boundary`);
}

export function runCiSecurityBehaviorTests() {
  const workflow = readFileSync(workflowPath, "utf8");
  const result = assessCiSecuritySource(workflow);
  assert.deepEqual(result, {
    status: "pass",
    workflow: workflowPath,
    permissionsReadOnly: true,
    pullRequestTarget: false,
    usesPinned: true,
    checkoutPersistCredentialsFalse: true,
    weeklySchedule: true,
    safeConcurrency: true,
    jobTimeouts: true,
    ubuntuNonSchedule: true,
    windowsNonSchedule: true,
    windowsCompact: true,
    p1HardeningRows: true,
    explicitIndexerStorage: true,
    scheduledDependencyAudit: true,
    artifactPathsStrict: true,
    issues: [],
  });

  const mutations = [
    ["write permission", (value) => value.replace("contents: read", "contents: write"), /least-privilege|write-scoped/],
    ["pull_request_target", (value) => value.replace("pull_request:", "pull_request_target:"), /pull_request_target/],
    ["unpinned action", (value) => value.replace(/@[0-9a-f]{40}/, "@v4"), /pinned to an immutable/],
    ["persisted checkout credentials", (value) => value.replace("persist-credentials: false", "persist-credentials: true"), /persist-credentials: false/],
    ["weekly schedule drift", (value) => value.replace("17 4 * * 1", "18 4 * * 1"), /reviewed weekly schedule/],
    ["unsafe concurrency", (value) => value.replace("${{ github.ref }}", "${{ github.sha }}"), /concurrency/],
    ["unbounded job", (value) => value.replace("timeout-minutes: 60", "timeout-minutes: 0"), /bounded 60\/60\/15/],
    ["Windows browser path", (value) => value.replace(
      "    runs-on: windows-latest",
      "    runs-on: windows-latest\n    steps:\n      - run: npm run smoke:browser",
    ), /Windows checks job/],
    ["missing indexer storage", (value) => value.replaceAll("npm run test:indexer-storage:summary", "npm run test:db-operations:summary"), /indexer storage|compact command rows/],
    ["artifact wildcard", (value) => value.replace(".tmp/contract-compilation-provenance-v10.json", ".tmp/*.json"), /exact reviewed paths/],
    ["artifact retention", (value) => value.replace("retention-days: 7", "retention-days: 30"), /seven-day retention/],
    ["scheduled audit removal", (value) => value.replace("npm --silent run proof:deps:summary", "npm --silent run proof:wallet-deps:summary"), /scheduled dependency job/],
  ];
  for (const [name, mutate, issuePattern] of mutations) {
    assertRejectedMutation(workflow, name, mutate, issuePattern);
  }

  let readCalls = 0;
  const successfulRead = readCiWorkflow({
    workflowPath: "virtual-ci.yml",
    exists: (path) => {
      assert.equal(path, "virtual-ci.yml");
      return true;
    },
    stat: (path) => {
      assert.equal(path, "virtual-ci.yml");
      return { isFile: () => true, size: 42 };
    },
    read: (path, encoding) => {
      readCalls += 1;
      assert.equal(path, "virtual-ci.yml");
      assert.equal(encoding, "utf8");
      return workflow;
    },
  });
  assert.equal(readCalls, 1);
  assert.equal(successfulRead.source, workflow);
  assert.deepEqual(successfulRead.issues, []);

  assert.deepEqual(readCiWorkflow({ exists: () => false }), {
    source: "",
    issues: ["CI workflow is missing"],
  });
  assert.deepEqual(readCiWorkflow({
    exists: () => true,
    stat: () => ({ isFile: () => false, size: 0 }),
  }), {
    source: "",
    issues: ["CI workflow path is not a file"],
  });
  assert.deepEqual(readCiWorkflow({
    exists: () => true,
    stat: () => ({ isFile: () => true, size: MAX_CI_WORKFLOW_BYTES + 1 }),
    read: () => assert.fail("oversized workflow must be rejected before read"),
  }), {
    source: "",
    issues: ["CI workflow is too large to validate safely"],
  });
  assert.deepEqual(readCiWorkflow({
    exists: () => true,
    stat: () => ({ isFile: () => true, size: 1 }),
    read: () => { throw new Error("read secret sentinel"); },
  }), {
    source: "",
    issues: ["CI workflow could not be read"],
  });

  const summaryLogs = [];
  const summaryRun = runCiSecurityCli({
    argv: ["--summary-only"],
    readWorkflow: () => ({ source: workflow, issues: [] }),
    log: (value) => summaryLogs.push(String(value)),
  });
  assert.equal(summaryRun.exitCode, 0);
  assert.equal(JSON.parse(summaryLogs[0]).issues, 0);
  assert.deepEqual(JSON.parse(summaryLogs[0]), {
    status: "pass",
    permissionsReadOnly: true,
    pullRequestTarget: false,
    usesPinned: true,
    checkoutPersistCredentialsFalse: true,
    weeklySchedule: true,
    safeConcurrency: true,
    jobTimeouts: true,
    ubuntuNonSchedule: true,
    windowsNonSchedule: true,
    windowsCompact: true,
    p1HardeningRows: true,
    explicitIndexerStorage: true,
    scheduledDependencyAudit: true,
    artifactPathsStrict: true,
    issues: 0,
  });

  const failedLogs = [];
  const failedRun = runCiSecurityCli({
    argv: ["--summary-only"],
    readWorkflow: () => ({ source: "", issues: ["CI workflow is missing"] }),
    log: (value) => failedLogs.push(String(value)),
  });
  assert.equal(failedRun.exitCode, 1);
  const failedSummary = JSON.parse(failedLogs[0]);
  assert.equal(failedSummary.status, "fail");
  assert.equal(failedSummary.issues, 1);
  assert.equal(failedSummary.permissionsReadOnly, false);
  assert.equal(failedSummary.usesPinned, false);

  const importProbe = spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    "await import('./scripts/check-ci-security.mjs')",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(importProbe.status, 0);
  assert.equal(importProbe.stdout, "");
  assert.equal(importProbe.stderr, "");
}
