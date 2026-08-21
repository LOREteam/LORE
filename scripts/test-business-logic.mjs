import { runBusinessLogicSuite } from "./business-logic-suite.mjs";

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
  runPublicMetadataTests();
  runPublicPresentationTests();
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

const suppressedExpectedWarnings = await withExpectedWarningSuppression(runBusinessLogicSuite);
if (suppressedExpectedWarnings > 0) {
  console.log(`Suppressed ${suppressedExpectedWarnings} expected synthetic warning log(s).`);
}
