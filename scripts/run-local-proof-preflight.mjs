import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const checks = [
  {
    id: "L1",
    label: "template guard",
    script: "scripts/check-proof-templates.mjs",
    args: [],
    cleanPattern: /Summary: all proof templates are rejected by strict validators\./i,
  },
  {
    id: "L2",
    label: "draft guard",
    script: "scripts/check-proof-drafts.mjs",
    args: [],
    cleanPattern: /Summary: all proof drafts are rejected by strict validators\./i,
  },
  {
    id: "L3",
    label: "proof file guard",
    script: "scripts/check-proof-files.mjs",
    args: [],
    cleanPattern: /Summary: proof manifest files are clean or not yet collected\./i,
  },
  {
    id: "L4",
    label: "process model",
    script: "scripts/check-process-model.mjs",
    args: ["--strict"],
    cleanPattern: /Summary: process model preflight completed without detected issues\./i,
  },
  {
    id: "L5",
    label: "gate table structure",
    script: "scripts/check-launch-gates.mjs",
    args: ["--structure-only"],
    cleanPattern: /Summary: launch gate table structure is consistent\./i,
  },
  {
    id: "L6",
    label: "command map",
    script: "scripts/check-launch-command-map.mjs",
    args: [],
    cleanPattern: /Summary: launch evidence command map is consistent\./i,
  },
  {
    id: "L7",
    label: "launch doc commands",
    script: "scripts/check-launch-doc-command-syntax.mjs",
    args: [],
    cleanPattern: /Summary: launch docs command syntax is PowerShell-safe\./i,
  },
  {
    id: "L8",
    label: "readiness checklist",
    script: "scripts/check-readiness-checklist.mjs",
    args: [],
    cleanPattern: /Summary: readiness checklist structure is consistent\./i,
  },
  {
    id: "L9",
    label: "collector redaction",
    script: "scripts/check-proof-collector-redaction.mjs",
    args: [],
    cleanPattern: /Summary: proof collector redaction guard passed\./i,
  },
  {
    id: "L10",
    label: "host load target",
    script: "scripts/check-host-proof-load-target.mjs",
    args: [],
    cleanPattern: /Summary: host proof load target guard passed\./i,
  },
  {
    id: "L11",
    label: "remaining evidence report",
    script: "scripts/report-launch-remaining.mjs",
    args: [],
    cleanPattern: /\|\s*inconsistent gate rows\s*\|\s*none\s*\|[\s\S]*\|\s*complete gate evidence issues\s*\|\s*none\s*\|[\s\S]*\|\s*required proof issues\s*\|\s*none\s*\|[\s\S]*\|\s*proof record reference issues\s*\|\s*none\s*\|[\s\S]*\|\s*first check issues\s*\|\s*none\s*\|/i,
  },  {
    id: "L12",
    label: "remaining evidence JSON",
    script: "scripts/report-launch-remaining.mjs",
    args: ["--json"],
    cleanPattern: /"inconsistentGates": \[\][\s\S]*"completeGateEvidenceIssues": \[\][\s\S]*"requiredProofIssues": \[\][\s\S]*"proofRecordReferenceIssues": \[\][\s\S]*"firstCheckIssues": \[\]/i,
  },
];

function summarizeOutput(output) {
  const trimmed = output.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      return `JSON: ${(parsed.remainingGates ?? []).length} remaining gate(s), ${(parsed.firstCheckIssues ?? []).length} first-check issue(s)`;
    } catch {
      return "invalid JSON output";
    }
  }
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const summary = [...lines].reverse().find((line) => line.startsWith("Summary:"));
  if (summary) return summary;
  const structural = lines.find((line) => /\|\s*structural issues\s*\|/i.test(line));
  if (structural) return structural;
  return lines.at(-1) || "";
}

function printTable(headers, rows) {
  console.log(`| ${headers.join(" | ")} |`);
  console.log(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}

console.log("# Local Launch Proof Preflight");
console.log("");
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("");

const rows = [];
const issues = [];

for (const check of checks) {
  const scriptPath = resolve(process.cwd(), check.script);
  if (!existsSync(scriptPath)) {
    issues.push(`${check.id}: missing script ${check.script}`);
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
  const exitCode = typeof result.status === "number" ? result.status : 1;
  const summary = summarizeOutput(output);
  const clean = exitCode === 0 && check.cleanPattern.test(output);
  if (!clean) issues.push(`${check.id}: ${check.label} failed local preflight`);
  rows.push([check.id, check.label, clean ? "pass" : "fail", String(exitCode), summary.replace(/\|/g, "\\|") || "no summary"]);
}

printTable(["ID", "Check", "Status", "Exit", "Summary"], rows);
console.log("");
console.log(`Summary: ${issues.length === 0 ? "local launch proof preflight passed" : `${issues.length} issue(s): ${issues.join("; ")}`}.`);

if (issues.length > 0) {
  process.exitCode = 1;
}
