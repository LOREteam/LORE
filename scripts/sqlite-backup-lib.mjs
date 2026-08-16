import { existsSync, linkSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

const BACKUP_FILE_PATTERN = /^lore-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.sqlite$/;

function removeTemporaryBackupArtifacts(filePath) {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${filePath}${suffix}`, { force: true });
  }
}

function regularFileStat(filePath) {
  try {
    const stats = statSync(filePath);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
}

export function inspectSqliteSource(sourceInput) {
  const sourcePath = resolve(sourceInput);
  if (!regularFileStat(sourcePath)) {
    throw new Error("Backup source must be an existing regular file");
  }
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    const integrity = String(source.prepare("PRAGMA integrity_check").get()?.integrity_check ?? "");
    if (integrity !== "ok") throw new Error(`Source integrity check failed: ${integrity || "unknown"}`);
    return { sourcePath, integrity };
  } finally {
    source.close();
  }
}

export async function createSqliteBackup(sourceInput, outputInput, options = {}) {
  const sourcePath = resolve(sourceInput);
  const outputPath = resolve(outputInput);
  if (options.beforePublish !== undefined && typeof options.beforePublish !== "function") {
    throw new Error("Backup beforePublish hook must be a function");
  }
  if (sourcePath === outputPath) throw new Error("Backup output must differ from source DB");
  if (!regularFileStat(sourcePath)) {
    throw new Error("Backup source must be an existing regular file");
  }
  if (existsSync(outputPath)) throw new Error("Backup output already exists");
  const temporaryOutputPath = `${outputPath}.partial-${process.pid}-${Date.now()}`;
  if (existsSync(temporaryOutputPath)) throw new Error("Backup temporary output already exists");

  try {
    const source = new DatabaseSync(sourcePath, { readOnly: true });
    try {
      const sourceIntegrity = String(source.prepare("PRAGMA integrity_check").get()?.integrity_check ?? "");
      if (sourceIntegrity !== "ok") throw new Error(`Source integrity check failed: ${sourceIntegrity || "unknown"}`);
      await backup(source, temporaryOutputPath);
    } finally {
      source.close();
    }

    const copied = new DatabaseSync(temporaryOutputPath, { readOnly: true });
    let integrity = "";
    try {
      integrity = String(copied.prepare("PRAGMA integrity_check").get()?.integrity_check ?? "");
    } finally {
      copied.close();
    }
    if (integrity !== "ok") throw new Error(`Backup integrity check failed: ${integrity || "unknown"}`);
    options.beforePublish?.({ outputPath, temporaryOutputPath });
    try {
      linkSync(temporaryOutputPath, outputPath);
    } catch (error) {
      if (error && typeof error === "object" && error.code === "EEXIST") {
        throw new Error("Backup output already exists during atomic publication");
      }
      throw error;
    }
    removeTemporaryBackupArtifacts(temporaryOutputPath);
  } catch (error) {
    removeTemporaryBackupArtifacts(temporaryOutputPath);
    throw error;
  }

  return { sourcePath, outputPath, bytes: statSync(outputPath).size, integrity: "ok" };
}

export function pruneSqliteBackups(directoryInput, retentionDays, excludePaths = [], now = Date.now()) {
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw new Error("Backup retention days must be an integer between 1 and 3650");
  }
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("Backup retention clock must be a safe non-negative integer");
  }
  const directory = resolve(directoryInput);
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new Error("Backup retention path must be an existing directory");
  }
  const excluded = new Set(excludePaths.map((value) => resolve(value)));
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !BACKUP_FILE_PATTERN.test(entry.name)) continue;
    const candidate = resolve(directory, entry.name);
    if (dirname(candidate) !== directory || excluded.has(candidate)) continue;
    if (existsSync(`${candidate}-wal`) || existsSync(`${candidate}-shm`)) continue;
    if (statSync(candidate).mtimeMs >= cutoff) continue;
    unlinkSync(candidate);
    removed += 1;
  }
  return removed;
}
