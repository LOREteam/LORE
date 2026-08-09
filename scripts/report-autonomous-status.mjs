import { spawnSync } from "node:child_process";
import { redactProofText } from "./redact-proof-output.mjs";

const npmCommand = process.env.npm_execpath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
const DECIMAL_INTEGER_RE = /^(?:0|[1-9]\d{0,15})$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const timeoutMs = parsePositiveIntegerEnv("AUTONOMOUS_STATUS_TIMEOUT_MS", 180_000, 1_000, 900_000);
const quietNpmEnv = {
  ...process.env,
  NO_UPDATE_NOTIFIER: "1",
  npm_config_update_notifier: "false",
  npm_config_fund: "false",
};

function parsePositiveIntegerEnv(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!DECIMAL_INTEGER_RE.test(raw)) {
    throw new Error(`${name} must be a canonical decimal integer`);
  }
  const parsed = BigInt(raw);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  const numeric = Number(parsed);
  if (numeric < min || numeric > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return numeric;
}

function nonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function nonNegativeSafeIntegerText(value) {
  const text = String(value ?? "").trim();
  if (!DECIMAL_INTEGER_RE.test(text)) return null;
  const parsed = BigInt(text);
  return parsed <= MAX_SAFE_INTEGER_BIGINT ? Number(parsed) : null;
}

function integerField(value) {
  return nonNegativeSafeInteger(value) ?? 0;
}

function optionalIntegerField(value) {
  const parsed = nonNegativeSafeInteger(value);
  return parsed === null ? "none" : String(parsed);
}

function extractJsonObject(text) {
  const source = String(text ?? "");
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (start === -1) {
      if (char === "{") {
        start = index;
        depth = 1;
      }
      continue;
    }
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return "";
}

function parseJsonObject(output) {
  const json = extractJsonObject(output);
  if (!json) throw new Error("missing JSON object");
  return JSON.parse(json);
}

const checks = [
  { id: "remaining", label: "remaining gates", script: "proof:remaining:summary", ok: new Set([0]) },
  { id: "security-followup", label: "security follow-up", script: "proof:security-followup:summary", ok: new Set([0]) },
  { id: "collector-redaction", label: "proof collector redaction", script: "proof:collector-redaction:summary", ok: new Set([0]) },
  { id: "wallet-runtime", label: "wallet runtime logic", script: "test:logic:summary", ok: new Set([0]) },
  { id: "v10-invariants", label: "V10 invariants", script: "test:contract:v10:summary", ok: new Set([0]) },
  { id: "abi-indexer-storage", label: "ABI/indexer storage", script: "test:indexer-storage:summary", ok: new Set([0]) },
  { id: "v10-deployed", label: "V10 deployed identity", script: "proof:contract-deployed:v10:summary", ok: new Set([0, 1]) },
  { id: "signoff", label: "contract / funds sign-off strict", script: "proof:signoff:strict:summary", ok: new Set([0, 1]) },
  { id: "chain", label: "chain reconciliation strict", script: "proof:chain:strict:summary", ok: new Set([0, 1]) },
  { id: "host", label: "production host strict", script: "proof:host:strict:summary", ok: new Set([0, 1]) },
  { id: "soak", label: "testnet soak", script: "soak:testnet:status:compact", ok: new Set([0]) },
  { id: "pending-nonce", label: "pending nonce dry-run", script: "soak:testnet:clear-pending:summary", ok: new Set([0]) },
  { id: "v10-preview", label: "V10 dry-run preview", script: "preview:canary:v10:dry-run:summary", ok: new Set([0, 1]) },
  { id: "v10-authorization-preview", label: "V10 authorization-ready preview", script: "preview:canary:v10:authorization-ready:summary", ok: new Set([0, 1]) },
  { id: "cleanup", label: "workspace cleanup dry-run", script: "cleanup:workspace:dry-run:summary", ok: new Set([0]) },
  { id: "qa", label: "wallet / UX QA strict", script: "proof:qa:strict:summary", ok: new Set([0, 1]) },
  { id: "v10-canary", label: "V10 canary matrix", script: "proof:testnet:canary:v10:summary", ok: new Set([0, 1]) },
  { id: "launch", label: "full launch proof strict", script: "proof:launch:strict:summary", ok: new Set([0, 1]) },
  { id: "runtime-monitor", label: "runtime monitor config", script: "monitor:runtime:summary", ok: new Set([0, 1]) },
  { id: "indexer", label: "indexer strict", script: "proof:indexer:strict:summary", ok: new Set([0, 1]) },
  { id: "restore", label: "restore strict", script: "proof:restore:strict:summary", ok: new Set([0, 1]) },
  { id: "backup", label: "backup strict", script: "db:backup:strict:summary", ok: new Set([0, 1]) },
  { id: "g1", label: "G1 env status", script: "proof:mainnet:strict:compact", ok: new Set([0, 1]) },
];

