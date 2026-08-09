import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const extraDocs = process.argv
  .slice(2)
  .filter((arg) => arg.startsWith("--extra-doc="))
  .map((arg) => arg.slice("--extra-doc=".length).trim())
  .filter(Boolean);
const summaryOnly = process.argv.includes("--summary-only");
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
  "$env:LIVE_CANARY_RPC_LABEL",
];
const MAX_LAUNCH_DOC_TEXT_BYTES = 1024 * 1024;
const packageScripts = JSON.parse(readText("package.json")).scripts ?? {};
const MAX_DOC_PACKAGE_SCRIPT_REFS = 256;

function readText(filePath) {
  if (!existsSync(filePath)) throw new Error(`${filePath} does not exist`);
  const stats = statSync(filePath);
  if (!stats.isFile()) throw new Error(`${filePath} must be a file`);
  if (stats.size > MAX_LAUNCH_DOC_TEXT_BYTES) throw new Error(`${filePath} is too large to validate safely`);
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

function scanMissingPackageScripts(text) {
  const missing = [];
  const pattern = /\bnpm\.cmd\s+run\s+([A-Za-z0-9:_-]+)/g;
  let scanned = 0;
  let overLimit = false;
  let match = pattern.exec(text);
  while (match) {
    scanned += 1;
    if (scanned > MAX_DOC_PACKAGE_SCRIPT_REFS) {
      overLimit = true;
      break;
    }
    const script = match[1];
    if (!(script in packageScripts)) missing.push(script);
    match = pattern.exec(text);
  }
  return { missing: [...new Set(missing)].sort(), overLimit };
}

const rows = [];
const issues = [];
let inlineSyntaxIssueCount = 0;
let missingPackageScriptCount = 0;
let readIssueCount = 0;
let missingPowerShellExampleCount = 0;
let combined = "";

for (const doc of docs) {
  const docPath = resolve(process.cwd(), doc);
  try {
    const text = readText(docPath);
    combined += `\n${text}`;
    const matches = findCommandSyntaxIssues(text);
    const packageScriptScan = scanMissingPackageScripts(text);
    const missingPackageScripts = packageScriptScan.missing;
    if (matches.length > 0) {
      inlineSyntaxIssueCount += matches.length;
      for (const match of matches) {
        issues.push(`${doc}:${match.lineNo} ${match.reason}`);
      }
    }
    if (missingPackageScripts.length > 0) {
      missingPackageScriptCount += missingPackageScripts.length;
      issues.push(`${doc} references missing package script(s): ${missingPackageScripts.join(", ")}`);
    }
    if (packageScriptScan.overLimit) {
      issues.push(`${doc} references too many package scripts to validate safely`);
    }
    rows.push([doc, matches.length === 0 ? "pass" : "fail", missingPackageScripts.length === 0 && !packageScriptScan.overLimit ? "pass" : "fail"]);
  } catch (error) {
    readIssueCount += 1;
    issues.push(error instanceof Error ? error.message : String(error));
    rows.push([doc, "fail", "fail"]);
  }
}

for (const example of requiredPowerShellEnvExamples) {
  if (!combined.includes(example)) {
    missingPowerShellExampleCount += 1;
    issues.push(`launch docs are missing PowerShell example ${example}`);
  }
}

if (summaryOnly) {
  console.log(
    JSON.stringify({
      status: issues.length === 0 ? "pass" : "fail",
      checkedDocs: rows.length,
      inlineSyntaxIssues: inlineSyntaxIssueCount,
      missingPackageScripts: missingPackageScriptCount,
      readIssues: readIssueCount,
      missingPowerShellExamples: missingPowerShellExampleCount,
      launchGate: "local-ops",
    }),
  );
  if (issues.length > 0) process.exitCode = 1;
  process.exit();
}

printTable(["Doc", "Inline Env Syntax", "Package Scripts"], rows);
console.log(`Summary: ${issues.length === 0 ? "launch docs commands are PowerShell-safe and reference existing package scripts" : `${issues.length} issue(s): ${issues.join("; ")}`}.`);

if (issues.length > 0) {
  process.exitCode = 1;
}
