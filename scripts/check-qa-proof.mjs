import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { resolve } from "node:path";

const strict = process.argv.includes("--strict") || process.env.PROOF_STRICT === "1";
const summaryOnly = process.argv.includes("--summary-only");
const qaLaunchGates = ["G12", "G13", "G14"];
const qaLaunchGateGroups = "qa=3";
const MAX_QA_ARTIFACT_TEXT_BYTES = 256 * 1024;
const MAX_QA_PROOF_MANIFEST_BYTES = 512 * 1024;
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
  return `${label} gates: ${qaLaunchGates.join(", ")}; groups: ${qaLaunchGateGroups}`;
}

const requiredGroups = {
  wallet: [
    "privyAllowedOrigins",
    "desktopConnect",
    "desktopDisconnect",
    "desktopReconnect",
    "wrongNetwork",
    "mobileWeb3Browser",
    "cleanWalletFirstTx",
    "slowNetworkAuthModal",
    "slowNetworkChatAuth",
  ],
  failureStateUx: [
    "disabledActionsExplainReason",
    "pendingBet",
    "pendingResolve",
    "pendingChatAuth",
    "pendingProfileSave",
    "degradedDataVisible",
    "routeChunkRecovery",
    "noSilentNoop",
  ],
  supportAuditVisibility: [
    "betHistoryFields",
    "autoMinerLogFields",
    "diagnosticsIndexerLag",
    "diagnosticsHeartbeat",
    "diagnosticsServingMode",
  ],
  finalQa: [
    "browserSmokeDebugAutominer",
    "mobileLayout",
    "rightPanelOverlays",
    "chatGeometry",
    "faqMainnetWording",
    "whitepaperMainnetWording",
    "onboardingMainnetWording",
  ],
};

const okStatuses = new Set(["ok", "pass", "passed", "success", "verified", "complete"]);
const TX_RE = /^0x[a-fA-F0-9]{64}$/;
const ZERO_TX = "0x0000000000000000000000000000000000000000000000000000000000000000";
const TEMPLATE_VALUE_RE = /REPLACE_|<REDACTED>|TODO|TBD/i;
const secretKeyPattern = /(secret|private[_-]?key|mnemonic|webhook|dsn|api[_-]?key|api[_-]?token|auth[_-]?token|access[_-]?token|bearer|session|cookie)/i;
const REQUIRED_BET_HISTORY_FIELDS = ["epoch", "tile", "amount", "txHash", "result"];
const REQUIRED_AUTOMINER_LOG_FIELDS = ["round", "epoch", "nonce", "txHash", "retryCount", "stopReason"];
const knownNetworkChainIds = new Map([
  ["mainnet", 59144],
  ["sepolia", 59141],
]);

function requiresQaTimestamp(group, checkId) {
  if (group === "supportAuditVisibility" || group === "finalQa") return true;
  if (group === "failureStateUx") return true;
  return group === "wallet" && checkId !== "privyAllowedOrigins";
}

function env(name) {
  return process.env[name]?.trim() || "";
}

