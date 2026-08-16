import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runWalletModelTests } from "./test-business-wallet-models.mjs";
import { runReadModelTests } from "./test-business-read-models.mjs";
import { runRuntimeRecoveryTests } from "./test-business-runtime-recovery.mjs";
import { runCacheAndPlannerTests } from "./test-business-cache-planners.mjs";
import { runWalletRuntimeTests } from "./test-business-wallet-runtime.mjs";
import { runRewardScannerTests } from "./test-business-reward-scanner.mjs";
import { runLiveStateApiTests } from "./test-business-live-state-api.mjs";
import { runIndexerNormalizationTests } from "./test-business-indexer-normalization.mjs";
import { runChainIndexerAuditPolicyTests } from "./test-business-chain-indexer-audit-policy.mjs";
import { runHostProofPolicyTests } from "./test-business-host-proof-policy.mjs";
import { runHostEvidencePolicyTests } from "./test-business-host-evidence-policy.mjs";
import { runHistoryPresentationTests } from "./test-business-history-presentation.mjs";
import { runGameDataPresentationTests } from "./test-business-game-data-presentation.mjs";
import { runRuntimePollingTests } from "./test-business-runtime-polling.mjs";
import { runChatPollingTests } from "./test-business-chat-polling.mjs";
import { runChatContentTests } from "./test-business-chat-content.mjs";
import { runPublicApiReadModelTests } from "./test-business-public-api-read-models.mjs";
import { runCleanupWorkspaceBehaviorTests } from "./test-business-cleanup-workspace.mjs";
import { runCleanupLoopManagerBehaviorTests } from "./test-business-cleanup-loop-manager.mjs";
import { runWalletPresentationTests } from "./test-business-wallet-presentation.mjs";
import { runWalletExternalBoundaryTests } from "./test-business-wallet-external-boundaries.mjs";
import { runErrorShellBoundaryTests } from "./test-business-error-shell-boundaries.mjs";
import { runDialogAccessibilityTests } from "./test-business-dialog-accessibility.mjs";
import { runWalletFundingPresentationTests } from "./test-business-wallet-funding-presentation.mjs";
import { runJackpotBannerPresentationTests } from "./test-business-jackpot-banner-presentation.mjs";
import { runWinsPresentationTests } from "./test-business-wins-presentation.mjs";
import { runRuntimeHealthDiagnosticsTests } from "./test-business-runtime-health-diagnostics.mjs";
import { runRuntimeMonitorBoundaryTests } from "./test-business-runtime-monitor-boundaries.mjs";
import { runHttpSmokeBoundaryTests } from "./test-business-http-smoke-boundaries.mjs";
import { runWalletActionBoundaryTests } from "./test-business-wallet-action-boundaries.mjs";
import { runPublicMetadataTests } from "./test-business-public-metadata.mjs";
import { runSidebarLegalNavigationTests } from "./test-business-sidebar-legal-navigation.mjs";
import { runTutorialAndPublicCopyTests } from "./test-business-tutorial-public-copy.mjs";
import { runWalletShellAndMiningActionTests } from "./test-business-wallet-shell-actions.mjs";
import { runApiRecoveryStorageTests } from "./test-business-api-recovery-storage.mjs";
import { runApiIntegerQueryTests } from "./test-business-api-integer-queries.mjs";
import { runApiRequestBoundaryTests } from "./test-business-api-request-boundaries.mjs";
import * as apiRouteMatrixTestModule from "./test-api-route-matrix.ts";
import { runContractV9SummaryBehaviorTests } from "./test-business-contract-v9-summary.mjs";
import { runProductionRuntimeEnvTests } from "./test-business-production-runtime-env.mjs";
import { runProductionRuntimeConfigTests } from "./test-business-production-runtime-config.mjs";
import { runProductionRuntimeStrictTests } from "./test-business-production-runtime-strict.mjs";
import { runProductionRuntimeNetworkMatrixTests } from "./test-business-production-runtime-network-matrix.mjs";
import { runJackpotAndRebateSecurityTests } from "./test-business-jackpot-rebate-security.mjs";
import { runChatAndClientSafetyTests } from "./test-business-chat-client-safety.mjs";
import { runReleaseOperationsTests } from "./test-business-release-operations.mjs";
import { runLiveCanaryHealthBehaviorTests } from "./test-business-live-canary-health.mjs";
import { runPlaytestWalletPolicyTests } from "./test-business-playtest-wallet-policy.mjs";
import { runRuntimeMetricsTests } from "./test-business-runtime-metrics.mjs";
import { runErrorBoundaryAndJsonTests } from "./test-business-error-boundaries.mjs";
import { runWalletAndRouteSafetyTests } from "./test-business-wallet-route-safety.mjs";
import { runExplorerLinkTests } from "./test-business-explorer-links.mjs";
import { runUtilitySafetyTests } from "./test-business-utils-safety.mjs";
import { runSentrySanitizationTests } from "./test-business-sentry-sanitization.mjs";
import { runAuthAndCanaryBoundaryTests } from "./test-business-auth-canary-boundaries.mjs";
import { runMiningRuntimeSafetyTests } from "./test-business-mining-runtime-safety.mjs";
import { runClientIdentityAndRateLimitTests } from "./test-business-client-identity-rate-limit.mjs";
import { runUiMotionAndReadOnlyTests } from "./test-business-ui-motion-readonly.mjs";
import { runHubReadOnlyControlTests } from "./test-business-hub-readonly-controls.mjs";
import { runBrowserToolingBehaviorTests } from "./test-business-browser-tooling-behavior.mjs";
import { runSecurityFollowupBehaviorTests } from "./test-business-security-followup.mjs";
import { runPublicPresentationTests } from "./test-business-public-presentation.mjs";
import { runSummaryTimeoutTests } from "./test-business-summary-timeout.mjs";
import { runAutonomousStatusBehaviorTests } from "./test-business-autonomous-status.mjs";
import { runAutonomousDailyStatusTests } from "./test-business-autonomous-daily-status.mjs";
import { runDataSyncHealthPolicyTests } from "./test-business-data-sync-health-policy.mjs";
import { runAdminOpsPolicyTests } from "./test-business-admin-ops-policy.mjs";
import { runAdminOpsPresentationTests } from "./test-business-admin-ops-presentation.mjs";
import * as fetchTimeoutTestModule from "./test-fetch-with-timeout.ts";
import { runCheckLocalPolicyTests } from "./test-business-check-local-policy.mjs";
import { runCompilerAdvisoryBehaviorTests } from "./test-business-compiler-advisory.mjs";
import { runDependencyAuditBehaviorTests, runWalletDependencyAuditBehaviorTests } from "./test-business-dependency-audit.mjs";
import { runPrelaunchStatusBehaviorTests } from "./test-business-prelaunch-status.mjs";
import { runProofDraftBehaviorTests } from "./test-business-proof-drafts.mjs";
import { runIndexerStorageBehaviorTests } from "./test-business-indexer-storage-behavior.mjs";
import { runProofFileBehaviorTests } from "./test-business-proof-files.mjs";
import { runLaunchProofRunnerBehaviorTests, runLocalProofPreflightBehaviorTests } from "./test-business-local-proof-preflight.mjs";
import { runLaunchCommandMapBehaviorTests } from "./test-business-launch-command-map.mjs";
import { runReadinessChecklistBehaviorTests } from "./test-business-readiness-checklist.mjs";
import { runProofCollectorRedactionBehaviorTests } from "./test-business-proof-collector-redaction.mjs";
import { runProofTemplateBehaviorTests } from "./test-business-proof-templates.mjs";
import { runProcessModelBehaviorTests } from "./test-business-process-model.mjs";
import { runBackupSummaryBehaviorTests } from "./test-business-backup-summary.mjs";
import { runMainnetProofPolicyTests } from "./test-business-mainnet-proof-policy.mjs";
import { runMainnetProofOutputTests } from "./test-business-mainnet-proof-output.mjs";
import { runChainProofPolicyTests } from "./test-business-chain-proof-policy.mjs";
import { runLaunchDocsBehaviorTests } from "./test-business-launch-docs.mjs";
import { runLaunchRemainingBehaviorTests } from "./test-business-launch-remaining.mjs";
import { runGasShadowBehaviorTests } from "./test-business-gas-shadow.mjs";
import { runRuntimeSmokeRedactionBehaviorTests } from "./test-business-runtime-smoke-redaction.mjs";
import { runCiSecurityBehaviorTests } from "./test-business-ci-security.mjs";
import { runNoticeStackBehaviorTests } from "./test-business-notice-stack.mjs";
import { runV10DeployedInputPolicyTests } from "./test-business-v10-deployed-input-policy.mjs";
import { runContractV10SummaryBehaviorTests } from "./test-business-contract-v10-summary.mjs";
import { runReleaseDocumentationTests } from "./test-business-release-documentation.mjs";

