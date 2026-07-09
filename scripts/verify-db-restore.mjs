import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

const strict = process.argv.includes("--strict") || process.env.PROOF_STRICT === "1";
const repoRoot = process.cwd();
const args = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--") && arg.includes("="))
    .map((arg) => {
      const [key, ...rest] = arg.slice(2).split("=");
      return [key, rest.join("=")];
    }),
);

function env(name) {
  return process.env[name]?.trim() || "";
}

function argOrEnv(argName, envName, fallback = "") {
  return args.get(argName)?.trim() || env(envName) || fallback;
}

const TEMPLATE_VALUE_RE = /REPLACE_|<REDACTED>|TODO|TBD/i;
const secretKeyPattern = /(secret|private[_-]?key|mnemonic|webhook|dsn|api[_-]?key|api[_-]?token|auth[_-]?token|access[_-]?token|bearer|session|cookie|password)/i;

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function pathStatus(rawPath) {
  if (!rawPath) return { absolute: "", isAbsolute: false, insideRepo: false };
  const absolute = isAbsolute(rawPath) ? rawPath : resolve(repoRoot, rawPath);
  const normalizedAbsolute = absolute.toLowerCase();
  const normalizedRepo = repoRoot.toLowerCase();
  const insideRepo = normalizedAbsolute === normalizedRepo ||
    normalizedAbsolute.startsWith(`${normalizedRepo}\\`) ||
    normalizedAbsolute.startsWith(`${normalizedRepo}/`);
  return { absolute, isAbsolute: isAbsolute(rawPath), insideRepo };
}

function samePath(left, right) {
  if (!left || !right) return false;
  return resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

function pathInsideOrSame(childPath, parentPath) {
  if (!childPath || !parentPath) return false;
  const child = resolve(childPath).toLowerCase();
  const parent = resolve(parentPath).replace(/[\\/]+$/, "").toLowerCase();
  return child === parent || child.startsWith(`${parent}\\`) || child.startsWith(`${parent}/`);
}

function validateManifestPath(label, value, expected, issues) {
  if (!hasRealText(value)) {
    issues.push(`${label} is missing`);
    return null;
  }
  const checked = pathStatus(value);
  if (!checked.isAbsolute) issues.push(`${label} must be absolute`);
  if (checked.insideRepo) issues.push(`${label} must be outside the repo checkout`);
  if (expected && !samePath(checked.absolute, expected)) {
    issues.push(`${label} must match the restore command path`);
  }
  return checked;
}

function copyIfExists(source, target) {
  if (!existsSync(source)) return false;
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  return true;
}

function readCount(db, table) {
  try {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
    return Number(row?.count ?? 0);
  } catch {
    return null;
  }
}

async function openRestoredDb(dbPath) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath);
  try {
    const integrityRows = db.prepare("PRAGMA integrity_check").all();
    const integrity = integrityRows.map((row) => String(row.integrity_check ?? Object.values(row)[0] ?? "")).join(", ");
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
    const tableNames = tables.map((row) => String(row.name));
    const counts = {};
    for (const table of ["meta", "epochs", "scoped_epochs", "bets", "scoped_bets", "jackpots", "scoped_jackpots", "reward_claims", "scoped_reward_claims"]) {
      counts[table] = readCount(db, table);
    }
    return { integrity, tableNames, counts };
  } finally {
    db.close();
  }
}

function fmtSize(filePath) {
  if (!existsSync(filePath)) return "missing";
  return `${statSync(filePath).size} bytes`;
}

function printTable(headers, rows) {
  console.log(`| ${headers.join(" | ")} |`);
  console.log(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasRealText(value) {
  return hasText(value) && !TEMPLATE_VALUE_RE.test(value);
}

function integerString(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return value.trim();
  return "";
}

function hasIsoTimestamp(value) {
  if (!hasRealText(value)) return false;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text)) return false;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return false;
  const normalized = text.includes(".") ? text : text.replace("Z", ".000Z");
  return parsed.toISOString() === normalized;
}

function statusOk(value) {
  return ["ok", "pass", "passed", "healthy", "success", "green", "verified"].includes(String(value ?? "").trim().toLowerCase());
}

