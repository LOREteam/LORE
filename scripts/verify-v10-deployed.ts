import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import solc from "solc";
import {
  createPublicClient,
  encodeAbiParameters,
  fallback,
  getAddress,
  http,
  keccak256,
  parseAbi,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import {
  getConfiguredContractAddress,
  getConfiguredLineaNetwork,
  getConfiguredLineaTokenAddress,
  getLineaChain,
  getStableLineaReadRpcs,
} from "../config/publicConfig";

const PREPARE_STANDARD_JSON = process.argv.includes("--prepare-standard-json");
const PREPARE_REMIX_WORKSPACE = process.argv.includes("--prepare-remix-workspace");
if (!PREPARE_STANDARD_JSON && !PREPARE_REMIX_WORKSPACE) {
  loadDotenv({ path: ".env.local", override: false, quiet: true });
  loadDotenv({ path: ".env", override: false, quiet: true });
}

const CONTRACT_PATH = "contracts/LineaOreV10.sol";
const CONTRACT_NAME = "LineaOreV10";
const COMPILER_CONFIG_PATH = "contracts/LineaOreV10.compiler-config.json";
const COMPILATION_MANIFEST_PATH = "contracts/LineaOreV10.compilation.json";
const DEPLOYMENT_INITCODE_PATH = ".tmp/v10-canonical-initcode.hex";
const STANDARD_JSON_PATH = ".tmp/v10-canonical-standard-json-input.json";
const REMIX_WORKSPACE_PATH = ".tmp/v10-canonical-remix-workspace";
const MAX_V10_SOURCE_UNIT_BYTES = 2 * 1024 * 1024;
const MAX_V10_COMPILER_CONFIG_BYTES = 512 * 1024;
const MAX_V10_COMPILATION_MANIFEST_BYTES = 512 * 1024;
const EXPECTED_COMPILER = "0.8.36+commit.8a079791";
const EIP_3860_INITCODE_LIMIT = 49_152;
const READ_ABI = parseAbi([
  "function token() view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function feeRecipient() view returns (address)",
  "function currentEpoch() view returns (uint256)",
  "function epochDuration() view returns (uint256)",
  "function epochStartTime() view returns (uint256)",
  "function pendingEpochDuration() view returns (uint256)",
  "function pendingEpochDurationEta() view returns (uint256)",
  "function pendingEpochDurationEffectiveFromEpoch() view returns (uint256)",
  "function pendingFeeRecipient() view returns (address)",
  "function pendingFeeRecipientEta() view returns (uint256)",
  "function rolloverPool() view returns (uint256)",
  "function dailyJackpotPool() view returns (uint256)",
  "function weeklyJackpotPool() view returns (uint256)",
  "function accruedOwnerFees() view returns (uint256)",
  "function accruedBurnFees() view returns (uint256)",
  "function epochs(uint256) view returns (uint256,uint256,uint256,bool,bool,bool)",
  "function epochRebatePool(uint256) view returns (uint256)",
  "function epochRebateClaimed(uint256) view returns (uint256)",
  "function epochRewardClaimed(uint256) view returns (uint256)",
]);

function canonicalizeSource(value: string) {
  return value.replace(/\r\n?/g, "\n");
}

function readBoundedUtf8File(filePath: string, maxBytes: number, label: string) {
  const stats = fs.statSync(filePath);
  if (!stats.isFile()) {
    throw new Error(`${label} must be a file: ${filePath}`);
  }
  if (stats.size > maxBytes) {
    throw new Error(`${label} is too large to validate safely: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function readSourceUnit(sourceUnit: string) {
  for (const candidate of [path.resolve(sourceUnit), path.resolve("node_modules", sourceUnit)]) {
    try {
      return canonicalizeSource(readBoundedUtf8File(candidate, MAX_V10_SOURCE_UNIT_BYTES, `Source unit ${sourceUnit}`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
      // Try the next deterministic local import root.
    }
  }
  throw new Error(`Source unit not found: ${sourceUnit}`);
}

function readImport(importPath: string) {
  try {
    return { contents: readSourceUnit(importPath) };
  } catch {
    return { error: `Import not found: ${importPath}` };
  }
}

function compileRuntime() {
  const compilerVersion = solc.version();
  assert.ok(compilerVersion.startsWith(EXPECTED_COMPILER), `Expected solc ${EXPECTED_COMPILER}, received ${compilerVersion}`);
  const source = readSourceUnit(CONTRACT_PATH);
  const compilerConfig = JSON.parse(
    readBoundedUtf8File(COMPILER_CONFIG_PATH, MAX_V10_COMPILER_CONFIG_BYTES, "V10 compiler config"),
  );
  assert.equal(compilerConfig.language, "Solidity");
  assert.deepEqual(
    {
      optimizer: compilerConfig.settings?.optimizer,
      viaIR: compilerConfig.settings?.viaIR,
      evmVersion: compilerConfig.settings?.evmVersion,
    },
    { optimizer: { enabled: true, runs: 200 }, viaIR: false, evmVersion: "osaka" },
    "V10 compiler config does not match the canonical profile",
  );
  const input = {
    language: compilerConfig.language,
    sources: { [CONTRACT_PATH]: { content: source } },
    settings: compilerConfig.settings,
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: readImport }));
  const errors = (output.errors ?? []).filter((entry: { severity?: string }) => entry.severity === "error");
  assert.deepEqual(errors.map((entry: { formattedMessage?: string }) => entry.formattedMessage), []);
  const contract = output.contracts?.[CONTRACT_PATH]?.[CONTRACT_NAME];
  const creation = contract?.evm?.bytecode?.object;
  const deployed = contract?.evm?.deployedBytecode;
  assert.ok(creation, "V10 creation bytecode is missing");
  assert.ok(deployed?.object, "V10 deployed bytecode is missing");
  return {
    compilerVersion,
    creation: creation.toLowerCase() as string,
    runtime: deployed.object.toLowerCase() as string,
    immutableReferences: deployed.immutableReferences as Record<string, Array<{ start: number; length: number }>>,
  };
}

function buildCanonicalStandardJson(
  compilationManifest: { sourceUnitsSha256?: Record<string, string> },
  compiled: ReturnType<typeof compileRuntime>,
) {
  const compilerConfig = JSON.parse(
    readBoundedUtf8File(COMPILER_CONFIG_PATH, MAX_V10_COMPILER_CONFIG_BYTES, "V10 compiler config"),
  );
  const sourceUnitHashes = compilationManifest.sourceUnitsSha256 ?? {};
  const sourceUnits = Object.keys(sourceUnitHashes).sort();
  assert.ok(sourceUnits.includes(CONTRACT_PATH), "V10 manifest is missing the root source unit");
  const sources = Object.fromEntries(sourceUnits.map((sourceUnit) => {
    const content = readSourceUnit(sourceUnit);
    assert.equal(sha256(content), sourceUnitHashes[sourceUnit], `Source-unit hash mismatch: ${sourceUnit}`);
    return [sourceUnit, { content }];
  }));
  const input = {
    language: compilerConfig.language,
    sources,
    settings: compilerConfig.settings,
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors ?? []).filter((entry: { severity?: string }) => entry.severity === "error");
  assert.deepEqual(errors.map((entry: { formattedMessage?: string }) => entry.formattedMessage), []);
  const contract = output.contracts?.[CONTRACT_PATH]?.[CONTRACT_NAME];
  assert.equal(contract?.evm?.bytecode?.object?.toLowerCase(), compiled.creation, "Standard JSON creation bytecode drifted");
  assert.equal(
    contract?.evm?.deployedBytecode?.object?.toLowerCase(),
    compiled.runtime,
    "Standard JSON runtime bytecode drifted",
  );
  return { input, sourceUnits: sourceUnits.length };
}

function writeCanonicalRemixWorkspace(
  outputPath: string,
  input: ReturnType<typeof buildCanonicalStandardJson>["input"],
  compiled: ReturnType<typeof compileRuntime>,
) {
  fs.mkdirSync(outputPath, { recursive: true });
  const sourceEntries = Object.entries(input.sources).sort(([left], [right]) => left.localeCompare(right));
  const resolveWorkspacePath = (sourceUnit: string) => {
    const normalized = sourceUnit.replaceAll("\\", "/");
    assert.equal(normalized, path.posix.normalize(normalized), `Unsafe source-unit path: ${sourceUnit}`);
    assert.ok(
      !path.posix.isAbsolute(normalized) && normalized !== ".." && !normalized.startsWith("../"),
      `Unsafe source-unit path: ${sourceUnit}`,
    );
    const destination = path.resolve(outputPath, ...normalized.split("/"));
    const relativeDestination = path.relative(outputPath, destination);
    assert.ok(
      relativeDestination !== ".." &&
        !relativeDestination.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativeDestination),
      `Source unit escapes workspace: ${sourceUnit}`,
    );
    return destination;
  };
  for (const [sourceUnit, source] of sourceEntries) {
    const destination = resolveWorkspacePath(sourceUnit);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, source.content, { encoding: "utf8", mode: 0o600 });
  }

  const compilerConfigDestination = path.resolve(outputPath, COMPILER_CONFIG_PATH);
  fs.mkdirSync(path.dirname(compilerConfigDestination), { recursive: true });
  fs.writeFileSync(
    compilerConfigDestination,
    canonicalizeSource(readBoundedUtf8File(COMPILER_CONFIG_PATH, MAX_V10_COMPILER_CONFIG_BYTES, "V10 compiler config")),
    { encoding: "utf8", mode: 0o600 },
  );

  const workspaceSources = Object.fromEntries(sourceEntries.map(([sourceUnit]) => [
    sourceUnit,
    {
      content: canonicalizeSource(
        readBoundedUtf8File(resolveWorkspacePath(sourceUnit), MAX_V10_SOURCE_UNIT_BYTES, `workspace source unit ${sourceUnit}`),
      ),
    },
  ]));
  const workspaceInput = { ...input, sources: workspaceSources };
  const output = JSON.parse(solc.compile(JSON.stringify(workspaceInput)));
  const errors = (output.errors ?? []).filter((entry: { severity?: string }) => entry.severity === "error");
  assert.deepEqual(errors.map((entry: { formattedMessage?: string }) => entry.formattedMessage), []);
  const contract = output.contracts?.[CONTRACT_PATH]?.[CONTRACT_NAME];
  assert.equal(
    contract?.evm?.bytecode?.object?.toLowerCase(),
    compiled.creation,
    "Remix workspace creation bytecode drifted",
  );
  assert.equal(
    contract?.evm?.deployedBytecode?.object?.toLowerCase(),
    compiled.runtime,
    "Remix workspace runtime bytecode drifted",
  );
  const rootOnlyInput = {
    ...input,
    sources: { [CONTRACT_PATH]: workspaceSources[CONTRACT_PATH] },
  };
  const rootOnlyOutput = JSON.parse(solc.compile(JSON.stringify(rootOnlyInput), {
    import(importPath: string) {
      try {
        return {
          contents: canonicalizeSource(
            readBoundedUtf8File(resolveWorkspacePath(importPath), MAX_V10_SOURCE_UNIT_BYTES, `workspace import ${importPath}`),
          ),
        };
      } catch {
        return { error: `Workspace import not found: ${importPath}` };
      }
    },
  }));
  const rootOnlyErrors = (rootOnlyOutput.errors ?? [])
    .filter((entry: { severity?: string }) => entry.severity === "error");
  assert.deepEqual(rootOnlyErrors.map((entry: { formattedMessage?: string }) => entry.formattedMessage), []);
  const rootOnlyContract = rootOnlyOutput.contracts?.[CONTRACT_PATH]?.[CONTRACT_NAME];
  assert.equal(
    rootOnlyContract?.evm?.bytecode?.object?.toLowerCase(),
    compiled.creation,
    "Root-only Remix workspace creation bytecode drifted",
  );
  assert.equal(
    rootOnlyContract?.evm?.deployedBytecode?.object?.toLowerCase(),
    compiled.runtime,
    "Root-only Remix workspace runtime bytecode drifted",
  );
  const sourceSetSha256 = sha256(JSON.stringify(sourceEntries.map(([sourceUnit, source]) => [
    sourceUnit,
    sha256(source.content),
  ])));
  const deploymentGuide = `# LineaOreV10 Canonical Remix Deployment

Generated locally from the repository manifest. Do not edit, rename, flatten, or
paste the Solidity sources into another workspace.

## Compile

1. Open this directory as the Remix Desktop workspace root.
2. Open \`${CONTRACT_PATH}\`; keep that exact source-unit path.
3. Select Solidity compiler \`${EXPECTED_COMPILER}\`.
4. In Advanced Configurations choose **Use configuration file** and select
   \`${COMPILER_CONFIG_PATH}\`.
5. Confirm optimizer enabled with 200 runs, \`viaIR\` disabled, and EVM
   version \`osaka\`.
6. Compile \`${CONTRACT_PATH}:${CONTRACT_NAME}\`.

Canonical source and bytecode identity:

- source units: ${sourceEntries.length}
- source-set SHA-256: \`${sourceSetSha256}\`
- creation bytes: ${compiled.creation.length / 2}
- creation SHA-256: \`${sha256(compiled.creation)}\`
- runtime bytes: ${compiled.runtime.length / 2}
- runtime SHA-256: \`${sha256(compiled.runtime)}\`

## Deploy

Constructor arguments, in order:

1. \`tokenAddress\`
2. \`initialOwner\`
3. \`initialFeeRecipient\`

Use the intended Linea network and record the deployment transaction hash,
contract address, and deployment block. Never place a private key, mnemonic,
RPC credential, or wallet export in this workspace.

## Verify

Return to the repository, configure the public deployment values and independent
expected constructor values, then run:

\`\`\`powershell
npm.cmd run proof:contract-deployed:v10:fresh
\`\`\`

A successful deployment transaction is not canonical evidence by itself. Do not
cut over the frontend, keeper, or indexer unless the strict verifier confirms
the full bytecode, constructor receipt/input, immutable token, initial state,
and deployment block.
`;
  fs.writeFileSync(path.resolve(outputPath, "README.md"), deploymentGuide, {
    encoding: "utf8",
    mode: 0o600,
  });
  return {
    sourceUnits: sourceEntries.length,
    sourceSetSha256,
    rootImportBytecodeMatches: true,
    deploymentGuide: "README.md",
  };
}

function patchImmutableAddress(runtime: string, references: Record<string, Array<{ start: number; length: number }>>, address: Address) {
  assert.equal(Object.keys(references ?? {}).length, 1, "V10 must have exactly one immutable value");
  const allReferences = Object.values(references ?? {}).flat().sort((left, right) => left.start - right.start);
  assert.ok(allReferences.length > 0, "V10 token immutable reference is missing");
  let previousEnd = 0;
  for (const reference of allReferences) {
    assert.equal(reference.length, 32, "V10 token immutable reference must occupy one ABI word");
    assert.ok(reference.start >= previousEnd, "V10 immutable references must not overlap");
    assert.ok(reference.start + reference.length <= runtime.length / 2, "V10 immutable reference is outside runtime");
    previousEnd = reference.start + reference.length;
  }
  let patched = runtime;
  for (const reference of allReferences) {
    const replacement = address.slice(2).toLowerCase().padStart(reference.length * 2, "0");
    assert.equal(replacement.length, reference.length * 2, "immutable address does not fit its bytecode reference");
    const start = reference.start * 2;
    patched = `${patched.slice(0, start)}${replacement}${patched.slice(start + reference.length * 2)}`;
  }
  return { runtime: patched, referenceCount: allReferences.length };
}

function stripSolidityMetadata(bytecode: string) {
  if (bytecode.length < 4) return bytecode;
  const encodedLength = bytecode.slice(-4);
  if (!/^[0-9a-f]{4}$/i.test(encodedLength)) return bytecode;
  const metadataBytes = Number.parseInt(encodedLength, 16);
  const metadataHexLength = (metadataBytes + 2) * 2;
  if (metadataBytes === 0 || metadataHexLength > bytecode.length) return bytecode;
  return bytecode.slice(0, -metadataHexLength);
}

function sanitizeVerifierError(message: string) {
  return message
    .replace(/https?:\/\/[^\s"']+/gi, "[redacted-rpc]")
    .replace(/0x[a-fA-F0-9]{40,}/g, "[redacted-hex]")
    .slice(0, 240);
}

function isExplicitTrue(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function main() {
  assert.equal(
    sanitizeVerifierError(`RPC https://example.invalid/key address 0x${"ab".repeat(20)}`),
    "RPC [redacted-rpc] address [redacted-hex]",
    "Verifier error redaction self-check failed",
  );
  const fresh = process.argv.includes("--fresh");
  const prepareDeployment = process.argv.includes("--prepare-deployment");
  const prepareStandardJson = PREPARE_STANDARD_JSON;
  const prepareRemixWorkspace = PREPARE_REMIX_WORKSPACE;
  if (Number(fresh) + Number(prepareDeployment) + Number(prepareStandardJson) + Number(prepareRemixWorkspace) > 1) {
    throw new Error(
      "--fresh, --prepare-deployment, --prepare-standard-json, and --prepare-remix-workspace are separate phases",
    );
  }
  const deploymentInitcodeOutputPath = path.resolve(DEPLOYMENT_INITCODE_PATH);
  const deploymentInitcodeTempPath = `${deploymentInitcodeOutputPath}.tmp`;
  const standardJsonOutputPath = path.resolve(STANDARD_JSON_PATH);
  const standardJsonTempPath = `${standardJsonOutputPath}.tmp`;
  const remixWorkspaceOutputPath = path.resolve(REMIX_WORKSPACE_PATH);
  const remixWorkspaceTempPath = `${remixWorkspaceOutputPath}.tmp`;
  if (prepareDeployment) {
    fs.rmSync(deploymentInitcodeTempPath, { force: true });
    fs.rmSync(deploymentInitcodeOutputPath, { force: true });
  }
  if (prepareDeployment || prepareStandardJson || prepareRemixWorkspace) {
    fs.rmSync(standardJsonTempPath, { force: true });
    fs.rmSync(standardJsonOutputPath, { force: true });
  }
  if (prepareRemixWorkspace) {
    fs.rmSync(remixWorkspaceTempPath, { recursive: true, force: true });
    fs.rmSync(remixWorkspaceOutputPath, { recursive: true, force: true });
  }
  const compiled = compileRuntime();
  const compilationManifest = JSON.parse(
    readBoundedUtf8File(COMPILATION_MANIFEST_PATH, MAX_V10_COMPILATION_MANIFEST_BYTES, "V10 compilation manifest"),
  );
  assert.equal(sha256(compiled.creation), compilationManifest.bytecodeSha256, "V10 creation bytecode does not match its manifest");
  assert.equal(sha256(compiled.runtime), compilationManifest.runtimeBytecodeSha256, "V10 runtime bytecode does not match its manifest");
  const canonicalStandardJson = prepareDeployment || prepareStandardJson || prepareRemixWorkspace
    ? buildCanonicalStandardJson(compilationManifest, compiled)
    : null;
  const standardJson = canonicalStandardJson
    ? `${JSON.stringify(canonicalStandardJson.input, null, 2)}\n`
    : null;
  if (prepareStandardJson) {
    fs.mkdirSync(path.dirname(standardJsonOutputPath), { recursive: true });
    fs.writeFileSync(standardJsonTempPath, standardJson!, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(standardJsonTempPath, standardJsonOutputPath);
    console.log(JSON.stringify({
      status: "ready",
      standardJsonArtifact: STANDARD_JSON_PATH,
      compilerVersion: compiled.compilerVersion,
      sourceUnits: canonicalStandardJson!.sourceUnits,
      standardJsonSha256: sha256(standardJson!),
      manifestMatches: true,
      standardJsonBytecodeMatches: true,
      constructorBound: false,
      networkAccess: false,
      walletAccess: false,
      transactionSent: false,
    }));
    return;
  }
  if (prepareRemixWorkspace) {
    fs.mkdirSync(path.dirname(standardJsonOutputPath), { recursive: true });
    try {
      fs.writeFileSync(standardJsonTempPath, standardJson!, { encoding: "utf8", mode: 0o600 });
      const workspace = writeCanonicalRemixWorkspace(
        remixWorkspaceTempPath,
        canonicalStandardJson!.input,
        compiled,
      );
      fs.renameSync(standardJsonTempPath, standardJsonOutputPath);
      fs.renameSync(remixWorkspaceTempPath, remixWorkspaceOutputPath);
      console.log(JSON.stringify({
        status: "ready",
        workspaceArtifact: REMIX_WORKSPACE_PATH,
        rootSourcePath: CONTRACT_PATH,
        compilerConfigPath: COMPILER_CONFIG_PATH,
        standardJsonArtifact: STANDARD_JSON_PATH,
        compilerVersion: compiled.compilerVersion,
        sourceUnits: workspace.sourceUnits,
        sourceSetSha256: workspace.sourceSetSha256,
        standardJsonSha256: sha256(standardJson!),
        manifestMatches: true,
        workspaceBytecodeMatches: true,
        rootImportBytecodeMatches: workspace.rootImportBytecodeMatches,
        deploymentGuide: `${REMIX_WORKSPACE_PATH}/${workspace.deploymentGuide}`,
        networkAccess: false,
        walletAccess: false,
        transactionSent: false,
      }));
      return;
    } catch (error) {
      fs.rmSync(standardJsonTempPath, { force: true });
      fs.rmSync(standardJsonOutputPath, { force: true });
      fs.rmSync(remixWorkspaceTempPath, { recursive: true, force: true });
      fs.rmSync(remixWorkspaceOutputPath, { recursive: true, force: true });
      throw error;
    }
  }
  const network = getConfiguredLineaNetwork();
  const chain = getLineaChain(network);
  const configuredTokenAddress = getAddress(
    getConfiguredLineaTokenAddress(process.env.NEXT_PUBLIC_LINEA_TOKEN_ADDRESS, network),
  );
  const expectedTokenRaw = process.env.V10_EXPECTED_TOKEN_ADDRESS?.trim();
  const expectedOwnerRaw = process.env.V10_EXPECTED_INITIAL_OWNER?.trim();
  const expectedFeeRecipientRaw = process.env.V10_EXPECTED_INITIAL_FEE_RECIPIENT?.trim();
  const deploymentTxHashRaw = process.env.V10_DEPLOY_TX_HASH?.trim();
  const epochBoundBetsRequired = isExplicitTrue(
    process.env.NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS,
  );
  const constructorBound = fresh || prepareDeployment;
  if (constructorBound && (!expectedTokenRaw || !expectedOwnerRaw || !expectedFeeRecipientRaw)) {
    throw new Error(
      "--fresh/--prepare-deployment requires V10_EXPECTED_TOKEN_ADDRESS, V10_EXPECTED_INITIAL_OWNER, and V10_EXPECTED_INITIAL_FEE_RECIPIENT",
    );
  }
  if (fresh && !deploymentTxHashRaw) {
    throw new Error(
      "--fresh requires V10_EXPECTED_TOKEN_ADDRESS, V10_EXPECTED_INITIAL_OWNER, V10_EXPECTED_INITIAL_FEE_RECIPIENT, and V10_DEPLOY_TX_HASH",
    );
  }
  if (deploymentTxHashRaw && !/^0x[0-9a-fA-F]{64}$/.test(deploymentTxHashRaw)) {
    throw new Error("V10_DEPLOY_TX_HASH must be a 32-byte transaction hash");
  }
  const expectedToken = expectedTokenRaw ? getAddress(expectedTokenRaw) : null;
  if (constructorBound && configuredTokenAddress !== expectedToken) {
    throw new Error("V10_EXPECTED_TOKEN_ADDRESS must match NEXT_PUBLIC_LINEA_TOKEN_ADDRESS");
  }
  if (constructorBound && !epochBoundBetsRequired) {
    throw new Error("V10 deployment verification requires NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS=1");
  }
  const tokenAddress = constructorBound ? expectedToken! : configuredTokenAddress;
  const expectedOwner = expectedOwnerRaw ? getAddress(expectedOwnerRaw) : null;
  const expectedFeeRecipient = expectedFeeRecipientRaw ? getAddress(expectedFeeRecipientRaw) : null;
  const deploymentTxHash = deploymentTxHashRaw as Hash | undefined;
  const expected = patchImmutableAddress(compiled.runtime, compiled.immutableReferences, tokenAddress);
  assert.equal(stripSolidityMetadata("6000aabb0002"), "6000", "Solidity metadata parser self-check failed");
  const expectedExecutableRuntime = stripSolidityMetadata(expected.runtime);
  assert.ok(expectedExecutableRuntime.length < expected.runtime.length, "V10 runtime is missing Solidity metadata");
  const expectedCreationInput = constructorBound
    ? `0x${compiled.creation}${encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "address" }],
      [tokenAddress, expectedOwner!, expectedFeeRecipient!],
    ).slice(2)}`.toLowerCase()
    : null;
  if (prepareDeployment) {
    const initCode = expectedCreationInput as Hex;
    const initCodeBytes = (initCode.length - 2) / 2;
    assert.ok(initCodeBytes <= EIP_3860_INITCODE_LIMIT, "V10 deployment initcode exceeds EIP-3860");
    fs.mkdirSync(path.dirname(deploymentInitcodeOutputPath), { recursive: true });
    fs.writeFileSync(standardJsonTempPath, standardJson!, { encoding: "utf8", mode: 0o600 });
    fs.writeFileSync(deploymentInitcodeTempPath, `${initCode}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(standardJsonTempPath, standardJsonOutputPath);
    fs.renameSync(deploymentInitcodeTempPath, deploymentInitcodeOutputPath);
    console.log(JSON.stringify({
      status: "ready",
      artifact: DEPLOYMENT_INITCODE_PATH,
      standardJsonArtifact: STANDARD_JSON_PATH,
      compilerVersion: compiled.compilerVersion,
      sourceUnits: canonicalStandardJson!.sourceUnits,
      standardJsonSha256: sha256(standardJson!),
      creationBytes: compiled.creation.length / 2,
      constructorArgumentsBytes: initCodeBytes - compiled.creation.length / 2,
      initCodeBytes,
      initCodeKeccak256: keccak256(initCode),
      manifestMatches: true,
      standardJsonBytecodeMatches: true,
      networkAccess: false,
      walletAccess: false,
      transactionSent: false,
    }));
    return;
  }
  if (process.argv.includes("--offline")) {
    console.log(JSON.stringify({
      status: "ready",
      compilerVersion: compiled.compilerVersion,
      compiler: { optimizer: true, runs: 200, viaIR: false, evmVersion: "osaka" },
      runtimeBytes: expected.runtime.length / 2,
      executableRuntimeBytes: expectedExecutableRuntime.length / 2,
      immutableReferences: expected.referenceCount,
      transactionSent: false,
    }));
    return;
  }

  const publicContractRaw = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS?.trim();
  const keeperContractRaw = process.env.KEEPER_CONTRACT_ADDRESS?.trim();
  const publicDeployBlockRaw = process.env.NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK?.trim();
  const indexerStartBlockRaw = process.env.INDEXER_START_BLOCK?.trim();
  if (fresh && (!publicContractRaw || !keeperContractRaw || !publicDeployBlockRaw || !indexerStartBlockRaw)) {
    throw new Error("--fresh requires explicit frontend/keeper contract addresses and deploy/indexer blocks");
  }
  const contractAddress = getAddress(getConfiguredContractAddress(publicContractRaw, network));
  const keeperContractAddress = keeperContractRaw ? getAddress(keeperContractRaw) : contractAddress;
  if (fresh && contractAddress !== keeperContractAddress) {
    throw new Error("--fresh requires matching NEXT_PUBLIC_CONTRACT_ADDRESS and KEEPER_CONTRACT_ADDRESS");
  }
  if (fresh && (!/^\d+$/.test(publicDeployBlockRaw!) || !/^\d+$/.test(indexerStartBlockRaw!))) {
    throw new Error("--fresh deployment blocks must be non-negative decimal integers");
  }
  const expectedDeployBlock = fresh ? BigInt(publicDeployBlockRaw!) : null;
  const expectedIndexerStartBlock = fresh ? BigInt(indexerStartBlockRaw!) : null;
  if (fresh && (expectedDeployBlock === 0n || expectedDeployBlock !== expectedIndexerStartBlock)) {
    throw new Error("--fresh requires one non-zero deploy block shared by frontend and indexer");
  }
  const rpcUrls = getStableLineaReadRpcs(process.env.NEXT_PUBLIC_LINEA_RPCS, network);
  const client = createPublicClient({
    chain,
    transport: fallback(rpcUrls.map((url) => http(url, { timeout: 20_000, retryCount: 0 }))),
  });
  const [
    chainId,
    runtime,
    tokenRuntime,
    tokenDecimals,
    latestBlock,
    deploymentBlock,
    runtimeBeforeDeployment,
    deploymentTransaction,
    deploymentReceipt,
    token,
    owner,
    pendingOwner,
    feeRecipient,
    initialOwner,
    initialFeeRecipient,
    currentEpoch,
    epochDuration,
    epochStartTime,
    initialCurrentEpoch,
    initialEpochDuration,
    initialEpochStartTime,
    pendingDuration,
    pendingDurationEta,
    pendingDurationEpoch,
    pendingRecipient,
    pendingRecipientEta,
    rollover,
    dailyJackpot,
    weeklyJackpot,
    ownerFees,
    burnFees,
    epochOne,
    epochOneRebatePool,
    epochOneRebateClaimed,
    epochOneRewardClaimed,
    contractTokenBalance,
  ] =
    await Promise.all([
      client.getChainId(),
      client.getBytecode({ address: contractAddress }),
      client.getBytecode({ address: tokenAddress }),
      client.readContract({ address: tokenAddress, abi: READ_ABI, functionName: "decimals" }),
      client.getBlock({ blockTag: "latest" }),
      fresh ? client.getBlock({ blockNumber: expectedDeployBlock! }) : Promise.resolve(null),
      fresh ? client.getBytecode({ address: contractAddress, blockNumber: expectedDeployBlock! - 1n }) : Promise.resolve(undefined),
      fresh ? client.getTransaction({ hash: deploymentTxHash! }) : Promise.resolve(null),
      fresh ? client.getTransactionReceipt({ hash: deploymentTxHash! }) : Promise.resolve(null),
      client.readContract({ address: contractAddress, abi: READ_ABI, functionName: "token" }),
      client.readContract({ address: contractAddress, abi: READ_ABI, functionName: "owner" }),
      client.readContract({
        address: contractAddress,
        abi: READ_ABI,
        functionName: "pendingOwner",
        ...(fresh ? { blockNumber: expectedDeployBlock! } : {}),
      }),
      client.readContract({ address: contractAddress, abi: READ_ABI, functionName: "feeRecipient" }),
      fresh
        ? client.readContract({ address: contractAddress, abi: READ_ABI, functionName: "owner", blockNumber: expectedDeployBlock! })
        : Promise.resolve(null),
      fresh
        ? client.readContract({ address: contractAddress, abi: READ_ABI, functionName: "feeRecipient", blockNumber: expectedDeployBlock! })
        : Promise.resolve(null),
      client.readContract({ address: contractAddress, abi: READ_ABI, functionName: "currentEpoch" }),
      client.readContract({ address: contractAddress, abi: READ_ABI, functionName: "epochDuration" }),
      client.readContract({ address: contractAddress, abi: READ_ABI, functionName: "epochStartTime" }),
      fresh
        ? client.readContract({ address: contractAddress, abi: READ_ABI, functionName: "currentEpoch", blockNumber: expectedDeployBlock! })
        : Promise.resolve(null),
      fresh
        ? client.readContract({ address: contractAddress, abi: READ_ABI, functionName: "epochDuration", blockNumber: expectedDeployBlock! })
        : Promise.resolve(null),
      fresh
        ? client.readContract({ address: contractAddress, abi: READ_ABI, functionName: "epochStartTime", blockNumber: expectedDeployBlock! })
        : Promise.resolve(null),
      client.readContract({
        address: contractAddress,
        abi: READ_ABI,
        functionName: "pendingEpochDuration",
        ...(fresh ? { blockNumber: expectedDeployBlock! } : {}),
      }),
      client.readContract({
        address: contractAddress,
        abi: READ_ABI,
        functionName: "pendingEpochDurationEta",
        ...(fresh ? { blockNumber: expectedDeployBlock! } : {}),
      }),
      client.readContract({
        address: contractAddress,
        abi: READ_ABI,
        functionName: "pendingEpochDurationEffectiveFromEpoch",
        ...(fresh ? { blockNumber: expectedDeployBlock! } : {}),
      }),
      client.readContract({
        address: contractAddress,
        abi: READ_ABI,
        functionName: "pendingFeeRecipient",
        ...(fresh ? { blockNumber: expectedDeployBlock! } : {}),
      }),
      client.readContract({
        address: contractAddress,
        abi: READ_ABI,
        functionName: "pendingFeeRecipientEta",
        ...(fresh ? { blockNumber: expectedDeployBlock! } : {}),
      }),
      client.readContract({
        address: contractAddress,
        abi: READ_ABI,
        functionName: "rolloverPool",
        ...(fresh ? { blockNumber: expectedDeployBlock! } : {}),
      }),
      client.readContract({
        address: contractAddress,
        abi: READ_ABI,
        functionName: "dailyJackpotPool",
        ...(fresh ? { blockNumber: expectedDeployBlock! } : {}),
      }),
      client.readContract({
        address: contractAddress,
        abi: READ_ABI,
        functionName: "weeklyJackpotPool",
        ...(fresh ? { blockNumber: expectedDeployBlock! } : {}),
      }),
      client.readContract({
        address: contractAddress,
        abi: READ_ABI,
        functionName: "accruedOwnerFees",
        ...(fresh ? { blockNumber: expectedDeployBlock! } : {}),
      }),
      client.readContract({
        address: contractAddress,
        abi: READ_ABI,
        functionName: "accruedBurnFees",
        ...(fresh ? { blockNumber: expectedDeployBlock! } : {}),
      }),
      client.readContract({
        address: contractAddress,
        abi: READ_ABI,
        functionName: "epochs",
        args: [1n],
        ...(fresh ? { blockNumber: expectedDeployBlock! } : {}),
      }),
      client.readContract({
        address: contractAddress,
        abi: READ_ABI,
        functionName: "epochRebatePool",
        args: [1n],
        ...(fresh ? { blockNumber: expectedDeployBlock! } : {}),
      }),
      client.readContract({
        address: contractAddress,
        abi: READ_ABI,
        functionName: "epochRebateClaimed",
        args: [1n],
        ...(fresh ? { blockNumber: expectedDeployBlock! } : {}),
      }),
      client.readContract({
        address: contractAddress,
        abi: READ_ABI,
        functionName: "epochRewardClaimed",
        args: [1n],
        ...(fresh ? { blockNumber: expectedDeployBlock! } : {}),
      }),
      client.readContract({
        address: tokenAddress,
        abi: READ_ABI,
        functionName: "balanceOf",
        args: [contractAddress],
        ...(fresh ? { blockNumber: expectedDeployBlock! } : {}),
      }),
    ]);
  const [
    epochOneTotalPool,
    epochOneRewardPool,
    epochOneWinningTile,
    epochOneResolved,
    epochOneDailyJackpot,
    epochOneWeeklyJackpot,
  ] = epochOne as readonly [bigint, bigint, bigint, boolean, boolean, boolean];
  const actualRuntime = runtime ? (runtime as Hex).slice(2).toLowerCase() : "";
  const actualExecutableRuntime = stripSolidityMetadata(actualRuntime);
  const exactRuntimeMatch = actualRuntime.length > 0 && actualRuntime === expected.runtime;
  const executableRuntimeMatch = actualRuntime.length > 0 && actualExecutableRuntime === expectedExecutableRuntime;
  const checks = {
    chainId: chainId === chain.id,
    runtimeBytecode: exactRuntimeMatch,
    runtimeExecutable: executableRuntimeMatch,
    tokenRuntime: Boolean(tokenRuntime && tokenRuntime !== "0x"),
    tokenDecimals: (tokenDecimals as number) === 18,
    token: getAddress(token as Address) === tokenAddress,
    ownerNonZero: BigInt(owner as Address) !== 0n,
    feeRecipientNonZero: BigInt(feeRecipient as Address) !== 0n,
    expectedOwner: !fresh || getAddress(initialOwner as Address) === expectedOwner,
    expectedFeeRecipient: !fresh || getAddress(initialFeeRecipient as Address) === expectedFeeRecipient,
    deploymentBlock:
      !fresh ||
      (
        deploymentBlock?.number === expectedDeployBlock &&
        deploymentBlock.timestamp === (initialEpochStartTime as bigint) &&
        latestBlock.number >= expectedDeployBlock!
      ),
    noRuntimeBeforeDeployment: !fresh || !runtimeBeforeDeployment || runtimeBeforeDeployment === "0x",
    deploymentTransaction:
      !fresh ||
      (
        deploymentTransaction !== null &&
        deploymentTransaction.hash.toLowerCase() === deploymentTxHash!.toLowerCase() &&
        deploymentTransaction.to === null &&
        deploymentTransaction.input.toLowerCase() === expectedCreationInput &&
        deploymentTransaction.blockNumber === expectedDeployBlock
      ),
    deploymentReceipt:
      !fresh ||
      (
        deploymentReceipt !== null &&
        deploymentReceipt.transactionHash.toLowerCase() === deploymentTxHash!.toLowerCase() &&
        deploymentReceipt.status === "success" &&
        deploymentReceipt.blockNumber === expectedDeployBlock &&
        typeof deploymentReceipt.contractAddress === "string" &&
        getAddress(deploymentReceipt.contractAddress) === contractAddress
      ),
    currentEpoch: (currentEpoch as bigint) >= 1n,
    epochDuration: (epochDuration as bigint) >= 15n && (epochDuration as bigint) <= 3_600n,
    epochStartTime: (epochStartTime as bigint) > 0n,
    freshInitialState:
      !fresh ||
      (
        (initialCurrentEpoch as bigint) === 1n &&
        (initialEpochDuration as bigint) === 60n &&
        (pendingDuration as bigint) === 0n &&
        (pendingDurationEta as bigint) === 0n &&
        (pendingDurationEpoch as bigint) === 0n &&
        BigInt(pendingOwner as Address) === 0n &&
        BigInt(pendingRecipient as Address) === 0n &&
        (pendingRecipientEta as bigint) === 0n &&
        (rollover as bigint) === 0n &&
        (dailyJackpot as bigint) === 0n &&
        (weeklyJackpot as bigint) === 0n &&
        (ownerFees as bigint) === 0n &&
        (burnFees as bigint) === 0n &&
        epochOneTotalPool === 0n &&
        epochOneRewardPool === 0n &&
        epochOneWinningTile === 0n &&
        epochOneResolved === false &&
        epochOneDailyJackpot === false &&
        epochOneWeeklyJackpot === false &&
        (epochOneRebatePool as bigint) === 0n &&
        (epochOneRebateClaimed as bigint) === 0n &&
        (epochOneRewardClaimed as bigint) === 0n &&
        (contractTokenBalance as bigint) === 0n
      ),
  };
  const status = Object.values(checks).every(Boolean) ? "pass" : "fail";
  console.log(JSON.stringify({
    status,
    network,
    chainId: chain.id,
    runtimeBytes: runtime ? ((runtime as Hex).length - 2) / 2 : 0,
    expectedRuntimeBytes: expected.runtime.length / 2,
    expectedExecutableRuntimeBytes: expectedExecutableRuntime.length / 2,
    immutableReferences: expected.referenceCount,
    diagnostics: {
      metadataOnlyMismatch: executableRuntimeMatch && !exactRuntimeMatch,
    },
    checks,
    transactionSent: false,
  }));
  if (status !== "pass") process.exitCode = 1;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ status: "fail", error: sanitizeVerifierError(message) }));
  process.exitCode = 1;
});
