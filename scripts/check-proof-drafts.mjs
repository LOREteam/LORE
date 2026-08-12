import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { redactProofText } from "./redact-proof-output.mjs";

const tempDirs = [];
const MAX_PROOF_DRAFT_JSON_BYTES = 512 * 1024;
function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function readProofDraftJson(filePath) {
  const stats = statSync(filePath);
  if (!stats.isFile()) throw new Error("proof draft JSON artifact is not a file");
  if (stats.size > MAX_PROOF_DRAFT_JSON_BYTES) {
    throw new Error("proof draft JSON artifact is too large to validate safely");
  }
  return JSON.parse(readFileSync(filePath, "utf8"));
}

const tmp = makeTempDir("lore-proof-drafts-");
const proofManifestDirectory = mkdtempSync(join(tmp, "proof-manifest-dir.json-"));
const repositoryRoot = realpathSync(process.cwd());

function trustedFixtureGitExecutable() {
  const candidates = process.platform === "win32"
    ? [
        "C:\\Program Files\\Git\\cmd\\git.exe",
        "C:\\Program Files\\Git\\bin\\git.exe",
        "C:\\Program Files\\Git\\mingw64\\bin\\git.exe",
      ]
    : ["/usr/bin/git"];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return realpathSync(candidate);
    } catch {
      // Try the next fixed system location.
    }
  }
  throw new Error("proof regression harness requires a trusted fixed Git executable");
}

const qaFixtureGit = trustedFixtureGitExecutable();
const qaGitEnvironment = {
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_AUTHOR_EMAIL: "proof-fixture@example.invalid",
  GIT_AUTHOR_NAME: "Proof Fixture",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_EMAIL: "proof-fixture@example.invalid",
  GIT_COMMITTER_NAME: "Proof Fixture",
  GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_LFS_SKIP_SMUDGE: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_PAGER: "cat",
  GIT_TERMINAL_PROMPT: "0",
  LANG: "C",
  LC_ALL: "C",
};

function runFixtureGit(cwd, args) {
  const result = spawnSync(qaFixtureGit, args, {
    cwd,
    encoding: "utf8",
    env: qaGitEnvironment,
    maxBuffer: 256 * 1024,
    timeout: 10_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error("proof regression harness could not create its isolated Git candidate fixture");
  }
  return String(result.stdout ?? "").trim();
}

function createQaCandidateRepo(name, dirty = false) {
  const repoPath = mkdtempSync(join(tmp, `${name}-`));
  writeFileSync(join(repoPath, "release-candidate.txt"), "canonical release candidate\n", "utf8");
  runFixtureGit(repoPath, ["init", "--quiet"]);
  runFixtureGit(repoPath, ["add", "--", "release-candidate.txt"]);
  runFixtureGit(repoPath, ["commit", "--quiet", "-m", "proof fixture"]);
  const revision = runFixtureGit(repoPath, ["rev-parse", "--verify", "HEAD^{commit}"]).toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(revision)) {
    throw new Error("proof regression harness requires an exact immutable Git fixture revision");
  }
  if (dirty) {
    writeFileSync(join(repoPath, "release-candidate.txt"), "unstaged candidate mutation\n", "utf8");
    writeFileSync(join(repoPath, "staged-release-content.js"), "export const staged = true;\n", "utf8");
    runFixtureGit(repoPath, ["add", "--", "staged-release-content.js"]);
    writeFileSync(join(repoPath, "untracked-release-content.js"), "export const untracked = true;\n", "utf8");
  }
  return { repoPath, revision };
}

const qaCleanCandidate = createQaCandidateRepo("lore-g14-candidate-clean");
const qaDirtyCandidate = createQaCandidateRepo("lore-g14-candidate-dirty", true);
if (qaCleanCandidate.revision !== qaDirtyCandidate.revision) {
  throw new Error("proof regression harness candidate fixtures must share the exact same HEAD");
}
const qaCandidateRevision = qaCleanCandidate.revision;
const qaSpoofedGitConfig = join(tmp, "attacker-controlled-gitconfig");
writeFileSync(qaSpoofedGitConfig, "[core]\n\tfsmonitor = false\n", "utf8");

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

const G14_ATTESTATION_DOMAIN = "lore-g14-security-attestation/v2";
const G14_TRUSTED_KEY_ENV = "G14_TRUSTED_REVIEWER_ED25519_SPKI_BASE64";
const G14_EXTERNAL_REQUIRED_MESSAGE = "G14 requires a protected external reviewer trust anchor; local verifier mechanics do not close G14";
const qaNow = Date.now();
const qaReviewerKeyPair = generateKeyPairSync("ed25519");
const qaReviewerPublicKeyBytes = qaReviewerKeyPair.publicKey.export({ format: "der", type: "spki" });
const qaReviewerPublicKey = qaReviewerPublicKeyBytes.toString("base64");
const qaSelfAuthoredKeyPair = generateKeyPairSync("ed25519");
const qaSelfAuthoredPublicKeyBytes = qaSelfAuthoredKeyPair.publicKey.export({ format: "der", type: "spki" });

function securityAttestationPayload(bundle, attestation) {
  return Buffer.from(`${G14_ATTESTATION_DOMAIN}\n${JSON.stringify({
    candidateRevision: qaCandidateRevision,
    scanId: bundle.scanId,
    manifestSha256: bundle.manifestSha256,
    findingsSha256: bundle.findingsSha256,
    coverageSha256: bundle.coverageSha256,
    scanCompletedAt: bundle.completedAt,
    scanSealedAt: bundle.sealedAt,
    signedAt: attestation.signedAt,
    expiresAt: attestation.expiresAt,
  })}\n`, "utf8");
}

function signSecurityAttestation(bundle, keyPair = qaReviewerKeyPair, options = {}) {
  const publicKeyBytes = keyPair.publicKey.export({ format: "der", type: "spki" });
  const attestation = {
    reviewerKeyId: createHash("sha256").update(publicKeyBytes).digest("hex"),
    signedAt: options.signedAt ?? new Date(qaNow - 30 * 1000).toISOString(),
    expiresAt: options.expiresAt ?? new Date(qaNow + 60 * 60 * 1000).toISOString(),
  };
  return {
    ...attestation,
    signature: sign(null, securityAttestationPayload(bundle, attestation), keyPair.privateKey).toString("base64"),
  };
}

function writeCanonicalSecurityScanBundle(name, options = {}) {
  const bundlePath = mkdtempSync(join(tmp, `${name}-`));
  const scanId = `scan-${name}`;
  const findingsDocument = {
    documentType: "codex-security.findings",
    schemaVersion: "1.0",
    scanId,
    findings: options.findings ?? [],
  };
  const coverageDocument = {
    completeness: "complete",
    deferred: [],
    documentType: "codex-security.coverage",
    excludePaths: [],
    explicitExclusions: [],
    includePaths: ["."],
    inventoryStrategy: options.inventoryStrategy ?? "repository",
    mode: options.mode ?? "repository",
    scanId,
    schemaVersion: "1.0",
    surfaces: [],
  };
  const findingsText = `${JSON.stringify(findingsDocument, null, 2)}\n`;
  const coverageText = `${JSON.stringify(coverageDocument, null, 2)}\n`;
  const findingsPath = join(bundlePath, "findings.json");
  const coveragePath = join(bundlePath, "coverage.json");
  writeFileSync(findingsPath, findingsText, "utf8");
  writeFileSync(coveragePath, coverageText, "utf8");
  const completedAt = options.completedAt ?? new Date(qaNow - 2 * 60 * 1000).toISOString();
  const sealedAt = options.sealedAt ?? new Date(qaNow - 60 * 1000).toISOString();
  const scanManifest = {
    documentType: "codex-security.scan-manifest",
    schemaVersion: "1.0",
    scan: {
      id: scanId,
      producer: { name: "codex-security-plugin", version: "0.1.18" },
      status: options.status ?? "completed",
      startedAt: options.startedAt ?? new Date(Date.parse(completedAt) - 60 * 1000).toISOString(),
      completedAt,
      ...(options.sealed === false ? {} : { sealedAt }),
      target: {
        kind: "git_revision",
        targetId: `target-${name}`,
        displayName: "linea-miner-main",
        revision: options.revision ?? qaCandidateRevision,
      },
      scope: { includePaths: ["."], excludePaths: [] },
      coverageRef: "coverage.json",
      findingsRef: "findings.json",
      artifacts: [
        { path: "findings.json", sha256: sha256Text(findingsText), mediaType: "application/json" },
        { path: "coverage.json", sha256: sha256Text(coverageText), mediaType: "application/json" },
      ],
    },
  };
  const manifestText = `${JSON.stringify(scanManifest, null, 2)}\n`;
  writeFileSync(join(bundlePath, "scan-manifest.json"), manifestText, "utf8");
  return {
    bundlePath,
    scanId,
    findingsPath,
    manifestSha256: sha256Text(manifestText),
    findingsSha256: sha256Text(findingsText),
    coverageSha256: sha256Text(coverageText),
    completedAt,
    sealedAt: options.sealed === false ? "" : sealedAt,
  };
}

