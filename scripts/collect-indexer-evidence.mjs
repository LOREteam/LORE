import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { argValue, baseCollectorMeta, hasFlag, isPositiveInteger, printPlan, requireCondition, writeJson, refuseFinalProofOutput } from "./collect-proof-common.mjs";

const COMPARISON_KEYS = ["jackpot", "deposits", "rewards", "rebates", "latestEpochs"];

const freshDb = argValue("fresh-db");
const epochs = argValue("epochs");
const chainId = argValue("chain-id");
const deployBlock = argValue("deploy-block");
const finalityBlocks = argValue("finality-blocks");
const out = argValue("out", "docs/indexer-proof.draft.json");
refuseFinalProofOutput(out, "indexer");

requireCondition(freshDb === "true", "--fresh-db=true is required for indexer launch evidence");
requireCondition(isPositiveInteger(epochs), "--epochs must be a positive integer");
requireCondition(chainId === "59144", "--chain-id=59144 is required for Linea mainnet indexer launch evidence");
requireCondition(isPositiveInteger(deployBlock), "--deploy-block must be a positive integer");
requireCondition(isPositiveInteger(finalityBlocks), "--finality-blocks must be a positive integer");

const now = new Date().toISOString();
const indexerLogPath = argValue("indexer-log");
const healthLogPath = argValue("health-log");
const chainSnapshotPath = argValue("chain-snapshot");
const indexerLog = readOptionalLog(indexerLogPath);
const healthLog = readOptionalLog(healthLogPath);
const chainSnapshot = readOptionalJson(chainSnapshotPath);
const configuredContractAddress = process.env.KEEPER_CONTRACT_ADDRESS || process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "";

function readOptionalLog(filePath) {
  if (!filePath) return "";
  const resolved = resolve(process.cwd(), filePath);
  if (!existsSync(resolved)) {
    throw new Error(`${filePath} does not exist`);
  }
  return readFileSync(resolved, "utf8");
}

function readOptionalJson(filePath) {
  if (!filePath) return null;
  const resolved = resolve(process.cwd(), filePath);
  if (!existsSync(resolved)) {
    throw new Error(`${filePath} does not exist`);
  }
  return JSON.parse(readFileSync(resolved, "utf8").replace(/^\uFEFF/, ""));
}

function firstMatchingLine(text, pattern) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => pattern.test(line));
}

function lastMatchingLine(text, pattern) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => pattern.test(line))
    .at(-1);
}

function parseKeyValues(line = "") {
  const result = {};
  for (const match of line.matchAll(/([a-zA-Z][a-zA-Z0-9]*)=([^\s]+)/g)) {
    result[match[1]] = match[2];
  }
  return result;
}

function normalizeAddress(value) {
  return String(value ?? "").trim().toLowerCase();
}

function relativeArtifact(filePath) {
  return filePath ? relative(process.cwd(), resolve(process.cwd(), filePath)).replace(/\\/g, "/") : "";
}

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
const chainSnapshotArtifact = relativeArtifact(chainSnapshotPath);
const chainSnapshotEvidence = chainSnapshotArtifact
  ? `artifact: ${chainSnapshotArtifact}; pending direct-chain versus indexer comparison`
  : "TODO: paste direct chain versus indexer comparison";
const expectedSnapshotChainId = chainSnapshot?.expectedChainId ?? chainSnapshot?.chainId ?? Number(chainId);
const rpcSnapshotChainId = chainSnapshot?.rpcChainId ?? "TODO";
const rpcSource = chainSnapshot?.rpcSource ?? "TODO: configured redacted RPC source label";
const snapshotContractAddress = chainSnapshot?.contractAddress ?? "TODO: final contract address";
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
const summary = [sqliteLine, contractLine, deployLine, startLine, finalityLine, scanLine, finishLine]
  .filter(Boolean)
  .join(" | ") || "TODO: paste npm.cmd run indexer:once summary from a fresh external DB";

const manifest = {
  ...baseCollectorMeta("indexer"),
  requestedEpochs: Number(epochs),
  dryRun: {
    status: completed ? "pass" : "TODO",
    command: "npm.cmd run indexer:once",
    freshDb: true,
    fromDeployBlock: true,
    startBlock: deployBlock,
    deployBlock,
    summary,
    evidencePath: indexerLogPath || "TODO: path to redacted indexer:once log",
    timestamp: now,
  },
  finality: {
    finalityBlocksPositive: true,
    finalityBlocks,
    dataSyncHealthFinalityAware: finalityLagIsNumeric,
    evidence: healthSummary || "TODO: paste health:prod data-sync evidence with numeric finalityLagBlocks=<number>",
    evidencePath: healthLogPath || "TODO: path to redacted health:prod log",
    checkedAt: now,
  },
  chainSnapshot: {
    path: chainSnapshotArtifact || "TODO: path to proof:chain/direct-chain snapshot artifact",
    expectedChainId: expectedSnapshotChainId,
    rpcChainId: rpcSnapshotChainId,
    rpcChainIdMatches,
    rpcSource,
    contractAddress: snapshotContractAddress,
    contractAddressMatches,
    evidence: chainSnapshotArtifact ? `artifact: ${chainSnapshotArtifact}` : "TODO: paste concrete direct-chain snapshot evidence",
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
  requiredManualEvidence: [
    "run npm.cmd run indexer:once against a fresh DB from the final deploy block and pass --indexer-log=<redacted-indexer-once-log>",
    "record INDEXER_FINALITY_BLOCKS and pass --health-log=<redacted-health-prod-log> with finalityLagBlocks evidence",
    "collect direct-chain snapshot on Linea mainnet chainId=59144 and pass --chain-snapshot=docs/chain-proof-snapshot.json",
    "compare jackpot, deposits, rewards, rebates, and latest epochs against indexer data",
  ],
};

if (hasFlag("print-plan")) {
  printPlan("Indexer Evidence Collection Plan", manifest);
} else {
  const written = writeJson(out, manifest);
  console.log(`Indexer evidence draft written: ${written}`);
  console.log("Review TODO/false fields before promoting to docs/indexer-proof.json and running npm.cmd run proof:indexer -- --strict.");
}


