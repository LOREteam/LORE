import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, rmSync, utimesSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createSqliteBackup, pruneSqliteBackups } from "./sqlite-backup-lib.mjs";
import { auditSqliteScopes } from "./sqlite-scope-audit-lib.mjs";
import { verifySqliteStartup } from "./check-sqlite-startup.mjs";

const drillDir = resolve(process.env.DB_DRILL_DIR || ".tmp/pre-mainnet/db-drill");
const sourcePath = resolve(drillDir, "source.sqlite");
const backupPath = resolve(drillDir, "backup.sqlite");
const corruptPath = resolve(drillDir, "corrupt.sqlite");
const corruptBackupPath = resolve(drillDir, "corrupt-backup.sqlite");
const summaryPath = resolve(drillDir, "summary.json");
const retentionDir = resolve(drillDir, "retention");
const restoreBackupDir = resolve(drillDir, "restore-backups");
const restoreOutputDir = resolve(drillDir, "restore-output");
const corruptRestoreOutputDir = resolve(drillDir, "corrupt-restore-output");

mkdirSync(drillDir, { recursive: true });
rmSync(retentionDir, { force: true, recursive: true });
rmSync(restoreBackupDir, { force: true, recursive: true });
rmSync(restoreOutputDir, { force: true, recursive: true });
rmSync(corruptRestoreOutputDir, { force: true, recursive: true });
for (const path of [
  sourcePath,
  `${sourcePath}-shm`,
  `${sourcePath}-wal`,
  backupPath,
  `${backupPath}-shm`,
  `${backupPath}-wal`,
  corruptPath,
  corruptBackupPath,
  `${corruptBackupPath}-shm`,
  `${corruptBackupPath}-wal`,
  summaryPath,
]) {
  rmSync(path, { force: true });
}
for (const entry of readdirSync(drillDir, { withFileTypes: true })) {
  if (entry.isFile() && (entry.name.startsWith("backup.sqlite.partial-") || entry.name.startsWith("corrupt-backup.sqlite.partial-"))) {
    rmSync(resolve(drillDir, entry.name), { force: true });
  }
}