const qaValidSecurityScan = writeCanonicalSecurityScanBundle("qa-security-valid");
const qaDeepRepositorySecurityScan = writeCanonicalSecurityScanBundle("qa-security-deep-repository", { mode: "deep_repository" });
const qaCommitModeSecurityScan = writeCanonicalSecurityScanBundle("qa-security-commit-mode", { mode: "commit" });
const qaCustomInventorySecurityScan = writeCanonicalSecurityScanBundle("qa-security-custom-inventory", { inventoryStrategy: "custom" });
const qaAlternateValidSecurityScan = writeCanonicalSecurityScanBundle("qa-security-alternate-valid");
const qaUnsealedSecurityScan = writeCanonicalSecurityScanBundle("qa-security-unsealed", { status: "running", sealed: false });
const qaStaleSecurityScan = writeCanonicalSecurityScanBundle("qa-security-stale", {
  completedAt: new Date(qaNow - 26 * 60 * 60 * 1000).toISOString(),
  sealedAt: new Date(qaNow - 25 * 60 * 60 * 1000).toISOString(),
});
const qaExpiringSecurityScan = writeCanonicalSecurityScanBundle("qa-security-expired-attestation", {
  completedAt: new Date(qaNow - (23 * 60 + 56) * 60 * 1000).toISOString(),
  sealedAt: new Date(qaNow - (23 * 60 + 55) * 60 * 1000).toISOString(),
});
const qaDigestMismatchSecurityScan = writeCanonicalSecurityScanBundle("qa-security-digest-mismatch");
writeFileSync(qaDigestMismatchSecurityScan.findingsPath, '{"tampered":true}\n', "utf8");
const qaOpenMediumSecurityScan = writeCanonicalSecurityScanBundle("qa-security-open-medium", {
  findings: [{
    findingId: `csf_${"1".repeat(24)}`,
    occurrenceId: `occ_${"2".repeat(24)}`,
    ruleId: "proof.test-medium",
    identity: { anchor: "proof-test-medium" },
    fingerprints: { algorithm: "codex-security/v1", primary: `codex-security/v1:sha256:${"3".repeat(64)}` },
    title: "Synthetic medium finding",
    summary: "Synthetic regression fixture",
    severity: { level: "medium" },
    confidence: { level: "high", rationale: "Synthetic fixture" },
    taxonomy: { category: "proof", cwe: ["CWE-345"] },
    locations: [{ path: "scripts/check-qa-proof.mjs", startLine: 1 }],
    remediation: "Synthetic fixture",
    provenance: { source: "test" },
  }],
});
const { DatabaseSync } = await import("node:sqlite");
const summaryOnly = process.argv.includes("--summary-only");
const canaryLog = join(tmp, "canary.jsonl");
const emptyCanaryLog = join(tmp, "empty-canary.jsonl");
const canaryTargetArtifact = join(tmp, "canary-target-proof.log");
const canaryRecoveryArtifact = join(tmp, "canary-recovery-proof.log");
const canarySessionArtifact = join(tmp, "canary-session-summary.log");
const canaryTxArtifact = join(tmp, "canary-transaction-scan.log");
const canaryDirectoryArtifact = mkdtempSync(join(tmp, "canary-directory-artifact.log-"));
const canaryEvent = JSON.stringify({ timestamp: "2026-07-09T00:00:00.000Z", round: 0, ok: true, txStatus: "success", role: "AUTOMINER_A", mode: "bet", epoch: 1, tiles: [1], txHash: "0x1111111111111111111111111111111111111111111111111111111111111111", network: "linea-mainnet", chainId: 59144, contractAddress: "0x1111111111111111111111111111111111111111", rpcLabel: "redacted-mainnet-rpc", nonceLatest: 0, noncePending: 0 });
writeFileSync(canaryLog, `${canaryEvent}\n`, "utf8");
writeFileSync(emptyCanaryLog, "", "utf8");
const canaryFullLog = join(tmp, "canary-full.jsonl");
const canaryFullTxHashes = Array.from({ length: 52 }, (_, index) => `0x${(index + 1).toString(16).padStart(64, "0")}`);
const canaryFullEvents = canaryFullTxHashes.map((txHash, index) => JSON.stringify({
  timestamp: new Date(Date.UTC(2026, 6, 9, 0, index, 0)).toISOString(),
  round: index,
  ok: true,
  txStatus: "success",
  role: index === 50 ? "MANUAL" : index === 51 ? "AUTOMINER_B" : "AUTOMINER_A",
  mode: "single",
  epoch: index + 1,
  tiles: [1],
  txHash,
  network: "linea-mainnet",
  chainId: 59144,
  contractAddress: "0x1111111111111111111111111111111111111111",
  rpcLabel: "redacted-mainnet-rpc",
  nonceLatest: index,
  noncePending: index,
}));
writeFileSync(canaryFullLog, `${canaryFullEvents.join("\n")}\n`, "utf8");
const canaryMalformedChainIdLog = join(tmp, "canary-malformed-chain-id.jsonl");
writeFileSync(
  canaryMalformedChainIdLog,
  `${canaryFullEvents.map((event, index) => index === 0 ? JSON.stringify({ ...JSON.parse(event), chainId: "59144.0" }) : event).join("\n")}\n`,
  "utf8",
);
const canaryMalformedNonceLog = join(tmp, "canary-malformed-nonce.jsonl");
writeFileSync(
  canaryMalformedNonceLog,
  `${canaryFullEvents.map((event, index) => index === 1 ? JSON.stringify({ ...JSON.parse(event), noncePending: "2e1" }) : event).join("\n")}\n`,
  "utf8",
);
const canaryUnsafeNonceLog = join(tmp, "canary-unsafe-nonce.jsonl");
writeFileSync(
  canaryUnsafeNonceLog,
  `${canaryFullEvents.map((event, index) => index === 1 ? JSON.stringify({ ...JSON.parse(event), noncePending: "9999999999999999" }) : event).join("\n")}\n`,
  "utf8",
);
const canaryDuplicateNonceLog = join(tmp, "canary-duplicate-nonce.jsonl");
writeFileSync(
  canaryDuplicateNonceLog,
  `${canaryFullEvents.map((event, index) => index === 2 ? JSON.stringify({ ...JSON.parse(event), nonceLatest: 1, noncePending: 1 }) : event).join("\n")}\n`,
  "utf8",
);
const canaryDuplicateRoleEpochLog = join(tmp, "canary-duplicate-role-epoch.jsonl");
writeFileSync(
  canaryDuplicateRoleEpochLog,
  `${canaryFullEvents.map((event, index) => index === 2 ? JSON.stringify({ ...JSON.parse(event), epoch: 2, tiles: [2], nonceLatest: 2, noncePending: 2 }) : event).join("\n")}\n`,
  "utf8",
);
const canaryMalformedTileLog = join(tmp, "canary-malformed-tile.jsonl");
writeFileSync(
  canaryMalformedTileLog,
  `${canaryFullEvents.map((event, index) => index === 2 ? JSON.stringify({ ...JSON.parse(event), tiles: ["1.0"] }) : event).join("\n")}\n`,
  "utf8",
);
const canaryMalformedTimestampLog = join(tmp, "canary-malformed-timestamp.jsonl");
writeFileSync(
  canaryMalformedTimestampLog,
  `${canaryFullEvents.map((event, index) => index === 3 ? JSON.stringify({ ...JSON.parse(event), timestamp: "2026-07-09 00:03:00" }) : event).join("\n")}\n`,
  "utf8",
);
const canaryMalformedEpochLog = join(tmp, "canary-malformed-epoch.jsonl");
writeFileSync(
  canaryMalformedEpochLog,
  `${canaryFullEvents.map((event, index) => index === 3 ? JSON.stringify({ ...JSON.parse(event), epoch: "4.0" }) : event).join("\n")}\n`,
  "utf8",
);
const canaryUnsafeEpochLog = join(tmp, "canary-unsafe-epoch.jsonl");
writeFileSync(
  canaryUnsafeEpochLog,
  `${canaryFullEvents.map((event, index) => index === 3 ? JSON.stringify({ ...JSON.parse(event), epoch: "9999999999999999" }) : event).join("\n")}\n`,
  "utf8",
);
const canaryMalformedTxMetricLog = join(tmp, "canary-malformed-tx-metric.jsonl");
writeFileSync(
  canaryMalformedTxMetricLog,
  `${canaryFullEvents.map((event, index) => index === 4 ? JSON.stringify({ ...JSON.parse(event), durationMs: "1.5", gasUsed: "2e1" }) : event).join("\n")}\n`,
  "utf8",
);
const canaryUnsafeTxMetricLog = join(tmp, "canary-unsafe-tx-metric.jsonl");
writeFileSync(
  canaryUnsafeTxMetricLog,
  `${canaryFullEvents.map((event, index) => index === 4 ? JSON.stringify({ ...JSON.parse(event), durationMs: "9999999999999999", gasUsed: "9999999999999999" }) : event).join("\n")}\n`,
  "utf8",
);
const canaryFullBomLog = join(tmp, "canary-full-bom.jsonl");
writeFileSync(canaryFullBomLog, `\uFEFF${canaryFullEvents.join("\n")}\n`, "utf8");
const canaryUnexpectedRoleLog = join(tmp, "canary-unexpected-role.jsonl");
writeFileSync(
  canaryUnexpectedRoleLog,
  `${canaryFullEvents.map((event, index) => index === 49 ? JSON.stringify({ ...JSON.parse(event), role: "AUTOMINER_C" }) : event).join("\n")}\n`,
  "utf8",
);
const canaryMalformedRoleLog = join(tmp, "canary-malformed-role.jsonl");
writeFileSync(
  canaryMalformedRoleLog,
  `${canaryFullEvents.map((event, index) => index === 49 ? JSON.stringify({ ...JSON.parse(event), role: "AUTOMINER A" }) : event).join("\n")}\n`,
  "utf8",
);
const canaryFailedPreflightLog = join(tmp, "canary-failed-preflight.jsonl");
writeFileSync(
  canaryFailedPreflightLog,
  `${[
    JSON.stringify({
      timestamp: "2026-07-09T00:00:00.000Z",
      mode: "preflight",
      role: "AUTOMINER_A",
      ok: false,
      errorKind: "insufficient-token",
      network: "linea-mainnet",
      chainId: 59144,
      contractAddress: "0x1111111111111111111111111111111111111111",
      rpcLabel: "redacted-mainnet-rpc",
    }),
    ...canaryFullEvents,
  ].join("\n")}\n`,
  "utf8",
);
const testnetCanaryFullLog = join(tmp, "testnet-canary-full.jsonl");
const testnetCanaryFullEvents = canaryFullEvents.map((event) => JSON.stringify({
  ...JSON.parse(event),
  network: "linea-sepolia",
  chainId: 59141,
  rpcLabel: "redacted-sepolia-rpc",
}));
writeFileSync(testnetCanaryFullLog, `${testnetCanaryFullEvents.join("\n")}\n`, "utf8");
const canaryTemplateLiveLog = join(tmp, "canary-template-live.jsonl");
const canarySecretLiveLog = join(tmp, "canary-secret-live.jsonl");
const canaryUnsafeErrorLiveLog = join(tmp, "canary-unsafe-error-live.jsonl");
const canaryUnsafeDiagnosticLiveLog = join(tmp, "canary-unsafe-diagnostic-live.jsonl");
const canaryMalformedLiveLog = join(tmp, "canary-malformed-live.jsonl");
const canaryNonObjectLiveLog = join(tmp, "canary-non-object-live.jsonl");
writeFileSync(
  canaryTemplateLiveLog,
  `${canaryFullEvents.map((event, index) => index === 1 ? JSON.stringify({ ...JSON.parse(event), diagnostic: "TODO" }) : event).join("\n")}\n`,
  "utf8",
);
writeFileSync(
  canarySecretLiveLog,
  `${canaryFullEvents.map((event, index) => index === 2 ? JSON.stringify({ ...JSON.parse(event), rpcUrl: "https://rpc.example.test/secret-key" }) : event).join("\n")}\n`,
  "utf8",
);
writeFileSync(
  canaryUnsafeErrorLiveLog,
  `${canaryFullEvents.map((event, index) => index === 2 ? JSON.stringify({ ...JSON.parse(event), error: "estimate failed at https://rpc.example.test from 0x1111111111111111111111111111111111111111" }) : event).join("\n")}\n`,
  "utf8",
);
writeFileSync(
  canaryUnsafeDiagnosticLiveLog,
  `${canaryFullEvents.map((event, index) => index === 2 ? JSON.stringify({ ...JSON.parse(event), diagnostic: "wallet retry used https://rpc.example.test for 0x1111111111111111111111111111111111111111" }) : event).join("\n")}\n`,
  "utf8",
);
writeFileSync(
  canaryMalformedLiveLog,
  `${canaryFullEvents.map((event, index) => index === 3 ? "not-json" : event).join("\n")}\n`,
  "utf8",
);
writeFileSync(
  canaryNonObjectLiveLog,
  `${canaryFullEvents.map((event, index) => index === 4 ? "[]" : event).join("\n")}\n`,
  "utf8",
);
writeFileSync(canaryTargetArtifact, "synthetic canary target proof\n", "utf8");
writeFileSync(canaryRecoveryArtifact, "synthetic canary recovery proof\n", "utf8");
writeFileSync(canarySessionArtifact, "synthetic canary session proof\n", "utf8");
writeFileSync(canaryTxArtifact, "synthetic canary transaction proof\n", "utf8");
const canaryMissingArtifact = join(tmp, "missing-canary-target-proof.log");
const canaryMissingArtifactManifest = join(tmp, "canary-missing-local-artifact.json");
const canaryValidStrictManifestPath = join(tmp, "canary-valid-strict.json");
writeFileSync(
  canaryMissingArtifactManifest,
  JSON.stringify({
    targetNetwork: {
      realTargetNetwork: true,
      network: "linea-mainnet",
      chainId: 59144,
      rpc: "redacted-mainnet-rpc",
      contractAddress: "0x1111111111111111111111111111111111111111",
      checkedAt: "2026-07-09T00:00:00.000Z",
      evidencePath: canaryMissingArtifact,
    },
    recovery: {
      reload: { status: "verified", checkedAt: "2026-07-09T00:00:00.000Z", evidencePath: canaryRecoveryArtifact },
      reconnect: { status: "verified", checkedAt: "2026-07-09T00:00:00.000Z", evidencePath: canaryRecoveryArtifact },
      tabCloseRestore: { status: "verified", checkedAt: "2026-07-09T00:00:00.000Z", evidencePath: canaryRecoveryArtifact },
      pendingTxRecovery: { status: "verified", checkedAt: "2026-07-09T00:00:00.000Z", txHash: canaryFullTxHashes[0], evidencePath: canaryRecoveryArtifact },
      routeSwitchOrRemount: { status: "verified", checkedAt: "2026-07-09T00:00:00.000Z", evidencePath: canaryRecoveryArtifact },
    },
    autoMinerSession: {
      status: "verified",
      targetRpcConfirmed: true,
      rounds: 51,
      uniqueEpochs: 51,
      requiredRoles: ["MANUAL", "AUTOMINER_A", "AUTOMINER_B"],
      successfulRoles: ["MANUAL", "AUTOMINER_A", "AUTOMINER_B"],
      checkedAt: "2026-07-09T00:51:00.000Z",
      evidencePath: canarySessionArtifact,
    },
    transactionHealth: {
      noDuplicateBets: true,
      noNonceLoops: true,
      noStuckPending: true,
      pendingRecoveryConverged: true,
      txHashes: [canaryFullTxHashes[0]],
      checkedAt: "2026-07-09T00:51:00.000Z",
      evidencePath: canaryTxArtifact,
    },
  }),
  "utf8",
);
const canaryIrrelevantArtifact = join(tmp, "canary-irrelevant.log");
const canarySharedSectionArtifact = join(tmp, "canary-shared-section.log");
const canaryIrrelevantTargetManifest = join(tmp, "canary-irrelevant-target.json");
const canaryIrrelevantRecoveryManifest = join(tmp, "canary-irrelevant-recovery.json");
const canaryIrrelevantSessionManifest = join(tmp, "canary-irrelevant-session.json");
const canaryIrrelevantTxManifest = join(tmp, "canary-irrelevant-transaction.json");
const canarySharedSectionManifest = join(tmp, "canary-shared-section.json");
const canaryDirectoryArtifactManifest = join(tmp, "canary-directory-artifact.json");
const canaryFutureTimestampManifest = join(tmp, "canary-future-timestamp.json");
const canaryMalformedChainIdManifest = join(tmp, "canary-malformed-chain-id.json");
const canaryMalformedSessionCountsManifest = join(tmp, "canary-malformed-session-counts.json");
const canaryDuplicateSessionRolesManifest = join(tmp, "canary-duplicate-session-roles.json");
const canaryMalformedTransactionHashesManifest = join(tmp, "canary-malformed-transaction-hashes.json");
const canaryDuplicateTransactionHashesManifest = join(tmp, "canary-duplicate-transaction-hashes.json");
writeFileSync(canaryIrrelevantArtifact, "pm2 process list only\n", "utf8");
writeFileSync(canarySharedSectionArtifact, "target RPC chain Linea mainnet launch proof\nreload reconnect tab-close pending-tx remount recovery proof\nauto-miner session rounds epochs target RPC proof\ntransaction tx nonce duplicate stuck pending pending recovery proof\n", "utf8");
const canaryValidStrictManifest = {
  targetNetwork: {
    realTargetNetwork: true,
    network: "linea-mainnet",
    chainId: 59144,
    rpc: "redacted-mainnet-rpc",
    contractAddress: "0x1111111111111111111111111111111111111111",
    checkedAt: "2026-07-09T00:00:00.000Z",
    evidencePath: canaryTargetArtifact,
  },
  recovery: {
    reload: { status: "verified", checkedAt: "2026-07-09T00:00:00.000Z", evidencePath: canaryRecoveryArtifact },
    reconnect: { status: "verified", checkedAt: "2026-07-09T00:00:00.000Z", evidencePath: canaryRecoveryArtifact },
    tabCloseRestore: { status: "verified", checkedAt: "2026-07-09T00:00:00.000Z", evidencePath: canaryRecoveryArtifact },
    pendingTxRecovery: { status: "verified", checkedAt: "2026-07-09T00:00:00.000Z", txHash: canaryFullTxHashes[0], evidencePath: canaryRecoveryArtifact },
    routeSwitchOrRemount: { status: "verified", checkedAt: "2026-07-09T00:00:00.000Z", evidencePath: canaryRecoveryArtifact },
  },
  autoMinerSession: {
    status: "verified",
    targetRpcConfirmed: true,
    rounds: 51,
    uniqueEpochs: 51,
    requiredRoles: ["MANUAL", "AUTOMINER_A", "AUTOMINER_B"],
    successfulRoles: ["MANUAL", "AUTOMINER_A", "AUTOMINER_B"],
    checkedAt: "2026-07-09T00:51:00.000Z",
    evidencePath: canarySessionArtifact,
  },
  transactionHealth: {
    noDuplicateBets: true,
    noNonceLoops: true,
    noStuckPending: true,
    pendingRecoveryConverged: true,
    txHashes: [canaryFullTxHashes[0]],
    checkedAt: "2026-07-09T00:51:00.000Z",
    evidencePath: canaryTxArtifact,
  },
};
writeFileSync(canaryValidStrictManifestPath, JSON.stringify(canaryValidStrictManifest), "utf8");
writeFileSync(
  canaryMalformedChainIdManifest,
  JSON.stringify({
    ...canaryValidStrictManifest,
    targetNetwork: { ...canaryValidStrictManifest.targetNetwork, chainId: "59144.0" },
  }),
  "utf8",
);
writeFileSync(
  canaryMalformedSessionCountsManifest,
  JSON.stringify({
    ...canaryValidStrictManifest,
    autoMinerSession: {
      ...canaryValidStrictManifest.autoMinerSession,
      rounds: "51.0",
      uniqueEpochs: "5.1e1",
    },
  }),
  "utf8",
);
writeFileSync(
  canaryDuplicateSessionRolesManifest,
  JSON.stringify({
    ...canaryValidStrictManifest,
    autoMinerSession: {
      ...canaryValidStrictManifest.autoMinerSession,
      successfulRoles: ["MANUAL", "AUTOMINER_A", "AUTOMINER_A", "AUTOMINER_B"],
    },
  }),
  "utf8",
);
writeFileSync(
  canaryMalformedTransactionHashesManifest,
  JSON.stringify({
    ...canaryValidStrictManifest,
    transactionHealth: {
      ...canaryValidStrictManifest.transactionHealth,
      txHashes: [canaryFullTxHashes[0], "0x1234"],
    },
  }),
  "utf8",
);
writeFileSync(
  canaryDuplicateTransactionHashesManifest,
  JSON.stringify({
    ...canaryValidStrictManifest,
    transactionHealth: {
      ...canaryValidStrictManifest.transactionHealth,
      txHashes: [canaryFullTxHashes[0], canaryFullTxHashes[0]],
    },
  }),
  "utf8",
);
const testnetCanaryValidStrictManifestPath = join(tmp, "testnet-canary-valid-strict.json");
const testnetCanaryValidStrictManifest = {
  ...canaryValidStrictManifest,
  targetNetwork: {
    ...canaryValidStrictManifest.targetNetwork,
    network: "linea-sepolia",
    chainId: 59141,
    rpc: "redacted-sepolia-rpc",
  },
};
writeFileSync(testnetCanaryValidStrictManifestPath, JSON.stringify(testnetCanaryValidStrictManifest), "utf8");
writeFileSync(
  canaryIrrelevantTargetManifest,
  JSON.stringify({
    ...canaryValidStrictManifest,
    targetNetwork: { ...canaryValidStrictManifest.targetNetwork, evidencePath: canaryIrrelevantArtifact },
  }),
  "utf8",
);
writeFileSync(
  canaryIrrelevantRecoveryManifest,
  JSON.stringify({
    ...canaryValidStrictManifest,
    recovery: Object.fromEntries(Object.entries(canaryValidStrictManifest.recovery).map(([key, value]) => [key, { ...value, evidencePath: canaryIrrelevantArtifact }])),
  }),
  "utf8",
);
writeFileSync(
  canaryIrrelevantSessionManifest,
  JSON.stringify({
    ...canaryValidStrictManifest,
    autoMinerSession: { ...canaryValidStrictManifest.autoMinerSession, evidencePath: canaryIrrelevantArtifact },
  }),
  "utf8",
);
writeFileSync(
  canaryIrrelevantTxManifest,
  JSON.stringify({
    ...canaryValidStrictManifest,
    transactionHealth: { ...canaryValidStrictManifest.transactionHealth, evidencePath: canaryIrrelevantArtifact },
  }),
  "utf8",
);
writeFileSync(
  canarySharedSectionManifest,
  JSON.stringify({
    ...canaryValidStrictManifest,
    targetNetwork: { ...canaryValidStrictManifest.targetNetwork, evidencePath: canarySharedSectionArtifact },
    recovery: Object.fromEntries(Object.entries(canaryValidStrictManifest.recovery).map(([key, value]) => [key, { ...value, evidencePath: canarySharedSectionArtifact }])),
    autoMinerSession: { ...canaryValidStrictManifest.autoMinerSession, evidencePath: canarySharedSectionArtifact },
    transactionHealth: { ...canaryValidStrictManifest.transactionHealth, evidencePath: canarySharedSectionArtifact },
  }),
  "utf8",
);
writeFileSync(
  canaryDirectoryArtifactManifest,
  JSON.stringify({
    ...canaryValidStrictManifest,
    targetNetwork: { ...canaryValidStrictManifest.targetNetwork, evidencePath: canaryDirectoryArtifact },
  }),
  "utf8",
);
{
  const canaryFutureTimestamp = JSON.parse(JSON.stringify(canaryValidStrictManifest));
  canaryFutureTimestamp.targetNetwork.checkedAt = "2999-01-01T00:00:00.000Z";
  for (const value of Object.values(canaryFutureTimestamp.recovery)) {
    value.checkedAt = "2999-01-01T00:00:00.000Z";
  }
  canaryFutureTimestamp.autoMinerSession.checkedAt = "2999-01-01T00:00:00.000Z";
  canaryFutureTimestamp.transactionHealth.checkedAt = "2999-01-01T00:00:00.000Z";
  writeFileSync(canaryFutureTimestampManifest, JSON.stringify(canaryFutureTimestamp), "utf8");
}
const qaWalletArtifact = join(tmp, "qa-wallet-flow-report.md");
const qaFailureArtifact = join(tmp, "qa-failure-state-report.md");
const qaSupportArtifact = join(tmp, "qa-support-audit-report.md");
const qaFinalArtifact = join(tmp, "qa-final-browser-report.md");
const qaSmokeArtifact = join(tmp, "qa-smoke-debug-autominer.log");
const qaDirectoryArtifact = makeTempDir("lore-proof-qa-artifact.log-");
const qaDirectoryArtifactManifest = join(tmp, "qa-directory-artifact.json");
writeFileSync(
  qaWalletArtifact,
  [
    "synthetic wallet QA report with Privy dashboard allowed-origin production origin and production app id proof",
    "desktop browser connect wallet ready, desktop disconnect, and desktop reconnect after reload verified",
    "wrong network unsupported chain warning and switch network recovery verified",
    "mobile Web3 browser wallet flow verified on iOS in-app wallet with mobile viewport 390x844",
    "clean wallet first transaction receipt confirmed with status 1 on Lineascan explorer block 123 verified",
    "slow network Privy auth modal timeout copy verified",
    "slow network chat auth delayed message recovery verified",
  ].join("\n"),
  "utf8",
);
writeFileSync(qaFailureArtifact, "synthetic failure-state QA report\n", "utf8");
writeFileSync(qaSupportArtifact, "synthetic support audit QA report\n", "utf8");
writeFileSync(qaFinalArtifact, "synthetic final browser QA report\n", "utf8");
writeFileSync(qaSmokeArtifact, "synthetic debug autominer smoke log\n", "utf8");
const qaMissingArtifact = join(tmp, "missing-qa-wallet-flow-report.md");
const qaMissingArtifactManifest = join(tmp, "qa-missing-local-artifact.json");
const checkedAt = "2026-07-09T00:00:00.000Z";
const qaCheck = (artifact, origin = undefined) => ({
  status: "verified",
  checkedAt,
  evidencePath: artifact,
  ...(origin ? { origin } : {}),
});
writeFileSync(
  qaMissingArtifactManifest,
  JSON.stringify({
    targetNetwork: "linea-mainnet",
    targetChainId: 59144,
    securityScan: {
      bundlePath: qaValidSecurityScan.bundlePath,
      manifestSha256: qaValidSecurityScan.manifestSha256,
      candidateRevision: qaCandidateRevision,
      attestation: signSecurityAttestation(qaValidSecurityScan),
    },
    wallet: {
      privyAllowedOrigins: {
        ...qaCheck(qaMissingArtifact),
        origin: "https://playlore.xyz",
        exactProductionOrigin: true,
        developmentFallbackAppIdUsed: false,
        productionAppIdConfigured: true,
      },
      desktopConnect: qaCheck(qaWalletArtifact, "https://playlore.xyz"),
      desktopDisconnect: qaCheck(qaWalletArtifact, "https://playlore.xyz"),
      desktopReconnect: qaCheck(qaWalletArtifact, "https://playlore.xyz"),
      wrongNetwork: {
        ...qaCheck(qaWalletArtifact, "https://playlore.xyz"),
        unsupportedChainWarningVisible: true,
        targetChainId: 59144,
        testedChainId: 1,
      },
      mobileWeb3Browser: qaCheck(qaWalletArtifact, "https://playlore.xyz"),
      cleanWalletFirstTx: {
        ...qaCheck(qaWalletArtifact, "https://playlore.xyz"),
        txHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
        network: "linea-mainnet",
        chainId: 59144,
      },
      slowNetworkAuthModal: qaCheck(qaWalletArtifact, "https://playlore.xyz"),
      slowNetworkChatAuth: qaCheck(qaWalletArtifact, "https://playlore.xyz"),
    },
    failureStateUx: {
      disabledActionsExplainReason: qaCheck(qaFailureArtifact),
      pendingBet: qaCheck(qaFailureArtifact),
      pendingResolve: qaCheck(qaFailureArtifact),
      pendingChatAuth: qaCheck(qaFailureArtifact),
      pendingProfileSave: qaCheck(qaFailureArtifact),
      degradedDataVisible: qaCheck(qaFailureArtifact),
      routeChunkRecovery: qaCheck(qaFailureArtifact),
      noSilentNoop: qaCheck(qaFailureArtifact),
    },
    supportAuditVisibility: {
      betHistoryFields: {
        ...qaCheck(qaSupportArtifact),
        fields: ["epoch", "tile", "amount", "txHash", "result"],
      },
      autoMinerLogFields: {
        ...qaCheck(qaSupportArtifact),
        fields: ["round", "epoch", "nonce", "txHash", "retryCount", "stopReason"],
      },
      diagnosticsIndexerLag: qaCheck(qaSupportArtifact),
      diagnosticsHeartbeat: qaCheck(qaSupportArtifact),
      diagnosticsServingMode: qaCheck(qaSupportArtifact),
    },
    finalQa: {
      browserSmokeDebugAutominer: {
        ...qaCheck(qaSmokeArtifact),
        origin: "https://playlore.xyz",
        command: '$env:SMOKE_INCLUDE_DEBUG_AUTOMINER_SCENARIOS = "1"; npm.cmd run smoke:browser',
        debugAutominerScenariosPassed: true,
        noUnexpectedConsoleErrors: true,
        unsupportedWalletWarningsNotMasked: true,
      },
      mobileLayout: qaCheck(qaFinalArtifact),
      rightPanelOverlays: qaCheck(qaFinalArtifact),
      chatGeometry: qaCheck(qaFinalArtifact),
      faqMainnetWording: qaCheck(qaFinalArtifact),
      whitepaperMainnetWording: qaCheck(qaFinalArtifact),
      onboardingMainnetWording: qaCheck(qaFinalArtifact),
    },
  }),
  "utf8",
);
const qaIrrelevantArtifact = join(tmp, "qa-irrelevant.log");
const qaIrrelevantWalletManifest = join(tmp, "qa-irrelevant-wallet.json");
const qaIrrelevantFailureManifest = join(tmp, "qa-irrelevant-failure.json");
const qaIrrelevantSupportManifest = join(tmp, "qa-irrelevant-support.json");
const qaIrrelevantFinalManifest = join(tmp, "qa-irrelevant-final.json");
const qaIrrelevantSmokeManifest = join(tmp, "qa-irrelevant-smoke.json");
const qaCleanWalletNoReceiptArtifact = join(tmp, "qa-clean-wallet-no-receipt.md");
const qaCleanWalletNoReceiptManifest = join(tmp, "qa-clean-wallet-no-receipt.json");
const qaMobileNoDeviceArtifact = join(tmp, "qa-mobile-no-device.md");
const qaMobileNoDeviceManifest = join(tmp, "qa-mobile-no-device.json");
const qaMobileTouchOnlyArtifact = join(tmp, "qa-mobile-touch-only.md");
const qaMobileTouchOnlyManifest = join(tmp, "qa-mobile-touch-only.json");
const qaValidStrictManifestPath = join(tmp, "qa-valid-strict.json");
const qaSharedGroupArtifactManifest = join(tmp, "qa-shared-group-artifact.json");
const qaFutureTimestampManifest = join(tmp, "qa-future-timestamp.json");
const qaUnsafeTargetChainManifest = join(tmp, "qa-unsafe-target-chain-id.json");
const qaMissingSecurityScanManifest = join(tmp, "qa-missing-security-scan.json");
const qaWrongCandidateRevisionManifest = join(tmp, "qa-wrong-candidate-revision.json");
const qaWrongScanManifestDigestManifest = join(tmp, "qa-wrong-scan-manifest-digest.json");
const qaUnsealedSecurityScanManifest = join(tmp, "qa-unsealed-security-scan.json");
const qaStaleSecurityScanManifest = join(tmp, "qa-stale-security-scan.json");
const qaExpiredSecurityAttestationManifest = join(tmp, "qa-expired-security-attestation.json");
const qaCommitModeSecurityScanManifest = join(tmp, "qa-commit-mode-security-scan.json");
const qaCustomInventorySecurityScanManifest = join(tmp, "qa-custom-inventory-security-scan.json");
const qaDeepRepositorySecurityScanManifest = join(tmp, "qa-deep-repository-security-scan.json");
const qaArtifactDigestMismatchManifest = join(tmp, "qa-artifact-digest-mismatch.json");
const qaOpenMediumSecurityFindingManifest = join(tmp, "qa-open-medium-security-finding.json");
const qaUnsignedSecurityScanManifest = join(tmp, "qa-unsigned-security-scan.json");
const qaSelfAuthoredSecurityScanManifest = join(tmp, "qa-self-authored-security-scan.json");
const qaTamperedSecurityAttestationManifest = join(tmp, "qa-tampered-security-attestation.json");
writeFileSync(qaIrrelevantArtifact, "pm2 process list only\n", "utf8");
writeFileSync(qaCleanWalletNoReceiptArtifact, "clean wallet first transaction hash verified\n", "utf8");
writeFileSync(qaMobileNoDeviceArtifact, "mobile Web3 browser wallet flow verified\n", "utf8");
writeFileSync(qaMobileTouchOnlyArtifact, "mobile Web3 browser touch targets verified\n", "utf8");
const qaValidStrictManifest = {
  targetNetwork: "linea-mainnet",
  targetChainId: 59144,
  securityScan: {
    bundlePath: qaValidSecurityScan.bundlePath,
    manifestSha256: qaValidSecurityScan.manifestSha256,
    candidateRevision: qaCandidateRevision,
    attestation: signSecurityAttestation(qaValidSecurityScan),
  },
  wallet: {
    privyAllowedOrigins: {
      ...qaCheck(qaWalletArtifact),
      origin: "https://playlore.xyz",
      exactProductionOrigin: true,
      developmentFallbackAppIdUsed: false,
      productionAppIdConfigured: true,
    },
    desktopConnect: qaCheck(qaWalletArtifact, "https://playlore.xyz"),
    desktopDisconnect: qaCheck(qaWalletArtifact, "https://playlore.xyz"),
    desktopReconnect: qaCheck(qaWalletArtifact, "https://playlore.xyz"),
    wrongNetwork: {
      ...qaCheck(qaWalletArtifact, "https://playlore.xyz"),
      unsupportedChainWarningVisible: true,
      targetChainId: 59144,
      testedChainId: 1,
    },
    mobileWeb3Browser: qaCheck(qaWalletArtifact, "https://playlore.xyz"),
    cleanWalletFirstTx: {
      ...qaCheck(qaWalletArtifact, "https://playlore.xyz"),
      txHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      network: "linea-mainnet",
      chainId: 59144,
    },
    slowNetworkAuthModal: qaCheck(qaWalletArtifact, "https://playlore.xyz"),
    slowNetworkChatAuth: qaCheck(qaWalletArtifact, "https://playlore.xyz"),
  },
  failureStateUx: {
    disabledActionsExplainReason: qaCheck(qaFailureArtifact),
    pendingBet: qaCheck(qaFailureArtifact),
    pendingResolve: qaCheck(qaFailureArtifact),
    pendingChatAuth: qaCheck(qaFailureArtifact),
    pendingProfileSave: qaCheck(qaFailureArtifact),
    degradedDataVisible: qaCheck(qaFailureArtifact),
    routeChunkRecovery: qaCheck(qaFailureArtifact),
    noSilentNoop: qaCheck(qaFailureArtifact),
  },
  supportAuditVisibility: {
    betHistoryFields: {
      ...qaCheck(qaSupportArtifact),
      fields: ["epoch", "tile", "amount", "txHash", "result"],
    },
    autoMinerLogFields: {
      ...qaCheck(qaSupportArtifact),
      fields: ["round", "epoch", "nonce", "txHash", "retryCount", "stopReason"],
    },
    diagnosticsIndexerLag: qaCheck(qaSupportArtifact),
    diagnosticsHeartbeat: qaCheck(qaSupportArtifact),
    diagnosticsServingMode: qaCheck(qaSupportArtifact),
  },
  finalQa: {
    browserSmokeDebugAutominer: {
      ...qaCheck(qaSmokeArtifact),
      origin: "https://playlore.xyz",
      command: '$env:SMOKE_INCLUDE_DEBUG_AUTOMINER_SCENARIOS = "1"; npm.cmd run smoke:browser',
      debugAutominerScenariosPassed: true,
      noUnexpectedConsoleErrors: true,
      unsupportedWalletWarningsNotMasked: true,
    },
    mobileLayout: qaCheck(qaFinalArtifact),
    rightPanelOverlays: qaCheck(qaFinalArtifact),
    chatGeometry: qaCheck(qaFinalArtifact),
    faqMainnetWording: qaCheck(qaFinalArtifact),
    whitepaperMainnetWording: qaCheck(qaFinalArtifact),
    onboardingMainnetWording: qaCheck(qaFinalArtifact),
  },
};
writeFileSync(qaValidStrictManifestPath, JSON.stringify(qaValidStrictManifest), "utf8");
const withQaArtifact = (manifest, path, replacement) => JSON.stringify(replacement(structuredClone(manifest), path));
writeFileSync(qaIrrelevantWalletManifest, withQaArtifact(qaValidStrictManifest, qaIrrelevantArtifact, (manifest, artifact) => {
  for (const check of Object.values(manifest.wallet)) check.evidencePath = artifact;
  return manifest;
}), "utf8");
writeFileSync(qaIrrelevantFailureManifest, withQaArtifact(qaValidStrictManifest, qaIrrelevantArtifact, (manifest, artifact) => {
  for (const check of Object.values(manifest.failureStateUx)) check.evidencePath = artifact;
  return manifest;
}), "utf8");
writeFileSync(qaIrrelevantSupportManifest, withQaArtifact(qaValidStrictManifest, qaIrrelevantArtifact, (manifest, artifact) => {
  for (const check of Object.values(manifest.supportAuditVisibility)) check.evidencePath = artifact;
  return manifest;
}), "utf8");
writeFileSync(qaIrrelevantFinalManifest, withQaArtifact(qaValidStrictManifest, qaIrrelevantArtifact, (manifest, artifact) => {
  for (const [key, check] of Object.entries(manifest.finalQa)) if (key !== "browserSmokeDebugAutominer") check.evidencePath = artifact;
  return manifest;
}), "utf8");
writeFileSync(qaIrrelevantSmokeManifest, withQaArtifact(qaValidStrictManifest, qaIrrelevantArtifact, (manifest, artifact) => {
  manifest.finalQa.browserSmokeDebugAutominer.evidencePath = artifact;
  return manifest;
}), "utf8");
writeFileSync(qaCleanWalletNoReceiptManifest, withQaArtifact(qaValidStrictManifest, qaCleanWalletNoReceiptArtifact, (manifest, artifact) => {
  manifest.wallet.cleanWalletFirstTx.evidencePath = artifact;
  return manifest;
}), "utf8");
writeFileSync(qaMobileNoDeviceManifest, withQaArtifact(qaValidStrictManifest, qaMobileNoDeviceArtifact, (manifest, artifact) => {
  manifest.wallet.mobileWeb3Browser.evidencePath = artifact;
  return manifest;
}), "utf8");
writeFileSync(qaMobileTouchOnlyManifest, withQaArtifact(qaValidStrictManifest, qaMobileTouchOnlyArtifact, (manifest, artifact) => {
  manifest.wallet.mobileWeb3Browser.evidencePath = artifact;
  return manifest;
}), "utf8");
writeFileSync(qaSharedGroupArtifactManifest, withQaArtifact(qaValidStrictManifest, qaWalletArtifact, (manifest, artifact) => {
  for (const check of Object.values(manifest.failureStateUx)) check.evidencePath = artifact;
  return manifest;
}), "utf8");
writeFileSync(qaFutureTimestampManifest, withQaArtifact(qaValidStrictManifest, qaWalletArtifact, (manifest) => {
  for (const section of Object.values(manifest)) {
    if (!section || typeof section !== "object" || Array.isArray(section)) continue;
    for (const check of Object.values(section)) {
      if (check && typeof check === "object" && !Array.isArray(check) && "checkedAt" in check) {
        check.checkedAt = "2999-01-01T00:00:00.000Z";
      }
    }
  }
  return manifest;
}), "utf8");
writeFileSync(qaUnsafeTargetChainManifest, withQaArtifact(qaValidStrictManifest, qaWalletArtifact, (manifest) => {
  manifest.targetChainId = "9999999999999999";
  return manifest;
}), "utf8");
writeFileSync(qaDirectoryArtifactManifest, withQaArtifact(qaValidStrictManifest, qaDirectoryArtifact, (manifest, artifact) => {
  manifest.wallet.privyAllowedOrigins.evidencePath = artifact;
  return manifest;
}), "utf8");
writeFileSync(qaMissingSecurityScanManifest, withQaArtifact(qaValidStrictManifest, qaWalletArtifact, (manifest) => {
  delete manifest.securityScan;
  return manifest;
}), "utf8");
writeFileSync(qaWrongCandidateRevisionManifest, withQaArtifact(qaValidStrictManifest, qaWalletArtifact, (manifest) => {
  manifest.securityScan.candidateRevision = "b".repeat(40);
  return manifest;
}), "utf8");
writeFileSync(qaWrongScanManifestDigestManifest, withQaArtifact(qaValidStrictManifest, qaWalletArtifact, (manifest) => {
  manifest.securityScan.manifestSha256 = "0".repeat(64);
  return manifest;
}), "utf8");
writeFileSync(qaUnsealedSecurityScanManifest, withQaArtifact(qaValidStrictManifest, qaWalletArtifact, (manifest) => {
  manifest.securityScan.bundlePath = qaUnsealedSecurityScan.bundlePath;
  manifest.securityScan.manifestSha256 = qaUnsealedSecurityScan.manifestSha256;
  return manifest;
}), "utf8");
writeFileSync(qaStaleSecurityScanManifest, withQaArtifact(qaValidStrictManifest, qaWalletArtifact, (manifest) => {
  manifest.securityScan.bundlePath = qaStaleSecurityScan.bundlePath;
  manifest.securityScan.manifestSha256 = qaStaleSecurityScan.manifestSha256;
  manifest.securityScan.attestation = signSecurityAttestation(qaStaleSecurityScan);
  return manifest;
}), "utf8");
writeFileSync(qaExpiredSecurityAttestationManifest, withQaArtifact(qaValidStrictManifest, qaWalletArtifact, (manifest) => {
  manifest.securityScan.bundlePath = qaExpiringSecurityScan.bundlePath;
  manifest.securityScan.manifestSha256 = qaExpiringSecurityScan.manifestSha256;
  manifest.securityScan.attestation = signSecurityAttestation(qaExpiringSecurityScan, qaReviewerKeyPair, {
    signedAt: new Date(qaNow - (23 * 60 + 54) * 60 * 1000).toISOString(),
    expiresAt: new Date(qaNow - 60 * 1000).toISOString(),
  });
  return manifest;
}), "utf8");
writeFileSync(qaCommitModeSecurityScanManifest, withQaArtifact(qaValidStrictManifest, qaWalletArtifact, (manifest) => {
  manifest.securityScan.bundlePath = qaCommitModeSecurityScan.bundlePath;
  manifest.securityScan.manifestSha256 = qaCommitModeSecurityScan.manifestSha256;
  manifest.securityScan.attestation = signSecurityAttestation(qaCommitModeSecurityScan);
  return manifest;
}), "utf8");
writeFileSync(qaCustomInventorySecurityScanManifest, withQaArtifact(qaValidStrictManifest, qaWalletArtifact, (manifest) => {
  manifest.securityScan.bundlePath = qaCustomInventorySecurityScan.bundlePath;
  manifest.securityScan.manifestSha256 = qaCustomInventorySecurityScan.manifestSha256;
  manifest.securityScan.attestation = signSecurityAttestation(qaCustomInventorySecurityScan);
  return manifest;
}), "utf8");
writeFileSync(qaDeepRepositorySecurityScanManifest, withQaArtifact(qaValidStrictManifest, qaWalletArtifact, (manifest) => {
  manifest.securityScan.bundlePath = qaDeepRepositorySecurityScan.bundlePath;
  manifest.securityScan.manifestSha256 = qaDeepRepositorySecurityScan.manifestSha256;
  manifest.securityScan.attestation = signSecurityAttestation(qaDeepRepositorySecurityScan);
  return manifest;
}), "utf8");
writeFileSync(qaArtifactDigestMismatchManifest, withQaArtifact(qaValidStrictManifest, qaWalletArtifact, (manifest) => {
  manifest.securityScan.bundlePath = qaDigestMismatchSecurityScan.bundlePath;
  manifest.securityScan.manifestSha256 = qaDigestMismatchSecurityScan.manifestSha256;
  return manifest;
}), "utf8");
writeFileSync(qaOpenMediumSecurityFindingManifest, withQaArtifact(qaValidStrictManifest, qaWalletArtifact, (manifest) => {
  manifest.securityScan.bundlePath = qaOpenMediumSecurityScan.bundlePath;
  manifest.securityScan.manifestSha256 = qaOpenMediumSecurityScan.manifestSha256;
  return manifest;
}), "utf8");
writeFileSync(qaUnsignedSecurityScanManifest, withQaArtifact(qaValidStrictManifest, qaWalletArtifact, (manifest) => {
  delete manifest.securityScan.attestation;
  return manifest;
}), "utf8");
writeFileSync(qaSelfAuthoredSecurityScanManifest, withQaArtifact(qaValidStrictManifest, qaWalletArtifact, (manifest) => {
  manifest.securityScan.attestation = {
    ...signSecurityAttestation(qaValidSecurityScan, qaSelfAuthoredKeyPair),
    publicKeySpkiBase64: qaSelfAuthoredPublicKeyBytes.toString("base64"),
  };
  return manifest;
}), "utf8");
writeFileSync(qaTamperedSecurityAttestationManifest, withQaArtifact(qaValidStrictManifest, qaWalletArtifact, (manifest) => {
  manifest.securityScan.bundlePath = qaAlternateValidSecurityScan.bundlePath;
  manifest.securityScan.manifestSha256 = qaAlternateValidSecurityScan.manifestSha256;
  return manifest;
}), "utf8");
const signoffEnvLog = join(tmp, "signoff-env.log");
const signoffFailedEnvLog = join(tmp, "signoff-env-failed.log");
const signoffChainLog = join(tmp, "signoff-chain.log");
const signoffOwnerLog = join(tmp, "signoff-owner.log");
const signoffRandomnessLog = join(tmp, "signoff-randomness.log");
const signoffAppIndexerLog = join(tmp, "signoff-app-indexer.log");
const signoffWeakChainLog = join(tmp, "signoff-weak-chain.log");
const signoffDirectoryArtifact = mkdtempSync(join(tmp, "signoff-directory-artifact.log-"));
const signoffDirectoryArtifactManifest = join(tmp, "signoff-directory-artifact.json");
writeFileSync(signoffEnvLog, "Summary: all checked env gates passed. proof:mainnet contract env chainId deploy owner Safe multisig direct owner read randomness decision accepted-risk operator sign-off app indexer chain comparison jackpot safetyPool deposits rewards rebates resolve.", "utf8");
writeFileSync(signoffFailedEnvLog, "Summary: 30 env gate(s) missing or failing.", "utf8");
writeFileSync(signoffChainLog, "Summary: synthetic proof:chain direct-chain proof output owner direct owner read jackpot safetyPool deposits rewards rebates resolve chain comparison.", "utf8");
writeFileSync(signoffOwnerLog, "Summary: direct-chain owner read proof; owner Safe multisig governance verified.", "utf8");
writeFileSync(signoffRandomnessLog, "Summary: randomness decision accepted-risk operator sign-off proof recorded.", "utf8");
writeFileSync(signoffAppIndexerLog, "Summary: app indexer chain comparison proof for jackpot safetyPool deposits rewards rebates resolve.", "utf8");
writeFileSync(signoffWeakChainLog, "Summary: synthetic proof:chain direct-chain owner read only.", "utf8");
const signoffMissingArtifact = join(tmp, "missing-signoff-env.log");
const signoffMissingArtifactManifest = join(tmp, "signoff-missing-local-artifact.json");
const signoffIrrelevantArtifact = join(tmp, "irrelevant-signoff-evidence.log");
const signoffIrrelevantEnvManifest = join(tmp, "signoff-irrelevant-env-artifact.json");
const signoffIrrelevantOwnerManifest = join(tmp, "signoff-irrelevant-owner-artifact.json");
const signoffIrrelevantRandomnessManifest = join(tmp, "signoff-irrelevant-randomness-artifact.json");
const signoffIrrelevantChainManifest = join(tmp, "signoff-irrelevant-chain-artifact.json");
const signoffIrrelevantAppIndexerManifest = join(tmp, "signoff-irrelevant-app-indexer-artifact.json");
const signoffSharedSectionArtifactManifest = join(tmp, "signoff-shared-section-artifact.json");
const signoffFutureTimestampManifest = join(tmp, "signoff-future-timestamp.json");
const signoffUnsafeCheckedEpochManifest = join(tmp, "signoff-unsafe-checked-epoch.json");
const signoffValidStrictManifestPath = join(tmp, "signoff-valid-strict.json");
writeFileSync(signoffIrrelevantArtifact, "Summary: archived generic operator note with no launch proof markers.", "utf8");
const signoffAddress = "0x1111111111111111111111111111111111111111";
const signoffTx = "0x1111111111111111111111111111111111111111111111111111111111111111";
const signoffComparison = (key) => ({
  matches: true,
  directChainEvidence: `artifact: ${signoffChainLog} direct ${key}`,
  appOrIndexerEvidence: `artifact: ${signoffAppIndexerLog} app ${key}`,
  checkedEpochs: [1],
  checkedAt: "2026-07-09T00:00:00.000Z",
});
writeFileSync(
  signoffMissingArtifactManifest,
  JSON.stringify({
    contractEnv: {
      network: "mainnet",
      chainId: 59144,
      contractAddress: signoffAddress,
      tokenAddress: signoffAddress,
      publicContractAddress: signoffAddress,
      keeperContractAddress: signoffAddress,
      deployBlock: "1",
      publicDeployBlock: "1",
      indexerStartBlock: "1",
      finalityBlocks: "1",
      keeperMatchesPublic: true,
      indexerStartBlockMatchesDeployBlock: true,
      finalityBlocksPositive: true,
      protectedBetsRequired: true,
      checkedAt: "2026-07-09T00:00:00.000Z",
      evidencePath: signoffMissingArtifact,
    },
    ownership: {
      ownerAddress: signoffAddress,
      safeOrMultisig: true,
      directOwnerReadMatches: true,
      directOwnerReadEvidence: `artifact: ${signoffOwnerLog}`,
      governanceRecordEvidence: "https://safe.linea.build/tx/0x1111111111111111111111111111111111111111",
      proofTx: signoffTx,
      checkedAt: "2026-07-09T00:00:00.000Z",
    },
    randomness: {
      decision: "accepted-risk",
      operator: "launch-operator",
      signedAt: "2026-07-09T00:00:00.000Z",
      riskAcceptedByOperator: true,
      evidence: `artifact: ${signoffRandomnessLog}`,
    },
    chainComparison: {
      jackpot: signoffComparison("jackpot"),
      safetyPool: signoffComparison("safetyPool"),
      deposits: signoffComparison("deposits"),
      rewards: signoffComparison("rewards"),
      rebates: signoffComparison("rebates"),
      resolve: signoffComparison("resolve"),
    },
  }),
  "utf8",
);
const signoffValidStrictManifest = readProofDraftJson(signoffMissingArtifactManifest);
signoffValidStrictManifest.contractEnv.evidencePath = signoffEnvLog;
writeFileSync(signoffValidStrictManifestPath, JSON.stringify(signoffValidStrictManifest), "utf8");
const withSignoffArtifact = (mutator) => {
  const manifest = JSON.parse(JSON.stringify(signoffValidStrictManifest));
  mutator(manifest);
  return JSON.stringify(manifest);
};
writeFileSync(signoffIrrelevantEnvManifest, withSignoffArtifact((manifest) => {
  manifest.contractEnv.evidencePath = signoffIrrelevantArtifact;
}), "utf8");
writeFileSync(signoffIrrelevantOwnerManifest, withSignoffArtifact((manifest) => {
  manifest.ownership.directOwnerReadEvidence = `artifact: ${signoffIrrelevantArtifact}`;
}), "utf8");
writeFileSync(signoffIrrelevantRandomnessManifest, withSignoffArtifact((manifest) => {
  manifest.randomness.evidence = `artifact: ${signoffIrrelevantArtifact}`;
}), "utf8");
writeFileSync(signoffIrrelevantChainManifest, withSignoffArtifact((manifest) => {
  manifest.chainComparison.jackpot.directChainEvidence = `artifact: ${signoffIrrelevantArtifact}`;
  manifest.chainComparison.jackpot.appOrIndexerEvidence = `artifact: ${signoffIrrelevantArtifact}`;
}), "utf8");
writeFileSync(signoffIrrelevantAppIndexerManifest, withSignoffArtifact((manifest) => {
  manifest.chainComparison.jackpot.appOrIndexerEvidence = `artifact: ${signoffIrrelevantArtifact}`;
}), "utf8");
writeFileSync(signoffSharedSectionArtifactManifest, withSignoffArtifact((manifest) => {
  manifest.randomness.evidence = `artifact: ${signoffEnvLog}`;
}), "utf8");
writeFileSync(signoffFutureTimestampManifest, withSignoffArtifact((manifest) => {
  manifest.contractEnv.checkedAt = "2999-01-01T00:00:00.000Z";
  manifest.ownership.checkedAt = "2999-01-01T00:00:00.000Z";
  manifest.randomness.signedAt = "2999-01-01T00:00:00.000Z";
  for (const value of Object.values(manifest.chainComparison)) {
    value.checkedAt = "2999-01-01T00:00:00.000Z";
  }
}), "utf8");
writeFileSync(signoffUnsafeCheckedEpochManifest, withSignoffArtifact((manifest) => {
  manifest.chainComparison.jackpot.checkedEpochs = ["9999999999999999"];
}), "utf8");
writeFileSync(signoffDirectoryArtifactManifest, withSignoffArtifact((manifest) => {
  manifest.contractEnv.evidencePath = signoffDirectoryArtifact;
}), "utf8");
const signoffEnvPatch = {
  LINEA_NETWORK: "mainnet",
  NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
  LINEA_CHAIN_ID: "59144",
  NEXT_PUBLIC_LINEA_CHAIN_ID: "59144",
  NEXT_PUBLIC_CONTRACT_ADDRESS: signoffAddress,
  KEEPER_CONTRACT_ADDRESS: signoffAddress,
  NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: signoffAddress,
  NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
  INDEXER_START_BLOCK: "1",
  INDEXER_FINALITY_BLOCKS: "1",
};
const hostHealthLog = join(tmp, "host-health-prod.log");
const hostLoadLog = join(tmp, "host-load-http.log");
const hostProcessEvidence = join(tmp, "host-process-model.log");
const hostDirectoryArtifact = mkdtempSync(join(tmp, "host-directory-artifact.log-"));
const hostDirectoryArtifactManifest = join(tmp, "host-directory-artifact.json");
const hostPersistenceEvidence = join(tmp, "host-persistence.log");
const hostExternalDbPath = join(tmp, "host-prod.sqlite");
const hostHealthMissingBaseLog = join(tmp, "host-health-missing-base.log");
const hostMissingHealthLogPath = join(tmp, "missing-host-health-prod.log");
const hostLoadMissingBaseLog = join(tmp, "host-load-missing-base.log");
const hostHealthCredentialedBaseLog = join(tmp, "host-health-credentialed-base.log");
const hostHealthMalformedFinalityLog = join(tmp, "host-health-malformed-finality.log");
const hostHealthUnsafeFinalityLog = join(tmp, "host-health-unsafe-finality.log");
const hostLoadCredentialedBaseLog = join(tmp, "host-load-credentialed-base.log");
writeFileSync(hostHealthLog, "[prod-health] OK\nbase=https://playlore.xyz runtime=ok dataSync=ok effectiveLagBlocks=2 finalityLagBlocks=2\n", "utf8");
writeFileSync(hostLoadLog, "Load base URL: https://canary.playlore.xyz\nConcurrency: 10; client IPs: 10; duration: 60000ms; timeout: 10000ms\nTOTAL count= 100 fail= 0 err= 0.00% p50= 100ms p95= 400ms p99= 700ms\n", "utf8");
writeFileSync(hostProcessEvidence, "pm2 lore-site online\npm2 lore-bot online\npm2 lore-indexer online\n", "utf8");
writeFileSync(hostPersistenceEvidence, "persistent DB proof: LORE_DB_PATH C:\\external\\lore.sqlite restart survived reboot survived sqlite database path verified\n", "utf8");
writeFileSync(hostExternalDbPath, "synthetic external host db path marker", "utf8");
writeFileSync(hostHealthMissingBaseLog, "[prod-health] OK\nruntime=ok dataSync=ok effectiveLagBlocks=2 finalityLagBlocks=2\n", "utf8");
writeFileSync(hostLoadMissingBaseLog, "Concurrency: 10; client IPs: 10; duration: 60000ms; timeout: 10000ms\nTOTAL count= 100 fail= 0 err= 0.00% p50= 100ms p95= 400ms p99= 700ms\n", "utf8");
writeFileSync(hostHealthCredentialedBaseLog, "[prod-health] OK\nbase=https://user:pass@playlore.xyz runtime=ok dataSync=ok effectiveLagBlocks=2 finalityLagBlocks=2\n", "utf8");
writeFileSync(hostHealthMalformedFinalityLog, "[prod-health] OK\nbase=https://playlore.xyz runtime=ok dataSync=ok effectiveLagBlocks=2 finalityLagBlocks=2e1\n", "utf8");
writeFileSync(hostHealthUnsafeFinalityLog, "[prod-health] OK\nbase=https://playlore.xyz runtime=ok dataSync=ok effectiveLagBlocks=2 finalityLagBlocks=9999999999999999\n", "utf8");
writeFileSync(hostLoadCredentialedBaseLog, "Load base URL: https://user:pass@canary.playlore.xyz\nConcurrency: 10; client IPs: 10; duration: 60000ms; timeout: 10000ms\nTOTAL count= 100 fail= 0 err= 0.00% p50= 100ms p95= 400ms p99= 700ms\n", "utf8");
const hostMissingArtifact = join(tmp, "missing-host-process-model.log");
const hostMissingArtifactManifest = join(tmp, "host-missing-local-artifact.json");
const hostProcess = (name, command, evidencePath) => ({
  status: "running",
  running: true,
  supervised: true,
  command,
  checkedAt: "2026-07-09T00:00:00.000Z",
  evidencePath,
});
writeFileSync(
  hostMissingArtifactManifest,
  JSON.stringify({
    origin: "https://playlore.xyz",
    hostType: "production",
    processModel: {
      supervisor: "pm2",
      "lore-site": hostProcess("lore-site", "npm.cmd run start", hostMissingArtifact),
      "lore-bot": hostProcess("lore-bot", "npm.cmd run bot", hostProcessEvidence),
      "lore-indexer": hostProcess("lore-indexer", "npm.cmd run indexer", hostProcessEvidence),
    },
    persistentDb: {
      absolutePathOutsideRepo: true,
      restartSurvived: true,
      rebootSurvived: true,
      path: hostExternalDbPath,
      checkedAt: "2026-07-09T00:00:00.000Z",
      evidencePath: hostProcessEvidence,
    },
    healthProd: {
      status: "ok",
      command: "npm.cmd run health:prod",
      url: "https://playlore.xyz",
      runtimeHealthPassed: true,
      dataSyncHealthPassed: true,
      diagnosticsAuthPassed: true,
      finalityLagChecked: true,
      jackpotRowsChecked: true,
      timestamp: "2026-07-09T00:00:00.000Z",
      evidencePath: hostHealthLog,
      summary: "[prod-health] OK base=https://playlore.xyz runtime=ok dataSync=ok finalityLagBlocks=2",
    },
    loadHttp: {
      status: "ok",
      command: "npm.cmd run load:http",
      url: "https://canary.playlore.xyz",
      hostType: "canary",
      requestCount: 100,
      errorRate: 0,
      maxErrorRate: 0.01,
      p95Ms: 400,
      maxP95Ms: 1000,
      durationMs: 60000,
      concurrency: 10,
      timestamp: "2026-07-09T00:00:00.000Z",
      evidencePath: hostLoadLog,
      summary: "Load base URL: https://canary.playlore.xyz TOTAL count=100 fail=0 err=0.00% p95=400ms",
    },
  }),
  "utf8",
);
const hostIrrelevantProcessEvidence = join(tmp, "host-irrelevant-process-model.log");
const hostIrrelevantProcessManifest = join(tmp, "host-irrelevant-process-model.json");
writeFileSync(hostIrrelevantProcessEvidence, "pm2 unrelated-service online\n", "utf8");
writeFileSync(
  hostIrrelevantProcessManifest,
  JSON.stringify({
    origin: "https://playlore.xyz",
    hostType: "production",
    processModel: {
      supervisor: "pm2",
      "lore-site": hostProcess("lore-site", "npm.cmd run start", hostIrrelevantProcessEvidence),
      "lore-bot": hostProcess("lore-bot", "npm.cmd run bot", hostIrrelevantProcessEvidence),
      "lore-indexer": hostProcess("lore-indexer", "npm.cmd run indexer", hostIrrelevantProcessEvidence),
    },
    persistentDb: {
      absolutePathOutsideRepo: true,
      restartSurvived: true,
      rebootSurvived: true,
      path: hostExternalDbPath,
      checkedAt: "2026-07-09T00:00:00.000Z",
      evidencePath: hostProcessEvidence,
    },
    healthProd: {
      status: "ok",
      command: "npm.cmd run health:prod",
      url: "https://playlore.xyz",
      runtimeHealthPassed: true,
      dataSyncHealthPassed: true,
      diagnosticsAuthPassed: true,
      finalityLagChecked: true,
      jackpotRowsChecked: true,
      timestamp: "2026-07-09T00:00:00.000Z",
      evidencePath: hostHealthLog,
      summary: "[prod-health] OK base=https://playlore.xyz runtime=ok dataSync=ok finalityLagBlocks=2",
    },
    loadHttp: {
      status: "ok",
      command: "npm.cmd run load:http",
      url: "https://canary.playlore.xyz",
      hostType: "canary",
      requestCount: 100,
      errorRate: 0,
      maxErrorRate: 0.01,
      p95Ms: 400,
      maxP95Ms: 1000,
      durationMs: 60000,
      concurrency: 10,
      timestamp: "2026-07-09T00:00:00.000Z",
      evidencePath: hostLoadLog,
      summary: "Load base URL: https://canary.playlore.xyz TOTAL count=100 fail=0 err=0.00% p95=400ms",
    },
  }),
  "utf8",
);
const hostIrrelevantArtifact = join(tmp, "host-irrelevant-evidence.log");
const hostSharedSectionArtifact = join(tmp, "host-shared-section-evidence.log");
const hostIrrelevantPersistentManifest = join(tmp, "host-irrelevant-persistent-artifact.json");
const hostIrrelevantHealthManifest = join(tmp, "host-irrelevant-health-artifact.json");
const hostIrrelevantLoadManifest = join(tmp, "host-irrelevant-load-artifact.json");
const hostSharedSectionArtifactManifest = join(tmp, "host-shared-section-artifact.json");
const hostFutureTimestampManifest = join(tmp, "host-future-timestamp.json");
const hostCredentialedOriginManifest = join(tmp, "host-credentialed-origin.json");
writeFileSync(hostIrrelevantArtifact, "Summary: generic archived note without launch proof markers.\n", "utf8");
writeFileSync(hostSharedSectionArtifact, "pm2 lore-site online\npm2 lore-bot online\npm2 lore-indexer online\npersistent DB proof: LORE_DB_PATH C:\\external\\lore.sqlite restart survived reboot survived sqlite database path verified\n[prod-health] OK base=https://playlore.xyz runtime=ok dataSync=ok finalityLagBlocks=2\nLoad base URL: https://canary.playlore.xyz\nTOTAL count=100 fail=0 err=0.00% p95=400ms\n", "utf8");
const hostValidStrictManifest = readProofDraftJson(hostMissingArtifactManifest);
hostValidStrictManifest.processModel["lore-site"].evidencePath = hostProcessEvidence;
hostValidStrictManifest.persistentDb.evidencePath = hostPersistenceEvidence;
hostValidStrictManifest.externalRateLimit = {
  status: "ok",
  webReplicaCount: 2,
  distinctReplicas: 2,
  failClosed: true,
  sharedBucketVerified: true,
  checkedAt: "2026-07-09T00:00:00.000Z",
  evidence: "npm.cmd run load:http redacted shared rate-limit bucket proof across replica-a and replica-b",
};
const hostValidStrictManifestPath = join(tmp, "host-proof.valid.json");
writeFileSync(hostValidStrictManifestPath, JSON.stringify(hostValidStrictManifest), "utf8");
const withHostArtifact = (mutator) => {
  const manifest = JSON.parse(JSON.stringify(hostValidStrictManifest));
  mutator(manifest);
  return JSON.stringify(manifest);
};
writeFileSync(hostIrrelevantPersistentManifest, withHostArtifact((manifest) => {
  manifest.persistentDb.evidencePath = hostIrrelevantArtifact;
}), "utf8");
writeFileSync(hostIrrelevantHealthManifest, withHostArtifact((manifest) => {
  manifest.healthProd.evidencePath = hostIrrelevantArtifact;
}), "utf8");
writeFileSync(hostIrrelevantLoadManifest, withHostArtifact((manifest) => {
  manifest.loadHttp.evidencePath = hostIrrelevantArtifact;
}), "utf8");
writeFileSync(hostSharedSectionArtifactManifest, withHostArtifact((manifest) => {
  manifest.processModel["lore-site"].evidencePath = hostSharedSectionArtifact;
  manifest.processModel["lore-bot"].evidencePath = hostSharedSectionArtifact;
  manifest.processModel["lore-indexer"].evidencePath = hostSharedSectionArtifact;
  manifest.persistentDb.evidencePath = hostSharedSectionArtifact;
  manifest.healthProd.evidencePath = hostSharedSectionArtifact;
  manifest.loadHttp.evidencePath = hostSharedSectionArtifact;
}), "utf8");
writeFileSync(hostFutureTimestampManifest, withHostArtifact((manifest) => {
  for (const [name, value] of Object.entries(manifest.processModel)) {
    if (name !== "supervisor" && value && typeof value === "object") {
      value.checkedAt = "2999-01-01T00:00:00.000Z";
    }
  }
  manifest.persistentDb.checkedAt = "2999-01-01T00:00:00.000Z";
  manifest.healthProd.timestamp = "2999-01-01T00:00:00.000Z";
  manifest.loadHttp.timestamp = "2999-01-01T00:00:00.000Z";
  manifest.externalRateLimit.checkedAt = "2999-01-01T00:00:00.000Z";
}), "utf8");
writeFileSync(hostCredentialedOriginManifest, withHostArtifact((manifest) => {
  manifest.origin = "https://user:pass@playlore.xyz";
}), "utf8");
writeFileSync(hostDirectoryArtifactManifest, withHostArtifact((manifest) => {
  manifest.processModel["lore-site"].evidencePath = hostDirectoryArtifact;
}), "utf8");
const indexerLog = join(tmp, "indexer-once.log");
const indexerRepoDbLog = join(tmp, "indexer-repo-db.log");
const indexerHealthLog = join(tmp, "indexer-health-prod.log");
const indexerHealthMissingBaseLog = join(tmp, "indexer-health-missing-base.log");
const indexerHealthCredentialedBaseLog = join(tmp, "indexer-health-credentialed-base.log");
const indexerHealthMalformedFinalityLog = join(tmp, "indexer-health-malformed-finality.log");
const indexerChainSnapshot = join(tmp, "chain-proof-snapshot.json");
const indexerChainSnapshotMissingGeneratedAt = join(tmp, "chain-proof-missing-generated-at.json");
const indexerChainSnapshotTooFewEpochs = join(tmp, "chain-proof-too-few-epochs.json");
const indexerChainSnapshotCredentialedRpc = join(tmp, "chain-proof-credentialed-rpc.json");
const indexerChainSnapshotMalformedChainId = join(tmp, "chain-proof-malformed-chain-id.json");
const indexerChainSnapshotNonObject = join(tmp, "chain-proof-non-object.json");
const indexerChainSnapshotMalformed = join(tmp, "chain-proof-malformed.json");
const indexerMissingLogPath = join(tmp, "missing-indexer-once.log");
const indexerDirectoryArtifact = mkdtempSync(join(tmp, "indexer-directory-artifact.log-"));
const indexerDirectoryArtifactManifest = join(tmp, "indexer-directory-artifact.json");
const indexerStrictDbPath = join(makeTempDir("lore-proof-indexer-strict-db-"), "indexer.sqlite");
writeFileSync(indexerLog, "[indexer] SQLite path: C:\\external\\lore.sqlite\n[indexer] Contract: 0x1111111111111111111111111111111111111111\n[indexer] Deploy block: 1\n[indexer] Start block: 1\n[indexer] Finality blocks: 1\n[indexer] Scanning blocks 1..10\n[indexer] Finished runOnce\n", "utf8");
writeFileSync(indexerRepoDbLog, `[indexer] SQLite path: ${join(process.cwd(), "repo-indexer.sqlite")}\n[indexer] Contract: 0x1111111111111111111111111111111111111111\n[indexer] Deploy block: 1\n[indexer] Start block: 1\n[indexer] Finality blocks: 1\n[indexer] Scanning blocks 1..10\n[indexer] Finished runOnce\n`, "utf8");
writeFileSync(indexerHealthLog, "[prod-health] OK\nbase=https://playlore.xyz runtime=ok dataSync=ok effectiveLagBlocks=1 finalityLagBlocks=1\n", "utf8");
writeFileSync(indexerHealthMissingBaseLog, "[prod-health] OK\nruntime=ok dataSync=ok effectiveLagBlocks=1 finalityLagBlocks=1\n", "utf8");
writeFileSync(indexerHealthCredentialedBaseLog, "[prod-health] OK\nbase=https://user:pass@playlore.xyz runtime=ok dataSync=ok effectiveLagBlocks=1 finalityLagBlocks=1\n", "utf8");
writeFileSync(indexerHealthMalformedFinalityLog, "[prod-health] OK\nbase=https://playlore.xyz runtime=ok dataSync=ok effectiveLagBlocks=1 finalityLagBlocks=1e2\n", "utf8");
const indexerHealthUnsafeFinalityLog = join(tmp, "indexer-health-unsafe-finality.log");
writeFileSync(indexerHealthUnsafeFinalityLog, "[prod-health] OK\nbase=https://playlore.xyz runtime=ok dataSync=ok effectiveLagBlocks=1 finalityLagBlocks=9999999999999999\n", "utf8");
{
  const db = new DatabaseSync(indexerStrictDbPath);
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO meta (key, value) VALUES ('lastIndexedBlock', '1'), ('currentEpoch', '1');
    CREATE TABLE epochs (id INTEGER PRIMARY KEY);
    CREATE TABLE scoped_epochs (id INTEGER PRIMARY KEY);
    CREATE TABLE bets (id INTEGER PRIMARY KEY);
    CREATE TABLE scoped_bets (id INTEGER PRIMARY KEY);
    CREATE TABLE jackpots (id INTEGER PRIMARY KEY);
    CREATE TABLE scoped_jackpots (id INTEGER PRIMARY KEY);
    CREATE TABLE reward_claims (id INTEGER PRIMARY KEY);
    CREATE TABLE scoped_reward_claims (id INTEGER PRIMARY KEY);
    CREATE TABLE protocol_fee_flushes (id INTEGER PRIMARY KEY);
    CREATE TABLE scoped_protocol_fee_flushes (id INTEGER PRIMARY KEY);
    CREATE TABLE scoped_indexer_events (id INTEGER PRIMARY KEY);
  `);
  db.close();
}
writeFileSync(indexerChainSnapshot, JSON.stringify({ generatedAt: "2026-07-09T00:00:00.000Z", expectedChainId: 59144, rpcChainId: 59144, rpcSource: "redacted-mainnet-rpc", contractAddress: "0x1111111111111111111111111111111111111111", epochs: [{ epoch: 1 }], comparisonProof: "jackpot deposits rewards rebates latestEpochs direct-chain chain comparison indexer proof" }), "utf8");
const indexerMissingArtifact = join(tmp, "missing-indexer-once.log");
const indexerMissingArtifactManifest = join(tmp, "indexer-missing-local-artifact.json");
const indexerIrrelevantArtifact = join(tmp, "indexer-irrelevant-evidence.log");
const indexerSharedSectionArtifact = join(tmp, "indexer-shared-section-evidence.log");
const indexerIrrelevantDryRunManifest = join(tmp, "indexer-irrelevant-dry-run-artifact.json");
const indexerIrrelevantFinalityManifest = join(tmp, "indexer-irrelevant-finality-artifact.json");
const indexerIrrelevantSnapshotManifest = join(tmp, "indexer-irrelevant-snapshot-artifact.json");
const indexerIrrelevantComparisonManifest = join(tmp, "indexer-irrelevant-comparison-artifact.json");
const indexerSharedSectionArtifactManifest = join(tmp, "indexer-shared-section-artifact.json");
const indexerUnsafeFinalityArtifactManifest = join(tmp, "indexer-unsafe-finality-artifact.json");
const indexerFutureTimestampManifest = join(tmp, "indexer-future-timestamp.json");
const indexerUnsafeCheckedEpochManifest = join(tmp, "indexer-unsafe-checked-epoch.json");
writeFileSync(indexerIrrelevantArtifact, "Summary: generic archived note without indexer or chain proof markers.\n", "utf8");
writeFileSync(indexerSharedSectionArtifact, "[indexer] SQLite path: C:\\external\\lore.sqlite\n[indexer] Contract: 0x1111111111111111111111111111111111111111\n[indexer] Deploy block: 1\n[indexer] Start block: 1\n[indexer] Finality blocks: 1\n[indexer] Finished runOnce\n[prod-health] OK base=https://playlore.xyz runtime=ok dataSync=ok finalityLagBlocks=1\ngeneratedAt rpcChainId contractAddress direct-chain chain comparison indexer proof jackpot deposits rewards rebates latestEpochs\n", "utf8");
const indexerComparison = (key) => ({
  matches: true,
  checkedEpochs: [1],
  checkedAt: "2026-07-09T00:00:00.000Z",
  evidence: `artifact: ${indexerChainSnapshot} for ${key}`,
});
writeFileSync(
  indexerMissingArtifactManifest,
  JSON.stringify({
    dryRun: {
      status: "verified",
      command: "npm.cmd run indexer:once",
      freshDb: true,
      fromDeployBlock: true,
      dbPath: hostExternalDbPath,
      startBlock: 1,
      deployBlock: 1,
      timestamp: "2026-07-09T00:00:00.000Z",
      evidencePath: indexerMissingArtifact,
      summary: "[indexer] Deploy block: 1\n[indexer] Start block: 1\n[indexer] Finished runOnce",
    },
    finality: {
      finalityBlocksPositive: true,
      finalityBlocks: 1,
      dataSyncHealthFinalityAware: true,
      checkedAt: "2026-07-09T00:00:00.000Z",
      evidencePath: indexerHealthLog,
      summary: "[prod-health] OK base=https://playlore.xyz runtime=ok dataSync=ok finalityLagBlocks=1",
    },
    chainSnapshot: {
      path: indexerChainSnapshot,
      expectedChainId: 59144,
      rpcChainId: 59144,
      rpcChainIdMatches: true,
      rpcSource: "redacted-mainnet-rpc",
      contractAddress: "0x1111111111111111111111111111111111111111",
      contractAddressMatches: true,
      checkedAt: "2026-07-09T00:00:00.000Z",
      evidence: `artifact: ${indexerChainSnapshot}`,
    },
    chainComparison: {
      jackpot: indexerComparison("jackpot"),
      deposits: indexerComparison("deposits"),
      rewards: indexerComparison("rewards"),
      rebates: indexerComparison("rebates"),
      latestEpochs: indexerComparison("latestEpochs"),
    },
  }),
  "utf8",
);
const indexerValidStrictManifest = readProofDraftJson(indexerMissingArtifactManifest);
indexerValidStrictManifest.dryRun.dbPath = indexerStrictDbPath;
indexerValidStrictManifest.dryRun.evidencePath = indexerLog;
const indexerValidStrictManifestPath = join(tmp, "indexer-proof.valid.json");
writeFileSync(indexerValidStrictManifestPath, JSON.stringify(indexerValidStrictManifest), "utf8");
const withIndexerArtifact = (mutator) => {
  const manifest = JSON.parse(JSON.stringify(indexerValidStrictManifest));
  mutator(manifest);
  return JSON.stringify(manifest);
};
writeFileSync(indexerIrrelevantDryRunManifest, withIndexerArtifact((manifest) => {
  manifest.dryRun.evidencePath = indexerIrrelevantArtifact;
}), "utf8");
writeFileSync(indexerIrrelevantFinalityManifest, withIndexerArtifact((manifest) => {
  manifest.finality.evidencePath = indexerIrrelevantArtifact;
}), "utf8");
writeFileSync(indexerUnsafeFinalityArtifactManifest, withIndexerArtifact((manifest) => {
  manifest.finality.evidencePath = indexerHealthUnsafeFinalityLog;
}), "utf8");
writeFileSync(indexerIrrelevantSnapshotManifest, withIndexerArtifact((manifest) => {
  manifest.chainSnapshot.path = indexerIrrelevantArtifact;
}), "utf8");
writeFileSync(indexerIrrelevantComparisonManifest, withIndexerArtifact((manifest) => {
  manifest.chainComparison.jackpot.evidence = `artifact: ${indexerIrrelevantArtifact}`;
}), "utf8");
writeFileSync(indexerSharedSectionArtifactManifest, withIndexerArtifact((manifest) => {
  manifest.dryRun.evidencePath = indexerSharedSectionArtifact;
  manifest.finality.evidencePath = indexerSharedSectionArtifact;
  manifest.chainSnapshot.path = indexerSharedSectionArtifact;
  manifest.chainSnapshot.evidence = `artifact: ${indexerSharedSectionArtifact}`;
}), "utf8");
writeFileSync(indexerFutureTimestampManifest, withIndexerArtifact((manifest) => {
  manifest.dryRun.timestamp = "2999-01-01T00:00:00.000Z";
  manifest.finality.checkedAt = "2999-01-01T00:00:00.000Z";
  manifest.chainSnapshot.checkedAt = "2999-01-01T00:00:00.000Z";
  for (const value of Object.values(manifest.chainComparison)) {
    value.checkedAt = "2999-01-01T00:00:00.000Z";
  }
}), "utf8");
writeFileSync(indexerUnsafeCheckedEpochManifest, withIndexerArtifact((manifest) => {
  manifest.chainComparison.jackpot.checkedEpochs = ["9999999999999999"];
}), "utf8");
writeFileSync(indexerDirectoryArtifactManifest, withIndexerArtifact((manifest) => {
  manifest.dryRun.evidencePath = indexerDirectoryArtifact;
}), "utf8");
writeFileSync(indexerChainSnapshotMissingGeneratedAt, JSON.stringify({ expectedChainId: 59144, rpcChainId: 59144, rpcSource: "redacted-mainnet-rpc", contractAddress: "0x1111111111111111111111111111111111111111", epochs: [{ epoch: 1 }] }), "utf8");
writeFileSync(indexerChainSnapshotTooFewEpochs, JSON.stringify({ generatedAt: "2026-07-09T00:00:00.000Z", expectedChainId: 59144, rpcChainId: 59144, rpcSource: "redacted-mainnet-rpc", contractAddress: "0x1111111111111111111111111111111111111111", epochs: [{ epoch: 1 }] }), "utf8");
writeFileSync(indexerChainSnapshotCredentialedRpc, JSON.stringify({ generatedAt: "2026-07-09T00:00:00.000Z", expectedChainId: 59144, rpcChainId: 59144, rpcSource: "https://user:pass@rpc.example.invalid/path?token=x#frag", contractAddress: "0x1111111111111111111111111111111111111111", epochs: [{ epoch: 1 }] }), "utf8");
writeFileSync(indexerChainSnapshotMalformedChainId, JSON.stringify({ generatedAt: "2026-07-09T00:00:00.000Z", expectedChainId: "59144.0", rpcChainId: "5.9144e4", rpcSource: "redacted-mainnet-rpc", contractAddress: "0x1111111111111111111111111111111111111111", epochs: [{ epoch: 1 }] }), "utf8");
writeFileSync(indexerChainSnapshotNonObject, "[]", "utf8");
writeFileSync(indexerChainSnapshotMalformed, "{", "utf8");
const monitoringAlertArtifact = join(tmp, "monitoring-alert-export.log");
const monitoringRecoveryArtifact = join(tmp, "monitoring-recovery-export.log");
const monitoringSharedAlertRecoveryArtifact = join(tmp, "monitoring-shared-alert-recovery-export.log");
const monitoringSharedSectionArtifact = join(tmp, "monitoring-shared-section-export.log");
const monitoringAlertTargetArtifact = join(tmp, "monitoring-alert-target-test.log");
const monitoringErrorEventArtifact = join(tmp, "error-tracking-test-event.log");
const monitoringDirectoryArtifact = makeTempDir("lore-proof-monitoring-artifact.log-");
const monitoringDirectoryArtifactManifest = join(tmp, "monitoring-directory-artifact.json");
writeFileSync(monitoringAlertArtifact, "ALERT synthetic fired monitor export\n", "utf8");
writeFileSync(monitoringRecoveryArtifact, "RECOVERY synthetic resolved monitor export\n", "utf8");
writeFileSync(monitoringSharedAlertRecoveryArtifact, "ALERT synthetic fired monitor export\nRECOVERY synthetic resolved monitor export\n", "utf8");
writeFileSync(monitoringSharedSectionArtifact, "ALERT synthetic fired monitor export\nRESEND EMAIL synthetic alert target test export delivered to recipient inbox\n", "utf8");
writeFileSync(monitoringAlertTargetArtifact, "RESEND EMAIL synthetic alert target test export delivered to recipient inbox\n", "utf8");
writeFileSync(monitoringErrorEventArtifact, "SENTRY synthetic error tracking test event\n", "utf8");
const monitoringMissingArtifact = join(tmp, "missing-monitoring-alert-export.log");
const monitoringMissingArtifactManifest = join(tmp, "monitoring-missing-local-artifact.json");
const monitoringKinds = [
  "health-prod",
  "data-sync",
  "stale-indexer-heartbeat",
  "indexer-lag",
  "bot-restart",
  "indexer-restart",
  "reverted-tx",
];
writeFileSync(
  monitoringMissingArtifactManifest,
  JSON.stringify({
    origin: "https://playlore.xyz",
    monitors: monitoringKinds.map((kind) => ({
      kind,
      enabled: true,
      provider: "synthetic-monitor",
      cadenceSeconds: kind === "health-prod" ? 60 : 120,
      url: kind === "health-prod" ? "https://playlore.xyz/api/health/runtime" : "https://playlore.xyz/api/health/data-sync",
      alertCondition: `${kind} synthetic alert condition`,
      evidencePath: kind === "health-prod" ? monitoringMissingArtifact : monitoringAlertArtifact,
      link: `artifact: ${kind === "health-prod" ? monitoringMissingArtifact : monitoringAlertArtifact}`,
      lastAlertTestAt: "2026-07-09T00:00:00.000Z",
      recoveryEvidencePath: monitoringRecoveryArtifact,
      recoveryLink: `artifact: ${monitoringRecoveryArtifact}`,
      lastRecoveryAt: "2026-07-09T00:01:00.000Z",
    })),
    alertTargets: [{
      name: "synthetic Resend email",
      kind: "email",
      recipient: "playlore88@gmail.com",
      sender: "alerts@playlore.xyz",
      senderDomain: "playlore.xyz",
      verified: true,
      lastTestAt: "2026-07-09T00:00:00.000Z",
      evidencePath: monitoringAlertTargetArtifact,
      link: `artifact: ${monitoringAlertTargetArtifact}`,
    }],
    errorTracking: {
      enabled: true,
      provider: "synthetic-error-tracker",
      project: "lore-mainnet",
      environment: "production",
      releaseOrDeploy: "synthetic-release",
      testEventStatus: "success",
      testEventAt: "2026-07-09T00:00:00.000Z",
      testEventId: "SENTRY-123456",
      testEventEvidencePath: monitoringErrorEventArtifact,
      testEventLink: `artifact: ${monitoringErrorEventArtifact}`,
    },
  }),
  "utf8",
);

const monitoringIrrelevantArtifact = join(tmp, "monitoring-irrelevant.log");
const monitoringIrrelevantAlertManifest = join(tmp, "monitoring-irrelevant-alert.json");
const monitoringIrrelevantRecoveryManifest = join(tmp, "monitoring-irrelevant-recovery.json");
const monitoringSharedAlertRecoveryManifest = join(tmp, "monitoring-shared-alert-recovery.json");
const monitoringSharedSectionManifest = join(tmp, "monitoring-shared-section.json");
const monitoringIrrelevantTargetManifest = join(tmp, "monitoring-irrelevant-target.json");
const monitoringMissingRecipientManifest = join(tmp, "monitoring-missing-recipient.json");
const monitoringInvalidRecipientManifest = join(tmp, "monitoring-invalid-recipient.json");
const monitoringFutureTimestampManifest = join(tmp, "monitoring-future-timestamp.json");
const monitoringMalformedCadenceManifest = join(tmp, "monitoring-malformed-cadence.json");
const monitoringUnsafeCadenceManifest = join(tmp, "monitoring-unsafe-cadence.json");
const monitoringCredentialedOriginManifest = join(tmp, "monitoring-credentialed-origin.json");
const monitoringCredentialedUrlManifest = join(tmp, "monitoring-credentialed-url.json");
const monitoringIrrelevantErrorManifest = join(tmp, "monitoring-irrelevant-error.json");
writeFileSync(monitoringIrrelevantArtifact, "pm2 process list only\n", "utf8");
const monitoringValidStrictManifest = {
  origin: "https://playlore.xyz",
  monitors: monitoringKinds.map((kind) => ({
    kind,
    enabled: true,
    provider: "synthetic-monitor",
    cadenceSeconds: kind === "health-prod" ? 60 : 120,
    url: kind === "health-prod" ? "https://playlore.xyz/api/health/runtime" : "https://playlore.xyz/api/health/data-sync",
    alertCondition: `${kind} synthetic alert condition`,
    evidencePath: monitoringAlertArtifact,
    link: `artifact: ${monitoringAlertArtifact}`,
    lastAlertTestAt: "2026-07-09T00:00:00.000Z",
    recoveryEvidencePath: monitoringRecoveryArtifact,
    recoveryLink: `artifact: ${monitoringRecoveryArtifact}`,
    lastRecoveryAt: "2026-07-09T00:01:00.000Z",
  })),
  alertTargets: [{
    name: "synthetic Resend email",
    kind: "email",
    recipient: "playlore88@gmail.com",
    sender: "alerts@playlore.xyz",
    senderDomain: "playlore.xyz",
    verified: true,
    lastTestAt: "2026-07-09T00:00:00.000Z",
    evidencePath: monitoringAlertTargetArtifact,
    link: `artifact: ${monitoringAlertTargetArtifact}`,
  }],
  errorTracking: {
    enabled: true,
    provider: "synthetic-error-tracker",
    project: "lore-mainnet",
    environment: "production",
    releaseOrDeploy: "synthetic-release",
    testEventStatus: "success",
    testEventAt: "2026-07-09T00:00:00.000Z",
    testEventId: "SENTRY-123456",
    testEventEvidencePath: monitoringErrorEventArtifact,
    testEventLink: `artifact: ${monitoringErrorEventArtifact}`,
  },
};
const monitoringValidStrictManifestPath = join(tmp, "monitoring-proof.valid.json");
writeFileSync(monitoringValidStrictManifestPath, JSON.stringify(monitoringValidStrictManifest), "utf8");
writeFileSync(
  monitoringIrrelevantAlertManifest,
  JSON.stringify({
    ...monitoringValidStrictManifest,
    monitors: monitoringValidStrictManifest.monitors.map((monitor) => ({ ...monitor, evidencePath: monitoringIrrelevantArtifact, link: `artifact: ${monitoringIrrelevantArtifact}` })),
  }),
  "utf8",
);
writeFileSync(
  monitoringIrrelevantRecoveryManifest,
  JSON.stringify({
    ...monitoringValidStrictManifest,
    monitors: monitoringValidStrictManifest.monitors.map((monitor) => ({ ...monitor, recoveryEvidencePath: monitoringIrrelevantArtifact, recoveryLink: `artifact: ${monitoringIrrelevantArtifact}` })),
  }),
  "utf8",
);
writeFileSync(
  monitoringSharedAlertRecoveryManifest,
  JSON.stringify({
    ...monitoringValidStrictManifest,
    monitors: monitoringValidStrictManifest.monitors.map((monitor) => ({
      ...monitor,
      evidencePath: monitoringSharedAlertRecoveryArtifact,
      link: `artifact: ${monitoringSharedAlertRecoveryArtifact}`,
      recoveryEvidence: `RECOVERY proof in artifact: ${monitoringSharedAlertRecoveryArtifact}`,
      recoveryEvidencePath: monitoringSharedAlertRecoveryArtifact,
      recoveryLink: undefined,
    })),
  }),
  "utf8",
);
writeFileSync(
  monitoringSharedSectionManifest,
  JSON.stringify({
    ...monitoringValidStrictManifest,
    monitors: monitoringValidStrictManifest.monitors.map((monitor) => ({
      ...monitor,
      evidencePath: monitoringSharedSectionArtifact,
      link: `artifact: ${monitoringSharedSectionArtifact}`,
    })),
    alertTargets: monitoringValidStrictManifest.alertTargets.map((target) => ({
      ...target,
      evidencePath: monitoringSharedSectionArtifact,
      link: `artifact: ${monitoringSharedSectionArtifact}`,
    })),
  }),
  "utf8",
);
writeFileSync(
  monitoringIrrelevantTargetManifest,
  JSON.stringify({
    ...monitoringValidStrictManifest,
    alertTargets: monitoringValidStrictManifest.alertTargets.map((target) => ({ ...target, evidencePath: monitoringIrrelevantArtifact, link: `artifact: ${monitoringIrrelevantArtifact}` })),
  }),
  "utf8",
);
writeFileSync(
  monitoringMissingRecipientManifest,
  JSON.stringify({
    ...monitoringValidStrictManifest,
    alertTargets: monitoringValidStrictManifest.alertTargets.map((target) => {
      const clone = { ...target };
      delete clone.recipient;
      return clone;
    }),
  }),
  "utf8",
);
writeFileSync(
  monitoringInvalidRecipientManifest,
  JSON.stringify({
    ...monitoringValidStrictManifest,
    alertTargets: monitoringValidStrictManifest.alertTargets.map((target) => ({
      ...target,
      recipient: "ops-team",
    })),
  }),
  "utf8",
);
writeFileSync(
  monitoringFutureTimestampManifest,
  JSON.stringify({
    ...monitoringValidStrictManifest,
    monitors: monitoringValidStrictManifest.monitors.map((monitor) => ({
      ...monitor,
      lastAlertTestAt: "2999-01-01T00:00:00.000Z",
      lastRecoveryAt: "2999-01-01T00:01:00.000Z",
    })),
    alertTargets: monitoringValidStrictManifest.alertTargets.map((target) => ({
      ...target,
      lastTestAt: "2999-01-01T00:00:00.000Z",
    })),
    errorTracking: {
      ...monitoringValidStrictManifest.errorTracking,
      testEventAt: "2999-01-01T00:00:00.000Z",
    },
  }),
  "utf8",
);
writeFileSync(
  monitoringMalformedCadenceManifest,
  JSON.stringify({
    ...monitoringValidStrictManifest,
    monitors: monitoringValidStrictManifest.monitors.map((monitor) => monitor.kind === "health-prod" ? {
      ...monitor,
      cadenceSeconds: "30.5",
    } : monitor),
  }),
  "utf8",
);
writeFileSync(
  monitoringUnsafeCadenceManifest,
  JSON.stringify({
    ...monitoringValidStrictManifest,
    monitors: monitoringValidStrictManifest.monitors.map((monitor) => monitor.kind === "health-prod" ? {
      ...monitor,
      cadenceSeconds: "9999999999999999",
    } : monitor),
  }),
  "utf8",
);
writeFileSync(
  monitoringCredentialedOriginManifest,
  JSON.stringify({
    ...monitoringValidStrictManifest,
    origin: "https://user:pass@playlore.xyz",
  }),
  "utf8",
);
writeFileSync(
  monitoringCredentialedUrlManifest,
  JSON.stringify({
    ...monitoringValidStrictManifest,
    monitors: monitoringValidStrictManifest.monitors.map((monitor, index) => ({
      ...monitor,
      url: index === 0 ? "https://user:pass@playlore.xyz/api/health/runtime" : monitor.url,
    })),
  }),
  "utf8",
);
writeFileSync(
  monitoringIrrelevantErrorManifest,
  JSON.stringify({
    ...monitoringValidStrictManifest,
    errorTracking: { ...monitoringValidStrictManifest.errorTracking, testEventEvidencePath: monitoringIrrelevantArtifact, testEventLink: `artifact: ${monitoringIrrelevantArtifact}` },
  }),
  "utf8",
);
writeFileSync(
  monitoringDirectoryArtifactManifest,
  JSON.stringify({
    ...monitoringValidStrictManifest,
    monitors: monitoringValidStrictManifest.monitors.map((monitor, index) => index === 0 ? { ...monitor, evidencePath: monitoringDirectoryArtifact } : monitor),
  }),
  "utf8",
);
const restoreSourcePath = join(makeTempDir("lore-proof-restore-source-"), "source.sqlite");
const restoreBackupDir = makeTempDir("lore-proof-restore-backup-");
const restoreDir = makeTempDir("lore-proof-restore-restored-");
const restoreBackupPath = join(restoreBackupDir, "backup.sqlite");
const restoreStrictSourcePath = join(makeTempDir("lore-proof-restore-strict-source-"), "source.sqlite");
const restoreStrictBackupDir = makeTempDir("lore-proof-restore-strict-backup-");
const restoreStrictDir = makeTempDir("lore-proof-restore-strict-restored-");
const restoreStrictBackupPath = join(restoreStrictBackupDir, "backup.sqlite");
const restoreLog = join(tmp, "restore-drill.log");
const restoreHealthLog = join(tmp, "restore-health-prod.log");
const restoreHealthMissingRuntimeLog = join(tmp, "restore-health-missing-runtime.log");
const restoreHealthMalformedFinalityLog = join(tmp, "restore-health-malformed-finality.log");
const restoreHealthUnsafeFinalityLog = join(tmp, "restore-health-unsafe-finality.log");
const restoreHealthCredentialedBaseLog = join(tmp, "restore-health-credentialed-base.log");
const restoreMissingLogPath = join(tmp, "missing-restore-drill.log");
const restoreBackupScheduleArtifact = join(tmp, "restore-backup-schedule.log");
const restorePreservationArtifact = join(tmp, "restore-indexer-preservation.log");
const restoreDirectoryArtifact = makeTempDir("lore-proof-restore-artifact.log-");
const restoreDirectoryArtifactManifest = join(tmp, "restore-directory-artifact.json");
writeFileSync(restoreSourcePath, "synthetic source db for collector draft guard", "utf8");
writeFileSync(restoreBackupPath, "synthetic backup artifact for collector draft guard", "utf8");
{
  const db = new DatabaseSync(restoreStrictSourcePath);
  db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO meta (key, value) VALUES ('heartbeat', 'abc');");
  db.close();
}
copyFileSync(restoreStrictSourcePath, restoreStrictBackupPath);
writeFileSync(restoreLog, "Summary: backup/restore drill completed without detected issues.\nRestored DB integrity_check=ok after copied backup artifact.\n", "utf8");
writeFileSync(restoreHealthLog, "[prod-health] OK\nbase=https://restore.playlore.xyz runtime=ok dataSync=ok effectiveLagBlocks=1 finalityLagBlocks=1\n", "utf8");
writeFileSync(restoreHealthMissingRuntimeLog, "[prod-health] OK\nbase=https://restore.playlore.xyz dataSync=ok effectiveLagBlocks=1 finalityLagBlocks=1\n", "utf8");
writeFileSync(restoreHealthMalformedFinalityLog, "[prod-health] OK\nbase=https://restore.playlore.xyz runtime=ok dataSync=ok effectiveLagBlocks=1 finalityLagBlocks=1e2\n", "utf8");
writeFileSync(restoreHealthUnsafeFinalityLog, "[prod-health] OK\nbase=https://restore.playlore.xyz runtime=ok dataSync=ok effectiveLagBlocks=1 finalityLagBlocks=9999999999999999\n", "utf8");
writeFileSync(restoreHealthCredentialedBaseLog, "[prod-health] OK\nbase=https://user:pass@restore.playlore.xyz runtime=ok dataSync=ok effectiveLagBlocks=1 finalityLagBlocks=1\n", "utf8");
writeFileSync(restoreBackupScheduleArtifact, "daily cron backup schedule active; latest backup completed successfully at lastSuccessfulBackupAt=2026-07-08T23:55:00.000Z; retentionDays=30 prune policy enabled\n", "utf8");
writeFileSync(restorePreservationArtifact, "heartbeatBefore=abc heartbeatAfter=abc latestIndexedEpochBefore=1 latestIndexedEpochAfter=1\n", "utf8");
const restoreMissingArtifact = join(tmp, "missing-restore-backup-schedule.log");
const restoreMissingArtifactManifest = join(tmp, "restore-missing-local-artifact.json");
writeFileSync(
  restoreMissingArtifactManifest,
  JSON.stringify({
    backupSchedule: {
      enabled: true,
      cadence: "daily cron backup",
      checkedAt: "2026-07-09T00:00:00.000Z",
      evidencePath: restoreMissingArtifact,
      link: `artifact: ${restoreMissingArtifact}`,
    },
    restoreDrill: {
      status: "verified",
      command: "npm run proof:restore -- --strict",
      backupPathOutsideRepo: true,
      restorePathOutsideRepo: true,
      backupRestoreDirsDistinct: true,
      sourceDbOutsideBackupRestoreDirs: true,
      sourceDbPath: restoreSourcePath,
      backupDir: restoreBackupDir,
      restoreDir,
      backupArtifact: restoreBackupPath,
      timestamp: "2026-07-09T00:00:00.000Z",
      evidencePath: restoreLog,
    },
    restoredStagingHealth: {
      status: "healthy",
      command: "npm run health:prod -- --base=https://restore.playlore.xyz",
      hostType: "restore",
      url: "https://restore.playlore.xyz",
      runtimeHealthPassed: true,
      dataSyncHealthPassed: true,
      finalityLagChecked: true,
      timestamp: "2026-07-09T00:00:00.000Z",
      evidence: `base=https://restore.playlore.xyz runtime=ok dataSync=ok finalityLagBlocks=1 artifact: ${restoreHealthLog}`,
      evidencePath: restoreHealthLog,
    },
    indexerPreservation: {
      heartbeatPreserved: true,
      latestIndexedEpochPreserved: true,
      heartbeatBefore: "abc",
      heartbeatAfter: "abc",
      latestIndexedEpochBefore: "1",
      latestIndexedEpochAfter: "1",
      checkedAt: "2026-07-09T00:00:00.000Z",
      evidencePath: restorePreservationArtifact,
    },
  }),
  "utf8",
);

