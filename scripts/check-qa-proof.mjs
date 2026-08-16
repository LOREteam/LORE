import { createHash, createPublicKey, verify } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  hasPublicProofHttpsUrl as hasPublicHttpsUrl,
  isFinalHttpsOrigin as hasHttpsOrigin,
  normalizeProofOrigin,
} from "./collect-proof-common.mjs";
import {
  hasMobileQaDeviceProofText,
  hasQaWalletContentProof,
} from "./qa-proof-policy.mjs";

const strict = process.argv.includes("--strict") || process.env.PROOF_STRICT === "1";
const summaryOnly = process.argv.includes("--summary-only");
const qaLaunchGates = ["G12", "G13", "G14"];
const qaLaunchGateGroups = "qa=3";
const MAX_QA_ARTIFACT_TEXT_BYTES = 256 * 1024;
const MAX_QA_PROOF_MANIFEST_BYTES = 512 * 1024;
const MAX_SECURITY_SCAN_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_SECURITY_SCAN_JSON_BYTES = 16 * 1024 * 1024;
const MAX_SECURITY_SCAN_ARTIFACT_BYTES = 128 * 1024 * 1024;
const MAX_SECURITY_SCAN_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_GIT_OUTPUT_BYTES = 256 * 1024;
const MAX_SECURITY_SCAN_AGE_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const GIT_REVISION_RE = /^[a-f0-9]{40}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const G14_ATTESTATION_DOMAIN = "lore-g14-security-attestation/v2";
const G14_TRUSTED_KEY_ENV = "G14_TRUSTED_REVIEWER_ED25519_SPKI_BASE64";
const G14_EXTERNAL_REQUIRED_MESSAGE = "G14 requires a protected external reviewer trust anchor; local verifier mechanics do not close G14";
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
  return Date.parse(String(value).trim()) <= Date.now() + CLOCK_SKEW_TOLERANCE_MS;
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
  if (/\b[a-z][a-z0-9+.-]*:\/\//i.test(text)) return hasPublicHttpsUrl(text);
  return /(?:^|[\\/\s])[^\s]+\.(?:json|jsonl|log|md|txt|csv|png|jpg|jpeg|webp|html|zip)(?:\b|$)/i.test(text);
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

function regularDirectoryStat(filePath) {
  try {
    const stats = statSync(filePath);
    return stats.isDirectory() ? stats : null;
  } catch {
    return null;
  }
}

function pathInsideOrSame(candidate, root) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256File(filePath, maxBytes) {
  const stats = regularFileStat(filePath);
  if (!stats) throw new Error("not a regular file");
  if (stats.size > maxBytes) throw new Error("artifact exceeds the bounded validation size");
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(64 * 1024);
  const fd = openSync(filePath, "r");
  try {
    let offset = 0;
    while (offset < stats.size) {
      const bytesRead = readSync(fd, buffer, 0, Math.min(buffer.length, stats.size - offset), offset);
      if (bytesRead === 0) throw new Error("artifact changed while being hashed");
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
  } finally {
    closeSync(fd);
  }
  return { digest: hash.digest("hex"), size: stats.size };
}

function parseBoundedJson(filePath, maxBytes, label) {
  const stats = regularFileStat(filePath);
  if (!stats) throw new Error(`${label} must be a regular file`);
  if (stats.size > maxBytes) throw new Error(`${label} is too large to validate safely`);
  const bytes = readFileSync(filePath);
  try {
    return { bytes, value: JSON.parse(bytes.toString("utf8")) };
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

function trustedGitExecutable() {
  const candidates = process.platform === "win32"
    ? [
        "C:\\Program Files\\Git\\cmd\\git.exe",
        "C:\\Program Files\\Git\\bin\\git.exe",
        "C:\\Program Files\\Git\\mingw64\\bin\\git.exe",
      ]
    : ["/usr/bin/git"];
  for (const candidate of candidates) {
    if (!regularFileStat(candidate)) continue;
    try {
      const resolved = realpathSync(candidate);
      if (regularFileStat(resolved)) return resolved;
    } catch {
      // Keep looking; absence of a fixed trusted binary fails closed below.
    }
  }
  return "";
}

function sanitizedGitEnvironment() {
  return {
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_LFS_SKIP_SMUDGE: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    LANG: "C",
    LC_ALL: "C",
  };
}

function runTrustedGit(repoRoot, commandArgs) {
  const executable = trustedGitExecutable();
  if (!executable) return { error: "trusted fixed Git executable is unavailable" };
  const safeDirectory = repoRoot.replaceAll("\\", "/");
  const result = spawnSync(
    executable,
    [
      "--no-pager",
      "-c", `safe.directory=${safeDirectory}`,
      "-c", "core.fsmonitor=false",
      "-c", "core.untrackedCache=false",
      "-c", "core.preloadIndex=false",
      "-c", "core.hooksPath=",
      "-c", "diff.external=",
      ...commandArgs,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: sanitizedGitEnvironment(),
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      timeout: 10_000,
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0) {
    return { error: "trusted Git candidate inspection failed or exceeded its bounded limits" };
  }
  return { output: String(result.stdout ?? "") };
}

function repositoryCandidateState() {
  let repoRoot;
  try {
    repoRoot = realpathSync(process.cwd());
  } catch {
    return { revision: "", clean: false, error: "candidate checkout cannot be resolved" };
  }
  const headResult = runTrustedGit(repoRoot, ["rev-parse", "--verify", "HEAD^{commit}"]);
  const revision = String(headResult.output ?? "").trim().toLowerCase();
  if (headResult.error || !GIT_REVISION_RE.test(revision)) {
    return { revision: "", clean: false, error: headResult.error || "exact immutable candidate revision is unavailable or malformed" };
  }
  const statusResult = runTrustedGit(repoRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignore-submodules=none",
  ]);
  if (statusResult.error) return { revision, clean: false, error: statusResult.error };
  return { revision, clean: statusResult.output.length === 0, error: "" };
}

function configuredCandidateRevision(revision) {
  if (!GIT_REVISION_RE.test(revision)) return "";
  const environmentRevisions = [env("VERCEL_GIT_COMMIT_SHA"), env("GITHUB_SHA"), env("SOURCE_VERSION")].filter(Boolean);
  return environmentRevisions.every((value) => {
    const normalized = value.toLowerCase();
    return GIT_REVISION_RE.test(normalized) && normalized === revision;
  }) ? revision : "";
}

function decodeCanonicalBase64(value, expectedBytes) {
  const text = String(value ?? "").trim();
  if (!text || !/^[A-Za-z0-9+/]+={0,2}$/.test(text) || text.length % 4 !== 0) return null;
  try {
    const bytes = Buffer.from(text, "base64");
    return bytes.length === expectedBytes && bytes.toString("base64") === text ? bytes : null;
  } catch {
    return null;
  }
}

function securityAttestationPayload({
  candidateRevision,
  scanId,
  manifestSha256,
  findingsSha256,
  coverageSha256,
  scanCompletedAt,
  scanSealedAt,
  signedAt,
  expiresAt,
}) {
  return Buffer.from(`${G14_ATTESTATION_DOMAIN}\n${JSON.stringify({
    candidateRevision,
    scanId,
    manifestSha256,
    findingsSha256,
    coverageSha256,
    scanCompletedAt,
    scanSealedAt,
    signedAt,
    expiresAt,
  })}\n`, "utf8");
}

function validateIndependentSecurityAttestation(attestation, payload) {
  const findings = [];
  if (!isPlainObject(attestation)) return ["securityScan.attestation must contain an independent reviewer signature"];
  if ("publicKey" in attestation || "publicKeySpkiBase64" in attestation) {
    findings.push("securityScan.attestation must not supply its own reviewer authority");
  }
  const signedAt = String(attestation.signedAt ?? "").trim();
  const expiresAt = String(attestation.expiresAt ?? "").trim();
  const signedAtMs = Date.parse(signedAt);
  const expiresAtMs = Date.parse(expiresAt);
  if (!hasIsoTimestamp(signedAt) || !hasIsoTimestamp(expiresAt)) {
    findings.push("securityScan.attestation must include canonical signedAt and expiresAt UTC timestamps");
  } else {
    const now = Date.now();
    if (signedAtMs > now + CLOCK_SKEW_TOLERANCE_MS) {
      findings.push("securityScan.attestation.signedAt must not be in the future");
    }
    if (now - signedAtMs > MAX_SECURITY_SCAN_AGE_MS) {
      findings.push("securityScan.attestation must be signed within the last 24 hours");
    }
    if (expiresAtMs <= now) {
      findings.push("securityScan.attestation has expired");
    }
    if (expiresAtMs <= signedAtMs || expiresAtMs - signedAtMs > MAX_SECURITY_SCAN_AGE_MS) {
      findings.push("securityScan.attestation validity must be positive and no longer than 24 hours");
    }
    if (hasIsoTimestamp(payload.scanSealedAt) && signedAtMs < Date.parse(payload.scanSealedAt)) {
      findings.push("securityScan.attestation must be signed after the canonical scan was sealed");
    }
  }
  const trustedKeyBytesText = env(G14_TRUSTED_KEY_ENV);
  if (!trustedKeyBytesText) {
    findings.push(`${G14_TRUSTED_KEY_ENV} protected trust anchor is required`);
    return findings;
  }
  let publicKey;
  let trustedKeyBytes;
  try {
    trustedKeyBytes = Buffer.from(trustedKeyBytesText, "base64");
    if (!trustedKeyBytes.length || trustedKeyBytes.toString("base64") !== trustedKeyBytesText) throw new Error("non-canonical base64");
    publicKey = createPublicKey({ key: trustedKeyBytes, format: "der", type: "spki" });
    if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("wrong key type");
  } catch {
    findings.push(`${G14_TRUSTED_KEY_ENV} must contain one canonical Ed25519 SPKI public key`);
    return findings;
  }
  const trustedKeyId = sha256Bytes(trustedKeyBytes);
  if (String(attestation.reviewerKeyId ?? "").trim() !== trustedKeyId) {
    findings.push("securityScan.attestation.reviewerKeyId must match the protected reviewer trust anchor");
  }
  const signature = decodeCanonicalBase64(attestation.signature, 64);
  if (!signature) {
    findings.push("securityScan.attestation.signature must be a canonical Ed25519 signature");
  } else if (!verify(null, securityAttestationPayload({ ...payload, signedAt, expiresAt }), publicKey, signature)) {
    findings.push("securityScan.attestation signature is invalid for the canonical scan payload");
  }
  return findings;
}

function safeScanArtifactPath(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.includes("\\") || isAbsolute(normalized)) return "";
  const parts = normalized.split("/");
  return parts.some((part) => !part || part === "." || part === "..") ? "" : normalized;
}

function validateSecurityScanProof(proof, expectedCandidateRevision) {
  const findings = [];
  if (!isPlainObject(proof)) {
    return ["securityScan must reference a sealed canonical scan bundle"];
  }

  const bundlePathText = String(proof.bundlePath ?? "").trim();
  const candidateRevision = String(proof.candidateRevision ?? "").trim();
  const manifestSha256 = String(proof.manifestSha256 ?? "").trim();
  if (!isAbsolute(bundlePathText)) findings.push("securityScan.bundlePath must be an absolute path outside the repo checkout");
  if (!GIT_REVISION_RE.test(candidateRevision)) {
    findings.push("securityScan.candidateRevision must be a lowercase 40-character Git revision");
  }
  if (!expectedCandidateRevision) {
    findings.push("exact immutable candidate revision is unavailable or malformed");
  } else if (GIT_REVISION_RE.test(candidateRevision) && candidateRevision !== expectedCandidateRevision) {
    findings.push("securityScan.candidateRevision must match the exact immutable candidate revision");
  }
  if (!SHA256_RE.test(manifestSha256)) {
    findings.push("securityScan.manifestSha256 must be a lowercase SHA-256 digest");
  }
  if (findings.length > 0) return findings;

  const resolvedBundle = resolve(bundlePathText);
  if (!regularDirectoryStat(resolvedBundle)) {
    return ["securityScan.bundlePath must point to an existing directory"];
  }
  let realBundle;
  let realRepo;
  try {
    realBundle = realpathSync(resolvedBundle);
    realRepo = realpathSync(process.cwd());
  } catch {
    return ["securityScan.bundlePath must resolve to a readable directory"];
  }
  if (pathInsideOrSame(realBundle, realRepo)) {
    return ["securityScan.bundlePath must be outside the repo checkout"];
  }

  const scanManifestPath = resolve(realBundle, "scan-manifest.json");
  try {
    if (!pathInsideOrSame(realpathSync(scanManifestPath), realBundle)) {
      return ["security scan scan-manifest.json escapes the sealed bundle"];
    }
  } catch {
    return ["security scan scan-manifest.json must be a readable regular file"];
  }
  let parsedManifest;
  try {
    parsedManifest = parseBoundedJson(scanManifestPath, MAX_SECURITY_SCAN_MANIFEST_BYTES, "security scan scan-manifest.json");
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  if (sha256Bytes(parsedManifest.bytes) !== manifestSha256) {
    return ["securityScan.scan-manifest.json digest does not match manifestSha256"];
  }

  const document = parsedManifest.value;
  const scan = isPlainObject(document) ? document.scan : null;
  if (document?.documentType !== "codex-security.scan-manifest" || document?.schemaVersion !== "1.0" || !isPlainObject(scan)) {
    return ["security scan bundle must use the canonical scan-manifest schema"];
  }
  if (scan.status !== "completed" || !hasIsoTimestamp(scan.completedAt) || !hasIsoTimestamp(scan.sealedAt)) {
    findings.push("security scan bundle must be completed and sealed");
  } else if (!hasNonFutureIsoTimestamp(scan.completedAt) || !hasNonFutureIsoTimestamp(scan.sealedAt)) {
    findings.push("security scan completion and seal timestamps must not be in the future");
  } else if (Date.parse(scan.sealedAt) < Date.parse(scan.completedAt)) {
    findings.push("security scan seal timestamp must not precede completion");
  } else if (
    Date.now() - Date.parse(scan.completedAt) > MAX_SECURITY_SCAN_AGE_MS ||
    Date.now() - Date.parse(scan.sealedAt) > MAX_SECURITY_SCAN_AGE_MS
  ) {
    findings.push("security scan completion and seal must be within the last 24 hours");
  }
  if (scan.producer?.name !== "codex-security-plugin" || !hasRealText(scan.producer?.version)) {
    findings.push("security scan bundle must identify the Codex Security producer");
  }
  if (!hasRealText(scan.id) || !hasRealText(scan.target?.targetId) || !hasRealText(scan.target?.displayName)) {
    findings.push("security scan bundle must include canonical scan and target identities");
  }
  if (scan.target?.kind !== "git_revision") {
    findings.push("security scan target must be an immutable git_revision");
  }
  if (scan.target?.revision !== candidateRevision) {
    findings.push("security scan target revision must match securityScan.candidateRevision");
  }
  if (
    !Array.isArray(scan.scope?.includePaths) ||
    scan.scope.includePaths.length !== 1 ||
    scan.scope.includePaths[0] !== "." ||
    !Array.isArray(scan.scope?.excludePaths) ||
    scan.scope.excludePaths.length !== 0
  ) {
    findings.push("security scan scope must cover the full repository without exclusions");
  }
  if (scan.findingsRef !== "findings.json" || scan.coverageRef !== "coverage.json") {
    findings.push("security scan bundle must use canonical findings.json and coverage.json references");
  }

  const artifactEntries = Array.isArray(scan.artifacts) ? scan.artifacts : [];
  if (artifactEntries.length === 0) {
    findings.push("security scan manifest must list digest-bound artifacts");
    return findings;
  }
  const seenArtifactPaths = new Set();
  const artifactDigests = new Map();
  const verifiedJson = new Map();
  let totalArtifactBytes = 0;
  for (const entry of artifactEntries) {
    const artifactPath = safeScanArtifactPath(entry?.path);
    if (!artifactPath || !SHA256_RE.test(String(entry?.sha256 ?? "")) || !hasRealText(entry?.mediaType)) {
      findings.push("security scan manifest contains an unsafe path or invalid artifact digest");
      continue;
    }
    if (seenArtifactPaths.has(artifactPath)) {
      findings.push(`security scan manifest lists ${artifactPath} more than once`);
      continue;
    }
    seenArtifactPaths.add(artifactPath);
    artifactDigests.set(artifactPath, String(entry.sha256));
    const resolvedArtifact = resolve(realBundle, artifactPath);
    const artifactStats = regularFileStat(resolvedArtifact);
    if (!artifactStats) {
      findings.push(`security scan artifact ${artifactPath} is missing or not a file`);
      continue;
    }
    let realArtifact;
    try {
      realArtifact = realpathSync(resolvedArtifact);
    } catch {
      findings.push(`security scan artifact ${artifactPath} cannot be resolved`);
      continue;
    }
    if (!pathInsideOrSame(realArtifact, realBundle)) {
      findings.push(`security scan artifact ${artifactPath} escapes the sealed bundle`);
      continue;
    }
    totalArtifactBytes += artifactStats.size;
    if (artifactStats.size > MAX_SECURITY_SCAN_ARTIFACT_BYTES || totalArtifactBytes > MAX_SECURITY_SCAN_TOTAL_BYTES) {
      findings.push("security scan artifacts exceed the bounded validation size");
      break;
    }
    try {
      if (artifactPath === "findings.json" || artifactPath === "coverage.json") {
        const parsed = parseBoundedJson(resolvedArtifact, MAX_SECURITY_SCAN_JSON_BYTES, `security scan ${artifactPath}`);
        if (sha256Bytes(parsed.bytes) !== entry.sha256) {
          findings.push(`security scan artifact digest mismatch: ${artifactPath}`);
        } else {
          verifiedJson.set(artifactPath, parsed.value);
        }
      } else if (sha256File(resolvedArtifact, MAX_SECURITY_SCAN_ARTIFACT_BYTES).digest !== entry.sha256) {
        findings.push(`security scan artifact digest mismatch: ${artifactPath}`);
      }
    } catch (error) {
      findings.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (!seenArtifactPaths.has("findings.json") || !seenArtifactPaths.has("coverage.json")) {
    findings.push("security scan manifest must digest-bind findings.json and coverage.json exactly once");
  }
  const findingsDocument = verifiedJson.get("findings.json");
  if (
    findingsDocument?.documentType !== "codex-security.findings" ||
    findingsDocument?.schemaVersion !== "1.0" ||
    findingsDocument?.scanId !== scan.id ||
    !Array.isArray(findingsDocument?.findings)
  ) {
    findings.push("security scan findings.json must be canonical and match the sealed scan id");
  } else {
    const severityLevels = findingsDocument.findings.map((finding) => String(finding?.severity?.level ?? "").toLowerCase());
    if (severityLevels.some((level) => !["critical", "high", "medium", "low", "informational"].includes(level))) {
      findings.push("security scan findings must carry canonical severity levels");
    }
    if (severityLevels.some((level) => ["critical", "high", "medium"].includes(level))) {
      findings.push("security scan must contain zero open Critical/High/Medium findings");
    }
  }
  const coverageDocument = verifiedJson.get("coverage.json");
  if (
    coverageDocument?.documentType !== "codex-security.coverage" ||
    coverageDocument?.schemaVersion !== "1.0" ||
    coverageDocument?.scanId !== scan.id
  ) {
    findings.push("security scan coverage.json must be canonical and match the sealed scan id");
  } else if (
    coverageDocument.completeness !== "complete" ||
    !["repository", "deep_repository"].includes(coverageDocument.mode) ||
    coverageDocument.inventoryStrategy !== "repository" ||
    !Array.isArray(coverageDocument.includePaths) ||
    coverageDocument.includePaths.length !== 1 ||
    coverageDocument.includePaths[0] !== "." ||
    !Array.isArray(coverageDocument.excludePaths) ||
    coverageDocument.excludePaths.length !== 0 ||
    !Array.isArray(coverageDocument.deferred) ||
    coverageDocument.deferred.length !== 0 ||
    !Array.isArray(coverageDocument.explicitExclusions) ||
    coverageDocument.explicitExclusions.length !== 0 ||
    !Array.isArray(coverageDocument.surfaces) ||
    coverageDocument.surfaces.some((surface) => surface?.disposition === "needs_follow_up") ||
    (Array.isArray(coverageDocument.openQuestions) && coverageDocument.openQuestions.length !== 0)
  ) {
    findings.push("security scan coverage must be complete for the full repository without deferrals or exclusions");
  }
  if (
    hasRealText(scan.id) &&
    SHA256_RE.test(artifactDigests.get("findings.json") ?? "") &&
    SHA256_RE.test(artifactDigests.get("coverage.json") ?? "")
  ) {
    findings.push(...validateIndependentSecurityAttestation(proof.attestation, {
      candidateRevision,
      scanId: scan.id,
      manifestSha256,
      findingsSha256: artifactDigests.get("findings.json"),
      coverageSha256: artifactDigests.get("coverage.json"),
      scanCompletedAt: scan.completedAt,
      scanSealedAt: scan.sealedAt,
    }));
  } else {
    findings.push("securityScan.attestation payload cannot be derived from canonical scan artifacts");
  }
  return findings;
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
  if (group === "wallet") {
    return hasQaWalletContentProof(checkId, text);
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

function hasMobileDeviceProof(check) {
  const text = artifactBackedEvidenceText(check);
  return hasMobileQaDeviceProofText(text);
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
  } else if (expectedOrigin && normalizeProofOrigin(origin) !== normalizeProofOrigin(expectedOrigin)) {
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
const candidateState = repositoryCandidateState();
const expectedCandidateRevision = configuredCandidateRevision(candidateState.revision);
const issues = [];
let manifest = null;
let g14VerifierMechanicsPassed = false;

console.log("# Wallet / UX / Final QA Proof Summary");
console.log("");
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log(`Strict: ${strict ? "yes" : "no"}`);
console.log(`Manifest: ${summaryOnly ? fileSummaryStatus(manifestPath) : manifestPath}`);
console.log("");

if (candidateState.error) {
  issues.push(candidateState.error);
} else if (!candidateState.clean) {
  issues.push("candidate checkout must have no staged, unstaged, or untracked files relative to exact HEAD");
}

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
    const securityScanIssues = validateSecurityScanProof(manifest.securityScan, expectedCandidateRevision);
    g14VerifierMechanicsPassed = !candidateState.error && candidateState.clean && securityScanIssues.length === 0;
    issues.push(...securityScanIssues, G14_EXTERNAL_REQUIRED_MESSAGE);

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
  } else if (expectedOrigin && normalizeProofOrigin(smoke.origin) !== normalizeProofOrigin(expectedOrigin)) {
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
      normalizeProofOrigin(privyAllowedOrigins.origin) !== normalizeProofOrigin(expectedOrigin)
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
console.log(`G14: local-verifier=${g14VerifierMechanicsPassed ? "passed" : "failed"}; launch-status=external-required`);
console.log(`Summary: ${issues.length === 0 ? "QA proof completed without detected issues" : `${issues.length} issue(s): ${issues.join("; ")}`}; ${launchGateSummary(issues.length)}.`);
console.log("Copy this summary into `docs/mainnet-proof-record.md` only after confirming the manifest reflects real wallet, UX, browser, and mobile QA.");

if (strict && issues.length > 0) {
  process.exitCode = 1;
}
