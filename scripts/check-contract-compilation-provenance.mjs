import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import solc from "solc";

const EXPECTED_COMPILER = "0.8.34+commit.80d5c536";
const CONTRACT_PATH = "contracts/LineaOreV9.sol";
const MANIFEST_PATH = "contracts/LineaOreV9.compilation.json";
const OUTPUT_PATH = path.resolve(
  process.env.CONTRACT_PROVENANCE_OUT || ".tmp/contract-compilation-provenance.json",
);

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const readImport = (importPath) => {
  const candidates = [path.resolve(importPath), path.resolve("node_modules", importPath)];
  for (const candidate of candidates) {
    try {
      return { contents: fs.readFileSync(candidate, "utf8") };
    } catch {
      // Try the next deterministic local import root.
    }
  }
  return { error: `Import not found: ${importPath}` };
};

const compilerVersion = solc.version();
if (!compilerVersion.startsWith(EXPECTED_COMPILER)) {
  throw new Error(`Expected solc ${EXPECTED_COMPILER}, received ${compilerVersion}`);
}

const source = fs.readFileSync(CONTRACT_PATH, "utf8");
const input = {
  language: "Solidity",
  sources: { [CONTRACT_PATH]: { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "osaka",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: readImport }));
const errors = (output.errors || []).filter((entry) => entry.severity === "error");
if (errors.length > 0) {
  throw new Error(errors.map((entry) => entry.formattedMessage || entry.message).join("\n"));
}

const compiled = output.contracts?.[CONTRACT_PATH]?.LineaOreV9;
if (!compiled) throw new Error("LineaOreV9 compiler output is missing");
const compiledAbi = JSON.stringify(compiled.abi);
const compiledBytecode = compiled.evm.bytecode.object.toLowerCase();
const observed = {
  compilerVersion,
  settings: { optimizer: true, runs: 200, evmVersion: "osaka" },
  sourceSha256: sha256(source),
  abiSha256: sha256(compiledAbi),
  bytecodeSha256: sha256(compiledBytecode),
  bytecodeBytes: compiledBytecode.length / 2,
};
if (process.argv.includes("--write-manifest")) {
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(observed, null, 2)}\n`, "utf8");
}
const expected = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const result = {
  status: JSON.stringify(observed) === JSON.stringify(expected) ? "pass" : "fail",
  ...observed,
  manifestMatches: JSON.stringify(observed) === JSON.stringify(expected),
};
fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result));
if (result.status !== "pass") process.exitCode = 1;
