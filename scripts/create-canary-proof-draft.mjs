import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const GENERIC_RPC_LABEL_RE = /^(?:configured|default|fallback|mainnet|rpc|redacted|target|unlabeled)(?:[-_ ]?rpc(?:[-_ ]?label)?(?:[-_ ]?required)?)?$/i;

function refuseFinalProofOutput(outPath) {
  const normalized = path.relative(process.cwd(), outPath).replace(/\\/g, "/");
  if (normalized === "docs/canary-proof.json") {
    throw new Error("canary draft generator writes incomplete drafts only; use --out=docs/canary-proof.draft.json, then promote to docs/canary-proof.json only after real canary evidence and strict validation");
  }
}
function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : fallback;
}

function hasRealText(value) {
  const text = String(value ?? "").trim();
  return Boolean(text) && !/^todo\b/i.test(text);
}

function isPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0;
}

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value ?? "")) && String(value).toLowerCase() !== ZERO_ADDRESS;
}

function looksLikeUrl(value) {
  return /^https?:\/\//i.test(String(value ?? "").trim());
}

function hasConcreteRpcLabel(value) {
  const text = String(value ?? "").trim();
  return hasRealText(text) && !looksLikeUrl(text) && !GENERIC_RPC_LABEL_RE.test(text);
}

function normalizeNetwork(value) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "-");
  if (["main", "linea", "prod", "production", "linea-mainnet"].includes(normalized)) return "mainnet";
  if (["testnet", "linea-sepolia", "sepolia-testnet"].includes(normalized)) return "sepolia";
  return normalized;
}

function optionalExistingArtifact(name) {
  const value = argValue(name);
  if (!value) return "";
  const resolved = path.resolve(process.cwd(), value);
  if (!existsSync(resolved)) {
    throw new Error(`--${name} must point to an existing redacted artifact`);
  }
  return value;
}

function isRealTx(value) {
  const text = String(value ?? "").trim();
  return /^0x[a-fA-F0-9]{64}$/.test(text) && text.toLowerCase() !== "0x0000000000000000000000000000000000000000000000000000000000000000";
}

function eventTxHash(event) {
  return event?.txHash ?? event?.hash ?? "";
}

function readJsonlArtifact(filePath) {
  if (!filePath) return [];
  return readFileSync(path.resolve(process.cwd(), filePath), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at ${filePath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}

function latestIsoTimestamp(events) {
  const latest = events
    .map((event) => Date.parse(event.timestamp))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
    .at(-1);
  return latest == null ? "TODO: ISO timestamp" : new Date(latest).toISOString();
}

function canarySummary(events) {
  const okBets = events.filter((event) => Number.isInteger(event.round) && event.round >= 0 && event.ok === true && event.txStatus === "success");
  const autoMinerBets = okBets.filter((event) => String(event.role ?? "").toUpperCase().includes("AUTOMINER"));
  const uniqueEpochs = new Set(autoMinerBets.map((event) => event.epoch).filter(Boolean));
  const txHashes = [...new Set(okBets.map(eventTxHash).filter(isRealTx).map((hash) => hash.toLowerCase()))];
  const rpcLabels = [...new Set(okBets.map((event) => String(event.rpcLabel ?? "").trim()).filter(Boolean))].sort();
  return {
    autoMinerRounds: autoMinerBets.length,
    autoMinerUniqueEpochs: uniqueEpochs.size,
    checkedAt: latestIsoTimestamp(okBets),
    rpcLabels,
    txHashes,
  };
}

const outPath = path.resolve(process.cwd(), argValue("out", "docs/canary-proof.draft.json"));
refuseFinalProofOutput(outPath);
const network = argValue("network", process.env.NEXT_PUBLIC_LINEA_NETWORK || process.env.LINEA_NETWORK || "");
const chainId = argValue("chain-id", process.env.NEXT_PUBLIC_LINEA_CHAIN_ID || process.env.LINEA_CHAIN_ID || "");
const contractAddress = argValue("contract", process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || process.env.KEEPER_CONTRACT_ADDRESS || "");
const rpcLabel = argValue("rpc-label", "");
const liveLog = optionalExistingArtifact("live-log");
if (!liveLog) {
  throw new Error("--live-log must point to an existing live canary JSONL artifact");
}
const targetArtifact = optionalExistingArtifact("target-artifact");
const recoveryArtifact = optionalExistingArtifact("recovery-artifact");
const sessionArtifact = optionalExistingArtifact("session-artifact");
const txArtifact = optionalExistingArtifact("tx-artifact");
const liveEvents = readJsonlArtifact(liveLog);
const summary = canarySummary(liveEvents);
const now = new Date().toISOString();

if (!hasRealText(network)) {
  throw new Error("--network must identify the target network");
}
if (normalizeNetwork(network) !== "mainnet") {
  throw new Error("--network must be mainnet for launch canary proof");
}
if (!isPositiveInteger(chainId)) {
  throw new Error("--chain-id must be a positive integer");
}
if (Number(chainId) !== 59144) {
  throw new Error("--chain-id must be 59144 for Linea mainnet launch proof");
}
if (!isAddress(contractAddress)) {
  throw new Error("--contract must be a non-zero EVM address");
}
if (!hasConcreteRpcLabel(rpcLabel)) {
  throw new Error("--rpc-label must be a concrete redacted RPC label, not a raw URL or generic placeholder");
}

const pendingEvidence = {
  status: "TODO: verified/pass after real canary run",
  checkedAt: "TODO: ISO timestamp",
  evidence: recoveryArtifact ? `artifact: ${recoveryArtifact}` : "TODO: link or redacted artifact from canary run",
};

const manifest = {
  targetNetwork: {
    realTargetNetwork: true,
    network,
    chainId: Number(chainId),
    rpc: rpcLabel,
    contractAddress,
    checkedAt: now,
    evidence: targetArtifact ? `artifact: ${targetArtifact}` : liveLog ? `artifact: ${liveLog}` : "TODO: redacted env/RPC/chain-id verification artifact",
  },
  recovery: {
    reload: { ...pendingEvidence },
    reconnect: { ...pendingEvidence },
    tabCloseRestore: { ...pendingEvidence },
    pendingTxRecovery: {
      ...pendingEvidence,
      txHash: "TODO: real non-zero pending recovery tx hash",
    },
    routeSwitchOrRemount: { ...pendingEvidence },
  },
  autoMinerSession: {
    status: "TODO: verified/pass after real canary run",
    targetRpcConfirmed: summary.rpcLabels.length > 0 && summary.rpcLabels.every((label) => label.toLowerCase() === rpcLabel.toLowerCase()),
    observedRpcLabels: summary.rpcLabels,
    rounds: summary.autoMinerRounds,
    uniqueEpochs: summary.autoMinerUniqueEpochs,
    checkedAt: summary.checkedAt,
    evidence: sessionArtifact ? `artifact: ${sessionArtifact}` : liveLog ? `artifact: ${liveLog}` : "TODO: link to canary log summary",
  },
  transactionHealth: {
    noDuplicateBets: false,
    noNonceLoops: false,
    noStuckPending: false,
    pendingRecoveryConverged: false,
    txHashes: summary.txHashes,
    checkedAt: summary.checkedAt,
    evidence: txArtifact ? `artifact: ${txArtifact}` : liveLog ? `artifact: ${liveLog}` : "TODO: tx hash list and duplicate/nonce scan evidence",
  },
};

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Canary proof draft written: ${path.relative(process.cwd(), outPath)}`);
console.log("Review TODO fields, run real canary epochs, then save as docs/canary-proof.json.");
