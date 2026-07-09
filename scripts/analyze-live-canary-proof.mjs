import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const optionArgs = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--") && arg.includes("="))
    .map((arg) => {
      const [key, ...rest] = arg.slice(2).split("=");
      return [key, rest.join("=")];
    }),
);
const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const logPath = positionalArgs[0] || process.env.LIVE_CANARY_LOG_PATH || "";
const strict = process.argv.includes("--strict") || process.env.PROOF_STRICT === "1";
const minEpochs = parsePositiveInteger(process.env.LIVE_CANARY_MIN_EPOCHS, 50);
const minElapsedMsPerEpoch = parsePositiveInteger(process.env.LIVE_CANARY_MIN_ELAPSED_MS_PER_EPOCH, 45_000);
const manifestPath = optionArgs.get("manifest")?.trim() || process.env.CANARY_PROOF_PATH || "docs/canary-proof.json";
const expectedNetwork = process.env.NEXT_PUBLIC_LINEA_NETWORK?.trim() || process.env.LINEA_NETWORK?.trim() || "";
const expectedContract = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS?.trim() || process.env.KEEPER_CONTRACT_ADDRESS?.trim() || "";
const expectedChainId = process.env.NEXT_PUBLIC_LINEA_CHAIN_ID?.trim() || process.env.LINEA_CHAIN_ID?.trim() || "";
const TEMPLATE_VALUE_RE = /REPLACE_|<REDACTED>|TODO|TBD/i;
const GENERIC_RPC_LABEL_RE = /^(?:configured|default|fallback|mainnet|rpc|redacted|target|unlabeled)(?:[-_ ]?rpc(?:[-_ ]?label)?(?:[-_ ]?required)?)?$/i;
const secretKeyPattern = /(secret|private[_-]?key|mnemonic|webhook|dsn|api[_-]?key|api[_-]?token|auth[_-]?token|access[_-]?token|bearer|session|cookie|password)/i;
const TX_RE = /^0x[a-fA-F0-9]{64}$/;
const ZERO_TX = "0x0000000000000000000000000000000000000000000000000000000000000000";

