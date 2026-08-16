import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const MAX_READINESS_CHECKLIST_TEXT_BYTES = 1024 * 1024;

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : fallback;
}

const summaryOnly = process.argv.includes("--summary-only");
const checklistPath = resolve(process.cwd(), argValue("checklist", "docs/mainnet-readiness-checklist.md"));
const requiredSections = [
  "## Blockers",
  "### 1. Contract / funds safety",
  "### 2. Auto-mine runtime safety",
  "### 3. Production health / supervision",
  "### 4. Failure-state UX",
  "### 5. Wallet / network correctness",
  "## Should-have",
  "## Polish",
  "## Recommended launch order",
];
const requiredFinalProofFiles = [
  "docs/signoff-proof.json",
  "docs/host-proof.json",
  "docs/indexer-proof.json",
  "docs/restore-proof.json",
  "docs/monitoring-proof.json",
  "docs/qa-proof.json",
  "docs/canary-proof.json",
];
const requiredSnippets = [
  "docs/launch-evidence-command-map.md",
  "proof:mainnet -- --strict",
  "proof:chain -- --strict --out=docs/chain-proof-snapshot.json",
  "proof:signoff:collect",
  "proof:host:collect",
  "proof:restore:collect",
  "proof:restore -- --source=",
  "docs/restore-drill.log",
  "docs/restore-health-prod.log",
  "--backup=<absolute-backup-file-inside-backup-dir>",
  "--manifest=docs/restore-proof.json",
  "indexer:once",
  "proof:indexer:collect",
  "proof:monitoring:plan",
  "proof:monitoring:draft",
  "proof:qa:plan",
  "proof:canary -- data/live-test-runs/live-canary-YYYY.jsonl --strict",
  "proof:canary:draft",
  "proof:qa:draft",
  "Final security scan evidence",
  "fresh Codex Security scan report or sealed scan artifact",
  "no open High/Medium local findings",
  "proof:security-followup:summary",
  "Auto-miner logs expose round, epoch, nonce, tx, retry, and stop reason.",
  "proof:deps",
  "proof:deps:all",
  "proof:files -- --canary-log=",
  "LORE_RESTORE_BACKUP",
  "proof:launch -- --strict",
  "proof:signoff -- --strict",
  "existing saved artifacts",
  "proof:host -- --strict",
  "proof:indexer -- --strict",
  "proof:restore -- --strict",
  "proof:monitoring -- --strict",
  "proof:qa -- --strict",
];
const checkedEvidencePattern = /\b(?:docs|data)\/[^\s`|)]+|[A-Za-z]:\\[^|\r\n]+|https?:\/\/|0x[a-fA-F0-9]{40,64}|\/api\//i;
const MAX_LOCAL_EVIDENCE_PATHS = 64;

function localEvidencePathScan(value) {
  const text = String(value ?? "");
  const pattern = /\b(?:docs|data)\/[^\s`|)]+/gi;
  const paths = [];
  let match = pattern.exec(text);
  while (match) {
    if (paths.length >= MAX_LOCAL_EVIDENCE_PATHS) {
      return { paths, overLimit: true };
    }
    paths.push(match[0].replace(/[.,;:]+$/g, ""));
    match = pattern.exec(text);
  }
  return { paths, overLimit: false };
}

