import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const strict = process.argv.includes("--strict") || process.env.PROOF_STRICT === "1";
const args = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--") && arg.includes("="))
    .map((arg) => {
      const [key, ...rest] = arg.slice(2).split("=");
      return [key, rest.join("=")];
    }),
);

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

function hasConcreteText(value) {
  if (!hasRealText(value)) return false;
  const text = String(value).trim();
  return /https?:\/\//i.test(text) ||
    /(?:^|[\\/\s])[^\s]+\.(?:json|jsonl|log|md|txt|csv|png|jpg|jpeg|webp)(?:\b|$)/i.test(text) ||
    /\b(?:sentry|datadog|newrelic|grafana|pagerduty|opsgenie|slack|discord|telegram|incident|alert|monitor|recovery|resolved)\b/i.test(text) ||
    /\b(?:INC|PD|DD|NR|SENTRY|EVT|ALERT)[-_]?[a-z0-9]{4,}\b/i.test(text) ||
    /\b[a-f0-9]{16,64}\b/i.test(text);
}

function isPositiveNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
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
  return keySuggestsPath && valueLooksLikePath ? candidate : "";
}

function findMissingLocalArtifactRefs(value, path = "$", key = "") {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findings.push(...findMissingLocalArtifactRefs(entry, `${path}[${index}]`, key)));
    return findings;
  }
  if (typeof value === "string") {
    const artifactPath = localArtifactPathFromText(value, key);
    if (artifactPath && !existsSync(resolve(process.cwd(), artifactPath))) {
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

function localArtifactPathsFromEntries(entries) {
  return entries.map(([key, value]) => localArtifactPathFromText(value, key)).filter(Boolean);
}

function artifactBackedText(entries) {
  const chunks = [compactEvidenceText(entries.map(([, value]) => value))];
  for (const artifactPath of localArtifactPathsFromEntries(entries)) {
    const resolved = resolve(process.cwd(), artifactPath);
    if (!existsSync(resolved)) continue;
    chunks.push(readFileSync(resolved, "utf8").slice(0, 256 * 1024));
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
    ["notes", target.notes],
  ]);
  return /\b(?:alert\s+target|notification|slack|pagerduty|opsgenie|discord|telegram|email|sms|incident)\b/i.test(text);
}

function errorTrackingEventProof(errorTracking) {
  const text = artifactBackedText([
    ["testEventLink", errorTracking.testEventLink],
    ["testEventEvidence", errorTracking.testEventEvidence],
    ["testEventEvidencePath", errorTracking.testEventEvidencePath],
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

function monitorAlertEvidenceText(monitor) {
  return compactEvidenceText([
    monitor.link,
    monitor.evidence,
    monitor.evidencePath,
    monitor.artifact,
    monitor.notes,
  ]);
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
  return [target.link, target.evidence, target.evidencePath, target.notes].some(hasConcreteText);
}

function errorTrackingTestEventEvidence(errorTracking) {
  return [
    errorTracking.testEventLink,
    errorTracking.testEventEvidence,
    errorTracking.testEventEvidencePath,
    errorTracking.testEventId,
  ].some(hasConcreteText);
}

function alertTargetKindOk(target) {
  return allowedAlertTargetKinds.has(String(target.kind ?? "").trim().toLowerCase());
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

function firstAlertTimestamp(monitor) {
  return [monitor.lastAlertTestAt, monitor.lastTestAt, monitor.testAlertAt].find(hasRealText);
}

function monitorHasAlertTest(monitor) {
  return Boolean(firstAlertTimestamp(monitor));
}

function monitorHasIsoAlertTest(monitor) {
  return [monitor.lastAlertTestAt, monitor.lastTestAt, monitor.testAlertAt].some(hasIsoTimestamp);
}

function monitorRecoveryEvidenceText(monitor) {
  return compactEvidenceText([
    monitor.recoveryLink,
    monitor.recoveryEvidence,
    monitor.recoveryEvidencePath,
    monitor.resolvedAlertLink,
    monitor.resolutionLink,
    monitor.recoveryNotes,
  ]);
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

function monitorHasAlertCondition(monitor) {
  return hasRealText(monitor.alertCondition) || hasRealText(monitor.threshold);
}

function monitorAlertRecoveryIssues(monitor, label) {
  const issues = [];
  const alertEvidence = monitorAlertEvidenceText(monitor);
  const recoveryEvidence = monitorRecoveryEvidenceText(monitor);
  if (alertEvidence && recoveryEvidence && alertEvidence === recoveryEvidence) {
    issues.push(`${label} fired-alert evidence must be distinct from recovery evidence`);
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
    monitorHasIsoAlertTest(monitor) &&
    monitorRecoveryEvidence(monitor) &&
    monitorHasIsoRecoveryTest(monitor);
}

function normalizeOrigin(value) {
  try {
    return new URL(String(value ?? "").trim()).origin;
  } catch {
    return "";
  }
}

function isFinalHttpsOrigin(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      !["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host) &&
      !host.endsWith(".local");
  } catch {
    return false;
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
  if (!dataSyncUrl || dataSyncUrl.protocol !== "https:") {
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
  if (!runtimeUrl || runtimeUrl.protocol !== "https:") {
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
console.log(`Manifest: ${manifestPath}`);
console.log("");

if (strict && /\.draft\.json$/i.test(manifestPath)) {
  issues.push("draft proof manifests are not accepted as launch proof");
}

if (!existsSync(manifestPath)) {
  issues.push("monitoring proof manifest is missing");
} else {
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    issues.push(`monitoring proof manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
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
    issues.push(`local monitoring artifact references must exist: ${missingArtifactRefs.slice(0, 5).join(", ")}`);
  }
  const normalizedOrigin = normalizeOrigin(origin);
  if (!hasRealText(origin) || !isFinalHttpsOrigin(origin) || !normalizedOrigin) {
    issues.push("origin must be a final HTTPS origin without path, query, or hash");
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
    const hasRecoveryEvidence = matching.some(monitorRecoveryEvidence);
    if (!hasRecoveryEvidence) issues.push(`monitor kind ${kind} has no recovery or resolution evidence`);
    const hasRecoveryTest = matching.some(monitorHasRecoveryTest);
    if (!hasRecoveryTest) issues.push(`monitor kind ${kind} has no recovery or resolution timestamp`);
    if (hasRecoveryTest && !matching.some(monitorHasIsoRecoveryTest)) {
      issues.push(`monitor kind ${kind} recovery or resolution timestamp must be ISO-8601 UTC`);
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
    if (!isPositiveNumber(cadence)) issues.push("health-prod monitor cadence is missing");
    if (isPositiveNumber(cadence) && Number(cadence) > 60) {
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
  } else if (!alertTargets.some((target) => target.verified === true && [target.lastTestAt, target.testAlertAt].some(hasIsoTimestamp) && alertTargetEvidence(target))) {
    issues.push("no verified alert target with ISO timestamp and concrete evidence recorded");
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
    if (!alertTargetEvidence(target)) {
      issues.push(`alertTargets[${index}] must include evidence or link for the fired test alert`);
    }
    if (alertTargetEvidence(target) && !alertTargetProof(target)) {
      issues.push(`alertTargets[${index}] evidence must mention alert target or notification channel proof`);
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
    }
    if (!errorTrackingTestEventEvidence(errorTracking)) {
      issues.push("error tracking test event must include event id, link, or redacted evidence");
    }
    if (errorTrackingTestEventEvidence(errorTracking) && !errorTrackingEventProof(errorTracking)) {
      issues.push("error tracking test event evidence must mention error, exception, event, issue, or provider proof");
    }
  }

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

console.log("");
console.log(`Summary: ${issues.length === 0 ? "monitoring proof completed without detected issues" : `${issues.length} issue(s): ${issues.join("; ")}`}.`);
console.log("Copy this summary into `docs/mainnet-proof-record.md` only after confirming the manifest reflects deployed external monitors and a real test alert.");

if (strict && issues.length > 0) {
  process.exitCode = 1;
}
