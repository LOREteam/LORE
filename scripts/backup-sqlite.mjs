import { existsSync, mkdirSync, statSync } from "node:fs";
import path, { isAbsolute, relative, resolve } from "node:path";
import { redactProofText } from "./redact-proof-output.mjs";

const REPO_ROOT = process.cwd();

function argValue(name) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length).trim() || "";
}

const summaryOnly = process.argv.includes("--summary-only");
const strict = process.argv.includes("--strict") || process.env.PROOF_STRICT === "1";
const backupSummaryGroups = "backup=1";
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const source = argValue("source") || process.env.LORE_DB_PATH?.trim() || "";
const explicitOutput = argValue("out");
const outputDir = argValue("out-dir") || (!explicitOutput ? process.env.LORE_BACKUP_DIR?.trim() || "" : "");
const retentionText = process.env.LORE_BACKUP_RETENTION_DAYS?.trim() || "";
const retentionDays = retentionText ? parseRetentionDays(retentionText) : 0;
const futureTimestampSkewMs = 5 * 60 * 1000;

function parseRetentionDays(value) {
  const normalized = String(value ?? "").trim();
  if (!/^[1-9]\d{0,15}$/.test(normalized)) return null;
  const parsed = BigInt(normalized);
  return parsed <= MAX_SAFE_INTEGER_BIGINT && parsed >= 1n && parsed <= 3650n ? Number(parsed) : null;
}

function fail(message) {
  if (!summaryOnly) throw new Error(message);
  console.log(JSON.stringify({ status: "fail", groups: backupSummaryGroups, issue: compactIssue(new Error(message)) }));
  process.exit(1);
}

function compactIssue(error) {
  const message = error instanceof Error ? error.message : String(error ?? "backup failed");
  const compact = redactProofText(message)
    .replace(/(?:https?|wss?):\/\/\S+/gi, "<redacted-url>")
    .replace(/[A-Za-z]:\\[^\s"']+/g, "<path>")
    .replace(/(^|[\s"'])\/(?:[^/\s"']+\/)+[^\s"']+/g, "$1<path>")
    .replace(/\s+/g, " ")
    .trim();
  return (compact || "backup failed").slice(0, 240);
}

function failRuntime(error) {
  if (!summaryOnly) throw error;
  console.log(JSON.stringify({ status: "fail", groups: backupSummaryGroups, issue: compactIssue(error) }));
  process.exit(1);
}

if (retentionText && retentionDays === null) {
  fail("LORE_BACKUP_RETENTION_DAYS must be an integer between 1 and 3650");
}
if (!source || Boolean(explicitOutput) === Boolean(outputDir)) {
  fail("LORE_DB_PATH and LORE_BACKUP_DIR are required, or pass --source with exactly one of --out/--out-dir");
}

const output = explicitOutput || path.join(
  outputDir,
  `lore-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
);

function isPathInsideRepo(filePath) {
  const rel = relative(REPO_ROOT, resolve(filePath));
  return rel === "" || (rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function requiresExternalBackupPaths() {
  return (
    strict ||
    process.env.LORE_BACKUP_REQUIRE_EXTERNAL === "1" ||
    process.env.NODE_ENV === "production" ||
    process.env.LINEA_NETWORK === "mainnet" ||
    process.env.NEXT_PUBLIC_LINEA_NETWORK === "mainnet"
  );
}

function statSourceFile() {
  if (!existsSync(source)) return null;
  const sourceStat = statSync(source);
  return sourceStat.isFile() ? sourceStat : null;
}

function hasFutureModifiedTime(fileStat) {
  return Number.isFinite(fileStat.mtimeMs) && fileStat.mtimeMs > Date.now() + futureTimestampSkewMs;
}

if (requiresExternalBackupPaths()) {
  if (retentionDays < 1) {
    fail("Production backup retention days must be configured");
  }
  for (const [label, value] of [["source", source], ["output", output]]) {
    if (!isAbsolute(value) || isPathInsideRepo(value)) {
      fail(`Production backup ${label} path must be absolute and outside the repo checkout`);
    }
  }
}
const sourceStat = statSourceFile();
if (!sourceStat) {
  fail("Backup source must be an existing regular file");
}
if (strict && hasFutureModifiedTime(sourceStat)) {
  fail("Backup source modified time must not be in the future");
}
if (summaryOnly) {
  try {
    const { inspectSqliteSource } = await import("./sqlite-backup-lib.mjs");
    inspectSqliteSource(source);
  } catch (error) {
    failRuntime(error);
  }
  console.log(JSON.stringify({
    status: "ready",
    groups: backupSummaryGroups,
    strict,
    source: "present",
    sourceMtime: strict ? "non-future" : "unchecked",
    output: explicitOutput ? "file" : "directory",
    retentionDays,
    wouldWrite: false,
  }));
  process.exit(0);
}
mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
const { createSqliteBackup, pruneSqliteBackups } = await import("./sqlite-backup-lib.mjs");
let result;
let pruned = 0;
try {
  result = await createSqliteBackup(source, output);
  pruned = retentionDays > 0
    ? pruneSqliteBackups(path.dirname(result.outputPath), retentionDays, [result.outputPath])
    : 0;
} catch (error) {
  failRuntime(error);
}
console.log(JSON.stringify({
  status: "pass",
  groups: backupSummaryGroups,
  output: summaryOnly ? path.basename(result.outputPath) : path.relative(process.cwd(), result.outputPath) || path.basename(result.outputPath),
  bytes: result.bytes,
  integrity: result.integrity,
  pruned,
}));
