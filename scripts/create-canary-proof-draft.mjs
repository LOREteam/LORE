import { closeSync, mkdirSync, openSync, readSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveCanaryProofProfile } from "./canary-proof-profile.mjs";

const JSONL_READ_CHUNK_BYTES = 64 * 1024;
const MAX_CANARY_DRAFT_SIDE_ARTIFACT_BYTES = 512 * 1024;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const CANONICAL_POSITIVE_INTEGER_RE = /^[1-9]\d{0,15}$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const GENERIC_RPC_LABEL_RE = /^(?:configured|default|fallback|mainnet|rpc|redacted|target|unlabeled)(?:[-_ ]?rpc(?:[-_ ]?label)?(?:[-_ ]?required)?)?$/i;

function refuseFinalProofOutput(outPath, profile) {
  const normalized = path.relative(process.cwd(), outPath).replace(/\\/g, "/");
  if (["docs/canary-proof.json", "docs/testnet-canary-proof.json"].includes(normalized)) {
    throw new Error(`canary draft generator writes incomplete drafts only; use --out=${profile.draftManifestPath}, then promote to ${profile.manifestPath} only after real ${profile.label} canary evidence and strict validation`);
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
  return parsePositiveInteger(value) !== null;
}

function parsePositiveInteger(value) {
  const text = String(value ?? "").trim();
  if (!CANONICAL_POSITIVE_INTEGER_RE.test(text)) return null;
  const parsed = BigInt(text);
  return parsed <= MAX_SAFE_INTEGER_BIGINT ? Number(parsed) : null;
}

function positiveIntegerString(value) {
  return isPositiveInteger(value) ? String(value).trim() : "";
}

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value ?? "")) && String(value).toLowerCase() !== ZERO_ADDRESS;
}

function normalizeAddress(value) {
  return String(value ?? "").trim().toLowerCase();
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

function normalizeRole(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9_]{1,32}$/.test(normalized) ? normalized : "";
}

function normalizeRoleList(value) {
  const entries = Array.isArray(value) ? value : String(value ?? "").split(",");
  return [...new Set(entries.map(normalizeRole).filter(Boolean))].sort();
}

function regularFileStat(filePath) {
  try {
    const stats = statSync(filePath);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
}

function requireExistingArtifact(name) {
  const value = argValue(name);
  if (!value) {
    throw new Error(`--${name} is required when drafting canary launch evidence`);
  }
  const resolved = path.resolve(process.cwd(), value);
  const stats = regularFileStat(resolved);
  if (!stats) {
    throw new Error(`--${name} must point to an existing redacted artifact`);
  }
  if (stats.size > MAX_CANARY_DRAFT_SIDE_ARTIFACT_BYTES) {
    throw new Error(`--${name} artifact is too large to reference safely`);
  }
  return value;
}

function sameArtifact(left, right) {
  return path.resolve(process.cwd(), left).toLowerCase() === path.resolve(process.cwd(), right).toLowerCase();
}

function requireDistinctArtifactInputs(entries) {
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const [leftName, leftPath] = entries[i];
      const [rightName, rightPath] = entries[j];
      if (!leftPath || !rightPath) continue;
      if (sameArtifact(leftPath, rightPath)) {
        throw new Error(`--${leftName} and --${rightName} must point to distinct canary evidence files`);
      }
    }
  }
}

function isRealTx(value) {
  const text = String(value ?? "").trim();
  return /^0x[a-fA-F0-9]{64}$/.test(text) && text.toLowerCase() !== "0x0000000000000000000000000000000000000000000000000000000000000000";
}

