import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const expected = Array.from({ length: 14 }, (_, index) => `G${index + 1}`);
const requiredProofFilesByGate = new Map([
  ["G1", ["docs/signoff-proof.json"]],
  ["G2", ["docs/signoff-proof.json"]],
  ["G3", ["docs/signoff-proof.json"]],
  ["G4", ["docs/signoff-proof.json"]],
  ["G5", ["docs/host-proof.json"]],
  ["G6", ["docs/host-proof.json"]],
  ["G7", ["docs/indexer-proof.json"]],
  ["G8", ["docs/restore-proof.json"]],
  ["G9", ["docs/monitoring-proof.json"]],
  ["G10", ["docs/canary-proof.json"]],
  ["G11", ["docs/canary-proof.json"]],
  ["G12", ["docs/qa-proof.json"]],
  ["G13", ["docs/qa-proof.json"]],
  ["G14", ["docs/qa-proof.json"]],
]);
const launchGateGroups = new Map([
  ["G1", "env"],
  ["G2", "signoff"],
  ["G3", "signoff"],
  ["G4", "chain"],
  ["G5", "host"],
  ["G6", "host"],
  ["G7", "indexer"],
  ["G8", "restore"],
  ["G9", "monitoring"],
  ["G10", "canary"],
  ["G11", "canary"],
  ["G12", "qa"],
  ["G13", "qa"],
  ["G14", "qa"],
]);
const gatesRequiringCanaryLog = new Set(["G10", "G11", "G14"]);
const statusBoardFirstCheckExpectations = new Map([
  ["G1", ["proof:mainnet", "--strict", "--out=docs/mainnet-env-proof.log"]],
  ["G2", ["proof:signoff", "--strict"]],
  ["G3", ["proof:signoff", "--strict"]],
  ["G4", ["proof:chain", "--strict", "--out=docs/chain-proof-snapshot.json"]],
  ["G5", ["proof:host:collect", "--host-type=production", "--db-path=", "--supervisor=", "--process-evidence=docs/host-process-model.log", "--health-log=docs/host-health-prod.log", "--load-log=docs/host-load-http.log", "--out=docs/host-proof.draft.json"]],
  ["G6", ["proof:host", "--strict"]],
  ["G7", ["proof:indexer:collect", "--chain-id=59144", "--indexer-log=docs/indexer-once.log", "--health-log=docs/indexer-health-prod.log", "--chain-snapshot=docs/chain-proof-snapshot.json", "--out=docs/indexer-proof.draft.json"]],
  ["G8", ["proof:restore:collect", "--restore-log=docs/restore-drill.log", "--health-log=docs/restore-health-prod.log", "--backup-schedule-artifact=docs/restore-backup-schedule.log", "--preservation-artifact=docs/restore-indexer-preservation.log", "--out=docs/restore-proof.draft.json"]],
  ["G9", ["proof:monitoring:plan", "--provider=", "--error-provider=", "--origin=", "--out=docs/monitoring-alert-test-plan.draft.md"]],
  ["G10", ["proof:canary", "data/live-test-runs/live-canary-YYYY.jsonl", "--strict"]],
  ["G11", ["proof:canary", "data/live-test-runs/live-canary-YYYY.jsonl", "--strict"]],
  ["G12", ["proof:qa:plan", "--origin=https://playlore.xyz", "--network=linea-mainnet", "--chain-id=59144", "--out=docs/qa-canary-test-plan.draft.md"]],
  ["G13", ["proof:qa", "--strict"]],
  ["G14", ["proof:files", "--canary-log="]],
]);
const compactStatusCheckByGate = new Map([
  ["G1", "npm.cmd run proof:mainnet:strict:compact"],
  ["G2", "npm.cmd run proof:signoff:strict:summary"],
  ["G3", "npm.cmd run proof:signoff:strict:summary"],
  ["G4", "npm.cmd run proof:chain:strict:summary"],
  ["G5", "npm.cmd run proof:host:summary"],
  ["G6", "npm.cmd run proof:host:strict:summary"],
  ["G7", "npm.cmd run proof:indexer:strict:summary"],
  ["G8", "npm.cmd run proof:restore:strict:summary"],
  ["G9", "npm.cmd run proof:monitoring:strict:summary"],
  ["G10", "npm.cmd run proof:testnet:canary:strict:summary"],
  ["G11", "npm.cmd run proof:testnet:canary:strict:summary"],
  ["G12", "npm.cmd run proof:qa:summary"],
  ["G13", "npm.cmd run proof:qa:strict:summary"],
  ["G14", "npm.cmd run proof:files:summary"],
]);
const requiredProofMarkerExpectations = new Map([
  ["G1", ["contractEnv", "chain ID", "deploy block", "token", "finality", "V10 protected bets"]],
  ["G2", ["ownership.directOwnerReadEvidence", "Safe/multisig governance evidence", "proof tx"]],
  ["G3", ["randomness.decision", "operator/signer sign-off"]],
  ["G4", ["chainComparison", "jackpot", "safetyPool", "deposits", "rewards", "rebates", "resolve"]],
  ["G5", ["lore-site", "lore-bot", "lore-indexer", "supervisor evidence", "persistent DB"]],
  ["G6", ["health:prod", "docs/host-health-prod.log", "base=<production origin>", "finalityLagBlocks", "load:http", "docs/host-load-http.log", "Load base URL:", "externalRateLimit", "webReplicaCount", "sharedBucketVerified", "failClosed"]],
  ["G7", ["fresh external DB", "deploy block", "INDEXER_FINALITY_BLOCKS", "docs/indexer-once.log", "chainSnapshot", "rpcChainId", "contractAddress", "finalityLagBlocks", "chainComparison"]],
  ["G8", ["backupSchedule", "retentionDays", "lastSuccessfulBackupAt", "docs/restore-backup-schedule.log", "docs/restore-drill.log", "docs/restore-health-prod.log", "docs/restore-indexer-preservation.log", "indexerPreservation"]],
  ["G9", ["health-prod", "data-sync", "stale-indexer-heartbeat", "indexer-lag", "bot-restart", "indexer-restart", "reverted-tx", "docs/monitoring-alert-export.log", "docs/monitoring-recovery-export.log", "docs/monitoring-alert-target-test.log", "docs/error-tracking-test-event.log", "fired/recovery alerts", "verified email alert target", "error event"]],
  ["G10", ["target-RPC JSONL", "MANUAL", "AUTOMINER_A", "AUTOMINER_B", "50 successful auto-miner unique epochs"]],
  ["G11", ["noDuplicateBets", "noNonceLoops", "noStuckPending", "pendingRecoveryConverged", "recovery evidence"]],
  ["G12", ["Privy allowed origins", "redacted production App ID configured proof", "wrong network", "mobile Web3 browser", "clean-wallet first tx", "slow auth"]],
  ["G13", ["disabled reasons", "pending states", "degraded data", "bet history", "auto-miner logs", "diagnostics"]],
  ["G14", ["debug autominer smoke", "mobile layout", "overlays", "chat geometry", "mainnet wording", "final security scan", "no open High/Medium local findings"]],
]);
const proofRecordMarkerExpectations = requiredProofMarkerExpectations;
const jsonOutput = process.argv.includes("--json");
const summaryOnly = process.argv.includes("--summary-only");
const autonomousBoundary = "local-hardening-only";
const autonomousNextCheck = "npm.cmd run proof:autonomous:summary";
const transactionBoundary = "fresh-preview-plus-explicit-consent";
const transactionPreviewChecks = [
  "npm.cmd run plan:canary:v10:postdeploy:summary",
  "npm.cmd run preview:canary:v10:dry-run",
  "npm.cmd run preview:canary:v10:dry-run:summary",
  "npm.cmd run preview:canary:v10:authorization-ready:summary",
];
const transactionConsentRequirement = "No real bets, claims, resolver actions, approvals, nonce replacements, or soak starts without a fresh read-only Preview, a passing authorization-ready freshness check, and fresh exact bounded user consent.";
const visibleMarkerTokenLimit = 8;
const MAX_REMAINING_LAUNCH_MARKDOWN_BYTES = 1024 * 1024;

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : fallback;
}