function hasScheduledCadence(value) {
  if (!hasRealText(value)) return false;
  const text = String(value).trim().toLowerCase();
  if (/\b(manual|one[-\s]?time|ad[-\s]?hoc|on[-\s]?demand|once|none|disabled|not scheduled)\b/.test(text)) {
    return false;
  }
  return /\b(every|each|cron|hourly|daily|weekly|monthly)\b|\*\/|\b\d+\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)\b/.test(text);
}

function isNonLocalHttpsUrl(value) {
  if (!hasRealText(value)) return false;
  try {
    const url = new URL(String(value).trim());
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" &&
      !["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host) &&
      !host.endsWith(".local");
  } catch {
    return false;
  }
}

function hasEvidence(value) {
  if (!isPlainObject(value)) return false;
  return [
    value.evidence,
    value.evidencePath,
    value.link,
    value.summary,
    value.artifact,
    value.notes,
  ].some(hasRealText);
}

function hasConcreteText(value) {
  if (!hasRealText(value)) return false;
  const text = String(value).trim();
  return /https?:\/\//i.test(text) ||
    /(?:^|[\\/\s])[^\s]+\.(?:json|jsonl|log|md|txt|csv|sqlite|db)(?:\b|$)/i.test(text) ||
    /\bnpm(?:\.cmd)?\s+run\s+(?:proof:restore|health:prod|proof:[a-z0-9:-]+)\b/i.test(text) ||
    /\bproof:[a-z0-9:-]+\b/i.test(text) ||
    /\b(?:cron|systemctl|journalctl|pm2|docker\s+compose|backup|restore|heartbeat|finalityLagBlocks)\b/i.test(text);
}

function hasConcreteEvidence(value) {
  if (!isPlainObject(value)) return false;
  return [
    value.evidence,
    value.evidencePath,
    value.link,
    value.summary,
    value.artifact,
    value.notes,
  ].some(hasConcreteText);
}

function evidenceText(value) {
  if (!isPlainObject(value)) return "";
  return [
    value.evidence,
    value.evidencePath,
    value.link,
    value.summary,
    value.artifact,
    value.notes,
  ].filter(hasRealText).join("\n");
}

function localArtifactPathFromText(value, key = "") {
  if (!hasRealText(value)) return "";
  const text = String(value).trim().replace(/^`|`$/g, "");
  if (/^https?:\/\//i.test(text)) return "";
  const artifactMatch = text.match(/^artifact:\s*(\S+)/i);
  const candidate = (artifactMatch ? artifactMatch[1] : text).trim().replace(/^`|`$/g, "").replace(/[),.;]+$/g, "");
  if (/^https?:\/\//i.test(candidate)) return "";
  const keySuggestsPath = /(?:evidencePath|artifact|link|logPath|reportPath|commandOutputPath)$/i.test(key);
  const valueLooksLikePath = /(?:^|[\\/\s])[^\s]+\.(?:json|jsonl|log|md|txt|csv)(?:\b|$)/i.test(candidate);
  return (artifactMatch || keySuggestsPath) && valueLooksLikePath ? candidate : "";
}

function findMissingLocalArtifactRefs(value, path = "$", key = "") {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findings.push(...findMissingLocalArtifactRefs(entry, `${path}[${index}]`, key)));
    return findings;
  }
  if (typeof value === "string") {
    const artifactPath = localArtifactPathFromText(value, key);
    if (artifactPath && !existsSync(resolve(repoRoot, artifactPath))) {
      findings.push(`${path} -> ${artifactPath}`);
    }
    return findings;
  }
  if (!isPlainObject(value)) return findings;
  for (const [childKey, entry] of Object.entries(value)) {
    findings.push(...findMissingLocalArtifactRefs(entry, `${path}.${childKey}`, childKey));
  }
  return findings;
}
function normalizedOrigin(value) {
  if (!hasRealText(value)) return "";
  try {
    return new URL(String(value).trim()).origin.toLowerCase();
  } catch {
    return "";
  }
}

function healthEvidenceBaseMatches(value, expectedOrigin) {
  const expected = normalizedOrigin(expectedOrigin);
  if (!expected) return false;
  const text = evidenceText(value);
  const matches = [...text.matchAll(/\bbase=([^\s|]+)/gi)];
  return matches.some((match) => normalizedOrigin(match[1]) === expected);
}

function hasNumericFinalityLagEvidence(value) {
  if (!isPlainObject(value)) return false;
  const evidence = [
    value.evidence,
    value.summary,
    value.notes,
    value.artifact,
  ].filter(hasRealText).join("\n");
  const match = evidence.match(/\bfinalityLagBlocks=([^\s]+)/i);
  return Boolean(match && Number.isFinite(Number(match[1])));
}

