import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  AUTONOMOUS_DAILY_CHECKS,
  autonomousDailyManifestIssues,
  extractLastAutonomousDailyJsonObject,
  parseAutonomousDailyPositiveInteger,
  runAutonomousDailyStatus,
  summarizeAutonomousDailyCheck,
} from "./report-autonomous-daily-status.mjs";

const EXPECTED_MANIFEST = [
  ["deps-prod", "production dependency audit", "proof:deps:summary"],
  ["deps-all", "all dependency audit", "proof:deps:all:summary"],
  ["wallet-deps", "wallet dependency integrity", "proof:wallet-deps:summary"],
  ["ci-security", "CI security", "proof:ci-security:summary"],
  ["bundle", "bundle baseline", "baseline:bundle:summary"],
  ["cleanup", "workspace cleanup dry-run", "cleanup:workspace:dry-run:summary"],
];

const OUTPUTS = {
  "proof:deps:summary": { status: "pass", scope: "production", total: 25, high: 0, critical: 0, blockingHighCritical: 0 },
  "proof:deps:all:summary": { status: "pass", scope: "all", total: 37, high: 9, critical: 0, blockingHighCritical: 0, knownDevToolchainHigh: 9 },
  "proof:wallet-deps:summary": { status: "pass", privy: "3.27.2", privyWagmi: "1.0.0", wagmi: "2.16.9", viem: "2.36.0", missing: [] },
  "proof:ci-security:summary": { status: "pass", permissionsReadOnly: true, pullRequestTarget: false, usesPinned: true, checkoutPersistCredentialsFalse: true, issues: 0 },
  "baseline:bundle:summary": { status: "pass", fileCount: 226, totalBytes: 7_500_007, jsBytes: 7_162_708, largestJsBytes: 1_043_297, largestJsFile: { path: "static/chunks/app.js" }, budget: { maxSingleJsBytes: 1_250_000 }, cssBytes: 216_635, wasmBytes: 1_056_860, largestFiles: [{ bytes: 1_056_860 }], budgetIssues: [] },
  "cleanup:workspace:dry-run:summary": { status: "ok", mode: "dry-run", matchedTargets: 2, wouldDeleteTargets: 2, skippedTargets: 0, bytes: 1234 },
};

export function runAutonomousDailyStatusTests() {
  assert.deepEqual(
    AUTONOMOUS_DAILY_CHECKS.map(({ id, label, script }) => [id, label, script]),
    EXPECTED_MANIFEST,
  );
  assert.deepEqual(autonomousDailyManifestIssues(AUTONOMOUS_DAILY_CHECKS), []);
  for (const raw of ["", "01", "1.0", "1e3", "999", "900001", "9007199254740992"]) {
    if (raw === "") {
      assert.equal(parseAutonomousDailyPositiveInteger("TIMEOUT", raw, 120_000, 1_000, 900_000), 120_000);
    } else {
      assert.throws(() => parseAutonomousDailyPositiveInteger("TIMEOUT", raw, 120_000, 1_000, 900_000));
    }
  }
  assert.equal(parseAutonomousDailyPositiveInteger("TIMEOUT", "1000", 120_000, 1_000, 900_000), 1000);
  assert.equal(parseAutonomousDailyPositiveInteger("TIMEOUT", "900000", 120_000, 1_000, 900_000), 900000);

  let calls = 0;
  const result = runAutonomousDailyStatus({
    now: () => new Date("2026-08-13T10:00:00.000Z"),
    sourceEnv: {},
    executeScript: (script) => {
      calls += 1;
      return { status: 0, stdout: `banner {not json}\n${JSON.stringify(OUTPUTS[script])}\n`, stderr: "" };
    },
  });
  assert.equal(calls, 6);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.failures, []);
  assert.match(result.output, /Mode: read-only, no transactions, no deploys, no cleanup apply/);
  assert.match(result.output, /largestJsFile=static\/chunks\/app\.js/);
  assert.match(result.output, /maxSingleJsBytes=1250000/);
  assert.match(result.output, /Summary: daily autonomous dependency, wallet, CI security, bundle, and cleanup checks completed\./);
  assert.doesNotMatch(result.output, /transactionSent|walletClientCreated|summary\.targets|\\Users\\|https?:\/\//i);

  const parsed = extractLastAutonomousDailyJsonObject('noise {"first":1}\n{"second":{"nested":true}}');
  assert.deepEqual(parsed, { second: { nested: true } });
  assert.match(
    summarizeAutonomousDailyCheck(
      { id: "bundle" },
      { status: "pass", fileCount: 1.5, totalBytes: -1, largestJsFile: { path: "../secret" }, budgetIssues: [] },
      "",
    ),
    /files=0, totalBytes=0[\s\S]*largestJsFile=unknown/,
  );
  assert.doesNotMatch(
    summarizeAutonomousDailyCheck({ id: "wallet-deps" }, { status: "fail", missing: ["valid-package", "https://secret.invalid/key", "x".repeat(100)] }, ""),
    /https?:\/\/|secret|x{20}/,
  );

  const failed = runAutonomousDailyStatus({
    sourceEnv: {},
    executeScript: (script) => script === "proof:ci-security:summary"
      ? { status: 1, stdout: "", stderr: "credential=https://user:pass@example.invalid/key" }
      : { status: 0, stdout: JSON.stringify(OUTPUTS[script]), stderr: "" },
  });
  assert.equal(failed.exitCode, 1);
  assert.deepEqual(failed.failures, ["proof:ci-security:summary"]);
  assert.doesNotMatch(failed.output, /user:pass|example\.invalid|\/key/);

  for (const mutant of [
    [...AUTONOMOUS_DAILY_CHECKS, { id: "write", label: "write", script: "cleanup:workspace:apply" }],
    AUTONOMOUS_DAILY_CHECKS.map((check, index) => index === 0 ? { ...check, script: "deploy:mainnet" } : check),
    [...AUTONOMOUS_DAILY_CHECKS].reverse(),
  ]) {
    assert.ok(autonomousDailyManifestIssues(mutant).length > 0);
    let mutantCalls = 0;
    assert.throws(() => runAutonomousDailyStatus({ checks: mutant, sourceEnv: {}, executeScript: () => { mutantCalls += 1; } }), /invalid autonomous daily manifest/);
    assert.equal(mutantCalls, 0);
  }

  const importProbe = spawnSync(process.execPath, ["--input-type=module", "--eval", "await import('./scripts/report-autonomous-daily-status.mjs')"], {
    cwd: process.cwd(),
    env: { ...process.env, AUTONOMOUS_DAILY_STATUS_TIMEOUT_MS: "01" },
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(importProbe.status, 0, importProbe.stderr);
  assert.equal(importProbe.stdout, "");
  assert.equal(importProbe.stderr, "");

  const directProbe = spawnSync(process.execPath, ["scripts/report-autonomous-daily-status.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, AUTONOMOUS_DAILY_STATUS_TIMEOUT_MS: "01" },
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(directProbe.status, 1);
  assert.equal(directProbe.stdout, "");
  assert.equal(directProbe.stderr.trim(), "AUTONOMOUS_DAILY_STATUS_TIMEOUT_MS must be a canonical decimal integer");
}