if (!logPath) {
  console.error("Usage: node scripts/analyze-live-canary-proof.mjs <live-canary.jsonl> [--strict] [--manifest=docs/canary-proof.json]");
  process.exitCode = 1;
} else if (!existsSync(logPath)) {
  console.error(`Live canary log not found: ${logPath}`);
  process.exitCode = 1;
} else {
  const events = readJsonl(logPath);
  const bets = events.filter((event) => Number.isInteger(event.round) && event.round >= 0);
  const okBets = bets.filter((event) => event.ok === true && event.txStatus === "success");
  const failedBets = bets.filter((event) => event.ok !== true || event.txStatus === "reverted");
  const autoMinerBets = okBets.filter((event) => String(event.role ?? "").toUpperCase().includes("AUTOMINER"));
  const autoMinerEpochs = unique(autoMinerBets.map((event) => event.epoch).filter(Boolean));
  const resolveEvents = events.filter((event) => event.mode === "resolve");
  const failedResolve = resolveEvents.filter((event) => event.ok !== true || event.txStatus === "reverted");
  const epochWaits = events.filter((event) => event.mode === "epoch-wait");
  const betEpochs = unique(okBets.map((event) => event.epoch).filter(Boolean));
  const duplicateKeys = findDuplicateBetKeys(okBets);
  const missingSuccessfulTxHashes = okBets.filter((event) => !isRealTx(eventTxHash(event)));
  const duplicateSuccessfulTxHashes = findDuplicateTxHashes(okBets);
  const nonceGaps = okBets.filter((event) => Number(event.noncePending) > Number(event.nonceLatest));
  const durationStats = stats(okBets.map((event) => Number(event.durationMs)));
  const gasStats = stats(okBets.map((event) => Number(event.gasUsed)));
  const elapsedMs = elapsedRunMs(okBets);
  const minElapsedMs = Math.max(0, (Math.min(betEpochs.length, minEpochs) - 1) * minElapsedMsPerEpoch);
  const byRole = countBy(okBets, "role");
  const byMode = countBy(okBets, "mode");
  const byErrorKind = countBy(failedBets, "errorKind");
  const manifestIssues = [];
  const manifestSummary = loadAndValidateManifest(manifestPath, manifestIssues);
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

  const strictFailures = [];
  if (betEpochs.length < minEpochs) strictFailures.push(`unique bet epochs ${betEpochs.length} < ${minEpochs}`);
  if (autoMinerEpochs.length < minEpochs) strictFailures.push(`successful auto-miner unique epochs ${autoMinerEpochs.length} < ${minEpochs}`);
  if (elapsedMs != null && elapsedMs < minElapsedMs) strictFailures.push(`elapsed canary time ${elapsedMs}ms < ${minElapsedMs}ms`);
  if (elapsedMs == null && okBets.length > 0) strictFailures.push("canary event timestamps are missing or invalid");
  if (failedBets.length > 0) strictFailures.push(`failed bets ${failedBets.length}`);
  if (autoMinerBets.length === 0) strictFailures.push("successful auto-miner canary bets are missing");
  if (missingSuccessfulTxHashes.length > 0) strictFailures.push(`successful bet tx hashes missing or invalid ${missingSuccessfulTxHashes.length}`);
  if (duplicateSuccessfulTxHashes.length > 0) strictFailures.push(`duplicate successful tx hashes ${duplicateSuccessfulTxHashes.length}`);
  if (nonceGaps.length > 0) strictFailures.push(`nonce gaps ${nonceGaps.length}`);
  if (duplicateKeys.length > 0) strictFailures.push(`duplicate role/epoch/tile keys ${duplicateKeys.length}`);
  if (failedResolve.length > 0) strictFailures.push(`failed resolve tx ${failedResolve.length}`);
  if (targetEventMismatches.length > 0) strictFailures.push(`target metadata mismatches ${targetEventMismatches.length}`);
  if (manifestSummary) {
    const manifestAutoMinerRounds = Number(manifestSummary.autoMinerSession.rounds);
    const manifestAutoMinerUniqueEpochs = Number(manifestSummary.autoMinerSession.uniqueEpochs);
    const manifestTxHashes = txHashList(manifestSummary.transactionHealth.txHashes);
    const observedSuccessfulTxHashes = new Set(txHashList(okBets.map(eventTxHash)));
    const observedAutoMinerTxHashes = new Set(txHashList(autoMinerBets.map(eventTxHash)));
    if (Number.isInteger(manifestAutoMinerRounds) && manifestAutoMinerRounds !== autoMinerBets.length) {
      strictFailures.push(`autoMinerSession.rounds ${manifestAutoMinerRounds} != observed ${autoMinerBets.length}`);
    }
    if (Number.isInteger(manifestAutoMinerUniqueEpochs) && manifestAutoMinerUniqueEpochs !== autoMinerEpochs.length) {
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
  if (strict && !existsSync(resolve(process.cwd(), manifestPath))) strictFailures.push("canary proof manifest is missing");
  strictFailures.push(...manifestIssues);

  console.log("# Live Canary Proof Summary");
  console.log("");
  console.log(`Log: ${basename(logPath)}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Strict: ${strict ? "yes" : "no"}`);
  console.log(`Minimum epochs: ${minEpochs}`);
  console.log(`Minimum elapsed ms per epoch: ${minElapsedMsPerEpoch}`);
  console.log(`Manifest: ${resolve(process.cwd(), manifestPath)}`);
  console.log("");
  console.log("| Metric | Value |");
  console.log("| --- | --- |");
  console.log(`| bet tx | ${bets.length} |`);
  console.log(`| successful bet tx | ${okBets.length} |`);
  console.log(`| successful auto-miner bet tx | ${autoMinerBets.length} |`);
  console.log(`| successful auto-miner unique epochs | ${autoMinerEpochs.length} |`);
  console.log(`| failed bet tx | ${failedBets.length} |`);
  console.log(`| unique bet epochs | ${betEpochs.length} |`);
  console.log(`| first / last epoch | ${betEpochs[0] ?? "n/a"} / ${betEpochs.at(-1) ?? "n/a"} |`);
  console.log(`| elapsed canary ms | ${elapsedMs ?? "n/a"} |`);
  console.log(`| resolve tx | ${resolveEvents.length} |`);
  console.log(`| failed resolve tx | ${failedResolve.length} |`);
  console.log(`| epoch waits | ${epochWaits.length} |`);
  console.log(`| nonce gaps | ${nonceGaps.length} |`);
  console.log(`| missing successful tx hashes | ${missingSuccessfulTxHashes.length} |`);
  console.log(`| duplicate successful tx hashes | ${duplicateSuccessfulTxHashes.length} |`);
  console.log(`| duplicate role/epoch/tile keys | ${duplicateKeys.length} |`);
  console.log(`| duration ms p50 / p95 / max | ${durationStats.p50} / ${durationStats.p95} / ${durationStats.max} |`);
  console.log(`| gas p50 / p95 / max | ${gasStats.p50} / ${gasStats.p95} / ${gasStats.max} |`);
  console.log(`| roles | ${formatCounts(byRole)} |`);
  console.log(`| modes | ${formatCounts(byMode)} |`);
  console.log(`| bet error kinds | ${formatCounts(byErrorKind) || "none"} |`);
  console.log("");

  if (manifestSummary) {
    console.log("## Canary Manifest");
    console.log("| Section | Status |");
    console.log("| --- | --- |");
    console.log(`| targetNetwork | ${manifestSummary.targetNetwork.realTargetNetwork === true ? "checked" : "issue"} |`);
    console.log(`| recovery | ${manifestSummary.recoveryOk ? "checked" : "issue"} |`);
    console.log(`| autoMinerSession | ${manifestSummary.autoMinerSessionOk ? "checked" : "issue"} |`);
    console.log(`| transactionHealth | ${manifestSummary.transactionHealthOk ? "checked" : "issue"} |`);
    console.log("");
  }

  if (failedResolve.length > 0) {
    console.log("Failed resolve samples:");
    for (const event of failedResolve.slice(0, 5)) {
      console.log(`- epoch=${event.epoch} status=${event.txStatus ?? "unknown"} hash=${event.hash ?? "n/a"}`);
    }
    console.log("");
  }

  if (duplicateSuccessfulTxHashes.length > 0) {
    console.log("Duplicate tx hash samples:");
    for (const hash of duplicateSuccessfulTxHashes.slice(0, 5)) console.log(`- ${hash}`);
    console.log("");
  }

  if (duplicateKeys.length > 0) {
    console.log("Duplicate bet key samples:");
    for (const key of duplicateKeys.slice(0, 5)) console.log(`- ${key}`);
    console.log("");
  }

  if (targetEventMismatches.length > 0) {
    console.log("Target metadata mismatch samples:");
    for (const mismatch of targetEventMismatches.slice(0, 5)) console.log(`- ${mismatch}`);
    console.log("");
  }

  console.log(
    strictFailures.length === 0
      ? "Summary: live canary proof checks passed."
      : `Summary: ${strictFailures.length} proof issue(s): ${strictFailures.join("; ")}.`,
  );

  if (strict && strictFailures.length > 0) process.exitCode = 1;
}

function readJsonl(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at ${path}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
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

function isRealTx(value) {
  const normalized = String(value ?? "").trim();
  return TX_RE.test(normalized) && normalized.toLowerCase() !== ZERO_TX;
}

function txHashList(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.map((entry) => String(entry ?? "").trim().toLowerCase()).filter(isRealTx);
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

function hasConcreteText(value) {
  if (Array.isArray(value)) return value.some(hasConcreteText);
  if (isRealTx(value)) return true;
  if (!hasRealText(value)) return false;
  const text = String(value).trim();
  return /https?:\/\//i.test(text) ||
    /(?:^|[\\/\s])[^\s]+\.(?:json|jsonl|log|md|txt|csv|png|jpg|jpeg|webp)(?:\b|$)/i.test(text) ||
    /\bnpm(?:\.cmd)?\s+run\s+(?:proof:canary|smoke:browser|live:monitor|proof:[a-z0-9:-]+)\b/i.test(text) ||
    /\bproof:[a-z0-9:-]+\b/i.test(text) ||
    /\b(?:live[-\s]?canary|target[-\s]?rpc|chainId|reload|reconnect|tab[-\s]?close|pending[-\s]?tx|remount|nonce|duplicate|stuck[-\s]?pending)\b/i.test(text);
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
    if (artifactPath && !existsSync(resolve(process.cwd(), artifactPath))) {
      findings.push(`${path} -> ${artifactPath}`);
    }
    return findings;
  }
  if (!isPlainObject(value)) return findings;
  for (const [childKey, entry] of Object.entries(value)) {
    findings.push(...findMissingLocalArtifactRefs(entry, `${path}.${childKey}`, childKey));
  }
  return findings;
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
    if (secretKeyPattern.test(key) && typeof entry === "string") {
      const normalized = entry.trim().toLowerCase();
      if (!["", "present", "configured", "redacted", "<redacted>"].includes(normalized)) {
        findings.push(childPath);
      }
    }
    findings.push(...findSecretLikeValues(entry, childPath));
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
  if (hasRealText(targetNetwork.network) && normalizeNetwork(targetNetwork.network) !== "mainnet") {
    issues.push("targetNetwork.network must be mainnet for launch canary proof");
  }
  if (expectedNetwork && hasRealText(targetNetwork.network) && normalizeNetwork(targetNetwork.network) !== normalizeNetwork(expectedNetwork)) {
    issues.push("targetNetwork.network must match configured Linea network");
  }
  if (!isPositiveInteger(targetNetwork.chainId)) issues.push("targetNetwork.chainId must be a positive integer");
  if (isPositiveInteger(targetNetwork.chainId) && Number(targetNetwork.chainId) !== 59144) {
    issues.push("targetNetwork.chainId must be 59144 for Linea mainnet launch proof");
  }
  if (expectedChainId && isPositiveInteger(targetNetwork.chainId) && Number(targetNetwork.chainId) !== Number(expectedChainId)) {
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
  if (!hasIsoTimestamp(targetNetwork.checkedAt)) issues.push("targetNetwork.checkedAt must be ISO-8601 UTC");
  if (!hasEvidence(targetNetwork)) issues.push("targetNetwork has no evidence");

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
    if (!hasIsoTimestamp(value.checkedAt)) issues.push(`recovery.${check}.checkedAt must be ISO-8601 UTC`);
    if (check === "pendingTxRecovery" && !isRealTx(value.txHash)) {
      issues.push("recovery.pendingTxRecovery.txHash must be a real non-zero tx hash");
    }
    if (!hasEvidence(value)) issues.push(`recovery.${check} has no evidence`);
  }

  const autoMinerSession = isPlainObject(manifest.autoMinerSession) ? manifest.autoMinerSession : {};
  if (!isPlainObject(manifest.autoMinerSession)) issues.push("autoMinerSession section is missing");
  if (!statusOk(autoMinerSession.status)) issues.push("autoMinerSession.status must be verified/pass");
  if (autoMinerSession.targetRpcConfirmed !== true) issues.push("autoMinerSession.targetRpcConfirmed must be true");
  if (!isPositiveInteger(autoMinerSession.rounds)) issues.push("autoMinerSession.rounds must be a positive integer");
  if (!isPositiveInteger(autoMinerSession.uniqueEpochs)) issues.push("autoMinerSession.uniqueEpochs must be a positive integer");
  if (!hasIsoTimestamp(autoMinerSession.checkedAt)) issues.push("autoMinerSession.checkedAt must be ISO-8601 UTC");
  if (!hasEvidence(autoMinerSession)) issues.push("autoMinerSession has no evidence");

  const transactionHealth = isPlainObject(manifest.transactionHealth) ? manifest.transactionHealth : {};
  if (!isPlainObject(manifest.transactionHealth)) issues.push("transactionHealth section is missing");
  if (transactionHealth.noDuplicateBets !== true) issues.push("transactionHealth.noDuplicateBets must be true");
  if (transactionHealth.noNonceLoops !== true) issues.push("transactionHealth.noNonceLoops must be true");
  if (transactionHealth.noStuckPending !== true) issues.push("transactionHealth.noStuckPending must be true");
  if (transactionHealth.pendingRecoveryConverged !== true) issues.push("transactionHealth.pendingRecoveryConverged must be true");
  if (txHashList(transactionHealth.txHashes).length === 0) {
    issues.push("transactionHealth.txHashes must include at least one real non-zero tx hash");
  }
  if (!hasIsoTimestamp(transactionHealth.checkedAt)) issues.push("transactionHealth.checkedAt must be ISO-8601 UTC");
  if (!hasEvidence(transactionHealth)) issues.push("transactionHealth has no evidence");

  return {
    targetNetwork,
    autoMinerSession,
    transactionHealth,
    recoveryOk: recoveryChecks.every(
      (check) =>
        statusOk(recovery[check]?.status) &&
        hasIsoTimestamp(recovery[check]?.checkedAt) &&
        (check !== "pendingTxRecovery" || isRealTx(recovery[check]?.txHash)) &&
        hasEvidence(recovery[check]),
    ),
    autoMinerSessionOk:
      statusOk(autoMinerSession.status) &&
      autoMinerSession.targetRpcConfirmed === true &&
      isPositiveInteger(autoMinerSession.rounds) &&
      isPositiveInteger(autoMinerSession.uniqueEpochs) &&
      hasIsoTimestamp(autoMinerSession.checkedAt) &&
      hasEvidence(autoMinerSession),
    transactionHealthOk:
      transactionHealth.noDuplicateBets === true &&
      transactionHealth.noNonceLoops === true &&
      transactionHealth.noStuckPending === true &&
      transactionHealth.pendingRecoveryConverged === true &&
      txHashList(transactionHealth.txHashes).length > 0 &&
      hasIsoTimestamp(transactionHealth.checkedAt) &&
      hasEvidence(transactionHealth),
  };
}

function parsePositiveInteger(raw, fallback) {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isPositiveInteger(raw) {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0;
}

function unique(values) {
  return [...new Set(values)].sort((a, b) => Number(a) - Number(b));
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
    .map(([key, value]) => `${key}:${value}`)
    .join(", ");
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

function elapsedRunMs(events) {
  const timestamps = events
    .map((event) => Date.parse(event.timestamp))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (timestamps.length === 0) return null;
  return timestamps.at(-1) - timestamps[0];
}

function percentile(sorted, value) {
  return sorted[Math.floor((sorted.length - 1) * value)];
}

function findDuplicateBetKeys(bets) {
  const seen = new Set();
  const duplicateKeys = new Set();
  for (const event of bets) {
    const role = event.role ?? "";
    const epoch = event.epoch ?? "";
    const tiles = Array.isArray(event.tiles) ? event.tiles : [];
    for (const tile of tiles) {
      const key = `${role}|${epoch}|${tile}`;
      if (seen.has(key)) duplicateKeys.add(key);
      seen.add(key);
    }
  }
  return [...duplicateKeys].sort();
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

function findTargetEventMismatches(events, network, chainId, contractAddress, rpcLabel) {
  const mismatches = [];
  const expectedNetworkName = normalizeNetwork(network);
  const expectedChainId = isPositiveInteger(chainId) ? Number(chainId) : null;
  const expectedContractAddress = normalizeAddress(contractAddress);
  const expectedRpcLabel = hasConcreteRpcLabel(rpcLabel) ? String(rpcLabel).trim().toLowerCase() : "";
  for (const event of events) {
    const label = `round=${event.round ?? "n/a"} mode=${event.mode ?? "n/a"} epoch=${event.epoch ?? "n/a"}`;
    if (expectedNetworkName && normalizeNetwork(event.network) !== expectedNetworkName) {
      mismatches.push(`${label} network=${event.network ?? "missing"}`);
    }
    if (expectedChainId != null && Number(event.chainId) !== expectedChainId) {
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
