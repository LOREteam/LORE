import assert from "node:assert/strict";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function runAdminSessionSecurityTests() {
  const result = spawnSync(
    process.execPath,
    [join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), "scripts/test-admin-session-security.mjs"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, ADMIN_SESSION_TEST_MODE: "" },
      maxBuffer: 1024 * 1024,
      timeout: 60_000,
      windowsHide: true,
    },
  );
  const failure = String(result.stderr ?? "").slice(-4_000);
  assert.equal(result.error, undefined, `admin session security tests failed to launch: ${failure}`);
  assert.equal(result.signal, null, `admin session security tests were interrupted: ${result.signal ?? failure}`);
  assert.equal(result.status, 0, `admin session security tests failed: ${failure}`);
  assert.match(String(result.stdout ?? ""), /admin-session-security: ok/);
}

function runGlobalStatsMaterializationTests() {
  const materializationEnv = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name.toUpperCase() !== "KEEPER_CONTRACT_ADDRESS"),
  );
  const result = spawnSync(
    process.execPath,
    [join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), "scripts/test-global-stats-materialization.ts"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      // The fixture supplies NEXT_PUBLIC_CONTRACT_ADDRESS itself; omit the
      // higher-precedence operator setting while retaining the isolated parent environment.
      env: materializationEnv,
      maxBuffer: 4 * 1024 * 1024,
      timeout: 120_000,
      windowsHide: true,
    },
  );
  const output = String(result.stdout ?? "");
  const failure = `${String(result.stderr ?? "").slice(-4_000)}\n${output.slice(-4_000)}`;
  assert.equal(result.error, undefined, `global stats materialization tests failed to launch: ${failure}`);
  assert.equal(result.signal, null, `global stats materialization tests were interrupted: ${result.signal ?? failure}`);
  assert.equal(result.status, 0, `global stats materialization tests failed: ${failure}`);
  assert.match(
    output,
    /^\{"status":"pass","temporaryDatabase":"(?:[^"\\\\]|\\\\.)+","backfill":true,"mutationParity":true,"staleReplay":true,"rollbackRebuild":true,"scopeIsolation":true,"dirtySourceRecovery":true,"dirtyMetaRecovery":true,"strictDecimalSyntax":true,"scaleRows":10000,"failClosed":true\}\r?\n?$/,
    "global stats materialization tests must emit the exact isolated pass marker",
  );
}

function runLeaderboardMaterializationTests() {
  const materializationEnv = Object.fromEntries(
    Object.entries(process.env).filter(([name]) =>
      !new Set(["KEEPER_CONTRACT_ADDRESS", "NEXT_PUBLIC_CONTRACT_ADDRESS"]).has(name.toUpperCase()),
    ),
  );
  const result = spawnSync(
    process.execPath,
    [join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), "scripts/test-leaderboard-materialization.ts"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: materializationEnv,
      maxBuffer: 4 * 1024 * 1024,
      timeout: 120_000,
      windowsHide: true,
    },
  );
  const output = String(result.stdout ?? "");
  const failure = `${String(result.stderr ?? "").slice(-4_000)}\n${output.slice(-4_000)}`;
  assert.equal(result.error, undefined, `leaderboard materialization tests failed to launch: ${failure}`);
  assert.equal(result.signal, null, `leaderboard materialization tests were interrupted: ${result.signal ?? failure}`);
  assert.equal(result.status, 0, `leaderboard materialization tests failed: ${failure}`);
  const markerLine = output.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "";
  let marker;
  try {
    marker = JSON.parse(markerLine);
  } catch {
    assert.fail(`leaderboard materialization tests emitted invalid evidence: ${failure}`);
  }
  assert.equal(marker.status, "pass");
  assert.equal(marker.rows, 110_003);
  assert.ok(Number.isFinite(marker.materializedP95Ms) && marker.materializedP95Ms <= 5);
  assert.ok(Number.isFinite(marker.rawMedianMs) && marker.rawMedianMs >= marker.materializedP95Ms * 20);
}

export function runBusinessCoordinatorIsolatedFixtures() {
  runAdminSessionSecurityTests();
  runGlobalStatsMaterializationTests();
  runLeaderboardMaterializationTests();
}
