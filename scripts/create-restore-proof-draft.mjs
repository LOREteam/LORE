import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isFinalHttpsOrigin, normalizeProofOrigin } from "./collect-proof-common.mjs";

const CANONICAL_NON_NEGATIVE_INTEGER_RE = /^(?:0|[1-9]\d{0,15})$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_KEY_VALUE_MARKERS = 64;
const MAX_RESTORE_EVIDENCE_BYTES = 512 * 1024;

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

function regularFileStat(filePath) {
  try {
    const stat = statSync(filePath);
    return stat.isFile() ? stat : null;
  } catch {
    return null;
  }
}

function regularDirectoryStat(dirPath) {
  try {
    const stat = statSync(dirPath);
    return stat.isDirectory() ? stat : null;
  } catch {
    return null;
  }
}

function readRequiredLog(name, filePath) {
  requireConcreteValue(name, filePath);
  const resolved = path.resolve(process.cwd(), filePath);
  const stat = regularFileStat(resolved);
  if (!stat) {
    throw new Error(`--${name} must point to an existing redacted file artifact`);
  }
  if (stat.size > MAX_RESTORE_EVIDENCE_BYTES) {
    throw new Error(`--${name} artifact is too large to validate safely`);
  }
  return readFileSync(resolved, "utf8");
}

function requireExistingArtifact(name, filePath) {
  requireConcreteValue(name, filePath);
  const resolved = path.resolve(process.cwd(), filePath);
  if (!regularFileStat(resolved)) {
    throw new Error(`--${name} must point to an existing redacted file artifact`);
  }
  return filePath;
}

function requireDistinctArtifactInputs(entries) {
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const [leftName, leftPath] = entries[leftIndex];
      const [rightName, rightPath] = entries[rightIndex];
      if (!leftPath || !rightPath) continue;
      if (path.resolve(process.cwd(), leftPath).toLowerCase() === path.resolve(process.cwd(), rightPath).toLowerCase()) {
        throw new Error(`--${leftName} and --${rightName} must point to distinct restore evidence files`);
      }
    }
  }
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
  const pattern = /\b([A-Za-z][A-Za-z0-9_-]*)=([^\s]+)/g;
  let inspected = 0;
  let match = pattern.exec(line);
  while (match) {
    inspected += 1;
    if (inspected > MAX_KEY_VALUE_MARKERS) {
      throw new Error("restore health evidence has too many key/value markers to validate safely");
    }
    values[match[1]] = match[2];
    match = pattern.exec(line);
  }
  return values;
}

function hasCanonicalNonNegativeInteger(value) {
  return parseCanonicalNonNegativeInteger(value) !== null;
}

function parseCanonicalNonNegativeInteger(value) {
  const text = String(value ?? "").trim();
  if (!CANONICAL_NON_NEGATIVE_INTEGER_RE.test(text)) return null;
  const parsed = BigInt(text);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) return null;
  return Number(parsed);
}