function eventTxHash(event) {
  return event?.txHash ?? event?.hash ?? "";
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readJsonlArtifact(filePath) {
  if (!filePath) return [];
  const events = [];
  const resolvedPath = path.resolve(process.cwd(), filePath);
  const displayPath = path.basename(filePath);
  const fd = openSync(resolvedPath, "r");
  const buffer = Buffer.alloc(JSONL_READ_CHUNK_BYTES);
  let pending = "";
  let lineNumber = 0;
  const parseLine = (line) => {
    lineNumber += 1;
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line.replace(/^\uFEFF/, ""));
      if (!isPlainObject(event)) {
        console.error(`Invalid JSONL at ${displayPath}:${lineNumber}: record must be an object`);
        process.exit(1);
      }
      events.push(event);
    } catch {
      console.error(`Invalid JSONL at ${displayPath}:${lineNumber}: parse error`);
      process.exit(1);
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
  const successfulRoles = normalizeRoleList(okBets.map((event) => event.role));
  return {
    autoMinerRounds: autoMinerBets.length,
    autoMinerUniqueEpochs: uniqueEpochs.size,
    successfulRoles,
    checkedAt: latestIsoTimestamp(okBets),
    rpcLabels,
    txHashes,
  };
}

function findTargetMismatches(events, expectedNetwork, expectedChainId, expectedContractAddress, expectedRpcLabel) {
  const expectedNetworkName = normalizeNetwork(expectedNetwork);
  const expectedChain = positiveIntegerString(expectedChainId);
  const expectedContract = normalizeAddress(expectedContractAddress);
  const expectedRpc = String(expectedRpcLabel ?? "").trim().toLowerCase();
  return events
    .filter((event) => event.ok === true && event.mode !== "epoch-wait")
    .flatMap((event, index) => {
      const label = `event#${index + 1}`;
      const mismatches = [];
      if (expectedNetworkName && normalizeNetwork(event.network) !== expectedNetworkName) mismatches.push(`${label} network=${event.network ?? "missing"}`);
      if (expectedChain && positiveIntegerString(event.chainId) !== expectedChain) mismatches.push(`${label} chainId=${event.chainId ?? "missing"}`);
      if (normalizeAddress(event.contractAddress) !== expectedContract) mismatches.push(`${label} contractAddress=${event.contractAddress ?? "missing"}`);
      if (String(event.rpcLabel ?? "").trim().toLowerCase() !== expectedRpc) mismatches.push(`${label} rpcLabel=${event.rpcLabel ?? "missing"}`);
      return mismatches;
    });
}

const profile = resolveCanaryProofProfile(argValue("profile", process.env.CANARY_PROOF_PROFILE || "launch"));
const requiredRoles = normalizeRoleList(profile.requiredRoles);
const outPath = path.resolve(process.cwd(), argValue("out", profile.draftManifestPath));
refuseFinalProofOutput(outPath, profile);
const network = argValue("network", process.env.NEXT_PUBLIC_LINEA_NETWORK || process.env.LINEA_NETWORK || "");
const chainId = argValue("chain-id", process.env.NEXT_PUBLIC_LINEA_CHAIN_ID || process.env.LINEA_CHAIN_ID || "");
const contractAddress = argValue("contract", process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || process.env.KEEPER_CONTRACT_ADDRESS || "");
const rpcLabel = argValue("rpc-label", "");
const liveLog = requireExistingArtifact("live-log");
const targetArtifact = requireExistingArtifact("target-artifact");
const recoveryArtifact = requireExistingArtifact("recovery-artifact");
const sessionArtifact = requireExistingArtifact("session-artifact");
const txArtifact = requireExistingArtifact("tx-artifact");
requireDistinctArtifactInputs([
  ["target-artifact", targetArtifact],
  ["recovery-artifact", recoveryArtifact],
  ["session-artifact", sessionArtifact],
  ["tx-artifact", txArtifact],
]);
const liveEvents = readJsonlArtifact(liveLog);
const summary = canarySummary(liveEvents);
const now = new Date().toISOString();

if (summary.autoMinerRounds <= 0) {
  throw new Error("--live-log must include at least one successful auto-miner canary tx");
}
if (summary.txHashes.length === 0) {
  throw new Error("--live-log must include at least one real successful tx hash");
}

if (!hasRealText(network)) {
  throw new Error("--network must identify the target network");
}
if (normalizeNetwork(network) !== profile.network) {
  throw new Error(`--network must be ${profile.network} for ${profile.label} canary proof`);
}
if (!isPositiveInteger(chainId)) {
  throw new Error("--chain-id must be a canonical positive decimal integer");
}
const parsedChainId = parsePositiveInteger(chainId);
if (parsedChainId === null) {
  throw new Error("--chain-id must be a safe canonical positive decimal integer");
}
if (positiveIntegerString(chainId) !== String(profile.chainId)) {
  throw new Error(`--chain-id must be ${profile.chainId} for ${profile.label} canary proof`);
}
if (!isAddress(contractAddress)) {
  throw new Error("--contract must be a non-zero EVM address");
}
if (!hasConcreteRpcLabel(rpcLabel)) {
  throw new Error("--rpc-label must be a concrete redacted RPC label, not a raw URL or generic placeholder");
}
const targetMismatches = findTargetMismatches(liveEvents, network, chainId, contractAddress, rpcLabel);
if (targetMismatches.length > 0) {
  throw new Error(`--live-log target metadata must match --network, --chain-id, --contract, and --rpc-label (${targetMismatches.slice(0, 3).join("; ")})`);
}

const pendingEvidence = {
  status: "TODO: replace with verified or pass after real canary run",
  checkedAt: "TODO: ISO timestamp",
  evidence: recoveryArtifact ? `artifact: ${recoveryArtifact}` : "TODO: link or redacted artifact from canary run",
};

const manifest = {
  targetNetwork: {
    realTargetNetwork: true,
    network,
    chainId: parsedChainId,
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
    status: "TODO: replace with verified or pass after real canary run",
    targetRpcConfirmed: summary.rpcLabels.length > 0 && summary.rpcLabels.every((label) => label.toLowerCase() === rpcLabel.toLowerCase()),
    observedRpcLabels: summary.rpcLabels,
    rounds: summary.autoMinerRounds,
    uniqueEpochs: summary.autoMinerUniqueEpochs,
    requiredRoles,
    successfulRoles: summary.successfulRoles,
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
console.log(`Review TODO fields, run real canary epochs, then save as ${profile.manifestPath}.`);
