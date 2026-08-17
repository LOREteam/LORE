import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { parseSummaryTimeoutEnv } from "./summary-timeout.mjs";
import {
  EXPECTED_V10_DUPLICATE_BATCH_MODEL_DIGEST,
  runContractV10Summary,
  summarizeContractV10Result,
} from "./run-contract-v10-summary.mjs";
import { runBusinessLogicSummary, summarizeBusinessLogicResult } from "./run-business-logic-summary.mjs";
import { runIndexerStorageSummary, summarizeIndexerStorageResult } from "./run-indexer-storage-summary.mjs";
import { runDbOperationsSummary, summarizeDbOperationsResult } from "./run-db-operations-summary.mjs";
import { runMonitoringDrillSummary, summarizeMonitoringDrillResult } from "./run-monitoring-drill-summary.mjs";
import { runFetchTimeoutSummary, summarizeFetchTimeoutResult } from "./run-fetch-timeout-summary.mjs";
import { runStoredNumberParsingSummary, summarizeStoredNumberParsingResult } from "./run-stored-number-parsing-summary.mjs";
import { runTypecheckSummary, summarizeTypecheckResult } from "./run-typecheck-summary.mjs";
import { runBuildSummary, summarizeBuildResult } from "./run-build-summary.mjs";
import { runEslintSummary, summarizeEslintResult } from "./run-eslint-summary.mjs";
import { runV10OfflineIdentitySummary, summarizeV10OfflineIdentityResults } from "./run-v10-offline-identity-summary.mjs";
import { runV10DeployedSummary, summarizeV10DeployedResults } from "./run-v10-deployed-summary.mjs";

const TEST_ENV = "LORE_TEST_SUMMARY_TIMEOUT_MS";

function withTimeoutEnv(value, callback) {
  const previous = process.env[TEST_ENV];
  if (value === undefined) delete process.env[TEST_ENV];
  else process.env[TEST_ENV] = value;
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env[TEST_ENV];
    else process.env[TEST_ENV] = previous;
  }
}

