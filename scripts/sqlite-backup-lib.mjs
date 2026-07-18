import { existsSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

const BACKUP_FILE_PATTERN = /^lore-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.sqlite$/;

export async function createSqliteBackup(sourceInput, outputInput) {
  const sourcePath = resolve(sourceInput);
  const outputPath = resolve(outputInput);
  if (sourcePath === outputPath) throw new Error("Backup output must differ from source DB");
  if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
    throw new Error("Backup source must be an existing regular file");
  }
  if (existsSync(outputPath)) throw new Error("Backup output already exists");

  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    const sourceIntegrity = String(source.prepare("PRAGMA integrity_check").get()?.integrity_check ?? "");
    if (sourceIntegrity !== "ok") throw new Error(`Source integrity check failed: ${sourceIntegrity || "unknown"}`);
    await backup(source, outputPath);
  } catch (error) {
    rmSync(outputPath, { force: true });
    throw error;
  } finally {
    source.close();
  }

  const copied = new DatabaseSync(outputPath, { readOnly: true });
  try {
    const integrity = String(copied.prepare("PRAGMA integrity_check").get()?.integrity_check ?? "");
    if (integrity !== "ok") throw new Error(`Backup integrity check failed: ${integrity || "unknown"}`);
  } finally {
    copied.close();
  }

  return { sourcePath, outputPath, bytes: statSync(outputPath).size, integrity: "ok" };
}

export function pruneSqliteBackups(directoryInput, retentionDays, excludePaths = [], now = Date.now()) {
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw new Error("Backup retention days must be an integer between 1 and 3650");
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
    if (statSync(candidate).mtimeMs >= cutoff) continue;
    unlinkSync(candidate);
    removed += 1;
  }
  return removed;
}
