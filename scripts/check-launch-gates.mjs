import path from "node:path";
import { createLaunchGatePolicyMaps, findLiveCanaryLogPaths } from "./launch-gate-policy.mjs";
import { localLaunchArtifactExists, readLaunchMarkdown } from "./launch-gate-policy.mjs";

const strict = process.argv.includes("--strict");
const structureOnly = process.argv.includes("--structure-only");
const allowedStatuses = new Set(["Missing", "In Progress", "Blocked", "Complete"]);
const proofPath = path.join(process.cwd(), "docs", "mainnet-proof-record.md");
const boardPath = path.join(process.cwd(), "docs", "mainnet-status-board.md");
const {
  expected,
  requiredProofFilesByGate,
  gatesRequiringCanaryLog,
  statusBoardFirstCheckExpectations,
  requiredProofMarkerExpectations,
} = createLaunchGatePolicyMaps({ verifier: true });
const proofRecordMarkerExpectations = requiredProofMarkerExpectations;
const requiredStatusBoardVerificationSnippets = [
  "Last local verification:",
  "npm.cmd run proof:local",
  "L1-L17",
  "proof:remaining",
  "proof:files",
  "proof:gates -- --structure-only",
  "proof:launch-map",
  "proof:launch-docs",
  "proof:readiness",
  "`proof:launch`",
  "`proof:launch -- --strict`",
  "expected-fail",
  "production dependency audit high/critical pass",
  "all-dependency audit with the documented known dev-toolchain exception",
  "strict launch expected-fail coverage",
  "residual security follow-up 8/8",
  "G1-G14 remain Missing pending external evidence",
  "Latest aggregate verification:",
  "npm.cmd run proof:prelaunch:summary",
  "passed all required local rows",
  "final security scan",
  "24 external/status blockers",
  "0/14 Complete launch gates",
  "## Autonomous Work Boundary",
  "Autonomous local work may improve proof tooling",
  "It must not mark any G1-G14 row Complete",
  "External evidence is still required",
];
const requiredProofRecordSnippets = [
  "## Required final command",
  `$env:CANARY_PROOF_PATH = "docs/canary-proof.json"`,
  `$env:LIVE_CANARY_MIN_EPOCHS = "50"`,
  "npm.cmd run proof:files -- --canary-log=<canary-log-file>",
  "npm.cmd run proof:launch -- --strict --canary-log=<canary-log-file>",
];

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

function hasEvidence(value) {
  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "_tbd_" && normalized !== "tbd";
}

function hasConcreteEvidence(value) {
  if (!hasEvidence(value)) return false;
  return [
    /npm\s+run\s+proof:/i,
    /npm\s+run\s+health:prod/i,
    /npm\s+run\s+load:http/i,
    /npm\s+run\s+indexer:once/i,
    /0x[a-fA-F0-9]{64}/,
    /https?:\/\//i,
    /\bdocs\/[a-z0-9-]+-proof\.json\b/i,
    /\bdata\/live-test-runs\/[^|\s]+\.jsonl\b/i,
    /\b20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
  ].some((pattern) => pattern.test(value));
}
function normalizeEvidencePath(value) {
  return String(value ?? "").replace(/\\/g, "/");
}

function localArtifactExists(relativePath) {
  return localLaunchArtifactExists(process.cwd(), relativePath);
}

