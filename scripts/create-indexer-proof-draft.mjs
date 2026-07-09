import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function refuseFinalProofOutput(outPath) {
  const normalized = path.relative(process.cwd(), outPath).replace(/\\/g, "/");
  if (normalized === "docs/indexer-proof.json") {
    throw new Error("Proof draft generator writes incomplete drafts only; use --out=docs/indexer-proof.draft.json, then promote to docs/indexer-proof.json only after real fresh DB dry-run, finality, chain snapshot, and direct chain comparison evidence passes strict validation");
  }
}

const COMPARISON_KEYS = ["jackpot", "deposits", "rewards", "rebates", "latestEpochs"];

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

function readRequiredLog(name, filePath) {
  requireConcreteValue(name, filePath);
  const resolved = path.resolve(process.cwd(), filePath);
  if (!existsSync(resolved)) {
    throw new Error(`--${name} must point to an existing redacted artifact`);
  }
  return readFileSync(resolved, "utf8");
}

function firstMatchingLine(text, pattern) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => pattern.test(line));
}

function normalizedOrigin(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return "";
  }
}

function expectedProductionHealthOrigin() {
  return normalizedOrigin(process.env.PROD_HEALTH_BASE_URL || "https://playlore.xyz");
}

function parseKeyValues(line = "") {
  const result = {};
  for (const match of line.matchAll(/([a-zA-Z][a-zA-Z0-9]*)=([^\s]+)/g)) {
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
  const parsed = Number(String(value ?? "").trim());
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isPositiveInteger(value) {
  const parsed = parseInteger(value);
  return parsed != null && parsed > 0;
}

function boolFromArg(name, fallback = false) {
  const raw = argValue(name);
  if (!raw) return fallback;
  return ["1", "true", "yes", "pass", "verified"].includes(raw.trim().toLowerCase());
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readRequiredJson(name, filePath) {
  requireConcreteValue(name, filePath);
  const resolved = path.resolve(process.cwd(), filePath);
  if (!existsSync(resolved)) {
    throw new Error(`--${name} must point to an existing redacted artifact`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(resolved, "utf8"));
  } catch (error) {
    console.error(`--${name} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  if (!isPlainObject(parsed)) {
    console.error(`--${name} must be a JSON object artifact`);
    process.exit(1);
  }
  return parsed;
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
  requireCondition(Number(value) === Number(expected), `--chain-snapshot ${label} must match ${expected}`);
}

const outPath = path.resolve(process.cwd(), argValue("out", "docs/indexer-proof.draft.json"));
refuseFinalProofOutput(outPath);
const indexerLog = readRequiredLog("indexer-log", argValue("indexer-log"));
const healthLog = readRequiredLog("health-log", argValue("health-log"));
const chainSnapshotPath = requireConcreteValue("chain-snapshot", argValue("chain-snapshot"));
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

const sqliteLine = firstMatchingLine(indexerLog, /^\[indexer\]\s+SQLite path:/i);
const contractLine = firstMatchingLine(indexerLog, /^\[indexer\]\s+Contract:/i);
const deployLine = firstMatchingLine(indexerLog, /^\[indexer\]\s+Deploy block:/i);
const startLine = firstMatchingLine(indexerLog, /^\[indexer\]\s+Start block:/i);
const finalityLine = firstMatchingLine(indexerLog, /^\[indexer\]\s+Finality blocks:/i);
const scanLine = firstMatchingLine(indexerLog, /^\[indexer\]\s+Scanning blocks/i);
const finishLine = lastMatchingLine(indexerLog, /^\[indexer\]\s+Finished runOnce/i);
const healthSummary = firstMatchingLine(healthLog, /\bfinalityLagBlocks=/i);
const healthValues = parseKeyValues(healthSummary);
const finalityLagIsNumeric = Number.isFinite(Number(healthValues.finalityLagBlocks));
const chainSnapshotEvidence = chainSnapshotPath
  ? `TODO: compare indexer data against ${path.relative(process.cwd(), path.resolve(process.cwd(), chainSnapshotPath))}`
  : "TODO: paste direct chain versus indexer comparison";
const expectedSnapshotChainId = chainSnapshot?.expectedChainId ?? chainSnapshot?.chainId ?? "TODO";
const rpcSnapshotChainId = chainSnapshot?.rpcChainId ?? "TODO";
const rpcSource = chainSnapshot?.rpcSource ?? "TODO";
const snapshotContractAddress = chainSnapshot?.contractAddress ?? "TODO";
const checkedEpochs = Array.isArray(chainSnapshot?.epochs)
  ? chainSnapshot.epochs.map((entry) => entry?.epoch).filter((epoch) => epoch != null)
  : [];
const uniqueCheckedEpochs = [...new Set(checkedEpochs.map((epoch) => String(epoch)))];
const snapshotGeneratedAt = chainSnapshot?.generatedAt ?? chainSnapshot?.checkedAt ?? "";
const rpcChainIdMatches = Number(expectedSnapshotChainId) > 0 && Number(expectedSnapshotChainId) === Number(rpcSnapshotChainId);
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
requireCondition(finalityLagIsNumeric, "--health-log must include numeric finalityLagBlocks=<number>");
requireCondition(normalizedOrigin(healthValues.base) === expectedProductionHealthOrigin(), "--health-log must include base=<production origin>");
requireMatchingChainId("expectedChainId", expectedSnapshotChainId, chainId);
requireMatchingChainId("rpcChainId", rpcSnapshotChainId, chainId);
requireCondition(hasIsoTimestamp(snapshotGeneratedAt), "--chain-snapshot must include generatedAt as ISO-8601 UTC");
requireCondition(uniqueCheckedEpochs.length >= Number(epochs), "--chain-snapshot epochs must include at least --epochs unique checked epochs");
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
    evidencePath: argValue("indexer-log"),
    timestamp: now,
  },
  finality: {
    finalityBlocksPositive: positiveFinality,
    finalityBlocks: finalityBlocks || "TODO",
    dataSyncHealthFinalityAware: finalityLagIsNumeric && positiveFinality,
    evidence: healthSummary || "TODO: paste finality-aware health/data-sync proof",
    evidencePath: argValue("health-log"),
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