function argOrEnv(argName, envName, fallback) {
  return args.get(argName)?.trim() || env(envName) || fallback;
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

function hasNonFutureIsoTimestamp(value) {
  if (!hasIsoTimestamp(value)) return false;
  return Date.parse(String(value).trim()) <= Date.now() + 5 * 60 * 1000;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function checkStatus(value) {
  return okStatuses.has(String(value ?? "").trim().toLowerCase());
}

function hasEvidence(check) {
  if (!isPlainObject(check)) return false;
  return [
    check.evidence,
    check.evidencePath,
    check.link,
    check.txHash,
    check.notes,
    check.artifact,
    check.screenshot,
    check.screenshotPath,
    check.logPath,
    check.reportPath,
  ].some(hasRealText);
}

function hasConcreteText(value) {
  if (!hasRealText(value)) return false;
  const text = String(value).trim();
  return hasPublicHttpsUrl(text) ||
    /(?:^|[\\/\s])[^\s]+\.(?:json|jsonl|log|md|txt|csv|png|jpg|jpeg|webp|html|zip)(?:\b|$)/i.test(text);
}

function hasConcreteEvidence(check) {
  if (!isPlainObject(check)) return false;
  if (isRealTx(check.txHash)) return true;
  return [
    check.evidencePath,
    check.link,
    check.artifact,
    check.screenshot,
    check.screenshotPath,
    check.logPath,
    check.reportPath,
    check.commandOutputPath,
  ].some(hasConcreteText);
}

function localArtifactPathFromText(value, key = "") {
  if (!hasRealText(value)) return "";
  const text = String(value).trim().replace(/^`|`$/g, "");
  if (/^https?:\/\//i.test(text)) return "";
  const artifactMatch = text.match(/^artifact:\s*(\S+)/i);
  const candidate = (artifactMatch ? artifactMatch[1] : text).trim().replace(/^`|`$/g, "").replace(/[),.;]+$/g, "");
  if (/^https?:\/\//i.test(candidate)) return "";
  const keySuggestsPath = /(?:evidencePath|artifact|screenshot|screenshotPath|logPath|reportPath|commandOutputPath|link)$/i.test(key);
  const valueLooksLikePath = /(?:^|[\\/\s])[^\s]+\.(?:json|jsonl|log|md|txt|csv|png|jpg|jpeg|webp|html|zip)(?:\b|$)/i.test(candidate);
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

function localArtifactPaths(check) {
  if (!isPlainObject(check)) return [];
  return [
    ["evidence", check.evidence],
    ["evidencePath", check.evidencePath],
    ["link", check.link],
    ["artifact", check.artifact],
    ["screenshot", check.screenshot],
    ["screenshotPath", check.screenshotPath],
    ["logPath", check.logPath],
    ["reportPath", check.reportPath],
    ["commandOutputPath", check.commandOutputPath],
    ["notes", check.notes],
  ].map(([key, entry]) => localArtifactPathFromText(entry, key)).filter(Boolean);
}

function normalizedArtifactPathSetForGroup(manifest, group) {
  const section = isPlainObject(manifest?.[group]) ? manifest[group] : {};
  const paths = new Set();
  for (const checkId of requiredGroups[group] ?? []) {
    for (const artifactPath of localArtifactPaths(section[checkId])) {
      paths.add(resolve(process.cwd(), artifactPath).toLowerCase());
    }
  }
  return paths;
}

function sharedQaEvidenceGroupArtifactIssues(manifest) {
  const groups = Object.keys(requiredGroups);
  const groupPaths = new Map(groups.map((group) => [group, normalizedArtifactPathSetForGroup(manifest, group)]));
  const issues = [];
  for (let leftIndex = 0; leftIndex < groups.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < groups.length; rightIndex += 1) {
      const left = groups[leftIndex];
      const right = groups[rightIndex];
      const rightPaths = groupPaths.get(right) ?? new Set();
      if ([...(groupPaths.get(left) ?? [])].some((artifactPath) => rightPaths.has(artifactPath))) {
        issues.push(`QA evidence groups must use distinct local artifact files across ${left} and ${right}`);
      }
    }
  }
  return issues;
}

function readBoundedArtifactText(resolved) {
  const fd = openSync(resolved, "r");
  try {
    const buffer = Buffer.alloc(MAX_QA_ARTIFACT_TEXT_BYTES);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function artifactBackedEvidenceText(check) {
  const chunks = [];
  if (isPlainObject(check)) {
    chunks.push([
      check.evidence,
      check.evidencePath,
      check.link,
      check.artifact,
      check.screenshot,
      check.screenshotPath,
      check.logPath,
      check.reportPath,
      check.commandOutputPath,
      check.notes,
    ].filter(hasRealText).join("\n"));
  }
  for (const artifactPath of localArtifactPaths(check)) {
    const resolved = resolve(process.cwd(), artifactPath);
    if (!localArtifactIsFile(artifactPath)) continue;
    chunks.push(readBoundedArtifactText(resolved));
  }
  return chunks.join("\n");
}

function hasQaContentProof(group, checkId, check) {
  const text = artifactBackedEvidenceText(check);
  if (group === "wallet" && checkId === "privyAllowedOrigins") {
    return /\bprivy\b/i.test(text) &&
      /\b(?:allowed[-\s]?origin|dashboard|production\s+origin)\b/i.test(text) &&
      /\bapp[-\s]?id\b/i.test(text);
  }
  if (group === "wallet" && checkId === "desktopConnect") {
    return /\b(?:desktop|browser)\b/i.test(text) && /\b(?:connect|connected|wallet\s+ready)\b/i.test(text);
  }
  if (group === "wallet" && checkId === "desktopDisconnect") {
    return /\b(?:desktop|browser)\b/i.test(text) && /\b(?:disconnect|disconnected|sign\s*out|log\s*out)\b/i.test(text);
  }
  if (group === "wallet" && checkId === "desktopReconnect") {
    return /\b(?:desktop|browser)\b/i.test(text) && /\b(?:reconnect|reload|session\s+recovery|wallet\s+ready)\b/i.test(text);
  }
  if (group === "wallet" && checkId === "wrongNetwork") {
    return /\bwrong\s+network|unsupported\s+chain|switch\s+network|chain\s+mismatch\b/i.test(text);
  }
  if (group === "wallet" && checkId === "mobileWeb3Browser") {
    return /\bmobile\b/i.test(text) && /\b(?:web3|in[-\s]?app|browser|wallet)\b/i.test(text);
  }
  if (group === "wallet" && checkId === "cleanWalletFirstTx") {
    return /\bclean\s+wallet|first\s+(?:tx|transaction)|first\s+bet|fresh\s+wallet\b/i.test(text);
  }
  if (group === "wallet" && checkId === "slowNetworkAuthModal") {
    return /\bslow\s+network|timeout|delayed|latency\b/i.test(text) && /\bauth|modal|privy\b/i.test(text);
  }
  if (group === "wallet" && checkId === "slowNetworkChatAuth") {
    return /\bslow\s+network|timeout|delayed|latency\b/i.test(text) && /\bchat\s+auth|chat|message\b/i.test(text);
  }
  if (group === "wallet") {
    return /\b(?:wallet|privy|connect|disconnect|reconnect|wrong\s+network|mobile|clean\s+wallet|auth|transaction|tx)\b/i.test(text);
  }
  if (group === "failureStateUx") {
    return /\b(?:failure|failed|disabled|reason|pending|degraded|stale|silent|no-op|route|recovery|ux)\b/i.test(text);
  }
  if (group === "supportAuditVisibility") {
    return /\b(?:support|audit|bet\s+history|auto[-\s]?miner|diagnostics|indexer\s+lag|heartbeat|serving\s+mode)\b/i.test(text);
  }
  if (group === "finalQa" && checkId === "browserSmokeDebugAutominer") {
    return /\b(?:debug\s+autominer|smoke:browser|browser\s+smoke|console|wallet\s+warning)\b/i.test(text);
  }
  if (group === "finalQa") {
    return /\b(?:final|browser|mobile|layout|overlay|panel|chat|faq|whitepaper|onboarding|mainnet|wording)\b/i.test(text);
  }
  return true;
}

function qaContentProofDescription(group, checkId) {
  if (group === "wallet" && checkId === "privyAllowedOrigins") return "Privy dashboard allowed-origin production proof";
  if (group === "wallet") return "wallet/Privy/connect/mobile/wrong-network proof";
  if (group === "failureStateUx") return "failure-state/pending/degraded/no-op UX proof";
  if (group === "supportAuditVisibility") return "support/audit/diagnostics visibility proof";
  if (group === "finalQa" && checkId === "browserSmokeDebugAutominer") return "debug autominer browser smoke proof";
  if (group === "finalQa") return "final browser/mobile/mainnet wording QA proof";
  return "QA proof";
}

function receiptEvidenceText(check) {
  const chunks = [];
  if (isPlainObject(check)) {
    chunks.push([
      check.evidence,
      check.link,
      check.notes,
    ].filter((entry) => hasRealText(entry) && !localArtifactPathFromText(entry)).join("\n"));
  }
  for (const artifactPath of localArtifactPaths(check)) {
    const resolved = resolve(process.cwd(), artifactPath);
    if (!localArtifactIsFile(artifactPath)) continue;
    chunks.push(readBoundedArtifactText(resolved));
  }
  return chunks.join("\n");
}

function hasCleanWalletReceiptProof(check) {
  const text = receiptEvidenceText(check);
  return /\b(?:receipt|confirmed|confirmation|success|successful|status\s*:?\s*1|block\s+#?\d+|lineascan|explorer)\b/i.test(text);
}

function parseCanonicalViewportDimension(value) {
  const normalized = String(value ?? "").trim();
  if (!/^[1-9]\d{2,3}$/.test(normalized)) return null;
  const parsed = BigInt(normalized);
  return parsed <= MAX_SAFE_INTEGER_BIGINT ? Number(parsed) : null;
}

const MAX_VIEWPORT_MARKERS = 32;

function hasMobileViewportProofText(text) {
  const viewportMatches = String(text ?? "").matchAll(/\b(?:mobile\s+viewport|viewport)\s*[:=]?\s*(\d{3,4})\s*x\s*(\d{3,4})\b/gi);
  let inspected = 0;
  for (const match of viewportMatches) {
    inspected += 1;
    if (inspected > MAX_VIEWPORT_MARKERS) return false;
    const width = parseCanonicalViewportDimension(match[1]);
    const height = parseCanonicalViewportDimension(match[2]);
    if (width == null || height == null) continue;
    const portraitMobile = width >= 320 && width <= 480 && height >= 568 && height <= 1100;
    const landscapeMobile = height >= 320 && height <= 480 && width >= 568 && width <= 1100;
    if (portraitMobile || landscapeMobile) return true;
  }
  return false;
}

function hasMobileDeviceProof(check) {
  const text = artifactBackedEvidenceText(check);
  return /\b(?:ios|android|iphone|metamask\s+mobile|rabby\s+mobile|trust\s+wallet|coinbase\s+wallet|walletconnect|in[-\s]?app\s+wallet)\b/i.test(text) ||
    hasMobileViewportProofText(text);
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

function isRealTx(value) {
  const normalized = String(value ?? "");
  return TX_RE.test(normalized) && normalized.toLowerCase() !== ZERO_TX;
}

function hasHttpsOrigin(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    const host = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
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

function normalizeOrigin(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    if (url.username || url.password) return "";
    return url.origin.toLowerCase();
  } catch {
    return "";
  }
}

function normalizeNetwork(value) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "-");
  if (["main", "linea", "prod", "production", "linea-mainnet"].includes(normalized)) return "mainnet";
  if (["testnet", "linea-sepolia", "sepolia-testnet"].includes(normalized)) return "sepolia";
  return normalized;
}

function positiveInteger(value) {
  const normalized = String(value ?? "").trim();
  if (!/^[1-9]\d{0,15}$/.test(normalized)) return null;
  const parsed = BigInt(normalized);
  return parsed <= MAX_SAFE_INTEGER_BIGINT ? Number(parsed) : null;
}

function includesAll(values, required) {
  if (!Array.isArray(values)) return false;
  const normalized = new Set(values.map((value) => String(value).trim()).filter(Boolean));
  return required.every((field) => normalized.has(field));
}

function requiresQaOrigin(group, checkId) {
  return group === "wallet" && checkId !== "privyAllowedOrigins";
}

function qaOriginIssues(check, label, expectedOrigin) {
  const issues = [];
  const origin = check?.origin;
  if (!hasHttpsOrigin(origin)) {
    issues.push(`${label}.origin must be the exact HTTPS production origin`);
  } else if (expectedOrigin && normalizeOrigin(origin) !== normalizeOrigin(expectedOrigin)) {
    issues.push(`${label}.origin must match configured production origin`);
  }
  return issues;
}

function printTable(headers, rows) {
  console.log(`| ${headers.join(" | ")} |`);
  console.log(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}

function fileSummaryStatus(filePath) {
  return regularFileStat(filePath) ? "present" : "missing";
}

const manifestPath = resolve(process.cwd(), argOrEnv("file", "QA_PROOF_PATH", "docs/qa-proof.json"));
const issues = [];
let manifest = null;

console.log("# Wallet / UX / Final QA Proof Summary");
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
  issues.push("QA proof manifest is missing");
} else if (!manifestStat) {
  issues.push("QA proof manifest must be a file");
} else {
  if (manifestStat.size > MAX_QA_PROOF_MANIFEST_BYTES) {
    issues.push("QA proof manifest is too large to validate safely");
  } else {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      issues.push(`QA proof manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

if (manifest) {
  if (!isPlainObject(manifest)) {
    issues.push("QA proof manifest must be an object");
  } else {
    const targetNetwork = manifest.targetNetwork;
    const targetChainId = positiveInteger(manifest.targetChainId);
    const expectedNetwork = env("NEXT_PUBLIC_LINEA_NETWORK") || env("LINEA_NETWORK");
    const expectedChainId = positiveInteger(env("NEXT_PUBLIC_LINEA_CHAIN_ID") || env("LINEA_CHAIN_ID")) ??
      knownNetworkChainIds.get(normalizeNetwork(expectedNetwork || targetNetwork));
    const expectedOrigin = env("NEXT_PUBLIC_SITE_URL") || env("PUBLIC_SITE_URL") || env("SITE_URL");
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
      issues.push(`local QA artifact references must exist: ${formatMissingLocalArtifactRefs(missingArtifactRefs)}`);
    }
    issues.push(...sharedQaEvidenceGroupArtifactIssues(manifest));
    if (!hasRealText(targetNetwork)) {
      issues.push("targetNetwork is missing");
    }
    if (hasRealText(targetNetwork) && normalizeNetwork(targetNetwork) !== "mainnet") {
      issues.push("targetNetwork must be mainnet for launch QA proof");
    }
    if (expectedNetwork && hasRealText(targetNetwork) && normalizeNetwork(targetNetwork) !== normalizeNetwork(expectedNetwork)) {
      issues.push("targetNetwork must match configured Linea network");
    }
    if (targetChainId == null) {
      issues.push("targetChainId must be a positive integer");
    }
    if (targetChainId && targetChainId !== 59144) {
      issues.push("targetChainId must be 59144 for Linea mainnet launch proof");
    }
    if (expectedChainId && targetChainId && targetChainId !== expectedChainId) {
      issues.push("targetChainId must match configured Linea chain id");
    }

    const rows = [];
    for (const [group, checks] of Object.entries(requiredGroups)) {
      const section = isPlainObject(manifest[group]) ? manifest[group] : {};
      if (!isPlainObject(manifest[group])) issues.push(`missing QA section ${group}`);
      for (const checkId of checks) {
        const check = section[checkId];
        const statusOk = checkStatus(check?.status);
        const evidenceOk = hasEvidence(check);
        const concreteEvidenceOk = hasConcreteEvidence(check);
        if (!statusOk) issues.push(`${group}.${checkId} status is not pass/verified`);
        if (!evidenceOk) issues.push(`${group}.${checkId} has no evidence`);
        if (evidenceOk && !concreteEvidenceOk) {
          issues.push(`${group}.${checkId} must include concrete evidence path, link, artifact, screenshot, log, report, or tx hash`);
        }
        if (concreteEvidenceOk && !hasQaContentProof(group, checkId, check)) {
          issues.push(`${group}.${checkId} evidence must mention ${qaContentProofDescription(group, checkId)}`);
        }
        if (requiresQaTimestamp(group, checkId) && !hasIsoTimestamp(check?.checkedAt)) {
          issues.push(`${group}.${checkId}.checkedAt must be ISO-8601 UTC`);
        }
        if (requiresQaTimestamp(group, checkId) && hasIsoTimestamp(check?.checkedAt) && !hasNonFutureIsoTimestamp(check?.checkedAt)) {
          issues.push(`${group}.${checkId}.checkedAt must not be in the future`);
        }
        if (requiresQaOrigin(group, checkId)) {
          issues.push(...qaOriginIssues(check, `${group}.${checkId}`, expectedOrigin));
        }
        rows.push([group, checkId, statusOk ? "yes" : "no", concreteEvidenceOk ? "yes" : "no"]);
      }
    }

    const smoke = manifest.finalQa?.browserSmokeDebugAutominer;
    if (isPlainObject(smoke)) {
      const command = String(smoke.command ?? "");
      if (!command.includes("SMOKE_INCLUDE_DEBUG_AUTOMINER_SCENARIOS") || !command.includes("smoke:browser")) {
        issues.push("finalQa.browserSmokeDebugAutominer must record debug autominer smoke command");
      }
      if (!hasIsoTimestamp(smoke.checkedAt)) {
        issues.push("finalQa.browserSmokeDebugAutominer.checkedAt must be ISO-8601 UTC");
      } else if (!hasNonFutureIsoTimestamp(smoke.checkedAt)) {
        issues.push("finalQa.browserSmokeDebugAutominer.checkedAt must not be in the future");
      }
      if (!hasHttpsOrigin(smoke.origin)) {
        issues.push("finalQa.browserSmokeDebugAutominer.origin must be the exact HTTPS production origin");
      } else if (expectedOrigin && normalizeOrigin(smoke.origin) !== normalizeOrigin(expectedOrigin)) {
        issues.push("finalQa.browserSmokeDebugAutominer.origin must match configured production origin");
      }
      if (smoke.debugAutominerScenariosPassed !== true) {
        issues.push("finalQa.browserSmokeDebugAutominer.debugAutominerScenariosPassed must be true");
      }
      if (smoke.noUnexpectedConsoleErrors !== true) {
        issues.push("finalQa.browserSmokeDebugAutominer.noUnexpectedConsoleErrors must be true");
      }
      if (smoke.unsupportedWalletWarningsNotMasked !== true) {
        issues.push("finalQa.browserSmokeDebugAutominer.unsupportedWalletWarningsNotMasked must be true");
      }
    }

    const cleanWallet = manifest.wallet?.cleanWalletFirstTx;
    if (isPlainObject(cleanWallet) && !isRealTx(cleanWallet.txHash)) {
      issues.push("wallet.cleanWalletFirstTx must include a real non-zero txHash");
    }
    if (isPlainObject(cleanWallet) && !hasText(cleanWallet.network)) {
      issues.push("wallet.cleanWalletFirstTx.network is missing");
    }
    if (isPlainObject(cleanWallet) && hasRealText(targetNetwork) && hasText(cleanWallet.network) && normalizeNetwork(cleanWallet.network) !== normalizeNetwork(targetNetwork)) {
      issues.push("wallet.cleanWalletFirstTx.network must match targetNetwork");
    }
    if (isPlainObject(cleanWallet)) {
      const cleanWalletChainId = positiveInteger(cleanWallet.chainId);
      if (cleanWalletChainId == null) {
        issues.push("wallet.cleanWalletFirstTx.chainId must be a positive integer");
      } else if (targetChainId && cleanWalletChainId !== targetChainId) {
        issues.push("wallet.cleanWalletFirstTx.chainId must match targetChainId");
      }
      if (!hasCleanWalletReceiptProof(cleanWallet)) {
        issues.push("wallet.cleanWalletFirstTx evidence must include receipt/explorer confirmation proof");
      }
    }

    const mobileWeb3Browser = manifest.wallet?.mobileWeb3Browser;
    if (isPlainObject(mobileWeb3Browser) && !hasMobileDeviceProof(mobileWeb3Browser)) {
      issues.push("wallet.mobileWeb3Browser evidence must include mobile device, wallet app, or viewport proof");
    }

    const privyAllowedOrigins = manifest.wallet?.privyAllowedOrigins;
    if (isPlainObject(privyAllowedOrigins)) {
      if (!hasHttpsOrigin(privyAllowedOrigins.origin)) {
        issues.push("wallet.privyAllowedOrigins.origin must be the exact HTTPS production origin");
      }
      if (
        expectedOrigin &&
        hasHttpsOrigin(privyAllowedOrigins.origin) &&
        normalizeOrigin(privyAllowedOrigins.origin) !== normalizeOrigin(expectedOrigin)
      ) {
        issues.push("wallet.privyAllowedOrigins.origin must match configured production origin");
      }
      if (privyAllowedOrigins.exactProductionOrigin !== true) {
        issues.push("wallet.privyAllowedOrigins.exactProductionOrigin must be true");
      }
      if (privyAllowedOrigins.developmentFallbackAppIdUsed === true) {
        issues.push("wallet.privyAllowedOrigins.developmentFallbackAppIdUsed must not be true");
      }
      if (privyAllowedOrigins.productionAppIdConfigured !== true) {
        issues.push("wallet.privyAllowedOrigins.productionAppIdConfigured must be true");
      }
      if (!hasIsoTimestamp(privyAllowedOrigins.checkedAt)) {
        issues.push("wallet.privyAllowedOrigins.checkedAt must be ISO-8601 UTC");
      } else if (!hasNonFutureIsoTimestamp(privyAllowedOrigins.checkedAt)) {
        issues.push("wallet.privyAllowedOrigins.checkedAt must not be in the future");
      }
    }

    const wrongNetwork = manifest.wallet?.wrongNetwork;
    if (isPlainObject(wrongNetwork) && wrongNetwork.unsupportedChainWarningVisible !== true) {
      issues.push("wallet.wrongNetwork.unsupportedChainWarningVisible must be true");
    }
    if (isPlainObject(wrongNetwork)) {
      const wrongTargetChainId = positiveInteger(wrongNetwork.targetChainId);
      const testedChainId = positiveInteger(wrongNetwork.testedChainId);
      if (wrongTargetChainId == null) {
        issues.push("wallet.wrongNetwork.targetChainId must be a positive integer");
      } else if (targetChainId && wrongTargetChainId !== targetChainId) {
        issues.push("wallet.wrongNetwork.targetChainId must match targetChainId");
      }
      if (testedChainId == null) {
        issues.push("wallet.wrongNetwork.testedChainId must be a positive integer");
      } else if (targetChainId && testedChainId === targetChainId) {
        issues.push("wallet.wrongNetwork.testedChainId must differ from targetChainId");
      }
    }

    const betHistoryFields = manifest.supportAuditVisibility?.betHistoryFields;
    if (isPlainObject(betHistoryFields) && !includesAll(betHistoryFields.fields, REQUIRED_BET_HISTORY_FIELDS)) {
      issues.push(`supportAuditVisibility.betHistoryFields.fields must include ${REQUIRED_BET_HISTORY_FIELDS.join(", ")}`);
    }

    const autoMinerLogFields = manifest.supportAuditVisibility?.autoMinerLogFields;
    if (isPlainObject(autoMinerLogFields) && !includesAll(autoMinerLogFields.fields, REQUIRED_AUTOMINER_LOG_FIELDS)) {
      issues.push(`supportAuditVisibility.autoMinerLogFields.fields must include ${REQUIRED_AUTOMINER_LOG_FIELDS.join(", ")}`);
    }

    console.log("## Required Checks");
    if (summaryOnly) {
      printTable(
        ["Group", "Checks"],
        Object.entries(requiredGroups).map(([group, checks]) => [group, String(checks.length)]),
      );
    } else {
      printTable(["Group", "Check", "Status OK", "Evidence"], rows);
    }
  }
}

console.log("");
console.log(`Summary: ${issues.length === 0 ? "QA proof completed without detected issues" : `${issues.length} issue(s): ${issues.join("; ")}`}; ${launchGateSummary(issues.length)}.`);
console.log("Copy this summary into `docs/mainnet-proof-record.md` only after confirming the manifest reflects real wallet, UX, browser, and mobile QA.");

if (strict && issues.length > 0) {
  process.exitCode = 1;
}
