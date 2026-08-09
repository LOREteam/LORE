import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { resolveCanaryProofProfile } from "./canary-proof-profile.mjs";

const JSONL_READ_CHUNK_BYTES = 64 * 1024;
const MAX_CANARY_ARTIFACT_TEXT_BYTES = 256 * 1024;
const MAX_CANARY_PROOF_MANIFEST_BYTES = 512 * 1024;
const optionArgs = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--") && arg.includes("="))
    .map((arg) => {
      const [key, ...rest] = arg.slice(2).split("=");
      return [key, rest.join("=")];
    }),
);
const profile = resolveCanaryProofProfile(optionArgs.get("profile") || process.env.CANARY_PROOF_PROFILE || "launch");
const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const logPath = positionalArgs[0] || process.env.LIVE_CANARY_LOG_PATH || "";
const strict = process.argv.includes("--strict") || process.env.PROOF_STRICT === "1";
const summaryOnly = process.argv.includes("--summary-only");
const canaryLaunchGates = ["G10", "G11"];
const canaryLaunchGateGroups = "canary=2";
const requireEpochBound = process.argv.includes("--require-epoch-bound") || process.env.CANARY_REQUIRE_EPOCH_BOUND === "1";
const requireV10GasMatrix = process.argv.includes("--require-v10-gas-matrix") || process.env.CANARY_REQUIRE_V10_GAS_MATRIX === "1";
const CANONICAL_POSITIVE_INTEGER_RE = /^[1-9]\d{0,15}$/;
const CANONICAL_NON_NEGATIVE_INTEGER_RE = /^(?:0|[1-9]\d{0,15})$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const minEpochs = parsePositiveInteger(process.env.LIVE_CANARY_MIN_EPOCHS, profile.minEpochs ?? 50);
const minAutoMinerEpochs = parsePositiveInteger(
  process.env.LIVE_CANARY_MIN_AUTOMINER_EPOCHS,
  profile.minAutoMinerEpochs ?? minEpochs,
);
const minElapsedMsPerEpoch = parsePositiveInteger(process.env.LIVE_CANARY_MIN_ELAPSED_MS_PER_EPOCH, 45_000);
const manifestPath = optionArgs.get("manifest")?.trim() || process.env.CANARY_PROOF_PATH || profile.manifestPath;
const expectedNetwork = process.env.NEXT_PUBLIC_LINEA_NETWORK?.trim() || process.env.LINEA_NETWORK?.trim() || profile.network;
const expectedContract = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS?.trim() || process.env.KEEPER_CONTRACT_ADDRESS?.trim() || "";
const expectedChainId = process.env.NEXT_PUBLIC_LINEA_CHAIN_ID?.trim() || process.env.LINEA_CHAIN_ID?.trim() || String(profile.chainId);
const requiredCanaryRoles = normalizeRoleList(profile.requiredRoles);
const TEMPLATE_VALUE_RE = /REPLACE_|<REDACTED>|TODO|TBD/i;
const GENERIC_RPC_LABEL_RE = /^(?:configured|default|fallback|mainnet|rpc|redacted|target|unlabeled)(?:[-_ ]?rpc(?:[-_ ]?label)?(?:[-_ ]?required)?)?$/i;
const unsafeDiagnosticKeyPattern = /^(?:error|message|diagnostic|reason|cause|stack|rawError|rawMessage)$/i;
const unsafeDiagnosticTextPattern = /(?:https?:\/\/|\b0x[a-fA-F0-9]{40}\b|\b0x[a-fA-F0-9]{80,}\b)/i;

function launchGateSummary(issueCount) {
  const label = issueCount > 0 ? "blocked" : "covered";
  return `${label} gates: ${canaryLaunchGates.join(", ")}; groups: ${canaryLaunchGateGroups}`;
}
const secretKeyPattern = /(secret|private[_-]?key|mnemonic|webhook|dsn|api[_-]?key|api[_-]?token|auth[_-]?token|access[_-]?token|bearer|session|cookie|password)/i;
const rpcUrlKeyPattern = /^(rpc|rpc[_-]?url|.*rpc.*url)$/i;
const TX_RE = /^0x[a-fA-F0-9]{64}$/;
const ZERO_TX = "0x0000000000000000000000000000000000000000000000000000000000000000";
const BET_MODES = new Set(["single", "bitmap", "sameAmount", "arrays"]);
const V10_GAS_CASES = ["1", "3-contiguous", "3-sparse", "5-contiguous", "5-sparse", "25"];

