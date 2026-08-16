import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = process.cwd();
const guardPath = join(projectRoot, "scripts", "check-process-model.mjs");
const baselinePackage = readFileSync(join(projectRoot, "package.json"), "utf8");
const baselineEcosystem = readFileSync(join(projectRoot, "ecosystem.config.cjs"), "utf8");

function runGuard(root) {
  return spawnSync(process.execPath, [guardPath, "--strict", "--summary-only"], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
}

function createFixture(suiteRoot, name, { packageContents = baselinePackage, ecosystemContents = baselineEcosystem } = {}) {
  const root = join(suiteRoot, name);
  mkdirSync(root);
  if (packageContents === "directory") mkdirSync(join(root, "package.json"));
  else if (packageContents !== null) writeFileSync(join(root, "package.json"), packageContents, "utf8");
  if (ecosystemContents !== null) writeFileSync(join(root, "ecosystem.config.cjs"), ecosystemContents, "utf8");
  return root;
}

function assertBounded(result, root, expectedStatus) {
  const combined = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, expectedStatus, combined);
  assert.equal(result.stderr, "");
  assert.doesNotMatch(combined, /(?:Error:|node:internal|at Module\.|at file:)/i);
  assert.ok(!combined.toLowerCase().includes(root.toLowerCase()), "compact process-model output must not expose the fixture path");
  assert.doesNotMatch(combined, /process-model-secret/);
}

export function runProcessModelBehaviorTests() {
  const suiteRoot = mkdtempSync(join(tmpdir(), "lore-process-model-"));
  try {
    const baselineRoot = createFixture(suiteRoot, "baseline");
    const baseline = runGuard(baselineRoot);
    assertBounded(baseline, baselineRoot, 0);
    assert.match(baseline.stdout, /Config: present/);
    assert.match(baseline.stdout, /Summary: process model preflight completed without detected issues\./);
    assert.equal((baseline.stdout.match(/\| lore-/g) ?? []).length, 6);

    const cases = [
      ["missing-config", { ecosystemContents: null }, /ecosystem\.config\.cjs is missing/],
      ["loader-error", { ecosystemContents: 'throw new Error("process-model-secret")\n' }, /ecosystem\.config\.cjs could not be loaded/],
      ["missing-package", { packageContents: null }, /package script "start" is missing/],
      ["directory-package", { packageContents: "directory" }, /package script "start" is missing/],
      ["oversized-package", { packageContents: `${baselinePackage}\n${"x".repeat(512 * 1024)}\n` }, /package script "start" is missing/],
      ["malformed-package", { packageContents: "{ invalid-json" }, /package script "start" is missing/],
      ["wrong-runtime-script", { ecosystemContents: baselineEcosystem.replace('script: "npm"', 'script: "node"') }, /lore-site: script must be npm/],
      ["extra-lore-app", { ecosystemContents: baselineEcosystem.replace("apps: [", 'apps: [{ name: "lore-extra" },') }, /unexpected lore PM2 apps: lore-extra/],
    ];

    for (const [name, fixture, expected] of cases) {
      const root = createFixture(suiteRoot, name, fixture);
      const result = runGuard(root);
      assertBounded(result, root, 1);
      assert.match(result.stdout, expected, name);
    }
  } finally {
    rmSync(suiteRoot, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
  }
}
