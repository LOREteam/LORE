import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalizeProofOrigin } from "./collect-proof-common.mjs";

function refuseFinalProofOutput(outPath) {
  const normalized = path.relative(process.cwd(), outPath).replace(/\\/g, "/");
  if (normalized === "docs/indexer-proof.json") {
    throw new Error("Proof draft generator writes incomplete drafts only; use --out=docs/indexer-proof.draft.json, then promote to docs/indexer-proof.json only after real fresh DB dry-run, finality, chain snapshot, and direct chain comparison evidence passes strict validation");
  }
}

const COMPARISON_KEYS = ["jackpot", "deposits", "rewards", "rebates", "latestEpochs"];
const CANONICAL_NON_NEGATIVE_INTEGER_RE = /^(?:0|[1-9]\d{0,15})$/;
const CANONICAL_POSITIVE_INTEGER_RE = /^[1-9]\d{0,15}$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_KEY_VALUE_MARKERS = 64;
const MAX_INDEXER_EVIDENCE_BYTES = 512 * 1024;

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : process.env[name.toUpperCase().replaceAll("-", "_")] || fallback;
}

function requireConcreteValue(name, value) {
  if (!String(value ?? "").trim() || /^(?:TODO|TBD|REPLACE|<)/i.test(String(value).trim())) {
    throw new Error(`--${name} is required when drafting indexer launch evidence`);
  }
  return value;
}

function regularFileStat(filePath) {
  try {
    const stat = statSync(filePath);
    return stat.isFile() ? stat : null;
  } catch {
    return null;
  }
}

function readRequiredLog(name, filePath) {
  requireConcreteValue(name, filePath);
  const resolved = path.resolve(process.cwd(), filePath);
  const stat = regularFileStat(resolved);
  if (!stat) {
    throw new Error(`--${name} must point to an existing redacted artifact`);
  }
  if (stat.size > MAX_INDEXER_EVIDENCE_BYTES) {
    throw new Error(`--${name} artifact is too large to validate safely`);
  }
  return readFileSync(resolved, "utf8");
}

function firstMatchingLine(text, pattern) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => pattern.test(line));
}

function expectedProductionHealthOrigin() {
  return normalizeProofOrigin(process.env.PROD_HEALTH_BASE_URL || "https://playlore.xyz");
}

function parseKeyValues(line = "") {
  const result = {};
  const pattern = /([a-zA-Z][a-zA-Z0-9]*)=([^\s]+)/g;
  let inspected = 0;
  let match;
  while ((match = pattern.exec(line)) !== null) {
    inspected += 1;
    if (inspected > MAX_KEY_VALUE_MARKERS) {
      throw new Error("indexer evidence has too many key/value markers to validate safely");
    }
    result[match[1]] = match[2];
  }
  return result;
}
function lastMatchingLine(text, pattern) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => pattern.test(line))
    .at(-1);
}

function parseInteger(value) {
  const text = String(value ?? "").trim();
  if (!CANONICAL_NON_NEGATIVE_INTEGER_RE.test(text)) return null;
  const parsed = BigInt(text);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) return null;
  return Number(parsed);
}

function isPositiveInteger(value) {
  const parsed = parseInteger(value);
  return parsed !== null && parsed > 0 && CANONICAL_POSITIVE_INTEGER_RE.test(String(value ?? "").trim());
}