const boardPath = path.resolve(process.cwd(), argValue("board", "docs/mainnet-status-board.md"));
const proofPath = path.resolve(process.cwd(), argValue("proof", "docs/mainnet-proof-record.md"));

function regularFileStat(filePath) {
  try {
    const stats = statSync(filePath);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
}

function readMarkdown(filePath) {
  const stats = regularFileStat(filePath);
  if (!stats) throw new Error(`Missing required file or not a file: ${filePath}`);
  if (!stats.isFile()) throw new Error(`Required file must be a file: ${filePath}`);
  if (stats.size > MAX_REMAINING_LAUNCH_MARKDOWN_BYTES) {
    throw new Error(`Required file is too large to summarize safely: ${filePath}`);
  }
  return readFileSync(filePath, "utf8");
}

function parseTable(markdown, columns) {
  const rows = [];
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) continue;
    if (trimmed.includes("---")) continue;
    const cells = trimmed
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());
    if (cells.length !== columns.length || cells[0] === columns[0]) continue;
    const row = {};
    columns.forEach((column, index) => {
      row[column] = cells[index] ?? "";
    });
    if (/^G\d+$/.test(row.ID)) rows.push(row);
  }
  return rows;
}

function byId(rows) {
  return new Map(rows.map((row) => [row.ID, row]));
}