function findSecretLikeValues(value, path = "$") {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findings.push(...findSecretLikeValues(entry, `${path}[${index}]`)));
    return findings;
  }
  if (!isPlainObject(value)) return findings;
  for (const [key, entry] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (secretKeyPattern.test(key) && typeof entry === "string") {
      const normalized = entry.trim().toLowerCase();
      if (!["", "present", "configured", "redacted", "<redacted>"].includes(normalized)) {
        findings.push(childPath);
      }
    }
    findings.push(...findSecretLikeValues(entry, childPath));
  }
  return findings;
}

function findTemplateLikeValues(value, path = "$") {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findings.push(...findTemplateLikeValues(entry, `${path}[${index}]`)));
    return findings;
  }
  if (typeof value === "string") {
    if (TEMPLATE_VALUE_RE.test(value)) findings.push(path);
    return findings;
  }
  if (!isPlainObject(value)) return findings;
  for (const [key, entry] of Object.entries(value)) {
    findings.push(...findTemplateLikeValues(entry, `${path}.${key}`));
  }
  return findings;
}

function validateManifest(manifest, issues) {
  if (!isPlainObject(manifest)) {
    issues.push("restore proof manifest must be an object");
    return null;
  }

  const secretFindings = findSecretLikeValues(manifest);
  if (secretFindings.length > 0) {
    issues.push(`secret-like values must be redacted: ${secretFindings.slice(0, 5).join(", ")}`);
  }
  const templateFindings = findTemplateLikeValues(manifest);
  if (templateFindings.length > 0) {
    issues.push(`template placeholder values must be replaced: ${templateFindings.slice(0, 5).join(", ")}`);
  }

  const missingArtifactRefs = findMissingLocalArtifactRefs(manifest);
  if (missingArtifactRefs.length > 0) {
    issues.push(`local restore artifact references must exist: ${missingArtifactRefs.slice(0, 5).join(", ")}`);
  }
  const backupSchedule = isPlainObject(manifest.backupSchedule) ? manifest.backupSchedule : {};
  if (!isPlainObject(manifest.backupSchedule)) issues.push("backupSchedule section is missing");
  if (backupSchedule.enabled !== true) issues.push("backupSchedule.enabled must be true");
  if (!hasRealText(backupSchedule.cadence)) issues.push("backupSchedule.cadence is missing");
  if (hasRealText(backupSchedule.cadence) && !hasScheduledCadence(backupSchedule.cadence)) {
    issues.push("backupSchedule.cadence must describe a recurring schedule, not a manual one-off backup");
  }
  if (!hasIsoTimestamp(backupSchedule.checkedAt)) issues.push("backupSchedule.checkedAt must be ISO-8601 UTC");
  if (!hasEvidence(backupSchedule)) issues.push("backupSchedule has no evidence");
  if (hasEvidence(backupSchedule) && !hasConcreteEvidence(backupSchedule)) {
    issues.push("backupSchedule must include concrete scheduler/backup evidence path, link, artifact, or command output");
  }

  const restoreDrill = isPlainObject(manifest.restoreDrill) ? manifest.restoreDrill : {};
  if (!isPlainObject(manifest.restoreDrill)) issues.push("restoreDrill section is missing");
  if (!statusOk(restoreDrill.status)) issues.push("restoreDrill.status must be ok/pass/verified");
  if (!String(restoreDrill.command ?? "").includes("proof:restore")) issues.push("restoreDrill.command must record npm run proof:restore");
  if (restoreDrill.backupPathOutsideRepo !== true) issues.push("restoreDrill.backupPathOutsideRepo must be true");
  if (restoreDrill.restorePathOutsideRepo !== true) issues.push("restoreDrill.restorePathOutsideRepo must be true");
  if (restoreDrill.backupRestoreDirsDistinct !== true) issues.push("restoreDrill.backupRestoreDirsDistinct must be true");
  if (restoreDrill.sourceDbOutsideBackupRestoreDirs !== true) {
    issues.push("restoreDrill.sourceDbOutsideBackupRestoreDirs must be true");
  }
  validateManifestPath("restoreDrill.sourceDbPath", restoreDrill.sourceDbPath, source.absolute, issues);
  validateManifestPath("restoreDrill.backupDir", restoreDrill.backupDir, backupDir.absolute, issues);
  validateManifestPath("restoreDrill.restoreDir", restoreDrill.restoreDir, restoreDir.absolute, issues);
  const backupArtifact = validateManifestPath("restoreDrill.backupArtifact", restoreDrill.backupArtifact, backup.absolute, issues);
  if (backupArtifact && backupDir.absolute && !pathInsideOrSame(backupArtifact.absolute, backupDir.absolute)) {
    issues.push("restoreDrill.backupArtifact must be inside restoreDrill.backupDir");
  }
  if (backupArtifact && !existsSync(backupArtifact.absolute)) {
    issues.push("restoreDrill.backupArtifact must exist on disk for launch proof");
  }
  if (!hasIsoTimestamp(restoreDrill.timestamp)) issues.push("restoreDrill.timestamp must be ISO-8601 UTC");
  if (!hasEvidence(restoreDrill)) issues.push("restoreDrill has no evidence");
  if (hasEvidence(restoreDrill) && !hasConcreteEvidence(restoreDrill)) {
    issues.push("restoreDrill must include concrete restore-drill evidence path, link, artifact, or command output");
  }

  const restoredStagingHealth = isPlainObject(manifest.restoredStagingHealth) ? manifest.restoredStagingHealth : {};
  if (!isPlainObject(manifest.restoredStagingHealth)) issues.push("restoredStagingHealth section is missing");
  if (!statusOk(restoredStagingHealth.status)) issues.push("restoredStagingHealth.status must be ok/pass/healthy");
  if (!String(restoredStagingHealth.command ?? "").includes("health:prod")) issues.push("restoredStagingHealth.command must record npm run health:prod");
  if (!["staging", "canary", "restore"].includes(String(restoredStagingHealth.hostType ?? "").trim().toLowerCase())) {
    issues.push("restoredStagingHealth.hostType must be staging, canary, or restore");
  }
  if (!isNonLocalHttpsUrl(restoredStagingHealth.url)) {
    issues.push("restoredStagingHealth.url must be a non-local HTTPS staging, canary, or restore URL");
  }
  if (!healthEvidenceBaseMatches(restoredStagingHealth, restoredStagingHealth.url)) {
    issues.push("restoredStagingHealth evidence must include base=<restored origin> from health:prod");
  }
  if (restoredStagingHealth.runtimeHealthPassed !== true) issues.push("restoredStagingHealth.runtimeHealthPassed must be true");
  if (restoredStagingHealth.dataSyncHealthPassed !== true) issues.push("restoredStagingHealth.dataSyncHealthPassed must be true");
  if (restoredStagingHealth.finalityLagChecked !== true) {
    issues.push("restoredStagingHealth.finalityLagChecked must be true");
  }
  if (!hasNumericFinalityLagEvidence(restoredStagingHealth)) {
    issues.push("restoredStagingHealth.evidence must include numeric finalityLagBlocks from health:prod");
  }
  if (!hasIsoTimestamp(restoredStagingHealth.timestamp)) issues.push("restoredStagingHealth.timestamp must be ISO-8601 UTC");
  if (!hasEvidence(restoredStagingHealth)) issues.push("restoredStagingHealth has no evidence");
  if (hasEvidence(restoredStagingHealth) && !hasConcreteEvidence(restoredStagingHealth)) {
    issues.push("restoredStagingHealth must include concrete health:prod evidence path, link, artifact, command output, or finalityLagBlocks summary");
  }

  const indexerPreservation = isPlainObject(manifest.indexerPreservation) ? manifest.indexerPreservation : {};
  if (!isPlainObject(manifest.indexerPreservation)) issues.push("indexerPreservation section is missing");
  if (indexerPreservation.heartbeatPreserved !== true) issues.push("indexerPreservation.heartbeatPreserved must be true");
  if (indexerPreservation.latestIndexedEpochPreserved !== true) issues.push("indexerPreservation.latestIndexedEpochPreserved must be true");
  if (!hasRealText(indexerPreservation.heartbeatBefore)) issues.push("indexerPreservation.heartbeatBefore is missing");
  if (!hasRealText(indexerPreservation.heartbeatAfter)) issues.push("indexerPreservation.heartbeatAfter is missing");
  if (
    hasRealText(indexerPreservation.heartbeatBefore) &&
    hasRealText(indexerPreservation.heartbeatAfter) &&
    String(indexerPreservation.heartbeatBefore).trim() !== String(indexerPreservation.heartbeatAfter).trim()
  ) {
    issues.push("indexerPreservation.heartbeatBefore must match heartbeatAfter");
  }
  const latestIndexedEpochBefore = integerString(indexerPreservation.latestIndexedEpochBefore);
  const latestIndexedEpochAfter = integerString(indexerPreservation.latestIndexedEpochAfter);
  if (!latestIndexedEpochBefore) issues.push("indexerPreservation.latestIndexedEpochBefore must be a non-negative integer");
  if (!latestIndexedEpochAfter) issues.push("indexerPreservation.latestIndexedEpochAfter must be a non-negative integer");
  if (
    latestIndexedEpochBefore &&
    latestIndexedEpochAfter &&
    latestIndexedEpochBefore !== latestIndexedEpochAfter
  ) {
    issues.push("indexerPreservation.latestIndexedEpochBefore must match latestIndexedEpochAfter");
  }
  if (!hasIsoTimestamp(indexerPreservation.checkedAt)) {
    issues.push("indexerPreservation.checkedAt must be ISO-8601 UTC");
  }
  if (!hasEvidence(indexerPreservation)) issues.push("indexerPreservation has no evidence");
  if (hasEvidence(indexerPreservation) && !hasConcreteEvidence(indexerPreservation)) {
    issues.push("indexerPreservation must include concrete heartbeat/indexer preservation evidence path, link, artifact, or command output");
  }

  return { backupSchedule, restoreDrill, restoredStagingHealth, indexerPreservation };
}

