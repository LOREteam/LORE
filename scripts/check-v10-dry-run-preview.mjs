import { closeSync, existsSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getPreviewAgeMs } from "./preview-freshness.mjs";
import { verifyV10SepoliaDeploymentManifest } from "./verify-v10-sepolia-deployment-manifest.mjs";
import { captureV10PreviewRepositoryState } from "./v10-preview-repository-state.mjs";
import {
  consentEnvelopeSha256,
  parseCanonicalV10PreviewConsentEnvelope,
  parseV10DryRunLogEvidence,
} from "./v10-preview-consent-envelope.mjs";

const PREVIEW_PATH = path.join("docs", "v10-canary-dry-run-preview.md");
const MAX_PREVIEW_BYTES = 512 * 1024;
const MAX_DRY_RUN_LOG_BYTES = 256 * 1024;
const MAX_ANALYZER_OUTPUT_BYTES = 512 * 1024;
const MAX_PREVIEW_EVIDENCE_LAG_MS = 10 * 60 * 1000;
const DECIMAL_INTEGER_RE = /^(?:0|[1-9]\d{0,15})$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const requireFreshAuthorization = process.argv.includes("--require-fresh-authorization");
const ANALYZER_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "analyze-live-canary-proof.mjs");
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWED_ARGS = new Set(["--require-fresh-authorization"]);
const MAX_PREVIEW_AGE_MS = parsePositiveIntegerEnv(
  "V10_DRY_RUN_PREVIEW_MAX_AGE_MS",
  24 * 60 * 60 * 1000,
  60_000,
  7 * 24 * 60 * 60 * 1000,
);
const MAX_AUTHORIZATION_PREVIEW_AGE_MS = parsePositiveIntegerEnv(
  "V10_DRY_RUN_AUTHORIZATION_MAX_AGE_MS",
  15 * 60 * 1000,
  60_000,
  24 * 60 * 60 * 1000,
);
const AUTHORIZATION_EFFECTIVE_MAX_PREVIEW_AGE_MS = Math.min(
  MAX_PREVIEW_AGE_MS,
  MAX_AUTHORIZATION_PREVIEW_AGE_MS,
);
const ANALYZER_TIMEOUT_MS = parsePositiveIntegerEnv(
  "V10_DRY_RUN_ANALYZER_TIMEOUT_MS",
  20_000,
  1_000,
  60_000,
);

function parsePositiveIntegerEnv(name, fallback, min, max) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!DECIMAL_INTEGER_RE.test(raw)) throw new Error(`${name} must be a canonical decimal integer`);
  const parsed = BigInt(raw);
  if (parsed > MAX_SAFE_INTEGER_BIGINT || parsed < BigInt(min) || parsed > BigInt(max)) {
    throw new Error(`${name} must be in [${min}, ${max}]`);
  }
  return Number(parsed);
}

function readBoundedText(filePath, maxBytes, label) {
  const initialPathStats = assertOrdinaryPath(filePath, label, false);
  if (initialPathStats.size > maxBytes) throw new Error(`${label} is too large to validate safely`);
  const fd = openSync(filePath, "r");
  const chunks = [];
  let bytes = 0;
  try {
    const initialHandleStats = fstatSync(fd);
    if (!initialHandleStats.isFile() || !sameFileFingerprint(initialPathStats, initialHandleStats)) {
      throw new Error(`${label} changed before it could be read`);
    }
    const buffer = Buffer.alloc(Math.min(64 * 1024, Math.max(1, initialHandleStats.size)));
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      bytes += bytesRead;
      if (bytes > maxBytes) throw new Error(`${label} exceeded its safe bound`);
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    const finalHandleStats = fstatSync(fd);
    const finalPathStats = assertOrdinaryPath(filePath, label, false);
    if (!sameFileFingerprint(initialHandleStats, finalHandleStats) || !sameFileFingerprint(initialHandleStats, finalPathStats)) {
      throw new Error(`${label} changed while it was read`);
    }
  } finally {
    closeSync(fd);
  }
  return { text: Buffer.concat(chunks).toString("utf8"), bytes };
}

