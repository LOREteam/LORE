import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = process.cwd();
const proofFileGuardPath = resolve(repositoryRoot, "scripts", "check-proof-files.mjs");

function proofFileChildEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => {
      const normalized = name.toUpperCase();
      return normalized !== "NODE_OPTIONS" && normalized !== "PROOF_CANARY_LOG";
    }),
  );
}

function runProofFileGuard(root, ...args) {
  const result = spawnSync(process.execPath, [proofFileGuardPath, ...args], {
    cwd: root,
    env: proofFileChildEnv(),
    encoding: "utf8",
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");
  assert.equal(result.error, undefined, `proof file guard failed to execute: ${result.error?.message ?? "unknown error"}`);
  assert.doesNotMatch(
    `${stdout}\n${stderr}`,
    new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
    "proof file guard output must not disclose the temporary fixture root",
  );
  return { status: result.status, stdout, stderr };
}

function withFixtureRoot(run) {
  const root = mkdtempSync(join(tmpdir(), "lore-proof-file-"));
  try {
    mkdirSync(join(root, "docs"), { recursive: true });
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
    assert.equal(existsSync(root), false, "proof file behavior fixtures must be removed");
  }
}

function assertRejected(result, pattern, label) {
  assert.equal(result.status, 1, `${label} must fail closed`);
  assert.equal(result.stderr, "", `${label} must not write unbounded diagnostics to stderr`);
  assert.match(result.stdout, pattern, `${label} must report the bounded rejection reason`);
}

export function runProofFileBehaviorTests() {
  withFixtureRoot((root) => {
    const result = runProofFileGuard(root, "--summary-only");
    assert.equal(result.status, 0, "an empty proof directory must remain a valid not-yet-collected state");
    assert.match(result.stdout, /status=pass, manifests=7, issues=0, strict=false, canaryLog=missing/);
    assert.equal(result.stderr, "");
  });

  withFixtureRoot((root) => {
    const canaryPath = join(root, "evidence.jsonl");
    writeFileSync(
      canaryPath,
      `\uFEFF${JSON.stringify({ status: "ok", diagnostic: "redacted" })}\n${"not-json\n".repeat(150_000)}`,
      "utf8",
    );
    const result = runProofFileGuard(root, "--canary-log=evidence.jsonl");
    assert.equal(result.status, 1, "a valid canary row still requires every final manifest");
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /\| Manifest \| Status \| Template Values \| Secret-like Values \| Unsafe Diagnostics \| Strict Validator \| Summary \|/);
    assert.match(result.stdout, /\| canary-log \| present \| no \| no \| no \| n\/a \| clean \|/);
    assert.doesNotMatch(result.stdout, /not-json/, "only the first JSONL record may be inspected");
  });

  withFixtureRoot((root) => {
    writeFileSync(join(root, "evidence.jsonl"), Buffer.alloc(1024 * 1024 + 64, 0x61));
    assertRejected(
      runProofFileGuard(root, "--canary-log=evidence.jsonl"),
      /first non-empty JSONL line was not found within 1048576 bytes/,
      "an overlong first canary record",
    );
  });

  withFixtureRoot((root) => {
    writeFileSync(
      join(root, "evidence.jsonl"),
      `${JSON.stringify({ status: "failed", error: "https://private.example/rpc" })}\n`,
      "utf8",
    );
    const result = runProofFileGuard(root, "--canary-log=evidence.jsonl");
    assertRejected(result, /canary log first JSONL record has unsafe diagnostic values at \$\.error: evidence\.jsonl/, "unsafe canary diagnostics");
    assert.match(result.stdout, /\| canary-log \| issue \| no \| no \| yes \| n\/a \| unsafe diagnostic values \|/);
    assert.doesNotMatch(result.stdout, /private\.example/, "raw unsafe diagnostic values must remain redacted");
  });

  withFixtureRoot((root) => {
    mkdirSync(join(root, "docs", "chain-proof-snapshot.json"));
    assertRejected(runProofFileGuard(root), /chain-proof-snapshot\.json: not a file/, "an auxiliary proof directory");
  });

  withFixtureRoot((root) => {
    writeFileSync(join(root, "docs", "testnet-canary-proof.json"), Buffer.alloc(512 * 1024 + 1, 0x20));
    assertRejected(
      runProofFileGuard(root),
      /testnet-canary-proof\.json: proof JSON file is too large to validate safely/,
      "an oversized auxiliary proof",
    );
  });

  withFixtureRoot((root) => {
    mkdirSync(join(root, "docs", "signoff-proof.json"));
    assertRejected(runProofFileGuard(root), /signoff-proof\.json: not a file/, "a final proof directory");
  });

  withFixtureRoot((root) => {
    writeFileSync(join(root, "docs", "host-proof.json"), Buffer.alloc(512 * 1024 + 1, 0x20));
    assertRejected(
      runProofFileGuard(root),
      /host-proof\.json: proof JSON file is too large to validate safely/,
      "an oversized final proof",
    );
  });
}
