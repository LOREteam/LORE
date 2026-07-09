import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const strict = process.argv.includes("--strict") || process.env.PROOF_STRICT === "1";
const args = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--") && arg.includes("="))
    .map((arg) => {
      const [key, ...rest] = arg.slice(2).split("=");
      return [key, rest.join("=")];
    }),
);

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const TX_RE = /^0x[a-fA-F0-9]{64}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_TX = "0x0000000000000000000000000000000000000000000000000000000000000000";
const TEMPLATE_VALUE_RE = /REPLACE_|<REDACTED>|TODO|TBD/i;
const secretKeyPattern = /(secret|private[_-]?key|mnemonic|webhook|dsn|api[_-]?key|api[_-]?token|auth[_-]?token|access[_-]?token|bearer|session|cookie)/i;
const chainReadChecks = ["jackpot", "safetyPool", "deposits", "rewards", "rebates", "resolve"];
const knownChainIds = new Map([
  ["mainnet", 59144],
  ["sepolia", 59141],
]);

function env(name) {
  return process.env[name]?.trim() || "";
}

function argOrEnv(argName, envName, fallback) {
  return args.get(argName)?.trim() || env(envName) || fallback;
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

function isPositiveIntegerString(value) {
  return typeof value === "string" && /^[1-9]\d*$/.test(value);
}

function parsePositiveInteger(value) {
  const normalized = String(value ?? "").trim();
  if (!/^[1-9]\d*$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function nonEmptyEpochList(value) {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((entry) => {
    if (typeof entry === "number") return Number.isSafeInteger(entry) && entry >= 0;
    return typeof entry === "string" && /^\d+$/.test(entry.trim());
  });
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

function normalizeNetwork(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["main", "linea", "prod", "production"].includes(normalized)) return "mainnet";
  if (["testnet", "linea-sepolia", "sepolia-testnet"].includes(normalized)) return "sepolia";
  return normalized;
}

function isRealAddress(value) {
  const normalized = String(value ?? "");
  return ADDRESS_RE.test(normalized) && normalized.toLowerCase() !== ZERO_ADDRESS;
}

function isRealTx(value) {
  const normalized = String(value ?? "");
  return TX_RE.test(normalized) && normalized.toLowerCase() !== ZERO_TX;
}

function normalizedAddress(value) {
  return String(value ?? "").trim().toLowerCase();
}

function sameAddress(left, right) {
  return normalizedAddress(left) === normalizedAddress(right);
}

function requireEnvMatch(section, key, envName) {
  const expected = env(envName);
  if (!expected) return;
  const actual = String(section[key] ?? "").trim();
  if (!actual) {
    issues.push(`contractEnv.${key} is missing while ${envName} is configured`);
    return;
  }
  if (actual !== expected) issues.push(`contractEnv.${key} does not match ${envName}`);
}

function requireEnvAddressMatch(section, key, envName) {
  const expected = env(envName);
  if (!expected) return;
  const actual = section[key];
  if (!isRealAddress(actual)) {
    issues.push(`contractEnv.${key} is missing, zero, or invalid while ${envName} is configured`);
    return;
  }
  if (!sameAddress(actual, expected)) issues.push(`contractEnv.${key} does not match ${envName}`);
}

function requireEnvNetworkMatch(section, key, envName) {
  const expected = env(envName);
  if (!expected) return;
  const actual = String(section[key] ?? "").trim();
  if (!actual) {
    issues.push(`contractEnv.${key} is missing while ${envName} is configured`);
    return;
  }
  if (normalizeNetwork(actual) !== normalizeNetwork(expected)) {
    issues.push(`contractEnv.${key} does not match ${envName}`);
  }
}

function hasEvidence(value) {
  if (!isPlainObject(value)) return false;
  return [
    value.evidence,
    value.evidencePath,
    value.link,
    value.txHash,
    value.proofTx,
    value.directOwnerReadEvidence,
    value.governanceRecordEvidence,
    value.directChainEvidence,
    value.appOrIndexerEvidence,
    value.notes,
    value.artifact,
    value.commandOutputPath,
    value.reportPath,
  ].some(hasRealText);
}

function hasConcreteText(value) {
  if (!hasRealText(value)) return false;
  const text = String(value).trim();
  return /https?:\/\//i.test(text) ||
    /(?:^|[\\/\s])[^\s]+\.(?:json|jsonl|log|md|txt|csv)(?:\b|$)/i.test(text) ||
    /\bnpm(?:\.cmd)?\s+run\b/i.test(text) ||
    /\bproof:[a-z0-9:-]+\b/i.test(text) ||
    /0x[a-fA-F0-9]{40,64}/.test(text);
}

function hasConcreteEvidence(value) {
  if (!isPlainObject(value)) return false;
  if (isRealTx(value.txHash) || isRealTx(value.proofTx)) return true;
  return [
    value.evidencePath,
    value.link,
    value.artifact,
    value.commandOutputPath,
    value.reportPath,
    value.directOwnerReadEvidence,
    value.governanceRecordEvidence,
    value.directChainEvidence,
    value.appOrIndexerEvidence,
    value.evidence,
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
  const keySuggestsPath = /(?:evidencePath|artifact|link|commandOutputPath|reportPath|directOwnerReadEvidence|governanceRecordEvidence|directChainEvidence|appOrIndexerEvidence)$/i.test(key);
  const valueLooksLikePath = /(?:^|[\\/\s])[^\s]+\.(?:json|jsonl|log|md|txt|csv)(?:\b|$)/i.test(candidate);
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

function localArtifactContentFromText(value, key = "") {
  const artifactPath = localArtifactPathFromText(value, key);
  if (!artifactPath) return "";
  try {
    return readFileSync(resolve(process.cwd(), artifactPath), "utf8").slice(0, 256 * 1024);
  } catch {
    return "";
  }
}

function evidenceContentText(value, key = "") {
  if (typeof value === "string") {
    const artifactPath = localArtifactPathFromText(value, key);
    const inline = artifactPath ? value.replace(/^artifact:\s*\S+/i, "").trim() : value;
    return [inline, localArtifactContentFromText(value, key)].filter(Boolean).join("\n");
  }
  if (Array.isArray(value)) {
    return value.map((entry) => evidenceContentText(entry, key)).filter(Boolean).join("\n");
  }
  if (!isPlainObject(value)) return "";
  return Object.entries(value).map(([childKey, entry]) => evidenceContentText(entry, childKey)).filter(Boolean).join("\n");
}

function evidenceMentions(value, pattern) {
  return pattern.test(evidenceContentText(value));
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

function printTable(headers, rows) {
  console.log(`| ${headers.join(" | ")} |`);
  console.log(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}

const manifestPath = resolve(process.cwd(), argOrEnv("file", "SIGNOFF_PROOF_PATH", "docs/signoff-proof.json"));
const issues = [];
let manifest = null;

console.log("# Contract / Funds Sign-Off Proof Summary");
console.log("");
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log(`Strict: ${strict ? "yes" : "no"}`);
console.log(`Manifest: ${manifestPath}`);
console.log("");

if (strict && /\.draft\.json$/i.test(manifestPath)) {
  issues.push("draft proof manifests are not accepted as launch proof");
}

if (!existsSync(manifestPath)) {
  issues.push("sign-off proof manifest is missing");
} else {
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    issues.push(`sign-off proof manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (manifest) {
  if (!isPlainObject(manifest)) {
    issues.push("sign-off proof manifest must be an object");
  } else {
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
      issues.push(`local signoff artifact references must exist: ${missingArtifactRefs.slice(0, 5).join(", ")}`);
    }
    const contractEnv = isPlainObject(manifest.contractEnv) ? manifest.contractEnv : {};
    if (!isPlainObject(manifest.contractEnv)) issues.push("contractEnv section is missing");
    const contractNetwork = normalizeNetwork(contractEnv.network);
    const contractChainId = parsePositiveInteger(contractEnv.chainId);
    if (!hasRealText(contractEnv.network)) issues.push("contractEnv.network is missing");
    if (contractChainId == null) issues.push("contractEnv.chainId is missing or invalid");
    if (contractNetwork !== "mainnet") {
      issues.push("contractEnv.network must be mainnet for launch sign-off proof");
    }
    if (contractChainId !== 59144) {
      issues.push("contractEnv.chainId must be 59144 for Linea mainnet launch proof");
    }
    if (knownChainIds.has(contractNetwork) && contractChainId !== knownChainIds.get(contractNetwork)) {
      issues.push("contractEnv.chainId must match contractEnv.network");
    }
    if (!isRealAddress(contractEnv.contractAddress)) issues.push("contractEnv.contractAddress is missing, zero, or invalid");
    if (!isRealAddress(contractEnv.tokenAddress)) issues.push("contractEnv.tokenAddress is missing, zero, or invalid");
    if (!isRealAddress(contractEnv.publicContractAddress)) {
      issues.push("contractEnv.publicContractAddress is missing, zero, or invalid");
    }
    if (!isRealAddress(contractEnv.keeperContractAddress)) {
      issues.push("contractEnv.keeperContractAddress is missing, zero, or invalid");
    }
    if (!isPositiveIntegerString(String(contractEnv.deployBlock ?? ""))) issues.push("contractEnv.deployBlock is missing or invalid");
    if (!isPositiveIntegerString(String(contractEnv.publicDeployBlock ?? ""))) {
      issues.push("contractEnv.publicDeployBlock is missing or invalid");
    }
    if (!isPositiveIntegerString(String(contractEnv.indexerStartBlock ?? ""))) {
      issues.push("contractEnv.indexerStartBlock is missing or invalid");
    }
    if (!isPositiveIntegerString(String(contractEnv.finalityBlocks ?? ""))) {
      issues.push("contractEnv.finalityBlocks is missing or invalid");
    }
    if (
      isRealAddress(contractEnv.contractAddress) &&
      isRealAddress(contractEnv.publicContractAddress) &&
      !sameAddress(contractEnv.contractAddress, contractEnv.publicContractAddress)
    ) {
      issues.push("contractEnv.contractAddress must match contractEnv.publicContractAddress");
    }
    if (
      isRealAddress(contractEnv.contractAddress) &&
      isRealAddress(contractEnv.keeperContractAddress) &&
      !sameAddress(contractEnv.contractAddress, contractEnv.keeperContractAddress)
    ) {
      issues.push("contractEnv.contractAddress must match contractEnv.keeperContractAddress");
    }
    if (
      isPositiveIntegerString(String(contractEnv.deployBlock ?? "")) &&
      String(contractEnv.deployBlock) !== String(contractEnv.publicDeployBlock)
    ) {
      issues.push("contractEnv.deployBlock must match contractEnv.publicDeployBlock");
    }
    if (
      isPositiveIntegerString(String(contractEnv.deployBlock ?? "")) &&
      String(contractEnv.deployBlock) !== String(contractEnv.indexerStartBlock)
    ) {
      issues.push("contractEnv.deployBlock must match contractEnv.indexerStartBlock");
    }
    requireEnvAddressMatch(contractEnv, "contractAddress", "NEXT_PUBLIC_CONTRACT_ADDRESS");
    requireEnvAddressMatch(contractEnv, "publicContractAddress", "NEXT_PUBLIC_CONTRACT_ADDRESS");
    requireEnvAddressMatch(contractEnv, "keeperContractAddress", "KEEPER_CONTRACT_ADDRESS");
    requireEnvAddressMatch(contractEnv, "tokenAddress", "NEXT_PUBLIC_LINEA_TOKEN_ADDRESS");
    requireEnvNetworkMatch(contractEnv, "network", "LINEA_NETWORK");
    requireEnvNetworkMatch(contractEnv, "network", "NEXT_PUBLIC_LINEA_NETWORK");
    requireEnvMatch(contractEnv, "chainId", "LINEA_CHAIN_ID");
    requireEnvMatch(contractEnv, "chainId", "NEXT_PUBLIC_LINEA_CHAIN_ID");
    requireEnvMatch(contractEnv, "deployBlock", "NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK");
    requireEnvMatch(contractEnv, "publicDeployBlock", "NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK");
    requireEnvMatch(contractEnv, "indexerStartBlock", "INDEXER_START_BLOCK");
    requireEnvMatch(contractEnv, "finalityBlocks", "INDEXER_FINALITY_BLOCKS");
    if (contractEnv.keeperMatchesPublic !== true) issues.push("contractEnv.keeperMatchesPublic must be true");
    if (contractEnv.indexerStartBlockMatchesDeployBlock !== true) issues.push("contractEnv.indexerStartBlockMatchesDeployBlock must be true");
    if (contractEnv.finalityBlocksPositive !== true) issues.push("contractEnv.finalityBlocksPositive must be true");
    if (!hasIsoTimestamp(contractEnv.checkedAt)) issues.push("contractEnv.checkedAt must be ISO-8601 UTC");
    if (!hasEvidence(contractEnv)) issues.push("contractEnv has no evidence");
    if (hasEvidence(contractEnv) && !hasConcreteEvidence(contractEnv)) {
      issues.push("contractEnv must include concrete evidence path, link, artifact, command output, proof command, or address/tx marker");
    }
    if (hasConcreteEvidence(contractEnv) && !evidenceMentions(contractEnv, /\b(?:proof:mainnet|env gates?|contract|deploy|chainId|LINEA_CHAIN_ID|NEXT_PUBLIC_CONTRACT_ADDRESS)\b/i)) {
      issues.push("contractEnv evidence must mention proof:mainnet, env, contract, deploy, or chainId proof");
    }

    const ownership = isPlainObject(manifest.ownership) ? manifest.ownership : {};
    if (!isPlainObject(manifest.ownership)) issues.push("ownership section is missing");
    if (!isRealAddress(ownership.ownerAddress)) issues.push("ownership.ownerAddress is missing, zero, or invalid");
    if (ownership.safeOrMultisig !== true) issues.push("ownership.safeOrMultisig must be true");
    if (ownership.directOwnerReadMatches !== true) issues.push("ownership.directOwnerReadMatches must be true");
    if (!hasRealText(ownership.directOwnerReadEvidence)) {
      issues.push("ownership.directOwnerReadEvidence is missing");
    }
    if (hasText(ownership.proofTx) && !isRealTx(ownership.proofTx)) issues.push("ownership.proofTx is zero or not a tx hash");
    if (!isRealTx(ownership.proofTx) && !hasRealText(ownership.governanceRecordEvidence)) {
      issues.push("ownership must include proofTx or governanceRecordEvidence");
    }
    if (!hasIsoTimestamp(ownership.checkedAt)) issues.push("ownership.checkedAt must be ISO-8601 UTC");
    if (!hasEvidence(ownership)) issues.push("ownership has no evidence");
    if (hasEvidence(ownership) && !hasConcreteEvidence(ownership)) {
      issues.push("ownership must include concrete direct owner read or Safe/multisig evidence");
    }
    if (hasRealText(ownership.directOwnerReadEvidence) && !evidenceMentions(ownership.directOwnerReadEvidence, /\b(?:owner|safe|multisig|direct[-\s]?owner|direct[-\s]?chain|governance)\b/i)) {
      issues.push("ownership.directOwnerReadEvidence evidence must mention owner, Safe/multisig, governance, or direct-chain proof");
    }

    const randomness = isPlainObject(manifest.randomness) ? manifest.randomness : {};
    if (!isPlainObject(manifest.randomness)) issues.push("randomness section is missing");
    if (!["accepted-risk", "mitigated"].includes(String(randomness.decision ?? ""))) {
      issues.push("randomness.decision must be accepted-risk or mitigated");
    }
    if (!hasRealText(randomness.operator) && !hasRealText(randomness.signer)) {
      issues.push("randomness operator/signer is missing");
    }
    if (!hasIsoTimestamp(randomness.signedAt)) issues.push("randomness.signedAt must be ISO-8601 UTC");
    if (randomness.decision === "accepted-risk" && randomness.riskAcceptedByOperator !== true) {
      issues.push("randomness.riskAcceptedByOperator must be true when decision is accepted-risk");
    }
    if (randomness.decision === "mitigated" && randomness.mitigationDeployed !== true) {
      issues.push("randomness.mitigationDeployed must be true when decision is mitigated");
    }
    if (!hasEvidence(randomness)) issues.push("randomness has no evidence");
    if (hasEvidence(randomness) && !hasConcreteEvidence(randomness)) {
      issues.push("randomness must include concrete sign-off link, artifact, command output, or tx marker");
    }
    const randomnessEvidence = {
      evidence: randomness.evidence,
      evidencePath: randomness.evidencePath,
      link: randomness.link,
      artifact: randomness.artifact,
      commandOutputPath: randomness.commandOutputPath,
      reportPath: randomness.reportPath,
      notes: randomness.notes,
    };
    if (hasConcreteEvidence(randomness) && !evidenceMentions(randomnessEvidence, /\b(?:randomness|decision|sign[-\s]?off|accepted[-\s]?risk|mitigated|mitigation)\b/i)) {
      issues.push("randomness evidence must mention randomness decision or operator sign-off proof");
    }

    const chainComparison = isPlainObject(manifest.chainComparison) ? manifest.chainComparison : {};
    if (!isPlainObject(manifest.chainComparison)) issues.push("chainComparison section is missing");
    for (const check of chainReadChecks) {
      const value = chainComparison[check];
      if (!isPlainObject(value)) {
        issues.push(`chainComparison.${check} is missing`);
        continue;
      }
      if (value.matches !== true) issues.push(`chainComparison.${check}.matches must be true`);
      if (!hasRealText(value.directChainEvidence)) issues.push(`chainComparison.${check}.directChainEvidence is missing`);
      if (!hasRealText(value.appOrIndexerEvidence)) issues.push(`chainComparison.${check}.appOrIndexerEvidence is missing`);
      if (!nonEmptyEpochList(value.checkedEpochs)) {
        issues.push(`chainComparison.${check}.checkedEpochs must include at least one checked epoch`);
      }
      if (!hasIsoTimestamp(value.checkedAt)) {
        issues.push(`chainComparison.${check}.checkedAt must be ISO-8601 UTC`);
      }
      if (!hasEvidence(value)) issues.push(`chainComparison.${check} has no evidence`);
      if (hasEvidence(value) && !hasConcreteEvidence(value)) {
        issues.push(`chainComparison.${check} must include concrete direct-chain/app-indexer evidence path, link, command output, proof command, or address/tx marker`);
      }
      const chainEvidencePattern = new RegExp(`\\b(?:${check}|direct[-\\s]?chain|app|indexer|chain comparison|proof:chain)\\b`, "i");
      if (hasConcreteEvidence(value) && !evidenceMentions(value, chainEvidencePattern)) {
        issues.push(`chainComparison.${check} evidence must mention ${check}, direct-chain, app, or indexer proof`);
      }
    }

    printTable(["Section", "Status"], [
      ["contractEnv", issues.some((issue) => issue.startsWith("contractEnv")) ? "issue" : "checked"],
      ["ownership", issues.some((issue) => issue.startsWith("ownership")) ? "issue" : "checked"],
      ["randomness", issues.some((issue) => issue.startsWith("randomness")) ? "issue" : "checked"],
      ["chainComparison", issues.some((issue) => issue.startsWith("chainComparison")) ? "issue" : "checked"],
    ]);
  }
}

console.log("");
console.log(`Summary: ${issues.length === 0 ? "contract/funds sign-off proof completed without detected issues" : `${issues.length} issue(s): ${issues.join("; ")}`}.`);
console.log("Copy this summary into `docs/mainnet-proof-record.md` only after confirming the manifest reflects real operator sign-offs and chain/API comparison evidence.");

if (strict && issues.length > 0) {
  process.exitCode = 1;
}
