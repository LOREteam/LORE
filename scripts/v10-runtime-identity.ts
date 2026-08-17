import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";

import { getAddress, type Address, type Hex } from "viem";

import { MAX_V10_COMPILATION_MANIFEST_BYTES, readBoundedV10Utf8File } from "./v10DeployedInputPolicy";

const COMPILATION_MANIFEST_PATH = "contracts/LineaOreV10.compilation.json";
const SHA256_RE = /^[0-9a-f]{64}$/;

export type V10RuntimeIdentityManifest = {
  compilerVersion: string;
  executableRuntimeBytes: number;
  normalizedExecutableRuntimeSha256: string;
  runtimeBytecodeSha256: string;
  runtimeBytecodeBytes: number;
  runtimeImmutableReferences: Array<{ length: number; start: number }>;
  sourceSha256: string;
};

export type V10RuntimeIdentityReader = {
  getBlock: (parameters: { blockNumber: bigint }) => Promise<{ hash: Hex | null; number: bigint | null }>;
  getBytecode: (parameters: { address: Address; blockNumber?: bigint }) => Promise<Hex | undefined>;
  getChainId: () => Promise<number>;
};

export type V10RuntimeIdentity = {
  canonicalProvenanceVerified: true;
  chainId: number;
  contractAddress: Address;
  deployBlock: string;
  executableBytes: number;
  executableRuntimeBytes: number;
  immutableReferences: number;
  manifestMatched: true;
  manifestDigest: string;
  normalizedRuntimeSha256: string;
  observedBlock: string;
  observedBlockHash: Hex;
};

export type V10CanonicalProvenanceVerifier = (
  snapshot: V10RuntimeIdentityManifestSnapshot,
) => Promise<void>;

export type V10RuntimeIdentityManifestSnapshot = {
  manifest: V10RuntimeIdentityManifest;
  manifestDigest: string;
  manifestFileIdentity?: string;
};

