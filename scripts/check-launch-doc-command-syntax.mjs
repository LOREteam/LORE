import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const extraDocs = process.argv
  .slice(2)
  .filter((arg) => arg.startsWith("--extra-doc="))
  .map((arg) => arg.slice("--extra-doc=".length).trim())
  .filter(Boolean);
const docs = [
  "docs/launch-evidence-command-map.md",
  "docs/launch-proof-manifest-templates.md",
  "docs/mainnet-readiness-checklist.md",
  "docs/mainnet-status-board.md",
  "docs/mainnet-proof-record.md",
  "docs/production-runbook.md",
  ...extraDocs,
];
const inlineEnvBeforeNpm = /\b[A-Z][A-Z0-9_]*=[^\r\n`|;&]*\bnpm(?:\.cmd)?\s+run\b/;
const shellFenceRe = /^```(?<lang>[a-zA-Z0-9_-]*)\s*$/;
const bareEnvAssignment = /^\s*[A-Z][A-Z0-9_]*=[^\s`|;&]+(?:\s*\\)?\s*$/;
const shellFenceLanguages = new Set(["", "bash", "sh", "shell", "zsh", "powershell", "pwsh", "ps1"]);
const requiredPowerShellEnvExamples = [
  "$env:CANARY_PROOF_PATH",
  "$env:LIVE_CANARY_MIN_EPOCHS",
];

function readText(filePath) {
  if (!existsSync(filePath)) throw new Error(`${filePath} does not exist`);
  return readFileSync(filePath, "utf8");
}

function printTable(headers, rows) {
  console.log(`| ${headers.join(" | ")} |`);
  console.log(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}

function findCommandSyntaxIssues(text) {
  const matches = [];
  let inFence = false;
  let shellFence = false;
  text.split(/\r?\n/).forEach((line, index) => {
    const lineNo = index + 1;
    const fence = line.match(shellFenceRe);
    if (fence) {
      if (!inFence) {
        inFence = true;
        shellFence = shellFenceLanguages.has((fence.groups?.lang ?? "").toLowerCase());
      } else {
        inFence = false;
        shellFence = false;
      }
      return;
    }
    if (inlineEnvBeforeNpm.test(line)) {
      matches.push({ line, lineNo, reason: "uses inline env assignment before npm" });
    }
    if (inFence && shellFence && bareEnvAssignment.test(line)) {
      matches.push({ line, lineNo, reason: "uses bare env assignment inside a shell code block" });
    }
  });
  return matches;
}

const rows = [];
const issues = [];
let combined = "";

for (const doc of docs) {
  const docPath = resolve(process.cwd(), doc);
  try {
    const text = readText(docPath);
    combined += `\n${text}`;
    const matches = findCommandSyntaxIssues(text);
    if (matches.length > 0) {
      for (const match of matches) {
        issues.push(`${doc}:${match.lineNo} ${match.reason}`);
      }
    }
    rows.push([doc, matches.length === 0 ? "pass" : "fail"]);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
    rows.push([doc, "fail"]);
  }
}

for (const example of requiredPowerShellEnvExamples) {
  if (!combined.includes(example)) {
    issues.push(`launch docs are missing PowerShell example ${example}`);
  }
}

printTable(["Doc", "Inline Env Syntax"], rows);
console.log(`Summary: ${issues.length === 0 ? "launch docs command syntax is PowerShell-safe" : `${issues.length} issue(s): ${issues.join("; ")}`}.`);

if (issues.length > 0) {
  process.exitCode = 1;
}
