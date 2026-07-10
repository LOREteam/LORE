import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import * as envParsingModule from "../config/envParsing.ts";
import * as scriptEnvParsingModule from "./env-parsing.mjs";
import * as publicConfigModule from "../config/publicConfig.ts";
import * as utilsModule from "../app/lib/utils.ts";
import * as eip7702Module from "../app/lib/eip7702.ts";
import * as chatAvatarUploadModule from "../app/lib/chatAvatarUpload.ts";
import * as chatPollDelayModule from "../app/lib/chatPollDelay.ts";
import * as chatMessagesModule from "../app/lib/chatMessages.ts";
import * as chatRateLimitModule from "../app/lib/chatRateLimit.ts";
import * as indexerFinalityModule from "../app/lib/indexerFinality.ts";
import * as networkRetryModule from "../app/lib/mining/networkRetry.ts";
import * as manualMineAttemptModule from "../app/lib/mining/manualMineAttempt.ts";
import * as autoMineLoopModule from "../app/hooks/useMiningAutoMineLoop.ts";
import * as miningRoundBettingModule from "../app/hooks/useMiningRoundBetting.ts";
import * as autoMineLoopModelModule from "../app/lib/mining/autoMineLoopModel.ts";
import * as autoMineLoopPreludePlannerModule from "../app/lib/mining/autoMineLoopPreludePlanner.ts";
import * as autoMineLoopRoundOutcomeModule from "../app/lib/mining/autoMineLoopRoundOutcome.ts";
import * as autoMineLoopRetryPlannerModule from "../app/lib/mining/autoMineLoopRetryPlanner.ts";
import * as autoMineLoopTransitionPlannerModule from "../app/lib/mining/autoMineLoopTransitionPlanner.ts";
import * as autoMineDiagnosticsModule from "../app/lib/mining/autoMineDiagnostics.ts";
import * as autoMineDebugOverrideModule from "../app/lib/mining/autoMineDebugOverride.ts";
import * as autoMineRunnerStopReasonModule from "../app/lib/mining/autoMineRunnerStopReason.ts";
import * as routeCacheModule from "../app/api/_lib/routeCache.ts";
import * as autoMineRuntimeControllerModule from "../app/lib/mining/autoMineRuntimeController.ts";
import * as autoMineErrorModule from "../app/hooks/useMiningAutoMineError.ts";
import * as autoMineRestoreDeduperModule from "../app/lib/mining/autoMineRestoreDeduper.ts";
import * as chunkReloadRecoveryModule from "../app/lib/chunkReloadRecovery.ts";
import * as miningSharedModule from "../app/hooks/useMining.shared.ts";
import * as safetyPoolClaimThresholdModule from "../app/lib/safetyPoolClaimThreshold.ts";
import * as analyticsDepositsStatusModule from "../app/lib/analyticsDepositsStatus.ts";
import * as tokenAmountMathModule from "../app/lib/tokenAmountMath.ts";
import * as miningTxPathModule from "../app/lib/miningTxPath.ts";
import * as rewardScannerModule from "../app/hooks/useRewardScanner.ts";
import * as rebateModule from "../app/hooks/useRebate.ts";
import * as walletTransfersModule from "../app/hooks/useWalletTransfers.ts";
import * as autoMinerFormModule from "../app/hooks/useAutoMinerForm.ts";
import * as analyticsAchievementsModule from "../app/hooks/useAnalyticsAchievements.ts";
import * as autoResolveStorageModule from "../app/hooks/autoResolveStorage.ts";
import * as addressNamesModule from "../app/hooks/useAddressNames.ts";
import * as liveStateSnapshotModule from "../app/hooks/useGameLiveStateSnapshot.ts";
import * as gameDataHelpersModule from "../app/hooks/useGameData.helpers.ts";
import * as gamePollingConfigModule from "../app/hooks/useGamePollingConfig.ts";
import * as depositHistoryModule from "../app/hooks/useDepositHistory.ts";
import * as globalStatsModule from "../app/hooks/useGlobalStats.ts";
import * as pageWalletOverviewModule from "../app/hooks/usePageWalletOverview.ts";
import * as leaderboardsModule from "../app/hooks/useLeaderboards.ts";
import * as jackpotHistoryModule from "../app/hooks/useJackpotHistory.ts";
import * as recentWinsModule from "../app/hooks/useRecentWins.ts";
import * as explorerLinksModule from "../app/lib/explorerLinks.ts";
import * as cacheTimestampModule from "../app/lib/cacheTimestamp.ts";
import * as productionRuntimeModule from "../config/productionRuntime.ts";
import * as lineaFeesModule from "../app/lib/lineaFees.ts";
import * as chatSessionClientModule from "../app/lib/chatSessionClient.ts";

