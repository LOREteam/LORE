import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  hasPublicProofHttpsUrl as hasPublicHttpsUrl,
  isFinalHttpsOrigin as isNonLocalHttpsUrl,
  normalizeProofOrigin,
} from "./collect-proof-common.mjs";
import { hasKnownLaunchSqliteRows, readCanonicalSqliteCount } from "./sqlite-scope-audit-lib.mjs";

const strict = process.argv.includes("--strict") || process.env.PROOF_STRICT === "1";
const summaryOnly = process.argv.includes("--summary-only");
const repoRoot = process.cwd();
const restoreLaunchGates = ["G8"];
const restoreLaunchGateGroups = "restore=1";
const CANONICAL_NON_NEGATIVE_INTEGER_RE = /^(?:0|[1-9]\d{0,15})$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_HEALTH_BASE_MARKERS = 64;
const MAX_RESTORE_ARTIFACT_TEXT_BYTES = 256 * 1024;
const MAX_RESTORE_PROOF_MANIFEST_BYTES = 512 * 1024;
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

function launchGateSummary(issueCount) {
  const label = issueCount > 0 ? "blocked" : "covered";
  return `${label} gates: ${restoreLaunchGates.join(", ")}; groups: ${restoreLaunchGateGroups}`;
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
  if (!fileExists(source)) return false;
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  return true;
}

