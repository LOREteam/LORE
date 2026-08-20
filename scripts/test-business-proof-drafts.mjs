import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  hasMobileQaDeviceProofText,
  hasMobileQaViewportProofText,
  hasQaWalletContentProof,
  MAX_QA_VIEWPORT_MARKERS,
  parseCanonicalQaViewportDimension,
} from "./qa-proof-policy.mjs";
import { parsePositiveInteger as parseProofPositiveInteger } from "./collect-proof-common.mjs";
import { auditSqliteScopes, hasKnownLaunchSqliteRows, readCanonicalSqliteCount } from "./sqlite-scope-audit-lib.mjs";

const PROOF_TEMP_PREFIX = "lore-proof-";
const REPOSITORY_ENV_PREFIX = /^(?:ADMIN_|ALLOW_|BOOTSTRAP_|CANARY_|CHAT_|CONTRACT_|EIP7702_|HEALTH_|INDEXER_|KEEPER_|LINEA_|LIVE_|LORE_|NEXT_PUBLIC_|PRELAUNCH_|PRIVY_|PROD_|PROOF_|RATE_LIMIT_|RESEND_|RUNTIME_|SMOKE_|SOURCE_VERSION$|UPSTASH_|V10_|VERCEL_|WEB_REPLICA_)/;

function proofDraftChildEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => {
      const normalized = name.toUpperCase();
      return normalized !== "NODE_ENV" &&
        normalized !== "NODE_OPTIONS" &&
        normalized !== "GITHUB_SHA" &&
        !REPOSITORY_ENV_PREFIX.test(normalized);
    }),
  );
}

function proofTempEntries() {
  return readdirSync(tmpdir())
    .filter((name) => name.startsWith(PROOF_TEMP_PREFIX))
    .sort();
}

