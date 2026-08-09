import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const strict = process.argv.includes("--strict") || process.env.PROOF_STRICT === "1";
const summaryOnly = process.argv.includes("--summary-only");
const args = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--") && arg.includes("="))
    .map((arg) => {
      const [key, ...rest] = arg.slice(2).split("=");
      return [key, rest.join("=")];
    }),
);

const requiredProcesses = ["lore-site", "lore-bot", "lore-indexer"];
const hostLaunchGates = ["G5", "G6"];
const hostLaunchGateGroups = "host=2";
const MAX_HOST_ARTIFACT_TEXT_BYTES = 256 * 1024;
const MAX_HOST_PROOF_MANIFEST_BYTES = 512 * 1024;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const expectedProcessCommands = new Map([
  ["lore-site", /\brun start(?:\s|$)/],
  ["lore-bot", /\brun bot(?:\s|$)/],
  ["lore-indexer", /\brun indexer(?:\s|$)/],
]);
const TEMPLATE_VALUE_RE = /REPLACE_|<REDACTED>|TODO|TBD/i;
const secretKeyPattern = /(secret|private[_-]?key|mnemonic|webhook|dsn|api[_-]?key|api[_-]?token|auth[_-]?token|access[_-]?token|bearer|session|cookie|password)/i;

function env(name) {
  return process.env[name]?.trim() || "";
}

function argOrEnv(argName, envName, fallback) {
  return args.get(argName)?.trim() || env(envName) || fallback;
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

function hasPublicHttpsUrl(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/https?:\/\/[^\s),.;]+/i);
  if (!match) return false;
  try {
    const url = new URL(match[0]);
    const host = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (host.includes(".") || host.includes(":")) &&
      !(
        host === "localhost" ||
        host === "0.0.0.0" ||
        host === "::" ||
        host === "::1" ||
        host === "127.0.0.1" ||
        host.endsWith(".localhost") ||
        host.endsWith(".local") ||
        host.endsWith(".example") ||
        host.endsWith(".test") ||
        host.endsWith(".invalid") ||
        /^0\./.test(host) ||
        /^127\./.test(host) ||
        /^10\./.test(host) ||
        /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
        /^169\.254\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
        /^192\.0\.2\./.test(host) ||
        /^198\.(1[89])\./.test(host) ||
        /^198\.51\.100\./.test(host) ||
        /^203\.0\.113\./.test(host) ||
        /^::ffff:/i.test(host) ||
        /^f[cd][0-9a-f]*:/i.test(host) ||
        /^fe[89ab][0-9a-f]*:/i.test(host) ||
        /^2001:db8:/i.test(host)
      );
  } catch {
    return false;
  }
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

function hasEvidence(value) {
  if (!isPlainObject(value)) return false;
  return [
    value.evidence,
    value.evidencePath,
    value.link,
    value.summary,
    value.artifact,
    value.notes,
    value.logPath,
    value.reportPath,
    value.commandOutputPath,
  ].some(hasRealText);
}

function hasConcreteText(value) {
  if (!hasRealText(value)) return false;
  const text = String(value).trim();
  return hasPublicHttpsUrl(text) ||
    /(?:^|[\\/\s])[^\s]+\.(?:json|jsonl|log|md|txt|csv)(?:\b|$)/i.test(text) ||
    /\bnpm(?:\.cmd)?\s+run\b/i.test(text) ||
    /\bproof:[a-z0-9:-]+\b/i.test(text) ||
    /\b(?:pm2|systemctl|journalctl|docker\s+compose)\b/i.test(text) ||
    /\b(?:finalityLagBlocks|requestCount|p95|TOTAL)=?\b/i.test(text);
}

function hasConcreteEvidence(value) {
  if (!isPlainObject(value)) return false;
  return [
    value.evidencePath,
    value.link,
    value.artifact,
    value.logPath,
    value.reportPath,
    value.commandOutputPath,
    value.evidence,
    value.summary,
    value.notes,
  ].some(hasConcreteText);
}

