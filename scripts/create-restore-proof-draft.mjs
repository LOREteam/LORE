import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function refuseFinalProofOutput(outPath) {
  const normalized = path.relative(process.cwd(), outPath).replace(/\\/g, "/");
  if (normalized === "docs/restore-proof.json") {
    throw new Error("Proof draft generator writes incomplete drafts only; use --out=docs/restore-proof.draft.json, then promote to docs/restore-proof.json only after real backup schedule, restore drill, restored health, and preservation evidence passes strict validation");
  }
}

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : process.env[name.toUpperCase().replaceAll("-", "_")] || fallback;
}

function requireConcreteValue(name, value) {
  if (!String(value ?? "").trim() || /^(?:TODO|TBD|REPLACE|<)/i.test(String(value).trim())) {
    throw new Error(`--${name} is required when drafting restore launch evidence`);
  }
  return value;
}

function readRequiredLog(name, filePath) {
  requireConcreteValue(name, filePath);
  const resolved = path.resolve(process.cwd(), filePath);
  if (!existsSync(resolved)) {
    throw new Error(`--${name} must point to an existing redacted artifact`);
  }
  return readFileSync(resolved, "utf8");
}

function requireExistingArtifact(name, filePath) {
  requireConcreteValue(name, filePath);
  const resolved = path.resolve(process.cwd(), filePath);
  if (!existsSync(resolved)) {
    throw new Error(`--${name} must point to an existing redacted artifact`);
  }
  return filePath;
}

function firstMatchingLine(text, pattern) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => pattern.test(line));
}

function hasOkSummary(text, okText) {
  return new RegExp(`Summary:\\s*${okText}`, "i").test(text);
}

function parseKeyValues(line = "") {
  const values = {};
  for (const match of line.matchAll(/\b([A-Za-z][A-Za-z0-9_-]*)=([^\s]+)/g)) {
    values[match[1]] = match[2];
  }
  return values;
}

function pathLooksOutsideRepo(rawPath) {
  if (!rawPath) return false;
  const resolved = path.resolve(process.cwd(), rawPath);
  const relative = path.relative(process.cwd(), resolved);
  return path.isAbsolute(resolved) && (relative.startsWith("..") || path.isAbsolute(relative));
}

function samePath(left, right) {
  if (!left || !right) return false;
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function pathInsideOrSame(childPath, parentPath) {
  if (!childPath || !parentPath) return false;
  const child = path.resolve(childPath).toLowerCase();
  const parent = path.resolve(parentPath).replace(/[\\/]+$/, "").toLowerCase();
  return child === parent || child.startsWith(`${parent}\\`) || child.startsWith(`${parent}/`);
}

function parseHealth(log) {
  const ok = /\[prod-health\]\s+OK/i.test(log);
  const summary = firstMatchingLine(log, /\bbase=|\bruntime=|\bdataSync=/i) || "TODO: paste restored staging/canary/restore npm.cmd run health:prod summary";
  const url = summary.match(/\bbase=([^\s]+)/i)?.[1] ?? "";
  const runtime = summary.match(/\bruntime=([^\s]+)/i)?.[1] ?? "";
  const dataSync = summary.match(/\bdataSync=([^\s]+)/i)?.[1] ?? "";
  const values = parseKeyValues(summary);

  return {
    status: ok ? "pass" : "TODO",
    command: "npm.cmd run health:prod",
    hostType: argValue("restored-host-type", "TODO: staging, canary, or restore"),
    url: url || argValue("restored-origin", "TODO: restored staging/canary/restore HTTPS origin"),
    runtimeHealthPassed: ok && /^(ok|pass|healthy)$/i.test(runtime),
    dataSyncHealthPassed: ok && /^(ok|pass|healthy)$/i.test(dataSync),
    finalityLagChecked: Number.isFinite(Number(values.finalityLagBlocks)),
    summary,
    timestamp: new Date().toISOString(),
  };
}

const outPath = path.resolve(process.cwd(), argValue("out", "docs/restore-proof.draft.json"));
refuseFinalProofOutput(outPath);
const restoreLogPath = argValue("restore-log");
const healthLogPath = argValue("health-log");
const restoreLog = readRequiredLog("restore-log", restoreLogPath);
const healthLog = readRequiredLog("health-log", healthLogPath);
const now = new Date().toISOString();
const sourceDbPath = requireConcreteValue("source", argValue("source", process.env.LORE_DB_PATH || ""));
const backupDir = requireConcreteValue("backup-dir", argValue("backup-dir", process.env.LORE_BACKUP_DIR || ""));
const restoreDir = requireConcreteValue("restore-dir", argValue("restore-dir", process.env.LORE_RESTORE_DRILL_DIR || ""));
const backupScheduleArtifact = requireExistingArtifact("backup-schedule-artifact", argValue("backup-schedule-artifact", ""));
const preservationArtifact = requireExistingArtifact("preservation-artifact", argValue("preservation-artifact", ""));
const sourceDbOutsideBackupRestoreDirs = Boolean(
  sourceDbPath &&
  backupDir &&
  restoreDir &&
  !pathInsideOrSame(sourceDbPath, backupDir) &&
  !pathInsideOrSame(sourceDbPath, restoreDir),
);
const restoreSummary =
  firstMatchingLine(restoreLog, /^Summary:/i) ||
  firstMatchingLine(restoreLog, /^Copy this summary/i) ||
  "TODO: paste npm.cmd run proof:restore summary";
const restoreOk = hasOkSummary(restoreLog, "backup/restore drill completed without detected issues");

const manifest = {
  backupSchedule: {
    enabled: false,
    cadence: "TODO: recurring backup cadence, for example every 5 minutes",
    evidence: `artifact: ${backupScheduleArtifact}`,
    checkedAt: now,
  },
  restoreDrill: {
    status: restoreOk ? "pass" : "TODO",
    command: "npm.cmd run proof:restore -- --strict",
    backupPathOutsideRepo: pathLooksOutsideRepo(backupDir),
    restorePathOutsideRepo: pathLooksOutsideRepo(restoreDir),
    backupRestoreDirsDistinct: Boolean(backupDir && restoreDir && !samePath(backupDir, restoreDir)),
    sourceDbOutsideBackupRestoreDirs,
    sourceDbPath: sourceDbPath || "TODO",
    backupDir: backupDir || "TODO",
    restoreDir: restoreDir || "TODO",
    summary: restoreSummary,
    artifact: `artifact: ${restoreLogPath}`,
    timestamp: now,
  },
  restoredStagingHealth: { ...parseHealth(healthLog), evidence: `artifact: ${healthLogPath}` },
  indexerPreservation: {
    heartbeatPreserved: false,
    latestIndexedEpochPreserved: false,
    heartbeatBefore: "TODO: heartbeat value before restore",
    heartbeatAfter: "TODO: heartbeat value after restore",
    latestIndexedEpochBefore: "TODO: latest indexed epoch before restore",
    latestIndexedEpochAfter: "TODO: latest indexed epoch after restore",
    evidence: `artifact: ${preservationArtifact}`,
    checkedAt: now,
  },
};

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Restore proof draft written: ${path.relative(process.cwd(), outPath)}`);
console.log("Review TODO fields, add backup schedule and preservation evidence, then save as docs/restore-proof.json.");