const restoreIrrelevantScheduleArtifact = join(tmp, "restore-irrelevant-schedule.log");
const restoreNoIntegrityArtifact = join(tmp, "restore-no-integrity.log");
const restoreIrrelevantPreservationArtifact = join(tmp, "restore-irrelevant-preservation.log");
const restoreSharedSectionArtifact = join(tmp, "restore-shared-section.log");
const restoreIrrelevantScheduleManifest = join(tmp, "restore-irrelevant-schedule-artifact.json");
const restoreMismatchedLatestBackupManifest = join(tmp, "restore-mismatched-latest-backup.json");
const restoreMismatchedRetentionManifest = join(tmp, "restore-mismatched-retention.json");
const restoreNoIntegrityManifest = join(tmp, "restore-no-integrity-artifact.json");
const restoreIrrelevantPreservationManifest = join(tmp, "restore-irrelevant-preservation-artifact.json");
const restoreSharedSectionManifest = join(tmp, "restore-shared-section-artifact.json");
const restoreFutureTimestampManifest = join(tmp, "restore-future-timestamp.json");
const restoreMalformedFinalityManifest = join(tmp, "restore-malformed-finality.json");
const restoreUnsafeFinalityManifest = join(tmp, "restore-unsafe-finality.json");
const restoreUnsafeIndexedEpochManifest = join(tmp, "restore-unsafe-indexed-epoch.json");
writeFileSync(restoreIrrelevantScheduleArtifact, "pm2 process list only\n", "utf8");
writeFileSync(restoreNoIntegrityArtifact, "Summary: backup/restore drill completed without detected issues.\n", "utf8");
writeFileSync(restoreIrrelevantPreservationArtifact, "restore drill completed without indexer comparison\n", "utf8");
writeFileSync(
  restoreSharedSectionArtifact,
  [
    "daily cron backup schedule active; latest backup completed successfully at lastSuccessfulBackupAt=2026-07-08T23:55:00.000Z; retentionDays=30 prune policy enabled",
    "Summary: backup/restore drill completed without detected issues. Restored DB integrity_check=ok after copied backup artifact.",
    "[prod-health] OK base=https://restore.playlore.xyz runtime=ok dataSync=ok effectiveLagBlocks=1 finalityLagBlocks=1",
    "heartbeatBefore=abc heartbeatAfter=abc latestIndexedEpochBefore=1 latestIndexedEpochAfter=1",
  ].join("\n"),
  "utf8",
);
const restoreValidStrictManifest = {
  backupSchedule: {
    enabled: true,
    cadence: "daily cron backup",
    retentionDays: "30",
    lastSuccessfulBackupAt: "2026-07-08T23:55:00.000Z",
    checkedAt: "2026-07-09T00:00:00.000Z",
    evidencePath: restoreBackupScheduleArtifact,
    link: `artifact: ${restoreBackupScheduleArtifact}`,
  },
  restoreDrill: {
    status: "verified",
    command: "npm run proof:restore -- --strict",
    backupPathOutsideRepo: true,
    restorePathOutsideRepo: true,
    backupRestoreDirsDistinct: true,
    sourceDbOutsideBackupRestoreDirs: true,
    sourceDbPath: restoreSourcePath,
    backupDir: restoreBackupDir,
    restoreDir,
    backupArtifact: restoreBackupPath,
    timestamp: "2026-07-09T00:00:00.000Z",
    evidencePath: restoreLog,
  },
  restoredStagingHealth: {
    status: "healthy",
    command: "npm run health:prod -- --base=https://restore.playlore.xyz",
    hostType: "restore",
    url: "https://restore.playlore.xyz",
    runtimeHealthPassed: true,
    dataSyncHealthPassed: true,
    finalityLagChecked: true,
    timestamp: "2026-07-09T00:00:00.000Z",
    evidence: `base=https://restore.playlore.xyz runtime=ok dataSync=ok finalityLagBlocks=1 artifact: ${restoreHealthLog}`,
    evidencePath: restoreHealthLog,
  },
  indexerPreservation: {
    heartbeatPreserved: true,
    latestIndexedEpochPreserved: true,
    heartbeatBefore: "abc",
    heartbeatAfter: "abc",
    latestIndexedEpochBefore: "1",
    latestIndexedEpochAfter: "1",
    checkedAt: "2026-07-09T00:00:00.000Z",
    evidencePath: restorePreservationArtifact,
  },
};
const restoreValidStrictManifestPath = join(tmp, "restore-proof.valid.json");
writeFileSync(
  restoreValidStrictManifestPath,
  JSON.stringify({
    ...restoreValidStrictManifest,
    restoreDrill: {
      ...restoreValidStrictManifest.restoreDrill,
      sourceDbPath: restoreStrictSourcePath,
      backupDir: restoreStrictBackupDir,
      restoreDir: restoreStrictDir,
      backupArtifact: restoreStrictBackupPath,
    },
  }),
  "utf8",
);
writeFileSync(
  restoreIrrelevantScheduleManifest,
  JSON.stringify({
    ...restoreValidStrictManifest,
    backupSchedule: {
      ...restoreValidStrictManifest.backupSchedule,
      evidencePath: restoreIrrelevantScheduleArtifact,
      link: `artifact: ${restoreIrrelevantScheduleArtifact}`,
    },
  }),
  "utf8",
);
writeFileSync(
  restoreMismatchedLatestBackupManifest,
  JSON.stringify({
    ...restoreValidStrictManifest,
    backupSchedule: {
      ...restoreValidStrictManifest.backupSchedule,
      lastSuccessfulBackupAt: "2026-07-08T23:50:00.000Z",
    },
  }),
  "utf8",
);
writeFileSync(
  restoreMismatchedRetentionManifest,
  JSON.stringify({
    ...restoreValidStrictManifest,
    backupSchedule: {
      ...restoreValidStrictManifest.backupSchedule,
      retentionDays: "31",
    },
  }),
  "utf8",
);
writeFileSync(
  restoreNoIntegrityManifest,
  JSON.stringify({
    ...restoreValidStrictManifest,
    restoreDrill: {
      ...restoreValidStrictManifest.restoreDrill,
      evidencePath: restoreNoIntegrityArtifact,
    },
  }),
  "utf8",
);
writeFileSync(
  restoreIrrelevantPreservationManifest,
  JSON.stringify({
    ...restoreValidStrictManifest,
    indexerPreservation: {
      ...restoreValidStrictManifest.indexerPreservation,
      evidencePath: restoreIrrelevantPreservationArtifact,
    },
  }),
  "utf8",
);
writeFileSync(
  restoreSharedSectionManifest,
  JSON.stringify({
    ...restoreValidStrictManifest,
    backupSchedule: {
      ...restoreValidStrictManifest.backupSchedule,
      evidencePath: restoreSharedSectionArtifact,
      link: `artifact: ${restoreSharedSectionArtifact}`,
    },
    restoreDrill: {
      ...restoreValidStrictManifest.restoreDrill,
      evidencePath: restoreSharedSectionArtifact,
    },
  }),
  "utf8",
);
writeFileSync(
  restoreDirectoryArtifactManifest,
  JSON.stringify({
    ...restoreValidStrictManifest,
    backupSchedule: {
      ...restoreValidStrictManifest.backupSchedule,
      evidencePath: restoreDirectoryArtifact,
      link: `artifact: ${restoreDirectoryArtifact}`,
    },
  }),
  "utf8",
);
writeFileSync(
  restoreMalformedFinalityManifest,
  JSON.stringify({
    ...restoreValidStrictManifest,
    restoredStagingHealth: {
      ...restoreValidStrictManifest.restoredStagingHealth,
      evidence: `base=https://restore.playlore.xyz runtime=ok dataSync=ok finalityLagBlocks=1e2 artifact: ${restoreHealthMalformedFinalityLog}`,
      evidencePath: restoreHealthMalformedFinalityLog,
    },
  }),
  "utf8",
);
writeFileSync(
  restoreUnsafeFinalityManifest,
  JSON.stringify({
    ...restoreValidStrictManifest,
    restoredStagingHealth: {
      ...restoreValidStrictManifest.restoredStagingHealth,
      evidence: `base=https://restore.playlore.xyz runtime=ok dataSync=ok finalityLagBlocks=9999999999999999 artifact: ${restoreHealthUnsafeFinalityLog}`,
      evidencePath: restoreHealthUnsafeFinalityLog,
    },
  }),
  "utf8",
);
writeFileSync(
  restoreUnsafeIndexedEpochManifest,
  JSON.stringify({
    ...restoreValidStrictManifest,
    indexerPreservation: {
      ...restoreValidStrictManifest.indexerPreservation,
      latestIndexedEpochBefore: "9999999999999999",
      latestIndexedEpochAfter: "9999999999999999",
    },
  }),
  "utf8",
);
writeFileSync(
  restoreFutureTimestampManifest,
  JSON.stringify({
    ...restoreValidStrictManifest,
    restoreDrill: {
      ...restoreValidStrictManifest.restoreDrill,
      timestamp: "2999-01-01T00:00:00.000Z",
    },
    restoredStagingHealth: {
      ...restoreValidStrictManifest.restoredStagingHealth,
      timestamp: "2999-01-01T00:00:00.000Z",
    },
    indexerPreservation: {
      ...restoreValidStrictManifest.indexerPreservation,
      checkedAt: "2999-01-01T00:00:00.000Z",
    },
  }),
  "utf8",
);
const draftCases = [
  {
    id: "signoff",
    out: join(tmp, "signoff-proof.draft.json"),
    create: ["scripts/create-signoff-proof-draft.mjs"],
    createArgs: [`--env-log=${signoffEnvLog}`, `--chain-log=${signoffChainLog}`],
    check: ["scripts/check-signoff-proof.mjs"],
    checkArgs: (out) => ["--strict", `--file=${out}`],
  },
  {
    id: "host",
    out: join(tmp, "host-proof.draft.json"),
    create: ["scripts/create-host-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`, `--health-log=${hostHealthLog}`, `--load-log=${hostLoadLog}`],
    check: ["scripts/check-host-proof.mjs"],
    checkArgs: (out) => ["--strict", `--file=${out}`],
  },
  {
    id: "indexer",
    out: join(tmp, "indexer-proof.draft.json"),
    create: ["scripts/create-indexer-proof-draft.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--start-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshot}`],
    check: ["scripts/check-indexer-dry-run.mjs"],
    checkArgs: (out) => ["--strict", `--manifest=${out}`],
  },
  {
    id: "restore",
    out: join(tmp, "restore-proof.draft.json"),
    create: ["scripts/create-restore-proof-draft.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${restoreLog}`, `--health-log=${restoreHealthLog}`, `--backup-schedule-artifact=${restoreBackupScheduleArtifact}`, `--preservation-artifact=${restorePreservationArtifact}`],
    check: ["scripts/verify-db-restore.mjs"],
    checkArgs: (out) => ["--strict", `--manifest=${out}`],
  },
  {
    id: "monitoring",
    out: join(tmp, "monitoring-proof.draft.json"),
    create: ["scripts/create-monitoring-proof-draft.mjs"],
    createArgs: ["--provider=synthetic-monitor", "--error-provider=synthetic-error-tracker", "--origin=https://playlore.xyz", `--monitor-artifact=${monitoringAlertArtifact}`, `--recovery-artifact=${monitoringRecoveryArtifact}`, `--alert-target-artifact=${monitoringAlertTargetArtifact}`, `--error-event-artifact=${monitoringErrorEventArtifact}`],
    check: ["scripts/check-monitoring-proof.mjs"],
    checkArgs: (out) => ["--strict", `--file=${out}`],
  },
  {
    id: "qa",
    out: join(tmp, "qa-proof.draft.json"),
    create: ["scripts/create-qa-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--network=linea-mainnet", "--chain-id=59144", `--wallet-artifact=${qaWalletArtifact}`, `--failure-artifact=${qaFailureArtifact}`, `--support-artifact=${qaSupportArtifact}`, `--finalqa-artifact=${qaFinalArtifact}`, `--smoke-artifact=${qaSmokeArtifact}`, "--clean-wallet-tx=0x1111111111111111111111111111111111111111111111111111111111111111"],
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: (out) => ["--strict", `--file=${out}`],
  },
  {
    id: "canary",
    out: join(tmp, "canary-proof.draft.json"),
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--network=linea-mainnet", "--chain-id=59144", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-mainnet-rpc", `--live-log=${canaryLog}`, `--target-artifact=${canaryTargetArtifact}`, `--recovery-artifact=${canaryRecoveryArtifact}`, `--session-artifact=${canarySessionArtifact}`, `--tx-artifact=${canaryTxArtifact}`],
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: (out) => [canaryLog, "--strict", `--manifest=${out}`],
  },
  {
    id: "canary-bom-live-log",
    out: join(tmp, "canary-bom-proof.draft.json"),
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--network=linea-mainnet", "--chain-id=59144", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-mainnet-rpc", `--live-log=${canaryFullBomLog}`, `--target-artifact=${canaryTargetArtifact}`, `--recovery-artifact=${canaryRecoveryArtifact}`, `--session-artifact=${canarySessionArtifact}`, `--tx-artifact=${canaryTxArtifact}`],
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: (out) => [canaryFullBomLog, "--strict", `--manifest=${out}`],
  },
  {
    id: "canary-testnet",
    out: join(tmp, "testnet-canary-proof.draft.json"),
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--profile=testnet", "--network=linea-sepolia", "--chain-id=59141", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-sepolia-rpc", `--live-log=${testnetCanaryFullLog}`, `--target-artifact=${canaryTargetArtifact}`, `--recovery-artifact=${canaryRecoveryArtifact}`, `--session-artifact=${canarySessionArtifact}`, `--tx-artifact=${canaryTxArtifact}`],
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: (out) => [testnetCanaryFullLog, "--profile=testnet", "--strict", `--manifest=${out}`],
  },
];

