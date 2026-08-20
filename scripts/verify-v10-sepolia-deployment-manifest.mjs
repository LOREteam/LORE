import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_MANIFEST_PATH = "config/lineaV10SepoliaDeploymentManifest.json";
const COMPILATION_MANIFEST_PATH = "contracts/LineaOreV10.compilation.json";
const PUBLIC_CONFIG_PATH = "config/publicConfig.ts";
const CONTRACT_ARTIFACT_PATHS = [
  "contracts/LineaOreV10.sol",
  "contracts/LineaOreV10.compilation.json",
  "contracts/LineaOreV10.compiler-config.json",
  "config/generated/lineaOreV10Abi.ts",
];
const EXPECTED_KEYS = [
  "abiSha256", "chainId", "compilationManifestSha256", "contractAddress", "deployBlock",
  "deploymentTransactionHash", "epochBoundBetSelector", "epochBoundBetsRequired",
  "historicalContractAddresses", "network", "normalizedExecutableRuntimeSha256",
  "runtimeBytecodeSha256", "schema", "sourceArtifactGitSha", "sourceSha256",
].sort();
const SHA256_RE = /^[a-f0-9]{64}$/;
const ADDRESS_RE = /^0x[a-f0-9]{40}$/;
const TX_HASH_RE = /^0x[a-f0-9]{64}$/;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readBoundedRegularUtf8(filePath, label, maxBytes = 64 * 1024) {
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) {
    throw new Error(`${label} must be an ordinary bounded file`);
  }
  return readFileSync(filePath, "utf8");
}

export function parseV10SepoliaDeploymentManifest(raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("V10 Sepolia deployment manifest is invalid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("V10 Sepolia deployment manifest must be an object");
  }
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(EXPECTED_KEYS)) {
    throw new Error("V10 Sepolia deployment manifest has an unexpected schema");
  }
  if (value.schema !== 1 || value.network !== "sepolia" || value.chainId !== 59141) {
    throw new Error("V10 Sepolia deployment manifest target is invalid");
  }
  if (!ADDRESS_RE.test(value.contractAddress) || !/^[1-9]\d*$/.test(value.deployBlock)) {
    throw new Error("V10 Sepolia deployment manifest contract identity is invalid");
  }
  if (!TX_HASH_RE.test(value.deploymentTransactionHash) || !/^[a-f0-9]{40}$/.test(value.sourceArtifactGitSha)) {
    throw new Error("V10 Sepolia deployment manifest immutable deployment binding is invalid");
  }
  for (const key of ["compilationManifestSha256", "sourceSha256", "abiSha256", "runtimeBytecodeSha256", "normalizedExecutableRuntimeSha256"]) {
    if (typeof value[key] !== "string" || !SHA256_RE.test(value[key])) {
      throw new Error(`V10 Sepolia deployment manifest ${key} is invalid`);
    }
  }
  if (value.epochBoundBetSelector !== "0xd2815478" || value.epochBoundBetsRequired !== true) {
    throw new Error("V10 Sepolia deployment manifest epoch-bound mode is invalid");
  }
  if (!Array.isArray(value.historicalContractAddresses) || value.historicalContractAddresses.length !== 1
    || !ADDRESS_RE.test(value.historicalContractAddresses[0]) || value.historicalContractAddresses[0] === value.contractAddress) {
    throw new Error("V10 Sepolia deployment manifest historical target is invalid");
  }
  return value;
}

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function verifyV10SepoliaDeploymentManifest({ projectRoot = process.cwd(), manifestPath = DEFAULT_MANIFEST_PATH } = {}) {
  const root = path.resolve(projectRoot);
  const manifestAbsolutePath = path.resolve(root, manifestPath);
  const relativeManifestPath = path.relative(root, manifestAbsolutePath);
  if (relativeManifestPath.startsWith("..") || path.isAbsolute(relativeManifestPath)) {
    throw new Error("V10 Sepolia deployment manifest must remain inside the project root");
  }
  const raw = readBoundedRegularUtf8(manifestAbsolutePath, "V10 Sepolia deployment manifest");
  const manifest = parseV10SepoliaDeploymentManifest(raw);
  const compilationRaw = readBoundedRegularUtf8(path.join(root, COMPILATION_MANIFEST_PATH), "V10 compilation manifest", 512 * 1024);
  const compilation = JSON.parse(compilationRaw);
  for (const key of ["sourceSha256", "abiSha256", "runtimeBytecodeSha256", "normalizedExecutableRuntimeSha256"]) {
    if (compilation[key] !== manifest[key]) throw new Error(`V10 compilation ${key} does not match deployment manifest`);
  }
  if (sha256(compilationRaw) !== manifest.compilationManifestSha256) {
    throw new Error("V10 compilation manifest SHA-256 does not match deployment manifest");
  }
  const publicConfig = readBoundedRegularUtf8(path.join(root, PUBLIC_CONFIG_PATH), "public V10 config", 128 * 1024);
  const deployBlockLiteral = manifest.deployBlock.replace(/\B(?=(\d{3})+(?!\d))/g, "_");
  if (!publicConfig.includes(`"${manifest.contractAddress}" as const`) || !publicConfig.includes(`DEFAULT_INDEXER_START_BLOCK = ${deployBlockLiteral}`)) {
    throw new Error("public Sepolia config does not bind the canonical V10 target and deploy block");
  }
  const verifierGitSha = git(root, ["rev-parse", "HEAD"]);
  git(root, ["rev-parse", "--verify", `${manifest.sourceArtifactGitSha}^{commit}`]);
  try {
    execFileSync("git", ["-C", root, "diff", "--quiet", manifest.sourceArtifactGitSha, "--", ...CONTRACT_ARTIFACT_PATHS], { stdio: "ignore" });
  } catch (error) {
    if (error && error.status === 1) throw new Error("current V10 contract artifacts drifted from the immutable deployment artifact SHA");
    throw error;
  }
  return {
    status: "pass", schema: manifest.schema, network: manifest.network, chainId: manifest.chainId,
    contractAddress: manifest.contractAddress, deployBlock: manifest.deployBlock,
    deploymentTransactionHash: manifest.deploymentTransactionHash, sourceArtifactGitSha: manifest.sourceArtifactGitSha,
    deploymentManifestSha256: sha256(raw), verifierGitSha, compilationManifestSha256: manifest.compilationManifestSha256,
    normalizedExecutableRuntimeSha256: manifest.normalizedExecutableRuntimeSha256,
    epochBoundBetSelector: manifest.epochBoundBetSelector, epochBoundBetsRequired: true,
    historicalTargetsExcluded: true, networkAccess: false, walletAccess: false, transactionSent: false,
  };
}

function main() {
  const result = verifyV10SepoliaDeploymentManifest();
  console.log(JSON.stringify(process.argv.includes("--summary-only") ? result : { ...result, manifestPath: DEFAULT_MANIFEST_PATH }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(JSON.stringify({ status: "fail", error: error instanceof Error ? error.message : String(error), transactionSent: false }));
    process.exitCode = 1;
  }
}
