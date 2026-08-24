import "./test-business-logic-isolated-runner.mjs";
import "./test-live-canary-log-path.mjs";
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
import { runClientRuntimeContentSuite } from "./test-business-client-runtime-content-suite.mjs";
import { runPublicApiReadModelTests } from "./test-business-public-api-read-models.mjs";
import { runCleanupWorkspaceBehaviorTests } from "./test-business-cleanup-workspace.mjs";
import { runCleanupLoopManagerBehaviorTests } from "./test-business-cleanup-loop-manager.mjs";
import { runWalletPresentationTests } from "./test-business-wallet-presentation.mjs";
import { runWalletBoundarySuite } from "./test-business-wallet-boundary-suite.mjs";
import { runJackpotBannerPresentationTests } from "./test-business-jackpot-banner-presentation.mjs";
import { runJackpotShareVerificationTests } from "./test-business-jackpot-share-verification.mjs";
import { runWinsPresentationTests } from "./test-business-wins-presentation.mjs";
import { runRuntimeHealthDiagnosticsTests } from "./test-business-runtime-health-diagnostics.mjs";
import { runRuntimeMonitorBoundaryTests } from "./test-business-runtime-monitor-boundaries.mjs";
import { runPublicExperienceSuite } from "./test-business-public-experience-suite.mjs";
import { runWalletShellAndMiningActionTests } from "./test-business-wallet-shell-actions.mjs";
import { runApiRecoveryStorageTests } from "./test-business-api-recovery-storage.mjs";
import { runApiIntegerQueryTests } from "./test-business-api-integer-queries.mjs";
import { runApiRequestBoundaryTests } from "./test-business-api-request-boundaries.mjs";
import * as apiRouteMatrixTestModule from "./test-api-route-matrix.ts";
import { runContractV9SummaryBehaviorTests } from "./test-business-contract-v9-summary.mjs";
import { runProductionRuntimeSuite } from "./test-business-production-runtime-suite.mjs";
import { runJackpotAndRebateSecurityTests } from "./test-business-jackpot-rebate-security.mjs";
import { runChatAndClientSafetyTests } from "./test-business-chat-client-safety.mjs";
import { runReleaseEvidenceSuite } from "./test-business-release-evidence-suite.mjs";
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
import { runSummaryTimeoutTests } from "./test-business-summary-timeout.mjs";
import { runOperationsHealthSuite } from "./test-business-operations-health-suite.mjs";
import * as fetchTimeoutTestModule from "./test-fetch-with-timeout.ts";
import { runCheckLocalPolicyTests } from "./test-business-check-local-policy.mjs";
import { runCompilerAdvisoryBehaviorTests } from "./test-business-compiler-advisory.mjs";
import { runDependencyAuditBehaviorTests, runWalletDependencyAuditBehaviorTests } from "./test-business-dependency-audit.mjs";
import { runIndexerStorageBehaviorTests } from "./test-business-indexer-storage-behavior.mjs";
import { runLaunchProofGuardSuite } from "./test-business-launch-proof-guard-suite.mjs";
import { runBackupSummaryBehaviorTests } from "./test-business-backup-summary.mjs";
import { runReleaseProofSuite } from "./test-business-release-proof-suite.mjs";
import { runLaunchDocsBehaviorTests } from "./test-business-launch-docs.mjs";
import { runLaunchRemainingBehaviorTests } from "./test-business-launch-remaining.mjs";
import { runGasShadowBehaviorTests } from "./test-business-gas-shadow.mjs";
import { runRuntimeSmokeRedactionBehaviorTests } from "./test-business-runtime-smoke-redaction.mjs";
import { runCiSecurityBehaviorTests } from "./test-business-ci-security.mjs";
import { runNoticeStackBehaviorTests } from "./test-business-notice-stack.mjs";
import { runV10DeployedInputPolicyTests } from "./test-business-v10-deployed-input-policy.mjs";
import * as v10RuntimeIdentityTestModule from "./test-v10-runtime-identity.ts";
import { runV10SepoliaDeploymentManifestTests } from "./test-v10-sepolia-deployment-manifest.mjs";
import { runContractV10SummaryBehaviorTests } from "./test-business-contract-v10-summary.mjs";
import { runBusinessCoordinatorIsolatedFixtures } from "./test-business-coordinator-isolated-fixtures.mjs";
import { runBusinessCoordinatorBoundaryTests } from "./test-business-coordinator-boundaries.mjs";

const { runV10RuntimeIdentityTests } =
  v10RuntimeIdentityTestModule.default ?? v10RuntimeIdentityTestModule;

export async function runBusinessLogicSuite() {
  await runAuthAndCanaryBoundaryTests();
  runBusinessCoordinatorIsolatedFixtures();
  await runBusinessCoordinatorBoundaryTests();

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
  runProductionRuntimeSuite();
  runReleaseProofSuite();
  runLaunchProofGuardSuite();
  runBackupSummaryBehaviorTests();
  runLaunchDocsBehaviorTests();
  runLaunchRemainingBehaviorTests();
  await runCompilerAdvisoryBehaviorTests();
  runContractV10SummaryBehaviorTests();
  runV10DeployedInputPolicyTests();
  runV10SepoliaDeploymentManifestTests({ verifyGitArtifact: false });
  await runV10RuntimeIdentityTests();
  runSummaryTimeoutTests();
  runIndexerStorageBehaviorTests();
  await runDependencyAuditBehaviorTests();
  runWalletDependencyAuditBehaviorTests();
  await runGasShadowBehaviorTests();
  await runCleanupLoopManagerBehaviorTests();
  runHostProofPolicyTests();
  await runRuntimeSmokeRedactionBehaviorTests();
  await runClientIdentityAndRateLimitTests();
  await runWalletShellAndMiningActionTests();
  runCiSecurityBehaviorTests();
  runSecurityFollowupBehaviorTests();
  runNoticeStackBehaviorTests();
  runUiMotionAndReadOnlyTests();
  await runHubReadOnlyControlTests();
  await runBrowserToolingBehaviorTests();
  runJackpotBannerPresentationTests();
  runJackpotShareVerificationTests();
  runPublicExperienceSuite();
  await runRuntimeMonitorBoundaryTests();
  runRuntimeHealthDiagnosticsTests();
  runOperationsHealthSuite();
  await fetchTimeoutTests.runFetchWithTimeoutTests({ writeLine: () => {} });
  await runCheckLocalPolicyTests();
  runPublicApiReadModelTests();
  await runCleanupWorkspaceBehaviorTests();

  runWinsPresentationTests();
  runApiRecoveryStorageTests();
  runWalletPresentationTests();

  runExplorerLinkTests();

  runWalletBoundarySuite();
  await runUtilitySafetyTests();
  await runMiningRuntimeSafetyTests();
  await runWalletModelTests();
  await runReadModelTests();

  await runRewardScannerTests();
  runLiveStateApiTests();
  runIndexerNormalizationTests();
  await runChainIndexerAuditPolicyTests();
  runHostEvidencePolicyTests();
  runJackpotAndRebateSecurityTests();

  await runReleaseEvidenceSuite();

  await runChatAndClientSafetyTests();

  runClientRuntimeContentSuite();

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