function clamp(value, max = 260) {
  const text = redactProofText(String(value ?? "")).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function runScript(script) {
  const args = process.env.npm_execpath
    ? [process.env.npm_execpath, "--silent", "run", script]
    : ["--silent", "run", script];
  return spawnSync(npmCommand, args, {
    cwd: process.cwd(),
    env: quietNpmEnv,
    encoding: "utf8",
    maxBuffer: 256 * 1024,
    timeout: timeoutMs,
  });
}

function lineStarting(output, prefix) {
  return output.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith(prefix)) ?? "";
}

function parseCompactKeyValues(output, prefix) {
  const line = lineStarting(output, prefix);
  const values = new Map();
  for (const part of line.split(/\s+/)) {
    const match = part.match(/^([A-Za-z][A-Za-z0-9]*)=(\S{0,160})$/);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

function compactTokenField(values, key, fallback = "unknown", max = 64) {
  const value = values.get(key);
  if (typeof value !== "string" || value.length > max || /0x[a-fA-F0-9]{8,}/.test(value)) return fallback;
  return /^[a-zA-Z0-9_-]+$/.test(value) ? value : fallback;
}

function compactAggregateField(values, key, fallback = "none", max = 96) {
  const value = values.get(key);
  if (typeof value !== "string" || value.length > max || /0x[a-fA-F0-9]{8,}/.test(value)) return fallback;
  return /^[a-zA-Z0-9_.,=:/-]+$/.test(value) ? value : fallback;
}

function compactBooleanField(values, key) {
  return values.get(key) === "true" ? "true" : "false";
}

function compactIntegerField(values, key) {
  const value = values.get(key);
  return nonNegativeSafeIntegerText(value) ?? 0;
}

function compactHealthField(values) {
  const match = String(values.get("health") ?? "").match(/^(\d+)\/(\d+)$/);
  if (!match) return "0/0";
  const healthy = nonNegativeSafeIntegerText(match[1]);
  const total = nonNegativeSafeIntegerText(match[2]);
  return healthy !== null && total !== null && total >= healthy ? `${healthy}/${total}` : "0/0";
}

function summarizeRemaining(output) {
  const complete = lineStarting(output, "Complete gates:");
  const rawGroups = lineStarting(output, "Remaining gate groups:");
  const next = lineStarting(output, "Next gate:");
  const group = lineStarting(output, "Next gate group:");
  const autonomous = lineStarting(output, "Autonomous next:");
  const transactionBoundary = lineStarting(output, "Transaction boundary:");
  const previewChecks = lineStarting(output, "Pre-transaction preview checks:");
  const consentRequirement = lineStarting(output, "Consent requirement:");
  const summary = lineStarting(output, "Summary:");
  const completeMatch = complete.match(/^Complete gates:\s*(\d+)\/(\d+)$/);
  const completeDone = completeMatch ? nonNegativeSafeIntegerText(completeMatch[1]) : null;
  const completeTotal = completeMatch ? nonNegativeSafeIntegerText(completeMatch[2]) : null;
  const completeToken = completeDone !== null && completeTotal !== null && completeTotal >= completeDone
    ? `complete=${completeDone}/${completeTotal}`
    : "";
  const groupTokens = rawGroups
    ? formatGroupSummary(rawGroups.replace(/^Remaining gate groups:\s*/, "")).replace(/^ groups=/, "")
    : "";
  const nextGate = next.match(/^Next gate:\s*(G\d+)\b/)?.[1] ?? "";
  const nextGroup = lineToken(group.replace(/^Next gate group:\s*/, ""), 32);
  const autonomousToken = lineToken(autonomous.replace(/^Autonomous next:\s*/, ""), 80);
  const transactionBoundaryToken = lineToken(transactionBoundary.replace(/^Transaction boundary:\s*/, ""), 64);
  const previewCheckTokens = previewChecks
    ? safeStatusTokenList(previewChecks.replace(/^Pre-transaction preview checks:\s*/, "").split(/\s*\|\s*/).map((entry) => lineToken(entry, 64)))
    : "";
  const consentToken = consentRequirement ? "present" : "";
  const summaryToken = lineToken(summary.replace(/^Summary:\s*/, "").replace(/;\s*groups:.*$/, ""), 96);
  return clamp([
    completeToken,
    groupTokens ? `groups=${groupTokens}` : "",
    nextGate ? `next=${nextGate}` : "",
    nextGroup ? `nextGroup=${nextGroup}` : "",
    autonomousToken ? `autonomous=${autonomousToken}` : "",
    transactionBoundaryToken ? `txBoundary=${transactionBoundaryToken}` : "",
    consentToken ? `consent=${consentToken}` : "",
    previewCheckTokens && previewCheckTokens !== "none" ? `previewChecks=${previewCheckTokens}` : "",
    summaryToken ? `summary=${summaryToken}` : "",
  ].filter(Boolean).join("; "));
}

function summarizeSoak(output) {
  const values = parseCompactKeyValues(output, "status=");
  if (values.size === 0) return "status=unknown";
  return clamp([
    `status=${compactTokenField(values, "status")}`,
    `dry=${compactBooleanField(values, "dry")}`,
    `alive=${compactBooleanField(values, "alive")}`,
    `stop=${compactTokenField(values, "stop", "none")}`,
    `ok=${compactIntegerField(values, "ok")}`,
    `bound=${compactIntegerField(values, "bound")}`,
    `unbound=${compactIntegerField(values, "unbound")}`,
    `fail=${compactIntegerField(values, "fail")}`,
    `roles=${compactAggregateField(values, "roles")}`,
    `epochs=${compactIntegerField(values, "epochs")}`,
    `tx=${compactIntegerField(values, "tx")}`,
    `nonces=${compactIntegerField(values, "nonces")}`,
    `dupTx=${compactIntegerField(values, "dupTx")}`,
    `dupNonce=${compactIntegerField(values, "dupNonce")}`,
    `rev=${compactIntegerField(values, "rev")}`,
    `health=${compactHealthField(values)}`,
    `rpc=${compactIntegerField(values, "rpc")}`,
    `gas=${compactIntegerField(values, "gas")}`,
    `resolver=${compactIntegerField(values, "resolver")}`,
    `slow=${compactIntegerField(values, "slow")}`,
    `p95=${compactAggregateField(values, "p95", "n/a", 32)}`,
    `diskLow=${compactBooleanField(values, "diskLow")}`,
    `diskFree=${compactIntegerField(values, "diskFree")}`,
    `preflight=${compactAggregateField(values, "preflight")}`,
    `fk=${compactAggregateField(values, "fk")}`,
    `ff=${compactAggregateField(values, "ff")}`,
  ].join(" "));
}

function summarizePendingNonce(output) {
  try {
    const parsed = parseJsonObject(output);
    const boundary = parsed.operationalBoundary && typeof parsed.operationalBoundary === "object"
      ? parsed.operationalBoundary
      : {};
    return clamp(
      `role=${safeStatusTokenList([parsed.role])}, mode=${safeStatusTokenList([parsed.mode])}, pendingGap=${integerField(parsed.pendingNonceGap)}, replacementCap=${integerField(parsed.replacementCap)}, wouldSend=${parsed.wouldSendReplacement === true}, dryRunDefault=${boundary.dryRunDefault === true}, signing=${boundary.signingMaterialLoaded === true}, walletClient=${boundary.walletClientCreated === true}, contractWrite=${boundary.contractWriteSubmitted === true}, txSent=${boundary.transactionSent === true}`,
    );
  } catch {
    return "status=fail issue=invalid-pending-nonce-json";
  }
}

function summarizeCleanup(output) {
  try {
    const parsed = parseJsonObject(output);
    const matchedTargets = nonNegativeSafeInteger(parsed.matchedTargets);
    const bytes = nonNegativeSafeInteger(parsed.bytes);
    return `status=${parsed.status === "ok" ? "ok" : "fail"}, mode=${parsed.mode === "dry-run" ? "dry-run" : "other"}, matched=${matchedTargets ?? 0}, bytes=${bytes ?? 0}`;
  } catch {
    return "status=fail, issue=invalid-cleanup-json";
  }
}

function summarizeG1(output) {
  const failing = lineStarting(output, "Failing gates:");
  const rawGroups = lineStarting(output, "Failing gate groups:");
  const rawTokens = lineStarting(output, "Failing gate tokens sample:");
  const failingCount = nonNegativeSafeIntegerText(failing.match(/^Failing gates:\s*(\d+)$/)?.[1]);
  const groupTokens = rawGroups
    ? formatGroupSummary(rawGroups.replace(/^Failing gate groups:\s*/, "")).replace(/^ groups=/, "")
    : "";
  const tokenSample = rawTokens
    ? safeTokenList(rawTokens.replace(/^Failing gate tokens sample:\s*/, "").split(/\s*,\s*/))
    : "";
  const summary = lineStarting(output, "Summary:");
  return clamp([
    failingCount !== null ? `failing=${failingCount}` : "",
    groupTokens ? `groups=${groupTokens}` : "",
    tokenSample ? `tokens=${tokenSample}` : "",
    formatSummaryLine(summary),
  ].filter(Boolean).join("; "));
}

function summarizeV10Canary(output) {
  const profile = lineStarting(output, "Profile:");
  const summary = lineStarting(output, "Summary:");
  const profileToken = lineToken(profile.replace(/^Profile:\s*/, ""), 48);
  return clamp([profileToken ? `profile=${profileToken}` : "", formatSummaryLine(summary)].filter(Boolean).join("; "));
}

function summarizeV10Preview(output) {
  try {
    const parsed = parseJsonObject(output);
    if (parsed.status !== "pass" && parsed.issue) {
      return clamp(
        `status=fail, authFresh=${parsed.authorizationFreshnessRequired === true}, ageMinutes=${integerField(parsed.ageMinutes)}, maxAgeMinutes=${integerField(parsed.maxPreviewAgeMinutes)}, issue=${lineToken(parsed.issue, 96)}`,
      );
    }
    return clamp(
      `status=${parsed.status === "pass" ? "pass" : "fail"}, authFresh=${parsed.authorizationFreshnessRequired === true}, ageMinutes=${integerField(parsed.ageMinutes)}, maxAgeMinutes=${integerField(parsed.maxPreviewAgeMinutes)}, transactionLimit=${integerField(parsed.transactionLimit)}, estimatedGas=${integerField(parsed.estimatedGas)}, plannedBetTx=${integerField(parsed.plannedBetTx)}, log=${parsed.canaryLog ? "present" : "missing"}, logLines=${integerField(parsed.logLines)}, txSent=${parsed.transactionSent === true}, signing=${parsed.signingMaterialLoaded === true}, walletClient=${parsed.walletClientCreated === true}, contractWrite=${parsed.contractWriteSubmitted === true}, dryRunBlocksG10G11=${parsed.dryRunProofBlocksG10G11 === true}${parsed.issue ? ` issue=${lineToken(parsed.issue, 96)}` : ""}`,
    );
  } catch {
    return "status=fail issue=invalid-v10-preview-json";
  }
}

function jsonStatus(value, fallback = "unknown") {
  return safeTokenList([value]) === "none" ? fallback : safeTokenList([value]);
}

function summarizeV10Deployed(output) {
  try {
    const parsed = parseJsonObject(output);
    return clamp(
      `status=${jsonStatus(parsed.status)}, network=${safeTokenList([parsed.network])}, chainId=${integerField(parsed.chainId)}, manifestMatches=${parsed.manifestMatches === true}, runtimeBytes=${integerField(parsed.runtimeBytes)}, expectedRuntimeBytes=${integerField(parsed.expectedRuntimeBytes)}, runtimeBytecode=${parsed.runtimeBytecode === true}, runtimeExecutable=${parsed.runtimeExecutable === true}, metadataOnlyMismatch=${parsed.metadataOnlyMismatch === true}, transactionSent=${parsed.transactionSent === true}, assertionFailures=${integerField(parsed.assertionFailures)}`,
    );
  } catch {
    return "status=fail issue=invalid-v10-deployed-json";
  }
}

function summarizeSecurityFollowup(output) {
  try {
    const parsed = parseJsonObject(output);
    const failedIds = Array.isArray(parsed.failedIds) ? safeTokenList(parsed.failedIds) : "none";
    return clamp(
      `status=${parsed.status === "pass" ? "pass" : "fail"}, checks=${integerField(parsed.checks)}, passed=${integerField(parsed.passed)}, failed=${integerField(parsed.failed)}, failedIds=${failedIds}, hostAuth=${parsed.hostAuth === true}, webLocks=${parsed.webLocks === true}, keeperNonce=${parsed.keeperNonce === true}, keeperBotReceipts=${parsed.keeperBotReceipts === true}, depositLimiter=${parsed.depositLimiter === true}, dryRunDefaults=${parsed.dryRunDefaults === true}, ciSecurity=${parsed.ciSecurity === true}, autoResolve=${parsed.autoResolve === true}, appResolveEpochFiles=${integerField(parsed.appResolveEpochFiles)}`,
    );
  } catch {
    return "status=fail issue=invalid-security-followup-json";
  }
}

function summarizeCollectorRedaction(output) {
  const match = output.match(/status=(pass|fail),\s*cases=(\d+),\s*redacted=(\d+),\s*leaked=(\d+),\s*issues=(\d+)/);
  if (!match) return "status=fail issue=invalid-collector-redaction-summary";
  const [, status, casesRaw, redactedRaw, leakedRaw, issuesRaw] = match;
  const cases = nonNegativeSafeIntegerText(casesRaw);
  const redacted = nonNegativeSafeIntegerText(redactedRaw);
  const leaked = nonNegativeSafeIntegerText(leakedRaw);
  const issues = nonNegativeSafeIntegerText(issuesRaw);
  if (cases === null || redacted === null || leaked === null || issues === null) {
    return "status=fail issue=invalid-collector-redaction-counters";
  }
  return `status=${status}, cases=${cases}, redacted=${redacted}, leaked=${leaked}, issues=${issues}`;
}

function summarizeWalletRuntimeLogic(output) {
  try {
    const parsed = parseJsonObject(output);
    return clamp(
      `status=${parsed.status === "pass" ? "pass" : "fail"}, businessLogic=${parsed.businessLogic === true}, localProof=${parsed.localProof === true}, apiBoundaryProof=${parsed.apiBoundaryProof === true}, walletTxStateMachineProof=${parsed.walletTxStateMachineProof === true}, walletClaimStateMachineProof=${parsed.walletClaimStateMachineProof === true}, authBoundaryProof=${parsed.authBoundaryProof === true}, replicaRateLimitBoundaryProof=${parsed.replicaRateLimitBoundaryProof === true}, browserBaselineCompactPerformance=${parsed.browserBaselineCompactPerformance === true}, jsonNoStoreRoutes=${parsed.jsonNoStoreRoutes === true}, sessionVaryCookie=${parsed.sessionVaryCookie === true}, boundedJsonRoutes=${parsed.boundedJsonRoutes === true}, rateLimitNoStore=${parsed.rateLimitNoStore === true}, routeErrorRedaction=${parsed.routeErrorRedaction === true}, depositsRecoveryGlobalBound=${parsed.depositsRecoveryGlobalBound === true}, miningPendingRecoveryScoped=${parsed.miningPendingRecoveryScoped === true}, miningReceiptRevertExplicit=${parsed.miningReceiptRevertExplicit === true}, walletHashlessNonceRecovery=${parsed.walletHashlessNonceRecovery === true}, manualMinePendingAmbiguousSafe=${parsed.manualMinePendingAmbiguousSafe === true}, approvalDuplicateSendSafe=${parsed.approvalDuplicateSendSafe === true}, autoMinerNonceRecoverySafe=${parsed.autoMinerNonceRecoverySafe === true}, autoMinerRpcReconnectSafe=${parsed.autoMinerRpcReconnectSafe === true}, rewardClaimStateSafe=${parsed.rewardClaimStateSafe === true}, safetyPoolClaimStateSafe=${parsed.safetyPoolClaimStateSafe === true}, resolverClaimStateSafe=${parsed.resolverClaimStateSafe === true}, authTrustedOriginFailClosed=${parsed.authTrustedOriginFailClosed === true}, authReplayNonceBoundary=${parsed.authReplayNonceBoundary === true}, authCanonicalNonceBoundary=${parsed.authCanonicalNonceBoundary === true}, authSessionCookieBoundary=${parsed.authSessionCookieBoundary === true}, sharedRateLimitRetryAfterBound=${parsed.sharedRateLimitRetryAfterBound === true}, externalRateLimitPublicEndpoint=${parsed.externalRateLimitPublicEndpoint === true}, externalRateLimitResponseBound=${parsed.externalRateLimitResponseBound === true}, externalSharedLockCanonical=${parsed.externalSharedLockCanonical === true}, replicaRateLimitStrictConfig=${parsed.replicaRateLimitStrictConfig === true}, expectedWarnings=${integerField(parsed.expectedWarnings)}, assertionFailures=${integerField(parsed.assertionFailures)}, timedOut=${parsed.timedOut === true}, durationMs=${integerField(parsed.durationMs)}, childExitCode=${optionalIntegerField(parsed.childExitCode)}`,
    );
  } catch {
    return "status=fail issue=invalid-wallet-runtime-json";
  }
}

function summarizeV10Invariants(output) {
  try {
    const parsed = parseJsonObject(output);
    return clamp(
      `status=${parsed.status === "pass" ? "pass" : "fail"}, suite=${safeStatusTokenList([parsed.invariantSuite])}, runtimeBytes=${integerField(parsed.runtimeBytes)}, selectors=${integerField(parsed.functionSelectors)}, guarded=${integerField(parsed.guardedLocalMutationEntrypoints)}, accountingCases=${integerField(parsed.fullRangeAccountingCases)}, proportionalCases=${integerField(parsed.fullRangeProportionalCases)}, assertionFailures=${integerField(parsed.assertionFailures)}, protocolFeeFlushCases=${integerField(parsed.protocolFeeFlushModelCases)}, protocolFeeFlushEntrypointCases=${integerField(parsed.protocolFeeFlushEntrypointCases)}, duplicateBatchCases=${integerField(parsed.duplicateBatchModelCases)}, tokenTransferRollbackCases=${integerField(parsed.tokenTransferRollbackCases)}, batchTransferRollbackCases=${integerField(parsed.batchTransferRollbackCases)}, dustTransferRollbackCases=${integerField(parsed.dustTransferRollbackCases)}, timelockBoundaryCases=${integerField(parsed.timelockBoundaryCases)}, dustBoundaryCases=${integerField(parsed.dustBoundaryCases)}, packedBoundaryCases=${integerField(parsed.packedBoundaryCases)}`,
    );
  } catch {
    return "status=fail issue=invalid-v10-invariants-json";
  }
}

function summarizeAbiIndexerStorage(output) {
  try {
    const parsed = parseJsonObject(output);
    return clamp(
      `status=${parsed.status === "pass" ? "pass" : "fail"}, categories=${integerField(parsed.categories)}, financialEventCategories=${safeStatusTokenList(parsed.financialEventCategories)}, depositScopeIsolation=${parsed.depositScopeIsolation === true}, idempotentDepositUpsert=${parsed.idempotentDepositUpsert === true}, resolverRewardScopeIsolation=${parsed.resolverRewardScopeIsolation === true}, idempotentResolverRewardUpsert=${parsed.idempotentResolverRewardUpsert === true}, dustSettlementScopeIsolation=${parsed.dustSettlementScopeIsolation === true}, idempotentDustSettlementUpsert=${parsed.idempotentDustSettlementUpsert === true}, singleRebateClaimParity=${parsed.singleRebateClaimParity === true}, epochScopeIsolation=${parsed.epochScopeIsolation === true}, idempotentEpochUpsert=${parsed.idempotentEpochUpsert === true}, jackpotScopeIsolation=${parsed.jackpotScopeIsolation === true}, idempotentJackpotUpsert=${parsed.idempotentJackpotUpsert === true}, rewardClaimScopeIsolation=${parsed.rewardClaimScopeIsolation === true}, idempotentRewardClaimUpsert=${parsed.idempotentRewardClaimUpsert === true}, batchClaimKindParity=${parsed.batchClaimKindParity === true}, dustSettlementKindParity=${parsed.dustSettlementKindParity === true}, sameBlockEventOrdering=${parsed.sameBlockEventOrdering === true}, staleEventReplayIgnored=${parsed.staleEventReplayIgnored === true}, staleEpochReplayIgnored=${parsed.staleEpochReplayIgnored === true}, staleFinancialReplayIgnored=${parsed.staleFinancialReplayIgnored === true}, normalizedEventIdRequiresTxLog=${parsed.normalizedEventIdRequiresTxLog === true}, partialRpcLogFallback=${parsed.partialRpcLogFallback === true}, malformedPayloadFallback=${parsed.malformedPayloadFallback === true}, boundedEventStorage=${parsed.boundedEventStorage === true}, limitedEventReads=${parsed.limitedEventReads === true}, legacyRead=${parsed.legacyRead === true}, pagination=${parsed.pagination === true}, tileUserCounts=${parsed.tileUserCounts === true}, chainScopeIsolation=${parsed.chainScopeIsolation === true}, scopeIsolation=${parsed.scopeIsolation === true}, categoryIdIsolation=${parsed.categoryIdIsolation === true}, normalizedEventScopeIsolation=${parsed.normalizedEventScopeIsolation === true}, protocolFeeScopeIsolation=${parsed.protocolFeeScopeIsolation === true}, idempotentUpsert=${parsed.idempotentUpsert === true}, idempotentBetUpsert=${parsed.idempotentBetUpsert === true}, idempotentProtocolFeeUpsert=${parsed.idempotentProtocolFeeUpsert === true}, assertionFailures=${integerField(parsed.assertionFailures)}`,
    );
  } catch {
    return "status=fail issue=invalid-abi-indexer-storage-json";
  }
}

function summarizeQa(output) {
  return summarizeManifestSummary(output);
}

function summarizeProofManifest(output) {
  return summarizeManifestSummary(output);
}

function summarizeChain(output) {
  const network = lineStarting(output, "Network:");
  const rpcSource = lineStarting(output, "RPC source:");
  const summary = lineStarting(output, "Summary:");
  const networkToken = lineToken(network.replace(/^Network:\s*/, ""), 32);
  const rpcToken = lineToken(rpcSource.replace(/^RPC source:\s*/, ""), 48);
  return clamp([
    networkToken ? `network=${networkToken}` : "",
    rpcToken ? `rpc=${rpcToken}` : "",
    formatSummaryLine(summary),
  ].filter(Boolean).join("; "));
}

function summarizeLaunch(output) {
  const canaryLog = lineStarting(output, "Canary log:");
  const wouldRun = lineStarting(output, "Would run child checks:");
  const summary = lineStarting(output, "Summary:");
  const canaryToken = lineToken(canaryLog.replace(/^Canary log:\s*/, ""), 32);
  const childChecks = wouldRun.match(/^Would run child checks:\s*(true|false)$/)?.[1] ?? "";
  return clamp([
    canaryToken ? `canaryLog=${canaryToken}` : "",
    childChecks ? `childChecks=${childChecks}` : "",
    formatSummaryLine(summary),
  ].filter(Boolean).join("; "));
}

function summarizeBackup(output) {
  try {
    const parsed = parseJsonObject(output);
    const status = parsed.status === "ok" ? "ok" : "fail";
    const groups = formatGroupSummary(parsed.groups);
    const issue = formatIssueToken(parsed.issue);
    return clamp(`status=${status}${groups}${issue}`);
  } catch {
    return "status=fail issue=invalid-backup-json";
  }
}

function summarizeRestore(output) {
  return summarizeManifestSummary(output);
}

function safeTokenList(value) {
  if (!Array.isArray(value)) return "none";
  const safe = value
    .map((entry) => String(entry ?? "").trim())
    .filter((entry) => /^[a-z0-9-]{1,64}$/.test(entry))
    .slice(0, 8);
  return safe.length > 0 ? safe.join(",") : "none";
}

function safeStatusTokenList(value) {
  if (!Array.isArray(value)) return "none";
  const safe = value
    .map((entry) => String(entry ?? "").trim())
    .filter((entry) => /^[a-zA-Z0-9_-]{1,64}$/.test(entry))
    .slice(0, 8);
  return safe.length > 0 ? safe.join(",") : "none";
}

function formatGroupSummary(value) {
  if (typeof value !== "string" || value.length === 0) return "";
  const groups = value
    .split(/\s*,\s*/)
    .map((entry) => entry.trim())
    .filter((entry) => /^[a-z0-9-]{1,32}=[1-9]\d{0,3}$/.test(entry))
    .slice(0, 16);
  return groups.length > 0 ? ` groups=${groups.join(",")}` : "";
}

function knownIssueToken(value) {
  if (typeof value !== "string" || value.length === 0) return "";
  const text = redactProofText(value).toLowerCase();
  if (
    text.includes("lore_db_path") &&
    text.includes("lore_backup_dir") &&
    text.includes("--source") &&
    text.includes("--out")
  ) {
    return "backup-paths-or-source-output-required";
  }
  if (
    text.includes("strict chain proof requires configured rpc env") &&
    text.includes("built-in fallback")
  ) {
    return "strict-chain-proof-requires-configured-rpc-env";
  }
  return "";
}

function lineToken(value, max = 64) {
  const known = knownIssueToken(value);
  if (known) return known;
  if (typeof value !== "string" || value.length === 0) return "";
  return redactProofText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

function formatIssueToken(value) {
  const token = lineToken(value);
  return token ? ` issue=${token}` : "";
}

function formatSummaryLine(line) {
  if (!line.startsWith("Summary:")) return "";
  const text = redactProofText(line.replace(/^Summary:\s*/, ""));
  const issueCount = nonNegativeSafeIntegerText(text.match(/^(\d+)\s+(?:proof\s+)?issue\(s\)/i)?.[1]);
  const blockedGates = text.match(/(?:^|;)\s*blocked gates:\s*([^;.]+)/i)?.[1] ?? "";
  const groupText = text.match(/(?:^|;)\s*groups:\s*([^;.]+)/i)?.[1] ?? "";
  const issueText = text.match(/(?:proof\s+)?issue\(s\):\s*([^;.]*)/i)?.[1] ?? text;
  const gateTokens = blockedGates
    ? safeStatusTokenList(blockedGates.split(/\s*,\s*/))
    : "";
  const groupTokens = groupText
    ? formatGroupSummary(groupText).replace(/^ groups=/, "")
    : "";
  const issueToken = lineToken(issueText, 96);
  return [
    issueCount !== null ? `issues=${issueCount}` : "",
    gateTokens && gateTokens !== "none" ? `gates=${gateTokens}` : "",
    groupTokens ? `groups=${groupTokens}` : "",
    issueToken ? `issue=${issueToken}` : "",
  ].filter(Boolean).join(" ");
}

function summarizeManifestSummary(output) {
  const manifest = lineStarting(output, "Manifest:");
  const manifestToken = lineToken(manifest.replace(/^Manifest:\s*/, ""), 32);
  const summary = formatSummaryLine(lineStarting(output, "Summary:"));
  return clamp([manifestToken ? `manifest=${manifestToken}` : "", summary].filter(Boolean).join("; "));
}

function summarizeRuntimeMonitor(output) {
  try {
    const parsed = parseJsonObject(output);
    const status = parsed.status === "ok" || parsed.status === "pass" ? "ok" : "fail";
    const missing = safeTokenList(parsed.missingConfig);
    const groups = formatGroupSummary(parsed.groups);
    return clamp(
      `status=${status}${groups} missing=${missing} alerts=${parsed.alertsConfigured === true} resend=${parsed.resendConfigured === true} backup=${parsed.backupConfigured === true} canary=${parsed.canaryLogConfigured === true} audit=${parsed.chainAuditConfigured === true} wouldPoll=${parsed.wouldPoll === true} wouldSendAlerts=${parsed.wouldSendAlerts === true}`,
    );
  } catch {
    return "status=fail issue=invalid-runtime-monitor-json";
  }
}

function summarizeIndexer(output) {
  return summarizeManifestSummary(output);
}

function summarize(check, output) {
  if (check.id === "remaining") return summarizeRemaining(output);
  if (check.id === "security-followup") return summarizeSecurityFollowup(output);
  if (check.id === "collector-redaction") return summarizeCollectorRedaction(output);
  if (check.id === "wallet-runtime") return summarizeWalletRuntimeLogic(output);
  if (check.id === "v10-invariants") return summarizeV10Invariants(output);
  if (check.id === "abi-indexer-storage") return summarizeAbiIndexerStorage(output);
  if (check.id === "signoff" || check.id === "host") return summarizeProofManifest(output);
  if (check.id === "chain") return summarizeChain(output);
  if (check.id === "soak") return summarizeSoak(output);
  if (check.id === "pending-nonce") return summarizePendingNonce(output);
  if (check.id === "v10-preview" || check.id === "v10-authorization-preview") return summarizeV10Preview(output);
  if (check.id === "cleanup") return summarizeCleanup(output);
  if (check.id === "qa") return summarizeQa(output);
  if (check.id === "v10-canary") return summarizeV10Canary(output);
  if (check.id === "v10-deployed") return summarizeV10Deployed(output);
  if (check.id === "launch") return summarizeLaunch(output);
  if (check.id === "runtime-monitor") return summarizeRuntimeMonitor(output);
  if (check.id === "indexer") return summarizeIndexer(output);
  if (check.id === "restore") return summarizeRestore(output);
  if (check.id === "backup") return summarizeBackup(output);
  if (check.id === "g1") return summarizeG1(output);
  return clamp(output);
}

const rows = [];
const failures = [];

for (const check of checks) {
  const result = runScript(check.script);
  const exitCode = typeof result.status === "number" ? result.status : 1;
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const expected = check.ok.has(exitCode);
  if (!expected) failures.push(check.script);
  rows.push([check.label, check.script, String(exitCode), expected ? "ok" : "fail", summarize(check, output).replace(/\|/g, "\\|")]);
}

console.log("# Autonomous Status Summary");
console.log("");
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("Mode: read-only, no transactions, no deploys, no live soak start");
console.log("");
console.log("| Check | Command | Exit | Expected | Summary |");
console.log("| --- | --- | --- | --- | --- |");
for (const row of rows) console.log(`| ${row.join(" | ")} |`);
console.log("");
console.log(
  failures.length > 0
    ? `Summary: ${failures.length} autonomous status command(s) failed unexpectedly: ${failures.join(", ")}.`
    : "Summary: autonomous status commands completed; external launch evidence may still be missing.",
);

if (failures.length > 0) process.exitCode = 1;
