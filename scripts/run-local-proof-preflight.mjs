import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
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
    withTemporaryChainSnapshot: true,
    withUnexpectedProofRegression: true,
    withAuxiliarySnapshotContentRegression: true,
    withCanaryLogShapeRegression: true,
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
    cleanPattern: /\|\s*inconsistent gate rows\s*\|\s*none\s*\|[\s\S]*\|\s*complete gate evidence issues\s*\|\s*none\s*\|[\s\S]*\|\s*required proof issues\s*\|\s*none\s*\|[\s\S]*\|\s*proof record reference issues\s*\|\s*none\s*\|[\s\S]*\|\s*first check issues\s*\|\s*none\s*\|[\s\S]*(?:\|\s*Next Gate\s*\|\s*First check\s*\|\s*Required proof\s*\||All G1-G14 gates are marked Complete)/i,
  },
  {
    id: "L12",
    label: "remaining evidence JSON",
    script: "scripts/report-launch-remaining.mjs",
    args: ["--json"],
    cleanPattern: /"inconsistentGates": \[\][\s\S]*"completeGateEvidenceIssues": \[\][\s\S]*"requiredProofIssues": \[\][\s\S]*"proofRecordReferenceIssues": \[\][\s\S]*"firstCheckIssues": \[\]/i,
  },
  {
    id: "L13",
    label: "mainnet proof output",
    script: "scripts/check-mainnet-proof-output.mjs",
    args: [],
    cleanPattern: /Summary: mainnet proof strict-fail output guard passed\./i,
  },
  {
    id: "L14",
    label: "strict launch expected fail",
    script: "scripts/run-launch-proof.mjs",
    args: ["--strict"],
    expectedFailurePattern: /Incomplete gates: G[\d,\s]+[\s\S]*Overall: \d+ launch proof check\(s\) failed or missing/i,
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

  const chainSnapshotPath = resolve(process.cwd(), "docs/chain-proof-snapshot.json");
  const createdChainSnapshot = Boolean(check.withTemporaryChainSnapshot && !existsSync(chainSnapshotPath));
  if (createdChainSnapshot) {
    writeFileSync(
      chainSnapshotPath,
      JSON.stringify({ generatedAt: "2026-07-09T00:00:00.000Z", expectedChainId: 59144, rpcChainId: 59144, contractAddress: "0x1111111111111111111111111111111111111111", epochs: [] }),
      "utf8",
    );
  }

  let result;
  try {
    result = spawnSync(process.execPath, [check.script, ...check.args], {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
  } finally {
    if (createdChainSnapshot && existsSync(chainSnapshotPath)) unlinkSync(chainSnapshotPath);
  }
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const exitCode = typeof result.status === "number" ? result.status : 1;
  let summary = summarizeOutput(output);
  let clean = check.expectedFailurePattern
    ? (exitCode !== 0 && check.expectedFailurePattern.test(output)) || (exitCode === 0 && /Overall: all launch proof checks passed\./i.test(output))
    : exitCode === 0 && check.cleanPattern.test(output);
  if (check.expectedFailurePattern && clean && exitCode !== 0) summary = `expected fail: ${summary}`;

  if (clean && check.withUnexpectedProofRegression) {
    const unexpectedProofPath = resolve(process.cwd(), "docs/unexpected-proof-regression.json");
    const createdUnexpectedProof = !existsSync(unexpectedProofPath);
    if (!createdUnexpectedProof) {
      clean = false;
      summary = "unexpected proof regression path already exists";
    } else {
      let unexpectedResult;
      try {
        writeFileSync(unexpectedProofPath, JSON.stringify({ generatedAt: "2026-07-09T00:00:00.000Z" }), "utf8");
        unexpectedResult = spawnSync(process.execPath, [check.script, ...check.args], {
          cwd: process.cwd(),
          env: process.env,
          encoding: "utf8",
          maxBuffer: 1024 * 1024,
        });
      } finally {
        if (existsSync(unexpectedProofPath)) unlinkSync(unexpectedProofPath);
      }
      const unexpectedOutput = `${unexpectedResult.stdout || ""}\n${unexpectedResult.stderr || ""}`;
      const unexpectedExitCode = typeof unexpectedResult.status === "number" ? unexpectedResult.status : 1;
      if (unexpectedExitCode === 0 || !/unexpected proof-like JSON file docs\/unexpected-proof-regression\.json/i.test(unexpectedOutput)) {
        clean = false;
        summary = `unexpected proof regression failed: ${summarizeOutput(unexpectedOutput)}`;
      }
    }
  }

  if (clean && check.withAuxiliarySnapshotContentRegression) {
    const auxiliaryRegressionRoot = resolve(process.cwd(), ".tmp", `local-proof-aux-snapshot-regression-${process.pid}`);
    const auxiliaryDocsDir = resolve(auxiliaryRegressionRoot, "docs");
    const auxiliarySnapshotPath = resolve(auxiliaryDocsDir, "chain-proof-snapshot.json");
    try {
      mkdirSync(auxiliaryDocsDir, { recursive: true });
      writeFileSync(auxiliarySnapshotPath, JSON.stringify({ generatedAt: "TODO", rpcChainId: 59144 }), "utf8");
      const badResult = spawnSync(process.execPath, [scriptPath], {
        cwd: auxiliaryRegressionRoot,
        env: process.env,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      });
      const badOutput = `${badResult.stdout || ""}\n${badResult.stderr || ""}`;
      const badExitCode = typeof badResult.status === "number" ? badResult.status : 1;
      writeFileSync(auxiliarySnapshotPath, JSON.stringify({ generatedAt: "2026-07-09T00:00:00.000Z", rpcChainId: 59144, rpcUrl: "https://rpc.example.test/secret-key" }), "utf8");
      const secretResult = spawnSync(process.execPath, [scriptPath], {
        cwd: auxiliaryRegressionRoot,
        env: process.env,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      });
      const secretOutput = `${secretResult.stdout || ""}\n${secretResult.stderr || ""}`;
      const secretExitCode = typeof secretResult.status === "number" ? secretResult.status : 1;
      writeFileSync(auxiliarySnapshotPath, JSON.stringify({ generatedAt: "2026-07-09T00:00:00.000Z", rpcChainId: 59144 }), "utf8");
      const cleanResult = spawnSync(process.execPath, [scriptPath], {
        cwd: auxiliaryRegressionRoot,
        env: process.env,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      });
      const cleanOutput = `${cleanResult.stdout || ""}\n${cleanResult.stderr || ""}`;
      const cleanExitCode = typeof cleanResult.status === "number" ? cleanResult.status : 1;
      if (badExitCode === 0 || !/chain-proof-snapshot\.json: template-like values/i.test(badOutput)) {
        clean = false;
        summary = `auxiliary snapshot template regression failed: ${summarizeOutput(badOutput)}`;
      } else if (secretExitCode === 0 || !/chain-proof-snapshot\.json: secret-like values/i.test(secretOutput)) {
        clean = false;
        summary = `auxiliary snapshot secret regression failed: ${summarizeOutput(secretOutput)}`;
      } else if (cleanExitCode !== 0 || !/Summary: proof manifest files are clean or not yet collected\./i.test(cleanOutput)) {
        clean = false;
        summary = `auxiliary snapshot clean regression failed: ${summarizeOutput(cleanOutput)}`;
      }
    } finally {
      rmSync(auxiliaryRegressionRoot, { recursive: true, force: true });
    }
  }
  if (clean && check.withCanaryLogShapeRegression) {
    const canaryRegressionRoot = resolve(process.cwd(), ".tmp", `local-proof-canary-log-regression-${process.pid}`);
    const canaryDirectoryPath = resolve(canaryRegressionRoot, "canary-log-dir");
    const canaryTextPath = resolve(canaryRegressionRoot, "live-canary.txt");
    const canaryEmptyJsonlPath = resolve(canaryRegressionRoot, "live-canary.jsonl");
    const canaryWhitespaceJsonlPath = resolve(canaryRegressionRoot, "live-canary-whitespace.jsonl");
    const canaryInvalidJsonlPath = resolve(canaryRegressionRoot, "live-canary-invalid.jsonl");
    const canaryNonObjectJsonlPath = resolve(canaryRegressionRoot, "live-canary-non-object.jsonl");
    const canaryTemplateJsonlPath = resolve(canaryRegressionRoot, "live-canary-template.jsonl");
    const canarySecretJsonlPath = resolve(canaryRegressionRoot, "live-canary-secret.jsonl");
    try {
      mkdirSync(canaryDirectoryPath, { recursive: true });
      writeFileSync(canaryTextPath, "{}\n", "utf8");
      writeFileSync(canaryEmptyJsonlPath, "", "utf8");
      writeFileSync(canaryWhitespaceJsonlPath, "  \n\t\n", "utf8");
      writeFileSync(canaryInvalidJsonlPath, "not-json\n", "utf8");
      writeFileSync(canaryNonObjectJsonlPath, "[]\n", "utf8");
      writeFileSync(canaryTemplateJsonlPath, JSON.stringify({ generatedAt: "TODO" }) + "\n", "utf8");
      writeFileSync(canarySecretJsonlPath, JSON.stringify({ generatedAt: "2026-07-09T00:00:00.000Z", rpcUrl: "https://rpc.example.test/secret-key" }) + "\n", "utf8");
      const directoryResult = spawnSync(process.execPath, [check.script, ...check.args, `--canary-log=${canaryDirectoryPath}`], {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      });
      const directoryOutput = `${directoryResult.stdout || ""}\n${directoryResult.stderr || ""}`;
      const directoryExitCode = typeof directoryResult.status === "number" ? directoryResult.status : 1;
      const textResult = spawnSync(process.execPath, [check.script, ...check.args, `--canary-log=${canaryTextPath}`], {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      });
      const textOutput = `${textResult.stdout || ""}\n${textResult.stderr || ""}`;
      const textExitCode = typeof textResult.status === "number" ? textResult.status : 1;
      const emptyResult = spawnSync(process.execPath, [check.script, ...check.args, `--canary-log=${canaryEmptyJsonlPath}`], {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      });
      const emptyOutput = `${emptyResult.stdout || ""}\n${emptyResult.stderr || ""}`;
      const emptyExitCode = typeof emptyResult.status === "number" ? emptyResult.status : 1;
      const whitespaceResult = spawnSync(process.execPath, [check.script, ...check.args, `--canary-log=${canaryWhitespaceJsonlPath}`], {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      });
      const whitespaceOutput = `${whitespaceResult.stdout || ""}\n${whitespaceResult.stderr || ""}`;
      const whitespaceExitCode = typeof whitespaceResult.status === "number" ? whitespaceResult.status : 1;
      const invalidResult = spawnSync(process.execPath, [check.script, ...check.args, `--canary-log=${canaryInvalidJsonlPath}`], {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      });
      const invalidOutput = `${invalidResult.stdout || ""}\n${invalidResult.stderr || ""}`;
      const invalidExitCode = typeof invalidResult.status === "number" ? invalidResult.status : 1;
      const nonObjectResult = spawnSync(process.execPath, [check.script, ...check.args, `--canary-log=${canaryNonObjectJsonlPath}`], {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      });
      const nonObjectOutput = `${nonObjectResult.stdout || ""}\n${nonObjectResult.stderr || ""}`;
      const nonObjectExitCode = typeof nonObjectResult.status === "number" ? nonObjectResult.status : 1;
      const templateResult = spawnSync(process.execPath, [check.script, ...check.args, `--canary-log=${canaryTemplateJsonlPath}`], {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      });
      const templateOutput = `${templateResult.stdout || ""}\n${templateResult.stderr || ""}`;
      const templateExitCode = typeof templateResult.status === "number" ? templateResult.status : 1;
      const secretResult = spawnSync(process.execPath, [check.script, ...check.args, `--canary-log=${canarySecretJsonlPath}`], {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      });
      const secretOutput = `${secretResult.stdout || ""}\n${secretResult.stderr || ""}`;
      const secretExitCode = typeof secretResult.status === "number" ? secretResult.status : 1;
      if (directoryExitCode === 0 || !/canary log is not a file/i.test(directoryOutput)) {
        clean = false;
        summary = `canary log directory regression failed: ${summarizeOutput(directoryOutput)}`;
      } else if (textExitCode === 0 || !/canary log must be a \.jsonl file/i.test(textOutput)) {
        clean = false;
        summary = `canary log extension regression failed: ${summarizeOutput(textOutput)}`;
      } else if (emptyExitCode === 0 || !/canary log is empty/i.test(emptyOutput)) {
        clean = false;
        summary = `canary log empty regression failed: ${summarizeOutput(emptyOutput)}`;
      } else if (whitespaceExitCode === 0 || !/canary log has no non-empty JSONL lines/i.test(whitespaceOutput)) {
        clean = false;
        summary = `canary log whitespace regression failed: ${summarizeOutput(whitespaceOutput)}`;
      } else if (invalidExitCode === 0 || !/canary log first non-empty line is not valid JSON/i.test(invalidOutput)) {
        clean = false;
        summary = `canary log invalid JSON regression failed: ${summarizeOutput(invalidOutput)}`;
      } else if (nonObjectExitCode === 0 || !/canary log first JSONL record must be an object/i.test(nonObjectOutput)) {
        clean = false;
        summary = `canary log non-object regression failed: ${summarizeOutput(nonObjectOutput)}`;
      } else if (templateExitCode === 0 || !/canary log first JSONL record has template-like values/i.test(templateOutput)) {
        clean = false;
        summary = `canary log template regression failed: ${summarizeOutput(templateOutput)}`;
      } else if (secretExitCode === 0 || !/canary log first JSONL record has secret-like values/i.test(secretOutput)) {
        clean = false;
        summary = `canary log secret regression failed: ${summarizeOutput(secretOutput)}`;
      }
    } finally {
      rmSync(canaryRegressionRoot, { recursive: true, force: true });
    }
  }
  if (!clean) issues.push(`${check.id}: ${check.label} failed local preflight`);
  rows.push([check.id, check.label, clean ? "pass" : "fail", String(exitCode), summary.replace(/\|/g, "\\|") || "no summary"]);
}

printTable(["ID", "Check", "Status", "Exit", "Summary"], rows);
console.log("");
console.log(`Summary: ${issues.length === 0 ? "local launch proof preflight passed" : `${issues.length} issue(s): ${issues.join("; ")}`}.`);

if (issues.length > 0) {
  process.exitCode = 1;
}
