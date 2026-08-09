import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const strict = process.argv.includes("--strict") || process.env.PROOF_STRICT === "1";
const summaryOnly = process.argv.includes("--summary-only");
const repoRoot = process.cwd();
const MAX_INDEXER_ARTIFACT_TEXT_BYTES = 256 * 1024;
const MAX_INDEXER_PROOF_MANIFEST_BYTES = 512 * 1024;
const args = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--") && arg.includes("="))
    .map((arg) => {
      const [key, ...rest] = arg.slice(2).split("=");
      return [key, rest.join("=")];
    }),
);

const REQUIRED_TABLES = [
  "meta",
  "epochs",
  "scoped_epochs",
  "bets",
  "scoped_bets",
  "jackpots",
  "scoped_jackpots",
  "reward_claims",
  "scoped_reward_claims",
  "protocol_fee_flushes",
  "scoped_protocol_fee_flushes",
  "scoped_indexer_events",
];
const REQUIRED_CHAIN_COMPARISONS = ["jackpot", "deposits", "rewards", "rebates", "latestEpochs"];
const indexerLaunchGates = ["G7"];
const indexerLaunchGateGroups = "indexer=1";
const TEMPLATE_VALUE_RE = /REPLACE_|<REDACTED>|TODO|TBD/i;
const secretKeyPattern = /(secret|private[_-]?key|mnemonic|webhook|dsn|api[_-]?key|api[_-]?token|auth[_-]?token|access[_-]?token|bearer|session|cookie|password)/i;
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const CANONICAL_NON_NEGATIVE_INTEGER_RE = /^(?:0|[1-9]\d{0,15})$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const knownNetworkChainIds = new Map([
  ["mainnet", "59144"],
  ["sepolia", "59141"],
]);

function env(name) {
  return process.env[name]?.trim() || "";
}

function argOrEnv(argName, envName) {
  return args.get(argName)?.trim() || env(envName);
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
  return resolve(left).replace(/[\\/]+/g, "/").toLowerCase() === resolve(right).replace(/[\\/]+/g, "/").toLowerCase();
}

function isNonNegativeInteger(value) {
  return parseCanonicalNonNegativeInteger(value) !== null;
}

function isPositiveInteger(value) {
  return parseCanonicalPositiveInteger(value) !== null;
}

function parseCanonicalNonNegativeInteger(value) {
  const text = String(value ?? "").trim();
  if (!CANONICAL_NON_NEGATIVE_INTEGER_RE.test(text)) return null;
  const parsed = BigInt(text);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) return null;
  return Number(parsed);
}

function parseCanonicalPositiveInteger(value) {
  const parsed = parseCanonicalNonNegativeInteger(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function integerString(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && parseCanonicalNonNegativeInteger(value) !== null) return value.trim();
  return "";
}

function nonEmptyEpochList(value) {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((entry) => {
    if (typeof entry === "number") return Number.isSafeInteger(entry) && entry >= 0;
    return typeof entry === "string" && parseCanonicalNonNegativeInteger(entry) !== null;
  });
}

function normalizeNetwork(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["main", "linea", "prod", "production"].includes(normalized)) return "mainnet";
  if (["testnet", "linea-sepolia", "sepolia-testnet"].includes(normalized)) return "sepolia";
  return normalized;
}

function normalizeAddress(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isRealAddress(value) {
  const normalized = String(value ?? "").trim();
  return ADDRESS_RE.test(normalized) && normalizeAddress(normalized) !== "0x0000000000000000000000000000000000000000";
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
        /^127\./.test(host) ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
      );
  } catch {
    return false;
  }
}

function hasConcreteText(value) {
  if (!hasRealText(value)) return false;
  const text = String(value).trim();
  return hasPublicHttpsUrl(text) ||
    /(?:^|[\\/\s])[^\s]+\.(?:json|jsonl|log|md|txt|csv|sqlite|db)(?:\b|$)/i.test(text) ||
    /\bnpm(?:\.cmd)?\s+run\s+(?:indexer:once|health:prod|proof:[a-z0-9:-]+)\b/i.test(text) ||
    /\bproof:[a-z0-9:-]+\b/i.test(text) ||
    /\[indexer\]/i.test(text) ||
    /\b(?:direct[-\s]?chain|chain[-\s]?snapshot|rpcChainId|contractAddress|finalityLagBlocks)\b/i.test(text) ||
    /\b0x[a-fA-F0-9]{40}\b/.test(text);
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
    value.path,
  ].some(hasConcreteText);
}

