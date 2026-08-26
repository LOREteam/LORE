import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  INDEXER_STORAGE_REQUIRED_PROOF_FIELDS,
  summarizeIndexerStorageResult,
} from "./run-indexer-storage-summary.mjs";
import * as dbPathSafetyModule from "../server/dbPathSafety.ts";

const PROTECTED_DATABASE_PATHS = [
  "data/lore-v10.sqlite",
  "data/lore-v10.sqlite-wal",
  "data/lore-v10.sqlite-shm",
];

function protectedDatabaseSnapshot() {
  return PROTECTED_DATABASE_PATHS.map((relativePath) => {
    const filePath = resolve(relativePath);
    if (!existsSync(filePath)) return [relativePath, null];
    const stats = statSync(filePath);
    return [relativePath, {
      bytes: stats.size,
      mtimeMs: stats.mtimeMs,
      sha256: createHash("sha256").update(readFileSync(filePath)).digest("hex"),
    }];
  });
}

function ownedIndexerTempEntries() {
  return readdirSync(tmpdir()).filter((name) => name.startsWith("lore-indexer-events-")).sort();
}

export function runIndexerStorageBehaviorTests() {
  const dbPathSafety = dbPathSafetyModule.default ?? dbPathSafetyModule;
  const safetyRoot = mkdtempSync(join(tmpdir(), "lore-db-path-safety-"));
  const ownedParent = join(safetyRoot, "owned");
  const databasePath = join(ownedParent, "lore.sqlite");
  mkdirSync(ownedParent);
  try {
    assert.equal(dbPathSafety.assertProductionDatabasePathSafe(databasePath), resolve(databasePath));
    writeFileSync(databasePath, "fixture");
    assert.equal(dbPathSafety.assertProductionDatabasePathSafe(databasePath), resolve(databasePath));
    const missingParentPath = join(safetyRoot, "missing", "lore.sqlite");
    assert.throws(
      () => dbPathSafety.assertProductionDatabasePathSafe(missingParentPath),
      /must be provisioned before startup/,
    );
    const externalParent = join(safetyRoot, "external");
    const linkedParent = join(safetyRoot, "linked");
    mkdirSync(externalParent);
    symlinkSync(externalParent, linkedParent, process.platform === "win32" ? "junction" : "dir");
    try {
      assert.throws(
        () => dbPathSafety.assertProductionDatabasePathSafe(join(linkedParent, "lore.sqlite")),
        /ordinary non-reparse|symlink, junction, or reparse point/,
      );
    } finally {
      unlinkSync(linkedParent);
    }
    const directoryAtDatabasePath = join(ownedParent, "directory.sqlite");
    mkdirSync(directoryAtDatabasePath);
    assert.throws(
      () => dbPathSafety.assertProductionDatabasePathSafe(directoryAtDatabasePath),
      /ordinary non-reparse file/,
    );
  } finally {
    rmSync(safetyRoot, { recursive: true, force: true });
  }
  const databaseBefore = protectedDatabaseSnapshot();
  const tempBefore = ownedIndexerTempEntries();
  const result = spawnSync(
    process.execPath,
    [resolve("node_modules/tsx/dist/cli.mjs"), resolve("scripts/test-indexer-event-storage.ts")],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    },
  );
  assert.equal(
    result.status,
    0,
    `real indexer storage behavior failed: ${[result.error?.message, result.stdout, result.stderr].filter(Boolean).join(" | ").slice(-2_000)}`,
  );
  const payloadLine = String(result.stdout).split(/\r?\n/).find((line) => line.startsWith('{"status":'));
  assert.ok(payloadLine, "real indexer storage behavior must emit one JSON proof payload");
  const payload = JSON.parse(payloadLine);
  const summary = summarizeIndexerStorageResult(result);
  assert.equal(summary.status, "pass");
  assert.deepEqual(summary.missingProofs, []);
  assert.equal(summary.categories, 3);
  assert.deepEqual(summary.financialEventCategories, ["batch_claim", "dust_settlement", "resolver_reward"]);
  for (const [summaryField] of INDEXER_STORAGE_REQUIRED_PROOF_FIELDS) {
    assert.equal(summary[summaryField], true, `${summaryField} must be proven by the real temp-SQLite run`);
  }

  for (const [summaryField, payloadField] of INDEXER_STORAGE_REQUIRED_PROOF_FIELDS) {
    const mutantPayload = { ...payload };
    delete mutantPayload[payloadField];
    const mutant = summarizeIndexerStorageResult({
      status: 0,
      stdout: JSON.stringify(mutantPayload),
      stderr: "",
    });
    assert.equal(mutant.status, "fail", `${summaryField} omission mutant must fail the compact gate`);
    assert.deepEqual(mutant.missingProofs, [summaryField]);
  }

  assert.deepEqual(protectedDatabaseSnapshot(), databaseBefore, "real indexer storage behavior must preserve the protected DB/WAL/SHM identity");
  assert.deepEqual(ownedIndexerTempEntries(), tempBefore, "real indexer storage behavior must remove its owned temp DB directory");
}