const sourceRaw = argOrEnv("source", "LORE_DB_PATH");
const backupDirRaw = argOrEnv("backup-dir", "LORE_BACKUP_DIR", "data/restore-proof/backups");
const restoreDirRaw = argOrEnv("restore-dir", "LORE_RESTORE_DRILL_DIR", "data/restore-proof/restored");
const backupRaw = argOrEnv("backup", "LORE_RESTORE_BACKUP");
const manifestPath = argOrEnv("manifest", "RESTORE_PROOF_PATH", "docs/restore-proof.json");
const source = pathStatus(sourceRaw);
const backupDir = pathStatus(backupDirRaw);
const restoreDir = pathStatus(restoreDirRaw);
const backup = pathStatus(backupRaw);
const issues = [];
const slug = timestampSlug();
let manifestSummary = null;

console.log("# SQLite Backup / Restore Proof");
console.log("");
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log(`Strict: ${strict ? "yes" : "no"}`);
console.log(`Manifest: ${resolve(repoRoot, manifestPath)}`);
console.log("");

if (!sourceRaw) issues.push("LORE_DB_PATH or --source is missing");
if (sourceRaw && !existsSync(source.absolute)) issues.push("source DB does not exist");
if (strict && sourceRaw && (!source.isAbsolute || source.insideRepo)) {
  issues.push("source DB path must be absolute and outside repo for launch proof");
}
if (strict && (!backupDir.isAbsolute || backupDir.insideRepo)) {
  issues.push("backup dir must be absolute and outside repo for launch proof");
}
if (strict && (!restoreDir.isAbsolute || restoreDir.insideRepo)) {
  issues.push("restore dir must be absolute and outside repo for launch proof");
}
if (sourceRaw && backupDirRaw && pathInsideOrSame(source.absolute, backupDir.absolute)) {
  issues.push("source DB path must not be inside backup dir");
}
if (sourceRaw && restoreDirRaw && pathInsideOrSame(source.absolute, restoreDir.absolute)) {
  issues.push("source DB path must not be inside restore dir");
}
if (backupDirRaw && restoreDirRaw && samePath(backupDir.absolute, restoreDir.absolute)) {
  issues.push("backup dir and restore dir must be different");
}
if (strict && !backupRaw) {
  issues.push("backup artifact path must be provided with --backup or LORE_RESTORE_BACKUP for launch proof");
}
if (backupRaw && !existsSync(backup.absolute)) {
  issues.push("backup artifact does not exist");
}
if (strict && backupRaw && (!backup.isAbsolute || backup.insideRepo)) {
  issues.push("backup artifact must be absolute and outside repo for launch proof");
}
if (backupRaw && backupDirRaw && !pathInsideOrSame(backup.absolute, backupDir.absolute)) {
  issues.push("backup artifact must be inside backup dir");
}
if (strict && /\.draft\.json$/i.test(resolve(repoRoot, manifestPath))) {
  issues.push("draft proof manifests are not accepted as launch proof");
}
if (strict && !existsSync(resolve(repoRoot, manifestPath))) {
  issues.push("restore proof manifest is missing");
}

