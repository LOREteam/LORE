import { spawnSync } from "node:child_process";
import { runIsolatedBusinessLogicChild } from "./business-logic-isolated-runner.mjs";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { redactProofText } from "./redact-proof-output.mjs";
import { parseSummaryTimeoutEnv } from "./summary-timeout.mjs";

const MAX_ASSERTION_FAILURE_COUNT = 9999;
const PROOF_FIELDS = [
  "jsonNoStoreRoutes",
  "sessionVaryCookie",
  "boundedJsonRoutes",
  "rateLimitNoStore",
  "routeErrorRedaction",
  "depositsRecoveryGlobalBound",
  "browserBaselineCompactPerformance",
  "authTrustedOriginFailClosed",
  "authReplayNonceBoundary",
  "authCanonicalNonceBoundary",
  "authSessionCookieBoundary",
  "sharedRateLimitRetryAfterBound",
  "externalRateLimitPublicEndpoint",
  "externalRateLimitResponseBound",
  "externalSharedLockCanonical",
  "replicaRateLimitStrictConfig",
  "miningPendingRecoveryScoped",
  "miningReceiptRevertExplicit",
  "walletHashlessNonceRecovery",
  "manualMinePendingAmbiguousSafe",
  "approvalDuplicateSendSafe",
  "autoMinerNonceRecoverySafe",
  "autoMinerRpcReconnectSafe",
  "rewardClaimStateSafe",
  "safetyPoolClaimStateSafe",
  "resolverClaimStateSafe",
];