const collectorDraftCases = [
  {
    id: "signoff-collector",
    out: join(tmp, "signoff-proof.collector.json"),
    create: ["scripts/collect-signoff-evidence.mjs"],
    createArgs: ["--epochs=1", "--user=0x1111111111111111111111111111111111111111", `--env-log=${signoffEnvLog}`, `--chain-log=${signoffChainLog}`],
    requiredSections: ["contractEnv", "ownership", "randomness", "chainComparison"],
    check: ["scripts/check-signoff-proof.mjs"],
    checkArgs: (out) => ["--strict", `--file=${out}`],
  },
  {
    id: "host-collector",
    out: join(tmp, "host-proof.collector.json"),
    create: ["scripts/collect-host-evidence.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`, `--health-log=${hostHealthLog}`, `--load-log=${hostLoadLog}`],
    requiredSections: ["processModel", "persistentDb", "healthProd", "loadHttp"],
    check: ["scripts/check-host-proof.mjs"],
    checkArgs: (out) => ["--strict", `--file=${out}`],
  },
  {
    id: "indexer-collector",
    out: join(tmp, "indexer-proof.collector.json"),
    create: ["scripts/collect-indexer-evidence.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshot}`],
    requiredSections: ["dryRun", "finality", "chainSnapshot", "chainComparison"],
    check: ["scripts/check-indexer-dry-run.mjs"],
    checkArgs: (out) => ["--strict", `--manifest=${out}`],
  },
  {
    id: "restore-collector",
    out: join(tmp, "restore-proof.collector.json"),
    create: ["scripts/collect-restore-evidence.mjs"],
    createArgs: [
      `--source=${restoreSourcePath}`,
      `--backup-dir=${restoreBackupDir}`,
      `--restore-dir=${restoreDir}`,
      `--backup=${restoreBackupPath}`,
      "--restored-origin=https://restore.playlore.xyz",
      "--restored-host-type=restore",
      `--restore-log=${restoreLog}`,
      `--health-log=${restoreHealthLog}`,
      `--backup-schedule-artifact=${restoreBackupScheduleArtifact}`,
      `--preservation-artifact=${restorePreservationArtifact}`,
    ],
    requiredSections: ["backupSchedule", "restoreDrill", "restoredStagingHealth", "indexerPreservation"],
    check: ["scripts/verify-db-restore.mjs"],
    checkArgs: (out) => ["--strict", `--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, `--manifest=${out}`],
  },
];
const collectorRejectCases = [
  {
    id: "signoff-collector-missing-env-log",
    create: ["scripts/collect-signoff-evidence.mjs"],
    createArgs: ["--epochs=1", "--user=0x1111111111111111111111111111111111111111", `--chain-log=${signoffChainLog}`],
    expected: "--env-log is required when collecting signoff launch evidence",
  },
  {
    id: "signoff-collector-missing-chain-log",
    create: ["scripts/collect-signoff-evidence.mjs"],
    createArgs: ["--epochs=1", "--user=0x1111111111111111111111111111111111111111", `--env-log=${signoffEnvLog}`],
    expected: "--chain-log is required when collecting signoff launch evidence",
  },
  {
    id: "signoff-collector-failed-env-log",
    create: ["scripts/collect-signoff-evidence.mjs"],
    createArgs: ["--epochs=1", "--user=0x1111111111111111111111111111111111111111", `--env-log=${signoffFailedEnvLog}`, `--chain-log=${signoffChainLog}`],
    expected: "--env-log must contain successful proof:mainnet summary",
  },
  {
    id: "signoff-collector-weak-chain-log",
    create: ["scripts/collect-signoff-evidence.mjs"],
    createArgs: ["--epochs=1", "--user=0x1111111111111111111111111111111111111111", `--env-log=${signoffEnvLog}`, `--chain-log=${signoffWeakChainLog}`],
    expected: "--chain-log must contain direct-chain comparison evidence for jackpot, safetyPool, deposits, rewards, rebates, and resolve",
  },
  {
    id: "signoff-collector-shared-artifact-input",
    create: ["scripts/collect-signoff-evidence.mjs"],
    createArgs: ["--epochs=1", "--user=0x1111111111111111111111111111111111111111", `--env-log=${signoffEnvLog}`, `--chain-log=${signoffEnvLog}`],
    expected: "--env-log and --chain-log must point to distinct signoff evidence files",
  },
  {
    id: "signoff-collector-unsafe-epochs",
    create: ["scripts/collect-signoff-evidence.mjs"],
    createArgs: ["--epochs=9999999999999999", "--user=0x1111111111111111111111111111111111111111", `--env-log=${signoffEnvLog}`, `--chain-log=${signoffChainLog}`],
    expected: "--epochs must be a positive integer",
  },
  {
    id: "signoff-collector-directory-env-log",
    create: ["scripts/collect-signoff-evidence.mjs"],
    createArgs: ["--epochs=1", "--user=0x1111111111111111111111111111111111111111", `--env-log=${signoffDirectoryArtifact}`, `--chain-log=${signoffChainLog}`],
    expected: "--env-log must point to an existing redacted artifact",
  },
  {
    id: "host-collector-missing-logs",
    create: ["scripts/collect-host-evidence.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`],
    expected: "--health-log is required when collecting launch host evidence",
  },
  {
    id: "host-collector-missing-load-log",
    create: ["scripts/collect-host-evidence.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`, `--health-log=${hostHealthLog}`],
    expected: "--load-log is required when collecting launch host evidence",
  },
  {
    id: "host-collector-credentialed-origin",
    create: ["scripts/collect-host-evidence.mjs"],
    createArgs: ["--origin=https://user:pass@playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`, `--health-log=${hostHealthLog}`, `--load-log=${hostLoadLog}`],
    expected: "--origin must be a public HTTPS origin without path, query, or hash",
  },
  {
    id: "host-collector-missing-health-log-artifact",
    create: ["scripts/collect-host-evidence.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`, `--health-log=${hostMissingHealthLogPath}`, `--load-log=${hostLoadLog}`],
    expected: "--health-log must point to an existing redacted artifact",
  },
  {
    id: "host-collector-missing-process-evidence",
    create: ["scripts/collect-host-evidence.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--health-log=${hostHealthLog}`, `--load-log=${hostLoadLog}`],
    expected: "--process-evidence is required when collecting launch host evidence",
  },
  {
    id: "host-collector-directory-process-evidence",
    create: ["scripts/collect-host-evidence.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostDirectoryArtifact}`, `--health-log=${hostHealthLog}`, `--load-log=${hostLoadLog}`],
    expected: "--process-evidence must point to an existing redacted artifact",
  },
  {
    id: "host-collector-shared-artifact-input",
    create: ["scripts/collect-host-evidence.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostSharedSectionArtifact}`, `--health-log=${hostSharedSectionArtifact}`, `--load-log=${hostLoadLog}`],
    expected: "--process-evidence and --health-log must point to distinct host evidence files",
  },
  {
    id: "host-collector-repo-db",
    create: ["scripts/collect-host-evidence.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${join(process.cwd(), "repo-host.sqlite")}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`, `--health-log=${hostHealthLog}`, `--load-log=${hostLoadLog}`],
    expected: "--db-path/LORE_DB_PATH must be an absolute path outside the repo checkout",
  },
  {
    id: "host-collector-missing-health-base",
    create: ["scripts/collect-host-evidence.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`, `--health-log=${hostHealthMissingBaseLog}`, `--load-log=${hostLoadLog}`],
    expected: "--health-log must include base=<production origin>",
  },
  {
    id: "host-collector-credentialed-health-base",
    create: ["scripts/collect-host-evidence.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`, `--health-log=${hostHealthCredentialedBaseLog}`, `--load-log=${hostLoadLog}`],
    expected: "--health-log base must match --origin",
  },
  {
    id: "host-collector-malformed-finality-lag",
    create: ["scripts/collect-host-evidence.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`, `--health-log=${hostHealthMalformedFinalityLog}`, `--load-log=${hostLoadLog}`],
    expected: "--health-log must include canonical non-negative decimal finalityLagBlocks=<number>",
  },
  {
    id: "host-collector-unsafe-finality-lag",
    create: ["scripts/collect-host-evidence.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`, `--health-log=${hostHealthUnsafeFinalityLog}`, `--load-log=${hostLoadLog}`],
    expected: "--health-log must include canonical non-negative decimal finalityLagBlocks=<number>",
  },
  {
    id: "host-collector-missing-load-base",
    create: ["scripts/collect-host-evidence.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`, `--health-log=${hostHealthLog}`, `--load-log=${hostLoadMissingBaseLog}`],
    expected: "--load-log must include Load base URL line",
  },
  {
    id: "host-collector-credentialed-load-base",
    create: ["scripts/collect-host-evidence.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`, `--health-log=${hostHealthLog}`, `--load-log=${hostLoadCredentialedBaseLog}`],
    expected: "--load-log Load base URL must match --load-origin",
  },
  {
    id: "indexer-collector-missing-indexer-log",
    create: ["scripts/collect-indexer-evidence.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshot}`],
    expected: "--indexer-log is required when collecting indexer launch evidence",
  },
  {
    id: "indexer-collector-missing-health-log",
    create: ["scripts/collect-indexer-evidence.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--chain-snapshot=${indexerChainSnapshot}`],
    expected: "--health-log is required when collecting indexer launch evidence",
  },
  {
    id: "indexer-collector-missing-health-base",
    create: ["scripts/collect-indexer-evidence.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthMissingBaseLog}`, `--chain-snapshot=${indexerChainSnapshot}`],
    expected: "--health-log must include base=<production origin>",
  },
  {
    id: "indexer-collector-credentialed-health-base",
    create: ["scripts/collect-indexer-evidence.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthCredentialedBaseLog}`, `--chain-snapshot=${indexerChainSnapshot}`],
    expected: "--health-log must include base=<production origin>",
  },
  {
    id: "indexer-collector-malformed-finality-lag",
    create: ["scripts/collect-indexer-evidence.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthMalformedFinalityLog}`, `--chain-snapshot=${indexerChainSnapshot}`],
    expected: "--health-log must include canonical non-negative decimal finalityLagBlocks=<number>",
  },
  {
    id: "indexer-collector-unsafe-finality-lag",
    create: ["scripts/collect-indexer-evidence.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthUnsafeFinalityLog}`, `--chain-snapshot=${indexerChainSnapshot}`],
    expected: "--health-log must include canonical non-negative decimal finalityLagBlocks=<number>",
  },
  {
    id: "indexer-collector-missing-chain-snapshot",
    create: ["scripts/collect-indexer-evidence.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthLog}`],
    expected: "--chain-snapshot is required when collecting indexer launch evidence",
  },
  {
    id: "indexer-collector-missing-indexer-log-artifact",
    create: ["scripts/collect-indexer-evidence.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerMissingLogPath}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshot}`],
    expected: "--indexer-log must point to an existing redacted artifact",
  },
  {
    id: "indexer-collector-directory-indexer-log",
    create: ["scripts/collect-indexer-evidence.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerDirectoryArtifact}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshot}`],
    expected: "--indexer-log must point to an existing redacted artifact",
  },
  {
    id: "indexer-collector-repo-db",
    create: ["scripts/collect-indexer-evidence.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerRepoDbLog}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshot}`],
    expected: "--indexer-log [indexer] SQLite path must be outside the repo checkout",
  },
  {
    id: "indexer-collector-shared-artifact-input",
    create: ["scripts/collect-indexer-evidence.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerSharedSectionArtifact}`, `--health-log=${indexerSharedSectionArtifact}`, `--chain-snapshot=${indexerChainSnapshot}`],
    expected: "--indexer-log and --health-log must point to distinct indexer evidence files",
  },
  {
    id: "indexer-collector-missing-snapshot-generated-at",
    create: ["scripts/collect-indexer-evidence.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshotMissingGeneratedAt}`],
    expected: "--chain-snapshot must include generatedAt as ISO-8601 UTC",
  },
  {
    id: "indexer-collector-too-few-snapshot-epochs",
    create: ["scripts/collect-indexer-evidence.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=2", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshotTooFewEpochs}`],
    expected: "--chain-snapshot epochs must include at least --epochs unique checked epochs",
  },
  {
    id: "indexer-collector-credentialed-rpc-source",
    create: ["scripts/collect-indexer-evidence.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshotCredentialedRpc}`],
    expected: "--chain-snapshot rpcSource must be a redacted label or origin-only URL",
  },
  {
    id: "indexer-collector-malformed-chain-id",
    create: ["scripts/collect-indexer-evidence.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshotMalformedChainId}`],
    expected: "--chain-snapshot expectedChainId must be a canonical positive decimal integer",
  },
  {
    id: "indexer-collector-malformed-chain-snapshot",
    create: ["scripts/collect-indexer-evidence.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshotMalformed}`],
    expected: "--chain-snapshot must be valid JSON",
  },
  {
    id: "indexer-collector-directory-chain-snapshot",
    create: ["scripts/collect-indexer-evidence.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerDirectoryArtifact}`],
    expected: "--chain-snapshot must point to an existing redacted JSON artifact",
  },
  {
    id: "indexer-collector-non-object-chain-snapshot",
    create: ["scripts/collect-indexer-evidence.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshotNonObject}`],
    expected: "--chain-snapshot must be a JSON object artifact",
  },  {
    id: "restore-collector-missing-runtime",
    create: ["scripts/collect-restore-evidence.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${restoreLog}`, `--health-log=${restoreHealthMissingRuntimeLog}`, `--backup-schedule-artifact=${restoreBackupScheduleArtifact}`, `--preservation-artifact=${restorePreservationArtifact}`],
    expected: "--health-log must include runtime=ok\/pass\/healthy",
  },
  {
    id: "restore-collector-credentialed-health-base",
    create: ["scripts/collect-restore-evidence.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${restoreLog}`, `--health-log=${restoreHealthCredentialedBaseLog}`, `--backup-schedule-artifact=${restoreBackupScheduleArtifact}`, `--preservation-artifact=${restorePreservationArtifact}`],
    expected: "--health-log must include base=<restored-origin>",
  },
  {
    id: "restore-collector-missing-restore-log",
    create: ["scripts/collect-restore-evidence.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--health-log=${restoreHealthLog}`, `--backup-schedule-artifact=${restoreBackupScheduleArtifact}`, `--preservation-artifact=${restorePreservationArtifact}`],
    expected: "--restore-log is required when collecting restore launch evidence",
  },
  {
    id: "restore-collector-missing-restore-log-artifact",
    create: ["scripts/collect-restore-evidence.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${restoreMissingLogPath}`, `--health-log=${restoreHealthLog}`, `--backup-schedule-artifact=${restoreBackupScheduleArtifact}`, `--preservation-artifact=${restorePreservationArtifact}`],
    expected: "--restore-log must point to an existing redacted file artifact",
  },
  {
    id: "restore-collector-missing-health-log",
    create: ["scripts/collect-restore-evidence.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${restoreLog}`, `--backup-schedule-artifact=${restoreBackupScheduleArtifact}`, `--preservation-artifact=${restorePreservationArtifact}`],
    expected: "--health-log is required when collecting restore launch evidence",
  },
  {
    id: "restore-collector-missing-backup-schedule-artifact",
    create: ["scripts/collect-restore-evidence.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${restoreLog}`, `--health-log=${restoreHealthLog}`, `--preservation-artifact=${restorePreservationArtifact}`],
    expected: "--backup-schedule-artifact is required when collecting restore launch evidence",
  },
  {
    id: "restore-collector-missing-preservation-artifact",
    create: ["scripts/collect-restore-evidence.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${restoreLog}`, `--health-log=${restoreHealthLog}`, `--backup-schedule-artifact=${restoreBackupScheduleArtifact}`],
    expected: "--preservation-artifact is required when collecting restore launch evidence",
  },
  {
    id: "restore-collector-directory-backup-schedule-artifact",
    create: ["scripts/collect-restore-evidence.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${restoreLog}`, `--health-log=${restoreHealthLog}`, `--backup-schedule-artifact=${restoreDirectoryArtifact}`, `--preservation-artifact=${restorePreservationArtifact}`],
    expected: "must point to an existing redacted file artifact",
  },
  {
    id: "restore-collector-shared-artifact-input",
    create: ["scripts/collect-restore-evidence.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${restoreSharedSectionArtifact}`, `--health-log=${restoreSharedSectionArtifact}`, `--backup-schedule-artifact=${restoreBackupScheduleArtifact}`, `--preservation-artifact=${restorePreservationArtifact}`],
    expected: "--restore-log and --health-log must point to distinct restore evidence files",
  },  {
    id: "canary-draft-missing-live-log",
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--network=linea-mainnet", "--chain-id=59144", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-mainnet-rpc", `--target-artifact=${canaryTargetArtifact}`, `--recovery-artifact=${canaryRecoveryArtifact}`, `--session-artifact=${canarySessionArtifact}`, `--tx-artifact=${canaryTxArtifact}`],
    expected: "--live-log is required when drafting canary launch evidence",
  },
  {
    id: "canary-draft-missing-target-artifact",
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--network=linea-mainnet", "--chain-id=59144", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-mainnet-rpc", `--live-log=${canaryLog}`, `--recovery-artifact=${canaryRecoveryArtifact}`, `--session-artifact=${canarySessionArtifact}`, `--tx-artifact=${canaryTxArtifact}`],
    expected: "--target-artifact is required when drafting canary launch evidence",
  },
  {
    id: "canary-draft-directory-target-artifact",
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--network=linea-mainnet", "--chain-id=59144", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-mainnet-rpc", `--live-log=${canaryLog}`, `--target-artifact=${canaryDirectoryArtifact}`, `--recovery-artifact=${canaryRecoveryArtifact}`, `--session-artifact=${canarySessionArtifact}`, `--tx-artifact=${canaryTxArtifact}`],
    expected: "--target-artifact must point to an existing redacted artifact",
  },
  {
    id: "canary-draft-missing-recovery-artifact",
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--network=linea-mainnet", "--chain-id=59144", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-mainnet-rpc", `--live-log=${canaryLog}`, `--target-artifact=${canaryTargetArtifact}`, `--session-artifact=${canarySessionArtifact}`, `--tx-artifact=${canaryTxArtifact}`],
    expected: "--recovery-artifact is required when drafting canary launch evidence",
  },
  {
    id: "canary-draft-missing-session-artifact",
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--network=linea-mainnet", "--chain-id=59144", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-mainnet-rpc", `--live-log=${canaryLog}`, `--target-artifact=${canaryTargetArtifact}`, `--recovery-artifact=${canaryRecoveryArtifact}`, `--tx-artifact=${canaryTxArtifact}`],
    expected: "--session-artifact is required when drafting canary launch evidence",
  },
  {
    id: "canary-draft-missing-tx-artifact",
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--network=linea-mainnet", "--chain-id=59144", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-mainnet-rpc", `--live-log=${canaryLog}`, `--target-artifact=${canaryTargetArtifact}`, `--recovery-artifact=${canaryRecoveryArtifact}`, `--session-artifact=${canarySessionArtifact}`],
    expected: "--tx-artifact is required when drafting canary launch evidence",
  },
  {
    id: "canary-draft-empty-live-log",
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--network=linea-mainnet", "--chain-id=59144", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-mainnet-rpc", `--live-log=${emptyCanaryLog}`, `--target-artifact=${canaryTargetArtifact}`, `--recovery-artifact=${canaryRecoveryArtifact}`, `--session-artifact=${canarySessionArtifact}`, `--tx-artifact=${canaryTxArtifact}`],
    expected: "--live-log must include at least one successful auto-miner canary tx",
  },
  {
    id: "canary-draft-malformed-live-log",
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--network=linea-mainnet", "--chain-id=59144", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-mainnet-rpc", `--live-log=${canaryMalformedLiveLog}`, `--target-artifact=${canaryTargetArtifact}`, `--recovery-artifact=${canaryRecoveryArtifact}`, `--session-artifact=${canarySessionArtifact}`, `--tx-artifact=${canaryTxArtifact}`],
    expected: "Invalid JSONL at canary-malformed-live.jsonl:4: parse error",
  },
  {
    id: "canary-draft-non-object-live-log",
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--network=linea-mainnet", "--chain-id=59144", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-mainnet-rpc", `--live-log=${canaryNonObjectLiveLog}`, `--target-artifact=${canaryTargetArtifact}`, `--recovery-artifact=${canaryRecoveryArtifact}`, `--session-artifact=${canarySessionArtifact}`, `--tx-artifact=${canaryTxArtifact}`],
    expected: "Invalid JSONL at canary-non-object-live.jsonl:5: record must be an object",
  },
];

const strictRejectCases = [
  {
    id: "signoff-missing-local-artifact-ref",
    check: ["scripts/check-signoff-proof.mjs"],
    checkArgs: ["--strict", `--file=${signoffMissingArtifactManifest}`],
    env: signoffEnvPatch,
    expected: "local signoff artifact references must exist",
  },
  {
    id: "signoff-directory-local-artifact-ref",
    check: ["scripts/check-signoff-proof.mjs"],
    checkArgs: ["--strict", `--file=${signoffDirectoryArtifactManifest}`],
    env: signoffEnvPatch,
    expected: "local signoff artifact references must exist",
  },
  {
    id: "signoff-directory-manifest",
    check: ["scripts/check-signoff-proof.mjs"],
    checkArgs: ["--strict", `--file=${proofManifestDirectory}`],
    env: signoffEnvPatch,
    expected: "sign-off proof manifest must be a file",
  },
  {
    id: "signoff-irrelevant-env-artifact",
    check: ["scripts/check-signoff-proof.mjs"],
    checkArgs: ["--strict", `--file=${signoffIrrelevantEnvManifest}`],
    env: signoffEnvPatch,
    expected: "contractEnv evidence must mention proof:mainnet, env, contract, deploy, or chainId proof",
  },
  {
    id: "signoff-irrelevant-owner-artifact",
    check: ["scripts/check-signoff-proof.mjs"],
    checkArgs: ["--strict", `--file=${signoffIrrelevantOwnerManifest}`],
    env: signoffEnvPatch,
    expected: "ownership.directOwnerReadEvidence evidence must mention owner, Safe/multisig, governance, or direct-chain proof",
  },
  {
    id: "signoff-irrelevant-randomness-artifact",
    check: ["scripts/check-signoff-proof.mjs"],
    checkArgs: ["--strict", `--file=${signoffIrrelevantRandomnessManifest}`],
    env: signoffEnvPatch,
    expected: "randomness evidence must mention randomness decision or operator sign-off proof",
  },
  {
    id: "signoff-irrelevant-chain-artifact",
    check: ["scripts/check-signoff-proof.mjs"],
    checkArgs: ["--strict", `--file=${signoffIrrelevantChainManifest}`],
    env: signoffEnvPatch,
    expected: "chainComparison.jackpot evidence must mention jackpot, direct-chain, app, or indexer proof",
  },
  {
    id: "signoff-irrelevant-app-indexer-artifact",
    check: ["scripts/check-signoff-proof.mjs"],
    checkArgs: ["--strict", `--file=${signoffIrrelevantAppIndexerManifest}`],
    env: signoffEnvPatch,
    expected: "chainComparison.jackpot.appOrIndexerEvidence must mention jackpot and app/indexer proof",
  },
  {
    id: "signoff-shared-section-artifact",
    check: ["scripts/check-signoff-proof.mjs"],
    checkArgs: ["--strict", `--file=${signoffSharedSectionArtifactManifest}`],
    env: signoffEnvPatch,
    expected: "signoff evidence sections must use distinct local artifact files across contractEnv and randomness",
  },
  {
    id: "signoff-future-timestamp",
    check: ["scripts/check-signoff-proof.mjs"],
    checkArgs: ["--strict", `--file=${signoffFutureTimestampManifest}`],
    env: signoffEnvPatch,
    expected: "contractEnv.checkedAt must not be in the future",
  },
  {
    id: "signoff-unsafe-checked-epoch",
    check: ["scripts/check-signoff-proof.mjs"],
    checkArgs: ["--strict", `--file=${signoffUnsafeCheckedEpochManifest}`],
    env: signoffEnvPatch,
    expected: "chainComparison.jackpot.checkedEpochs must include at least one checked epoch",
  },
  {
    id: "host-missing-local-artifact-ref",
    check: ["scripts/check-host-proof.mjs"],
    checkArgs: ["--strict", `--file=${hostMissingArtifactManifest}`],
    expected: "local host artifact references must exist",
  },
  {
    id: "host-directory-local-artifact-ref",
    check: ["scripts/check-host-proof.mjs"],
    checkArgs: ["--strict", `--file=${hostDirectoryArtifactManifest}`],
    expected: "local host artifact references must exist",
  },
  {
    id: "host-directory-manifest",
    check: ["scripts/check-host-proof.mjs"],
    checkArgs: ["--strict", `--file=${proofManifestDirectory}`],
    expected: "host proof manifest must be a file",
  },
  {
    id: "host-irrelevant-process-evidence",
    check: ["scripts/check-host-proof.mjs"],
    checkArgs: ["--strict", `--file=${hostIrrelevantProcessManifest}`],
    expected: "processModel.lore-site evidence must mention lore-site in supervisor output",
  },
  {
    id: "host-irrelevant-persistent-artifact",
    check: ["scripts/check-host-proof.mjs"],
    checkArgs: ["--strict", `--file=${hostIrrelevantPersistentManifest}`],
    expected: "persistentDb evidence artifact must mention persistence, restart/reboot, or DB path proof",
  },
  {
    id: "host-irrelevant-health-artifact",
    check: ["scripts/check-host-proof.mjs"],
    checkArgs: ["--strict", `--file=${hostIrrelevantHealthManifest}`],
    expected: "healthProd evidence artifact must include [prod-health] OK, base, and canonical non-negative decimal finalityLagBlocks",
  },
  {
    id: "host-irrelevant-load-artifact",
    check: ["scripts/check-host-proof.mjs"],
    checkArgs: ["--strict", `--file=${hostIrrelevantLoadManifest}`],
    expected: "loadHttp evidence artifact must include Load base URL, TOTAL, and p95 output",
  },
  {
    id: "host-shared-section-artifact",
    check: ["scripts/check-host-proof.mjs"],
    checkArgs: ["--strict", `--file=${hostSharedSectionArtifactManifest}`],
    expected: "host evidence sections must use distinct local artifact files across processModel and persistentDb",
  },
  {
    id: "host-future-timestamp",
    check: ["scripts/check-host-proof.mjs"],
    checkArgs: ["--strict", `--file=${hostFutureTimestampManifest}`],
    expected: "processModel.lore-site.checkedAt must not be in the future",
  },
  {
    id: "host-credentialed-origin",
    check: ["scripts/check-host-proof.mjs"],
    checkArgs: ["--strict", `--file=${hostCredentialedOriginManifest}`],
    expected: "origin must be a final public HTTPS origin without path, query, or hash",
  },
  {
    id: "indexer-missing-local-artifact-ref",
    check: ["scripts/check-indexer-dry-run.mjs"],
    checkArgs: ["--strict", `--db=${hostExternalDbPath}`, `--manifest=${indexerMissingArtifactManifest}`],
    env: { INDEXER_START_BLOCK: "1", NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1", INDEXER_FINALITY_BLOCKS: "1" },
    expected: "local indexer artifact references must exist",
  },
  {
    id: "indexer-directory-local-artifact-ref",
    check: ["scripts/check-indexer-dry-run.mjs"],
    checkArgs: ["--strict", `--db=${hostExternalDbPath}`, `--manifest=${indexerDirectoryArtifactManifest}`],
    env: { INDEXER_START_BLOCK: "1", NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1", INDEXER_FINALITY_BLOCKS: "1" },
    expected: "local indexer artifact references must exist",
  },
  {
    id: "indexer-directory-manifest",
    check: ["scripts/check-indexer-dry-run.mjs"],
    checkArgs: ["--strict", `--db=${hostExternalDbPath}`, `--manifest=${proofManifestDirectory}`],
    env: { INDEXER_START_BLOCK: "1", NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1", INDEXER_FINALITY_BLOCKS: "1" },
    expected: "indexer proof manifest must be a file",
  },
  {
    id: "indexer-irrelevant-dry-run-artifact",
    check: ["scripts/check-indexer-dry-run.mjs"],
    checkArgs: ["--strict", `--db=${hostExternalDbPath}`, `--manifest=${indexerIrrelevantDryRunManifest}`],
    env: { INDEXER_START_BLOCK: "1", NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1", INDEXER_FINALITY_BLOCKS: "1" },
    expected: "dryRun evidence artifact must include [indexer] Deploy block and [indexer] Start block",
  },
  {
    id: "indexer-irrelevant-finality-artifact",
    check: ["scripts/check-indexer-dry-run.mjs"],
    checkArgs: ["--strict", `--db=${hostExternalDbPath}`, `--manifest=${indexerIrrelevantFinalityManifest}`],
    env: { INDEXER_START_BLOCK: "1", NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1", INDEXER_FINALITY_BLOCKS: "1" },
    expected: "finality evidence artifact must include health:prod base and canonical non-negative decimal finalityLagBlocks",
  },
  {
    id: "indexer-unsafe-finality-artifact",
    check: ["scripts/check-indexer-dry-run.mjs"],
    checkArgs: ["--strict", `--db=${hostExternalDbPath}`, `--manifest=${indexerUnsafeFinalityArtifactManifest}`],
    env: { INDEXER_START_BLOCK: "1", NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1", INDEXER_FINALITY_BLOCKS: "1" },
    expected: "finality evidence artifact must include health:prod base and canonical non-negative decimal finalityLagBlocks",
  },
  {
    id: "indexer-irrelevant-snapshot-artifact",
    check: ["scripts/check-indexer-dry-run.mjs"],
    checkArgs: ["--strict", `--db=${hostExternalDbPath}`, `--manifest=${indexerIrrelevantSnapshotManifest}`],
    env: { INDEXER_START_BLOCK: "1", NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1", INDEXER_FINALITY_BLOCKS: "1" },
    expected: "chainSnapshot.path artifact must include generatedAt, rpcChainId, and contractAddress",
  },
  {
    id: "indexer-irrelevant-comparison-artifact",
    check: ["scripts/check-indexer-dry-run.mjs"],
    checkArgs: ["--strict", `--db=${hostExternalDbPath}`, `--manifest=${indexerIrrelevantComparisonManifest}`],
    env: { INDEXER_START_BLOCK: "1", NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1", INDEXER_FINALITY_BLOCKS: "1" },
    expected: "chainComparison.jackpot evidence artifact must mention jackpot, direct-chain, chain comparison, or indexer proof",
  },
  {
    id: "indexer-shared-section-artifact",
    check: ["scripts/check-indexer-dry-run.mjs"],
    checkArgs: ["--strict", `--db=${hostExternalDbPath}`, `--manifest=${indexerSharedSectionArtifactManifest}`],
    env: { INDEXER_START_BLOCK: "1", NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1", INDEXER_FINALITY_BLOCKS: "1" },
    expected: "indexer evidence sections must use distinct local artifact files across dryRun and finality",
  },
  {
    id: "indexer-future-timestamp",
    check: ["scripts/check-indexer-dry-run.mjs"],
    checkArgs: ["--strict", `--db=${hostExternalDbPath}`, `--manifest=${indexerFutureTimestampManifest}`],
    env: { INDEXER_START_BLOCK: "1", NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1", INDEXER_FINALITY_BLOCKS: "1" },
    expected: "dryRun.timestamp must not be in the future",
  },
  {
    id: "indexer-unsafe-checked-epoch",
    check: ["scripts/check-indexer-dry-run.mjs"],
    checkArgs: ["--strict", `--db=${hostExternalDbPath}`, `--manifest=${indexerUnsafeCheckedEpochManifest}`],
    env: { INDEXER_START_BLOCK: "1", NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1", INDEXER_FINALITY_BLOCKS: "1" },
    expected: "chainComparison.jackpot.checkedEpochs must include at least one checked epoch",
  },
  {
    id: "restore-missing-local-artifact-ref",
    check: ["scripts/verify-db-restore.mjs"],
    checkArgs: ["--strict", `--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, `--manifest=${restoreMissingArtifactManifest}`],
    expected: "local restore artifact references must exist",
  },
  {
    id: "restore-directory-local-artifact-ref",
    check: ["scripts/verify-db-restore.mjs"],
    checkArgs: ["--strict", `--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, `--manifest=${restoreDirectoryArtifactManifest}`],
    expected: "local restore artifact references must exist",
  },
  {
    id: "restore-directory-manifest",
    check: ["scripts/verify-db-restore.mjs"],
    checkArgs: ["--strict", `--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, `--manifest=${proofManifestDirectory}`],
    expected: "restore proof manifest must be a file",
  },
  {
    id: "restore-irrelevant-backup-schedule-artifact",
    check: ["scripts/verify-db-restore.mjs"],
    checkArgs: ["--strict", `--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, `--manifest=${restoreIrrelevantScheduleManifest}`],
    expected: "backupSchedule evidence must mention recurring scheduler/backup proof",
  },
  {
    id: "restore-mismatched-latest-backup",
    check: ["scripts/verify-db-restore.mjs"],
    checkArgs: ["--strict", `--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, `--manifest=${restoreMismatchedLatestBackupManifest}`],
    expected: "backupSchedule evidence must include backupSchedule.lastSuccessfulBackupAt timestamp",
  },
  {
    id: "restore-mismatched-retention",
    check: ["scripts/verify-db-restore.mjs"],
    checkArgs: ["--strict", `--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, `--manifest=${restoreMismatchedRetentionManifest}`],
    expected: "backupSchedule evidence must include backupSchedule.retentionDays value",
  },
  {
    id: "restore-no-integrity-artifact",
    check: ["scripts/verify-db-restore.mjs"],
    checkArgs: ["--strict", `--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, `--manifest=${restoreNoIntegrityManifest}`],
    expected: "restoreDrill evidence must include restored SQLite integrity_check proof",
  },
  {
    id: "restore-irrelevant-preservation-artifact",
    check: ["scripts/verify-db-restore.mjs"],
    checkArgs: ["--strict", `--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, `--manifest=${restoreIrrelevantPreservationManifest}`],
    expected: "indexerPreservation evidence must mention heartbeat and latest indexed epoch before/after restore",
  },
  {
    id: "restore-shared-section-artifact",
    check: ["scripts/verify-db-restore.mjs"],
    checkArgs: ["--strict", `--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, `--manifest=${restoreSharedSectionManifest}`],
    expected: "restore evidence sections must use distinct local artifact files across backupSchedule and restoreDrill",
  },
  {
    id: "restore-future-timestamp",
    check: ["scripts/verify-db-restore.mjs"],
    checkArgs: ["--strict", `--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, `--manifest=${restoreFutureTimestampManifest}`],
    expected: "restoreDrill.timestamp must not be in the future",
  },
  {
    id: "restore-malformed-finality-lag",
    check: ["scripts/verify-db-restore.mjs"],
    checkArgs: ["--strict", `--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, `--manifest=${restoreMalformedFinalityManifest}`],
    expected: "restoredStagingHealth.evidence must include canonical non-negative decimal finalityLagBlocks from health:prod",
  },
  {
    id: "restore-unsafe-finality-lag",
    check: ["scripts/verify-db-restore.mjs"],
    checkArgs: ["--strict", `--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, `--manifest=${restoreUnsafeFinalityManifest}`],
    expected: "restoredStagingHealth.evidence must include canonical non-negative decimal finalityLagBlocks from health:prod",
  },
  {
    id: "restore-unsafe-indexed-epoch",
    check: ["scripts/verify-db-restore.mjs"],
    checkArgs: ["--strict", `--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, `--manifest=${restoreUnsafeIndexedEpochManifest}`],
    expected: "indexerPreservation.latestIndexedEpochBefore must be a non-negative integer",
  },
  {
    id: "monitoring-missing-local-artifact-ref",
    check: ["scripts/check-monitoring-proof.mjs"],
    checkArgs: ["--strict", `--file=${monitoringMissingArtifactManifest}`],
    expected: "local monitoring artifact references must exist",
  },
  {
    id: "monitoring-directory-local-artifact-ref",
    check: ["scripts/check-monitoring-proof.mjs"],
    checkArgs: ["--strict", `--file=${monitoringDirectoryArtifactManifest}`],
    expected: "local monitoring artifact references must exist",
  },
  {
    id: "monitoring-directory-manifest",
    check: ["scripts/check-monitoring-proof.mjs"],
    checkArgs: ["--strict", `--file=${proofManifestDirectory}`],
    expected: "monitoring proof manifest must be a file",
  },
  {
    id: "monitoring-irrelevant-alert-artifact",
    check: ["scripts/check-monitoring-proof.mjs"],
    checkArgs: ["--strict", `--file=${monitoringIrrelevantAlertManifest}`],
    expected: "fired-alert evidence must mention alert, monitor, fired, triggered, or incident proof",
  },
  {
    id: "monitoring-irrelevant-recovery-artifact",
    check: ["scripts/check-monitoring-proof.mjs"],
    checkArgs: ["--strict", `--file=${monitoringIrrelevantRecoveryManifest}`],
    expected: "recovery evidence must mention recovery, recovered, resolved, or resolution proof",
  },
  {
    id: "monitoring-shared-alert-recovery-artifact",
    check: ["scripts/check-monitoring-proof.mjs"],
    checkArgs: ["--strict", `--file=${monitoringSharedAlertRecoveryManifest}`],
    expected: "fired-alert and recovery evidence must use distinct artifact files",
  },
  {
    id: "monitoring-shared-section-artifact",
    check: ["scripts/check-monitoring-proof.mjs"],
    checkArgs: ["--strict", `--file=${monitoringSharedSectionManifest}`],
    expected: "monitoring evidence sections must use distinct local artifact files across monitors and alertTargets",
  },
  {
    id: "monitoring-irrelevant-alert-target-artifact",
    check: ["scripts/check-monitoring-proof.mjs"],
    checkArgs: ["--strict", `--file=${monitoringIrrelevantTargetManifest}`],
    expected: "alertTargets[0] evidence must mention alert target or notification channel proof",
  },
  {
    id: "monitoring-missing-email-recipient",
    check: ["scripts/check-monitoring-proof.mjs"],
    checkArgs: ["--strict", `--file=${monitoringMissingRecipientManifest}`],
    expected: "alertTargets[0] email target must record the recipient address or recipient evidence",
  },
  {
    id: "monitoring-invalid-email-recipient",
    check: ["scripts/check-monitoring-proof.mjs"],
    checkArgs: ["--strict", `--file=${monitoringInvalidRecipientManifest}`],
    expected: "alertTargets[0] email target must record the recipient address or recipient evidence",
  },
  {
    id: "monitoring-future-timestamp",
    check: ["scripts/check-monitoring-proof.mjs"],
    checkArgs: ["--strict", `--file=${monitoringFutureTimestampManifest}`],
    expected: "monitor kind health-prod alert test timestamp must not be in the future",
  },
  {
    id: "monitoring-malformed-health-cadence",
    check: ["scripts/check-monitoring-proof.mjs"],
    checkArgs: ["--strict", `--file=${monitoringMalformedCadenceManifest}`],
    expected: "health-prod monitor cadence must be a canonical positive integer",
  },
  {
    id: "monitoring-unsafe-health-cadence",
    check: ["scripts/check-monitoring-proof.mjs"],
    checkArgs: ["--strict", `--file=${monitoringUnsafeCadenceManifest}`],
    expected: "health-prod monitor cadence must be a canonical positive integer",
  },
  {
    id: "monitoring-credentialed-origin",
    check: ["scripts/check-monitoring-proof.mjs"],
    checkArgs: ["--strict", `--file=${monitoringCredentialedOriginManifest}`],
    expected: "origin must be a final public HTTPS origin without path, query, or hash",
  },
  {
    id: "monitoring-credentialed-monitor-url",
    check: ["scripts/check-monitoring-proof.mjs"],
    checkArgs: ["--strict", `--file=${monitoringCredentialedUrlManifest}`],
    expected: "health-prod monitor must record the monitored HTTPS URL",
  },
  {
    id: "monitoring-irrelevant-error-event-artifact",
    check: ["scripts/check-monitoring-proof.mjs"],
    checkArgs: ["--strict", `--file=${monitoringIrrelevantErrorManifest}`],
    expected: "error tracking test event evidence must mention error, exception, event, issue, or provider proof",
  },
  {
    id: "qa-missing-local-artifact-ref",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaMissingArtifactManifest}`],
    expected: "local QA artifact references must exist",
  },
  {
    id: "qa-directory-local-artifact-ref",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaDirectoryArtifactManifest}`],
    expected: "local QA artifact references must exist",
  },
  {
    id: "qa-directory-manifest",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${proofManifestDirectory}`],
    expected: "QA proof manifest must be a file",
  },
  {
    id: "qa-irrelevant-wallet-artifact",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaIrrelevantWalletManifest}`],
    expected: "wallet.privyAllowedOrigins evidence must mention Privy dashboard allowed-origin production proof",
  },
  {
    id: "qa-irrelevant-failure-artifact",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaIrrelevantFailureManifest}`],
    expected: "failureStateUx.disabledActionsExplainReason evidence must mention failure-state/pending/degraded/no-op UX proof",
  },
  {
    id: "qa-irrelevant-support-artifact",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaIrrelevantSupportManifest}`],
    expected: "supportAuditVisibility.betHistoryFields evidence must mention support/audit/diagnostics visibility proof",
  },
  {
    id: "qa-irrelevant-final-artifact",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaIrrelevantFinalManifest}`],
    expected: "finalQa.mobileLayout evidence must mention final browser/mobile/mainnet wording QA proof",
  },
  {
    id: "qa-irrelevant-smoke-artifact",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaIrrelevantSmokeManifest}`],
    expected: "finalQa.browserSmokeDebugAutominer evidence must mention debug autominer browser smoke proof",
  },
  {
    id: "qa-clean-wallet-no-receipt",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaCleanWalletNoReceiptManifest}`],
    expected: "wallet.cleanWalletFirstTx evidence must include receipt/explorer confirmation proof",
  },
  {
    id: "qa-mobile-no-device-proof",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaMobileNoDeviceManifest}`],
    expected: "wallet.mobileWeb3Browser evidence must include mobile device, wallet app, or viewport proof",
  },
  {
    id: "qa-mobile-touch-only-proof",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaMobileTouchOnlyManifest}`],
    expected: "wallet.mobileWeb3Browser evidence must include mobile device, wallet app, or viewport proof",
  },
  {
    id: "qa-shared-group-artifact",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaSharedGroupArtifactManifest}`],
    expected: "QA evidence groups must use distinct local artifact files across wallet and failureStateUx",
  },
  {
    id: "qa-future-timestamp",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaFutureTimestampManifest}`],
    expected: "wallet.desktopConnect.checkedAt must not be in the future",
  },
  {
    id: "qa-unsafe-target-chain-id",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaUnsafeTargetChainManifest}`],
    expected: "targetChainId must be a positive integer",
  },
  {
    id: "qa-missing-security-scan",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaMissingSecurityScanManifest}`],
    expected: "securityScan must reference a sealed canonical scan bundle",
  },
  {
    id: "qa-wrong-candidate-revision",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaWrongCandidateRevisionManifest}`],
    expected: "securityScan.candidateRevision must match the exact immutable candidate revision",
  },
  {
    id: "qa-wrong-scan-manifest-digest",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaWrongScanManifestDigestManifest}`],
    expected: "securityScan.scan-manifest.json digest does not match manifestSha256",
  },
  {
    id: "qa-unsealed-security-scan",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaUnsealedSecurityScanManifest}`],
    expected: "security scan bundle must be completed and sealed",
  },
  {
    id: "qa-dirty-candidate-checkout",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaValidStrictManifestPath}`],
    cwd: qaDirtyCandidate.repoPath,
    expected: "candidate checkout must have no staged, unstaged, or untracked files relative to exact HEAD",
  },
  {
    id: "qa-stale-signed-security-scan",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaStaleSecurityScanManifest}`],
    expected: "security scan completion and seal must be within the last 24 hours",
  },
  {
    id: "qa-expired-security-attestation",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaExpiredSecurityAttestationManifest}`],
    expected: "securityScan.attestation has expired",
  },
  {
    id: "qa-commit-mode-security-scan",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaCommitModeSecurityScanManifest}`],
    expected: "security scan coverage must be complete for the full repository without deferrals or exclusions",
  },
  {
    id: "qa-custom-inventory-security-scan",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaCustomInventorySecurityScanManifest}`],
    expected: "security scan coverage must be complete for the full repository without deferrals or exclusions",
  },
  {
    id: "qa-security-artifact-digest-mismatch",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaArtifactDigestMismatchManifest}`],
    expected: "security scan artifact digest mismatch: findings.json",
  },
  {
    id: "qa-open-medium-security-finding",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaOpenMediumSecurityFindingManifest}`],
    expected: "security scan must contain zero open Critical/High/Medium findings",
  },
  {
    id: "qa-unsigned-security-attestation",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaUnsignedSecurityScanManifest}`],
    expected: "securityScan.attestation must contain an independent reviewer signature",
  },
  {
    id: "qa-self-authored-security-attestation",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaSelfAuthoredSecurityScanManifest}`],
    expected: "securityScan.attestation must not supply its own reviewer authority",
  },
  {
    id: "qa-tampered-security-attestation",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaTamperedSecurityAttestationManifest}`],
    expected: "securityScan.attestation signature is invalid for the canonical scan payload",
  },
  {
    id: "qa-missing-reviewer-trust-anchor",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaValidStrictManifestPath}`],
    env: { [G14_TRUSTED_KEY_ENV]: "" },
    expected: `${G14_TRUSTED_KEY_ENV} protected trust anchor is required`,
  },
  {
    id: "qa-valid-local-verifier-remains-external-required",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaValidStrictManifestPath}`],
    env: {
      GIT_CONFIG_GLOBAL: qaSpoofedGitConfig,
      GIT_DIR: join(qaDirtyCandidate.repoPath, ".git"),
      GIT_WORK_TREE: qaDirtyCandidate.repoPath,
      PATH: tmp,
    },
    expected: G14_EXTERNAL_REQUIRED_MESSAGE,
    expectedAlso: ["G14: local-verifier=passed; launch-status=external-required"],
  },
  {
    id: "qa-deep-repository-local-verifier-remains-external-required",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaDeepRepositorySecurityScanManifest}`],
    expected: G14_EXTERNAL_REQUIRED_MESSAGE,
    expectedAlso: ["G14: local-verifier=passed; launch-status=external-required"],
  },
  {
    id: "canary-irrelevant-target-artifact",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryFullLog, "--strict", `--manifest=${canaryIrrelevantTargetManifest}`],
    expected: "targetNetwork evidence must mention target RPC, chain, or Linea mainnet launch proof",
  },
  {
    id: "canary-irrelevant-recovery-artifact",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryFullLog, "--strict", `--manifest=${canaryIrrelevantRecoveryManifest}`],
    expected: "recovery.reload evidence must mention reload, reconnect, tab-close, pending-tx, remount, or recovery proof",
  },
  {
    id: "canary-irrelevant-session-artifact",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryFullLog, "--strict", `--manifest=${canaryIrrelevantSessionManifest}`],
    expected: "autoMinerSession evidence must mention auto-miner session, rounds, epochs, or target RPC proof",
  },
  {
    id: "canary-irrelevant-transaction-artifact",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryFullLog, "--strict", `--manifest=${canaryIrrelevantTxManifest}`],
    expected: "transactionHealth evidence must mention transaction, tx, nonce, duplicate, stuck pending, or pending recovery proof",
  },
  {
    id: "canary-shared-section-artifact",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryFullLog, "--strict", `--manifest=${canarySharedSectionManifest}`],
    expected: "canary evidence sections must use distinct local artifact files across targetNetwork and recovery",
  },
  {
    id: "canary-missing-local-artifact-ref",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryFullLog, "--strict", `--manifest=${canaryMissingArtifactManifest}`],
    expected: "local canary artifact references must exist",
  },
  {
    id: "canary-directory-local-artifact-ref",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryFullLog, "--strict", `--manifest=${canaryDirectoryArtifactManifest}`],
    expected: "local canary artifact references must exist",
  },
  {
    id: "canary-future-timestamp",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryFullLog, "--strict", `--manifest=${canaryFutureTimestampManifest}`],
    expected: "targetNetwork.checkedAt must not be in the future",
  },
  {
    id: "canary-malformed-target-chain-id",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryFullLog, "--strict", `--manifest=${canaryMalformedChainIdManifest}`],
    expected: "targetNetwork.chainId must be a canonical positive decimal integer",
  },
  {
    id: "canary-malformed-session-counts",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryFullLog, "--strict", `--manifest=${canaryMalformedSessionCountsManifest}`],
    expected: "autoMinerSession.rounds must be a positive integer",
  },
  {
    id: "canary-duplicate-session-roles",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryFullLog, "--strict", `--manifest=${canaryDuplicateSessionRolesManifest}`],
    expected: "autoMinerSession.successfulRoles contains duplicate role entries 2",
  },
  {
    id: "canary-malformed-transaction-hashes",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryFullLog, "--strict", `--manifest=${canaryMalformedTransactionHashesManifest}`],
    expected: "transactionHealth.txHashes contains malformed tx hash entries 1",
  },
  {
    id: "canary-duplicate-transaction-hashes",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryFullLog, "--strict", `--manifest=${canaryDuplicateTransactionHashesManifest}`],
    expected: "transactionHealth.txHashes contains duplicate tx hash entries 1",
  },
  {
    id: "canary-live-log-malformed-chain-id",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryMalformedChainIdLog, "--strict", `--manifest=${canaryValidStrictManifestPath}`],
    expected: "target metadata mismatches",
  },
  {
    id: "canary-live-log-malformed-nonce",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryMalformedNonceLog, "--strict", `--manifest=${canaryValidStrictManifestPath}`],
    expected: "malformed nonce evidence 1",
  },
  {
    id: "canary-live-log-unsafe-nonce",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryUnsafeNonceLog, "--strict", `--manifest=${canaryValidStrictManifestPath}`],
    expected: "malformed nonce evidence 1",
  },
  {
    id: "canary-live-log-duplicate-nonce",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryDuplicateNonceLog, "--strict", `--manifest=${canaryValidStrictManifestPath}`],
    expected: "duplicate successful nonce keys 1",
  },
  {
    id: "canary-live-log-duplicate-role-epoch",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryDuplicateRoleEpochLog, "--strict", `--manifest=${canaryValidStrictManifestPath}`],
    expected: "duplicate successful role/epoch keys 1",
  },
  {
    id: "canary-live-log-malformed-tile",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryMalformedTileLog, "--strict", `--manifest=${canaryValidStrictManifestPath}`],
    expected: "malformed bet tile evidence 1",
  },
  {
    id: "canary-live-log-malformed-timestamp",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryMalformedTimestampLog, "--strict", `--manifest=${canaryValidStrictManifestPath}`],
    expected: "malformed bet timestamp evidence 1",
  },
  {
    id: "canary-live-log-malformed-epoch",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryMalformedEpochLog, "--strict", `--manifest=${canaryValidStrictManifestPath}`],
    expected: "malformed bet epoch evidence 1",
  },
  {
    id: "canary-live-log-unsafe-epoch",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryUnsafeEpochLog, "--strict", `--manifest=${canaryValidStrictManifestPath}`],
    expected: "malformed bet epoch evidence 1",
  },
  {
    id: "canary-live-log-malformed-tx-metric",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryMalformedTxMetricLog, "--strict", `--manifest=${canaryValidStrictManifestPath}`],
    expected: "malformed successful tx metric evidence 1",
  },
  {
    id: "canary-live-log-unsafe-tx-metric",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryUnsafeTxMetricLog, "--strict", `--manifest=${canaryValidStrictManifestPath}`],
    expected: "malformed successful tx metric evidence 1",
  },
  {
    id: "canary-live-log-template-value",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryTemplateLiveLog, "--strict", `--manifest=${canaryValidStrictManifestPath}`],
    expected: "live canary log contains template-like values",
  },
  {
    id: "canary-live-log-secret-value",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canarySecretLiveLog, "--strict", `--manifest=${canaryValidStrictManifestPath}`],
    expected: "live canary log contains secret-like values",
  },
  {
    id: "canary-live-log-unsafe-error-text",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryUnsafeErrorLiveLog, "--strict", `--manifest=${canaryValidStrictManifestPath}`],
    expected: "live canary log contains unsafe error text",
  },
  {
    id: "canary-live-log-unsafe-diagnostic-text",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryUnsafeDiagnosticLiveLog, "--strict", `--manifest=${canaryValidStrictManifestPath}`],
    expected: "live canary log contains unsafe error text",
  },
  {
    id: "canary-live-log-malformed-jsonl",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryMalformedLiveLog, "--strict", `--manifest=${canaryValidStrictManifestPath}`],
    expected: "Invalid JSONL at",
  },
  {
    id: "canary-live-log-malformed-jsonl-summary",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryMalformedLiveLog, "--strict", "--summary-only", `--manifest=${canaryValidStrictManifestPath}`],
    expected: "live canary log contains invalid JSONL at line 4: parse error",
  },
  {
    id: "canary-live-log-non-object-jsonl",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryNonObjectLiveLog, "--strict", `--manifest=${canaryValidStrictManifestPath}`],
    expected: "record must be an object",
  },
  {
    id: "canary-unexpected-successful-role",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryUnexpectedRoleLog, "--strict", `--manifest=${canaryValidStrictManifestPath}`],
    expected: "unexpected successful canary roles: AUTOMINER_C",
  },
  {
    id: "canary-live-log-malformed-role",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryMalformedRoleLog, "--strict", `--manifest=${canaryValidStrictManifestPath}`],
    expected: "malformed successful role evidence 1",
  },
  {
    id: "canary-live-log-failed-preflight",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryFailedPreflightLog, "--strict", `--manifest=${canaryValidStrictManifestPath}`],
    expected: "failed preflight checks 1",
  },
];

