import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { hasPublicProofHttpsUrl as hasPublicHttpsUrl, isFinalHttpsOrigin } from "./collect-proof-common.mjs";

const strict = process.argv.includes("--strict") || process.env.PROOF_STRICT === "1";
const summaryOnly = process.argv.includes("--summary-only");
const monitoringLaunchGates = ["G9"];
const monitoringLaunchGateGroups = "monitoring=1";
const MAX_MONITORING_ARTIFACT_TEXT_BYTES = 256 * 1024;
const MAX_MONITORING_PROOF_MANIFEST_BYTES = 512 * 1024;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const args = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--") && arg.includes("="))
    .map((arg) => {
      const [key, ...rest] = arg.slice(2).split("=");
      return [key, rest.join("=")];
    }),
);

function launchGateSummary(issueCount) {
  const label = issueCount > 0 ? "blocked" : "covered";
  return `${label} gates: ${monitoringLaunchGates.join(", ")}; groups: ${monitoringLaunchGateGroups}`;
}

const requiredKinds = [
  "health-prod",
  "data-sync",
  "stale-indexer-heartbeat",
  "indexer-lag",
  "bot-restart",
  "indexer-restart",
  "reverted-tx",
];
const okStatuses = new Set(["ok", "pass", "passed", "success", "healthy"]);
const allowedAlertTargetKinds = new Set([
  "pager",
  "pagerduty",
  "opsgenie",
  "slack",
  "discord",
  "telegram",
  "email",
  "sms",
  "chat",
  "incident",
]);
const TEMPLATE_VALUE_RE = /REPLACE_|<REDACTED>|TODO|TBD/i;
const secretKeyPattern = /(secret|private[_-]?key|mnemonic|webhook|dsn|api[_-]?key|api[_-]?token|auth[_-]?token|access[_-]?token|bearer)/i;

function env(name) {
  return process.env[name]?.trim() || "";
}

function argOrEnv(argName, envName, fallback) {
  return args.get(argName)?.trim() || env(envName) || fallback;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasRealText(value) {
  return hasText(value) && !TEMPLATE_VALUE_RE.test(value);
}

function isEmailAddress(value) {
  return typeof value === "string" &&
    /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value.trim());
}

function normalizeDomain(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/^\*\./, "")
    .replace(/^www\./, "");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function originEmailDomains(manifest) {
  try {
    const host = normalizeDomain(new URL(String(manifest?.origin ?? "")).hostname);
    return host ? [host] : [];
  } catch {
    return [];
  }
}

function hasConcreteText(value) {
  if (!hasRealText(value)) return false;
  const text = String(value).trim();
  return hasPublicHttpsUrl(text) ||
    /(?:^|[\\/\s])[^\s]+\.(?:json|jsonl|log|md|txt|csv|png|jpg|jpeg|webp)(?:\b|$)/i.test(text) ||
    /\b(?:INC|PD|DD|NR|SENTRY|EVT|ALERT)[-_]?[a-z0-9]{4,}\b/i.test(text) ||
    /\b[a-f0-9]{16,64}\b/i.test(text);
}

function asPositiveSafeInteger(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? value : null;
  const normalized = String(value ?? "").trim();
  if (!/^(?:[1-9]\d{0,15})$/.test(normalized)) return null;
  const parsed = BigInt(normalized);
  return parsed <= MAX_SAFE_INTEGER_BIGINT ? Number(parsed) : null;
}