if (existsSync(resolve(repoRoot, manifestPath))) {
  try {
    const manifest = JSON.parse(readFileSync(resolve(repoRoot, manifestPath), "utf8"));
    manifestSummary = validateManifest(manifest, issues);
  } catch (error) {
    issues.push(`restore proof manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

printTable(["Field", "Value"], [
  ["source", sourceRaw ? source.absolute : "missing"],
  ["source size", sourceRaw ? fmtSize(source.absolute) : "missing"],
  ["backup dir", backupDir.absolute],
  ["restore dir", restoreDir.absolute],
  ["backup artifact", backupRaw ? backup.absolute : "missing"],
  ["manifest", resolve(repoRoot, manifestPath)],
]);

if (manifestSummary) {
  console.log("");
  console.log("## Restore Manifest");
  printTable(["Section", "Status"], [
    ["backupSchedule", manifestSummary.backupSchedule.enabled === true ? "checked" : "issue"],
    ["restoreDrill", statusOk(manifestSummary.restoreDrill.status) ? "checked" : "issue"],
    ["restoredStagingHealth", statusOk(manifestSummary.restoredStagingHealth.status) ? "checked" : "issue"],
    ["indexerPreservation", manifestSummary.indexerPreservation.heartbeatPreserved === true ? "checked" : "issue"],
  ]);
}

if (issues.length === 0) {
  const sourceBase = basename(source.absolute).replace(/\.sqlite$/i, "");
  const backupMain = join(backupDir.absolute, `${sourceBase}-${slug}.sqlite`);
  const restoreMain = join(restoreDir.absolute, `${sourceBase}-restored-${slug}.sqlite`);
  const copied = [];

  copyIfExists(source.absolute, backupMain);
  copied.push([source.absolute, backupMain, fmtSize(backupMain)]);
  for (const suffix of ["-wal", "-shm"]) {
    const sourceSidecar = `${source.absolute}${suffix}`;
    const backupSidecar = `${backupMain}${suffix}`;
    if (copyIfExists(sourceSidecar, backupSidecar)) {
      copied.push([sourceSidecar, backupSidecar, fmtSize(backupSidecar)]);
    }
  }

  copyFileSync(backupMain, restoreMain);
  for (const suffix of ["-wal", "-shm"]) {
    const backupSidecar = `${backupMain}${suffix}`;
    if (existsSync(backupSidecar)) copyFileSync(backupSidecar, `${restoreMain}${suffix}`);
  }

  console.log("");
  console.log("## Copied Files");
  printTable(["Source", "Target", "Size"], copied);

  let restored = null;
  try {
    restored = await openRestoredDb(restoreMain);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    issues.push(`restored DB could not be opened or checked: ${message}`);
  }

  if (restored && restored.integrity !== "ok") issues.push(`restored DB integrity_check returned ${restored.integrity}`);
  if (restored && restored.tableNames.length === 0) issues.push("restored DB has no tables");

  const knownRowTotal = Object.values(restored?.counts ?? {})
    .filter((value) => typeof value === "number")
    .reduce((total, value) => total + value, 0);
  if (strict && restored && knownRowTotal === 0) {
    issues.push("restored DB has zero rows in known launch tables");
  }

  console.log("");
  console.log("## Restored DB");
  printTable(["Field", "Value"], [
    ["restore path", restoreMain],
    ["integrity_check", restored?.integrity ?? "not checked"],
    ["tables", restored?.tableNames.join(", ") || "none"],
  ]);
  console.log("");
  console.log("## Row Counts");
  printTable(
    ["Table", "Rows"],
    Object.entries(restored?.counts ?? {}).map(([table, count]) => [table, count == null ? "missing" : String(count)]),
  );
}

console.log("");
console.log(`Summary: ${issues.length === 0 ? "backup/restore drill completed without detected issues" : `${issues.length} issue(s): ${issues.join("; ")}`}.`);
console.log("Copy this summary into `docs/mainnet-proof-record.md` only after confirming it was run against the intended production or canary DB and the restore manifest reflects the staging health proof.");

if (strict && issues.length > 0) {
  process.exitCode = 1;
}