function printTable(headers, rows) {
  console.log(`| ${headers.join(" | ")} |`);
  console.log(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}

function formatGateGroups(gateIds) {
  const counts = new Map();
  for (const gateId of gateIds) {
    const group = launchGateGroups.get(gateId) ?? "other";
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  return [...counts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([group, count]) => `${group}=${count}`)
    .join(", ") || "none";
}

function safeToken(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "unknown";
}

function formatNextProofFiles(gateId) {
  return (requiredProofFilesByGate.get(gateId) ?? []).join(", ") || "none";
}

function formatNextMarkerTokens(gateId) {
  return (requiredProofMarkerExpectations.get(gateId) ?? []).map(safeToken).join(", ") || "none";
}

function buildGateAction(row) {
  return {
    id: row.id,
    group: launchGateGroups.get(row.id) ?? "other",
    status: row.status,
    proofFiles: requiredProofFilesByGate.get(row.id) ?? [],
    markerTokens: (requiredProofMarkerExpectations.get(row.id) ?? []).map(safeToken),
    statusCheck: compactStatusCheckByGate.get(row.id) ?? "",
    firstCheck: row.firstCheck,
  };
}

function formatGateActionLine(action) {
  const proofFiles = action.proofFiles.length > 0 ? action.proofFiles.join(",") : "none";
  const markerTokens = action.markerTokens.slice(0, visibleMarkerTokenLimit).join(",");
  const extraMarkerCount = Math.max(0, action.markerTokens.length - visibleMarkerTokenLimit);
  const markerSummary = extraMarkerCount > 0 ? `${markerTokens},+${extraMarkerCount}` : markerTokens || "none";
  return `${action.id} group=${action.group} status=${safeToken(action.status)} proof=${proofFiles} statusCheck=${action.statusCheck || "none"} markers=${markerSummary}`;
}

function remainingSummaryLine(missingGateIds) {
  return missingGateIds.length === 0
    ? "Summary: no remaining launch evidence rows in the proof tracker."
    : `Summary: ${missingGateIds.length} launch gate(s) still require external evidence; groups: ${formatGateGroups(missingGateIds)}.`;
}

function normalizeEvidencePath(value) {
  return String(value ?? "").replace(/\\/g, "/");
}

function localArtifactExists(relativePath) {
  const absolutePath = path.join(process.cwd(), ...relativePath.split("/"));
  return regularFileStat(absolutePath) !== null;
}

const MAX_CANARY_LOG_PATHS = 16;

function findLiveCanaryLogPaths(value) {
  const paths = [];
  const pattern = /\bdata\/live-test-runs\/[^|\s`]+\.jsonl\b/gi;
  const normalized = normalizeEvidencePath(value);
  let match = pattern.exec(normalized);
  while (match !== null) {
    paths.push(match[0]);
    if (paths.length >= MAX_CANARY_LOG_PATHS) return paths;
    match = pattern.exec(normalized);
  }
  return paths;
}

function hasConcreteEvidence(value) {
  return [
    /npm(?:\.cmd)?\s+run\s+proof:/i,
    /npm(?:\.cmd)?\s+run\s+health:prod/i,
    /npm(?:\.cmd)?\s+run\s+load:http/i,
    /npm(?:\.cmd)?\s+run\s+indexer:once/i,
    /0x[a-fA-F0-9]{64}/,
    /https?:\/\//i,
    /\bdocs\/[a-z0-9-]+-proof\.json\b/i,
    /\bdata\/live-test-runs\/[^|\s]+\.jsonl\b/i,
    /\b(?:artifact|screenshot|log|report|direct-chain|finalityLagBlocks)\b/i,
    /\b20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
  ].some((pattern) => pattern.test(String(value ?? "")));
}

function completeEvidenceIssuesFor(id, evidence) {
  const issues = [];
  if (!hasConcreteEvidence(evidence)) {
    issues.push("must include a concrete proof marker, not only prose");
  }
  const normalizedEvidence = normalizeEvidencePath(evidence);
  for (const marker of proofRecordMarkerExpectations.get(id) ?? []) {
    if (!normalizedEvidence.includes(marker)) {
      issues.push(`must reference ${marker}`);
    }
  }
  for (const proofFile of requiredProofFilesByGate.get(id) ?? []) {
    if (!normalizedEvidence.includes(proofFile)) {
      issues.push(`must reference ${proofFile}`);
    } else if (!localArtifactExists(proofFile)) {
      issues.push(`references missing local artifact ${proofFile}`);
    }
  }
  if (gatesRequiringCanaryLog.has(id)) {
    const canaryLogs = findLiveCanaryLogPaths(evidence);
    if (canaryLogs.length === 0) {
      issues.push("must reference a data/live-test-runs/*.jsonl canary log");
    }
    for (const canaryLog of canaryLogs) {
      if (!localArtifactExists(canaryLog)) {
        issues.push(`references missing local artifact ${canaryLog}`);
      }
    }
  }
  return issues;
}
function requiredProofIssuesFor(id, requiredProof) {
  const issues = [];
  const normalizedRequiredProof = normalizeEvidencePath(requiredProof);
  if (!normalizedRequiredProof.trim() || /^_?tbd_?$/i.test(normalizedRequiredProof.trim())) {
    issues.push("status board required proof is missing");
  }
  for (const proofFile of requiredProofFilesByGate.get(id) ?? []) {
    if (!normalizedRequiredProof.includes(proofFile)) {
      issues.push(`status board required proof must reference ${proofFile}`);
    }
  }
  for (const marker of requiredProofMarkerExpectations.get(id) ?? []) {
    if (!normalizedRequiredProof.includes(marker)) {
      issues.push(`status board required proof must reference ${marker}`);
    }
  }
  if (gatesRequiringCanaryLog.has(id) && !/\b(?:live canary log|canary-log|data\/live-test-runs\/[^|\s`]+\.jsonl)\b/i.test(normalizedRequiredProof)) {
    issues.push("status board required proof must reference a live canary log");
  }
  return issues;
}
function firstCheckIssuesFor(id, firstCheck) {
  const issues = [];
  const value = String(firstCheck ?? "");
  if (!value.trim() || /^_?tbd_?$/i.test(value.trim())) {
    issues.push("status board first check is missing");
  }
  for (const part of statusBoardFirstCheckExpectations.get(id) ?? []) {
    if (!value.includes(part)) {
      issues.push(`status board first check must include ${part}`);
    }
  }
  return issues;
}
function proofRecordReferenceIssuesFor(id, evidence) {
  const issues = [];
  const normalizedEvidence = normalizeEvidencePath(evidence);
  if (!normalizedEvidence.trim() || /^_?tbd_?$/i.test(normalizedEvidence.trim())) {
    issues.push("proof record evidence is missing");
  }
  for (const proofFile of requiredProofFilesByGate.get(id) ?? []) {
    if (!normalizedEvidence.includes(proofFile)) {
      issues.push(`proof record evidence must reference ${proofFile}`);
    }
  }
  if (gatesRequiringCanaryLog.has(id) && !/\b(?:live canary log|canary-log|data\/live-test-runs\/[^|\s`]+\.jsonl)\b/i.test(normalizedEvidence)) {
    issues.push("proof record evidence must reference a live canary log");
  }
  for (const marker of proofRecordMarkerExpectations.get(id) ?? []) {
    if (!normalizedEvidence.includes(marker)) {
      issues.push(`proof record evidence must reference ${marker}`);
    }
  }
  return issues;
}

const boardRows = parseTable(readMarkdown(boardPath), ["ID", "Gate", "Required proof", "First check", "Status"]);
const proofRows = parseTable(readMarkdown(proofPath), ["ID", "Gate", "Status", "Evidence"]);
const boardById = byId(boardRows);
const proofById = byId(proofRows);

const timestamp = new Date().toISOString();
const rows = [];
const missing = [];
const complete = [];
const inconsistent = [];
const completeEvidenceIssues = [];
const requiredProofIssues = [];
const proofRecordReferenceIssues = [];
const firstCheckIssues = [];

for (const id of expected) {
  const board = boardById.get(id);
  const proof = proofById.get(id);
  if (!board || !proof) {
    inconsistent.push(id);
    continue;
  }
  if (board.Status !== proof.Status || board.Gate !== proof.Gate) inconsistent.push(id);
  const boardRequiredProofIssues = requiredProofIssuesFor(id, board["Required proof"]);
  for (const issue of boardRequiredProofIssues) {
    requiredProofIssues.push({ id, gate: board.Gate, issue });
  }  const boardFirstCheckIssues = firstCheckIssuesFor(id, board["First check"]);
  for (const issue of boardFirstCheckIssues) {
    firstCheckIssues.push({ id, gate: board.Gate, issue });
  }
  if (proof.Status === "Complete") {
    complete.push(id);
    const evidenceIssues = completeEvidenceIssuesFor(id, proof.Evidence);
    for (const issue of evidenceIssues) {
      completeEvidenceIssues.push({ id, gate: proof.Gate, issue });
    }
  } else {
    const referenceIssues = proofRecordReferenceIssuesFor(id, proof.Evidence);
    for (const issue of referenceIssues) {
      proofRecordReferenceIssues.push({ id, gate: proof.Gate, issue });
    }
  }
  if (proof.Status !== "Complete") {
    missing.push(id);
    rows.push({
      id,
      gate: board.Gate,
      status: proof.Status,
      firstCheck: board["First check"],
      requiredProof: board["Required proof"],
    });
  }
}

const gateActions = rows.map(buildGateAction);
const nextGate = rows[0] ?? null;
const nextGateAction = nextGate
  ? {
    ...gateActions[0],
    autonomousBoundary,
    autonomousNextCheck,
    transactionBoundary,
    transactionPreviewChecks,
    transactionConsentRequirement,
  }
  : null;

if (jsonOutput) {
  console.log(JSON.stringify({
    timestamp,
    completeGates: complete,
    remainingGates: missing,
    remainingGateGroups: formatGateGroups(missing),
    inconsistentGates: inconsistent,
    completeGateEvidenceIssues: completeEvidenceIssues,
    requiredProofIssues,
    proofRecordReferenceIssues,
    firstCheckIssues,
    nextGate,
    nextGateAction,
    gateActions,
    autonomousBoundary,
    autonomousNextCheck,
    transactionBoundary,
    transactionPreviewChecks,
    transactionConsentRequirement,
    gates: rows,
  }, null, 2));
  if (inconsistent.length > 0 || completeEvidenceIssues.length > 0 || requiredProofIssues.length > 0 || proofRecordReferenceIssues.length > 0 || firstCheckIssues.length > 0) process.exitCode = 1;
} else if (summaryOnly) {
  console.log("# Remaining Launch Evidence");
  console.log("");
  console.log(`Timestamp: ${timestamp}`);
  console.log("");
  console.log(`Complete gates: ${complete.length}/${expected.length}`);
  console.log(`Remaining gates: ${missing.length === 0 ? "none" : missing.join(", ")}`);
  console.log(`Remaining gate groups: ${formatGateGroups(missing)}`);
  console.log(`Inconsistent rows: ${inconsistent.length === 0 ? "none" : inconsistent.join(", ")}`);
  console.log(`Complete gate evidence issues: ${completeEvidenceIssues.length}`);
  console.log(`Required proof issues: ${requiredProofIssues.length}`);
  console.log(`Proof record reference issues: ${proofRecordReferenceIssues.length}`);
  console.log(`First check issues: ${firstCheckIssues.length}`);
  if (nextGate) {
    console.log(`Next gate: ${nextGate.id} ${nextGate.gate}`);
    console.log(`Next gate group: ${nextGateAction.group}`);
    console.log(`Next proof files: ${formatNextProofFiles(nextGate.id)}`);
    console.log(`Next marker tokens: ${formatNextMarkerTokens(nextGate.id)}`);
    console.log(`Next status check: ${nextGateAction.statusCheck || "none"}`);
    console.log(`Next first check: ${nextGate.firstCheck}`);
    console.log(`Autonomous boundary: ${autonomousBoundary}`);
    console.log(`Autonomous next: ${autonomousNextCheck}`);
    console.log(`Transaction boundary: ${transactionBoundary}`);
    console.log(`Pre-transaction preview checks: ${transactionPreviewChecks.join(" | ")}`);
    console.log(`Consent requirement: ${transactionConsentRequirement}`);
  }
  if (gateActions.length > 0) {
    console.log("Remaining gate worklist:");
    for (const action of gateActions) {
      console.log(`- ${formatGateActionLine(action)}`);
    }
  }
  console.log("");
  console.log(
    completeEvidenceIssues.length > 0
      ? `Summary: ${completeEvidenceIssues.length} complete gate evidence issue(s) must be fixed before launch.`
      : requiredProofIssues.length > 0
        ? `Summary: ${requiredProofIssues.length} required proof issue(s) must be fixed before launch.`
        : proofRecordReferenceIssues.length > 0
          ? `Summary: ${proofRecordReferenceIssues.length} proof record reference issue(s) must be fixed before launch.`
          : firstCheckIssues.length > 0
            ? `Summary: ${firstCheckIssues.length} first check issue(s) must be fixed before launch.`
            : remainingSummaryLine(missing),
  );
  if (inconsistent.length > 0 || completeEvidenceIssues.length > 0 || requiredProofIssues.length > 0 || proofRecordReferenceIssues.length > 0 || firstCheckIssues.length > 0) process.exitCode = 1;
} else {
  console.log("# Remaining Launch Evidence");
  console.log("");
  console.log(`Timestamp: ${timestamp}`);
  console.log("");
  console.log("| Metric | Value |");
  console.log("| --- | --- |");
  console.log(`| complete gates | ${complete.length} |`);
  console.log(`| remaining gates | ${missing.length} |`);
  console.log(`| remaining gate groups | ${formatGateGroups(missing)} |`);
  console.log(`| inconsistent gate rows | ${inconsistent.length === 0 ? "none" : inconsistent.join(", ")} |`);
  console.log(`| complete gate evidence issues | ${completeEvidenceIssues.length === 0 ? "none" : completeEvidenceIssues.length} |`);
  console.log(`| required proof issues | ${requiredProofIssues.length === 0 ? "none" : requiredProofIssues.length} |`);
  console.log(`| proof record reference issues | ${proofRecordReferenceIssues.length === 0 ? "none" : proofRecordReferenceIssues.length} |`);
  console.log(`| first check issues | ${firstCheckIssues.length === 0 ? "none" : firstCheckIssues.length} |`);
  console.log(`| autonomous boundary | ${autonomousBoundary} |`);
  console.log(`| autonomous next | ${autonomousNextCheck} |`);
  console.log(`| transaction boundary | ${transactionBoundary} |`);
  console.log(`| pre-transaction preview checks | ${transactionPreviewChecks.join("<br>")} |`);
  console.log(`| consent requirement | ${transactionConsentRequirement} |`);
  console.log("");

  if (completeEvidenceIssues.length > 0) {
    printTable(
      ["ID", "Gate", "Issue"],
      completeEvidenceIssues.map((row) => [row.id, row.gate, row.issue.replace(/\|/g, "\\|")]),
    );
    console.log("");
  }

  if (requiredProofIssues.length > 0) {
    printTable(
      ["ID", "Gate", "Required Proof Issue"],
      requiredProofIssues.map((row) => [row.id, row.gate, row.issue.replace(/\|/g, "\\|")]),
    );
    console.log("");
  }

  if (proofRecordReferenceIssues.length > 0) {
    printTable(
      ["ID", "Gate", "Proof Record Reference Issue"],
      proofRecordReferenceIssues.map((row) => [row.id, row.gate, row.issue.replace(/\|/g, "\\|")]),
    );
    console.log("");
  }
  if (firstCheckIssues.length > 0) {
    printTable(
      ["ID", "Gate", "First Check Issue"],
      firstCheckIssues.map((row) => [row.id, row.gate, row.issue.replace(/\|/g, "\\|")]),
    );
    console.log("");
  }

  if (rows.length > 0) {
    const nextGate = rows[0];
    printTable(
      ["Next Gate", "First check", "Required proof"],
      [[
        `${nextGate.id} ${nextGate.gate}`,
        nextGate.firstCheck.replace(/\|/g, "\\|"),
        nextGate.requiredProof.replace(/\|/g, "\\|"),
      ]],
    );
    console.log("");

    printTable(
      ["ID", "Gate", "Status", "First check", "Required proof"],
      rows.map((row) => [
        row.id,
        row.gate,
        row.status,
        row.firstCheck.replace(/\|/g, "\\|"),
        row.requiredProof.replace(/\|/g, "\\|"),
      ]),
    );
  } else {
    console.log("All G1-G14 gates are marked Complete. Run `npm.cmd run proof:files -- --canary-log=<path>` before `npm.cmd run proof:launch -- --strict --canary-log=<path>`.");
  }

  console.log("");
  console.log(
    completeEvidenceIssues.length > 0
      ? `Summary: ${completeEvidenceIssues.length} complete gate evidence issue(s) must be fixed before launch.`
      : requiredProofIssues.length > 0
        ? `Summary: ${requiredProofIssues.length} required proof issue(s) must be fixed before launch.`
        : proofRecordReferenceIssues.length > 0
          ? `Summary: ${proofRecordReferenceIssues.length} proof record reference issue(s) must be fixed before launch.`
          : firstCheckIssues.length > 0
            ? `Summary: ${firstCheckIssues.length} first check issue(s) must be fixed before launch.`
            : remainingSummaryLine(missing),
  );

  if (inconsistent.length > 0 || completeEvidenceIssues.length > 0 || requiredProofIssues.length > 0 || proofRecordReferenceIssues.length > 0 || firstCheckIssues.length > 0) process.exitCode = 1;
}
