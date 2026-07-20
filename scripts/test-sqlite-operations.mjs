import assert from "node:assert/strict";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, rmSync, utimesSync, writeFileSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createSqliteBackup, pruneSqliteBackups } from "./sqlite-backup-lib.mjs";
import { auditSqliteScopes } from "./sqlite-scope-audit-lib.mjs";
import { verifySqliteStartup } from "./check-sqlite-startup.mjs";

const drillDir = resolve(process.env.DB_DRILL_DIR || ".tmp/pre-mainnet/db-drill");
const sourcePath = resolve(drillDir, "source.sqlite");
const backupPath = resolve(drillDir, "backup.sqlite");
const corruptPath = resolve(drillDir, "corrupt.sqlite");
const summaryPath = resolve(drillDir, "summary.json");
const retentionDir = resolve(drillDir, "retention");

mkdirSync(drillDir, { recursive: true });
rmSync(retentionDir, { force: true, recursive: true });
for (const path of [sourcePath, `${sourcePath}-shm`, `${sourcePath}-wal`, backupPath, corruptPath, summaryPath]) {
  rmSync(path, { force: true });
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
    corruptCopyRejected: true,
    corruptStartupRejected: true,
    diskFullRejected: true,
  },
};
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary));