export function runSummaryTimeoutTests() {
  withTimeoutEnv(undefined, () => {
    assert.equal(parseSummaryTimeoutEnv(TEST_ENV, 30_000), 30_000);
  });
  withTimeoutEnv("900000", () => {
    assert.equal(parseSummaryTimeoutEnv(TEST_ENV, 30_000), 900_000);
  });
  for (const invalid of ["00", "01", "1e3", "1.5", "-1", "999", "900001", "9007199254740992"]) {
    withTimeoutEnv(invalid, () => {
      assert.throws(() => parseSummaryTimeoutEnv(TEST_ENV, 30_000), /canonical decimal integer|between 1000 and 900000/);
    });
  }
  assert.throws(() => parseSummaryTimeoutEnv(TEST_ENV, 999), /fallback must be between 1000 and 900000/);
  withTimeoutEnv("250", () => {
    assert.equal(parseSummaryTimeoutEnv(TEST_ENV, 200, { min: 100, max: 300 }), 250);
  });

  const validPayload = {
    status: "passed",
    compilerVersion: "0.8.36+commit.abcdef12",
    runtimeBytes: 12_345,
    functionSelectors: 31,
    stateChangingEntrypoints: 20,
    guardedLocalMutationEntrypoints: 20,
    protocolFeeFlushModelCases: 7,
    protocolFeeFlushEntrypointCases: 8,
    duplicateBatchModelCases: 10,
    duplicateBatchModelDigest: EXPECTED_V10_DUPLICATE_BATCH_MODEL_DIGEST,
    tokenTransferRollbackCases: 10,
    batchTransferRollbackCases: 11,
    dustTransferRollbackCases: 12,
    timelockBoundaryCases: 13,
    dustBoundaryCases: 14,
    packedBoundaryCases: 15,
    fullRangeAccountingCases: 16,
    fullRangeProportionalCases: 17,
  };
  let spawnCall = null;
  const lines = [];
  withTemporaryContractTimeout("240000", () => {
    const outcome = runContractV10Summary({
      cwd: "C:\\isolated-v10-summary",
      env: { npm_execpath: "C:\\safe\\npm-cli.js", SECRET_VALUE: "must-not-print" },
      platform: "win32",
      execPath: "C:\\safe\\node.exe",
      spawn: (command, args, options) => {
        spawnCall = { command, args, options };
        return {
          status: 0,
          stdout: `diagnostic {not json}\n${JSON.stringify(validPayload)}\n`,
          stderr: "",
        };
      },
      writeLine: (line) => lines.push(line),
    });
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.summary.status, "pass");
  });
  assert.deepEqual(spawnCall?.command, "C:\\safe\\node.exe");
  assert.deepEqual(spawnCall?.args, ["C:\\safe\\npm-cli.js", "--silent", "run", "test:contract:v10"]);
  assert.equal(spawnCall?.options.cwd, "C:\\isolated-v10-summary");
  assert.equal(spawnCall?.options.encoding, "utf8");
  assert.equal(spawnCall?.options.maxBuffer, 2 * 1024 * 1024);
  assert.equal(spawnCall?.options.timeout, 240_000);
  assert.equal(spawnCall?.options.env.NO_UPDATE_NOTIFIER, "1");
  assert.equal(spawnCall?.options.env.npm_config_update_notifier, "false");
  assert.equal(spawnCall?.options.env.npm_config_fund, "false");
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), summarizeContractV10Result({ status: 0, stdout: JSON.stringify(validPayload), stderr: "" }));

  const malformedCounters = summarizeContractV10Result({
    status: 0,
    stdout: JSON.stringify({
      ...validPayload,
      compilerVersion: "C:\\Users\\operator\\secret-solc.exe",
      runtimeBytes: -1,
      functionSelectors: Number.MAX_SAFE_INTEGER + 1,
      stateChangingEntrypoints: "20",
      fullRangeAccountingCases: 1.5,
    }),
    stderr: "",
  });
  assert.equal(malformedCounters.status, "pass");
  assert.equal(malformedCounters.compilerVersion, "unknown");
  assert.equal(malformedCounters.runtimeBytes, 0);
  assert.equal(malformedCounters.functionSelectors, 0);
  assert.equal(malformedCounters.stateChangingEntrypoints, 0);
  assert.equal(malformedCounters.fullRangeAccountingCases, 0);
  assert.equal(summarizeContractV10Result({
    status: 0,
    stdout: JSON.stringify({ ...validPayload, compilerVersion: "SECRET_TOKEN_ABC" }),
    stderr: "",
  }).compilerVersion, "unknown");

  const assertionFlood = summarizeContractV10Result({
    status: 0,
    stdout: `${JSON.stringify(validPayload)}\n${"AssertionError ".repeat(10_100)}`,
    stderr: "",
  });
  assert.equal(assertionFlood.status, "fail");
  assert.equal(assertionFlood.assertionFailures, 9_999);
  assert.deepEqual(summarizeContractV10Result({ status: null, stdout: "", stderr: "", error: { code: "ETIMEDOUT" } }), {
    status: "fail",
    invariantSuite: "v10",
    compilerVersion: "unknown",
    runtimeBytes: 0,
    functionSelectors: 0,
    stateChangingEntrypoints: 0,
    guardedLocalMutationEntrypoints: 0,
    protocolFeeFlushModelCases: 0,
    protocolFeeFlushEntrypointCases: 0,
    duplicateBatchModelCases: 0,
    duplicateBatchModelManifest: false,
    tokenTransferRollbackCases: 0,
    batchTransferRollbackCases: 0,
    dustTransferRollbackCases: 0,
    timelockBoundaryCases: 0,
    dustBoundaryCases: 0,
    packedBoundaryCases: 0,
    fullRangeAccountingCases: 0,
    fullRangeProportionalCases: 0,
    assertionFailures: 0,
    timedOut: true,
  });
  assert.equal(summarizeContractV10Result({ status: null, error: { code: "ENOBUFS" } }).issue, "contract-v10-output-too-large");
  assert.equal(summarizeContractV10Result({ status: null, error: { code: "EACCES" } }).issue, "contract-v10-spawn-failed");

  const proofFields = [
    "jsonNoStoreRoutes", "sessionVaryCookie", "boundedJsonRoutes", "rateLimitNoStore", "routeErrorRedaction",
    "depositsRecoveryGlobalBound", "browserBaselineCompactPerformance", "authTrustedOriginFailClosed",
    "authReplayNonceBoundary", "authCanonicalNonceBoundary", "authSessionCookieBoundary", "sharedRateLimitRetryAfterBound",
    "externalRateLimitPublicEndpoint", "externalRateLimitResponseBound", "externalSharedLockCanonical",
    "replicaRateLimitStrictConfig", "miningPendingRecoveryScoped", "miningReceiptRevertExplicit",
    "walletHashlessNonceRecovery", "manualMinePendingAmbiguousSafe", "approvalDuplicateSendSafe",
    "autoMinerNonceRecoverySafe", "autoMinerRpcReconnectSafe", "rewardClaimStateSafe",
    "safetyPoolClaimStateSafe", "resolverClaimStateSafe",
  ];
  const businessProof = Object.fromEntries([["version", 1], ...proofFields.map((field) => [field, true])]);
  const validBusinessOutput = `Suppressed 26 expected synthetic warnings\nBusiness logic proof: ${JSON.stringify(businessProof)}\nBusiness logic tests passed.\n`;
  const businessSummary = summarizeBusinessLogicResult({ status: 0, stdout: validBusinessOutput, stderr: "" }, { durationMs: 123 });
  assert.equal(businessSummary.status, "pass");
  assert.equal(businessSummary.localProof, true);
  assert.equal(businessSummary.apiBoundaryProof, true);
  assert.equal(businessSummary.walletTxStateMachineProof, true);
  assert.equal(businessSummary.walletClaimStateMachineProof, true);
  assert.equal(businessSummary.expectedWarnings, 26);
  assert.equal(businessSummary.assertionFailures, 0);
  assert.equal(businessSummary.durationMs, 123);
  assert.equal(businessSummary.childExitCode, 0);

  const incompleteProof = { ...businessProof, resolverClaimStateSafe: false };
  const incompleteSummary = summarizeBusinessLogicResult({
    status: 0,
    stdout: `Business logic proof: ${JSON.stringify(incompleteProof)}\nBusiness logic tests passed.\n`,
    stderr: "",
  });
  assert.equal(incompleteSummary.status, "fail");
  assert.equal(incompleteSummary.localProof, false);
  assert.equal(incompleteSummary.issue, "local-proof-summary-missing");

  const duplicateMarker = summarizeBusinessLogicResult({
    status: 0,
    stdout: `${validBusinessOutput}Business logic proof: ${JSON.stringify(businessProof)}\n`,
    stderr: "",
  });
  assert.equal(duplicateMarker.status, "fail");
  assert.equal(duplicateMarker.localProof, false);
  assert.equal(duplicateMarker.issue, "local-proof-summary-missing");

  const businessAssertionFlood = summarizeBusinessLogicResult({
    status: 0,
    stdout: `${validBusinessOutput}${"AssertionError ".repeat(10_100)}`,
    stderr: "",
  });
  assert.equal(businessAssertionFlood.status, "fail");
  assert.equal(businessAssertionFlood.assertionFailures, 9_999);
  assert.equal(summarizeBusinessLogicResult({ status: null, error: { code: "ENOBUFS" } }).issue, "business-logic-output-too-large");
  assert.equal(summarizeBusinessLogicResult({ status: null, error: { code: "EACCES" } }).issue, "business-logic-spawn-failed");
  assert.equal(summarizeBusinessLogicResult({ status: null, error: { code: "ETIMEDOUT" } }).timedOut, true);

  let businessRunnerCall = null;
  const businessSpawn = () => assert.fail("injected isolated runner must own child execution");
  const businessLines = [];
  const businessTimes = [1_000, 1_321];
  withTemporaryBusinessTimeout("240000", () => {
    const outcome = runBusinessLogicSummary({
      cwd: "C:\\isolated-business-summary",
      env: { SAFE_ENV: "present" },
      execPath: "C:\\safe\\node.exe",
      exists: () => true,
      now: () => businessTimes.shift(),
      spawn: businessSpawn,
      runIsolatedChild: (options) => {
        businessRunnerCall = options;
        return { status: 0, stdout: validBusinessOutput, stderr: "" };
      },
      writeLine: (line) => businessLines.push(line),
    });
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.summary.status, "pass");
  });
  assert.equal(businessRunnerCall?.processExecPath, "C:\\safe\\node.exe");
  assert.deepEqual(businessRunnerCall?.args, [
    "C:\\isolated-business-summary\\node_modules\\tsx\\dist\\cli.mjs",
    "scripts/test-business-logic.mjs",
  ]);
  assert.equal(businessRunnerCall?.cwd, "C:\\isolated-business-summary");
  assert.equal(businessRunnerCall?.encoding, "utf8");
  assert.equal(businessRunnerCall?.maxBuffer, 2 * 1024 * 1024);
  assert.equal(businessRunnerCall?.timeout, 240_000);
  assert.equal(businessRunnerCall?.spawnSyncFn, businessSpawn);
  assert.equal(businessRunnerCall?.env.NO_UPDATE_NOTIFIER, "1");
  assert.equal(businessRunnerCall?.env.npm_config_update_notifier, "false");
  assert.equal(businessRunnerCall?.env.npm_config_fund, "false");
  assert.equal(businessLines.length, 1);
  assert.equal(JSON.parse(businessLines[0]).durationMs, 321);
  assert.throws(
    () => runBusinessLogicSummary({ cwd: "C:\\missing-runner", exists: () => false }),
    /test:logic runner unavailable/,
  );

  const importProbe = spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    'await import("./scripts/run-contract-v10-summary.mjs");',
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, CONTRACT_V10_SUMMARY_TIMEOUT_MS: "01" },
  });
  assert.equal(importProbe.status, 0);
  assert.equal(importProbe.stdout, "");
  assert.equal(importProbe.stderr, "");

  const directProbe = spawnSync(process.execPath, ["scripts/run-contract-v10-summary.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, CONTRACT_V10_SUMMARY_TIMEOUT_MS: "01" },
  });
  assert.equal(directProbe.status, 1);
  assert.equal(directProbe.stderr, "");
  const directSummary = JSON.parse(directProbe.stdout);
  assert.deepEqual(directSummary, {
    status: "fail",
    invariantSuite: "v10",
    issue: "contract-v10-summary-config-invalid",
    error: "CONTRACT_V10_SUMMARY_TIMEOUT_MS must be a canonical decimal integer",
  });

  const businessImportProbe = spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    'await import("./scripts/run-business-logic-summary.mjs");',
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, BUSINESS_LOGIC_SUMMARY_TIMEOUT_MS: "01" },
  });
  assert.equal(businessImportProbe.status, 0);
  assert.equal(businessImportProbe.stdout, "");
  assert.equal(businessImportProbe.stderr, "");

  const businessDirectProbe = spawnSync(process.execPath, ["scripts/run-business-logic-summary.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, BUSINESS_LOGIC_SUMMARY_TIMEOUT_MS: "01" },
  });
  assert.equal(businessDirectProbe.status, 1);
  assert.equal(businessDirectProbe.stderr, "");
  assert.deepEqual(JSON.parse(businessDirectProbe.stdout), {
    status: "fail",
    issue: "business-logic-summary-config-invalid",
    error: "BUSINESS_LOGIC_SUMMARY_TIMEOUT_MS must be a canonical decimal integer",
  });

  const indexerPayload = {
    status: "pass",
    categories: 6,
    financialEventCategories: [
      "bets", "jackpots", "reward_claims", "resolver_rewards", "dust_settlements",
      "protocol_fee_flushes", "extra_one", "extra_two", "extra_three", "BAD-CATEGORY",
    ],
    legacyRead: true,
    candidatePagination: true,
    tileUserCounts: true,
    chainScopeIsolation: true,
    contractScopeIsolation: true,
    depositScopeIsolation: true,
    categoryIdIsolation: true,
    epochScopeIsolation: true,
    jackpotScopeIsolation: true,
    resolverRewardScopeIsolation: true,
    dustSettlementScopeIsolation: true,
    normalizedEventScopeIsolation: true,
    rewardClaimScopeIsolation: true,
    protocolFeeScopeIsolation: true,
    idempotentEventUpsert: true,
    staleEventReplayIgnored: true,
    staleEpochReplayIgnored: true,
    staleFinancialReplayIgnored: true,
    idempotentBetUpsert: true,
    idempotentDepositUpsert: true,
    idempotentEpochUpsert: true,
    idempotentJackpotUpsert: true,
    idempotentResolverRewardUpsert: true,
    idempotentDustSettlementUpsert: true,
    idempotentRewardClaimUpsert: true,
    idempotentProtocolFeeUpsert: true,
    normalizedEventIdRequiresTxLog: true,
    batchClaimKindParity: true,
    singleRebateClaimParity: true,
    dustSettlementKindParity: true,
    partialRpcLogFallback: true,
    malformedPayloadFallback: true,
    boundedEventStorage: true,
    limitedEventReads: true,
    sameBlockEventOrdering: true,
  };
  const indexerSummary = summarizeIndexerStorageResult({
    status: 0,
    stdout: `storage diagnostic\n${JSON.stringify(indexerPayload)}\n`,
    stderr: "",
  });
  assert.equal(indexerSummary.status, "pass");
  assert.equal(indexerSummary.categories, 6);
  assert.deepEqual(indexerSummary.financialEventCategories, indexerPayload.financialEventCategories.slice(0, 8));
  assert.equal(indexerSummary.chainScopeIsolation, true);
  assert.equal(indexerSummary.normalizedEventScopeIsolation, true);
  assert.equal(indexerSummary.protocolFeeScopeIsolation, true);
  assert.equal(indexerSummary.idempotentUpsert, true);
  assert.equal(indexerSummary.singleRebateClaimParity, true);
  assert.equal(indexerSummary.partialRpcLogFallback, true);
  assert.equal(indexerSummary.malformedPayloadFallback, true);
  assert.equal(indexerSummary.sameBlockEventOrdering, true);
  for (const field of [
    "depositScopeIsolation", "epochScopeIsolation", "jackpotScopeIsolation",
    "resolverRewardScopeIsolation", "dustSettlementScopeIsolation", "rewardClaimScopeIsolation",
    "idempotentDepositUpsert", "idempotentEpochUpsert", "idempotentJackpotUpsert",
    "idempotentResolverRewardUpsert", "idempotentDustSettlementUpsert", "idempotentRewardClaimUpsert",
    "batchClaimKindParity", "singleRebateClaimParity", "dustSettlementKindParity",
  ]) {
    assert.equal(indexerSummary[field], true, `${field} must survive compact summary projection`);
  }
  const malformedIndexerSummary = summarizeIndexerStorageResult({
    status: 0,
    stdout: JSON.stringify({ ...indexerPayload, categories: -1, financialEventCategories: ["ok", "../unsafe"] }),
    stderr: "",
  });
  assert.equal(malformedIndexerSummary.categories, 0);
  assert.deepEqual(malformedIndexerSummary.financialEventCategories, ["ok"]);
  assert.equal(summarizeIndexerStorageResult({ status: null, error: { code: "ENOBUFS" } }).issue, "indexer-storage-output-too-large");
  assert.equal(summarizeIndexerStorageResult({ status: null, error: { code: "EACCES" } }).issue, "indexer-storage-spawn-failed");
  assert.equal(summarizeIndexerStorageResult({ status: null, error: { code: "ETIMEDOUT" } }).timedOut, true);
  assert.equal(summarizeIndexerStorageResult({
    status: 0,
    stdout: `${JSON.stringify(indexerPayload)}${"AssertionError ".repeat(10_100)}`,
  }).assertionFailures, 9_999);

  let indexerSpawnCall = null;
  const indexerLines = [];
  withTemporaryNamedEnv("INDEXER_STORAGE_SUMMARY_TIMEOUT_MS", "240000", () => {
    const outcome = runIndexerStorageSummary({
      cwd: "C:\\isolated-indexer-summary",
      env: { npm_execpath: "C:\\safe\\npm-cli.js", SAFE_ENV: "present" },
      execPath: "C:\\safe\\node.exe",
      platform: "win32",
      spawn: (command, args, options) => {
        indexerSpawnCall = { command, args, options };
        return { status: 0, stdout: JSON.stringify(indexerPayload), stderr: "" };
      },
      writeLine: (line) => indexerLines.push(line),
    });
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.summary.status, "pass");
  });
  assert.equal(indexerSpawnCall?.command, "C:\\safe\\node.exe");
  assert.deepEqual(indexerSpawnCall?.args, ["C:\\safe\\npm-cli.js", "--silent", "run", "test:indexer-storage"]);
  assert.equal(indexerSpawnCall?.options.cwd, "C:\\isolated-indexer-summary");
  assert.equal(indexerSpawnCall?.options.encoding, "utf8");
  assert.equal(indexerSpawnCall?.options.maxBuffer, 1024 * 1024);
  assert.equal(indexerSpawnCall?.options.timeout, 240_000);
  assert.equal(indexerSpawnCall?.options.env.NO_UPDATE_NOTIFIER, "1");
  assert.equal(indexerSpawnCall?.options.env.npm_config_update_notifier, "false");
  assert.equal(indexerSpawnCall?.options.env.npm_config_fund, "false");
  assert.equal(indexerLines.length, 1);
  assert.equal(JSON.parse(indexerLines[0]).sameBlockEventOrdering, true);

  const dbPayload = {
    status: "pass",
    backup: { integrity: "ok", rows: 21 },
    retention: { expiredRemoved: 3, recentPreserved: true },
    scopeAudit: { readOnly: true, foreignRows: 2 },
    faults: {
      repoLocalProductionBackupRejected: true,
      futureSourceBackupSummaryRejected: true,
      missingSourceBackupSummaryRejected: true,
      malformedRetentionBackupSummaryRejected: true,
      unsafeRetentionBackupSummaryRejected: true,
      corruptSourceBackupCleanup: true,
      restoreUsesSuppliedBackupArtifact: true,
      corruptBackupRestoreRejected: true,
      diskFullRejected: true,
      corruptStartupRejected: true,
    },
  };
  const dbSummary = summarizeDbOperationsResult({ status: 0, stdout: JSON.stringify(dbPayload), stderr: "" });
  assert.equal(dbSummary.status, "pass");
  assert.equal(dbSummary.backupIntegrity, true);
  assert.equal(dbSummary.backupRows, 21);
  assert.equal(dbSummary.retentionExpiredRemoved, 3);
  assert.equal(dbSummary.retentionRecentPreserved, true);
  assert.equal(dbSummary.scopeReadOnly, true);
  assert.equal(dbSummary.foreignRows, 2);
  assert.equal(dbSummary.futureSourceBackupSummaryRejected, true);
  assert.equal(dbSummary.restoreUsesSuppliedBackupArtifact, true);
  assert.equal(dbSummary.corruptBackupRestoreRejected, true);
  assert.equal(dbSummary.diskFullRejected, true);
  const malformedDbSummary = summarizeDbOperationsResult({
    status: 0,
    stdout: JSON.stringify({ ...dbPayload, backup: { integrity: "ok", rows: -2 }, retention: { expiredRemoved: 1.5 }, scopeAudit: { foreignRows: Number.MAX_SAFE_INTEGER + 1 } }),
    stderr: "",
  });
  assert.equal(malformedDbSummary.backupRows, 0);
  assert.equal(malformedDbSummary.retentionExpiredRemoved, 0);
  assert.equal(malformedDbSummary.foreignRows, 0);
  assert.equal(summarizeDbOperationsResult({ status: null, error: { code: "ENOBUFS" } }).issue, "db-operations-output-too-large");
  assert.equal(summarizeDbOperationsResult({ status: null, error: { code: "EACCES" } }).issue, "db-operations-spawn-failed");
  assert.equal(summarizeDbOperationsResult({ status: null, error: { code: "ETIMEDOUT" } }).timedOut, true);
  assert.equal(summarizeDbOperationsResult({
    status: 0,
    stdout: `${JSON.stringify(dbPayload)}${"AssertionError ".repeat(10_100)}`,
  }).assertionFailures, 9_999);

  let dbSpawnCall = null;
  const dbLines = [];
  withTemporaryNamedEnv("DB_OPERATIONS_SUMMARY_TIMEOUT_MS", "230000", () => {
    const outcome = runDbOperationsSummary({
      cwd: "C:\\isolated-db-summary",
      env: { SAFE_ENV: "present" },
      platform: "win32",
      spawn: (command, args, options) => {
        dbSpawnCall = { command, args, options };
        return { status: 0, stdout: JSON.stringify(dbPayload), stderr: "" };
      },
      writeLine: (line) => dbLines.push(line),
    });
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.summary.status, "pass");
  });
  assert.equal(dbSpawnCall?.command, "npm.cmd");
  assert.deepEqual(dbSpawnCall?.args, ["--silent", "run", "test:db-operations"]);
  assert.equal(dbSpawnCall?.options.cwd, "C:\\isolated-db-summary");
  assert.equal(dbSpawnCall?.options.encoding, "utf8");
  assert.equal(dbSpawnCall?.options.maxBuffer, 1024 * 1024);
  assert.equal(dbSpawnCall?.options.timeout, 230_000);
  assert.equal(dbSpawnCall?.options.env.NO_UPDATE_NOTIFIER, "1");
  assert.equal(dbSpawnCall?.options.env.npm_config_update_notifier, "false");
  assert.equal(dbSpawnCall?.options.env.npm_config_fund, "false");
  assert.equal(dbLines.length, 1);
  assert.equal(JSON.parse(dbLines[0]).restoreUsesSuppliedBackupArtifact, true);

  const monitoringPayload = {
    status: "pass", alerts: 4, duplicateAlertsAfterRestart: 0, recoveries: 2, deliveries: 3,
    repoLocalBackupDirRejected: true, localPathBaseUrlRejected: true,
    malformedDiagnosticsSecretRejected: true, malformedNumericEnvRejected: true, stateCleared: true,
  };
  const monitoringSummary = summarizeMonitoringDrillResult({ status: 0, stdout: JSON.stringify(monitoringPayload), stderr: "" });
  assert.equal(monitoringSummary.status, "pass");
  assert.equal(monitoringSummary.alerts, 4);
  assert.equal(monitoringSummary.duplicateAlertsAfterRestart, 0);
  assert.equal(monitoringSummary.recoveries, 2);
  assert.equal(monitoringSummary.deliveries, 3);
  assert.equal(monitoringSummary.repoLocalBackupDirRejected, true);
  assert.equal(monitoringSummary.localPathBaseUrlRejected, true);
  assert.equal(monitoringSummary.malformedDiagnosticsSecretRejected, true);
  assert.equal(monitoringSummary.malformedNumericEnvRejected, true);
  assert.equal(monitoringSummary.stateCleared, true);
  const malformedMonitoring = summarizeMonitoringDrillResult({
    status: 0,
    stdout: JSON.stringify({ ...monitoringPayload, alerts: -1, duplicateAlertsAfterRestart: 1.5, recoveries: "2", deliveries: Number.MAX_SAFE_INTEGER + 1 }),
    stderr: "",
  });
  assert.equal(malformedMonitoring.alerts, 0);
  assert.equal(malformedMonitoring.duplicateAlertsAfterRestart, 0);
  assert.equal(malformedMonitoring.recoveries, 0);
  assert.equal(malformedMonitoring.deliveries, 0);
  assert.equal(summarizeMonitoringDrillResult({ status: null, error: { code: "ENOBUFS" } }).issue, "monitoring-drill-output-too-large");
  assert.equal(summarizeMonitoringDrillResult({ status: null, error: { code: "EACCES" } }).issue, "monitoring-drill-spawn-failed");
  assert.equal(summarizeMonitoringDrillResult({ status: null, error: { code: "ETIMEDOUT" } }).timedOut, true);
  assert.equal(summarizeMonitoringDrillResult({
    status: 0, stdout: `${JSON.stringify(monitoringPayload)}${"AssertionError ".repeat(10_100)}`,
  }).assertionFailures, 9_999);

  for (const [label, summarize, passText, outputIssue, spawnIssue] of [
    ["fetch", summarizeFetchTimeoutResult, "fetchWithTimeout tests passed", "fetch-timeout-output-too-large", "fetch-timeout-spawn-failed"],
    ["stored", summarizeStoredNumberParsingResult, "stored number parsing tests passed", "stored-number-parsing-output-too-large", "stored-number-parsing-spawn-failed"],
  ]) {
    const summary = summarize({ status: 0, stdout: passText, stderr: "" });
    assert.equal(summary.status, "pass", `${label} pass marker must be accepted`);
    assert.equal(summary.passed, true, `${label} pass marker must be projected`);
    assert.equal(summarize({ status: 0, stdout: "similar but not exact", stderr: "" }).status, "fail", `${label} missing marker must fail`);
    assert.equal(summarize({ status: null, error: { code: "ENOBUFS" } }).issue, outputIssue);
    assert.equal(summarize({ status: null, error: { code: "EACCES" } }).issue, spawnIssue);
    assert.equal(summarize({ status: null, error: { code: "ETIMEDOUT" } }).timedOut, true);
    assert.equal(summarize({ status: 0, stdout: `${passText}${"AssertionError ".repeat(10_100)}` }).assertionFailures, 9_999);
  }

  for (const spec of [
    {
      envName: "MONITORING_DRILL_SUMMARY_TIMEOUT_MS", timeout: "220000", cwd: "C:\\isolated-monitoring-summary",
      npmExecpath: "C:\\safe\\npm-cli.js", execPath: "C:\\safe\\node.exe", platform: "win32",
      script: "test:monitoring", maxBuffer: 1024 * 1024, run: runMonitoringDrillSummary,
      stdout: JSON.stringify(monitoringPayload), projectedField: "stateCleared",
    },
    {
      envName: "FETCH_TIMEOUT_SUMMARY_TIMEOUT_MS", timeout: "55000", cwd: "C:\\isolated-fetch-summary",
      platform: "win32", script: "test:fetch-timeout", maxBuffer: 512 * 1024, run: runFetchTimeoutSummary,
      stdout: "fetchWithTimeout tests passed", projectedField: "passed",
    },
    {
      envName: "STORED_NUMBER_PARSING_SUMMARY_TIMEOUT_MS", timeout: "56000", cwd: "C:\\isolated-stored-summary",
      platform: "linux", script: "test:stored-number-parsing", maxBuffer: 512 * 1024, run: runStoredNumberParsingSummary,
      stdout: "stored number parsing tests passed", projectedField: "passed",
    },
  ]) {
    let call = null;
    const lines = [];
    withTemporaryNamedEnv(spec.envName, spec.timeout, () => {
      const env = { SAFE_ENV: "present", ...(spec.npmExecpath ? { npm_execpath: spec.npmExecpath } : {}) };
      const outcome = spec.run({
        cwd: spec.cwd, env, execPath: spec.execPath ?? "C:\\safe\\node.exe", platform: spec.platform,
        spawn: (command, args, options) => {
          call = { command, args, options };
          return { status: 0, stdout: spec.stdout, stderr: "" };
        },
        writeLine: (line) => lines.push(line),
      });
      assert.equal(outcome.exitCode, 0);
      assert.equal(outcome.summary.status, "pass");
    });
    assert.equal(call?.command, spec.npmExecpath ? spec.execPath : spec.platform === "win32" ? "npm.cmd" : "npm");
    assert.deepEqual(call?.args, spec.npmExecpath
      ? [spec.npmExecpath, "--silent", "run", spec.script]
      : ["--silent", "run", spec.script]);
    assert.equal(call?.options.cwd, spec.cwd);
    assert.equal(call?.options.encoding, "utf8");
    assert.equal(call?.options.maxBuffer, spec.maxBuffer);
    assert.equal(call?.options.timeout, Number(spec.timeout));
    assert.equal(call?.options.env.NO_UPDATE_NOTIFIER, "1");
    assert.equal(call?.options.env.npm_config_update_notifier, "false");
    assert.equal(call?.options.env.npm_config_fund, "false");
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0])[spec.projectedField], true);
  }

  const typecheckPass = summarizeTypecheckResult({ status: 0, stdout: "Types generated successfully\n", stderr: "" });
  assert.deepEqual(typecheckPass, {
    status: "pass", nextTypegen: true, tsc: true, tsErrors: 0, tsCodes: [], timedOut: false,
  });
  const typecheckErrors = summarizeTypecheckResult({
    status: 1,
    stdout: "a.ts(1,1): error TS2322: bad\nb.ts(2,1): error TS1005: bad\nc.ts: error TS2322: duplicate",
    stderr: "next typegen failed",
  });
  assert.equal(typecheckErrors.status, "fail");
  assert.equal(typecheckErrors.nextTypegen, false);
  assert.equal(typecheckErrors.tsErrors, 3);
  assert.deepEqual(typecheckErrors.tsCodes, ["ts1005", "ts2322"]);
  assert.equal(summarizeTypecheckResult({ status: null, error: { code: "ENOBUFS" } }).issue, "typecheck-output-too-large");
  assert.equal(summarizeTypecheckResult({ status: null, error: { code: "ETIMEDOUT" } }).timedOut, true);
  const typeFlood = summarizeTypecheckResult({ status: 1, stdout: "error TS2322 ".repeat(10_100) });
  assert.equal(typeFlood.tsErrors, 9_999);
  assert.deepEqual(typeFlood.tsCodes, ["ts2322"]);
  const typeSpawnFailure = summarizeTypecheckResult({
    status: null, error: { code: "EACCES", message: "EACCES C:\\Users\\private\\secret.ts https://secret.example/path" },
  });
  assert.equal(typeSpawnFailure.status, "fail");
  assert.equal(typeSpawnFailure.issue, "typecheck-spawn-failed");
  assert.doesNotMatch(typeSpawnFailure.issue, /private|secret\.example|C:\\/i);

  const buildOutput = [
    "Compiled successfully",
    "Proxy (Middleware)",
    "ExperimentalWarning: SQLite is an experimental feature",
    "Warning: use `node --trace-warnings ...` to show where it was created",
    "Using edge runtime on a page currently disables static generation for that page",
  ].join("\n");
  const buildPass = summarizeBuildResult({ status: 0, stdout: buildOutput, stderr: "" });
  assert.equal(buildPass.status, "pass");
  assert.equal(buildPass.compiled, true);
  assert.equal(buildPass.proxy, true);
  assert.equal(buildPass.warnings, 1);
  assert.deepEqual(buildPass.warningKinds, ["sqlite-experimental"]);
  assert.deepEqual(buildPass.warningKindCounts, { "sqlite-experimental": 1 });
  assert.equal(buildPass.classifiedWarnings, 1);
  assert.equal(buildPass.unclassifiedWarnings, 0);
  assert.equal(buildPass.notices, 1);
  assert.deepEqual(buildPass.noticeKinds, ["edge-runtime-static-generation-disabled"]);
  const unclassifiedBuild = summarizeBuildResult({ status: 0, stdout: `${buildOutput}\nWarning: surprising`, stderr: "" });
  assert.equal(unclassifiedBuild.status, "fail");
  assert.equal(unclassifiedBuild.unclassifiedWarnings, 1);
  assert.equal(unclassifiedBuild.issue, "build-unclassified-warnings");
  assert.equal(summarizeBuildResult({ status: null, error: { code: "ENOBUFS" } }).issue, "build-output-too-large");
  assert.equal(summarizeBuildResult({ status: null, error: { code: "EACCES" } }).issue, "build-spawn-failed");
  assert.equal(summarizeBuildResult({ status: null, error: { code: "ETIMEDOUT" } }).timedOut, true);
  assert.equal(summarizeBuildResult({ status: 0, stdout: `${buildOutput}\n${"Warning ".repeat(10_100)}` }).warnings, 9_999);

  const eslintPayload = [
    { filePath: "C:\\private\\first.ts", messages: [] },
    { filePath: "C:\\private\\second.ts", messages: [
      { severity: 1, ruleId: "no-console" }, { severity: 1, ruleId: "no-console" },
      { severity: 1, ruleId: "../../unsafe" },
    ] },
  ];
  const eslintPass = summarizeEslintResult({ status: 0, stdout: JSON.stringify(eslintPayload), stderr: "" });
  assert.equal(eslintPass.status, "pass");
  assert.equal(eslintPass.filesChecked, 2);
  assert.equal(eslintPass.filesWithIssues, 1);
  assert.equal(eslintPass.errors, 0);
  assert.equal(eslintPass.warnings, 3);
  assert.deepEqual(eslintPass.ruleIds, ["no-console:2", "unknown:1"]);
  const eslintFailure = summarizeEslintResult({ status: 1, stdout: JSON.stringify([
    { messages: [{ severity: 2, ruleId: "@typescript-eslint/no-explicit-any" }] },
  ]) });
  assert.equal(eslintFailure.status, "fail");
  assert.equal(eslintFailure.errors, 1);
  assert.deepEqual(eslintFailure.ruleIds, ["@typescript-eslint/no-explicit-any:1"]);
  assert.equal(summarizeEslintResult({ status: null, stdout: "", error: { code: "ENOBUFS" } }).issue, "eslint-output-too-large");
  assert.equal(summarizeEslintResult({
    status: null, stdout: "", error: { code: "EACCES", message: "EACCES C:\\Users\\private\\secret.ts https://secret.example/path" },
  }).issue, "eslint-spawn-failed");
  const eslintMalformed = summarizeEslintResult({ status: 1, stdout: "{not-json}" });
  assert.equal(eslintMalformed.status, "fail");
  assert.doesNotMatch(eslintMalformed.issue, /C:\\|private|secret/i);

  for (const spec of [
    {
      envName: "TYPECHECK_SUMMARY_TIMEOUT_MS", timeout: "280000", cwd: "C:\\isolated-type-summary",
      platform: "win32", npmExecpath: "C:\\safe\\npm-cli.js", execPath: "C:\\safe\\node.exe",
      commandTail: ["--silent", "run", "typecheck"], maxBuffer: 2 * 1024 * 1024,
      run: runTypecheckSummary, stdout: "Types generated successfully", projectedField: "tsc",
    },
    {
      envName: "BUILD_SUMMARY_TIMEOUT_MS", timeout: "700000", cwd: "C:\\isolated-build-summary",
      platform: "win32", commandTail: ["--silent", "run", "build"], maxBuffer: 4 * 1024 * 1024,
      run: runBuildSummary, stdout: buildOutput, projectedField: "compiled",
    },
    {
      envName: "ESLINT_SUMMARY_TIMEOUT_MS", timeout: "270000", cwd: "C:\\isolated-eslint-summary",
      platform: "linux", commandTail: ["exec", "--", "eslint", ".", "--format", "json"], maxBuffer: 2 * 1024 * 1024,
      run: runEslintSummary, stdout: "[]", projectedField: "status",
    },
  ]) {
    let call = null;
    const lines = [];
    withTemporaryNamedEnv(spec.envName, spec.timeout, () => {
      const env = { SAFE_ENV: "present", ...(spec.npmExecpath ? { npm_execpath: spec.npmExecpath } : {}) };
      const outcome = spec.run({
        cwd: spec.cwd, env, execPath: spec.execPath ?? "C:\\safe\\node.exe", platform: spec.platform,
        spawn: (command, args, options) => {
          call = { command, args, options };
          return { status: 0, stdout: spec.stdout, stderr: "" };
        },
        writeLine: (line) => lines.push(line),
      });
      assert.equal(outcome.exitCode, 0);
      assert.equal(outcome.summary.status, "pass");
    });
    assert.equal(call?.command, spec.npmExecpath ? spec.execPath : spec.platform === "win32" ? "npm.cmd" : "npm");
    assert.deepEqual(call?.args, spec.npmExecpath ? [spec.npmExecpath, ...spec.commandTail] : spec.commandTail);
    assert.equal(call?.options.cwd, spec.cwd);
    assert.equal(call?.options.encoding, "utf8");
    assert.equal(call?.options.maxBuffer, spec.maxBuffer);
    assert.equal(call?.options.timeout, Number(spec.timeout));
    assert.equal(call?.options.env.NO_UPDATE_NOTIFIER, "1");
    assert.equal(call?.options.env.npm_config_update_notifier, "false");
    assert.equal(call?.options.env.npm_config_fund, "false");
    assert.equal(lines.length, 1);
    const emitted = JSON.parse(lines[0]);
    assert.equal(spec.projectedField === "status" ? emitted.status === "pass" : emitted[spec.projectedField], true);
  }

  const v10CompilePayload = {
    status: "pass", manifestMatches: true, compilerVersion: "0.8.36+commit.8a079791.Emscripten.clang",
  };
  const v10OfflinePayload = {
    status: "ready", compilerVersion: "0.8.36+commit.8a079791.Emscripten.clang",
    compiler: { evmVersion: "osaka" }, runtimeBytes: 16_488, executableRuntimeBytes: 16_400,
    immutableReferences: 3, transactionSent: false,
  };
  const offlineResults = {
    compile: { status: 0, stdout: `compile log {ignored}\n${JSON.stringify(v10CompilePayload)}`, stderr: "" },
    verifier: { status: 0, stdout: `verifier log\n${JSON.stringify(v10OfflinePayload)}`, stderr: "" },
  };
  const offlineSummary = summarizeV10OfflineIdentityResults(offlineResults);
  assert.equal(offlineSummary.status, "pass");
  assert.equal(offlineSummary.v10OfflineIdentity, true);
  assert.equal(offlineSummary.manifestMatches, true);
  assert.equal(offlineSummary.compilerVersion, "0.8.36+commit.8a079791.Emscripten.clang");
  assert.equal(offlineSummary.compilerProfile, "osaka-optimizer-200");
  assert.equal(offlineSummary.runtimeBytes, 16_488);
  assert.equal(offlineSummary.executableRuntimeBytes, 16_400);
  assert.equal(offlineSummary.immutableReferences, 3);
  assert.equal(offlineSummary.transactionSent, false);
  assert.equal(summarizeV10OfflineIdentityResults({
    ...offlineResults, verifier: { ...offlineResults.verifier, stdout: JSON.stringify({ ...v10OfflinePayload, transactionSent: true }) },
  }).status, "fail");
  assert.equal(summarizeV10OfflineIdentityResults({
    ...offlineResults, compile: { ...offlineResults.compile, stdout: JSON.stringify({ ...v10CompilePayload, manifestMatches: false }) },
  }).status, "fail");
  const malformedOffline = summarizeV10OfflineIdentityResults({
    compile: { status: 0, stdout: JSON.stringify({ ...v10CompilePayload, compilerVersion: "C:\\Users\\private\\solc.exe" }) },
    verifier: { status: 0, stdout: JSON.stringify({ ...v10OfflinePayload, compilerVersion: "https://secret.example/solc", runtimeBytes: -1, executableRuntimeBytes: 1.5, immutableReferences: Number.MAX_SAFE_INTEGER + 1 }) },
  });
  assert.equal(malformedOffline.compilerVersion, "unknown");
  assert.equal(malformedOffline.runtimeBytes, 0);
  assert.equal(malformedOffline.executableRuntimeBytes, 0);
  assert.equal(malformedOffline.immutableReferences, 0);
  assert.equal(summarizeV10OfflineIdentityResults({ compile: { status: null, error: { code: "ENOBUFS" } }, verifier: null }).issue, "v10-offline-identity-output-too-large");
  assert.equal(summarizeV10OfflineIdentityResults({ compile: { status: null, error: { code: "EACCES" } }, verifier: null }).issue, "v10-offline-identity-spawn-failed");
  assert.equal(summarizeV10OfflineIdentityResults({ compile: { status: null, error: { code: "ETIMEDOUT" } }, verifier: null }).timedOut, true);
  assert.equal(summarizeV10OfflineIdentityResults({
    compile: { status: 0, stdout: `${JSON.stringify(v10CompilePayload)}${"AssertionError ".repeat(10_100)}` },
    verifier: offlineResults.verifier,
  }).assertionFailures, 9_999);

  const v10DeployedPayload = {
    status: "pass", network: "Linea Sepolia", chainId: 59_144,
    runtimeBytes: 16_488, expectedRuntimeBytes: 16_488, expectedExecutableRuntimeBytes: 16_400,
    immutableReferences: 3,
    checks: { runtimeBytecode: false, runtimeExecutable: true, token: true, ownerNonZero: true, feeRecipientNonZero: true },
    diagnostics: { metadataOnlyMismatch: true }, transactionSent: false,
  };
  const deployedResults = {
    compile: { status: 0, stdout: JSON.stringify(v10CompilePayload), stderr: "" },
    verifier: { status: 0, stdout: `diagnostic {not json}\n${JSON.stringify(v10DeployedPayload)}`, stderr: "" },
  };
  const deployedSummary = summarizeV10DeployedResults(deployedResults);
  assert.equal(deployedSummary.status, "pass");
  assert.equal(deployedSummary.v10DeployedReadOnly, true);
  assert.equal(deployedSummary.network, "Linea Sepolia");
  assert.equal(deployedSummary.chainId, 59_144);
  assert.equal(deployedSummary.manifestMatches, true);
  assert.equal(deployedSummary.runtimeBytecode, false);
  assert.equal(deployedSummary.runtimeExecutable, true);
  assert.equal(deployedSummary.metadataOnlyMismatch, true);
  assert.equal(deployedSummary.token, true);
  assert.equal(deployedSummary.ownerNonZero, true);
  assert.equal(deployedSummary.feeRecipientNonZero, true);
  assert.equal(deployedSummary.transactionSent, false);
  assert.equal(summarizeV10DeployedResults({
    ...deployedResults, verifier: { ...deployedResults.verifier, stdout: JSON.stringify({ ...v10DeployedPayload, transactionSent: true }) },
  }).status, "fail");
  assert.equal(summarizeV10DeployedResults({
    ...deployedResults, compile: { ...deployedResults.compile, stdout: JSON.stringify({ ...v10CompilePayload, manifestMatches: false }) },
  }).status, "fail");
  const malformedDeployed = summarizeV10DeployedResults({
    compile: deployedResults.compile,
    verifier: { status: 0, stdout: JSON.stringify({ ...v10DeployedPayload, network: "https://secret.example", chainId: -1, runtimeBytes: 1.5, immutableReferences: Number.MAX_SAFE_INTEGER + 1 }) },
  });
  assert.equal(malformedDeployed.network, "unknown");
  assert.equal(malformedDeployed.chainId, 0);
  assert.equal(malformedDeployed.runtimeBytes, 0);
  assert.equal(malformedDeployed.immutableReferences, 0);
  assert.equal(summarizeV10DeployedResults({ compile: { status: null, error: { code: "ENOBUFS" } }, verifier: null }).issue, "v10-deployed-summary-output-too-large");
  assert.equal(summarizeV10DeployedResults({ compile: { status: null, error: { code: "EACCES" } }, verifier: null }).issue, "v10-deployed-summary-spawn-failed");
  assert.equal(summarizeV10DeployedResults({ compile: { status: null, error: { code: "ETIMEDOUT" } }, verifier: null }).timedOut, true);

  for (const spec of [
    {
      envName: "V10_OFFLINE_IDENTITY_SUMMARY_TIMEOUT_MS", timeout: "210000", cwd: "C:\\isolated-v10-offline",
      platform: "win32", npmExecpath: "C:\\safe\\npm-cli.js", execPath: "C:\\safe\\node.exe",
      run: runV10OfflineIdentitySummary, compilePayload: v10CompilePayload, verifierPayload: v10OfflinePayload,
      verifierTail: ["exec", "--", "tsx", "scripts/verify-v10-deployed.ts", "--offline"], projectedField: "v10OfflineIdentity",
    },
    {
      envName: "V10_DEPLOYED_SUMMARY_TIMEOUT_MS", timeout: "215000", cwd: "C:\\isolated-v10-deployed",
      platform: "linux", run: runV10DeployedSummary, compilePayload: v10CompilePayload, verifierPayload: v10DeployedPayload,
      verifierTail: ["exec", "--", "tsx", "scripts/verify-v10-deployed.ts"], projectedField: "v10DeployedReadOnly",
    },
  ]) {
    const calls = [];
    const lines = [];
    withTemporaryNamedEnv(spec.envName, spec.timeout, () => {
      const env = { SAFE_ENV: "present", ...(spec.npmExecpath ? { npm_execpath: spec.npmExecpath } : {}) };
      const outcome = spec.run({
        cwd: spec.cwd, env, execPath: spec.execPath ?? "C:\\safe\\node.exe", platform: spec.platform,
        spawn: (command, args, options) => {
          calls.push({ command, args, options });
          return calls.length === 1
            ? { status: 0, stdout: JSON.stringify(spec.compilePayload), stderr: "" }
            : { status: 0, stdout: JSON.stringify(spec.verifierPayload), stderr: "" };
        },
        writeLine: (line) => lines.push(line),
      });
      assert.equal(outcome.exitCode, 0);
      assert.equal(outcome.summary.status, "pass");
    });
    assert.equal(calls.length, 2);
    const command = spec.npmExecpath ? spec.execPath : spec.platform === "win32" ? "npm.cmd" : "npm";
    const prefix = spec.npmExecpath ? [spec.npmExecpath, "--silent"] : ["--silent"];
    assert.equal(calls[0].command, command);
    assert.deepEqual(calls[0].args, [...prefix, "run", "proof:contract-compile:v10:summary"]);
    assert.equal(calls[1].command, command);
    assert.deepEqual(calls[1].args, [...prefix, ...spec.verifierTail]);
    for (const call of calls) {
      assert.equal(call.options.cwd, spec.cwd);
      assert.equal(call.options.encoding, "utf8");
      assert.equal(call.options.maxBuffer, 1024 * 1024);
      assert.equal(call.options.timeout, Number(spec.timeout));
      assert.equal(call.options.env.NO_UPDATE_NOTIFIER, "1");
      assert.equal(call.options.env.npm_config_update_notifier, "false");
      assert.equal(call.options.env.npm_config_fund, "false");
    }
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0])[spec.projectedField], true);
  }

  for (const [script, envName, issue] of [
    ["run-indexer-storage-summary.mjs", "INDEXER_STORAGE_SUMMARY_TIMEOUT_MS", "indexer-storage-summary-config-invalid"],
    ["run-db-operations-summary.mjs", "DB_OPERATIONS_SUMMARY_TIMEOUT_MS", "db-operations-summary-config-invalid"],
    ["run-monitoring-drill-summary.mjs", "MONITORING_DRILL_SUMMARY_TIMEOUT_MS", "monitoring-drill-summary-config-invalid"],
    ["run-fetch-timeout-summary.mjs", "FETCH_TIMEOUT_SUMMARY_TIMEOUT_MS", "fetch-timeout-summary-config-invalid"],
    ["run-stored-number-parsing-summary.mjs", "STORED_NUMBER_PARSING_SUMMARY_TIMEOUT_MS", "stored-number-parsing-summary-config-invalid"],
    ["run-typecheck-summary.mjs", "TYPECHECK_SUMMARY_TIMEOUT_MS", "typecheck-summary-config-invalid"],
    ["run-build-summary.mjs", "BUILD_SUMMARY_TIMEOUT_MS", "build-summary-config-invalid"],
    ["run-eslint-summary.mjs", "ESLINT_SUMMARY_TIMEOUT_MS", "eslint-summary-config-invalid"],
    ["run-v10-offline-identity-summary.mjs", "V10_OFFLINE_IDENTITY_SUMMARY_TIMEOUT_MS", "v10-offline-identity-summary-config-invalid"],
    ["run-v10-deployed-summary.mjs", "V10_DEPLOYED_SUMMARY_TIMEOUT_MS", "v10-deployed-summary-config-invalid"],
  ]) {
    const invalidEnv = { ...process.env, [envName]: "01" };
    const imported = spawnSync(process.execPath, ["--input-type=module", "--eval", `await import("./scripts/${script}");`], {
      cwd: process.cwd(), encoding: "utf8", timeout: 10_000, env: invalidEnv,
    });
    assert.equal(imported.status, 0);
    assert.equal(imported.stdout, "");
    assert.equal(imported.stderr, "");
    const direct = spawnSync(process.execPath, [`scripts/${script}`], {
      cwd: process.cwd(), encoding: "utf8", timeout: 10_000, env: invalidEnv,
    });
    assert.equal(direct.status, 1);
    assert.equal(direct.stderr, "");
    assert.deepEqual(JSON.parse(direct.stdout), {
      status: "fail",
      issue,
      error: `${envName} must be a canonical decimal integer`,
    });
  }
}

function withTemporaryContractTimeout(value, callback) {
  const name = "CONTRACT_V10_SUMMARY_TIMEOUT_MS";
  const previous = process.env[name];
  process.env[name] = value;
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

function withTemporaryBusinessTimeout(value, callback) {
  const name = "BUSINESS_LOGIC_SUMMARY_TIMEOUT_MS";
  const previous = process.env[name];
  process.env[name] = value;
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

function withTemporaryNamedEnv(name, value, callback) {
  const previous = process.env[name];
  process.env[name] = value;
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}
