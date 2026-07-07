import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { argValue, baseCollectorMeta, hasFlag, isFinalHttpsOrigin, printPlan, requireCondition, writeJson, refuseFinalProofOutput } from "./collect-proof-common.mjs";

function isInsideRepo(absolutePath) {
  const relativeToRepo = relative(process.cwd(), absolutePath);
  return relativeToRepo === "" || (!relativeToRepo.startsWith("..") && !isAbsolute(relativeToRepo));
}

function pathInsideOrSame(childPath, parentPath) {
  const relativeToParent = relative(parentPath, childPath);
  return relativeToParent === "" || (!relativeToParent.startsWith("..") && !isAbsolute(relativeToParent));
}

function samePath(left, right) {
  return relative(left, right) === "";
}

function readOptionalLog(filePath) {
  if (!filePath) return "";
  const resolved = resolve(process.cwd(), filePath);
  if (!existsSync(resolved)) {
    throw new Error(`${filePath} does not exist`);
  }
  return readFileSync(resolved, "utf8");
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

function parseHealth(log, logPath) {
  const ok = /\[prod-health\]\s+OK/i.test(log);
  const summary = firstMatchingLine(log, /\bbase=|\bruntime=|\bdataSync=/i) || "TODO: paste restored health:prod output with numeric finalityLagBlocks=<number>";
  const values = parseKeyValues(summary);
  const finalityLagChecked = Number.isFinite(Number(values.finalityLagBlocks));

  return {
    status: ok ? "pass" : "TODO",
    command: "npm.cmd run health:prod",
    hostType: restoredHostType,
    url: values.base || restoredOrigin,
    runtimeHealthPassed: ok && /^(ok|pass|healthy)$/i.test(values.runtime ?? ""),
    dataSyncHealthPassed: ok && /^(ok|pass|healthy)$/i.test(values.dataSync ?? ""),
    finalityLagChecked,
    summary,
    evidence: logPath ? `artifact: ${logPath}` : "TODO: path to restored health:prod log",
    timestamp: new Date().toISOString(),
  };
}

const source = argValue("source");
const backupDir = argValue("backup-dir");
const restoreDir = argValue("restore-dir");
const backup = argValue("backup");
const restoredOrigin = argValue("restored-origin");
const restoredHostType = argValue("restored-host-type");
const restoreLogPath = argValue("restore-log");
const healthLogPath = argValue("health-log");
const out = argValue("out", "docs/restore-proof.draft.json");
refuseFinalProofOutput(out, "restore");

const sourcePath = source ? resolve(process.cwd(), source) : "";
const backupDirPath = backupDir ? resolve(process.cwd(), backupDir) : "";
const restoreDirPath = restoreDir ? resolve(process.cwd(), restoreDir) : "";
const backupPath = backup ? resolve(process.cwd(), backup) : "";
requireCondition(Boolean(source), "--source must point to the source DB used for the restore drill");
requireCondition(isAbsolute(source), "--source must be an absolute source DB path");
requireCondition(existsSync(sourcePath), "--source DB must exist before collecting restore evidence");
requireCondition(statSync(sourcePath).isFile(), "--source must point to a DB file, not a directory");
requireCondition(!isInsideRepo(sourcePath), "--source DB must be outside the repo checkout for launch evidence");
requireCondition(Boolean(backupDir), "--backup-dir must point to the backup directory used for the restore drill");
requireCondition(isAbsolute(backupDir), "--backup-dir must be an absolute path");
requireCondition(existsSync(backupDirPath), "--backup-dir must exist before collecting restore evidence");
requireCondition(statSync(backupDirPath).isDirectory(), "--backup-dir must point to a directory");
requireCondition(!isInsideRepo(backupDirPath), "--backup-dir must be outside the repo checkout for launch evidence");
requireCondition(Boolean(restoreDir), "--restore-dir must point to the restore drill directory");
requireCondition(isAbsolute(restoreDir), "--restore-dir must be an absolute path");
requireCondition(existsSync(restoreDirPath), "--restore-dir must exist before collecting restore evidence");
requireCondition(statSync(restoreDirPath).isDirectory(), "--restore-dir must point to a directory");
requireCondition(!isInsideRepo(restoreDirPath), "--restore-dir must be outside the repo checkout for launch evidence");
requireCondition(!pathInsideOrSame(sourcePath, backupDirPath), "--source DB must not be inside --backup-dir");
requireCondition(!pathInsideOrSame(sourcePath, restoreDirPath), "--source DB must not be inside --restore-dir");
requireCondition(!samePath(backupDirPath, restoreDirPath), "--backup-dir and --restore-dir must be different");
requireCondition(Boolean(backup), "--backup must point to the backup artifact used for the restore drill");
requireCondition(isAbsolute(backup), "--backup must be an absolute path to the backup artifact used for the restore drill");
requireCondition(existsSync(backupPath), "--backup file must exist before collecting restore evidence");
requireCondition(statSync(backupPath).isFile(), "--backup must point to a backup file, not a directory");
requireCondition(!isInsideRepo(backupPath), "--backup file must be outside the repo checkout for launch evidence");
requireCondition(pathInsideOrSame(backupPath, backupDirPath), "--backup file must be inside --backup-dir");
requireCondition(isFinalHttpsOrigin(restoredOrigin), "--restored-origin must be a non-local HTTPS origin without path, query, or hash");
requireCondition(["staging", "canary", "restore"].includes(restoredHostType), "--restored-host-type must be staging, canary, or restore");

const now = new Date().toISOString();
const restoreLog = readOptionalLog(restoreLogPath);
const healthLog = readOptionalLog(healthLogPath);
const restoreSummary =
  firstMatchingLine(restoreLog, /^Summary:/i) ||
  firstMatchingLine(restoreLog, /^Copy this summary/i) ||
  "TODO: paste completed restore drill summary";
const restoreOk = hasOkSummary(restoreLog, "backup/restore drill completed without detected issues");
const manifest = {
  ...baseCollectorMeta("restore"),
  source,
  backupDir,
  restoreDir,
  backup,
  restoredOrigin,
  restoredHostType,
  backupSchedule: {
    enabled: false,
    cadence: "TODO: recurring backup cadence, for example every 5 minutes",
    evidence: "TODO: paste concrete backup schedule or cron proof",
    checkedAt: now,
  },
  restoreDrill: {
    status: restoreOk ? "pass" : "TODO",
    command: "npm.cmd run proof:restore -- --strict",
    backupPathOutsideRepo: true,
    restorePathOutsideRepo: true,
    backupRestoreDirsDistinct: true,
    sourceDbOutsideBackupRestoreDirs: true,
    sourceDbPath: source,
    backupDir,
    restoreDir,
    backupArtifact: backup,
    summary: restoreSummary,
    artifact: restoreLogPath ? `artifact: ${restoreLogPath}` : "TODO: path to completed restore drill log",
    timestamp: now,
  },
  restoredStagingHealth: parseHealth(healthLog, healthLogPath),

  indexerPreservation: {
    heartbeatPreserved: false,
    latestIndexedEpochPreserved: false,
    heartbeatBefore: "TODO: heartbeat value before restore",
    heartbeatAfter: "TODO: heartbeat value after restore",
    latestIndexedEpochBefore: "TODO: latest indexed epoch before restore",
    latestIndexedEpochAfter: "TODO: latest indexed epoch after restore",
    evidence: "TODO: paste heartbeat and latest indexed epoch comparison before/after restore",
    checkedAt: now,
  },
  requiredManualEvidence: [
    "enable and prove recurring backup schedule",
    "run restore drill from the backup artifact into the restore directory and pass --restore-log=<redacted-restore-drill-log>",
    "run health:prod against the restored staging/canary/restore origin with numeric finalityLagBlocks and pass --health-log=<redacted-health-prod-log>",
    "prove heartbeat and latest indexed epoch values are preserved after restore",
  ],
};

if (hasFlag("print-plan")) {
  printPlan("Restore Evidence Collection Plan", manifest);
} else {
  const written = writeJson(out, manifest);
  console.log(`Restore evidence draft written: ${written}`);
  console.log("Review TODO/false fields before promoting to docs/restore-proof.json and running npm.cmd run proof:restore -- --strict.");
}