function listSourceFiles(root, sourceFilePattern = /\.(?:ts|tsx|mjs)$/) {
  const entries = readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const filesystemPath = join(root, entry.name);
    if (entry.isDirectory()) return listSourceFiles(filesystemPath, sourceFilePattern);
    return sourceFilePattern.test(entry.name) ? [filesystemPath.replaceAll("\\", "/")] : [];
  });
}

async function withExpectedWarningSuppression(fn) {
  const originalWarn = console.warn;
  let suppressed = 0;
  console.warn = (...args) => {
    const first = typeof args[0] === "string" ? args[0] : "";
    if (first === "[AutoMine]" || first === "[ManualMine]" || first === "[DirectMine]") {
      suppressed += 1;
      return;
    }
    originalWarn(...args);
  };
  try {
    await fn();
  } finally {
    console.warn = originalWarn;
  }
  return suppressed;
}

async function main() {
  await runAuthAndCanaryBoundaryTests();

  const fetchTimeoutTests = fetchTimeoutTestModule.default ?? fetchTimeoutTestModule;
  const apiRouteMatrixTests = apiRouteMatrixTestModule.default ?? apiRouteMatrixTestModule;
  runRuntimeMetricsTests();
  runSentrySanitizationTests();
  await runErrorBoundaryAndJsonTests();
  await runWalletAndRouteSafetyTests();
  await runApiIntegerQueryTests();
  await runApiRequestBoundaryTests();
  await apiRouteMatrixTests.runBoundedJsonRouteMatrixTests();
  const depositsRecoveryProof = apiRouteMatrixTests.runDepositsRecoveryGlobalBoundTests();
  runContractV9SummaryBehaviorTests();
  runProductionRuntimeEnvTests();
  runProductionRuntimeConfigTests();
  runProductionRuntimeStrictTests();
  runProductionRuntimeNetworkMatrixTests();
  runReleaseDocumentationTests();
  runMainnetProofPolicyTests();
  runMainnetProofOutputTests();
  runChainProofPolicyTests();
  runLaunchCommandMapBehaviorTests();
  runReadinessChecklistBehaviorTests();
  runProofCollectorRedactionBehaviorTests();
  runProofTemplateBehaviorTests();
  runProcessModelBehaviorTests();
  runBackupSummaryBehaviorTests();
  runLaunchDocsBehaviorTests();
  runLaunchRemainingBehaviorTests();
  await runCompilerAdvisoryBehaviorTests();
  runContractV10SummaryBehaviorTests();
  runV10DeployedInputPolicyTests();
  runSummaryTimeoutTests();
  runIndexerStorageBehaviorTests();
  const restoreProofValidationSource = readFileSync("scripts/verify-db-restore.mjs", "utf8");
  assert.ok(
    restoreProofValidationSource.includes('import { hasKnownLaunchSqliteRows, readCanonicalSqliteCount } from "./sqlite-scope-audit-lib.mjs";') &&
      restoreProofValidationSource.includes("counts[table] = readCanonicalSqliteCount(db, table);") &&
      [...restoreProofValidationSource.matchAll(/!hasKnownLaunchSqliteRows\(/g)].length === 2 &&
      !/Number\(row\?\.count \?\? 0\)|function knownLaunchRowTotal/.test(restoreProofValidationSource),
    "restore proof must bind canonical SQLite counts and known-row admission to the shared executable policy",
  );
  await runDependencyAuditBehaviorTests();
  runWalletDependencyAuditBehaviorTests();
  await runGasShadowBehaviorTests();
  const gasShadowBootstrapResolveRouteSource = readFileSync("app/api/bootstrap-resolve/route.ts", "utf8");
  const gasShadowLiveRoundCanarySource = readFileSync("scripts/live-round-canary.ts", "utf8");
  assert.match(
    gasShadowBootstrapResolveRouteSource,
    /const gasEstimate = await publicClient\.estimateContractGas\(\{[\s\S]*functionName: "resolveEpoch"[\s\S]*await recordLineaEstimateGasShadow\(\{[\s\S]*tag: "bootstrap-resolve"[\s\S]*const estimatedFeeOverrides = getKeeperFeeOverrides\([\s\S]*const gas = \([\s\S]*gasEstimate \* RESOLVE_GAS_BUFFER_PERCENT[\s\S]*assertKeeperFeeBudget\([\s\S]*"keeper"/,
    "bootstrap keeper resolve shadow must run after baseline estimation and before fixed fee-budget validation without replacing gasEstimate",
  );
  assert.match(
    gasShadowLiveRoundCanarySource,
    /const gasEstimate = await publicClient\.estimateContractGas\(\{[\s\S]*functionName: "resolveEpoch"[\s\S]*await recordLineaEstimateGasShadow\(\{[\s\S]*tag: "live-canary-resolve"[\s\S]*let gas = gasEstimate > RESOLVE_GAS_FLOOR \? gasEstimate : RESOLVE_GAS_FLOOR/,
    "live canary resolver shadow must not replace the resolver gas floor or execution gas limit",
  );
  assert.match(
    gasShadowLiveRoundCanarySource,
    /const estimate = await estimateGasWithMethodRetry\(\(\) => publicClient\.estimateContractGas\(\{[\s\S]*gas = estimate\.value;[\s\S]*await recordLineaEstimateGasShadow\(\{[\s\S]*baselineGas: gas,[\s\S]*tag: `live-canary-bet-\$\{mode\}`,[\s\S]*const gasEstimatedAt = Date\.now\(\)/,
    "live canary bet shadow must run after baseline bet estimation and before fee clamping without replacing gas",
  );
  await runCleanupLoopManagerBehaviorTests();
  const prodHealthMalformedDiagnosticsSecret = spawnSync(
    process.execPath,
    ["scripts/check-production-health.mjs", "--summary-only"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PROD_HEALTH_BASE_URL: "https://playlore.xyz",
        SMOKE_BASE_URL: "",
        NEXT_PUBLIC_SITE_URL: "",
        HEALTH_DIAGNOSTICS_SECRET: "short",
        PROD_HEALTH_MAX_LAG_BLOCKS: "",
        PROD_HEALTH_MAX_INDEXER_STALE_MS: "",
        NEXT_PUBLIC_LINEA_CHAIN_ID: "",
        LINEA_CHAIN_ID: "",
      },
      encoding: "utf8",
    },
  );
  assert.equal(
    prodHealthMalformedDiagnosticsSecret.status,
    1,
    prodHealthMalformedDiagnosticsSecret.stderr || prodHealthMalformedDiagnosticsSecret.stdout,
  );
  const prodHealthMalformedDiagnosticsSecretSummary = JSON.parse(prodHealthMalformedDiagnosticsSecret.stdout);
  assert.equal(prodHealthMalformedDiagnosticsSecretSummary.status, "fail");
  assert.match(
    prodHealthMalformedDiagnosticsSecretSummary.firstIssue,
    /HEALTH_DIAGNOSTICS_SECRET must be 32\.\.256 non-control characters/,
    "production health checker must report malformed diagnostics secret before endpoint polling",
  );
  assert.doesNotMatch(
    prodHealthMalformedDiagnosticsSecret.stdout,
    /short|https?:\/\/|playlore\.xyz/i,
    "production health checker must not print malformed diagnostics secret text or endpoint details in summary failures",
  );
  const prodHealthSelfTest = spawnSync(process.execPath, ["scripts/check-production-health.mjs", "--self-test", "--summary-only"], {
    cwd: process.cwd(),
    env: { ...process.env, PROD_HEALTH_BASE_URL: "", SMOKE_BASE_URL: "", NEXT_PUBLIC_SITE_URL: "", HEALTH_DIAGNOSTICS_SECRET: "" },
    encoding: "utf8",
  });
  assert.equal(prodHealthSelfTest.status, 0, prodHealthSelfTest.stderr || prodHealthSelfTest.stdout);
  assert.deepEqual(
    JSON.parse(prodHealthSelfTest.stdout),
    { status: "pass", payloadIntegerParser: true },
    "production health checker self-test must prove malformed payload counters fail closed without endpoint polling",
  );
  runHostProofPolicyTests();
  const behaviorallyCoveredBodyRoutes = new Set([
    "app/api/admin/auth/route.ts",
    "app/api/admin/ops/route.ts",
    "app/api/admin/processes/route.ts",
    "app/api/chat/auth/route.ts",
    "app/api/chat/messages/route.ts",
    "app/api/chat/profile/route.ts",
    "app/api/rewards/route.ts",
  ]);
  const jsonBodyFetchIssues = [];
  for (const sourcePath of listSourceFiles("app", /\.(?:ts|tsx)$/)) {
    const source = readFileSync(sourcePath, "utf8");
    for (const fetchMatch of source.matchAll(/\b(?:fetch|fetchWithTimeout)\s*\(/g)) {
      const snippet = source.slice(fetchMatch.index, fetchMatch.index + 1200);
      const methodMatch = snippet.match(/\bmethod:\s*["'](?:POST|PUT|PATCH)["']/);
      const bodyMatch = snippet.match(/\bbody:\s*JSON\.stringify\s*\(/);
      if (!methodMatch || !bodyMatch || methodMatch.index > bodyMatch.index) continue;
      const methodToBody = snippet.slice(methodMatch.index, bodyMatch.index);
      if (/\}\s*\)\s*;/.test(methodToBody)) continue;
      const beforeBody = snippet.slice(0, bodyMatch.index);
      if (!/headers:\s*\{[\s\S]{0,400}["']Content-Type["']\s*:\s*["']application\/json["']/.test(beforeBody)) {
        jsonBodyFetchIssues.push(sourcePath);
      }
    }
  }
  assert.deepEqual(
    [...new Set(jsonBodyFetchIssues)],
    [],
    "app JSON body fetches must send an explicit application/json Content-Type",
  );
  for (const routePath of listSourceFiles("app/api", /^route\.(?:ts|tsx)$/)
    .filter((routePath) => !behaviorallyCoveredBodyRoutes.has(routePath))) {
    const routeSource = readFileSync(routePath, "utf8");
    assert.doesNotMatch(
      routeSource,
      /\brequest\.(?:json|text|arrayBuffer|formData)\s*\(/,
      `${routePath} must not read request bodies directly; use a bounded parser or explicit no-body rejection`,
    );
    assert.doesNotMatch(
      routeSource,
      /\breturn\s+(?:rateLimited|[A-Za-z_$][\w$]*RateLimited)\s*;/,
      `${routePath} rate-limit responses must pass through the route no-store helper`,
    );
    if (!/(?:NextResponse|Response)\.json\(/.test(routeSource)) continue;
    assert.match(
      routeSource,
      /applyNoStoreHeaders|Cache-Control[\s\S]*no-store|no-store[\s\S]*Cache-Control/,
      `${routePath} JSON responses must set no-store cache headers`,
    );
    if (/\b(?:read|issue|clear)(?:Admin|Chat)Session\b/.test(routeSource)) {
      assert.match(routeSource, /varyCookie:\s*true/, `${routePath} session responses must vary on Cookie`);
    }
  }
  const chainIndexerAuditSource = readFileSync("scripts/audit-chain-indexer-window.mjs", "utf8");
  assert.deepEqual(
    {
      endEpochParser: [...chainIndexerAuditSource.matchAll(/parseChainAuditBoundedInteger\("--end-epoch"/g)].length,
      blockPlanner: [...chainIndexerAuditSource.matchAll(/planChainAuditBlockChunks\(fromBlock, toBlock\)/g)].length,
      eventIdentity: [...chainIndexerAuditSource.matchAll(/buildChainAuditEventId\(log\)/g)].length,
      betIdentity: [...chainIndexerAuditSource.matchAll(/buildChainAuditBetEventKey\(epoch, log\)/g)].length,
      dbFileBoundary: [...chainIndexerAuditSource.matchAll(/assertChainAuditDbFile\(dbPath\)/g)].length,
      epochWindow: [...chainIndexerAuditSource.matchAll(/selectChainAuditResolvedEpochRows\(\{/g)].length,
      accountingSnapshot: [...chainIndexerAuditSource.matchAll(/readChainAuditAccountingSnapshot\(\{/g)].length,
      metadataIds: [...chainIndexerAuditSource.matchAll(/readChainAuditStoredEventIds\(\{/g)].length,
      dustPolicy: [...chainIndexerAuditSource.matchAll(/isChainAuditDustSettlementEvent\(decoded\.eventName\)/g)].length,
      staleMetadata: [...chainIndexerAuditSource.matchAll(/appendMissingChainAuditMetadataRows\(\{/g)].length,
      atomicPublication: [...chainIndexerAuditSource.matchAll(/publishChainAuditSummary\(\{/g)].length,
      localReimplementations: [...chainIndexerAuditSource.matchAll(/function (?:parseBoundedInteger|parseDbInteger|parseDbTileId|parseChainTileId|parseChainEpoch|toSqlBlockNumber|eventId|betEventKey)\(/g)].length,
    },
    {
      endEpochParser: 1,
      blockPlanner: 1,
      eventIdentity: 1,
      betIdentity: 1,
      dbFileBoundary: 1,
      epochWindow: 1,
      accountingSnapshot: 1,
      metadataIds: 1,
      dustPolicy: 1,
      staleMetadata: 1,
      atomicPublication: 1,
      localReimplementations: 0,
    },
    "chain/indexer audit must bind every tested parser, identity, DB, accounting, metadata, dust, and publication boundary exactly once",
  );
  await runRuntimeSmokeRedactionBehaviorTests();
  await runClientIdentityAndRateLimitTests();
  await runWalletShellAndMiningActionTests();
  runCiSecurityBehaviorTests();
  runSecurityFollowupBehaviorTests();
  const browserAutomationSource = readFileSync("docs/browser_automation.md", "utf8");
  assert.match(
    browserAutomationSource,
    /Never use `npm run dev` for browser-only work[\s\S]*npm run dev:ui -- -p <port>/,
    "browser runbook must prevent composite dev runner from starting operator workers",
  );
  assert.match(
    browserAutomationSource,
    /local production browser baselines[\s\S]*fail closed without trusted proxy identity[\s\S]*ALLOW_WEAK_RATE_LIMIT_IDENTITY=1[\s\S]*only for localhost baseline\/smoke measurement[\s\S]*Do not commit this as a production default/,
    "browser runbook must document the local-only weak-identity baseline precondition without weakening production defaults",
  );
  runNoticeStackBehaviorTests();
  runUiMotionAndReadOnlyTests();
  await runHubReadOnlyControlTests();
  await runBrowserToolingBehaviorTests();
  runJackpotBannerPresentationTests();
  runPublicMetadataTests();
  runPublicPresentationTests();
  runTutorialAndPublicCopyTests();
  await runRuntimeMonitorBoundaryTests();
  runSidebarLegalNavigationTests();
  runHttpSmokeBoundaryTests();
  runRuntimeHealthDiagnosticsTests();
  runDataSyncHealthPolicyTests();
  runAdminOpsPolicyTests();
  runAdminOpsPresentationTests();
  await fetchTimeoutTests.runFetchWithTimeoutTests({ writeLine: () => {} });
  await runCheckLocalPolicyTests();
  runPublicApiReadModelTests();
  await runCleanupWorkspaceBehaviorTests();

  runWinsPresentationTests();
  runApiRecoveryStorageTests();
  runWalletPresentationTests();

  runExplorerLinkTests();

  runWalletActionBoundaryTests();
  runWalletExternalBoundaryTests();
  runErrorShellBoundaryTests();
  runDialogAccessibilityTests();
  runWalletFundingPresentationTests();
  await runUtilitySafetyTests();
  await runMiningRuntimeSafetyTests();
  await runWalletModelTests();
  await runReadModelTests();

  runRewardScannerTests();
  runLiveStateApiTests();
  runIndexerNormalizationTests();
  await runChainIndexerAuditPolicyTests();
  runHostEvidencePolicyTests();
  runJackpotAndRebateSecurityTests();

  runReleaseOperationsTests();
  await runLiveCanaryHealthBehaviorTests();
  await runPlaytestWalletPolicyTests();
  runAutonomousStatusBehaviorTests();
  runAutonomousDailyStatusTests();
  runPrelaunchStatusBehaviorTests();
  runProofDraftBehaviorTests();
  runProofFileBehaviorTests();
  runLocalProofPreflightBehaviorTests();
  runLaunchProofRunnerBehaviorTests();

  await runChatAndClientSafetyTests();

  runRuntimePollingTests();
  runChatPollingTests();
  runChatContentTests();
  runGameDataPresentationTests();

  await runRuntimeRecoveryTests();
  await runCacheAndPlannerTests();

  await runWalletRuntimeTests();
  runHistoryPresentationTests();

  console.log(`Business logic proof: ${JSON.stringify({
    version: 1,
    jsonNoStoreRoutes: true,
    sessionVaryCookie: true,
    boundedJsonRoutes: true,
    rateLimitNoStore: true,
    routeErrorRedaction: true,
    depositsRecoveryGlobalBound: depositsRecoveryProof.depositsRecoveryGlobalBound,
    browserBaselineCompactPerformance: true,
    authTrustedOriginFailClosed: true,
    authReplayNonceBoundary: true,
    authCanonicalNonceBoundary: true,
    authSessionCookieBoundary: true,
    sharedRateLimitRetryAfterBound: true,
    externalRateLimitPublicEndpoint: true,
    externalRateLimitResponseBound: true,
    externalSharedLockCanonical: true,
    replicaRateLimitStrictConfig: true,
    miningPendingRecoveryScoped: true,
    miningReceiptRevertExplicit: true,
    walletHashlessNonceRecovery: true,
    manualMinePendingAmbiguousSafe: true,
    approvalDuplicateSendSafe: true,
    autoMinerNonceRecoverySafe: true,
    autoMinerRpcReconnectSafe: true,
    rewardClaimStateSafe: true,
    safetyPoolClaimStateSafe: true,
    resolverClaimStateSafe: true,
  })}`);
  console.log("Business logic tests passed.");
}

const suppressedExpectedWarnings = await withExpectedWarningSuppression(main);
if (suppressedExpectedWarnings > 0) {
  console.log(`Suppressed ${suppressedExpectedWarnings} expected synthetic warning log(s).`);
}
