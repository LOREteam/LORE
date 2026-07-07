import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function refuseFinalProofOutput(outPath) {
  const normalized = path.relative(process.cwd(), outPath).replace(/\\/g, "/");
  if (normalized === "docs/signoff-proof.json") {
    throw new Error("Proof draft generator writes incomplete drafts only; use --out=docs/signoff-proof.draft.json, then promote to docs/signoff-proof.json only after real contract/env, Safe/multisig owner, randomness, and chain comparison evidence passes strict validation");
  }
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_TX = "0x0000000000000000000000000000000000000000000000000000000000000000";
const CHAIN_CHECKS = ["jackpot", "safetyPool", "deposits", "rewards", "rebates", "resolve"];

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : process.env[name.toUpperCase().replaceAll("-", "_")] || fallback;
}

function envValue(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

function isPositiveInteger(value) {
  const parsed = Number(String(value ?? "").trim());
  return Number.isSafeInteger(parsed) && parsed > 0;
}

function normalizeNetwork(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["main", "linea", "prod", "production"].includes(normalized)) return "mainnet";
  if (["testnet", "linea-sepolia", "sepolia-testnet"].includes(normalized)) return "sepolia";
  return normalized;
}

function chainIdForNetwork(value) {
  const network = normalizeNetwork(value);
  if (network === "mainnet") return "59144";
  if (network === "sepolia") return "59141";
  return "";
}

function readOptionalLog(filePath) {
  if (!filePath) return "";
  const resolved = path.resolve(process.cwd(), filePath);
  if (!existsSync(resolved)) {
    throw new Error(`${filePath} does not exist`);
  }
  return readFileSync(resolved, "utf8");
}

function firstMatchingLine(text, pattern) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => pattern.test(line));
}

function summarizeLog(text, fallback) {
  return firstMatchingLine(text, /^Summary:/i) || fallback;
}

function comparisonDraft(label, chainSummary) {
  return {
    matches: false,
    checkedEpochs: [],
    directChainEvidence: chainSummary
      ? `${chainSummary}; TODO: cite exact direct chain rows for ${label}`
      : `TODO: direct chain evidence for ${label}`,
    appOrIndexerEvidence: `TODO: app or indexer evidence for ${label}`,
    checkedAt: "TODO: ISO timestamp",
  };
}

const outPath = path.resolve(process.cwd(), argValue("out", "docs/signoff-proof.draft.json"));
refuseFinalProofOutput(outPath);
const envLog = readOptionalLog(argValue("env-log"));
const chainLog = readOptionalLog(argValue("chain-log"));
const envSummary = summarizeLog(envLog, "TODO: paste redacted proof:mainnet summary for final host env");
const chainSummary = summarizeLog(chainLog, "");
const network = argValue("network", envValue("LINEA_NETWORK", "NEXT_PUBLIC_LINEA_NETWORK") || "TODO: target network");
const chainId = argValue("chain-id", envValue("LINEA_CHAIN_ID", "NEXT_PUBLIC_LINEA_CHAIN_ID") || chainIdForNetwork(network) || "0");
const contractAddress = argValue("contract", envValue("NEXT_PUBLIC_CONTRACT_ADDRESS", "KEEPER_CONTRACT_ADDRESS") || ZERO_ADDRESS);
const tokenAddress = argValue("token", envValue("NEXT_PUBLIC_LINEA_TOKEN_ADDRESS", "LINEA_TOKEN_ADDRESS") || ZERO_ADDRESS);
const deployBlock = argValue("deploy-block", envValue("NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK", "INDEXER_START_BLOCK") || "0");
const indexerStartBlock = envValue("INDEXER_START_BLOCK");
const publicContract = envValue("NEXT_PUBLIC_CONTRACT_ADDRESS");
const keeperContract = envValue("KEEPER_CONTRACT_ADDRESS");
const finalityBlocks = envValue("INDEXER_FINALITY_BLOCKS");
const publicDeployBlock = envValue("NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK");

const manifest = {
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
    finalityBlocksPositive: isPositiveInteger(finalityBlocks),
    command: "npm.cmd run proof:mainnet -- --strict",
    evidence: envSummary,
    checkedAt: envLog ? new Date().toISOString() : "TODO: ISO timestamp",
  },
  ownership: {
    ownerAddress: argValue("owner", ZERO_ADDRESS),
    safeOrMultisig: false,
    directOwnerReadMatches: false,
    directOwnerReadEvidence: "TODO: direct owner() chain read result and command/output link",
    proofTx: ZERO_TX,
    governanceRecordEvidence: "TODO: Safe/multisig owner tx or governance record",
    evidence: "TODO: direct owner read and Safe/multisig proof",
    checkedAt: "TODO: ISO timestamp",
  },
  randomness: {
    decision: "TODO",
    riskAcceptedByOperator: false,
    mitigationDeployed: false,
    operator: "TODO: operator or signer handle",
    signedAt: "TODO: ISO timestamp",
    evidence: "TODO: explicit randomness risk acceptance or mitigation proof",
  },
  chainComparison: Object.fromEntries(CHAIN_CHECKS.map((check) => [check, comparisonDraft(check, chainSummary)])),
};

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Sign-off proof draft written: ${path.relative(process.cwd(), outPath)}`);
console.log("Review TODO fields, add real owner/randomness/chain comparison evidence, then save as docs/signoff-proof.json.");
