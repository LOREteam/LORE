import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = process.cwd();
const guardPath = join(projectRoot, "scripts", "check-proof-templates.mjs");
const baselineTemplate = readFileSync(join(projectRoot, "docs", "launch-proof-manifest-templates.md"), "utf8");

function runGuard(templatePath) {
  return spawnSync(process.execPath, [guardPath, "--summary-only", `--template-doc=${templatePath}`], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
}

function assertSummary(result, root, expectedStatus, expectedCounters) {
  const combined = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, expectedStatus === "pass" ? 0 : 1, combined);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, new RegExp(`^status=${expectedStatus}, ${expectedCounters}$`, "m"));
  assert.doesNotMatch(combined, /(?:Error:|node:internal|at Module\.|at file:)/i);
  assert.ok(!combined.toLowerCase().includes(root.toLowerCase()), "compact template output must not expose the fixture path");
}

export function runProofTemplateBehaviorTests() {
  const root = mkdtempSync(join(tmpdir(), "lore-proof-template-behavior-"));
  try {
    const baselinePath = join(root, "baseline.md");
    writeFileSync(baselinePath, baselineTemplate, "utf8");
    const baseline = runGuard(baselinePath);
    assertSummary(baseline, root, "pass", "templates=7, rejected=7, issues=0");
    assert.match(baseline.stdout, /Summary: all proof templates are rejected by strict validators\./);

    const mutations = [
      ["missing.md", null],
      ["oversized.md", `${baselineTemplate}\n${"x".repeat(512 * 1024)}\n`],
      ["missing-block.md", baselineTemplate.replace("## `docs/signoff-proof.json`", "## `docs/signoff-proof-omitted.json`")],
      ["invalid-json.md", baselineTemplate.replace('"network": "mainnet"', '"network": invalid-json')],
    ];
    for (const [name, contents] of mutations) {
      const path = join(root, name);
      if (contents !== null) writeFileSync(path, contents, "utf8");
      const result = runGuard(path);
      assertSummary(result, root, "fail", "templates=0, rejected=0, issues=1");
      assert.match(result.stdout, /Summary: 1 proof template issue\(s\)\./);
    }

    const directoryPath = join(root, "template-directory");
    mkdirSync(directoryPath);
    const directory = runGuard(directoryPath);
    assertSummary(directory, root, "fail", "templates=0, rejected=0, issues=1");
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
  }
}