function withTemporaryEnv(values, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function main() {
  const envParsing = envParsingModule.default ?? envParsingModule;
  const scriptEnvParsing = scriptEnvParsingModule.default ?? scriptEnvParsingModule;
  const utils = utilsModule.default ?? utilsModule;
  const chatAvatarUpload = chatAvatarUploadModule.default ?? chatAvatarUploadModule;
  const chatPollDelay = chatPollDelayModule.default ?? chatPollDelayModule;
  const chatMessages = chatMessagesModule.default ?? chatMessagesModule;
  const chatRateLimit = chatRateLimitModule.default ?? chatRateLimitModule;
  const indexerFinality = indexerFinalityModule.default ?? indexerFinalityModule;
  const networkRetry = networkRetryModule.default ?? networkRetryModule;
  const manualMineAttempt = manualMineAttemptModule.default ?? manualMineAttemptModule;
  const autoMineLoop = autoMineLoopModule.default ?? autoMineLoopModule;
  const miningRoundBetting = miningRoundBettingModule.default ?? miningRoundBettingModule;
  const autoMineLoopModel = autoMineLoopModelModule.default ?? autoMineLoopModelModule;
  const autoMineLoopPreludePlanner = autoMineLoopPreludePlannerModule.default ?? autoMineLoopPreludePlannerModule;
  const autoMineLoopRoundOutcome = autoMineLoopRoundOutcomeModule.default ?? autoMineLoopRoundOutcomeModule;
  const autoMineLoopRetryPlanner = autoMineLoopRetryPlannerModule.default ?? autoMineLoopRetryPlannerModule;
  const autoMineLoopTransitionPlanner = autoMineLoopTransitionPlannerModule.default ?? autoMineLoopTransitionPlannerModule;
  const autoMineDiagnostics = autoMineDiagnosticsModule.default ?? autoMineDiagnosticsModule;
  const autoMineDebugOverride = autoMineDebugOverrideModule.default ?? autoMineDebugOverrideModule;
  const autoMineRunnerStopReason = autoMineRunnerStopReasonModule.default ?? autoMineRunnerStopReasonModule;
  const routeCache = routeCacheModule.default ?? routeCacheModule;
  const autoMineRuntimeController = autoMineRuntimeControllerModule.default ?? autoMineRuntimeControllerModule;
  const autoMineError = autoMineErrorModule.default ?? autoMineErrorModule;
  const autoMineRestoreDeduper = autoMineRestoreDeduperModule.default ?? autoMineRestoreDeduperModule;
  const chunkReloadRecovery = chunkReloadRecoveryModule.default ?? chunkReloadRecoveryModule;
  const miningShared = miningSharedModule.default ?? miningSharedModule;
  const safetyPoolClaimThreshold = safetyPoolClaimThresholdModule.default ?? safetyPoolClaimThresholdModule;
  const analyticsDepositsStatus = analyticsDepositsStatusModule.default ?? analyticsDepositsStatusModule;
  const tokenAmountMath = tokenAmountMathModule.default ?? tokenAmountMathModule;
  const miningTxPath = miningTxPathModule.default ?? miningTxPathModule;
  const rewardScanner = rewardScannerModule.default ?? rewardScannerModule;
  const rebate = rebateModule.default ?? rebateModule;
  const walletTransfers = walletTransfersModule.default ?? walletTransfersModule;
  const autoMinerForm = autoMinerFormModule.default ?? autoMinerFormModule;
  const analyticsAchievements = analyticsAchievementsModule.default ?? analyticsAchievementsModule;
  const autoResolveStorage = autoResolveStorageModule.default ?? autoResolveStorageModule;
  const addressNames = addressNamesModule.default ?? addressNamesModule;
  const liveStateSnapshot = liveStateSnapshotModule.default ?? liveStateSnapshotModule;
  const gameDataHelpers = gameDataHelpersModule.default ?? gameDataHelpersModule;
  const gamePollingConfig = gamePollingConfigModule.default ?? gamePollingConfigModule;
  const depositHistory = depositHistoryModule.default ?? depositHistoryModule;
  const globalStats = globalStatsModule.default ?? globalStatsModule;
  const pageWalletOverview = pageWalletOverviewModule.default ?? pageWalletOverviewModule;
  const leaderboards = leaderboardsModule.default ?? leaderboardsModule;
  const jackpotHistory = jackpotHistoryModule.default ?? jackpotHistoryModule;
  const recentWins = recentWinsModule.default ?? recentWinsModule;
  const explorerLinks = explorerLinksModule.default ?? explorerLinksModule;
  const cacheTimestamp = cacheTimestampModule.default ?? cacheTimestampModule;
  const publicConfig = publicConfigModule.default ?? publicConfigModule;
  const eip7702 = eip7702Module.default ?? eip7702Module;
  const productionRuntime = productionRuntimeModule.default ?? productionRuntimeModule;
  const lineaFees = lineaFeesModule.default ?? lineaFeesModule;
  const chatSessionClient = chatSessionClientModule.default ?? chatSessionClientModule;

  assert.equal(lineaFees.getAffordableKeeperGasLimit(180000n, 100000n, { maxFeePerGas: 1n, maxPriorityFeePerGas: 1n }), null);
  assert.equal(publicConfig.getConfiguredEip7702MiningEnabled("1", "0"), false);
  assert.equal(publicConfig.getConfiguredEip7702MiningEnabled("1", "1"), true);
  assert.equal(publicConfig.getConfiguredEip7702MiningEnabled("0", "1"), false);
  assert.equal(publicConfig.getConfiguredReadOnlyMode("1"), true);
  assert.equal(publicConfig.getConfiguredReadOnlyMode("true"), true);
  assert.equal(publicConfig.getConfiguredReadOnlyMode("0"), false);
  assert.equal(publicConfig.getConfiguredReadOnlyMode("bogus"), false);
  assert.equal(publicConfig.isUnstableLineaReadRpc("https://linea-sepolia-rpc.publicnode.com", "sepolia"), true);
  assert.equal(publicConfig.isUnstableLineaReadRpc("https://rpc.sepolia.linea.build", "sepolia"), false);
  assert.equal(publicConfig.isUnstableLineaReadRpc("https://linea-sepolia.drpc.org", "sepolia"), false);
  assert.deepEqual(
    publicConfig.getStableLineaReadRpcs(undefined, "sepolia"),
    ["https://linea-sepolia.drpc.org", "https://rpc.sepolia.linea.build"],
  );
  assert.equal(
    publicConfig.getPreferredLineaRpcs(undefined, "sepolia")[0],
    "https://linea-sepolia-rpc.publicnode.com",
  );
  assert.throws(
    () => publicConfig.getConfiguredDeployBlock("bad", "sepolia"),
    /INDEXER_START_BLOCK must be a non-negative integer/,
  );
  assert.throws(
    () => publicConfig.getConfiguredDeployBlock("-1", "sepolia"),
    /INDEXER_START_BLOCK must be a non-negative integer/,
  );
  assert.equal(envParsing.parseOptionalNonNegativeBigIntEnv("bad", 256n), 256n);
  assert.equal(envParsing.parseOptionalNonNegativeBigIntEnv("-1", 256n), 256n);
  assert.equal(envParsing.parseOptionalNonNegativeBigIntEnv("512", 256n), 512n);
  assert.equal(envParsing.parseOptionalNonNegativeNumberEnv("bad", 256), 256);
  assert.equal(envParsing.parseOptionalNonNegativeNumberEnv("-1", 256), 256);
  assert.equal(envParsing.parseOptionalNonNegativeNumberEnv("512", 256), 512);
  assert.equal(envParsing.parseOptionalPositiveIntegerEnv("bad", 15_000), 15_000);
  assert.equal(envParsing.parseOptionalPositiveIntegerEnv("0", 15_000), 15_000);
  assert.equal(envParsing.parseOptionalPositiveIntegerEnv("-1", 15_000), 15_000);
  assert.equal(envParsing.parseOptionalPositiveIntegerEnv("90000", 15_000), 90_000);
  assert.equal(envParsing.parseOptionalPositiveIntegerInRangeEnv("bad", 3, 1, 24), 3);
  assert.equal(envParsing.parseOptionalPositiveIntegerInRangeEnv("0", 3, 1, 24), 3);
  assert.equal(envParsing.parseOptionalPositiveIntegerInRangeEnv("12", 3, 1, 24), 12);
  assert.equal(envParsing.parseOptionalPositiveIntegerInRangeEnv("999", 3, 1, 24), 24);
  assert.equal(scriptEnvParsing.parsePositiveIntegerEnv("bad", 60_000), 60_000);
  assert.equal(scriptEnvParsing.parsePositiveIntegerEnv("0", 60_000), 60_000);
  assert.equal(scriptEnvParsing.parsePositiveIntegerEnv("90000", 60_000), 90_000);
  assert.equal(scriptEnvParsing.parsePositiveIntegerInRangeEnv("999", 3, 1, 24), 24);
  assert.equal(scriptEnvParsing.parseNonNegativeNumberInRangeEnv("-1", 0.01, 0, 1), 0.01);
  assert.equal(scriptEnvParsing.parseNonNegativeNumberInRangeEnv("1.5", 0.01, 0, 1), 1);
  withTemporaryEnv(
    {
      LINEA_NETWORK: "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.example",
      NEXT_PUBLIC_SITE_URL: "https://play.example",
      HEALTH_DIAGNOSTICS_SECRET: "health-secret",
      TRUST_PROXY_HEADERS: "1",
      NEXT_PUBLIC_PRIVY_APP_ID: "privy-app",
      CHAT_AUTH_SECRET: "chat-secret",
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "resolve-secret",
      BOOTSTRAP_KEEPER_PRIVATE_KEY: "keeper-private-key",
      LORE_DB_PATH: "C:\\lore\\mainnet.sqlite",
      NEXT_PUBLIC_EIP7702_ENABLED: "1",
      NEXT_PUBLIC_EIP7702_MINING_ENABLED: "1",
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("web"),
        /EIP-7702 must stay disabled/,
      );
    },
  );
  withTemporaryEnv(
    {
      LINEA_NETWORK: "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.example",
      NEXT_PUBLIC_SITE_URL: "https://play.example",
      HEALTH_DIAGNOSTICS_SECRET: "health-secret",
      TRUST_PROXY_HEADERS: "1",
      NEXT_PUBLIC_PRIVY_APP_ID: undefined,
      CHAT_AUTH_SECRET: "chat-secret",
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "resolve-secret",
      BOOTSTRAP_KEEPER_PRIVATE_KEY: "keeper-private-key",
      LORE_DB_PATH: "C:\\lore\\mainnet.sqlite",
      NEXT_PUBLIC_EIP7702_ENABLED: "0",
      NEXT_PUBLIC_EIP7702_MINING_ENABLED: "0",
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("web"),
        /NEXT_PUBLIC_PRIVY_APP_ID is required/,
      );
    },
  );
  withTemporaryEnv(
    {
      LINEA_NETWORK: "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.example",
      NEXT_PUBLIC_SITE_URL: "https://play.example",
      HEALTH_DIAGNOSTICS_SECRET: "health-secret",
      TRUST_PROXY_HEADERS: "1",
      NEXT_PUBLIC_PRIVY_APP_ID: "privy-app",
      CHAT_AUTH_SECRET: "chat-secret",
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "resolve-secret",
      BOOTSTRAP_KEEPER_PRIVATE_KEY: "keeper-private-key",
      KEEPER_PRIVATE_KEY: "keeper-private-key",
      LORE_DB_PATH: "C:\\lore\\mainnet.sqlite",
      NEXT_PUBLIC_EIP7702_ENABLED: "0",
      NEXT_PUBLIC_EIP7702_MINING_ENABLED: "1",
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("bot"),
        /EIP-7702 mining must stay disabled/,
      );
    },
  );
  withTemporaryEnv(
    {
      LINEA_NETWORK: "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.example",
      NEXT_PUBLIC_SITE_URL: "https://play.example",
      HEALTH_DIAGNOSTICS_SECRET: "health-secret",
      LORE_DB_PATH: "C:\\lore\\mainnet.sqlite",
      INDEXER_FINALITY_BLOCKS: undefined,
      NEXT_PUBLIC_EIP7702_ENABLED: "0",
      NEXT_PUBLIC_EIP7702_MINING_ENABLED: "0",
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("indexer"),
        /INDEXER_FINALITY_BLOCKS must be set to a positive block count/,
      );
    },
  );
  withTemporaryEnv(
    {
      LINEA_NETWORK: "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.example",
      NEXT_PUBLIC_SITE_URL: "https://play.example",
      HEALTH_DIAGNOSTICS_SECRET: "health-secret",
      LORE_DB_PATH: "C:\\lore\\mainnet.sqlite",
      INDEXER_FINALITY_BLOCKS: "64",
      NEXT_PUBLIC_EIP7702_ENABLED: "0",
      NEXT_PUBLIC_EIP7702_MINING_ENABLED: "0",
    },
    () => {
      assert.doesNotThrow(() => productionRuntime.assertProductionRuntimeConfig("indexer"));
    },
  );
  const prodHealthSource = readFileSync("scripts/check-production-health.mjs", "utf8");
  assert.match(
    prodHealthSource,
    /import "dotenv\/config"/,
    "production health checker must load .env like other standalone runtime scripts",
  );
  assert.match(
    prodHealthSource,
    /finalityLagBlocks\s*\?\?\s*lagBlocks/,
    "production health checker must prefer finality-target lag over raw head lag",
  );
  assert.match(
    prodHealthSource,
    /const effectiveLagLabel = finalityLagBlocks !== null/,
    "production health checker must label lag source from the normalized finality lag value",
  );
  assert.match(
    prodHealthSource,
    /PROD_HEALTH_ALLOW_LOCAL=1 only for local smoke checks/,
    "production health checker must reject localhost health proof unless local smoke is explicitly allowed",
  );
  assert.match(
    prodHealthSource,
    /HEALTH_DIAGNOSTICS_SECRET is required/,
    "production health checker must fail clearly when diagnostics secret is missing",
  );
  assert.match(
    prodHealthSource,
    /function parsePayloadNonNegativeNumber/,
    "production health checker must normalize numeric API payload fields before threshold comparisons",
  );
  assert.doesNotMatch(
    prodHealthSource,
    /const missingCount = Number\(payload\?\.epochs\?\.missingCount \?\? 0\)/,
    "production health checker must not silently coerce invalid missingCount payload values",
  );
  assert.match(
    prodHealthSource,
    /mainnet runtime is missing NEXT_PUBLIC_PRIVY_APP_ID/,
    "production health checker must fail mainnet when the public Privy app id is missing",
  );
  assert.match(
    prodHealthSource,
    /mainnet runtime is using the development Privy fallback/,
    "production health checker must fail mainnet if the development Privy fallback is active",
  );
  assert.match(
    prodHealthSource,
    /mainnet runtime has EIP-7702 enabled/,
    "production health checker must fail mainnet if EIP-7702 appears enabled",
  );
  assert.match(
    prodHealthSource,
    /runtime publicConfig\.readOnlyMode is missing/,
    "production health checker must fail when read-only mode diagnostics are missing",
  );
  assert.match(
    prodHealthSource,
    /eip7702Enabled !== false/,
    "production health checker must require EIP-7702 diagnostics to be explicitly false on mainnet",
  );
  assert.match(
    prodHealthSource,
    /readOnlyMode=/,
    "production health checker summary must expose read-only betting mode",
  );
  const loadHttpSource = readFileSync("scripts/load-http.mjs", "utf8");
  assert.match(
    loadHttpSource,
    /load warm-up could not reach/,
    "load test must fail fast when the base URL is unreachable",
  );
  assert.match(
    loadHttpSource,
    /LOAD_ALLOW_LOCAL=1 only for local smoke checks/,
    "load:http must reject localhost load evidence unless local smoke is explicitly allowed",
  );
  assert.match(
    loadHttpSource,
    /LOAD_CONCURRENCY,\s*50/,
    "default load test concurrency must stay suitable for local production smoke; use LOAD_CONCURRENCY for stress tests",
  );
  const hostProofTempDir = mkdtempSync(join(tmpdir(), "lore-host-proof-"));
  const hostProofCheckedAt = "2026-07-09T00:00:00.000Z";
  const baseHostProof = {
    origin: "https://playlore.xyz",
    hostType: "production",
    processModel: {
      supervisor: "pm2",
      "lore-site": { status: "running", running: true, supervised: true, command: "npm.cmd run start", checkedAt: hostProofCheckedAt, evidence: "pm2 lore-site online docs/host-process-model.log" },
      "lore-bot": { status: "running", running: true, supervised: true, command: "npm.cmd run bot", checkedAt: hostProofCheckedAt, evidence: "pm2 lore-bot online docs/host-process-model.log" },
      "lore-indexer": { status: "running", running: true, supervised: true, command: "npm.cmd run indexer", checkedAt: hostProofCheckedAt, evidence: "pm2 lore-indexer online docs/host-process-model.log" },
    },
    persistentDb: {
      path: join(hostProofTempDir, "lore-mainnet.sqlite"),
      absolutePathOutsideRepo: true,
      restartSurvived: true,
      rebootSurvived: true,
      checkedAt: hostProofCheckedAt,
      evidence: "npm.cmd run proof:host persistentDb restartSurvived=true rebootSurvived=true",
    },
    healthProd: {
      status: "pass",
      command: "npm.cmd run health:prod",
      url: "https://playlore.xyz/api/health/runtime",
      runtimeHealthPassed: true,
      dataSyncHealthPassed: true,
      diagnosticsAuthPassed: true,
      finalityLagChecked: true,
      jackpotRowsChecked: true,
      timestamp: hostProofCheckedAt,
      evidence: "npm.cmd run health:prod [prod-health] OK base=https://playlore.xyz runtime=ok dataSync=healthy finalityLagBlocks=3",
    },
    loadHttp: {
      status: "pass",
      command: "npm.cmd run load:http",
      hostType: "canary",
      url: "https://canary.playlore.xyz",
      requestCount: 120,
      errorRate: 0,
      maxErrorRate: 0.01,
      p95Ms: 250,
      maxP95Ms: 1000,
      durationMs: 60000,
      concurrency: 10,
      timestamp: hostProofCheckedAt,
      evidence: "Load base URL: https://canary.playlore.xyz | TOTAL requestCount=120 p95=250ms",
    },
  };
  const runHostProof = (manifest, name) => {
    const manifestPath = join(hostProofTempDir, `${name}.json`);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    return spawnSync(process.execPath, ["scripts/check-host-proof.mjs", "--strict", `--file=${manifestPath}`], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  };
  const canaryHostProof = runHostProof(baseHostProof, "canary-host-proof");
  assert.equal(canaryHostProof.status, 0, canaryHostProof.stdout || canaryHostProof.stderr);
  const finalOriginLoadProof = JSON.parse(JSON.stringify(baseHostProof));
  finalOriginLoadProof.loadHttp.url = finalOriginLoadProof.origin;
  const finalOriginLoadResult = runHostProof(finalOriginLoadProof, "final-origin-load-proof");
  assert.equal(finalOriginLoadResult.status, 1, "host proof must reject load:http evidence collected against the final production origin");
  assert.match(
    finalOriginLoadResult.stdout,
    /loadHttp\.url must not be the final production origin/,
    "host proof must explain why final-origin load evidence is rejected",
  );
  const dataSyncHealthSource = readFileSync("app/api/health/data-sync/route.ts", "utf8");
  assert.match(
    dataSyncHealthSource,
    /effectiveIndexerLagForStaleness\s*=\s*lagToFinalityTargetBlocks\s*\?\?\s*lagBlocks/,
    "data-sync health stale checks must prefer finality-target lag over raw head lag",
  );
  assert.match(
    dataSyncHealthSource,
    /effectiveIndexerLagForStaleness\s*>\s*LAG_WARN_BLOCKS/,
    "data-sync repair stale check must use finality-aware lag",
  );
  assert.match(
    dataSyncHealthSource,
    /function parseStoredBlockNumber/,
    "data-sync health must parse stored block numbers safely",
  );
  assert.doesNotMatch(
    dataSyncHealthSource,
    /(^|[^A-Za-z])Number\(row\.blockNumber/,
    "data-sync health must not coerce stored block numbers with Number(row.blockNumber)",
  );
  assert.doesNotMatch(
    dataSyncHealthSource,
    /Math\.max\(\s*\.\.\.recentRewardClaims/,
    "data-sync health must not Math.max an unchecked reward-claim block list",
  );
  assert.match(
    dataSyncHealthSource,
    /function toHealthErrorResponse/,
    "data-sync health error responses must use the no-store helper",
  );
  assert.match(
    dataSyncHealthSource,
    /authorized[\s\S]*Internal error/,
    "data-sync public health errors must be redacted",
  );
  assert.match(
    dataSyncHealthSource,
    /err instanceof Error/,
    "data-sync private health error formatting must handle primitive rejection values",
  );
  const adminAuthSource = readFileSync("app/api/admin/auth/route.ts", "utf8");
  assert.match(
    adminAuthSource,
    /request\.json\(\)\.catch\(\(\)\s*=>\s*null\)/,
    "admin auth POST must not turn malformed JSON into a 500",
  );
  assert.match(
    adminAuthSource,
    /Invalid auth payload/,
    "admin auth POST must return a clear invalid-payload error for malformed JSON",
  );
  const adminOpsSource = readFileSync("app/api/admin/ops/route.ts", "utf8");
  assert.match(
    adminOpsSource,
    /function parseStoredEpochNumber/,
    "admin ops must parse stored epoch keys safely",
  );
  assert.doesNotMatch(
    adminOpsSource,
    /(^|[^A-Za-z])Number\(epoch\)/,
    "admin ops must not coerce stored epoch keys with Number(epoch)",
  );
  assert.doesNotMatch(
    adminOpsSource,
    /Number\.isInteger\(row\.epoch\)/,
    "admin ops must reject unsafe epoch numbers",
  );
  const sharedRateLimitSource = readFileSync("app/api/_lib/sharedRateLimit.ts", "utf8");
  assert.match(
    sharedRateLimitSource,
    /applyNoStoreHeaders/,
    "rate-limit 429 responses must be no-store",
  );
  const providersSource = readFileSync("app/providers.tsx", "utf8");
  assert.match(
    providersSource,
    /coinbaseWallet[\s\S]*preference[\s\S]*options:\s*['"]eoaOnly['"]/,
    "Privy Coinbase connector must avoid unsupported smart-wallet mode on Linea networks",
  );
  const headerWalletCardSource = readFileSync("app/components/header/HeaderWalletCard.tsx", "utf8");
  assert.match(
    headerWalletCardSource,
    /disabled=\{!privyReady \|\| loginPending\}/,
    "connect wallet button must be disabled until Privy is ready to avoid a silent no-op",
  );
  assert.match(
    headerWalletCardSource,
    /Wallet login is still loading/,
    "connect wallet button must explain the loading state",
  );
  const walletSettingsModalSource = readFileSync("app/components/WalletSettingsModal.tsx", "utf8");
  assert.match(
    walletSettingsModalSource,
    /SECTIONS[\s\S]*EIP7702_ENABLED[\s\S]*BASE_SECTIONS/,
    "wallet settings must hide the 7702 diagnostic tab when EIP-7702 is disabled",
  );
  assert.match(
    walletSettingsModalSource,
    /EIP7702_ENABLED\s*&&\s*\(activeSection === "all" \|\| activeSection === "7702"\)/,
    "wallet settings must render the 7702 diagnostic panel only behind the explicit EIP-7702 flag",
  );
  const miningRoundBettingSource = readFileSync("app/hooks/useMiningRoundBetting.ts", "utf8");
  assert.match(
    miningRoundBettingSource,
    /EIP7702_MINING_ENABLED\s*&&\s*placeBets7702\s*&&\s*canAttemptEip7702\(\)/,
    "mining must not attempt the 7702 delegated path unless the separate mining flag is enabled",
  );
  const miningManualActionsSource = readFileSync("app/hooks/useMiningManualActions.ts", "utf8");
  assert.match(
    miningManualActionsSource,
    /Preparing bet transaction/,
    "manual bet must show a preparing/signing notification before the wallet prompt",
  );
  assert.match(
    miningManualActionsSource,
    /Preparing repeat bet transaction/,
    "repeat bet must show a preparing/signing notification before the wallet prompt",
  );
  const autoResolveSource = readFileSync("app/hooks/useAutoResolve.ts", "utf8");
  assert.match(
    autoResolveSource,
    /function getBootstrapRetryDelayMs/,
    "auto-resolve must centralize bootstrap retryAfter clamping",
  );
  assert.doesNotMatch(
    autoResolveSource,
    /Number\(payload\??\.retryAfter \?\? 0\)\s*\*\s*1000/,
    "auto-resolve must not trust raw retryAfter values from bootstrap responses",
  );
  const bootstrapResolveRouteSource = readFileSync("app/api/bootstrap-resolve/route.ts", "utf8");
  assert.match(
    bootstrapResolveRouteSource,
    /waitForTransactionReceipt/,
    "bootstrap resolver must inspect resolve tx receipts instead of treating every submitted tx as successful",
  );
  assert.match(
    bootstrapResolveRouteSource,
    /resolve_tx_reverted/,
    "bootstrap resolver must surface reverted resolve txs as retryable noop responses",
  );
  const smokeBrowserSource = readFileSync("scripts/smoke-browser.mjs", "utf8");
  assert.doesNotMatch(
    smokeBrowserSource,
    /configured chains are not supported/,
    "browser smoke must not ignore Privy/Coinbase unsupported-chain regressions",
  );
  assert.match(
    smokeBrowserSource,
    /verify desktop wallet selector/,
    "browser smoke must verify the Privy wallet selector early on desktop",
  );
  assert.match(
    smokeBrowserSource,
    /verify isolated mobile wallet selector/,
    "browser smoke must verify the Privy wallet selector in a fresh mobile page",
  );
  assert.match(
    smokeBrowserSource,
    /mobileWalletContext\s*=\s*await browser\.newContext/,
    "browser smoke mobile wallet selector must run in an isolated browser context",
  );
  assert.match(
    smokeBrowserSource,
    /mandatory wallet selector smoke/,
    "browser smoke wallet selector checks must be mandatory instead of optional skips",
  );
  assert.match(
    smokeBrowserSource,
    /openLoginModalWithReload/,
    "browser smoke wallet selector checks must retry once after a stuck Privy-ready state",
  );
  assert.match(
    smokeBrowserSource,
    /login modal did not open; reloading once before retry/,
    "browser smoke wallet selector reload retry must log the stuck auth init condition",
  );
  assert.match(
    smokeBrowserSource,
    /verify hub visual regression guards/,
    "browser smoke must verify the numeric font and pool chart runtime guards",
  );
  assert.match(
    smokeBrowserSource,
    /SMOKE_EXPECT_READ_ONLY/,
    "browser smoke must support an explicit read-only maintenance mode check",
  );
  assert.match(
    smokeBrowserSource,
    /verifyReadOnlyMode/,
    "browser smoke must verify the read-only betting UI when requested",
  );
  assert.match(
    smokeBrowserSource,
    /SKIP auto-miner persistence step in read-only smoke/,
    "browser smoke must skip input-mutating auto-miner checks in read-only mode",
  );
  assert.match(
    headerWalletCardSource,
    /Wallet Loading\.\.\./,
    "wallet header must label Privy initialization as loading instead of a clickable connect action",
  );
  assert.match(
    headerWalletCardSource,
    /window\.location\.reload\(\)/,
    "wallet header must offer a reload recovery action when Privy stays loading",
  );
  assert.doesNotMatch(
    headerWalletCardSource,
    /privyReady\s*\?\s*"Login \/ Connect"\s*:\s*"Connect Wallet"/,
    "wallet header must not show Connect Wallet while Privy is not ready",
  );
  const lineaOreClientRuntimeSource = readFileSync("app/hooks/useLineaOreClientRuntime.ts", "utf8");
  assert.match(
    lineaOreClientRuntimeSource,
    /getConfiguredReadOnlyMode/,
    "client runtime must read the public read-only mode flag",
  );
  assert.match(
    lineaOreClientRuntimeSource,
    /readOnlyReason/,
    "client runtime must expose a user-facing read-only reason",
  );
  const miningGuardsSource = readFileSync("app/hooks/useMiningGuards.ts", "utf8");
  assert.match(
    miningGuardsSource,
    /readOnlyReason[\s\S]*notify\(readOnlyReason,\s*"warning"\)/,
    "mining guards must block manual betting with the read-only reason",
  );
  assert.match(
    miningGuardsSource,
    /!isAutoMining\s*&&\s*readOnlyReason[\s\S]*notify\(readOnlyReason,\s*"warning"\)/,
    "mining guards must block starting auto-miner in read-only mode while still allowing stop",
  );
  const hubContentSource = readFileSync("app/components/HubContent.tsx", "utf8");
  assert.match(
    hubContentSource,
    /readOnlyReason[\s\S]*data-testid="hub-read-only-banner"/,
    "hub must show a visible read-only banner when betting is temporarily paused",
  );
  assert.match(
    hubContentSource,
    /readOnlyReason=\{readOnlyReason\}/,
    "hub must pass read-only reason to desktop and mobile betting controls",
  );
  const smokeBrowserFlowsSource = readFileSync("scripts/smoke-browser-lib/flows.mjs", "utf8");
  assert.match(
    smokeBrowserFlowsSource,
    /openWalletSelectorFromLoginModal/,
    "browser smoke flows must expose a wallet selector check",
  );
  assert.match(
    smokeBrowserFlowsSource,
    /modalTimeoutMs\s*=\s*Math\.min\(timeoutMs,\s*15_000\)/,
    "browser smoke login modal must wait long enough for Privy auth widget",
  );
  assert.match(
    smokeBrowserFlowsSource,
    /privyReadyTimeoutMs\s*=\s*Math\.max\(modalTimeoutMs,\s*timeoutMs\)/,
    "browser smoke login modal must allow the full smoke timeout for Privy readiness",
  );
  assert.match(
    smokeBrowserFlowsSource,
    /clickVisibleEnabledButton/,
    "browser smoke login modal must click the visible enabled connect button",
  );
  assert.match(
    smokeBrowserFlowsSource,
    /LOGIN TO BET[\s\S]*LOGIN TO START/,
    "browser smoke login modal must accept manual-bet and auto-miner guest auth entrypoints",
  );
  assert.match(
    smokeBrowserFlowsSource,
    /!button\.disabled[\s\S]*expectedLabels\.includes/,
    "browser smoke login modal must wait for an enabled matching button before clicking",
  );
  assert.match(
    smokeBrowserFlowsSource,
    /walletOptionsTimeoutMs\s*=\s*Math\.min\(timeoutMs,\s*15_000\)/,
    "browser smoke wallet selector must allow Privy wallet options enough time to load",
  );
  assert.match(
    smokeBrowserFlowsSource,
    /\[data-testid="manual-bet-action"\]/,
    "browser smoke read-only checks must target the manual bet action by stable test id",
  );
  assert.match(
    smokeBrowserFlowsSource,
    /\[data-testid="auto-miner-action"\]/,
    "browser smoke read-only checks must target the auto-miner action by stable test id",
  );
  assert.match(
    smokeBrowserFlowsSource,
    /visibleButtonTexts\.some\(\(text\) => text\.includes\("MetaMask"\)\)[\s\S]*visibleButtonTexts\.some\(\(text\) => text\.includes\("Coinbase Wallet"\)\)/,
    "browser smoke wallet selector must verify visible MetaMask and Coinbase options",
  );
  assert.match(
    smokeBrowserFlowsSource,
    /retrying auth widget/,
    "browser smoke wallet selector must retry the Privy auth widget when wallet options load slowly",
  );
  assert.match(
    smokeBrowserFlowsSource,
    /visible buttons:/,
    "browser smoke wallet selector failure must include visible button diagnostics",
  );
  assert.match(
    smokeBrowserFlowsSource,
    /verifyHubVisualRegressionGuards/,
    "browser smoke flows must expose visual regression guards for known wallet-page regressions",
  );
  const jackpotBannerSource = readFileSync("app/components/JackpotBanner.tsx", "utf8");
  assert.match(
    jackpotBannerSource,
    /"playlore\.xyz"/,
    "jackpot Share on X text must point users to playlore.xyz",
  );
  assert.match(
    jackpotBannerSource,
    /"#LORE #Linea"/,
    "jackpot Share on X hashtags must be on their own text line",
  );
  assert.doesNotMatch(
    jackpotBannerSource,
    /url:\s*sharePageUrl|hashtags:\s*"LORE,Linea"|Play:/,
    "jackpot Share on X must not append a long URL or Play: prefix",
  );
  assert.doesNotMatch(
    jackpotBannerSource,
    /https:\/\/lore\.game|Play: lore\.game/,
    "jackpot Share on X must not use the old lore.game share URL",
  );
  const jackpotWinPageSource = readFileSync("app/jackpot-win/page.tsx", "utf8");
  assert.match(
    jackpotWinPageSource,
    /https:\/\/playlore\.xyz/,
    "jackpot share preview page must default metadata to playlore.xyz",
  );
  assert.match(
    jackpotWinPageSource,
    /Play at playlore\.xyz/,
    "jackpot share preview page CTA must display playlore.xyz",
  );
  const smokeHttpSource = readFileSync("scripts/smoke-http.mjs", "utf8");
  assert.match(
    smokeHttpSource,
    /LORE - Linea Mining Game/,
    "HTTP smoke must verify the LORE page title to catch wrong local sites on the same port",
  );
  const loreIntroSource = readFileSync("app/components/LoreIntro.tsx", "utf8");
  assert.match(
    loreIntroSource,
    /localStorage\.getItem\(DISMISSED_KEY\)[\s\S]*catch[\s\S]*setVisible\(true\)/,
    "lore intro must not crash if localStorage reads fail in private or restricted browsers",
  );
  const runtimeHealthSource = readFileSync("app/api/health/runtime/route.ts", "utf8");
  assert.match(
    runtimeHealthSource,
    /publicConfig/,
    "runtime health must expose a safe public config diagnostic object",
  );
  assert.match(
    runtimeHealthSource,
    /privyAppIdConfigured/,
    "runtime health must expose whether the public Privy app id is configured without leaking it",
  );
  assert.match(
    runtimeHealthSource,
    /getConfiguredReadOnlyMode/,
    "runtime health must expose whether read-only betting mode is enabled",
  );
  assert.match(
    smokeHttpSource,
    /readOnlyMode/,
    "HTTP smoke must verify runtime health read-only mode diagnostics",
  );
  const adminOpsClientSource = readFileSync("app/admin/AdminOpsClient.tsx", "utf8");
  assert.match(
    adminOpsClientSource,
    /readOnlyMode/,
    "admin ops runtime card must surface read-only betting mode",
  );
  const rewardsRouteSource = readFileSync("app/api/rewards/route.ts", "utf8");
  assert.match(
    rewardsRouteSource,
    /Number\.isSafeInteger\(value\)\s*&&\s*value\s*>\s*0/,
    "rewards API must reject unsafe epoch numbers from user payloads",
  );
  const recentWinsApiSource = readFileSync("app/api/recent-wins/data.ts", "utf8");
  assert.match(
    recentWinsApiSource,
    /function parseStoredBlockNumber/,
    "recent wins API must tolerate corrupted stored block numbers",
  );
  assert.match(
    recentWinsApiSource,
    /function parseStoredEpochNumber/,
    "recent wins API must parse stored epoch keys safely",
  );
  assert.doesNotMatch(
    recentWinsApiSource,
    /BigInt\([^)]*blockNumber\s*\|\|\s*"0"\)/,
    "recent wins API must not call BigInt directly on stored blockNumber strings",
  );
  assert.doesNotMatch(
    recentWinsApiSource,
    /Number\(b\.epoch\)\s*-\s*Number\(a\.epoch\)/,
    "recent wins API must not sort using unchecked stored epoch numbers",
  );
  const depositsRouteSource = readFileSync("app/api/deposits/route.ts", "utf8");
  assert.match(
    depositsRouteSource,
    /function parseStoredBlockNumber/,
    "deposits API must tolerate corrupted stored block numbers",
  );
  assert.doesNotMatch(
    depositsRouteSource,
    /BigInt\([^)]*blockNumber\s*\|\|\s*"0"\)/,
    "deposits API must not call BigInt directly on stored blockNumber strings",
  );
  assert.match(
    depositsRouteSource,
    /function parseStoredEpochNumber/,
    "deposits API must parse stored epochs safely for sorting and inline rewards",
  );
  assert.doesNotMatch(
    depositsRouteSource,
    /Number\(b\.epoch\)\s*-\s*Number\(a\.epoch\)/,
    "deposits API must not sort using unchecked stored epoch numbers",
  );
  const storageSource = readFileSync("server/storage.ts", "utf8");
  assert.match(
    storageSource,
    /function isSafePositiveInteger/,
    "storage helpers must centralize safe positive integer checks for epoch ids",
  );
  assert.match(
    storageSource,
    /function parseSafePositiveIntegerString/,
    "storage writes must parse string epoch and block numbers before SQL writes",
  );
  assert.doesNotMatch(
    storageSource,
    /Number\.isInteger\(epoch\)\s*&&\s*epoch\s*>\s*0/,
    "storage helpers must reject unsafe epoch numbers, not only integer-looking values",
  );
  assert.doesNotMatch(
    storageSource,
    /Number\(row\.(?:epoch|blockNumber)\)/,
    "storage upserts must not write unvalidated row epoch or blockNumber values",
  );
  const dataBridgeSource = readFileSync("app/api/_lib/dataBridge.ts", "utf8");
  assert.match(
    dataBridgeSource,
    /export function isSafePositiveInteger/,
    "API data bridge must expose a safe positive integer guard for epoch values",
  );
  assert.doesNotMatch(
    dataBridgeSource,
    /Number\.isInteger\(n\)|Number\.isInteger\(epoch\)/,
    "API data bridge must reject unsafe epoch numbers",
  );
  const rewardSummarySource = readFileSync("app/api/_lib/rewardSummary.ts", "utf8");
  assert.match(
    rewardSummarySource,
    /isSafePositiveInteger/,
    "reward summary must use safe epoch integer filtering",
  );
  const epochsRouteSource = readFileSync("app/api/epochs/route.ts", "utf8");
  assert.match(
    epochsRouteSource,
    /isSafePositiveInteger/,
    "epochs API must use safe epoch integer filtering",
  );
  assert.doesNotMatch(
    epochsRouteSource,
    /Number\.isInteger\(epoch\)/,
    "epochs API must reject unsafe epoch numbers",
  );
  const betPanelSource = readFileSync("app/components/BetPanel.tsx", "utf8");
  assert.match(
    betPanelSource,
    /className="console-input lore-nums h-9 px-3 text-base font-black"/,
    "manual bet amount input must use the shared numeric font class",
  );
  assert.match(
    betPanelSource,
    /SmallInput[\s\S]*console-input lore-nums/,
    "auto-miner numeric inputs must keep the shared numeric font class",
  );
  assert.match(
    betPanelSource,
    /data-testid="manual-bet-action"/,
    "manual bet primary action must expose a stable smoke-test selector",
  );
  assert.match(
    betPanelSource,
    /data-testid="auto-miner-action"/,
    "auto-miner primary action must expose a stable smoke-test selector",
  );
  assert.match(
    betPanelSource,
    /showAutoMineProgress[\s\S]*autoMinePhase === "retry-wait"[\s\S]*autoMinePhase === "session-expired"/,
    "auto-miner recovery states must keep the progress message visible after the active loop pauses",
  );
  assert.match(
    betPanelSource,
    /showAutoMineProgress && phaseProgressText/,
    "auto-miner progress card must use the shared recovery progress visibility guard",
  );
  const walletTransferRowSource = readFileSync("app/components/wallet/WalletTransferRow.tsx", "utf8");
  assert.match(
    walletTransferRowSource,
    /className="lore-nums h-8 min-w-0 px-4 py-1\.5 text-sm"/,
    "wallet transfer amount inputs must use the shared numeric font class",
  );
  assert.match(
    walletTransferRowSource,
    /maxLength=\{20\}/,
    "wallet transfer amount inputs must keep the same bounded length as manual bet amount input",
  );
  assert.match(
    walletTransferRowSource,
    /onChange\(e\.target\.value\.slice\(0, 20\)\)/,
    "wallet transfer amount changes must clamp pasted values before state update",
  );
  const walletTransferPanelsSource = readFileSync("app/components/wallet/WalletSettingsTransferPanels.tsx", "utf8");
  assert.match(
    walletTransferPanelsSource,
    /lore-nums[\s\S]*totalIn/,
    "wallet transfer summary totals must use the shared numeric font class",
  );
  const pendingTxPanelSource = readFileSync("app/components/wallet/WalletSettingsPendingTxPanel.tsx", "utf8");
  assert.match(
    pendingTxPanelSource,
    /Check latest and pending nonces/,
    "pending tx check action must explain what it inspects",
  );
  assert.match(
    pendingTxPanelSource,
    /Run Check first; available only when a stuck nonce is detected/,
    "pending tx clear action must explain why it is disabled",
  );
  const headerPoolChartSource = readFileSync("app/components/header/HeaderPoolChart.tsx", "utf8");
  assert.match(
    headerPoolChartSource,
    /EMPTY_POOL_LINE_PATH/,
    "pool chart must keep a visible empty-state path when there are no bets",
  );
  assert.match(
    headerPoolChartSource,
    /const showChartVisual\s*=\s*true/,
    "pool chart visual must remain mounted for empty no-bet epochs",
  );
  assert.match(
    headerPoolChartSource,
    /data-testid="header-pool-chart-line"/,
    "pool chart line must expose a stable selector for browser smoke",
  );
  assert.equal(
    explorerLinks.getExplorerTxUrl(`0x${"a".repeat(64)}`),
    `https://sepolia.lineascan.build/tx/0x${"a".repeat(64)}`,
  );
  assert.equal(explorerLinks.getExplorerTxUrl("0x1234"), null);
  assert.equal(
    explorerLinks.getExplorerAddressUrl("0x0000000000000000000000000000000000000001"),
    "https://sepolia.lineascan.build/address/0x0000000000000000000000000000000000000001",
  );
  assert.equal(explorerLinks.getExplorerAddressUrl("bad-address"), null);
  const walletActionsSource = readFileSync("app/hooks/useWalletActions.ts", "utf8");
  assert.match(
    walletActionsSource,
    /getExplorerTxUrl/,
    "wallet transfer and claim notifications must include explorer links when a tx hash is available",
  );
  assert.match(
    walletActionsSource,
    /formatTxStatusMessage/,
    "wallet actions must share tx status message formatting",
  );
  const globalErrorSource = readFileSync("app/global-error.tsx", "utf8");
  assert.match(
    globalErrorSource,
    /Hard reload/,
    "global error boundary must expose a hard reload fallback when app shell reset is not enough",
  );
  const errorCatcherSource = readFileSync("app/components/ErrorCatcher.tsx", "utf8");
  assert.match(
    errorCatcherSource,
    /isPrivyAuthSessionTimeout/,
    "global error catcher must classify transient Privy session timeouts",
  );
  assert.match(
    errorCatcherSource,
    /auth\.privy\.io\/api\/v1\/sessions/,
    "global error catcher must specifically target Privy session creation timeouts",
  );
  assert.match(
    errorCatcherSource,
    /stopImmediatePropagation/,
    "global error catcher must stop Next dev overlay for handled Privy auth timeouts",
  );
  const lineaOreClientSource = readFileSync("app/LineaOreClient.tsx", "utf8");
  assert.match(
    lineaOreClientSource,
    /dynamic\(\s*\(\)\s*=>\s*import\("\.\/components\/FirstVisitTutorial"\)/,
    "first-visit tutorial must stay lazy-loaded out of the main app client chunk",
  );
  assert.doesNotMatch(
    lineaOreClientSource,
    /import\s+\{\s*FirstVisitTutorial\s*\}\s+from\s+"\.\/components\/FirstVisitTutorial"/,
    "first-visit tutorial must not be statically imported by LineaOreClient",
  );
  const headerSource = readFileSync("app/components/Header.tsx", "utf8");
  assert.match(
    headerSource,
    /loginPending/,
    "wallet connect header must expose an in-flight login state after the user clicks connect",
  );
  const headerWalletConnectSource = readFileSync("app/components/header/HeaderWalletCard.tsx", "utf8");
  assert.match(
    headerWalletConnectSource,
    /loginError/,
    "wallet connect card must show login failures instead of silently swallowing them",
  );
  assert.equal(
    eip7702.parseEip7702DelegationCode("0xef0100170067a88e64bba842ae6615ab277493de32629a"),
    "0x170067A88E64bbA842AE6615AB277493De32629A",
  );
  assert.equal(eip7702.parseEip7702DelegationCode("0x"), null);

  assert.equal(utils.normalizeDecimalInput("1,25"), "1.25");
  assert.equal(utils.validateBetAmount(""), "Enter an amount");
  assert.equal(utils.validateBetAmount("   "), "Enter an amount");
  assert.equal(utils.validateBetAmount("0"), "Amount must be greater than 0");
  assert.equal(utils.validateBetAmount("-1"), "Amount must be greater than 0");
  assert.equal(utils.validateBetAmount("1e3"), "Invalid amount");
  assert.equal(utils.validateBetAmount("1.2.3"), "Invalid amount");
  assert.equal(utils.validateBetAmount("1,25"), null);
  assert.equal(utils.validateBetAmount("0.0001"), null);
  assert.equal(utils.validateBetAmount("0.0000000000000000001"), "Use 18 decimals or fewer");
  assert.equal(utils.isUserRejection(new Error("User rejected the request")), true);
  assert.equal(utils.isUserRejection({ code: 4001, message: "wallet request closed" }), true);
  assert.equal(utils.isUserRejection({ code: "ACTION_REJECTED" }), true);
  assert.equal(utils.isUserRejection({ cause: { code: 4001 } }), true);
  assert.equal(utils.isUserRejection({ details: "User denied transaction signature" }), true);
  assert.equal(utils.isUserRejection({ code: -32000, message: "replacement transaction underpriced" }), false);

  assert.equal(utils.safeParseFloat("1.5"), 1.5);
  assert.equal(utils.safeParseFloat("1e309"), 0);
  assert.equal(utils.safeParseFloat("NaN"), 0);
  assert.equal(utils.safeToFixed(12.345, 2), "12.35");
  assert.equal(utils.safeToFixed(Number.NaN, 2), "0.00");
  assert.equal(utils.safeToFixed(Number.POSITIVE_INFINITY, 2, "fallback"), "fallback");
  assert.equal(safetyPoolClaimThreshold.parseMinSafetyPoolClaimWei("100"), 100_000_000_000_000_000_000n);
  assert.equal(safetyPoolClaimThreshold.parseMinSafetyPoolClaimWei("bad"), 100_000_000_000_000_000_000n);
  assert.equal(safetyPoolClaimThreshold.isSafetyPoolClaimBelowMinimum(1n, 2n), true);
  assert.deepEqual(
    miningShared.sanitizePersistedAutoMinerSession({
      active: true,
      betStr: "1.5",
      blocks: 3,
      rounds: 5,
      nextRoundIndex: 2,
      lastPlacedEpoch: "10",
    }),
    {
      active: true,
      betStr: "1.5",
      blocks: 3,
      rounds: 5,
      nextRoundIndex: 2,
      lastPlacedEpoch: "10",
    },
  );
  assert.equal(
    miningShared.sanitizePersistedAutoMinerSession({
      active: true,
      betStr: "1e3",
      blocks: 3,
      rounds: 5,
      nextRoundIndex: 2,
      lastPlacedEpoch: "10",
    }),
    null,
  );
  assert.equal(
    miningShared.sanitizePersistedAutoMinerSession({
      active: true,
      betStr: "1",
      blocks: 26,
      rounds: 5,
      nextRoundIndex: 2,
      lastPlacedEpoch: "10",
    }),
    null,
  );
  assert.equal(
    miningShared.sanitizePersistedAutoMinerSession({
      active: true,
      betStr: "1",
      blocks: 3,
      rounds: 5,
      nextRoundIndex: 6,
      lastPlacedEpoch: "10",
    }),
    null,
  );
  assert.deepEqual(
    miningShared.sanitizeTabLock({ id: "tab-1", ts: 123, tx: "nonce-1" }),
    { id: "tab-1", ts: 123, tx: "nonce-1" },
  );
  assert.deepEqual(
    miningShared.sanitizeTabLock({ id: "tab-1", ts: 123, tx: 999 }),
    { id: "tab-1", ts: 123 },
  );
  assert.equal(miningShared.sanitizeTabLock({ id: "", ts: 123 }), null);
  assert.equal(miningShared.sanitizeTabLock({ id: "tab-1", ts: Number.NaN }), null);
  assert.equal(miningShared.sanitizeTabLock({ id: "tab-1", ts: Date.now() + 60_000 }), null);

  const normalizedDuplicateTiles = tokenAmountMath.normalizeTileAmounts(
    [2, 2, 5],
    ["1000000000000000.123456789123456789", "0.876543210876543211", "1"],
    "1000000000000002",
  );
  assert.deepEqual(normalizedDuplicateTiles, {
    tileIds: [2, 5],
    amounts: ["1000000000000001", "1"],
  });
  assert.equal(
    tokenAmountMath.computeWinningAmountWei(
      [1, 2, 3],
      undefined,
      2,
      "3000000000000000.000000000000000003",
    ),
    1_000_000_000_000_000_000_000_000_000_000_000n + 1n,
  );
  assert.equal(
    tokenAmountMath.computeWinningAmountWei([1, 2, 2], ["1", "2", "3"], 2, "999"),
    5_000_000_000_000_000_000n,
  );
  assert.equal(tokenAmountMath.parseLineaAmountWei("not-a-number"), 0n);
  assert.equal(tokenAmountMath.parsePositiveLineaAmountWei("0"), null);
  assert.equal(tokenAmountMath.parsePositiveLineaAmountWei("0.0000000000000000001"), null);
  assert.equal(tokenAmountMath.parsePositiveLineaAmountWei("1.25"), 1_250_000_000_000_000_000n);
  assert.equal(tokenAmountMath.parsePositiveLineaAmountWeiOrFallback("bad", "1"), 1_000_000_000_000_000_000n);
  assert.equal(tokenAmountMath.parsePositiveLineaAmountWeiOrFallback("0", "1"), 1_000_000_000_000_000_000n);
  assert.equal(tokenAmountMath.parsePositiveLineaAmountWeiOrFallback("2.5", "1"), 2_500_000_000_000_000_000n);
  assert.equal(tokenAmountMath.formatLineaWeiAmountDisplay("bad", 4), "0.0000");
  assert.equal(tokenAmountMath.formatLineaWeiAmountDisplay("1000000000000000000", 2), "1.00");
  assert.equal(tokenAmountMath.formatLineaWeiAmountDisplay("2500000000000000000", 1), "2.5");
  assert.equal(tokenAmountMath.formatLineaWeiAmountDisplay("1234567890000000000000", 2), "1,234.57");
  assert.equal(tokenAmountMath.formatLineaAmountFixed(1_234_567_899_000_000_000n, 2), "1.23");
  assert.equal(tokenAmountMath.formatLineaAmountFixed(1_235_000_000_000_000_000n, 2), "1.24");
  assert.equal(tokenAmountMath.formatLineaAmountFixed(999_999_999_999_999_999n, 0), "1");
  assert.deepEqual(
    miningTxPath.sanitizeMiningTxPathState({ mode: "standard-silent", reason: "ok", ts: 123 }),
    { mode: "standard-silent", reason: "ok", ts: 123 },
  );
  assert.deepEqual(
    miningTxPath.sanitizeMiningTxPathState({ mode: "wallet-write", reason: 999, ts: 123 }),
    { mode: "wallet-write", ts: 123 },
  );
  assert.equal(miningTxPath.sanitizeMiningTxPathState({ mode: "bad", ts: 123 }), null);
  assert.equal(miningTxPath.sanitizeMiningTxPathState({ mode: "standard-silent", ts: Number.NaN }), null);
  assert.equal(miningTxPath.sanitizeMiningTxPathState({ mode: "standard-silent", ts: Date.now() + 60_000 }), null);
  assert.equal(miningTxPath.sanitizeMiningTxPathState({ mode: "7702-delegated", ts: 123 }), null);
  assert.deepEqual(
    miningTxPath.sanitizeMiningTxPathState({ mode: "7702-delegated", ts: 123 }, { allowDelegated7702: true }),
    { mode: "7702-delegated", ts: 123 },
  );
  assert.equal(walletTransfers.getWalletTransferScanFromBlock(10n, 1n), 1n);
  assert.equal(walletTransfers.getWalletTransferScanFromBlock(10n, 7n), 7n);
  assert.equal(walletTransfers.getWalletTransferScanFromBlock(10n, 11n), null);
  assert.equal(walletTransfers.getWalletTransferFallbackFromBlock(1n, 100n, 250n), 1n);
  assert.equal(walletTransfers.getWalletTransferFallbackFromBlock(1n, 1000n, 250n), 751n);
  assert.deepEqual(
    pageWalletOverview.normalizeCachedPrivyBalances({ token: "12.3", eth: "0.0925" }),
    { token: "12.30", eth: "0.0925" },
  );
  assert.deepEqual(
    pageWalletOverview.normalizeCachedPrivyBalances({ token: "bad", eth: "-1" }),
    { token: "0.00", eth: "0.0000" },
  );
  assert.deepEqual(
    autoMinerForm.sanitizeAutoMinerInputs({ betSize: "2.5", targets: 7, cycles: 12 }),
    { betSize: "2.5", targets: 7, cycles: 12 },
  );
  assert.deepEqual(
    autoMinerForm.sanitizeAutoMinerInputs({ betSize: "bad", targets: 99, cycles: 1_000_000 }),
    { betSize: "1.0", targets: 25, cycles: 5000 },
  );
  assert.deepEqual(
    autoMinerForm.sanitizeAutoMinerInputs({ targets: 2.9, cycles: 0 }),
    { betSize: "1.0", targets: 2, cycles: 1 },
  );
  assert.deepEqual(
    ["10", "2", "bad"].sort(analyticsAchievements.compareAchievementEpochs),
    ["bad", "2", "10"],
  );
  assert.doesNotThrow(() => analyticsAchievements.compareAchievementEpochs("bad", "2"));
  const analyticsAchievementsSource = readFileSync("app/hooks/useAnalyticsAchievements.ts", "utf8");
  assert.match(
    analyticsAchievementsSource,
    /function parseAchievementEpochNumber/,
    "analytics achievements must parse deposit epoch strings safely for first-bet ordering",
  );
  assert.doesNotMatch(
    analyticsAchievementsSource,
    /(^|[^A-Za-z])Number\(left\.epoch\)|(^|[^A-Za-z])Number\(right\.epoch\)/,
    "analytics achievements must not use unchecked Number(epoch) in first-bet ordering",
  );
  assert.deepEqual(
    autoResolveStorage.normalizeResolveGuardEntry({ epoch: "42", ts: 123 }),
    { epoch: "42", ts: 123 },
  );
  assert.deepEqual(
    autoResolveStorage.normalizeResolveGuardEntry({ epoch: "42", ts: Number.NaN }),
    { epoch: "42", ts: 0 },
  );
  assert.equal(autoResolveStorage.normalizeResolveGuardEntry({ epoch: "bad", ts: 123 }), null);
  const normalizedNames = addressNames.normalizeCachedAddressNames({
    names: {
      "0x0000000000000000000000000000000000000001": " Alice ",
      "not-an-address": "Skip",
    },
    fetchedAt: 1000,
  }, 2000);
  assert.deepEqual(
    normalizedNames ? Object.fromEntries(normalizedNames.map.entries()) : null,
    { "0x0000000000000000000000000000000000000001": "Alice" },
  );
  assert.equal(normalizedNames?.fetchedAt, 1000);
  assert.equal(addressNames.normalizeCachedAddressNames({ names: {}, fetchedAt: Number.NaN }, 2000), null);
  assert.equal(addressNames.normalizeCachedAddressNames({ names: {}, fetchedAt: 10_000 }, 2000), null);
  assert.equal(liveStateSnapshot.isLiveStateSnapshotFresh(1_000, 2_000), true);
  assert.equal(liveStateSnapshot.isLiveStateSnapshotFresh(2_000 + 6_000, 2_000), false);
  assert.equal(liveStateSnapshot.isLiveStateSnapshotFresh(2_000 - 13 * 60 * 60 * 1000, 2_000), false);
  assert.equal(cacheTimestamp.normalizeCacheTimestamp(1_000, 2_000), 1_000);
  assert.equal(cacheTimestamp.normalizeCacheTimestamp(Number.NaN, 2_000), null);
  assert.equal(cacheTimestamp.normalizeCacheTimestamp(2_000 + 6_000, 2_000), null);
  const normalizedGlobalStats = globalStats.normalizeGlobalStatsAccumulator({
    volumeRaw: "100",
    burnRaw: "2",
    resolvedEpochs: 3,
    lastScannedEpoch: 4,
    lastScannedBlock: "5",
  });
  assert.deepEqual(normalizedGlobalStats, {
    volumeRaw: 100n,
    burnRaw: 2n,
    resolvedEpochs: 3,
    lastScannedEpoch: 4,
    lastScannedBlock: "5",
  });
  assert.equal(globalStats.normalizeGlobalStatsAccumulator({ volumeRaw: "-1", resolvedEpochs: 0, lastScannedEpoch: 0, lastScannedBlock: "1" }), null);
  assert.equal(
    globalStats.normalizeGlobalStatsAccumulator({
      volumeRaw: "1",
      resolvedEpochs: Number.MAX_SAFE_INTEGER + 1,
      lastScannedEpoch: 1,
      lastScannedBlock: "1",
    }),
    null,
  );
  assert.equal(globalStats.getUsableGlobalStatsAccumulator(normalizedGlobalStats, 3), null);
  assert.deepEqual(globalStats.getUsableGlobalStatsAccumulator(normalizedGlobalStats, 4), normalizedGlobalStats);
  const globalStatsSource = readFileSync("app/hooks/useGlobalStats.ts", "utf8");
  assert.match(
    globalStatsSource,
    /epochToFetch\s*>\s*BigInt\(Number\.MAX_SAFE_INTEGER\)/,
    "global stats must not coerce unsafe bigint epochs to Number",
  );
  const mappedDeposits = depositHistory.mapDepositEntries(
    [
      {
        epoch: "42",
        tileIds: [2, 2, 5],
        amounts: ["1000000000000000.123456789123456789", "0.876543210876543211", "1"],
        totalAmount: "1000000000000002",
        totalAmountNum: 1000000000000002,
        txHash: "0xabc",
        blockNumber: "7",
      },
    ],
    {
      "42": {
        winningTile: 2,
        rewardPool: "500",
        isDailyJackpot: false,
        isWeeklyJackpot: false,
      },
    },
    {
      "42": {
        reward: "100",
        winningTile: 2,
        rewardPool: "500",
        winningTilePool: "1000000000000001",
        userWinningAmount: "1000000000000001",
      },
    },
  );
  assert.deepEqual(mappedDeposits[0].tileIds, [2, 5]);
  assert.equal(mappedDeposits[0].amount, "1000000000000002.00");
  assert.equal(mappedDeposits[0].reward, 100);
  assert.equal(
    depositHistory.mapDepositEntries(
      [
        {
          epoch: "bad",
          tileIds: [1],
          amounts: ["1"],
          totalAmount: "1",
          totalAmountNum: 1,
          txHash: "0xbad",
          blockNumber: "bad",
        },
      ],
      {},
      {},
    )[0].blockNumberNum,
    0,
  );
  assert.deepEqual(depositHistory.normalizeApiDeposits("bad-shape"), []);
  assert.deepEqual(
    depositHistory.normalizeApiDeposits([
      {
        epoch: "1",
        tileIds: [1],
        totalAmount: "10",
        totalAmountNum: 10,
        txHash: "0xabc",
        blockNumber: "2",
      },
      null,
    ]),
    [
      {
        epoch: "1",
        tileIds: [1],
        totalAmount: "10",
        totalAmountNum: 10,
        txHash: "0xabc",
        blockNumber: "2",
      },
    ],
  );
  assert.deepEqual(jackpotHistory.normalizeEntries("bad-shape"), []);
  const depositHistorySource = readFileSync("app/hooks/useDepositHistory.ts", "utf8");
  assert.doesNotMatch(
    depositHistorySource,
    /Number\(b\.epoch\)\s*-\s*Number\(a\.epoch\)/,
    "deposit history must not sort with unchecked epoch numbers",
  );
  const jackpotHistorySource = readFileSync("app/hooks/useJackpotHistory.ts", "utf8");
  assert.doesNotMatch(
    jackpotHistorySource,
    /Number\(b\.epoch\)\s*-\s*Number\(a\.epoch\)/,
    "jackpot history must not sort with unchecked epoch numbers",
  );
  assert.deepEqual(recentWins.normalizeWins("bad-shape"), []);
  assert.deepEqual(
    recentWins.normalizeWins([
      { epoch: "11", user: "0x1", amount: "2.00", amountRaw: "2000000000000000000", tileId: 3 },
      { epoch: "12", user: "", amountRaw: "1" },
    ]),
    [{ epoch: "11", user: "0x1", amount: "2.00", amountRaw: "2000000000000000000", tileId: 3 }],
  );
  assert.deepEqual(
    leaderboards.normalizeLeaderboardsData({
      biggestSingleWin: [{ rank: 1, address: "0x1", value: "10", valueNum: 10 }],
      luckiest: "stale-bad-shape",
      oneTileWonder: [],
      whales: [],
      luckyTile: [{ tileId: 7, wins: 2, pct: 20 }],
    }),
    {
      biggestSingleWin: [{ rank: 1, address: "0x1", value: "10", valueNum: 10 }],
      luckiest: [],
      oneTileWonder: [],
      mostWins: [],
      whales: [],
      underdog: [],
      luckyTile: [{ tileId: 7, wins: 2, pct: 20 }],
    },
  );
  assert.deepEqual(
    leaderboards.normalizeLeaderboardsData({
      biggestSingleWin: [
        { rank: "1", address: "0x1", value: 10, valueNum: "bad", extra: 7 },
        { rank: 2, address: "", value: "skip", valueNum: 1 },
      ],
      luckyTile: [
        { tileId: 3, wins: "bad", pct: "bad" },
        { tileId: 4, wins: 2, pct: 20 },
      ],
    }).biggestSingleWin,
    [{ rank: 1, address: "0x1", value: "10", valueNum: 0, extra: "7" }],
  );
  assert.deepEqual(
    leaderboards.normalizeLeaderboardsData({
      luckyTile: [
        { tileId: 3, wins: "bad", pct: "bad" },
        { tileId: 4, wins: 2, pct: 20 },
        { tileId: Number.MAX_SAFE_INTEGER + 1, wins: 1, pct: 1 },
      ],
    }).luckyTile,
    [{ tileId: 4, wins: 2, pct: 20 }],
  );
  const leaderboardsSource = readFileSync("app/hooks/useLeaderboards.ts", "utf8");
  assert.match(
    leaderboardsSource,
    /Number\.isSafeInteger\(tileId\)/,
    "leaderboards lucky tile normalizer must reject unsafe tile ids",
  );
  assert.deepEqual(
    rebate.normalizeRebatePayload({
      isSupported: true,
      pendingRebateWei: "1000",
      claimableEpochCount: 2,
      claimableEpochList: "bad-shape",
      totalEpochs: 3,
      participatingEpochs: [9, "bad", 10],
      recentEpochs: null,
    }),
    {
      isSupported: true,
      pendingRebateWei: "1000",
      claimableEpochCount: 2,
      claimableEpochList: [],
      totalEpochs: 3,
      participatingEpochs: [9, 10],
      recentEpochs: [],
    },
  );
  assert.deepEqual(
    rebate.normalizeRebatePayload({
      pendingRebateWei: "bad",
      recentEpochs: [{ epoch: 5, pendingWei: "bad", userVolumeWei: "also-bad", rebatePoolWei: "7" }],
    }).recentEpochs,
    [{ epoch: 5, pendingWei: "0", pending: "0", claimed: false, resolved: false, userVolumeWei: "0", rebatePoolWei: "7" }],
  );
  assert.equal(
    rebate.normalizeRebatePayload({ pendingRebateWei: "bad" }).pendingRebateWei,
    "0",
  );

  const rewardScanNow = 1_000_000;
  assert.equal(rewardScanner.normalizeRewardScanEpochString("42"), "42");
  assert.equal(rewardScanner.normalizeRewardScanEpochString("bad"), null);
  assert.deepEqual(
    rewardScanner.normalizeRewardScanWins([
      { epoch: "12", amountWei: "1000" },
      { epoch: "bad", amountWei: "1000" },
      { epoch: "13", amountWei: "bad" },
    ]),
    [{ epoch: "12", amountWei: "1000" }],
  );
  assert.deepEqual(
    [
      { epoch: "10", amountWei: "1" },
      { epoch: "bad", amountWei: "1" },
      { epoch: "2", amountWei: "1" },
    ].sort(rewardScanner.compareRewardScanWinsDesc),
    [
      { epoch: "10", amountWei: "1" },
      { epoch: "2", amountWei: "1" },
      { epoch: "bad", amountWei: "1" },
    ],
  );
  assert.equal(rewardScanner.getRewardScanRescanDelayMs(null, rewardScanNow), 0);
  assert.equal(rewardScanner.getRewardScanRescanDelayMs(rewardScanNow - 14 * 60_000, rewardScanNow), 60_000);
  assert.equal(rewardScanner.getRewardScanRescanDelayMs(rewardScanNow - 15 * 60_000, rewardScanNow), 0);
  assert.equal(rewardScanner.getRewardScanRescanDelayMs(rewardScanNow + 1, rewardScanNow), 0);
  const rewardScannerSource = readFileSync("app/hooks/useRewardScanner.ts", "utf8");
  assert.match(
    rewardScannerSource,
    /MAX_SCAN_DEPTH\s*=\s*BigInt\(5000\)/,
    "automatic reward scan depth must remain at 5000 epochs",
  );
  assert.match(
    rewardScannerSource,
    /getExplorerTxUrl/,
    "single reward claim notifications must include explorer links when a tx hash is available",
  );
  assert.match(
    rewardScannerSource,
    /lastRewardClaimTxHash/,
    "batch reward claim notifications must keep the latest tx hash for explorer links",
  );
  const deepRewardScanSource = readFileSync("app/hooks/useDeepRewardScan.ts", "utf8");
  assert.match(
    deepRewardScanSource,
    /getExplorerTxUrl/,
    "deep reward claim notifications must include explorer links when a tx hash is available",
  );
  const liveStateSharedSource = readFileSync("app/api/live-state/shared.ts", "utf8");
  assert.match(
    liveStateSharedSource,
    /isSafePositiveInteger/,
    "live-state bootstrap must use safe current epoch validation",
  );
  assert.match(
    liveStateSharedSource,
    /function parseStoredBlockNumber/,
    "live-state jackpot fallback must parse stored block numbers safely",
  );
  assert.doesNotMatch(
    liveStateSharedSource,
    /BigInt\([^)]*blockNumber\s*\|\|\s*"0"[^)]*\)/,
    "live-state must not BigInt-parse unchecked stored block numbers",
  );
  assert.doesNotMatch(
    liveStateSharedSource,
    /Number\.isInteger\(storedCurrentEpoch\)/,
    "live-state stored current epoch check must reject unsafe integers",
  );
  const jackpotsServiceSource = readFileSync("app/api/_lib/jackpotsService.ts", "utf8");
  assert.match(
    jackpotsServiceSource,
    /function parseStoredBlockNumber/,
    "jackpot service must parse stored block numbers safely",
  );
  assert.match(
    jackpotsServiceSource,
    /isSafePositiveInteger/,
    "jackpot service must use safe epoch validation",
  );
  assert.doesNotMatch(
    jackpotsServiceSource,
    /BigInt\([^)]*(?:row\.blockNumber|blockNumber|a\.blockNumber|b\.blockNumber)[^)]*\)/,
    "jackpot service must not BigInt-parse unchecked stored block numbers",
  );
  const walletDeepScanPanelSource = readFileSync("app/components/wallet/WalletSettingsDeepScanPanel.tsx", "utf8");
  assert.match(
    walletDeepScanPanelSource,
    /formatLineaWeiAmountDisplay/,
    "deep reward scan rows must use the shared safe wei amount formatter",
  );
  const rebateSource = readFileSync("app/hooks/useRebate.ts", "utf8");
  assert.match(
    rebateSource,
    /getExplorerTxUrl/,
    "Safety Pool claim notifications must include an explorer link when a tx hash is available",
  );
  assert.match(
    rebateSource,
    /Number\.isSafeInteger\(item\)/,
    "Safety Pool client must reject unsafe epoch numbers from API and cache payloads",
  );
  assert.doesNotMatch(
    rebateSource,
    /Number\.isInteger\(item\)/,
    "Safety Pool client must not accept unsafe epoch integers",
  );
  assert.match(
    rebateSource,
    /X-Rebate-Cache/,
    "Safety Pool client must surface stale/inflight API cache status to the UI",
  );
  assert.match(
    rebateSource,
    /dataFreshness/,
    "Safety Pool info must expose data freshness for degraded-state UI hints",
  );
  const rebatePanelSource = readFileSync("app/components/RebatePanel.tsx", "utf8");
  assert.match(
    rebatePanelSource,
    /data-testid="rebate-freshness-hint"/,
    "Safety Pool panel must show a stable visible freshness hint when serving stale data",
  );
  const rebatesRouteSource = readFileSync("app/api/rebates/route.ts", "utf8");
  assert.match(
    rebatesRouteSource,
    /isSafePositiveInteger/,
    "rebates API must use safe epoch validation for indexed and chain epochs",
  );
  assert.doesNotMatch(
    rebatesRouteSource,
    /Number\.isInteger\(currentEpoch\)/,
    "rebates API cache key must reject unsafe currentEpoch values",
  );
  assert.match(
    rebatesRouteSource,
    /rebateCacheWatermarks/,
    "rebates API must track indexed-data watermarks to avoid repeated slow background rebuilds",
  );
  assert.match(
    rebatesRouteSource,
    /shouldSkip:[\s\S]*REBATE_UNCHANGED_WATERMARK_REFRESH_MS/,
    "rebates API stale refresh must skip unchanged indexed-data watermarks for a bounded interval",
  );
  const liveRoundCanarySource = readFileSync("scripts/live-round-canary.ts", "utf8");
  assert.match(
    liveRoundCanarySource,
    /LIVE_TEST_RANDOMIZE_ROUNDS/,
    "live canary must support randomized stress rounds for amount/tile coverage",
  );
  assert.match(
    liveRoundCanarySource,
    /LIVE_TEST_MIN_TOTAL_BET_AMOUNT/,
    "live canary stress mode must configure a minimum total bet amount per tx",
  );
  assert.match(
    liveRoundCanarySource,
    /LIVE_TEST_MAX_TOTAL_BET_AMOUNT/,
    "live canary stress mode must configure a maximum total bet amount per tx",
  );
  assert.match(
    liveRoundCanarySource,
    /targetTotalAmount/,
    "live canary logs must preserve requested total amount before per-tile normalization",
  );
  assert.match(
    liveRoundCanarySource,
    /tileCount/,
    "live canary logs must include tile count for stress analysis",
  );
  assert.match(
    liveRoundCanarySource,
    /LIVE_TEST_VERBOSE_WALLETS/,
    "live canary must keep detailed wallet inventory behind an explicit opt-in",
  );
  assert.match(
    liveRoundCanarySource,
    /walletPreflight ready=.*roles=.*\n.*if \(VERBOSE_WALLET_PREFLIGHT\) console\.table\(rows\)/s,
    "live canary must default to a redacted wallet preflight summary",
  );

  const indexerSource = readFileSync("scripts/indexer.ts", "utf8");
  assert.match(
    indexerSource,
    /function filterLogsByTopics[\s\S]*topics\.every/,
    "indexer reconciliation must locally verify every requested topic",
  );
  assert.match(
    indexerSource,
    /fetchAllLogs[\s\S]*fetchLogsRequestAdaptiveSplit\(\[\], "ContractEvents"/,
    "indexer must fetch each contract chunk once instead of duplicating raw topic queries",
  );
  assert.match(
    indexerSource,
    /const REPAIR_CHUNK_BLOCKS = 10_000n/,
    "indexer repair must stay within the confirmed Sepolia RPC log range",
  );
  assert.match(
    liveRoundCanarySource,
    /afterEpoch\?: bigint \| null[\s\S]*window\.epoch > params\.afterEpoch[\s\S]*lastAttemptedEpoch = epoch/,
    "canary must require a strictly newer epoch before every transaction attempt",
  );
  const walletPlaytestSource = readFileSync("scripts/playtest-wallet.ts", "utf8");
  assert.match(
    walletPlaytestSource,
    /rpcCount=\$\{rpcUrls\.length\}/,
    "wallet playtest must report only RPC count by default",
  );
  assert.doesNotMatch(
    walletPlaytestSource,
    /rpc=\$\{rpcUrls\[0\]\}|depositsJson:|rebatesJson:/,
    "wallet playtest must not print raw RPC URLs or API payloads",
  );
  const restoreProofSource = readFileSync("scripts/verify-db-restore.mjs", "utf8");
  assert.match(
    restoreProofSource,
    /mkdirSync\(dirname\(restoreMain\), \{ recursive: true \}\);\s*copyFileSync\(backupMain, restoreMain\)/,
    "restore drill must create its target directory before copying the backup",
  );
  const previousWindow = globalThis.window;
  try {
    const storage = new Map();
    globalThis.window = {
      localStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key),
      },
    };
    const snapshotKey = liveStateSnapshot.getLiveStateSnapshotKey();
    storage.set(snapshotKey, JSON.stringify({ currentEpoch: "7", fetchedAt: Date.now() - 13 * 60 * 60 * 1000 }));
    assert.equal(liveStateSnapshot.loadLiveStateSnapshot(), null);
    storage.set(snapshotKey, JSON.stringify({ currentEpoch: "8", fetchedAt: Date.now() }));
    assert.deepEqual(liveStateSnapshot.loadLiveStateSnapshot()?.currentEpoch, "8");
  } finally {
    globalThis.window = previousWindow;
  }
  assert.equal(safetyPoolClaimThreshold.isSafetyPoolClaimBelowMinimum(2n, 2n), false);
  assert.equal(safetyPoolClaimThreshold.isSafetyPoolClaimBelowMinimum(0n, 2n), false);
  assert.equal(analyticsDepositsStatus.formatDepositFreshnessLabel(null, 10_000), null);
  assert.equal(analyticsDepositsStatus.formatDepositFreshnessLabel(9_500, 10_000), "Updated now");
  assert.equal(analyticsDepositsStatus.formatDepositFreshnessLabel(40_000, 100_000), "Updated 1m ago");
  assert.equal(analyticsDepositsStatus.formatDepositFreshnessLabel(100_000, 360_000), "Updated 4m ago");

  assert.equal(
    chatAvatarUpload.validateCustomAvatarFile({ type: "text/plain", size: 42 }),
    "Use a JPG, PNG, GIF, or WEBP image.",
  );
  assert.equal(
    chatAvatarUpload.validateCustomAvatarFile({ type: "image/png", size: 5 * 1024 * 1024 + 1 }),
    "Image must be 5 MB or smaller.",
  );
  assert.equal(chatAvatarUpload.validateCustomAvatarFile({ type: "image/webp", size: 2048 }), null);
  assert.deepEqual(chatMessages.normalizeChatMessages("bad-shape"), []);
  assert.deepEqual(
    chatMessages.normalizeChatMessages([
      { id: "b", text: "second", sender: "0x2", senderName: 2, senderAvatar: "bad", timestamp: 2 },
      { id: "a", text: "first", sender: "0x1", senderName: "Lore", senderAvatar: null, timestamp: 1 },
      { id: "empty", text: "", sender: "0x3", timestamp: 3 },
      { id: "bad-time", text: "ignored", sender: "0x4", timestamp: "bad" },
    ]),
    [
      { id: "a", text: "first", sender: "0x1", senderName: "Lore", senderAvatar: null, timestamp: 1 },
      { id: "b", text: "second", sender: "0x2", senderName: null, senderAvatar: null, timestamp: 2 },
    ],
  );
  assert.equal(chatPollDelay.getChatPollDelayMs({ open: true, isPageVisible: true, failureCount: 0 }), 3_000);
  assert.equal(chatPollDelay.getChatPollDelayMs({ open: true, isPageVisible: false, failureCount: 1 }), 60_000);
  assert.equal(chatPollDelay.getChatPollDelayMs({ open: false, isPageVisible: true, failureCount: 2 }), 80_000);
  assert.equal(chatPollDelay.getChatPollDelayMs({ open: false, isPageVisible: false, failureCount: 99 }), 240_000);
  assert.equal(chatRateLimit.parseChatRetryAfterMs(2), 2_000);
  assert.equal(chatRateLimit.parseChatRetryAfterMs("bad"), 1_500);
  assert.equal(chatRateLimit.parseChatRetryAfterMs(999), 120_000);

  const useChatSource = readFileSync("app/hooks/useChat.ts", "utf8");
  assert.match(
    useChatSource,
    /sendCooldownUntilRef/,
    "chat send cooldown must track an absolute deadline so server retryAfter survives rerenders",
  );
  assert.match(
    useChatSource,
    /parseChatRetryAfterMs/,
    "chat send must honor server retryAfter from 429 responses",
  );
  const chatWindowSource = readFileSync("app/components/chat/ChatWindow.tsx", "utf8");
  assert.match(
    chatWindowSource,
    /aria-live="polite"/,
    "chat cooldown feedback must remain visible without relying on console warnings",
  );
  assert.match(
    chatWindowSource,
    /data-testid="chat-send-action"/,
    "chat send action must expose a stable smoke-test selector",
  );
  assert.match(
    chatWindowSource,
    /data-testid="chat-profile-open"/,
    "chat profile entrypoint must expose a stable smoke-test selector",
  );
  const chatProfileModalSource = readFileSync("app/components/chat/ChatProfileModal.tsx", "utf8");
  assert.match(
    chatProfileModalSource,
    /data-testid="chat-profile-save"/,
    "chat profile save action must expose a stable smoke-test selector",
  );

  const previousLocalStorage = globalThis.localStorage;
  try {
    const storage = new Map();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key),
      },
    });
    const chatKey = chatSessionClient.getChatAuthStorageKey("0xabc");
    storage.set(chatKey, JSON.stringify({ address: "0xabc", expiresAt: Date.now() - 1 }));
    assert.equal(chatSessionClient.loadChatAuthSession("0xabc"), null);
    assert.equal(storage.has(chatKey), false, "expired chat auth session must be cleared from storage");
  } finally {
    if (previousLocalStorage === undefined) {
      delete globalThis.localStorage;
    } else {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: previousLocalStorage,
      });
    }
  }

  assert.equal(indexerFinality.parseIndexerFinalityBlocks("12"), 12n);
  assert.equal(indexerFinality.parseIndexerFinalityBlocks("-1"), 0n);
  assert.equal(indexerFinality.parseIndexerFinalityBlocks("bad"), 0n);
  assert.equal(indexerFinality.getIndexerFinalityTargetBlock(100n, 12n), 88n);
  assert.equal(indexerFinality.getIndexerFinalityTargetBlock(100n, 0n), 100n);
  assert.equal(indexerFinality.getIndexerFinalityTargetBlock(5n, 12n), null);
  assert.equal(indexerFinality.getIndexerTargetLagBlocks(80n, 88n), 8);
  assert.equal(indexerFinality.getIndexerTargetLagBlocks(90n, 88n), 0);
  assert.equal(indexerFinality.getIndexerTargetLagBlocks(null, 88n), null);
  assert.equal(indexerFinality.getIndexerTargetLagBlocks(80n, null), null);
  assert.equal(indexerFinality.hasMainnetIndexerFinality("12"), true);
  assert.equal(indexerFinality.hasMainnetIndexerFinality("0"), false);
  assert.equal(indexerFinality.hasMainnetIndexerFinality("bad"), false);
  assert.deepEqual(
    gamePollingConfig.getGamePollingIntervals({
      isPageVisible: true,
      pollPhase: "slow",
      liveGrid: true,
      autoMineSessionActive: false,
      isRevealing: false,
    }),
    {
      epochInterval: 5000,
      epochEndInterval: 6000,
      liveGridInterval: 3000,
      liveUserBetsInterval: 3000,
      gridEpochInterval: 5000,
    },
  );
  assert.deepEqual(
    gamePollingConfig.getGamePollingIntervals({
      isPageVisible: false,
      pollPhase: "slow",
      liveGrid: true,
      autoMineSessionActive: false,
      isRevealing: false,
    }),
    {
      epochInterval: 20_000,
      epochEndInterval: 20_000,
      liveGridInterval: 20_000,
      liveUserBetsInterval: 20_000,
      gridEpochInterval: 20_000,
    },
  );
  assert.equal(
    gamePollingConfig.getGamePollingIntervals({
      isPageVisible: false,
      pollPhase: "slow",
      liveGrid: true,
      autoMineSessionActive: true,
      isRevealing: false,
    }).liveGridInterval,
    1000,
  );
  assert.equal(gameDataHelpers.buildJackpotInfo({}), null);
  assert.equal(gameDataHelpers.buildRolloverAmount("bad-shape"), 0);
  assert.equal(gameDataHelpers.buildRealTotalStaked([[1_000_000_000_000_000_000n, "bad"], []], 2_000_000_000_000_000_000n), 3);
  assert.equal(
    gameDataHelpers.buildTileViewData(
      [[10_000_000_000_000_000n], [0n]],
      [0],
    )[0].users,
    1,
    "displayed positive tile pool should show at least one player while user counts catch up",
  );
  assert.deepEqual(
    gameDataHelpers.buildTileViewData(
      [[1n], [4n]],
      [4],
    )[0],
    {
      tileId: 1,
      users: 0,
      poolDisplay: "0.00",
      hasMyBet: false,
    },
    "tile with display-zero pool must not show players",
  );
  const miningGridSource = readFileSync("app/components/MiningGrid.tsx", "utf8");
  assert.match(
    miningGridSource,
    /showUserBadge[\s\S]*hasDisplayedStake[\s\S]*showUserBadge &&/,
    "mining grid must hide the player badge on display-zero tiles",
  );

  assert.equal(networkRetry.getNetworkRetryDelayMs(0, 500, 10_000), 500);
  assert.equal(networkRetry.getNetworkRetryDelayMs(3, 500, 10_000), 4_000);
  assert.equal(networkRetry.getNetworkRetryDelayMs(4, 500, 10_000, 2), 2_000);

  const diagnosticsStorage = (() => {
    const map = new Map();
    return {
      getItem: (key) => map.get(key) ?? null,
      removeItem: (key) => {
        map.delete(key);
      },
      setItem: (key, value) => {
        map.set(key, value);
      },
    };
  })();
  assert.deepEqual(autoMineDiagnostics.createDefaultAutoMineDiagnosticsSnapshot(), {
    phase: "idle",
    progress: null,
    runningParams: null,
    isAutoMining: false,
    autoResumeRequested: false,
    sessionExpired: false,
    lastErrorKind: null,
    lastErrorMessage: null,
    lastErrorRawMessage: null,
    lastStopReason: null,
    updatedAt: 0,
  });
  autoMineDiagnostics.writeAutoMineDiagnostics({
    phase: "retry-wait",
    progress: "Saved session is paused and will retry automatically.",
    autoResumeRequested: true,
    lastErrorKind: "network",
    lastStopReason: "retry-wait",
  }, { storage: diagnosticsStorage, now: 1234 });
  assert.deepEqual(autoMineDiagnostics.readAutoMineDiagnostics(diagnosticsStorage), {
    phase: "retry-wait",
    progress: "Saved session is paused and will retry automatically.",
    runningParams: null,
    isAutoMining: false,
    autoResumeRequested: true,
    sessionExpired: false,
    lastErrorKind: "network",
    lastErrorMessage: null,
    lastErrorRawMessage: null,
    lastStopReason: "retry-wait",
    updatedAt: 1234,
  });
  assert.equal(
    autoMineDiagnostics.sanitizeAutoMineDiagnosticsSnapshot({
      phase: "bogus",
      lastErrorKind: "broken",
      lastStopReason: "wrong",
      updatedAt: "bad",
    }).phase,
    "idle",
  );
  autoMineDiagnostics.clearAutoMineDiagnostics(diagnosticsStorage);
  assert.equal(autoMineDiagnostics.readAutoMineDiagnostics(diagnosticsStorage), null);

  autoMineDebugOverride.writeAutoMineDebugOverride({
    phase: "retry-wait",
    progress: "Auto-miner paused: RPC offline for too long. Retrying automatically...",
    runningParams: { betStr: "1.25", blocks: 4, rounds: 12 },
  }, { storage: diagnosticsStorage, now: 2222 });
  assert.deepEqual(autoMineDebugOverride.readAutoMineDebugOverride(diagnosticsStorage), {
    phase: "retry-wait",
    progress: "Auto-miner paused: RPC offline for too long. Retrying automatically...",
    runningParams: { betStr: "1.25", blocks: 4, rounds: 12 },
    updatedAt: 2222,
  });
  assert.equal(
    autoMineDebugOverride.sanitizeAutoMineDebugOverride({
      phase: "wrong",
      runningParams: { betStr: "1", blocks: 2, rounds: 3 },
    }),
    null,
  );
  autoMineDebugOverride.clearAutoMineDebugOverride(diagnosticsStorage);
  assert.equal(autoMineDebugOverride.readAutoMineDebugOverride(diagnosticsStorage), null);

  assert.equal(
    autoMineRunnerStopReason.getAutoMineRunnerCatchStopReason({
      insufficientFunds: false,
      sessionExpired: false,
      shouldAutoResume: true,
    }),
    "retry-wait",
  );
  assert.equal(
    autoMineRunnerStopReason.getAutoMineRunnerCatchStopReason({
      insufficientFunds: false,
      sessionExpired: true,
      shouldAutoResume: true,
    }),
    "session-expired",
  );
  assert.equal(
    autoMineRunnerStopReason.getAutoMineRunnerCatchStopReason({
      insufficientFunds: true,
      sessionExpired: false,
      shouldAutoResume: true,
    }),
    "insufficient-balance",
  );
  assert.equal(
    autoMineRunnerStopReason.getAutoMineRunnerCatchStopReason({
      insufficientFunds: false,
      sessionExpired: false,
      shouldAutoResume: false,
    }),
    "error",
  );

  const restoreFingerprint = autoMineRestoreDeduper.getAutoMineRestoreFingerprint({
    active: true,
    betStr: "1.0",
    blocks: 3,
    rounds: 500,
    nextRoundIndex: 81,
    lastPlacedEpoch: "2413",
  });
  assert.equal(restoreFingerprint, "1.0|3|500|81|2413");
  assert.equal(
    autoMineRestoreDeduper.shouldSuppressDuplicateAutoMineRestore({
      previousAt: 10_000,
      previousFingerprint: restoreFingerprint,
      nextFingerprint: restoreFingerprint,
      now: 12_500,
      cooldownMs: 4_000,
    }),
    true,
  );
  assert.equal(
    autoMineRestoreDeduper.shouldSuppressDuplicateAutoMineRestore({
      previousAt: 10_000,
      previousFingerprint: restoreFingerprint,
      nextFingerprint: "1.0|3|500|82|2414",
      now: 12_500,
      cooldownMs: 4_000,
    }),
    false,
  );

  const chunkStorage = (() => {
    const map = new Map();
    return {
      getItem: (key) => map.get(key) ?? null,
      removeItem: (key) => {
        map.delete(key);
      },
      setItem: (key, value) => {
        map.set(key, value);
      },
    };
  })();
  assert.equal(
    chunkReloadRecovery.isChunkLoadLikeErrorMessage(
      "Loading chunk _app-pages-browser_app_components_WhitePaper_tsx failed. (timeout: /_next/static/chunks/foo.js)",
    ),
    true,
  );
  assert.equal(
    chunkReloadRecovery.isChunkLoadLikeErrorMessage(
      "Failed to fetch dynamically imported module: https://example.com/_next/static/chunks/app/page.js",
    ),
    true,
  );
  assert.equal(
    chunkReloadRecovery.isChunkLoadLikeErrorMessage(
      "Importing a module script failed. https://example.com/_next/static/chunks/app/layout.js",
    ),
    true,
  );
  assert.equal(chunkReloadRecovery.shouldAttemptChunkReloadOnce(chunkStorage, 1_000), true);
  assert.equal(chunkReloadRecovery.shouldAttemptChunkReloadOnce(chunkStorage, 2_000), false);
  chunkReloadRecovery.clearExpiredChunkReloadAttempt(
    chunkStorage,
    1_000 + chunkReloadRecovery.CHUNK_RELOAD_WINDOW_MS + 1,
  );
  assert.equal(chunkReloadRecovery.shouldAttemptChunkReloadOnce(chunkStorage, 20_000), true);
  let replacedUrl = null;
  chunkReloadRecovery.reloadWithCacheBust({
    href: "http://localhost:3000/?_r=legacy&tab=hub",
    reload: () => {
      throw new Error("should use replace");
    },
    replace: (url) => {
      replacedUrl = url;
    },
  }, 21_000);
  assert.equal(replacedUrl, "http://localhost:3000/?tab=hub&__lore_reload=21000");
  const historyCalls = [];
  assert.equal(
    chunkReloadRecovery.stripChunkReloadCacheParam(
      { href: "http://localhost:3000/?tab=hub&_r=legacy&__lore_reload=21000#board" },
      {
        state: { ok: true },
        replaceState: (...args) => historyCalls.push(args),
      },
    ),
    true,
  );
  assert.deepEqual(historyCalls, [[{ ok: true }, "", "/?tab=hub#board"]]);

  await assert.rejects(
    () =>
      miningShared.findConfirmedEpochForTiles(
        {
          readContract: async () => {
            throw new Error("rpc timeout");
          },
        },
        "0x0000000000000000000000000000000000000001",
        [11n, 12n],
        [1, 2],
      ),
    /rpc timeout/,
  );

  assert.deepEqual(
    autoMineError.getAutoMineUserMessage(new Error("must have valid access token")),
    {
      diagnosticsErrorKind: "session-expired",
      rawMessage: "must have valid access token",
      sessionExpired: true,
      networkDown: false,
      walletUnavailable: false,
      pendingNonceBlocked: false,
      userMessage: "Session expired. Log out, log in again, then reload this page - the bot will auto-resume.",
    },
  );
  assert.equal(
    autoMineError.getAutoMineUserMessage(new Error("public client unavailable")).diagnosticsErrorKind,
    "wallet-unavailable",
  );
  assert.equal(
    autoMineError.getAutoMineUserMessage(new Error("pending transaction blocked by nonce")).diagnosticsErrorKind,
    "pending-nonce-blocked",
  );

  const cache = routeCache.createRouteCache(2);
  const cacheKey = "messages";
  const inflightVersion = cache.getWriteVersion(cacheKey);
  cache.invalidate(cacheKey);
  cache.setIfLatest(cacheKey, { stale: true }, 1000, inflightVersion);
  assert.equal(cache.getStale(cacheKey), null);

  const freshVersion = cache.getWriteVersion(cacheKey);
  cache.setIfLatest(cacheKey, { fresh: true }, 1000, freshVersion);
  assert.deepEqual(cache.getStale(cacheKey), { fresh: true });

  let loopState = autoMineLoopModel.createAutoMineLoopState({
    rounds: 3,
    startRoundIndex: 0,
    restoredLastEpoch: null,
  });
  loopState = autoMineLoopModel.reduceAutoMineLoopEvent(loopState, {
    type: "round-betting-started",
    liveEpoch: 21n,
    tiles: [4, 8],
    selectionEpoch: "21",
  });
  assert.deepEqual(loopState.selection, { tiles: [4, 8], epoch: "21" });
  assert.deepEqual(loopState.sessionCheckpoint, {
    nextRoundIndex: 0,
    lastPlacedEpoch: "21",
  });

  loopState = autoMineLoopModel.reduceAutoMineLoopEvent(loopState, {
    type: "network-error",
    retryCount: 1,
    waitMs: 500,
  });
  assert.equal(loopState.roundIndex, 0);
  assert.equal(loopState.networkRetries, 1);
  assert.equal(loopState.progressMessage, "RPC offline - retry 1 in 1s...");
  assert.equal(loopState.sessionCheckpoint, null);

  loopState = autoMineLoopModel.reduceAutoMineLoopEvent(loopState, {
    type: "round-recovered-after-network-error",
    placedEpoch: 21n,
    tiles: [4, 8],
  });
  assert.equal(loopState.roundIndex, 1);
  assert.equal(loopState.networkRetries, 0);
  assert.equal(loopState.lastPlacedEpoch, 21n);
  assert.deepEqual(loopState.selection, { tiles: [4, 8], epoch: "21" });

  loopState = autoMineLoopModel.reduceAutoMineLoopEvent(loopState, {
    type: "round-epoch-ended",
    liveEpoch: 22n,
  });
  assert.equal(loopState.roundIndex, 2);
  assert.equal(loopState.lastPlacedEpoch, 22n);
  assert.equal(loopState.progressMessage, "2 / 3 - skipped (epoch ended), next round...");
  assert.deepEqual(loopState.sessionCheckpoint, {
    nextRoundIndex: 2,
    lastPlacedEpoch: "22",
  });

  loopState = autoMineLoopModel.reduceAutoMineLoopEvent(loopState, {
    type: "round-confirmed",
    placedEpoch: 23n,
    tiles: [6],
  });
  assert.equal(loopState.roundIndex, 3);
  assert.equal(loopState.lastPlacedEpoch, 23n);
  assert.equal(loopState.progressMessage, "3 / 3 - confirmed");
  assert.deepEqual(loopState.selection, { tiles: [6], epoch: "23" });
  assert.equal(loopState.sessionCheckpoint, null);

  loopState = autoMineLoopModel.createAutoMineLoopState({
    rounds: 3,
    startRoundIndex: 2,
    restoredLastEpoch: 22n,
  });
  loopState = autoMineLoopModel.reduceAutoMineLoopEvent(loopState, {
    type: "round-detected-on-chain",
    placedEpoch: 23n,
    tiles: [6],
  });
  assert.equal(loopState.roundIndex, 3);
  assert.equal(loopState.lastPlacedEpoch, 23n);
  assert.equal(loopState.progressMessage, "3 / 3 - confirmed (detected on-chain)");
  assert.deepEqual(loopState.selection, { tiles: [6], epoch: "23" });
  assert.equal(loopState.sessionCheckpoint, null);

  loopState = autoMineLoopModel.reduceAutoMineLoopEvent(loopState, { type: "loop-completed" });
  assert.equal(loopState.stopReason, "completed");
  assert.equal(loopState.progressMessage, "Completed 3/3 rounds");

  assert.deepEqual(
    autoMineLoopPreludePlanner.planAutoMineLoopPrelude({
      hasRefreshSession: false,
      lastPlacedEpoch: null,
      lastSessionRefresh: 1_000,
      now: 2_000,
      sessionRefreshIntervalMs: 5_000,
    }),
    {
      operations: [],
    },
  );
  assert.deepEqual(
    autoMineLoopPreludePlanner.planAutoMineLoopPrelude({
      hasRefreshSession: true,
      lastPlacedEpoch: 42n,
      lastSessionRefresh: 1_000,
      now: 7_001,
      sessionRefreshIntervalMs: 5_000,
    }),
    {
      operations: ["refresh-session", "await-epoch-ready"],
    },
  );
  assert.deepEqual(
    autoMineLoopRoundOutcome.toAutoMineLoopConfirmedEvent({
      outcome: {
        kind: "confirmed",
        source: "recovered-after-network-error",
        placedEpoch: 42n,
      },
      tiles: [3, 7],
    }),
    {
      type: "round-recovered-after-network-error",
      placedEpoch: 42n,
      tiles: [3, 7],
    },
  );
  assert.deepEqual(
    autoMineLoopTransitionPlanner.planAutoMinePreparedRoundTransition({
      kind: "skip-existing",
      liveEpoch: 77n,
      alreadyBetTiles: [1, 2],
      effectiveBlocks: 2,
    }),
    {
      kind: "continue",
      action: {
        event: { type: "round-skipped-existing", liveEpoch: 77n },
        syncEffects: { session: true, selection: true, progress: false },
      },
    },
  );
  assert.deepEqual(
    autoMineLoopTransitionPlanner.planAutoMineAttemptTransition({
      epochNeedsResolve: true,
      outcome: { kind: "submitted" },
      roundIndex: 1,
      rounds: 3,
    }),
    {
      kind: "finalize",
      commandsBefore: [
        { type: "clear-pending-bet" },
        {
          type: "confirmation-start",
          clearSelection: true,
          progressMessage: "2 / 3 - confirmed",
          refetchEpoch: true,
        },
      ],
    },
  );
  assert.deepEqual(
    autoMineLoopTransitionPlanner.planAutoMineRecoveryTransition({
      kind: "confirmed",
      source: "recovered-after-network-error",
      placedEpoch: 88n,
    }),
    {
      kind: "confirmed",
      commandsBefore: [{ type: "clear-pending-bet" }],
      outcome: {
        kind: "confirmed",
        source: "recovered-after-network-error",
        placedEpoch: 88n,
      },
    },
  );
  assert.deepEqual(
    autoMineLoopTransitionPlanner.planAutoMineNetworkErrorTransition({
      retryCount: 2,
      waitMs: 1200,
    }),
    {
      kind: "continue",
      action: {
        commandsAfter: [{ type: "sleep", ms: 1200 }],
        event: { type: "network-error", retryCount: 2, waitMs: 1200 },
        syncEffects: { progress: true, selection: false, session: false },
      },
    },
  );
  assert.deepEqual(
    autoMineLoopTransitionPlanner.planAutoMineLoopCompletionTransition(),
    {
      action: {
        commandsAfter: [{ type: "sleep", ms: 1500 }],
        event: { type: "loop-completed" },
        syncEffects: { progress: true, selection: false, session: false },
      },
    },
  );

  assert.deepEqual(
    autoMineLoopRetryPlanner.planAutoMineLoopNetworkRetry({
      currentRetryCount: 0,
      initialMs: 500,
      maxMs: 10_000,
      retryMax: 4,
    }),
    {
      kind: "retry",
      retryCount: 1,
      waitMs: 500,
    },
  );
  assert.deepEqual(
    autoMineLoopRetryPlanner.planAutoMineLoopNetworkRetry({
      currentRetryCount: 3,
      initialMs: 500,
      maxExponent: 2,
      maxMs: 10_000,
      retryMax: 4,
    }),
    {
      kind: "retry",
      retryCount: 4,
      waitMs: 2_000,
    },
  );
  assert.deepEqual(
    autoMineLoopRetryPlanner.planAutoMineLoopNetworkRetry({
      currentRetryCount: 4,
      initialMs: 500,
      maxMs: 10_000,
      retryMax: 4,
    }),
    {
      kind: "give-up",
      retryCount: 5,
    },
  );

  const loopProgress = [];
  const loopSelections = [];
  const loopSavedSessions = [];
  const loopCompletedRounds = [];
  let loopConfirmedCount = 0;
  const createLoopRuntime = (overrides = {}) => ({
    getNow: () => 0,
    handleConfirmedRound: async ({ placedEpoch, progressMessage, roundIndex, tilesToBet }) => {
      loopConfirmedCount += 1;
      loopCompletedRounds.push({
        betStr: "1.0",
        blocks: 2,
        rounds: 1,
        roundIndex,
        placedEpoch,
        displayTiles: tilesToBet,
        displayEpoch: placedEpoch,
        progressMessage,
        announceBet: false,
      });
    },
    handleEpochReady: ({ blocks, roundIndex, rounds }) => {
      loopProgress.push(`${roundIndex} / ${rounds} - placing bet (${blocks} tiles)...`);
    },
    handleSessionRefresh: async () => 0,
    readRefreshSession: () => undefined,
    renewLock: () => {},
    runCommands: async () => {},
    syncState: (state, effects = {}) => {
      const { progress = true, selection = true, session = true } = effects;
      if (selection) {
        loopSelections.push(state.selection);
      }
      if (progress && state.progressMessage) {
        loopProgress.push(state.progressMessage);
      }
      if (session && state.sessionCheckpoint) {
        loopSavedSessions.push({
          active: true,
          betStr: "1.0",
          blocks: 2,
          rounds: 1,
          nextRoundIndex: state.sessionCheckpoint.nextRoundIndex,
          lastPlacedEpoch: state.sessionCheckpoint.lastPlacedEpoch,
        });
      }
    },
    ...overrides,
  });
  const baseLoopOptions = {
    autoMineActive: () => true,
    blocks: 2,
    networkBackoffInitialMs: 10,
    networkBackoffMaxMs: 20,
    networkRetryMax: 2,
    restoredLastEpoch: null,
    rounds: 1,
    runtime: createLoopRuntime(),
    sessionRefreshIntervalMs: 60_000,
    startRoundIndex: 0,
  };

  const detectedResult = await autoMineLoop.runAutoMineLoop({
    ...baseLoopOptions,
    adapter: {
      awaitEpochReady: async () => ({ stopped: false }),
      prepareRoundCommand: async () => ({
        kind: "ready",
        alreadyBetTiles: [],
        command: {
          client: {},
          liveEpoch: 55n,
          epochNeedsResolve: false,
          effectiveBlocks: 2,
          tilesToBet: [2, 5],
          roundCandidateEpochs: [55n, 56n],
          selectionEpoch: "55",
        },
      }),
      executeRoundCommand: async () => ({ kind: "confirmed", source: "detected-on-chain", placedEpoch: 55n }),
      finalizeRoundCommand: async () => ({ kind: "confirmed", source: "finalized", placedEpoch: 0n }),
      recoverRoundCommand: async () => ({ kind: "retry" }),
    },
  });
  assert.equal(detectedResult.stopReason, "completed");
  assert.equal(loopConfirmedCount, 1);
  assert.equal(loopCompletedRounds.length, 1);
  assert.equal(loopCompletedRounds[0].placedEpoch, 55n);
  assert.deepEqual(loopSavedSessions, [{
    active: true,
    betStr: "1.0",
    blocks: 2,
    rounds: 1,
    nextRoundIndex: 0,
    lastPlacedEpoch: "55",
  }]);
  assert.deepEqual(loopSelections.at(-1), { tiles: [2, 5], epoch: "55" });
  assert.equal(loopProgress.at(-1), "Completed 1/1 rounds");

  let recoverCalls = 0;
  const recoveredResult = await autoMineLoop.runAutoMineLoop({
    ...baseLoopOptions,
    runtime: createLoopRuntime({
      handleConfirmedRound: async () => {},
      handleEpochReady: () => {},
      runCommands: async () => {},
      syncState: () => {},
    }),
    adapter: {
      awaitEpochReady: async () => ({ stopped: false }),
      prepareRoundCommand: async () => ({
        kind: "ready",
        alreadyBetTiles: [],
        command: {
          client: {},
          liveEpoch: 71n,
          epochNeedsResolve: false,
          effectiveBlocks: 1,
          tilesToBet: [6],
          roundCandidateEpochs: [71n, 72n],
          selectionEpoch: "71",
        },
      }),
      executeRoundCommand: async () => {
        throw new Error("network request failed");
      },
      finalizeRoundCommand: async () => ({ kind: "confirmed", source: "finalized", placedEpoch: 0n }),
      recoverRoundCommand: async () => {
        recoverCalls += 1;
        return {
          kind: "confirmed",
          source: "recovered-after-network-error",
          placedEpoch: 71n,
        };
      },
    },
  });
  assert.equal(recoveredResult.stopReason, "completed");
  assert.equal(recoverCalls, 1);

  let executeAfterRecoveryErrorCalls = 0;
  let recoveryNetworkErrorCalls = 0;
  const recoveryNetworkErrorProgress = [];
  const recoveredAfterRecoveryNetworkErrorResult = await autoMineLoop.runAutoMineLoop({
    ...baseLoopOptions,
    runtime: createLoopRuntime({
      handleConfirmedRound: async () => {},
      handleEpochReady: () => {},
      runCommands: async () => {},
      syncState: (state, effects = {}) => {
        if ((effects.progress ?? true) && state.progressMessage) {
          recoveryNetworkErrorProgress.push(state.progressMessage);
        }
      },
    }),
    adapter: {
      awaitEpochReady: async () => ({ stopped: false }),
      prepareRoundCommand: async () => ({
        kind: "ready",
        alreadyBetTiles: [],
        command: {
          client: {},
          liveEpoch: 72n,
          epochNeedsResolve: false,
          effectiveBlocks: 1,
          tilesToBet: [7],
          roundCandidateEpochs: [72n, 73n],
          selectionEpoch: "72",
        },
      }),
      executeRoundCommand: async () => {
        executeAfterRecoveryErrorCalls += 1;
        if (executeAfterRecoveryErrorCalls === 1) {
          throw new Error("network request failed");
        }
        return { kind: "confirmed", source: "detected-on-chain", placedEpoch: 72n };
      },
      finalizeRoundCommand: async () => ({ kind: "confirmed", source: "finalized", placedEpoch: 0n }),
      recoverRoundCommand: async () => {
        recoveryNetworkErrorCalls += 1;
        throw new Error("network request failed during recovery");
      },
    },
  });
  assert.equal(recoveredAfterRecoveryNetworkErrorResult.stopReason, "completed");
  assert.equal(executeAfterRecoveryErrorCalls, 2);
  assert.equal(recoveryNetworkErrorCalls, 1);
  assert.deepEqual(
    recoveryNetworkErrorProgress.filter((message) => message.startsWith("RPC offline - retry")),
    ["RPC offline - retry 1 in 0s..."],
  );

  let epochWaitCalls = 0;
  let epochWaitRetryProgressCount = 0;
  const epochWaitError = new Error("epoch 1326 did not reach end-of-round readiness within 75000ms");
  epochWaitError.name = "EpochWaitTimeoutError";
  const epochWaitRecoveryResult = await autoMineLoop.runAutoMineLoop({
    ...baseLoopOptions,
    autoMineActive: () => epochWaitRetryProgressCount < 10,
    restoredLastEpoch: 1326n,
    runtime: createLoopRuntime({
      handleConfirmedRound: async () => {},
      handleEpochReady: () => {
        throw new Error("should not place while epoch wait is failing");
      },
      runCommands: async () => {},
      syncState: (state, effects = {}) => {
        if ((effects.progress ?? true) && state.progressMessage?.startsWith("RPC offline - retry")) {
          epochWaitRetryProgressCount += 1;
        }
      },
    }),
    adapter: {
      awaitEpochReady: async () => {
        epochWaitCalls += 1;
        throw epochWaitError;
      },
      prepareRoundCommand: async () => {
        throw new Error("should not prepare while epoch wait is failing");
      },
      executeRoundCommand: async () => ({ kind: "submitted" }),
      finalizeRoundCommand: async () => ({ kind: "confirmed", source: "finalized", placedEpoch: 0n }),
      recoverRoundCommand: async () => ({ kind: "retry" }),
    },
  });
  assert.equal(epochWaitRecoveryResult.stopReason, "user-stopped");
  assert.equal(epochWaitCalls > 8, true);
  assert.equal(epochWaitRetryProgressCount, 10);

  const noClientResult = await autoMineLoop.runAutoMineLoop({
    ...baseLoopOptions,
    runtime: createLoopRuntime({
      handleConfirmedRound: async () => {},
      handleEpochReady: () => {},
      runCommands: async () => {},
      syncState: () => {},
    }),
    adapter: {
      awaitEpochReady: async () => ({ stopped: false }),
      prepareRoundCommand: async () => ({ kind: "stop-no-client" }),
      executeRoundCommand: async () => ({ kind: "submitted" }),
      finalizeRoundCommand: async () => ({ kind: "confirmed", source: "finalized", placedEpoch: 0n }),
      recoverRoundCommand: async () => ({ kind: "retry" }),
    },
  });
  assert.equal(noClientResult.stopReason, "no-client");

  let session = null;
  let lockReleased = 0;
  const controller = autoMineRuntimeController.createAutoMineRuntimeController({
    clearSession: () => {
      session = null;
    },
    readSession: () => session,
    releaseTabLock: () => {
      lockReleased += 1;
    },
    saveSession: (nextSession) => {
      session = nextSession;
    },
  });

  controller.persistStart({ betStr: "1.5", blocks: 3, rounds: 7 });
  assert.deepEqual(session, {
    active: true,
    betStr: "1.5",
    blocks: 3,
    rounds: 7,
    nextRoundIndex: 0,
    lastPlacedEpoch: null,
  });

  session = { ...session, nextRoundIndex: 7 };
  assert.deepEqual(controller.readRestorableRun(), { kind: "cleared-invalid" });
  assert.equal(session, null);

  controller.persistCheckpoint({
    betStr: "2.0",
    blocks: 4,
    rounds: 9,
    nextRoundIndex: 2,
    lastPlacedEpoch: 15n,
  });
  assert.deepEqual(controller.readRestorableRun(), {
    kind: "resume",
    session: {
      active: true,
      betStr: "2.0",
      blocks: 4,
      rounds: 9,
      nextRoundIndex: 2,
      lastPlacedEpoch: "15",
    },
    params: {
      betStr: "2.0",
      blocks: 4,
      rounds: 9,
      startRoundIndex: 2,
      lastPlacedEpoch: 15n,
    },
  });

  controller.finalizeRun("completed");
  assert.equal(session, null);
  assert.equal(lockReleased, 1);

  let retryAttempt = 0;
  const retryResult = await networkRetry.readWithNetworkRetry({
    actionLabel: "probe read",
    initialMs: 1,
    isActive: () => true,
    maxAttempts: 4,
    maxMs: 2,
    onProgress: () => {},
    read: async () => {
      retryAttempt += 1;
      if (retryAttempt < 3) throw new Error("rpc timeout");
      return "ready";
    },
    shouldRetry: (error) => String(error).includes("rpc timeout"),
  });
  assert.equal(retryResult, "ready");
  assert.equal(retryAttempt, 3);

  let finalizedAttempts = 0;
  const pendingAttempt = await manualMineAttempt.runManualMineAttempt({
    actorAddress: "0xabc",
    betAmountStr: "1.25",
    checkBetAlreadyConfirmed: async () => false,
    ensureAllowance: async () => {
      throw new Error("should not request allowance on pending path");
    },
    finalizeMineSuccess: () => {
      finalizedAttempts += 1;
    },
    getBumpedFees: async () => undefined,
    normalizedTiles: [1, 2],
    placeBetsPreferSilent: async () => "pending",
    source: "ManualMine",
  });
  assert.equal(pendingAttempt, "pending");
  assert.equal(finalizedAttempts, 0);

  let timedOutFinalized = 0;
  const timeoutAttempt = await manualMineAttempt.runManualMineAttempt({
    actorAddress: "0xabc",
    betAmountStr: "0.5",
    checkBetAlreadyConfirmed: async () => false,
    ensureAllowance: async () => {
      throw new Error("should not request allowance on timeout path");
    },
    finalizeMineSuccess: () => {
      timedOutFinalized += 1;
    },
    getBumpedFees: async () => undefined,
    normalizedTiles: [3],
    placeBetsPreferSilent: async () => {
      const error = new Error("transaction receipt timed out");
      error.name = "TransactionReceiptTimeoutError";
      throw error;
    },
    source: "DirectMine",
  });
  assert.equal(timeoutAttempt, "pending");
  assert.equal(timedOutFinalized, 0);

  let hiddenRevertStatusChecks = 0;
  let hiddenRevertFinalized = 0;
  const hiddenRevertAttempt = await manualMineAttempt.runManualMineAttempt({
    actorAddress: "0xabc",
    betAmountStr: "10",
    checkBetAlreadyConfirmed: async (_actorAddress, normalizedTiles) => {
      hiddenRevertStatusChecks += 1;
      assert.deepEqual(normalizedTiles, [2, 20, 13]);
      return true;
    },
    ensureAllowance: async () => {
      throw new Error("should not request allowance after confirmed hidden revert");
    },
    finalizeMineSuccess: () => {
      hiddenRevertFinalized += 1;
    },
    getBumpedFees: async () => {
      throw new Error("should not retry after confirmed hidden revert");
    },
    normalizedTiles: [2, 20, 13],
    placeBetsPreferSilent: async () => {
      throw new Error('An unknown error occurred while executing the contract function "placeBatchBetsBitmap".');
    },
    source: "ManualMine",
  });
  assert.equal(hiddenRevertAttempt, "confirmed");
  assert.equal(hiddenRevertStatusChecks, 1);
  assert.equal(hiddenRevertFinalized, 1);

  let reconnectNonceReads = 0;
  let reconnectBetCalls = 0;
  const reconnectProgress = [];
  const reconnectResult = await miningRoundBetting.executeAutoMineBetLoop({
    actorAddress: "0x0000000000000000000000000000000000000001",
    autoMineActive: () => true,
    betPendingGraceMs: 60_000,
    betPendingStaleMs: 120_000,
    currentEpoch: 92n,
    currentRoundIndex: 0,
    effectiveBlocks: 1,
    forceReplacePendingNonceGap: 2,
    gasBumpBase: 0n,
    gasBumpReplacementStep: 0n,
    getBumpedFees: async () => undefined,
    getRetryDelayMs: () => 1,
    maxBetAttempts: 2,
    networkBackoffInitialMs: 1,
    networkBackoffMaxMs: 1,
    onProgress: (message) => reconnectProgress.push(message),
    pendingBetRef: { current: null },
    placeBets: async () => {
      reconnectBetCalls += 1;
      return "confirmed";
    },
    placeBetsSilent: async () => {
      throw new Error("should not use silent path without silent sender");
    },
    publicClient: {
      getTransactionCount: async () => {
        reconnectNonceReads += 1;
        if (reconnectNonceReads <= 2) {
          throw new Error("network request failed");
        }
        return 10;
      },
      readContract: async () => Array.from({ length: 25 }, () => 0n),
    },
    readSilentSend: () => null,
    roundCandidateEpochs: [92n],
    rounds: 1,
    singleAmountRaw: 1n,
    tilesToBet: [1],
  });
  assert.deepEqual(reconnectResult, { kind: "submitted" });
  assert.equal(reconnectBetCalls, 1);
  assert.deepEqual(reconnectProgress, [
    "1 / 1 - RPC offline, retry in 0s...",
    "1 / 1 - reconnecting RPC...",
  ]);

  let walletFallbackCalls = 0;
  const pendingBetRef = { current: null };
  const fakeBetClient = {
    getTransactionCount: async () => 10,
    readContract: async () => [1n, ...Array.from({ length: 24 }, () => 0n)],
  };
  const pendingFallbackResult = await miningRoundBetting.executeAutoMineBetLoop({
    actorAddress: "0x0000000000000000000000000000000000000001",
    autoMineActive: () => true,
    betPendingGraceMs: 60_000,
    betPendingStaleMs: 120_000,
    currentEpoch: 91n,
    currentRoundIndex: 0,
    effectiveBlocks: 1,
    forceReplacePendingNonceGap: 2,
    gasBumpBase: 0n,
    gasBumpReplacementStep: 0n,
    getBumpedFees: async () => undefined,
    getRetryDelayMs: () => 1,
    maxBetAttempts: 1,
    networkBackoffInitialMs: 1,
    networkBackoffMaxMs: 1,
    onProgress: () => {},
    pendingBetRef,
    placeBets: async () => {
      walletFallbackCalls += 1;
      return "confirmed";
    },
    placeBetsSilent: async () => {
      throw new Error("already known");
    },
    publicClient: fakeBetClient,
    readSilentSend: () => ({}),
    roundCandidateEpochs: [91n],
    rounds: 1,
    singleAmountRaw: 1n,
    tilesToBet: [1],
  });
  assert.deepEqual(pendingFallbackResult, { kind: "detected-on-chain", placedEpoch: 91n });
  assert.equal(walletFallbackCalls, 0);
  assert.deepEqual(pendingBetRef.current, null);

  await assert.rejects(
    () => utils.withTimeout(delay(50), 1, "probe"),
    /probe timed out after 1ms/,
  );
  assert.equal(await utils.withTimeout(Promise.resolve("ok"), 10, "probe"), "ok");
  const lateUnhandledRejections = [];
  const onLateUnhandledRejection = (reason) => lateUnhandledRejections.push(reason);
  process.on("unhandledRejection", onLateUnhandledRejection);
  try {
    await assert.rejects(
      () => utils.withTimeout(new Promise((_, reject) => setTimeout(() => reject(new Error("late privy reject")), 20)), 1, "late probe"),
      /late probe timed out after 1ms/,
    );
    await assert.rejects(
      () => miningShared.withMiningRpcTimeout(
        new Promise((_, reject) => setTimeout(() => reject(new Error("late rpc reject")), 20)),
        "late rpc probe",
        1,
      ),
      /late rpc probe timed out after 1ms/,
    );
    await delay(40);
    assert.deepEqual(lateUnhandledRejections, []);
  } finally {
    process.off("unhandledRejection", onLateUnhandledRejection);
  }

  console.log("Business logic tests passed.");
}

await main();