if (!logPath) {
  if (summaryOnly) {
    printMissingLogSummary("live canary log path is missing");
  } else {
    console.error("Usage: node scripts/analyze-live-canary-proof.mjs <live-canary.jsonl> [--profile=launch|testnet|v10-matrix] [--strict] [--summary-only] [--require-epoch-bound] [--require-v10-gas-matrix] [--manifest=<path>]");
    process.exitCode = 1;
  }
} else if (!isExistingFile(resolve(process.cwd(), logPath))) {
  if (summaryOnly) {
    printMissingLogSummary(existsSync(resolve(process.cwd(), logPath)) ? "live canary log must be a file" : "live canary log is missing");
  } else {
    console.error(`Live canary log is missing or not a file: ${basename(logPath)}`);
    process.exitCode = 1;
  }
} else {
  const events = readJsonl(logPath);
  const bets = events.filter((event) => (
    Number.isInteger(event.round)
    && event.round >= 0
    && BET_MODES.has(event.mode)
  ));
  const okBets = bets.filter((event) => event.ok === true && event.txStatus === "success");
  const failedBets = bets.filter((event) => event.ok !== true || event.txStatus !== "success");
  const epochBoundBets = okBets.filter((event) => event.epochBound === true);
  const unboundBets = okBets.filter((event) => event.epochBound !== true);
  const autoMinerBets = okBets.filter((event) => String(event.role ?? "").toUpperCase().includes("AUTOMINER"));
  const autoMinerEpochs = unique(autoMinerBets.map((event) => positiveIntegerString(event.epoch)).filter(Boolean));
  const resolveEvents = events.filter((event) => event.mode === "resolve");
  const failedResolve = resolveEvents.filter((event) => event.ok !== true || event.txStatus !== "success");
  const epochWaits = events.filter((event) => event.mode === "epoch-wait");
  const preflightEvents = events.filter((event) => event.mode === "preflight");
  const failedPreflight = preflightEvents.filter((event) => event.ok !== true);
  const betEpochs = unique(okBets.map((event) => positiveIntegerString(event.epoch)).filter(Boolean));
  const duplicateRoleEpochKeys = findDuplicateRoleEpochKeys(okBets);
  const duplicateKeys = findDuplicateBetKeys(okBets);
  const missingSuccessfulTxHashes = okBets.filter((event) => !isRealTx(eventTxHash(event)));
  const duplicateSuccessfulTxHashes = findDuplicateTxHashes(okBets);
  const duplicateNonceKeys = findDuplicateNonceKeys(okBets);
  const malformedBetTimestampEvidence = okBets.filter((event) => !hasIsoTimestamp(event.timestamp));
  const malformedBetEpochEvidence = okBets.filter((event) => !isPositiveInteger(event.epoch));
  const malformedNonceEvidence = okBets.filter((event) => !hasCanonicalNonceEvidence(event));
  const nonceGaps = okBets.filter((event) => hasCanonicalNonceEvidence(event) && nonceValue(event.noncePending) > nonceValue(event.nonceLatest));
  const malformedTxMetricEvidence = okBets.filter(hasMalformedSuccessfulTxMetricEvidence);
  const durationStats = stats(okBets.map((event) => nonNegativeValue(event.durationMs)));
  const gasStats = stats(okBets.map((event) => nonNegativeValue(event.gasUsed)));
  const malformedBetTileEvidence = okBets.filter((event) => parseBetTiles(event.tiles).length === 0);
  const malformedSuccessfulRoleEvidence = okBets.filter((event) => !normalizeRole(event.role));
  const malformedV10GasMatrixEvidence = okBets.filter(hasMalformedV10GasMatrixEvidence);
  const gasMatrix = summarizeV10GasMatrix(okBets);
  const missingV10GasCases = V10_GAS_CASES.filter((key) => !gasMatrix.has(key));
  const healthSamples = events.filter((event) => event.mode === "diagnostic" && event.sampleKind === "health" && event.ok === true);
  const healthFailures = events.filter((event) => event.mode === "diagnostic" && event.sampleKind === "health" && event.ok !== true);
  const healthDiagnosticsEnabled = healthSamples.length + healthFailures.length > 0;
  const rssTrend = trend(healthSamples, "rssBytes");
  const heapTrend = trend(healthSamples, "heapUsedBytes");
  const dbTrend = trend(healthSamples, "dbBytes");
  const walTrend = trend(healthSamples, "walBytes");
  const elapsedMs = elapsedRunMs(okBets);
  const minElapsedMs = Math.max(0, (Math.min(betEpochs.length, minEpochs) - 1) * minElapsedMsPerEpoch);
  const byRole = countBy(okBets, "role");
  const successfulRoles = normalizeRoleList(okBets.map((event) => event.role));
  const missingRequiredCanaryRoles = requiredCanaryRoles.filter((role) => !successfulRoles.includes(role));
  const unexpectedSuccessfulCanaryRoles = requiredCanaryRoles.length > 0
    ? successfulRoles.filter((role) => !requiredCanaryRoles.includes(role))
    : [];
  const byMode = countBy(okBets, "mode");
  const byErrorKind = countBy(failedBets, "errorKind");
  const manifestIssues = [];
  const manifestSummary = manifestPath ? loadAndValidateManifest(manifestPath, manifestIssues) : null;
  const targetNetwork = manifestSummary?.targetNetwork ?? {};
  const targetNetworkName = targetNetwork.network || expectedNetwork;
  const targetChainId = targetNetwork.chainId || expectedChainId;
  const targetContractAddress = targetNetwork.contractAddress || expectedContract;
  const targetEventMismatches = findTargetEventMismatches(
    events.filter((event) => event.ok === true && event.mode !== "epoch-wait"),
    targetNetworkName,
    targetChainId,
    targetContractAddress,
    targetNetwork.rpc,
  );
  const liveLogTemplateFindings = findTemplateLikeValues(events);
  const liveLogSecretFindings = findSecretLikeValues(events);
  const liveLogUnsafeErrorFindings = findUnsafeErrorText(events);

  const strictFailures = [];
  if (betEpochs.length < minEpochs) strictFailures.push(`unique bet epochs ${betEpochs.length} < ${minEpochs}`);
  if (autoMinerEpochs.length < minAutoMinerEpochs) {
    strictFailures.push(`successful auto-miner unique epochs ${autoMinerEpochs.length} < ${minAutoMinerEpochs}`);
  }
  if (elapsedMs != null && elapsedMs < minElapsedMs) strictFailures.push(`elapsed canary time ${elapsedMs}ms < ${minElapsedMs}ms`);
  if (elapsedMs == null && okBets.length > 0) strictFailures.push("canary event timestamps are missing or invalid");
  if (failedBets.length > 0) strictFailures.push(`failed bets ${failedBets.length}`);
  if (requireEpochBound && unboundBets.length > 0) strictFailures.push(`successful epoch-unbound bets ${unboundBets.length}`);
  if (requireV10GasMatrix && malformedV10GasMatrixEvidence.length > 0) {
    strictFailures.push(`malformed V10 gas matrix evidence ${malformedV10GasMatrixEvidence.length}`);
  }
  if (requireV10GasMatrix && missingV10GasCases.length > 0) {
    strictFailures.push(`missing V10 gas cases ${missingV10GasCases.join(",")}`);
  }
  if (autoMinerBets.length === 0) strictFailures.push("successful auto-miner canary bets are missing");
  if (missingRequiredCanaryRoles.length > 0) {
    strictFailures.push(`successful required canary roles missing: ${missingRequiredCanaryRoles.join(",")}`);
  }
  if (unexpectedSuccessfulCanaryRoles.length > 0) {
    strictFailures.push(`unexpected successful canary roles: ${unexpectedSuccessfulCanaryRoles.join(",")}`);
  }
  if (missingSuccessfulTxHashes.length > 0) strictFailures.push(`successful bet tx hashes missing or invalid ${missingSuccessfulTxHashes.length}`);
  if (duplicateSuccessfulTxHashes.length > 0) strictFailures.push(`duplicate successful tx hashes ${duplicateSuccessfulTxHashes.length}`);
  if (duplicateNonceKeys.length > 0) strictFailures.push(`duplicate successful nonce keys ${duplicateNonceKeys.length}`);
  if (malformedBetTimestampEvidence.length > 0) strictFailures.push(`malformed bet timestamp evidence ${malformedBetTimestampEvidence.length}`);
  if (malformedBetEpochEvidence.length > 0) strictFailures.push(`malformed bet epoch evidence ${malformedBetEpochEvidence.length}`);
  if (malformedNonceEvidence.length > 0) strictFailures.push(`malformed nonce evidence ${malformedNonceEvidence.length}`);
  if (nonceGaps.length > 0) strictFailures.push(`nonce gaps ${nonceGaps.length}`);
  if (malformedBetTileEvidence.length > 0) strictFailures.push(`malformed bet tile evidence ${malformedBetTileEvidence.length}`);
  if (malformedSuccessfulRoleEvidence.length > 0) strictFailures.push(`malformed successful role evidence ${malformedSuccessfulRoleEvidence.length}`);
  if (malformedTxMetricEvidence.length > 0) strictFailures.push(`malformed successful tx metric evidence ${malformedTxMetricEvidence.length}`);
  if (duplicateRoleEpochKeys.length > 0) strictFailures.push(`duplicate successful role/epoch keys ${duplicateRoleEpochKeys.length}`);
  if (duplicateKeys.length > 0) strictFailures.push(`duplicate role/epoch/tile keys ${duplicateKeys.length}`);
  if (failedPreflight.length > 0) strictFailures.push(`failed preflight checks ${failedPreflight.length}`);
  if (failedResolve.length > 0) strictFailures.push(`failed resolve tx ${failedResolve.length}`);
  if (healthDiagnosticsEnabled && healthSamples.length < 2) strictFailures.push(`successful health samples ${healthSamples.length} < 2`);
  if (healthFailures.length > 0) strictFailures.push(`failed health samples ${healthFailures.length}`);
  if (targetEventMismatches.length > 0) strictFailures.push(`target metadata mismatches ${targetEventMismatches.length}`);
  if (liveLogTemplateFindings.length > 0) strictFailures.push(`live canary log contains template-like values at ${liveLogTemplateFindings.slice(0, 5).join(", ")}`);
  if (liveLogSecretFindings.length > 0) strictFailures.push(`live canary log contains secret-like values at ${liveLogSecretFindings.slice(0, 5).join(", ")}`);
  if (liveLogUnsafeErrorFindings.length > 0) strictFailures.push(`live canary log contains unsafe error text at ${liveLogUnsafeErrorFindings.slice(0, 5).join(", ")}`);
  if (manifestSummary) {
    const manifestAutoMinerRounds = positiveIntegerValue(manifestSummary.autoMinerSession.rounds);
    const manifestAutoMinerUniqueEpochs = positiveIntegerValue(manifestSummary.autoMinerSession.uniqueEpochs);
    const manifestTxHashes = txHashList(manifestSummary.transactionHealth.txHashes);
    const observedSuccessfulTxHashes = new Set(txHashList(okBets.map(eventTxHash)));
    const observedAutoMinerTxHashes = new Set(txHashList(autoMinerBets.map(eventTxHash)));
    if (manifestAutoMinerRounds != null && manifestAutoMinerRounds !== autoMinerBets.length) {
      strictFailures.push(`autoMinerSession.rounds ${manifestAutoMinerRounds} != observed ${autoMinerBets.length}`);
    }
    if (manifestAutoMinerUniqueEpochs != null && manifestAutoMinerUniqueEpochs !== autoMinerEpochs.length) {
      strictFailures.push(`autoMinerSession.uniqueEpochs ${manifestAutoMinerUniqueEpochs} != observed ${autoMinerEpochs.length}`);
    }
    const missingManifestTxHashes = manifestTxHashes.filter((hash) => !observedSuccessfulTxHashes.has(hash));
    if (missingManifestTxHashes.length > 0) {
      strictFailures.push(`transactionHealth.txHashes not found in successful canary tx: ${missingManifestTxHashes.slice(0, 3).join(", ")}`);
    }
    if (!manifestTxHashes.some((hash) => observedAutoMinerTxHashes.has(hash))) {
      strictFailures.push("transactionHealth.txHashes must include at least one successful auto-miner tx hash");
    }
  }
  if (
    strict &&
    profile.manifestRequired !== false &&
    (!manifestPath || !isExistingFile(resolve(process.cwd(), manifestPath)))
  ) strictFailures.push("canary proof manifest is missing");
  strictFailures.push(...manifestIssues);

  console.log("# Live Canary Proof Summary");
  console.log("");
  console.log(`Log: ${basename(logPath)}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Strict: ${strict ? "yes" : "no"}`);
  console.log(`Require epoch-bound bets: ${requireEpochBound ? "yes" : "no"}`);
  console.log(`Require V10 gas matrix: ${requireV10GasMatrix ? "yes" : "no"}`);
  console.log(`Profile: ${profile.key} (${profile.label})`);
  console.log(`Minimum epochs: ${minEpochs}`);
  console.log(`Minimum auto-miner epochs: ${minAutoMinerEpochs}`);
  console.log(`Minimum elapsed ms per epoch: ${minElapsedMsPerEpoch}`);
  console.log(`Manifest: ${summaryOnly ? manifestSummaryStatus() : (manifestPath ? resolve(process.cwd(), manifestPath) : "not required")}`);
  console.log("");
  console.log("| Metric | Value |");
  console.log("| --- | --- |");
  console.log(`| bet tx | ${bets.length} |`);
  console.log(`| successful bet tx | ${okBets.length} |`);
  console.log(`| epoch-bound successful bet tx | ${epochBoundBets.length} / ${okBets.length} |`);
  console.log(`| successful auto-miner bet tx | ${autoMinerBets.length} |`);
  console.log(`| successful auto-miner unique epochs | ${autoMinerEpochs.length} |`);
  console.log(`| failed bet tx | ${failedBets.length} |`);
  console.log(`| unique bet epochs | ${betEpochs.length} |`);
  console.log(`| first / last epoch | ${betEpochs[0] ?? "n/a"} / ${betEpochs.at(-1) ?? "n/a"} |`);
  console.log(`| elapsed canary ms | ${elapsedMs ?? "n/a"} |`);
  console.log(`| resolve tx | ${resolveEvents.length} |`);
  console.log(`| failed resolve tx | ${failedResolve.length} |`);
  console.log(`| epoch waits | ${epochWaits.length} |`);
  console.log(`| preflight checks / failures | ${preflightEvents.length} / ${failedPreflight.length} |`);
  console.log(`| malformed nonce evidence | ${malformedNonceEvidence.length} |`);
  console.log(`| nonce gaps | ${nonceGaps.length} |`);
  console.log(`| malformed bet tile evidence | ${malformedBetTileEvidence.length} |`);
  console.log(`| malformed successful role evidence | ${malformedSuccessfulRoleEvidence.length} |`);
  console.log(`| malformed bet timestamp evidence | ${malformedBetTimestampEvidence.length} |`);
  console.log(`| malformed bet epoch evidence | ${malformedBetEpochEvidence.length} |`);
  console.log(`| malformed successful tx metric evidence | ${malformedTxMetricEvidence.length} |`);
  console.log(`| missing successful tx hashes | ${missingSuccessfulTxHashes.length} |`);
  console.log(`| duplicate successful tx hashes | ${duplicateSuccessfulTxHashes.length} |`);
  console.log(`| duplicate successful nonce keys | ${duplicateNonceKeys.length} |`);
  console.log(`| duplicate successful role/epoch keys | ${duplicateRoleEpochKeys.length} |`);
  console.log(`| duplicate role/epoch/tile keys | ${duplicateKeys.length} |`);
  console.log(`| duration ms p50 / p95 / max | ${durationStats.p50} / ${durationStats.p95} / ${durationStats.max} |`);
  console.log(`| gas p50 / p95 / max | ${gasStats.p50} / ${gasStats.p95} / ${gasStats.max} |`);
  console.log(`| malformed V10 gas matrix evidence | ${malformedV10GasMatrixEvidence.length} |`);
  console.log(`| health samples / failures | ${healthSamples.length} / ${healthFailures.length} |`);
  console.log(`| RSS bytes first / max / delta | ${formatTrend(rssTrend)} |`);
  console.log(`| heap bytes first / max / delta | ${formatTrend(heapTrend)} |`);
  console.log(`| DB bytes first / max / delta | ${formatTrend(dbTrend)} |`);
  console.log(`| WAL bytes first / max / delta | ${formatTrend(walTrend)} |`);
  console.log(`| roles | ${formatCounts(byRole)} |`);
  console.log(`| required roles covered | ${requiredCanaryRoles.length === 0 ? "n/a" : `${requiredCanaryRoles.length - missingRequiredCanaryRoles.length} / ${requiredCanaryRoles.length}`} |`);
  console.log(`| modes | ${formatCounts(byMode)} |`);
  console.log(`| bet error kinds | ${formatCounts(byErrorKind) || "none"} |`);
  console.log("");

  if (gasMatrix.size > 0 && !summaryOnly) {
    console.log("## V10 Mined Gas Matrix");
    console.log("| Case | Transactions | Gas p50 | Gas p95 | Gas max |");
    console.log("| --- | ---: | ---: | ---: | ---: |");
    for (const key of V10_GAS_CASES) {
      const row = gasMatrix.get(key);
      if (!row) continue;
      console.log(`| ${key} | ${row.count} | ${row.gas.p50} | ${row.gas.p95} | ${row.gas.max} |`);
    }
    console.log("");
  }

  if (manifestSummary) {
    console.log("## Canary Manifest");
    console.log("| Section | Status |");
    console.log("| --- | --- |");
    console.log(`| targetNetwork | ${manifestSummary.targetNetworkOk ? "checked" : "issue"} |`);
    console.log(`| recovery | ${manifestSummary.recoveryOk ? "checked" : "issue"} |`);
    console.log(`| autoMinerSession | ${manifestSummary.autoMinerSessionOk ? "checked" : "issue"} |`);
    console.log(`| transactionHealth | ${manifestSummary.transactionHealthOk ? "checked" : "issue"} |`);
    console.log("");
  }

  if (failedResolve.length > 0 && !summaryOnly) {
    console.log("Failed resolve samples:");
    for (const event of failedResolve.slice(0, 5)) {
      console.log(`- epoch=${event.epoch} status=${event.txStatus ?? "unknown"} hash=${event.hash ?? "n/a"}`);
    }
    console.log("");
  }

  if (failedPreflight.length > 0 && !summaryOnly) {
    console.log("Failed preflight samples:");
    for (const event of failedPreflight.slice(0, 5)) {
      console.log(`- role=${safeCountKey(event.role)} reason=${safeCountKey(event.errorKind ?? "unknown")}`);
    }
    console.log("");
  }

  if (duplicateSuccessfulTxHashes.length > 0 && !summaryOnly) {
    console.log("Duplicate tx hash samples:");
    for (const hash of duplicateSuccessfulTxHashes.slice(0, 5)) console.log(`- ${hash}`);
    console.log("");
  }

  if (duplicateNonceKeys.length > 0 && !summaryOnly) {
    console.log("Duplicate nonce key samples:");
    for (const key of duplicateNonceKeys.slice(0, 5)) console.log(`- ${key}`);
    console.log("");
  }

  if (duplicateRoleEpochKeys.length > 0 && !summaryOnly) {
    console.log("Duplicate role/epoch key samples:");
    for (const key of duplicateRoleEpochKeys.slice(0, 5)) console.log(`- ${key}`);
    console.log("");
  }

  if (duplicateKeys.length > 0 && !summaryOnly) {
    console.log("Duplicate bet key samples:");
    for (const key of duplicateKeys.slice(0, 5)) console.log(`- ${key}`);
    console.log("");
  }

  if (targetEventMismatches.length > 0 && !summaryOnly) {
    console.log("Target metadata mismatch samples:");
    for (const mismatch of targetEventMismatches.slice(0, 5)) console.log(`- ${mismatch}`);
    console.log("");
  }

  console.log(
    strictFailures.length === 0
      ? `Summary: live canary proof checks passed; ${launchGateSummary(strictFailures.length)}.`
      : `Summary: ${strictFailures.length} proof issue(s): ${strictFailures.join("; ")}; ${launchGateSummary(strictFailures.length)}.`,
  );

  if (strict && strictFailures.length > 0) process.exitCode = 1;
}

