import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
const TARGETS = {
  v9: {
    contractPath: "contracts/LineaOreV9.sol",
    contractName: "LineaOreV9",
    manifestPath: "contracts/LineaOreV9.compilation.json",
    compilerPackage: "solc-0.8.34",
    expectedCompiler: "0.8.34+commit.80d5c536",
  },
  v10: {
    contractPath: "contracts/LineaOreV10.sol",
    contractName: "LineaOreV10",
    manifestPath: "contracts/LineaOreV10.compilation.json",
    compilerConfigPath: "contracts/LineaOreV10.compiler-config.json",
    compilerPackage: "solc",
    expectedCompiler: "0.8.36+commit.8a079791",
  },
};
const targetName = process.argv.find((arg) => arg.startsWith("--target="))?.slice("--target=".length) || "v9";
const SUMMARY_ONLY = process.argv.includes("--summary-only");
const target = TARGETS[targetName];
if (!target) throw new Error(`Unknown compilation target: ${targetName}`);
const {
  contractPath: CONTRACT_PATH,
  contractName: CONTRACT_NAME,
  manifestPath: MANIFEST_PATH,
  compilerConfigPath: COMPILER_CONFIG_PATH,
} = target;
const solc = (await import(target.compilerPackage)).default;
const OUTPUT_PATH = path.resolve(
  process.env.CONTRACT_PROVENANCE_OUT ||
    (targetName === "v9"
      ? ".tmp/contract-compilation-provenance.json"
      : `.tmp/contract-compilation-provenance-${targetName}.json`),
);

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const canonicalizeSource = (value) => value.replace(/\r\n?/g, "\n");
const MAX_CONTRACT_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_COMPILER_CONFIG_BYTES = 512 * 1024;
const MAX_COMPILATION_MANIFEST_BYTES = 512 * 1024;
const MAX_PACKAGE_LOCK_BYTES = 5 * 1024 * 1024;