async function openRestoredDb(dbPath, options = {}) {
  const { DatabaseSync } = await import("node:sqlite");
  const sqliteLocation = options.immutable === true
    ? (() => {
        const url = pathToFileURL(dbPath);
        url.searchParams.set("immutable", "1");
        return url;
      })()
    : dbPath;
  const db = new DatabaseSync(sqliteLocation, { readOnly: true });
  try {
    const integrityRows = db.prepare("PRAGMA integrity_check").all();
    const integrity = integrityRows.map((row) => String(row.integrity_check ?? Object.values(row)[0] ?? "")).join(", ");
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
    const tableNames = tables.map((row) => String(row.name));
    const counts = {};
    for (const table of [
      "meta", "epochs", "scoped_epochs", "bets", "scoped_bets", "jackpots", "scoped_jackpots",
      "reward_claims", "scoped_reward_claims", "protocol_fee_flushes", "scoped_protocol_fee_flushes",
      "scoped_global_stats_aggregate", "scoped_global_stats_dirty",
      "scoped_leaderboard_read_model", "scoped_leaderboard_dirty",
      "scoped_indexer_events",
    ]) {
      counts[table] = readCanonicalSqliteCount(db, table);
    }
    return { integrity, tableNames, counts };
  } finally {
    db.close();
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

function fmtSize(filePath) {
  const stats = regularFileStat(filePath);
  return stats ? `${stats.size} bytes` : "missing";
}

function fileExists(filePath) {
  return regularFileStat(filePath) !== null;
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
  if (typeof value === "string") {
    const text = value.trim();
    if (!CANONICAL_NON_NEGATIVE_INTEGER_RE.test(text)) return "";
    const parsed = BigInt(text);
    return parsed <= MAX_SAFE_INTEGER_BIGINT ? text : "";
  }
  return "";
}

function hasCanonicalNonNegativeInteger(value) {
  return parseCanonicalNonNegativeInteger(value) !== null;
}

function parseCanonicalNonNegativeInteger(value) {
  const text = typeof value === "bigint" ? String(value) : integerString(value);
  if (!CANONICAL_NON_NEGATIVE_INTEGER_RE.test(text)) return null;
  const parsed = BigInt(text);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) return null;
  return Number(parsed);
}

function positiveIntegerString(value) {
  const text = integerString(value);
  return text && text !== "0" ? text : "";
}

function parseCanonicalPositiveInteger(value) {
  const parsed = parseCanonicalNonNegativeInteger(value);
  return parsed && parsed > 0 ? parsed : null;
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

function isoTimestampMs(value) {
  return hasIsoTimestamp(value) ? new Date(String(value).trim()).getTime() : Number.NaN;
}

function hasNonFutureIsoTimestamp(value) {
  const timestampMs = isoTimestampMs(value);
  return Number.isFinite(timestampMs) && timestampMs <= Date.now() + 5 * 60 * 1000;
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
  return hasPublicHttpsUrl(text) ||
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

function localArtifactIsFile(artifactPath) {
  return regularFileStat(resolve(repoRoot, artifactPath)) !== null;
}

function findMissingLocalArtifactRefs(value, path = "$", key = "") {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findings.push(...findMissingLocalArtifactRefs(entry, `${path}[${index}]`, key)));
    return findings;
  }
  if (typeof value === "string") {
    const artifactPath = localArtifactPathFromText(value, key);
    if (artifactPath && !localArtifactIsFile(artifactPath)) {
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

function formatMissingLocalArtifactRefs(findings) {
  const visible = summaryOnly ? findings.map((entry) => entry.split(" -> ")[0]) : findings;
  return visible.slice(0, 5).join(", ");
}

function localArtifactPaths(value) {
  if (!isPlainObject(value)) return [];
  return [
    ["evidence", value.evidence],
    ["evidencePath", value.evidencePath],
    ["link", value.link],
    ["summary", value.summary],
    ["artifact", value.artifact],
    ["notes", value.notes],
  ].map(([key, entry]) => localArtifactPathFromText(entry, key)).filter(Boolean);
}

function normalizedArtifactPathSet(value) {
  return new Set(localArtifactPaths(value).map((artifactPath) => resolve(repoRoot, artifactPath).toLowerCase()));
}

function sharedRestoreSectionArtifactIssues(manifest) {
  const sections = ["backupSchedule", "restoreDrill", "restoredStagingHealth", "indexerPreservation"];
  const sectionPaths = new Map(sections.map((section) => [section, normalizedArtifactPathSet(manifest?.[section])]));
  const issues = [];
  for (let leftIndex = 0; leftIndex < sections.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sections.length; rightIndex += 1) {
      const left = sections[leftIndex];
      const right = sections[rightIndex];
      const rightPaths = sectionPaths.get(right) ?? new Set();
      if ([...(sectionPaths.get(left) ?? [])].some((artifactPath) => rightPaths.has(artifactPath))) {
        issues.push(`restore evidence sections must use distinct local artifact files across ${left} and ${right}`);
      }
    }
  }
  return issues;
}

function readBoundedArtifactText(resolved) {
  const fd = openSync(resolved, "r");
  try {
    const buffer = Buffer.alloc(MAX_RESTORE_ARTIFACT_TEXT_BYTES);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function artifactBackedEvidenceText(value) {
  const chunks = [evidenceText(value)];
  for (const artifactPath of localArtifactPaths(value)) {
    const resolved = resolve(repoRoot, artifactPath);
    if (!regularFileStat(resolved)) continue;
    chunks.push(readBoundedArtifactText(resolved));
  }
  return chunks.join("\n");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasBackupScheduleProof(value) {
  const text = artifactBackedEvidenceText(value);
  return /\bbackup\b/i.test(text) &&
    /\b(?:cron|crontab|systemd\s+timer|systemctl|timer|scheduled\s+task|task\s+scheduler|backup\s+schedule|backup\s+job|cadence|every|hourly|daily|weekly|monthly|\*\/)\b/i.test(text);
}

function hasBackupSuccessProof(value) {
  const text = artifactBackedEvidenceText(value);
  return /\bbackup\b/i.test(text) &&
    /\b(?:lastSuccessfulBackupAt|last\s+successful\s+backup|latest\s+backup|backup\s+(?:completed|created|written|uploaded|succeeded|success)|completed\s+backup|successful\s+backup)\b/i.test(text);
}

function hasBackupRetentionProof(value) {
  const text = artifactBackedEvidenceText(value);
  return /\b(?:retention|retentionDays|prune|expire|ttl|keep)\b/i.test(text) &&
    /\b(?:retentionDays|\d+\s*(?:d|day|days))\b/i.test(text);
}

function evidenceIncludesExactBackupTimestamp(value, timestamp) {
  if (!hasIsoTimestamp(timestamp)) return false;
  return artifactBackedEvidenceText(value).includes(String(timestamp).trim());
}

function evidenceIncludesRetentionDays(value, retentionDays) {
  const days = positiveIntegerString(retentionDays);
  if (!days) return false;
  const text = artifactBackedEvidenceText(value);
  const escapedDays = escapeRegExp(days);
  return new RegExp(`\\bretentionDays\\s*[:=]\\s*${escapedDays}\\b`, "i").test(text) ||
    new RegExp(`\\b${escapedDays}\\s*(?:d|day|days)\\b`, "i").test(text);
}

function hasRestoreDrillIntegrityProof(value) {
  const text = artifactBackedEvidenceText(value);
  return /\b(?:restore|restored|copy|copied|backup)\b/i.test(text) &&
    /\b(?:integrity_check|pragma\s+integrity_check|sqlite\s+integrity|integrity\s*[=:]\s*ok|integrity\s+ok)\b/i.test(text);
}

function hasIndexerPreservationProof(value) {
  const text = artifactBackedEvidenceText(value);
  return /(?:\bheartbeat\b|heartbeatBefore|heartbeatAfter)/i.test(text) &&
    /(?:latestIndexedEpoch|latest\s+indexed\s+epoch|lastIndexedEpoch|indexed\s+epoch)/i.test(text) &&
    /(?:Before|After|\bbefore\b|\bafter\b|pre[-\s]?restore|post[-\s]?restore)/i.test(text);
}
function healthEvidenceBaseMatches(value, expectedOrigin) {
  const expected = normalizeProofOrigin(expectedOrigin);
  if (!expected) return false;
  const text = evidenceText(value);
  const pattern = /\bbase=([^\s|]+)/gi;
  let inspected = 0;
  let match = pattern.exec(text);
  while (match) {
    inspected += 1;
    if (inspected > MAX_HEALTH_BASE_MARKERS) return false;
    if (normalizeProofOrigin(match[1]) === expected) return true;
    match = pattern.exec(text);
  }
  return false;
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
  return Boolean(match && hasCanonicalNonNegativeInteger(match[1]));
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
    issues.push(`local restore artifact references must exist: ${formatMissingLocalArtifactRefs(missingArtifactRefs)}`);
  }
  issues.push(...sharedRestoreSectionArtifactIssues(manifest));
  const backupSchedule = isPlainObject(manifest.backupSchedule) ? manifest.backupSchedule : {};
  if (!isPlainObject(manifest.backupSchedule)) issues.push("backupSchedule section is missing");
  if (backupSchedule.enabled !== true) issues.push("backupSchedule.enabled must be true");
  if (!hasRealText(backupSchedule.cadence)) issues.push("backupSchedule.cadence is missing");
  if (hasRealText(backupSchedule.cadence) && !hasScheduledCadence(backupSchedule.cadence)) {
    issues.push("backupSchedule.cadence must describe a recurring schedule, not a manual one-off backup");
  }
  const retentionDays = parseCanonicalPositiveInteger(backupSchedule.retentionDays);
  if (retentionDays === null) {
    issues.push("backupSchedule.retentionDays must be a positive integer");
  } else if (retentionDays > 3650) {
    issues.push("backupSchedule.retentionDays must be 3650 days or less");
  }
  if (!hasIsoTimestamp(backupSchedule.lastSuccessfulBackupAt)) {
    issues.push("backupSchedule.lastSuccessfulBackupAt must be ISO-8601 UTC");
  }
  if (!hasIsoTimestamp(backupSchedule.checkedAt)) issues.push("backupSchedule.checkedAt must be ISO-8601 UTC");
  const lastSuccessfulBackupAtMs = isoTimestampMs(backupSchedule.lastSuccessfulBackupAt);
  const backupScheduleCheckedAtMs = isoTimestampMs(backupSchedule.checkedAt);
  if (Number.isFinite(lastSuccessfulBackupAtMs) && Number.isFinite(backupScheduleCheckedAtMs)) {
    if (lastSuccessfulBackupAtMs > backupScheduleCheckedAtMs) {
      issues.push("backupSchedule.lastSuccessfulBackupAt must not be after backupSchedule.checkedAt");
    }
    if (retentionDays !== null && backupScheduleCheckedAtMs - lastSuccessfulBackupAtMs > retentionDays * 24 * 60 * 60 * 1000) {
      issues.push("backupSchedule.lastSuccessfulBackupAt must be within backupSchedule.retentionDays");
    }
  }
  if (!hasEvidence(backupSchedule)) issues.push("backupSchedule has no evidence");
  if (hasEvidence(backupSchedule) && !hasConcreteEvidence(backupSchedule)) {
    issues.push("backupSchedule must include concrete scheduler/backup evidence path, link, artifact, or command output");
  }
  if (hasEvidence(backupSchedule) && !hasBackupScheduleProof(backupSchedule)) {
    issues.push("backupSchedule evidence must mention recurring scheduler/backup proof");
  }
  if (hasEvidence(backupSchedule) && !hasBackupSuccessProof(backupSchedule)) {
    issues.push("backupSchedule evidence must mention the latest successful backup");
  }
  if (hasEvidence(backupSchedule) && hasIsoTimestamp(backupSchedule.lastSuccessfulBackupAt) && !evidenceIncludesExactBackupTimestamp(backupSchedule, backupSchedule.lastSuccessfulBackupAt)) {
    issues.push("backupSchedule evidence must include backupSchedule.lastSuccessfulBackupAt timestamp");
  }
  if (hasEvidence(backupSchedule) && !hasBackupRetentionProof(backupSchedule)) {
    issues.push("backupSchedule evidence must mention retention or pruning policy");
  }
  if (hasEvidence(backupSchedule) && retentionDays !== null && !evidenceIncludesRetentionDays(backupSchedule, backupSchedule.retentionDays)) {
    issues.push("backupSchedule evidence must include backupSchedule.retentionDays value");
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
  if (backupArtifact && !regularFileStat(backupArtifact.absolute)) {
    issues.push("restoreDrill.backupArtifact must exist on disk for launch proof");
  }
  if (!hasIsoTimestamp(restoreDrill.timestamp)) {
    issues.push("restoreDrill.timestamp must be ISO-8601 UTC");
  } else if (!hasNonFutureIsoTimestamp(restoreDrill.timestamp)) {
    issues.push("restoreDrill.timestamp must not be in the future");
  }
  if (!hasEvidence(restoreDrill)) issues.push("restoreDrill has no evidence");
  if (hasEvidence(restoreDrill) && !hasConcreteEvidence(restoreDrill)) {
    issues.push("restoreDrill must include concrete restore-drill evidence path, link, artifact, or command output");
  }
  if (hasEvidence(restoreDrill) && !hasRestoreDrillIntegrityProof(restoreDrill)) {
    issues.push("restoreDrill evidence must include restored SQLite integrity_check proof");
  }

  const restoredStagingHealth = isPlainObject(manifest.restoredStagingHealth) ? manifest.restoredStagingHealth : {};
  if (!isPlainObject(manifest.restoredStagingHealth)) issues.push("restoredStagingHealth section is missing");
  if (!statusOk(restoredStagingHealth.status)) issues.push("restoredStagingHealth.status must be ok/pass/healthy");
  if (!String(restoredStagingHealth.command ?? "").includes("health:prod")) issues.push("restoredStagingHealth.command must record npm run health:prod");
  if (!["staging", "canary", "restore"].includes(String(restoredStagingHealth.hostType ?? "").trim().toLowerCase())) {
    issues.push("restoredStagingHealth.hostType must be staging, canary, or restore");
  }
  if (!isNonLocalHttpsUrl(restoredStagingHealth.url)) {
    issues.push("restoredStagingHealth.url must be a public HTTPS staging, canary, or restore URL");
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
    issues.push("restoredStagingHealth.evidence must include canonical non-negative decimal finalityLagBlocks from health:prod");
  }
  if (!hasIsoTimestamp(restoredStagingHealth.timestamp)) {
    issues.push("restoredStagingHealth.timestamp must be ISO-8601 UTC");
  } else if (!hasNonFutureIsoTimestamp(restoredStagingHealth.timestamp)) {
    issues.push("restoredStagingHealth.timestamp must not be in the future");
  }
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
  } else if (!hasNonFutureIsoTimestamp(indexerPreservation.checkedAt)) {
    issues.push("indexerPreservation.checkedAt must not be in the future");
  }
  if (!hasEvidence(indexerPreservation)) issues.push("indexerPreservation has no evidence");
  if (hasEvidence(indexerPreservation) && !hasConcreteEvidence(indexerPreservation)) {
    issues.push("indexerPreservation must include concrete heartbeat/indexer preservation evidence path, link, artifact, or command output");
  }
  if (hasEvidence(indexerPreservation) && !hasIndexerPreservationProof(indexerPreservation)) {
    issues.push("indexerPreservation evidence must mention heartbeat and latest indexed epoch before/after restore");
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

function printSummaryAndExit() {
  console.log("");
  console.log("# SQLite Backup / Restore Proof Summary");
  console.log(`Strict: ${strict ? "yes" : "no"}`);
  console.log(`Manifest: ${fileExists(resolve(repoRoot, manifestPath)) ? "present" : "missing"}`);
  console.log("Would write: false");
  if (manifestSummary) {
    const sectionStatus = [
      `backupSchedule=${manifestSummary.backupSchedule.enabled === true ? "checked" : "issue"}`,
      `restoreDrill=${statusOk(manifestSummary.restoreDrill.status) ? "checked" : "issue"}`,
      `restoredStagingHealth=${statusOk(manifestSummary.restoredStagingHealth.status) ? "checked" : "issue"}`,
      `indexerPreservation=${manifestSummary.indexerPreservation.heartbeatPreserved === true ? "checked" : "issue"}`,
    ].join(" ");
    console.log(`Manifest sections: ${sectionStatus}`);
  }
  console.log(`Summary: ${issues.length === 0 ? "backup/restore drill inputs are ready; summary mode did not copy files" : `${issues.length} issue(s): ${issues.join("; ")}`}; ${launchGateSummary(issues.length)}.`);
  console.log("Copy this summary into `docs/mainnet-proof-record.md` only after confirming it was run against the intended production or canary DB and the restore manifest reflects the staging health proof.");
  if (strict && issues.length > 0) process.exitCode = 1;
  process.exit();
}

if (!summaryOnly) {
  console.log("# SQLite Backup / Restore Proof");
  console.log("");
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Strict: ${strict ? "yes" : "no"}`);
  console.log(`Manifest: ${resolve(repoRoot, manifestPath)}`);
  console.log("");
}

if (!sourceRaw) issues.push("LORE_DB_PATH or --source is missing");
if (sourceRaw && !existsSync(source.absolute)) issues.push("source DB does not exist");
if (sourceRaw && existsSync(source.absolute) && !fileExists(source.absolute)) issues.push("source DB must be a file");
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
if (backupRaw && existsSync(backup.absolute) && !fileExists(backup.absolute)) {
  issues.push("backup artifact must be a file");
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
const resolvedManifestPath = resolve(repoRoot, manifestPath);
if (strict && !existsSync(resolvedManifestPath)) {
  issues.push("restore proof manifest is missing");
}

if (existsSync(resolvedManifestPath)) {
  const manifestStat = regularFileStat(resolvedManifestPath);
  if (!manifestStat) {
    issues.push("restore proof manifest must be a file");
  } else if (manifestStat.size > MAX_RESTORE_PROOF_MANIFEST_BYTES) {
    issues.push("restore proof manifest is too large to validate safely");
  } else {
    try {
      const manifest = JSON.parse(readFileSync(resolvedManifestPath, "utf8"));
      manifestSummary = validateManifest(manifest, issues);
    } catch (error) {
      issues.push(`restore proof manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

let backupArtifactSnapshot = null;
if (backupRaw && fileExists(backup.absolute)) {
  try {
    backupArtifactSnapshot = await openRestoredDb(backup.absolute, { immutable: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    issues.push(`backup artifact could not be opened or checked: ${message}`);
  }
  if (backupArtifactSnapshot && backupArtifactSnapshot.integrity !== "ok") {
    issues.push(`backup artifact integrity_check returned ${backupArtifactSnapshot.integrity}`);
  }
  if (strict && backupArtifactSnapshot && !hasKnownLaunchSqliteRows(backupArtifactSnapshot)) {
    issues.push("backup artifact has zero rows in known launch tables");
  }
}

if (summaryOnly) printSummaryAndExit();

if (!summaryOnly) {
  printTable(["Field", "Value"], [
    ["source", sourceRaw ? source.absolute : "missing"],
    ["source size", sourceRaw ? fmtSize(source.absolute) : "missing"],
    ["backup dir", backupDir.absolute],
    ["restore dir", restoreDir.absolute],
    ["backup artifact", backupRaw ? backup.absolute : "missing"],
    ["manifest", resolve(repoRoot, manifestPath)],
  ]);
}

if (manifestSummary && !summaryOnly) {
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
  const backupInput = backupRaw ? backup.absolute : "";
  const sourceBase = basename(backupInput || source.absolute).replace(/\.sqlite$/i, "");
  const backupMain = backupInput || join(backupDir.absolute, `${sourceBase}-${slug}.sqlite`);
  const restoreMain = join(restoreDir.absolute, `${sourceBase}-restored-${slug}.sqlite`);
  const copied = [];

  if (!backupInput) {
    copyIfExists(source.absolute, backupMain);
    copied.push([source.absolute, backupMain, fmtSize(backupMain)]);
    for (const suffix of ["-wal", "-shm"]) {
      const sourceSidecar = `${source.absolute}${suffix}`;
      const backupSidecar = `${backupMain}${suffix}`;
      if (copyIfExists(sourceSidecar, backupSidecar)) {
        copied.push([sourceSidecar, backupSidecar, fmtSize(backupSidecar)]);
      }
    }
  }

  mkdirSync(dirname(restoreMain), { recursive: true });
  copyFileSync(backupMain, restoreMain);
  copied.push([backupMain, restoreMain, fmtSize(restoreMain)]);
  for (const suffix of ["-wal", "-shm"]) {
    const backupSidecar = `${backupMain}${suffix}`;
    if (existsSync(backupSidecar)) copyFileSync(backupSidecar, `${restoreMain}${suffix}`);
  }

  console.log("");
  if (!summaryOnly) {
    console.log("## Copied Files");
    printTable(["Source", "Target", "Size"], copied);
  }

  let restored = null;
  try {
    restored = await openRestoredDb(restoreMain);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    issues.push(`restored DB could not be opened or checked: ${message}`);
  }

  if (restored && restored.integrity !== "ok") issues.push(`restored DB integrity_check returned ${restored.integrity}`);
  if (restored && restored.tableNames.length === 0) issues.push("restored DB has no tables");

  if (strict && restored && !hasKnownLaunchSqliteRows(restored)) {
    issues.push("restored DB has zero rows in known launch tables");
  }

  if (!summaryOnly) {
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
}

console.log("");
console.log(`Summary: ${issues.length === 0 ? "backup/restore drill completed without detected issues" : `${issues.length} issue(s): ${issues.join("; ")}`}; ${launchGateSummary(issues.length)}.`);
console.log("Copy this summary into `docs/mainnet-proof-record.md` only after confirming it was run against the intended production or canary DB and the restore manifest reflects the staging health proof.");

if (strict && issues.length > 0) {
  process.exitCode = 1;
}