function printMissingLogSummary(reason) {
  console.log("# Live Canary Proof Summary");
  console.log("");
  console.log("Log: missing");
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Strict: ${strict ? "yes" : "no"}`);
  console.log(`Profile: ${profile.key} (${profile.label})`);
  console.log(`Manifest: ${summaryOnly ? manifestSummaryStatus() : (manifestPath ? resolve(process.cwd(), manifestPath) : "not required")}`);
  console.log("");
  console.log(`Summary: 1 proof issue(s): ${reason}; ${launchGateSummary(1)}.`);
  if (strict) process.exitCode = 1;
}

function readJsonl(path) {
  const events = [];
  const fd = openSync(path, "r");
  const buffer = Buffer.alloc(JSONL_READ_CHUNK_BYTES);
  let pending = "";
  let lineNumber = 0;
  const parseLine = (line) => {
    lineNumber += 1;
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line.replace(/^\uFEFF/, ""));
      if (!isPlainObject(event)) {
        failInvalidJsonl(path, lineNumber, "record must be an object");
      }
      events.push(event);
    } catch (error) {
      failInvalidJsonl(path, lineNumber, error instanceof Error ? error.message : String(error), "parse error");
    }
  };

  try {
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      pending += buffer.toString("utf8", 0, bytesRead);
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) parseLine(line);
    }
    if (pending) parseLine(pending);
  } finally {
    closeSync(fd);
  }
  return events;
}

function regularFileStat(filePath) {
  try {
    const stats = statSync(filePath);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
}

function isExistingFile(filePath) {
  return regularFileStat(filePath) !== null;
}

function manifestSummaryStatus() {
  if (!manifestPath) return "not required";
  return isExistingFile(resolve(process.cwd(), manifestPath)) ? "present" : "missing";
}

function failInvalidJsonl(path, lineNumber, detail, summaryDetail = detail) {
  if (summaryOnly) {
    printMissingLogSummary(`live canary log contains invalid JSONL at line ${lineNumber}: ${summaryDetail}`);
  } else {
    console.error(`Invalid JSONL at ${basename(path)}:${lineNumber}: ${detail}`);
  }
  process.exit(1);
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasRealText(value) {
  return hasText(value) && !TEMPLATE_VALUE_RE.test(value);
}

function statusOk(value) {
  return ["ok", "pass", "passed", "verified", "success", "green"].includes(String(value ?? "").trim().toLowerCase());
}

function hasIsoTimestamp(value) {
  if (!hasRealText(value)) return false;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text)) return false;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return false;
  const normalized = text.includes(".") ? text : text.replace("Z", ".000Z");
  return parsed.toISOString() === normalized;
}

function isoTimestampMs(value) {
  return hasIsoTimestamp(value) ? new Date(String(value).trim()).getTime() : Number.NaN;
}

function hasNonFutureIsoTimestamp(value) {
  const timestampMs = isoTimestampMs(value);
  return Number.isFinite(timestampMs) && timestampMs <= Date.now() + 5 * 60 * 1000;
}

function isRealTx(value) {
  const normalized = String(value ?? "").trim();
  return TX_RE.test(normalized) && normalized.toLowerCase() !== ZERO_TX;
}

function txHashList(value) {
  return validTxHashEntries(value).map((entry) => entry.value);
}

function validTxHashEntries(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((entry, index) => ({ index, value: String(entry ?? "").trim().toLowerCase() }))
    .filter((entry) => isRealTx(entry.value));
}

function malformedTxHashEntries(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((entry, index) => ({ index, value: String(entry ?? "").trim() }))
    .filter((entry) => entry.value.length === 0 || !isRealTx(entry.value));
}

function duplicateTxHashEntries(value) {
  const seen = new Set();
  const duplicates = [];
  for (const entry of validTxHashEntries(value)) {
    if (seen.has(entry.value)) duplicates.push(entry);
    seen.add(entry.value);
  }
  return duplicates;
}

function eventTxHash(event) {
  return event?.txHash ?? event?.hash ?? "";
}

function normalizeNetwork(value) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "-");
  if (["main", "linea", "prod", "production", "linea-mainnet"].includes(normalized)) return "mainnet";
  if (["testnet", "linea-sepolia", "sepolia-testnet"].includes(normalized)) return "sepolia";
  return normalized;
}

function normalizeAddress(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeRole(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9_]{1,32}$/.test(normalized) ? normalized : "";
}

function normalizeRoleList(value) {
  return [...new Set(normalizedRoleEntries(value).map((entry) => entry.value))].sort();
}

function normalizedRoleEntries(value) {
  const entries = Array.isArray(value) ? value : String(value ?? "").split(",");
  return entries
    .map((entry, index) => ({ index, value: normalizeRole(entry) }))
    .filter((entry) => entry.value);
}

function duplicateRoleEntries(value) {
  const seen = new Set();
  const duplicates = [];
  for (const entry of normalizedRoleEntries(value)) {
    if (seen.has(entry.value)) duplicates.push(entry);
    seen.add(entry.value);
  }
  return duplicates;
}

function looksLikeUrl(value) {
  try {
    new URL(String(value ?? "").trim());
    return true;
  } catch {
    return false;
  }
}

function hasConcreteRpcLabel(value) {
  const normalized = String(value ?? "").trim();
  return hasRealText(normalized) && !looksLikeUrl(normalized) && !GENERIC_RPC_LABEL_RE.test(normalized);
}

function hasPublicHttpsUrl(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/https?:\/\/[^\s),.;]+/i);
  if (!match) return false;
  try {
    const url = new URL(match[0]);
    const host = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (host.includes(".") || host.includes(":")) &&
      !(
        host === "localhost" ||
        host === "0.0.0.0" ||
        host === "::" ||
        host === "::1" ||
        host === "127.0.0.1" ||
        host.endsWith(".localhost") ||
        host.endsWith(".local") ||
        host.endsWith(".example") ||
        host.endsWith(".test") ||
        host.endsWith(".invalid") ||
        /^127\./.test(host) ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
      );
  } catch {
    return false;
  }
}

function hasConcreteText(value) {
  if (Array.isArray(value)) return value.some(hasConcreteText);
  if (isRealTx(value)) return true;
  if (!hasRealText(value)) return false;
  const text = String(value).trim();
  return hasPublicHttpsUrl(text) ||
    /(?:^|[\\/\s])[^\s]+\.(?:json|jsonl|log|md|txt|csv|png|jpg|jpeg|webp)(?:\b|$)/i.test(text) ||
    /\bnpm(?:\.cmd)?\s+run\s+(?:proof:canary|smoke:browser|live:monitor|proof:[a-z0-9:-]+)\b/i.test(text) ||
    /\bproof:[a-z0-9:-]+\b/i.test(text);
}

function hasEvidence(value) {
  if (!isPlainObject(value)) return false;
  return [
    value.evidence,
    value.evidencePath,
    value.link,
    value.command,
    value.txHash,
    value.txHashes,
    value.summary,
    value.artifact,
    value.notes,
  ].some(hasConcreteText);
}

function localArtifactPathFromText(value, key = "") {
  if (!hasRealText(value)) return "";
  const text = String(value).trim().replace(/^`|`$/g, "");
  if (/^https?:\/\//i.test(text)) return "";
  const artifactMatch = text.match(/^artifact:\s*(\S+)/i);
  const candidate = (artifactMatch ? artifactMatch[1] : text).trim().replace(/^`|`$/g, "").replace(/[),.;]+$/g, "");
  if (/^https?:\/\//i.test(candidate)) return "";
  const keySuggestsPath = /(?:evidencePath|artifact|link)$/i.test(key);
  const valueLooksLikePath = /(?:^|[\\/\s])[^\s]+\.(?:json|jsonl|log|md|txt|csv|png|jpg|jpeg|webp)(?:\b|$)/i.test(candidate);
  return (artifactMatch || keySuggestsPath) && valueLooksLikePath ? candidate : "";
}

function findMissingLocalArtifactRefs(value, path = "$", key = "") {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findings.push(...findMissingLocalArtifactRefs(entry, `${path}[${index}]`, key)));
    return findings;
  }
  if (typeof value === "string") {
    const artifactPath = localArtifactPathFromText(value, key);
    if (artifactPath) {
      const resolvedArtifact = resolve(process.cwd(), artifactPath);
      if (!regularFileStat(resolvedArtifact)) {
        findings.push(`${path} -> ${artifactPath}`);
      }
    }
    return findings;
  }
  if (!isPlainObject(value)) return findings;
  for (const [childKey, entry] of Object.entries(value)) {
    findings.push(...findMissingLocalArtifactRefs(entry, `${path}.${childKey}`, childKey));
  }
  return findings;
}

function normalizedArtifactPathSet(value, key = "") {
  if (typeof value === "string") {
    const artifactPath = localArtifactPathFromText(value, key);
    return artifactPath ? new Set([resolve(process.cwd(), artifactPath).replace(/[\\/]+/g, "/").toLowerCase()]) : new Set();
  }
  if (Array.isArray(value)) {
    const paths = new Set();
    for (const entry of value) {
      for (const artifactPath of normalizedArtifactPathSet(entry, key)) paths.add(artifactPath);
    }
    return paths;
  }
  if (!isPlainObject(value)) return new Set();
  const paths = new Set();
  for (const [childKey, entry] of Object.entries(value)) {
    for (const artifactPath of normalizedArtifactPathSet(entry, childKey)) paths.add(artifactPath);
  }
  return paths;
}

function localArtifactPaths(value) {
  if (!isPlainObject(value)) return [];
  return [
    ["evidence", value.evidence],
    ["evidencePath", value.evidencePath],
    ["link", value.link],
    ["command", value.command],
    ["summary", value.summary],
    ["artifact", value.artifact],
    ["notes", value.notes],
  ].map(([key, entry]) => localArtifactPathFromText(entry, key)).filter(Boolean);
}

function readBoundedArtifactText(resolved) {
  const fd = openSync(resolved, "r");
  try {
    const buffer = Buffer.alloc(MAX_CANARY_ARTIFACT_TEXT_BYTES);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function artifactBackedEvidenceText(value) {
  const chunks = [];
  if (isPlainObject(value)) {
    chunks.push([
      value.evidence,
      value.evidencePath,
      value.link,
      value.command,
      value.summary,
      value.artifact,
      value.notes,
    ].filter(hasRealText).join("\n"));
  }
  for (const artifactPath of localArtifactPaths(value)) {
    const resolved = resolve(process.cwd(), artifactPath);
    if (!regularFileStat(resolved)) continue;
    chunks.push(readBoundedArtifactText(resolved));
  }
  return chunks.join("\n");
}

function hasTargetNetworkProof(value) {
  return new RegExp(`\\b(?:target|rpc|chain|${profile.evidenceTerms})\\b`, "i").test(artifactBackedEvidenceText(value));
}

function hasRecoveryProof(value) {
  return /\b(?:recovery|reload|reconnect|tab[-\s]?close|pending[-\s]?tx|remount)\b/i.test(artifactBackedEvidenceText(value));
}

function hasAutoMinerSessionProof(value) {
  return /\b(?:auto[-\s]?miner|autominer|session|round|epoch|target[-\s]?rpc)\b/i.test(artifactBackedEvidenceText(value));
}

function hasTransactionHealthProof(value) {
  return /\b(?:transaction|tx|nonce|duplicate|stuck[-\s]?pending|pending[-\s]?recovery)\b/i.test(artifactBackedEvidenceText(value));
}
function findSecretLikeValues(value, path = "$") {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findings.push(...findSecretLikeValues(entry, `${path}[${index}]`)));
    return findings;
  }
  if (!isPlainObject(value)) return findings;
  for (const [key, entry] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if ((secretKeyPattern.test(key) || (rpcUrlKeyPattern.test(key) && looksLikeUrl(entry))) && typeof entry === "string") {
      const normalized = entry.trim().toLowerCase();
      if (!["", "present", "configured", "redacted", "<redacted>"].includes(normalized)) {
        findings.push(childPath);
      }
    }
    findings.push(...findSecretLikeValues(entry, childPath));
  }
  return findings;
}

function findUnsafeErrorText(value, path = "$") {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findings.push(...findUnsafeErrorText(entry, `${path}[${index}]`)));
    return findings;
  }
  if (!isPlainObject(value)) return findings;
  for (const [key, entry] of Object.entries(value)) {
    if (
      typeof entry === "string" &&
      unsafeDiagnosticKeyPattern.test(key) &&
      unsafeDiagnosticTextPattern.test(entry)
    ) {
      findings.push(`${path}.${key}`);
    }
    findings.push(...findUnsafeErrorText(entry, `${path}.${key}`));
  }
  return findings;
}
function findTemplateLikeValues(value, path = "$") {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findings.push(...findTemplateLikeValues(entry, `${path}[${index}]`)));
    return findings;
  }
  if (typeof value === "string") {
    if (TEMPLATE_VALUE_RE.test(value)) findings.push(path);
    return findings;
  }
  if (!isPlainObject(value)) return findings;
  for (const [key, entry] of Object.entries(value)) {
    findings.push(...findTemplateLikeValues(entry, `${path}.${key}`));
  }
  return findings;
}

function loadAndValidateManifest(path, issues) {
  const absolutePath = resolve(process.cwd(), path);
  if (!existsSync(absolutePath)) return null;
  const manifestStat = regularFileStat(absolutePath);
  if (!manifestStat) {
    issues.push("canary proof manifest must be a file");
    return null;
  }
  if (manifestStat.size > MAX_CANARY_PROOF_MANIFEST_BYTES) {
    issues.push("canary proof manifest is too large to validate safely");
    return null;
  }
  if (strict && /\.draft\.json$/i.test(absolutePath)) {
    issues.push("draft proof manifests are not accepted as launch proof");
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(absolutePath, "utf8"));
  } catch (error) {
    issues.push(`canary proof manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  if (!isPlainObject(manifest)) {
    issues.push("canary proof manifest must be an object");
    return null;
  }
  const secretFindings = findSecretLikeValues(manifest);
  if (secretFindings.length > 0) {
    issues.push(`secret-like values must be redacted: ${secretFindings.slice(0, 5).join(", ")}`);
  }
  const templateFindings = findTemplateLikeValues(manifest);
  if (templateFindings.length > 0) {
    issues.push(`template placeholder values must be replaced: ${templateFindings.slice(0, 5).join(", ")}`);
  }
  const missingArtifactRefs = findMissingLocalArtifactRefs(manifest);
  if (missingArtifactRefs.length > 0) {
    issues.push(`local canary artifact references must exist: ${missingArtifactRefs.slice(0, 5).join(", ")}`);
  }

  const targetNetwork = isPlainObject(manifest.targetNetwork) ? manifest.targetNetwork : {};
  if (!isPlainObject(manifest.targetNetwork)) issues.push("targetNetwork section is missing");
  if (targetNetwork.realTargetNetwork !== true) issues.push("targetNetwork.realTargetNetwork must be true");
  if (!hasRealText(targetNetwork.network)) issues.push("targetNetwork.network is missing");
  if (hasRealText(targetNetwork.network) && normalizeNetwork(targetNetwork.network) !== profile.network) {
    issues.push(`targetNetwork.network must be ${profile.network} for ${profile.label} canary proof`);
  }
  if (expectedNetwork && hasRealText(targetNetwork.network) && normalizeNetwork(targetNetwork.network) !== normalizeNetwork(expectedNetwork)) {
    issues.push("targetNetwork.network must match configured Linea network");
  }
  const targetChainIdString = positiveIntegerString(targetNetwork.chainId);
  const expectedChainIdString = positiveIntegerString(expectedChainId);
  if (!targetChainIdString) issues.push("targetNetwork.chainId must be a canonical positive decimal integer");
  if (targetChainIdString && targetChainIdString !== String(profile.chainId)) {
    issues.push(`targetNetwork.chainId must be ${profile.chainId} for ${profile.label} canary proof`);
  }
  if (expectedChainId && !expectedChainIdString) {
    issues.push("configured chain id must be a canonical positive decimal integer");
  }
  if (expectedChainIdString && targetChainIdString && targetChainIdString !== expectedChainIdString) {
    issues.push("targetNetwork.chainId must match configured chain id");
  }
  if (!hasRealText(targetNetwork.rpc)) {
    issues.push("targetNetwork.rpc is missing");
  } else if (!hasConcreteRpcLabel(targetNetwork.rpc)) {
    issues.push("targetNetwork.rpc must be a concrete redacted RPC label, not a raw URL or generic placeholder");
  }
  if (!hasRealText(targetNetwork.contractAddress)) issues.push("targetNetwork.contractAddress is missing");
  if (expectedContract && hasRealText(targetNetwork.contractAddress) && normalizeAddress(targetNetwork.contractAddress) !== normalizeAddress(expectedContract)) {
    issues.push("targetNetwork.contractAddress must match configured contract address");
  }
  if (!hasIsoTimestamp(targetNetwork.checkedAt)) {
    issues.push("targetNetwork.checkedAt must be ISO-8601 UTC");
  } else if (!hasNonFutureIsoTimestamp(targetNetwork.checkedAt)) {
    issues.push("targetNetwork.checkedAt must not be in the future");
  }
  if (!hasEvidence(targetNetwork)) issues.push("targetNetwork has no evidence");
  if (hasEvidence(targetNetwork) && !hasTargetNetworkProof(targetNetwork)) {
    issues.push(`targetNetwork evidence must mention target RPC, chain, or ${profile.label} proof`);
  }

  const recovery = isPlainObject(manifest.recovery) ? manifest.recovery : {};
  if (!isPlainObject(manifest.recovery)) issues.push("recovery section is missing");
  const recoveryChecks = ["reload", "reconnect", "tabCloseRestore", "pendingTxRecovery", "routeSwitchOrRemount"];
  for (const check of recoveryChecks) {
    const value = recovery[check];
    if (!isPlainObject(value)) {
      issues.push(`recovery.${check} is missing`);
      continue;
    }
    if (!statusOk(value.status)) issues.push(`recovery.${check}.status must be verified/pass`);
    if (!hasIsoTimestamp(value.checkedAt)) {
      issues.push(`recovery.${check}.checkedAt must be ISO-8601 UTC`);
    } else if (!hasNonFutureIsoTimestamp(value.checkedAt)) {
      issues.push(`recovery.${check}.checkedAt must not be in the future`);
    }
    if (check === "pendingTxRecovery" && !isRealTx(value.txHash)) {
      issues.push("recovery.pendingTxRecovery.txHash must be a real non-zero tx hash");
    }
    if (!hasEvidence(value)) issues.push(`recovery.${check} has no evidence`);
    if (hasEvidence(value) && !hasRecoveryProof(value)) {
      issues.push(`recovery.${check} evidence must mention reload, reconnect, tab-close, pending-tx, remount, or recovery proof`);
    }
  }

  const autoMinerSession = isPlainObject(manifest.autoMinerSession) ? manifest.autoMinerSession : {};
  if (!isPlainObject(manifest.autoMinerSession)) issues.push("autoMinerSession section is missing");
  if (!statusOk(autoMinerSession.status)) issues.push("autoMinerSession.status must be verified/pass");
  if (autoMinerSession.targetRpcConfirmed !== true) issues.push("autoMinerSession.targetRpcConfirmed must be true");
  if (!isPositiveInteger(autoMinerSession.rounds)) issues.push("autoMinerSession.rounds must be a positive integer");
  if (!isPositiveInteger(autoMinerSession.uniqueEpochs)) issues.push("autoMinerSession.uniqueEpochs must be a positive integer");
  const manifestRequiredRoles = normalizeRoleList(autoMinerSession.requiredRoles);
  const manifestSuccessfulRoles = normalizeRoleList(autoMinerSession.successfulRoles);
  const duplicateManifestRequiredRoles = duplicateRoleEntries(autoMinerSession.requiredRoles);
  const duplicateManifestSuccessfulRoles = duplicateRoleEntries(autoMinerSession.successfulRoles);
  const missingManifestRequiredRoles = requiredCanaryRoles.filter((role) => !manifestRequiredRoles.includes(role));
  const missingManifestSuccessfulRoles = requiredCanaryRoles.filter((role) => !manifestSuccessfulRoles.includes(role));
  const unexpectedManifestRequiredRoles = requiredCanaryRoles.length > 0
    ? manifestRequiredRoles.filter((role) => !requiredCanaryRoles.includes(role))
    : [];
  const unexpectedManifestSuccessfulRoles = requiredCanaryRoles.length > 0
    ? manifestSuccessfulRoles.filter((role) => !requiredCanaryRoles.includes(role))
    : [];
  if (missingManifestRequiredRoles.length > 0) {
    issues.push(`autoMinerSession.requiredRoles must include ${missingManifestRequiredRoles.join(",")}`);
  }
  if (missingManifestSuccessfulRoles.length > 0) {
    issues.push(`autoMinerSession.successfulRoles must include ${missingManifestSuccessfulRoles.join(",")}`);
  }
  if (unexpectedManifestRequiredRoles.length > 0) {
    issues.push(`autoMinerSession.requiredRoles must not include unexpected roles ${unexpectedManifestRequiredRoles.join(",")}`);
  }
  if (unexpectedManifestSuccessfulRoles.length > 0) {
    issues.push(`autoMinerSession.successfulRoles must not include unexpected roles ${unexpectedManifestSuccessfulRoles.join(",")}`);
  }
  if (duplicateManifestRequiredRoles.length > 0) {
    issues.push(`autoMinerSession.requiredRoles contains duplicate role entries ${duplicateManifestRequiredRoles.map((entry) => entry.index).slice(0, 5).join(",")}`);
  }
  if (duplicateManifestSuccessfulRoles.length > 0) {
    issues.push(`autoMinerSession.successfulRoles contains duplicate role entries ${duplicateManifestSuccessfulRoles.map((entry) => entry.index).slice(0, 5).join(",")}`);
  }
  if (!hasIsoTimestamp(autoMinerSession.checkedAt)) {
    issues.push("autoMinerSession.checkedAt must be ISO-8601 UTC");
  } else if (!hasNonFutureIsoTimestamp(autoMinerSession.checkedAt)) {
    issues.push("autoMinerSession.checkedAt must not be in the future");
  }
  if (!hasEvidence(autoMinerSession)) issues.push("autoMinerSession has no evidence");
  if (hasEvidence(autoMinerSession) && !hasAutoMinerSessionProof(autoMinerSession)) {
    issues.push("autoMinerSession evidence must mention auto-miner session, rounds, epochs, or target RPC proof");
  }

  const transactionHealth = isPlainObject(manifest.transactionHealth) ? manifest.transactionHealth : {};
  if (!isPlainObject(manifest.transactionHealth)) issues.push("transactionHealth section is missing");
  if (transactionHealth.noDuplicateBets !== true) issues.push("transactionHealth.noDuplicateBets must be true");
  if (transactionHealth.noNonceLoops !== true) issues.push("transactionHealth.noNonceLoops must be true");
  if (transactionHealth.noStuckPending !== true) issues.push("transactionHealth.noStuckPending must be true");
  if (transactionHealth.pendingRecoveryConverged !== true) issues.push("transactionHealth.pendingRecoveryConverged must be true");
  if (txHashList(transactionHealth.txHashes).length === 0) {
    issues.push("transactionHealth.txHashes must include at least one real non-zero tx hash");
  }
  const malformedTransactionHealthTxHashes = malformedTxHashEntries(transactionHealth.txHashes);
  if (malformedTransactionHealthTxHashes.length > 0) {
    issues.push(`transactionHealth.txHashes contains malformed tx hash entries ${malformedTransactionHealthTxHashes.map((entry) => entry.index).slice(0, 5).join(",")}`);
  }
  const duplicateTransactionHealthTxHashes = duplicateTxHashEntries(transactionHealth.txHashes);
  if (duplicateTransactionHealthTxHashes.length > 0) {
    issues.push(`transactionHealth.txHashes contains duplicate tx hash entries ${duplicateTransactionHealthTxHashes.map((entry) => entry.index).slice(0, 5).join(",")}`);
  }
  if (!hasIsoTimestamp(transactionHealth.checkedAt)) {
    issues.push("transactionHealth.checkedAt must be ISO-8601 UTC");
  } else if (!hasNonFutureIsoTimestamp(transactionHealth.checkedAt)) {
    issues.push("transactionHealth.checkedAt must not be in the future");
  }
  if (!hasEvidence(transactionHealth)) issues.push("transactionHealth has no evidence");
  if (hasEvidence(transactionHealth) && !hasTransactionHealthProof(transactionHealth)) {
    issues.push("transactionHealth evidence must mention transaction, tx, nonce, duplicate, stuck pending, or pending recovery proof");
  }

  const sectionArtifactIssues = sharedCanarySectionArtifactIssues({ targetNetwork, recovery, autoMinerSession, transactionHealth });
  if (sectionArtifactIssues.length > 0) {
    issues.push(`canary evidence sections must use distinct local artifact files across ${sectionArtifactIssues.slice(0, 5).join(", ")}`);
  }

  return {
    targetNetwork,
    targetNetworkOk:
      targetNetwork.realTargetNetwork === true &&
      hasRealText(targetNetwork.network) &&
      normalizeNetwork(targetNetwork.network) === profile.network &&
      (!expectedNetwork || normalizeNetwork(targetNetwork.network) === normalizeNetwork(expectedNetwork)) &&
      targetChainIdString === String(profile.chainId) &&
      (!expectedChainId || (expectedChainIdString && targetChainIdString === expectedChainIdString)) &&
      hasConcreteRpcLabel(targetNetwork.rpc) &&
      hasRealText(targetNetwork.contractAddress) &&
      (!expectedContract || normalizeAddress(targetNetwork.contractAddress) === normalizeAddress(expectedContract)) &&
      hasNonFutureIsoTimestamp(targetNetwork.checkedAt) &&
      hasEvidence(targetNetwork) &&
      hasTargetNetworkProof(targetNetwork),
    autoMinerSession,
    transactionHealth,
    recoveryOk: recoveryChecks.every(
      (check) =>
        statusOk(recovery[check]?.status) &&
        hasNonFutureIsoTimestamp(recovery[check]?.checkedAt) &&
        (check !== "pendingTxRecovery" || isRealTx(recovery[check]?.txHash)) &&
        hasEvidence(recovery[check]) &&
        hasRecoveryProof(recovery[check]),
    ),
    autoMinerSessionOk:
      statusOk(autoMinerSession.status) &&
      autoMinerSession.targetRpcConfirmed === true &&
      isPositiveInteger(autoMinerSession.rounds) &&
      isPositiveInteger(autoMinerSession.uniqueEpochs) &&
      missingManifestRequiredRoles.length === 0 &&
      missingManifestSuccessfulRoles.length === 0 &&
      unexpectedManifestRequiredRoles.length === 0 &&
      unexpectedManifestSuccessfulRoles.length === 0 &&
      duplicateManifestRequiredRoles.length === 0 &&
      duplicateManifestSuccessfulRoles.length === 0 &&
      hasNonFutureIsoTimestamp(autoMinerSession.checkedAt) &&
      hasEvidence(autoMinerSession) &&
      hasAutoMinerSessionProof(autoMinerSession),
    transactionHealthOk:
      transactionHealth.noDuplicateBets === true &&
      transactionHealth.noNonceLoops === true &&
      transactionHealth.noStuckPending === true &&
      transactionHealth.pendingRecoveryConverged === true &&
      txHashList(transactionHealth.txHashes).length > 0 &&
      malformedTransactionHealthTxHashes.length === 0 &&
      duplicateTransactionHealthTxHashes.length === 0 &&
      hasNonFutureIsoTimestamp(transactionHealth.checkedAt) &&
      hasEvidence(transactionHealth) &&
      hasTransactionHealthProof(transactionHealth),
  };
}