function regularFileStat(filePath) {
  try {
    const stats = statSync(filePath);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
}

function isStrictlyInside(rootPath, candidatePath) {
  const relativePath = relative(rootPath, candidatePath);
  return relativePath !== ""
    && !isAbsolute(relativePath)
    && relativePath !== ".."
    && !relativePath.startsWith(`..${sep}`);
}

function localEvidenceFileExists(evidencePath) {
  const normalizedEvidencePath = String(evidencePath ?? "").replace(/\\/g, "/");
  const scope = normalizedEvidencePath.split("/", 1)[0]?.toLowerCase();
  if (scope !== "docs" && scope !== "data") return false;
  try {
    const scopeRoot = realpathSync.native(resolve(process.cwd(), scope));
    const resolved = resolve(process.cwd(), normalizedEvidencePath);
    const canonicalEvidencePath = realpathSync.native(resolved);
    return isStrictlyInside(scopeRoot, canonicalEvidencePath)
      && regularFileStat(resolved) !== null;
  } catch {
    return false;
  }
}

function checkedEvidenceIssuesFor(item) {
  const itemIssues = [];
  if (!checkedEvidencePattern.test(item.line)) {
    itemIssues.push(`checked item lacks evidence marker at ${item.lineNo}`);
  }
  const evidencePathScan = localEvidencePathScan(item.line);
  if (evidencePathScan.overLimit) {
    itemIssues.push(`checked item has too many local evidence references at ${item.lineNo}`);
  }
  for (const evidencePath of evidencePathScan.paths) {
    if (!localEvidenceFileExists(evidencePath)) {
      itemIssues.push(`checked item references missing local evidence ${evidencePath} at ${item.lineNo}`);
    }
  }
  return itemIssues;
}

function readText(filePath) {
  const stats = regularFileStat(filePath);
  if (!stats) throw new Error(`${filePath} does not exist or must be a file`);
  if (!stats.isFile()) throw new Error(`${filePath} must be a file`);
  if (stats.size > MAX_READINESS_CHECKLIST_TEXT_BYTES) {
    throw new Error(`${filePath} is too large to validate safely`);
  }
  return readFileSync(filePath, "utf8");
}

function printTable(headers, rows) {
  console.log(`| ${headers.join(" | ")} |`);
  console.log(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}

const issues = [];
let checklist = "";

try {
  checklist = readText(checklistPath);
} catch (error) {
  issues.push(summaryOnly ? "readiness checklist could not be read" : error instanceof Error ? error.message : String(error));
}

for (const section of requiredSections) {
  if (!checklist.includes(section)) issues.push(`missing section ${section}`);
}
for (const snippet of requiredSnippets) {
  if (!checklist.includes(snippet)) issues.push(`missing required command/reference ${snippet}`);
}

for (const proofFile of requiredFinalProofFiles) {
  if (!checklist.includes(proofFile)) issues.push(`missing required final proof file ${proofFile}`);
}
const checkedItems = checklist
  .split(/\r?\n/)
  .map((line, index) => ({ line, lineNo: index + 1 }))
  .filter(({ line }) => /^-\s+\[x\]/i.test(line.trim()));

const checkedEvidenceIssues = checkedItems.flatMap((item) => checkedEvidenceIssuesFor(item));
issues.push(...checkedEvidenceIssues);

if (!/Do not mark a checkbox complete from memory or intent/i.test(checklist)) {
  issues.push("checklist must warn against checking items from memory or intent");
}

const rows = [
  ["required sections", requiredSections.every((section) => checklist.includes(section)) ? "pass" : "fail"],
  ["required proof commands", requiredSnippets.every((snippet) => checklist.includes(snippet)) ? "pass" : "fail"],
  ["required final proof files", requiredFinalProofFiles.every((file) => checklist.includes(file)) ? "pass" : "fail"],
  ["checked item evidence", checkedEvidenceIssues.length === 0 ? `pass (${checkedItems.length})` : "fail"],
];

if (summaryOnly) {
  console.log(`status=${issues.length === 0 ? "pass" : "fail"}, checks=${rows.length}, checkedItems=${checkedItems.length}, evidenceIssues=${checkedEvidenceIssues.length}, issues=${issues.length}`);
  console.log(`Summary: ${issues.length === 0 ? "readiness checklist structure is consistent" : `${issues.length} readiness checklist issue(s)`}.`);
} else {
  printTable(["Check", "Status"], rows);
  console.log(`Summary: ${issues.length === 0 ? "readiness checklist structure is consistent" : `${issues.length} issue(s): ${issues.join("; ")}`}.`);
}

if (issues.length > 0) {
  process.exitCode = 1;
}