const source = new DatabaseSync(sourcePath);
source.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE IF NOT EXISTS drill_rows (id INTEGER PRIMARY KEY, payload BLOB NOT NULL);
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS scoped_epochs (scope TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS scoped_bets (scope TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS scoped_jackpots (scope TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS scoped_reward_claims (scope TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS scoped_protocol_fee_flushes (scope TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS scoped_indexer_events (scope TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS epochs (id INTEGER PRIMARY KEY);
  DELETE FROM drill_rows;
  DELETE FROM meta;
  DELETE FROM scoped_epochs;
  DELETE FROM scoped_bets;
  DELETE FROM epochs;
  INSERT INTO drill_rows(payload) VALUES (zeroblob(262144)), (zeroblob(262144));
  INSERT INTO meta(key, value) VALUES ('__storage_active_contract_scope', 'sepolia:0x0000000000000000000000000000000000000002');
  INSERT INTO meta(key, value) VALUES ('sepolia:0x0000000000000000000000000000000000000002:lastIndexedBlock', '1');
  INSERT INTO scoped_epochs(scope) VALUES ('sepolia:0x0000000000000000000000000000000000000001');
  INSERT INTO scoped_bets(scope) VALUES ('sepolia:0x0000000000000000000000000000000000000002');
  INSERT INTO scoped_indexer_events(scope) VALUES ('sepolia:0x0000000000000000000000000000000000000001');
  INSERT INTO epochs DEFAULT VALUES;
`);

const walBefore = Number(source.prepare("PRAGMA wal_checkpoint(PASSIVE)").get()?.log ?? 0);
const checkpoint = source.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
assert.equal(Number(checkpoint?.busy ?? 1), 0, "WAL checkpoint must not remain busy");

await createSqliteBackup(sourcePath, backupPath);
assert.equal(
  readdirSync(drillDir).some((entry) => entry.startsWith(`${backupPath.split(/[\\/]/).pop()}.partial-`)),
  false,
  "backup must publish only the validated final artifact and leave no partial output",
);
await assert.rejects(
  () => createSqliteBackup(sourcePath, sourcePath),
  /Backup output must differ from source DB/,
  "backup must reject source/output path collisions before opening SQLite",
);
await assert.rejects(
  () => createSqliteBackup(sourcePath, backupPath),
  /Backup output already exists/,
  "backup must never overwrite an existing artifact",
);
const sourceRows = Number(source.prepare("SELECT COUNT(*) AS count FROM drill_rows").get()?.count ?? -1);
const scopeAudit = auditSqliteScopes(sourcePath, "sepolia:0x0000000000000000000000000000000000000001");
assert.equal(scopeAudit.readOnly, true);
assert.equal(scopeAudit.foreignScopeCount, 1);
assert.equal(scopeAudit.foreignRows, 1);
assert.equal(scopeAudit.staleMetaKeys, 1);
assert.equal(scopeAudit.legacyRows, 1);
assert.equal(scopeAudit.cleanupRecommended, true);

const backup = new DatabaseSync(backupPath, { readOnly: true });
const backupIntegrity = String(backup.prepare("PRAGMA integrity_check").get()?.integrity_check ?? "");
const backupRows = Number(backup.prepare("SELECT COUNT(*) AS count FROM drill_rows").get()?.count ?? -1);
assert.equal(backupIntegrity, "ok");
assert.equal(backupRows, sourceRows);
assert.throws(() => backup.exec("INSERT INTO drill_rows(payload) VALUES (zeroblob(1))"));
backup.close();

const guardedBackupPath = resolve(drillDir, "guarded-production-backup.sqlite");
rmSync(guardedBackupPath, { force: true });
const guardedBackup = spawnSync(
  process.execPath,
  ["scripts/backup-sqlite.mjs", `--source=${sourcePath}`, `--out=${guardedBackupPath}`, "--summary-only"],
  {
    cwd: process.cwd(),
    env: { ...process.env, LORE_BACKUP_REQUIRE_EXTERNAL: "1", LORE_BACKUP_RETENTION_DAYS: "14" },
    encoding: "utf8",
  },
);
assert.notEqual(guardedBackup.status, 0, "production backup guard must reject repo-local backup paths");
assert.match(
  `${guardedBackup.stderr}\n${guardedBackup.stdout}`,
  /Production backup source path must be absolute and outside the repo checkout/,
);
assert.equal(existsSync(guardedBackupPath), false, "rejected production backup must not leave an output file");

const futureBackupRoot = mkdtempSync(join(tmpdir(), "lore-future-backup-"));
const futureBackupSource = resolve(futureBackupRoot, "future-source.sqlite");
const futureBackupOutput = resolve(futureBackupRoot, "future-backup.sqlite");
try {
  writeFileSync(futureBackupSource, "synthetic future source timestamp", "utf8");
  const futureMtime = new Date(Date.now() + 60 * 60 * 1000);
  utimesSync(futureBackupSource, futureMtime, futureMtime);
  const futureSourceBackup = spawnSync(
    process.execPath,
    ["scripts/backup-sqlite.mjs", "--strict", `--source=${futureBackupSource}`, `--out=${futureBackupOutput}`, "--summary-only"],
    {
      cwd: process.cwd(),
      env: { ...process.env, LORE_BACKUP_RETENTION_DAYS: "14" },
      encoding: "utf8",
    },
  );
  assert.notEqual(futureSourceBackup.status, 0, "strict backup summary must reject future-dated source DB timestamps");
  assert.match(
    futureSourceBackup.stdout.trim(),
    /^\{"status":"fail","groups":"backup=1","issue":"Backup source modified time must not be in the future"\}$/,
  );
  assert.equal(existsSync(futureBackupOutput), false, "future-dated strict backup summary failure must not leave output");
} finally {
  rmSync(futureBackupRoot, { force: true, recursive: true });
}

const missingBackupPath = resolve(drillDir, "missing-source-backup.sqlite");
rmSync(missingBackupPath, { force: true });
const missingSourceBackup = spawnSync(
  process.execPath,
  ["scripts/backup-sqlite.mjs", `--source=${resolve(drillDir, "missing-source.sqlite")}`, `--out=${missingBackupPath}`, "--summary-only"],
  {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  },
);
assert.notEqual(missingSourceBackup.status, 0, "backup summary must fail when the source DB is missing");
assert.match(missingSourceBackup.stdout.trim(), /^\{"status":"fail","groups":"backup=1","issue":"Backup source must be an existing regular file"\}$/);
assert.doesNotMatch(`${missingSourceBackup.stderr}\n${missingSourceBackup.stdout}`, /sqlite-backup-lib|at createSqliteBackup|Node\.js v/i);
assert.equal(existsSync(missingBackupPath), false, "missing-source summary failure must not leave an output file");

const malformedRetentionBackupPath = resolve(drillDir, "malformed-retention-backup.sqlite");
rmSync(malformedRetentionBackupPath, { force: true });
const malformedRetentionBackup = spawnSync(
  process.execPath,
  ["scripts/backup-sqlite.mjs", `--source=${sourcePath}`, `--out=${malformedRetentionBackupPath}`, "--summary-only"],
  {
    cwd: process.cwd(),
    env: { ...process.env, LORE_BACKUP_RETENTION_DAYS: "14.0" },
    encoding: "utf8",
  },
);
assert.notEqual(malformedRetentionBackup.status, 0, "backup summary must reject non-canonical retention days");
assert.match(malformedRetentionBackup.stdout.trim(), /^\{"status":"fail","groups":"backup=1","issue":"LORE_BACKUP_RETENTION_DAYS must be an integer between 1 and 3650"\}$/);
assert.equal(existsSync(malformedRetentionBackupPath), false, "malformed-retention summary failure must not leave an output file");

const unsafeRetentionBackupPath = resolve(drillDir, "unsafe-retention-backup.sqlite");
rmSync(unsafeRetentionBackupPath, { force: true });
const unsafeRetentionBackup = spawnSync(
  process.execPath,
  ["scripts/backup-sqlite.mjs", `--source=${sourcePath}`, `--out=${unsafeRetentionBackupPath}`, "--summary-only"],
  {
    cwd: process.cwd(),
    env: { ...process.env, LORE_BACKUP_RETENTION_DAYS: "9999999999999999" },
    encoding: "utf8",
  },
);
assert.notEqual(unsafeRetentionBackup.status, 0, "backup summary must reject unsafe retention days");
assert.match(unsafeRetentionBackup.stdout.trim(), /^\{"status":"fail","groups":"backup=1","issue":"LORE_BACKUP_RETENTION_DAYS must be an integer between 1 and 3650"\}$/);
assert.equal(existsSync(unsafeRetentionBackupPath), false, "unsafe-retention summary failure must not leave an output file");

mkdirSync(retentionDir, { recursive: true });
const oldBackup = resolve(retentionDir, "lore-backup-2026-01-01T00-00-00-000Z.sqlite");
const recentBackup = resolve(retentionDir, "lore-backup-2026-07-17T00-00-00-000Z.sqlite");
const unrelatedFile = resolve(retentionDir, "operator-note.txt");
for (const file of [oldBackup, recentBackup, unrelatedFile]) writeFileSync(file, "test", "utf8");
const now = Date.UTC(2026, 6, 17, 12);
utimesSync(oldBackup, new Date(now - 30 * 86_400_000), new Date(now - 30 * 86_400_000));
utimesSync(recentBackup, new Date(now - 1 * 86_400_000), new Date(now - 1 * 86_400_000));
utimesSync(unrelatedFile, new Date(now - 30 * 86_400_000), new Date(now - 30 * 86_400_000));
assert.equal(pruneSqliteBackups(retentionDir, 14, [recentBackup], now), 1);
assert.equal(existsSync(oldBackup), false, "expired generated backup must be pruned");
assert.equal(existsSync(recentBackup), true, "fresh or excluded backup must remain");
assert.equal(existsSync(unrelatedFile), true, "retention must not remove unrelated files");
assert.throws(
  () => pruneSqliteBackups(retentionDir, 14, [], Number.NaN),
  /Backup retention clock must be a safe non-negative integer/,
  "retention pruning must reject malformed clocks before deleting files",
);

copyFileSync(backupPath, corruptPath);
const corruptHandle = openSync(corruptPath, "r+");
writeSync(corruptHandle, Buffer.from("not-a-sqlite-db!"), 0, 16, 0);
closeSync(corruptHandle);
assert.throws(() => {
  const corrupt = new DatabaseSync(corruptPath, { readOnly: true });
  try {
    corrupt.prepare("PRAGMA integrity_check").all();
  } finally {
    corrupt.close();
  }
});
assert.equal(verifySqliteStartup(sourcePath).state, "existing");
assert.throws(() => verifySqliteStartup(corruptPath), /SQLite startup validation failed/);
await assert.rejects(
  () => createSqliteBackup(corruptPath, corruptBackupPath),
  /file is not a database|database disk image is malformed|integrity|SQLite/i,
  "backup must reject corrupt source before publishing final artifact",
);
assert.equal(existsSync(corruptBackupPath), false, "failed corrupt-source backup must not publish final artifact");
assert.equal(
  readdirSync(drillDir).some((entry) => entry.startsWith(`${corruptBackupPath.split(/[\\/]/).pop()}.partial-`)),
  false,
  "failed corrupt-source backup must clean partial artifacts",
);

mkdirSync(restoreBackupDir, { recursive: true });
const suppliedRestoreBackupPath = resolve(restoreBackupDir, "supplied-restore-backup.sqlite");
copyFileSync(backupPath, suppliedRestoreBackupPath);
const suppliedRestoreBackup = new DatabaseSync(suppliedRestoreBackupPath);
suppliedRestoreBackup.exec("INSERT INTO drill_rows(payload) VALUES ('from-supplied-backup')");
suppliedRestoreBackup.close();
const restoreRun = spawnSync(
  process.execPath,
  [
    "scripts/verify-db-restore.mjs",
    `--source=${sourcePath}`,
    `--backup-dir=${restoreBackupDir}`,
    `--restore-dir=${restoreOutputDir}`,
    `--backup=${suppliedRestoreBackupPath}`,
    `--manifest=${resolve(drillDir, "missing-restore-proof.json")}`,
  ],
  {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  },
);
assert.equal(restoreRun.status, 0, `restore drill from supplied backup must pass: ${restoreRun.stderr}\n${restoreRun.stdout}`);
assert.match(restoreRun.stdout, /backup\/restore drill completed without detected issues/);
const restoredFiles = readdirSync(restoreOutputDir).filter((entry) =>
  entry.startsWith("supplied-restore-backup-restored-") && entry.endsWith(".sqlite")
);
assert.equal(restoredFiles.length, 1, "restore drill must write exactly one restored DB from the supplied backup artifact");
const restoredFromBackup = new DatabaseSync(resolve(restoreOutputDir, restoredFiles[0]), { readOnly: true });
try {
  assert.equal(
    Number(restoredFromBackup.prepare("SELECT COUNT(*) AS count FROM drill_rows").get()?.count ?? -1),
    sourceRows + 1,
    "restore drill must restore the supplied backup artifact, not a fresh source copy",
  );
} finally {
  restoredFromBackup.close();
}

const corruptRestoreBackupPath = resolve(restoreBackupDir, "corrupt-restore-backup.sqlite");
copyFileSync(backupPath, corruptRestoreBackupPath);
const corruptRestoreHandle = openSync(corruptRestoreBackupPath, "r+");
writeSync(corruptRestoreHandle, Buffer.from("not-a-sqlite-db!"), 0, 16, 0);
closeSync(corruptRestoreHandle);
const corruptRestoreRun = spawnSync(
  process.execPath,
  [
    "scripts/verify-db-restore.mjs",
    `--source=${sourcePath}`,
    `--backup-dir=${restoreBackupDir}`,
    `--restore-dir=${corruptRestoreOutputDir}`,
    `--backup=${corruptRestoreBackupPath}`,
    `--manifest=${resolve(drillDir, "missing-restore-proof.json")}`,
  ],
  {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  },
);
assert.match(
  `${corruptRestoreRun.stderr}\n${corruptRestoreRun.stdout}`,
  /backup artifact could not be opened or checked|backup artifact integrity_check/i,
  "restore drill must reject a corrupt supplied backup artifact before restore copy",
);
assert.equal(
  existsSync(corruptRestoreOutputDir) && readdirSync(corruptRestoreOutputDir).some((entry) => entry.endsWith(".sqlite")),
  false,
  "corrupt supplied backup must not leave a restored DB artifact",
);

const pageCount = Number(source.prepare("PRAGMA page_count").get()?.page_count ?? 0);
source.exec(`PRAGMA max_page_count = ${pageCount + 1}`);
assert.throws(
  () => source.exec("INSERT INTO drill_rows(payload) VALUES (zeroblob(1048576))"),
  /database or disk is full|SQLITE_FULL/i,
);
source.close();

const summary = {
  status: "pass",
  wal: { framesBeforeCheckpoint: walBefore, checkpointBusy: Number(checkpoint?.busy ?? -1) },
  backup: { integrity: backupIntegrity, rows: backupRows },
  retention: { expiredRemoved: 1, recentPreserved: true, unrelatedPreserved: true },
  scopeAudit: {
    foreignScopes: scopeAudit.foreignScopeCount,
    foreignRows: scopeAudit.foreignRows,
    staleMetaKeys: scopeAudit.staleMetaKeys,
    legacyRows: scopeAudit.legacyRows,
    readOnly: scopeAudit.readOnly,
  },
  faults: {
    readOnlyWriteRejected: true,
    repoLocalProductionBackupRejected: true,
    futureSourceBackupSummaryRejected: true,
    missingSourceBackupSummaryRejected: true,
    malformedRetentionBackupSummaryRejected: true,
    unsafeRetentionBackupSummaryRejected: true,
    corruptSourceBackupCleanup: true,
    restoreUsesSuppliedBackupArtifact: true,
    corruptBackupRestoreRejected: true,
    corruptCopyRejected: true,
    corruptStartupRejected: true,
    diskFullRejected: true,
  },
};
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary));