function localArtifactPathFromText(value, key = "") {
  if (!hasRealText(value)) return "";
  const text = String(value).trim().replace(/^`|`$/g, "");
  if (/^https?:\/\//i.test(text)) return "";
  const artifactMatch = text.match(/^artifact:\s*(\S+)/i);
  const candidate = (artifactMatch ? artifactMatch[1] : text).trim().replace(/^`|`$/g, "").replace(/[),.;]+$/g, "");
  if (/^https?:\/\//i.test(candidate)) return "";
  const keySuggestsPath = /(?:evidencePath|artifact|logPath|reportPath|commandOutputPath|link)$/i.test(key);
  const valueLooksLikePath = /(?:^|[\\/\s])[^\s]+\.(?:json|jsonl|log|md|txt|csv)(?:\b|$)/i.test(candidate);
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

function normalizedArtifactPathSet(value, key = "") {
  if (typeof value === "string") {
    const artifactPath = localArtifactPathFromText(value, key);
    return artifactPath ? new Set([resolve(process.cwd(), artifactPath).replace(/[\\/]+/g, "/").toLowerCase()]) : new Set();
  }
  if (Array.isArray(value)) {
    const paths = new Set();
    for (const entry of value) {
      for (const artifactPath of normalizedArtifactPathSet(entry, key)) paths.add(artifactPath);
    }
    return paths;
  }
  if (!isPlainObject(value)) return new Set();
  const paths = new Set();
  for (const [childKey, entry] of Object.entries(value)) {
    for (const artifactPath of normalizedArtifactPathSet(entry, childKey)) paths.add(artifactPath);
  }
  return paths;
}

function sharedHostSectionArtifactIssues(manifest) {
  const sections = [
    ["processModel", manifest.processModel],
    ["persistentDb", manifest.persistentDb],
    ["healthProd", manifest.healthProd],
    ["loadHttp", manifest.loadHttp],
    ["externalRateLimit", manifest.externalRateLimit],
  ].map(([name, value]) => [name, normalizedArtifactPathSet(value)]);
  const findings = [];
  for (let i = 0; i < sections.length; i += 1) {
    for (let j = i + 1; j < sections.length; j += 1) {
      const [leftName, leftPaths] = sections[i];
      const [rightName, rightPaths] = sections[j];
      for (const artifactPath of leftPaths) {
        if (rightPaths.has(artifactPath)) findings.push(`${leftName} and ${rightName}`);
      }
    }
  }
  return [...new Set(findings)];
}

function readBoundedArtifactText(resolved) {
  const fd = openSync(resolved, "r");
  try {
    const buffer = Buffer.alloc(MAX_HOST_ARTIFACT_TEXT_BYTES);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function localArtifactContentFromText(value, key = "") {
  const artifactPath = localArtifactPathFromText(value, key);
  if (!artifactPath) return "";
  if (!localArtifactIsFile(artifactPath)) return "";
  try {
    return readBoundedArtifactText(resolve(process.cwd(), artifactPath));
  } catch {
    return "";
  }
}

function localArtifactContents(value, key = "") {
  if (typeof value === "string") {
    const content = localArtifactContentFromText(value, key);
    return content ? [content] : [];
  }
  if (Array.isArray(value)) return value.flatMap((entry) => localArtifactContents(entry, key));
  if (!isPlainObject(value)) return [];
  return Object.entries(value).flatMap(([childKey, entry]) => localArtifactContents(entry, childKey));
}

function hasLocalArtifactRefs(value, key = "") {
  if (typeof value === "string") return Boolean(localArtifactPathFromText(value, key));
  if (Array.isArray(value)) return value.some((entry) => hasLocalArtifactRefs(entry, key));
  if (!isPlainObject(value)) return false;
  return Object.entries(value).some(([childKey, entry]) => hasLocalArtifactRefs(entry, childKey));
}

function localArtifactEvidenceMentions(value, pattern) {
  const contents = localArtifactContents(value);
  return contents.length > 0 && contents.some((content) => pattern.test(content));
}

function textHasHealthProdOkBaseAndSafeFinality(text, expectedOrigin) {
  const content = String(text ?? "");
  if (!/\[prod-health\]\s+OK/i.test(content)) return false;
  const expected = normalizedOrigin(expectedOrigin);
  const basePattern = /\bbase=([^\s]+)/gi;
  let baseMatches = false;
  let baseMatch = basePattern.exec(content);
  while (baseMatch !== null) {
    if (normalizedOrigin(baseMatch[1]) === expected) {
      baseMatches = true;
      break;
    }
    baseMatch = basePattern.exec(content);
  }
  const finalityMatch = content.match(/\bfinalityLagBlocks=([^\s]+)/i);
  return Boolean(baseMatches && finalityMatch && asNonNegativeSafeInteger(finalityMatch[1]) !== null);
}

function localArtifactHealthEvidenceHasSafeFinality(value, expectedOrigin) {
  const contents = localArtifactContents(value);
  return contents.length > 0 && contents.some((content) => textHasHealthProdOkBaseAndSafeFinality(content, expectedOrigin));
}

function evidenceContentText(value) {
  return [evidenceText(value), ...localArtifactContents(value)].filter(Boolean).join("\n");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function processEvidenceMentionsRole(processInfo, roleName) {
  if (!isPlainObject(processInfo)) return false;
  const rolePattern = new RegExp(`\\b${escapeRegExp(roleName)}\\b`, "i");
  const fields = [
    ["evidence", processInfo.evidence],
    ["evidencePath", processInfo.evidencePath],
    ["artifact", processInfo.artifact],
    ["logPath", processInfo.logPath],
    ["reportPath", processInfo.reportPath],
    ["commandOutputPath", processInfo.commandOutputPath],
    ["summary", processInfo.summary],
    ["notes", processInfo.notes],
  ];
  for (const [, value] of fields) {
    if (hasRealText(value) && rolePattern.test(String(value))) return true;
  }
  for (const [key, value] of fields) {
    const artifactPath = localArtifactPathFromText(value, key);
    if (!artifactPath) continue;
    const absolute = resolve(process.cwd(), artifactPath);
    if (!localArtifactIsFile(artifactPath)) continue;
    const artifactText = readBoundedArtifactText(absolute);
    if (rolePattern.test(artifactText)) return true;
  }
  return false;
}

function hasNumericFinalityLagEvidence(value) {
  if (!isPlainObject(value)) return false;
  const text = evidenceContentText(value);
  const match = text.match(/\bfinalityLagBlocks=([^\s]+)/i);
  return Boolean(match && asNonNegativeSafeInteger(match[1]) !== null);
}

function statusOk(value) {
  return ["ok", "pass", "passed", "healthy", "success", "green", "running"].includes(String(value ?? "").trim().toLowerCase());
}

function asNonNegativeSafeInteger(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  const normalized = String(value ?? "").trim();
  if (!/^(?:0|[1-9]\d{0,15})$/.test(normalized)) return null;
  const parsed = BigInt(normalized);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) return null;
  return Number(parsed);
}

function asNonNegativeDecimal(value) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  const normalized = String(value ?? "").trim();
  if (!/^(?:0|[1-9]\d{0,15})(?:\.\d{1,6})?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizedOrigin(value) {
  if (!hasRealText(value)) return "";
  try {
    const url = new URL(String(value).trim());
    if (url.username || url.password) return "";
    return url.origin.toLowerCase();
  } catch {
    return "";
  }
}

function originMatches(value, expectedOrigin) {
  const actual = normalizedOrigin(value);
  const expected = normalizedOrigin(expectedOrigin);
  return Boolean(actual && expected && actual === expected);
}

function evidenceText(value) {
  if (!isPlainObject(value)) return "";
  return [
    value.evidence,
    value.summary,
    value.notes,
    value.artifact,
    value.logPath,
    value.reportPath,
    value.commandOutputPath,
  ].filter(hasRealText).join("\n");
}

function healthEvidenceBaseMatches(value, expectedOrigin) {
  const expected = normalizedOrigin(expectedOrigin);
  if (!expected) return false;
  const text = evidenceContentText(value);
  const pattern = /\bbase=([^\s|]+)/gi;
  let match = pattern.exec(text);
  while (match !== null) {
    if (normalizedOrigin(match[1]) === expected) return true;
    match = pattern.exec(text);
  }
  return false;
}

function loadEvidenceBaseMatches(value, expectedOrigin) {
  const expected = normalizedOrigin(expectedOrigin);
  if (!expected) return false;
  const text = evidenceContentText(value);
  const pattern = /^\s*Load base URL:\s*([^\s|]+)/gim;
  let match = pattern.exec(text);
  while (match !== null) {
    if (normalizedOrigin(match[1]) === expected) return true;
    match = pattern.exec(text);
  }
  return false;
}

function externalRateLimitEvidenceLooksShared(value) {
  const text = evidenceContentText(value);
  return /\brate[-\s]?limit\b/i.test(text) &&
    /\b(?:shared|same|single)\b[\s\S]{0,80}\b(?:bucket|key|store)\b/i.test(text) &&
    /\breplica\b/i.test(text);
}

function externalRateLimitEvidenceNamesTwoReplicas(value) {
  const configuredIds = [
    ...(Array.isArray(value.replicaIds) ? value.replicaIds : []),
    ...(Array.isArray(value.replicas) ? value.replicas : []),
  ]
    .map((entry) => String(entry ?? "").trim().toLowerCase())
    .filter((entry) => entry.length > 0 && !TEMPLATE_VALUE_RE.test(entry));
  if (new Set(configuredIds).size >= 2) return true;
  const text = evidenceContentText(value).toLowerCase();
  const replicas = new Set();
  const replicaPattern = /\breplica[-_\s:]?([a-z0-9][a-z0-9._-]{0,31})\b/g;
  let match = replicaPattern.exec(text);
  while (match !== null) {
    if (match[1]) replicas.add(match[1]);
    if (replicas.size >= 2) return true;
    match = replicaPattern.exec(text);
  }
  return false;
}

function configuredSiteOrigin() {
  return env("NEXT_PUBLIC_SITE_URL") || env("PUBLIC_SITE_URL") || env("SITE_URL");
}

function isFinalHttpsOrigin(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    const host = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      (host.includes(".") || host.includes(":")) &&
      !(
        host === "localhost" ||
        host === "0.0.0.0" ||
        host === "::" ||
        host === "::1" ||
        host === "127.0.0.1" ||
        host.endsWith(".localhost") ||
        host.endsWith(".local") ||
        host.endsWith(".example") ||
        host.endsWith(".test") ||
        host.endsWith(".invalid") ||
        /^0\./.test(host) ||
        /^127\./.test(host) ||
        /^10\./.test(host) ||
        /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
        /^169\.254\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
        /^192\.0\.2\./.test(host) ||
        /^198\.(1[89])\./.test(host) ||
        /^198\.51\.100\./.test(host) ||
        /^203\.0\.113\./.test(host) ||
        /^::ffff:/i.test(host) ||
        /^f[cd][0-9a-f]*:/i.test(host) ||
        /^fe[89ab][0-9a-f]*:/i.test(host) ||
        /^2001:db8:/i.test(host)
      );
  } catch {
    return false;
  }
}

function normalizeCommand(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function isAnyPlatformAbsolute(filePath) {
  const value = String(filePath ?? "").trim();
  return isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value) || value.startsWith("/");
}

function pathStatus(filePath) {
  const value = String(filePath ?? "").trim();
  const absolute = isAnyPlatformAbsolute(value) ? resolve(value) : resolve(process.cwd(), value || ".");
  const relativeToRepo = relative(process.cwd(), absolute);
  return {
    isAbsolute: isAnyPlatformAbsolute(value),
    insideRepo: relativeToRepo === "" || (!relativeToRepo.startsWith("..") && !isAbsolute(relativeToRepo)),
  };
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

function printTable(headers, rows) {
  console.log(`| ${headers.join(" | ")} |`);
  console.log(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}

function sectionStatus(issueList, issuePatterns, candidateOk) {
  if (!candidateOk) return "issue";
  return issueList.some((issue) => issuePatterns.some((pattern) => pattern.test(issue))) ? "issue" : "checked";
}

function fileSummaryStatus(filePath) {
  return regularFileStat(filePath) ? "present" : "missing";
}

function launchGateSummary(issueCount) {
  const label = issueCount > 0 ? "blocked" : "covered";
  return `${label} gates: ${hostLaunchGates.join(", ")}; groups: ${hostLaunchGateGroups}`;
}

const manifestPath = resolve(process.cwd(), argOrEnv("file", "HOST_PROOF_PATH", "docs/host-proof.json"));
const issues = [];
let manifest = null;

console.log("# Production Host Proof Summary");
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
  issues.push("host proof manifest is missing");
} else if (!manifestStat) {
  issues.push("host proof manifest must be a file");
} else {
  if (manifestStat.size > MAX_HOST_PROOF_MANIFEST_BYTES) {
    issues.push("host proof manifest is too large to validate safely");
  } else {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      issues.push(`host proof manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

if (manifest) {
  if (!isPlainObject(manifest)) {
    issues.push("host proof manifest must be an object");
  } else {
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
      issues.push(`local host artifact references must exist: ${formatMissingLocalArtifactRefs(missingArtifactRefs)}`);
    }
    const sharedSectionArtifactIssues = sharedHostSectionArtifactIssues(manifest);
    if (sharedSectionArtifactIssues.length > 0) {
      issues.push(`host evidence sections must use distinct local artifact files across ${sharedSectionArtifactIssues.slice(0, 5).join(", ")}`);
    }

    const origin = manifest.origin;
    const hostType = String(manifest.hostType ?? "").trim().toLowerCase();
    if (hostType !== "production") {
      issues.push("hostType must be production for launch host proof");
    }
    if (!hasRealText(origin) || !isFinalHttpsOrigin(origin)) {
      issues.push("origin must be a final public HTTPS origin without path, query, or hash");
    }
    const expectedOrigin = configuredSiteOrigin();
    if (expectedOrigin && normalizedOrigin(origin) && normalizedOrigin(expectedOrigin) !== normalizedOrigin(origin)) {
      issues.push("origin must match configured production origin");
    }

    const processModel = isPlainObject(manifest.processModel) ? manifest.processModel : {};
    if (!isPlainObject(manifest.processModel)) issues.push("processModel section is missing");
    if (!hasRealText(processModel.supervisor)) issues.push("processModel.supervisor is missing");
    const processCommands = [];
    for (const name of requiredProcesses) {
      const process = processModel[name];
      if (!isPlainObject(process)) {
        issues.push(`processModel.${name} is missing`);
        continue;
      }
      if (process.supervised !== true) issues.push(`processModel.${name}.supervised must be true`);
      if (process.running !== true && !statusOk(process.status)) issues.push(`processModel.${name} must be running`);
      if (!hasRealText(process.command)) {
        issues.push(`processModel.${name}.command is missing`);
      } else {
        const command = normalizeCommand(process.command);
        processCommands.push([name, command]);
        if (!expectedProcessCommands.get(name)?.test(command)) {
          issues.push(`processModel.${name}.command must match the expected launch role command`);
        }
      }
      if (!hasIsoTimestamp(process.checkedAt)) {
        issues.push(`processModel.${name}.checkedAt must be ISO-8601 UTC`);
      } else if (!hasNonFutureIsoTimestamp(process.checkedAt)) {
        issues.push(`processModel.${name}.checkedAt must not be in the future`);
      }
      if (!hasEvidence(process)) issues.push(`processModel.${name} has no evidence`);
      if (hasEvidence(process) && !hasConcreteEvidence(process)) {
        issues.push(`processModel.${name} must include concrete supervisor evidence path, link, artifact, command output, or pm2/systemd/docker marker`);
      }
      if (hasEvidence(process) && !processEvidenceMentionsRole(process, name)) {
        issues.push(`processModel.${name} evidence must mention ${name} in supervisor output`);
      }
    }
    const commandCounts = new Map();
    for (const [, command] of processCommands) {
      commandCounts.set(command, (commandCounts.get(command) ?? 0) + 1);
    }
    for (const [name, command] of processCommands) {
      if (commandCounts.get(command) > 1) {
        issues.push(`processModel.${name}.command must be distinct from the other launch processes`);
      }
    }

    const persistentDb = isPlainObject(manifest.persistentDb) ? manifest.persistentDb : {};
    if (!isPlainObject(manifest.persistentDb)) issues.push("persistentDb section is missing");
    if (persistentDb.absolutePathOutsideRepo !== true) issues.push("persistentDb.absolutePathOutsideRepo must be true");
    if (persistentDb.restartSurvived !== true) issues.push("persistentDb.restartSurvived must be true");
    if (persistentDb.rebootSurvived !== true) issues.push("persistentDb.rebootSurvived must be true");
    if (!hasRealText(persistentDb.path)) issues.push("persistentDb.path is missing");
    if (hasRealText(persistentDb.path)) {
      const dbPath = pathStatus(persistentDb.path);
      if (!dbPath.isAbsolute) issues.push("persistentDb.path must be absolute");
      if (dbPath.insideRepo) issues.push("persistentDb.path must be outside the repo checkout");
    }
    if (!hasIsoTimestamp(persistentDb.checkedAt)) {
      issues.push("persistentDb.checkedAt must be ISO-8601 UTC");
    } else if (!hasNonFutureIsoTimestamp(persistentDb.checkedAt)) {
      issues.push("persistentDb.checkedAt must not be in the future");
    }
    if (!hasEvidence(persistentDb)) issues.push("persistentDb has no evidence");
    if (hasEvidence(persistentDb) && !hasConcreteEvidence(persistentDb)) {
      issues.push("persistentDb must include concrete restart/reboot persistence evidence path, link, artifact, or command output");
    }
    if (hasLocalArtifactRefs(persistentDb) && !localArtifactEvidenceMentions(persistentDb, /\b(?:persistent|persistence|restart|reboot|LORE_DB_PATH|database|sqlite|db path)\b/i)) {
      issues.push("persistentDb evidence artifact must mention persistence, restart/reboot, or DB path proof");
    }

    const healthProd = isPlainObject(manifest.healthProd) ? manifest.healthProd : {};
    if (!isPlainObject(manifest.healthProd)) issues.push("healthProd section is missing");
    if (!statusOk(healthProd.status)) issues.push("healthProd.status must be ok/pass/healthy");
    if (!String(healthProd.command ?? "").includes("health:prod")) issues.push("healthProd.command must record npm run health:prod");
    if (!hasRealText(healthProd.url)) issues.push("healthProd.url is missing");
    if (hasRealText(healthProd.url) && !originMatches(healthProd.url, origin)) {
      issues.push("healthProd.url must match host proof origin");
    }
    if (!healthEvidenceBaseMatches(healthProd, origin)) {
      issues.push("healthProd evidence must include base=<production origin> from health:prod");
    }
    if (healthProd.runtimeHealthPassed !== true) issues.push("healthProd.runtimeHealthPassed must be true");
    if (healthProd.dataSyncHealthPassed !== true) issues.push("healthProd.dataSyncHealthPassed must be true");
    if (healthProd.diagnosticsAuthPassed !== true) issues.push("healthProd.diagnosticsAuthPassed must be true");
    if (healthProd.finalityLagChecked !== true) issues.push("healthProd.finalityLagChecked must be true");
    if (healthProd.jackpotRowsChecked !== true) issues.push("healthProd.jackpotRowsChecked must be true");
    if (!hasIsoTimestamp(healthProd.timestamp)) {
      issues.push("healthProd.timestamp must be ISO-8601 UTC");
    } else if (!hasNonFutureIsoTimestamp(healthProd.timestamp)) {
      issues.push("healthProd.timestamp must not be in the future");
    }
    if (!hasEvidence(healthProd)) issues.push("healthProd has no evidence");
    if (hasEvidence(healthProd) && !hasConcreteEvidence(healthProd)) {
      issues.push("healthProd must include concrete health:prod evidence path, link, artifact, command output, or summary marker");
    }
    if (!hasNumericFinalityLagEvidence(healthProd)) {
      issues.push("healthProd evidence must include canonical non-negative decimal finalityLagBlocks from health:prod");
    }
    if (hasLocalArtifactRefs(healthProd) && !localArtifactHealthEvidenceHasSafeFinality(healthProd, origin)) {
      issues.push("healthProd evidence artifact must include [prod-health] OK, base, and canonical non-negative decimal finalityLagBlocks");
    }

    const loadHttp = isPlainObject(manifest.loadHttp) ? manifest.loadHttp : {};
    if (!isPlainObject(manifest.loadHttp)) issues.push("loadHttp section is missing");
    if (!statusOk(loadHttp.status)) issues.push("loadHttp.status must be ok/pass/healthy");
    if (!String(loadHttp.command ?? "").includes("load:http")) issues.push("loadHttp.command must record npm run load:http");
    if (!hasRealText(loadHttp.url)) issues.push("loadHttp.url is missing");
    if (hasRealText(loadHttp.url) && !isFinalHttpsOrigin(loadHttp.url)) {
      issues.push("loadHttp.url must be a public HTTPS staging or canary origin without path, query, or hash");
    }
    if (!["staging", "canary"].includes(String(loadHttp.hostType ?? "").trim().toLowerCase())) {
      issues.push("loadHttp.hostType must be staging or canary");
    }
    if (hasRealText(loadHttp.url) && originMatches(loadHttp.url, origin)) {
      issues.push("loadHttp.url must not be the final production origin");
    }
    if (!loadEvidenceBaseMatches(loadHttp, loadHttp.url)) {
      issues.push("loadHttp evidence must include Load base URL matching loadHttp.url from load:http");
    }
    const requestCount = asNonNegativeSafeInteger(loadHttp.requestCount);
    const errorRate = asNonNegativeDecimal(loadHttp.errorRate);
    const maxErrorRate = asNonNegativeDecimal(loadHttp.maxErrorRate);
    const p95Ms = asNonNegativeSafeInteger(loadHttp.p95Ms);
    const maxP95Ms = asNonNegativeSafeInteger(loadHttp.maxP95Ms);
    const durationMs = asNonNegativeSafeInteger(loadHttp.durationMs);
    const concurrency = asNonNegativeSafeInteger(loadHttp.concurrency);
    if (requestCount == null || requestCount <= 0) issues.push("loadHttp.requestCount must be positive");
    if (errorRate == null || errorRate < 0 || errorRate > 1) issues.push("loadHttp.errorRate must be between 0 and 1");
    if (maxErrorRate == null || maxErrorRate < 0 || maxErrorRate > 1) issues.push("loadHttp.maxErrorRate must be between 0 and 1");
    if (errorRate != null && maxErrorRate != null && errorRate > maxErrorRate) issues.push("loadHttp.errorRate must be <= maxErrorRate");
    if (p95Ms == null || p95Ms <= 0) issues.push("loadHttp.p95Ms must be positive");
    if (maxP95Ms == null || maxP95Ms <= 0) issues.push("loadHttp.maxP95Ms must be positive");
    if (p95Ms != null && maxP95Ms != null && p95Ms > maxP95Ms) issues.push("loadHttp.p95Ms must be <= maxP95Ms");
    if (durationMs == null || durationMs <= 0) issues.push("loadHttp.durationMs must be positive");
    if (concurrency == null || concurrency <= 0) issues.push("loadHttp.concurrency must be positive");
    if (!hasIsoTimestamp(loadHttp.timestamp)) {
      issues.push("loadHttp.timestamp must be ISO-8601 UTC");
    } else if (!hasNonFutureIsoTimestamp(loadHttp.timestamp)) {
      issues.push("loadHttp.timestamp must not be in the future");
    }
    if (!hasEvidence(loadHttp)) issues.push("loadHttp has no evidence");
    if (hasEvidence(loadHttp) && !hasConcreteEvidence(loadHttp)) {
      issues.push("loadHttp must include concrete load:http evidence path, link, artifact, command output, or summary marker");
    }
    if (hasLocalArtifactRefs(loadHttp) && !localArtifactEvidenceMentions(loadHttp, /^\s*Load base URL:\s*[^\s|]+[\s\S]*\bTOTAL\b[\s\S]*\bp95\b/im)) {
      issues.push("loadHttp evidence artifact must include Load base URL, TOTAL, and p95 output");
    }

    const externalRateLimit = isPlainObject(manifest.externalRateLimit) ? manifest.externalRateLimit : {};
    if (!isPlainObject(manifest.externalRateLimit)) issues.push("externalRateLimit section is missing");
    if (!statusOk(externalRateLimit.status)) issues.push("externalRateLimit.status must be ok/pass/healthy");
    if (externalRateLimit.failClosed !== true) issues.push("externalRateLimit.failClosed must be true");
    if (externalRateLimit.sharedBucketVerified !== true) issues.push("externalRateLimit.sharedBucketVerified must be true");
    const webReplicaCount = asNonNegativeSafeInteger(externalRateLimit.webReplicaCount);
    const distinctReplicas = asNonNegativeSafeInteger(externalRateLimit.distinctReplicas);
    if (webReplicaCount == null || webReplicaCount < 2) issues.push("externalRateLimit.webReplicaCount must be at least 2");
    if (distinctReplicas == null || distinctReplicas < 2) issues.push("externalRateLimit.distinctReplicas must be at least 2");
    if (!hasIsoTimestamp(externalRateLimit.checkedAt)) {
      issues.push("externalRateLimit.checkedAt must be ISO-8601 UTC");
    } else if (!hasNonFutureIsoTimestamp(externalRateLimit.checkedAt)) {
      issues.push("externalRateLimit.checkedAt must not be in the future");
    }
    if (!hasEvidence(externalRateLimit)) issues.push("externalRateLimit has no evidence");
    if (hasEvidence(externalRateLimit) && !hasConcreteEvidence(externalRateLimit)) {
      issues.push("externalRateLimit must include concrete shared rate-limit evidence path, link, artifact, command output, or summary marker");
    }
    if (hasEvidence(externalRateLimit) && !externalRateLimitEvidenceLooksShared(externalRateLimit)) {
      issues.push("externalRateLimit evidence must mention shared rate-limit bucket/store behavior across replicas");
    }
    if (hasEvidence(externalRateLimit) && !externalRateLimitEvidenceNamesTwoReplicas(externalRateLimit)) {
      issues.push("externalRateLimit evidence must identify at least two distinct web replicas");
    }

    printTable(["Section", "Status"], [
      ["origin", sectionStatus(issues, [/^origin\b/, /^hostType\b/], isFinalHttpsOrigin(origin))],
      ["processModel", sectionStatus(issues, [/^processModel\b/, /\bprocessModel\b/], requiredProcesses.every((name) => isPlainObject(processModel[name])))],
      ["persistentDb", sectionStatus(issues, [/^persistentDb\b/, /\bpersistentDb\b/], persistentDb.absolutePathOutsideRepo === true)],
      ["healthProd", sectionStatus(issues, [/^healthProd\b/, /\bhealthProd\b/], statusOk(healthProd.status))],
      ["loadHttp", sectionStatus(issues, [/^loadHttp\b/, /\bloadHttp\b/], statusOk(loadHttp.status))],
      ["externalRateLimit", sectionStatus(issues, [/^externalRateLimit\b/, /\bexternalRateLimit\b/], statusOk(externalRateLimit.status))],
    ]);
  }
}

console.log("");
console.log(`Summary: ${issues.length === 0 ? "production host proof completed without detected issues" : `${issues.length} issue(s): ${issues.join("; ")}`}; ${launchGateSummary(issues.length)}.`);
console.log("Copy this summary into `docs/mainnet-proof-record.md` only after confirming the manifest reflects the deployed host, process supervisor, health check, and load test evidence.");

if (strict && issues.length > 0) {
  process.exitCode = 1;
}