function nonNegativeSafeIntegerText(value) {
  const text = String(value ?? "").trim();
  if (!/^(?:0|[1-9]\d{0,15})$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function nonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
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

function summarizeFailureHint(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const index = lines.findIndex((candidate) => /\b(?:AssertionError|Error|TypeError|SyntaxError)\b/.test(candidate));
  if (index < 0) return null;
  const compact = lines.slice(index, index + 8).join(" ").replace(/\s+/g, " ").trim();
  return compact.length <= 280 ? compact : `${compact.slice(0, 263)}...<truncated>`;
}

export function parseExecutedBusinessLogicProof(text) {
  const matches = [...String(text ?? "").matchAll(/^Business logic proof: (\{[^\r\n]+\})$/gm)];
  if (matches.length !== 1) return null;
  try {
    const parsed = JSON.parse(matches[0][1]);
    if (!parsed || Array.isArray(parsed) || parsed.version !== 1) return null;
    if (!PROOF_FIELDS.every((field) => parsed[field] === true)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function summarizeBusinessLogicResult(result, { durationMs = 0 } = {}) {
  const output = redactProofText(`${result?.stdout ?? ""}\n${result?.stderr ?? ""}`);
  const timedOut = result?.error?.code === "ETIMEDOUT";
  const outputTooLarge = result?.error?.code === "ENOBUFS";
  const databaseIsolationViolation = result?.businessLogicDbIsolationViolation === true;
  const childExitCode = Number.isSafeInteger(result?.status) ? result.status : null;
  const businessLogic = /\bBusiness logic tests passed\.(?:\s|$)/.test(output);
  const assertionFailures = countAssertionFailures(output);
  const expectedWarnings = nonNegativeSafeIntegerText(output.match(/Suppressed\s+(\d+)\s+expected synthetic warning/)?.[1]) ?? 0;
  const executedProof = parseExecutedBusinessLogicProof(output);
  const proofField = (name) => executedProof?.[name] === true;
  const jsonNoStoreRoutes = proofField("jsonNoStoreRoutes");
  const sessionVaryCookie = proofField("sessionVaryCookie");
  const boundedJsonRoutes = proofField("boundedJsonRoutes");
  const rateLimitNoStore = proofField("rateLimitNoStore");
  const routeErrorRedaction = proofField("routeErrorRedaction");
  const depositsRecoveryGlobalBound = proofField("depositsRecoveryGlobalBound");
  const browserBaselineCompactPerformance = proofField("browserBaselineCompactPerformance");
  const authTrustedOriginFailClosed = proofField("authTrustedOriginFailClosed");
  const authReplayNonceBoundary = proofField("authReplayNonceBoundary");
  const authCanonicalNonceBoundary = proofField("authCanonicalNonceBoundary");
  const authSessionCookieBoundary = proofField("authSessionCookieBoundary");
  const authBoundaryProof = authTrustedOriginFailClosed && authReplayNonceBoundary && authCanonicalNonceBoundary && authSessionCookieBoundary;
  const sharedRateLimitRetryAfterBound = proofField("sharedRateLimitRetryAfterBound");
  const externalRateLimitPublicEndpoint = proofField("externalRateLimitPublicEndpoint");
  const externalRateLimitResponseBound = proofField("externalRateLimitResponseBound");
  const externalSharedLockCanonical = proofField("externalSharedLockCanonical");
  const replicaRateLimitStrictConfig = proofField("replicaRateLimitStrictConfig");
  const replicaRateLimitBoundaryProof = sharedRateLimitRetryAfterBound && externalRateLimitPublicEndpoint && externalRateLimitResponseBound && externalSharedLockCanonical && replicaRateLimitStrictConfig;
  const miningPendingRecoveryScoped = proofField("miningPendingRecoveryScoped");
  const miningReceiptRevertExplicit = proofField("miningReceiptRevertExplicit");
  const walletHashlessNonceRecovery = proofField("walletHashlessNonceRecovery");
  const manualMinePendingAmbiguousSafe = proofField("manualMinePendingAmbiguousSafe");
  const approvalDuplicateSendSafe = proofField("approvalDuplicateSendSafe");
  const autoMinerNonceRecoverySafe = proofField("autoMinerNonceRecoverySafe");
  const autoMinerRpcReconnectSafe = proofField("autoMinerRpcReconnectSafe");
  const walletTxStateMachineProof = miningPendingRecoveryScoped && miningReceiptRevertExplicit && walletHashlessNonceRecovery && manualMinePendingAmbiguousSafe && approvalDuplicateSendSafe && autoMinerNonceRecoverySafe && autoMinerRpcReconnectSafe;
  const rewardClaimStateSafe = proofField("rewardClaimStateSafe");
  const safetyPoolClaimStateSafe = proofField("safetyPoolClaimStateSafe");
  const resolverClaimStateSafe = proofField("resolverClaimStateSafe");
  const walletClaimStateMachineProof = rewardClaimStateSafe && safetyPoolClaimStateSafe && resolverClaimStateSafe;
  const apiBoundaryProof = jsonNoStoreRoutes && sessionVaryCookie && boundedJsonRoutes && rateLimitNoStore && routeErrorRedaction && depositsRecoveryGlobalBound && authBoundaryProof && replicaRateLimitBoundaryProof;
  const localProof = apiBoundaryProof && browserBaselineCompactPerformance && walletTxStateMachineProof && walletClaimStateMachineProof;
  const pass = result?.status === 0 && businessLogic && localProof && assertionFailures === 0 && !timedOut && !outputTooLarge;
  const failureHint = pass ? null : summarizeFailureHint(output);

  return {
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
    expectedWarnings,
    assertionFailures,
    timedOut,
    durationMs: nonNegativeSafeInteger(durationMs),
    childExitCode,
    ...(failureHint ? { failureHint } : {}),
    ...(!localProof ? { issue: "local-proof-summary-missing" } : {}),
    ...(outputTooLarge ? { issue: "business-logic-output-too-large" } : {}),
    ...(
      !databaseIsolationViolation
      && !outputTooLarge
      && result?.error
      && result.error.code !== "ETIMEDOUT"
        ? { issue: "business-logic-spawn-failed" }
        : {}
    ),
    ...(databaseIsolationViolation ? { issue: "business-logic-db-isolation-violation" } : {}),
  };
}

export function runBusinessLogicSummary({
  spawn = spawnSync,
  runIsolatedChild = runIsolatedBusinessLogicChild,
  exists = existsSync,
  cwd = process.cwd(),
  env = process.env,
  execPath = process.execPath,
  now = Date.now,
  writeLine = (line) => console.log(line),
} = {}) {
  const tsxCliPath = resolve(cwd, "node_modules", "tsx", "dist", "cli.mjs");
  if (!exists(tsxCliPath)) throw new Error("test:logic runner unavailable: node_modules/tsx/dist/cli.mjs is missing");
  const timeoutMs = parseSummaryTimeoutEnv("BUSINESS_LOGIC_SUMMARY_TIMEOUT_MS", 600_000);
  const startedAt = now();
  const result = runIsolatedChild({
    processExecPath: execPath,
    args: [tsxCliPath, "scripts/test-business-logic.mjs"],
    cwd,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    timeout: timeoutMs,
    env: {
      ...env,
      NO_UPDATE_NOTIFIER: "1",
      npm_config_update_notifier: "false",
      npm_config_fund: "false",
    },
    spawnSyncFn: spawn,
  });
  const summary = summarizeBusinessLogicResult(result, { durationMs: now() - startedAt });
  writeLine(JSON.stringify(summary));
  if (summary.status === "fail" && process.env.GITHUB_ACTIONS === "true") {
    writeLine(`::error title=Business logic summary::${JSON.stringify(summary)}`);
  }
  return { summary, exitCode: summary.status === "pass" ? 0 : 1 };
}

function isDirectRun() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  try {
    const { exitCode } = runBusinessLogicSummary();
    process.exitCode = exitCode;
  } catch (error) {
    console.log(JSON.stringify({
      status: "fail",
      issue: "business-logic-summary-config-invalid",
      error: redactProofText(error instanceof Error ? error.message : String(error)).slice(0, 300),
    }));
    process.exitCode = 1;
  }
}
