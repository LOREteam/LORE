import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT_PATH = resolve("scripts/check-launch-command-map.mjs");
const FIXTURE_FILES = [
  "package.json",
  "docs/launch-evidence-command-map.md",
  "docs/mainnet-readiness-checklist.md",
  "docs/mainnet-status-board.md",
  "docs/production-runbook.md",
];

function writeFixture(root, transforms = {}) {
  for (const relativePath of FIXTURE_FILES) {
    const target = join(root, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    const source = readFileSync(relativePath, "utf8");
    writeFileSync(target, transforms[relativePath]?.(source) ?? source, "utf8");
  }
}

function runFixture(root) {
  return spawnSync(process.execPath, [SCRIPT_PATH, "--summary-only"], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 256 * 1024,
    env: {
      ...process.env,
      NO_UPDATE_NOTIFIER: "1",
      npm_config_update_notifier: "false",
      npm_config_fund: "false",
    },
  });
}

function withFixture(transforms, callback) {
  const root = mkdtempSync(join(tmpdir(), "lore-launch-map-behavior-"));
  try {
    writeFixture(root, transforms);
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function assertFailedMutation(label, transforms, expectedIssueCount = null) {
  withFixture(transforms, (root) => {
    const result = runFixture(root);
    assert.equal(result.status, 1, `${label} must fail`);
    assert.equal(result.stderr, "", `${label} must not emit a raw stack`);
    assert.match(result.stdout, /^status=fail, scripts=33, linkedDocs=3, proofFiles=7, issues=[1-9]\d*$/m);
    assert.match(result.stdout, /^Summary: [1-9]\d* launch command map issue\(s\)\.$/m);
    assert.doesNotMatch(result.stdout, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    if (expectedIssueCount !== null) {
      assert.match(result.stdout, new RegExp(`issues=${expectedIssueCount}(?:\\r?\\n|$)`));
    }
  });
}

export function runLaunchCommandMapBehaviorTests() {
  withFixture({}, (root) => {
    const result = runFixture(root);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.equal(
      result.stdout,
      "status=pass, scripts=33, linkedDocs=3, proofFiles=7, issues=0\nSummary: launch evidence command map is consistent.\n",
    );
    assert.doesNotMatch(result.stdout, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  });

  assertFailedMutation("missing package script", {
    "package.json": (source) => {
      const pkg = JSON.parse(source);
      delete pkg.scripts["proof:chain"];
      return JSON.stringify(pkg);
    },
  }, 1);
  assertFailedMutation("write-capable compact command mutation", {
    "package.json": (source) => {
      const pkg = JSON.parse(source);
      pkg.scripts["proof:chain:summary"] = "node scripts/collect-chain-proof.mjs --execute-live --summary-only";
      return JSON.stringify(pkg);
    },
  }, 1);
  assertFailedMutation("missing exact-only compact command", {
    "package.json": (source) => {
      const pkg = JSON.parse(source);
      delete pkg.scripts["proof:mainnet:strict:compact"];
      return JSON.stringify(pkg);
    },
  }, 1);
  assertFailedMutation("missing strict command", {
    "docs/launch-evidence-command-map.md": (source) => source.replaceAll("proof:chain -- --strict", "proof:chain --"),
  });
  for (const marker of [
    "ownership.directOwnerReadEvidence",
    "verified email alert target",
    "fresh Codex Security scan report or sealed scan artifact",
    "redacted production Privy App ID configured proof",
    "lastSuccessfulBackupAt",
    "externalRateLimit",
    "fresh external DB",
  ]) {
    assertFailedMutation(`missing marker ${marker}`, {
      "docs/launch-evidence-command-map.md": (source) => source.replaceAll(marker, "__removed_evidence_marker__"),
    });
  }
  assertFailedMutation("oversized command map", {
    "docs/launch-evidence-command-map.md": (source) => `${source}\n${"x".repeat(1024 * 1024)}`,
  });

  const directoryRoot = mkdtempSync(join(tmpdir(), "lore-launch-map-directory-"));
  try {
    writeFixture(directoryRoot);
    rmSync(join(directoryRoot, "package.json"), { force: true });
    mkdirSync(join(directoryRoot, "package.json"));
    const result = runFixture(directoryRoot);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    assert.equal(
      result.stdout,
      "status=fail, scripts=33, linkedDocs=3, proofFiles=7, issues=1\nSummary: 1 launch command map issue(s).\n",
    );
    assert.doesNotMatch(result.stdout, /node:internal|at file:|directoryRoot/i);
  } finally {
    rmSync(directoryRoot, { recursive: true, force: true });
  }
}