const finalOutputCases = [
  {
    id: "signoff-draft-missing-env-log",
    create: ["scripts/create-signoff-proof-draft.mjs"],
    createArgs: [`--chain-log=${signoffChainLog}`],
    expected: "--env-log is required when drafting signoff launch evidence",
  },
  {
    id: "signoff-draft-failed-env-log",
    create: ["scripts/create-signoff-proof-draft.mjs"],
    createArgs: [`--env-log=${signoffFailedEnvLog}`, `--chain-log=${signoffChainLog}`],
    expected: "--env-log must contain successful proof:mainnet summary",
  },
  {
    id: "signoff-draft-weak-chain-log",
    create: ["scripts/create-signoff-proof-draft.mjs"],
    createArgs: [`--env-log=${signoffEnvLog}`, `--chain-log=${signoffWeakChainLog}`],
    expected: "--chain-log must contain direct-chain comparison evidence for jackpot, safetyPool, deposits, rewards, rebates, and resolve",
  },
  {
    id: "signoff-draft-shared-artifact-input",
    create: ["scripts/create-signoff-proof-draft.mjs"],
    createArgs: [`--env-log=${signoffEnvLog}`, `--chain-log=${signoffEnvLog}`],
    expected: "--env-log and --chain-log must point to distinct signoff evidence files",
  },
  {
    id: "signoff-draft-directory-env-log",
    create: ["scripts/create-signoff-proof-draft.mjs"],
    createArgs: [`--env-log=${signoffDirectoryArtifact}`, `--chain-log=${signoffChainLog}`],
    expected: "--env-log must point to an existing redacted artifact",
  },
  {
    id: "signoff-final-output",
    create: ["scripts/create-signoff-proof-draft.mjs"],
    createArgs: ["--out=docs/signoff-proof.json"],
    expected: "writes incomplete drafts only",
  },
  {
    id: "host-draft-missing-health-log",
    create: ["scripts/create-host-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`, `--load-log=${hostLoadLog}`],
    expected: "--health-log is required when drafting host launch evidence",
  },
  {
    id: "host-draft-credentialed-origin",
    create: ["scripts/create-host-proof-draft.mjs"],
    createArgs: ["--origin=https://user:pass@playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`, `--health-log=${hostHealthLog}`, `--load-log=${hostLoadLog}`],
    expected: "--origin must be a public HTTPS origin without path, query, or hash",
  },
  {
    id: "host-draft-missing-health-base",
    create: ["scripts/create-host-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`, `--health-log=${hostHealthMissingBaseLog}`, `--load-log=${hostLoadLog}`],
    expected: "--health-log must include base=<production origin>",
  },
  {
    id: "host-draft-credentialed-health-base",
    create: ["scripts/create-host-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`, `--health-log=${hostHealthCredentialedBaseLog}`, `--load-log=${hostLoadLog}`],
    expected: "--health-log base must match --origin",
  },
  {
    id: "host-draft-malformed-finality-lag",
    create: ["scripts/create-host-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`, `--health-log=${hostHealthMalformedFinalityLog}`, `--load-log=${hostLoadLog}`],
    expected: "--health-log must include canonical non-negative decimal finalityLagBlocks=<number>",
  },
  {
    id: "host-draft-unsafe-finality-lag",
    create: ["scripts/create-host-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`, `--health-log=${hostHealthUnsafeFinalityLog}`, `--load-log=${hostLoadLog}`],
    expected: "--health-log must include canonical non-negative decimal finalityLagBlocks=<number>",
  },
  {
    id: "host-draft-missing-load-base",
    create: ["scripts/create-host-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`, `--health-log=${hostHealthLog}`, `--load-log=${hostLoadMissingBaseLog}`],
    expected: "--load-log must include Load base URL line",
  },
  {
    id: "host-draft-credentialed-load-base",
    create: ["scripts/create-host-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`, `--health-log=${hostHealthLog}`, `--load-log=${hostLoadCredentialedBaseLog}`],
    expected: "--load-log Load base URL must match --load-origin",
  },
  {
    id: "host-draft-shared-artifact-input",
    create: ["scripts/create-host-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostSharedSectionArtifact}`, `--health-log=${hostSharedSectionArtifact}`, `--load-log=${hostLoadLog}`],
    expected: "--process-evidence and --health-log must point to distinct host evidence files",
  },
  {
    id: "host-draft-directory-process-evidence",
    create: ["scripts/create-host-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostDirectoryArtifact}`, `--health-log=${hostHealthLog}`, `--load-log=${hostLoadLog}`],
    expected: "--process-evidence must point to an existing redacted artifact",
  },
  {
    id: "host-final-output",
    create: ["scripts/create-host-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", "--out=docs/host-proof.json"],
    expected: "writes incomplete drafts only",
  },
  {
    id: "indexer-draft-missing-indexer-log",
    create: ["scripts/create-indexer-proof-draft.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--start-block=1", "--finality-blocks=1", `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshot}`],
    expected: "--indexer-log is required when drafting indexer launch evidence",
  },
  {
    id: "indexer-draft-repo-db",
    create: ["scripts/create-indexer-proof-draft.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--start-block=1", "--finality-blocks=1", `--indexer-log=${indexerRepoDbLog}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshot}`],
    expected: "--indexer-log [indexer] SQLite path must be outside the repo checkout",
  },
  {
    id: "indexer-draft-missing-health-base",
    create: ["scripts/create-indexer-proof-draft.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthMissingBaseLog}`, `--chain-snapshot=${indexerChainSnapshot}`],
    expected: "--health-log must include base=<production origin>",
  },
  {
    id: "indexer-draft-credentialed-health-base",
    create: ["scripts/create-indexer-proof-draft.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthCredentialedBaseLog}`, `--chain-snapshot=${indexerChainSnapshot}`],
    expected: "--health-log must include base=<production origin>",
  },
  {
    id: "indexer-draft-malformed-finality-lag",
    create: ["scripts/create-indexer-proof-draft.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthMalformedFinalityLog}`, `--chain-snapshot=${indexerChainSnapshot}`],
    expected: "--health-log must include canonical non-negative decimal finalityLagBlocks=<number>",
  },
  {
    id: "indexer-draft-unsafe-finality-lag",
    create: ["scripts/create-indexer-proof-draft.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthUnsafeFinalityLog}`, `--chain-snapshot=${indexerChainSnapshot}`],
    expected: "--health-log must include canonical non-negative decimal finalityLagBlocks=<number>",
  },
  {
    id: "indexer-draft-directory-indexer-log",
    create: ["scripts/create-indexer-proof-draft.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--start-block=1", "--finality-blocks=1", `--indexer-log=${indexerDirectoryArtifact}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshot}`],
    expected: "--indexer-log must point to an existing redacted artifact",
  },
  {
    id: "indexer-draft-shared-artifact-input",
    create: ["scripts/create-indexer-proof-draft.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--start-block=1", "--finality-blocks=1", `--indexer-log=${indexerSharedSectionArtifact}`, `--health-log=${indexerSharedSectionArtifact}`, `--chain-snapshot=${indexerChainSnapshot}`],
    expected: "--indexer-log and --health-log must point to distinct indexer evidence files",
  },
  {
    id: "indexer-draft-missing-snapshot-generated-at",
    create: ["scripts/create-indexer-proof-draft.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--start-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshotMissingGeneratedAt}`],
    expected: "--chain-snapshot must include generatedAt as ISO-8601 UTC",
  },
  {
    id: "indexer-draft-too-few-snapshot-epochs",
    create: ["scripts/create-indexer-proof-draft.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=2", "--chain-id=59144", "--deploy-block=1", "--start-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshotTooFewEpochs}`],
    expected: "--chain-snapshot epochs must include at least --epochs unique checked epochs",
  },
  {
    id: "indexer-draft-credentialed-rpc-source",
    create: ["scripts/create-indexer-proof-draft.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--start-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshotCredentialedRpc}`],
    expected: "--chain-snapshot rpcSource must be a redacted label or origin-only URL",
  },
  {
    id: "indexer-draft-malformed-chain-id",
    create: ["scripts/create-indexer-proof-draft.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--start-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshotMalformedChainId}`],
    expected: "--chain-snapshot expectedChainId must be a canonical positive decimal integer",
  },
  {
    id: "indexer-draft-malformed-chain-snapshot",
    create: ["scripts/create-indexer-proof-draft.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--start-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshotMalformed}`],
    expected: "--chain-snapshot must be valid JSON",
  },
  {
    id: "indexer-draft-directory-chain-snapshot",
    create: ["scripts/create-indexer-proof-draft.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--start-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerDirectoryArtifact}`],
    expected: "--chain-snapshot must point to an existing redacted JSON artifact",
  },
  {
    id: "indexer-draft-non-object-chain-snapshot",
    create: ["scripts/create-indexer-proof-draft.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--start-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshotNonObject}`],
    expected: "must be a JSON object artifact",
  },  {
    id: "indexer-final-output",
    create: ["scripts/create-indexer-proof-draft.mjs"],
    createArgs: ["--out=docs/indexer-proof.json"],
    expected: "writes incomplete drafts only",
  },
  {
    id: "restore-draft-missing-restore-log",
    create: ["scripts/create-restore-proof-draft.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--health-log=${restoreHealthLog}`, `--backup-schedule-artifact=${restoreBackupScheduleArtifact}`, `--preservation-artifact=${restorePreservationArtifact}`],
    expected: "--restore-log is required when drafting restore launch evidence",
  },
  {
    id: "restore-draft-missing-backup",
    create: ["scripts/create-restore-proof-draft.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${restoreLog}`, `--health-log=${restoreHealthLog}`, `--backup-schedule-artifact=${restoreBackupScheduleArtifact}`, `--preservation-artifact=${restorePreservationArtifact}`],
    expected: "--backup is required when drafting restore launch evidence",
  },
  {
    id: "restore-draft-failed-restore-log",
    create: ["scripts/create-restore-proof-draft.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${signoffChainLog}`, `--health-log=${restoreHealthLog}`, `--backup-schedule-artifact=${restoreBackupScheduleArtifact}`, `--preservation-artifact=${restorePreservationArtifact}`],
    expected: "--restore-log must include successful restore drill summary",
  },
  {
    id: "restore-draft-missing-runtime",
    create: ["scripts/create-restore-proof-draft.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${restoreLog}`, `--health-log=${restoreHealthMissingRuntimeLog}`, `--backup-schedule-artifact=${restoreBackupScheduleArtifact}`, `--preservation-artifact=${restorePreservationArtifact}`],
    expected: "--health-log must include runtime=ok/pass/healthy",
  },
  {
    id: "restore-draft-malformed-finality-lag",
    create: ["scripts/create-restore-proof-draft.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${restoreLog}`, `--health-log=${restoreHealthMalformedFinalityLog}`, `--backup-schedule-artifact=${restoreBackupScheduleArtifact}`, `--preservation-artifact=${restorePreservationArtifact}`],
    expected: "--health-log must include canonical non-negative decimal finalityLagBlocks=<number>",
  },
  {
    id: "restore-draft-unsafe-finality-lag",
    create: ["scripts/create-restore-proof-draft.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${restoreLog}`, `--health-log=${restoreHealthUnsafeFinalityLog}`, `--backup-schedule-artifact=${restoreBackupScheduleArtifact}`, `--preservation-artifact=${restorePreservationArtifact}`],
    expected: "--health-log must include canonical non-negative decimal finalityLagBlocks=<number>",
  },
  {
    id: "restore-draft-credentialed-health-base",
    create: ["scripts/create-restore-proof-draft.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${restoreLog}`, `--health-log=${restoreHealthCredentialedBaseLog}`, `--backup-schedule-artifact=${restoreBackupScheduleArtifact}`, `--preservation-artifact=${restorePreservationArtifact}`],
    expected: "--health-log must include base=<restored-origin>",
  },
  {
    id: "restore-draft-missing-backup-schedule-artifact",
    create: ["scripts/create-restore-proof-draft.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${restoreLog}`, `--health-log=${restoreHealthLog}`, `--preservation-artifact=${restorePreservationArtifact}`],
    expected: "--backup-schedule-artifact is required when drafting restore launch evidence",
  },
  {
    id: "restore-draft-missing-preservation-artifact",
    create: ["scripts/create-restore-proof-draft.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${restoreLog}`, `--health-log=${restoreHealthLog}`, `--backup-schedule-artifact=${restoreBackupScheduleArtifact}`],
    expected: "--preservation-artifact is required when drafting restore launch evidence",
  },
  {
    id: "restore-draft-directory-backup-schedule-artifact",
    create: ["scripts/create-restore-proof-draft.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${restoreLog}`, `--health-log=${restoreHealthLog}`, `--backup-schedule-artifact=${restoreDirectoryArtifact}`, `--preservation-artifact=${restorePreservationArtifact}`],
    expected: "must point to an existing redacted file artifact",
  },
  {
    id: "restore-draft-shared-artifact-input",
    create: ["scripts/create-restore-proof-draft.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${restoreSharedSectionArtifact}`, `--health-log=${restoreSharedSectionArtifact}`, `--backup-schedule-artifact=${restoreBackupScheduleArtifact}`, `--preservation-artifact=${restorePreservationArtifact}`],
    expected: "--restore-log and --health-log must point to distinct restore evidence files",
  },  {
    id: "restore-final-output",
    create: ["scripts/create-restore-proof-draft.mjs"],
    createArgs: ["--out=docs/restore-proof.json"],
    expected: "writes incomplete drafts only",
  },
  {
    id: "qa-final-output",
    create: ["scripts/create-qa-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--network=linea-mainnet", "--chain-id=59144", "--out=docs/qa-proof.json"],
    expected: "writes incomplete drafts only",
  },
  {
    id: "qa-draft-unsafe-chain-id",
    create: ["scripts/create-qa-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--network=linea-mainnet", "--chain-id=9999999999999999", `--wallet-artifact=${qaWalletArtifact}`, `--failure-artifact=${qaFailureArtifact}`, `--support-artifact=${qaSupportArtifact}`, `--finalqa-artifact=${qaFinalArtifact}`, `--smoke-artifact=${qaSmokeArtifact}`, "--clean-wallet-tx=0x1111111111111111111111111111111111111111111111111111111111111111"],
    expected: "--chain-id must be a positive integer or derivable from --network",
  },
  {
    id: "qa-canary-plan-unsafe-chain-id",
    create: ["scripts/create-qa-canary-test-plan.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--network=linea-mainnet", "--chain-id=9999999999999999", `--out=${join(tmp, "qa-canary-test-plan-unsafe-chain-id.md")}`],
    expected: "--chain-id must be a positive integer or derivable from --network",
  },
  {
    id: "canary-final-output",
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--network=linea-mainnet", "--chain-id=59144", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-mainnet-rpc", "--out=docs/canary-proof.json"],
    expected: "writes incomplete drafts only",
  },
  {
    id: "canary-testnet-final-output",
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--profile=testnet", "--network=linea-sepolia", "--chain-id=59141", "--out=docs/testnet-canary-proof.json"],
    expected: "writes incomplete drafts only",
  },
  {
    id: "canary-draft-malformed-chain-id",
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--network=linea-mainnet", "--chain-id=59144.0", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-mainnet-rpc", `--live-log=${canaryFullLog}`, `--target-artifact=${canaryTargetArtifact}`, `--recovery-artifact=${canaryRecoveryArtifact}`, `--session-artifact=${canarySessionArtifact}`, `--tx-artifact=${canaryTxArtifact}`],
    expected: "--chain-id must be a canonical positive decimal integer",
  },
  {
    id: "canary-draft-malformed-live-chain-id",
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--network=linea-mainnet", "--chain-id=59144", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-mainnet-rpc", `--live-log=${canaryMalformedChainIdLog}`, `--target-artifact=${canaryTargetArtifact}`, `--recovery-artifact=${canaryRecoveryArtifact}`, `--session-artifact=${canarySessionArtifact}`, `--tx-artifact=${canaryTxArtifact}`],
    expected: "--live-log target metadata must match --network, --chain-id, --contract, and --rpc-label",
  },
  {
    id: "canary-shared-draft-target-recovery-artifact",
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--network=linea-mainnet", "--chain-id=59144", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-mainnet-rpc", `--live-log=${canaryFullLog}`, `--target-artifact=${canarySharedSectionArtifact}`, `--recovery-artifact=${canarySharedSectionArtifact}`, `--session-artifact=${canarySessionArtifact}`, `--tx-artifact=${canaryTxArtifact}`],
    expected: "--target-artifact and --recovery-artifact must point to distinct canary evidence files",
  },
  {
    id: "qa-missing-wallet-artifact",
    create: ["scripts/create-qa-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--network=linea-mainnet", "--chain-id=59144", `--failure-artifact=${qaFailureArtifact}`, `--support-artifact=${qaSupportArtifact}`, `--finalqa-artifact=${qaFinalArtifact}`, `--smoke-artifact=${qaSmokeArtifact}`, "--clean-wallet-tx=0x1111111111111111111111111111111111111111111111111111111111111111"],
    expected: "--wallet-artifact is required when drafting QA launch evidence",
  },
  {
    id: "qa-missing-failure-artifact",
    create: ["scripts/create-qa-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--network=linea-mainnet", "--chain-id=59144", `--wallet-artifact=${qaWalletArtifact}`, `--support-artifact=${qaSupportArtifact}`, `--finalqa-artifact=${qaFinalArtifact}`, `--smoke-artifact=${qaSmokeArtifact}`, "--clean-wallet-tx=0x1111111111111111111111111111111111111111111111111111111111111111"],
    expected: "--failure-artifact is required when drafting QA launch evidence",
  },
  {
    id: "qa-directory-wallet-artifact",
    create: ["scripts/create-qa-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--network=linea-mainnet", "--chain-id=59144", `--wallet-artifact=${qaDirectoryArtifact}`, `--failure-artifact=${qaFailureArtifact}`, `--support-artifact=${qaSupportArtifact}`, `--finalqa-artifact=${qaFinalArtifact}`, `--smoke-artifact=${qaSmokeArtifact}`, "--clean-wallet-tx=0x1111111111111111111111111111111111111111111111111111111111111111"],
    expected: "--wallet-artifact must point to an existing redacted file artifact",
  },
  {
    id: "qa-shared-wallet-failure-artifact",
    create: ["scripts/create-qa-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--network=linea-mainnet", "--chain-id=59144", `--wallet-artifact=${qaWalletArtifact}`, `--failure-artifact=${qaWalletArtifact}`, `--support-artifact=${qaSupportArtifact}`, `--finalqa-artifact=${qaFinalArtifact}`, `--smoke-artifact=${qaSmokeArtifact}`, "--clean-wallet-tx=0x1111111111111111111111111111111111111111111111111111111111111111"],
    expected: "--wallet-artifact and --failure-artifact must point to distinct QA evidence files",
  },
  {
    id: "qa-missing-support-artifact",
    create: ["scripts/create-qa-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--network=linea-mainnet", "--chain-id=59144", `--wallet-artifact=${qaWalletArtifact}`, `--failure-artifact=${qaFailureArtifact}`, `--finalqa-artifact=${qaFinalArtifact}`, `--smoke-artifact=${qaSmokeArtifact}`, "--clean-wallet-tx=0x1111111111111111111111111111111111111111111111111111111111111111"],
    expected: "--support-artifact is required when drafting QA launch evidence",
  },
  {
    id: "qa-missing-finalqa-artifact",
    create: ["scripts/create-qa-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--network=linea-mainnet", "--chain-id=59144", `--wallet-artifact=${qaWalletArtifact}`, `--failure-artifact=${qaFailureArtifact}`, `--support-artifact=${qaSupportArtifact}`, `--smoke-artifact=${qaSmokeArtifact}`, "--clean-wallet-tx=0x1111111111111111111111111111111111111111111111111111111111111111"],
    expected: "--finalqa-artifact is required when drafting QA launch evidence",
  },
  {
    id: "qa-missing-smoke-artifact",
    create: ["scripts/create-qa-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--network=linea-mainnet", "--chain-id=59144", `--wallet-artifact=${qaWalletArtifact}`, `--failure-artifact=${qaFailureArtifact}`, `--support-artifact=${qaSupportArtifact}`, `--finalqa-artifact=${qaFinalArtifact}`, "--clean-wallet-tx=0x1111111111111111111111111111111111111111111111111111111111111111"],
    expected: "--smoke-artifact is required when drafting QA launch evidence",
  },
  {
    id: "qa-missing-clean-wallet-tx",
    create: ["scripts/create-qa-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--network=linea-mainnet", "--chain-id=59144", `--wallet-artifact=${qaWalletArtifact}`, `--failure-artifact=${qaFailureArtifact}`, `--support-artifact=${qaSupportArtifact}`, `--finalqa-artifact=${qaFinalArtifact}`, `--smoke-artifact=${qaSmokeArtifact}`],
    expected: "--clean-wallet-tx must be a real non-zero tx hash",
  },
  {
    id: "monitoring-final-output",
    create: ["scripts/create-monitoring-proof-draft.mjs"],
    createArgs: ["--provider=synthetic-monitor", "--error-provider=synthetic-error-tracker", "--origin=https://playlore.xyz", "--out=docs/monitoring-proof.json"],
    expected: "writes incomplete drafts only",
  },
  {
    id: "monitoring-draft-credentialed-origin",
    create: ["scripts/create-monitoring-proof-draft.mjs"],
    createArgs: ["--provider=synthetic-monitor", "--error-provider=synthetic-error-tracker", "--origin=https://user:pass@playlore.xyz", `--monitor-artifact=${monitoringAlertArtifact}`, `--recovery-artifact=${monitoringRecoveryArtifact}`, `--alert-target-artifact=${monitoringAlertTargetArtifact}`, `--error-event-artifact=${monitoringErrorEventArtifact}`],
    expected: "--origin must be a public HTTPS origin without path, query, or hash",
  },
  {
    id: "monitoring-missing-monitor-artifact",
    create: ["scripts/create-monitoring-proof-draft.mjs"],
    createArgs: ["--provider=synthetic-monitor", "--error-provider=synthetic-error-tracker", "--origin=https://playlore.xyz", `--recovery-artifact=${monitoringRecoveryArtifact}`, `--alert-target-artifact=${monitoringAlertTargetArtifact}`, `--error-event-artifact=${monitoringErrorEventArtifact}`],
    expected: "--monitor-artifact is required when drafting monitoring launch evidence",
  },
  {
    id: "monitoring-missing-recovery-artifact",
    create: ["scripts/create-monitoring-proof-draft.mjs"],
    createArgs: ["--provider=synthetic-monitor", "--error-provider=synthetic-error-tracker", "--origin=https://playlore.xyz", `--monitor-artifact=${monitoringAlertArtifact}`, `--alert-target-artifact=${monitoringAlertTargetArtifact}`, `--error-event-artifact=${monitoringErrorEventArtifact}`],
    expected: "--recovery-artifact is required when drafting monitoring launch evidence",
  },
  {
    id: "monitoring-directory-monitor-artifact",
    create: ["scripts/create-monitoring-proof-draft.mjs"],
    createArgs: ["--provider=synthetic-monitor", "--error-provider=synthetic-error-tracker", "--origin=https://playlore.xyz", `--monitor-artifact=${monitoringDirectoryArtifact}`, `--recovery-artifact=${monitoringRecoveryArtifact}`, `--alert-target-artifact=${monitoringAlertTargetArtifact}`, `--error-event-artifact=${monitoringErrorEventArtifact}`],
    expected: "--monitor-artifact must point to an existing redacted file artifact",
  },
  {
    id: "monitoring-shared-draft-alert-recovery-artifact",
    create: ["scripts/create-monitoring-proof-draft.mjs"],
    createArgs: ["--provider=synthetic-monitor", "--error-provider=synthetic-error-tracker", "--origin=https://playlore.xyz", `--monitor-artifact=${monitoringSharedAlertRecoveryArtifact}`, `--recovery-artifact=${monitoringSharedAlertRecoveryArtifact}`, `--alert-target-artifact=${monitoringAlertTargetArtifact}`, `--error-event-artifact=${monitoringErrorEventArtifact}`],
    expected: "--monitor-artifact and --recovery-artifact must point to distinct fired-alert and recovery evidence files",
  },
  {
    id: "monitoring-shared-draft-section-artifact",
    create: ["scripts/create-monitoring-proof-draft.mjs"],
    createArgs: ["--provider=synthetic-monitor", "--error-provider=synthetic-error-tracker", "--origin=https://playlore.xyz", `--monitor-artifact=${monitoringSharedSectionArtifact}`, `--recovery-artifact=${monitoringRecoveryArtifact}`, `--alert-target-artifact=${monitoringSharedSectionArtifact}`, `--error-event-artifact=${monitoringErrorEventArtifact}`],
    expected: "--monitor-artifact and --alert-target-artifact must point to distinct monitoring evidence files",
  },
  {
    id: "monitoring-missing-alert-target-artifact",
    create: ["scripts/create-monitoring-proof-draft.mjs"],
    createArgs: ["--provider=synthetic-monitor", "--error-provider=synthetic-error-tracker", "--origin=https://playlore.xyz", `--monitor-artifact=${monitoringAlertArtifact}`, `--recovery-artifact=${monitoringRecoveryArtifact}`, `--error-event-artifact=${monitoringErrorEventArtifact}`],
    expected: "--alert-target-artifact is required when drafting monitoring launch evidence",
  },
  {
    id: "monitoring-missing-error-event-artifact",
    create: ["scripts/create-monitoring-proof-draft.mjs"],
    createArgs: ["--provider=synthetic-monitor", "--error-provider=synthetic-error-tracker", "--origin=https://playlore.xyz", `--monitor-artifact=${monitoringAlertArtifact}`, `--recovery-artifact=${monitoringRecoveryArtifact}`, `--alert-target-artifact=${monitoringAlertTargetArtifact}`],
    expected: "--error-event-artifact is required when drafting monitoring launch evidence",
  },
];

const strictPassCases = [
  {
    id: "signoff-valid-strict-proof",
    check: ["scripts/check-signoff-proof.mjs"],
    checkArgs: ["--strict", `--file=${signoffValidStrictManifestPath}`],
    expected: /Summary: contract\/funds sign-off proof completed without detected issues; covered gates: G1, G2, G3, G4; groups: chain=1, env=1, signoff=2\./i,
    env: signoffEnvPatch,
  },
  {
    id: "host-valid-strict-proof",
    check: ["scripts/check-host-proof.mjs"],
    checkArgs: ["--strict", `--file=${hostValidStrictManifestPath}`],
    expected: /Summary: production host proof completed without detected issues; covered gates: G5, G6; groups: host=2\./i,
  },
  {
    id: "monitoring-valid-strict-proof",
    check: ["scripts/check-monitoring-proof.mjs"],
    checkArgs: ["--strict", `--file=${monitoringValidStrictManifestPath}`],
    expected: /Summary: monitoring proof completed without detected issues; covered gates: G9; groups: monitoring=1\./i,
  },
  {
    id: "indexer-valid-strict-proof",
    check: ["scripts/check-indexer-dry-run.mjs"],
    checkArgs: ["--strict", `--db=${indexerStrictDbPath}`, `--manifest=${indexerValidStrictManifestPath}`],
    expected: /Summary: indexer dry-run proof completed without detected issues; covered gates: G7; groups: indexer=1\./i,
    env: {
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      INDEXER_FINALITY_BLOCKS: "1",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59144",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x1111111111111111111111111111111111111111",
    },
  },
  {
    id: "canary-testnet-profile",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [testnetCanaryFullLog, "--profile=testnet", "--strict", `--manifest=${testnetCanaryValidStrictManifestPath}`],
    expected: /Summary: live canary proof checks passed; covered gates: G10, G11; groups: canary=2\./i,
    env: {
      LINEA_NETWORK: "sepolia",
      NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
      LINEA_CHAIN_ID: "59141",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59141",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x1111111111111111111111111111111111111111",
    },
  },
  {
    id: "canary-bom-live-log-strict-proof",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryFullBomLog, "--strict", `--manifest=${canaryValidStrictManifestPath}`],
    expected: /Summary: live canary proof checks passed; covered gates: G10, G11; groups: canary=2\./i,
  },
  {
    id: "restore-valid-strict-proof",
    check: ["scripts/verify-db-restore.mjs"],
    checkArgs: ["--strict", `--source=${restoreStrictSourcePath}`, `--backup-dir=${restoreStrictBackupDir}`, `--restore-dir=${restoreStrictDir}`, `--backup=${restoreStrictBackupPath}`, `--manifest=${restoreValidStrictManifestPath}`],
    expected: /Summary: backup\/restore drill completed without detected issues; covered gates: G8; groups: restore=1\./i,
  },
];

function runNode(args, envPatch = {}, cwdOverride = "") {
  const firstArg = String(args[0] ?? "").replaceAll("\\", "/");
  const isQaProofCheck = firstArg.endsWith("scripts/check-qa-proof.mjs");
  const cwd = cwdOverride || (isQaProofCheck ? qaCleanCandidate.repoPath : repositoryRoot);
  const commandArgs = cwd === repositoryRoot || isAbsolute(String(args[0] ?? ""))
    ? args
    : [resolve(repositoryRoot, String(args[0])), ...args.slice(1)];
  return spawnSync(process.execPath, commandArgs, {
    cwd,
    env: {
      ...process.env,
      ...(isQaProofCheck ? { GITHUB_SHA: "", SOURCE_VERSION: "", VERCEL_GIT_COMMIT_SHA: "" } : {}),
      [G14_TRUSTED_KEY_ENV]: qaReviewerPublicKey,
      ...envPatch,
    },
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
}

function oneLine(output) {
  const lines = redactProofText(output)
    .replace(/[A-Za-z]:\\[^\s|`"']+/g, "<path>")
    .replace(/(^|[\s|`"'])\/(?:[^/\s|`"']+\/)+[^\s|`"']+/g, "$1<path>")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
const guardPattern = /writes incomplete drafts only|collector writes incomplete evidence drafts only|is required when (?:collecting|drafting)|must point to an existing redacted file artifact|must point to an existing redacted JSON artifact|must point to an existing redacted artifact|must point to distinct signoff evidence files|must point to distinct host evidence files|must point to distinct monitoring evidence files|must point to distinct canary evidence files|must point to distinct indexer evidence files|must point to distinct restore evidence files|proof manifest must be a file|must be valid JSON|must be a public HTTPS origin without path, query, or hash|must be a final public HTTPS origin without path, query, or hash|must record the monitored HTTPS URL|must contain successful proof:mainnet summary|must contain direct-chain comparison evidence for jackpot, safetyPool, deposits, rewards, rebates, and resolve|must include successful restore drill summary|must include base=<production origin>|must include Load base URL line|must include \[prod-health\] OK|must include runtime=ok\/pass\/healthy|must include dataSync=ok\/pass\/healthy|must include numeric finalityLagBlocks=<number>|must include canonical non-negative decimal finalityLagBlocks=<number>|must be outside the repo checkout|must include generatedAt as ISO-8601 UTC|must include at least --epochs unique checked epochs|must be a canonical positive decimal integer|rpcSource must be a redacted label or origin-only URL|must match --deploy-block|must match --chain-snapshot contractAddress|must be a real non-zero tx hash|must include at least one successful auto-miner canary tx|local signoff artifact references must exist|signoff evidence sections must use distinct local artifact files across|contractEnv evidence must mention proof:mainnet, env, contract, deploy, or chainId proof|ownership\.directOwnerReadEvidence evidence must mention owner, Safe\/multisig, governance, or direct-chain proof|randomness evidence must mention randomness decision or operator sign-off proof|chainComparison\.jackpot evidence must mention jackpot, direct-chain, app, or indexer proof|local host artifact references must exist|host evidence sections must use distinct local artifact files across|persistentDb evidence artifact must mention persistence, restart\/reboot, or DB path proof|healthProd evidence artifact must include \[prod-health\] OK, base, and (?:numeric|canonical non-negative decimal) finalityLagBlocks|loadHttp evidence artifact must include Load base URL, TOTAL, and p95 output|local indexer artifact references must exist|indexer evidence sections must use distinct local artifact files across|dryRun evidence artifact must include \[indexer\] Deploy block and \[indexer\] Start block|finality evidence artifact must include health:prod base and (?:numeric|canonical non-negative decimal) finalityLagBlocks|chainSnapshot\.path artifact must include generatedAt, rpcChainId, and contractAddress|chainComparison\.jackpot evidence artifact must mention jackpot, direct-chain, chain comparison, or indexer proof|local monitoring artifact references must exist|monitoring evidence sections must use distinct local artifact files across|fired-alert evidence must mention alert, monitor, fired, triggered, or incident proof|recovery evidence must mention recovery, recovered, resolved, or resolution proof|must not be in the future|alertTargets\[0\] evidence must mention alert target or notification channel proof|error tracking test event evidence must mention error, exception, event, issue, or provider proof|local restore artifact references must exist|restore evidence sections must use distinct local artifact files across|restoreDrill evidence must include restored SQLite integrity_check proof|restoredStagingHealth\.evidence must include canonical non-negative decimal finalityLagBlocks from health:prod|local QA artifact references must exist|wallet\.privyAllowedOrigins evidence must mention wallet\/Privy\/connect\/mobile\/wrong-network proof|wallet\.cleanWalletFirstTx evidence must include receipt\/explorer confirmation proof|wallet\.mobileWeb3Browser evidence must include mobile device, wallet app, or viewport proof|failureStateUx\.disabledActionsExplainReason evidence must mention failure-state\/pending\/degraded\/no-op UX proof|supportAuditVisibility\.betHistoryFields evidence must mention support\/audit\/diagnostics visibility proof|finalQa\.mobileLayout evidence must mention final browser\/mobile\/mainnet wording QA proof|finalQa\.browserSmokeDebugAutominer evidence must mention debug autominer browser smoke proof|targetNetwork evidence must mention target RPC, chain, or Linea mainnet launch proof|canary evidence sections must use distinct local artifact files across|recovery\.reload evidence must mention reload, reconnect, tab-close, pending-tx, remount, or recovery proof|autoMinerSession evidence must mention auto-miner session, rounds, epochs, or target RPC proof|transactionHealth evidence must mention transaction, tx, nonce, duplicate, stuck pending, or pending recovery proof|local canary artifact references must exist/i;
  const preferred = lines.find((line) => /^Error: /i.test(line) && guardPattern.test(line)) || lines.find((line) => guardPattern.test(line));
  const compact = preferred || lines.slice(-3).join(" | ");
  return compact.length > 260 ? `${compact.slice(0, 257)}...` : compact;
}

function printTable(headers, rows) {
  console.log(`| ${headers.join(" | ")} |`);
  console.log(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}

const rows = [];
const issues = [];

for (const item of draftCases) {
  const createResult = runNode([...item.create, ...item.createArgs, `--out=${item.out}`]);
  const createOutput = `${createResult.stdout || ""}\n${createResult.stderr || ""}`;
  if (createResult.status !== 0) {
    issues.push(`${item.id}: draft generation failed`);
    rows.push([item.id, "create failed", String(createResult.status), oneLine(createOutput).replace(/\|/g, "\\|")]);
    continue;
  }

  const checkResult = runNode([...item.check, ...item.checkArgs(item.out)]);
  const checkOutput = `${checkResult.stdout || ""}\n${checkResult.stderr || ""}`;
  const rejectedAsDraft = checkResult.status !== 0 && /draft proof manifests are not accepted as launch proof/i.test(checkOutput);
  if (!rejectedAsDraft) {
    issues.push(`${item.id}: strict validator did not reject draft proof manifest`);
  }
  rows.push([item.id, rejectedAsDraft ? "rejected" : "issue", String(checkResult.status), oneLine(checkOutput).replace(/\|/g, "\\|")]);
}

for (const item of collectorDraftCases) {
  const createResult = runNode([...item.create, ...item.createArgs, `--out=${item.out}`]);
  const createOutput = `${createResult.stdout || ""}\n${createResult.stderr || ""}`;
  if (createResult.status !== 0) {
    issues.push(`${item.id}: collector draft generation failed`);
    rows.push([item.id, "create failed", String(createResult.status), oneLine(createOutput).replace(/\|/g, "\\|")]);
    continue;
  }

  let manifest = null;
  try {
    manifest = readProofDraftJson(item.out);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    issues.push(
      message.includes("too large")
        ? `${item.id}: collector output is too large to validate safely`
        : `${item.id}: collector output is not valid JSON`,
    );
  }
  const missingSections = item.requiredSections.filter((section) => !manifest || !(section in manifest));
  if (missingSections.length > 0) {
    issues.push(`${item.id}: collector output missing ${missingSections.join(", ")}`);
  }

  const checkResult = runNode([...item.check, ...item.checkArgs(item.out)]);
  const checkOutput = `${checkResult.stdout || ""}\n${checkResult.stderr || ""}`;
  const rejectedAsIncomplete = checkResult.status !== 0;
  if (!rejectedAsIncomplete) {
    issues.push(`${item.id}: strict validator accepted incomplete collector draft`);
  }
  rows.push([item.id, rejectedAsIncomplete && missingSections.length === 0 ? "rejected incomplete" : "issue", String(checkResult.status), oneLine(checkOutput).replace(/\|/g, "\\|")]);
}
for (const item of collectorRejectCases) {
  const createResult = runNode([...item.create, ...item.createArgs]);
  const createOutput = `${createResult.stdout || ""}\n${createResult.stderr || ""}`;
  const rejected = createResult.status !== 0 && createOutput.includes(item.expected);
  if (!rejected) {
    issues.push(`${item.id}: incomplete collector evidence was not rejected`);
  }
  rows.push([item.id, rejected ? "rejected" : "issue", String(createResult.status), oneLine(createOutput).replace(/\|/g, "\\|")]);
}

for (const item of strictPassCases) {
  const checkResult = runNode([...item.check, ...item.checkArgs], item.env, item.cwd);
  const checkOutput = `${checkResult.stdout || ""}\n${checkResult.stderr || ""}`;
  const passed = checkResult.status === 0 && item.expected.test(checkOutput);
  if (!passed) {
    issues.push(`${item.id}: strict validator did not accept valid proof evidence`);
  }
  rows.push([item.id, passed ? "passed strict" : "issue", String(checkResult.status), oneLine(checkOutput).replace(/\|/g, "\\|")]);
}

for (const item of strictRejectCases) {
  const checkResult = runNode([...item.check, ...item.checkArgs], item.env, item.cwd);
  const checkOutput = `${checkResult.stdout || ""}\n${checkResult.stderr || ""}`;
  const rejected = checkResult.status !== 0 &&
    checkOutput.includes(item.expected) &&
    (item.expectedAlso ?? []).every((expected) => checkOutput.includes(expected));
  if (!rejected) {
    issues.push(`${item.id}: strict validator did not reject missing local artifact evidence`);
  }
  rows.push([item.id, rejected ? "rejected" : "issue", String(checkResult.status), oneLine(checkOutput).replace(/\|/g, "\\|")]);
}

for (const item of finalOutputCases) {
  const createResult = runNode([...item.create, ...item.createArgs]);
  const createOutput = `${createResult.stdout || ""}\n${createResult.stderr || ""}`;
  const rejected = createResult.status !== 0 && createOutput.includes(item.expected);
  if (!rejected) {
    issues.push(`${item.id}: final proof output was not rejected`);
  }
  rows.push([item.id, rejected ? "rejected" : "issue", String(createResult.status), oneLine(createOutput).replace(/\|/g, "\\|")]);
}

const bundleOutDir = join(tmp, "proof-draft-bundle");
const bundleResult = runNode(["scripts/create-all-proof-drafts.mjs", `--out-dir=${bundleOutDir}`]);
const bundleOutput = `${bundleResult.stdout || ""}\n${bundleResult.stderr || ""}`;
const bundleWarns = bundleResult.status === 0 && /Draft files are not launch proof/i.test(bundleOutput) && /strict validation/i.test(bundleOutput);
if (!bundleWarns) {
  issues.push("draft-bundle: bundle generator did not warn that drafts are not launch proof");
}
let bundleRejectedCount = 0;
if (bundleResult.status === 0) {
  for (const item of draftCases) {
    const out = join(bundleOutDir, `${item.id}-proof.draft.json`);
    const checkResult = runNode([...item.check, ...item.checkArgs(out)]);
    if (checkResult.status !== 0) {
      bundleRejectedCount += 1;
    } else {
      issues.push(`draft-bundle: strict validator accepted ${item.id}-proof.draft.json`);
    }
  }
}
const bundleOk = bundleWarns && bundleRejectedCount === draftCases.length;
rows.push(["draft-bundle", bundleOk ? "created as non-proof" : "issue", String(bundleResult.status), oneLine(bundleOutput).replace(/\|/g, "\\|")]);
if (summaryOnly) {
  const statusCounts = rows.reduce((counts, row) => {
    const status = row[1];
    counts.set(status, (counts.get(status) ?? 0) + 1);
    return counts;
  }, new Map());
  const compactCounts = [...statusCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `${status}=${count}`)
    .join(" ");
  console.log(`Rows: total=${rows.length} ${compactCounts}`);
} else {
  printTable(["Draft", "Strict Result", "Exit", "Evidence"], rows);
}
console.log(`Summary: ${issues.length === 0 ? "all proof drafts are rejected by strict validators" : `${issues.length} issue(s): ${issues.join("; ")}`}.`);

for (const tempDir of tempDirs) {
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Best-effort temp cleanup; validation status is already captured.
  }
}

if (issues.length > 0) process.exitCode = 1;