function findDuplicateIds(rows) {
  const seen = new Set();
  const duplicates = new Set();
  for (const row of rows) {
    if (seen.has(row.ID)) duplicates.add(row.ID);
    seen.add(row.ID);
  }
  return [...duplicates].sort();
}
function proofRecordReferenceIssuesFor(id, evidence) {
  const issues = [];
  const normalizedEvidence = normalizeEvidencePath(evidence);
  if (!hasEvidence(String(evidence ?? ""))) {
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

const proofMarkdown = readLaunchMarkdown(proofPath);
const boardMarkdown = readLaunchMarkdown(boardPath);
const proofRows = parseTable(proofMarkdown, ["ID", "Gate", "Status", "Evidence"]);
const boardRows = parseTable(boardMarkdown, ["ID", "Gate", "Required proof", "First check", "Status"]);
const proofById = byId(proofRows);
const boardById = byId(boardRows);
const issues = [];
const duplicateProof = findDuplicateIds(proofRows);
const duplicateBoard = findDuplicateIds(boardRows);
if (duplicateProof.length > 0) issues.push(`duplicate proof gates: ${duplicateProof.join(", ")}`);
for (const snippet of requiredProofRecordSnippets) {
  if (!proofMarkdown.includes(snippet)) {
    issues.push(`proof record must include final command snippet: ${snippet}`);
  }
}
if (duplicateBoard.length > 0) issues.push(`duplicate status board gates: ${duplicateBoard.join(", ")}`);
for (const snippet of requiredStatusBoardVerificationSnippets) {
  if (!boardMarkdown.includes(snippet)) {
    issues.push(`status board last local verification must include: ${snippet}`);
  }
}

for (const id of expected) {
  const proof = proofById.get(id);
  const board = boardById.get(id);

  if (!proof) issues.push(`${id}: missing from ${proofPath}`);
  if (!board) issues.push(`${id}: missing from ${boardPath}`);
  if (!proof || !board) continue;

  if (!allowedStatuses.has(proof.Status)) {
    issues.push(`${id}: proof record status "${proof.Status}" is not allowed`);
  }
  if (!allowedStatuses.has(board.Status)) {
    issues.push(`${id}: status board status "${board.Status}" is not allowed`);
  }
  if (proof.Gate !== board.Gate) {
    issues.push(`${id}: gate name mismatch proof="${proof.Gate}" board="${board.Gate}"`);
  }
  if (proof.Status !== board.Status) {
    issues.push(`${id}: status mismatch proof=${proof.Status} board=${board.Status}`);
  }
  if (proof.Status === "Complete" && !hasEvidence(proof.Evidence)) {
    issues.push(`${id}: complete gate has no proof evidence`);
  }
  if (proof.Status !== "Complete") {
    for (const issue of proofRecordReferenceIssuesFor(id, proof.Evidence)) {
      issues.push(`${id}: ${issue}`);
    }
  }
  if (proof.Status === "Complete" && !hasConcreteEvidence(proof.Evidence)) {
    issues.push(`${id}: complete gate evidence lacks a concrete proof marker`);
  }
  if (proof.Status === "Complete") {
    const normalizedEvidence = normalizeEvidencePath(proof.Evidence);
    for (const marker of proofRecordMarkerExpectations.get(id) ?? []) {
      if (!normalizedEvidence.includes(marker)) {
        issues.push(`${id}: complete gate evidence must reference ${marker}`);
      }
    }
    for (const proofFile of requiredProofFilesByGate.get(id) ?? []) {
      if (!normalizedEvidence.includes(proofFile)) {
        issues.push(`${id}: complete gate evidence must reference ${proofFile}`);
      } else if (!localArtifactExists(proofFile)) {
        issues.push(`${id}: complete gate evidence references missing local artifact ${proofFile}`);
      }
    }
    if (gatesRequiringCanaryLog.has(id)) {
      const canaryLogs = findLiveCanaryLogPaths(proof.Evidence);
      if (canaryLogs.length === 0) {
        issues.push(`${id}: complete gate evidence must reference a data/live-test-runs/*.jsonl canary log`);
      }
      for (const canaryLog of canaryLogs) {
        if (!localArtifactExists(canaryLog)) {
          issues.push(`${id}: complete gate evidence references missing local artifact ${canaryLog}`);
        }
      }
    }
  }
  if (!hasEvidence(board["Required proof"])) {
    issues.push(`${id}: status board required proof is missing`);
  } else {
    const normalizedRequiredProof = normalizeEvidencePath(board["Required proof"]);
    for (const proofFile of requiredProofFilesByGate.get(id) ?? []) {
      if (!normalizedRequiredProof.includes(proofFile)) {
        issues.push(`${id}: status board required proof must reference ${proofFile}`);
      }
    }
    for (const marker of requiredProofMarkerExpectations.get(id) ?? []) {
      if (!normalizedRequiredProof.includes(marker)) {
        issues.push(`${id}: status board required proof must reference ${marker}`);
      }
    }
    if (gatesRequiringCanaryLog.has(id) && !/\b(?:live canary log|canary-log|data\/live-test-runs\/[^|\s`]+\.jsonl)\b/i.test(normalizedRequiredProof)) {
      issues.push(`${id}: status board required proof must reference a live canary log`);
    }
  }
  if (!hasEvidence(board["First check"])) {
    issues.push(`${id}: status board first check is missing`);
  } else {
    for (const part of statusBoardFirstCheckExpectations.get(id) ?? []) {
      if (!board["First check"].includes(part)) {
        issues.push(`${id}: status board first check must include ${part}`);
      }
    }
  }
}

const extraProof = proofRows.map((row) => row.ID).filter((id) => !expected.includes(id));
const extraBoard = boardRows.map((row) => row.ID).filter((id) => !expected.includes(id));
if (extraProof.length > 0) issues.push(`unexpected proof gates: ${extraProof.join(", ")}`);
if (extraBoard.length > 0) issues.push(`unexpected status board gates: ${extraBoard.join(", ")}`);

const complete = expected.filter((id) => proofById.get(id)?.Status === "Complete").length;
const missing = expected.filter((id) => proofById.get(id)?.Status === "Missing").length;
const inProgress = expected.filter((id) => proofById.get(id)?.Status === "In Progress").length;
const blocked = expected.filter((id) => proofById.get(id)?.Status === "Blocked").length;
const incompleteIds = expected.filter((id) => proofById.get(id)?.Status !== "Complete");

console.log("# Launch Gate Summary");
console.log("");
console.log(`Strict: ${strict ? "yes" : "no"}`);
console.log(`Structure only: ${structureOnly ? "yes" : "no"}`);
console.log("");
console.log("| Metric | Value |");
console.log("| --- | --- |");
console.log(`| expected gates | ${expected.length} |`);
console.log(`| complete | ${complete} |`);
console.log(`| missing | ${missing} |`);
console.log(`| in progress | ${inProgress} |`);
console.log(`| blocked | ${blocked} |`);
console.log(`| structural issues | ${issues.length} |`);

if (!structureOnly && incompleteIds.length > 0) {
  console.log("");
  console.log(`Incomplete gates: ${incompleteIds.join(", ")}`);
}

if (issues.length > 0) {
  console.log("");
  console.log("Issues:");
  for (const issue of issues) console.log(`- ${issue}`);
}

if (structureOnly && issues.length === 0) {
  console.log("");
  console.log("Summary: launch gate table structure is consistent.");
}

if ((structureOnly && issues.length > 0) || (strict && (issues.length > 0 || incompleteIds.length > 0))) {
  process.exitCode = 1;
}
