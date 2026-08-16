import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { redactProofText } from "./redact-proof-output.mjs";
import { parseSummaryTimeoutEnv } from "./summary-timeout.mjs";

const MAX_ASSERTION_FAILURE_COUNT = 9999;

export const INDEXER_STORAGE_REQUIRED_PROOF_FIELDS = Object.freeze([
  ["legacyRead", "legacyRead"],
  ["pagination", "candidatePagination"],
  ["tileUserCounts", "tileUserCounts"],
  ["chainScopeIsolation", "chainScopeIsolation"],
  ["scopeIsolation", "contractScopeIsolation"],
  ["depositScopeIsolation", "depositScopeIsolation"],
  ["categoryIdIsolation", "categoryIdIsolation"],
  ["epochScopeIsolation", "epochScopeIsolation"],
  ["jackpotScopeIsolation", "jackpotScopeIsolation"],
  ["resolverRewardScopeIsolation", "resolverRewardScopeIsolation"],
  ["dustSettlementScopeIsolation", "dustSettlementScopeIsolation"],
  ["normalizedEventScopeIsolation", "normalizedEventScopeIsolation"],
  ["rewardClaimScopeIsolation", "rewardClaimScopeIsolation"],
  ["protocolFeeScopeIsolation", "protocolFeeScopeIsolation"],
  ["idempotentUpsert", "idempotentEventUpsert"],
  ["staleEventReplayIgnored", "staleEventReplayIgnored"],
  ["staleEpochReplayIgnored", "staleEpochReplayIgnored"],
  ["staleFinancialReplayIgnored", "staleFinancialReplayIgnored"],
  ["idempotentBetUpsert", "idempotentBetUpsert"],
  ["idempotentDepositUpsert", "idempotentDepositUpsert"],
  ["idempotentEpochUpsert", "idempotentEpochUpsert"],
  ["idempotentJackpotUpsert", "idempotentJackpotUpsert"],
  ["idempotentResolverRewardUpsert", "idempotentResolverRewardUpsert"],
  ["idempotentDustSettlementUpsert", "idempotentDustSettlementUpsert"],
  ["idempotentRewardClaimUpsert", "idempotentRewardClaimUpsert"],
  ["idempotentProtocolFeeUpsert", "idempotentProtocolFeeUpsert"],
  ["normalizedEventIdRequiresTxLog", "normalizedEventIdRequiresTxLog"],
  ["batchClaimKindParity", "batchClaimKindParity"],
  ["singleRebateClaimParity", "singleRebateClaimParity"],
  ["dustSettlementKindParity", "dustSettlementKindParity"],
  ["partialRpcLogFallback", "partialRpcLogFallback"],
  ["malformedPayloadFallback", "malformedPayloadFallback"],
  ["boundedEventStorage", "boundedEventStorage"],
  ["limitedEventReads", "limitedEventReads"],
  ["sameBlockEventOrdering", "sameBlockEventOrdering"],
]);

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

export function summarizeIndexerStorageResult(result) {
  const output = redactProofText(`${result?.stdout ?? ""}\n${result?.stderr ?? ""}`);
  const parsed = extractJsonObject(output);
  const timedOut = result?.error?.code === "ETIMEDOUT";
  const outputTooLarge = result?.error?.code === "ENOBUFS";
  const assertionFailures = countAssertionFailures(output);
  const financialEventCategories = Array.isArray(parsed?.financialEventCategories)
    ? parsed.financialEventCategories
        .map((category) => String(category ?? "").trim())
        .filter((category) => /^[a-z_]{1,64}$/.test(category))
        .slice(0, 8)
    : [];
  const proofFields = Object.fromEntries(
    INDEXER_STORAGE_REQUIRED_PROOF_FIELDS.map(([summaryField, payloadField]) => [
      summaryField,
      parsed?.[payloadField] === true,
    ]),
  );
  const missingProofs = INDEXER_STORAGE_REQUIRED_PROOF_FIELDS
    .filter(([summaryField]) => proofFields[summaryField] !== true)
    .map(([summaryField]) => summaryField);
  const pass = result?.status === 0 && parsed?.status === "pass" && assertionFailures === 0 &&
    !timedOut && !outputTooLarge && missingProofs.length === 0;

  return {
    status: pass ? "pass" : "fail",
    categories: nonNegativeInteger(parsed?.categories),
    financialEventCategories,
    ...proofFields,
    missingProofs,
    assertionFailures,
    timedOut,
    ...(outputTooLarge ? { issue: "indexer-storage-output-too-large" } : {}),
    ...(!outputTooLarge && result?.error && result.error.code !== "ETIMEDOUT" ? { issue: "indexer-storage-spawn-failed" } : {}),
  };
}

export function runIndexerStorageSummary({
  spawn = spawnSync,
  cwd = process.cwd(),
  env = process.env,
  execPath = process.execPath,
  platform = process.platform,
  writeLine = (line) => console.log(line),
} = {}) {
  const npmExecPath = env.npm_execpath;
  const command = npmExecPath ? execPath : platform === "win32" ? "npm.cmd" : "npm";
  const args = npmExecPath
    ? [npmExecPath, "--silent", "run", "test:indexer-storage"]
    : ["--silent", "run", "test:indexer-storage"];
  const result = spawn(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: parseSummaryTimeoutEnv("INDEXER_STORAGE_SUMMARY_TIMEOUT_MS", 120_000),
    env: {
      ...env,
      NO_UPDATE_NOTIFIER: "1",
      npm_config_update_notifier: "false",
      npm_config_fund: "false",
    },
  });
  const summary = summarizeIndexerStorageResult(result);
  writeLine(JSON.stringify(summary));
  return { summary, exitCode: summary.status === "pass" ? 0 : 1 };
}

function isDirectRun() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  try {
    const { exitCode } = runIndexerStorageSummary();
    process.exitCode = exitCode;
  } catch (error) {
    console.log(JSON.stringify({
      status: "fail",
      issue: "indexer-storage-summary-config-invalid",
      error: redactProofText(error instanceof Error ? error.message : String(error)).slice(0, 300),
    }));
    process.exitCode = 1;
  }
}
