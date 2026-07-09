import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { argValue, baseCollectorMeta, hasFlag, isAddress, isPositiveInteger, printPlan, requireCondition, writeJson, refuseFinalProofOutput } from "./collect-proof-common.mjs";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_TX = "0x0000000000000000000000000000000000000000000000000000000000000000";
const CHAIN_CHECKS = ["jackpot", "safetyPool", "deposits", "rewards", "rebates", "resolve"];

function envValue(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

function normalizeNetwork(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["main", "linea", "prod", "production", "linea-mainnet"].includes(normalized)) return "mainnet";
  if (["testnet", "linea-sepolia", "sepolia-testnet"].includes(normalized)) return "sepolia";
  return normalized;
}

function chainIdForNetwork(value) {
  const network = normalizeNetwork(value);
  if (network === "mainnet") return "59144";
  if (network === "sepolia") return "59141";
  return "";
}

function isPositiveIntegerString(value) {
  const parsed = Number(String(value ?? "").trim());
  return Number.isSafeInteger(parsed) && parsed > 0;
}

function readRequiredLog(name, filePath) {
  if (!filePath) {
    throw new Error(`--${name} is required when collecting signoff launch evidence`);
  }
  const resolved = resolve(process.cwd(), filePath);
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

function summarizeLog(text, fallback, artifactPath = "") {
  return firstMatchingLine(text, /^Summary:/i) || (text && artifactPath ? `artifact: ${artifactPath}` : fallback);
}

function comparisonDraft(label, user, requestedEpochs, now, chainSummary) {
  return {
    matches: false,
    checkedEpochs: [],
    requestedEpochs,
    user,
    directChainEvidence: chainSummary
      ? `${chainSummary}; TODO: cite exact direct-chain rows for ${label}`
      : `TODO: direct-chain evidence for ${label}`,
    appOrIndexerEvidence: `TODO: app or indexer evidence for ${label}`,
    checkedAt: now,
  };
}

const epochs = argValue("epochs");
const user = argValue("user");
const out = argValue("out", "docs/signoff-proof.draft.json");
refuseFinalProofOutput(out, "signoff");

requireCondition(isPositiveInteger(epochs), "--epochs must be a positive integer");
requireCondition(isAddress(user), "--user must be a non-zero EVM address");

const now = new Date().toISOString();
const envLogPath = argValue("env-log");
const chainLogPath = argValue("chain-log");
const envLog = readRequiredLog("env-log", envLogPath);
const chainLog = readRequiredLog("chain-log", chainLogPath);
const envSummary = summarizeLog(envLog, "TODO: paste redacted proof:mainnet summary for final host env", envLogPath);
const chainSummary = summarizeLog(chainLog, "", chainLogPath);
const network = argValue("network", envValue("LINEA_NETWORK", "NEXT_PUBLIC_LINEA_NETWORK") || "TODO: target network");
const chainId = argValue("chain-id", envValue("LINEA_CHAIN_ID", "NEXT_PUBLIC_LINEA_CHAIN_ID") || chainIdForNetwork(network) || "0");
const contractAddress = argValue("contract", envValue("NEXT_PUBLIC_CONTRACT_ADDRESS", "KEEPER_CONTRACT_ADDRESS") || ZERO_ADDRESS);
const tokenAddress = argValue("token", envValue("NEXT_PUBLIC_LINEA_TOKEN_ADDRESS", "LINEA_TOKEN_ADDRESS") || ZERO_ADDRESS);
const deployBlock = argValue("deploy-block", envValue("NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK", "INDEXER_START_BLOCK") || "0");
const publicContract = envValue("NEXT_PUBLIC_CONTRACT_ADDRESS");
const keeperContract = envValue("KEEPER_CONTRACT_ADDRESS");
const publicDeployBlock = envValue("NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK");
const indexerStartBlock = envValue("INDEXER_START_BLOCK");
const finalityBlocks = envValue("INDEXER_FINALITY_BLOCKS");
const requestedEpochs = Number(epochs);

const manifest = {
  ...baseCollectorMeta("signoff"),
  requestedEpochs,
  user,
  contractEnv: {
    network,
    chainId,
    contractAddress,
    tokenAddress,
    publicContractAddress: publicContract || ZERO_ADDRESS,
    keeperContractAddress: keeperContract || ZERO_ADDRESS,
    deployBlock,
    publicDeployBlock: publicDeployBlock || "0",
    indexerStartBlock: indexerStartBlock || "0",
    finalityBlocks: finalityBlocks || "0",
    keeperMatchesPublic: Boolean(publicContract && keeperContract && publicContract.toLowerCase() === keeperContract.toLowerCase()),
    indexerStartBlockMatchesDeployBlock: Boolean(indexerStartBlock && deployBlock && indexerStartBlock === deployBlock),
    finalityBlocksPositive: isPositiveIntegerString(finalityBlocks),
    command: "npm.cmd run proof:mainnet -- --strict",
    evidence: envSummary,
    checkedAt: now,
  },
  ownership: {
    ownerAddress: argValue("owner", ZERO_ADDRESS),
    safeOrMultisig: false,
    directOwnerReadMatches: false,
    directOwnerReadEvidence: "TODO: direct owner() chain read result and command/output link",
    proofTx: ZERO_TX,
    governanceRecordEvidence: "TODO: Safe/multisig owner tx or governance record",
    evidence: "TODO: direct owner read and Safe/multisig proof",
    checkedAt: now,
  },
  randomness: {
    decision: "TODO",
    riskAcceptedByOperator: false,
    mitigationDeployed: false,
    operator: "TODO: operator or signer handle",
    signedAt: "TODO: ISO timestamp",
    evidence: "TODO: explicit randomness risk acceptance or mitigation proof",
  },
  chainComparison: Object.fromEntries(CHAIN_CHECKS.map((check) => [check, comparisonDraft(check, user, requestedEpochs, now, chainSummary)])),
  requiredManualEvidence: [
    "paste final contract/env addresses and deploy/finality proof from proof:mainnet",
    "paste owner Safe/multisig direct chain read and governance evidence from proof:chain or block explorer",
    "paste explicit randomness model operator sign-off",
    "paste jackpot/Safety Pool/deposits/rewards/rebates/resolve direct chain versus app/indexer comparison evidence",
  ],
};

if (hasFlag("print-plan")) {
  printPlan("Signoff Evidence Collection Plan", manifest);
} else {
  const written = writeJson(out, manifest);
  console.log(`Signoff evidence draft written: ${written}`);
  console.log("Review TODO/false fields before promoting to docs/signoff-proof.json and running npm.cmd run proof:signoff -- --strict.");
}