function pathLooksOutsideRepo(rawPath) {
  if (!rawPath) return false;
  const resolved = path.resolve(process.cwd(), rawPath);
  const relative = path.relative(process.cwd(), resolved);
  return path.isAbsolute(rawPath) && (relative.startsWith("..") || path.isAbsolute(relative));
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function requireExistingFile(name, filePath) {
  requireConcreteValue(name, filePath);
  const resolved = path.resolve(process.cwd(), filePath);
  requireCondition(Boolean(regularFileStat(resolved)), `--${name} must point to an existing file`);
  return resolved;
}

function requireExistingDirectory(name, dirPath) {
  requireConcreteValue(name, dirPath);
  const resolved = path.resolve(process.cwd(), dirPath);
  requireCondition(Boolean(regularDirectoryStat(resolved)), `--${name} must point to an existing directory`);
  return resolved;
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

function healthBaseMatches(summary, expectedOrigin) {
  const expected = normalizeProofOrigin(expectedOrigin);
  const base = parseKeyValues(summary).base;
  return Boolean(expected && base && normalizeProofOrigin(base) === expected);
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
    finalityLagChecked: hasCanonicalNonNegativeInteger(values.finalityLagBlocks),
    summary,
    timestamp: new Date().toISOString(),
  };
}

function requireValidHealthArtifact(health, log, restoredOrigin) {
  requireCondition(/\[prod-health\]\s+OK/i.test(log), "--health-log must include [prod-health] OK");
  requireCondition(healthBaseMatches(health.summary, restoredOrigin), "--health-log must include base=<restored-origin>");
  requireCondition(health.runtimeHealthPassed === true, "--health-log must include runtime=ok/pass/healthy");
  requireCondition(health.dataSyncHealthPassed === true, "--health-log must include dataSync=ok/pass/healthy");
  requireCondition(health.finalityLagChecked === true, "--health-log must include canonical non-negative decimal finalityLagBlocks=<number>");
}

const outPath = path.resolve(process.cwd(), argValue("out", "docs/restore-proof.draft.json"));
refuseFinalProofOutput(outPath);
const restoreLogPath = argValue("restore-log");
const healthLogPath = argValue("health-log");
const backupScheduleArtifactPath = argValue("backup-schedule-artifact", "");
const preservationArtifactPath = argValue("preservation-artifact", "");
requireDistinctArtifactInputs([
  ["restore-log", restoreLogPath],
  ["health-log", healthLogPath],
  ["backup-schedule-artifact", backupScheduleArtifactPath],
  ["preservation-artifact", preservationArtifactPath],
]);
const restoreLog = readRequiredLog("restore-log", restoreLogPath);
const healthLog = readRequiredLog("health-log", healthLogPath);
const now = new Date().toISOString();
const sourceDbPath = requireConcreteValue("source", argValue("source", process.env.LORE_DB_PATH || ""));
const backupDir = requireConcreteValue("backup-dir", argValue("backup-dir", process.env.LORE_BACKUP_DIR || ""));
const restoreDir = requireConcreteValue("restore-dir", argValue("restore-dir", process.env.LORE_RESTORE_DRILL_DIR || ""));
const backupPath = requireConcreteValue("backup", argValue("backup", process.env.LORE_RESTORE_BACKUP || ""));
const restoredOrigin = requireConcreteValue("restored-origin", argValue("restored-origin", ""));
const restoredHostType = requireConcreteValue("restored-host-type", argValue("restored-host-type", ""));
const backupScheduleArtifact = requireExistingArtifact("backup-schedule-artifact", backupScheduleArtifactPath);
const preservationArtifact = requireExistingArtifact("preservation-artifact", preservationArtifactPath);
const resolvedSourceDbPath = requireExistingFile("source", sourceDbPath);
const resolvedBackupDir = requireExistingDirectory("backup-dir", backupDir);
const resolvedRestoreDir = requireExistingDirectory("restore-dir", restoreDir);
const resolvedBackupPath = requireExistingFile("backup", backupPath);
requireCondition(pathLooksOutsideRepo(sourceDbPath), "--source DB must be outside the repo checkout for launch evidence");
requireCondition(pathLooksOutsideRepo(backupDir), "--backup-dir must be outside the repo checkout for launch evidence");
requireCondition(pathLooksOutsideRepo(restoreDir), "--restore-dir must be outside the repo checkout for launch evidence");
requireCondition(pathLooksOutsideRepo(backupPath), "--backup file must be outside the repo checkout for launch evidence");
requireCondition(!pathInsideOrSame(resolvedSourceDbPath, resolvedBackupDir), "--source DB must not be inside --backup-dir");
requireCondition(!pathInsideOrSame(resolvedSourceDbPath, resolvedRestoreDir), "--source DB must not be inside --restore-dir");
requireCondition(!samePath(resolvedBackupDir, resolvedRestoreDir), "--backup-dir and --restore-dir must be different");
requireCondition(pathInsideOrSame(resolvedBackupPath, resolvedBackupDir), "--backup file must be inside --backup-dir");
requireCondition(isFinalHttpsOrigin(restoredOrigin), "--restored-origin must be a public HTTPS origin without path, query, or hash");
requireCondition(["staging", "canary", "restore"].includes(restoredHostType), "--restored-host-type must be staging, canary, or restore");
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
const restoredHealth = parseHealth(healthLog);
requireCondition(restoreOk, "--restore-log must include successful restore drill summary");
requireValidHealthArtifact(restoredHealth, healthLog, restoredOrigin);

const manifest = {
  backupSchedule: {
    enabled: false,
    cadence: "TODO: recurring backup cadence, for example every 5 minutes",
    retentionDays: "TODO: positive integer retention window in days",
    lastSuccessfulBackupAt: "TODO: ISO timestamp of the latest successful scheduled backup",
    evidence: `artifact: ${backupScheduleArtifact}`,
    checkedAt: now,
  },
  restoreDrill: {
    status: restoreOk ? "pass" : "TODO",
    command: "npm.cmd run proof:restore -- --strict",
    backupPathOutsideRepo: pathLooksOutsideRepo(backupPath),
    restorePathOutsideRepo: pathLooksOutsideRepo(restoreDir),
    backupRestoreDirsDistinct: Boolean(backupDir && restoreDir && !samePath(backupDir, restoreDir)),
    sourceDbOutsideBackupRestoreDirs,
    sourceDbPath: sourceDbPath || "TODO",
    backupDir: backupDir || "TODO",
    restoreDir: restoreDir || "TODO",
    backupArtifact: backupPath,
    summary: restoreSummary,
    artifact: `artifact: ${restoreLogPath}`,
    timestamp: now,
  },
  restoredStagingHealth: { ...restoredHealth, hostType: restoredHostType, evidence: `artifact: ${healthLogPath}` },
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
