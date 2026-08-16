import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = process.cwd();
const backupSource = readFileSync(join(projectRoot, "scripts", "backup-sqlite.mjs"), "utf8");
const redactorSource = readFileSync(join(projectRoot, "scripts", "redact-proof-output.mjs"), "utf8");

function backupEnv(overrides = {}) {
  const env = { ...process.env, ...overrides };
  for (const name of [
    "LINEA_NETWORK",
    "LORE_BACKUP_DIR",
    "LORE_BACKUP_REQUIRE_EXTERNAL",
    "LORE_BACKUP_RETENTION_DAYS",
    "LORE_DB_PATH",
    "NEXT_PUBLIC_LINEA_NETWORK",
    "NODE_ENV",
    "PROOF_STRICT",
  ]) {
    if (!(name in overrides)) delete env[name];
  }
  return env;
}

function runBackup(root, args = [], env = backupEnv()) {
  return spawnSync(process.execPath, ["scripts/backup-sqlite.mjs", "--summary-only", ...args], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
}

function assertCompactFailure(result, root, expected) {
  const combined = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 1, combined);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    status: "fail",
    groups: "backup=1",
    issue: expected,
  });
  assert.doesNotMatch(combined, /(?:node:internal|at Module\.|at file:|Node\.js v)/i);
  assert.ok(!combined.toLowerCase().includes(root.toLowerCase()), "backup compact failure must not expose the fixture path");
}

export function runBackupSummaryBehaviorTests() {
  const root = mkdtempSync(join(tmpdir(), "lore-backup-summary-"));
  try {
    mkdirSync(join(root, "scripts"));
    writeFileSync(join(root, "scripts", "backup-sqlite.mjs"), backupSource, "utf8");
    writeFileSync(join(root, "scripts", "redact-proof-output.mjs"), redactorSource, "utf8");

    assertCompactFailure(
      runBackup(root),
      root,
      "LORE_DB_PATH and LORE_BACKUP_DIR are required, or pass --source with exactly one of --out/--out-dir",
    );

    assertCompactFailure(
      runBackup(root, [], backupEnv({ LORE_BACKUP_RETENTION_DAYS: "14.0" })),
      root,
      "LORE_BACKUP_RETENTION_DAYS must be an integer between 1 and 3650",
    );

    const sourcePath = join(root, "source.sqlite");
    const outputPath = join(root, "backup.sqlite");
    writeFileSync(sourcePath, "not loaded because the helper is deliberately absent", "utf8");
    const missingRuntimeHelper = runBackup(root, [`--source=${sourcePath}`, `--out=${outputPath}`]);
    assert.equal(missingRuntimeHelper.status, 1);
    assert.equal(missingRuntimeHelper.stderr, "");
    const runtimeFailure = JSON.parse(missingRuntimeHelper.stdout.trim());
    assert.equal(runtimeFailure.status, "fail");
    assert.equal(runtimeFailure.groups, "backup=1");
    assert.match(runtimeFailure.issue, /Cannot find module|module.*not found/i);
    assert.ok(!`${missingRuntimeHelper.stdout}\n${missingRuntimeHelper.stderr}`.toLowerCase().includes(root.toLowerCase()));
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
  }
}