function fail(message: string): never {
  throw new Error(`V10 runtime identity preflight: ${message}`);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalManifestDigest(manifest: V10RuntimeIdentityManifest) {
  return sha256(JSON.stringify({
    compilerVersion: manifest.compilerVersion,
    executableRuntimeBytes: manifest.executableRuntimeBytes,
    normalizedExecutableRuntimeSha256: manifest.normalizedExecutableRuntimeSha256,
    runtimeBytecodeSha256: manifest.runtimeBytecodeSha256,
    runtimeBytecodeBytes: manifest.runtimeBytecodeBytes,
    runtimeImmutableReferences: manifest.runtimeImmutableReferences,
    sourceSha256: manifest.sourceSha256,
  }));
}

function parseLastJsonObject(output: string) {
  const lines = output.trim().split(/\r?\n/).filter(Boolean);
  const lastLine = lines.at(-1);
  if (!lastLine) return null;
  try {
    return JSON.parse(lastLine) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const CANONICAL_PROVENANCE_CHILD_ENV_NAMES = ["ComSpec", "SystemRoot", "TEMP", "TMP", "WINDIR"] as const;

export function createCanonicalV10ProvenanceChildEnv(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const nodeEnvironment = source.NODE_ENV;
  const child: NodeJS.ProcessEnv = {
    NODE_ENV: nodeEnvironment === "development" || nodeEnvironment === "test" || nodeEnvironment === "production"
      ? nodeEnvironment
      : "production",
    NO_UPDATE_NOTIFIER: "1",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
  };
  for (const name of CANONICAL_PROVENANCE_CHILD_ENV_NAMES) {
    const value = source[name];
    if (typeof value === "string" && value) child[name] = value;
  }
  return child;
}

export const verifyCanonicalV10CompilationProvenance: V10CanonicalProvenanceVerifier = async (snapshot) => {
  const { manifest, manifestDigest } = snapshot;
  const result = spawnSync(
    process.execPath,
    ["scripts/check-contract-compilation-provenance.mjs", "--target=v10", "--summary-only"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: createCanonicalV10ProvenanceChildEnv(),
      maxBuffer: 1024 * 1024,
      timeout: 120_000,
    },
  );
  const summary = parseLastJsonObject(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  if (
    result.status !== 0 ||
    result.error ||
    summary?.status !== "pass" ||
    summary.target !== "v10" ||
    summary.manifestMatches !== true ||
    summary.compilationManifestSha256 !== manifestDigest ||
    summary.compilerVersion !== manifest.compilerVersion ||
    summary.runtimeBytecodeBytes !== manifest.runtimeBytecodeBytes ||
    summary.executableRuntimeBytes !== manifest.executableRuntimeBytes ||
    summary.normalizedExecutableRuntimeSha256 !== manifest.normalizedExecutableRuntimeSha256 ||
    summary.runtimeBytecodeSha256 !== manifest.runtimeBytecodeSha256 ||
    summary.sourceSha256 !== manifest.sourceSha256
  ) {
    fail("canonical V10 compilation provenance did not pass");
  }
};

export function parseV10RuntimeIdentityManifest(raw: string): V10RuntimeIdentityManifest {
  let manifest: Partial<V10RuntimeIdentityManifest>;
  try {
    manifest = JSON.parse(raw);
  } catch {
    fail("canonical compilation manifest is invalid JSON");
  }
  const references = manifest.runtimeImmutableReferences;
  if (
    typeof manifest.compilerVersion !== "string" ||
    !/^0\.8\.\d+\+commit\.[0-9a-f]{8}/i.test(manifest.compilerVersion) ||
    !Number.isSafeInteger(manifest.executableRuntimeBytes) ||
    Number(manifest.executableRuntimeBytes) <= 0 ||
    !SHA256_RE.test(manifest.normalizedExecutableRuntimeSha256 ?? "") ||
    !SHA256_RE.test(manifest.runtimeBytecodeSha256 ?? "") ||
    !Number.isSafeInteger(manifest.runtimeBytecodeBytes) ||
    Number(manifest.runtimeBytecodeBytes) <= Number(manifest.executableRuntimeBytes) ||
    !SHA256_RE.test(manifest.sourceSha256 ?? "") ||
    !Array.isArray(references) ||
    references.length === 0
  ) {
    fail("canonical V10 runtime provenance is incomplete");
  }
  let previousEnd = 0;
  for (const reference of references) {
    if (
      !Number.isSafeInteger(reference?.start) ||
      !Number.isSafeInteger(reference?.length) ||
      reference.length !== 32 ||
      reference.start < previousEnd ||
      reference.start + reference.length > Number(manifest.executableRuntimeBytes)
    ) {
      fail("canonical V10 immutable reference layout is invalid");
    }
    previousEnd = reference.start + reference.length;
  }
  return manifest as V10RuntimeIdentityManifest;
}

export function readV10RuntimeIdentityManifest(
  manifestPath = COMPILATION_MANIFEST_PATH,
): V10RuntimeIdentityManifest {
  return readV10RuntimeIdentityManifestSnapshot(manifestPath).manifest;
}

export function readV10RuntimeIdentityManifestSnapshot(
  manifestPath = COMPILATION_MANIFEST_PATH,
): V10RuntimeIdentityManifestSnapshot {
  try {
    const before = manifestFileIdentity(manifestPath);
    const raw = readBoundedV10Utf8File(
      manifestPath,
      MAX_V10_COMPILATION_MANIFEST_BYTES,
      "Canonical V10 compilation manifest",
    );
    const after = manifestFileIdentity(manifestPath);
    if (before !== after) fail("canonical V10 compilation manifest changed while it was being read");
    return {
      manifest: parseV10RuntimeIdentityManifest(raw),
      manifestDigest: sha256(raw),
      manifestFileIdentity: before,
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V10 runtime identity preflight:")) throw error;
    fail("canonical V10 compilation manifest is unavailable");
  }
}

function manifestFileIdentity(manifestPath: string) {
  const stat = lstatSync(manifestPath);
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
}

function stripSolidityMetadata(bytecode: string) {
  if (bytecode.length < 4) return bytecode;
  const encodedLength = bytecode.slice(-4);
  if (!/^[0-9a-f]{4}$/.test(encodedLength)) return bytecode;
  const metadataBytes = Number.parseInt(encodedLength, 16);
  const metadataHexLength = (metadataBytes + 2) * 2;
  if (metadataBytes === 0 || metadataHexLength > bytecode.length) return bytecode;
  return bytecode.slice(0, -metadataHexLength);
}

export function normalizeV10ExecutableRuntime(
  bytecode: Hex | undefined,
  manifest: V10RuntimeIdentityManifest,
) {
  if (typeof bytecode !== "string" || !/^0x(?:[0-9a-f]{2})+$/i.test(bytecode)) {
    fail("configured contract has no valid deployed bytecode");
  }
  const executable = stripSolidityMetadata(bytecode.slice(2).toLowerCase());
  if (executable.length / 2 !== manifest.executableRuntimeBytes) {
    fail("deployed V10 executable runtime size does not match canonical provenance");
  }
  let normalized = executable;
  for (const reference of manifest.runtimeImmutableReferences) {
    const start = reference.start * 2;
    normalized = `${normalized.slice(0, start)}${"0".repeat(reference.length * 2)}${normalized.slice(start + reference.length * 2)}`;
  }
  const normalizedRuntimeSha256 = sha256(normalized);
  if (normalizedRuntimeSha256 !== manifest.normalizedExecutableRuntimeSha256) {
    fail("deployed V10 executable runtime does not match canonical provenance");
  }
  return normalizedRuntimeSha256;
}

export async function assertV10RuntimeIdentity(params: {
  contractAddress: string;
  deployBlock: bigint;
  expectedChainId: number;
  manifest?: V10RuntimeIdentityManifest;
  manifestPath?: string;
  reader: V10RuntimeIdentityReader;
  snapshotBlock: bigint;
  snapshotBlockHash: Hex;
  verifyCanonicalProvenance?: V10CanonicalProvenanceVerifier;
}): Promise<V10RuntimeIdentity> {
  const { deployBlock, expectedChainId, reader, snapshotBlock, snapshotBlockHash } = params;
  if (!Number.isSafeInteger(expectedChainId) || expectedChainId <= 0) {
    fail("expected chain ID is invalid");
  }
  if (deployBlock <= 0n) fail("configured deploy block must be greater than zero");
  if (snapshotBlock < deployBlock) fail("observed block predates configured deploy block");
  if (!/^0x[0-9a-f]{64}$/i.test(snapshotBlockHash)) fail("observed snapshot block hash is invalid");
  let contractAddress: Address;
  try {
    contractAddress = getAddress(params.contractAddress);
  } catch {
    fail("configured contract address is invalid");
  }
  const suppliedManifest = params.manifest;
  const manifestSnapshot = suppliedManifest
    ? { manifest: suppliedManifest, manifestDigest: canonicalManifestDigest(suppliedManifest) }
    : readV10RuntimeIdentityManifestSnapshot(params.manifestPath);
  const manifest = manifestSnapshot.manifest;
  await (params.verifyCanonicalProvenance ?? verifyCanonicalV10CompilationProvenance)(manifestSnapshot);
  if (!suppliedManifest) {
    const afterVerifier = readV10RuntimeIdentityManifestSnapshot(params.manifestPath);
    if (
      afterVerifier.manifestDigest !== manifestSnapshot.manifestDigest ||
      afterVerifier.manifestFileIdentity !== manifestSnapshot.manifestFileIdentity
    ) {
      fail("canonical V10 compilation manifest changed during provenance verification");
    }
  }
  const [chainId, deploymentBlock, observedBlock, runtimeBeforeDeployBlock, runtimeAtDeployBlock, currentRuntime] = await Promise.all([
    reader.getChainId(),
    reader.getBlock({ blockNumber: deployBlock }),
    reader.getBlock({ blockNumber: snapshotBlock }),
    reader.getBytecode({ address: contractAddress, blockNumber: deployBlock - 1n }),
    reader.getBytecode({ address: contractAddress, blockNumber: deployBlock }),
    reader.getBytecode({ address: contractAddress, blockNumber: snapshotBlock }),
  ]);
  if (chainId !== expectedChainId) fail("RPC chain ID does not match configured chain ID");
  if (deploymentBlock.number !== deployBlock) fail("configured deploy block is unavailable or inconsistent");
  if (observedBlock.number !== snapshotBlock) fail("observed block is unavailable or inconsistent");
  if (!observedBlock.hash) fail("observed block hash is unavailable");
  if (observedBlock.hash.toLowerCase() !== snapshotBlockHash.toLowerCase()) {
    fail("observed block hash does not match the supplied snapshot");
  }
  if (runtimeBeforeDeployBlock && runtimeBeforeDeployBlock !== "0x") {
    fail("configured contract code predates configured deploy block");
  }
  const deployedDigest = normalizeV10ExecutableRuntime(runtimeAtDeployBlock, manifest);
  const currentDigest = normalizeV10ExecutableRuntime(currentRuntime, manifest);
  if (deployedDigest !== currentDigest) fail("current runtime does not match runtime at configured deploy block");
  return {
    canonicalProvenanceVerified: true,
    chainId,
    contractAddress,
    deployBlock: deployBlock.toString(),
    executableBytes: manifest.executableRuntimeBytes,
    executableRuntimeBytes: manifest.executableRuntimeBytes,
    immutableReferences: manifest.runtimeImmutableReferences.length,
    manifestMatched: true,
    manifestDigest: manifestSnapshot.manifestDigest,
    normalizedRuntimeSha256: currentDigest,
    observedBlock: snapshotBlock.toString(),
    observedBlockHash: observedBlock.hash,
  };
}