function localArtifactPathFromText(value, key = "") {
  if (!hasRealText(value)) return "";
  const text = String(value).trim().replace(/^`|`$/g, "");
  if (/^https?:\/\//i.test(text)) return "";
  const artifactMatch = text.match(/^artifact:\s*(\S+)/i);
  const candidate = (artifactMatch ? artifactMatch[1] : text).trim().replace(/^`|`$/g, "").replace(/[),.;]+$/g, "");
  if (/^https?:\/\//i.test(candidate)) return "";
  const keySuggestsPath = key === "path" || /(?:evidencePath|artifact|link)$/i.test(key);
  const valueLooksLikePath = /(?:^|[\\/\s])[^\s]+\.(?:json|jsonl|log|md|txt|csv|sqlite|db)(?:\b|$)/i.test(candidate);
  return (artifactMatch || keySuggestsPath) && valueLooksLikePath ? candidate : "";
}

function localArtifactIsFile(artifactPath) {
  return regularFileStat(resolve(process.cwd(), artifactPath)) !== null;
}

function readBoundedArtifactText(resolved) {
  const fd = openSync(resolved, "r");
  try {
    const buffer = Buffer.alloc(MAX_INDEXER_ARTIFACT_TEXT_BYTES);
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

function evidenceContentText(value) {
  return [evidenceText(value), ...localArtifactContents(value)].filter(Boolean).join("\n");
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

function sharedIndexerSectionArtifactIssues(manifest) {
  const sections = [
    ["dryRun", manifest.dryRun],
    ["finality", manifest.finality],
    ["chainSnapshot", manifest.chainSnapshot],
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

function evidenceText(value) {
  if (!isPlainObject(value)) return "";
  return [
    value.evidence,
    value.evidencePath,
    value.link,
    value.summary,
    value.artifact,
    value.notes,
    value.path,
  ].filter(hasRealText).join("\n");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasIndexerBlockMarker(value, label, expected) {
  const text = evidenceContentText(value);
  if (!text || !expected) return false;
  const pattern = new RegExp(`\\[indexer\\]\\s+${escapeRegExp(label)}:\\s*${escapeRegExp(expected)}\\b`, "i");
  return pattern.test(text);
}

function normalizedOrigin(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    if (url.username || url.password) return "";
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return "";
  }
}

function expectedProductionHealthOrigin() {
  return normalizedOrigin(env("PROD_HEALTH_BASE_URL") || "https://playlore.xyz");
}

function hasProductionHealthBaseEvidence(value) {
  if (!isPlainObject(value)) return false;
  const expected = expectedProductionHealthOrigin();
  const texts = [evidenceText(value)];
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") continue;
    const artifactPath = localArtifactPathFromText(entry, key);
    if (!artifactPath) continue;
    const absolute = resolve(process.cwd(), artifactPath);
    if (localArtifactIsFile(artifactPath)) texts.push(readBoundedArtifactText(absolute));
  }
  return texts.some((text) => {
    const match = String(text).match(/\bbase=([^\s]+)/i);
    return match && normalizedOrigin(match[1]) === expected;
  });
}

function hasNumericFinalityLagEvidence(value) {
  if (!isPlainObject(value)) return false;
  const text = [value.evidence, value.evidencePath, value.link, value.summary, value.artifact, value.notes]
    .filter(hasRealText)
    .join("\n");
  const match = text.match(/\bfinalityLagBlocks=([^\s]+)/i);
  return Boolean(match && parseCanonicalNonNegativeInteger(match[1]) !== null);
}

function textHasProductionBaseAndSafeFinality(text) {
  const content = String(text ?? "");
  const expected = expectedProductionHealthOrigin();
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
  return Boolean(baseMatches && finalityMatch && parseCanonicalNonNegativeInteger(finalityMatch[1]) !== null);
}

function localArtifactFinalityEvidenceHasSafeLag(value) {
  const contents = localArtifactContents(value);
  return contents.length > 0 && contents.some((content) => textHasProductionBaseAndSafeFinality(content));
}
function hasConfiguredRpcSource(value) {
  const raw = String(value ?? "").trim();
  const normalized = raw.toLowerCase();
  if (
    normalized.length === 0 ||
    TEMPLATE_VALUE_RE.test(normalized) ||
    normalized === "built-in fallback" ||
    normalized === "fallback" ||
    normalized === "default"
  ) return false;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return true;

  try {
    const parsed = new URL(raw);
    return !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
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
    issues.push("indexer proof manifest must be an object");
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
    issues.push(`local indexer artifact references must exist: ${formatMissingLocalArtifactRefs(missingArtifactRefs)}`);
  }
  const sharedSectionArtifacts = sharedIndexerSectionArtifactIssues(manifest);
  if (sharedSectionArtifacts.length > 0) {
    issues.push(`indexer evidence sections must use distinct local artifact files across ${sharedSectionArtifacts.slice(0, 3).join(", ")}`);
  }

  const dryRun = isPlainObject(manifest.dryRun) ? manifest.dryRun : {};
  if (!isPlainObject(manifest.dryRun)) issues.push("dryRun section is missing");
  if (!statusOk(dryRun.status)) issues.push("dryRun.status must be ok/pass/verified");
  if (!String(dryRun.command ?? "").includes("indexer:once")) issues.push("dryRun.command must record npm run indexer:once");
  if (dryRun.freshDb !== true) issues.push("dryRun.freshDb must be true");
  if (dryRun.fromDeployBlock !== true) issues.push("dryRun.fromDeployBlock must be true");
  if (!hasRealText(dryRun.dbPath)) {
    issues.push("dryRun.dbPath must record the [indexer] SQLite path used by indexer:once");
  } else {
    const dryRunDb = pathStatus(dryRun.dbPath);
    if (!dryRunDb.isAbsolute) issues.push("dryRun.dbPath must be absolute");
    if (dryRunDb.insideRepo) issues.push("dryRun.dbPath must be outside the repo checkout");
    if (sourceRaw && !samePath(dryRunDb.absolute, source.absolute)) {
      issues.push("dryRun.dbPath must match LORE_DB_PATH or --db");
    }
  }
  const manifestStartBlock = integerString(dryRun.startBlock);
  const manifestDeployBlock = integerString(dryRun.deployBlock);
  if (!manifestStartBlock) issues.push("dryRun.startBlock must be a non-negative integer");
  if (!manifestDeployBlock) issues.push("dryRun.deployBlock must be a non-negative integer");
  if (manifestStartBlock && manifestDeployBlock && manifestStartBlock !== manifestDeployBlock) {
    issues.push("dryRun.startBlock must match dryRun.deployBlock");
  }
  if (startBlock && manifestStartBlock && manifestStartBlock !== startBlock) {
    issues.push("dryRun.startBlock must match INDEXER_START_BLOCK");
  }
  if (publicDeployBlock && manifestDeployBlock && manifestDeployBlock !== publicDeployBlock) {
    issues.push("dryRun.deployBlock must match NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK");
  }
  if (manifestDeployBlock && !hasIndexerBlockMarker(dryRun, "Deploy block", manifestDeployBlock)) {
    issues.push("dryRun evidence must include [indexer] Deploy block matching dryRun.deployBlock");
  }
  if (manifestStartBlock && !hasIndexerBlockMarker(dryRun, "Start block", manifestStartBlock)) {
    issues.push("dryRun evidence must include [indexer] Start block matching dryRun.startBlock");
  }
  if (!hasIsoTimestamp(dryRun.timestamp)) {
    issues.push("dryRun.timestamp must be ISO-8601 UTC");
  } else if (!hasNonFutureIsoTimestamp(dryRun.timestamp)) {
    issues.push("dryRun.timestamp must not be in the future");
  }
  if (!hasEvidence(dryRun)) issues.push("dryRun has no evidence");
  if (hasEvidence(dryRun) && !hasConcreteEvidence(dryRun)) issues.push("dryRun must include concrete indexer:once evidence path, command output, or indexer log summary");
  if (hasLocalArtifactRefs(dryRun)) {
    const dryRunArtifactPattern = new RegExp(`\\[indexer\\]\\s+Deploy block:\\s*${escapeRegExp(manifestDeployBlock)}\\b[\\s\\S]*\\[indexer\\]\\s+Start block:\\s*${escapeRegExp(manifestStartBlock)}\\b`, "i");
    if (manifestDeployBlock && manifestStartBlock && !localArtifactEvidenceMentions(dryRun, dryRunArtifactPattern)) {
      issues.push("dryRun evidence artifact must include [indexer] Deploy block and [indexer] Start block");
    }
  }

  const finality = isPlainObject(manifest.finality) ? manifest.finality : {};
  if (!isPlainObject(manifest.finality)) issues.push("finality section is missing");
  if (finality.finalityBlocksPositive !== true) issues.push("finality.finalityBlocksPositive must be true");
  const manifestFinalityBlocks = integerString(finality.finalityBlocks);
  if (!isPositiveInteger(manifestFinalityBlocks)) issues.push("finality.finalityBlocks must be a positive integer");
  if (finalityBlocks && manifestFinalityBlocks && manifestFinalityBlocks !== finalityBlocks) {
    issues.push("finality.finalityBlocks must match INDEXER_FINALITY_BLOCKS");
  }
  if (finality.dataSyncHealthFinalityAware !== true) issues.push("finality.dataSyncHealthFinalityAware must be true");
  if (!hasNumericFinalityLagEvidence(finality)) issues.push("finality.evidence must include numeric finalityLagBlocks from health:prod");
  if (!hasProductionHealthBaseEvidence(finality)) issues.push("finality.evidence must include base=<production origin> from health:prod");
  if (!hasIsoTimestamp(finality.checkedAt)) {
    issues.push("finality.checkedAt must be ISO-8601 UTC");
  } else if (!hasNonFutureIsoTimestamp(finality.checkedAt)) {
    issues.push("finality.checkedAt must not be in the future");
  }
  if (!hasEvidence(finality)) issues.push("finality has no evidence");
  if (hasEvidence(finality) && !hasConcreteEvidence(finality)) issues.push("finality must include concrete health:prod/finality evidence path, command output, or finalityLagBlocks summary");
  if (hasLocalArtifactRefs(finality) && !localArtifactFinalityEvidenceHasSafeLag(finality)) {
    issues.push("finality evidence artifact must include health:prod base and canonical non-negative decimal finalityLagBlocks");
  }

  const chainSnapshot = isPlainObject(manifest.chainSnapshot) ? manifest.chainSnapshot : {};
  if (!isPlainObject(manifest.chainSnapshot)) issues.push("chainSnapshot section is missing");
  if (!hasRealText(chainSnapshot.path)) issues.push("chainSnapshot.path is missing");
  const expectedSnapshotChainId = integerString(chainSnapshot.expectedChainId);
  const rpcSnapshotChainId = integerString(chainSnapshot.rpcChainId);
  if (!isPositiveInteger(expectedSnapshotChainId)) issues.push("chainSnapshot.expectedChainId must be a positive integer");
  if (!isPositiveInteger(rpcSnapshotChainId)) issues.push("chainSnapshot.rpcChainId must be a positive integer");
  if (expectedSnapshotChainId && expectedSnapshotChainId !== "59144") {
    issues.push("chainSnapshot.expectedChainId must be 59144 for Linea mainnet launch proof");
  }
  if (rpcSnapshotChainId && rpcSnapshotChainId !== "59144") {
    issues.push("chainSnapshot.rpcChainId must be 59144 for Linea mainnet launch proof");
  }
  if (expectedSnapshotChainId && rpcSnapshotChainId && expectedSnapshotChainId !== rpcSnapshotChainId) {
    issues.push("chainSnapshot.expectedChainId must match chainSnapshot.rpcChainId");
  }
  if (chainSnapshot.rpcChainIdMatches !== true) issues.push("chainSnapshot.rpcChainIdMatches must be true");
  const envChainId = env("LINEA_CHAIN_ID") || env("NEXT_PUBLIC_LINEA_CHAIN_ID");
  const networkChainId = knownNetworkChainIds.get(normalizeNetwork(env("LINEA_NETWORK") || env("NEXT_PUBLIC_LINEA_NETWORK")));
  const configuredChainId = envChainId || networkChainId || "";
  if (configuredChainId && expectedSnapshotChainId && expectedSnapshotChainId !== configuredChainId) {
    issues.push("chainSnapshot.expectedChainId must match configured Linea chain id");
  }
  if (!isRealAddress(chainSnapshot.contractAddress)) issues.push("chainSnapshot.contractAddress is missing, zero, or invalid");
  if (!hasConfiguredRpcSource(chainSnapshot.rpcSource)) {
    issues.push("chainSnapshot.rpcSource must record a configured RPC source");
  }
  const configuredContractAddress = env("KEEPER_CONTRACT_ADDRESS") || env("NEXT_PUBLIC_CONTRACT_ADDRESS");
  if (
    configuredContractAddress &&
    isRealAddress(chainSnapshot.contractAddress) &&
    normalizeAddress(chainSnapshot.contractAddress) !== normalizeAddress(configuredContractAddress)
  ) {
    issues.push("chainSnapshot.contractAddress must match configured contract address");
  }
  if (chainSnapshot.contractAddressMatches !== true) {
    issues.push("chainSnapshot.contractAddressMatches must be true");
  }
  if (!hasIsoTimestamp(chainSnapshot.checkedAt)) {
    issues.push("chainSnapshot.checkedAt must be ISO-8601 UTC");
  } else if (!hasNonFutureIsoTimestamp(chainSnapshot.checkedAt)) {
    issues.push("chainSnapshot.checkedAt must not be in the future");
  }
  if (!hasEvidence(chainSnapshot)) issues.push("chainSnapshot has no evidence");
  if (hasEvidence(chainSnapshot) && !hasConcreteEvidence(chainSnapshot)) issues.push("chainSnapshot must include concrete direct-chain snapshot path, link, artifact, or RPC/contract summary");
  if (hasRealText(chainSnapshot.path)) {
    const snapshotArtifact = localArtifactPathFromText(chainSnapshot.path, "path");
    const snapshotContent = localArtifactContentFromText(chainSnapshot.path, "path");
    if (snapshotArtifact && !localArtifactIsFile(snapshotArtifact)) {
      issues.push("chainSnapshot.path must point to an existing local artifact");
    }
    if (snapshotArtifact && snapshotContent && !/\bgeneratedAt\b[\s\S]*\brpcChainId\b[\s\S]*\bcontractAddress\b|\bcontractAddress\b[\s\S]*\brpcChainId\b[\s\S]*\bgeneratedAt\b/i.test(snapshotContent)) {
      issues.push("chainSnapshot.path artifact must include generatedAt, rpcChainId, and contractAddress");
    }
  }

  const chainComparison = isPlainObject(manifest.chainComparison) ? manifest.chainComparison : {};
  if (!isPlainObject(manifest.chainComparison)) issues.push("chainComparison section is missing");
  for (const key of REQUIRED_CHAIN_COMPARISONS) {
    const comparison = chainComparison[key];
    if (!isPlainObject(comparison)) {
      issues.push(`chainComparison.${key} is missing`);
      continue;
    }
    if (comparison.matches !== true) issues.push(`chainComparison.${key}.matches must be true`);
    if (!nonEmptyEpochList(comparison.checkedEpochs)) {
      issues.push(`chainComparison.${key}.checkedEpochs must include at least one checked epoch`);
    }
    if (!hasIsoTimestamp(comparison.checkedAt)) {
      issues.push(`chainComparison.${key}.checkedAt must be ISO-8601 UTC`);
    } else if (!hasNonFutureIsoTimestamp(comparison.checkedAt)) {
      issues.push(`chainComparison.${key}.checkedAt must not be in the future`);
    }
    if (!hasEvidence(comparison)) issues.push(`chainComparison.${key} has no evidence`);
    if (hasEvidence(comparison) && !hasConcreteEvidence(comparison)) {
      issues.push(`chainComparison.${key} must include concrete direct-chain comparison path, link, artifact, or summary`);
    }
    if (hasLocalArtifactRefs(comparison)) {
      const comparisonTextPattern = new RegExp(`\\b(?:${escapeRegExp(key)}|direct[-\\s]?chain|chain comparison|indexer)\\b`, "i");
      const comparisonArtifactPattern = /\b(?:direct[-\s]?chain|chain comparison)\b|\bgeneratedAt\b[\s\S]*\brpcChainId\b[\s\S]*\bcontractAddress\b|\bcontractAddress\b[\s\S]*\brpcChainId\b[\s\S]*\bgeneratedAt\b/i;
      if (!comparisonTextPattern.test(evidenceContentText(comparison)) || !localArtifactEvidenceMentions(comparison, comparisonArtifactPattern)) {
        issues.push(`chainComparison.${key} evidence artifact must mention ${key}, direct-chain, chain comparison, or indexer proof`);
      }
    }
  }

  return { dryRun, finality, chainSnapshot, chainComparison };
}

function readCount(db, table) {
  try {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
    return parseCanonicalNonNegativeInteger(row?.count);
  } catch {
    return null;
  }
}

function getMetaRows(db) {
  try {
    return db.prepare(`
      SELECT key, value
      FROM meta
      WHERE key = ?
        OR key LIKE ?
        OR key LIKE ?
        OR key LIKE ?
      ORDER BY key
    `).all(
      "__storage_active_contract_scope",
      "%lastIndexedBlock",
      "%currentEpoch",
      "%repairCursorBlock",
    );
  } catch {
    return [];
  }
}

function findMetaValue(rows, suffix) {
  const row = [...rows].reverse().find((entry) => String(entry.key ?? "").endsWith(suffix));
  return typeof row?.value === "string" ? row.value : "";
}

function regularFileStat(filePath) {
  try {
    const stats = statSync(filePath);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
}

function fmtMtime(filePath) {
  const stats = regularFileStat(filePath);
  return stats ? stats.mtime.toISOString() : "missing";
}

function fileExists(filePath) {
  return regularFileStat(filePath) !== null;
}

async function inspectDb(dbPath) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath);
  try {
    const integrityRows = db.prepare("PRAGMA integrity_check").all();
    const integrity = integrityRows.map((row) => String(row.integrity_check ?? Object.values(row)[0] ?? "")).join(", ");
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
      .map((row) => String(row.name));
    const counts = Object.fromEntries(REQUIRED_TABLES.map((table) => [table, readCount(db, table)]));
    const metaRows = getMetaRows(db);
    return { integrity, tables, counts, metaRows };
  } finally {
    db.close();
  }
}

function launchGateSummary(issueCount) {
  const label = issueCount > 0 ? "blocked" : "covered";
  return `${label} gates: ${indexerLaunchGates.join(", ")}; groups: ${indexerLaunchGateGroups}`;
}

const sourceRaw = argOrEnv("db", "LORE_DB_PATH");
const source = pathStatus(sourceRaw);
const startBlock = env("INDEXER_START_BLOCK");
const publicDeployBlock = env("NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK");
const finalityBlocks = env("INDEXER_FINALITY_BLOCKS");
const manifestPath = args.get("manifest")?.trim() || env("INDEXER_PROOF_PATH") || "docs/indexer-proof.json";
const issues = [];
const startBlockParsed = parseCanonicalNonNegativeInteger(startBlock);
const publicDeployBlockParsed = parseCanonicalNonNegativeInteger(publicDeployBlock);
const finalityBlocksParsed = parseCanonicalPositiveInteger(finalityBlocks);
const minScopedEpochsRaw = env("INDEXER_DRY_RUN_MIN_SCOPED_EPOCHS") || args.get("min-scoped-epochs")?.trim() || "0";
const minScopedBetsRaw = env("INDEXER_DRY_RUN_MIN_SCOPED_BETS") || args.get("min-scoped-bets")?.trim() || "0";
const minScopedEpochs = parseCanonicalNonNegativeInteger(minScopedEpochsRaw);
const minScopedBets = parseCanonicalNonNegativeInteger(minScopedBetsRaw);
let manifestSummary = null;

console.log("# Indexer Dry-Run Proof");
console.log("");
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log(`Strict: ${strict ? "yes" : "no"}`);
console.log(`Manifest: ${summaryOnly ? (fileExists(resolve(repoRoot, manifestPath)) ? "present" : "missing") : resolve(repoRoot, manifestPath)}`);
console.log("");

if (!sourceRaw) issues.push("LORE_DB_PATH or --db is missing");
if (sourceRaw && !existsSync(source.absolute)) issues.push("dry-run DB does not exist");
if (sourceRaw && existsSync(source.absolute) && !fileExists(source.absolute)) issues.push("dry-run DB must be a file");
if (strict && sourceRaw && (!source.isAbsolute || source.insideRepo)) {
  issues.push("dry-run DB path must be absolute and outside repo for launch proof");
}
if (strict && (startBlockParsed === null || publicDeployBlockParsed === null)) {
  issues.push("INDEXER_START_BLOCK and NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK must be canonical non-negative decimal integers");
}
if (strict && startBlockParsed !== null && publicDeployBlockParsed !== null && startBlock !== publicDeployBlock) {
  issues.push("INDEXER_START_BLOCK and NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK must match");
}
if (strict && finalityBlocksParsed === null) {
  issues.push("INDEXER_FINALITY_BLOCKS must be a canonical positive decimal integer for launch proof");
}
if (minScopedEpochs === null) {
  issues.push("INDEXER_DRY_RUN_MIN_SCOPED_EPOCHS/--min-scoped-epochs must be a canonical non-negative decimal integer");
}
if (minScopedBets === null) {
  issues.push("INDEXER_DRY_RUN_MIN_SCOPED_BETS/--min-scoped-bets must be a canonical non-negative decimal integer");
}
if (strict && /\.draft\.json$/i.test(resolve(repoRoot, manifestPath))) {
  issues.push("draft proof manifests are not accepted as launch proof");
}
const resolvedManifestPath = resolve(repoRoot, manifestPath);
if (strict && !existsSync(resolvedManifestPath)) {
  issues.push("indexer proof manifest is missing");
}
if (existsSync(resolvedManifestPath)) {
  const manifestStat = statSync(resolvedManifestPath);
  if (!manifestStat.isFile()) {
    issues.push("indexer proof manifest must be a file");
  } else if (manifestStat.size > MAX_INDEXER_PROOF_MANIFEST_BYTES) {
    issues.push("indexer proof manifest is too large to validate safely");
  } else {
    try {
      const manifest = JSON.parse(readFileSync(resolvedManifestPath, "utf8"));
      manifestSummary = validateManifest(manifest, issues);
    } catch (error) {
      issues.push(`indexer proof manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

printTable(["Field", "Value"], [
  ["db", summaryOnly ? (sourceRaw && fileExists(source.absolute) ? "present" : "missing") : (sourceRaw ? source.absolute : "missing")],
  ["db mtime", summaryOnly ? (sourceRaw && fileExists(source.absolute) ? "present" : "missing") : (sourceRaw ? fmtMtime(source.absolute) : "missing")],
  ["INDEXER_START_BLOCK", startBlock || "missing"],
  ["NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK", publicDeployBlock || "missing"],
  ["INDEXER_FINALITY_BLOCKS", finalityBlocks || "missing"],
  ["min scoped epochs", minScopedEpochs === null ? "invalid" : String(minScopedEpochs)],
  ["min scoped bets", minScopedBets === null ? "invalid" : String(minScopedBets)],
  ["manifest", summaryOnly ? (fileExists(resolve(repoRoot, manifestPath)) ? "present" : "missing") : resolve(repoRoot, manifestPath)],
]);

if (manifestSummary) {
  console.log("");
  console.log("## Indexer Manifest");
  printTable(["Section", "Status"], [
    ["dryRun", statusOk(manifestSummary.dryRun.status) ? "checked" : "issue"],
    ["finality", manifestSummary.finality.finalityBlocksPositive === true ? "checked" : "issue"],
    ["chainSnapshot", manifestSummary.chainSnapshot.rpcChainIdMatches === true ? "checked" : "issue"],
    [
      "chainComparison",
      REQUIRED_CHAIN_COMPARISONS.every((key) => manifestSummary.chainComparison[key]?.matches === true) ? "checked" : "issue",
    ],
  ]);
}

if (issues.length === 0) {
  const inspected = await inspectDb(source.absolute);
  if (inspected.integrity !== "ok") issues.push(`integrity_check returned ${inspected.integrity}`);
  for (const table of REQUIRED_TABLES) {
    if (!inspected.tables.includes(table)) issues.push(`missing required table ${table}`);
  }

  const lastIndexedBlock = findMetaValue(inspected.metaRows, "lastIndexedBlock");
  const currentEpoch = findMetaValue(inspected.metaRows, "currentEpoch");
  const repairCursorBlock = findMetaValue(inspected.metaRows, "repairCursorBlock");
  if (strict && !isNonNegativeInteger(lastIndexedBlock)) issues.push("lastIndexedBlock meta is missing or invalid");
  if (strict && !isPositiveInteger(currentEpoch)) issues.push("currentEpoch meta is missing or invalid");
  if (strict && startBlock && isNonNegativeInteger(lastIndexedBlock) && BigInt(lastIndexedBlock) < BigInt(startBlock)) {
    issues.push("lastIndexedBlock is lower than INDEXER_START_BLOCK");
  }
  if (strict && minScopedEpochs !== null && inspected.counts.scoped_epochs != null && inspected.counts.scoped_epochs < minScopedEpochs) {
    issues.push(`scoped_epochs count ${inspected.counts.scoped_epochs} < ${minScopedEpochs}`);
  }
  if (strict && minScopedBets !== null && inspected.counts.scoped_bets != null && inspected.counts.scoped_bets < minScopedBets) {
    issues.push(`scoped_bets count ${inspected.counts.scoped_bets} < ${minScopedBets}`);
  }

  if (summaryOnly) {
    console.log("");
    console.log("## DB Summary");
    printTable(["Field", "Value"], [
      ["integrity_check", inspected.integrity],
      ["required tables", inspected.tables.length >= REQUIRED_TABLES.length ? "present" : "missing"],
      ["meta rows", String(inspected.metaRows.length)],
    ]);
  } else {
    console.log("");
    console.log("## DB Integrity");
    printTable(["Field", "Value"], [
      ["integrity_check", inspected.integrity],
      ["tables", inspected.tables.join(", ") || "none"],
      ["lastIndexedBlock", lastIndexedBlock || "missing"],
      ["currentEpoch", currentEpoch || "missing"],
      ["repairCursorBlock", repairCursorBlock || "missing"],
    ]);

    console.log("");
    console.log("## Row Counts");
    printTable(
      ["Table", "Rows"],
      Object.entries(inspected.counts).map(([table, count]) => [table, count == null ? "missing" : String(count)]),
    );

    console.log("");
    console.log("## Relevant Meta");
    printTable(
      ["Key", "Value"],
      inspected.metaRows.map((row) => [String(row.key ?? ""), String(row.value ?? "")]),
    );
  }
}

console.log("");
console.log(`Summary: ${issues.length === 0 ? "indexer dry-run proof completed without detected issues" : `${issues.length} issue(s): ${issues.join("; ")}`}; ${launchGateSummary(issues.length)}.`);
console.log("Copy this summary into `docs/mainnet-proof-record.md` only after confirming `npm run indexer:once` used a fresh DB, intended RPC/deploy block, finality lag, and direct chain comparison evidence.");

if (strict && issues.length > 0) {
  process.exitCode = 1;
}