function isNonNegativeInteger(value) {
  return parseInteger(value) != null;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readRequiredJson(name, filePath) {
  requireConcreteValue(name, filePath);
  const resolved = path.resolve(process.cwd(), filePath);
  const stat = regularFileStat(resolved);
  if (!stat) {
    throw new Error(`--${name} must point to an existing redacted JSON artifact`);
  }
  if (stat.size > MAX_INDEXER_EVIDENCE_BYTES) {
    throw new Error(`--${name} JSON artifact is too large to validate safely`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(resolved, "utf8"));
  } catch {
    console.error(`--${name} must be valid JSON`);
    process.exit(1);
  }
  if (!isPlainObject(parsed)) {
    console.error(`--${name} must be a JSON object artifact`);
    process.exit(1);
  }
  return parsed;
}

function normalizeRpcSource(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;

  const parsed = new URL(raw);
  requireCondition(
    !parsed.username && !parsed.password && !parsed.search && !parsed.hash,
    "--chain-snapshot rpcSource must be a redacted label or origin-only URL",
  );
  return parsed.origin;
}

function sameArtifact(left, right) {
  if (!left || !right) return false;
  return path.resolve(process.cwd(), left).replace(/[\\/]+/g, "/").toLowerCase() ===
    path.resolve(process.cwd(), right).replace(/[\\/]+/g, "/").toLowerCase();
}

function requireDistinctArtifactInputs(entries) {
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const { name: leftName, filePath: leftPath } = entries[i];
      const { name: rightName, filePath: rightPath } = entries[j];
      if (sameArtifact(leftPath, rightPath)) {
        throw new Error(`--${leftName} and --${rightName} must point to distinct indexer evidence files`);
      }
    }
  }
}

function normalizeAddress(value) {
  return String(value ?? "").trim().toLowerCase();
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function hasIsoTimestamp(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text)) return false;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return false;
  const normalized = text.includes(".") ? text : text.replace("Z", ".000Z");
  return parsed.toISOString() === normalized;
}

function isAnyPlatformAbsolute(filePath) {
  const value = String(filePath ?? "").trim();
  return path.isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value) || value.startsWith("/");
}

function pathStatus(filePath) {
  const value = String(filePath ?? "").trim();
  const absolute = isAnyPlatformAbsolute(value) ? path.resolve(value) : path.resolve(process.cwd(), value || ".");
  const relativeToRepo = path.relative(process.cwd(), absolute);
  return {
    isAbsolute: isAnyPlatformAbsolute(value),
    insideRepo: relativeToRepo === "" || (!relativeToRepo.startsWith("..") && !path.isAbsolute(relativeToRepo)),
  };
}

function requireExternalDbPath(filePath) {
  const status = pathStatus(filePath);
  requireCondition(Boolean(filePath), "--indexer-log must include [indexer] SQLite path");
  requireCondition(status.isAbsolute, "--indexer-log [indexer] SQLite path must be absolute");
  requireCondition(!status.insideRepo, "--indexer-log [indexer] SQLite path must be outside the repo checkout");
}

function indexerLogValue(line) {
  return String(line ?? "").replace(/^\[indexer\]\s+[^:]+:\s*/i, "").trim();
}

function requireMatchingIndexerLine(line, label, expected) {
  requireCondition(Boolean(line), `--indexer-log must include [indexer] ${label}: ${expected}`);
  requireCondition(indexerLogValue(line) === String(expected), `--indexer-log [indexer] ${label} must match ${expected}`);
}

function requireMatchingChainId(label, value, expected) {
  requireCondition(isPositiveInteger(value), `--chain-snapshot ${label} must be a canonical positive decimal integer`);
  requireCondition(String(value).trim() === String(expected).trim(), `--chain-snapshot ${label} must match ${expected}`);
}

