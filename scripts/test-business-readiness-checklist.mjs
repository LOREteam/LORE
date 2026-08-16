import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = process.cwd();
const verifierPath = join(projectRoot, "scripts", "check-readiness-checklist.mjs");
const baselineChecklist = readFileSync(join(projectRoot, "docs", "mainnet-readiness-checklist.md"), "utf8");

function replaceRequired(source, expected, replacement) {
  assert.ok(source.includes(expected), `fixture must contain ${expected}`);
  return source.replace(expected, replacement);
}

function writeLocalFile(root, relativePath, contents = "evidence\n") {
  const target = join(root, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents, "utf8");
}

function runVerifier(root, checklistArgument = "docs/mainnet-readiness-checklist.md") {
  return spawnSync(
    process.execPath,
    [verifierPath, "--summary-only", `--checklist=${checklistArgument}`],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
  );
}

function assertBoundedSummary(result, root, expectedStatus) {
  const combined = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, expectedStatus === "pass" ? 0 : 1, combined);
  assert.match(result.stdout, new RegExp(`^status=${expectedStatus}, checks=4, checkedItems=\\d+, evidenceIssues=\\d+, issues=\\d+`, "m"));
  assert.doesNotMatch(combined, /(?:Error:|at file:|at Module\.|node:internal)/i);
  assert.doesNotMatch(combined, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert.equal(result.stderr, "");
}

export function runReadinessChecklistBehaviorTests() {
  const suiteRoot = mkdtempSync(join(tmpdir(), "lore-readiness-checklist-"));
  try {
    const createCase = (name, checklist = baselineChecklist) => {
      const root = join(suiteRoot, name);
      writeLocalFile(root, "docs/mainnet-readiness-checklist.md", checklist);
      return root;
    };

    const baselineRoot = createCase("baseline");
    const baseline = runVerifier(baselineRoot);
    assertBoundedSummary(baseline, baselineRoot, "pass");
    assert.match(baseline.stdout, /checkedItems=0, evidenceIssues=0, issues=0/);
    assert.match(baseline.stdout, /Summary: readiness checklist structure is consistent\./);

    const existingEvidenceRoot = createCase(
      "existing-evidence",
      `${baselineChecklist}\n- [x] Local proof: docs/evidence.txt\n`,
    );
    writeLocalFile(existingEvidenceRoot, "docs/evidence.txt");
    const existingEvidence = runVerifier(existingEvidenceRoot);
    assertBoundedSummary(existingEvidence, existingEvidenceRoot, "pass");
    assert.match(existingEvidence.stdout, /checkedItems=1, evidenceIssues=0, issues=0/);

    const mutationCases = [
      {
        name: "missing-section",
        checklist: replaceRequired(baselineChecklist, "### 1. Contract / funds safety", "### Contract safety omitted"),
        expected: /checkedItems=0, evidenceIssues=0, issues=1/,
      },
      {
        name: "missing-final-security",
        checklist: replaceRequired(baselineChecklist, "Final security scan evidence", "Final review evidence"),
        expected: /checkedItems=0, evidenceIssues=0, issues=1/,
      },
      {
        name: "missing-proof-file",
        checklist: replaceRequired(baselineChecklist, "docs/signoff-proof.json", "docs/signoff-proof-omitted.json"),
        expected: /checkedItems=0, evidenceIssues=0, issues=1/,
      },
      {
        name: "checked-without-evidence",
        checklist: `${baselineChecklist}\n- [x] Reviewed from memory.\n`,
        expected: /checkedItems=1, evidenceIssues=1, issues=1/,
      },
      {
        name: "missing-local-evidence",
        checklist: `${baselineChecklist}\n- [x] Local proof: docs/missing-evidence.txt\n`,
        expected: /checkedItems=1, evidenceIssues=1, issues=1/,
      },
    ];

    for (const mutation of mutationCases) {
      const root = createCase(mutation.name, mutation.checklist);
      const result = runVerifier(root);
      assertBoundedSummary(result, root, "fail");
      assert.match(result.stdout, mutation.expected, mutation.name);
    }

    const directoryEvidenceRoot = createCase(
      "directory-evidence",
      `${baselineChecklist}\n- [x] Local proof: docs/evidence-directory\n`,
    );
    mkdirSync(join(directoryEvidenceRoot, "docs", "evidence-directory"), { recursive: true });
    const directoryEvidence = runVerifier(directoryEvidenceRoot);
    assertBoundedSummary(directoryEvidence, directoryEvidenceRoot, "fail");
    assert.match(directoryEvidence.stdout, /checkedItems=1, evidenceIssues=1, issues=1/);

    const outsideEvidenceName = "outside-proof.txt";
    writeLocalFile(suiteRoot, outsideEvidenceName);
    const outsideEvidenceRoot = createCase(
      "outside-evidence",
      `${baselineChecklist}\n- [x] Local proof: docs/../../${outsideEvidenceName}\n`,
    );
    const outsideEvidence = runVerifier(outsideEvidenceRoot);
    assertBoundedSummary(outsideEvidence, outsideEvidenceRoot, "fail");
    assert.match(outsideEvidence.stdout, /checkedItems=1, evidenceIssues=1, issues=1/);

    const boundedPaths = Array.from({ length: 64 }, (_, index) => `docs/evidence-${index}.txt`);
    const tooManyPaths = [...boundedPaths, "docs/evidence-over-limit.txt"];
    const tooManyRoot = createCase(
      "too-many-evidence-paths",
      `${baselineChecklist}\n- [x] Local proof: ${tooManyPaths.join(" ")}\n`,
    );
    for (const evidencePath of boundedPaths) writeLocalFile(tooManyRoot, evidencePath);
    const tooMany = runVerifier(tooManyRoot);
    assertBoundedSummary(tooMany, tooManyRoot, "fail");
    assert.match(tooMany.stdout, /checkedItems=1, evidenceIssues=1, issues=1/);

    const oversizedRoot = createCase(
      "oversized-checklist",
      `${baselineChecklist}\n${"x".repeat(1024 * 1024)}\n`,
    );
    const oversized = runVerifier(oversizedRoot);
    assertBoundedSummary(oversized, oversizedRoot, "fail");
    assert.match(oversized.stdout, /checkedItems=0, evidenceIssues=0/);

    const directoryChecklistRoot = createCase("directory-checklist");
    const directoryChecklist = runVerifier(directoryChecklistRoot, "docs");
    assertBoundedSummary(directoryChecklist, directoryChecklistRoot, "fail");
    assert.match(directoryChecklist.stdout, /checkedItems=0, evidenceIssues=0/);
  } finally {
    rmSync(suiteRoot, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
  }
}
