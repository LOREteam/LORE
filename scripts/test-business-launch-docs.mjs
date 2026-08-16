import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = process.cwd();
const verifierPath = resolve(projectRoot, "scripts", "check-launch-doc-command-syntax.mjs");

function runVerifier(extraDoc = "") {
  const args = [verifierPath, "--summary-only"];
  if (extraDoc) args.push(`--extra-doc=${extraDoc}`);
  return spawnSync(process.execPath, args, {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
}

function parseSummary(result) {
  assert.equal(result.stderr, "");
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /(?:node:internal|at Module\.|at file:)/i);
  return JSON.parse(result.stdout);
}

export function runLaunchDocsBehaviorTests() {
  const baseline = runVerifier();
  assert.equal(baseline.status, 0, `${baseline.stdout}\n${baseline.stderr}`);
  assert.deepEqual(parseSummary(baseline), {
    status: "pass",
    checkedDocs: 6,
    inlineSyntaxIssues: 0,
    missingPackageScripts: 0,
    packageScriptLimitIssues: 0,
    readIssues: 0,
    missingPowerShellExamples: 0,
    launchGate: "local-ops",
  });

  const root = mkdtempSync(join(tmpdir(), "lore-launch-docs-behavior-"));
  try {
    const cases = [
      {
        name: "missing-script.md",
        text: "`npm.cmd run definitely:missing:script`\n",
        expected: { inlineSyntaxIssues: 0, missingPackageScripts: 1, packageScriptLimitIssues: 0, readIssues: 0 },
      },
      {
        name: "inline-env.md",
        text: "FOO=bar npm run proof:launch-docs:summary\n",
        expected: { inlineSyntaxIssues: 1, missingPackageScripts: 0, packageScriptLimitIssues: 0, readIssues: 0 },
      },
      {
        name: "bare-shell-env.md",
        text: "```powershell\nFOO=bar\n```\n",
        expected: { inlineSyntaxIssues: 1, missingPackageScripts: 0, packageScriptLimitIssues: 0, readIssues: 0 },
      },
      {
        name: "too-many-scripts.md",
        text: `${Array.from({ length: 257 }, () => "npm.cmd run proof:launch-docs:summary").join("\n")}\n`,
        expected: { inlineSyntaxIssues: 0, missingPackageScripts: 0, packageScriptLimitIssues: 1, readIssues: 0 },
      },
      {
        name: "oversized.md",
        text: "x".repeat(1024 * 1024 + 1),
        expected: { inlineSyntaxIssues: 0, missingPackageScripts: 0, packageScriptLimitIssues: 0, readIssues: 1 },
      },
    ];

    for (const testCase of cases) {
      const filePath = join(root, testCase.name);
      writeFileSync(filePath, testCase.text, "utf8");
      const result = runVerifier(filePath);
      assert.equal(result.status, 1, `${testCase.name} must fail`);
      const summary = parseSummary(result);
      assert.equal(summary.status, "fail");
      assert.equal(summary.checkedDocs, 7);
      for (const [key, value] of Object.entries(testCase.expected)) assert.equal(summary[key], value, `${testCase.name} ${key}`);
      assert.ok(!result.stdout.toLowerCase().includes(root.toLowerCase()), "compact launch-doc output must not expose temp paths");
    }

    const directoryPath = join(root, "directory.md");
    mkdirSync(directoryPath);
    const directory = runVerifier(directoryPath);
    assert.equal(directory.status, 1);
    const directorySummary = parseSummary(directory);
    assert.equal(directorySummary.readIssues, 1);
    assert.equal(directorySummary.checkedDocs, 7);
    assert.ok(!directory.stdout.toLowerCase().includes(root.toLowerCase()));
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
  }
}