export function runProofDraftBehaviorTests() {
  assert.deepEqual(
    ["1", " 42 ", "9007199254740991", "0", "01", "1.0", "1e2", "9007199254740992", "9999999999999999"]
      .map(parseProofPositiveInteger),
    [1, 42, Number.MAX_SAFE_INTEGER, null, null, null, null, null, null],
    "proof collectors must share canonical safe positive-integer parsing",
  );
  assert.equal(Number("1e2"), 100, "exponent fixture must kill broad Number coercion mutants");
  const countQueries = [];
  const countDb = (value, throws = false) => ({
    prepare(query) {
      countQueries.push(query);
      if (throws) throw new Error("synthetic SQLite read failure");
      return { get: () => ({ count: value }) };
    },
  });
  assert.deepEqual(
    [0, 3n, "4", "01", "1e2", -1, 1.5, BigInt(Number.MAX_SAFE_INTEGER) + 1n]
      .map((value) => readCanonicalSqliteCount(countDb(value), "bets")),
    [0, 3, 4, null, null, null, null, null],
    "restore proof must canonicalize SQLite COUNT results and fail closed on broad or unsafe values",
  );
  assert.equal(readCanonicalSqliteCount(countDb(1, true), "bets"), null);
  assert.deepEqual([...new Set(countQueries)], ["SELECT COUNT(*) AS count FROM bets"]);
  assert.equal(hasKnownLaunchSqliteRows({ counts: { bets: 0, epochs: 1 } }), true);
  for (const invalidCounts of [
    { bets: 0, epochs: 0 },
    { bets: "1", epochs: 0n },
    { bets: -1, epochs: 1.5 },
    { bets: Number.MAX_SAFE_INTEGER + 1 },
    null,
  ]) {
    assert.equal(hasKnownLaunchSqliteRows(invalidCounts == null ? invalidCounts : { counts: invalidCounts }), false);
  }
  const scopeAuditRoot = mkdtempSync(join(tmpdir(), "lore-scope-audit-global-stats-"));
  try {
    const scopeAuditDbPath = join(scopeAuditRoot, "scope-audit.sqlite");
    const scopeAuditDb = new DatabaseSync(scopeAuditDbPath);
    try {
      for (const table of [
        "scoped_global_stats_aggregate",
        "scoped_global_stats_dirty",
        "scoped_leaderboard_read_model",
        "scoped_leaderboard_dirty",
      ]) {
        scopeAuditDb.exec(`CREATE TABLE ${table} (scope TEXT NOT NULL)`);
        scopeAuditDb.prepare(`INSERT INTO ${table}(scope) VALUES (?)`).run("sepolia:0xffffffffffffffffffffffffffffffffffffffff");
      }
    } finally {
      scopeAuditDb.close();
    }
    const scopeAudit = auditSqliteScopes(scopeAuditDbPath, "sepolia:0x0000000000000000000000000000000000000001");
    assert.deepEqual(scopeAudit.foreignRowsByTable, {
      scoped_global_stats_aggregate: 1,
      scoped_global_stats_dirty: 1,
      scoped_leaderboard_read_model: 1,
      scoped_leaderboard_dirty: 1,
    });
    assert.equal(scopeAudit.foreignRows, 4, "materialized read-model tables must contribute to scope-audit foreign-row evidence");
  } finally {
    rmSync(scopeAuditRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
    assert.equal(existsSync(scopeAuditRoot), false, "materialized read-model scope-audit fixtures must be removed");
  }
  assert.equal(parseCanonicalQaViewportDimension("320"), 320);
  assert.equal(parseCanonicalQaViewportDimension(" 1100 "), 1100);
  for (const invalidDimension of [null, "", "0999", "99", "10000", "320.0", "3.2e2", "-320"]) {
    assert.equal(parseCanonicalQaViewportDimension(invalidDimension), null, `viewport dimension ${String(invalidDimension)} must fail closed`);
  }
  for (const validViewport of [
    "mobile viewport 320x568",
    "viewport: 480 x 1100",
    "viewport=568x320",
    "mobile viewport 1100x480",
  ]) {
    assert.equal(hasMobileQaViewportProofText(validViewport), true, `${validViewport} must be accepted as bounded mobile evidence`);
  }
  for (const invalidViewport of [
    "viewport 319x844",
    "viewport 481x844",
    "viewport 390x567",
    "viewport 390x1101",
    "viewport 0320x0568",
    "viewport 320.0x568",
  ]) {
    assert.equal(hasMobileQaViewportProofText(invalidViewport), false, `${invalidViewport} must not be accepted as mobile evidence`);
  }
  const viewportAtLimit = Array.from({ length: MAX_QA_VIEWPORT_MARKERS }, () => "viewport 390x844").join("\n");
  const viewportOverLimit = `${viewportAtLimit}\nviewport 390x844`;
  assert.equal(hasMobileQaViewportProofText(viewportAtLimit), true, "exactly 32 canonical viewport markers may prove mobile layout");
  assert.equal(hasMobileQaViewportProofText(viewportOverLimit), false, "33 viewport markers must fail before an early valid marker is accepted");
  const earlyAcceptanceMutant = (text) => /\bviewport\s*[:=]?\s*(?:3[2-9]\d|4[0-8]0)\s*x\s*(?:5[6-9]\d|[6-9]\d{2}|10\d{2}|1100)\b/i.test(text);
  assert.equal(earlyAcceptanceMutant(viewportOverLimit), true, "overflow fixture must kill an early-acceptance viewport mutant");
  assert.equal(hasMobileQaDeviceProofText("iOS in-app wallet verification"), true);
  assert.equal(hasMobileQaDeviceProofText("mobile Web3 browser with viewport 390x844"), true);
  assert.equal(hasMobileQaDeviceProofText("mobile Web3 browser touch targets verified"), false);

  const walletEvidenceCases = [
    ["privyAllowedOrigins", "Privy dashboard production allowed-origin app-id proof", "Privy dashboard production origin proof"],
    ["desktopConnect", "desktop wallet ready", "wallet transaction proof only"],
    ["desktopDisconnect", "browser sign out verified", "wallet transaction proof only"],
    ["desktopReconnect", "desktop session recovery after reload", "wallet transaction proof only"],
    ["wrongNetwork", "unsupported chain warning verified", "wallet transaction proof only"],
    ["mobileWeb3Browser", "mobile Web3 browser verified", "wallet transaction proof only"],
    ["cleanWalletFirstTx", "fresh wallet first transaction verified", "wallet transaction proof only"],
    ["slowNetworkAuthModal", "latency delayed Privy modal", "wallet transaction proof only"],
    ["slowNetworkChatAuth", "slow network chat auth recovery", "wallet transaction proof only"],
  ];
  for (const [checkId, acceptedText, rejectedText] of walletEvidenceCases) {
    assert.equal(hasQaWalletContentProof(checkId, acceptedText), true, `${checkId} must accept its own evidence vocabulary`);
    assert.equal(hasQaWalletContentProof(checkId, rejectedText), false, `${checkId} must reject generic cross-check wallet evidence`);
  }
  const genericWalletMutant = (text) => /\b(?:wallet|privy|transaction|tx)\b/i.test(text);
  assert.equal(genericWalletMutant("wallet transaction proof only"), true, "generic fallback fixture must kill cross-check evidence mutants");

  const canaryEpochOrderingRoot = mkdtempSync(join(tmpdir(), "lore-canary-epoch-ordering-"));
  try {
    const canaryEpochOrderingLog = join(canaryEpochOrderingRoot, "canary-epoch-ordering.jsonl");
    const canaryEpochOrderingEvents = [
      ["10", 0, "0x" + "1".repeat(64)],
      ["2", 1, "0x" + "2".repeat(64)],
      ["3e0", 2, "0x" + "3".repeat(64)],
    ].map(([epoch, nonce, txHash], index) => ({
      round: index,
      mode: "single",
      ok: true,
      txStatus: "success",
      epoch,
      role: "AUTOMINER_A",
      timestamp: `2026-01-01T00:00:0${index}.000Z`,
      nonceLatest: nonce,
      noncePending: nonce,
      tiles: [index + 1],
      durationMs: 1,
      gasUsed: 21_000,
      txHash,
    }));
    writeFileSync(
      canaryEpochOrderingLog,
      `${canaryEpochOrderingEvents.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8",
    );
    const canaryEpochOrdering = spawnSync(
      process.execPath,
      [resolve("scripts", "analyze-live-canary-proof.mjs"), canaryEpochOrderingLog, "--summary-only"],
      {
        cwd: process.cwd(),
        env: proofDraftChildEnv(),
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 256 * 1024,
        windowsHide: true,
      },
    );
    assert.equal(canaryEpochOrdering.status, 0, canaryEpochOrdering.stderr || canaryEpochOrdering.stdout);
    assert.equal(String(canaryEpochOrdering.stderr), "");
    assert.match(canaryEpochOrdering.stdout, /\| unique bet epochs \| 2 \|/);
    assert.match(canaryEpochOrdering.stdout, /\| first \/ last epoch \| 2 \/ 10 \|/);
    assert.match(canaryEpochOrdering.stdout, /\| malformed bet epoch evidence \| 1 \|/);
    assert.doesNotMatch(canaryEpochOrdering.stdout, /\| first \/ last epoch \| 10 \/ 2 \|/);
    assert.doesNotMatch(canaryEpochOrdering.stdout, new RegExp(canaryEpochOrderingRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  } finally {
    rmSync(canaryEpochOrderingRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
    assert.equal(existsSync(canaryEpochOrderingRoot), false, "canary epoch ordering fixtures must be removed");
  }

  const before = proofTempEntries();
  const result = spawnSync(
    process.execPath,
    [resolve("scripts", "check-proof-drafts.mjs"), "--summary-only", "--proof-cases"],
    {
      cwd: process.cwd(),
      env: proofDraftChildEnv(),
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 512 * 1024,
      windowsHide: true,
    },
  );

  assert.equal(
    result.status,
    0,
    `proof draft behavior suite failed: ${[
      result.error?.message,
      String(result.stdout).trim().slice(-2_000),
      String(result.stderr).trim().slice(-1_000),
    ].filter(Boolean).join(" | ")}`,
  );
  const outputLines = String(result.stdout).trim().split(/\r?\n/);
  assert.equal(outputLines[0], "Rows: total=308 created as non-proof=1 passed strict=7 rejected=296 rejected incomplete=4");
  assert.equal(outputLines.at(-1), "Summary: all proof drafts are rejected by strict validators.");
  const canaryCaseLine = outputLines.find((line) => line.startsWith("Canary cases: ")) ?? "";
  const canaryStatuses = new Map(canaryCaseLine.slice("Canary cases: ".length).split(",").filter(Boolean).map((entry) => {
    const separator = entry.lastIndexOf("=");
    return [entry.slice(0, separator), entry.slice(separator + 1)];
  }));
  const requiredCanaryCases = new Map([
    ["canary-live-log-malformed-chain-id", "rejected"],
    ["canary-live-log-malformed-nonce", "rejected"],
    ["canary-live-log-unsafe-nonce", "rejected"],
    ["canary-live-log-duplicate-nonce", "rejected"],
    ["canary-live-log-duplicate-role-epoch", "rejected"],
    ["canary-live-log-malformed-epoch", "rejected"],
    ["canary-live-log-unsafe-epoch", "rejected"],
    ["canary-live-log-malformed-tx-metric", "rejected"],
    ["canary-live-log-unsafe-tx-metric", "rejected"],
    ["canary-live-log-failed-preflight", "rejected"],
    ["canary-irrelevant-target-artifact", "rejected"],
    ["canary-irrelevant-recovery-artifact", "rejected"],
    ["canary-irrelevant-session-artifact", "rejected"],
    ["canary-irrelevant-transaction-artifact", "rejected"],
    ["canary-testnet-profile", "passed strict"],
    ["canary-bom-live-log-strict-proof", "passed strict"],
  ]);
  assert.ok(canaryStatuses.size >= requiredCanaryCases.size, "canary behavior receipt must expose its complete required case family");
  for (const [id, expectedStatus] of requiredCanaryCases) {
    assert.equal(canaryStatuses.get(id), expectedStatus, `${id} must remain ${expectedStatus}`);
  }
  for (const omittedId of requiredCanaryCases.keys()) {
    const mutant = new Map(canaryStatuses);
    mutant.delete(omittedId);
    assert.notEqual(mutant.get(omittedId), requiredCanaryCases.get(omittedId), `${omittedId} removal mutant must fail`);
  }
  const indexerCaseLine = outputLines.find((line) => line.startsWith("Indexer cases: ")) ?? "";
  const indexerStatuses = new Map(indexerCaseLine.slice("Indexer cases: ".length).split(",").filter(Boolean).map((entry) => {
    const separator = entry.lastIndexOf("=");
    return [entry.slice(0, separator), entry.slice(separator + 1)];
  }));
  const requiredIndexerCases = new Map([
    ["indexer", "rejected"],
    ["indexer-collector", "rejected incomplete"],
    ["indexer-collector-malformed-finality-lag", "rejected"],
    ["indexer-collector-unsafe-finality-lag", "rejected"],
    ["indexer-collector-missing-indexer-log-artifact", "rejected"],
    ["indexer-collector-directory-indexer-log", "rejected"],
    ["indexer-collector-repo-db", "rejected"],
    ["indexer-collector-shared-artifact-input", "rejected"],
    ["indexer-collector-missing-snapshot-generated-at", "rejected"],
    ["indexer-collector-too-few-snapshot-epochs", "rejected"],
    ["indexer-collector-malformed-chain-id", "rejected"],
    ["indexer-missing-local-artifact-ref", "rejected"],
    ["indexer-directory-local-artifact-ref", "rejected"],
    ["indexer-directory-manifest", "rejected"],
    ["indexer-irrelevant-dry-run-artifact", "rejected"],
    ["indexer-irrelevant-finality-artifact", "rejected"],
    ["indexer-unsafe-finality-artifact", "rejected"],
    ["indexer-irrelevant-snapshot-artifact", "rejected"],
    ["indexer-irrelevant-comparison-artifact", "rejected"],
    ["indexer-shared-section-artifact", "rejected"],
    ["indexer-future-timestamp", "rejected"],
    ["indexer-unsafe-checked-epoch", "rejected"],
    ["indexer-draft-malformed-finality-lag", "rejected"],
    ["indexer-draft-unsafe-finality-lag", "rejected"],
    ["indexer-final-output", "rejected"],
    ["indexer-valid-strict-proof", "passed strict"],
  ]);
  assert.ok(indexerStatuses.size >= requiredIndexerCases.size, "indexer behavior receipt must expose its complete case family");
  for (const [id, expectedStatus] of requiredIndexerCases) {
    assert.equal(indexerStatuses.get(id), expectedStatus, `${id} must remain ${expectedStatus}`);
  }
  for (const omittedId of requiredIndexerCases.keys()) {
    const mutant = new Map(indexerStatuses);
    mutant.delete(omittedId);
    assert.notEqual(mutant.get(omittedId), requiredIndexerCases.get(omittedId), `${omittedId} removal mutant must fail`);
  }
  const signoffCaseLine = outputLines.find((line) => line.startsWith("Signoff cases: ")) ?? "";
  const signoffStatuses = new Map(signoffCaseLine.slice("Signoff cases: ".length).split(",").filter(Boolean).map((entry) => {
    const separator = entry.lastIndexOf("=");
    return [entry.slice(0, separator), entry.slice(separator + 1)];
  }));
  const requiredSignoffCases = new Map([
    ["signoff", "rejected"],
    ["signoff-collector", "rejected incomplete"],
    ["signoff-collector-missing-env-log", "rejected"],
    ["signoff-collector-failed-env-log", "rejected"],
    ["signoff-collector-weak-chain-log", "rejected"],
    ["signoff-collector-shared-artifact-input", "rejected"],
    ["signoff-collector-unsafe-epochs", "rejected"],
    ["signoff-draft-shared-artifact-input", "rejected"],
    ["signoff-missing-local-artifact-ref", "rejected"],
    ["signoff-directory-local-artifact-ref", "rejected"],
    ["signoff-directory-manifest", "rejected"],
    ["signoff-irrelevant-env-artifact", "rejected"],
    ["signoff-irrelevant-owner-artifact", "rejected"],
    ["signoff-irrelevant-randomness-artifact", "rejected"],
    ["signoff-irrelevant-chain-artifact", "rejected"],
    ["signoff-irrelevant-app-indexer-artifact", "rejected"],
    ["signoff-shared-section-artifact", "rejected"],
    ["signoff-future-timestamp", "rejected"],
    ["signoff-unsafe-checked-epoch", "rejected"],
    ["signoff-final-output", "rejected"],
    ["signoff-valid-strict-proof", "passed strict"],
  ]);
  assert.ok(signoffStatuses.size >= requiredSignoffCases.size, "signoff behavior receipt must expose its complete case family");
  for (const [id, expectedStatus] of requiredSignoffCases) {
    assert.equal(signoffStatuses.get(id), expectedStatus, `${id} must remain ${expectedStatus}`);
  }
  for (const omittedId of requiredSignoffCases.keys()) {
    const mutant = new Map(signoffStatuses);
    mutant.delete(omittedId);
    assert.notEqual(mutant.get(omittedId), requiredSignoffCases.get(omittedId), `${omittedId} removal mutant must fail`);
  }
  const hostCaseLine = outputLines.find((line) => line.startsWith("Host cases: ")) ?? "";
  const hostStatuses = new Map(hostCaseLine.slice("Host cases: ".length).split(",").filter(Boolean).map((entry) => {
    const separator = entry.lastIndexOf("=");
    return [entry.slice(0, separator), entry.slice(separator + 1)];
  }));
  const requiredHostCases = new Map([
    ["host", "rejected"],
    ["host-collector", "rejected incomplete"],
    ["host-collector-missing-logs", "rejected"],
    ["host-collector-missing-load-log", "rejected"],
    ["host-collector-credentialed-origin", "rejected"],
    ["host-collector-missing-health-log-artifact", "rejected"],
    ["host-collector-missing-process-evidence", "rejected"],
    ["host-collector-directory-process-evidence", "rejected"],
    ["host-collector-shared-artifact-input", "rejected"],
    ["host-collector-repo-db", "rejected"],
    ["host-collector-missing-health-base", "rejected"],
    ["host-collector-credentialed-health-base", "rejected"],
    ["host-collector-malformed-finality-lag", "rejected"],
    ["host-collector-unsafe-finality-lag", "rejected"],
    ["host-collector-missing-load-base", "rejected"],
    ["host-collector-credentialed-load-base", "rejected"],
    ["host-missing-local-artifact-ref", "rejected"],
    ["host-directory-local-artifact-ref", "rejected"],
    ["host-directory-manifest", "rejected"],
    ["host-irrelevant-process-evidence", "rejected"],
    ["host-irrelevant-persistent-artifact", "rejected"],
    ["host-irrelevant-health-artifact", "rejected"],
    ["host-irrelevant-load-artifact", "rejected"],
    ["host-shared-section-artifact", "rejected"],
    ["host-future-timestamp", "rejected"],
    ["host-credentialed-origin", "rejected"],
    ["host-final-output", "rejected"],
    ["host-valid-strict-proof", "passed strict"],
  ]);
  assert.ok(hostStatuses.size >= requiredHostCases.size, "host behavior receipt must expose its complete case family");
  for (const [id, expectedStatus] of requiredHostCases) {
    assert.equal(hostStatuses.get(id), expectedStatus, `${id} must remain ${expectedStatus}`);
  }
  for (const omittedId of requiredHostCases.keys()) {
    const mutant = new Map(hostStatuses);
    mutant.delete(omittedId);
    assert.notEqual(mutant.get(omittedId), requiredHostCases.get(omittedId), `${omittedId} removal mutant must fail`);
  }
  const monitoringCaseLine = outputLines.find((line) => line.startsWith("Monitoring cases: ")) ?? "";
  const monitoringStatuses = new Map(monitoringCaseLine.slice("Monitoring cases: ".length).split(",").filter(Boolean).map((entry) => {
    const separator = entry.lastIndexOf("=");
    return [entry.slice(0, separator), entry.slice(separator + 1)];
  }));
  assert.equal(
    monitoringStatuses.get("monitoring-generic-alert-words"),
    "rejected",
    "generic monitoring words without a concrete artifact, URL, or identifier must fail strict validation",
  );
  const genericMonitoringMutant = new Map(monitoringStatuses);
  genericMonitoringMutant.delete("monitoring-generic-alert-words");
  assert.notEqual(genericMonitoringMutant.get("monitoring-generic-alert-words"), "rejected");
  const qaCaseLine = outputLines.find((line) => line.startsWith("QA cases: ")) ?? "";
  const qaStatuses = new Map(qaCaseLine.slice("QA cases: ".length).split(",").filter(Boolean).map((entry) => {
    const separator = entry.lastIndexOf("=");
    return [entry.slice(0, separator), entry.slice(separator + 1)];
  }));
  const requiredQaCases = new Map([
    ["qa", "rejected"],
    ["qa-missing-local-artifact-ref", "rejected"],
    ["qa-directory-local-artifact-ref", "rejected"],
    ["qa-directory-manifest", "rejected"],
    ["qa-irrelevant-wallet-artifact", "rejected"],
    ["qa-irrelevant-failure-artifact", "rejected"],
    ["qa-irrelevant-support-artifact", "rejected"],
    ["qa-irrelevant-final-artifact", "rejected"],
    ["qa-irrelevant-smoke-artifact", "rejected"],
    ["qa-clean-wallet-no-receipt", "rejected"],
    ["qa-mobile-no-device-proof", "rejected"],
    ["qa-mobile-touch-only-proof", "rejected"],
    ["qa-mobile-viewport-marker-overflow", "rejected"],
    ["qa-desktop-connect-generic-wallet-proof", "rejected"],
    ["qa-desktop-disconnect-generic-wallet-proof", "rejected"],
    ["qa-desktop-reconnect-generic-wallet-proof", "rejected"],
    ["qa-wrong-network-generic-wallet-proof", "rejected"],
    ["qa-mobile-web3-browser-generic-wallet-proof", "rejected"],
    ["qa-clean-wallet-first-tx-generic-wallet-proof", "rejected"],
    ["qa-slow-network-auth-modal-generic-wallet-proof", "rejected"],
    ["qa-slow-network-chat-auth-generic-wallet-proof", "rejected"],
    ["qa-shared-group-artifact", "rejected"],
    ["qa-future-timestamp", "rejected"],
    ["qa-unsafe-target-chain-id", "rejected"],
    ["qa-production-app-id-not-configured", "rejected"],
    ["qa-public-url-evidence-remains-external-required", "rejected"],
    ["qa-private-url-evidence", "rejected"],
    ["qa-missing-auto-miner-log-field", "rejected"],
    ["qa-missing-security-scan", "rejected"],
    ["qa-wrong-candidate-revision", "rejected"],
    ["qa-wrong-scan-manifest-digest", "rejected"],
    ["qa-unsealed-security-scan", "rejected"],
    ["qa-dirty-candidate-checkout", "rejected"],
    ["qa-stale-signed-security-scan", "rejected"],
    ["qa-expired-security-attestation", "rejected"],
    ["qa-commit-mode-security-scan", "rejected"],
    ["qa-custom-inventory-security-scan", "rejected"],
    ["qa-security-artifact-digest-mismatch", "rejected"],
    ["qa-open-medium-security-finding", "rejected"],
    ["qa-unsigned-security-attestation", "rejected"],
    ["qa-self-authored-security-attestation", "rejected"],
    ["qa-tampered-security-attestation", "rejected"],
    ["qa-missing-reviewer-trust-anchor", "rejected"],
    ["qa-valid-local-verifier-remains-external-required", "rejected"],
    ["qa-deep-repository-local-verifier-remains-external-required", "rejected"],
    ["qa-final-output", "rejected"],
    ["qa-draft-unsafe-chain-id", "rejected"],
    ["qa-canary-plan-unsafe-chain-id", "rejected"],
    ["qa-missing-wallet-artifact", "rejected"],
    ["qa-missing-failure-artifact", "rejected"],
    ["qa-directory-wallet-artifact", "rejected"],
    ["qa-shared-wallet-failure-artifact", "rejected"],
    ["qa-missing-support-artifact", "rejected"],
    ["qa-missing-finalqa-artifact", "rejected"],
    ["qa-missing-smoke-artifact", "rejected"],
    ["qa-missing-clean-wallet-tx", "rejected"],
  ]);
  assert.equal(qaStatuses.size, requiredQaCases.size, "QA behavior receipt must expose its exact case family");
  for (const [id, expectedStatus] of requiredQaCases) {
    assert.equal(qaStatuses.get(id), expectedStatus, `${id} must remain ${expectedStatus}`);
  }
  for (const omittedId of requiredQaCases.keys()) {
    const mutant = new Map(qaStatuses);
    mutant.delete(omittedId);
    assert.notEqual(mutant.get(omittedId), requiredQaCases.get(omittedId), `${omittedId} removal mutant must fail`);
  }
  assert.doesNotMatch(
    `${String(result.stdout)}\n${String(result.stderr)}`,
    /(?:[A-Za-z]:\\|\/(?:home|tmp|var)\/).*lore-proof-/i,
    "compact proof draft output must not disclose temporary evidence paths",
  );
  assert.deepEqual(
    proofTempEntries(),
    before,
    "proof draft behavior suite must clean every owned temporary fixture directory",
  );

  const originRoot = mkdtempSync(join(tmpdir(), "lore-proof-origin-behavior-"));
  try {
    const artifactArgs = ["wallet", "failure", "support", "finalqa", "smoke"].map((name) => {
      const artifactPath = join(originRoot, `${name}.log`);
      writeFileSync(artifactPath, `${name}=redacted\n`, "utf8");
      return `--${name}-artifact=${artifactPath}`;
    });
    const originConsumers = [
      {
        id: "monitoring-test-plan",
        script: "create-monitoring-test-plan.mjs",
        args: ["--provider=monitor", "--error-provider=errors", "--alert-target=ops", "--release=behavior"],
        extension: "md",
      },
      {
        id: "qa-canary-test-plan",
        script: "create-qa-canary-test-plan.mjs",
        args: ["--network=linea-mainnet", "--chain-id=59144"],
        extension: "md",
      },
      {
        id: "qa-proof-draft",
        script: "create-qa-proof-draft.mjs",
        args: ["--network=linea-mainnet", "--chain-id=59144", `--clean-wallet-tx=0x${"1".repeat(64)}`, ...artifactArgs],
        extension: "json",
      },
    ];
    const rejectedOrigins = [
      "https://user:password@playlore.xyz",
      "https://playlore",
      "https://198.51.100.1",
      "https://playlore.xyz/path",
    ];
    for (const consumer of originConsumers) {
      const validOut = join(originRoot, `${consumer.id}-valid.${consumer.extension}`);
      const valid = spawnSync(
        process.execPath,
        [resolve("scripts", consumer.script), "--origin=https://playlore.xyz", `--out=${validOut}`, ...consumer.args],
        { cwd: process.cwd(), env: proofDraftChildEnv(), encoding: "utf8", timeout: 15_000, windowsHide: true },
      );
      assert.equal(valid.status, 0, `${consumer.id} shared-origin happy path failed: ${String(valid.stderr).slice(-1_000)}`);
      assert.equal(existsSync(validOut), true, `${consumer.id} must publish its draft for a valid final origin`);
      if (consumer.id === "qa-canary-test-plan") {
        const planText = readFileSync(validOut, "utf8");
        for (const requiredItem of [
          "Wallet loading state resolves or shows a recoverable error within the documented timeout.",
          "ETH top-up, LINEA deposit, withdrawal, rejected prompt, timeout, and signed on-chain revert copy are verified.",
          "Pool chart remains visible with an explicit empty state when there are no bets.",
          "Manual bet, Auto-Miner, tile values, wallet balances, jackpot amounts, and reward amounts use consistent number typography.",
          "Mobile layout, jackpot ticker, right panel, overlays, and chat geometry are verified without clipping or overlap.",
          "Jackpot and reward visibility are verified in empty, pending, awarded, and claimable states.",
        ]) {
          assert.match(planText, new RegExp(requiredItem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        }
      }
      if (consumer.id === "qa-proof-draft") {
        const draft = JSON.parse(readFileSync(validOut, "utf8"));
        assert.equal(draft.wallet?.privyAllowedOrigins?.productionAppIdConfigured, false);
        assert.equal(
          draft.wallet?.privyAllowedOrigins?.notes,
          "Privy dashboard allowed-origin and redacted production app id configuration proof is required.",
        );
        assert.deepEqual(
          draft.supportAuditVisibility?.autoMinerLogFields?.fields,
          ["round", "epoch", "nonce", "txHash", "retryCount", "stopReason"],
        );
      }
      for (const [originIndex, origin] of rejectedOrigins.entries()) {
        const rejectedOut = join(originRoot, `${consumer.id}-rejected-${originIndex}.${consumer.extension}`);
        const rejected = spawnSync(
          process.execPath,
          [resolve("scripts", consumer.script), `--origin=${origin}`, `--out=${rejectedOut}`, ...consumer.args],
          { cwd: process.cwd(), env: proofDraftChildEnv(), encoding: "utf8", timeout: 15_000, windowsHide: true },
        );
        assert.equal(rejected.status, 1, `${consumer.id} must reject ${origin}`);
        assert.match(`${rejected.stdout}\n${rejected.stderr}`, /--origin must be a public HTTPS origin without path, query, or hash/);
        assert.equal(existsSync(rejectedOut), false, `${consumer.id} must not publish a draft for ${origin}`);
      }
    }
    const readinessChecklist = readFileSync(resolve("docs", "mainnet-readiness-checklist.md"), "utf8");
    const readinessCommand = [resolve("scripts", "check-readiness-checklist.mjs"), "--summary-only"];
    const readinessCurrent = spawnSync(process.execPath, readinessCommand, {
      cwd: process.cwd(),
      env: proofDraftChildEnv(),
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    });
    assert.equal(readinessCurrent.status, 0, readinessCurrent.stderr || readinessCurrent.stdout);
    assert.match(readinessCurrent.stdout, /status=pass, checks=4, checkedItems=\d+, evidenceIssues=0, issues=0/);

    const readinessMutantPath = join(originRoot, "mainnet-readiness-missing-auto-miner-fields.md");
    const requiredReadinessLine = "Auto-miner logs expose round, epoch, nonce, tx, retry, and stop reason.";
    assert.equal(readinessChecklist.includes(requiredReadinessLine), true);
    writeFileSync(readinessMutantPath, readinessChecklist.replace(requiredReadinessLine, "Auto-miner logs are visible."), "utf8");
    const readinessMutant = spawnSync(
      process.execPath,
      [...readinessCommand, `--checklist=${readinessMutantPath}`],
      { cwd: process.cwd(), env: proofDraftChildEnv(), encoding: "utf8", timeout: 15_000, windowsHide: true },
    );
    assert.equal(readinessMutant.status, 1, "readiness checker must reject a checklist without the exact Auto-Miner audit fields");
    assert.match(readinessMutant.stdout, /status=fail, checks=4, checkedItems=\d+, evidenceIssues=0, issues=1/);
    assert.doesNotMatch(`${readinessMutant.stdout}\n${readinessMutant.stderr}`, /mainnet-readiness-missing-auto-miner-fields/);
  } finally {
    rmSync(originRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
    assert.equal(existsSync(originRoot), false, "origin policy behavior fixtures must be removed");
  }

  const bundleRoot = mkdtempSync(join(tmpdir(), "lore-draft-bundle-behavior-"));
  const restoreTempsBefore = readdirSync(tmpdir()).filter((name) => name.startsWith("lore-proof-draft-restore-")).sort();
  try {
    const bundleResult = spawnSync(
      process.execPath,
      [resolve("scripts", "create-all-proof-drafts.mjs"), "--summary-only", `--out-dir=${bundleRoot}`],
      {
        cwd: process.cwd(),
        env: proofDraftChildEnv(),
        encoding: "utf8",
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
    );
    assert.equal(
      bundleResult.status,
      0,
      `proof draft bundle failed: ${[bundleResult.error?.message, bundleResult.stdout, bundleResult.stderr].filter(Boolean).join(" | ").slice(-2_000)}`,
    );
    assert.equal(
      String(bundleResult.stdout).trim(),
      [
        "status=pass, drafts=7, written=7, failed=0, summaryOnly=true",
        "Summary: all proof drafts were created; Draft files are not launch proof; promote only after real external evidence and strict validation.",
      ].join("\n"),
      "proof draft bundle summary must expose exact bounded counts and non-proof warning",
    );
    assert.equal(String(bundleResult.stderr), "");
    assert.doesNotMatch(String(bundleResult.stdout), /(?:[A-Za-z]:\\|\/(?:home|tmp|var)\/)/i);
    assert.equal(
      readdirSync(bundleRoot).filter((name) => /-proof\.draft\.json$/i.test(name)).length,
      7,
      "proof draft bundle must create exactly the seven expected draft manifests",
    );
    assert.deepEqual(
      readdirSync(tmpdir()).filter((name) => name.startsWith("lore-proof-draft-restore-")).sort(),
      restoreTempsBefore,
      "proof draft bundle must remove its external restore fixture root",
    );
  } finally {
    rmSync(bundleRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
    assert.equal(existsSync(bundleRoot), false, "proof draft bundle output fixture must be removed");
  }
}
