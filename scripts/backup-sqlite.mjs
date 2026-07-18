import { mkdirSync } from "node:fs";
import path from "node:path";
import { createSqliteBackup, pruneSqliteBackups } from "./sqlite-backup-lib.mjs";

function argValue(name) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length).trim() || "";
}

const source = argValue("source") || process.env.LORE_DB_PATH?.trim() || "";
const explicitOutput = argValue("out");
const outputDir = argValue("out-dir") || (!explicitOutput ? process.env.LORE_BACKUP_DIR?.trim() || "" : "");
const retentionText = process.env.LORE_BACKUP_RETENTION_DAYS?.trim() || "";
const retentionDays = retentionText ? Number(retentionText) : 0;
if (retentionText && (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650)) {
  throw new Error("LORE_BACKUP_RETENTION_DAYS must be an integer between 1 and 3650");
}
if (!source || Boolean(explicitOutput) === Boolean(outputDir)) {
  throw new Error("Usage: npm run db:backup -- --source=<db.sqlite> (--out=<backup.sqlite> | --out-dir=<directory>), or set LORE_DB_PATH and LORE_BACKUP_DIR");
}

const output = explicitOutput || path.join(
  outputDir,
  `lore-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
);
mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
const result = await createSqliteBackup(source, output);
const pruned = retentionDays > 0
  ? pruneSqliteBackups(path.dirname(result.outputPath), retentionDays, [result.outputPath])
  : 0;
console.log(JSON.stringify({
  status: "pass",
  output: path.relative(process.cwd(), result.outputPath) || path.basename(result.outputPath),
  bytes: result.bytes,
  integrity: result.integrity,
  pruned,
}));
