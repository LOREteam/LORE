import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { redactProofText } from "./redact-proof-output.mjs";
import { parseSummaryTimeoutEnv } from "./summary-timeout.mjs";

const tsxCliPath = resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
if (!existsSync(tsxCliPath)) {
  throw new Error("test:logic runner unavailable: node_modules/tsx/dist/cli.mjs is missing");
}
// Avoid the Windows npm.cmd shell tree: spawnSync can time out the shell while
// leaving its tsx child running. This is the command behind `test:logic`.
const testArgs = [tsxCliPath, "scripts/test-business-logic.mjs"];
const timeoutMs = parseSummaryTimeoutEnv("BUSINESS_LOGIC_SUMMARY_TIMEOUT_MS", 180_000);
const MAX_ASSERTION_FAILURE_COUNT = 9999;
const startedAt = Date.now();

function nonNegativeSafeIntegerText(value) {
  const text = String(value ?? "").trim();
  if (!/^(?:0|[1-9]\d{0,15})$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function countAssertionFailures(text) {
  const pattern = /\bAssertionError\b/g;
  let count = 0;
  let match = pattern.exec(text);
  while (match !== null) {
    count += 1;
    if (count >= MAX_ASSERTION_FAILURE_COUNT) return MAX_ASSERTION_FAILURE_COUNT;
    match = pattern.exec(text);
  }
  return count;
}

const BUSINESS_TEST_MODULES = [
  "scripts/test-business-logic.mjs",
  "scripts/test-business-wallet-models.mjs",
  "scripts/test-business-read-models.mjs",
  "scripts/test-business-reward-scanner.mjs",
  "scripts/test-business-live-state-api.mjs",
  "scripts/test-business-indexer-normalization.mjs",
  "scripts/test-business-runtime-recovery.mjs",
  "scripts/test-business-cache-planners.mjs",
  "scripts/test-business-wallet-runtime.mjs",
  "scripts/test-business-history-presentation.mjs",
  "scripts/test-business-game-data-presentation.mjs",
  "scripts/test-business-runtime-polling.mjs",
  "scripts/test-business-chat-polling.mjs",
  "scripts/test-business-chat-content.mjs",
  "scripts/test-business-public-api-read-models.mjs",
  "scripts/test-business-wallet-presentation.mjs",
  "scripts/test-business-api-recovery-storage.mjs",
  "scripts/test-business-api-integer-queries.mjs",
  "scripts/test-business-api-request-boundaries.mjs",
  "scripts/test-business-production-runtime-env.mjs",
  "scripts/test-business-production-runtime-config.mjs",
  "scripts/test-business-production-runtime-strict.mjs",
  "scripts/test-business-jackpot-rebate-security.mjs",
  "scripts/test-business-chat-client-safety.mjs",
  "scripts/test-business-release-operations.mjs",
  "scripts/test-business-runtime-metrics.mjs",
];
const businessTestSources = BUSINESS_TEST_MODULES.map((path) => readFileSync(path, "utf8"));

function hasSourceGuard(pattern) {
  return businessTestSources.some((source) => {
    pattern.lastIndex = 0;
    return pattern.test(source);
  });
}

const result = spawnSync(process.execPath, testArgs, {
  cwd: process.cwd(),
  encoding: "utf8",
  maxBuffer: 2 * 1024 * 1024,
  timeout: timeoutMs,
  env: {
    ...process.env,
    NO_UPDATE_NOTIFIER: "1",
    npm_config_update_notifier: "false",
    npm_config_fund: "false",
  },
});

const elapsedMs = Date.now() - startedAt;
const durationMs = Number.isSafeInteger(elapsedMs) && elapsedMs >= 0 ? elapsedMs : 0;
const childExitCode = Number.isSafeInteger(result.status) ? result.status : null;
const output = redactProofText(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
const timedOut = result.error?.code === "ETIMEDOUT";
const outputTooLarge = result.error?.code === "ENOBUFS";
const businessLogic = /\bBusiness logic tests passed\.(?:\s|$)/.test(output);
const assertionFailures = countAssertionFailures(output);
const expectedWarnings = nonNegativeSafeIntegerText(output.match(/Suppressed\s+(\d+)\s+expected synthetic warning/)?.[1]) ?? 0;
const jsonNoStoreRoutes = hasSourceGuard(/JSON responses must set no-store cache headers/);
const sessionVaryCookie = hasSourceGuard(/session responses must vary on Cookie/);
const boundedJsonRoutes = hasSourceGuard(/must bound JSON request bodies/);
const rateLimitNoStore = hasSourceGuard(/rate-limit responses must pass through the route no-store helper/);
const routeErrorRedaction = hasSourceGuard(/safe route errors must redact provider URLs/);
const depositsRecoveryGlobalBound = hasSourceGuard(/deposits API must globally bound distinct-address slow recovery scans/);
const browserBaselineCompactPerformance = hasSourceGuard(/browser baseline must expose compact quality, request, runtime, and long-task performance proof fields/);
const authTrustedOriginFailClosed = hasSourceGuard(/production auth must not derive its signed origin from an untrusted request host/);
const authReplayNonceBoundary = hasSourceGuard(/auth must use a shared replay lock when production runs more than one web replica/);
const authCanonicalNonceBoundary = hasSourceGuard(/auth must canonical-parse signed nonces before session issuance/);
const authSessionCookieBoundary = hasSourceGuard(/session cookies must store and validate normalized wallet addresses/);
const authBoundaryProof =
  authTrustedOriginFailClosed &&
  authReplayNonceBoundary &&
  authCanonicalNonceBoundary &&
  authSessionCookieBoundary;
const sharedRateLimitRetryAfterBound = hasSourceGuard(/shared rate-limit 429 retry-after values must stay bounded/);
const externalRateLimitPublicEndpoint = hasSourceGuard(/external rate-limit store must use a public HTTPS endpoint/);
const externalRateLimitResponseBound = hasSourceGuard(/external rate-limit responses must fail closed on malformed UTF-8/);
const externalSharedLockCanonical = hasSourceGuard(/production external shared lock detection must canonical-parse WEB_REPLICA_COUNT/);
const replicaRateLimitStrictConfig = hasSourceGuard(/strict pre-mainnet two-replica external rate-limit requirements/);
const replicaRateLimitBoundaryProof =
  sharedRateLimitRetryAfterBound &&
  externalRateLimitPublicEndpoint &&
  externalRateLimitResponseBound &&
  externalSharedLockCanonical &&
  replicaRateLimitStrictConfig;
const miningPendingRecoveryScoped = hasSourceGuard(/mining wallet writes must persist chain, contract, actor, hash, and nonce before waiting for receipt recovery/);
const miningReceiptRevertExplicit = hasSourceGuard(/manual and Auto-Miner receipt waits must throw explicit reverted errors from both primary and late receipt checks/);
const walletHashlessNonceRecovery = hasSourceGuard(/hashless nonce recovery must block duplicate sends while pending nonce is ahead/);
const manualMinePendingAmbiguousSafe = hasSourceGuard(/should not confirm a pending transaction by balance delta[\s\S]*ambiguous wallet send must not finalize/);
const approvalDuplicateSendSafe = hasSourceGuard(/approval duplicate-send guard must stop manual and Auto-Miner approve replacement until pending timeout/);
const autoMinerNonceRecoverySafe = hasSourceGuard(/Auto-Miner bet loop must reject unsafe latest\/pending nonce evidence before replacement or duplicate-send decisions/);
const autoMinerRpcReconnectSafe = hasSourceGuard(/RPC offline, retry in 0s\.\.\.[\s\S]*reconnecting RPC/);
const walletTxStateMachineProof =
  miningPendingRecoveryScoped &&
  miningReceiptRevertExplicit &&
  walletHashlessNonceRecovery &&
  manualMinePendingAmbiguousSafe &&
  approvalDuplicateSendSafe &&
  autoMinerNonceRecoverySafe &&
  autoMinerRpcReconnectSafe;
const rewardClaimStateSafe =
  hasSourceGuard(/reward claim receipt helper must reject primary and late reverted receipts/) &&
  hasSourceGuard(/single reward claim notifications must include explorer links when a tx hash is available/) &&
  hasSourceGuard(/batch reward claim notifications must keep the latest tx hash for explorer links/) &&
  hasSourceGuard(/deep single reward claim must surface wallet rejection instead of silently clearing the claim state/) &&
  hasSourceGuard(/deep batch reward claim must surface wallet rejection when no prior claim transaction succeeded or remains pending/) &&
  hasSourceGuard(/deep reward claims must stop batches and stale state updates when the active wallet changes/);
const safetyPoolClaimStateSafe =
  hasSourceGuard(/Safety Pool confirmation must surface reverted receipts before ambiguous-pending fallback/) &&
  hasSourceGuard(/Safety Pool reverted receipts must be rethrown instead of converted to ambiguous pending/) &&
  hasSourceGuard(/Safety Pool post-send state reads must fail as ambiguous pending rather than trigger a duplicate fallback/) &&
  hasSourceGuard(/Safety Pool claim must synchronously reject duplicate starts before React updates the loading state/) &&
  hasSourceGuard(/Safety Pool batch claims must simulate before gas fallback or wallet submission/) &&
  hasSourceGuard(/Safety Pool single-epoch fallback must simulate before gas fallback or wallet submission/) &&
  hasSourceGuard(/Safety Pool claims must stop split sends and stale refreshes when the active wallet changes/) &&
  hasSourceGuard(/Safety Pool claims must surface ambiguous pending with tx links, partial-success rejection, and plain wallet rejection explicitly/) &&
  hasSourceGuard(/Safety Pool split claims must preserve partial success counts when later epochs fail/);
const resolverClaimStateSafe =
  hasSourceGuard(/wallet transfer receipt decisions must use the shared independent-client verifier/) &&
  hasSourceGuard(/wallet intents must require exact two-client receipt agreement plus a stable quorum reread before success or revert can clear an intent/) &&
  hasSourceGuard(/resolver reward claims must simulate before gas fallback or wallet submission/) &&
  hasSourceGuard(/connected and embedded resolver claims must share a synchronous submission lock/) &&
  hasSourceGuard(/connected resolver claims must re-check actor ownership before send, after receipt, and in failure handling/) &&
  hasSourceGuard(/embedded resolver claims must re-check actor ownership before send, after receipt, and in failure handling/) &&
  hasSourceGuard(/connected resolver claims must surface pending, ambiguous-with-hash, and rejected wallet states explicitly/) &&
  hasSourceGuard(/embedded resolver claims must surface pending, ambiguous-with-hash, and rejected wallet states explicitly/);
const walletClaimStateMachineProof =
  rewardClaimStateSafe &&
  safetyPoolClaimStateSafe &&
  resolverClaimStateSafe;
const apiBoundaryProof =
  jsonNoStoreRoutes &&
  sessionVaryCookie &&
  boundedJsonRoutes &&
  rateLimitNoStore &&
  routeErrorRedaction &&
  depositsRecoveryGlobalBound &&
  authBoundaryProof &&
  replicaRateLimitBoundaryProof;
const localProof =
  apiBoundaryProof &&
  browserBaselineCompactPerformance &&
  walletTxStateMachineProof &&
  walletClaimStateMachineProof;
const pass = result.status === 0 && businessLogic && localProof && assertionFailures === 0 && !timedOut && !outputTooLarge;

console.log(JSON.stringify({
  status: pass ? "pass" : "fail",
  businessLogic,
  localProof,
  apiBoundaryProof,
  walletTxStateMachineProof,
  walletClaimStateMachineProof,
  jsonNoStoreRoutes,
  sessionVaryCookie,
  boundedJsonRoutes,
  rateLimitNoStore,
  routeErrorRedaction,
  depositsRecoveryGlobalBound,
  browserBaselineCompactPerformance,
  authTrustedOriginFailClosed,
  authReplayNonceBoundary,
  authCanonicalNonceBoundary,
  authSessionCookieBoundary,
  authBoundaryProof,
  sharedRateLimitRetryAfterBound,
  externalRateLimitPublicEndpoint,
  externalRateLimitResponseBound,
  externalSharedLockCanonical,
  replicaRateLimitStrictConfig,
  replicaRateLimitBoundaryProof,
  miningPendingRecoveryScoped,
  miningReceiptRevertExplicit,
  walletHashlessNonceRecovery,
  manualMinePendingAmbiguousSafe,
  approvalDuplicateSendSafe,
  autoMinerNonceRecoverySafe,
  autoMinerRpcReconnectSafe,
  rewardClaimStateSafe,
  safetyPoolClaimStateSafe,
  resolverClaimStateSafe,
  expectedWarnings: Number.isSafeInteger(expectedWarnings) ? expectedWarnings : 0,
  assertionFailures,
  timedOut,
  durationMs,
  childExitCode,
  ...(!localProof ? { issue: "local-proof-summary-missing" } : {}),
  ...(outputTooLarge ? { issue: "business-logic-output-too-large" } : {}),
  ...(!outputTooLarge && result.error && result.error.code !== "ETIMEDOUT" ? { issue: "business-logic-spawn-failed" } : {}),
}));

if (!pass) {
  process.exitCode = 1;
}