function sharedCanarySectionArtifactIssues(manifest) {
  const sections = [
    ["targetNetwork", manifest.targetNetwork],
    ["recovery", manifest.recovery],
    ["autoMinerSession", manifest.autoMinerSession],
    ["transactionHealth", manifest.transactionHealth],
  ].map(([name, value]) => [name, normalizedArtifactPathSet(value)]);
  const findings = [];
  for (let i = 0; i < sections.length; i += 1) {
    for (let j = i + 1; j < sections.length; j += 1) {
      const [leftName, leftPaths] = sections[i];
      const [rightName, rightPaths] = sections[j];
      for (const artifactPath of leftPaths) {
        if (rightPaths.has(artifactPath)) findings.push(`${leftName} and ${rightName}`);
      }
    }
  }
  return [...new Set(findings)];
}

function parsePositiveInteger(raw, fallback) {
  const parsed = parseCanonicalPositiveInteger(raw);
  return parsed ?? fallback;
}

function isPositiveInteger(raw) {
  return parseCanonicalPositiveInteger(raw) !== null;
}

function positiveIntegerString(raw) {
  return isPositiveInteger(raw) ? String(raw).trim() : "";
}

function positiveIntegerValue(raw) {
  return parseCanonicalPositiveInteger(raw);
}

function isNonNegativeInteger(raw) {
  return parseCanonicalNonNegativeInteger(raw) !== null;
}

