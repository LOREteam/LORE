import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = process.cwd();
const preflightPath = resolve(repositoryRoot, "scripts", "run-local-proof-preflight.mjs");
const expectedScripts = [
  "check-proof-templates.mjs",
  "check-proof-drafts.mjs",
  "check-proof-files.mjs",
  "check-process-model.mjs",
  "check-launch-gates.mjs",
  "check-launch-command-map.mjs",
  "check-launch-doc-command-syntax.mjs",
  "check-readiness-checklist.mjs",
  "check-proof-collector-redaction.mjs",
  "check-host-proof-load-target.mjs",
  "check-production-dependency-audit.mjs",
  "report-launch-remaining.mjs",
  "check-mainnet-proof-output.mjs",
  "check-security-followup.mjs",
  "run-launch-proof.mjs",
  "collect-mainnet-proof.mjs",
  "check-signoff-proof.mjs",
  "collect-chain-proof.mjs",
  "check-host-proof.mjs",
  "check-indexer-dry-run.mjs",
  "verify-db-restore.mjs",
  "check-monitoring-proof.mjs",
  "check-qa-proof.mjs",
  "analyze-live-canary-proof.mjs",
];

const stubSource = String.raw`
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

const name = basename(process.argv[1]);
const args = process.argv.slice(2);
const finish = (output, status = 0) => {
  console.log(output);
  process.exit(status);
};

if (name === "check-proof-templates.mjs") finish("Summary: all proof templates are rejected by strict validators.");
if (name === "check-proof-drafts.mjs") finish("Summary: all proof drafts are rejected by strict validators.");
if (name === "check-proof-files.mjs") {
  const canaryArg = args.find((entry) => entry.startsWith("--canary-log="));
  if (canaryArg) {
    const canaryPath = canaryArg.slice("--canary-log=".length);
    if (existsSync(canaryPath) && !statSync(canaryPath).isFile()) finish("canary log is not a file", 1);
    if (!/\.jsonl$/i.test(canaryPath)) finish("canary log must be a .jsonl file", 1);
    const text = readFileSync(canaryPath, "utf8");
    if (text.length === 0) finish("canary log is empty", 1);
    const first = text.split(/\r?\n/).find((line) => line.trim());
    if (!first) finish("canary log has no non-empty JSONL lines", 1);
    let record;
    try { record = JSON.parse(first); } catch { finish("canary log first non-empty line is not valid JSON", 1); }
    if (!record || typeof record !== "object" || Array.isArray(record)) finish("canary log first JSONL record must be an object", 1);
    if (JSON.stringify(record).includes("TODO")) finish("canary log first JSONL record has template-like values", 1);
    if (typeof record.rpcUrl === "string") finish("canary log first JSONL record has secret-like values", 1);
    if (typeof record.diagnostic === "string" && /https?:\/\//i.test(record.diagnostic)) finish("canary log first JSONL record has unsafe diagnostic values", 1);
    finish("Summary: proof manifest files are clean or not yet collected.");
  }
  const unexpected = resolve(process.cwd(), "docs", "unexpected-proof-regression.json");
  if (existsSync(unexpected)) finish("unexpected proof-like JSON file docs/unexpected-proof-regression.json", 1);
  const snapshot = resolve(process.cwd(), "docs", "chain-proof-snapshot.json");
  if (existsSync(snapshot)) {
    const text = readFileSync(snapshot, "utf8");
    if (text.includes("TODO")) finish("chain-proof-snapshot.json: template-like values", 1);
    if (text.includes("rpcUrl")) finish("chain-proof-snapshot.json: secret-like values", 1);
  }
  finish("Summary: proof manifest files are clean or not yet collected.");
}
if (name === "check-process-model.mjs") finish("Summary: process model preflight completed without detected issues.");
if (name === "check-launch-gates.mjs") finish("Summary: launch gate table structure is consistent.");
if (name === "check-launch-command-map.mjs") finish("Summary: launch evidence command map is consistent.");
if (name === "check-launch-doc-command-syntax.mjs") finish("Summary: launch docs commands are PowerShell-safe and reference existing package scripts.\nSummary: launch docs command syntax is PowerShell-safe.");
if (name === "check-readiness-checklist.mjs") finish("Summary: readiness checklist structure is consistent.");
if (name === "check-proof-collector-redaction.mjs") finish("Summary: proof collector redaction guard passed.");
if (name === "check-host-proof-load-target.mjs") finish("Summary: host proof load target guard passed.");
if (name === "check-production-dependency-audit.mjs") {
  finish(args.includes("--include-dev")
    ? "Summary: all dependency audit passed with 9 known dev-toolchain high advisory exception(s), 0 blocking high/critical advisories,"
    : "Summary: production dependency audit passed with no high or critical advisories.");
}
if (name === "report-launch-remaining.mjs") {
  if (args.includes("--json")) finish(JSON.stringify({
    inconsistentGates: [], completeGateEvidenceIssues: [], requiredProofIssues: [], proofRecordReferenceIssues: [], firstCheckIssues: [],
  }, null, 2));
  finish("| inconsistent gate rows | none |\n| complete gate evidence issues | none |\n| required proof issues | none |\n| proof record reference issues | none |\n| first check issues | none |\n| Next Gate | First check | Required proof |\nSummary: no remaining launch evidence rows.");
}
if (name === "check-mainnet-proof-output.mjs") finish("Summary: mainnet proof strict-fail output guard passed.");
if (name === "check-security-followup.mjs") {
  if (process.env.LOCAL_PROOF_STUB_HOSTILE_SECURITY === "1") {
    finish(JSON.stringify({
      status: "<script>PASS</script>", checks: -1, passed: 9007199254740992, failed: "many",
      failedIds: ["../../secret", "OK", "x".repeat(80)], appResolveEpochFiles: -2,
    }));
  }
  if (args.includes("--summary-only")) finish(JSON.stringify({
    status: "pass", checks: 8, passed: 8, failed: 0, failedIds: [], appResolveEpochFiles: 0,
  }));
  finish(JSON.stringify({
    status: "pass",
    checks: ["host-auth", "web-locks", "keeper-nonce", "deposit-limiter", "dry-run-defaults", "ci-security", "auto-resolve", "extra"].map((id) => ({ id, status: "pass" })),
    appResolveEpochFiles: [],
  }));
}
if (name === "run-launch-proof.mjs") {
  if (args.includes("--summary-only")) finish("Summary: 25 issue(s): missing --canary-log or PROOF_CANARY_LOG; groups: launch=1.", 1);
  finish("Incomplete gates: G1, G2\nOverall: 2 launch proof check(s) failed or missing", 1);
}
if ([
  "collect-mainnet-proof.mjs", "check-signoff-proof.mjs", "collect-chain-proof.mjs",
  "check-host-proof.mjs", "check-indexer-dry-run.mjs", "verify-db-restore.mjs",
  "check-monitoring-proof.mjs", "check-qa-proof.mjs", "analyze-live-canary-proof.mjs",
].includes(name)) finish("Summary: completed without detected issues.");
finish("unexpected stub invocation", 97);
`;

function createFixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "lore-local-proof-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  for (const script of expectedScripts) {
    writeFileSync(join(root, "scripts", script), stubSource, "utf8");
  }
  return root;
}

function runPreflight(root, { summaryOnly = false, hostileSecurity = false } = {}) {
  const result = spawnSync(process.execPath, [preflightPath, ...(summaryOnly ? ["--summary-only"] : [])], {
    cwd: root,
    env: {
      ...process.env,
      NODE_OPTIONS: "",
      LOCAL_PROOF_STUB_HOSTILE_SECURITY: hostileSecurity ? "1" : "0",
    },
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  assert.equal(result.error, undefined, `local proof preflight failed to execute: ${result.error?.message ?? "unknown error"}`);
  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");
  assert.doesNotMatch(`${stdout}\n${stderr}`, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  return { status: result.status, stdout, stderr };
}

function assertedRows(stdout) {
  return stdout.split(/\r?\n/)
    .map((line) => /^\| (L\d+) \|/.exec(line)?.[1])
    .filter(Boolean);
}

export function runLocalProofPreflightBehaviorTests() {
  const root = createFixtureRoot();
  try {
    const summary = runPreflight(root, { summaryOnly: true });
    assert.equal(summary.status, 0, summary.stderr || summary.stdout);
    assert.equal(summary.stderr, "");
    assert.match(summary.stdout, /^# Local Launch Proof Preflight Summary/m);
    assert.match(summary.stdout, /^Regression artifact writes: false$/m);
    assert.deepEqual(assertedRows(summary.stdout), Array.from({ length: 17 }, (_, index) => `L${index + 1}`));
    assert.match(summary.stdout, /\| L16 \| security follow-up \| pass \| 0 \| status=pass, checks=8, passed=8, failed=0, failedIds=none, appResolveEpochFiles=0 \|/);
    assert.match(summary.stdout, /\| L17 \| strict launch expected fail \| pass \| 1 \| expected fail: Summary: 25 issue\(s\): missing --canary-log or PROOF_CANARY_LOG; groups: launch=1\. \|/);
    assert.match(summary.stdout, /Summary: local launch proof preflight passed\./);
    assert.equal(existsSync(join(root, ".tmp")), false, "summary mode must not create regression artifacts");
    assert.deepEqual(rmSafeEntries(join(root, "docs")), [], "summary mode must not write proof fixtures");

    const full = runPreflight(root);
    assert.equal(full.status, 0, full.stderr || full.stdout);
    assert.equal(full.stderr, "");
    assert.deepEqual(assertedRows(full.stdout), Array.from({ length: 17 }, (_, index) => `L${index + 1}`));
    assert.match(full.stdout, /\| L3 \| proof file guard \| pass \| 0 \| Summary: proof manifest files are clean or not yet collected\. \|/);
    assert.match(full.stdout, /\| L16 \| security follow-up \| pass \| 0 \| status=pass, checks=8, passed=8, failed=0, failedIds=none \|/);
    assert.match(full.stdout, /\| L17 \| strict launch expected fail \| pass \| 1 \| expected fail: Overall: 2 launch proof check\(s\) failed or missing \|/);
    assert.equal(existsSync(join(root, "docs", "chain-proof-snapshot.json")), false);
    assert.equal(existsSync(join(root, "docs", "unexpected-proof-regression.json")), false);
    assert.deepEqual(rmSafeEntries(join(root, ".tmp")), [], "full regression fixtures must be cleaned");

    const hostile = runPreflight(root, { summaryOnly: true, hostileSecurity: true });
    assert.equal(hostile.status, 1, "hostile compact security output must fail the expected clean pattern");
    assert.match(hostile.stdout, /status=unknown, checks=0, passed=0, failed=0, failedIds=secret,OK, appResolveEpochFiles=0/);
    assert.doesNotMatch(hostile.stdout, /<script>|\.\.\/|9007199254740992|x{49}/i);

    rmSync(join(root, "scripts", "check-process-model.mjs"), { force: true });
    mkdirSync(join(root, "scripts", "check-process-model.mjs"));
    const directoryScript = runPreflight(root, { summaryOnly: true });
    assert.equal(directoryScript.status, 1, "a directory must not be accepted as a runnable check script");
    assert.match(directoryScript.stdout, /\| L4 \| process model \| fail \| n\/a \| missing or non-file script scripts\/check-process-model\.mjs \|/);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
    assert.equal(existsSync(root), false, "local proof preflight fixture root must be removed");
  }
}

function runLaunchProof(root, args = []) {
  const result = spawnSync(process.execPath, [resolve(root, "scripts", "run-launch-proof.mjs"), ...args], {
    cwd: root,
    env: { ...process.env, NODE_OPTIONS: "", PROOF_STRICT: "", PROOF_CANARY_LOG: "" },
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  assert.equal(result.error, undefined, `launch proof runner failed to execute: ${result.error?.message ?? "unknown error"}`);
  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");
  assert.doesNotMatch(`${stdout}\n${stderr}`, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  return { status: result.status, stdout, stderr };
}

export function runLaunchProofRunnerBehaviorTests() {
  const summaryRoot = mkdtempSync(join(tmpdir(), "lore-launch-summary-"));
  try {
    mkdirSync(join(summaryRoot, "scripts"), { recursive: true });
    writeFileSync(join(summaryRoot, "scripts", "run-launch-proof.mjs"), readSelf("run-launch-proof.mjs"), "utf8");
    const ordinary = runLaunchProof(summaryRoot, ["--summary-only"]);
    assert.equal(ordinary.status, 0, ordinary.stderr || ordinary.stdout);
    assert.match(ordinary.stdout, /Strict: no[\s\S]*Canary log: missing[\s\S]*Would run child checks: false/);
    assert.match(ordinary.stdout, /Summary: 2 issue\(s\): proof:launch requires --strict or PROOF_STRICT=1; missing --canary-log or PROOF_CANARY_LOG; groups: launch=1\./);
    assert.doesNotMatch(ordinary.stdout, /missing or non-file script/, "summary mode must exit before child-script inspection");

    const strictMissing = runLaunchProof(summaryRoot, ["--strict", "--summary-only"]);
    assert.equal(strictMissing.status, 1);
    assert.match(strictMissing.stdout, /Summary: 1 issue\(s\): missing --canary-log or PROOF_CANARY_LOG; groups: launch=1\./);

    const sensitiveCanary = "C:\\private\\wallet\\live-canary.jsonl";
    const strictReady = runLaunchProof(summaryRoot, ["--strict", "--summary-only", `--canary-log=${sensitiveCanary}`]);
    assert.equal(strictReady.status, 0, strictReady.stderr || strictReady.stdout);
    assert.match(strictReady.stdout, /Strict: yes[\s\S]*Canary log: present[\s\S]*Would run child checks: false/);
    assert.match(strictReady.stdout, /Summary: launch proof status inputs are ready; groups: launch=1\./);
    assert.doesNotMatch(strictReady.stdout, /private|wallet|live-canary\.jsonl/i, "compact launch status must not print the canary path");
  } finally {
    rmSync(summaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
  }

  const fullRoot = createFixtureRoot();
  try {
    writeFileSync(join(fullRoot, "scripts", "run-launch-proof.mjs"), readSelf("run-launch-proof.mjs"), "utf8");
    writeFileSync(join(fullRoot, "canary.jsonl"), `${JSON.stringify({ status: "ok" })}\n`, "utf8");
    const full = runLaunchProof(fullRoot, ["--strict", "--canary-log=canary.jsonl"]);
    assert.equal(full.status, 0, full.stderr || full.stdout);
    assert.match(full.stdout, /\| LOCAL \| full dependency\/toolchain audit \| pass \| 0 \| Summary: all dependency audit passed with 9 known dev-toolchain high advisory exception\(s\), 0 blocking high\/critical advisories, \|/);
    assert.match(full.stdout, /\| G10\/G11 \| real-epoch canary and tx recovery \| pass \| 0 \| Summary: completed without detected issues\. \|/);
    assert.match(full.stdout, /Overall: all launch proof checks passed\./);

    rmSync(join(fullRoot, "scripts", "check-proof-templates.mjs"), { force: true });
    mkdirSync(join(fullRoot, "scripts", "check-proof-templates.mjs"));
    const directoryScript = runLaunchProof(fullRoot, ["--strict", "--canary-log=canary.jsonl"]);
    assert.equal(directoryScript.status, 1);
    assert.match(directoryScript.stdout, /\| LOCAL \| template guard \| fail \| n\/a \| missing or non-file script scripts\/check-proof-templates\.mjs \|/);
  } finally {
    rmSync(fullRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
  }
}

function readSelf(name) {
  return readFileSync(resolve(repositoryRoot, "scripts", name), "utf8");
}

function rmSafeEntries(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path).sort();
}
