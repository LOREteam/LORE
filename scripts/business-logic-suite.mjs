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
import { runJackpotShareVerificationTests } from "./test-business-jackpot-share-verification.mjs";
import { runWinsPresentationTests } from "./test-business-wins-presentation.mjs";
import { runRuntimeHealthDiagnosticsTests } from "./test-business-runtime-health-diagnostics.mjs";
import { runRuntimeMonitorBoundaryTests } from "./test-business-runtime-monitor-boundaries.mjs";
import { runHttpSmokeBoundaryTests } from "./test-business-http-smoke-boundaries.mjs";
import { runWalletActionBoundaryTests } from "./test-business-wallet-action-boundaries.mjs";
import { runPublicMetadataTests } from "./test-business-public-metadata.mjs";
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
import { runDirectRouteSsrTests } from "./test-business-direct-route-ssr.mjs";
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
import * as v10RuntimeIdentityTestModule from "./test-v10-runtime-identity.ts";
import { runV10SepoliaDeploymentManifestTests } from "./test-v10-sepolia-deployment-manifest.mjs";
import { runContractV10SummaryBehaviorTests } from "./test-business-contract-v10-summary.mjs";
import { runReleaseDocumentationTests } from "./test-business-release-documentation.mjs";
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
  runPublicMetadataTests();
  runPublicPresentationTests();
  runDirectRouteSsrTests();
  runTutorialAndPublicCopyTests();
  await runRuntimeMonitorBoundaryTests();
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

  await runRewardScannerTests();
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
