import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const checklistPath = resolve(process.cwd(), "docs/mainnet-readiness-checklist.md");
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
  "--manifest=docs/restore-proof.json",
  "indexer:once",
  "proof:indexer:collect",
  "proof:monitoring:plan",
  "proof:monitoring:draft",
  "proof:qa:plan",
  "proof:canary -- data/live-test-runs/live-canary-YYYY.jsonl --strict",
  "proof:canary:draft",
  "proof:qa:draft",
  "proof:files -- --canary-log=",
  "proof:launch -- --strict",
  "proof:signoff -- --strict",
  "proof:host -- --strict",
  "proof:indexer -- --strict",
  "proof:restore -- --strict",
  "proof:monitoring -- --strict",
  "proof:qa -- --strict",
];
const checkedEvidencePattern = /`[^`]+`|docs\/|https?:\/\/|0x[a-fA-F0-9]{40,64}|\/api\/|via\b|exposes\b|recorded\b/i;

function readText(filePath) {
  if (!existsSync(filePath)) throw new Error(`${filePath} does not exist`);
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
  issues.push(error instanceof Error ? error.message : String(error));
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

for (const item of checkedItems) {
  if (!checkedEvidencePattern.test(item.line)) {
    issues.push(`checked item lacks evidence marker at ${item.lineNo}`);
  }
}

if (!/Do not mark a checkbox complete from memory or intent/i.test(checklist)) {
  issues.push("checklist must warn against checking items from memory or intent");
}

printTable(["Check", "Status"], [
  ["required sections", requiredSections.every((section) => checklist.includes(section)) ? "pass" : "fail"],
  ["required proof commands", requiredSnippets.every((snippet) => checklist.includes(snippet)) ? "pass" : "fail"],
  ["required final proof files", requiredFinalProofFiles.every((file) => checklist.includes(file)) ? "pass" : "fail"],
  ["checked item evidence", checkedItems.every((item) => checkedEvidencePattern.test(item.line)) ? `pass (${checkedItems.length})` : "fail"],
]);

console.log(`Summary: ${issues.length === 0 ? "readiness checklist structure is consistent" : `${issues.length} issue(s): ${issues.join("; ")}`}.`);

if (issues.length > 0) {
  process.exitCode = 1;
}
