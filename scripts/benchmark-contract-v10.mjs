import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import solc from "solc";

const require = createRequire(import.meta.url);
const legacySolc = require("solc-0.8.34");
assert.match(legacySolc.version(), /^0\.8\.34\+/, "V9 matrix compiler must remain pinned to 0.8.34");
assert.match(solc.version(), /^0\.8\.36\+/, "V10 matrix compiler must remain pinned to 0.8.36");

const EIP_170_RUNTIME_LIMIT = 24_576;
const MAX_BENCHMARK_CONTRACT_SOURCE_BYTES = 2 * 1024 * 1024;
const CONTRACTS = [
  { path: "contracts/LineaOreV9.sol", name: "LineaOreV9" },
  { path: "contracts/LineaOreV10.sol", name: "LineaOreV10" },
];
const RUNS = [1, 200, 10_000, 1_000_000];

function readBoundedUtf8File(filePath, maxBytes, label) {
  const stats = fs.statSync(filePath);
  if (!stats.isFile()) {
    throw new Error(`${label} must be a file: ${filePath}`);
  }
  if (stats.size > maxBytes) {
    throw new Error(`${label} is too large to benchmark safely: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function readImport(importPath) {
  for (const candidate of [path.resolve(importPath), path.resolve("node_modules", importPath)]) {
    try {
      return {
        contents: readBoundedUtf8File(candidate, MAX_BENCHMARK_CONTRACT_SOURCE_BYTES, `Solidity import ${importPath}`),
      };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      // Try the next deterministic local import root.
    }
  }
  return { error: `Import not found: ${importPath}` };
}

function stripSolidityMetadata(bytecode) {
  if (bytecode.length < 4) return bytecode;
  const encodedLength = bytecode.slice(-4);
  if (!/^[0-9a-f]{4}$/i.test(encodedLength)) return bytecode;
  const metadataBytes = Number.parseInt(encodedLength, 16);
  const metadataHexLength = (metadataBytes + 2) * 2;
  if (metadataBytes === 0 || metadataHexLength > bytecode.length) return bytecode;
  return bytecode.slice(0, -metadataHexLength);
}

assert.equal(stripSolidityMetadata("6000aabb0002"), "6000", "metadata parser self-check failed");

function compile({ compiler, contractPath, contractName, runs, viaIR }) {
  const source = readBoundedUtf8File(
    contractPath,
    MAX_BENCHMARK_CONTRACT_SOURCE_BYTES,
    `contract source ${contractPath}`,
  ).replace(/\r\n?/g, "\n");
  const input = {
    language: "Solidity",
    sources: { [contractPath]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs },
      viaIR,
      evmVersion: "osaka",
      outputSelection: {
        "*": {
          "*": [
            "abi",
            "storageLayout",
            "evm.bytecode.object",
            "evm.deployedBytecode.object",
          ],
        },
      },
    },
  };
  const output = JSON.parse(compiler.compile(JSON.stringify(input), { import: readImport }));
  const errors = (output.errors || []).filter((entry) => entry.severity === "error");
  if (errors.length > 0) {
    return {
      contract: contractName,
      compilerVersion: compiler.version(),
      runs,
      viaIR,
      status: "compile-error",
      error: errors.map((entry) => entry.message).join(" | "),
    };
  }
  const compiled = output.contracts?.[contractPath]?.[contractName];
  if (!compiled) {
    return { contract: contractName, runs, viaIR, status: "missing-output" };
  }
  const creationBytes = compiled.evm.bytecode.object.length / 2;
  const runtimeBytes = compiled.evm.deployedBytecode.object.length / 2;
  const executableRuntimeBytes = stripSolidityMetadata(compiled.evm.deployedBytecode.object).length / 2;
  return {
    contract: contractName,
    compilerVersion: compiler.version(),
    runs,
    viaIR,
    status: runtimeBytes <= EIP_170_RUNTIME_LIMIT ? "ok" : "runtime-too-large",
    creationBytes,
    runtimeBytes,
    executableRuntimeBytes,
    runtimeHeadroomBytes: EIP_170_RUNTIME_LIMIT - runtimeBytes,
  };
}

const rows = [];
for (const contract of CONTRACTS) {
  for (const runs of RUNS) {
    for (const viaIR of [false, true]) {
      rows.push(compile({
        compiler: contract.name === "LineaOreV9" ? legacySolc : solc,
        contractPath: contract.path,
        contractName: contract.name,
        runs,
        viaIR,
      }));
    }
  }
}

const baseline = rows.find((row) => (
  row.contract === "LineaOreV9" && row.runs === 200 && row.viaIR === false && row.status === "ok"
));
for (const row of rows) {
  if (!baseline || row.status !== "ok") continue;
  row.runtimeDeltaVsV9Bytes = row.runtimeBytes - baseline.runtimeBytes;
  row.creationDeltaVsV9Bytes = row.creationBytes - baseline.creationBytes;
}

const report = {
  compilerVersions: {
    LineaOreV9: legacySolc.version(),
    LineaOreV10: solc.version(),
  },
  evmVersion: "osaka",
  eip170RuntimeLimitBytes: EIP_170_RUNTIME_LIMIT,
  rows,
};

const canonicalV10 = rows.find((row) => (
  row.contract === "LineaOreV10" && row.runs === 200 && row.viaIR === false && row.status === "ok"
));
const failedProfiles = rows.filter((row) => row.status !== "ok");
const matrixPassed = (matrixRows, canonicalV9, canonicalV10Row) => (
  matrixRows.length === 16 &&
  matrixRows.every((row) => row.status === "ok") &&
  Boolean(canonicalV9) &&
  Boolean(canonicalV10Row)
);
const syntheticPassingRows = Array.from({ length: 16 }, () => ({ status: "ok" }));
assert.equal(matrixPassed(syntheticPassingRows, {}, {}), true, "complete compiler matrix self-check failed");
assert.equal(
  matrixPassed([...syntheticPassingRows.slice(0, 15), { status: "compile-error" }], {}, {}),
  false,
  "compiler matrix must fail when one profile fails",
);
assert.equal(
  matrixPassed(syntheticPassingRows.slice(0, 15), {}, {}),
  false,
  "compiler matrix must fail when one profile is missing",
);
const passed = matrixPassed(rows, baseline, canonicalV10);
const summarizeRow = (row) => row && ({
  creationBytes: row.creationBytes,
  runtimeBytes: row.runtimeBytes,
  executableRuntimeBytes: row.executableRuntimeBytes,
  runtimeHeadroomBytes: row.runtimeHeadroomBytes,
});

if (process.argv.includes("--summary-only")) {
  console.log(JSON.stringify({
    status: passed ? "passed" : "failed",
    compilerVersions: report.compilerVersions,
    evmVersion: report.evmVersion,
    profilesChecked: rows.length,
    profilesPassing: rows.length - failedProfiles.length,
    canonical: {
      LineaOreV9: summarizeRow(baseline),
      LineaOreV10: summarizeRow(canonicalV10),
    },
    canonicalDeltaV10VsV9: baseline && canonicalV10 ? {
      creationBytes: canonicalV10.creationBytes - baseline.creationBytes,
      runtimeBytes: canonicalV10.runtimeBytes - baseline.runtimeBytes,
    } : null,
    failedProfiles: failedProfiles.map(({ contract, runs, viaIR, status }) => ({ contract, runs, viaIR, status })),
  }));
} else {
  console.log(JSON.stringify(report, null, 2));
}

if (!passed) {
  process.exitCode = 1;
}
