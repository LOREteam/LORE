import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  checkLocalPlanIssues,
  checkLocalProtectedDatabaseIssues,
  createCheckLocalChildEnvironment,
  createCheckLocalPlan,
  describeCheckLocalError,
  finalizeCheckLocalRun,
  isCheckLocalSummaryOnly,
  prepareCheckLocalOutput,
  snapshotCheckLocalDatabaseFiles,
  startCheckLocalServerAfterAdmission,
} from "./check-local-policy.mjs";

const EXPECTED_CORE_IDS = [
  "lint",
  "hermetic-build",
  "business-logic",
  "security-followup",
  "fetch-timeout",
  "stored-number-parsing",
  "p1-hardening",
  "performance-self-test",
  "contract-v10",
  "indexer-storage",
  "db-operations",
  "monitoring",
  "build",
  "typecheck",
];

const EXPECTED_NPM_SCRIPTS = [
  "lint",
  "test:build-hermetic",
  "test:logic",
  "proof:security-followup",
  "test:fetch-timeout",
  "test:stored-number-parsing",
  "test:p1-hardening",
  "perf:p1:self-test",
  "test:contract:v10",
  "test:indexer-storage",
  "test:db-operations",
  "test:monitoring",
  "build",
  "typecheck",
];

export async function runCheckLocalPolicyTests() {
  const importProbe = spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    "await import('./scripts/check-local.mjs')",
  ], {
    cwd: resolve("."),
    env: { ...process.env, CHECK_LOCAL_PORT: "01" },
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  assert.equal(importProbe.status, 0, importProbe.stderr);
  assert.equal(importProbe.stdout, "");
  assert.equal(importProbe.stderr, "");
  assert.equal(isCheckLocalSummaryOnly(["node", "check-local.mjs", "--summary-only"]), true);
  assert.equal(isCheckLocalSummaryOnly(["node", "check-local.mjs"]), false);
  const childEnvironment = createCheckLocalChildEnvironment({ tempDir: "C:/temp/check-local-1", distDir: ".next-check" });
  const expectedDbPath = join("C:/temp/check-local-1", "lore.sqlite");
  assert.deepEqual(childEnvironment, {
    dbPath: expectedDbPath,
    env: { LORE_DB_PATH: expectedDbPath },
    nextEnv: {
      LORE_DB_PATH: expectedDbPath,
      NEXT_DIST_DIR: ".next-check",
      ALLOW_WEAK_RATE_LIMIT_IDENTITY: "1",
    },
  });
  const npmOptions = { npmCommand: "node-for-npm", processExecPath: "node" };
  const npmPlan = createCheckLocalPlan(npmOptions);
  assert.equal(npmPlan.npmMode, true);
  assert.deepEqual(npmPlan.steps.map(({ id }) => id), EXPECTED_CORE_IDS);
  assert.deepEqual(npmPlan.steps.map(({ args }) => args), EXPECTED_NPM_SCRIPTS.map((script) => ["run", script]));
  assert.deepEqual(npmPlan.smokeSteps.map(({ id, args }) => [id, args]), [
    ["http-smoke", ["run", "smoke:http"]],
    ["browser-smoke", ["run", "smoke:browser"]],
  ]);
  assert.deepEqual(npmPlan.smokeSteps[0].env, { SMOKE_SKIP_WARMUP: "1" });
  assert.deepEqual(npmPlan.smokeSteps[1].env, {
    SMOKE_BROWSER_TIMEOUT_MS: "60000",
    SMOKE_INCLUDE_DEBUG_AUTOMINER_SCENARIOS: "1",
  });
  assert.equal(npmPlan.smokeSteps[1].retryOnce, true);
  assert.equal(npmPlan.steps.find(({ id }) => id === "build")?.kind, "build");
  assert.equal(npmPlan.steps.find(({ id }) => id === "typecheck")?.retryOnce, true);

  const directOptions = { npmCommand: null, processExecPath: "node", resolvePath: resolve };
  const directPlan = createCheckLocalPlan(directOptions);
  assert.equal(directPlan.npmMode, false);
  assert.deepEqual(directPlan.steps.map(({ id }) => id), [
    ...EXPECTED_CORE_IDS.slice(0, -1),
    "next-typegen",
    "typescript",
  ]);
  assert.equal(directPlan.steps.find(({ id }) => id === "business-logic")?.args[1], resolve("scripts", "test-business-logic.mjs"));
  assert.equal(directPlan.steps.some(({ id }) => id === "contract-v9-compatibility"), false);
  assert.equal(directPlan.steps.find(({ id }) => id === "contract-v10")?.args[0], resolve("scripts", "test-contract-v10-invariants.mjs"));
  assert.equal(directPlan.steps.find(({ id }) => id === "build")?.args[0], resolve("scripts", "run-hermetic-build.mjs"));
  assert.deepEqual(directPlan.steps.find(({ id }) => id === "typescript")?.args.slice(1), ["--noEmit", "--incremental", "false"]);
  assert.equal(directPlan.smokeSteps[0].args[0], resolve("scripts", "smoke-http.mjs"));
  assert.equal(directPlan.smokeSteps[1].args[0], resolve("scripts", "smoke-browser.mjs"));

  for (const mutant of [
    { ...npmPlan, steps: npmPlan.steps.filter(({ id }) => id !== "contract-v10") },
    { ...npmPlan, steps: [...npmPlan.steps, { id: "contract-v9-compatibility", command: "node-for-npm", args: ["run", "test:contract"] }] },
    { ...npmPlan, steps: npmPlan.steps.map((step) => step.id === "security-followup" ? { ...step, args: ["run", "deploy:mainnet"] } : step) },
    { ...npmPlan, steps: [...npmPlan.steps].reverse() },
    { ...npmPlan, smokeSteps: npmPlan.smokeSteps.map((step) => step.id === "browser-smoke" ? { ...step, env: {} } : step) },
  ]) {
    assert.deepEqual(checkLocalPlanIssues(mutant, npmOptions), ["check-local execution plan mismatch"]);
  }

  assert.deepEqual(
    prepareCheckLocalOutput({ status: 0, stdout: "success detail", stderr: "" }, { compact: true, maxLines: 2 }),
    { stdout: "", stderr: "" },
  );
  const failureOutput = prepareCheckLocalOutput({
    status: 1,
    stdout: "one\ntwo\nthree\nfour",
    stderr: "ExperimentalWarning: SQLite is an experimental feature\nhttps://user:pass@example.test/private?token=abc",
  }, { compact: true, maxLines: 2 });
  assert.equal(failureOutput.stdout, "...<truncated 2 line(s)>\nthree\nfour");
  assert.doesNotMatch(failureOutput.stderr, /ExperimentalWarning|user:pass|token=abc/);
  assert.match(failureOutput.stderr, /<redacted>/);

  const compactError = describeCheckLocalError(new Error(
    `failed https://user:pass@example.test/private?token=abc ${"x".repeat(700)}`,
  ));
  assert.ok(compactError.length <= 500);
  assert.match(compactError, /<truncated>$/);
  assert.doesNotMatch(compactError, /user:pass|token=abc/);

  const behaviorRoot = mkdtempSync(join(tmpdir(), "lore-check-local-policy-"));
  try {
    const protectedDb = join(behaviorRoot, "lore-v10.sqlite");
    const protectedWal = join(behaviorRoot, "lore-v10.sqlite-wal");
    writeFileSync(protectedDb, "canonical-db");
    const before = snapshotCheckLocalDatabaseFiles([protectedDb, protectedWal]);
    assert.equal(before[0].exists, true);
    assert.equal(before[0].regularFile, true);
    assert.equal(before[0].size, String(Buffer.byteLength("canonical-db")));
    assert.match(before[0].sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(before[1], { filePath: protectedWal, exists: false });
    assert.deepEqual(checkLocalProtectedDatabaseIssues(
      before,
      snapshotCheckLocalDatabaseFiles([protectedDb, protectedWal]),
    ), []);
    writeFileSync(protectedDb, "mutated-db");
    assert.deepEqual(checkLocalProtectedDatabaseIssues(
      before,
      snapshotCheckLocalDatabaseFiles([protectedDb, protectedWal]),
    ), ["protected database changed: lore-v10.sqlite"]);
    writeFileSync(protectedDb, "canonical-db");

    let spawnCount = 0;
    await assert.rejects(startCheckLocalServerAfterAdmission({
      baseUrl: "http://127.0.0.1:3101",
      canReach: async () => true,
      spawnServer: () => { spawnCount += 1; return {}; },
    }), /Refusing to start local server/);
    assert.equal(spawnCount, 0);
    const server = await startCheckLocalServerAfterAdmission({
      baseUrl: "http://127.0.0.1:3101",
      canReach: async () => false,
      spawnServer: () => { spawnCount += 1; return { pid: 7 }; },
    });
    assert.deepEqual(server, { pid: 7 });
    assert.equal(spawnCount, 1);

    const tempDir = join(behaviorRoot, "isolated");
    const secondary = [];
    const primary = Object.assign(new Error("primary https://user:pass@example.test/?token=abc"), { exitCode: 7 });
    const finalFailure = await finalizeCheckLocalRun({
      primaryError: primary,
      serverProcess: { pid: 7 },
      stopServer: async () => { throw new Error("stop https://user:pass@example.test/?token=abc"); },
      tempDir,
      removeTempDir: () => { throw new Error("cleanup https://user:pass@example.test/?token=abc"); },
      protectedPaths: [protectedDb, protectedWal],
      protectedSnapshot: before,
      snapshotFiles: () => before,
      reportSecondary: (message) => secondary.push(message),
    });
    assert.equal(finalFailure, primary);
    assert.equal(secondary.length, 2);
    assert.match(secondary[0], /^Failed to stop local smoke server:/);
    assert.match(secondary[1], /^Failed to clean isolated local-check directory:/);
    assert.doesNotMatch(secondary.join("\n"), /user:pass|token=abc/);

    let removedPath = null;
    const dbFailure = await finalizeCheckLocalRun({
      tempDir,
      removeTempDir: (value) => { removedPath = value; },
      protectedPaths: [protectedDb, protectedWal],
      protectedSnapshot: before,
      snapshotFiles: () => [{ ...before[0], size: "999" }, before[1]],
    });
    assert.equal(removedPath, tempDir);
    assert.match(dbFailure?.message ?? "", /protected database changed: lore-v10\.sqlite/);
    assert.equal(statSync(protectedDb).isFile(), true);
    assert.equal(readFileSync(protectedDb, "utf8"), "canonical-db");
  } finally {
    rmSync(behaviorRoot, { recursive: true, force: true });
  }
}