const outPath = path.resolve(process.cwd(), argValue("out", "docs/indexer-proof.draft.json"));
refuseFinalProofOutput(outPath);
const indexerLogPath = argValue("indexer-log");
const healthLogPath = argValue("health-log");
const chainSnapshotPath = argValue("chain-snapshot");
requireDistinctArtifactInputs([
  { name: "indexer-log", filePath: indexerLogPath },
  { name: "health-log", filePath: healthLogPath },
  { name: "chain-snapshot", filePath: chainSnapshotPath },
]);
const indexerLog = readRequiredLog("indexer-log", indexerLogPath);
const healthLog = readRequiredLog("health-log", healthLogPath);
requireConcreteValue("chain-snapshot", chainSnapshotPath);
const chainSnapshot = readRequiredJson("chain-snapshot", chainSnapshotPath);
const now = new Date().toISOString();
const freshDb = argValue("fresh-db");
const epochs = argValue("epochs", "1");
const chainId = argValue("chain-id", "59144");
const deployBlock = requireConcreteValue("deploy-block", argValue("deploy-block", process.env.NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK || ""));
const startBlock = requireConcreteValue("start-block", argValue("start-block", process.env.INDEXER_START_BLOCK || deployBlock));
const finalityBlocks = requireConcreteValue("finality-blocks", argValue("finality-blocks", process.env.INDEXER_FINALITY_BLOCKS || ""));
const configuredContractAddress = process.env.KEEPER_CONTRACT_ADDRESS || process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "";
requireCondition(freshDb === "true", "--fresh-db=true is required for indexer launch evidence");
requireCondition(isPositiveInteger(epochs), "--epochs must be a positive integer");
requireCondition(chainId === "59144", "--chain-id=59144 is required for Linea mainnet indexer launch evidence");
requireCondition(isPositiveInteger(deployBlock), "--deploy-block must be a positive integer");
requireCondition(isPositiveInteger(startBlock), "--start-block must be a positive integer");
requireCondition(startBlock === deployBlock, "--start-block must match --deploy-block for fresh deploy-block dry-run evidence");
requireCondition(isPositiveInteger(finalityBlocks), "--finality-blocks must be a positive integer");
const requestedEpochs = parseInteger(epochs);
requireCondition(requestedEpochs !== null && requestedEpochs > 0, "--epochs must be a canonical positive safe integer");

const sqliteLine = firstMatchingLine(indexerLog, /^\[indexer\]\s+SQLite path:/i);
const contractLine = firstMatchingLine(indexerLog, /^\[indexer\]\s+Contract:/i);
const deployLine = firstMatchingLine(indexerLog, /^\[indexer\]\s+Deploy block:/i);
const startLine = firstMatchingLine(indexerLog, /^\[indexer\]\s+Start block:/i);
const finalityLine = firstMatchingLine(indexerLog, /^\[indexer\]\s+Finality blocks:/i);
const scanLine = firstMatchingLine(indexerLog, /^\[indexer\]\s+Scanning blocks/i);
const finishLine = lastMatchingLine(indexerLog, /^\[indexer\]\s+Finished runOnce/i);
const healthSummary = firstMatchingLine(healthLog, /\bfinalityLagBlocks=/i);
const healthValues = parseKeyValues(healthSummary);
const finalityLagIsNumeric = isNonNegativeInteger(healthValues.finalityLagBlocks);
const chainSnapshotEvidence = chainSnapshotPath
  ? `TODO: compare indexer data against ${path.relative(process.cwd(), path.resolve(process.cwd(), chainSnapshotPath))}`
  : "TODO: paste direct chain versus indexer comparison";
const expectedSnapshotChainId = chainSnapshot?.expectedChainId ?? chainSnapshot?.chainId ?? "TODO";
const rpcSnapshotChainId = chainSnapshot?.rpcChainId ?? "TODO";
const rpcSource = normalizeRpcSource(chainSnapshot?.rpcSource) || "TODO";
const snapshotContractAddress = chainSnapshot?.contractAddress ?? "TODO";
const checkedEpochs = Array.isArray(chainSnapshot?.epochs)
  ? chainSnapshot.epochs.map((entry) => entry?.epoch).filter((epoch) => epoch != null)
  : [];
const uniqueCheckedEpochs = [...new Set(checkedEpochs.map((epoch) => String(epoch)))];
const snapshotGeneratedAt = chainSnapshot?.generatedAt ?? chainSnapshot?.checkedAt ?? "";
const rpcChainIdMatches = isPositiveInteger(expectedSnapshotChainId) &&
  String(expectedSnapshotChainId).trim() === String(rpcSnapshotChainId).trim();