function localArtifactPathFromText(value, key = "") {
  if (!hasRealText(value)) return "";
  const text = String(value).trim().replace(/^`|`$/g, "");
  if (/^https?:\/\//i.test(text)) return "";
  const artifactMatch = text.match(/^artifact:\s*(\S+)/i);
  const candidate = (artifactMatch ? artifactMatch[1] : text).trim().replace(/^`|`$/g, "").replace(/[),.;]+$/g, "");
  if (/^https?:\/\//i.test(candidate)) return "";
  const keySuggestsPath = /(?:evidencePath|artifact|link)$/i.test(key);
  const valueLooksLikePath = /(?:^|[\\/\s])[^\s]+\.(?:json|jsonl|log|md|txt|csv|png|jpg|jpeg|webp)(?:\b|$)/i.test(candidate);
  return (artifactMatch || keySuggestsPath) && valueLooksLikePath ? candidate : "";
}

function regularFileStat(filePath) {
  try {
    const stats = statSync(filePath);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
}

function localArtifactIsFile(artifactPath) {
  return regularFileStat(resolve(process.cwd(), artifactPath)) !== null;
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

function localArtifactPathsFromEntries(entries) {
  return entries.map(([key, value]) => localArtifactPathFromText(value, key)).filter(Boolean);
}

function normalizedArtifactPathSet(entries) {
  return new Set(localArtifactPathsFromEntries(entries).map((artifactPath) => resolve(process.cwd(), artifactPath).toLowerCase()));
}

function sharedLocalArtifactPaths(leftEntries, rightEntries) {
  const left = normalizedArtifactPathSet(leftEntries);
  const right = normalizedArtifactPathSet(rightEntries);
  return [...left].filter((artifactPath) => right.has(artifactPath));
}

function sharedMonitoringSectionArtifactIssues(manifest) {
  const groups = [
    [
      "monitors",
      asArray(manifest.monitors).flatMap((monitor) => [
        ["link", monitor?.link],
        ["evidence", monitor?.evidence],
        ["evidencePath", monitor?.evidencePath],
        ["artifact", monitor?.artifact],
        ["notes", monitor?.notes],
        ["recoveryLink", monitor?.recoveryLink],
        ["recoveryEvidence", monitor?.recoveryEvidence],
        ["recoveryEvidencePath", monitor?.recoveryEvidencePath],
        ["resolvedAlertLink", monitor?.resolvedAlertLink],
        ["resolutionLink", monitor?.resolutionLink],
        ["recoveryNotes", monitor?.recoveryNotes],
      ]),
    ],
    [
      "alertTargets",
      asArray(manifest.alertTargets).flatMap((target) => [
        ["link", target?.link],
        ["evidence", target?.evidence],
        ["evidencePath", target?.evidencePath],
        ["artifact", target?.artifact],
        ["notes", target?.notes],
      ]),
    ],
    [
      "errorTracking",
      isPlainObject(manifest.errorTracking)
        ? [
            ["testEventLink", manifest.errorTracking.testEventLink],
            ["testEventEvidence", manifest.errorTracking.testEventEvidence],
            ["testEventEvidencePath", manifest.errorTracking.testEventEvidencePath],
            ["testEventArtifact", manifest.errorTracking.testEventArtifact],
            ["artifact", manifest.errorTracking.artifact],
          ]
        : [],
    ],
  ].map(([name, entries]) => [name, normalizedArtifactPathSet(entries)]);
  const issues = [];
  for (let leftIndex = 0; leftIndex < groups.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < groups.length; rightIndex += 1) {
      const [leftName, leftArtifacts] = groups[leftIndex];
      const [rightName, rightArtifacts] = groups[rightIndex];
      if ([...leftArtifacts].some((artifactPath) => rightArtifacts.has(artifactPath))) {
        issues.push(`monitoring evidence sections must use distinct local artifact files across ${leftName} and ${rightName}`);
      }
    }
  }
  return issues;
}

function readBoundedArtifactText(resolved) {
  const fd = openSync(resolved, "r");
  try {
    const buffer = Buffer.alloc(MAX_MONITORING_ARTIFACT_TEXT_BYTES);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function artifactBackedText(entries) {
  const chunks = [compactEvidenceText(entries.map(([, value]) => value))];
  for (const artifactPath of localArtifactPathsFromEntries(entries)) {
    const resolved = resolve(process.cwd(), artifactPath);
    if (!localArtifactIsFile(artifactPath)) continue;
    chunks.push(readBoundedArtifactText(resolved));
  }
  return chunks.join("\n");
}

function monitorAlertProof(monitor) {
  const text = artifactBackedText([
    ["link", monitor.link],
    ["evidence", monitor.evidence],
    ["evidencePath", monitor.evidencePath],
    ["artifact", monitor.artifact],
    ["notes", monitor.notes],
  ]);
  return /\b(?:alert|fired|triggered|monitor|incident)\b/i.test(text);
}

function monitorRecoveryProof(monitor) {
  const text = artifactBackedText([
    ["recoveryLink", monitor.recoveryLink],
    ["recoveryEvidence", monitor.recoveryEvidence],
    ["recoveryEvidencePath", monitor.recoveryEvidencePath],
    ["resolvedAlertLink", monitor.resolvedAlertLink],
    ["resolutionLink", monitor.resolutionLink],
    ["recoveryNotes", monitor.recoveryNotes],
  ]);
  return /\b(?:recovery|recovered|resolved|resolution)\b/i.test(text);
}

function alertTargetProof(target) {
  const text = artifactBackedText([
    ["link", target.link],
    ["evidence", target.evidence],
    ["evidencePath", target.evidencePath],
    ["artifact", target.artifact],
    ["notes", target.notes],
  ]);
  return /\b(?:alert\s+target|notification|slack|pagerduty|opsgenie|discord|telegram|email|sms|incident)\b/i.test(text);
}

function emailAlertTargetProof(target) {
  const text = artifactBackedText([
    ["name", target.name],
    ["link", target.link],
    ["evidence", target.evidence],
    ["evidencePath", target.evidencePath],
    ["artifact", target.artifact],
    ["notes", target.notes],
  ]);
  return /\b(?:email|resend|recipient|inbox|message[-\s]?id|delivered|delivery)\b/i.test(text);
}

function emailAlertTargetRecipientProof(target) {
  const explicitRecipients = [
    target.recipient,
    target.email,
    target.address,
    target.to,
    target.target,
    ...(Array.isArray(target.recipients) ? target.recipients : []),
  ];
  if (explicitRecipients.some(isEmailAddress)) return true;
  const text = artifactBackedText([
    ["name", target.name],
    ["link", target.link],
    ["evidence", target.evidence],
    ["evidencePath", target.evidencePath],
    ["artifact", target.artifact],
    ["notes", target.notes],
  ]);
  return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text);
}

function senderFieldMatchesDomain(value, domains) {
  if (!hasRealText(value)) return false;
  const text = String(value).trim();
  if (isEmailAddress(text)) {
    const domain = normalizeDomain(text.split("@").pop());
    return domains.includes(domain);
  }
  const domain = normalizeDomain(text);
  return domains.includes(domain);
}

function emailAlertTargetSenderDomainProof(target, manifest) {
  const domains = originEmailDomains(manifest);
  if (domains.length === 0) return false;
  const explicitSenderFields = [
    target.sender,
    target.from,
    target.emailFrom,
    target.senderEmail,
    target.senderDomain,
    target.domain,
    target.verifiedDomain,
  ];
  if (explicitSenderFields.some((value) => senderFieldMatchesDomain(value, domains))) return true;
  const text = artifactBackedText([
    ["name", target.name],
    ["link", target.link],
    ["evidence", target.evidence],
    ["evidencePath", target.evidencePath],
    ["artifact", target.artifact],
    ["notes", target.notes],
  ]);
  return domains.some((domain) => {
    const domainPattern = escapeRegExp(domain);
    return new RegExp(`\\b(?:resend|sender|from|verified\\s+domain|domain\\s+verified)[\\s\\S]{0,160}\\b${domainPattern}\\b`, "i").test(text) ||
      new RegExp(`\\b${domainPattern}\\b[\\s\\S]{0,160}\\b(?:resend|sender|from|verified\\s+domain|domain\\s+verified)\\b`, "i").test(text);
  });
}

function errorTrackingEventProof(errorTracking) {
  const text = artifactBackedText([
    ["testEventLink", errorTracking.testEventLink],
    ["testEventEvidence", errorTracking.testEventEvidence],
    ["testEventEvidencePath", errorTracking.testEventEvidencePath],
    ["testEventArtifact", errorTracking.testEventArtifact],
    ["artifact", errorTracking.artifact],
  ]);
  return /\b(?:sentry|datadog|newrelic|error|exception|event|issue|test\s+event)\b/i.test(text);
}
function statusOk(value) {
  return okStatuses.has(String(value ?? "").trim().toLowerCase());
}

function printTable(headers, rows) {
  console.log(`| ${headers.join(" | ")} |`);
  console.log(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}

function fileSummaryStatus(filePath) {
  return regularFileStat(filePath) ? "present" : "missing";
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

function compactEvidenceText(values) {
  return values.filter(hasRealText).map((value) => String(value).trim()).join("\n");
}

function monitorEvidence(monitor) {
  return [
    monitor.link,
    monitor.evidence,
    monitor.evidencePath,
    monitor.artifact,
    monitor.notes,
  ].some(hasConcreteText);
}

function alertTargetEvidence(target) {
  return [target.link, target.evidence, target.evidencePath, target.artifact, target.notes].some(hasConcreteText);
}

function errorTrackingTestEventEvidence(errorTracking) {
  return [
    errorTracking.testEventLink,
    errorTracking.testEventEvidence,
    errorTracking.testEventEvidencePath,
    errorTracking.testEventArtifact,
    errorTracking.artifact,
    errorTracking.testEventId,
  ].some(hasConcreteText);
}

function alertTargetKindOk(target) {
  return allowedAlertTargetKinds.has(String(target.kind ?? "").trim().toLowerCase());
}

function verifiedEmailAlertTarget(target, manifest) {
  return String(target?.kind ?? "").trim().toLowerCase() === "email" &&
    target?.verified === true &&
    [target.lastTestAt, target.testAlertAt].some(hasNonFutureIsoTimestamp) &&
    alertTargetEvidence(target) &&
    emailAlertTargetProof(target) &&
    emailAlertTargetRecipientProof(target) &&
    emailAlertTargetSenderDomainProof(target, manifest);
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

function hasNonFutureIsoTimestamp(value) {
  if (!hasIsoTimestamp(value)) return false;
  return Date.parse(String(value).trim()) <= Date.now() + 5 * 60 * 1000;
}

function firstAlertTimestamp(monitor) {
  return [monitor.lastAlertTestAt, monitor.lastTestAt, monitor.testAlertAt].find(hasRealText);
}

function monitorHasAlertTest(monitor) {
  return Boolean(firstAlertTimestamp(monitor));
}

function monitorHasIsoAlertTest(monitor) {
  return [monitor.lastAlertTestAt, monitor.lastTestAt, monitor.testAlertAt].some(hasIsoTimestamp);
}

function monitorHasNonFutureAlertTest(monitor) {
  return [monitor.lastAlertTestAt, monitor.lastTestAt, monitor.testAlertAt].some(hasNonFutureIsoTimestamp);
}

function monitorRecoveryEvidence(monitor) {
  return [
    monitor.recoveryLink,
    monitor.recoveryEvidence,
    monitor.recoveryEvidencePath,
    monitor.resolvedAlertLink,
    monitor.resolutionLink,
    monitor.recoveryNotes,
  ].some(hasConcreteText);
}

function monitorHasRecoveryTest(monitor) {
  return [monitor.lastRecoveryAt, monitor.lastResolvedAt, monitor.recoveryAt, monitor.resolvedAt].some(hasRealText);
}

function monitorHasIsoRecoveryTest(monitor) {
  return [monitor.lastRecoveryAt, monitor.lastResolvedAt, monitor.recoveryAt, monitor.resolvedAt].some(hasIsoTimestamp);
}

function monitorHasNonFutureRecoveryTest(monitor) {
  return [monitor.lastRecoveryAt, monitor.lastResolvedAt, monitor.recoveryAt, monitor.resolvedAt].some(hasNonFutureIsoTimestamp);
}

function monitorHasAlertCondition(monitor) {
  return hasRealText(monitor.alertCondition) || hasRealText(monitor.threshold);
}

function monitorAlertRecoveryIssues(monitor, label) {
  const issues = [];
  const alertEntries = [
    ["link", monitor.link],
    ["evidence", monitor.evidence],
    ["evidencePath", monitor.evidencePath],
    ["artifact", monitor.artifact],
    ["notes", monitor.notes],
  ];
  const recoveryEntries = [
    ["recoveryLink", monitor.recoveryLink],
    ["recoveryEvidence", monitor.recoveryEvidence],
    ["recoveryEvidencePath", monitor.recoveryEvidencePath],
    ["resolvedAlertLink", monitor.resolvedAlertLink],
    ["resolutionLink", monitor.resolutionLink],
    ["recoveryNotes", monitor.recoveryNotes],
  ];
  const alertEvidence = compactEvidenceText(alertEntries.map(([, value]) => value));
  const recoveryEvidence = compactEvidenceText(recoveryEntries.map(([, value]) => value));
  if (alertEvidence && recoveryEvidence && alertEvidence === recoveryEvidence) {
    issues.push(`${label} fired-alert evidence must be distinct from recovery evidence`);
  }
  if (sharedLocalArtifactPaths(alertEntries, recoveryEntries).length > 0) {
    issues.push(`${label} fired-alert and recovery evidence must use distinct artifact files`);
  }
  const alertAt = firstAlertTimestamp(monitor);
  const recoveryAt = [monitor.lastRecoveryAt, monitor.lastResolvedAt, monitor.recoveryAt, monitor.resolvedAt].find(hasRealText);
  if (hasIsoTimestamp(alertAt) && hasIsoTimestamp(recoveryAt) && Date.parse(recoveryAt) < Date.parse(alertAt)) {
    issues.push(`${label} recovery timestamp must not be before fired-alert timestamp`);
  }
  return issues;
}

function monitorComplete(monitor) {
  return monitor?.enabled === true &&
    hasRealText(monitor.provider) &&
    monitorHasAlertCondition(monitor) &&
    monitorEvidence(monitor) &&
    monitorHasNonFutureAlertTest(monitor) &&
    monitorRecoveryEvidence(monitor) &&
    monitorHasNonFutureRecoveryTest(monitor);
}

function normalizeOrigin(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    if (url.username || url.password) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function parseUrl(value) {
  try {
    return new URL(String(value ?? "").trim());
  } catch {
    return null;
  }
}

function requireDataSyncUrl(monitor, label, origin, issues) {
  const dataSyncUrl = parseUrl(monitor?.url);
  if (!dataSyncUrl || dataSyncUrl.protocol !== "https:" || dataSyncUrl.username || dataSyncUrl.password) {
    issues.push(`${label} monitor must record the monitored HTTPS URL`);
    return;
  }
  if (origin && dataSyncUrl.origin !== origin) {
    issues.push(`${label} monitor URL must match monitoring proof origin`);
  }
  if (dataSyncUrl.pathname !== "/api/health/data-sync") {
    issues.push(`${label} monitor URL must target /api/health/data-sync`);
  }
}

function requireRuntimeHealthUrl(monitor, label, origin, issues) {
  const runtimeUrl = parseUrl(monitor?.url);
  if (!runtimeUrl || runtimeUrl.protocol !== "https:" || runtimeUrl.username || runtimeUrl.password) {
    issues.push(`${label} monitor must record the monitored HTTPS URL`);
    return;
  }
  if (origin && runtimeUrl.origin !== origin) {
    issues.push(`${label} monitor URL must match monitoring proof origin`);
  }
  if (runtimeUrl.pathname !== "/api/health/runtime") {
    issues.push(`${label} monitor URL must target /api/health/runtime`);
  }
}

const manifestPath = resolve(process.cwd(), argOrEnv("file", "MONITORING_PROOF_PATH", "docs/monitoring-proof.json"));
const issues = [];
let manifest = null;

console.log("# Monitoring Proof Summary");
console.log("");
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log(`Strict: ${strict ? "yes" : "no"}`);
console.log(`Manifest: ${summaryOnly ? fileSummaryStatus(manifestPath) : manifestPath}`);
console.log("");

if (strict && /\.draft\.json$/i.test(manifestPath)) {
  issues.push("draft proof manifests are not accepted as launch proof");
}

const manifestStat = regularFileStat(manifestPath);
if (!existsSync(manifestPath)) {
  issues.push("monitoring proof manifest is missing");
} else if (!manifestStat) {
  issues.push("monitoring proof manifest must be a file");
} else {
  if (manifestStat.size > MAX_MONITORING_PROOF_MANIFEST_BYTES) {
    issues.push("monitoring proof manifest is too large to validate safely");
  } else {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      issues.push(`monitoring proof manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

if (manifest) {
  if (!isPlainObject(manifest)) issues.push("monitoring proof manifest must be an object");
  const origin = manifest.origin;
  const monitors = asArray(manifest.monitors);
  const alertTargets = asArray(manifest.alertTargets);
  const errorTracking = isPlainObject(manifest.errorTracking) ? manifest.errorTracking : null;
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
    issues.push(`local monitoring artifact references must exist: ${formatMissingLocalArtifactRefs(missingArtifactRefs)}`);
  }
  issues.push(...sharedMonitoringSectionArtifactIssues(manifest));
  const normalizedOrigin = normalizeOrigin(origin);
  if (!hasRealText(origin) || !isFinalHttpsOrigin(origin) || !normalizedOrigin) {
    issues.push("origin must be a final public HTTPS origin without path, query, or hash");
  }
  const expectedOrigin = env("NEXT_PUBLIC_SITE_URL") || env("PUBLIC_SITE_URL") || env("SITE_URL");
  if (expectedOrigin && normalizedOrigin && normalizeOrigin(expectedOrigin) !== normalizedOrigin) {
    issues.push("origin must match configured production origin");
  }

  for (const kind of requiredKinds) {
    const matching = monitors.filter((monitor) => monitor?.kind === kind);
    if (matching.length === 0) {
      issues.push(`missing monitor kind ${kind}`);
      continue;
    }
    const enabled = matching.some((monitor) => monitor.enabled === true);
    if (!enabled) issues.push(`monitor kind ${kind} is not enabled`);
    const hasEvidence = matching.some(monitorEvidence);
    if (!hasEvidence) issues.push(`monitor kind ${kind} has no monitor evidence link, artifact, or note`);
    const hasAlertTest = matching.some(monitorHasAlertTest);
    if (!hasAlertTest) issues.push(`monitor kind ${kind} has no alert test timestamp`);
    if (hasAlertTest && !matching.some(monitorHasIsoAlertTest)) {
      issues.push(`monitor kind ${kind} alert test timestamp must be ISO-8601 UTC`);
    }
    if (matching.some(monitorHasIsoAlertTest) && !matching.some(monitorHasNonFutureAlertTest)) {
      issues.push(`monitor kind ${kind} alert test timestamp must not be in the future`);
    }
    const hasRecoveryEvidence = matching.some(monitorRecoveryEvidence);
    if (!hasRecoveryEvidence) issues.push(`monitor kind ${kind} has no recovery or resolution evidence`);
    const hasRecoveryTest = matching.some(monitorHasRecoveryTest);
    if (!hasRecoveryTest) issues.push(`monitor kind ${kind} has no recovery or resolution timestamp`);
    if (hasRecoveryTest && !matching.some(monitorHasIsoRecoveryTest)) {
      issues.push(`monitor kind ${kind} recovery or resolution timestamp must be ISO-8601 UTC`);
    }
    if (matching.some(monitorHasIsoRecoveryTest) && !matching.some(monitorHasNonFutureRecoveryTest)) {
      issues.push(`monitor kind ${kind} recovery or resolution timestamp must not be in the future`);
    }
    const hasAlertCondition = matching.some(monitorHasAlertCondition);
    if (!hasAlertCondition) issues.push(`monitor kind ${kind} has no alert condition or threshold`);
    const hasProvider = matching.some((monitor) => hasRealText(monitor.provider));
    if (!hasProvider) issues.push(`monitor kind ${kind} has no provider`);
    if (!matching.some(monitorComplete)) {
      issues.push(`monitor kind ${kind} must have one enabled monitor with provider, condition, fired-alert evidence, recovery evidence, and ISO timestamps`);
    }
    for (const monitor of matching.filter((entry) => entry?.enabled === true)) {
      issues.push(...monitorAlertRecoveryIssues(monitor, `monitor kind ${kind}`));
      if (monitorEvidence(monitor) && !monitorAlertProof(monitor)) {
        issues.push(`monitor kind ${kind} fired-alert evidence must mention alert, monitor, fired, triggered, or incident proof`);
      }
      if (monitorRecoveryEvidence(monitor) && !monitorRecoveryProof(monitor)) {
        issues.push(`monitor kind ${kind} recovery evidence must mention recovery, recovered, resolved, or resolution proof`);
      }
    }
  }

  const healthMonitor = monitors.find((monitor) => monitor?.kind === "health-prod");
  if (healthMonitor) {
    const cadence = healthMonitor.cadenceSeconds ?? healthMonitor.intervalSeconds;
    const cadenceSeconds = asPositiveSafeInteger(cadence);
    if (cadenceSeconds == null) issues.push("health-prod monitor cadence must be a canonical positive integer");
    if (cadenceSeconds != null && cadenceSeconds > 60) {
      issues.push("health-prod monitor cadence must be 60s or less for launch proof");
    }
    if (!hasRealText(healthMonitor.command) && !hasRealText(healthMonitor.url)) {
      issues.push("health-prod monitor must record command or URL");
    }
    if (hasRealText(healthMonitor.url)) {
      requireRuntimeHealthUrl(healthMonitor, "health-prod", normalizedOrigin, issues);
    } else {
      issues.push("health-prod monitor must record the monitored HTTPS URL");
    }
  }

  const dataSyncMonitor = monitors.find((monitor) => monitor?.kind === "data-sync");
  if (dataSyncMonitor) {
    requireDataSyncUrl(dataSyncMonitor, "data-sync", normalizedOrigin, issues);
  }

  for (const kind of ["stale-indexer-heartbeat", "indexer-lag"]) {
    const monitor = monitors.find((entry) => entry?.kind === kind);
    if (monitor) {
      requireDataSyncUrl(monitor, kind, normalizedOrigin, issues);
    }
  }

  if (alertTargets.length === 0) {
    issues.push("no alert targets recorded");
  } else if (!alertTargets.some((target) => target.verified === true && [target.lastTestAt, target.testAlertAt].some(hasNonFutureIsoTimestamp) && alertTargetEvidence(target))) {
    issues.push("no verified alert target with ISO timestamp and concrete evidence recorded");
  }
  if (!alertTargets.some((target) => verifiedEmailAlertTarget(target, manifest))) {
    issues.push("no verified email alert target with ISO timestamp, concrete evidence, recipient, and sender domain proof recorded");
  }
  for (const [index, target] of alertTargets.entries()) {
    if (target.verified !== true) {
      issues.push(`alertTargets[${index}].verified must be true after a real alert target test`);
    }
    if (!alertTargetKindOk(target)) {
      issues.push(`alertTargets[${index}].kind must be a concrete alert channel`);
    }
    if (![target.lastTestAt, target.testAlertAt].some(hasIsoTimestamp)) {
      issues.push(`alertTargets[${index}] test timestamp must be ISO-8601 UTC`);
    }
    if ([target.lastTestAt, target.testAlertAt].some(hasIsoTimestamp) && ![target.lastTestAt, target.testAlertAt].some(hasNonFutureIsoTimestamp)) {
      issues.push(`alertTargets[${index}] test timestamp must not be in the future`);
    }
    if (!alertTargetEvidence(target)) {
      issues.push(`alertTargets[${index}] must include evidence or link for the fired test alert`);
    }
    if (alertTargetEvidence(target) && !alertTargetProof(target)) {
      issues.push(`alertTargets[${index}] evidence must mention alert target or notification channel proof`);
    }
    if (String(target.kind ?? "").trim().toLowerCase() === "email" && alertTargetEvidence(target) && !emailAlertTargetProof(target)) {
      issues.push(`alertTargets[${index}] email evidence must mention email, Resend, recipient, inbox, message id, or delivery proof`);
    }
    if (String(target.kind ?? "").trim().toLowerCase() === "email" && !emailAlertTargetRecipientProof(target)) {
      issues.push(`alertTargets[${index}] email target must record the recipient address or recipient evidence`);
    }
    if (String(target.kind ?? "").trim().toLowerCase() === "email" && !emailAlertTargetSenderDomainProof(target, manifest)) {
      issues.push(`alertTargets[${index}] email target must record a verified sender or domain matching the proof origin`);
    }
  }

  if (!errorTracking) {
    issues.push("errorTracking section is missing");
  } else {
    if (errorTracking.enabled !== true) issues.push("error tracking is not marked enabled");
    if (!hasRealText(errorTracking.provider)) issues.push("error tracking provider is missing");
    if (!hasRealText(errorTracking.project) && !hasRealText(errorTracking.link)) {
      issues.push("error tracking project/link is missing");
    }
    if (!hasRealText(errorTracking.environment)) issues.push("error tracking environment is missing");
    if (!hasRealText(errorTracking.releaseOrDeploy)) issues.push("error tracking releaseOrDeploy is missing");
    if (!statusOk(errorTracking.testEventStatus) && !hasRealText(errorTracking.testEventAt)) {
      issues.push("error tracking test event is missing");
    } else if (!hasIsoTimestamp(errorTracking.testEventAt)) {
      issues.push("error tracking test event timestamp must be ISO-8601 UTC");
    } else if (!hasNonFutureIsoTimestamp(errorTracking.testEventAt)) {
      issues.push("error tracking test event timestamp must not be in the future");
    }
    if (!errorTrackingTestEventEvidence(errorTracking)) {
      issues.push("error tracking test event must include event id, link, or redacted evidence");
    }
    if (errorTrackingTestEventEvidence(errorTracking) && !errorTrackingEventProof(errorTracking)) {
      issues.push("error tracking test event evidence must mention error, exception, event, issue, or provider proof");
    }
  }

  if (summaryOnly) {
    const enabledMonitorCount = monitors.filter((monitor) => monitor?.enabled === true).length;
    const verifiedTargetCount = alertTargets.filter((target) =>
      target?.verified === true && [target.lastTestAt, target.testAlertAt].some(hasNonFutureIsoTimestamp)
    ).length;
    const verifiedEmailTargetCount = alertTargets.filter((target) => verifiedEmailAlertTarget(target, manifest)).length;
    console.log(`Monitors: ${enabledMonitorCount}/${requiredKinds.length} enabled`);
    console.log(`Alert targets: ${verifiedTargetCount}/${alertTargets.length} verified`);
    console.log(`Email alert targets: ${verifiedEmailTargetCount} verified`);
    console.log(`Error tracking: ${errorTracking?.enabled === true ? "enabled" : "issue"}`);
  } else {
    const monitorRows = monitors.map((monitor) => [
      String(monitor.kind ?? "missing"),
      monitor.enabled === true ? "yes" : "no",
      String(monitor.provider ?? "missing"),
      String(monitor.cadenceSeconds ?? monitor.intervalSeconds ?? "missing"),
      monitorEvidence(monitor) ? "yes" : "no",
      monitorHasAlertTest(monitor) ? "yes" : "no",
      monitorHasRecoveryTest(monitor) ? "yes" : "no",
    ]);

    console.log("## Monitors");
    console.log(`Origin: ${String(origin ?? "missing")}`);
    console.log("");
    printTable(["Kind", "Enabled", "Provider", "Cadence seconds", "Evidence", "Alert Test", "Recovery"], monitorRows);
    console.log("");
    console.log("## Alert Targets");
    printTable(
      ["Name", "Kind", "Verified"],
      alertTargets.map((target) => [
        String(target.name ?? "missing"),
        String(target.kind ?? "missing"),
        target.verified === true || hasRealText(target.lastTestAt) || hasRealText(target.testAlertAt) ? "yes" : "no",
      ]),
    );
    console.log("");
    console.log("## Error Tracking");
    printTable(["Field", "Value"], [
      ["provider", String(errorTracking?.provider ?? "missing")],
      ["enabled", errorTracking?.enabled === true ? "yes" : "no"],
      ["project/link", hasRealText(errorTracking?.project) || hasRealText(errorTracking?.link) ? "yes" : "no"],
      ["environment", hasRealText(errorTracking?.environment) ? "yes" : "no"],
      ["release/deploy", hasRealText(errorTracking?.releaseOrDeploy) ? "yes" : "no"],
      ["test event", statusOk(errorTracking?.testEventStatus) || hasRealText(errorTracking?.testEventAt) ? "yes" : "no"],
      ["test event evidence", errorTracking ? (errorTrackingTestEventEvidence(errorTracking) ? "yes" : "no") : "no"],
    ]);
  }
}

console.log("");
console.log(`Summary: ${issues.length === 0 ? "monitoring proof completed without detected issues" : `${issues.length} issue(s): ${issues.join("; ")}`}; ${launchGateSummary(issues.length)}.`);
console.log("Copy this summary into `docs/mainnet-proof-record.md` only after confirming the manifest reflects deployed external monitors and a real test alert.");

if (strict && issues.length > 0) {
  process.exitCode = 1;
}
