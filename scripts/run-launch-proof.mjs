import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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

const canaryLog = args.get("canary-log") || process.env.PROOF_CANARY_LOG || "";
const commonArgs = strict ? ["--strict"] : [];
const checks = [
  { id: "LOCAL", label: "template guard", script: "scripts/check-proof-templates.mjs", args: [] },
  { id: "LOCAL", label: "draft guard", script: "scripts/check-proof-drafts.mjs", args: [] },
  { id: "LOCAL", label: "proof file guard", script: "scripts/check-proof-files.mjs", args: canaryLog ? [`--canary-log=${canaryLog}`] : [] },
  { id: "LOCAL", label: "gate table structure", script: "scripts/check-launch-gates.mjs", args: ["--structure-only"] },
  { id: "LOCAL", label: "command map guard", script: "scripts/check-launch-command-map.mjs", args: [] },
  { id: "LOCAL", label: "launch doc command guard", script: "scripts/check-launch-doc-command-syntax.mjs", args: [] },
  { id: "LOCAL", label: "readiness checklist guard", script: "scripts/check-readiness-checklist.mjs", args: [] },
  { id: "LOCAL", label: "collector redaction guard", script: "scripts/check-proof-collector-redaction.mjs", args: [] },
  { id: "LOCAL", label: "host load target guard", script: "scripts/check-host-proof-load-target.mjs", args: [] },
  { id: "LOCAL", label: "remaining evidence report", script: "scripts/report-launch-remaining.mjs", args: [] },
  { id: "LOCAL", label: "remaining evidence JSON", script: "scripts/report-launch-remaining.mjs", args: ["--json"] },
  { id: "G1", label: "final contract/env", script: "scripts/collect-mainnet-proof.mjs", args: commonArgs },
  { id: "G1-G4", label: "contract/funds sign-off", script: "scripts/check-signoff-proof.mjs", args: commonArgs },
  { id: "G2/G4", label: "chain reads", script: "scripts/collect-chain-proof.mjs", args: commonArgs },
  { id: "G5", label: "process model preflight", script: "scripts/check-process-model.mjs", args: commonArgs },
  { id: "G5/G6", label: "production host/process/health/load", script: "scripts/check-host-proof.mjs", args: commonArgs },
  { id: "G7", label: "indexer fresh DB dry-run", script: "scripts/check-indexer-dry-run.mjs", args: commonArgs },
  { id: "G8", label: "backup/restore drill", script: "scripts/verify-db-restore.mjs", args: commonArgs },
  { id: "G9", label: "monitoring/error tracking", script: "scripts/check-monitoring-proof.mjs", args: commonArgs },
  { id: "G12-G14", label: "wallet/failure/final QA", script: "scripts/check-qa-proof.mjs", args: commonArgs },
  canaryLog
    ? { id: "G10/G11", label: "real-epoch canary and tx recovery", script: "scripts/analyze-live-canary-proof.mjs", args: [canaryLog, ...commonArgs] }
    : { id: "G10/G11", label: "real-epoch canary and tx recovery", missingInput: "missing --canary-log or PROOF_CANARY_LOG" },
  { id: "G1-G14", label: "gate table", script: "scripts/check-launch-gates.mjs", args: commonArgs },
];

function summarizeOutput(output) {
  const trimmed = output.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      const issueCount = [
        parsed.inconsistentGates,
        parsed.completeGateEvidenceIssues,
        parsed.requiredProofIssues,
        parsed.proofRecordReferenceIssues,
        parsed.firstCheckIssues,
      ].reduce((total, value) => total + (Array.isArray(value) ? value.length : 0), 0);
      return `JSON: ${(parsed.remainingGates ?? []).length} remaining gate(s), ${issueCount} issue(s)`;
    } catch {
      return "invalid JSON output";
    }
  }
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const summary = [...lines].reverse().find((line) => line.startsWith("Summary:"));
  if (summary) return summary;
  const incomplete = lines.find((line) => line.startsWith("Incomplete gates:"));
  if (incomplete) return incomplete;
  const failed = lines.find((line) => /FAILED|issue|missing|invalid/i.test(line));
  return failed || lines.at(-1) || "";
}

function summaryIsClean(summary) {
  if (!summary) return false;
  if (/Incomplete gates:/i.test(summary)) return false;
  if (/^JSON:/i.test(summary)) return /JSON:\s*0 remaining gate\(s\), 0 issue\(s\)/i.test(summary);
  if (/\b\d+\s+(?:proof\s+)?issue\(s\)|\b\d+\s+env gate\(s\)|\b\d+\s+issue\(s\)/i.test(summary)) return false;
  if (/missing|invalid|failing|failed/i.test(summary)) return false;
  return /without detected issues|all checked env gates passed|all proof templates are rejected by strict validators|all proof drafts are rejected by strict validators|proof manifest files are clean or not yet collected|all required proof manifest files are present and clean|launch gate table structure is consistent|launch evidence command map is consistent|launch docs command syntax is PowerShell-safe|readiness checklist structure is consistent|proof collector redaction guard passed|host proof load target guard passed|no remaining launch evidence rows/i.test(summary);
}

function printTable(headers, rows) {
  console.log(`| ${headers.join(" | ")} |`);
  console.log(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}

console.log("# Launch Proof Summary");
console.log("");
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log(`Strict: ${strict ? "yes" : "no"}`);
console.log(`Canary log: ${canaryLog || "missing"}`);
console.log("");

const rows = [];
let failed = 0;
if (!strict) {
  failed += 1;
  rows.push(["G1-G14", "strict launch mode", "fail", "n/a", "proof:launch requires --strict or PROOF_STRICT=1"]);
}


for (const check of checks) {
  if (check.missingInput) {
    failed += 1;
    rows.push([check.id, check.label, "fail", "n/a", check.missingInput]);
    continue;
  }

  const scriptPath = resolve(process.cwd(), check.script);
  if (!existsSync(scriptPath)) {
    failed += 1;
    rows.push([check.id, check.label, "fail", "n/a", `missing script ${check.script}`]);
    continue;
  }

  const result = spawnSync(process.execPath, [check.script, ...check.args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const summary = summarizeOutput(output);
  const exitCode = typeof result.status === "number" ? result.status : 1;
  const ok = exitCode === 0 && summaryIsClean(summary);
  if (!ok) failed += 1;
  rows.push([check.id, check.label, ok ? "pass" : "fail", String(exitCode), summary.replace(/\|/g, "\\|") || "no summary"]);
}

printTable(["Gate", "Check", "Status", "Exit", "Summary"], rows);
console.log("");
console.log(`Overall: ${failed === 0 ? "all launch proof checks passed" : `${failed} launch proof check(s) failed or missing`}.`);

if (failed > 0) {
  process.exitCode = 1;
}