const contractAddressMatches = Boolean(
  configuredContractAddress &&
  snapshotContractAddress &&
  normalizeAddress(configuredContractAddress) === normalizeAddress(snapshotContractAddress),
);
const dryRunDbPath = indexerLogValue(sqliteLine);
requireMatchingIndexerLine(sqliteLine, "SQLite path", dryRunDbPath);
requireExternalDbPath(dryRunDbPath);
requireMatchingIndexerLine(deployLine, "Deploy block", deployBlock);
requireMatchingIndexerLine(startLine, "Start block", deployBlock);
requireMatchingIndexerLine(finalityLine, "Finality blocks", finalityBlocks);
requireCondition(Boolean(finishLine), "--indexer-log must include [indexer] Finished runOnce");
requireCondition(!/\[indexer\]\s+Fatal:/i.test(indexerLog), "--indexer-log must not include [indexer] Fatal");
requireCondition(finalityLagIsNumeric, "--health-log must include canonical non-negative decimal finalityLagBlocks=<number>");
  requireCondition(normalizeProofOrigin(healthValues.base) === expectedProductionHealthOrigin(), "--health-log must include base=<production origin>");
requireMatchingChainId("expectedChainId", expectedSnapshotChainId, chainId);
requireMatchingChainId("rpcChainId", rpcSnapshotChainId, chainId);
requireCondition(hasIsoTimestamp(snapshotGeneratedAt), "--chain-snapshot must include generatedAt as ISO-8601 UTC");
requireCondition(uniqueCheckedEpochs.length >= requestedEpochs, "--chain-snapshot epochs must include at least --epochs unique checked epochs");
requireCondition(Boolean(contractLine), "--indexer-log must include [indexer] Contract: <address>");
requireCondition(normalizeAddress(indexerLogValue(contractLine)) === normalizeAddress(snapshotContractAddress), "--indexer-log [indexer] Contract must match --chain-snapshot contractAddress");

const completed = Boolean(finishLine) && !/\[indexer\]\s+Fatal:/i.test(indexerLog);
const matchingStart = startBlock !== "" && deployBlock !== "" && startBlock === deployBlock;
const positiveFinality = isPositiveInteger(finalityBlocks);
const summary = [sqliteLine, contractLine, deployLine, startLine, finalityLine, scanLine, finishLine]
  .filter(Boolean)
  .join(" | ") || "TODO: paste npm.cmd run indexer:once summary";

const manifest = {
  dryRun: {
    status: completed ? "pass" : "TODO",
    command: "npm.cmd run indexer:once",
    freshDb: true,
    fromDeployBlock: matchingStart,
    dbPath: dryRunDbPath,
    startBlock: startBlock || "TODO",
    deployBlock: deployBlock || "TODO",
    summary,
    evidencePath: indexerLogPath,
    timestamp: now,
  },
  finality: {
    finalityBlocksPositive: positiveFinality,
    finalityBlocks: finalityBlocks || "TODO",
    dataSyncHealthFinalityAware: finalityLagIsNumeric && positiveFinality,
    evidence: healthSummary || "TODO: paste finality-aware health/data-sync proof",
    evidencePath: healthLogPath,
    checkedAt: now,
  },
  chainSnapshot: {
    path: chainSnapshotPath ? path.relative(process.cwd(), path.resolve(process.cwd(), chainSnapshotPath)) : "TODO",
    expectedChainId: expectedSnapshotChainId,
    rpcChainId: rpcSnapshotChainId,
    rpcChainIdMatches,
    rpcSource,
    contractAddress: snapshotContractAddress,
    contractAddressMatches,
    sourceGeneratedAt: snapshotGeneratedAt,
    evidence: chainSnapshotPath ? chainSnapshotEvidence : "TODO: collect proof:chain snapshot",
    evidencePath: chainSnapshotPath,
    checkedAt: now,
  },
  chainComparison: Object.fromEntries(
    COMPARISON_KEYS.map((key) => [
      key,
      {
        matches: false,
        checkedEpochs,
        evidence: `${chainSnapshotEvidence} for ${key}`,
        checkedAt: now,
      },
    ]),
  ),
};

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Indexer proof draft written: ${path.relative(process.cwd(), outPath)}`);
console.log("Review TODO fields, set freshDb/fromDeployBlock only with evidence, add direct chain comparisons, then save as docs/indexer-proof.json.");
