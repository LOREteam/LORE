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

function readRequiredJson(name, filePath) {
  requireConcreteValue(name, filePath);
  const resolved = path.resolve(process.cwd(), filePath);
  if (!existsSync(resolved)) {
    throw new Error(`--${name} must point to an existing redacted artifact`);
  }
  return JSON.parse(readFileSync(resolved, "utf8"));
}

function normalizeAddress(value) {
  return String(value ?? "").trim().toLowerCase();
}

const outPath = path.resolve(process.cwd(), argValue("out", "docs/indexer-proof.draft.json"));
refuseFinalProofOutput(outPath);
const indexerLog = readRequiredLog("indexer-log", argValue("indexer-log"));
const healthLog = readRequiredLog("health-log", argValue("health-log"));
const chainSnapshotPath = requireConcreteValue("chain-snapshot", argValue("chain-snapshot"));
const chainSnapshot = readRequiredJson("chain-snapshot", chainSnapshotPath);
const now = new Date().toISOString();
const deployBlock = requireConcreteValue("deploy-block", argValue("deploy-block", process.env.NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK || ""));
const startBlock = requireConcreteValue("start-block", argValue("start-block", process.env.INDEXER_START_BLOCK || deployBlock));
const finalityBlocks = requireConcreteValue("finality-blocks", argValue("finality-blocks", process.env.INDEXER_FINALITY_BLOCKS || ""));
const configuredContractAddress = process.env.KEEPER_CONTRACT_ADDRESS || process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "";

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
const rpcChainIdMatches = Number(expectedSnapshotChainId) > 0 && Number(expectedSnapshotChainId) === Number(rpcSnapshotChainId);
const contractAddressMatches = Boolean(
  configuredContractAddress &&
  snapshotContractAddress &&
  normalizeAddress(configuredContractAddress) === normalizeAddress(snapshotContractAddress),
);

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
    freshDb: boolFromArg("fresh-db", false),
    fromDeployBlock: matchingStart,
    startBlock: startBlock || "TODO",
    deployBlock: deployBlock || "TODO",
    summary,
    timestamp: now,
  },
  finality: {
    finalityBlocksPositive: positiveFinality,
    finalityBlocks: finalityBlocks || "TODO",
    dataSyncHealthFinalityAware: finalityLagIsNumeric && positiveFinality,
    evidence: healthSummary || "TODO: paste finality-aware health/data-sync proof",
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
    evidence: chainSnapshotPath ? chainSnapshotEvidence : "TODO: collect proof:chain snapshot",
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