function nonceValue(raw) {
  return parseCanonicalNonNegativeInteger(raw) ?? Number.NaN;
}

function nonNegativeValue(raw) {
  return parseCanonicalNonNegativeInteger(raw);
}

function hasCanonicalNonceEvidence(event) {
  return isNonNegativeInteger(event?.noncePending) && isNonNegativeInteger(event?.nonceLatest);
}

function unique(values) {
  return [...new Set(values)].sort(compareCanonicalIntegerText);
}

function parseCanonicalPositiveInteger(raw) {
  const text = String(raw ?? "").trim();
  if (!CANONICAL_POSITIVE_INTEGER_RE.test(text)) return null;
  const parsed = BigInt(text);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) return null;
  return Number(parsed);
}

function parseCanonicalNonNegativeInteger(raw) {
  const text = String(raw ?? "").trim();
  if (!CANONICAL_NON_NEGATIVE_INTEGER_RE.test(text)) return null;
  const parsed = BigInt(text);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) return null;
  return Number(parsed);
}

function compareCanonicalIntegerText(left, right) {
  if (left.length !== right.length) return left.length - right.length;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function countBy(rows, key) {
  const counts = {};
  for (const row of rows) {
    const value = row[key] ?? "";
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function formatCounts(counts) {
  return Object.entries(counts)
    .filter(([key]) => key)
    .map(([key, value]) => `${safeCountKey(key)}:${value}`)
    .join(", ");
}

function safeCountKey(value) {
  const text = String(value ?? "").trim();
  if (/^[A-Za-z0-9_-]{1,48}$/.test(text)) return text;
  return "unsafe-token";
}

function summarizeV10GasMatrix(events) {
  const values = new Map();
  for (const event of events) {
    const key = v10GasCase(event);
    const gasUsed = gasValue(event.gasUsed);
    if (!key || gasUsed == null) continue;
    const current = values.get(key) ?? [];
    current.push(gasUsed);
    values.set(key, current);
  }
  return new Map([...values].map(([key, gas]) => [key, { count: gas.length, gas: stats(gas) }]));
}

function v10GasCase(event) {
  const tiles = parseBetTiles(event.tiles);
  if (tiles.length === 0) return "";
  const sorted = [...new Set(tiles)].sort((a, b) => a - b);
  const tileCount = tileCountValue(event.tileCount);
  if (sorted.length !== tiles.length || tileCount !== sorted.length) return "";
  if (sorted.length === 1) return "1";
  if (sorted.length === 25 && sorted.every((tile, index) => tile === index + 1)) return "25";
  if (sorted.length !== 3 && sorted.length !== 5) return "";
  const contiguous = sorted.every((tile, index) => index === 0 || tile === sorted[index - 1] + 1);
  return `${sorted.length}-${contiguous ? "contiguous" : "sparse"}`;
}

function parseBetTiles(value) {
  if (!Array.isArray(value)) return [];
  const tiles = [];
  for (const tile of value) {
    const parsed = parseCanonicalPositiveInteger(tile);
    if (parsed == null || parsed < 1 || parsed > 25) return [];
    tiles.push(parsed);
  }
  return tiles;
}

function tileCountValue(value) {
  const parsed = parseCanonicalPositiveInteger(value);
  if (parsed == null) return null;
  return parsed >= 1 && parsed <= 25 ? parsed : null;
}

function gasValue(value) {
  return nonNegativeValue(value);
}

function hasMalformedV10GasMatrixEvidence(event) {
  const hasMatrixShape = event?.tiles !== undefined || event?.tileCount !== undefined || event?.gasUsed !== undefined;
  if (!hasMatrixShape) return false;
  return v10GasCase(event) === "" || gasValue(event.gasUsed) == null;
}

function hasMalformedSuccessfulTxMetricEvidence(event) {
  return (
    (event?.durationMs !== undefined && !isNonNegativeInteger(event.durationMs)) ||
    (event?.gasUsed !== undefined && !isNonNegativeInteger(event.gasUsed)) ||
    (event?.effectiveGasPrice !== undefined && !isNonNegativeInteger(event.effectiveGasPrice)) ||
    (event?.blockNumber !== undefined && !isNonNegativeInteger(event.blockNumber))
  );
}

function stats(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return { p50: "n/a", p95: "n/a", max: "n/a" };
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1),
  };
}

function trend(events, field) {
  const values = events.map((event) => nonNegativeValue(event[field])).filter(Number.isFinite);
  if (values.length === 0) return null;
  return { first: values[0], max: Math.max(...values), delta: values.at(-1) - values[0] };
}

function formatTrend(value) {
  return value ? `${value.first} / ${value.max} / ${value.delta}` : "n/a / n/a / n/a";
}

function elapsedRunMs(events) {
  const timestamps = events
    .map((event) => isoTimestampMs(event.timestamp))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (timestamps.length === 0) return null;
  return timestamps.at(-1) - timestamps[0];
}

function percentile(sorted, value) {
  return sorted[Math.floor((sorted.length - 1) * value)];
}

function findDuplicateBetKeys(bets) {
  const seen = new Map();
  const duplicateKeys = new Set();
  for (const event of bets) {
    const role = event.role ?? "";
    const epoch = positiveIntegerString(event.epoch);
    if (!epoch) continue;
    const tiles = parseBetTiles(event.tiles);
    if (tiles.length === 0) continue;
    const signature = repeatBetSignature(event);
    for (const tile of tiles) {
      const key = `${role}|${epoch}|${tile}`;
      const prior = seen.get(key);
      if (!prior) {
        if (event.repeat === true) duplicateKeys.add(key);
        else seen.set(key, { repeated: false, signature });
        continue;
      }
      if (event.repeat === true && !prior.repeated && prior.signature === signature) {
        prior.repeated = true;
        continue;
      }
      duplicateKeys.add(key);
    }
  }
  return [...duplicateKeys].sort();
}

function findDuplicateRoleEpochKeys(bets) {
  const seen = new Map();
  const duplicateKeys = new Set();
  for (const event of bets) {
    const role = normalizeRole(event.role);
    const epoch = positiveIntegerString(event.epoch);
    if (!role || !epoch) continue;
    const chainId = positiveIntegerString(event.chainId) || "chain-missing";
    const contract = normalizeAddress(event.contractAddress) || "contract-missing";
    const key = `${role}|${chainId}|${contract}|${epoch}`;
    const signature = repeatBetSignature(event);
    const prior = seen.get(key);
    if (!prior) {
      if (event.repeat === true) duplicateKeys.add(key);
      else seen.set(key, { repeated: false, signature });
      continue;
    }
    if (event.repeat === true && !prior.repeated && prior.signature === signature) {
      prior.repeated = true;
      continue;
    }
    duplicateKeys.add(key);
  }
  return [...duplicateKeys].sort();
}

function repeatBetSignature(event) {
  const tiles = parseBetTiles(event.tiles).sort((a, b) => a - b).join(",");
  const amounts = Array.isArray(event.amounts) ? event.amounts.map(String).join(",") : "";
  return [event.role, event.epoch, event.round, event.mode, tiles, event.amount, amounts, event.totalAmount].join("|");
}

function findDuplicateTxHashes(events) {
  const seen = new Set();
  const duplicateHashes = new Set();
  for (const event of events) {
    const hash = String(eventTxHash(event) ?? "").trim().toLowerCase();
    if (!isRealTx(hash)) continue;
    if (seen.has(hash)) duplicateHashes.add(hash);
    seen.add(hash);
  }
  return [...duplicateHashes].sort();
}

function findDuplicateNonceKeys(events) {
  const seen = new Set();
  const duplicateKeys = new Set();
  for (const event of events) {
    if (!hasCanonicalNonceEvidence(event)) continue;
    const role = normalizeRole(event.role);
    if (!role) continue;
    const chainId = positiveIntegerString(event.chainId) || "chain-missing";
    const contract = normalizeAddress(event.contractAddress) || "contract-missing";
    const nonceLatest = String(event.nonceLatest).trim();
    const noncePending = String(event.noncePending).trim();
    const key = `${role}|${chainId}|${contract}|${nonceLatest}|${noncePending}`;
    if (seen.has(key)) duplicateKeys.add(key);
    seen.add(key);
  }
  return [...duplicateKeys].sort();
}

function findTargetEventMismatches(events, network, chainId, contractAddress, rpcLabel) {
  const mismatches = [];
  const expectedNetworkName = normalizeNetwork(network);
  const expectedChainId = positiveIntegerString(chainId);
  const expectedContractAddress = normalizeAddress(contractAddress);
  const expectedRpcLabel = hasConcreteRpcLabel(rpcLabel) ? String(rpcLabel).trim().toLowerCase() : "";
  for (const event of events) {
    const label = `round=${event.round ?? "n/a"} mode=${event.mode ?? "n/a"} epoch=${event.epoch ?? "n/a"}`;
    if (expectedNetworkName && normalizeNetwork(event.network) !== expectedNetworkName) {
      mismatches.push(`${label} network=${event.network ?? "missing"}`);
    }
    if (expectedChainId && positiveIntegerString(event.chainId) !== expectedChainId) {
      mismatches.push(`${label} chainId=${event.chainId ?? "missing"}`);
    }
    if (expectedContractAddress && normalizeAddress(event.contractAddress) !== expectedContractAddress) {
      mismatches.push(`${label} contractAddress=${event.contractAddress ?? "missing"}`);
    }
    if (expectedRpcLabel && String(event.rpcLabel ?? "").trim().toLowerCase() !== expectedRpcLabel) {
      mismatches.push(`${label} rpcLabel=${event.rpcLabel ?? "missing"}`);
    }
  }
  return mismatches;
}