function readBoundedUtf8File(filePath, maxBytes, label) {
  const stats = fs.statSync(filePath);
  if (!stats.isFile()) {
    throw new Error(`${label} must be a file: ${filePath}`);
  }
  if (stats.size > maxBytes) {
    throw new Error(`${label} is too large to validate safely: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

const stripSolidityMetadata = (bytecode) => {
  if (bytecode.length < 4) return bytecode;
  const encodedLength = bytecode.slice(-4);
  if (!/^[0-9a-f]{4}$/i.test(encodedLength)) return bytecode;
  const metadataBytes = Number.parseInt(encodedLength, 16);
  const metadataHexLength = (metadataBytes + 2) * 2;
  if (metadataBytes === 0 || metadataHexLength > bytecode.length) return bytecode;
  return bytecode.slice(0, -metadataHexLength);
};
const normalizeImmutables = (bytecode, references) => {
  let normalized = bytecode;
  let previousEnd = 0;
  for (const reference of references) {
    if (
      reference.length !== 32 ||
      reference.start < previousEnd ||
      reference.start + reference.length > bytecode.length / 2
    ) {
      throw new Error("V10 immutable reference layout is invalid");
    }
    const start = reference.start * 2;
    normalized = `${normalized.slice(0, start)}${"0".repeat(reference.length * 2)}${normalized.slice(start + reference.length * 2)}`;
    previousEnd = reference.start + reference.length;
  }
  return normalized;
};
const importedSources = new Map();
const readImport = (importPath) => {
  const candidates = [path.resolve(importPath), path.resolve("node_modules", importPath)];
  for (const candidate of candidates) {
    try {
      const contents = canonicalizeSource(readBoundedUtf8File(candidate, MAX_CONTRACT_SOURCE_BYTES, "Solidity import"));
      importedSources.set(importPath.replaceAll("\\", "/"), sha256(contents));
      return { contents };
    } catch {
      // Try the next deterministic local import root.
    }
  }
  return { error: `Import not found: ${importPath}` };
};

const compilerVersion = solc.version();
if (!compilerVersion.startsWith(target.expectedCompiler)) {
  throw new Error(`Expected solc ${target.expectedCompiler}, received ${compilerVersion}`);
}

// Solidity metadata hashes source bytes, so canonicalize checkout-specific line endings.
const source = canonicalizeSource(readBoundedUtf8File(CONTRACT_PATH, MAX_CONTRACT_SOURCE_BYTES, "contract source"));
const compilerConfig = COMPILER_CONFIG_PATH
  ? JSON.parse(readBoundedUtf8File(COMPILER_CONFIG_PATH, MAX_COMPILER_CONFIG_BYTES, "compiler config"))
  : null;
if (compilerConfig) {
  if (
    compilerConfig.language !== "Solidity" ||
    compilerConfig.settings?.optimizer?.enabled !== true ||
    compilerConfig.settings?.optimizer?.runs !== 200 ||
    compilerConfig.settings?.viaIR !== false ||
    compilerConfig.settings?.evmVersion !== "osaka"
  ) {
    throw new Error("V10 compiler config does not match the canonical profile");
  }
}
const input = {
  language: compilerConfig?.language || "Solidity",
  sources: { [CONTRACT_PATH]: { content: source } },
  settings: compilerConfig?.settings || {
    optimizer: { enabled: true, runs: 200 },
    viaIR: false,
    evmVersion: "osaka",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
  },
};
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: readImport }));
const errors = (output.errors || []).filter((entry) => entry.severity === "error");
if (errors.length > 0) {
  throw new Error(errors.map((entry) => entry.formattedMessage || entry.message).join("\n"));
}

const compiled = output.contracts?.[CONTRACT_PATH]?.[CONTRACT_NAME];
if (!compiled) throw new Error(`${CONTRACT_NAME} compiler output is missing`);
const compiledAbi = JSON.stringify(compiled.abi);
const compiledBytecode = compiled.evm.bytecode.object.toLowerCase();
const compiledRuntimeBytecode = compiled.evm.deployedBytecode.object.toLowerCase();
const observed = {
  compilerVersion,
  settings:
    targetName === "v9"
      ? { optimizer: true, runs: 200, evmVersion: "osaka" }
      : { optimizer: true, runs: 200, viaIR: false, evmVersion: "osaka" },
  sourceSha256: sha256(source),
  abiSha256: sha256(compiledAbi),
  bytecodeSha256: sha256(compiledBytecode),
  bytecodeBytes: compiledBytecode.length / 2,
};
if (targetName === "v10") {
  const lockfile = JSON.parse(readBoundedUtf8File("package-lock.json", MAX_PACKAGE_LOCK_BYTES, "package lock"));
  observed.openzeppelinContractsVersion = lockfile.packages?.["node_modules/@openzeppelin/contracts"]?.version;
  observed.sourceUnitsSha256 = Object.fromEntries([
    [CONTRACT_PATH.replaceAll("\\", "/"), sha256(source)],
    ...[...importedSources.entries()].sort(([left], [right]) => left.localeCompare(right)),
  ]);
  observed.runtimeBytecodeSha256 = sha256(compiledRuntimeBytecode);
  observed.runtimeBytecodeBytes = compiledRuntimeBytecode.length / 2;
  const executableRuntime = stripSolidityMetadata(compiledRuntimeBytecode);
  const immutableReferences = Object.values(compiled.evm.deployedBytecode.immutableReferences || {})
    .flat()
    .map(({ start, length }) => ({ start, length }))
    .sort((left, right) => left.start - right.start);
  if (immutableReferences.length === 0) throw new Error("V10 token immutable references are missing");
  observed.normalizedExecutableRuntimeSha256 = sha256(normalizeImmutables(executableRuntime, immutableReferences));
  observed.executableRuntimeBytes = executableRuntime.length / 2;
  observed.runtimeImmutableReferences = immutableReferences;
}
if (process.argv.includes("--write-manifest") && !SUMMARY_ONLY) {
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(observed, null, 2)}\n`, "utf8");
}
const expected = JSON.parse(readBoundedUtf8File(MANIFEST_PATH, MAX_COMPILATION_MANIFEST_BYTES, "compilation manifest"));
const result = {
  status: JSON.stringify(observed) === JSON.stringify(expected) ? "pass" : "fail",
  ...observed,
  manifestMatches: JSON.stringify(observed) === JSON.stringify(expected),
};
if (!SUMMARY_ONLY) {
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}
console.log(
  JSON.stringify(
    SUMMARY_ONLY
      ? {
          status: result.status,
          target: targetName,
          compilerVersion: result.compilerVersion,
          settings: result.settings,
          bytecodeBytes: result.bytecodeBytes,
          runtimeBytecodeBytes: result.runtimeBytecodeBytes,
          executableRuntimeBytes: result.executableRuntimeBytes,
          manifestMatches: result.manifestMatches,
          wouldWrite: false,
        }
      : result,
  ),
);
if (result.status !== "pass") process.exitCode = 1;