function sameFileFingerprint(left, right) {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

function assertOrdinaryPath(filePath, label, directory) {
  const stats = lstatSync(filePath);
  if (
    stats.isSymbolicLink()
    || (directory ? !stats.isDirectory() : !stats.isFile())
    || (!directory && stats.nlink !== 1)
  ) {
    throw new Error(`${label} must be an ordinary ${directory ? "directory" : "file"}`);
  }
  return stats;
}

function samePath(left, right) {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function resolveCanonicalWorkingRoot() {
  const requestedRoot = path.resolve(process.cwd());
  const rootStats = assertOrdinaryPath(requestedRoot, "V10 dry-run Preview working root", true);
  const physicalRoot = realpathSync(requestedRoot);
  if (!samePath(requestedRoot, physicalRoot)) {
    throw new Error("V10 dry-run Preview working root must not resolve through a reparse point");
  }
  return { path: requestedRoot, stats: rootStats };
}

function assertWorkingRootUnchanged(root) {
  const currentStats = assertOrdinaryPath(root.path, "V10 dry-run Preview working root", true);
  if (
    currentStats.dev !== root.stats.dev ||
    currentStats.ino !== root.stats.ino ||
    currentStats.birthtimeMs !== root.stats.birthtimeMs ||
    !samePath(root.path, realpathSync(root.path))
  ) {
    throw new Error("V10 dry-run Preview working root changed during validation");
  }
}

function assertCanonicalDirectory(directoryPath, label) {
  assertOrdinaryPath(directoryPath, label, true);
  if (!samePath(directoryPath, realpathSync(directoryPath))) {
    throw new Error(`${label} must not resolve through a reparse point`);
  }
}

function readBoundedCanaryLogBinding(relativePath) {
  const safePath = safeCanaryLogPath(relativePath);
  if (!safePath) throw new Error("V10 dry-run Preview referenced log path is unsafe");
  const workingRoot = resolveCanonicalWorkingRoot();
  const repositoryRoot = workingRoot.path;
  if (
    requireFreshAuthorization
    && !samePath(repositoryRoot, realpathSync(PROJECT_ROOT))
  ) {
    throw new Error("V10 authorization-ready Preview must be checked from its canonical source repository");
  }
  const dataDirectory = path.join(repositoryRoot, "data");
  const runDirectory = path.join(dataDirectory, "live-test-runs");
  const absolutePath = path.join(repositoryRoot, safePath);
  if (path.dirname(absolutePath) !== runDirectory) throw new Error("V10 dry-run Preview referenced log escaped its run directory");
  assertCanonicalDirectory(dataDirectory, "V10 dry-run Preview log data directory");
  assertCanonicalDirectory(runDirectory, "V10 dry-run Preview log run directory");
  const initialPathStats = assertOrdinaryPath(absolutePath, "V10 dry-run Preview referenced log", false);
  if (!samePath(path.dirname(realpathSync(absolutePath)), realpathSync(runDirectory))) {
    throw new Error("V10 dry-run Preview referenced log must not resolve through a reparse point");
  }

  const fd = openSync(absolutePath, "r");
  const digest = createHash("sha256");
  const chunks = [];
  let bytes = 0;
  try {
    const initialHandleStats = fstatSync(fd);
    if (!initialHandleStats.isFile() || !sameFileFingerprint(initialPathStats, initialHandleStats)) {
      throw new Error("V10 dry-run Preview referenced log changed before it could be read");
    }
    if (initialHandleStats.size > MAX_DRY_RUN_LOG_BYTES) {
      throw new Error("V10 dry-run Preview referenced log is too large to validate safely");
    }
    const buffer = Buffer.alloc(Math.min(64 * 1024, Math.max(1, initialHandleStats.size)));
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      bytes += bytesRead;
      if (bytes > MAX_DRY_RUN_LOG_BYTES) throw new Error("V10 dry-run Preview referenced log exceeded its safe bound");
      const chunk = Buffer.from(buffer.subarray(0, bytesRead));
      digest.update(chunk);
      chunks.push(chunk);
    }
    const finalHandleStats = fstatSync(fd);
    const finalPathStats = assertOrdinaryPath(absolutePath, "V10 dry-run Preview referenced log", false);
    if (!sameFileFingerprint(initialHandleStats, finalHandleStats) || !sameFileFingerprint(initialHandleStats, finalPathStats)) {
      throw new Error("V10 dry-run Preview referenced log changed while it was read");
    }
  } finally {
    closeSync(fd);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  assertWorkingRootUnchanged(workingRoot);
  return {
    path: safePath,
    bytes,
    sha256: digest.digest("hex"),
    lines: text.split(/\r?\n/).filter((line) => line.length > 0).length,
    text,
  };
}

function createMinimalAnalyzerEnvironment() {
  const env = { NO_COLOR: "1", FORCE_COLOR: "0" };
  for (const key of ["SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR"]) {
    if (typeof process.env[key] === "string") env[key] = process.env[key];
  }
  return env;
}

function runStrictDryRunAnalyzer(logBinding) {
  const result = spawnSync(process.execPath, [
    ANALYZER_SCRIPT,
    logBinding.path,
    "--profile=v10-matrix",
    "--preview-dry-run",
    "--summary-only",
    "--require-epoch-bound",
  ], {
    cwd: process.cwd(),
    env: createMinimalAnalyzerEnvironment(),
    encoding: "utf8",
    timeout: ANALYZER_TIMEOUT_MS,
    maxBuffer: MAX_ANALYZER_OUTPUT_BYTES,
    windowsHide: true,
  });
  if (result.error?.code === "ETIMEDOUT") throw new Error("strict dry-run analyzer timed out");
  if (result.error?.code === "ENOBUFS") throw new Error("strict dry-run analyzer exceeded its output bound");
  if (result.error || result.signal || result.status !== 0) {
    throw new Error("strict dry-run analyzer did not produce a passing Preview verdict");
  }
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const line = output.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "";
  let summary;
  try {
    summary = JSON.parse(line);
  } catch {
    throw new Error("strict dry-run analyzer returned invalid summary JSON");
  }
  const expectedKeys = [
    "status",
    "mode",
    "previewDryRunVerdict",
    "liveLaunchGates",
    "logName",
    "logSha256",
    "logBytes",
    "actionEvents",
    "successfulActionTx",
    "transactionEvidenceEvents",
    "runtimeIdentityPreflights",
    "walletPreflights",
    "issues",
  ];
  if (
    !summary || typeof summary !== "object" || Array.isArray(summary) ||
    JSON.stringify(Object.keys(summary)) !== JSON.stringify(expectedKeys) ||
    summary.status !== "pass" ||
    summary.mode !== "preview-dry-run" ||
    summary.previewDryRunVerdict !== "passed" ||
    JSON.stringify(summary.liveLaunchGates) !== JSON.stringify(["G10", "G11"]) ||
    summary.logName !== path.basename(logBinding.path) ||
    summary.logSha256 !== logBinding.sha256 ||
    summary.logBytes !== logBinding.bytes ||
    summary.actionEvents !== 0 ||
    summary.successfulActionTx !== 0 ||
    summary.transactionEvidenceEvents !== 0 ||
    summary.runtimeIdentityPreflights !== 1 ||
    !Number.isSafeInteger(summary.walletPreflights) ||
    summary.walletPreflights < 1 ||
    !Array.isArray(summary.issues) ||
    summary.issues.length !== 0
  ) {
    throw new Error("strict dry-run analyzer summary does not match the bound zero-transaction Preview log");
  }
  return summary;
}

const REQUIRED_SECTION_TITLES = [
  "Overall Status",
  "Read-Only Planner",
  "Pending Nonce Dry-Run",
  "V10 Matrix Dry-Run",
  "Dry-Run Proof Analysis",
  "Machine-Readable Consent Envelope",
  "Fresh Consent Boundary",
];

function markdownLines(source) {
  const lines = [];
  let start = 0;
  while (start < source.length) {
    const newline = source.indexOf("\n", start);
    const end = newline === -1 ? source.length : newline + 1;
    let text = source.slice(start, newline === -1 ? end : newline);
    if (text.endsWith("\r")) text = text.slice(0, -1);
    lines.push({ start, end, text });
    start = end;
  }
  return lines;
}

function scanMarkdownStructure(source) {
  const visibleLines = [];
  const headings = [];
  const fences = [];
  let openFence = null;
  for (const line of markdownLines(source)) {
    if (openFence) {
      const closing = /^ {0,3}(`+|~+)[ \t]*$/.exec(line.text);
      if (
        closing &&
        closing[1][0] === openFence.marker &&
        closing[1].length >= openFence.markerLength
      ) {
        fences.push({
          ...openFence,
          closeText: line.text,
          closeStart: line.start,
          closeEnd: line.end,
          content: source.slice(openFence.contentStart, line.start),
        });
        openFence = null;
      }
      continue;
    }

    const opening = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/.exec(line.text);
    if (opening && !(opening[1][0] === "`" && opening[2].includes("`"))) {
      openFence = {
        marker: opening[1][0],
        markerLength: opening[1].length,
        info: opening[2].trim(),
        openText: line.text,
        openStart: line.start,
        openEnd: line.end,
        contentStart: line.end,
      };
      continue;
    }

    visibleLines.push(line);
    if (line.text.includes("<!--") || line.text.includes("-->")) {
      throw new Error("V10 dry-run Preview must not hide consent text in HTML comments");
    }
    if (/^ {0,3}>/.test(line.text)) {
      throw new Error("V10 dry-run Preview must not use visible blockquote headings or consent text");
    }
    if (/<\/?(?:article|code|details|div|footer|h[1-6]|header|p|pre|script|section|span|style|summary|template)(?:\s|>)/i.test(line.text)) {
      throw new Error("V10 dry-run Preview must not use raw HTML containers for consent text");
    }
    if (/^ {0,3}(?:=+|-{3,})[ \t]*$/.test(line.text)) {
      throw new Error("V10 dry-run Preview must not use ambiguous setext headings or thematic breaks");
    }
    const heading = /^ {0,3}(#{1,6})(?:[ \t]+.*)?$/.exec(line.text);
    if (heading) {
      headings.push({
        level: heading[1].length,
        raw: line.text.trim(),
        start: line.start,
        end: line.end,
      });
    }
  }
  if (openFence) throw new Error("V10 dry-run Preview contains an unterminated fenced code block");
  return { visibleLines, headings, fences };
}

function assertRequiredSectionOrder(source) {
  const structure = scanMarkdownStructure(source);
  const expectedHeadings = [
    "# V10 Canary Dry-Run Preview",
    ...REQUIRED_SECTION_TITLES.map((title) => `## ${title}`),
  ];
  if (
    JSON.stringify(structure.headings.map((heading) => heading.raw)) !==
      JSON.stringify(expectedHeadings)
  ) {
    throw new Error("V10 dry-run Preview must contain only the exact visible heading contract");
  }
  const firstVisibleLine = structure.visibleLines.find((line) => line.text.trim() !== "");
  if (firstVisibleLine?.text !== expectedHeadings[0]) {
    throw new Error("V10 dry-run Preview title must be the first visible content");
  }
  return structure;
}

function section(source, title) {
  const structure = scanMarkdownStructure(source);
  const expected = `## ${title}`;
  const matches = structure.headings.filter((heading) => heading.level === 2 && heading.raw === expected);
  if (matches.length !== 1) throw new Error(`${title} section must appear exactly once as a visible heading`);
  const [heading] = matches;
  const nextHeading = structure.headings.find((candidate) => candidate.start > heading.start && candidate.level === 2);
  return source.slice(heading.end, nextHeading?.start ?? source.length);
}

function canonicalJsonCodeBlock(source, label) {
  const structure = scanMarkdownStructure(source);
  const jsonFences = structure.fences.filter((fence) => (
    fence.marker === "`" &&
    fence.markerLength === 3 &&
    fence.openText === "```json" &&
    fence.closeText === "```"
  ));
  if (structure.fences.length !== 1 || jsonFences.length !== 1) {
    throw new Error(`${label} must contain exactly one visible single-line canonical JSON block`);
  }
  const content = /^([^\r\n]+)\r?\n$/.exec(jsonFences[0].content);
  if (!content) throw new Error(`${label} must contain exactly one visible single-line canonical JSON block`);
  return content[1];
}

function bullet(source, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^- ${escaped}:\\s*(.+?)\\s*$`);
  const matches = scanMarkdownStructure(source).visibleLines
    .map((line) => pattern.exec(line.text))
    .filter(Boolean);
  if (matches.length > 1) throw new Error(`${label} must appear exactly once as a visible bullet`);
  return matches[0]?.[1]?.trim() ?? "";
}

function safeCanaryLogPath(value) {
  const normalized = path.normalize(String(value ?? "").trim());
  if (!normalized || path.isAbsolute(normalized) || normalized.split(/[\\/]+/).includes("..")) return null;
  const parts = normalized.split(/[\\/]+/);
  if (
    parts.length !== 3 ||
    parts[0] !== "data" ||
    parts[1] !== "live-test-runs" ||
    !/^live-canary-[0-9TZ-]+\.jsonl$/.test(parts[2])
  ) {
    return null;
  }
  return path.join(...parts);
}

function requireBullet(source, label, expected) {
  const value = bullet(source, label);
  if (value !== expected) throw new Error(`${label} must be ${expected || "present"}`);
  return value;
}

function requireSha256Bullet(source, label) {
  const value = bullet(source, label);
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a canonical SHA-256 digest`);
  }
  return value;
}

function parseDecimalText(value, label) {
  const text = String(value ?? "").trim();
  if (!DECIMAL_INTEGER_RE.test(text)) throw new Error(`${label} must be a canonical decimal integer`);
  const parsed = BigInt(text);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) throw new Error(`${label} is too large to report safely`);
  return Number(parsed);
}

function validatePreview() {
  const unknownArgs = process.argv.slice(2).filter((arg) => !ALLOWED_ARGS.has(arg));
  if (unknownArgs.length > 0) throw new Error("V10 dry-run Preview checker received an unknown argument");
  const workingRoot = resolveCanonicalWorkingRoot();
  const repositoryRoot = workingRoot.path;
  const docsDirectory = path.join(repositoryRoot, "docs");
  assertCanonicalDirectory(docsDirectory, "V10 dry-run Preview docs directory");
  const previewPath = path.join(docsDirectory, path.basename(PREVIEW_PATH));
  if (!samePath(path.dirname(previewPath), docsDirectory)) {
    throw new Error("V10 dry-run Preview markdown escaped its docs directory");
  }
  if (!existsSync(previewPath)) throw new Error("V10 dry-run Preview markdown is missing");
  const previewBinding = readBoundedText(previewPath, MAX_PREVIEW_BYTES, "V10 dry-run Preview markdown");
  const markdown = previewBinding.text;
  const markdownStructure = assertRequiredSectionOrder(markdown);
  const visibleMarkdown = markdownStructure.visibleLines.map((line) => line.text).join("\n");
  const deploymentManifest = verifyV10SepoliaDeploymentManifest({
    projectRoot: PROJECT_ROOT,
    verifyGitArtifact: true,
  });
  const previewSha256 = createHash("sha256").update(markdown, "utf8").digest("hex");
  const updatedAtLines = markdownStructure.visibleLines.filter((line) => line.text.startsWith("Last updated:"));
  const updatedAtMatch = updatedAtLines.length === 1
    ? /^Last updated: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\.$/.exec(updatedAtLines[0].text)
    : null;
  if (!updatedAtMatch || new Date(Date.parse(updatedAtMatch[1])).toISOString() !== updatedAtMatch[1]) {
    throw new Error("V10 dry-run Preview must contain exactly one canonical update timestamp");
  }
  const updatedAt = updatedAtMatch[1];
  const updatedMs = Date.parse(updatedAt);
  const ageMs = getPreviewAgeMs(updatedMs);
  const maxPreviewAgeMs = requireFreshAuthorization
    ? AUTHORIZATION_EFFECTIVE_MAX_PREVIEW_AGE_MS
    : MAX_PREVIEW_AGE_MS;
  if (ageMs > maxPreviewAgeMs) {
    const staleError = new Error(requireFreshAuthorization
      ? "V10 dry-run Preview is not fresh enough for authorization"
      : "V10 dry-run Preview is stale");
    staleError.previewAgeMinutes = Math.floor(ageMs / 60_000);
    throw staleError;
  }
  if (!/not an authorization to send transactions, start a soak, deploy, or change[\s\S]*contract behavior/i.test(visibleMarkdown)) {
    throw new Error("V10 dry-run Preview must preserve its non-authorization boundary");
  }
  if (!/Do not execute any of the following without a fresh exact authorization/i.test(visibleMarkdown)) {
    throw new Error("V10 dry-run Preview must preserve its fresh consent boundary");
  }
  if (
    !/authorizationRunId is unconsumed in the protected ledger of this canonical\s+repository; repository-local consumption is not a global one-shot guarantee/i.test(visibleMarkdown)
  ) {
    throw new Error("V10 dry-run Preview must describe its repository-local consumption boundary exactly");
  }

  const consentSection = section(markdown, "Machine-Readable Consent Envelope");
  const consentEnvelope = parseCanonicalV10PreviewConsentEnvelope(
    canonicalJsonCodeBlock(consentSection, "Machine-Readable Consent Envelope"),
    { deploymentManifest, requireSourceTreeClean: requireFreshAuthorization },
  );
  const consentEnvelopeDigest = consentEnvelopeSha256(consentEnvelope);
  const evidenceCompletedMs = Date.parse(consentEnvelope.runtimeEvidence.evidenceCompletedAt);
  const evidenceAgeMs = getPreviewAgeMs(evidenceCompletedMs);
  if (
    evidenceAgeMs > maxPreviewAgeMs
    || updatedMs < evidenceCompletedMs
    || updatedMs - evidenceCompletedMs > MAX_PREVIEW_EVIDENCE_LAG_MS
  ) {
    throw new Error("V10 dry-run Preview timestamp is not bound to fresh runtime evidence");
  }
  requireBullet(consentSection, "authorizationRunId", consentEnvelope.authorizationRunId);
  requireBullet(consentSection, "applicationGitSha", consentEnvelope.applicationGitSha);
  requireBullet(consentSection, "sourceTreeClean", String(consentEnvelope.sourceTreeClean));
  requireBullet(consentSection, "sourceStateSha256", consentEnvelope.sourceStateSha256);
  requireBullet(consentSection, "walletSetSha256", consentEnvelope.consentPlan.walletSetSha256);
  requireBullet(consentSection, "canaryPlanSha256", consentEnvelope.consentPlan.canaryPlanSha256);
  requireBullet(consentSection, "consentPlanSha256", consentEnvelope.consentPlanSha256);
  requireBullet(consentSection, "consentEnvelopeSha256", consentEnvelopeDigest);

  let authorizationRepositoryState = null;
  if (requireFreshAuthorization) {
    const repositoryState = captureV10PreviewRepositoryState({ root: process.cwd() });
    if (
      repositoryState.applicationGitSha !== consentEnvelope.applicationGitSha ||
      repositoryState.sourceStateSha256 !== consentEnvelope.sourceStateSha256 ||
      repositoryState.sourceTreeClean !== true ||
      consentEnvelope.sourceTreeClean !== true
    ) {
      throw new Error("V10 dry-run Preview application Git/source-tree binding is not authorization-ready");
    }
    authorizationRepositoryState = repositoryState;
  }

  const overall = section(markdown, "Overall Status");
  requireBullet(overall, "status", "pass");
  requireBullet(overall, "transactionSent", "false");
  requireBullet(overall, "signingMaterialLoaded", "false");
  requireBullet(overall, "operationalBoundaryVerified", "true");
  requireBullet(overall, "walletClientCreated", "false");
  requireBullet(overall, "contractWriteSubmitted", "false");
  requireBullet(overall, "dryRunPreviewVerdictPassed", "true");
  requireBullet(overall, "liveLaunchGatesBlocked", "G10,G11");
  requireBullet(overall, "consentPlanBound", "true");
  requireBullet(overall, "canaryLogBound", "true");
  requireBullet(overall, "applicationGitSha", consentEnvelope.applicationGitSha);
  requireBullet(overall, "sourceTreeClean", String(consentEnvelope.sourceTreeClean));
  requireBullet(overall, "authorizationReady", String(consentEnvelope.sourceTreeClean));
  requireBullet(overall, "authorizationRunId", consentEnvelope.authorizationRunId);
  requireBullet(overall, "sourceStateSha256", consentEnvelope.sourceStateSha256);
  const walletSetSha256 = requireSha256Bullet(overall, "walletSetSha256");
  const canaryPlanSha256 = requireSha256Bullet(overall, "canaryPlanSha256");
  const consentPlanSha256 = requireSha256Bullet(overall, "consentPlanSha256");
  const overallConsentEnvelopeSha256 = requireSha256Bullet(overall, "consentEnvelopeSha256");
  if (
    walletSetSha256 !== consentEnvelope.consentPlan.walletSetSha256 ||
    canaryPlanSha256 !== consentEnvelope.consentPlan.canaryPlanSha256 ||
    consentPlanSha256 !== consentEnvelope.consentPlanSha256 ||
    overallConsentEnvelopeSha256 !== consentEnvelopeDigest
  ) {
    throw new Error("V10 dry-run Preview overall consent bindings do not match its envelope");
  }

  const planner = section(markdown, "Read-Only Planner");
  requireBullet(planner, "exit", "0");
  requireBullet(planner, "mode", "read-only");
  requireBullet(planner, "network", "sepolia");
  requireBullet(planner, "chainId", "59141");
  requireBullet(planner, "transactionSent", "false");
  requireBullet(planner, "signingMaterialLoaded", "false");
  requireBullet(planner, "walletClientCreated", "false");
  requireBullet(planner, "contractWriteSubmitted", "false");
  const transactionLimit = parseDecimalText(bullet(planner, "transactionLimit"), "transactionLimit");
  const estimatedGas = parseDecimalText(bullet(planner, "estimatedGas"), "estimatedGas");

  const pending = section(markdown, "Pending Nonce Dry-Run");
  requireBullet(pending, "exit", "0");
  requireBullet(pending, "mode", "dry-run");
  requireBullet(pending, "wouldSend", "false");
  requireBullet(pending, "transactionSent", "false");
  requireBullet(pending, "signingMaterialLoaded", "false");
  requireBullet(pending, "walletClientCreated", "false");
  requireBullet(pending, "contractWriteSubmitted", "false");

  const matrix = section(markdown, "V10 Matrix Dry-Run");
  requireBullet(matrix, "exit", "0");
  requireBullet(matrix, "network", "sepolia");
  requireBullet(matrix, "chainId", "59141");
  requireBullet(matrix, "execution", "dry-run");
  requireBullet(matrix, "transactionSent", "false");
  requireBullet(matrix, "signingMaterialLoaded", "false");
  requireBullet(matrix, "walletClientCreated", "false");
  requireBullet(matrix, "contractWriteSubmitted", "false");
  requireBullet(matrix, "walletSetSha256", walletSetSha256);
  requireBullet(matrix, "canaryPlanSha256", canaryPlanSha256);
  const rounds = parseDecimalText(bullet(matrix, "rounds"), "rounds");
  const plannedBetTx = parseDecimalText(bullet(matrix, "plannedBetTx"), "plannedBetTx");
  if (
    rounds + consentEnvelope.consentPlan.txCaps.resolve !== consentEnvelope.consentPlan.maxEpochs ||
    plannedBetTx !== consentEnvelope.consentPlan.txCaps.bet
  ) {
    throw new Error("V10 matrix summary does not match the consent transaction caps");
  }
  const logPath = safeCanaryLogPath(bullet(matrix, "log"));
  if (!logPath) throw new Error("V10 dry-run Preview must reference only a safe relative live-test-run log");
  const expectedLogBytes = parseDecimalText(bullet(matrix, "logBytes"), "logBytes");
  const expectedLogSha256 = bullet(matrix, "logSha256");
  if (!/^[a-f0-9]{64}$/.test(expectedLogSha256)) {
    throw new Error("V10 dry-run Preview logSha256 must be a canonical SHA-256 digest");
  }
  const logBindingBefore = readBoundedCanaryLogBinding(logPath);
  if (logBindingBefore.bytes !== expectedLogBytes || logBindingBefore.sha256 !== expectedLogSha256) {
    throw new Error("V10 dry-run Preview referenced log does not match its current-run binding");
  }
  const runtimeEvidence = parseV10DryRunLogEvidence(
    logBindingBefore.text,
    consentEnvelope.consentPlan,
    { expectedAdmissionRunId: consentEnvelope.authorizationRunId },
  );
  if (JSON.stringify(runtimeEvidence) !== JSON.stringify(consentEnvelope.runtimeEvidence)) {
    throw new Error("V10 dry-run Preview runtime evidence does not match its bound log");
  }

  const analyzer = section(markdown, "Dry-Run Proof Analysis");
  requireBullet(analyzer, "exit", "0");
  requireBullet(analyzer, "previewDryRunVerdict", "passed");
  requireBullet(analyzer, "liveLaunchGates", "G10,G11");
  requireBullet(analyzer, "actionEvents", "0");
  requireBullet(analyzer, "successfulActionTx", "0");
  requireBullet(analyzer, "transactionEvidenceEvents", "0");
  requireBullet(analyzer, "runtimeIdentityPreflights", "1");
  requireBullet(analyzer, "walletPreflights", String(consentEnvelope.consentPlan.roles.selectedRoles.length));
  requireBullet(analyzer, "logSha256", expectedLogSha256);
  requireBullet(analyzer, "logBytes", String(expectedLogBytes));
  const analyzerVerdict = runStrictDryRunAnalyzer(logBindingBefore);
  if (analyzerVerdict.walletPreflights !== consentEnvelope.consentPlan.roles.selectedRoles.length) {
    throw new Error("strict dry-run analyzer wallet preflight count does not match consent roles");
  }
  const logBindingAfter = readBoundedCanaryLogBinding(logPath);
  if (
    logBindingAfter.bytes !== logBindingBefore.bytes ||
    logBindingAfter.sha256 !== logBindingBefore.sha256 ||
    logBindingAfter.sha256 !== expectedLogSha256
  ) {
    throw new Error("V10 dry-run Preview referenced log changed during strict analysis");
  }
  const previewBindingAfter = readBoundedText(previewPath, MAX_PREVIEW_BYTES, "V10 dry-run Preview markdown");
  if (
    previewBindingAfter.bytes !== previewBinding.bytes
    || createHash("sha256").update(previewBindingAfter.text, "utf8").digest("hex") !== previewSha256
    || previewBindingAfter.text !== markdown
  ) {
    throw new Error("V10 dry-run Preview markdown changed during validation");
  }
  if (authorizationRepositoryState) {
    const repositoryStateAfter = captureV10PreviewRepositoryState({ root: process.cwd() });
    if (
      repositoryStateAfter.applicationGitSha !== authorizationRepositoryState.applicationGitSha
      || repositoryStateAfter.sourceStateSha256 !== authorizationRepositoryState.sourceStateSha256
      || repositoryStateAfter.sourceTreeClean !== true
    ) {
      throw new Error("V10 dry-run Preview source repository changed during authorization validation");
    }
  }
  assertWorkingRootUnchanged(workingRoot);

  return {
    status: "pass",
    previewPath: PREVIEW_PATH,
    ageMinutes: Math.floor(ageMs / 60_000),
    maxPreviewAgeMinutes: Math.floor(maxPreviewAgeMs / 60_000),
    authorizationFreshnessRequired: requireFreshAuthorization,
    previewBytes: previewBinding.bytes,
    previewSha256,
    walletSetSha256,
    canaryPlanSha256,
    consentPlanSha256,
    consentEnvelopeSha256: consentEnvelopeDigest,
    authorizationRunId: consentEnvelope.authorizationRunId,
    applicationGitSha: consentEnvelope.applicationGitSha,
    sourceTreeClean: consentEnvelope.sourceTreeClean,
    authorizationReady: requireFreshAuthorization,
    canaryLog: logPath,
    logBytes: logBindingAfter.bytes,
    logLines: logBindingAfter.lines,
    transactionLimit,
    estimatedGas,
    rounds,
    maxAffectedEpochs: consentEnvelope.consentPlan.maxEpochs,
    plannedBetTx,
    approvalTxLimit: consentEnvelope.consentPlan.txCaps.approval,
    resolveTxLimit: consentEnvelope.consentPlan.txCaps.resolve,
    totalTxLimit: consentEnvelope.consentPlan.txCaps.total,
    totalSpendWei: consentEnvelope.consentPlan.valueCaps.totalSpendWei,
    maxNativeGasWei: consentEnvelope.consentPlan.valueCaps.maxNativeGasWei,
    evidenceStartedAt: consentEnvelope.runtimeEvidence.evidenceStartedAt,
    evidenceCompletedAt: consentEnvelope.runtimeEvidence.evidenceCompletedAt,
    transactionSent: false,
    signingMaterialLoaded: false,
    walletClientCreated: false,
    contractWriteSubmitted: false,
    dryRunPreviewVerdict: analyzerVerdict.previewDryRunVerdict,
    liveLaunchGates: analyzerVerdict.liveLaunchGates,
  };
}

try {
  console.log(JSON.stringify(validatePreview()));
} catch (error) {
  const previewAgeMinutes = error instanceof Error && Number.isSafeInteger(error.previewAgeMinutes)
    ? error.previewAgeMinutes
    : undefined;
  console.log(JSON.stringify({
    status: "fail",
    authorizationFreshnessRequired: requireFreshAuthorization,
    ...(previewAgeMinutes === undefined ? {} : { ageMinutes: previewAgeMinutes }),
    maxPreviewAgeMinutes: Math.floor((requireFreshAuthorization
      ? AUTHORIZATION_EFFECTIVE_MAX_PREVIEW_AGE_MS
      : MAX_PREVIEW_AGE_MS) / 60_000),
    issue: error instanceof Error ? error.message.replace(/\s+/g, "-").toLowerCase().slice(0, 96) : "unknown",
  }));
  process.exitCode = 1;
}
