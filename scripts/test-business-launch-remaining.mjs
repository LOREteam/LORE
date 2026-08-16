import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  createLaunchGatePolicyMaps,
  localLaunchArtifactExists,
  MAX_LIVE_CANARY_LOG_PATHS,
  readLaunchMarkdown,
} from "./launch-gate-policy.mjs";

const projectRoot = process.cwd();
const reporterPath = resolve(projectRoot, "scripts", "report-launch-remaining.mjs");
const verifierPath = resolve(projectRoot, "scripts", "check-launch-gates.mjs");
const baselineBoard = readFileSync(join(projectRoot, "docs", "mainnet-status-board.md"), "utf8");
const baselineProof = readFileSync(join(projectRoot, "docs", "mainnet-proof-record.md"), "utf8");

function runReporter(args = [], cwd = projectRoot) {
  return spawnSync(process.execPath, [reporterPath, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
}

function writeFixture(root, { board = baselineBoard, proof = baselineProof } = {}) {
  const boardPath = join(root, "board.md");
  const proofPath = join(root, "proof.md");
  writeFileSync(boardPath, board, "utf8");
  writeFileSync(proofPath, proof, "utf8");
  return { boardPath, proofPath };
}

function runFixture(paths, mode = "--json", cwd = projectRoot) {
  return runReporter([mode, `--board=${paths.boardPath}`, `--proof=${paths.proofPath}`], cwd);
}

function replaceGateStatus(markdown, id, status) {
  return markdown.replace(
    new RegExp(`^(\\| ${id} \\|[^\\r\\n]*\\|) (?:Missing|In Progress|Blocked|Complete) \\|$`, "m"),
    `$1 ${status} |`,
  );
}

function replaceGateEvidence(markdown, id, status, evidence) {
  return markdown.replace(
    new RegExp(`^\\| ${id} \\| ([^|]+) \\| [^|]+ \\|.*$`, "m"),
    (_line, name) => `| ${id} | ${name.trim()} | ${status} | ${evidence} |`,
  );
}

function runVerifier(cwd) {
  return spawnSync(process.execPath, [verifierPath, "--structure-only"], {
    cwd,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
}

function assertSafeFailure(result, root) {
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /(?:node:internal|at Module\.|at file:)/i);
  assert.ok(!result.stdout.toLowerCase().includes(root.toLowerCase()), "remaining summary must not expose temp paths");
}

export function runLaunchRemainingBehaviorTests() {
  const summary = runReporter(["--summary-only"]);
  assert.equal(summary.status, 0, `${summary.stdout}\n${summary.stderr}`);
  assert.equal(summary.stderr, "");
  assert.match(summary.stdout, /Complete gates: 0\/14/);
  assert.match(summary.stdout, /Remaining gate groups: canary=2, chain=1, env=1, host=2, indexer=1, monitoring=1, qa=3, restore=1, signoff=2/);
  assert.match(summary.stdout, /Next gate: G1 Final contract env and funds safety/);
  assert.match(summary.stdout, /Next marker tokens: contractenv, chain-id, deploy-block, token, finality, v10-protected-bets/);
  assert.match(summary.stdout, /G14 group=qa[\s\S]*final-security-scan,no-open-high-medium-local-findings/);
  assert.match(summary.stdout, /Autonomous boundary: local-hardening-only/);
  assert.match(summary.stdout, /Transaction boundary: fresh-preview-plus-explicit-consent/);
  assert.match(summary.stdout, /preview:canary:v10:authorization-ready:summary/);
  assert.match(summary.stdout, /No real bets, claims, resolver actions, approvals, nonce replacements, or soak starts without a fresh read-only Preview/);

  const jsonResult = runReporter(["--json"]);
  assert.equal(jsonResult.status, 0, `${jsonResult.stdout}\n${jsonResult.stderr}`);
  assert.equal(jsonResult.stderr, "");
  const parsed = JSON.parse(jsonResult.stdout);
  assert.deepEqual(parsed.completeGates, []);
  assert.deepEqual(parsed.remainingGates, Array.from({ length: 14 }, (_, index) => `G${index + 1}`));
  assert.equal(parsed.nextGateAction.statusCheck, "npm.cmd run proof:mainnet:strict:compact");
  assert.equal(parsed.nextGateAction.transactionBoundary, "fresh-preview-plus-explicit-consent");
  assert.equal(parsed.gateActions.length, 14);
  const g14 = parsed.gateActions.find((action) => action.id === "G14");
  assert.deepEqual(g14.proofFiles, ["docs/qa-proof.json"]);
  assert.equal(g14.statusCheck, "npm.cmd run proof:files:summary");
  assert.ok(g14.markerTokens.includes("final-security-scan"));
  assert.ok(g14.markerTokens.includes("no-open-high-medium-local-findings"));

  const root = mkdtempSync(join(tmpdir(), "lore-launch-remaining-behavior-"));
  try {
    const mismatchPaths = writeFixture(root, {
      proof: baselineProof.replace(/(\| G1 \|[^\r\n]*\|) Missing (\|)/, "$1 Complete $2"),
    });
    const mismatch = runFixture(mismatchPaths);
    assertSafeFailure(mismatch, root);
    const mismatchJson = JSON.parse(mismatch.stdout);
    assert.ok(mismatchJson.inconsistentGates.includes("G1"));

    const missingSecurityPaths = writeFixture(root, {
      board: baselineBoard.replaceAll("final security scan", "removed security marker"),
    });
    const missingSecurity = runFixture(missingSecurityPaths);
    assertSafeFailure(missingSecurity, root);
    const securityJson = JSON.parse(missingSecurity.stdout);
    assert.ok(securityJson.requiredProofIssues.some((issue) => issue.id === "G14" && issue.issue.includes("final security scan")));

    const wrongFirstCheckPaths = writeFixture(root, {
      board: baselineBoard.replace(
        "npm.cmd run proof:mainnet -- --strict --out=docs/mainnet-env-proof.log",
        "npm.cmd run proof:autonomous:summary",
      ),
    });
    const wrongFirstCheck = runFixture(wrongFirstCheckPaths);
    assertSafeFailure(wrongFirstCheck, root);
    const firstCheckJson = JSON.parse(wrongFirstCheck.stdout);
    assert.ok(firstCheckJson.firstCheckIssues.some((issue) => issue.id === "G1"));

    const oversizedBoardPath = join(root, "oversized.md");
    writeFileSync(oversizedBoardPath, "x".repeat(1024 * 1024 + 1), "utf8");
    const oversized = runFixture({ boardPath: oversizedBoardPath, proofPath: mismatchPaths.proofPath }, "--summary-only");
    assertSafeFailure(oversized, root);
    assert.match(oversized.stdout, /Input status: invalid/);

    const directoryPath = join(root, "directory.md");
    mkdirSync(directoryPath);
    const directory = runFixture({ boardPath: directoryPath, proofPath: mismatchPaths.proofPath });
    assertSafeFailure(directory, root);
    assert.deepEqual(JSON.parse(directory.stdout), { status: "fail", issue: "remaining-launch-input-invalid" });

    const artifactPath = join(root, "proof.json");
    writeFileSync(artifactPath, "{}", "utf8");
    assert.equal(localLaunchArtifactExists(root, "proof.json"), true);
    assert.equal(localLaunchArtifactExists(root, "directory.md"), false);
    assert.equal(localLaunchArtifactExists(root, "../outside.json"), false);
    assert.equal(localLaunchArtifactExists(root, "C:\\outside.json"), false);
    const boundedMarkdownPath = join(root, "bounded.md");
    writeFileSync(boundedMarkdownPath, baselineBoard, "utf8");
    assert.equal(readLaunchMarkdown(boundedMarkdownPath), baselineBoard);
    assert.throws(() => readLaunchMarkdown(oversizedBoardPath), /too large to validate safely/);
    assert.throws(() => readLaunchMarkdown(directoryPath), /not a regular file/);

    const verifierRoot = join(root, "verifier");
    const verifierDocs = join(verifierRoot, "docs");
    mkdirSync(verifierDocs, { recursive: true });
    writeFileSync(join(verifierDocs, "mainnet-status-board.md"), baselineBoard, "utf8");
    writeFileSync(join(verifierDocs, "mainnet-proof-record.md"), baselineProof, "utf8");
    const validVerifier = runVerifier(verifierRoot);
    assert.equal(validVerifier.status, 0, `${validVerifier.stdout}\n${validVerifier.stderr}`);
    assert.match(validVerifier.stdout, /Summary: launch gate table structure is consistent/);

    writeFileSync(join(verifierDocs, "mainnet-status-board.md"), "x".repeat(1024 * 1024 + 1), "utf8");
    const oversizedVerifier = runVerifier(verifierRoot);
    assert.equal(oversizedVerifier.status, 1);
    assert.match(`${oversizedVerifier.stdout}\n${oversizedVerifier.stderr}`, /too large to validate safely/);

    rmSync(join(verifierDocs, "mainnet-status-board.md"), { force: true });
    mkdirSync(join(verifierDocs, "mainnet-status-board.md"));
    const directoryVerifier = runVerifier(verifierRoot);
    assert.equal(directoryVerifier.status, 1);
    assert.match(`${directoryVerifier.stdout}\n${directoryVerifier.stderr}`, /not a regular file/);

    rmSync(join(verifierDocs, "mainnet-status-board.md"), { force: true, recursive: true });
    const canaryLogDir = join(verifierRoot, "data", "live-test-runs");
    mkdirSync(canaryLogDir, { recursive: true });
    const canaryPaths = Array.from(
      { length: MAX_LIVE_CANARY_LOG_PATHS + 4 },
      (_, index) => `data/live-test-runs/canary-${index}.jsonl`,
    );
    for (const relativePath of canaryPaths.slice(0, MAX_LIVE_CANARY_LOG_PATHS)) {
      writeFileSync(join(verifierRoot, relativePath), "{}\n", "utf8");
    }
    const unboundedPathMutant = (value) => [
      ...String(value).matchAll(/\bdata\/live-test-runs\/[^|\s`]+\.jsonl\b/gi),
    ].map((match) => match[0]);
    assert.equal(unboundedPathMutant(canaryPaths.join(" ")).length, MAX_LIVE_CANARY_LOG_PATHS + 4);
    assert.equal(
      unboundedPathMutant(canaryPaths.join(" ")).slice(MAX_LIVE_CANARY_LOG_PATHS)
        .every((relativePath) => !existsSync(join(verifierRoot, relativePath))),
      true,
      "overflow paths must kill unbounded launch-consumer extraction mutants",
    );
    writeFileSync(join(verifierDocs, "canary-proof.json"), "{}\n", "utf8");
    const { requiredProofMarkerExpectations, requiredProofFilesByGate } = createLaunchGatePolicyMaps();
    let boundedBoard = baselineBoard;
    let boundedProof = baselineProof;
    for (const id of ["G10", "G11"]) {
      boundedBoard = replaceGateStatus(boundedBoard, id, "Complete");
      const evidence = [
        ...(requiredProofFilesByGate.get(id) ?? []),
        ...(requiredProofMarkerExpectations.get(id) ?? []),
        ...canaryPaths,
      ].join(" ");
      boundedProof = replaceGateEvidence(boundedProof, id, "Complete", evidence);
    }
    writeFileSync(join(verifierDocs, "mainnet-status-board.md"), boundedBoard, "utf8");
    writeFileSync(join(verifierDocs, "mainnet-proof-record.md"), boundedProof, "utf8");

    const boundedVerifier = runVerifier(verifierRoot);
    assert.equal(boundedVerifier.status, 0, `${boundedVerifier.stdout}\n${boundedVerifier.stderr}`);
    assert.match(boundedVerifier.stdout, /Summary: launch gate table structure is consistent/);
    const boundedRemaining = runFixture(
      {
        boardPath: join(verifierDocs, "mainnet-status-board.md"),
        proofPath: join(verifierDocs, "mainnet-proof-record.md"),
      },
      "--json",
      verifierRoot,
    );
    assert.equal(boundedRemaining.status, 0, `${boundedRemaining.stdout}\n${boundedRemaining.stderr}`);
    const boundedRemainingJson = JSON.parse(boundedRemaining.stdout);
    assert.deepEqual(boundedRemainingJson.completeGates, ["G10", "G11"]);
    assert.equal(
      boundedRemainingJson.requiredProofIssues.some((issue) => issue.id === "G10" || issue.id === "G11"),
      false,
      "both launch-gate consumers must cap canary-log extraction before missing overflow paths",
    );
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
  }
}
