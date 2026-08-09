import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const templateDoc = "docs/launch-proof-manifest-templates.md";
const MAX_PROOF_TEMPLATE_DOC_BYTES = 512 * 1024;
const summaryOnly = process.argv.includes("--summary-only");

function readTemplateDoc(filePath) {
  if (!existsSync(filePath)) throw new Error(`Missing proof template doc: ${filePath}`);
  const stats = statSync(filePath);
  if (!stats.isFile()) throw new Error(`Proof template doc must be a file: ${filePath}`);
  if (stats.size > MAX_PROOF_TEMPLATE_DOC_BYTES) {
    throw new Error(`Proof template doc is too large to validate safely: ${filePath}`);
  }
  return readFileSync(filePath, "utf8");
}

const templateSource = readTemplateDoc(templateDoc);
const checks = [
  {
    id: "signoff",
    heading: "docs/signoff-proof.json",
    envName: "SIGNOFF_PROOF_PATH",
    script: "scripts/check-signoff-proof.mjs",
    expectedPattern: /template placeholder|zero|invalid/i,
  },
  {
    id: "host",
    heading: "docs/host-proof.json",
    envName: "HOST_PROOF_PATH",
    script: "scripts/check-host-proof.mjs",
    expectedPattern: /template placeholder|final HTTPS origin|missing/i,
  },
  {
    id: "indexer",
    heading: "docs/indexer-proof.json",
    envName: "INDEXER_PROOF_PATH",
    script: "scripts/check-indexer-dry-run.mjs",
    expectedPattern: /template placeholder|indexer proof manifest|LORE_DB_PATH|INDEXER/i,
  },
  {
    id: "monitoring",
    heading: "docs/monitoring-proof.json",
    envName: "MONITORING_PROOF_PATH",
    script: "scripts/check-monitoring-proof.mjs",
    expectedPattern: /template placeholder|health-prod|missing/i,
  },
  {
    id: "restore",
    heading: "docs/restore-proof.json",
    envName: "RESTORE_PROOF_PATH",
    script: "scripts/verify-db-restore.mjs",
    expectedPattern: /template placeholder|restore proof manifest|source DB|outside repo/i,
  },
  {
    id: "qa",
    heading: "docs/qa-proof.json",
    envName: "QA_PROOF_PATH",
    script: "scripts/check-qa-proof.mjs",
    expectedPattern: /template placeholder|real non-zero txHash|missing/i,
  },
  {
    id: "canary",
    heading: "docs/canary-proof.json",
    envName: "CANARY_PROOF_PATH",
    script: "scripts/analyze-live-canary-proof.mjs",
    needsCanaryLog: true,
    expectedPattern: /template placeholder|targetNetwork|recovery|transactionHealth|unique bet epochs|duplicate/i,
  },
];

function extractJsonBlock(heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`## \`${escaped}\`[\\s\\S]*?\`\`\`json\\r?\\n([\\s\\S]*?)\\r?\\n\`\`\``, "m");
  const match = templateSource.match(pattern);
  if (!match) throw new Error(`Missing JSON template block for ${heading}`);
  JSON.parse(match[1]);
  return match[1];
}

function printTable(headers, rows) {
  console.log(`| ${headers.join(" | ")} |`);
  console.log(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}

const tempDir = mkdtempSync(join(tmpdir(), "lore-proof-templates-"));
const rows = [];
const issues = [];

try {
  const canaryLogPath = join(tempDir, "canary-template-sample.jsonl");
  writeFileSync(
    canaryLogPath,
    `${JSON.stringify({
      amount: "1",
      chainId: 59144,
      contractAddress: "0x0000000000000000000000000000000000000001",
      durationMs: 1,
      epoch: "1",
      gasUsed: "1",
      mode: "single",
      network: "mainnet",
      nonceLatest: 1,
      noncePending: 1,
      ok: true,
      rpcLabel: "redacted-mainnet-rpc",
      role: "TEMPLATE",
      round: 0,
      timestamp: "2026-01-01T00:00:00.000Z",
      totalAmount: "1",
      txStatus: "success",
      tiles: [1],
    })}\n`,
  );

  for (const check of checks) {
    const json = extractJsonBlock(check.heading);
    const manifestPath = join(tempDir, `${check.id}.json`);
    writeFileSync(manifestPath, json);

    const scriptArgs = [check.script, ...(check.needsCanaryLog ? [canaryLogPath] : []), ...(check.extraArgs ?? []), "--strict"];
    const result = spawnSync(process.execPath, scriptArgs, {
      cwd: process.cwd(),
      env: { ...process.env, [check.envName]: manifestPath },
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    const output = `${result.stdout || ""}\n${result.stderr || ""}`;
    const exitCode = typeof result.status === "number" ? result.status : 1;
    const summary = output.split(/\r?\n/).find((line) => line.startsWith("Summary:")) ?? "no summary";
    const failedAsExpected = exitCode !== 0 && check.expectedPattern.test(output);
    if (!failedAsExpected) {
      issues.push(`${check.id} template did not fail strict validation as expected`);
    }
    rows.push([
      check.id,
      exitCode === 0 ? "unexpected pass" : "failed",
      failedAsExpected ? "yes" : "no",
      summary.replace(/\|/g, "\\|"),
    ]);
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log("# Proof Template Guard");
console.log("");
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("");
if (summaryOnly) {
  const rejected = rows.filter((row) => row[2] === "yes").length;
  console.log(`status=${issues.length === 0 ? "pass" : "fail"}, templates=${rows.length}, rejected=${rejected}, issues=${issues.length}`);
  console.log(`Summary: ${issues.length === 0 ? "all proof templates are rejected by strict validators" : `${issues.length} proof template issue(s)`}.`);
} else {
  printTable(["Template", "Strict result", "Rejected as template", "Summary"], rows);
  console.log("");
  console.log(`Summary: ${issues.length === 0 ? "all proof templates are rejected by strict validators" : `${issues.length} issue(s): ${issues.join("; ")}`}.`);
}

if (issues.length > 0) {
  process.exitCode = 1;
}
