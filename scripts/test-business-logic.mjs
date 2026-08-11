import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as envParsingModule from "../config/envParsing.ts";
import * as scriptEnvParsingModule from "./env-parsing.mjs";
import * as publicConfigModule from "../config/publicConfig.ts";
import * as utilsModule from "../app/lib/utils.ts";
import * as chatAvatarUploadModule from "../app/lib/chatAvatarUpload.ts";
import * as chatAvatarModule from "../app/lib/chatAvatar.ts";
import * as chatPollDelayModule from "../app/lib/chatPollDelay.ts";
import * as chatMessagesModule from "../app/lib/chatMessages.ts";
import * as chatRateLimitModule from "../app/lib/chatRateLimit.ts";
import * as indexerFinalityModule from "../app/lib/indexerFinality.ts";
import * as indexerWatchPolicyModule from "../app/lib/indexerWatchPolicy.ts";
import * as canaryHealthTelemetryModule from "../app/lib/canaryHealthTelemetry.ts";
import * as autoMineRunSetupModule from "../app/lib/mining/autoMineRunSetup.ts";
import * as routeErrorModule from "../app/api/_lib/routeError.ts";
import * as clientIdentityModule from "../app/api/_lib/clientIdentity.ts";
import * as externalRateLimitModule from "../app/api/_lib/externalRateLimit.ts";
import * as sharedRateLimitModule from "../app/api/_lib/sharedRateLimit.ts";
import * as runtimeMetricsModule from "../app/api/_lib/runtimeMetrics.ts";
import * as autoMineErrorModule from "../app/hooks/useMiningAutoMineError.ts";
import * as miningSharedModule from "../app/hooks/useMining.shared.ts";
import * as safetyPoolClaimThresholdModule from "../app/lib/safetyPoolClaimThreshold.ts";
import * as analyticsDepositsStatusModule from "../app/lib/analyticsDepositsStatus.ts";
import * as autoResolveModule from "../app/hooks/useAutoResolve.ts";
import * as appShellStateModule from "../app/hooks/useAppShellState.ts";
import * as liveStateSnapshotModule from "../app/hooks/useGameLiveStateSnapshot.ts";
import * as gameDataHelpersModule from "../app/hooks/useGameData.helpers.ts";
import * as gamePollingConfigModule from "../app/hooks/useGamePollingConfig.ts";
import * as explorerLinksModule from "../app/lib/explorerLinks.ts";
import * as lineaOreClientViewPropsModule from "../app/lib/lineaOreClientViewProps.ts";
import * as gameConstantsModule from "../app/lib/constants.ts";
import * as productionRuntimeModule from "../config/productionRuntime.ts";
import * as lineaFeesModule from "../app/lib/lineaFees.ts";
import * as chatSessionClientModule from "../app/lib/chatSessionClient.ts";
import * as runtimeMonitorModule from "./runtime-monitor-lib.mjs";
import * as sentrySanitizeModule from "../app/lib/sentrySanitize.ts";
import * as sqliteScopeAuditModule from "./sqlite-scope-audit-lib.mjs";
import * as analyticsBlockchainHistoryPanelModule from "../app/components/analytics/AnalyticsBlockchainHistoryPanel.tsx";
import * as boundedJsonBodyModule from "../app/api/_lib/boundedJsonBody.ts";
import * as queryParamsModule from "../app/api/_lib/queryParams.ts";
import * as responseHeadersModule from "../app/api/_lib/responseHeaders.ts";
import * as trustedAuthOriginModule from "../app/api/_lib/trustedAuthOrigin.ts";
import * as chatAuthModule from "../app/lib/chatAuth.ts";
import * as adminAuthModule from "../app/lib/adminAuth.ts";
import * as chatSessionModule from "../app/api/_lib/chatSession.ts";
import * as estimateGasRetryModule from "./lib/estimate-gas-retry.ts";
import * as canaryContractErrorModule from "./lib/canary-contract-error.ts";

function listSourceFiles(root, sourceFilePattern = /\.(?:ts|tsx|mjs)$/) {
  const entries = readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path, sourceFilePattern);
    return sourceFilePattern.test(entry.name) ? [path] : [];
  });
}

function assertNoRemovedWalletExperimentInStandardFlow(file) {
  const source = readFileSync(file, "utf8");
  assert.doesNotMatch(
    source,
    /\b(?:EIP-?7702|eip7702|authorizationList|WalletSettings7702|usePrivy7702Diagnostics|deploy:7702|delegated wallet)\b/i,
    `${file} must not reintroduce the removed delegated-wallet experiment into standard wallet or mining flows`,
  );
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

async function withTemporaryEnvAsync(values, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function main() {
  const authProofFields = {
    address: "0x1111111111111111111111111111111111111111",
    uri: "https://playlore.xyz/chat",
    chainId: 59141,
    nonce: "a".repeat(32),
    issuedAt: "2026-07-27T12:00:00.000Z",
  };
  const chatAuth = chatAuthModule.default ?? chatAuthModule;
  const canonicalChatProof = chatAuth.buildChatAuthMessage(authProofFields);
  assert.deepEqual(chatAuth.parseChatAuthMessage(canonicalChatProof), authProofFields);
  assert.equal(
    chatAuth.parseChatAuthMessage(`${canonicalChatProof}\nUnexpected: altered`),
    null,
    "chat auth must reject altered signed proof text",
  );
  assert.equal(
    chatAuth.parseChatAuthMessage(chatAuth.buildChatAuthMessage({
      ...authProofFields,
      issuedAt: "July 27, 2026 12:00:00 GMT",
    })),
    null,
    "chat auth must reject non-canonical issuedAt timestamps",
  );
  for (const chainId of ["059141", "59141.0", "5e4", "0xE705", "9007199254740992"]) {
    assert.equal(
      chatAuth.parseChatAuthMessage(canonicalChatProof.replace("Chain ID: 59141", `Chain ID: ${chainId}`)),
      null,
      `chat auth must reject non-canonical chain id ${chainId}`,
    );
  }
  for (const nonce of ["A".repeat(32), "a".repeat(31), "g".repeat(32)]) {
    assert.equal(
      chatAuth.parseChatAuthMessage(canonicalChatProof.replace(`Nonce: ${authProofFields.nonce}`, `Nonce: ${nonce}`)),
      null,
      `chat auth must reject non-canonical nonce ${nonce}`,
    );
  }
  assert.equal(
    chatAuth.isChatAuthIssuedAtValid(authProofFields.issuedAt, Number.NaN),
    false,
    "chat auth issuedAt validation must fail closed on malformed clocks",
  );
  const authProofIssuedAtMs = Date.parse(authProofFields.issuedAt);
  assert.equal(
    chatAuth.getChatAuthProofTtlMs(authProofFields.issuedAt, authProofIssuedAtMs + 60_000, 300_000),
    240_000,
    "chat auth replay-lock TTL must come from the canonical issuedAt parser",
  );
  assert.equal(
    chatAuth.getChatAuthProofTtlMs("July 27, 2026 12:00:00 GMT", authProofIssuedAtMs + 60_000, 300_000),
    null,
    "chat auth replay-lock TTL must fail closed on non-canonical issuedAt values",
  );
  const adminAuth = adminAuthModule.default ?? adminAuthModule;
  const canonicalAdminProof = adminAuth.buildAdminAuthMessage(authProofFields);
  assert.deepEqual(adminAuth.parseAdminAuthMessage(canonicalAdminProof), authProofFields);
  assert.equal(
    adminAuth.parseAdminAuthMessage(`${canonicalAdminProof}\nUnexpected: altered`),
    null,
    "admin auth must reject altered signed proof text",
  );
  assert.equal(
    adminAuth.parseAdminAuthMessage(adminAuth.buildAdminAuthMessage({
      ...authProofFields,
      issuedAt: "July 27, 2026 12:00:00 GMT",
    })),
    null,
    "admin auth must reject non-canonical issuedAt timestamps",
  );
  for (const chainId of ["059141", "59141.0", "5e4", "0xE705", "9007199254740992"]) {
    assert.equal(
      adminAuth.parseAdminAuthMessage(canonicalAdminProof.replace("Chain ID: 59141", `Chain ID: ${chainId}`)),
      null,
      `admin auth must reject non-canonical chain id ${chainId}`,
    );
  }
  for (const nonce of ["A".repeat(32), "a".repeat(31), "g".repeat(32)]) {
    assert.equal(
      adminAuth.parseAdminAuthMessage(canonicalAdminProof.replace(`Nonce: ${authProofFields.nonce}`, `Nonce: ${nonce}`)),
      null,
      `admin auth must reject non-canonical nonce ${nonce}`,
    );
  }
  assert.equal(
    adminAuth.isAdminAuthIssuedAtValid(authProofFields.issuedAt, Number.POSITIVE_INFINITY),
    false,
    "admin auth issuedAt validation must fail closed on malformed clocks",
  );
  assert.equal(
    adminAuth.getAdminAuthProofTtlMs(authProofFields.issuedAt, authProofIssuedAtMs + 120_000, 300_000),
    180_000,
    "admin auth replay-lock TTL must come from the canonical issuedAt parser",
  );
  assert.equal(
    adminAuth.getAdminAuthProofTtlMs(authProofFields.issuedAt, Number.POSITIVE_INFINITY, 300_000),
    null,
    "admin auth replay-lock TTL must fail closed on malformed clocks",
  );

  const trustedAuthOrigin = trustedAuthOriginModule.default ?? trustedAuthOriginModule;
  assert.equal(
    trustedAuthOrigin.getTrustedAuthOrigin("http://attacker.invalid/api/chat/auth", "production"),
    "https://playlore.xyz",
    "production auth must not derive its signed origin from an untrusted request host",
  );
  assert.equal(
    trustedAuthOrigin.getTrustedAuthOrigin("http://localhost:3000/api/chat/auth", "development"),
    "http://localhost:3000",
  );
  assert.equal(
    withTemporaryEnv({ NEXT_PUBLIC_SITE_URL: "http://not-secure.invalid" }, () =>
      trustedAuthOrigin.getTrustedAuthOrigin("https://playlore.xyz/api/chat/auth", "production"),
    ),
    null,
  );
  assert.equal(
    withTemporaryEnv({ NEXT_PUBLIC_SITE_URL: "https://playlore.xyz/login" }, () =>
      trustedAuthOrigin.getTrustedAuthOrigin("https://playlore.xyz/api/chat/auth", "production"),
    ),
    null,
    "production auth origin must reject site URLs with paths",
  );
  assert.equal(
    withTemporaryEnv({ NEXT_PUBLIC_SITE_URL: "https://playlore.xyz?next=/admin" }, () =>
      trustedAuthOrigin.getTrustedAuthOrigin("https://playlore.xyz/api/chat/auth", "production"),
    ),
    null,
    "production auth origin must reject site URLs with query strings",
  );
  assert.equal(
    withTemporaryEnv({ NEXT_PUBLIC_SITE_URL: "https://user:pass@playlore.xyz" }, () =>
      trustedAuthOrigin.getTrustedAuthOrigin("https://playlore.xyz/api/chat/auth", "production"),
    ),
    null,
    "production auth origin must reject credentialed site URLs",
  );
  assert.equal(
    withTemporaryEnv({ NEXT_PUBLIC_SITE_URL: "https://localhost:3000" }, () =>
      trustedAuthOrigin.getTrustedAuthOrigin("https://playlore.xyz/api/chat/auth", "production"),
    ),
    null,
    "production auth origin must reject localhost site URLs",
  );
  assert.equal(
    withTemporaryEnv({ NEXT_PUBLIC_SITE_URL: "https://intranet" }, () =>
      trustedAuthOrigin.getTrustedAuthOrigin("https://playlore.xyz/api/chat/auth", "production"),
    ),
    null,
    "production auth origin must reject single-label internal hosts",
  );
  assert.equal(
    withTemporaryEnv({ NEXT_PUBLIC_SITE_URL: "https://192.168.1.20" }, () =>
      trustedAuthOrigin.getTrustedAuthOrigin("https://playlore.xyz/api/chat/auth", "production"),
    ),
    null,
    "production auth origin must reject private LAN site URLs",
  );
  for (const [origin, label] of [
    ["https://10.0.0.5", "private 10/8"],
    ["https://172.16.0.5", "private 172.16/12"],
    ["https://100.64.0.5", "carrier-grade NAT 100.64/10"],
    ["https://wallet.local", "local pseudo-domain"],
  ]) {
    assert.equal(
      withTemporaryEnv({ NEXT_PUBLIC_SITE_URL: origin }, () =>
        trustedAuthOrigin.getTrustedAuthOrigin("https://playlore.xyz/api/chat/auth", "production"),
      ),
      null,
      `production auth origin must reject ${label} site URLs`,
    );
  }
  assert.equal(
    withTemporaryEnv({ NEXT_PUBLIC_SITE_URL: "https://preview.test" }, () =>
      trustedAuthOrigin.getTrustedAuthOrigin("https://playlore.xyz/api/chat/auth", "production"),
    ),
    null,
    "production auth origin must reject reserved test domains",
  );
  assert.equal(
    withTemporaryEnv({ NEXT_PUBLIC_SITE_URL: "https://198.51.100.10" }, () =>
      trustedAuthOrigin.getTrustedAuthOrigin("https://playlore.xyz/api/chat/auth", "production"),
    ),
    null,
    "production auth origin must reject documentation-only IPv4 ranges",
  );
  assert.equal(
    withTemporaryEnv({ NEXT_PUBLIC_SITE_URL: "https://[fd00::1]" }, () =>
      trustedAuthOrigin.getTrustedAuthOrigin("https://playlore.xyz/api/chat/auth", "production"),
    ),
    null,
    "production auth origin must reject IPv6 unique-local ranges",
  );
  assert.equal(
    withTemporaryEnv({ NEXT_PUBLIC_SITE_URL: "https://[fe80::1]" }, () =>
      trustedAuthOrigin.getTrustedAuthOrigin("https://playlore.xyz/api/chat/auth", "production"),
    ),
    null,
    "production auth origin must reject IPv6 link-local ranges",
  );
  assert.equal(
    withTemporaryEnv({ NEXT_PUBLIC_SITE_URL: "https://[2001:db8::1]" }, () =>
      trustedAuthOrigin.getTrustedAuthOrigin("https://playlore.xyz/api/chat/auth", "production"),
    ),
    null,
    "production auth origin must reject documentation-only IPv6 ranges",
  );
  assert.equal(
    trustedAuthOrigin.isTrustedAuthUri("https://playlore.xyz/chat", "https://playlore.xyz", "/chat"),
    true,
    "chat auth URI guard must accept the exact canonical chat path",
  );
  for (const unsafeAuthUri of [
    "https://playlore.xyz/admin",
    "https://playlore.xyz/chat?next=/admin",
    "https://playlore.xyz/chat#proof",
    "https://user:pass@playlore.xyz/chat",
  ]) {
    assert.equal(
      trustedAuthOrigin.isTrustedAuthUri(unsafeAuthUri, "https://playlore.xyz", "/chat"),
      false,
      `chat auth URI guard must reject ${unsafeAuthUri}`,
    );
  }
  assert.equal(
    trustedAuthOrigin.isTrustedAuthUri("https://playlore.xyz/chat", "https://playlore.xyz", "/admin"),
    false,
    "admin auth URI guard must not accept chat signed-message paths",
  );

  const canaryContractError = canaryContractErrorModule.default ?? canaryContractErrorModule;
  assert.deepEqual(
    canaryContractError.classifyCanaryContractError({
      cause: { data: { errorName: "EpochClosing" } },
    }),
    { kind: "late-bet", message: "contract custom error EpochClosing" },
  );
  assert.deepEqual(
    canaryContractError.classifyCanaryContractError({
      cause: { cause: { data: { errorName: "ERC20InsufficientBalance" } } },
    }),
    { kind: "insufficient-balance", message: "contract custom error ERC20InsufficientBalance" },
  );
  assert.deepEqual(
    canaryContractError.classifyCanaryContractError({ data: { errorName: "InvalidTileMask" } }),
    { kind: "contract-revert", message: "contract custom error InvalidTileMask" },
  );
  assert.equal(canaryContractError.classifyCanaryContractError({ data: { errorName: "UnknownError" } }), null);
  const estimateGasWithMethodRetry = estimateGasRetryModule.estimateGasWithMethodRetry
    ?? estimateGasRetryModule.default?.estimateGasWithMethodRetry;
  assert.equal(typeof estimateGasWithMethodRetry, "function");
  let estimateAttempts = 0;
  const estimateWaits = [];
  const recoveredEstimate = await estimateGasWithMethodRetry(
    async () => {
      estimateAttempts += 1;
      if (estimateAttempts < 3) throw new Error('Method "eth_estimateGas" is not supported.');
      return 123n;
    },
    async (ms) => estimateWaits.push(ms),
  );
  assert.deepEqual(recoveredEstimate, { value: 123n, retryCount: 2 });
  assert.deepEqual(estimateWaits, [500, 1_000]);
  await assert.rejects(
    () => estimateGasWithMethodRetry(
      async () => { throw new Error("execution reverted"); },
      async () => { throw new Error("must not retry a contract revert"); },
    ),
    /execution reverted/,
  );

  const absoluteTestDbPath = join(tmpdir(), "lore-mainnet.sqlite");
  const validPrivyAppId = "cmprodprivyappid0000000000";
  const validPrivateKey = "1".repeat(64);
  const envParsing = envParsingModule.default ?? envParsingModule;
  const scriptEnvParsing = scriptEnvParsingModule.default ?? scriptEnvParsingModule;
  const utils = utilsModule.default ?? utilsModule;
  const chatAvatarUpload = chatAvatarUploadModule.default ?? chatAvatarUploadModule;
  const chatAvatar = chatAvatarModule.default ?? chatAvatarModule;
  const chatPollDelay = chatPollDelayModule.default ?? chatPollDelayModule;
  const chatMessages = chatMessagesModule.default ?? chatMessagesModule;
  const chatRateLimit = chatRateLimitModule.default ?? chatRateLimitModule;
  const indexerFinality = indexerFinalityModule.default ?? indexerFinalityModule;
  const indexerWatchPolicy = indexerWatchPolicyModule.default ?? indexerWatchPolicyModule;
  const canaryHealthTelemetry = canaryHealthTelemetryModule.default ?? canaryHealthTelemetryModule;
  const autoMineRunSetup = autoMineRunSetupModule.default ?? autoMineRunSetupModule;
  const routeError = routeErrorModule.default ?? routeErrorModule;
  const clientIdentity = clientIdentityModule.default ?? clientIdentityModule;
  const externalRateLimit = externalRateLimitModule.default ?? externalRateLimitModule;
  const sharedRateLimit = sharedRateLimitModule.default ?? sharedRateLimitModule;
  const runtimeMetrics = runtimeMetricsModule.default ?? runtimeMetricsModule;
  const autoMineError = autoMineErrorModule.default ?? autoMineErrorModule;
  const miningShared = miningSharedModule.default ?? miningSharedModule;
  const safetyPoolClaimThreshold = safetyPoolClaimThresholdModule.default ?? safetyPoolClaimThresholdModule;
  const analyticsDepositsStatus = analyticsDepositsStatusModule.default ?? analyticsDepositsStatusModule;
  const autoResolve = autoResolveModule.default ?? autoResolveModule;
  const liveStateSnapshot = liveStateSnapshotModule.default ?? liveStateSnapshotModule;
  const gameDataHelpers = gameDataHelpersModule.default ?? gameDataHelpersModule;
  const gamePollingConfig = gamePollingConfigModule.default ?? gamePollingConfigModule;
  const explorerLinks = explorerLinksModule.default ?? explorerLinksModule;
  const publicConfig = publicConfigModule.default ?? publicConfigModule;
  const productionRuntime = productionRuntimeModule.default ?? productionRuntimeModule;
  const gameConstants = gameConstantsModule.default ?? gameConstantsModule;
  const lineaFees = lineaFeesModule.default ?? lineaFeesModule;
  const sentrySanitize = sentrySanitizeModule.default ?? sentrySanitizeModule;
  const chatSessionClient = chatSessionClientModule.default ?? chatSessionClientModule;
  const chatSession = chatSessionModule.default ?? chatSessionModule;
  const runtimeMonitor = runtimeMonitorModule.default ?? runtimeMonitorModule;
  const boundedJsonBody = boundedJsonBodyModule.default ?? boundedJsonBodyModule;
  const queryParams = queryParamsModule.default ?? queryParamsModule;
  const responseHeaders = responseHeadersModule.default ?? responseHeadersModule;
  const processSnapshot = runtimeMetrics.getRuntimeProcessSnapshot();
  for (const field of ["uptimeSeconds", "rssBytes", "heapUsedBytes", "heapTotalBytes", "externalBytes"]) {
    assert.ok(Number.isFinite(processSnapshot[field]) && processSnapshot[field] >= 0, `${field} must be bounded runtime evidence`);
  }
  const originalProcessUptime = process.uptime;
  const originalProcessMemoryUsage = process.memoryUsage;
  try {
    process.uptime = () => Number.NaN;
    process.memoryUsage = () => ({
      rss: Number.MAX_SAFE_INTEGER + 1,
      heapUsed: -1,
      heapTotal: 123.5,
      external: 1024,
      arrayBuffers: 0,
    });
    const malformedProcessSnapshot = runtimeMetrics.getRuntimeProcessSnapshot();
    assert.equal(malformedProcessSnapshot.uptimeSeconds, 0, "runtime process uptime must fail closed on malformed values");
    assert.equal(
      malformedProcessSnapshot.rssBytes,
      Number.MAX_SAFE_INTEGER,
      "runtime process memory metrics must saturate oversized values",
    );
    assert.equal(malformedProcessSnapshot.heapUsedBytes, 0, "runtime process memory metrics must reject negative values");
    assert.equal(malformedProcessSnapshot.heapTotalBytes, 0, "runtime process memory metrics must reject fractional values");
    assert.equal(malformedProcessSnapshot.externalBytes, 1024, "runtime process memory metrics must preserve valid values");
  } finally {
    process.uptime = originalProcessUptime;
    process.memoryUsage = originalProcessMemoryUsage;
  }
  const runtimeMetricsSource = readFileSync("app/api/_lib/runtimeMetrics.ts", "utf8");
  assert.match(
    runtimeMetricsSource,
    /function normalizeRouteMetricLatencyMs\(value: number\)[\s\S]*Number\.isFinite\(value\)[\s\S]*ROUTE_METRIC_LATENCY_MAX_MS[\s\S]*function formatRouteMetricAverageLatencyMs\(value: number\)[\s\S]*normalizeRouteMetricLatencyMs\(value\)\.toFixed\(2\)/,
    "runtime metrics must bound latency values before snapshot formatting",
  );
  assert.match(
    runtimeMetricsSource,
    /const latencyMs = normalizeRouteMetricLatencyMs\(Date\.now\(\) - token\.startedAt\)[\s\S]*avgLatencyMs: formatRouteMetricAverageLatencyMs\(metric\.avgLatencyMs\)/,
    "runtime metrics must normalize both measured latency and published average latency",
  );
  assert.match(
    runtimeMetricsSource,
    /MAX_ROUTE_METRIC_ENTRIES[\s\S]*MAX_ROUTE_METRIC_KEY_LENGTH[\s\S]*function normalizeRouteMetricKey\(route: string\)[\s\S]*sanitizeSentryPayload\(route\)[\s\S]*slice\(0, MAX_ROUTE_METRIC_KEY_LENGTH\)[\s\S]*function selectRouteMetricKey\(route: string\)[\s\S]*OVERFLOW_ROUTE_METRIC_KEY/,
    "runtime metrics must redact, clamp, and cap route metric labels before map writes",
  );
  assert.match(
    runtimeMetricsSource,
    /MAX_ROUTE_METRIC_COUNT = Number\.MAX_SAFE_INTEGER[\s\S]*function incrementRouteMetricCount\(value: number\)[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*Math\.min\(value \+ 1, MAX_ROUTE_METRIC_COUNT\)[\s\S]*function normalizeRouteMetricStatus\(value: number, fallback: number\)[\s\S]*value >= 100 && value <= 599/,
    "runtime metrics must bound counters and HTTP status values before publishing monitoring snapshots",
  );
  assert.match(
    runtimeMetricsSource,
    /MAX_RUNTIME_PROCESS_METRIC = Number\.MAX_SAFE_INTEGER[\s\S]*function normalizeRuntimeProcessMetric\(value: number\)[\s\S]*Number\.isFinite\(value\)[\s\S]*MAX_RUNTIME_PROCESS_METRIC[\s\S]*function normalizeRuntimeProcessUptimeSeconds\(value: number\)[\s\S]*Math\.floor\(value\)[\s\S]*getRuntimeProcessSnapshot\(\)[\s\S]*normalizeRuntimeProcessUptimeSeconds\(process\.uptime\(\)\)[\s\S]*normalizeRuntimeProcessMetric\(memory\.rss\)/,
    "runtime process snapshots must normalize process evidence before publishing monitoring health",
  );
  assert.doesNotMatch(
    runtimeMetricsSource,
    /metric\.avgLatencyMs\.toFixed\(2\)|const latencyMs = Date\.now\(\) - token\.startedAt|metric\.(?:requests|successes|errors|cacheHits|staleServed|inflightJoined|backgroundRefreshes|inflight) \+= 1|metric\.lastStatus = status|uptimeSeconds: Math\.floor\(process\.uptime\(\)\)|rssBytes: memory\.rss|heapUsedBytes: memory\.heapUsed|heapTotalBytes: memory\.heapTotal|externalBytes: memory\.external/,
    "runtime metrics must not publish raw latency arithmetic directly",
  );
  const unsafeRouteMetricToken = runtimeMetrics.beginRouteMetric(
    `api/runtime/probe https://rpc.example.test/private privateKey=${"a".repeat(64)}`,
  );
  runtimeMetrics.finishRouteMetric(unsafeRouteMetricToken, 200);
  const unsafeRouteMetricKeys = Object.keys(runtimeMetrics.getRuntimeMetricsSnapshot())
    .filter((key) => key.includes("api/runtime/probe"));
  assert.equal(unsafeRouteMetricKeys.length, 1, "runtime metrics must keep a normalized route label for probe routes");
  assert.doesNotMatch(
    unsafeRouteMetricKeys[0],
    /rpc\.example|private|a{64}|https?:/i,
    "runtime metrics route labels must not publish provider URLs or secret-looking material",
  );
  assert.ok(unsafeRouteMetricKeys[0].length <= 120, "runtime metrics route labels must be length-bounded");
  const invalidSuccessStatusToken = runtimeMetrics.beginRouteMetric("api/runtime/status-invalid-success");
  runtimeMetrics.finishRouteMetric(invalidSuccessStatusToken, Number.NaN);
  const invalidFailureStatusToken = runtimeMetrics.beginRouteMetric("api/runtime/status-invalid-failure");
  runtimeMetrics.failRouteMetric(invalidFailureStatusToken, 999);
  const runtimeMetricStatusSnapshot = runtimeMetrics.getRuntimeMetricsSnapshot();
  assert.equal(
    runtimeMetricStatusSnapshot["api/runtime/status-invalid-success"]?.lastStatus,
    200,
    "successful runtime metrics must normalize malformed statuses to a safe success status",
  );
  assert.equal(
    runtimeMetricStatusSnapshot["api/runtime/status-invalid-failure"]?.lastStatus,
    500,
    "failed runtime metrics must normalize malformed statuses to a safe failure status",
  );

  const sanitizedSentryPayload = sentrySanitize.sanitizeSentryPayload({
    exception: {
      values: [{
        value: "wallet 0x1111111111111111111111111111111111111111 failed via https://rpc.example.test/private",
        endpoint: "wss://rpc.example.test/socket?key=secret",
      }],
    },
    extra: {
      walletAddress: "0x2222222222222222222222222222222222222222",
      rpcUrl: "https://rpc.example.test/key",
      provider: { request: "raw wallet payload" },
      safeStatus: "pending",
    },
    request: {
      headers: { authorization: "Bearer synthetic-secret", cookie: "session=synthetic" },
      url: "/api/live-state",
    },
  });
  const serializedSentryPayload = JSON.stringify(sanitizedSentryPayload);
  assert.doesNotMatch(serializedSentryPayload, /0x[1-2]{40}|rpc\.example\.test|synthetic-secret|raw wallet payload/);
  assert.equal(sanitizedSentryPayload.extra.walletAddress, "<redacted>");
  assert.equal(sanitizedSentryPayload.extra.safeStatus, "pending");
  assert.equal(sanitizedSentryPayload.request.url, "/api/live-state");
  const sanitizedInlineSecrets = sentrySanitize.sanitizeSentryPayload(
    `api_key=inline-secret private=${"e".repeat(64)} mnemonic="seed phrase" passphrase=open-sesame webhook_url=https://hooks.example.test/secret dsn=https://sentry.example.test/key rpc_url=https://rpc.example.test/key ws_rpc=wss://rpc.example.test/socket token eyJhbGciOiJIUzI1NiJ9.cGF5bG9hZA.signature authorization Basic dXNlcjpwYXNz`,
  );
  assert.doesNotMatch(sanitizedInlineSecrets, /inline-secret|e{64}|seed phrase|open-sesame|hooks\.example|sentry\.example|rpc\.example|eyJhbGciOiJIUzI1NiJ9|cGF5bG9hZA|dXNlcjpwYXNz|Basic/);
  const sanitizedPrefixedSecrets = sentrySanitize.sanitizeSentryPayload(
    `sk-proj-${"a".repeat(24)} github_pat_${"b".repeat(24)} ghp_${"c".repeat(24)} xoxb-${"d".repeat(24)} re_${"e".repeat(24)}`,
  );
  assert.doesNotMatch(sanitizedPrefixedSecrets, /sk-proj-|github_pat_|ghp_|xoxb-|re_/);
  const sanitizedModernSecretKeys = sentrySanitize.sanitizeSentryPayload({
    apiKey: "plain-api-key",
    clientSecret: "plain-client-secret",
    webhookUrl: "https://hooks.example.test/secret",
    sessionToken: "plain-session-token",
    credentials: { value: "nested-secret" },
    rpcEndpoint: "https://rpc.example.test/private",
  });
  assert.deepEqual(sanitizedModernSecretKeys, {
    apiKey: "<redacted>",
    clientSecret: "<redacted>",
    webhookUrl: "<redacted>",
    sessionToken: "<redacted>",
    credentials: "<redacted>",
    rpcEndpoint: "<redacted>",
  });
  const supportTxHash = `0x${"a".repeat(64)}`;
  const sanitizedSupportLog = sentrySanitize.sanitizeSupportLogPayload({
    epoch: "78",
    nonce: 4,
    retryCount: 2,
    stopReason: "retry-wait",
    txHash: supportTxHash,
    privateKey: `0x${"b".repeat(64)}`,
    walletAddress: `0x${"c".repeat(40)}`,
    error: `Bearer secret via https://rpc.example.test/key ${`0x${"d".repeat(64)}`} calldata=${`0x${"f".repeat(160)}`}`,
  });
  assert.equal(sanitizedSupportLog.txHash, supportTxHash);
  assert.equal(sanitizedSupportLog.epoch, "78");
  assert.equal(sanitizedSupportLog.nonce, 4);
  assert.equal(sanitizedSupportLog.retryCount, 2);
  assert.equal(sanitizedSupportLog.stopReason, "retry-wait");
  assert.equal(sanitizedSupportLog.privateKey, "<redacted>");
  assert.equal(sanitizedSupportLog.walletAddress, "<redacted>");
  assert.doesNotMatch(sanitizedSupportLog.error, /secret|rpc\.example|0x[d]{64}|0x[f]{80,}/i);
  const loggerSource = readFileSync("app/lib/logger.ts", "utf8");
  assert.match(loggerSource, /JSON\.stringify\(value, jsonReplacer, space\) \?\? "null"/);
  assert.match(loggerSource, /sanitizeSupportLogPayload\(sanitize\(data\)\)/);
  assert.match(
    loggerSource,
    /MAX_LOG_STRING_LENGTH[\s\S]*MAX_LOG_ARRAY_ITEMS[\s\S]*MAX_LOG_OBJECT_KEYS[\s\S]*MAX_LOG_DEPTH[\s\S]*function clampSupportLogValue/,
    "support logger must bound string, array, object, and depth growth before persistence/export",
  );
  assert.match(
    loggerSource,
    /safeData = data !== undefined \? clampSupportLogValue\(sanitizeSupportLogPayload\(sanitize\(data\)\)\)/,
    "support logger must redact and clamp structured log data before storing or printing it",
  );
  assert.match(
    loggerSource,
    /msg: clampLogString\(sanitizeSupportLogPayload\(msg\)\)/,
    "support logger must redact and clamp log messages before storing or printing them",
  );
  assert.match(
    loggerSource,
    /clampSupportLogValue\(sanitizeSupportLogPayload\(parsed\)\)/,
    "support log loader must clamp legacy oversized entries before returning the buffer",
  );
  assert.match(
    loggerSource,
    /clampSupportLogValue\(sanitizeSupportLogPayload\(buffer\)\)/,
    "support log export must clamp persisted entries before rendering the text artifact",
  );
  assert.match(loggerSource, /writeError\(`\[\$\{tag\}\]`, entry\.msg, safeData/);
  assert.doesNotMatch(loggerSource, /window\.location\.href/);
  assert.match(
    loggerSource,
    /autoMiner:\s*getAutoMineSupportDiagnostics\(readAutoMineDiagnostics\(\)\)/,
    "support log export must include the safe persisted Auto-Miner snapshot",
  );
  assert.match(
    loggerSource,
    /const parsed = JSON\.parse\(raw\) as unknown[\s\S]*if \(!Array\.isArray\(parsed\)\)[\s\S]*localStorage\.removeItem\(STORAGE_KEY\)/,
    "support log loader must clear corrupt or invalid localStorage instead of returning a non-array buffer",
  );
  assert.match(loggerSource, /safeMeta\s*=\s*clampSupportLogValue\(sanitizeSupportLogPayload\(meta\)\)/);
  assert.match(
    readFileSync("app/hooks/useSound.ts", "utf8"),
    /const raw = localStorage\.getItem\(SOUND_SETTINGS_KEY\)[\s\S]*localStorage\.removeItem\(SOUND_SETTINGS_KEY\)/,
    "sound settings loader must clear corrupt or invalid localStorage entries",
  );
  assert.match(
    readFileSync("app/hooks/useSound.ts", "utf8"),
    /const stored = localStorage\.getItem\(STORAGE_KEY\)[\s\S]*stored !== null && stored !== "true"[\s\S]*localStorage\.removeItem\(STORAGE_KEY\)/,
    "sound muted restore must clear invalid localStorage values",
  );
  const routeErrorSource = readFileSync("app/api/_lib/routeError.ts", "utf8");
  assert.match(routeErrorSource, /describeSafeRouteError\(error\)/);
  assert.match(routeErrorSource, /describeSafeRouteLabel\(route\)/);
  assert.match(routeErrorSource, /sanitizeSentryPayload\(describeRouteError\(error\)\)/);
  assert.match(routeErrorSource, /sanitizeSentryPayload\(extra\)/);
  const safePublicRouteError = routeError.describeSafeRouteError(
    new Error(`rpc_url=https://rpc.example.test/private Bearer synthetic-token privateKey=${"a".repeat(64)} wallet=0x1111111111111111111111111111111111111111`),
  );
  assert.equal(safePublicRouteError.name, "Error");
  assert.doesNotMatch(
    `${safePublicRouteError.name} ${safePublicRouteError.message}`,
    /rpc\.example|synthetic-token|a{64}|1111111111111111111111111111111111111111/i,
    "safe route errors must redact provider URLs, bearer tokens, hex secrets, and wallet addresses",
  );
  {
    const originalConsoleError = console.error;
    const loggedRouteErrors = [];
    try {
      console.error = (...args) => {
        loggedRouteErrors.push(args);
      };
      routeError.logRouteError(
        "/api/live-state?rpc_url=https://rpc.example.test/private",
        new Error("provider https://rpc.example.test/private failed with Bearer synthetic-token"),
        {
          rpcUrl: "https://rpc.example.test/key",
          nested: { privateKey: "0x" + "b".repeat(64), safeStatus: "pending" },
          walletAddress: "0x2222222222222222222222222222222222222222",
        },
      );
    } finally {
      console.error = originalConsoleError;
    }
    assert.equal(loggedRouteErrors.length, 1);
    const serializedRouteLog = JSON.stringify(loggedRouteErrors[0]);
    assert.doesNotMatch(
      serializedRouteLog,
      /rpc\.example|synthetic-token|b{64}|2222222222222222222222222222222222222222/i,
      "route error logger must redact route labels, messages, and structured extras before console output",
    );
    assert.match(serializedRouteLog, /pending/);
  }
  const redactedErrorCatcherSource = readFileSync("app/components/ErrorCatcher.tsx", "utf8");
  assert.match(redactedErrorCatcherSource, /sanitizeSupportLogPayload\(normalizeConsoleArg\(value\)\)/);
  assert.match(redactedErrorCatcherSource, /originalConsoleError\(\.\.\.args\.map\(sanitizeConsoleArg\)\)/);
  const redactedGlobalErrorSource = readFileSync("app/global-error.tsx", "utf8");
  const errorBoundarySource = readFileSync("app/error.tsx", "utf8");
  assert.match(redactedGlobalErrorSource, /safeError\s*=\s*sanitizeSupportLogPayload\(\{/);
  assert.match(redactedGlobalErrorSource, /console\.error\("\[GlobalError\]", safeError\.name, safeError\.message, safeError\.digest\)/);
  assert.match(errorBoundarySource, /safeError\s*=\s*sanitizeSupportLogPayload\(\{[\s\S]*stack: error\.stack\?\.slice\(0, 400\)/);
  assert.match(errorBoundarySource, /log\.error\("ErrorBoundary", "route render error", safeError\)/);
  assert.match(errorBoundarySource, /safeChunkError\s*=\s*sanitizeSupportLogPayload\(\{ message: error\.message\.slice\(0, 180\) \}\)/);
  assert.doesNotMatch(
    errorBoundarySource,
    /log\.error\("ErrorBoundary", "route render error", \{[\s\S]*message: error\.message/,
  );
  const adminOpsRouteSource = readFileSync("app/api/admin/ops/route.ts", "utf8");
  assert.doesNotMatch(
    adminOpsRouteSource,
    /type LogSourceSummary = \{[\s\S]*\n\s*file:\s*string;/,
    "admin ops log source responses must not expose absolute server log paths",
  );
  assert.match(
    errorBoundarySource,
    /min-h-11[\s\S]*Try again[\s\S]*min-h-11[\s\S]*Hard reload/,
    "route error boundary actions must keep 44px touch targets",
  );
  assert.match(
    redactedGlobalErrorSource,
    /minHeight:\s*"44px"[\s\S]*Try again[\s\S]*minHeight:\s*"44px"[\s\S]*Hard reload/,
    "global error boundary actions must keep 44px touch targets",
  );
  const readJsonResponseSource = readFileSync("app/lib/readJsonResponse.ts", "utf8");
  assert.match(readJsonResponseSource, /throw new Error\("Invalid JSON response"\)/);
  assert.match(readJsonResponseSource, /JSON response too large/);
  assert.ok(
    readJsonResponseSource.includes("const JSON_CONTENT_TYPE_RE = /^application\\/(?:json|[a-z0-9!#$&^_.+-]+\\+json)$/;") &&
      /function isJsonContentType[\s\S]*JSON_CONTENT_TYPE_RE\.test\(contentType\)/.test(readJsonResponseSource),
    "client JSON response parsing must reject explicit non-application JSON content types",
  );
  assert.match(
    readJsonResponseSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseContentLengthHeader[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*contentLength === -1/,
    "client JSON response parsing must reject malformed or non-canonical Content-Length instead of broad Number coercion",
  );
  assert.match(
    readJsonResponseSource,
    /const MAX_JSON_RESPONSE_BYTES = 2 \* 1024 \* 1024[\s\S]*function normalizeJsonResponseMaxBytes[\s\S]*Number\.isSafeInteger\(value\) && value > 0 && value <= MAX_JSON_RESPONSE_BYTES[\s\S]*const byteLimit = normalizeJsonResponseMaxBytes\(maxBytes\)[\s\S]*byteLimit === null/,
    "client JSON response parsing must reject invalid maxBytes before body reads",
  );
  const { readJsonResponse } = await import("../app/lib/readJsonResponse.ts");
  assert.deepEqual(
    await readJsonResponse(new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } })),
    { ok: true },
  );
  assert.equal(await readJsonResponse(new Response("", { headers: { "content-type": "application/json" } })), null);
  await assert.rejects(
    () => readJsonResponse(new Response("<html>proxy failure</html>", { headers: { "content-type": "text/html" } })),
    /Invalid JSON response/,
    "client JSON response parsing must reject explicit HTML/text payloads before exposing raw proxy errors",
  );
  await assert.rejects(
    () => readJsonResponse(new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "text/plain+json" } })),
    /Invalid JSON response/,
    "client JSON response parsing must only accept application/json or application/*+json content types",
  );
  for (const malformedContentLength of ["0001", "01", "1e3", "-1", "1.5", (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString()]) {
    await assert.rejects(
      () =>
        readJsonResponse(
          new Response(JSON.stringify({ ok: true }), {
            headers: { "content-type": "application/json", "content-length": malformedContentLength },
          }),
        ),
      /Invalid JSON response/,
      "client JSON response parsing must reject malformed Content-Length before reading API bodies",
    );
  }
  await assert.rejects(
    () =>
      readJsonResponse(
        new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json", "content-length": String(Number.MAX_SAFE_INTEGER) },
        }),
        64,
      ),
    /JSON response too large/,
    "safe-max client Content-Length must be bounded against the helper byte limit before body reads",
  );
  await assert.rejects(
    () =>
      readJsonResponse(
        new Response(JSON.stringify({ value: "x".repeat(128) }), { headers: { "content-type": "application/json" } }),
        64,
      ),
    /JSON response too large/,
    "client JSON response parsing must bound response bodies",
  );
  for (const invalidMaxBytes of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      () =>
        readJsonResponse(
          {
            headers: new Headers({ "content-type": "application/json" }),
            get body() {
              throw new Error("invalid maxBytes must fail before reading the response body");
            },
          },
          invalidMaxBytes,
        ),
      /Invalid JSON response/,
      `client JSON response parsing must reject invalid maxBytes ${String(invalidMaxBytes)}`,
    );
  }
  await assert.rejects(
    () =>
      readJsonResponse(
        {
          headers: new Headers({ "content-type": "application/json" }),
          get body() {
            throw new Error("oversized maxBytes must fail before reading the response body");
          },
        },
        2 * 1024 * 1024 + 1,
      ),
    /Invalid JSON response/,
    "client JSON response parsing must reject response byte limits above the helper-wide cap before body reads",
  );
  assert.deepEqual(
    await readJsonResponse(
      new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } }),
      2 * 1024 * 1024,
    ),
    { ok: true },
    "client JSON response parsing must preserve the exact helper-wide cap as a valid byte limit",
  );
  await assert.rejects(
    () =>
      readJsonResponse(
        new Response(new Uint8Array([...new TextEncoder().encode('{"value":"'), 0xff, ...new TextEncoder().encode('"}')]), {
          headers: { "content-type": "application/json" },
        }),
      ),
    /Invalid JSON response/,
    "client JSON response parsing must fail closed on malformed UTF-8 instead of accepting replacement characters",
  );
  assert.match(
    readJsonResponseSource,
    /new TextDecoder\("utf-8", \{ fatal: true \}\)/,
    "client JSON response parsing must use fatal UTF-8 decoding",
  );
  assert.doesNotMatch(
    readJsonResponseSource,
    /Invalid JSON response:\s*\$\{raw\.slice/,
    "JSON response parsing failures must not expose raw response bodies",
  );
  const safeRouteError = routeError.describeSafeRouteError(
    new Error(`RPC https://rpc.example.test/private failed for 0x${"ab".repeat(20)}`),
  );
  assert.equal(safeRouteError.message.includes("rpc.example.test"), false);
  assert.equal(safeRouteError.message.includes("ab".repeat(20)), false);
  const safeQueryRouteError = routeError.describeSafeRouteError(
    new Error(
      `request failed: rpc_url=https://rpc.example.test/?key=inline-secret wallet=0x${"12".repeat(20)} authorization=Bearer synthetic-token`,
    ),
  );
  assert.doesNotMatch(
    safeQueryRouteError.message,
    /rpc\.example|inline-secret|0x[12]{40}|Bearer|synthetic-token/i,
    "safe route errors must redact query-style RPC, wallet, and auth tokens",
  );
  const clampedRouteError = routeError.describeSafeRouteError(
    new Error(`first line\n${"x".repeat(1_000)}`),
  );
  assert.equal(clampedRouteError.message.includes("\n"), false);
  assert.ok(clampedRouteError.message.length <= 600, "safe route errors must keep log lines bounded");
  const controlCharRouteError = routeError.describeSafeRouteError(new Error("bad\u0000route\u0007error"));
  assert.doesNotMatch(
    controlCharRouteError.message,
    /[\u0000-\u001f\u007f]/,
    "safe route errors must strip ASCII control characters from messages",
  );
  const routeLabelLogs = [];
  const routeExtraLogs = [];
  const originalConsoleError = console.error;
  console.error = (...args) => {
    routeLabelLogs.push(args.map(String).join(" "));
    routeExtraLogs.push(args);
  };
  try {
    routeError.logRouteError(
      `/api/${"x".repeat(180)}?rpc=https://rpc.example.test/private&wallet=0x${"cd".repeat(20)}\nnext\u0000tail`,
      new Error("synthetic route label failure\u0007"),
      {
        safe: true,
        longText: `secret\u0000 ${"z".repeat(1_000)}`,
        [`rpc=https://rpc.example.test/private&wallet=0x${"ef".repeat(20)}`]: "key must be redacted",
        many: Array.from({ length: 20 }, (_, index) => index),
        nested: {
          authorization: "Bearer nested-secret",
          webhookUrl: "https://hooks.example.test/private",
          value: { deeper: { final: "kept", tooDeep: { hidden: true } } },
        },
        ...Object.fromEntries(Array.from({ length: 24 }, (_, index) => [`extraKey${index}`, index])),
      },
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(routeLabelLogs.length, 1, "route error logger must emit one sanitized log line");
  assert.doesNotMatch(routeLabelLogs[0], /rpc\.example|0x[cd]{40}|[\u0000-\u001f\u007f]/);
  assert.ok(routeLabelLogs[0].split("]")[0].length <= 121, "route error labels must stay bounded");
  const loggedRouteExtra = routeExtraLogs[0]?.[1];
  assert.ok(loggedRouteExtra, "route error logger must keep sanitized extra context when present");
  assert.equal(String(loggedRouteExtra.longText).length <= 240, true, "route error extra strings must stay bounded");
  assert.equal(loggedRouteExtra.many.length, 8, "route error extra arrays must stay bounded");
  assert.equal(Object.keys(loggedRouteExtra).length <= 16, true, "route error extra objects must stay bounded");
  assert.doesNotMatch(JSON.stringify(loggedRouteExtra), /z{300}|rpc\.example|hooks\.example|nested-secret|0x[cd]{40}|0x[ef]{40}|[\u0000-\u001f\u007f]/);
  const standardBetPathSource = readFileSync("app/hooks/useMiningStandardBetPath.ts", "utf8");
  const miningReceiptSource = readFileSync("app/hooks/useMiningReceipt.ts", "utf8");
  [
    "app/hooks/useLineaOreWalletRuntime.ts",
    "app/hooks/useMining.ts",
    "app/hooks/useMiningAllowance.ts",
    "app/hooks/useMiningAutoMineLoop.ts",
    "app/hooks/useMiningAutoMineRunner.ts",
    "app/hooks/useMiningBetExecution.ts",
    "app/hooks/useMiningManualActions.ts",
    "app/hooks/useMiningRoundBetting.ts",
    "app/hooks/useMiningStandardBetPath.ts",
    "app/hooks/useWalletActions.ts",
    "app/hooks/useWalletTransfers.ts",
    "app/lib/mining/autoMineBootstrap.ts",
    "app/lib/mining/autoMineLoopAdapter.ts",
    "app/lib/mining/autoMineLoopRoundCommand.ts",
    "app/lib/mining/autoMineRunSetup.ts",
    "app/lib/mining/manualMineAttempt.ts",
  ].forEach(assertNoRemovedWalletExperimentInStandardFlow);
  assert.match(
    standardBetPathSource,
    /bet transaction submitted[\s\S]*hash,[\s\S]*nonce: nonce \?\? null/,
    "support logs must capture the submitted bet hash and known nonce without wallet identity",
  );
  assert.match(
    standardBetPathSource,
    /writePendingMiningTxState\(\{[\s\S]*chainId: APP_CHAIN_ID,[\s\S]*contract: CONTRACT_ADDRESS,[\s\S]*actor: actor as `0x\$\{string\}`,[\s\S]*hash,[\s\S]*nonce/,
    "mining wallet writes must persist chain, contract, actor, hash, and nonce before waiting for receipt recovery",
  );
  assert.match(
    standardBetPathSource,
    /const state = await waitReceipt\(hash, client\);[\s\S]*if \(state === "confirmed" && actor\) \{[\s\S]*clearPendingMiningTxState\(APP_CHAIN_ID, CONTRACT_ADDRESS, actor\)/,
    "mining wallet writes must clear pending recovery state only after a confirmed receipt",
  );
  assert.match(
    standardBetPathSource,
    /if \(recovery === "pending" \|\| recovery === "manual-reconciliation-required"\) return "pending";[\s\S]*clearPendingMiningTxState\(APP_CHAIN_ID, CONTRACT_ADDRESS, actor\);[\s\S]*return null;/,
    "mining wallet recovery must block duplicate sends while a tracked pending transaction remains unresolved",
  );
  assert.match(
    miningReceiptSource,
    /waitForTransactionReceipt\(\{ hash, timeout: TX_RECEIPT_TIMEOUT_MS \}\)[\s\S]*receipt\.status === "reverted"[\s\S]*Transaction reverted \(hash: \$\{hash\}\)[\s\S]*const lateReceipt = await client\.getTransactionReceipt\(\{ hash \}\);[\s\S]*lateReceipt\.status === "reverted"[\s\S]*Transaction reverted \(hash: \$\{hash\}\)/,
    "manual and Auto-Miner receipt waits must throw explicit reverted errors from both primary and late receipt checks",
  );
  const miningAllowanceSource = readFileSync("app/hooks/useMiningAllowance.ts", "utf8");
  assert.match(
    miningAllowanceSource,
    /function computeAllowancePollDeadline[\s\S]*Number\.isSafeInteger\(now\)[\s\S]*Number\.isSafeInteger\(timeoutMs\)[\s\S]*timeoutMs > Number\.MAX_SAFE_INTEGER - now[\s\S]*const deadline = computeAllowancePollDeadline\(Date\.now\(\), timeoutMs\)/,
    "approve allowance polling must compute deadlines through safe integer timeout normalization",
  );
  assert.match(
    miningAllowanceSource,
    /function normalizeApprovalNonce\(value: unknown\)[\s\S]*typeof value === "bigint"[\s\S]*value > BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*typeof value !== "number" \|\| !Number\.isSafeInteger\(value\)[\s\S]*function selectApprovalSubmissionNonce[\s\S]*function getPendingApproveAgeMs[\s\S]*pendingApprove\.submittedAt > now \+ 5_000[\s\S]*const trackedApprovalNonce = pendingApproveRef\.current\?\.nonce[\s\S]*const approvalNonceRaw = trackedApprovalNonce \?\? await withMiningRpcTimeout[\s\S]*blockTag: "pending"[\s\S]*const approvalNonce = selectApprovalSubmissionNonce\(trackedApprovalNonce, approvalNonceRaw\)[\s\S]*Approval nonce is unavailable or unsafe[\s\S]*const pendingAgeMs = pendingApproveRef\.current[\s\S]*getPendingApproveAgeMs\(pendingApproveRef\.current, Date\.now\(\)\)[\s\S]*Approval pending state is unavailable or unsafe/,
    "approve nonce selection must reject unsafe RPC or pending nonce evidence before wallet submission",
  );
  assert.match(
    miningAllowanceSource,
    /function assertPendingApproveReplacementReady\(pendingApprove: PendingApproveState, waitMessage: string\)[\s\S]*getPendingApproveAgeMs\(pendingApprove, Date\.now\(\)\)[\s\S]*pendingAgeMs <= APPROVE_PENDING_TIMEOUT_MS[\s\S]*throw new Error\(waitMessage\)[\s\S]*if \(pendingApproveRef\.current\) \{[\s\S]*assertPendingApproveReplacementReady\([\s\S]*Approval transaction is still pending\. Wait for confirmation before placing a bet\./,
    "approval duplicate-send guard must stop manual approve replacement until pending timeout",
  );
  assert.doesNotMatch(
    miningAllowanceSource,
    /Date\.now\(\) \+ timeoutMs|pendingApproveRef\.current\?\.nonce \?\? Number\(|Date\.now\(\) - pendingApproveRef\.current\.submittedAt/,
    "approve allowance flow must not return to broad deadline, nonce, or pending-age coercion",
  );
  const autoMineBootstrapAllowanceSource = readFileSync("app/lib/mining/autoMineBootstrap.ts", "utf8");
  assert.match(
    autoMineBootstrapAllowanceSource,
    /function computeBootstrapAllowancePollDeadline[\s\S]*Number\.isSafeInteger\(now\)[\s\S]*Number\.isSafeInteger\(timeoutMs\)[\s\S]*timeoutMs > Number\.MAX_SAFE_INTEGER - now[\s\S]*function normalizeBootstrapApprovalNonce[\s\S]*typeof value === "bigint"[\s\S]*value > BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*function selectBootstrapApprovalSubmissionNonce[\s\S]*function getPendingApproveAgeMs[\s\S]*pendingApprove\.submittedAt > now \+ 5_000[\s\S]*function formatLineaWeiOneDecimal[\s\S]*10n \*\* 18n[\s\S]*roundedTenths[\s\S]*const have = formatLineaWeiOneDecimal\(initBalance\)[\s\S]*const need = formatLineaWeiOneDecimal\(roundCost\)[\s\S]*const deadline = computeBootstrapAllowancePollDeadline\(Date\.now\(\), timeoutMs\)[\s\S]*while \(autoMineActive\(\) && Date\.now\(\) < deadline\)[\s\S]*const trackedApprovalNonce = pendingApproveRef\.current\?\.nonce[\s\S]*const approvalNonceRaw = trackedApprovalNonce \?\? await withMiningRpcTimeout[\s\S]*blockTag: "pending"[\s\S]*approvalNonce = selectBootstrapApprovalSubmissionNonce\(trackedApprovalNonce, approvalNonceRaw\)[\s\S]*Approval nonce is unavailable or unsafe[\s\S]*const pendingAgeMs = getPendingApproveAgeMs\(pendingApproveRef\.current, Date\.now\(\)\)[\s\S]*Approval pending state is unavailable or unsafe/,
    "Auto-Miner bootstrap approval must reject unsafe nonce and pending-age evidence before approval retry or replacement decisions",
  );
  assert.match(
    autoMineBootstrapAllowanceSource,
    /function assertPendingApproveReplacementReady\(pendingApprove: PendingApproveState, waitMessage: string\)[\s\S]*getPendingApproveAgeMs\(pendingApprove, Date\.now\(\)\)[\s\S]*pendingAgeMs <= APPROVE_PENDING_TIMEOUT_MS[\s\S]*throw new Error\(waitMessage\)[\s\S]*if \(pendingApproveRef\.current\) \{[\s\S]*assertPendingApproveReplacementReady\([\s\S]*Approval transaction is still pending\. Wait for confirmation before auto-mine continues\./,
    "approval duplicate-send guard must stop Auto-Miner approve replacement until pending timeout",
  );
  assert.ok(
    miningAllowanceSource.includes("Approval transaction is still pending. Wait for confirmation before placing a bet.") &&
      autoMineBootstrapAllowanceSource.includes("Approval transaction is still pending. Wait for confirmation before auto-mine continues."),
    "approval duplicate-send guard must stop manual and Auto-Miner approve replacement until pending timeout",
  );
  assert.doesNotMatch(
    autoMineBootstrapAllowanceSource,
    /pendingApproveRef\.current\?\.nonce \?\? Number\(|Date\.now\(\) - pendingApproveRef\.current\.submittedAt|Date\.now\(\) - startedAt < timeoutMs|Number\(initBalance\)|Number\(roundCost\)/,
    "Auto-Miner bootstrap approval must not use broad nonce coercion, raw pending-age arithmetic, raw poll timeout arithmetic, or broad balance formatting",
  );
  const roundBettingNonceSource = readFileSync("app/hooks/useMiningRoundBetting.ts", "utf8");
  assert.match(
    roundBettingNonceSource,
    /function normalizeAutoMineNonce[\s\S]*typeof value === "bigint"[\s\S]*value > BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*function normalizePendingBetState[\s\S]*normalizeAutoMineNonce\(value\.nonce\)[\s\S]*value\.submittedAt > now \+ 5_000[\s\S]*const latestNonce = normalizeAutoMineNonce\(latestNonceRaw\)[\s\S]*const pendingNonce = normalizeAutoMineNonce\(pendingNonceRaw\)[\s\S]*Pending nonce status is unavailable or unsafe[\s\S]*const trackedPendingBet = normalizePendingBetState\(pendingBet, now\)[\s\S]*Tracked pending bet state is unavailable or unsafe/,
    "Auto-Miner bet loop must reject unsafe latest/pending nonce evidence before replacement or duplicate-send decisions",
  );
  assert.match(
    roundBettingNonceSource,
    /const waitSeconds = formatRetryWaitSeconds\(wait\)[\s\S]*retry in \$\{waitSeconds\}s/,
    "Auto-Miner bet loop retry progress must format wait seconds through the shared bounded helper",
  );
  assert.doesNotMatch(
    roundBettingNonceSource,
    /\(wait \/ 1000\)\.toFixed\(0\)/,
    "Auto-Miner bet loop retry progress must not use raw wait toFixed display",
  );
  assert.doesNotMatch(
    roundBettingNonceSource,
    /const latestNonce = Number\(latestNonceRaw\)|const pendingNonce = Number\(pendingNonceRaw\)|Date\.now\(\) - pendingBet\.submittedAt|pendingNonce > pendingBet\.nonce|txNonce = pendingBet\.nonce/,
    "Auto-Miner bet loop must not use broad nonce coercion or raw tracked pending-bet state",
  );
  const walletActionsNonceRecoverySource = readFileSync("app/hooks/useWalletActions.ts", "utf8");
  assert.match(
    walletActionsNonceRecoverySource,
    /function normalizePendingTransactionNonce[\s\S]*typeof value === "bigint"[\s\S]*value > BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*const latestNonce = normalizePendingTransactionNonce\(latestNonceRaw\)[\s\S]*const pendingNonce = normalizePendingTransactionNonce\(pendingNonceRaw\)[\s\S]*Pending transaction nonce evidence is unavailable or unsafe/,
    "wallet settings pending-tx recovery must reject unsafe latest/pending nonce evidence before exposing a nonce gap",
  );
  assert.doesNotMatch(
    walletActionsNonceRecoverySource,
    /const latestNonce = Number\(latestNonceRaw\)|const pendingNonce = Number\(pendingNonceRaw\)/,
    "wallet settings pending-tx recovery must not use broad Number coercion for nonce evidence",
  );
  const autoMineLoopSource = readFileSync("app/hooks/useMiningAutoMineLoop.ts", "utf8");
  assert.match(
    autoMineLoopSource,
    /writeAutoMineDiagnostics\(\{[\s\S]*lastEpoch: outcome\.placedEpoch\.toString\(\),[\s\S]*retryCount: 0/,
    "Auto-Miner diagnostics must retain the latest confirmed epoch and reset retries",
  );
  assert.match(
    autoMineLoopSource,
    /formatRetryWaitSeconds\(waitMs\)[\s\S]*formatRetryWaitSeconds\(retryDecision\.waitMs\)/,
    "Auto-Miner loop retry logs must format wait seconds through the shared bounded helper",
  );
  assert.doesNotMatch(
    autoMineLoopSource,
    /\([^)]*waitMs[^)]*\/ 1000\)\.toFixed\(0\)|\([^)]*retryDecision\.waitMs[^)]*\/ 1000\)\.toFixed\(0\)/,
    "Auto-Miner loop retry logs must not use raw wait toFixed display",
  );
  assert.match(
    autoMineLoopSource,
    /writeAutoMineDiagnostics\(\{ retryCount/,
    "Auto-Miner diagnostics must retain retry progress for support export",
  );

  assert.deepEqual(
    runtimeMonitor.evaluateRuntimeSnapshot({
      runtime: { status: "ok" },
      dataSync: { status: "healthy", storage: { lagToFinalityTargetBlocks: 1 }, env: { lagWarnBlocks: 5 } },
      liveState: { currentEpoch: "42", epochEndTime: "100", currentEpochData: ["1000", "0", "0", false], fetchedAt: 220_000 },
      nowMs: 221_000,
      stuckGraceMs: 120_000,
    }),
    [{ key: "stuck-non-empty-epoch", message: "Non-empty epoch #42 is overdue by 121s and still unresolved." }],
  );
  assert.deepEqual(
    runtimeMonitor.evaluateRuntimeSnapshot({
      runtime: { status: "ok" },
      dataSync: { status: "healthy", storage: { lagToFinalityTargetBlocks: 1 }, env: { lagWarnBlocks: 5 } },
      liveState: { currentEpoch: "43", epochEndTime: "100", currentEpochData: ["0", "0", "0", false], fetchedAt: 499_000 },
      nowMs: 500_000,
    }),
    [],
  );
  assert.deepEqual(
    runtimeMonitor.evaluateRuntimeSnapshot({
      runtime: { status: "ok" },
      dataSync: { status: "healthy" },
      liveState: { currentEpoch: "44", epochEndTime: "100", currentEpochData: ["1000", "0", "0", false], fetchedAt: 1 },
      nowMs: 500_000,
    }),
    [{ key: "live-state-stale", message: "Live-state snapshot is missing or stale." }],
  );
  assert.deepEqual(
    runtimeMonitor.evaluateRuntimeSnapshot({
      runtime: { status: "ok" },
      dataSync: { status: "healthy" },
      liveState: { currentEpoch: "45", epochEndTime: "100", currentEpochData: ["0", "0", "0", false], fetchedAt: 500_000 },
      nowMs: Number.NaN,
    }).map((issue) => issue.key),
    ["runtime-snapshot-invalid"],
    "runtime monitor snapshot evaluation must fail closed on malformed monitor clocks",
  );
  assert.deepEqual(
    runtimeMonitor.evaluateRuntimeSnapshot({
      runtime: { status: "ok" },
      dataSync: { status: "healthy" },
      liveState: { currentEpoch: "46", epochEndTime: "100", currentEpochData: ["0", "0", "0", false], fetchedAt: 440_000 },
      nowMs: 500_000,
      maxLiveStateAgeMs: Number.NaN,
    }),
    [],
    "runtime monitor snapshot evaluation must fall back to the safe live-state freshness window",
  );
  assert.deepEqual(
    runtimeMonitor.evaluateRuntimeSnapshot({
      runtime: { status: "ok" },
      dataSync: { status: "healthy" },
      liveState: { currentEpoch: "48", epochEndTime: "100", currentEpochData: ["0", "0", "0", false], fetchedAt: 620_001 },
      nowMs: 500_000,
      maxLiveStateAgeMs: 300_000,
    }),
    [{ key: "live-state-stale", message: "Live-state snapshot is missing or stale." }],
    "runtime monitor snapshot evaluation must reject future live-state fetchedAt evidence outside clock-skew tolerance",
  );
  assert.deepEqual(
    runtimeMonitor.evaluateRuntimeSnapshot({
      runtime: { status: "ok" },
      dataSync: { status: "healthy" },
      liveState: { currentEpoch: "47", epochEndTime: "379", currentEpochData: ["1000", "0", "0", false], fetchedAt: 500_000 },
      nowMs: 500_000,
      stuckGraceMs: Number.NaN,
    }).map((issue) => issue.key),
    ["stuck-non-empty-epoch"],
    "runtime monitor snapshot evaluation must fall back to the safe stuck-epoch grace window",
  );
  const activeRuntimeIssues = new Map();
  const runtimeIssue = { key: "indexer-heartbeat", message: "Indexer heartbeat is stale." };
  assert.deepEqual(runtimeMonitor.reconcileRuntimeIssues(activeRuntimeIssues, [runtimeIssue]), {
    alerts: [runtimeIssue],
    recoveries: [],
  });
  assert.deepEqual(runtimeMonitor.reconcileRuntimeIssues(activeRuntimeIssues, [runtimeIssue]), {
    alerts: [],
    recoveries: [],
  });
  assert.deepEqual(runtimeMonitor.reconcileRuntimeIssues(activeRuntimeIssues, []), {
    alerts: [],
    recoveries: [runtimeIssue],
  });

  assert.equal(
    miningShared.getBetErrorMessage(new Error("HTTP request failed: private provider endpoint")),
    "Bet failed: RPC unavailable. Check your connection and try again.",
  );
  assert.equal(
    miningShared.getBetErrorMessage(
      Object.assign(new Error("Privy sendTransaction timed out after 45000ms against private provider"), {
        name: "WalletSendTimeoutError",
      }),
    ),
    "Bet status is still pending or unavailable. Check wallet activity before retrying.",
  );
  assert.equal(
    miningShared.getBetErrorMessage(
      Object.assign(new Error("transaction receipt could not be found for provider hash"), {
        name: "TransactionReceiptNotFoundError",
      }),
    ),
    "Bet status is still pending or unavailable. Check wallet activity before retrying.",
  );
  assert.equal(
    miningShared.getBetErrorMessage(
      Object.assign(new Error("must have valid access token and privy wallet for private session"), {
        name: "PrivyApiError",
      }),
    ),
    "Bet failed: wallet session expired. Log in again and retry.",
  );
  assert.equal(
    miningShared.getBetErrorMessage(new Error("embedded wallet not found for current actor")),
    "Bet failed: Privy wallet is not ready. Reconnect and retry.",
  );
  assert.equal(
    miningShared.getBetErrorMessage(new Error("Connector chain mismatch: wallet is on the wrong network")),
    "Bet failed: wallet is on the wrong network. Switch to Linea Sepolia and retry.",
  );
  assert.equal(
    miningShared.getBetErrorMessage(new Error("insufficient funds for gas * price + value")),
    "Bet failed: not enough ETH for gas on Privy wallet.",
  );
  assert.equal(
    miningShared.getBetErrorMessage(new Error("execution reverted: internal provider payload")),
    "Bet reverted on-chain. No bet was placed.",
  );
  assert.equal(
    miningShared.getBetErrorMessage(new Error("execution reverted: ERC20InsufficientAllowance")),
    "Bet failed: token approve is still pending or too low. Wait for approve confirmation, then retry.",
  );
  assert.equal(
    miningShared.getBetErrorMessage(new Error("transfer amount exceeds balance")),
    "Bet failed: not enough LINEA token balance.",
  );
  assert.equal(
    miningShared.getBetErrorMessage(new Error("unclassified provider detail")),
    "Bet failed. Try again or export logs if the problem continues.",
  );
  assert.equal(
    miningShared.getBetErrorMessage(new Error("The contract function reverted with UnexpectedEpoch()")),
    "Bet failed: epoch already ended. Try again.",
  );
  assert.equal(miningShared.isEpochEndedError(new Error("UnexpectedEpoch()")), true);
  assert.equal(miningShared.isDeterministicBetExecutionError(new Error("UnexpectedEpoch()")), true);
  assert.equal(
    miningShared.getBetErrorMessage(new Error("Configured contract is missing required epoch-bound betting support.")),
    "Betting is unavailable: configured contract does not support protected V10 bets.",
  );
  assert.equal(
    miningShared.isDeterministicBetExecutionError(
      new Error("Configured contract is missing required epoch-bound betting support."),
    ),
    true,
  );
  assert.equal(
    autoMineError.getAutoMineUserMessage(
      new Error("Configured contract is missing required epoch-bound betting support."),
    ).userMessage,
    "Auto-miner stopped: configured contract does not support protected V10 bets.",
  );
  assert.equal(
    autoMineError.getAutoMineUserMessage(new Error("unclassified provider detail")).userMessage,
    "Auto-miner stopped. Try again or export logs if the problem continues.",
  );

  assert.equal(lineaFees.getLineaFeeOverrides({ maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n }, 59141)?.maxPriorityFeePerGas, 80_000_000n);
  assert.equal(publicConfig.getContractRequiresEpochBoundBets("1"), true);
  assert.equal(publicConfig.getContractRequiresEpochBoundBets("true"), true);
  assert.equal(publicConfig.getContractRequiresEpochBoundBets("0"), false);
  assert.equal(publicConfig.getContractRequiresEpochBoundBets("bogus"), false);
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
  assert.deepEqual(
    publicConfig.getPreferredLineaRpcs(" https://rpc-a.test , https://rpc-b.test ,, https://linea-sepolia.drpc.org ", "sepolia"),
    [
      "https://rpc-a.test",
      "https://rpc-b.test",
      "https://linea-sepolia.drpc.org",
      "https://linea-sepolia-rpc.publicnode.com",
      "https://rpc.sepolia.linea.build",
    ],
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
  assert.equal(envParsing.parseOptionalNonNegativeNumberEnv(String(Number.MAX_SAFE_INTEGER), 256), Number.MAX_SAFE_INTEGER);
  assert.equal(envParsing.parseOptionalNonNegativeNumberEnv((BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString(), 256), 256);
  assert.equal(envParsing.parseOptionalPositiveIntegerEnv("bad", 15_000), 15_000);
  assert.equal(envParsing.parseOptionalPositiveIntegerEnv("0", 15_000), 15_000);
  assert.equal(envParsing.parseOptionalPositiveIntegerEnv("-1", 15_000), 15_000);
  assert.equal(envParsing.parseOptionalPositiveIntegerEnv("1e3", 15_000), 15_000);
  assert.equal(envParsing.parseOptionalPositiveIntegerEnv("90000", 15_000), 90_000);
  assert.equal(envParsing.parseOptionalPositiveIntegerInRangeEnv("bad", 3, 1, 24), 3);
  assert.equal(envParsing.parseOptionalPositiveIntegerInRangeEnv("0", 3, 1, 24), 3);
  assert.equal(envParsing.parseOptionalPositiveIntegerInRangeEnv("12", 3, 1, 24), 12);
  assert.equal(envParsing.parseOptionalPositiveIntegerInRangeEnv("999", 3, 1, 24), 24);
  assert.equal(scriptEnvParsing.parsePositiveIntegerEnv("bad", 60_000), 60_000);
  assert.equal(scriptEnvParsing.parsePositiveIntegerEnv("0", 60_000), 60_000);
  assert.equal(scriptEnvParsing.parsePositiveIntegerEnv("01", 60_000), 60_000);
  assert.equal(scriptEnvParsing.parsePositiveIntegerEnv("1e3", 60_000), 60_000);
  assert.equal(scriptEnvParsing.parsePositiveIntegerEnv("90000", 60_000), 90_000);
  assert.equal(scriptEnvParsing.parsePositiveIntegerEnv(String(Number.MAX_SAFE_INTEGER), 60_000), Number.MAX_SAFE_INTEGER);
  assert.equal(scriptEnvParsing.parsePositiveIntegerEnv((BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString(), 60_000), 60_000);
  assert.equal(scriptEnvParsing.parsePositiveIntegerInRangeEnv("999", 3, 1, 24), 24);
  assert.equal(scriptEnvParsing.parseNonNegativeNumberInRangeEnv("-1", 0.01, 0, 1), 0.01);
  assert.equal(scriptEnvParsing.parseNonNegativeNumberInRangeEnv("1.5", 0.01, 0, 1), 1);
  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(
      new Request("https://play.example/api", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true }),
      }),
      64,
    ),
    { ok: true, value: { ok: true } },
  );
  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(
      new Request("https://play.example/api", {
        method: "POST",
        headers: { "content-length": "65" },
        body: "{}",
      }),
      64,
    ),
    { ok: false, reason: "too-large" },
  );
  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(
      new Request("https://play.example/api", {
        method: "POST",
        headers: { "content-length": String(Number.MAX_SAFE_INTEGER) },
        body: "{}",
      }),
      64,
    ),
    { ok: false, reason: "too-large" },
    "safe-max Content-Length must be bounded against the route byte limit before body reads",
  );
  for (const malformedContentLength of ["01", "1e3", "-1", "1.5", (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString()]) {
    assert.deepEqual(
      await boundedJsonBody.readBoundedJsonBody(
        new Request("https://play.example/api", {
          method: "POST",
          headers: { "content-length": malformedContentLength },
          body: "{}",
        }),
        64,
      ),
      { ok: false, reason: "invalid" },
      `malformed Content-Length ${malformedContentLength} must not be broadly coerced`,
    );
  }
  for (const invalidMaxBytes of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(
      await boundedJsonBody.readBoundedJsonBody(
        {
          headers: new Headers({ "content-type": "application/json" }),
          get body() {
            throw new Error("invalid maxBytes must fail before reading the request body");
          },
        },
        invalidMaxBytes,
      ),
      { ok: false, reason: "invalid" },
      `invalid JSON maxBytes ${String(invalidMaxBytes)} must fail closed before body reads`,
    );
  }
  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(
      {
        headers: new Headers({ "content-type": "application/json" }),
        get body() {
          throw new Error("oversized maxBytes config must fail before reading the request body");
        },
      },
      256 * 1024 + 1,
    ),
    { ok: false, reason: "invalid" },
    "bounded JSON body parser must reject route byte limits above the API-wide cap before body reads",
  );
  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(
      new Request("https://play.example/api", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true }),
      }),
      256 * 1024,
    ),
    { ok: true, value: { ok: true } },
    "bounded JSON body parser must preserve the exact API-wide cap as a valid route byte limit",
  );
  let oversizedCancelCalled = false;
  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(
      new Request("https://play.example/api", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(JSON.stringify({ value: "x".repeat(65) })));
          },
          cancel() {
            oversizedCancelCalled = true;
            throw new Error("synthetic cancel failure");
          },
        }),
        duplex: "half",
      }),
      64,
    ),
    { ok: false, reason: "too-large" },
    "oversized JSON body must stay classified as too-large even if stream cancellation fails",
  );
  assert.equal(oversizedCancelCalled, true, "oversized JSON body should cancel the unread request stream");
  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(
      new Request("https://play.example/api", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "x".repeat(65) }),
      }),
      64,
    ),
    { ok: false, reason: "too-large" },
  );
  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(
      new Request("https://play.example/api", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ ok: true }),
      }),
      64,
    ),
    { ok: false, reason: "unsupported-content-type" },
  );
  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(
      new Request("https://play.example/api", {
        method: "POST",
        headers: { "content-type": "text/plain+json" },
        body: JSON.stringify({ ok: true }),
      }),
      64,
    ),
    { ok: false, reason: "unsupported-content-type" },
    "bounded JSON body parser must only accept application/json or application/*+json content types",
  );
  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(
      new Request("https://play.example/api", {
        method: "POST",
        body: JSON.stringify({ ok: true }),
      }),
      64,
    ),
    { ok: false, reason: "unsupported-content-type" },
  );
  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(
      new Request("https://play.example/api", {
        method: "POST",
        headers: { "content-type": "application/vnd.lore+json; charset=utf-8" },
        body: JSON.stringify({ ok: true }),
      }),
      64,
    ),
    { ok: true, value: { ok: true } },
  );
  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(
      new Request("https://play.example/api", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }),
      64,
    ),
    { ok: false, reason: "invalid" },
  );
  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(
      new Request("https://play.example/api", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: new Uint8Array([...new TextEncoder().encode('{"value":"'), 0xff, ...new TextEncoder().encode('"}')]),
      }),
      64,
    ),
    { ok: false, reason: "invalid" },
    "bounded JSON body parser must fail closed on malformed UTF-8 instead of accepting replacement characters",
  );
  assert.match(
    readFileSync("app/api/_lib/boundedJsonBody.ts", "utf8"),
    /await reader\.cancel\(\)\.catch\(\(\) => undefined\)[\s\S]*return \{ ok: false, reason: "too-large" \}/,
    "bounded JSON body cancellation failures must not downgrade an oversized request to invalid JSON",
  );
  assert.match(
    readFileSync("app/api/_lib/boundedJsonBody.ts", "utf8"),
    /const MAX_JSON_BODY_BYTES = 256 \* 1024[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseContentLengthHeader[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*function normalizeJsonBodyMaxBytes[\s\S]*Number\.isSafeInteger\(value\) && value > 0 && value <= MAX_JSON_BODY_BYTES[\s\S]*const byteLimit = normalizeJsonBodyMaxBytes\(maxBytes\)[\s\S]*byteLimit === null[\s\S]*contentLength === -1/,
    "bounded JSON body parser must reject malformed or non-canonical Content-Length and invalid maxBytes before body reads",
  );
  const boundedJsonBodySource = readFileSync("app/api/_lib/boundedJsonBody.ts", "utf8");
  assert.ok(
    boundedJsonBodySource.includes("const JSON_CONTENT_TYPE_RE = /^application\\/(?:json|[a-z0-9!#$&^_.+-]+\\+json)$/;") &&
      /function isJsonContentType[\s\S]*JSON_CONTENT_TYPE_RE\.test\(contentType\)[\s\S]*if \(!isJsonContentType\(request\.headers\.get\("content-type"\)\)\)/.test(boundedJsonBodySource),
    "bounded JSON body parser must require an explicit application JSON Content-Type",
  );
  assert.match(
    boundedJsonBodySource,
    /new TextDecoder\("utf-8", \{ fatal: true \}\)/,
    "bounded JSON body parser must use fatal UTF-8 decoding",
  );
  assert.equal(queryParams.parsePositiveIntegerParam("1"), 1);
  assert.equal(queryParams.parsePositiveIntegerParam("400"), 400);
  assert.equal(queryParams.parsePositiveIntegerParam("9007199254740991"), Number.MAX_SAFE_INTEGER);
  assert.equal(queryParams.parsePositiveIntegerValue(7), 7);
  assert.equal(queryParams.parsePositiveIntegerValue("8"), 8);
  assert.equal(queryParams.parsePositiveIntegerValue("9007199254740991"), Number.MAX_SAFE_INTEGER);
  assert.equal(queryParams.parseBoundedPositiveIntegerParam("64", 64), 64);
  assert.equal(queryParams.parseBoundedPositiveIntegerParam("65", 64), null);
  assert.equal(queryParams.parseBoundedPositiveIntegerParam("1", 0), null);
  assert.equal(queryParams.parseBoundedPositiveIntegerParam("1", 1.5), null);
  assert.equal(queryParams.parseBoundedPositiveIntegerParam("9007199254740991", Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
  assert.equal(queryParams.parseBoundedPositiveIntegerParam("9007199254740992", Number.MAX_SAFE_INTEGER), null);
  for (const value of [null, "", "0", "001", "-1", "1.0", "1e2", "0x10", " 1", "1 ", "9007199254740992", "9007199254740993", "9999999999999999", "12345678901234567"]) {
    assert.equal(
      queryParams.parsePositiveIntegerParam(value),
      null,
      `strict API integer query parsing must reject ${String(value)}`,
    );
    assert.equal(
      queryParams.parsePositiveIntegerValue(value),
      null,
      `strict API integer value parsing must reject ${String(value)}`,
    );
  }
  for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 9_007_199_254_740_992]) {
    assert.equal(
      queryParams.parsePositiveIntegerValue(value),
      null,
      `strict API integer value parsing must reject numeric ${String(value)}`,
    );
  }
  assert.match(
    readFileSync("app/api/_lib/queryParams.ts", "utf8"),
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed <= 0n \|\| parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)/,
    "shared API query parsing must bound decimal strings as BigInt before narrowing to JS numbers",
  );
  assert.doesNotMatch(
    readFileSync("app/api/_lib/queryParams.ts", "utf8"),
    /const parsed = Number\(value\)[\s\S]*Number\.isSafeInteger\(parsed\)/,
    "shared API query parsing must not narrow attacker-controlled decimal strings before range checks",
  );
  assert.match(
    readFileSync("app/api/claim-candidates/route.ts", "utf8"),
    /parsePositiveIntegerParam\(cursorParam\)[\s\S]*parseBoundedPositiveIntegerParam\(limitParam, MAX_PAGE_SIZE\)[\s\S]*limit: requestedLimit/,
    "claim-candidates pagination must reject out-of-range limits instead of silently clamping them",
  );
  assert.doesNotMatch(
    readFileSync("app/api/claim-candidates/route.ts", "utf8"),
    /Math\.min\(requestedLimit, MAX_PAGE_SIZE\)/,
    "claim-candidates pagination must keep max-limit rejection explicit instead of reintroducing silent clamping",
  );
  assert.match(
    readFileSync("app/api/rebate-history/route.ts", "utf8"),
    /parsePositiveIntegerParam\(cursorParam\)[\s\S]*parseBoundedPositiveIntegerParam\(limitParam, MAX_PAGE_SIZE\)[\s\S]*limit: requestedLimit/,
    "rebate-history pagination must reject out-of-range limits instead of silently clamping them",
  );
  assert.doesNotMatch(
    readFileSync("app/api/rebate-history/route.ts", "utf8"),
    /Math\.min\(requestedLimit, MAX_PAGE_SIZE\)/,
    "rebate-history pagination must keep max-limit rejection explicit instead of reintroducing silent clamping",
  );
  assert.match(
    readFileSync("app/api/epochs/route.ts", "utf8"),
    /parsePositiveIntegerParam\(value\)[\s\S]*value === null \|\| value > 1_000_000[\s\S]*Invalid epochs/,
    "epochs query parsing must reject non-decimal epoch IDs before cache-key and storage work",
  );
  assert.match(
    readFileSync("app/api/rewards/route.ts", "utf8"),
    /parsePositiveIntegerValue\(value\)[\s\S]*parsed === null \|\| parsed > 1_000_000[\s\S]*Invalid epochs/,
    "rewards body epoch parsing must reject non-decimal string IDs before cache-key and storage work",
  );
  assert.match(
    readFileSync("app/api/rewards/route.ts", "utf8"),
    /epochsRaw\.length > MAX_EPOCHS_PER_REQUEST[\s\S]*Too many epochs[\s\S]*const epochs = new Set<number>\(\);[\s\S]*for \(const value of epochsRaw\)[\s\S]*parsePositiveIntegerValue\(value\)/,
    "rewards body epoch parsing must reject over-limit epoch arrays before cache-key and storage work",
  );
  assert.doesNotMatch(
    readFileSync("app/api/rewards/route.ts", "utf8"),
    /epochs\.size >= MAX_EPOCHS_PER_REQUEST|Array\.isArray\(epochsRaw\)[\s\S]*\.map\(\(value\) => parsePositiveIntegerValue\(value\)\)[\s\S]*\.slice\(0, MAX_EPOCHS_PER_REQUEST\)/,
    "rewards body epoch parsing must not silently truncate or map an entire submitted array before rejecting over-limit requests",
  );
  assert.match(
    readFileSync("app/api/rewards/route.ts", "utf8"),
    /reason === "unsupported-content-type"[\s\S]*Rewards payload must be JSON[\s\S]*415/,
    "rewards API must fail closed with no-store 415 on non-JSON payloads",
  );
  assert.match(
    readFileSync("app/api/chat/messages/route.ts", "utf8"),
    /reason === "unsupported-content-type"[\s\S]*Message payload must be JSON[\s\S]*status: 415[\s\S]*varyCookie: true/,
    "chat message sends must fail closed with no-store/Vary 415 on non-JSON payloads",
  );
  assert.match(
    readFileSync("app/api/chat/messages/route.ts", "utf8"),
    /const text = typeof body\.text === "string" \? body\.text\.trim\(\) : ""[\s\S]*text\.length > MAX_TEXT_LENGTH[\s\S]*Message text is too long[\s\S]*const senderName = typeof body\.senderName === "string" \? body\.senderName\.trim\(\) : null[\s\S]*senderName\.length > MAX_NAME_LENGTH[\s\S]*Sender name is too long/,
    "chat message sends must reject over-limit text and sender names instead of silently truncating authenticated payloads",
  );
  assert.doesNotMatch(
    readFileSync("app/api/chat/messages/route.ts", "utf8"),
    /body\.(?:text|senderName)\.trim\(\)\.slice\(0, MAX_(?:TEXT|NAME)_LENGTH\)/,
    "chat message sends must not silently truncate authenticated text or sender names before storage",
  );
  assert.match(
    readFileSync("app/api/chat/profile/route.ts", "utf8"),
    /reason === "unsupported-content-type"[\s\S]*Profile payload must be JSON[\s\S]*status: 415[\s\S]*varyCookie: true/,
    "chat profile writes must fail closed with no-store/Vary 415 on non-JSON payloads",
  );
  assert.match(
    readFileSync("app/api/chat/profile/route.ts", "utf8"),
    /const name = typeof body\.name === "string" \? body\.name\.trim\(\) : null[\s\S]*name\.length > MAX_NAME_LENGTH[\s\S]*Profile name is too long/,
    "chat profile writes must reject over-limit names instead of silently truncating authenticated payloads",
  );
  assert.doesNotMatch(
    readFileSync("app/api/chat/profile/route.ts", "utf8"),
    /body\.name\.trim\(\)\.slice\(0, MAX_NAME_LENGTH\)/,
    "chat profile writes must not silently truncate authenticated names before storage",
  );
  assert.match(
    readFileSync("app/api/admin/processes/route.ts", "utf8"),
    /reason === "unsupported-content-type"[\s\S]*Process payload must be JSON[\s\S]*status: 415[\s\S]*varyCookie: true/,
    "admin process controls must fail closed with no-store/Vary 415 on non-JSON payloads",
  );
  const cookieVaryResponse = new Response("{}", { headers: { Vary: "Accept-Encoding, cookie, Cookie" } });
  responseHeaders.applyNoStoreHeaders(cookieVaryResponse, { varyCookie: true });
  assert.equal(cookieVaryResponse.headers.get("Cache-Control"), "no-store, no-cache, must-revalidate");
  assert.equal(cookieVaryResponse.headers.get("Pragma"), "no-cache");
  assert.equal(cookieVaryResponse.headers.get("Expires"), "0");
  assert.equal(
    cookieVaryResponse.headers.get("Vary"),
    "Accept-Encoding, Cookie",
    "session API no-store helper must merge Vary: Cookie case-insensitively",
  );
  const wildcardVaryResponse = new Response("{}", { headers: { Vary: "*" } });
  responseHeaders.applyNoStoreHeaders(wildcardVaryResponse, { varyCookie: true });
  assert.equal(
    wildcardVaryResponse.headers.get("Vary"),
    "*",
    "session API no-store helper must preserve Vary wildcard instead of appending Cookie",
  );
  const invalidVaryResponse = new Response("{}", { headers: { Vary: "Accept-Encoding, bad token, X-Lore, Cookie" } });
  responseHeaders.applyNoStoreHeaders(invalidVaryResponse, { varyCookie: true });
  assert.equal(
    invalidVaryResponse.headers.get("Vary"),
    "Accept-Encoding, X-Lore, Cookie",
    "session API no-store helper must discard invalid Vary tokens while preserving valid tokens and Cookie",
  );
  assert.match(
    readFileSync("app/api/_lib/responseHeaders.ts", "utf8"),
    /HEADER_TOKEN_RE[\s\S]*function normalizeHeaderToken[\s\S]*HEADER_TOKEN_RE\.test\(trimmed\)[\s\S]*const nextToken = normalizeHeaderToken\(next\)[\s\S]*const trimmed = normalizeHeaderToken\(value\)/,
    "session API no-store helper must validate Vary header tokens before merging Cookie",
  );
  const retryAfterLimitRequest = new Request("https://play.example/api/retry-limit", {
    headers: {
      "accept-language": "en-US",
      "user-agent": "retry-after-boundary",
    },
  });
  const retryAfterBucket = `test-retry-after-${Date.now()}`;
  assert.equal(
    await sharedRateLimit.enforceSharedRateLimit(retryAfterLimitRequest, {
      bucket: retryAfterBucket,
      limit: 1,
      windowMs: 86_400_000,
    }),
    null,
  );
  const retryAfterLimited = await sharedRateLimit.enforceSharedRateLimit(retryAfterLimitRequest, {
    bucket: retryAfterBucket,
    limit: 1,
    windowMs: 86_400_000,
  });
  assert.equal(retryAfterLimited?.status, 429, "shared rate-limit second hit must return 429");
  const retryAfterLimitHeader = Number.parseInt(retryAfterLimited?.headers.get("Retry-After") ?? "", 10);
  assert.ok(
    Number.isSafeInteger(retryAfterLimitHeader) && retryAfterLimitHeader >= 1 && retryAfterLimitHeader <= 86_400,
    "429 Retry-After header must be bounded to at most one day",
  );
  assert.equal(
    (await retryAfterLimited?.json())?.retryAfter,
    retryAfterLimitHeader,
    "429 retryAfter JSON field must be bounded with the same limit as the header",
  );
  assert.match(
    readFileSync("app/api/_lib/sharedRateLimit.ts", "utf8"),
    /MAX_RETRY_AFTER_SECONDS\s*=\s*86_400[\s\S]*Math\.min\(MAX_RETRY_AFTER_SECONDS, Math\.max\(1, Math\.ceil\(value\)\)\)/,
    "shared rate-limit 429 retry-after values must stay bounded",
  );
  assert.match(
    readFileSync("app/api/admin/auth/route.ts", "utf8"),
    /reason === "unsupported-content-type"[\s\S]*Auth payload must be JSON[\s\S]*status: 415[\s\S]*varyCookie: true/,
    "admin auth must fail closed with no-store/Vary on non-JSON payloads",
  );
  assert.match(
    readFileSync("app/api/chat/auth/route.ts", "utf8"),
    /reason === "unsupported-content-type"[\s\S]*Auth payload must be JSON[\s\S]*status: 415[\s\S]*varyCookie: true/,
    "chat auth must fail closed with no-store/Vary on non-JSON payloads",
  );
  withTemporaryEnv(
    {
      LINEA_NETWORK: "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
      LINEA_CHAIN_ID: "59144",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59144",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("server"),
        /NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS=1 is required/,
      );
    },
  );
  assert.equal(
    productionRuntime.hasTwoIndependentPublicRpcOrigins([]),
    false,
    "an empty public RPC list must not satisfy wallet transfer quorum",
  );
  assert.equal(
    productionRuntime.hasTwoIndependentPublicRpcOrigins(["https://rpc-one.playlore.xyz"]),
    false,
    "one public RPC origin must not satisfy wallet transfer quorum",
  );
  assert.equal(
    productionRuntime.hasTwoIndependentPublicRpcOrigins([
      "HTTPS://RPC-ONE.PLAYLORE.XYZ:443/path?key=one",
      "https://rpc-one.playlore.xyz./other-path?key=two#fragment",
    ]),
    false,
    "case, default-port, trailing-dot, path, query, and fragment aliases must collapse to one origin",
  );
  assert.equal(
    productionRuntime.hasTwoIndependentPublicRpcOrigins([
      "https://rpc-one.playlore.xyz/path",
      "https://rpc-two.playlore.xyz/other-path",
    ]),
    true,
    "two canonical public RPC origins must satisfy wallet transfer quorum",
  );
  withTemporaryEnv(
    {
      LINEA_NETWORK: "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
      LINEA_CHAIN_ID: "59144",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59144",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      WEB_REPLICA_COUNT: "2",
      UPSTASH_REDIS_REST_URL: "https://rate-limit.playlore.xyz",
      UPSTASH_REDIS_REST_TOKEN: "changeme",
      RATE_LIMIT_EXTERNAL_FAIL_CLOSED: "1",
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("web"),
        /non-placeholder UPSTASH_REDIS_REST_TOKEN/,
      );
    },
  );
  withTemporaryEnv(
    {
      LINEA_NETWORK: "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
      LINEA_CHAIN_ID: "59144",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59144",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
      RESEND_API_KEY: undefined,
      RUNTIME_MONITOR_EMAIL_FROM: undefined,
      RUNTIME_MONITOR_EMAIL_TO: undefined,
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("server"),
        /RESEND_API_KEY is required for mainnet server email alerts/,
      );
    },
  );
  withTemporaryEnv(
    {
      LINEA_NETWORK: "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
      LINEA_CHAIN_ID: "59144",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59144",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
      LORE_BACKUP_DIR: join(process.cwd(), "data", "backups"),
      RUNTIME_MONITOR_BACKUP_DIR: "relative-backups",
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("server"),
        /LORE_BACKUP_DIR must be outside the repo checkout[\s\S]*RUNTIME_MONITOR_BACKUP_DIR must be absolute/,
      );
    },
  );
  withTemporaryEnv(
    {
      LINEA_NETWORK: "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
      LINEA_CHAIN_ID: "59144",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59144",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_LINEA_RPCS: undefined,
      NEXT_PUBLIC_LINEA_SEPOLIA_RPCS: "https://rpc.sepolia.linea.build",
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("web"),
        /NEXT_PUBLIC_LINEA_SEPOLIA_RPCS must not be configured on mainnet/,
      );
    },
  );
  withTemporaryEnv(
    {
      LINEA_NETWORK: "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
      LINEA_CHAIN_ID: "59144",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59144",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_LINEA_RPCS: "https://rpc.playlore.xyz,http://localhost:8545",
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("web"),
        /NEXT_PUBLIC_LINEA_RPCS must contain only public https:\/\/ URLs/,
      );
    },
  );
  withTemporaryEnv(
    {
      LINEA_NETWORK: "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
      LINEA_CHAIN_ID: "59144",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59144",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      NEXT_PUBLIC_PRIVY_APP_ID: "cmlqkgtmg00og0cjueu4mxmn9",
      CHAT_AUTH_SECRET: "c".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("web"),
        /NEXT_PUBLIC_PRIVY_APP_ID must not use the development Privy app id/,
      );
    },
  );
  withTemporaryEnv(
    {
      LINEA_NETWORK: "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
      LINEA_CHAIN_ID: "59141",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59144",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
    },
    () => {
      let error;
      try {
        productionRuntime.assertProductionRuntimeConfig("web");
      } catch (caught) {
        error = caught;
      }
      assert.ok(error instanceof Error);
      assert.match(error.message, /LINEA_CHAIN_ID must be 59144/);
      assert.match(error.message, /LINEA_CHAIN_ID and NEXT_PUBLIC_LINEA_CHAIN_ID must match/);
    },
  );
  withTemporaryEnv(
    {
      LINEA_NETWORK: "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
      LINEA_CHAIN_ID: "59144",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59144",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_SITE_URL: "https://play.example",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: "not-a-private-key",
      LORE_DB_PATH: absoluteTestDbPath,
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("web"),
        /BOOTSTRAP_KEEPER_PRIVATE_KEY must be a 64-hex private key/,
      );
    },
  );
  withTemporaryEnv(
    {
      LINEA_NETWORK: "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
      LINEA_CHAIN_ID: "59144",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59144",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_SITE_URL: "https://play.example",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      KEEPER_PRIVATE_KEY: "not-a-private-key",
      LORE_DB_PATH: absoluteTestDbPath,
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("bot"),
        /KEEPER_PRIVATE_KEY must be a 64-hex private key/,
      );
    },
  );
  withTemporaryEnv(
    {
      LINEA_NETWORK: "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
      LINEA_CHAIN_ID: "59144",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59144",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: join(process.cwd(), "data", "lore.sqlite"),
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("web"),
        /LORE_DB_PATH must be outside the repo checkout/,
      );
    },
  );
  withTemporaryEnv(
    {
      LINEA_NETWORK: "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
      LINEA_CHAIN_ID: "59144",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59144",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz/app?debug=1#main",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("web"),
        /NEXT_PUBLIC_SITE_URL must be a public https:\/\/ URL/,
      );
    },
  );
  withTemporaryEnv(
    {
      LINEA_NETWORK: "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
      LINEA_CHAIN_ID: "59144",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59144",
      KEEPER_CONTRACT_ADDRESS: "not-an-address",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000000",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000000",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_SITE_URL: "https://play.example",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "also-not-an-address",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
    },
    () => {
      let error;
      try {
        productionRuntime.assertProductionRuntimeConfig("web");
      } catch (caught) {
        error = caught;
      }
      assert.ok(error instanceof Error);
      assert.match(error.message, /KEEPER_CONTRACT_ADDRESS must be a valid EVM address/);
      assert.match(error.message, /NEXT_PUBLIC_CONTRACT_ADDRESS must not be the zero address/);
      assert.match(error.message, /NEXT_PUBLIC_LINEA_TOKEN_ADDRESS must not be the zero address/);
      assert.match(error.message, /NEXT_PUBLIC_ADMIN_WALLET_ADDRESS must be a valid EVM address/);
    },
  );
  withTemporaryEnv(
    {
      LINEA_NETWORK: "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
      LINEA_CHAIN_ID: "59144",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59144",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "abc",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "0",
      KEEPER_RPC_URL: "https://",
      NEXT_PUBLIC_SITE_URL: "https://play.example",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
    },
    () => {
      let error;
      try {
        productionRuntime.assertProductionRuntimeConfig("web");
      } catch (caught) {
        error = caught;
      }
      assert.ok(error instanceof Error);
      assert.match(error.message, /INDEXER_START_BLOCK must be a positive integer block number/);
      assert.match(error.message, /NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK must be a positive integer block number/);
      assert.match(error.message, /KEEPER_RPC_URL must be a public https:\/\/ URL/);
    },
  );
  withTemporaryEnv(
    {
      LINEA_NETWORK: "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
      LINEA_CHAIN_ID: "59144",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59144",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: undefined,
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("web"),
        /NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK is required for mainnet/,
      );
    },
  );
  withTemporaryEnv(
    {
      LINEA_NETWORK: "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
      LINEA_CHAIN_ID: "59144",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59144",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_SITE_URL: "https://localhost:3000",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("web"),
        /NEXT_PUBLIC_SITE_URL must be a public https:\/\/ URL/,
      );
    },
  );
  withTemporaryEnv(
    {
      LINEA_NETWORK: "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
      LINEA_CHAIN_ID: "59144",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59144",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_SITE_URL: "https://play.example",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      ALLOW_WEAK_RATE_LIMIT_IDENTITY: "1",
      RUNTIME_MONITOR_ALLOW_NO_ALERTS: "1",
      RESEND_API_KEY: "not-a-resend-key",
      RUNTIME_MONITOR_EMAIL_FROM: "not-an-email",
      RUNTIME_MONITOR_EMAIL_TO: "playlore88@gmail.com, broken-recipient",
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
    },
    () => {
      let error;
      try {
        productionRuntime.assertProductionRuntimeConfig("web");
      } catch (caught) {
        error = caught;
      }
      assert.ok(error instanceof Error);
      assert.match(error.message, /ALLOW_WEAK_RATE_LIMIT_IDENTITY must not be enabled/);
      assert.match(error.message, /RUNTIME_MONITOR_ALLOW_NO_ALERTS must not be enabled/);
      assert.match(error.message, /RESEND_API_KEY must look like a Resend API key/);
      assert.match(error.message, /RUNTIME_MONITOR_EMAIL_FROM must be a valid Resend-verified email sender/);
      assert.match(error.message, /RUNTIME_MONITOR_EMAIL_TO must contain valid email recipient addresses/);
    },
  );
  withTemporaryEnv(
    {
      LINEA_NETWORK: "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
      LINEA_CHAIN_ID: "59144",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59144",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "health-secret",
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: undefined,
      WEB_REPLICA_COUNT: "2",
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
      RATE_LIMIT_EXTERNAL_FAIL_CLOSED: undefined,
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "chat-secret",
      ADMIN_AUTH_SECRET: "admin-secret",
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "resolve-secret",
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
    },
    () => {
      let error;
      try {
        productionRuntime.assertProductionRuntimeConfig("web");
      } catch (caught) {
        error = caught;
      }
      assert.ok(error instanceof Error);
      assert.match(error.message, /TRUST_PROXY_SECRET must contain at least 32 characters/);
      assert.match(error.message, /Multiple mainnet web replicas require UPSTASH_REDIS_REST_URL/);
      assert.match(error.message, /RATE_LIMIT_EXTERNAL_FAIL_CLOSED=1 is required/);
      assert.match(error.message, /HEALTH_DIAGNOSTICS_SECRET must contain at least 32 characters/);
      assert.match(error.message, /CHAT_AUTH_SECRET or NEXTAUTH_SECRET must contain at least 32 characters/);
      assert.match(error.message, /effective ADMIN_AUTH_SECRET must contain at least 32 characters/);
      assert.match(error.message, /BOOTSTRAP_RESOLVE_SECRET must contain at least 32 characters/);
    },
  );
  withTemporaryEnv(
    {
      LINEA_NETWORK: "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
      LINEA_CHAIN_ID: "59144",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59144",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_SITE_URL: "https://play.example",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      NEXT_PUBLIC_PRIVY_APP_ID: undefined,
      CHAT_AUTH_SECRET: "c".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
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
      LINEA_CHAIN_ID: "59144",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59144",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_SITE_URL: "https://play.example",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      NEXT_PUBLIC_PRIVY_APP_ID: "your-privy-app-id",
      CHAT_AUTH_SECRET: "c".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("web"),
        /NEXT_PUBLIC_PRIVY_APP_ID must not use an example or placeholder value/,
      );
    },
  );
  withTemporaryEnv(
    {
      LINEA_NETWORK: "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
      LINEA_CHAIN_ID: "59144",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59144",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      LORE_DB_PATH: absoluteTestDbPath,
      INDEXER_FINALITY_BLOCKS: undefined,
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
      LINEA_CHAIN_ID: "59144",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59144",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      LORE_DB_PATH: absoluteTestDbPath,
      INDEXER_FINALITY_BLOCKS: "64",
    },
    () => {
      assert.doesNotThrow(() => productionRuntime.assertProductionRuntimeConfig("indexer"));
    },
  );
  withTemporaryEnv(
    {
      LORE_PREMAINNET_RUNTIME_STRICT: "1",
      LINEA_NETWORK: "sepolia",
      NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
      LINEA_CHAIN_ID: "59141",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59141",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_LINEA_RPCS: undefined,
      NEXT_PUBLIC_LINEA_SEPOLIA_RPCS: "https://rpc.sepolia.linea.build",
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      RESEND_API_KEY: "re_synthetic",
      RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
      RUNTIME_MONITOR_EMAIL_TO: "playlore88@gmail.com",
      LORE_DB_PATH: absoluteTestDbPath,
      INDEXER_FINALITY_BLOCKS: undefined,
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("indexer"),
        /INDEXER_FINALITY_BLOCKS must be set to a positive block count for pre-mainnet testnet indexer runtime/,
      );
    },
  );
  withTemporaryEnv(
    {
      LORE_PREMAINNET_RUNTIME_STRICT: "1",
      LINEA_NETWORK: "sepolia",
      NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
      LINEA_CHAIN_ID: "59141",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59141",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_LINEA_RPCS: undefined,
      NEXT_PUBLIC_LINEA_SEPOLIA_RPCS: "https://rpc.sepolia.linea.build",
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      RESEND_API_KEY: "re_synthetic",
      RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
      RUNTIME_MONITOR_EMAIL_TO: "playlore88@gmail.com",
      LORE_DB_PATH: absoluteTestDbPath,
      INDEXER_FINALITY_BLOCKS: "8",
    },
    () => {
      assert.doesNotThrow(() => productionRuntime.assertProductionRuntimeConfig("indexer"));
    },
  );
  withTemporaryEnv(
    {
      LORE_PREMAINNET_RUNTIME_STRICT: "1",
      LINEA_NETWORK: "sepolia",
      NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
      LINEA_CHAIN_ID: "59141",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59141",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_LINEA_RPCS: "https://linea-mainnet.example",
      NEXT_PUBLIC_LINEA_SEPOLIA_RPCS: "http://localhost:8545",
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      WEB_REPLICA_COUNT: "2",
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
      RATE_LIMIT_EXTERNAL_FAIL_CLOSED: undefined,
      RESEND_API_KEY: undefined,
      RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
      RUNTIME_MONITOR_EMAIL_TO: "playlore88@gmail.com",
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
    },
    () => {
      let error;
      try {
        productionRuntime.assertProductionRuntimeConfig("web");
      } catch (caught) {
        error = caught;
      }
      assert.ok(error instanceof Error);
      assert.match(error.message, /invalid pre-mainnet testnet runtime configuration/);
      assert.match(error.message, /NEXT_PUBLIC_LINEA_SEPOLIA_RPCS must contain only public https:\/\/ URLs/);
      assert.match(error.message, /NEXT_PUBLIC_LINEA_RPCS must not be configured for pre-mainnet testnet/);
      assert.match(error.message, /RESEND_API_KEY is required for pre-mainnet testnet email alerts/);
      assert.match(error.message, /Multiple pre-mainnet testnet web replicas require UPSTASH_REDIS_REST_URL/);
      assert.match(error.message, /RATE_LIMIT_EXTERNAL_FAIL_CLOSED=1 is required/);
    },
  );
  withTemporaryEnv(
    {
      LORE_PREMAINNET_RUNTIME_STRICT: "1",
      LINEA_NETWORK: "sepolia",
      NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
      LINEA_CHAIN_ID: "59141",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59141",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_LINEA_RPCS: undefined,
      NEXT_PUBLIC_LINEA_SEPOLIA_RPCS: "https://rpc.sepolia.linea.build",
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      WEB_REPLICA_COUNT: "1",
      UPSTASH_REDIS_REST_URL: "https://upstash.playlore.xyz",
      UPSTASH_REDIS_REST_TOKEN: "synthetic-upstash-token",
      RATE_LIMIT_EXTERNAL_FAIL_CLOSED: "1",
      RESEND_API_KEY: "not-a-resend-key",
      RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
      RUNTIME_MONITOR_EMAIL_TO: "playlore88@gmail.com",
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
    },
    () => {
      let error;
      try {
        productionRuntime.assertProductionRuntimeConfig("web");
      } catch (caught) {
        error = caught;
      }
      assert.ok(error instanceof Error);
      assert.match(error.message, /WEB_REPLICA_COUNT must be at least 2 for pre-mainnet testnet production-like rate-limit validation/);
      assert.match(error.message, /RESEND_API_KEY must look like a Resend API key/);
    },
  );
  withTemporaryEnv(
    {
      LORE_PREMAINNET_RUNTIME_STRICT: "1",
      LINEA_NETWORK: "sepolia",
      NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
      LINEA_CHAIN_ID: "59141",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59141",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_LINEA_RPCS: undefined,
      NEXT_PUBLIC_LINEA_SEPOLIA_RPCS: "https://rpc.sepolia.linea.build",
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      WEB_REPLICA_COUNT: "2",
      UPSTASH_REDIS_REST_URL: "https://localhost:6379",
      UPSTASH_REDIS_REST_TOKEN: "synthetic-upstash-token",
      RATE_LIMIT_EXTERNAL_FAIL_CLOSED: "1",
      RESEND_API_KEY: "re_synthetic",
      RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
      RUNTIME_MONITOR_EMAIL_TO: "playlore88@gmail.com",
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
    },
    () => {
      let error;
      try {
        productionRuntime.assertProductionRuntimeConfig("web");
      } catch (caught) {
        error = caught;
      }
      assert.ok(error instanceof Error);
      assert.match(error.message, /Multiple pre-mainnet testnet web replicas require UPSTASH_REDIS_REST_URL/);
    },
  );
  withTemporaryEnv(
    {
      LORE_PREMAINNET_RUNTIME_STRICT: "1",
      LINEA_NETWORK: "sepolia",
      NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
      LINEA_CHAIN_ID: "59141",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59141",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_LINEA_RPCS: undefined,
      NEXT_PUBLIC_LINEA_SEPOLIA_RPCS: "https://linea-sepolia.drpc.org,https://rpc.sepolia.linea.build",
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      WEB_REPLICA_COUNT: "2",
      UPSTASH_REDIS_REST_URL: "https://upstash.playlore.xyz",
      UPSTASH_REDIS_REST_TOKEN: "synthetic-upstash-token",
      RATE_LIMIT_EXTERNAL_FAIL_CLOSED: "1",
      RESEND_API_KEY: "re_synthetic",
      RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
      RUNTIME_MONITOR_EMAIL_TO: "playlore88@gmail.com",
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
    },
    () => {
      assert.doesNotThrow(() => productionRuntime.assertProductionRuntimeConfig("web"));
    },
  );
  withTemporaryEnv(
    {
      LINEA_NETWORK: "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
      LINEA_CHAIN_ID: "59144",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59144",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_LINEA_RPCS: "https://linea-rpc.publicnode.com",
      NEXT_PUBLIC_LINEA_SEPOLIA_RPCS: undefined,
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      WEB_REPLICA_COUNT: "1",
      RESEND_API_KEY: "re_synthetic",
      RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
      RUNTIME_MONITOR_EMAIL_TO: "playlore88@gmail.com",
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
      LORE_BACKUP_DIR: undefined,
      RUNTIME_MONITOR_BACKUP_DIR: undefined,
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("server"),
        /LORE_BACKUP_DIR or RUNTIME_MONITOR_BACKUP_DIR is required for mainnet server backup monitoring/,
      );
    },
  );
  withTemporaryEnv(
    {
      LINEA_NETWORK: "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
      LINEA_CHAIN_ID: "59144",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59144",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_LINEA_RPCS: "https://linea-rpc.publicnode.com",
      NEXT_PUBLIC_LINEA_SEPOLIA_RPCS: undefined,
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      WEB_REPLICA_COUNT: "1",
      RESEND_API_KEY: "re_synthetic",
      RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
      RUNTIME_MONITOR_EMAIL_TO: "playlore88@gmail.com",
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
      RUNTIME_MONITOR_BACKUP_DIR: join(tmpdir(), "lore-mainnet-backups"),
      RUNTIME_MONITOR_BACKUP_MAX_AGE_MS: "129600000",
    },
    () => {
      assert.doesNotThrow(() => productionRuntime.assertProductionRuntimeConfig("server"));
    },
  );
  const productionRuntimeSource = readFileSync("config/productionRuntime.ts", "utf8");
  assert.match(
    productionRuntimeSource,
    /scope === "web" && !hasTwoIndependentPublicRpcOrigins\(publicRpcUrls\)[\s\S]*scope === "web" && !hasTwoIndependentPublicRpcOrigins\(publicSepoliaRpcUrls\)/,
    "production web runtime must reject builds without two canonical wallet transfer RPC origins",
  );
  assert.match(
    productionRuntimeSource,
    /NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS=1 is required for the V10 mainnet launch/,
    "production runtime must fail closed when the V10 protected-bet flag is missing on mainnet",
  );
  assert.match(
    productionRuntimeSource,
    /LORE_PREMAINNET_RUNTIME_STRICT[\s\S]*validatePremainnetTestnetProductionEnv/,
    "production runtime must expose an opt-in strict Sepolia pre-mainnet configuration gate",
  );
  assert.match(
    productionRuntimeSource,
    /pre-mainnet testnet indexer runtime/,
    "strict Sepolia pre-mainnet runtime must require indexer finality",
  );
  assert.match(
    productionRuntimeSource,
    /resendRequired = scope === "server"[\s\S]*RESEND_API_KEY is required for mainnet server email alerts/,
    "production server runtime must fail closed without configured email alerting",
  );
  assert.match(
    productionRuntimeSource,
    /backupDirNames = \["LORE_BACKUP_DIR", "RUNTIME_MONITOR_BACKUP_DIR"\][\s\S]*mainnet server backup monitoring[\s\S]*pre-mainnet testnet server backup monitoring/,
    "production server runtime must fail closed without a configured backup monitoring directory",
  );
  assert.match(
    productionRuntimeSource,
    /RUNTIME_MONITOR_BACKUP_MAX_AGE_MS[\s\S]*positive safe integer for mainnet server backup monitoring[\s\S]*positive safe integer for pre-mainnet testnet server backup monitoring/,
    "production server runtime must fail closed without an explicit backup freshness window",
  );
  assert.match(
    productionRuntimeSource,
    /validateRuntimeAddress[\s\S]*isAddress[\s\S]*zeroAddress[\s\S]*validateMainnetAddress/,
    "production runtime must reject invalid and zero EVM addresses before mainnet launch",
  );
  const publicConfigSource = readFileSync("config/publicConfig.ts", "utf8");
  assert.match(
    publicConfigSource,
    /name: "Lineascan"[\s\S]*https:\/\/lineascan\.build[\s\S]*name: "Lineascan"[\s\S]*https:\/\/sepolia\.lineascan\.build/,
    "Linea explorer labels must match Lineascan URLs in wallet/explorer UI",
  );
  assert.ok(
    productionRuntimeSource.includes('host.includes(".")') &&
      /function isDisallowedMainnetHost[\s\S]*localhost[\s\S]*\.example[\s\S]*192\\.168/.test(productionRuntimeSource) &&
      /function isPublicMainnetSiteUrl[\s\S]*isDisallowedMainnetHost/.test(productionRuntimeSource),
    "production runtime must reject single-label, local, private, and placeholder site origins before mainnet launch",
  );
  assert.match(
    productionRuntimeSource,
    /function isDisallowedMainnetHost[\s\S]*localhost[\s\S]*\.example[\s\S]*192\\.168[\s\S]*function isPublicHttpsEndpoint[\s\S]*isDisallowedMainnetHost[\s\S]*KEEPER_RPC_URL must be a public https:\/\/ URL/,
    "production runtime must reject local, private, and placeholder RPC endpoints before mainnet launch",
  );
  assert.match(
    productionRuntimeSource,
    /function isPublicHttpsEndpoint[\s\S]*parsed\.username \|\| parsed\.password/,
    "production runtime must reject credentialed public endpoint URLs before mainnet launch",
  );
  assert.match(
    productionRuntimeSource,
    /KNOWN_DEVELOPMENT_PRIVY_APP_IDS[\s\S]*cmlqkgtmg00og0cjueu4mxmn9[\s\S]*development Privy app id/,
    "production runtime must reject the known development Privy app id on mainnet",
  );
  assert.doesNotMatch(
    readFileSync(".env.example", "utf8"),
    /NEXT_PUBLIC_PRIVY_APP_ID=cmlqkgtmg00og0cjueu4mxmn9/,
    ".env.example must not encourage copying the development Privy app id into production",
  );
  assert.match(
    readFileSync(".env.example", "utf8"),
    /Mainnet rejects localhost\/private\/example\/test URLs[\s\S]*KEEPER_RPC_URL=https:\/\/rpc\.provider\.your-domain\.com\/path/,
    ".env.example must document a mainnet-valid keeper RPC shape and the public-endpoint guard",
  );
  assert.match(
    readFileSync("docs/production-runbook.md", "utf8"),
    /WEB_REPLICA_COUNT=2\+[\s\S]*non-placeholder `UPSTASH_REDIS_REST_TOKEN`[\s\S]*RATE_LIMIT_EXTERNAL_FAIL_CLOSED=1/,
    "production runbook must document that multi-replica rate limiting requires a real non-placeholder Redis token",
  );
  for (const envTemplatePath of [".env.example", ".env.local.example"]) {
    assert.doesNotMatch(
      readFileSync(envTemplatePath, "utf8"),
      /NEXT_PUBLIC_LINEA_RPCS=.*\.example\b/,
      `${envTemplatePath} must not encourage copying placeholder backup RPC endpoints`,
    );
    assert.match(
      readFileSync(envTemplatePath, "utf8"),
      /TRUST_PROXY_HEADERS=0[\s\S]*TRUST_PROXY_SECRET=replace-with-at-least-32-random-characters[\s\S]*ALLOW_WEAK_RATE_LIMIT_IDENTITY=0/,
      `${envTemplatePath} must document trusted proxy identity and keep weak identity disabled by default`,
    );
    assert.match(
      readFileSync(envTemplatePath, "utf8"),
      /LORE_PREMAINNET_RUNTIME_STRICT=0[\s\S]*WEB_REPLICA_COUNT=2[\s\S]*UPSTASH_REDIS_REST_URL=https:\/\/your-database\.upstash\.io[\s\S]*UPSTASH_REDIS_REST_TOKEN=replace-with-server-only-standard-token[\s\S]*RATE_LIMIT_EXTERNAL_FAIL_CLOSED=1/,
      `${envTemplatePath} must document strict pre-mainnet two-replica external rate-limit requirements`,
    );
    assert.match(
      readFileSync(envTemplatePath, "utf8"),
      /RUNTIME_MONITOR_BACKUP_DIR[\s\S]*RUNTIME_MONITOR_BACKUP_MAX_AGE_MS=129600000/,
      `${envTemplatePath} must document backup freshness configuration for production-like monitoring`,
    );
    assert.match(
      readFileSync(envTemplatePath, "utf8"),
      /RESEND_API_KEY=re_xxxxxxxxx[\s\S]*RUNTIME_MONITOR_EMAIL_FROM=LORE <alerts@playlore\.xyz>[\s\S]*RUNTIME_MONITOR_EMAIL_TO=playlore88@gmail\.com/,
      `${envTemplatePath} must document Resend email alert configuration for production-like monitoring`,
    );
    assert.match(
      readFileSync(envTemplatePath, "utf8"),
      /BUNDLE_BASELINE_MAX_FILES=300[\s\S]*BUNDLE_BASELINE_MAX_TOTAL_BYTES=10500000[\s\S]*BUNDLE_BASELINE_MAX_JS_BYTES=8800000[\s\S]*BUNDLE_BASELINE_MAX_SINGLE_JS_BYTES=1250000[\s\S]*BUNDLE_BASELINE_MAX_CSS_BYTES=400000[\s\S]*BUNDLE_BASELINE_MAX_WASM_BYTES=1500000/,
      `${envTemplatePath} must document bundle baseline budget overrides`,
    );
  }
  const collectMainnetProofSource = readFileSync("scripts/collect-mainnet-proof.mjs", "utf8");
  const checkMainnetProofOutputSource = readFileSync("scripts/check-mainnet-proof-output.mjs", "utf8");
  assert.match(
    collectMainnetProofSource,
    /NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS[\s\S]*gate: "V10 protected bets required"/,
    "mainnet proof must include the V10 protected-bet runtime flag as an explicit launch gate",
  );
  const monitoringPackageScripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
  assert.equal(
    monitoringPackageScripts["proof:mainnet:summary"],
    "node scripts/collect-mainnet-proof.mjs --summary-only",
    "mainnet env proof must expose a compact summary command for routine operator checks",
  );
  assert.equal(
    monitoringPackageScripts["monitor:runtime:summary"],
    "node scripts/monitor-runtime-health.mjs --summary-only",
    "runtime monitor must expose a no-poll/no-alert compact config preflight",
  );
  assert.equal(
    monitoringPackageScripts["proof:mainnet:strict:summary"],
    "node scripts/collect-mainnet-proof.mjs --strict --summary-only",
    "mainnet env proof must expose a compact strict summary command for G1 launch checks",
  );
  assert.equal(
    monitoringPackageScripts["proof:mainnet:strict:compact"],
    "node scripts/collect-mainnet-proof.mjs --strict --compact",
    "mainnet env proof must expose an even shorter strict status command for routine G1 checks",
  );
  assert.match(
    collectMainnetProofSource,
    /const COMPACT_ONLY = process\.argv\.includes\("--compact"\)[\s\S]*function compactFailingGateTokens\(failedChecks, maxTokens = 10\)[\s\S]*Failing gate tokens sample: \$\{compactFailingGateTokens\(failed\)\}/,
    "mainnet compact status must clamp failing gate tokens without weakening strict validation",
  );
  assert.equal(
    monitoringPackageScripts["proof:chain:summary"],
    "node scripts/collect-chain-proof.mjs --summary-only",
    "direct chain proof must expose a compact summary command for routine operator checks",
  );
  assert.equal(
    monitoringPackageScripts["proof:chain:strict:summary"],
    "node scripts/collect-chain-proof.mjs --strict --summary-only",
    "direct chain proof must expose a compact strict summary command for launch checks",
  );
  const chainProofSummarySource = readFileSync("scripts/collect-chain-proof.mjs", "utf8");
  assert.match(
    chainProofSummarySource,
    /const chainLaunchGates = \["G1"\][\s\S]*const chainLaunchGateGroups = "chain=1"[\s\S]*function launchGateSummary\(issueCount\)[\s\S]*blocked[\s\S]*covered[\s\S]*launchGateSummary\(issues\.length\)/,
    "direct chain proof summary must identify the blocked or covered launch gate without reading RPC in summary mode",
  );
  assert.match(
    chainProofSummarySource,
    /function isHttpsRpcUrl\(value\)[\s\S]*parsed\.protocol === "https:"[\s\S]*!parsed\.username[\s\S]*!parsed\.password[\s\S]*strict && rpcSource[\s\S]*strict chain proof requires configured HTTPS RPC endpoints/,
    "strict direct chain proof must reject non-HTTPS or credentialed configured RPC endpoints without printing the endpoint value",
  );
  assert.match(
    chainProofSummarySource,
    /console\.log\(`RPC source: \$\{rpcSource \? "configured" : "built-in fallback"\}`\)[\s\S]*console\.log\("Would read RPC: false"\)/,
    "direct chain proof summary must report only configured/fallback RPC source state without printing RPC URLs",
  );
  assert.match(
    chainProofSummarySource,
    /function parseChainTileId\(value, tileCount = MAX_TILE_ID\)[\s\S]*typeof value !== "bigint"[\s\S]*value < 1n \|\| value > BigInt\(tileCount\)[\s\S]*return toSafeDisplayInteger\("chain tile id", value, 1, tileCount\)[\s\S]*function toSafeDisplayInteger\(label, value, min, max\)[\s\S]*value > BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*return Number\(value\)[\s\S]*resolved with invalid winningTile[\s\S]*const winningTile = parseChainTileId\(epochData\[2\], Math\.min\(bets\.length, tileData\[0\]\.length\)\)/,
    "direct chain proof must validate winningTile evidence before user reward estimates",
  );
  assert.match(
    chainProofSummarySource,
    /CANONICAL_POSITIVE_INTEGER_RE[\s\S]*function compareBigIntAscending\(left, right\)[\s\S]*function parseCanonicalPositiveBigInt\(value\)[\s\S]*CANONICAL_POSITIVE_INTEGER_RE\.test\(text\)[\s\S]*function parseEpochArgValues\(raw\)[\s\S]*parseEpochs\(raw, currentEpoch\)[\s\S]*sort\(compareBigIntAscending\)[\s\S]*validateEpochArg\(raw\)[\s\S]*epoch values must be canonical positive decimal integers/,
    "direct chain proof must canonical-parse requested epochs and sort BigInt epochs without lossy Number conversion",
  );
  assert.match(
    chainProofSummarySource,
    /else if \(issues\.length > 0\)[\s\S]*writeSnapshot\(\)[\s\S]*if \(strict\) process\.exitCode = 1[\s\S]*else \{[\s\S]*await import\("viem"\)/,
    "direct chain proof must stop before RPC setup when input validation issues are already known",
  );
  assert.doesNotMatch(
    chainProofSummarySource,
    /const winningTile = Number\(epochData\[2\]\)|function parseChainTileId\(value, tileCount = MAX_TILE_ID\)[\s\S]*return Number\(value\)[\s\S]*function toSafeDisplayInteger|\.map\(\(value\) => BigInt\(value\)\)|Number\(a - b\)/,
    "direct chain proof must not broadly coerce epoch winningTile evidence or requested epoch arguments",
  );
  assert.equal(
    monitoringPackageScripts["proof:remaining:summary"],
    "node scripts/report-launch-remaining.mjs --summary-only",
    "remaining launch evidence proof must expose a compact summary command for routine operator checks",
  );
  assert.equal(
    monitoringPackageScripts["proof:autonomous:summary"],
    "node scripts/report-autonomous-status.mjs",
    "autonomous status must expose a lightweight read-only summary command for long local hardening runs",
  );
  assert.equal(
    monitoringPackageScripts["proof:autonomous:daily:summary"],
    "node scripts/report-autonomous-daily-status.mjs",
    "autonomous daily status must expose the bounded dependency, wallet, bundle, and cleanup summary command",
  );
  assert.equal(
    monitoringPackageScripts["proof:signoff:strict:summary"],
    "node scripts/check-signoff-proof.mjs --strict --summary-only",
    "signoff proof must expose a compact strict summary command for G2-G4 launch checks",
  );
  assert.equal(
    monitoringPackageScripts["proof:host:strict:summary"],
    "node scripts/check-host-proof.mjs --strict --summary-only",
    "host proof must expose a compact strict summary command for G5-G6 launch checks",
  );
  assert.equal(
    monitoringPackageScripts["proof:indexer:strict:summary"],
    "node scripts/check-indexer-dry-run.mjs --strict --summary-only",
    "indexer proof must expose a compact strict summary command for G7 launch checks",
  );
  assert.equal(
    monitoringPackageScripts["proof:restore:strict:summary"],
    "node scripts/verify-db-restore.mjs --strict --summary-only",
    "restore proof must expose a compact strict summary command for G8 launch checks",
  );
  assert.equal(
    monitoringPackageScripts["proof:monitoring:strict:summary"],
    "node scripts/check-monitoring-proof.mjs --strict --summary-only",
    "monitoring proof must expose a compact strict summary command for G9 launch checks",
  );
  assert.equal(
    monitoringPackageScripts["proof:qa:strict:summary"],
    "node scripts/check-qa-proof.mjs --strict --summary-only",
    "QA proof must expose a compact strict summary command for G12-G14 launch checks",
  );
  assert.equal(
    monitoringPackageScripts["proof:prelaunch:summary"],
    "node scripts/report-prelaunch-status.mjs",
    "prelaunch proof must expose a single compact status command for routine operator checks",
  );
  assert.equal(
    monitoringPackageScripts["proof:local:summary"],
    "node scripts/run-local-proof-preflight.mjs --summary-only",
    "local launch preflight must expose a compact summary command for routine operator checks",
  );
  assert.equal(
    monitoringPackageScripts["proof:launch:summary"],
    "node scripts/run-launch-proof.mjs --summary-only",
    "launch proof must expose a compact summary command for routine operator checks",
  );
  assert.equal(
    monitoringPackageScripts["proof:launch:strict:summary"],
    "node scripts/run-launch-proof.mjs --strict --summary-only",
    "launch proof must expose a compact strict summary command for final launch checks",
  );
  const launchProofRunnerSummarySource = readFileSync("scripts/run-launch-proof.mjs", "utf8");
  assert.match(
    launchProofRunnerSummarySource,
    /const launchSummaryGroups = "launch=1"[\s\S]*function launchGroupSummary\(\)[\s\S]*groups: \$\{launchSummaryGroups\}[\s\S]*launchGroupSummary\(\)/,
    "launch proof summary must identify the launch blocker group without spawning child checks",
  );
  assert.equal(
    monitoringPackageScripts["proof:drafts:summary"],
    "node scripts/check-proof-drafts.mjs --summary-only",
    "proof draft regressions must expose a compact summary command for routine operator checks",
  );
  assert.equal(
    monitoringPackageScripts["proof:drafts:create:summary"],
    "node scripts/create-all-proof-drafts.mjs --summary-only",
    "proof draft bundle generation must expose a compact output mode for routine operator use",
  );
  const createAllProofDraftsSource = readFileSync("scripts/create-all-proof-drafts.mjs", "utf8");
  assert.match(
    createAllProofDraftsSource,
    /const summaryOnly = process\.argv\.includes\("--summary-only"\)[\s\S]*summaryOnly[\s\S]*written=\$\{written\}[\s\S]*failed=\$\{failed\}/,
    "proof draft bundle summary mode must print compact counts instead of local paths",
  );
  assert.match(
    createAllProofDraftsSource,
    /rmSync\(externalRestoreRoot,\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}\)/,
    "proof draft bundle generation must clean up its temporary restore fixture root",
  );
  const checkProofDraftsSource = readFileSync("scripts/check-proof-drafts.mjs", "utf8");
  assert.match(
    checkProofDraftsSource,
    /MAX_PROOF_DRAFT_JSON_BYTES = 512 \* 1024[\s\S]*function readProofDraftJson\(filePath\)[\s\S]*const stats = statSync\(filePath\)[\s\S]*!stats\.isFile\(\)[\s\S]*stats\.size > MAX_PROOF_DRAFT_JSON_BYTES[\s\S]*proof draft JSON artifact is too large to validate safely[\s\S]*JSON\.parse\(readFileSync\(filePath, "utf8"\)\)[\s\S]*signoffValidStrictManifest = readProofDraftJson\(signoffMissingArtifactManifest\)[\s\S]*hostValidStrictManifest = readProofDraftJson\(hostMissingArtifactManifest\)[\s\S]*indexerValidStrictManifest = readProofDraftJson\(indexerMissingArtifactManifest\)[\s\S]*manifest = readProofDraftJson\(item\.out\)/,
    "proof draft regression suite must size-gate self-test JSON artifacts before parsing",
  );
  assert.equal(
    monitoringPackageScripts["soak:testnet:clear-pending:summary"],
    "tsx scripts/clear-live-test-pending-nonce.ts --summary-only",
    "pending nonce dry-run must expose a compact summary command for routine operator checks",
  );
  assert.equal(
    monitoringPackageScripts["soak:testnet:status:compact"],
    "node scripts/run-testnet-soak-supervisor.mjs --status --compact",
    "managed soak status must expose a one-line compact command for autonomous monitors",
  );
  assert.equal(
    monitoringPackageScripts["proof:gates:structure"],
    "node scripts/check-launch-gates.mjs --structure-only",
    "launch gate structure proof must expose a no-external-evidence package script for prelaunch aggregation",
  );
  assert.equal(
    monitoringPackageScripts["proof:files:summary"],
    "node scripts/check-proof-files.mjs --summary-only",
    "proof file guard must expose a compact summary command for routine operator checks",
  );
  assert.equal(
    monitoringPackageScripts["proof:templates:summary"],
    "node scripts/check-proof-templates.mjs --summary-only",
    "proof template guard must expose a compact summary command for routine operator checks",
  );
  assert.equal(
    monitoringPackageScripts["proof:collector-redaction:summary"],
    "node scripts/check-proof-collector-redaction.mjs --summary-only",
    "proof collector redaction guard must expose a compact summary command for routine operator checks",
  );
  assert.equal(
    monitoringPackageScripts["proof:readiness:summary"],
    "node scripts/check-readiness-checklist.mjs --summary-only",
    "readiness checklist guard must expose a compact summary command for routine operator checks",
  );
  assert.equal(
    monitoringPackageScripts["proof:launch-map:summary"],
    "node scripts/check-launch-command-map.mjs --summary-only",
    "launch command map guard must expose a compact summary command for routine operator checks",
  );
  const launchCommandMapSource = readFileSync("scripts/check-launch-command-map.mjs", "utf8");
  assert.match(
    launchCommandMapSource,
    /const summaryOnly = process\.argv\.includes\("--summary-only"\)/,
    "launch command map guard must support compact output without changing validation",
  );
  assert.match(
    launchCommandMapSource,
    /summaryOnly[\s\S]*scripts=\$\{requiredScripts\.length\}[\s\S]*linkedDocs=\$\{linkedDocs\.length\}[\s\S]*proofFiles=\$\{requiredProofFiles\.length\}[\s\S]*issues=\$\{issues\.length\}/,
    "launch command map summary must expose aggregate counts instead of a full coverage table",
  );
  assert.match(
    launchCommandMapSource,
    /MAX_LAUNCH_COMMAND_MAP_TEXT_BYTES = 1024 \* 1024[\s\S]*function readText\(filePath\)[\s\S]*const stats = statSync\(filePath\)[\s\S]*!stats\.isFile\(\)[\s\S]*stats\.size > MAX_LAUNCH_COMMAND_MAP_TEXT_BYTES[\s\S]*too large to validate safely[\s\S]*readFileSync\(filePath, "utf8"\)/,
    "launch command-map guard must size-gate required docs and package files before reading them",
  );
  const readinessChecklistVerifierSource = readFileSync("scripts/check-readiness-checklist.mjs", "utf8");
  assert.match(
    readinessChecklistVerifierSource,
    /const summaryOnly = process\.argv\.includes\("--summary-only"\)/,
    "readiness checklist verifier must support compact output without changing validation",
  );
  assert.match(
    readinessChecklistVerifierSource,
    /summaryOnly[\s\S]*"readiness checklist could not be read"[\s\S]*checkedItems=\$\{checkedItems\.length\}[\s\S]*evidenceIssues=\$\{checkedEvidenceIssues\.length\}[\s\S]*issues=\$\{issues\.length\}/,
    "readiness checklist summary must avoid local path details and expose aggregate evidence counts",
  );
  const proofCollectorRedactionSource = readFileSync("scripts/check-proof-collector-redaction.mjs", "utf8");
  assert.match(
    proofCollectorRedactionSource,
    /const summaryOnly = process\.argv\.includes\("--summary-only"\)/,
    "proof collector redaction guard must support compact output without changing validation",
  );
  assert.match(
    proofCollectorRedactionSource,
    /summaryOnly[\s\S]*cases=\$\{rows\.length\}[\s\S]*redacted=\$\{redacted\}[\s\S]*leaked=\$\{leaked\}[\s\S]*issues=\$\{issues\.length\}/,
    "proof collector redaction summary must expose aggregate counts instead of a full case table",
  );
  assert.match(
    proofCollectorRedactionSource,
    /const tempDirs = \[\][\s\S]*function makeTempDir\(prefix\)[\s\S]*tempDirs\.push\(dir\)[\s\S]*for \(const tempDir of tempDirs\)[\s\S]*rmSync\(tempDir,\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}\)/,
    "proof collector redaction guard must clean up temporary redaction fixtures",
  );
  assert.match(
    proofCollectorRedactionSource,
    /MAX_REJECT_OUT_CLEANUP_BYTES = 64 \* 1024[\s\S]*function cleanupRejectOutPath\(\)[\s\S]*const stats = statSync\(finalRejectOutPath\)[\s\S]*!stats\.isFile\(\) \|\| stats\.size > MAX_REJECT_OUT_CLEANUP_BYTES[\s\S]*readFileSync\(finalRejectOutPath, "utf8"\)/,
    "proof collector redaction guard must size-gate final reject cleanup before reading the output file",
  );
  const proofRedactorSource = readFileSync("scripts/redact-proof-output.mjs", "utf8");
  assert.ok(
    proofRedactorSource.includes("const ARG_VALUE_PATTERN") &&
      proofRedactorSource.includes("(?!--)[^\\s]+") &&
      proofRedactorSource.includes('.replace(ARG_VALUE_PATTERN, "$1$2<redacted>")'),
    "shared proof redactor must handle split sensitive CLI flags without swallowing the next option",
  );
  assert.match(
    proofCollectorRedactionSource,
    /--private-key splitprivate[\s\S]*--rpc-url https:\/\/split-rpc\.example\/\?key=split-token[\s\S]*--database-url postgres:\/\/user:split-pass@db\.example\/lore[\s\S]*--webhook-url "https:\/\/hooks\.example\/\?token=split-hook"[\s\S]*"splitprivate"[\s\S]*"split-token"[\s\S]*"split-rpc\.example"[\s\S]*"split-pass"[\s\S]*"split-hook"/,
    "proof collector redaction guard must cover whitespace-separated sensitive CLI arguments",
  );
  const autonomousStatusProofRedactionSource = readFileSync("scripts/report-autonomous-status.mjs", "utf8");
  assert.match(
    autonomousStatusProofRedactionSource,
    /remaining[\s\S]*proof:remaining:summary[\s\S]*security-followup[\s\S]*proof:security-followup:summary[\s\S]*collector-redaction[\s\S]*proof:collector-redaction:summary[\s\S]*wallet-runtime[\s\S]*test:logic:summary/,
    "autonomous status summary must include proof collector redaction before the broad wallet-runtime proof row",
  );
  assert.match(
    autonomousStatusProofRedactionSource,
    /function summarizeCollectorRedaction\(output\)[\s\S]*status=\(pass\|fail\)[\s\S]*cases=\(\\d\+\)[\s\S]*redacted=\(\\d\+\)[\s\S]*leaked=\(\\d\+\)[\s\S]*issues=\(\\d\+\)[\s\S]*invalid-collector-redaction-summary[\s\S]*status=\$\{status\}, cases=\$\{cases\}, redacted=\$\{redacted\}, leaked=\$\{leaked\}, issues=\$\{issues\}[\s\S]*check\.id === "collector-redaction"/,
    "autonomous status must summarize proof collector redaction as strict counters without raw prose",
  );
  const proofTemplatesSource = readFileSync("scripts/check-proof-templates.mjs", "utf8");
  assert.match(
    proofTemplatesSource,
    /const summaryOnly = process\.argv\.includes\("--summary-only"\)/,
    "proof template guard must support compact output without changing validation",
  );
  assert.match(
    proofTemplatesSource,
    /MAX_PROOF_TEMPLATE_DOC_BYTES = 512 \* 1024[\s\S]*function readTemplateDoc\(filePath\)[\s\S]*const stats = statSync\(filePath\)[\s\S]*!stats\.isFile\(\)[\s\S]*stats\.size > MAX_PROOF_TEMPLATE_DOC_BYTES[\s\S]*too large to validate safely[\s\S]*readFileSync\(filePath, "utf8"\)/,
    "proof template guard must size-gate the template markdown before reading it",
  );
  assert.match(
    proofTemplatesSource,
    /summaryOnly[\s\S]*templates=\$\{rows\.length\}[\s\S]*rejected=\$\{rejected\}[\s\S]*issues=\$\{issues\.length\}/,
    "proof template summary must expose aggregate counts instead of a full template table",
  );
  const proofFilesSource = readFileSync("scripts/check-proof-files.mjs", "utf8");
  assert.match(
    proofFilesSource,
    /const summaryOnly = process\.argv\.includes\("--summary-only"\)/,
    "proof file guard must support compact output without changing validation",
  );
  assert.match(
    proofFilesSource,
    /summaryOnly[\s\S]*issues=\$\{issues\.length\}[\s\S]*canaryLog=\$\{canaryLogPath \? "present" : "missing"\}/,
    "proof file summary must expose aggregate status without printing local canary paths",
  );
  assert.match(
    proofFilesSource,
    /summaryOnly[\s\S]*`\$\{issues\.length\} proof file issue\(s\)`[\s\S]*issues\.join/,
    "proof file summary must avoid printing detailed local artifact issue paths",
  );
  assert.equal(
    monitoringPackageScripts["proof:process-model:summary"],
    "node scripts/check-process-model.mjs --summary-only",
    "process model proof must expose a compact summary command for routine operator checks",
  );
  const processModelProofSource = readFileSync("scripts/check-process-model.mjs", "utf8");
  assert.match(
    processModelProofSource,
    /const summaryOnly = process\.argv\.includes\("--summary-only"\)/,
    "process model proof must support compact output without changing validation",
  );
  assert.match(
    processModelProofSource,
    /Config: \$\{summaryOnly \? \(existsSync\(ecosystemPath\) \? "present" : "missing"\) : ecosystemPath\}/,
    "process model proof summary must avoid printing the local ecosystem config path",
  );
  assert.match(
    processModelProofSource,
    /summaryOnly[\s\S]*\? "ecosystem\.config\.cjs could not be loaded"[\s\S]*: `ecosystem\.config\.cjs could not be loaded:/,
    "process model proof summary must avoid printing raw config loader errors",
  );
  assert.match(
    processModelProofSource,
    /MAX_PACKAGE_JSON_BYTES = 512 \* 1024[\s\S]*function packageScripts\(\)[\s\S]*const packageStat = statSync\(packagePath\)[\s\S]*!packageStat\.isFile\(\) \|\| packageStat\.size > MAX_PACKAGE_JSON_BYTES[\s\S]*JSON\.parse\(readFileSync\(packagePath, "utf8"\)\)/,
    "process model proof must size-gate package.json before parsing package scripts",
  );
  const npmrcSource = readFileSync(".npmrc", "utf8");
  assert.match(npmrcSource, /^update-notifier=false$/m, "repo npm config must suppress update notices in compact evidence output");
  assert.match(npmrcSource, /^fund=false$/m, "repo npm config must suppress funding prompts in compact evidence output");
  const backupSummarySource = readFileSync("scripts/backup-sqlite.mjs", "utf8");
  assert.match(
    backupSummarySource,
    /const backupSummaryGroups = "backup=1"[\s\S]*function fail\(message\)[\s\S]*summaryOnly[\s\S]*JSON\.stringify\(\{ status: "fail", groups: backupSummaryGroups, issue: compactIssue\(new Error\(message\)\) \}\)/,
    "backup summary must fail closed with redacted compact JSON instead of a stack trace",
  );
  assert.doesNotMatch(
    backupSummarySource,
    /import \{ createSqliteBackup, pruneSqliteBackups \} from "\.\/sqlite-backup-lib\.mjs"/,
    "backup summary must not import SQLite before validating missing configuration",
  );
  assert.match(
    collectMainnetProofSource,
    /const SUMMARY_ONLY = process\.argv\.includes\("--summary-only"\)/,
    "mainnet env proof must support compact output without changing validation",
  );
  assert.match(
    collectMainnetProofSource,
    /SUMMARY_ONLY[\s\S]*`Gates checked: \$\{checks\.length\}`[\s\S]*`Failing gates: \$\{failed\.length\}`[\s\S]*`Failing gate names: \$\{failed\.map/,
    "mainnet env proof summary must print aggregate gate counts and failing gate names only",
  );
  assert.match(
    collectMainnetProofSource,
    /function gateGroup\(gate\)[\s\S]*network[\s\S]*contract[\s\S]*rate-limit[\s\S]*backup[\s\S]*function failingGateGroups\(failedChecks\)[\s\S]*`Failing gate groups: \$\{failingGateGroups\(failed\)\}`/,
    "mainnet env proof summary must group failing production-like integration gates without printing env values",
  );
  assert.match(
    collectMainnetProofSource,
    /function gateToken\(gate\)[\s\S]*replace\(\/\[\^a-z0-9\]\+\/g, "-"\)[\s\S]*slice\(0, 64\)[\s\S]*function failingGateTokens\(failedChecks\)[\s\S]*`Failing gate tokens: \$\{failingGateTokens\(failed\)\}`/,
    "mainnet env proof summary must emit safe failing gate tokens for operator task lists",
  );
  assert.match(
    collectMainnetProofSource,
    /function isHttpsUrl\(value\)[\s\S]*url\.protocol === "https:"[\s\S]*!url\.username[\s\S]*!url\.password[\s\S]*Boolean\(url\.hostname\)/,
    "mainnet env proof must reject credentialed or hostless HTTPS-style service URLs",
  );
  assert.match(
    collectMainnetProofSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parsePositiveInteger\(value\)[\s\S]*\^\[1-9\]\\d\{0,15\}\$[\s\S]*const parsed = BigInt\(normalized\)[\s\S]*parsed <= MAX_SAFE_INTEGER_BIGINT \? Number\(parsed\) : null[\s\S]*function isPositiveInteger\(value\)[\s\S]*parsePositiveInteger\(value\) !== null[\s\S]*const webReplicaCount = parsePositiveInteger\(webReplicaCountRaw\)[\s\S]*const hasValidWebReplicaCount = webReplicaCount !== null/,
    "mainnet env proof must canonical-parse deploy/finality integer gates and WEB_REPLICA_COUNT before G1/G6 readiness decisions",
  );
  assert.doesNotMatch(
    collectMainnetProofSource,
    /const webReplicaCount = Number\(webReplicaCountRaw\)|const parsed = Number\(normalized\)/,
    "mainnet env proof must not broadly coerce WEB_REPLICA_COUNT",
  );
  assert.match(
    collectMainnetProofSource,
    /: \[[\s\S]*"\| Gate \| Status \| Value \|"[\s\S]*\.\.\.checks\.map/,
    "mainnet env proof must keep detailed gate values out of summary-only output",
  );
  assert.match(
    collectMainnetProofSource,
    /if \(outPath && !SUMMARY_ONLY\)/,
    "mainnet env proof summary must not write final proof snapshots",
  );
  assert.match(
    checkMainnetProofOutputSource,
    /rmSync\(tempRoot,\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}\)/,
    "mainnet proof output guard must clean up temporary strict-fail workspace",
  );
  for (const launchDocPath of ["docs/launch-evidence-command-map.md", "docs/production-runbook.md"]) {
    const launchDocSource = readFileSync(launchDocPath, "utf8");
    assert.match(
      launchDocSource,
      /proof:prelaunch:summary[\s\S]*proof:local:summary[\s\S]*proof:security-followup:summary[\s\S]*proof:autonomous:daily:summary[\s\S]*proof:process-model:summary[\s\S]*proof:templates:summary[\s\S]*proof:files:summary[\s\S]*proof:collector-redaction:summary[\s\S]*proof:readiness:summary[\s\S]*proof:launch-map:summary[\s\S]*proof:remaining:summary[\s\S]*proof:mainnet:summary[\s\S]*proof:mainnet:strict:summary[\s\S]*proof:chain:summary[\s\S]*proof:chain:strict:summary[\s\S]*proof:signoff:summary[\s\S]*proof:signoff:strict:summary[\s\S]*proof:host:summary[\s\S]*proof:host:strict:summary[\s\S]*proof:indexer:summary[\s\S]*proof:indexer:strict:summary[\s\S]*proof:restore:summary[\s\S]*proof:restore:strict:summary[\s\S]*proof:monitoring:summary[\s\S]*proof:monitoring:strict:summary[\s\S]*proof:qa:summary[\s\S]*proof:qa:strict:summary[\s\S]*proof:canary:summary[\s\S]*proof:testnet:canary:strict:summary[\s\S]*proof:testnet:canary:v10:summary[\s\S]*db:backup:summary[\s\S]*db:backup:strict:summary[\s\S]*proof:launch:summary[\s\S]*proof:launch:strict:summary/,
      `${launchDocPath} must document the compact launch status loop before long proof output`,
    );
  }
  const launchDocsVerifierSource = readFileSync("scripts/check-launch-doc-command-syntax.mjs", "utf8");
  assert.match(
    launchDocsVerifierSource,
    /const packageScripts = JSON\.parse\(readText\("package\.json"\)\)\.scripts \?\? \{\}/,
    "launch docs verifier must load package scripts for operator command validation",
  );
  assert.match(
    launchDocsVerifierSource,
    /const MAX_DOC_PACKAGE_SCRIPT_REFS = 256[\s\S]*function scanMissingPackageScripts\(text\)[\s\S]*pattern\.exec\(text\)[\s\S]*scanned > MAX_DOC_PACKAGE_SCRIPT_REFS[\s\S]*!\(script in packageScripts\)[\s\S]*Package Scripts/,
    "launch docs verifier must fail when docs reference missing npm scripts",
  );
  assert.match(
    launchDocsVerifierSource,
    /packageScriptScan\.overLimit[\s\S]*references too many package scripts to validate safely/,
    "launch docs verifier must fail closed when docs contain too many package script references",
  );
  assert.doesNotMatch(
    launchDocsVerifierSource,
    /text\.matchAll\(/,
    "launch docs verifier must not materialize npm script references through matchAll",
  );
  assert.match(
    launchDocsVerifierSource,
    /const summaryOnly = process\.argv\.includes\("--summary-only"\)[\s\S]*if \(summaryOnly\)[\s\S]*checkedDocs: rows\.length[\s\S]*inlineSyntaxIssues: inlineSyntaxIssueCount[\s\S]*missingPackageScripts: missingPackageScriptCount[\s\S]*process\.exit\(\)/,
    "launch docs verifier summary mode must emit compact counts without the full docs table",
  );
  assert.match(
    launchDocsVerifierSource,
    /function readText\(filePath\)[\s\S]*const stats = statSync\(filePath\)[\s\S]*!stats\.isFile\(\)[\s\S]*must be a file/,
    "launch docs verifier must reject directory paths before reading package or docs files",
  );
  assert.match(
    launchDocsVerifierSource,
    /MAX_LAUNCH_DOC_TEXT_BYTES = 1024 \* 1024[\s\S]*function readText\(filePath\)[\s\S]*const stats = statSync\(filePath\)[\s\S]*!stats\.isFile\(\)[\s\S]*stats\.size > MAX_LAUNCH_DOC_TEXT_BYTES[\s\S]*too large to validate safely[\s\S]*readFileSync\(filePath, "utf8"\)/,
    "launch docs verifier must size-gate package and docs files before reading them",
  );
  const remainingLaunchProofSource = readFileSync("scripts/report-launch-remaining.mjs", "utf8");
  assert.match(
    remainingLaunchProofSource,
    /const summaryOnly = process\.argv\.includes\("--summary-only"\)/,
    "remaining launch evidence proof must support compact output without changing validation",
  );
  assert.match(
    remainingLaunchProofSource,
    /const launchGateGroups = new Map\(\[[\s\S]*"G1", "env"[\s\S]*"G14", "qa"[\s\S]*function formatGateGroups\(gateIds\)[\s\S]*remainingGateGroups: formatGateGroups\(missing\)[\s\S]*Remaining gate groups: \$\{formatGateGroups\(missing\)\}/,
    "remaining launch evidence summary must group compact gate counts by launch evidence domain",
  );
  assert.match(
    remainingLaunchProofSource,
    /"G14"[\s\S]*final security scan[\s\S]*no open High\/Medium local findings/,
    "remaining launch evidence summary must keep the final security scan blocker visible in G14",
  );
  assert.match(
    remainingLaunchProofSource,
    /const visibleMarkerTokenLimit = 8[\s\S]*action\.markerTokens\.slice\(0, visibleMarkerTokenLimit\)[\s\S]*action\.markerTokens\.length - visibleMarkerTokenLimit/,
    "remaining launch evidence summary must keep enough bounded marker tokens visible for G14 security blockers",
  );
  assert.match(
    remainingLaunchProofSource,
    /function buildGateAction\(row\)[\s\S]*proofFiles: requiredProofFilesByGate\.get\(row\.id\)[\s\S]*markerTokens: \(requiredProofMarkerExpectations\.get\(row\.id\)[\s\S]*statusCheck: compactStatusCheckByGate\.get\(row\.id\)/,
    "remaining launch evidence summary must build sanitized per-gate next-action records",
  );
  assert.match(
    remainingLaunchProofSource,
    /summaryOnly[\s\S]*Complete gates: \$\{complete\.length\}\/\$\{expected\.length\}[\s\S]*Remaining gates: \$\{missing\.length === 0 \? "none" : missing\.join[\s\S]*Remaining gate worklist:[\s\S]*formatGateActionLine\(action\)[\s\S]*remainingSummaryLine\(missing\)/,
    "remaining launch evidence summary must print compact gate counts plus a bounded per-gate worklist",
  );
  assert.match(
    remainingLaunchProofSource,
    /summaryOnly[\s\S]*Next gate: \$\{nextGate\.id\} \$\{nextGate\.gate\}[\s\S]*Next gate group: \$\{nextGateAction\.group\}[\s\S]*Next proof files: \$\{formatNextProofFiles\(nextGate\.id\)\}[\s\S]*Next marker tokens: \$\{formatNextMarkerTokens\(nextGate\.id\)\}[\s\S]*Next status check: \$\{nextGateAction\.statusCheck \|\| "none"\}[\s\S]*Next first check: \$\{nextGate\.firstCheck\}[\s\S]*Autonomous boundary: \$\{autonomousBoundary\}[\s\S]*Autonomous next: \$\{autonomousNextCheck\}/,
    "remaining launch evidence summary must show the next external gate and the safe autonomous next command without dumping every row",
  );
  assert.match(
    remainingLaunchProofSource,
    /const autonomousBoundary = "local-hardening-only"[\s\S]*const autonomousNextCheck = "npm\.cmd run proof:autonomous:summary"/,
    "remaining launch evidence summary must route autonomous work to the lightweight local status command",
  );
  assert.match(
    remainingLaunchProofSource,
    /const transactionBoundary = "fresh-preview-plus-explicit-consent"[\s\S]*plan:canary:v10:postdeploy:summary[\s\S]*preview:canary:v10:dry-run[\s\S]*preview:canary:v10:dry-run:summary[\s\S]*preview:canary:v10:authorization-ready:summary[\s\S]*authorization-ready freshness check[\s\S]*Consent requirement: \$\{transactionConsentRequirement\}/,
    "remaining launch evidence summary must keep the fresh Preview, authorization-ready, and explicit consent boundary visible before live transaction tests",
  );
  assert.match(
    remainingLaunchProofSource,
    /MAX_REMAINING_LAUNCH_MARKDOWN_BYTES = 1024 \* 1024[\s\S]*function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*function readMarkdown\(filePath\)[\s\S]*const stats = regularFileStat\(filePath\)[\s\S]*stats\.size > MAX_REMAINING_LAUNCH_MARKDOWN_BYTES[\s\S]*too large to summarize safely[\s\S]*readFileSync\(filePath, "utf8"\)/,
    "remaining launch evidence summary must size-gate proof and status board markdown before reading it",
  );
  const autonomousStatusSource = readFileSync("scripts/report-autonomous-status.mjs", "utf8");
  assert.match(
    autonomousStatusSource,
    /proof:remaining:summary[\s\S]*proof:security-followup:summary[\s\S]*test:logic:summary[\s\S]*test:contract:v10:summary[\s\S]*test:indexer-storage:summary[\s\S]*proof:contract-deployed:v10:summary[\s\S]*proof:signoff:strict:summary[\s\S]*proof:chain:strict:summary[\s\S]*proof:host:strict:summary[\s\S]*soak:testnet:status:compact[\s\S]*soak:testnet:clear-pending:summary[\s\S]*preview:canary:v10:dry-run:summary[\s\S]*cleanup:workspace:dry-run:summary[\s\S]*proof:qa:strict:summary[\s\S]*proof:testnet:canary:v10:summary[\s\S]*proof:launch:strict:summary[\s\S]*monitor:runtime:summary[\s\S]*proof:indexer:strict:summary[\s\S]*proof:restore:strict:summary[\s\S]*db:backup:strict:summary[\s\S]*proof:mainnet:strict:compact/,
    "autonomous status must combine only compact read-only status commands for residual security follow-up, wallet runtime logic, and every G1-G14 evidence domain, including deployed V10 identity, pending nonce recovery, V10 dry-run Preview freshness, monitoring, indexer, and strict backup/restore proof visibility",
  );
  assert.match(
    autonomousStatusSource,
    /preview:canary:v10:authorization-ready:summary[\s\S]*check\.id === "v10-preview" \|\| check\.id === "v10-authorization-preview"/,
    "autonomous status must surface the authorization-ready V10 Preview freshness blocker as its own compact row",
  );
  assert.match(
    autonomousStatusSource,
    /function knownIssueToken\(value\)[\s\S]*lore_db_path[\s\S]*lore_backup_dir[\s\S]*--source[\s\S]*--out[\s\S]*backup-paths-or-source-output-required[\s\S]*strict chain proof requires configured rpc env[\s\S]*built-in fallback[\s\S]*strict-chain-proof-requires-configured-rpc-env[\s\S]*function lineToken\(value, max = 64\)[\s\S]*const known = knownIssueToken\(value\)[\s\S]*if \(known\) return known/,
    "autonomous status must keep known backup and chain blockers as stable compact issue tokens instead of truncating them",
  );
  assert.match(
    autonomousStatusSource,
    /function summarizeRemaining\(output\)[\s\S]*Transaction boundary:[\s\S]*Pre-transaction preview checks:[\s\S]*Consent requirement:[\s\S]*txBoundary=\$\{transactionBoundaryToken\}[\s\S]*consent=\$\{consentToken\}[\s\S]*previewChecks=\$\{previewCheckTokens\}/,
    "autonomous status must preserve the fresh Preview plus explicit consent boundary from remaining-gate proof output",
  );
  assert.match(
    autonomousStatusSource,
    /function jsonStatus\(value[\s\S]*function summarizeV10Deployed\(output\)[\s\S]*status=\$\{jsonStatus\(parsed\.status\)\}[\s\S]*network=\$\{safeTokenList\(\[parsed\.network\]\)\}[\s\S]*runtimeBytecode=\$\{parsed\.runtimeBytecode === true\}[\s\S]*runtimeExecutable=\$\{parsed\.runtimeExecutable === true\}[\s\S]*metadataOnlyMismatch=\$\{parsed\.metadataOnlyMismatch === true\}[\s\S]*transactionSent=\$\{parsed\.transactionSent === true\}/,
    "autonomous status must surface compact read-only deployed V10 identity mismatch facts without chain mutation",
  );
  assert.doesNotMatch(
    autonomousStatusSource,
    /function summarizeV10Deployed\(output\)[\s\S]*status=\$\{parsed\.status\}/,
    "autonomous deployed V10 summary must not print raw child JSON status",
  );
  assert.match(
    autonomousStatusSource,
    /function summarizePendingNonce\(output\)[\s\S]*operationalBoundary[\s\S]*role=\$\{safeStatusTokenList\(\[parsed\.role\]\)\}[\s\S]*mode=\$\{safeStatusTokenList\(\[parsed\.mode\]\)\}[\s\S]*pendingGap=\$\{integerField\(parsed\.pendingNonceGap\)\}[\s\S]*replacementCap=\$\{integerField\(parsed\.replacementCap\)\}[\s\S]*wouldSend=\$\{parsed\.wouldSendReplacement === true\}[\s\S]*dryRunDefault=\$\{boundary\.dryRunDefault === true\}[\s\S]*signing=\$\{boundary\.signingMaterialLoaded === true\}[\s\S]*walletClient=\$\{boundary\.walletClientCreated === true\}[\s\S]*contractWrite=\$\{boundary\.contractWriteSubmitted === true\}[\s\S]*txSent=\$\{boundary\.transactionSent === true\}/,
    "autonomous status must surface pending nonce dry-run and no-transaction facts without addresses",
  );
  assert.match(
    autonomousStatusSource,
    /function summarizeV10Preview\(output\)[\s\S]*ageMinutes=\$\{integerField\(parsed\.ageMinutes\)\}[\s\S]*transactionLimit=\$\{integerField\(parsed\.transactionLimit\)\}[\s\S]*estimatedGas=\$\{integerField\(parsed\.estimatedGas\)\}[\s\S]*plannedBetTx=\$\{integerField\(parsed\.plannedBetTx\)\}[\s\S]*txSent=\$\{parsed\.transactionSent === true\}[\s\S]*signing=\$\{parsed\.signingMaterialLoaded === true\}[\s\S]*walletClient=\$\{parsed\.walletClientCreated === true\}[\s\S]*contractWrite=\$\{parsed\.contractWriteSubmitted === true\}[\s\S]*dryRunBlocksG10G11=\$\{parsed\.dryRunProofBlocksG10G11 === true\}[\s\S]*check\.id === "v10-preview"/,
    "autonomous status must surface V10 dry-run Preview freshness, bounded plan size, and no-transaction facts without raw Preview excerpts",
  );
  assert.match(
    autonomousStatusSource,
    /function summarizeV10Preview\(output\)[\s\S]*authFresh=\$\{parsed\.authorizationFreshnessRequired === true\}[\s\S]*maxAgeMinutes=\$\{integerField\(parsed\.maxPreviewAgeMinutes\)\}/,
    "autonomous status must surface whether the V10 Preview is fresh enough for transaction authorization",
  );
  assert.match(
    autonomousStatusSource,
    /parsed\.status !== "pass" && parsed\.issue[\s\S]*status=fail, authFresh=\$\{parsed\.authorizationFreshnessRequired === true\}, ageMinutes=\$\{integerField\(parsed\.ageMinutes\)\}, maxAgeMinutes=\$\{integerField\(parsed\.maxPreviewAgeMinutes\)\}, issue=\$\{lineToken\(parsed\.issue, 96\)\}/,
    "autonomous status must not summarize stale authorization-ready Preview failures as zero transaction/log/gas Preview facts",
  );
  assert.match(
    autonomousStatusSource,
    /function nonNegativeSafeInteger\(value\)[\s\S]*function integerField\(value\)[\s\S]*nonNegativeSafeInteger\(value\) \?\? 0[\s\S]*function summarizeV10Deployed\(output\)[\s\S]*chainId=\$\{integerField\(parsed\.chainId\)\}[\s\S]*runtimeBytes=\$\{integerField\(parsed\.runtimeBytes\)\}[\s\S]*function summarizeSecurityFollowup\(output\)[\s\S]*checks=\$\{integerField\(parsed\.checks\)\}[\s\S]*function summarizeV10Invariants\(output\)[\s\S]*guarded=\$\{integerField\(parsed\.guardedLocalMutationEntrypoints\)\}[\s\S]*accountingCases=\$\{integerField\(parsed\.fullRangeAccountingCases\)\}[\s\S]*proportionalCases=\$\{integerField\(parsed\.fullRangeProportionalCases\)\}[\s\S]*assertionFailures=\$\{integerField\(parsed\.assertionFailures\)\}[\s\S]*function summarizeAbiIndexerStorage\(output\)[\s\S]*categories=\$\{integerField\(parsed\.categories\)\}/,
    "autonomous status must require non-negative safe integer counters for pending nonce, deployed identity, security follow-up, V10 invariant, and ABI/indexer summaries",
  );
  assert.match(
    autonomousStatusSource,
    /function nonNegativeSafeInteger\(value\)[\s\S]*Number\.isSafeInteger\(value\) && value >= 0[\s\S]*function summarizeCleanup\(output\)[\s\S]*matchedTargets = nonNegativeSafeInteger\(parsed\.matchedTargets\)[\s\S]*bytes = nonNegativeSafeInteger\(parsed\.bytes\)[\s\S]*matched=\$\{matchedTargets \?\? 0\}, bytes=\$\{bytes \?\? 0\}/,
    "autonomous status cleanup summary must require safe non-negative integer counters",
  );
  assert.doesNotMatch(
    autonomousStatusSource,
    /summarizeCleanup[\s\S]*Number\.isFinite\(parsed\.(?:matchedTargets|bytes)\)|Number\.isSafeInteger\(parsed\.(?:pendingNonceGap|replacementCap|chainId|runtimeBytes|expectedRuntimeBytes|assertionFailures|checks|passed|failed|functionSelectors|protocolFeeFlushModelCases|categories)\)/,
    "autonomous status summaries must not broadly accept fractional or negative counters",
  );
  assert.doesNotMatch(
    autonomousStatusSource,
    /nonNegativeSafeInteger\(Number\((?:text\.match|completeMatch|failing\.match|match\[)|return nonNegativeSafeInteger\(Number\(text\)\)|const parsed = Number\(raw\)/,
    "autonomous status summaries must canonical-parse text-derived counters before compact output",
  );
  assert.match(
    autonomousStatusSource,
    /function parseCompactKeyValues\(output, prefix\)[\s\S]*function compactTokenField\(values, key[\s\S]*function compactAggregateField\(values, key[\s\S]*function compactBooleanField\(values, key\)[\s\S]*function compactIntegerField\(values, key\)[\s\S]*function compactHealthField\(values\)[\s\S]*function summarizeSoak\(output\)[\s\S]*const values = parseCompactKeyValues\(output, "status="\)[\s\S]*roles=\$\{compactAggregateField\(values, "roles"\)\}[\s\S]*dupTx=\$\{compactIntegerField\(values, "dupTx"\)\}[\s\S]*health=\$\{compactHealthField\(values\)\}[\s\S]*diskFree=\$\{compactIntegerField\(values, "diskFree"\)\}[\s\S]*preflight=\$\{compactAggregateField\(values, "preflight"\)\}[\s\S]*fk=\$\{compactAggregateField\(values, "fk"\)\}[\s\S]*ff=\$\{compactAggregateField\(values, "ff"\)\}/,
    "autonomous status must parse testnet soak compact status into bounded typed fields instead of replaying a raw status line",
  );
  assert.doesNotMatch(
    autonomousStatusSource,
    /function summarizeSoak\(output\)[\s\S]*return clamp\(output\.split|function summarizeSoak\(output\)[\s\S]*line\.startsWith\("status="\)/,
    "autonomous status soak summary must not return the raw compact status line",
  );
  assert.match(
    autonomousStatusSource,
    /function safeStatusTokenList\(value\)[\s\S]*\^\[a-zA-Z0-9_-\]\{1,64\}\$/,
    "autonomous status must preserve safe uppercase role tokens like AUTOMINER_A without allowing addresses",
  );
  assert.ok(
    autonomousStatusSource.includes("function formatGroupSummary(value)") &&
      autonomousStatusSource.includes("function formatIssueToken(value)") &&
      autonomousStatusSource.includes("redactProofText(value)") &&
      autonomousStatusSource.includes('replace(/[^a-z0-9]+/g, "-")') &&
      autonomousStatusSource.includes(".slice(0, 16)") &&
      autonomousStatusSource.includes('const rawGroups = lineStarting(output, "Remaining gate groups:")') &&
      autonomousStatusSource.includes("const completeToken = completeDone !== null && completeTotal !== null && completeTotal >= completeDone") &&
      autonomousStatusSource.includes('nextGate ? `next=${nextGate}` : ""') &&
      autonomousStatusSource.includes('nextGroup ? `nextGroup=${nextGroup}` : ""') &&
      autonomousStatusSource.includes('autonomousToken ? `autonomous=${autonomousToken}` : ""') &&
      autonomousStatusSource.includes('summaryToken ? `summary=${summaryToken}` : ""') &&
      autonomousStatusSource.includes('const rawGroups = lineStarting(output, "Failing gate groups:")') &&
      autonomousStatusSource.includes("const groupTokens = rawGroups") &&
      autonomousStatusSource.includes('const rawTokens = lineStarting(output, "Failing gate tokens sample:")') &&
      autonomousStatusSource.includes("const tokenSample = rawTokens") &&
      autonomousStatusSource.includes("function formatSummaryLine(line)") &&
      autonomousStatusSource.includes("const issueCount = nonNegativeSafeIntegerText(text.match") &&
      autonomousStatusSource.includes('gates=${gateTokens}') &&
      autonomousStatusSource.includes('groups=${groupTokens}') &&
      autonomousStatusSource.includes('issue=${issueToken}') &&
      autonomousStatusSource.includes("function summarizeManifestSummary(output)") &&
      autonomousStatusSource.includes('manifestToken ? `manifest=${manifestToken}` : ""') &&
      autonomousStatusSource.includes("const groups = formatGroupSummary(parsed.groups)") &&
      autonomousStatusSource.includes("const issue = formatIssueToken(parsed.issue)") &&
      autonomousStatusSource.includes("const missing = safeTokenList(parsed.missingConfig)") &&
      autonomousStatusSource.includes("wouldPoll=${parsed.wouldPoll === true}") &&
      autonomousStatusSource.includes("wouldSendAlerts=${parsed.wouldSendAlerts === true}"),
    "autonomous status must summarize runtime monitor blockers without polling or sending alerts",
  );
  assert.doesNotMatch(
    autonomousStatusSource,
    /typeof parsed\.(?:groups|issue) === "string"[\s\S]*parsed\.(?:groups|issue)|const groups = lineStarting\(output, "Failing gate groups:"\)[\s\S]*const tokens = lineStarting\(output, "Failing gate tokens sample:"\)[\s\S]*\[failing, groups, tokens, summary\]|Remaining gate groups:[\s\S]*\[complete, next, group, autonomous, summary\]|Next gate:[\s\S]*Autonomous next:[\s\S]*compactSummary|return clamp\(\[manifest, summary\]|return clamp\(\[network, rpcSource, summary\]|return clamp\(\[canaryLog, wouldRun, summary\]|return clamp\(\[profile, summary\]/,
    "autonomous status must not print raw compact JSON or line-derived proof blocker strings",
  );
  assert.match(
    autonomousStatusSource,
    /function summarizeSecurityFollowup\(output\)[\s\S]*failedIds[\s\S]*status=\$\{parsed\.status === "pass" \? "pass" : "fail"\}[\s\S]*checks=\$\{integerField\(parsed\.checks\)\}[\s\S]*failedIds=\$\{failedIds\}[\s\S]*hostAuth=\$\{parsed\.hostAuth === true\}[\s\S]*webLocks=\$\{parsed\.webLocks === true\}[\s\S]*keeperNonce=\$\{parsed\.keeperNonce === true\}[\s\S]*keeperBotReceipts=\$\{parsed\.keeperBotReceipts === true\}[\s\S]*depositLimiter=\$\{parsed\.depositLimiter === true\}[\s\S]*dryRunDefaults=\$\{parsed\.dryRunDefaults === true\}[\s\S]*ciSecurity=\$\{parsed\.ciSecurity === true\}[\s\S]*autoResolve=\$\{parsed\.autoResolve === true\}[\s\S]*appResolveEpochFiles=\$\{integerField\(parsed\.appResolveEpochFiles\)\}[\s\S]*check\.id === "security-followup"/,
    "autonomous status must summarize residual security follow-up without dumping source or raw logs",
  );
  assert.match(
    autonomousStatusSource,
    /function summarizeWalletRuntimeLogic\(output\)[\s\S]*status=\$\{parsed\.status === "pass" \? "pass" : "fail"\}[\s\S]*businessLogic=\$\{parsed\.businessLogic === true\}[\s\S]*expectedWarnings=\$\{integerField\(parsed\.expectedWarnings\)\}[\s\S]*assertionFailures=\$\{integerField\(parsed\.assertionFailures\)\}[\s\S]*timedOut=\$\{parsed\.timedOut === true\}[\s\S]*durationMs=\$\{integerField\(parsed\.durationMs\)\}[\s\S]*childExitCode=\$\{optionalIntegerField\(parsed\.childExitCode\)\}[\s\S]*check\.id === "wallet-runtime"/,
    "autonomous status must summarize wallet runtime logic with compact counters, duration, and exit evidence",
  );
  assert.match(
    autonomousStatusSource,
    /function summarizeWalletRuntimeLogic\(output\)[\s\S]*localProof=\$\{parsed\.localProof === true\}[\s\S]*apiBoundaryProof=\$\{parsed\.apiBoundaryProof === true\}[\s\S]*walletTxStateMachineProof=\$\{parsed\.walletTxStateMachineProof === true\}[\s\S]*walletClaimStateMachineProof=\$\{parsed\.walletClaimStateMachineProof === true\}[\s\S]*authBoundaryProof=\$\{parsed\.authBoundaryProof === true\}[\s\S]*replicaRateLimitBoundaryProof=\$\{parsed\.replicaRateLimitBoundaryProof === true\}[\s\S]*browserBaselineCompactPerformance=\$\{parsed\.browserBaselineCompactPerformance === true\}[\s\S]*jsonNoStoreRoutes=\$\{parsed\.jsonNoStoreRoutes === true\}[\s\S]*check\.id === "wallet-runtime"/,
    "autonomous status must put aggregate local/API/auth/replica/browser proof tokens before verbose component fields",
  );
  assert.match(
    autonomousStatusSource,
    /function summarizeWalletRuntimeLogic\(output\)[\s\S]*walletTxStateMachineProof=\$\{parsed\.walletTxStateMachineProof === true\}[\s\S]*miningPendingRecoveryScoped=\$\{parsed\.miningPendingRecoveryScoped === true\}[\s\S]*miningReceiptRevertExplicit=\$\{parsed\.miningReceiptRevertExplicit === true\}[\s\S]*walletHashlessNonceRecovery=\$\{parsed\.walletHashlessNonceRecovery === true\}[\s\S]*manualMinePendingAmbiguousSafe=\$\{parsed\.manualMinePendingAmbiguousSafe === true\}[\s\S]*approvalDuplicateSendSafe=\$\{parsed\.approvalDuplicateSendSafe === true\}[\s\S]*autoMinerNonceRecoverySafe=\$\{parsed\.autoMinerNonceRecoverySafe === true\}[\s\S]*autoMinerRpcReconnectSafe=\$\{parsed\.autoMinerRpcReconnectSafe === true\}[\s\S]*check\.id === "wallet-runtime"/,
    "autonomous status must surface compact wallet transaction state-machine proof fields",
  );
  assert.match(
    autonomousStatusSource,
    /function summarizeWalletRuntimeLogic\(output\)[\s\S]*walletClaimStateMachineProof=\$\{parsed\.walletClaimStateMachineProof === true\}[\s\S]*rewardClaimStateSafe=\$\{parsed\.rewardClaimStateSafe === true\}[\s\S]*safetyPoolClaimStateSafe=\$\{parsed\.safetyPoolClaimStateSafe === true\}[\s\S]*resolverClaimStateSafe=\$\{parsed\.resolverClaimStateSafe === true\}[\s\S]*check\.id === "wallet-runtime"/,
    "autonomous status must surface compact reward, Safety Pool, and resolver claim state-machine proof fields",
  );
  assert.match(
    autonomousStatusSource,
    /function summarizeWalletRuntimeLogic\(output\)[\s\S]*jsonNoStoreRoutes=\$\{parsed\.jsonNoStoreRoutes === true\}[\s\S]*sessionVaryCookie=\$\{parsed\.sessionVaryCookie === true\}[\s\S]*boundedJsonRoutes=\$\{parsed\.boundedJsonRoutes === true\}[\s\S]*rateLimitNoStore=\$\{parsed\.rateLimitNoStore === true\}[\s\S]*routeErrorRedaction=\$\{parsed\.routeErrorRedaction === true\}[\s\S]*check\.id === "wallet-runtime"/,
    "autonomous status must surface compact API cache, body, rate-limit, and redaction proof fields",
  );
  assert.match(
    autonomousStatusSource,
    /function summarizeWalletRuntimeLogic\(output\)[\s\S]*depositsRecoveryGlobalBound=\$\{parsed\.depositsRecoveryGlobalBound === true\}[\s\S]*check\.id === "wallet-runtime"/,
    "autonomous status must surface deposits recovery global-bound proof",
  );
  assert.match(
    autonomousStatusSource,
    /function summarizeWalletRuntimeLogic\(output\)[\s\S]*browserBaselineCompactPerformance=\$\{parsed\.browserBaselineCompactPerformance === true\}[\s\S]*check\.id === "wallet-runtime"/,
    "autonomous status must surface compact browser performance baseline proof fields",
  );
  assert.match(
    autonomousStatusSource,
    /function summarizeWalletRuntimeLogic\(output\)[\s\S]*authBoundaryProof=\$\{parsed\.authBoundaryProof === true\}[\s\S]*authTrustedOriginFailClosed=\$\{parsed\.authTrustedOriginFailClosed === true\}[\s\S]*authReplayNonceBoundary=\$\{parsed\.authReplayNonceBoundary === true\}[\s\S]*authCanonicalNonceBoundary=\$\{parsed\.authCanonicalNonceBoundary === true\}[\s\S]*authSessionCookieBoundary=\$\{parsed\.authSessionCookieBoundary === true\}[\s\S]*check\.id === "wallet-runtime"/,
    "autonomous status must surface compact auth origin, replay, nonce, and session proof fields",
  );
  assert.match(
    autonomousStatusSource,
    /function summarizeWalletRuntimeLogic\(output\)[\s\S]*replicaRateLimitBoundaryProof=\$\{parsed\.replicaRateLimitBoundaryProof === true\}[\s\S]*sharedRateLimitRetryAfterBound=\$\{parsed\.sharedRateLimitRetryAfterBound === true\}[\s\S]*externalRateLimitPublicEndpoint=\$\{parsed\.externalRateLimitPublicEndpoint === true\}[\s\S]*externalRateLimitResponseBound=\$\{parsed\.externalRateLimitResponseBound === true\}[\s\S]*externalSharedLockCanonical=\$\{parsed\.externalSharedLockCanonical === true\}[\s\S]*replicaRateLimitStrictConfig=\$\{parsed\.replicaRateLimitStrictConfig === true\}[\s\S]*check\.id === "wallet-runtime"/,
    "autonomous status must surface compact replica rate-limit boundary proof fields",
  );
  const businessLogicSummaryApiSource = readFileSync("scripts/run-business-logic-summary.mjs", "utf8");
  assert.match(
    businessLogicSummaryApiSource,
    /jsonNoStoreRoutes = hasSourceGuard[\s\S]*sessionVaryCookie = hasSourceGuard[\s\S]*boundedJsonRoutes = hasSourceGuard[\s\S]*rateLimitNoStore = hasSourceGuard[\s\S]*routeErrorRedaction = hasSourceGuard[\s\S]*depositsRecoveryGlobalBound = hasSourceGuard[\s\S]*browserBaselineCompactPerformance = hasSourceGuard[\s\S]*authTrustedOriginFailClosed = hasSourceGuard[\s\S]*authReplayNonceBoundary = hasSourceGuard[\s\S]*authCanonicalNonceBoundary = hasSourceGuard[\s\S]*authSessionCookieBoundary = hasSourceGuard[\s\S]*authBoundaryProof =[\s\S]*sharedRateLimitRetryAfterBound = hasSourceGuard[\s\S]*externalRateLimitPublicEndpoint = hasSourceGuard[\s\S]*externalRateLimitResponseBound = hasSourceGuard[\s\S]*externalSharedLockCanonical = hasSourceGuard[\s\S]*replicaRateLimitStrictConfig = hasSourceGuard[\s\S]*replicaRateLimitBoundaryProof =[\s\S]*miningPendingRecoveryScoped = hasSourceGuard[\s\S]*miningReceiptRevertExplicit = hasSourceGuard[\s\S]*walletHashlessNonceRecovery = hasSourceGuard[\s\S]*manualMinePendingAmbiguousSafe = hasSourceGuard[\s\S]*approvalDuplicateSendSafe = hasSourceGuard[\s\S]*autoMinerNonceRecoverySafe = hasSourceGuard[\s\S]*autoMinerRpcReconnectSafe = hasSourceGuard[\s\S]*walletTxStateMachineProof =[\s\S]*rewardClaimStateSafe =[\s\S]*safetyPoolClaimStateSafe =[\s\S]*resolverClaimStateSafe =[\s\S]*walletClaimStateMachineProof =[\s\S]*apiBoundaryProof =[\s\S]*localProof =[\s\S]*JSON\.stringify\(\{[\s\S]*businessLogic[\s\S]*localProof[\s\S]*apiBoundaryProof[\s\S]*walletTxStateMachineProof[\s\S]*walletClaimStateMachineProof[\s\S]*jsonNoStoreRoutes[\s\S]*sessionVaryCookie[\s\S]*boundedJsonRoutes[\s\S]*rateLimitNoStore[\s\S]*routeErrorRedaction[\s\S]*depositsRecoveryGlobalBound[\s\S]*browserBaselineCompactPerformance[\s\S]*authTrustedOriginFailClosed[\s\S]*authReplayNonceBoundary[\s\S]*authCanonicalNonceBoundary[\s\S]*authSessionCookieBoundary[\s\S]*authBoundaryProof[\s\S]*sharedRateLimitRetryAfterBound[\s\S]*externalRateLimitPublicEndpoint[\s\S]*externalRateLimitResponseBound[\s\S]*externalSharedLockCanonical[\s\S]*replicaRateLimitStrictConfig[\s\S]*replicaRateLimitBoundaryProof[\s\S]*miningPendingRecoveryScoped[\s\S]*miningReceiptRevertExplicit[\s\S]*walletHashlessNonceRecovery[\s\S]*manualMinePendingAmbiguousSafe[\s\S]*approvalDuplicateSendSafe[\s\S]*autoMinerNonceRecoverySafe[\s\S]*autoMinerRpcReconnectSafe[\s\S]*rewardClaimStateSafe[\s\S]*safetyPoolClaimStateSafe[\s\S]*resolverClaimStateSafe/,
    "business logic summary must expose compact API boundary proof fields",
  );
  assert.match(
    readFileSync("scripts/report-prelaunch-status.mjs", "utf8"),
    /"businessLogic" in parsed[\s\S]*localProof=\$\{parsed\.localProof === true\}[\s\S]*apiBoundaryProof=\$\{parsed\.apiBoundaryProof === true\}[\s\S]*walletTxStateMachineProof=\$\{parsed\.walletTxStateMachineProof === true\}[\s\S]*walletClaimStateMachineProof=\$\{parsed\.walletClaimStateMachineProof === true\}[\s\S]*authBoundaryProof=\$\{parsed\.authBoundaryProof === true\}[\s\S]*replicaRateLimitBoundaryProof=\$\{parsed\.replicaRateLimitBoundaryProof === true\}[\s\S]*browserBaselineCompactPerformance=\$\{parsed\.browserBaselineCompactPerformance === true\}[\s\S]*jsonNoStoreRoutes=\$\{parsed\.jsonNoStoreRoutes === true\}[\s\S]*sessionVaryCookie=\$\{parsed\.sessionVaryCookie === true\}[\s\S]*boundedJsonRoutes=\$\{parsed\.boundedJsonRoutes === true\}[\s\S]*rateLimitNoStore=\$\{parsed\.rateLimitNoStore === true\}[\s\S]*routeErrorRedaction=\$\{parsed\.routeErrorRedaction === true\}[\s\S]*depositsRecoveryGlobalBound=\$\{parsed\.depositsRecoveryGlobalBound === true\}[\s\S]*miningPendingRecoveryScoped=\$\{parsed\.miningPendingRecoveryScoped === true\}[\s\S]*miningReceiptRevertExplicit=\$\{parsed\.miningReceiptRevertExplicit === true\}[\s\S]*walletHashlessNonceRecovery=\$\{parsed\.walletHashlessNonceRecovery === true\}[\s\S]*manualMinePendingAmbiguousSafe=\$\{parsed\.manualMinePendingAmbiguousSafe === true\}[\s\S]*approvalDuplicateSendSafe=\$\{parsed\.approvalDuplicateSendSafe === true\}[\s\S]*autoMinerNonceRecoverySafe=\$\{parsed\.autoMinerNonceRecoverySafe === true\}[\s\S]*autoMinerRpcReconnectSafe=\$\{parsed\.autoMinerRpcReconnectSafe === true\}[\s\S]*rewardClaimStateSafe=\$\{parsed\.rewardClaimStateSafe === true\}[\s\S]*safetyPoolClaimStateSafe=\$\{parsed\.safetyPoolClaimStateSafe === true\}[\s\S]*resolverClaimStateSafe=\$\{parsed\.resolverClaimStateSafe === true\}[\s\S]*authTrustedOriginFailClosed=\$\{parsed\.authTrustedOriginFailClosed === true\}[\s\S]*authReplayNonceBoundary=\$\{parsed\.authReplayNonceBoundary === true\}[\s\S]*authCanonicalNonceBoundary=\$\{parsed\.authCanonicalNonceBoundary === true\}[\s\S]*authSessionCookieBoundary=\$\{parsed\.authSessionCookieBoundary === true\}[\s\S]*sharedRateLimitRetryAfterBound=\$\{parsed\.sharedRateLimitRetryAfterBound === true\}[\s\S]*externalRateLimitPublicEndpoint=\$\{parsed\.externalRateLimitPublicEndpoint === true\}[\s\S]*externalRateLimitResponseBound=\$\{parsed\.externalRateLimitResponseBound === true\}[\s\S]*externalSharedLockCanonical=\$\{parsed\.externalSharedLockCanonical === true\}[\s\S]*replicaRateLimitStrictConfig=\$\{parsed\.replicaRateLimitStrictConfig === true\}/,
    "prelaunch summary must surface API boundary proof fields from test:logic:summary",
  );
  assert.match(
    autonomousStatusSource,
    /function summarizeV10Invariants\(output\)[\s\S]*guarded=\$\{integerField\(parsed\.guardedLocalMutationEntrypoints\)\}[\s\S]*accountingCases=\$\{integerField\(parsed\.fullRangeAccountingCases\)\}[\s\S]*proportionalCases=\$\{integerField\(parsed\.fullRangeProportionalCases\)\}[\s\S]*assertionFailures=\$\{integerField\(parsed\.assertionFailures\)\}[\s\S]*protocolFeeFlushCases=\$\{integerField\(parsed\.protocolFeeFlushModelCases\)\}[\s\S]*packedBoundaryCases=\$\{integerField\(parsed\.packedBoundaryCases\)\}[\s\S]*check\.id === "v10-invariants"/,
    "autonomous status must summarize compact V10 invariant counters without raw invariant output",
  );
  assert.match(
    autonomousStatusSource,
    /function summarizeAbiIndexerStorage\(output\)[\s\S]*financialEventCategories=\$\{safeStatusTokenList\(parsed\.financialEventCategories\)\}[\s\S]*depositScopeIsolation=\$\{parsed\.depositScopeIsolation === true\}[\s\S]*idempotentDepositUpsert=\$\{parsed\.idempotentDepositUpsert === true\}[\s\S]*resolverRewardScopeIsolation=\$\{parsed\.resolverRewardScopeIsolation === true\}[\s\S]*idempotentResolverRewardUpsert=\$\{parsed\.idempotentResolverRewardUpsert === true\}[\s\S]*dustSettlementScopeIsolation=\$\{parsed\.dustSettlementScopeIsolation === true\}[\s\S]*idempotentDustSettlementUpsert=\$\{parsed\.idempotentDustSettlementUpsert === true\}[\s\S]*singleRebateClaimParity=\$\{parsed\.singleRebateClaimParity === true\}[\s\S]*epochScopeIsolation=\$\{parsed\.epochScopeIsolation === true\}[\s\S]*idempotentEpochUpsert=\$\{parsed\.idempotentEpochUpsert === true\}[\s\S]*jackpotScopeIsolation=\$\{parsed\.jackpotScopeIsolation === true\}[\s\S]*idempotentJackpotUpsert=\$\{parsed\.idempotentJackpotUpsert === true\}[\s\S]*rewardClaimScopeIsolation=\$\{parsed\.rewardClaimScopeIsolation === true\}[\s\S]*idempotentRewardClaimUpsert=\$\{parsed\.idempotentRewardClaimUpsert === true\}[\s\S]*batchClaimKindParity=\$\{parsed\.batchClaimKindParity === true\}[\s\S]*dustSettlementKindParity=\$\{parsed\.dustSettlementKindParity === true\}[\s\S]*sameBlockEventOrdering=\$\{parsed\.sameBlockEventOrdering === true\}[\s\S]*normalizedEventIdRequiresTxLog=\$\{parsed\.normalizedEventIdRequiresTxLog === true\}[\s\S]*partialRpcLogFallback=\$\{parsed\.partialRpcLogFallback === true\}[\s\S]*malformedPayloadFallback=\$\{parsed\.malformedPayloadFallback === true\}[\s\S]*boundedEventStorage=\$\{parsed\.boundedEventStorage === true\}[\s\S]*limitedEventReads=\$\{parsed\.limitedEventReads === true\}[\s\S]*chainScopeIsolation=\$\{parsed\.chainScopeIsolation === true\}[\s\S]*normalizedEventScopeIsolation=\$\{parsed\.normalizedEventScopeIsolation === true\}[\s\S]*protocolFeeScopeIsolation=\$\{parsed\.protocolFeeScopeIsolation === true\}[\s\S]*idempotentProtocolFeeUpsert=\$\{parsed\.idempotentProtocolFeeUpsert === true\}[\s\S]*check\.id === "abi-indexer-storage"/,
    "autonomous status must summarize compact ABI/indexer storage compatibility without raw indexer output",
  );
  assert.ok(
    autonomousStatusSource.includes("function summarizeManifestSummary(output)") &&
      autonomousStatusSource.includes('manifestToken ? `manifest=${manifestToken}` : ""') &&
      autonomousStatusSource.includes('formatSummaryLine(lineStarting(output, "Summary:"))') &&
      autonomousStatusSource.includes("function summarizeIndexer(output)") &&
      autonomousStatusSource.includes("return summarizeManifestSummary(output)"),
    "autonomous status must summarize indexer proof blockers as structured manifest and summary tokens",
  );
  assert.match(
    autonomousStatusSource,
    /Mode: read-only, no transactions, no deploys, no live soak start/,
    "autonomous status must explicitly stay transaction-free",
  );
  assert.match(
    autonomousStatusSource,
    /maxBuffer: 256 \* 1024/,
    "autonomous status must keep child-process output bounded",
  );
  assert.match(
    autonomousStatusSource,
    /DECIMAL_INTEGER_RE[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*parsePositiveIntegerEnv\("AUTONOMOUS_STATUS_TIMEOUT_MS", 180_000, 1_000, 900_000\)[\s\S]*function parsePositiveIntegerEnv\(name, fallback, min, max\)[\s\S]*const parsed = BigInt\(raw\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*const numeric = Number\(parsed\)[\s\S]*timeout: timeoutMs/,
    "autonomous status timeout env must be canonical decimal and range checked before child process execution",
  );
  assert.doesNotMatch(
    autonomousStatusSource,
    /Number\.parseInt\(process\.env\.AUTONOMOUS_STATUS_TIMEOUT_MS/,
    "autonomous status timeout env must not use partial parseInt coercion",
  );
  assert.match(
    autonomousStatusSource,
    /redactProofText/,
    "autonomous status must redact summarized command output",
  );
  const autonomousDailyStatusSource = readFileSync("scripts/report-autonomous-daily-status.mjs", "utf8");
  assert.match(
    autonomousDailyStatusSource,
    /proof:deps:summary[\s\S]*proof:deps:all:summary[\s\S]*proof:wallet-deps:summary[\s\S]*proof:ci-security:summary[\s\S]*baseline:bundle:summary[\s\S]*cleanup:workspace:dry-run:summary/,
    "autonomous daily status must combine the required daily dependency, wallet-dependency, CI security, bundle, and cleanup summary commands",
  );
  assert.match(
    autonomousDailyStatusSource,
    /Mode: read-only, no transactions, no deploys, no cleanup apply/,
    "autonomous daily status must explicitly avoid transactions, deploys, and cleanup apply",
  );
  assert.match(
    autonomousDailyStatusSource,
    /maxBuffer: 256 \* 1024/,
    "autonomous daily status must keep child-process output bounded",
  );
  assert.match(
    autonomousDailyStatusSource,
    /DECIMAL_INTEGER_RE[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*parsePositiveIntegerEnv\("AUTONOMOUS_DAILY_STATUS_TIMEOUT_MS", 120_000, 1_000, 900_000\)[\s\S]*function parsePositiveIntegerEnv\(name, fallback, min, max\)[\s\S]*const parsed = BigInt\(raw\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*const numeric = Number\(parsed\)[\s\S]*timeout: timeoutMs/,
    "autonomous daily status timeout env must be canonical decimal and range checked before child process execution",
  );
  assert.doesNotMatch(
    autonomousDailyStatusSource,
    /Number\.parseInt\(process\.env\.AUTONOMOUS_DAILY_STATUS_TIMEOUT_MS/,
    "autonomous daily status timeout env must not use partial parseInt coercion",
  );
  assert.match(
    autonomousDailyStatusSource,
    /function nonNegativeSafeInteger\(value\)[\s\S]*Number\.isSafeInteger\(value\) && value >= 0[\s\S]*function integerField\(value\)[\s\S]*nonNegativeSafeInteger\(value\) \?\? 0[\s\S]*function summarizeDependencyAudit\(parsed\)[\s\S]*total=\$\{integerField\(parsed\?\.total\)\}[\s\S]*function summarizeBundle\(parsed\)[\s\S]*totalBytes=\$\{integerField\(parsed\?\.totalBytes\)\}[\s\S]*function summarizeCleanup\(parsed\)[\s\S]*matched=\$\{integerField\(parsed\?\.matchedTargets\)\}/,
    "autonomous daily status summary must require safe non-negative integer counters for dependency, bundle, and cleanup proof rows",
  );
  assert.doesNotMatch(
    autonomousDailyStatusSource,
    /function numberField\(value\)[\s\S]*Number\.isFinite\(value\)|summarize(?:DependencyAudit|Bundle|CiSecurity|Cleanup)\(parsed\)[\s\S]*Number\.isFinite/,
    "autonomous daily status summary must not broadly accept fractional proof counters",
  );
  assert.match(
    autonomousDailyStatusSource,
    /redactProofText[\s\S]*extractLastJsonObject[\s\S]*largestBytes[\s\S]*summarizeCiSecurity/,
    "autonomous daily status must redact output, parse compact JSON, summarize CI security, and summarize bundle largest files by size only",
  );
  assert.match(
    autonomousDailyStatusSource,
    /daily autonomous dependency, wallet, CI security, bundle, and cleanup checks completed/,
    "autonomous daily status summary must name CI security as part of the daily gate",
  );
  assert.doesNotMatch(
    autonomousDailyStatusSource,
    /cleanup:workspace:summary|cleanup:workspace"|\bproof:wallet-deps"\b|summary\.targets|transactionSent:\s*true|walletClientCreated:\s*true/,
    "autonomous daily status must not run cleanup apply, raw wallet dependency tree, print target paths, or create transaction-capable boundaries",
  );
  assert.match(
    remainingLaunchProofSource,
    /const compactStatusCheckByGate = new Map\(\[[\s\S]*\["G1", "npm\.cmd run proof:mainnet:strict:compact"\][\s\S]*\["G14", "npm\.cmd run proof:files:summary"\][\s\S]*function buildGateAction\(row\)[\s\S]*statusCheck: compactStatusCheckByGate\.get\(row\.id\) \?\? ""/,
    "remaining launch evidence summary must provide compact status commands separately from verbose proof-producing first checks",
  );
  assert.match(
    readinessChecklistVerifierSource,
    /function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*function localEvidenceFileExists\(evidencePath\)[\s\S]*regularFileStat\(resolved\) !== null[\s\S]*localEvidenceFileExists\(evidencePath\)/,
    "readiness checklist verifier must treat checked local evidence as present only when it is a regular file",
  );
  assert.match(
    readinessChecklistVerifierSource,
    /const MAX_LOCAL_EVIDENCE_PATHS = 64[\s\S]*function localEvidencePathScan\(value\)[\s\S]*pattern\.exec\(text\)[\s\S]*paths\.length >= MAX_LOCAL_EVIDENCE_PATHS[\s\S]*overLimit: true[\s\S]*checked item has too many local evidence references/,
    "readiness checklist verifier must cap checked-line local evidence reference scans and fail closed on oversized references",
  );
  assert.doesNotMatch(
    readinessChecklistVerifierSource,
    /\[\.\.\.String\(value \?\? ""\)\.matchAll/,
    "readiness checklist verifier must not spread matchAll output into an array for local evidence paths",
  );
  assert.match(
    readinessChecklistVerifierSource,
    /Final security scan evidence[\s\S]*fresh Codex Security scan report or sealed scan artifact[\s\S]*no open High\/Medium local findings[\s\S]*proof:security-followup:summary/,
    "readiness checklist verifier must require the final security scan blocker and residual security follow-up boundary",
  );
  assert.match(
    readinessChecklistVerifierSource,
    /function readText\(filePath\)[\s\S]*const stats = regularFileStat\(filePath\)[\s\S]*does not exist or must be a file/,
    "readiness checklist verifier must reject directory checklist paths before reading",
  );
  assert.match(
    readinessChecklistVerifierSource,
    /MAX_READINESS_CHECKLIST_TEXT_BYTES = 1024 \* 1024[\s\S]*function readText\(filePath\)[\s\S]*const stats = regularFileStat\(filePath\)[\s\S]*stats\.size > MAX_READINESS_CHECKLIST_TEXT_BYTES[\s\S]*too large to validate safely[\s\S]*readFileSync\(filePath, "utf8"\)/,
    "readiness checklist verifier must size-gate the checklist before reading it",
  );
  const prelaunchStatusSource = readFileSync("scripts/report-prelaunch-status.mjs", "utf8");
  const compilerAdvisorySource = readFileSync("scripts/check-solidity-compiler-advisories.mjs", "utf8");
  assert.match(
    compilerAdvisorySource,
    /MAX_BUG_DATABASE_BYTES[\s\S]*CONTENT_LENGTH_RE\s*=\s*\/\^\(\?:0\|\[1-9\]\\d\{0,15\}\)\$\/[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseContentLengthHeader[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*async function readBoundedJsonResponse[\s\S]*parseContentLengthHeader\(response\.headers\.get\("content-length"\)\)[\s\S]*new TextDecoder\("utf-8", \{ fatal: true \}\)[\s\S]*reader\.cancel/,
    "compiler advisory fetch must strictly parse Content-Length and bound official bug database response bodies",
  );
  assert.match(
    compilerAdvisorySource,
    /async function runSelfTest\(\)[\s\S]*await assert\.rejects[\s\S]*MAX_BUG_DATABASE_BYTES \+ 1[\s\S]*await assert\.rejects[\s\S]*String\(Number\.MAX_SAFE_INTEGER\)[\s\S]*await assert\.rejects[\s\S]*"1e3"[\s\S]*invalid content-length[\s\S]*BigInt\(Number\.MAX_SAFE_INTEGER\) \+ 1n[\s\S]*invalid content-length[\s\S]*0xff[\s\S]*process\.argv\.includes\("--self-test"\)/,
    "compiler advisory self-test must cover oversized and malformed Content-Length rejection",
  );
  assert.doesNotMatch(
    compilerAdvisorySource,
    /Number\(response\.headers\.get\("content-length"\)\)/,
    "compiler advisory fetch must not broadly coerce response Content-Length",
  );
  assert.match(
    compilerAdvisorySource,
    /async function fetchOfficialBugDatabase\(\)[\s\S]*attempt <= 2[\s\S]*readBoundedJsonResponse\(response\)[\s\S]*throw lastError/,
    "compiler advisory fetch must retry one transient official bug database failure without falling back to stale data",
  );
  assert.match(
    compilerAdvisorySource,
    /const summaryOnly = process\.argv\.includes\("--summary-only"\)[\s\S]*function describeAdvisoryError\(error\)[\s\S]*redactProofText\(message\)[\s\S]*status: "fail"[\s\S]*issue: describeAdvisoryError\(error\)/,
    "compiler advisory summary mode must fail with bounded redacted JSON instead of a raw Node stack",
  );
  assert.doesNotMatch(
    compilerAdvisorySource,
    /response\.json\(\)/,
    "compiler advisory fetch must not use unbounded response.json",
  );
  assert.match(
    prelaunchStatusSource,
    /proof:contract-compile:summary[\s\S]*requiredLocal: true[\s\S]*proof:contract-compile:v10:summary[\s\S]*requiredLocal: true[\s\S]*proof:contract-compiler-advisories:v10:summary[\s\S]*requiredLocal: true[\s\S]*bench:contract:v10:compiler-matrix:summary[\s\S]*requiredLocal: true[\s\S]*bench:contract:v10:diagnostics:summary[\s\S]*requiredLocal: true[\s\S]*proof:contract-deployed:v10:offline:summary[\s\S]*requiredLocal: true[\s\S]*proof:contract-deployed:v10:summary[\s\S]*test:contract:summary[\s\S]*requiredLocal: true[\s\S]*test:contract:v10:summary[\s\S]*requiredLocal: true[\s\S]*test:indexer-storage:summary[\s\S]*requiredLocal: true[\s\S]*test:fetch-timeout:summary[\s\S]*requiredLocal: true[\s\S]*test:stored-number-parsing:summary[\s\S]*requiredLocal: true[\s\S]*typecheck:summary[\s\S]*lint:summary[\s\S]*build:summary[\s\S]*baseline:bundle:summary[\s\S]*test:db-operations:summary[\s\S]*test:monitoring:summary[\s\S]*proof:process-model:summary[\s\S]*test:logic:summary[\s\S]*proof:security-followup:summary[\s\S]*requiredLocal: true[\s\S]*proof:deps:summary[\s\S]*proof:deps:all:summary[\s\S]*proof:wallet-deps:summary[\s\S]*cleanup:workspace:dry-run:summary[\s\S]*requiredLocal: true[\s\S]*cleanup:workspace:loop:status[\s\S]*requiredLocal: true[\s\S]*proof:launch-docs:summary[\s\S]*proof:templates:summary[\s\S]*proof:drafts:summary[\s\S]*proof:files:summary[\s\S]*proof:collector-redaction:summary[\s\S]*proof:launch-map:summary[\s\S]*proof:host-guard:summary[\s\S]*proof:gates:structure[\s\S]*proof:readiness:summary[\s\S]*proof:remaining:summary[\s\S]*soak:testnet:status:summary[\s\S]*soak:testnet:clear-pending:summary[\s\S]*preview:canary:v10:dry-run:summary[\s\S]*proof:mainnet:summary[\s\S]*proof:mainnet:strict:summary[\s\S]*proof:chain:summary[\s\S]*proof:chain:strict:summary[\s\S]*proof:signoff:strict:summary[\s\S]*proof:host:strict:summary[\s\S]*proof:indexer:strict:summary[\s\S]*proof:restore:strict:summary[\s\S]*monitor:runtime:summary[\s\S]*proof:monitoring:strict:summary[\s\S]*proof:qa:strict:summary[\s\S]*proof:testnet:canary:summary[\s\S]*proof:testnet:canary:strict:summary[\s\S]*proof:testnet:canary:v10:summary[\s\S]*db:backup:summary[\s\S]*db:backup:strict:summary[\s\S]*proof:launch:strict:summary/,
    "prelaunch status summary must aggregate local V9/V10, security follow-up, indexer, launch, soak, V10 dry-run Preview, canary, and backup status commands",
  );
  assert.match(
    prelaunchStatusSource,
    /preview:canary:v10:dry-run:summary[\s\S]*preview:canary:v10:authorization-ready:summary[\s\S]*authorizationFreshnessRequired[\s\S]*issue[\s\S]*authFresh=\$\{parsed\.authorizationFreshnessRequired === true\}[\s\S]*maxAgeMinutes=\$\{nonNegativeIntegerField\(parsed\.maxPreviewAgeMinutes\)\}/,
    "prelaunch status summary must include the authorization-ready V10 Preview freshness blocker without making it a required local check",
  );
  assert.match(
    prelaunchStatusSource,
    /function summarizeCollectorRedactionLines\(lines\)[\s\S]*status=\(pass\|fail\)[\s\S]*cases=\(\\d\+\)[\s\S]*redacted=\(\\d\+\)[\s\S]*leaked=\(\\d\+\)[\s\S]*issues=\(\\d\+\)[\s\S]*invalid-collector-redaction-summary[\s\S]*status=\$\{status\}, cases=\$\{cases\}, redacted=\$\{redacted\}, leaked=\$\{leaked\}, issues=\$\{issues\}[\s\S]*collectorRedactionSummary = summarizeCollectorRedactionLines\(lines\)[\s\S]*if \(collectorRedactionSummary\) return collectorRedactionSummary/,
    "prelaunch status must summarize proof collector redaction as strict counters before generic Summary fallback",
  );
  assert.match(
    prelaunchStatusSource,
    /function knownIssueToken\(value\)[\s\S]*lore_db_path[\s\S]*lore_backup_dir[\s\S]*--source[\s\S]*--out[\s\S]*backup-paths-or-source-output-required[\s\S]*strict chain proof requires configured rpc env[\s\S]*built-in fallback[\s\S]*strict-chain-proof-requires-configured-rpc-env[\s\S]*function formatIssueToken\(value\)[\s\S]*const known = knownIssueToken\(value\)[\s\S]*if \(known\) return `, issue=\$\{known\}`/,
    "prelaunch status must keep known backup and chain blockers as stable compact issue tokens instead of truncating them",
  );
  assert.ok(
    prelaunchStatusSource.indexOf('console.log("# Prelaunch Status Summary");') <
      prelaunchStatusSource.indexOf("for (const check of checks)") &&
      prelaunchStatusSource.includes('console.log(`| ${row.join(" | ")} |`);'),
    "prelaunch status summary must stream table rows as checks finish instead of staying silent until the end",
  );
  assert.match(
    prelaunchStatusSource,
    /DECIMAL_INTEGER_RE[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*parsePositiveIntegerEnv\("PRELAUNCH_CHECK_TIMEOUT_MS", 300_000, 1_000, 1_800_000\)[\s\S]*function parsePositiveIntegerEnv\(name, fallback, min, max\)[\s\S]*const parsed = BigInt\(raw\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*const numeric = Number\(parsed\)[\s\S]*timeout: checkTimeoutMs/,
    "prelaunch status timeout env must be canonical decimal and range checked before child process execution",
  );
  assert.doesNotMatch(
    prelaunchStatusSource,
    /Number\.parseInt\(process\.env\.PRELAUNCH_CHECK_TIMEOUT_MS/,
    "prelaunch status timeout env must not use partial parseInt coercion",
  );
  const prelaunchPackageScripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
  const eslintSummarySource = readFileSync("scripts/run-eslint-summary.mjs", "utf8");
  const typecheckSummarySource = readFileSync("scripts/run-typecheck-summary.mjs", "utf8");
  const buildSummarySource = readFileSync("scripts/run-build-summary.mjs", "utf8");
  const contractV9SummarySource = readFileSync("scripts/run-contract-v9-summary.mjs", "utf8");
  const contractV10SummarySource = readFileSync("scripts/run-contract-v10-summary.mjs", "utf8");
  const contractV10InvariantSource = readFileSync("scripts/test-contract-v10-invariants.mjs", "utf8");
  const v10OfflineIdentitySummarySource = readFileSync("scripts/run-v10-offline-identity-summary.mjs", "utf8");
  const v10DeployedSummarySource = readFileSync("scripts/run-v10-deployed-summary.mjs", "utf8");
  const v10DeployedVerifierSource = readFileSync("scripts/verify-v10-deployed.ts", "utf8");
  const businessLogicSummarySource = readFileSync("scripts/run-business-logic-summary.mjs", "utf8");
  const indexerStorageSummarySource = readFileSync("scripts/run-indexer-storage-summary.mjs", "utf8");
  const dbOperationsSummarySource = readFileSync("scripts/run-db-operations-summary.mjs", "utf8");
  const monitoringDrillSummarySource = readFileSync("scripts/run-monitoring-drill-summary.mjs", "utf8");
  const fetchTimeoutSummarySource = readFileSync("scripts/run-fetch-timeout-summary.mjs", "utf8");
  const storedNumberParsingSummarySource = readFileSync("scripts/run-stored-number-parsing-summary.mjs", "utf8");
  const summaryTimeoutSource = readFileSync("scripts/summary-timeout.mjs", "utf8");
  const storedNumberParsingSource = readFileSync("app/api/_lib/storedNumberParsing.ts", "utf8");
  assert.match(
    summaryTimeoutSource,
    /DECIMAL_INTEGER_RE\s*=\s*\/\^\(\?:0\|\[1-9\]\\d\{0,15\}\)\$\/[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseSummaryTimeoutEnv\(name, fallback[\s\S]*Number\.isSafeInteger\(fallback\)[\s\S]*const parsed = BigInt\(raw\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*const numeric = Number\(parsed\)/,
    "summary timeout helper must canonicalize decimal env values and reject unsafe fallback or parsed timeouts",
  );
  for (const [label, source, envName] of [
    ["build", buildSummarySource, "BUILD_SUMMARY_TIMEOUT_MS"],
    ["business logic", businessLogicSummarySource, "BUSINESS_LOGIC_SUMMARY_TIMEOUT_MS"],
    ["V9 contract", contractV9SummarySource, "CONTRACT_V9_SUMMARY_TIMEOUT_MS"],
    ["V10 contract", contractV10SummarySource, "CONTRACT_V10_SUMMARY_TIMEOUT_MS"],
    ["DB operations", dbOperationsSummarySource, "DB_OPERATIONS_SUMMARY_TIMEOUT_MS"],
    ["fetch timeout", fetchTimeoutSummarySource, "FETCH_TIMEOUT_SUMMARY_TIMEOUT_MS"],
    ["indexer storage", indexerStorageSummarySource, "INDEXER_STORAGE_SUMMARY_TIMEOUT_MS"],
    ["monitoring drill", monitoringDrillSummarySource, "MONITORING_DRILL_SUMMARY_TIMEOUT_MS"],
    ["stored number parsing", storedNumberParsingSummarySource, "STORED_NUMBER_PARSING_SUMMARY_TIMEOUT_MS"],
    ["typecheck", typecheckSummarySource, "TYPECHECK_SUMMARY_TIMEOUT_MS"],
    ["V10 deployed", v10DeployedSummarySource, "V10_DEPLOYED_SUMMARY_TIMEOUT_MS"],
    ["V10 offline identity", v10OfflineIdentitySummarySource, "V10_OFFLINE_IDENTITY_SUMMARY_TIMEOUT_MS"],
  ]) {
    assert.ok(
      source.includes('import { parseSummaryTimeoutEnv } from "./summary-timeout.mjs";') &&
        source.includes(`parseSummaryTimeoutEnv("${envName}"`) &&
        source.includes("timeout: timeoutMs"),
      `${label} summary wrapper must use the shared strict timeout parser before spawning child commands`,
    );
    assert.doesNotMatch(
      source,
      new RegExp(`Number\\.parseInt\\(process\\.env\\.${envName}`),
      `${label} summary wrapper timeout env must not use partial parseInt coercion`,
    );
    assert.doesNotMatch(
      source,
      /Number\.isFinite\(timeoutMs\)/,
      `${label} summary wrapper timeout must not fallback after broad numeric coercion`,
    );
  }
  assert.match(
    contractV9SummarySource,
    /"--silent", "run", "test:contract"[\s\S]*CONTRACT_V9_SUMMARY_TIMEOUT_MS[\s\S]*maxBuffer: 1024 \* 1024[\s\S]*redactProofText/,
    "V9 contract summary wrapper must run the same invariant suite with bounded redacted output",
  );
  assert.match(
    contractV9SummarySource,
    /Contract V9 invariant checks passed[\s\S]*invariantSuite[\s\S]*assertionFailures/,
    "V9 contract summary wrapper must emit compact invariant status and assertion failure counts",
  );
  assert.match(
    contractV9SummarySource,
    /MAX_ASSERTION_FAILURE_COUNT = 9999[\s\S]*function countAssertionFailures\(text\)[\s\S]*pattern\.exec\(text\)[\s\S]*MAX_ASSERTION_FAILURE_COUNT[\s\S]*assertionFailures = countAssertionFailures\(output\)/,
    "V9 contract summary wrapper must count assertion failures without materializing match arrays",
  );
  assert.doesNotMatch(
    contractV9SummarySource,
    /\[\.\.\.output\.matchAll/,
    "V9 contract summary wrapper must not spread matchAll output into an array",
  );
  assert.equal(
    prelaunchPackageScripts?.["test:contract:summary"],
    "node scripts/run-contract-v9-summary.mjs",
    "V9 contract invariants must expose a compact summary alias for aggregate prelaunch checks",
  );
  assert.match(
    contractV10SummarySource,
    /"--silent", "run", "test:contract:v10"[\s\S]*CONTRACT_V10_SUMMARY_TIMEOUT_MS[\s\S]*maxBuffer: 2 \* 1024 \* 1024[\s\S]*redactProofText/,
    "V10 contract summary wrapper must run the same invariant suite with bounded redacted output",
  );
  assert.match(
    contractV10SummarySource,
    /extractJsonObject[\s\S]*functionSelectors[\s\S]*guardedLocalMutationEntrypoints[\s\S]*protocolFeeFlushModelCases[\s\S]*duplicateBatchModelCases[\s\S]*dustBoundaryCases[\s\S]*packedBoundaryCases[\s\S]*fullRangeAccountingCases[\s\S]*fullRangeProportionalCases[\s\S]*assertionFailures/,
    "V10 contract summary wrapper must emit compact invariant counters without the full pretty JSON report",
  );
  assert.match(
    contractV10SummarySource,
    /function nonNegativeInteger\(value\)[\s\S]*Number\.isSafeInteger\(value\) && value >= 0[\s\S]*runtimeBytes: nonNegativeInteger\(parsed\?\.runtimeBytes\)[\s\S]*guardedLocalMutationEntrypoints: nonNegativeInteger\(parsed\?\.guardedLocalMutationEntrypoints\)[\s\S]*duplicateBatchModelCases: nonNegativeInteger\(parsed\?\.duplicateBatchModelCases\)[\s\S]*fullRangeAccountingCases: nonNegativeInteger\(parsed\?\.fullRangeAccountingCases\)[\s\S]*fullRangeProportionalCases: nonNegativeInteger\(parsed\?\.fullRangeProportionalCases\)/,
    "V10 contract summary wrapper must reject negative or malformed invariant counters before emitting proof evidence",
  );
  assert.match(
    contractV10SummarySource,
    /MAX_ASSERTION_FAILURE_COUNT = 9999[\s\S]*function countAssertionFailures\(text\)[\s\S]*pattern\.exec\(text\)[\s\S]*MAX_ASSERTION_FAILURE_COUNT[\s\S]*assertionFailures = countAssertionFailures\(output\)/,
    "V10 contract summary wrapper must count assertion failures without materializing match arrays",
  );
  assert.doesNotMatch(
    contractV10SummarySource,
    /\[\.\.\.output\.matchAll/,
    "V10 contract summary wrapper must not spread matchAll output into an array",
  );
  assert.doesNotMatch(
    contractV10SummarySource,
    /Number\.isSafeInteger\(parsed\?\.[a-zA-Z0-9_]+\) \? parsed\.[a-zA-Z0-9_]+ : 0/,
    "V10 contract summary wrapper must not accept negative safe integers as proof counters",
  );
  assert.match(
    contractV10InvariantSource,
    /reward all-nonpayable duplicate entries revert without closing epochs[\s\S]*rebate all-nonpayable duplicate entries revert without closing epochs[\s\S]*rebate dust all-closed duplicate entries revert without events/,
    "V10 duplicate/replay model coverage must keep all-nonpayable claim batches and all-closed rebate dust batches fail-closed",
  );
  assert.match(
    contractV10InvariantSource,
    /reward all-nonpayable duplicate entries[\s\S]*expected: \{ reverted: true, total: 0n, count: 0, events: 0, claimedSize: 0 \}[\s\S]*rebate all-nonpayable duplicate entries[\s\S]*expected: \{ reverted: true, total: 0n, count: 0, events: 0, claimedSize: 0 \}[\s\S]*rebate dust all-closed duplicate entries[\s\S]*expected: \{ reverted: true, totalDust: 0n, epochsSettled: 0, events: 0 \}/,
    "V10 fail-closed batch regressions must not transfer, close payable entries, or emit events for nonpayable/all-closed inputs",
  );
  assert.equal(
    prelaunchPackageScripts?.["test:contract:v10:summary"],
    "node scripts/run-contract-v10-summary.mjs",
    "V10 contract invariants must expose a compact summary alias for aggregate prelaunch checks",
  );
  assert.match(
    indexerStorageSummarySource,
    /depositScopeIsolation:\s*parsed\?\.depositScopeIsolation === true[\s\S]*epochScopeIsolation:\s*parsed\?\.epochScopeIsolation === true[\s\S]*jackpotScopeIsolation:\s*parsed\?\.jackpotScopeIsolation === true[\s\S]*resolverRewardScopeIsolation:\s*parsed\?\.resolverRewardScopeIsolation === true[\s\S]*dustSettlementScopeIsolation:\s*parsed\?\.dustSettlementScopeIsolation === true[\s\S]*rewardClaimScopeIsolation:\s*parsed\?\.rewardClaimScopeIsolation === true[\s\S]*idempotentDepositUpsert:\s*parsed\?\.idempotentDepositUpsert === true[\s\S]*idempotentEpochUpsert:\s*parsed\?\.idempotentEpochUpsert === true[\s\S]*idempotentJackpotUpsert:\s*parsed\?\.idempotentJackpotUpsert === true[\s\S]*idempotentResolverRewardUpsert:\s*parsed\?\.idempotentResolverRewardUpsert === true[\s\S]*idempotentDustSettlementUpsert:\s*parsed\?\.idempotentDustSettlementUpsert === true[\s\S]*idempotentRewardClaimUpsert:\s*parsed\?\.idempotentRewardClaimUpsert === true[\s\S]*batchClaimKindParity:\s*parsed\?\.batchClaimKindParity === true[\s\S]*singleRebateClaimParity:\s*parsed\?\.singleRebateClaimParity === true[\s\S]*dustSettlementKindParity:\s*parsed\?\.dustSettlementKindParity === true/,
    "indexer storage summary must expose deposit, epoch, jackpot, resolver reward, dust settlement, and reward-claim scope/idempotency evidence plus reward/rebate parity",
  );
  assert.match(
    readFileSync("scripts/test-indexer-event-storage.ts", "utf8"),
    /eventName: "RewardBatchClaimed"[\s\S]*eventName: "RebateBatchClaimed"[\s\S]*eventName: "RebateClaimed"[\s\S]*eventName: "RewardDustSettled"[\s\S]*eventName: "RebateDustSettled"[\s\S]*single rebate claims must remain distinguishable from batch claims[\s\S]*batchClaimKindParity: true[\s\S]*singleRebateClaimParity: true[\s\S]*dustSettlementKindParity: true/,
    "indexer storage regression must preserve reward/rebate payload kind parity for batch, single rebate, and dust events",
  );
  assert.match(
    readFileSync("scripts/test-indexer-event-storage.ts", "utf8"),
    /"partial-rpc-log"[\s\S]*blockNumber: "latest"[\s\S]*partial RPC logs with non-canonical block numbers must not enter normalized storage[\s\S]*partialRpcLogFallback: true/,
    "indexer storage regression must keep partial RPC logs out of normalized financial event reads",
  );
  assert.match(
    readFileSync("server/storage.ts", "utf8"),
    /MAX_INDEXER_EVENT_ID_LENGTH = 160[\s\S]*MAX_INDEXER_EVENT_PAYLOAD_BYTES = 16 \* 1024[\s\S]*function stringifyBoundedIndexerEventPayload\(payload: JsonMap\)[\s\S]*Buffer\.byteLength\(payloadJson, "utf8"\)[\s\S]*payloadJson === null[\s\S]*statement\.run\(CURRENT_STORAGE_SCOPE, category, id, payloadJson, blockNumber\)/,
    "normalized indexer event storage must reject oversized ids and oversized or unserializable payloads before SQLite writes",
  );
  assert.match(
    readFileSync("server/storage.ts", "utf8"),
    /ON CONFLICT\(scope, category, id\) DO UPDATE SET[\s\S]*payload_json = excluded\.payload_json,[\s\S]*block_number = excluded\.block_number[\s\S]*WHERE excluded\.block_number >= .*\.block_number/,
    "normalized indexer event replays must not let older blocks overwrite newer indexed payloads",
  );
  assert.match(
    readFileSync("scripts/test-indexer-event-storage.ts", "utf8"),
    /staleReplay: true[\s\S]*stale replay of the same event id must not downgrade block metadata[\s\S]*staleEventReplayIgnored: true/,
    "indexer storage regression must prove stale event replays cannot downgrade normalized event rows",
  );
  assert.match(
    readFileSync("scripts/run-indexer-storage-summary.mjs", "utf8"),
    /staleEventReplayIgnored: parsed\?\.staleEventReplayIgnored === true/,
    "indexer storage summary must surface stale event replay protection",
  );
  assert.match(
    readFileSync("server/storage.ts", "utf8"),
    /ON CONFLICT\(scope, epoch\) DO UPDATE SET[\s\S]*resolved_block = COALESCE\(excluded\.resolved_block, \$\{SCOPED_EPOCHS_TABLE\}\.resolved_block\)[\s\S]*WHERE \$\{SCOPED_EPOCHS_TABLE\}\.resolved_block IS NULL[\s\S]*excluded\.resolved_block IS NOT NULL AND excluded\.resolved_block >= \$\{SCOPED_EPOCHS_TABLE\}\.resolved_block/,
    "resolved epoch replays must not let older or unresolved rows overwrite newer resolved epoch rows",
  );
  assert.match(
    readFileSync("scripts/test-indexer-event-storage.ts", "utf8"),
    /stale replay of the same resolved epoch must not downgrade resolved block metadata[\s\S]*stale replay of the same resolved epoch must not downgrade winning tile metadata[\s\S]*unresolved replay after resolution must not overwrite weekly jackpot metadata[\s\S]*staleEpochReplayIgnored: true/,
    "indexer storage regression must prove stale epoch replays cannot downgrade resolved epoch rows",
  );
  assert.match(
    readFileSync("scripts/run-indexer-storage-summary.mjs", "utf8"),
    /staleEpochReplayIgnored: parsed\?\.staleEpochReplayIgnored === true/,
    "indexer storage summary must surface stale epoch replay protection",
  );
  assert.match(
    readFileSync("server/storage.ts", "utf8"),
    /ON CONFLICT\(scope, id\) DO UPDATE SET[\s\S]*WHERE excluded\.block_number >= \$\{SCOPED_BETS_TABLE\}\.block_number[\s\S]*ON CONFLICT\(scope, id\) DO UPDATE SET[\s\S]*WHERE excluded\.block_number >= \$\{SCOPED_JACKPOTS_TABLE\}\.block_number[\s\S]*ON CONFLICT\(scope, id\) DO UPDATE SET[\s\S]*WHERE excluded\.block_number >= \$\{SCOPED_REWARD_CLAIMS_TABLE\}\.block_number[\s\S]*ON CONFLICT\(scope, id\) DO UPDATE SET[\s\S]*WHERE excluded\.block_number >= \$\{SCOPED_PROTOCOL_FEE_FLUSHES_TABLE\}\.block_number/,
    "financial storage replays must not let older blocks overwrite newer scoped rows",
  );
  assert.match(
    readFileSync("scripts/test-indexer-event-storage.ts", "utf8"),
    /stale replay of the same bet event id must not downgrade block metadata[\s\S]*stale replay of the same jackpot id must not downgrade block metadata[\s\S]*stale replay of the same reward claim id must not downgrade block metadata[\s\S]*stale replay of the same protocol fee flush id must not downgrade block metadata[\s\S]*staleFinancialReplayIgnored: true/,
    "indexer storage regression must prove stale financial replays cannot downgrade scoped financial rows",
  );
  assert.match(
    readFileSync("scripts/run-indexer-storage-summary.mjs", "utf8"),
    /staleFinancialReplayIgnored: parsed\?\.staleFinancialReplayIgnored === true/,
    "indexer storage summary must surface stale financial replay protection",
  );
  assert.match(
    readFileSync("server/storage.ts", "utf8"),
    /function normalizeOptionalIndexerEventLimit\(value: number \| null \| undefined\)[\s\S]*Math\.min\(value, 5_000\)[\s\S]*function getIndexerEventMap\(category: IndexerEventCategory, limitToLast\?: number\)[\s\S]*ORDER BY block_number DESC, id DESC[\s\S]*LIMIT \?[\s\S]*\.reverse\(\)[\s\S]*getIndexerEventMap\(indexerEventCategory, limitToLast\)/,
    "normalized indexer event reads must support bounded last-N reads without changing the default full-read path",
  );
  assert.match(
    readFileSync("scripts/test-indexer-event-storage.ts", "utf8"),
    /oversizedEventId = "x"\.repeat\(161\)[\s\S]*circularEventPayload\.self = circularEventPayload[\s\S]*"oversized-payload"[\s\S]*length\(id\) > 160[\s\S]*boundedEventStorage: true/,
    "indexer storage regression must prove bounded normalized event storage rejects oversized and unserializable payloads",
  );
  assert.match(
    readFileSync("scripts/test-indexer-event-storage.ts", "utf8"),
    /readJsonPath<Record<string, unknown>>\("gamedata\/batchClaims", 2\)[\s\S]*limited normalized event reads must not load older normalized rows[\s\S]*limitedEventReads: true/,
    "indexer storage regression must prove normalized event read limits keep recent rows without hiding legacy metadata",
  );
  assert.match(
    readFileSync("scripts/test-indexer-event-storage.ts", "utf8"),
    /re-indexing the same resolver reward id must update block metadata[\s\S]*re-indexing the same dust settlement id must update block metadata[\s\S]*resolver reward reads must ignore foreign contract scopes[\s\S]*resolver reward reads must ignore foreign chain scopes[\s\S]*dust settlement reads must ignore foreign contract scopes[\s\S]*dust settlement reads must ignore foreign chain scopes[\s\S]*resolverRewardScopeIsolation: true[\s\S]*dustSettlementScopeIsolation: true[\s\S]*idempotentResolverRewardUpsert: true[\s\S]*idempotentDustSettlementUpsert: true/,
    "indexer storage regression must prove resolver reward and dust settlement replay plus chain/contract scope isolation",
  );
  assert.match(
    readFileSync("scripts/test-indexer-event-storage.ts", "utf8"),
    /upsertRewardClaims\(\[[\s\S]*claim-current[\s\S]*reward claim replay must update block metadata[\s\S]*scoped_reward_claims[\s\S]*claim-foreign-contract[\s\S]*claim-foreign-chain[\s\S]*recent reward claim reads must ignore foreign contract and chain scopes[\s\S]*rewardClaimScopeIsolation: true[\s\S]*idempotentRewardClaimUpsert: true/,
    "indexer storage regression must prove reward claim replay and chain/contract scope isolation",
  );
  assert.match(
    readFileSync("scripts/test-indexer-event-storage.ts", "utf8"),
    /upsertBets\(\[[\s\S]*betTxHash02\.toUpperCase\(\)[\s\S]*re-indexing the same bet event id must update block metadata[\s\S]*foreign-contract-bet[\s\S]*foreign-chain-bet[\s\S]*getUserBetsMap\(user\)[\s\S]*deposit reads must ignore foreign contract and chain bet scopes[\s\S]*depositScopeIsolation: true[\s\S]*idempotentDepositUpsert: true/,
    "indexer storage regression must prove deposit replay and chain/contract scope isolation",
  );
  assert.match(
    readFileSync("scripts/test-indexer-event-storage.ts", "utf8"),
    /upsertEpochMap\(\{[\s\S]*"42"[\s\S]*resolved epoch replay must update block metadata[\s\S]*scoped_epochs[\s\S]*25[\s\S]*24[\s\S]*epoch reads must ignore foreign contract and chain scopes[\s\S]*epochScopeIsolation: true[\s\S]*idempotentEpochUpsert: true/,
    "indexer storage regression must prove epoch replay and chain/contract scope isolation",
  );
  assert.match(
    readFileSync("scripts/test-indexer-event-storage.ts", "utf8"),
    /upsertJackpots\(\[[\s\S]*daily_21[\s\S]*jackpot replay must update block metadata[\s\S]*scoped_jackpots[\s\S]*0xforeignjackpot[\s\S]*0xforeignchainjackpot[\s\S]*jackpot map reads must ignore foreign contract and chain scopes[\s\S]*jackpotScopeIsolation: true[\s\S]*idempotentJackpotUpsert: true/,
    "indexer storage regression must prove jackpot replay and chain/contract scope isolation",
  );
  assert.ok(
    v10OfflineIdentitySummarySource.includes("V10_OFFLINE_IDENTITY_SUMMARY_TIMEOUT_MS") &&
      v10OfflineIdentitySummarySource.includes('["run", "proof:contract-compile:v10:summary"]') &&
      v10OfflineIdentitySummarySource.includes('["exec", "--", "tsx", "scripts/verify-v10-deployed.ts", "--offline"]') &&
      v10OfflineIdentitySummarySource.includes("redactProofText"),
    "V10 offline identity summary wrapper must run compact compile proof and the same offline verifier",
  );
  assert.match(
    v10OfflineIdentitySummarySource,
    /v10OfflineIdentity[\s\S]*manifestMatches[\s\S]*runtimeBytes[\s\S]*transactionSent[\s\S]*assertionFailures/,
    "V10 offline identity summary wrapper must emit compact manifest, runtime, transaction, and assertion counters",
  );
  assert.match(
    v10OfflineIdentitySummarySource,
    /MAX_ASSERTION_FAILURE_COUNT = 9999[\s\S]*function countAssertionFailures\(text\)[\s\S]*pattern\.exec\(text\)[\s\S]*MAX_ASSERTION_FAILURE_COUNT[\s\S]*assertionFailures = countAssertionFailures\(output\)/,
    "V10 offline identity summary wrapper must count assertion failures without materializing match arrays",
  );
  assert.match(
    v10OfflineIdentitySummarySource,
    /function nonNegativeInteger\(value\)[\s\S]*Number\.isSafeInteger\(value\) && value >= 0[\s\S]*runtimeBytes: nonNegativeInteger\(verifierParsed\?\.runtimeBytes\)[\s\S]*immutableReferences: nonNegativeInteger\(verifierParsed\?\.immutableReferences\)/,
    "V10 offline identity summary wrapper must reject negative runtime and immutable-reference counters",
  );
  assert.doesNotMatch(
    v10OfflineIdentitySummarySource,
    /\[\.\.\.output\.matchAll/,
    "V10 offline identity summary wrapper must not spread matchAll output into an array",
  );
  assert.equal(
    prelaunchPackageScripts?.["proof:contract-deployed:v10:offline:summary"],
    "node scripts/run-v10-offline-identity-summary.mjs",
    "V10 offline identity must expose a compact summary alias for aggregate prelaunch checks",
  );
  assert.equal(
    prelaunchPackageScripts?.["proof:contract-deployed:v10:summary"],
    "node scripts/run-v10-deployed-summary.mjs",
    "V10 deployed identity must expose a compact read-only summary alias",
  );
  assert.match(
    v10DeployedVerifierSource,
    /MAX_V10_SOURCE_UNIT_BYTES = 2 \* 1024 \* 1024;[\s\S]*MAX_V10_COMPILER_CONFIG_BYTES = 512 \* 1024;[\s\S]*MAX_V10_COMPILATION_MANIFEST_BYTES = 512 \* 1024;[\s\S]*function readBoundedUtf8File\(filePath: string, maxBytes: number, label: string\)[\s\S]*const stats = fs\.statSync\(filePath\)[\s\S]*!stats\.isFile\(\)[\s\S]*stats\.size > maxBytes[\s\S]*too large to validate safely[\s\S]*fs\.readFileSync\(filePath, "utf8"\)/,
    "V10 deployed verifier must size-gate local source, config, and manifest inputs before reading",
  );
  assert.match(
    v10DeployedVerifierSource,
    /function readSourceUnit\(sourceUnit: string\)[\s\S]*path\.resolve\(sourceUnit\)[\s\S]*path\.resolve\("node_modules", sourceUnit\)[\s\S]*readBoundedUtf8File\(candidate, MAX_V10_SOURCE_UNIT_BYTES[\s\S]*NodeJS\.ErrnoException[\s\S]*code !== "ENOENT"[\s\S]*throw error/,
    "V10 deployed verifier must keep deterministic source-unit lookup while failing closed on non-file or oversized matches",
  );
  assert.match(
    v10DeployedVerifierSource,
    /JSON\.parse\([\s\S]*readBoundedUtf8File\(COMPILER_CONFIG_PATH, MAX_V10_COMPILER_CONFIG_BYTES, "V10 compiler config"[\s\S]*JSON\.parse\([\s\S]*readBoundedUtf8File\(COMPILATION_MANIFEST_PATH, MAX_V10_COMPILATION_MANIFEST_BYTES, "V10 compilation manifest"/,
    "V10 deployed verifier must size-gate compiler config and compilation manifest before JSON parsing",
  );
  assert.match(
    v10DeployedVerifierSource,
    /readBoundedUtf8File\(resolveWorkspacePath\(sourceUnit\), MAX_V10_SOURCE_UNIT_BYTES, `workspace source unit \$\{sourceUnit\}`\)[\s\S]*readBoundedUtf8File\(resolveWorkspacePath\(importPath\), MAX_V10_SOURCE_UNIT_BYTES, `workspace import \$\{importPath\}`\)/,
    "V10 Remix workspace verifier must size-gate generated workspace source reads",
  );
  assert.match(
    v10DeployedSummarySource,
    /V10_DEPLOYED_SUMMARY_TIMEOUT_MS[\s\S]*\["run", "proof:contract-compile:v10:summary"\][\s\S]*\["exec", "--", "tsx", "scripts\/verify-v10-deployed\.ts"\][\s\S]*redactProofText/,
    "V10 deployed summary wrapper must run compact compile proof and the same read-only deployed verifier with redaction",
  );
  assert.match(
    v10DeployedSummarySource,
    /v10DeployedReadOnly[\s\S]*manifestMatches[\s\S]*runtimeBytecode[\s\S]*runtimeExecutable[\s\S]*metadataOnlyMismatch[\s\S]*transactionSent[\s\S]*assertionFailures/,
    "V10 deployed summary wrapper must emit compact runtime identity and transaction-free counters",
  );
  assert.match(
    v10DeployedSummarySource,
    /MAX_ASSERTION_FAILURE_COUNT = 9999[\s\S]*function countAssertionFailures\(text\)[\s\S]*pattern\.exec\(text\)[\s\S]*MAX_ASSERTION_FAILURE_COUNT[\s\S]*assertionFailures = countAssertionFailures\(combinedOutput\)/,
    "V10 deployed summary wrapper must count assertion failures without materializing match arrays",
  );
  assert.match(
    v10DeployedSummarySource,
    /function nonNegativeInteger\(value\)[\s\S]*Number\.isSafeInteger\(value\) && value >= 0[\s\S]*chainId: nonNegativeInteger\(verifierParsed\?\.chainId\)[\s\S]*runtimeBytes: nonNegativeInteger\(verifierParsed\?\.runtimeBytes\)[\s\S]*immutableReferences: nonNegativeInteger\(verifierParsed\?\.immutableReferences\)/,
    "V10 deployed summary wrapper must reject negative chain, runtime, and immutable-reference counters",
  );
  assert.doesNotMatch(
    v10DeployedSummarySource,
    /\[\.\.\.combinedOutput\.matchAll/,
    "V10 deployed summary wrapper must not spread matchAll output into an array",
  );
  const v10DeployedIdentityBoundaryDoc = readFileSync("docs/v10-deployed-identity-boundary.md", "utf8");
  assert.match(
    v10DeployedIdentityBoundaryDoc,
    /npm\.cmd run proof:contract-deployed:v10:summary[\s\S]*runtimeBytecode: false[\s\S]*runtimeExecutable: true[\s\S]*metadataOnlyMismatch: true[\s\S]*transactionSent: false/,
    "V10 deployed identity boundary doc must preserve the current read-only metadata mismatch facts",
  );
  assert.match(
    v10DeployedIdentityBoundaryDoc,
    /npm\.cmd run proof:contract-deployed:v10:offline:summary[\s\S]*status: pass[\s\S]*manifestMatches: true[\s\S]*transactionSent: false/,
    "V10 deployed identity boundary doc must pair the deployed mismatch with passing offline canonical identity",
  );
  assert.match(
    v10DeployedIdentityBoundaryDoc,
    /Do not redeploy V10[\s\S]*Do not hide `metadataOnlyMismatch=true`[\s\S]*G1-G4/,
    "V10 deployed identity boundary doc must keep redeploy and launch sign-off as explicit external decisions",
  );
  assert.doesNotMatch(
    v10DeployedSummarySource,
    /--fresh|--prepare|writeFileSync|createWalletClient|privateKeyToAccount|sendTransaction|writeContract/,
    "V10 deployed summary wrapper must not enter fresh, artifact-writing, wallet, or transaction paths",
  );
  assert.match(
    businessLogicSummarySource,
    /tsxCliPath[\s\S]*node_modules[\s\S]*tsx[\s\S]*dist[\s\S]*cli\.mjs[\s\S]*testArgs = \[tsxCliPath, "scripts\/test-business-logic\.mjs"\][\s\S]*BUSINESS_LOGIC_SUMMARY_TIMEOUT_MS[\s\S]*maxBuffer: 2 \* 1024 \* 1024[\s\S]*redactProofText/,
    "business logic summary wrapper must run the same test suite directly with bounded redacted output",
  );
  assert.match(
    businessLogicSummarySource,
    /Business logic tests passed[\s\S]*expectedWarnings[\s\S]*assertionFailures[\s\S]*durationMs[\s\S]*childExitCode/,
    "business logic summary wrapper must emit compact pass, warning, assertion, duration, and child-exit evidence",
  );
  assert.match(
    businessLogicSummarySource,
    /function nonNegativeSafeIntegerText\(value\)[\s\S]*\^\(\?:0\|\[1-9\]\\d\{0,15\}\)\$[\s\S]*Number\.isSafeInteger\(parsed\) && parsed >= 0[\s\S]*expectedWarnings = nonNegativeSafeIntegerText\(output\.match/,
    "business logic summary wrapper must canonical-parse expected warning counts before emitting proof counters",
  );
  assert.match(
    businessLogicSummarySource,
    /MAX_ASSERTION_FAILURE_COUNT = 9999[\s\S]*function countAssertionFailures\(text\)[\s\S]*pattern\.exec\(text\)[\s\S]*MAX_ASSERTION_FAILURE_COUNT[\s\S]*assertionFailures = countAssertionFailures\(output\)/,
    "business logic summary wrapper must count assertion failures without materializing match arrays",
  );
  assert.doesNotMatch(
    businessLogicSummarySource,
    /\[\.\.\.output\.matchAll/,
    "business logic summary wrapper must not spread matchAll output into an array",
  );
  assert.doesNotMatch(
    businessLogicSummarySource,
    /Number\.parseInt|parseInt\(/,
    "business logic summary wrapper must not use partial parseInt coercion for proof counters",
  );
  assert.equal(
    prelaunchPackageScripts?.["test:logic:summary"],
    "node scripts/run-business-logic-summary.mjs",
    "business logic checks must expose a compact summary alias for aggregate prelaunch checks",
  );
  assert.match(
    indexerStorageSummarySource,
    /"--silent", "run", "test:indexer-storage"[\s\S]*INDEXER_STORAGE_SUMMARY_TIMEOUT_MS[\s\S]*maxBuffer: 1024 \* 1024[\s\S]*redactProofText/,
    "indexer storage summary wrapper must run the same storage test with bounded redacted output",
  );
  assert.match(
    indexerStorageSummarySource,
    /extractJsonObject[\s\S]*financialEventCategories[\s\S]*chainScopeIsolation[\s\S]*normalizedEventScopeIsolation[\s\S]*protocolFeeScopeIsolation[\s\S]*idempotentUpsert[\s\S]*singleRebateClaimParity[\s\S]*partialRpcLogFallback[\s\S]*malformedPayloadFallback[\s\S]*sameBlockEventOrdering[\s\S]*assertionFailures/,
    "indexer storage summary wrapper must emit compact financial-event category, same-block ordering, chain-scope, normalized-event, protocol-fee scope, idempotency, single rebate, partial-RPC-log, malformed-payload, and assertion counters",
  );
  assert.match(
    indexerStorageSummarySource,
    /function nonNegativeInteger\(value\)[\s\S]*Number\.isSafeInteger\(value\) && value >= 0[\s\S]*categories: nonNegativeInteger\(parsed\?\.categories\)/,
    "indexer storage summary wrapper must reject negative category counters before emitting proof evidence",
  );
  assert.match(
    indexerStorageSummarySource,
    /MAX_ASSERTION_FAILURE_COUNT = 9999[\s\S]*function countAssertionFailures\(text\)[\s\S]*pattern\.exec\(text\)[\s\S]*MAX_ASSERTION_FAILURE_COUNT[\s\S]*assertionFailures = countAssertionFailures\(output\)/,
    "indexer storage summary wrapper must count assertion failures without materializing match arrays",
  );
  assert.doesNotMatch(
    indexerStorageSummarySource,
    /\[\.\.\.output\.matchAll/,
    "indexer storage summary wrapper must not spread matchAll output into an array",
  );
  assert.doesNotMatch(
    indexerStorageSummarySource,
    /Number\.isSafeInteger\(parsed\?\.categories\) \? parsed\.categories : 0/,
    "indexer storage summary wrapper must not accept negative safe integers as category counters",
  );
  assert.equal(
    prelaunchPackageScripts?.["test:indexer-storage:summary"],
    "node scripts/run-indexer-storage-summary.mjs",
    "indexer storage checks must expose a compact summary alias for aggregate prelaunch checks",
  );
  assert.match(
    dbOperationsSummarySource,
    /"--silent", "run", "test:db-operations"[\s\S]*DB_OPERATIONS_SUMMARY_TIMEOUT_MS[\s\S]*maxBuffer: 1024 \* 1024[\s\S]*redactProofText/,
    "DB operations summary wrapper must run the same SQLite drill with bounded redacted output",
  );
  assert.match(
    dbOperationsSummarySource,
    /extractJsonObject[\s\S]*backupIntegrity[\s\S]*futureSourceBackupSummaryRejected[\s\S]*malformedRetentionBackupSummaryRejected[\s\S]*unsafeRetentionBackupSummaryRejected[\s\S]*restoreUsesSuppliedBackupArtifact[\s\S]*corruptBackupRestoreRejected[\s\S]*diskFullRejected[\s\S]*assertionFailures/,
    "DB operations summary wrapper must emit compact backup, future timestamp, retention, restore-artifact, fault, and assertion counters",
  );
  assert.match(
    dbOperationsSummarySource,
    /function nonNegativeInteger\(value\)[\s\S]*Number\.isSafeInteger\(value\) && value >= 0[\s\S]*backupRows: nonNegativeInteger\(parsed\?\.backup\?\.rows\)[\s\S]*retentionExpiredRemoved: nonNegativeInteger\(parsed\?\.retention\?\.expiredRemoved\)[\s\S]*foreignRows: nonNegativeInteger\(parsed\?\.scopeAudit\?\.foreignRows\)/,
    "DB operations summary wrapper must reject negative SQLite row counters before emitting proof evidence",
  );
  assert.match(
    dbOperationsSummarySource,
    /MAX_ASSERTION_FAILURE_COUNT = 9999[\s\S]*function countAssertionFailures\(text\)[\s\S]*pattern\.exec\(text\)[\s\S]*MAX_ASSERTION_FAILURE_COUNT[\s\S]*assertionFailures = countAssertionFailures\(output\)/,
    "DB operations summary wrapper must count assertion failures without materializing match arrays",
  );
  assert.doesNotMatch(
    dbOperationsSummarySource,
    /\[\.\.\.output\.matchAll/,
    "DB operations summary wrapper must not spread matchAll output into an array",
  );
  assert.doesNotMatch(
    dbOperationsSummarySource,
    /Number\.isSafeInteger\(parsed\?\.(?:backup|retention|scopeAudit)\?\.[a-zA-Z0-9_]+\) \? parsed\.(?:backup|retention|scopeAudit)\.[a-zA-Z0-9_]+ : 0/,
    "DB operations summary wrapper must not accept negative safe integers as SQLite proof counters",
  );
  assert.equal(
    prelaunchPackageScripts?.["test:db-operations:summary"],
    "node scripts/run-db-operations-summary.mjs",
    "SQLite operations must expose a compact summary alias for aggregate prelaunch checks",
  );
  assert.match(
    monitoringDrillSummarySource,
    /"--silent", "run", "test:monitoring"[\s\S]*MONITORING_DRILL_SUMMARY_TIMEOUT_MS[\s\S]*maxBuffer: 1024 \* 1024[\s\S]*redactProofText/,
    "monitoring drill summary wrapper must run the same runtime drill with bounded redacted output",
  );
  assert.match(
    monitoringDrillSummarySource,
    /extractJsonObject[\s\S]*duplicateAlertsAfterRestart[\s\S]*repoLocalBackupDirRejected[\s\S]*localPathBaseUrlRejected[\s\S]*malformedNumericEnvRejected[\s\S]*stateCleared[\s\S]*assertionFailures/,
    "monitoring drill summary wrapper must emit compact alert, recovery, restart, repo-local backup rejection, local path base URL rejection, malformed numeric env rejection, and assertion counters",
  );
  assert.match(
    monitoringDrillSummarySource,
    /function nonNegativeInteger\(value\)[\s\S]*Number\.isSafeInteger\(value\) && value >= 0[\s\S]*alerts: nonNegativeInteger\(parsed\?\.alerts\)[\s\S]*duplicateAlertsAfterRestart: nonNegativeInteger\(parsed\?\.duplicateAlertsAfterRestart\)[\s\S]*deliveries: nonNegativeInteger\(parsed\?\.deliveries\)/,
    "monitoring drill summary wrapper must reject negative alert and recovery counters before emitting proof evidence",
  );
  assert.match(
    monitoringDrillSummarySource,
    /MAX_ASSERTION_FAILURE_COUNT = 9999[\s\S]*function countAssertionFailures\(text\)[\s\S]*pattern\.exec\(text\)[\s\S]*MAX_ASSERTION_FAILURE_COUNT[\s\S]*assertionFailures = countAssertionFailures\(output\)/,
    "monitoring drill summary wrapper must count assertion failures without materializing match arrays",
  );
  assert.doesNotMatch(
    monitoringDrillSummarySource,
    /\[\.\.\.output\.matchAll/,
    "monitoring drill summary wrapper must not spread matchAll output into an array",
  );
  assert.doesNotMatch(
    monitoringDrillSummarySource,
    /Number\.isSafeInteger\(parsed\?\.[a-zA-Z0-9_]+\) \? parsed\.[a-zA-Z0-9_]+ : 0/,
    "monitoring drill summary wrapper must not accept negative safe integers as monitoring proof counters",
  );
  assert.equal(
    prelaunchPackageScripts?.["test:monitoring:summary"],
    "node scripts/run-monitoring-drill-summary.mjs",
    "runtime monitoring drill must expose a compact summary alias for aggregate prelaunch checks",
  );
  assert.match(
    fetchTimeoutSummarySource,
    /"--silent", "run", "test:fetch-timeout"[\s\S]*FETCH_TIMEOUT_SUMMARY_TIMEOUT_MS[\s\S]*maxBuffer: 512 \* 1024[\s\S]*redactProofText/,
    "fetch timeout summary wrapper must run the same timeout test with bounded redacted output",
  );
  assert.match(
    fetchTimeoutSummarySource,
    /fetchWithTimeout tests passed[\s\S]*fetchTimeout[\s\S]*assertionFailures/,
    "fetch timeout summary wrapper must emit compact pass and assertion counters",
  );
  assert.match(
    fetchTimeoutSummarySource,
    /MAX_ASSERTION_FAILURE_COUNT = 9999[\s\S]*function countAssertionFailures\(text\)[\s\S]*pattern\.exec\(text\)[\s\S]*MAX_ASSERTION_FAILURE_COUNT[\s\S]*assertionFailures = countAssertionFailures\(output\)/,
    "fetch timeout summary wrapper must count assertion failures without materializing match arrays",
  );
  assert.doesNotMatch(
    fetchTimeoutSummarySource,
    /\[\.\.\.output\.matchAll/,
    "fetch timeout summary wrapper must not spread matchAll output into an array",
  );
  assert.equal(
    prelaunchPackageScripts?.["test:fetch-timeout:summary"],
    "node scripts/run-fetch-timeout-summary.mjs",
    "fetch timeout test must expose a compact summary alias for aggregate prelaunch checks",
  );
  assert.match(
    storedNumberParsingSummarySource,
    /"--silent", "run", "test:stored-number-parsing"[\s\S]*STORED_NUMBER_PARSING_SUMMARY_TIMEOUT_MS[\s\S]*maxBuffer: 512 \* 1024[\s\S]*redactProofText/,
    "stored number parsing summary wrapper must run the same parser test with bounded redacted output",
  );
  assert.match(
    storedNumberParsingSummarySource,
    /stored number parsing tests passed[\s\S]*storedNumberParsing[\s\S]*assertionFailures/,
    "stored number parsing summary wrapper must emit compact pass and assertion counters",
  );
  assert.match(
    storedNumberParsingSummarySource,
    /MAX_ASSERTION_FAILURE_COUNT = 9999[\s\S]*function countAssertionFailures\(text\)[\s\S]*pattern\.exec\(text\)[\s\S]*MAX_ASSERTION_FAILURE_COUNT[\s\S]*assertionFailures = countAssertionFailures\(output\)/,
    "stored number parsing summary wrapper must count assertion failures without materializing match arrays",
  );
  assert.doesNotMatch(
    storedNumberParsingSummarySource,
    /\[\.\.\.output\.matchAll/,
    "stored number parsing summary wrapper must not spread matchAll output into an array",
  );
  assert.match(
    storedNumberParsingSource,
    /STORED_BLOCK_NUMBER_RE\s*=\s*\/\^\(\?:0\|\[1-9\]\\d\{0,15\}\)\$\/[\s\S]*STORED_POSITIVE_INTEGER_RE\s*=\s*\/\^\[1-9\]\\d\{0,15\}\$\/[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*STORED_BLOCK_NUMBER_RE\.test\(value\)[\s\S]*STORED_POSITIVE_INTEGER_RE\.test\(value\)[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)/,
    "shared stored number parsing must reject non-canonical or oversized decimal strings before numeric conversion",
  );
  assert.equal(
    prelaunchPackageScripts?.["test:stored-number-parsing:summary"],
    "node scripts/run-stored-number-parsing-summary.mjs",
    "stored number parsing test must expose a compact summary alias for aggregate prelaunch checks",
  );
  assert.match(
    typecheckSummarySource,
    /"--silent", "run", "typecheck"[\s\S]*TYPECHECK_SUMMARY_TIMEOUT_MS[\s\S]*maxBuffer: 2 \* 1024 \* 1024[\s\S]*redactProofText/,
    "TypeScript summary wrapper must run the same project typecheck with bounded redacted output",
  );
  assert.match(
    typecheckSummarySource,
    /error TS\(\\d\{3,6\}\)[\s\S]*tsErrors[\s\S]*tsCodes/,
    "TypeScript summary wrapper must emit compact TS error counts and safe TS codes",
  );
  assert.match(
    typecheckSummarySource,
    /MAX_TS_ERROR_COUNT = 9999[\s\S]*MAX_TS_CODES = 8[\s\S]*function summarizeTypeScriptErrors\(output\)[\s\S]*pattern\.exec\(output\)[\s\S]*tsCodes: \[\.\.\.codes\]\.sort\(\)[\s\S]*tsErrors: count/,
    "TypeScript summary wrapper must count TS errors and collect TS codes without materializing match arrays",
  );
  assert.doesNotMatch(
    typecheckSummarySource,
    /\[\.\.\.output\.matchAll/,
    "TypeScript summary wrapper must not spread matchAll output into an array",
  );
  assert.equal(
    prelaunchPackageScripts?.["typecheck:summary"],
    "node scripts/run-typecheck-summary.mjs",
    "TypeScript must expose a compact summary alias for aggregate prelaunch checks",
  );
  assert.match(
    buildSummarySource,
    /"--silent", "run", "build"[\s\S]*BUILD_SUMMARY_TIMEOUT_MS[\s\S]*maxBuffer: 4 \* 1024 \* 1024[\s\S]*redactProofText/,
    "build summary wrapper must run the same project build with bounded redacted output",
  );
  assert.match(
    buildSummarySource,
    /classifyBuildWarningKinds[\s\S]*sqlite-experimental[\s\S]*classifyBuildNoticeKinds[\s\S]*edge-runtime-static-generation-disabled[\s\S]*countBuildWarningKindOccurrences[\s\S]*sqlite-experimental[\s\S]*Compiled successfully[\s\S]*Proxy \\\(Middleware\\\)[\s\S]*warnings[\s\S]*warningKinds[\s\S]*warningKindCounts[\s\S]*classifiedWarnings[\s\S]*unclassifiedWarnings[\s\S]*notices[\s\S]*noticeKinds[\s\S]*errors/,
    "build summary wrapper must emit compact build success, proxy, warning kind coverage, notice, and error counts",
  );
  assert.match(
    buildSummarySource,
    /hasUnclassifiedWarnings = unclassifiedWarnings > 0[\s\S]*build-unclassified-warnings[\s\S]*const pass = result\.status === 0[\s\S]*!hasUnclassifiedWarnings/,
    "build summary wrapper must fail closed when the production build emits unclassified warnings",
  );
  assert.match(
    buildSummarySource,
    /MAX_SUMMARY_MATCH_COUNT = 9999[\s\S]*function countMatches\(text, pattern\)[\s\S]*pattern\.lastIndex = 0[\s\S]*pattern\.exec\(text\)[\s\S]*MAX_SUMMARY_MATCH_COUNT/,
    "build summary wrapper must count warning and error matches without materializing unbounded match arrays",
  );
  assert.doesNotMatch(
    buildSummarySource,
    /\[\.\.\.text\.matchAll|for \(const .* of text\.matchAll/,
    "build summary wrapper must not spread matchAll output into an array",
  );
  assert.equal(
    prelaunchPackageScripts?.["build:summary"],
    "node scripts/run-build-summary.mjs",
    "production build must expose a compact summary alias for aggregate prelaunch checks",
  );
  assert.match(
    eslintSummarySource,
    /const npmCommand = process\.env\.npm_execpath[\s\S]*"exec", "--", "eslint", "\.", "--format", "json"[\s\S]*maxBuffer: 2 \* 1024 \* 1024[\s\S]*redactProofText/,
    "ESLint summary wrapper must run the same project lint with bounded redacted output",
  );
  assert.match(
    eslintSummarySource,
    /filesChecked[\s\S]*filesWithIssues[\s\S]*errors[\s\S]*warnings[\s\S]*ruleIds/,
    "ESLint summary wrapper must emit compact aggregate counts without file paths",
  );
  assert.equal(
    prelaunchPackageScripts?.["lint:summary"],
    "node scripts/run-eslint-summary.mjs",
    "ESLint must expose a compact summary alias for aggregate prelaunch checks",
  );
  assert.equal(
    prelaunchPackageScripts?.["proof:contract-compiler-advisories:v10:summary"],
    "node scripts/check-solidity-compiler-advisories.mjs --summary-only",
    "V10 compiler advisory proof must expose a compact summary alias",
  );
  assert.equal(
    prelaunchPackageScripts?.["proof:launch-docs:summary"],
    "node scripts/check-launch-doc-command-syntax.mjs --summary-only",
    "launch docs verifier must expose a compact summary alias for aggregate prelaunch checks",
  );
  assert.equal(
    prelaunchPackageScripts?.["proof:host-guard:summary"],
    "node scripts/check-host-proof-load-target.mjs --summary-only",
    "host proof load-target guard must expose a compact summary alias for aggregate prelaunch checks",
  );
  assert.equal(
    prelaunchPackageScripts?.["bench:contract:v10:diagnostics:summary"],
    "tsx scripts/benchmark-v10-linea-gas.ts --diagnostics-only --summary-only",
    "V10 diagnostics must expose an explicit no-RPC compact summary alias for aggregate prelaunch checks",
  );
  assert.match(
    prelaunchStatusSource,
    /checkedDocs[\s\S]*docs=\$\{nonNegativeIntegerField\(parsed\.checkedDocs\)\}[\s\S]*missingScripts=\$\{nonNegativeIntegerField\(parsed\.missingPackageScripts\)\}[\s\S]*missingExamples=\$\{nonNegativeIntegerField\(parsed\.missingPowerShellExamples\)\}/,
    "prelaunch status summary must preserve compact launch-doc command hygiene counts",
  );
  assert.match(
    prelaunchStatusSource,
    /fixtures[\s\S]*issues[\s\S]*launchGate[\s\S]*fixtures=\$\{nonNegativeIntegerField\(parsed\.fixtures\)\}[\s\S]*issues=\$\{nonNegativeIntegerField\(parsed\.issues\)\}[\s\S]*gate=\$\{formatSafeTokenList\(\[parsed\.launchGate\]\)\}/,
    "prelaunch status summary must preserve compact host load-target guard counts",
  );
  assert.match(
    prelaunchStatusSource,
    /filesChecked[\s\S]*filesWithIssues[\s\S]*ruleIds[\s\S]*files=\$\{nonNegativeIntegerField\(parsed\.filesChecked\)\}[\s\S]*errors=\$\{nonNegativeIntegerField\(parsed\.errors\)\}[\s\S]*rules=\$\{formatSafeTokenList\(parsed\.ruleIds\)\}/,
    "prelaunch status summary must preserve compact ESLint counts without file paths",
  );
  assert.equal(
    prelaunchPackageScripts?.["prelaunch:status:summary"],
    prelaunchPackageScripts?.["proof:prelaunch:summary"],
    "operator-facing prelaunch status alias must stay wired to the compact proof summary",
  );
  assert.match(
    prelaunchStatusSource,
    /pendingNonceGap[\s\S]*operationalBoundary[\s\S]*pendingGap=\$\{nonNegativeIntegerField\(parsed\.pendingNonceGap\)\}[\s\S]*replacementCap=\$\{nonNegativeIntegerField\(parsed\.replacementCap\)\}[\s\S]*wouldSend=\$\{parsed\.wouldSendReplacement === true\}[\s\S]*dryRunDefault=\$\{boundary\.dryRunDefault === true\}[\s\S]*signing=\$\{boundary\.signingMaterialLoaded === true\}[\s\S]*walletClient=\$\{boundary\.walletClientCreated === true\}[\s\S]*contractWrite=\$\{boundary\.contractWriteSubmitted === true\}[\s\S]*txSent=\$\{boundary\.transactionSent === true\}/,
    "prelaunch status summary must surface pending-nonce dry-run and no-transaction facts without addresses",
  );
  assert.match(
    prelaunchStatusSource,
    /dryRunProofBlocksG10G11[\s\S]*plannedBetTx[\s\S]*ageMinutes=\$\{nonNegativeIntegerField\(parsed\.ageMinutes\)\}[\s\S]*transactionLimit=\$\{nonNegativeIntegerField\(parsed\.transactionLimit\)\}[\s\S]*estimatedGas=\$\{nonNegativeIntegerField\(parsed\.estimatedGas\)\}[\s\S]*plannedBetTx=\$\{nonNegativeIntegerField\(parsed\.plannedBetTx\)\}[\s\S]*txSent=\$\{parsed\.transactionSent === true\}[\s\S]*signing=\$\{parsed\.signingMaterialLoaded === true\}[\s\S]*walletClient=\$\{parsed\.walletClientCreated === true\}[\s\S]*contractWrite=\$\{parsed\.contractWriteSubmitted === true\}[\s\S]*dryRunBlocksG10G11=\$\{parsed\.dryRunProofBlocksG10G11 === true\}/,
    "prelaunch status summary must surface V10 dry-run Preview freshness, bounded plan size, and no-transaction facts without raw Preview excerpts",
  );
  assert.match(
    prelaunchStatusSource,
    /dryRunProofBlocksG10G11[\s\S]*plannedBetTx[\s\S]*authFresh=\$\{parsed\.authorizationFreshnessRequired === true\}[\s\S]*maxAgeMinutes=\$\{nonNegativeIntegerField\(parsed\.maxPreviewAgeMinutes\)\}/,
    "prelaunch status summary must surface whether the V10 Preview is fresh enough for transaction authorization",
  );
  assert.match(
    prelaunchStatusSource,
    /function formatRoleCounts\(value\)[\s\S]*\^\[A-Z0-9_\]\{1,32\}\$[\s\S]*roles=\$\{formatRoleCounts\(progress\.successfulBetRoles\)\}\/\$\{formatRoleCounts\(progress\.failedBetRoles\)\}/,
    "prelaunch status summary must surface sanitized soak role coverage without raw logs or addresses",
  );
  assert.match(
    prelaunchStatusSource,
    /function formatSafeCounts\(value, maxEntries = 4\)[\s\S]*\^\[a-zA-Z0-9_-\]\{1,48\}\$[\s\S]*fk=\$\{formatSafeCounts\(progress\.failedBetErrorKinds\)\}[\s\S]*ff=\$\{formatSafeCounts\(progress\.failedBetFamilies\)\}[\s\S]*fm=\$\{formatSafeCounts\(progress\.failedBetModes\)\}[\s\S]*fs=\$\{formatSafeCounts\(progress\.failedBetStages\)\}[\s\S]*streak=\$\{formatRoleCounts\(progress\.maxConsecutiveFailedBetsByRole\)\}/,
    "prelaunch status summary must surface sanitized soak failure classes and streaks without raw logs or addresses",
  );
  assert.match(
    prelaunchStatusSource,
    /function formatPreflightFailures\(value\)[\s\S]*\^\[A-Z0-9_\]\{1,32\}\$[\s\S]*\^\[a-z0-9-\]\{1,48\}\$[\s\S]*pre=\$\{formatPreflightFailures\(progress\.preflightFailures\)\}/,
    "prelaunch status summary must surface sanitized soak preflight blockers without raw logs or addresses",
  );
  assert.match(
    prelaunchStatusSource,
    /function formatDiskCapacity\(value\)[\s\S]*nonNegativeIntegerMetric\(value\.diskFreeBytesNow\)[\s\S]*nonNegativeIntegerMetric\(value\.diskFreeMinimumBytes\)[\s\S]*diskFreeBelowMinimum[\s\S]*function formatGrowthDeltas\(value\)[\s\S]*rssBytes\?\.delta[\s\S]*dbBytes\?\.delta[\s\S]*walBytes\?\.delta[\s\S]*diskFreeBytes\?\.delta[\s\S]*h=\$\{nonNegativeIntegerField\(progress\.healthFailures\)\}\/\$\{nonNegativeIntegerField\(progress\.healthRetries\)\}[\s\S]*rpc=\$\{nonNegativeIntegerField\(progress\.rpcFailoverInjectionEvents\)\}[\s\S]*gas=\$\{nonNegativeIntegerField\(progress\.estimateGasRetries\)\}[\s\S]*slow=\$\{nonNegativeIntegerField\(progress\.slowSendCount\)\}[\s\S]*p95=\$\{nonNegativeIntegerMetric\(progress\.latencyMs\?\.p95\)\}[\s\S]*free=\$\{nonNegativeIntegerMetric\(progress\.healthGrowth\?\.diskFreeBytes\?\.min\)\}[\s\S]*disk=\$\{formatDiskCapacity\(parsed\.diskCapacity\)\}[\s\S]*gr=\$\{formatGrowthDeltas\(progress\.healthGrowth\)\}/,
    "prelaunch status summary must surface compact soak health, latency, disk safety, and growth counters",
  );
  assert.match(
    prelaunchStatusSource,
    /function safeInteger\(value\)[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*function nonNegativeSafeInteger\(value\)[\s\S]*Number\.isSafeInteger\(value\) && value >= 0[\s\S]*function nonNegativeSafeIntegerText\(value\)[\s\S]*DECIMAL_INTEGER_RE\.test\(text\)[\s\S]*function nonNegativeIntegerField\(value\)[\s\S]*nonNegativeSafeInteger\(value\) \?\? 0/,
    "prelaunch status summary must define safe integer helpers before formatting proof counters",
  );
  assert.doesNotMatch(
    prelaunchStatusSource,
    /Number\.isFinite/,
    "prelaunch status summary must not broadly accept fractional or unsafe proof counters",
  );
  assert.doesNotMatch(
    prelaunchStatusSource,
    /nonNegativeSafeInteger\(Number\((?:issueMatch|envGateMatch|gateProgress)\[/,
    "prelaunch status summary must canonical-parse text-derived proof counters before compact output",
  );
  assert.match(
    prelaunchStatusSource,
    /function formatSafeTokenList\(value[\s\S]*\^\[a-z0-9-\]\{1,64\}\$[\s\S]*mode === "runtime-monitor-config"[\s\S]*strict=\$\{parsed\.strictProductionLike === true\}[\s\S]*resend=\$\{parsed\.resendConfigured === true\}[\s\S]*backupAge=\$\{parsed\.backupMaxAgeConfigured === true\}[\s\S]*missing=\$\{formatSafeTokenList\(parsed\.missingConfig\)\}[\s\S]*wouldPoll=\$\{parsed\.wouldPoll === true\}[\s\S]*wouldSendAlerts=\$\{parsed\.wouldSendAlerts === true\}/,
    "prelaunch status summary must surface runtime monitor config readiness and safe missing-config tokens without endpoint polling or alert sends",
  );
  assert.match(
    prelaunchStatusSource,
    /function formatGroupSummary\(value\)[\s\S]*\^\[a-z0-9-\]\{1,32\}=\[1-9\]\\d\{0,3\}\$[\s\S]*\.slice\(0, 16\)[\s\S]*const groups = formatGroupSummary\(parsed\.groups\);[\s\S]*const issue = formatIssueToken\(parsed\.issue\);/,
    "prelaunch status summary must preserve compact JSON blocker groups as safe group=count tokens such as backup=1",
  );
  assert.match(
    prelaunchStatusSource,
    /"scope" in parsed && "blockingHighCritical" in parsed[\s\S]*scope=\$\{formatSafeTokenList\(\[parsed\.scope\]\)\}[\s\S]*blocking=\$\{nonNegativeIntegerField\(parsed\.blockingHighCritical\)\}[\s\S]*knownDev=\$\{nonNegativeIntegerField\(parsed\.knownDevToolchainHigh\)\}[\s\S]*breaking=\$\{nonNegativeIntegerField\(parsed\.breakingFixes\)\}/,
    "prelaunch status summary must preserve compact dependency audit scope and risk counters",
  );
  assert.match(
    prelaunchStatusSource,
    /Rows: total=[\s\S]*status=pass, /,
    "prelaunch status summary must surface compact proof-draft row counts instead of the full evidence table",
  );
  assert.ok(
    prelaunchStatusSource.includes("function formatSummaryLine(line)") &&
      prelaunchStatusSource.includes("issue\\(s\\):") &&
      prelaunchStatusSource.includes("blocked gates:") &&
      prelaunchStatusSource.includes("env gate\\(s\\)") &&
      prelaunchStatusSource.includes('"status=ready"') &&
      prelaunchStatusSource.includes("function summarizeMainnetEnvProofLines(lines)") &&
      prelaunchStatusSource.includes('const summaryToken = formatSummaryLine(summary)') &&
      prelaunchStatusSource.includes('const groupTokens = formatGroupSummary(groups.replace(/^Failing gate groups:\\s*/, "")).replace(/^, groups=/, "")') &&
      prelaunchStatusSource.includes('tokens=${formatSafeTokenList(tokens.replace(/^Failing gate tokens:\\s*/, "").split(/\\s*,\\s*/))}') &&
      prelaunchStatusSource.includes('groupTokens ? `groups=${groupTokens}` : "groups=none"'),
    "prelaunch status summary must surface grouped and tokenized mainnet env blockers without raw gate values",
  );
  assert.doesNotMatch(
    prelaunchStatusSource,
    /function summarizeMainnetEnvProofLines\(lines\)[\s\S]*return `\$\{summary\}|function summarizeOutput\(output\)[\s\S]*if \(summary\) return summary/,
    "prelaunch status summary must not replay raw Summary lines from child proof commands",
  );
  assert.match(
    prelaunchStatusSource,
    /function summarizeRemainingGateLines\(lines\)[\s\S]*Complete gates:[\s\S]*Remaining gate groups:[\s\S]*Next proof files:[\s\S]*Next marker tokens:[\s\S]*Next status check:[\s\S]*Autonomous next:[\s\S]*Transaction boundary:[\s\S]*Pre-transaction preview checks:[\s\S]*Consent requirement:[\s\S]*completedGates = gateProgress \? nonNegativeSafeIntegerText\(gateProgress\[1\]\) : null[\s\S]*totalGates = gateProgress \? nonNegativeSafeIntegerText\(gateProgress\[2\]\) : null[\s\S]*const remainingGroupTokens = remainingGroups[\s\S]*formatGroupSummary\(remainingGroups\.replace[\s\S]*const groupsSummary = remainingGroupTokens \? `; groups=\$\{remainingGroupTokens\}` : "";[\s\S]*const proofSummary = nextProofFiles[\s\S]*formatSafeTokenList\(nextProofFiles\.replace[\s\S]*replace\(\/\\\.\/g, "-"\)[\s\S]*const markerSummary = nextMarkers[\s\S]*const nextStatusToken = nextStatusCheck[\s\S]*const autonomousNextToken = autonomousNext[\s\S]*autonomousNext=\$\{formatSafeTokenList\(\[autonomousNextToken\]\)\}[\s\S]*consent=present[\s\S]*txBoundary=\$\{formatSafeTokenList\(\[transactionBoundaryToken\]\)\}[\s\S]*previewChecks=\$\{previewCheckTokens\}[\s\S]*status=blocked, remaining=[\s\S]*next=\$\{gateId\}\$\{groupSummary\}\$\{proofSummary\}\$\{statusSummary\}\$\{autonomousSummary\}\$\{consentSummary\}\$\{transactionSummary\}\$\{previewSummary\}\$\{markerSummary\}\$\{groupsSummary\}[\s\S]*summarizeRemainingGateLines\(lines\)/,
    "prelaunch status summary must preserve compact remaining counts, external next status, safe autonomous next command, and pre-transaction consent boundary before longer group counts",
  );
  assert.match(
    prelaunchStatusSource,
    /Date\.now\(\)[\s\S]*elapsedMs[\s\S]*formatDurationMs[\s\S]*nonNegativeSafeInteger\(item\.elapsedMs\) !== null[\s\S]*Slowest checks:/,
    "prelaunch status summary must surface compact slow-check timing without raw child output",
  );
  assert.match(
    prelaunchStatusSource,
    /function blockerGroupForScript\(script\)[\s\S]*script\.startsWith\("monitor:"\)[\s\S]*function formatBlockerGroups\(scripts\)[\s\S]*Blocker groups:/,
    "prelaunch status summary must group external blockers without raw child output",
  );
  assert.match(
    prelaunchStatusSource,
    /runtimeBytecodeBytes[\s\S]*bytecodeBytes[\s\S]*creationBytes=\$\{creationBytes\}[\s\S]*runtimeBytes=\$\{runtimeBytes\}[\s\S]*manifestMatches=\$\{parsed\.manifestMatches === true\}[\s\S]*wouldWrite=\$\{parsed\.wouldWrite === true \? "true" : "false"\}/,
    "prelaunch status summary must surface compact read-only contract compilation provenance for V9 and V10",
  );
  assert.match(
    prelaunchStatusSource,
    /"v10OfflineIdentity" in parsed && "runtimeBytes" in parsed[\s\S]*profile=\$\{formatSafeTokenList\(\[parsed\.compilerProfile\]\)\}[\s\S]*runtimeBytes=\$\{nonNegativeIntegerField\(parsed\.runtimeBytes\)\}[\s\S]*executableRuntimeBytes=\$\{nonNegativeIntegerField\(parsed\.executableRuntimeBytes\)\}[\s\S]*manifestMatches=\$\{parsed\.manifestMatches === true\}[\s\S]*transactionSent=\$\{parsed\.transactionSent === true\}[\s\S]*assertionFailures=\$\{nonNegativeIntegerField\(parsed\.assertionFailures\)\}/,
    "prelaunch status summary must surface compact V10 offline identity without raw verifier output",
  );
  assert.match(
    prelaunchStatusSource,
    /"v10DeployedReadOnly" in parsed && "runtimeBytes" in parsed[\s\S]*network=\$\{formatSafeTokenList\(\[parsed\.network\]\)\}[\s\S]*chainId=\$\{nonNegativeIntegerField\(parsed\.chainId\)\}[\s\S]*runtimeBytes=\$\{nonNegativeIntegerField\(parsed\.runtimeBytes\)\}[\s\S]*expectedRuntimeBytes=\$\{nonNegativeIntegerField\(parsed\.expectedRuntimeBytes\)\}[\s\S]*runtimeBytecode=\$\{parsed\.runtimeBytecode === true\}[\s\S]*runtimeExecutable=\$\{parsed\.runtimeExecutable === true\}[\s\S]*metadataOnlyMismatch=\$\{parsed\.metadataOnlyMismatch === true\}[\s\S]*transactionSent=\$\{parsed\.transactionSent === true\}/,
    "prelaunch status summary must surface compact read-only deployed V10 identity mismatch facts",
  );
  assert.match(
    prelaunchStatusSource,
    /function blockerGroupForScript\(script\) \{[\s\S]*script\.includes\("contract"\)[\s\S]*return "contract"/,
    "prelaunch status summary must classify deployed contract identity blockers as contract blockers",
  );
  assert.match(
    prelaunchStatusSource,
    /Types generated successfully[\s\S]*status=pass, nextTypegen=true, tsc=true/,
    "prelaunch status summary must surface compact TypeScript typecheck facts",
  );
  assert.match(
    prelaunchStatusSource,
    /script === "lint"[\s\S]*status=pass, eslint=true/,
    "prelaunch status summary must surface compact ESLint pass facts",
  );
  assert.ok(
    prelaunchStatusSource.includes('script === "build"') &&
      prelaunchStatusSource.includes("Compiled successfully") &&
      prelaunchStatusSource.includes("Proxy \\(Middleware\\)") &&
      prelaunchStatusSource.includes("status=pass, compiled=true, proxy=true"),
    "prelaunch status summary must surface compact production build pass facts",
  );
  assert.match(
    prelaunchStatusSource,
    /function formatBundleFilePath\(value\)[\s\S]*\^static\\\/\[a-zA-Z0-9\._\/-\]\+\$[\s\S]*totalBytes[\s\S]*fileCount[\s\S]*files=\$\{nonNegativeIntegerField\(parsed\.fileCount\)\}[\s\S]*jsBytes=\$\{nonNegativeIntegerField\(parsed\.jsBytes\)\}[\s\S]*largestJsBytes=\$\{nonNegativeIntegerField\(parsed\.largestJsBytes\)\}[\s\S]*largestJsFile=\$\{formatBundleFilePath\(parsed\.largestJsFile\?\.path\)\}[\s\S]*maxSingleJsBytes=\$\{nonNegativeIntegerField\(parsed\.budget\?\.maxSingleJsBytes\)\}[\s\S]*wasmBytes=\$\{nonNegativeIntegerField\(parsed\.wasmBytes\)\}/,
    "prelaunch status summary must surface compact bundle baseline facts, largest-JS file, and largest-JS budget",
  );
  assert.match(
    autonomousDailyStatusSource,
    /function safeBundleFilePath\(value\)[\s\S]*\^static\\\/\[a-zA-Z0-9\._\/-\]\+\$[\s\S]*function summarizeBundle\(parsed\)[\s\S]*maxSingleJsBytes = integerField\(parsed\?\.budget\?\.maxSingleJsBytes\)[\s\S]*largestJsFile = safeBundleFilePath\(parsed\?\.largestJsFile\?\.path\)[\s\S]*largestJsBytes=\$\{integerField\(parsed\?\.largestJsBytes\)\}[\s\S]*largestJsFile=\$\{largestJsFile\}[\s\S]*maxSingleJsBytes=\$\{maxSingleJsBytes\}/,
    "autonomous daily status must surface the largest-JS budget and safe largest-JS file beside the current largest JS chunk",
  );
  assert.match(
    prelaunchStatusSource,
    /Business logic tests passed[\s\S]*status=pass, businessLogic=true, removedWalletGuard=true/,
    "prelaunch status summary must surface business-logic and removed-wallet guard pass status instead of warning tails",
  );
  assert.match(
    prelaunchStatusSource,
    /import \{ redactProofText \} from "\.\/redact-proof-output\.mjs"[\s\S]*const text = redactProofText\(stripAnsi\(output\)\)/,
    "prelaunch status summary must redact child command output before JSON and summary extraction",
  );
  assert.match(
    prelaunchStatusSource,
    /function summarizeToolError\(error\)[\s\S]*redactProofText\(stripAnsi\(error instanceof Error \? error\.message : String\(error\)\)\)[\s\S]*toolFailures\.push\(`\$\{script\}: \$\{summarizeToolError\(result\.error\)\}`\)/,
    "prelaunch status summary must redact and clamp child spawn errors before reporting tool failures",
  );
  assert.match(
    prelaunchStatusSource,
    /NO_UPDATE_NOTIFIER: "1"[\s\S]*npm_config_update_notifier: "false"[\s\S]*npm_config_fund: "false"[\s\S]*env: quietNpmEnv/,
    "prelaunch status summary must suppress child npm notifier/funding noise in compact evidence output",
  );
  assert.match(
    prelaunchStatusSource,
    /function extractJsonObjects\(text\)[\s\S]*objects\.push\(source\.slice\(start, index \+ 1\)\)[\s\S]*return objects/,
    "prelaunch status summary must parse bounded multi-line and multi-object JSON summaries without dumping raw output",
  );
  assert.match(
    prelaunchStatusSource,
    /if \(parsedObjects\.length === 0\) return "";/,
    "prelaunch status summary must not mislabel non-JSON stack traces as invalid JSON summaries",
  );
  assert.match(
    prelaunchStatusSource,
    /transactionSent[\s\S]*rpcUsed[\s\S]*environmentFilesLoaded[\s\S]*functionSelectors[\s\S]*stateChangingEntrypoints[\s\S]*frontendEvents[\s\S]*indexedEvents[\s\S]*frontendOnlyEvents[\s\S]*reviewedFrontendOnlyEvents[\s\S]*checkedFinancialExits[\s\S]*preservedV9AbiItems[\s\S]*profilesChecked[\s\S]*profilesPassing[\s\S]*v10RuntimeBytes[\s\S]*knownBugCount[\s\S]*financialEventCategories[\s\S]*depositScopeIsolation[\s\S]*idempotentDepositUpsert[\s\S]*resolverRewardScopeIsolation[\s\S]*idempotentResolverRewardUpsert[\s\S]*dustSettlementScopeIsolation[\s\S]*idempotentDustSettlementUpsert[\s\S]*singleRebateClaimParity[\s\S]*epochScopeIsolation[\s\S]*idempotentEpochUpsert[\s\S]*jackpotScopeIsolation[\s\S]*idempotentJackpotUpsert[\s\S]*rewardClaimScopeIsolation[\s\S]*idempotentRewardClaimUpsert[\s\S]*sameBlockEventOrdering[\s\S]*partialRpcLogFallback[\s\S]*malformedPayloadFallback[\s\S]*boundedEventStorage[\s\S]*limitedEventReads[\s\S]*candidatePagination[\s\S]*tileUserCounts[\s\S]*chainScopeIsolation[\s\S]*categoryIdIsolation[\s\S]*normalizedEventScopeIsolation[\s\S]*protocolFeeScopeIsolation[\s\S]*idempotentEventUpsert[\s\S]*idempotentProtocolFeeUpsert[\s\S]*normalizedEventIdRequiresTxLog/,
    "prelaunch status summary must surface compact compiler advisory, offline identity, V10 invariant, and indexer compatibility facts",
  );
  assert.match(
    prelaunchStatusSource,
    /"faults" in parsed[\s\S]*futureSourceBackupSummaryRejected[\s\S]*restoreUsesSuppliedBackupArtifact[\s\S]*corruptBackupRestoreRejected[\s\S]*diskFullRejected/,
    "prelaunch status summary must surface compact SQLite operation facts",
  );
  assert.ok(
    prelaunchStatusSource.includes('const required = ["@privy-io/react-auth", "@privy-io/wagmi", "wagmi@", "viem@"]') &&
      prelaunchStatusSource.includes('(?:^|[\\\\s├└─])${escapedName}@') &&
      prelaunchStatusSource.includes('status=pass, privy=${versionFor("@privy-io/react-auth")}, privyWagmi=${versionFor("@privy-io/wagmi")}, wagmi=${versionFor("wagmi")}, viem=${versionFor("viem")}'),
    "prelaunch status summary must surface compact wallet dependency integrity facts without confusing scoped and unscoped packages",
  );
  assert.match(
    prelaunchStatusSource,
    /"tsErrors" in parsed && "tsCodes" in parsed[\s\S]*nextTypegen=\$\{parsed\.nextTypegen === true\}[\s\S]*tsc=\$\{parsed\.tsc === true\}[\s\S]*tsCodes=\$\{formatSafeTokenList\(parsed\.tsCodes\)\}/,
    "prelaunch status summary must surface compact TypeScript status without raw compiler output",
  );
  assert.match(
    prelaunchStatusSource,
    /"invariantSuite" in parsed && "assertionFailures" in parsed[\s\S]*suite=\$\{formatSafeTokenList\(\[parsed\.invariantSuite\]\)\}[\s\S]*assertionFailures=\$\{nonNegativeIntegerField\(parsed\.assertionFailures\)\}/,
    "prelaunch status summary must surface compact V9 invariant status without raw assertion output",
  );
  assert.match(
    prelaunchStatusSource,
    /"invariantSuite" in parsed && "fullRangeAccountingCases" in parsed[\s\S]*runtimeBytes=\$\{nonNegativeIntegerField\(parsed\.runtimeBytes\)\}[\s\S]*guarded=\$\{nonNegativeIntegerField\(parsed\.guardedLocalMutationEntrypoints\)\}[\s\S]*accountingCases=\$\{nonNegativeIntegerField\(parsed\.fullRangeAccountingCases\)\}[\s\S]*proportionalCases=\$\{nonNegativeIntegerField\(parsed\.fullRangeProportionalCases\)\}[\s\S]*assertionFailures=\$\{nonNegativeIntegerField\(parsed\.assertionFailures\)\}[\s\S]*protocolFeeFlushCases=\$\{nonNegativeIntegerField\(parsed\.protocolFeeFlushModelCases\)\}[\s\S]*protocolFeeFlushEntrypointCases=\$\{nonNegativeIntegerField\(parsed\.protocolFeeFlushEntrypointCases\)\}[\s\S]*duplicateBatchCases=\$\{nonNegativeIntegerField\(parsed\.duplicateBatchModelCases\)\}[\s\S]*packedBoundaryCases=\$\{nonNegativeIntegerField\(parsed\.packedBoundaryCases\)\}/,
    "prelaunch status summary must surface compact V10 invariant counters without raw invariant output",
  );
  assert.match(
    prelaunchStatusSource,
    /"idempotentUpsert" in parsed && "malformedPayloadFallback" in parsed[\s\S]*categories=\$\{nonNegativeIntegerField\(parsed\.categories\)\}[\s\S]*financialEventCategories=\$\{formatSafeCategoryList\(parsed\.financialEventCategories\)\}[\s\S]*depositScopeIsolation=\$\{parsed\.depositScopeIsolation === true\}[\s\S]*idempotentDepositUpsert=\$\{parsed\.idempotentDepositUpsert === true\}[\s\S]*resolverRewardScopeIsolation=\$\{parsed\.resolverRewardScopeIsolation === true\}[\s\S]*idempotentResolverRewardUpsert=\$\{parsed\.idempotentResolverRewardUpsert === true\}[\s\S]*dustSettlementScopeIsolation=\$\{parsed\.dustSettlementScopeIsolation === true\}[\s\S]*idempotentDustSettlementUpsert=\$\{parsed\.idempotentDustSettlementUpsert === true\}[\s\S]*singleRebateClaimParity=\$\{parsed\.singleRebateClaimParity === true\}[\s\S]*epochScopeIsolation=\$\{parsed\.epochScopeIsolation === true\}[\s\S]*idempotentEpochUpsert=\$\{parsed\.idempotentEpochUpsert === true\}[\s\S]*jackpotScopeIsolation=\$\{parsed\.jackpotScopeIsolation === true\}[\s\S]*idempotentJackpotUpsert=\$\{parsed\.idempotentJackpotUpsert === true\}[\s\S]*rewardClaimScopeIsolation=\$\{parsed\.rewardClaimScopeIsolation === true\}[\s\S]*idempotentRewardClaimUpsert=\$\{parsed\.idempotentRewardClaimUpsert === true\}[\s\S]*batchClaimKindParity=\$\{parsed\.batchClaimKindParity === true\}[\s\S]*dustSettlementKindParity=\$\{parsed\.dustSettlementKindParity === true\}[\s\S]*sameBlockEventOrdering=\$\{parsed\.sameBlockEventOrdering === true\}[\s\S]*normalizedEventIdRequiresTxLog=\$\{parsed\.normalizedEventIdRequiresTxLog === true\}[\s\S]*partialRpcLogFallback=\$\{parsed\.partialRpcLogFallback === true\}[\s\S]*malformedPayloadFallback=\$\{parsed\.malformedPayloadFallback === true\}[\s\S]*boundedEventStorage=\$\{parsed\.boundedEventStorage === true\}[\s\S]*limitedEventReads=\$\{parsed\.limitedEventReads === true\}[\s\S]*chainScopeIsolation=\$\{parsed\.chainScopeIsolation === true\}[\s\S]*normalizedEventScopeIsolation=\$\{parsed\.normalizedEventScopeIsolation === true\}[\s\S]*protocolFeeScopeIsolation=\$\{parsed\.protocolFeeScopeIsolation === true\}[\s\S]*idempotentBetUpsert=\$\{parsed\.idempotentBetUpsert === true\}[\s\S]*idempotentProtocolFeeUpsert=\$\{parsed\.idempotentProtocolFeeUpsert === true\}[\s\S]*assertionFailures=\$\{nonNegativeIntegerField\(parsed\.assertionFailures\)\}/,
    "prelaunch status summary must surface compact indexer storage status without raw assertion output",
  );
  assert.match(
    prelaunchStatusSource,
    /"sqliteOperations" in parsed && "backupIntegrity" in parsed[\s\S]*backupIntegrity=\$\{parsed\.backupIntegrity === true\}[\s\S]*retentionRemoved=\$\{nonNegativeIntegerField\(parsed\.retentionExpiredRemoved\)\}[\s\S]*futureSourceBackupRejected=\$\{parsed\.futureSourceBackupSummaryRejected === true\}[\s\S]*restoreUsesSuppliedBackup=\$\{parsed\.restoreUsesSuppliedBackupArtifact === true\}[\s\S]*corruptBackupRestoreRejected=\$\{parsed\.corruptBackupRestoreRejected === true\}[\s\S]*diskFullRejected=\$\{parsed\.diskFullRejected === true\}[\s\S]*assertionFailures=\$\{nonNegativeIntegerField\(parsed\.assertionFailures\)\}/,
    "prelaunch status summary must surface compact SQLite operations and future-timestamp rejection status without raw assertion output",
  );
  assert.match(
    prelaunchStatusSource,
    /"runtimeMonitoring" in parsed && "duplicateAlertsAfterRestart" in parsed[\s\S]*alerts=\$\{nonNegativeIntegerField\(parsed\.alerts\)\}[\s\S]*duplicateAfterRestart=\$\{nonNegativeIntegerField\(parsed\.duplicateAlertsAfterRestart\)\}[\s\S]*repoLocalBackupRejected=\$\{parsed\.repoLocalBackupDirRejected === true\}[\s\S]*localPathBaseUrlRejected=\$\{parsed\.localPathBaseUrlRejected === true\}[\s\S]*malformedNumericEnvRejected=\$\{parsed\.malformedNumericEnvRejected === true\}[\s\S]*assertionFailures=\$\{nonNegativeIntegerField\(parsed\.assertionFailures\)\}/,
    "prelaunch status summary must surface compact runtime monitoring status including local base URL rejection without raw alert output",
  );
  assert.match(
    prelaunchStatusSource,
    /"fetchTimeout" in parsed && "assertionFailures" in parsed[\s\S]*fetchTimeout=\$\{parsed\.fetchTimeout === true\}[\s\S]*assertionFailures=\$\{nonNegativeIntegerField\(parsed\.assertionFailures\)\}/,
    "prelaunch status summary must surface compact fetch-timeout status without raw assertion output",
  );
  assert.match(
    prelaunchStatusSource,
    /"storedNumberParsing" in parsed && "assertionFailures" in parsed[\s\S]*storedNumberParsing=\$\{parsed\.storedNumberParsing === true\}[\s\S]*assertionFailures=\$\{nonNegativeIntegerField\(parsed\.assertionFailures\)\}/,
    "prelaunch status summary must surface compact stored-number parsing status without raw assertion output",
  );
  assert.match(
    prelaunchStatusSource,
    /"businessLogic" in parsed && "assertionFailures" in parsed[\s\S]*businessLogic=\$\{parsed\.businessLogic === true\}[\s\S]*warnings=\$\{nonNegativeIntegerField\(parsed\.expectedWarnings\)\}[\s\S]*assertionFailures=\$\{nonNegativeIntegerField\(parsed\.assertionFailures\)\}/,
    "prelaunch status summary must surface compact business logic status without raw assertion output",
  );
  assert.match(
    prelaunchStatusSource,
    /"checks" in parsed && "failedIds" in parsed[\s\S]*appResolveEpochFiles[\s\S]*securityFollowupFields[\s\S]*hostAuth=\$\{parsed\.hostAuth === true\}[\s\S]*webLocks=\$\{parsed\.webLocks === true\}[\s\S]*keeperNonce=\$\{parsed\.keeperNonce === true\}[\s\S]*keeperBotReceipts=\$\{parsed\.keeperBotReceipts === true\}[\s\S]*depositLimiter=\$\{parsed\.depositLimiter === true\}[\s\S]*dryRunDefaults=\$\{parsed\.dryRunDefaults === true\}[\s\S]*ciSecurity=\$\{parsed\.ciSecurity === true\}[\s\S]*autoResolve=\$\{parsed\.autoResolve === true\}[\s\S]*checks=\$\{nonNegativeIntegerField\(parsed\.checks\)\}[\s\S]*passed=\$\{nonNegativeIntegerField\(parsed\.passed\)\}[\s\S]*failed=\$\{nonNegativeIntegerField\(parsed\.failed\)\}[\s\S]*failedIds=\$\{formatSafeTokenList\(parsed\.failedIds\)\}\$\{securityFollowupFields\}\$\{appResolveEpochFiles\}/,
    "prelaunch status summary must surface compact residual security follow-up status without raw proof output",
  );
  assert.match(
    prelaunchStatusSource,
    /function formatSafeCountMap\(value[\s\S]*\^\[a-z0-9-\]\{1,64\}\$[\s\S]*"compiled" in parsed && "proxy" in parsed && "warnings" in parsed[\s\S]*compiled=\$\{parsed\.compiled === true\}[\s\S]*proxy=\$\{parsed\.proxy === true\}[\s\S]*warnings=\$\{nonNegativeIntegerField\(parsed\.warnings\)\}[\s\S]*warningKinds=\$\{formatSafeTokenList\(parsed\.warningKinds\)\}[\s\S]*warningKindCounts=\$\{formatSafeCountMap\(parsed\.warningKindCounts\)\}[\s\S]*classifiedWarnings=\$\{nonNegativeIntegerField\(parsed\.classifiedWarnings\)\}[\s\S]*unclassifiedWarnings=\$\{nonNegativeIntegerField\(parsed\.unclassifiedWarnings\)\}[\s\S]*notices=\$\{nonNegativeIntegerField\(parsed\.notices\)\}[\s\S]*noticeKinds=\$\{formatSafeTokenList\(parsed\.noticeKinds\)\}/,
    "prelaunch status summary must surface compact production build warning coverage and notice status without raw Next output",
  );
  assert.match(
    prelaunchStatusSource,
    /function formatStatus\(value[\s\S]*formatSafeTokenList\(\[value\], fallback\)[\s\S]*function formatInfoToken\(value[\s\S]*0x\[a-fA-F0-9\]\{8,\}[\s\S]*function formatPackageVersion\(value\)[\s\S]*"privyWagmi" in parsed && "wagmi" in parsed && "viem" in parsed[\s\S]*privy=\$\{formatPackageVersion\(parsed\.privy\)\}[\s\S]*missing=\$\{formatSafeTokenList\(parsed\.missing\)\}/,
    "prelaunch status summary must preserve compact JSON wallet dependency versions and missing-package markers",
  );
  assert.doesNotMatch(
    prelaunchStatusSource,
    /status=\$\{parsed\.status\}|compiler=\$\{parsed\.compilerVersion|target=\$\{parsed\.target\}|source=\$\{parsed\.source\}|role=\$\{parsed\.role\}|mode=\$\{parsed\.mode\}|privy=\$\{parsed\.privy/,
    "prelaunch status summary must not print raw JSON status or metadata fields",
  );
  assert.match(
    prelaunchStatusSource,
    /"status" in parsed && "pid" in parsed[\s\S]*const issue = formatSafeTokenList\(\[parsed\.issue\], ""\);[\s\S]*const stop = parsed\.stopRequested === true \? ", stopRequested=true" : "";[\s\S]*pid=\$\{Number\.isSafeInteger\(parsed\.pid\) \? "present" : "none"\}\$\{issue \? `, issue=\$\{issue\}` : ""\}\$\{stop\}/,
    "prelaunch status summary must expose cleanup loop status, safe issue tokens, and cooperative stop state without printing local process ids",
  );
  assert.match(
    prelaunchStatusSource,
    /result\.error[\s\S]*process\.exitCode = 1/,
    "prelaunch status summary must not fail just because external launch evidence is missing",
  );
  assert.match(
    prelaunchStatusSource,
    /requiredLocalFailures[\s\S]*exitCode !== 0 && requiredLocal[\s\S]*required local status command\(s\) failed[\s\S]*process\.exitCode = 1/,
    "prelaunch status summary must fail on local V10/indexer regressions",
  );
  assert.match(
    prelaunchStatusSource,
    /const externalEvidenceIssues = \[\][\s\S]*still require\|requires external\|require external\|blocking launch evidence[\s\S]*const externalBlockers = \[\.\.\.new Set\(\[\.\.\.externalEvidenceIssues, \.\.\.launchBlocking\]\)\][\s\S]*required local checks passed; \$\{externalBlockers\.length\} external\/status command/,
    "prelaunch status summary must count external missing evidence from compact summaries without failing the local status command",
  );
  assert.match(
    prelaunchStatusSource,
    /function formatGroupSummary\(value\)[\s\S]*function formatIssueToken\(value\)[\s\S]*redactProofText\(value\)[\s\S]*"status" in parsed && typeof parsed\.issue === "string"[\s\S]*const status = formatSafeTokenList\(\[parsed\.status\], "unknown"\);[\s\S]*const groups = formatGroupSummary\(parsed\.groups\);[\s\S]*const issue = formatIssueToken\(parsed\.issue\);[\s\S]*status=\$\{status\}\$\{groups\}\$\{issue\}/,
    "prelaunch status summary must tokenize compact JSON failure issues and group counts",
  );
  assert.doesNotMatch(
    prelaunchStatusSource,
    /typeof parsed\.groups === "string"[\s\S]*parsed\.groups|issue=\$\{parsed\.issue\}|status=\$\{parsed\.status\}\$\{groups\}/,
    "prelaunch status summary must not print raw compact JSON issue or group strings",
  );
  assert.match(
    readFileSync("scripts/check-launch-gates.mjs", "utf8"),
    /\["G1", \["contractEnv", "chain ID", "deploy block", "token", "finality", "V10 protected bets flag", "existing saved artifacts"\]\]/,
    "launch gate structure must require G1 docs to keep the V10 protected-bet evidence marker",
  );
  assert.match(
    readFileSync("scripts/check-launch-gates.mjs", "utf8"),
    /\["G2", \["ownership\.directOwnerReadEvidence", "Safe\/multisig governance evidence", "proof tx", "existing saved artifacts"\]\]/,
    "launch gate structure must keep the G2 proof tx alternative aligned with signoff validation",
  );
  assert.match(
    readFileSync("scripts/check-launch-command-map.mjs", "utf8"),
    /ownership\.directOwnerReadEvidence[\s\S]*Safe\/multisig governance evidence[\s\S]*proof tx/,
    "launch command-map guard must keep the G2 proof tx alternative visible",
  );
  assert.match(
    readFileSync("scripts/check-launch-command-map.mjs", "utf8"),
    /function readText\(filePath\)[\s\S]*const stats = statSync\(filePath\)[\s\S]*!stats\.isFile\(\)[\s\S]*Required file must be a file/,
    "launch command-map guard must reject directory paths before reading package or docs files",
  );
  assert.match(
    readFileSync("scripts/check-launch-command-map.mjs", "utf8"),
    /Privy allowed origins[\s\S]*redacted production Privy App ID configured proof[\s\S]*wrong network/,
    "launch command-map guard must require the production Privy App ID proof marker",
  );
  assert.match(
    readFileSync("scripts/check-launch-command-map.mjs", "utf8"),
    /fresh Codex Security scan report or sealed scan artifact[\s\S]*no open High\/Medium local findings[\s\S]*proof:security-followup:summary/,
    "launch command-map guard must require final security scan evidence while preserving the local follow-up boundary",
  );
  for (const monitoringGateScript of ["scripts/check-launch-gates.mjs", "scripts/report-launch-remaining.mjs"]) {
    assert.match(
      readFileSync(monitoringGateScript, "utf8"),
      /G9[\s\S]*verified email alert target/,
      `${monitoringGateScript} must keep the verified email alert target visible in the monitoring launch gate`,
    );
  }
  for (const launchGateScript of ["scripts/check-launch-gates.mjs", "scripts/report-launch-remaining.mjs"]) {
    assert.match(
      readFileSync(launchGateScript, "utf8"),
      /function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*function localArtifactExists\(relativePath\)[\s\S]*regularFileStat\(absolutePath\) !== null/,
      `${launchGateScript} must treat local proof artifacts as present only when they are regular files`,
    );
    assert.match(
      readFileSync(launchGateScript, "utf8"),
      /G14[\s\S]*final security scan[\s\S]*no open High\/Medium local findings/,
      `${launchGateScript} must keep the final security scan blocker visible in G14`,
    );
  }
  assert.match(
    readFileSync("scripts/check-launch-gates.mjs", "utf8"),
    /MAX_LAUNCH_GATE_MARKDOWN_BYTES = 1024 \* 1024[\s\S]*function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*function readMarkdown\(filePath\)[\s\S]*const stats = regularFileStat\(filePath\)[\s\S]*stats\.size > MAX_LAUNCH_GATE_MARKDOWN_BYTES[\s\S]*too large to validate safely[\s\S]*readFileSync\(filePath, "utf8"\)/,
    "launch gate verifier must size-gate proof and status board markdown before reading it",
  );
  const remainingLaunchSource = readFileSync("scripts/report-launch-remaining.mjs", "utf8");
  assert.match(
    remainingLaunchSource,
    /function safeToken\(value\)[\s\S]*replace\(\/\[\^a-z0-9\]\+\/g, "-"\)[\s\S]*function formatNextMarkerTokens\(gateId\)[\s\S]*requiredProofMarkerExpectations\.get\(gateId\)[\s\S]*Next marker tokens: \$\{formatNextMarkerTokens\(nextGate\.id\)\}/,
    "remaining launch summary must surface safe next-gate marker tokens without dumping proof tables",
  );
  assert.match(
    remainingLaunchSource,
    /const gateActions = rows\.map\(buildGateAction\)[\s\S]*const nextGateAction = nextGate[\s\S]*\.\.\.gateActions\[0\][\s\S]*autonomousBoundary[\s\S]*autonomousNextCheck[\s\S]*transactionBoundary[\s\S]*transactionPreviewChecks[\s\S]*transactionConsentRequirement[\s\S]*nextGateAction,[\s\S]*gateActions,/,
    "remaining launch JSON must expose safe next-gate, all-gate, and pre-transaction consent action objects for automation handoff",
  );
  assert.match(
    readFileSync("scripts/check-launch-command-map.mjs", "utf8"),
    /verified email alert target/,
    "launch command-map guard must require the verified email alert target evidence marker",
  );
  assert.match(
    readFileSync("scripts/check-launch-command-map.mjs", "utf8"),
    /backup schedule[\s\S]*retentionDays[\s\S]*lastSuccessfulBackupAt[\s\S]*docs\/restore-drill\.log/,
    "launch command-map guard must require restore retention and latest successful backup evidence markers",
  );
  for (const hostGateScript of ["scripts/check-launch-gates.mjs", "scripts/report-launch-remaining.mjs"]) {
    assert.match(
      readFileSync(hostGateScript, "utf8"),
      /G6[\s\S]*externalRateLimit[\s\S]*webReplicaCount[\s\S]*sharedBucketVerified[\s\S]*failClosed/,
      `${hostGateScript} must keep two-replica external rate-limit markers visible in the production host gate`,
    );
  }
  assert.match(
    readFileSync("scripts/check-launch-command-map.mjs", "utf8"),
    /externalRateLimit[\s\S]*webReplicaCount[\s\S]*sharedBucketVerified[\s\S]*failClosed/,
    "launch command-map guard must require two-replica external rate-limit evidence markers",
  );
  for (const indexerGateScript of ["scripts/check-launch-gates.mjs", "scripts/report-launch-remaining.mjs"]) {
    assert.match(
      readFileSync(indexerGateScript, "utf8"),
      /G7[\s\S]*fresh external DB[\s\S]*INDEXER_FINALITY_BLOCKS[\s\S]*chainSnapshot[\s\S]*rpcChainId[\s\S]*contractAddress[\s\S]*finalityLagBlocks[\s\S]*chainComparison/,
      `${indexerGateScript} must keep fresh DB, chain snapshot, finality, and comparison markers visible in the indexer gate`,
    );
  }
  assert.match(
    readFileSync("scripts/check-launch-command-map.mjs", "utf8"),
    /fresh external DB[\s\S]*chainSnapshot[\s\S]*rpcChainId[\s\S]*contractAddress[\s\S]*finalityLagBlocks[\s\S]*INDEXER_FINALITY_BLOCKS/,
    "launch command-map guard must require chain snapshot and finality markers for indexer proof",
  );
  assert.ok(
    collectMainnetProofSource.includes('host.includes(".")') &&
      /function isFinalHttpsOrigin[\s\S]*!url\.username[\s\S]*!url\.password[\s\S]*\.example[\s\S]*192\\.168/.test(collectMainnetProofSource),
    "mainnet proof must reject credentialed, single-label, local, private, reserved, example, and test origins",
  );
  for (const originPolicyScript of [
    "scripts/collect-proof-common.mjs",
    "scripts/check-host-proof.mjs",
    "scripts/check-monitoring-proof.mjs",
    "scripts/check-qa-proof.mjs",
    "scripts/create-host-proof-draft.mjs",
    "scripts/create-monitoring-proof-draft.mjs",
    "scripts/create-monitoring-test-plan.mjs",
    "scripts/create-qa-canary-test-plan.mjs",
    "scripts/create-qa-proof-draft.mjs",
    "scripts/create-restore-proof-draft.mjs",
    "scripts/verify-db-restore.mjs",
  ]) {
    const originPolicySource = readFileSync(originPolicyScript, "utf8");
    assert.ok(
      originPolicySource.includes('host.includes(".")'),
      `${originPolicyScript} must reject single-label launch origins`,
    );
    assert.match(
      originPolicySource,
      /!url\.username[\s\S]*!url\.password/,
      `${originPolicyScript} must reject credentialed launch origins`,
    );
    assert.match(
      originPolicySource,
      /100\\\.[\s\S]*169\\\.254[\s\S]*198\\\.51\\\.100[\s\S]*203\\\.0\\\.113[\s\S]*2001:db8/,
      `${originPolicyScript} must reject reserved and documentation launch origins`,
    );
  }
  for (const originNormalizerScript of [
    "scripts/check-qa-proof.mjs",
    "scripts/collect-host-evidence.mjs",
    "scripts/collect-indexer-evidence.mjs",
    "scripts/collect-restore-evidence.mjs",
    "scripts/create-host-proof-draft.mjs",
    "scripts/create-indexer-proof-draft.mjs",
    "scripts/create-restore-proof-draft.mjs",
    "scripts/verify-db-restore.mjs",
  ]) {
    const originNormalizerSource = readFileSync(originNormalizerScript, "utf8");
    assert.match(
      originNormalizerSource,
      /function normaliz(?:e|ed)Origin[\s\S]*url\.username \|\| url\.password[\s\S]*return ""/,
      `${originNormalizerScript} must not normalize credentialed evidence URLs to a clean launch origin`,
    );
  }
  assert.equal(
    monitoringPackageScripts["proof:host:summary"],
    "node scripts/check-host-proof.mjs --summary-only",
    "host proof must expose a compact summary command for routine operator checks",
  );
  const hostProofSummarySource = readFileSync("scripts/check-host-proof.mjs", "utf8");
  assert.match(
    hostProofSummarySource,
    /const summaryOnly = process\.argv\.includes\("--summary-only"\)/,
    "host proof must support compact output without changing validation",
  );
  assert.match(
    hostProofSummarySource,
    /function hasNonFutureIsoTimestamp[\s\S]*Date\.now\(\) \+ 5 \* 60 \* 1000[\s\S]*processModel\.\$\{name\}\.checkedAt must not be in the future[\s\S]*persistentDb\.checkedAt must not be in the future[\s\S]*healthProd\.timestamp must not be in the future[\s\S]*loadHttp\.timestamp must not be in the future[\s\S]*externalRateLimit\.checkedAt must not be in the future/,
    "host proof validation must reject future-dated process, DB, health, load, and rate-limit timestamps",
  );
  assert.ok(
    hostProofSummarySource.includes("summaryOnly ? fileSummaryStatus(manifestPath) : manifestPath") &&
      /function regularFileStat\(filePath\)[\s\S]*const stats = statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*function fileSummaryStatus\(filePath\)[\s\S]*regularFileStat\(filePath\) \? "present" : "missing"/.test(hostProofSummarySource),
    "host proof summary output must avoid printing the absolute manifest path and must only mark files as present",
  );
  assert.match(
    hostProofSummarySource,
    /const hostLaunchGates = \["G5", "G6"\][\s\S]*const hostLaunchGateGroups = "host=2"[\s\S]*function launchGateSummary\(issueCount\)[\s\S]*blocked[\s\S]*covered[\s\S]*launchGateSummary\(issues\.length\)/,
    "host proof summary must identify the blocked or covered launch gates without printing manifest paths",
  );
  assert.match(
    hostProofSummarySource,
    /function formatMissingLocalArtifactRefs\(findings\)[\s\S]*summaryOnly \? findings\.map\(\(entry\) => entry\.split\(" -> "\)\[0\]\)[\s\S]*formatMissingLocalArtifactRefs\(missingArtifactRefs\)/,
    "host proof summary output must avoid printing raw local artifact paths for missing references",
  );
  assert.equal(
    monitoringPackageScripts["proof:signoff:summary"],
    "node scripts/check-signoff-proof.mjs --summary-only",
    "signoff proof must expose a compact summary command for routine operator checks",
  );
  const signoffProofSummarySource = readFileSync("scripts/check-signoff-proof.mjs", "utf8");
  assert.match(
    signoffProofSummarySource,
    /const summaryOnly = process\.argv\.includes\("--summary-only"\)/,
    "signoff proof must support compact output without changing validation",
  );
  assert.match(
    signoffProofSummarySource,
    /function hasNonFutureIsoTimestamp[\s\S]*Date\.now\(\) \+ 5 \* 60 \* 1000[\s\S]*contractEnv\.checkedAt must not be in the future[\s\S]*ownership\.checkedAt must not be in the future[\s\S]*randomness\.signedAt must not be in the future[\s\S]*chainComparison\.\$\{check\}\.checkedAt must not be in the future/,
    "signoff proof validation must reject future-dated contract, ownership, randomness, and chain comparison timestamps",
  );
  assert.ok(
    signoffProofSummarySource.includes("summaryOnly ? fileSummaryStatus(manifestPath) : manifestPath") &&
      /function regularFileStat\(filePath\)[\s\S]*const stats = statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*function fileSummaryStatus\(filePath\)[\s\S]*regularFileStat\(filePath\) \? "present" : "missing"/.test(signoffProofSummarySource),
    "signoff proof summary output must avoid printing the absolute manifest path and must only mark files as present",
  );
  assert.match(
    signoffProofSummarySource,
    /const signoffLaunchGates = \["G1", "G2", "G3", "G4"\][\s\S]*const signoffLaunchGateGroups = "chain=1, env=1, signoff=2"[\s\S]*function launchGateSummary\(issueCount\)[\s\S]*blocked[\s\S]*covered[\s\S]*launchGateSummary\(issues\.length\)/,
    "signoff proof summary must identify the blocked or covered launch gates without printing manifest paths",
  );
  assert.match(
    signoffProofSummarySource,
    /function formatMissingLocalArtifactRefs\(findings\)[\s\S]*summaryOnly \? findings\.map\(\(entry\) => entry\.split\(" -> "\)\[0\]\)[\s\S]*formatMissingLocalArtifactRefs\(missingArtifactRefs\)/,
    "signoff proof summary output must avoid printing raw local artifact paths for missing references",
  );
  assert.match(
    signoffProofSummarySource,
    /MAX_SIGNOFF_ARTIFACT_TEXT_BYTES = 256 \* 1024[\s\S]*function readBoundedArtifactText\(resolved\)[\s\S]*openSync\(resolved, "r"\)[\s\S]*readSync\(fd, buffer, 0, buffer\.length, 0\)[\s\S]*closeSync\(fd\)[\s\S]*localArtifactContentFromText\(value, key = ""\)[\s\S]*readBoundedArtifactText\(resolve\(process\.cwd\(\), artifactPath\)\)/,
    "signoff proof must read bounded local artifact snippets instead of whole evidence files",
  );
  assert.doesNotMatch(
    signoffProofSummarySource,
    /readFileSync\(resolve\(process\.cwd\(\), artifactPath\),\s*"utf8"\)\.slice/,
    "signoff proof must not read whole local artifacts before slicing snippets",
  );
  assert.match(
    signoffProofSummarySource,
    /MAX_SIGNOFF_PROOF_MANIFEST_BYTES = 512 \* 1024[\s\S]*const manifestStat = regularFileStat\(manifestPath\)[\s\S]*!manifestStat[\s\S]*sign-off proof manifest must be a file[\s\S]*manifestStat\.size > MAX_SIGNOFF_PROOF_MANIFEST_BYTES[\s\S]*sign-off proof manifest is too large to validate safely[\s\S]*JSON\.parse\(readFileSync\(manifestPath, "utf8"\)\)/,
    "signoff proof must size-gate proof manifests before parsing JSON",
  );
  assert.match(
    signoffProofSummarySource,
    /function comparisonDirectChainProof[\s\S]*direct\[-\\s\]\?chain[\s\S]*proof:chain[\s\S]*chain\\s\+read[\s\S]*on\[-\\s\]\?chain/,
    "signoff chain comparison must independently validate direct-chain/on-chain evidence",
  );
  assert.match(
    signoffProofSummarySource,
    /function comparisonAppOrIndexerProof[\s\S]*app[\s\S]*indexer[\s\S]*api[\s\S]*ui[\s\S]*chain comparison/,
    "signoff chain comparison must independently validate app/indexer evidence",
  );
  assert.match(
    signoffProofSummarySource,
    /function sharedSignoffSectionArtifactIssues\(manifest\)[\s\S]*normalizedArtifactPathSet[\s\S]*signoff evidence sections must use distinct local artifact files across/,
    "signoff proof validation must reject one artifact reused across contract, ownership, randomness, and chain-comparison sections",
  );
  assert.match(
    signoffProofSummarySource,
    /CANONICAL_POSITIVE_INTEGER_RE = \/\^\[1-9\]\\d\{0,15\}\$\/[\s\S]*CANONICAL_NON_NEGATIVE_INTEGER_RE = \/\^\(\?:0\|\[1-9\]\\d\{0,15\}\)\$\/[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function isPositiveIntegerString\(value\)[\s\S]*parsePositiveInteger\(value\) !== null[\s\S]*function parsePositiveInteger\(value\)[\s\S]*CANONICAL_POSITIVE_INTEGER_RE\.test\(normalized\)[\s\S]*const parsed = BigInt\(normalized\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*function parseNonNegativeInteger\(value\)[\s\S]*CANONICAL_NON_NEGATIVE_INTEGER_RE\.test\(normalized\)[\s\S]*const parsed = BigInt\(normalized\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*function nonEmptyEpochList\(value\)[\s\S]*parseNonNegativeInteger\(entry\) !== null/,
    "signoff proof validation must BigInt-bound deploy/finality blocks and checked epoch evidence",
  );
  assert.doesNotMatch(
    signoffProofSummarySource,
    /function isPositiveIntegerString\(value\)[\s\S]*return typeof value === "string" && \/\^\[1-9\]\\d\*\$\/\.test\(value\)|function nonEmptyEpochList\(value\)[\s\S]*\^\\d\+\$/,
    "signoff proof validation must not return to regex-only deploy/finality or checked epoch validation",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /signoffUnsafeCheckedEpochManifest[\s\S]*9999999999999999[\s\S]*signoff-unsafe-checked-epoch[\s\S]*chainComparison\.jackpot\.checkedEpochs must include at least one checked epoch/,
    "proof draft regression suite must reject unsafe signoff checkedEpochs evidence",
  );
  const signoffDraftDistinctSource = readFileSync("scripts/create-signoff-proof-draft.mjs", "utf8");
  const signoffCollectorDistinctSource = readFileSync("scripts/collect-signoff-evidence.mjs", "utf8");
  assert.match(
    signoffDraftDistinctSource,
    /function requireDistinctArtifactInputs\(entries\)[\s\S]*--\$\{leftName\} and --\$\{rightName\} must point to distinct signoff evidence files/,
    "signoff proof draft generation must reject one artifact reused across signoff evidence inputs",
  );
  assert.match(
    signoffCollectorDistinctSource,
    /function requireDistinctArtifactInputs\(entries\)[\s\S]*--\$\{leftName\} and --\$\{rightName\} must point to distinct signoff evidence files/,
    "signoff proof collector must reject one artifact reused across signoff evidence inputs",
  );
  assert.equal(
    monitoringPackageScripts["proof:indexer:summary"],
    "node scripts/check-indexer-dry-run.mjs --summary-only",
    "indexer proof must expose a compact summary command for routine operator checks",
  );
  const indexerProofSummarySource = readFileSync("scripts/check-indexer-dry-run.mjs", "utf8");
  assert.match(
    indexerProofSummarySource,
    /const summaryOnly = process\.argv\.includes\("--summary-only"\)/,
    "indexer proof must support compact output without changing validation",
  );
  assert.match(
    indexerProofSummarySource,
    /function hasNonFutureIsoTimestamp[\s\S]*Date\.now\(\) \+ 5 \* 60 \* 1000[\s\S]*dryRun\.timestamp must not be in the future[\s\S]*finality\.checkedAt must not be in the future[\s\S]*chainSnapshot\.checkedAt must not be in the future[\s\S]*chainComparison\.\$\{key\}\.checkedAt must not be in the future/,
    "indexer proof validation must reject future-dated dry-run, finality, chain snapshot, and chain comparison timestamps",
  );
  assert.match(
    indexerProofSummarySource,
    /CANONICAL_NON_NEGATIVE_INTEGER_RE[\s\S]*function parseCanonicalNonNegativeInteger[\s\S]*function parseCanonicalPositiveInteger[\s\S]*startBlockParsed = parseCanonicalNonNegativeInteger\(startBlock\)[\s\S]*publicDeployBlockParsed = parseCanonicalNonNegativeInteger\(publicDeployBlock\)[\s\S]*finalityBlocksParsed = parseCanonicalPositiveInteger\(finalityBlocks\)[\s\S]*INDEXER_DRY_RUN_MIN_SCOPED_EPOCHS\/--min-scoped-epochs must be a canonical non-negative decimal integer[\s\S]*INDEXER_DRY_RUN_MIN_SCOPED_BETS\/--min-scoped-bets must be a canonical non-negative decimal integer/,
    "indexer dry-run proof must strictly parse deploy/start/finality env and scoped row threshold values before DB validation",
  );
  assert.match(
    indexerProofSummarySource,
    /function isNonNegativeInteger\(value\)[\s\S]*parseCanonicalNonNegativeInteger\(value\) !== null[\s\S]*function isPositiveInteger\(value\)[\s\S]*parseCanonicalPositiveInteger\(value\) !== null[\s\S]*function integerString\(value\)[\s\S]*parseCanonicalNonNegativeInteger\(value\) !== null[\s\S]*function nonEmptyEpochList\(value\)[\s\S]*parseCanonicalNonNegativeInteger\(entry\) !== null/,
    "indexer dry-run proof manifest helpers must delegate to canonical safe integer parsers",
  );
  assert.match(
    indexerProofSummarySource,
    /function hasNumericFinalityLagEvidence[\s\S]*parseCanonicalNonNegativeInteger\(match\[1\]\) !== null/,
    "indexer dry-run proof must strictly parse finalityLagBlocks evidence markers",
  );
  assert.match(
    indexerProofSummarySource,
    /function readCount\(db, table\)[\s\S]*SELECT COUNT\(\*\) AS count[\s\S]*return parseCanonicalNonNegativeInteger\(row\?\.count\)/,
    "indexer proof must canonical-parse SQLite COUNT evidence before using row totals",
  );
  assert.match(
    indexerProofSummarySource,
    /function localArtifactFinalityEvidenceHasSafeLag\(value\)[\s\S]*textHasProductionBaseAndSafeFinality\(content\)[\s\S]*finality evidence artifact must include health:prod base and canonical non-negative decimal finalityLagBlocks/,
    "indexer dry-run proof must canonical-parse local health artifact finality markers",
  );
  assert.match(
    indexerProofSummarySource,
    /MAX_INDEXER_ARTIFACT_TEXT_BYTES = 256 \* 1024[\s\S]*function readBoundedArtifactText\(resolved\)[\s\S]*openSync\(resolved, "r"\)[\s\S]*readSync\(fd, buffer, 0, buffer\.length, 0\)[\s\S]*closeSync\(fd\)[\s\S]*localArtifactContentFromText\(value, key = ""\)[\s\S]*readBoundedArtifactText\(resolve\(process\.cwd\(\), artifactPath\)\)[\s\S]*hasProductionHealthBaseEvidence\(value\)[\s\S]*readBoundedArtifactText\(absolute\)/,
    "indexer proof must read bounded local artifact snippets instead of whole evidence files",
  );
  assert.doesNotMatch(
    indexerProofSummarySource,
    /readFileSync\((?:resolve\(process\.cwd\(\), artifactPath\)|absolute),\s*"utf8"\)\.slice/,
    "indexer proof must not read whole local artifacts before slicing snippets",
  );
  assert.match(
    indexerProofSummarySource,
    /MAX_INDEXER_PROOF_MANIFEST_BYTES = 512 \* 1024[\s\S]*const manifestStat = statSync\(resolvedManifestPath\)[\s\S]*manifestStat\.size > MAX_INDEXER_PROOF_MANIFEST_BYTES[\s\S]*indexer proof manifest is too large to validate safely[\s\S]*JSON\.parse\(readFileSync\(resolvedManifestPath, "utf8"\)\)/,
    "indexer proof must size-gate proof manifests before parsing JSON",
  );
  assert.match(
    indexerProofSummarySource,
    /function textHasProductionBaseAndSafeFinality\(text\)[\s\S]*basePattern\.exec\(content\)[\s\S]*normalizedOrigin\(baseMatch\[1\]\) === expected[\s\S]*finalityLagBlocks=\(\[\^\\s\]\+\)/,
    "indexer dry-run proof must scan health base URL evidence without materializing match arrays",
  );
  assert.doesNotMatch(
    indexerProofSummarySource,
    /\[\.\.\.content\.matchAll/,
    "indexer dry-run proof must not spread local health evidence matchAll output into arrays",
  );
  assert.doesNotMatch(
    indexerProofSummarySource,
    /Number\(env\("INDEXER_DRY_RUN_MIN_SCOPED_EPOCHS"\)|Number\(env\("INDEXER_DRY_RUN_MIN_SCOPED_BETS"\)|isNonNegativeInteger\(startBlock\)|isNonNegativeInteger\(publicDeployBlock\)|isPositiveInteger\(finalityBlocks\)|Number\.isFinite\(Number\(match\[1\]\)\)|Number\(row\?\.count \?\? 0\)|function integerString\(value\)[\s\S]*\^\\d\+\$|function nonEmptyEpochList\(value\)[\s\S]*\^\\d\+\$/,
    "indexer dry-run proof must not use broad numeric fallback or regex-only manifest integer validation",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /indexerUnsafeCheckedEpochManifest[\s\S]*9999999999999999[\s\S]*indexer-unsafe-checked-epoch[\s\S]*chainComparison\.jackpot\.checkedEpochs must include at least one checked epoch/,
    "proof draft regression suite must reject unsafe indexer checkedEpochs evidence",
  );
  assert.match(
    indexerProofSummarySource,
    /summaryOnly \? \(fileExists\(resolve\(repoRoot, manifestPath\)\) \? "present" : "missing"\) : resolve\(repoRoot, manifestPath\)/,
    "indexer proof summary output must avoid printing the absolute manifest path and must only mark files as present",
  );
  assert.match(
    indexerProofSummarySource,
    /summaryOnly \? \(sourceRaw && fileExists\(source\.absolute\) \? "present" : "missing"\) : \(sourceRaw \? source\.absolute : "missing"\)/,
    "indexer proof summary output must avoid printing the absolute DB path and must only mark files as present",
  );
  assert.match(
    indexerProofSummarySource,
    /if \(summaryOnly\) \{[\s\S]*## DB Summary[\s\S]*\["meta rows", String\(inspected\.metaRows\.length\)\][\s\S]*\} else \{[\s\S]*## Row Counts[\s\S]*## Relevant Meta/,
    "indexer proof summary output must avoid detailed row-count and meta tables",
  );
  assert.match(
    indexerProofSummarySource,
    /const indexerLaunchGates = \["G7"\][\s\S]*const indexerLaunchGateGroups = "indexer=1"[\s\S]*function launchGateSummary\(issueCount\)[\s\S]*blocked[\s\S]*covered[\s\S]*launchGateSummary\(issues\.length\)/,
    "indexer proof summary must identify the blocked or covered launch gate without printing DB or manifest paths",
  );
  assert.match(
    indexerProofSummarySource,
    /function formatMissingLocalArtifactRefs\(findings\)[\s\S]*summaryOnly \? findings\.map\(\(entry\) => entry\.split\(" -> "\)\[0\]\)[\s\S]*formatMissingLocalArtifactRefs\(missingArtifactRefs\)/,
    "indexer proof summary output must avoid printing raw local artifact paths for missing references",
  );
  assert.equal(
    monitoringPackageScripts["proof:qa:summary"],
    "node scripts/check-qa-proof.mjs --summary-only",
    "QA proof must expose a compact summary command for routine operator checks",
  );
  const qaProofSummarySource = readFileSync("scripts/check-qa-proof.mjs", "utf8");
  assert.match(
    qaProofSummarySource,
    /const summaryOnly = process\.argv\.includes\("--summary-only"\)/,
    "QA proof must support compact output without changing validation",
  );
  assert.ok(
    qaProofSummarySource.includes("summaryOnly ? fileSummaryStatus(manifestPath) : manifestPath") &&
      /function regularFileStat\(filePath\)[\s\S]*const stats = statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*function fileSummaryStatus\(filePath\)[\s\S]*regularFileStat\(filePath\) \? "present" : "missing"/.test(qaProofSummarySource),
    "QA proof summary output must avoid printing the absolute manifest path and must only mark files as present",
  );
  assert.match(
    qaProofSummarySource,
    /if \(summaryOnly\) \{[\s\S]*\["Group", "Checks"\][\s\S]*\} else \{[\s\S]*\["Group", "Check", "Status OK", "Evidence"\]/,
    "QA proof summary output must avoid the detailed wallet and UX evidence table",
  );
  assert.match(
    qaProofSummarySource,
    /function formatMissingLocalArtifactRefs\(findings\)[\s\S]*summaryOnly \? findings\.map\(\(entry\) => entry\.split\(" -> "\)\[0\]\)[\s\S]*formatMissingLocalArtifactRefs\(missingArtifactRefs\)/,
    "QA proof summary output must avoid printing raw local artifact paths for missing references",
  );
  assert.match(
    qaProofSummarySource,
    /MAX_QA_ARTIFACT_TEXT_BYTES = 256 \* 1024[\s\S]*function readBoundedArtifactText\(resolved\)[\s\S]*openSync\(resolved, "r"\)[\s\S]*readSync\(fd, buffer, 0, buffer\.length, 0\)[\s\S]*closeSync\(fd\)[\s\S]*artifactBackedEvidenceText\(check\)[\s\S]*readBoundedArtifactText\(resolved\)[\s\S]*receiptEvidenceText\(check\)[\s\S]*readBoundedArtifactText\(resolved\)/,
    "QA proof must read bounded local artifact snippets for wallet, UX, browser, and receipt evidence",
  );
  assert.doesNotMatch(
    qaProofSummarySource,
    /readFileSync\(resolved,\s*"utf8"\)\.slice/,
    "QA proof must not read whole local artifacts before slicing snippets",
  );
  assert.match(
    qaProofSummarySource,
    /MAX_QA_PROOF_MANIFEST_BYTES = 512 \* 1024[\s\S]*const manifestStat = regularFileStat\(manifestPath\)[\s\S]*!manifestStat[\s\S]*QA proof manifest must be a file[\s\S]*manifestStat\.size > MAX_QA_PROOF_MANIFEST_BYTES[\s\S]*QA proof manifest is too large to validate safely[\s\S]*JSON\.parse\(readFileSync\(manifestPath, "utf8"\)\)/,
    "QA proof must size-gate proof manifests before parsing JSON",
  );
  assert.match(
    qaProofSummarySource,
    /const qaLaunchGates = \["G12", "G13", "G14"\][\s\S]*const qaLaunchGateGroups = "qa=3"[\s\S]*function launchGateSummary\(issueCount\)[\s\S]*blocked[\s\S]*covered[\s\S]*launchGateSummary\(issues\.length\)/,
    "QA proof summary must identify the blocked or covered G12-G14 launch gates without printing wallet or UX evidence",
  );
  assert.match(
    qaProofSummarySource,
    /function hasNonFutureIsoTimestamp\(value\)[\s\S]*Date\.now\(\) \+ 5 \* 60 \* 1000[\s\S]*checkedAt must not be in the future[\s\S]*finalQa\.browserSmokeDebugAutominer\.checkedAt must not be in the future[\s\S]*wallet\.privyAllowedOrigins\.checkedAt must not be in the future/,
    "QA proof must reject future-dated wallet, UX, browser, and Privy evidence timestamps",
  );
  assert.equal(
    monitoringPackageScripts["proof:monitoring:summary"],
    "node scripts/check-monitoring-proof.mjs --summary-only",
    "monitoring proof must expose a compact summary command for routine operator checks",
  );
  const monitoringProofSource = readFileSync("scripts/check-monitoring-proof.mjs", "utf8");
  assert.match(
    monitoringProofSource,
    /const summaryOnly = process\.argv\.includes\("--summary-only"\)/,
    "monitoring proof must support compact output without changing validation",
  );
  assert.ok(
    monitoringProofSource.includes("summaryOnly ? fileSummaryStatus(manifestPath) : manifestPath") &&
      /function regularFileStat\(filePath\)[\s\S]*const stats = statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*function fileSummaryStatus\(filePath\)[\s\S]*regularFileStat\(filePath\) \? "present" : "missing"/.test(monitoringProofSource),
    "monitoring summary output must avoid printing the absolute manifest path and must only mark files as present",
  );
  assert.match(
    monitoringProofSource,
    /if \(summaryOnly\) \{[\s\S]*Monitors:[\s\S]*Alert targets:[\s\S]*Error tracking:[\s\S]*\} else \{/,
    "monitoring summary output must avoid detailed provider and evidence tables",
  );
  assert.match(
    monitoringProofSource,
    /function formatMissingLocalArtifactRefs\(findings\)[\s\S]*summaryOnly \? findings\.map\(\(entry\) => entry\.split\(" -> "\)\[0\]\)[\s\S]*formatMissingLocalArtifactRefs\(missingArtifactRefs\)/,
    "monitoring proof summary output must avoid printing raw local artifact paths for missing references",
  );
  assert.match(
    monitoringProofSource,
    /MAX_MONITORING_ARTIFACT_TEXT_BYTES = 256 \* 1024[\s\S]*function readBoundedArtifactText\(resolved\)[\s\S]*openSync\(resolved, "r"\)[\s\S]*readSync\(fd, buffer, 0, buffer\.length, 0\)[\s\S]*closeSync\(fd\)[\s\S]*readBoundedArtifactText\(resolved\)/,
    "monitoring proof must read bounded local artifact snippets instead of whole evidence files",
  );
  assert.doesNotMatch(
    monitoringProofSource,
    /readFileSync\(resolved,\s*"utf8"\)\.slice/,
    "monitoring proof must not read whole local artifacts before slicing snippets",
  );
  assert.match(
    monitoringProofSource,
    /MAX_MONITORING_PROOF_MANIFEST_BYTES = 512 \* 1024[\s\S]*const manifestStat = regularFileStat\(manifestPath\)[\s\S]*!manifestStat[\s\S]*monitoring proof manifest must be a file[\s\S]*manifestStat\.size > MAX_MONITORING_PROOF_MANIFEST_BYTES[\s\S]*monitoring proof manifest is too large to validate safely[\s\S]*JSON\.parse\(readFileSync\(manifestPath, "utf8"\)\)/,
    "monitoring proof must size-gate proof manifests before parsing JSON",
  );
  assert.match(
    monitoringProofSource,
    /const monitoringLaunchGates = \["G9"\][\s\S]*const monitoringLaunchGateGroups = "monitoring=1"[\s\S]*function launchGateSummary\(issueCount\)[\s\S]*blocked[\s\S]*covered[\s\S]*launchGateSummary\(issues\.length\)/,
    "monitoring proof summary must identify the blocked or covered launch gate without printing provider evidence",
  );
  assert.match(
    monitoringProofSource,
    /function verifiedEmailAlertTarget\(target, manifest\)[\s\S]*kind[\s\S]*email[\s\S]*verified === true[\s\S]*alertTargetEvidence[\s\S]*emailAlertTargetProof[\s\S]*emailAlertTargetSenderDomainProof\(target, manifest\)/,
    "monitoring proof must require a verified email-specific alert target with sender-domain proof for launch evidence",
  );
  assert.match(
    monitoringProofSource,
    /function emailAlertTargetRecipientProof[\s\S]*target\.recipient[\s\S]*target\.email[\s\S]*target\.recipients[\s\S]*\+@\[A-Z0-9\.-\]/,
    "monitoring proof must require explicit email recipient evidence for launch alerting",
  );
  assert.match(
    monitoringProofSource,
    /function emailAlertTargetProof[\s\S]*email\|resend\|recipient\|inbox\|message\[-\\s\]\?id\|delivered\|delivery/,
    "monitoring proof must not accept generic non-email alert target evidence as email delivery proof",
  );
  assert.ok(
    /function emailAlertTargetSenderDomainProof\(target, manifest\)[\s\S]*originEmailDomains\(manifest\)[\s\S]*target\.sender[\s\S]*target\.from[\s\S]*target\.senderDomain/.test(monitoringProofSource) &&
      monitoringProofSource.includes("verified\\\\s+domain") &&
      monitoringProofSource.includes("domain\\\\s+verified"),
    "monitoring proof must bind verified email sender or sender domain evidence to the proof origin",
  );
  assert.match(
    monitoringProofSource,
    /function sharedLocalArtifactPaths[\s\S]*normalizedArtifactPathSet[\s\S]*fired-alert and recovery evidence must use distinct artifact files/,
    "monitoring proof must reject using the same local artifact for fired-alert and recovery evidence",
  );
  assert.match(
    monitoringProofSource,
    /function sharedMonitoringSectionArtifactIssues\(manifest\)[\s\S]*monitors[\s\S]*alertTargets[\s\S]*errorTracking[\s\S]*monitoring evidence sections must use distinct local artifact files across/,
    "monitoring proof must reject one local artifact reused across independent monitoring evidence sections",
  );
  assert.match(
    monitoringProofSource,
    /function hasNonFutureIsoTimestamp\(value\)[\s\S]*Date\.now\(\) \+ 5 \* 60 \* 1000[\s\S]*monitorHasNonFutureAlertTest[\s\S]*alert test timestamp must not be in the future[\s\S]*monitorHasNonFutureRecoveryTest[\s\S]*recovery or resolution timestamp must not be in the future[\s\S]*error tracking test event timestamp must not be in the future/,
    "monitoring proof must reject future-dated alert, recovery, alert-target, and error-tracking evidence timestamps",
  );
  assert.match(
    monitoringProofSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function asPositiveSafeInteger\(value\)[\s\S]*\^\(\?:\[1-9\]\\d\{0,15\}\)\$[\s\S]*const parsed = BigInt\(normalized\)[\s\S]*parsed <= MAX_SAFE_INTEGER_BIGINT \? Number\(parsed\) : null[\s\S]*const cadenceSeconds = asPositiveSafeInteger\(cadence\)[\s\S]*health-prod monitor cadence must be a canonical positive integer[\s\S]*cadenceSeconds > 60/,
    "monitoring proof must canonical-parse health-prod cadence before accepting launch monitor evidence",
  );
  assert.doesNotMatch(
    monitoringProofSource.match(/function asPositiveSafeInteger\(value\)[\s\S]*?\n}/)?.[0] ?? "",
    /\^\(\?:\[1-9\]\\d\*\)\$/,
    "monitoring proof cadence validation must not return to unbounded regex-only numeric shape",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /monitoringUnsafeCadenceManifest[\s\S]*9999999999999999[\s\S]*monitoring-unsafe-health-cadence[\s\S]*health-prod monitor cadence must be a canonical positive integer/,
    "proof draft regression suite must reject unsafe monitoring health cadence evidence",
  );
  assert.doesNotMatch(
    monitoringProofSource,
    /function isPositiveNumber\(value\)[\s\S]*Number\.isFinite\(Number\(value\)\)[\s\S]*Number\(value\) > 0|isPositiveNumber\(cadence\)[\s\S]*Number\(cadence\) > 60|const parsed = Number\(normalized\)/,
    "monitoring proof must not broadly coerce health-prod cadence evidence",
  );
  assert.match(
    readFileSync("scripts/create-monitoring-proof-draft.mjs", "utf8"),
    /function sameArtifact[\s\S]*--monitor-artifact and --recovery-artifact must point to distinct fired-alert and recovery evidence files/,
    "monitoring proof draft generation must reject one artifact reused for fired-alert and recovery evidence",
  );
  assert.match(
    readFileSync("scripts/create-monitoring-proof-draft.mjs", "utf8"),
    /function requireDistinctArtifactInputs\(entries\)[\s\S]*--\$\{leftName\} and --\$\{rightName\} must point to distinct monitoring evidence files/,
    "monitoring proof draft generation must reject one artifact reused across independent monitoring evidence sections",
  );
  assert.match(
    monitoringProofSource,
    /no verified email alert target with ISO timestamp, concrete evidence, recipient, and sender domain proof recorded/,
    "monitoring proof must fail clearly when complete email alert delivery proof is missing",
  );
  assert.match(
    monitoringProofSource,
    /email target must record the recipient address or recipient evidence/,
    "monitoring proof must fail clearly when email recipient evidence is missing",
  );
  assert.match(
    monitoringProofSource,
    /email target must record a verified sender or domain matching the proof origin/,
    "monitoring proof must fail clearly when email sender-domain evidence is missing",
  );
  assert.match(
    monitoringProofSource,
    /Email alert targets:/,
    "monitoring summary output must show compact email alert target status",
  );
  assert.ok(
    monitoringProofSource.includes("const artifactMatch = text.match(/^artifact:") &&
      monitoringProofSource.includes("return (artifactMatch || keySuggestsPath) && valueLooksLikePath ? candidate : \"\";"),
    "monitoring proof must honor artifact: evidence references in any evidence field",
  );
  assert.ok(
    monitoringProofSource.includes("[\"artifact\", target.artifact]") &&
      monitoringProofSource.includes("[\"testEventArtifact\", errorTracking.testEventArtifact]") &&
      monitoringProofSource.includes("[\"artifact\", errorTracking.artifact]"),
    "monitoring proof must include explicit alert target and error-event artifact fields in evidence checks",
  );
  const monitoringDraftSource = readFileSync("scripts/create-monitoring-proof-draft.mjs", "utf8");
  const monitoringPlanSource = readFileSync("scripts/create-monitoring-test-plan.mjs", "utf8");
  assert.match(
    monitoringDraftSource,
    /import \{ mkdirSync, statSync, writeFileSync \}[\s\S]*MAX_MONITORING_DRAFT_ARTIFACT_BYTES = 512 \* 1024[\s\S]*function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*function requireExistingArtifact\(name\)[\s\S]*const stats = regularFileStat\(resolved\)[\s\S]*if \(!stats\)[\s\S]*stats\.size > MAX_MONITORING_DRAFT_ARTIFACT_BYTES[\s\S]*too large to reference safely/,
    "monitoring draft artifacts must be existing files, not directories",
  );
  assert.doesNotMatch(
    monitoringDraftSource,
    /existsSync\(resolved\)|statSync\(resolved\)\.isFile\(\)/,
    "monitoring proof draft must not bypass regularFileStat for resolved artifact paths",
  );
  assert.match(
    monitoringDraftSource,
    /name:\s*"TODO: verified Resend email alert target"[\s\S]*kind:\s*"email"[\s\S]*recipient:\s*"TODO: verified recipient email address"[\s\S]*sender:\s*`TODO: verified Resend sender such as alerts@\$\{emailDomain\}`[\s\S]*senderDomain:\s*emailDomain/,
    "monitoring draft must steer launch proof toward the required email target and sender domain",
  );
  assert.ok(
    monitoringDraftSource.includes("artifact: alertTargetArtifact || undefined") &&
      monitoringDraftSource.includes("testEventArtifact: errorEventArtifact || undefined"),
    "monitoring draft must preserve explicit artifact fields for alert target and error-event evidence",
  );
  assert.match(
    monitoringPlanSource,
    /Required email alert target:[\s\S]*Strict proof requires a verified email alert target/,
    "monitoring test plan must make the email alert target requirement explicit",
  );
  assert.match(
    collectMainnetProofSource,
    /gate: "deploy block shape"[\s\S]*isPositiveInteger\(deployBlock\)[\s\S]*isPositiveInteger\(publicDeployBlock\)/,
    "mainnet proof deploy blocks must be positive integers, not zero",
  );
  for (const expectedMainnetEnvGate of [
    "trusted proxy secret length",
    "health diagnostics secret length",
    "chat auth secret length",
    "purpose-separated runtime secrets",
    "admin auth secret length",
    "admin wallet address shape",
    "bootstrap resolve secret length",
    "bootstrap keeper key shape",
    "keeper key shape",
    "web replica count",
    "external rate limit for multi-replica web",
    "server backup monitoring directory",
  ]) {
    assert.ok(
      collectMainnetProofSource.includes(`gate: "${expectedMainnetEnvGate}"`),
      `mainnet env proof must include ${expectedMainnetEnvGate}`,
    );
  }
  for (const proofValidatorPath of [
    "scripts/analyze-live-canary-proof.mjs",
    "scripts/check-signoff-proof.mjs",
    "scripts/check-host-proof.mjs",
    "scripts/check-indexer-dry-run.mjs",
    "scripts/check-monitoring-proof.mjs",
    "scripts/check-qa-proof.mjs",
    "scripts/verify-db-restore.mjs",
  ]) {
    const proofValidatorSource = readFileSync(proofValidatorPath, "utf8");
    assert.match(
      proofValidatorSource,
      /\.example[\s\S]*192\\.168/,
      `${proofValidatorPath} must reject example and private origins in launch evidence`,
    );
    assert.match(proofValidatorSource, /function hasPublicHttpsUrl\(value\)/, `${proofValidatorPath} must validate concrete evidence URLs`);
    for (const requiredUrlGuard of [
      'url.protocol === "https:"',
      "!url.username",
      "!url.password",
      'host === "localhost"',
      'host.endsWith(".example")',
      'host.endsWith(".test")',
      "/^192\\.168\\./.test(host)",
    ]) {
      assert.ok(
        proofValidatorSource.includes(requiredUrlGuard),
        `${proofValidatorPath} must reject non-public, credentialed, local, example, and test URLs as concrete launch evidence`,
      );
    }
    assert.match(
      proofValidatorSource,
      /function hasConcreteText\(value\)[\s\S]*hasPublicHttpsUrl\(text\)/,
      `${proofValidatorPath} must pass URL evidence through the public HTTPS guard`,
    );
    assert.ok(
      proofValidatorSource.includes("const artifactMatch = text.match(/^artifact:") &&
        proofValidatorSource.includes("return (artifactMatch || keySuggestsPath) && valueLooksLikePath ? candidate : \"\";"),
      `${proofValidatorPath} must honor artifact: references in ordinary evidence fields`,
    );
  }
  assert.doesNotMatch(
    readFileSync("scripts/check-monitoring-proof.mjs", "utf8"),
    /function hasConcreteText\(value\)[\s\S]*sentry\|datadog\|newrelic\|grafana\|pagerduty\|opsgenie\|slack\|discord\|telegram\|incident\|alert\|monitor\|recovery\|resolved[\s\S]*function isPositiveNumber/,
    "monitoring proof must not treat generic provider/channel words as concrete launch evidence",
  );
  assert.doesNotMatch(
    readFileSync("scripts/analyze-live-canary-proof.mjs", "utf8"),
    /function hasConcreteText\(value\)[\s\S]*live\[-\\s\]\?canary\|target\[-\\s\]\?rpc\|chainId\|reload\|reconnect\|tab\[-\\s\]\?close\|pending\[-\\s\]\?tx\|remount\|nonce\|duplicate\|stuck\[-\\s\]\?pending[\s\S]*function hasEvidence/,
    "canary proof must not treat generic canary/recovery/nonce words as concrete launch evidence",
  );
  const canaryProofValidatorSource = readFileSync("scripts/analyze-live-canary-proof.mjs", "utf8");
  const proofDraftSelfTestSource = readFileSync("scripts/check-proof-drafts.mjs", "utf8");
  assert.match(
    canaryProofValidatorSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseCanonicalPositiveInteger\(raw\)[\s\S]*CANONICAL_POSITIVE_INTEGER_RE\.test\(text\)[\s\S]*const parsed = BigInt\(text\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*function parseCanonicalNonNegativeInteger\(raw\)[\s\S]*CANONICAL_NON_NEGATIVE_INTEGER_RE\.test\(text\)[\s\S]*const parsed = BigInt\(text\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)/,
    "canary proof numeric evidence must require canonical safe integers, not regex-only numeric shape",
  );
  assert.match(
    canaryProofValidatorSource,
    /function unique\(values\)[\s\S]*sort\(compareCanonicalIntegerText\)[\s\S]*function compareCanonicalIntegerText\(left, right\)/,
    "canary proof epoch summaries must sort canonical integer text without broad numeric coercion",
  );
  assert.match(
    canaryProofValidatorSource,
    /duplicateNonceKeys = findDuplicateNonceKeys\(okBets\)[\s\S]*duplicate successful nonce keys[\s\S]*function findDuplicateNonceKeys\(events\)[\s\S]*hasCanonicalNonceEvidence\(event\)[\s\S]*normalizeRole\(event\.role\)[\s\S]*positiveIntegerString\(event\.chainId\)[\s\S]*normalizeAddress\(event\.contractAddress\)[\s\S]*nonceLatest[\s\S]*noncePending/,
    "canary proof must fail closed on duplicate successful nonce evidence scoped by role, chain, and contract",
  );
  assert.match(
    canaryProofValidatorSource,
    /duplicateRoleEpochKeys = findDuplicateRoleEpochKeys\(okBets\)[\s\S]*duplicate successful role\/epoch keys[\s\S]*function findDuplicateRoleEpochKeys\(bets\)[\s\S]*normalizeRole\(event\.role\)[\s\S]*positiveIntegerString\(event\.epoch\)[\s\S]*positiveIntegerString\(event\.chainId\)[\s\S]*normalizeAddress\(event\.contractAddress\)[\s\S]*repeat === true[\s\S]*repeatBetSignature\(event\)/,
    "canary proof must fail closed on duplicate successful role/epoch evidence while preserving explicit repeat measurements",
  );
  assert.match(
    canaryProofValidatorSource,
    /preflightEvents = events\.filter\(\(event\) => event\.mode === "preflight"\)[\s\S]*failedPreflight = preflightEvents\.filter\(\(event\) => event\.ok !== true\)[\s\S]*failed preflight checks[\s\S]*preflight checks \/ failures/,
    "canary proof must fail closed when live preflight balance, allowance, or nonce readiness checks fail",
  );
  assert.doesNotMatch(
    canaryProofValidatorSource,
    /Number\(String\(raw\)\.trim\(\)\)|Number\(a\) - Number\(b\)|return CANONICAL_(?:POSITIVE|NON_NEGATIVE)_INTEGER_RE\.test\(String\(raw \?\? ""\)\.trim\(\)\)/,
    "canary proof must not return to unsafe integer coercion or regex-only validation",
  );
  for (const requiredCanaryUnsafeRegression of [
    "canaryUnsafeNonceLog",
    "canaryDuplicateNonceLog",
    "canaryDuplicateRoleEpochLog",
    "canaryFailedPreflightLog",
    "canaryUnsafeEpochLog",
    "canaryUnsafeTxMetricLog",
    "canary-live-log-unsafe-nonce",
    "canary-live-log-duplicate-nonce",
    "canary-live-log-duplicate-role-epoch",
    "canary-live-log-failed-preflight",
    "canary-live-log-unsafe-epoch",
    "canary-live-log-unsafe-tx-metric",
    "9999999999999999",
  ]) {
    assert.ok(
      proofDraftSelfTestSource.includes(requiredCanaryUnsafeRegression),
      `proof draft self-test must retain unsafe canary numeric regression ${requiredCanaryUnsafeRegression}`,
    );
  }
  const qaProofValidatorSource = readFileSync("scripts/check-qa-proof.mjs", "utf8");
  const qaProofDraftSource = readFileSync("scripts/create-qa-proof-draft.mjs", "utf8");
  const qaCanaryPlanSource = readFileSync("scripts/create-qa-canary-test-plan.mjs", "utf8");
  const readinessChecklistSource = readFileSync("docs/mainnet-readiness-checklist.md", "utf8");
  assert.match(
    qaProofDraftSource,
    /import \{ mkdirSync, statSync, writeFileSync \}[\s\S]*MAX_QA_DRAFT_ARTIFACT_BYTES = 512 \* 1024[\s\S]*function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*function requireExistingArtifact\(name\)[\s\S]*const stats = regularFileStat\(resolved\)[\s\S]*if \(!stats\)[\s\S]*stats\.size > MAX_QA_DRAFT_ARTIFACT_BYTES[\s\S]*too large to reference safely/,
    "QA draft artifacts must be existing files, not directories",
  );
  assert.doesNotMatch(
    qaProofDraftSource,
    /existsSync\(resolved\)|statSync\(resolved\)\.isFile\(\)/,
    "QA proof draft must not bypass regularFileStat for resolved artifact paths",
  );
  assert.match(
    qaProofDraftSource,
    /function requireDistinctArtifacts\(entries\)[\s\S]*sameArtifact\(leftPath, rightPath\)[\s\S]*distinct QA evidence files/,
    "QA proof draft generation must reject one artifact reused across QA evidence groups",
  );
  assert.match(
    qaProofDraftSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parsePositiveInteger\(value\)[\s\S]*\^\[1-9\]\\d\{0,15\}\$[\s\S]*const parsed = BigInt\(normalized\)[\s\S]*parsed <= MAX_SAFE_INTEGER_BIGINT \? Number\(parsed\) : null[\s\S]*const parsedChainId = parsePositiveInteger\(chainId\)[\s\S]*targetChainId: parsedChainId[\s\S]*chainId: parsedChainId/,
    "QA proof draft generation must publish the same safe parsed chain id it validates",
  );
  assert.match(
    qaCanaryPlanSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parsePositiveInteger\(value\)[\s\S]*\^\[1-9\]\\d\{0,15\}\$[\s\S]*const parsed = BigInt\(normalized\)[\s\S]*parsed <= MAX_SAFE_INTEGER_BIGINT \? Number\(parsed\) : null[\s\S]*const parsedChainId = parsePositiveInteger\(chainId\)[\s\S]*Chain ID: \$\{parsedChainId\}[\s\S]*--chain-id=\$\{parsedChainId\}/,
    "QA canary test plan generation must print the same safe parsed chain id it validates",
  );
  assert.doesNotMatch(
    `${qaProofDraftSource.match(/function parsePositiveInteger\(value\)[\s\S]*?\n}/)?.[0] ?? ""}\n${qaCanaryPlanSource.match(/function parsePositiveInteger\(value\)[\s\S]*?\n}/)?.[0] ?? ""}`,
    /\^\[1-9\]\\d\*\$/,
    "QA draft and canary plan positive integer validation must not return to unbounded regex-only numeric shape",
  );
  assert.doesNotMatch(
    `${qaProofDraftSource}\n${qaCanaryPlanSource}`,
    /Number\(chainId\)|const parsed = Number\(normalized\)/,
    "QA proof draft and canary plan generation must not broadly coerce chain id evidence",
  );
  assert.match(
    qaProofValidatorSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function positiveInteger\(value\)[\s\S]*\^\[1-9\]\\d\{0,15\}\$[\s\S]*const parsed = BigInt\(normalized\)[\s\S]*parsed <= MAX_SAFE_INTEGER_BIGINT \? Number\(parsed\) : null/,
    "QA proof positive integer evidence must require bounded canonical safe integers",
  );
  assert.match(
    qaProofValidatorSource,
    /function parseCanonicalViewportDimension\(value\)[\s\S]*\^\[1-9\]\\d\{2,3\}\$[\s\S]*const parsed = BigInt\(normalized\)[\s\S]*parsed <= MAX_SAFE_INTEGER_BIGINT \? Number\(parsed\) : null[\s\S]*MAX_VIEWPORT_MARKERS = 32[\s\S]*function hasMobileViewportProofText\(text\)[\s\S]*inspected \+= 1[\s\S]*inspected > MAX_VIEWPORT_MARKERS[\s\S]*parseCanonicalViewportDimension\(match\[1\]\)/,
    "QA proof mobile viewport evidence scan must be capped before accepting mobile layout proof",
  );
  assert.doesNotMatch(
    qaProofValidatorSource.match(/function positiveInteger\(value\)[\s\S]*?\n}/)?.[0] ?? "",
    /\^\[1-9\]\\d\*\$/,
    "QA proof positive integer validation must not return to unbounded regex-only numeric shape",
  );
  assert.match(
    proofDraftSelfTestSource,
    /qaUnsafeTargetChainManifest[\s\S]*9999999999999999[\s\S]*qa-unsafe-target-chain-id[\s\S]*targetChainId must be a positive integer/,
    "proof draft regression suite must reject unsafe QA targetChainId evidence",
  );
  assert.match(
    proofDraftSelfTestSource,
    /qa-draft-unsafe-chain-id[\s\S]*9999999999999999[\s\S]*--chain-id must be a positive integer or derivable from --network[\s\S]*qa-canary-plan-unsafe-chain-id[\s\S]*9999999999999999[\s\S]*--chain-id must be a positive integer or derivable from --network/,
    "proof draft regression suite must reject unsafe QA draft and canary-plan chain IDs",
  );
  assert.match(
    qaProofValidatorSource,
    /function sharedQaEvidenceGroupArtifactIssues\(manifest\)[\s\S]*normalizedArtifactPathSetForGroup[\s\S]*QA evidence groups must use distinct local artifact files across/,
    "QA proof validation must reject one local artifact reused across QA evidence groups",
  );
  const expectedAutoMinerLogFields = '["round", "epoch", "nonce", "txHash", "retryCount", "stopReason"]';
  assert.ok(
    qaProofValidatorSource.includes(`REQUIRED_AUTOMINER_LOG_FIELDS = ${expectedAutoMinerLogFields}`) &&
      qaProofDraftSource.includes(`fields: ${expectedAutoMinerLogFields}`) &&
      proofDraftSelfTestSource.includes(`fields: ${expectedAutoMinerLogFields}`) &&
      qaCanaryPlanSource.includes("Auto-miner logs show round, epoch, nonce, txHash, retryCount, and stopReason.") &&
      readinessChecklistSource.includes("Auto-miner logs expose round, epoch, nonce, tx, retry, and stop reason."),
    "QA Auto-Miner proof fields must stay aligned with the readiness checklist",
  );
  assert.match(
    qaProofValidatorSource,
    /checkId === "privyAllowedOrigins"[\s\S]*\\bprivy\\b[\s\S]*allowed\[-\\s\]\?origin\|dashboard\|production\\s\+origin[\s\S]*app\[-\\s\]\?id/,
    "QA proof must require specific Privy allowed-origin/dashboard and app-id evidence, not generic wallet evidence",
  );
  for (const [walletCheckId, requiredMarkers] of [
    ["desktopConnect", ["desktop", "browser", "connect", "connected", "wallet\\s+ready"]],
    ["desktopDisconnect", ["desktop", "browser", "disconnect", "disconnected", "sign\\s*out", "log\\s*out"]],
    ["desktopReconnect", ["desktop", "browser", "reconnect", "reload", "session\\s+recovery", "wallet\\s+ready"]],
    ["wrongNetwork", ["wrong\\s+network", "unsupported\\s+chain", "switch\\s+network", "chain\\s+mismatch"]],
    ["mobileWeb3Browser", ["mobile", "web3", "in[-\\s]?app", "browser", "wallet"]],
    ["cleanWalletFirstTx", ["clean\\s+wallet", "first\\s+(?:tx|transaction)", "first\\s+bet", "fresh\\s+wallet"]],
    ["slowNetworkAuthModal", ["slow\\s+network", "timeout", "delayed", "latency", "auth", "modal", "privy"]],
    ["slowNetworkChatAuth", ["slow\\s+network", "timeout", "delayed", "latency", "chat\\s+auth", "chat", "message"]],
  ]) {
    const checkSpecificBranch = qaProofValidatorSource.match(
      new RegExp(`checkId === "${walletCheckId}"[\\s\\S]*?(?=\\n  if \\(group === "wallet"|\\n  if \\(group === "failureStateUx"|\\n  if \\(group === "supportAuditVisibility"|\\n  if \\(group === "finalQa")`),
    )?.[0] ?? "";
    assert.ok(checkSpecificBranch, `QA proof validator must have a branch for ${walletCheckId}`);
    for (const marker of requiredMarkers) {
      assert.ok(
        checkSpecificBranch.includes(marker),
        `QA proof ${walletCheckId} branch must require marker ${marker}`,
      );
    }
    assert.match(
      checkSpecificBranch,
      /text/,
      `QA proof must require check-specific wallet evidence for ${walletCheckId}`,
    );
  }
  assert.match(
    qaProofValidatorSource,
    /privyAllowedOrigins\.productionAppIdConfigured !== true/,
    "QA proof must require the production Privy app id to be configured without recording the value",
  );
  assert.match(
    qaProofValidatorSource,
    /function hasConcreteText\(value\)[\s\S]*https\?:\\\/\\\/[\s\S]*json\|jsonl\|log\|md\|txt\|csv\|png\|jpg\|jpeg\|webp\|html\|zip/,
    "QA proof concrete evidence must accept artifact-like URLs and local evidence paths",
  );
  assert.match(
    qaProofValidatorSource,
    /function hasPublicHttpsUrl\(value\)[\s\S]*url\.protocol === "https:"[\s\S]*!url\.username[\s\S]*!url\.password[\s\S]*localhost[\s\S]*192\\\.168[\s\S]*\.example[\s\S]*\.test/,
    "QA proof URL evidence must reject non-public, credentialed, local, example, and test URLs",
  );
  assert.match(
    qaProofValidatorSource,
    /function hasConcreteText\(value\)[\s\S]*hasPublicHttpsUrl\(text\)[\s\S]*json\|jsonl\|log\|md\|txt\|csv\|png\|jpg\|jpeg\|webp\|html\|zip/,
    "QA proof concrete evidence must pass URL evidence through the public HTTPS guard",
  );
  assert.match(
    qaProofValidatorSource,
    /function receiptEvidenceText\(check\)[\s\S]*!localArtifactPathFromText\(entry\)[\s\S]*function hasCleanWalletReceiptProof\(check\)[\s\S]*receipt\|confirmed\|confirmation\|success\|successful[\s\S]*lineascan\|explorer[\s\S]*wallet\.cleanWalletFirstTx evidence must include receipt\/explorer confirmation proof/,
    "QA clean-wallet first transaction proof must require receipt or explorer confirmation evidence, not only a tx hash",
  );
  assert.match(
    qaProofValidatorSource,
    /function parseCanonicalViewportDimension\(value\)[\s\S]*\^\[1-9\]\\d\{2,3\}\$[\s\S]*const parsed = BigInt\(normalized\)[\s\S]*parsed <= MAX_SAFE_INTEGER_BIGINT \? Number\(parsed\) : null[\s\S]*function hasMobileViewportProofText\(text\)[\s\S]*portraitMobile[\s\S]*landscapeMobile[\s\S]*function hasMobileDeviceProof\(check\)[\s\S]*ios\|android\|iphone[\s\S]*hasMobileViewportProofText\(text\)[\s\S]*wallet\.mobileWeb3Browser evidence must include mobile device, wallet app, or viewport proof/,
    "QA mobile Web3 proof must require a concrete mobile device, wallet app, or canonical mobile viewport evidence, not generic mobile/touch wording",
  );
  assert.doesNotMatch(
    qaProofValidatorSource.match(/function hasMobileDeviceProof\(check\)[\s\S]*?\n}/)?.[0] ?? "",
    /\btouch\b|\(\?:3\[2-9\]\\d\|4\\d\\d\)px/,
    "QA mobile Web3 proof must not accept generic touch or pixel-width text as mobile-device evidence",
  );
  assert.doesNotMatch(
    qaProofValidatorSource,
    /function hasConcreteText\(value\)[\s\S]*\b(?:screenshot|playwright|browser\\s\+smoke|mobile|privy|wrong\\s\+network|pending|diagnostics|bet\\s\+history|auto\[-\\s\]\?miner|debug\\s\+autominer)\b[\s\S]*function hasConcreteEvidence/,
    "QA proof must not treat keyword-only text as concrete launch evidence",
  );
  assert.match(
    qaProofDraftSource,
    /productionAppIdConfigured: false[\s\S]*production app id proof/,
    "QA proof draft must steer operators toward redacted production Privy app id proof",
  );
  assert.match(
    qaProofDraftSource,
    /Privy dashboard allowed-origin and production app id proof/,
    "QA proof draft must steer operators toward Privy dashboard allowed-origin and redacted production app id evidence",
  );
  for (const requiredQaCanaryItem of [
    "Wallet loading state resolves or shows a recoverable error within the documented timeout.",
    "ETH top-up, LINEA deposit, withdrawal, rejected prompt, timeout, and signed on-chain revert copy are verified.",
    "Pool chart remains visible with an explicit empty state when there are no bets.",
    "Manual bet, Auto-Miner, tile values, wallet balances, jackpot amounts, and reward amounts use consistent number typography.",
    "Mobile layout, jackpot ticker, right panel, overlays, and chat geometry are verified without clipping or overlap.",
    "Jackpot and reward visibility are verified in empty, pending, awarded, and claimable states.",
  ]) {
    assert.ok(
      qaCanaryPlanSource.includes(requiredQaCanaryItem),
      `QA canary plan must keep pre-mainnet UX coverage: ${requiredQaCanaryItem}`,
    );
  }
  for (const proofDraftPath of [
    "scripts/create-host-proof-draft.mjs",
    "scripts/create-monitoring-proof-draft.mjs",
    "scripts/create-monitoring-test-plan.mjs",
    "scripts/create-qa-proof-draft.mjs",
    "scripts/create-qa-canary-test-plan.mjs",
    "scripts/collect-proof-common.mjs",
    "scripts/create-restore-proof-draft.mjs",
  ]) {
    assert.match(
      readFileSync(proofDraftPath, "utf8"),
      /\.example[\s\S]*192\\.168/,
      `${proofDraftPath} must reject example and private origins before writing launch drafts`,
    );
  }
  assert.match(
    readFileSync("scripts/collect-proof-common.mjs", "utf8"),
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parsePositiveInteger[\s\S]*\^\[1-9\]\\d\{0,15\}\$[\s\S]*const parsed = BigInt\(normalized\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*function isPositiveInteger[\s\S]*parsePositiveInteger\(value\) !== null/,
    "proof collectors must reject unsafe positive integers before converting to Number",
  );
  const checkProofFilesSource = readFileSync("scripts/check-proof-files.mjs", "utf8");
  assert.match(
    checkProofFilesSource,
    /MAX_CANARY_FIRST_LINE_SCAN_BYTES[\s\S]*function readFirstNonEmptyLine[\s\S]*readSync/,
    "proof file guard must read only a bounded first JSONL line from long canary logs",
  );
  assert.ok(
    checkProofFilesSource.includes('return line.replace(/^\\uFEFF/, "")') &&
      checkProofFilesSource.includes('pending.replace(/^\\uFEFF/, "")'),
    "proof file guard must tolerate UTF-8 BOM on the first canary JSONL record",
  );
  assert.doesNotMatch(
    checkProofFilesSource,
    /readFileSync\(canaryLogAbsolutePath,\s*"utf8"\)\.split/,
    "proof file guard must not read full canary JSONL logs to inspect one record",
  );
  assert.match(
    checkProofFilesSource,
    /function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*function fileExists\(filePath\)[\s\S]*regularFileStat\(filePath\) !== null[\s\S]*expectedAuxiliaryProofArtifacts[\s\S]*not a file[\s\S]*expectedFinalManifestNames[\s\S]*not a file/,
    "proof file guard must reject directory proof artifacts before JSON parsing",
  );
  assert.match(
    checkProofFilesSource,
    /MAX_PROOF_FILE_JSON_BYTES = 512 \* 1024[\s\S]*function readProofJsonFile\(filePath, label\)[\s\S]*const fileStat = regularFileStat\(filePath\)[\s\S]*proof JSON file is not a file[\s\S]*fileStat\.size > MAX_PROOF_FILE_JSON_BYTES[\s\S]*proof JSON file is too large to validate safely[\s\S]*JSON\.parse\(readFileSync\(filePath, "utf8"\)\)[\s\S]*expectedAuxiliaryProofArtifacts[\s\S]*readProofJsonFile\(filePath, name\)[\s\S]*expectedFinalManifestNames[\s\S]*readProofJsonFile\(filePath, name\)/,
    "proof file guard must size-gate auxiliary and final proof JSON files before parsing",
  );
  assert.match(
    checkProofFilesSource,
    /unsafeDiagnosticKeyPattern[\s\S]*findUnsafeDiagnosticValues[\s\S]*canary log first JSONL record has unsafe diagnostic values/,
    "proof file guard must reject unsafe diagnostic text in bounded canary JSONL inspection",
  );
  assert.match(
    checkProofFilesSource,
    /unsafeDiagnosticFindings\.length === 0 \? "no" : "yes"[\s\S]*Unsafe Diagnostics/,
    "proof file guard summary table must expose unsafe diagnostic findings as their own status column",
  );
  assert.match(
    checkProofFilesSource,
    /rows\.push\(\[\s*"canary-log"[\s\S]*canaryLogUnsafeDiagnostics[\s\S]*canaryLogSummary/,
    "proof file guard must expose canary-log validation as its own table row",
  );
  assert.match(
    readFileSync("scripts/run-local-proof-preflight.mjs", "utf8"),
    /canaryUnsafeDiagnosticJsonlPath[\s\S]*canary log first JSONL record has unsafe diagnostic values/,
    "local proof preflight must cover unsafe diagnostic text in canary log shape regressions",
  );
  assert.match(
    readFileSync("scripts/verify-db-restore.mjs", "utf8"),
    /\.example[\s\S]*192\\.168/,
    "restore proof validation must reject example and private restored origins",
  );
  const restoreProofValidationSource = readFileSync("scripts/verify-db-restore.mjs", "utf8");
  assert.match(
    restoreProofValidationSource,
    /function parseCanonicalPositiveInteger[\s\S]*backupSchedule\.retentionDays[\s\S]*3650/,
    "restore proof validation must require a bounded backup retention window",
  );
  assert.match(
    restoreProofValidationSource,
    /function readCount\(db, table\)[\s\S]*return parseCanonicalNonNegativeInteger\(row\?\.count\)/,
    "restore proof validation must canonical-parse SQLite COUNT evidence",
  );
  assert.match(
    restoreProofValidationSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function integerString\(value\)[\s\S]*CANONICAL_NON_NEGATIVE_INTEGER_RE\.test\(text\)[\s\S]*const parsed = BigInt\(text\)[\s\S]*parsed <= MAX_SAFE_INTEGER_BIGINT[\s\S]*latestIndexedEpochBefore = integerString\(indexerPreservation\.latestIndexedEpochBefore\)/,
    "restore proof validation must canonical-parse indexer preservation epoch evidence before comparing it",
  );
  assert.match(
    restoreProofValidationSource,
    /function knownLaunchRowTotal\(snapshot\)[\s\S]*Number\.isSafeInteger\(value\) && value >= 0/,
    "restore proof validation must only sum safe non-negative row counts",
  );
  assert.doesNotMatch(
    restoreProofValidationSource,
    /Number\(row\?\.count \?\? 0\)|Number\(positiveIntegerString\(backupSchedule\.retentionDays\)\)|filter\(\(value\) => typeof value === "number"\)|function integerString\(value\)[\s\S]*\^\\d\+\$/,
    "restore proof validation must not use broad Number coercion or regex-only integer evidence checks",
  );
  assert.match(
    restoreProofValidationSource,
    /backupSchedule\.lastSuccessfulBackupAt[\s\S]*hasIsoTimestamp/,
    "restore proof validation must require the latest successful backup timestamp",
  );
  assert.match(
    restoreProofValidationSource,
    /lastSuccessfulBackupAtMs[\s\S]*backupScheduleCheckedAtMs[\s\S]*must not be after backupSchedule\.checkedAt[\s\S]*must be within backupSchedule\.retentionDays/,
    "restore proof validation must reject future or retention-expired latest backup timestamps",
  );
  assert.match(
    restoreProofValidationSource,
    /function hasNonFutureIsoTimestamp[\s\S]*Date\.now\(\) \+ 5 \* 60 \* 1000[\s\S]*restoreDrill\.timestamp must not be in the future[\s\S]*restoredStagingHealth\.timestamp must not be in the future[\s\S]*indexerPreservation\.checkedAt must not be in the future/,
    "restore proof validation must reject future-dated restore, health, and indexer preservation evidence timestamps",
  );
  assert.match(
    restoreProofValidationSource,
    /CANONICAL_NON_NEGATIVE_INTEGER_RE[\s\S]*function hasCanonicalNonNegativeInteger[\s\S]*hasNumericFinalityLagEvidence[\s\S]*canonical non-negative decimal finalityLagBlocks from health:prod/,
    "restore proof validation must require canonical finalityLagBlocks evidence",
  );
  assert.match(
    restoreProofValidationSource,
    /evidenceIncludesExactBackupTimestamp[\s\S]*backupSchedule\.lastSuccessfulBackupAt[\s\S]*evidence must include backupSchedule\.lastSuccessfulBackupAt timestamp/,
    "restore proof validation must require evidence for the exact latest successful backup timestamp",
  );
  assert.match(
    restoreProofValidationSource,
    /evidenceIncludesRetentionDays[\s\S]*backupSchedule\.retentionDays[\s\S]*evidence must include backupSchedule\.retentionDays value/,
    "restore proof validation must require evidence for the exact retention window",
  );
  assert.match(
    restoreProofValidationSource,
    /function hasBackupSuccessProof[\s\S]*latest\\s\+backup[\s\S]*backup\\s\+\(\?:completed\|created\|written\|uploaded\|succeeded\|success\)/,
    "restore proof validation must inspect evidence for successful backup proof, not only scheduler existence",
  );
  assert.match(
    restoreProofValidationSource,
    /function hasBackupRetentionProof[\s\S]*retentionDays[\s\S]*\\d\+\\s\*/,
    "restore proof validation must inspect evidence for retention or pruning proof",
  );
  assert.match(
    restoreProofValidationSource,
    /function sharedRestoreSectionArtifactIssues\(manifest\)[\s\S]*normalizedArtifactPathSet[\s\S]*restore evidence sections must use distinct local artifact files across/,
    "restore proof validation must reject one local artifact reused across restore evidence sections",
  );
  assert.match(
    restoreProofValidationSource,
    /function formatMissingLocalArtifactRefs\(findings\)[\s\S]*summaryOnly \? findings\.map\(\(entry\) => entry\.split\(" -> "\)\[0\]\)[\s\S]*formatMissingLocalArtifactRefs\(missingArtifactRefs\)/,
    "restore proof summary output must avoid printing raw local artifact paths for missing references",
  );
  assert.match(
    restoreProofValidationSource,
    /MAX_RESTORE_ARTIFACT_TEXT_BYTES = 256 \* 1024[\s\S]*function readBoundedArtifactText\(resolved\)[\s\S]*openSync\(resolved, "r"\)[\s\S]*readSync\(fd, buffer, 0, buffer\.length, 0\)[\s\S]*closeSync\(fd\)[\s\S]*artifactBackedEvidenceText\(value\)[\s\S]*readBoundedArtifactText\(resolved\)/,
    "restore proof must read bounded local artifact snippets instead of whole evidence files",
  );
  assert.match(
    restoreProofValidationSource,
    /function regularFileStat\(filePath\)[\s\S]*const stats = statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*function localArtifactIsFile\(artifactPath\)[\s\S]*regularFileStat\(resolve\(repoRoot, artifactPath\)\) !== null[\s\S]*function artifactBackedEvidenceText\(value\)[\s\S]*regularFileStat\(resolved\)/,
    "restore proof must derive local artifact existence from the shared regular-file stat boundary before reading evidence",
  );
  assert.doesNotMatch(
    restoreProofValidationSource,
    /readFileSync\(resolved,\s*"utf8"\)\.slice/,
    "restore proof must not read whole local artifacts before slicing snippets",
  );
  assert.match(
    restoreProofValidationSource,
    /MAX_RESTORE_PROOF_MANIFEST_BYTES = 512 \* 1024[\s\S]*const manifestStat = regularFileStat\(resolvedManifestPath\)[\s\S]*!manifestStat[\s\S]*restore proof manifest must be a file[\s\S]*manifestStat\.size > MAX_RESTORE_PROOF_MANIFEST_BYTES[\s\S]*restore proof manifest is too large to validate safely[\s\S]*JSON\.parse\(readFileSync\(resolvedManifestPath, "utf8"\)\)/,
    "restore proof must size-gate proof manifests before parsing JSON",
  );
  for (const restoreDraftScript of ["scripts/collect-restore-evidence.mjs", "scripts/create-restore-proof-draft.mjs"]) {
    const restoreDraftSource = readFileSync(restoreDraftScript, "utf8");
    assert.match(
      restoreDraftSource,
      /retentionDays[\s\S]*lastSuccessfulBackupAt/,
      `${restoreDraftScript} must steer operators to fill retention and latest successful backup proof`,
    );
  }
  const createRestoreDraftSource = readFileSync("scripts/create-restore-proof-draft.mjs", "utf8");
  assert.match(
    createRestoreDraftSource,
    /function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stat\.isFile\(\) \? stat : null[\s\S]*function requireExistingFile\(name, filePath\)[\s\S]*regularFileStat\(resolved\)/,
    "restore proof draft must reject directory file inputs before writing evidence drafts",
  );
  assert.match(
    createRestoreDraftSource,
    /function regularDirectoryStat\(dirPath\)[\s\S]*statSync\(dirPath\)[\s\S]*stat\.isDirectory\(\) \? stat : null[\s\S]*function requireExistingDirectory\(name, dirPath\)[\s\S]*regularDirectoryStat\(resolved\)/,
    "restore proof draft must reject file directory inputs before writing evidence drafts",
  );
  assert.match(
    createRestoreDraftSource,
    /function requireDistinctArtifactInputs\(entries\)[\s\S]*--\$\{leftName\} and --\$\{rightName\} must point to distinct restore evidence files/,
    "restore proof draft must reject one artifact reused across restore evidence inputs",
  );
  const collectRestoreSource = readFileSync("scripts/collect-restore-evidence.mjs", "utf8");
  assert.match(
    `${collectRestoreSource}\n${createRestoreDraftSource}`,
    /function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stat\.isFile\(\) \? stat : null[\s\S]*function regularDirectoryStat\(dirPath\)[\s\S]*statSync\(dirPath\)[\s\S]*stat\.isDirectory\(\) \? stat : null/,
    "restore evidence collector and draft generator must use shared stat boundaries for file and directory inputs",
  );
  assert.match(
    `${collectRestoreSource}\n${createRestoreDraftSource}`,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function hasCanonicalNonNegativeInteger[\s\S]*parseCanonicalNonNegativeInteger\(value\) !== null[\s\S]*function parseCanonicalNonNegativeInteger[\s\S]*const parsed = BigInt\(text\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*canonical non-negative decimal finalityLagBlocks=<number>/,
    "restore collector and draft generator must require BigInt-bounded canonical finalityLagBlocks before writing draft evidence",
  );
  for (const restoreEvidenceDraftSource of [collectRestoreSource, createRestoreDraftSource]) {
    assert.match(
      restoreEvidenceDraftSource,
      /const MAX_KEY_VALUE_MARKERS = 64[\s\S]*function parseKeyValues\(line = ""\)[\s\S]*pattern\.exec\(line\)[\s\S]*inspected > MAX_KEY_VALUE_MARKERS[\s\S]*too many key\/value markers to validate safely/,
      "restore evidence draft tooling must cap key/value parsing before accepting health evidence",
    );
    assert.doesNotMatch(
      restoreEvidenceDraftSource,
      /line\.matchAll\(/,
      "restore evidence draft tooling must not parse key/value evidence through matchAll",
    );
  }
  assert.match(
    restoreProofValidationSource,
    /function hasCanonicalNonNegativeInteger\(value\)[\s\S]*parseCanonicalNonNegativeInteger\(value\) !== null[\s\S]*function parseCanonicalNonNegativeInteger\(value\)[\s\S]*CANONICAL_NON_NEGATIVE_INTEGER_RE\.test\(text\)[\s\S]*const parsed = BigInt\(text\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*hasNumericFinalityLagEvidence/,
    "restore strict validation must require BigInt-bounded canonical finalityLagBlocks evidence",
  );
  assert.doesNotMatch(
    `${collectRestoreSource}\n${createRestoreDraftSource}\n${restoreProofValidationSource}`,
    /Number\.isFinite\(Number\((?:values|healthValues)\.finalityLagBlocks\)\)|Number\.isFinite\(Number\(match\[1\]\)\)/,
    "restore proof tooling must not use broad numeric fallback for finalityLagBlocks",
  );
  assert.match(
    collectRestoreSource,
    /MAX_RESTORE_EVIDENCE_BYTES = 512 \* 1024[\s\S]*function readOptionalLog\(name, filePath\)[\s\S]*const stat = regularFileStat\(resolved\)[\s\S]*if \(!stat\)[\s\S]*stat\.size > MAX_RESTORE_EVIDENCE_BYTES[\s\S]*artifact is too large to validate safely[\s\S]*readOptionalLog\("restore-log", restoreLogPath\)[\s\S]*readOptionalLog\("health-log", healthLogPath\)/,
    "restore evidence collector must reject directory and oversized log artifacts before reading them",
  );
  assert.match(
    createRestoreDraftSource,
    /MAX_RESTORE_EVIDENCE_BYTES = 512 \* 1024[\s\S]*function readRequiredLog\(name, filePath\)[\s\S]*const stat = regularFileStat\(resolved\)[\s\S]*if \(!stat\)[\s\S]*stat\.size > MAX_RESTORE_EVIDENCE_BYTES[\s\S]*artifact is too large to validate safely[\s\S]*readFileSync\(resolved, "utf8"\)/,
    "restore proof draft must reject directory and oversized log artifacts before reading them",
  );
  assert.doesNotMatch(
    `${collectRestoreSource}\n${createRestoreDraftSource}`,
    /existsSync\(resolved\)|statSync\(resolved\)\.(?:isFile|isDirectory)\(\)/,
    "restore evidence collector and draft generator must not bypass regular stat boundaries for resolved paths",
  );
  assert.match(
    collectRestoreSource,
    /function requireDistinctArtifactInputs\(entries\)[\s\S]*--\$\{leftName\} and --\$\{rightName\} must point to distinct restore evidence files/,
    "restore evidence collector must reject one artifact reused across restore evidence inputs",
  );
  const proofDraftRegressionSource = readFileSync("scripts/check-proof-drafts.mjs", "utf8");
  assert.match(
    proofDraftRegressionSource,
    /restore-draft-malformed-finality-lag[\s\S]*canonical non-negative decimal finalityLagBlocks=<number>/,
    "proof draft regressions must cover malformed restore finalityLagBlocks in draft generation",
  );
  assert.match(
    proofDraftRegressionSource,
    /restoreHealthUnsafeFinalityLog[\s\S]*9999999999999999[\s\S]*restore-draft-unsafe-finality-lag[\s\S]*canonical non-negative decimal finalityLagBlocks=<number>/,
    "proof draft regressions must cover unsafe restore finalityLagBlocks in draft generation",
  );
  assert.match(
    proofDraftRegressionSource,
    /restore-malformed-finality-lag[\s\S]*canonical non-negative decimal finalityLagBlocks from health:prod/,
    "proof draft regressions must cover malformed restore finalityLagBlocks in strict validation",
  );
  assert.match(
    proofDraftRegressionSource,
    /restoreUnsafeFinalityManifest[\s\S]*9999999999999999[\s\S]*restore-unsafe-finality-lag[\s\S]*canonical non-negative decimal finalityLagBlocks from health:prod/,
    "proof draft regressions must cover unsafe restore finalityLagBlocks in strict validation",
  );
  assert.match(
    proofDraftRegressionSource,
    /restoreUnsafeIndexedEpochManifest[\s\S]*latestIndexedEpochBefore: "9999999999999999"[\s\S]*restore-unsafe-indexed-epoch[\s\S]*indexerPreservation\.latestIndexedEpochBefore must be a non-negative integer/,
    "proof draft regressions must cover unsafe restore indexer preservation epoch evidence",
  );
  assert.ok(
    proofDraftRegressionSource.includes('import { redactProofText } from "./redact-proof-output.mjs";') &&
      proofDraftRegressionSource.includes("function oneLine(output)") &&
      proofDraftRegressionSource.includes("redactProofText(output)") &&
      proofDraftRegressionSource.includes("[A-Za-z]:\\\\") &&
      proofDraftRegressionSource.includes("(^|[\\s|`\"'])\\/"),
    "proof draft regression table must redact child validator output and compact absolute paths before evidence rows",
  );
  assert.match(
    proofDraftRegressionSource,
    /summaryOnly[\s\S]*Rows: total=\$\{rows\.length\}[\s\S]*printTable\(\["Draft", "Strict Result", "Exit", "Evidence"\]/,
    "proof draft regression summary mode must avoid printing the full evidence table",
  );
  assert.match(
    proofDraftRegressionSource,
    /const tempDirs = \[\][\s\S]*function makeTempDir\(prefix\)[\s\S]*tempDirs\.push\(dir\)[\s\S]*for \(const tempDir of tempDirs\)[\s\S]*rmSync\(tempDir,\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}\)/,
    "proof draft regression guard must clean up temporary fixture directories",
  );
  assert.match(
    proofDraftRegressionSource,
    /restore-valid-strict-proof[\s\S]*Summary: backup\\\/restore drill completed without detected issues/,
    "proof draft regression suite must include a positive strict restore proof case",
  );
  assert.match(
    proofDraftRegressionSource,
    /signoff-valid-strict-proof[\s\S]*Summary: contract\\\/funds sign-off proof completed without detected issues/,
    "proof draft regression suite must include a positive strict signoff proof case",
  );
  assert.match(
    proofDraftRegressionSource,
    /signoff-future-timestamp[\s\S]*contractEnv\.checkedAt must not be in the future/,
    "proof draft regression suite must reject strict signoff proof with future-dated evidence timestamps",
  );
  assert.match(
    proofDraftRegressionSource,
    /host-valid-strict-proof[\s\S]*Summary: production host proof completed without detected issues/,
    "proof draft regression suite must include a positive strict host proof case",
  );
  assert.match(
    proofDraftRegressionSource,
    /host-future-timestamp[\s\S]*processModel\.lore-site\.checkedAt must not be in the future/,
    "proof draft regression suite must reject strict host proof with future-dated evidence timestamps",
  );
  assert.ok(
    proofDraftRegressionSource.includes("host-collector-credentialed-origin") &&
      proofDraftRegressionSource.includes("host-collector-credentialed-health-base") &&
      proofDraftRegressionSource.includes("host-collector-credentialed-load-base") &&
      proofDraftRegressionSource.includes("host-draft-credentialed-origin") &&
      proofDraftRegressionSource.includes("host-draft-credentialed-health-base") &&
      proofDraftRegressionSource.includes("host-draft-credentialed-load-base") &&
      proofDraftRegressionSource.includes("host-credentialed-origin"),
    "proof draft regression suite must reject credentialed host proof origins and evidence base URLs in collector, draft, and strict validation",
  );
  assert.match(
    proofDraftRegressionSource,
    /monitoring-valid-strict-proof[\s\S]*Summary: monitoring proof completed without detected issues/,
    "proof draft regression suite must include a positive strict monitoring proof case",
  );
  assert.match(
    proofDraftRegressionSource,
    /monitoring-shared-alert-recovery-artifact[\s\S]*fired-alert and recovery evidence must use distinct artifact files/,
    "proof draft regression suite must reject a monitoring proof that reuses one artifact for fired-alert and recovery evidence",
  );
  assert.match(
    proofDraftRegressionSource,
    /monitoring-shared-section-artifact[\s\S]*monitoring evidence sections must use distinct local artifact files across monitors and alertTargets/,
    "proof draft regression suite must reject strict monitoring proof that reuses one artifact across monitoring evidence sections",
  );
  assert.match(
    proofDraftRegressionSource,
    /monitoring-malformed-health-cadence[\s\S]*health-prod monitor cadence must be a canonical positive integer/,
    "proof draft regression suite must reject malformed monitoring cadence evidence",
  );
  assert.ok(
    proofDraftRegressionSource.includes("monitoring-draft-credentialed-origin") &&
      proofDraftRegressionSource.includes("monitoring-credentialed-origin") &&
      proofDraftRegressionSource.includes("monitoring-credentialed-monitor-url"),
    "proof draft regression suite must reject credentialed monitoring proof origins and monitor endpoint URLs",
  );
  assert.match(
    proofDraftRegressionSource,
    /monitoring-shared-draft-alert-recovery-artifact[\s\S]*--monitor-artifact and --recovery-artifact must point to distinct fired-alert and recovery evidence files/,
    "proof draft regression suite must reject monitoring drafts that reuse one artifact for fired-alert and recovery evidence",
  );
  assert.match(
    proofDraftRegressionSource,
    /monitoring-shared-draft-section-artifact[\s\S]*--monitor-artifact and --alert-target-artifact must point to distinct monitoring evidence files/,
    "proof draft regression suite must reject monitoring drafts that reuse one artifact across monitoring evidence sections",
  );
  assert.match(
    proofDraftRegressionSource,
    /qa-shared-wallet-failure-artifact[\s\S]*--wallet-artifact and --failure-artifact must point to distinct QA evidence files/,
    "proof draft regression suite must reject QA drafts that reuse one artifact across QA evidence groups",
  );
  assert.match(
    proofDraftRegressionSource,
    /qa-shared-group-artifact[\s\S]*QA evidence groups must use distinct local artifact files across wallet and failureStateUx/,
    "proof draft regression suite must reject strict QA proof that reuses one artifact across QA evidence groups",
  );
  assert.match(
    proofDraftRegressionSource,
    /restore-shared-section-artifact[\s\S]*restore evidence sections must use distinct local artifact files across backupSchedule and restoreDrill/,
    "proof draft regression suite must reject strict restore proof that reuses one artifact across restore evidence sections",
  );
  assert.match(
    proofDraftRegressionSource,
    /restore-future-timestamp[\s\S]*restoreDrill\.timestamp must not be in the future/,
    "proof draft regression suite must reject strict restore proof with future-dated evidence timestamps",
  );
  assert.match(
    proofDraftRegressionSource,
    /restore-collector-shared-artifact-input[\s\S]*--restore-log and --health-log must point to distinct restore evidence files/,
    "proof draft regression suite must reject restore collector inputs that reuse one artifact across evidence inputs",
  );
  assert.match(
    proofDraftRegressionSource,
    /restore-draft-shared-artifact-input[\s\S]*--restore-log and --health-log must point to distinct restore evidence files/,
    "proof draft regression suite must reject restore draft inputs that reuse one artifact across evidence inputs",
  );
  assert.match(
    proofDraftRegressionSource,
    /indexer-valid-strict-proof[\s\S]*Summary: indexer dry-run proof completed without detected issues/,
    "proof draft regression suite must include a positive strict indexer proof case",
  );
  assert.match(
    proofDraftRegressionSource,
    /indexer-future-timestamp[\s\S]*dryRun\.timestamp must not be in the future/,
    "proof draft regression suite must reject strict indexer proof with future-dated evidence timestamps",
  );
  assert.match(
    proofDraftRegressionSource,
    /indexer-collector-credentialed-rpc-source[\s\S]*indexer-draft-credentialed-rpc-source[\s\S]*rpcSource must be a redacted label or origin-only URL/,
    "proof draft regression suite must reject credentialed or path-sensitive indexer RPC source snapshots before draft writes",
  );
  assert.ok(
    proofDraftRegressionSource.includes("indexer-collector-credentialed-health-base") &&
      proofDraftRegressionSource.includes("indexer-draft-credentialed-health-base"),
    "proof draft regression suite must reject credentialed indexer health base URLs before proof writes",
  );
  assert.ok(
    proofDraftRegressionSource.includes("restore-collector-credentialed-health-base") &&
      proofDraftRegressionSource.includes("restore-draft-credentialed-health-base"),
    "proof draft regression suite must reject credentialed restore health base URLs before proof writes",
  );
  assert.match(
    proofDraftRegressionSource,
    /qa-valid-strict-proof[\s\S]*Summary: QA proof completed without detected issues/,
    "proof draft regression suite must include a positive strict QA proof case",
  );
  for (const launchGateScript of ["scripts/check-launch-gates.mjs", "scripts/report-launch-remaining.mjs"]) {
    const launchGateSource = readFileSync(launchGateScript, "utf8");
    assert.match(
      launchGateSource,
      /"G8"[\s\S]*backupSchedule[\s\S]*retentionDays[\s\S]*lastSuccessfulBackupAt/,
      `${launchGateScript} must keep restore retention/latest-success markers visible in launch gates`,
    );
    assert.match(
      launchGateSource,
      /MAX_CANARY_LOG_PATHS = 16[\s\S]*function findLiveCanaryLogPaths\(value\)[\s\S]*pattern\.exec\(normalized\)[\s\S]*paths\.length >= MAX_CANARY_LOG_PATHS/,
      `${launchGateScript} must cap live canary log path extraction without materializing match arrays`,
    );
    assert.doesNotMatch(
      launchGateSource,
      /\[\.\.\.normalizeEvidencePath\(value\)\.matchAll/,
      `${launchGateScript} must not spread canary log path matchAll output into an array`,
    );
  }
  const proofPackageScripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
  assert.match(
    proofPackageScripts["baseline:bundle:summary"],
    /measure-build-output\.mjs --summary-only/,
    "bundle baseline summary script must use the non-writing summary mode",
  );
  assert.match(
    proofPackageScripts["proof:deps:all"],
    /--include-dev --allow-known-dev-toolchain-high/,
    "full dependency audit must allow only the documented dev-toolchain exception path",
  );
  assert.equal(
    proofPackageScripts["proof:deps:summary"],
    "node scripts/check-production-dependency-audit.mjs --summary-only",
    "production dependency audit must expose a compact summary command",
  );
  assert.match(
    proofPackageScripts["proof:deps:all:summary"],
    /--include-dev --allow-known-dev-toolchain-high --summary-only/,
    "full dependency audit summary must preserve the documented dev-toolchain exception path",
  );
  assert.equal(
    proofPackageScripts["proof:wallet-deps:summary"],
    "node scripts/check-wallet-dependencies.mjs",
    "wallet dependency integrity must expose a compact summary command",
  );
  const buildOutputSource = readFileSync("scripts/measure-build-output.mjs", "utf8");
  assert.match(
    buildOutputSource,
    /summaryOnly[\s\S]*status: budgetIssues\.length === 0 \? "pass" : "fail"[\s\S]*totalBytes[\s\S]*jsBytes[\s\S]*largestJsBytes[\s\S]*largestJsFile[\s\S]*largestFiles[\s\S]*budget[\s\S]*budgetIssues[\s\S]*process\.exit\(\)[\s\S]*fs\.writeFile/,
    "bundle baseline summary mode must print compact budget-aware JSON, include top offenders and largest JS chunk, and exit before writing artifact files",
  );
  assert.match(
    buildOutputSource,
    /BUNDLE_BASELINE_MAX_TOTAL_BYTES[\s\S]*BUNDLE_BASELINE_MAX_JS_BYTES[\s\S]*BUNDLE_BASELINE_MAX_SINGLE_JS_BYTES[\s\S]*BUNDLE_BASELINE_MAX_WASM_BYTES[\s\S]*largestJsBytes[\s\S]*budgetIssues\.push[\s\S]*process\.exitCode = 1/,
    "bundle baseline must fail closed when static production output or largest JS chunk exceeds configured budgets",
  );
  assert.match(
    buildOutputSource,
    /POSITIVE_INTEGER_ENV_RE = \/\^\[1-9\]\\d\{0,15\}\$\/[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*POSITIVE_INTEGER_ENV_RE\.test\(raw\)[\s\S]*const parsed = BigInt\(raw\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)/,
    "bundle baseline budget env values must be canonical positive safe integers before display-safe narrowing",
  );
  assert.doesNotMatch(
    buildOutputSource,
    /const parsed = Number\(raw\)|Number\.isSafeInteger\(parsed\)/,
    "bundle baseline budget env parsing must not narrow arbitrary strings through broad Number(raw) coercion",
  );
  assert.equal(
    buildOutputSource.includes("/^\\d+$/"),
    false,
    "bundle baseline budget env parsing must not accept arbitrary digit strings before Number coercion",
  );
  const dependencyAuditSource = readFileSync("scripts/check-production-dependency-audit.mjs", "utf8");
  assert.match(
    dependencyAuditSource,
    /knownDevToolchainHighNames[\s\S]*eslint-config-next[\s\S]*function isKnownDevToolchainHigh[\s\S]*blockingHighCritical/,
    "dependency audit must limit high-advisory exceptions to the known dev ESLint toolchain list",
  );
  assert.doesNotMatch(
    dependencyAuditSource,
    /item\.severity === "critical"[\s\S]*isKnownDevToolchainHigh/,
    "dependency audit must not allow critical advisories through the dev-toolchain exception",
  );
  assert.match(
    dependencyAuditSource,
    /import \{ redactProofText \} from "\.\/redact-proof-output\.mjs"[\s\S]*function describeAuditError\(error\)[\s\S]*redactProofText\(/,
    "dependency audit startup failures must use the shared proof redactor",
  );
  assert.match(
    dependencyAuditSource,
    /MAX_AUDIT_ERROR_CHARS[\s\S]*<truncated>[\s\S]*npm audit could not be started: \$\{describeAuditError\(result\.error\)\}/,
    "dependency audit startup failures must be compact and bounded",
  );
  assert.match(
    dependencyAuditSource,
    /const summaryOnly = process\.argv\.includes\("--summary-only"\)[\s\S]*status: "fail"[\s\S]*issue: "audit-startup"[\s\S]*status: "fail"[\s\S]*issue: "audit-json"[\s\S]*status: blockingHighCritical\.length > 0 \|\| countIssues\.size > 0 \? "fail" : "pass"[\s\S]*knownDevToolchainHigh: allowedKnownDevToolchainHigh\.length/,
    "dependency audit summary mode must emit bounded JSON for startup, parse, and advisory-count outcomes",
  );
  assert.match(
    dependencyAuditSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function nonNegativeSafeInteger\(value\)[\s\S]*typeof value === "number"[\s\S]*Number\.isSafeInteger\(value\) && value >= 0[\s\S]*\^\(\?:0\|\[1-9\]\\d\{0,15\}\)\$[\s\S]*const parsed = BigInt\(text\)[\s\S]*parsed <= MAX_SAFE_INTEGER_BIGINT \? Number\(parsed\) : null[\s\S]*function countOf\(name\)[\s\S]*countIssues\.add\(`metadata-\$\{name\}`\)[\s\S]*issue: "audit-counts"/,
    "dependency audit summary must canonical-parse npm audit metadata counters and fail closed on malformed count evidence",
  );
  assert.doesNotMatch(
    dependencyAuditSource,
    /Number\(counts\[name\]|const parsed = Number\(text\)/,
    "dependency audit summary must not broadly coerce npm audit metadata counters",
  );
  assert.match(
    dependencyAuditSource,
    /npm audit did not return parseable JSON output[\s\S]*Output sample: \$\{describeAuditError\(raw\)\}/,
    "dependency audit parse failures must print only a compact redacted output sample",
  );
  assert.doesNotMatch(
    dependencyAuditSource,
    /raw\.split\([\s\S]*slice\(0,\s*20\)/,
    "dependency audit parse failures must not dump raw npm output lines",
  );
  const walletDependencySource = readFileSync("scripts/check-wallet-dependencies.mjs", "utf8");
  assert.match(
    walletDependencySource,
    /requiredPackages = \["@privy-io\/react-auth", "@privy-io\/wagmi", "wagmi", "viem"\][\s\S]*npm\.cmd \$\{auditArgs\.join\(" "\)\}[\s\S]*JSON\.parse\(raw\)[\s\S]*status: missing\.length > 0 \|\| result\.status !== 0 \? "fail" : "pass"/,
    "wallet dependency summary must parse npm ls JSON for the required Privy, wagmi, and viem packages",
  );
  assert.match(
    walletDependencySource,
    /redactProofText[\s\S]*compactError[\s\S]*issue: "npm-ls-json"[\s\S]*sample: compactError\(raw\)/,
    "wallet dependency summary must redact and clamp npm ls startup and parse failures",
  );
  const lineaEstimateGasShadowSource = readFileSync("app/lib/lineaEstimateGasShadow.ts", "utf8");
  const miningRuntimeHelpersSource = readFileSync("app/hooks/useMiningRuntimeHelpers.ts", "utf8");
  const miningRoundPlanningSource = readFileSync("app/hooks/useMiningRoundPlanning.ts", "utf8");
  const autoMineLoopModelSource = readFileSync("app/lib/mining/autoMineLoopModel.ts", "utf8");
  const autoMineLoopRoundCommandSource = readFileSync("app/lib/mining/autoMineLoopRoundCommand.ts", "utf8");
  const gasShadowBootstrapResolveRouteSource = readFileSync("app/api/bootstrap-resolve/route.ts", "utf8");
  const gasShadowLiveRoundCanarySource = readFileSync("scripts/live-round-canary.ts", "utf8");
  assert.match(
    lineaEstimateGasShadowSource,
    /const shadowedKeys = new Set<string>\(\)[\s\S]*NEXT_PUBLIC_LINEA_ESTIMATE_GAS_SHADOW === "1" \|\| process\.env\.LINEA_ESTIMATE_GAS_SHADOW === "1"[\s\S]*method: "linea_estimateGas"[\s\S]*ratioBps\(lineaGas, options\.baselineGas\)/,
    "linea_estimateGas shadow evidence must be opt-in, one-shot per key, and compare against the existing baseline estimate",
  );
  assert.match(
    lineaEstimateGasShadowSource,
    /function classifyShadowUnavailableReason\(error[\s\S]*method-unsupported[\s\S]*rate-limited[\s\S]*log\.info\("GasShadow", "linea_estimateGas shadow"[\s\S]*reason: classifyShadowUnavailableReason\(error\)/,
    "linea_estimateGas shadow evidence must use sanitized token reasons for fail-closed fallback",
  );
  assert.doesNotMatch(
    lineaEstimateGasShadowSource,
    /reason: error instanceof Error \? error\.message : String\(error\)/,
    "linea_estimateGas shadow fallback must not persist raw provider error messages",
  );
  assert.match(
    miningRuntimeHelpersSource,
    /const est = await withMiningRpcTimeout\(pc\.estimateContractGas[\s\S]*recordLineaEstimateGasShadow\(\{[\s\S]*baselineGas: est[\s\S]*const withBuffer = \(est \* 180n\) \/ 100n \+ bufferExtra[\s\S]*return withBuffer > minGas \? withBuffer : minGas/,
    "wallet mining gas shadow must not replace the existing gas estimate used for transactions",
  );
  assert.match(
    miningRuntimeHelpersSource,
    /function formatNativeWeiSixDecimals[\s\S]*10n \*\* 18n[\s\S]*1_000_000n[\s\S]*roundedFraction[\s\S]*const have = formatNativeWeiSixDecimals\(balance\)[\s\S]*const need = formatNativeWeiSixDecimals\(requiredCost\)[\s\S]*Not enough ETH for gas: need ~\$\{need\} ETH, have \$\{have\} ETH/,
    "wallet mining gas-balance copy must format wei values with bigint arithmetic",
  );
  assert.doesNotMatch(
    miningRuntimeHelpersSource,
    /Number\(balance\) \/ 1e18|Number\(requiredCost\) \/ 1e18|need\.toFixed\(6\)|have\.toFixed\(6\)/,
    "wallet mining gas-balance copy must not convert wei bigint values through Number formatting",
  );
  assert.match(
    miningRoundPlanningSource,
    /neededAmount: string;[\s\S]*currentAmount: string;[\s\S]*function formatLineaWeiOneDecimal[\s\S]*10n \*\* 18n[\s\S]*roundedTenths[\s\S]*neededAmount: formatLineaWeiOneDecimal\(roundCostActual\)[\s\S]*currentAmount: formatLineaWeiOneDecimal\(tokenBalance\)/,
    "Auto-Miner round planning insufficient-balance amounts must be exact display strings",
  );
  assert.match(
    autoMineLoopRoundCommandSource,
    /stop-insufficient-balance"; neededAmount: string; currentAmount: string/,
    "Auto-Miner round command insufficient-balance amounts must remain display strings",
  );
  assert.match(
    autoMineLoopModelSource,
    /stop-insufficient-balance"; neededAmount: string; currentAmount: string[\s\S]*Stopped: need \$\{event\.neededAmount\} LINEA, have \$\{event\.currentAmount\} LINEA/,
    "Auto-Miner loop insufficient-balance reducer must render exact display strings",
  );
  assert.match(
    autoMineLoopModelSource,
    /formatRetryWaitSeconds\(event\.waitMs\)/,
    "Auto-Miner loop state retry progress must format wait seconds through the shared bounded helper",
  );
  assert.doesNotMatch(
    `${miningRoundPlanningSource}\n${autoMineLoopModelSource}`,
    /Number\(roundCostActual\) \/ 1e18|Number\(tokenBalance\) \/ 1e18|neededAmount\.toFixed\(1\)|currentAmount\.toFixed\(1\)|\(event\.waitMs \/ 1000\)\.toFixed\(0\)/,
    "Auto-Miner insufficient-balance and retry progress flows must not convert token wei or wait values through raw Number formatting",
  );
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
  const cleanupWorkspaceSource = readFileSync("scripts/cleanup-workspace.mjs", "utf8");
  const cleanupPackageScripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
  assert.equal(
    cleanupPackageScripts["cleanup:workspace:dry-run"],
    "node scripts/cleanup-workspace.mjs --dry-run",
    "workspace cleanup must expose a dry-run command before destructive use",
  );
  assert.equal(
    cleanupPackageScripts["cleanup:workspace:dry-run:summary"],
    "node scripts/cleanup-workspace.mjs --dry-run --summary-only",
    "autonomous workspace cleanup must expose a target-redacted dry-run summary command",
  );
  assert.equal(
    cleanupPackageScripts["cleanup:workspace"],
    "node scripts/cleanup-workspace.mjs",
    "workspace cleanup must expose the same allowlisted script for scheduled use",
  );
  assert.equal(
    cleanupPackageScripts["cleanup:workspace:summary"],
    "node scripts/cleanup-workspace.mjs --summary-only",
    "autonomous workspace cleanup must expose a target-redacted apply summary command",
  );
  assert.equal(
    cleanupPackageScripts["cleanup:workspace:autonomous"],
    "node scripts/run-autonomous-cleanup.mjs",
    "autonomous workspace cleanup must dry-run and validate before apply",
  );
  assert.equal(
    cleanupPackageScripts["cleanup:workspace:loop:start"],
    "node scripts/manage-workspace-cleanup-loop.mjs start",
    "workspace cleanup loop must have an operator start command",
  );
  assert.equal(
    cleanupPackageScripts["cleanup:workspace:loop:status"],
    "node scripts/manage-workspace-cleanup-loop.mjs status",
    "workspace cleanup loop must have an operator status command",
  );
  assert.equal(
    cleanupPackageScripts["cleanup:workspace:loop:stop"],
    "node scripts/manage-workspace-cleanup-loop.mjs stop",
    "workspace cleanup loop must have an operator stop command",
  );
  assert.match(
    cleanupWorkspaceSource,
    /parseDecimalHoursEnv\("CLEANUP_MIN_AGE_HOURS", 8, \{ min: 0, max: 100_000 \}\)[\s\S]*const deleteWholeTargets = \[[\s\S]*"\.next\/cache"[\s\S]*"playwright-report"[\s\S]*"test-results"[\s\S]*"coverage"[\s\S]*const agedChildTargets = \[[\s\S]*"\.tmp"/,
    "workspace cleanup must stay limited to generated cache/report directories and aged .tmp children",
  );
  assert.match(
    cleanupWorkspaceSource,
    /DECIMAL_HOURS_RE[\s\S]*DECIMAL_HOUR_SCALE = 1000n[\s\S]*MILLISECONDS_PER_HOUR = 60n \* 60n \* 1000n[\s\S]*const minAge = parseDecimalHoursEnv\("CLEANUP_MIN_AGE_HOURS", 8, \{ min: 0, max: 100_000 \}\)[\s\S]*minAgeMs = minAge\.milliseconds[\s\S]*function parseDecimalHoursEnv\(name, fallback, \{ min, max \}\)[\s\S]*const thousandths = parseDecimalHoursToThousandths\(value, name\)[\s\S]*const milliseconds = \(thousandths \* MILLISECONDS_PER_HOUR\) \/ DECIMAL_HOUR_SCALE[\s\S]*function parseDecimalHoursToThousandths\(value, name\)[\s\S]*const whole = BigInt\(match\[1\]\)[\s\S]*const fraction = BigInt\(\(match\[2\] \?\? ""\)\.padEnd\(3, "0"\) \|\| "0"\)/,
    "workspace cleanup must strictly parse decimal hour age thresholds before deletion checks",
  );
  assert.doesNotMatch(
    cleanupWorkspaceSource,
    /const parsed = Number\(value\)|Number\.isFinite\(parsed\)/,
    "workspace cleanup must not narrow age thresholds through broad Number(value) coercion",
  );
  assert.doesNotMatch(
    cleanupWorkspaceSource,
    /Number\.parseFloat\(process\.env\.CLEANUP_MIN_AGE_HOURS/,
    "workspace cleanup must not partially parse age thresholds",
  );
  assert.match(
    cleanupWorkspaceSource,
    /function normalizeByteCount\(value\)[\s\S]*Number\.isSafeInteger\(value\) && value >= 0[\s\S]*function formatBytes\(bytes\)[\s\S]*bytes = normalizeByteCount\(bytes\)/,
    "workspace cleanup must normalize byte counts before formatting autonomous summaries",
  );
  assert.match(
    cleanupWorkspaceSource,
    /total \+= normalizeByteCount\(await sizeOf\(join\(target, entry\.name\)\)\)[\s\S]*return normalizeByteCount\(total\)[\s\S]*const bytes = normalizeByteCount\(deleted\.reduce\(\(sum, item\) => sum \+ normalizeByteCount\(item\.bytes\), 0\)\)/,
    "workspace cleanup must aggregate only non-negative safe byte counts",
  );
  assert.match(
    cleanupWorkspaceSource,
    /const summaryOnly = process\.argv\.includes\("--summary-only"\)[\s\S]*if \(!summaryOnly\)[\s\S]*summary\.targets/,
    "workspace cleanup summary mode must omit raw target paths for autonomous status output",
  );
  assert.match(
    cleanupWorkspaceSource,
    /function isInsideRoot\(target\)[\s\S]*rel !== ""[\s\S]*!rel\.startsWith\("\.\."\)[\s\S]*!rel\.startsWith\("\\\\"\)/,
    "workspace cleanup must refuse the repo root and paths outside the current workspace",
  );
  assert.match(
    cleanupWorkspaceSource,
    /const info = await lstat\(target\)\.catch\(\(\) => null\);[\s\S]*if \(!info\) return \{ target, skipped: true, reason: "missing", bytes: 0 \};[\s\S]*const bytes = await sizeOf\(target\);[\s\S]*if \(!dryRun\) await rm\(target, \{ recursive: true, force: true \}\);/,
    "workspace cleanup must delete existing empty allowlisted directories instead of leaving stale report/cache folders behind",
  );
  assert.match(
    cleanupWorkspaceSource,
    /async function newestMtimeMs\(target\)[\s\S]*for \(const entry of entries\) newest = Math\.max\(newest, await newestMtimeMs\(join\(target, entry\.name\)\)\);[\s\S]*async function maybeDelete\(target, requireAge = false\)[\s\S]*if \(requireAge\)[\s\S]*reason: "too-new"[\s\S]*for \(const target of deleteWholeTargets\) results\.push\(await maybeDelete\(target, true\)\);/,
    "workspace cleanup must age-gate whole cache/report directories by their newest nested file before deletion",
  );
  assert.doesNotMatch(
    cleanupWorkspaceSource,
    /"(\.env[^"]*|node_modules|artifacts|contracts|package-lock[^"]*|LORE_DB_PATH)"|rm\(root/,
    "workspace cleanup must not target secrets, dependencies, contracts, lockfiles, databases, or the repo root",
  );
  const autonomousCleanupSource = readFileSync("scripts/run-autonomous-cleanup.mjs", "utf8");
  assert.match(
    autonomousCleanupSource,
    /cleanup:workspace:dry-run:summary[\s\S]*unsafe-dry-run-summary[\s\S]*cleanup:workspace:summary/,
    "autonomous cleanup must validate a target-redacted dry-run summary before apply",
  );
  assert.match(
    autonomousCleanupSource,
    /maxBuffer = 64 \* 1024[\s\S]*CLEANUP_AUTONOMOUS_TIMEOUT_MS[\s\S]*JSON\.parse/,
    "autonomous cleanup must keep command output bounded and parse compact JSON summaries",
  );
  assert.match(
    autonomousCleanupSource,
    /DECIMAL_INTEGER_RE[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*parsePositiveIntegerEnv\("CLEANUP_AUTONOMOUS_TIMEOUT_MS", 120_000, 1_000, 900_000\)[\s\S]*function parsePositiveIntegerEnv\(name, fallback, min, max\)[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*const numeric = Number\(parsed\)/,
    "autonomous cleanup timeout env must be canonical decimal and range checked",
  );
  assert.doesNotMatch(
    autonomousCleanupSource,
    /Number\.parseInt\(process\.env\.CLEANUP_AUTONOMOUS_TIMEOUT_MS/,
    "autonomous cleanup timeout env must not use partial parseInt coercion",
  );
  assert.match(
    autonomousCleanupSource,
    /function isNonNegativeSafeInteger\(value\)[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*for \(const field of \["matchedTargets", "deletedTargets", "wouldDeleteTargets", "skippedTargets", "bytes"\]\)[\s\S]*isNonNegativeSafeInteger\(parsed\[field\]\)/,
    "autonomous cleanup must reject fractional, negative, or unsafe summary counts before apply",
  );
  assert.doesNotMatch(
    autonomousCleanupSource,
    /summary\.targets|stderr|node_modules|["']\.env|process\.kill|rm\(/,
    "autonomous cleanup wrapper must not print raw target paths, target secrets/dependencies, kill processes, or delete directly",
  );
  const cleanupLoopSource = readFileSync("scripts/cleanup-workspace-loop.mjs", "utf8");
  const cleanupLoopManagerSource = readFileSync("scripts/manage-workspace-cleanup-loop.mjs", "utf8");
  assert.match(
    cleanupLoopSource,
    /workspace-cleanup-loop\.pid[\s\S]*parseDecimalHoursEnv\("CLEANUP_INTERVAL_HOURS", 8, \{ min: 0\.001, max: 8_760 \}\)[\s\S]*cleanup-workspace\.mjs/,
    "workspace cleanup loop must run the allowlisted cleanup script at the configured 8h default interval",
  );
  assert.match(
    cleanupLoopSource,
    /DECIMAL_HOURS_RE[\s\S]*DECIMAL_HOUR_SCALE = 1000n[\s\S]*MILLISECONDS_PER_HOUR = 60n \* 60n \* 1000n[\s\S]*const interval = parseDecimalHoursEnv\("CLEANUP_INTERVAL_HOURS", 8, \{ min: 0\.001, max: 8_760 \}\)[\s\S]*intervalMs = interval\.milliseconds[\s\S]*function parseDecimalHoursEnv\(name, fallback, \{ min, max \}\)[\s\S]*const thousandths = parseDecimalHoursToThousandths\(value, name\)[\s\S]*const milliseconds = \(thousandths \* MILLISECONDS_PER_HOUR\) \/ DECIMAL_HOUR_SCALE[\s\S]*function parseDecimalHoursToThousandths\(value, name\)[\s\S]*const whole = BigInt\(match\[1\]\)[\s\S]*const fraction = BigInt\(\(match\[2\] \?\? ""\)\.padEnd\(3, "0"\) \|\| "0"\)/,
    "workspace cleanup loop must strictly parse decimal hour intervals before scheduling",
  );
  assert.doesNotMatch(
    cleanupLoopSource,
    /const parsed = Number\(value\)|Number\.isFinite\(parsed\)/,
    "workspace cleanup loop must not narrow schedule intervals through broad Number(value) coercion",
  );
  assert.doesNotMatch(
    cleanupLoopSource,
    /Number\.parseFloat\(process\.env\.CLEANUP_INTERVAL_HOURS/,
    "workspace cleanup loop must not partially parse schedule intervals",
  );
  assert.match(
    cleanupLoopSource,
    /workspace-cleanup-loop\.stop[\s\S]*lore-workspace-cleanup-loop[\s\S]*shouldStop\(\)[\s\S]*waitForNextRun\(\)[\s\S]*rm\(pidFile, \{ force: true \}\)/,
    "workspace cleanup loop must use a cooperative stop marker and typed pid record instead of relying on blind PID termination",
  );
  assert.match(
    cleanupLoopSource,
    /TRACKED_PID_RE = \/\^\[1-9\]\\d\{0,9\}\$\/[\s\S]*MAX_TRACKED_PID = 2_147_483_647[\s\S]*MAX_TRACKED_PID_BIGINT = BigInt\(MAX_TRACKED_PID\)[\s\S]*function parseTrackedPid\(value\)[\s\S]*const pid = BigInt\(raw\)[\s\S]*pid <= MAX_TRACKED_PID_BIGINT \? Number\(pid\) : null[\s\S]*async function existingLoopPid\(\)[\s\S]*JSON\.parse\(raw \|\| "\{\}"\)[\s\S]*parseTrackedPid\(parsedPid\)/,
    "workspace cleanup loop must strictly parse typed or legacy PID records before liveness checks",
  );
  assert.doesNotMatch(
    cleanupLoopSource,
    /Number\.parseInt\(String\(parsed\.pid \?\? raw\.trim\(\)\), 10\)/,
    "workspace cleanup loop must not partially parse stale PID files",
  );
  assert.match(
    cleanupLoopSource,
    /workspace-cleanup-loop\.status\.json[\s\S]*outputLimitBytes = 8192[\s\S]*function safeCleanupSummary[\s\S]*writeLoopStatus[\s\S]*lastRunAt[\s\S]*nextRunAt/,
    "workspace cleanup loop must write bounded autonomous status instead of relying on raw cleanup logs",
  );
  assert.match(
    cleanupLoopSource,
    /function safeDecimalHours\(value, fallback = 8\)[\s\S]*Number\.isFinite\(value\)[\s\S]*value >= 0[\s\S]*function safeNonNegativeInteger\(value, fallback = 0\)[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*matchedTargets: safeNonNegativeInteger\(parsed\.matchedTargets\)[\s\S]*bytes: safeNonNegativeInteger\(parsed\.bytes\)/,
    "workspace cleanup loop status must sanitize child cleanup counts and bytes to non-negative safe integers before writing aggregate status",
  );
  assert.ok(
    cleanupLoopManagerSource.includes('const mode = process.argv[2] ?? "status";') &&
      cleanupLoopManagerSource.includes('resolve(root, "scripts", "cleanup-workspace-loop.mjs")') &&
      cleanupLoopManagerSource.includes("detached: true") &&
      cleanupLoopManagerSource.includes('mode === "start"') &&
      cleanupLoopManagerSource.includes('mode === "status"') &&
      cleanupLoopManagerSource.includes('mode === "stop"'),
    "workspace cleanup loop manager must provide bounded start/status/stop controls",
  );
  assert.match(
    cleanupLoopManagerSource,
    /workspace-cleanup-loop\.stop[\s\S]*lore-workspace-cleanup-loop[\s\S]*trusted: kind === pidRecordKind[\s\S]*running && !trusted \? \{ issue: "legacy-pid-record" \}[\s\S]*async function start\(\)[\s\S]*const \{ pid, trusted \} = await readPidRecord\(\);[\s\S]*trusted \? \{\} : \{ issue: "legacy-pid-record" \}[\s\S]*if \(!trusted\) \{[\s\S]*writeFile\(stopFile, "stop\\n"\)[\s\S]*issue: "legacy-pid-record"/,
    "workspace cleanup loop manager must report untyped legacy PID records and stop them only through a cooperative marker",
  );
  assert.match(
    cleanupLoopManagerSource,
    /TRACKED_PID_RE = \/\^\[1-9\]\\d\{0,9\}\$\/[\s\S]*MAX_TRACKED_PID = 2_147_483_647[\s\S]*MAX_TRACKED_PID_BIGINT = BigInt\(MAX_TRACKED_PID\)[\s\S]*function parseTrackedPid\(value\)[\s\S]*const pid = BigInt\(raw\)[\s\S]*pid <= MAX_TRACKED_PID_BIGINT \? Number\(pid\) : null[\s\S]*async function readPidRecord\(\)[\s\S]*parseTrackedPid\(parsedPid \?\? raw\.trim\(\)\)/,
    "workspace cleanup loop manager must strictly parse typed or legacy PID records before status/start/stop checks",
  );
  assert.doesNotMatch(
    cleanupLoopManagerSource,
    /Number\.parseInt\(String\(parsedPid \?\? raw\.trim\(\)\), 10\)/,
    "workspace cleanup loop manager must not partially parse stale PID files",
  );
  assert.match(
    cleanupLoopManagerSource,
    /workspace-cleanup-loop\.status\.json[\s\S]*function safeNonNegativeInteger\(value\)[\s\S]*Number\.isSafeInteger\(value\) && value >= 0[\s\S]*async function readSafeLoopStatus\(\)[\s\S]*matchedTargets: safeNonNegativeInteger\(parsed\.cleanup\.matchedTargets\)[\s\S]*deletedTargets: safeNonNegativeInteger\(parsed\.cleanup\.deletedTargets\)[\s\S]*skippedTargets: safeNonNegativeInteger\(parsed\.cleanup\.skippedTargets\)[\s\S]*bytes: safeNonNegativeInteger\(parsed\.cleanup\.bytes\)[\s\S]*const loopStatus = await readSafeLoopStatus\(\)/,
    "workspace cleanup loop manager must expose only non-negative safe integer aggregate cleanup status fields",
  );
  assert.match(
    cleanupLoopManagerSource,
    /function safeIsoTimestamp\(value\)[\s\S]*toISOString\(\) !== normalized[\s\S]*const lastRunAt = safeIsoTimestamp\(parsed\.lastRunAt\)[\s\S]*const nextRunAt = safeIsoTimestamp\(parsed\.nextRunAt\)[\s\S]*lastRunAt \? \{ lastRunAt \}[\s\S]*nextRunAt \? \{ nextRunAt \}/,
    "workspace cleanup loop manager must expose only canonical ISO timestamps from loop status files",
  );
  assert.doesNotMatch(
    cleanupLoopManagerSource,
    /Number\.isFinite\(parsed\.cleanup\.bytes\)|Number\.isSafeInteger\(parsed\.cleanup\.(?:matchedTargets|deletedTargets|skippedTargets)\) \? parsed\.cleanup\.(?:matchedTargets|deletedTargets|skippedTargets) : 0|typeof parsed\.(?:lastRunAt|nextRunAt) === "string"/,
    "workspace cleanup loop manager must not accept fractional bytes, negative cleanup counters, or arbitrary timestamp strings in status output",
  );
  assert.match(
    cleanupLoopManagerSource,
    /async function stopRequested\(\)[\s\S]*stop\\n[\s\S]*const requestedStop = await stopRequested\(\)[\s\S]*stopRequested: true/,
    "workspace cleanup loop status must expose cooperative stop requests without killing legacy PIDs",
  );
  assert.doesNotMatch(
    cleanupLoopManagerSource,
    /targets|stdout|stderr(?!Bytes)/,
    "workspace cleanup loop manager must not print raw cleanup targets or raw command output",
  );
  assert.doesNotMatch(
    cleanupLoopManagerSource,
    /process\.kill\(pid\)/,
    "workspace cleanup loop manager must not blindly terminate arbitrary processes from a stale PID file",
  );
  const launchProofRunnerSource = readFileSync("scripts/run-launch-proof.mjs", "utf8");
  assert.ok(
    launchProofRunnerSource.includes(
      "known dev-toolchain high advisory exception\\(s\\), 0 blocking high\\/critical advisories",
    ),
    "launch proof summary parser must accept the documented dev-toolchain audit exception summary",
  );
  assert.match(
    launchProofRunnerSource,
    /function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*function scriptFileExists\(scriptPath\)[\s\S]*regularFileStat\(scriptPath\) !== null[\s\S]*scriptFileExists\(scriptPath\)/,
    "launch proof runner must reject directory check script paths before spawning",
  );
  assert.match(
    launchProofRunnerSource,
    /const summaryOnly = process\.argv\.includes\("--summary-only"\)/,
    "launch proof runner must support compact summary mode",
  );
  assert.match(
    launchProofRunnerSource,
    /if \(summaryOnly\) \{[\s\S]*Would run child checks: false[\s\S]*process\.exit\(process\.exitCode \?\? 0\);[\s\S]*for \(const check of checks\)/,
    "launch proof summary mode must exit before child proof checks",
  );
  assert.ok(
    launchProofRunnerSource.includes(
      'Canary log: ${summaryOnly ? (canaryLog ? "present" : "missing") : (canaryLog || "missing")}',
    ),
    "launch proof summary mode must not print the canary log path",
  );
  const localProofPreflightSource = readFileSync("scripts/run-local-proof-preflight.mjs", "utf8");
  assert.match(
    localProofPreflightSource,
    /const summaryOnly = process\.argv\.includes\("--summary-only"\)/,
    "local launch preflight must support compact summary mode",
  );
  assert.match(
    localProofPreflightSource,
    /Regression artifact writes: false/,
    "local launch preflight summary must clearly report that regression artifacts are not written",
  );
  assert.match(
    localProofPreflightSource,
    /summaryArgs: \["--strict", "--summary-only"\][\s\S]*summaryExpectedFailurePattern/,
    "local launch preflight summary must use compact strict launch status instead of the full child launch proof",
  );
  assert.match(
    localProofPreflightSource,
    /label:\s*"security follow-up"[\s\S]*script:\s*"scripts\/check-security-followup\.mjs"[\s\S]*summaryArgs: \["--summary-only"\][\s\S]*summaryCleanPattern:[\s\S]*"checks":\\s\*8[\s\S]*"failedIds":\\s\*\\\[\\\][\s\S]*"appResolveEpochFiles":\\s\*0/,
    "local launch preflight must include residual security follow-up with a compact summary-mode assertion",
  );
  assert.match(
    localProofPreflightSource,
    /const cleanPattern = summaryOnly && check\.summaryCleanPattern[\s\S]*: check\.cleanPattern[\s\S]*exitCode === 0 && cleanPattern\.test\(output\)/,
    "local launch preflight must honor summary-specific clean patterns for compact JSON checks",
  );
  assert.match(
    localProofPreflightSource,
    /function nonNegativeIntegerField\(value\)[\s\S]*Number\.isSafeInteger\(value\) && value >= 0[\s\S]*function safeTokenList\(value\)[\s\S]*function safeStatus\(value\)[\s\S]*"checks" in parsed && "failedIds" in parsed[\s\S]*appResolveEpochFiles[\s\S]*status=\$\{safeStatus\(parsed\.status\)\}, checks=\$\{nonNegativeIntegerField\(parsed\.checks\)\}, passed=\$\{nonNegativeIntegerField\(parsed\.passed\)\}, failed=\$\{nonNegativeIntegerField\(parsed\.failed\)\}, failedIds=\$\{failedIds\}\$\{appResolveEpochFiles\}/,
    "local launch preflight must surface compact security follow-up counts instead of a generic JSON summary",
  );
  assert.match(
    localProofPreflightSource,
    /Array\.isArray\(parsed\.checks\)[\s\S]*const failed = parsed\.checks\.filter[\s\S]*failedIds = safeTokenList\(failed\.map\(\(entry\) => entry\?\.id\)\)[\s\S]*status=\$\{safeStatus\(parsed\.status\)\}, checks=\$\{parsed\.checks\.length\}, passed=\$\{parsed\.checks\.length - failed\.length\}, failed=\$\{failed\.length\}, failedIds=\$\{failedIds\}/,
    "local launch preflight must summarize full security follow-up diagnostic JSON without dumping each check",
  );
  assert.doesNotMatch(
    localProofPreflightSource.match(/function summarizeOutput\(output\)[\s\S]*?function printTable/)?.[0] ?? "",
    /status=\$\{parsed\.status\}|checks=\$\{parsed\.checks \?\? 0\}|String\(entry\?\.(?:id)? \?\? ""\)\.replace/,
    "local launch preflight must not print raw child status, counters, or failedIds from JSON summaries",
  );
  assert.match(
    localProofPreflightSource,
    /summaryExpectedFailurePattern:[\s\S]*groups: launch=1/,
    "local launch preflight summary must treat the compact launch blocker group as an expected strict-fail status",
  );
  assert.match(
    localProofPreflightSource,
    /!summaryOnly && check\.withTemporaryChainSnapshot[\s\S]*!summaryOnly && check\.withUnexpectedProofRegression[\s\S]*!summaryOnly && check\.withAuxiliarySnapshotContentRegression[\s\S]*!summaryOnly && check\.withCanaryLogShapeRegression/,
    "local launch preflight summary must skip temporary proof/canary regression artifact writes",
  );
  assert.match(
    localProofPreflightSource,
    /label:\s*"production dependency audit"[\s\S]*check-production-dependency-audit\.mjs[\s\S]*production dependency audit passed with no high or critical advisories/,
    "local launch preflight must include the strict production dependency audit",
  );
  assert.match(
    localProofPreflightSource,
    /label:\s*"full dependency\/toolchain audit"[\s\S]*--include-dev[\s\S]*--allow-known-dev-toolchain-high/,
    "local launch preflight must include the documented all-dependency audit exception path",
  );
  assert.match(
    localProofPreflightSource,
    /function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*function scriptFileExists\(scriptPath\)[\s\S]*regularFileStat\(scriptPath\) !== null[\s\S]*scriptFileExists\(scriptPath\)/,
    "local launch preflight runner must reject directory check script paths before spawning",
  );
  const prodHealthSource = readFileSync("scripts/check-production-health.mjs", "utf8");
  const prodHealthPackageScripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
  assert.equal(
    prodHealthPackageScripts["health:prod:summary"],
    "node scripts/check-production-health.mjs --summary-only",
    "package scripts must expose a compact production health summary command",
  );
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
    /\.example[\s\S]*100\\\.[\s\S]*169\\\.254[\s\S]*192\\.168[\s\S]*198\\\.51\\\.100[\s\S]*2001:db8/,
    "production health checker must reject example, private, reserved, and documentation launch origins",
  );
  assert.ok(
    prodHealthSource.includes('host.includes(".")'),
    "production health checker must reject single-label launch origins",
  );
  assert.match(
    prodHealthSource,
    /redirect:\s*"error"/,
    "production health checker must not forward diagnostics credentials through redirects",
  );
  assert.match(
    prodHealthSource,
    /MAX_HEALTH_RESPONSE_BYTES[\s\S]*CONTENT_LENGTH_RE\s*=\s*\/\^\(\?:0\|\[1-9\]\\d\{0,15\}\)\$\/[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseContentLengthHeader[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*function readBoundedResponseText[\s\S]*parseContentLengthHeader\(response\.headers\.get\("content-length"\)\)[\s\S]*new TextDecoder\("utf-8", \{ fatal: true \}\)/,
    "production health checker must strictly parse Content-Length and bound response bodies before parsing or reporting errors",
  );
  assert.match(
    prodHealthSource,
    /function parseOptionalNonNegativeIntegerEnv\(name\)[\s\S]*CONTENT_LENGTH_RE\.test\(normalized\)[\s\S]*must be a canonical non-negative decimal integer[\s\S]*const parsed = BigInt\(normalized\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*THRESHOLD_ENV_ISSUES[\s\S]*emitFailure\(THRESHOLD_ENV_ISSUES\)[\s\S]*return;/,
    "production health threshold env values must be canonical decimal and fail closed before health fetches",
  );
  assert.doesNotMatch(
    prodHealthSource,
    /Number\(response\.headers\.get\("content-length"\)\)|parseNonNegativeNumberEnv\(process\.env\.PROD_HEALTH_MAX|parseOptionalNumber\(process\.env\.PROD_HEALTH_MAX/,
    "production health checker must not broadly coerce response Content-Length or threshold env values",
  );
  assert.match(
    prodHealthSource,
    /import \{ redactProofText \} from "\.\/redact-proof-output\.mjs"[\s\S]*function describeProdHealthError\(error\)[\s\S]*redactProofText\(/,
    "production health checker terminal failures must use the shared proof redactor",
  );
  assert.match(
    prodHealthSource,
    /MAX_PROD_HEALTH_ERROR_CHARS[\s\S]*<truncated>[\s\S]*main\(\)\.catch\(\(error\) => \{[\s\S]*emitFailure\(\[describeProdHealthError\(error\)\]\)/,
    "production health checker terminal failures must be compact and bounded",
  );
  assert.match(
    prodHealthSource,
    /const summaryOnly = process\.argv\.includes\("--summary-only"\)[\s\S]*function emitFailure\(problems, hints = \[\]\)[\s\S]*JSON\.stringify\(\{[\s\S]*status: "fail"[\s\S]*firstIssue: describeProdHealthError/,
    "production health summary mode must emit bounded redacted JSON failures",
  );
  assert.match(
    prodHealthSource,
    /if \(summaryOnly\) \{[\s\S]*JSON\.stringify\(\{[\s\S]*status: "pass"[\s\S]*trustedProxyConfigured[\s\S]*return;[\s\S]*console\.log\("\[prod-health\] OK"\)[\s\S]*base=\$\{BASE_URL\}/,
    "production health summary mode must omit the raw base origin while preserving compact readiness booleans",
  );
  assert.doesNotMatch(
    prodHealthSource,
    /response\.text\(\)/,
    "production health checker must not read unbounded HTTP response text",
  );
  assert.match(
    prodHealthSource,
    /HEALTH_DIAGNOSTICS_SECRET is required/,
    "production health checker must fail clearly when diagnostics secret is missing",
  );
  assert.match(
    prodHealthSource,
    /MIN_HEALTH_DIAGNOSTICS_SECRET_LENGTH\s*=\s*32[\s\S]*MAX_HEALTH_DIAGNOSTICS_SECRET_LENGTH\s*=\s*256[\s\S]*CONTROL_CHAR_RE[\s\S]*function parseHealthDiagnosticsSecretEnv\(name\)[\s\S]*secret\.length < MIN_HEALTH_DIAGNOSTICS_SECRET_LENGTH[\s\S]*secret\.length > MAX_HEALTH_DIAGNOSTICS_SECRET_LENGTH[\s\S]*CONTROL_CHAR_RE\.test\(secret\)[\s\S]*DIAGNOSTICS_SECRET_ENV = parseHealthDiagnosticsSecretEnv\("HEALTH_DIAGNOSTICS_SECRET"\)[\s\S]*DIAGNOSTICS_SECRET = DIAGNOSTICS_SECRET_ENV\.value[\s\S]*THRESHOLD_ENV_ISSUES[\s\S]*DIAGNOSTICS_SECRET_ENV\.issue[\s\S]*emitFailure\(THRESHOLD_ENV_ISSUES\)[\s\S]*return;/,
    "production health checker must reject malformed diagnostics secrets before health fetches or header attachment",
  );
  assert.doesNotMatch(
    prodHealthSource,
    /process\.env\.HEALTH_DIAGNOSTICS_SECRET\?\.trim\(\)\s*\|\|\s*""/,
    "production health checker must not treat arbitrary trimmed diagnostics secret text as header-safe",
  );
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
  assert.ok(
    prodHealthSource.includes("const POSITIVE_SAFE_INTEGER_RE = /^[1-9]\\d{0,15}$/;") &&
      prodHealthSource.includes("const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);") &&
      prodHealthSource.includes("function parseOptionalPositiveIntegerValue(name, rawValue)") &&
      prodHealthSource.includes("POSITIVE_SAFE_INTEGER_RE.test(normalized)") &&
      prodHealthSource.includes("const parsed = BigInt(normalized)") &&
      prodHealthSource.includes("parsed > MAX_SAFE_INTEGER_BIGINT"),
    "production health checker must canonical-parse and compare configured runtime chain id evidence",
  );
  assert.match(
    prodHealthSource,
    /PUBLIC_CHAIN_ID_ENV = parseOptionalPositiveIntegerEnv\("NEXT_PUBLIC_LINEA_CHAIN_ID"\)[\s\S]*SERVER_CHAIN_ID_ENV = parseOptionalPositiveIntegerEnv\("LINEA_CHAIN_ID"\)[\s\S]*CONFIGURED_CHAIN_ID = PUBLIC_CHAIN_ID_ENV\.value \?\? SERVER_CHAIN_ID_ENV\.value/,
    "production health checker must derive configured chain id from canonical public/server env values",
  );
  assert.match(
    prodHealthSource,
    /CONFIGURED_CHAIN_ID !== null && publicConfig\.chainId !== CONFIGURED_CHAIN_ID[\s\S]*runtime publicConfig\.chainId must match configured Linea chain id/,
    "production health checker must compare runtime chain id with configured chain id evidence",
  );
  assert.match(
    prodHealthSource,
    /function parsePayloadNonNegativeNumber\(value\)[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*CONTENT_LENGTH_RE\.test\(normalized\)[\s\S]*const parsed = BigInt\(normalized\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*function runSelfTest\(\)[\s\S]*"59144\.0"[\s\S]*"1e3"[\s\S]*malformed finality lag payload must fail closed/,
    "production health checker must canonical-parse numeric API payload fields and chain ids before threshold comparisons",
  );
  const prodHealthPayloadParserSource = prodHealthSource.match(/function parsePayloadNonNegativeNumber\(value\)[\s\S]*?function formatProblems/)?.[0] ?? "";
  assert.doesNotMatch(
    prodHealthPayloadParserSource,
    /(^|[^\w.])Number\(value\)|Number\.isFinite\(parsed\)|Number\.isSafeInteger\(parsed\)/,
    "production health payload parser must not broadly coerce payload strings or accept fractional values",
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
    /runtime publicConfig\.readOnlyMode is missing/,
    "production health checker must fail when read-only mode diagnostics are missing",
  );
  assert.match(
    prodHealthSource,
    /runtime publicConfig\.contractRequiresEpochBoundBets is missing/,
    "production health checker must fail when protected-bet diagnostics are missing",
  );
  assert.match(
    prodHealthSource,
    /runtime publicConfig\.backupMonitorConfigured is missing[\s\S]*production-like runtime is missing backup monitoring directory configuration/,
    "production health checker must fail production-like runtime without backup monitoring configuration",
  );
  assert.match(
    prodHealthSource,
    /runtime publicConfig\.backupMonitorMaxAgeConfigured is missing[\s\S]*production-like runtime is missing backup freshness window configuration/,
    "production health checker must fail production-like runtime without backup freshness window configuration",
  );
  assert.match(
    prodHealthSource,
    /runtime publicConfig\.emailAlertConfigured is missing[\s\S]*production-like runtime is missing Resend email alert configuration/,
    "production health checker must fail production-like runtime without email alert configuration",
  );
  assert.match(
    prodHealthSource,
    /runtime publicConfig\.externalRateLimitConfigured is missing[\s\S]*multi-replica runtime is missing external shared rate-limit configuration/,
    "production health checker must fail multi-replica runtime without external shared rate-limit configuration",
  );
  assert.match(
    prodHealthSource,
    /runtime publicConfig\.trustedProxyConfigured is missing[\s\S]*production-like runtime is missing trusted proxy identity configuration/,
    "production health checker must fail non-local production-like runtime without trusted proxy identity configuration",
  );
  assert.match(
    prodHealthSource,
    /runtime publicConfig\.weakRateLimitIdentityAllowed is missing[\s\S]*production-like runtime allows weak rate-limit identity/,
    "production health checker must fail non-local production-like runtime that allows weak rate-limit identity",
  );
  assert.match(
    prodHealthSource,
    /runtime build does not require protected V10 bets/,
    "production health checker must reject a stale build when V10 protected bets are required",
  );
  assert.match(
    prodHealthSource,
    /readOnlyMode=[\s\S]*backupMonitorConfigured=[\s\S]*backupMonitorMaxAgeConfigured=[\s\S]*emailAlertConfigured=[\s\S]*externalRateLimitConfigured=[\s\S]*trustedProxyConfigured=/,
    "production health checker summary must expose read-only, backup monitoring, backup freshness, email alert, external rate-limit, and trusted-proxy modes",
  );
  const loadHttpSource = readFileSync("scripts/load-http.mjs", "utf8");
  const hostProofSource = readFileSync("scripts/check-host-proof.mjs", "utf8");
  const hostProofLoadTargetSource = readFileSync("scripts/check-host-proof-load-target.mjs", "utf8");
  const hostDraftSource = readFileSync("scripts/create-host-proof-draft.mjs", "utf8");
  const hostCollectSource = readFileSync("scripts/collect-host-evidence.mjs", "utf8");
  assert.match(
    hostCollectSource,
    /MAX_HOST_EVIDENCE_BYTES = 512 \* 1024[\s\S]*function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stat\.isFile\(\) \? stat : null[\s\S]*function requireExistingArtifact\(name, value\)[\s\S]*regularFileStat\(resolved\)[\s\S]*function readOptionalLog\(name, filePath\)[\s\S]*const stat = regularFileStat\(resolved\)[\s\S]*if \(!stat\)[\s\S]*stat\.size > MAX_HOST_EVIDENCE_BYTES[\s\S]*artifact is too large to validate safely[\s\S]*readFileSync\(resolved, "utf8"\)/,
    "host evidence collector must reject directory and oversized log artifacts before reading them",
  );
  assert.match(
    hostCollectSource,
    /readOptionalLog\("health-log", healthLogPath\)[\s\S]*readOptionalLog\("load-log", loadLogPath\)/,
    "host evidence collector must pass artifact flag names into log readers",
  );
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
    /\.example[\s\S]*100\\\.[\s\S]*169\\\.254[\s\S]*192\\.168[\s\S]*198\\\.51\\\.100[\s\S]*2001:db8/,
    "load:http must reject example, private, reserved, and documentation launch origins",
  );
  assert.ok(
    loadHttpSource.includes('host.includes(".")'),
    "load:http must reject single-label launch origins",
  );
  assert.match(
    loadHttpSource,
    /LOAD_CONCURRENCY,\s*50/,
    "default load test concurrency must stay suitable for local production smoke; use LOAD_CONCURRENCY for stress tests",
  );
  assert.match(
    loadHttpSource,
    /name: "global-stats", path: "\/api\/global-stats"/,
    "load test must cover the global stats aggregate endpoint",
  );
  assert.match(
    loadHttpSource,
    /Cold first requests:[\s\S]*COLD \$\{endpoint\.name\}/,
    "load test must report the first request separately from warmed traffic",
  );
  assert.match(
    loadHttpSource,
    /cold load checks failed:[\s\S]*for \(const endpoint of endpoints\)[\s\S]*endpointErrorRate[\s\S]*endpointP95/,
    "load test must fail closed for cold and per-endpoint regressions instead of relying only on aggregate latency",
  );
  assert.match(
    loadHttpSource,
    /HTTP_STATUS_RE[\s\S]*function formatStatuses\(statuses\)[\s\S]*function normalizeStatus\(value\)[\s\S]*HTTP_STATUS_RE\.test\(text\)[\s\S]*Number\.isSafeInteger\(status\)[\s\S]*invalid-status/,
    "load:http status bucket output must sort and format through canonical HTTP status parsing",
  );
  assert.doesNotMatch(
    loadHttpSource,
    /sort\(\(a, b\) => Number\(a\[0\]\) - Number\(b\[0\]\)\)/,
    "load:http status bucket output must not sort with broad Number(status) coercion",
  );
  assert.match(
    hostProofSource,
    /externalRateLimit[\s\S]*sharedBucketVerified[\s\S]*webReplicaCount[\s\S]*at least 2[\s\S]*distinctReplicas[\s\S]*at least 2[\s\S]*shared rate-limit bucket\/store behavior across replicas/,
    "host proof must require distinct two-replica shared rate-limit evidence",
  );
  assert.match(
    hostProofSource,
    /function hasNumericFinalityLagEvidence\(value\)[\s\S]*finalityLagBlocks=\(\[\^\\s\]\+\)[\s\S]*asNonNegativeSafeInteger\(match\[1\]\) !== null/,
    "host proof must canonical-parse finalityLagBlocks evidence markers before accepting health proof",
  );
  assert.match(
    hostProofSource,
    /function localArtifactHealthEvidenceHasSafeFinality\(value, expectedOrigin\)[\s\S]*textHasHealthProdOkBaseAndSafeFinality\(content, expectedOrigin\)[\s\S]*healthProd evidence artifact must include \[prod-health\] OK, base, and canonical non-negative decimal finalityLagBlocks/,
    "host proof must canonical-parse local health artifact finality markers instead of trusting inline summary only",
  );
  assert.match(
    hostProofSource,
    /MAX_HOST_ARTIFACT_TEXT_BYTES = 256 \* 1024[\s\S]*function readBoundedArtifactText\(resolved\)[\s\S]*openSync\(resolved, "r"\)[\s\S]*readSync\(fd, buffer, 0, buffer\.length, 0\)[\s\S]*closeSync\(fd\)[\s\S]*localArtifactContentFromText\(value, key = ""\)[\s\S]*readBoundedArtifactText\(resolve\(process\.cwd\(\), artifactPath\)\)[\s\S]*processEvidenceMentionsRole\(processInfo, roleName\)[\s\S]*readBoundedArtifactText\(absolute\)/,
    "host proof must read bounded local artifact snippets instead of whole evidence files",
  );
  assert.doesNotMatch(
    hostProofSource,
    /readFileSync\((?:resolve\(process\.cwd\(\), artifactPath\)|absolute),\s*"utf8"\)\.slice/,
    "host proof must not read whole local artifacts before slicing snippets",
  );
  assert.match(
    hostProofSource,
    /MAX_HOST_PROOF_MANIFEST_BYTES = 512 \* 1024[\s\S]*const manifestStat = regularFileStat\(manifestPath\)[\s\S]*!manifestStat[\s\S]*host proof manifest must be a file[\s\S]*manifestStat\.size > MAX_HOST_PROOF_MANIFEST_BYTES[\s\S]*host proof manifest is too large to validate safely[\s\S]*JSON\.parse\(readFileSync\(manifestPath, "utf8"\)\)/,
    "host proof must size-gate proof manifests before parsing JSON",
  );
  assert.match(
    hostProofSource,
    /const requestCount = asNonNegativeSafeInteger\(loadHttp\.requestCount\)[\s\S]*const p95Ms = asNonNegativeSafeInteger\(loadHttp\.p95Ms\)[\s\S]*const maxP95Ms = asNonNegativeSafeInteger\(loadHttp\.maxP95Ms\)[\s\S]*const durationMs = asNonNegativeSafeInteger\(loadHttp\.durationMs\)[\s\S]*const concurrency = asNonNegativeSafeInteger\(loadHttp\.concurrency\)/,
    "host proof must canonical-parse integer load evidence before accepting host load proof",
  );
  assert.match(
    hostProofSource,
    /function asNonNegativeDecimal\(value\)[\s\S]*\^\(\?:0\|\[1-9\]\\d\{0,15\}\)\(\?:\\\.\\d\{1,6\}\)\?\$[\s\S]*const errorRate = asNonNegativeDecimal\(loadHttp\.errorRate\)[\s\S]*const maxErrorRate = asNonNegativeDecimal\(loadHttp\.maxErrorRate\)/,
    "host proof must canonical-parse decimal load error rates before accepting host load proof",
  );
  assert.match(
    hostProofSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function asNonNegativeSafeInteger\(value\)[\s\S]*\^\(\?:0\|\[1-9\]\\d\{0,15\}\)\$[\s\S]*const parsed = BigInt\(normalized\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*const webReplicaCount = asNonNegativeSafeInteger\(externalRateLimit\.webReplicaCount\)[\s\S]*const distinctReplicas = asNonNegativeSafeInteger\(externalRateLimit\.distinctReplicas\)/,
    "host proof must canonical-parse external rate-limit replica counts before accepting two-replica evidence",
  );
  assert.doesNotMatch(
    hostProofSource,
    /function asFiniteNumber\(value\)|Number\.isFinite\(Number\(match\[1\]\)\)|const requestCount = asFiniteNumber\(loadHttp\.requestCount\)|const errorRate = asFiniteNumber\(loadHttp\.errorRate\)|const maxErrorRate = asFiniteNumber\(loadHttp\.maxErrorRate\)|const p95Ms = asFiniteNumber\(loadHttp\.p95Ms\)|const maxP95Ms = asFiniteNumber\(loadHttp\.maxP95Ms\)|const durationMs = asFiniteNumber\(loadHttp\.durationMs\)|const concurrency = asFiniteNumber\(loadHttp\.concurrency\)|const webReplicaCount = asFiniteNumber\(externalRateLimit\.webReplicaCount\)[\s\S]*const distinctReplicas = asFiniteNumber\(externalRateLimit\.distinctReplicas\)/,
    "host proof must not broadly coerce finality lag markers, load evidence, or external rate-limit replica counts",
  );
  assert.match(
    hostProofSource,
    /function externalRateLimitEvidenceNamesTwoReplicas[\s\S]*replicaIds[\s\S]*replicas[\s\S]*replica\[-_\\s:\]\?\(\[a-z0-9\]/,
    "host proof must require external rate-limit evidence to identify two replica identities",
  );
  assert.match(
    hostProofSource,
    /function healthEvidenceBaseMatches\(value, expectedOrigin\)[\s\S]*pattern\.exec\(text\)[\s\S]*normalizedOrigin\(match\[1\]\) === expected[\s\S]*function loadEvidenceBaseMatches\(value, expectedOrigin\)[\s\S]*pattern\.exec\(text\)[\s\S]*normalizedOrigin\(match\[1\]\) === expected/,
    "host proof must scan health and load base URL evidence without materializing match arrays",
  );
  assert.match(
    hostProofSource,
    /function externalRateLimitEvidenceNamesTwoReplicas[\s\S]*const replicas = new Set\(\)[\s\S]*replicaPattern\.exec\(text\)[\s\S]*replicas\.size >= 2/,
    "host proof must scan external rate-limit replica identities without materializing match arrays",
  );
  assert.doesNotMatch(
    hostProofSource,
    /\[\.\.\.(?:content|text)\.matchAll/,
    "host proof must not spread host evidence matchAll output into arrays",
  );
  assert.match(
    hostProofSource,
    /function sharedHostSectionArtifactIssues[\s\S]*processModel[\s\S]*persistentDb[\s\S]*healthProd[\s\S]*loadHttp[\s\S]*externalRateLimit[\s\S]*host evidence sections must use distinct local artifact files across/,
    "host proof must reject one local artifact reused across independent host evidence sections",
  );
  assert.match(
    hostProofLoadTargetSource,
    /rmSync\(tempDir,\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}\)/,
    "host proof load target guard must clean up temporary manifest fixtures",
  );
  assert.match(
    hostProofLoadTargetSource,
    /const summaryOnly = process\.argv\.includes\("--summary-only"\)[\s\S]*if \(summaryOnly\)[\s\S]*fixtures: fixtureCount[\s\S]*launchGate: "host"/,
    "host proof load target guard summary mode must emit compact fixture counts",
  );
  assert.match(
    `${hostDraftSource}\n${hostCollectSource}`,
    /function requireDistinctArtifactInputs[\s\S]*distinct host evidence files[\s\S]*process-evidence[\s\S]*health-log[\s\S]*load-log/,
    "host proof draft and collector must reject reused process, health, and load artifact inputs",
  );
  assert.match(
    `${hostDraftSource}\n${hostCollectSource}`,
    /externalRateLimit[\s\S]*webReplicaCount:\s*2[\s\S]*sharedBucketVerified:\s*false[\s\S]*two-replica shared rate-limit bucket proof/,
    "host proof draft and collector must expose the required shared rate-limit section",
  );
  assert.match(
    `${hostDraftSource}\n${hostCollectSource}`,
    /DECIMAL_INTEGER_RE[\s\S]*DECIMAL_NUMBER_RE[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseNonNegativeInteger\(value, fallback\)[\s\S]*const parsed = BigInt\(normalized\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*canonical non-negative decimal finalityLagBlocks=<number>[\s\S]*function parseNonNegativeDecimal\(value, fallback\)[\s\S]*function parseLoadMaxErrorRate\(\)[\s\S]*LOAD_MAX_ERROR_RATE must be a canonical decimal rate between 0 and 1[\s\S]*function parseLoadMaxP95Ms\(\)[\s\S]*LOAD_MAX_P95_MS must be a canonical positive integer of milliseconds/,
    "host proof draft and collector must strictly parse health finality, load numeric evidence, and threshold env values",
  );
  for (const hostEvidenceDraftSource of [hostDraftSource, hostCollectSource]) {
    assert.match(
      hostEvidenceDraftSource,
      /MAX_HOST_EVIDENCE_BYTES = 512 \* 1024[\s\S]*function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stat\.isFile\(\) \? stat : null[\s\S]*function read(?:Required|Optional)Log\(name, filePath\)[\s\S]*const stat = regularFileStat\(resolved\)[\s\S]*if \(!stat\)[\s\S]*stat\.size > MAX_HOST_EVIDENCE_BYTES[\s\S]*artifact is too large to validate safely[\s\S]*readFileSync\(resolved, "utf8"\)/,
      "host proof draft and collector must size-gate health and load logs before reading them",
    );
    assert.match(
      hostEvidenceDraftSource,
      /const MAX_KEY_VALUE_MARKERS = 64[\s\S]*function parseKeyValues\(line = ""\)[\s\S]*pattern\.exec\(line\)[\s\S]*inspected > MAX_KEY_VALUE_MARKERS[\s\S]*too many key\/value markers to validate safely/,
      "host proof draft and collector must cap key/value parsing before accepting health evidence",
    );
    assert.doesNotMatch(
      hostEvidenceDraftSource,
      /line\.matchAll\(/,
      "host proof draft and collector must not parse key/value evidence through matchAll",
    );
  }
  assert.doesNotMatch(
    `${hostDraftSource}\n${hostCollectSource}`,
    /existsSync\(resolved\)|statSync\(resolved\)\.isFile\(\)/,
    "host proof draft and collector must route local artifact checks through regularFileStat",
  );
  assert.doesNotMatch(
    `${hostDraftSource}\n${hostCollectSource}`,
    /function parseNumber|Number\.isFinite\(Number\(values\.finalityLagBlocks\)\)|parseNumber\(process\.env\.LOAD_MAX_ERROR_RATE|parseNumber\(process\.env\.LOAD_MAX_P95_MS/,
    "host proof draft and collector must not use broad numeric fallback for load evidence or threshold env values",
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
    externalRateLimit: {
      status: "pass",
      webReplicaCount: 2,
      distinctReplicas: 2,
      failClosed: true,
      sharedBucketVerified: true,
      checkedAt: hostProofCheckedAt,
      evidence: "npm.cmd run load:http redacted shared rate-limit bucket proof across replica-a and replica-b",
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
  assert.match(
    canaryHostProof.stdout,
    /\| loadHttp \| checked \|/,
    "valid strict host proof must mark load evidence checked in the section table",
  );
  const missingRateLimitProof = JSON.parse(JSON.stringify(baseHostProof));
  delete missingRateLimitProof.externalRateLimit;
  const missingRateLimitResult = runHostProof(missingRateLimitProof, "missing-rate-limit-proof");
  assert.equal(missingRateLimitResult.status, 1, "host proof must reject manifests without two-replica shared limiter evidence");
  assert.match(
    missingRateLimitResult.stdout,
    /externalRateLimit section is missing/,
    "host proof must explain that shared rate-limit evidence is missing",
  );
  const fractionalHealthLagProof = JSON.parse(JSON.stringify(baseHostProof));
  fractionalHealthLagProof.healthProd.evidence = "npm.cmd run health:prod [prod-health] OK base=https://playlore.xyz runtime=ok dataSync=healthy finalityLagBlocks=3.5";
  const fractionalHealthLagResult = runHostProof(fractionalHealthLagProof, "fractional-health-lag-proof");
  assert.equal(fractionalHealthLagResult.status, 1, "host proof must reject fractional health finality lag evidence");
  assert.match(
    fractionalHealthLagResult.stdout,
    /healthProd evidence must include canonical non-negative decimal finalityLagBlocks from health:prod/,
    "host proof must explain that health finality lag evidence is non-canonical",
  );
  const leadingZeroHealthLagProof = JSON.parse(JSON.stringify(baseHostProof));
  leadingZeroHealthLagProof.healthProd.evidence = "npm.cmd run health:prod [prod-health] OK base=https://playlore.xyz runtime=ok dataSync=healthy finalityLagBlocks=03";
  const leadingZeroHealthLagResult = runHostProof(leadingZeroHealthLagProof, "leading-zero-health-lag-proof");
  assert.equal(leadingZeroHealthLagResult.status, 1, "host proof must reject leading-zero health finality lag evidence");
  assert.match(
    leadingZeroHealthLagResult.stdout,
    /healthProd evidence must include canonical non-negative decimal finalityLagBlocks from health:prod/,
    "host proof must explain that leading-zero health finality lag evidence is non-canonical",
  );
  const unsafeHealthArtifact = join(hostProofTempDir, "unsafe-health-finality.log");
  writeFileSync(
    unsafeHealthArtifact,
    "[prod-health] OK base=https://playlore.xyz runtime=ok dataSync=healthy finalityLagBlocks=9999999999999999\n",
    "utf8",
  );
  const unsafeHealthArtifactProof = JSON.parse(JSON.stringify(baseHostProof));
  unsafeHealthArtifactProof.healthProd.evidencePath = unsafeHealthArtifact;
  unsafeHealthArtifactProof.healthProd.summary = "npm.cmd run health:prod [prod-health] OK base=https://playlore.xyz runtime=ok dataSync=healthy finalityLagBlocks=3";
  const unsafeHealthArtifactResult = runHostProof(unsafeHealthArtifactProof, "unsafe-health-artifact-proof");
  assert.equal(unsafeHealthArtifactResult.status, 1, "host proof must reject unsafe finality lag inside local health artifact even when inline summary is safe");
  assert.match(
    unsafeHealthArtifactResult.stdout,
    /healthProd evidence artifact must include \[prod-health\] OK, base, and canonical non-negative decimal finalityLagBlocks/,
    "host proof must explain that local health artifact finality lag evidence is unsafe",
  );
  const fractionalLoadCountProof = JSON.parse(JSON.stringify(baseHostProof));
  fractionalLoadCountProof.loadHttp.requestCount = "120.5";
  const fractionalLoadCountResult = runHostProof(fractionalLoadCountProof, "fractional-load-count-proof");
  assert.equal(fractionalLoadCountResult.status, 1, "host proof must reject fractional load request counts");
  assert.match(
    fractionalLoadCountResult.stdout,
    /loadHttp\.requestCount must be positive/,
    "host proof must explain that fractional load request count evidence is invalid",
  );
  assert.match(
    fractionalLoadCountResult.stdout,
    /\| loadHttp \| issue \|/,
    "host proof section status must report issue when load evidence has strict validation failures",
  );
  const leadingZeroLoadP95Proof = JSON.parse(JSON.stringify(baseHostProof));
  leadingZeroLoadP95Proof.loadHttp.p95Ms = "0250";
  const leadingZeroLoadP95Result = runHostProof(leadingZeroLoadP95Proof, "leading-zero-load-p95-proof");
  assert.equal(leadingZeroLoadP95Result.status, 1, "host proof must reject leading-zero p95 load evidence");
  assert.match(
    leadingZeroLoadP95Result.stdout,
    /loadHttp\.p95Ms must be positive/,
    "host proof must explain that leading-zero load p95 evidence is invalid",
  );
  const exponentLoadErrorRateProof = JSON.parse(JSON.stringify(baseHostProof));
  exponentLoadErrorRateProof.loadHttp.errorRate = "1e-3";
  const exponentLoadErrorRateResult = runHostProof(exponentLoadErrorRateProof, "exponent-load-error-rate-proof");
  assert.equal(exponentLoadErrorRateResult.status, 1, "host proof must reject exponent-form load error rates");
  assert.match(
    exponentLoadErrorRateResult.stdout,
    /loadHttp\.errorRate must be between 0 and 1/,
    "host proof must explain that exponent-form load error rate evidence is invalid",
  );
  const overPreciseLoadMaxErrorRateProof = JSON.parse(JSON.stringify(baseHostProof));
  overPreciseLoadMaxErrorRateProof.loadHttp.maxErrorRate = "0.1234567";
  const overPreciseLoadMaxErrorRateResult = runHostProof(overPreciseLoadMaxErrorRateProof, "overprecise-load-max-error-rate-proof");
  assert.equal(overPreciseLoadMaxErrorRateResult.status, 1, "host proof must reject over-precise max error rates");
  assert.match(
    overPreciseLoadMaxErrorRateResult.stdout,
    /loadHttp\.maxErrorRate must be between 0 and 1/,
    "host proof must explain that over-precise max error rate evidence is invalid",
  );
  const fractionalReplicaCountProof = JSON.parse(JSON.stringify(baseHostProof));
  fractionalReplicaCountProof.externalRateLimit.webReplicaCount = "2.5";
  const fractionalReplicaCountResult = runHostProof(fractionalReplicaCountProof, "fractional-replica-count-proof");
  assert.equal(fractionalReplicaCountResult.status, 1, "host proof must reject fractional web replica counts");
  assert.match(
    fractionalReplicaCountResult.stdout,
    /externalRateLimit\.webReplicaCount must be at least 2/,
    "host proof must explain that fractional web replica count evidence is invalid",
  );
  const leadingZeroReplicaProof = JSON.parse(JSON.stringify(baseHostProof));
  leadingZeroReplicaProof.externalRateLimit.distinctReplicas = "02";
  const leadingZeroReplicaResult = runHostProof(leadingZeroReplicaProof, "leading-zero-replica-proof");
  assert.equal(leadingZeroReplicaResult.status, 1, "host proof must reject leading-zero distinct replica counts");
  assert.match(
    leadingZeroReplicaResult.stdout,
    /externalRateLimit\.distinctReplicas must be at least 2/,
    "host proof must explain that leading-zero distinct replica count evidence is invalid",
  );
  const singleReplicaIdentityProof = JSON.parse(JSON.stringify(baseHostProof));
  singleReplicaIdentityProof.externalRateLimit.distinctReplicas = 1;
  const singleReplicaIdentityResult = runHostProof(singleReplicaIdentityProof, "single-replica-identity-proof");
  assert.equal(singleReplicaIdentityResult.status, 1, "host proof must reject shared limiter proof from only one distinct replica");
  assert.match(
    singleReplicaIdentityResult.stdout,
    /externalRateLimit\.distinctReplicas must be at least 2/,
    "host proof must explain that distinct replica evidence is missing",
  );
  const missingReplicaNamesProof = JSON.parse(JSON.stringify(baseHostProof));
  missingReplicaNamesProof.externalRateLimit.evidence = "npm.cmd run load:http redacted shared rate-limit bucket proof across replicas";
  const missingReplicaNamesResult = runHostProof(missingReplicaNamesProof, "missing-replica-names-proof");
  assert.equal(missingReplicaNamesResult.status, 1, "host proof must reject shared limiter proof that does not identify two replicas");
  assert.match(
    missingReplicaNamesResult.stdout,
    /externalRateLimit evidence must identify at least two distinct web replicas/,
    "host proof must explain that replica identity evidence is missing",
  );
  const finalOriginLoadProof = JSON.parse(JSON.stringify(baseHostProof));
  finalOriginLoadProof.loadHttp.url = finalOriginLoadProof.origin;
  const finalOriginLoadResult = runHostProof(finalOriginLoadProof, "final-origin-load-proof");
  assert.equal(finalOriginLoadResult.status, 1, "host proof must reject load:http evidence collected against the final production origin");
  assert.match(
    finalOriginLoadResult.stdout,
    /loadHttp\.url must not be the final production origin/,
    "host proof must explain why final-origin load evidence is rejected",
  );
  rmSync(hostProofTempDir, { recursive: true, force: true });
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
  assert.match(
    dataSyncHealthSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseStoredEpochNumber[\s\S]*\/\^\[1-9\]\\d\{0,15\}\$\/[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*Object\.keys\(dbEpochs\)[\s\S]*\.map\(\(key\) => parseStoredEpochNumber\(key\)\)[\s\S]*epoch !== null && epoch <= maxEpochToCheck/,
    "data-sync health must parse stored epoch keys with a BigInt-bounded canonical safe decimal parser before coverage checks",
  );
  const dataSyncStoredNumberParsingSource = readFileSync("app/api/_lib/storedNumberParsing.ts", "utf8");
  assert.match(
    dataSyncStoredNumberParsingSource,
    /const MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseStoredPositiveIntegerOrZero[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)/,
    "shared stored positive integer parser must use a BigInt bound before returning display-safe numbers",
  );
  assert.doesNotMatch(
    dataSyncStoredNumberParsingSource,
    /const parsed = Number\(value\)|Number\.isSafeInteger\(parsed\)/,
    "shared stored positive integer parser must not rely on broad Number(value) coercion",
  );
  assert.match(
    dataSyncHealthSource,
    /function parseStatusTimestamp\(value: unknown\)[\s\S]*typeof value !== "number"[\s\S]*Number\.isSafeInteger\(value\) && value >= 0[\s\S]*const runCompletedAt = parseStatusTimestamp\(indexerRunStatus\?\.completedAt\)[\s\S]*const runHeartbeatAt = parseStatusTimestamp\(indexerRunStatus\?\.lastHeartbeatAt\)[\s\S]*runHeartbeatAt > runCompletedAt/,
    "data-sync health must validate indexer status timestamps before deriving active/stale state",
  );
  assert.match(
    dataSyncHealthSource,
    /function toNum\(v: unknown\): number \| null \{[\s\S]*typeof v === "number" && Number\.isSafeInteger\(v\) && v >= 0[\s\S]*lagWarnBlocks: toNum\(LAG_WARN_BLOCKS\)[\s\S]*indexerHeartbeatStaleMs: toNum\(INDEXER_HEARTBEAT_STALE_MS\)/,
    "data-sync health env diagnostics must publish only non-negative safe integer threshold values",
  );
  assert.match(
    dataSyncHealthSource,
    /function ageMs\(timestamp: number \| null, now: number\)[\s\S]*timestamp === null \|\| !Number\.isFinite\(timestamp\)[\s\S]*Math\.max\(0, now - timestamp\)/,
    "data-sync health timestamp age math must use the validated numeric timestamp directly",
  );
  assert.match(
    dataSyncHealthSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseChainUintNumber\(value: unknown\)[\s\S]*typeof value !== "bigint"[\s\S]*value > MAX_SAFE_INTEGER_BIGINT[\s\S]*const chainCurrentEpoch = parseChainUintNumber\(chainEpochRaw\)[\s\S]*const maxEpochToCheck = chainCurrentEpoch !== null[\s\S]*const lastDailyEpoch = parseChainUintNumber\(jackpotsInfo\[4\]\)[\s\S]*chainCurrentEpoch === null/,
    "data-sync health must safely narrow chain uint256 epoch evidence before coverage, jackpot freshness, and degraded status checks",
  );
  assert.match(
    dataSyncHealthSource,
    /function bigintToNonNegativeSafeNumber\(value: bigint\)[\s\S]*Number\.MAX_SAFE_INTEGER[\s\S]*function safeNonNegativeBigintDelta\(upper: bigint, lower: bigint\)[\s\S]*upper < lower[\s\S]*const lagBlocks = dbLastIndexedBlock !== null \? safeNonNegativeBigintDelta\(head, dbLastIndexedBlock\)[\s\S]*const totalBlocksToIndex =[\s\S]*bigintToNonNegativeSafeNumber\(head - DEPLOY_BLOCK \+ 1n\)[\s\S]*const deltaBlocks = safeNonNegativeBigintDelta\(dbLastIndexedBlock, previousSample\.lastIndexedBlock\)/,
    "data-sync health must safely narrow bigint block deltas before lag, progress, and catch-up rate checks",
  );
  assert.match(
    dataSyncHealthSource,
    /function parseStatusCounter\(value: unknown\)[\s\S]*Number\.isSafeInteger\(value\) && value >= 0[\s\S]*function parseStatusPositiveInteger\(value: unknown\)[\s\S]*Number\.isSafeInteger\(value\) && value > 0[\s\S]*function parseStatusBlockString\(value: unknown\)[\s\S]*parseStoredBlockNumber\(value\)\?\.toString\(\) \?\? null[\s\S]*function parseStatusEpochList\(value: unknown\)[\s\S]*parseStoredEpochNumber\(entry\)/,
    "data-sync health must validate indexer run/repair/reconcile counters, block strings, and epoch lists before publishing diagnostics",
  );
  assert.doesNotMatch(
    dataSyncHealthSource,
    /(^|[^A-Za-z])Number\(row\.blockNumber/,
    "data-sync health must not coerce stored block numbers with Number(row.blockNumber)",
  );
  assert.doesNotMatch(
    dataSyncHealthSource,
    /\.map\(\(k\) => Number\(k\)\)|isSafePositiveInteger\(n\)/,
    "data-sync health must not broadly coerce stored epoch keys before coverage checks",
  );
  assert.doesNotMatch(
    dataSyncHealthSource,
    /function parseStoredEpochNumber[\s\S]*const parsed = Number\(value\)[\s\S]*Number\.isSafeInteger\(parsed\)/,
    "data-sync health stored epoch parser must not narrow decimal strings before BigInt bounds checks",
  );
  assert.doesNotMatch(
    dataSyncHealthSource,
    /Number\(indexerRunStatus\?\.lastHeartbeatAt|Number\(indexerRunStatus\?\.completedAt/,
    "data-sync health must not broadly coerce indexer run timestamps for active detection",
  );
  assert.doesNotMatch(
    dataSyncHealthSource,
    /const n = Number\(v\)|now - Number\(timestamp\)/,
    "data-sync health must not broadly coerce env diagnostics or validated timestamps",
  );
  assert.doesNotMatch(
    dataSyncHealthSource,
    /(^|[^A-Za-z0-9_])Number\(chainEpochRaw\)|(^|[^A-Za-z0-9_])Number\(jackpotsInfo\[[45]\]\)/,
    "data-sync health must not broadly coerce chain uint256 epoch evidence",
  );
  assert.doesNotMatch(
    dataSyncHealthSource,
    /(^|[^A-Za-z0-9_])Number\(head -|(^|[^A-Za-z0-9_])Number\(dbLastIndexedBlock -|(^|[^A-Za-z0-9_])Number\(\(dbLastIndexedBlock > head \? head : dbLastIndexedBlock\)|(^|[^A-Za-z0-9_])Number\(latestRewardClaimBlock -/,
    "data-sync health must not broadly coerce bigint block deltas",
  );
  assert.doesNotMatch(
    dataSyncHealthSource,
    /\.\.\.\(indexer(?:RunStatus|RepairStatus|ReconcileStatus) \?\? \{\}\)/,
    "data-sync health must not publish raw indexer status metadata into diagnostics",
  );
  assert.doesNotMatch(
    dataSyncHealthSource,
    /Math\.max\(\s*\.\.\.recentRewardClaims/,
    "data-sync health must not Math.max an unchecked reward-claim block list",
  );
  assert.match(
    dataSyncHealthSource,
    /function toHealthResponse[\s\S]*applyNoStoreHeaders\(NextResponse\.json[\s\S]*function toHealthErrorResponse[\s\S]*applyNoStoreHeaders\(NextResponse\.json/,
    "data-sync health error responses must use the no-store helper",
  );
  assert.match(
    dataSyncHealthSource,
    /authorized[\s\S]*Internal error/,
    "data-sync public health errors must be redacted",
  );
  assert.match(
    dataSyncHealthSource,
    /describeSafeRouteError\(err\)\.message/,
    "data-sync private health errors must redact provider URLs and identifiers",
  );
  assert.match(
    dataSyncHealthSource,
    /function redactHealthResponse[\s\S]*diskFreeBytes: null/,
    "public data-sync health must not disclose host disk capacity",
  );
  const adminAuthSource = readFileSync("app/api/admin/auth/route.ts", "utf8");
  assert.match(
    adminAuthSource,
    /readBoundedJsonBody<AdminAuthPayload>/,
    "admin auth POST must bound and safely parse malformed JSON",
  );
  assert.match(
    adminAuthSource,
    /Invalid auth payload/,
    "admin auth POST must return a clear invalid-payload error for malformed JSON",
  );
  assert.match(
    readFileSync("app/lib/adminAuth.ts", "utf8"),
    /normalizeAdminAuthAddress[\s\S]*getAddress/,
    "admin auth must normalize wallet addresses with the EVM address parser",
  );
  assert.match(
    readFileSync("app/lib/adminAuth.ts", "utf8"),
    /const fields = \{ address, uri, chainId, nonce, issuedAt \};[\s\S]*normalized !== buildAdminAuthMessage\(fields\)/,
    "admin auth must reject non-canonical signed messages before issuing a privileged session",
  );
  assert.match(
    readFileSync("app/lib/adminAuth.ts", "utf8"),
    /function parseCanonicalIssuedAtMs[\s\S]*toISOString\(\) === issuedAt[\s\S]*parseCanonicalIssuedAtMs\(issuedAt\)/,
    "admin auth must reject non-canonical issuedAt timestamps before TTL checks",
  );
  assert.match(
    readFileSync("app/lib/adminAuth.ts", "utf8"),
    /function parseCanonicalChainId[\s\S]*\^\[1-9\]\\d\{0,15\}\$[\s\S]*Number\.isSafeInteger\(parsed\)[\s\S]*const chainId = parseCanonicalChainId\(values\.get\("chain id"\)\)[\s\S]*chainId === null/,
    "admin auth must canonical-parse signed chain IDs before session issuance",
  );
  assert.match(
    readFileSync("app/lib/adminAuth.ts", "utf8"),
    /function parseCanonicalNonce[\s\S]*\^\[a-f0-9\]\{32,128\}\$[\s\S]*const nonce = parseCanonicalNonce\(values\.get\("nonce"\)\)[\s\S]*nonce === null/,
    "admin auth must canonical-parse signed nonces before session issuance",
  );
  assert.doesNotMatch(
    readFileSync("app/lib/adminAuth.ts", "utf8"),
    /Number\(values\.get\("chain id"\)|Number\.isInteger\(chainId\)/,
    "admin auth must not use broad Number() parsing for signed chain IDs",
  );
  assert.doesNotMatch(
    readFileSync("app/lib/adminAuth.ts", "utf8"),
    /\^\[a-f0-9\]\{32,128\}\$\/i|values\.get\("nonce"\) \?\? ""/,
    "admin auth must not accept case-insensitive or default-empty signed nonces",
  );
  assert.match(
    readFileSync("app/lib/adminAuth.ts", "utf8"),
    /export function getAdminAuthProofTtlMs[\s\S]*parseCanonicalIssuedAtMs\(issuedAt\)[\s\S]*Number\.isSafeInteger\(now\)[\s\S]*remainingMs > 0 \? remainingMs : null/,
    "admin auth replay-lock TTL must use canonical issuedAt parsing",
  );
  assert.match(
    adminAuthSource,
    /getAdminAuthProofTtlMs\(fields\.issuedAt\)[\s\S]*ttlMs === null[\s\S]*Expired auth proof[\s\S]*consumeAdminProof\(authAddress, fields\.nonce, fields\.uri, ttlMs\)/,
    "admin auth route must fail closed before replay-lock consumption when issuedAt TTL is invalid",
  );
  assert.doesNotMatch(
    adminAuthSource,
    /Date\.parse\(fields\.issuedAt\)|ADMIN_AUTH_PROOF_TTL_MS - \(Date\.now\(\) - issuedAtMs\)/,
    "admin auth route must not recalculate replay-lock TTL with broad Date.parse",
  );
  assert.match(
    adminAuthSource,
    /normalizeAdminAuthAddress\(body\.authAddress\)/,
    "admin auth route must reuse the shared wallet address normalizer",
  );
  assert.match(
    adminAuthSource,
    /isTrustedAuthUri\(fields\.uri, trustedOrigin, "\/admin"\)/,
    "admin auth route must bind signed messages to the exact admin URI path",
  );
  assert.doesNotMatch(
    adminAuthSource,
    /new URL\(fields\.uri\)\.origin/,
    "admin auth route must not accept signed messages by origin-only URI comparison",
  );
  assert.match(
    adminAuthSource,
    /requiresExternalSharedLock\(\)[\s\S]*acquireExternalExpiringLock/,
    "admin auth must use a shared replay lock when production runs more than one web replica",
  );
  assert.match(
    adminAuthSource,
    /import \{ createHash \} from "node:crypto";[\s\S]*function buildProofKey\(address: string, nonce: string, uri: string\)[\s\S]*createHash\("sha256"\)[\s\S]*digest\("hex"\)/,
    "admin auth replay locks must use a bounded hashed proof key instead of raw URI-bearing keys",
  );
  assert.doesNotMatch(
    adminAuthSource,
    /return `\$\{address\.toLowerCase\(\)\}:\$\{nonce\}:\$\{uri\}`/,
    "admin auth replay locks must not store raw address:nonce:uri proof keys",
  );
  assert.match(
    adminAuthSource,
    /bucket: "api-admin-auth-refresh"[\s\S]*if \(rateLimited\) return applyNoStoreHeaders\(rateLimited, \{ varyCookie: true \}\)/,
    "admin auth refresh rate-limit responses must keep no-store and Vary: Cookie session headers",
  );
  assert.match(
    readFileSync("app/api/_lib/adminSession.ts", "utf8"),
    /normalizeAdminAuthAddress/,
    "admin session cookies must store and validate normalized wallet addresses",
  );
  assert.match(
    readFileSync("app/admin/AdminOpsClient.tsx", "utf8"),
    /normalizeAdminAuthAddress/,
    "admin UI wallet matching must use the shared wallet address normalizer",
  );
  assert.doesNotMatch(
    readFileSync("app/admin/AdminOpsClient.tsx", "utf8"),
    /target="_blank"[\s\S]{0,120}rel="noreferrer"/,
    "admin ops new-tab links must explicitly use noopener noreferrer",
  );
  const adminCheckOwnerSource = readFileSync("app/api/admin/check-owner/route.ts", "utf8");
  assert.match(
    adminCheckOwnerSource,
    /normalizedAddress\s*=\s*getAddress\(address \?\? ""\)\.toLowerCase\(\)/,
    "admin owner check must normalize the query wallet before comparing it to owner()",
  );
  assert.doesNotMatch(
    adminCheckOwnerSource,
    /\^0x\[0-9a-f\]\{40\}/,
    "admin owner check must not rely on a hand-written query-address regex",
  );
  for (const routePath of [
    "app/api/admin/auth/route.ts",
    "app/api/admin/processes/route.ts",
    "app/api/chat/auth/route.ts",
    "app/api/chat/messages/route.ts",
    "app/api/chat/profile/route.ts",
    "app/api/rewards/route.ts",
  ]) {
    const routeSource = readFileSync(routePath, "utf8");
    assert.match(routeSource, /readBoundedJsonBody/, `${routePath} must bound JSON request bodies`);
    assert.match(
      routeSource,
      /reason === "unsupported-content-type"[\s\S]*(?:status:\s*)?415/,
      `${routePath} must preserve unsupported media type as an explicit 415 response`,
    );
    assert.doesNotMatch(routeSource, /request\.json\(/, `${routePath} must not read unbounded JSON bodies`);
  }
  const boundedJsonRoutePaths = listSourceFiles("app/api", /^route\.(?:ts|tsx)$/)
    .filter((routePath) => readFileSync(routePath, "utf8").includes("readBoundedJsonBody"));
  assert.ok(boundedJsonRoutePaths.length >= 6, "bounded JSON route discovery must cover existing admin/chat/rewards routes");
  for (const routePath of boundedJsonRoutePaths) {
    const routeSource = readFileSync(routePath, "utf8");
    assert.match(
      routeSource,
      /reason === "unsupported-content-type"[\s\S]*(?:status:\s*)?415/,
      `${routePath} must preserve unsupported media type as an explicit 415 response`,
    );
    assert.doesNotMatch(routeSource, /request\.json\(/, `${routePath} must not read unbounded JSON bodies`);
  }
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
  for (const routePath of listSourceFiles("app/api", /^route\.(?:ts|tsx)$/)) {
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
  const bootstrapResolveBodyPolicySource = readFileSync("app/api/bootstrap-resolve/route.ts", "utf8");
  assert.match(
    bootstrapResolveBodyPolicySource,
    /hasUnexpectedRequestBody\(request\)[\s\S]*bootstrap_body_not_supported/,
    "bootstrap resolver POST must explicitly reject request bodies because it is a header-only trigger",
  );
  assert.match(
    bootstrapResolveBodyPolicySource,
    /ZERO_CONTENT_LENGTH_RE = \/\^0\$\/[\s\S]*function hasUnexpectedRequestBody\(request: Request\)[\s\S]*content-length[\s\S]*!ZERO_CONTENT_LENGTH_RE\.test\(contentLength\)[\s\S]*return request\.body !== null;/,
    "bootstrap resolver body guard must reject chunked bodies and non-canonical content-length before resolver work",
  );
  assert.doesNotMatch(
    bootstrapResolveBodyPolicySource,
    /request\.json\(|BigInt\(contentLength\)|\/\^\\d\+\$\/\.test\(contentLength\)/,
    "bootstrap resolver POST must not read unbounded JSON bodies or broadly parse content-length",
  );
  const adminProcessesSource = readFileSync("app/api/admin/processes/route.ts", "utf8");
  const adminOpsSource = readFileSync("app/api/admin/ops/route.ts", "utf8");
  for (const [routePath, routeSource] of [
    ["app/api/admin/processes/route.ts", adminProcessesSource],
    ["app/api/admin/ops/route.ts", adminOpsSource],
  ]) {
    assert.match(routeSource, /readAdminSession\(request\)/, `${routePath} must require a signed admin session`);
    assert.doesNotMatch(routeSource, /x-health-diagnostics-secret|isAuthorizedAdminRouteRequest/, `${routePath} must not accept the health diagnostics secret`);
  }
  assert.match(
    adminProcessesSource,
    /import \{ basename, resolve \} from "node:path"/,
    "admin process status must have access to path basename redaction",
  );
  assert.match(
    adminProcessesSource,
    /logFile:\s*basename\(config\.logFile\)/,
    "admin process status must expose only log file names",
  );
  assert.match(
    adminProcessesSource,
    /function pathIsRegularFile\(file: string\)[\s\S]*statSync\(file\)\.isFile\(\)[\s\S]*if \(!pathIsRegularFile\(config\.pidFile\)\) return null/,
    "admin process status must treat non-file pid/log artifacts as missing",
  );
  assert.match(
    adminProcessesSource,
    /TRACKED_PID_RE = \/\^\[1-9\]\\d\{0,9\}\$\/[\s\S]*MAX_TRACKED_PID_BIGINT = BigInt\(MAX_TRACKED_PID\)[\s\S]*if \(!TRACKED_PID_RE\.test\(raw\)\) return null[\s\S]*const pid = BigInt\(raw\)[\s\S]*pid <= MAX_TRACKED_PID_BIGINT \? Number\(pid\) : null/,
    "admin process status must reject malformed, coerced, or out-of-range tracked PID files",
  );
  assert.doesNotMatch(
    adminProcessesSource,
    /Number\(raw\)|Number\.isInteger\(pid\)|Number\.isSafeInteger\(pid\)/,
    "admin process status must not accept broad Number(raw) PID parsing",
  );
  assert.doesNotMatch(
    adminProcessesSource,
    /logFile:\s*config\.logFile/,
    "admin process status must not expose absolute server log paths",
  );
  assert.match(
    adminOpsSource,
    /SAFE_DECIMAL_INTEGER_RE\s*=\s*\/\^\[1-9\]\\d\{0,15\}\$\/[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseSafeDecimalInteger[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*function parseStoredEpochNumber[\s\S]*parseSafeDecimalInteger\(value\) \?\? 0/,
    "admin ops must parse stored epoch keys with a bounded BigInt decimal parser",
  );
  assert.match(
    adminOpsSource,
    /function parseLogCounter[\s\S]*parseSafeDecimalInteger\(value, options\)[\s\S]*scanBlockCount = parseLogCounter\(scanMatch\[3\][\s\S]*chunkIndex = parseLogCounter\(chunkMatch\[1\][\s\S]*fetchedLogs = parseLogCounter\(fetchedMatch\[3\][\s\S]*parsedClaims = parseLogCounter\(parsedMatch\[6\]/,
    "admin ops must parse live indexer log counters with the bounded decimal parser",
  );
  assert.match(
    adminOpsSource,
    /ISO_LOG_TIMESTAMP_RE[\s\S]*function extractTimestamp[\s\S]*\\\.\\d\{3\}[\s\S]*function parseLogTimestampMs\(value: string \| null\)[\s\S]*Date\.parse\(canonical\)[\s\S]*toISOString\(\) === canonical[\s\S]*const leftTs = parseLogTimestampMs\(left\.ts\)[\s\S]*const rightTs = parseLogTimestampMs\(right\.ts\)/,
    "admin ops must canonical-parse recent log timestamps before sorting",
  );
  assert.doesNotMatch(
    adminOpsSource,
    /Number\((?:scanMatch|chunkMatch|fetchedMatch|parsedMatch)\[|const parsed = Number\(value\)|Number\.isSafeInteger\(parsed\)/,
    "admin ops must not coerce live indexer log counters with broad Number parsing",
  );
  assert.doesNotMatch(
    adminOpsSource,
    /Date\.parse\(left\.ts\)|Date\.parse\(right\.ts\)|\(\?:\\\.\\d\+\)\?Z/,
    "admin ops must not broadly Date.parse raw recent log timestamps",
  );
  assert.match(
    adminOpsSource,
    /function pathIsRegularFile\(file: string\)[\s\S]*statSync\(file\)\.isFile\(\)[\s\S]*if \(!pathIsRegularFile\(file\)\)[\s\S]*return `\$\{source\.key\}:missing`/,
    "admin ops must treat non-file log artifacts as missing before reading tails",
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
  assert.match(
    adminOpsSource,
    /SECRET\|TOKEN\|KEY\|PRIVATE\|PASSWORD\|RPC\|DSN\|WEBHOOK[\s\S]*<redacted>[\s\S]*https\?:\\\/\\\/\[\^\\s"'<>\]\+[\s\S]*<redacted-url>[\s\S]*<redacted-address>/,
    "admin ops log summaries must redact secret-like assignments, URLs, and wallet addresses before returning JSON",
  );
  const adminOpsClientUiSource = readFileSync("app/admin/AdminOpsClient.tsx", "utf8");
  assert.match(
    adminOpsClientUiSource,
    /function describeAdminClientError\(error: unknown\)[\s\S]*sanitizeSupportLogPayload\(message\)[\s\S]*slice\(0, 220\)[\s\S]*Admin operation failed/,
    "admin ops UI errors must be redacted and bounded before display",
  );
  assert.match(
    adminOpsClientUiSource,
    /function fmtPercent\(value\?: number \| null\)[\s\S]*safeToFixed\(value, 2, "\.\.\."\)[\s\S]*function fmtAge\(value\?: number \| null\)[\s\S]*safeToFixed\(seconds, 1, "\.\.\."\)[\s\S]*safeToFixed\(minutes, 1, "\.\.\."\)[\s\S]*safeToFixed\(hours, 1, "\.\.\."\)[\s\S]*function fmtGib\(value\?: number \| null\)[\s\S]*safeToFixed\(value \/ 1_073_741_824, 2, "\.\.\."\)[\s\S]*function fmtPct\(value: number \| null\)[\s\S]*safeToFixed\(value, 0, "\.\.\."\)/,
    "admin ops display metrics must use bounded shared fixed-number formatting",
  );
  assert.doesNotMatch(
    adminOpsClientUiSource,
    /\.toFixed\(/,
    "admin ops display metrics must not call toFixed directly",
  );
  assert.match(
    adminOpsClientUiSource,
    /setAdminAuthError\(describeAdminClientError\(error\)\)/,
    "admin ops owner-signature verification errors must use the sanitized display path",
  );
  assert.doesNotMatch(
    adminOpsClientUiSource,
    /setErrorText\([^)]*error instanceof Error \? error\.message : String\(error\)/,
    "admin ops UI must not display raw Error messages",
  );
  const adminOpsButtonTags = [...adminOpsClientUiSource.matchAll(/<button[\s\S]*?>/g)].map((match) => match[0]);
  assert.ok(adminOpsButtonTags.length >= 6, "admin ops UI button guard must cover action buttons");
  assert.equal(
    adminOpsButtonTags.filter((tag) => !/\btype="button"/.test(tag)).length,
    0,
    "admin ops action buttons must not default to form submit semantics",
  );
  const sharedRateLimitSource = readFileSync("app/api/_lib/sharedRateLimit.ts", "utf8");
  const checkLocalSource = readFileSync("scripts/check-local.mjs", "utf8");
  const fetchTimeoutTestSource = readFileSync("scripts/test-fetch-with-timeout.ts", "utf8");
  const chainIndexerAuditSource = readFileSync("scripts/audit-chain-indexer-window.mjs", "utf8");
  assert.equal(
    monitoringPackageScripts["check:summary"],
    "node scripts/check-local.mjs --summary-only",
    "local check must expose a compact summary alias for long operator runs",
  );
  assert.match(checkLocalSource, /const summaryOnly = process\.argv\.includes\("--summary-only"\)/);
  assert.match(
    checkLocalSource,
    /if \(compact && result\.status === 0\) \{[\s\S]*return;[\s\S]*\}/,
    "summary-only local checks must suppress successful child output",
  );
  assert.match(
    checkLocalSource,
    /return redactProofText\(filtered\);/,
    "local check output must pass through proof redaction before printing",
  );
  assert.equal(
    monitoringPackageScripts["audit:chain-indexer:summary"],
    "node scripts/audit-chain-indexer-window.mjs --summary-only",
    "chain/indexer reconciliation must expose a compact summary command",
  );
  assert.match(
    chainIndexerAuditSource,
    /const summaryOnly = process\.argv\.includes\("--summary-only"\)[\s\S]*if \(summaryOnly\)[\s\S]*mismatches=\$\{summary\.mismatches\.length\}[\s\S]*accountingMismatches=\$\{summary\.accounting\.mismatchCount\}[\s\S]*console\.log\(JSON\.stringify\(summary\)\)/,
    "chain/indexer audit summary mode must avoid printing the full proof JSON payload",
  );
  assert.match(
    chainIndexerAuditSource,
    /DECIMAL_INTEGER_RE[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*parseBoundedIntegerEnv\("CHAIN_INDEXER_AUDIT_EPOCHS", 50, 1, 500\)[\s\S]*parseBoundedInteger\("--end-epoch"[\s\S]*parseBoundedIntegerEnv\("INDEXER_FINALITY_BLOCKS", 0, 0, 1_000_000\)[\s\S]*function parseBoundedInteger\(name, raw, min, max\)[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)/,
    "chain/indexer audit window and finality inputs must be canonical decimal and range checked before DB/RPC work",
  );
  assert.match(
    chainIndexerAuditSource,
    /function parseDbInteger\(label, value, min = 0, max = Number\.MAX_SAFE_INTEGER\)[\s\S]*const parsed = BigInt\(raw\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*function parseDbTileId\(label, value\)[\s\S]*parseDbInteger\(label, value, 1, MAX_TILE_ID\)/,
    "chain/indexer audit must BigInt-bound DB epoch, block, and tile integers before comparisons",
  );
  assert.match(
    chainIndexerAuditSource,
    /function parseDbInteger\(label, value, min = 0, max = Number\.MAX_SAFE_INTEGER\)[\s\S]*DECIMAL_INTEGER_RE\.test\(raw\)[\s\S]*Number\.isSafeInteger\(parsed\)[\s\S]*scoped_epochs first epoch[\s\S]*scoped_epochs first resolved_block[\s\S]*scoped_bets first block_number[\s\S]*scoped_epochs epoch[\s\S]*dust_settlement epoch/,
    "chain/indexer audit must validate DB epoch and block rows before deriving or comparing audit rows",
  );
  assert.match(
    chainIndexerAuditSource,
    /MAX_SAFE_BLOCK_NUMBER = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function toSqlBlockNumber\(label, value\)[\s\S]*value > MAX_SAFE_BLOCK_NUMBER[\s\S]*const sqlFromBlock = toSqlBlockNumber\("audit fromBlock", fromBlock\)[\s\S]*const sqlToBlock = toSqlBlockNumber\("audit toBlock", toBlock\)[\s\S]*block_number BETWEEN \? AND \?[\s\S]*sqlFromBlock, sqlToBlock/,
    "chain/indexer audit must range-check BigInt block windows before SQL numeric bindings",
  );
  assert.match(
    chainIndexerAuditSource,
    /MAX_TILE_ID = 25[\s\S]*function parseDbTileId\(label, value\)[\s\S]*parseDbInteger\(label, value, 1, MAX_TILE_ID\)[\s\S]*function parseChainTileId\(label, value\)[\s\S]*typeof value !== "bigint"[\s\S]*value > BigInt\(MAX_TILE_ID\)[\s\S]*parseDbTileId\(`epoch \$\{epoch\} winning_tile`, row\.winning_tile\)[\s\S]*parseChainTileId\(`epoch \$\{epoch\} winningTile`, args\.winningTile\)/,
    "chain/indexer audit must safely compare winning tile evidence without broad Number coercion",
  );
  assert.match(
    chainIndexerAuditSource,
    /function parseChainEpoch\(value\)[\s\S]*typeof value !== "bigint"[\s\S]*value > BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*const epoch = "epoch" in args \? parseChainEpoch\(args\.epoch\) : null[\s\S]*const inEpochWindow = epoch !== null && epoch >= startEpoch && epoch <= endEpoch/,
    "chain/indexer audit must safely narrow decoded chain epoch evidence before window comparisons",
  );
  assert.doesNotMatch(
    chainIndexerAuditSource,
    /Number\(process\.env\.CHAIN_INDEXER_AUDIT_EPOCHS|BigInt\(process\.env\.INDEXER_FINALITY_BLOCKS|Number\(endEpochArg\.slice|Number\(epochRows|Number\(row\.epoch\)|BigInt\(epochRows|Number\(row\.winning_tile\)|Number\(args\.winningTile\)|Number\(args\.epoch\)|Number\(fromBlock\)|Number\(toBlock\)/,
    "chain/indexer audit must not broadly coerce audit window, finality, end-epoch, DB epoch rows, chain epoch evidence, or winning tile evidence",
  );
  assert.match(
    chainIndexerAuditSource,
    /function normalizeLogTransactionHash\(log\)[\s\S]*\/\^0x\[0-9a-f\]\{64\}\$\/\.test\(normalized\)[\s\S]*function eventId\(log\)[\s\S]*log\.logIndex === null[\s\S]*return `\$\{normalizedHash\}_\$\{log\.logIndex\.toString\(\)\}`/,
    "chain/indexer audit event ids must require a full 32-byte tx hash and log index",
  );
  assert.match(
    chainIndexerAuditSource,
    /function betEventKey\(epoch, log\)[\s\S]*return normalizedHash \? `\$\{epoch\}_\$\{normalizedHash\}` : null/,
    "chain/indexer audit bet reconciliation must share the full-hash bet identity rule",
  );
  assert.doesNotMatch(
    chainIndexerAuditSource,
    /`?\$\{log\.transactionHash \?\? "nohash"\}_\$\{log\.logIndex\?\.toString\(\) \?\? "0"\}`?|`\$\{epoch\}_\$\{String\(log\.transactionHash \?\? ""\)\.toLowerCase\(\)\}`|rebateBatchClaimTxs\.has\(log\.transactionHash\.toLowerCase\(\)\)/,
    "chain/indexer audit must not use synthetic nohash event ids or raw lowercase transaction hashes",
  );
  assert.match(
    checkLocalSource,
    /args:\s*\["run", "test:logic"\][\s\S]*args:\s*\["run", "proof:security-followup"\][\s\S]*args:\s*\["run", "test:fetch-timeout"\][\s\S]*args:\s*\["run", "test:stored-number-parsing"\]/,
    "local check must include residual security follow-up plus fetch timeout and stored-number parsing stability tests",
  );
  assert.match(
    checkLocalSource,
    /test-business-logic\.mjs[\s\S]*check-security-followup\.mjs[\s\S]*test-fetch-with-timeout\.ts[\s\S]*test-stored-number-parsing\.ts/,
    "non-npm local check fallback must include residual security follow-up plus fetch timeout and stored-number parsing stability tests",
  );
  assert.match(
    fetchTimeoutTestSource,
    /import \{ redactProofText \} from "\.\/redact-proof-output\.mjs"[\s\S]*function describeFetchTimeoutTestError\(error: unknown\)[\s\S]*redactProofText\(/,
    "fetch-timeout local proof test failures must use the shared proof redactor",
  );
  assert.match(
    fetchTimeoutTestSource,
    /MAX_FETCH_TIMEOUT_TEST_ERROR_CHARS[\s\S]*<truncated>[\s\S]*console\.error\(describeFetchTimeoutTestError\(error\)\)/,
    "fetch-timeout local proof test failures must be compact and bounded",
  );
  const fetchWithTimeoutSource = readFileSync("app/lib/fetchWithTimeout.ts", "utf8");
  assert.match(
    fetchWithTimeoutSource,
    /DEFAULT_FETCH_TIMEOUT_MS = 12_000[\s\S]*MAX_FETCH_TIMEOUT_MS = 120_000[\s\S]*Number\.isSafeInteger\(timeoutMs\)[\s\S]*timeoutMs <= 0[\s\S]*timeoutMs > MAX_FETCH_TIMEOUT_MS[\s\S]*fetch timeout must be between 1 and 120000 milliseconds/,
    "fetchWithTimeout must reject fractional, unsafe, or oversized timer delays before starting requests",
  );
  assert.doesNotMatch(
    fetchWithTimeoutSource,
    /timeoutMs > MAX_TIMER_DELAY_MS[\s\S]*fetch timeout must be between 1 and 2147483647 milliseconds/,
    "fetchWithTimeout must not allow raw maximum timer delays for UI/API fetches",
  );
  assert.doesNotMatch(
    fetchWithTimeoutSource,
    /Number\.isFinite\(timeoutMs\)/,
    "fetchWithTimeout must not broadly accept finite fractional timeouts",
  );
  assert.match(
    fetchTimeoutTestSource,
    /await fetchWithTimeout\("http:\/\/localhost\/max", \{\}, 120_000\)[\s\S]*for \(const invalidTimeoutMs of \[-1, 1\.5, Number\.NaN, Number\.POSITIVE_INFINITY, 120_001, 2_147_483_648, Number\.MAX_SAFE_INTEGER \+ 1\]\)/,
    "fetch-timeout tests must cover fractional, unsafe, and oversized timeout values",
  );
  assert.doesNotMatch(
    fetchTimeoutTestSource,
    /console\.error\(error\)/,
    "fetch-timeout local proof test must not print raw Error objects",
  );
  assert.match(
    checkLocalSource,
    /args:\s*\["run", "test:contract"\][\s\S]*args:\s*\["run", "test:contract:v10"\]/,
    "local check must gate both V9 compatibility and active V10 contract invariants",
  );
  assert.match(
    checkLocalSource,
    /test-contract-v9-invariants\.mjs[\s\S]*test-contract-v10-invariants\.mjs/,
    "non-npm local check fallback must gate both V9 and V10 contract invariants",
  );
  assert.match(
    checkLocalSource,
    /SMOKE_INCLUDE_DEBUG_AUTOMINER_SCENARIOS:\s*"1"/,
    "local check browser smoke must include Auto-Miner failure and pending-reload recovery scenarios",
  );
  assert.match(
    checkLocalSource,
    /args:\s*\["run", "test:indexer-storage"\][\s\S]*args:\s*\["run", "test:db-operations"\][\s\S]*args:\s*\["run", "test:monitoring"\]/,
    "local check must include SQLite operations and runtime monitoring drills before build/smoke",
  );
  assert.match(
    checkLocalSource,
    /test-indexer-event-storage\.ts[\s\S]*test-sqlite-operations\.mjs[\s\S]*test-runtime-monitor-drill\.mjs/,
    "non-npm local check fallback must include SQLite operations and runtime monitoring drills",
  );
  const indexerEventStorageTestSource = readFileSync("scripts/test-indexer-event-storage.ts", "utf8");
  assert.match(
    indexerEventStorageTestSource,
    /"batch_claim"[\s\S]*"resolver_reward"[\s\S]*"dust_settlement"[\s\S]*foreignChainScope[\s\S]*foreign resolver rewards must not override current scope payloads[\s\S]*foreign dust settlements must not override current scope payloads[\s\S]*chainScopeIsolation: true/,
    "indexer storage test must prove every normalized metadata-only event category ignores foreign chain and contract scopes",
  );
  assert.match(
    checkLocalSource,
    /import \{ redactProofText \} from "\.\/redact-proof-output\.mjs"[\s\S]*function describeCheckLocalError\(error\)[\s\S]*redactProofText\(/,
    "local check spawn errors must use the shared proof redactor",
  );
  assert.match(
    checkLocalSource,
    /MAX_CHECK_LOCAL_ERROR_CHARS[\s\S]*<truncated>[\s\S]*throw result\.error;[\s\S]*console\.error\(describeCheckLocalError\(checkFailure\)\)/,
    "local check spawn errors must stay compact and bounded after failure-safe finalization",
  );
  assert.doesNotMatch(
    checkLocalSource,
    /console\.error\(result\.error\)|process\.exit\(/,
    "local check must not print raw spawn errors or bypass finalization with process.exit",
  );
  const sqliteStartupSource = readFileSync("scripts/check-sqlite-startup.mjs", "utf8");
  assert.match(
    sqliteStartupSource,
    /import \{ redactProofText \} from "\.\/redact-proof-output\.mjs"[\s\S]*function describeStartupError\(error\)[\s\S]*redactProofText\(/,
    "SQLite startup terminal failures must use the shared proof redactor",
  );
  assert.match(
    sqliteStartupSource,
    /MAX_DB_STARTUP_ERROR_CHARS[\s\S]*<truncated>[\s\S]*\[db-startup\] FAIL \$\{describeStartupError\(error\)\}/,
    "SQLite startup terminal failures must be compact and bounded",
  );
  const liveStateRecoverySource = readFileSync("scripts/smoke-live-state-recovery.mjs", "utf8");
  assert.match(
    liveStateRecoverySource,
    /import \{ redactProofText \} from "\.\/redact-proof-output\.mjs"[\s\S]*function describeRecoveryError\(error\)[\s\S]*redactProofText\(/,
    "live-state recovery terminal failures must use the shared proof redactor",
  );
  assert.match(
    liveStateRecoverySource,
    /MAX_RECOVERY_ERROR_CHARS[\s\S]*<truncated>[\s\S]*console\.error\(describeRecoveryError\(error\)\)/,
    "live-state recovery terminal failures must be compact and bounded",
  );
  assert.match(
    liveStateRecoverySource,
    /let pageErrorCount = 0[\s\S]*page\.on\("pageerror", \(\) => \{[\s\S]*pageErrorCount \+= 1/,
    "live-state recovery smoke must count page errors without storing raw page error text",
  );
  assert.doesNotMatch(
    liveStateRecoverySource,
    /pageErrors\.push\(error\.message\)/,
    "live-state recovery smoke must not store raw page error messages",
  );
  for (const options of [
    { bucket: "", limit: 10, windowMs: 60_000 },
    { bucket: "api invalid bucket", limit: 10, windowMs: 60_000 },
    { bucket: "https://rpc.example.test/private", limit: 10, windowMs: 60_000 },
    { bucket: "a".repeat(81), limit: 10, windowMs: 60_000 },
    { bucket: "api-invalid-limit", limit: Number.NaN, windowMs: 60_000 },
    { bucket: "api-invalid-limit", limit: 0, windowMs: 60_000 },
    { bucket: "api-invalid-limit", limit: 10_001, windowMs: 60_000 },
    { bucket: "api-invalid-window", limit: 10, windowMs: Number.POSITIVE_INFINITY },
    { bucket: "api-invalid-window", limit: 10, windowMs: 1.5 },
    { bucket: "api-invalid-window", limit: 10, windowMs: 86_400_001 },
  ]) {
    const response = await sharedRateLimit.enforceSharedRateLimit(
      new Request("https://lore.local/rate-limit-test"),
      options,
    );
    assert.ok(response, "malformed shared rate-limit options must fail closed");
    assert.equal(response.status, 503);
    assert.match(
      response.headers.get("Cache-Control") ?? "",
      /no-store/,
      "malformed shared rate-limit options must return no-store responses",
    );
    assert.deepEqual(await response.json(), { error: "Rate limit configuration unavailable" });
  }
  {
    const bucket = `api-runtime-429-${Date.now()}`;
    const first = await sharedRateLimit.enforceSharedRateLimit(
      new Request("https://lore.local/rate-limit-test", { headers: { "x-forwarded-for": "203.0.113.44" } }),
      { bucket, limit: 1, windowMs: 60_000 },
    );
    assert.equal(first, null, "first request inside a local fallback rate-limit window must be allowed");
    const second = await sharedRateLimit.enforceSharedRateLimit(
      new Request("https://lore.local/rate-limit-test", { headers: { "x-forwarded-for": "203.0.113.44" } }),
      { bucket, limit: 1, windowMs: 60_000 },
    );
    assert.ok(second, "second request inside a one-request rate-limit window must return a 429 response");
    assert.equal(second.status, 429);
    assert.match(second.headers.get("Cache-Control") ?? "", /no-store/);
    const retryAfterHeader = Number.parseInt(second.headers.get("Retry-After") ?? "", 10);
    assert.ok(
      Number.isSafeInteger(retryAfterHeader) && retryAfterHeader >= 1 && retryAfterHeader <= 60,
      "rate-limit Retry-After header must stay bounded to the active local window",
    );
    assert.deepEqual(await second.json(), { error: "Too many requests", retryAfter: retryAfterHeader });
  }
  assert.match(sharedRateLimitSource, /describeSafeRouteError\(error\)/);
  assert.doesNotMatch(sharedRateLimitSource, /warnKey\s*=\s*`\$\{bucket\}:\$\{message\}`/);
  assert.match(
    sharedRateLimitSource,
    /formatRateLimitLogBucket[\s\S]*RATE_LIMIT_LOG_LABEL_ALLOWED[\s\S]*MAX_RATE_LIMIT_LOG_LABEL_LENGTH/,
    "rate-limit warning labels must sanitize and clamp bucket names before console output",
  );
  assert.doesNotMatch(
    sharedRateLimitSource,
    /console\.warn\(`\[rate-limit:\$\{bucket\}\]/,
    "rate-limit warnings must not interpolate raw bucket names into server logs",
  );
  assert.match(
    sharedRateLimitSource,
    /MAX_LOCAL_FALLBACK_ENTRIES[\s\S]*localFallbackMap\.size >= MAX_LOCAL_FALLBACK_ENTRIES[\s\S]*rateLimitExceededResponse\(\(resetAt - now\) \/ 1000\)/,
    "local rate-limit fallback must fail closed instead of growing beyond its active-key cap",
  );
  assert.match(
    sharedRateLimitSource,
    /applyNoStoreHeaders/,
    "rate-limit 429 responses must be no-store",
  );
  assert.match(
    sharedRateLimitSource,
    /function rateLimitExceededResponse\(retryAfterSeconds: number\): NextResponse[\s\S]*normalizeRetryAfterSeconds\(retryAfterSeconds\)[\s\S]*\{ error: "Too many requests", retryAfter \}[\s\S]*headers: \{ "Retry-After": String\(retryAfter\) \}[\s\S]*applyNoStoreHeaders/,
    "rate-limit 429 responses must include a bounded Retry-After header through the shared no-store helper",
  );
  assert.match(
    sharedRateLimitSource,
    /MAX_RATE_LIMIT_BUCKET_LENGTH[\s\S]*MAX_RATE_LIMIT_LIMIT = 10_000[\s\S]*MAX_RATE_LIMIT_WINDOW_MS = 86_400_000[\s\S]*RATE_LIMIT_BUCKET_RE[\s\S]*function hasValidRateLimitOptions[\s\S]*RATE_LIMIT_BUCKET_RE\.test\(bucket\)[\s\S]*Number\.isSafeInteger\(limit\)[\s\S]*limit <= MAX_RATE_LIMIT_LIMIT[\s\S]*Number\.isSafeInteger\(windowMs\)[\s\S]*windowMs <= MAX_RATE_LIMIT_WINDOW_MS[\s\S]*rateLimitConfigurationUnavailableResponse\(\)/,
    "shared rate-limit config must fail closed before malformed bucket, limit, or window values can reach fallback counters",
  );
  assert.match(
    sharedRateLimitSource,
    /MAX_WEAK_BUCKET_FALLBACK_ENTRIES[\s\S]*weakBucketFallbackMap\.size >= MAX_WEAK_BUCKET_FALLBACK_ENTRIES[\s\S]*rateLimitExceededResponse\(\(resetAt - now\) \/ 1000\)/,
    "weak-identity bucket fallback must fail closed instead of growing beyond its active-bucket cap",
  );
  assert.doesNotMatch(
    sharedRateLimitSource,
    /status:\s*429(?!, headers: \{ "Retry-After": String\(retryAfter\) \})/,
    "rate-limit 429 responses must not bypass the shared Retry-After/no-store response builder",
  );
  assert.match(
    sharedRateLimitSource,
    /NODE_ENV === "production"[\s\S]*ALLOW_WEAK_RATE_LIMIT_IDENTITY !== "1"/,
    "production mode must fail closed when trusted proxy identity is missing",
  );
  assert.match(
    checkLocalSource,
    /const CHECK_LOCAL_NEXT_ENV = \{[\s\S]*NEXT_DIST_DIR: CHECK_LOCAL_DIST_DIR,[\s\S]*ALLOW_WEAK_RATE_LIMIT_IDENTITY: "1",[\s\S]*\};/,
    "local production smoke must opt into weak identity only in its isolated child-process environment",
  );
  assert.match(
    checkLocalSource,
    /mkdtempSync\(join\(CHECK_LOCAL_TEMP_ROOT, "check-local-"\)\)[\s\S]*LORE_DB_PATH: CHECK_LOCAL_DB_PATH[\s\S]*snapshotDatabaseFiles[\s\S]*mtimeNs[\s\S]*sha256[\s\S]*rmSync\(CHECK_LOCAL_TEMP_DIR, \{ recursive: true, force: true \}\)[\s\S]*assertProtectedDatabaseFilesUnchanged\(\)/,
    "local check must isolate SQLite in one unique temp directory, remove only that directory, and verify protected DB hash/mtime invariants",
  );
  assert.match(
    checkLocalSource,
    /async function startLocalServer\(baseUrl\) \{[\s\S]*if \(await canReachSmokeBaseUrl\(baseUrl\)\)[\s\S]*Refusing to start local server[\s\S]*const serverProcess = spawn/,
    "local production smoke must refuse a stale server before spawning its managed child",
  );
  assert.ok(
    sharedRateLimitSource.indexOf("normalized.count >= weakBucketLimit") <
      sharedRateLimitSource.indexOf("enforceLocalFallback(bucket, key, limit, windowMs, now)"),
    "weak-identity bucket cap must run before inserting a new per-client fallback key",
  );
  assert.match(
    chainIndexerAuditSource,
    /writeFileSync\(temporaryOutPath[\s\S]*renameSync\(temporaryOutPath, outPath\)/,
    "scheduled chain/indexer audit output must be atomically replaced so monitoring cannot read partial JSON",
  );
  assert.match(
    chainIndexerAuditSource,
    /function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*!dbPath \|\| !regularFileStat\(dbPath\)[\s\S]*LORE_DB_PATH must point to an existing indexer SQLite database file/,
    "chain/indexer audit must reject missing or directory DB paths before opening SQLite",
  );
  assert.match(
    chainIndexerAuditSource,
    /parseBoundedInteger\("--end-epoch"[\s\S]*must be a canonical decimal integer[\s\S]*must be between \$\{min\} and \$\{max\}/,
    "historical chain/indexer audits must reject invalid end epochs before DB/RPC work",
  );
  assert.match(
    chainIndexerAuditSource,
    /WHERE scope = \? AND epoch <= \? ORDER BY epoch DESC LIMIT \?/,
    "historical chain/indexer audits must select a bounded resolved-epoch window",
  );
  assert.match(
    chainIndexerAuditSource,
    /Promise\.all\(keys\.map/,
    "chain/indexer accounting snapshots must work without a configured multicall contract",
  );
  assert.match(
    chainIndexerAuditSource,
    /storedIndexerEventIds\("batch_claim"\)[\s\S]*storedIndexerEventIds\("resolver_reward"\)[\s\S]*storedIndexerEventIds\("dust_settlement"\)/,
    "chain/indexer audits must collect normalized event row ids for metadata-only categories",
  );
  assert.match(
    chainIndexerAuditSource,
    /RewardDustSettled[\s\S]*RebateDustSettled[\s\S]*dustSettlements/,
    "chain/indexer audits must compare per-epoch dust settlement events against normalized dust-settlement rows",
  );
  assert.doesNotMatch(
    chainIndexerAuditSource,
    /RewardDustBatchSettled|RebateDustBatchSettled/,
    "chain/indexer audits must not double-count aggregate batch dust events as per-epoch settlement evidence",
  );
  assert.match(
    chainIndexerAuditSource,
    /dbBatchClaimIds[\s\S]*seen\.batchClaims[\s\S]*dbResolverRewardIds[\s\S]*seen\.resolverRewards[\s\S]*dbDustSettlementIds[\s\S]*seen\.dustSettlements/,
    "chain/indexer audits must reject stale normalized batch-claim, resolver-reward, and dust-settlement rows",
  );
  assert.doesNotMatch(
    chainIndexerAuditSource,
    /client\.multicall/,
    "chain/indexer audits must not require multicall metadata on the local chain definition",
  );
  withTemporaryEnv(
    { TRUST_PROXY_HEADERS: "1", TRUST_PROXY_SECRET: "test-proxy-secret-with-at-least-32-characters" },
    () => {
      const directSpoof = clientIdentity.getClientIdentity(new Request("https://play.example/api/live-state", {
        headers: {
          "accept-language": "en-US",
          "user-agent": "same-nat-browser",
          "x-forwarded-for": "203.0.113.7",
        },
      }));
      assert.equal(directSpoof.weak, true, "proxy IP headers without the private proxy secret must be ignored");

      const trustedForward = clientIdentity.getClientIdentity(new Request("https://play.example/api/live-state", {
        headers: {
          "x-forwarded-for": "203.0.113.7, 10.0.0.2",
          "x-lore-proxy-secret": "test-proxy-secret-with-at-least-32-characters",
        },
      }));
      assert.deepEqual(trustedForward, { key: "xff:203.0.113.7", weak: false });

      const invalidTrustedForward = clientIdentity.getClientIdentity(new Request("https://play.example/api/live-state", {
        headers: {
          "x-forwarded-for": "not-an-ip, 10.0.0.2",
          "x-lore-proxy-secret": "test-proxy-secret-with-at-least-32-characters",
        },
      }));
      assert.equal(invalidTrustedForward.weak, true, "invalid trusted proxy IPs must fail closed");

      const trustedIpv6 = clientIdentity.getClientIdentity(new Request("https://play.example/api/live-state", {
        headers: {
          "cf-connecting-ip": "2001:db8::7",
          "x-lore-proxy-secret": "test-proxy-secret-with-at-least-32-characters",
        },
      }));
      assert.deepEqual(trustedIpv6, { key: "cf:2001:db8::7", weak: false });

      const wrongSecret = clientIdentity.getClientIdentity(new Request("https://play.example/api/live-state", {
        headers: {
          "user-agent": "same-nat-browser",
          "x-forwarded-for": "198.51.100.9",
          "x-lore-proxy-secret": "wrong-secret",
        },
      }));
      assert.equal(wrongSecret.weak, true, "a wrong proxy secret must not unlock forwarded IP trust");

      const shortSecret = clientIdentity.getClientIdentity(new Request("https://play.example/api/live-state", {
        headers: {
          "x-forwarded-for": "203.0.113.8",
          "x-lore-proxy-secret": "short",
        },
      }));
      assert.equal(shortSecret.weak, true, "short proxy trust secrets must not unlock forwarded IP trust");

      const oversizedHeaderSecret = clientIdentity.getClientIdentity(new Request("https://play.example/api/live-state", {
        headers: {
          "x-forwarded-for": "203.0.113.9",
          "x-lore-proxy-secret": "t".repeat(257),
        },
      }));
      assert.equal(oversizedHeaderSecret.weak, true, "oversized proxy trust secret headers must fail before trusted IP parsing");

      const sameNatIdentity = clientIdentity.getClientIdentity(new Request("https://play.example/api/live-state", {
        headers: {
          "accept-language": "en-US",
          "user-agent": "same-nat-browser",
          "x-forwarded-for": "192.0.2.99",
        },
      }));
      assert.equal(sameNatIdentity.key, directSpoof.key, "spoofed IP rotation must not bypass the weak identity bucket");

      const productionRunbookSource = readFileSync("docs/production-runbook.md", "utf8");
      assert.match(
        productionRunbookSource,
        /remove client-supplied `x-lore-proxy-secret`/,
        "production proxy guidance must require stripping the client-supplied trust secret",
      );
      assert.match(
        productionRunbookSource,
        /overwrite exactly one supported\s+client-IP header/,
        "production proxy guidance must require overwriting the trusted client IP",
      );
      assert.match(
        productionRunbookSource,
        /App origins must reject\s+direct public traffic/,
        "production proxy guidance must require blocking direct app-origin traffic",
      );
    },
  );
  const clientIdentitySource = readFileSync("app/api/_lib/clientIdentity.ts", "utf8");
  assert.ok(
    clientIdentitySource.includes("const MIN_PROXY_SECRET_LENGTH = 32") &&
      clientIdentitySource.includes("const MAX_PROXY_SECRET_LENGTH = 256") &&
      clientIdentitySource.includes("const CONTROL_CHAR_RE = /[\\u0000-\\u001f\\u007f]/;") &&
      /function normalizeProxySecret[\s\S]*secret\.length < MIN_PROXY_SECRET_LENGTH[\s\S]*secret\.length > MAX_PROXY_SECRET_LENGTH[\s\S]*CONTROL_CHAR_RE\.test\(secret\)/.test(clientIdentitySource),
    "client identity must bound and sanitize proxy trust secrets before comparing them",
  );
  assert.match(
    clientIdentitySource,
    /const expected = normalizeProxySecret\(process\.env\.TRUST_PROXY_SECRET\)[\s\S]*const provided = normalizeProxySecret\(request\.headers\.get\(PROXY_SECRET_HEADER\)\)[\s\S]*secretsMatch\(provided, expected\)/,
    "client identity must normalize both expected and provided proxy trust secrets before HMAC comparison",
  );
  await withTemporaryEnvAsync(
    {
      UPSTASH_REDIS_REST_URL: "https://redis.playlore.xyz",
      UPSTASH_REDIS_REST_TOKEN: "server-only-token",
    },
    async () => {
      let sentBody = null;
      const allowed = await externalRateLimit.consumeExternalRateLimit(
        "api-live-state",
        "identity-hash",
        2,
        60_000,
        60_001,
        async (_url, init) => {
          sentBody = JSON.parse(String(init?.body));
          return new Response(JSON.stringify({ result: [1, 59_999] }), { status: 200 });
        },
      );
      assert.deepEqual(allowed, { allowed: true });
      assert.deepEqual(sentBody.slice(0, 3), ["EVAL", sentBody[1], "1"]);
      assert.match(sentBody[3], /^lore:rate-limit:api-live-state:identity-hash:60000$/);

      const blocked = await externalRateLimit.consumeExternalRateLimit(
        "api-live-state",
        "identity-hash",
        2,
        60_000,
        60_001,
        async () => new Response(JSON.stringify({ result: [3, 12_001] }), { status: 200 }),
      );
      assert.deepEqual(blocked, { allowed: false, retryAfter: 13 });
      await assert.rejects(
        () => externalRateLimit.consumeExternalRateLimit(
          "api-live-state",
          "identity-hash",
          2,
          60_000,
          60_001,
          async () => new Response(JSON.stringify({ result: ["1e3", 12_001] }), { status: 200 }),
        ),
        /invalid counters/,
        "external rate-limit counters must reject scientific notation instead of broad Number coercion",
      );
      await assert.rejects(
        () => externalRateLimit.consumeExternalRateLimit(
          "api-live-state",
          "identity-hash",
          2,
          60_000,
          60_001,
          async () => new Response(JSON.stringify({ result: [3, "12.5"] }), { status: 200 }),
        ),
        /invalid counters/,
        "external rate-limit TTL must reject fractional values instead of broad Number coercion",
      );
      for (const [invalidBucket, invalidKey, invalidLimit, invalidWindowMs, invalidNow] of [
        ["", "identity-hash", 2, 60_000, 60_001],
        ["api/live-state", "identity-hash", 2, 60_000, 60_001],
        ["a".repeat(81), "identity-hash", 2, 60_000, 60_001],
        ["api-live-state", "", 2, 60_000, 60_001],
        ["api-live-state", "identity/hash", 2, 60_000, 60_001],
        ["api-live-state", "a".repeat(129), 2, 60_000, 60_001],
        ["api-live-state", "identity-hash", 0, 60_000, 60_001],
        ["api-live-state", "identity-hash", 2, 0, 60_001],
        ["api-live-state", "identity-hash", 2, 60_000, 60_001.5],
      ]) {
        await assert.rejects(
          () => externalRateLimit.consumeExternalRateLimit(
            invalidBucket,
            invalidKey,
            invalidLimit,
            invalidWindowMs,
            invalidNow,
            async () => {
              throw new Error("invalid external rate-limit request reached fetch");
            },
          ),
          /external rate-limit request parameters are invalid/,
          "external rate-limit must reject malformed request parameters before composing Redis keys",
        );
      }
      const sharedCounts = new Map();
      const sharedStoreFetch = async (_url, init) => {
        const command = JSON.parse(String(init?.body));
        const redisKey = String(command[3]);
        const count = (sharedCounts.get(redisKey) ?? 0) + 1;
        sharedCounts.set(redisKey, count);
        return new Response(JSON.stringify({ result: [count, 60_000] }), { status: 200 });
      };
      const replicaResults = await Promise.all([
        externalRateLimit.consumeExternalRateLimit("api-chat", "shared-user", 2, 60_000, 120_001, sharedStoreFetch),
        externalRateLimit.consumeExternalRateLimit("api-chat", "shared-user", 2, 60_000, 120_001, sharedStoreFetch),
        externalRateLimit.consumeExternalRateLimit("api-chat", "shared-user", 2, 60_000, 120_001, sharedStoreFetch),
      ]);
      assert.deepEqual(
        replicaResults.map((result) => result.allowed),
        [true, true, false],
        "multiple web replicas must consume one shared external rate-limit bucket",
      );
      await withTemporaryEnvAsync(
        {
          NODE_ENV: "production",
          WEB_REPLICA_COUNT: "2",
        },
        async () => {
          assert.equal(
            externalRateLimit.requiresExternalSharedLock(),
            true,
            "multiple production web replicas must use the shared proof replay lock",
          );
          let proofCommand = null;
          const acquired = await externalRateLimit.acquireExternalExpiringLock(
            "admin-auth:proof",
            30_000,
            async (_url, init) => {
              proofCommand = JSON.parse(String(init?.body));
              return new Response(JSON.stringify({ result: "OK" }), { status: 200 });
            },
          );
          assert.equal(acquired, true);
          assert.deepEqual(proofCommand.slice(0, 2), ["SET", proofCommand[1]]);
          assert.match(proofCommand[1], /^lore:proof-lock:[a-f0-9]{64}$/);
          assert.deepEqual(proofCommand.slice(2), ["1", "NX", "PX", "30000"]);
          const replayed = await externalRateLimit.acquireExternalExpiringLock(
            "admin-auth:proof",
            30_000,
            async () => new Response(JSON.stringify({ result: null }), { status: 200 }),
          );
          assert.equal(replayed, false, "a shared proof replay must not issue a second session");
        },
      );
      await withTemporaryEnvAsync(
        {
          NODE_ENV: "production",
          WEB_REPLICA_COUNT: "not-a-number",
        },
        async () => {
          assert.equal(
            externalRateLimit.requiresExternalSharedLock(),
            true,
            "invalid production replica count must fail closed by requiring the shared replay lock",
          );
        },
      );
      await withTemporaryEnvAsync(
        {
          NODE_ENV: "production",
          WEB_REPLICA_COUNT: "01",
        },
        async () => {
          assert.equal(
            externalRateLimit.requiresExternalSharedLock(),
            true,
            "leading-zero production replica count must fail closed by requiring the shared replay lock",
          );
        },
      );
      await withTemporaryEnvAsync(
        {
          NODE_ENV: "production",
          WEB_REPLICA_COUNT: (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString(),
        },
        async () => {
          assert.equal(
            externalRateLimit.requiresExternalSharedLock(),
            true,
            "unsafe production replica count must fail closed by requiring the shared replay lock",
          );
        },
      );
      await assert.rejects(
        () => externalRateLimit.consumeExternalRateLimit(
          "api-live-state",
          "identity-hash",
          2,
          60_000,
          60_001,
          async () => new Response(JSON.stringify({ error: "ERR test" }), { status: 400 }),
        ),
        /rejected request/,
      );
      await assert.rejects(
        () => externalRateLimit.consumeExternalRateLimit(
          "api-live-state",
          "identity-hash",
          2,
          60_000,
          60_001,
          async () => new Response(JSON.stringify({ result: ["x".repeat(8_300), 60_000] }), { status: 200 }),
        ),
        /invalid response/,
        "external rate-limit responses must be bounded before JSON parsing",
      );
      await assert.rejects(
        () => externalRateLimit.consumeExternalRateLimit(
          "api-live-state",
          "identity-hash",
          2,
          60_000,
          60_001,
          async () =>
            new Response(
              new Uint8Array([
                ...new TextEncoder().encode('{"result":[1,60000],"note":"'),
                0xff,
                ...new TextEncoder().encode('"}'),
              ]),
              { status: 200 },
            ),
        ),
        /invalid response/,
        "external rate-limit responses must fail closed on malformed UTF-8 instead of accepting replacement characters",
      );
      for (const malformedCounter of ["01", (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString()]) {
        await assert.rejects(
          () => externalRateLimit.consumeExternalRateLimit(
            "api-live-state",
            "identity-hash",
            2,
            60_000,
            60_001,
            async () => new Response(JSON.stringify({ result: [malformedCounter, 60_000] }), { status: 200 }),
          ),
          /invalid counters/,
          `external rate-limit counters must reject ${malformedCounter}`,
        );
      }
      await assert.rejects(
        () => externalRateLimit.consumeExternalRateLimit(
          "api-live-state",
          "identity-hash",
          2,
          60_000,
          60_001,
          async () => ({
            ok: true,
            status: 200,
            headers: { get: (name) => (name.toLowerCase() === "content-length" ? "8193" : null) },
            get body() {
              throw new Error("oversized external rate-limit response body must not be read");
            },
          }),
        ),
        /invalid response/,
        "external rate-limit responses must reject oversized Content-Length before body reads",
      );
      await assert.rejects(
        () => externalRateLimit.consumeExternalRateLimit(
          "api-live-state",
          "identity-hash",
          2,
          60_000,
          60_001,
          async () => ({
            ok: true,
            status: 200,
            headers: { get: (name) => (name.toLowerCase() === "content-length" ? String(Number.MAX_SAFE_INTEGER) : null) },
            get body() {
              throw new Error("safe-max external rate-limit response body must not be read");
            },
          }),
        ),
        /invalid response/,
        "external rate-limit responses must reject safe-max oversized Content-Length before body reads",
      );
      await assert.rejects(
        () => externalRateLimit.consumeExternalRateLimit(
          "api-live-state",
          "identity-hash",
          2,
          60_000,
          60_001,
          async () => ({
            ok: true,
            status: 200,
            headers: { get: (name) => (name.toLowerCase() === "content-length" ? "1e3" : null) },
            get body() {
              throw new Error("malformed external rate-limit response body must not be read");
            },
          }),
        ),
        /invalid response/,
        "external rate-limit responses must reject malformed Content-Length before body reads",
      );
      await assert.rejects(
        () => externalRateLimit.consumeExternalRateLimit(
          "api-live-state",
          "identity-hash",
          2,
          60_000,
          60_001,
          async () => ({
            ok: true,
            status: 200,
            headers: { get: (name) => (name.toLowerCase() === "content-length" ? (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString() : null) },
            get body() {
              throw new Error("unsafe external rate-limit response body must not be read");
            },
          }),
        ),
        /invalid response/,
        "external rate-limit responses must reject unsafe Content-Length before body reads",
      );
      assert.match(
        readFileSync("app/api/_lib/externalRateLimit.ts", "utf8"),
        /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseExternalRateLimitInteger[\s\S]*EXTERNAL_NON_NEGATIVE_INTEGER_RE\.test\(value\)[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*parseExternalRateLimitInteger\(payload\.result\[0\], 1\)[\s\S]*parseExternalRateLimitInteger\(payload\.result\[1\], 0\)/,
        "external rate-limit counter parsing must remain strict and fail closed on malformed Redis counters",
      );
      assert.match(
        readFileSync("app/api/_lib/externalRateLimit.ts", "utf8"),
        /function parseExternalReplicaCount[\s\S]*EXTERNAL_POSITIVE_INTEGER_RE\.test\(normalized\)[\s\S]*const parsed = BigInt\(normalized\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*requiresExternalSharedLock[\s\S]*parseExternalReplicaCount\(process\.env\.WEB_REPLICA_COUNT\)[\s\S]*replicaCount === null/,
        "production external shared lock detection must canonical-parse WEB_REPLICA_COUNT",
      );
      assert.match(
        readFileSync("app/api/_lib/externalRateLimit.ts", "utf8"),
        /function parseExternalRateLimitContentLength[\s\S]*EXTERNAL_NON_NEGATIVE_INTEGER_RE\.test\(value\)[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*response\.headers\.get\("content-length"\)[\s\S]*MAX_EXTERNAL_RATE_LIMIT_RESPONSE_BYTES[\s\S]*response\.body\.getReader\(\)[\s\S]*new TextDecoder\("utf-8", \{ fatal: true \}\)/,
        "external rate-limit response parsing must preflight strict Content-Length and use fatal UTF-8 decoding before parsing JSON",
      );
      assert.match(
        readFileSync("app/api/_lib/externalRateLimit.ts", "utf8"),
        /function hasValidExternalRateLimitRequest[\s\S]*MAX_EXTERNAL_RATE_LIMIT_BUCKET_LENGTH[\s\S]*MAX_EXTERNAL_RATE_LIMIT_KEY_LENGTH[\s\S]*EXTERNAL_RATE_LIMIT_ID_RE[\s\S]*Number\.isSafeInteger\(windowMs\)[\s\S]*Number\.isSafeInteger\(now\)/,
        "external rate-limit request parameters must be bounded before Redis key composition",
      );
      assert.doesNotMatch(
        readFileSync("app/api/_lib/externalRateLimit.ts", "utf8"),
        /Number\(payload\.result\[[01]\]\)|Number\(replicaCountRaw\)/,
        "external rate-limit counters and replica count must not use broad Number coercion",
      );
    },
  );
  for (const unsafeRateLimitEndpoint of [
    "http://redis.playlore.xyz",
    "https://user:pass@redis.playlore.xyz",
    "https://localhost:6379",
    "https://192.168.1.10",
    "https://[::ffff:127.0.0.1]",
    "https://[::ffff:10.0.0.1]",
    "https://[fe90::1]",
    "https://[2001:db8::1]",
    "https://redis.example",
    "https://redis.test",
  ]) {
    await withTemporaryEnvAsync(
      {
        UPSTASH_REDIS_REST_URL: unsafeRateLimitEndpoint,
        UPSTASH_REDIS_REST_TOKEN: "server-only-token",
      },
      async () => {
        await assert.rejects(
          () => externalRateLimit.consumeExternalRateLimit(
            "api-live-state",
            "identity-hash",
            2,
            60_000,
            60_001,
            async () => {
              throw new Error("unsafe external rate-limit endpoint reached fetch");
            },
          ),
          /external rate-limit store must use a public HTTPS endpoint/,
        );
      },
    );
  }
  await withTemporaryEnvAsync(
    {
      UPSTASH_REDIS_REST_URL: "https://localhost:6379",
      UPSTASH_REDIS_REST_TOKEN: "server-only-token",
    },
    async () => {
      assert.equal(
        externalRateLimit.hasPublicExternalRateLimitStore(),
        false,
        "runtime health must not report an unsafe external rate-limit endpoint as configured",
      );
    },
  );
  await withTemporaryEnvAsync(
    {
      UPSTASH_REDIS_REST_URL: "https://redis.playlore.xyz",
      UPSTASH_REDIS_REST_TOKEN: "server-only-token",
    },
    async () => {
      assert.equal(
        externalRateLimit.hasPublicExternalRateLimitStore(),
        true,
        "runtime health must report a public HTTPS external rate-limit endpoint as configured",
      );
    },
  );
  const providersSource = readFileSync("app/providers.tsx", "utf8");
  assert.match(
    providersSource,
    /coinbaseWallet[\s\S]*preference[\s\S]*options:\s*['"]eoaOnly['"]/,
    "Privy Coinbase connector must avoid unsupported smart-wallet mode on Linea networks",
  );
  const walletSettingsModalSource = readFileSync("app/components/WalletSettingsModal.tsx", "utf8");
  assert.match(
    walletSettingsModalSource,
    /aria-label="Export support logs"[\s\S]*className="text-xs"[\s\S]*hidden sm:inline">Export Logs/,
    "mobile Wallet Settings must keep support-log export available as an accessible icon button",
  );
  assert.match(
    walletSettingsModalSource,
    /useDialogFocusTrap<HTMLDivElement>\(isOpen, onClose\)/,
    "Wallet Settings must use the shared focus trap with hidden-control and escaped-focus recovery",
  );
  assert.match(
    walletSettingsModalSource,
    /role="dialog"[\s\S]*aria-modal="true"[\s\S]*aria-labelledby="wallet-settings-title"[\s\S]*aria-describedby="wallet-settings-description"[\s\S]*tabIndex=\{-1\}/,
    "Wallet Settings dialog root must remain programmatically focusable for focus-trap fallback",
  );
  const backupGateSource = readFileSync("app/components/BackupGate.tsx", "utf8");
  assert.match(
    backupGateSource,
    /role="dialog"[\s\S]*aria-modal="true"[\s\S]*aria-labelledby="backup-gate-title"[\s\S]*aria-describedby="backup-gate-description"[\s\S]*tabIndex=\{-1\}/,
    "backup gate dialog root must remain labeled, described, modal, and programmatically focusable",
  );
  assert.match(
    backupGateSource,
    /aria-describedby="backup-gate-description"[\s\S]*id="backup-gate-description"/,
    "backup gate dialog must expose its recovery-risk description to assistive technology",
  );
  assert.match(
    backupGateSource,
    /normalizeBackupAddress[\s\S]*getAddress/,
    "backup gate confirmation must normalize wallet addresses with the EVM address parser",
  );
  assert.match(
    backupGateSource,
    /const raw = window\.localStorage\.getItem\(STORAGE_KEY\)[\s\S]*normalizeBackupAddress\(raw\)[\s\S]*window\.localStorage\.removeItem\(STORAGE_KEY\)/,
    "backup gate confirmation must clear invalid stored wallet addresses before re-checking backup state",
  );
  assert.match(
    backupGateSource,
    /onClick=\{handleExport\}[\s\S]*uiTokens\.focusRing[\s\S]*Export private key[\s\S]*onClick=\{handleContinue\}[\s\S]*uiTokens\.focusRing[\s\S]*I&apos;ve saved it, continue/,
    "backup gate primary actions must keep visible keyboard focus rings",
  );
  assert.match(
    readFileSync("app/components/MobileTabNav.tsx", "utf8"),
    /MOBILE_TABS\.map[\s\S]*<button[\s\S]{0,160}type="button"[\s\S]*aria-current=\{active \? "page" : undefined\}/,
    "mobile tab navigation buttons must remain non-submit controls with current-page semantics",
  );
  const maintenanceOverlaySource = readFileSync("app/components/MaintenanceOverlay.tsx", "utf8");
  assert.match(
    maintenanceOverlaySource,
    /role="status"[\s\S]*aria-live="polite"[\s\S]*aria-busy="true"[\s\S]*aria-labelledby="maintenance-title"[\s\S]*aria-describedby="maintenance-description"[\s\S]*id="maintenance-title"[\s\S]*id="maintenance-description"/,
    "maintenance overlay must announce busy status with stable title and description wiring",
  );
  assert.match(
    maintenanceOverlaySource,
    /aria-hidden="true"[\s\S]*orb-drift-1[\s\S]*aria-hidden="true"[\s\S]*opacity-\[0\.03\][\s\S]*aria-hidden="true"[\s\S]*animate-gradient-x/,
    "maintenance overlay decorative animation layers must stay hidden from assistive technology",
  );
  const pageTabPanelsSource = readFileSync("app/components/PageTabPanels.tsx", "utf8");
  assert.match(
    pageTabPanelsSource,
    /const TabPanelFallback[\s\S]*role="status"[\s\S]*aria-live="polite"[\s\S]*aria-busy="true"[\s\S]*Loading panel/,
    "lazy tab panel fallback must announce loading state without changing tab behavior",
  );
  assert.doesNotMatch(
    backupGateSource,
    /Opening\u2026/,
    "backup gate pending text must stay ASCII-safe for terminal and log rendering",
  );
  const miningManualActionsSource = readFileSync("app/hooks/useMiningManualActions.ts", "utf8");
  assert.match(
    miningManualActionsSource,
    /setIsPending\(true\)/,
    "manual bet must expose its pending state while the Privy transaction is sent",
  );
  assert.match(
    miningManualActionsSource,
    /const manualMineInFlightRef = useRef\(false\)[\s\S]*const handleManualMine[\s\S]*if \(autoMineActive\(\) \|\| manualMineInFlightRef\.current\) return false;[\s\S]*manualMineInFlightRef\.current = true;[\s\S]*finally \{\s*manualMineInFlightRef\.current = false;[\s\S]*const handleDirectMine[\s\S]*if \(autoMineActive\(\) \|\| manualMineInFlightRef\.current\) return false;[\s\S]*manualMineInFlightRef\.current = true;[\s\S]*finally \{\s*manualMineInFlightRef\.current = false;/,
    "manual and repeat bets must share an in-flight guard so rapid clicks cannot create duplicate sends",
  );
  assert.match(
    miningManualActionsSource,
    /submitMineAttempt\("ManualMine"[\s\S]*state === "pending"[\s\S]*Bet transaction is still pending\. Check wallet activity before retrying\.[\s\S]*submitMineAttempt\("DirectMine"[\s\S]*state === "pending"[\s\S]*Repeat bet transaction is still pending\. Check wallet activity before retrying\./,
    "manual and repeat ambiguous pending bets must surface a user-facing warning instead of only clearing the pending spinner",
  );
  assert.match(
    miningManualActionsSource,
    /catch \(error\) \{\s*if \(!isUserRejection\(error\)\) \{\s*clearMiningTxPathState\(\);[\s\S]*notify\?\.\(reason, "danger"\);\s*\} else \{\s*notify\?\.\("Bet transaction rejected in wallet\.", "info"\);/,
    "manual wallet rejection must keep pending tx recovery state and use explicit info copy",
  );
  assert.match(
    miningManualActionsSource,
    /catch \(error\) \{\s*if \(!isUserRejection\(error\)\) \{\s*clearMiningTxPathState\(\);[\s\S]*notify\?\.\(reason, "danger"\);\s*\} else \{\s*notify\?\.\("Repeat bet transaction rejected in wallet\.", "info"\);/,
    "repeat bet wallet rejection must keep pending tx recovery state and use explicit info copy",
  );
  assert.doesNotMatch(
    miningManualActionsSource,
    /Preparing (?:repeat )?bet(?: transaction)?/,
    "manual and repeat bets must not show a redundant preparation toast",
  );
  const autoResolveSource = readFileSync("app/hooks/useAutoResolve.ts", "utf8");
  assert.match(
    autoResolveSource,
    /function getBootstrapRetryDelayMs/,
    "auto-resolve must centralize bootstrap retryAfter clamping",
  );
  assert.equal(autoResolve.getBootstrapRetryDelayMs(undefined), 30_000);
  assert.equal(autoResolve.getBootstrapRetryDelayMs(-1), 30_000);
  assert.equal(autoResolve.getBootstrapRetryDelayMs("5"), 30_000);
  assert.equal(autoResolve.getBootstrapRetryDelayMs("90"), 90_000);
  assert.equal(autoResolve.getBootstrapRetryDelayMs(10_000), 300_000);
  assert.equal(autoResolve.getBootstrapRetryDelayMs("1e2"), 30_000);
  assert.equal(autoResolve.getBootstrapRetryDelayMs("90.5"), 30_000);
  assert.equal(autoResolve.getBootstrapRetryDelayMs("00090"), 30_000);
  assert.equal(autoResolve.getBootstrapRetryDelayMs(Number.MAX_SAFE_INTEGER + 1), 30_000);
  assert.equal(await autoResolve.readEpochHasPool(undefined, "42"), false);
  {
    let readContractCalls = 0;
    const zeroPoolClient = {
      readContract: async (request) => {
        readContractCalls += 1;
        assert.equal(request.functionName, "epochs");
        assert.deepEqual(request.args, [42n]);
        return [0n, 0n, 0n, false, false, false];
      },
    };
    assert.equal(await autoResolve.readEpochHasPool(zeroPoolClient, "42"), false);
    assert.equal(readContractCalls, 1, "auto-resolve precheck must read the epoch exactly once");
  }
  {
    const fundedPoolClient = {
      readContract: async () => [1n, 0n, 0n, false, false, false],
    };
    assert.equal(await autoResolve.readEpochHasPool(fundedPoolClient, "43"), true);
  }
  {
    const failingClient = {
      readContract: async () => {
        throw new Error("rpc unavailable");
      },
    };
    assert.equal(await autoResolve.readEpochHasPool(failingClient, "44"), false);
  }
  assert.match(
    autoResolveSource,
    /function parseRetryAfterSeconds[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*\/\^\(\?:0\|\[1-9\]\\d\{0,5\}\)\$\/[\s\S]*Number\.parseInt\(trimmed, 10\)[\s\S]*const retryAfterSeconds = parseRetryAfterSeconds\(retryAfter\)/,
    "auto-resolve retryAfter must use canonical bounded seconds parsing before backoff clamping",
  );
  assert.match(
    autoResolveSource,
    /readJsonResponse<BootstrapResolvePayload>/,
    "auto-resolve bootstrap response parsing must use the bounded JSON response helper",
  );
  assert.match(
    autoResolveSource,
    /export async function readEpochHasPool\(publicClient: PublicClient \| undefined, epochKey: string\)[\s\S]*if \(!publicClient\) return false[\s\S]*publicClient\.readContract\(\{[\s\S]*functionName:\s*"epochs"[\s\S]*return epochData\[0\] > 0n[\s\S]*catch \{[\s\S]*return false[\s\S]*fetch\("\/api\/bootstrap-resolve"/,
    "browser auto-resolve must fail closed unless a read-only epoch precheck proves a funded pool before the server keeper API trigger",
  );
  assert.match(
    autoResolveSource,
    /payload\?\.ok && payload\.action === "pending"[\s\S]*server keeper resolve tx pending[\s\S]*markRetryScheduled\(epochKey\)[\s\S]*getBootstrapRetryDelayMs\(payload\.retryAfter\)[\s\S]*continue;/,
    "browser auto-resolve must treat keeper receipt timeouts as pending states with guarded retry/backoff",
  );
  assert.doesNotMatch(
    autoResolveSource,
    /\b(?:useWriteContract|writeContractAsync|sendTransactionSilent|sendTransactionFromExternal|walletClient|eth_sendTransaction|sendTransaction\s*\(|writeContract\s*\(|simulateContract|encodeFunctionData)\b|\bbody\s*:/,
    "browser auto-resolve must not import or call wallet/write/send primitives or attach a mutation payload",
  );
  assert.doesNotMatch(
    autoResolveSource,
    /res\.json\(\)|response\.json\(\)/,
    "auto-resolve bootstrap response parsing must not use unbounded response.json",
  );
  assert.doesNotMatch(
    autoResolveSource,
    /Number\(payload\??\.retryAfter \?\? 0\)\s*\*\s*1000|Number\(retryAfter\)/,
    "auto-resolve must not trust raw retryAfter values from bootstrap responses",
  );
  assert.doesNotMatch(
    autoResolveSource,
    /sendTransactionSilent|encodeFunctionData|functionName:\s*"resolveEpoch"|ENABLE_AUTO_RESOLVE_SWEEP/,
    "browser auto-resolve must not keep dormant client wallet resolve transaction paths",
  );
  const allowedClientResolveReferences = new Set([
    join("app", "components", "WhitePaper.tsx"),
    join("app", "hooks", "useAutoResolve.ts"),
    join("app", "lib", "constants.ts"),
  ]);
  const unexpectedClientResolveReferences = listSourceFiles("app")
    .filter((filePath) => !filePath.startsWith(join("app", "api")))
    .filter((filePath) => !allowedClientResolveReferences.has(filePath))
    .filter((filePath) => readFileSync(filePath, "utf8").includes("resolveEpoch"));
  assert.deepEqual(
    unexpectedClientResolveReferences,
    [],
    "client source must not retain dormant resolveEpoch wallet/sweep references outside ABI, docs, or the fetch-only bootstrap hook",
  );
  assert.doesNotMatch(
    publicConfigSource,
    /NEXT_PUBLIC_ENABLE_CLIENT_AUTO_RESOLVE|NEXT_PUBLIC_ENABLE_AUTO_RESOLVE_SWEEP|getConfiguredAutoResolveSweepEnabled|DEFAULT_AUTO_RESOLVE_SWEEP_ENABLED/,
    "public config must not expose a browser auto-resolve sweep flag",
  );
  assert.match(
    publicConfigSource,
    /function getConfiguredClientAutoResolveEnabled\(explicitFlag\?: string \| null\)[\s\S]*void explicitFlag;[\s\S]*return DEFAULT_CLIENT_AUTO_RESOLVE_ENABLED;/,
    "client bootstrap resolve config must ignore public opt-in flags and remain isolated from browser runtime",
  );
  const bootstrapResolveRouteSource = readFileSync("app/api/bootstrap-resolve/route.ts", "utf8");
  assert.match(
    bootstrapResolveRouteSource,
    /function json\([\s\S]*applyNoStoreHeaders\(NextResponse\.json/,
    "bootstrap resolver JSON responses must share the no-store response boundary",
  );
  assert.match(
    bootstrapResolveRouteSource,
    /logRouteError\("api\/bootstrap-resolve", new Error\("bootstrap keeper key is configured but invalid"\),[\s\S]*phase: "keeper-config"/,
    "bootstrap resolver keeper-config failures must use the shared redacted route logger",
  );
  assert.doesNotMatch(
    bootstrapResolveRouteSource,
    /console\.error\(/,
    "bootstrap resolver must not bypass the shared redacted route logger",
  );
  assert.match(
    bootstrapResolveRouteSource,
    /if \(rateLimited\) return applyNoStoreHeaders\(rateLimited\)/,
    "bootstrap resolver rate-limit responses must also be no-store",
  );
  assert.match(
    bootstrapResolveRouteSource,
    /waitForTransactionReceipt/,
    "bootstrap resolver must inspect resolve tx receipts instead of treating every submitted tx as successful",
  );
  assert.match(
    bootstrapResolveRouteSource,
    /function pendingResolveResponse\([\s\S]*action: "pending"[\s\S]*reason: "resolve_receipt_timeout"[\s\S]*retryAfter: Math\.max\(1, Math\.ceil\(RESOLVE_THROTTLE_MS \/ 1000\)\)[\s\S]*if \(!confirmation\.receipt\) return pendingResolveResponse\(/,
    "bootstrap resolver must classify submitted-but-unconfirmed resolve txs as pending with bounded retry guidance",
  );
  assert.match(
    bootstrapResolveRouteSource,
    /resolve_tx_reverted/,
    "bootstrap resolver must surface reverted resolve txs as retryable noop responses",
  );
  assert.match(
    bootstrapResolveRouteSource,
    /if \(pendingNonce > latestNonce\) \{[\s\S]*reason: "bootstrap_pending_nonce_unbound"[\s\S]*return json\(/,
    "bootstrap resolver must defer an unbound pending nonce instead of replacing or cancelling it",
  );
  assert.doesNotMatch(
    bootstrapResolveRouteSource,
    /sendTransaction\(/,
    "bootstrap resolver must not send a self-transfer cancellation without a durable pending transaction binding",
  );
  assert.doesNotMatch(
    bootstrapResolveRouteSource,
    /error:\s*(?:message|`)/,
    "bootstrap resolver responses must not expose raw provider or keeper-balance errors",
  );
  const bootstrapEmptyEpochGuardIndex = bootstrapResolveRouteSource.indexOf("if (totalPool === 0n)");
  const bootstrapGasEstimateIndex = bootstrapResolveRouteSource.indexOf("estimateContractGas");
  const bootstrapResolveSignIndex = bootstrapResolveRouteSource.indexOf(
    "account.signTransaction",
    bootstrapEmptyEpochGuardIndex,
  );
  assert.ok(
    bootstrapEmptyEpochGuardIndex > -1 &&
      bootstrapGasEstimateIndex > -1 &&
      bootstrapResolveSignIndex > -1 &&
      bootstrapEmptyEpochGuardIndex < bootstrapGasEstimateIndex &&
      bootstrapEmptyEpochGuardIndex < bootstrapResolveSignIndex,
    "bootstrap resolver must skip empty epochs before gas estimation or keeper writes",
  );
  assert.match(
    bootstrapResolveRouteSource,
    /reason:\s*"epoch_empty"/,
    "bootstrap resolver empty-epoch noop responses must preserve a machine-readable reason",
  );
  const bootstrapResolveSharedSource = readFileSync("app/api/bootstrap-resolve/shared.ts", "utf8");
  assert.match(
    bootstrapResolveSharedSource,
    /const production = process\.env\.NODE_ENV === "production";[\s\S]*if \(production\) return false;[\s\S]*lastResolveAttemptAt/,
    "bootstrap resolver must fail closed before the development-only memory throttle when the shared lock is unavailable",
  );
  assert.match(
    bootstrapResolveSharedSource,
    /requiresExternalSharedLock\(\)[\s\S]*acquireExternalExpiringLock[\s\S]*fallback: "deny"/,
    "multiple production web replicas must share the bootstrap resolver lock and stop safely if that store is unavailable",
  );
  assert.match(
    bootstrapResolveSharedSource,
    /function isLocalDevBootstrapRequest\(_request: Request\)[\s\S]*return false;[\s\S]*if \(!secret\) \{[\s\S]*if \(!isBootstrapKeeperKeyConfigured\(\)\) return true;[\s\S]*return false;/,
    "bootstrap resolver must not trust request hostnames to bypass its secret when a keeper key is configured",
  );
  assert.match(
    bootstrapResolveSharedSource,
    /MIN_BOOTSTRAP_RESOLVE_SECRET_LENGTH\s*=\s*32[\s\S]*MAX_BOOTSTRAP_RESOLVE_SECRET_LENGTH\s*=\s*256[\s\S]*CONTROL_CHAR_RE[\s\S]*function normalizeBootstrapResolveSecret\(value: string \| null \| undefined\)[\s\S]*secret\.length < MIN_BOOTSTRAP_RESOLVE_SECRET_LENGTH[\s\S]*secret\.length > MAX_BOOTSTRAP_RESOLVE_SECRET_LENGTH[\s\S]*CONTROL_CHAR_RE\.test\(secret\)[\s\S]*const secret = normalizeBootstrapResolveSecret\(process\.env\.BOOTSTRAP_RESOLVE_SECRET\)[\s\S]*const provided = normalizeBootstrapResolveSecret\(request\.headers\.get\("x-bootstrap-resolve-secret"\)\)[\s\S]*if \(!provided\) return false[\s\S]*Buffer\.from\(secret, "utf8"\)/,
    "bootstrap resolver secret auth must normalize both env and header before Buffer allocation or timing-safe comparison",
  );
  assert.doesNotMatch(
    bootstrapResolveSharedSource,
    /request\.headers\.get\("x-bootstrap-resolve-secret"\)\?\.trim\(\)[\s\S]*Buffer\.from\(provided/,
    "bootstrap resolver must not allocate unbounded provided secrets directly",
  );
  assert.doesNotMatch(
    bootstrapResolveSharedSource,
    /BOOTSTRAP_RESOLVE_ALLOW_LOCAL_DEV_WITHOUT_SECRET/,
    "bootstrap resolver must not retain a hostname-based unauthenticated development bypass",
  );
  const ciWorkflowSource = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(
    ciWorkflowSource,
    /permissions:\s*\n\s+contents: read[\s\S]*actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683[\s\S]*persist-credentials: false[\s\S]*actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020[\s\S]*actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/,
    "CI must use least-privilege read access, avoid persisted checkout credentials, and pin third-party actions to reviewed commits",
  );
  assert.doesNotMatch(
    ciWorkflowSource,
    /\bpull_request_target\b/,
    "CI must not run untrusted pull-request code in pull_request_target context",
  );
  assert.doesNotMatch(
    ciWorkflowSource,
    /\b(?:actions|checks|contents|deployments|id-token|issues|packages|pull-requests|security-events|statuses):\s*write\b/,
    "CI must not grant write-scoped GITHUB_TOKEN permissions",
  );
  const ciUsesLines = ciWorkflowSource.match(/^\s*uses:\s+\S+/gm) ?? [];
  assert.ok(ciUsesLines.length > 0, "CI must keep third-party action steps explicit");
  for (const usesLine of ciUsesLines) {
    assert.match(
      usesLine,
      /@[0-9a-f]{40}(?:\s|$)/,
      `CI action must be pinned to an immutable reviewed commit: ${usesLine.trim()}`,
    );
  }
  const ciPackageScripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
  assert.equal(
    ciPackageScripts["proof:ci-security:summary"],
    "node scripts/check-ci-security.mjs --summary-only",
    "CI security proof must expose a compact summary command",
  );
  assert.equal(
    ciPackageScripts["proof:security-followup"],
    "node scripts/check-security-followup.mjs",
    "security follow-up proof must expose a full diagnostic command",
  );
  assert.equal(
    ciPackageScripts["proof:security-followup:summary"],
    "node scripts/check-security-followup.mjs --summary-only",
    "security follow-up proof must expose a compact summary command",
  );
  const ciSecurityProofSource = readFileSync("scripts/check-ci-security.mjs", "utf8");
  for (const requiredCiSecurityProof of [
    /permissionsReadOnly/,
    /pullRequestTarget/,
    /usesPinned/,
    /checkoutPersistCredentialsFalse/,
    /persist-credentials:\\s\*false/,
  ]) {
    assert.match(
      ciSecurityProofSource,
      requiredCiSecurityProof,
      "CI security proof must summarize least privilege, pull_request_target exclusion, SHA pins, and checkout credential persistence",
    );
  }
  assert.match(
    ciSecurityProofSource,
    /MAX_CI_WORKFLOW_BYTES = 256 \* 1024[\s\S]*function readWorkflow\(\)[\s\S]*const stats = statSync\(workflowPath\)[\s\S]*!stats\.isFile\(\)[\s\S]*stats\.size > MAX_CI_WORKFLOW_BYTES[\s\S]*too large to validate safely[\s\S]*readFileSync\(workflowPath, "utf8"\)/,
    "CI security proof must size-gate the workflow before reading it",
  );
  assert.ok(
    ciSecurityProofSource.includes("@[0-9a-f]{40}") &&
      ciSecurityProofSource.includes("write-scoped GITHUB_TOKEN permissions") &&
      ciSecurityProofSource.includes("pull_request_target"),
    "CI security proof must reject unpinned actions, write permissions, and pull_request_target",
  );
  const securityFollowupProofSource = readFileSync("scripts/check-security-followup.mjs", "utf8");
  assert.match(
    securityFollowupProofSource,
    /MAX_SECURITY_FOLLOWUP_SOURCE_BYTES = 1024 \* 1024[\s\S]*function readSource\(relativePath\)[\s\S]*const stats = statSync\(absolutePath\)[\s\S]*!stats\.isFile\(\)[\s\S]*stats\.size > MAX_SECURITY_FOLLOWUP_SOURCE_BYTES[\s\S]*too large to validate safely[\s\S]*readFileSync\(absolutePath, "utf8"\)/,
    "security follow-up proof must size-gate source files before reading them",
  );
  for (const checkId of [
    "host-auth",
    "web-locks",
    "keeper-nonce",
    "deposit-limiter",
    "dry-run-defaults",
    "ci-security",
    "auto-resolve",
  ]) {
    assert.ok(
      securityFollowupProofSource.includes(`check("${checkId}"`),
      `security follow-up proof must retain the ${checkId} residual check`,
    );
  }
  assert.match(
    securityFollowupProofSource,
    /const allowedResolveEpochReferences = new Set\(\[[\s\S]*"app\/lib\/constants\.ts"[\s\S]*"app\/api\/bootstrap-resolve\/route\.ts"[\s\S]*"app\/api\/bootstrap-resolve\/shared\.ts"[\s\S]*"app\/components\/WhitePaper\.tsx"[\s\S]*appResolveEpochFiles = listFiles\("app"\)[\s\S]*readSource\(file\)\.includes\("resolveEpoch"\)[\s\S]*!allowedResolveEpochReferences\.has\(file\)/,
    "security follow-up proof must allow only ABI/server/bootstrap documentation resolveEpoch references while rejecting dormant client wallet sweep references",
  );
  assert.ok(
    securityFollowupProofSource.includes("readEpochHasPool") &&
      securityFollowupProofSource.includes('hostAuth: passed("host-auth")') &&
      securityFollowupProofSource.includes('webLocks: passed("web-locks")') &&
      securityFollowupProofSource.includes('keeperNonce: passed("keeper-nonce")') &&
      securityFollowupProofSource.includes('keeperBotReceipts: passed("keeper-bot-receipts")') &&
      securityFollowupProofSource.includes('depositLimiter: passed("deposit-limiter")') &&
      securityFollowupProofSource.includes('dryRunDefaults: passed("dry-run-defaults")') &&
      securityFollowupProofSource.includes('ciSecurity: passed("ci-security")') &&
      securityFollowupProofSource.includes('autoResolve: passed("auto-resolve")') &&
      securityFollowupProofSource.includes("if \\(!publicClient\\) return false") &&
      securityFollowupProofSource.includes("publicClient\\.readContract") &&
      securityFollowupProofSource.includes('functionName:\\s*"epochs"') &&
      securityFollowupProofSource.includes("return false[\\s\\S]*fetch") &&
      securityFollowupProofSource.includes('fetch\\("\\/api\\/bootstrap-resolve"') &&
      securityFollowupProofSource.includes("sendTransactionSilent|createWalletClient|writeContract|encodeFunctionData") &&
      securityFollowupProofSource.includes('functionName:\\s*"resolveEpoch"|ENABLE_AUTO_RESOLVE_SWEEP') &&
      securityFollowupProofSource.includes("appResolveEpochFiles.length === 0") &&
      securityFollowupProofSource.includes("appResolveEpochFiles: appResolveEpochFiles.length"),
    "security follow-up proof must keep browser auto-resolve fetch-only, wallet-send-free, and compactly visible",
  );
  const smokeBrowserSource = readFileSync("scripts/smoke-browser.mjs", "utf8");
  const smokeBrowserCoreSource = readFileSync("scripts/smoke-browser-lib/core.mjs", "utf8");
  const smokeBrowserFlowsSource = readFileSync("scripts/smoke-browser-lib/flows.mjs", "utf8");
  const packageScripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
  assert.equal(
    packageScripts["dev:ui"],
    "next dev --webpack",
    "browser-only development must keep a direct UI-only command",
  );
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
  assert.doesNotMatch(
    smokeBrowserSource,
    /configured chains are not supported/,
    "browser smoke must not ignore Privy/Coinbase unsupported-chain regressions",
  );
  assert.doesNotMatch(
    smokeBrowserSource,
    /"Invalid or unexpected token"/,
    "browser smoke must not ignore generic JavaScript syntax errors",
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
    /data-testid="header-pool-chart-visual"[\s\S]*data-empty-pool[\s\S]*Pool chart empty state/,
    "browser smoke must assert the visible empty-pool chart container, not only its SVG path",
  );
  assert.match(
    smokeBrowserSource,
    /MAX_BROWSER_SMOKE_JSON_BYTES[\s\S]*DECIMAL_INTEGER_RE\s*=\s*\/\^\(\?:0\|\[1-9\]\\d\{0,15\}\)\$\/[\s\S]*CONTENT_LENGTH_RE\s*=\s*DECIMAL_INTEGER_RE[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseContentLengthHeader[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*async function readBoundedJsonResponse[\s\S]*parseContentLengthHeader\(response\.headers\.get\("content-length"\)\)[\s\S]*new TextDecoder\("utf-8", \{ fatal: true \}\)/,
    "browser smoke live-state probes must strictly parse Content-Length and bound JSON response bodies",
  );
  assert.match(
    smokeBrowserSource,
    /SMOKE_CHAIN_ID = parseSmokeChainId\(process\.env\.NEXT_PUBLIC_LINEA_CHAIN_ID\)[\s\S]*function parseSmokeChainId\(value\)[\s\S]*NEXT_PUBLIC_LINEA_CHAIN_ID must be a canonical decimal integer[\s\S]*Number\.isSafeInteger\(parsed\)[\s\S]*chainId: SMOKE_CHAIN_ID/,
    "browser smoke chain id must be canonical decimal and range checked before storage keys or smoke options use it",
  );
  assert.doesNotMatch(
    smokeBrowserSource,
    /Number\(process\.env\.NEXT_PUBLIC_LINEA_CHAIN_ID/,
    "browser smoke chain id must not use broad Number(env) coercion",
  );
  assert.doesNotMatch(
    smokeBrowserSource,
    /Number\(response\.headers\.get\("content-length"\)\)/,
    "browser smoke live-state probes must not broadly coerce response Content-Length",
  );
  assert.match(
    smokeBrowserSource,
    /import \{ redactProofText \} from "\.\/redact-proof-output\.mjs"/,
    "browser smoke diagnostics must use the shared proof redactor",
  );
  assert.match(
    smokeBrowserSource,
    /MAX_BROWSER_SMOKE_DIAGNOSTIC_CHARS[\s\S]*function compactBrowserDiagnostic[\s\S]*redactProofText\(value\)[\s\S]*<truncated>/,
    "browser smoke diagnostics must redact and clamp console message text",
  );
  assert.match(
    smokeBrowserSource,
    /const diagnostic = compactBrowserDiagnostic\(text\)[\s\S]*consoleRegressions\.push\(diagnostic\)[\s\S]*consoleErrors\.push\(diagnostic\)/,
    "browser smoke desktop console diagnostics must store bounded sanitized messages",
  );
  assert.match(
    smokeBrowserSource,
    /scopedBrowserDiagnostic\("mobile-wallet", text\)[\s\S]*scopedBrowserDiagnostic\("mobile", text\)/,
    "browser smoke mobile console diagnostics must store bounded sanitized scoped messages",
  );
  assert.match(
    smokeBrowserSource,
    /function compactPageError\(error, source\)[\s\S]*message: compactBrowserDiagnostic\(error\?\.message \|\| error\)[\s\S]*stack: compactBrowserDiagnostic\(error\?\.stack \|\| ""\)[\s\S]*source/,
    "browser smoke page errors must be redacted and clamped before storage",
  );
  assert.doesNotMatch(
    smokeBrowserSource,
    /pageErrors\.push\(\{\s*message:\s*(?:`\[[^`]+`\s*)?error\.message/,
    "browser smoke must not store raw page error messages",
  );
  assert.match(
    smokeBrowserSource,
    /main\(\)\.catch\(\(error\) => \{[\s\S]*console\.error\(compactBrowserDiagnostic\(error instanceof Error \? error\.message : error\)\)/,
    "browser smoke final failure output must be compact and redacted",
  );
  assert.match(
    smokeBrowserSource,
    /LIVE_STATE_PROBE_TIMEOUT_MS[\s\S]*currentStateResponse = await fetch[\s\S]*AbortSignal\.timeout\(LIVE_STATE_PROBE_TIMEOUT_MS\)/,
    "browser smoke live-state probes must use a bounded request timeout",
  );
  assert.doesNotMatch(
    smokeBrowserSource,
    /currentStateResponse\.json\(\)|response\.json\(\)/,
    "browser smoke live-state probes must not use unbounded response.json",
  );
  assert.match(
    smokeBrowserSource,
    /Transparent Play[\s\S]*Winning outcomes are probabilistic and are not guaranteed/,
    "browser smoke must verify the player-facing risk disclosure in the White Paper",
  );
  assert.match(
    smokeBrowserSource,
    /verify keyboard focus indicator[\s\S]*keyboard\.press\("Tab"\)[\s\S]*:focus-visible/,
    "browser smoke must verify a visible focus indicator through keyboard navigation",
  );
  assert.match(
    smokeBrowserSource,
    /verify mobile touch targets[\s\S]*verifyVisibleTouchTargets\(mobilePage, "mobile hub"\)[\s\S]*verify mobile safety pool touch targets[\s\S]*verify mobile leaderboards touch targets/,
    "browser smoke must run touch-target checks across the mobile hub and secondary tabs",
  );
  assert.match(
    smokeBrowserSource,
    /verify first-visit tutorial accessibility[\s\S]*First visit tutorial[\s\S]*verifyVisibleTouchTargets\(tutorialPage, "first-visit tutorial"\)[\s\S]*keyboard\.press\("Escape"\)/,
    "browser smoke must cover first-visit tutorial touch targets and keyboard dismissal",
  );
  assert.match(
    smokeBrowserFlowsSource,
    /verifyVisibleTouchTargets[\s\S]*target\.width < 44 \|\| target\.height < 44/,
    "shared browser smoke touch-target guard must reject controls below 44px",
  );
  const noticeStackSource = readFileSync("app/components/NoticeStack.tsx", "utf8");
  assert.match(
    noticeStackSource,
    /role=\{notice\.tone === "danger" \? "alert" : "status"\}[\s\S]*aria-live=\{notice\.tone === "danger" \? "assertive" : "polite"\}[\s\S]*aria-atomic="true"/,
    "danger notices must announce assertively while non-danger notices remain polite",
  );
  assert.match(
    noticeStackSource,
    /aria-label="Dismiss notice"[\s\S]*h-11 w-11|h-11 w-11[\s\S]*aria-label="Dismiss notice"/,
    "notice dismiss control must preserve a 44px touch target",
  );
  assert.doesNotMatch(
    noticeStackSource,
    /<div role="status" aria-live="polite" aria-label="Notifications"/,
    "notification container must not re-announce the full stack for each new notice",
  );
  assert.match(
    smokeBrowserSource,
    /verify system reduced-motion preference[\s\S]*emulateMedia\(\{ reducedMotion: "reduce" \}\)/,
    "browser smoke must verify the operating-system reduced-motion preference",
  );
  assert.match(
    smokeBrowserSource,
    /verifyNativeWebLocksAcrossTabs[\s\S]*navigator\.locks\.request\(name, \{ ifAvailable: true, mode: "exclusive" \}[\s\S]*second tab acquired[\s\S]*contenderAcquiredAfterRelease[\s\S]*verify native Web Locks across two tabs/,
    "browser smoke must verify that native Auto-Miner-style Web Locks exclude a second tab and release cleanly",
  );
  assert.match(
    smokeBrowserSource,
    /const bootstrapResolveRequests = \[\][\s\S]*request\.method\(\) === "POST" && requestUrl\.pathname === "\/api\/bootstrap-resolve"[\s\S]*browser boot made an unattended bootstrap-resolve request/,
    "browser smoke must reject an unattended client bootstrap-resolve request during normal boot",
  );
  const browserBaselineSource = readFileSync("scripts/measure-browser-baseline.mjs", "utf8");
  assert.equal(
    monitoringPackageScripts["baseline:browser:summary"],
    "node scripts/measure-browser-baseline.mjs --summary-only",
    "browser baseline must expose a compact summary command for routine performance checks",
  );
  assert.match(
    browserBaselineSource,
    /import \{ redactProofText \} from "\.\/redact-proof-output\.mjs"/,
    "production browser baseline must use the shared proof redactor for diagnostic samples",
  );
  assert.match(
    browserBaselineSource,
    /MAX_BASELINE_DIAGNOSTIC_CHARS[\s\S]*function sanitizeDiagnostic\(value\)[\s\S]*redactProofText\(value\)[\s\S]*<truncated>/,
    "production browser baseline must clamp sanitized console diagnostic samples",
  );
  assert.match(
    browserBaselineSource,
    /const SUMMARY_ONLY = process\.argv\.includes\("--summary-only"\)/,
    "production browser baseline must support compact summary mode",
  );
  assert.match(
    browserBaselineSource,
    /DECIMAL_INTEGER_RE[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*parsePositiveIntegerEnv\("BASELINE_OBSERVE_MS", 10_000, 1_000, 900_000\)[\s\S]*parsePositiveIntegerEnv\("BASELINE_SAMPLE_MS", 30_000, 1_000, 60_000\)[\s\S]*function parsePositiveIntegerEnv\(name, fallback, min, max\)[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*const numeric = Number\(parsed\)[\s\S]*Number\.isSafeInteger\(numeric\)/,
    "production browser baseline timing env must be canonical decimal and range checked",
  );
  assert.doesNotMatch(
    browserBaselineSource,
    /Number\.parseInt\(process\.env\.BASELINE_(?:OBSERVE|SAMPLE)_MS|const parsed = Number\(value\)/,
    "production browser baseline timing env must not use partial parseInt coercion",
  );
  assert.match(
    browserBaselineSource,
    /const summaryReport = \{[\s\S]*sampleCount: report\.runtime\.samples\.length[\s\S]*if \(SUMMARY_ONLY\) \{[\s\S]*JSON\.stringify\(summaryReport/,
    "production browser baseline summary mode must print compact metrics instead of the full report",
  );
  assert.match(
    browserBaselineSource,
    /const summaryReport = \{[\s\S]*quality: report\.quality[\s\S]*failedLocalResponseCount: report\.requests\.failedLocalResponseCount[\s\S]*localRequestFailureCount: report\.requests\.localRequestFailureCount[\s\S]*ignoredLocalRscAbortCount: report\.requests\.ignoredLocalRscAbortCount[\s\S]*ignoredLocalWalletCoopAbortCount: report\.requests\.ignoredLocalWalletCoopAbortCount[\s\S]*ignoredLocalChatPollAbortCount: report\.requests\.ignoredLocalChatPollAbortCount[\s\S]*jsHeapPeakDeltaBytes: report\.runtime\.jsHeapPeakDeltaBytes[\s\S]*sampleCount: report\.runtime\.samples\.length[\s\S]*longTaskCount: report\.runtime\.longTaskCount[\s\S]*longTaskTotalMs: report\.runtime\.longTaskTotalMs[\s\S]*longestTaskMs: report\.runtime\.longestTaskMs/,
    "browser baseline must expose compact quality, request, runtime, and long-task performance proof fields",
  );
  assert.match(
    browserBaselineSource,
    /const MAX_API_LATENCY_SAMPLES_PER_PATH = 128[\s\S]*function summarizeLatencySamples\(samples\)[\s\S]*p95Ms[\s\S]*isLocalTarget\(url\) && url\.pathname\.startsWith\("\/api\/"\)[\s\S]*sameOriginApiResponseLatencyByPath/,
    "browser baseline must retain bounded, same-origin API latency aggregates with a p95 statistic",
  );
  assert.match(
    browserBaselineSource,
    /if \(SUMMARY_ONLY\) \{[\s\S]*\} else \{[\s\S]*fs\.writeFile\(OUTPUT_PATH/,
    "production browser baseline summary mode must not write the full performance artifact",
  );
  assert.match(
    browserBaselineSource,
    /interactionId[\s\S]*type: "event"/,
    "production browser baseline must observe Event Timing interactions",
  );
  assert.match(
    browserBaselineSource,
    /soundToggle\.click\(\)[\s\S]*Synthetic sound-toggle interaction/,
    "production browser baseline must measure a safe synthetic interaction instead of leaving INP permanently empty",
  );
  assert.match(
    browserBaselineSource,
    /increment\(consoleErrorTargets, target\)[\s\S]*consoleErrorsByTarget/,
    "production browser baseline must separate local and external console errors",
  );
  assert.match(
    browserBaselineSource,
    /failedLocalResponseCount > 0[\s\S]*localRequestFailureCount > 0[\s\S]*localConsoleErrorCount > 0[\s\S]*status: qualityIssues\.length === 0 \? "pass" : "degraded"/,
    "production browser baseline must mark local HTTP, network, or console failures as degraded",
  );
  assert.match(
    browserBaselineSource,
    /isExpectedLocalRscAbort[\s\S]*!url\.pathname\.startsWith\("\/api\/"\)[\s\S]*request\.headers\(\)\.rsc === "1"[\s\S]*ignoredLocalRscAbortCount/,
    "browser baseline may ignore only explicit non-API Next RSC aborts and must count them",
  );
  assert.match(
    browserBaselineSource,
    /isExpectedLocalWalletCoopAbort[\s\S]*request\.method\(\) === "HEAD"[\s\S]*url\.pathname === baseUrl\.pathname[\s\S]*url\.search === ""[\s\S]*ignoredLocalWalletCoopAbortCount/,
    "browser baseline may ignore only the exact local wallet COOP HEAD abort and must count it",
  );
  assert.match(
    browserBaselineSource,
    /isExpectedLocalChatPollAbort[\s\S]*request\.method\(\) === "GET"[\s\S]*url\.pathname === "\/api\/chat\/messages"[\s\S]*error === "net::ERR_ABORTED"[\s\S]*ignoredLocalChatPollAbortCount/,
    "browser baseline may ignore only the exact local chat poll cleanup abort and must count it",
  );
  const proxySource = readFileSync("proxy.ts", "utf8");
  assert.match(proxySource, /export function proxy\(request: NextRequest\)/, "Next.js 16 security headers must use the root Proxy convention");
  assert.match(
    proxySource,
    /Content-Security-Policy[\s\S]*X-Frame-Options[\s\S]*X-Permitted-Cross-Domain-Policies[\s\S]*Permissions-Policy/,
    "root Proxy must enforce the security header set",
  );
  const layoutSource = readFileSync("app/layout.tsx", "utf8");
  assert.match(layoutSource, /<script nonce=\{nonce\} src="\/early-runtime\.js" suppressHydrationWarning \/>/, "early runtime script nonce must suppress browser-hidden nonce hydration noise");
  const reducedMotionSource = readFileSync("app/hooks/useReducedMotion.ts", "utf8");
  assert.match(
    reducedMotionSource,
    /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/,
    "reduced-motion state must fall back to the operating-system preference",
  );
  assert.match(
    reducedMotionSource,
    /media\.addEventListener\("change", handleChange\)/,
    "reduced-motion state must follow operating-system preference changes until the user overrides it",
  );
  assert.match(
    reducedMotionSource,
    /if \(stored !== null\) localStorage\.removeItem\(STORAGE_KEY\)/,
    "reduced-motion preference restore must clear invalid localStorage values",
  );
  const pageBackdropSource = readFileSync("app/components/PageBackdrop.tsx", "utf8");
  assert.match(
    pageBackdropSource,
    /\{motionReady && !reducedMotion && <CrystalParticles \/>}/,
    "decorative background particle animation must not render until motion preference is known and reduced motion is off",
  );
  assert.match(
    maintenanceOverlaySource,
    /useReducedMotion[\s\S]*const \{ reducedMotion \} = useReducedMotion\(\)[\s\S]*reducedMotion \? "" : "animate-\[orb-drift-1_12s_ease-in-out_infinite\]"[\s\S]*reducedMotion \? "" : "animate-float"[\s\S]*reducedMotion \? "" : "animate-ping"/,
    "maintenance overlay decorative animations must respect reduced-motion preference",
  );
  const whitePaperMotionSource = readFileSync("app/components/WhitePaper.tsx", "utf8");
  assert.match(
    whitePaperMotionSource,
    /useReducedMotion[\s\S]*const \{ reducedMotion, motionReady \} = useReducedMotion\(\)[\s\S]*\{motionReady && !reducedMotion && <FloatingParticles \/>}/,
    "White Paper decorative particles must not render until motion preference is known and reduced motion is off",
  );
  assert.match(
    whitePaperMotionSource,
    /function FloatingParticles[\s\S]*aria-hidden="true"[\s\S]*pointer-events-none/,
    "White Paper decorative particles must stay hidden from assistive technology",
  );
  const globalsSource = readFileSync("app/globals.css", "utf8");
  assert.match(
    globalsSource,
    /html\[data-motion="reduced"\] \*[\s\S]*animation-duration: 0\.001ms !important;[\s\S]*animation-delay: 0ms !important;[\s\S]*transition-duration: 0s !important;[\s\S]*transition-delay: 0s !important;/,
    "global reduced-motion mode must suppress both animations and transitions without per-component class rewrites",
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
  assert.match(
    miningGuardsSource,
    /function parseDecimalNumberToUnits[\s\S]*function isBalanceBelowDecimalThreshold[\s\S]*function isBalanceBelowWholeToken/,
    "mining guards must compare wallet balances with raw bigint unit thresholds",
  );
  assert.match(
    miningGuardsSource,
    /const lowEthBalance = isBalanceBelowDecimalThreshold\(embeddedEthBalance, minEthForGas\);[\s\S]*const lowTokenBalance = isBalanceBelowWholeToken\(embeddedTokenBalance\);/,
    "mining low-balance state must use bigint threshold helpers",
  );
  assert.doesNotMatch(
    miningGuardsSource,
    /Number\(getFormattedBalance\(embedded(?:Eth|Token)Balance\)\)/,
    "mining low-balance state must not coerce formatted balances through Number()",
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
  assert.match(
    hubContentSource,
    /window\.setTimeout\([\s\S]*estimateContractGas[\s\S]*estimateFeesPerGas[\s\S]*\}, 600\)/,
    "hub fee estimate must use a debounced live gas and fee quote instead of a fixed value",
  );
  assert.match(
    hubContentSource,
    /formatBalanceFixed\(\{ value: gas \* feePerGas, decimals: 18 \}, 6\) \?\? "0\.000000"/,
    "hub fee estimate must format bigint wei without unsafe Number(formatEther()).toFixed() conversion",
  );
  assert.match(
    hubContentSource,
    /GRID_SIZE[\s\S]*selectedTilesKey\.split\(",",?\)\.map\(\(tile\) => Number\(tile\)\)\.filter\(\(tile\) => \([\s\S]*Number\.isSafeInteger\(tile\)[\s\S]*tile >= 1[\s\S]*tile <= GRID_SIZE/,
    "hub fee estimate tile mask must reject unsafe or out-of-range selected tile IDs",
  );
  assert.doesNotMatch(
    hubContentSource,
    /Number\.isInteger\(tile\) && tile > 0/,
    "hub fee estimate tile mask must not use positive-only selected tile guards",
  );
  assert.doesNotMatch(
    hubContentSource,
    /Number\(formatEther\(gas \* feePerGas\)\)\.toFixed\(6\)|formatEther/,
    "hub fee estimate must not coerce formatted ETH through Number(formatEther())",
  );
  assert.match(
    hubContentSource,
    /const gasPromise = CONTRACT_REQUIRES_EPOCH_BOUND_BETS[\s\S]*functionName: "placeBatchBetsBitmapForEpoch"[\s\S]*args: \[BigInt\(gridDisplayEpoch!\), selectedTileMaskForEstimate, amount\]/,
    "hub fee estimate must use the same protected epoch-bound selector as V10 bets",
  );
  const gameEpochUiStateSource = readFileSync("app/hooks/useGameEpochUiState.ts", "utf8");
  assert.doesNotMatch(
    gameEpochUiStateSource,
    /react-hooks\/exhaustive-deps/,
    "game epoch UI state must keep hook dependencies explicit",
  );
  assert.match(
    gameEpochUiStateSource,
    /setVisualEpoch\(\(current\) => \(current === seededVisualEpoch \? current : seededVisualEpoch\)\)/,
    "seeded visual epoch sync must use a functional update instead of suppressing hook deps",
  );
  assert.match(
    readFileSync("app/components/HubSidePanel.tsx", "utf8"),
    /Fee \{feeEstimate \?[^\n]*feeEstimateUnavailable \? "unavailable"/,
    "mobile manual bet must show an explicit unavailable fee state",
  );
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
  assert.doesNotMatch(
    jackpotBannerSource,
    /Math\.random/,
    "jackpot banner decorative overlays must stay deterministic to avoid hydration and visual-smoke noise",
  );
  assert.match(
    jackpotBannerSource,
    /function formatJackpotAmountText\(value: unknown\): string \| null[\s\S]*formatDecimalTextFixed\(String\(value \?\? ""\)\.trim\(\), JACKPOT_AMOUNT_FRACTION_DIGITS\)[\s\S]*fixedAmountToScaled\(fixed\) !== 0n/,
    "jackpot banner indexed/API amount display must canonical-parse decimal text before using compatibility numbers",
  );
  assert.match(
    jackpotBannerSource,
    /function formatJackpotAmountWei\(value: bigint \| null \| undefined\): string \| null[\s\S]*formatBalanceFixed\([\s\S]*decimals: 18[\s\S]*JACKPOT_AMOUNT_FRACTION_DIGITS/,
    "jackpot banner on-chain amount fallback must format raw bigint wei without Number(formatUnits()) precision loss",
  );
  assert.match(
    jackpotBannerSource,
    /function formatJackpotDisplayAmount\(text: string \| null\): string \| null[\s\S]*formatDecimalTextFixed\(text, JACKPOT_DISPLAY_FRACTION_DIGITS\)[\s\S]*replace\(\/\\B\(\?=\(\\d\{3\}\)\+\(\?!\\d\)\)\/g, ","\)/,
    "jackpot banner visible/share amount must group decimal text without toLocaleString number coercion",
  );
  assert.doesNotMatch(
    jackpotBannerSource,
    /Number\.parseFloat|formatUnits|toLocaleString/,
    "jackpot banner amount recovery and display must not use parseFloat, formatUnits, or number-locale formatting",
  );
  assert.match(
    jackpotBannerSource,
    /aria-label="Close jackpot banner"[\s\S]*h-12 w-12/,
    "jackpot close action must keep a 48px touch target for mobile users",
  );
  assert.match(
    jackpotBannerSource,
    /aria-describedby=\{descriptionId\}[\s\S]*<p id=\{descriptionId\} className="sr-only">\{jackpotDescription\}<\/p>/,
    "jackpot modal must expose the won amount, epoch, and tile as an accessible description",
  );
  const rootLayoutSource = readFileSync("app/layout.tsx", "utf8");
  const robotsSource = readFileSync("app/robots.ts", "utf8");
  const sitemapSource = readFileSync("app/sitemap.ts", "utf8");
  assert.match(
    rootLayoutSource,
    /NEXT_PUBLIC_SITE_URL\s*\?\?\s*['"]https:\/\/playlore\.xyz['"]/,
    "root metadata must default to the canonical playlore.xyz origin",
  );
  assert.match(
    rootLayoutSource,
    /\.trim\(\)\.replace\(\/\\\/\+\$\/,\s*''\)/,
    "root metadata must trim and remove trailing slashes from the canonical origin",
  );
  assert.match(
    rootLayoutSource,
    /alternates:\s*{\s*canonical:\s*['"]\/['"]/,
    "root metadata must publish a canonical home URL",
  );
  assert.match(
    rootLayoutSource,
    /openGraph:[\s\S]*url:\s*['"]\/['"]/,
    "root OpenGraph metadata must publish the canonical home URL",
  );
  assert.match(
    robotsSource,
    /NEXT_PUBLIC_SITE_URL\s*\?\?\s*['"]https:\/\/playlore\.xyz['"]/,
    "robots and sitemap must default to the canonical playlore.xyz origin",
  );
  assert.match(
    robotsSource,
    /\.trim\(\)\.replace\(\/\\\/\+\$\/,\s*""\)/,
    "robots.txt must trim and remove trailing slashes from the canonical origin",
  );
  assert.match(
    sitemapSource,
    /NEXT_PUBLIC_SITE_URL\s*\?\?\s*"https:\/\/playlore\.xyz"/,
    "sitemap must default to the canonical playlore.xyz origin",
  );
  assert.match(
    sitemapSource,
    /\.trim\(\)\.replace\(\/\\\/\+\$\/,\s*""\)/,
    "sitemap must trim and remove trailing slashes from the canonical origin",
  );
  assert.match(
    sitemapSource,
    /\/jackpot-win[\s\S]*\/privacy[\s\S]*\/terms/,
    "sitemap must include public jackpot share, privacy, and terms routes",
  );
  assert.match(
    robotsSource,
    /\/privacy[\s\S]*\/terms/,
    "robots.txt must allow public privacy and terms routes in production",
  );
  const jackpotWinPageSource = readFileSync("app/jackpot-win/page.tsx", "utf8");
  assert.match(
    jackpotWinPageSource,
    /https:\/\/playlore\.xyz/,
    "jackpot share preview page must default metadata to playlore.xyz",
  );
  assert.match(
    jackpotWinPageSource,
    /function isPublicHttpsOrigin[\s\S]*protocol !== "https:"[\s\S]*pathname !== "\/"[\s\S]*\.example[\s\S]*192\\.168/,
    "jackpot share preview metadata must reject non-final, private, and placeholder origins",
  );
  assert.match(
    jackpotWinPageSource,
    /Play at playlore\.xyz/,
    "jackpot share preview page CTA must display playlore.xyz",
  );
  const whitePaperSource = readFileSync("app/components/WhitePaper.tsx", "utf8");
  const termsPageSource = readFileSync("app/terms/page.tsx", "utf8");
  const runtimeMonitorSource = readFileSync("scripts/monitor-runtime-health.mjs", "utf8");
  const runtimeMonitorLibSource = readFileSync("scripts/runtime-monitor-lib.mjs", "utf8");
  const roundBettingSource = readFileSync("app/hooks/useMiningRoundBetting.ts", "utf8");
  const faqSource = readFileSync("app/components/FAQ.tsx", "utf8");
  const homePageSource = readFileSync("app/page.tsx", "utf8");
  const leaderboardsComponentSource = readFileSync("app/components/Leaderboards.tsx", "utf8");
  const firstVisitTutorialSource = readFileSync("app/components/FirstVisitTutorial.tsx", "utf8");
  assert.match(
    firstVisitTutorialSource,
    /aria-labelledby=\{titleId\}[\s\S]*aria-describedby=\{`\$\{stepTitleId\} \$\{descriptionId\}`\}/,
    "first-visit tutorial dialog must expose a stable dialog name and the current step title/body to assistive technology",
  );
  assert.match(
    firstVisitTutorialSource,
    /<h2 id=\{titleId\} className="sr-only">First visit tutorial<\/h2>[\s\S]*<h3 id=\{stepTitleId\}[\s\S]*<p id=\{descriptionId\}/,
    "first-visit tutorial stable title, step title, and body ids must stay wired to the dialog",
  );
  assert.doesNotMatch(
    firstVisitTutorialSource,
    /aria-label="First visit tutorial"/,
    "first-visit tutorial must not fall back to a generic dialog label",
  );
  assert.match(
    firstVisitTutorialSource,
    /role="progressbar"[\s\S]*aria-label="Tutorial progress"[\s\S]*aria-valuemin=\{1\}[\s\S]*aria-valuemax=\{TUTORIAL_STEPS\.length\}[\s\S]*aria-valuenow=\{stepIndex \+ 1\}/,
    "first-visit tutorial progress must expose the current step to assistive technology",
  );
  assert.match(
    firstVisitTutorialSource,
    /function readTutorialDismissed\(\): boolean[\s\S]*dismissed === "1"[\s\S]*dismissed === "true"[\s\S]*setItem\(FIRST_VISIT_TUTORIAL_KEY, "1"\)[\s\S]*removeItem\(FIRST_VISIT_TUTORIAL_KEY\)/,
    "first-visit tutorial must normalize legacy dismissed state and clear invalid localStorage values",
  );
  assert.match(
    homePageSource,
    /Promise\.all\(\[\s*getInitialLiveState\(\),\s*getInitialRecentWins\(\),?\s*\]\)/,
    "homepage SSR must load independent live-state and recent-wins bootstrap data concurrently",
  );
  assert.match(
    homePageSource,
    /MAX_TIMER_DELAY_MS = 2_147_483_647[\s\S]*function withTimeout<T>\(promise: Promise<T>, timeoutMs: number\)[\s\S]*Number\.isSafeInteger\(timeoutMs\)[\s\S]*timeoutMs <= 0[\s\S]*timeoutMs > MAX_TIMER_DELAY_MS[\s\S]*return Promise\.resolve\(null\)/,
    "homepage SSR timeout helper must fail closed on fractional, unsafe, or oversized timer delays",
  );
  assert.doesNotMatch(whitePaperSource, /Claim Anytime/, "White Paper must not promise perpetual claims");
  assert.doesNotMatch(
    whitePaperSource,
    /title="Cycles"[\s\S]{0,220}(?:1(?:\u2013|-)\u221e|infinite|unlimited)/i,
    "White Paper must not imply unlimited Auto-Miner cycles",
  );
  assert.match(
    whitePaperSource,
    /Total rounds to auto-bet \(1-5000\)/,
    "White Paper Auto-Miner cycle copy must match the runtime 5000-cycle cap",
  );
  assert.doesNotMatch(
    `${whitePaperSource}\n${faqSource}`,
    /(?:tested on|During) Sepolia\b/,
    "player-facing docs must name Linea Sepolia instead of generic Sepolia",
  );
  assert.match(
    faqSource,
    /<button[\s\S]{0,120}type="button"[\s\S]{0,160}aria-expanded=\{isOpen\}[\s\S]*aria-controls=\{panelId\}/,
    "FAQ accordion buttons must remain non-submit controls with expanded/panel wiring",
  );
  assert.match(
    whitePaperSource,
    /CONTRACT_ADDRESS[\s\S]*shortenAddress\(CONTRACT_ADDRESS\)/,
    "White Paper must display the configured game contract instead of a stale literal address",
  );
  assert.match(
    whitePaperSource,
    /LINEA_TOKEN_ADDRESS[\s\S]*shortenAddress\(LINEA_TOKEN_ADDRESS\)/,
    "White Paper must display the configured LINEA token instead of a stale literal address",
  );
  assert.match(
    runtimeMonitorSource,
    /telegramAlertSender = createTelegramAlertSender\(\)[\s\S]*resendAlertSender = createResendAlertSender\(\)[\s\S]*alertSenders = \[telegramAlertSender, resendAlertSender\][\s\S]*alertsConfigured/,
    "runtime monitor must treat configured Resend email as a first-class alert channel",
  );
  assert.match(
    runtimeMonitorSource,
    /Promise\.allSettled\([\s\S]*alertSenders\.map\(\(sender\) => sender\.send\(message, key, cooldownMs\)\)[\s\S]*delivery\.status === "fulfilled" && delivery\.value/,
    "runtime monitor alert delivery must let one failing channel coexist with successful fallback channels",
  );
  assert.match(
    runtimeMonitorSource,
    /function normalizeMonitorNetwork[\s\S]*mainnet[\s\S]*prod[\s\S]*production[\s\S]*resendConfigured = resendAlertSender\.configured[\s\S]*configuredNetwork = normalizeMonitorNetwork[\s\S]*strictProductionLikeMonitor = process\.env\.NODE_ENV === "production"[\s\S]*Resend email alert configuration is required for production-like runtime monitoring/,
    "production-like runtime monitor startup must require Resend email alerting, not just any alert channel",
  );
  assert.match(
    runtimeMonitorLibSource,
    /function nonNegativeSafeInteger\(value\)[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*\^\(0\|\[1-9\]\\d\{0,15\}\)\$/,
    "runtime monitor helper must canonical-parse non-negative integer evidence",
  );
  assert.match(
    runtimeMonitorLibSource,
    /function parseIsoTimestampMs\(value\)[\s\S]*\^\\d\{4\}-\\d\{2\}-\\d\{2\}T\\d\{2\}:\\d\{2\}:\\d\{2\}\(\?:\\\.\\d\{3\}\)\?Z\$[\s\S]*Date\.parse\(text\)[\s\S]*canonicalText = text\.includes\("\."\) \? text : text\.replace\(\/Z\$\/, "\.000Z"\)[\s\S]*new Date\(parsed\)\.toISOString\(\) === canonicalText[\s\S]*evaluateChainIndexerAudit[\s\S]*parseIsoTimestampMs\(audit\?\.generatedAt\)[\s\S]*evaluateCanaryRevertWindow[\s\S]*parseIsoTimestampMs\(event\?\.timestamp\)[\s\S]*evaluateCanaryActivity[\s\S]*parseIsoTimestampMs\(event\?\.timestamp\)/,
    "runtime monitor audit and canary timestamps must be ISO-8601 UTC before Date.parse",
  );
  assert.match(
    runtimeMonitorLibSource,
    /evaluateBackupFreshness[\s\S]*nonNegativeSafeInteger\(snapshot\.mtimeMs\)[\s\S]*nonNegativeSafeInteger\(snapshot\.bytes\)[\s\S]*evaluateRuntimeSnapshot[\s\S]*nonNegativeSafeInteger\(runtime\?\.process\?\.rssBytes\)[\s\S]*nonNegativeSafeInteger\(liveState\?\.fetchedAt\)/,
    "runtime monitor snapshot and backup metadata must canonical-parse non-negative integer evidence",
  );
  assert.match(
    runtimeMonitorLibSource,
    /evaluateChainIndexerAudit[\s\S]*Number\.isSafeInteger\(nowMs\)[\s\S]*chain-indexer-audit-invalid[\s\S]*effectiveMaxAgeMs = Number\.isSafeInteger\(maxAgeMs\) && maxAgeMs > 0 \? maxAgeMs : 3_600_000[\s\S]*nowMs - generatedAt > effectiveMaxAgeMs[\s\S]*evaluateBackupFreshness[\s\S]*Number\.isSafeInteger\(nowMs\)[\s\S]*sqlite-backup-invalid[\s\S]*effectiveMaxAgeMs = Number\.isSafeInteger\(maxAgeMs\) && maxAgeMs > 0 \? maxAgeMs : 36 \* 60 \* 60 \* 1000[\s\S]*nowMs - mtimeMs > effectiveMaxAgeMs/,
    "runtime monitor chain-indexer audit and backup freshness must fail closed on malformed clocks and fall back to safe stale-age defaults",
  );
  assert.match(
    runtimeMonitorLibSource,
    /MAX_FUTURE_SKEW_MS = 60_000[\s\S]*evaluateRuntimeSnapshot[\s\S]*Number\.isSafeInteger\(nowMs\)[\s\S]*runtime-snapshot-invalid[\s\S]*effectiveStuckGraceMs = Number\.isSafeInteger\(stuckGraceMs\) && stuckGraceMs > 0 \? stuckGraceMs : 120_000[\s\S]*effectiveMaxLiveStateAgeMs = Number\.isSafeInteger\(maxLiveStateAgeMs\) && maxLiveStateAgeMs > 0[\s\S]*fetchedAt <= nowMs \+ MAX_FUTURE_SKEW_MS[\s\S]*nowMs - fetchedAt <= effectiveMaxLiveStateAgeMs[\s\S]*overdueMs > effectiveStuckGraceMs/,
    "runtime monitor snapshot evaluation must fail closed on malformed clock and fall back to safe freshness/grace windows",
  );
  assert.match(
    runtimeMonitorLibSource,
    /evaluateCanaryActivity[\s\S]*Number\.isSafeInteger\(event\?\.targetRounds\)[\s\S]*Number\.isSafeInteger\(event\?\.round\)[\s\S]*const failures = Number\.isSafeInteger\(completedSummary\.failures\) && completedSummary\.failures >= 0[\s\S]*canary-log-invalid/,
    "runtime monitor canary summary events must canonical-parse round and failure counters",
  );
  assert.match(
    runtimeMonitorLibSource,
    /evaluateCanaryActivity[\s\S]*Number\.isSafeInteger\(nowMs\)[\s\S]*canary-log-invalid[\s\S]*effectiveMaxAgeMs = Number\.isSafeInteger\(maxAgeMs\) && maxAgeMs > 0 \? maxAgeMs : 300_000[\s\S]*nowMs - latestTimestamp > effectiveMaxAgeMs/,
    "runtime monitor canary activity must fail closed on malformed clock and fall back to safe stale-age defaults",
  );
  assert.match(
    runtimeMonitorLibSource,
    /evaluateCanaryRevertWindow[\s\S]*Number\.isSafeInteger\(nowMs\)[\s\S]*canary-log-invalid[\s\S]*effectiveWindowMs = Number\.isSafeInteger\(windowMs\) && windowMs > 0 \? windowMs : 300_000[\s\S]*effectiveThreshold = Number\.isSafeInteger\(threshold\) && threshold > 0 \? threshold : 3[\s\S]*uniqueFailures\.size >= effectiveThreshold/,
    "runtime monitor canary revert-window must fail closed on malformed clock and fall back to safe window/threshold defaults",
  );
  assert.match(
    runtimeMonitorLibSource,
    /function readBoundedTextTail\(filePath[\s\S]*const stats = statSync\(filePath\)[\s\S]*!stats\.isFile\(\)[\s\S]*Text artifact must be a file[\s\S]*const size = stats\.size[\s\S]*function readBoundedJsonFile\(filePath[\s\S]*const stats = statSync\(filePath\)[\s\S]*!stats\.isFile\(\)[\s\S]*JSON artifact must be a file[\s\S]*stats\.size > boundedMaxBytes[\s\S]*function loadRuntimeIssueState\(filePath\)[\s\S]*const stats = statSync\(filePath\)[\s\S]*!stats\.isFile\(\) \|\| stats\.size > MAX_STATE_BYTES/,
    "runtime monitor artifact readers must reject directory/non-file inputs before reading JSON, text tails, or state",
  );
  assert.match(
    runtimeMonitorLibSource,
    /function normalizeAlertTimestampMs\(value\)[\s\S]*Number\.isSafeInteger\(value\) && value >= 0[\s\S]*function normalizeAlertCooldownMs\(value\)[\s\S]*Number\.isSafeInteger\(value\) && value >= 0 \? value : 300_000/,
    "runtime monitor alert timestamp and cooldown helpers must fail closed on malformed values",
  );
  assert.equal(
    (runtimeMonitorLibSource.match(/normalizeAlertTimestampMs\(now\(\)\)/g) ?? []).length,
    2,
    "both runtime monitor alert channels must normalize the monitor clock before sending",
  );
  assert.equal(
    (runtimeMonitorLibSource.match(/normalizeAlertCooldownMs\(cooldownMs\)/g) ?? []).length,
    2,
    "both runtime monitor alert channels must normalize cooldowns before sending",
  );
  assert.doesNotMatch(
    runtimeMonitorLibSource,
    /function nonNegativeNumber\(value\)|Number\.isFinite\(parsed\) && parsed >= 0/,
    "runtime monitor snapshot and backup metadata must not use broad Number(value) fallback parsing",
  );
  assert.doesNotMatch(
    runtimeMonitorLibSource,
    /Date\.parse\(String\((?:audit\?\.generatedAt|event\?\.timestamp|event\?\.timestamp \?\? "")\)\)/,
    "runtime monitor audit and canary timestamps must not return to broad Date.parse(String(...)) evidence parsing",
  );
  const invalidResendSender = runtimeMonitor.createResendAlertSender({
    env: {
      RESEND_API_KEY: "re_synthetic",
      RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
      RUNTIME_MONITOR_EMAIL_TO: "not-an-email",
    },
  });
  assert.equal(invalidResendSender.configured, false, "runtime monitor must not treat invalid Resend email addresses as configured");
  let resendRequestBody = null;
  const validResendSender = runtimeMonitor.createResendAlertSender({
    env: {
      RESEND_API_KEY: "re_synthetic",
      RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
      RUNTIME_MONITOR_EMAIL_TO: "playlore88@gmail.com, ops@playlore.xyz",
      ALERT_PREFIX: "LORE Keeper",
    },
    fetchImpl: async (_url, init) => {
      resendRequestBody = JSON.parse(String(init.body));
      return { ok: true };
    },
    now: () => 1_000,
  });
  assert.equal(validResendSender.configured, true, "runtime monitor must accept verified-sender display names and comma-separated email recipients");
  assert.equal(await validResendSender.send("ALERT: synthetic", "synthetic-alert", 0), true);
  assert.deepEqual(resendRequestBody?.to, ["playlore88@gmail.com", "ops@playlore.xyz"]);
  assert.equal(resendRequestBody?.from, "LORE <alerts@playlore.xyz>");
  assert.match(
    runtimeMonitorSource,
    /function isFinalHttpsOrigin[\s\S]*!url\.username[\s\S]*!url\.password[\s\S]*host\.includes\("\."\)[\s\S]*localhost[\s\S]*\.example[\s\S]*100\\\.[\s\S]*169\\\.254[\s\S]*198\\\.51\\\.100[\s\S]*2001:db8/,
    "runtime monitor must reject credentialed, single-label, local, private, reserved, and documentation origins unless local mode is explicit",
  );
  assert.match(
    runtimeMonitorSource,
    /RUNTIME_MONITOR_BASE_URL must be a public HTTPS origin without path, query, or hash/,
    "runtime monitor must fail clearly when pointed at a non-production launch origin",
  );
  assert.match(
    runtimeMonitorSource,
    /function isRuntimeMonitorOrigin\(value\)[\s\S]*!url\.username[\s\S]*!url\.password[\s\S]*url\.pathname === "\/"[\s\S]*url\.search === ""[\s\S]*url\.hash === ""[\s\S]*origin-only-base-url[\s\S]*RUNTIME_MONITOR_BASE_URL must be an origin without credentials, path, query, or hash/,
    "runtime monitor must require an origin-only base URL even when local mode relaxes the public HTTPS requirement",
  );
  assert.match(
    runtimeMonitorSource,
    /MAX_RUNTIME_MONITOR_RESPONSE_BYTES[\s\S]*CONTENT_LENGTH_RE\s*=\s*\/\^\(\?:0\|\[1-9\]\\d\{0,15\}\)\$\/[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseContentLengthHeader[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*function readBoundedJsonResponse[\s\S]*parseContentLengthHeader\(response\.headers\.get\("content-length"\)\)[\s\S]*new TextDecoder\("utf-8", \{ fatal: true \}\)/,
    "runtime monitor must strictly parse Content-Length and bound health response bodies before JSON parsing",
  );
  assert.doesNotMatch(
    runtimeMonitorSource,
    /Number\(response\.headers\.get\("content-length"\)\)/,
    "runtime monitor must not broadly coerce response Content-Length",
  );
  assert.match(
    runtimeMonitorSource,
    /import \{ redactProofText \} from "\.\/redact-proof-output\.mjs"[\s\S]*function describeRuntimeMonitorError\(error\)[\s\S]*redactProofText\(/,
    "runtime monitor fatal errors must use the shared proof redactor",
  );
  assert.match(
    runtimeMonitorSource,
    /MAX_RUNTIME_MONITOR_ERROR_CHARS[\s\S]*<truncated>[\s\S]*fatal: \$\{describeRuntimeMonitorError\(error\)\}/,
    "runtime monitor fatal errors must be compact and bounded",
  );
  assert.doesNotMatch(
    runtimeMonitorSource,
    /response\.json\(\)/,
    "runtime monitor must not use unbounded response.json",
  );
  assert.match(
    runtimeMonitorSource,
    /function backupDirectoryIsExternalSafe\(\)[\s\S]*!isAbsolute\(backupDirectory\)[\s\S]*relative\(REPO_ROOT, resolve\(backupDirectory\)\)[\s\S]*backupDirectory && !allowLocal[\s\S]*must be absolute outside local monitor mode[\s\S]*!backupDirectoryIsExternalSafe\(\)[\s\S]*must be outside the repo checkout/,
    "runtime monitor must reject relative or repo-local backup directories outside explicit local mode",
  );
  assert.match(
    runtimeMonitorSource,
    /strictProductionLikeMonitor && !allowLocal && !backupDirectory[\s\S]*RUNTIME_MONITOR_BACKUP_DIR or LORE_BACKUP_DIR is required for production-like runtime monitoring/,
    "production-like runtime monitor startup must require a backup directory so backup freshness is actually monitored",
  );
  assert.match(
    runtimeMonitorSource,
    /POSITIVE_SAFE_INTEGER_TEXT_RE\s*=\s*\/\^\[1-9\]\\d\{0,15\}\$\/[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function isPositiveSafeIntegerText\(value\)[\s\S]*POSITIVE_SAFE_INTEGER_TEXT_RE\.test\(trimmed\)[\s\S]*BigInt\(trimmed\) <= MAX_SAFE_INTEGER_BIGINT[\s\S]*backupMaxAgeMsRaw[\s\S]*isPositiveSafeIntegerText\(backupMaxAgeMsRaw\)[\s\S]*RUNTIME_MONITOR_BACKUP_MAX_AGE_MS is required as a positive safe integer for production-like runtime monitoring/,
    "production-like runtime monitor startup must require an explicit positive backup freshness window",
  );
  assert.match(
    runtimeMonitorSource,
    /DECIMAL_INTEGER_RE[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*configErrors[\s\S]*function parseRuntimeMonitorIntegerEnv\(name, fallback, \{ min, max \}\)[\s\S]*must be a canonical decimal integer[\s\S]*const parsed = BigInt\(raw\)[\s\S]*const minBigInt = BigInt\(min\)[\s\S]*const maxBigInt = BigInt\(max\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT \|\| parsed < minBigInt \|\| parsed > maxBigInt[\s\S]*return Number\(parsed\)[\s\S]*validateConfig\(\)[\s\S]*configErrors\.length > 0/,
    "runtime monitor numeric env parsing must fail closed on malformed values before polling or alert delivery",
  );
  assert.match(
    runtimeMonitorSource,
    /MIN_HEALTH_DIAGNOSTICS_SECRET_LENGTH\s*=\s*32[\s\S]*MAX_HEALTH_DIAGNOSTICS_SECRET_LENGTH\s*=\s*256[\s\S]*CONTROL_CHAR_RE[\s\S]*function parseHealthDiagnosticsSecretEnv\(name\)[\s\S]*secret\.length < MIN_HEALTH_DIAGNOSTICS_SECRET_LENGTH[\s\S]*secret\.length > MAX_HEALTH_DIAGNOSTICS_SECRET_LENGTH[\s\S]*CONTROL_CHAR_RE\.test\(secret\)[\s\S]*configErrors\.push\(`\$\{name\} must be 32\.\.256 non-control characters`\)[\s\S]*const diagnosticsSecret = parseHealthDiagnosticsSecretEnv\("HEALTH_DIAGNOSTICS_SECRET"\)[\s\S]*configErrors\.length > 0[\s\S]*throw new Error\(configErrors\[0\]\)/,
    "runtime monitor must reject malformed diagnostics secrets before polling or alert delivery",
  );
  assert.doesNotMatch(
    runtimeMonitorSource,
    /process\.env\.HEALTH_DIAGNOSTICS_SECRET\?\.trim\(\)\s*\|\|\s*""/,
    "runtime monitor must not treat arbitrary trimmed diagnostics secret text as header-safe",
  );
  assert.doesNotMatch(
    runtimeMonitorSource,
    /parsePositiveIntegerEnv\(process\.env\.RUNTIME_MONITOR_/,
    "runtime monitor must not use broad fallback parsing for runtime monitor numeric env values",
  );
  assert.match(
    runtimeMonitorSource,
    /function getRuntimeMonitorMissingConfig\(\)[\s\S]*base-url[\s\S]*health-diagnostics-secret[\s\S]*alert-channel[\s\S]*getRuntimeMonitorConfigSummary[\s\S]*groups: "monitoring=1"[\s\S]*missingConfig: getRuntimeMonitorMissingConfig\(\)[\s\S]*wouldPoll: false[\s\S]*wouldSendAlerts: false/,
    "runtime monitor summary preflight must emit safe missing-config tokens without polling endpoints or sending alerts",
  );
  assert.match(
    adminOpsSource,
    /MAX_OPS_LOG_TAIL_BYTES\s*=\s*256\s*\*\s*1024[\s\S]*function readBoundedLogTail/,
    "admin ops must read bounded log tails instead of whole process logs",
  );
  assert.doesNotMatch(
    adminOpsSource,
    /readFileSync\(file,\s*"utf8"\)/,
    "admin ops must not read entire operator log files into memory",
  );
  assert.match(
    standardBetPathSource,
    /EPOCH_BOUND_BITMAP_SELECTOR[\s\S]*getBytecode\(\{ address: CONTRACT_ADDRESS \}\)[\s\S]*bytecode\.toLowerCase\(\)\.includes/,
    "standard betting must detect the epoch-bound selector from deployed bytecode before choosing a V9 fallback",
  );
  assert.match(
    roundBettingSource,
    /placeBetsSilent\(tilesToBet, singleAmountRaw, overrides, txNonce, currentEpoch\)[\s\S]*placeBets\(tilesToBet, singleAmountRaw, overrides, txNonce, currentEpoch\)/,
    "auto-miner standard paths must bind each transaction to the planned epoch",
  );
  assert.match(
    whitePaperSource,
    /92% of fresh stake plus the full rollover/,
    "White Paper must explain that rollover is not charged fees again",
  );
  assert.match(
    whitePaperSource,
    /0\.05% resolver reward[\s\S]*1\.95% is split approximately equally/,
    "White Paper must disclose the exact resolver-first protocol fee split",
  );
  assert.doesNotMatch(
    whitePaperSource,
    /2% goes to protocol accounting: half to treasury and half to a Safety Pool/,
    "White Paper must not describe the protocol fee as an exact half split before the resolver reward",
  );
  assert.doesNotMatch(
    whitePaperSource,
    /funds are only claimable by winners/,
    "White Paper must not hide Safety Pool, resolver, fee, or bounded dust-settlement paths",
  );
  assert.match(
    whitePaperSource,
    /No arbitrary owner withdrawal[\s\S]*one-year dust-settlement paths/,
    "White Paper must describe the bounded V9 fund-movement paths accurately",
  );
  assert.match(
    faqSource,
    /one year[\s\S]*timelocked fee-recipient address/,
    "FAQ must disclose the bounded unclaimed-funds settlement path",
  );
  assert.match(
    faqSource,
    /on-chain entertainment game[\s\S]*not an investment product[\s\S]*comfortable risking/,
    "FAQ must include concise player-facing risk and terms copy without promising profit",
  );
  assert.doesNotMatch(
    `${faqSource}\n${whitePaperSource}`,
    /Once per calendar (?:day|week)[\s\S]{0,140}triggers the (?:daily|weekly) jackpot/,
    "jackpot copy must not promise a fixed daily or weekly jackpot trigger",
  );
  assert.match(
    termsPageSource,
    /on-chain entertainment game[\s\S]*not an investment product[\s\S]*comfortable risking/,
    "Terms of Play must frame game risk without profit promises",
  );
  assert.match(
    termsPageSource,
    /one-year unclaimed[\s\S]*contract is the final source of truth/,
    "Terms of Play must describe contract-controlled unclaimed settlement paths",
  );
  assert.match(
    termsPageSource,
    /Keep a backup[\s\S]*cannot restore a wallet[\s\S]*reverse a confirmed transaction/,
    "Terms of Play must warn about wallet responsibility without exposing internals",
  );
  assert.match(
    `${readFileSync("app/privacy/page.tsx", "utf8")}\n${termsPageSource}`,
    /<svg aria-hidden="true"[\s\S]*Back to LORE[\s\S]*<svg aria-hidden="true"[\s\S]*Back to LORE/,
    "legal-page decorative back-link icons must be hidden from assistive tech",
  );
  assert.match(
    `${readFileSync("app/privacy/page.tsx", "utf8")}\n${termsPageSource}`,
    /href="\/"[\s\S]*min-h-11[\s\S]*focus-visible:ring-2[\s\S]*Back to LORE[\s\S]*href="\/"[\s\S]*min-h-11[\s\S]*focus-visible:ring-2[\s\S]*Back to LORE/,
    "legal-page back links must keep mobile touch targets and visible focus rings",
  );
  assert.doesNotMatch(
    `${layoutSource}\n${whitePaperSource}\n${termsPageSource}\n${leaderboardsComponentSource}\n${firstVisitTutorialSource}\n${readFileSync("app/opengraph-image.tsx", "utf8")}\n${readFileSync("app/components/analytics/analyticsAchievements.ts", "utf8")}`,
    /Mine, bet, and earn|return on investment|earn rewards|\bEarn\b|\bROI\b|Play consistently/,
    "public metadata, docs, and leaderboard copy must avoid investment-style promises",
  );
  assert.match(
    whitePaperSource,
    /explicit operator acceptance of this model[\s\S]*future hardening such as VRF or commit-reveal remains a separate protocol upgrade decision/,
    "White Paper must not imply VRF or commit-reveal is mandatory before mainnet launch",
  );
  assert.doesNotMatch(
    `${readFileSync("app/opengraph-image.tsx", "utf8")}\n${readFileSync("app/api/jackpots/og/route.tsx", "utf8")}`,
    /letterSpacing:\s*["']-/,
    "OpenGraph images must not use negative letter spacing",
  );
  const jackpotOgRouteSource = readFileSync("app/api/jackpots/og/route.tsx", "utf8");
  assert.match(
    jackpotOgRouteSource,
    /import \{ parseBoundedPositiveIntegerParam \} from "\.\.\/\.\.\/_lib\/queryParams";[\s\S]*function sanitizePositiveInt\(raw: string \| null, max: number\)[\s\S]*parseBoundedPositiveIntegerParam\(raw, max\)/,
    "jackpot OpenGraph chips must reuse strict bounded integer query parsing for tile and epoch",
  );
  assert.doesNotMatch(
    jackpotOgRouteSource,
    /CANONICAL_POSITIVE_INTEGER_RE|const parsed = Number\(value\)|raw\?\.trim\(\)[\s\S]*Number\(|\^\[0-9\]\{1,10\}\$|Number\.isInteger\(parsed\)/,
    "jackpot OpenGraph integer parsing must not reintroduce local Number() coercion or trim-normalized integer parsing",
  );
  assert.doesNotMatch(
    faqSource,
    /hardened V9 source/,
    "FAQ must not describe the active V10 release as the old hardened V9 source",
  );
  assert.doesNotMatch(
    `${faqSource}\n${whitePaperSource}`,
    /V9-compatible|ReentrancyGuard/,
    "player-facing FAQ and White Paper must avoid stale internal V9/library naming",
  );
  assert.doesNotMatch(
    `${faqSource}\n${whitePaperSource}`,
    /Phylax|90% cheaper|extremely low|proof aggregation/i,
    "player-facing FAQ and White Paper must avoid unverified security or gas-cost promises",
  );
  const sidebarSource = readFileSync("app/components/Sidebar.tsx", "utf8");
  assert.match(
    sidebarSource,
    /href="\/privacy"[\s\S]*Privacy/,
    "privacy policy must stay discoverable from the main application shell",
  );
  assert.match(
    sidebarSource,
    /href="\/terms"[\s\S]*Terms/,
    "terms of play must stay discoverable from the main application shell",
  );
  assert.match(
    whitePaperSource,
    /href="\/privacy"[\s\S]*Privacy Policy[\s\S]*href="\/terms"[\s\S]*Terms of Play/,
    "White Paper footer must link both Privacy Policy and Terms of Play",
  );
  assert.match(
    sidebarSource,
    /href="\/privacy"[\s\S]*min-h-11[\s\S]*Privacy[\s\S]*href="\/terms"[\s\S]*min-h-11[\s\S]*Terms/,
    "sidebar legal links must keep mobile touch targets",
  );
  assert.match(
    sidebarSource,
    /claimAllLabel = isClaiming \? "Reward claim is already pending"[\s\S]*aria-label=\{claimAllLabel\}[\s\S]*title=\{claimAllLabel\}/,
    "sidebar reward claim-all action must keep an accessible pending/ready label",
  );
  assert.match(
    sidebarSource,
    /claimLabel = isClaiming \? "Reward claim is already pending"[\s\S]*aria-label=\{claimLabel\}[\s\S]*title=\{claimLabel\}/,
    "sidebar reward claim action must keep an accessible pending/ready label",
  );
  const smokeHttpSource = readFileSync("scripts/smoke-http.mjs", "utf8");
  assert.match(
    smokeHttpSource,
    /LORE - Linea Mining Game/,
    "HTTP smoke must verify the LORE page title to catch wrong local sites on the same port",
  );
  assert.match(
    smokeHttpSource,
    /privacy-page[\s\S]*Wallet-first sign-in[\s\S]*Third-party services[\s\S]*We do not ask for your email/,
    "HTTP smoke must verify the privacy page and reject stale email-login disclosure",
  );
  assert.match(
    smokeHttpSource,
    /robots[\s\S]*\/robots\.txt[\s\S]*Sitemap:[\s\S]*sitemap[\s\S]*\/sitemap\.xml[\s\S]*\/jackpot-win[\s\S]*\/privacy[\s\S]*\/terms/,
    "HTTP smoke must verify robots.txt and sitemap.xml stay consistent",
  );
  assert.match(
    smokeHttpSource,
    /MAX_SMOKE_RESPONSE_BYTES[\s\S]*CONTENT_LENGTH_RE\s*=\s*\/\^\(\?:0\|\[1-9\]\\d\{0,15\}\)\$\/[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseContentLengthHeader[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*async function readBoundedResponseText[\s\S]*parseContentLengthHeader\(response\.headers\.get\("content-length"\)\)[\s\S]*new TextDecoder\("utf-8", \{ fatal: true \}\)/,
    "HTTP smoke must strictly parse Content-Length and bound response bodies before assertions",
  );
  assert.match(
    smokeHttpSource,
    /function parseOptionalPositiveIntegerText\(name, value\)[\s\S]*canonical positive decimal integer[\s\S]*EXPECTED_PUBLIC_CHAIN_ID = parseOptionalPositiveIntegerText\("NEXT_PUBLIC_LINEA_CHAIN_ID"[\s\S]*EXPECTED_SERVER_CHAIN_ID = parseOptionalPositiveIntegerText\("LINEA_CHAIN_ID"[\s\S]*LINEA_CHAIN_ID and NEXT_PUBLIC_LINEA_CHAIN_ID must match[\s\S]*health-runtime public config chain id must match configured Linea chain id/,
    "HTTP smoke must canonical-parse configured chain ids and compare health-runtime publicConfig.chainId",
  );
  assert.match(
    smokeHttpSource,
    /function assertNonNegativeSafeIntegerOrNull\(value, label\)[\s\S]*non-negative safe integer or null[\s\S]*assertNonNegativeSafeIntegerOrNull\(json\.contract\.currentEpoch, "health-sync contract\.currentEpoch"\)[\s\S]*assertNonNegativeSafeIntegerOrNull\(json\.storage\.lagBlocks, "health-sync storage\.lagBlocks"\)[\s\S]*assertNonNegativeSafeIntegerOrNull\(\s*json\.storage\.lagToFinalityTargetBlocks,\s*"health-sync storage\.lagToFinalityTargetBlocks"/,
    "HTTP smoke health-sync counters must be non-negative safe integers or null",
  );
  assert.match(
    smokeHttpSource,
    /function assertNonNegativeSafeInteger\(value, label\)[\s\S]*function assertPositiveSafeInteger\(value, label\)[\s\S]*function assertTileId\(value, label\)[\s\S]*assertNonNegativeSafeInteger\(json\.fetchedAt, "live-state fetchedAt"\)[\s\S]*assertNonNegativeSafeInteger\(value, `live-state tileUserCounts\[\$\{index\}\]`\)[\s\S]*assertNonNegativeSafeInteger\(json\.ts, "health-runtime timestamp"\)[\s\S]*assertPositiveSafeInteger\(row\.rank, `\$\{boardName\} entry rank`\)[\s\S]*assertTileId\(row\.tileId, "luckyTile tileId"\)[\s\S]*assertNonNegativeSafeInteger\(row\.wins, "luckyTile wins"\)[\s\S]*assertTileId\(row\.tileId, `recent win \$\{row\.epoch\} tileId`\)/,
    "HTTP smoke must require safe integer timestamp, rank, count, and tile evidence",
  );
  assert.match(
    smokeHttpSource,
    /const uniqueTileCount = new Set\(row\.tileIds\)\.size[\s\S]*row\.tileIds\.forEach\(\(tileId\) => \{[\s\S]*assertTileId\(tileId, `deposit row \$\{row\.epoch\} tileId`\)[\s\S]*assertTileId\(reward\.winningTile, `reward \$\{epoch\} winningTile`\)/,
    "HTTP smoke must require deposit and reward tile evidence to be valid tile ids",
  );
  assert.doesNotMatch(
    smokeHttpSource,
    /Number\.isInteger\(json\.publicConfig\.chainId\)/,
    "HTTP smoke must not accept unsafe or non-positive health-runtime chain ids",
  );
  assert.doesNotMatch(
    smokeHttpSource,
    /Number\.isFinite\(json\.ts\)|assertFiniteNumber\(json\.fetchedAt|Number\.isInteger\(row\.(?:rank|tileId|wins)\)|Number\.isInteger\(value\) \|\| value < 0|Number\.isInteger\(reward\.winningTile\)/,
    "HTTP smoke must not broadly accept unsafe integer evidence",
  );
  assert.doesNotMatch(
    smokeHttpSource,
    /health-sync storage\.(?:lagBlocks|lagToFinalityTargetBlocks)[\s\S]{0,220}Number\.isFinite/,
    "HTTP smoke must not accept fractional health-sync lag evidence",
  );
  assert.doesNotMatch(
    smokeHttpSource,
    /Number\(response\.headers\.get\("content-length"\)\)/,
    "HTTP smoke must not broadly coerce response Content-Length",
  );
  assert.match(
    smokeHttpSource,
    /import \{ redactProofText \} from "\.\/redact-proof-output\.mjs"[\s\S]*function describeSmokeError\(error\)[\s\S]*redactProofText\(/,
    "HTTP smoke terminal errors must use the shared proof redactor",
  );
  assert.match(
    smokeHttpSource,
    /MAX_SMOKE_ERROR_CHARS[\s\S]*<truncated>[\s\S]*console\.error\(describeSmokeError\(error\)\)/,
    "HTTP smoke terminal errors must be compact and bounded",
  );
  assert.doesNotMatch(
    smokeHttpSource,
    /response\.text\(\)/,
    "HTTP smoke must not read unbounded response text",
  );
  const httpLoadSource = readFileSync("scripts/load-http.mjs", "utf8");
  assert.match(
    httpLoadSource,
    /import \{ redactProofText \} from "\.\/redact-proof-output\.mjs"[\s\S]*function describeLoadError\(error\)[\s\S]*redactProofText\(/,
    "HTTP load terminal errors must use the shared proof redactor",
  );
  assert.match(
    httpLoadSource,
    /MAX_LOAD_ERROR_CHARS[\s\S]*<truncated>[\s\S]*console\.error\(describeLoadError\(error\)\)/,
    "HTTP load terminal errors must be compact and bounded",
  );
  assert.doesNotMatch(
    `${smokeHttpSource}\n${httpLoadSource}`,
    /console\.error\(error\)/,
    "HTTP smoke/load scripts must not print raw Error objects",
  );
  assert.match(
    smokeBrowserCoreSource,
    /MAX_WARMUP_RESPONSE_BYTES[\s\S]*CONTENT_LENGTH_RE[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function readBoundedWarmupText[\s\S]*parseContentLengthHeader\(response\.headers\.get\("content-length"\)\)[\s\S]*new TextDecoder\("utf-8", \{ fatal: true \}\)[\s\S]*function parseContentLengthHeader\(value\)[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)/,
    "browser smoke warmup must strictly parse and bound response bodies",
  );
  assert.doesNotMatch(
    smokeBrowserCoreSource,
    /Number\(response\.headers\.get\("content-length"\)\)/,
    "browser smoke warmup must not broadly coerce response Content-Length",
  );
  assert.doesNotMatch(
    smokeBrowserCoreSource,
    /response\.text\(\)/,
    "browser smoke warmup must not read unbounded response text",
  );
  const runtimeHealthSource = readFileSync("app/api/health/runtime/route.ts", "utf8");
  const diagnosticsAuthSource = readFileSync("app/api/health/_lib/diagnosticsAuth.ts", "utf8");
  assert.match(
    runtimeHealthSource,
    /publicConfig/,
    "runtime health must expose a safe public config diagnostic object",
  );
  assert.match(
    runtimeHealthSource,
    /applyNoStoreHeaders\(NextResponse\.json/,
    "runtime health responses must use the shared no-store response helper",
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
    runtimeHealthSource,
    /CONTRACT_REQUIRES_EPOCH_BOUND_BETS/,
    "runtime health must expose the compiled protected-bet requirement",
  );
  assert.match(
    runtimeHealthSource,
    /productionLikeMonitoring[\s\S]*backupMonitorConfigured[\s\S]*backupMonitorMaxAgeConfigured/,
    "runtime health must expose safe backup monitoring and freshness diagnostics without leaking paths",
  );
  assert.match(
    runtimeHealthSource,
    /function isEmailAddress[\s\S]*emailAlertConfigured/,
    "runtime health must expose safe email alert diagnostics without leaking recipients or keys",
  );
  assert.match(
    runtimeHealthSource,
    /MAX_EMAIL_RECIPIENTS\s*=\s*10[\s\S]*MAX_EMAIL_ENTRY_LENGTH\s*=\s*254[\s\S]*if \(raw\.length === 0 \|\| raw\.length > MAX_EMAIL_RECIPIENTS\) return null[\s\S]*raw\.some\(\(entry\) => entry\.length === 0 \|\| entry\.length > MAX_EMAIL_ENTRY_LENGTH\)[\s\S]*emailAlertRecipients !== null[\s\S]*emailAlertRecipients\.every\(isEmailAddress\)/,
    "runtime health email alert diagnostics must fail closed on empty, over-limit, or overlong recipient lists before publishing boolean readiness",
  );
  assert.doesNotMatch(
    runtimeHealthSource,
    /parseEmailRecipients[\s\S]{0,400}\.filter\(/,
    "runtime health email alert diagnostics must not silently drop malformed recipient entries",
  );
  assert.doesNotMatch(
    runtimeHealthSource,
    /publicConfig[\s\S]{0,500}(?:emailAlertRecipients|RUNTIME_MONITOR_EMAIL_TO|RUNTIME_MONITOR_EMAIL_FROM|RESEND_API_KEY)/,
    "runtime health public diagnostics must not publish alert recipients, sender, or Resend key presence fields",
  );
  assert.match(
    runtimeHealthSource,
    /hasPublicExternalRateLimitStore[\s\S]*multiReplicaWeb[\s\S]*externalRateLimitConfigured/,
    "runtime health must expose validated external rate-limit diagnostics without leaking provider credentials",
  );
  assert.match(
    runtimeHealthSource,
    /POSITIVE_SAFE_INTEGER_TEXT_RE\s*=\s*\/\^\[1-9\]\\d\{0,15\}\$\/[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parsePositiveSafeIntegerText\(value: string \| undefined, fallback: number \| null\)[\s\S]*POSITIVE_SAFE_INTEGER_TEXT_RE\.test\(trimmed\)[\s\S]*const parsed = BigInt\(trimmed\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*webReplicaCount = parsePositiveSafeIntegerText\(process\.env\.WEB_REPLICA_COUNT, 1\)[\s\S]*webReplicaCount !== null && webReplicaCount > 1/,
    "runtime health web replica diagnostics must reject malformed WEB_REPLICA_COUNT before multi-replica status is exposed",
  );
  assert.doesNotMatch(
    runtimeHealthSource,
    /Number\(process\.env\.WEB_REPLICA_COUNT|const parsed = Number\(trimmed\)|Number\.isSafeInteger\(parsed\)/,
    "runtime health web replica diagnostics must not broadly coerce WEB_REPLICA_COUNT",
  );
  assert.match(
    runtimeHealthSource,
    /MIN_TRUST_PROXY_SECRET_LENGTH\s*=\s*32[\s\S]*MAX_TRUST_PROXY_SECRET_LENGTH\s*=\s*256[\s\S]*ASCII_CONTROL_CHAR_RE[\s\S]*function hasUsableTrustedProxySecret\(value: string \| undefined\)[\s\S]*trimmed\.length >= MIN_TRUST_PROXY_SECRET_LENGTH[\s\S]*trimmed\.length <= MAX_TRUST_PROXY_SECRET_LENGTH[\s\S]*!ASCII_CONTROL_CHAR_RE\.test\(trimmed\)[\s\S]*trustedProxyConfigured[\s\S]*hasUsableTrustedProxySecret\(process\.env\.TRUST_PROXY_SECRET\)[\s\S]*weakRateLimitIdentityAllowed/,
    "runtime health must expose safe trusted-proxy diagnostics without leaking or accepting malformed proxy secrets",
  );
  assert.doesNotMatch(
    runtimeHealthSource,
    /TRUST_PROXY_SECRET\?\.[\s\S]{0,80}\.length[\s\S]{0,80}>=\s*32/,
    "runtime health trusted-proxy readiness must not use a length-only secret check",
  );
  assert.match(
    diagnosticsAuthSource,
    /MIN_HEALTH_DIAGNOSTICS_SECRET_LENGTH\s*=\s*32[\s\S]*MAX_HEALTH_DIAGNOSTICS_SECRET_LENGTH\s*=\s*256[\s\S]*CONTROL_CHAR_RE[\s\S]*function normalizeHealthDiagnosticsSecret\(value: string \| null \| undefined\)[\s\S]*secret\.length < MIN_HEALTH_DIAGNOSTICS_SECRET_LENGTH[\s\S]*secret\.length > MAX_HEALTH_DIAGNOSTICS_SECRET_LENGTH[\s\S]*CONTROL_CHAR_RE\.test\(secret\)[\s\S]*const secret = normalizeHealthDiagnosticsSecret\(process\.env\.HEALTH_DIAGNOSTICS_SECRET\)[\s\S]*const provided = normalizeHealthDiagnosticsSecret\(request\.headers\.get\(headerName\)\)[\s\S]*if \(!provided\) return false[\s\S]*Buffer\.from\(secret, "utf8"\)/,
    "health diagnostics auth must normalize configured and provided secrets before Buffer allocation or timing-safe comparison",
  );
  assert.doesNotMatch(
    diagnosticsAuthSource,
    /request\.headers\.get\(headerName\)\?\.trim\(\)[\s\S]*Buffer\.from\(provided/,
    "health diagnostics auth must not allocate unbounded provided secrets directly",
  );
  assert.match(
    smokeHttpSource,
    /readOnlyMode/,
    "HTTP smoke must verify runtime health read-only mode diagnostics",
  );
  assert.match(
    smokeHttpSource,
    /backup monitoring diagnostics[\s\S]*backup freshness diagnostics/,
    "HTTP smoke must verify runtime health backup monitoring and freshness diagnostics",
  );
  assert.match(
    smokeHttpSource,
    /email alert diagnostics/,
    "HTTP smoke must verify runtime health email alert diagnostics",
  );
  assert.match(
    smokeHttpSource,
    /external rate-limit diagnostics/,
    "HTTP smoke must verify runtime health external rate-limit diagnostics",
  );
  assert.match(
    smokeHttpSource,
    /trusted proxy diagnostics[\s\S]*weak identity diagnostics/,
    "HTTP smoke must verify runtime health trusted-proxy diagnostics",
  );
  assert.match(
    smokeHttpSource,
    /stale build without required protected V10 bets/,
    "HTTP smoke must reject a stale frontend build when V10 protected bets are required",
  );
  const adminOpsClientSource = readFileSync("app/admin/AdminOpsClient.tsx", "utf8");
  assert.match(
    adminOpsClientSource,
    /readOnlyMode/,
    "admin ops runtime card must surface read-only betting mode",
  );
  assert.match(
    adminOpsClientSource,
    /safePersonalSignError\s*=\s*sanitizeSupportLogPayload\([\s\S]*personalSignError[\s\S]*console\.warn\([\s\S]*safePersonalSignError/,
    "admin auth wallet fallback warnings must sanitize provider error text before console output",
  );
  assert.match(
    adminOpsClientSource,
    /readJsonResponse<DataSyncHealth>[\s\S]*readJsonResponse<RuntimeHealth>[\s\S]*readJsonResponse<OpsData \| OpsErrorPayload>[\s\S]*readJsonResponse<AdminProcessesPayload \| OpsErrorPayload>[\s\S]*readJsonResponse<\{ error\?: string \}>/,
    "admin ops UI API reads must use the bounded JSON response helper",
  );
  assert.doesNotMatch(
    adminOpsClientSource,
    /\.\s*json\(\)/,
    "admin ops UI API reads must not use unbounded response.json",
  );
  const rewardsRouteSource = readFileSync("app/api/rewards/route.ts", "utf8");
  assert.match(
    rewardsRouteSource,
    /parsePositiveIntegerValue\(value\)[\s\S]*parsed === null \|\| parsed > 1_000_000[\s\S]*Invalid epochs/,
    "rewards API must reject unsafe epoch numbers from user payloads through the shared strict parser",
  );
  const recentWinsApiSource = readFileSync("app/api/recent-wins/data.ts", "utf8");
  assert.match(
    recentWinsApiSource,
    /RECENT_WINS_LOG_SCAN_CHUNK = 10_000n[\s\S]*RECENT_WINS_RECOVERY_MAX_BLOCKS = 100_000n[\s\S]*RECENT_WINS_RECOVERY_MAX_RPC_CALLS = 12[\s\S]*RECENT_WINS_RECOVERY_MAX_LOGS = 250[\s\S]*RECENT_WINS_RECOVERY_MAX_TIME_MS = 5_000/,
    "recent-wins RPC recovery must preserve the 10k request range and total block, call, log, and time budgets",
  );
  assert.match(
    recentWinsApiSource,
    /function normalizeStoredUserAddress[\s\S]*getAddress\(user\)\.toLowerCase\(\)/,
    "recent-wins public aggregates must normalize stored/logged user addresses with the EVM parser",
  );
  assert.match(
    recentWinsApiSource,
    /formatLineaWeiDisplayNumber[\s\S]*function toDisplayNumberWei\(value: bigint\)[\s\S]*return formatLineaWeiDisplayNumber\(value\)/,
    "recent-wins rewardNum compatibility fields must derive from bounded raw-wei formatting",
  );
  assert.match(
    recentWinsApiSource,
    /const MAX_TILE_ID = 25[\s\S]*function parseRecentWinTileId\(value: number \| null \| undefined\)[\s\S]*value >= 1 && value <= MAX_TILE_ID[\s\S]*parseRecentWinTileId\(row\.winningTile\) !== null[\s\S]*const tileId = parseRecentWinTileId\(epoch\?\.winningTile\)/,
    "recent-wins API must validate stored winningTile evidence before publishing tile ids",
  );
  assert.doesNotMatch(
    recentWinsApiSource,
    /row\.winningTile > 0|epoch\?\.winningTile && epoch\.winningTile > 0/,
    "recent-wins API must not publish unchecked positive-only winningTile evidence",
  );
  assert.match(
    recentWinsApiSource,
    /function compareBigIntDesc\(left: bigint, right: bigint\)[\s\S]*compareBigIntDesc\(a\.rewardWei, b\.rewardWei\)/,
    "recent-wins resolved winner sorting must compare bigint rewards instead of parsed display strings",
  );
  assert.doesNotMatch(
    recentWinsApiSource,
    /(?:Number\.)?parseFloat\(formatUnits\(args\.reward, 18\)\)|Number\.parseFloat\(reward\)|Number\.parseFloat\(b\.amount\) - Number\.parseFloat\(a\.amount\)/,
    "recent-wins reward mapping must not derive numeric fields or sorting from parseFloat(formatUnits())",
  );
  assert.doesNotMatch(
    recentWinsApiSource,
    /Number\(formatLineaAmountFixed\(value, 6\)\)/,
    "recent-wins rewardNum compatibility fields must not parse formatted decimal strings",
  );
  assert.match(
    recentWinsApiSource,
    /function formatRecentClaimAmount\(value: string \| undefined\)[\s\S]*formatLineaAmountFixed\(parseAmountWei\(value\), 2\)[\s\S]*amount: formatRecentClaimAmount\(row\.reward\)/,
    "recent-wins claim fallback amount display must derive from canonical raw reward text, not stale rewardNum",
  );
  assert.doesNotMatch(
    recentWinsApiSource,
    /amount:\s*row\.rewardNum\.toFixed\(2\)/,
    "recent-wins claim fallback must not format stale rewardNum directly",
  );
  const leaderboardsRouteSource = readFileSync("app/api/leaderboards/route.ts", "utf8");
  assert.match(
    leaderboardsRouteSource,
    /function normalizeStoredUserAddress[\s\S]*getAddress\(user\)\.toLowerCase\(\)/,
    "leaderboard public aggregates must normalize stored user addresses with the EVM parser",
  );
  assert.match(
    leaderboardsRouteSource,
    /formatLineaWeiDisplayNumber[\s\S]*function toDisplayNumberWei\(value: bigint\)[\s\S]*return formatLineaWeiDisplayNumber\(value\)/,
    "leaderboard valueNum compatibility fields must derive from bounded raw-wei formatting",
  );
  assert.doesNotMatch(
    leaderboardsRouteSource,
    /valueNum:\s*Number\(formatUnits\(/,
    "leaderboard valueNum fields must not coerce raw wei through Number(formatUnits())",
  );
  assert.doesNotMatch(
    leaderboardsRouteSource,
    /Number\(formatLineaAmountFixed\(value, 6\)\)/,
    "leaderboard valueNum compatibility fields must not parse formatted decimal strings",
  );
  assert.match(
    leaderboardsRouteSource,
    /function computeLeaderboardRoiBasisPoints\(totalWon: bigint, totalWagered: bigint\)[\s\S]*totalWon \* LEADERBOARDS_ROI_BASIS_POINTS_SCALE[\s\S]*function formatLeaderboardRoiPercent\(roiBasisPoints: bigint\)[\s\S]*roundedTenths[\s\S]*function toLeaderboardRoiValueNum\(roiBasisPoints: bigint\)[\s\S]*LEADERBOARDS_ROI_VALUE_NUM_MAX_BASIS_POINTS/,
    "leaderboard ROI output must keep bigint ROI evidence bounded before formatting display and compatibility fields",
  );
  assert.match(
    leaderboardsRouteSource,
    /const roiBasisPoints = computeLeaderboardRoiBasisPoints\(row\.totalWon, row\.totalWagered\)[\s\S]*value: formatLeaderboardRoiPercent\(roiBasisPoints\)[\s\S]*valueNum: toLeaderboardRoiValueNum\(roiBasisPoints\)[\s\S]*compareBigIntDesc\(a\.roiBasisPoints, b\.roiBasisPoints\)/,
    "leaderboard ROI rows must sort by exact bigint ROI while publishing bounded display values",
  );
  assert.doesNotMatch(
    leaderboardsRouteSource,
    /Number\(\(row\.totalWon \* 10_000n\) \/ row\.totalWagered\)|roi\.toFixed\(1\)/,
    "leaderboard ROI output must not coerce bigint ROI through Number(...).toFixed()",
  );
  assert.match(
    leaderboardsRouteSource,
    /function isFreshLeaderboardsSnapshotSavedAt\(savedAt: unknown, now = Date\.now\(\)\)[\s\S]*Number\.isSafeInteger\(savedAt\)[\s\S]*savedAt <= now[\s\S]*now - savedAt <= LEADERBOARDS_SNAPSHOT_MAX_AGE_MS/,
    "leaderboard snapshots must reject malformed or future savedAt timestamps",
  );
  assert.match(
    leaderboardsRouteSource,
    /!isFreshLeaderboardsSnapshotSavedAt\(snapshot\.savedAt\)/,
    "leaderboard snapshot loading must use the strict savedAt helper",
  );
  assert.doesNotMatch(
    leaderboardsRouteSource,
    /typeof snapshot\.savedAt !== "number" \|\| Date\.now\(\) - snapshot\.savedAt > LEADERBOARDS_SNAPSHOT_MAX_AGE_MS/,
    "leaderboard snapshots must not use broad savedAt age arithmetic",
  );
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
  assert.match(
    recentWinsApiSource,
    /function isFreshRecentWinsSnapshotSavedAt\(savedAt: unknown, now = Date\.now\(\)\)[\s\S]*Number\.isSafeInteger\(savedAt\)[\s\S]*savedAt <= now[\s\S]*now - savedAt <= RECENT_WINS_SNAPSHOT_MAX_AGE_MS[\s\S]*!isFreshRecentWinsSnapshotSavedAt\(snapshot\.savedAt\)/,
    "recent wins snapshots must reject malformed or future savedAt timestamps",
  );
  assert.match(
    recentWinsApiSource,
    /function normalizeClaimTxIdentity\(txHash: string \| null \| undefined\)[\s\S]*\/\^0x\[0-9a-f\]\{64\}\$\/\.test\(normalized\)[\s\S]*function buildRewardClaimStorageIdentity\(row: Pick<StoredClaimRow, "txHash" \| "user" \| "epoch" \| "blockNumber">\)[\s\S]*return `nohash_\$\{parseStoredBlockNumber\(row\.blockNumber\)\.toString\(\)\}_\$\{row\.user\}_\$\{row\.epoch\}`/ ,
    "recent wins reward-claim storage identity must only trust full 32-byte transaction hashes",
  );
  assert.match(
    recentWinsApiSource,
    /for \(const row of existing\) byKey\.set\(buildRewardClaimStorageIdentity\(row\), row\);[\s\S]*for \(const row of incoming\) byKey\.set\(buildRewardClaimStorageIdentity\(row\), row\);/,
    "recent wins transient recovery merge must use the normalized reward-claim identity helper",
  );
  assert.doesNotMatch(
    recentWinsApiSource,
    /upsertRewardClaims|storagePut\("gamedata\/rewardClaims\//,
    "single-RPC recent-wins recovery must remain cache-only and never write normalized durable rows",
  );
  assert.doesNotMatch(
    recentWinsApiSource,
    /`\$\{row\.txHash\}_\$\{row\.user\}_\$\{row\.epoch\}`|`\$\{row\.txHash \|\| "nohash"\}_\$\{row\.user\}_\$\{row\.epoch\}`/,
    "recent wins reward-claim keys must not use raw txHash strings as identity",
  );
  assert.doesNotMatch(
    recentWinsApiSource,
    /typeof snapshot\.savedAt !== "number" \|\| Date\.now\(\) - snapshot\.savedAt > RECENT_WINS_SNAPSHOT_MAX_AGE_MS/,
    "recent wins snapshots must not use broad savedAt age arithmetic",
  );
  const winsTickerSource = readFileSync("app/components/WinsTicker.tsx", "utf8");
  assert.match(
    winsTickerSource,
    /const userLabel = shortenAddr\(w\.user\)[\s\S]*title=\{`Epoch #\$\{w\.epoch\}, \+\$\{w\.amount\} LINEA, \$\{userLabel\}`\}/,
    "wins ticker tooltip must use the same shortened user label as the visible feed chip",
  );
  assert.match(
    winsTickerSource,
    /function divideDecimalTextFixed\(value: string, divisor: number, fractionDigits: number\)[\s\S]*BigInt\(`\$\{whole\}\$\{fractionalRaw\}`[\s\S]*formatScaledUnitsFixed\(scaledOutput, fractionDigits\)[\s\S]*formatDecimalTextFixed\(normalized, 2\)/,
    "wins ticker compact reward display must use decimal-text and bigint scaling",
  );
  assert.doesNotMatch(
    winsTickerSource,
    /Number\.parseFloat|\.toFixed\(/,
    "wins ticker compact reward display must not use parseFloat().toFixed()",
  );
  const leaderboardsTooltipSource = readFileSync("app/components/Leaderboards.tsx", "utf8");
  assert.match(
    leaderboardsTooltipSource,
    /const addressLabel = shortenAddress\(e\.address\)[\s\S]*title=\{addressLabel\}/,
    "leaderboard rows must not place full wallet addresses in hover text",
  );
  assert.match(
    leaderboardsTooltipSource,
    /loading &&[\s\S]*role="status"[\s\S]*aria-live="polite"[\s\S]*aria-busy="true"[\s\S]*aria-hidden="true"[\s\S]*<LoreText items=\{loadingQuotes\}/,
    "leaderboards loading state must be announced as a polite busy status with decorative spinner hidden",
  );
  assert.match(
    leaderboardsTooltipSource,
    /error &&[\s\S]*<UiPanel role="alert"[\s\S]*Retry/,
    "leaderboards error panel must be announced as an alert while preserving retry",
  );
  assert.match(
    leaderboardsTooltipSource,
    /safeToFixed\(e\.pct, 1, "0\.0"\)\}%/,
    "leaderboard lucky-tile percentage display must use the bounded shared formatter",
  );
  assert.doesNotMatch(
    leaderboardsTooltipSource,
    /e\.pct\.toFixed\(1\)/,
    "leaderboard lucky-tile percentage display must not call toFixed directly",
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
  const recentWinsRouteSource = readFileSync("app/api/recent-wins/route.ts", "utf8");
  assert.match(
    recentWinsRouteSource,
    /function computeRecentWinsExpiresAt\(ttlMs: number, now = Date\.now\(\)\)[\s\S]*Number\.isSafeInteger\(now\)[\s\S]*Number\.isSafeInteger\(ttlMs\)[\s\S]*Number\.MAX_SAFE_INTEGER - now[\s\S]*expiresAt: computeRecentWinsExpiresAt\(ttlMs\)[\s\S]*expiresAt: computeRecentWinsExpiresAt\(RECENT_WINS_ROUTE_CACHE_MS\)/,
    "recent wins route cache writes must compute expiry through the fail-closed helper",
  );
  assert.match(
    recentWinsRouteSource,
    /function isFreshRecentWinsCache\(entry: RecentWinsCacheEntry \| null, now = Date\.now\(\)\): entry is RecentWinsCacheEntry[\s\S]*Number\.isSafeInteger\(entry\.expiresAt\)[\s\S]*entry\.expiresAt > now[\s\S]*const freshCache = recentWinsCache[\s\S]*if \(isFreshRecentWinsCache\(freshCache, now\)\)[\s\S]*return jsonNoStore\(freshCache\.payload\)/,
    "recent wins route cache reads must reject malformed expiresAt or caller time",
  );
  assert.doesNotMatch(
    recentWinsRouteSource,
    /expiresAt:\s*Date\.now\(\)\s*\+\s*(?:ttlMs|RECENT_WINS_ROUTE_CACHE_MS)/,
    "recent wins route cache writes must not use broad Date.now() + ttlMs expiry",
  );
  const depositsRouteSource = readFileSync("app/api/deposits/route.ts", "utf8");
  assert.match(
    depositsRouteSource,
    /function parseStoredBlockNumber/,
    "deposits API must tolerate corrupted stored block numbers",
  );
  assert.match(
    depositsRouteSource,
    /formatLineaWeiDisplayNumber[\s\S]*function toDisplayNumberWei\(value: bigint\)[\s\S]*return formatLineaWeiDisplayNumber\(value\)/,
    "deposits API totalAmountNum compatibility fields must derive from bounded raw-wei formatting",
  );
  assert.doesNotMatch(
    depositsRouteSource,
    /totalAmountNum:\s*(?:Number\.)?parseFloat\(formatUnits\(|prev\.totalAmountNum = Number\.parseFloat\(prev\.totalAmount\)/,
    "deposits API must not derive totalAmountNum through parseFloat(formatUnits()) or parsed decimal strings",
  );
  assert.doesNotMatch(
    depositsRouteSource,
    /Number\(formatLineaAmountFixed\(value, 6\)\)/,
    "deposits API totalAmountNum compatibility fields must not parse formatted decimal strings",
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
  assert.match(
    depositsRouteSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseChainEpochNumber\(value: bigint\)[\s\S]*value <= 0n \|\| value > MAX_SAFE_INTEGER_BIGINT[\s\S]*const ep = parseChainEpochNumber\(args\.epoch\)[\s\S]*const onChainCurrentEpochNum = parseChainEpochNumber\(onChainCurrentEpoch\)/,
    "deposits API must safely narrow chain uint256 epochs before recovery and current-epoch decisions",
  );
  assert.doesNotMatch(
    depositsRouteSource,
    /(^|[^A-Za-z0-9_])Number\(args\.epoch\)|(^|[^A-Za-z0-9_])Number\(onChainCurrentEpoch\)/,
    "deposits API must not broadly coerce chain epoch evidence",
  );
  assert.match(
    depositsRouteSource,
    /const MAX_TILE_ID = 25[\s\S]*function parseDepositTileId\(value: bigint\)[\s\S]*value > BigInt\(MAX_TILE_ID\)[\s\S]*function parseDepositTileIds\(values: readonly bigint\[\]\)[\s\S]*const tileId = parseDepositTileId\(args\.tileId\)[\s\S]*const tileIds = parseDepositTileIds\(args\.tileIds\)/,
    "deposits chain recovery must validate single and batch tile ids before publishing rows",
  );
  assert.doesNotMatch(
    depositsRouteSource,
    /Number\(args\.tileId\)|args\.tileIds\.map\(Number\)/,
    "deposits chain recovery must not broadly coerce event tile ids",
  );
  assert.match(
    depositsRouteSource,
    /function hasDepositTiles\(row: DepositRow\)[\s\S]*row\.tileIds\.length > 0[\s\S]*dedupeDeposits\(deposits\)\.map\(normalizeDepositRow\)\.filter\(hasDepositTiles\)[\s\S]*dedupeDeposits\(\[\.\.\.deposits, \.\.\.recovered\]\)\.map\(normalizeDepositRow\)\.filter\(hasDepositTiles\)/,
    "deposits API must not publish stored or recovered rows with no valid tile evidence",
  );
  assert.match(
    depositsRouteSource,
    /function buildDepositKey\(epoch: string, txHash: string, blockNumber: string\)[\s\S]*\/\^0x\[0-9a-f\]\{64\}\$\/\.test\(normalizedHash\)[\s\S]*return `\$\{epoch\}_nohash_\$\{blockNumber\}`/,
    "deposits API storage keys must only treat full 32-byte transaction hashes as tx identity",
  );
  assert.match(
    depositsRouteSource,
    /function normalizeDepositTxHash\(txHash: string \| null \| undefined\)[\s\S]*\/\^0x\[0-9a-f\]\{64\}\$\/\.test\(normalized\)[\s\S]*const txHash = normalizeDepositTxHash\(row\.txHash\)[\s\S]*const txHash = normalizeDepositTxHash\(log\.transactionHash\)/,
    "deposits API public rows must only publish full 32-byte transaction hashes",
  );
  assert.doesNotMatch(
    depositsRouteSource,
    /txHash:\s*log\.transactionHash|log\.transactionHash \?\? ""|txHash:\s*String\(row\.txHash/,
    "deposits API must not publish raw chain or stored txHash values",
  );
  assert.doesNotMatch(
    depositsRouteSource,
    /\/\^0x\[0-9a-f\]\+\$\/\.test\(normalizedHash\)/,
    "deposits API storage keys must not accept short or malformed tx hashes as tx identity",
  );
  assert.match(
    depositsRouteSource,
    /user\s*=\s*getAddress\(userParam \?\? ""\)\.toLowerCase\(\)/,
    "deposits API must normalize query user addresses with the EVM address parser",
  );
  assert.match(
    depositsRouteSource,
    /addressToTopic[\s\S]*getAddress\(address\)/,
    "deposits chain recovery must normalize user addresses before building indexed log topics",
  );
  assert.doesNotMatch(
    depositsRouteSource,
    /Number\(b\.epoch\)\s*-\s*Number\(a\.epoch\)/,
    "deposits API must not sort using unchecked stored epoch numbers",
  );
  assert.match(
    depositsRouteSource,
    /const LOG_CHUNK_BLOCKS = 10_000n/,
    "deposits API log scans must stay within the Linea public RPC 10k block limit",
  );
  assert.match(
    depositsRouteSource,
    /DEPOSITS_BACKGROUND_RECOVERY_COOLDOWN_MS[\s\S]*depositsRecoveryInflight[\s\S]*function recoverDepositsWithGlobalBound[\s\S]*depositsRecoveryInflight \|\|[\s\S]*return null[\s\S]*recoverDepositsWithGlobalBound\(user, currentEpochNum\)/,
    "deposits API must globally bound distinct-address slow recovery scans",
  );
  assert.doesNotMatch(
    depositsRouteSource,
    /return\s+(?:await\s+)?depositsRecoveryInflight\b/,
    "deposits slow recovery must not return another user's in-flight chain scan result",
  );
  assert.match(
    depositsRouteSource,
    /depositsRecoveryStartedAt = now[\s\S]*const task = recoverDepositsFromChain\(user, currentEpochNum\)[\s\S]*depositsRecoveryInflight = task[\s\S]*finally \{[\s\S]*if \(depositsRecoveryInflight === task\)[\s\S]*depositsRecoveryInflight = null/,
    "deposits recovery limiter must set cooldown before chain scan and clear only its own in-flight task",
  );
  assert.match(
    depositsRouteSource,
    /startDepositsRefresh[\s\S]*buildDepositsPayload\(user, includeRewards, \{ allowSlowRecovery: true \}\)[\s\S]*buildDepositsPayload\(user, includeRewards, \{ allowSlowRecovery: false \}\)/,
    "deposits API must keep slow chain recovery in the background path, not the foreground request build",
  );
  assert.match(
    depositsRouteSource,
    /bucket: "api-deposits"[\s\S]*if \(rateLimited\) return applyNoStoreHeaders\(rateLimited\)/,
    "deposits API rate-limit responses must remain no-store before cache lookup or recovery",
  );
  const storageSource = readFileSync("server/storage.ts", "utf8");
  assert.match(
    storageSource,
    /export function buildIndexerBetIdentity\([\s\S]*\/\^0x\[0-9a-f\]\{64\}\$\/\.test\(normalizedHash\)[\s\S]*`\$\{epoch\}_nohash_\$\{blockNumber\}`/,
    "central scoped bet storage keys must only treat full 32-byte transaction hashes as tx identity",
  );
  assert.doesNotMatch(
    storageSource,
    /\/\^0x\[0-9a-f\]\+\$\/\.test\(normalizedHash\)/,
    "central scoped bet storage keys must not accept short or malformed tx hashes as tx identity",
  );
  assert.match(
    storageSource,
    /new Set\(\[currentBase, `\$\{currentBase\}-shm`, `\$\{currentBase\}-wal`\]\)[\s\S]*currentArtifacts\.has\(entry\)/,
    "contract-scope cleanup must never remove the active SQLite DB, WAL, or SHM files",
  );
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
  assert.match(
    storageSource,
    /function normalizePageLimit[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*return Math\.min\(maxValue, value\)/,
    "storage pagination must clamp page limits before SQL LIMIT use",
  );
  assert.match(
    storageSource,
    /getUserParticipatingEpochs[\s\S]*parseSafePositiveIntegerString\(String\(row\.epoch \?\? ""\)\)[\s\S]*getUserParticipatingEpochPage[\s\S]*parseSafePositiveIntegerString\(String\(row\.epoch \?\? ""\)\)/,
    "participating epoch readers must parse stored DB epoch rows safely",
  );
  assert.doesNotMatch(
    storageSource,
    /Number\(row\.epoch\s*\?\?/,
    "participating epoch readers must not coerce stored DB epoch rows through Number(row.epoch ?? ...)",
  );
  assert.match(
    storageSource,
    /function describeStorageError[\s\S]*sanitizeSentryPayload/,
    "storage write and cleanup errors must use the shared server-side redaction boundary",
  );
  assert.doesNotMatch(
    storageSource,
    /console\.(?:error|warn)\([^\n]*(?:error|rollbackErr) instanceof Error/,
    "storage write errors must not print raw provider or database messages",
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
  assert.doesNotMatch(
    dataBridgeSource,
    /Number\((?:value|row\.epoch)\)/,
    "API data bridge must not broadly coerce current or stored epoch values",
  );
  assert.match(
    dataBridgeSource,
    /parsePositiveIntegerValue\(value\)[\s\S]*parsePositiveIntegerValue\(row\.epoch\)/,
    "API data bridge must reuse strict decimal epoch parsing for current and stored epochs",
  );
  assert.match(
    dataBridgeSource,
    /export async function fetchStorageJson<T>\(path: string, limitToLast\?: number\)[\s\S]*readJsonPath<T>\(path, limitToLast\)/,
    "API data bridge must preserve the storage read limit hook for bounded normalized event reads",
  );
  assert.match(
    dataBridgeSource,
    /function isSupportedApiStoragePatchPath\(path: string\)[\s\S]*path === "gamedata\/epochs"[\s\S]*path === "gamedata\/jackpots"[\s\S]*\^gamedata\\\/bets\\\/0x\[a-f0-9\]\{40\}\$/s,
    "API storage writes must be allow-listed to recovery paths with canonical lowercase wallet scope",
  );
  assert.match(
    dataBridgeSource,
    /if \(!isSupportedApiStoragePatchPath\(path\)\)[\s\S]*Unsupported API storage patch path[\s\S]*return false[\s\S]*patchJsonPath\(path, payload\)[\s\S]*return true/,
    "API storage writes must fail closed before calling storage for unsupported paths",
  );
  const rewardSummarySource = readFileSync("app/api/_lib/rewardSummary.ts", "utf8");
  assert.match(
    rewardSummarySource,
    /isSafePositiveInteger/,
    "reward summary must use safe epoch integer filtering",
  );
  assert.match(
    rewardSummarySource,
    /const MAX_TILE_ID = 25[\s\S]*function parseRewardTileNumber\(value: bigint \| number\)[\s\S]*value > BigInt\(MAX_TILE_ID\)[\s\S]*storedWinningTile = stored \? parseRewardTileNumber\(stored\.winningTile\) : null[\s\S]*const winningTile = parseRewardTileNumber\(row\[2\]\)/,
    "reward summary must validate stored and recovered winningTile evidence before cache writes and reward reads",
  );
  assert.match(
    rewardSummarySource,
    /parseStoredPositiveIntegerOrZero[\s\S]*function parseRewardEpochKey\(value: string\)[\s\S]*const parsedEpoch = parseRewardEpochKey\(epoch\)[\s\S]*epoch: parsedEpoch/,
    "reward summary must canonical-parse runtime epoch keys before reward multicalls",
  );
  assert.doesNotMatch(
    rewardSummarySource,
    /winningTile:\s*Number\(winningTile\)|winningTile:\s*Number\(entry\.winningTile\)|Number\(epoch\)|stored\.winningTile > 0/,
    "reward summary must not publish unchecked winningTile or broadly coerced epoch evidence",
  );
  const epochsRouteSource = readFileSync("app/api/epochs/route.ts", "utf8");
  assert.match(
    epochsRouteSource,
    /isSafePositiveInteger/,
    "epochs API must use safe epoch integer filtering",
  );
  assert.match(
    epochsRouteSource,
    /parseStoredPositiveIntegerOrZero[\s\S]*const epoch = parseStoredPositiveIntegerOrZero\(key\)[\s\S]*\.map\(\(key\) => parseStoredPositiveIntegerOrZero\(key\)\)/,
    "epochs API must reuse strict stored epoch parsing for current filtering and missing-epoch reconciliation",
  );
  assert.match(
    epochsRouteSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseChainEpochNumber\(value: bigint\)[\s\S]*value <= 0n \|\| value > MAX_SAFE_INTEGER_BIGINT[\s\S]*const onChainCurrentEpochNum = parseChainEpochNumber\(onChainCurrentEpoch\)/,
    "epochs API must safely narrow chain currentEpoch before cache and reconcile decisions",
  );
  assert.match(
    epochsRouteSource,
    /const MAX_TILE_ID = 25[\s\S]*function parseEpochWinningTile\(value: bigint\)[\s\S]*value > BigInt\(MAX_TILE_ID\)[\s\S]*const winningTile = parseEpochWinningTile\(row\[2\]\)[\s\S]*winningTile === null/,
    "epochs API must validate recovered winningTile evidence before cache and storage patch writes",
  );
  assert.doesNotMatch(
    epochsRouteSource,
    /winningTile:\s*Number\(row\[2\]\)/,
    "epochs API must not publish unchecked recovered winningTile evidence",
  );
  assert.doesNotMatch(
    epochsRouteSource,
    /(^|[^A-Za-z0-9_])Number\(onChainCurrentEpoch\)/,
    "epochs API must not broadly coerce chain currentEpoch evidence",
  );
  assert.doesNotMatch(
    epochsRouteSource,
    /Number\(key\)/,
    "epochs API must not broadly coerce stored epoch keys",
  );
  assert.doesNotMatch(
    epochsRouteSource,
    /Number\.isInteger\(epoch\)/,
    "epochs API must reject unsafe epoch numbers",
  );
  assert.doesNotMatch(
    epochsRouteSource,
    /getEpochEndTime/,
    "resolved-epoch chain fallback must not issue guaranteed-zero end-time RPC reads",
  );
  const betPanelSource = readFileSync("app/components/BetPanel.tsx", "utf8");
  assert.match(
    betPanelSource,
    /className="console-input lore-nums h-11 px-3 text-base font-black"/,
    "manual bet amount input must use the shared numeric font class and 44px touch height",
  );
  const hubSidePanelSourceForTypography = readFileSync("app/components/HubSidePanel.tsx", "utf8");
  assert.match(
    hubSidePanelSourceForTypography,
    /value=\{manualBetForm\.betAmount\}[\s\S]*lore-nums h-11 w-full[\s\S]*tabular-nums/,
    "mobile compact manual bet amount input must use the shared numeric font class",
  );
  assert.match(
    hubSidePanelSourceForTypography,
    /aria-label="Exact total stake"[\s\S]*lore-nums[\s\S]*tabular-nums[\s\S]*\{exactTotal \?\? "Unavailable"\} LINEA/,
    "mobile compact manual bet total must use the shared numeric font class",
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
    /manualButtonDescriptionId[\s\S]*manual-bet-readonly-reason[\s\S]*manual-bet-insufficient-reason[\s\S]*bet-amount-per-tile-error[\s\S]*manual-bet-status[\s\S]*manual-bet-disabled-reason[\s\S]*aria-describedby=\{manualButtonDescriptionId\}/,
    "manual bet primary action must only reference a visible disabled/status reason",
  );
  assert.match(
    betPanelSource,
    /Bet network fee[\s\S]*feeEstimateUnavailable[\s\S]*Unavailable/,
    "desktop manual bet must show the live fee estimate or an explicit unavailable state",
  );
  assert.match(
    betPanelSource,
    /data-testid="auto-miner-action"/,
    "auto-miner primary action must expose a stable smoke-test selector",
  );
  assert.match(
    betPanelSource,
    /top up \{lineaDeficitDisplay\} LINEA/,
    "auto-miner insufficient-balance copy must show the exact LINEA top-up deficit",
  );
  assert.match(
    betPanelSource,
    /aria-describedby=\{autoAction\.disabled && disabledReason && !isAutoMining \? "auto-miner-disabled-reason" : undefined\}/,
    "auto-miner disabled reason must be associated with the disabled primary action",
  );
  assert.match(
    betPanelSource,
    /manualAnnouncement[\s\S]*role="status" aria-live="polite" aria-atomic="true"[\s\S]*\{manualAnnouncement\}/,
    "manual bet state transitions must be announced without relying on visible text changes",
  );
  assert.match(
    betPanelSource,
    /autoMinerAnnouncement[\s\S]*role="status" aria-live="polite" aria-atomic="true"[\s\S]*\{autoMinerAnnouncement\}/,
    "auto-miner phase transitions must be announced without reading every progress update",
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
  assert.match(
    walletTransferPanelsSource,
    /walletTransfers\.totalInDisplay[\s\S]*walletTransfers\.totalOutDisplay/,
    "wallet transfer summary totals must render bigint-safe display strings",
  );
  assert.doesNotMatch(
    walletTransferPanelsSource,
    /walletTransfers\.(?:totalIn|totalOut)\.toFixed\(2\)/,
    "wallet transfer summary totals must not format numeric compatibility fields for display",
  );
  assert.match(
    walletTransferPanelsSource,
    /transferHistoryLoadLabel[\s\S]*role="status"[\s\S]*aria-live="polite"[\s\S]*aria-label=\{transferHistoryLoadLabel\}[\s\S]*title=\{transferHistoryLoadLabel\}/,
    "wallet transfer history load action must expose a state-aware label and polite loading status",
  );
  assert.match(
    walletTransferPanelsSource,
    /role="list"[\s\S]*aria-label="LINEA transfer history"[\s\S]*explorerLabel[\s\S]*role="listitem"[\s\S]*aria-label=\{explorerLabel\}[\s\S]*title=\{explorerLabel\}/,
    "wallet transfer history rows must expose list semantics and clear Lineascan link labels",
  );
  const pendingTxPanelSource = readFileSync("app/components/wallet/WalletSettingsPendingTxPanel.tsx", "utf8");
  assert.match(
    pendingTxPanelSource,
    /Check latest and pending nonces/,
    "pending tx check action must explain what it inspects",
  );
  assert.match(
    pendingTxPanelSource,
    /checkPendingTxLabel[\s\S]*clearPendingTxLabel[\s\S]*aria-label=\{checkPendingTxLabel\}[\s\S]*title=\{checkPendingTxLabel\}[\s\S]*aria-label=\{clearPendingTxLabel\}[\s\S]*title=\{clearPendingTxLabel\}/,
    "pending tx check and clear actions must expose state-aware accessible labels and titles",
  );
  assert.match(
    pendingTxPanelSource,
    /role="status"[\s\S]*aria-live="polite"[\s\S]*aria-atomic="true"[\s\S]*aria-busy=\{isRefreshingPendingTx \|\| isCancellingPendingTx\}/,
    "pending tx panel must announce nonce blocker status and busy state to assistive technology",
  );
  assert.match(
    pendingTxPanelSource,
    /const isPendingTxActionBusy = isRefreshingPendingTx \|\| isCancellingPendingTx/,
    "pending tx check and clear actions must share one busy guard to avoid overlapping nonce operations",
  );
  assert.match(
    pendingTxPanelSource,
    /disabled=\{isPendingTxActionBusy\}[\s\S]*disabled=\{isPendingTxActionBusy \|\| !hasPending\}/,
    "pending tx check and clear actions must both be disabled while either nonce operation is running",
  );
  assert.match(
    pendingTxPanelSource,
    /Run Check first; available only when a stuck nonce is detected/,
    "pending tx clear action must explain why it is disabled",
  );
  assert.match(
    walletSettingsModalSource,
    /aria-pressed=\{activeSection === s\.id\}/,
    "mobile wallet settings sections must expose their selected state",
  );
  assert.match(
    walletSettingsModalSource,
    /min-h-11[^"]*focus-visible:ring-2/,
    "mobile wallet settings sections must keep a 44px touch target and visible keyboard focus",
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
  assert.match(
    headerPoolChartSource,
    /data-testid="header-pool-chart-visual"[\s\S]*data-empty-pool=\{realTotalStaked <= 0 \? "true" : "false"\}/,
    "pool chart visual must expose a stable empty-pool state for browser smoke",
  );
  assert.match(
    headerPoolChartSource,
    /aria-label=\{realTotalStaked <= 0 \? "Pool chart empty state" : "Pool activity chart"\}/,
    "pool chart empty state must be accessible without relying on pixels",
  );
  assert.equal(
    explorerLinks.getExplorerTxUrl(`0x${"a".repeat(64)}`),
    `https://sepolia.lineascan.build/tx/0x${"a".repeat(64)}`,
  );
  assert.equal(
    explorerLinks.getExplorerTxUrl(`  0x${"b".repeat(64)}  `),
    `https://sepolia.lineascan.build/tx/0x${"b".repeat(64)}`,
    "explorer transaction links may trim wallet/provider whitespace around a valid tx hash",
  );
  assert.equal(explorerLinks.getExplorerTxUrl("0x1234"), null);
  assert.equal(explorerLinks.getExplorerTxUrl(`0x${"c".repeat(64)}?wallet=0x${"d".repeat(40)}`), null);
  assert.equal(explorerLinks.getExplorerTxUrl(`0x${"e".repeat(64)}\nhttps://attacker.invalid`), null);
  assert.equal(
    explorerLinks.getExplorerAddressUrl("0x0000000000000000000000000000000000000001"),
    "https://sepolia.lineascan.build/address/0x0000000000000000000000000000000000000001",
  );
  assert.equal(explorerLinks.getExplorerAddressUrl("bad-address"), null);
  const walletActionsSource = readFileSync("app/hooks/useWalletActions.ts", "utf8");
  const walletTransferIntentSource = readFileSync("app/lib/walletTransferIntent.ts", "utf8");
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
  assert.match(
    walletActionsSource,
    /const waitForTransferReceipt[\s\S]*WALLET_TRANSFER_RECEIPT_CLIENTS[\s\S]*waitForStableWalletTransferReceipt\([\s\S]*WALLET_TRANSFER_RECEIPT_CLIENTS,[\s\S]*hash,[\s\S]*TX_RECEIPT_TIMEOUT_MS/,
    "wallet transfer receipt decisions must use the shared independent-client verifier",
  );
  assert.match(
    walletTransferIntentSource,
    /async function readWalletTransferReceiptQuorum[\s\S]*Promise\.allSettled[\s\S]*receiptFingerprint\(first, hash\) !== receiptFingerprint\(second, hash\)[\s\S]*async function assertStableWalletTransferReceipt[\s\S]*const second = await readWalletTransferReceiptQuorum\(clients, hash\)[\s\S]*receiptFingerprint\(second, hash\) !== firstFingerprint[\s\S]*second\.status === "reverted"[\s\S]*throw new WalletTransactionRevertedError\(hash\)[\s\S]*return "confirmed"/,
    "wallet intents must require exact two-client receipt agreement plus a stable quorum reread before success or revert can clear an intent",
  );
  assert.doesNotMatch(
    walletActionsSource,
    /Preparing (?:resolver reward claim|ETH withdraw) from the Privy wallet/,
    "embedded wallet preparation toasts must stay short and avoid redundant Privy-wallet wording",
  );
  assert.match(
    walletActionsSource,
    /estimateResolverRewardClaimGas[\s\S]*simulateContract\(\{[\s\S]*functionName: "claimResolverRewards"[\s\S]*estimateGas/,
    "resolver reward claims must simulate before gas fallback or wallet submission",
  );
  assert.match(
    walletActionsSource,
    /RESOLVER_REWARD_LARGE_DISPLAY_WEI[\s\S]*formatResolverRewards[\s\S]*formatBalanceFixed\(\{ value, decimals: 18 \}/,
    "resolver reward display must format raw bigint reward units",
  );
  assert.doesNotMatch(
    walletActionsSource,
    /Number\(formatUnits\(value, 18\)\)/,
    "resolver reward display must not coerce formatted reward units through Number()",
  );
  assert.equal(
    [...walletActionsSource.matchAll(/if \(resolverClaimInFlightRef\.current\) return;/g)].length,
    2,
    "connected and embedded resolver claims must share a synchronous submission lock",
  );
  assert.match(
    walletActionsSource,
    /activeConnectedResolverAddressRef\.current = normalizedConnectedWalletAddress\?\.toLowerCase\(\) \?\? null[\s\S]*const claimActor = normalizedConnectedWalletAddress\.toLowerCase\(\)[\s\S]*activeConnectedResolverAddressRef\.current !== claimActor/,
    "connected resolver claims must stop stale wallet updates after an actor change",
  );
  assert.match(
    walletActionsSource,
    /activeEmbeddedResolverAddressRef\.current = normalizedEmbeddedWalletAddress\?\.toLowerCase\(\) \?\? null[\s\S]*const claimActor = normalizedEmbeddedWalletAddress\.toLowerCase\(\)[\s\S]*activeEmbeddedResolverAddressRef\.current !== claimActor/,
    "embedded resolver claims must stop stale wallet updates after an actor change",
  );
  assert.ok(
    [...walletActionsSource.matchAll(/activeConnectedResolverAddressRef\.current !== claimActor/g)].length >= 3,
    "connected resolver claims must re-check actor ownership before send, after receipt, and in failure handling",
  );
  assert.ok(
    [...walletActionsSource.matchAll(/activeEmbeddedResolverAddressRef\.current !== claimActor/g)].length >= 3,
    "embedded resolver claims must re-check actor ownership before send, after receipt, and in failure handling",
  );
  assert.match(
    walletActionsSource,
    /handleClaimConnectedResolverRewards[\s\S]*let claimTxHash: `0x\$\{string\}` \| null = null;[\s\S]*claimTxHash = hash;[\s\S]*receiptState === "pending"[\s\S]*Resolver reward claim submitted and is still pending confirmation\.[\s\S]*isAmbiguousPendingTxError\(err\)[\s\S]*claimTxHash[\s\S]*formatTxStatusMessage\("Resolver reward claim submitted and is still pending confirmation\.", claimTxHash\)[\s\S]*Resolver reward claim may already be pending\. Check wallet activity before retrying\.[\s\S]*Resolver reward claim rejected in wallet\./,
    "connected resolver claims must surface pending, ambiguous-with-hash, and rejected wallet states explicitly",
  );
  assert.match(
    walletActionsSource,
    /handleClaimEmbeddedResolverRewards[\s\S]*let claimTxHash: `0x\$\{string\}` \| null = null;[\s\S]*claimTxHash = hash;[\s\S]*receiptState === "pending"[\s\S]*Resolver reward claim submitted and is still pending confirmation\.[\s\S]*isAmbiguousPendingTxError\(err\)[\s\S]*claimTxHash[\s\S]*formatTxStatusMessage\("Resolver reward claim submitted and is still pending confirmation\.", claimTxHash\)[\s\S]*Resolver reward claim may already be pending\. Check wallet activity before retrying\.[\s\S]*Resolver reward claim rejected in wallet\./,
    "embedded resolver claims must surface pending, ambiguous-with-hash, and rejected wallet states explicitly",
  );
  assert.equal(
    [...walletActionsSource.matchAll(/if \(walletTransferInFlightRef\.current\) return;/g)].length,
    4,
    "all wallet deposit and withdrawal handlers must reject rapid duplicate submissions before React rerenders",
  );
  assert.match(
    walletActionsSource,
    /const pendingTxRepairInFlightRef = useRef\(false\)[\s\S]*const cancelPendingTransaction = useCallback\(async \(\) => \{[\s\S]*if \(pendingTxRepairInFlightRef\.current\) \{[\s\S]*Pending transaction repair is already in progress\.[\s\S]*pendingTxRepairInFlightRef\.current = true;[\s\S]*sendTransactionSilent\([\s\S]*finally \{[\s\S]*pendingTxRepairInFlightRef\.current = false;[\s\S]*setIsCancellingPendingTx\(false\);/,
    "pending transaction repair must reject rapid duplicate clear submissions before React rerenders",
  );
  assert.match(
    walletActionsSource,
    /activePendingRepairAddressRef\.current = normalizedEmbeddedWalletAddress\?\.toLowerCase\(\) \?\? null[\s\S]*const repairActor = getAddress\(embeddedWalletAddress\)\.toLowerCase\(\)[\s\S]*assertPendingRepairActorActive[\s\S]*Pending transaction repair stopped because the Privy wallet changed\./,
    "pending transaction repair must bind the repair flow to the starting Privy wallet actor",
  );
  assert.ok(
    [...walletActionsSource.matchAll(/assertPendingRepairActorActive\(\)/g)].length >= 4,
    "pending transaction repair must re-check actor ownership after status refresh, nonce refresh, receipt, and final refresh",
  );
  assert.match(
    walletActionsSource,
    /PendingTx", "cancel failed"[\s\S]*formatWalletActionFailure\(err, "Pending transaction repair"[\s\S]*Pending transaction repair rejected in wallet\./,
    "pending transaction repair must surface wallet rejection instead of silently clearing the repair state",
  );
  assert.match(
    walletActionsSource,
    /PendingTx", "status refresh failed"[\s\S]*isWrongNetworkError\(err\)[\s\S]*Could not inspect pending transactions: wallet is on the wrong network\. Switch to \$\{APP_CHAIN_NAME\} and retry\./,
    "pending transaction status refresh must surface wrong-network errors as a switch-network instruction",
  );
  assert.ok(
    walletActionsSource.includes("const receiptState = await waitForReceipt(hash);") &&
      walletActionsSource.includes('if (receiptState === "pending")') &&
      walletActionsSource.includes("Pending transaction repair submitted for nonce ${targetNonce} and is still pending confirmation.") &&
      walletActionsSource.includes('notify(formatTxStatusMessage(`Replaced blocked nonce ${targetNonce}. If more are queued, run clear again.`, hash), "warning");') &&
      walletActionsSource.includes('notify(formatTxStatusMessage(`Stuck pending transaction cleared at nonce ${targetNonce}.`, hash), "success");'),
    "pending transaction repair must classify hash-known receipt timeouts as pending and include explorer links on pending and confirmed outcomes",
  );
  assert.match(
    walletActionsSource,
    /let repairTxHash: `0x\$\{string\}` \| null = null;[\s\S]*repairTxHash = hash;[\s\S]*isAmbiguousPendingTxError\(err\) && repairTxHash[\s\S]*formatTxStatusMessage\([\s\S]*Pending transaction repair submitted and is still pending confirmation\.[\s\S]*repairTxHash/,
    "pending transaction repair must preserve explorer links for hash-known ambiguous receipt states",
  );
  assert.match(
    walletActionsSource,
    /publicClient\.readContract\([\s\S]*functionName: "balanceOf"[\s\S]*Insufficient LINEA balance in external wallet\./,
    "LINEA deposits must reject an amount above the current external-wallet balance before opening a wallet prompt",
  );
  assert.match(
    walletActionsSource,
    /transaction gas limit cap exceeded[\s\S]*transfer was rejected before submission/,
    "wallet transfer UI must replace the provider gas-cap error with actionable pre-submission guidance",
  );
  assert.doesNotMatch(
    walletActionsSource,
    /\$\{asset\} transfer failed: \$\{message\}/,
    "wallet transfer UI must not surface raw provider or RPC errors to users",
  );
  assert.match(
    walletActionsSource,
    /rpc\|provider\|infura\|alchemy\|sendrawtransaction\|sendtransaction\|json-rpc[\s\S]*wallet provider/,
    "wallet transfer UI must collapse provider/RPC failures into safe actionable copy",
  );
  assert.match(
    walletActionsSource,
    /formatWalletTransferFailure[\s\S]*isWrongNetworkError\(error\)[\s\S]*wallet is on the wrong network\. Switch to \$\{APP_CHAIN_NAME\} and retry\./,
    "wallet transfer UI must surface wrong-network failures as a switch-network instruction",
  );
  assert.match(
    walletActionsSource,
    /formatWalletTransferFailure[\s\S]*isSessionExpiredError\(error\)[\s\S]*wallet session expired\. Log in again and retry\.[\s\S]*isWalletUnavailableError\(error\)[\s\S]*wallet is not ready\. Reconnect the wallet and retry\./,
    "wallet transfer UI must surface expired-session and wallet-unavailable failures as actionable recovery copy",
  );
  assert.match(
    walletActionsSource,
    /formatWalletTransferFailure[\s\S]*isAmbiguousPendingTxError\(error\)[\s\S]*transfer may already be pending/,
    "wallet transfer UI must treat replacement, already-known, and nonce errors as ambiguous pending submissions",
  );
  assert.match(
    walletActionsSource,
    /const knownHash = transferTxHash \?\? getWalletTransferIntentErrorHash\(err\)[\s\S]*knownHash && isWalletTransferIntentError\(err\)[\s\S]*formatTxStatusMessage\(formatWalletTransferFailure\(err, "LINEA"\), knownHash\)[\s\S]*knownHash && isAmbiguousPendingTxError\(err\)[\s\S]*LINEA withdraw submitted and is still pending confirmation[\s\S]*ETH withdraw submitted and is still pending confirmation[\s\S]*ETH transfer submitted and is still pending confirmation[\s\S]*LINEA transfer submitted and is still pending confirmation/,
    "wallet transfers must preserve explorer links for hash-known ambiguous or manually blocked receipt states",
  );
  assert.match(
    walletActionsSource,
    /function formatWalletActionFailure[\s\S]*wallet timeout[\s\S]*may already be pending[\s\S]*wallet is on the wrong network\. Switch to \$\{APP_CHAIN_NAME\} and retry\.[\s\S]*wallet session expired\. Log in again and retry\.[\s\S]*wallet is not ready\. Reconnect the wallet and retry\.[\s\S]*reverted on-chain[\s\S]*wallet provider/,
    "wallet action failures must use a shared safe classifier for claim, repair, and pending-tx flows",
  );
  assert.doesNotMatch(
    walletActionsSource,
    /Resolver reward claim failed: \$\{message\}|Could not clear pending tx: \$\{message\}|Privy wallet repair failed: \$\{message\}/,
    "wallet action failures must not surface raw provider or RPC messages to users",
  );
  assert.match(
    walletActionsSource,
    /timed out[\s\S]*status is unknown[\s\S]*Check wallet activity before retrying/,
    "wallet transfer timeout must warn against an unsafe duplicate retry",
  );
  assert.match(
    walletActionsSource,
    /reverted on-chain[\s\S]*Funds were not moved/,
    "wallet transfer revert must explain that the transfer did not settle",
  );
  assert.equal(
    [...walletActionsSource.matchAll(/notify\(formatWalletTransferFailure\(err, "(?:ETH|LINEA)"\)/g)].length,
    4,
    "all ETH and LINEA transfer failures must use the shared actionable classifier",
  );
  const testnetRevertSource = readFileSync("scripts/run-testnet-revert-check.ts", "utf8");
  assert.match(
    testnetRevertSource,
    /Refusing to broadcast without \$\{CONFIRMATION_FLAG\}/,
    "testnet revert check must require explicit broadcast confirmation",
  );
  assert.match(
    testnetRevertSource,
    /chain\.id !== TESTNET_CHAIN_ID[\s\S]*Refusing non-testnet revert check/,
    "testnet revert check must refuse any non-Sepolia chain",
  );
  assert.match(
    testnetRevertSource,
    /simulateContract[\s\S]*invalidreceiver[\s\S]*writeContract[\s\S]*receipt\.status !== "reverted"/,
    "testnet revert check must simulate first and require a reverted receipt",
  );
  assert.match(
    testnetRevertSource,
    /import \{ redactProofText \} from "\.\/redact-proof-output\.mjs"[\s\S]*function describeRevertCheckError\(error: unknown\)[\s\S]*redactProofText\(/,
    "testnet revert check fatal errors must use the shared proof redactor",
  );
  assert.match(
    testnetRevertSource,
    /MAX_REVERT_CHECK_ERROR_CHARS[\s\S]*<truncated>[\s\S]*console\.error\(describeRevertCheckError\(error\)\)/,
    "testnet revert check fatal errors must be compact and bounded",
  );
  const privyWalletSource = readFileSync("app/hooks/usePrivyWallet.ts", "utf8");
  assert.match(
    privyWalletSource,
    /import \{ log \} from "\.\.\/lib\/logger";[\s\S]*log\.warn\("PrivyWallet"/,
    "Privy wallet warnings must use the shared redacted support logger",
  );
  assert.doesNotMatch(
    privyWalletSource,
    /console\.warn\(/,
    "Privy wallet warnings must not bypass support-log redaction through direct console.warn",
  );
  assert.match(
    privyWalletSource,
    /withTimeout\([\s\S]*externalWallet\.switchChain\(APP_CHAIN_ID\)[\s\S]*EXTERNAL_WALLET_NETWORK_TIMEOUT_MS/,
    "external wallet network switching must not leave transfer actions pending indefinitely",
  );
  assert.match(
    privyWalletSource,
    /isUserRejection\(switchErr\)\) throw switchErr;[\s\S]*switchErr\.name === "TimeoutError"[\s\S]*Network switch timed out/,
    "external wallet switch rejection or timeout must not trigger a duplicate fallback prompt",
  );
  assert.match(
    privyWalletSource,
    /method: "eth_accounts"[\s\S]*setProviderExternalWalletAddress\(providerAccount\)[\s\S]*from: providerAccount/,
    "external transfers must use the account currently selected in the provider instead of a stale Privy wallet-list address",
  );
  assert.match(
    privyWalletSource,
    /const currentChainId =[\s\S]*method: "eth_chainId"[\s\S]*method: "eth_accounts"[\s\S]*from: providerAccount/,
    "external transfers must refresh the selected account after the network switch before sending",
  );
  assert.match(
    privyWalletSource,
    /accountsChanged[\s\S]*setProviderExternalWalletAddress\(getProviderSelectedAddress\(accounts\)\)/,
    "wallet settings must refresh the displayed external address after an injected-wallet account change",
  );
  assert.match(
    privyWalletSource,
    /"External wallet eth_chainId"/,
    "external wallet chain verification must be time bounded",
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
  const dialogFocusTrapSource = readFileSync("app/hooks/useDialogFocusTrap.ts", "utf8");
  assert.match(
    dialogFocusTrapSource,
    /const isRenderedEnabledElement[\s\S]*window\.getComputedStyle\(element\)[\s\S]*getClientRects\(\)\.length > 0[\s\S]*!element\.hidden[\s\S]*style\.display !== "none"[\s\S]*style\.visibility !== "hidden"[\s\S]*style\.visibility !== "collapse"[\s\S]*!element\.hasAttribute\("disabled"\)[\s\S]*getAttribute\("aria-disabled"\) !== "true"[\s\S]*closest\("fieldset\[disabled\]"\)[\s\S]*isFocusableCandidate[\s\S]*closest\("\[aria-hidden='true'\]"\)[\s\S]*closest\("\[inert\]"\)/,
    "dialog focus traps must skip hidden, non-rendered, disabled, aria-disabled, disabled-fieldset, aria-hidden, and inert controls",
  );
  assert.match(
    dialogFocusTrapSource,
    /isFocusableCandidate[\s\S]*querySelector<HTMLElement>\(initialFocusSelector\)[\s\S]*isFocusableCandidate\(initialFocus\)/,
    "dialog focus traps must validate the requested initial focus target before focusing it",
  );
  assert.match(
    dialogFocusTrapSource,
    /!container\?\.contains\(active\)/,
    "dialog focus traps must recover when focus escapes the active dialog",
  );
  assert.match(
    dialogFocusTrapSource,
    /fallbackFocusTarget[\s\S]*querySelector<HTMLElement>\("\[role='dialog'\]"\)[\s\S]*fallbackFocusTarget\(\)\?\.focus\(\)/,
    "dialog focus traps must focus the dialog root when the trap is mounted on an overlay",
  );
  assert.match(
    dialogFocusTrapSource,
    /previousFocus\?\.isConnected[\s\S]*isRenderedEnabledElement\(previousFocus\)[\s\S]*previousFocus\.focus\(\)/,
    "dialog focus traps must only restore focus to an attached, visible, enabled element",
  );
  assert.match(
    dialogFocusTrapSource,
    /activeDialogScrollLocks[\s\S]*document\.body\.style\.overflow = "hidden"[\s\S]*unlockBodyScroll\(\)/,
    "dialog focus traps must lock and restore body scrolling while overlays are active",
  );
  assert.match(
    dialogFocusTrapSource,
    /const onEscapeRef = useRef\(onEscape\)[\s\S]*onEscapeRef\.current = onEscape[\s\S]*const escapeHandler = onEscapeRef\.current[\s\S]*escapeHandler\(\)/,
    "dialog focus traps must keep Escape handlers fresh without remounting the trap on callback identity changes",
  );
  assert.doesNotMatch(
    dialogFocusTrapSource,
    /\[active, containerRef, initialFocusSelector, onEscape\]/,
    "dialog focus traps must not refocus and restore scroll just because onEscape was recreated",
  );
  const chatProfileFocusSource = readFileSync("app/components/chat/ChatProfileModal.tsx", "utf8");
  assert.match(
    chatProfileFocusSource,
    /useDialogFocusTrap<HTMLDivElement>\(true, onClose, "#profile-name"\)/,
    "chat profile must use the shared focus trap while preserving its initial name-field focus",
  );
  assert.match(
    chatProfileFocusSource,
    /aria-labelledby=\{titleId\}[\s\S]*aria-describedby=\{descriptionId\}[\s\S]*<p id=\{descriptionId\} className="sr-only">/,
    "chat profile dialog must expose a stable accessible description without visible UI copy",
  );
  assert.match(
    jackpotBannerSource,
    /useDialogFocusTrap\(isModalOpen, handleClose, undefined, overlayRef\)/,
    "jackpot modal must use the shared focus trap while preserving background inerting",
  );
  assert.doesNotMatch(
    jackpotBannerSource,
    /document\.addEventListener\("keydown"/,
    "jackpot modal must not maintain a second dialog keyboard trap",
  );
  assert.match(
    chatProfileFocusSource,
    /aria-label="Close"[\s\S]*title="Close"/,
    "chat profile close button must expose a standard accessible and hover label",
  );
  assert.doesNotMatch(
    chatProfileFocusSource,
    /document\.addEventListener\("keydown"/,
    "chat profile must not maintain a second dialog keyboard trap",
  );
  const fundingManualFormSource = readFileSync("app/hooks/useManualBetForm.ts", "utf8");
  const autoMinerFormSource = readFileSync("app/hooks/useAutoMinerForm.ts", "utf8");
  const fundingBetPanelSource = readFileSync("app/components/BetPanel.tsx", "utf8");
  const fundingPrivyPanelSource = readFileSync("app/components/wallet/WalletSettingsPrivyPanel.tsx", "utf8");
  assert.match(fundingManualFormSource, /lineaDeficit/, "manual betting must expose the exact LINEA shortfall");
  assert.match(
    fundingManualFormSource,
    /validateBetAmount\(betAmount\) !== null[\s\S]*window\.localStorage\.removeItem\(MANUAL_BET_AMOUNT_KEY\)[\s\S]*window\.localStorage\.setItem\(MANUAL_BET_AMOUNT_KEY, betAmount\)/,
    "manual bet amount cache must drop invalid in-progress values instead of restoring stale bad input",
  );
  assert.match(
    fundingManualFormSource,
    /function formatManualNumberDisplay\(value: number \| null \| undefined, fractionDigits = 2\)[\s\S]*formatDecimalTextFixed\(String\(value\), fractionDigits\)[\s\S]*totalBetDisplay[\s\S]*balanceDisplay[\s\S]*lineaDeficitDisplay/,
    "manual betting display amounts must be prepared through canonical decimal display formatting",
  );
  assert.match(
    fundingManualFormSource,
    /if \(raw != null\) \{[\s\S]*else window\.localStorage\.removeItem\(MANUAL_BET_AMOUNT_KEY\)[\s\S]*if \(legacyRaw != null\) \{[\s\S]*window\.localStorage\.removeItem\(LEGACY_MANUAL_BET_AMOUNT_KEY\)[\s\S]*catch \{[\s\S]*window\.localStorage\.removeItem\(MANUAL_BET_AMOUNT_KEY\)[\s\S]*window\.localStorage\.removeItem\(LEGACY_MANUAL_BET_AMOUNT_KEY\)/,
    "manual bet amount restore must clear invalid current and legacy localStorage entries",
  );
  assert.match(
    autoMinerFormSource,
    /lineaore:auto-miner-inputs:v2:\$\{APP_CHAIN_ID\}:\$\{CONTRACT_ADDRESS\.toLowerCase\(\)\}/,
    "auto-miner settings cache must be chain and contract scoped before mainnet",
  );
  assert.match(
    autoMinerFormSource,
    /validateBetAmount\(betSize\) !== null[\s\S]*window\.localStorage\.removeItem\(AUTOMINER_INPUTS_KEY\)[\s\S]*window\.localStorage\.setItem\(AUTOMINER_INPUTS_KEY/,
    "auto-miner input cache must drop invalid in-progress bet sizes instead of restoring stale bad input",
  );
  assert.match(
    autoMinerFormSource,
    /LEGACY_AUTOMINER_INPUTS_KEY[\s\S]*window\.localStorage\.getItem\(LEGACY_AUTOMINER_INPUTS_KEY\)/,
    "auto-miner settings cache must preserve the legacy v1 fallback during migration",
  );
  assert.match(
    readFileSync("scripts/smoke-browser.mjs", "utf8"),
    /lineaore:auto-miner-inputs:v2:\$\{SMOKE_CHAIN_ID\}:\$\{process\.env\.NEXT_PUBLIC_CONTRACT_ADDRESS\.toLowerCase\(\)\}/,
    "browser smoke must verify the same chain and contract scoped auto-miner cache key as runtime",
  );
  assert.match(
    fundingBetPanelSource,
    /function formatPanelNumber\(value: number \| null \| undefined, fractionDigits: number, fallback: string\)[\s\S]*formatDecimalTextFixed\(String\(value\), fractionDigits\)[\s\S]*top up \{lineaDeficitDisplay\} LINEA/,
    "manual and Auto-Miner top-up copy must show the top-up amount through canonical decimal display formatting",
  );
  assert.doesNotMatch(
    fundingBetPanelSource,
    /totalBet\.toFixed|totalCost\.toFixed|lineaDeficit\.toFixed|balance\?\.toFixed|\(balance \?\? 0\)\.toFixed/,
    "manual and Auto-Miner visible LINEA amounts must not render through direct .toFixed() calls",
  );
  assert.match(fundingPrivyPanelSource, /From external:/, "Privy top-up must identify the source wallet");
  assert.match(fundingPrivyPanelSource, /To Privy:/, "Privy top-up must identify the recipient wallet");
  assert.match(
    fundingPrivyPanelSource,
    /aria-label=\{embeddedAddressCopied \? "Privy wallet address copied" : "Copy Privy wallet address"\}[\s\S]*title=\{embeddedAddressCopied \? "Privy wallet address copied" : "Copy Privy wallet address"\}/,
    "Privy wallet copy action must expose a contextual accessible name and hover label",
  );
  assert.match(
    walletTransferRowSource,
    /transferActionLabel[\s\S]*role="status"[\s\S]*aria-live="polite"[\s\S]*aria-label=\{`\$\{assetLabel\} transfer amount`\}[\s\S]*aria-label=\{transferActionLabel\}[\s\S]*title=\{transferActionLabel\}/,
    "wallet top-up transfer rows must expose amount labels, action labels, and polite sending status",
  );
  const uiButtonSource = readFileSync("app/components/ui/UiButton.tsx", "utf8");
  assert.match(
    uiButtonSource,
    /type\s*=\s*"button"[\s\S]*<button[\s\S]*type=\{type\}/,
    "shared UiButton must default to non-submit semantics for reusable wallet/chat/admin actions",
  );
  assert.match(
    walletSettingsModalSource,
    /max-h-\[calc\(100dvh-1rem\)\]/,
    "Wallet Settings must stay inside the dynamic viewport when a mobile keyboard opens",
  );
  assert.match(walletSettingsModalSource, /min-h-0 flex-1/, "Wallet Settings content must shrink and scroll inside the modal");
  assert.match(miningGuardsSource, /Signing bet transaction\./, "manual betting must identify the signing phase");
  assert.match(miningGuardsSource, /submitted and is still pending/, "manual betting must identify the pending phase");
  assert.match(miningGuardsSource, /Bet confirmed on-chain\./, "manual betting must identify the confirmed phase");
  assert.doesNotMatch(miningGuardsSource, /Preparing bet transaction/, "manual betting must not use an ambiguous preparing phase");
  assert.doesNotMatch(
    miningGuardsSource,
    /Preparing bet in your Privy wallet/,
    "manual betting must not show the removed wallet-preparing copy",
  );
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
  assert.equal(utils.isUserRejection({ shortMessage: "User rejected the request." }), true);
  assert.equal(utils.isUserRejection({ cause: { shortMessage: "Request rejected by user." } }), true);
  assert.equal(utils.isUserRejection(Object.assign(new Error("wallet error"), { cause: { details: "User cancelled the signature prompt" } })), true);
  assert.equal(utils.isUserRejection({ shortMessage: "User closed modal before signing." }), true);
  assert.equal(utils.isUserRejection({ cause: { details: "Wallet modal closed by the user." } }), true);
  assert.equal(utils.isUserRejection({ code: -32000, message: "replacement transaction underpriced" }), false);
  assert.equal(utils.isUserRejection({ shortMessage: "replacement transaction underpriced" }), false);
  assert.equal(utils.isUserRejection({ message: "connection closed while reading RPC response" }), false);

  assert.equal(utils.safeParseFloat("1.5"), 1.5);
  assert.equal(utils.safeParseFloat("1,5"), 1.5);
  assert.equal(utils.safeParseFloat(".5"), 0.5);
  assert.equal(utils.safeParseFloat("1e3"), 0);
  assert.equal(utils.safeParseFloat("1e309"), 0);
  assert.equal(utils.safeParseFloat("12abc"), 0);
  assert.equal(utils.safeParseFloat("1.2.3"), 0);
  assert.equal(utils.safeParseFloat("NaN"), 0);
  assert.equal(utils.safeToFixed(12.345, 2), "12.35");
  assert.equal(utils.safeToFixed(Number.NaN, 2), "0.00");
  assert.equal(utils.safeToFixed(Number.POSITIVE_INFINITY, 2, "fallback"), "fallback");
  assert.equal(utils.safeToFixed(12.345, 101, "fallback"), "fallback");
  assert.equal(utils.safeToFixed(12.345, 1.5, "fallback"), "fallback");
  const utilsSource = readFileSync("app/lib/utils.ts", "utf8");
  assert.match(
    utilsSource,
    /safeParseFloat[\s\S]*normalizeDecimalInput\(value\.trim\(\)\)[\s\S]*\/\^\(\?:\\d\+\\\.\?\\d\*\|\\\.\\d\+\)\$\/[\s\S]*Number\(normalized\)/,
    "safeParseFloat must strict-parse canonical decimal text instead of accepting exponent or prefix text",
  );
  assert.doesNotMatch(
    utilsSource,
    /parseFloat\(normalizeDecimalInput/,
    "safeParseFloat must not use parseFloat prefix parsing for wallet form amounts",
  );
  assert.match(
    utilsSource,
    /safeToFixed[\s\S]*Number\.isInteger\(decimals\)[\s\S]*decimals > 100[\s\S]*value\.toFixed\(decimals\)/,
    "safeToFixed must bound fraction digits before calling toFixed",
  );
  assert.match(
    utilsSource,
    /MAX_TIMER_DELAY_MS = 2_147_483_647[\s\S]*export function withTimeout[\s\S]*Number\.isSafeInteger\(timeoutMs\)[\s\S]*timeoutMs <= 0[\s\S]*timeoutMs > MAX_TIMER_DELAY_MS[\s\S]*timeout must be between 1 and 2147483647 milliseconds/,
    "shared promise timeout helper must reject fractional, unsafe, or oversized timer delays",
  );
  const rawFormattedError = utils.formatUnknownError(Object.assign(
    new Error(`provider failed https://rpc.example.test/secret Bearer synthetic-token ${"a".repeat(80)} ${"b".repeat(700)}`),
    {
      code: "CALL_EXCEPTION",
      details: `wallet 0x${"c".repeat(40)} privateKey=${"d".repeat(64)}`,
      data: { rpcUrl: "https://rpc.example.test/key", token: "inline-secret" },
      status: 500,
    },
  ));
  assert.match(rawFormattedError, /CALL_EXCEPTION/);
  assert.match(rawFormattedError, /Status: 500/);
  assert.ok(rawFormattedError.length <= 600, "unknown error formatting must stay bounded");
  assert.doesNotMatch(
    rawFormattedError,
    /rpc\.example|synthetic-token|inline-secret|0x[c]{40}|d{64}|b{300}/i,
    "unknown error formatting must redact provider URLs, wallet addresses, tokens, and long raw payloads",
  );
  assert.equal(safetyPoolClaimThreshold.parseMinSafetyPoolClaimWei("100"), 100_000_000_000_000_000_000n);
  assert.equal(safetyPoolClaimThreshold.parseMinSafetyPoolClaimWei("bad"), 100_000_000_000_000_000_000n);
  assert.equal(safetyPoolClaimThreshold.isSafetyPoolClaimBelowMinimum(1n, 2n), true);
  assert.deepEqual(
    miningShared.sanitizePersistedAutoMinerSession({
      active: true,
      runId: "run:test-session",
      actor: "0x0000000000000000000000000000000000000001",
      betStr: "1.5",
      blocks: 3,
      rounds: 5,
      nextRoundIndex: 2,
      lastPlacedEpoch: "10",
    }),
    {
      active: false,
      runId: "run:test-session",
      actor: "0x0000000000000000000000000000000000000001",
      betStr: "1.5",
      blocks: 3,
      rounds: 5,
      nextRoundIndex: 2,
      lastPlacedEpoch: "10",
      issuedAt: 0,
      expiresAt: 0,
      maxSpendPerBetRaw: "4500000000000000000",
      totalSpendRaw: "22500000000000000000",
      remainingSpendRaw: "13500000000000000000",
    },
    "legacy Auto-Miner sessions must migrate to a paused, exact-spend envelope",
  );
  const validAutoMinerSession = {
    active: true,
    runId: "run:test-session",
    actor: "0x0000000000000000000000000000000000000001",
    betStr: "1.5",
    blocks: 3,
    rounds: 5,
    nextRoundIndex: 2,
    lastPlacedEpoch: "10",
  };
  for (const [field, value] of [
    ["blocks", 3.5],
    ["blocks", Number.MAX_SAFE_INTEGER + 1],
    ["rounds", 5.5],
    ["rounds", Number.MAX_SAFE_INTEGER + 1],
    ["nextRoundIndex", 2.5],
    ["nextRoundIndex", Number.MAX_SAFE_INTEGER + 1],
  ]) {
    assert.equal(
      miningShared.sanitizePersistedAutoMinerSession({
        ...validAutoMinerSession,
        [field]: value,
      }),
      null,
      `Auto-Miner persisted session must reject unsafe ${field} value ${String(value)}`,
    );
  }
  assert.equal(
    miningShared.sanitizePersistedAutoMinerSession({
      active: true,
      runId: "https://rpc.example.test/secret",
      actor: "0x0000000000000000000000000000000000000001",
      betStr: "1.5",
      blocks: 3,
      rounds: 5,
      nextRoundIndex: 2,
      lastPlacedEpoch: "10",
    }),
    null,
    "Auto-Miner session run ids must be bounded local tokens, not URLs or secret-bearing strings",
  );
  for (const lastPlacedEpoch of ["001", "1e3", "-1", "9".repeat(79)]) {
    assert.equal(
      miningShared.sanitizePersistedAutoMinerSession({
        ...validAutoMinerSession,
        lastPlacedEpoch,
      }),
      null,
      `Auto-Miner persisted session must reject corrupted lastPlacedEpoch ${lastPlacedEpoch.slice(0, 12)}`,
    );
  }
  assert.equal(
    miningShared.sanitizePersistedAutoMinerSession({
      active: true,
      betStr: "1.5",
      blocks: 3,
      rounds: 5,
      nextRoundIndex: 2,
      lastPlacedEpoch: "10",
    }),
    null,
    "legacy actor-free sessions must never resume",
  );
  assert.equal(
    miningShared.sanitizePersistedAutoMinerSession({
      active: true,
      actor: "0x0000000000000000000000000000000000000001",
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
      actor: "0x0000000000000000000000000000000000000001",
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
      actor: "0x0000000000000000000000000000000000000001",
      betStr: "1",
      blocks: 3,
      rounds: 5,
      nextRoundIndex: 6,
      lastPlacedEpoch: "10",
    }),
    null,
  );
  assert.equal(
    miningShared.sanitizePersistedAutoMinerSession({
      active: true,
      actor: "0x0000000000000000000000000000000000000001",
      betStr: "1",
      blocks: 3,
      rounds: miningShared.MAX_AUTO_MINER_CYCLES + 1,
      nextRoundIndex: 2,
      lastPlacedEpoch: "10",
    }),
    null,
  );
  const previousAutoMinerWindow = globalThis.window;
  try {
    const storage = new Map();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        dispatchEvent: () => true,
        localStorage: {
          getItem: (key) => storage.get(key) ?? null,
          setItem: (key, value) => storage.set(key, String(value)),
          removeItem: (key) => storage.delete(key),
        },
      },
    });
    storage.set(miningShared.AUTO_MINER_STORAGE_KEY, "{bad json");
    assert.equal(miningShared.readSession(), null);
    assert.equal(storage.has(miningShared.AUTO_MINER_STORAGE_KEY), false, "corrupt Auto-Miner session must be cleared");
    storage.set(miningShared.AUTO_MINER_STORAGE_KEY, JSON.stringify({ active: true, betStr: "1", blocks: 3, rounds: 5, nextRoundIndex: 0 }));
    assert.equal(miningShared.readSession(), null);
    assert.equal(storage.has(miningShared.AUTO_MINER_STORAGE_KEY), false, "invalid Auto-Miner session must be cleared");
  } finally {
    if (previousAutoMinerWindow === undefined) {
      delete globalThis.window;
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousAutoMinerWindow,
      });
    }
  }
  assert.deepEqual(
    miningShared.sanitizeTabLock({ id: "tab-1", ts: 123, tx: "nonce-1" }),
    { id: "tab-1", ts: 123, tx: "nonce-1" },
  );
  assert.deepEqual(
    miningShared.sanitizeTabLock({ id: "tab-1", ts: 123, tx: "  nonce-1  " }),
    { id: "tab-1", ts: 123, tx: "nonce-1" },
  );
  assert.deepEqual(
    miningShared.sanitizeTabLock({ id: "tab-1", ts: 123, tx: 999 }),
    { id: "tab-1", ts: 123 },
  );
  assert.deepEqual(
    miningShared.sanitizeTabLock({ id: "tab-1", ts: 123, tx: "https://rpc.example.test/private" }),
    { id: "tab-1", ts: 123 },
  );
  assert.deepEqual(
    miningShared.sanitizeTabLock({ id: "tab-1", ts: 123, tx: "x".repeat(97) }),
    { id: "tab-1", ts: 123 },
  );
  assert.deepEqual(
    miningShared.sanitizeTabLock({ id: "tab-1", ts: 123, tx: "nonce\n1" }),
    { id: "tab-1", ts: 123 },
  );
  assert.equal(miningShared.sanitizeTabLock({ id: "", ts: 123 }), null);
  assert.equal(miningShared.sanitizeTabLock({ id: "tab-1", ts: Number.NaN }), null);
  assert.equal(miningShared.sanitizeTabLock({ id: "tab-1", ts: 123.5 }, 200), null);
  assert.equal(miningShared.sanitizeTabLock({ id: "tab-1", ts: Number.MAX_SAFE_INTEGER + 1 }, 200), null);
  assert.equal(miningShared.sanitizeTabLock({ id: "tab-1", ts: 123 }, 200.5), null);
  assert.equal(miningShared.sanitizeTabLock({ id: "tab-1", ts: 123 }, -1), null);
  assert.equal(miningShared.sanitizeTabLock({ id: "tab-1", ts: Date.now() + 60_000 }), null);
  {
    const previousWindow = globalThis.window;
    const sessionStorage = new Map();
    try {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
          sessionStorage: {
            getItem: (key) => sessionStorage.get(key) ?? null,
            setItem: (key, value) => sessionStorage.set(key, String(value)),
            removeItem: (key) => sessionStorage.delete(key),
          },
        },
      });
      const validTabId = "11111111-1111-4111-8111-111111111111";
      const initialTabId = miningShared.getStableTabId();
      const tabStorageKey = [...sessionStorage.keys()].find((key) => key.startsWith("lore:auto-mine-tab-id:"));
      assert.ok(tabStorageKey, "stable Auto-Miner tab id must be stored under the scoped sessionStorage key");
      assert.equal(sessionStorage.get(tabStorageKey), initialTabId);
      sessionStorage.set(tabStorageKey, validTabId);
      assert.equal(miningShared.getStableTabId(), validTabId);
      sessionStorage.set(tabStorageKey, "bad-tab-id");
      const repairedTabId = miningShared.getStableTabId();
      assert.notEqual(repairedTabId, "bad-tab-id");
      assert.equal(sessionStorage.get(tabStorageKey), repairedTabId);
    } finally {
      if (previousWindow === undefined) {
        delete globalThis.window;
      } else {
        Object.defineProperty(globalThis, "window", {
          configurable: true,
          value: previousWindow,
        });
      }
    }
  }
  assert.equal(miningShared.getSecureRandomNumber(0), 0);
  assert.equal(miningShared.getSecureRandomNumber(Number.NaN), 0);
  const miningSharedSource = readFileSync("app/hooks/useMining.shared.ts", "utf8");
  assert.match(
    miningSharedSource,
    /MAX_TIMER_DELAY_MS = 2_147_483_647[\s\S]*export function withMiningRpcTimeout[\s\S]*Number\.isSafeInteger\(timeoutMs\)[\s\S]*timeoutMs <= 0[\s\S]*timeoutMs > MAX_TIMER_DELAY_MS[\s\S]*timeout must be between 1 and 2147483647 milliseconds/,
    "mining RPC timeout helper must reject fractional, unsafe, or oversized timer delays",
  );
  assert.match(
    miningSharedSource,
    /function isValidStableTabId[\s\S]*window\.sessionStorage\.getItem\(storageKey\)[\s\S]*isValidStableTabId\(existing\)[\s\S]*window\.sessionStorage\.removeItem\(storageKey\)/,
    "Auto-Miner stable tab id restore must clear invalid sessionStorage entries",
  );
  assert.match(
    miningSharedSource,
    /function getSecureRandomNumber[\s\S]*const bound = Math\.floor\(max\)[\s\S]*bound > 0x1_0000_0000[\s\S]*const limit = Math\.floor\(0x1_0000_0000 \/ bound\) \* bound[\s\S]*while \(array\[0\] >= limit\)[\s\S]*return array\[0\] % bound/,
    "Auto-Miner tab-lock random markers should bound inputs and avoid modulo bias when native crypto is available",
  );
  assert.match(
    miningSharedSource,
    /export function sanitizePersistedAutoMinerSession\(value: unknown\)[\s\S]*Number\.isSafeInteger\(blocks\)[\s\S]*Number\.isSafeInteger\(rounds\)[\s\S]*Number\.isSafeInteger\(nextRoundIndex\)/,
    "Auto-Miner persisted session sanitizer must reject unsafe numeric recovery metadata",
  );
  assert.match(
    miningSharedSource,
    /AUTO_MINER_EPOCH_RE = \/\^\(\?:0\|\[1-9\]\\d\{0,77\}\)\$\/[\s\S]*AUTO_MINER_EPOCH_RE\.test\(lastPlacedEpoch\)/,
    "Auto-Miner persisted session sanitizer must bound lastPlacedEpoch before resume BigInt parsing",
  );
  assert.doesNotMatch(
    miningSharedSource.match(/export function sanitizePersistedAutoMinerSession\(value: unknown\)[\s\S]*?\n\}/)?.[0] ?? "",
    /Number\.isInteger\((?:blocks|rounds|nextRoundIndex)\)|\/\^\\d\+\$\/\.test\(lastPlacedEpoch\)/,
    "Auto-Miner persisted session sanitizer must not use broad integer checks or unbounded epoch strings for recovery metadata",
  );
  assert.match(
    miningSharedSource,
    /TAB_LOCK_TX_TOKEN_RE = \/\^\[a-zA-Z0-9:._-\]\{1,96\}\$\/[\s\S]*export function sanitizeTabLock\(value: unknown, now = Date\.now\(\)\)[\s\S]*Number\.isSafeInteger\(ts\)[\s\S]*Number\.isSafeInteger\(now\)[\s\S]*ts - now > TAB_LOCK_MAX_FUTURE_SKEW_MS[\s\S]*const cleanTx = typeof tx === "string" \? tx\.trim\(\) : ""[\s\S]*TAB_LOCK_TX_TOKEN_RE\.test\(cleanTx\)/,
    "Auto-Miner tab-lock sanitizer must reject unsafe timestamps and keep persisted tx markers bounded before orphan recovery",
  );
  assert.doesNotMatch(
    miningSharedSource,
    /typeof ts !== "number" \|\| !Number\.isFinite\(ts\) \|\| ts <= 0/,
    "Auto-Miner tab-lock sanitizer must not use broad finite timestamp checks",
  );
  const miningTabLockSource = readFileSync("app/hooks/useMiningTabLock.ts", "utf8");
  assert.match(
    miningTabLockSource,
    /const resolvePing = \(alive: boolean\)[\s\S]*window\.clearTimeout\(timeoutId\)[\s\S]*pendingLockPingResolvers\.delete\(requestId\)[\s\S]*resolve\(alive\)[\s\S]*pending\(false\)/,
    "orphaned tab-lock ping recovery must clear its timeout when the owner responds",
  );
  assert.match(
    miningTabLockSource,
    /function clearInvalidStoredTabLock\(\)[\s\S]*localStorage\.removeItem\(TAB_LOCK_KEY\)[\s\S]*catch \{[\s\S]*ignore storage failures[\s\S]*export async function acquireTabLock\(\): Promise<boolean> \{[\s\S]*return acquireNativeTabLock\(\);/,
    "Auto-Miner start must require the browser's atomic tab lock instead of a localStorage fallback",
  );
  assert.match(
    miningTabLockSource,
    /async function acquireNativeTabLock\(\): Promise<boolean> \{[\s\S]*typeof navigator === "undefined" \|\| !navigator\.locks\) return false;[\s\S]*navigator\.locks[\s\S]*ifAvailable: true[\s\S]*mode: "exclusive"/,
    "Auto-Miner native tab lock must fail closed without Web Locks and request an exclusive non-waiting lock",
  );
  assert.doesNotMatch(
    miningTabLockSource.match(/export async function acquireTabLock\(\): Promise<boolean> \{[\s\S]*?\n\}/)?.[0] ?? "",
    /\.localStorage|\.setItem\(|readTabLock\(|clearTabLock\(|recoverOrphanedTabLock\(/,
    "Auto-Miner lock acquisition must not recreate a localStorage ownership fallback",
  );
  assert.match(
    miningTabLockSource,
    /function renewTabLock\(\)[\s\S]*if \(!lock\) \{[\s\S]*clearInvalidStoredTabLock\(\)[\s\S]*catch \{[\s\S]*clearInvalidStoredTabLock\(\)[\s\S]*function releaseTabLock\(\)[\s\S]*if \(!lock\) \{[\s\S]*clearInvalidStoredTabLock\(\)[\s\S]*catch \{[\s\S]*clearInvalidStoredTabLock\(\)/,
    "Auto-Miner tab-lock renew and release must clear corrupted localStorage instead of leaving stale locks",
  );
  const autoMineRunnerSource = readFileSync("app/hooks/useMiningAutoMineRunner.ts", "utf8");
  assert.match(
    autoMineRunnerSource,
    /const preferredActorAddress = getPreferredActorAddress\(\);[\s\S]*actorAddress: preferredActorAddress,[\s\S]*markRunStarted: \(\) => \{[\s\S]*startedRun = true;[\s\S]*autoMineRef\.current = true;[\s\S]*if \(startRoundIndex === 0 && preferredActorAddress\) \{[\s\S]*runtimeController\.persistStart\(\{[\s\S]*actor: preferredActorAddress as `0x\$\{string\}`,[\s\S]*betStr,[\s\S]*blocks,[\s\S]*rounds,[\s\S]*if \(!preparedRun\) \{\s*if \(startedRun\) runtimeController\.clearPersistedRun\(\);[\s\S]*deactivateAutoMineUi\(\);[\s\S]*return;/,
    "Auto-Miner setup failures must not clear or overwrite persisted sessions before an exclusive tab lock starts a real run",
  );
  const miningLifecycleSource = readFileSync("app/hooks/useMiningLifecycle.ts", "utf8");
  assert.doesNotMatch(
    miningLifecycleSource.match(/const handleAutoMineToggle = useCallback\([\s\S]*?await runAutoMiningRef\.current\(\{ betStr, blocks, rounds \}\);/)?.[0] ?? "",
    /runtimeController\.persistStart/,
    "Auto-Miner toggle must not persist a restorable run before the runner acquires the exclusive tab lock",
  );
  assert.match(
    autoMineRunnerSource,
    /finally \{\s*releaseInTabAutoMineRuntime\(\);\s*if \(!startedRun\) return;[\s\S]*autoMineRef\.current = false;[\s\S]*runtimeController\.finalizeRun\(stopReason\);/,
    "Auto-Miner runner must always release its in-tab runtime guard, but only finalize persisted runs after a real start",
  );
  assert.match(
    autoMineRunnerSource,
    /pendingNonceBlocked[\s\S]*getAutoMineRunnerCatchStopReason\(\{[\s\S]*pendingNonceBlocked,[\s\S]*if \(!sessionExpired && !networkDown && !walletUnavailable && !pendingNonceBlocked\) \{\s*runtimeController\.clearPersistedRun\(\);/,
    "Auto-Miner pending nonce pauses must preserve the persisted session for manual recovery instead of clearing it as a generic error",
  );
  const autoMineRuntimeControllerSource = readFileSync("app/lib/mining/autoMineRuntimeController.ts", "utf8");
  assert.match(
    autoMineRuntimeControllerSource,
    /let activeRunId: string \| null = null;[\s\S]*function currentSessionMatchesActiveRun\(\)[\s\S]*current\.runId !== activeRunId[\s\S]*current\.actor\.toLowerCase\(\) !== activeActor\.toLowerCase\(\)/,
    "Auto-Miner persisted recovery must bind stale checkpoint and finalize decisions to active run id and actor",
  );
  assert.match(
    autoMineRuntimeControllerSource,
    /if \(!activeActor \|\| !activeRunId \|\| !activeAuthorization\) \{\s*resetActiveAuthorization\(\);\s*return;\s*\}\s*if \(!currentSessionMatchesActiveRun\(\)\) return;/,
    "inactive Auto-Miner controllers must not clear a persisted session they cannot prove they own",
  );
  assert.match(
    autoMineRuntimeControllerSource,
    /if \(!actorAddress \|\| saved\.actor\.toLowerCase\(\) !== actorAddress\.toLowerCase\(\)\) \{\s*resetActiveAuthorization\(\);\s*return \{ kind: "actor-mismatch" \};\s*\}/,
    "Auto-Miner restore checks for a different actor must not clear another actor's saved run",
  );
  const autoMineRunSetupSource = readFileSync("app/lib/mining/autoMineRunSetup.ts", "utf8");
  const tabLockGateIndex = autoMineRunSetupSource.indexOf("if (!(await acquireTabLock())");
  const tabLockRecoveryIndex = autoMineRunSetupSource.indexOf("recoverOrphanedTabLock()");
  const tabLockAbortIndex = autoMineRunSetupSource.indexOf("exclusive tab lock unavailable - aborting start");
  const runStartedIndex = autoMineRunSetupSource.indexOf("markRunStarted()");
  const activeUiIndex = autoMineRunSetupSource.indexOf("setIsAutoMining(true)");
  const walletWaitIndex = autoMineRunSetupSource.indexOf('onProgress("Waiting for wallet...")');
  const bootstrapIndex = autoMineRunSetupSource.indexOf("const bootstrapReady = await prepareAutoMineBootstrap");
  assert.notEqual(tabLockGateIndex, -1, "Auto-Miner setup must require an exclusive tab lock before starting");
  assert.notEqual(tabLockRecoveryIndex, -1, "Auto-Miner setup must attempt orphaned tab-lock recovery before failing");
  assert.notEqual(tabLockAbortIndex, -1, "Auto-Miner setup must fail closed when tab-lock acquisition is unavailable");
  assert.notEqual(runStartedIndex, -1, "Auto-Miner setup must mark a run only after lock acquisition");
  assert.notEqual(activeUiIndex, -1, "Auto-Miner setup must activate UI only after lock acquisition");
  assert.notEqual(walletWaitIndex, -1, "Auto-Miner setup must keep wallet wait visible only after lock acquisition");
  assert.notEqual(bootstrapIndex, -1, "Auto-Miner setup must keep approval/bootstrap behind lock acquisition");
  assert.ok(
    tabLockGateIndex < tabLockAbortIndex &&
      tabLockAbortIndex < runStartedIndex &&
      tabLockAbortIndex < activeUiIndex &&
      tabLockAbortIndex < walletWaitIndex &&
      tabLockAbortIndex < bootstrapIndex,
    "Auto-Miner must not enter running, wallet-wait, or approval/bootstrap state before the exclusive tab lock is acquired",
  );
  {
    let markRunStartedCalls = 0;
    let ensureWalletCalls = 0;
    let silentSendReads = 0;
    let writeApproveCalls = 0;
    let nativeGasChecks = 0;
    let clearedSessions = 0;
    const progressMessages = [];
    const runningParams = [];
    const miningStates = [];
    const prepared = await autoMineRunSetup.prepareAutoMineRunSetup({
      acquireTabLock: async () => false,
      actorAddress: "0x0000000000000000000000000000000000000001",
      approveRetryMax: 1,
      assertNativeGasBalance: async () => {
        nativeGasChecks += 1;
      },
      autoMineActive: () => true,
      betStr: "1",
      blocks: 1,
      clearPendingApprove: () => {},
      ensurePreferredWallet: async () => {
        ensureWalletCalls += 1;
      },
      getUrgentFees: async () => undefined,
      markRunStarted: () => {
        markRunStartedCalls += 1;
      },
      maxNetworkAttempts: 1,
      maxNetworkMs: 1,
      minGasApprove: 1n,
      networkInitialMs: 1,
      onClearPersistedSession: () => {
        clearedSessions += 1;
      },
      onProgress: (message) => {
        progressMessages.push(message);
      },
      pendingApproveRef: { current: null },
      publicClient: {},
      readSilentSend: () => {
        silentSendReads += 1;
        return undefined;
      },
      recoverOrphanedTabLock: async () => false,
      refetchAllowance: () => {},
      rounds: 1,
      setIsAutoMining: (value) => {
        miningStates.push(value);
      },
      setRunningParams: (value) => {
        runningParams.push(value);
      },
      setSelectedTiles: () => {},
      setSelectedTilesEpoch: () => {},
      startRoundIndex: 0,
      waitReceipt: async () => "confirmed",
      writeApprove: async () => {
        writeApproveCalls += 1;
        return "0x0000000000000000000000000000000000000000000000000000000000000000";
      },
    });
    assert.equal(prepared, null, "Auto-Miner setup must return null when exclusive tab lock cannot be acquired");
    assert.equal(markRunStartedCalls, 0, "Auto-Miner must not mark a run started without an exclusive tab lock");
    assert.equal(ensureWalletCalls, 0, "Auto-Miner must not touch wallet readiness before the exclusive tab lock");
    assert.equal(silentSendReads, 0, "Auto-Miner must not read wallet send functions before the exclusive tab lock");
    assert.equal(writeApproveCalls, 0, "Auto-Miner must not approve before the exclusive tab lock");
    assert.equal(nativeGasChecks, 0, "Auto-Miner must not run gas checks before the exclusive tab lock");
    assert.equal(clearedSessions, 0, "Auto-Miner lock failure must not clear persisted sessions through bootstrap failure handling");
    assert.deepEqual(miningStates, [false]);
    assert.deepEqual(runningParams, [null]);
    assert.deepEqual(progressMessages, [
      "Auto-Miner needs an exclusive tab lock. Close other mining tabs or use a current browser.",
      null,
    ]);
  }
  {
    const lockAttempts = [];
    let recoverCalls = 0;
    let markRunStartedCalls = 0;
    let ensureWalletCalls = 0;
    let writeApproveCalls = 0;
    let silentSendCalls = 0;
    let nativeGasChecks = 0;
    let clearPendingApproveCalls = 0;
    const progressMessages = [];
    const miningStates = [];
    const runningParams = [];
    const selectedTiles = [];
    const selectedEpochs = [];
    const readContracts = [];
    const enoughLinea = 10n ** 18n;
    const publicClient = {
      readContract: async ({ functionName }) => {
        readContracts.push(functionName);
        return enoughLinea;
      },
    };
    const prepared = await autoMineRunSetup.prepareAutoMineRunSetup({
      acquireTabLock: async () => {
        lockAttempts.push(lockAttempts.length + 1);
        return lockAttempts.length === 2;
      },
      actorAddress: "0x0000000000000000000000000000000000000001",
      approveRetryMax: 1,
      assertNativeGasBalance: async () => {
        nativeGasChecks += 1;
      },
      autoMineActive: () => true,
      betStr: "1",
      blocks: 1,
      clearPendingApprove: () => {
        clearPendingApproveCalls += 1;
      },
      ensurePreferredWallet: async () => {
        ensureWalletCalls += 1;
      },
      getUrgentFees: async () => undefined,
      markRunStarted: () => {
        markRunStartedCalls += 1;
      },
      maxNetworkAttempts: 1,
      maxNetworkMs: 1,
      minGasApprove: 1n,
      networkInitialMs: 1,
      onClearPersistedSession: () => {},
      onProgress: (message) => {
        progressMessages.push(message);
      },
      pendingApproveRef: { current: null },
      publicClient,
      readSilentSend: () => async () => {
        silentSendCalls += 1;
        return "0x0000000000000000000000000000000000000000000000000000000000000000";
      },
      recoverOrphanedTabLock: async () => {
        recoverCalls += 1;
        return true;
      },
      refetchAllowance: () => {},
      rounds: 1,
      setIsAutoMining: (value) => {
        miningStates.push(value);
      },
      setRunningParams: (value) => {
        runningParams.push(value);
      },
      setSelectedTiles: (tiles) => {
        selectedTiles.push(tiles);
      },
      setSelectedTilesEpoch: (epoch) => {
        selectedEpochs.push(epoch);
      },
      startRoundIndex: 0,
      waitReceipt: async () => "confirmed",
      writeApprove: async () => {
        writeApproveCalls += 1;
        return "0x0000000000000000000000000000000000000000000000000000000000000000";
      },
    });
    assert.ok(prepared, "Auto-Miner setup must continue after orphan recovery and second lock acquisition");
    assert.deepEqual(lockAttempts, [1, 2], "Auto-Miner orphan recovery must retry the exclusive tab lock exactly once");
    assert.equal(recoverCalls, 1, "Auto-Miner setup must attempt orphaned lock recovery after the first lock miss");
    assert.equal(markRunStartedCalls, 1, "Auto-Miner must mark a run only after recovered exclusive lock acquisition");
    assert.deepEqual(miningStates, [true], "Auto-Miner UI must enter running only after recovered exclusive lock acquisition");
    assert.deepEqual(runningParams, [{ betStr: "1", blocks: 1, rounds: 1 }]);
    assert.deepEqual(selectedTiles, [[]]);
    assert.deepEqual(selectedEpochs, [null]);
    assert.deepEqual(progressMessages, ["1 / 1"]);
    assert.deepEqual(readContracts, ["balanceOf", "allowance"]);
    assert.equal(clearPendingApproveCalls, 1, "sufficient allowance after lock recovery must clear stale approval state");
    assert.equal(ensureWalletCalls, 0, "sufficient allowance after lock recovery must not request wallet approval");
    assert.equal(writeApproveCalls, 0, "sufficient allowance after lock recovery must not send an approval transaction");
    assert.equal(silentSendCalls, 0, "sufficient allowance after lock recovery must not use silent transaction send");
    assert.equal(nativeGasChecks, 0, "sufficient allowance after lock recovery must not run approval gas checks");
    assert.equal(prepared.singleAmountRaw, enoughLinea);
  }

  await runWalletModelTests();
  runReadModelTests();

  runRewardScannerTests();
  runLiveStateApiTests();
  runIndexerNormalizationTests();
  const jackpotsServiceSource = readFileSync("app/api/_lib/jackpotsService.ts", "utf8");
  const jackpotsRouteSource = readFileSync("app/api/jackpots/route.ts", "utf8");
  assert.match(
    jackpotsServiceSource,
    /JACKPOT_LOG_SCAN_CHUNK = 10_000n[\s\S]*JACKPOT_BOOTSTRAP_SCAN_CHUNK = 10_000n/,
    "jackpot RPC scans must stay within the Linea public RPC 10k-block range limit",
  );
  assert.match(
    jackpotsServiceSource,
    /message\.includes\("range"\) && message\.includes\("exceeds limit"\)/,
    "jackpot RPC scans must recognize provider block-range limit errors",
  );
  assert.match(
    jackpotsServiceSource,
    /function parseStoredBlockNumber/,
    "jackpot service must parse stored block numbers safely",
  );
  assert.match(
    jackpotsServiceSource,
    /function normalizeJackpotTxHash\(txHash: string \| null \| undefined\)[\s\S]*\/\^0x\[0-9a-f\]\{64\}\$\/\.test\(normalized\)[\s\S]*txHash: normalizeJackpotTxHash\(log\.transactionHash\)[\s\S]*txHash: normalizeJackpotTxHash\(row\.txHash\)/,
    "jackpot service must only publish full 32-byte transaction hashes",
  );
  assert.doesNotMatch(
    jackpotsServiceSource,
    /txHash:\s*(?:log\.transactionHash|onchain\?\.txHash|String\(row\.txHash)/,
    "jackpot service must not publish raw chain or stored txHash values",
  );
  assert.match(
    jackpotsServiceSource,
    /formatLineaWeiDisplayNumber[\s\S]*function toDisplayNumberWei\(value: bigint\)[\s\S]*return formatLineaWeiDisplayNumber\(value\)/,
    "jackpot service amountNum compatibility fields must derive from bounded raw-wei formatting",
  );
  assert.match(
    jackpotsServiceSource,
    /function parseChainUintEpochNumber\(value: unknown\)[\s\S]*typeof value !== "bigint"[\s\S]*value > BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*const lastDailyEpoch = parseChainUintEpochNumber\(info\[4\]\)[\s\S]*const lastWeeklyEpoch = parseChainUintEpochNumber\(info\[5\]\)[\s\S]*lastDailyEpoch !== null[\s\S]*fetchJackpotEventByEpoch\("daily", lastDailyEpoch, context, budget\)[\s\S]*lastWeeklyEpoch !== null[\s\S]*fetchJackpotEventByEpoch\("weekly", lastWeeklyEpoch, context, budget\)/,
    "jackpot service must safely narrow chain uint256 jackpot epochs before recovery lookups",
  );
  assert.doesNotMatch(
    jackpotsServiceSource,
    /(^|[^A-Za-z0-9_])Number\(info\[[45]\]\)/,
    "jackpot service must not broadly coerce chain uint256 jackpot epochs",
  );
  assert.match(
    jackpotsServiceSource,
    /function toSafeBlockTimestampMs\(value: bigint\)[\s\S]*Math\.floor\(Number\.MAX_SAFE_INTEGER \/ 1000\)[\s\S]*return Number\(value\) \* 1000[\s\S]*const value = toSafeBlockTimestampMs\(block\.timestamp\)/,
    "jackpot service must safely narrow chain block timestamps before millisecond conversion",
  );
  assert.doesNotMatch(
    jackpotsServiceSource,
    /amountNum:\s*(?:Number\.)?parseFloat\(formatUnits\(|amountNum:\s*parseFloat\(formatUnits\(/,
    "jackpot service must not derive amountNum through parseFloat(formatUnits())",
  );
  assert.doesNotMatch(
    jackpotsServiceSource,
    /Number\(formatLineaAmountFixed\(value, 6\)\)/,
    "jackpot service amountNum compatibility fields must not parse formatted decimal strings",
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
  assert.match(
    jackpotsServiceSource,
    /if \(seedJackpots\.length === 0\)[\s\S]*commitJackpotResponseCache\(\{ jackpots: \[\] \}[\s\S]*maybeStartJackpotRecovery\(\[\]\)[\s\S]*return \{ payload, source: "rebuilt" \}/,
    "empty jackpot storage must return immediately and recover in the background",
  );
  assert.doesNotMatch(
    jackpotsServiceSource,
    /await buildJackpotsPayload\(\{[\s\S]{0,180}seedJackpots: \[\]/,
    "empty jackpot storage must not block the HTTP request on historical RPC recovery",
  );
  assert.match(
    jackpotsServiceSource,
    /jackpotBlockTimestampCache\.size > MAX_JACKPOT_EVENT_CACHE_ENTRIES/,
    "jackpot block timestamp cache must stay bounded",
  );
  const walletDeepScanPanelSource = readFileSync("app/components/wallet/WalletSettingsDeepScanPanel.tsx", "utf8");
  assert.match(
    walletDeepScanPanelSource,
    /formatLineaWeiAmountDisplay/,
    "deep reward scan rows must use the shared safe wei amount formatter",
  );
  assert.match(
    walletDeepScanPanelSource,
    /Recovery scan for older rewards[\s\S]*bounded batches[\s\S]*Start Recovery Scan/,
    "deep reward scan copy must frame the tool as bounded recovery instead of a routine full-history action",
  );
  assert.match(
    walletDeepScanPanelSource,
    /deepScanScanning \?[\s\S]*role="status"[\s\S]*aria-live="polite"[\s\S]*aria-busy="true"[\s\S]*aria-hidden="true"[\s\S]*\{deepScanProgress\}/,
    "deep reward scan progress must be announced as a polite busy status with decorative spinner hidden",
  );
  assert.match(
    walletDeepScanPanelSource,
    /deepScanWins !== null \?[\s\S]*role="status"[\s\S]*aria-live="polite"[\s\S]*aria-hidden="true"[\s\S]*All rewards claimed/,
    "deep reward scan completed-empty state must be announced without changing scan-again behavior",
  );
  assert.doesNotMatch(
    walletDeepScanPanelSource,
    /Scans ALL epochs|Start Full Scan/,
    "deep reward scan copy must not overpromise an all-history scan in the normal wallet settings UI",
  );
  assert.equal(
    safetyPoolClaimThreshold.parseMinSafetyPoolClaimWei("-1").toString(),
    safetyPoolClaimThreshold.parseMinSafetyPoolClaimWei(null).toString(),
    "Safety Pool claim minimum must reject negative env values and keep the dust warning active",
  );
  assert.equal(
    safetyPoolClaimThreshold.parseMinSafetyPoolClaimWei("0").toString(),
    safetyPoolClaimThreshold.parseMinSafetyPoolClaimWei(null).toString(),
    "Safety Pool claim minimum must reject zero env values and keep the dust warning active",
  );
  assert.equal(
    safetyPoolClaimThreshold.formatSafetyPoolClaimMinimum(safetyPoolClaimThreshold.parseMinSafetyPoolClaimWei("12.5")),
    "12.5",
    "Safety Pool claim minimum must keep valid positive configured amounts",
  );
  const rebateSource = readFileSync("app/hooks/useRebate.ts", "utf8");
  assert.match(
    rebateSource,
    /getExplorerTxUrl/,
    "Safety Pool claim notifications must include an explorer link when a tx hash is available",
  );
  assert.match(
    rebateSource,
    /function normalizeNonNegativeSafeInteger[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*\/\^\(\?:0\|\[1-9\]\\d\*\)\$\/\.test\(text\)[\s\S]*BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function normalizeNumberArray[\s\S]*\.map\(normalizeNonNegativeSafeInteger\)[\s\S]*normalizeRecentEpoch[\s\S]*normalizeNonNegativeSafeInteger\(data\.epoch\)[\s\S]*claimableEpochCount: normalizeNonNegativeSafeInteger\(data\.claimableEpochCount\) \?\? 0[\s\S]*totalEpochs: normalizeNonNegativeSafeInteger\(data\.totalEpochs\) \?\? 0[\s\S]*nextCursor = normalizeNonNegativeSafeInteger\(data\.nextCursor\)/,
    "Safety Pool client must canonical-parse epoch, count, and cursor evidence from API and cache payloads",
  );
  assert.match(
    rebateSource,
    /function parseClaimableEpoch\(value: bigint \| undefined\)[\s\S]*value <= 0n \|\| value > BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*const epochNumber = parseClaimableEpoch\(chunk\[index\]\)[\s\S]*const epochNumber = parseClaimableEpoch\(epoch\)[\s\S]*epoch: parseClaimableEpoch\(epoch\) \?\? "invalid"/,
    "Safety Pool client must safely narrow exact claimable epoch bigint evidence",
  );
  assert.doesNotMatch(
    rebateSource,
    /Number\.isInteger\(item\)|\.map\(\(item\) => Number\(item\)\)|const epoch = Number\(data\.epoch\)|Math\.max\(0, Number\(data\.(?:claimableEpochCount|totalEpochs)\)|const nextCursor = Number\(data\.nextCursor\)|claimable\.add\(Number\(|epoch: Number\(epoch\)/,
    "Safety Pool client must not use broad number coercion for epoch, count, or cursor evidence",
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
  assert.match(
    rebateSource,
    /const cachedDelay = getFreshCacheDelayMs\(savedAt, REBATE_CLIENT_CACHE_TTL_MS\) \?\? 0/,
    "Safety Pool cache refresh delay must use the shared strict timestamp helper",
  );
  assert.match(
    rebateSource,
    /cachedPlan && getFreshCacheDelayMs\(cachedPlan\.savedAt, CLAIM_PLAN_CACHE_TTL_MS\) !== null/,
    "Safety Pool claim-plan cache acceptance must use the shared strict timestamp helper",
  );
  assert.doesNotMatch(
    rebateSource,
    /Date\.now\(\) - savedAt < REBATE_CLIENT_CACHE_TTL_MS|REBATE_CLIENT_CACHE_TTL_MS - \(Date\.now\(\) - savedAt\)|Date\.now\(\) - cachedPlan\.savedAt < CLAIM_PLAN_CACHE_TTL_MS/,
    "Safety Pool cache refresh and claim-plan cache must not use broad savedAt age arithmetic",
  );
  assert.match(
    rebateSource,
    /activeRebateAddressRef\.current === rebateAddress[\s\S]*cacheSavedAtRef\.current = null;[\s\S]*resetState\(\)/,
    "Safety Pool must clear prior-wallet state and cache timing when the active wallet changes",
  );
  assert.match(
    rebateSource,
    /const resetState = useCallback[\s\S]*requestIdRef\.current \+= 1/,
    "Safety Pool reset must invalidate in-flight responses from the previous wallet",
  );
  assert.match(
    rebateSource,
    /isAmbiguousPendingTxError\(err\) \|\| isUserRejection\(err\)/,
    "Safety Pool batch fallback must not prompt again after a user rejection or ambiguous submission",
  );
  assert.match(
    rebateSource,
    /await submitClaimBatch\(batch\);\s*claimedEpochCount \+= batch\.length;[\s\S]*await submitSingleClaim\(batch\[0\]\);\s*claimedEpochCount \+= 1;[\s\S]*await claimBatches\(/,
    "Safety Pool split claims must preserve partial success counts before a later wallet rejection or ambiguous submission",
  );
  assert.match(
    rebateSource,
    /const formatRebateError = useCallback[\s\S]*claim status is unknown[\s\S]*claim reverted on-chain[\s\S]*wallet provider[\s\S]*Refresh the Safety Pool tab/,
    "Safety Pool claim failures must classify provider errors without surfacing raw RPC messages",
  );
  assert.doesNotMatch(
    rebateSource,
    /return msg;/,
    "Safety Pool claim failures must not return raw provider or RPC messages to users",
  );
  assert.match(
    rebateSource,
    /createClaimConfirmationPendingError[\s\S]*error\.name = "TransactionReceiptTimeoutError"/,
    "Safety Pool confirmation timeout must use the shared ambiguous-pending classification",
  );
  assert.match(
    rebateSource,
    /const confirmClaimBatch = useCallback[\s\S]*getTransactionReceipt\(\{ hash \}\)[\s\S]*if \(receipt\.status !== "success"\) \{[\s\S]*throw new Error\(`Transaction reverted: \$\{hash\}`\);/,
    "Safety Pool confirmation must surface reverted receipts before ambiguous-pending fallback",
  );
  assert.match(
    rebateSource,
    /if \(message\.startsWith\("transaction reverted:"\)\) throw err;/,
    "Safety Pool reverted receipts must be rethrown instead of converted to ambiguous pending",
  );
  assert.match(
    rebateSource,
    /let remainingEpochs: number\[\];[\s\S]*loadClaimableEpochsExact[\s\S]*createClaimConfirmationPendingError/,
    "Safety Pool post-send state reads must fail as ambiguous pending rather than trigger a duplicate fallback",
  );
  assert.match(
    rebateSource,
    /if \(claimInFlightRef\.current\) return;[\s\S]*claimInFlightRef\.current = true;[\s\S]*finally \{[\s\S]*claimInFlightRef\.current = false;/,
    "Safety Pool claim must synchronously reject duplicate starts before React updates the loading state",
  );
  assert.match(
    rebateSource,
    /const submitClaimBatch[\s\S]*simulateContract\(\{[\s\S]*functionName: "claimEpochsRebate"[\s\S]*estimateClaimGas[\s\S]*silentSend/,
    "Safety Pool batch claims must simulate before gas fallback or wallet submission",
  );
  assert.match(
    rebateSource,
    /const submitSingleClaim[\s\S]*simulateContract\(\{[\s\S]*functionName: "claimEpochRebate"[\s\S]*estimateSingleClaimGas[\s\S]*silentSend/,
    "Safety Pool single-epoch fallback must simulate before gas fallback or wallet submission",
  );
  assert.match(
    rebateSource,
    /latestRebateAddressRef\.current = rebateAddress\?\.toLowerCase\(\) \?\? null[\s\S]*const claimActor = rebateAddress\.toLowerCase\(\)[\s\S]*assertClaimActorActive[\s\S]*err === claimActorChangedError/,
    "Safety Pool claims must stop split sends and stale refreshes when the active wallet changes",
  );
  assert.match(
    rebateSource,
    /isAmbiguousPendingTxError\(err\)[\s\S]*claim submission status is ambiguous; fallback suppressed[\s\S]*formatRebateTxMessage\([\s\S]*Safety Pool claim may already be pending\. Check wallet activity and refresh Safety Pool before retrying\.[\s\S]*lastClaimTxHash[\s\S]*isUserRejection\(err\)[\s\S]*Claimed Safety Pool payouts for \$\{claimedEpochCount\} epochs in \$\{claimTxCount\} transaction[\s\S]*Safety Pool claim rejected in wallet\./,
    "Safety Pool claims must surface ambiguous pending with tx links, partial-success rejection, and plain wallet rejection explicitly",
  );
  assert.match(
    rebateSource,
    /Claimed Safety Pool payouts for \$\{claimedEpochCount\} epochs in \$\{claimTxCount\} transaction[\s\S]*some epochs still failed: \$\{message\}/,
    "Safety Pool split claims must preserve partial success counts when later epochs fail",
  );
  const rebatePanelSource = readFileSync("app/components/RebatePanel.tsx", "utf8");
  assert.match(
    rebatePanelSource,
    /formatDecimalTextFixed\(String\(value \?\? ""\)\.trim\(\), 4\) \?\? "0\.0000"/,
    "Safety Pool amount display must use canonical decimal-text formatting",
  );
  assert.doesNotMatch(
    rebatePanelSource,
    /Number\.parseFloat\(String\(value \?\? ""\)\)[\s\S]*\.toFixed\(4\)/,
    "Safety Pool amount display must not round through broad parseFloat().toFixed()",
  );
  assert.match(
    rebatePanelSource,
    /data-testid="rebate-freshness-hint"/,
    "Safety Pool panel must show a stable visible freshness hint when serving stale data",
  );
  assert.match(
    rebatePanelSource,
    /claimDisabledReason[\s\S]*aria-describedby=\{claimDisabledReason \? "rebate-claim-disabled-reason" : undefined\}[\s\S]*id="rebate-claim-disabled-reason"/,
    "Safety Pool claim button must expose the reason when claiming is disabled",
  );
  assert.match(
    rebatePanelSource,
    /claimActionLabel[\s\S]*aria-label=\{claimActionLabel\}[\s\S]*title=\{claimActionLabel\}/,
    "Safety Pool claim button must keep an explicit accessible action label",
  );
  assert.match(
    rebatePanelSource,
    /role="status"[\s\S]*aria-live="polite"[\s\S]*aria-busy="true"[\s\S]*Loading Safety Pool ledger/,
    "Safety Pool initial loading state must be announced as a polite busy status",
  );
  assert.match(
    rebatePanelSource,
    /role="status"[\s\S]*aria-live="polite"[\s\S]*Refreshing Safety Pool ledger in background/,
    "Safety Pool background refresh must remain announced without changing visible copy",
  );
  const rebatesRouteSource = readFileSync("app/api/rebates/route.ts", "utf8");
  const rebateHistoryRouteSource = readFileSync("app/api/rebate-history/route.ts", "utf8");
  assert.match(
    rebatesRouteSource,
    /isSafePositiveInteger/,
    "rebates API must use safe epoch validation for indexed and chain epochs",
  );
  assert.match(
    rebatesRouteSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function bigintToNonNegativeSafeNumber\(value: bigint\)[\s\S]*value > MAX_SAFE_INTEGER_BIGINT[\s\S]*summaryClaimableCount \+= bigintToNonNegativeSafeNumber\(claimableCount\)/,
    "rebates API must bound chain claimable-count evidence before publishing summary counts",
  );
  assert.match(
    rebatesRouteSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseRebateEpochNumber\(value: bigint\)[\s\S]*value <= 0n \|\| value > MAX_SAFE_INTEGER_BIGINT[\s\S]*const epochNumber = parseRebateEpochNumber\(chunk\[index\]\)[\s\S]*const epochNumber = parseRebateEpochNumber\(epoch\)[\s\S]*const epoch = parseRebateEpochNumber\(recentEpochBigInts\[index\]\)/,
    "rebates API must safely narrow exact claimable and recent rebate epoch bigint evidence",
  );
  assert.doesNotMatch(
    rebatesRouteSource,
    /(^|[^A-Za-z0-9_])Number\(claimableCount\)|(^|[^A-Za-z0-9_])Number\(recentEpochBigInts\[index\]\)|(^|[^A-Za-z0-9_])Number\(chunk\[index\]\)|const epochNumber = Number\(epoch\)/,
    "rebates API must not broadly coerce chain rebate counts or epoch evidence",
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
  assert.match(
    rebatesRouteSource,
    /function normalizeRebateTimingMs\(value: number\)[\s\S]*Number\.isFinite\(value\)[\s\S]*REBATE_TIMING_MAX_MS[\s\S]*function formatRebateTimingMs\(value: number\)[\s\S]*normalizeRebateTimingMs\(value\)\.toFixed\(1\)[\s\S]*function formatRebateTimingLogValue\(value: number\)[\s\S]*formatRebateTimingMs\(value\)/,
    "rebates API timing output must bound slow-build metrics before formatting Server-Timing or logs",
  );
  assert.match(
    rebatesRouteSource,
    /indexed;dur=\$\{formatRebateTimingMs\(timings\.indexedMs\)\}[\s\S]*summary;dur=\$\{formatRebateTimingMs\(timings\.summaryMs\)\}[\s\S]*exact;dur=\$\{formatRebateTimingMs\(timings\.exactMs\)\}[\s\S]*recent;dur=\$\{formatRebateTimingMs\(timings\.recentMs\)\}[\s\S]*total;dur=\$\{formatRebateTimingMs\(timings\.totalMs\)\}[\s\S]*indexedMs: formatRebateTimingLogValue\(timings\.indexedMs\)[\s\S]*totalMs: formatRebateTimingLogValue\(timings\.totalMs\)/,
    "rebates API must route every published timing field through the bounded formatter",
  );
  assert.doesNotMatch(
    rebatesRouteSource,
    /timings\.(?:indexedMs|summaryMs|exactMs|recentMs|totalMs)\.toFixed\(1\)|Number\(timings\.(?:indexedMs|summaryMs|exactMs|recentMs|totalMs)\.toFixed\(1\)\)/,
    "rebates API must not format raw timing fields directly",
  );
  assert.match(
    rebatesRouteSource,
    /bucket: "api-rebates-exact"[\s\S]*limit: 6/,
    "expensive exact rebate scans must have a stricter rate limit",
  );
  assert.match(
    rebatesRouteSource,
    /bucket: "api-rebates"[\s\S]*if \(rateLimited\) return applyNoStoreHeaders\(rateLimited\)[\s\S]*bucket: "api-rebates-exact"[\s\S]*if \(exactRateLimited\) return applyNoStoreHeaders\(exactRateLimited\)/,
    "Safety Pool rebate rate-limit responses must remain no-store on both normal and exact-scan paths",
  );
  assert.doesNotMatch(depositsRouteSource, /deposits: \[\], error: message/);
  assert.doesNotMatch(rebatesRouteSource, /error: message/);
  assert.match(
    rebateHistoryRouteSource,
    /MAX_PAGE_SIZE = 64[\s\S]*allowFailure: false/,
    "older Safety Pool history must stay bounded and fail the whole page instead of skipping unread epochs",
  );
  assert.match(
    rebatePanelSource,
    /Load older epochs/,
    "Safety Pool must expose explicit on-demand older history instead of background historical polling",
  );
  assert.match(
    smokeHttpSource,
    /name: "rebate-history"[\s\S]*\/api\/rebate-history\?user=/,
    "HTTP smoke must cover the paginated Safety Pool history route",
  );
  assert.doesNotMatch(jackpotsRouteSource, /error: message/);
  const liveRoundCanarySource = readFileSync("scripts/live-round-canary.ts", "utf8");
  const keeperBotSource = readFileSync("bot.ts", "utf8");
  const botSupervisorSource = readFileSync("scripts/run-bot-forever.mjs", "utf8");
  const soakSupervisorSource = readFileSync("scripts/run-testnet-soak-supervisor.mjs", "utf8");
  const clearPendingNonceSource = readFileSync("scripts/clear-live-test-pending-nonce.ts", "utf8");
  const chatSessionSource = readFileSync("app/api/_lib/chatSession.ts", "utf8");
  const cleanupNextCandidatesSource = readFileSync("scripts/cleanup-next-candidates.mjs", "utf8");
  const collectIndexerEvidenceSource = readFileSync("scripts/collect-indexer-evidence.mjs", "utf8");
  const createIndexerDraftSource = readFileSync("scripts/create-indexer-proof-draft.mjs", "utf8");
  const checkIndexerDryRunSource = readFileSync("scripts/check-indexer-dry-run.mjs", "utf8");
  const sqliteScopeAuditSource = readFileSync("scripts/sqlite-scope-audit-lib.mjs", "utf8");
  const sqliteScopeAudit = sqliteScopeAuditModule.default ?? sqliteScopeAuditModule;
  assert.equal(sqliteScopeAudit.normalizeSqliteCount(3), 3);
  assert.equal(sqliteScopeAudit.normalizeSqliteCount(3n), 3);
  assert.equal(sqliteScopeAudit.normalizeSqliteCount("3"), 3);
  assert.throws(() => sqliteScopeAudit.normalizeSqliteCount(-1));
  assert.throws(() => sqliteScopeAudit.normalizeSqliteCount(1.5));
  assert.throws(() => sqliteScopeAudit.normalizeSqliteCount("1e3"));
  assert.throws(() => sqliteScopeAudit.normalizeSqliteCount("01"));
  assert.throws(() => sqliteScopeAudit.normalizeSqliteCount(BigInt(Number.MAX_SAFE_INTEGER) + 1n));
  for (const [label, source] of [
    ["collect-indexer-evidence", collectIndexerEvidenceSource],
    ["create-indexer-proof-draft", createIndexerDraftSource],
  ]) {
    assert.match(
      source,
      /const requestedEpochs = parseInteger\(epochs\)[\s\S]*requestedEpochs !== null && requestedEpochs > 0[\s\S]*uniqueCheckedEpochs\.length >= requestedEpochs/,
      `${label} must reuse canonical parsed --epochs for chain-snapshot coverage checks`,
    );
    assert.doesNotMatch(
      source,
      /Number\(epochs\)/,
      `${label} must not broadly coerce --epochs after validation`,
    );
  }
  assert.match(
    collectIndexerEvidenceSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseInteger\(value\)[\s\S]*CANONICAL_NON_NEGATIVE_INTEGER_RE\.test\(text\)[\s\S]*const parsed = BigInt\(text\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*requestedEpochs,/,
    "indexer evidence collector must publish the same canonical parsed epoch count it validates",
  );
  assert.match(
    liveRoundCanarySource,
    /APP_NETWORK !== "sepolia" \|\| APP_CHAIN\.id !== 59141/,
    "live canary must fail closed outside Linea Sepolia before transaction-capable setup",
  );
  assert.match(
    liveRoundCanarySource,
    /function assertOptionalEnvFile\(path: string, description: string\)[\s\S]*existsSync\(path\) && !statSync\(path\)\.isFile\(\)[\s\S]*function loadSigningEnvFileIfPresent\(\)[\s\S]*assertOptionalEnvFile\(LIVE_WALLET_ENV_PATH[\s\S]*loadDotenv\(\{ path: LIVE_WALLET_ENV_PATH, override: false, quiet: true \}\)[\s\S]*function loadWallets\(\)[\s\S]*loadSigningEnvFileIfPresent\(\)/,
    "live canary must reject a non-file secret wallet env path before deferred dotenv loading",
  );
  assert.doesNotMatch(
    liveRoundCanarySource,
    /console\.error\("\[live-canary\] failed", error\)/,
    "live canary fatal handler must not print raw errors",
  );
  assert.match(
    liveRoundCanarySource,
    /MAX_HEALTH_SAMPLE_RESPONSE_BYTES[\s\S]*CONTENT_LENGTH_RE[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function readBoundedHealthJson[\s\S]*parseContentLengthHeader\(response\.headers\.get\("content-length"\)\)[\s\S]*new TextDecoder\("utf-8", \{ fatal: true \}\)[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)/,
    "live canary health sampling must strictly parse and bound health response bodies before JSON parsing",
  );
  assert.doesNotMatch(
    liveRoundCanarySource,
    /Number\(response\.headers\.get\("content-length"\)\)/,
    "live canary health sampling must not broadly coerce content-length headers",
  );
  assert.doesNotMatch(
    liveRoundCanarySource,
    /response\.json\(\)|runtimeResponse\.json\(\)|dataSyncResponse\.json\(\)/,
    "live canary health sampling must not use unbounded response.json",
  );
  assert.match(
    keeperBotSource,
    /function describeKeeperError[\s\S]*sanitizeSentryPayload[\s\S]*console\.error\("\[keeper\] Fatal startup error:", describeKeeperError\(err\)\)/,
    "keeper logs must sanitize provider and alert transport errors before output",
  );
  assert.match(
    keeperBotSource,
    /MAX_ALERT_RESPONSE_BYTES\s*=\s*64\s*\*\s*1024[\s\S]*ALERT_CONTENT_LENGTH_RE\s*=\s*\/\^\(\?:0\|\[1-9\]\\d\{0,15\}\)\$\/[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*async function readBoundedAlertResponseText\(response: Response\)[\s\S]*parseAlertContentLengthHeader\(response\.headers\.get\("content-length"\)\)[\s\S]*new TextDecoder\("utf-8", \{ fatal: true \}\)[\s\S]*reader\.cancel[\s\S]*function parseAlertContentLengthHeader\(value: string \| null\)[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)/,
    "keeper Telegram alert failures must bound response body reads before logging transport errors",
  );
  assert.doesNotMatch(
    keeperBotSource,
    /Number\(response\.headers\.get\("content-length"\)\)/,
    "keeper Telegram alert failures must not broadly coerce content-length headers",
  );
  assert.doesNotMatch(
    keeperBotSource,
    /res\.text\(\)/,
    "keeper Telegram alert failures must not use unbounded response.text",
  );
  assert.match(
    botSupervisorSource,
    /function describeSupervisorError[\s\S]*SECRET_PATTERNS[\s\S]*failed to send alert: \$\{describeSupervisorError\(err\)\}/,
    "bot supervisor alert errors must be redacted before terminal output",
  );
  assert.match(
    botSupervisorSource,
    /process error: \$\{describeSupervisorError\(error\)\}/,
    "bot supervisor process errors must be redacted before terminal output",
  );
  assert.match(
    soakSupervisorSource,
    /import \{ redactProofText \} from "\.\/redact-proof-output\.mjs"[\s\S]*function describeSupervisorError\(error\)[\s\S]*redactProofText\(/,
    "testnet soak supervisor terminal errors must use the shared proof redactor",
  );
  assert.match(
    soakSupervisorSource,
    /status failed: \$\{describeSupervisorError\(error\)\}[\s\S]*stop failed: \$\{describeSupervisorError\(error\)\}[\s\S]*const message = describeSupervisorError\(error\)/,
    "testnet soak supervisor status, stop, and fatal errors must be compact and redacted",
  );
  assert.match(
    clearPendingNonceSource,
    /sanitizeSupportLogPayload\(\{ message \}\)/,
    "pending nonce recovery must sanitize fatal error text",
  );
  assert.match(
    clearPendingNonceSource,
    /PUBLIC_ADDRESS_ENV_NAME_RE[\s\S]*function loadPublicAddressEnvFileIfPresent\(\)[\s\S]*processEnv: isolatedEnv[\s\S]*!PUBLIC_ADDRESS_ENV_NAME_RE\.test\(name\)[\s\S]*function loadSigningEnvFileIfPresent\(\)[\s\S]*loadDotenv\(\{ path: LIVE_WALLET_ENV_PATH, override: false, quiet: true \}\)/,
    "pending nonce recovery must isolate and allowlist public addresses before any optional signing env load",
  );
  assert.match(
    clearPendingNonceSource,
    /Missing LORE_LIVE_TEST_\$\{ROLE\}_ADDRESS in \$\{PUBLIC_ADDRESS_ENV_PATH\}/,
    "pending nonce recovery dry-run must point missing-address operators at the public address env file",
  );
  assert.match(
    clearPendingNonceSource,
    /EXECUTION_CONFIRMATION = "--confirm-lowest-pending-nonce-replacement"[\s\S]*EXECUTE && !EXECUTION_CONFIRMED/,
    "pending nonce recovery must require a separate explicit confirmation before loading a signing account",
  );
  assert.match(
    clearPendingNonceSource,
    /const publicAddressEnv = loadPublicAddressEnvFileIfPresent\(\)[\s\S]*const signingMaterialLoaded = hasSigningMaterialInEnvironment\(\)[\s\S]*const address = getDryRunAddress\(publicAddressEnv\)[\s\S]*readNonceState\(publicClient, address\)[\s\S]*if \(state\.gap === 0\) return;[\s\S]*const account = getAccount\(\)/,
    "pending nonce recovery must verify the public nonce gap before loading signing material",
  );
  assert.match(
    clearPendingNonceSource,
    /account\.address !== address[\s\S]*Configured recovery signer does not match the public role address/,
    "pending nonce recovery must refuse mismatched signer and public role address",
  );
  assert.match(
    clearPendingNonceSource,
    /!EXECUTE && signingMaterialLoaded[\s\S]*wouldSendReplacement:\s*EXECUTE && state\.gap > 0[\s\S]*operationalBoundary: \{[\s\S]*dryRunDefault: !EXECUTE[\s\S]*signingMaterialLoaded,[\s\S]*walletClientCreated: false[\s\S]*contractWriteSubmitted: false[\s\S]*transactionSent: false[\s\S]*value: 0n,[\s\S]*nonce: state\.latest,[\s\S]*gas: 21_000n/,
    "pending nonce recovery must remain a bounded zero-value replacement of the lowest pending nonce",
  );
  assert.doesNotMatch(
    clearPendingNonceSource,
    /console\.log\(JSON\.stringify\(\{[\s\S]{0,180}\b(?:address|hash|rpc|url)\b/i,
    "pending nonce recovery status output must remain role-level and avoid addresses, tx hashes, and RPC endpoints",
  );
  assert.equal(chatSession.normalizeChatSessionExpiresAt(120_000, 100_000), 120_000);
  assert.equal(chatSession.normalizeChatSessionExpiresAt("120000", 100_000), null);
  assert.equal(chatSession.normalizeChatSessionExpiresAt(120_000.5, 100_000), null);
  assert.equal(chatSession.normalizeChatSessionExpiresAt(Number.MAX_SAFE_INTEGER + 1, 100_000), null);
  assert.equal(chatSession.normalizeChatSessionExpiresAt(99_999, 100_000), null);
  assert.equal(chatSession.normalizeChatSessionExpiresAt(100_000 + chatAuth.CHAT_AUTH_SESSION_TTL_MS + 60_001, 100_000), null);
  for (const malformedChatCookie of [
    `${"a".repeat(1025)}.sig`,
    "encoded.sig.extra",
    "encoded.signature!",
  ]) {
    assert.equal(
      withTemporaryEnv({ NODE_ENV: "production", CHAT_AUTH_SECRET: undefined, NEXTAUTH_SECRET: undefined }, () =>
        chatSession.readChatSession({ cookies: { get: () => ({ value: malformedChatCookie }) } }),
      ),
      null,
      "malformed chat session cookies must fail before production secret/HMAC lookup",
    );
  }
  for (const [name, source] of [["chat", chatSessionSource]]) {
    assert.match(source, /randomBytes\(32\)\.toString\("hex"\)/, `${name} development sessions must use an ephemeral secret`);
    assert.doesNotMatch(source, /createHash\(|dev-(admin|chat)-session:/, `${name} development sessions must not derive a predictable secret`);
    assert.match(
      source,
      /function normalize(?:Admin|Chat)SessionExpiresAt\(value: unknown, now = Date\.now\(\)\)[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*Number\.isSafeInteger\(now\)[\s\S]*SESSION_MAX_FUTURE_SKEW_MS[\s\S]*const expiresAt = normalize(?:Admin|Chat)SessionExpiresAt\(parsed\.expiresAt\)/,
      `${name} server session cookies must strictly normalize expiry before accepting a signed payload`,
    );
    assert.match(
      source,
      /const SESSION_COOKIE_MAX_LENGTH = 1024[\s\S]*const SESSION_COOKIE_PART_RE = \/\^\[A-Za-z0-9_-\]\+\$\/[\s\S]*function parseSessionCookie[\s\S]*raw\.length > SESSION_COOKIE_MAX_LENGTH[\s\S]*raw\.indexOf\("\.", dotIndex \+ 1\) !== -1[\s\S]*SESSION_COOKIE_PART_RE\.test\(encoded\)[\s\S]*SESSION_COOKIE_PART_RE\.test\(signature\)/,
      `${name} server session cookies must reject oversized, malformed, or suffixed signed tokens before HMAC verification`,
    );
    assert.match(
      source,
      /const cookie = parseSessionCookie\(raw\)[\s\S]*if \(!cookie\) return null[\s\S]*const \[encoded, signature\] = cookie[\s\S]*const expected = sign\(encoded\)/,
      `${name} server session cookie parsing must run before signed-token verification`,
    );
    assert.doesNotMatch(
      source,
      /typeof parsed\.expiresAt !== "number"[\s\S]*expiresAt: parsed\.expiresAt|raw\.split\("\.", 2\)/,
      `${name} server session cookies must not broadly accept raw numeric expiry values or suffixed signed tokens`,
    );
  }
  assert.match(
    collectIndexerEvidenceSource,
    /function normalizeRpcSource\(value\)[\s\S]*!parsed\.username && !parsed\.password && !parsed\.search && !parsed\.hash[\s\S]*rpcSource must be a redacted label or origin-only URL/,
    "indexer evidence collector must reject credentialed or path-sensitive RPC source URLs",
  );
  assert.match(
    collectIndexerEvidenceSource,
    /MAX_INDEXER_EVIDENCE_BYTES = 512 \* 1024[\s\S]*function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stat\.isFile\(\) \? stat : null[\s\S]*function readOptionalLog\(name, filePath\)[\s\S]*const stat = regularFileStat\(resolved\)[\s\S]*if \(!stat\)[\s\S]*stat\.size > MAX_INDEXER_EVIDENCE_BYTES[\s\S]*artifact is too large to validate safely[\s\S]*readFileSync\(resolved, "utf8"\)/,
    "indexer evidence collector must reject directory and oversized log artifacts before reading them",
  );
  assert.match(
    collectIndexerEvidenceSource,
    /function readOptionalJson\(name, filePath\)[\s\S]*const stat = regularFileStat\(resolved\)[\s\S]*if \(!stat\)[\s\S]*stat\.size > MAX_INDEXER_EVIDENCE_BYTES[\s\S]*JSON artifact is too large to validate safely[\s\S]*--\$\{name\} must be valid JSON[\s\S]*--\$\{name\} must be a JSON object artifact/,
    "indexer evidence collector must reject directory and oversized JSON artifacts before parsing them",
  );
  assert.match(
    collectIndexerEvidenceSource,
    /function requireDistinctArtifactInputs\(entries\)[\s\S]*--\$\{leftName\} and --\$\{rightName\} must point to distinct indexer evidence files/,
    "indexer evidence collector must reject one artifact reused across indexer evidence inputs",
  );
  assert.match(
    collectIndexerEvidenceSource,
    /CANONICAL_NON_NEGATIVE_INTEGER_RE[\s\S]*CANONICAL_POSITIVE_INTEGER_RE[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function isCanonicalNonNegativeInteger[\s\S]*function parseInteger[\s\S]*const parsed = BigInt\(text\)[\s\S]*function isCanonicalPositiveInteger/,
    "indexer evidence collector must define canonical integer parsers",
  );
  assert.match(
    collectIndexerEvidenceSource,
    /function requireMatchingChainId[\s\S]*canonical positive decimal integer[\s\S]*must match \$\{expected\}/,
    "indexer evidence collector must strictly parse chain snapshot chain IDs before writing drafts",
  );
  assert.match(
    collectIndexerEvidenceSource,
    /function isCanonicalNonNegativeInteger\(value\)[\s\S]*parseInteger\(value\) !== null[\s\S]*function parseInteger\(value\)[\s\S]*const parsed = BigInt\(text\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*finalityLagIsNumeric = isCanonicalNonNegativeInteger\(healthValues\.finalityLagBlocks\)[\s\S]*canonical non-negative decimal finalityLagBlocks=<number>/,
    "indexer evidence collector must BigInt-bound finality lag evidence before writing drafts",
  );
  assert.match(
    createIndexerDraftSource,
    /MAX_INDEXER_EVIDENCE_BYTES = 512 \* 1024[\s\S]*function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stat\.isFile\(\) \? stat : null[\s\S]*function readRequiredLog\(name, filePath\)[\s\S]*const stat = regularFileStat\(resolved\)[\s\S]*stat\.size > MAX_INDEXER_EVIDENCE_BYTES[\s\S]*artifact is too large to validate safely[\s\S]*function readRequiredJson\(name, filePath\)[\s\S]*const stat = regularFileStat\(resolved\)[\s\S]*stat\.size > MAX_INDEXER_EVIDENCE_BYTES[\s\S]*JSON artifact is too large to validate safely[\s\S]*--\$\{name\} must be valid JSON[\s\S]*--\$\{name\} must be a JSON object artifact/,
    "indexer proof draft generation must reject directory and oversized artifacts before reading or parsing them",
  );
  assert.match(
    createIndexerDraftSource,
    /function requireDistinctArtifactInputs\(entries\)[\s\S]*--\$\{leftName\} and --\$\{rightName\} must point to distinct indexer evidence files/,
    "indexer proof draft generation must reject one artifact reused across indexer evidence inputs",
  );
  assert.match(
    createIndexerDraftSource,
    /function normalizeRpcSource\(value\)[\s\S]*!parsed\.username && !parsed\.password && !parsed\.search && !parsed\.hash[\s\S]*rpcSource must be a redacted label or origin-only URL[\s\S]*const rpcSource = normalizeRpcSource\(chainSnapshot\?\.rpcSource\) \|\| "TODO"/,
    "indexer proof draft generation must reject credentialed or path-sensitive RPC source URLs before writing drafts",
  );
  assert.match(
    createIndexerDraftSource,
    /CANONICAL_NON_NEGATIVE_INTEGER_RE[\s\S]*CANONICAL_POSITIVE_INTEGER_RE[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseInteger[\s\S]*const parsed = BigInt\(text\)[\s\S]*function isPositiveInteger[\s\S]*function isNonNegativeInteger/,
    "indexer proof draft generation must define canonical integer parsers",
  );
  assert.match(
    createIndexerDraftSource,
    /function requireMatchingChainId[\s\S]*canonical positive decimal integer[\s\S]*must match \$\{expected\}/,
    "indexer proof draft generation must strictly parse chain snapshot chain IDs before writing drafts",
  );
  assert.match(
    createIndexerDraftSource,
    /function parseInteger\(value\)[\s\S]*const parsed = BigInt\(text\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*finalityLagIsNumeric = isNonNegativeInteger\(healthValues\.finalityLagBlocks\)[\s\S]*canonical non-negative decimal finalityLagBlocks=<number>/,
    "indexer proof draft generation must BigInt-bound finality lag evidence before writing drafts",
  );
  for (const [label, source] of [
    ["collect-indexer-evidence", collectIndexerEvidenceSource],
    ["create-indexer-proof-draft", createIndexerDraftSource],
  ]) {
    assert.match(
      source,
      /const MAX_KEY_VALUE_MARKERS = 64[\s\S]*function parseKeyValues\(line = ""\)[\s\S]*pattern\.exec\(line\)[\s\S]*inspected > MAX_KEY_VALUE_MARKERS[\s\S]*too many key\/value markers to validate safely/,
      `${label} must cap key/value parsing before accepting indexer health evidence`,
    );
    assert.doesNotMatch(
      source,
      /line\.matchAll\(/,
      `${label} must not parse indexer health evidence through matchAll`,
    );
  }
  assert.doesNotMatch(
    `${collectIndexerEvidenceSource}\n${createIndexerDraftSource}`,
    /existsSync\(resolved\)|statSync\(resolved\)\.isFile\(\)/,
    "indexer evidence collector and draft generator must not bypass regularFileStat for resolved artifact paths",
  );
  assert.doesNotMatch(
    `${collectIndexerEvidenceSource}\n${createIndexerDraftSource}`,
    /Number\(value\)\s*===\s*Number\(expected\)|Number\(expectedSnapshotChainId\)|Number\(rpcSnapshotChainId\)|Number\.isFinite\(Number\(healthValues\.finalityLagBlocks\)\)/,
    "indexer evidence draft tooling must not use broad numeric fallback for chain IDs or finalityLagBlocks",
  );
  const proofDraftRegressionSourceForIndexer = readFileSync("scripts/check-proof-drafts.mjs", "utf8");
  assert.ok(
    [
      "hostHealthMalformedFinalityLog",
      "hostHealthUnsafeFinalityLog",
      "9999999999999999",
      "host-collector-malformed-finality-lag",
      "host-collector-unsafe-finality-lag",
      "host-draft-malformed-finality-lag",
      "host-draft-unsafe-finality-lag",
      "canonical non-negative decimal finalityLagBlocks=<number>",
    ].every((marker) => proofDraftRegressionSourceForIndexer.includes(marker)),
    "proof draft regressions must cover malformed and unsafe host finalityLagBlocks in collector and draft paths",
  );
  assert.ok(
    [
      "indexerHealthUnsafeFinalityLog",
      "9999999999999999",
      "indexer-unsafe-finality-artifact",
      "indexer-collector-malformed-finality-lag",
      "indexer-collector-unsafe-finality-lag",
      "indexer-collector-malformed-chain-id",
      "indexer-draft-malformed-finality-lag",
      "indexer-draft-unsafe-finality-lag",
      "indexer-draft-malformed-chain-id",
      "canonical non-negative decimal finalityLagBlocks=<number>",
      "canonical positive decimal integer",
    ].every((marker) => proofDraftRegressionSourceForIndexer.includes(marker)),
    "proof draft regressions must cover malformed and unsafe indexer chain IDs and finalityLagBlocks in collector, draft, and strict artifact paths",
  );
  assert.match(
    checkIndexerDryRunSource,
    /!parsed\.username && !parsed\.password && !parsed\.search && !parsed\.hash/,
    "indexer evidence checker must reject credential-bearing or path-sensitive RPC source URLs",
  );
  assert.match(
    checkIndexerDryRunSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseCanonicalNonNegativeInteger\(value\)[\s\S]*CANONICAL_NON_NEGATIVE_INTEGER_RE\.test\(text\)[\s\S]*const parsed = BigInt\(text\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*function parseCanonicalPositiveInteger\(value\)/,
    "indexer proof checker must BigInt-bound canonical integer evidence before strict validation",
  );
  assert.match(
    checkIndexerDryRunSource,
    /function sharedIndexerSectionArtifactIssues\(manifest\)[\s\S]*normalizedArtifactPathSet[\s\S]*indexer evidence sections must use distinct local artifact files across/,
    "indexer proof validation must reject one artifact reused across dry-run, finality, and chain-snapshot sections",
  );
  assert.match(
    checkIndexerDryRunSource,
    /function regularFileStat\(filePath\)[\s\S]*const stats = statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*function fmtMtime\(filePath\)[\s\S]*const stats = regularFileStat\(filePath\)[\s\S]*stats \? stats\.mtime\.toISOString\(\) : "missing"[\s\S]*function fileExists\(filePath\)[\s\S]*regularFileStat\(filePath\) !== null/,
    "indexer proof must derive mtime and file presence from a shared regular-file stat boundary",
  );
  assert.match(
    checkIndexerDryRunSource,
    /function localArtifactIsFile\(artifactPath\)[\s\S]*regularFileStat\(resolve\(process\.cwd\(\), artifactPath\)\) !== null/,
    "indexer proof must derive local artifact existence from the shared regular-file stat boundary",
  );
  const analyzeCanarySource = readFileSync("scripts/analyze-live-canary-proof.mjs", "utf8");
  const createCanaryDraftSource = readFileSync("scripts/create-canary-proof-draft.mjs", "utf8");
  const collectSignoffSource = readFileSync("scripts/collect-signoff-evidence.mjs", "utf8");
  const createSignoffDraftSource = readFileSync("scripts/create-signoff-proof-draft.mjs", "utf8");
  assert.match(
    analyzeCanarySource,
    /JSONL_READ_CHUNK_BYTES[\s\S]*function readJsonl[\s\S]*readSync/,
    "live canary proof analysis must read long JSONL artifacts in bounded chunks",
  );
  assert.ok(
    analyzeCanarySource.includes('JSON.parse(line.replace(/^\\uFEFF/, ""))'),
    "live canary proof analysis must tolerate UTF-8 BOM on the first JSONL record",
  );
  assert.equal(
    packageScripts["proof:canary:summary"],
    "node scripts/analyze-live-canary-proof.mjs --summary-only",
    "launch canary proof must expose a compact summary command for routine operator checks",
  );
  assert.equal(
    packageScripts["proof:testnet:canary:summary"],
    "node scripts/analyze-live-canary-proof.mjs --profile=testnet --summary-only",
    "testnet canary proof must expose a compact summary command for routine operator checks",
  );
  assert.equal(
    packageScripts["proof:testnet:canary:strict:summary"],
    "node scripts/analyze-live-canary-proof.mjs --profile=testnet --strict --summary-only",
    "testnet canary proof must expose a compact strict summary command for launch checks",
  );
  assert.equal(
    packageScripts["proof:testnet:canary:v10:summary"],
    "node scripts/analyze-live-canary-proof.mjs --profile=v10-matrix --strict --summary-only --require-epoch-bound --require-v10-gas-matrix",
    "V10 testnet canary matrix proof must expose a compact fail-closed summary command",
  );
  assert.match(
    analyzeCanarySource,
    /const summaryOnly = process\.argv\.includes\("--summary-only"\)/,
    "canary proof analyzer must support compact output without changing validation",
  );
  assert.match(
    analyzeCanarySource,
    /function hasNonFutureIsoTimestamp[\s\S]*Date\.now\(\) \+ 5 \* 60 \* 1000[\s\S]*targetNetwork\.checkedAt must not be in the future[\s\S]*recovery\.\$\{check\}\.checkedAt must not be in the future[\s\S]*autoMinerSession\.checkedAt must not be in the future[\s\S]*transactionHealth\.checkedAt must not be in the future/,
    "canary proof analyzer must reject future-dated target, recovery, auto-miner session, and transaction health timestamps",
  );
  assert.match(
    analyzeCanarySource,
    /const canaryLaunchGates = \["G10", "G11"\][\s\S]*const canaryLaunchGateGroups = "canary=2"[\s\S]*function launchGateSummary\(issueCount\)[\s\S]*blocked[\s\S]*covered[\s\S]*launchGateSummary\(strictFailures\.length\)[\s\S]*launchGateSummary\(1\)/,
    "canary proof summary must identify both G10 epoch and G11 recovery gates without printing live log details",
  );
  assert.match(
    analyzeCanarySource,
    /summaryOnly \? manifestSummaryStatus\(\) : \(manifestPath \? resolve\(process\.cwd\(\), manifestPath\) : "not required"\)/,
    "canary proof summary output must avoid printing the absolute manifest path",
  );
  assert.match(
    analyzeCanarySource,
    /function regularFileStat\(filePath\)[\s\S]*const stats = statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*function isExistingFile\(filePath\)[\s\S]*regularFileStat\(filePath\) !== null[\s\S]*function manifestSummaryStatus\(\)[\s\S]*isExistingFile\(resolve\(process\.cwd\(\), manifestPath\)\) \? "present" : "missing"/,
    "canary proof summary must classify only regular manifest files as present",
  );
  assert.match(
    analyzeCanarySource,
    /MAX_CANARY_PROOF_MANIFEST_BYTES = 512 \* 1024[\s\S]*const manifestStat = regularFileStat\(absolutePath\)[\s\S]*!manifestStat[\s\S]*canary proof manifest must be a file[\s\S]*manifestStat\.size > MAX_CANARY_PROOF_MANIFEST_BYTES[\s\S]*canary proof manifest is too large to validate safely[\s\S]*JSON\.parse\(readFileSync\(absolutePath, "utf8"\)\)/,
    "canary proof analyzer must size-gate proof manifests before parsing JSON",
  );
  assert.match(
    analyzeCanarySource,
    /else if \(!isExistingFile\(resolve\(process\.cwd\(\), logPath\)\)\)[\s\S]*live canary log must be a file/,
    "canary proof analyzer must reject directory live-log inputs before opening them",
  );
  assert.match(
    analyzeCanarySource,
    /function printMissingLogSummary[\s\S]*Log: missing[\s\S]*Summary: 1 proof issue\(s\):/,
    "canary proof summary output must report missing logs without dumping local paths",
  );
  assert.match(
    analyzeCanarySource,
    /function failInvalidJsonl[\s\S]*if \(summaryOnly\)[\s\S]*printMissingLogSummary\(`live canary log contains invalid JSONL at line \$\{lineNumber\}: \$\{summaryDetail\}`\)[\s\S]*Invalid JSONL at \$\{basename\(path\)\}:\$\{lineNumber\}/,
    "canary proof summary output must avoid absolute paths and raw JSONL snippets for parse failures",
  );
  assert.match(
    analyzeCanarySource,
    /if \(failedResolve\.length > 0 && !summaryOnly\)[\s\S]*if \(duplicateSuccessfulTxHashes\.length > 0 && !summaryOnly\)[\s\S]*if \(duplicateKeys\.length > 0 && !summaryOnly\)/,
    "canary proof summary output must avoid tx hash and duplicate-key sample sections",
  );
  assert.match(
    analyzeCanarySource,
    /import \{ closeSync, existsSync, openSync, readFileSync, readSync, statSync \}[\s\S]*function regularFileStat\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*function findMissingLocalArtifactRefs[\s\S]*regularFileStat\(resolvedArtifact\)[\s\S]*function artifactBackedEvidenceText[\s\S]*regularFileStat\(resolved\)/,
    "canary proof analyzer must reject directory artifact references before reading manifest-backed evidence",
  );
  assert.match(
    analyzeCanarySource,
    /MAX_CANARY_ARTIFACT_TEXT_BYTES = 256 \* 1024[\s\S]*function readBoundedArtifactText\(resolved\)[\s\S]*openSync\(resolved, "r"\)[\s\S]*readSync\(fd, buffer, 0, buffer\.length, 0\)[\s\S]*closeSync\(fd\)[\s\S]*artifactBackedEvidenceText\(value\)[\s\S]*readBoundedArtifactText\(resolved\)/,
    "canary proof analyzer must read bounded local artifact snippets for manifest-backed evidence",
  );
  assert.doesNotMatch(
    analyzeCanarySource,
    /readFileSync\(resolved,\s*"utf8"\)\.slice/,
    "canary proof analyzer must not read whole local artifacts before slicing snippets",
  );
  assert.match(
    analyzeCanarySource,
    /function sharedCanarySectionArtifactIssues[\s\S]*targetNetwork[\s\S]*recovery[\s\S]*autoMinerSession[\s\S]*transactionHealth/,
    "canary proof analyzer must reject one artifact reused across independent canary evidence sections",
  );
  assert.ok(
    analyzeCanarySource.includes("canary evidence sections must use distinct local artifact files across"),
    "canary proof analyzer must explain reused canary evidence section artifacts",
  );
  assert.doesNotMatch(
    analyzeCanarySource,
    /readFileSync\(path,\s*"utf8"\)[\s\S]*\.split\(\s*\/\\r\?\\n\//,
    "live canary proof analysis must not load the full JSONL artifact before parsing",
  );
  assert.match(
    createCanaryDraftSource,
    /JSONL_READ_CHUNK_BYTES[\s\S]*function readJsonlArtifact[\s\S]*readSync/,
    "live canary proof draft generation must read long JSONL artifacts in bounded chunks",
  );
  assert.ok(
    createCanaryDraftSource.includes('JSON.parse(line.replace(/^\\uFEFF/, ""))'),
    "live canary proof draft generation must tolerate UTF-8 BOM on the first JSONL record",
  );
  assert.match(
    createCanaryDraftSource,
    /const displayPath = path\.basename\(filePath\)[\s\S]*Invalid JSONL at \$\{displayPath\}:\$\{lineNumber\}: parse error/,
    "live canary proof draft generation must avoid absolute paths and raw JSONL snippets for parse failures",
  );
  assert.match(
    createCanaryDraftSource,
    /import \{ closeSync, mkdirSync, openSync, readSync, statSync, writeFileSync \}[\s\S]*MAX_CANARY_DRAFT_SIDE_ARTIFACT_BYTES = 512 \* 1024[\s\S]*function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*function requireExistingArtifact\(name\)[\s\S]*const stats = regularFileStat\(resolved\)[\s\S]*if \(!stats\)[\s\S]*stats\.size > MAX_CANARY_DRAFT_SIDE_ARTIFACT_BYTES[\s\S]*too large to reference safely/,
    "live canary proof draft generation must reject directory artifact inputs before reading them",
  );
  assert.doesNotMatch(
    createCanaryDraftSource,
    /existsSync\(resolved\)|statSync\(resolved\)\.isFile\(\)/,
    "live canary proof draft generation must not bypass regularFileStat for resolved artifact paths",
  );
  assert.match(
    createCanaryDraftSource,
    /function requireDistinctArtifactInputs[\s\S]*distinct canary evidence files[\s\S]*target-artifact[\s\S]*recovery-artifact[\s\S]*session-artifact[\s\S]*tx-artifact/,
    "live canary proof draft generation must reject reused target, recovery, session, and transaction artifacts",
  );
  assert.match(
    createCanaryDraftSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parsePositiveInteger\(value\)[\s\S]*CANONICAL_POSITIVE_INTEGER_RE\.test\(text\)[\s\S]*const parsed = BigInt\(text\)[\s\S]*parsed <= MAX_SAFE_INTEGER_BIGINT \? Number\(parsed\) : null[\s\S]*const parsedChainId = parsePositiveInteger\(chainId\)[\s\S]*chainId: parsedChainId/,
    "live canary proof draft generation must publish the same safe parsed chain id it validates",
  );
  assert.doesNotMatch(
    createCanaryDraftSource,
    /readFileSync\(path\.resolve\(process\.cwd\(\), filePath\),\s*"utf8"\)[\s\S]*\.split\(\s*\/\\r\?\\n\/|chainId:\s*Number\(chainId\)/,
    "live canary proof draft generation must not load the full JSONL artifact before parsing or broadly coerce chain id evidence",
  );
  assert.match(
    liveRoundCanarySource,
    /GENERIC_RPC_LABEL_RE[\s\S]*LIVE_CANARY_RPC_LABEL must be a concrete redacted RPC label/,
    "live canary must fail before transactions when the redacted RPC label is missing or generic",
  );
  assert.match(
    liveRoundCanarySource,
    /http request[\s\S]*rpc[\s\S]*connection[\s\S]*socket/,
    "live canary must classify common provider transport failures as network errors",
  );
  assert.match(
    chainIndexerAuditSource,
    /decoded\.eventName === "ResolverRewardAccrued" && inEpochWindow[\s\S]*decoded\.eventName === "ResolverRewardClaimed"/,
    "chain/indexer audit must keep epoch-scoped resolver accruals inside the selected epoch window",
  );
  assert.match(
    analyzeCanarySource,
    /BET_MODES\.has\(event\.mode\)/,
    "canary analyzer must not count preflight, resolve, wait, or summary events as bet transactions",
  );
  assert.match(
    readFileSync("scripts/canary-proof-profile.mjs", "utf8"),
    /launch:[\s\S]*requiredRoles:\s*\["MANUAL",\s*"AUTOMINER_A",\s*"AUTOMINER_B"\][\s\S]*testnet:[\s\S]*requiredRoles:\s*\["MANUAL",\s*"AUTOMINER_A",\s*"AUTOMINER_B"\][\s\S]*"v10-matrix":(?![\s\S]*requiredRoles)/,
    "launch/testnet canary proof must require MANUAL/AUTOMINER_A/AUTOMINER_B role coverage while keeping V10 matrix exempt",
  );
  assert.match(
    analyzeCanarySource,
    /requiredCanaryRoles[\s\S]*successfulRoles[\s\S]*missingRequiredCanaryRoles[\s\S]*successful required canary roles missing/,
    "strict canary proof must fail when required live-test roles are missing from successful bets",
  );
  assert.match(
    analyzeCanarySource,
    /unexpectedSuccessfulCanaryRoles[\s\S]*successfulRoles\.filter\(\(role\) => !requiredCanaryRoles\.includes\(role\)\)[\s\S]*unexpected successful canary roles/,
    "strict canary proof must reject successful roles outside the profile-required role set",
  );
  assert.match(
    analyzeCanarySource,
    /autoMinerSession\.requiredRoles[\s\S]*autoMinerSession\.successfulRoles[\s\S]*missingManifestRequiredRoles[\s\S]*missingManifestSuccessfulRoles[\s\S]*unexpectedManifestRequiredRoles[\s\S]*unexpectedManifestSuccessfulRoles/,
    "canary proof manifest must record exactly the required and successful role coverage",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canaryUnexpectedRoleLog[\s\S]*role: "AUTOMINER_C"[\s\S]*canary-unexpected-successful-role[\s\S]*unexpected successful canary roles: AUTOMINER_C/,
    "proof draft regression suite must reject canary logs with extra successful roles",
  );
  assert.match(
    analyzeCanarySource,
    /malformedSuccessfulRoleEvidence = okBets\.filter\(\(event\) => !normalizeRole\(event\.role\)\)[\s\S]*malformed successful role evidence/,
    "canary proof analyzer must fail closed on malformed successful role evidence",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canaryMalformedRoleLog[\s\S]*role: "AUTOMINER A"[\s\S]*canary-live-log-malformed-role[\s\S]*malformed successful role evidence 1/,
    "proof draft regression suite must reject malformed canary successful role evidence",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canary-future-timestamp[\s\S]*targetNetwork\.checkedAt must not be in the future/,
    "proof draft regression suite must reject strict canary proof with future-dated manifest timestamps",
  );
  assert.match(
    analyzeCanarySource,
    /CANONICAL_POSITIVE_INTEGER_RE[\s\S]*targetNetwork\.chainId must be a canonical positive decimal integer[\s\S]*configured chain id must be a canonical positive decimal integer[\s\S]*function positiveIntegerString/,
    "canary proof analyzer must canonicalize target chain IDs before strict proof acceptance",
  );
  assert.doesNotMatch(
    analyzeCanarySource,
    /Number\(targetNetwork\.chainId\)|Number\(expectedChainId\)|Number\(event\.chainId\)/,
    "canary proof analyzer must not use broad numeric fallback for target or live-log chain IDs",
  );
  assert.match(
    analyzeCanarySource,
    /CANONICAL_NON_NEGATIVE_INTEGER_RE[\s\S]*malformedNonceEvidence[\s\S]*malformed nonce evidence \$\{malformedNonceEvidence\.length\}[\s\S]*function hasCanonicalNonceEvidence/,
    "canary proof analyzer must fail closed on malformed successful bet nonce evidence",
  );
  assert.doesNotMatch(
    analyzeCanarySource,
    /Number\(event\.noncePending\)\s*>\s*Number\(event\.nonceLatest\)/,
    "canary proof analyzer must not use broad numeric fallback for nonce gap evidence",
  );
  assert.match(
    createCanaryDraftSource,
    /CANONICAL_POSITIVE_INTEGER_RE[\s\S]*function positiveIntegerString[\s\S]*--chain-id must be a canonical positive decimal integer/,
    "canary proof draft generation must canonicalize target chain IDs before writing draft evidence",
  );
  assert.doesNotMatch(
    createCanaryDraftSource,
    /Number\(event\.chainId\)|Number\(expectedChainId\)/,
    "canary proof draft generation must not use broad numeric fallback for live-log chain IDs",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canary-malformed-target-chain-id[\s\S]*targetNetwork\.chainId must be a canonical positive decimal integer[\s\S]*canary-live-log-malformed-chain-id[\s\S]*target metadata mismatches[\s\S]*canary-draft-malformed-chain-id[\s\S]*--chain-id must be a canonical positive decimal integer[\s\S]*canary-draft-malformed-live-chain-id[\s\S]*--live-log target metadata must match/,
    "proof draft regression suite must reject malformed canary chain IDs in strict manifest, live-log, and draft paths",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canaryMalformedNonceLog[\s\S]*noncePending: "2e1"[\s\S]*canary-live-log-malformed-nonce[\s\S]*malformed nonce evidence 1/,
    "proof draft regression suite must reject malformed canary nonce evidence in successful live-log bets",
  );
  assert.match(
    analyzeCanarySource,
    /malformedBetTileEvidence[\s\S]*malformed bet tile evidence \$\{malformedBetTileEvidence\.length\}[\s\S]*function parseBetTiles/,
    "canary proof analyzer must fail closed on malformed successful bet tile evidence",
  );
  assert.doesNotMatch(
    analyzeCanarySource.match(/function findDuplicateBetKeys\(bets\)[\s\S]*?function findDuplicateTxHashes/)?.[0] ?? "",
    /tiles\.map\(Number\)|Array\.isArray\(event\.tiles\) \? event\.tiles : \[\]/,
    "duplicate bet proof must use canonical parsed tiles instead of raw tile fallback",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canaryMalformedTileLog[\s\S]*tiles: \["1\.0"\][\s\S]*canary-live-log-malformed-tile[\s\S]*malformed bet tile evidence 1/,
    "proof draft regression suite must reject malformed canary tile evidence in successful live-log bets",
  );
  assert.match(
    analyzeCanarySource,
    /malformedBetEpochEvidence[\s\S]*malformed bet epoch evidence \$\{malformedBetEpochEvidence\.length\}[\s\S]*function findDuplicateBetKeys[\s\S]*positiveIntegerString\(event\.epoch\)/,
    "canary proof analyzer must fail closed on malformed successful bet epoch evidence before duplicate proof",
  );
  assert.match(
    analyzeCanarySource,
    /malformedTxMetricEvidence[\s\S]*malformed successful tx metric evidence \$\{malformedTxMetricEvidence\.length\}[\s\S]*function nonNegativeValue[\s\S]*function hasMalformedSuccessfulTxMetricEvidence/,
    "canary proof analyzer must fail closed on malformed successful tx metric evidence",
  );
  assert.doesNotMatch(
    analyzeCanarySource,
    /Number\(event\.durationMs\)|Number\(event\.gasUsed\)|Number\(event\[field\]\)/,
    "canary proof analyzer must not use broad numeric fallback for successful tx stats or health trends",
  );
  assert.match(
    analyzeCanarySource,
    /manifestAutoMinerRounds = positiveIntegerValue\(manifestSummary\.autoMinerSession\.rounds\)[\s\S]*manifestAutoMinerUniqueEpochs = positiveIntegerValue\(manifestSummary\.autoMinerSession\.uniqueEpochs\)[\s\S]*function positiveIntegerValue/,
    "canary proof analyzer must canonicalize manifest auto-miner counts before comparing live evidence",
  );
  assert.doesNotMatch(
    analyzeCanarySource,
    /Number\(manifestSummary\.autoMinerSession\.rounds\)|Number\(manifestSummary\.autoMinerSession\.uniqueEpochs\)/,
    "canary proof analyzer must not use broad numeric fallback for manifest auto-miner counts",
  );
  assert.match(
    analyzeCanarySource,
    /targetNetworkOk:[\s\S]*normalizeNetwork\(targetNetwork\.network\) === profile\.network[\s\S]*normalizeNetwork\(targetNetwork\.network\) === normalizeNetwork\(expectedNetwork\)[\s\S]*targetChainIdString === String\(profile\.chainId\)[\s\S]*targetChainIdString === expectedChainIdString[\s\S]*normalizeAddress\(targetNetwork\.contractAddress\) === normalizeAddress\(expectedContract\)/,
    "canary manifest summary must mark targetNetwork as issue when configured network, chain id, or contract address mismatches strict validation",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canaryMalformedEpochLog[\s\S]*epoch: "4\.0"[\s\S]*canary-live-log-malformed-epoch[\s\S]*malformed bet epoch evidence 1/,
    "proof draft regression suite must reject malformed canary epoch evidence in successful live-log bets",
  );
  assert.match(
    analyzeCanarySource,
    /malformedBetTimestampEvidence = okBets\.filter\(\(event\) => !hasIsoTimestamp\(event\.timestamp\)\)[\s\S]*malformed bet timestamp evidence/,
    "canary proof analyzer must fail closed on malformed timestamps in successful live-log bets",
  );
  assert.match(
    analyzeCanarySource,
    /function elapsedRunMs\(events\)[\s\S]*\.map\(\(event\) => isoTimestampMs\(event\.timestamp\)\)/,
    "canary elapsed-time proof must use canonical ISO timestamp parsing",
  );
  assert.doesNotMatch(
    analyzeCanarySource,
    /Date\.parse\(event\.timestamp\)/,
    "canary elapsed-time proof must not use broad Date.parse parsing",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canaryMalformedTimestampLog[\s\S]*timestamp: "2026-07-09 00:03:00"[\s\S]*canary-live-log-malformed-timestamp[\s\S]*malformed bet timestamp evidence 1/,
    "proof draft regression suite must reject malformed canary timestamp evidence in successful live-log bets",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canaryMalformedTxMetricLog[\s\S]*durationMs: "1\.5"[\s\S]*gasUsed: "2e1"[\s\S]*canary-live-log-malformed-tx-metric[\s\S]*malformed successful tx metric evidence 1/,
    "proof draft regression suite must reject malformed canary tx metric evidence in successful live-log bets",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canaryMalformedSessionCountsManifest[\s\S]*rounds: "51\.0"[\s\S]*uniqueEpochs: "5\.1e1"[\s\S]*canary-malformed-session-counts[\s\S]*autoMinerSession\.rounds must be a positive integer/,
    "proof draft regression suite must reject malformed canary manifest auto-miner counts",
  );
  assert.match(
    analyzeCanarySource,
    /function duplicateRoleEntries[\s\S]*autoMinerSession\.successfulRoles contains duplicate role entries/,
    "canary proof analyzer must fail closed on duplicate auto-miner role entries",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canaryDuplicateSessionRolesManifest[\s\S]*successfulRoles: \["MANUAL", "AUTOMINER_A", "AUTOMINER_A", "AUTOMINER_B"\][\s\S]*canary-duplicate-session-roles[\s\S]*autoMinerSession\.successfulRoles contains duplicate role entries 2/,
    "proof draft regression suite must reject duplicate canary auto-miner role entries",
  );
  assert.match(
    analyzeCanarySource,
    /autoMinerSessionOk:[\s\S]*duplicateManifestRequiredRoles\.length === 0[\s\S]*duplicateManifestSuccessfulRoles\.length === 0[\s\S]*hasAutoMinerSessionProof\(autoMinerSession\)/,
    "canary manifest summary must mark Auto-Miner session as issue when duplicate roles or weak evidence are present",
  );
  assert.match(
    analyzeCanarySource,
    /function malformedTxHashEntries[\s\S]*transactionHealth\.txHashes contains malformed tx hash entries/,
    "canary proof analyzer must fail closed on malformed transactionHealth tx hash entries",
  );
  assert.match(
    analyzeCanarySource,
    /function duplicateTxHashEntries[\s\S]*transactionHealth\.txHashes contains duplicate tx hash entries/,
    "canary proof analyzer must fail closed on duplicate transactionHealth tx hash entries",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canaryMalformedTransactionHashesManifest[\s\S]*txHashes: \[canaryFullTxHashes\[0\], "0x1234"\][\s\S]*canary-malformed-transaction-hashes[\s\S]*transactionHealth\.txHashes contains malformed tx hash entries 1/,
    "proof draft regression suite must reject mixed valid and malformed canary manifest tx hash entries",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canaryDuplicateTransactionHashesManifest[\s\S]*txHashes: \[canaryFullTxHashes\[0\], canaryFullTxHashes\[0\]\][\s\S]*canary-duplicate-transaction-hashes[\s\S]*transactionHealth\.txHashes contains duplicate tx hash entries 1/,
    "proof draft regression suite must reject duplicate canary manifest tx hash entries",
  );
  assert.match(
    analyzeCanarySource,
    /transactionHealthOk:[\s\S]*malformedTransactionHealthTxHashes\.length === 0[\s\S]*duplicateTransactionHealthTxHashes\.length === 0[\s\S]*hasTransactionHealthProof\(transactionHealth\)/,
    "canary manifest summary must mark transaction health as issue when malformed hashes, duplicate hashes, or weak evidence are present",
  );
  assert.match(
    createCanaryDraftSource,
    /requiredRoles = normalizeRoleList\(profile\.requiredRoles\)[\s\S]*requiredRoles,[\s\S]*successfulRoles: summary\.successfulRoles/,
    "canary proof draft must preserve required and observed successful roles",
  );
  for (const canaryGateScript of ["scripts/check-launch-gates.mjs", "scripts/report-launch-remaining.mjs"]) {
    assert.match(
      readFileSync(canaryGateScript, "utf8"),
      /"G10"[\s\S]*MANUAL[\s\S]*AUTOMINER_A[\s\S]*AUTOMINER_B[\s\S]*50 successful auto-miner unique epochs/,
      `${canaryGateScript} must keep launch canary role coverage visible`,
    );
    assert.match(
      readFileSync(canaryGateScript, "utf8"),
      /"G12"[\s\S]*Privy allowed origins[\s\S]*redacted production App ID configured proof[\s\S]*wrong network/,
      `${canaryGateScript} must keep production Privy App ID proof visible in the wallet QA gate`,
    );
  }
  assert.match(
    readFileSync("docs/mainnet-status-board.md", "utf8"),
    /Latest aggregate verification:[\s\S]*V10 dry-run Preview[\s\S]*transactionSent=false[\s\S]*preview:canary:v10:authorization-ready:summary[\s\S]*npm\.cmd run proof:prelaunch:summary[\s\S]*all required local rows passed[\s\S]*24 external\/status blockers[\s\S]*0\/14 Complete[\s\S]*residual security follow-up 8\/8[\s\S]*appResolveEpochFiles=0[\s\S]*ABI\/indexer storage[\s\S]*sameBlockEventOrdering=true/,
    "mainnet status board must show the latest aggregate local verification without claiming launch completion",
  );
  assert.match(
    readFileSync("docs/mainnet-status-board.md", "utf8"),
    /Last local verification:[\s\S]*L1-L17[\s\S]*residual security follow-up 8\/8[\s\S]*appResolveEpochFiles=0[\s\S]*G1-G14 remain Missing pending external evidence[\s\S]*G14[\s\S]*fresh final security scan[\s\S]*no open High\/Medium local findings/,
    "mainnet status board must keep L1-L17 local verification and final security scan G14 blocker visible",
  );
  assert.doesNotMatch(
    createCanaryDraftSource,
    /TODO: verified\/pass/,
    "canary draft instructions must not suggest a combined status rejected by the strict validator",
  );
  assert.match(
    collectSignoffSource,
    /randomness-decision[\s\S]*randomness-operator[\s\S]*randomness-signed-at[\s\S]*randomness-evidence[\s\S]*randomness-risk-accepted/,
    "signoff collector must support reproducible CLI-provided randomness acceptance evidence",
  );
  assert.match(
    collectSignoffSource,
    /MAX_SIGNOFF_LOG_BYTES = 512 \* 1024[\s\S]*function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stat\.isFile\(\) \? stat : null[\s\S]*function readRequiredLog\(name, filePath\)[\s\S]*const stat = regularFileStat\(resolved\)[\s\S]*if \(!stat\)[\s\S]*stat\.size > MAX_SIGNOFF_LOG_BYTES[\s\S]*artifact is too large to validate safely[\s\S]*readFileSync\(resolved, "utf8"\)/,
    "signoff collector must reject directory and oversized paths before reading evidence artifacts",
  );
  assert.match(
    createSignoffDraftSource,
    /MAX_SIGNOFF_LOG_BYTES = 512 \* 1024[\s\S]*function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stat\.isFile\(\) \? stat : null[\s\S]*function readRequiredLog\(name, filePath\)[\s\S]*const stat = regularFileStat\(resolved\)[\s\S]*if \(!stat\)[\s\S]*stat\.size > MAX_SIGNOFF_LOG_BYTES[\s\S]*artifact is too large to validate safely[\s\S]*readFileSync\(resolved, "utf8"\)/,
    "signoff proof draft must reject directory and oversized paths before reading evidence artifacts",
  );
  assert.doesNotMatch(
    `${collectSignoffSource}\n${createSignoffDraftSource}`,
    /existsSync\(resolved\)|statSync\(resolved\)\.isFile\(\)/,
    "signoff collector and draft generator must not bypass regularFileStat for resolved artifact paths",
  );
  assert.match(
    collectSignoffSource,
    /function requireChainComparisonLog[\s\S]*proof:chain[\s\S]*direct\[-\\s\]\?chain[\s\S]*jackpot, safetyPool, deposits, rewards, rebates, and resolve/,
    "signoff collector must reject chain logs missing direct-chain comparison coverage",
  );
  assert.match(
    `${readFileSync("docs/mainnet-readiness-checklist.md", "utf8")}\n${readFileSync("docs/production-runbook.md", "utf8")}`,
    /current non-VRF[\s\S]*not a requirement to redesign randomness before mainnet[\s\S]*randomness\.decision=accepted-risk[\s\S]*current non-VRF model/,
    "launch docs must frame randomness as explicit current-model acceptance, not a mandatory pre-mainnet redesign",
  );
  assert.match(
    readFileSync("docs/v10-contract-design.md", "utf8"),
    /Local\s+V10 compiler provenance is reproducible and manifest-matched[\s\S]*Final mainnet\s+readiness still requires fresh external/,
    "V10 design doc must distinguish local reproducibility from remaining external launch evidence",
  );
  assert.match(
    readFileSync("docs/v10-contract-design.md", "utf8"),
    /local production-build API\/UI smoke pass[\s\S]*Fresh external deployed-bytecode[\s\S]*long-soak evidence remain open/,
    "V10 design doc must not confuse local production-build smoke with final production evidence",
  );
  assert.doesNotMatch(
    readFileSync("docs/v10-contract-design.md", "utf8"),
    /metadata-only Remix source-unit layout mismatch|not yet the final reproducible deployment/,
    "V10 design doc must not preserve stale deployed-provenance blockers after manifest-matched local proof",
  );
  assert.match(
    collectSignoffSource,
    /protected-bets-required[\s\S]*NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS[\s\S]*protectedBetsRequired: isTruthyEnvValue/,
    "signoff collector must carry the V10 protected-bet flag into final signoff evidence",
  );
  assert.match(
    collectSignoffSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function isPositiveIntegerString\(value\)[\s\S]*\^\[1-9\]\\d\{0,15\}\$[\s\S]*const parsed = BigInt\(normalized\)[\s\S]*parsed <= MAX_SAFE_INTEGER_BIGINT[\s\S]*finalityBlocksPositive: isPositiveIntegerString\(finalityBlocks\)/,
    "signoff collector must BigInt-bound finality block evidence before setting the finality-positive proof flag",
  );
  assert.match(
    readFileSync("scripts/collect-proof-common.mjs", "utf8"),
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*export function parsePositiveInteger\(value\)[\s\S]*\^\[1-9\]\\d\{0,15\}\$[\s\S]*const parsed = BigInt\(normalized\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*export function isPositiveInteger\(value\)[\s\S]*parsePositiveInteger\(value\) !== null/,
    "proof collectors must share parsed positive-integer evidence with boolean validation",
  );
  assert.match(
    collectSignoffSource,
    /parsePositiveInteger[\s\S]*const requestedEpochs = parsePositiveInteger\(epochs\)[\s\S]*requireCondition\(requestedEpochs !== null[\s\S]*requestedEpochs,/,
    "signoff collector must publish the same canonical parsed --epochs value it validates",
  );
  assert.doesNotMatch(
    `${readFileSync("scripts/collect-proof-common.mjs", "utf8")}\n${collectSignoffSource}`,
    /function (?:parsePositiveInteger|isPositiveIntegerString)\(value\)[\s\S]*\^\[1-9\]\\d\*\$|const requestedEpochs = Number\(epochs\)/,
    "signoff collector must not broadly coerce finality block or requested epoch evidence",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /signoff-collector-unsafe-epochs[\s\S]*9999999999999999[\s\S]*--epochs must be a positive integer/,
    "proof draft regression suite must reject unsafe signoff collector requested epoch evidence",
  );
  assert.match(
    createSignoffDraftSource,
    /randomness-decision[\s\S]*randomness-operator[\s\S]*randomness-signed-at[\s\S]*randomness-evidence[\s\S]*randomness-risk-accepted/,
    "signoff draft generator must support the same reproducible randomness acceptance evidence fields",
  );
  assert.match(
    createSignoffDraftSource,
    /function requireChainComparisonLog[\s\S]*proof:chain[\s\S]*direct\[-\\s\]\?chain[\s\S]*jackpot, safetyPool, deposits, rewards, rebates, and resolve/,
    "signoff draft generator must reject chain logs missing direct-chain comparison coverage",
  );
  assert.match(
    createSignoffDraftSource,
    /protected-bets-required[\s\S]*NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS[\s\S]*protectedBetsRequired: isTruthyEnvValue/,
    "signoff draft generator must carry the V10 protected-bet flag into final signoff evidence",
  );
  assert.match(
    createSignoffDraftSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function isPositiveInteger\(value\)[\s\S]*\^\[1-9\]\\d\{0,15\}\$[\s\S]*const parsed = BigInt\(normalized\)[\s\S]*parsed <= MAX_SAFE_INTEGER_BIGINT[\s\S]*finalityBlocksPositive: isPositiveInteger\(finalityBlocks\)/,
    "signoff draft generator must BigInt-bound finality block evidence before setting the finality-positive proof flag",
  );
  assert.doesNotMatch(
    createSignoffDraftSource,
    /function isPositiveInteger\(value\)[\s\S]*\^\[1-9\]\\d\*\$|function isPositiveInteger\(value\)[\s\S]*Number\(String\(value \?\? ""\)\.trim\(\)\)[\s\S]*parsed > 0/,
    "signoff draft generator must not broadly coerce finality block evidence",
  );
  assert.match(
    readFileSync("scripts/check-signoff-proof.mjs", "utf8"),
    /contractEnv\.protectedBetsRequired !== true[\s\S]*V10 mainnet launch/,
    "strict signoff proof must reject manifests missing the V10 protected-bet flag",
  );
  assert.match(
    liveRoundCanarySource,
    /LIVE_TEST_RANDOMIZE_ROUNDS/,
    "live canary must support randomized stress rounds for amount/tile coverage",
  );
  assert.match(
    liveRoundCanarySource,
    /CONTRACT_REQUIRES_EPOCH_BOUND_BETS[\s\S]*placeBatchBetsBitmapForEpoch[\s\S]*\[epoch, tileIdsToMask\(tiles\), plan\.amount\]/,
    "V10 live canary must dispatch the protected bitmap selector with its observed epoch",
  );
  assert.ok(
    liveRoundCanarySource.indexOf("await assertEpochBoundBetCapability(publicClient)") <
      liveRoundCanarySource.indexOf("await runPreflight(logPath, publicClient, wallets, plannedSpendByRole)"),
    "V10 live canary must reject missing protected bytecode before wallet preflight or allowance transactions",
  );
  assert.ok(
    liveRoundCanarySource.indexOf("if (V10_MATRIX_ONLY && !CONTRACT_REQUIRES_EPOCH_BOUND_BETS)") <
      liveRoundCanarySource.indexOf("const wallets = DRY_RUN ? loadDryRunWallets() : loadWallets()"),
    "V10 matrix mode must reject stale runtime configuration before loading wallet secrets",
  );
  assert.match(
    liveRoundCanarySource,
    /approvalRequired = FORCE_ALLOWANCE_APPROVE \|\| allowance < plannedSpend[\s\S]*approvalsRequired=/,
    "V10 dry-run must report the bounded plan's approval transaction count",
  );
  assert.match(
    liveRoundCanarySource,
    /plannedStake = \[\.\.\.plannedSpendByRole\.values\(\)\][\s\S]*plannedBetTransactions = TARGET_ROUNDS \* \(REPEAT_SAME_BET \? 2 : 1\)[\s\S]*plannedStake=/,
    "live canary must report the exact planned stake and bet transaction count",
  );
  assert.match(
    liveRoundCanarySource,
    /MAX_RESOLVE_TRANSACTIONS = V10_MATRIX_ONLY \? TARGET_ROUNDS - 1 : null[\s\S]*submittedResolveTransactions >= MAX_RESOLVE_TRANSACTIONS[\s\S]*submittedResolveTransactions \+= 1/,
    "V10 matrix mode must cap submitted resolve transactions before wallet writes",
  );
  assert.match(
    analyzeCanarySource,
    /--require-epoch-bound[\s\S]*successful epoch-unbound bets/,
    "V10 canary proof must reject successful legacy bets when epoch-bound evidence is required",
  );
  assert.match(
    liveRoundCanarySource,
    /V10_CANARY_MATRIX = \[[\s\S]*tileCount: 1, sparse: false[\s\S]*tileCount: 3, sparse: false[\s\S]*tileCount: 3, sparse: true[\s\S]*tileCount: 5, sparse: false[\s\S]*tileCount: 5, sparse: true[\s\S]*tileCount: 25, sparse: false/,
    "V10 live canary must schedule single, contiguous, sparse, and full-grid gas cases before randomized rounds",
  );
  assert.match(
    liveRoundCanarySource,
    /V10_MATRIX_ONLY = process\.argv\.includes\("--v10-matrix-only"\)[\s\S]*DRY_RUN = [^;]*\(V10_MATRIX_ONLY && !V10_MATRIX_EXECUTE\)[\s\S]*TARGET_ROUNDS = V10_MATRIX_ONLY \? 6[\s\S]*REPEAT_SAME_BET = V10_MATRIX_ONLY/,
    "bounded V10 matrix mode must run six repeated cases and remain transaction-free without explicit --execute",
  );
  assert.equal(
    packageScripts["live:canary:v10:matrix"],
    "tsx scripts/live-round-canary.ts --v10-matrix-only",
    "the bounded V10 matrix command must default to the script's fail-closed dry-run mode",
  );
  assert.match(
    analyzeCanarySource,
    /--require-v10-gas-matrix[\s\S]*missing V10 gas cases[\s\S]*V10 Mined Gas Matrix/,
    "V10 canary proof must fail closed on missing mined-gas matrix cases and report per-case gas",
  );
  assert.match(
    analyzeCanarySource,
    /malformedV10GasMatrixEvidence[\s\S]*malformed V10 gas matrix evidence \$\{malformedV10GasMatrixEvidence\.length\}[\s\S]*function parseBetTiles[\s\S]*function tileCountValue[\s\S]*function gasValue/,
    "V10 canary proof must fail closed on malformed mined-gas matrix evidence",
  );
  assert.match(
    analyzeCanarySource,
    /function formatCounts\(counts\)[\s\S]*safeCountKey\(key\)[\s\S]*function safeCountKey\(value\)[\s\S]*\^\[A-Za-z0-9_-\]\{1,48\}\$[\s\S]*return "unsafe-token"/,
    "V10 canary proof summary must sanitize raw role/mode/error count keys before printing them",
  );
  assert.doesNotMatch(
    analyzeCanarySource.match(/function formatCounts\(counts\)[\s\S]*?function summarizeV10GasMatrix/)?.[0] ?? "",
    /\$\{key\}:\$\{value\}/,
    "V10 canary proof summary must not print raw count keys from canary logs",
  );
  assert.doesNotMatch(
    analyzeCanarySource.match(/function v10GasCase\(event\)[\s\S]*?function parseBetTiles/)?.[0] ?? "",
    /tiles\.map\(Number\)|Number\(event\.tileCount\)/,
    "V10 canary proof must not use broad numeric fallback for gas matrix tiles or tileCount",
  );
  assert.equal(
    packageScripts["proof:testnet:canary:v10"],
    "node scripts/analyze-live-canary-proof.mjs --profile=v10-matrix --strict --require-epoch-bound --require-v10-gas-matrix",
    "V10 testnet proof command must fail closed on epoch-bound and mined-gas matrix evidence",
  );
  assert.match(
    prelaunchStatusSource,
    /proof:testnet:canary:strict:summary[\s\S]*proof:testnet:canary:v10:summary[\s\S]*db:backup:summary/,
    "prelaunch status summary must keep missing V10 mined-gas matrix evidence visible before backup gates",
  );
  const v10CanaryProofDir = mkdtempSync(join(tmpdir(), "lore-v10-canary-proof-"));
  try {
    const baseBetEvent = {
      mode: "bitmap",
      round: 0,
      ok: true,
      txStatus: "success",
      role: "AUTOMINER_A",
      network: "sepolia",
      chainId: 59141,
      contractAddress: `0x${"1".repeat(40)}`,
      epoch: "1",
      hash: `0x${"1".repeat(64)}`,
      nonceLatest: 0,
      noncePending: 0,
      durationMs: 1,
      gasUsed: "1",
      tileCount: 1,
      tiles: [1],
      timestamp: "2026-07-22T00:00:00.000Z",
    };
    const runV10CanaryProof = (name, events) => {
      const logPath = join(v10CanaryProofDir, `${name}.jsonl`);
      writeFileSync(logPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
      return spawnSync(process.execPath, [
        "scripts/analyze-live-canary-proof.mjs",
        logPath,
        "--profile=v10-matrix",
        "--strict",
        "--require-epoch-bound",
        "--require-v10-gas-matrix",
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
          LINEA_NETWORK: "sepolia",
          NEXT_PUBLIC_LINEA_CHAIN_ID: "59141",
          LINEA_CHAIN_ID: "59141",
          NEXT_PUBLIC_CONTRACT_ADDRESS: `0x${"1".repeat(40)}`,
          LIVE_CANARY_MIN_EPOCHS: "1",
          LIVE_CANARY_MIN_AUTOMINER_EPOCHS: "1",
          LIVE_CANARY_MIN_ELAPSED_MS_PER_EPOCH: "1",
        },
        encoding: "utf8",
      });
    };
    const legacyProof = runV10CanaryProof("legacy", [{ ...baseBetEvent, epochBound: false }]);
    assert.equal(legacyProof.status, 1);
    assert.match(legacyProof.stdout, /successful epoch-unbound bets 1/);
    const pendingProof = runV10CanaryProof("pending", [{
      ...baseBetEvent,
      epochBound: true,
      ok: true,
      txStatus: "pending",
    }]);
    assert.equal(pendingProof.status, 1);
    assert.match(pendingProof.stdout, /failed bets 1/);
    const protectedProof = runV10CanaryProof("protected", [{ ...baseBetEvent, epochBound: true }]);
    assert.equal(protectedProof.status, 1, "the synthetic proof still lacks its required gas matrix");
    assert.doesNotMatch(protectedProof.stdout, /successful epoch-unbound bets/);
    assert.match(protectedProof.stdout, /missing V10 gas cases 3-contiguous,3-sparse,5-contiguous,5-sparse,25/);
    const malformedMatrixProof = runV10CanaryProof("malformed-matrix", [{
      ...baseBetEvent,
      epochBound: true,
      tileCount: "1.0",
    }]);
    assert.equal(malformedMatrixProof.status, 1);
    assert.match(malformedMatrixProof.stdout, /malformed V10 gas matrix evidence 1/);
    const unsafeRoleProof = runV10CanaryProof("unsafe-role", [{
      ...baseBetEvent,
      epochBound: true,
      role: "https://rpc.example/?token=secret",
    }]);
    assert.equal(unsafeRoleProof.status, 1);
    assert.match(unsafeRoleProof.stdout, /malformed successful role evidence 1/);
    assert.match(unsafeRoleProof.stdout, /\| roles \| unsafe-token:1 \|/);
    assert.doesNotMatch(unsafeRoleProof.stdout, /rpc\.example|token=secret/);
    const matrixTiles = [[1], [1, 2, 3], [1, 8, 15], [1, 2, 3, 4, 5], [1, 8, 15, 22, 4], Array.from({ length: 25 }, (_, index) => index + 1)];
    const matrixEvents = matrixTiles.flatMap((tiles, index) => {
      const first = {
        ...baseBetEvent,
        epoch: String(index + 1),
        epochBound: true,
        gasUsed: String(100_000 + index),
        hash: `0x${String(index + 1).repeat(64)}`,
        nonceLatest: index * 2,
        noncePending: index * 2,
        round: index,
        tileCount: tiles.length,
        tiles,
        timestamp: new Date(Date.parse("2026-07-22T00:00:00.000Z") + index * 2_000).toISOString(),
      };
      return [first, {
        ...first,
        gasUsed: String(200_000 + index),
        hash: `0x${"abcdef"[index].repeat(64)}`,
        nonceLatest: index * 2 + 1,
        noncePending: index * 2 + 1,
        repeat: true,
        timestamp: new Date(Date.parse(first.timestamp) + 1_000).toISOString(),
      }];
    });
    const matrixProof = runV10CanaryProof("matrix", matrixEvents);
    assert.equal(matrixProof.status, 0, "the complete bounded matrix must not require the 50-epoch soak manifest");
    assert.doesNotMatch(matrixProof.stdout, /missing V10 gas cases/);
    assert.doesNotMatch(matrixProof.stdout, /duplicate role\/epoch\/tile keys [1-9]/);
    assert.match(matrixProof.stdout, /\| 3-sparse \| 2 \| 100002 \| 100002 \| 200002 \|/);
    const orphanRepeatProof = runV10CanaryProof("orphan-repeat", [{ ...baseBetEvent, epochBound: true, repeat: true }]);
    assert.match(orphanRepeatProof.stdout, /duplicate role\/epoch\/tile keys 1/);
    const duplicateProof = runV10CanaryProof("duplicate", [
      { ...baseBetEvent, epochBound: true },
      {
        ...baseBetEvent,
        epochBound: true,
        hash: `0x${"a".repeat(64)}`,
        nonceLatest: 1,
        noncePending: 1,
        timestamp: "2026-07-22T00:00:01.000Z",
      },
    ]);
    assert.match(duplicateProof.stdout, /duplicate role\/epoch\/tile keys 1/);
  } finally {
    rmSync(v10CanaryProofDir, { recursive: true, force: true });
  }
  assert.match(
    liveRoundCanarySource,
    /LIVE_TEST_HEALTH_BASE_URL[\s\S]*x-health-diagnostics-secret[\s\S]*mode: "diagnostic"/,
    "live canary must support redacted runtime and storage telemetry during long soak runs",
  );
  assert.match(
    liveRoundCanarySource,
    /nonceQueueClear = noncePending <= nonceLatest[\s\S]*enoughEth: eth >= MIN_ETH_PER_WALLET[\s\S]*enoughToken: token >= requiredToken[\s\S]*pending-nonce-blocked[\s\S]*insufficient-native-and-token[\s\S]*insufficient-token/,
    "wallet preflight must expose safe balance categories and reject an existing pending nonce queue",
  );
  assert.match(
    liveRoundCanarySource,
    /for \(let attempt = 0; attempt < 2; attempt \+= 1\)[\s\S]*healthRetryCount: attempt[\s\S]*healthRetryCount: 1/,
    "live canary health telemetry must retry one transient timeout while preserving retry evidence",
  );
  assert.match(
    liveRoundCanarySource,
    /estimateGasMs: gasEstimatedAt - preparedAt[\s\S]*nonceReadMs: nonceReadAt - gasEstimatedAt[\s\S]*prepareMs: preparedAt - startedAt[\s\S]*sendMs: sentAt - nonceReadAt[\s\S]*receiptMs: receiptAt - sentAt/,
    "live canary must preserve prepare, estimate, nonce, send, and receipt latency phases",
  );
  assert.match(
    liveRoundCanarySource,
    /noncePending > nonceLatest[\s\S]*Pending transaction blocked by nonce/,
    "live canary must not dispatch another transaction while a wallet already has a pending nonce",
  );
  assert.match(
    liveRoundCanarySource,
    /const sentEvent = \{[\s\S]*hash,[\s\S]*catch \(error\)[\s\S]*\.\.\.sentEvent[\s\S]*errorKind: classified\.kind[\s\S]*txStatus: "pending"/,
    "live canary must retain post-send transaction evidence when receipt polling times out",
  );
  assert.match(
    liveRoundCanarySource,
    /for \(const \[resolverIndex, resolver\] of resolvers\.entries\(\)\)[\s\S]*insufficient-native-gas[\s\S]*mode: "resolver-candidate"[\s\S]*continue;[\s\S]*pendingHash[\s\S]*return;/,
    "live canary may fall back before resolve dispatch but must not switch wallets after an uncertain send",
  );
  assert.match(
    liveRoundCanarySource,
    /mode: "resolve"[\s\S]*resolverFallbackUsed: resolverIndex > 0/,
    "live canary must record successful resolver fallback without classifying pre-send skips as failed resolves",
  );
  assert.match(
    soakSupervisorSource,
    /randomBytes\(32\)[\s\S]*HEALTH_DIAGNOSTICS_SECRET: HEALTH_SECRET/,
    "testnet soak supervisor must generate and pass an ephemeral diagnostics secret without persisting it",
  );
  assert.match(
    soakSupervisorSource,
    /SOAK_EXECUTE_LIVE === "1"[\s\S]*process\.argv\.includes\("--execute-live"\)[\s\S]*LIVE_TEST_DRY_RUN: DRY_RUN[\s\S]*LIVE_TEST_EXECUTE: LIVE_EXECUTION_CONFIRMED/,
    "testnet soak supervisor must default to a transaction-free run and require explicit live execution confirmation",
  );
  assert.match(
    soakSupervisorSource,
    /DECIMAL_INTEGER_RE = \/\^\(\?:0\|\[1-9\]\\d\{0,15\}\)\$\/[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseInteger\(name, fallbackValue, min, max\)[\s\S]*process\.env\[name\]\?\.trim\(\)[\s\S]*!DECIMAL_INTEGER_RE\.test\(raw\)[\s\S]*const parsed = BigInt\(raw\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)/,
    "testnet soak supervisor env integer parsing must require canonical decimal text and BigInt bounds before Number narrowing",
  );
  assert.doesNotMatch(
    soakSupervisorSource,
    /const raw = process\.env\[name\];[\s\S]*const parsed = Number\(raw\);/,
    "testnet soak supervisor env integer parsing must not accept broad Number(raw) coercion",
  );
  assert.match(
    soakSupervisorSource,
    /writeFileSync\(STATUS_TMP_PATH[\s\S]*renameSync\(STATUS_TMP_PATH, STATUS_PATH\)/,
    "testnet soak status must be atomically replaced",
  );
  assert.match(
    soakSupervisorSource,
    /stopChild\(canary\)[\s\S]*stopChild\(server\)/,
    "testnet soak supervisor must stop both managed children on completion or failure",
  );
  assert.doesNotMatch(
    soakSupervisorSource,
    /Number\(status\?\.supervisorPid\)|Number\(lock\?\.pid\)|Number\(JSON\.parse\(readFileSync\(LOCK_PATH, "utf8"\)\)\.pid\)/,
    "testnet soak supervisor must not broad-coerce status or lock PIDs",
  );
  assert.match(
    soakSupervisorSource,
    /MAX_SOAK_STATUS_JSON_BYTES = 128 \* 1024[\s\S]*MAX_SOAK_LOCK_JSON_BYTES = 4 \* 1024[\s\S]*function readJson\(path, maxBytes = MAX_SOAK_STATUS_JSON_BYTES\)[\s\S]*const stats = statSync\(path\)[\s\S]*!stats\.isFile\(\) \|\| stats\.size > maxBytes[\s\S]*JSON\.parse\(readFileSync\(path, "utf8"\)\)[\s\S]*readJson\(LOCK_PATH, MAX_SOAK_LOCK_JSON_BYTES\)/,
    "testnet soak supervisor status and lock JSON reads must be size-gated before parsing",
  );
  assert.match(
    soakSupervisorSource,
    /existsSync\(LOCK_PATH\)[\s\S]*statSync\(LOCK_PATH\)\.size > MAX_SOAK_LOCK_JSON_BYTES[\s\S]*lock file is too large to validate safely[\s\S]*const previousLock = readJson\(LOCK_PATH, MAX_SOAK_LOCK_JSON_BYTES\)[\s\S]*parseTrackedPid\(previousLock\?\.pid\)[\s\S]*parseProcessStartToken\(previousLock\?\.supervisorStartToken\)/,
    "testnet soak startup must fail closed on oversized lock files before stale-lock cleanup",
  );
  assert.match(
    soakSupervisorSource,
    /status: "stopped"[\s\S]*stopReason: "operator-stop"[\s\S]*removeLockFile/,
    "testnet soak stop command must repair Windows stale status and remove its matching lock",
  );
  assert.match(
    soakSupervisorSource,
    /function removeLockFile\(\)[\s\S]*fileExists\(LOCK_PATH\)[\s\S]*rmSync\(LOCK_PATH/,
    "managed soak lock cleanup must only remove regular lock files",
  );
  assert.match(
    soakSupervisorSource,
    /existsSync\(LOCK_PATH\)[\s\S]*!fileExists\(LOCK_PATH\)[\s\S]*lock path exists but is not a file/,
    "managed soak startup must fail closed when the lock path is not a file",
  );
  assert.match(
    soakSupervisorSource,
    /createReadStream[\s\S]*summarizeLiveLog[\s\S]*uniqueTxHashes[\s\S]*duplicateNonces/,
    "testnet soak status command must stream compact transaction progress without loading raw artifacts into memory",
  );
  assert.match(
    soakSupervisorSource,
    /printSafeStatus[\s\S]*liveLogReady[\s\S]*hasLiveLog: liveLogReady[\s\S]*progress/,
    "testnet soak status command must emit compact state and progress without raw artifact contents and without treating non-files as live logs",
  );
  assert.match(
    soakSupervisorSource,
    /function fileExists\(path\)[\s\S]*statSync\(path\)\.isFile\(\)[\s\S]*if \(!path \|\| !fileExists\(path\)\) return summary/,
    "testnet soak status command must reject directory live-log inputs before streaming",
  );
  assert.match(
    soakSupervisorSource,
    /STATUS_SUMMARY_ONLY[\s\S]*diskCapacity[\s\S]*failedBetErrorKinds[\s\S]*failedBetFamilies[\s\S]*failedBetModes[\s\S]*failedBetStages[\s\S]*maxConsecutiveFailedBetsByRole[\s\S]*uniqueTxHashes[\s\S]*duplicateNonces[\s\S]*healthGrowth/,
    "testnet soak summary mode must retain sanitized operational and failure counters without raw event payloads",
  );
  assert.match(
    soakSupervisorSource,
    /function formatStatusCounts\(counts\)[\s\S]*safePositiveStatusCount\(count\)[\s\S]*function safePositiveStatusCount\(value\)[\s\S]*const parsed = BigInt\(raw\)[\s\S]*parsed > 0n && parsed <= MAX_SAFE_INTEGER_BIGINT \? Number\(parsed\) : null/,
    "testnet soak compact status counters must be BigInt-bound before Number narrowing",
  );
  assert.doesNotMatch(
    soakSupervisorSource,
    /Number\(count\) > 0/,
    "testnet soak compact status counters must not use broad Number(count) coercion",
  );
  assert.match(
    soakSupervisorSource,
    /status\?\.artifacts\?\.liveLog \|\| readLiveLogPath\(\)/,
    "running soak status must recover the JSONL marker written after the initial status snapshot",
  );
  assert.match(
    soakSupervisorSource,
    /LIVE_LOG_MARKER_SCAN_BYTES[\s\S]*function readLiveLogPath[\s\S]*readSync/,
    "running soak status must scan only a bounded wrapper-log prefix to recover the JSONL marker",
  );
  assert.doesNotMatch(
    soakSupervisorSource,
    /readFileSync\(CANARY_LOG_PATH,\s*"utf8"\)\.match/,
    "running soak status must not load the full wrapper log when recovering the JSONL marker",
  );
  assert.match(
    soakSupervisorSource,
    /numericSummary[\s\S]*p95[\s\S]*growthSummary[\s\S]*estimateGasRetries[\s\S]*rpcFailoverInjectionEvents[\s\S]*healthGrowth/,
    "running soak status must summarize latency, failover, and bounded health growth without raw telemetry",
  );
  assert.match(
    soakSupervisorSource,
    /SLOW_SEND_THRESHOLD_MS = 20_000[\s\S]*slowSendCount/,
    "running soak status must count send delays that cross the RPC timeout threshold",
  );
  assert.match(
    soakSupervisorSource,
    /SOAK_MIN_DISK_FREE_BYTES[\s\S]*while \(!existsSync\(capacityPath\)\)[\s\S]*assertDiskCapacity\(\)[\s\S]*acquireLock\(\)[\s\S]*managedRunStarted = true[\s\S]*writeStatus\("starting"\)/,
    "testnet soak must reject low disk capacity before starting runtime processes or transactions",
  );
  assert.match(
    soakSupervisorSource,
    /function bigIntToNonNegativeSafeInteger\(value\)[\s\S]*typeof value !== "bigint"[\s\S]*MAX_SAFE_INTEGER_BIGINT[\s\S]*diskFreeBytesNow: bigIntToNonNegativeSafeInteger\(freeBytes\)/,
    "testnet soak disk capacity summary must cap BigInt free-space evidence before publishing JSON numbers",
  );
  assert.doesNotMatch(
    soakSupervisorSource,
    /diskFreeBytesNow:\s*Number\(freeBytes\)/,
    "testnet soak disk capacity summary must not publish raw Number(freeBytes)",
  );
  assert.match(
    soakSupervisorSource,
    /SOAK_DISK_CHECK_INTERVAL_MS[\s\S]*function waitForExit\(child\)[\s\S]*setInterval[\s\S]*readDiskCapacitySummary\(\)[\s\S]*disk-capacity-below-minimum[\s\S]*disk-capacity-unavailable[\s\S]*stopChild\(child\)/,
    "running testnet soak must stop its managed canary when disk capacity becomes unsafe",
  );
  assert.match(
    soakSupervisorSource,
    /if \(managedRunStarted\) await shutdown\(message, 1\)/,
    "preflight failures must preserve the previous completed soak status and evidence pointers",
  );
  assert.match(
    cleanupNextCandidatesSource,
    /candidatePattern = \/\^\\\.next-candidate[\s\S]*dirname\(candidate\.path\) !== root[\s\S]*if \(apply\) rmSync/,
    "generated Next cleanup must default to dry-run and constrain recursive deletion to root candidate directories",
  );
  assert.match(
    soakSupervisorSource,
    /lastEventAt[\s\S]*secondsSinceLastEvent/,
    "running soak status must expose a compact event-age signal for stall diagnosis",
  );
  assert.match(
    clearPendingNonceSource,
    /function nonNegativeSafeInteger\(value: unknown\): number[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*pendingNonceGap: nonNegativeSafeInteger\(state\.gap\)[\s\S]*replacementCount: nonNegativeSafeInteger\(replacementCount \+ 1\)/,
    "pending-nonce recovery summary must normalize nonce-gap and replacement counters before publishing JSON",
  );
  assert.doesNotMatch(
    clearPendingNonceSource,
    /pendingNonceGap:\s*Number\(state\.gap\)|replacementCount:\s*replacementCount \+ 1,\s*pendingNonceGap:\s*Number\(state\.gap\)/,
    "pending-nonce recovery summary must not broad-coerce nonce gaps with Number(state.gap)",
  );
  assert.match(
    clearPendingNonceSource,
    /const MAX_REPLACEMENTS = 1[\s\S]*to: address,[\s\S]*value: 0n,[\s\S]*nonce: state\.latest,[\s\S]*gas: 21_000n[\s\S]*return;/,
    "pending-nonce recovery must replace only one blocked nonce with a bounded zero-value self-transfer",
  );
  assert.doesNotMatch(
    clearPendingNonceSource,
    /GAME_ABI|TOKEN_ABI|writeContract/,
    "pending-nonce recovery must not call the game contract or token contract",
  );
  const v10PreviewRunbookSource = readFileSync("docs/production-runbook.md", "utf8");
  assert.match(
    v10PreviewRunbookSource,
    /soak:testnet:clear-pending:summary[\s\S]*pendingGap=0[\s\S]*wouldSend=false[\s\S]*do not execute anything[\s\S]*--execute --confirm-lowest-pending-nonce-replacement[\s\S]*never calls the game or token contracts[\s\S]*post-execution dry-run reports a zero gap/,
    "production runbook must document the bounded pending-nonce recovery procedure before soak restart",
  );
  const soakStatusDir = mkdtempSync(join(tmpdir(), "lore-soak-status-"));
  try {
    const soakStatusFixtureMinimumDiskBytes = 1;
    const soakStatusEnv = {
      ...process.env,
      SOAK_OUT_DIR: soakStatusDir,
      // Status aggregation fixtures must not inherit the host's capacity
      // threshold; the low-capacity branch is asserted explicitly below.
      SOAK_MIN_DISK_FREE_BYTES: String(soakStatusFixtureMinimumDiskBytes),
    };
    const soakLiveLogPath = join(soakStatusDir, "live.jsonl");
    writeFileSync(soakLiveLogPath, `${JSON.stringify({
      mode: "preflight",
      ok: false,
      role: "AUTOMINER_C",
      enoughEth: false,
      enoughToken: true,
      errorKind: "untrusted raw error text",
      timestamp: "2026-07-18T00:00:00.000Z",
    })}\n${JSON.stringify({
      mode: "preflight",
      ok: false,
      role: "AUTOMINER_A",
      enoughEth: true,
      enoughToken: true,
      errorKind: "pending-nonce-blocked",
      timestamp: "2026-07-18T00:00:01.000Z",
    })}\n${JSON.stringify({
      mode: "bitmap",
      ok: true,
      round: 0,
      epochBound: true,
      txStatus: "success",
      role: "MANUAL",
      epoch: "1",
      hash: `0x${"2".repeat(64)}`,
      noncePending: 0,
      timestamp: "2026-07-18T00:00:01.500Z",
    })}\n${JSON.stringify({
      mode: "single",
      ok: false,
      round: 0,
      errorKind: "network",
      role: "MANUAL",
      timestamp: "2026-07-18T00:00:02.000Z",
    })}\n${JSON.stringify({
      mode: "bitmap",
      ok: false,
      round: 1,
      errorKind: "untrusted raw error text",
      role: "AUTOMINER_A",
      timestamp: "2026-07-18T00:00:03.000Z",
    })}\n${JSON.stringify({
      mode: "arrays",
      ok: false,
      round: 2,
      errorKind: "receipt-timeout",
      role: "AUTOMINER_A",
      hash: `0x${"1".repeat(64)}`,
      txStatus: "pending",
      timestamp: "2026-07-18T00:00:04.000Z",
    })}\n${JSON.stringify({
      mode: "sameAmount",
      ok: false,
      round: 3,
      errorKind: "pending-nonce-blocked",
      role: "AUTOMINER_B",
      timestamp: "2026-07-18T00:00:05.000Z",
    })}\n`, "utf8");
    writeFileSync(join(soakStatusDir, "status.json"), `${JSON.stringify({
      status: "failed",
      dryRun: true,
      startedAt: "2026-07-18T00:00:00.000Z",
      finishedAt: "2026-07-18T00:00:01.000Z",
      exitCode: 1,
      stopReason: "canary-1",
      supervisorPid: -1,
      artifacts: { liveLog: soakLiveLogPath },
    })}\n`, "utf8");
    const soakStatusResult = spawnSync(process.execPath, ["scripts/run-testnet-soak-supervisor.mjs", "--status"], {
      cwd: process.cwd(),
      env: soakStatusEnv,
      encoding: "utf8",
    });
    assert.equal(soakStatusResult.status, 0, soakStatusResult.stderr);
    const safeSoakStatus = JSON.parse(soakStatusResult.stdout);
    assert.deepEqual(safeSoakStatus.progress.preflightFailures, [
      { role: "AUTOMINER_C", reason: "insufficient-native-gas" },
      { role: "AUTOMINER_A", reason: "pending-nonce-blocked" },
    ]);
    assert.equal(safeSoakStatus.progress.successfulBets, 1);
    assert.equal(safeSoakStatus.progress.epochBoundBets, 1);
    assert.equal(safeSoakStatus.progress.epochUnboundBets, 0);
    assert.equal(safeSoakStatus.progress.failedBets, 4);
    assert.deepEqual(safeSoakStatus.progress.failedBetErrorKinds, {
      network: 1,
      unknown: 1,
      "receipt-timeout": 1,
      "pending-nonce-blocked": 1,
    });
    assert.deepEqual(safeSoakStatus.progress.failedBetFamilies, { network: 2, "missing-error": 1, "nonce-state": 1 });
    assert.deepEqual(safeSoakStatus.progress.failedBetModes, { single: 1, bitmap: 1, arrays: 1, sameAmount: 1 });
    assert.deepEqual(safeSoakStatus.progress.failedBetRoles, { MANUAL: 1, AUTOMINER_A: 2, AUTOMINER_B: 1 });
    assert.deepEqual(safeSoakStatus.progress.consecutiveFailedBetsByRole, { MANUAL: 1, AUTOMINER_A: 2, AUTOMINER_B: 1 });
    assert.deepEqual(safeSoakStatus.progress.maxConsecutiveFailedBetsByRole, { MANUAL: 1, AUTOMINER_A: 2, AUTOMINER_B: 1 });
    assert.deepEqual(safeSoakStatus.progress.failedBetStages, { "pre-send": 3, "post-send-unconfirmed": 1 });
    assert.equal(safeSoakStatus.diskCapacity.diskCapacityAvailable, true);
    assert.equal(Number.isSafeInteger(safeSoakStatus.diskCapacity.diskFreeBytesNow), true);
    assert.equal(safeSoakStatus.diskCapacity.diskFreeMinimumBytes, soakStatusFixtureMinimumDiskBytes);
    assert.doesNotMatch(soakStatusResult.stdout, /untrusted raw error text/);
    const soakSummaryResult = spawnSync(process.execPath, ["scripts/run-testnet-soak-supervisor.mjs", "--status", "--summary-only"], {
      cwd: process.cwd(),
      env: soakStatusEnv,
      encoding: "utf8",
    });
    assert.equal(soakSummaryResult.status, 0, soakSummaryResult.stderr);
    const safeSoakSummary = JSON.parse(soakSummaryResult.stdout);
    assert.equal(safeSoakSummary.progress.successfulBets, 1);
    assert.equal(safeSoakSummary.progress.epochBoundBets, 1);
    assert.equal(safeSoakSummary.progress.epochUnboundBets, 0);
    assert.deepEqual(safeSoakSummary.progress.successfulBetRoles, { MANUAL: 1 });
    assert.equal(safeSoakSummary.progress.failedBets, 4);
    assert.deepEqual(safeSoakSummary.progress.failedBetRoles, { MANUAL: 1, AUTOMINER_A: 2, AUTOMINER_B: 1 });
    assert.deepEqual(safeSoakSummary.progress.failedBetErrorKinds, {
      network: 1,
      unknown: 1,
      "receipt-timeout": 1,
      "pending-nonce-blocked": 1,
    });
    assert.deepEqual(safeSoakSummary.progress.failedBetFamilies, { network: 2, "missing-error": 1, "nonce-state": 1 });
    assert.deepEqual(safeSoakSummary.progress.failedBetModes, { single: 1, bitmap: 1, arrays: 1, sameAmount: 1 });
    assert.deepEqual(safeSoakSummary.progress.failedBetStages, { "pre-send": 3, "post-send-unconfirmed": 1 });
    assert.deepEqual(safeSoakSummary.progress.maxConsecutiveFailedBetsByRole, {
      MANUAL: 1,
      AUTOMINER_A: 2,
      AUTOMINER_B: 1,
    });
    assert.equal(safeSoakSummary.progress.duplicateNonces, 0);
    assert.equal(safeSoakSummary.diskCapacity.diskCapacityAvailable, true);
    assert.equal(Number.isSafeInteger(safeSoakSummary.diskCapacity.diskFreeBytesNow), true);
    assert.equal(safeSoakSummary.diskCapacity.diskFreeMinimumBytes, soakStatusFixtureMinimumDiskBytes);
    assert.doesNotMatch(soakSummaryResult.stdout, /untrusted raw error text/);
    const soakCompactResult = spawnSync(process.execPath, ["scripts/run-testnet-soak-supervisor.mjs", "--status", "--compact"], {
      cwd: process.cwd(),
      env: soakStatusEnv,
      encoding: "utf8",
    });
    assert.equal(soakCompactResult.status, 0, soakCompactResult.stderr);
    assert.match(
      soakCompactResult.stdout,
      /status=failed dry=true alive=false stop=canary-1 ok=1 bound=1 unbound=0 fail=4 roles=MANUAL=1\/AUTOMINER_A=2,AUTOMINER_B=1,MANUAL=1 epochs=1 tx=1 nonces=1 dupTx=0 dupNonce=0 rev=0 health=0\/0 rpc=0 gas=0 resolver=0 slow=0 p95=n\/a diskLow=false diskFree=\d+ preflight=AUTOMINER_C:insufficient-native-gas,AUTOMINER_A:pending-nonce-blocked fk=network=1,pending-nonce-blocked=1,receipt-timeout=1,unknown=1 ff=missing-error=1,network=2,nonce-state=1/,
      "managed soak compact status must surface safe one-line aggregates without raw logs or addresses",
    );
    assert.doesNotMatch(soakCompactResult.stdout, /0x[a-fA-F0-9]{40}|untrusted raw error text|\{|\}/);
    const lowDiskSoakSummaryResult = spawnSync(process.execPath, ["scripts/run-testnet-soak-supervisor.mjs", "--status", "--summary-only"], {
      cwd: process.cwd(),
      env: { ...soakStatusEnv, SOAK_MIN_DISK_FREE_BYTES: String(Number.MAX_SAFE_INTEGER) },
      encoding: "utf8",
    });
    assert.equal(lowDiskSoakSummaryResult.status, 1, lowDiskSoakSummaryResult.stderr);
    const lowDiskSoakSummary = JSON.parse(lowDiskSoakSummaryResult.stdout);
    assert.equal(lowDiskSoakSummary.diskCapacity.diskCapacityAvailable, true);
    assert.equal(lowDiskSoakSummary.diskCapacity.diskFreeBelowMinimum, true);
    assert.equal(lowDiskSoakSummary.diskCapacity.diskFreeMinimumBytes, Number.MAX_SAFE_INTEGER);

    writeFileSync(join(soakStatusDir, "status.json"), `${JSON.stringify({
      status: "failed",
      dryRun: true,
      startedAt: "2026-07-18T00:00:00.000Z",
      finishedAt: "2026-07-18T00:00:01.000Z",
      exitCode: 1,
      stopReason: "canary-directory-log",
      supervisorPid: -1,
      artifacts: { liveLog: soakStatusDir },
    })}\n`, "utf8");
    const soakDirectoryLogResult = spawnSync(process.execPath, ["scripts/run-testnet-soak-supervisor.mjs", "--status", "--summary-only"], {
      cwd: process.cwd(),
      env: soakStatusEnv,
      encoding: "utf8",
    });
    assert.equal(soakDirectoryLogResult.status, 0, soakDirectoryLogResult.stderr);
    const safeDirectoryLogSummary = JSON.parse(soakDirectoryLogResult.stdout);
    assert.equal(safeDirectoryLogSummary.hasLiveLog, false, "directory live-log paths must not be reported as present");
    assert.equal(safeDirectoryLogSummary.progress.successfulBets, 0, "directory live-log paths must not be streamed");

    writeFileSync(join(soakStatusDir, "status.json"), `${JSON.stringify({
      status: "running",
      dryRun: true,
      startedAt: "2026-07-18T00:00:00.000Z",
      supervisorPid: "1e3",
      artifacts: { liveLog: soakLiveLogPath },
    })}\n`, "utf8");
    writeFileSync(join(soakStatusDir, "supervisor.lock"), `${JSON.stringify({
      pid: "1e3",
      startedAt: "2026-07-18T00:00:00.000Z",
    })}\n`, "utf8");
    const malformedPidStatusResult = spawnSync(process.execPath, ["scripts/run-testnet-soak-supervisor.mjs", "--status", "--summary-only"], {
      cwd: process.cwd(),
      env: soakStatusEnv,
      encoding: "utf8",
    });
    assert.equal(malformedPidStatusResult.status, 0, malformedPidStatusResult.stderr);
    const malformedPidStatus = JSON.parse(malformedPidStatusResult.stdout);
    assert.equal(malformedPidStatus.supervisorAlive, false, "malformed matching PID strings must not count as an alive managed supervisor");
    writeFileSync(join(soakStatusDir, "status.json"), JSON.stringify({
      status: "running",
      supervisorPid: String(process.pid),
      startedAt: "2026-07-18T00:00:00.000Z",
      padding: "x".repeat(128 * 1024),
    }), "utf8");
    writeFileSync(join(soakStatusDir, "supervisor.lock"), JSON.stringify({
      pid: String(process.pid),
      startedAt: "2026-07-18T00:00:00.000Z",
    }), "utf8");
    const oversizedStatusResult = spawnSync(process.execPath, ["scripts/run-testnet-soak-supervisor.mjs", "--status", "--summary-only"], {
      cwd: process.cwd(),
      env: soakStatusEnv,
      encoding: "utf8",
    });
    assert.equal(oversizedStatusResult.status, 0, oversizedStatusResult.stderr);
    const oversizedStatus = JSON.parse(oversizedStatusResult.stdout);
    assert.equal(oversizedStatus.status, "not-started", "oversized status JSON must not be parsed as trusted running state");
    assert.equal(oversizedStatus.supervisorAlive, false, "oversized status JSON must not combine with lock evidence to mark a supervisor alive");
    writeFileSync(join(soakStatusDir, "status.json"), JSON.stringify({
      status: "running",
      dryRun: true,
      supervisorPid: String(process.pid),
      startedAt: "2026-07-18T00:00:00.000Z",
    }), "utf8");
    writeFileSync(join(soakStatusDir, "supervisor.lock"), JSON.stringify({
      pid: String(process.pid),
      startedAt: "2026-07-18T00:00:00.000Z",
      padding: "x".repeat(4 * 1024),
    }), "utf8");
    const oversizedLockStatusResult = spawnSync(process.execPath, ["scripts/run-testnet-soak-supervisor.mjs", "--status", "--summary-only"], {
      cwd: process.cwd(),
      env: soakStatusEnv,
      encoding: "utf8",
    });
    assert.equal(oversizedLockStatusResult.status, 0, oversizedLockStatusResult.stderr);
    const oversizedLockStatus = JSON.parse(oversizedLockStatusResult.stdout);
    assert.equal(oversizedLockStatus.status, "running", "oversized lock JSON must not hide the bounded status JSON");
    assert.equal(oversizedLockStatus.supervisorAlive, false, "oversized lock JSON must not be parsed as matching supervisor evidence");
  } finally {
    rmSync(soakStatusDir, { recursive: true, force: true });
  }
  assert.match(
    analyzeCanarySource,
    /successful health samples[\s\S]*failed health samples/,
    "strict canary proof must reject incomplete health telemetry when sampling was enabled",
  );
  assert.match(
    liveRoundCanarySource,
    /LIVE_TEST_ROLES \?\? "MANUAL,AUTOMINER_A,AUTOMINER_B"/,
    "live canary default role set must stay MANUAL/AUTOMINER_A/AUTOMINER_B unless explicitly overridden",
  );
  assert.match(
    liveRoundCanarySource,
    /SAFE_ROLE_NAMES[\s\S]*MANUAL[\s\S]*AUTOMINER_A[\s\S]*AUTOMINER_B[\s\S]*AUTOMINER_C[\s\S]*LIVE_TEST_ROLES contains unsupported role/,
    "live canary must reject unsupported role overrides before wallet lookup",
  );
  assert.match(
    liveRoundCanarySource,
    /ROLES\.length === 0[\s\S]*LIVE_TEST_ROLES must include at least one supported role[\s\S]*new Set\(ROLES\)\.size !== ROLES\.length[\s\S]*LIVE_TEST_ROLES contains duplicate roles/,
    "live canary must reject empty and duplicate role overrides before wallet lookup",
  );
  assert.match(
    soakSupervisorSource,
    /LIVE_TEST_ROLES: process\.env\.LIVE_TEST_ROLES \|\| "MANUAL,AUTOMINER_A,AUTOMINER_B"/,
    "managed soak supervisor must pass the same three-role default to the live canary",
  );
  assert.match(
    liveRoundCanarySource,
    /LIVE_TEST_INJECT_RPC_FAILOVER[\s\S]*Injected RPC transport failure before dispatch[\s\S]*fallback\(transports\)/,
    "live canary RPC injection must fail before dispatch and exercise the configured fallback transport",
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
    /LIVE_TEST_VERBOSE_TARGETS[\s\S]*contract=\$\{VERBOSE_TARGETS \? CONTRACT_ADDRESS : "configured"\}[\s\S]*token=\$\{VERBOSE_TARGETS \? LINEA_TOKEN_ADDRESS : "configured"\}/,
    "live canary must keep contract and token addresses behind an explicit opt-in for routine dry-runs",
  );
  assert.match(
    liveRoundCanarySource,
    /CANONICAL_INTEGER_ENV_RE[\s\S]*function parseIntegerEnv\(name: string, fallbackValue: number, min: number, max: number\)[\s\S]*CANONICAL_INTEGER_ENV_RE\.test\(raw\)[\s\S]*Number\.isSafeInteger\(parsed\)/,
    "live canary integer env parsing must require canonical safe integers before dry-run or live setup",
  );
  assert.doesNotMatch(
    liveRoundCanarySource,
    /function parseIntegerEnv\(name: string, fallbackValue: number, min: number, max: number\)[\s\S]*const parsed = Number\(raw\);\s*if \(!Number\.isInteger\(parsed\)/,
    "live canary integer env parsing must not accept exponent, fractional, or leading-zero values through broad Number(raw) coercion",
  );
  assert.match(
    liveRoundCanarySource,
    /LIVE_TEST_REPEAT_SAME_BET[\s\S]*repeat: true[\s\S]*if \(REPEAT_SAME_BET\) throw error/,
    "live canary fee measurement must be explicit and stop after a failed duplicate bet",
  );
  assert.match(
    liveRoundCanarySource,
    /walletPreflight ready=.*roles=.*\n.*if \(VERBOSE_WALLET_PREFLIGHT\) console\.table\(rows\)/s,
    "live canary must default to a redacted wallet preflight summary",
  );
  assert.match(
    liveRoundCanarySource,
    /let emptyResolveBootstrapUsed = false[\s\S]*emptyEpoch && \(!ALLOW_EMPTY_RESOLVE \|\| emptyResolveBootstrapUsed\)\) return[\s\S]*emptyEpoch && receipt\.status === "success"\) emptyResolveBootstrapUsed = true/,
    "live canary must allow at most one explicit empty-epoch bootstrap",
  );
  assert.match(
    liveRoundCanarySource,
    /RESOLVE_GAS_FLOOR[\s\S]*gasEstimate > RESOLVE_GAS_FLOOR \? gasEstimate : RESOLVE_GAS_FLOOR[\s\S]*gasEstimate: gasEstimate\.toString\(\)[\s\S]*gasLimit: gas\.toString\(\)/,
    "resolver canary must protect variable randomness branches with a floor and preserve estimate-versus-limit evidence",
  );
  assert.match(
    liveRoundCanarySource,
    /function bigintDeltaToBoundedSeconds\(upper: bigint, lower: bigint\)[\s\S]*Number\.MAX_SAFE_INTEGER[\s\S]*Number\.MIN_SAFE_INTEGER[\s\S]*const secondsLeft = bigintDeltaToBoundedSeconds\(endTime, block\.timestamp\)/,
    "live canary must bound epoch-window second deltas before safe-window decisions",
  );
  assert.doesNotMatch(
    liveRoundCanarySource,
    /(^|[^A-Za-z0-9_])Number\(endTime - block\.timestamp\)/,
    "live canary must not broadly coerce epoch-window second deltas",
  );
  assert.match(
    liveRoundCanarySource,
    /window\.secondsLeft <= 0[\s\S]*epochData\[0\] === 0n\) return \{ \.\.\.window, atomicAdvance: true \}[\s\S]*recordedEpoch = atomicAdvance && receipt\.status === "success" \? epoch \+ 1n : epoch/,
    "live canary must atomically advance an expired empty epoch without paying the resolver",
  );
  assert.match(
    liveRoundCanarySource,
    /window\.secondsLeft <= 0[\s\S]*params\.afterEpoch == null \|\| window\.epoch >= params\.afterEpoch[\s\S]*epochData\[0\] === 0n\) return \{ \.\.\.window, atomicAdvance: true \}/,
    "live canary must recover from a reverted bet that leaves the same expired epoch empty",
  );
  assert.match(
    liveRoundCanarySource,
    /errorKind: receipt\.status === "reverted" \? "contract-revert" : undefined/,
    "live canary must classify confirmed receipt reverts without preserving raw provider errors",
  );

  const indexerSource = readFileSync("scripts/indexer.ts", "utf8");
  assert.match(
    indexerSource,
    /function filterLogsByTopics[\s\S]*topics\.every/,
    "indexer reconciliation must locally verify every requested topic",
  );
  assert.match(
    indexerSource,
    /fetchAllLogs[\s\S]*fetchLogsByTopicsAdaptive\(\[\], "ContractEvents"/,
    "indexer must fetch each contract chunk once per independent RPC, then classify topics locally",
  );
  assert.match(
    indexerSource,
    /const REPAIR_CHUNK_BLOCKS = 10_000n/,
    "indexer repair must stay within the confirmed Sepolia RPC log range",
  );
  assert.match(
    indexerSource,
    /RECONCILE_SCAN_CHUNK_BLOCKS = CHUNK_BLOCKS[\s\S]*recentCandidate[\s\S]*recentCandidate > INDEXER_START_BLOCK/,
    "indexer reconcile must stay within the supported log range and never scan before deployment",
  );
  assert.match(
    indexerSource,
    /recordIndexerWatchFailure\(consecutiveFailures, WATCH_FAILURE_LIMIT\)[\s\S]*Persistent watch failure threshold reached; exiting for supervisor restart[\s\S]*process\.exit\(1\)/,
    "persistent indexer watch failures must exit for supervisor restart",
  );
  assert.match(
    indexerSource,
    /watchTimer = setInterval[\s\S]*await runIndexerPass\(\);[\s\S]*consecutiveFailures = 0;/,
    "a successful indexer watch cycle must reset the failure threshold",
  );
  assert.match(
    indexerSource,
    /function parseChainCurrentEpochNumber\(value: bigint, observedBlock: bigint\)[\s\S]*parsePlausibleCurrentEpoch\(value, INDEXER_START_BLOCK, observedBlock\)[\s\S]*const currentEpochNumber = parseChainCurrentEpochNumber\(currentEpoch, currentBlock\)[\s\S]*storagePut\("gamedata\/_meta\/currentEpoch", currentEpochNumber\)[\s\S]*createReconcileEpochPlan\(\{[\s\S]*currentEpoch: currentEpochNumber/,
    "indexer must safely narrow chain currentEpoch before metadata writes and reconcile range construction",
  );
  assert.match(
    indexerSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*CANONICAL_INDEXED_EPOCH_RE = \/\^\[1-9\]\\d\{0,15\}\$\/[\s\S]*function parseIndexedEpochKey\(value: string\)[\s\S]*CANONICAL_INDEXED_EPOCH_RE\.test\(value\)[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed <= MAX_SAFE_INTEGER_BIGINT \? Number\(parsed\) : null[\s\S]*const n = parseIndexedEpochKey\(key\)/,
    "indexer reconcile must BigInt-bound stored epoch keys before missing-epoch checks",
  );
  assert.doesNotMatch(
    indexerSource,
    /(^|[^A-Za-z0-9_])Number\(currentEpoch\)/,
    "indexer must not broadly coerce chain currentEpoch evidence",
  );
  assert.doesNotMatch(
    indexerSource,
    /function parseIndexedEpochKey\(value: string\)\s*{\s*if \(!CANONICAL_INDEXED_EPOCH_RE\.test\(value\)\) return null;\s*const parsed = Number\(value\)|const n = Number\(key\)[\s\S]*Number\.isInteger\(n\)/,
    "indexer reconcile must not broadly coerce stored epoch keys",
  );
  assert.match(
    indexerSource,
    /function buildNormalizedEventId\(log: Log\)[\s\S]*!log\.transactionHash \|\| log\.logIndex === null \|\| log\.logIndex === undefined[\s\S]*const normalizedHash = log\.transactionHash\.toLowerCase\(\)\.trim\(\)[\s\S]*\/\^0x\[0-9a-f\]\{64\}\$\/\.test\(normalizedHash\)[\s\S]*return `\$\{normalizedHash\}_\$\{log\.logIndex\.toString\(\)\}`/,
    "indexer normalized transaction events must require a full 32-byte tx hash and log index before building storage ids",
  );
  assert.doesNotMatch(
    indexerSource,
    /return `\$\{log\.transactionHash\.toLowerCase\(\)\}_\$\{log\.logIndex\.toString\(\)\}`/,
    "indexer normalized transaction events must not use raw transactionHash strings as storage ids",
  );
  assert.match(
    indexerSource,
    /buildIndexerBetIdentity,[\s\S]*const identity = buildIndexerBetIdentity\([\s\S]*normalizedBet\.logIndex[\s\S]*if \(identity === null\) continue;[\s\S]*patch\[identity\.id\]/,
    "indexer bet writes must use the shared transaction-hash and log-index identity boundary",
  );
  assert.doesNotMatch(
    indexerSource,
    /\/\^0x\[0-9a-f\]\+\$\/\.test\(normalizedHash\)/,
    "indexer bet storage keys must not accept short or malformed tx hashes as tx identity",
  );
  assert.doesNotMatch(
    indexerSource,
    /id:\s*`\$\{log\.transactionHash \?\? "nohash"\}_\$\{log\.logIndex\?\.toString\(\) \?\? "0"\}`/,
    "indexer normalized claim/dust/resolver/fee events must not collapse partial logs into nohash_0 ids",
  );
  assert.match(
    liveRoundCanarySource,
    /afterEpoch\?: bigint \| null[\s\S]*window\.epoch > params\.afterEpoch[\s\S]*lastAttemptedEpoch = BigInt\(event\.epoch \?\? epoch\)/,
    "canary must require a strictly newer epoch and retain the actual epoch after an atomic advance",
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
  assert.match(
    walletPlaytestSource,
    /MAX_PLAYTEST_JSON_RESPONSE_BYTES[\s\S]*CONTENT_LENGTH_RE[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function readBoundedResponseText[\s\S]*parseContentLengthHeader\(response\.headers\.get\("content-length"\)\)[\s\S]*new TextDecoder\("utf-8", \{ fatal: true \}\)[\s\S]*function parseContentLengthHeader\(value: string \| null\)[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)/,
    "wallet playtest API reads must strictly parse and bound response bodies",
  );
  assert.doesNotMatch(
    walletPlaytestSource,
    /Number\(response\.headers\.get\("content-length"\)\)/,
    "wallet playtest API reads must not broadly coerce content-length headers",
  );
  assert.match(
    walletPlaytestSource,
    /API_FETCH_TIMEOUT_MS[\s\S]*fetchJson[\s\S]*AbortSignal\.timeout\(API_FETCH_TIMEOUT_MS\)[\s\S]*accept: "text\/html"[\s\S]*AbortSignal\.timeout\(API_FETCH_TIMEOUT_MS\)/,
    "wallet playtest API and home probes must use bounded request timeouts",
  );
  assert.doesNotMatch(
    walletPlaytestSource,
    /response\.text\(\)/,
    "wallet playtest must not read unbounded API response text",
  );
  assert.match(
    walletPlaytestSource,
    /supportsEpochBoundBets[\s\S]*getBytecode[\s\S]*CONTRACT_REQUIRES_EPOCH_BOUND_BETS[\s\S]*placeBatchBetsBitmapForEpoch[\s\S]*\[epoch, tileIdsToMask\(tiles\), amount\]/,
    "wallet playtest must detect and use the protected epoch-bound bitmap path",
  );
  assert.match(
    walletPlaytestSource,
    /const singleTx = useEpochBoundBets[\s\S]*const batchTx = useEpochBoundBets/,
    "wallet playtest must keep both V10 sends on the protected path",
  );
  assert.match(
    walletPlaytestSource,
    /EXECUTE_REQUESTED = process\.argv\.includes\("--execute"\)[\s\S]*LIVE_EXECUTION_CONFIRMED = process\.env\.TEST_WALLET_EXECUTE === "1" && EXECUTE_REQUESTED[\s\S]*DRY_RUN = !LIVE_EXECUTION_CONFIRMED/,
    "wallet playtest must default to dry-run and require both an env flag and execute flag for live execution",
  );
  assert.match(
    walletPlaytestSource,
    /EXECUTE_REQUESTED && process\.env\.TEST_WALLET_EXECUTE !== "1"[\s\S]*Refusing wallet playtest execution without TEST_WALLET_EXECUTE=1[\s\S]*account = LIVE_EXECUTION_CONFIRMED && process\.env\.TEST_WALLET_PRIVATE_KEY/,
    "wallet playtest must fail closed on --execute alone before loading signing material",
  );
  assert.match(
    liveRoundCanarySource,
    /const DRY_RUN = !LIVE_EXECUTION_CONFIRMED[\s\S]*PUBLIC_ADDRESS_ENV_PATH = "\.env\.live-test-addresses"[\s\S]*loadPublicAddressEnvFileIfPresent\(\);[\s\S]*DRY_RUN && hasSigningMaterialInEnvironment\(\)[\s\S]*function loadWallets\(\)[\s\S]*loadSigningEnvFileIfPresent\(\)[\s\S]*function loadDryRunWallets\(\)[\s\S]*LORE_LIVE_TEST_\$\{role\}_ADDRESS[\s\S]*const wallets = DRY_RUN \? loadDryRunWallets\(\) : loadWallets\(\)/,
    "live canary dry-run must read only public role addresses and defer wallet-key loading to explicit execution",
  );
  assert.match(
    liveRoundCanarySource,
    /await runPreflight\(logPath, publicClient, wallets, plannedSpendByRole\);\s*if \(DRY_RUN\) return;[\s\S]*LORE_LIVE_TEST_RESOLVER_PRIVATE_KEY[\s\S]*privateKeyToAccount/,
    "live canary dry-run must not parse optional resolver signing material before returning",
  );
  const v10DryRunPreviewSource = readFileSync("scripts/create-v10-canary-dry-run-preview.mjs", "utf8");
  const v10DryRunPreviewCheckSource = readFileSync("scripts/check-v10-dry-run-preview.mjs", "utf8");
  assert.equal(
    packageScripts["preview:canary:v10:dry-run"],
    "node scripts/create-v10-canary-dry-run-preview.mjs",
    "V10 dry-run Preview must expose a one-command reproducible operator path",
  );
  assert.equal(
    packageScripts["preview:canary:v10:dry-run:summary"],
    "node scripts/check-v10-dry-run-preview.mjs",
    "V10 dry-run Preview must expose a lightweight validator for autonomous status without rerunning live dry-run commands",
  );
  assert.equal(
    packageScripts["preview:canary:v10:authorization-ready:summary"],
    "node scripts/check-v10-dry-run-preview.mjs --require-fresh-authorization",
    "V10 dry-run Preview must expose a strict freshness validator before requesting real-transaction authorization",
  );
  assert.match(
    v10DryRunPreviewCheckSource,
    /staleError\.previewAgeMinutes = Math\.floor\(ageMs \/ 60_000\)[\s\S]*previewAgeMinutes[\s\S]*ageMinutes: previewAgeMinutes/,
    "V10 dry-run Preview stale authorization failures must report the actual Preview age instead of letting dashboards show ageMinutes=0",
  );
  assert.match(
    v10DryRunPreviewSource,
    /plan:canary:v10:postdeploy:summary[\s\S]*soak:testnet:clear-pending:summary[\s\S]*live:canary:v10:matrix[\s\S]*analyze-live-canary-proof\.mjs[\s\S]*--profile=v10-matrix[\s\S]*--require-epoch-bound[\s\S]*--require-v10-gas-matrix/,
    "V10 dry-run Preview must compose the read-only planner, pending nonce dry-run, V10 matrix dry-run, and strict analyzer",
  );
  assert.match(
    v10DryRunPreviewSource,
    /LIVE_TEST_DRY_RUN: "1"[\s\S]*LIVE_TEST_EXECUTE: "0"[\s\S]*SOAK_EXECUTE_LIVE: "0"[\s\S]*TEST_WALLET_EXECUTE: "0"/,
    "V10 dry-run Preview must force child commands into non-executing dry-run mode",
  );
  assert.match(
    v10DryRunPreviewSource,
    /parseSummaryTimeoutEnv[\s\S]*V10_CANARY_DRY_RUN_PREVIEW_TIMEOUT_MS", 240_000[\s\S]*timeout: CHILD_TIMEOUT_MS/,
    "V10 dry-run Preview timeout env must be canonical decimal and range checked before child process execution",
  );
  assert.doesNotMatch(
    v10DryRunPreviewSource,
    /Number\.parseInt\(process\.env\.V10_CANARY_DRY_RUN_PREVIEW_TIMEOUT_MS|Number\.isFinite\(CHILD_TIMEOUT_MS\)/,
    "V10 dry-run Preview timeout env must not use partial parseInt or broad numeric fallback",
  );
  assert.doesNotMatch(
    v10DryRunPreviewSource,
    /--execute-live|--execute"|--confirm-lowest-pending-nonce-replacement|LIVE_TEST_EXECUTE: "1"|SOAK_EXECUTE_LIVE: "1"|TEST_WALLET_EXECUTE: "1"/,
    "V10 dry-run Preview must not contain live execution flags or enabling env values",
  );
  assert.match(
    v10DryRunPreviewSource,
    /redactProofText[\s\S]*docs["'], ["']v10-canary-dry-run-preview\.md[\s\S]*dryRunProofBlocksG10G11[\s\S]*Fresh Consent Boundary/,
    "V10 dry-run Preview must write a redacted markdown Preview and keep G10/G11 blocked until live evidence exists",
  );
  assert.match(
    v10DryRunPreviewSource,
    /MAX_PREVIEW_FIELD_CHARS[\s\S]*function bullet\(label, value\)[\s\S]*formatPreviewField\(value\)[\s\S]*function formatPreviewField\(value\)[\s\S]*redactProofText\(String\(value\)\)[\s\S]*replace\(\/\\s\+\/g, " "\)[\s\S]*<truncated>/,
    "V10 dry-run Preview compact bullet fields must be redacted, single-line, and bounded",
  );
  assert.match(
    v10DryRunPreviewSource,
    /function extractCanaryLog\(output\)[\s\S]*safeCanaryLogPath\(raw\)[\s\S]*function safeCanaryLogPath\(value\)[\s\S]*path\.isAbsolute\(normalized\)[\s\S]*data[\s\S]*live-test-runs[\s\S]*\^live-canary-\[0-9TZ-\]\+\\\.jsonl\$/,
    "V10 dry-run Preview must accept only relative live-test-run canary logs before running the analyzer",
  );
  assert.doesNotMatch(
    v10DryRunPreviewSource,
    /function extractCanaryLog\(output\)[\s\S]*return extractValue\(output,[\s\S]*\?\? extractValue\(output,/,
    "V10 dry-run Preview must not pass raw child log paths directly into the analyzer",
  );
  assert.match(
    v10DryRunPreviewCheckSource,
    /PREVIEW_PATH = path\.join\("docs", "v10-canary-dry-run-preview\.md"\)[\s\S]*MAX_PREVIEW_BYTES = 512 \* 1024[\s\S]*MAX_DRY_RUN_LOG_BYTES = 256 \* 1024[\s\S]*V10_DRY_RUN_PREVIEW_MAX_AGE_MS/,
    "V10 dry-run Preview validator must use bounded artifact reads and a freshness window",
  );
  assert.match(
    v10DryRunPreviewCheckSource,
    /function parsePositiveIntegerEnv\(name, fallback, min, max\)[\s\S]*DECIMAL_INTEGER_RE[\s\S]*const parsed = BigInt\(raw\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)/,
    "V10 dry-run Preview validator freshness env must be BigInt-bound before Number narrowing",
  );
  assert.match(
    v10DryRunPreviewCheckSource,
    /not an authorization to send transactions[\s\S]*Do not execute any of the following without a fresh exact authorization[\s\S]*requireBullet\(overall, "transactionSent", "false"\)[\s\S]*requireBullet\(overall, "dryRunProofBlocksG10G11", "true"\)/,
    "V10 dry-run Preview validator must preserve non-authorization, fresh consent, no-transaction, and G10/G11 blocked boundaries",
  );
  assert.match(
    v10DryRunPreviewCheckSource,
    /function safeCanaryLogPath\(value\)[\s\S]*path\.isAbsolute\(normalized\)[\s\S]*data[\s\S]*live-test-runs[\s\S]*\^live-canary-\[0-9TZ-\]\+\\\.jsonl\$[\s\S]*readBoundedText\(logPath, MAX_DRY_RUN_LOG_BYTES/,
    "V10 dry-run Preview validator must only validate bounded safe relative dry-run logs",
  );
  assert.doesNotMatch(
    v10DryRunPreviewCheckSource,
    /preview:canary:v10:dry-run|live:canary:v10:matrix|--execute-live|LIVE_TEST_EXECUTE: "1"|SOAK_EXECUTE_LIVE: "1"/,
    "V10 dry-run Preview validator must not rerun Preview commands or contain live execution flags",
  );
  assert.match(
    walletPlaytestSource,
    /import \{ redactProofText \} from "\.\/redact-proof-output\.mjs"[\s\S]*function describePlaytestError\(error: unknown\)[\s\S]*redactProofText\(/,
    "wallet playtest terminal diagnostics must use the shared proof redactor",
  );
  assert.match(
    walletPlaytestSource,
    /MAX_PLAYTEST_ERROR_CHARS[\s\S]*<truncated>[\s\S]*const bitmapMessage = describePlaytestError\(bitmapError\)[\s\S]*const message = describePlaytestError\(error\)[\s\S]*\[playtest\] failed: \$\{describePlaytestError\(error\)\}/,
    "wallet playtest fallback and fatal errors must be compact and bounded",
  );
  assert.doesNotMatch(
    walletPlaytestSource,
    /console\.error\("\[playtest\] failed", error\)/,
    "wallet playtest must not print raw fatal Error objects",
  );
  const v10CompilerMatrixSource = readFileSync("scripts/benchmark-contract-v10.mjs", "utf8");
  const v10BenchmarkSource = readFileSync("scripts/benchmark-v10-linea-gas.ts", "utf8");
  assert.match(
    v10CompilerMatrixSource,
    /MAX_BENCHMARK_CONTRACT_SOURCE_BYTES = 2 \* 1024 \* 1024[\s\S]*function readBoundedUtf8File\(filePath, maxBytes, label\)[\s\S]*const stats = fs\.statSync\(filePath\)[\s\S]*!stats\.isFile\(\)[\s\S]*stats\.size > maxBytes[\s\S]*too large to benchmark safely[\s\S]*fs\.readFileSync\(filePath, "utf8"\)/,
    "V10 compiler matrix benchmark must size-gate local contract sources and imports before reading",
  );
  assert.match(
    v10CompilerMatrixSource,
    /function readImport\(importPath\)[\s\S]*path\.resolve\(importPath\)[\s\S]*path\.resolve\("node_modules", importPath\)[\s\S]*readBoundedUtf8File\(candidate, MAX_BENCHMARK_CONTRACT_SOURCE_BYTES[\s\S]*error\?\.code !== "ENOENT"[\s\S]*throw error/,
    "V10 compiler matrix benchmark must keep deterministic import lookup while failing closed on non-file or oversized matches",
  );
  assert.match(
    v10CompilerMatrixSource,
    /function compile\(\{ compiler, contractPath, contractName, runs, viaIR \}\)[\s\S]*readBoundedUtf8File\([\s\S]*contractPath[\s\S]*MAX_BENCHMARK_CONTRACT_SOURCE_BYTES[\s\S]*`contract source \$\{contractPath\}`[\s\S]*replace\(\/\\r\\n\?\//,
    "V10 compiler matrix benchmark must size-gate root contract sources before compiling",
  );
  assert.match(
    v10BenchmarkSource,
    /BEHAVIOR_ONLY_TIMEOUT_MS[\s\S]*withBenchmarkTimeout[\s\S]*behavior-benchmark-timeout/,
    "V10 behavior benchmark must fail closed instead of hanging indefinitely",
  );
  assert.match(
    v10BenchmarkSource,
    /DECIMAL_INTEGER_RE[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*BEHAVIOR_ONLY_TIMEOUT_MS = parsePositiveIntegerEnv\("V10_BEHAVIOR_TIMEOUT_MS", 90_000, 1_000, 900_000\)[\s\S]*function parsePositiveIntegerEnv\(name: string, fallback: number, min: number, max: number\): number[\s\S]*function parsePositiveIntegerValue\(name: string, raw: string, min: number, max: number\): number[\s\S]*const parsed = BigInt\(raw\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*const numeric = Number\(parsed\)[\s\S]*Number\.isSafeInteger\(numeric\)/,
    "V10 behavior benchmark timeout env must be canonical decimal and range checked before the timeout guard",
  );
  assert.match(
    v10BenchmarkSource,
    /function parsePositiveIntegerValue\(name: string, raw: string, min: number, max: number\): number[\s\S]*must be a canonical decimal integer[\s\S]*const parsed = BigInt\(raw\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*const numeric = Number\(parsed\)[\s\S]*Number\.isSafeInteger\(numeric\)[\s\S]*v10RunsArg !== undefined[\s\S]*parsePositiveIntegerValue\("--v10-runs", v10RunsArg, 1, 1_000_000\)/,
    "V10 gas benchmark optimizer run CLI override must reject partial, malformed, and out-of-range values",
  );
  assert.doesNotMatch(
    v10BenchmarkSource,
    /behaviorOnlyTimeoutOverride|Number\.parseInt\(process\.env\.V10_BEHAVIOR_TIMEOUT_MS|Number\.parseInt\(v10RunsArg|const parsed = Number\(raw\)/,
    "V10 behavior benchmark timeout env and optimizer run override must not use partial parseInt coercion",
  );
  assert.match(
    v10BenchmarkSource,
    /type BenchmarkRow = \{[\s\S]*gasLimit: number;[\s\S]*gasDeltaVsV9\?: number;[\s\S]*function toSafeDisplayInteger\(value: bigint, label: string\): number[\s\S]*value < 0n \|\| value > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(value\)[\s\S]*const rows: BenchmarkRow\[\] = \[\][\s\S]*gasLimitNumber = toSafeDisplayInteger\(gasLimit[\s\S]*gasLimit: gasLimitNumber[\s\S]*gasLimit: toSafeDisplayInteger\(BigInt\(estimate\.gasLimit\)[\s\S]*baselineByCase[\s\S]*row\.gasLimit - baseline[\s\S]*row\.gasDeltaVsV9 >= 0/,
    "V10 gas benchmark must safely narrow RPC gas limits before report rows and regression deltas",
  );
  assert.doesNotMatch(
    v10BenchmarkSource,
    /Number\(BigInt\((?:estimate|jackpotCheckEstimate|jackpotAwardEstimate|emptyAdvanceEstimate)\.gasLimit\)\)|Number\((?:v9Deployment|v10Deployment)\.gasLimit\)|Number\(row\.gasLimit\)|Number\(row\.gasDeltaVsV9\)/,
    "V10 gas benchmark must not broadly coerce gas-limit or delta fields after parsing",
  );
  assert.match(
    v10BenchmarkSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*MAX_RPC_RESPONSE_BYTES[\s\S]*CONTENT_LENGTH_RE[\s\S]*function parseContentLengthHeader\(value: string \| null\)[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*async function readBoundedJsonResponse[\s\S]*parseContentLengthHeader\(response\.headers\.get\("content-length"\)\)[\s\S]*new TextDecoder\("utf-8", \{ fatal: true \}\)[\s\S]*reader\.cancel[\s\S]*rpcRequest/,
    "V10 Linea gas benchmark RPC reads must strictly parse and bound JSON response bodies in the shared helper",
  );
  assert.match(
    v10BenchmarkSource,
    /MAX_BENCHMARK_SOURCE_BYTES = 2 \* 1024 \* 1024;[\s\S]*MAX_BENCHMARK_COMPILER_CONFIG_BYTES = 512 \* 1024;[\s\S]*MAX_PREPARED_INITCODE_BYTES = 256 \* 1024;[\s\S]*function readBoundedUtf8File\(filePath: string, maxBytes: number, label: string\): string[\s\S]*const stats = fs\.statSync\(filePath\)[\s\S]*!stats\.isFile\(\)[\s\S]*stats\.size > maxBytes[\s\S]*too large to benchmark safely[\s\S]*fs\.readFileSync\(filePath, "utf8"\)/,
    "V10 gas benchmark must size-gate local source, compiler config, and prepared initcode reads",
  );
  assert.match(
    v10BenchmarkSource,
    /JSON\.parse\([\s\S]*readBoundedUtf8File\([\s\S]*"contracts\/LineaOreV10\.compiler-config\.json"[\s\S]*MAX_BENCHMARK_COMPILER_CONFIG_BYTES[\s\S]*"V10 compiler config"/,
    "V10 gas benchmark must size-gate the compiler config before JSON parsing",
  );
  assert.match(
    v10BenchmarkSource,
    /function readImport\(importPath: string\)[\s\S]*path\.resolve\(importPath\)[\s\S]*path\.resolve\("node_modules", importPath\)[\s\S]*readBoundedUtf8File\(candidate, MAX_BENCHMARK_SOURCE_BYTES[\s\S]*NodeJS\.ErrnoException[\s\S]*code !== "ENOENT"[\s\S]*throw error/,
    "V10 gas benchmark must keep deterministic import lookup while failing closed on non-file or oversized matches",
  );
  assert.match(
    v10BenchmarkSource,
    /function compileContract\([\s\S]*readBoundedUtf8File\([\s\S]*contractPath[\s\S]*MAX_BENCHMARK_SOURCE_BYTES[\s\S]*`contract source \$\{contractPath\}`[\s\S]*replace\(\/\\r\\n\?\//,
    "V10 gas benchmark must size-gate root contract sources before compiling",
  );
  assert.match(
    v10BenchmarkSource,
    /if \(deploymentOnly\) \{[\s\S]*readBoundedUtf8File\([\s\S]*"\.tmp\/v10-canonical-initcode\.hex"[\s\S]*MAX_PREPARED_INITCODE_BYTES[\s\S]*"prepared V10 initcode"[\s\S]*prepared V10 initcode does not match/,
    "V10 deployment gas benchmark must size-gate prepared initcode before comparing it",
  );
  assert.doesNotMatch(
    v10BenchmarkSource,
    /Number\(response\.headers\.get\("content-length"\)\)/,
    "V10 Linea gas benchmark RPC reads must not broadly coerce content-length headers",
  );
  assert.doesNotMatch(
    v10BenchmarkSource,
    /response\.json\(\)/,
    "V10 Linea gas benchmark RPC reads must not use unbounded response.json",
  );
  const v10PostdeployPlanSource = readFileSync("scripts/plan-v10-postdeploy-canary.ts", "utf8");
  const sharedGameFunctions = new Set(
    gameConstants.GAME_ABI
      .filter((item) => item.type === "function")
      .map((item) => item.name),
  );
  const sharedGameEvents = new Set(
    gameConstants.GAME_EVENTS_ABI
      .filter((item) => item.type === "event")
      .map((item) => item.name),
  );
  const sharedTokenFunctions = new Set(
    gameConstants.TOKEN_ABI
      .filter((item) => item.type === "function")
      .map((item) => item.name),
  );
  assert.equal(
    sharedGameFunctions.has("epochRewardClaimed"),
    true,
    "the shared game ABI must expose aggregate reward claims for solvency planning",
  );
  assert.equal(
    sharedTokenFunctions.has("decimals"),
    true,
    "the shared token ABI must expose the 18-decimal runtime boundary",
  );
  const indexedFinancialEvents = [
    "BetPlaced",
    "BatchBetsPlaced",
    "BatchBetsSameAmountPlaced",
    "BatchBetsBitmapPlaced",
    "EpochResolved",
    "DailyJackpotAwarded",
    "WeeklyJackpotAwarded",
    "RewardClaimed",
    "RewardBatchClaimed",
    "RebateClaimed",
    "RebateBatchClaimed",
    "RewardDustSettled",
    "RebateDustSettled",
    "ResolverRewardAccrued",
    "ResolverRewardClaimed",
    "ProtocolFeesFlushed",
  ];
  const indexerAbiSource = readFileSync("scripts/indexer.ts", "utf8");
  for (const eventName of indexedFinancialEvents) {
    assert.equal(
      sharedGameEvents.has(eventName),
      true,
      `shared GAME_EVENTS_ABI must preserve ${eventName} for frontend/indexer compatibility`,
    );
    assert.match(
      indexerAbiSource,
      new RegExp(`eventName: "${eventName}"|eventName !== "${eventName}"|eventName === "${eventName}"|eventName, "${eventName}"`),
      `indexer must keep an explicit ${eventName} decode/handler reference`,
    );
  }
  for (const aggregateDustEvent of ["RewardDustBatchSettled", "RebateDustBatchSettled"]) {
    assert.equal(
      sharedGameEvents.has(aggregateDustEvent),
      true,
      `shared GAME_EVENTS_ABI must preserve ${aggregateDustEvent} for frontend compatibility`,
    );
    assert.doesNotMatch(
      indexerAbiSource,
      new RegExp(aggregateDustEvent),
      `${aggregateDustEvent} is aggregate-only and must not double-count the per-epoch dust settlement index`,
    );
  }
  assert.doesNotMatch(
    v10PostdeployPlanSource,
    /createWalletClient|privateKey|writeContract|sendTransaction|\bwalletClient\b/,
    "V10 post-deploy planning must remain transaction-free and must not load signing material",
  );
  assert.doesNotMatch(
    v10PostdeployPlanSource,
    /\.env\.live-test-wallets/,
    "V10 post-deploy planning must never read the secret-bearing live wallet file",
  );
  assert.match(
    v10PostdeployPlanSource,
    /\.env\.live-test-addresses[\s\S]*replace\(\/\^\\uFEFF\/[\s\S]*public-only/,
    "V10 post-deploy planning must use a dedicated public-address file when process env is absent",
  );
  assert.match(
    v10PostdeployPlanSource,
    /function parsePublicAddressEnvLine\(line: string\)[\s\S]*replace\(\/\^export\\s\+\/[\s\S]*match\(\/\^\(\[A-Z0-9_\]\+\)\\s\*=\\s\*\(\.\*\?\)\\s\*\(\?:#\.\*\)\?\$\/\)[\s\S]*replace\(\/\^\["'\]\|\["'\]\$\/g, ""\)/,
    "V10 post-deploy planning must parse normal dotenv public-address lines without requiring exact KEY=value formatting",
  );
  assert.match(
    v10PostdeployPlanSource,
    /MAX_V10_COMPILATION_MANIFEST_BYTES = 512 \* 1024;[\s\S]*MAX_V10_PUBLIC_ADDRESS_FILE_BYTES = 64 \* 1024;[\s\S]*function readBoundedUtf8File\(filePath: string, maxBytes: number, label: string\)[\s\S]*const stats = statSync\(filePath\)[\s\S]*!stats\.isFile\(\)[\s\S]*stats\.size > maxBytes[\s\S]*too large to validate safely[\s\S]*readFileSync\(filePath, "utf8"\)/,
    "V10 post-deploy planning must size-gate local manifest and public-address artifacts before reading",
  );
  assert.match(
    v10PostdeployPlanSource,
    /readRuntimeIdentityManifest\(\)[\s\S]*readBoundedUtf8File\([\s\S]*COMPILATION_MANIFEST_PATH[\s\S]*MAX_V10_COMPILATION_MANIFEST_BYTES[\s\S]*Canonical V10 compilation manifest/,
    "V10 post-deploy planning must size-gate the canonical compilation manifest before parsing",
  );
  assert.match(
    v10PostdeployPlanSource,
    /\.env\.live-test-addresses[\s\S]*existsSync\(addressFile\)[\s\S]*readBoundedUtf8File\([\s\S]*addressFile[\s\S]*MAX_V10_PUBLIC_ADDRESS_FILE_BYTES[\s\S]*public-only address file[\s\S]*replace\(\/\^\\uFEFF\//,
    "V10 post-deploy planning must reject directory or oversized public-address files before reading",
  );
  assert.doesNotMatch(
    v10PostdeployPlanSource,
    /fallback\([^;]*rank:\s*true/s,
    "one-shot V10 post-deploy planning must not keep the process alive with RPC ranking timers",
  );
  const v10SnapshotReadCalls = v10PostdeployPlanSource.split("client.readContract({").length - 1;
  const v10SnapshotReadPins = v10PostdeployPlanSource.split("...readSnapshot").length - 1;
  assert.equal(
    v10SnapshotReadPins,
    v10SnapshotReadCalls,
    "every V10 post-deploy contract read must use the fixed snapshot block",
  );
  assert.match(
    v10PostdeployPlanSource,
    /const \[chainId, block\] = await Promise\.all[\s\S]*const snapshotBlock = block\.number;[\s\S]*getBytecode\(\{ address: CONTRACT_ADDRESS, blockNumber: snapshotBlock \}\)[\s\S]*snapshot: \{[\s\S]*blockNumber: snapshotBlock\.toString\(\)/,
    "V10 post-deploy identity and output must bind to one explicit block",
  );
  assert.match(
    v10PostdeployPlanSource,
    /getBytecode\(\{ address: LINEA_TOKEN_ADDRESS, blockNumber: snapshotBlock \}\)[\s\S]*functionName: "decimals"[\s\S]*if \(!tokenBytecode\)[\s\S]*contractToken[\s\S]*if \(tokenDecimals !== 18\)[\s\S]*tokenBoundary: \{[\s\S]*runtimePresent: true[\s\S]*immutableMatch: true[\s\S]*decimals: tokenDecimals/,
    "V10 post-deploy planning must prove token runtime, immutable identity, and decimals before financial output",
  );
  assert.match(
    v10PostdeployPlanSource,
    /async function simulateAndEstimate\([\s\S]*snapshotBlock: bigint[\s\S]*simulateContract\(\{[\s\S]*blockNumber: snapshotBlock[\s\S]*estimateContractGas\(\{[\s\S]*blockNumber: snapshotBlock/,
    "positive V10 simulations and estimates must use the fixed snapshot block",
  );
  assert.match(
    v10PostdeployPlanSource,
    /async function requireExpectedRevert\([\s\S]*snapshotBlock: bigint[\s\S]*simulateContract\(\{[\s\S]*blockNumber: snapshotBlock[\s\S]*requireExpectedRevert\(client, call, snapshotBlock\)/,
    "negative V10 simulations must use the same fixed snapshot block",
  );
  assert.match(
    v10PostdeployPlanSource,
    /simulateContract[\s\S]*estimateContractGas[\s\S]*claimRewards[\s\S]*claimEpochsRebate[\s\S]*claimResolverRewards[\s\S]*flushProtocolFees[\s\S]*resolveEpoch/,
    "V10 post-deploy planning must simulate every remaining bounded mutation class",
  );
  assert.match(
    v10PostdeployPlanSource,
    /nextAuthorization: !adminStateClean[\s\S]*blockedBy: adminBlockReason[\s\S]*: resolveReady[\s\S]*transactionLimit: 1[\s\S]*rerunRequiredAfterReceipt: true[\s\S]*invalidatedByResolve: resolveReady/,
    "V10 post-deploy planning must block untrusted governance before isolating resolve from claims",
  );
  const v10ResolveBarrierIndex = v10PostdeployPlanSource.indexOf("const resolveReady =");
  const v10ClaimPlanningIndex = v10PostdeployPlanSource.indexOf("const rolesToPlan =");
  assert.ok(
    v10ResolveBarrierIndex >= 0 && v10ResolveBarrierIndex < v10ClaimPlanningIndex,
    "V10 post-deploy planning must decide the resolve barrier before discovering role claims",
  );
  assert.match(
    v10PostdeployPlanSource,
    /const claimPlanningReady = scanComplete && !resolveReady && adminStateClean;[\s\S]*const rolesToPlan = claimPlanningReady \? roles : \[\];[\s\S]*if \(claimPlanningReady && \(ownerFees > 0n \|\| burnFees > 0n\)\)/,
    "V10 post-deploy planning must skip claim and fee-flush simulations while resolve or governance blocks the phase",
  );
  assert.match(
    v10PostdeployPlanSource,
    /V10_EXPECTED_CURRENT_OWNER[\s\S]*V10_EXPECTED_CURRENT_FEE_RECIPIENT[\s\S]*V10_EXPECTED_CURRENT_EPOCH_DURATION[\s\S]*functionName: "owner"[\s\S]*functionName: "feeRecipient"[\s\S]*functionName: "epochDuration"[\s\S]*const ownerMatches =[\s\S]*const feeRecipientMatches =[\s\S]*const epochDurationMatches =[\s\S]*const adminBlockReason =[\s\S]*const adminStateClean = adminBlockReason === null;[\s\S]*const resolvePlanningReady = resolveReady && adminStateClean;[\s\S]*if \(resolvePlanningReady\)[\s\S]*recommendedResolveGasLimit = resolvePlanningReady/,
    "V10 post-deploy planning must fail closed before recommending mutations under unexpected or pending governance",
  );
  assert.match(
    v10PostdeployPlanSource,
    /function plannedCallCount\(ready: boolean\)[\s\S]*return ready \? 1 : 0[\s\S]*plannedTransactions:[\s\S]*plannedCallCount\(rewardEpochs\.length > 0\)[\s\S]*plannedCallCount\(rebateEpochs\.length > 0\)[\s\S]*plannedCallCount\(resolverReward > 0n\)[\s\S]*admin: \{[\s\S]*clean: adminStateClean[\s\S]*ownerMatch: ownerMatches[\s\S]*feeRecipientMatch: feeRecipientMatches[\s\S]*epochDurationMatch: epochDurationMatches[\s\S]*currentlySimulatedTransactions: claimPhaseTransactions \+ plannedCallCount\(resolvePlanningReady\)/,
    "V10 post-deploy output must expose governance matches without printing addresses and count only permitted simulations through explicit planned-call counters",
  );
  assert.doesNotMatch(
    v10PostdeployPlanSource,
    /Number\(resolvePlanningReady\)|Number\(rewardEpochs\.length > 0\)|Number\(rebateEpochs\.length > 0\)|Number\(resolverReward > 0n\)/,
    "V10 post-deploy planner must not count authorization calls through broad boolean-to-number coercion",
  );
  assert.match(
    v10PostdeployPlanSource,
    /operationalBoundary: \{[\s\S]*transactionSent: false[\s\S]*signingMaterialLoaded: false[\s\S]*walletClientCreated: false[\s\S]*contractWriteSubmitted: false[\s\S]*outputAddressFree: true[\s\S]*operationalBoundary: output\.operationalBoundary/,
    "V10 post-deploy summary must explicitly state that planning is transaction-free and does not load signing material",
  );
  assert.doesNotMatch(
    v10PostdeployPlanSource,
    /createWalletClient|privateKeyToAccount|sendTransaction|writeContract/,
    "V10 post-deploy planner must remain a read-only public-client planner with no wallet signing or write helpers",
  );
  assert.match(
    v10PostdeployPlanSource,
    /if \(resolveReady\) \{[\s\S]*negativeCalls\.push\([\s\S]*expectedError: "EpochClosing"[\s\S]*label: "funded expired protected bet"/,
    "V10 post-deploy planning must only expect EpochClosing from a currently funded expired epoch",
  );
  assert.match(
    v10PostdeployPlanSource,
    /const openClaimWindowEpoch = resolvedEpochs\.find\([\s\S]*block\.timestamp < epoch\.resolvedAt \+ DUST_SETTLE_DELAY[\s\S]*expectedError: openClaimWindowEpoch \? "NoWinningBet" : "RewardClaimWindowExpired"[\s\S]*if \(openClaimWindowEpoch\) \{[\s\S]*DustSettlementDelayNotReached[\s\S]*openClaimWindowChecksApplied: Boolean\(openClaimWindowEpoch\)/,
    "V10 post-deploy claim and dust negatives must follow the one-year lifecycle instead of becoming stale",
  );
  assert.match(
    v10PostdeployPlanSource,
    /resolverRewardsByRole = new Map\([\s\S]*pendingResolverRewards[\s\S]*knownResolverLiability[\s\S]*resolverRewardsByRole\.get\(role\.role\)/,
    "V10 post-deploy planning must include known resolver liabilities without rereading them during claim planning",
  );
  assert.match(
    v10PostdeployPlanSource,
    /const claimPhaseCalls: SanitizedPlannedCall\[\] = \[\];[\s\S]*functionName: "claimRewards"[\s\S]*functionName: "claimEpochsRebate"[\s\S]*functionName: "claimResolverRewards"[\s\S]*functionName: "flushProtocolFees"[\s\S]*claimPhaseCalls\.length !== claimPhaseTransactions[\s\S]*calls: claimPhaseCalls/,
    "V10 post-deploy authorization must expose one sanitized exact call per permitted claim or flush transaction",
  );
  assert.match(
    v10PostdeployPlanSource,
    /SUMMARY_ONLY = process\.argv\.includes\("--summary-only"\)[\s\S]*output\.nextAuthorization\.calls\.reduce[\s\S]*typeof call === "string" \? call : call\.functionName[\s\S]*callCounts/,
    "V10 post-deploy planner must support compact summary output without dropping resolve-only authorization calls",
  );
  assert.match(
    v10PostdeployPlanSource,
    /claimManifestGas[\s\S]*BigInt\(call\.estimatedGas\)[\s\S]*claimManifestTransfers[\s\S]*parseUnits\(call\.expectedTransferLinea, 18\)[\s\S]*claimManifestGas !== claimPhaseGas[\s\S]*claimManifestTransfers !== claimPhaseTransfers[\s\S]*recommendedGasLimit\) <= BigInt\(call\.estimatedGas\)/,
    "V10 post-deploy authorization must fail closed when exact call totals or gas limits diverge",
  );
  assert.match(
    v10PostdeployPlanSource,
    /type SanitizedPlannedCall = \{[\s\S]*role: RoleName;[\s\S]*functionName: PlannedCall\["functionName"\];[\s\S]*epochs: string\[\];[\s\S]*estimatedGas: string;[\s\S]*recommendedGasLimit: string;[\s\S]*expectedTransferLinea: string;/,
    "V10 post-deploy call manifests must remain address-free while carrying exact gas and transfer bounds",
  );
  assert.match(
    v10PostdeployPlanSource,
    /epochRewardClaimed[\s\S]*epoch\.rewardClaimed > epoch\.rewardPool \|\| epoch\.rebateClaimed > epoch\.rebatePool[\s\S]*outstandingRewardLiability \+= epoch\.rewardPool - epoch\.rewardClaimed[\s\S]*outstandingRebateLiability \+= epoch\.rebatePool - epoch\.rebateClaimed/,
    "V10 post-deploy planning must fail closed on overclaimed pools and retain every unsettled epoch liability",
  );
  assert.match(
    v10PostdeployPlanSource,
    /const lowerBoundLiability =[\s\S]*currentData\[0\][\s\S]*rolloverPool[\s\S]*dailyJackpotPool[\s\S]*weeklyJackpotPool[\s\S]*ownerFees[\s\S]*burnFees[\s\S]*knownResolverLiability[\s\S]*outstandingRewardLiability[\s\S]*outstandingRebateLiability[\s\S]*covered: lowerBoundCovered[\s\S]*if \(!lowerBoundCovered \|\| contractBalance < claimPhaseTransfers\)/,
    "V10 post-deploy planning must enforce the complete observable liability lower bound",
  );
  assert.match(
    v10PostdeployPlanSource,
    /currentClaimPhase: \{[\s\S]*complete: claimPlanningReady[\s\S]*skipped: !claimPlanningReady[\s\S]*skipReason: claimPlanningSkipReason/,
    "V10 post-deploy output must explain when the claim phase was deliberately skipped",
  );
  assert.match(
    v10PostdeployPlanSource,
    /const scanComplete = scanFrom === 1n[\s\S]*truncated: !scanComplete[\s\S]*transactionLimit: 0[\s\S]*resolved-history scan is truncated/,
    "V10 post-deploy planning must block claim and fee-flush authorization when history is truncated",
  );
  assert.match(
    v10PostdeployPlanSource,
    /const READ_BATCH_SIZE = 4;[\s\S]*async function mapInBatches[\s\S]*values\.slice\(offset, offset \+ READ_BATCH_SIZE\)\.map\(mapper\)[\s\S]*readBatchSize: READ_BATCH_SIZE/,
    "V10 post-deploy discovery must expose and enforce bounded read concurrency",
  );
  assert.match(
    v10PostdeployPlanSource,
    /LineaOreV10\.compilation\.json[\s\S]*normalizedExecutableRuntimeSha256[\s\S]*runtimeImmutableReferences[\s\S]*normalizeExecutableRuntime/,
    "V10 post-deploy planning must bind deployed executable code to the canonical manifest",
  );
  const runtimeIdentityGateIndex = v10PostdeployPlanSource.indexOf("const runtimeIdentity = normalizeExecutableRuntime");
  const firstLiabilityReadIndex = v10PostdeployPlanSource.indexOf('functionName: "accruedOwnerFees"');
  assert.ok(
    runtimeIdentityGateIndex >= 0 &&
      firstLiabilityReadIndex >= 0 &&
      runtimeIdentityGateIndex < firstLiabilityReadIndex,
    "V10 runtime identity must pass before any mutation planning reads or simulations",
  );
  assert.match(
    v10PostdeployPlanSource,
    /manifestMatched:\s*true[\s\S]*runtimeIdentity,[\s\S]*scan:/,
    "V10 post-deploy output must expose the successful executable-runtime identity gate",
  );
  assert.match(
    v10PostdeployPlanSource,
    /const scannedEpochs = await mapInBatches<bigint, ResolvedEpoch \| null>[\s\S]*winningPool = claimPlanningReady[\s\S]*const roleEpochStates = await mapInBatches\(resolvedEpochs/,
    "V10 post-deploy discovery must batch epoch and per-role reads while loading each winning pool once",
  );
  assert.match(
    v10PostdeployPlanSource,
    /expectedResolverReward = \(currentData\[0\] \* 5n\) \/ 10_000n[\s\S]*estimatedResolveFee = resolveGas \* currentGasPrice[\s\S]*breakEvenEthPerLinea/,
    "V10 post-deploy planning must expose resolver break-even without assuming a token price",
  );
  assert.match(
    v10PostdeployPlanSource,
    /RESOLVE_GAS_FLOOR = 500_000n[\s\S]*bufferedResolveGas[\s\S]*recommendedResolveGasLimit[\s\S]*recommendedGasLimit:/,
    "V10 post-deploy planning must separate dynamic resolve estimates from a conservative execution gas limit",
  );
  for (const expectedError of [
    "NotResolved",
    "NoWinningBet",
    "RewardClaimWindowExpired",
    "NothingToClaim",
    "NoRebateAvailable",
    "UnexpectedEpoch",
    "InvalidTile",
    "InvalidTileMask",
    "ArraysMismatch",
    "InvalidEpochDuration",
    "InvalidFeeRecipient",
    "NoPendingEpochDurationChange",
    "NoPendingFeeRecipientChange",
    "OwnershipRenounceDisabled",
    "DustSettlementDelayNotReached",
    "OwnableUnauthorizedAccount",
    "EpochClosing",
  ]) {
    assert.ok(
      v10PostdeployPlanSource.includes(`"${expectedError}"`),
      `V10 post-deploy planning must require exact deployed ${expectedError} errors`,
    );
  }
  assert.equal(
    packageScripts["plan:canary:v10:postdeploy"],
    "npm run proof:contract-compile:v10 && tsx scripts/plan-v10-postdeploy-canary.ts",
    "V10 post-deploy planner must verify canonical provenance before its stable read-only command",
  );
  assert.equal(
    packageScripts["proof:contract-compile:summary"],
    "node scripts/check-contract-compilation-provenance.mjs --summary-only",
    "V9 provenance must expose a compact summary command for routine evidence collection",
  );
  assert.equal(
    packageScripts["proof:contract-compile:v10:summary"],
    "node scripts/check-contract-compilation-provenance.mjs --target=v10 --summary-only",
    "V10 provenance must expose a compact summary command for routine evidence collection",
  );
  assert.equal(
    packageScripts["plan:canary:v10:postdeploy:summary"],
    "npm run proof:contract-compile:v10:summary && tsx scripts/plan-v10-postdeploy-canary.ts --summary-only",
    "V10 post-deploy planner must expose a canonical compact read-only command",
  );
  const contractProvenanceSource = readFileSync("scripts/check-contract-compilation-provenance.mjs", "utf8");
  assert.match(
    contractProvenanceSource,
    /const SUMMARY_ONLY = process\.argv\.includes\("--summary-only"\)/,
    "contract compilation provenance must support compact summary output",
  );
  assert.match(
    contractProvenanceSource,
    /process\.argv\.includes\("--write-manifest"\) && !SUMMARY_ONLY[\s\S]*if \(!SUMMARY_ONLY\) \{[\s\S]*fs\.mkdirSync\(path\.dirname\(OUTPUT_PATH\), \{ recursive: true \}\);[\s\S]*fs\.writeFileSync\(OUTPUT_PATH,[\s\S]*wouldWrite: false/,
    "contract compilation provenance summary must be read-only and skip manifest/output artifact writes",
  );
  assert.match(
    contractProvenanceSource,
    /MAX_CONTRACT_SOURCE_BYTES = 2 \* 1024 \* 1024[\s\S]*MAX_COMPILER_CONFIG_BYTES = 512 \* 1024[\s\S]*MAX_COMPILATION_MANIFEST_BYTES = 512 \* 1024[\s\S]*MAX_PACKAGE_LOCK_BYTES = 5 \* 1024 \* 1024[\s\S]*function readBoundedUtf8File\(filePath, maxBytes, label\)[\s\S]*const stats = fs\.statSync\(filePath\)[\s\S]*!stats\.isFile\(\)[\s\S]*stats\.size > maxBytes[\s\S]*too large to validate safely[\s\S]*fs\.readFileSync\(filePath, "utf8"\)/,
    "contract compilation provenance must size-gate contract sources, config, manifests, and package lock before reading",
  );
  for (const docPath of ["docs/production-runbook.md", "docs/v10-contract-design.md"]) {
    const docSource = readFileSync(docPath, "utf8");
    assert.ok(
      docSource.includes("npm.cmd run plan:canary:v10:postdeploy:summary"),
      `${docPath} must direct routine V10 post-deploy planning to the compact command`,
    );
  }
  const productionRunbookSource = readFileSync("docs/production-runbook.md", "utf8");
  assert.match(
    productionRunbookSource,
    /npm\.cmd run preview:canary:v10:dry-run[\s\S]*npm\.cmd run preview:canary:v10:dry-run:summary[\s\S]*npm\.cmd run preview:canary:v10:authorization-ready:summary/,
    "production runbook must list the V10 dry-run Preview and authorization-ready freshness commands before fresh transaction consent",
  );
  assert.match(
    productionRunbookSource,
    /docs\/v10-canary-dry-run-preview\.md[\s\S]*fresh consent input[\s\S]*not[\s\S]*canary proof/,
    "production runbook must treat the V10 dry-run Preview as fresh consent input without treating it as proof",
  );
  assert.match(
    productionRunbookSource,
    /regular summary command validates the existing Preview[\s\S]*transactionSent=false[\s\S]*G10\/G11 dry-run blocker/,
    "production runbook must document the regular V10 dry-run Preview validator boundary",
  );
  assert.match(
    productionRunbookSource,
    /The authorization-ready summary applies the stricter fresh-consent[\s\S]*window/,
    "production runbook must require and validate the V10 dry-run Preview plus authorization-ready freshness check before fresh transaction consent without treating it as proof",
  );
  const v10PreviewCommandMapSource = readFileSync("docs/launch-evidence-command-map.md", "utf8");
  assert.match(
    v10PreviewCommandMapSource,
    /## Pre-Bet Dry-Run Preview[\s\S]*does not satisfy G10[\s\S]*npm\.cmd run preview:canary:v10:dry-run[\s\S]*npm\.cmd run preview:canary:v10:dry-run:summary[\s\S]*npm\.cmd run preview:canary:v10:authorization-ready:summary/,
    "launch command map must expose the V10 dry-run Preview and authorization-ready freshness commands while keeping G10/G11 live-evidence blocked",
  );
  assert.match(
    v10PreviewCommandMapSource,
    /docs\/v10-canary-dry-run-preview\.md[\s\S]*regular summary command validates the existing Preview[\s\S]*transactionSent=false[\s\S]*The authorization-ready summary applies the[\s\S]*stricter fresh-consent[\s\S]*window[\s\S]*does not satisfy live[\s\S]*canary\/soak proof/,
    "launch command map must expose the V10 dry-run Preview artifact, validator, and authorization-ready freshness gate while keeping G10/G11 live-evidence blocked",
  );
  const testnetDeepAuditSource = readFileSync("docs/testnet-deep-audit-2026-07-19.md", "utf8");
  assert.doesNotMatch(
    testnetDeepAuditSource,
    /optionally flush fees|every-120th external-transfer liveness coupling|Safety Pool discovery is still capped/,
    "testnet deep-audit docs must not preserve stale pre-V10 fee-flush or discovery blockers",
  );
  assert.match(
    testnetDeepAuditSource,
    /V10 accrues owner and burn fees during resolve[\s\S]*explicit permissionless `flushProtocolFees\(\)` path/,
    "testnet deep-audit docs must describe current V10 fee delivery accurately",
  );
  assert.match(
    testnetDeepAuditSource,
    /Safety Pool now exposes an explicit bounded load-older flow/,
    "testnet deep-audit docs must record the bounded Safety Pool older-history flow",
  );
  const restoreProofSource = readFileSync("scripts/verify-db-restore.mjs", "utf8");
  const backupSqliteSource = readFileSync("scripts/backup-sqlite.mjs", "utf8");
  assert.equal(
    packageScripts["proof:restore:summary"],
    "node scripts/verify-db-restore.mjs --summary-only",
    "restore proof must expose a compact summary command for routine operator checks",
  );
  assert.equal(
    packageScripts["db:backup:summary"],
    "node scripts/backup-sqlite.mjs --summary-only",
    "SQLite backup must expose a compact summary command for routine operator checks",
  );
  assert.equal(
    packageScripts["db:backup:strict:summary"],
    "node scripts/backup-sqlite.mjs --strict --summary-only",
    "SQLite backup must expose a compact strict summary command for launch checks",
  );
  assert.match(
    backupSqliteSource,
    /const summaryOnly = process\.argv\.includes\("--summary-only"\)/,
    "SQLite backup must support compact output without changing backup validation",
  );
  assert.match(
    backupSqliteSource,
    /if \(summaryOnly\) \{[\s\S]*status: "ready"[\s\S]*wouldWrite: false[\s\S]*process\.exit\(0\)[\s\S]*mkdirSync\(path\.dirname\(path\.resolve\(output\)\)/,
    "SQLite backup summary must be read-only and exit before creating backup directories or files",
  );
  assert.match(
    backupSqliteSource,
    /futureTimestampSkewMs = 5 \* 60 \* 1000[\s\S]*function hasFutureModifiedTime[\s\S]*fileStat\.mtimeMs > Date\.now\(\) \+ futureTimestampSkewMs[\s\S]*Backup source modified time must not be in the future/,
    "strict SQLite backup proof must reject future-dated source DB modified timestamps",
  );
  assert.match(
    backupSqliteSource,
    /function failRuntime[\s\S]*!summaryOnly\) throw error[\s\S]*JSON\.stringify\(\{ status: "fail", groups: backupSummaryGroups, issue: compactIssue\(error\) \}\)/,
    "SQLite backup summary runtime failures must remain compact JSON without stack traces",
  );
  assert.ok(
    backupSqliteSource.includes('import { redactProofText } from "./redact-proof-output.mjs";') &&
      backupSqliteSource.includes("function compactIssue(error)") &&
      backupSqliteSource.includes("redactProofText(message)") &&
      backupSqliteSource.includes("(?:https?|wss?)") &&
      backupSqliteSource.includes("[A-Za-z]:\\\\") &&
      backupSqliteSource.includes("(^|[\\s\"'])\\/"),
    "SQLite backup summary runtime failures must redact shared proof secrets, URLs, Windows paths, and POSIX paths",
  );
  assert.match(
    backupSqliteSource,
    /requiresExternalBackupPaths[\s\S]*strict[\s\S]*LORE_BACKUP_REQUIRE_EXTERNAL[\s\S]*NODE_ENV === "production"[\s\S]*LINEA_NETWORK === "mainnet"[\s\S]*Production backup \$\{label\} path must be absolute and outside the repo checkout/,
    "production and strict SQLite backups must require absolute external source and output paths",
  );
  assert.match(
    backupSqliteSource,
    /if \(requiresExternalBackupPaths\(\)\) \{[\s\S]*retentionDays < 1[\s\S]*Production backup retention days must be configured[\s\S]*Production backup \$\{label\} path must be absolute and outside the repo checkout/,
    "production and strict SQLite backups must require an explicit retention policy before launch",
  );
  assert.match(
    backupSqliteSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*const retentionDays = retentionText \? parseRetentionDays\(retentionText\) : 0[\s\S]*function parseRetentionDays\(value\)[\s\S]*\^\[1-9\]\\d\{0,15\}\$[\s\S]*const parsed = BigInt\(normalized\)[\s\S]*parsed <= MAX_SAFE_INTEGER_BIGINT && parsed >= 1n && parsed <= 3650n \? Number\(parsed\) : null[\s\S]*retentionText && retentionDays === null/,
    "SQLite backup retention env must be canonical positive decimal days before strict backup readiness",
  );
  assert.doesNotMatch(
    backupSqliteSource,
    /const retentionDays = retentionText \? Number\(retentionText\) : 0|function parseRetentionDays\(value\)[\s\S]*\^\[1-9\]\\d\*\$|const parsed = Number\(normalized\)/,
    "SQLite backup retention env must not use broad Number coercion",
  );
  const sqliteOperationsSource = readFileSync("scripts/test-sqlite-operations.mjs", "utf8");
  const sqliteBackupLibrarySource = readFileSync("scripts/sqlite-backup-lib.mjs", "utf8");
  assert.match(
    sqliteBackupLibrarySource,
    /function removeTemporaryBackupArtifacts[\s\S]*"-shm"[\s\S]*"-wal"[\s\S]*temporaryOutputPath[\s\S]*backup\(source, temporaryOutputPath\)[\s\S]*PRAGMA integrity_check[\s\S]*renameSync\(temporaryOutputPath, outputPath\)[\s\S]*removeTemporaryBackupArtifacts\(temporaryOutputPath\)/,
    "SQLite backups must verify a same-directory temporary artifact before atomically publishing it and clean it on failure",
  );
  assert.match(
    sqliteBackupLibrarySource,
    /function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*createSqliteBackup\(sourceInput, outputInput\)[\s\S]*!regularFileStat\(sourcePath\)[\s\S]*Backup source must be an existing regular file/,
    "SQLite backup library must reject missing or directory source DB paths through a shared regular-file stat boundary",
  );
  assert.match(
    sqliteBackupLibrarySource,
    /function pruneSqliteBackups\(directoryInput, retentionDays, excludePaths = \[\], now = Date\.now\(\)\)[\s\S]*Number\.isSafeInteger\(retentionDays\)[\s\S]*Number\.isSafeInteger\(now\) \|\| now < 0[\s\S]*Backup retention clock must be a safe non-negative integer/,
    "SQLite backup retention pruning must fail closed on malformed clocks before deleting generated backups",
  );
  assert.match(
    sqliteScopeAuditSource,
    /function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*auditSqliteScopes\(sourceInput, activeScope\)[\s\S]*!regularFileStat\(sourcePath\)[\s\S]*Scope audit source must be an existing regular file/,
    "SQLite scope audit must reject missing or directory DB paths through a shared regular-file stat boundary",
  );
  assert.match(
    sqliteOperationsSource,
    /createSqliteBackup\(sourcePath, sourcePath\)[\s\S]*Backup output must differ from source DB[\s\S]*createSqliteBackup\(sourcePath, backupPath\)[\s\S]*Backup output already exists/,
    "SQLite backup operation tests must reject source collisions and existing-output overwrites",
  );
  assert.match(
    sqliteOperationsSource,
    /readdirSync\(drillDir\)[\s\S]*partial-[\s\S]*backup must publish only the validated final artifact/,
    "SQLite backup operation tests must reject leftover partial artifacts after publication",
  );
  assert.match(
    sqliteOperationsSource,
    /pruneSqliteBackups\(retentionDir, 14, \[\], Number\.NaN\)[\s\S]*Backup retention clock must be a safe non-negative integer[\s\S]*retention pruning must reject malformed clocks before deleting files/,
    "SQLite backup operation tests must cover malformed retention clock rejection",
  );
  assert.match(
    sqliteOperationsSource,
    /futureBackupRoot[\s\S]*utimesSync\(futureBackupSource, futureMtime, futureMtime\)[\s\S]*Backup source modified time must not be in the future[\s\S]*futureSourceBackupSummaryRejected: true/,
    "SQLite operations regression must prove strict backup summary rejects future-dated source DB timestamps",
  );
  assert.match(
    sqliteOperationsSource,
    /LORE_BACKUP_RETENTION_DAYS: "14\.0"[\s\S]*LORE_BACKUP_RETENTION_DAYS must be an integer between 1 and 3650[\s\S]*malformedRetentionBackupSummaryRejected: true/,
    "SQLite operations regression must prove backup summary rejects non-canonical retention days",
  );
  assert.match(
    sqliteOperationsSource,
    /LORE_BACKUP_RETENTION_DAYS: "9999999999999999"[\s\S]*LORE_BACKUP_RETENTION_DAYS must be an integer between 1 and 3650[\s\S]*unsafeRetentionBackupSummaryRejected: true/,
    "SQLite operations regression must prove backup summary rejects unsafe retention days",
  );
  assert.match(
    restoreProofSource,
    /mkdirSync\(dirname\(restoreMain\), \{ recursive: true \}\);\s*copyFileSync\(backupMain, restoreMain\)/,
    "restore drill must create its target directory before copying the backup",
  );
  assert.match(
    restoreProofSource,
    /const summaryOnly = process\.argv\.includes\("--summary-only"\)/,
    "restore drill must support compact output without changing validation",
  );
  assert.match(
    restoreProofSource,
    /const restoreLaunchGates = \["G8"\][\s\S]*const restoreLaunchGateGroups = "restore=1"[\s\S]*function launchGateSummary\(issueCount\)[\s\S]*blocked[\s\S]*covered[\s\S]*launchGateSummary\(issues\.length\)/,
    "restore proof summary must identify the blocked or covered launch gate without printing local restore paths",
  );
  assert.match(
    restoreProofSource,
    /function printSummaryAndExit\(\)[\s\S]*Would write: false[\s\S]*process\.exit\(\)[\s\S]*if \(summaryOnly\) printSummaryAndExit\(\);[\s\S]*copyFileSync\(backupMain, restoreMain\)/,
    "restore proof summary must exit before copying backup or restore files",
  );
  assert.match(
    restoreProofSource,
    /if \(!summaryOnly\) \{[\s\S]*## Copied Files[\s\S]*## Row Counts/,
    "restore drill must keep detailed file and row-count tables out of summary-only output",
  );
  assert.match(
    restoreProofSource,
    /function regularFileStat\(filePath\)[\s\S]*const stats = statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*function fmtSize\(filePath\)[\s\S]*const stats = regularFileStat\(filePath\)[\s\S]*function fileExists\(filePath\)[\s\S]*regularFileStat\(filePath\) !== null[\s\S]*Manifest: \$\{fileExists\(resolve\(repoRoot, manifestPath\)\) \? "present" : "missing"\}[\s\S]*source DB must be a file[\s\S]*backup artifact must be a file/,
    "restore proof summary and restore inputs must only treat regular files as present",
  );
  assert.match(
    restoreProofSource,
    /function hasRestoreDrillIntegrityProof\(value\)[\s\S]*restore\|restored\|copy\|copied\|backup[\s\S]*integrity_check[\s\S]*restoreDrill evidence must include restored SQLite integrity_check proof/,
    "restore proof must require restored SQLite integrity evidence, not only a generic successful restore summary",
  );
  assert.match(
    restoreProofSource,
    /const MAX_HEALTH_BASE_MARKERS = 64[\s\S]*function healthEvidenceBaseMatches\(value, expectedOrigin\)[\s\S]*pattern\.exec\(text\)[\s\S]*inspected > MAX_HEALTH_BASE_MARKERS[\s\S]*normalizedOrigin\(match\[1\]\) === expected/,
    "restore proof must cap restored health base evidence scans before accepting restored origin proof",
  );
  assert.doesNotMatch(
    restoreProofSource,
    /\[\.\.\.text\.matchAll/,
    "restore proof must not spread restored health base evidence matchAll output into arrays",
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
    assert.equal(storage.has(snapshotKey), false, "stale live-state snapshots must be removed from localStorage");
    storage.set(snapshotKey, "{bad json");
    assert.equal(liveStateSnapshot.loadLiveStateSnapshot(), null);
    assert.equal(storage.has(snapshotKey), false, "corrupt live-state snapshots must be removed from localStorage");
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
  const avatarPng = new Uint8Array(24);
  avatarPng.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  avatarPng[19] = 2;
  avatarPng[23] = 2;
  assert.equal(
    chatAvatar.isSupportedChatAvatarDataUrl(`data:image/png;base64,${Buffer.from(avatarPng).toString("base64")}`),
    true,
  );
  avatarPng[17] = 4;
  assert.equal(
    chatAvatar.isSupportedChatAvatarDataUrl(`data:image/png;base64,${Buffer.from(avatarPng).toString("base64")}`),
    false,
    "custom avatars must reject compressed images whose decoded dimensions exceed the render budget",
  );
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
  assert.equal(chatPollDelay.getChatPollDelayMs({ open: true, isPageVisible: true, failureCount: -1 }), 3_000);
  assert.equal(chatPollDelay.getChatPollDelayMs({ open: true, isPageVisible: true, failureCount: 1.5 }), 3_000);
  assert.equal(chatPollDelay.getChatPollDelayMs({ open: true, isPageVisible: true, failureCount: Number.NaN }), 3_000);
  assert.equal(
    chatPollDelay.getChatPollDelayMs({ open: true, isPageVisible: true, failureCount: Number.MAX_SAFE_INTEGER + 1 }),
    3_000,
  );
  const chatPollDelaySource = readFileSync("app/lib/chatPollDelay.ts", "utf8");
  assert.match(
    chatPollDelaySource,
    /Number\.isSafeInteger\(failureCount\)[\s\S]*failureCount > 0[\s\S]*2 \*\* failures/,
    "chat poll delay backoff must reject malformed counters before exponential delay calculation",
  );
  assert.doesNotMatch(
    chatPollDelaySource,
    /2 \*\* failureCount/,
    "chat poll delay backoff must not exponentiate malformed failure counters directly",
  );
  assert.equal(chatRateLimit.parseChatRetryAfterMs(2), 2_000);
  assert.equal(chatRateLimit.parseChatRetryAfterMs("2"), 2_000);
  assert.equal(chatRateLimit.parseChatRetryAfterMs("bad"), 1_500);
  assert.equal(chatRateLimit.parseChatRetryAfterMs("02"), 1_500);
  assert.equal(chatRateLimit.parseChatRetryAfterMs("1e3"), 1_500);
  assert.equal(chatRateLimit.parseChatRetryAfterMs(1.5), 1_500);
  assert.equal(chatRateLimit.parseChatRetryAfterMs(Number.MAX_SAFE_INTEGER + 1), 1_500);
  assert.equal(chatRateLimit.parseChatRetryAfterMs(999), 120_000);
  assert.equal(chatRateLimit.parseChatRetryAfterMs("999"), 120_000);
  assert.equal(chatRateLimit.parseChatRetryAfterMs("2", Number.NaN), 2_000);
  assert.equal(chatRateLimit.parseChatRetryAfterMs("1", 2_000.5), 1_500);

  const chatRateLimitSource = readFileSync("app/lib/chatRateLimit.ts", "utf8");
  assert.match(
    chatRateLimitSource,
    /function parsePositiveIntegerSeconds[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*\/\^\(\?:0\|\[1-9\]\\d\{0,5\}\)\$\/[\s\S]*Number\.parseInt\(trimmed, 10\)[\s\S]*const seconds = parsePositiveIntegerSeconds\(value\)/,
    "chat retryAfter cooldowns must use canonical bounded seconds parsing before clamping",
  );
  assert.doesNotMatch(
    chatRateLimitSource,
    /const seconds = [\s\S]*Number\(value\)|Number\.isFinite\(seconds\)/,
    "chat retryAfter cooldowns must not rely on broad Number coercion",
  );

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
  assert.match(
    useChatSource,
    /import \{ log \} from "\.\.\/lib\/logger";[\s\S]*log\.warn\("Chat", tag, err\)/,
    "chat network warnings must use the shared redacted support logger",
  );
  assert.doesNotMatch(
    useChatSource,
    /console\.warn\(\`\$\{tag\} \$\{message\}`\)/,
    "chat network warnings must not bypass support-log redaction through direct console.warn",
  );
  const appShellState = appShellStateModule.default ?? appShellStateModule;
  assert.deepEqual(appShellState.normalizeCachedHotTile({ tileId: 7, wins: "3" }), { tileId: 7, wins: 3 });
  assert.deepEqual(
    appShellState.normalizeCachedHotTile({ tileId: "25", wins: "9007199254740991" }),
    { tileId: 25, wins: Number.MAX_SAFE_INTEGER },
  );
  assert.equal(appShellState.normalizeCachedHotTile({ tileId: 0, wins: 1 }), null);
  assert.equal(appShellState.normalizeCachedHotTile({ tileId: 26, wins: 1 }), null);
  assert.equal(appShellState.normalizeCachedHotTile({ tileId: "1.5", wins: 1 }), null);
  assert.equal(appShellState.normalizeCachedHotTile({ tileId: "1e2", wins: 1 }), null);
  assert.equal(appShellState.normalizeCachedHotTile({ tileId: 1, wins: " 2" }), null);
  assert.equal(appShellState.normalizeCachedHotTile({ tileId: 1, wins: "9007199254740992" }), null);
  assert.equal(appShellState.normalizeCachedHotTile({ tileId: 1, wins: "9999999999999999" }), null);
  assert.equal(appShellState.normalizeCachedHotTile({ tileId: 1, wins: Number.MAX_SAFE_INTEGER + 1 }), null);
  const appShellStateSource = readFileSync("app/hooks/useAppShellState.ts", "utf8");
  assert.match(
    appShellStateSource,
    /log\.info\("App", "mounted", \{ path: window\.location\.pathname, tab: readHashTab\(\), time:/,
    "App mount diagnostics must keep route evidence without query-string payloads",
  );
  assert.doesNotMatch(
    appShellStateSource,
    /window\.location\.href/,
    "App shell support logs must not capture full URLs",
  );
  assert.match(
    appShellStateSource,
    /const raw = window\.localStorage\.getItem\(ACTIVE_TAB_STORAGE_KEY\)[\s\S]*if \(raw === null\) return null;[\s\S]*VALID_TABS\.includes\(raw as TabId\)[\s\S]*window\.localStorage\.removeItem\(ACTIVE_TAB_STORAGE_KEY\)/,
    "App shell active-tab restore must clear invalid localStorage values before falling back",
  );
  assert.match(
    appShellStateSource,
    /import \{ GRID_SIZE \} from "\.\.\/lib\/constants";[\s\S]*tileId > GRID_SIZE/,
    "cached hot tiles must reject impossible tile ids before rendering stale localStorage data",
  );
  assert.match(
    appShellStateSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parsePositiveSafeInteger[\s\S]*typeof value === "number"[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*\/\^\[1-9\]\\d\*\$\/\.test\(value\)[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)/,
    "cached hot tiles must use BigInt-bounded canonical positive safe-integer parsing before rendering stale localStorage data",
  );
  assert.doesNotMatch(
    appShellStateSource,
    /Number\(value\.(?:tileId|wins)\)|const parsed = Number\(value\)[\s\S]*Number\.isSafeInteger\(parsed\)/,
    "cached hot tiles must not broadly coerce tile or win counters with Number(...) before bounds checks",
  );
  const lineaOreClientViewProps = lineaOreClientViewPropsModule.default ?? lineaOreClientViewPropsModule;
  assert.equal(lineaOreClientViewProps.derivePreviousGridEpoch("42"), "41");
  assert.equal(lineaOreClientViewProps.derivePreviousGridEpoch("1"), "0");
  assert.equal(lineaOreClientViewProps.derivePreviousGridEpoch("0"), null);
  assert.equal(lineaOreClientViewProps.derivePreviousGridEpoch("001"), null);
  assert.equal(lineaOreClientViewProps.derivePreviousGridEpoch("1.5"), null);
  assert.equal(lineaOreClientViewProps.derivePreviousGridEpoch("1e3"), null);
  assert.equal(lineaOreClientViewProps.derivePreviousGridEpoch("9007199254740993"), "9007199254740992");
  const lineaOreClientViewPropsSource = readFileSync("app/lib/lineaOreClientViewProps.ts", "utf8");
  assert.match(
    lineaOreClientViewPropsSource,
    /export function derivePreviousGridEpoch\(gridDisplayEpoch: string \| null \| undefined\): string \| null[\s\S]*\/\^\(\?:0\|\[1-9\]\\d\*\)\$\/\.test\(gridDisplayEpoch\)[\s\S]*BigInt\(gridDisplayEpoch\)[\s\S]*epoch - 1n/,
    "jackpot fallback previous grid epoch must use canonical string and bigint parsing",
  );
  assert.match(
    lineaOreClientViewPropsSource,
    /const previousGridEpoch = derivePreviousGridEpoch\(gridDisplayEpoch\)/,
    "jackpot fallback view props must route previous grid epoch through the strict helper",
  );
  assert.doesNotMatch(
    lineaOreClientViewPropsSource,
    /Number\(gridDisplayEpoch\)/,
    "jackpot fallback previous grid epoch must not broadly coerce gridDisplayEpoch",
  );
  assert.match(
    appShellStateSource,
    /if \(hotTiles\.length === 0\) \{[\s\S]*setVisibleHotTiles\(\(current\) => \(current\.length === 0 \? current : \[\]\)\)[\s\S]*window\.localStorage\.removeItem\(HOT_TILES_STORAGE_KEY\)/,
    "hot tile sync must clear stale cached sidebar winners when the current history has no resolved hot tiles",
  );
  assert.match(
    appShellStateSource,
    /const parsed = JSON\.parse\(raw\) as unknown\[\][\s\S]*if \(!Array\.isArray\(parsed\)\) \{[\s\S]*window\.localStorage\.removeItem\(HOT_TILES_STORAGE_KEY\)[\s\S]*catch \{[\s\S]*window\.localStorage\.removeItem\(HOT_TILES_STORAGE_KEY\)/,
    "hot-tile cache reads must clear corrupt or invalid localStorage entries",
  );
  const chatWindowSource = readFileSync("app/components/chat/ChatWindow.tsx", "utf8");
  const chatWidgetSource = readFileSync("app/components/chat/ChatWidget.tsx", "utf8");
  const floatingActionsSource = readFileSync("app/components/FloatingActions.tsx", "utf8");
  assert.match(
    floatingActionsSource,
    /<button[\s\S]{0,120}type="button"[\s\S]{0,240}aria-label="Open chat"[\s\S]{0,80}disabled/,
    "lazy chat fallback button must remain a non-submit accessible control",
  );
  assert.match(
    chatWidgetSource,
    /const CHAT_PANEL_ID = "lore-chat-panel"[\s\S]*<button[\s\S]*type="button"[\s\S]*aria-controls=\{CHAT_PANEL_ID\}[\s\S]*aria-expanded=\{open\}/,
    "chat toggle must expose its expanded state and controlled panel",
  );
  assert.match(
    chatWindowSource,
    /const CHAT_PANEL_ID = "lore-chat-panel"[\s\S]*<div[\s\S]*id=\{CHAT_PANEL_ID\}/,
    "chat panel root must keep the stable id controlled by the floating toggle",
  );
  assert.match(
    chatWindowSource,
    /aria-live="polite"/,
    "chat cooldown feedback must remain visible without relying on console warnings",
  );
  assert.match(
    chatWindowSource,
    /aria-hidden="true"[\s\S]*title=\{connected \? "Connected" : "Connecting\.\.\."\}[\s\S]*role="status" aria-live="polite" aria-atomic="true"[\s\S]*connected \? "Chat connected" : "Chat connecting"/,
    "chat connection indicator must expose a non-color screen-reader status",
  );
  assert.match(
    chatWindowSource,
    /CHAT_VERIFY_ERROR[\s\S]*setVerifyError\(CHAT_VERIFY_ERROR\)/,
    "chat verify failure UI must use stable safe copy instead of raw wallet/provider messages",
  );
  assert.doesNotMatch(
    chatWindowSource,
    /setVerifyError\(err instanceof Error \? err\.message/,
    "chat verify failure UI must not surface raw wallet/provider errors",
  );
  assert.match(
    chatWindowSource,
    /data-testid="chat-send-action"/,
    "chat send action must expose a stable smoke-test selector",
  );
  assert.match(
    chatWindowSource,
    /placeholder=\{`Message as \$\{displayName\}`\}[\s\S]*aria-label="Chat message"/,
    "chat message input must not rely on placeholder text as its only accessible name",
  );
  assert.match(
    chatWindowSource,
    /data-testid="chat-profile-open"/,
    "chat profile entrypoint must expose a stable smoke-test selector",
  );
  assert.match(
    chatWindowSource,
    /aria-label="Profile"[\s\S]{0,180}className="[^"]*\bh-12\b[^"]*\bw-12\b/,
    "chat profile action must keep a padded touch target for mobile users",
  );
  assert.match(
    chatWindowSource,
    /aria-label="Close chat panel"[\s\S]{0,180}className="[^"]*\bh-12\b[^"]*\bw-12\b/,
    "chat close action must keep a padded touch target for mobile users",
  );
  const chatProfileModalSource = readFileSync("app/components/chat/ChatProfileModal.tsx", "utf8");
  assert.match(
    chatProfileModalSource,
    /data-testid="chat-profile-save"/,
    "chat profile save action must expose a stable smoke-test selector",
  );
  assert.match(
    chatProfileModalSource,
    /aria-label="Close"[\s\S]{0,220}uiTokens\.focusRing/,
    "chat profile close action must keep a visible keyboard focus ring",
  );
  assert.match(
    chatProfileModalSource,
    /aria-label="Use wallet identity avatar"[\s\S]*aria-pressed=\{!avatar && !customAvatar\}/,
    "chat profile wallet identity avatar option must expose its accessible name and selected state",
  );
  assert.match(
    chatProfileModalSource,
    /aria-label=\{`Select \$\{id\} avatar`\}[\s\S]*aria-pressed=\{avatar === id && !customAvatar\}/,
    "chat profile preset avatar options must expose accessible names and selected state",
  );
  const chatAuthRouteSource = readFileSync("app/api/chat/auth/route.ts", "utf8");
  assert.match(
    chatAuthRouteSource,
    /async function verifyChatSignature\([\s\S]*return verifyChatWalletMessage\(\{[\s\S]*address,[\s\S]*message,[\s\S]*signature,[\s\S]*rpcWitnesses:/,
    "chat auth must delegate the intended personal-sign message to the quorum verifier",
  );
  assert.doesNotMatch(
    chatAuthRouteSource,
    /recoverAddress|keccak256\(toBytes\(message\)\)/,
    "chat auth must not accept raw eth_sign digest recovery as a login fallback",
  );
  assert.match(
    readFileSync("app/lib/chatAuth.ts", "utf8"),
    /normalizeChatAuthAddress[\s\S]*getAddress/,
    "chat auth must normalize wallet addresses with the EVM address parser",
  );
  assert.match(
    readFileSync("app/lib/chatAuth.ts", "utf8"),
    /const fields = \{ address, uri, chainId, nonce, issuedAt \};[\s\S]*normalized !== buildChatAuthMessage\(fields\)/,
    "chat auth must reject non-canonical signed messages instead of accepting extra or reordered fields",
  );
  assert.match(
    readFileSync("app/lib/chatAuth.ts", "utf8"),
    /function parseCanonicalIssuedAtMs[\s\S]*toISOString\(\) === issuedAt[\s\S]*parseCanonicalIssuedAtMs\(issuedAt\)/,
    "chat auth must reject non-canonical issuedAt timestamps before TTL checks",
  );
  assert.match(
    readFileSync("app/lib/chatAuth.ts", "utf8"),
    /function parseCanonicalChainId[\s\S]*\^\[1-9\]\\d\{0,15\}\$[\s\S]*Number\.isSafeInteger\(parsed\)[\s\S]*const chainId = parseCanonicalChainId\(values\.get\("chain id"\)\)[\s\S]*chainId === null/,
    "chat auth must canonical-parse signed chain IDs before session issuance",
  );
  assert.match(
    readFileSync("app/lib/chatAuth.ts", "utf8"),
    /function parseCanonicalNonce[\s\S]*\^\[a-f0-9\]\{32,128\}\$[\s\S]*const nonce = parseCanonicalNonce\(values\.get\("nonce"\)\)[\s\S]*nonce === null/,
    "chat auth must canonical-parse signed nonces before session issuance",
  );
  assert.doesNotMatch(
    readFileSync("app/lib/chatAuth.ts", "utf8"),
    /Number\(values\.get\("chain id"\)|Number\.isInteger\(chainId\)/,
    "chat auth must not use broad Number() parsing for signed chain IDs",
  );
  assert.doesNotMatch(
    readFileSync("app/lib/chatAuth.ts", "utf8"),
    /\^\[a-f0-9\]\{32,128\}\$\/i|values\.get\("nonce"\) \?\? ""/,
    "chat auth must not accept case-insensitive or default-empty signed nonces",
  );
  assert.match(
    readFileSync("app/lib/chatAuth.ts", "utf8"),
    /export function getChatAuthProofTtlMs[\s\S]*parseCanonicalIssuedAtMs\(issuedAt\)[\s\S]*Number\.isSafeInteger\(now\)[\s\S]*remainingMs > 0 \? remainingMs : null/,
    "chat auth replay-lock TTL must use canonical issuedAt parsing",
  );
  assert.match(
    chatAuthRouteSource,
    /getChatAuthProofTtlMs\(fields\.issuedAt\)[\s\S]*ttlMs === null[\s\S]*Expired auth proof[\s\S]*consumeChatProof\(authAddress, fields\.nonce, fields\.uri, authSignature, ttlMs\)/,
    "chat auth route must fail closed before replay-lock consumption when issuedAt TTL is invalid",
  );
  assert.doesNotMatch(
    chatAuthRouteSource,
    /Date\.parse\(fields\.issuedAt\)|CHAT_AUTH_PROOF_TTL_MS - \(Date\.now\(\) - issuedAtMs\)/,
    "chat auth route must not recalculate replay-lock TTL with broad Date.parse",
  );
  assert.match(
    chatAuthRouteSource,
    /normalizeChatAuthAddress\(body\.authAddress\)/,
    "chat auth route must reuse the shared wallet address normalizer",
  );
  assert.match(
    chatAuthRouteSource,
    /isTrustedAuthUri\(fields\.uri, trustedOrigin, "\/chat"\)/,
    "chat auth route must bind signed messages to the exact chat URI path",
  );
  assert.doesNotMatch(
    chatAuthRouteSource,
    /new URL\(fields\.uri\)\.origin/,
    "chat auth route must not accept signed messages by origin-only URI comparison",
  );
  assert.match(
    chatAuthRouteSource,
    /requiresExternalSharedLock\(\)[\s\S]*acquireExternalExpiringLock/,
    "chat auth must use a shared replay lock when production runs more than one web replica",
  );
  assert.match(
    readFileSync("app/api/_lib/chatSession.ts", "utf8"),
    /normalizeChatAuthAddress/,
    "chat session cookies must store and validate normalized wallet addresses",
  );
  assert.match(
    readFileSync("app/api/chat/messages/route.ts", "utf8"),
    /normalizeChatAuthAddress\(body\.sender\)/,
    "chat message sends must normalize sender addresses before session comparison",
  );
  assert.match(
    readFileSync("app/api/chat/profile/route.ts", "utf8"),
    /normalizeChatAuthAddress/,
    "chat profile reads and writes must normalize wallet addresses before cache or session use",
  );
  assert.match(
    readFileSync("app/api/chat/profile/route.ts", "utf8"),
    /walletAddressesParam !== null && rawRequestedAddresses\.length === 0/,
    "chat profile batch reads must reject empty walletAddresses instead of falling through to list-all",
  );
  assert.match(
    readFileSync("app/api/chat/profile/route.ts", "utf8"),
    /const MAX_REQUESTED_PROFILE_WALLETS = 100;[\s\S]*?split\(",", MAX_REQUESTED_PROFILE_WALLETS \+ 1\)[\s\S]*?rawRequestedAddresses\.length > MAX_REQUESTED_PROFILE_WALLETS[\s\S]*?Too many walletAddresses/,
    "chat profile batch reads must reject over-limit walletAddresses before normalization instead of silently truncating",
  );
  assert.doesNotMatch(
    readFileSync("app/api/chat/profile/route.ts", "utf8"),
    /new Set\(normalizedRequestedAddresses\)\]\.slice\(0, MAX_REQUESTED_PROFILE_WALLETS\)/,
    "chat profile batch reads must not silently truncate over-limit normalized walletAddresses",
  );
  assert.match(
    readFileSync("app/api/chat/profile/route.ts", "utf8"),
    /walletAddress or walletAddresses is required/,
    "chat profile reads must require an explicit wallet scope instead of returning every stored profile",
  );
  assert.match(
    readFileSync("app/hooks/useChatProfile.ts", "utf8"),
    /normalizeChatAuthAddress\(walletAddress\)/,
    "chat profile hook must normalize wallet addresses before local cache and API use",
  );
  assert.doesNotMatch(
    readFileSync("app/hooks/useChatProfile.ts", "utf8"),
    /response\.text\(\)/,
    "chat profile save errors must use the bounded JSON response helper instead of raw response text",
  );
  assert.match(
    readFileSync("app/hooks/useChatProfile.ts", "utf8"),
    /const raw = localStorage\.getItem\(key\)[\s\S]*clearProfileKey\(key\)[\s\S]*const legacy = localStorage\.getItem\(LEGACY_STORAGE_KEY\)[\s\S]*JSON\.parse\(legacy\)[\s\S]*catch[\s\S]*clearProfileKey\(LEGACY_STORAGE_KEY\)[\s\S]*if \(!legacyRaw \|\| typeof legacyRaw !== "object"\)[\s\S]*clearProfileKey\(LEGACY_STORAGE_KEY\)/,
    "chat profile cache reads must clear corrupt or invalid current and legacy localStorage entries",
  );
  assert.match(
    readFileSync("app/hooks/useChat.ts", "utf8"),
    /normalizeChatAuthAddress\(walletAddress\)/,
    "chat send hook must normalize wallet addresses before optimistic or persisted messages",
  );
  assert.match(
    readFileSync("app/hooks/useChat.ts", "utf8"),
    /const raw = localStorage\.getItem\(CHAT_CACHE_KEY\)[\s\S]*localStorage\.removeItem\(CHAT_CACHE_KEY\)/,
    "chat message cache reads must clear corrupt or invalid localStorage entries",
  );
  const useChatOptimisticSource = readFileSync("app/hooks/useChat.ts", "utf8");
  assert.match(
    useChatOptimisticSource,
    /function createOptimisticMessageId[\s\S]*crypto\.randomUUID[\s\S]*crypto\.getRandomValues[\s\S]*Math\.random/,
    "chat optimistic local ids must prefer native crypto before legacy random fallback",
  );
  assert.match(
    useChatOptimisticSource,
    /id: createOptimisticMessageId\(now\)/,
    "chat send hook must use the centralized optimistic id helper",
  );
  assert.match(
    readFileSync("app/hooks/useChatWidgetRuntime.ts", "utf8"),
    /normalizeChatAuthAddress\(message\.sender\)/,
    "chat unread counters must normalize sender addresses before ownership comparison",
  );
  assert.match(
    readFileSync("app/components/chat/ChatWindow.tsx", "utf8"),
    /normalizeChatAuthAddress\(msg\.sender\)/,
    "chat message rows must normalize sender addresses before ownership styling",
  );
  assert.match(
    readFileSync("app/hooks/useRebate.ts", "utf8"),
    /getRebateCacheKey[\s\S]*getAddress\(address\)/,
    "rebate cache keys must normalize wallet addresses with the EVM address parser",
  );
  assert.match(
    readFileSync("app/hooks/useRebate.ts", "utf8"),
    /const cacheKey = getRebateCacheKey\(address\)[\s\S]*localStorage\.removeItem\(cacheKey\)[\s\S]*const cacheKey = getClaimPlanCacheKey\(address, epochs\)[\s\S]*localStorage\.removeItem\(cacheKey\)/,
    "rebate and claim-plan caches must clear corrupt or invalid localStorage entries",
  );
  assert.match(
    readFileSync("app/hooks/useRewardScanner.ts", "utf8"),
    /getRewardScanCacheKey[\s\S]*getAddress\(address\)/,
    "reward scan cache keys must normalize wallet addresses with the EVM address parser",
  );
  assert.match(
    readFileSync("app/hooks/useRewardScanner.ts", "utf8"),
    /const cacheKey = getRewardScanCacheKey\(address\)[\s\S]*let sourceKey = cacheKey[\s\S]*sourceKey = v1Key[\s\S]*localStorage\.removeItem\(sourceKey\)/,
    "reward scan cache reads must clear corrupt or invalid v2 and legacy cache entries",
  );
  assert.match(
    readFileSync("app/hooks/useDepositHistory.ts", "utf8"),
    /getDepositCacheKey[\s\S]*getAddress\(userAddress\)/,
    "deposit cache keys must normalize wallet addresses with the EVM address parser",
  );
  assert.match(
    readFileSync("app/hooks/useDepositHistory.ts", "utf8"),
    /function normalizeDepositUserAddress[\s\S]*getAddress\(userAddress\)\.toLowerCase\(\)/,
    "deposit history hook must normalize user addresses before cache and API use",
  );
  assert.match(
    readFileSync("app/hooks/useDepositHistory.ts", "utf8"),
    /const cacheKey = getDepositCacheKey\(userAddress\)[\s\S]*localStorage\.removeItem\(cacheKey\)/,
    "deposit history cache reads must clear corrupt or invalid localStorage entries",
  );
  assert.match(
    readFileSync("app/hooks/useAnalyticsAchievements.ts", "utf8"),
    /getAchievementStorageKey[\s\S]*getAddress\(walletAddress\)/,
    "achievement cache keys must normalize wallet addresses with the EVM address parser",
  );
  assert.match(
    readFileSync("app/api/rewards/route.ts", "utf8"),
    /getAddress\(typeof body\.user === "string" \? body\.user : ""\)\.toLowerCase\(\)/,
    "rewards route must normalize user addresses with the EVM address parser",
  );
  assert.match(
    readFileSync("app/api/_lib/rewardSummary.ts", "utf8"),
    /const normalizedUser = getAddress\(user\)\.toLowerCase\(\)/,
    "reward summary reads must normalize user addresses before cache and chain reads",
  );
  const headerWalletA11ySource = readFileSync("app/components/header/HeaderWalletCard.tsx", "utf8");
  assert.match(
    headerWalletA11ySource,
    /aria-label=\{embeddedAddressCopied \? "Privy wallet address copied" : "Copy Privy wallet address"\}/,
    "header wallet copy action must expose a stable accessible name",
  );
  assert.match(
    headerWalletA11ySource,
    /aria-label="Open Privy wallet address in explorer"/,
    "header wallet explorer icon link must expose a stable accessible name",
  );
  assert.match(
    headerWalletA11ySource,
    /target="_blank"[\s\S]{0,120}rel="noopener noreferrer"/,
    "header wallet explorer link must explicitly isolate new tabs",
  );
  const appNewTabIsolationIssues = [];
  const appWindowOpenIssues = [];
  for (const file of listSourceFiles("app")) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/<a\b[\s\S]*?>/g)) {
      const tag = match[0];
      if (!tag.includes('target="_blank"')) continue;
      const rel = tag.match(/\brel="([^"]*)"/)?.[1] ?? "";
      if (!/\bnoopener\b/.test(rel) || !/\bnoreferrer\b/.test(rel)) {
        appNewTabIsolationIssues.push(file);
      }
    }
    for (const match of source.matchAll(/window\.open\(([\s\S]*?)\);/g)) {
      const call = match[1];
      if (!call.includes('"_blank"')) continue;
      const features = call.match(/,\s*"([^"]*)"\s*\)?$/)?.[1] ?? "";
      if (!/\bnoopener\b/.test(features) || !/\bnoreferrer\b/.test(features)) {
        appWindowOpenIssues.push(file);
      }
    }
  }
  assert.deepEqual(
    [...new Set(appNewTabIsolationIssues)],
    [],
    "all app target=_blank links must explicitly use noopener noreferrer",
  );
  assert.deepEqual(
    [...new Set(appWindowOpenIssues)],
    [],
    "all app window.open(_blank) calls must explicitly use noopener and noreferrer",
  );
  const removedWalletExperimentMarker = "77" + "02";
  const removedWalletExperimentPatterns = [
    new RegExp(`\\bEIP-${removedWalletExperimentMarker}\\b`),
    new RegExp(`\\beip${removedWalletExperimentMarker}\\b`, "i"),
    new RegExp(`\\bWalletSettings${removedWalletExperimentMarker}\\b`),
    new RegExp(`\\b${removedWalletExperimentMarker}Delegate\\b`),
    new RegExp(`\\bpatch-privy-${removedWalletExperimentMarker}\\b`),
  ];
  const removedWalletExperimentIssues = [];
  const activeWalletExperimentSourceFiles = [
    ...listSourceFiles("app"),
    ...listSourceFiles("config"),
    ...listSourceFiles("contracts", /\.(?:sol|ts|mjs)$/),
    ...listSourceFiles("scripts"),
    ...listSourceFiles("docs", /\.(?:md|json|txt)$/).filter((file) => !file.startsWith(join("docs", "archive"))),
    "AGENTS.md",
    "README.md",
    "SECURITY.md",
    "package.json",
  ].filter((file) => file !== join("scripts", "test-business-logic.mjs"));
  for (const file of activeWalletExperimentSourceFiles) {
    const source = readFileSync(file, "utf8");
    if (removedWalletExperimentPatterns.some((pattern) => pattern.test(source))) {
      removedWalletExperimentIssues.push(file);
    }
  }
  assert.deepEqual(
    [...new Set(removedWalletExperimentIssues)],
    [],
    "active source, operator docs, and package metadata must not reintroduce the removed wallet experiment",
  );
  const walletSettingsOverviewSource = readFileSync("app/components/wallet/WalletSettingsOverviewPanel.tsx", "utf8");
  assert.match(
    walletSettingsOverviewSource,
    /role="switch"[\s\S]*aria-checked=\{animationEnabled\}[\s\S]*aria-label=\{animationEnabled \? "Disable animation effects" : "Enable animation effects"\}/,
    "wallet settings animation switch must expose a state-aware accessible name",
  );
  assert.match(
    walletSettingsOverviewSource,
    /connectedResolverClaimLabel[\s\S]*embeddedResolverClaimLabel[\s\S]*role="status"[\s\S]*aria-live="polite"[\s\S]*aria-label=\{connectedResolverClaimLabel\}[\s\S]*title=\{connectedResolverClaimLabel\}[\s\S]*aria-label=\{embeddedResolverClaimLabel\}[\s\S]*title=\{embeddedResolverClaimLabel\}/,
    "wallet settings resolver reward claims must expose state-aware labels and announce claim progress",
  );
  const stableChatWalletAddressSource = readFileSync("app/hooks/useStableChatWalletAddress.ts", "utf8");
  assert.match(
    stableChatWalletAddressSource,
    /getAddress\(address\)/,
    "stable chat wallet selection must normalize localStorage candidates with the EVM address parser",
  );
  assert.match(
    stableChatWalletAddressSource,
    /function clearStoredChatWalletAddress\(\)[\s\S]*window\.localStorage\.removeItem\(CHAT_WALLET_STORAGE_KEY\)[\s\S]*rawStored !== null[\s\S]*clearStoredChatWalletAddress\(\)/,
    "stable chat wallet selection must clear invalid or stale localStorage candidates",
  );
  assert.match(
    readFileSync("app/lib/chatSessionClient.ts", "utf8"),
    /normalizeChatAuthAddress/,
    "client chat session storage must normalize wallet addresses before keying localStorage",
  );
  const useChatAuthSource = readFileSync("app/hooks/useChatAuth.ts", "utf8");
  assert.match(
    useChatAuthSource,
    /normalizeChatAuthAddress\(walletAddress\)/,
    "chat auth hook must normalize wallet addresses before signing or session lookup",
  );
  assert.match(
    useChatAuthSource,
    /const normalizedWallet = normalizeChatAuthAddress\(walletAddress\);[\s\S]*if \(!normalizedWallet\) return false;/,
    "chat auth refresh must fail closed when wallet address normalization fails",
  );
  assert.match(
    useChatAuthSource,
    /readJsonResponse<\{ error\?: string \}>/,
    "chat auth API error parsing must use the bounded JSON response helper",
  );
  assert.doesNotMatch(
    useChatAuthSource,
    /response\.json\(\)/,
    "chat auth API error parsing must not use unbounded response.json",
  );
  assert.match(
    useChatAuthSource,
    /method: "personal_sign"/,
    "chat auth must request personal_sign from injected wallets",
  );
  assert.doesNotMatch(
    useChatAuthSource,
    /method: "eth_sign"/,
    "chat auth must not ask wallets for raw eth_sign fallback signatures",
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
    const validChatAddress = "0x1111111111111111111111111111111111111111";
    const chatKey = chatSessionClient.getChatAuthStorageKey(validChatAddress);
    assert.equal(chatSessionClient.normalizeChatAuthSessionExpiresAt("120000", 100_000), 120_000);
    assert.equal(chatSessionClient.normalizeChatAuthSessionExpiresAt(120_000, 100_000), 120_000);
    assert.equal(chatSessionClient.normalizeChatAuthSessionExpiresAt("00120000", 100_000), null);
    assert.equal(chatSessionClient.normalizeChatAuthSessionExpiresAt("1e5", 100_000), null);
    assert.equal(chatSessionClient.normalizeChatAuthSessionExpiresAt(120_000.5, 100_000), null);
    assert.equal(chatSessionClient.normalizeChatAuthSessionExpiresAt(Number.MAX_SAFE_INTEGER + 1, 100_000), null);
    assert.equal(chatSessionClient.normalizeChatAuthSessionExpiresAt(99_999, 100_000), null);
    assert.equal(
      chatSessionClient.normalizeChatAuthSessionExpiresAt(Date.now() + chatAuth.CHAT_AUTH_SESSION_TTL_MS + 120_000),
      null,
      "chat auth session expiry must reject implausibly far future timestamps",
    );
    const validStringExpiry = Date.now() + 60_000;
    storage.set(chatKey, JSON.stringify({ address: validChatAddress, expiresAt: String(validStringExpiry) }));
    assert.deepEqual(chatSessionClient.loadChatAuthSession(validChatAddress), {
      address: validChatAddress,
      expiresAt: validStringExpiry,
    });
    storage.set(chatKey, JSON.stringify({ address: validChatAddress, expiresAt: Date.now() - 1 }));
    assert.equal(chatSessionClient.loadChatAuthSession(validChatAddress), null);
    assert.equal(storage.has(chatKey), false, "expired chat auth session must be cleared from storage");
    storage.set(chatKey, JSON.stringify({ address: validChatAddress, expiresAt: Date.now() + chatAuth.CHAT_AUTH_SESSION_TTL_MS + 120_000 }));
    assert.equal(chatSessionClient.loadChatAuthSession(validChatAddress), null);
    assert.equal(storage.has(chatKey), false, "far-future chat auth session must be cleared from storage");
    storage.set(chatKey, JSON.stringify({ address: validChatAddress, expiresAt: Date.now() + 60_000.5 }));
    assert.equal(chatSessionClient.loadChatAuthSession(validChatAddress), null);
    assert.equal(storage.has(chatKey), false, "fractional chat auth session expiry must be cleared from storage");
    storage.set(chatKey, "{bad json");
    assert.equal(chatSessionClient.loadChatAuthSession(validChatAddress), null);
    assert.equal(storage.has(chatKey), false, "corrupt chat auth session must be cleared from storage");
    storage.set(chatKey, JSON.stringify({ address: "0x0000000000000000000000000000000000000002", expiresAt: Date.now() + 60_000 }));
    assert.equal(chatSessionClient.loadChatAuthSession(validChatAddress), null);
    assert.equal(storage.has(chatKey), false, "mismatched chat auth session must be cleared from storage");
    storage.set(chatKey, JSON.stringify({ address: validChatAddress }));
    assert.equal(chatSessionClient.loadChatAuthSession(validChatAddress), null);
    assert.equal(storage.has(chatKey), false, "invalid chat auth session shape must be cleared from storage");
    assert.equal(chatSessionClient.getChatAuthStorageKey("0xabc"), "");
    assert.equal(chatSessionClient.loadChatAuthSession("0xabc"), null);
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

  const chatSessionClientSource = readFileSync("app/lib/chatSessionClient.ts", "utf8");
  assert.match(
    chatSessionClientSource,
    /function normalizeChatAuthSessionExpiresAt[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*\/\^\(\?:0\|\[1-9\]\\d\{0,15\}\)\$\/[\s\S]*expiresAt - now > CHAT_AUTH_SESSION_TTL_MS \+ CHAT_AUTH_SESSION_MAX_FUTURE_SKEW_MS[\s\S]*const expiresAt = normalizeChatAuthSessionExpiresAt\(parsed\.expiresAt\)[\s\S]*const expiresAt = normalizeChatAuthSessionExpiresAt\(session\.expiresAt\)/,
    "client chat sessions must normalize expiry timestamps before restore or save",
  );
  assert.doesNotMatch(
    chatSessionClientSource,
    /typeof parsed\.expiresAt !== "number"[\s\S]*parsed\.expiresAt <= Date\.now\(\)|expiresAt:\s*parsed\.expiresAt/,
    "client chat session storage must not return to broad expiry acceptance",
  );
  assert.match(
    useChatAuthSource,
    /normalizeChatAuthSessionExpiresAt\(response\.headers\.get\("x-chat-session-expires-at"\)\)/,
    "chat auth hook must normalize server expiry headers before storing client sessions",
  );
  assert.doesNotMatch(
    useChatAuthSource,
    /Number\(response\.headers\.get\("x-chat-session-expires-at"\)/,
    "chat auth hook must not coerce server expiry headers with broad Number parsing",
  );

  assert.equal(indexerFinality.parseIndexerFinalityBlocks("12"), 12n);
  assert.equal(indexerFinality.parseIndexerFinalityBlocks("-1"), 0n);
  assert.equal(indexerFinality.parseIndexerFinalityBlocks("bad"), 0n);
  assert.equal(indexerFinality.getIndexerFinalityTargetBlock(100n, 12n), 88n);
  assert.equal(indexerFinality.getIndexerFinalityTargetBlock(100n, 0n), 100n);
  assert.equal(indexerFinality.getIndexerFinalityTargetBlock(5n, 12n), null);
  assert.equal(indexerFinality.getIndexerTargetLagBlocks(80n, 88n), 8);
  assert.equal(
    indexerFinality.getIndexerTargetLagBlocks(0n, BigInt(Number.MAX_SAFE_INTEGER) + 10n),
    Number.MAX_SAFE_INTEGER,
  );
  assert.equal(indexerFinality.getIndexerTargetLagBlocks(90n, 88n), 0);
  assert.equal(indexerFinality.getIndexerTargetLagBlocks(null, 88n), null);
  assert.equal(indexerFinality.getIndexerTargetLagBlocks(80n, null), null);
  assert.match(
    readFileSync("app/lib/indexerFinality.ts", "utf8"),
    /function bigintToNonNegativeSafeNumber[\s\S]*Number\.MAX_SAFE_INTEGER[\s\S]*return bigintToNonNegativeSafeNumber\(targetBlock - lastIndexedBlock\)/,
    "indexer finality target lag must saturate unsafe bigint deltas instead of broadly coercing them",
  );
  assert.match(
    readFileSync("scripts/audit-chain-indexer-window.mjs", "utf8"),
    /function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*!dbPath \|\| !regularFileStat\(dbPath\)[\s\S]*LORE_DB_PATH must point to an existing indexer SQLite database file/,
    "chain-indexer audit must reject missing or directory DB paths through a shared regular-file stat boundary",
  );
  assert.equal(indexerFinality.hasMainnetIndexerFinality("12"), true);
  assert.equal(indexerFinality.hasMainnetIndexerFinality("0"), false);
  assert.equal(indexerFinality.hasMainnetIndexerFinality("bad"), false);
  assert.equal(indexerWatchPolicy.parseIndexerWatchFailureLimit("3"), 3);
  assert.equal(indexerWatchPolicy.parseIndexerWatchFailureLimit("0"), 5);
  assert.equal(indexerWatchPolicy.parseIndexerWatchFailureLimit("101"), 5);
  assert.deepEqual(indexerWatchPolicy.recordIndexerWatchFailure(0, 3), {
    failures: 1,
    shouldRestart: false,
  });
  assert.deepEqual(indexerWatchPolicy.recordIndexerWatchFailure(2, 3), {
    failures: 3,
    shouldRestart: true,
  });
  assert.deepEqual(indexerWatchPolicy.recordIndexerWatchFailure(2.5, 3), {
    failures: 1,
    shouldRestart: false,
  });
  assert.deepEqual(indexerWatchPolicy.recordIndexerWatchFailure(Number.NaN, 3), {
    failures: 1,
    shouldRestart: false,
  });
  assert.deepEqual(indexerWatchPolicy.recordIndexerWatchFailure(Number.MAX_SAFE_INTEGER + 1, 3), {
    failures: 1,
    shouldRestart: false,
  });
  assert.deepEqual(indexerWatchPolicy.recordIndexerWatchFailure(2, 2.5), {
    failures: 3,
    shouldRestart: false,
  });
  const indexerWatchPolicySource = readFileSync("app/lib/indexerWatchPolicy.ts", "utf8");
  assert.match(
    indexerWatchPolicySource,
    /function normalizeIndexerWatchFailureCount\(value: number\)[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*function normalizeIndexerWatchFailureLimit\(value: number\)[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*const limit = normalizeIndexerWatchFailureLimit\(failureLimit\)/,
    "indexer watch restart policy must reject malformed failure counters and limits before restart decisions",
  );
  assert.doesNotMatch(
    indexerWatchPolicySource,
    /Math\.trunc\(consecutiveFailures\)/,
    "indexer watch restart policy must not coerce malformed counters with Math.trunc",
  );
  assert.equal(canaryHealthTelemetry.parseCanaryHealthBaseUrl(undefined), null);
  assert.equal(canaryHealthTelemetry.parseCanaryHealthBaseUrl("http://localhost:3000").origin, "http://localhost:3000");
  assert.equal(canaryHealthTelemetry.parseCanaryHealthBaseUrl("https://ops.example.com").origin, "https://ops.example.com");
  assert.throws(() => canaryHealthTelemetry.parseCanaryHealthBaseUrl("http://example.com"), /must use HTTPS/);
  assert.throws(() => canaryHealthTelemetry.parseCanaryHealthBaseUrl("https://user:pass@example.com"), /without credentials/);
  assert.throws(() => canaryHealthTelemetry.parseCanaryHealthBaseUrl("https://example.com/health"), /without credentials/);
  assert.throws(() => canaryHealthTelemetry.parseCanaryHealthBaseUrl("https://example.com?token=secret"), /without credentials/);
  assert.throws(() => canaryHealthTelemetry.parseCanaryHealthBaseUrl("https://example.com#secret"), /without credentials/);
  assert.deepEqual(
    canaryHealthTelemetry.parseCanaryHealthPayloads(
      { redacted: false, process: { uptimeSeconds: 10, rssBytes: 20, heapUsedBytes: 15 } },
      { redacted: false, storage: { dbBytes: 30, walBytes: 5, diskFreeBytes: 100 } },
    ),
    { dbBytes: 30, diskFreeBytes: 100, heapUsedBytes: 15, rssBytes: 20, runtimeUptimeSeconds: 10, walBytes: 5 },
  );
  assert.throws(
    () => canaryHealthTelemetry.parseCanaryHealthPayloads({ redacted: true }, { redacted: false }),
    /redacted/,
  );
  for (const malformedMetric of [null, "", "10", 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, -1]) {
    assert.throws(
      () => canaryHealthTelemetry.parseCanaryHealthPayloads(
        { redacted: false, process: { uptimeSeconds: malformedMetric, rssBytes: 20, heapUsedBytes: 15 } },
        { redacted: false, storage: { dbBytes: 30, walBytes: 5, diskFreeBytes: 100 } },
      ),
      /process\.uptimeSeconds/,
      `canary health metrics must reject ${String(malformedMetric)}`,
    );
  }
  const canaryHealthTelemetrySource = readFileSync("app/lib/canaryHealthTelemetry.ts", "utf8");
  assert.match(
    canaryHealthTelemetrySource,
    /function readNonNegativeMetric\(value: unknown, field: string\)[\s\S]*typeof value !== "number"[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*value < 0/,
    "canary health metrics must require non-negative safe integer numbers",
  );
  assert.match(
    canaryHealthTelemetrySource,
    /url\.username \|\| url\.password \|\| url\.pathname !== "\/" \|\| url\.search \|\| url\.hash[\s\S]*must be an origin without credentials/,
    "canary health base URL must be an origin-only URL without hidden credentials or path material",
  );
  assert.doesNotMatch(
    canaryHealthTelemetrySource,
    /const metric = Number\(value\)|Number\.isFinite\(metric\)/,
    "canary health metrics must not broadly coerce null, string, or fractional payload values",
  );
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
    gameDataHelpers.buildWinningTileId(true, [0n, 0n, 25n, true, false, false]),
    25,
    "resolved current epoch winner should publish valid grid tile IDs",
  );
  assert.equal(
    gameDataHelpers.buildWinningTileId(true, [0n, 0n, 26n, true, false, false]),
    null,
    "resolved current epoch winner must reject out-of-range grid tile IDs",
  );
  assert.equal(
    gameDataHelpers.buildWinningTileId(true, [0n, 0n, 0n, true, false, false]),
    null,
    "resolved current epoch winner must reject zero tile IDs",
  );
  assert.equal(
    gameDataHelpers.buildWinningTileId(false, [0n, 0n, 2n, true, false, false]),
    null,
    "winner tile must stay hidden when not revealing",
  );
  assert.deepEqual(
    gameDataHelpers.buildEpochDurationChange(60n, 120n, 999n, 44n),
    {
      current: 60,
      next: 120,
      eta: 999,
      effectiveFromEpoch: "44",
    },
    "epoch duration change helper should publish safe chain integer evidence",
  );
  assert.equal(
    gameDataHelpers.buildEpochDurationChange(60n, 0n, 999n, 44n),
    null,
    "epoch duration change helper should ignore zero pending duration",
  );
  assert.equal(
    gameDataHelpers.buildEpochDurationChange(60n, BigInt(Number.MAX_SAFE_INTEGER) + 1n, 999n, 44n),
    null,
    "epoch duration change helper should reject unsafe pending duration evidence",
  );
  assert.deepEqual(
    gameDataHelpers.buildEpochDurationChange(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 120n, BigInt(Number.MAX_SAFE_INTEGER) + 1n, 44n),
    {
      current: null,
      next: 120,
      eta: null,
      effectiveFromEpoch: "44",
    },
    "epoch duration change helper should null unsafe optional timing fields",
  );
  assert.equal(
    gameDataHelpers.buildTileViewData(
      [[1_234_567_899_000_000_000_000n], [1n]],
      [1],
    )[0].poolDisplay,
    "1234.57",
    "tile pool display must format raw wei without unsafe Number(formatUnits()) conversion",
  );
  const gameDataHelpersSource = readFileSync("app/hooks/useGameData.helpers.ts", "utf8");
  assert.match(
    gameDataHelpersSource,
    /formatLineaWeiDisplayNumber[\s\S]*function formatWeiToNumber\(value: unknown\)[\s\S]*return formatLineaWeiDisplayNumber\(value\)/,
    "game data numeric compatibility fields must derive from bounded raw-wei formatting",
  );
  assert.doesNotMatch(
    gameDataHelpersSource,
    /function formatWeiToNumber\(value: unknown\)[\s\S]*(?:Number\(formatUnits\(|Number\(formatLineaAmountFixed\(value, 6\)\))/,
    "game data helpers must not coerce live wei values through Number(formatUnits()) or formatted decimal strings",
  );
  assert.match(
    gameDataHelpersSource,
    /function parseGridTileId\(value: unknown\)[\s\S]*value < 1n \|\| value > BigInt\(GRID_SIZE\)[\s\S]*return tuple\[3\] \? parseGridTileId\(tuple\[2\]\) : null/,
    "game data winner tile helper must reject unsafe or out-of-range grid tile IDs",
  );
  assert.doesNotMatch(
    gameDataHelpersSource,
    /Number\(tuple\[2\]\) > 0|return Number\(tuple\[2\]\)/,
    "game data winner tile helper must not use positive-only tile parsing",
  );
  assert.match(
    gameDataHelpersSource,
    /function parseChainSafeInteger\(value: unknown\)[\s\S]*value > BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*const next = parseChainSafeInteger\(pendingEpochDuration\)[\s\S]*current: parseChainSafeInteger\(epochDurationSec\)[\s\S]*eta: parseChainSafeInteger\(pendingEpochDurationEta\)/,
    "game data epoch duration change helper must safely narrow chain timing evidence",
  );
  assert.doesNotMatch(
    gameDataHelpersSource,
    /const next = pendingEpochDuration \? Number\(pendingEpochDuration\) : 0|current: epochDurationSec \? Number\(epochDurationSec\) : null|eta: pendingEpochDurationEta \? Number\(pendingEpochDurationEta\) : null/,
    "game data epoch duration change helper must not broadly coerce chain timing evidence",
  );
  assert.match(
    gameDataHelpersSource,
    /const liveUsers = parseChainSafeInteger\(liveUsersArr\?\.\[i\]\) \?\? 0[\s\S]*Math\.max\([\s\S]*liveUsers/,
    "game data tile view helper must safely narrow live user count evidence",
  );
  assert.doesNotMatch(
    gameDataHelpersSource,
    /const liveUsers = Number\(liveUsersArr\?\.\[i\] \?\? 0n\)|Number\.isFinite\(liveUsers\) \? liveUsers : 0/,
    "game data tile view helper must not broadly coerce live user counts",
  );
  assert.equal(
    gameDataHelpers.buildTileViewData(
      [[10_000_000_000_000_000n], [0n]],
      [0],
    )[0].users,
    1,
    "displayed positive tile pool should show at least one player while user counts catch up",
  );
  assert.equal(
    gameDataHelpers.buildTileViewData(
      [[10_000_000_000_000_000n], [7n]],
      [0],
    )[0].users,
    7,
    "tile view data should publish safe live user counts",
  );
  assert.equal(
    gameDataHelpers.buildTileViewData(
      [[10_000_000_000_000_000n], [BigInt(Number.MAX_SAFE_INTEGER) + 1n]],
      [0],
    )[0].users,
    1,
    "tile view data should reject unsafe live user counts and keep visible positive pool fallback",
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
    /formatTileAmountFixed\(value: string\)[\s\S]*formatDecimalTextFixed\(value\.trim\(\), 2\)[\s\S]*isPositiveFixedDecimalText\(formatTileAmountFixed\(displayAmount\)\)/,
    "mining grid tile display and visible stake detection must use canonical decimal-text formatting",
  );
  assert.doesNotMatch(
    miningGridSource,
    /Number\.parseFloat\(value\)|Number\.parseFloat\(displayAmount\)|amount\.toFixed\(2\)/,
    "mining grid tile display must not use parseFloat().toFixed() for pool amounts",
  );
  assert.match(
    miningGridSource,
    /showUserBadge[\s\S]*hasDisplayedStake[\s\S]*showUserBadge &&/,
    "mining grid must hide the player badge on display-zero tiles",
  );
  assert.doesNotMatch(
    miningGridSource,
    /disabled=\{!liveStateReady \|\| isRevealing \|\| isAnalyzing\}/,
    "an expired quiet epoch must remain selectable so the next bet can atomically advance it",
  );
  assert.match(
    miningGridSource,
    /Number\.isSafeInteger\(tileId\)[\s\S]*tileId < 1 \|\| tileId > GRID_SIZE[\s\S]*onTileClick\(tileId\)/,
    "mining grid delegated click handling must reject malformed tile ids before invoking bet selection",
  );
  assert.doesNotMatch(
    miningGridSource,
    /Number\.isInteger\(tileId\) \|\| tileId <= 0/,
    "mining grid delegated click handling must not use positive-only tile guards",
  );
  const manualBetFormSource = readFileSync("app/hooks/useManualBetForm.ts", "utf8");
  assert.doesNotMatch(
    manualBetFormSource,
    /isRevealing \|\| isAnalyzing/,
    "manual bets must not be disabled solely because an expired epoch is awaiting atomic resolution",
  );
  const manualBetPanelSource = readFileSync("app/components/BetPanel.tsx", "utf8");
  assert.doesNotMatch(
    manualBetPanelSource,
    /quickPickDisabled[^\n]*isAnalyzing/,
    "quick picks must stay available for a quiet expired epoch",
  );
  const pageRuntimeEffectsSource = readFileSync("app/hooks/usePageRuntimeEffects.ts", "utf8");
  assert.match(
    pageRuntimeEffectsSource,
    /GRID_SIZE[\s\S]*function parseHistoryWinningTile\(value: string\)[\s\S]*\^\[1-9\]\\d\*\$[\s\S]*Number\.isSafeInteger\(tile\)[\s\S]*tile >= 1 && tile <= GRID_SIZE[\s\S]*const tile = parseHistoryWinningTile\(round\.winningTile\)[\s\S]*tile !== null/,
    "hot-tile history stats must reject unsafe or out-of-range winning tile IDs",
  );
  assert.doesNotMatch(
    pageRuntimeEffectsSource,
    /Number\(round\.winningTile\)[\s\S]*tile > 0/,
    "hot-tile history stats must not use positive-only winning tile parsing",
  );
  assert.doesNotMatch(
    pageRuntimeEffectsSource,
    /handleTileClick\(id,\s*isRevealingRef\.current\s*\|\|\s*isAnalyzingRef\.current\)/,
    "tile selection must not silently no-op while a quiet expired epoch is awaiting atomic resolution",
  );

  await runRuntimeRecoveryTests();
  await runCacheAndPlannerTests();

  await runWalletRuntimeTests();
  const AnalyticsBlockchainHistoryPanel = analyticsBlockchainHistoryPanelModule.AnalyticsBlockchainHistoryPanel
    ?? analyticsBlockchainHistoryPanelModule.default?.AnalyticsBlockchainHistoryPanel
    ?? analyticsBlockchainHistoryPanelModule.default;
  assert.ok(AnalyticsBlockchainHistoryPanel, "blockchain history component export must remain available");
  const analyticsBlockchainHistoryPanelSource = readFileSync("app/components/analytics/AnalyticsBlockchainHistoryPanel.tsx", "utf8");
  assert.match(
    analyticsBlockchainHistoryPanelSource,
    /GRID_SIZE[\s\S]*function parseHistoryWinningTile\(value: string\)[\s\S]*\^\[1-9\]\\d\*\$[\s\S]*Number\.isSafeInteger\(tile\)[\s\S]*tile >= 1 && tile <= GRID_SIZE[\s\S]*const winningTile = parseHistoryWinningTile\(row\.winningTile\)[\s\S]*winningTile !== null/,
    "blockchain history display must reject unsafe or out-of-range winning tile IDs",
  );
  assert.doesNotMatch(
    analyticsBlockchainHistoryPanelSource,
    /Number\(row\.winningTile\)[\s\S]*winBlockNum > 0/,
    "blockchain history display must not use positive-only winning tile parsing",
  );
  const emptyHistoryMarkup = renderToStaticMarkup(createElement(AnalyticsBlockchainHistoryPanel, {
    historyViewData: [],
    historyLoading: false,
    historyRefreshing: false,
    newHistoryIds: new Set(),
  }));
  assert.match(emptyHistoryMarkup, /No rounds yet/, "empty blockchain history must render an explicit empty state");
  assert.doesNotMatch(emptyHistoryMarkup, /Loading rounds/, "settled empty blockchain history must not look stuck loading");
  const loadingHistoryMarkup = renderToStaticMarkup(createElement(AnalyticsBlockchainHistoryPanel, {
    historyViewData: [],
    historyLoading: true,
    historyRefreshing: false,
    newHistoryIds: new Set(),
  }));
  assert.match(
    loadingHistoryMarkup,
    /role="status"[\s\S]*aria-live="polite"[\s\S]*aria-busy="true"[\s\S]*Loading rounds/,
    "blockchain history initial loading state must be announced as a polite busy status",
  );
  assert.match(
    loadingHistoryMarkup,
    /aria-hidden="true"[\s\S]*animate-synced-pulse/,
    "blockchain history loading status dots must stay decorative",
  );
  const invalidWinningTileMarkup = renderToStaticMarkup(createElement(AnalyticsBlockchainHistoryPanel, {
    historyViewData: [{
      roundId: "77",
      poolDisplay: "10",
      winningTile: "999",
      isResolved: true,
      userWon: true,
      isDailyJackpot: false,
      isWeeklyJackpot: false,
    }],
    historyLoading: false,
    historyRefreshing: false,
    newHistoryIds: new Set(),
  }));
  assert.doesNotMatch(
    invalidWinningTileMarkup,
    /Block #999|You won/,
    "blockchain history must not render invalid winning tile rows as user wins",
  );

  console.log("Business logic tests passed.");
}

const suppressedExpectedWarnings = await withExpectedWarningSuppression(main);
if (suppressedExpectedWarnings > 0) {
  console.log(`Suppressed ${suppressedExpectedWarnings} expected synthetic warning log(s).`);
}
