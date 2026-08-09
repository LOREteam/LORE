import { spawnSync } from "node:child_process";
import { redactProofText } from "./redact-proof-output.mjs";
import { parseSummaryTimeoutEnv } from "./summary-timeout.mjs";

const npmCommand = process.env.npm_execpath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
const testArgs = process.env.npm_execpath
  ? [process.env.npm_execpath, "--silent", "run", "test:indexer-storage"]
  : ["--silent", "run", "test:indexer-storage"];
const timeoutMs = parseSummaryTimeoutEnv("INDEXER_STORAGE_SUMMARY_TIMEOUT_MS", 120_000);
const MAX_ASSERTION_FAILURE_COUNT = 9999;

const result = spawnSync(npmCommand, testArgs, {
  cwd: process.cwd(),
  encoding: "utf8",
  maxBuffer: 1024 * 1024,
  timeout: timeoutMs,
  env: {
    ...process.env,
    NO_UPDATE_NOTIFIER: "1",
    npm_config_update_notifier: "false",
    npm_config_fund: "false",
  },
});

function extractJsonObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function nonNegativeInteger(value) {
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

const output = redactProofText(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
const parsed = extractJsonObject(output);
const timedOut = result.error?.code === "ETIMEDOUT";
const outputTooLarge = result.error?.code === "ENOBUFS";
const assertionFailures = countAssertionFailures(output);
const pass = result.status === 0 && parsed?.status === "pass" && assertionFailures === 0 && !timedOut && !outputTooLarge;
const financialEventCategories = Array.isArray(parsed?.financialEventCategories)
  ? parsed.financialEventCategories
      .map((category) => String(category ?? "").trim())
      .filter((category) => /^[a-z_]{1,64}$/.test(category))
      .slice(0, 8)
  : [];

console.log(JSON.stringify({
  status: pass ? "pass" : "fail",
  categories: nonNegativeInteger(parsed?.categories),
  financialEventCategories,
  legacyRead: parsed?.legacyRead === true,
  pagination: parsed?.candidatePagination === true,
  tileUserCounts: parsed?.tileUserCounts === true,
  chainScopeIsolation: parsed?.chainScopeIsolation === true,
  scopeIsolation: parsed?.contractScopeIsolation === true,
  depositScopeIsolation: parsed?.depositScopeIsolation === true,
  categoryIdIsolation: parsed?.categoryIdIsolation === true,
  epochScopeIsolation: parsed?.epochScopeIsolation === true,
  jackpotScopeIsolation: parsed?.jackpotScopeIsolation === true,
  resolverRewardScopeIsolation: parsed?.resolverRewardScopeIsolation === true,
  dustSettlementScopeIsolation: parsed?.dustSettlementScopeIsolation === true,
  normalizedEventScopeIsolation: parsed?.normalizedEventScopeIsolation === true,
  rewardClaimScopeIsolation: parsed?.rewardClaimScopeIsolation === true,
  protocolFeeScopeIsolation: parsed?.protocolFeeScopeIsolation === true,
  idempotentUpsert: parsed?.idempotentEventUpsert === true,
  staleEventReplayIgnored: parsed?.staleEventReplayIgnored === true,
  staleEpochReplayIgnored: parsed?.staleEpochReplayIgnored === true,
  staleFinancialReplayIgnored: parsed?.staleFinancialReplayIgnored === true,
  idempotentBetUpsert: parsed?.idempotentBetUpsert === true,
  idempotentDepositUpsert: parsed?.idempotentDepositUpsert === true,
  idempotentEpochUpsert: parsed?.idempotentEpochUpsert === true,
  idempotentJackpotUpsert: parsed?.idempotentJackpotUpsert === true,
  idempotentResolverRewardUpsert: parsed?.idempotentResolverRewardUpsert === true,
  idempotentDustSettlementUpsert: parsed?.idempotentDustSettlementUpsert === true,
  idempotentRewardClaimUpsert: parsed?.idempotentRewardClaimUpsert === true,
  idempotentProtocolFeeUpsert: parsed?.idempotentProtocolFeeUpsert === true,
  normalizedEventIdRequiresTxLog: parsed?.normalizedEventIdRequiresTxLog === true,
  batchClaimKindParity: parsed?.batchClaimKindParity === true,
  singleRebateClaimParity: parsed?.singleRebateClaimParity === true,
  dustSettlementKindParity: parsed?.dustSettlementKindParity === true,
  partialRpcLogFallback: parsed?.partialRpcLogFallback === true,
  malformedPayloadFallback: parsed?.malformedPayloadFallback === true,
  boundedEventStorage: parsed?.boundedEventStorage === true,
  limitedEventReads: parsed?.limitedEventReads === true,
  sameBlockEventOrdering: parsed?.sameBlockEventOrdering === true,
  assertionFailures,
  timedOut,
  ...(outputTooLarge ? { issue: "indexer-storage-output-too-large" } : {}),
  ...(!outputTooLarge && result.error && result.error.code !== "ETIMEDOUT" ? { issue: "indexer-storage-spawn-failed" } : {}),
}));

if (!pass) {
  process.exitCode = 1;
}
